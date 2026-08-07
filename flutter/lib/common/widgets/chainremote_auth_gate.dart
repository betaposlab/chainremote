// 본사 앱 인증 게이트 (Phase 2-B).
// DesktopHomePage 를 감싸서 토큰이 없으면 로그인 화면을, 있으면 홈을 보여준다.
// 로그인이 성공하면 setState 로 child 로 넘어간다.
//
// 백엔드는 src/chainremote_auth.rs + /api/auth/token (Bearer JWT).
// 토큰·사용자 정보는 프로세스 메모리에만 둔다(디스크 잔재 없음). 앱을 끄면 사라져
// 다음 실행 때 다시 로그인해야 한다.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/common.dart' show CrColors;
import 'package:flutter_hbb/common.dart' show chainRemoteVersion;
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:flutter_hbb/utils/multi_window_manager.dart';

/// 인증 상태 전역 핸들. 홈 상단바의 로그아웃 버튼이 어디서든 호출한다.
/// 게이트가 authed 노티파이어를 구독하고, false 가 되면 로그인 화면으로 돌아간다.
class ChainRemoteAuth {
  ChainRemoteAuth._();

  // 로그인 정보 자동완성(prefill, opt-in)용 LocalConfig 키.
  // RustDesk 계정 저장(user_model 의 access_token/user_info)과 같은 방식.
  static const kRememberId = 'chainremote-remember-id';
  static const kRememberPw = 'chainremote-remember-pw';
  static const kSavedEmail = 'chainremote-saved-email';
  static const kSavedPassword = 'chainremote-saved-password';

  static final ValueNotifier<bool> authed = ValueNotifier<bool>(false);

  /// 로그아웃. 토큰만 지우고 로그인 화면으로. 저장된 아이디·비밀번호는 유지된다.
  static void logout() {
    bind.chainremoteLogout();
    // ★2026-08-06: 저장정보는 건드리지 않는다. 종전엔 로그아웃이 같이 지웠는데, 그러면
    //   사용자가 [아이디 저장]·[비밀번호 저장] 을 켠 명시적 선택을 앱이 무시하는 셈이고
    //   매번 다시 타이핑해야 했다. 저장할지 말지는 그 체크박스가 이미 정하고 있다
    //   (기본 꺼짐 — 공용 PC 면 켜지 않으면 된다).
    authed.value = false;
  }

  /// 본인 비밀번호 변경. 현재 비번을 검증한 뒤 새 비번 해시로 DB 를 갱신한다.
  /// (ok, error) 를 돌려준다. 토큰은 그대로 유효해서 다시 로그인할 필요 없다.
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

  /// 현재 로그인 사용자의 표시명. 없으면 빈 문자열.
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

  /// 로그인 캐시(get_user_json)에서 역할을 꺼낸다. 'owner'|'admin'|'operator'|'viewer'|'super_admin'.
  static String currentRole() {
    try {
      final raw = bind.chainremoteGetUser();
      if (raw.isEmpty) return '';
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return (m['role'] as String?) ?? '';
    } catch (_) {
      return '';
    }
  }

  /// 이 대리점에 설정된 인사말. 설정 → 정보 화면에서만 쓴다. 없으면 빈 문자열.
  ///
  /// 문구가 코드가 아니라 패널 DB 에 있는 이유는 두 가지다. HQ 는 빌드가 한 벌이라
  /// 코드에 박으면 전 대리점에 다 보이고, 이 저장소는 AGPL 이라 소스가 공개다.
  /// 서버는 값을 채운 대리점에만 이 키를 실어 보낸다.
  static String currentGreeting() {
    try {
      final raw = bind.chainremoteGetUser();
      if (raw.isEmpty) return '';
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return ((m['greeting'] as String?) ?? '').trim();
    } catch (_) {
      return '';
    }
  }

  /// 로그인한 사용자가 속한 대리점 상호. 없으면 빈 문자열.
  ///
  /// 사이드바 배지가 이걸 쓴다 — 종전 "본사용 (HQ)" 는 빌드 종류만 알려줄 뿐 내가 어느
  /// 회사로 붙어 있는지는 앱 어디에도 없었다. 직원이 여럿인 대리점일수록 필요하다.
  static String currentTenantName() {
    try {
      final raw = bind.chainremoteGetUser();
      if (raw.isEmpty) return '';
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return ((m['tenantName'] as String?) ?? '').trim();
    } catch (_) {
      return '';
    }
  }

  /// 마스터 = 테넌트 owner(chang). '전체 거래처' 탭의 확정 버튼을 보일지 정하는 UX 게이트다.
  /// 실제 권한은 서버 confirm 엔드포인트(requireOwner)가 막으므로 이 체크는 화면용일 뿐.
  static bool isMaster() {
    final r = currentRole();
    return r == 'owner' || r == 'super_admin';
  }
}

class ChainRemoteAuthGate extends StatefulWidget {
  final Widget child;
  const ChainRemoteAuthGate({Key? key, required this.child}) : super(key: key);

  @override
  State<ChainRemoteAuthGate> createState() => _ChainRemoteAuthGateState();
}

class _ChainRemoteAuthGateState extends State<ChainRemoteAuthGate> {
  // 좌석 enforcement. 약 10초 주기 heartbeat 로, 인계당함(revoked)이 감지되면
  // 세션을 끊고 로그아웃한다. 스펙은 docs/chainremote/SEAT_ENFORCEMENT.md §6.
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

  /// 로그인/로그아웃 상태에 맞춰 heartbeat 을 켜고 끈다.
  void _onAuthChanged() {
    if (ChainRemoteAuth.authed.value) {
      _startHeartbeat();
    } else {
      _stopHeartbeat();
    }
  }

  void _startHeartbeat() {
    if (_heartbeatTimer != null) return;
    // 5초 주기. chainremoteHeartbeat 는 async FFI 라 UI 를 막지 않는다. 인계당함
    // 감지가 최대 이 주기(약 5초)만큼 늦는다. 원격 시작 시점에 바로 좌석을 확인해
    // 즉시 막는 건 네이티브 연결 로직을 건드려야 해서 백로그로 뺐다(BACKLOG.md).
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
      return; // 일시 오류. 다음 tick 에 재시도한다(세션은 유지, 스펙 §7).
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
    if (status == 'expired') await _onExpired();
  }

  /// 로그인 토큰 만료(비-revoked 401 연속). 조용한 좀비 로그인(2026-07-20 실사고: 만료 후
  /// 3일간 목록·지원기록 무음 실패) 대신 명시적으로 재로그인을 안내한다.
  /// ★인계(revoked)와 달리 원격 세션(서브윈도우)은 안 끊는다 — 원격 자체는 토큰과 무관하고,
  ///   진행 중인 거래처 작업을 날릴 이유가 없다. 재로그인하면 기록·목록이 즉시 재개된다.
  Future<void> _onExpired() async {
    if (_revoking) return;
    _revoking = true;
    _stopHeartbeat();
    if (mounted) {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('로그인 만료'),
          content: const Text('보안을 위해 로그인이 만료되었습니다.\n'
              '다시 로그인해 주세요. (진행 중인 원격은 끊기지 않습니다)'),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(ctx).pop(),
              style: FilledButton.styleFrom(
                  backgroundColor: CrColors.of(context).accentFill),
              child: const Text('확인'),
            ),
          ],
        ),
      );
    }
    // 로그아웃하고 로그인 화면으로. 저장된 자동완성(아이디/비번)은 재로그인 편의상 남겨둔다.
    bind.chainremoteLogout();
    ChainRemoteAuth.authed.value = false;
    _revoking = false;
  }

  /// 다른 기기에 좌석을 인계당했을 때. 원격 세션을 모두 끊고 안내 모달을 띄운 뒤 로그아웃.
  Future<void> _onRevoked() async {
    if (_revoking) return;
    _revoking = true;
    _stopHeartbeat();
    // 열려 있는 원격 세션(서브윈도우)을 전부 닫는다. 곧 원격이 끊긴다.
    try {
      await rustDeskWinManager.closeAllSubWindows();
    } catch (_) {}
    if (mounted) {
      // 안내 모달(모달 B).
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
                  backgroundColor: CrColors.of(context).accentFill),
              child: const Text('확인'),
            ),
          ],
        ),
      );
    }
    // 로그아웃하고 로그인 화면으로. 저장된 자동완성(아이디/비번)은 재로그인 편의상 남겨둔다.
    bind.chainremoteLogout();
    ChainRemoteAuth.authed.value = false;
    _revoking = false;
  }

  /// 메인 진입 직후 캐시를 미리 데운다.
  /// - chainremoteLoadFavorites: 즐겨찾기 탭과 chainremoteGetFavoriteIds() 캐시(peer_card 별표 분기).
  /// - chainremoteLoadCustomers: remote_id→uuid 매핑만 조용히 채운다(즐겨찾기 추가 시 바로 변환).
  ///   전체 거래처를 화면에 뿌리지는 않는다. 최근 세션은 네이티브, 전체는 관리 패널 몫.
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
    // prefill: '저장'을 켜뒀던 항목만 미리 채운다. 자동 로그인은 하지 않는다.
    // 아이디·비밀번호는 각각 따로 저장된다.
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
  ///   ok       → 자동완성 저장 후 메인 진입.
  ///   occupied → 모달 A. 강제면 takeover, 취소면 중단.
  ///   error    → 에러 표시.
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

    // 좌석 점유됨(409). 강제 종료할지 모달로 묻는다. takeover 응답에는 occupied 가 안 온다.
    if (!isTakeover && parsed['occupied'] == true) {
      final label = (parsed['deviceLabel'] as String?)?.trim();
      final force = await _showOccupiedDialog(label);
      if (!mounted) return;
      if (force == true) {
        await _takeover(email, password);
      } else {
        setState(() => _busy = false); // 취소. 토큰은 발급되지 않는다.
      }
      return;
    }

    setState(() {
      _busy = false;
      _errorText = (parsed['error'] as String?) ?? '로그인 실패';
    });
  }

  /// "강제 종료하고 사용" = 좌석 인계. busy 를 유지한 채 진행한다.
  Future<void> _takeover(String email, String password) async {
    final raw = bind.chainremoteTakeover(email: email, password: password);
    if (!mounted) return;
    await _handleAuthResult(raw, email, password, isTakeover: true);
  }

  /// 점유 모달(모달 A). true=강제 종료하고 사용, false/null=취소.
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
                backgroundColor: CrColors.of(context).accentFill),
            child: const Text('강제 종료하고 사용'),
          ),
        ],
      ),
    );
  }

  /// 아이디·비밀번호를 각각 따로 저장하거나 지운다(opt-in).
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

  // 브랜드 액센트 (베타포스랩 톤).

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // 회청색 배경에 양쪽으로 옅은 브랜드색 블롭. 카드가 붕 떠 보이지 않게
      // 배경을 묵직하게 깔고 카드 그림자를 키웠다.
      body: Stack(
        children: [
          // 베이스 배경. 위에서 아래로 옅은 회청색 그라데이션.
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [CrColors.of(context).authBgTop, CrColors.of(context).authBgBottom],
              ),
            ),
          ),
          // 좌상단 브랜드색 블롭(옅게).
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
                    CrColors.of(context).tileAccent.withOpacity(0.18),
                    CrColors.of(context).tileAccent.withOpacity(0.0),
                  ],
                ),
              ),
            ),
          ),
          // 우하단 청록 블롭(옅게).
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
                    color: CrColors.of(context).cardBg,
                    elevation: 0,
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      decoration: BoxDecoration(
                        color: CrColors.of(context).cardBg,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(color: CrColors.of(context).border),
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
                                Icon(Icons.error_outline,
                                    size: 16, color: CrColors.of(context).dangerFg),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    _errorText!,
                                    style: TextStyle(
                                        color: CrColors.of(context).dangerFg,
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
            // 하단 회사 푸터.
            Positioned(
              left: 0,
              right: 0,
              bottom: 16,
              child: Center(
                child: Text(
                  'BetaPosLab · ChainRemote v$chainRemoteVersion',
                  style: TextStyle(
                    fontSize: 11,
                    color: CrColors.of(context).textMuted,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
            ),
          ],
      ),
    );
  }

  /// 워드마크(chainremote_logo.png, 메인 상단바와 동일)와 부제.
  Widget _buildBrand() {
    return Column(
      children: [
        // 가로형 워드마크. 비율 2048:685 ≈ 2.99:1 이라 가로 240 이면 세로는 약 80.
        Image.asset(
          'assets/chainremote_logo.png',
          width: 240,
          filterQuality: FilterQuality.high,
        ),
        const SizedBox(height: 14),
        Text(
          '대리점 로그인',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 13,
            color: CrColors.of(context).textMuted,
            letterSpacing: 0.1,
          ),
        ),
      ],
    );
  }

  /// 입력란. 포커스되면 브랜드색 border 로 강조한다.
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
        hintStyle: TextStyle(color: CrColors.of(context).textDim, fontSize: 13),
        labelStyle: TextStyle(color: CrColors.of(context).textMuted, fontSize: 13),
        floatingLabelStyle: TextStyle(
            color: CrColors.of(context).tileAccent, fontSize: 13, fontWeight: FontWeight.w600),
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        filled: true,
        fillColor: CrColors.of(context).inputFill,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: CrColors.of(context).border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: CrColors.of(context).border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: CrColors.of(context).tileAccent, width: 1.5),
        ),
      ),
    );
  }

  /// 아이디 저장 / 비밀번호 저장. 각각 따로 켠다. 체크한 항목만 다음 실행 때 미리 채운다.
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
            activeColor: CrColors.of(context).tileAccent,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            visualDensity: VisualDensity.compact,
          ),
        ),
        const SizedBox(width: 6),
        GestureDetector(
          onTap: _busy ? null : () => onChanged(!value),
          child: Text(
            label,
            style: TextStyle(fontSize: 13, color: CrColors.of(context).textMuted),
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
          backgroundColor: CrColors.of(context).accentFill,
          disabledBackgroundColor: CrColors.of(context).tileAccent.withOpacity(0.5),
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
