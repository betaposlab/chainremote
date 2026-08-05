#!/usr/bin/env bash
# 영업 랜딩(betaposlab.com/chainremote) 배포 — 배포처 4곳 룰의 [4]번.
#
# ★★거래처 Agent 는 여기 절대 안 올린다 — 코드로 차단한다(아래 가드).
#   Agent 설치본에는 대리점 식별자(tenant-slug + enroll-key)가 박힌다. 공개 페이지에
#   한 벌을 올리면 누가 받아 설치하든 전부 betaposlab 소속으로 등록돼 멀티테넌트
#   격리가 깨진다(2026-07-22 Chang 지적). 거래처용의 유효한 경로는 각 대리점이
#   자기 관리패널에서 받는 것 하나뿐이다. 랜딩엔 그 안내 문구만 둔다.
#   HQ·ChainGo 는 반대다 — 설치본에 대리점 정보가 없고 로그인으로 갈리므로 공개 배포가 안전.
#
# 올리는 것: HQ 설치파일 + ChainGo + index.html(버전 표기·링크 자동 교체)
#   버전은 NAS latest.json(hq 채널)이 진실 원천. 사람이 HTML 을 손으로 고치지 않는다
#   — 그렇게 하다가 v1.4.16 으로 6주 방치된 게 이 스크립트를 만든 이유다.
#
# 사용: ./deploy/nas/publish-landing.sh [ChainGo_vX.Y.Z.exe 경로]
#   Cafe24 비번 = 환경변수 CAFE24_PW, 없으면 FileZilla 설정에서 런타임 추출.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOST="betaposlab.com"
USER="betapos"
REMOTE_DIR="www/chainremote"
PUBLIC_BASE="https://betaposlab.com/chainremote"
INDEX_SRC="$REPO/deploy/web/chainremote/index.html"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "════ 영업 랜딩 배포 (betaposlab.com/chainremote) ════"

# ── 비번 ────────────────────────────────────────────────────────────────────
PW="${CAFE24_PW:-}"
if [[ -z "$PW" ]]; then
  PW="$(python3 - <<'PY'
import re, base64, os, sys
p = os.path.expanduser('~/.config/filezilla/recentservers.xml')
try:
    h = open(p, encoding='utf-8', errors='replace').read()
except OSError:
    sys.exit(0)
for m in re.finditer(r'<Server>.*?</Server>', h, re.S):
    s = m.group(0)
    if 'betaposlab.com' in s:
        q = re.search(r'<Pass encoding="base64">([^<]*)</Pass>', s)
        if q:
            print(base64.b64decode(q.group(1)).decode())
            break
PY
)"
fi
if [[ -z "$PW" ]]; then
  echo "✗ Cafe24 비번을 못 찾음 — CAFE24_PW 환경변수로 주세요." >&2
  exit 1
fi

# ── [1/6] 최신 HQ 정보 (latest.json = 진실 원천) ────────────────────────────
echo "[1/6] latest.json 에서 최신 HQ 확인..."
LATEST="$(curl -fsS https://sepani.synology.me/chainremote/latest.json)"
VERSION="$(printf '%s' "$LATEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hq"]["version"])')"
HQ_URL="$(printf '%s' "$LATEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hq"]["url"])')"
HQ_SHA="$(printf '%s' "$LATEST" | python3 -c 'import json,sys; print(json.load(sys.stdin)["hq"]["sha256"])')"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "✗ 버전 형식 오류: $VERSION" >&2; exit 1; }
HQ_NAME="ChainRemote_HQ_Setup_v${VERSION}.exe"
CHAINGO_NAME="ChainGo_v${VERSION}.exe"
echo "    최신 = v$VERSION"

# ── [2/6] 올릴 파일 준비 + 무결성 확인 ──────────────────────────────────────
echo "[2/6] 파일 준비..."
curl -fsS "$HQ_URL" -o "$WORK/$HQ_NAME"
GOT="$(shasum -a 256 "$WORK/$HQ_NAME" | cut -d' ' -f1)"
[[ "$GOT" == "$HQ_SHA" ]] || { echo "✗ HQ sha 불일치 (기대 $HQ_SHA / 받음 $GOT)" >&2; exit 1; }
echo "    HQ  ✓ $HQ_NAME (sha 확인)"

CHAINGO_SRC="${1:-$REPO/dist/$CHAINGO_NAME}"
if [[ -f "$CHAINGO_SRC" ]]; then
  cp "$CHAINGO_SRC" "$WORK/$CHAINGO_NAME"
  echo "    ChainGo ✓ $CHAINGO_NAME"
else
  echo "    ⚠ ChainGo 산출물 없음($CHAINGO_SRC) → HQ 만 갱신하고 ChainGo 는 건너뜀."
  CHAINGO_NAME=""
fi

# ── [3/6] index.html 버전 표기/링크 교체 ────────────────────────────────────
echo "[3/6] index.html 버전 교체..."
python3 - "$INDEX_SRC" "$WORK/index.html" "$VERSION" <<'PY'
import re, sys
src, dst, ver = sys.argv[1], sys.argv[2], sys.argv[3]
h = open(src, encoding='utf-8').read()
h = re.sub(r'ChainRemote_HQ_Setup_v[0-9.]+\.exe', f'ChainRemote_HQ_Setup_v{ver}.exe', h)
h = re.sub(r'ChainGo_v[0-9.]+\.exe', f'ChainGo_v{ver}.exe', h)
h = re.sub(r'본사 직원용 · v[0-9.]+', f'본사 직원용 · v{ver}', h)
h = re.sub(r'포터블 · 무흔적 · v[0-9.]+', f'포터블 · 무흔적 · v{ver}', h)
open(dst, 'w', encoding='utf-8').write(h)
PY

# ★가드 — Agent 가 랜딩에 섞여 들어가는 걸 코드로 막는다(사람 주의력에 맡기지 않는다).
if grep -qE 'downloads/[^"]*Agent[^"]*\.exe' "$WORK/index.html"; then
  echo "✗ index.html 에 Agent 다운로드 링크가 있습니다 — 랜딩엔 Agent 를 올리지 않습니다." >&2
  echo "  거래처용은 각 대리점 관리패널에서만 받아야 소속이 제대로 박힙니다." >&2
  exit 1
fi
echo "    ✓ Agent 링크 없음 확인"

# ── [4/6] 업로드 ────────────────────────────────────────────────────────────
echo "[4/6] 업로드..."
UP="set sftp:auto-confirm yes; set net:timeout 20;"
UP+=" put -O $REMOTE_DIR/downloads $WORK/$HQ_NAME;"
[[ -n "$CHAINGO_NAME" ]] && UP+=" put -O $REMOTE_DIR/downloads $WORK/$CHAINGO_NAME;"
UP+=" put -O $REMOTE_DIR $WORK/index.html; quit"
lftp -e "$UP" -u "$USER","$PW" "sftp://$HOST:22" >/dev/null
echo "    ✓ 업로드 완료"

# ── [5/6] 공개 URL 로 실제 확인 (올렸다고 믿지 않는다) ──────────────────────
echo "[5/6] 공개 URL 검증..."
fail=0
verify() { # $1=파일명 $2=기대sha(옵션)
  local u="$PUBLIC_BASE/downloads/$1" code got
  code="$(curl -s -o /dev/null -w '%{http_code}' -I "$u")"
  if [[ "$code" != "200" ]]; then echo "    ✗ $1 → HTTP $code"; fail=1; return; fi
  if [[ -n "${2:-}" ]]; then
    got="$(curl -fsS "$u" | shasum -a 256 | cut -d' ' -f1)"
    if [[ "$got" != "$2" ]]; then echo "    ✗ $1 → sha 불일치"; fail=1; return; fi
  fi
  echo "    ✓ $1"
}
verify "$HQ_NAME" "$HQ_SHA"
[[ -n "$CHAINGO_NAME" ]] && verify "$CHAINGO_NAME" "$(shasum -a 256 "$WORK/$CHAINGO_NAME" | cut -d' ' -f1)"
PAGE="$(curl -fsS "$PUBLIC_BASE/")"
printf '%s' "$PAGE" | grep -q "$HQ_NAME" || { echo "    ✗ 페이지가 $HQ_NAME 을 안 가리킴"; fail=1; }
printf '%s' "$PAGE" | grep -qE 'downloads/[^"]*Agent[^"]*\.exe' && { echo "    ✗ 라이브 페이지에 Agent 링크가 남아있음"; fail=1; }
[[ $fail -eq 0 ]] || { echo "✗ 검증 실패 — 위 항목 확인 필요." >&2; exit 1; }
echo "    ✓ 페이지 표기 일치"

# ── [6/6] 옛 파일 정리 (Agent 잔재 포함) ────────────────────────────────────
echo "[6/6] 옛 파일 정리..."
OLD="$(lftp -e "set sftp:auto-confirm yes; cls -1 $REMOTE_DIR/downloads/; quit" -u "$USER","$PW" "sftp://$HOST:22" 2>/dev/null \
      | sed "s#.*/##" | grep -E '\.exe$' | grep -vE "^($HQ_NAME|${CHAINGO_NAME:-__none__})$" || true)"
if [[ -n "$OLD" ]]; then
  DEL="set sftp:auto-confirm yes;"
  while IFS= read -r o; do
    [[ -z "$o" ]] && continue
    DEL+=" rm -f $REMOTE_DIR/downloads/$o;"
    echo "    삭제: $o"
  done <<< "$OLD"
  DEL+=" quit"
  lftp -e "$DEL" -u "$USER","$PW" "sftp://$HOST:22" >/dev/null || true
else
  echo "    (지울 것 없음)"
fi


# ── [7/7] 626.kr/main 동시 배포 (클라우드가 직접 페이지를 낸다) ─────────────
#   Chang 요구(2026-08-05): 짧은 주소가 betaposlab 으로 튕기지 않고 그대로 열릴 것.
#   ★설치파일은 여기 올리지 않는다 — 35MB × 방문자를 클라우드 트래픽(하루 33GB)으로
#   받을 이유가 없다. HTML/로고(수십 KB)만 클라우드가 내고, 다운로드 링크와
#   privacy.html 은 Cafe24 절대주소로 바꿔 그쪽에서 받게 한다.
echo "[7/7] 626.kr/main 동시 배포..."
CLOUD="root@115.68.192.153"
CLOUD_DIR="/opt/chainremote/web/main"
python3 - "$WORK/index.html" "$WORK/index-cloud.html" "$PUBLIC_BASE" <<'PYC'
import re, sys
src, dst, base = sys.argv[1], sys.argv[2], sys.argv[3]
h = open(src, encoding='utf-8').read()
h = h.replace('href="downloads/', 'href="%s/downloads/' % base)
h = h.replace('href="privacy.html"', 'href="%s/privacy.html"' % base)
open(dst, 'w', encoding='utf-8').write(h)
PYC
if ssh -o BatchMode=yes -o ConnectTimeout=10 "$CLOUD" "mkdir -p $CLOUD_DIR" 2>/dev/null; then
  scp -o BatchMode=yes -q "$WORK/index-cloud.html" "$CLOUD:$CLOUD_DIR/index.html"
  scp -o BatchMode=yes -q "$(dirname "$INDEX_SRC")/logo.png" "$CLOUD:$CLOUD_DIR/logo.png"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://626.kr/main)"
  if [[ "$CODE" == "200" ]]; then
    curl -fsS --max-time 20 https://626.kr/main | grep -q "$HQ_NAME" \
      && echo "    ✓ https://626.kr/main 갱신 (다운로드는 Cafe24 로)" \
      || echo "    ⚠ 626.kr/main 이 열리지만 버전 표기가 안 맞습니다 — 확인 필요"
  else
    echo "    ⚠ https://626.kr/main → HTTP $CODE (Caddy 설정 확인 필요). Cafe24 배포는 정상입니다."
  fi
else
  echo "    ⚠ 클라우드 접속 실패 — Cafe24 배포는 정상. 626.kr/main 은 옛 내용일 수 있습니다."
fi

echo ""
echo "✅ 랜딩 배포 완료 — betaposlab.com/chainremote + 626.kr/main, HQ v$VERSION${CHAINGO_NAME:+ + ChainGo}. Agent 는 의도적으로 없음."
