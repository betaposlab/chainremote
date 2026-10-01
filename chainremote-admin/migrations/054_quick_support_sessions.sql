-- 임시 원격(626.kr 초록 버튼) — 대리점 번호 + 자가 신고 세션 (2026-10-01).
--
-- 종전: 고객이 RustDesk 창의 숫자 9자리와 영문 섞인 비밀번호 6자를 전화로 불러 줬다.
--   영어를 모르는 사장님에게는 고역이고, 담당자도 받아 적다 틀린다.
-- 이제: 초록 버튼 → 숫자판에 대리점 번호(숫자 3자리, 마우스로 누름) → 받은 파일 실행.
--   파일 **이름**에 이 클릭만의 토큰이 든 주소가 실려 있어, RustDesk 가 켜지면 스스로
--   "내 ID 는 ○○○" 를 그 주소로 알려 온다(상류 기능: api 서버에 sysinfo·heartbeat).
--   본사 앱에는 "임시 접속 대기" 로 뜨고, 고객은 [수락] 만 누른다.
--
-- 왜 IP 로 맞추지 않나: 대리점이 여럿이면 ①누구 고객인지 모르고 ②같은 공인 IP 를 여러
--   매장이 쓰는 회선(LTE 라우터·상가 공용)에서 남의 PC 에 붙는다. 토큰은 추측이 없다.

-- 1) 대리점 번호. 고객이 숫자판에 누르는 값이라 짧고 숫자만.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS quick_code text;

WITH n AS (
  SELECT id, 100 + row_number() OVER (ORDER BY created_at, id) AS c
  FROM tenants
  WHERE quick_code IS NULL
)
UPDATE tenants t SET quick_code = n.c::text FROM n WHERE t.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_quick_code ON tenants (quick_code);

-- 새 대리점은 다음 번호를 자동으로 받는다(앱 코드가 신경 쓸 일 없게 DB 기본값으로).
CREATE SEQUENCE IF NOT EXISTS tenant_quick_code_seq;
SELECT setval(
  'tenant_quick_code_seq',
  GREATEST(100, COALESCE((SELECT max(quick_code::int) FROM tenants WHERE quick_code ~ '^[0-9]+$'), 100))
);
ALTER TABLE tenants ALTER COLUMN quick_code SET DEFAULT nextval('tenant_quick_code_seq')::text;

-- 2) 임시 원격 세션. 초록 버튼 한 번 = 한 행.
CREATE TABLE IF NOT EXISTS quick_support_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,
  arch          text,
  click_ip      text,
  -- 아래는 고객 PC 의 RustDesk 가 알려 온 값. 켜기 전엔 전부 NULL.
  remote_id     text,
  hostname      text,
  os            text,
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  -- 누군가 붙어 있는가(heartbeat 의 conns). 붙어 있는 동안은 대기 목록에서 뺀다.
  connected     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qs_sessions_tenant_seen
  ON quick_support_sessions (tenant_id, last_seen_at);
