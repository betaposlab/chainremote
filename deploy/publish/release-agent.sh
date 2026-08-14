#!/usr/bin/env bash
# 거래처 에이전트 새 버전 배포 — 3단계 룰 오케스트레이터.
#
# ★빌드는 안 한다. 빌드는 윈컴에서 별도(수동 빌드 워크플로 유지 — 메모리 feedback_no_
#   autobuild_workflow). 이 스크립트는 "이미 빌드된 setup.exe" 를 받아 배포 채널에만 반영한다.
#
# 3단계 룰(에이전트 버전업 시 반드시 전부):
#   1. 각 대리점 [에이전트 다운로드]  → agent-push.json 참조(자동). ↓아래 [1·3]이 갱신.
#   2. 관리패널 [전체 일괄 푸시]        → ★Chang 이 패널서 직접 클릭. 살아있는 거래처 플릿
#                                         전체에 즉시 영향(대량조작)이라 사람 게이트로 남김.
#                                         이 스크립트는 안내만 한다(자동 실행 안 함).
#   3. 자동 롤링                        → 2번의 일괄푸시가 곧 이것(pending_updates 5분 폴링).
#
# ★2026-08-14 이전엔 [4] 스텝 자료실(betaposlab.com/staff)이 있었다. 폐지했다 — 관리 패널이
#   Agent·HQ·ChainGo 를 다 주므로 완전히 중복이었고, 직원이 받는 경로가 둘이면 한쪽이 낡는다.
#   같이 사라진 것: 빈 키 exe 를 자료실에 못 올리게 막던 카페리치 가드(2026-07-09)와
#   그 우회로였던 publish-staff-overlay.sh. 지킬 대상이 없어졌다 — 지금 사람이 받는 유일한
#   경로인 패널은 다운로드 시점에 서버가 오버레이를 얹으므로 빈 키가 나갈 길 자체가 없다.
#
# 즉: 이 스크립트 = [1·3 소스 갱신] 자동, [2]만 사람 클릭.
#     실행 후 Chang 이 패널서 일괄푸시 클릭 한 번으로 3단계 완성.
#
# 사용: ./deploy/publish/release-agent.sh <ChainRemote_Agent_Setup_vX.Y.Z.exe> ["릴리즈노트"]

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

# ── [2단계 안내] — Chang 수동 ───────────────────────────────────────────────────────────
echo ""
echo "════ 남은 1단계 (Chang 수동) ════"
echo "  [2] 관리패널 → 거래처 → [⬆ 전체 일괄 푸시] → [최신 가져오기](자동채움) → [일괄 푸시 시작]"
echo "      → 이 클릭이 곧 [3] 자동 롤링(각 거래처 5분 폴링 사일런트 설치)."
echo "      ※ 살아있는 거래처 전체에 즉시 영향이라 이 마지막 클릭만 사람이 직접 확인."
echo ""
echo "✅ 자동 완료: [1] 대리점 다운로드 소스. 남은 건 위 [2] 클릭뿐."
