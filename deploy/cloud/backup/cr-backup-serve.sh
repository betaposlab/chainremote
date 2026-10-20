#!/bin/bash
# NAS 가 백업을 가져갈 때만 돈다 — root authorized_keys 의 강제 커맨드.
#   command="/usr/local/bin/cr-backup-serve.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,no-user-rc ssh-ed25519 … chainremote-nas-backup-pull
#
# 이 키로는 "가장 최근 백업 하나를 표준출력으로 내주기" 말고는 아무것도 못 한다. NAS 가 다시
# 뚫려도 그 키로 클라우드에 넘어오지 못하게 하는 게 목적이다. NAS 가 보낸 명령은 보지 않는다.
# 26시간보다 오래된 백업은 내주지 않는다 — 어젯밤 백업이 실패했는데 그제 것을 오늘 것처럼
# 받아 가면, NAS 쪽 기록만 보고는 실패를 모른다.
set -euo pipefail
DIR=/var/backups/chainremote
LOG=/var/log/chainremote-backup.log
MAX_AGE_MIN=1560
CLIENT="${SSH_CLIENT:-local}"; CLIENT="${CLIENT%% *}"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

LATEST=$(ls -1t "$DIR"/chainremote-cloud-*.tar.gz 2>/dev/null | head -1 || true)
if [ -z "$LATEST" ]; then
  log "SERVE REFUSE no bundle ($CLIENT)"; echo "no bundle" >&2; exit 1
fi
if [ -n "$(find "$LATEST" -mmin +$MAX_AGE_MIN)" ]; then
  log "SERVE REFUSE stale $(basename "$LATEST") ($CLIENT)"; echo "stale bundle: $(basename "$LATEST")" >&2; exit 2
fi
log "SERVE $(basename "$LATEST") $(stat -c %s "$LATEST")bytes -> $CLIENT"
cat "$LATEST"
