-- 034: 답변 확인 여부 (2026-08-07 Chang).
--
-- 사이드바에 미처리 배지를 다는데, 배지의 의미가 역할마다 다르다.
--   운영자(super_admin) → "아직 손 안 댄 문의가 몇 건인가"  = status='open'
--   대리점             → "내 문의에 답이 왔나"              = 답변이 달렸는데 아직 안 본 것
-- 대리점 쪽을 status 로는 표현할 수 없다. 우리가 'done' 으로 바꿔도 그건 우리 사정이고,
--   대리점의 관심사는 "읽었나"다. 그래서 확인 시각을 따로 둔다.
--
-- 열었을 때 찍는 방식이라 정밀하진 않다(목록만 훑고 닫아도 확인 처리됨). 그래도 배지가
--   영영 안 사라지는 것보단 낫고, 목록 줄에 답변 여부가 같이 보이므로 놓칠 여지는 작다.
--   정밀한 읽음 추적은 문의당 열람 기록이 필요한데, 문의함 규모에 과하다.

ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS reply_seen_at timestamptz;

-- 이미 답변이 달린 기존 건은 확인한 것으로 시작한다. 안 그러면 기능을 켜는 순간
--   과거 문의가 전부 "새 답변" 으로 잡혀 배지가 거짓말을 한다.
UPDATE feedback
   SET reply_seen_at = now()
 WHERE reply IS NOT NULL
   AND reply_seen_at IS NULL;

COMMENT ON COLUMN feedback.reply_seen_at IS
  '대리점이 답변을 확인한 시각. 이 값이 replied_at 보다 이르거나 없으면 "새 답변" 배지 대상.';
