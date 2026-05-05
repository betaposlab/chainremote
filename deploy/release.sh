#!/usr/bin/env bash
# ChainRemote 새 버전을 NAS 에 배포 — 거래처 PC 들이 자동 업데이트로 받아감.
#
# 사용법:
#   ./deploy/release.sh <setup.exe 경로> <버전> [릴리즈노트]
#
# 예시:
#   ./deploy/release.sh ~/Downloads/ChainRemote_Setup.exe 1.2.0 "기본 설정 자동 적용"
#
# 사전 준비 (1회):
#   - NAS 에 SSH 키 인증 (CLAUDE.md 참조)
#   - NAS 의 /volume1/web/chainremote/ 디렉터리 + Web Station 활성화
#   - 도메인 sepani.synology.me 가 NAS 의 80/443 포트로 라우팅됨

set -euo pipefail

SETUP_EXE="${1:-}"
VERSION="${2:-}"
NOTES="${3:-}"

if [[ -z "$SETUP_EXE" || -z "$VERSION" ]]; then
  echo "Usage: $0 <setup.exe path> <version> [release notes]"
  exit 1
fi
if [[ ! -f "$SETUP_EXE" ]]; then
  echo "Error: setup.exe not found at $SETUP_EXE" >&2
  exit 1
fi

NAS_HOST="${NAS_HOST:-chang@192.168.68.103}"
NAS_WEB_DIR="${NAS_WEB_DIR:-/volume1/web/chainremote}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://sepani.synology.me/chainremote}"

REMOTE_FILENAME="ChainRemote_Setup_v${VERSION}.exe"
SHA256=$(shasum -a 256 "$SETUP_EXE" | awk '{print $1}')
SIZE=$(stat -f %z "$SETUP_EXE" 2>/dev/null || stat -c %s "$SETUP_EXE")
RELEASED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "  - Version    : $VERSION"
echo "  - File       : $SETUP_EXE ($((SIZE / 1024 / 1024)) MB)"
echo "  - SHA-256    : $SHA256"
echo "  - Released   : $RELEASED_AT"
echo "  - Remote URL : $PUBLIC_BASE_URL/$REMOTE_FILENAME"
echo

# 1. 인스톨러 업로드 (versioned filename) — 같은 이름으로 덮어쓰지 않도록 -n 옵션은 일부러 빼서 강제 덮어쓰기 가능
echo "[1/3] Uploading installer to NAS..."
scp "$SETUP_EXE" "$NAS_HOST:$NAS_WEB_DIR/$REMOTE_FILENAME"

# 2. latest.json 갱신 (atomic — 임시 파일에 쓰고 mv)
echo "[2/3] Updating latest.json..."
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

# 3. 검증 — 공개 URL 에서 정상 응답 오는지 확인
echo "[3/3] Verifying public URL..."
sleep 2
PUBLISHED_VERSION=$(curl -fsSL "$PUBLIC_BASE_URL/latest.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
if [[ "$PUBLISHED_VERSION" != "$VERSION" ]]; then
  echo "  ✗ Verification failed: expected $VERSION, got $PUBLISHED_VERSION" >&2
  exit 1
fi

echo
echo "Release published. Existing ChainRemote installations will pick this up within 24h."
echo "  → 즉시 반영 확인은 거래처 PC 에서 ChainRemote 서비스 재시작."
