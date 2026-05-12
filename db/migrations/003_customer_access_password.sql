-- 003 거래처별 접속 비밀번호 (운영 정석화)
-- 본사가 거래처 PC ChainRemote 의 영구 비밀번호로 사용할 발급 비번을 저장.
-- 거래처별로 다른 비번을 운영하면 한 거래처 비번 누출 시 다른 거래처는 안전.

ALTER TABLE customers ADD COLUMN access_password TEXT;
