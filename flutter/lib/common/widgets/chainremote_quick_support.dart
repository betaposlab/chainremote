// 임시 접속 대기 — 아직 우리 에이전트가 없는 거래처가 626.kr 초록 버튼으로 켠 임시 원격.
//
// 종전엔 거래처가 RustDesk 창의 숫자 9자리와 영문 섞인 비밀번호 6자를 전화로 불러 줬다.
// 이제 거래처는 숫자판에 우리 번호만 누르고, 받은 파일이 스스로 ID 를 서버에 알린다
// (패널 lib/quick-support.ts). 여기서는 그 목록을 받아 홈에 띄운다 — 누르면 붙고,
// 거래처는 [수락] 만 누른다. 비밀번호 창이 뜨면 아무것도 넣지 말고 수락을 기다리면 된다.
//
// ★폴링이 짧다(8초). 전화기를 든 채 "눌렀어요" 를 듣고 기다리는 화면이라 60초 주기로는
//   통화가 어색해진다. 목록이 비어 있을 때의 비용은 작은 GET 하나다.

import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import '../../common.dart';
import '../../models/platform_model.dart';
import '../formatter/id_formatter.dart';

const _kTimeout = Duration(seconds: 8);
const _kPoll = Duration(seconds: 8);

class CrQuickWaiting {
  final String remoteId;
  final String hostname;
  final String os;
  CrQuickWaiting(this.remoteId, this.hostname, this.os);
}

/// 지금 켜져 있고 아직 아무도 안 붙은 임시 원격.
final RxList<CrQuickWaiting> crQuickWaiting = <CrQuickWaiting>[].obs;

/// 우리 대리점 번호 — 거래처에게 불러 줄 숫자. 못 받았으면 빈 문자열.
final RxString crQuickCode = ''.obs;

Future<void> crRefreshQuickSupport() async {
  try {
    final base = bind.chainremoteGetApiBase();
    final token = bind.chainremoteGetToken();
    if (base.isEmpty || token.isEmpty) {
      if (crQuickWaiting.isNotEmpty) crQuickWaiting.clear();
      return;
    }
    final resp = await http.get(
      Uri.parse('$base/api/quick-support/waiting'),
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(_kTimeout);
    // 옛 패널(이 주소가 없음)·권한 문제는 조용히 넘어간다 — 홈 화면에 오류를 띄울 일이 아니다.
    if (resp.statusCode != 200) return;
    final j = jsonDecode(utf8.decode(resp.bodyBytes));
    if (j is! Map) return;
    final code = j['code'];
    crQuickCode.value = code is String ? code : '';
    final list = <CrQuickWaiting>[];
    final raw = j['waiting'];
    if (raw is List) {
      for (final e in raw) {
        if (e is! Map) continue;
        final id = e['remoteId'];
        if (id is! String || id.isEmpty) continue;
        list.add(CrQuickWaiting(
          id,
          e['hostname'] is String ? e['hostname'] as String : '',
          e['os'] is String ? e['os'] as String : '',
        ));
      }
    }
    // 같은 내용이면 건드리지 않는다 — 8초마다 스트립이 깜빡이지 않게.
    final same = list.length == crQuickWaiting.length &&
        List.generate(list.length, (i) => i)
            .every((i) => list[i].remoteId == crQuickWaiting[i].remoteId);
    if (!same) crQuickWaiting.assignAll(list);
  } catch (_) {
    // 네트워크 순단. 다음 주기에 다시 본다.
  }
}

/// "Windows 10 Pro" 처럼 짧게. 상류가 보내는 값은 "windows / Windows 10 Pro - 10.0.19045" 꼴이다.
String _shortOs(String os) {
  var s = os;
  final slash = s.indexOf('/');
  if (slash >= 0) s = s.substring(slash + 1);
  final dash = s.indexOf(' - ');
  if (dash >= 0) s = s.substring(0, dash);
  return s.trim();
}

/// 홈 목록 위의 초록 줄. 대기가 없으면 아무것도 그리지 않는다.
class CrQuickSupportStrip extends StatefulWidget {
  const CrQuickSupportStrip({Key? key}) : super(key: key);

  @override
  State<CrQuickSupportStrip> createState() => _CrQuickSupportStripState();
}

class _CrQuickSupportStripState extends State<CrQuickSupportStrip> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    crRefreshQuickSupport();
    _timer = Timer.periodic(_kPoll, (_) {
      if (mounted) crRefreshQuickSupport();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      // 관찰값은 식 밖에서 먼저 읽는다(Obx 단락 평가 → 릴리즈 회색 상자 사고).
      final waiting = crQuickWaiting.toList();
      final code = crQuickCode.value;
      final c = CrColors.of(context);
      if (waiting.isEmpty) {
        // 대기가 없을 때는 번호만 흐리게 — 전화를 받자마자 불러 줄 숫자라 찾으러 가게 두지 않는다.
        if (code.isEmpty) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(right: 14, bottom: 2),
          child: Align(
            alignment: Alignment.centerRight,
            child: Text('설치 전 거래처: 626.kr → 원격지원 받기 → 번호 $code',
                style: TextStyle(fontSize: 11, color: c.neuSub)),
          ),
        );
      }
      return Container(
        width: double.infinity,
        margin: const EdgeInsets.only(right: 12, bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: c.okBg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: c.okDot),
        ),
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('🟢 임시 접속 대기 ${waiting.length}곳',
                style: TextStyle(
                    fontSize: 12, fontWeight: FontWeight.w700, color: c.okFg)),
            ...waiting.map((w) {
              final os = _shortOs(w.os);
              final label = [
                if (w.hostname.isNotEmpty) w.hostname,
                if (os.isNotEmpty) os,
                formatID(w.remoteId),
              ].join(' · ');
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(label,
                      style: TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: c.okFg)),
                  const SizedBox(width: 6),
                  SizedBox(
                    height: 24,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: c.accentFill,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(horizontal: 10),
                        textStyle: const TextStyle(
                            fontSize: 11.5, fontWeight: FontWeight.w700),
                      ),
                      onPressed: () => connect(context, w.remoteId),
                      child: const Text('접속'),
                    ),
                  ),
                ],
              );
            }),
            Text('비밀번호 창이 뜨면 그대로 두고, 거래처가 [수락] 을 누르면 연결됩니다.',
                style: TextStyle(fontSize: 11, color: c.okFg)),
          ],
        ),
      );
    });
  }
}
