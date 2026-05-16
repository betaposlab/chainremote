// ChainRemote 업데이트 정보 페이지 — NAS latest.json 직접 fetch + 표시.
//
// 실제 다운로드/적용은 Windows 서비스(LocalSystem)가 담당 (chainremote_updater.rs).
// 이 위젯은 사용자에게 "현재 / 최신 / 새 버전 사용 가능" 정보를 보여주고,
// 자동 적용 일정 (다음 부팅 시) 을 안내하는 용도.

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../common.dart';

// ChainRemote: UI(user 세션) 가 "지금 설치" 클릭 시 이 플래그 파일을 만든다.
// Windows 서비스(LocalSystem)의 chainremote_updater 루프가 ≤15초 내 감지 →
// 즉시 다운로드+사일런트 설치. 부팅 대기 불필요.
// 경로/로직은 src/chainremote_updater.rs 의 MANUAL_TRIGGER_FLAG 와 반드시 일치.
const _kManualTriggerFlag = r'C:\ProgramData\ChainRemote\update_now.flag';

const _kUpdateChannelUrl =
    'https://sepani.synology.me/chainremote/latest.json';
const _kFetchTimeout = Duration(seconds: 10);

class ChainRemoteRelease {
  final String version;
  final String url;
  final String sha256;
  final String releasedAt;
  final String notes;
  const ChainRemoteRelease({
    required this.version,
    required this.url,
    required this.sha256,
    required this.releasedAt,
    required this.notes,
  });
  factory ChainRemoteRelease.fromJson(Map<String, dynamic> json) =>
      ChainRemoteRelease(
        version: (json['version'] ?? '').toString(),
        url: (json['url'] ?? '').toString(),
        sha256: (json['sha256'] ?? '').toString(),
        releasedAt: (json['released_at'] ?? '').toString(),
        notes: (json['notes'] ?? '').toString(),
      );
}

Future<ChainRemoteRelease?> fetchLatestChainRemoteRelease() async {
  try {
    final resp = await http
        .get(Uri.parse(_kUpdateChannelUrl))
        .timeout(_kFetchTimeout);
    if (resp.statusCode != 200) return null;
    return ChainRemoteRelease.fromJson(
        jsonDecode(resp.body) as Map<String, dynamic>);
  } catch (_) {
    return null;
  }
}

/// `a > b` 인지 비교. 패치 부분에 알파/베타 suffix 가 붙어도 숫자 prefix 만 사용.
bool isChainRemoteVersionNewer(String a, String b) {
  List<int> parse(String v) => v
      .trim()
      .split('.')
      .map((s) => int.tryParse(s.replaceAll(RegExp(r'\D.*'), '')) ?? 0)
      .toList();
  final pa = parse(a);
  final pb = parse(b);
  for (int i = 0; i < 3; i++) {
    final va = i < pa.length ? pa[i] : 0;
    final vb = i < pb.length ? pb[i] : 0;
    if (va != vb) return va > vb;
  }
  return false;
}

/// 정보 페이지에 끼워 넣는 한 줄짜리 "업데이트 확인" UI.
/// 버튼 + 상태 텍스트 (확인 중 / 최신 / 새 버전 사용 가능 / 실패).
class ChainRemoteUpdateCheckRow extends StatefulWidget {
  const ChainRemoteUpdateCheckRow({super.key});

  @override
  State<ChainRemoteUpdateCheckRow> createState() =>
      _ChainRemoteUpdateCheckRowState();
}

class _ChainRemoteUpdateCheckRowState extends State<ChainRemoteUpdateCheckRow> {
  bool _checking = false;
  String? _statusText;
  Color _statusColor = Colors.grey;
  // 새 버전 발견 시 채워짐 → "지금 설치" 버튼 노출
  String? _availableVersion;
  bool _triggering = false;

  Future<void> _runCheck() async {
    setState(() {
      _checking = true;
      _statusText = '확인 중...';
      _statusColor = Colors.grey;
    });
    final latest = await fetchLatestChainRemoteRelease();
    if (!mounted) return;
    if (latest == null || latest.version.isEmpty) {
      setState(() {
        _checking = false;
        _statusText = '확인 실패 — 네트워크 또는 서버 오류';
        _statusColor = const Color(0xFFE74C3C);
      });
      return;
    }
    if (isChainRemoteVersionNewer(latest.version, chainRemoteVersion)) {
      final notes = latest.notes.isNotEmpty ? '\n${latest.notes}' : '';
      setState(() {
        _checking = false;
        _availableVersion = latest.version;
        _statusText = '새 버전 v${latest.version} 사용 가능.$notes';
        _statusColor = const Color(0xFFE67E22);
      });
    } else {
      setState(() {
        _checking = false;
        _availableVersion = null;
        _statusText = '최신 버전을 사용 중입니다 (v$chainRemoteVersion)';
        _statusColor = const Color(0xFF27AE60);
      });
    }
  }

  /// "지금 설치" — 수동 트리거 플래그 파일 생성. 서비스가 ≤15초 내 적용.
  Future<void> _triggerInstallNow() async {
    if (!Platform.isWindows) {
      setState(() {
        _statusText = '즉시 설치는 Windows 에서만 지원됩니다.';
        _statusColor = const Color(0xFFE74C3C);
      });
      return;
    }
    setState(() => _triggering = true);
    try {
      final f = File(_kManualTriggerFlag);
      await f.parent.create(recursive: true);
      await f.writeAsString(
        '${_availableVersion ?? ""}\n${DateTime.now().toIso8601String()}\n',
        flush: true,
      );
      if (!mounted) return;
      setState(() {
        _triggering = false;
        _availableVersion = null;
        _statusText =
            '설치 예약됨 — 곧 자동 적용됩니다 (최대 15초). 완료 시 ChainRemote 가 자동 재시작됩니다.';
        _statusColor = const Color(0xFF2980B9);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _triggering = false;
        _statusText = '설치 예약 실패: $e';
        _statusColor = const Color(0xFFE74C3C);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OutlinedButton.icon(
            icon: _checking
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.cloud_sync_outlined, size: 18),
            label: const Text('업데이트 확인'),
            onPressed: _checking ? null : _runCheck,
          ),
          if (_availableVersion != null) ...[
            const SizedBox(width: 8),
            FilledButton.icon(
              icon: _triggering
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.system_update_alt, size: 18),
              label: Text('v$_availableVersion 지금 설치'),
              onPressed: _triggering ? null : _triggerInstallNow,
            ),
          ],
          const SizedBox(width: 12),
          if (_statusText != null)
            Expanded(
              child: Text(
                _statusText!,
                style: TextStyle(
                  color: _statusColor,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
