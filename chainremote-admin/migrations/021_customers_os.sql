-- 021: 거래처 OS 표시 정보 (os 버전 + 네이티브 OS 비트수)
--
-- heartbeat 가 보내는 os("Windows 7/10/11") + os_bits("x64"/"x86", 네이티브 OS 비트수)를 저장.
-- ★arch(020, 실행 페이로드 arch)와 다르다: 64비트 Win7 은 32비트 페이로드를 돌려 arch="x86"
-- 이지만 os="Windows 7"·os_bits="x64" 다. arch 만 보면 "32비트 OS"로 착각 → OS 를 따로 표기해
-- "Win7 · 64비트"로 정확히 보여준다(2026-07-11 월광식자재 = 64비트 Win7 계기).
--
-- 순수 표시·진단용, 매칭/신원 키 아님. nullable — 옛 에이전트(1.4.53 이하)는 os 미보고 → NULL,
-- 다음 업데이트 heartbeat 로 lazy 채워진다. 인덱스 없음(소규모, 풀스캔 충분).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS os TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS os_bits TEXT;
