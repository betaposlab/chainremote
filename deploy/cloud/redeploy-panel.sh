#!/bin/bash
# 관리패널 재배포 스크립트는 2026-11-23 패널 비공개 저장소(betaposlab/chainremote-panel)로 옮겼다
# (체인2 결정 D-028 — 체인1·체인2 공용 패널의 집을 비공개 저장소 하나로).
#
# 이 자리에는 이제 패널 소스가 없다. 여기서 배포를 시도하면 옛 소스로 올라가거나 조용히 아무것도
# 바뀌지 않는 지뢰가 되므로(2026-08-14 NAS 판 스크립트 때 겪은 것) 크게 말하고 멈춘다.
echo "✗ 패널 재배포는 패널 저장소에서 합니다:" >&2
echo "    bash ~/내작업/ChainRemotePanel/deploy/redeploy-panel.sh" >&2
echo "  (저장소: https://github.com/betaposlab/chainremote-panel — 비공개)" >&2
exit 1
