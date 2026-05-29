// 거래처 PC 푸시 업데이트 데이터 레이어 (마이그레이션 009, 2026-05-29).
//
// Pull 모델: NAS 가 Agent 에게 신호 안 쏨. Agent 가 자기 페이스(5분)로 폴링.
// 관리 패널은 INSERT 만, 거래처가 자기 행 발견 후 영업시간 가드 통과 → 사일런트 설치 → markApplied.
//
// 모든 함수 tenantId 격리 강제. agent 측 폴링은 remote_id + heartbeat_token 으로 customer 매칭 후 호출.

import { and, eq, isNull, sql, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { pendingUpdates, customers } from "@/lib/schema";

export interface PushAsset {
  targetVersion: string;
  assetUrl: string;
  assetSha256: string;
  assetSize: number;
}

export interface PushOptions {
  windowStartHour?: number;  // default 0 (자정)
  windowEndHour?: number;    // default 7 (아침 7시)
  randomizeMaxSec?: number;  // default 25200 (7시간 창)
}

const DEFAULT_OPTIONS: Required<PushOptions> = {
  windowStartHour: 0,
  windowEndHour: 7,
  randomizeMaxSec: 25200,
};

/**
 * 단일 거래처 푸시. 동일 거래처 동일 버전 대기 중 행 있으면 conflict 로 skip.
 * 반환: 생성된 행 (skip 시 null).
 */
export async function pushToCustomer(
  customerId: string,
  asset: PushAsset,
  opts: PushOptions,
  ctx: { tenantId: string; requestedBy: string },
): Promise<{ id: string } | null> {
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  // tenant 격리 확인 — customer 가 진짜 이 tenant 인지.
  const owned = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, ctx.tenantId)))
    .limit(1);
  if (owned.length === 0) return null;

  try {
    const [row] = await db
      .insert(pendingUpdates)
      .values({
        tenantId: ctx.tenantId,
        customerId,
        targetVersion: asset.targetVersion,
        assetUrl: asset.assetUrl,
        assetSha256: asset.assetSha256,
        assetSize: asset.assetSize,
        windowStartHour: merged.windowStartHour,
        windowEndHour: merged.windowEndHour,
        randomizeMaxSec: merged.randomizeMaxSec,
        requestedBy: ctx.requestedBy,
      })
      .returning({ id: pendingUpdates.id });
    return row;
  } catch (e) {
    // unique partial index 충돌 = 이미 대기 중. skip.
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) return null;
    throw e;
  }
}

/**
 * 일괄 푸시 — 해당 tenant 의 모든 활성 거래처에 N행 INSERT. 같은 bulk_batch_id 로 묶음.
 * 이미 대기 중인 거래처는 skip (partial unique 가 막음).
 * 반환: 신규 INSERT 된 행 수.
 */
export async function pushBulk(
  asset: PushAsset,
  opts: PushOptions,
  ctx: { tenantId: string; requestedBy: string },
): Promise<{ bulkBatchId: string; inserted: number; eligible: number }> {
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  const bulkBatchId = crypto.randomUUID();

  // 활성 거래처만 (is_active = true).
  const eligibleRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.isActive, true)));

  if (eligibleRows.length === 0) {
    return { bulkBatchId, inserted: 0, eligible: 0 };
  }

  // ON CONFLICT DO NOTHING — partial unique index 가 잡아내도록 raw SQL.
  // drizzle 의 onConflictDoNothing 은 unique constraint 만 인식해서 partial 은 미지원 → try/catch 행별.
  let inserted = 0;
  for (const c of eligibleRows) {
    try {
      await db.insert(pendingUpdates).values({
        tenantId: ctx.tenantId,
        customerId: c.id,
        targetVersion: asset.targetVersion,
        assetUrl: asset.assetUrl,
        assetSha256: asset.assetSha256,
        assetSize: asset.assetSize,
        windowStartHour: merged.windowStartHour,
        windowEndHour: merged.windowEndHour,
        randomizeMaxSec: merged.randomizeMaxSec,
        bulkBatchId,
        requestedBy: ctx.requestedBy,
      });
      inserted++;
    } catch (e) {
      if (e instanceof Error && /duplicate key|unique/i.test(e.message)) continue;
      throw e;
    }
  }

  return { bulkBatchId, inserted, eligible: eligibleRows.length };
}

/**
 * Agent 폴링용 — 특정 거래처의 대기 중 푸시 1건 반환 (있으면).
 * remote_id + token 매칭으로 customer 찾고, 그 customer 의 active pending 1건.
 * tenant 격리는 customers.tenantId 가 결과에 자동 포함.
 */
export async function getPendingForAgent(
  remoteId: string,
  token: string,
): Promise<{
  id: string;
  targetVersion: string;
  assetUrl: string;
  assetSha256: string;
  assetSize: number;
  windowStartHour: number;
  windowEndHour: number;
  randomizeMaxSec: number;
} | null> {
  const rows = await db
    .select({
      id: pendingUpdates.id,
      targetVersion: pendingUpdates.targetVersion,
      assetUrl: pendingUpdates.assetUrl,
      assetSha256: pendingUpdates.assetSha256,
      assetSize: pendingUpdates.assetSize,
      windowStartHour: pendingUpdates.windowStartHour,
      windowEndHour: pendingUpdates.windowEndHour,
      randomizeMaxSec: pendingUpdates.randomizeMaxSec,
    })
    .from(pendingUpdates)
    .innerJoin(customers, eq(customers.id, pendingUpdates.customerId))
    .where(
      and(
        eq(customers.remoteId, remoteId),
        eq(customers.heartbeatToken, token),
        isNull(pendingUpdates.appliedAt),
        isNull(pendingUpdates.cancelledAt),
        isNull(pendingUpdates.failedAt),
      ),
    )
    .orderBy(desc(pendingUpdates.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Agent 가 설치 완료 보고. id + (remote_id + token) 매칭으로 정합성 확인 후 applied_at 채움.
 * 실패 보고는 markFailed.
 */
export async function markApplied(
  pushId: string,
  remoteId: string,
  token: string,
): Promise<boolean> {
  // 정합성 — 이 push 가 이 token 의 customer 것인지.
  const owns = await db
    .select({ id: pendingUpdates.id })
    .from(pendingUpdates)
    .innerJoin(customers, eq(customers.id, pendingUpdates.customerId))
    .where(
      and(
        eq(pendingUpdates.id, pushId),
        eq(customers.remoteId, remoteId),
        eq(customers.heartbeatToken, token),
      ),
    )
    .limit(1);
  if (owns.length === 0) return false;

  const result = await db
    .update(pendingUpdates)
    .set({ appliedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pendingUpdates.id, pushId), isNull(pendingUpdates.appliedAt)))
    .returning({ id: pendingUpdates.id });
  return result.length > 0;
}

export async function markFailed(
  pushId: string,
  remoteId: string,
  token: string,
  reason: string,
): Promise<boolean> {
  const owns = await db
    .select({ id: pendingUpdates.id })
    .from(pendingUpdates)
    .innerJoin(customers, eq(customers.id, pendingUpdates.customerId))
    .where(
      and(
        eq(pendingUpdates.id, pushId),
        eq(customers.remoteId, remoteId),
        eq(customers.heartbeatToken, token),
      ),
    )
    .limit(1);
  if (owns.length === 0) return false;

  const result = await db
    .update(pendingUpdates)
    .set({ failedAt: new Date(), failureReason: reason.slice(0, 1000), updatedAt: new Date() })
    .where(and(eq(pendingUpdates.id, pushId), isNull(pendingUpdates.failedAt)))
    .returning({ id: pendingUpdates.id });
  return result.length > 0;
}

/**
 * 관리 패널 — 푸시 취소. 대기 중인 것만 취소 가능.
 */
export async function cancelPush(
  pushId: string,
  ctx: { tenantId: string },
): Promise<boolean> {
  const result = await db
    .update(pendingUpdates)
    .set({ cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pendingUpdates.id, pushId),
        eq(pendingUpdates.tenantId, ctx.tenantId),
        isNull(pendingUpdates.appliedAt),
        isNull(pendingUpdates.cancelledAt),
        isNull(pendingUpdates.failedAt),
      ),
    )
    .returning({ id: pendingUpdates.id });
  return result.length > 0;
}

/**
 * 일괄 푸시 취소 — bulk_batch_id 의 모든 대기 행을 cancelled.
 */
export async function cancelBulk(
  bulkBatchId: string,
  ctx: { tenantId: string },
): Promise<number> {
  const result = await db
    .update(pendingUpdates)
    .set({ cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pendingUpdates.bulkBatchId, bulkBatchId),
        eq(pendingUpdates.tenantId, ctx.tenantId),
        isNull(pendingUpdates.appliedAt),
        isNull(pendingUpdates.cancelledAt),
        isNull(pendingUpdates.failedAt),
      ),
    )
    .returning({ id: pendingUpdates.id });
  return result.length;
}

/**
 * 관리 패널 — 일괄 진행률 ("v1.3.5 적용 1847/2000").
 */
export async function getBulkProgress(
  bulkBatchId: string,
  ctx: { tenantId: string },
): Promise<{ total: number; applied: number; pending: number; cancelled: number; failed: number }> {
  const rows = await db
    .select({
      total: count(),
      applied: sql<number>`count(*) filter (where ${pendingUpdates.appliedAt} is not null)`,
      cancelled: sql<number>`count(*) filter (where ${pendingUpdates.cancelledAt} is not null)`,
      failed: sql<number>`count(*) filter (where ${pendingUpdates.failedAt} is not null)`,
    })
    .from(pendingUpdates)
    .where(
      and(
        eq(pendingUpdates.bulkBatchId, bulkBatchId),
        eq(pendingUpdates.tenantId, ctx.tenantId),
      ),
    );
  const r = rows[0] ?? { total: 0, applied: 0, cancelled: 0, failed: 0 };
  const total = Number(r.total);
  const applied = Number(r.applied);
  const cancelled = Number(r.cancelled);
  const failed = Number(r.failed);
  return { total, applied, cancelled, failed, pending: total - applied - cancelled - failed };
}

/**
 * 관리 패널 거래처 표 — 거래처별 대기 중 푸시 1건씩 join.
 * customers 와 left join 하여 "대기 중" 배지 + 타겟 버전 가시화.
 */
export async function listCustomersWithPending(tenantId: string) {
  // 거래처 N + active pending 1 = N+0 또는 N+1 행. drizzle 의 leftJoin + filter.
  // partial: applied/cancelled/failed 다 NULL 인 것만.
  const rows = await db
    .select({
      customer: customers,
      pending: {
        id: pendingUpdates.id,
        targetVersion: pendingUpdates.targetVersion,
        bulkBatchId: pendingUpdates.bulkBatchId,
        createdAt: pendingUpdates.createdAt,
      },
    })
    .from(customers)
    .leftJoin(
      pendingUpdates,
      and(
        eq(pendingUpdates.customerId, customers.id),
        isNull(pendingUpdates.appliedAt),
        isNull(pendingUpdates.cancelledAt),
        isNull(pendingUpdates.failedAt),
      ),
    )
    .where(eq(customers.tenantId, tenantId))
    .orderBy(desc(customers.updatedAt));

  // 같은 customer 가 (이론상 partial unique 로) 중복 안 나오지만 안전상 dedupe.
  const seen = new Set<string>();
  const result: typeof rows = [];
  for (const r of rows) {
    if (seen.has(r.customer.id)) continue;
    seen.add(r.customer.id);
    result.push(r);
  }
  return result.map((r) => ({
    ...r.customer,
    pendingUpdate: r.pending && r.pending.id ? r.pending : null,
  }));
}
