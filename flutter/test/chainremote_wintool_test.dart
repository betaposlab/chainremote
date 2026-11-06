// [윈도우 도구] 표와 버전 판정 — 데스크톱 툴바와 모바일 ⋮ 메뉴가 같이 쓴다.
//
// 여기서 지키는 것 둘:
//   ① 표의 번호가 프로토콜 CrWinTool.Tool(message.proto)과 하나씩 맞는다. 어긋나면 엉뚱한
//      도구가 열리거나 에이전트가 모르는 번호라며 조용히 버린다 — 어느 쪽도 화면에 안 드러난다.
//   ② 버전 판정이 우리 버전 규칙(주·부·빌드를 앞에서부터)으로 돈다. 상류 versionCmp 로 돌던
//      때는 1.5.01 이 1.4.161 보다 낮게 나와, 1.5 로 올리는 날 메뉴가 사라질 뻔했다.

import 'package:flutter/material.dart' show IconData;
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/common/widgets/chainremote_wintool.dart';

List<int> _numbers(List<(int, String, IconData)?> t) =>
    [for (final e in t) if (e != null) e.$1];

void main() {
  test('표의 번호가 프로토콜 0~10 과 하나씩 맞는다', () {
    final ns = _numbers(kCrWinTools);
    expect(ns.toSet().length, ns.length, reason: '같은 번호가 두 번 있다');
    expect(ns.toSet(), {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10});
    for (final n in kCrWinToolItemMinAgent.keys) {
      expect(ns, contains(n), reason: '버전 기준만 있고 표에 없는 번호 $n');
    }
  });

  test('우리 버전 비교 — 주·부·빌드를 앞에서부터', () {
    expect(crVersionAtLeast('1.4.164', '1.4.164'), isTrue);
    expect(crVersionAtLeast('1.4.165', '1.4.164'), isTrue);
    expect(crVersionAtLeast('1.4.163', '1.4.164'), isFalse);
    expect(crVersionAtLeast('1.4.99', '1.4.161'), isFalse);
    expect(crVersionAtLeast('1.4.161-pushtest', '1.4.161'), isTrue);
    // ★상류 versionCmp 로는 아래 둘이 거꾸로 나온다(1.5.01 → 1005010 < 1.4.161 → 1005610).
    expect(crVersionAtLeast('1.5.01', '1.4.161'), isTrue);
    expect(crVersionAtLeast('1.5.01', '1.4.164'), isTrue);
    expect(crVersionAtLeast('2.0.0', '1.4.161'), isTrue);
    // 못 읽는 버전은 감추는 쪽으로.
    expect(crVersionAtLeast('', '1.4.161'), isFalse);
    expect(crVersionAtLeast('1.4', '1.4.161'), isFalse);
    expect(crVersionAtLeast('x.4.200', '1.4.161'), isFalse);
  });

  test('그룹 정책 편집기는 1.4.164 이상 에이전트에만', () {
    expect(_numbers(crWinToolsFor('1.4.161')), isNot(contains(10)));
    expect(_numbers(crWinToolsFor('1.4.163')).length, 10);
    expect(_numbers(crWinToolsFor('1.4.164')), contains(10));
    expect(_numbers(crWinToolsFor('1.5.01')).length, 11);
  });

  test('걸러도 구분선이 끝에 오거나 겹치지 않는다', () {
    for (final v in ['1.4.161', '1.4.164', '1.5.01']) {
      final t = crWinToolsFor(v);
      expect(t.first, isNotNull, reason: v);
      expect(t.last, isNotNull, reason: v);
      for (var i = 1; i < t.length; i++) {
        expect(t[i] == null && t[i - 1] == null, isFalse, reason: '$v: $i');
      }
    }
  });
}
