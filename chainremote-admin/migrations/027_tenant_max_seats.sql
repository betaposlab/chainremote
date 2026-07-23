-- 027: 대리점 좌석 상한(max_seats) — 과금 구멍 봉인.
-- 문제(2026-07-23 Chang 지적): "1 아이디 = 동시 1세션"은 강제되는데(active_login_sessions,
--   마이그 010) 대리점 오너가 직원 아이디를 무제한 만들 수 있어, 아이디 개수만큼 동시
--   원격이 늘어 과금이 샌다. 결정(Chang): 신규 대리점 기본 1석 + 추가 구매. 오너는 상한
--   내에서만 아이디 생성, 상한 조정은 super_admin(Chang)만.
--
-- 멱등(재실행 안전): 컬럼이 없을 때만 초기화한다 — 이미 있으면 Chang 이 조정한 값을 덮지 않는다.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'max_seats'
  ) THEN
    -- 신규 대리점 기본 1석.
    ALTER TABLE tenants ADD COLUMN max_seats int NOT NULL DEFAULT 1;

    -- 기존 대리점은 현재 활성 아이디 수 이상으로 초기화(기존 계정이 잠기지 않게).
    UPDATE tenants t SET max_seats = GREATEST(
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.is_active),
      1
    );

    -- 본사(super_admin 보유 대리점 = betaposlab)는 사실상 무제한 — Chang 본업 운영은 좌석 과금 대상 아님.
    UPDATE tenants t SET max_seats = 9999
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.role = 'super_admin');
  END IF;
END $$;
