#!/usr/bin/env bash
# ChainRemote 릴리즈 원커맨드 — 4단계 배포 룰의 [1·3·4] 완전 자동, [2]는 명확히 안내.
#
#   실행 하나로: 윈컴 깨움(WoL) → 원격빌드(x64+ISCC) → 산출물 회수+sha검증
#   → 발행(NAS+agent-push.json/latest.json+스텝자료실) 까지 사람 개입 0.
#   유일하게 사람이 하는 것 = ②관리패널 [전체 일괄 푸시] 클릭(의도적 — 살아있는
#   거래처 플릿 전체에 즉시 영향이라 마지막 방아쇠는 항상 사람, feedback_
#   deploy_ai_runs_after_approval 의 대량조작 게이트와 동일 원칙). 스크립트가
#   끝에 이 안내를 절대 놓치지 않게 큰 글씨로 출력한다.
#
# 사용: ./deploy/release-full.sh agent ["릴리즈노트"]
#       ./deploy/release-full.sh hq    ["릴리즈노트"]

set -euo pipefail

KIND="${1:-}"
NOTES="${2:-}"
if [[ "$KIND" != "agent" && "$KIND" != "hq" ]]; then
  echo "사용법: $0 <agent|hq> [릴리즈노트]" >&2
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_SSH="zenta@100.120.242.67"
WIN_REPO='C:\src\ChainRemote'
NAS_TAILSCALE="chang@100.93.42.91"
WIN_MAC="bcfce7b46c3a"
SSH_OPTS="-o ConnectTimeout=10 -o BatchMode=yes"

echo "════════════════════════════════════════════════════"
echo " ChainRemote $KIND 릴리즈 — 원커맨드 시작"
echo "════════════════════════════════════════════════════"

# ── [0/5] 윈컴 깨우기 (SSH 안 되면 WoL, 되면 skip) ──────────────────────────
echo "[0/5] 윈컴 접속 확인..."
if ! ssh $SSH_OPTS "$WIN_SSH" "echo up" >/dev/null 2>&1; then
  echo "    절전 상태로 보임 — WoL 매직패킷 발사(NAS Tailscale 경유)..."
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$NAS_TAILSCALE" "python3 -c \"
import socket
data = b'\xff' * 6 + bytes.fromhex('$WIN_MAC') * 16
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
s.sendto(data, ('192.168.68.255', 9))
s.sendto(data, ('255.255.255.255', 9))
\"" >/dev/null
  for i in $(seq 1 18); do
    ssh $SSH_OPTS "$WIN_SSH" "echo up" >/dev/null 2>&1 && { echo "    ✓ 깨어남 (${i}0초)"; break; }
    [[ $i -eq 18 ]] && { echo "    ✗ 3분 내 안 깨어남 — 수동 확인 필요" >&2; exit 1; }
    sleep 10
  done
else
  echo "    ✓ 이미 켜져 있음"
fi

# ── [1/5] 빌드 스크립트 전송 + WMI 분리 실행 (SSH 끊겨도 생존) ──────────────
echo "[1/5] 릴리즈 빌드 스크립트 전송 + 백그라운드 실행..."
scp $SSH_OPTS "$REPO/deploy/win-build/release-build.ps1" "$WIN_SSH:$WIN_REPO/_release-build.ps1" >/dev/null
ssh $SSH_OPTS "$WIN_SSH" "powershell -Command \"\$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='powershell -ExecutionPolicy Bypass -File $WIN_REPO\\_release-build.ps1 -Kind $KIND'}; Write-Output ('PID=' + \$r.ProcessId)\"" | tr -d '\r'

# ── [2/5] 빌드 완료 대기 (상태파일 폴링, 최대 40분) ──────────────────────────
echo "[2/5] 빌드 진행 대기 (x64 빌드 + ISCC, 보통 10~20분)..."
STATUS_FILE="_release_${KIND}.status"
SEEN=""
DEADLINE=$((SECONDS + 2400))
ARTIFACT_LINE=""
while [[ $SECONDS -lt $DEADLINE ]]; do
  ST=$(ssh $SSH_OPTS "$WIN_SSH" "type $WIN_REPO\\$STATUS_FILE 2>NUL" 2>/dev/null || echo "")
  if [[ -n "$ST" && "$ST" != "$SEEN" ]]; then
    comm -13 <(echo "$SEEN") <(echo "$ST") 2>/dev/null | sed 's/^/    /'
    SEEN="$ST"
  fi
  if echo "$ST" | grep -q "ALL-DONE"; then
    ARTIFACT_LINE=$(echo "$ST" | grep "ARTIFACT ")
    break
  fi
  if echo "$ST" | grep -q "FAIL"; then
    echo "✗ 빌드 실패 — 위 로그 확인." >&2
    exit 1
  fi
  sleep 20
done
if [[ -z "$ARTIFACT_LINE" ]]; then
  echo "✗ 40분 내 빌드 미완료 — 윈컴 상태 수동 확인 필요." >&2
  exit 1
fi

VERSION=$(echo "$ARTIFACT_LINE" | grep -oE 'VERSION=[0-9.]+' | cut -d= -f2)
WIN_PATH=$(echo "$ARTIFACT_LINE" | grep -oE 'ARTIFACT [^ ]+' | cut -d' ' -f2 | tr -d '\r')
EXPECT_SHA=$(echo "$ARTIFACT_LINE" | grep -oE 'sha256=[0-9a-f]+' | cut -d= -f2)
# ★함정(2026-07-09 실측): macOS basename 은 '/' 만 구분자로 알아 윈도우 경로(백슬래시)를 못
#   쪼갠다 — WIN_PATH_FWD(forward-slash 변환) 를 먼저 만들고 그걸로 basename 해야 한다.
WIN_PATH_FWD="${WIN_PATH//\\//}"
FILENAME=$(basename "$WIN_PATH_FWD")
echo "    ✓ 빌드 완료: $FILENAME (v$VERSION, sha256=${EXPECT_SHA:0:16}...)"

# ── [3/5] 산출물 회수 + 무결성 검증 ──────────────────────────────────────────
echo "[3/5] 산출물 Mac 회수 + sha256 검증..."
mkdir -p "$REPO/dist"
DEST="$REPO/dist/$FILENAME"
scp $SSH_OPTS "$WIN_SSH:$WIN_PATH_FWD" "$DEST" >/dev/null
LOCAL_SHA=$(shasum -a 256 "$DEST" | awk '{print $1}')
if [[ "$LOCAL_SHA" != "$EXPECT_SHA" ]]; then
  echo "✗ 전송 무결성 실패 (local=$LOCAL_SHA expect=$EXPECT_SHA)" >&2
  exit 1
fi
echo "    ✓ 무결성 확인"

# ── [4/5] 발행 (기존 검증된 스크립트 재사용) ─────────────────────────────────
echo "[4/5] 발행 (NAS + 채널 + 스텝자료실)..."
if [[ "$KIND" == "agent" ]]; then
  NAS_HOST=chang@100.93.42.91 bash "$REPO/deploy/nas/release-agent.sh" "$DEST" "$NOTES"
else
  NAS_HOST=chang@100.93.42.91 bash "$REPO/deploy/nas/publish-hq.sh" "$DEST" "$NOTES"
fi

# ── [5/5] 마지막 안내 — 절대 놓치면 안 되는 사람 몫 ──────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo " ✅ $KIND v$VERSION — [1·3·4]단계 자동 완료"
if [[ "$KIND" == "agent" ]]; then
echo ""
echo " ⚠️  남은 건 [2]단계 하나뿐 — 관리패널에서 직접 클릭하세요:"
echo "    거래처 → [⬆ 전체 일괄 푸시] → [최신 가져오기](자동채움) → [일괄 푸시 시작]"
echo "    (기존 거래처에 즉시 영향이라 이 클릭만은 항상 사람 몫입니다)"
else
echo ""
echo " HQ 는 각 머신이 24h 폴링/버튼으로 스스로 자동업뎃합니다 — 추가 조치 불필요."
fi
echo "════════════════════════════════════════════════════"
