-- 045: 지원 세션 폐기를 삭제 대신 표식으로 + 수동 기록 (2026-08-15)
--
-- 패널의 [기록 폐기]가 행을 DELETE 하고 있어서, 진짜 A/S 세션에 누르면 "누가 언제 어디를
-- 원격했나"는 사실까지 통째로 사라졌다(토니피자 건). 대리점과 분쟁이 나면 15초 이상 원격한
-- 기록은 반드시 찾을 수 있어야 한다(Chang 결정) — 폐기는 숨김 표식만 단다.
--   * HQ 의 15초 미만 오접속 자동 폐기는 그대로 삭제한다(명시적 규칙: 15초 미만은 기록 안 남김).
-- 수동 기록: 전화로만 처리했거나 이미 지워진 A/S 를 사람이 손으로 남기는 행. 원격 세션과
-- 구분되도록 표식을 둔다.
ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS discarded_at timestamptz;
ALTER TABLE support_sessions ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;
