#!/usr/bin/env bash
# docs/chainremote 를 NAS 로 백업한다.
#
# 왜 필요한가: 그 폴더는 .gitignore 에 통째로 들어 있다(운영 문서에 서버 주소·거래처 정보가
#   있어 공개 저장소에 올리지 않는다). 그래서 GitHub 에 사본이 없고, Chang 의 맥 한 대에만
#   존재한다 — OPERATION/BACKLOG/SEAT_ENFORCEMENT/DESIGN_BRIEF 가 전부 여기 있다.
#
# rsync 는 이 NAS 에서 막혀 있어 tar over SSH 로 보낸다(reference_nas_admin_deploy).
# 도착지는 클라우드 DB 백업이 쌓이는 ~/cr-cloud-backup 옆이다. ★웹 디렉토리(/volume1/web)에는
#   절대 두지 않는다 — 거기는 설치파일 공개 경로라 내부 문서가 그대로 열린다.
#
# 사용: ./deploy/backup-docs.sh            (Tailscale 경유 — 집·사무실 어디서나)
#       NAS_HOST=chang@192.168.68.103 ./deploy/backup-docs.sh   (집 LAN 을 쓰고 싶을 때)
#       ./deploy/backup-docs.sh --install    (매일 14시 자동 실행 등록)
#       ./deploy/backup-docs.sh --uninstall  (자동 실행 해제)
#
# plist 를 저장소에 두지 않고 --install 이 만들어 쓴다 — 홈 경로가 박히는 파일이라
#   공개 저장소에 커밋하기 적절치 않고, 경로를 런타임에 정하는 편이 이사에도 강하다.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.betaposlab.chainremote.docsbackup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGFILE="$HOME/Library/Logs/chainremote-docs-backup.log"

case "${1:-}" in
  --install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-lc</string>
    <string>$REPO/deploy/backup-docs.sh</string>
  </array>
  <!-- 맥북이 꺼져 있어 14시를 놓치면 launchd 가 다음에 깨어날 때 한 번 실행한다. -->
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGFILE</string>
  <key>StandardErrorPath</key><string>$LOGFILE</string>
</dict>
</plist>
PLIST_EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "✅ 자동 백업 등록 — 매일 14:00"
    echo "   로그: $LOGFILE"
    echo "   해제: $0 --uninstall"
    exit 0
    ;;
  --uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✅ 자동 백업 해제됨"
    exit 0
    ;;
esac
# 기본값을 Tailscale 로 둔다 — LAN IP 는 사무실에서 안 닿아 조용히 timeout 난다.
NAS_HOST="${NAS_HOST:-chang@100.93.42.91}"
DEST_DIR="cr-docs-backup"
KEEP=14
SSH_OPTS="-o ConnectTimeout=15 -o BatchMode=yes"
STAMP="$(date +%Y%m%d-%H%M)"
NAME="docs-${STAMP}.tar.gz"

if [[ ! -d "$REPO/docs/chainremote" ]]; then
  echo "✗ docs/chainremote 가 없다 — 경로 확인 필요" >&2
  exit 1
fi

echo "[1/3] NAS 접속 확인 ($NAS_HOST)..."
if ! ssh $SSH_OPTS "$NAS_HOST" "mkdir -p ~/$DEST_DIR && echo ok" >/dev/null 2>&1; then
  echo "✗ NAS 접속 실패 — Mac 쪽 Tailscale 이 stopped 인 경우가 십중팔구다" >&2
  exit 1
fi

echo "[2/3] 전송 중..."
# --no-mac-metadata: ._* AppleDouble 이 섞이면 NAS 에서 풀 때 지저분해진다.
# --no-xattrs: macOS 가 붙이는 com.apple.provenance 확장속성을 빼지 않으면 NAS 의 tar 가
#   "Ignoring unknown extended header keyword" 를 파일마다 뱉는다. 내용은 멀쩡한데 실패처럼 읽힌다.
tar czf - --no-mac-metadata --no-xattrs -C "$REPO" docs/chainremote \
  | ssh $SSH_OPTS "$NAS_HOST" "cat > ~/$DEST_DIR/$NAME"

echo "[3/3] 검증 + 오래된 백업 정리 (최근 $KEEP 개 유지)..."
REMOTE_CHECK=$(ssh $SSH_OPTS "$NAS_HOST" "
  set -e
  cd ~/$DEST_DIR
  gzip -t '$NAME' || { echo 'CORRUPT'; exit 1; }
  N=\$(tar tzf '$NAME' | wc -l | tr -d ' ')
  SZ=\$(wc -c < '$NAME' | tr -d ' ')
  ls -1t docs-*.tar.gz 2>/dev/null | tail -n +\$(( $KEEP + 1 )) | xargs -r rm -f
  TOTAL=\$(ls -1 docs-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
  echo \"OK \$N \$SZ \$TOTAL\"
")

case "$REMOTE_CHECK" in
  OK*)
    read -r _ FILES BYTES TOTAL <<< "$REMOTE_CHECK"
    echo
    echo "✅ 백업 완료 — $NAME"
    echo "   파일 $FILES 개 · $(( BYTES / 1024 ))KB · NAS 보관본 ${TOTAL}개"
    echo "   위치: $NAS_HOST:~/$DEST_DIR/"
    ;;
  *)
    echo "✗ 검증 실패: $REMOTE_CHECK" >&2
    exit 1
    ;;
esac
