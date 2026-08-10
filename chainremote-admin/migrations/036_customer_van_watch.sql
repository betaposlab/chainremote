-- 036: VAN 카드결제 데몬 관제 (2026-08-10 Chang).
-- POS 의 카드 결제는 VAN 사 데몬이 떠 있어야 성립한다. KSNET 은 KSCAT.exe 가 27015 를 열고
--   승인 요청을 받는데, 이게 멈추면 화면엔 아무 표시도 없이 카드만 안 긁힌다. 에이전트가
--   포트를 감시하다 닫히면 데몬을 되살린다.
-- 거래처마다 VAN 사가 다르므로 on/off 가 아니라 "어느 VAN 인가"를 저장한다 — 나중에 KIS·NICE
--   가 붙어도 컬럼을 늘리지 않고 값만 추가하면 된다. NULL = 관제 안 함(기본).
--
-- 멱등: 컬럼 IF NOT EXISTS.

-- 관제할 VAN 종류. NULL/빈값=관제 off, 'ksnet'=KSCAT 감시. 에이전트의 DAEMONS 목록과 값이 같아야 한다.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_watch text;
-- 에이전트 보고: 마지막 점검에서 데몬이 정상이었나(null=미보고/구버전/관제 off).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_ok boolean;
-- 에이전트가 데몬을 되살린 누적 횟수. 잦으면 그 기기 데몬이 불안정하다는 신호.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_restart_count integer NOT NULL DEFAULT 0;
-- 마지막으로 되살린 시각.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_last_restart_at timestamptz;
-- 재실행으로 안 낫아 에이전트가 손을 뗀 상태(리더기 COM 불일치 등) — 사람이 가야 한다는 뜻.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_gave_up boolean NOT NULL DEFAULT false;
