-- 알려진 감염 흔적(마이그 061, 2026-10-20).
--
-- 사무실 재고 윈7 포스 4대가 모두 같은 백도어(Dr.Web BackDoor.KCNA.11 / Kaspersky "Bright Star" 계열)에
-- 걸려 있었다. 회수 포스를 다시 세팅하던 방식이 운반체로 보이고, 그 방식으로 세팅해 매장에 나간 포스가 있다.
-- 에이전트(1.4.159~)는 그 4대에서 확인된 흔적만 점검해 heartbeat 로 보낸다. 화면은 운영자에게만 보인다.
--   infect_signs      = 발견된 흔적 코드 목록(launch,wdext,mscaps,wtime32,runkey,selfappend 중). '' = 점검했고 깨끗함.
--                       NULL = 아직 점검 보고가 없음(옛 에이전트 또는 부팅 직후).
--   infect_checked_at = 에이전트가 마지막으로 점검한 시각.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS infect_signs text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS infect_checked_at timestamptz;
