// iOS 가로 화면의 팝업 메뉴 높이 제한 — 메뉴가 화면 위쪽 띠(iOS 가 "맨 위로 스크롤" 탭으로
//   가져가는 곳)까지 올라가지 않는지 실제 showMenu 배치로 확인한다.
//
// 2026-11-06 아이폰 가로에서 ⋮ 메뉴 맨 위 항목([윈도우 도구])이 눌리지 않았다. 메뉴가 화면보다 길어
//   맨 위까지 붙었고, 그 자리 탭은 iOS 가 가져가 엔진이 (0,0) 가짜 탭을 보내 메뉴가 닫혔다.
//   iOS 의 가로채기 자체는 테스트로 흉내 낼 수 없어서, 여기서는 "메뉴가 그 띠에 안 닿는다"를 숫자로 본다.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/mobile/widgets/chainremote_menu_constraints.dart';

void main() {
  testWidgets('iOS 가로 — 메뉴 위끝이 화면 위 1/4 아래, 넘친 항목은 스크롤로 눌린다',
      variant: TargetPlatformVariant.only(TargetPlatform.iOS), (tester) async {
    // Chang 아이폰 실측(디스플레이 확대): 812x375, 아래 안전 영역 20, 좌우 51.
    const pad = FakeViewPadding(left: 51 * 3, right: 51 * 3, bottom: 20 * 3);
    tester.view.physicalSize = const Size(812, 375) * 3;
    tester.view.devicePixelRatio = 3;
    tester.view.padding = pad;
    tester.view.viewPadding = pad;
    addTearDown(tester.view.reset);

    late BuildContext ctx;
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (c) {
      ctx = c;
      return const Scaffold(body: SizedBox.expand());
    })));

    final mq = MediaQuery.of(ctx);
    final c = crMobileMenuConstraints(mq, ios: true);
    expect(c, isNotNull);
    int? picked = -1;
    // 실제 ⋮ 메뉴와 같은 자리(아래쪽 기준)·같은 항목 수(11).
    showMenu<int>(
      context: ctx,
      position: RelativeRect.fromLTRB(120, mq.size.height, 120, mq.size.height),
      items: [
        for (var i = 0; i < 11; i++) PopupMenuItem(value: i, child: Text('item $i')),
      ],
      constraints: c,
    ).then((v) => picked = v);
    await tester.pumpAndSettle();

    final menu = tester.getRect(find.byType(SingleChildScrollView).last);
    expect(menu.top, greaterThanOrEqualTo(375 / 4 - 0.5), reason: '메뉴가 위쪽 띠로 올라갔다: $menu');
    expect(tester.getRect(find.text('item 0')).top, greaterThan(375 / 4));
    // 폭은 Flutter 기본(112~280) 그대로.
    expect(menu.width, inInclusiveRange(112, 280));

    await tester.scrollUntilVisible(find.text('item 10'), 100,
        scrollable: find.byType(Scrollable).last);
    await tester.tap(find.text('item 10'));
    await tester.pumpAndSettle();
    expect(picked, 10);
  });

  test('세로·안드로이드는 손대지 않는다(null = Flutter 기본값)', () {
    expect(crMobileMenuConstraints(const MediaQueryData(size: Size(375, 812)), ios: true), isNull);
    expect(crMobileMenuConstraints(const MediaQueryData(size: Size(812, 375)), ios: false), isNull);
  });
}
