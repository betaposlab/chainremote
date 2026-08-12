// ChainRemote 공유기 포트 열기(마이그041) — HQ 우클릭에서 거래처별 on/off.
//
// 왜 필요한가: 원격은 직결(P2P)과 서버 경유 두 갈래인데, 거래처가 공유기 뒤에 있어 바깥에서
//   들어갈 수 없으면 홀펀칭으로 통로를 뚫어야 한다. 그 홀펀칭이 **실패하는 거래처가 있다**
//   (테스트1: 양쪽 다 Cone 으로 판정되는데 구멍 주소를 받고도 접속이 안 됨). 그런 곳은
//   무조건 서버 경유가 되어 느리고 화질이 떨어지고 우리 서버 트래픽을 먹는다.
//   UPnP 는 몰래 뚫는 대신 공유기에 **"문 하나 열어 달라"고 대놓고 부탁**하는 방식이라,
//   홀펀칭이 실패해도 직결이 선다. 조사 결과 26곳 중 14곳(54%)에서 제어가 열려 있었다.
//
// ★기본은 꺼짐이고 거래처별로 켠다. 문을 열면 그 POS 가 인터넷에서 도달 가능해지는데,
//   우리는 클릭 수락 정책이라 표적 공격 시 영업 중인 매장 화면에 수락 카드가 뜰 수 있다.
//   그래서 방화벽·카드결제 관제와 같은 방식으로 골라 켠다(2026-08-12 Chang).
//
// 매핑은 임대 1시간 + 30분마다 갱신이다. 에이전트가 죽거나 PC 를 치우면 임대가 만료되며
//   공유기 쪽 문도 저절로 닫힌다 — 남의 장비에 영구 구멍을 남기지 않는다.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../common.dart';
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';
import '../formatter/id_formatter.dart';
import 'chainremote_van.dart';

const _kTimeout = Duration(seconds: 8);

/// 포트 열기 on/off — POST /api/customers/upnp. 성공 시 true.
Future<bool> crSetUpnpEnabled(String remoteId, bool enabled) async {
  try {
    final base = bind.chainremoteGetApiBase();
    final token = bind.chainremoteGetToken();
    if (base.isEmpty || token.isEmpty) return false;
    final resp = await http
        .post(
          Uri.parse('$base/api/customers/upnp'),
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'remoteId': remoteId, 'enabled': enabled}),
        )
        .timeout(_kTimeout);
    return resp.statusCode == 200;
  } catch (_) {
    return false;
  }
}

/// 현재 상태 한 줄. 켜짐/꺼짐뿐 아니라 **실제로 문이 열렸는지**까지 가른다 —
///   켰는데 공유기가 거부하는 경우가 있어서, 켜짐만 보여주면 됐다고 착각한다.
Widget _crUpnpStateRow(CrWatchState s) {
  if (!s.upnpEnabled) {
    // 안 켰더라도 이 공유기가 될 곳인지는 알려준다 — 켤지 말지 판단에 그게 필요하다.
    final hint = s.upnp == 'yes'
        ? ' (이 공유기는 지원함)'
        : s.upnp == 'no'
            ? ' (이 공유기는 UPnP 가 꺼져 있음)'
            : s.upnp == 'found'
                ? ' (공유기가 광고만 하고 명령은 거부함)'
                : '';
    return crStateBanner(const Color(0xFF8A93AD),
        Icons.radio_button_unchecked, '지금: 포트 열기 꺼짐$hint');
  }
  if (s.upnpEndpoint.isNotEmpty) {
    return crStateBanner(const Color(0xFF3DDC84), Icons.check_circle_outline,
        '지금: 포트 열림 — ${s.upnpEndpoint}');
  }
  if (s.upnp == 'no' || s.upnp == 'found') {
    return crStateBanner(const Color(0xFFFFB020), Icons.report_problem_outlined,
        '켜 뒀지만 이 공유기는 포트를 못 엽니다 — 서버 경유로 이어집니다');
  }
  // 켠 직후엔 아직 보고가 없다. 지시 전달 1회 + 결과 회신 1회라 주기의 두 배가 걸린다.
  return crStateBanner(const Color(0xFF3B9EFF), Icons.hourglass_empty,
      '지금: 포트 열기 켜짐 — 결과 보고 대기(최대 20분)');
}

/// HQ 우클릭 "공유기 포트 열기" — 거래처별 켜기/끄기.
Future<void> showCrUpnpDialog(Peer peer) async {
  final name =
      peer.alias.replaceFirst('⏳ ', '').replaceFirst('🆕 ', '').trim();
  final label = name.isEmpty ? formatID(peer.id) : name;

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

    Future<void> apply(bool enabled) async {
      close(null);
      final ok = await crSetUpnpEnabled(peer.id, enabled);
      if (!ok) {
        showToast('설정 실패 — 네트워크/로그인 확인.');
        return;
      }
      showToast(enabled
          ? '포트 열기를 켰습니다 — 다음 접속부터 직접 연결을 시도합니다.'
          : '포트 열기를 껐습니다 — 열린 문은 곧 닫힙니다.');
    }

    return CustomAlertDialog(
      title: Row(children: const [
        Icon(Icons.meeting_room_outlined, color: Color(0xFF00A0E5), size: 24),
        SizedBox(width: 8),
        Expanded(child: Text('공유기 포트 열기')),
      ]),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 10),
          if (state != null)
            _crUpnpStateRow(state!)
          else if (failed)
            crStateUnknown()
          else
            crStateLoading(),
          const SizedBox(height: 12),
          const Text(
            '거래처 공유기에 통로를 열어 본사가 곧바로 연결되게 합니다. 서버를 거치지 않아 '
            '화면과 파일이 빨라지고 회선 비용도 줄어듭니다.',
            style: TextStyle(fontSize: 12, height: 1.5),
          ),
          const SizedBox(height: 8),
          const Text(
            '켜면 그 PC 가 인터넷에서 보이게 됩니다. 통로는 1시간짜리로 걸고 계속 갱신하므로, '
            '프로그램이 꺼지면 저절로 닫힙니다.',
            style: TextStyle(fontSize: 11, color: Color(0xFF9AA3B8), height: 1.5),
          ),
        ],
      ),
      actions: [
        dialogButton('취소', onPressed: () => close(null), isOutline: true),
        dialogButton('끄기', onPressed: () => apply(false), isOutline: true),
        dialogButton('켜기', onPressed: () => apply(true)),
      ],
      onCancel: () => close(null),
    );
  });
}
