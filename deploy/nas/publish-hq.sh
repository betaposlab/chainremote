#!/usr/bin/env bash
# HQ(본사 앱) 새 버전 발행 — latest.json 의 hq 채널 갱신 + NAS exe 업로드 + 스텝 자료실.
# 각 HQ 가 24h 폴링 + 버튼으로 이 latest.json 을 보고 스스로 사일런트 자동업뎃한다.
#
# ⚠★ latest.json 은 2채널 포맷 { "hq": {...}, "agent": {...} } 이다. 이 스크립트는 hq 채널만
#   교체하고 agent 채널(0.0.0 영구 비활성)은 그대로 보존한다 — python 으로 .hq 만 갈아끼운다.
#   옛 deploy/release.sh 가 latest.json 을 flat 포맷으로 통째로 덮어써 HQ 채널을 파괴한 지뢰의
#   교훈(2026-07-09 그 release.sh 삭제). 이 스크립트는 절대 agent 채널을 건드리지 않는다.
#
# 사용: ./deploy/nas/publish-hq.sh <ChainRemote_HQ_Setup_vX.Y.Z.exe> ["릴리즈노트"]
#   스텝 자료실 비번 = 환경변수 STAFF_PW 또는 deploy/nas/.staff-pw. 없으면 자료실만 스킵.

set -euo pipefail

EXE="${1:-}"
NOTES="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -z "$EXE" || ! -f "$EXE" ]]; then
  echo "사용법: $0 <ChainRemote_HQ_Setup_vX.Y.Z.exe 경로> [릴리즈노트]" >&2
  exit 1
fi

VERSION=$(grep -oE 'CHAINREMOTE_VERSION: &str = "[^"]+"' "$REPO/src/chainremote_version.rs" | sed -E 's/.*"([^"]+)".*/\1/')
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "✗ ERROR — 버전 형식 오류: '$VERSION'" >&2; exit 1
fi
EXPECTED_NAME="ChainRemote_HQ_Setup_v${VERSION}.exe"
if [[ "$(basename "$EXE")" != "$EXPECTED_NAME" ]]; then
  echo "✗ ERROR — 파일명($(basename "$EXE"))이 src 버전($VERSION)과 불일치. 기대: $EXPECTED_NAME" >&2
  exit 1
fi

NAS_HOST="${NAS_HOST:-chang@192.168.68.103}"
NAS_WEB_DIR="${NAS_WEB_DIR:-/volume1/web/chainremote}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://sepani.synology.me/chainremote}"
SHA256=$(shasum -a 256 "$EXE" | awk '{print $1}')
SIZE=$(stat -f %z "$EXE" 2>/dev/null || stat -c %s "$EXE")
RELEASED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REMOTE_PATH="$NAS_WEB_DIR/$EXPECTED_NAME"

echo "[검증] HQ v$VERSION sha256=$SHA256 size=$SIZE"

# 1. exe 원자적 업로드(.partial + NAS측 sha 재검증 + mv).
echo "[1/4] NAS 업로드 (atomic)..."
TMP="$REMOTE_PATH.partial"
ssh "$NAS_HOST" "cat > $TMP && chmod 644 $TMP" < "$EXE"
NAS_SHA=$(ssh "$NAS_HOST" "sha256sum $TMP | awk '{print \$1}'")
if [[ "$NAS_SHA" != "$SHA256" ]]; then
  echo "✗ 업로드 무결성 실패 (nas=$NAS_SHA)" >&2; ssh "$NAS_HOST" "rm -f $TMP"; exit 1
fi
ssh "$NAS_HOST" "mv -f $TMP $REMOTE_PATH"
echo "    OK"

# 2. latest.json 의 hq 채널만 갱신 (★agent 채널 보존). 현재 파일을 받아 python 으로 .hq 교체.
echo "[2/4] latest.json hq 채널 갱신 (agent 채널 보존)..."
CUR_JSON=$(curl -sS --max-time 10 "$PUBLIC_BASE_URL/latest.json" || echo "")
NEW_JSON=$(EXE_URL="$PUBLIC_BASE_URL/$EXPECTED_NAME" VER="$VERSION" SHA="$SHA256" SZ="$SIZE" \
  RAT="$RELEASED_AT" NT="$NOTES" python3 - "$CUR_JSON" <<'PY'
import json, os, sys
cur = sys.argv[1] if len(sys.argv) > 1 else ""
try:
    data = json.loads(cur) if cur.strip() else {}
except Exception:
    data = {}
if not isinstance(data, dict):
    data = {}
# ★agent 채널은 그대로 둔다. 없으면 옛 비활성 기본값을 넣어 유지.
data.setdefault("agent", {"version": "0.0.0", "url": "", "sha256": "", "size": 0,
    "released_at": "2026-05-29T08:11:00Z",
    "notes": "v1.3.4- old Agent latest.json channel permanently disabled."})
data["hq"] = {
    "version": os.environ["VER"], "url": os.environ["EXE_URL"],
    "sha256": os.environ["SHA"], "size": int(os.environ["SZ"]),
    "released_at": os.environ["RAT"], "notes": os.environ["NT"],
}
print(json.dumps(data, ensure_ascii=False, indent=2))
PY
)
# 조립된 JSON 이 유효하고 agent 채널이 살아있는지 로컬 재검증 후에만 발행.
if ! printf '%s' "$NEW_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert "hq" in d and "agent" in d, "채널 누락"' 2>/dev/null; then
  echo "✗ ERROR — 조립된 latest.json 이 무효거나 채널 누락 — 발행 중단(NAS 안 건드림):" >&2
  echo "$NEW_JSON" >&2; exit 1
fi
ssh "$NAS_HOST" "cat > $NAS_WEB_DIR/latest.json.tmp && mv -f $NAS_WEB_DIR/latest.json.tmp $NAS_WEB_DIR/latest.json" <<< "$NEW_JSON"
echo "    OK (hq=$VERSION, agent 보존)"

# 2.5. push.json 발행 — 5분 즉시 채널. latest.json(24h 폴링)만 갱신하면 절전·원격세션 보류가
#   잦은 기기는 며칠씩 옛 버전에 머문다(2026-07-15 집 윈컴 1.4.55 잔류 실사고). timestamp 가
#   바뀌면 각 HQ 가 깨어있고 세션 없는 첫 5분 틱에 latest.json 을 재확인해 즉시 적용한다.
#   이 단계를 빼먹는 실수를 코드로 봉인 — 릴리즈마다 자동으로 종이 울린다.
echo "[2.5/4] push.json 발행 (5분 즉시 채널)..."
PUSH_JSON=$(VER="$VERSION" NT="$NOTES" python3 - <<'PY'
import json, os, datetime
print(json.dumps({
    "version": os.environ["VER"],
    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "notes": os.environ.get("NT", ""),
}, ensure_ascii=False))
PY
)
ssh "$NAS_HOST" "cat > $NAS_WEB_DIR/push.json.tmp && mv -f $NAS_WEB_DIR/push.json.tmp $NAS_WEB_DIR/push.json" <<< "$PUSH_JSON"
echo "    OK (push timestamp 갱신 — 각 HQ 5분 내 반응)"

# 3. 공개 URL 검증 (hq 버전 반영 + agent 채널 생존).
echo "[3/4] 공개 latest.json 검증..."
for attempt in 1 2 3; do
  sleep 1
  LIVE=$(curl -sS --max-time 10 "$PUBLIC_BASE_URL/latest.json" || echo "")
  OK=$(printf '%s' "$LIVE" | python3 -c 'import json,sys
try:
 d=json.load(sys.stdin); print("Y" if d.get("hq",{}).get("version")=="'"$VERSION"'" and "agent" in d else "N")
except: print("N")' 2>/dev/null || echo "N")
  [[ "$OK" == "Y" ]] && break
  echo "    (재시도 $attempt/3)"
done
if [[ "$OK" != "Y" ]]; then
  echo "✗ ERROR — 발행 후 latest.json 검증 실패 (hq 버전 불일치 또는 agent 채널 소실)" >&2; exit 1
fi
echo "    OK"

# 4. 스텝 자료실 업로드 + 옛 HQ 버전 정리.
echo "[4/4] 스텝 자료실 업로드..."
STAFF_PW="${STAFF_PW:-}"
if [[ -z "$STAFF_PW" && -f "$SCRIPT_DIR/.staff-pw" ]]; then
  STAFF_PW="$(tr -d '[:space:]' < "$SCRIPT_DIR/.staff-pw")"
fi
if [[ -z "$STAFF_PW" ]]; then
  echo "  ⚠ STAFF_PW 없음 → 자료실 스킵 (NAS+latest.json 은 완료)."
else
  export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
  STAFF="https://betaposlab.com/staff/index.php"
  JAR=$(mktemp); RESP=$(mktemp); trap 'rm -f "$JAR" "$RESP"' EXIT
  curl -s -c "$JAR" -d "action=login&pw=$STAFF_PW" "$STAFF" -o "$RESP"
  if ! grep -q '"status":"success"' "$RESP"; then
    echo "  ✗ 자료실 로그인 실패 → 스킵 (NAS+latest.json 은 완료)." >&2
  else
    OLD=$(curl -s -b "$JAR" https://betaposlab.com/staff/ \
      | grep -oE 'ChainRemote_HQ_Setup_v[0-9.]+\.exe' | sort -u | grep -v "v${VERSION}\.exe" || true)
    curl -s -b "$JAR" --max-time 300 -F "action=upload" -F "file=@$EXE" "$STAFF" -o "$RESP"
    # ★판정은 업로드 응답이 아니라 **목록에 실제로 떴는가**로만 한다.
    #   2026-08-13 실측: 25MB 업로드가 멀쩡히 끝나 파일이 자료실에 올라갔는데도 응답에
    #   '"status":"success"' 가 없어 "업로드 실패/미확인"으로 찍혔다. 그 거짓 음성 때문에
    #   옛 버전 삭제까지 건너뛰어 1.4.108 과 1.4.112 가 자료실에 나란히 남았다.
    #   응답 문자열은 서버 사정으로 얼마든지 달라지지만 목록은 사실이다.
    if curl -s -b "$JAR" https://betaposlab.com/staff/ | grep -q "$EXPECTED_NAME"; then
      echo "  ✓ 업로드: $EXPECTED_NAME"
      if [[ -n "$OLD" ]]; then
        while IFS= read -r o; do
          [[ -z "$o" ]] && continue
          curl -s -b "$JAR" -F "action=delete" -F "filename=$o" "$STAFF" -o "$RESP" </dev/null
          grep -q '"status":"success"' "$RESP" && echo "    옛 HQ 삭제: $o" || echo "    ⚠ 삭제 실패: $o"
        done <<< "$OLD"
      fi
    else
      echo "  ⚠ 업로드 실패/미확인 → 옛 버전 유지(안전)." >&2
    fi
  fi
fi

echo ""
echo "✅ HQ v$VERSION 발행 완료 — 각 HQ 가 24h 폴링/버튼으로 자동업뎃."
echo "   latest.json hq=$VERSION (agent 채널 보존), NAS exe, 스텝 자료실."
