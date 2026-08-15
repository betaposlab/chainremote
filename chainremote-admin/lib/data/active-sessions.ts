// 좌석 enforcement 데이터 레이어 — 단일 동시세션(코이노식 takeover).
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md (마이그 010).
//
// active_login_sessions 는 user_id PK 라 계정당 active 1건. 라우트에서 호출:
//   - claimSeat      : 로그인 시 좌석 확보 (없음/같은기기/orphan 이면 성공, 아니면 occupied).
//   - takeoverSeat   : "강제 종료하고 사용" — 무조건 덮어쓴다.
//   - touchHeartbeat : ~10초 heartbeat — jti 일치면 last_seen 갱신, 불일치면 인계당한 것.
//   - releaseSeat    : 로그아웃 — 내 jti 일 때만 삭제 (이미 인계당했으면 새 기기 보존).
//
// orphan TTL = 2분 (스펙 §7): heartbeat 끊긴 지 2분↑ 이면 죽은 세션 → 다음 로그인 때 프롬프트 없이 통과.

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activeLoginSessions, users } from "@/lib/schema";

/**
 * 넷플릭스식 좌석 총량 — 이 대리점에서 (excludeUserId 제외) **살아있는** 세션 수.
 * 살아있음 = last_seen 2분 내(claimSeat 의 orphan TTL 과 같은 기준). 로그인 시 이 수가
 * max_seats 이상이면 대리점 좌석이 꽉 찬 것 → 새 아이디는 접속 거부(2026-07-23 Chang 결정:
 * 아이디는 여러 개 둬도 동시 접속만 좌석만큼). 아이디 개수 상한(max_seats 생성 제한)과 짝.
 * 본사(9999석)는 자연히 통과. excludeUserId 는 재로그인하는 본인(자기 자리 대체는 총량 불변).
 */
export async function countLiveTenantSessions(
  tenantId: string,
  excludeUserId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(activeLoginSessions)
    .innerJoin(users, eq(users.id, activeLoginSessions.userId))
    .where(
      and(
        eq(users.tenantId, tenantId),
        ne(activeLoginSessions.userId, excludeUserId),
        sql`${activeLoginSessions.lastSeenAt} > now() - interval '2 minutes'`,
      ),
    );
  return row?.n ?? 0;
}

export interface SeatParams {
  userId: string;
  jti: string;
  deviceId: string;
  deviceLabel: string | null;
  ip: string | null;
}

export interface ClaimResult {
  claimed: boolean;
  // occupied(claimed=false) 일 때 현재 점유자 표시 정보.
  occupiedBy?: { deviceLabel: string | null; since: Date };
  // claimed=true 이면서 "다른 기기의 죽은(orphan, 2분↑ 무heartbeat) 세션"을 조용히 인수한 경우.
  //   살아있는 세션 takeover 와 달리 프롬프트가 없으므로, 라우트가 이 표식으로 감사/알림을
  //   남겨 무흔적 hijack 표면을 줄이게 한다(best-effort — UPSERT 직전 사전상태 기준).
  reclaimedOrphan?: boolean;
}

/** 현재 점유 행 (없으면 null). */
export async function getActiveSession(userId: string) {
  const rows = await db
    .select()
    .from(activeLoginSessions)
    .where(eq(activeLoginSessions.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 로그인 시 좌석 확보 — race-safe 조건부 UPSERT.
 *
 * ON CONFLICT (user_id) DO UPDATE ... WHERE: 기존 행이 같은 기기(device_id 일치)면
 * 재로그인 자동 회수, orphan(last_seen 2분↑)이면 죽은 세션 takeover — 둘 중 하나면 갱신해
 * 좌석 확보. 둘 다 아니면(=다른 기기 살아있음) UPDATE 가 억제돼 0 rows → occupied.
 * 동시 2기기 경쟁도 user_id PK 로 1건만 이긴다 (스펙 §10).
 */
export async function claimSeat(p: SeatParams): Promise<ClaimResult> {
  // 사전 상태(감사용, best-effort). UPSERT 는 원자적이라 이 조회와 미세 race 가 있으나
  //   enforcement 가 아닌 로깅 목적이라 허용.
  const prior = await getActiveSession(p.userId);
  const result = await db.execute(sql`
    INSERT INTO active_login_sessions
      (user_id, jti, device_id, device_label, ip, created_at, last_seen_at)
    VALUES (${p.userId}::uuid, ${p.jti}::uuid, ${p.deviceId}::text,
            ${p.deviceLabel}::text, ${p.ip}::text, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      jti = EXCLUDED.jti,
      device_id = EXCLUDED.device_id,
      device_label = EXCLUDED.device_label,
      ip = EXCLUDED.ip,
      created_at = now(),
      last_seen_at = now()
    WHERE active_login_sessions.device_id = EXCLUDED.device_id
       OR active_login_sessions.last_seen_at < now() - interval '2 minutes'
    RETURNING user_id
  `);
  const claimed = (result as unknown as { rows: unknown[] }).rows.length > 0;
  if (claimed) {
    // 다른 기기의 죽은 세션을 인수했으면(같은 기기 재claim 은 orphan 아님) 표식.
    //   claim 이 성공했는데 사전 점유자가 다른 기기였다면 = orphan(2분↑) 이었다는 뜻.
    const reclaimedOrphan = !!prior && prior.deviceId !== p.deviceId;
    return { claimed: true, reclaimedOrphan };
  }

  // 점유됨 — 표시용으로 현재 점유자를 조회.
  const occ = await getActiveSession(p.userId);
  return {
    claimed: false,
    occupiedBy: occ
      ? { deviceLabel: occ.deviceLabel, since: occ.createdAt }
      : undefined,
  };
}

/**
 * "강제 종료하고 사용" — 무조건 새 기기로 덮어쓴다(새 jti).
 * 옛 기기 jti 는 이 순간 무효 → 옛 기기의 다음 heartbeat 가 401 REVOKED.
 */
export async function takeoverSeat(p: SeatParams): Promise<void> {
  const now = new Date();
  await db
    .insert(activeLoginSessions)
    .values({
      userId: p.userId,
      jti: p.jti,
      deviceId: p.deviceId,
      deviceLabel: p.deviceLabel,
      ip: p.ip,
      createdAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: activeLoginSessions.userId,
      set: {
        jti: p.jti,
        deviceId: p.deviceId,
        deviceLabel: p.deviceLabel,
        ip: p.ip,
        createdAt: now,
        lastSeenAt: now,
      },
    });
}

/**
 * heartbeat — jti 가 현재 active 와 일치하면 last_seen 갱신 후 true.
 * 불일치/행없음(인계당함 or 로그아웃)이면 false → 라우트가 401 REVOKED.
 */
export async function touchHeartbeat(
  userId: string,
  jti: string,
  version?: string | null,
): Promise<boolean> {
  const rows = await db
    .update(activeLoginSessions)
    .set({ lastSeenAt: new Date() })
    .where(
      and(eq(activeLoginSessions.userId, userId), eq(activeLoginSessions.jti, jti)),
    )
    .returning({ userId: activeLoginSessions.userId });
  if (rows.length === 0) return false;
  // 좌석 생존 확인됨 → 이 직원 HQ 버전/마지막접속 갱신 (패널 표시용).
  // best-effort: 여기서 실패해도(마이그 014 미적용 등) heartbeat/좌석 판정은 위에서 이미 끝났다.
  // 버전 표시는 부가기능이라 seat enforcement 를 깨면 안 되므로 try/catch 로 격리한다.
  try {
    await db
      .update(users)
      .set({ lastHeartbeatAt: new Date(), ...(version ? { lastVersion: version } : {}) })
      .where(eq(users.id, userId));
  } catch {
    // 버전 기록 실패는 무시 (세션/좌석엔 영향 없음)
  }
  return true;
}

/**
 * 로그아웃 — 내 jti 일 때만 삭제. 이미 인계당한 뒤(active 가 다른 jti)면
 * 새 기기 세션은 건드리지 않는다.
 */
export async function releaseSeat(userId: string, jti: string): Promise<void> {
  await db
    .delete(activeLoginSessions)
    .where(
      and(eq(activeLoginSessions.userId, userId), eq(activeLoginSessions.jti, jti)),
    );
}

/**
 * 계정 차단용 강제 좌석 회수(2026-08-15) — jti 를 따지지 않고 그 계정의 좌석을 비운다.
 * 비활성화(isActive=false)에 쓴다: 삭제는 FK cascade 로 좌석이 알아서 사라지지만 비활성은
 * 행이 남아 HQ heartbeat 가 계속 200 을 받았다. 좌석을 비우면 다음 heartbeat(~5초)에
 * REVOKED 가 나가 앱이 스스로 세션을 끊는다.
 */
export async function revokeSeat(userId: string): Promise<void> {
  await db.delete(activeLoginSessions).where(eq(activeLoginSessions.userId, userId));
}
