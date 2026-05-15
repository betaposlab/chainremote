-- ChainRemote 마이그레이션 004 — multi-user 인증 + 거래처 담당자
--
-- 목적:
--   1. customers 에 assigned_user_id (담당 직원 표시용) 추가
--   2. 기존 4 거래처를 chang 사용자에게 할당 (시드 후)
--   3. 시드는 별도 SQL 로 (006_seed_initial_users.sql)
--
-- 정책:
--   - 같은 tenant 내 모든 user 는 모든 customer 를 보고 원격 가능 (사내 운영 정책)
--   - assigned_user_id 는 "누가 영업했는지 / 주담당" 표시일 뿐 격리 X
--   - 향후 SaaS 판매 시점에 격리 정책 (tenant 안에서 user 별 필터) 도입

BEGIN;

-- 1. customers 테이블에 assigned_user_id 컬럼 추가
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 인덱스: 담당자별 거래처 조회용 (UI 의 "내 거래처만 보기" 토글)
CREATE INDEX IF NOT EXISTS idx_customers_assigned_user ON customers(tenant_id, assigned_user_id);

COMMIT;
