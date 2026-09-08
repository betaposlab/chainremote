// android.json 파싱 — 형식이 틀어지면 라우트가 502 로 멈춰야지, 빈 URL 로 302 하면 안 된다.
import { describe, it, expect } from "vitest";
import { parseAndroidLatest } from "@/lib/android-latest";

describe("android.json 파싱", () => {
  const good = {
    version: "1.4.147",
    url: "https://sepani.synology.me/chainremote/ChainRemote_HQ_Android_v1.4.147.apk",
    sha256: "df43",
    size: 32213560,
  };
  it("정상 파일은 네 값을 그대로 돌려준다", () => {
    expect(parseAndroidLatest(good)).toEqual(good);
  });
  it("필수값이 하나라도 비면 null — 빈 URL 로 넘기지 않는다", () => {
    for (const k of ["version", "url", "sha256"] as const) {
      expect(parseAndroidLatest({ ...good, [k]: "" })).toBeNull();
    }
    expect(parseAndroidLatest({ ...good, size: 0 })).toBeNull();
    expect(parseAndroidLatest({ hq: good })).toBeNull(); // latest.json 을 잘못 가리킨 경우
  });
});
