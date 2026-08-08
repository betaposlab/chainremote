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

// "라벨: 값" 한 줄 — 항목이 뭔지 제목을 달아 나열식 혼동을 없앤다(2026-07-14 Chang 피드백).
Widget _labelRow(String label, Widget value) {
  return Padding(
    padding: const EdgeInsets.only(top: 5),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 62,
          // 라벨은 보조 정보다. 이 회색은 밝은 배경에서도 어두운 배경에서도 값보다
          //   한 단계 물러나 보이므로 양쪽에서 그대로 쓴다.
          child: Text(label,
              style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF))),
        ),
        Expanded(child: value),
      ],
    ),
  );
}

/// 라벨 + 값 한 줄.
///
/// ★값 색을 테마에 따라 가른다. 종전엔 밝은 배경 기준 진회색(#374151)이 박혀 있어,
///   다크에서 카드 배경(#262D38)과 거의 같은 밝기가 됐다 — 라벨은 보이는데 정작 읽어야 할
///   값이 묻혀 주·보조가 뒤집혔다. 특히 '내용'이 가장 안 읽혔다(2026-08-08 Chang 지적).
Widget _labelTextRow(BuildContext context, String label, String text) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  return _labelRow(
      label,
      Text(text,
          style: TextStyle(
              fontSize: 12,
              color: isDark ? const Color(0xFFEEF1F7) : const Color(0xFF374151))));
}

Widget _sessionTile(BuildContext context, CrSession s,
    {required bool showCustomer}) {
  final isDark = Theme.of(context).brightness == Brightness.dark;
  final chips = <Widget>[];
  for (final k in s.categories) {
    final label = kCrCategories[k];
    if (label == null) continue;
    chips.add(Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFF00A0E5).withOpacity(0.12),
        borderRadius: BorderRadius.circular(4),
      ),
      // 브랜드 하늘색 계열이되 배경 밝기에 맞춰 고른다. 진한 쪽(#0284C7)은 어두운 카드
      //   위에서 대비가 떨어져 칩이 뭉개진다 — 값 색과 같은 갈래의 문제다.
      child: Text(label,
          style: TextStyle(
              fontSize: 11,
              color: isDark ? const Color(0xFF7DD3FC) : const Color(0xFF0284C7))),
    ));
  }

  // 상태 배지: 실제로 안 끝난 세션(ended_at 없음)만 "진행중". 끝난 세션은 명시적 처리결과
  //   (해결/미해결/재방문)만 표시하고, 시간만 저장(생성 기본값 in_progress)은 배지 없음.
  final ended = s.endedAt != null;
  String? resLabel;
  String resKey = s.resolution;
  if (!ended) {
    resLabel = '진행중';
    resKey = 'in_progress';
  } else if (s.resolution == 'resolved' ||
      s.resolution == 'pending' ||
      s.resolution == 'escalated') {
    resLabel = kCrResolutions[s.resolution];
  } else {
    resLabel = null; // 끝났지만 처리결과 미지정(시간만 저장) → 배지 없음
  }

  // 거래처 이니셜 원형 아바타 (전체 뷰 헤더용) — 홈 거래처 카드와 같은 무드.
  final headText = showCustomer && s.customerName.isNotEmpty
      ? s.customerName
      : _fmtDateTime(s.startedAt);
  final initial = headText.isEmpty ? '?' : headText.characters.first;

  return Container(
    margin: const EdgeInsets.only(bottom: 8),
    padding: const EdgeInsets.fromLTRB(12, 10, 12, 11),
    decoration: BoxDecoration(
      color: isDark ? const Color(0xFF262D38) : const Color(0xFFF8FAFC),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(
          color: isDark ? const Color(0x22FFFFFF) : const Color(0xFFE5E7EB)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 헤더: 아바타 + 거래처명(전체 뷰) 또는 일시 + 처리결과 배지.
        Row(
          children: [
            if (showCustomer) ...[
              Container(
                width: 26,
                height: 26,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFF00A0E5).withOpacity(0.14),
                  shape: BoxShape.circle,
                ),
                child: Text(initial,
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: isDark
                            ? const Color(0xFF7DD3FC)
                            : const Color(0xFF0284C7))),
              ),
              const SizedBox(width: 8),
            ],
            Expanded(
              child: Text(
                headText,
                style:
                    const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (resLabel != null)
              Container(
                margin: const EdgeInsets.only(left: 6),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: _resolutionColor(resKey).withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(resLabel,
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: _resolutionColor(resKey))),
              ),
          ],
        ),
        const SizedBox(height: 3),
        if (showCustomer && s.customerName.isNotEmpty)
          _labelTextRow(context, '일시', _fmtDateTime(s.startedAt)),
        if (_fmtDuration(s.durationSec).isNotEmpty)
          _labelTextRow(context, '원격 시간', _fmtDuration(s.durationSec)),
        if (chips.isNotEmpty)
          _labelRow('A/S 종류', Wrap(spacing: 4, runSpacing: 4, children: chips)),
        if (s.description.isNotEmpty) _labelTextRow(context, '내용', s.description),
        if (s.contactName.isNotEmpty) _labelTextRow(context, '응대자', s.contactName),
        if (s.operatorName.isNotEmpty) _labelTextRow(context, '담당', s.operatorName),
      ],
    ),
  );
}

// 기간 필터 (일수. 0=전체, -1=오늘).
const List<(int, String)> _kCrPeriods = [
  (0, '전체'),
  (-1, '오늘'),
  (7, '7일'),
  (30, '30일'),
];

List<CrSession> _applyFilter(List<CrSession> list, String query, int period) {
  var out = list;
  if (period == -1) {
    final now = DateTime.now();
    out = out.where((s) {
      final d = s.startedAt?.toLocal();
      return d != null &&
          d.year == now.year &&
          d.month == now.month &&
          d.day == now.day;
    }).toList();
  } else if (period > 0) {
    final cutoff = DateTime.now().subtract(Duration(days: period));
    out = out
        .where((s) => s.startedAt != null && s.startedAt!.isAfter(cutoff))
        .toList();
  }
  final q = query.trim().toLowerCase();
  if (q.isNotEmpty) {
    out = out.where((s) {
      final cats = s.categories.map((k) => kCrCategories[k] ?? '').join(' ');
      // 날짜 문자열도 검색 대상 — "07.14" 같은 날짜 검색이 자연스럽게 된다.
      final hay =
          '${s.customerName} ${s.remoteId} ${s.description} ${s.contactName} '
          '${s.operatorName} $cats ${_fmtDateTime(s.startedAt)}';
      return hay.toLowerCase().contains(q);
    }).toList();
  }
  return out;
}

/// 지원기록 다이얼로그. remoteId 주면 그 거래처만, 없으면 전체 타임라인.
/// 검색(거래처/내용/응대자/담당/종류/날짜) + 기간 칩 필터.
Future<void> showCrHistoryDialog(
  BuildContext context, {
  String? remoteId,
  String? title,
}) async {
  final perCustomer = remoteId != null && remoteId.isNotEmpty;
  final future = fetchCrSessions(remoteId: remoteId, limit: 300);
  final heading = title ?? (perCustomer ? '지원 이력' : '전체 지원 기록');

  var query = '';
  var period = 0;
  final searchCtrl = TextEditingController();

  await gFFI.dialogManager.show<void>((setState, close, context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final subtle = isDark ? const Color(0xFF9CA3AF) : const Color(0xFF6B7280);

    Widget periodChip(int days, String label) {
      final on = period == days;
      return InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => setState(() => period = days),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(
            color: on
                ? const Color(0xFF00A0E5)
                : (isDark ? const Color(0xFF2B3340) : const Color(0xFFF1F5F9)),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(label,
              style: TextStyle(
                  fontSize: 12,
                  fontWeight: on ? FontWeight.w700 : FontWeight.w500,
                  color: on ? Colors.white : subtle)),
        ),
      );
    }

    return CustomAlertDialog(
      title: Row(children: [
        const Icon(Icons.history, color: Color(0xFF00A0E5), size: 22),
        const SizedBox(width: 8),
        Expanded(child: Text(heading, overflow: TextOverflow.ellipsis)),
      ]),
      content: SizedBox(
        width: 620,
        height: 540,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 검색 + 기간 필터.
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 34,
                    child: TextField(
                      controller: searchCtrl,
                      onChanged: (v) => setState(() => query = v),
                      style: const TextStyle(fontSize: 13),
                      decoration: InputDecoration(
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 8),
                        prefixIcon:
                            Icon(Icons.search, size: 17, color: subtle),
                        prefixIconConstraints: const BoxConstraints(
                            minWidth: 32, minHeight: 32),
                        hintText: perCustomer
                            ? '내용, 응대자, 날짜 검색'
                            : '거래처명, 내용, 응대자, 날짜 검색',
                        hintStyle: TextStyle(fontSize: 12.5, color: subtle),
                        suffixIcon: query.isEmpty
                            ? null
                            : InkWell(
                                onTap: () => setState(() {
                                  query = '';
                                  searchCtrl.clear();
                                }),
                                child: Icon(Icons.close,
                                    size: 15, color: subtle),
                              ),
                        suffixIconConstraints: const BoxConstraints(
                            minWidth: 30, minHeight: 30),
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8)),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                ..._kCrPeriods.map((p) => Padding(
                      padding: const EdgeInsets.only(left: 4),
                      child: periodChip(p.$1, p.$2),
                    )),
              ],
            ),
            const SizedBox(height: 10),
            Expanded(
              child: FutureBuilder<List<CrSession>>(
                future: future,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final all = snap.data ?? const <CrSession>[];
                  final list = _applyFilter(all, query, period);
                  if (list.isEmpty) {
                    return Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                              all.isEmpty
                                  ? Icons.inbox_outlined
                                  : Icons.search_off,
                              size: 42,
                              color: subtle.withOpacity(0.55)),
                          const SizedBox(height: 10),
                          Text(
                              all.isEmpty
                                  ? '지원 기록이 없습니다.'
                                  : '검색 결과가 없습니다.',
                              style: TextStyle(color: subtle)),
                        ],
                      ),
                    );
                  }
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6, left: 2),
                        child: Text(
                          list.length == all.length
                              ? '총 ${all.length}건'
                              : '${list.length}건 / 총 ${all.length}건',
                          style: TextStyle(fontSize: 11.5, color: subtle),
                        ),
                      ),
                      Expanded(
                        child: ListView.builder(
                          itemCount: list.length,
                          itemBuilder: (context, i) => _sessionTile(
                              context, list[i],
                              showCustomer: !perCustomer),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
      actions: [dialogButton('닫기', onPressed: close)],
      onCancel: close,
    );
  });
}
