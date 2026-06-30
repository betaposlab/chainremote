#!/bin/bash
# ChainRemote 관리패널(NAS docker) 재배포 — 1.4.42 기기지문 앵커 코드 + 마이그018.
#
# 왜 이 스크립트인가: 프로덕션 NAS 의 DB/배포 쓰기는 AI(자동 게이트)가 막는다(안전장치).
#   소유자(Chang)가 자기 맥에서 직접 실행 = 정상 경로. 한 번만 돌리면 끝.
#
# 사용:  bash ~/내작업/ChainRemote/deploy/nas/redeploy-panel.sh
#
# 동작: ① 패널 소스 tar→NAS(.env 보존) ② 마이그018(machine_uuid 컬럼) ③ 이미지 rebuild ④ up -d ⑤ 검증
#   - 안전: 빌드 성공 전까지 구 컨테이너 계속 가동(무중단). 마이그는 멱등(ADD COLUMN IF NOT EXISTS).
#   - .env / postgres·hbbs·hbbr 컨테이너는 절대 안 건드림(패널 서비스만 교체).
set -uo pipefail

NAS="chang@100.93.42.91"
NASDIR="/volume1/docker/chainremote-admin"
DOCKER="sudo -n /usr/local/bin/docker"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$REPO/chainremote-admin"
SSH="ssh -o BatchMode=yes $NAS"

set -e

echo "[1/5] 패널 소스 → NAS (.env·node_modules·.next 제외, 덮어쓰기)..."
tar czf - -C "$SRC" \
  --exclude='.env' --exclude='node_modules' --exclude='.next' --exclude='.git' \
  --exclude='._*' --exclude='.DS_Store' . \
  | $SSH "tar xzf - -C '$NASDIR'"
echo "    OK"

echo "[2/5] 마이그018 (machine_uuid 컬럼, 멱등) 프로덕션 DB 적용..."
$SSH "$DOCKER exec -i chainremote-postgres psql -U chainremote -d chainremote" \
  < "$SRC/migrations/018_customers_machine_uuid.sql"
echo "    OK"

echo "[3/5] 패널 이미지 rebuild (구 컨테이너는 성공 전까지 계속 가동 = 무중단)..."
$SSH "cd '$NASDIR' && $DOCKER compose build chainremote-admin"
echo "    OK"

echo "[4/5] 새 이미지로 교체 (up -d, 패널 서비스만)..."
$SSH "cd '$NASDIR' && $DOCKER compose up -d chainremote-admin"
echo "    OK"

set +e
echo "[5/5] 검증..."
echo -n "  machine_uuid 컬럼: "
$SSH "$DOCKER exec -i chainremote-postgres psql -U chainremote -d chainremote -tAc \"SELECT count(*) FROM information_schema.columns WHERE table_name='customers' AND column_name='machine_uuid';\"" 2>/dev/null
echo -n "  베이스 URL(패널이 서비스): "
$SSH "$DOCKER exec -i chainremote-admin printenv AGENT_BASE_URL 2>/dev/null || echo '(기본값 route.ts=1.4.42)'" 2>/dev/null
curl -sk -o /dev/null -w "  패널 HTTPS = %{http_code}\n" https://sepani.synology.me:3443/
echo "  컨테이너 상태:"
$SSH "$DOCKER ps --format '    {{.Names}}  {{.Status}}' | grep -E 'chainremote|postgres|hbbs|hbbr'" 2>/dev/null

echo ""
echo "✅ 패널 배포 완료 — 이제 [에이전트 다운로드]가 1.4.42(AB ID + 앵커)를 서비스."
echo "   사무실 Win7: 패널서 받아 더블클릭 설치 → 패널에 AB ID + 지문 자동 표시."
