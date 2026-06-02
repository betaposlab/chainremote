#!/bin/bash
# ChainRemote Mac(HQ) 재배포 — 빌드 후 실행.
# (2026-06-02 갱신: 빌드 산출물 ChainRemote.app + Developer ID 서명 + HQ custom.txt)
#
# 동작:
#   1. 실행 중인 ChainRemote/RustDesk 종료
#   2. /Applications/ChainRemote.app 갱신 (빌드 폴더의 ChainRemote.app 복사)
#   3. HQ custom.txt(custom-hq.txt) 적용 — 서명 전에 넣어 seal 에 포함
#   4. Developer ID 서명 (ad-hoc 금지 — cdhash 안정 → TCC 권한 유지, 매 빌드 재요청 없음)
#   5. 실행
#
# 운영 정책: ChainRemote.app 은 /Applications 에서만 실행 (다른 path 동시 존재 = Dock 중복 + TCC 분리).
#
# 사용: ./deploy/mac/redeploy.sh   (또는 빌드 명령 끝에 && 로 연결)

set -e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/flutter/build/macos/Build/Products/Release/ChainRemote.app"
APPS="/Applications/ChainRemote.app"
# Developer ID — TCC(화면기록/손쉬운사용/입력모니터링) 권한이 빌드마다 유지됨.
# (ad-hoc 은 cdhash 가 매번 바뀌어 권한이 silently invalidate → tccutil 리셋 필요했음)
SIGN_ID="Developer ID Application: changhyun kim (5Q25RTUTDW)"

if [ ! -d "$SRC" ]; then
  echo "❌ 빌드 결과물 없음: $SRC"
  echo "   먼저 'python3 ./build.py --flutter --unix-file-copy-paste --screencapturekit' 실행"
  exit 1
fi

echo "[1/4] 실행 중인 프로세스 종료..."
pkill -9 -x RustDesk 2>/dev/null || true
pkill -9 -x ChainRemote 2>/dev/null || true
sleep 1

echo "[2/4] /Applications/ChainRemote.app 갱신 + HQ custom.txt..."
rm -rf "$REPO/flutter/build/macos/Build/Products/Release/ChainRemote.app.bak" 2>/dev/null || true
rm -rf "$APPS"
cp -R "$SRC" "$APPS"
cp "$REPO/deploy/custom-hq.txt" "$APPS/Contents/Resources/custom.txt"

echo "[3/4] Developer ID 서명..."
codesign --force --deep --sign "$SIGN_ID" "$APPS"
codesign -dvv "$APPS" 2>&1 | grep -iE "Authority=Developer|TeamIdentifier" | head -2 || true

echo "[4/4] 실행..."
open "$APPS"

echo ""
echo "✅ 배포 완료 (Developer ID 서명 — TCC 권한 유지, 재요청 없음)"
echo "   ad-hoc→Developer ID 최초 전환이거나 권한 팝업 뜨면 1회만 허용하면 됩니다."
