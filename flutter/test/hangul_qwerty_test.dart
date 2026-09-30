import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/common/hangul_qwerty.dart';

void main() {
  test('한글 상태로 친 일회용 비밀번호를 영타로 되돌린다', () {
    // 2026-09-30 테스트1 실측: RustDesk 일회용 비번 7kr8s2 를 한글 자판으로 치면 7ㅏㄱ8ㄴ2
    expect(qwertyFromHangul('7ㅏㄱ8ㄴ2'), '7kr8s2');
    expect(qwertyFromHangul('초뭏'), 'chang');
    expect(qwertyFromHangul('ㅑㅁㄷ녀ㅜㅎ'), 'iaesung');
  });
  test('한글이 없으면 손대지 않는다(null)', () {
    expect(qwertyFromHangul('7kr8s2'), isNull);
    expect(qwertyFromHangul(''), isNull);
  });
  test('겹자모는 실제로 누른 두 키로 풀린다', () {
    expect(qwertyFromHangul('돠'), 'ehk');
    expect(qwertyFromHangul('삶'), 'tkfa');
  });
}
