-- 029: 거래처 수락창에 보일 대리점 이름 (2026-08-06 Chang).
--
-- 거래처 화면의 "원격지원 요청" 카드가 여태 본사 ID 9자리를 그대로 보여줬다
--   ("본사(445497547)에서 이 PC 에 원격 접속을 요청했습니다").
--   사장님에게 숫자는 아무 의미가 없고 확인할 방법도 없다. 상호가 떠야 한다
--   ("대전문성텔레콤에서 이 PC 에 …").
--
-- 계정 표시명(display_name)을 그대로 못 쓰는 이유: 패널 로그인용 회사명과 거래처에
--   내세우는 영업 상호가 다를 수 있다. 우리가 그 첫 사례다 — 계정은 베타포스랩,
--   거래처에 내는 이름은 대전문성텔레콤. 대리점도 법인명과 간판이 다른 곳이 흔하다.
--
-- 비워두면 display_name 으로 자동 폴백하므로 기존 대리점은 손댈 것이 없다.
-- 에이전트에는 heartbeat 응답으로 실어 보낸다(설치본에 박으면 자동 업데이트 때
--   번들 custom.txt 로 덮여 사라지고, 상호를 바꿔도 반영이 안 된다).
--
-- 멱등: 컬럼 IF NOT EXISTS + UPDATE 는 값이 비어 있을 때만.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS support_display_name text;

COMMENT ON COLUMN tenants.support_display_name IS
  '거래처 수락창에 표시할 상호. 비면 display_name 사용.';

-- 우리 tenant 만 초기값을 넣는다(Chang 지시). 다른 대리점은 비워둔 채 display_name 폴백.
UPDATE tenants
   SET support_display_name = '대전문성텔레콤'
 WHERE slug = 'betaposlab'
   AND (support_display_name IS NULL OR support_display_name = '');
