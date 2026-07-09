#!/usr/bin/env bash
# 스텝 자료실(betaposlab.com/staff)용 '키 포함' 오버레이 exe 갱신 — betaposlab 자체 tenant.
#
# 왜 따로 있나: agent-push.json 의 베이스 exe(빈 키)는 자동푸시/오버레이 재료 전용이지
#   직접설치용이 아니다(2026-07-09 카페리치 사고, 메모리 feedback_empty_key_exe_never_
#   direct_deploy). 스텝 자료실은 직원이 직접 받아 까는 곳이라 반드시 패널 [에이전트
#   다운로드]가 만드는 키 포함 오버레이여야 한다. 이 스크립트는 그 다운로드를 curl 로
#   재현한다 — enroll-key 는 서버 안에서만 다루고 로컬 파일/커밋엔 절대 안 남는다.
#
# ★release-agent.sh 에 이 오버레이 exe 를 넘기면 안 됨 — 그건 [1·3]agent-push.json 도
#   같이 갱신해 자동푸시 소스가 특정 대리점 키 포함 오버레이로 오염된다. 이 스크립트는
#   [4]자료실 갱신만 담당(release-agent.sh 가 raw 베이스를 거부한 뒤 자동 호출).
#
# 사용: ./deploy/nas/publish-staff-overlay.sh
#   패널 비번  = 환경변수 PANEL_PW, 또는 deploy/nas/.panel-pw 파일(gitignore).
#   자료실 비번 = 환경변수 STAFF_PW, 또는 deploy/nas/.staff-pw 파일(gitignore).
#   둘 중 하나라도 없으면 스킵(수동 안내만) — exit 0(파이프라인 전체를 막지 않음).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_BASE="https://sepani.synology.me:3443"
PANEL_USER="chang"
BETAPOSLAB_TENANT_ID="9a1d5fe4-e616-42c0-9e23-87b1bbd69b1f"

echo "════ [4단계] 스텝 자료실용 키포함 오버레이 갱신 (betaposlab tenant) ════"

PANEL_PW="${PANEL_PW:-}"
if [[ -z "$PANEL_PW" && -f "$SCRIPT_DIR/.panel-pw" ]]; then
  PANEL_PW="$(tr -d '[:space:]' < "$SCRIPT_DIR/.panel-pw")"
fi
STAFF_PW="${STAFF_PW:-}"
if [[ -z "$STAFF_PW" && -f "$SCRIPT_DIR/.staff-pw" ]]; then
  STAFF_PW="$(tr -d '[:space:]' < "$SCRIPT_DIR/.staff-pw")"
fi
if [[ -z "$PANEL_PW" || -z "$STAFF_PW" ]]; then
  echo "  ⚠ PANEL_PW/STAFF_PW 없음 → 스킵. 수동: 메모리 feedback_empty_key_exe_never_direct_deploy 레시피." >&2
  exit 0
fi

JAR="$(mktemp)"; OVERLAY="$(mktemp)"; RESP="$(mktemp)"; SC="$(mktemp)"
trap 'rm -f "$JAR" "$OVERLAY" "$RESP" "$SC"' EXIT
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8

# 1) CSRF 토큰
CSRF="$(curl -sk -c "$JAR" "$PANEL_BASE/api/auth/csrf" | python3 -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])' 2>/dev/null)"
if [[ -z "$CSRF" ]]; then
  echo "  ✗ CSRF 토큰 획득 실패 — 패널 접속(NAS/Tailscale) 확인 필요." >&2
  exit 1
fi

# 2) 로그인 (NextAuth 브라우저 세션 쿠키 — 데스크톱 앱 좌석 시스템과 무관, 세션 점유 없음)
curl -sk -b "$JAR" -c "$JAR" -X POST "$PANEL_BASE/api/auth/callback/credentials" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "username=$PANEL_USER" \
  --data-urlencode "password=$PANEL_PW" \
  --data-urlencode "redirect=false" \
  -o "$RESP" >/dev/null

# 3) 오버레이 다운로드 (enroll-key 는 서버 내부에서만 주입, 로컬엔 완제품 exe 만 도착)
curl -sk -b "$JAR" -X POST "$PANEL_BASE/api/tenants/$BETAPOSLAB_TENANT_ID/agent" -o "$OVERLAY"

# 4) 검증(카페리치 가드 재사용) — 진짜 오버레이인지 + enroll-key 채워졌는지.
OVERLAY_CHECK="$(python3 - "$OVERLAY" <<'PY'
import sys, json, struct
try:
    data = open(sys.argv[1], 'rb').read()
    if len(data) < 12 or data[-8:] != b'CRENROL1':
        print("NO_OVERLAY"); sys.exit(0)
    length = struct.unpack('<i', data[-12:-8])[0]
    if length <= 0 or length > 65536:
        print("BAD_LEN"); sys.exit(0)
    cfg = json.loads(data[-12-length:-12].decode('utf-8'))
    print("OK_KEY" if str(cfg.get('enroll-key', '')).strip() else "EMPTY_KEY")
except Exception as e:
    print("ERR:" + str(e).replace(chr(10), ' '))
PY
)"
if [[ "$OVERLAY_CHECK" != "OK_KEY" ]]; then
  echo "  ✗ 오버레이 검증 실패(검사=$OVERLAY_CHECK, 응답 $(wc -c < "$OVERLAY" | tr -d ' ')bytes) — 업로드 중단(안전)." >&2
  echo "    로그인 실패(비번) 가능성 — PANEL_PW 확인 필요." >&2
  exit 1
fi

# 5) 파일명 — agent-push.json 의 현재 version 사용(방금 [1·3]에서 갱신된 값과 항상 일치).
VERSION="$(curl -s https://sepani.synology.me/chainremote/agent-push.json | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])' 2>/dev/null)"
if [[ -z "$VERSION" ]]; then
  echo "  ✗ agent-push.json 버전 조회 실패 — 업로드 중단." >&2
  exit 1
fi
FILENAME="ChainRemote_Agent_Setup_v${VERSION}.exe"
echo "  ✓ 오버레이 확인(키 포함) — $FILENAME"

# 6) 스텝 자료실 업로드 (reference_staff_drive_upload 레시피 재사용)
curl -s -c "$SC" -d "action=login&pw=$STAFF_PW" https://betaposlab.com/staff/index.php -o "$RESP"
if ! grep -q '"status":"success"' "$RESP"; then
  echo "  ✗ 스텝 자료실 로그인 실패(STAFF_PW 확인 필요)." >&2
  exit 1
fi
OLD_AGENTS="$(curl -s -b "$SC" https://betaposlab.com/staff/ \
  | grep -oE 'ChainRemote_Agent_Setup_v[0-9.]+\.exe' | sort -u | grep -vF "$FILENAME" || true)"
curl -s -b "$SC" --max-time 300 -F "action=upload" -F "file=@$OVERLAY;filename=$FILENAME" \
  "https://betaposlab.com/staff/index.php" -o "$RESP"
if ! grep -q '"status":"success"' "$RESP"; then
  echo "  ✗ 업로드 실패 — 옛 버전은 그대로 둠(안전)." >&2
  exit 1
fi
if curl -s -b "$SC" https://betaposlab.com/staff/ | grep -qF "$FILENAME"; then
  echo "  ✓ 업로드 확인: $FILENAME"
  if [[ -n "$OLD_AGENTS" ]]; then
    while IFS= read -r old; do
      [[ -z "$old" ]] && continue
      curl -s -b "$SC" -F "action=delete" -F "filename=$old" "https://betaposlab.com/staff/index.php" -o "$RESP" </dev/null
      grep -q '"status":"success"' "$RESP" && echo "    옛 버전 삭제: $old" || echo "    ⚠ 삭제 실패(무해, 수동 정리): $old"
    done <<< "$OLD_AGENTS"
  fi
else
  echo "  ⚠ 업로드는 success 였으나 목록 미확인 — 옛 버전 삭제 보류(안전)." >&2
fi
