-- 009: 거래처 PC 푸시 업데이트 큐 (2026-05-29, Chang 결정).
--
-- 배경:
--   - 2026-05-28 사고: 옛 latest.json 채널이 v1.3.2 거래처(중앙리) 에게도 단일채널로 적용 →
--     영업시간(12:50PM) 에 인스톨러 마법사 창이 떠 사장님이 본 사고.
--   - 결정: Agent 의 자동 latest.json 폴링 폐지. 본사가 관리 패널에서 "푸시" 클릭 시에만 적용.
--   - 영업시간 가드 (default 00:00~07:00) + 무작위지연 (default 0~7시간 분산) 으로 NAS/회선 부하 분산.
--
-- 모델: Pull. NAS 가 Agent 에게 신호 안 쏨. Agent 가 자기 페이스(5분)로 폴링.
--   → 2000+ 거래처 일괄 푸시해도 NAS 부하 = N개 INSERT 1회.
--
-- 일괄 푸시: bulk_batch_id 로 N행 묶음. 개별 푸시는 bulk_batch_id NULL.
-- 상태: applied_at / cancelled_at / failed_at 셋 다 NULL = 대기 중. 셋 중 1개만 채워짐.

CREATE TABLE IF NOT EXISTS pending_updates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

    -- 타겟 버전 + 인스톨러 자산 (NAS 호스팅 .exe)
    target_version text NOT NULL,
    asset_url text NOT NULL,
    asset_sha256 text NOT NULL,
    asset_size integer NOT NULL,

    -- 영업시간 가드 (시 단위, 0~23). default 00:00~07:00.
    window_start_hour integer NOT NULL DEFAULT 0,
    window_end_hour   integer NOT NULL DEFAULT 7,

    -- 무작위지연 상한 (초). default 25200 = 7시간 창 전체.
    randomize_max_sec integer NOT NULL DEFAULT 25200,

    -- 일괄 그룹 ID. 동일 일괄 푸시의 N행이 같은 UUID. 개별 푸시는 NULL.
    bulk_batch_id uuid,

    -- 푸시 요청자 (관리 패널 로그인 사용자).
    requested_by uuid REFERENCES users(id) ON DELETE SET NULL,

    -- 상태 timestamp. 셋 다 NULL = 대기. 1개만 채워짐.
    applied_at   timestamptz,
    cancelled_at timestamptz,
    failed_at    timestamptz,
    failure_reason text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Agent 폴링 핫패스: (tenant, customer, 미적용 상태) 로 1행 픽업.
-- partial index 로 dead rows 스킵.
CREATE INDEX IF NOT EXISTS idx_pending_updates_customer
    ON pending_updates (tenant_id, customer_id)
    WHERE applied_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL;

-- 일괄 진행률 조회 ("v1.3.5 적용 1847/2000").
CREATE INDEX IF NOT EXISTS idx_pending_updates_bulk
    ON pending_updates (bulk_batch_id)
    WHERE bulk_batch_id IS NOT NULL;

-- 관리 패널 거래처 표의 "대기 중 업데이트 있음" 배지.
CREATE INDEX IF NOT EXISTS idx_pending_updates_tenant_pending
    ON pending_updates (tenant_id)
    WHERE applied_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL;

-- 동일 거래처에 동일 버전 중복 큐 방지. cancelled/failed 후 재시도는 가능 (partial).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_updates_customer_version_active
    ON pending_updates (customer_id, target_version)
    WHERE applied_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL;
