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
    // ★무인접속의 실제 스위치는 이 최상위 키다. approve-mode 가 아니다.
    //   에이전트는 conn-type=incoming 이면 코드에서 무조건 클릭 수락으로 강제하고
    //   (password_security.rs::approve_mode), 그 강제를 푸는 건 오직 이 키 하나다.
    //   conn-type 과 같은 HARD_SETTINGS 급이라 옵션 누락으로 조용히 생기지 않는다.
    //   켠 대리점에만 넣는다 — 안 켠 곳의 설치본엔 키 자체가 없어야 한다.
    ...(input.unattendedAgent ? { unattended: "Y" } : {}),
    "default-settings": { "allow-remote-config-modification": "Y" },
    // override-settings 라 설치 후 UI 에서 못 바꾼다 — 설치본이 곧 정책이 된다.
    //   both 는 영구비번이 설정돼 있을 때만 무클릭이고, 없거나 틀리면 수락창으로
    //   폴백한다(src/server/connection.rs) — 실수로 켜도 열린 문이 되지는 않는다.
    // approve-mode 는 두 경우 모두 명시해 둔다. 무인접속 빌드에서 위 최상위 키가
    // 어떤 이유로든 안 읽히면 여기 both 가 남아도 코드가 Click 으로 강제한다 —
    // 즉 이 값 단독으로는 절대 문이 열리지 않는다(이중 방어).
    "override-settings": {
      "approve-mode": input.unattendedAgent ? "both" : "click",
    },
  });
}
