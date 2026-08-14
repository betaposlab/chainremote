// 크레딧 크롤이 **실제로 보이는 상태로** 배치되는지 검증한다.
//
// 왜 필요한가: 첫 판이 검은 화면만 나왔다(2026-08-15). 컴파일도 되고 analyze 도 통과하고
// 위젯 테스트(위치만 확인)도 통과하면서 실제 화면만 비는 유형이었다 — 3D 원근 행렬 +
// ShaderMask 조합이라 원인 지점을 위젯 트리에서 못 봤다.
//
// 그래서 배치를 순수 함수(crCrawlLayout)로 빼고 여기서 **숫자로** 확인한다:
// 진행 내내 보이는 줄이 있는가 / 투명도가 0 이 아닌가 / 좌표가 화면 안인가.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/common/widgets/chainremote_easter_crawl.dart';

void main() {
  const h = 800.0;
  // 실제 크롤과 같은 모양의 표본(빈 줄 포함).
  final lines = <String>[
    'ChainRemote',
    '',
    '거래처 원격지원, 클릭 한 번으로.',
    '',
    '우리가 더한 것',
    '',
    '클릭 한 번으로 끝나는 수락',
    '스스로 등록하는 에이전트',
    '',
    '만든 사람',
    '',
    'Chang · betaposlab',
    '채리',
    '',
    'made with care',
  ];

  test('진행 내내 보이는 줄이 있다 (검은 화면 회귀 방지)', () {
    var emptyAt = <double>[];
    var maxVisible = 0;
    // 끝자락(글이 다 빠져나가는 구간)은 비어도 정상이라 0.90 까지만 본다.
    for (var p = 0.0; p <= 0.90; p += 0.02) {
      final items = crCrawlLayout(lines: lines, progress: p, height: h);
      final visible = items.where((e) => e.opacity > 0.05).toList();
      if (visible.isEmpty) emptyAt.add(p);
      if (visible.length > maxVisible) maxVisible = visible.length;
    }
    expect(emptyAt, isEmpty,
        reason: '글자가 하나도 안 보이는 구간이 있다 (progress=$emptyAt)');
    expect(maxVisible, greaterThan(2), reason: '동시에 여러 줄이 보여야 크롤로 읽힌다');
  });

  test('좌표·크기·투명도가 전부 유한하고 화면 안이다', () {
    for (var p = 0.0; p <= 1.0; p += 0.01) {
      for (final it in crCrawlLayout(lines: lines, progress: p, height: h)) {
        expect(it.y.isFinite, isTrue, reason: 'y 가 무한대 (progress=$p)');
        expect(it.scale.isFinite && it.scale > 0, isTrue,
            reason: 'scale 이 0 이하이거나 무한대 (progress=$p, scale=${it.scale})');
        expect(it.opacity >= 0 && it.opacity <= 1, isTrue,
            reason: 'opacity 범위 밖 (progress=$p, opacity=${it.opacity})');
        expect(it.y, greaterThan(-200), reason: '화면 위로 너무 벗어남 (progress=$p)');
        expect(it.y, lessThan(h + 200), reason: '화면 아래로 너무 벗어남 (progress=$p)');
      }
    }
  });

  test('위로 갈수록 작아지고 옅어진다 (부채꼴·페이드)', () {
    final items = crCrawlLayout(lines: lines, progress: 0.45, height: h);
    expect(items.length, greaterThan(1));
    final sorted = [...items]..sort((a, b) => a.y.compareTo(b.y));
    // 위(y 작음)가 아래(y 큼)보다 작고 옅어야 한다.
    expect(sorted.first.scale, lessThan(sorted.last.scale));
    expect(sorted.first.opacity, lessThanOrEqualTo(sorted.last.opacity));
  });

  testWidgets('아무 곳이나 누르면 닫힌다', (tester) async {
    tester.view.physicalSize = const Size(1000, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () => showCrCreditsCrawl(context),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('아무 곳이나 누르면 닫힙니다'), findsOneWidget);
    await tester.tapAt(const Offset(500, 400));
    await tester.pumpAndSettle();
    expect(find.text('아무 곳이나 누르면 닫힙니다'), findsNothing);
  });
}
