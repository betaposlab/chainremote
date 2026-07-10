-- 020: 거래처 프로세스 arch (x86/x64)
--
-- heartbeat 가 보내는 arch 를 저장 — 그 기기가 32비트 페이로드(i686)로 도는지 x64 로 도는지.
-- 순수 표시·진단용이다: 32비트 POS 를 즉시 식별해 32비트 페이로드 버전 고착 같은 이슈의 영향
-- 범위를 바로 파악한다. ★machine_uuid 와 달리 매칭/신원 키가 아니다 — 두 기기가 같은 "x86"
-- 인 건 정상이라 오매칭 재앙 클래스가 원천적으로 해당 없음.
--
-- nullable: 옛 거래처와 arch 를 아직 안 보낸(구버전) 에이전트는 NULL. 다음 업데이트 heartbeat
-- 로 lazy 채워진다. 인덱스/제약 없음 — 필터/집계는 소규모라 풀스캔으로 충분.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS arch TEXT;
