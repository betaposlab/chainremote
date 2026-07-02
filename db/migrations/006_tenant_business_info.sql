-- 006_tenant_business_info.sql
--
-- tenants 에 사업자 정보 + 구독/요금 컬럼을 추가하고 super_admin role 을 도입한다.
-- 사업화(SaaS 멀티테넌트) 1단계 — Chang 이 신규 대리점을 등록할 때
-- 사업자등록증/통장사본/연락처/요금 정보를 한 row 에 담는다.
--
-- 정책:
--   - 추가 컬럼은 전부 NULLable — 기존 betaposlab row 가 깨지지 않게. 필수 검증은 등록 폼에서.
--   - monthly_fee_krw 는 부가세 별도(공급가액). 청구서/UI 에서 VAT 10% 를 얹어 계산한다.
--   - subscription_status, payment_method 는 enum 대신 CHECK constraint 로 단순화.
--   - user_role enum 에 'super_admin' 추가. Postgres 는 ALTER TYPE ADD VALUE 를 같은
--     트랜잭션 안에서 쓰지 못하므로 COMMIT 을 분리한다.
--
-- 적용 후 별도 트랜잭션에서 수동 실행:
--   UPDATE users SET role='super_admin' WHERE email='chang';
--
-- 관련: chainremote-admin/lib/schema.ts (Drizzle 스키마 동기화 필요)

BEGIN;

-- 1. 사업자 정보 (사업자등록증 기준)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_no TEXT;             -- 사업자등록번호
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS representative_name TEXT;     -- 대표자명
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_address TEXT;        -- 사업장 주소
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_type TEXT;           -- 업태 (예: 서비스업)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS business_item TEXT;           -- 종목 (예: POS 유지보수)

-- 2. 연락처
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS company_phone TEXT;           -- 회사 전화
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS representative_phone TEXT;    -- 대표자 휴대폰
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT;           -- 담당자 휴대폰

-- 3. 결제 계좌(통장사본 기준)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_name TEXT;               -- 은행
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_account TEXT;            -- 계좌번호
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bank_holder TEXT;             -- 예금주

-- 4. 구독/요금
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS monthly_fee_krw INTEGER;      -- 월정액 (원, 부가세 별도 = 공급가액)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_day SMALLINT;         -- 매월 결제일 (1~31)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notes TEXT;                   -- 비고

-- 5. CHECK constraint — ADD CONSTRAINT 는 IF NOT EXISTS 를 지원 안 하므로 pg_constraint 로 존재 확인 후 추가
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_subscription_status_chk') THEN
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE tenants ADD CONSTRAINT tenants_subscription_status_chk
      CHECK (subscription_status IN ('active','suspended','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_payment_method_chk') THEN
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_method TEXT;
    ALTER TABLE tenants ADD CONSTRAINT tenants_payment_method_chk
      CHECK (payment_method IS NULL OR payment_method IN ('cms','bank_transfer','credit_card'));
  END IF;
END $$;

COMMIT;

-- 6. user_role enum 에 super_admin 추가 (별도 트랜잭션 — 새 enum 값은 같은 트랜잭션 안에서 못 씀)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';

-- 7. 위 ALTER TYPE 가 commit 된 다음 별도 세션에서 수동 실행:
--    UPDATE users SET role='super_admin' WHERE email='chang';
