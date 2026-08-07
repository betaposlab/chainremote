-- 033: 문의 유형에 '기타' 추가 (2026-08-07 Chang).
--
-- 건의·버그 둘로만 두니 "이건 버그도 건의도 아닌데" 가 생긴다. 계정·요금·사용법 문의처럼
--   분류가 애매한 것들이 그렇다. 유형을 못 고르면 아무거나 찍게 되고, 그러면 분류 자체가
--   신뢰를 잃는다 — 차라리 '기타' 를 두는 편이 목록이 정확해진다.
--
-- status 를 enum 이 아니라 text+CHECK 로 둔 판단(마이그 031)이 여기서 값을 한다.
--   ALTER TYPE 없이 제약만 바꿔 끼우면 된다.

ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_kind_chk;

ALTER TABLE feedback
  ADD CONSTRAINT feedback_kind_chk CHECK (kind IN ('bug', 'suggestion', 'other'));

COMMENT ON COLUMN feedback.kind IS
  'bug(버그 신고) | suggestion(건의) | other(기타). 분류가 애매한 문의를 억지로 밀어넣지 않게 기타를 둔다.';
