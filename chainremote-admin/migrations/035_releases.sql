-- 035: 릴리즈 기록(체인지로그) — 2026-08-08 Chang.
--
-- 발행할 때마다 한 줄씩 쌓아, 대리점이 "이번 업데이트로 뭐가 달라졌는지"를 스스로 본다.
--   지금은 그 정보가 agent-push.json 의 notes 한 칸에만 있고 다음 발행에 덮어써져 이력이
--   남지 않는다. 대리점이 늘면 "업데이트하니 뭐가 좋아졌냐"는 문의가 그대로 우리에게 온다.
--
-- ★기록은 release-full.sh 가 발행 성공 직후 자동으로 넣는다. 사람이 "발행하고 나서 적기"를
--   기억해야 하는 구조면 반드시 빠진다 — 하루에 다섯 번 발행한 날도 있었다.
--
-- notes 가 비어 있어도 행은 남긴다. "이 버전은 내부 수정뿐" 이라는 사실 자체가 정보고,
--   버전 번호가 건너뛴 것처럼 보이는 혼란을 막는다. 화면에서는 노트 있는 것만 펼친다.

CREATE TABLE IF NOT EXISTS releases (
  id          bigserial PRIMARY KEY,
  -- agent(거래처) | hq(본사 앱) | chaingo(무설치). 채널마다 버전이 따로 나간다.
  kind        text NOT NULL,
  version     text NOT NULL,
  -- 사용자 언어로 쓴다. 커밋 메시지를 그대로 옮기지 않는다 —
  --   "Reset by the peer 재시도" 가 아니라 "원격 중 업데이트해도 자동으로 다시 연결됩니다".
  notes       text,
  released_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT releases_kind_chk CHECK (kind IN ('agent', 'hq', 'chaingo')),
  -- 같은 채널의 같은 버전은 한 번만. 재발행·스크립트 재시도에도 중복이 안 쌓인다.
  CONSTRAINT releases_kind_version_uniq UNIQUE (kind, version)
);

CREATE INDEX IF NOT EXISTS idx_releases_released
  ON releases (released_at DESC);

COMMENT ON TABLE releases IS
  '릴리즈 노트. release-full.sh 가 발행 직후 자동 기록한다. 전 대리점이 읽는다.';
COMMENT ON COLUMN releases.notes IS
  '대리점이 읽을 문장. 내부 용어·커밋 메시지를 그대로 넣지 않는다.';

-- ── 소급 입력 (2026-08-07~08) ────────────────────────────────────────────────
-- 빈 이력으로 시작하면 안 만든 것만 못하다. 최근 다섯 개는 채워 두고 연다.
INSERT INTO releases (kind, version, notes, released_at) VALUES
  ('agent', '1.4.90',
   E'원격 지원 중에 업데이트를 설치해도 세션이 끊긴 뒤 자동으로 다시 연결됩니다.\n종전에는 연결이 끊긴 채로 끝나 거래처에 다시 수락을 부탁해야 했습니다.',
   '2026-08-07 15:26+09'),
  ('agent', '1.4.91',
   E'자동 업데이트 후에도 대리점 설정이 그대로 유지됩니다.\n종전에는 업데이트 한 번에 거래처 등록 정보가 초기값으로 되돌아갈 수 있었습니다.',
   '2026-08-07 18:10+09'),
  ('hq', '1.4.92',
   '본사 앱 기본 화면이 어두운 테마로 바뀌었습니다. 설정에서 밝은 테마로 되돌릴 수 있습니다.',
   '2026-08-07 20:24+09'),
  ('hq', '1.4.93',
   E'왼쪽 위에 소속 대리점 이름이 표시됩니다.\n사이드바에서 관리 패널을 바로 열 수 있습니다.\n정보 화면의 오픈소스 라이선스 안내를 접었다 펼 수 있게 정리했습니다.',
   '2026-08-07 21:50+09'),
  ('hq', '1.4.94',
   '지원 기록에서 내용·응대자 같은 값이 어두운 테마에서 잘 안 보이던 것을 고쳤습니다.',
   '2026-08-08 10:30+09')
ON CONFLICT (kind, version) DO NOTHING;
