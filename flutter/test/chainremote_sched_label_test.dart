import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_hbb/common/widgets/chainremote_sched.dart';

// ChainRemote 예약원격: 거래처 수락 카드에 뜨는 시간 문구.
//
// 이 문구는 **본사가 만들어 문자열로 보낸다** — 거래처(x64 Flutter·x86 Sciter)는 받은 것을
//   그리기만 한다. 그래서 여기가 유일한 진실 원천이고, 여기서 짧아지면 32비트 포스까지
//   같이 짧아진다. 반대로 여기서 길어지면 좁은 화면에서 두 줄로 감긴다(2026-08-21 사고).
void main() {
  group('crSchedRangeLabel — 겹치는 말을 끝에서 덜어낸다', () {
    test('같은 날 같은 오전/오후 → 날짜와 오전오후를 뺀다', () {
      // 2026-08-21 사고 그대로의 입력. 종전엔 날짜가 두 번 나와 두 줄로 감겼다.
      expect(
        crSchedRangeLabel(
            DateTime(2026, 8, 21, 7, 52), DateTime(2026, 8, 21, 7, 55)),
        '8월 21일 오전 7시 52분 ~ 7시 55분',
      );
    });

    test('정오를 넘으면 오전/오후는 살린다(날짜만 뺀다)', () {
      expect(
        crSchedRangeLabel(
            DateTime(2026, 8, 21, 11, 30), DateTime(2026, 8, 21, 13, 0)),
        '8월 21일 오전 11시 30분 ~ 오후 1시',
      );
    });

    test('자정을 넘으면 날짜까지 살린다', () {
      expect(
        crSchedRangeLabel(
            DateTime(2026, 8, 21, 23, 0), DateTime(2026, 8, 22, 1, 0)),
        '8월 21일 오후 11시 ~ 8월 22일 오전 1시',
      );
    });

    test('달이 바뀌어도 끝이 온전하다', () {
      expect(
        crSchedRangeLabel(
            DateTime(2026, 8, 31, 23, 30), DateTime(2026, 9, 1, 0, 30)),
        '8월 31일 오후 11시 30분 ~ 9월 1일 오전 12시 30분',
      );
    });

    test('정각이면 분을 붙이지 않는다', () {
      expect(
        crSchedRangeLabel(
            DateTime(2026, 8, 21, 9, 0), DateTime(2026, 8, 21, 10, 0)),
        '8월 21일 오전 9시 ~ 10시',
      );
    });

    test('짧아진 문구가 종전보다 실제로 짧다', () {
      final start = DateTime(2026, 8, 21, 7, 52);
      final end = DateTime(2026, 8, 21, 7, 55);
      final now = crSchedRangeLabel(start, end);
      final before = '${crSchedTimeLabel(start)} ~ ${crSchedTimeLabel(end)}';
      expect(now.length, lessThan(before.length));
    });
  });

  group('crSchedTimeLabel — 단독 호출은 기본값 그대로', () {
    // HQ 목록의 예약 배지(peer_card)와 수락 토스트가 인자 없이 부른다.
    // 기본값이 바뀌면 그 두 곳이 조용히 날짜를 잃는다.
    test('인자 없이 부르면 날짜·오전오후가 전부 나온다', () {
      expect(crSchedTimeLabel(DateTime(2026, 8, 21, 7, 52)), '8월 21일 오전 7시 52분');
      expect(crSchedTimeLabel(DateTime(2026, 8, 21, 15, 0)), '8월 21일 오후 3시');
    });

    test('12시 경계 — 0시는 오전 12시, 12시는 오후 12시', () {
      expect(crSchedTimeLabel(DateTime(2026, 8, 21, 0, 0)), '8월 21일 오전 12시');
      expect(crSchedTimeLabel(DateTime(2026, 8, 21, 12, 0)), '8월 21일 오후 12시');
    });
  });
}
