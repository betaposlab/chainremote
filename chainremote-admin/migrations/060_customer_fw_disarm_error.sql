-- 방화벽 자동 해제 실패 이유(마이그 060, 2026-10-20).
--
-- 테스트1(윈7 32비트): 자동 해제 감시가 끄는 명령(netsh)을 시간 제한 없이 기다리다 10분 동안
-- 멈췄다. 실매장 샵단란주점은 자동 해제를 켜 둔 뒤로 한 번도 못 껐는데, HQ·패널엔 "해제 대기"만
-- 떠 아무도 몰랐다. 에이전트(1.4.157~)는 끄는 명령이 실패하거나 시간 안에 안 끝나면 그 이유를
-- heartbeat 로 보내고, 끄는 데 성공하거나 꺼진 걸 보면 null 을 보내 지운다.
--   firewall_disarm_error    = 이유 코드: timeout(시간 초과) / exitN(명령 실패, 코드 N) / spawn(실행 불가) / wait
--   firewall_disarm_error_at = 마지막으로 실패한 시각. NULL = 실패 없음 또는 미보고(옛 에이전트).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS firewall_disarm_error text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS firewall_disarm_error_at timestamptz;
