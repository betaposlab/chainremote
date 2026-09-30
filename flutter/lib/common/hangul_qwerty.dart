// 한글 상태로 친 비밀번호를 원래 치려던 알파벳으로 되돌린다.
//
// ★왜 추측이 아닌가: 두벌식 자판은 자모 하나가 키 하나에 1:1 로 대응한다. 한글 상태에서
//   '7kr8s2' 를 치면 반드시 '7ㅏㄱ8ㄴ2' 가 되고, 거꾸로 풀면 반드시 '7kr8s2' 가 나온다.
//   추론이 아니라 되돌리기다. 관리 패널 로그인이 쓰는 lib/hangul-qwerty.ts 와 같은 표다.
//
// 어디서 쓰나(2026-09-30): 거래처 비밀번호 창. 임시 원격(626.kr [원격지원 받기])의 일회용
//   비밀번호는 영문+숫자 6자인데, 맥·윈도우 모두 한/영 상태가 한글이면 *표만 보여 틀린 줄
//   모른 채 실패한다. 사람이 한/영을 확인하게 하는 대신 값을 되돌려 준다.
//
// ★null 을 돌려주는 게 중요하다. 한글이 없으면 손대지 않는다 — 진짜로 한글이 든 비밀번호를
//   쓰는 거래처가 있더라도(무인접속 비밀번호는 패널에서 정한다) 원문을 먼저 보내고, 실패했을
//   때만 되돌린 값을 쓰는 구조로 갈 수 있다.

const Map<String, String> _key = {
  'ㄱ': 'r', 'ㄲ': 'R', 'ㄳ': 'rt', 'ㄴ': 's', 'ㄵ': 'sw', 'ㄶ': 'sg', 'ㄷ': 'e', 'ㄸ': 'E',
  'ㄹ': 'f', 'ㄺ': 'fr', 'ㄻ': 'fa', 'ㄼ': 'fq', 'ㄽ': 'ft', 'ㄾ': 'fx', 'ㄿ': 'fv', 'ㅀ': 'fg',
  'ㅁ': 'a', 'ㅂ': 'q', 'ㅃ': 'Q', 'ㅄ': 'qt', 'ㅅ': 't', 'ㅆ': 'T', 'ㅇ': 'd', 'ㅈ': 'w',
  'ㅉ': 'W', 'ㅊ': 'c', 'ㅋ': 'z', 'ㅌ': 'x', 'ㅍ': 'v', 'ㅎ': 'g',
  'ㅏ': 'k', 'ㅐ': 'o', 'ㅑ': 'i', 'ㅒ': 'O', 'ㅓ': 'j', 'ㅔ': 'p', 'ㅕ': 'u', 'ㅖ': 'P',
  'ㅗ': 'h', 'ㅘ': 'hk', 'ㅙ': 'ho', 'ㅚ': 'hl', 'ㅛ': 'y', 'ㅜ': 'n', 'ㅝ': 'nj', 'ㅞ': 'np',
  'ㅟ': 'nl', 'ㅠ': 'b', 'ㅡ': 'm', 'ㅢ': 'ml', 'ㅣ': 'l',
};

// 유니코드 완성형 음절의 초·중·종성 순서(고정). 종성 첫 칸은 '받침 없음'이다.
const List<String> _cho = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const List<String> _jung = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const List<String> _jong = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

const int _sylFirst = 0xAC00;
const int _sylLast = 0xD7A3;

/// 한글이 섞여 있으면 두벌식 기준 알파벳으로 되돌린 문자열, 아니면 null.
String? qwertyFromHangul(String input) {
  var found = false;
  final out = StringBuffer();
  for (final rune in input.runes) {
    if (rune >= _sylFirst && rune <= _sylLast) {
      final i = rune - _sylFirst;
      out.write(_key[_cho[i ~/ 588]] ?? '');
      out.write(_key[_jung[(i % 588) ~/ 28]] ?? '');
      final jong = _jong[i % 28];
      if (jong.isNotEmpty) out.write(_key[jong] ?? '');
      found = true;
    } else {
      final ch = String.fromCharCode(rune);
      final k = _key[ch];
      if (k != null) {
        out.write(k);
        found = true;
      } else {
        out.write(ch);
      }
    }
  }
  return found ? out.toString() : null;
}
