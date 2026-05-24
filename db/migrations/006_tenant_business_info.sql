-- 006_tenant_business_info.sql
--
-- 목적: tenants 테이블에 사업자 정보 + 구독/요금 컬럼 추가. super_admin role 도입.
-- 배경: 사업화(SaaS 멀티테넌트) 1단계 — Chang 이 신규 대리점(회사) 을 등록할 때
--      사업자등록증/통장사본/연락처/요금 정보를 한 row 에 저장.
--
-- 정책:
--   - 모든 추가 컬럼 NULLable — 기존 betaposlab tenant row 가 깨지지 않게.
--     신규 등록 폼에서 필수 필드 검증.
--   - monthly_fee_krw 는 부가세 별도(공급가액). 청구서/UI 에서 +VAT 10% 자동 계산.
--   - subscription_status 는 CHECK constraint (enum 불사용 — 단순화).
--   - payment_method 도 CHECK constraint (cms/bank_transfer/credit_card).
--   - user_role enum 에 'super_admin' 추가. Postgres 특성상 ALTER TYPE ADD VALUE 는
--     트랜잭션 안에서 사용 불가 → COMMIT 분리.
--
-- 적용 후 수동 1줄 (별도 트랜잭션):
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

-- 5. CHECK constraint (DROP/ADD 패턴 — IF NOT EXISTS 미지원이라 안전하게 동적)
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

-- 6. user_role enum 에 super_admin 추가 (별도 트랜잭션 — Postgres 가 enum 변경을
--    같은 트랜잭션 안에서 사용 못 하게 막음)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';

-- 7. (수동) 위 ALTER TYPE 가 commit 된 다음 별도 세션에서 실행:
--    UPDATE users SET role='super_admin' WHERE email='chang';
