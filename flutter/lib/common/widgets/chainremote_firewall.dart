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
// 상태 조회·상태줄 껍데기는 카드결제 쪽과 공용(같은 창구 /api/customers/watch 를 쓴다).
import 'chainremote_van.dart';

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

/// 서버가 알려준 현재 상태 한 줄 — 다이얼로그 맨 위에 둔다. 켜기/끄기 버튼만 나란히 놓으면
///   지금 어느 쪽인지 알 수 없어 "골라라" 화면이 된다(2026-08-10 Chang 지적).
///   로컬 peer 캐시를 쓰면 최근 세션 탭에서 켜 둔 곳도 "꺼짐"으로 뜬다 — 그래서 서버에 묻는다.
Widget _crFirewallStateRow(bool on) => crStateBanner(
    on ? const Color(0xFF3DDC84) : const Color(0xFF8A93AD),
    on ? Icons.check_circle_outline : Icons.radio_button_unchecked,
    on ? '지금: 자동 해제 켜짐' : '지금: 자동 해제 꺼짐');

/// HQ 우클릭 "방화벽 설정" — 거래처별 방화벽 자동 해제 켜기/끄기.
Future<void> showCrFirewallDialog(Peer peer) async {
  final name = peer.alias
      .replaceFirst('⏳ ', '')
      .replaceFirst('🆕 ', '')
      .trim();
  final label = name.isEmpty ? formatID(peer.id) : name;

  // 카드결제 쪽과 같은 이유로 서버에 현재 상태를 묻는다(로컬 캐시는 최근 세션 탭에서 빈 값).
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
    return CustomAlertDialog(
      title: Row(children: const [
        Icon(Icons.shield_outlined, color: Color(0xFF00A0E5), size: 24),
        SizedBox(width: 8),
        Expanded(child: Text('방화벽 자동 해제')),
      ]),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (state != null)
            _crFirewallStateRow(state!.firewallControl)
          else if (failed)
            crStateUnknown()
          else
            crStateLoading(),
          const SizedBox(height: 14),
          Text(
            '$label 의 Windows 방화벽을 자동으로 꺼둡니다.\n'
            '업데이트 등으로 방화벽이 다시 켜지면 에이전트가 몇 분 내 도로 끄고, '
            '방화벽 경고 알림도 안 뜨게 합니다. 메인+오더 POS 의 주문 전달·프린터 공유가 '
            '끊기지 않게 하는 설정입니다.\n\n'
            '방화벽을 꺼야 하는 거래처만 켜세요.',
            style: const TextStyle(fontSize: 13),
          ),
        ],
      ),
      // 지금 상태에서 의미 있는 쪽만 남긴다 — 눌러도 아무 일이 없는 버튼은 두지 않는다.
      //   상태를 모르는 동안(로딩·조회 실패)에는 '켜기'만 낸다. 틀린 추측으로 '끄기'를
      //   보여 주느니 조작을 한쪽으로 좁히는 편이 안전하다.
      actions: [
        dialogButton('취소', onPressed: () => close(null), isOutline: true),
        if (state != null && state!.firewallControl)
          dialogButton('자동 해제 끄기', isOutline: true, onPressed: () async {
            close(null);
            final ok = await crSetFirewallControl(peer.id, false);
            showToast(ok ? '방화벽 자동 해제를 껐습니다.' : '설정 실패 — 네트워크/로그인 확인.');
          })
        else
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
