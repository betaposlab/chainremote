// 거래처 고르기용 검색 — 상호·원격 ID·초성.
//
// 대리점 하나가 가맹점 2,000곳이면 드롭다운을 눈으로 훑는 건 불가능하다(2026-08-15 Chang).
// 순수 함수로 빼 둔 이유: 화면에 인라인으로 두면 테스트가 못 닿고, 초성 규칙은 조용히
// 틀리기 쉬운 종류의 코드다(test/customer-search.test.ts).

const CHO = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];

/** 한글 음절을 초성으로. 한글이 아닌 글자는 그대로 둔다. "낭성 관리" → "ㄴㅅ ㄱㄹ" */
export function toChosung(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  return out;
}

/** 질의가 전부 초성 낱자인가 — "ㄴㅅ" 는 초성 검색, "낭" 은 일반 검색. */
function isChosungQuery(q: string): boolean {
  const body = q.replace(/\s/g, "");
  return body.length > 0 && [...body].every((ch) => CHO.includes(ch));
}

export type SearchableCustomer = { id: string; name: string; remoteId?: string | null };

/**
 * 상호 부분일치(대소문자 무시) · 원격 ID 부분일치 · 초성 일치.
 * 빈 질의는 전부 반환. ID 는 사람이 공백/하이픈을 끼워 읽으므로 숫자·영문만 남겨 비교한다.
 */
export function filterCustomers<T extends SearchableCustomer>(items: T[], q: string): T[] {
  const query = q.trim();
  if (!query) return items;
  const lower = query.toLowerCase();
  const idQuery = query.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
  const cho = isChosungQuery(query) ? query.replace(/\s/g, "") : null;

  return items.filter((c) => {
    const name = c.name ?? "";
    if (cho) return toChosung(name).replace(/\s/g, "").includes(cho);
    if (name.toLowerCase().includes(lower)) return true;
    if (idQuery && c.remoteId) {
      return c.remoteId.replace(/[^0-9a-zA-Z]/g, "").toLowerCase().includes(idQuery);
    }
    return false;
  });
}
