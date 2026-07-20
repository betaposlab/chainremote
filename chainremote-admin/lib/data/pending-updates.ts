// 거래처 PC 푸시 업데이트 데이터 레이어 (마이그레이션 009, 2026-05-29).
//
// Pull 모델 — NAS 가 Agent 에게 신호를 쏘지 않는다. Agent 가 자기 페이스(5분)로 폴링하고,
// 관리 패널은 INSERT 만 한다. 거래처가 자기 행을 발견 → 영업시간 가드 통과 → 사일런트 설치 → markApplied.
//
// 모든 함수 tenantId 격리 강제. agent 폴링은 remote_id + heartbeat_token 으로 customer 매칭 후 호출.

import { and, eq, inArray, isNull, sql, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { pendingUpdates, customers } from "@/lib/schema";
import type { AgentPushMeta } from "@/lib/agent-push-meta";
import { hashHeartbeatToken } from "@/lib/heartbeat-token";

export interface PushAsset {
  targetVersion: string;
  assetUrl: string;
  assetSha256: string;
  assetSize: number;
}

export interface PushOptions {
  windowStartHour?: number;  // 기본 0 (자정)
  windowEndHour?: number;    // 기본 7 (아침 7시)
  randomizeMaxSec?: number;  // 기본 600(10분). 2026-06-20 7h→10분
}

const DEFAULT_OPTIONS: Required<PushOptions> = {
  windowStartHour: 0,
  windowEndHour: 7,
  // 2026-06-20: 7시간(25200)→10분(600). 옛 7h 기본이 적용을 0~7h 로 흩뿌려 "버전 제멋대로"로
  //   보였다. 소규모(수십대)는 즉시성 우선. 수백~수천대 푸시는 UI 에서 늘릴 것.
  randomizeMaxSec: 600,
};

/**
 * 단일 거래처 푸시. 같은 거래처·같은 버전이 이미 대기 중이면 conflict 로 skip.
 * 생성된 행 반환, skip 이면 null.
 */
export async function pushToCustomer(
  customerId: string,
  asset: PushAsset,
  opts: PushOptions,
  ctx: { tenantId: string; requestedBy: string },
): Promise<{ id: string } | null> {
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  // tenant 격리 — customer 가 정말 이 tenant 소속인지 확인.
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
    // partial unique index 충돌 = 이미 대기 중 → skip.
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) return null;
    throw e;
  }
}

/**
 * 일괄 푸시 — tenant 의 활성 거래처 전체에 N행 INSERT, 같은 bulk_batch_id 로 묶는다.
 * 이미 대기 중인 거래처는 partial unique 가 막아 skip. 신규 INSERT 된 행 수 반환.
 */
export async function pushBulk(
  asset: PushAsset,
  opts: PushOptions,
  ctx: { tenantId: string; requestedBy: string },
): Promise<{ bulkBatchId: string; inserted: number; eligible: number }> {
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  const bulkBatchId = crypto.randomUUID();

  // 2026-06-20: 새 일괄푸시는 이전 대기 행을 supersede 한다. 전엔 새 버전만 INSERT 해서
  //   (customer_id, target_version) 이 다른 옛 대기(1.4.20/1.4.28...)가 쌓여 패널이 "대기 버전
  //   제각각"으로 보였다. 에이전트는 최신 1건만 집어가(getPendingForAgent: desc createdAt) 옛 행이
  //   기능상 무해하지만, 상태를 깨끗이 하려고 푸시 직전 이 tenant 의 활성 외부 거래처 대기 행
  //   (미적용·미취소·미실패)을 전부 취소한다. applied/failed 는 이력이라 건드리지 않고, 취소 대상은
  //   아래 INSERT 대상과 같은 거래처 집합이다.
  await db.execute(sql`
    UPDATE pending_updates SET cancelled_at = now(), updated_at = now()
    WHERE tenant_id = ${ctx.tenantId}::uuid
      AND applied_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL
      AND customer_id IN (
        SELECT id FROM customers
        WHERE tenant_id = ${ctx.tenantId}::uuid AND is_active = true AND is_internal = false
      )
  `);

  // 2026-06-02: 스케일 대비로 행별 루프 → 단일 bulk INSERT 로 교체. 활성 거래처 전체를 1쿼리로
  //   넣는다. 같은 (customer_id, target_version) 대기 행이 있으면 partial unique index
  //   uq_pending_updates_customer_version_active (= UNIQUE (customer_id, target_version)
  //   WHERE applied/cancelled/failed 모두 NULL) 가 잡아 ON CONFLICT DO NOTHING 으로 skip.
  //   거래처가 1만이어도 쿼리는 1번.
  const result = await db.execute(sql`
    INSERT INTO pending_updates
      (tenant_id, customer_id, target_version, asset_url, asset_sha256, asset_size,
       window_start_hour, window_end_hour, randomize_max_sec, bulk_batch_id, requested_by)
    SELECT ${ctx.tenantId}::uuid, c.id, ${asset.targetVersion}::text, ${asset.assetUrl}::text,
           ${asset.assetSha256}::text, ${asset.assetSize}::int, ${merged.windowStartHour}::int,
           ${merged.windowEndHour}::int, ${merged.randomizeMaxSec}::int,
           ${bulkBatchId}::uuid, ${ctx.requestedBy}::uuid
    FROM customers c
    WHERE c.tenant_id = ${ctx.tenantId}::uuid AND c.is_active = true
      AND c.is_internal = false  -- 내부 기기(본사/Mac/빌드머신, 마이그 013) 제외
      -- 2026-06-29: pending(미확정 후보)도 업뎃 대상. 자가등록된 진짜 에이전트라 확정 여부와
      --   무관하게 최신을 유지해야 한다. '확인'은 과금/명명/관리용일 뿐 업뎃 게이트가 아니다.
      --   대리점이 패널 관리를 안 하는 게 현실 → 확정 안 해도 모든 거래처 자동 업뎃(Chang 합의).
      AND c.enroll_status IN ('active', 'pending')
    ON CONFLICT (customer_id, target_version)
      WHERE (applied_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL)
      DO NOTHING
    RETURNING customer_id
  `);
  const inserted = (result as unknown as { rows: unknown[] }).rows.length;

  // 활성 거래처 총수 — "신규 N / 대상 M" 표시용.
  const [eligibleRow] = await db
    .select({ cnt: count() })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, ctx.tenantId),
        eq(customers.isActive, true),
        eq(customers.isInternal, false),
        // pending 포함 — 위 INSERT 와 동일 집합.
        inArray(customers.enrollStatus, ["active", "pending"]),
      ),
    );

  return { bulkBatchId, inserted, eligible: Number(eligibleRow?.cnt ?? 0) };
}

/**
 * Agent 폴링용 — 그 거래처의 대기 중 푸시 최신 1건(없으면 null).
 * remote_id + token 으로 customer 를 찾고 그 customer 의 미완료 pending 1건을 낸다.
 * customer join 자체가 tenant 경계라 별도 tenantId 인자가 필요 없다.
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
        eq(customers.heartbeatToken, hashHeartbeatToken(token)), // 저장은 해시라 대조도 해시
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
 * Agent 의 설치 완료 보고 — id + (remote_id + token) 정합성 확인 후 applied_at 을 채운다.
 * 실패 보고는 markFailed.
 */
export async function markApplied(
  pushId: string,
  remoteId: string,
  token: string,
): Promise<boolean> {
  // 정합성 — 이 push 가 정말 이 token 의 customer 것인지.
  const owns = await db
    .select({ id: pendingUpdates.id })
    .from(pendingUpdates)
    .innerJoin(customers, eq(customers.id, pendingUpdates.customerId))
    .where(
      and(
        eq(pendingUpdates.id, pushId),
        eq(customers.remoteId, remoteId),
        eq(customers.heartbeatToken, hashHeartbeatToken(token)), // 저장은 해시라 대조도 해시
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
        eq(customers.heartbeatToken, hashHeartbeatToken(token)), // 저장은 해시라 대조도 해시
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

/** 관리 패널 — 단일 푸시 취소. 대기 중인 것만 취소 가능. */
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

/** 일괄 푸시 취소 — bulk_batch_id 의 대기 행 전부 cancelled 로. */
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

/** 관리 패널 — 일괄 진행률 ("v1.3.5 적용 1847/2000"). */
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
 * 관리 패널 거래처 표 — 거래처마다 대기 중 푸시 1건을 left join.
 * "대기 중" 배지 + 타겟 버전을 표에 노출하기 위한 것.
 */
export async function listCustomersWithPending(tenantId: string) {
  // leftJoin 이라 거래처당 0~1 pending → 거래처 N 개면 N 행. applied/cancelled/failed 가 다 NULL 인 것만.
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

  // partial unique 덕에 이론상 중복은 없지만 안전하게 한 번 더 dedupe.
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

/** "1.4.62" vs "1.4.54" 숫자 점 비교 — a 가 b 보다 새 버전이면 true. 파싱 불가 자리는 0. */
export function isVersionNewer(a: string, b: string): boolean {
  const pa = a.trim().split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.trim().split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

/**
 * 자동 롤아웃(2026-07-20) — heartbeat 가 구버전을 보고하면 그 자리에서 업데이트를 큐잉한다.
 * 종전엔 큐 생성 경로가 패널 푸시 버튼뿐이라 "대리점마다 사람이 눌러야" 했다(50개 대리점이면
 * 릴리즈마다 50통 전화). 이제 릴리즈(agent-push.json 갱신) 자체가 전 대리점 롤아웃 트리거다.
 *
 * 안전핀:
 *  - 내부기기 제외, 같은 (거래처, 목표버전) 조합은 상태 불문 1회만 — applied 됐는데도 구버전
 *    보고(brick 의심)·cancelled(사람이 거부)·failed 를 자동으로 다시 두들기지 않는다(사람 몫).
 *  - agent-push.json 의 "auto_rollout": false 로 전체 일시정지 가능(비상 킬스위치).
 *  - 어떤 실패도 heartbeat 를 깨지 않는다(전부 삼킴).
 */
export async function autoQueueIfBehind(
  customer: { id: string; tenantId: string; isInternal: boolean },
  reportedVersion: string,
  meta: AgentPushMeta | null,
): Promise<boolean> {
  try {
    if (!meta || !meta.autoRollout) return false;
    if (customer.isInternal || !reportedVersion.trim()) return false;
    if (!isVersionNewer(meta.version, reportedVersion)) return false;
    const [existing] = await db
      .select({ id: pendingUpdates.id })
      .from(pendingUpdates)
      .where(
        and(
          eq(pendingUpdates.customerId, customer.id),
          eq(pendingUpdates.targetVersion, meta.version),
        ),
      )
      .limit(1);
    if (existing) return false;
    await db.insert(pendingUpdates).values({
      tenantId: customer.tenantId,
      customerId: customer.id,
      targetVersion: meta.version,
      assetUrl: meta.url,
      assetSha256: meta.sha256,
      assetSize: meta.size,
      // 당일 적용(0~24시) + 1시간 랜덤 분산 — 릴리즈 직후 전 플릿이 NAS 를 동시에 두들기지 않게.
      windowStartHour: 0,
      windowEndHour: 24,
      randomizeMaxSec: 3600,
      requestedBy: null, // 자동 — 사람 아님
    });
    return true;
  } catch {
    return false;
  }
}
