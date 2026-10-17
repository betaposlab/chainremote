-- 수락 카드를 못 띄운 기록(마이그 059, 2026-10-17).
--
-- 세종싱싱활어회배달: 포스 벤더가 "관리자 권한 실행"으로 세팅해 둔 PC 에서 서비스가 수락 카드를
-- 띄우다 os error 740 으로 거절당했다. 거래처 쪽에선 아무 일도 없어 보이고 본사 HQ 엔
-- "피어에 의해 초기화"만 떠서, 원인을 찾으려면 매장 PC 로그를 뒤져야 했다.
--
-- 에이전트(1.4.156~)는 카드를 못 띄우면 그 사실을 기록하고 heartbeat 에 실어 보낸다. 아무도
-- 접속하지 않아도 그 PC 에 카드 문제가 있다는 게 거래처 표에 보인다. 카드가 한 번이라도
-- 정상으로 뜨면 에이전트가 기록을 지우고 null 을 보내 여기서도 지워진다.
--   cm_fail_at   = 마지막으로 카드를 못 띄운 시각. NULL = 정상 또는 미보고(옛 에이전트).
--   cm_fail_code = os error 번호(예: 740 = 권한 상승 필요), 번호가 없으면 'cm'.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cm_fail_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cm_fail_code text;
