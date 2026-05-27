-- 007: 거래처 heartbeat — 거래처 (agent) 가 NAS 에 자기 status 주기적 보고.
-- 사업화 가치: 관리 패널 / 본사 앱 에서 "거래처 마지막 접속 + 버전" 가시화.
-- 코이노 대비 차별 — 영업 자료로도 활용.
--
-- 모든 컬럼 nullable. 기존 거래처 데이터 무영향 (lazy 채워짐).
-- heartbeat_token: 거래처별 random secret. 자가 발급 + 1회 제약 (NULL 일 때만 INSERT).
--   사업화 초기 보안 모델. 매출 후 인스톨러 토큰 박기 / OAuth-like 로 강화 검토.

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_version text,
    ADD COLUMN IF NOT EXISTS heartbeat_token text;

-- 토큰 unique 보장 — 누구나 다른 토큰. 충돌 시 register 실패.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_heartbeat_token
    ON customers (heartbeat_token)
    WHERE heartbeat_token IS NOT NULL;

-- heartbeat 조회는 remote_id 로. 인덱스 이미 있는지 확인.
-- (없으면 추가 — 기존 idx_customers_tenant 만 있으므로 remote_id 단독 인덱스 필요)
CREATE INDEX IF NOT EXISTS idx_customers_remote_id
    ON customers (remote_id)
    WHERE remote_id IS NOT NULL;
