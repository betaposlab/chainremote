-- 026: 거래처 폴더(그룹) — 같은 매장의 여러 POS를 수동으로 한 폴더에 묶는다.
-- 사용자 결정(2026-07-22): 이름 접두 자동 그룹핑이 아니라, 운영자가 폴더를 만들고
-- 거래처를 직접 배정한다(엉뚱한 그룹핑 방지). HQ 는 folder 를 device_group_name 으로
-- 받아 기존 폴더 접기/펼치기 UI 로 표시.
--
-- 멱등(재실행 안전): CREATE TABLE/INDEX/COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 같은 대리점(tenant) 안에서 폴더 이름은 유일(중복 폴더 방지).
CREATE UNIQUE INDEX IF NOT EXISTS uq_folders_tenant_name ON folders (tenant_id, name);

-- 거래처 → 폴더(nullable). 폴더 삭제 시 거래처는 "폴더 없음"으로 남는다(SET NULL).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS folder_id uuid
  REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_folder ON customers (folder_id);
