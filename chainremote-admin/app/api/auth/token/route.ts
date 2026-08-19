// POST /api/auth/token — 데스크톱 앱 로그인 토큰 발급.
// auth.ts 의 Credentials.authorize 와 검증은 동일, 차이는 쿠키 대신 JSON 본체 JWT.
// 다른 기기가 좌석을 쓰는 중이면 409 occupied → 앱이 "강제 종료하고 사용/취소" 모달 → takeover.
//
// 좌석 enforcement (마이그 010, 스펙 docs/chainremote/SEAT_ENFORCEMENT.md):
//   active_login_sessions 에서 좌석 1개 확보 시도. deviceId 필수(§8, 2026-06-12 옛
//   stateless 경로 차단)라 모든 발급 토큰에 jti → "한 아이디 = 동시 1대" 빈틈 없음.
//   옛 jti 없는 토큰은 TTL 24h 로 자연 소멸.

import { and, eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { qwertyFromHangul } from "@/lib/hangul-qwerty";
import { users, tenants } from "@/lib/schema";
import { signApiToken, jsonError, ApiAuthError } from "@/lib/api-auth";
import { claimSeat, countLiveTenantSessions } from "@/lib/data/active-sessions";
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
    // deviceId 없으면 거부 — 옛 stateless 경로 차단(§8). takeover 라우트와 동일.
    if (!deviceId) throw new ApiAuthError(400, "deviceId 필요");

    // rate-limit: 로그인 비번 대입 방지 (IP + 계정 양쪽). token/takeover 가 같은 키 공유.
    const ip = clientIp(req) ?? "unknown";
    const ipRl = rateLimit(`login:ip:${ip}`, 15, 60_000);
    if (!ipRl.allowed) return tooManyRequests(ipRl.retryAfterSec);
    // 아이디 키는 **실패만** 센다(A2-08). 성공 시도까지 세면 아이디만 아는 사람이
    //   1분에 6번 틀려서 그 계정 로그인을 계속 잠글 수 있었다(IP 무관 서비스 거부).
    const emailKey = `login:email:${email.toLowerCase()}`;
    const emailRl = rateLimitPeek(emailKey, 20, 600_000);
    if (!emailRl.allowed) return tooManyRequests(emailRl.retryAfterSec);

    // email 전역 유니크(마이그 012)라 단독 조회 안전 + 테넌트 상태도 같이 join.
    const findByName = (name: string) =>
      db
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
          sql`lower(${users.email}) = ${name.toLowerCase()}`,
          eq(users.isActive, true),
        ),
      )
      .limit(1);

    let rows = await findByName(email);
    // 한글 입력 상태로 친 아이디를 구제한다 — 'chang' 이 '초뭏' 으로 들어온다.
    //   ★친 그대로 먼저 찾고 **없을 때만** 되돌린다(패널 로그인과 같은 규칙).
    if (rows.length === 0) {
      const alt = qwertyFromHangul(email);
      if (alt) rows = await findByName(alt);
    }
    if (rows.length === 0) throw new ApiAuthError(401, "자격 실패");

    const u = rows[0];
    if (!bcrypt.compareSync(password, u.passwordHash)) {
      rateLimitRecord(emailKey, 600_000);
      throw new ApiAuthError(401, "자격 실패");
    }
    rateLimitReset(emailKey);
    // 정지/해지 테넌트 차단. super_admin 은 구독 대상이 아니라 예외(자기잠금 방지).
    if (
      u.role !== "super_admin" &&
      (!u.tenantActive || u.subscriptionStatus !== "active")
    ) {
      throw new ApiAuthError(403, "구독이 정지되어 로그인할 수 없습니다. 관리자에게 문의하세요.");
    }

    // ★넷플릭스식 동시 접속 총량 — 이 대리점의 다른 아이디가 이미 좌석을 다 쓰고 있으면
    //   새 아이디는 접속 거부(같은 아이디 재로그인은 자기 자리 대체라 총량 불변 → 본인 제외).
    //   아이디 생성 상한(max_seats)과 짝: 아이디는 여러 개 둬도 동시 원격은 좌석만큼.
    //   super_admin 본사는 9999석이라 자연히 통과. 초과는 403 → HQ 가 메시지 그대로 표시.
    const liveOthers = await countLiveTenantSessions(u.tenantId, u.id);
    if (liveOthers >= u.maxSeats) {
      throw new ApiAuthError(
        403,
        `동시 접속 인원(${u.maxSeats}명)이 모두 사용 중입니다. 다른 직원이 접속을 종료한 뒤 다시 시도하세요.`,
      );
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
      // 다른 기기가 점유 중 — 409 로 알려주고 앱이 takeover 여부를 묻게.
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
    // 죽은(orphan, 2분↑ 무heartbeat) 세션을 프롬프트 없이 조용히 인수한 경우 감사 흔적을 남긴다
    //   (살아있는 세션 takeover 는 별도 라우트/모달로 사용자 확인을 거치지만, orphan 인수는
    //   마찰0이라 무흔적이 된다 — active-sessions.ts:reclaimedOrphan 계약 이행). 로그인 성공
    //   자격은 이미 검증됐으므로 공격이 아니라 감사·이상탐지용 신호.
    if (claim.reclaimedOrphan) {
      console.warn(
        `[seat] orphan 세션 인수: userId=${u.id} email=${u.email} newDevice=${deviceId} label=${deviceLabel || "-"} ip=${clientIp(req) ?? "-"}`,
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
        // 대리점 상호. HQ 사이드바가 "본사용 (HQ)" 대신 이걸 띄운다 — 직원이 여럿인
        // 대리점에서 내가 어느 회사로 붙어 있는지가 앱 안에 전혀 없었다.
        ...(u.tenantName ? { tenantName: u.tenantName } : {}),
        // HQ 정보 화면 이스터에그 문구(마이그 030). 비운 대리점(대부분)은 아예 안 실린다
        // → HQ 에서 그 기능이 없는 것처럼 동작한다.
        ...(u.greeting ? { greeting: u.greeting } : {}),
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
