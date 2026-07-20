// 토큰 롤링 재발급 판정(2026-07-20 좀비 로그인 봉인) — 수명 절반(<12h) 기준.
import { describe, it, expect } from "vitest";
import { needsTokenRefresh } from "@/lib/api-auth";

describe("needsTokenRefresh", () => {
  const now = 1_800_000_000;
  it("남은 수명 12h 미만이면 재발급", () => {
    expect(needsTokenRefresh(now + 60 * 60 * 11, now)).toBe(true);
    expect(needsTokenRefresh(now + 60, now)).toBe(true);
    expect(needsTokenRefresh(now - 1, now)).toBe(true); // 이미 만료(경계) — 어차피 verify 가 걸러냄
  });
  it("남은 수명 12h 이상이면 유지", () => {
    expect(needsTokenRefresh(now + 60 * 60 * 13, now)).toBe(false);
    expect(needsTokenRefresh(now + 60 * 60 * 24, now)).toBe(false);
  });
  it("exp 없음(비정상 클레임)이면 재발급 안 함", () => {
    expect(needsTokenRefresh(undefined, now)).toBe(false);
    expect(needsTokenRefresh("nope", now)).toBe(false);
  });
});
