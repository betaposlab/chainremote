-- ChainRemote 마이그레이션 005 — 직원별 즐겨찾기 (user × customer)
--
-- 목적:
--   본사 앱에서 "즐겨찾기" 탭은 로그인한 직원 본인의 것만 보임.
--   관리 패널에서는 모든 직원의 즐겨찾기를 모두 조회 가능.
--   기존 RustDesk 로컬 toml(RustDesk_local.toml의 fav: Vec<String>)을 DB로 이관.
--
-- 정책:
--   - 한 직원이 같은 거래처를 두 번 즐겨찾기 불가 → PK (user_id, customer_id)
--   - 사용자/거래처 삭제 시 즐겨찾기 자동 정리 → CASCADE
--   - tenant_id 명시 보관 (다른 테이블과 일관성 + 향후 RLS 도입 대비)

BEGIN;

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id     UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, customer_id)
);

-- 인덱스: 본사 앱의 "내 즐겨찾기 거래처 목록" 조회용
CREATE INDEX IF NOT EXISTS idx_user_favorites_user
  ON user_favorites(user_id);

-- 인덱스: 관리 패널의 "이 거래처를 즐겨찾기한 직원들" 조회용
CREATE INDEX IF NOT EXISTS idx_user_favorites_customer
  ON user_favorites(customer_id);

-- 인덱스: 테넌트 범위 전체 조회 (관리 패널의 직원별 즐겨찾기 표)
CREATE INDEX IF NOT EXISTS idx_user_favorites_tenant
  ON user_favorites(tenant_id);

COMMIT;
