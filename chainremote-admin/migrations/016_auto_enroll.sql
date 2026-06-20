-- 016: 거래처 agent 자가등록(⑤ auto-enroll) — per-tenant enroll secret + customer pending 상태
--
-- 목적: 신규 거래처가 .exe 설치하면 agent 가 스스로 등록 → HQ 가 즐겨찾기→추가 안 해도 패널에 등장.
--   tenant 인증 = per-tenant enroll-key(고엔트로피 랜덤)의 sha-256 *해시* 를 tenants 에 저장.
--   평문 enroll-key 는 그 tenant 의 agent 빌드 custom.txt 에만 (DB 엔 해시만 — heartbeat-token H3 모델 동일).
--   자가등록된 거래처는 enroll_status='pending'(후보) — HQ 가 패널서 확인해야 'active'.
--   기존/수동추가(importPeer·createCustomer) 거래처는 'active'(default) — 즉시 확정 경로 무영향.
--
-- 보안: 미인증 enroll 엔드포인트가 row 를 CREATE 할 수 있게 되므로(register 는 ROTATE 만 했음),
--   (1) per-tenant enroll-key 해시 검증 (2) rate-limit (3) pending 상태(live 목록/일괄푸시 미오염) 3중 게이트.
--   remote_id 글로벌 unique(011)가 cross-tenant 탈취 차단.
--
-- ★ 적용: 수동 psql (이 레포 drizzle 자동마이그 없음 — 011~015 동일). 패널 배포 *전* 적용. 재실행 안전(IF NOT EXISTS).
--   enroll-secret 생성/저장은 별도(프로덕션 게이트): UPDATE tenants SET enroll_secret_hash=<sha256hex> WHERE slug='betaposlab';

ALTER TABLE tenants   ADD COLUMN IF NOT EXISTS enroll_secret_hash text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS enroll_status      text NOT NULL DEFAULT 'active';

-- 자가등록 후보 빠른 조회 (패널 '확인 대기' 큐 / 배지).
CREATE INDEX IF NOT EXISTS idx_customers_enroll_status ON customers (tenant_id, enroll_status);
