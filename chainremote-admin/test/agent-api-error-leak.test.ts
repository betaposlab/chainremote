// 무인증(에이전트 키·토큰) 라우트가 내부 예외 문구를 응답 바디에 싣지 않는지.
//
// 왜 소스를 읽나: 이 결함은 **DB 가 실제로 터져야만** 드러난다. 그 상황을 테스트에서
//   인위로 만들면(NUL 주입·제약 위반) drizzle 버전이 바뀔 때마다 테스트가 먼저 깨져
//   정작 지키려던 계약이 아니라 재현 수단을 유지보수하게 된다. 계약 자체가 "이 문자열을
//   응답에 쓰지 않는다" 라 소스가 진실 원천이다. proxy.ts matcher 테스트와 같은 방식.
//
// 배경(2026-09-02): 2026-08-16 감사가 jsonError 로 "기본은 안 보낸다"를 세웠는데
//   enroll·heartbeat·pending-update 네 곳이 `String(e)` 로 남아 있었다. drizzle 예외에는
//   쿼리 전문과 바인딩 파라미터가 들어 있고, enroll-key 는 모든 에이전트 설치본에 평문으로
//   실려 나가므로 거래처 PC 한 대만 있으면 닿는다.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const API_DIR = path.join(__dirname, "..", "app", "api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

describe("API 라우트가 예외 문구를 응답 바디에 싣지 않는다 (CWE-209)", () => {
  const files = routeFiles(API_DIR);

  it("탐침 — 라우트 파일을 실제로 찾았다", () => {
    // 0건이면 위 검사가 통과가 아니라 '측정 안 됨'이다.
    expect(files.length).toBeGreaterThan(10);
  });

  it("어느 라우트도 error 필드에 String(e)/e.message 를 담지 않는다", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // 주석은 제외 — 왜 이러면 안 되는지 설명하는 주석이 실제로 있다.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      if (/error:\s*(String\(\s*e|e\.message|`\$\{\s*e)/.test(code)) {
        bad.push(path.relative(API_DIR, f));
      }
    }
    expect(bad).toEqual([]);
  });

  it("에이전트 4개 라우트는 예외를 서버 로그로만 남긴다", () => {
    const agentRoutes = [
      "customers/enroll/route.ts",
      "customers/heartbeat/route.ts",
      "customers/pending-update/route.ts",
      "customers/register-heartbeat-token/route.ts",
    ];
    for (const r of agentRoutes) {
      const src = readFileSync(path.join(API_DIR, r), "utf8");
      expect(src, `${r} 에 catch 가 있어야 한다`).toMatch(/catch\s*\(/);
      expect(src, `${r} 는 예외를 console.error 로 남겨야 한다`).toMatch(
        /console\.error/,
      );
    }
  });
});
