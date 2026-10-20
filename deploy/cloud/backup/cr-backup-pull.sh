#!/bin/bash
# 클라우드(iwinv chainremote-01)의 백업을 가져와 NAS 에 보관한다.
# DSM 작업 스케줄러가 매일 04:10 에 돌린다(사용자 chang). 클라우드는 03:40 에 만들어 둔다.
#
# 2026-10-20 방향을 바꿨다: 종전엔 클라우드가 NAS 의 SSH(공유기 22번)로 밀어 넣었다. 그 22번이
# NAS 침입 경로였고 인터넷에서 닫았다. 이제 NAS 가 가져가므로 집으로 들어오는 포트가 필요 없다.
# 클라우드 쪽 키는 강제 커맨드(cr-backup-serve.sh)라 최근 백업 하나를 내주는 것 말고는 못 한다.
# 파일명·보관 개수는 여기서 정한다.
set -u
H=/var/services/homes/chang
DEST=$H/cr-cloud-backup
KEY=$H/.ssh/id_backup_pull
KH=$H/.ssh/known_hosts
CLOUD=root@115.68.192.153
KEEP=14
LOG="$DEST/receive.log"

mkdir -p "$DEST"
TS="$(date +%Y%m%d-%H%M%S)"
TMP="$DEST/.incoming-$TS.tar.gz"
ERR="$DEST/.pull-err"
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

if ! ssh -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$KH" \
       -i "$KEY" "$CLOUD" > "$TMP" 2> "$ERR"; then
  log "FAIL pull: $(tr '\n' ' ' < "$ERR" | cut -c1-200)"
  rm -f "$TMP"; exit 1
fi

# 빈 파일·잘린 전송·엉뚱한 내용을 정본으로 올리지 않는다.
LIST=$(tar -tzf "$TMP" 2>/dev/null || true)
if [ ! -s "$TMP" ] || ! gzip -t "$TMP" 2>/dev/null \
   || ! echo "$LIST" | grep -qx "chainremote.sql" || ! echo "$LIST" | grep -qx "hbbs-key.tar"; then
  rm -f "$TMP"; log "REJECT $TS (empty, corrupt or not a bundle)"; exit 1
fi

mv "$TMP" "$DEST/chainremote-cloud-$TS.tar.gz"
SIZE=$(stat -c %s "$DEST/chainremote-cloud-$TS.tar.gz" 2>/dev/null || echo 0)
ls -1t "$DEST"/chainremote-cloud-*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f
rm -f "$ERR"
log "OK pulled chainremote-cloud-$TS.tar.gz ${SIZE}bytes"
echo "pulled chainremote-cloud-$TS.tar.gz ${SIZE}bytes"
