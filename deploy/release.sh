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

# ChainRemote 버전 상수 3개를 모두 입력값과 동기화 (다음 빌드부터 새 버전으로 표시)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[0/3] Syncing CHAINREMOTE_VERSION = $VERSION across source ..."
# Rust 측 (별도 파일 — version.rs 는 빌드 자동 생성이라 .gitignore)
sed -i.bak "s/^pub const CHAINREMOTE_VERSION: &str = .*/pub const CHAINREMOTE_VERSION: \&str = \"$VERSION\";/" \
  "$SCRIPT_DIR/src/chainremote_version.rs"
# Flutter 측
sed -i.bak "s/^const chainRemoteVersion = .*/const chainRemoteVersion = '$VERSION';/" \
  "$SCRIPT_DIR/flutter/lib/common.dart"
# Inno Setup 측
sed -i.bak "s/^#define APP_VERSION    .*/#define APP_VERSION    \"$VERSION\"/" \
  "$SCRIPT_DIR/deploy/win-installer/installer.iss"
rm -f "$SCRIPT_DIR/src/chainremote_version.rs.bak" \
      "$SCRIPT_DIR/flutter/lib/common.dart.bak" \
      "$SCRIPT_DIR/deploy/win-installer/installer.iss.bak"
echo "  → 다음 빌드부터 v$VERSION 표시. 변경 사항 commit 잊지 말 것."


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

# 1. 인스톨러 업로드 — Synology SFTP 가 사용자를 home dir 에 chroot 시키므로 SCP 대신 ssh stream 사용
echo "[1/3] Uploading installer to NAS (via ssh stream)..."
ssh "$NAS_HOST" "cat > $NAS_WEB_DIR/$REMOTE_FILENAME && chmod 644 $NAS_WEB_DIR/$REMOTE_FILENAME" < "$SETUP_EXE"

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
