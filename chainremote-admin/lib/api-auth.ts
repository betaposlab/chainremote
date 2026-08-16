// 외부 클라이언트(본사 ChainRemote 데스크톱 앱) 인증 — Bearer JWT.
//
// NextAuth v5 세션 쿠키(JWE)와는 별도 시스템. AUTH_SECRET 은 공유하되 표준 HS256 JWT 로
// 발급/검증(jose). NextAuth 쿠키는 브라우저용 JWE 라 데스크톱 앱이 검증하기 번거로워서다.
// 발급 POST /api/auth/token, 사용은 모든 /api/* 에 Authorization: Bearer.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activeLoginSessions, tenants, users } from "@/lib/schema";
import { canWrite } from "@/lib/roles";

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
  /**
   * revoked=true 면 응답 바디에 `revoked: true` 가 실린다 — HQ 는 이걸 "인계당함/차단"으로
   * 보고 **즉시 세션을 끊고 로그아웃**한다. 일반 401 은 재로그인 시도로 처리된다.
   */
  constructor(public status: number, message: string, public revoked = false) {
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
  // 퇴사자 즉시 차단(2026-08-15) — 삭제·비활성 계정의 토큰은 그 즉시 죽는다.
  //   토큰은 24h 짜리 자체 서명이라 이 조회가 없으면 해고한 직원이 하루를 더 쓴다.
  //   삭제는 좌석 행이 cascade 로 사라져 heartbeat 가 걸러 주지만, **비활성(isActive=false)은
  //   좌석이 남아** 토큰 롤링 시점(수명 절반)까지 통과하던 구멍이 있었다. 여기서 막는다.
  //   ★revoked:true — 앱이 "인계당함"과 같은 경로로 즉시 세션을 끊고 로그아웃한다.
  //     (일반 401 은 재로그인 시도로 처리되는데, 그 재로그인은 어차피 막히지만 화면이 지저분하다.)
  //   uid 형식 검사를 먼저 — uuid 컬럼에 비-UUID 를 넘기면 Postgres 22P02 로 쿼리가 터지고
  //   그 에러 문구에 SQL 이 실려 500 바디로 샌다(CWE-209). 형식이 틀린 토큰은 그냥 죽은 것이다.
  if (!isUuid(claims.uid)) throw new ApiAuthError(401, "REVOKED", true);
  //   계정 생존 + 테넌트 상태 + **좌석 대조**를 한 번의 조회로 끝낸다.
  //   좌석 대조(A2-03, 2026-08-16): 종전엔 heartbeat 라우트 한 곳만 jti 를 봤다. 그래서
  //   인계당한(takeover 로 좌석을 뺏긴) 토큰이 heartbeat 밖 API 에서는 24h 동안 멀쩡했고,
  //   heartbeat 를 안 보내는 클라이언트라면 좌석 enforcement 를 통째로 우회했다.
  //   이제 관문에서 막으므로 "동시 1세션"이 클라이언트 협조 없이 성립한다.
  const [row] = await db
    .select({
      isActive: users.isActive,
      role: users.role,
      tenantActive: tenants.isActive,
      subscriptionStatus: tenants.subscriptionStatus,
      seatJti: activeLoginSessions.jti,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .leftJoin(activeLoginSessions, eq(activeLoginSessions.userId, users.id))
    .where(eq(users.id, claims.uid))
    .limit(1);
  if (!row || !row.isActive) throw new ApiAuthError(401, "REVOKED", true);

  //   role 은 DB 현재값을 신뢰한다(A2-05) — 토큰 안의 role 은 최대 12h 낡을 수 있어
  //   강등이 그동안 안 먹었다. 패널 관문(auth-guard)이 이미 DB 를 믿는 것과 짝을 맞춘다.
  claims.role = row.role as ApiTokenClaims["role"];

  //   jti 없는 옛 토큰은 발급 경로가 사라졌지만, 남아 있다면 좌석 대조를 건너뛴다
  //   (§8 백워드 호환 — 24h 뒤 자연 소멸).
  if (claims.jti && row.seatJti !== claims.jti) {
    throw new ApiAuthError(401, "REVOKED", true);
  }

  if (claims.role !== "super_admin") {
    if (!row.tenantActive || row.subscriptionStatus !== "active") {
      throw new ApiAuthError(401, "구독이 정지된 회사입니다");
    }
  }
  return claims;
}

// 권한 게이트: 거래처·원격 작업 — 직원 포함 전원 허용, 레거시 viewer 만 차단.
//   3역할 체계(2026-07-25)에서 직원도 거래처 추가·수정·삭제·푸시를 다 한다. 유일한 경계는
//   계정 관리이고 그건 세션 표면(패널)에만 있어 여기엔 짝이 없다. 판정은 lib/roles.ts 가 단일 출처.
//   ★종전 requireOwner 는 super_admin 을 빼먹어, owner 가 없는 회사(betaposlab)의 Chang 이
//     HQ 에서 거래처 확정·수정·삭제를 누르면 UI 는 버튼을 보여주는데 서버가 403 을 내던 결함이
//     있었다. 이 게이트로 통일하며 함께 해소된다.
export function requireNotViewer(me: ApiTokenClaims): void {
  if (!canWrite(me.role))
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

/**
 * 저장 전에 NUL(U+0000) 을 없앤다. Postgres text 컬럼은 NUL 을 못 담아 쿼리가 통째로 터지고,
 * 그 에러 메시지에 SQL 과 파라미터가 실려 나간다(CWE-209). jsonError 가 심층 방어를 하지만
 * 애초에 안 들어가게 하는 게 먼저다. 소스에 리터럴 제어문자를 두지 않으려 fromCharCode 사용.
 */
export function stripNul<T>(v: T): T {
  if (typeof v !== "string") return v;
  return v.split(String.fromCharCode(0)).join("") as unknown as T;
}

// 라우트에서 에러 응답 통일.
export function jsonError(e: unknown): Response {
  if (e instanceof ApiAuthError) {
    return Response.json(
      e.revoked ? { error: e.message, revoked: true } : { error: e.message },
      { status: e.status },
    );
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
  // NUL(U+0000) 은 Postgres text 에 못 들어가 쿼리가 통째로 터진다. 입력에서 걸러야 하지만
  //   빠뜨린 경로가 또 생길 수 있으니 여기서도 사람이 읽을 말로 바꾼다.
  if (/unsupported Unicode escape|invalid byte sequence|\\u0000|null character/i.test(chain)) {
    return Response.json({ error: "입력에 사용할 수 없는 문자가 있습니다." }, { status: 400 });
  }
  // ★여기서부터는 우리가 모르는 에러다. 종전엔 `e.message` 를 그대로 실어 보냈는데, drizzle 의
  //   DB 에러 메시지에는 **쿼리 전문과 바인딩 파라미터**(tenantId·UUID 등)가 들어 있어 그대로
  //   응답 바디로 샜다(CWE-209, 2026-08-16 감사에서 거래처 생성 NUL 입력으로 실증).
  //   패턴을 하나씩 막는 방식은 다음 패턴에서 또 뚫린다 — 기본을 "안 보낸다"로 뒤집는다.
  //   진짜 원인은 서버 로그에만 남긴다(운영자는 docker logs 로 본다).
  const detail = e instanceof Error ? e.message : String(e);
  if (isDbError(chain)) {
    console.error("[jsonError] DB error (bodyless):", detail);
    return Response.json({ error: "처리 중 오류가 발생했습니다." }, { status: 500 });
  }
  const msg = e instanceof Error ? e.message : "internal error";
  return Response.json({ error: msg }, { status: 500 });
}

/**
 * 이 에러가 DB 계층에서 왔나 — 그렇다면 메시지에 SQL·파라미터가 실려 있을 수 있어
 * 응답에 그대로 담으면 안 된다. drizzle 은 DrizzleQueryError 로 감싸며 message 를
 * "Failed query: ..." 로 바꾸고 원문은 cause 로 내려보낸다.
 */
function isDbError(chain: string): boolean {
  return (
    /Failed query|DrizzleQueryError|postgres|pg_|syntax error at or near|column .* does not exist|relation .* does not exist|violates .* constraint|invalid input syntax/i.test(
      chain,
    ) ||
    // DB 가 죽었을 때의 연결 계열 에러(2026-08-16 감사 S1). 호스트·포트·내부 경로가 그대로
    //   실려 나가고, SQL 구문 패턴만 보던 검사에는 안 걸렸다.
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|EPIPE|Connection terminated|timeout exceeded when trying to connect|too many clients|password authentication failed/i.test(
      chain,
    ) ||
    /\bselect\b[\s\S]*\bfrom\b|\binsert into\b|\bupdate\b[\s\S]*\bset\b/i.test(chain)
  );
}
