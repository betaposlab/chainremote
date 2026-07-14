// ChainRemote 지원세션(A/S 이력) 기록 — 원격 시작/종료를 패널에 기록(Phase 2).
//
// 전역 레지스트리(peerId 키) — remote_page(시작 initState / 종료 캐치올 dispose)와
// remote_tab_page(종료 모달)가 공유한다. closeSessionOnDispose 전역 Map 과 같은 패턴.
//
// ★대원칙: 전부 방어적. 어떤 실패/throw 도 원격·창닫기엔 무영향(try/catch·논블로킹).
//   서버가 미등록/내부기기면 sessionId 빈값 → 자동 스킵(기록 안 함). <15초 오접속은 discard.

import 'package:flutter/material.dart';
import '../../common.dart';
import '../../models/platform_model.dart';

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

/// 종료 캐치올(remote_page dispose) — 모달이 먼저 기록했으면 skip. <15초 discard, 아니면 시간만 end.
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
      if (_elapsedSec(rec) < kCrMinRecordSec) {
        await bind.chainremoteSessionDiscard(sessionId: sid);
      } else {
        await bind.chainremoteSessionEnd(
          sessionId: sid,
          categories: '',
          description: '',
          contactName: '',
          resolution: '',
        );
      }
    }
  } catch (_) {}
  _crRecs.remove(peerId);
}

/// 종료 A/S 모달 — 사용자 닫기 경로(창X/탭X)에서 호출. 창이 아직 살아있을 때.
/// 반환:
///   null  = A/S 대상 아님(내부기기/미등록/짧은세션) → 호출측이 기존 확인창으로 폴백.
///   true  = 사용자가 닫기 진행 선택(저장/빠른저장/기록안함 — 기록 처리 완료).
///   false = 사용자가 취소(닫지 말 것).
/// ★모달 자체가 "닫기 확인 + A/S 기록"을 겸한다(연결 끊김 경고 포함). 예외는 전부 삼켜
///   호출측(닫기)이 안 막히게 한다.
Future<bool?> showCrEndModalAndRecord(String peerId) async {
  final rec = _crRecs[peerId];
  if (rec == null || rec.recorded) return null;
  String sid;
  try {
    sid = await _resolveSid(rec);
  } catch (_) {
    return null;
  }
  if (sid.isEmpty) return null; // 스킵 세션 → 폴백
  if (_elapsedSec(rec) < kCrMinRecordSec) return null; // 짧은 세션 → 폴백(auto discard)

  final selected = <String>{};
  final descCtrl = TextEditingController();
  final contactCtrl = TextEditingController();
  var resolution = 'resolved';
  final mins = (_elapsedSec(rec) / 60).ceil();

  bool proceed = false; // 닫기 진행 여부

  Future<void> record({required bool withFields, required bool discard}) async {
    rec.recorded = true;
    _crRecs.remove(peerId);
    proceed = true;
    try {
      if (discard) {
        await bind.chainremoteSessionDiscard(sessionId: sid);
      } else {
        await bind.chainremoteSessionEnd(
          sessionId: sid,
          categories: withFields ? selected.join(',') : '',
          description: withFields ? descCtrl.text.trim() : '',
          contactName: withFields ? contactCtrl.text.trim() : '',
          resolution: withFields ? resolution : '',
        );
      }
    } catch (_) {}
  }

  try {
    await gFFI.dialogManager.show<void>((setState, close, context) {
      Widget chip(String key, String label, Set<String> set, {bool single = false}) {
        final on = single ? resolution == key : set.contains(key);
        return FilterChip(
          label: Text(label, style: const TextStyle(fontSize: 12)),
          selected: on,
          onSelected: (v) => setState(() {
            if (single) {
              resolution = key;
            } else {
              if (v) {
                set.add(key);
              } else {
                set.remove(key);
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
          const Expanded(child: Text('지원 기록')),
        ]),
        content: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('원격 시간 약 $mins분 · 원격을 종료합니다 (거래처 연결이 끊깁니다).',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280))),
                const SizedBox(height: 12),
                const Text('A/S 종류 (선택)',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: kCrCategories.entries
                      .map((e) => chip(e.key, e.value, selected))
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
                      .map((e) => chip(e.key, e.value, selected, single: true))
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
          dialogButton('취소', onPressed: () => close(null), isOutline: true),
          dialogButton('기록 안 함',
              onPressed: () async {
                await record(withFields: false, discard: true);
                close(null);
              },
              isOutline: true),
          dialogButton('시간만 저장',
              onPressed: () async {
                await record(withFields: false, discard: false);
                close(null);
              },
              isOutline: true),
          dialogButton('저장', onPressed: () async {
            await record(withFields: true, discard: false);
            close(null);
          }),
        ],
        onCancel: () => close(null),
      );
    });
  } catch (_) {
    // 모달 실패해도 닫기는 진행 — 기록은 dispose 캐치올(crSessionEndAuto)이 시간만 남긴다.
    return true;
  }
  return proceed ? true : false;
}
