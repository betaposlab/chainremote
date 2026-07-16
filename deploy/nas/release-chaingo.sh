#!/usr/bin/env bash
# ChainGo(포터블 HQ SFX) 빌드 + 스텝 자료실 갱신 — release-full.sh hq 가 끝에 자동 호출.
#
# 체인고는 무설치 단일 exe 라 자동업뎃 경로가 없다(서비스 없음) — 재빌드+재업로드가
# 유일한 갱신 수단인데 파이프라인에 안 물려 있어 1.4.38 에 5개월 고착됐다(2026-07-16
# 발견). HQ 릴리즈마다 동반 갱신해 "사람이 기억"할 필요를 없앤다.
#
# 흐름: 윈컴 SSH(sustained — 세션 끊기면 빌드 죽는 함정 회피) 로 build-chaingo.ps1 실행
#   → ChainGo.exe 회수 → 자료실에 ChainGo_v{버전}.exe 업로드 + 옛 ChainGo_v* 정리.
# 비번: STAFF_PW 환경변수 또는 deploy/nas/.staff-pw.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
WIN_SSH="zenta@100.120.242.67"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=60"
STAFF="https://betaposlab.com/staff/index.php"

VER=$(grep -oE 'CHAINREMOTE_VERSION: &str = "[^"]+"' "$REPO/src/chainremote_version.rs" | sed -E 's/.*"([^"]+)".*/\1/')
[[ -n "$VER" ]] || { echo "✗ 버전 파싱 실패" >&2; exit 1; }

echo "════ ChainGo v$VER 빌드 (윈컴, ~15분) ════"
# sustained SSH 로 동기 실행 — build-chaingo.ps1 은 stdout 로그만 낸다.
ssh $SSH_OPTS "$WIN_SSH" "powershell -ExecutionPolicy Bypass -File C:\\src\\ChainRemote\\deploy\\portable\\build-chaingo.ps1" \
  | tail -5 | sed 's/^/    /'

echo "── 산출물 회수 ──"
mkdir -p "$REPO/dist"
DEST="$REPO/dist/ChainGo_v$VER.exe"
scp $SSH_OPTS "$WIN_SSH:C:/src/ChainRemote/deploy/portable/ChainGo.exe" "$DEST" >/dev/null
SIZE=$(stat -f %z "$DEST")
[[ "$SIZE" -gt 10000000 ]] || { echo "✗ 산출물이 너무 작음(${SIZE}B) — 빌드 실패 의심" >&2; exit 1; }
echo "    ✓ $DEST (${SIZE}B)"

echo "── 자료실 업로드 + 옛 버전 정리 ──"
STAFF_PW="${STAFF_PW:-}"
[[ -z "$STAFF_PW" && -f "$SCRIPT_DIR/.staff-pw" ]] && STAFF_PW=$(cat "$SCRIPT_DIR/.staff-pw")
[[ -n "$STAFF_PW" ]] || { echo "✗ STAFF_PW 없음 — 자료실 업로드 생략(수동 필요)" >&2; exit 1; }
JAR=$(mktemp); RESP=$(mktemp)
curl -s -c "$JAR" -d "action=login&pw=$STAFF_PW" "$STAFF" -o "$RESP"
curl -s -b "$JAR" --max-time 600 -F "action=upload" -F "file=@$DEST" "$STAFF" -o "$RESP"
curl -s -b "$JAR" "$STAFF" -o "$RESP"
grep -q "ChainGo_v$VER.exe" "$RESP" || { echo "✗ 업로드 후 목록에 안 보임" >&2; rm -f "$JAR" "$RESP"; exit 1; }
# 옛 ChainGo 정리 (이번 버전 제외)
for old in $(grep -oE 'ChainGo[A-Za-z0-9_.-]*\.exe' "$RESP" | sort -u); do
  if [[ "$old" != "ChainGo_v$VER.exe" ]]; then
    curl -s -b "$JAR" -F "action=delete" -F "filename=$old" "$STAFF" -o /dev/null </dev/null
    echo "    옛 버전 삭제: $old"
  fi
done
rm -f "$JAR" "$RESP"
echo "✅ ChainGo v$VER 자료실 갱신 완료"
