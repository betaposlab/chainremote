import { describe, it, expect } from "vitest";
import { filterCustomers, toChosung } from "@/lib/customer-search";

// 거래처 고르기 검색 — 가맹점 2,000곳에서 눈으로 찾는 건 불가능하다(2026-08-15 Chang).
//   상호 부분일치 · 원격 ID · 초성. 초성 규칙은 조용히 틀리기 쉬워 여기서 못박는다.

const LIST = [
  { id: "1", name: "낭성 관리포스", remoteId: "451570376" },
  { id: "2", name: "낭성 판매포스", remoteId: "201345357" },
  { id: "3", name: "토니피자", remoteId: "211191101" },
  { id: "4", name: "5.5춘천닭갈비 복수점", remoteId: "AB12345678" },
  { id: "5", name: "okpos 테스트", remoteId: null },
];

describe("toChosung", () => {
  it("한글만 초성으로 바꾸고 나머지는 그대로", () => {
    expect(toChosung("낭성 관리포스")).toBe("ㄴㅅ ㄱㄹㅍㅅ");
    expect(toChosung("5.5춘천닭갈비")).toBe("5.5ㅊㅊㄷㄱㅂ");
    expect(toChosung("okpos")).toBe("okpos");
  });
});

describe("filterCustomers", () => {
  it("빈 질의는 전부", () => {
    expect(filterCustomers(LIST, "  ")).toHaveLength(5);
  });

  it("상호 부분일치 — 가운데 글자도 걸린다", () => {
    expect(filterCustomers(LIST, "낭성").map((c) => c.id)).toEqual(["1", "2"]);
    expect(filterCustomers(LIST, "판매").map((c) => c.id)).toEqual(["2"]);
  });

  it("영문은 대소문자를 가리지 않는다", () => {
    expect(filterCustomers(LIST, "OKPOS").map((c) => c.id)).toEqual(["5"]);
  });

  it("원격 ID 로도 찾는다 — 사람이 끼워 넣은 공백·하이픈은 무시", () => {
    expect(filterCustomers(LIST, "2111").map((c) => c.id)).toEqual(["3"]);
    expect(filterCustomers(LIST, "AB 1234 5678").map((c) => c.id)).toEqual(["4"]);
    expect(filterCustomers(LIST, "451-570").map((c) => c.id)).toEqual(["1"]);
  });

  it("초성 검색 — 'ㄴㅅ' 이 낭성 둘을 잡는다", () => {
    expect(filterCustomers(LIST, "ㄴㅅ").map((c) => c.id)).toEqual(["1", "2"]);
    expect(filterCustomers(LIST, "ㅌㄴㅍㅈ").map((c) => c.id)).toEqual(["3"]);
    expect(filterCustomers(LIST, "ㄴㅅ ㅍㅁ").map((c) => c.id)).toEqual(["2"]);
  });

  it("초성이 아닌 글자가 섞이면 일반 검색으로 — 'ㄴ성' 은 초성 취급 안 함", () => {
    expect(filterCustomers(LIST, "ㄴ성")).toHaveLength(0);
  });

  it("없는 것은 빈 배열", () => {
    expect(filterCustomers(LIST, "없는가게")).toHaveLength(0);
  });
});
