-- 039: 거래처 NAT 유형 집계 (2026-08-11 Chang).
-- 릴레이를 타는 거래처가 왜 그런지 짐작으로 이야기하고 있었다. "사설 공유기 탓"이라고 봤는데
--   Chang 님 집도 같은 공유기를 쓰면서 86% 직결이라 반례였다. 실제 갈림은 NAT 동작 방식이다:
--   Cone 은 상대가 누구든 같은 포트를 써 홀펀칭이 되고, Symmetric 은 상대마다 다른 포트를
--   배정해 주소를 알아도 못 닿는다(낭성 관리포스 실측 — 공인 주소를 받고도 2초 뒤 릴레이).
--   에이전트는 이미 부팅 때 자기 유형을 판정해 두므로, heartbeat 에 실어 세기만 하면 된다.
--
-- 값: 0=미상(판정 실패/미보고) · 1=Cone(ASYMMETRIC) · 2=Symmetric. NULL=구버전 에이전트.
-- 이 분포가 UPnP 착수 여부를 정한다 — Symmetric 이 몇 대뿐이면 안 만들어도 된다.
--
-- 멱등: 컬럼 IF NOT EXISTS.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS nat_type integer;
