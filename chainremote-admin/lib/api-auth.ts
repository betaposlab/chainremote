// 외부 클라이언트(본사 ChainRemote 데스크톱 앱) 인증 — Bearer JWT.
//
// NextAuth v5 세션 쿠키(JWE)와는 별도 시스템. AUTH_SECRET 은 공유하되 표준 HS256 JWT 로
// 발급/검증(jose). NextAuth 쿠키는 브라우저용 JWE 라 데스크톱 앱이 검증하기 번거로워서다.
// 발급 POST /api/auth/token, 사용은 모든 /api/* 에 Authorization: Bearer.

import { SignJWT, jwtVerify, type JWTPayload } from "jose";

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
  try {
    return await verifyApiToken(match[1]);
  } catch {
    throw new ApiAuthError(401, "토큰 검증 실패");
  }
}

// 권한 게이트: owner 만 허용 (거래처 수정/삭제 등 chang 전용 작업).
export function requireOwner(me: ApiTokenClaims): void {
  if (me.role !== "owner") throw new ApiAuthError(403, "owner 권한 필요");
}

// 라우트에서 에러 응답 통일.
export function jsonError(e: unknown): Response {
  if (e instanceof ApiAuthError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  // remote_id 전역 partial-unique(011) 충돌은 원시 SQL 500 대신 409 로.
  // (다른 거래처와 같은 ID 등록 시도 — 오타/복붙/멀티테넌트 중복.)
  if (
    e instanceof Error &&
    /duplicate key|unique/i.test(e.message) &&
    /uq_customers_remote_id|remote_id/i.test(e.message)
  ) {
    return Response.json(
      { error: "이미 등록된 원격 ID 입니다 (다른 거래처와 중복)." },
      { status: 409 },
    );
  }
  const msg = e instanceof Error ? e.message : "internal error";
  return Response.json({ error: msg }, { status: 500 });
}
