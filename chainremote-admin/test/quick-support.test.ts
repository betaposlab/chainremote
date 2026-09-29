// 임시 원격 파일 — 이름이 곧 설정이라, 이름이 틀어지면 조용히 남의 서버로 붙는 파일이 된다.
import { describe, it, expect } from "vitest";
import {
  pickQuickSupportBuild,
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
  it("Win10/11 64비트만 x64", () => {
    expect(pickQuickSupportBuild(UA.win11)).toBe("x64");
  });
  it("Win7 은 64비트여도 x86(Sciter) — 상류 x64 는 Win7 에서 안 뜬다", () => {
    expect(pickQuickSupportBuild(UA.win7_64)).toBe("x86");
    expect(pickQuickSupportBuild(UA.ie11)).toBe("x86");
  });
  it("32비트는 전부 x86", () => {
    expect(pickQuickSupportBuild(UA.win10_32)).toBe("x86");
    expect(pickQuickSupportBuild(UA.win7_32)).toBe("x86");
  });
  it("Windows 가 아니면 파일을 주지 않는다", () => {
    expect(pickQuickSupportBuild(UA.mac)).toBeNull();
    expect(pickQuickSupportBuild(UA.android)).toBeNull();
    expect(pickQuickSupportBuild(null)).toBeNull();
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
