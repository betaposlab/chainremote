// 혼동 문자(O/0, l/1, I)는 두 벌 모두에서 뺐다 — 구두로 불러 줄 수 있어야 한다.
const ALPHA_MIXED = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
// 대문자+숫자만. 전화로 불러 줄 때 "대문자 K" / "소문자 k" 를 가릴 필요가 없다
//   (2026-09-04 Chang: 대소문자가 섞이면 불러 주기 힘들다).
const ALPHA_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * 비밀번호 자동 생성. 보안 RNG 사용.
 *
 * 기본(혼합)은 길이 8 ≈ 6.4e11 조합. `upperOnly` 는 대문자+숫자 32자라
 * 같은 길이에서 조합이 줄지만(6자 ≈ 10.7억) 전화 전달이 쉽다 — 첫 로그인 뒤
 * 바로 바꾸는 임시 비번에 맞는 맞바꿈이다.
 */
export function generatePassword(
  length = 8,
  opts?: { upperOnly?: boolean },
): string {
  const alphabet = opts?.upperOnly ? ALPHA_UPPER : ALPHA_MIXED;
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
