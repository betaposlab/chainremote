// 외부 클라이언트(본사 ChainRemote 데스크톱 앱) 인증 — Bearer JWT.
//
// NextAuth v5 의 세션 쿠키(JWE)와는 별도 시스템.
// 같은 AUTH_SECRET 을 공유하지만 표준 HS256 JWT 로 발급/검증 (jose 라이브러리).
// 이유: NextAuth 쿠키는 브라우저용 JWE. 데스크톱 앱이 jwt.verify 하기 번거로움.
//
// 발급: POST /api/auth/token (email + password) → { token, expiresIn }
// 사용: Authorization: Bearer <token>  (모든 /api/* 호출)

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
): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(getSecret());
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

// 라우트 핸들러에서 사용: const me = await requireApiAuth(req);
// 실패 시 ApiAuthError throw → 라우트는 jsonError 로 변환.
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
  const msg = e instanceof Error ? e.message : "internal error";
  return Response.json({ error: msg }, { status: 500 });
}
