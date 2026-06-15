// 좌석 enforcement 데이터 레이어 — 단일 동시세션(코이노식 takeover).
// 스펙: docs/chainremote/SEAT_ENFORCEMENT.md  (마이그레이션 010).
//
// active_login_sessions: user_id PK 라 계정당 active 1건. 호출자(라우트):
//   - claimSeat   : 로그인 시 좌석 확보 시도 (없음/같은기기/orphan 이면 성공, 아니면 occupied).
//   - takeoverSeat: "강제 종료하고 사용" — 무조건 덮어씀.
//   - touchHeartbeat: ~10초 heartbeat — jti 일치 시 last_seen 갱신, 불일치=인계당함.
//   - releaseSeat : 로그아웃 — 내 jti 인 경우만 삭제 (이미 인계당했으면 새 기기 보존).
//
// orphan TTL = 2분 (스펙 §7): heartbeat 끊긴 지 2분↑ = 죽은 세션 → 다음 로그인 프롬프트 없이 통과.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activeLoginSessions, users } from "@/lib/schema";

export interface SeatParams {
  userId: string;
  jti: string;
  deviceId: string;
  deviceLabel: string | null;
  ip: string | null;
}

export interface ClaimResult {
  claimed: boolean;
  // occupied(claimed=false) 시 현재 점유자 표시 정보.
  occupiedBy?: { deviceLabel: string | null; since: Date };
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
 * 로그인 시 좌석 확보 시도 — race-safe 원자적 조건부 UPSERT.
 *
 * ON CONFLICT (user_id) DO UPDATE ... WHERE: 기존 행이
 *   (a) 같은 기기(device_id 일치) → 재로그인 자동 회수, 또는
 *   (b) orphan(last_seen 2분↑ 경과) → 죽은 세션 takeover
 * 이면 갱신(좌석 확보). 둘 다 아니면(=다른 기기가 살아있음) UPDATE 억제 → 0 rows → occupied.
 * 동시 2기기 경쟁도 user_id PK 로 1건만 승 (스펙 §10).
 */
export async function claimSeat(p: SeatParams): Promise<ClaimResult> {
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
  if (claimed) return { claimed: true };

  // 점유됨 — 표시용으로 현재 점유자 조회.
  const occ = await getActiveSession(p.userId);
  return {
    claimed: false,
    occupiedBy: occ
      ? { deviceLabel: occ.deviceLabel, since: occ.createdAt }
      : undefined,
  };
}

/**
 * "강제 종료하고 사용" — 무조건 새 기기로 덮어씀(새 jti).
 * 옛 기기의 jti 는 이 순간 무효 → 옛 기기 다음 heartbeat 가 401 REVOKED.
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
 * 불일치/행없음(=인계당함 or 로그아웃) → false → 라우트가 401 REVOKED.
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
  // 좌석 생존 확인됨 → 이 직원의 HQ 버전/마지막접속 갱신 (패널 가시화).
  //   ★ best-effort: 여기서 실패해도(마이그 014 미적용 등) heartbeat/좌석 판정은 위에서 이미 끝남.
  //     버전 가시화는 부가기능이라 절대 seat enforcement 를 깨면 안 됨 → try/catch 로 격리.
  try {
    await db
      .update(users)
      .set({ lastHeartbeatAt: new Date(), ...(version ? { lastVersion: version } : {}) })
      .where(eq(users.id, userId));
  } catch {
    // 버전 기록 실패 무시 (세션/좌석엔 영향 없음)
  }
  return true;
}

/**
 * 로그아웃 — 내 jti 인 경우만 삭제. 이미 인계당한 뒤(active 가 다른 jti)면
 * 새 기기의 세션을 지우지 않는다.
 */
export async function releaseSeat(userId: string, jti: string): Promise<void> {
  await db
    .delete(activeLoginSessions)
    .where(
      and(eq(activeLoginSessions.userId, userId), eq(activeLoginSessions.jti, jti)),
    );
}
