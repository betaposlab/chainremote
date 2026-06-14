-- 012: users.email 전역 유니크 (C1 — 멀티테넌트 로그인 계정 충돌/오로그인 방지)
--
-- 목적: 로그인 3경로(auth.ts / api/auth/token / api/auth/takeover)가 email 단독으로 사용자를
--   조회한다(`WHERE email = ? AND is_active`). 그러나 종전 제약은 001_init.sql 의
--   UNIQUE(tenant_id, email) — *테넌트별* 유니크일 뿐 전역 유니크가 아니다.
--   2개 대리점이 같은 아이디(admin/owner/chang 등)를 쓰면:
--     ① email 단독 쿼리의 .limit(1) 이 ORDER BY 없이 비결정적으로 한 행 선택 →
--        비번이 우연히 같으면 엉뚱한 tenant 로 로그인 → 토큰 tenantId 가 타 회사 = 격리 붕괴.
--     ② 신규 사용자 생성에 중복 사전검사가 없어 타 회사가 동일 아이디 생성 가능.
--   email 을 전역 유니크로 강제해 단독 조회를 안전하게 만든다. (대소문자 무시.)
--
-- ★ 적용 전 중복 확인 필수 — 중복이 있으면 인덱스 생성이 실패한다(의도된 안전장치):
--     SELECT lower(email) AS e, COUNT(*) AS n FROM users
--     GROUP BY lower(email) HAVING COUNT(*) > 1 ORDER BY n DESC;
--   중복 발견 시: 어느 tenant 의 계정이 올바른지 확인 후 잘못된 행을 정리하고 진행.
--   (현재 단일 tenant=betaposlab 운영이라 중복 가능성 거의 0, 그래도 반드시 확인.)
--
-- 기존 UNIQUE(tenant_id, email) 는 전역 유니크의 부분집합이라 남겨둬도 무해 — 건드리지 않음.

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON users (lower(email));
