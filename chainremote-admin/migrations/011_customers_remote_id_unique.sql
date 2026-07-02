-- 011: customers.remote_id 글로벌 partial-unique 제약
--
-- remote_id(9자리)는 머신당 글로벌 유일이므로, 서로 다른 tenant 가 같은 값을
-- 입력(오타/복붙/우연/악의)하는 충돌을 DB 에서 막는다. 그래야
-- lib/data/customers.ts 의 registerHeartbeatToken/recordHeartbeat 가 쓰는
-- `WHERE remote_id = ?` 가 정확히 1행만 매칭하고, 한 대리점 agent 가 다른 대리점
-- 거래처의 토큰/업데이트 큐를 건드리는 cross-tenant 누수가 원천 차단된다.
--
-- 빈 문자열/NULL(거래처 ID 등록 전 placeholder)은 partial index 로 제외한다.
--
-- 적용 전 중복 확인 필수 — 중복이 남아 있으면 unique index 생성이 실패한다(의도된 안전장치).
-- 아래로 먼저 확인하고 정리할 것:
--     SELECT remote_id, COUNT(*) AS n FROM customers
--     WHERE remote_id IS NOT NULL AND remote_id <> ''
--     GROUP BY remote_id HAVING COUNT(*) > 1 ORDER BY n DESC;
--   중복이 나오면 어느 tenant 것이 맞는지 가려 잘못된 행의 remote_id 를 비우거나 삭제한 뒤 진행한다.
--   (현재 betaposlab 단일 tenant 라 실제 중복 가능성은 거의 없지만 그래도 확인한다.)

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_remote_id
  ON customers (remote_id)
  WHERE remote_id IS NOT NULL AND remote_id <> '';
