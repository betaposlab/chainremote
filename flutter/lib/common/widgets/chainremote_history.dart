// ChainRemote 지원기록(A/S 이력) 조회 뷰 (Phase 3, 읽기 전용).
//
// 기록 자체는 chainremote_session_record.dart 가 남긴다. 이 파일은 그걸 보여주기만 한다.
//   • 거래처 카드 "지원 이력"  → showCrHistoryDialog(remoteId: peerId)  (그 거래처만)
//   • 홈 "지원 기록" 버튼       → showCrHistoryDialog()                  (전체 타임라인)
//
// 조회는 패널 API 를 Flutter 가 직접 친다(토큰·apiBase 는 Rust FFI 로 획득 = 창간 공유).
//   GET {apiBase}/api/sessions/recent?limit=&remoteId=  (Bearer)
// ★읽기 전용이라 저위험. 실패해도 빈 목록/토스트로 끝(원격·앱 무영향).

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../common.dart';
import '../../models/platform_model.dart';
import 'chainremote_session_record.dart'; // kCrCategories, kCrResolutions

const _kFetchTimeout = Duration(seconds: 10);

/// 지원세션 1건 (패널 /api/sessions/recent 행 파싱).
class CrSession {
  final String customerName;
  final String remoteId;
  final DateTime? startedAt;
  final DateTime? endedAt;
  final int durationSec;
  final List<String> categories; // key 리스트 (kCrCategories)
  final String description;
  final String contactName; // 거래처측 응대자
  final String operatorName; // 우리측 담당자
  final String resolution; // key (kCrResolutions)

  CrSession({
    required this.customerName,
    required this.remoteId,
    required this.startedAt,
    required this.endedAt,
    required this.durationSec,
    required this.categories,
    required this.description,
    required this.contactName,
    required this.operatorName,
    required this.resolution,
  });

  factory CrSession.fromJson(Map<String, dynamic> j) {
    final s = (j['session'] as Map?)?.cast<String, dynamic>() ?? {};
    final c = (j['customer'] as Map?)?.cast<String, dynamic>();
    DateTime? dt(dynamic v) {
      if (v == null) return null;
      return DateTime.tryParse(v.toString());
    }

    final cats = (s['categories'] ?? '').toString();
    return CrSession(
      customerName: (c?['name'] ?? '').toString(),
      remoteId: (c?['remoteId'] ?? s['remoteId'] ?? '').toString(),
      startedAt: dt(s['startedAt']),
      endedAt: dt(s['endedAt']),
      durationSec: (s['durationSec'] is num)
          ? (s['durationSec'] as num).toInt()
          : 0,
      categories:
          cats.isEmpty ? const [] : cats.split(',').where((e) => e.isNotEmpty).toList(),
      description: (s['description'] ?? '').toString(),
      contactName: (s['contactName'] ?? '').toString(),
      operatorName: (j['operatorName'] ?? '').toString(),
      resolution: (s['resolution'] ?? '').toString(),
    );
  }
}

/// 패널에서 지원기록을 받아온다. remoteId 주면 그 거래처만. 실패 시 빈 목록.
Future<List<CrSession>> fetchCrSessions({String? remoteId, int limit = 100}) async {
  try {
    final base = bind.chainremoteGetApiBase();
    final token = bind.chainremoteGetToken();
    if (base.isEmpty || token.isEmpty) return [];
    var url = '$base/api/sessions/recent?limit=$limit';
    if (remoteId != null && remoteId.isNotEmpty) {
      url += '&remoteId=${Uri.encodeQueryComponent(remoteId)}';
    }
    final resp = await http.get(
      Uri.parse(url),
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(_kFetchTimeout);
    if (resp.statusCode != 200) return [];
    final body = jsonDecode(resp.body) as Map<String, dynamic>;
    final list = (body['sessions'] as List?) ?? const [];
    return list
        .whereType<Map>()
        .map((e) => CrSession.fromJson(e.cast<String, dynamic>()))
        .toList();
  } catch (_) {
    return [];
  }
}

String _fmtDateTime(DateTime? d) {
  if (d == null) return '';
  final l = d.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${l.year}.${two(l.month)}.${two(l.day)} ${two(l.hour)}:${two(l.minute)}';
}

String _fmtDuration(int sec) {
  if (sec <= 0) return '';
  final m = sec ~/ 60;
  if (m < 1) return '$sec초';
  if (m < 60) return '$m분';
  return '${m ~/ 60}시간 ${m % 60}분';
}

Color _resolutionColor(String key) {
  switch (key) {
    case 'resolved':
      return const Color(0xFF16A34A); // green
    case 'in_progress':
      return const Color(0xFF2563EB); // blue
    case 'pending':
      return const Color(0xFFEA580C); // orange
    case 'escalated':
      return const Color(0xFFDC2626); // red
    default:
      return const Color(0xFF9CA3AF); // gray
  }
}

Widget _sessionTile(CrSession s, {required bool showCustomer}) {
  final chips = <Widget>[];
  for (final k in s.categories) {
    final label = kCrCategories[k];
    if (label == null) continue;
    chips.add(Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFF00A0E5).withOpacity(0.10),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label,
          style: const TextStyle(fontSize: 11, color: Color(0xFF0284C7))),
    ));
  }

  final meta = <String>[];
  if (s.contactName.isNotEmpty) meta.add('응대 ${s.contactName}');
  if (s.operatorName.isNotEmpty) meta.add('담당 ${s.operatorName}');

  final resLabel = kCrResolutions[s.resolution];

  return Container(
    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                showCustomer && s.customerName.isNotEmpty
                    ? s.customerName
                    : _fmtDateTime(s.startedAt),
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (resLabel != null)
              Container(
                margin: const EdgeInsets.only(left: 6),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: _resolutionColor(s.resolution).withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(resLabel,
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: _resolutionColor(s.resolution))),
              ),
          ],
        ),
        const SizedBox(height: 3),
        Text(
          [
            if (showCustomer && s.customerName.isNotEmpty)
              _fmtDateTime(s.startedAt),
            if (_fmtDuration(s.durationSec).isNotEmpty)
              _fmtDuration(s.durationSec),
          ].join(' · '),
          style: const TextStyle(fontSize: 11, color: Color(0xFF6B7280)),
        ),
        if (chips.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(spacing: 4, runSpacing: 4, children: chips),
        ],
        if (s.description.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(s.description,
              style: const TextStyle(fontSize: 12, color: Color(0xFF374151))),
        ],
        if (meta.isNotEmpty) ...[
          const SizedBox(height: 5),
          Text(meta.join('  ·  '),
              style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
        ],
      ],
    ),
  );
}

/// 지원기록 다이얼로그. remoteId 주면 그 거래처만, 없으면 전체 타임라인.
Future<void> showCrHistoryDialog(
  BuildContext context, {
  String? remoteId,
  String? title,
}) async {
  final perCustomer = remoteId != null && remoteId.isNotEmpty;
  final future = fetchCrSessions(remoteId: remoteId);
  final heading = title ?? (perCustomer ? '지원 이력' : '전체 지원 기록');

  await gFFI.dialogManager.show<void>((setState, close, context) {
    return CustomAlertDialog(
      title: Row(children: [
        const Icon(Icons.history, color: Color(0xFF00A0E5), size: 22),
        const SizedBox(width: 8),
        Expanded(
            child: Text(heading, overflow: TextOverflow.ellipsis)),
      ]),
      content: SizedBox(
        width: 560,
        height: 460,
        child: FutureBuilder<List<CrSession>>(
          future: future,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            final list = snap.data ?? const <CrSession>[];
            if (list.isEmpty) {
              return const Center(
                child: Text('지원 기록이 없습니다.',
                    style: TextStyle(color: Color(0xFF9CA3AF))),
              );
            }
            return ListView.separated(
              itemCount: list.length,
              separatorBuilder: (_, __) =>
                  const Divider(height: 1, color: Color(0x11000000)),
              itemBuilder: (_, i) =>
                  _sessionTile(list[i], showCustomer: !perCustomer),
            );
          },
        ),
      ),
      actions: [dialogButton('닫기', onPressed: close)],
      onCancel: close,
    );
  });
}
