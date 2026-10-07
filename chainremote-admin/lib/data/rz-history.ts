// "응답 없음" 구간 이력 + 대리 전달 요청 기록 조회(마이그 057).
// 실전에서 대리 전달이 안 붙었을 때 어디서 끊겼는지 가르는 근거 — 배경은 마이그 파일.

import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { rzNoreplyEpisodes, rzRelayRequests, users } from "@/lib/schema";

/** 같은 구간으로 볼 시작 시각 오차. 에이전트는 같은 구간 동안 같은 값을 보내지만 초 단위 반올림 여유. */
const SAME_EPISODE_MS = 120_000;
/** 화면에 보여줄 기간. 요청 행 보관(30일)과 맞춘다. */
const HISTORY_DAYS = 30;

/**
 * heartbeat 한 번의 응답 없음 보고를 구간 이력에 반영한다.
 *   since=Date → 그 상태. 열린 구간이 같은 시작이면 last_seen 만 밀고, 다르면 닫고 새로 연다.
 *   since=null → 풀림. 열린 구간을 닫는다(대부분 열린 구간이 없어 부분 인덱스 한 번 찌르고 끝).
 *   since=undefined(옛 에이전트) 는 부르지 않는다.
 */
export async function recordNoreplyEpisode(
  tenantId: string,
  customerId: string,
  since: Date | null,
): Promise<void> {
  const now = new Date();
  if (since === null) {
    await db
      .update(rzNoreplyEpisodes)
      .set({ endedAt: now, endReason: "cleared" })
      .where(and(eq(rzNoreplyEpisodes.customerId, customerId), isNull(rzNoreplyEpisodes.endedAt)));
    return;
  }
  const [open] = await db
    .select({ id: rzNoreplyEpisodes.id, startedAt: rzNoreplyEpisodes.startedAt })
    .from(rzNoreplyEpisodes)
    .where(and(eq(rzNoreplyEpisodes.customerId, customerId), isNull(rzNoreplyEpisodes.endedAt)))
    .orderBy(desc(rzNoreplyEpisodes.startedAt))
    .limit(1);
  if (open && Math.abs(open.startedAt.getTime() - since.getTime()) <= SAME_EPISODE_MS) {
    await db
      .update(rzNoreplyEpisodes)
      .set({ lastSeenAt: now })
      .where(eq(rzNoreplyEpisodes.id, open.id));
    return;
  }
  if (open) {
    // 풀림 보고 없이 다른 시작 시각 — 에이전트가 재시작해 다시 감지한 경우 등.
    //   끝은 "마지막으로 그 상태를 본 때"로 둔다. now 로 두면 꺼져 있던 시간까지 구간에 들어간다.
    await db
      .update(rzNoreplyEpisodes)
      .set({ endedAt: sql`${rzNoreplyEpisodes.lastSeenAt}`, endReason: "replaced" })
      .where(and(eq(rzNoreplyEpisodes.customerId, customerId), isNull(rzNoreplyEpisodes.endedAt)));
  }
  await db.insert(rzNoreplyEpisodes).values({
    tenantId,
    customerId,
    startedAt: since,
    lastSeenAt: now,
  });
}

export type RzHistoryItem =
  | {
      kind: "noreply";
      at: Date;
      lastSeenAt: Date;
      endedAt: Date | null;
      endReason: string | null;
    }
  | {
      kind: "relay";
      at: Date;
      consumedAt: Date | null;
      rejectedReason: string | null;
      requestedBy: string | null;
    };

/** 한 거래처의 최근 30일 이력 — 최신순. tenantId 로 한 번 더 격리한다. */
export async function listRzHistory(
  tenantId: string,
  customerId: string,
  limit = 40,
): Promise<RzHistoryItem[]> {
  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 3600_000);
  const [eps, reqs] = await Promise.all([
    db
      .select()
      .from(rzNoreplyEpisodes)
      .where(
        and(
          eq(rzNoreplyEpisodes.tenantId, tenantId),
          eq(rzNoreplyEpisodes.customerId, customerId),
          gt(rzNoreplyEpisodes.lastSeenAt, since),
        ),
      )
      .orderBy(desc(rzNoreplyEpisodes.startedAt))
      .limit(limit),
    db
      .select({
        createdAt: rzRelayRequests.createdAt,
        consumedAt: rzRelayRequests.consumedAt,
        rejectedReason: rzRelayRequests.rejectedReason,
        requestedBy: users.displayName,
      })
      .from(rzRelayRequests)
      .leftJoin(users, eq(users.id, rzRelayRequests.requestedBy))
      .where(
        and(
          eq(rzRelayRequests.tenantId, tenantId),
          eq(rzRelayRequests.customerId, customerId),
          gt(rzRelayRequests.createdAt, since),
        ),
      )
      .orderBy(desc(rzRelayRequests.createdAt))
      .limit(limit),
  ]);
  const items: RzHistoryItem[] = [
    ...eps.map((e) => ({
      kind: "noreply" as const,
      at: e.startedAt,
      lastSeenAt: e.lastSeenAt,
      endedAt: e.endedAt,
      endReason: e.endReason,
    })),
    ...reqs.map((r) => ({
      kind: "relay" as const,
      at: r.createdAt,
      consumedAt: r.consumedAt,
      rejectedReason: r.rejectedReason,
      requestedBy: r.requestedBy,
    })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
