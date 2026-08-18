-- 048: 예약원격 창의 현재 상태 + 대리점의 강제 닫기 (2026-08-18).
--
-- 예약원격은 거래처가 승인한 "이 시간엔 수락 없이 들어와도 된다" 구간이다. 창의 진실은
--   거래처 PC 의 ProgramData 마커 하나뿐이고 서버는 그걸 모른다 — 그래서 지금 어느 거래처가
--   열려 있는지 대리점이 볼 방법이 없었다. 에이전트가 heartbeat 에 실어 보고하게 하고,
--   여기 담아 패널이 목록으로 보여준다.
--
-- sched_close_requested_at = 대리점이 [강제 닫기]를 누른 시각. 정리 명령(cleanup_requested_at)
--   과 똑같은 큐 방식이다 — 패널에서 에이전트로 가는 명령 채널은 heartbeat 응답뿐이라
--   (실시간 통로가 없다) 다음 폴링에 실려 내려간다. 에이전트는 "마지막으로 처리한 요청
--   시각"과 다를 때만 실행하므로 같은 값이 반복해 내려가도 무해하다.
--
-- ★비우는 건 에이전트의 보고가 한다. 창이 닫혔다고(sched_open_until 이 비었다고) 보고가
--   올라오면 요청도 같이 지운다 — 버튼을 누른 쪽이 "보냈다"로 지우면, 그 사이 PC 가 꺼져
--   있었을 때 명령이 증발하고도 성공처럼 보인다.
--
-- 멱등: 컬럼 IF NOT EXISTS.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS sched_open_until timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sched_close_requested_at timestamptz;
