import 'package:flutter/material.dart';

/// 모바일 원격 화면 팝업 메뉴(⋮ 메뉴·윈도우 도구 목록)의 크기 제한.
///   iOS 가로 화면에서만 값을 내고, 그 밖에는 null 이다 — Flutter 기본값 그대로.
///
/// iOS 는 상태 표시줄이 안 보이는 가로 화면에서도 화면 위쪽 띠의 탭을 "맨 위로 스크롤" 탭으로 가져간다.
///   그러면 진짜 터치는 취소되고 Flutter 엔진이 (0,0)에 가짜 탭을 보내, 열린 메뉴가 바깥을 누른 것으로
///   닫힌다. 가로에서는 메뉴가 화면보다 길어 맨 위까지 붙으므로 첫 항목이 늘 그 띠에 걸렸다
///   (2026-11-06 아이폰 실측 — 위에서 49.7pt 를 누르자 터치 취소 + (0,0) 탭 → 메뉴 닫힘, 257pt 는 정상).
///
/// 그래서 메뉴 위끝을 화면 높이의 1/4 아래로 내린다. 가장 작은 아이폰 가로(320pt)에서도 80pt 를 비워
///   그 띠(50~60pt 대)보다 넉넉하다. 넘치는 항목은 메뉴 안에서 스크롤된다.
BoxConstraints? crMobileMenuConstraints(MediaQueryData mq, {required bool ios}) {
  if (!ios || mq.orientation != Orientation.landscape) return null;
  return BoxConstraints(
    // constraints 를 넘기면 Flutter 기본 폭(56 단위 2~5칸)까지 통째로 바뀌므로 같은 값을 다시 준다.
    minWidth: 2 * 56,
    maxWidth: 5 * 56,
    // 메뉴는 화면 아래에서 8pt(Flutter 의 메뉴-화면 여백) + 안전 영역만큼 띄워 붙는다.
    //   그래서 이 높이면 위끝이 정확히 화면 높이의 1/4 에 온다.
    maxHeight: mq.size.height * 0.75 - mq.padding.bottom - 8,
  );
}
