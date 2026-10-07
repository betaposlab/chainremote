-- "응답 없음" 이력 + 대리 전달 요청·거절 기록(마이그 057, 2026-10-07).
--
-- 055 는 지금 상태 한 칸(customers.rz_noreply_since)만 남기고, 056 의 요청 행은 1시간 뒤 지운다.
-- 그래서 대리 전달이 실전에서 안 붙었을 때 "그 시각에 PC 가 응답 없음이었나 / 요청이 들어왔나 /
-- 에이전트가 가져갔나"를 가를 근거가 남지 않는다. 처음 실전이 될 달인이 바로 그런 경우다.
--
-- 1) rz_noreply_episodes — 응답 없음 한 구간 = 한 행.
--    started_at = 에이전트가 보고한 시작 시각, last_seen_at = 그 상태로 마지막 보고가 온 시각,
--    ended_at   = 풀렸다는 보고(null)를 받은 시각. 'replaced' 는 풀림 보고 없이 다른 시작 시각이
--    와서(에이전트 재시작 등) 새 구간으로 넘어간 것.
--    ★PC 가 그 상태로 꺼졌다 다음 날 켜지면 ended_at 은 다음 날이 된다 — 실제 끝은
--      last_seen_at 과 ended_at 사이 어딘가다. 화면은 둘을 다 보여준다.
-- 2) rz_relay_requests 에 거절도 남긴다(rejected_reason). HQ 가 패널에 물었다는 건 이미
--    hbbs 경로가 실패했다는 뜻이라, 거절된 요청이 오히려 "어디서 끊겼나"의 핵심 단서다.
--    보관은 1시간 → 30일.
CREATE TABLE IF NOT EXISTS rz_noreply_episodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  ended_at      timestamptz,
  end_reason    text
);

CREATE INDEX IF NOT EXISTS idx_rz_noreply_ep_customer_started
  ON rz_noreply_episodes (customer_id, started_at);
-- 매 heartbeat 의 "열린 구간 닫기"가 이 인덱스 한 번 찔러 보고 끝나도록(열린 행은 극소수).
CREATE INDEX IF NOT EXISTS idx_rz_noreply_ep_open
  ON rz_noreply_episodes (customer_id) WHERE ended_at IS NULL;

-- 'not_noreply' = 응답 없음 보고가 없었다 / 'stale' = 응답 없음이었지만 마지막 보고가 15분 넘게 묵었다(꺼짐 추정).
ALTER TABLE rz_relay_requests ADD COLUMN IF NOT EXISTS rejected_reason text;
