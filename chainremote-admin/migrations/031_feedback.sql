-- 031: 대리점 문의함 — 건의·버그 신고 (2026-08-07 Chang).
--
-- 왜 게시판이 아니라 문의함인가:
--   대리점끼리 서로의 글을 볼 이유가 없다. 상호와 업무 사정이 그대로 드러나고, 멀티테넌트
--   격리 원칙과도 어긋난다. 그래서 각 대리점은 자기가 낸 것만 보고, 전체를 보는 건
--   플랫폼 운영자(super_admin)뿐이다. 목록 조회가 tenant_id 로 잘리므로 격리가 공짜로 된다.
--
--   게시판으로 키우려면 나중에 공개 플래그 한 칸만 더하면 된다. 반대로 처음부터 공개로
--   열면 되돌릴 때 이미 쓰인 글의 노출 범위를 바꿔야 해서 훨씬 비싸다.
--
-- status 는 텍스트 + CHECK 로 둔다. enum 타입은 값 추가에 ALTER TYPE 이 필요해서,
--   운영하며 상태가 늘어날 게 뻔한 이 테이블에는 맞지 않는다.
--
-- ★답변(reply)은 super_admin 만 쓴다. 대리점이 자기 글을 고치는 기능은 일부러 안 넣었다 —
--   접수 후 내용이 바뀌면 우리가 무엇에 답했는지가 흐려진다. 추가할 말은 새 문의로 받는다.

CREATE TABLE IF NOT EXISTS feedback (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- 낸 사람이 퇴사해 계정이 지워져도 문의는 남는다(SET NULL). 누가 냈는지보다
  --   무엇을 요청했는지가 우리에게 남아야 할 정보다.
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 지운 계정의 이름을 그대로 보여주기 위한 스냅샷. user_id 가 NULL 이 돼도 살아남는다.
  author_name   text NOT NULL,
  kind          text NOT NULL DEFAULT 'suggestion',
  title         text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'open',
  reply         text,
  replied_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_kind_chk   CHECK (kind IN ('bug', 'suggestion')),
  CONSTRAINT feedback_status_chk CHECK (status IN ('open', 'reviewing', 'done', 'declined'))
);

-- 대리점 화면은 "내 대리점 것을 최신순"으로만 읽는다.
CREATE INDEX IF NOT EXISTS idx_feedback_tenant_created
  ON feedback (tenant_id, created_at DESC);

-- 운영자 화면은 "미처리 먼저"를 자주 본다.
CREATE INDEX IF NOT EXISTS idx_feedback_status_created
  ON feedback (status, created_at DESC);

COMMENT ON TABLE feedback IS
  '대리점 건의·버그 문의. 대리점은 자기 것만, super_admin 은 전체를 본다.';
COMMENT ON COLUMN feedback.author_name IS
  '작성 시점 이름 스냅샷 — 계정이 지워져도 누가 냈는지 남긴다.';
COMMENT ON COLUMN feedback.status IS
  'open(접수) | reviewing(검토중) | done(반영) | declined(보류). super_admin 만 바꾼다.';
