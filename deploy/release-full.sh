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

# ── [0.5/5] 로컬↔GitHub 동기화 강제확인 (push 누락 사고 재발방지) ───────────
# ★2026-07-09 실측 사고: release-build.ps1 은 origin/develop 기준으로 빌드한다.
#   로컬 commit 만 하고 push 를 깜빡하면 윈컴이 옛 버전을 "정상적으로" 다시 빌드해
#   상태파일 버전이 로컬과 달라진다 — 경합조건처럼 보이지만 실은 push 누락이었다.
#   여기서 미리 끊어야 20분 빌드 후에야 아는 낭비를 막는다. push 자체는 절대 자동
#   실행 안 함(GitHub push는 Chang 명시 지시시에만 — CLAUDE.md 원칙) — 실패로 안내만.
echo "[0.5/5] 로컬↔GitHub 동기화 확인..."
git -C "$REPO" fetch origin develop --quiet
LOCAL_HEAD=$(git -C "$REPO" rev-parse HEAD)
REMOTE_HEAD=$(git -C "$REPO" rev-parse origin/develop)
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  echo "✗ ERROR — 로컬 HEAD($LOCAL_HEAD) != origin/develop($REMOTE_HEAD)." >&2
  echo "  윈컴은 origin/develop 기준으로 빌드합니다. 'git push origin develop' 먼저 실행하세요." >&2
  exit 1
fi
# ★2026-08-07 실측 사고: hbb_common 은 서브모듈이라 부모에서 `git add -A` 를 해도
#   그 안의 파일 변경은 안 담긴다. 그런데 아래 HEAD 대조는 커밋된 것만 보므로,
#   "고쳤고 부모도 push 했는데" 윈컴은 옛 서브모듈로 빌드하다 컴파일 에러로 죽는다.
#   HEAD 가 같아도 작업트리가 더러우면 여기서 끊는다 — 20분 빌드 후에야 아는 낭비를 막는다.
for DIRTY_PATH in "$REPO" "$REPO/libs/hbb_common"; do
  [[ -d "$DIRTY_PATH" ]] || continue
  if [[ -n "$(git -C "$DIRTY_PATH" status --porcelain)" ]]; then
    echo "✗ ERROR — 커밋 안 된 변경이 있습니다: $DIRTY_PATH" >&2
    git -C "$DIRTY_PATH" status --short >&2
    echo "  윈컴은 커밋된 것만 받아 갑니다. 커밋+push 후 다시 실행하세요." >&2
    echo "  (서브모듈이면 그 안에서 먼저 커밋·push 하고, 부모에서 포인터를 커밋해야 합니다.)" >&2
    exit 1
  fi
done

SUBMODULE_PATH="$REPO/libs/hbb_common"
if [[ -d "$SUBMODULE_PATH" ]]; then
  SUB_LOCAL=$(git -C "$SUBMODULE_PATH" rev-parse HEAD)
  SUB_REMOTE_BRANCH=$(git -C "$SUBMODULE_PATH" rev-parse --abbrev-ref HEAD)
  git -C "$SUBMODULE_PATH" fetch origin "$SUB_REMOTE_BRANCH" --quiet
  SUB_REMOTE=$(git -C "$SUBMODULE_PATH" rev-parse "origin/$SUB_REMOTE_BRANCH")
  if [[ "$SUB_LOCAL" != "$SUB_REMOTE" ]]; then
    echo "✗ ERROR — 서브모듈(hbb_common) 로컬($SUB_LOCAL) != origin/$SUB_REMOTE_BRANCH($SUB_REMOTE)." >&2
    echo "  서브모듈 안에서 'git push origin $SUB_REMOTE_BRANCH' 먼저 실행하세요." >&2
    exit 1
  fi
fi
echo "    ✓ 동기화 확인 (로컬 HEAD = origin/develop, 서브모듈 포함)"

# ── [1/5] 빌드 스크립트 전송 + WMI 분리 실행 (SSH 끊겨도 생존) ──────────────
echo "[1/5] 릴리즈 빌드 스크립트 전송 + 백그라운드 실행..."
STATUS_FILE="_release_${KIND}.status"
# ★경합조건 함정(2026-07-09 실측): WMI Invoke-CimMethod 는 PID 만 즉시 반환하고 프로세스가
#   실제로 실행되기까진 지연이 있다 — 그 사이 Mac 폴링이 먼저 돌면 직전 실행의 낡은 상태파일
#   (예: 이전 버전의 ALL-DONE)을 "이번 빌드 완료"로 오인한다. 트리거 전에 Mac 에서 직접 지운다.
ssh $SSH_OPTS "$WIN_SSH" "del $WIN_REPO\\$STATUS_FILE 2>NUL" || true
scp $SSH_OPTS "$REPO/deploy/win-build/release-build.ps1" "$WIN_SSH:$WIN_REPO/_release-build.ps1" >/dev/null
ssh $SSH_OPTS "$WIN_SSH" "powershell -Command \"\$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='powershell -ExecutionPolicy Bypass -File $WIN_REPO\\_release-build.ps1 -Kind $KIND'}; Write-Output ('PID=' + \$r.ProcessId)\"" | tr -d '\r'

# ── [2/5] 빌드 완료 대기 (상태파일 폴링, 최대 40분) ──────────────────────────
echo "[2/5] 빌드 진행 대기 (x64 빌드 + ISCC, 보통 10~20분)..."
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
# ★2차 안전망: 상태파일 경합조건이 또 있어도 여기서 잡는다 — 지금 트리거한 로컬 소스의
#   버전과 상태파일이 보고한 버전이 다르면 낡은 상태파일을 읽은 것이니 즉시 중단.
LOCAL_VERSION=$(grep -oE 'CHAINREMOTE_VERSION: &str = "[^"]+"' "$REPO/src/chainremote_version.rs" | sed -E 's/.*"([^"]+)".*/\1/')
if [[ "$VERSION" != "$LOCAL_VERSION" ]]; then
  echo "✗ ERROR — 상태파일 버전($VERSION) != 로컬 소스 버전($LOCAL_VERSION). 낡은 상태파일을 읽었을 가능성." >&2
  exit 1
fi
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
  # ChainGo(포터블 HQ) 동반 갱신 — 자동업뎃 경로가 없는 무설치 exe 라 여기 안 묶으면
  # 영원히 옛 버전 고착(1.4.38 5개월 사고, 2026-07-16). 실패해도 HQ 발행 자체는 유효라 경고만.
  if ! bash "$REPO/deploy/nas/release-chaingo.sh"; then
    echo "⚠ ChainGo 동반 빌드 실패 — HQ 발행은 완료. deploy/nas/release-chaingo.sh 단독 재실행 필요." >&2
  fi
fi

# ── [4.5/5] 릴리즈 노트 기록 (패널 체인지로그) ───────────────────────────────
# 대리점이 "이번 업데이트로 뭐가 달라졌는지"를 패널에서 본다(마이그 035).
#
# ★여기서 자동으로 넣는 이유: 사람이 "발행하고 나서 패널에 적기"를 기억해야 하는 구조면
#   반드시 빠진다. 하루에 다섯 번 발행한 날도 있었다.
#
# 노트에 따옴표·줄바꿈이 섞여도 안전하도록 dollar-quoting($crnote$)을 쓴다. 셸에서 SQL 을
#   조립할 때 이스케이프로 깨지는 게 이런 자리의 단골 사고다.
# 실패해도 발행 자체는 유효하므로 경고만 하고 넘어간다 — 나중에 패널에서 손으로 넣으면 된다.
echo "[4.5/5] 릴리즈 노트 기록..."
CLOUD_SSH="root@115.68.192.153"
if printf '%s' "INSERT INTO releases (kind, version, notes) VALUES ('$KIND', '$VERSION', \$crnote\$$NOTES\$crnote\$) ON CONFLICT (kind, version) DO UPDATE SET notes = EXCLUDED.notes;" \
   | ssh $SSH_OPTS "$CLOUD_SSH" "docker exec -i chainremote-postgres psql -U chainremote -d chainremote -q -v ON_ERROR_STOP=1" 2>/dev/null; then
  if [[ -n "$NOTES" ]]; then
    echo "    ✓ 기록됨 — 626.kr 대시보드/업데이트 내역에 표시"
  else
    echo "    ✓ 기록됨 (노트 없음 — 목록에는 안 보이고 버전만 남습니다)"
  fi
else
  echo "⚠ 릴리즈 노트 기록 실패 — 발행은 정상. 패널 DB releases 에 수동 입력 필요." >&2
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
