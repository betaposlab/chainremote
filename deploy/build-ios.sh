#!/bin/bash
# iOS HQ 빌드(맥) + 연결된 기기에 설치. 산출물 = flutter/build/ios/iphoneos/Runner.app
#
#   ./deploy/build-ios.sh              # 빌드만
#   ./deploy/build-ios.sh <기기 id>     # 빌드 + 설치 + 실행 (id 는 `xcrun devicectl list devices`)
#
# 서명은 Xcode 프로젝트의 자동 서명(팀 5Q25RTUTDW). 배포 경로(TestFlight)는 아직 없어 기기에 직접 깐다.
#   ★자동 업데이트가 없다 — 고친 게 있으면 기기마다 이걸로 다시 깔아야 한다.
#
# 함정:
#   - VCPKG_ROOT 를 빠뜨리면 scrap 빌드가 죽고, 옛 .a 가 남아 있으면 flutter 가 조용히 옛 코어로 앱을 만든다.
#     그래서 set -e 로 멈추고, 코어가 버전 파일보다 새것인지 한 번 더 본다.
#   - hwcodec 은 뺀다(vcpkg arm64-ios 에 ffmpeg 가 없다).
#   - 저장소 경로에 한글(내작업)이 있어 UTF-8 이 아니면 CocoaPods 가 경로 정규화에서 죽는다.
#   - SDKROOT 가 맥 SDK 로 잡혀 있으면 iOS 타깃이 엉뚱한 SDK 를 집는다.
#   - ★Xcode 27(iOS 27 SDK)부터 UIScene 이 없으면 iOS 가 실행을 거부한다(2026-10-19, AppDelegate.swift 참조).
#     켜자마자 꺼지면 크래시 리포트가 없으니 os_log 를 콘솔로 돌려 본다:
#       xcrun devicectl device process launch --console --terminate-existing \
#         --environment-variables '{"OS_ACTIVITY_DT_MODE":"YES"}' --device <id> com.betaposlab.chainremote
set -euo pipefail
cd "$(dirname "$0")/.."

source "$HOME/.cargo/env"
rustup default 1.81 >/dev/null
export PATH="$HOME/flutter-3.24.5/bin:$PATH"
export VCPKG_ROOT="$HOME/vcpkg"
unset SDKROOT
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
DEV="${1:-}"
A=target/aarch64-apple-ios/release/liblibrustdesk.a

echo "[1/3] Rust 코어 (aarch64-apple-ios, hwcodec 없이)..."
cargo build --features flutter --release --target aarch64-apple-ios --lib
# "이번 실행 시각" 이 아니라 버전 파일과 비교한다 — 코드가 안 바뀌어 cargo 가 아무것도 안 하면
#   멀쩡한 새 코어도 시각 비교에선 실패로 나온다.
if [ ! "$A" -nt src/chainremote_version.rs ]; then
  echo "✗ $A 가 버전 반영 전 코어입니다 — 옛 코어로 앱이 나갈 뻔했습니다" >&2
  exit 1
fi

echo "[2/3] Flutter iOS..."
(cd flutter && rm -rf .dart_tool && flutter pub get >/dev/null && (cd ios && pod install) && flutter build ios --release)
APP=flutter/build/ios/iphoneos/Runner.app
[ -d "$APP" ] || { echo "✗ $APP 이 없습니다" >&2; exit 1; }

if [ -z "$DEV" ]; then
  echo "✓ $APP — 기기에 깔려면: ./deploy/build-ios.sh <기기 id>"
  exit 0
fi
echo "[3/3] 기기 설치 + 실행 ($DEV)..."
xcrun devicectl device install app --device "$DEV" "$APP"
xcrun devicectl device process launch --device "$DEV" com.betaposlab.chainremote || true
echo "✓ 설치 완료"
