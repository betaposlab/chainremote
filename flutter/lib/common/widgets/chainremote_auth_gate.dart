// ChainRemote 본사 앱 인증 게이트 (Phase 2-B).
//
// DesktopHomePage 를 감싸서 토큰 없으면 로그인 화면, 있으면 원래 홈을 보여준다.
// 로그인 성공 시 setState 로 child 로 전환.
//
// 백엔드: src/chainremote_auth.rs + /api/auth/token (Bearer JWT)
// 토큰/사용자 저장: 프로세스 메모리 전용 (디스크 잔재 0). 앱 종료 시 소멸 → 재실행 시 재로그인.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/common.dart' show chainRemoteVersion;
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:flutter_hbb/utils/multi_window_manager.dart';

/// 본사 앱 인증 상태 전역 핸들. 홈 상단바의 로그아웃 버튼이 어디서든 호출.
/// authed 노티파이어를 게이트가 구독 → false 면 로그인 화면으로 되돌아감.
class ChainRemoteAuth {
  ChainRemoteAuth._();

  // 로그인 정보 저장(자동완성) LocalConfig 키 — B 방식(prefill, opt-in).
  // RustDesk 계정 저장(user_model 의 access_token/user_info)과 동일 메커니즘.
  static const kRememberId = 'chainremote-remember-id';
  static const kRememberPw = 'chainremote-remember-pw';
  static const kSavedEmail = 'chainremote-saved-email';
  static const kSavedPassword = 'chainremote-saved-password';

  static final ValueNotifier<bool> authed = ValueNotifier<bool>(false);

  /// 로그아웃: 메모리 자격증명 삭제(Rust static) + 저장된 자동완성 정보 삭제 + 로그인 화면 전환.
  static void logout() {
    bind.chainremoteLogout();
    // 저장된 자동완성 자격증명도 함께 삭제 (Chang 결정: 로그아웃 시 저장정보 제거).
    bind.mainSetLocalOption(key: kRememberId, value: '');
    bind.mainSetLocalOption(key: kRememberPw, value: '');
    bind.mainSetLocalOption(key: kSavedEmail, value: '');
    bind.mainSetLocalOption(key: kSavedPassword, value: '');
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
  // 좌석 enforcement — ~10초 heartbeat. 인계당함(revoked) 감지 시 세션 끊고 로그아웃.
  // 스펙: docs/chainremote/SEAT_ENFORCEMENT.md §6
  Timer? _heartbeatTimer;
  bool _revoking = false;

  @override
  void initState() {
    super.initState();
    ChainRemoteAuth.authed.value = bind.chainremoteIsAuthenticated();
    if (ChainRemoteAuth.authed.value) _warmCaches();
    ChainRemoteAuth.authed.addListener(_onAuthChanged);
    if (ChainRemoteAuth.authed.value) _startHeartbeat();
  }

  @override
  void dispose() {
    ChainRemoteAuth.authed.removeListener(_onAuthChanged);
    _stopHeartbeat();
    super.dispose();
  }

  /// 로그인/로그아웃 상태에 따라 heartbeat 시작/정지.
  void _onAuthChanged() {
    if (ChainRemoteAuth.authed.value) {
      _startHeartbeat();
    } else {
      _stopHeartbeat();
    }
  }

  void _startHeartbeat() {
    if (_heartbeatTimer != null) return;
    // 5초 주기. chainremoteHeartbeat 는 async FFI(UI 비차단). 인계당함(REVOKED)
    // 감지 지연 = 이 주기(최대 ~5초). 더 즉각적 차단(원격 시작 시점 좌석 확인)은
    // 네이티브 연결 로직을 건드려야 해 백로그로 분리 (docs/chainremote/BACKLOG.md).
    _heartbeatTimer =
        Timer.periodic(const Duration(seconds: 5), (_) => _heartbeatTick());
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
  }

  Future<void> _heartbeatTick() async {
    String raw;
    try {
      raw = await bind.chainremoteHeartbeat();
    } catch (_) {
      return; // 일시 오류 — 다음 tick 재시도(세션 유지, 스펙 §7).
    }
    if (!mounted) return;
    String status;
    try {
      status = (jsonDecode(raw) as Map<String, dynamic>)['status'] as String? ??
          'error';
    } catch (_) {
      return;
    }
    if (status == 'revoked') await _onRevoked();
  }

  /// 다른 기기에 인계당함 — 모든 원격 세션 종료 + 안내 모달 + 로그아웃.
  Future<void> _onRevoked() async {
    if (_revoking) return;
    _revoking = true;
    _stopHeartbeat();
    // 1) 모든 원격 세션(서브윈도우) 강제 종료 = 원격 끊김.
    try {
      await rustDeskWinManager.closeAllSubWindows();
    } catch (_) {}
    if (mounted) {
      // 2) 안내 모달 (모달 B).
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('다른 기기에서 로그인됨'),
          content: const Text(
              '이 계정이 다른 기기에서 로그인되어 현재 기기에서는 종료되었습니다.'),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(),
              style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF1E5BFF)),
              child: const Text('확인'),
            ),
          ],
        ),
      );
    }
    // 3) 로그아웃 → 로그인 화면. 저장된 자동완성(아이디/비번)은 유지(재로그인 편의).
    bind.chainremoteLogout();
    ChainRemoteAuth.authed.value = false;
    _revoking = false;
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
  bool _rememberId = false;
  bool _rememberPw = false;
  String? _errorText;

  @override
  void initState() {
    super.initState();
    // B 방식 prefill: '저장'이 켜져 있던 항목만 미리 채움 (자동 로그인은 안 함).
    // 아이디·비밀번호 각각 독립.
    if (bind.mainGetLocalOption(key: ChainRemoteAuth.kRememberId) == 'Y') {
      _rememberId = true;
      _emailCtrl.text = bind.mainGetLocalOption(key: ChainRemoteAuth.kSavedEmail);
    }
    if (bind.mainGetLocalOption(key: ChainRemoteAuth.kRememberPw) == 'Y') {
      _rememberPw = true;
      _passwordCtrl.text =
          bind.mainGetLocalOption(key: ChainRemoteAuth.kSavedPassword);
    }
  }

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
    await _handleAuthResult(raw, email, password, isTakeover: false);
  }

  /// 로그인/인계 응답 처리.
  ///   ok        → 자동완성 저장 + 메인 진입
  ///   occupied  → 모달 A(강제 종료/취소). 강제면 takeover, 취소면 중단.
  ///   error     → 에러 표시
  Future<void> _handleAuthResult(
    String raw,
    String email,
    String password, {
    required bool isTakeover,
  }) async {
    Map<String, dynamic> parsed;
    try {
      parsed = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      setState(() {
        _busy = false;
        _errorText = '응답 파싱 실패';
      });
      return;
    }

    if (parsed['ok'] == true) {
      await _persistRemember(email, password);
      widget.onLoggedIn();
      return;
    }

    // 좌석 점유됨(409) — 강제 종료(인계) 여부 모달. takeover 응답엔 occupied 안 옴.
    if (!isTakeover && parsed['occupied'] == true) {
      final label = (parsed['deviceLabel'] as String?)?.trim();
      final force = await _showOccupiedDialog(label);
      if (!mounted) return;
      if (force == true) {
        await _takeover(email, password);
      } else {
        setState(() => _busy = false); // 취소 — 토큰 발급 안 됨.
      }
      return;
    }

    setState(() {
      _busy = false;
      _errorText = (parsed['error'] as String?) ?? '로그인 실패';
    });
  }

  /// "강제 종료하고 사용" — 좌석 인계. busy 유지한 채 진행.
  Future<void> _takeover(String email, String password) async {
    final raw = bind.chainremoteTakeover(email: email, password: password);
    if (!mounted) return;
    await _handleAuthResult(raw, email, password, isTakeover: true);
  }

  /// 점유 모달(모달 A) — true=강제 종료하고 사용, false/null=취소.
  Future<bool?> _showOccupiedDialog(String? deviceLabel) {
    final where = (deviceLabel != null && deviceLabel.isNotEmpty)
        ? "'$deviceLabel' 기기"
        : '다른 기기';
    return showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('이미 사용 중'),
        content: Text(
            '이 계정은 현재 $where에서 사용 중입니다.\n강제 종료하고 이 기기에서 사용하시겠습니까?\n(기존 기기의 원격 세션이 종료됩니다.)'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('취소'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(
                backgroundColor: _brandPrimary),
            child: const Text('강제 종료하고 사용'),
          ),
        ],
      ),
    );
  }

  /// 아이디·비밀번호 각각 독립 저장/삭제 (B 방식 opt-in).
  Future<void> _persistRemember(String email, String password) async {
    if (_rememberId) {
      await bind.mainSetLocalOption(
          key: ChainRemoteAuth.kRememberId, value: 'Y');
      await bind.mainSetLocalOption(
          key: ChainRemoteAuth.kSavedEmail, value: email);
    } else {
      await bind.mainSetLocalOption(key: ChainRemoteAuth.kRememberId, value: '');
      await bind.mainSetLocalOption(key: ChainRemoteAuth.kSavedEmail, value: '');
    }
    if (_rememberPw) {
      await bind.mainSetLocalOption(
          key: ChainRemoteAuth.kRememberPw, value: 'Y');
      await bind.mainSetLocalOption(
          key: ChainRemoteAuth.kSavedPassword, value: password);
    } else {
      await bind.mainSetLocalOption(key: ChainRemoteAuth.kRememberPw, value: '');
      await bind.mainSetLocalOption(
          key: ChainRemoteAuth.kSavedPassword, value: '');
    }
  }

  // ChainRemote 액센트 (베타포스랩 톤).
  static const _brandPrimary = Color(0xFF1E5BFF);
  static const _brandDeep = Color(0xFF1E40AF);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // Cool gray 톤 배경 + 양쪽 brand 색 옅은 블롭. 카드가 떠다니지 않도록
      // 무게 있는 배경 + 카드 그림자 강화.
      body: Stack(
        children: [
          // 베이스 배경 — 위→아래 옅은 회청색 vertical gradient.
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [Color(0xFFE5ECF5), Color(0xFFEEF2F7)],
              ),
            ),
          ),
          // 좌상단 brand 색 블롭 (옅게).
          Positioned(
            left: -120,
            top: -120,
            child: Container(
              width: 360,
              height: 360,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    _brandPrimary.withOpacity(0.18),
                    _brandPrimary.withOpacity(0.0),
                  ],
                ),
              ),
            ),
          ),
          // 우하단 청록 블롭 (옅게).
          Positioned(
            right: -140,
            bottom: -140,
            child: Container(
              width: 400,
              height: 400,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [
                    Color(0x3300B894),
                    Color(0x0000B894),
                  ],
                ),
              ),
            ),
          ),
          // 중앙 로그인 카드.
          Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 380),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Material(
                    color: Colors.white,
                    elevation: 0,
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: const Color(0xFFE3E8F1)),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF0A2540).withOpacity(0.08),
                            blurRadius: 28,
                            offset: const Offset(0, 12),
                          ),
                          BoxShadow(
                            color: const Color(0xFF0A2540).withOpacity(0.04),
                            blurRadius: 6,
                            offset: const Offset(0, 2),
                          ),
                        ],
                      ),
                      padding: const EdgeInsets.fromLTRB(28, 32, 28, 28),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _buildBrand(),
                          const SizedBox(height: 28),
                          _buildField(
                            controller: _emailCtrl,
                            label: '아이디',
                            autofocus: true,
                            textInputAction: TextInputAction.next,
                          ),
                          const SizedBox(height: 14),
                          _buildField(
                            controller: _passwordCtrl,
                            label: '비밀번호',
                            obscure: true,
                            textInputAction: TextInputAction.done,
                            onSubmitted: (_) => _submit(),
                          ),
                          if (_errorText != null) ...[
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                const Icon(Icons.error_outline,
                                    size: 16, color: Color(0xFFE53935)),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    _errorText!,
                                    style: const TextStyle(
                                        color: Color(0xFFE53935),
                                        fontSize: 13),
                                  ),
                                ),
                              ],
                            ),
                          ],
                          const SizedBox(height: 14),
                          _buildRememberCheckbox(),
                          const SizedBox(height: 18),
                          _buildLoginButton(),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            // 하단 회사 footer.
            Positioned(
              left: 0,
              right: 0,
              bottom: 16,
              child: Center(
                child: Text(
                  'BetaPosLab · ChainRemote v$chainRemoteVersion',
                  style: const TextStyle(
                    fontSize: 11,
                    color: Color(0xFF8A93A6),
                    letterSpacing: 0.2,
                  ),
                ),
              ),
            ),
          ],
      ),
    );
  }

  /// 워드마크 (chainremote_logo.png — 메인 상단바와 동일) + 부제.
  Widget _buildBrand() {
    return Column(
      children: [
        // 워드마크 가로형 — 비율 2048:685 ≈ 2.99:1. 가로 240 → 세로 ~80.
        Image.asset(
          'assets/chainremote_logo.png',
          width: 240,
          filterQuality: FilterQuality.high,
        ),
        const SizedBox(height: 14),
        const Text(
          '대리점 로그인',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 13,
            color: Color(0xFF6B7280),
            letterSpacing: 0.1,
          ),
        ),
      ],
    );
  }

  /// 입력란 — focus 시 brand 색 강조 border.
  Widget _buildField({
    required TextEditingController controller,
    required String label,
    String? hint,
    bool obscure = false,
    bool autofocus = false,
    TextInputAction? textInputAction,
    ValueChanged<String>? onSubmitted,
  }) {
    return TextField(
      controller: controller,
      enabled: !_busy,
      autofocus: autofocus,
      obscureText: obscure,
      textInputAction: textInputAction,
      onSubmitted: onSubmitted,
      style: const TextStyle(fontSize: 14),
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        hintStyle: const TextStyle(color: Color(0xFFB0B7C3), fontSize: 13),
        labelStyle: const TextStyle(color: Color(0xFF6B7280), fontSize: 13),
        floatingLabelStyle: const TextStyle(
            color: _brandPrimary, fontSize: 13, fontWeight: FontWeight.w600),
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        filled: true,
        fillColor: const Color(0xFFF7F9FC),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFFE3E8F1)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: Color(0xFFE3E8F1)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: _brandPrimary, width: 1.5),
        ),
      ),
    );
  }

  /// 아이디 저장 / 비밀번호 저장 — 각각 독립 (B 방식 opt-in). 체크된 항목만 다음 실행 prefill.
  Widget _buildRememberCheckbox() {
    return Row(
      children: [
        _buildCheckItem(
            '아이디 저장', _rememberId, (v) => setState(() => _rememberId = v)),
        const SizedBox(width: 20),
        _buildCheckItem(
            '비밀번호 저장', _rememberPw, (v) => setState(() => _rememberPw = v)),
      ],
    );
  }

  Widget _buildCheckItem(
      String label, bool value, ValueChanged<bool> onChanged) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          width: 22,
          height: 22,
          child: Checkbox(
            value: value,
            onChanged: _busy ? null : (v) => onChanged(v ?? false),
            activeColor: _brandPrimary,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          ),
        ),
        const SizedBox(width: 6),
        GestureDetector(
          onTap: _busy ? null : () => onChanged(!value),
          child: Text(
            label,
            style: const TextStyle(fontSize: 13, color: Color(0xFF6B7280)),
          ),
        ),
      ],
    );
  }

  Widget _buildLoginButton() {
    return SizedBox(
      height: 48,
      child: FilledButton(
        onPressed: _busy ? null : _submit,
        style: FilledButton.styleFrom(
          backgroundColor: _brandPrimary,
          disabledBackgroundColor: _brandPrimary.withOpacity(0.5),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          elevation: 0,
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
            : const Text(
                '로그인',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2),
              ),
      ),
    );
  }
}
