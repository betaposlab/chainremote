// POST /api/auth/takeover — 기기 B 가 "강제 종료하고 사용" 눌렀을 때.
// 자격 재검증(로그인과 동일) → active 좌석을 새 기기로 덮어쓰고(새 jti) 토큰 발급.
// 옛 기기의 jti 는 이 순간 무효 → 다음 heartbeat 가 401 REVOKED 받고 스스로 종료.
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md §5

import { and, eq, sql } from "drizzle-orm";
import { verifyPassword } from "@/lib/password-verify";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { users, tenants } from "@/lib/schema";
import { signApiToken, jsonError, ApiAuthError } from "@/lib/api-auth";
import { takeoverSeat, countLiveTenantSessions } from "@/lib/data/active-sessions";
import { clientIp } from "@/lib/request-ip";
import { rateLimit, rateLimitPeek, rateLimitRecord, rateLimitReset, tooManyRequests } from "@/lib/rate-limit";

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
    // 길이 상한(A2-09) — 없으면 200KB 라벨이 그대로 좌석·세션 기기 스탬프까지 흘러간다.
    const deviceId =
      typeof body.deviceId === "string" ? body.deviceId.trim().slice(0, 128) : "";
    const deviceLabel =
      typeof body.deviceLabel === "string" ? body.deviceLabel.trim().slice(0, 128) : "";
    if (!email || !password) throw new ApiAuthError(400, "email/password 필요");
    if (!deviceId) throw new ApiAuthError(400, "deviceId 필요");

    // rate-limit: 로그인 비번 대입 방지 (IP + 계정 양쪽). token 라우트와 같은 키 공유.
    const ip = clientIp(req) ?? "unknown";
    const ipRl = rateLimit(`login:ip:${ip}`, 15, 60_000);
    if (!ipRl.allowed) return tooManyRequests(ipRl.retryAfterSec);
    // 아이디 키는 **실패만** 센다(A2-08). 성공 시도까지 세면 아이디만 아는 사람이
    //   1분에 6번 틀려서 그 계정 로그인을 계속 잠글 수 있었다(IP 무관 서비스 거부).
    const emailKey = `login:email:${email.toLowerCase()}`;
    const emailRl = rateLimitPeek(emailKey, 20, 600_000);
    if (!emailRl.allowed) return tooManyRequests(emailRl.retryAfterSec);

    // email 전역 유니크(마이그 012)라 단독 조회 안전 + 테넌트 상태도 같이 join.
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        displayName: users.displayName,
        role: users.role,
        tenantId: users.tenantId,
        greeting: tenants.hqGreeting,
        tenantName: tenants.displayName,
        tenantActive: tenants.isActive,
        subscriptionStatus: tenants.subscriptionStatus,
        maxSeats: tenants.maxSeats,
      })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      // 아이디는 대소문자를 가리지 않는다(A2-06) — 유니크 인덱스가 lower(email)(마이그012)
      //   인데 조회만 정확일치라, "Chang" 으로 만든 계정에 "chang" 으로는 못 들어가고
      //   같은 이름을 새로 만들 수도 없어 출구가 없었다.
      .where(
        and(
          sql`lower(${users.email}) = ${email.toLowerCase()}`,
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    if (rows.length === 0) throw new ApiAuthError(401, "자격 실패");
    const u = rows[0];
    if (!verifyPassword(password, u.passwordHash)) {
      rateLimitRecord(emailKey, 600_000);
      throw new ApiAuthError(401, "자격 실패");
    }
    rateLimitReset(emailKey);
    // 정지/해지 테넌트 차단 (super_admin 은 자기잠금 방지로 예외).
    if (
      u.role !== "super_admin" &&
      (!u.tenantActive || u.subscriptionStatus !== "active")
    ) {
      throw new ApiAuthError(403, "구독이 정지되어 로그인할 수 없습니다. 관리자에게 문의하세요.");
    }

    // ★좌석 총량 검사(A2-01, 2026-08-16) — token 라우트에만 있었다. 서버는 "409 뒤에만
    //   takeover 를 부른다"를 강제하지 않으므로, 이 라우트를 직접 치면 대리점 동시 접속
    //   상한을 통째로 우회할 수 있었다(아이디 수만큼 동시 접속 = 좌석 과금 우회).
    //   자기 좌석 덮어쓰기는 본인 제외라 총량이 안 변한다 → 정상 흐름엔 영향 0.
    const liveOthers = await countLiveTenantSessions(u.tenantId, u.id);
    if (liveOthers >= u.maxSeats) {
      throw new ApiAuthError(
        403,
        `동시 접속 인원(${u.maxSeats}명)이 모두 사용 중입니다. 다른 직원이 접속을 종료한 뒤 다시 시도하세요.`,
      );
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
        // 로그인(/api/auth/token) 과 같은 모양이어야 한다 — takeover 로 들어온 세션만
        // 상호나 인사말이 빠지면 "어제는 됐는데 오늘은 안 된다" 가 된다.
        ...(u.tenantName ? { tenantName: u.tenantName } : {}),
        ...(u.greeting ? { greeting: u.greeting } : {}),
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
