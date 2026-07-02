// 거래처 원격 ID 표시 포맷 — 앱(Flutter)·에이전트(Sciter)와 같은 규칙.
//   새 형식 "AB12345678" → "AB 1234 5678" (앞글자 대문자).
//   구형 숫자 ID 는 3자리씩 그룹화(하위호환). 그 외는 원본 그대로.
export function formatRemoteId(id: string | null | undefined): string {
  if (!id) return "";
  const s = id.replace(/\s/g, "");
  const ab = /^([A-Za-z]{2})(\d{4})(\d{4})$/.exec(s);
  if (ab) {
    return `${ab[1].toUpperCase()} ${ab[2]} ${ab[3]}`;
  }
  if (/^\d+$/.test(s) && s.length > 3) {
    const n = s.length;
    const a = n % 3 || 3;
    let out = s.slice(0, a);
    for (let i = a; i < n; i += 3) {
      out += " " + s.slice(i, i + 3);
    }
    return out;
  }
  return s;
}
