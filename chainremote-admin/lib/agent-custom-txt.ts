// 거래처 에이전트 설치본에 박히는 custom.txt 를 만든다.
//
// 라우트 안에 인라인으로 두지 않고 순수 함수로 뺀 이유는 하나다: 여기 있는 approve-mode 가
// 우리 제품의 약속이기 때문이다. click 이면 가맹점 사장이 매 세션 직접 수락해야 원격이
// 시작된다. 이 값이 조용히 both 로 뒤집히면 화면상 달라지는 게 없어서(수락창이 안 뜨는 것을
// "빨라졌네" 로 읽는다) 한참 모른다. 그래서 함수로 두고 테스트로 잠근다.
//
// 인스톨러(extract-enroll-overlay.ps1)는 이 JSON 을 통째로 custom.txt 로 쓰고,
// tenant-slug 와 enroll-key 두 글자가 없으면 오버레이를 버리고 번들 기본값을 쓴다 —
// 그래서 그 두 키는 어떤 경우에도 빠지면 안 된다.

export interface AgentCustomTxtInput {
  tenantSlug: string;
  enrollKey: string;
  /** 마이그 030. 켠 대리점만 무클릭. 가맹점에 설치하는 대리점은 늘 false. */
  unattendedAgent?: boolean;
}

export function buildAgentCustomTxt(input: AgentCustomTxtInput): string {
  return JSON.stringify({
    "conn-type": "incoming",
    "tenant-slug": input.tenantSlug,
    "enroll-key": input.enrollKey,
    "default-settings": { "allow-remote-config-modification": "Y" },
    // override-settings 라 설치 후 UI 에서 못 바꾼다 — 설치본이 곧 정책이 된다.
    //   both 는 영구비번이 설정돼 있을 때만 무클릭이고, 없거나 틀리면 수락창으로
    //   폴백한다(src/server/connection.rs) — 실수로 켜도 열린 문이 되지는 않는다.
    "override-settings": {
      "approve-mode": input.unattendedAgent ? "both" : "click",
    },
  });
}
