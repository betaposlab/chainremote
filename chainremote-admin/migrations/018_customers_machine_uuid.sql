-- 018: 거래처 기기지문 앵커 (machine_uuid)
--
-- 거래처를 "바뀌는 remote_id" 가 아니라 "안정적 기기지문(machine_uid = Windows MachineGuid 등)" 에도
-- 묶는다. ID 가 충돌(UUID_MISMATCH→update_id)·랜카드교체로 바뀌어도, 패널이 machine_uuid 로 같은
-- 거래처를 알아보고 remote_id 만 갱신 → 상호·담당·즐겨찾기가 따라온다 (Chang 핵심요구).
--
-- nullable: 옛 거래처 + 지문 못 읽는 기기(빈값)는 NULL. partial unique 로 한 기기=한 거래처(테넌트 내)
-- 강제하되 빈/NULL 은 제외(지문 불량 기기끼리 오매칭 방지 = 폴백 안전장치의 DB 측).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS machine_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_machine_uuid
  ON customers (tenant_id, machine_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_machine_uuid
  ON customers (tenant_id, machine_uuid)
  WHERE machine_uuid IS NOT NULL AND machine_uuid <> '';
