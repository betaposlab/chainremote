// ChainRemote 디스크 관제(마이그024) — 거래처 카드의 여유공간 경고 배지 판정 +
// 원격 접속 없는 [디스크 정리] 명령 큐잉. 에이전트가 다음 heartbeat(≤10분)에 받아
// Temp(전 프로필+윈도우)+휴지통을 영구삭제로 비우고 결과를 보고한다.
// 조회·명령 모두 패널 API 직접 호출(토큰·apiBase 는 FFI) — 브리지 재생성 불필요.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../common.dart';
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';
import '../formatter/id_formatter.dart';

const _kTimeout = Duration(seconds: 10);

class CrDiskState {
  final double freeGb;
  final bool red; // 위험(빨강) — 주의(호박)와 구분
  final double? tempGb;
  const CrDiskState(this.freeGb, this.red, this.tempGb);
}

/// 카드 상시 표시용 — 보고만 있으면 반환. level: 2=위험(<5GB) 1=주의(<8GB) 0=정상.
/// HQ 카드는 정상도 회색으로 항상 표시한다(2026-07-16 Chang — 패널과 동일 정보량).
class CrDiskInfo {
  final double freeGb;
  final int level;
  final double? tempGb;
  const CrDiskInfo(this.freeGb, this.level, this.tempGb);
}

CrDiskInfo? crDiskInfo(Peer peer) {
  final total = int.tryParse(peer.diskTotal) ?? 0;
  final free = int.tryParse(peer.diskFree) ?? -1;
  if (total <= 0 || free < 0) return null;
  const gb = 1024 * 1024 * 1024;
  final freeGb = free / gb;
  final level = freeGb < 5
      ? 2
      : freeGb < 8
          ? 1
          : 0;
  final temp = int.tryParse(peer.tempBytes);
  return CrDiskInfo(freeGb, level, temp == null ? null : temp / gb);
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

/// 원격 [디스크 정리] 확인 다이얼로그 — 카드 우클릭 메뉴와 디스크 주의 스트립 🧹 버튼이
/// 공유한다. 확인 시 명령 큐잉(POST) → 에이전트가 다음 heartbeat(≤10분)에 실행.
Future<void> showCrDiskCleanupDialog(Peer peer) async {
  final info = crDiskInfo(peer);
  final name = peer.alias
      .replaceFirst('⏳ ', '')
      .replaceFirst('🆕 ', '')
      .trim();
  final label = name.isEmpty ? formatID(peer.id) : name;
  await gFFI.dialogManager.show<void>((setState, close, context) {
    return CustomAlertDialog(
      title: Row(children: const [
        Icon(Icons.cleaning_services_outlined,
            color: Color(0xFF00A0E5), size: 24),
        SizedBox(width: 8),
        Expanded(child: Text('디스크 정리')),
      ]),
      content: Text(
        '$label 의 Temp 폴더(전 사용자+윈도우)와 휴지통을 정리합니다.\n'
        '${info != null ? "현재 여유 ${info.freeGb.toStringAsFixed(1)}GB${info.tempGb != null ? " · Temp 약 ${info.tempGb!.toStringAsFixed(1)}GB" : ""}\n" : ""}'
        '원격 접속 없이 몇 분 내 자동 실행되고, 사용 중인 파일은 건너뜁니다.',
        style: const TextStyle(fontSize: 13),
      ),
      actions: [
        dialogButton('취소', onPressed: () => close(null), isOutline: true),
        dialogButton('정리 실행', onPressed: () async {
          close(null);
          final ok = await crRequestDiskCleanup(peer.id);
          showToast(ok
              ? '정리 명령을 보냈습니다 — 몇 분 내 실행 후 결과가 표시됩니다.'
              : '명령 전송 실패 — 네트워크/로그인을 확인하세요.');
        }),
      ],
      onCancel: () => close(null),
    );
  });
}
