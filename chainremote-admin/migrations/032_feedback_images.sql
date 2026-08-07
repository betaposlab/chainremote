-- 032: 문의 첨부 이미지 (2026-08-07 Chang).
--
-- 버그 신고에서 스크린샷 한 장이 설명 열 줄보다 낫다. 대리점 직원이 증상을 글로 옮기는
--   건 생각보다 어렵고, 그 어려움이 곧 "신고를 안 하게" 만든다.
--
-- ── 저장 위치: 클라우드 디스크(볼륨). DB 에는 경로만. ─────────────────────────
-- 바이너리를 DB 에 넣으면 백업이 무거워지고 복구가 느려진다. 문의 글은 KB 단위인데
--   이미지 때문에 덤프가 GB 로 뛰는 건 손해다.
-- ★NAS 저장은 검토 후 기각했다. 2026-08 클라우드 이전의 이유가 저장 용량이 아니라
--   가용성(SPOF)이었는데, 이미지를 NAS 에 두면 NAS 가 꺼진 동안 문의 화면의 사진이
--   안 열린다. 집 인터넷 대역폭에도 묶인다.
--
-- ── 보관: 닫힌 문의는 90일 뒤 이미지만 지운다 ────────────────────────────────
-- 이미지는 재현에 쓰는 임시 증거자료고, 우리 자산은 글과 답변이다. done/declined 로
--   닫히고 90일이 지나면 파일과 이 행을 지우되 문의 자체는 영구 보존한다.
--   화면에는 "보관 기간이 지나 삭제되었습니다"로 표시해 원래 없던 것과 구분한다.
-- 백업 대상에서도 뺀다(명시적 결정) — 소실돼도 글은 남는다.
--
-- ── 서빙: 반드시 인증 라우트로 ───────────────────────────────────────────────
-- ★공개 정적 경로에 두면 URL 만 알면 남의 대리점 스크린샷이 열린다. POS 화면에는
--   매출·고객정보가 찍혀 있을 수 있어 격리가 무너지는 지점이다. 목록 조회는 tenant_id
--   로 자동으로 잘리지만 파일은 그렇지 않으니 라우트에서 명시적으로 막아야 한다.
--
-- stored_name 이 따로 있는 이유: 원본 파일명을 그대로 디스크에 쓰면 경로 조작과 한글/
--   공백 문제가 따라온다. 디스크에는 서버가 만든 이름만 쓰고, 원본은 표시용으로만 둔다.

CREATE TABLE IF NOT EXISTS feedback_images (
  id            bigserial PRIMARY KEY,
  feedback_id   bigint NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  -- 서빙 라우트가 "내 대리점 것인가"를 조인 없이 바로 확인하려고 중복 보관한다.
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stored_name   text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type     text NOT NULL,
  byte_size     integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_images_mime_chk
    CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  -- 5MB. 라우트에서도 막지만 DB 가 마지막 방어선이다.
  CONSTRAINT feedback_images_size_chk CHECK (byte_size > 0 AND byte_size <= 5242880)
);

CREATE INDEX IF NOT EXISTS idx_feedback_images_feedback
  ON feedback_images (feedback_id);

-- 정리 작업이 "닫힌 지 오래된 것"을 훑을 때 쓴다.
CREATE INDEX IF NOT EXISTS idx_feedback_images_created
  ON feedback_images (created_at);

COMMENT ON TABLE feedback_images IS
  '문의 첨부 이미지. 파일은 디스크(볼륨), 여기엔 경로·메타만. 닫힌 문의는 90일 후 정리.';
COMMENT ON COLUMN feedback_images.stored_name IS
  '디스크에 실제로 쓰인 이름(서버 생성). 원본 이름을 그대로 쓰면 경로 조작 위험.';
COMMENT ON COLUMN feedback_images.tenant_id IS
  '서빙 라우트의 격리 검사를 조인 없이 하려는 중복 보관. feedback.tenant_id 와 같아야 한다.';

-- 이미지가 있었는지 여부를 문의 쪽에도 남긴다. 파일을 정리한 뒤에도 "첨부가 있었지만
--   보관 기간이 지났다"를 표시하려면 이 값이 필요하다 — feedback_images 행이 지워지면
--   그 사실 자체를 알 길이 없어진다.
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS had_images boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN feedback.had_images IS
  '첨부가 있었는지. 90일 정리로 파일이 사라져도 "있었음"을 화면에 표시하려고 남긴다.';
