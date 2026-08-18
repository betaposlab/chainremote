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
String crSchedTimeLabel(DateTime t) {
  final ampm = t.hour < 12 ? '오전' : '오후';
  var h = t.hour % 12;
  if (h == 0) h = 12;
  final m = t.minute == 0 ? '' : ' ${t.minute}분';
  return '${t.month}월 ${t.day}일 $ampm $h시$m';
}

String crSchedRangeLabel(DateTime start, DateTime end) =>
    '${crSchedTimeLabel(start)} ~ ${crSchedTimeLabel(end)}';

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

  const _CrWheel({
    required this.count,
    required this.index,
    required this.label,
    required this.onChanged,
    required this.width,
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
        if (mounted && _ctl.hasClients && _ctl.selectedItem != widget.index) {
          _ctl.jumpToItem(widget.index);
        }
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
      child: CupertinoPicker.builder(
        scrollController: _ctl,
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
        childCount: widget.count,
        itemBuilder: (ctx, i) => Center(
          child: Text(
            widget.label(i),
            style: TextStyle(fontSize: 15, color: c.textStrong),
          ),
        ),
      ),
    );
  }
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
          onChanged: (i) =>
              onChanged(rebuild(hour: ((i + 1) % 12) + (isPm ? 12 : 0))),
        ),
        unit('시'),
        _CrWheel(
          count: 60,
          index: value.minute,
          label: (i) => i.toString().padLeft(2, '0'),
          width: 46,
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
        Text(extend ? '예약원격 연장' : '예약원격'),
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
void crSchedShowResult(bool accepted) {
  // 답이 왔으면 "못 받았다" 안내를 띄울 이유가 없다. 회신보다 답이 먼저 도착할 일은
  //   거의 없지만, 그 순서로 오면 안내 두 개가 겹쳐 기사를 헷갈리게 한다.
  _crSchedAckTimer?.cancel();
  _crSchedAckTimer = null;
  if (accepted) {
    showToast('거래처가 예약원격을 수락했습니다');
  } else {
    showToast('거래처가 예약원격을 거부했습니다');
  }
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
    showToast('거래처가 요청을 받지 못했습니다 — 예약원격을 모르는 버전일 수 있습니다');
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

/// 창을 닫으라고 보낸 뒤 거래처의 확인을 기다리는 사람들.
final Map<String, Completer<bool>> _crSchedCloseWaiters = {};

/// 거래처가 알려 온 창 상태를 기록한다. 세션 이벤트 `cr_sched_state` 로 들어온다.
void crSchedNoteState(String peerId, int openUntil) {
  _crSchedOpenUntil[peerId] = openUntil;
  if (openUntil == 0) {
    // 닫기를 시켜 놓고 기다리던 쪽이 있으면 깨운다.
    _crSchedCloseWaiters.remove(peerId)?.complete(true);
  }
}

/// 이 거래처의 창이 지금 열려 있나 — 열려 있으면 종료 시각, 아니면 0.
int crSchedOpenUntilOf(String peerId) {
  final until = _crSchedOpenUntil[peerId] ?? 0;
  // 거래처 시계 기준이지만, 본사 시계로 봐도 이미 한참 지났으면 닫힌 것으로 본다.
  //   물어봐야 소용없는 창을 두고 기사에게 질문을 띄우지 않으려는 것이다.
  return until > crNowEpoch() ? until : 0;
}

/// 세션이 끝났으니 **대기 중인 기다림만** 정리한다.
///
/// ★창 자체의 기억은 지우지 않는다. 창은 세션보다 오래 살고(재부팅도 넘긴다), 목록
/// 우클릭이 [예약원격 취소] 를 내려면 붙어 있지 않을 때도 알아야 하기 때문이다. 종전엔
/// 여기서 통째로 지웠는데, 그러면 방금 예약을 걸고 세션을 닫은 직후 메뉴가 도로
/// [예약원격] 으로 돌아가 같은 예약을 두 번 걸게 된다.
void crSchedForgetState(String peerId) {
  _crSchedCloseWaiters.remove(peerId);
}

/// 이 거래처에 예약 창이 열려 있나 — 두 출처를 합쳐 본다.
///
/// ★한쪽만 보면 각각 구멍이 난다. 로컬 기억은 거래처가 [수락] 한 순간 바로 알지만 HQ 를
/// 껐다 켜거나 **다른 기사가 건 예약**은 모르고, 패널 값은 누가 걸었든 다 알지만 하트비트
/// 주기 때문에 **최대 10분 늦다**. 어느 쪽이든 열려 있다고 하면 열린 것으로 본다.
bool crSchedIsOpenFor(Peer peer) {
  if (crSchedOpenUntilOf(peer.id) > 0) return true;
  final iso = peer.schedOpenUntil;
  if (iso.isEmpty) return false;
  final t = DateTime.tryParse(iso);
  // 이미 지난 창은 닫힌 것으로 본다 — 꺼져 있던 PC 는 마지막 보고가 그대로 남아 있어,
  //   어제 닫힌 창이 오늘도 열린 것처럼 보인다. 그 PC 는 켜지는 순간 스스로 닫는다.
  return t != null && t.isAfter(DateTime.now());
}

/// 취소 요청을 이미 큐에 넣었나(패널 기준).
bool crSchedCloseRequested(Peer peer) =>
    peer.schedCloseRequestedAt.isNotEmpty;

/// 예약 창을 닫으라고 보내고 **거래처가 닫았다고 알려 올 때까지** 기다린다.
///
/// ★기다리는 이유: 보내자마자 세션을 끊으면 메시지가 나가기도 전에 연결이 죽는다.
/// 확인을 못 받으면 거짓을 돌려준다 — 닫혔는지 모르는 채로 넘어가면 실패가 성공과
/// 똑같은 모양이 되고, 기사는 닫은 줄 알지만 창은 그대로 열려 있게 된다.
Future<bool> crSchedCloseAndWait(String peerId, SessionID sessionId,
    {Duration timeout = const Duration(seconds: 3)}) async {
  final waiter = Completer<bool>();
  _crSchedCloseWaiters[peerId] = waiter;
  bind.sessionCrSchedClose(sessionId: sessionId);
  try {
    return await waiter.future.timeout(timeout);
  } catch (_) {
    return false;
  } finally {
    _crSchedCloseWaiters.remove(peerId);
  }
}

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
