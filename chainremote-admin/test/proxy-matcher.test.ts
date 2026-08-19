// proxy.ts matcher 회귀 가드 — 어떤 경로가 인증 게이트를 지나고 어떤 경로가 비껴가는지.
//
// ★계기(2026-08-20): /auth/ticket 이 게이트에 걸려 있었다. 본사 앱 [관리 패널] SSO 가 여는
//   주소인데, 세션이 없으면 티켓을 소비하기도 전에 /login 으로 튕겨 60초짜리 티켓이 그대로
//   죽었다. **이미 로그인된 브라우저는 그냥 통과해서 되는 것처럼 보인다** — 정작 SSO 가
//   필요한 상황에서만 조용히 실패하는 종류라 눈으로는 못 잡는다. 그래서 테스트로 못박는다.
//
// proxy.ts 를 import 하지 않고 **소스에서 리터럴을 읽는** 이유: matcher 는 빌드타임에
//   정적으로 분석되는 값이라 상수로 빼면 Next 가 무시한다("matcher values need to be
//   constants ... Dynamic values such as variables will be ignored" — Next proxy 문서).
//   import 하면 NextAuth 의 Edge 런타임까지 딸려와 읽히지도 않는다. 텍스트로 읽는 편이
//   Next 가 실제로 보는 것과 같다.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function matcherPatterns(): string[] {
  const src = readFileSync(join(process.cwd(), "proxy.ts"), "utf8");
  const block = src.match(/matcher:\s*\[([\s\S]*?)\]/);
  if (!block) {
    throw new Error("proxy.ts 에서 matcher 배열을 못 찾았다 — 형태가 바뀌었으면 이 테스트부터 고칠 것");
  }
  return [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    // TS 소스의 문자열 리터럴이라 이스케이프가 한 겹 더 있다: 소스의 \\. → 실제 값은 \.
    m[1].replace(/\\\\/g, "\\"),
  );
}

const gated = (path: string) =>
  matcherPatterns().some((p) => new RegExp(`^${p}$`).test(path));

describe("proxy matcher — 인증 게이트가 덮는 경로", () => {
  it("패턴을 실제로 읽어 왔다", () => {
    expect(matcherPatterns().length).toBeGreaterThan(0);
  });

  it("패널 화면은 게이트를 지난다", () => {
    for (const p of ["/", "/customers", "/users", "/support", "/help/panel"]) {
      expect(gated(p), `${p} 는 보호돼야 한다`).toBe(true);
    }
  });

  it("세션 없이 닿아야 하는 곳은 비껴간다", () => {
    for (const p of [
      "/login",
      "/auth/ticket", // ★본사 앱 SSO — 세션이 없는 게 정상이고, 여기서 세션을 만든다
      "/auth/ticket/confirm", // 계정 전환 확인 — 같은 티켓 흐름의 두 번째 걸음
      "/api/auth/panel-ticket", // 티켓 발급(본사 앱이 Bearer 로 호출)
      "/api/customers", // requireApiAuth 가 자체 보호
      "/chainremote-logo.png", // 로그인 화면이 쓰는 워드마크
      "/favicon.ico",
      "/_next/static/chunk.js",
    ]) {
      expect(gated(p), `${p} 는 게이트를 비껴가야 한다`).toBe(false);
    }
  });
});
