// 한글로 친 아이디를 원래 치려던 알파벳으로 되돌린다.
//
// ★왜 추측이 아닌가: 두벌식 자판은 자모 하나가 키 하나에 1:1 로 대응한다. 한글 상태에서
//   'chang' 을 치면 반드시 '초뭏' 이 되고, 거꾸로 '초뭏' 을 풀면 반드시 'chang' 이 나온다.
//   추론이 아니라 되돌리기다 — 같은 표를 반대로 읽는 것뿐이다.
//
// 두 가지를 다 다뤄야 한다:
//   ① 완성형 음절(가~힣) — 초·중·종성으로 쪼개 각 자모의 키를 잇는다.
//   ② 호환 자모(ㄱ, ㅏ …) — 자음·모음이 홀로 남은 자리. 'jaesung' 처럼 모음으로 시작하면
//      IME 가 음절을 못 만들고 낱자로 남긴다. 이걸 빼먹으면 절반만 풀린다.

/** 자모 → 두벌식 키. 겹자모는 실제로 누른 두 키를 그대로 잇는다(ㅘ = h + k). */
const KEY: Record<string, string> = {
  ㄱ: "r", ㄲ: "R", ㄳ: "rt", ㄴ: "s", ㄵ: "sw", ㄶ: "sg", ㄷ: "e", ㄸ: "E",
  ㄹ: "f", ㄺ: "fr", ㄻ: "fa", ㄼ: "fq", ㄽ: "ft", ㄾ: "fx", ㄿ: "fv", ㅀ: "fg",
  ㅁ: "a", ㅂ: "q", ㅃ: "Q", ㅄ: "qt", ㅅ: "t", ㅆ: "T", ㅇ: "d", ㅈ: "w",
  ㅉ: "W", ㅊ: "c", ㅋ: "z", ㅌ: "x", ㅍ: "v", ㅎ: "g",
  ㅏ: "k", ㅐ: "o", ㅑ: "i", ㅒ: "O", ㅓ: "j", ㅔ: "p", ㅕ: "u", ㅖ: "P",
  ㅗ: "h", ㅘ: "hk", ㅙ: "ho", ㅚ: "hl", ㅛ: "y", ㅜ: "n", ㅝ: "nj", ㅞ: "np",
  ㅟ: "nl", ㅠ: "b", ㅡ: "m", ㅢ: "ml", ㅣ: "l",
};

// 유니코드 완성형 음절의 초·중·종성 순서(고정). 종성 첫 칸은 '받침 없음'이다.
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ".split("");
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ".split("");
const JONG = ["", ...("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ".split(""))];

const SYL_FIRST = 0xac00;
const SYL_LAST = 0xd7a3;

/**
 * 한글이 섞여 있으면 두벌식 기준 알파벳으로 되돌린 문자열, 아니면 **null**.
 *
 * ★null 을 돌려주는 게 중요하다. 부르는 쪽이 "한글일 때만 한 번 더 시도"를 명확히 쓸 수
 * 있어야 한다 — 원래 값으로 먼저 찾고 실패했을 때만 이걸 쓰므로, 한글이 든 진짜 아이디가
 * 있더라도 동작이 달라지지 않는다.
 */
export function qwertyFromHangul(input: string): string | null {
  let found = false;
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= SYL_FIRST && code <= SYL_LAST) {
      const i = code - SYL_FIRST;
      out += KEY[CHO[Math.floor(i / 588)]] ?? "";
      out += KEY[JUNG[Math.floor((i % 588) / 28)]] ?? "";
      const jong = JONG[i % 28];
      if (jong) out += KEY[jong] ?? "";
      found = true;
    } else if (KEY[ch]) {
      out += KEY[ch];
      found = true;
    } else {
      out += ch;
    }
  }
  return found ? out : null;
}
