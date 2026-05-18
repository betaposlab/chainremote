/**
 * 거래처 접속 비밀번호 자동 생성.
 * 보안 RNG 사용. 혼동 문자(O/0, l/1, I) 제외해서 거래처에 구두 전달 가능하게.
 * 길이 8 = 약 6.4e11 조합 → 거래처 단위로는 충분, 보안 키처럼 강력할 필요는 없음.
 */
export function generatePassword(length = 8): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
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
