// ChainRemote VAN 카드결제 데몬 관제(마이그036) — HQ 우클릭에서 거래처별로 VAN 을 지정한다.
//   POS 의 카드 결제는 VAN 사 데몬이 떠 있어야 성립하는데, 이게 멈추면 화면엔 아무 표시도
//   없이 카드만 안 긁힌다. 관제를 켜면 에이전트가 그 데몬의 포트를 감시하다 닫히면 되살린다.
//   거래처마다 VAN 사가 다르므로 on/off 가 아니라 "어느 VAN 인가"를 고르게 했다 — 엉뚱한
//   거래처에 켜면 있지도 않은 프로그램을 찾게 되므로 기본은 '사용 안 함'이다.
//   명령은 패널 API 직접 호출(토큰·apiBase 는 FFI) — 브리지 재생성 불필요.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../common.dart';
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';
import '../formatter/id_formatter.dart';

const _kTimeout = Duration(seconds: 8);

/// 지원 VAN 목록 — 패널 lib/van-constants.ts, 에이전트 chainremote_van.rs 와 kind 가 같아야 한다.
const List<({String kind, String label, String daemon})> kCrVanKinds = [
  (kind: 'ksnet', label: 'KSNET', daemon: 'KSCAT'),
];

/// 관제 현재 상태 — 두 다이얼로그(방화벽·카드결제)가 공용으로 쓴다.
///   HQ 최근 세션 탭의 peer 는 로컬 캐시라 관제 필드가 비어 있다. 그 빈 값을 "꺼짐"으로
///   그렸다가 켜 둔 거래처가 꺼진 것처럼 보였다(2026-08-10). 그래서 화면을 열 때 서버에
///   직접 묻고, 못 물으면 **모른다고 말한다** — 거짓 표시가 표시 없음보다 나쁘다.
class CrWatchState {
  final bool firewallControl;
  final String vanWatch; // '' = 관제 off
  final bool? vanOk; // null = 아직 보고 전
  final bool vanGaveUp;
  /// 데몬이 그 기기에 아예 없음 — 고장이 아니라 VAN 을 잘못 고른 것이다.
  final bool vanMissing;
  final int vanRestartCount;
  const CrWatchState({
    required this.firewallControl,
    required this.vanWatch,
    required this.vanOk,
    required this.vanGaveUp,
    required this.vanMissing,
    required this.vanRestartCount,
  });
}

/// GET /api/customers/watch — 실패하면 null(=모름).
Future<CrWatchState?> crFetchWatchState(String remoteId) async {
  try {
    final base = bind.chainremoteGetApiBase();
    final token = bind.chainremoteGetToken();
    if (base.isEmpty || token.isEmpty) return null;
    final resp = await http.get(
      Uri.parse('$base/api/customers/watch?remoteId=$remoteId'),
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(_kTimeout);
    if (resp.statusCode != 200) return null;
    final j = jsonDecode(utf8.decode(resp.bodyBytes)) as Map<String, dynamic>;
    return CrWatchState(
      firewallControl: j['firewallControl'] == true,
      vanWatch: (j['vanWatch'] as String?) ?? '',
      vanOk: j['vanOk'] is bool ? j['vanOk'] as bool : null,
      vanGaveUp: j['vanGaveUp'] == true,
      vanMissing: j['vanMissing'] == true,
      vanRestartCount:
          j['vanRestartCount'] is int ? j['vanRestartCount'] as int : 0,
    );
  } catch (_) {
    return null;
  }
}

/// 상태 줄 공용 껍데기 — 색/아이콘/문구만 갈아 끼운다.
Widget crStateBanner(Color color, IconData icon, String text) {
  return Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
    decoration: BoxDecoration(
      color: color.withOpacity(0.10),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: color.withOpacity(0.35)),
    ),
    child: Row(children: [
      Icon(icon, size: 17, color: color),
      const SizedBox(width: 8),
      Expanded(
        child: Text(text,
            style: TextStyle(
                fontSize: 12.5, fontWeight: FontWeight.w600, color: color)),
      ),
    ]),
  );
}

/// 아직 물어보는 중 / 못 물어본 경우의 상태 줄. 어느 쪽으로도 단정하지 않는다.
Widget crStateLoading() => crStateBanner(
    const Color(0xFF8A93AD), Icons.hourglass_empty, '지금 상태 확인 중...');
Widget crStateUnknown() => crStateBanner(const Color(0xFFFFB020),
    Icons.help_outline, '상태를 불러오지 못했습니다 — 네트워크/로그인 확인');

/// 관제 VAN 설정 — POST /api/customers/van. kind='' 면 관제 해제. 성공 시 true.
Future<bool> crSetVanWatch(String remoteId, String kind) async {
  try {
    final base = bind.chainremoteGetApiBase();
    final token = bind.chainremoteGetToken();
    if (base.isEmpty || token.isEmpty) return false;
    final resp = await http
        .post(
          Uri.parse('$base/api/customers/van'),
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'remoteId': remoteId, 'kind': kind}),
        )
        .timeout(_kTimeout);
    return resp.statusCode == 200;
  } catch (_) {
    return false;
  }
}

/// 서버가 알려준 현재 상태 한 줄. 켜짐/꺼짐뿐 아니라 데몬이 지금 성한지까지 색으로 가른다.
Widget _crVanStateRow(CrWatchState s) {
  if (s.vanWatch.isEmpty) {
    return crStateBanner(
        const Color(0xFF8A93AD), Icons.radio_button_unchecked, '지금: 관제 꺼짐');
  }
  // 모르는 kind 면 값을 그대로 보여준다(패널이 새 VAN 을 먼저 지원하는 경우).
  var vanName = s.vanWatch;
  for (final e in kCrVanKinds) {
    if (e.kind == s.vanWatch) {
      vanName = e.label;
      break;
    }
  }
  final tail = s.vanRestartCount > 0 ? ' · 되살림 ${s.vanRestartCount}회' : '';
  // 데몬이 없는 건 고장이 아니라 설정 실수 — 사람을 부르지 말고 관제를 끄라고 말해야 한다.
  if (s.vanMissing) {
    return crStateBanner(const Color(0xFFFFB020), Icons.report_problem_outlined,
        '이 기기에 $vanName 데몬이 없습니다 — 다른 VAN 을 쓰는 거래처 같습니다');
  }
  if (s.vanGaveUp) {
    return crStateBanner(const Color(0xFFE5484D), Icons.error_outline,
        '지금: $vanName 관제 켜짐 — 자동 복구 실패(사람 확인 필요)$tail');
  }
  if (s.vanOk == false) {
    return crStateBanner(const Color(0xFFFFB020), Icons.sync_problem,
        '지금: $vanName 관제 켜짐 — 데몬 멈춤, 복구 중$tail');
  }
  if (s.vanOk == true) {
    return crStateBanner(const Color(0xFF3DDC84), Icons.check_circle_outline,
        '지금: $vanName 관제 켜짐 — 데몬 정상$tail');
  }
  // 켜 두긴 했는데 아직 보고가 없다(방금 켰거나 기기가 꺼져 있음).
  //   ★"최대 20분"을 반드시 같이 쓴다 — 지시 전달 1회 + 결과 회신 1회라 하트비트 주기(10분)의
  //   두 배가 걸린다. 그 말이 없으면 고장으로 읽혀 실제로 20분을 "반응이 없네" 하며 기다렸다.
  return crStateBanner(const Color(0xFF3B9EFF), Icons.hourglass_empty,
      '지금: $vanName 관제 켜짐 — 보고 대기(최대 20분)$tail');
}

/// HQ 우클릭 "카드결제 데몬 관제" — 이 거래처가 쓰는 VAN 을 고르거나 관제를 끈다.
Future<void> showCrVanDialog(Peer peer) async {
  final name = peer.alias
      .replaceFirst('⏳ ', '')
      .replaceFirst('🆕 ', '')
      .trim();
  final label = name.isEmpty ? formatID(peer.id) : name;

  // 서버에 현재 상태를 한 번 묻는다. 화면을 그리는 동안 오므로 setState 로 갈아 끼운다.
  //   started 로 최초 1회만 — build 는 여러 번 불린다.
  CrWatchState? state;
  var started = false;
  var failed = false;

  await gFFI.dialogManager.show<void>((setState, close, context) {
    if (!started) {
      started = true;
      crFetchWatchState(peer.id).then((s) {
        state = s;
        failed = s == null;
        setState(() {});
      });
    }

    Future<void> apply(String kind) async {
      close(null);
      final ok = await crSetVanWatch(peer.id, kind);
      if (!ok) {
        showToast('설정 실패 — 네트워크/로그인 확인.');
        return;
      }
      if (kind.isEmpty) {
        showToast('카드결제 데몬 관제를 껐습니다.');
      } else {
        final v = kCrVanKinds.firstWhere((e) => e.kind == kind);
        showToast('${v.label} 데몬 관제를 켰습니다 — 멈추면 자동으로 되살립니다.');
      }
    }

    return CustomAlertDialog(
      title: Row(children: const [
        Icon(Icons.credit_card, color: Color(0xFF00A0E5), size: 24),
        SizedBox(width: 8),
        Expanded(child: Text('카드결제 데몬 관제')),
      ]),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (state != null)
            _crVanStateRow(state!)
          else if (failed)
            crStateUnknown()
          else
            crStateLoading(),
          const SizedBox(height: 14),
          Text(
            '$label 의 카드결제 데몬이 멈추면 에이전트가 자동으로 되살립니다.\n'
            '데몬이 멈춰도 화면엔 아무 표시가 없어, 손님이 카드를 내밀고 나서야 '
            '알게 되는 고장입니다.\n\n'
            '이 거래처가 쓰는 VAN 사를 고르세요. 다른 VAN 을 고르면 있지도 않은 '
            '프로그램을 찾게 되니, 확실한 곳만 켜시면 됩니다.',
            style: const TextStyle(fontSize: 13),
          ),
          const SizedBox(height: 14),
          // VAN 이 하나뿐이라 지금은 버튼 한 줄이다. 늘어나면 여기만 자란다.
          //   지금 켜져 있는 VAN 은 눌러도 달라질 게 없으니 비활성 + '켜져 있음'으로 바꿔,
          //   상단 상태줄과 함께 두 번 알려 준다.
          //   상태를 모르는 동안(로딩·조회 실패)에는 아무 버튼도 잠그지 않는다 — 틀린 추측으로
          //   막느니 눌러 보게 두는 편이 낫다.
          ...kCrVanKinds.map((v) {
            final isCurrent = state?.vanWatch == v.kind;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: Icon(
                      isCurrent
                          ? Icons.check_circle
                          : Icons.check_circle_outline,
                      size: 18),
                  label: Text(isCurrent
                      ? '${v.label} 관제 켜져 있음  (${v.daemon})'
                      : '${v.label} 관제 켜기  (${v.daemon})'),
                  onPressed: isCurrent ? null : () => apply(v.kind),
                ),
              ),
            );
          }),
        ],
      ),
      actions: [
        dialogButton('취소', onPressed: () => close(null), isOutline: true),
        // 켜져 있는 게 확인됐을 때만 '끄기'를 낸다. 상태를 모르는 동안에는 숨긴다 —
        // 꺼져 있는 걸 또 끄는 버튼은 혼란만 준다.
        if (state != null && state!.vanWatch.isNotEmpty)
          dialogButton('관제 끄기', isOutline: true, onPressed: () => apply('')),
      ],
      onCancel: () => close(null),
    );
  });
}
