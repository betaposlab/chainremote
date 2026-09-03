// 로그인 기록 — 성공·실패·좌석 takeover.
//
// 여태 로그인은 아무 데도 안 남았다. 그래서 "탑아이엔티가 들어와 봤나"를
// 하트비트·활성좌석·지원기록 세 개로 간접 추론해야 했다(2026-09-04). 대리점이 늘면
// 그 방식은 못 쓴다. 원격지원 사업에서 사고가 나면 "누가 언제 어느 IP 로 들어왔나"가
// 조사의 시작점이라, 여기부터 남긴다.
//
// ★로그인 경로가 셋이다 — 브라우저(auth.ts) · HQ 앱(/api/auth/token) · 좌석
//   takeover(/api/auth/takeover). 셋이 각자 기록하면 한 곳이 빠지는 날이 온다.
//   이 파일이 그 셋의 유일한 창구다.
//
// ★기록이 로그인을 막지 않는다. writeAudit 이 이미 실패를 삼키지만, last_login_at
//   갱신은 별도 쿼리라 여기서 한 번 더 감싼다. 감사 테이블이 잠겼다고 사장님이
//   패널에 못 들어가는 일은 없어야 한다.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { writeAudit } from "@/lib/data/audit";

type Via = "browser" | "hq" | "takeover";

/** 로그인 성공 — 감사 한 줄 + users.last_login_at 갱신. */
export async function recordLoginSuccess(p: {
  userId: string;
  tenantId: string | null;
  via: Via;
  deviceLabel?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await writeAudit({
    action: p.via === "takeover" ? "auth.takeover" : "auth.login",
    tenantId: p.tenantId,
    userId: p.userId,
    targetType: "user",
    targetId: p.userId,
    metadata: { via: p.via, device: p.deviceLabel ?? null },
    ...(p.ip !== undefined ? { ipAddress: p.ip } : {}),
    ...(p.userAgent !== undefined ? { userAgent: p.userAgent } : {}),
  });
  try {
    await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, p.userId));
  } catch (e) {
    console.error("[audit] last_login_at 갱신 실패", p.userId, e);
  }
}

/**
 * 로그인 실패.
 *
 * ★비밀번호는 남기지 않는다 — 오타 한 번이 로그에 평문으로 박히면 그 로그 자체가
 *   자격증명 저장소가 된다. 남기는 건 시도한 아이디와 실패 사유 구분뿐이다.
 * ★userId 는 아이디가 실재할 때만 채운다. 없는 아이디로 친 시도는 사용자에 못 건다.
 */
export async function recordLoginFailure(p: {
  attemptedId: string;
  reason: "no_such_user" | "bad_password" | "tenant_blocked";
  userId?: string | null;
  tenantId?: string | null;
  via: Via;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await writeAudit({
    action: "auth.login_failed",
    tenantId: p.tenantId ?? null,
    userId: p.userId ?? null,
    targetType: "user",
    targetId: p.userId ?? null,
    metadata: {
      via: p.via,
      reason: p.reason,
      // 아이디는 길이를 잘라 둔다 — 여기에 통째로 붙여넣기 한 값이 들어오기도 한다.
      attemptedId: p.attemptedId.slice(0, 120),
    },
    ...(p.ip !== undefined ? { ipAddress: p.ip } : {}),
    ...(p.userAgent !== undefined ? { userAgent: p.userAgent } : {}),
  });
}
