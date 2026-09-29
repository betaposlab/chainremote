#!/usr/bin/env bash
# 임시 원격(626.kr [원격지원 받기])이 내려주는 상류 RustDesk 공식 exe 를 NAS 에 올린다.
#
# 무엇을 왜: chainremote-admin/lib/quick-support.ts 머리말. 요약하면 서명·평판이 있는 상류 파일을
#   한 바이트도 안 고치고 파일 이름으로만 우리 서버에 붙인다 — 그래서 여기서 하는 일은
#   "받아서, 공표된 해시와 맞는지 보고, 올리고, 공개 URL 로 다시 받아 대조"가 전부다.
#
# ★버전·해시는 lib/quick-support.ts 와 **같은 값**이어야 한다(패널이 그 해시로 검증하고
#   다르면 내주지 않는다). 버전을 올리면 평판이 0 에서 다시 시작하니 함부로 올리지 말 것.
#
# 사용: NAS_HOST=chang@100.93.42.91 ./deploy/publish/publish-quick-support.sh
set -euo pipefail

VER="1.4.6"
FILES=(
  "rustdesk-${VER}-x86_64.exe:422ce31131e6537ea4f611ebf4a4d1804f28a6f58c83aa05065071c5958f1551"
  "rustdesk-${VER}-x86-sciter.exe:1d009aef333dc9995bd4c1a58341fecfe4399352f5ce3fdfa6c545f1c155e93b"
)
NAS_HOST="${NAS_HOST:-chang@192.168.68.103}"
NAS_DIR="${NAS_DIR:-/volume1/web/chainremote/qs}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://sepani.synology.me/chainremote/qs}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

ssh "$NAS_HOST" "mkdir -p $NAS_DIR && chmod 755 $NAS_DIR"
for entry in "${FILES[@]}"; do
  name="${entry%%:*}"; want="${entry##*:}"
  echo "[$name]"
  curl -fsSL -o "$WORK/$name" "https://github.com/rustdesk/rustdesk/releases/download/${VER}/${name}"
  got=$(shasum -a 256 "$WORK/$name" | awk '{print $1}')
  if [[ "$got" != "$want" ]]; then
    echo "✗ 상류에서 받은 파일 해시가 기대와 다릅니다 (got=$got)" >&2; exit 1
  fi
  echo "    상류 해시 일치"
  ssh "$NAS_HOST" "cat > $NAS_DIR/$name.partial && chmod 644 $NAS_DIR/$name.partial" < "$WORK/$name"
  nas=$(ssh "$NAS_HOST" "sha256sum $NAS_DIR/$name.partial | awk '{print \$1}'")
  if [[ "$nas" != "$want" ]]; then
    echo "✗ 업로드 무결성 실패 (nas=$nas)" >&2; ssh "$NAS_HOST" "rm -f $NAS_DIR/$name.partial"; exit 1
  fi
  ssh "$NAS_HOST" "mv -f $NAS_DIR/$name.partial $NAS_DIR/$name"
  live=$(curl -fsSL --max-time 300 "$PUBLIC_BASE_URL/$name" | shasum -a 256 | awk '{print $1}')
  if [[ "$live" != "$want" ]]; then
    echo "✗ 공개 URL 에서 받은 파일 해시 불일치 (live=$live)" >&2; exit 1
  fi
  echo "    NAS 업로드 + 공개 URL 대조 일치"
done
echo ""
echo "✅ 임시 원격 원본 2개 발행 완료 — $PUBLIC_BASE_URL/"
