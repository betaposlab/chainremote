// 거래처 PC 푸시 업데이트 데이터 레이어 (마이그레이션 009, 2026-05-29).
//
// Pull 모델 — NAS 가 Agent 에게 신호를 쏘지 않는다. Agent 가 자기 페이스(5분)로 폴링하고,
// 관리 패널은 INSERT 만 한다. 거래처가 자기 행을 발견 → 영업시간 가드 통과 → 사일런트 설치 → markApplied.
//
// 모든 함수 tenantId 격리 강제. agent 폴링은 remote_id + heartbeat_token 으로 customer 매칭 후 호출.

import { and, eq, inArray, isNull, isNotNull, sql, desc, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { pendingUpdates, customers } from "@/lib/schema";
import { getAgentPushMetaCached, type AgentPushMeta } from "@/lib/agent-push-meta";
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

/** 푸시 입력이 잘못됐을 때 — 라우트/액션이 사람에게 그대로 보여 준다. */
export class PushValidationError extends Error {}

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

/**
 * 푸시 값 검증 — **여기 한 곳**에서만 한다(A1-2·A1-3, 2026-08-16).
 *
 * 왜 서버가 막아야 하나: 에이전트의 `PendingResponse` 는 시각·지연을 부호 없는 정수로 받는다.
 * 음수나 범위 밖 값이 내려가면 JSON 파싱이 **통째로** 실패해 5분마다 같은 실패를 반복하고,
 * 실패 보고조차 못 하므로 그 행은 영원히 "대기"로 남는다. 게다가 사람이 건 pending 이 있으면
 * 자동 롤아웃까지 침묵하므로(manualPin 가드) **그 거래처는 업데이트가 통째로 멎는다.**
 * 화면에 아무 이상이 안 보이는 종류라 서버에서 애초에 못 들어가게 막는 게 유일한 방어다.
 *
 * `start === end` 도 같은 이유로 막는다 — 에이전트의 창은 [start, end) 라 빈 구간이 되어
 * 영업시간이 영원히 안 열린다(대기 영구, 보고 없음).
 */
function validatePush(asset: PushAsset, opts: Required<PushOptions>): void {
  if (!VERSION_RE.test(asset.targetVersion))
    throw new PushValidationError("버전 형식이 잘못됐습니다 (예: 1.4.132)");
  if (!/^https?:\/\//i.test(asset.assetUrl))
    throw new PushValidationError("설치파일 주소가 잘못됐습니다");
  if (!SHA256_RE.test(asset.assetSha256))
    throw new PushValidationError("sha256 은 64자리 16진수여야 합니다");
  if (!Number.isInteger(asset.assetSize) || asset.assetSize <= 0)
    throw new PushValidationError("설치파일 크기가 잘못됐습니다");
  for (const [label, v] of [
    ["시작 시각", opts.windowStartHour],
    ["종료 시각", opts.windowEndHour],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 24)
      throw new PushValidationError(`${label}은 0~24 사이 정수여야 합니다`);
  }
  if (opts.windowStartHour === opts.windowEndHour)
    throw new PushValidationError(
      "시작과 종료 시각이 같으면 업데이트 창이 열리지 않습니다 (예: 0시~7시)",
    );
  if (
    !Number.isInteger(opts.randomizeMaxSec) ||
    opts.randomizeMaxSec < 0 ||
    opts.randomizeMaxSec > 86400
  )
    throw new PushValidationError("분산 시간은 0~86400초 사이여야 합니다");
}

/** "1.4.9" < "1.4.10" — 자릿수 비교(문자열 비교 아님). 형식이 아니면 null. */
function parseVer(v: string | null | undefined): number[] | null {
  if (!v || !VERSION_RE.test(v.trim())) return null;
  return v.trim().split(".").map(Number);
}

/** a < b 인가. 둘 중 하나라도 형식 밖이면 판단 보류(false). */
function isOlder(a: number[] | null, b: number[] | null): boolean {
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

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
  validatePush(asset, merged);
  // tenant 격리 — customer 가 정말 이 tenant 소속인지 확인.
  const owned = await db
    .select({ id: customers.id, lastVersion: customers.lastVersion })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, ctx.tenantId)))
    .limit(1);
  if (owned.length === 0) return null;
  // 다운그레이드 거부(A1-1) — 에이전트는 현재보다 낮은 버전이면 설치하지 않고 "이미 최신"으로
  //   applied 를 보낸다. 그럼 패널엔 초록 "적용됨"이 뜨는데 거래처 PC 는 아무 일도 안 일어난다.
  //   ★같은 버전 재푸시는 막지 않는다 — 설치가 깨진 기기를 같은 버전으로 되살리는 복구 경로다.
  if (isOlder(parseVer(asset.targetVersion), parseVer(owned[0].lastVersion))) {
    throw new PushValidationError(
      `이 거래처는 이미 더 높은 버전(${owned[0].lastVersion})입니다. 에이전트는 낮은 버전을 설치하지 않습니다.`,
    );
  }

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
  ctx: { tenantId: string; requestedBy: string; allowStaging?: boolean },
): Promise<{ bulkBatchId: string; inserted: number; eligible: number }> {
  const merged = { ...DEFAULT_OPTIONS, ...opts };
  validatePush(asset, merged);
  // ★검증 안 끝난 스테이징 버전을 플릿 전체에 거는 것을 막는다(2026-08-16 감사 S2-S8).
  //   `auto_rollout:false` 는 자동 롤아웃만 세우는 킬스위치라 [푸시] 버튼은 그대로 동작한다
  //   — 단건은 그게 맞다(실기기 검증이 그 경로다). 하지만 **일괄**은 다르다: 실물 확인 전
  //   빌드가 거래처 전체에 깔리면 되돌릴 방법이 방문뿐이다.
  //   정상 발행 순서(검증 → AUTO_ROLLOUT=1 로 발행 → 일괄 푸시)에서는 이 시점에 이미
  //   auto_rollout 이 true 라 이 가드에 걸리지 않는다. 걸린다면 순서를 건너뛴 것이다.
  if (ctx.allowStaging !== true) {
    const meta = await getAgentPushMetaCached();
    if (meta && meta.version === asset.targetVersion && !meta.autoRollout) {
      throw new PushValidationError(
        `v${asset.targetVersion} 은 아직 검증이 끝나지 않은 스테이징 버전입니다. ` +
          `실기기 확인을 마친 뒤 AUTO_ROLLOUT=1 로 다시 발행하고 일괄 푸시하세요. ` +
          `(한 대만 확인하려면 거래처 행의 [푸시] 를 쓰세요.)`,
      );
    }
  }
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
      -- 이미 더 높은 버전인 기기는 제외(A1-1) — 넣어 봐야 에이전트가 무동작 applied 를
      --   보내 패널만 "적용됨"으로 물들고, 그 무동작이 다운그레이드 복귀 재큐잉 한도까지
      --   깎아먹는다. 형식이 x.y.z 가 아닌 옛 보고는 판단을 보류하고 대상에 남긴다.
      AND (
        c.last_version IS NULL
        OR c.last_version !~ '^[0-9]+\\.[0-9]+\\.[0-9]+$'
        OR string_to_array(c.last_version, '.')::int[]
           <= string_to_array(${asset.targetVersion}::text, '.')::int[]
      )
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
  if (result.length > 0) return true;
  // 이미 applied 인 행에 같은 보고가 또 왔다면 성공으로 친다(A1-5, 멱등).
  //   에이전트는 보고가 서버에 닿았는지 응답으로만 아는데, 응답이 유실되면 저장해 뒀다가
  //   5분마다 재전송한다. 종전엔 그게 계속 403 이라 재전송 슬롯이 영원히 안 비워졌다.
  const [already] = await db
    .select({ appliedAt: pendingUpdates.appliedAt })
    .from(pendingUpdates)
    .where(eq(pendingUpdates.id, pushId))
    .limit(1);
  return !!already?.appliedAt;
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
  if (result.length > 0) return true;
  // 같은 실패 재보고도 멱등(A1-5).
  const [already] = await db
    .select({ failedAt: pendingUpdates.failedAt })
    .from(pendingUpdates)
    .where(eq(pendingUpdates.id, pushId))
    .limit(1);
  return !!already?.failedAt;
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
      // 한 행에 두 상태가 겹칠 수 있다(A1-6): pull 모델이라 취소한 뒤에도 이미 내려받은
      //   에이전트는 설치하고 applied 를 보낸다 — 막을 방법이 없고 그게 정상이다. 종전엔
      //   상태별로 따로 세어 pending 이 음수로 나왔다. 우선순위(applied > failed > cancelled)로
      //   배타 집계해 합이 total 을 넘지 않게 한다.
      applied: sql<number>`count(*) filter (where ${pendingUpdates.appliedAt} is not null)`,
      failed: sql<number>`count(*) filter (where ${pendingUpdates.appliedAt} is null and ${pendingUpdates.failedAt} is not null)`,
      cancelled: sql<number>`count(*) filter (where ${pendingUpdates.appliedAt} is null and ${pendingUpdates.failedAt} is null and ${pendingUpdates.cancelledAt} is not null)`,
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
  return {
    total,
    applied,
    cancelled,
    failed,
    pending: Math.max(0, total - applied - cancelled - failed),
  };
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
 *  - 내부기기 제외. cancelled(사람이 거부)·failed(설치 실패)가 한 번이라도 있으면 자동은
 *    영원히 침묵한다(사람 몫).
 *  - ★applied 인데 구버전 보고 = 다운그레이드/재설치 복귀로 판정하고 **딱 1회** 재큐잉한다
 *    (2026-08-05 테스트1 실검증에서 발견 — 1.4.84 재설치 후 서버가 "이미 적용됨"만 믿고
 *    영영 안 끌어올렸다). brick 과 혼동되지 않는 근거: applied_at 은 에이전트의 설치 완료
 *    보고(markApplied)로만 찍히므로, applied 후 구버전 보고는 새 버전을 완주하고 되돌아간
 *    기기다. brick 은 완료 보고를 못 보내 row 가 pending 으로 남는다. 재큐잉 1회 한도라
 *    또 내려가면(반복 실험 등) 그때부턴 사람 몫 — 무한 되밀기 루프가 원천 차단된다.
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
    // ★비활성·정지 거래처도 자동 롤아웃 대상이다 — pushBulk 와 집합이 다른 건 **의도**다
    //   (정책 확정 2026-07-21: 과금과 무관하게 에이전트는 최신을 유지한다. 재개할 때 이미
    //   최신이라 공백이 없다). 2026-08-16 감사가 이걸 "pushBulk 와 불일치 = 결함"으로 봤지만
    //   test/adv-auto-rollout.test.ts AR-04 · adv-heartbeat-integration HBI-2 가 정책으로
    //   못박아 둔 자리다. 게이트를 넣지 말 것.
    if (!isVersionNewer(meta.version, reportedVersion)) return false;
    // 운영자 수동 핀/롤백(requested_by 있음)이 미완료로 걸려 있으면 자동 큐잉하지 않는다.
    //   에이전트는 desc(createdAt) 최신 1건만 집으므로, 자동 큐가 나중에 얹히면 운영자가 의도적으로
    //   건 핀(핫픽스/이전버전 롤백)을 가려버린다(HBI-3). 사람이 걸어둔 게 있으면 자동은 물러난다.
    //   (자동끼리는 여기서 안 막고 아래 target 중복 가드로만 정리 — 최신 릴리즈가 이전 자동 큐를
    //    지연 없이 얹을 수 있게. 대기 2건 공존은 무해: 에이전트가 최신 1건만 적용.)
    const [manualPin] = await db
      .select({ id: pendingUpdates.id })
      .from(pendingUpdates)
      .where(
        and(
          eq(pendingUpdates.customerId, customer.id),
          isNotNull(pendingUpdates.requestedBy),
          isNull(pendingUpdates.appliedAt),
          isNull(pendingUpdates.cancelledAt),
          isNull(pendingUpdates.failedAt),
        ),
      )
      .limit(1);
    if (manualPin) return false;
    // 같은 (거래처, 목표버전) 기록은 **최신 행의 상태**로 판단한다 — 이력 전체가 아니라.
    //   일괄 푸시가 기존 대기 행을 cancel 하고 새 행을 얹는 교체 흐름을 쓰기 때문에, 오래된
    //   cancelled 는 "사람이 이 기계를 거부했다"가 아니라 북키핑이다(테스트1 실데이터에서
    //   확인). 진짜 사람 거부/설치 실패는 그 뒤에 새 행이 없으니 최신 행으로 남는다.
    const priorRows = await db
      .select({
        appliedAt: pendingUpdates.appliedAt,
        cancelledAt: pendingUpdates.cancelledAt,
        failedAt: pendingUpdates.failedAt,
        createdAt: pendingUpdates.createdAt,
      })
      .from(pendingUpdates)
      .where(
        and(
          eq(pendingUpdates.customerId, customer.id),
          eq(pendingUpdates.targetVersion, meta.version),
        ),
      );
    if (priorRows.length > 0) {
      const latest = [...priorRows].sort(
        (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      )[0];
      // 최신이 대기 중 → 중복 큐잉 불필요 / 최신이 cancelled·failed → 사람 몫, 자동은 침묵.
      if (!latest.appliedAt) return false;
      // 최신이 applied 인데 구버전 보고 = 다운그레이드/재설치 복귀 → 재큐잉.
      //   한도: 같은 target 이 두 번 applied 됐는데 또 내려갔다면 사람 몫(되밀기 루프 차단).
      const appliedCount = priorRows.filter((r) => r.appliedAt).length;
      if (appliedCount >= 2) return false;
    }
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
