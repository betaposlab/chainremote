#!/usr/bin/env bash
# NAS 의 agent-push.json 발행 — 관리 패널 [일괄 푸시] 다이얼로그의 [최신 가져오기]
# 버튼이 읽는 유일한 소스. 매 Agent 릴리즈마다 반드시 실행할 것.
#
# 2026-07-08 신설 배경: 이 파일을 매 릴리즈 손으로 올리던 습관이 6/24(1.4.38) 이후
#   끊겨서, [최신 가져오기]가 몇 주째 옛 버전만 주는 걸 아무도 몰랐다(패널 버튼은
#   멀쩡했는데 먹이가 되는 파일만 방치됨). 다시는 안 끊기게 릴리즈 스크립트로 고정.
#
# ⚠ latest.json 은 이 스크립트가 절대 안 건드린다 — 그건 HQ 자동업데이트 전용
#   2채널 포맷(hq/agent)이고, agent 채널은 0.0.0 으로 영구 비활성 고정이다.
#   옛 deploy/release.sh 는 이 latest.json 을 flat 포맷으로 덮어써 HQ 채널을 파괴하는
#   지뢰였다 → 2026-07-09 삭제(build-and-release.sh 도 함께). 이 스크립트가 그 정석 후계다.
#
# 사용법: ./deploy/nas/publish-agent-push-meta.sh <ChainRemote_Agent_Setup_v*.exe 경로> [릴리즈노트]

set -euo pipefail

SETUP_EXE="${1:-}"
NOTES="${2:-}"

if [[ -z "$SETUP_EXE" ]]; then
  echo "Usage: $0 <setup.exe path> [release notes]" >&2
  exit 1
fi
if [[ ! -f "$SETUP_EXE" ]]; then
  echo "Error: setup.exe not found at $SETUP_EXE" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUST_FILE="$SCRIPT_DIR/src/chainremote_version.rs"
VERSION=$(grep -oE 'CHAINREMOTE_VERSION: &str = "[^"]+"' "$RUST_FILE" | sed -E 's/.*"([^"]+)".*/\1/')

if [[ -z "$VERSION" ]]; then
  echo "✗ ERROR — src/chainremote_version.rs 에서 버전을 못 읽음." >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✗ ERROR — 버전 형식이 X.Y.Z 가 아님: '$VERSION' (ssh 원격 명령에 그대로 들어가므로 엄격 검증)." >&2
  exit 1
fi

EXPECTED_NAME="ChainRemote_Agent_Setup_v${VERSION}.exe"
ACTUAL_NAME="$(basename "$SETUP_EXE")"
if [[ "$ACTUAL_NAME" != "$EXPECTED_NAME" ]]; then
  echo "✗ ERROR — 파일명($ACTUAL_NAME)이 src 버전($VERSION)과 안 맞음. src 범프 누락 또는 옛 빌드 재사용 의심." >&2
  echo "  기대 파일명: $EXPECTED_NAME" >&2
  exit 1
fi

NAS_HOST="${NAS_HOST:-chang@192.168.68.103}"
NAS_WEB_DIR="${NAS_WEB_DIR:-/volume1/web/chainremote}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://sepani.synology.me/chainremote}"

SHA256=$(shasum -a 256 "$SETUP_EXE" | awk '{print $1}')
SIZE=$(stat -f %z "$SETUP_EXE" 2>/dev/null || stat -c %s "$SETUP_EXE")
RELEASED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REMOTE_PATH="$NAS_WEB_DIR/$EXPECTED_NAME"

echo "[검증] 버전=$VERSION sha256=$SHA256 size=$SIZE"

# 1. NAS 에 같은 파일명이 이미 있으면 sha 대조만. 없으면 이 스크립트가 직접 원자적 업로드
#    (.partial + NAS측 sha 재검증 + mv)까지 겸한다.
#    ssh 자체가 실패(접속불가 등)한 경우와 "파일이 그냥 없음"을 구분 — 앞은 즉시 중단해야
#    이후 단계에서 혼란스러운 에러 대신 원인이 바로 드러난다.
SSH_ERR_LOG=$(mktemp)
set +e
EXISTING_SHA=$(ssh "$NAS_HOST" "test -f $REMOTE_PATH && sha256sum $REMOTE_PATH 2>/dev/null | awk '{print \$1}'" 2>"$SSH_ERR_LOG")
SSH_EXIT=$?
set -e
if [[ $SSH_EXIT -ne 0 && $SSH_EXIT -ne 1 ]]; then
  echo "✗ ERROR — NAS(ssh $NAS_HOST) 접속/명령 실패 (exit=$SSH_EXIT): $(cat "$SSH_ERR_LOG")" >&2
  rm -f "$SSH_ERR_LOG"
  exit 1
fi
rm -f "$SSH_ERR_LOG"
if [[ -n "$EXISTING_SHA" ]]; then
  if [[ "$EXISTING_SHA" != "$SHA256" ]]; then
    echo "✗ ERROR — NAS 에 같은 파일명이 다른 내용으로 이미 있음 (nas=$EXISTING_SHA local=$SHA256)." >&2
    exit 1
  fi
  echo "[1/3] NAS 에 이미 업로드됨(sha 일치) — 재업로드 skip."
else
  echo "[1/3] NAS 업로드 중 (atomic)..."
  TMP_REMOTE="$REMOTE_PATH.partial"
  ssh "$NAS_HOST" "cat > $TMP_REMOTE && chmod 644 $TMP_REMOTE" < "$SETUP_EXE"
  NAS_SHA=$(ssh "$NAS_HOST" "sha256sum $TMP_REMOTE | awk '{print \$1}'")
  if [[ "$NAS_SHA" != "$SHA256" ]]; then
    echo "✗ ERROR — 업로드 무결성 실패 (local=$SHA256 nas=$NAS_SHA)." >&2
    ssh "$NAS_HOST" "rm -f $TMP_REMOTE" 2>/dev/null || true
    exit 1
  fi
  ssh "$NAS_HOST" "mv -f $TMP_REMOTE $REMOTE_PATH"
  echo "    업로드 완료+검증."
fi

# 2. agent-push.json 원자적 갱신 (latest.json 은 절대 건드리지 않음).
echo "[2/3] agent-push.json 갱신 중..."
# NOTES_JSON 을 heredoc 밖에서 먼저 계산 — heredoc 안 command substitution 은 실패해도
#   바깥 cat 이 exit 0 이라 set -e 가 못 잡는다(적대적 재검증으로 확인된 실제 함정).
#   여기서 실패하면 META_JSON 조립 전에 끊어 깨진 JSON이 NAS 로 나가는 걸 막는다.
if ! NOTES_JSON=$(printf '%s' "$NOTES" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'); then
  echo "✗ ERROR — notes JSON 인코딩 실패(python3 확인 필요) — agent-push.json 갱신 중단." >&2
  exit 1
fi
META_JSON=$(cat <<EOF
{
  "version": "$VERSION",
  "url": "$PUBLIC_BASE_URL/$EXPECTED_NAME",
  "sha256": "$SHA256",
  "size": $SIZE,
  "released_at": "$RELEASED_AT",
  "notes": $NOTES_JSON
}
EOF
)
# 조립된 JSON 이 실제로 유효한지 NAS 로 보내기 전에 로컬에서 한 번 더 검증(2중 안전망).
if ! printf '%s' "$META_JSON" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  echo "✗ ERROR — 조립된 META_JSON 이 유효한 JSON 이 아님 — 발행 중단(NAS 안 건드림):" >&2
  echo "$META_JSON" >&2
  exit 1
fi
ssh "$NAS_HOST" "cat > $NAS_WEB_DIR/agent-push.json.tmp && mv -f $NAS_WEB_DIR/agent-push.json.tmp $NAS_WEB_DIR/agent-push.json" <<< "$META_JSON"

# 3. 공개 URL 검증 — 전파지연 대비 짧게 재시도(단발 curl 은 거짓실패 가능성 있었음).
echo "[3/3] 공개 URL 검증..."
LIVE_VERSION=""
for attempt in 1 2 3; do
  sleep 1
  LIVE=$(curl -sS --max-time 10 "$PUBLIC_BASE_URL/agent-push.json" || echo "")
  LIVE_VERSION=$(printf '%s' "$LIVE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || echo "")
  [[ "$LIVE_VERSION" == "$VERSION" ]] && break
  echo "    (재시도 $attempt/3, 아직 반영 안 됨)"
done
if [[ "$LIVE_VERSION" != "$VERSION" ]]; then
  echo "✗ ERROR — 발행 후 공개 URL 이 기대 버전과 다름 (got=$LIVE_VERSION want=$VERSION)." >&2
  exit 1
fi

echo ""
echo "✓ 발행 완료 — v$VERSION"
echo "  agent-push.json : $PUBLIC_BASE_URL/agent-push.json"
echo "  installer       : $PUBLIC_BASE_URL/$EXPECTED_NAME"
echo "  패널 [최신 가져오기] 버튼이 이제 이 버전을 가져옵니다."
