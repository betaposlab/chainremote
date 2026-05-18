// ChainRemote 업데이트 정보 페이지 — NAS latest.json 직접 fetch + 표시.
//
// 실제 다운로드/적용은 Windows 서비스(LocalSystem)가 담당 (chainremote_updater.rs).
// 이 위젯은 사용자에게 "현재 / 최신 / 새 버전 사용 가능" 정보를 보여주고,
// 자동 적용 일정 (다음 부팅 시) 을 안내하는 용도.

import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../common.dart';

// ChainRemote: "지금 설치" 는 UI 가 그 자리에서 직접 인스톨러를 받아
// UAC 승격으로 즉시 실행한다 (Chrome/Slack 방식). 서비스·플래그파일·폴링
// 의존 없음 → 지체 0, 서비스가 죽어 있어도 동작. 무인 배경 업데이트(24h/
// push.json)만 서비스(chainremote_updater.rs)가 담당.

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
  ChainRemoteRelease? _availableRelease;
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
        _availableRelease = latest;
        _statusText = '새 버전 v${latest.version} 사용 가능.$notes';
        _statusColor = const Color(0xFFE67E22);
      });
    } else {
      setState(() {
        _checking = false;
        _availableVersion = null;
        _availableRelease = null;
        _statusText = '최신 버전을 사용 중입니다 (v$chainRemoteVersion)';
        _statusColor = const Color(0xFF27AE60);
      });
    }
  }

  void _setStatus(String text, Color color) {
    if (!mounted) return;
    setState(() {
      _statusText = text;
      _statusColor = color;
    });
  }

  /// "지금 설치" — UI 가 직접 인스톨러를 받아 즉시 UAC 승격 실행.
  /// 서비스/플래그/폴링 없음 → 지체 0, 서비스가 죽어 있어도 동작.
  Future<void> _triggerInstallNow() async {
    if (!Platform.isWindows) {
      _setStatus('즉시 설치는 Windows 에서만 지원됩니다.', const Color(0xFFE74C3C));
      return;
    }
    final rel = _availableRelease;
    if (rel == null || rel.url.isEmpty) {
      _setStatus('설치 정보가 없습니다. 먼저 "업데이트 확인" 을 눌러주세요.',
          const Color(0xFFE74C3C));
      return;
    }
    setState(() => _triggering = true);
    try {
      _setStatus('새 버전 v${rel.version} 다운로드 중...', const Color(0xFF2980B9));
      final resp = await http
          .get(Uri.parse(rel.url))
          .timeout(const Duration(minutes: 10));
      if (resp.statusCode != 200) {
        throw '다운로드 실패 (HTTP ${resp.statusCode})';
      }
      final bytes = resp.bodyBytes;
      if (bytes.isEmpty) throw '다운로드 파일이 비어 있습니다';

      // 무결성 검증 — 변조/손상된 인스톨러 실행 방지
      if (rel.sha256.isNotEmpty) {
        final got = sha256.convert(bytes).toString().toLowerCase();
        if (got != rel.sha256.trim().toLowerCase()) {
          throw 'SHA256 불일치 — 손상된 파일, 설치 중단';
        }
      }

      final dest = File(
          '${Directory.systemTemp.path}\\ChainRemote_Setup_v${rel.version}.exe');
      await dest.writeAsBytes(bytes, flush: true);

      _setStatus('설치 시작 — UAC 창에서 "예" 를 누르면 자동 설치 후 ChainRemote 가 재시작됩니다.',
          const Color(0xFF2980B9));

      // UAC 승격 + 사일런트 설치. Inno 의 CloseApplications/RestartApplications 가
      // 실행 중 ChainRemote 종료/재시작 처리. detached — 우리가 종료돼도 설치 계속.
      final psCmd =
          "Start-Process -FilePath '${dest.path}' -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART' -Verb RunAs";
      await Process.start(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psCmd],
        mode: ProcessStartMode.detached,
      );

      if (!mounted) return;
      setState(() {
        _triggering = false;
        _statusText =
            'v${rel.version} 설치 진행 중 — 완료되면 ChainRemote 가 자동 재시작됩니다.';
        _statusColor = const Color(0xFF27AE60);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _triggering = false;
        _statusText = '업데이트 실패: $e';
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
