// 업데이트 정보 페이지. NAS latest.json 을 직접 받아 현재/최신 버전을 보여준다.
// 실제 다운로드·적용은 Windows 서비스(LocalSystem, chainremote_updater.rs)가 하고,
// 이 위젯은 상태 표시와 다음 부팅 시 자동 적용 안내만 담당한다.

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../common.dart';

// "지금 설치" 흐름: 비권한 UI 는 winlogon 토큰이 없어 권한 설치를 직접 못 한다.
// 그래서 버튼은 트리거 파일만 하나 떨구고, SYSTEM 서비스(chainremote_updater.rs)가
// 2초 안에 이를 감지해 다운로드·검증한 뒤 Inno 인스톨러를 사일런트 권한 실행하고
// 앱을 재시작한다. 이 경로는 서비스측 MANUAL_TRIGGER_FLAG 와 반드시 같아야 한다.
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
    final body = jsonDecode(resp.body) as Map<String, dynamic>;

    // 2026-05-28 이후 dual-channel 스키마: { hq: {...}, agent: {...} }.
    // 이 UI 가 도는 HQ 빌드는 hq 채널만 본다. Agent 빌드는 정적 버전 표시 +
    // push API 만 쓰므로 이 함수를 아예 호출하지 않는다. 그래도 hq 채널을 먼저 본다.
    if (body['hq'] is Map) {
      return ChainRemoteRelease.fromJson(
          body['hq'] as Map<String, dynamic>);
    }
    // 옛 flat 스키마 폴백 (v1.3.4 미만 latest.json 호환).
    return ChainRemoteRelease.fromJson(body);
  } catch (_) {
    return null;
  }
}

/// `a > b` 비교. 패치 자리에 알파/베타 suffix 가 붙어도 앞의 숫자만 쓴다.
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

/// 정보 페이지에 넣는 한 줄짜리 "업데이트 확인" UI.
/// 버튼과 상태 텍스트(확인 중 / 최신 / 새 버전 사용 가능 / 실패).
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
  // 새 버전이 있으면 채워지고, 그때 "지금 설치" 버튼이 뜬다.
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

  void _setStatus(String text, Color color) {
    if (!mounted) return;
    setState(() {
      _statusText = text;
      _statusColor = color;
    });
  }

  /// "지금 설치". 비권한 UI 는 권한 설치를 못 하므로 트리거 파일만 만든다.
  /// SYSTEM 서비스가 2초 안에 감지해 다운로드·검증 후 Inno 인스톨러를 사일런트
  /// 권한 실행하고 앱을 재시작한다. 부팅·UAC·15초 폴링 없음.
  Future<void> _triggerInstallNow() async {
    if (!Platform.isWindows) {
      _setStatus('즉시 설치는 Windows 에서만 지원됩니다.', const Color(0xFFE74C3C));
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
        _statusText =
            '설치 시작됨 — 곧 자동 설치 후 ChainRemote 가 재시작됩니다 (잠시만요).';
        _statusColor = const Color(0xFF27AE60);
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _triggering = false;
        _statusText = '설치 시작 실패: $e';
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
