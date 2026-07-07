-- 019: user_favorites.customer_id FK 를 명시적으로 ON DELETE SET NULL 로 못박는다 (2026-07-07).
--
-- 배경: 마이그005 는 customer_id FK 를 ON DELETE CASCADE 로 만들었다. 이후 스키마(lib/schema.ts:173)
-- 는 set null 로 선언됐고 프로덕션 DB 도 set null 로 드리프트돼 있었지만(실 DB 확인), 마이그레이션
-- 파일들은 CASCADE 인 채로 남아 새 DB(재해복구/신규 tenant/테스트 하네스)는 CASCADE 가 됐다.
-- 그러면 거래처 삭제 시 전 직원 즐겨찾기가 조용히 함께 삭제되는 데이터 손실이 난다 —
-- 설계 의도(삭제 후 그 remote_id 가 orphan '신규 거래처 후보'로 되돌아옴, lib/data/favorites.ts
-- dismissOrphanCandidate/linkFavoritesToCustomer 참조)와 정반대. 명시적으로 SET NULL 로 통일한다.
--
-- 프로덕션엔 이미 SET NULL 이라 멱등(DROP+ADD 가 같은 규칙으로 재생성).

ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS user_favorites_customer_id_fkey;
ALTER TABLE user_favorites ADD CONSTRAINT user_favorites_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
