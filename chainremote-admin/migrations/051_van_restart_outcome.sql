-- 051: VAN 데몬 재시작의 성패를 센다 (2026-08-31).
--
-- van_restart_count 는 "되살림 N회" 로 읽히지만 실제로는 **KSCAT 을 실행시킨 횟수**다.
--   에이전트는 launch_in_user_session 이 성공하면 표식을 세울 뿐, 그래서 포트가 실제로
--   돌아왔는지는 그 숫자에 반영하지 않는다. 그래서 중앙리 9 · 바다양푼이 8 · 워낭 7 이라는
--   숫자를 놓고 "진짜 고장을 아홉 번 막은 것"인지 "새벽 오탐을 아홉 번 두들긴 것"인지
--   가릴 수가 없었다(2026-08-23).
--
-- ★고칠 자리는 에이전트가 아니라 여기다. 에이전트는 이미 같은 heartbeat 본문에
--   vanRestarted 와 vanOk 를 **함께** 보내고 있었다 — 서버가 둘을 따로 처리해 짝을 안 봤을
--   뿐이다. 재시작 후 grace 60초 + 감시주기 30초가 지난 뒤의 판정이 실려 오므로, 그때의
--   vanOk 가 곧 그 재시작의 성적표다.
--
-- 둘로 나눠 세는 이유: 하나만 두면 "복구 0" 이 *실패했다* 인지 *아직 관측 전* 인지 구분이
--   안 된다. 이 마이그레이션 이전의 재시작은 성패를 모르는 채 restart_count 에만 남아 있고,
--   그건 실패로 읽히면 안 된다. recovered + unrecovered < restart_count 면 그 차이가 곧
--   "모르는 구간" 이고 화면이 그렇게 말한다.
--
-- 멱등: 컬럼 IF NOT EXISTS.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_recovered_count integer NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_unrecovered_count integer NOT NULL DEFAULT 0;
