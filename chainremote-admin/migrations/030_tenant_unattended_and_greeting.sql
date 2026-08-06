-- 030: 대리점별 무인접속 에이전트 + HQ 인사말 (2026-08-07 Chang).
--
-- ── unattended_agent ────────────────────────────────────────────────────────
-- 거래처 정책은 클릭 수락 고정이고 그 결정은 유효하다. 그 정책의 근거는 **제3자
--   (가맹점 사장)의 통제권**인데, 본인이 자기 PC 에 접속하는 구성에는 동의 주체가
--   없다. 첫 사례: 자기 사무실 대표방 PC 를 밤에 집에서 보는 용도.
--
-- 켜면 [에이전트 다운로드] 가 만드는 custom.txt 의 approve-mode 가 click → both 가
--   된다. both 는 영구비번이 설정돼 있을 때만 무클릭이고, 비번이 없거나 틀리면
--   수락창으로 폴백한다(src/server/connection.rs) — 잘못 켜도 열린 문이 되진 않는다.
--
-- 대리점 단위인 이유: 에이전트 설치본에는 대리점 식별자만 박히고 기기별 구분이 없다.
--   무인접속이 필요한 곳은 전용 tenant 를 따로 파는 것이 격리 원칙과도 맞는다.
--
-- ★기본 false. 이 값은 사람이 명시적으로 켜야만 켜진다.
--
-- ── hq_greeting ─────────────────────────────────────────────────────────────
-- HQ 정보 화면의 이스터에그 문구. 코드가 아니라 여기 두는 이유가 둘이다.
--   ① HQ 는 빌드가 한 벌이라 코드에 박으면 전 대리점에 다 보인다.
--   ② 이 저장소는 AGPL 공개 소스라 개인적인 문구가 그대로 노출된다.
--   비면 이스터에그 자체가 없는 것처럼 동작한다(기본값).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS unattended_agent boolean NOT NULL DEFAULT false;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS hq_greeting text;

COMMENT ON COLUMN tenants.unattended_agent IS
  '켜면 이 대리점의 에이전트가 approve-mode=both(영구비번 있으면 무클릭)로 설치된다. 기본 false.';

COMMENT ON COLUMN tenants.hq_greeting IS
  'HQ 정보 화면 이스터에그 문구. 비면 표시 안 함.';
