-- 003 거래처별 접속 비밀번호
-- 본사가 거래처 PC ChainRemote 의 영구 비밀번호로 발급해 쓸 비번을 저장한다.
-- 거래처마다 비번을 달리 두면 한 곳이 누출돼도 나머지는 안전하다.

ALTER TABLE customers ADD COLUMN access_password TEXT;
