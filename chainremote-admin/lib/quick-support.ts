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

// ── 토큰이 실린 파일 이름 (2026-10-01) ────────────────────────────────────────────────
// 상류 파서(src/custom_server.rs)는 파일 이름에서 설정을 두 형식으로 읽는다.
//   ① `host=…,key=…`           — 위의 것. Windows 파일명엔 `:` `/` 를 못 써 주소(api)를 못 싣는다.
//   ② `rustdesk-licensed-<X>`   — X = JSON 을 base64url 한 뒤 **뒤집은** 문자열. 서명 없는
//                                  평문 JSON 도 그대로 받는다. 여기엔 https 주소가 들어간다.
// RustDesk 는 api 주소가 있으면 켜지자마자 `{api}/api/sysinfo`, 15초마다 `{api}/api/heartbeat`
// 로 **자기 ID** 를 보낸다(src/hbbs_http/sync.rs). 주소에 이 클릭만의 토큰을 넣어 두면
// "어느 클릭 = 어느 ID" 가 추측 없이 맞는다. 받는 쪽은 app/api/qs/[token]/api/[kind].
//
// ★주소를 짧게 유지할 것. 파일 이름이 길면 `C:\Users\…\Downloads\` 와 합쳐 Windows 의
//   260자 한계를 넘고, 브라우저가 이름을 **잘라** 저장한다 — 잘린 이름은 설정이 아니다.
export const QUICK_SUPPORT_REPORT_BASE = "https://626.kr/api/qs";

/** 토큰 형식 — 소문자·숫자 12자. 라우트가 이 모양만 받는다. */
export const QUICK_SUPPORT_TOKEN_RE = /^[a-z0-9]{12}$/;

/**
 * 토큰을 실은 파일 이름. 이 토큰으로는 안전한 이름이 안 나오면 null — 토큰을 새로 뽑아 다시 부른다.
 *
 * 안전하지 않은 경우: 상류 파서가 `-licensed-` 를 `--` 로 바꾼 뒤 `--` 로 쪼갠다. base64url 엔
 * `-` 가 나올 수 있어, X 가 `-` 로 시작하거나 `--` 를 품으면 엉뚱한 자리에서 잘린다.
 */
export function quickSupportFilenameWithToken(token: string): string | null {
  if (!QUICK_SUPPORT_TOKEN_RE.test(token)) return null;
  const json = JSON.stringify({
    host: QUICK_SUPPORT_HOST,
    key: QUICK_SUPPORT_KEY,
    api: `${QUICK_SUPPORT_REPORT_BASE}/${token}`,
  });
  const x = Buffer.from(json, "utf8").toString("base64url").split("").reverse().join("");
  if (x.startsWith("-") || x.endsWith("-") || x.includes("--")) return null;
  return `rustdesk-licensed-${x}.exe`;
}

/** 대리점 번호 형식 — 숫자 3~4자. 고객이 숫자판으로 누른다. */
export const QUICK_CODE_RE = /^[0-9]{3,4}$/;

/** 브라우저가 보내는 힌트. 요청 헤더에서 뽑아 넘긴다. */
export type ClientHints = {
  ua: string | null;
  /** Sec-CH-UA-Platform — "Windows" 등(따옴표 포함으로 옴). 기본으로 늘 보내는 값. */
  platform: string | null;
  /** Sec-CH-UA-Bitness — "64"/"32". Accept-CH 로 요청해야 온다. */
  bitness: string | null;
  /** Sec-CH-UA-Platform-Version — Windows 는 "0.0.0"(7·8·8.1) / "1.0.0"~"12.0.0"(10) / "13.0.0"+(11). */
  platformVersion: string | null;
};

const CH_ACCEPT = "Sec-CH-UA-Platform, Sec-CH-UA-Bitness, Sec-CH-UA-Platform-Version";
/** 응답에 실어 두면 브라우저가 다음 요청부터(Critical 이면 이번 요청을 다시) 힌트를 보낸다. */
export const CLIENT_HINT_HEADERS = { "Accept-CH": CH_ACCEPT, "Critical-CH": CH_ACCEPT, Vary: "Sec-CH-UA-Bitness, Sec-CH-UA-Platform-Version" };

const unq = (v: string | null) => (v ?? "").replace(/"/g, "").trim();

/** 어느 판을 줄지 고른다. Windows 가 아니면 null.
 *
 *  ★User-Agent 만 보면 틀린다(2026-09-30 테스트1 실측). 크롬은 101부터 UA 의 OS 부분을 모든
 *  Windows 에서 "Windows NT 10.0; Win64; x64" 로 **고정**해 보낸다. Win7 32비트 크롬 109 가 그렇게
 *  보내서 64비트 파일을 받았고 "이 파일의 버전이 실행 중인 Windows 와 호환되지 않습니다"가 떴다.
 *  진짜 값은 Client Hints(비트수·플랫폼 버전)에만 있고, 그건 서버가 Accept-CH 로 청해야 온다.
 *  힌트가 없으면 32비트 Sciter 판 — 그건 Win7~11, 32/64비트 어디서나 돈다(안전한 기본값). */
export function pickQuickSupportBuild(h: ClientHints): "x64" | "x86" | null {
  const ua = h.ua ?? "";
  const platform = unq(h.platform);
  if (platform ? platform !== "Windows" : !/Windows/i.test(ua)) return null;
  // 옛 브라우저(UA 축소 이전)가 정직하게 말하는 Win7/8 은 힌트 없이도 안다.
  if (/Windows NT (5|6)\./i.test(ua)) return "x86";
  const bitness = unq(h.bitness);
  const major = parseInt(unq(h.platformVersion).split(".")[0] ?? "", 10);
  if (bitness === "64" && Number.isFinite(major) && major >= 1) return "x64";
  return "x86";
}

/** 크롬 계열인데 아직 힌트가 안 실린 요청 — Critical-CH 로 되물으면 브라우저가 힌트를 붙여 다시 온다. */
export function shouldAskForHints(h: ClientHints): boolean {
  const ua = h.ua ?? "";
  const chromium = /Chrome\//.test(ua) || !!h.platform;
  return chromium && !h.bitness && !/Windows NT (5|6)\./i.test(ua);
}

export function readClientHints(headers: Headers): ClientHints {
  return {
    ua: headers.get("user-agent"),
    platform: headers.get("sec-ch-ua-platform"),
    bitness: headers.get("sec-ch-ua-bitness"),
    platformVersion: headers.get("sec-ch-ua-platform-version"),
  };
}
