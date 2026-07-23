-- 028: 거래처 방화벽 자동 해제 관제 (2026-07-23 Chang).
-- 메인+오더 POS 구성에서 Windows 업데이트가 방화벽을 되살리면 인바운드가 막혀
--   주문 전달·프린터 공유가 끊긴다(카드 승인은 COM 직결+아웃바운드라 무관). 에이전트가
--   로컬에서 방화벽을 감시하다 켜지면 즉시 해제하고, 방화벽 경고 알림도 끈다.
--   거래처별 on/off(기본 off) — 방화벽 꺼야 하는 거래처만 켠다.
--
-- 멱등: 컬럼 IF NOT EXISTS.

-- 이 거래처에서 방화벽 자동 해제를 켤지(HQ 우클릭에서 owner 가 설정). 기본 off — 아무 데도 자동 적용 안 함.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS firewall_control boolean NOT NULL DEFAULT false;
-- 에이전트 보고: 마지막 heartbeat 시점 방화벽이 켜져 있었나(null=미보고/구버전).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS firewall_enabled boolean;
-- 에이전트가 방화벽을 자동 해제한 누적 횟수(자꾸 켜지는 거래처 식별 = 업데이트 잦음 신호).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS firewall_disarm_count integer NOT NULL DEFAULT 0;
-- 마지막으로 자동 해제한 시각.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS firewall_last_disarm_at timestamptz;
