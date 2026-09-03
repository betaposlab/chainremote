import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { verifyPassword } from "@/lib/password-verify";
import { generatePassword, formatTempPassword } from "@/lib/password-gen";

// 비번 대조는 네 곳(브라우저 로그인·HQ 로그인·좌석 takeover·비번 변경)이 같은 관문을
// 쓴다. 관용 규칙이 넓어지면 공백 든 진짜 비번이 조용히 다른 값이 되므로, 넓어지지
// 않는다는 것까지 여기서 못 박는다.
const hash = (pw: string) => bcrypt.hashSync(pw, 4); // 테스트라 cost 낮춤

describe("verifyPassword", () => {
  it("그대로 친 비번은 통과한다", () => {
    expect(verifyPassword("11112222", hash("11112222"))).toBe(true);
  });

  it("틀린 비번은 막는다", () => {
    expect(verifyPassword("11112223", hash("11112222"))).toBe(false);
  });

  it("안내문대로 띄어 붙여넣어도 통과한다", () => {
    const h = hash("11112222");
    expect(verifyPassword("1111 2222", h)).toBe(true);
    expect(verifyPassword("1111  2222", h)).toBe(true);
    expect(verifyPassword(" 11112222 ", h)).toBe(true);
  });

  it("★공백이 든 진짜 비번은 공백을 턴 값으로 통과되지 않는다", () => {
    // 'my pass' 를 쓰는 사람의 계정이 'mypass' 로도 열리면 안 된다.
    expect(verifyPassword("my pass", hash("mypass"))).toBe(false);
    expect(verifyPassword("my pass", hash("my pass"))).toBe(true);
  });

  it("★숫자가 아닌 값은 공백 관용을 받지 않는다", () => {
    expect(verifyPassword("ab cd", hash("abcd"))).toBe(false);
    expect(verifyPassword("12 3a", hash("123a"))).toBe(false);
  });

  it("★너무 짧은 숫자는 관용하지 않는다", () => {
    expect(verifyPassword("1 2 3", hash("123"))).toBe(false);
  });
});

describe("임시 비번", () => {
  it("숫자 8자리를 만든다", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePassword(8, { digitsOnly: true })).toMatch(/^\d{8}$/);
    }
  });

  it("기본은 종전대로 혼합이다 (거래처 접속 비번이 이걸 쓴다)", () => {
    expect(generatePassword(8)).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it("네 자리씩 띄워 보여 준다", () => {
    expect(formatTempPassword("11112222")).toBe("1111 2222");
    expect(formatTempPassword("1234")).toBe("1234");
  });

  it("만든 값을 띄운 채 붙여넣어도 로그인된다 — 실제 흐름", () => {
    const pw = generatePassword(8, { digitsOnly: true });
    expect(verifyPassword(formatTempPassword(pw), hash(pw))).toBe(true);
  });
});
