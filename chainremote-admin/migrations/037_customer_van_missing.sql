-- 037: VAN 데몬이 그 기기에 아예 없는 경우 (2026-08-10 Chang).
-- 다른 VAN 을 쓰는 거래처에 관제를 잘못 켜면 에이전트가 찾을 프로그램이 없다. 지금까지는
--   그것도 '복구 실패'로만 떠서, 리더기 케이블이 빠진 진짜 고장과 구분이 안 됐다.
--   앞은 사람이 거래처에 가야 하고 뒤는 관제만 끄면 되는데 화면이 똑같으면 헛걸음을 부른다.
--   에이전트가 "프로세스도 없고 설치 경로에도 없음"을 확인하면 재시도 없이 이 값을 세운다.
--
-- 멱등: 컬럼 IF NOT EXISTS.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS van_missing boolean NOT NULL DEFAULT false;
