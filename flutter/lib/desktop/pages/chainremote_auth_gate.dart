// ChainRemote 본사 앱 인증 게이트 (Phase 2-B).
//
// DesktopHomePage 를 감싸서 토큰 없으면 로그인 화면, 있으면 원래 홈을 보여준다.
// 로그인 성공 시 setState 로 child 로 전환.
//
// 백엔드: src/chainremote_auth.rs + /api/auth/token (Bearer JWT)
// 토큰/사용자 저장: LocalConfig (chainremote-token / chainremote-user)

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/models/platform_model.dart';

class ChainRemoteAuthGate extends StatefulWidget {
  final Widget child;
  const ChainRemoteAuthGate({Key? key, required this.child}) : super(key: key);

  @override
  State<ChainRemoteAuthGate> createState() => _ChainRemoteAuthGateState();
}

class _ChainRemoteAuthGateState extends State<ChainRemoteAuthGate> {
  bool _authed = false;

  @override
  void initState() {
    super.initState();
    _authed = bind.chainremoteIsAuthenticated();
    if (_authed) _warmCaches();
  }

  /// 본사 앱 메인 진입 직후 즐겨찾기 캐시 채우기.
  /// 이렇게 안 하면 peer_card 메뉴 빌드 시 chainremoteGetFavoriteIds() 가 빈 리스트 반환 →
  /// "Add/Remove Favorites" 메뉴 분기가 잘못됨.
  void _warmCaches() {
    bind.chainremoteLoadCustomers();
    bind.chainremoteLoadFavorites();
  }

  @override
  Widget build(BuildContext context) {
    if (_authed) return widget.child;
    return _ChainRemoteLoginPage(
      onLoggedIn: () {
        setState(() => _authed = true);
        _warmCaches();
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
