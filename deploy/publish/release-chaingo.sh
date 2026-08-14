#!/usr/bin/env bash
# ChainGo(포터블 HQ SFX) 빌드 — release-full.sh hq 가 끝에 자동 호출.
#
# 체인고는 무설치 단일 exe 라 자동업뎃 경로가 없다(서비스 없음) — 재빌드+재업로드가
# 유일한 갱신 수단인데 파이프라인에 안 물려 있어 1.4.38 에 5개월 고착됐다(2026-07-16
# 발견). HQ 릴리즈마다 동반 갱신해 "사람이 기억"할 필요를 없앤다.
#
# 흐름: 윈컴 SSH(sustained — 세션 끊기면 빌드 죽는 함정 회피) 로 build-chaingo.ps1 실행
#   → ChainGo.exe 를 dist/ChainGo_v{버전}.exe 로 회수. 여기까지가 이 스크립트 몫이다.
#
# ★업로드는 안 한다. 뒤이어 도는 publish-landing.sh 가 dist/ 에서 집어 랜딩 downloads 로
#   올리고, 패널 [ChainGo 다운로드]도 같은 주소로 302 하므로 한 번에 갱신된다.
#   2026-08-14 이전엔 여기서 스텝 자료실에도 따로 올렸는데 그 배포처를 폐지했다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
WIN_SSH="zenta@100.120.242.67"
SSH_OPTS="-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=60"

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

echo ""
echo "✅ ChainGo v$VER 빌드 완료 — dist/ 에 놓았다."
echo "   배포는 publish-landing.sh 가 이 파일을 집어 랜딩 downloads 로 올린다."
echo "   패널 [ChainGo 다운로드] 버튼도 그 주소를 가리키므로 그걸로 함께 갱신된다."
