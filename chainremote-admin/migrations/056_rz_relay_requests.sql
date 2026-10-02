-- 접속 요청 대리 전달(마이그 056, 2026-10-02) — "응답 없음" PC 에도 원격이 붙게.
--
-- 원격 접속은 접속 서버(hbbs)가 거래처 PC 에 UDP 로 "누가 붙으려 한다(PunchHole)"를 알리는
-- 데서 시작한다. 2026-10-01 달인식자재마트에서 그 **한 방향 UDP 만** 몇 시간씩 PC 에 닿지
-- 않았다(같은 매장 다른 PC 는 매일). 같은 순간에도 PC→서버 TCP, 중계 서버 연결, 패널(HTTPS)은
-- 멀쩡했다. 그래서 막힌 그 알림 한 통만 패널로 대신 전달한다:
--   1) HQ 가 평소처럼 hbbs 에 접속 요청(TCP)을 넣고, 응답이 없으면 hbbs 가 본 자기 주소
--      (공인 IP = 패널이 본 IP, 포트 = hbbs TestNatResponse)를 여기에 남긴다.
--   2) "응답 없음" 상태인 에이전트만 패널을 짧게 확인하다 이 행을 가져가, hbbs 가 보냈어야 할
--      PunchHole 을 스스로 만들어 처리한다 → 중계 서버 접속 + hbbs 에 RelayResponse(TCP).
--   3) hbbs 가 평소처럼 신원 서명을 붙여 HQ 에 전달 → 이후 표준 절차(암호화 포함) 그대로.
-- 한 행 = 접속 시도 한 번. 60초 안에 한 번만 가져갈 수 있고 1시간 지나면 지운다.
CREATE TABLE IF NOT EXISTS rz_relay_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  hq_ip         text NOT NULL,
  hq_port       integer NOT NULL,
  relay_server  text,
  requested_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rz_relay_customer_created
  ON rz_relay_requests (customer_id, created_at);
