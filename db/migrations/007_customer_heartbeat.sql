-- 007: 거래처 heartbeat — agent 가 NAS 에 자기 status 를 주기적으로 보고.
-- 관리 패널 / 본사 앱에서 거래처 마지막 접속 + 버전을 가시화한다(영업 자료로도 쓴다).
--
-- 컬럼은 전부 nullable — 기존 거래처 데이터에 영향 없이 lazy 하게 채워진다.
-- heartbeat_token 은 거래처별 random secret. 자가 발급하되 NULL 일 때만 INSERT 라 1회 제약이 걸린다.
--   초기 보안 모델이고, 이후 인스톨러에 토큰 박기 / OAuth-like 로 강화하는 걸 검토한다.

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_version text,
    ADD COLUMN IF NOT EXISTS heartbeat_token text;

-- 토큰 unique 보장 — 거래처마다 다른 토큰. 충돌하면 register 실패.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_heartbeat_token
    ON customers (heartbeat_token)
    WHERE heartbeat_token IS NOT NULL;

-- heartbeat 조회는 remote_id 단독으로 하므로 전용 인덱스가 필요하다(기존엔 idx_customers_tenant 뿐).
CREATE INDEX IF NOT EXISTS idx_customers_remote_id
    ON customers (remote_id)
    WHERE remote_id IS NOT NULL;
