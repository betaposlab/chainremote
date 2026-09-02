#!/usr/bin/env bash
# betaposlab.com 첫 화면(www/index.html) 배포 — 이 파일 한 장만 다룬다.
#
# publish-landing.sh 와 다른 이유: 저쪽은 www/chainremote/ 를 다루고 이건 웹 루트다.
#   같은 스크립트에 넣으면 랜딩을 올릴 때마다 회사 첫 화면까지 덮어쓰게 된다 — 서로 다른
#   주기로 바뀌는 것을 한 손잡이에 묶지 않는다.
#
# ★www/ 의 나머지 58개 파일은 별개의 PHP 앱이다(billing·cart·dashboard·config·database).
#   건드리지 않는다. 범위는 deploy/web/betaposlab/README.md 참조.
#
# 사용: ./deploy/publish/publish-homepage.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$REPO/deploy/web/betaposlab/index.html"
HOST="betaposlab.com"
USER="betapos"
PUBLIC_URL="https://betaposlab.com/"

[[ -f "$SRC" ]] || { echo "✗ 원본이 없습니다: $SRC" >&2; exit 1; }

echo "════ 회사 홈페이지 배포 (betaposlab.com) ════"

# 비번 — publish-landing.sh 와 같은 방식(환경변수 우선, 없으면 FileZilla 기록).
PW="${CAFE24_PW:-}"
if [[ -z "$PW" ]]; then
  PW="$(python3 - <<'PY'
import re, base64, os, sys
p = os.path.expanduser('~/.config/filezilla/recentservers.xml')
try: h = open(p, encoding='utf-8', errors='replace').read()
except OSError: sys.exit(0)
for m in re.finditer(r'<Server>.*?</Server>', h, re.S):
    s = m.group(0)
    if 'betaposlab.com' in s:
        q = re.search(r'<Pass encoding="base64">([^<]*)</Pass>', s)
        if q: print(base64.b64decode(q.group(1)).decode()); break
PY
)"
fi
[[ -n "$PW" ]] || { echo "✗ Cafe24 비번을 못 찾음 — CAFE24_PW 환경변수로 주세요." >&2; exit 1; }

# ── [1/3] 올리기 전에 서버 것을 백업한다 ─────────────────────────────────────
# 회사 첫 화면이고 PHP 앱과 같은 디렉터리에 있다. 되돌릴 것을 손에 쥐고 시작한다.
BAK="$REPO/dist/homepage-backup-$(date +%Y%m%d-%H%M%S).html"
mkdir -p "$REPO/dist"
echo "[1/3] 현재 라이브 백업..."
if curl -fsS --max-time 25 "$PUBLIC_URL" -o "$BAK"; then
  echo "    ✓ $BAK ($(wc -c <"$BAK" | tr -d ' ') bytes)"
else
  echo "✗ 백업 실패 — 되돌릴 것 없이 올리지 않는다." >&2; exit 1
fi

echo "[2/3] 업로드..."
lftp -e "set sftp:auto-confirm yes; set net:timeout 20; put -O www $SRC; quit" \
     -u "$USER","$PW" "sftp://$HOST:22" >/dev/null
echo "    ✓ 전송 완료"

# ── [3/3] 올렸다고 믿지 않는다 — 공개 URL 로 받아 대조 ───────────────────────
echo "[3/3] 공개 URL 검증..."
LOCAL="$(shasum -a 256 "$SRC" | cut -d' ' -f1)"
LIVE="$(curl -fsS --max-time 25 "$PUBLIC_URL" | shasum -a 256 | cut -d' ' -f1)"
if [[ "$LOCAL" != "$LIVE" ]]; then
  echo "    ✗ 내용 불일치 — 캐시일 수도 있으니 잠시 뒤 다시 확인하세요." >&2
  echo "      되돌리려면: lftp 로 $BAK 를 www/index.html 로 올리면 됩니다." >&2
  exit 1
fi
echo "    ✓ 라이브 = 올린 것"

# 링크가 실제로 걸렸는지까지 본다(이 배포의 목적 자체다).
if curl -fsS --max-time 25 "$PUBLIC_URL" | grep -q 'href="chainremote/"'; then
  echo "    ✓ 체인리모트 링크 확인"
else
  echo "    ✗ 체인리모트 링크가 안 보입니다" >&2; exit 1
fi

echo ""
echo "✅ 홈페이지 배포 완료 — $PUBLIC_URL"
echo "   백업: $BAK"
