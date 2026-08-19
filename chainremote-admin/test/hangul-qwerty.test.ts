// 한글로 친 아이디 되돌리기. 표를 반대로 읽는 것뿐이라 값이 정확히 하나로 정해진다.

import { describe, it, expect } from "vitest";
import { qwertyFromHangul } from "@/lib/hangul-qwerty";

describe("qwertyFromHangul", () => {
  it("실제 우리 아이디들을 되돌린다", () => {
    // ★'초뭏' 은 Chang 이 실제로 겪은 값이다(2026-08-20 스샷).
    expect(qwertyFromHangul("초뭏")).toBe("chang");
    // 모음으로 시작하면 IME 가 음절을 못 만들어 낱자로 남는다 — 이 갈래를 빼먹으면 절반만 풀린다.
    expect(qwertyFromHangul("ㅓㅁㄷ녀ㅜㅎ")).toBe("jaesung");
    expect(qwertyFromHangul("새ㅔㅑㅜㅅ")).toBe("topint");
  });

  it("겹받침·겹모음도 누른 키 그대로 편다", () => {
    expect(qwertyFromHangul("맑")).toBe("akfr"); // ㅁㅏㄺ = a k f r
    expect(qwertyFromHangul("과")).toBe("rhk"); // ㄱㅘ = r h k
    expect(qwertyFromHangul("의")).toBe("dml"); // ㅇㅢ = d m l
  });

  it("한글이 없으면 null — 부르는 쪽이 '한글일 때만' 을 분명히 쓸 수 있어야 한다", () => {
    expect(qwertyFromHangul("chang")).toBeNull();
    expect(qwertyFromHangul("")).toBeNull();
    expect(qwertyFromHangul("c-win")).toBeNull();
    expect(qwertyFromHangul("chang@x.test")).toBeNull();
  });

  it("한글 아닌 글자는 그대로 둔다 — 섞여 있어도 자리를 안 흐트러뜨린다", () => {
    expect(qwertyFromHangul("초-뭏")).toBe("ch-ang");
    expect(qwertyFromHangul("초뭏1")).toBe("chang1");
  });

  it("되돌린 값이 다시 한글로 읽히지 않는다(무한 왕복 방지)", () => {
    const once = qwertyFromHangul("초뭏");
    expect(once).not.toBeNull();
    expect(qwertyFromHangul(once!)).toBeNull();
  });
});
