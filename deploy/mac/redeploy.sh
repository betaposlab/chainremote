#!/bin/bash
# ChainRemote Mac 재배포 — 빌드 후 매번 실행 (TCC 권한 자동 리셋 포함)
#
# 동작:
#   1. 실행 중인 ChainRemote/RustDesk 프로세스 종료
#   2. /Applications/ChainRemote.app + 빌드 폴더의 ChainRemote.app 양쪽 갱신
#   3. ad-hoc codesign
#   4. macOS TCC 권한 리셋 (ad-hoc 서명은 빌드마다 cdhash 가 바뀌어 TCC 가 silently invalidate)
#      → 다음 실행 시 macOS 가 권한 팝업 다시 띄움 → 사용자가 한 번 ON 해주면 됨
#   5. 새 빌드 실행
#
# 사용:
#   ./deploy/mac/redeploy.sh
# 또는 빌드 명령 끝에 && ./deploy/mac/redeploy.sh

set -e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/flutter/build/macos/Build/Products/Release/RustDesk.app"
DOCK="$REPO/flutter/build/macos/Build/Products/Release/ChainRemote.app"
APPS="/Applications/ChainRemote.app"
BUNDLE_ID="com.carriez.rustdesk"

if [ ! -d "$SRC" ]; then
  echo "❌ 빌드 결과물 없음: $SRC"
  echo "   먼저 'python3 ./build.py --flutter --unix-file-copy-paste --screencapturekit' 실행"
  exit 1
fi

echo "[1/5] 실행 중인 프로세스 종료..."
pkill -x RustDesk 2>/dev/null || true
pkill -x ChainRemote 2>/dev/null || true
sleep 1

echo "[2/5] 새 빌드 양쪽 경로 동기화..."
rm -rf "$DOCK" "$APPS"
cp -R "$SRC" "$DOCK"
cp -R "$SRC" "$APPS"

echo "[3/5] ad-hoc codesign..."
codesign --force --deep --sign - "$APPS" 2>&1 | tail -1
codesign --force --deep --sign - "$DOCK" 2>&1 | tail -1

echo "[4/5] TCC 권한 리셋 (ScreenCapture / Accessibility / ListenEvent)..."
tccutil reset ScreenCapture "$BUNDLE_ID" 2>&1 | grep -v "^Successfully" | head -1 || true
tccutil reset Accessibility "$BUNDLE_ID" 2>&1 | grep -v "^Successfully" | head -1 || true
tccutil reset ListenEvent "$BUNDLE_ID" 2>&1 | grep -v "^Successfully" | head -1 || true

echo "[5/5] 새 빌드 실행..."
open "$APPS"

echo ""
echo "✅ 배포 완료"
echo ""
echo "📌 다음에 윈컴에서 Mac으로 접속 시도하면 macOS 가 권한 팝업 띄움."
echo "   '시스템 설정 열기' 누르고 ChainRemote 토글 ON. 3개 (화면 기록 / 손쉬운 사용 / 입력 모니터링)."
echo "   ChainRemote 종료 알림 뜨면 종료 → Dock 에서 다시 실행."
