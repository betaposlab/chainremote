// ChainRemote 본사 앱 인증 게이트 (Phase 2-B).
//
// DesktopHomePage 를 감싸서 토큰 없으면 로그인 화면, 있으면 원래 홈을 보여준다.
// 로그인 성공 시 setState 로 child 로 전환.
//
// 백엔드: src/chainremote_auth.rs + /api/auth/token (Bearer JWT)
// 토큰/사용자 저장: 프로세스 메모리 전용 (디스크 잔재 0). 앱 종료 시 소멸 → 재실행 시 재로그인.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/models/platform_model.dart';

/// 본사 앱 인증 상태 전역 핸들. 홈 상단바의 로그아웃 버튼이 어디서든 호출.
/// authed 노티파이어를 게이트가 구독 → false 면 로그인 화면으로 되돌아감.
class ChainRemoteAuth {
  ChainRemoteAuth._();

  static final ValueNotifier<bool> authed = ValueNotifier<bool>(false);

  /// 로그아웃: 메모리 자격증명 삭제(Rust static) + 게이트를 로그인 화면으로 전환.
  static void logout() {
    bind.chainremoteLogout();
    authed.value = false;
  }

  /// 본인 비밀번호 변경. 현재 비번 검증 후 새 비번 hash 로 DB 업데이트.
  /// 반환: (ok, error). 토큰은 그대로 유효 — 재로그인 불필요.
  static ({bool ok, String? error}) changePassword(
    String currentPassword,
    String newPassword,
  ) {
    final raw = bind.chainremoteChangePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      if (m['ok'] == true) return (ok: true, error: null);
      return (ok: false, error: (m['error'] as String?) ?? '비밀번호 변경 실패');
    } catch (_) {
      return (ok: false, error: '응답 파싱 실패');
    }
  }

  /// 현재 로그인 사용자 표시명 (없으면 빈 문자열).
  static String currentDisplayName() {
    try {
      final raw = bind.chainremoteGetUser();
      if (raw.isEmpty) return '';
      final m = jsonDecode(raw) as Map<String, dynamic>;
      final name = (m['displayName'] as String?)?.trim();
      if (name != null && name.isNotEmpty) return name;
      return (m['email'] as String?) ?? '';
    } catch (_) {
      return '';
    }
  }
}

class ChainRemoteAuthGate extends StatefulWidget {
  final Widget child;
  const ChainRemoteAuthGate({Key? key, required this.child}) : super(key: key);

  @override
  State<ChainRemoteAuthGate> createState() => _ChainRemoteAuthGateState();
}

class _ChainRemoteAuthGateState extends State<ChainRemoteAuthGate> {
  @override
  void initState() {
    super.initState();
    ChainRemoteAuth.authed.value = bind.chainremoteIsAuthenticated();
    if (ChainRemoteAuth.authed.value) _warmCaches();
  }

  /// 본사 앱 메인 진입 직후 캐시 워밍.
  /// - chainremoteLoadFavorites: 즐겨찾기 탭 + chainremoteGetFavoriteIds() 캐시 (peer_card 별표 분기).
  /// - chainremoteLoadCustomers: remote_id→uuid 매핑만 silent 워밍 (즐겨찾기 추가 시 즉시 변환).
  ///   전체 거래처를 화면에 뿌리지 않음 — 최근 세션은 네이티브, 전체는 관리 패널 전용.
  void _warmCaches() {
    bind.chainremoteLoadCustomers();
    bind.chainremoteLoadFavorites();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: ChainRemoteAuth.authed,
      builder: (_, authed, __) {
        if (authed) return widget.child;
        return _ChainRemoteLoginPage(
          onLoggedIn: () {
            ChainRemoteAuth.authed.value = true;
            _warmCaches();
          },
        );
      },
    );
  }
}

class _ChainRemoteLoginPage extends StatefulWidget {
  final VoidCallback onLoggedIn;
  const _ChainRemoteLoginPage({required this.onLoggedIn});

  @override
  State<_ChainRemoteLoginPage> createState() => _ChainRemoteLoginPageState();
}

class _ChainRemoteLoginPageState extends State<_ChainRemoteLoginPage> {
  final _emailCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  bool _busy = false;
  String? _errorText;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailCtrl.text.trim();
    final password = _passwordCtrl.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _errorText = '아이디·비밀번호를 입력하세요');
      return;
    }
    setState(() {
      _busy = true;
      _errorText = null;
    });
    final raw = bind.chainremoteLogin(email: email, password: password);
    if (!mounted) return;
    try {
      final parsed = jsonDecode(raw) as Map<String, dynamic>;
      if (parsed['ok'] == true) {
        widget.onLoggedIn();
        return;
      }
      setState(() {
        _busy = false;
        _errorText = (parsed['error'] as String?) ?? '로그인 실패';
      });
    } catch (_) {
      setState(() {
        _busy = false;
        _errorText = '응답 파싱 실패';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final apiBase = bind.chainremoteGetApiBase();
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'ChainRemote',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF1E40AF),
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  '본사 직원 로그인',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14, color: Colors.black54),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: _emailCtrl,
                  enabled: !_busy,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: '아이디',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _passwordCtrl,
                  enabled: !_busy,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '비밀번호',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _submit(),
                ),
                if (_errorText != null) ...[
                  const SizedBox(height: 12),
                  Text(
                    _errorText!,
                    style: const TextStyle(color: Colors.red, fontSize: 13),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    backgroundColor: const Color(0xFF1E40AF),
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text('로그인',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                ),
                const SizedBox(height: 24),
                Text(
                  '서버: $apiBase',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 11, color: Colors.black38),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
