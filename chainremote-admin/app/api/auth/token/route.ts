// POST /api/auth/token — 외부 클라이언트(데스크톱 앱) 로그인 토큰 발급.
// 요청: { email, password, deviceId, deviceLabel? }
// 응답: { token, expiresIn, user }                       → 발급 성공
//       401 자격 실패 / 400 입력 누락 (deviceId 포함)
//       409 { occupied:true, deviceLabel, since }        → 다른 기기에서 사용 중 (좌석 점유)
//
// auth.ts 의 Credentials.authorize 와 동일한 검증 로직. 차이: 쿠키 대신 JSON 본체에 JWT.
//
// 좌석 enforcement (마이그레이션 010, 스펙 docs/chainremote/SEAT_ENFORCEMENT.md):
//   active_login_sessions 에서 좌석 1개 확보 시도 — 다른 기기가 점유 중이면
//   409 → 앱이 "강제 종료하고 사용 / 취소" 모달 → takeover.
//   deviceId 필수(§8 ④, 2026-06-12 옛 stateless 경로 차단) = 모든 발급 토큰에 jti
//   → "한 아이디 = 동시 1대" 빈틈 없음. 옛 jti 없는 토큰은 TTL 24h 로 자연 소멸.

import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { signApiToken, jsonError, ApiAuthError } from "@/lib/api-auth";
import { claimSeat } from "@/lib/data/active-sessions";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

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
    // 옛 stateless 경로 차단(§8 ④) — takeover 라우트와 동일 검증.
    if (!deviceId) throw new ApiAuthError(400, "deviceId 필요");

    // rate-limit: 로그인 비번 대입 방지 (IP + 계정 양쪽). token/takeover 가 같은 키 공유.
    const ip = clientIp(req) ?? "unknown";
    const ipRl = rateLimit(`login:ip:${ip}`, 15, 60_000);
    if (!ipRl.allowed) return tooManyRequests(ipRl.retryAfterSec);
    const emailRl = rateLimit(`login:email:${email.toLowerCase()}`, 6, 60_000);
    if (!emailRl.allowed) return tooManyRequests(emailRl.retryAfterSec);

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

    // 좌석 확보 — 점유 시 토큰 발급 안 함.
    const claim = await claimSeat({
      userId: u.id,
      jti,
      deviceId,
      deviceLabel: deviceLabel || null,
      ip: clientIp(req),
    });
    if (!claim.claimed) {
      // 409 OCCUPIED — 다른 기기에서 사용 중.
      return Response.json(
        {
          error: "이 계정은 현재 다른 기기에서 사용 중입니다",
          occupied: true,
          deviceLabel: claim.occupiedBy?.deviceLabel ?? null,
          since: claim.occupiedBy?.since ?? null,
        },
        { status: 409 },
      );
    }

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
