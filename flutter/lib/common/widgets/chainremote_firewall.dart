// ChainRemote 방화벽 자동 해제 관제(마이그028) — HQ 우클릭에서 거래처별 on/off.
//   control=on 이면 에이전트가 로컬에서 방화벽을 감시하다 켜지면 즉시 해제(+경고 알림 끔).
//   메인+오더 POS 구성에서 Windows 업데이트가 방화벽을 되살려 주문 전달·프린터 공유가
//   끊기는 걸 막는다(카드 승인은 COM 직결+아웃바운드라 무관). 기본 off — 방화벽 꺼야 하는
//   거래처만 켠다. 명령은 패널 API 직접 호출(토큰·apiBase 는 FFI) — 브리지 재생성 불필요.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../common.dart';
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';
import '../formatter/id_formatter.dart';

const _kTimeout = Duration(seconds: 8);

/// 방화벽 자동 해제 on/off — POST /api/customers/firewall. 성공 시 true.
Future<bool> crSetFirewallControl(String remoteId, bool control) async {
  try {
    final base = bind.chainremoteGetApiBase();
    final token = bind.chainremoteGetToken();
    if (base.isEmpty || token.isEmpty) return false;
    final resp = await http
        .post(
          Uri.parse('$base/api/customers/firewall'),
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'remoteId': remoteId, 'control': control}),
        )
        .timeout(_kTimeout);
    return resp.statusCode == 200;
  } catch (_) {
    return false;
  }
}

/// HQ 우클릭 "방화벽 설정" — 거래처별 방화벽 자동 해제 켜기/끄기.
Future<void> showCrFirewallDialog(Peer peer) async {
  final name = peer.alias
      .replaceFirst('⏳ ', '')
      .replaceFirst('🆕 ', '')
      .trim();
  final label = name.isEmpty ? formatID(peer.id) : name;
  await gFFI.dialogManager.show<void>((setState, close, context) {
    return CustomAlertDialog(
      title: Row(children: const [
        Icon(Icons.shield_outlined, color: Color(0xFF00A0E5), size: 24),
        SizedBox(width: 8),
        Expanded(child: Text('방화벽 자동 해제')),
      ]),
      content: Text(
        '$label 의 Windows 방화벽을 자동으로 꺼둡니다.\n'
        '업데이트 등으로 방화벽이 다시 켜지면 에이전트가 몇 분 내 도로 끄고, '
        '방화벽 경고 알림도 안 뜨게 합니다. 메인+오더 POS 의 주문 전달·프린터 공유가 '
        '끊기지 않게 하는 설정입니다.\n\n'
        '방화벽을 꺼야 하는 거래처만 켜세요.',
        style: const TextStyle(fontSize: 13),
      ),
      actions: [
        dialogButton('취소', onPressed: () => close(null), isOutline: true),
        dialogButton('자동 해제 끄기', isOutline: true, onPressed: () async {
          close(null);
          final ok = await crSetFirewallControl(peer.id, false);
          showToast(ok ? '방화벽 자동 해제를 껐습니다.' : '설정 실패 — 네트워크/로그인 확인.');
        }),
        dialogButton('자동 해제 켜기', onPressed: () async {
          close(null);
          final ok = await crSetFirewallControl(peer.id, true);
          showToast(ok
              ? '방화벽 자동 해제를 켰습니다 — 방화벽이 켜지면 자동으로 꺼집니다.'
              : '설정 실패 — 네트워크/로그인 확인.');
        }),
      ],
      onCancel: () => close(null),
    );
  });
}
