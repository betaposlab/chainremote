-- 025: 동시 세션 시작 TOCTOU 방어 (적대 테스트 S12)
-- 같은 직원(operator)이 같은 거래처(customer)에 활성(미종료) 세션은 1개만 허용한다.
-- startSession 의 select-then-insert 는 두 요청이 동시에 빈 결과를 보면 둘 다 insert 해
-- 활성 세션이 중복됐다. partial unique index 로 DB 레벨에서 강제하고, startSession 은
-- ON CONFLICT DO NOTHING 후 기존 활성 행을 재조회해 반환한다.
--
-- ★prod 적용 주의: 이미 (tenant, operator, customer) 활성 중복 행이 있으면 인덱스 생성이
--   실패한다. 배포 전 아래로 확인·정리할 것(현재 운영상 중복은 없을 것으로 예상):
--     SELECT tenant_id, operator_id, customer_id, count(*) FROM support_sessions
--       WHERE ended_at IS NULL GROUP BY 1,2,3 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_operator_customer
  ON support_sessions (tenant_id, operator_id, customer_id)
  WHERE ended_at IS NULL;
