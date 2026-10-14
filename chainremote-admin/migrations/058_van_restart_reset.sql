-- VAN 데몬 재시작 카운터 초기화 + 마지막 판정 시각(마이그 058, 2026-10-14).
--
-- 중앙리: 옛 포스(211201815)가 재시작 43회를 쌓고 2026-09-30 에 새 포스(FZ81114834)로 교체됐다.
-- 교체는 같은 거래처 행을 이어 쓰므로 **옛 기기의 성적이 새 기기 옆에 그대로 붙어 보인다.**
-- 새 포스는 보름 동안 재시작 0인데 화면은 여전히 "재시작 43". 숫자가 거짓은 아니지만
-- 지금 그 기기에 대한 말은 아니다.
--
-- 1) customers.van_reported_at — 에이전트가 VAN 판정(vanOk)을 마지막으로 실어 보낸 시각.
--    지금까지는 "카운터가 안 오른다"가 "데몬이 건강하다"인지 "감시가 죽었다"인지 패널에서
--    가를 수 없었다(판정 시각이 어디에도 없었다). 이 값이 있으면 그 둘이 갈린다.
-- 2) customers.van_reset_at — 마지막으로 카운터를 0 으로 되돌린 시각. 칩이 "재시작 없음"을
--    "그날 이후로 없음"으로 말하게 한다.
-- 3) van_restart_resets — 되돌리기 전 숫자를 통째로 보관. 한 행 = 초기화 한 번 = 그 전까지의
--    한 구간. 지우는 게 아니라 접는 것이다 — 옛 기기가 얼마나 속을 썩였는지는 여기 남는다.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_reported_at timestamptz;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_reset_at timestamptz;

CREATE TABLE IF NOT EXISTS van_restart_resets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- 그때 그 거래처에 붙어 있던 기기와 VAN. 교체 뒤에 보면 "옛 기기 것" 임을 알 수 있다.
  remote_id          text,
  van_kind           text,
  restart_count      integer NOT NULL,
  recovered_count    integer NOT NULL,
  unrecovered_count  integer NOT NULL,
  last_restart_at    timestamptz,
  -- 이 구간의 시작 = 직전 초기화 시각. 첫 초기화는 NULL(기능 도입 전부터 센 숫자).
  period_from        timestamptz,
  reset_at           timestamptz NOT NULL DEFAULT now(),
  reset_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  reason             text
);

CREATE INDEX IF NOT EXISTS idx_van_resets_customer_reset
  ON van_restart_resets (customer_id, reset_at);
