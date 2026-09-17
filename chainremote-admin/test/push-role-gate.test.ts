// 설치파일 푸시는 플랫폼 운영자만 (2026-09-18).
//
// 탑아이엔티(대리점) 계정으로 로그인하니 [전체 일괄 푸시]가 보였다. 대리점이 임의 URL 의 exe 를
// 자기 거래처 전체에 설치시킬 수 있는 창이었고, 우리 NAS 주소까지 그대로 나왔다. 화면에서
// 숨기는 것만으론 부족하다 — 서버 액션이 같은 판정으로 막아야 한다. 여기서는 그 판정 함수를
// 잠근다(액션은 쿠키 세션에 묶여 단위 테스트가 어렵다).

import { describe, it, expect } from "vitest";
import { isPlatformOperator, canWrite } from "@/lib/roles";

describe("푸시 권한 — 플랫폼 운영자만", () => {
  it("super_admin 만 참", () => {
    expect(isPlatformOperator("super_admin")).toBe(true);
  });
  it("대리점 역할은 owner 포함 전부 거짓 — 원격 권한(canWrite)과는 별개", () => {
    for (const r of ["owner", "admin", "operator", "viewer", undefined, ""]) {
      expect(isPlatformOperator(r)).toBe(false);
    }
    expect(canWrite("owner")).toBe(true); // 원격은 되지만 푸시는 안 된다
  });
});
