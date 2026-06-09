-- 011: customers.remote_id 글로벌 partial-unique 제약
--
-- 목적: 멀티테넌트 격리 + heartbeat-token 발급 안전.
--   RustDesk remote_id(9자리)는 머신당 글로벌 유일이므로, 서로 다른 tenant 가 같은 9자리를
--   입력(오타/복붙/우연/악의)하는 충돌을 DB 차원에서 차단한다. 이로써
--   lib/data/customers.ts 의 registerHeartbeatToken/recordHeartbeat 의 `WHERE remote_id = ?`
--   가 정확히 1행만 매칭 → 한 대리점 agent 가 다른 대리점 거래처의 토큰/업데이트 큐에
--   접근하는 cross-tenant 누수를 원천 차단.
--
-- 빈 문자열/NULL remote_id(거래처 ID 등록 전 placeholder 거래처)는 제약에서 제외(partial index).
--
-- ★ 적용 전 중복 확인 필수 — 중복이 있으면 인덱스 생성이 실패한다:
--     SELECT remote_id, COUNT(*) AS n FROM customers
--     WHERE remote_id IS NOT NULL AND remote_id <> ''
--     GROUP BY remote_id HAVING COUNT(*) > 1 ORDER BY n DESC;
--   중복 발견 시: 어느 tenant 의 것이 올바른지 확인 후 잘못된 행의 remote_id 를 비우거나 삭제 후 진행.
--   (현재 단일 tenant=betaposlab 운영이라 중복 가능성 거의 0, 그래도 반드시 확인.)

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_remote_id
  ON customers (remote_id)
  WHERE remote_id IS NOT NULL AND remote_id <> '';
