-- 002 지원기록 워크플로우 + RustDesk 브랜드 잔재 청소 (DB 컬럼명 레벨)
--   customers.rustdesk_id → remote_id
--   support_sessions.rustdesk_id → remote_id
--   종료 안 된 세션 빠른 조회용 부분 인덱스 추가

ALTER TABLE customers RENAME COLUMN rustdesk_id TO remote_id;
ALTER TABLE support_sessions RENAME COLUMN rustdesk_id TO remote_id;

-- 거래처별 진행 중 세션 1행만 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON support_sessions (tenant_id, customer_id)
  WHERE ended_at IS NULL;
