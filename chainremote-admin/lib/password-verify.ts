import bcrypt from "bcryptjs";

/**
 * 비밀번호 검사 — 저장된 bcrypt 해시와 대조한다.
 *
 * 비번을 대조하는 자리가 네 곳이다(브라우저 로그인 · HQ 로그인 · 좌석 takeover ·
 * 비번 변경 시 현재 비번 확인). 규칙이 흩어지면 한 곳을 빠뜨리는 날이 온다 —
 * 그래서 관문을 하나로 둔다.
 *
 * ★띄어쓰기 관용: 임시 비번은 `1111 2222` 처럼 네 자리씩 띄어 안내한다(전화로
 *   불러 주기 쉬우라고). 안내문을 그대로 복사해 붙이면 공백이 딸려 들어오는데,
 *   그걸로 로그인이 막히면 안내 방식 자체가 함정이 된다.
 *
 *   그렇다고 모든 입력에서 공백을 털면 안 된다 — 공백이 들어간 진짜 비밀번호를
 *   쓰는 사람의 비번이 조용히 다른 값이 되어 버린다. 그래서 **먼저 입력 그대로
 *   맞춰 보고**, 실패했을 때만 다음 셋을 모두 만족하는 경우에 한해 한 번 더 본다:
 *     ① 공백을 털어서 값이 실제로 달라졌다
 *     ② 턴 결과가 숫자만 남는다  ③ 4자 이상
 *   임시 비번(숫자 8자리) 말고는 이 갈래에 걸릴 값이 사실상 없다.
 */
export function verifyPassword(input: string, passwordHash: string): boolean {
  if (bcrypt.compareSync(input, passwordHash)) return true;

  const compact = input.replace(/\s+/g, "");
  if (compact === input) return false;
  if (!/^\d{4,}$/.test(compact)) return false;
  return bcrypt.compareSync(compact, passwordHash);
}
