// ChainRemote 지원세션(A/S 이력) 기록 — 원격 시작/종료를 패널에 기록(Phase 2).
//
// 전역 레지스트리(peerId 키) — remote_page(시작 initState / 종료 캐치올 dispose)가 쓴다.
// closeSessionOnDispose 전역 Map 과 같은 패턴.
//
// ★기록 순서(2026-07-14 재설계): 원격을 먼저 끊고, 그 다음 메인 창에서 기록한다.
//   종전엔 종료 모달이 닫기 확인을 겸해 원격 창에서 떴는데, 폼을 적는 동안 거래처
//   배너가 "원격지원 중"으로 남아 고객이 혼란(Chang 실검증 피드백). 이제 어느 경로로
//   끊기든(창X/탭X/툴바X/거래처측 종료/네트워크 단절) dispose 캐치올이 시간 기록을
//   먼저 끝내고, 메인 창에 A/S 내용 보강 모달을 요청한다. 서버 endSession 은 ended_at
//   을 COALESCE 로 보존하므로 나중에 저장해도 원격 시간이 부풀지 않는다.
//
// ★대원칙: 전부 방어적. 어떤 실패/throw 도 원격·창닫기엔 무영향(try/catch·논블로킹).
//   서버가 미등록/내부기기면 sessionId 빈값 → 자동 스킵(기록 안 함). <15초 오접속은 discard.

import 'package:flutter/material.dart';
import '../../common.dart';
import '../../consts.dart';
import '../../models/platform_model.dart';
import '../../utils/multi_window_manager.dart';
import '../formatter/id_formatter.dart';

// A/S 종류 12종 (key → 한글 라벨). 저장은 key 콤마조인(예 "printer,payment"). 삽입순 유지.
const Map<String, String> kCrCategories = {
  'menu': '메뉴/상품',
  'table': '테이블/주문',
  'payment': '결제/VAN',
  'printer': '프린터/출력',
  'peripheral': '주변장치',
  'system': '시스템/OS',
  'network': '네트워크',
  'program': '프로그램/업데이트',
  'data': '데이터/정산',
  'setup': '설치/셋업',
  'howto': '사용법 문의',
  'etc': '기타',
};

// 처리결과 (resolution enum key → 한글). 기본 resolved.
const Map<String, String> kCrResolutions = {
  'resolved': '해결',
  'in_progress': '진행중',
  'pending': '미해결',
  'escalated': '재방문 필요',
};

// 이보다 짧은 원격(오접속/거절/즉시닫기)은 이력에 안 남기고 폐기.
const int kCrMinRecordSec = 15;

class _CrRec {
  String sessionId = '';
  Future<String>? startFuture;
  int startMs = 0;
  bool recorded = false;
}

final Map<String, _CrRec> _crRecs = {};

/// 원격 시작 시(remote_page initState) 호출 — 세션 생성 POST(논블로킹). 서버가 미등록/내부기기면
///   sessionId 빈값으로 스킵. 실패해도 무해.
void crSessionStart(String peerId) {
  try {
    final rec = _CrRec()..startMs = DateTime.now().millisecondsSinceEpoch;
    rec.startFuture = bind.chainremoteSessionStart(remoteId: peerId);
    rec.startFuture!.then((sid) {
      rec.sessionId = sid;
      return sid;
    }).catchError((_) => '');
    _crRecs[peerId] = rec;
  } catch (_) {}
}

int _elapsedSec(_CrRec rec) =>
    rec.startMs == 0 ? 0 : (DateTime.now().millisecondsSinceEpoch - rec.startMs) ~/ 1000;

/// sessionId 확보(짧은 세션 레이스: start POST 가 아직이면 잠깐 대기). 스킵/실패면 빈 문자열.
Future<String> _resolveSid(_CrRec rec) async {
  if (rec.sessionId.isNotEmpty) return rec.sessionId;
  final f = rec.startFuture;
  if (f != null) {
    try {
      rec.sessionId =
          await f.timeout(const Duration(seconds: 3), onTimeout: () => '');
    } catch (_) {}
  }
  return rec.sessionId;
}

/// 종료 캐치올(remote_page dispose) — 어느 경로로 끊기든 여기로 수렴한다.
///   <15초 discard, 아니면 시간 기록(end) 후 메인 창에 A/S 보강 모달을 요청.
///   논블로킹으로 불러도 됨(내부 await 는 자체 완결). 어떤 실패도 무해.
Future<void> crSessionEndAuto(String peerId) async {
  final rec = _crRecs[peerId];
  if (rec == null) return;
  if (rec.recorded) {
    _crRecs.remove(peerId);
    return;
  }
  rec.recorded = true;
  try {
    final sid = await _resolveSid(rec);
    if (sid.isNotEmpty) {
      final secs = _elapsedSec(rec);
      if (secs < kCrMinRecordSec) {
        await bind.chainremoteSessionDiscard(sessionId: sid);
      } else {
        // 시간 기록을 먼저 확정(원격은 이미 끊긴 뒤) — 서버가 ended_at 을 보존하므로
        // 아래 모달에서 늦게 저장해도 원격 시간은 이 시점 그대로다.
        await bind.chainremoteSessionEnd(
          sessionId: sid,
          categories: '',
          description: '',
          contactName: '',
          resolution: '',
        );
        await rustDeskWinManager
            .call(WindowType.Main, kWindowEventChainRemoteRecord, {
          'sessionId': sid,
          'peerId': peerId,
          'minutes': (secs / 60).ceil(),
        });
      }
    }
  } catch (_) {}
  _crRecs.remove(peerId);
}

/// A/S 내용 보강 모달 — 메인 창에서 호출(desktop_home_page 핸들러). 원격은 이미 종료된
/// 상태라 느긋하게 적어도 거래처엔 무영향. [저장]=내용 반영, [닫기]=시간만 유지,
/// [기록 안 함]=이력에서 삭제. 예외는 전부 삼킨다.
Future<void> showCrAnnotateModal({
  required String sessionId,
  required String peerId,
  required int minutes,
}) async {
  String name = '';
  try {
    name = bind.mainGetPeerOptionSync(id: peerId, key: 'alias');
  } catch (_) {}
  final title = name.isEmpty ? formatID(peerId) : name;

  final selected = <String>{};
  final descCtrl = TextEditingController();
  final contactCtrl = TextEditingController();
  var resolution = 'resolved';

  try {
    await gFFI.dialogManager.show<void>((setState, close, context) {
      Widget chip(String key, String label, {bool single = false}) {
        final on = single ? resolution == key : selected.contains(key);
        return FilterChip(
          label: Text(label, style: const TextStyle(fontSize: 12)),
          selected: on,
          onSelected: (v) => setState(() {
            if (single) {
              resolution = key;
            } else {
              if (v) {
                selected.add(key);
              } else {
                selected.remove(key);
              }
            }
          }),
        );
      }

      return CustomAlertDialog(
        title: Row(children: [
          const Icon(Icons.assignment_turned_in_outlined,
              color: Color(0xFF00A0E5), size: 24),
          const SizedBox(width: 8),
          Expanded(
              child:
                  Text('지원 기록 — $title', overflow: TextOverflow.ellipsis)),
        ]),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('원격 시간 약 $minutes분 · 원격은 이미 종료되었습니다.',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                const SizedBox(height: 12),
                const Text('A/S 종류 (선택)',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: kCrCategories.entries
                      .map((e) => chip(e.key, e.value))
                      .toList(),
                ),
                const SizedBox(height: 14),
                const Text('내용 (선택)',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                TextField(
                  controller: descCtrl,
                  minLines: 2,
                  maxLines: 4,
                  decoration: const InputDecoration(
                    hintText: '무엇을 처리했는지 (예: 영수증 프린터 재설정)',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 14),
                const Text('처리 결과',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  children: kCrResolutions.entries
                      .map((e) => chip(e.key, e.value, single: true))
                      .toList(),
                ),
                const SizedBox(height: 14),
                const Text('거래처측 응대자 (선택)',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                TextField(
                  controller: contactCtrl,
                  decoration: const InputDecoration(
                    hintText: '누구와 원격했는지 (예: 김점장)',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          dialogButton('기록 안 함',
              onPressed: () async {
                try {
                  await bind.chainremoteSessionDiscard(sessionId: sessionId);
                } catch (_) {}
                close(null);
              },
              isOutline: true),
          dialogButton('닫기 (시간만 저장)',
              onPressed: () => close(null), isOutline: true),
          dialogButton('저장', onPressed: () async {
            try {
              await bind.chainremoteSessionEnd(
                sessionId: sessionId,
                categories: selected.join(','),
                description: descCtrl.text.trim(),
                contactName: contactCtrl.text.trim(),
                resolution: resolution,
              );
            } catch (_) {}
            close(null);
          }),
        ],
        onCancel: () => close(null),
      );
    });
  } catch (_) {}
}
