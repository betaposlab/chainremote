#!/bin/bash
# 안드로이드 HQ APK 빌드 (맥). 산출물 = dist/ChainRemote_HQ_Android_v<버전>.apk
#
# 발행은 따로: NAS_HOST=chang@100.93.42.91 ./deploy/publish/publish-android.sh <apk> "노트"
#   (집이면 NAS_HOST=chang@192.168.68.103)
#
# 서명은 flutter/android/key.properties(git-ignored)가 가리키는 업로드 키로 자동 —
#   ~/ChainRemote-keys/chainremote-upload.jks. 이 키를 잃으면 같은 앱으로 업데이트를 못 낸다.
#
# 함정(2026-09-08 실측):
#   - bindgen(libclang)이 맥에선 --sysroot 없이 stdlib.h·inttypes.h 를 못 찾아 kcp-sys·scrap 에서 죽는다.
#     리눅스 CI 는 호스트 헤더로 넘어가서 안 드러난다.
#   - Rust 빌드가 실패해도 jniLibs 에 옛 .so 가 남아 있으면 flutter 가 조용히 옛 코어로 APK 를 만든다.
#     그래서 set -e 로 멈추고, 복사한 .so 가 이번에 만든 것인지 시각으로 한 번 더 본다.
#   - ★hwcodec 은 기본으로 뺀다(2026-10-19). 9월 이후 상류 hwcodec 이 libswresample 을 요구하게 됐는데
#     vcpkg 의 arm64-android ffmpeg 엔 avcodec·avutil 만 있어 "could not find native static library
#     swresample" 로 죽는다. 맥 데스크톱·iOS HQ 도 hwcodec 없이 나간다 — 뷰어는 소프트웨어 디코드로 충분하다.
#     꼭 넣으려면 vcpkg 로 arm64-android ffmpeg 를 swresample 포함해 다시 빌드한 뒤 HWCODEC=1.
#   - ★libsodium 이 빈 묶음이 되면 앱이 켜지자마자 죽는다(2026-10-19). libsodium-sys 는 원본 소스를
#     ./configure 로 빌드하면서 컴파일러(CC)만 넘기고 묶는 도구(ar)는 안 넘긴다. NDK 엔
#     aarch64-linux-android-ar 가 없어서 configure 가 맥의 ar 로 떨어지는데, Xcode 27 의 ar 는
#     안드로이드(ELF) 조각을 버리고 96바이트짜리 빈 libsodium.a 를 만든다. .so 는 정의 안 된 기호를
#     허용하므로 빌드는 "성공"하고, 폰에서 dlopen 이 sodium_base64_encoded_len 을 못 찾아 죽는다.
#     보조 실행파일(naming)이 링크에서 죽은 게 유일한 신호였다. 그래서 ①NDK 의 llvm-ar 를 쓰게 하고
#     ②이미 빈 묶음이 있으면 지워서 다시 만들고 ③빌드 뒤 .so 에 sodium 기호가 비어 있지 않은지 본다.
set -euo pipefail
cd "$(dirname "$0")/.."

source "$HOME/.cargo/env"
rustup default 1.81 >/dev/null
export PATH="$HOME/flutter-3.24.5/bin:$PATH"
export VCPKG_ROOT="$HOME/vcpkg"
NDK="${ANDROID_NDK_HOME:-$HOME/Library/Android/sdk/ndk/30.0.14904198}"
export ANDROID_NDK_HOME="$NDK"
export BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android="--sysroot=$NDK/toolchains/llvm/prebuilt/darwin-x86_64/sysroot --target=aarch64-linux-android21"
LLVM="$NDK/toolchains/llvm/prebuilt/darwin-x86_64/bin"

VER=$(grep -oE 'CHAINREMOTE_VERSION: &str = "[^"]+"' src/chainremote_version.rs | sed -E 's/.*"([^"]+)".*/\1/')
[ -n "$VER" ] || { echo "✗ 버전을 못 읽었습니다(src/chainremote_version.rs)" >&2; exit 1; }
echo "[1/3] Rust 코어 (aarch64-linux-android, v$VER)..."
FEATURES=flutter
[ "${HWCODEC:-0}" = "1" ] && FEATURES=flutter,hwcodec
# 이미 빈 libsodium 묶음이 만들어져 있으면 지워서 다시 만들게 한다. 이 크레이트는 SODIUM_* 환경만
#   보고 다시 빌드할지 정하므로, AR 을 고쳐도 cargo 는 옛 빈 묶음을 계속 쓴다.
for A in target/aarch64-linux-android/release/build/libsodium-sys-*/out/installed/lib/libsodium.a; do
  [ -f "$A" ] || continue
  if ! "$LLVM/llvm-nm" "$A" 2>/dev/null | grep -q " T crypto_box_easy$"; then
    echo "    libsodium 묶음이 비어 있어 다시 만듭니다 ($A)"
    cargo clean -p libsodium-sys --release --target aarch64-linux-android
    break
  fi
done
# --lib: 앱엔 라이브러리(.so) 하나만 들어간다. 보조 실행파일(naming 등)은 APK 에 안 들어간다.
#   ★그 실행파일의 링크 실패(crypto_sign_ed25519_open)는 libsodium 이 빈 묶음이라는 신호였고 .so 도
#   같이 망가져 있었다 — 아래 기호 검사가 그 신호를 대신한다.
# AR·RANLIB·NM: autotools(libsodium 의 configure) 가 환경에서 읽는다. 이 명령에만 건다(Flutter·Gradle
#   단계엔 안 새게). 맥용으로 컴파일되는 것들은 cc 크레이트가 HOST_AR 를 먼저 보므로 종전대로 시스템 ar.
AR="$LLVM/llvm-ar" RANLIB="$LLVM/llvm-ranlib" NM="$LLVM/llvm-nm" HOST_AR=/usr/bin/ar \
  cargo ndk --platform 21 --target aarch64-linux-android build --release --lib --features "$FEATURES"

SO=target/aarch64-linux-android/release/liblibrustdesk.so
# 암호화(libsodium)가 .so 안에 들어갔는지. 정의 안 된 채 남으면 폰에서 앱이 켜지자마자 죽는다.
MISSING=$("$LLVM/llvm-nm" -D --undefined-only "$SO" | grep -E ' U (sodium_|crypto_|randombytes_)' || true)
if [ -n "$MISSING" ]; then
  echo "✗ $SO 에 libsodium 이 빠졌습니다 — 이대로면 앱이 켜지자마자 죽습니다:" >&2
  echo "$MISSING" | head -5 >&2
  exit 1
fi
# 버전을 올린 뒤에 만든 코어여야 한다. "이번 실행 시각" 과 비교하면 코드가 안 바뀌어 cargo 가 아무것도
#   안 했을 때 멀쩡한 새 코어도 실패로 나온다 — 그래서 버전 파일과 비교한다.
if [ ! "$SO" -nt src/chainremote_version.rs ]; then
  echo "✗ $SO 가 v$VER 반영 전 코어입니다 — 옛 코어로 APK 가 나갈 뻔했습니다" >&2
  exit 1
fi
mkdir -p flutter/android/app/src/main/jniLibs/arm64-v8a
cp "$SO" flutter/android/app/src/main/jniLibs/arm64-v8a/librustdesk.so

echo "[2/3] Flutter APK..."
(cd flutter && rm -rf .dart_tool && flutter pub get >/dev/null && flutter build apk --release --target-platform android-arm64)

echo "[3/3] 산출물..."
mkdir -p dist
OUT="dist/ChainRemote_HQ_Android_v$VER.apk"
cp flutter/build/app/outputs/flutter-apk/app-release.apk "$OUT"
echo "✓ $OUT ($(stat -f %z "$OUT") bytes, sha256 $(shasum -a 256 "$OUT" | cut -c1-16)…)"
