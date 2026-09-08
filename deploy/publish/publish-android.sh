#!/usr/bin/env bash
# 안드로이드 HQ(APK) 발행 — NAS 업로드 + android.json 갱신 + 공개 URL 로 실제 받아 sha 대조.
#
# 2026-09-09 신설. latest.json(Windows HQ 자동 업데이트가 읽는 파일)은 건드리지 않는다 —
#   거기 키를 보태다 형식이 틀어지면 HQ 전체의 업데이트가 멈춘다. 안드로이드는 자동 업데이트
#   경로가 없어(스토어 밖 APK) 파일을 따로 두는 쪽이 잃을 게 없다.
#   패널 라우트 /api/tenants/[id]/android 가 이 android.json 을 보고 최신으로 넘긴다.
#
# APK 만드는 법은 메모리 [project_android_hq_distribution] — cargo ndk(aarch64) → jniLibs →
#   flutter build apk. ★맥에선 bindgen 에 NDK sysroot 를 줘야 한다(kcp-sys·scrap).
#
# 사용: ./deploy/publish/publish-android.sh <ChainRemote_HQ_Android_vX.Y.Z.apk> ["릴리즈노트"]

set -euo pipefail

APK="${1:-}"
NOTES="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -z "$APK" || ! -f "$APK" ]]; then
  echo "사용법: $0 <ChainRemote_HQ_Android_vX.Y.Z.apk 경로> [릴리즈노트]" >&2
  exit 1
fi

VERSION=$(grep -oE 'CHAINREMOTE_VERSION: &str = "[^"]+"' "$REPO/src/chainremote_version.rs" | sed -E 's/.*"([^"]+)".*/\1/')
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✗ ERROR — 버전 형식 오류: '$VERSION'" >&2; exit 1
fi
EXPECTED_NAME="ChainRemote_HQ_Android_v${VERSION}.apk"
if [[ "$(basename "$APK")" != "$EXPECTED_NAME" ]]; then
  echo "✗ ERROR — 파일명($(basename "$APK"))이 src 버전($VERSION)과 불일치. 기대: $EXPECTED_NAME" >&2
  exit 1
fi
# APK 는 zip 이다 — 깨진 파일을 올리면 폰이 "패키지 파싱 오류"로만 답해 원인이 안 보인다.
if ! unzip -tq "$APK" >/dev/null 2>&1; then
  echo "✗ ERROR — APK 가 zip 으로 열리지 않습니다(빌드 산출물이 아니거나 손상)" >&2; exit 1
fi

NAS_HOST="${NAS_HOST:-chang@192.168.68.103}"
NAS_WEB_DIR="${NAS_WEB_DIR:-/volume1/web/chainremote}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://sepani.synology.me/chainremote}"
SHA256=$(shasum -a 256 "$APK" | awk '{print $1}')
SIZE=$(stat -f %z "$APK" 2>/dev/null || stat -c %s "$APK")
RELEASED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REMOTE_PATH="$NAS_WEB_DIR/$EXPECTED_NAME"

echo "[검증] Android HQ v$VERSION sha256=$SHA256 size=$SIZE"

# 1. 원자적 업로드(.partial + NAS 측 sha 재검증 + mv).
echo "[1/3] NAS 업로드 (atomic)..."
TMP="$REMOTE_PATH.partial"
ssh "$NAS_HOST" "cat > $TMP && chmod 644 $TMP" < "$APK"
NAS_SHA=$(ssh "$NAS_HOST" "sha256sum $TMP | awk '{print \$1}'")
if [[ "$NAS_SHA" != "$SHA256" ]]; then
  echo "✗ 업로드 무결성 실패 (nas=$NAS_SHA)" >&2; ssh "$NAS_HOST" "rm -f $TMP"; exit 1
fi
ssh "$NAS_HOST" "mv -f $TMP $REMOTE_PATH"
echo "    OK"

# 2. android.json 원자적 갱신.
echo "[2/3] android.json 갱신..."
NEW_JSON=$(VER="$VERSION" URL="$PUBLIC_BASE_URL/$EXPECTED_NAME" SHA="$SHA256" SZ="$SIZE" RAT="$RELEASED_AT" NT="$NOTES" python3 - <<'PY'
import json, os
print(json.dumps({
  "version": os.environ["VER"], "url": os.environ["URL"], "sha256": os.environ["SHA"],
  "size": int(os.environ["SZ"]), "released_at": os.environ["RAT"], "notes": os.environ["NT"],
}, ensure_ascii=False, indent=2))
PY
)
ssh "$NAS_HOST" "cat > $NAS_WEB_DIR/android.json.tmp && mv -f $NAS_WEB_DIR/android.json.tmp $NAS_WEB_DIR/android.json" <<< "$NEW_JSON"
echo "    OK"

# 3. 공개 URL 로 실제 받아 sha 대조 — "업로드 성공" 로그만 믿다 당한 적 있다(2026-07-22).
echo "[3/3] 공개 URL 검증 (실제 다운로드 + sha 대조)..."
LIVE_VER=$(curl -sS --max-time 10 "$PUBLIC_BASE_URL/android.json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null || echo "")
if [[ "$LIVE_VER" != "$VERSION" ]]; then
  echo "✗ ERROR — 공개 android.json 버전($LIVE_VER) != $VERSION" >&2; exit 1
fi
DL=$(mktemp)
curl -sS --max-time 300 -o "$DL" "$PUBLIC_BASE_URL/$EXPECTED_NAME"
LIVE_SHA=$(shasum -a 256 "$DL" | awk '{print $1}'); rm -f "$DL"
if [[ "$LIVE_SHA" != "$SHA256" ]]; then
  echo "✗ ERROR — 공개 URL 에서 받은 파일 sha 불일치 (live=$LIVE_SHA)" >&2; exit 1
fi
echo "    OK (공개 URL 다운로드 sha 일치)"

echo ""
echo "✅ Android HQ v$VERSION 발행 완료 — 패널 [안드로이드 앱 다운로드] 가 이 파일을 넘깁니다."
echo "   $PUBLIC_BASE_URL/$EXPECTED_NAME"
