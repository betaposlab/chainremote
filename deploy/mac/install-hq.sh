#!/bin/bash
# Mac HQ 설치 — 빌드된 .app 을 /Applications 로 올리고, 서명하고, 띄우고, 검증한다.
#
# 왜 스크립트로 뺐나 (2026-08-16):
#   여태 CLAUDE.md 의 한 줄짜리 명령을 손으로 붙여 넣어 설치했는데, 그 명령에 두 개의
#   함정이 있었고 실제로 사고가 났다.
#
#   ① `pkill -9 RustDesk` — 이름이 "RustDesk" 인 **아무 프로세스나** 죽인다. 5월에 만든
#      맥용 에이전트 테스트 빌드의 실행파일 이름이 그대로 RustDesk 라 같이 죽었다.
#   ② `rm -rf /Applications/ChainRemote.app` 뒤 `open` — 두 앱이 같은 번들ID 를 쓰던 시절,
#      앱을 지운 그 순간 그 번들ID 를 가진 앱은 옛 에이전트 하나뿐이 된다. macOS
#      LaunchServices 는 앱을 경로가 아니라 **번들ID 로 색인**하므로, 그 창에서 엉뚱한 앱이
#      떴다. 화면에는 RustDesk 기본 홈이 뜨고 "새 버전 1.4.9" 배너까지 나왔다.
#
#   번들ID 는 이제 com.betaposlab.chainremote 로 갈라 놨지만, 그것만 믿지 않는다.
#   **띄운 뒤에 실제로 뜬 게 우리가 방금 설치한 그 경로인지 확인**한다. 조용히 다른 게
#   떠 있는 상태가 이 사고의 본질이었다.
set -euo pipefail

APP=/Applications/ChainRemote.app
SRC=flutter/build/macos/Build/Products/Release/ChainRemote.app
SIGN_ID="Developer ID Application: changhyun kim (5Q25RTUTDW)"
WANT_ID=com.betaposlab.chainremote

cd "$(dirname "$0")/../.."

[ -d "$SRC" ] || { echo "!! 빌드 산출물이 없습니다: $SRC"; exit 1; }

# 우리 앱만 정확히 죽인다 — 이름이 아니라 **경로**로 지목한다.
pkill -9 -f "$APP/Contents/MacOS/" 2>/dev/null || true
pkill -9 -f "$SRC/Contents/MacOS/" 2>/dev/null || true
sleep 1

rm -rf "$APP"
cp -R "$SRC" "$APP"
cp deploy/custom-hq.txt "$APP/Contents/Resources/custom.txt"

# ★ad-hoc 서명 금지 — 빌드마다 서명이 달라져 TCC 가 권한을 초기화하고, 재빌드 후 첫 원격
#   세션만 입력이 안 먹는 유령 버그가 된다. 반드시 Developer ID.
codesign --force --deep --sign "$SIGN_ID" "$APP"

GOT_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")
if [ "$GOT_ID" != "$WANT_ID" ]; then
  echo "!! 번들ID 가 다릅니다 — 설치를 중단합니다."
  echo "   기대: $WANT_ID / 실제: $GOT_ID"
  exit 1
fi

# LaunchServices 색인 갱신 — 방금 번들을 통째로 갈아 끼웠으므로, 옛 등록이 남아 있으면
#   open 이 유령 경로를 물 수 있다.
LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
[ -x "$LSREG" ] && "$LSREG" -f "$APP" >/dev/null 2>&1 || true

open "$APP"

# ★검증: 실제로 뜬 프로세스가 우리가 설치한 그 경로인가.
#   여기까지 와서야 "설치했다"고 말할 수 있다.
for i in $(seq 1 20); do
  RUNNING=$(pgrep -f "$APP/Contents/MacOS/ChainRemote" || true)
  [ -n "$RUNNING" ] && break
  sleep 1
done

if [ -z "${RUNNING:-}" ]; then
  echo "!! 앱이 뜨지 않았거나, 뜬 것이 우리가 설치한 경로가 아닙니다."
  echo "   지금 도는 ChainRemote/RustDesk 계열 프로세스:"
  ps aux | grep -iE "chainremote|rustdesk" | grep -v grep || echo "   (없음)"
  exit 1
fi

echo "설치 완료 — $APP"
echo "  번들ID : $GOT_ID"
echo "  PID    : $RUNNING"
echo "  서명   : $(codesign -dv "$APP" 2>&1 | grep TeamIdentifier || echo '확인 실패')"
