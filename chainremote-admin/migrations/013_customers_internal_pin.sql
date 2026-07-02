-- 013: customers 내부 기기 분류 + 상단 고정 순서
--
-- 거래처 목록에 올라온 본사/내 기기(내 맥북·맥미니·우리집=빌드머신·재성이 컴=HQ)는
-- 진짜 거래처(POS/키오스크)가 아니다. 두 컬럼으로 구분한다:
--   is_internal = true  → 일괄 푸시(pushBulk) 제외 + 패널에서 버전/푸시 버튼 숨김.
--   pin_order           → 거래처 표 상단 고정 순서(1=최상단). NULL 이면 그 아래 일반 거래처.
--
-- 값 설정은 별도(앱/psql): 내 맥북=1, 맥미니=2, 우리집=3, 재성이 컴=4, 모두 is_internal=true.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS pin_order  INTEGER;
