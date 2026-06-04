// POST /api/auth/takeover — 기기 B 가 "강제 종료하고 사용" 선택 시.
// 요청: { email, password, deviceId, deviceLabel? }
// 응답: { token, expiresIn, user }  /  401 자격 실패  /  400 입력 누락
//
// 자격 재검증(로그인과 동일) → active 를 새 기기로 덮어씀(새 jti) → 토큰 발급.
// 옛 기기의 jti 는 이 순간 무효 → 옛 기기 다음 heartbeat 가 401 REVOKED 받고 스스로 종료.
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md §5

import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { signApiToken, jsonError, ApiAuthError } from "@/lib/api-auth";
import { takeoverSeat } from "@/lib/data/active-sessions";
import { clientIp } from "@/lib/request-ip";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
      deviceId?: unknown;
      deviceLabel?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const deviceLabel =
      typeof body.deviceLabel === "string" ? body.deviceLabel.trim() : "";
    if (!email || !password) throw new ApiAuthError(400, "email/password 필요");
    if (!deviceId) throw new ApiAuthError(400, "deviceId 필요");

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

    const jti = crypto.randomUUID();
    await takeoverSeat({
      userId: u.id,
      jti,
      deviceId,
      deviceLabel: deviceLabel || null,
      ip: clientIp(req),
    });

    const { token, expiresIn } = await signApiToken(
      {
        uid: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        tenantId: u.tenantId,
      },
      jti,
    );

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
