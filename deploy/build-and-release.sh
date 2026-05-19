#!/usr/bin/env bash
# ChainRemote 빌드+배포 원샷 자동화 (2026-05-19).
#
# 한 줄로: 버전 bump → 커밋·푸시 → 윈컴 원격 빌드(SSH/Tailscale) →
#          산출물 회수(scp) → NAS 게시(release.sh).
# 복붙·Finder·SMB·수동 exe 이동 전부 제거.
#
# 전제(1회 셋업 완료):
#   - 윈컴에 OpenSSH 서버 + Mac 공개키(administrators_authorized_keys)
#   - 윈컴·Mac·NAS 동일 Tailscale tailnet
#   - 윈컴 Tailscale IP / 계정은 아래 상수. (Tailscale IP 는 기기별 고정)
#
# 사용: ./deploy/build-and-release.sh <새버전> ["릴리즈노트"]
#   예:  ./deploy/build-and-release.sh 1.2.19 "xxx 수정"
#
# 길게 걸림(원격 cargo+flutter 빌드 5~20분). 호출 측에서 백그라운드 권장.

set -euo pipefail

WIN_SSH="zenta@100.120.242.67"          # 윈컴 (Tailscale)
WIN_REPO='C:\src\ChainRemote'
WIN_EXE_DIR='C:/src/ChainRemote/deploy/win-installer'
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=240 -o BatchMode=yes"

NEW="${1:-}"
NOTES="${2:-자동 빌드}"
if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "사용법: $0 <X.Y.Z> [릴리즈노트]" >&2; exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== [1/5] git 동기 확인 ==="
git fetch origin -q
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/master)" || -n "$(git status --porcelain)" ]]; then
  echo "ABORT: 작업트리 비동기/더러움. 수동 정리 후 재실행." >&2
  git status --short >&2; exit 1
fi

CUR="$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' src/chainremote_version.rs | head -1)"
echo "    현재 $CUR → 신규 $NEW"

echo "=== [2/5] 버전 bump(3곳) + 커밋 + 푸시 ==="
sed -i '' "s/\"$CUR\"/\"$NEW\"/" src/chainremote_version.rs
sed -i '' "s/'$CUR'/'$NEW'/" flutter/lib/common.dart
sed -i '' "s/#define APP_VERSION    \"$CUR\"/#define APP_VERSION    \"$NEW\"/" deploy/win-installer/installer.iss
grep -hE "$NEW" src/chainremote_version.rs flutter/lib/common.dart deploy/win-installer/installer.iss
git add src/chainremote_version.rs flutter/lib/common.dart deploy/win-installer/installer.iss
git commit -q -m "chore: v$NEW — $NOTES

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin HEAD:master

echo "=== [3/5] 윈컴 원격 빌드 (SSH/Tailscale, 수 분~십수 분) ==="
# 윈컴은 빌드 슬레이브(개발은 Mac 에서만) → 누적 cruft 무시하고 origin/master 로
# 강제 동기. 단순 git pull 은 더러운/어긋난 트리에서 갱신 실패 → 옛 버전 빌드 사고.
PS_BUILD="cd $WIN_REPO; git fetch origin --quiet; git reset --hard origin/master; \
Remove-Item -Force $WIN_REPO\\rustdesk-*-install.exe -EA SilentlyContinue; \
Remove-Item -Force $WIN_REPO\\rustdesk_portable.exe -EA SilentlyContinue; \
Remove-Item -Force $WIN_REPO\\libs\\portable\\rustdesk_portable.exe -EA SilentlyContinue; \
.\\deploy\\win-build\\build-all.ps1; \
cd $WIN_REPO\\deploy\\win-installer; .\\build-iss.ps1; \
if (Test-Path \".\\ChainRemote_Setup_v$NEW.exe\") { Write-Output 'BUILD_OK' } else { Write-Output 'BUILD_FAIL'; exit 1 }"
ssh $SSH_OPTS "$WIN_SSH" "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$PS_BUILD\"" | tee /tmp/cr-remote-build.log
grep -q 'BUILD_OK' /tmp/cr-remote-build.log || { echo "ABORT: 원격 빌드 실패(/tmp/cr-remote-build.log 확인)" >&2; exit 1; }

echo "=== [4/5] 산출물 회수 (scp 윈컴→Mac) ==="
DEST="$HOME/Downloads/ChainRemote_Setup_v$NEW.exe"
scp $SSH_OPTS "$WIN_SSH:$WIN_EXE_DIR/ChainRemote_Setup_v$NEW.exe" "$DEST"
ls -la "$DEST"

echo "=== [5/5] NAS 게시 (release.sh) ==="
"$ROOT/deploy/release.sh" "$DEST" "$NOTES"

echo "=== 완료: v$NEW 빌드·배포 끝. 윈컴 '업데이트 확인 → 지금 설치' 또는 24h 자동 ==="
