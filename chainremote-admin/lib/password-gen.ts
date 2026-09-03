// 혼동 문자(O/0, l/1, I)는 두 벌 모두에서 뺐다 — 구두로 불러 줄 수 있어야 한다.
const ALPHA_MIXED = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
// 숫자만. 임시 비번은 전화로 불러 주고 손으로 받아 적는 값이라, 글자 종류가 하나여야
//   가장 빠르다(2026-09-04 Chang). 털릴 걱정이 없는 자리다 — 첫 로그인 뒤 바로 바뀌고,
//   쓰는 사람이 대리점 owner 몇 명뿐이며, 리셋 자체가 1년에 한 번 있을까 말까다.
const ALPHA_DIGIT = "0123456789";

/**
 * 비밀번호 자동 생성. 보안 RNG 사용.
 *
 * 기본(혼합)은 길이 8 ≈ 6.4e11 조합. `digitsOnly` 는 8자리 1억 조합으로 줄지만
 * 전화 전달이 압도적으로 쉽다 — 첫 로그인 뒤 바로 바꾸는 임시 비번에 맞는 맞바꿈이다.
 */
export function generatePassword(
  length = 8,
  opts?: { digitsOnly?: boolean },
): string {
  const alphabet = opts?.digitsOnly ? ALPHA_DIGIT : ALPHA_MIXED;
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[buf[i] % alphabet.length];
  }
  return out;
}

/**
 * 거래처에 보낼 카톡/문자 안내 문구.
 */
export function makeAnnouncementText(opts: {
  customerName: string;
  password: string;
}): string {
  return `[ChainRemote 원격지원]

${opts.customerName} 사장님, 안녕하세요.
원격지원을 위해 아래 절차로 비밀번호를 한 번만 등록해주세요.

1. 바탕화면의 ChainRemote 실행
2. 우측 상단 톱니바퀴 → 보안
3. "영구 비밀번호 설정" 클릭
4. 비밀번호 입력: ${opts.password}
5. 확인

이후엔 PC 가 켜져 있기만 하면 본사에서 바로 원격지원이 가능합니다.
감사합니다.`;
}

/**
 * 임시 비번 표시용 — 네 자리씩 띄운다. `11112222` → `1111 2222`.
 *
 * 저장·대조는 공백 없는 값으로 한다. 이건 화면과 안내문에만 쓴다.
 * 안내문을 그대로 복사해 붙여도 로그인되게 하는 쪽은 `lib/password-verify.ts` 다.
 */
export function formatTempPassword(pw: string): string {
  return pw.replace(/(.{4})(?=.)/g, "$1 ");
}
