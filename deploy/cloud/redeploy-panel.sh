#!/bin/bash
# 관리패널(iwinv 클라우드 docker) 재배포.
#
# 2026-08-05 신설. 종전 배포처는 NAS 였고 그 스크립트는 deploy/nas/redeploy-panel.sh 에 남아
# 있다 — 클라우드 전환 후 프로덕션 패널은 여기고, NAS 쪽은 chain.betaposlab.com 이 은퇴할
# 때까지만 도는 잔존 스택이다. 둘을 헷갈리면 "배포했는데 아무것도 안 바뀌는" 사고가 난다.
#
# 배포 정책: AI 가 코드+검증을 끝내고 Chang 승인을 받은 뒤 직접 실행한다.
#
# 사용:  bash ~/내작업/ChainRemote/deploy/cloud/redeploy-panel.sh
#        DRYRUN=1 bash ... → [유령 정리] 단계에서 삭제 대상만 출력하고 실제 삭제/배포는 안 함.
#
# 순서: 소스 tar→클라우드 → ★유령 정리 → 마이그 → 이미지 rebuild → up -d → 검증
#   - 빌드 성공 전까지 구 컨테이너를 그대로 가동해 무중단. 마이그는 멱등.
#   - .env / postgres·hbbs·hbbr 컨테이너는 손대지 않는다. 패널 서비스만 교체.
#
# ★[유령 정리]: tar 는 "추가/덮어쓰기"만 하고 삭제를 반영 못 한다. 로컬에서 지운 파일이
#   서버에 유령으로 남으면 next build 의 tsc 가 이미 없는 export 를 import 하려다 깨진다
#   (2026-07-09 _rollout-all-button.tsx 사고). "tar 가 방금 실은 정본 목록"과 "서버 실제
#   목록"을 대조해 정본에 없는 것만 지운다 = rsync --delete 와 동일 효과.
set -uo pipefail

HOST="root@115.68.192.153"
DSTDIR="/opt/chainremote/admin-src"
STACKDIR="/opt/chainremote"
DOCKER="docker"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/chainremote-admin"
SSH="ssh -o BatchMode=yes $HOST"
DRYRUN="${DRYRUN:-0}"

# tar 와 유령정리가 공유하는 단일 EXCLUDES (드리프트 0 — 둘이 어긋나면 오폭 위험).
EXCLUDES=( --exclude='.env' --exclude='node_modules' --exclude='.next' --exclude='.git'
           --exclude='._*' --exclude='.DS_Store' )

set -e

echo "[1/6] 패널 소스 → 클라우드 (.env·node_modules·.next 제외, 덮어쓰기)..."
if [ "$DRYRUN" = "1" ]; then
  echo "    (DRYRUN — tar 전송 생략)"
else
  tar czf - -C "$SRC" "${EXCLUDES[@]}" . | $SSH "tar xzf - -C '$DSTDIR'"
  echo "    OK"
fi

echo "[2/6] ★유령 정리 (로컬에서 지운 파일을 서버에도 반영)..."
KEEP="$(mktemp)"; SRVLIST="$(mktemp)"; GHOSTS="$(mktemp)"
trap 'rm -f "$KEEP" "$SRVLIST" "$GHOSTS"' EXIT
# 2a) 정본 = tar 가 실제로 싣는 멤버(같은 EXCLUDES). 디렉토리 항목(/끝) 제외, ./ prefix 정규화.
tar cf - -C "$SRC" "${EXCLUDES[@]}" . | tar tf - | grep -v '/$' | sed 's|^\./||' \
  | LC_ALL=C sort -u > "$KEEP"
# 2b) 서버 실제 파일 (EXCLUDES 와 동일 prune + 이름 제외).
$SSH "cd '$DSTDIR' && find . \\( -path './node_modules' -o -path './.next' -o -path './.git' \\) -prune \
  -o -type f ! -name '._*' ! -name '.DS_Store' ! -name '.env' -print" \
  | sed 's|^\./||' | LC_ALL=C sort -u > "$SRVLIST"
# 2c) 안전 게이트: 공백/제어문자 경로가 있으면 줄 단위 comm/rm 이 위험 → 즉시 중단.
if LC_ALL=C grep -nq '[[:space:]]\|[^[:print:]]' "$KEEP" "$SRVLIST"; then
  echo "    ✗ 중단: 공백/제어문자 포함 경로 감지 — 수동 확인 필요."; exit 3
fi
# 2d) 유령 = 서버에만 있고 정본엔 없음. + 절대 삭제 금지 가드 재차.
comm -23 "$SRVLIST" "$KEEP" \
  | grep -Ev '(^|/)\.env($|\.)|(^|/)node_modules/|(^|/)\.next/|(^|/)\.git/' > "$GHOSTS" || true
if [ -s "$GHOSTS" ]; then
  echo "    삭제 대상 유령:"; sed 's/^/      /' "$GHOSTS"
  if [ "$DRYRUN" = "1" ]; then
    echo "    (DRYRUN — 실제 삭제 안 함)"
  else
    # ⚠ 루프 안 ssh 에는 반드시 </dev/null — 안 그러면 ssh 가 이 while 의 stdin($GHOSTS)을
    #   통째로 빨아들여 첫 줄만 처리하고 루프가 조기 종료된다(2026-07-09 실측 버그).
    while IFS= read -r p; do
      case "$p" in
        .env|.env.*|*/.git/*|*/node_modules/*|*/.next/*) echo "      스킵(보호): $p" ;;
        *) $SSH "cd '$DSTDIR' && rm -vf -- './$p'" </dev/null ;;
      esac
    done < "$GHOSTS"
  fi
else
  echo "    유령 없음 (서버가 정본과 일치)."
fi

if [ "$DRYRUN" = "1" ]; then echo ""; echo "DRYRUN 종료 — 실제 배포는 DRYRUN 없이 재실행."; exit 0; fi

echo "[3/6] DB 마이그레이션 전체 적용 (migrations/*.sql, 정렬순, 전부 멱등)..."
# 우리 마이그는 전부 재실행 안전(멱등)이라 정렬 순서대로 매번 전부 재적용한다 = 새 .sql 만
# 넣으면 자동 반영, 스크립트 수정 불필요. ★규칙: 모든 마이그는 멱등이어야 한다.
for m in $(ls -1 "$SRC"/migrations/*.sql | sort); do
  echo "    적용: $(basename "$m")"
  $SSH "$DOCKER exec -i chainremote-postgres psql -U chainremote -d chainremote -v ON_ERROR_STOP=1" < "$m" >/dev/null
done
echo "    OK"

echo "[4/6] 패널 이미지 rebuild (구 컨테이너는 성공 전까지 계속 가동 = 무중단)..."
$SSH "cd '$STACKDIR' && $DOCKER compose build admin"
echo "    OK"

echo "[5/6] 새 이미지로 교체 (up -d, 패널 서비스만)..."
$SSH "cd '$STACKDIR' && $DOCKER compose up -d admin"
echo "    OK"

set +e
echo "[6/6] 검증..."
echo -n "  customers 컬럼(machine_uuid/arch 존재수, 2 여야 정상): "
$SSH "$DOCKER exec -i chainremote-postgres psql -U chainremote -d chainremote -tAc \"SELECT count(*) FROM information_schema.columns WHERE table_name='customers' AND column_name IN ('machine_uuid','arch');\"" 2>/dev/null
curl -s -o /dev/null -w "  https://626.kr/login = %{http_code}\n" --max-time 20 https://626.kr/login
curl -s -o /dev/null -w "  https://api.626.kr/login = %{http_code}\n" --max-time 20 https://api.626.kr/login
echo "  컨테이너 상태:"
$SSH "$DOCKER ps --format '    {{.Names}}  {{.Status}}'" 2>/dev/null

echo ""
echo "✅ 패널 배포 완료 (클라우드)."
