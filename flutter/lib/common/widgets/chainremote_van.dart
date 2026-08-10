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

/// 현재 관제 상태 한 줄 — 다이얼로그 맨 위에 둔다.
///   버튼만 나란히 놓으면 지금 켜져 있는지 꺼져 있는지 알 수 없어 "골라라" 화면이 된다
///   (2026-08-10 Chang 지적). 켜져 있으면 어느 VAN 인지, 데몬이 지금 성한지까지 같이 보여준다.
Widget _crVanStateRow(Peer peer) {
  final on = peer.vanWatch.isNotEmpty;
  final gaveUp = peer.vanGaveUp == 'Y';
  // 모르는 kind 면 값을 그대로 보여준다(패널이 새 VAN 을 먼저 지원하는 경우).
  var vanName = peer.vanWatch;
  for (final e in kCrVanKinds) {
    if (e.kind == peer.vanWatch) {
      vanName = e.label;
      break;
    }
  }

  late final Color color;
  late final IconData icon;
  late final String text;
  if (!on) {
    color = const Color(0xFF8A93AD);
    icon = Icons.radio_button_unchecked;
    text = '지금: 관제 꺼짐';
  } else if (gaveUp) {
    color = const Color(0xFFE5484D);
    icon = Icons.error_outline;
    text = '지금: $vanName 관제 켜짐 — 자동 복구 실패(사람 확인 필요)';
  } else if (peer.vanOk == 'N') {
    color = const Color(0xFFFFB020);
    icon = Icons.sync_problem;
    text = '지금: $vanName 관제 켜짐 — 데몬 멈춤, 복구 중';
  } else if (peer.vanOk == 'Y') {
    color = const Color(0xFF3DDC84);
    icon = Icons.check_circle_outline;
    text = '지금: $vanName 관제 켜짐 — 데몬 정상';
  } else {
    // 켜 두긴 했는데 아직 보고가 없다(방금 켰거나 기기가 꺼져 있음).
    color = const Color(0xFF3B9EFF);
    icon = Icons.hourglass_empty;
    text = '지금: $vanName 관제 켜짐 — 보고 대기';
  }

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

/// HQ 우클릭 "카드결제 데몬 관제" — 이 거래처가 쓰는 VAN 을 고르거나 관제를 끈다.
Future<void> showCrVanDialog(Peer peer) async {
  final name = peer.alias
      .replaceFirst('⏳ ', '')
      .replaceFirst('🆕 ', '')
      .trim();
  final label = name.isEmpty ? formatID(peer.id) : name;

  await gFFI.dialogManager.show<void>((setState, close, context) {
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
          _crVanStateRow(peer),
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
          ...kCrVanKinds.map((v) {
            final isCurrent = peer.vanWatch == v.kind;
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
        // 이미 꺼져 있으면 끄기가 의미 없다 — 눌러도 아무 일이 없는 버튼은 두지 않는다.
        if (peer.vanWatch.isNotEmpty)
          dialogButton('관제 끄기', isOutline: true, onPressed: () => apply('')),
      ],
      onCancel: () => close(null),
    );
  });
}
