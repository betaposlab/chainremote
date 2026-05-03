#!/bin/bash
# ChainRemote Mac 재배포 — 빌드 후 매번 실행 (TCC 권한 자동 리셋 포함)
#
# 동작:
#   1. 실행 중인 ChainRemote/RustDesk 프로세스 종료
#   2. /Applications/ChainRemote.app 갱신 (빌드 폴더의 RustDesk.app 을 복사)
#   3. ad-hoc codesign — 순서 중요 (아래 주석 참조)
#   4. macOS TCC 권한 리셋 (ad-hoc 서명은 빌드마다 cdhash 가 바뀌어 silently invalidate)
#   5. 새 빌드 실행
#
# 운영 정책: ChainRemote.app 은 /Applications 에서만 실행한다.
#   - 빌드 폴더의 RustDesk.app 은 그대로 두지만 별도 ChainRemote.app 사본은 만들지 않음.
#   - 다른 path 에 동시에 두면 macOS 가 다른 앱으로 인식 → Dock 아이콘 중복 + TCC 권한 분리.
#
# 사용:
#   ./deploy/mac/redeploy.sh
# 또는 빌드 명령 끝에 && ./deploy/mac/redeploy.sh

set -e

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/flutter/build/macos/Build/Products/Release/RustDesk.app"
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

echo "[2/5] /Applications/ChainRemote.app 갱신..."
# 빌드 폴더에 stale ChainRemote.app 이 남아 있으면 제거 (Dock 중복 원인).
rm -rf "$REPO/flutter/build/macos/Build/Products/Release/ChainRemote.app"
rm -rf "$APPS"
cp -R "$SRC" "$APPS"

echo "[3/5] ad-hoc codesign — 정확한 순서: deep → service identifier 변경 → bundle 재봉인 (deep 없이)..."
# 함정 1: --deep 은 raw executable 의 --identifier 를 보존 안 함 (파일명 기반으로 재생성).
#         → 그래서 (1) deep 전체 서명 → (2) service 만 com.carriez.rustdesk 로 단독 재서명 → (3) bundle re-seal (deep 없이).
# 함정 2: 순서가 (1)→(3)→(2) 가 되면 bundle seal 이 옛 service hash 로 굳어 → Gatekeeper reject (앱 실행 거부).
# 함정 3: service identifier 가 service-XXX 로 남으면 main UI 와 분리돼 TCC 손쉬운 사용 권한이 service 에 적용 안 됨.
codesign --force --deep --sign - "$APPS" 2>&1 | tail -1
codesign --force --sign - --identifier "$BUNDLE_ID" "$APPS/Contents/MacOS/service" 2>&1 | tail -1
codesign --force --sign - "$APPS" 2>&1 | tail -1
codesign --verify --deep --strict "$APPS" && echo "  ✓ verify OK"

echo "[4/5] TCC 권한 전부 리셋 (ad-hoc 재서명 → cdhash 변경 → 기존 권한 silently invalidate 됨)..."
# 'All' 로 한 방에 — 개별 service 키는 macOS 버전마다 다르고, PostEvent 같은 핵심 키는 별도 이름이 필요함.
# tccd 로그 증거: "Failed to match existing code requirement for subject com.carriez.rustdesk and service kTCCServicePostEvent"
tccutil reset All "$BUNDLE_ID" 2>&1 | tail -1

echo "[5/5] 새 빌드 실행..."
open "$APPS"

echo ""
echo "✅ 배포 완료"
echo ""
echo "📌 다음에 윈컴에서 Mac으로 접속 시도하면 macOS 가 권한 팝업 띄움."
echo "   '시스템 설정 열기' 누르고 ChainRemote 토글 ON. 3개 (화면 기록 / 손쉬운 사용 / 입력 모니터링)."
echo "   ChainRemote 종료 알림 뜨면 종료 → Dock 에서 다시 실행."
