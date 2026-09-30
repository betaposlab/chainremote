// 임시 원격 파일 — 이름이 곧 설정이라, 이름이 틀어지면 조용히 남의 서버로 붙는 파일이 된다.
import { describe, it, expect } from "vitest";
import {
  pickQuickSupportBuild,
  readClientHints,
  shouldAskForHints,
  quickSupportFilename,
  QUICK_SUPPORT_KEY,
  QUICK_SUPPORT_HOST,
} from "@/lib/quick-support";

const UA = {
  win11: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
  win10_32: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/109 Safari/537.36",
  win7_64: "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 Chrome/109 Safari/537.36",
  win7_32: "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 Chrome/109 Safari/537.36",
  ie11: "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  android: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
};

describe("임시 원격 — 어느 판을 줄지", () => {
  const h = (ua: string | null, o: Partial<Omit<ReturnType<typeof readClientHints>, "ua">> = {}) => ({
    ua, platform: null, bitness: null, platformVersion: null, ...o,
  });
  it("힌트가 있으면 힌트로: Win10/11 64비트만 x64", () => {
    expect(pickQuickSupportBuild(h(UA.win11, { platform: '"Windows"', bitness: '"64"', platformVersion: '"15.0.0"' }))).toBe("x64");
    expect(pickQuickSupportBuild(h(UA.win11, { platform: '"Windows"', bitness: '"64"', platformVersion: '"10.0.0"' }))).toBe("x64");
  });
  it("★UA 는 거짓말한다 — Win7 32비트 크롬도 'NT 10.0; Win64' 로 오므로 힌트가 32/0.0.0 이면 x86", () => {
    // 2026-09-30 테스트1 실측: 이 조합에 64비트를 줘서 '호환되지 않습니다'가 떴다.
    expect(pickQuickSupportBuild(h(UA.win11, { platform: '"Windows"', bitness: '"32"', platformVersion: '"0.0.0"' }))).toBe("x86");
    expect(pickQuickSupportBuild(h(UA.win11, { platform: '"Windows"', bitness: '"64"', platformVersion: '"0.0.0"' }))).toBe("x86"); // Win7 64비트
  });
  it("힌트가 없으면 x86 — 어디서나 도는 판이 안전한 기본값", () => {
    expect(pickQuickSupportBuild(h(UA.win11))).toBe("x86");
    expect(pickQuickSupportBuild(h(UA.win10_32))).toBe("x86");
  });
  it("옛 브라우저가 정직하게 말하는 Win7 은 힌트 없이도 x86", () => {
    expect(pickQuickSupportBuild(h(UA.win7_64))).toBe("x86");
    expect(pickQuickSupportBuild(h(UA.ie11))).toBe("x86");
    expect(pickQuickSupportBuild(h(UA.win7_32))).toBe("x86");
  });
  it("Windows 가 아니면 파일을 주지 않는다 (힌트·UA 둘 다)", () => {
    expect(pickQuickSupportBuild(h(UA.mac))).toBeNull();
    expect(pickQuickSupportBuild(h(UA.android, { platform: '"Android"' }))).toBeNull();
    expect(pickQuickSupportBuild(h(null))).toBeNull();
  });
  it("힌트 없는 크롬 계열 요청에는 되묻고, 힌트가 있거나 옛 브라우저면 되묻지 않는다", () => {
    expect(shouldAskForHints(h(UA.win11))).toBe(true);
    expect(shouldAskForHints(h(UA.win11, { platform: '"Windows"', bitness: '"64"', platformVersion: '"15.0.0"' }))).toBe(false);
    expect(shouldAskForHints(h(UA.win7_32))).toBe(false); // 크롬 109 이전 형식 UA 는 그대로 x86
    expect(shouldAskForHints(h(UA.mac))).toBe(false);
  });
});

describe("임시 원격 — 파일 이름", () => {
  const name = quickSupportFilename();
  it("상류 파서가 읽는 모양: host= 가 먼저, 쉼표 구분, .exe 로 끝", () => {
    expect(name).toBe(`rustdesk-host=${QUICK_SUPPORT_HOST},key=${QUICK_SUPPORT_KEY},.exe`);
  });
  it("Windows 파일 이름에 못 쓰는 글자가 없다", () => {
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
  it("상류 파서 규칙으로 되읽으면 같은 host·key 가 나온다 — (1) 이 붙어도", () => {
    const parse = (n: string) => {
      const s = n.replace(/\.exe$/i, "");
      const from = s.slice(s.toLowerCase().indexOf("host="));
      const out: Record<string, string> = {};
      for (const el of from.split(",")) {
        const m = /^(host|key|api|relay)=(.*)$/i.exec(el);
        if (m) out[m[1].toLowerCase()] = m[2];
      }
      return out;
    };
    for (const n of [name, name.replace(/\.exe$/, " (1).exe")]) {
      const r = parse(n);
      expect(r.host).toBe(QUICK_SUPPORT_HOST);
      expect(r.key).toBe(QUICK_SUPPORT_KEY);
    }
  });
});
