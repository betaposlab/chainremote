-- 050: 본사 앱 → 관리 패널 한 번 열기 티켓 (2026-08-19).
--
-- 종전엔 본사 앱의 [관리 패널] 버튼이 주소만 열었다. 인증을 넘겨주지 않으니 브라우저에
--   남아 있던 쿠키가 곧 패널 계정이 됐고, 본사 앱이 A 로 로그인돼 있어도 패널은 B 로
--   열렸다(2026-08-19 Chang 실측). 권한이 새는 건 아니지만 — 그 쿠키는 원래 브라우저
--   주인 것이고 주소창에 직접 쳐도 같다 — 버튼이 "내 패널 열기" 로 읽히는데 아니라는 게
--   문제다. 직원 여럿이 한 PC 를 쓰는 대리점에서 남의 패널에 들어가 놓고 모를 수 있다.
--
-- 그래서 본사 앱이 자기 신원(Bearer)으로 티켓을 받아 그 주소를 열면, 패널이 티켓을 확인해
--   같은 계정으로 세션을 만든다.
--
-- ★티켓은 주소에 실린다 — 방문기록에 남고 Referer 로 샐 수 있다. 그 창을 좁히는 게 이
--   테이블의 존재 이유다: 60초 만료 + **한 번 쓰면 소멸**(used_at 이 아니라 DELETE).
--   서명 토큰만 쓰면 만료 전까지 재사용이 가능해 이 보장을 못 만든다.
--
-- 토큰은 해시로 저장한다(heartbeat 토큰과 같은 규칙) — DB 가 새도 티켓은 못 쓴다.

CREATE TABLE IF NOT EXISTS panel_tickets (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 만료분 청소용. 티켓은 소비 시 지워지지만, 안 쓰인 것들이 남는다.
CREATE INDEX IF NOT EXISTS panel_tickets_expires_idx ON panel_tickets (expires_at);
