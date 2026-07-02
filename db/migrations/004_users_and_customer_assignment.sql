-- ChainRemote 마이그레이션 004 — multi-user 인증 + 거래처 담당자
--
-- customers 에 assigned_user_id(담당 직원 표시용)를 추가한다. 기존 거래처의 chang 할당,
-- 사용자 시드는 별도 SQL(006_seed_initial_users.sql)에서 처리한다.
--
-- 정책:
--   - 같은 tenant 안에서는 모든 user 가 모든 customer 를 보고 원격 가능(사내 운영 정책).
--   - assigned_user_id 는 "누가 영업했는지 / 주담당" 표시일 뿐 접근 격리는 아니다.
--   - user 별 필터 격리는 SaaS 판매 시점에 도입한다.

BEGIN;

-- 1. customers 테이블에 assigned_user_id 컬럼 추가
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- 인덱스: 담당자별 거래처 조회용 (UI 의 "내 거래처만 보기" 토글)
CREATE INDEX IF NOT EXISTS idx_customers_assigned_user ON customers(tenant_id, assigned_user_id);

COMMIT;
