-- 008: user_favorites 가 customers 에 없는 머신(예: HQ workstation, 옵션 B+ 본사 PC) 도
-- 즐겨찾기 가능하도록 스키마 개편 (2026-05-27).
--
-- 변경:
--   1. remote_id text NOT NULL — 영구 식별자(9자리 ID). 항상 존재.
--   2. customer_id nullable — customers 에 등록된 경우에만 채움.
--   3. PK: (user_id, remote_id) — customer_id 대신 remote_id 기준.
--   4. customer_id 인덱스 유지.
--
-- 마이그레이션 전략:
--   기존 row 는 customer_id 가 채워져 있음 → customers 조인 후 remote_id 채움.
--   그 후 PK + customer_id NOT NULL 제약 변경.

ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS remote_id text;

-- 기존 customer_id → customers.remote_id 매핑으로 remote_id 백필.
UPDATE user_favorites uf
SET remote_id = c.remote_id
FROM customers c
WHERE uf.customer_id = c.id
  AND uf.remote_id IS NULL;

-- remote_id 가 NULL 인 row 제거(불완전 데이터, 손실 영향 미미 — customers 와 깨진 FK 였던 row).
DELETE FROM user_favorites WHERE remote_id IS NULL;

-- 이제 NOT NULL 강제 가능.
ALTER TABLE user_favorites ALTER COLUMN remote_id SET NOT NULL;

-- customer_id nullable 로 (HQ workstation 처럼 customers 에 없는 머신은 NULL).
ALTER TABLE user_favorites ALTER COLUMN customer_id DROP NOT NULL;

-- 옛 PK (user_id, customer_id) 제거 후 새 PK (user_id, remote_id).
ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_pkey;
ALTER TABLE user_favorites ADD PRIMARY KEY (user_id, remote_id);

-- remote_id 인덱스 추가 (panel 의 거래처 → 누가 즐겨찾기 했나 lookup 가속).
CREATE INDEX IF NOT EXISTS idx_user_favorites_remote_id
  ON user_favorites (remote_id);
