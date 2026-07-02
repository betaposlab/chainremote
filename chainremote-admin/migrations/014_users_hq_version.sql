-- 014: users(본사 HQ 직원)에 HQ 앱 버전 + 마지막 heartbeat 시각 추가
--
-- HQ 데스크탑앱이 ~5초 heartbeat(POST /api/auth/heartbeat)에 자기 버전을 실어 보내면 여기 저장하고,
-- 패널 직원 화면(app/users)에서 직원별 HQ 버전 + 마지막 접속 + 옛버전 경고를 보여준다.
-- = 에이전트(customers.last_version/last_heartbeat_at)와 같은 가시성을 HQ 에도 준다.
-- 사업화 전 필수: 50 대리점 HQ 자동업뎃이 실제로 도는지 패널에서 확인할 수 있어야 한다.
--
-- 적용은 수동 psql (이 레포는 drizzle 자동 마이그 없음 — 012/013 도 수동 적용).
-- 반드시 패널 배포 전에 적용할 것. 안 그러면 heartbeat 라우트가 없는 컬럼에 써서 깨진다.
-- IF NOT EXISTS 라 재실행 안전.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_version       text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_heartbeat_at  timestamptz;
