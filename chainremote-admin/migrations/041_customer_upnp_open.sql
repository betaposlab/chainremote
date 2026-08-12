-- 041: 거래처별 UPnP 포트 열기 스위치 + 열린 주소 (2026-08-12).
--
-- 마이그040 이 "공유기가 UPnP 를 지원하는가"를 세었고, 26곳 중 14곳(54%)이 제어까지
--   열려 있었다. 그래서 세는 데서 멈추지 않고 실제로 포트를 연다.
--
-- ★기본값은 false 다. 포트를 열면 그 POS 가 인터넷에서 도달 가능해지고, 우리는 클릭 수락
--   정책이라 표적 공격 시 영업 중인 매장 화면에 수락 카드가 뜰 수 있다. 그래서 방화벽·VAN
--   관제와 같은 방식으로 **거래처별로 골라 켠다**. 먼저 우리 기기(우리집·테스트1)에서
--   직결이 실제로 살아나는지 확인한 뒤 넓힌다(Chang 2026-08-12).
--
-- upnp_endpoint = 공유기가 열어 준 바깥 주소 "ip:port". 본사 앱이 연결 후보에 이 주소를
--   하나 더 얹는다. ★rendezvous 를 건너뛰지 않는다 — 서버가 준 상대 공개키 검증은 그대로
--   두고 접속할 주소만 하나 늘리는 것이라 보안이 약해지지 않는다.
--
-- 멱등: 컬럼 IF NOT EXISTS.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS upnp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS upnp_endpoint text;
