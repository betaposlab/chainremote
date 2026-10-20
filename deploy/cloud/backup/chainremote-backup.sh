#!/bin/bash
# ChainRemote 클라우드 백업 — DB + hbbs 키 + 스택 설정을 묶어 서버 안에 만들어 둔다. 03:40 cron.
# 집 NAS 가 04:10 에 가져간다(cr-backup-serve.sh 가 내준다).
#
# 왜 NAS 에 두는가: iwinv 약관상 데이터 보존은 전적으로 고객 책임이고, 미결제가 9일 이어지면
# 서버가 통째로 삭제된다. 같은 서버 안에 둔 백업은 그때 같이 사라진다. 집 NAS 는 지리적으로
# 분리돼 있어 그 두 경우를 모두 넘긴다. 여기 남기는 건 NAS 가 가져갈 때까지의 대기분이다.
#
# 왜 NAS 가 가져가는가(2026-10-20 에 방향을 바꿨다): 종전엔 이 스크립트가 NAS 의 SSH 로 밀어
# 넣었다. 그러려면 집 공유기에 22번이 열려 있어야 했고, 그 22번이 NAS 침입 경로였다. 지금은
# 집으로 들어오는 포트가 하나도 필요 없다. NAS 키는 강제 커맨드라 백업 하나를 받아 가는 것
# 말고는 아무것도 못 한다.
set -euo pipefail

STACK=/opt/chainremote
LOG=/var/log/chainremote-backup.log
DIR=/var/backups/chainremote
KEEP_LOCAL=3
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

log "start"

# 1) DB — 컨테이너 안에서 덤프. 실패하면 여기서 멈춘다(빈 백업을 내주지 않는다).
docker exec chainremote-postgres pg_dump -U chainremote -d chainremote --no-owner --no-acl \
  > "$WORK/chainremote.sql"
[ -s "$WORK/chainremote.sql" ] || { log "FAIL pg_dump empty"; exit 1; }
ROWS=$(grep -c '^COPY ' "$WORK/chainremote.sql" || true)

# 2) hbbs 개인키 — 이게 없으면 거래처 전부가 서버를 못 믿는다. 재발급이 불가능한 유일한 자산.
docker run --rm -v chainremote_hbbs-data:/d alpine \
  tar -cf - -C /d id_ed25519 id_ed25519.pub > "$WORK/hbbs-key.tar"

# 3) 스택 설정(.env 포함 — DB 비번/AUTH_SECRET)
tar -czf "$WORK/stack.tar.gz" -C "$STACK" docker-compose.yml .env 2>/dev/null || true

# 4) 묶어서 대기 폴더에 둔다. .part 로 쓰고 검사가 끝난 뒤에 이름을 바꾼다 —
#    NAS 가 쓰는 도중의 파일을 받아 가지 않게.
tar -czf "$WORK/bundle.tar.gz" -C "$WORK" chainremote.sql hbbs-key.tar stack.tar.gz
install -d -m 700 "$DIR"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/chainremote-cloud-$TS.tar.gz"
cp "$WORK/bundle.tar.gz" "$OUT.part"
chmod 600 "$OUT.part"
gzip -t "$OUT.part" || { rm -f "$OUT.part"; log "FAIL bundle corrupt"; exit 1; }
mv "$OUT.part" "$OUT"
SIZE=$(stat -c %s "$OUT")
ls -1t "$DIR"/chainremote-cloud-*.tar.gz 2>/dev/null | tail -n +$((KEEP_LOCAL+1)) | xargs -r rm -f
log "OK built $(basename "$OUT") ${SIZE}bytes (COPY blocks=$ROWS) — NAS 가 가져가기를 기다림"
