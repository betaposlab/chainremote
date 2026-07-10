#!/bin/bash
# 관리패널(NAS docker) 재배포.
#
# 배포 정책(2026-07-01~): AI 가 코드+검증을 끝내고 Chang 승인을 받은 뒤 직접 실행한다.
#   (종전엔 자동 게이트가 AI 실행을 막아 Chang 이 손수 돌렸다. 이제는 승인창 승인 후 AI 가 실행.)
#
# 사용:  bash ~/내작업/ChainRemote/deploy/nas/redeploy-panel.sh
#        DRYRUN=1 bash ... → [유령 정리] 단계에서 삭제 대상만 출력하고 실제 삭제/배포는 안 함.
#
# 순서: 소스 tar→NAS → ★유령 정리 → 마이그 → 이미지 rebuild → up -d → 검증
#   - 빌드 성공 전까지 구 컨테이너를 그대로 가동해 무중단. 마이그는 멱등(ADD COLUMN IF NOT EXISTS).
#   - .env / postgres·hbbs·hbbr 컨테이너는 손대지 않는다. 패널 서비스만 교체.
#
# ★[유령 정리] (2026-07-09 추가): tar 는 "추가/덮어쓰기"만 하고 삭제를 반영 못 한다(tar 구조적
#   한계, 플래그로 못 고침). 그래서 로컬 git 에서 지운 파일이 NAS 에 유령으로 쌓여, next build 의
#   tsc 가 이미 삭제된 export 를 import 하는 유령 .tsx 를 컴파일하려다 빌드가 깨졌다(2026-07-09
#   _rollout-all-button.tsx 사고). rsync --delete 가 정석이나 macOS openrsync(protocol 29) ↔
#   NAS rsync(31) 핸드셰이크 실패로 이 환경선 불가(실측). 대신 "tar 가 방금 실은 정본 목록"과
#   "NAS 실제 목록"을 대조해 정본에 없는 파일만 지운다 = rsync --delete 와 동일 효과. 오라클을
#   git 이 아니라 tar 정본으로 두는 게 핵심(삭제됐다 재추가된 파일 오폭 방지).
set -uo pipefail

NAS="chang@100.93.42.91"
NASDIR="/volume1/docker/chainremote-admin"
DOCKER="sudo -n /usr/local/bin/docker"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/chainremote-admin"
SSH="ssh -o BatchMode=yes $NAS"
DRYRUN="${DRYRUN:-0}"

# tar 와 유령정리가 공유하는 단일 EXCLUDES (드리프트 0 — 둘이 어긋나면 오폭 위험).
EXCLUDES=( --exclude='.env' --exclude='node_modules' --exclude='.next' --exclude='.git'
           --exclude='._*' --exclude='.DS_Store' )

set -e

echo "[1/6] 패널 소스 → NAS (.env·node_modules·.next 제외, 덮어쓰기)..."
if [ "$DRYRUN" = "1" ]; then
  echo "    (DRYRUN — tar 전송 생략)"
else
  tar czf - -C "$SRC" "${EXCLUDES[@]}" . | $SSH "tar xzf - -C '$NASDIR'"
  echo "    OK"
fi

echo "[2/6] ★유령 정리 (로컬에서 지운 파일을 NAS 에도 반영)..."
KEEP="$(mktemp)"; NASLIST="$(mktemp)"; GHOSTS="$(mktemp)"
trap 'rm -f "$KEEP" "$NASLIST" "$GHOSTS"' EXIT
# 2a) 정본 = tar 가 실제로 싣는 멤버(같은 EXCLUDES). 디렉토리 항목(/끝) 제외, ./ prefix 정규화.
tar cf - -C "$SRC" "${EXCLUDES[@]}" . | tar tf - | grep -v '/$' | sed 's|^\./||' \
  | LC_ALL=C sort -u > "$KEEP"
# 2b) NAS 실제 파일 (EXCLUDES 와 동일 prune + 이름 제외). ._*/.DS_Store/.env 는 후보서 뺀다.
$SSH "cd '$NASDIR' && find . \\( -path './node_modules' -o -path './.next' -o -path './.git' \\) -prune \
  -o -type f ! -name '._*' ! -name '.DS_Store' ! -name '.env' -print" \
  | sed 's|^\./||' | LC_ALL=C sort -u > "$NASLIST"
# 2c) 안전 게이트: 공백/제어문자 경로가 있으면 줄 단위 comm/rm 이 위험 → 즉시 중단.
if LC_ALL=C grep -nq '[[:space:]]\|[^[:print:]]' "$KEEP" "$NASLIST"; then
  echo "    ✗ 중단: 공백/제어문자 포함 경로 감지 — 수동 확인 필요."; exit 3
fi
# 2d) 유령 = NAS 에만 있고 정본엔 없음. + 절대 삭제 금지 가드(.env*/node_modules/.next/.git) 재차.
comm -23 "$NASLIST" "$KEEP" \
  | grep -Ev '(^|/)\.env($|\.)|(^|/)node_modules/|(^|/)\.next/|(^|/)\.git/' > "$GHOSTS" || true
if [ -s "$GHOSTS" ]; then
  echo "    삭제 대상 유령:"; sed 's/^/      /' "$GHOSTS"
  if [ "$DRYRUN" = "1" ]; then
    echo "    (DRYRUN — 실제 삭제 안 함)"
  else
    # NAS 측에서도 case 가드 재적용(이중 안전망). 한 줄=한 파일이 위 2c 로 보장됨.
    # ⚠ 루프 안 ssh 에는 반드시 </dev/null — 안 그러면 ssh 가 이 while 의 stdin($GHOSTS)을
    #   통째로 빨아들여 첫 줄만 처리하고 루프가 조기 종료된다(2026-07-09 실측 버그).
    while IFS= read -r p; do
      case "$p" in
        .env|.env.*|*/.git/*|*/node_modules/*|*/.next/*) echo "      스킵(보호): $p" ;;
        *) $SSH "cd '$NASDIR' && rm -vf -- './$p'" </dev/null ;;
      esac
    done < "$GHOSTS"
  fi
else
  echo "    유령 없음 (NAS 가 정본과 일치)."
fi

if [ "$DRYRUN" = "1" ]; then echo ""; echo "DRYRUN 종료 — 실제 배포는 DRYRUN 없이 재실행."; exit 0; fi

echo "[3/6] DB 마이그레이션 전체 적용 (migrations/*.sql, 정렬순, 전부 멱등)..."
# ★2026-07-10: 종전엔 018 하나만 하드코딩해서, 새 마이그를 추가할 때마다 이 스크립트도 같이
#   고쳐야 했다 — 깜빡하면 프로덕션에 컬럼 없이 배포돼 빌드/런타임이 깨진다(같은 '깜빡' 사고
#   클래스). 우리 마이그는 전부 멱등(ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
#   DROP+ADD CONSTRAINT)이라 정렬 순서대로 매번 전부 재적용한다 = 새 .sql 파일만 넣으면 자동
#   반영, 스크립트 수정 불필요. ★규칙: 앞으로 모든 마이그는 재실행 안전(멱등)해야 한다.
for m in $(ls -1 "$SRC"/migrations/*.sql | sort); do
  echo "    적용: $(basename "$m")"
  $SSH "$DOCKER exec -i chainremote-postgres psql -U chainremote -d chainremote -v ON_ERROR_STOP=1" < "$m" >/dev/null
done
echo "    OK"

echo "[4/6] 패널 이미지 rebuild (구 컨테이너는 성공 전까지 계속 가동 = 무중단)..."
$SSH "cd '$NASDIR' && $DOCKER compose build chainremote-admin"
echo "    OK"

echo "[5/6] 새 이미지로 교체 (up -d, 패널 서비스만)..."
$SSH "cd '$NASDIR' && $DOCKER compose up -d chainremote-admin"
echo "    OK"

set +e
echo "[6/6] 검증..."
echo -n "  customers 컬럼(machine_uuid/arch 존재수, 2 여야 정상): "
$SSH "$DOCKER exec -i chainremote-postgres psql -U chainremote -d chainremote -tAc \"SELECT count(*) FROM information_schema.columns WHERE table_name='customers' AND column_name IN ('machine_uuid','arch');\"" 2>/dev/null
echo -n "  agent-push.json 라이브 버전: "
curl -sk --max-time 10 https://sepani.synology.me/chainremote/agent-push.json 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version","?"))' 2>/dev/null || echo "?"
curl -sk -o /dev/null -w "  패널 HTTPS = %{http_code}\n" https://sepani.synology.me:3443/
echo "  컨테이너 상태:"
$SSH "$DOCKER ps --format '    {{.Names}}  {{.Status}}' | grep -E 'chainremote|postgres|hbbs|hbbr'" 2>/dev/null

echo ""
echo "✅ 패널 배포 완료 — [최신 가져오기] + 테넌트별 [에이전트 다운로드] 둘 다 agent-push.json 최신을 서비스."
