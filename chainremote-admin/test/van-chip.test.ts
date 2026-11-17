// VAN 칩 '복구 실패' 안내 — 에이전트 버전에 따라 무엇을 하면 풀리는지가 다르다(2026-11-17).
//   1.4.168~ 는 손을 뗀 뒤에도 영업 중(포스앱)이면 10분마다 다시 띄우므로 리더기만 켜면 산다.
//   그보다 낮으면 세 번 뒤 아주 손을 놓으므로 사람이 KSCAT [서비스 시작]을 눌러야 한다.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { VanChip } from "@/app/customers/_van-chip";
import { VAN_SLOW_RETRY_SINCE } from "@/lib/van-constants";
import { isVersionNewer } from "@/lib/data/pending-updates";

function gaveUpChip(slowRetry: boolean): string {
  return renderToStaticMarkup(
    createElement(VanChip, {
      kind: "ksnet",
      ok: false,
      gaveUp: true,
      missing: false,
      restartCount: 7,
      lastRestartAt: "2026-11-17T04:17:52.000Z",
      recoveredCount: 2,
      unrecoveredCount: 5,
      slowRetry,
    }),
  );
}

// 목록 화면(page.tsx)이 칩에 넘기는 판정과 같은 식.
const slowRetryFor = (v: string | null) => !!v && !isVersionNewer(VAN_SLOW_RETRY_SINCE, v);

describe("VAN 칩 — 복구 실패 안내", () => {
  it("168 이상: 영업 중 10분 재시도로 리더기를 켜면 저절로 산다고 안내", () => {
    const html = gaveUpChip(true);
    expect(html).toContain("KSNET 복구 실패");
    expect(html).toContain("10분마다 다시 띄우므로 리더기를 켜면 저절로 살아납니다");
    expect(html).not.toContain("서비스 시작");
    // 옛 문구("재실행으로 안 낫습니다")는 168 에선 틀린 말이다.
    expect(html).not.toContain("재실행으로 안 낫습니다");
  });

  it("168 미만: 다시 시도하지 않으니 [서비스 시작]을 누르라고 안내", () => {
    const html = gaveUpChip(false);
    expect(html).toContain("다시 시도하지 않습니다");
    expect(html).toContain("[서비스 시작]");
    expect(html).not.toContain("10분마다");
  });

  it("버전 판정 — 168 부터 참, 보고 없으면 거짓", () => {
    expect(slowRetryFor("1.4.164")).toBe(false);
    expect(slowRetryFor("1.4.167")).toBe(false);
    expect(slowRetryFor("1.4.168")).toBe(true);
    expect(slowRetryFor("1.4.170")).toBe(true);
    expect(slowRetryFor("1.5.01")).toBe(true);
    expect(slowRetryFor(null)).toBe(false);
  });

  it("slowRetry 를 안 넘기면(기본) 옛 에이전트 안내 — 모르면 사람이 손대는 쪽으로", () => {
    const html = renderToStaticMarkup(
      createElement(VanChip, {
        kind: "ksnet",
        ok: false,
        gaveUp: true,
        missing: false,
        restartCount: 0,
        lastRestartAt: null,
        recoveredCount: 0,
        unrecoveredCount: 0,
      }),
    );
    expect(html).toContain("[서비스 시작]");
  });
});
