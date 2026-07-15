// ChainRemote 디스크 관제(마이그024) — 거래처 카드의 여유공간 경고 배지 판정 +
// 원격 접속 없는 [디스크 정리] 명령 큐잉. 에이전트가 다음 heartbeat(≤10분)에 받아
// Temp(전 프로필+윈도우)+휴지통을 영구삭제로 비우고 결과를 보고한다.
// 조회·명령 모두 패널 API 직접 호출(토큰·apiBase 는 FFI) — 브리지 재생성 불필요.

import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';

const _kTimeout = Duration(seconds: 10);

class CrDiskState {
  final double freeGb;
  final bool red; // 위험(빨강) — 주의(호박)와 구분
  final double? tempGb;
  const CrDiskState(this.freeGb, this.red, this.tempGb);
}

/// 여유공간 경고 판정 — 위험/주의만 반환, 정상·미보고는 null(배지 생략).
/// 절대 GB 기준만(패널 _disk-chip 동일) — 32/64GB C·D 분할 포스가 많아 % 는 헛경고.
CrDiskState? crDiskWarn(Peer peer) {
  final total = int.tryParse(peer.diskTotal) ?? 0;
  final free = int.tryParse(peer.diskFree) ?? -1;
  if (total <= 0 || free < 0) return null;
  const gb = 1024 * 1024 * 1024;
  final freeGb = free / gb;
  final red = freeGb < 5;
  final amber = freeGb < 8;
  if (!red && !amber) return null;
  final temp = int.tryParse(peer.tempBytes);
  return CrDiskState(freeGb, red, temp == null ? null : temp / gb);
}

/// [디스크 정리] 명령 큐잉 — POST /api/customers/cleanup. 성공 시 true.
Future<bool> crRequestDiskCleanup(String remoteId) async {
  try {
    final base = bind.chainremoteGetApiBase();
    final token = bind.chainremoteGetToken();
    if (base.isEmpty || token.isEmpty) return false;
    final resp = await http
        .post(
          Uri.parse('$base/api/customers/cleanup'),
          headers: {
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'remoteId': remoteId}),
        )
        .timeout(_kTimeout);
    return resp.statusCode == 200;
  } catch (_) {
    return false;
  }
}
