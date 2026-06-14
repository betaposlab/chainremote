#!/usr/bin/env bash
# ChainRemote 새 버전을 NAS 에 배포 — 거래처 PC 들이 자동 업데이트로 받아감.
#
# ★ 정석 워크플로 (절대 어기지 말 것)
#   1. (Mac) 새 버전 X.Y.Z 를 src 의 세 곳에 직접 동기화 + git commit + push
#        - src/chainremote_version.rs               : pub const CHAINREMOTE_VERSION: &str = "X.Y.Z";
#        - flutter/lib/common.dart                  : const chainRemoteVersion = 'X.Y.Z';
#        - deploy/win-installer/agent-installer.iss : #define APP_VERSION "X.Y.Z"
#        - deploy/win-installer/hq-installer.iss    : #define APP_VERSION "X.Y.Z"  (있으면)
#   2. (윈컴) git pull → build-all.ps1 → ISCC (agent) → ChainRemote_Agent_Setup_v*.exe
#   3. (Mac) SMB / 파일 전송으로 dist/ 에 가져옴
#   4. (Mac) ./deploy/release.sh dist/ChainRemote_Agent_Setup_v*.exe ["릴리즈 노트"]
#        → 거래처 자동업데이트 채널은 agent 전용. HQ (본사) 빌드는 NAS 푸시 X — 재성이 PC 에 수동 설치.
#
# 사용법: ./deploy/release.sh <agent setup.exe 경로> [릴리즈노트]
# 예시:   ./deploy/release.sh dist/ChainRemote_Agent_Setup_v1.3.0.exe "Phase 1 거래처 빌드"

set -euo pipefail

SETUP_EXE="${1:-}"
NOTES="${2:-}"

if [[ -z "$SETUP_EXE" ]]; then
  echo "Usage: $0 <setup.exe path> [release notes]"
  echo ""
  echo "버전은 src 에서 자동 추출. release.sh 호출 전 src 가 새 버전으로 업데이트되어 있어야 함."
  exit 1
fi
if [[ ! -f "$SETUP_EXE" ]]; then
  echo "Error: setup.exe not found at $SETUP_EXE" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ★ 버전 정합성 검증 — 세 곳에서 추출 + 일치 확인
RUST_FILE="$SCRIPT_DIR/src/chainremote_version.rs"
DART_FILE="$SCRIPT_DIR/flutter/lib/common.dart"
ISS_FILE="$SCRIPT_DIR/deploy/win-installer/agent-installer.iss"

RUST_VERSION=$(grep -oE 'CHAINREMOTE_VERSION: &str = "[^"]+"' "$RUST_FILE" | sed -E 's/.*"([^"]+)".*/\1/')
DART_VERSION=$(grep -oE "chainRemoteVersion = '[^']+'" "$DART_FILE" | sed -E "s/.*'([^']+)'.*/\1/")
ISS_VERSION=$(grep -oE '#define APP_VERSION[[:space:]]+"[^"]+"' "$ISS_FILE" | sed -E 's/.*"([^"]+)".*/\1/')

echo "[검증] src 의 버전 일치 확인:"
echo "  - Rust  ($RUST_FILE)"
echo "      → CHAINREMOTE_VERSION = \"$RUST_VERSION\""
echo "  - Dart  ($DART_FILE)"
echo "      → chainRemoteVersion = '$DART_VERSION'"
echo "  - ISS   ($ISS_FILE)"
echo "      → APP_VERSION \"$ISS_VERSION\""

if [[ -z "$RUST_VERSION" || "$RUST_VERSION" != "$DART_VERSION" || "$RUST_VERSION" != "$ISS_VERSION" ]]; then
  echo ""
  echo "✗ ERROR — 세 곳의 버전이 불일치." >&2
  echo "  release.sh 는 빌드된 setup.exe 의 binary 와 NAS push 의 버전이 일치해야 동작합니다." >&2
  echo "  세 파일을 동일 버전으로 맞춘 후 commit + 윈컴에서 재빌드 → setup.exe 다시 받아 → 다시 호출하세요." >&2
  exit 1
fi

# 추가 안전망: src 가 git uncommitted 면 경고
cd "$SCRIPT_DIR"
if ! git diff --quiet "$RUST_FILE" "$DART_FILE" "$ISS_FILE" 2>/dev/null; then
  echo ""
  echo "⚠ 경고 — 세 src 파일 중 git uncommitted 변경이 있습니다." >&2
  echo "  빌드된 setup.exe 가 이 src 와 일치하는지 확인하세요." >&2
  echo "  (commit 후 윈컴 재빌드 권장. 무시하고 진행하려면 5초 안에 Ctrl+C 안 누르면 진행)" >&2
  sleep 5
fi

VERSION="$RUST_VERSION"

NAS_HOST="${NAS_HOST:-chang@192.168.68.103}"
NAS_WEB_DIR="${NAS_WEB_DIR:-/volume1/web/chainremote}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://sepani.synology.me/chainremote}"

REMOTE_FILENAME="ChainRemote_Agent_Setup_v${VERSION}.exe"
SHA256=$(shasum -a 256 "$SETUP_EXE" | awk '{print $1}')
SIZE=$(stat -f %z "$SETUP_EXE" 2>/dev/null || stat -c %s "$SETUP_EXE")
RELEASED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# 같은 버전 두 번 push 차단 (실수 방지)
echo "[검증] NAS 에 동일 버전 / 동일 SHA256 이 이미 있는지 확인..."
EXISTING=$(ssh "$NAS_HOST" "test -f $NAS_WEB_DIR/$REMOTE_FILENAME && sha256sum $NAS_WEB_DIR/$REMOTE_FILENAME 2>/dev/null | awk '{print \$1}'" 2>/dev/null || echo "")
if [[ -n "$EXISTING" && "$EXISTING" != "$SHA256" ]]; then
  echo ""
  echo "✗ ERROR — NAS 에 같은 이름의 v$VERSION 이 이미 있고, SHA256 가 다릅니다." >&2
  echo "  NAS  SHA256: $EXISTING" >&2
  echo "  로컬 SHA256: $SHA256" >&2
  echo "  같은 버전 번호로 다른 binary push 시도 = 빌드 시점 src 변경 누락 가능성." >&2
  echo "  버전 번호를 올린 후 (src 의 세 곳 모두) commit + 재빌드 + 다시 시도하세요." >&2
  exit 1
fi

echo ""
echo "  - Version    : $VERSION"
echo "  - File       : $SETUP_EXE ($((SIZE / 1024 / 1024)) MB)"
echo "  - SHA-256    : $SHA256"
echo "  - Released   : $RELEASED_AT"
echo "  - Remote URL : $PUBLIC_BASE_URL/$REMOTE_FILENAME"
echo ""

# 1. 인스톨러 업로드 — Synology SFTP 가 사용자를 home dir 에 chroot 시키므로 SCP 대신 ssh stream 사용.
#    ★ 원자적(H6): .partial 로 올린 뒤 SHA 검증을 통과해야만 최종 파일명으로 mv. 전송 중단/부분 파일이
#    최종 경로에 노출돼 거래처가 깨진 .exe 를 받고 sha-mismatch 무한 재다운에 빠지는 사고 차단.
#    (latest.json 과 동일한 tmp→mv 패턴. 실패해도 기존 최종 파일은 손대지 않아 옛 버전 그대로 안전.)
TMP_REMOTE="$NAS_WEB_DIR/$REMOTE_FILENAME.partial"
echo "[1/4] Uploading installer to NAS (atomic via .partial)..."
ssh "$NAS_HOST" "cat > $TMP_REMOTE && chmod 644 $TMP_REMOTE" < "$SETUP_EXE"

# 2. 최종 경로로 옮기기 전 NAS 측 SHA256 재검증 (전송 무결성) → 통과해야만 atomic mv (publish).
echo "[2/4] Verifying upload integrity (NAS-side SHA256) before publish..."
NAS_SHA=$(ssh "$NAS_HOST" "sha256sum $TMP_REMOTE | awk '{print \$1}'")
if [[ "$NAS_SHA" != "$SHA256" ]]; then
  echo "✗ Upload SHA256 mismatch: local=$SHA256, nas=$NAS_SHA" >&2
  echo "  부분 전송분(.partial) 정리 후 종료 — 최종 파일/옛 버전은 건드리지 않음." >&2
  ssh "$NAS_HOST" "rm -f $TMP_REMOTE" 2>/dev/null || true
  exit 1
fi
# 검증 통과 → 최종 파일명으로 원자적 교체 (이 mv 성공 이후에만 latest.json 갱신)
ssh "$NAS_HOST" "mv -f $TMP_REMOTE $NAS_WEB_DIR/$REMOTE_FILENAME"

# 3. latest.json 갱신 (atomic — 임시 파일에 쓰고 mv)
echo "[3/4] Updating latest.json..."
LATEST_JSON=$(cat <<EOF
{
  "version": "$VERSION",
  "url": "$PUBLIC_BASE_URL/$REMOTE_FILENAME",
  "sha256": "$SHA256",
  "size": $SIZE,
  "released_at": "$RELEASED_AT",
  "notes": $(printf '%s' "$NOTES" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
}
EOF
)
ssh "$NAS_HOST" "cat > $NAS_WEB_DIR/latest.json.tmp && mv -f $NAS_WEB_DIR/latest.json.tmp $NAS_WEB_DIR/latest.json" <<< "$LATEST_JSON"

# 4. 공개 URL 검증
echo "[4/4] Verifying public URL..."
sleep 2
PUBLISHED_VERSION=$(curl -fsSL "$PUBLIC_BASE_URL/latest.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
if [[ "$PUBLISHED_VERSION" != "$VERSION" ]]; then
  echo "  ✗ Verification failed: expected $VERSION, got $PUBLISHED_VERSION" >&2
  exit 1
fi

echo ""
echo "Release published. v$VERSION 가 NAS 에 게시됨."
echo "  → 거래처 PC 가 다음 부팅 시 또는 24h 안에 자동 갱신 받음."
echo "  → 빠른 시연: push.json 박기 (TODO: 별도 헬퍼 스크립트)"
