-- 015: user_favorites 에 hostname + alias 추가 (신규 거래처 식별)
--
-- HQ 가 peer 를 즐겨찾기할 때 원격PC hostname + 운영자 별칭(alias, 예 "삼성공판장")을 함께 전송한다.
-- 그러면 "신규 거래처 후보" 배너가 9자리 ID 만이 아니라 hostname/alias 로 식별되고,
-- "추가" 다이얼로그의 상호도 프리필된다.
-- 적용은 수동 psql (이 레포 drizzle 자동 마이그 없음 — 012/013/014 동일). 패널 배포 전 적용. 재실행 안전.
ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS hostname text;
ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS alias    text;
