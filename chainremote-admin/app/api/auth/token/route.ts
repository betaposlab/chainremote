// POST /api/auth/token — 외부 클라이언트(데스크톱 앱) 로그인 토큰 발급.
// 요청: { email, password }
// 응답: { token, expiresIn, user: {...} }  /  401 if 자격 실패
//
// auth.ts 의 Credentials.authorize 와 동일한 검증 로직.
// 차이: 쿠키가 아니라 JSON 본체에 JWT 반환.

import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { signApiToken, jsonError, ApiAuthError } from "@/lib/api-auth";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) throw new ApiAuthError(400, "email/password 필요");

    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.isActive, true)))
      .limit(1);
    if (rows.length === 0) throw new ApiAuthError(401, "자격 실패");

    const u = rows[0];
    if (!bcrypt.compareSync(password, u.passwordHash)) {
      throw new ApiAuthError(401, "자격 실패");
    }

    const { token, expiresIn } = await signApiToken({
      uid: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      tenantId: u.tenantId,
    });

    return Response.json({
      token,
      expiresIn,
      user: {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        tenantId: u.tenantId,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
