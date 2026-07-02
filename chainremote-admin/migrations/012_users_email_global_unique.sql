-- 012: users.email 전역 유니크 (멀티테넌트 로그인 계정 충돌/오로그인 방지)
--
-- 로그인 3경로(auth.ts / api/auth/token / api/auth/takeover)는 email 단독으로 사용자를
-- 조회한다(`WHERE email = ? AND is_active`). 그런데 001_init.sql 의 제약은
-- UNIQUE(tenant_id, email) — 테넌트별 유니크일 뿐 전역 유니크가 아니다.
-- 두 대리점이 같은 아이디(admin/owner/chang 등)를 쓰면 두 가지가 터진다:
--   - email 단독 쿼리의 .limit(1) 이 ORDER BY 없이 비결정적으로 한 행을 고른다.
--     비번이 우연히 같으면 엉뚱한 tenant 로 로그인 → 토큰 tenantId 가 타 회사 = 격리 붕괴.
--   - 신규 사용자 생성에 중복 사전검사가 없어 타 회사가 같은 아이디를 만들 수 있다.
-- email 을 전역 유니크(대소문자 무시)로 강제해 단독 조회를 안전하게 만든다.
--
-- 적용 전 중복 확인 필수 — 중복이 남아 있으면 unique index 생성이 실패한다(의도된 안전장치).
-- 아래로 먼저 확인하고 정리할 것:
--     SELECT lower(email) AS e, COUNT(*) AS n FROM users
--     GROUP BY lower(email) HAVING COUNT(*) > 1 ORDER BY n DESC;
--   중복이 나오면 어느 tenant 계정이 맞는지 가려 잘못된 행을 정리한 뒤 진행한다.
--   (현재 betaposlab 단일 tenant 라 실제 중복 가능성은 거의 없지만 그래도 확인한다.)
--
-- 기존 UNIQUE(tenant_id, email) 는 전역 유니크의 부분집합이라 그대로 둔다.

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON users (lower(email));
