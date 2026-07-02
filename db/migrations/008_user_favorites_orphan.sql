-- 008: user_favorites 를 customers 에 없는 머신(HQ workstation, 옵션 B+ 본사 PC 등)도
-- 즐겨찾기할 수 있게 개편 (2026-05-27).
--
-- 변경:
--   - remote_id text NOT NULL — 항상 존재하는 영구 식별자(9자리 ID)를 즐겨찾기 기준으로.
--   - customer_id 는 nullable — customers 에 등록된 경우에만 채운다.
--   - PK 를 customer_id 대신 (user_id, remote_id) 로.
--   - customer_id 인덱스는 유지.
--
-- 절차: 기존 row 는 customer_id 가 채워져 있으므로 customers 조인으로 remote_id 를 백필한 뒤,
--   PK 와 customer_id NOT NULL 제약을 바꾼다.

ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS remote_id text;

-- customer_id → customers.remote_id 매핑으로 remote_id 백필.
UPDATE user_favorites uf
SET remote_id = c.remote_id
FROM customers c
WHERE uf.customer_id = c.id
  AND uf.remote_id IS NULL;

-- remote_id 가 NULL 인 row 제거 — customers 와 FK 가 깨져 있던 불완전 데이터라 손실 영향 미미.
DELETE FROM user_favorites WHERE remote_id IS NULL;

-- 이제 NOT NULL 강제 가능.
ALTER TABLE user_favorites ALTER COLUMN remote_id SET NOT NULL;

-- customer_id 를 nullable 로 — HQ workstation 처럼 customers 에 없는 머신은 NULL.
ALTER TABLE user_favorites ALTER COLUMN customer_id DROP NOT NULL;

-- 옛 PK (user_id, customer_id) 를 새 PK (user_id, remote_id) 로 교체.
ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_pkey;
ALTER TABLE user_favorites ADD PRIMARY KEY (user_id, remote_id);

-- 패널의 "이 거래처를 누가 즐겨찾기했나" lookup 을 위한 remote_id 인덱스.
CREATE INDEX IF NOT EXISTS idx_user_favorites_remote_id
  ON user_favorites (remote_id);
