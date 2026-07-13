-- 022: 지원세션 HQ 기록용 필드 — 거래처측 응대자 + A/S 종류(멀티)
--
-- HQ 에서 원격 종료 시 기록하는 항목 확장 (전부 선택적 — 빈칸/미기록 허용):
--   contact_name : 거래처측 응대자(누구와 원격했는지 — 분쟁 근거). 기본값은 앱에서
--                  거래처 등록 담당자(customers.contact_name)로 프리필, 세션마다 수정 가능.
--   categories   : A/S 종류 멀티선택을 콤마로 이어 저장(예: "printer,payment"). 기존 issue_type
--                  enum(6종)과 별개 — POS 현실 12종은 앱 상수로 두고 자유 확장(enum 마이그 회피).
-- 기존 필드(issue_type/resolution/description/duration_sec)는 그대로 활용.
-- nullable, 표시·기록용. 매칭/신원 키 아님.

ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS categories TEXT;

-- 거래처별 이력 조회 가속(HQ 거래처 카드 "지원이력" + 전체 타임라인).
CREATE INDEX IF NOT EXISTS idx_support_sessions_customer_started
  ON support_sessions (tenant_id, customer_id, started_at DESC);
