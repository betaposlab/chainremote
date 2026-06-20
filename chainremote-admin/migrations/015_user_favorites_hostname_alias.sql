-- 015: user_favorites 에 hostname + alias 추가 (신규 거래처 식별)
-- 목적: HQ가 peer 즐겨찾기 시 원격PC hostname + 운영자 별칭(alias, 예 "삼성공판장")을 함께 전송.
--   "신규 거래처 후보" 배너가 9자리 ID만이 아니라 hostname/alias로 식별 + "추가" 다이얼로그 상호 프리필.
-- ★ 적용: 수동 psql (이 레포 drizzle 자동 마이그 없음 — 012/013/014 동일). 패널 배포 *전* 적용. 재실행 안전.
ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS hostname text;
ALTER TABLE user_favorites ADD COLUMN IF NOT EXISTS alias    text;
