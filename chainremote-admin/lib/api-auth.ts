// 외부 클라이언트(본사 ChainRemote 데스크톱 앱) 인증 — Bearer JWT.
//
// NextAuth v5 세션 쿠키(JWE)와는 별도 시스템. AUTH_SECRET 은 공유하되 표준 HS256 JWT 로
// 발급/검증(jose). NextAuth 쿠키는 브라우저용 JWE 라 데스크톱 앱이 검증하기 번거로워서다.
// 발급 POST /api/auth/token, 사용은 모든 /api/* 에 Authorization: Bearer.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/schema";

const ALG = "HS256";
const ISSUER = "chainremote-admin";
const AUDIENCE = "chainremote-desktop";
const TOKEN_TTL = "24h";

export interface ApiTokenClaims extends JWTPayload {
  uid: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "operator" | "viewer" | "super_admin";
  tenantId: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 환경변수 없음");
  return new TextEncoder().encode(secret);
}

export async function signApiToken(
  claims: Omit<ApiTokenClaims, keyof JWTPayload>,
  jti?: string,
): Promise<{ token: string; expiresIn: number }> {
  let builder = new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL);
  // 좌석 enforcement(마이그레이션 010): jti 를 박아두면 heartbeat 가
  // active_login_sessions 와 대조할 수 있다. device_id 를 안 보내는 옛 앱은
  // jti 없이 발급 → 그대로 호환. jti 는 jose 표준 JWTPayload 필드.
  if (jti) builder = builder.setJti(jti);
  const token = await builder.sign(getSecret());
  return { token, expiresIn: 60 * 60 * 24 };
}

/// 토큰 롤링 재발급 판정 — 남은 수명이 절반(12h) 미만이면 true (2026-07-20 좀비 로그인 봉인).
/// heartbeat(10초 주기)가 이 판정으로 새 토큰을 실어 보내, 앱이 살아있는 한 만료가 오지 않는다.
export function needsTokenRefresh(exp: unknown, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return typeof exp === "number" && exp - nowSec < 60 * 60 * 12;
}

export async function verifyApiToken(token: string): Promise<ApiTokenClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: [ALG],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  return payload as ApiTokenClaims;
}

export class ApiAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// 라우트 핸들러용. 실패 시 ApiAuthError throw → 라우트가 jsonError 로 변환.
export async function requireApiAuth(req: Request): Promise<ApiTokenClaims> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiAuthError(401, "Bearer 토큰 없음");
  let claims: ApiTokenClaims;
  try {
    claims = await verifyApiToken(match[1]);
  } catch {
    throw new ApiAuthError(401, "토큰 검증 실패");
  }
  // H1: 정지/해지 테넌트는 발급된 24h 토큰이 살아있어도 리소스 접근을 서버측에서 차단한다.
  //   (로그인 3경로 차단만으론 정지 반영이 토큰 만료까지 최대 24h 지연되던 공백 — 코워크 H1.)
  //   super_admin(본사)만 예외: 자기잠금 방지(betaposlab 운영 계정). 로그인 경로와 동일 정책.
  //   ★상태코드 401(403 아님): /api/auth/heartbeat 이 정지에 401 을 쓰는 기존 설계와 일관되게 —
  //     앱은 non-revoked 401 을 "재로그인" 으로 처리하고, 그 재로그인은 token 라우트가 403 으로 막아
  //     깔끔히 로그아웃된다. 403 을 내면 앱의 heartbeat 401 흐름과 어긋나 세션이 limbo 에 빠진다.
  if (claims.role !== "super_admin") {
    const [t] = await db
      .select({
        isActive: tenants.isActive,
        subscriptionStatus: tenants.subscriptionStatus,
      })
      .from(tenants)
      .where(eq(tenants.id, claims.tenantId))
      .limit(1);
    if (!t || !t.isActive || t.subscriptionStatus !== "active") {
      throw new ApiAuthError(401, "구독이 정지된 회사입니다");
    }
  }
  return claims;
}

// 권한 게이트: owner 만 허용 (거래처 수정/삭제 등 chang 전용 작업).
export function requireOwner(me: ApiTokenClaims): void {
  if (me.role !== "owner") throw new ApiAuthError(403, "owner 권한 필요");
}

// 권한 게이트: viewer(읽기 전용) 차단 — owner/admin/operator 만 허용.
// 파괴적/부수효과 명령(디스크 정리 = Temp·휴지통 영구삭제 큐잉 등)은 읽기 계정이 못 낸다.
export function requireNotViewer(me: ApiTokenClaims): void {
  if (me.role === "viewer")
    throw new ApiAuthError(403, "읽기 전용 계정은 이 작업 권한이 없습니다");
}

// Postgres uuid 컬럼에 비-UUID 문자열을 eq() 로 넘기면 22P02 로 쿼리가 터지고, 그 에러
// 문구에 SQL·파라미터가 실려 500 바디로 샜다(CWE-209 정보노출). path/param 은 신뢰 못
// 하므로 데이터 레이어 전에 형식을 막는다. gen_random_uuid(v4)든 뭐든 표준 8-4-4-4-12 형식.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

// 에러 + 그 cause 체인(최대 5단)을 하나의 문자열로. drizzle-orm 0.45 는 DB 에러를
// DrizzleQueryError 로 감싸 message 를 "Failed query: ..." 로 바꾸고 진짜 제약 위반
// 문구(duplicate key ... uq_customers_remote_id)는 e.cause 로 내려보낸다. message 만
// 보면 M8(중복 remote_id → 친절한 409) 변환이 새서 raw 500 이 나갔다(테스트로 실증).
function errorMessageChain(e: unknown): string {
  let out = "";
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    out += " " + cur.message;
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

// 라우트에서 에러 응답 통일.
export function jsonError(e: unknown): Response {
  if (e instanceof ApiAuthError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  // remote_id 전역 partial-unique(011) 충돌은 원시 SQL 500 대신 409 로.
  // (다른 거래처와 같은 ID 등록 시도 — 오타/복붙/멀티테넌트 중복.)
  const chain = errorMessageChain(e);
  if (
    /duplicate key|unique/i.test(chain) &&
    /uq_customers_remote_id|remote_id/i.test(chain)
  ) {
    return Response.json(
      { error: "이미 등록된 원격 ID 입니다 (다른 거래처와 중복)." },
      { status: 409 },
    );
  }
  // 비-UUID path/param 이 uuid 컬럼 비교로 흘러 22P02 로 터진 경우 — 원시 SQL(쿼리+파라미터)을
  // 노출하지 않고 400 으로 정리한다. 라우트 uuid 가드가 1차, 이건 미처리 경로용 심층 방어.
  if (/invalid input syntax for (type )?uuid/i.test(chain)) {
    return Response.json({ error: "잘못된 ID 형식입니다." }, { status: 400 });
  }
  const msg = e instanceof Error ? e.message : "internal error";
  return Response.json({ error: msg }, { status: 500 });
}
