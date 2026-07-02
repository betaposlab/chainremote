-- 017: per-tenant enroll-key 평문 암호화 저장 (대리점 자가 다운로드 — 재다운로드해도 같은 .exe)
--
-- enroll_secret_hash(검증용, 016)는 그대로 두고, enroll_secret_enc 에 평문 enroll-key 를
-- AUTH_SECRET 파생키로 AES-256-GCM 암호화해 저장한다. 다운로드 시 복호화해 같은 키를 재사용한다.
-- 이게 없으면 다운로드마다 키가 회전해 이미 배포한 .exe 가 신규등록 불가가 되는 혼란이 생긴다.
--
-- 적용은 수동 psql (011~016 동일). 패널 배포 전 적용. 재실행 안전(IF NOT EXISTS).
-- 기존 betaposlab 은 enc 가 NULL 이므로 배포 후 winpc 에 보관된 평문으로 백필한다(키 회전 없이 일치).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS enroll_secret_enc text;
