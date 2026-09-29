// 첫 설치 전 임시 원격 — 서명된 상류 RustDesk 공식 exe 를 **파일 이름만 바꿔** 내려준다.
//
// 왜 남의 파일인가 (2026-09-29, 기와집 헛걸음):
//   신규 거래처에 전화로 에이전트 설치를 안내하면 여섯 단계가 나온다. 그중 둘(브라우저의
//   "안전하지 않은 파일" + Windows 의 "PC 보호")은 우리 exe 에 코드 서명이 없어서 생기는데,
//   서명은 세금 이력 있는 법인이라야 받는다. 상류 공식 exe 는 이미 서명돼 있고(PURSLANE)
//   수백만 번 받아져 평판이 쌓여 있다. 그리고 RustDesk 는 자체 서버 사용자를 위해
//   **파일 이름에서 서버 주소를 읽는다**(src/custom_server.rs: `host=…,key=…`).
//   파일 이름은 서명도 해시도 바꾸지 않는다 — 한 바이트도 안 고치고 우리 서버에 붙는다.
//
//   거래처가 이걸 실행하면 본사가 HQ 로 붙어(수락 클릭) 우리 에이전트를 직접 설치하고,
//   임시 창은 닫는다. 남는 건 우리 에이전트뿐이다.
//
// ★버전을 올리지 말 것. 평판은 **파일 해시**에 쌓인다 — 새 릴리즈로 바꾸면 그 파일은
//   평판 0 에서 다시 시작한다. 바꿔야 한다면 나온 지 몇 달 된(=이미 많이 받아진) 것으로.
// ★대리점 식별자는 싣지 않는다. 여기 들어가는 건 서버 주소와 hbbs **공개**키뿐이라
//   로그인 없이 누구에게 줘도 된다(에이전트 설치본과 다른 점).

export const QUICK_SUPPORT_HOST = "rs.626.kr";
// hbbs 공개키(id_ed25519.pub). 파일 이름에 못 쓰는 글자(/ \ : * ? " < > |)가 없어야 한다.
export const QUICK_SUPPORT_KEY = "C2bqeqG0Nb0EQgmtomhzcykw69gRvbSLKfm019r1C8Y=";

export type QuickSupportBuild = {
  /** NAS 에 올려 둔 원본 이름(상류 릴리즈 파일명 그대로). */
  source: string;
  sha256: string;
  size: number;
};

export const QUICK_SUPPORT_BUILDS: Record<"x64" | "x86", QuickSupportBuild> = {
  // Win10/11 64비트. (상류 x64 는 Win7 에서 안 뜬다 — 우리 x64 페이로드와 같은 이유.)
  x64: {
    source: "rustdesk-1.4.6-x86_64.exe",
    sha256: "422ce31131e6537ea4f611ebf4a4d1804f28a6f58c83aa05065071c5958f1551",
    size: 24252504,
  },
  // Win7·8·Embedded 와 모든 32비트. Sciter 판이라 구형에서도 뜬다.
  x86: {
    source: "rustdesk-1.4.6-x86-sciter.exe",
    sha256: "1d009aef333dc9995bd4c1a58341fecfe4399352f5ce3fdfa6c545f1c155e93b",
    size: 11765336,
  },
};

export const QUICK_SUPPORT_SOURCES = [
  "https://sepani.synology.me/chainremote/qs",
  "http://192.168.68.103/chainremote/qs",
];

/** 내려받을 때의 파일 이름 — 이 이름이 곧 설정이다. 끝의 쉼표는 Windows 가 중복 시 붙이는
 *  " (1)" 이 키 값에 섞이지 않게 하는 구분자다(상류 파서가 그렇게 쓰라고 한 방식). */
export function quickSupportFilename(): string {
  return `rustdesk-host=${QUICK_SUPPORT_HOST},key=${QUICK_SUPPORT_KEY},.exe`;
}

/** User-Agent 로 어느 판을 줄지 고른다. Windows 가 아니면 null. */
export function pickQuickSupportBuild(ua: string | null): "x64" | "x86" | null {
  const s = ua ?? "";
  if (!/Windows/i.test(s)) return null;
  const is64 = /Win64|x64|WOW64|amd64/i.test(s);
  const isWin10Plus = /Windows NT 1\d/i.test(s);
  return is64 && isWin10Plus ? "x64" : "x86";
}
