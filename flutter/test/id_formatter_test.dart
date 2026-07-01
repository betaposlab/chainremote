import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/common/formatter/id_formatter.dart';

// ChainRemote: ID 표시 형식 — 새 형식 "AB12345678" → "AB 1234 5678", 기존 숫자 ID 는 하위호환.
void main() {
  group('formatID — 새 AB 형식', () {
    test('AB12345678 → "AB 1234 5678"', () {
      expect(formatID('AB12345678'), 'AB 1234 5678');
      expect(formatID('ZZ99999999'), 'ZZ 9999 9999');
      expect(formatID('GJ38001972'), 'GJ 3800 1972');
    });
    test('이미 공백 들어온 입력도 동일 결과(정규화)', () {
      expect(formatID('AB 1234 5678'), 'AB 1234 5678');
    });
    test('trimID 는 공백만 제거 — 접속용 ID 보존', () {
      expect(trimID('AB 1234 5678'), 'AB12345678');
      expect(trimID('AB12345678'), 'AB12345678');
    });
    test('앞 2글자 자동 대문자 (소문자로 쳐도 접속됨)', () {
      expect(formatID('gn50840785'), 'GN 5084 0785');
      expect(formatID('Gn 5084 0785'), 'GN 5084 0785');
      expect(trimID('gn 5084 0785'), 'GN50840785');
      expect(trimID('gn50840785'), 'GN50840785');
    });
  });

  group('formatID — 기존 숫자 ID 하위호환', () {
    test('9자리 → 3자리씩', () {
      expect(formatID('123456789'), '123 456 789');
    });
    test('8자리 → 2+3+3', () {
      expect(formatID('12345678'), '12 345 678');
    });
  });

  group('formatID — 비형식/부분 입력은 그대로', () {
    test('미완성 AB(숫자 부족)는 변형 안 함', () {
      expect(formatID('AB12'), 'AB12');
      expect(formatID('AB123456'), 'AB123456'); // 6자리(8 아님)
    });
    test('영문 잡문자열 그대로', () {
      expect(formatID('abc'), 'abc');
    });
  });
}
