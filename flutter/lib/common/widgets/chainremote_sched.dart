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

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../common.dart';
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
  // 기본값은 "오늘 밤 11시 ~ 내일 새벽 3시" — 가장 흔한 야간 작업 구간이다.
  var start = DateTime(now.year, now.month, now.day, 23);
  if (start.isBefore(now)) {
    // 이미 11시가 지났으면 지금부터로 잡는다(분은 버려 깔끔하게).
    start = DateTime(now.year, now.month, now.day, now.hour);
  }
  var end = start.add(const Duration(hours: 4));
  var sent = false;

  await gFFI.dialogManager.show<void>((setState, close, context) {
    final c = CrColors.of(context);

    Future<void> pick(bool isStart) async {
      final base = isStart ? start : end;
      final d = await showDatePicker(
        context: context,
        initialDate: base,
        firstDate: now.subtract(const Duration(days: 1)),
        lastDate: now.add(const Duration(days: 3)),
      );
      if (d == null) return;
      final t = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(base),
      );
      if (t == null) return;
      final picked = DateTime(d.year, d.month, d.day, t.hour, t.minute);
      setState(() {
        if (isStart) {
          start = picked;
          if (!end.isAfter(start)) end = start.add(const Duration(hours: 4));
        } else {
          end = picked;
        }
      });
    }

    final dur = end.difference(start);
    final tooLong = dur.inHours >= kSchedMaxHours;
    final invalid = !end.isAfter(start);

    Widget row(String label, DateTime v, bool isStart) => InkWell(
          onTap: () => pick(isStart),
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              border: Border.all(color: c.border),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(children: [
              SizedBox(
                width: 44,
                child: Text(label,
                    style: TextStyle(fontSize: 12, color: c.textMuted)),
              ),
              Expanded(
                child: Text(crSchedTimeLabel(v),
                    style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: c.textStrong)),
              ),
              Icon(Icons.edit_calendar_outlined, size: 16, color: c.textMuted),
            ]),
          ),
        );

    return CustomAlertDialog(
      title: Row(children: [
        Icon(Icons.schedule_rounded, color: c.accent, size: 20),
        const SizedBox(width: 8),
        Text(extend ? '예약원격 연장' : '예약원격'),
      ]),
      content: SizedBox(
        width: 380,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '$peerName 사장님께 아래 시간을 보냅니다.\n'
              '사장님이 수락하면 이 시간에는 수락 창 없이 접속됩니다.',
              style: TextStyle(fontSize: 12, color: c.textMuted, height: 1.4),
            ),
          ),
          const SizedBox(height: 14),
          row('시작', start, true),
          const SizedBox(height: 8),
          row('종료', end, false),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              invalid
                  ? '종료가 시작보다 뒤여야 합니다.'
                  : tooLong
                      ? '최대 $kSchedMaxHours시간까지만 됩니다 (지금 ${dur.inHours}시간).'
                      : '약 ${dur.inHours}시간 ${dur.inMinutes % 60}분',
              style: TextStyle(
                fontSize: 12,
                color: (invalid || tooLong) ? c.dangerFg : c.textMuted,
              ),
            ),
          ),
        ]),
      ),
      actions: [
        dialogButton('취소', onPressed: close, isOutline: true),
        dialogButton(
          extend ? '연장 요청' : '보내기',
          onPressed: (invalid || tooLong)
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

/// 세션이 끝났으니 기억을 지운다 — 다음 접속 때 거래처가 다시 알려 준다.
void crSchedForgetState(String peerId) {
  _crSchedOpenUntil.remove(peerId);
  _crSchedCloseWaiters.remove(peerId);
}

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
