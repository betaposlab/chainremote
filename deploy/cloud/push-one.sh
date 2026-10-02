#!/usr/bin/env bash
# 운영자용 — 거래처 **한 대**에 에이전트 업데이트 푸시를 건다(대리점 구분 없이, 원격 ID 로).
#
# 왜 필요한가 (2026-10-01 달인식자재마트):
#   패널의 [푸시] 는 운영자(super_admin)라도 **자기 대리점 거래처**에만 걸 수 있다. 다른
#   대리점 PC 를 원격으로 다시 띄워야 했을 때 방법이 없어, DB 에 한 줄을 손으로 넣었다.
#   손으로 넣는 한 줄은 검증이 없다 — sha 를 틀리게 적으면 그 PC 는 받아서 버리고, 대기 중인
#   푸시가 이미 있는지도 모른다. 그 한 줄을 검증과 기록이 붙은 도구로 바꾼다.
#
# 하는 일: 지금 발행본(agent-push.json)의 버전·주소·sha·크기를 그대로 써서 pending_updates 에
#   한 행을 넣고 audit_logs 에 남긴다. 그 PC 가 다음 푸시 확인(5분 주기) 때 받아 가 재설치한다.
#   ★스테이징(auto_rollout=false) 버전도 건다 — 단건은 실기기 검증 경로다(패널 [푸시] 와 같은 규칙).
#
# 사용:  ./deploy/cloud/push-one.sh <원격ID>
#   예)  ./deploy/cloud/push-one.sh QX32443649
#   DRYRUN=1 을 붙이면 무엇을 넣을지만 보여 주고 넣지 않는다.
#
# 거르는 것: 없는 ID / 이미 대기 중인 푸시가 있는 PC / 발행본보다 높은 버전의 PC(에이전트가
#   낮은 버전은 설치하지 않는다) / 발행본 메타가 온전치 않은 경우.
set -euo pipefail

RID="${1:-}"
if [[ ! "$RID" =~ ^[A-Za-z0-9]{6,16}$ ]]; then
  echo "사용법: $0 <원격ID>   (영문·숫자 6~16자)" >&2
  exit 2
fi
RID="$(printf '%s' "$RID" | tr '[:lower:]' '[:upper:]')"

SERVER="${CR_SERVER:-root@115.68.192.153}"
META_URL="${CR_META_URL:-https://sepani.synology.me/chainremote/agent-push.json}"
# SQL 은 표준입력으로 넘긴다. ssh 는 인자를 한 줄로 이어 원격 셸에 다시 넘기므로, -c 로
# 주면 따옴표·괄호가 원격 셸에서 풀려 버린다(첫 판이 그렇게 깨졌다).
run_sql() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" \
    "docker exec -i chainremote-postgres psql -U chainremote -d chainremote -v ON_ERROR_STOP=1 -At -f -"
}

META="$(curl -fsS -m 15 "$META_URL")" || { echo "✗ 발행본 정보를 못 읽었습니다: $META_URL" >&2; exit 1; }
read -r VER URL SHA SIZE < <(printf '%s' "$META" | python3 -c '
import json,sys
j=json.load(sys.stdin)
print(j.get("version",""), j.get("url",""), j.get("sha256",""), j.get("size",0))')
[[ "$VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "✗ 발행본 버전이 이상합니다: '$VER'" >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]]            || { echo "✗ 발행본 sha256 이 이상합니다" >&2; exit 1; }
[[ "$URL" =~ ^https://[A-Za-z0-9._/-]+\.exe$ ]] || { echo "✗ 발행본 주소가 이상합니다: '$URL'" >&2; exit 1; }
[[ "$SIZE" =~ ^[0-9]+$ && "$SIZE" -gt 1000000 ]] || { echo "✗ 발행본 크기가 이상합니다: '$SIZE'" >&2; exit 1; }

# 대상 확인. 값은 위에서 모양을 검사했으므로 SQL 에 그대로 넣는다(따옴표가 들어올 길이 없다).
ROW="$(run_sql <<SQL
SELECT c.id, c.tenant_id, t.display_name, c.name, coalesce(c.last_version,''),
       coalesce(to_char(c.last_heartbeat_at AT TIME ZONE 'Asia/Seoul','MM-DD HH24:MI'),'-'),
       (SELECT count(*) FROM pending_updates p WHERE p.customer_id=c.id
          AND p.applied_at IS NULL AND p.cancelled_at IS NULL AND p.failed_at IS NULL)
FROM customers c JOIN tenants t ON t.id=c.tenant_id WHERE c.remote_id='$RID';
SQL
)"
if [[ -z "$ROW" ]]; then echo "✗ 그 원격 ID 의 거래처가 없습니다: $RID" >&2; exit 1; fi
if [[ "$(printf '%s\n' "$ROW" | wc -l)" -gt 1 ]]; then echo "✗ 같은 원격 ID 가 여러 행입니다 — 패널에서 정리 후 다시:" >&2; printf '%s\n' "$ROW" >&2; exit 1; fi
IFS='|' read -r CID TID TNAME CNAME CUR HB PENDING <<<"$ROW"

echo "대상   : $CNAME  ($RID)"
echo "대리점 : $TNAME"
echo "현재   : v${CUR:-?}   마지막 보고 $HB (한국시간)"
echo "보낼 것: v$VER  $(basename "$URL")  ${SIZE} bytes"

if [[ "$PENDING" != "0" ]]; then
  echo "✗ 이미 대기 중인 푸시가 ${PENDING}건 있습니다 — 겹쳐 걸지 않습니다." >&2; exit 1
fi
if [[ -n "$CUR" ]]; then
  HIGHER="$(python3 -c '
import sys
a=[int(x) for x in sys.argv[1].split(".")[:3]]; b=[int(x) for x in sys.argv[2].split(".")[:3]]
print("1" if a>b else "0")' "$CUR" "$VER" 2>/dev/null || echo 0)"
  if [[ "$HIGHER" == "1" ]]; then echo "✗ 그 PC 가 이미 더 높은 버전(v$CUR)입니다 — 에이전트는 낮은 버전을 설치하지 않습니다." >&2; exit 1; fi
  if [[ "$CUR" == "$VER" ]]; then echo "※ 그 PC 는 이미 v$VER 입니다. 에이전트가 \"이미 최신\"으로 보고하고 재설치하지 않습니다."; fi
fi

if [[ "${DRYRUN:-0}" == "1" ]]; then echo "(DRYRUN — 넣지 않았습니다)"; exit 0; fi

OUT="$(run_sql <<SQL
WITH op AS (SELECT id FROM users WHERE role='super_admin' AND is_active ORDER BY created_at LIMIT 1),
ins AS (
  INSERT INTO pending_updates (tenant_id, customer_id, target_version, asset_url, asset_sha256, asset_size,
                               window_start_hour, window_end_hour, randomize_max_sec, requested_by)
  VALUES ('$TID', '$CID', '$VER', '$URL', '$SHA', $SIZE, 0, 24, 0, (SELECT id FROM op))
  RETURNING id)
INSERT INTO audit_logs (tenant_id, user_id, action, target_type, target_id, metadata)
SELECT '$TID', (SELECT id FROM op), 'push.single', 'customer', '$CID',
       jsonb_build_object('via','push-one.sh','remoteId','$RID','targetVersion','$VER','pushId',(SELECT id FROM ins))
RETURNING (metadata->>'pushId');
SQL
)"
echo "✓ 푸시 등록: $OUT"
echo "  그 PC 가 5분 안에 받아 가 재설치합니다. 패널 거래처 표의 버전이 v$VER 로 바뀌면 끝입니다."
