-- 023: 거래처 알림 — enroll 판정 매트릭스가 자동 처리 못 하는 애매한 경우를 마스터에게 노출
--
-- "상호 = 교체 키" 재설계(2026-07-14)의 사람 결정 큐:
--   reinstalled_new_name : 기존 기기가 새 상호로 재설치됨(어느 상호와도 불일치) → [이동]/[개명]/[무시]
--   same_name_new_device : 동일 상호로 새 기기 등록(기존 기기 생존) → 동명 매장 or 멀티포스 → [무시]
--   device_replaced      : 기기 교체 자동 성립(감사 로그, 생성 시 resolved)
--   device_moved         : 기기 이동 자동 성립(감사 로그, 생성 시 resolved)
-- 자동 액션의 감사 추적 + 미해결 알림 배지가 목적. 매칭/신원 키 아님.

CREATE TABLE IF NOT EXISTS customer_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_alerts_tenant_open
  ON customer_alerts (tenant_id, created_at DESC)
  WHERE resolved_at IS NULL;
