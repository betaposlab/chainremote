-- 046: 세션에 접속 기기 스탬프 (2026-08-15)
--
-- "누가 언제 어디를"까지는 support_sessions 가 답하지만 "어느 PC 에서"는 못 답했다.
-- ChainGo 로 PC방에서, 집에서, 사무실에서 — 전부 같은 계정이라 구분이 안 된다.
--
-- ★새로 수집하는 값이 아니다. HQ 는 로그인 때 이미 호스트명·machine_uid·IP 를 보내고
--   있고(active_login_sessions), 그건 계정당 한 줄이라 다음 로그인에 덮어써진다.
--   세션 시작 시점의 스냅샷을 여기 복사해 둘 뿐이라 HQ 발행이 필요 없다.
--
-- 용도는 분쟁 증거가 아니라 **계정 오사용 탐지**다 — 낯선 호스트명·낯선 IP 가 보이면
-- 그 자리에서 알아챈다. 호스트명은 사용자가 바꿀 수 있고 IP 는 공유기 단위라 정황이지 증거가 아니다.
ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS operator_device text;
ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS operator_ip text;
