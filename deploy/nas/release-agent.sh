#!/usr/bin/env bash
# 거래처 에이전트 새 버전 배포 — 4단계 룰 오케스트레이터 (Chang 확정 2026-07-08, 법칙).
#
# ★빌드는 안 한다. 빌드는 윈컴에서 별도(수동 빌드 워크플로 유지 — 메모리 feedback_no_
#   autobuild_workflow). 이 스크립트는 "이미 빌드된 setup.exe" 를 받아 배포 채널에만 반영한다.
#
# 4단계 룰(에이전트 버전업 시 반드시 전부):
#   1. 각 대리점 [에이전트 다운로드]  → agent-push.json 참조(자동). ↓아래 [1·3]이 갱신.
#   2. 관리패널 [전체 일괄 푸시]        → ★Chang 이 패널서 직접 클릭. 살아있는 거래처 플릿
#                                         전체에 즉시 영향(대량조작)이라 사람 게이트로 남김.
#                                         이 스크립트는 안내만 한다(자동 실행 안 함).
#   3. 자동 롤링                        → 2번의 일괄푸시가 곧 이것(pending_updates 5분 폴링).
#   4. 스텝 자료실(betaposlab.com/staff)→ ↓아래 [4]가 업로드 + 옛 버전 정리.
#
# 즉: 이 스크립트 = [1·3 소스 갱신] + [4 자료실] 자동, [2]는 안내. 실행 후 Chang 이 패널서
#     일괄푸시 클릭 한 번으로 4단계 완성.
#
# 사용: ./deploy/nas/release-agent.sh <ChainRemote_Agent_Setup_vX.Y.Z.exe> ["릴리즈노트"]
#   스텝 자료실 로그인 비번 = 환경변수 STAFF_PW, 또는 deploy/nas/.staff-pw 파일(gitignore).
#   둘 다 없으면 [4]단계는 스킵하고 "수동 업로드 필요" 안내만 한다.

set -euo pipefail

EXE="${1:-}"
NOTES="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$EXE" || ! -f "$EXE" ]]; then
  echo "사용법: $0 <ChainRemote_Agent_Setup_vX.Y.Z.exe 경로> [릴리즈노트]" >&2
  exit 1
fi

# ── [1·3단계] NAS 업로드 + agent-push.json 갱신 (대리점 다운로드 + 일괄푸시 소스) ─────────
echo "════ [1·3단계] NAS 업로드 + agent-push.json 갱신 ════"
bash "$SCRIPT_DIR/publish-agent-push-meta.sh" "$EXE" "$NOTES"

# 방금 발행된 버전 추출(파일명에서). 옛 자료실 버전 정리에 쓴다.
VERSION="$(basename "$EXE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

# ── [4단계] 스텝 자료실 업로드 + 옛 Agent 버전 정리 ──────────────────────────────────────
echo ""
echo "════ [4단계] 스텝 자료실(betaposlab.com/staff) 업로드 ════"

# ★★ 가드: 자료실은 "직원이 직접 받아 설치하는" 배포처다. 빈 키(enroll-key="") 베이스 exe 를
#    여기 올리면 그걸로 설치한 신규 거래처가 auto-enroll 안 돼 패널에 영영 안 뜬다
#    (2026-07-09 카페리치 사고 — 빌드 raw 베이스를 자료실에 올려서 발생). 그 재발을 사람의
#    주의력이 아니라 코드로 원천 차단한다: enroll-key 가 실제로 채워진 오버레이만 통과시킨다.
#    (오버레이 포맷: [ ...base ][ UTF-8 custom.txt ][ int32 LE len ][ ASCII "CRENROL1" ])
OVERLAY_CHECK="$(python3 - "$EXE" <<'PY'
import sys, json, struct
try:
    data = open(sys.argv[1], 'rb').read()
    if data[-8:] != b'CRENROL1':
        print("NO_OVERLAY"); sys.exit(0)          # 오버레이 없음 = raw 베이스 = 빈 키
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
  echo "  ✗✗ 자료실 업로드 거부 — 이 exe 는 직접설치용 '완제품'이 아님 (검사=$OVERLAY_CHECK)."
  echo "      빈 키/베이스 exe 로 신규 설치하면 auto-enroll 이 안 돼 패널에 안 뜬다(카페리치 사고)."
  echo "      자료실엔 패널 [에이전트 다운로드] 로 받은 '키 포함' exe 만 올릴 것."
  echo "      (NAS 웹 + agent-push.json 은 위 [1·3]에서 이미 완료 — 자동푸시/오버레이재료는 정상.)"
  STAFF_PW=""   # 아래 로그인/업로드 블록을 건너뛰게 강제
fi

STAFF_PW="${STAFF_PW:-}"
if [[ "$OVERLAY_CHECK" == "OK_KEY" && -z "$STAFF_PW" && -f "$SCRIPT_DIR/.staff-pw" ]]; then
  STAFF_PW="$(tr -d '[:space:]' < "$SCRIPT_DIR/.staff-pw")"
fi

if [[ "$OVERLAY_CHECK" != "OK_KEY" ]]; then
  : # 가드에서 이미 거부 안내함 — 아무것도 안 함
elif [[ -z "$STAFF_PW" ]]; then
  echo "  ⚠ STAFF_PW 없음(환경변수/deploy/nas/.staff-pw 둘 다) → 스텝 자료실 업로드 스킵."
  echo "    수동: 메모리 reference_staff_drive_upload 레시피로 $(basename "$EXE") 업로드 필요."
else
  STAFF="https://betaposlab.com/staff/index.php"
  JAR="$(mktemp)"; RESP="$(mktemp)"
  trap 'rm -f "$JAR" "$RESP"' EXIT
  export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8   # 응답 한글 → zsh/echo 함정 회피

  # 4a) 로그인
  curl -s -c "$JAR" -d "action=login&pw=$STAFF_PW" "$STAFF" -o "$RESP"
  if ! grep -q '"status":"success"' "$RESP"; then
    echo "  ✗ 스텝 자료실 로그인 실패(비번 확인) → 업로드 스킵. NAS/agent-push.json 은 이미 완료됨." >&2
  else
    # 4b) 현재 목록에서 지울 옛 Agent 버전 파악(방금 올릴 버전 제외).
    OLD_AGENTS="$(curl -s -b "$JAR" https://betaposlab.com/staff/ \
      | grep -oE 'ChainRemote_Agent_Setup_v[0-9.]+\.exe' | sort -u \
      | grep -v "v${VERSION}\.exe" || true)"

    # 4c) 업로드(대용량 → max-time 넉넉히).
    echo "  업로드 중: $(basename "$EXE") ..."
    curl -s -b "$JAR" --max-time 300 -F "action=upload" -F "file=@$EXE" "$STAFF" -o "$RESP"
    if ! grep -q '"status":"success"' "$RESP"; then
      echo "  ✗ 업로드 실패 → 옛 버전은 그대로 둠(안전). 응답 status 확인 필요." >&2
    else
      # 4d) 업로드 성공 확인(목록에 새 버전 보이는지) — 확인 후에만 옛 버전 삭제.
      if curl -s -b "$JAR" https://betaposlab.com/staff/ \
           | grep -q "ChainRemote_Agent_Setup_v${VERSION}.exe"; then
        echo "  ✓ 업로드 확인: ChainRemote_Agent_Setup_v${VERSION}.exe"
        # 4e) 옛 Agent 버전 삭제(신규 업로드 성공 확인 후에만 — 순서 어기면 무버전 위험).
        if [[ -n "$OLD_AGENTS" ]]; then
          while IFS= read -r old; do
            [[ -z "$old" ]] && continue
            curl -s -b "$JAR" -F "action=delete" -F "filename=$old" "$STAFF" -o "$RESP" </dev/null
            grep -q '"status":"success"' "$RESP" && echo "    옛 버전 삭제: $old" \
              || echo "    ⚠ 삭제 실패(무해, 수동 정리): $old"
          done <<< "$OLD_AGENTS"
        fi
      else
        echo "  ⚠ 업로드는 success 였으나 목록에서 새 버전 미확인 → 옛 버전 삭제 보류(안전)." >&2
      fi
    fi
  fi
fi

# ── [2단계 안내] — Chang 수동 ───────────────────────────────────────────────────────────
echo ""
echo "════ 남은 1단계 (Chang 수동) ════"
echo "  [2] 관리패널 → 거래처 → [⬆ 전체 일괄 푸시] → [최신 가져오기](자동채움) → [일괄 푸시 시작]"
echo "      → 이 클릭이 곧 [3] 자동 롤링(각 거래처 5분 폴링 사일런트 설치)."
echo "      ※ 살아있는 거래처 전체에 즉시 영향이라 이 마지막 클릭만 사람이 직접 확인."
echo ""
echo "✅ 자동 완료: [1] 대리점 다운로드 소스 + [4] 스텝 자료실. 남은 건 위 [2] 클릭뿐."
