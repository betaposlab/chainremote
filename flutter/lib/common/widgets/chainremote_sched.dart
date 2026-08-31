// ChainRemote 예약원격 — 기사가 시간대를 정해 거래처에 보내는 다이얼로그.
//
// 흐름: 전화로 "오늘 밤 11시에 작업할게요"를 합의한 뒤, 기사가 여기서 시간을 넣어 보낸다.
// 거래처 화면엔 그 시간이 적힌 카드가 뜨고, 사장님이 [수락]을 누르면 그 구간에는 수락 창이
// 안 뜬다.
//
// ★사장님은 시간을 고르지 않는다. 여기서 만든 문구(label)를 읽고 버튼만 누른다.
//   문구를 본사가 만들어 보내는 이유: 포스 시계가 틀려도 **화면 글자는 약속한 그 시각**
//   이어야 하기 때문이다. 거래처에서 다시 계산하면 시계가 어긋난 기기에서 엉뚱한 시간이 뜬다.

import 'dart:async';

import 'package:flutter/cupertino.dart' show CupertinoPicker;
import 'package:flutter/gestures.dart' show PointerDeviceKind;
import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../common.dart';
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';

/// 창의 최대 길이. 거래처 쪽에서도 한 번 더 막지만, 여기서 먼저 막아 실수를 줄인다.
///   "넉넉히"가 실수로 몇 달짜리가 되면 사실상 영구 비밀번호가 된다.
const int kSchedMaxHours = 24;

/// "8월 18일 오후 11시" — 사장님이 읽을 문구. 24시간 표기나 분 단위는 쓰지 않는다.
///   정각이 아니면 분을 붙인다("오후 11시 30분").
///
/// [withDate]·[withAmPm] 는 구간의 **끝 시각**에서 앞과 겹치는 만큼 덜어내려고 있다
///   (crSchedRangeLabel 참조). 단독으로 부르는 자리는 기본값 그대로 전체를 쓴다.
String crSchedTimeLabel(DateTime t, {bool withDate = true, bool withAmPm = true}) {
  final ampm = t.hour < 12 ? '오전' : '오후';
  var h = t.hour % 12;
  if (h == 0) h = 12;
  final m = t.minute == 0 ? '' : ' ${t.minute}분';
  final date = withDate ? '${t.month}월 ${t.day}일 ' : '';
  final half = withAmPm ? '$ampm ' : '';
  return '$date$half$h시$m';
}

/// "8월 21일 오전 7시 52분 ~ 7시 55분" — 끝 시각에서 앞과 겹치는 말을 덜어낸다.
///
/// ★길이가 목적이다. 양쪽을 다 적으면 좁은 포스 화면에서 두 줄로 감기며 "7"과 "시" 사이가
///   끊긴다(2026-08-21 Chang 실측). 폭이나 글씨 크기가 아니라 **문구**를 고치는 이유는,
///   예약 창이 승인 후 24시간 상한이라 시작과 끝이 거의 항상 같은 날 같은 오전/오후이기
///   때문이다 — 그 경우 날짜와 오전/오후는 두 번째로 읽을 값이 아니라 소음이다.
///   자정을 넘으면 날짜가, 정오를 넘으면 오전/오후가 되살아난다.
///
/// nowrap 으로 막지 않는다. 좁은 화면에서 글자가 잘리거나 카드를 밀어낸다.
String crSchedRangeLabel(DateTime start, DateTime end) {
  final sameDay =
      start.year == end.year && start.month == end.month && start.day == end.day;
  final sameHalf = (start.hour < 12) == (end.hour < 12);
  final tail = crSchedTimeLabel(end,
      withDate: !sameDay, withAmPm: !(sameDay && sameHalf));
  return '${crSchedTimeLabel(start)} ~ $tail';
}

/// 아이폰식 휠 한 칸. 굴려서 고른다.
///
/// ★창 안에서 또 창을 띄우지 않으려고 직접 박았다. 종전엔 여기서 달력(showDatePicker)과
/// 시계(showTimePicker)를 잇달아 띄웠는데, 이 창은 오버레이(dialogManager)로 뜨고 그 둘은
/// 기본 라우트로 떠서 **층이 달랐다** — 달력이 창 뒤로 깔리고, 누를 때마다 그림자가 하나씩
/// 쌓여 배경이 점점 어두워지며, 누른 횟수만큼 취소를 눌러야 걷혔다(2026-08-18 Chang 실측).
class _CrWheel extends StatefulWidget {
  final int count;
  final int index;
  final String Function(int) label;
  final ValueChanged<int> onChanged;
  final double width;

  /// 끝에서 처음으로 이어지게 굴린다(시·분 전용).
  ///
  /// ★59분에서 멈춰 버리면 05분으로 가려고 위로 54칸을 되감아야 한다. 12시 다음이 01시,
  /// 59분 다음이 00분으로 이어져야 손이 가는 대로 맞춰진다(2026-08-18 Chang 실측).
  /// 월·일은 고를 수 있는 값이 한둘뿐이라 이어 붙이면 오히려 헷갈려서 그대로 둔다.
  final bool looping;

  const _CrWheel({
    required this.count,
    required this.index,
    required this.label,
    required this.onChanged,
    required this.width,
    this.looping = false,
  });

  @override
  State<_CrWheel> createState() => _CrWheelState();
}

class _CrWheelState extends State<_CrWheel> {
  late FixedExtentScrollController _ctl;

  @override
  void initState() {
    super.initState();
    _ctl = FixedExtentScrollController(initialItem: widget.index);
  }

  @override
  void didUpdateWidget(covariant _CrWheel old) {
    super.didUpdateWidget(old);
    // 바깥에서 값이 바뀐 경우(월을 바꿔 일이 잘렸다 등)만 따라간다. 사용자가 굴리는 중에는
    //   index 와 화면이 이미 같으므로 아무 일도 하지 않는다 — 여기서 매번 맞추면 손가락과
    //   싸우게 된다.
    if (widget.index < widget.count) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_ctl.hasClients) return;
        // ★이어 붙인 휠은 selectedItem 이 범위를 벗어난다(60개짜리에서 63 처럼). 그대로
        //   비교하면 매 프레임 "다르다"고 판단해 손가락과 싸운다 — 나머지로 견준다.
        final cur = widget.looping
            ? _ctl.selectedItem % widget.count
            : _ctl.selectedItem;
        final norm = cur < 0 ? cur + widget.count : cur;
        if (norm != widget.index) _ctl.jumpToItem(widget.index);
      });
    }
  }

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = CrColors.of(context);
    return SizedBox(
      width: widget.width,
      height: 104,
      // ★마우스로 **잡아끌 수 있게** 한다. Flutter 는 데스크톱에서 마우스 드래그를 스크롤로
      //   치지 않는다(기본 dragDevices 에 mouse 가 없다) — 그래서 휠을 굴려야만 움직였고,
      //   숫자를 잡아 올려도 아무 반응이 없어 고장처럼 보였다(2026-08-19 Chang).
      //   휠은 그대로 두고 드래그를 더하는 것이라 잃는 동작이 없다.
      child: ScrollConfiguration(
        behavior: const _DragAnywhere(),
        // ★.builder 가 아니라 기본 생성자를 쓴다 — 이어 붙이기(looping)는 여기에만 있다.
        //   칸이 최대 60개라 미리 만들어도 부담이 없다.
        child: CupertinoPicker(
          scrollController: _ctl,
          looping: widget.looping,
          itemExtent: 30,
          squeeze: 1.15,
          useMagnifier: true,
          magnification: 1.05,
          backgroundColor: Colors.transparent,
          selectionOverlay: Container(
            decoration: BoxDecoration(
              color: c.accent.withOpacity(0.12),
              borderRadius: BorderRadius.circular(6),
            ),
          ),
          onSelectedItemChanged: widget.onChanged,
          children: List.generate(
            widget.count,
            (i) => Center(
              child: Text(
                widget.label(i),
                style: TextStyle(fontSize: 15, color: c.textStrong),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 마우스로도 끌어서 굴릴 수 있게 하는 스크롤 동작.
///
/// 데스크톱 기본값은 손가락·트랙패드·스타일러스만 드래그로 친다. 휠이 있으니 그걸로
/// 충분하다는 전제인데, 슬롯머신처럼 생긴 물건은 누구나 잡아끌어 보게 된다 — 그때
/// 아무 반응이 없으면 고장으로 읽힌다.
class _DragAnywhere extends MaterialScrollBehavior {
  const _DragAnywhere();

  @override
  Set<PointerDeviceKind> get dragDevices => {
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.trackpad,
        PointerDeviceKind.stylus,
      };
}

/// 한 시각을 고르는 다섯 휠 — 월 · 일 · 오전/오후 · 시 · 분.
///
/// [dates] 는 고를 수 있는 날짜다(오늘·내일). 그보다 멀리 못 고르게 한 건 거래처 쪽이
/// **승인 후 24시간**을 절대 상한으로 걸기 때문이다 — 그 밖의 시각을 보내면 사장님이
/// 수락해도 창이 영영 안 열린다(chainremote_sched.rs is_open ②).
class _CrWhen extends StatelessWidget {
  final DateTime value;
  final List<DateTime> dates;
  final ValueChanged<DateTime> onChanged;

  const _CrWhen({
    required this.value,
    required this.dates,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final c = CrColors.of(context);
    final months = dates.map((d) => d.month).toSet().toList()..sort();
    final days = dates.where((d) => d.month == value.month).map((d) => d.day).toList()
      ..sort();
    final isPm = value.hour >= 12;
    final h12 = value.hour % 12 == 0 ? 12 : value.hour % 12;

    // (월, 일) 로 연도를 되찾는다 — 12월 31일 ↔ 1월 1일에서 해가 바뀐다.
    DateTime rebuild({int? month, int? day, int? hour, int? minute}) {
      final mm = month ?? value.month;
      final dd = day ?? value.day;
      final match = dates.firstWhere(
        (d) => d.month == mm && d.day == dd,
        orElse: () => dates.firstWhere((d) => d.month == mm, orElse: () => dates.first),
      );
      return DateTime(match.year, match.month, match.day, hour ?? value.hour,
          minute ?? value.minute);
    }

    Widget unit(String t) => Padding(
          padding: const EdgeInsets.only(right: 2),
          child: Text(t, style: TextStyle(fontSize: 12, color: c.textMuted)),
        );

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _CrWheel(
          count: months.length,
          index: months.indexOf(value.month).clamp(0, months.length - 1),
          label: (i) => '${months[i]}',
          width: 44,
          onChanged: (i) => onChanged(rebuild(month: months[i], day: null)),
        ),
        unit('월'),
        _CrWheel(
          count: days.length,
          index: days.indexOf(value.day).clamp(0, days.length - 1),
          label: (i) => '${days[i]}',
          width: 44,
          onChanged: (i) => onChanged(rebuild(day: days[i])),
        ),
        unit('일'),
        const SizedBox(width: 6),
        _CrWheel(
          count: 2,
          index: isPm ? 1 : 0,
          label: (i) => i == 0 ? '오전' : '오후',
          width: 54,
          onChanged: (i) => onChanged(rebuild(hour: (h12 % 12) + (i == 1 ? 12 : 0))),
        ),
        const SizedBox(width: 6),
        _CrWheel(
          count: 12,
          index: h12 - 1,
          label: (i) => '${i + 1}',
          width: 44,
          looping: true,
          onChanged: (i) =>
              onChanged(rebuild(hour: ((i + 1) % 12) + (isPm ? 12 : 0))),
        ),
        unit('시'),
        _CrWheel(
          count: 60,
          index: value.minute,
          label: (i) => i.toString().padLeft(2, '0'),
          width: 46,
          looping: true,
          onChanged: (i) => onChanged(rebuild(minute: i)),
        ),
        unit('분'),
      ],
    );
  }
}

/// 기사가 시간대를 정하는 창. 보냈으면 true.
///
/// [send] 는 실제 전송을 맡는다 — 목록에서 부르면 접속에 실어 보내고(Case B),
/// 원격 툴바에서 부르면 살아 있는 세션으로 보낸다(Case A). 이 창은 시간만 정한다.
Future<bool> showCrSchedDialog({
  required String peerName,
  required bool extend,
  required void Function(DateTime start, DateTime end, String label) send,
}) async {
  final now = DateTime.now();
  // ★시작·종료 모두 **현재 시각**에서 출발한다. 아침에 통화하든 저녁에 통화하든 약속
  //   시각은 그때그때 다르므로, 기본값이 특정 시간을 정해 주면 늘 고쳐야 한다. 대신 둘이
  //   같으면 [보내기] 가 잠겨 있어, 종료를 안 고치고 보내는 실수는 막힌다(Chang 2026-08-18).
  final base = DateTime(now.year, now.month, now.day, now.hour, now.minute);
  var start = base;
  var end = base;
  var sent = false;
  // 오늘·내일. 거래처가 승인 후 24시간을 절대 상한으로 걸어 그보다 멀면 안 열린다.
  final dates = [
    DateTime(now.year, now.month, now.day),
    DateTime(now.year, now.month, now.day).add(const Duration(days: 1)),
  ];

  await gFFI.dialogManager.show<void>((setState, close, context) {
    final c = CrColors.of(context);
    final dur = end.difference(start);
    final invalid = !end.isAfter(start);
    final tooLong = dur.inHours >= kSchedMaxHours;
    // 지금부터 24시간 밖은 거래처가 아예 못 여는 구간이다 — 보내 봐야 조용히 죽는다.
    final outOfReach = end.isAfter(now.add(const Duration(hours: kSchedMaxHours)));

    Widget label(String t) => Align(
          alignment: Alignment.centerLeft,
          child: Text(t,
              style: TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w600, color: c.textMuted)),
        );

    return CustomAlertDialog(
      title: Row(children: [
        Icon(Icons.schedule_rounded, color: c.accent, size: 20),
        const SizedBox(width: 8),
        Text(extend ? '원격 예약 연장' : '원격 예약'),
      ]),
      content: SizedBox(
        width: 420,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '$peerName 사장님께 아래 시간을 보냅니다.\n'
              '사장님이 수락하면 이 시간에는 수락 창 없이 접속됩니다.',
              style: TextStyle(fontSize: 12, color: c.textMuted, height: 1.4),
            ),
          ),
          const SizedBox(height: 12),
          label('시작'),
          _CrWhen(
            value: start,
            dates: dates,
            onChanged: (v) => setState(() => start = v),
          ),
          const SizedBox(height: 6),
          label('종료'),
          _CrWhen(
            value: end,
            dates: dates,
            onChanged: (v) => setState(() => end = v),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              invalid
                  ? '종료를 시작보다 뒤로 맞춰 주세요.'
                  : outOfReach
                      ? '지금부터 24시간 안에서만 됩니다 — 그 밖은 거래처가 못 엽니다.'
                      : tooLong
                          ? '최대 $kSchedMaxHours시간까지만 됩니다 (지금 ${dur.inHours}시간).'
                          : '약 ${dur.inHours}시간 ${dur.inMinutes % 60}분',
              style: TextStyle(
                fontSize: 12,
                color: (invalid || tooLong || outOfReach) ? c.dangerFg : c.textMuted,
              ),
            ),
          ),
        ]),
      ),
      actions: [
        dialogButton('취소', onPressed: close, isOutline: true),
        dialogButton(
          extend ? '연장 요청' : '보내기',
          onPressed: (invalid || tooLong || outOfReach)
              ? null
              : () {
                  send(start, end, crSchedRangeLabel(start, end));
                  // 여기 한 곳이 Case A(툴바)·Case B(목록) 두 경로의 공통 출구다.
                  crSchedNoteSent();
                  sent = true;
                  close();
                },
        ),
      ],
      onCancel: close,
    );
  });
  return sent;
}

/// 거래처가 누른 답을 기사에게 알린다. 세션 이벤트 `cr_sched_result` 로 들어온다.
///   ★없으면 기사가 "눌렀는지"를 몰라 전화를 다시 걸지 판단할 수 없다.
void crSchedShowResult(bool accepted, int openUntil) {
  // 답이 왔으면 "못 받았다" 안내를 띄울 이유가 없다. 회신보다 답이 먼저 도착할 일은
  //   거의 없지만, 그 순서로 오면 안내 두 개가 겹쳐 기사를 헷갈리게 한다.
  _crSchedAckTimer?.cancel();
  _crSchedAckTimer = null;
  if (accepted) {
    // ★언제까지인지를 같이 말한다. 기사가 몇 시까지 걸었는지 못 떠올려 "지금 열려 있는
    //   건지 지난 건지" 헷갈리는 일이 실제로 있었다(2026-08-18 Chang).
    //   거래처가 돌려준 값을 쓴다 — 24시간 상한에 걸려 우리가 보낸 것보다 짧을 수 있다.
    final until = openUntil > 0
        ? DateTime.fromMillisecondsSinceEpoch(openUntil * 1000)
        : null;
    showToast(until == null
        ? '거래처가 원격 예약을 수락했습니다'
        : '거래처가 수락했습니다 — ${crSchedTimeLabel(until)}까지');
  } else {
    showToast('거래처가 원격 예약을 거부했습니다');
  }
}

/// 이 거래처에 열려 있는 창의 종료 시각 — 없으면 null.
///   메뉴가 "언제까지"를 같이 보여주는 데 쓴다.
DateTime? crSchedOpenUntilDate(Peer peer) {
  final local = crSchedOpenUntilOf(peer.id);
  if (local > 0) return DateTime.fromMillisecondsSinceEpoch(local * 1000);
  final cfg = _crSchedUntilFromConfig(peer.id);
  if (cfg > crNowEpoch()) {
    return DateTime.fromMillisecondsSinceEpoch(cfg * 1000);
  }
  final t = DateTime.tryParse(peer.schedOpenUntil);
  return (t != null && t.isAfter(DateTime.now())) ? t : null;
}

/// 제안을 보낸 뒤 "받았다"는 회신을 기다리는 시간.
///
/// 살아 있는 세션 위로 오가는 메시지라 정상이면 1초도 안 걸린다. 넉넉히 준 건 느린
/// 릴레이와 32비트 포스의 굼뜬 첫 렌더를 덮으려는 것이다.
const _crSchedAckWait = Duration(seconds: 6);

Timer? _crSchedAckTimer;

/// 제안을 보냈다 — "받았다"는 회신을 기다린다.
///
/// ★이 기다림이 없으면 **요청이 허공으로 사라져도 화면이 조용한 것과 똑같아 보인다.**
/// 옛 에이전트(현재 거래처 전부)는 이 메시지를 모르고 통째로 무시하는데, 기사 입장에선
/// 사장님이 자리를 비운 것과 구분이 안 된다. 전화를 더 기다릴지 다시 걸지 정할 수 없다.
void crSchedNoteSent() {
  _crSchedAckTimer?.cancel();
  _crSchedAckTimer = Timer(_crSchedAckWait, () {
    _crSchedAckTimer = null;
    showToast('거래처가 요청을 받지 못했습니다 — 원격 예약을 모르는 버전일 수 있습니다');
  });
}

/// 거래처가 제안을 받아 카드를 띄웠다. 답은 아직이다.
void crSchedNoteAck() {
  _crSchedAckTimer?.cancel();
  _crSchedAckTimer = null;
  showToast('거래처 화면에 요청을 띄웠습니다 — 사장님 응답을 기다립니다');
}

/// 현재 시각(초). 거래처가 자기 시계와 맞춰 보정하는 데 쓴다.
int crNowEpoch() => DateTime.now().millisecondsSinceEpoch ~/ 1000;

/// 거래처별 "지금 열려 있는 예약 창의 종료 시각"(epoch 초, 0=닫힘).
///
/// ★본사가 기억해 둔 값이 아니라 **거래처가 알려 준 것**을 그대로 담는다. 창의 진실은
/// 거래처에만 있다 — 재부팅을 넘고, 다른 기사가 열었을 수도 있고, 24시간 상한에 걸려
/// 본사가 제안한 것보다 짧게 열렸을 수도 있다. 본사가 자기 기억을 믿으면 그 셋을 다 놓친다.
final Map<String, int> _crSchedOpenUntil = {};

/// peer config 에 적어 두는 열쇠 — 창의 종료 시각(epoch 초). 0/빈값이면 닫힘.
const String _kSchedUntilKey = 'cr-sched-until';

/// 거래처가 알려 온 창 상태를 기록한다. 세션 이벤트 `cr_sched_state` 로 들어온다.
///
/// ★peer config 에도 적는다. 원격 창은 **별도 프로세스**라 여기 메모리는 목록 화면이
/// 못 본다 — 그래서 예약을 걸어 놓고 목록을 우클릭해도 메뉴가 안 바뀌었다(2026-08-18
/// Chang 실측). 두 프로세스가 같이 읽는 곳은 peer config 뿐이다(탭 제목이 쓴 그 통로).
void crSchedNoteState(String peerId, int openUntil) {
  _crSchedOpenUntil[peerId] = openUntil;
  try {
    // "종료시각:적어둔시각" — 뒤엣것이 유효기간 판정에 쓰인다.
    bind.mainSetPeerOptionSync(
        id: peerId,
        key: _kSchedUntilKey,
        value: '$openUntil:${crNowEpoch()}');
  } catch (_) {}
}

/// 취소를 요청했으니 이 HQ 는 더 이상 "열려 있다"고 말하지 않는다.
///
/// ★즉시 지운다. 눌렀는데 메뉴가 그대로면 안 먹은 것으로 보이고, 실제로 그래서 같은 자리를
/// 몇 번씩 다시 누르게 된다(2026-08-19 Chang). 종전엔 거래처의 "닫았다" 보고를 기다렸는데,
/// 그 보고는 **살아 있는 세션으로만** 오므로 세션 없이 취소하면 영영 안 온다 — 원래 종료
/// 시각이 지날 때까지 메뉴가 안 바뀌었다.
///
/// 거짓말이 아니다. 명령은 큐에 들어갔고 거래처가 곧 지운다. 만에 하나 거래처 PC 가 꺼져
/// 있어 명령이 안 닿으면 그쪽이 계속 "열려 있다"고 보고하므로, 다음 목록 새로고침 때
/// 메뉴가 도로 살아난다 — 되돌아오는 표시가 곧 정정이다.
void crSchedClearLocally(String peerId) {
  _crSchedOpenUntil.remove(peerId);
  try {
    bind.mainSetPeerOptionSync(id: peerId, key: _kSchedUntilKey, value: '0');
  } catch (_) {}
}

/// 이 메모를 믿어 주는 시간.
///
/// 이 메모의 역할은 **패널이 알기 전까지의 빈틈**을 메우는 것뿐이다. 거래처는 예약이 있는
/// 동안 1분마다 보고하므로 그 뒤로는 패널이 더 정확하다. 유효기간이 없으면 한 번 적힌
/// 값이 영영 안 죽어, 사장님이 트레이에서 취소해도 본사 메뉴가 원래 종료 시각까지
/// [원격 예약 취소] 로 굳어 있었다(2026-08-19 테스트1 실측).
const _crSchedConfigTtl = 180;

/// peer config 에 적힌 창 종료 시각 — 다른 창(프로세스)이 적어 둔 것을 읽는다.
///   유효기간이 지났으면 0 을 돌려 패널 값에 자리를 내준다.
int _crSchedUntilFromConfig(String peerId) {
  try {
    final v = bind.mainGetPeerOptionSync(id: peerId, key: _kSchedUntilKey);
    if (v.isEmpty) return 0;
    final parts = v.split(':');
    final until = int.tryParse(parts.first) ?? 0;
    if (until == 0) return 0;
    // 적어둔 시각이 없으면(옛 형식) 믿지 않는다 — 언제 적힌지 모르는 값이다.
    final at = parts.length > 1 ? (int.tryParse(parts[1]) ?? 0) : 0;
    if (at == 0 || crNowEpoch() - at > _crSchedConfigTtl) return 0;
    return until;
  } catch (_) {
    return 0;
  }
}

/// 거래처 ID 만으로 보는 창 종료 시각 — 메모리와 peer config 를 합쳐 본다.
///
/// ★[crSchedOpenUntilOf] 만 쓰면 안 된다. 그건 이 창(프로세스)의 메모리만 보는데, 원격
/// 창과 목록 창은 서로 다른 프로세스라 한쪽이 받은 상태를 다른 쪽이 모른다. 세션 종료
/// 확인창이 그걸 놓쳐, 예약이 살아 있는데도 [원격 예약도 함께 닫기] 가 안 떴다
/// (2026-08-19 테스트1 실측 — peer config 엔 값이 있는데 대화상자만 못 봤다).
/// 이 거래처의 창이 지금 열려 있나 — 열려 있으면 종료 시각, 아니면 0.
int crSchedOpenUntilOf(String peerId) {
  final until = _crSchedOpenUntil[peerId] ?? 0;
  // 거래처 시계 기준이지만, 본사 시계로 봐도 이미 한참 지났으면 닫힌 것으로 본다.
  //   물어봐야 소용없는 창을 두고 기사에게 질문을 띄우지 않으려는 것이다.
  return until > crNowEpoch() ? until : 0;
}

/// 이 거래처에 예약 창이 열려 있나 — 두 출처를 합쳐 본다.
///
/// ★한쪽만 보면 각각 구멍이 난다. 로컬 기억은 거래처가 [수락] 한 순간 바로 알지만 HQ 를
/// 껐다 켜거나 **다른 기사가 건 예약**은 모르고, 패널 값은 누가 걸었든 다 알지만 하트비트
/// 주기 때문에 **최대 10분 늦다**. 어느 쪽이든 열려 있다고 하면 열린 것으로 본다.
bool crSchedIsOpenFor(Peer peer) => crSchedOpenUntilDate(peer) != null;

/// 취소 요청을 이미 큐에 넣었나(패널 기준).
bool crSchedCloseRequested(Peer peer) =>
    peer.schedCloseRequestedAt.isNotEmpty;


/// Case B — 아직 접속 안 한 거래처. 제안을 걸어 두고 접속을 시작한다.
///   접속의 로그인 요청에 실려 가서, 거래처가 평소 수락 카드 대신 시간 카드를 띄운다.
void crSchedSendByConnect(
    String peerId, DateTime start, DateTime end, String label) {
  bind.mainSetSchedReq(
    id: peerId,
    start: start.millisecondsSinceEpoch ~/ 1000,
    end: end.millisecondsSinceEpoch ~/ 1000,
    hqNow: crNowEpoch(),
    label: label,
    extend: false,
  );
  // 전역 context 로 접속을 시작한다 — 이 시점엔 다이얼로그가 이미 닫혀 있다.
  final ctx = Get.context;
  if (ctx != null) connect(ctx, peerId);
}
