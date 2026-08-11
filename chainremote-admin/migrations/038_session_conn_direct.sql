-- 038: 세션이 직결(P2P)이었나 릴레이였나 (2026-08-11 Chang).
-- 릴레이는 화면·파일이 전부 우리 서버를 거치므로 트래픽 비용이 곧 사업성이다(목표 10만 대).
--   그런데 지금은 "릴레이가 몇 %인지"조차 모른 채 추측하고 있었다. HQ 는 연결 수립 시
--   이미 direct 여부를 알고 있으므로(툴바에 표시하는 그 값), 세션 기록에 같이 남긴다.
--   이 값이 쌓여야 UDP 홀펀치·UPnP 같은 개선이 실제로 몇 %를 회수했는지 증명할 수 있다.
--
-- NULL = 미보고(구버전 HQ). true = 직결, false = 릴레이 경유.
--
-- 멱등: 컬럼 IF NOT EXISTS.

ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS conn_direct boolean;
