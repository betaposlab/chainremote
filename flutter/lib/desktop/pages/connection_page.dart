// main window right pane

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/common/widgets/connection_page_title.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/desktop/widgets/popup_menu.dart';
import 'package:flutter_hbb/models/state_model.dart';
import 'package:get/get.dart';
import 'package:url_launcher/url_launcher_string.dart';
import 'package:window_manager/window_manager.dart';
import 'package:flutter_hbb/models/peer_model.dart';

import '../../common.dart';
import '../../common/formatter/id_formatter.dart';
import '../../common/widgets/peer_tab_page.dart';
import '../../common/widgets/autocomplete.dart';
import '../../models/platform_model.dart';
import '../../desktop/widgets/material_mod_popup_menu.dart' as mod_menu;

class OnlineStatusWidget extends StatefulWidget {
  const OnlineStatusWidget({Key? key, this.onSvcStatusChanged})
      : super(key: key);

  final VoidCallback? onSvcStatusChanged;

  @override
  State<OnlineStatusWidget> createState() => _OnlineStatusWidgetState();
}

/// State for the connection page.
class _OnlineStatusWidgetState extends State<OnlineStatusWidget> {
  final _svcStopped = Get.find<RxBool>(tag: 'stop-service');
  final _svcIsUsingPublicServer = true.obs;
  Timer? _updateTimer;

  double get em => 14.0;
  double? get height => bind.isIncomingOnly() ? null : em * 3;

  void onUsePublicServerGuide() {
    const url = "https://rustdesk.com/pricing";
    canLaunchUrlString(url).then((can) {
      if (can) {
        launchUrlString(url);
      }
    });
  }

  @override
  void initState() {
    super.initState();
    _updateTimer = periodic_immediate(Duration(seconds: 1), () async {
      updateStatus();
    });
  }

  @override
  void dispose() {
    _updateTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isIncomingOnly = bind.isIncomingOnly();
    startServiceWidget() => Offstage(
          offstage: !_svcStopped.value,
          child: InkWell(
                  onTap: () async {
                    await start_service(true);
                  },
                  child: Text(translate("Start service"),
                      style: TextStyle(
                          decoration: TextDecoration.underline, fontSize: em)))
              .marginOnly(left: em),
        );

    setupServerWidget() => Flexible(
          child: Offstage(
            offstage: !(!_svcStopped.value &&
                stateGlobal.svcStatus.value == SvcStatus.ready &&
                _svcIsUsingPublicServer.value),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Text(', ', style: TextStyle(fontSize: em)),
                Flexible(
                  child: InkWell(
                    onTap: onUsePublicServerGuide,
                    child: Row(
                      children: [
                        Flexible(
                          child: Text(
                            translate('setup_server_tip'),
                            style: TextStyle(
                                decoration: TextDecoration.underline,
                                fontSize: em),
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              ],
            ),
          ),
        );

    basicWidget() => Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              height: 8,
              width: 8,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(4),
                color: _svcStopped.value ||
                        stateGlobal.svcStatus.value == SvcStatus.connecting
                    ? kColorWarn
                    : (stateGlobal.svcStatus.value == SvcStatus.ready
                        ? Color.fromARGB(255, 50, 190, 166)
                        : Color.fromARGB(255, 224, 79, 95)),
              ),
            ).marginSymmetric(horizontal: em),
            Container(
              width: isIncomingOnly ? 226 : null,
              child: _buildConnStatusMsg(),
            ),
            // stop
            if (!isIncomingOnly) startServiceWidget(),
            // ready && public
            // No need to show the guide if is custom client.
            if (!isIncomingOnly) setupServerWidget(),
          ],
        );

    return Container(
      height: height,
      child: Obx(() => isIncomingOnly
          ? Column(
              children: [
                basicWidget(),
                Align(
                        child: startServiceWidget(),
                        alignment: Alignment.centerLeft)
                    .marginOnly(top: 2.0, left: 22.0),
              ],
            )
          : basicWidget()),
    ).paddingOnly(right: isIncomingOnly ? 8 : 0);
  }

  _buildConnStatusMsg() {
    widget.onSvcStatusChanged?.call();
    return Text(
      _svcStopped.value
          ? translate("Service is not running")
          : stateGlobal.svcStatus.value == SvcStatus.connecting
              ? translate("connecting_status")
              : stateGlobal.svcStatus.value == SvcStatus.notReady
                  ? translate("not_ready_status")
                  : translate('Ready'),
      style: TextStyle(fontSize: em),
    );
  }

  updateStatus() async {
    final status =
        jsonDecode(await bind.mainGetConnectStatus()) as Map<String, dynamic>;
    final statusNum = status['status_num'] as int;
    if (statusNum == 0) {
      stateGlobal.svcStatus.value = SvcStatus.connecting;
    } else if (statusNum == -1) {
      stateGlobal.svcStatus.value = SvcStatus.notReady;
    } else if (statusNum == 1) {
      stateGlobal.svcStatus.value = SvcStatus.ready;
    } else {
      stateGlobal.svcStatus.value = SvcStatus.notReady;
    }
    _svcIsUsingPublicServer.value = await bind.mainIsUsingPublicServer();
    try {
      stateGlobal.videoConnCount.value = status['video_conn_count'] as int;
    } catch (_) {}
  }
}

/// Connection page for connecting to a remote peer.
class ConnectionPage extends StatefulWidget {
  const ConnectionPage({Key? key}) : super(key: key);

  @override
  State<ConnectionPage> createState() => _ConnectionPageState();
}

/// State for the connection page.
class _ConnectionPageState extends State<ConnectionPage>
    with SingleTickerProviderStateMixin, WindowListener {
  /// Controller for the id input bar.
  final _idController = IDTextEditingController();

  final RxBool _idInputFocused = false.obs;
  final FocusNode _idFocusNode = FocusNode();
  final TextEditingController _idEditingController = TextEditingController();

  String selectedConnectionType = 'Connect';

  bool isWindowMinimized = false;

  final AllPeersLoader _allPeersLoader = AllPeersLoader();

  // https://github.com/flutter/flutter/issues/157244
  Iterable<Peer> _autocompleteOpts = [];

  final _menuOpen = false.obs;

  @override
  void initState() {
    super.initState();
    _allPeersLoader.init(setState);
    _idFocusNode.addListener(onFocusChanged);
    if (_idController.text.isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        final lastRemoteId = await bind.mainGetLastRemoteId();
        if (lastRemoteId != _idController.id) {
          setState(() {
            _idController.id = lastRemoteId;
          });
        }
      });
    }
    Get.put<TextEditingController>(_idEditingController);
    Get.put<IDTextEditingController>(_idController);
    windowManager.addListener(this);
  }

  @override
  void dispose() {
    _idController.dispose();
    windowManager.removeListener(this);
    _allPeersLoader.clear();
    _idFocusNode.removeListener(onFocusChanged);
    _idFocusNode.dispose();
    _idEditingController.dispose();
    if (Get.isRegistered<IDTextEditingController>()) {
      Get.delete<IDTextEditingController>();
    }
    if (Get.isRegistered<TextEditingController>()) {
      Get.delete<TextEditingController>();
    }
    super.dispose();
  }

  @override
  void onWindowEvent(String eventName) {
    super.onWindowEvent(eventName);
    if (eventName == 'minimize') {
      isWindowMinimized = true;
    } else if (eventName == 'maximize' || eventName == 'restore') {
      if (isWindowMinimized && isWindows) {
        // windows can't update when minimized.
        Get.forceAppUpdate();
      }
      isWindowMinimized = false;
    }
  }

  @override
  void onWindowEnterFullScreen() {
    // Remove edge border by setting the value to zero.
    stateGlobal.resizeEdgeSize.value = 0;
  }

  @override
  void onWindowLeaveFullScreen() {
    // Restore edge border to default edge size.
    stateGlobal.resizeEdgeSize.value = stateGlobal.isMaximized.isTrue
        ? kMaximizeEdgeSize
        : windowResizeEdgeSize;
  }

  @override
  void onWindowClose() {
    super.onWindowClose();
    bind.mainOnMainWindowClose();
  }

  void onFocusChanged() {
    _idInputFocused.value = _idFocusNode.hasFocus;
    if (_idFocusNode.hasFocus) {
      if (_allPeersLoader.needLoad) {
        _allPeersLoader.getAllPeers();
      }

      final textLength = _idEditingController.value.text.length;
      // Select all to facilitate removing text, just following the behavior of address input of chrome.
      _idEditingController.selection =
          TextSelection(baseOffset: 0, extentOffset: textLength);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isOutgoingOnly = bind.isOutgoingOnly();
    return Stack(
      children: [
        Column(
          children: [
            Expanded(
                child: Column(
              children: [
                Row(
                  children: [
                    Flexible(child: _buildRemoteIDTextField(context)),
                  ],
                ).marginOnly(top: 22),
                // ChainRemote: 세련된 페이드 그라디언트 분리선 + 영역 라벨
                const SizedBox(height: 18),
                const _FadeSectionDivider(label: '거래처 목록'),
                const SizedBox(height: 6),
                Expanded(child: PeerTabPage()),
              ],
            ).paddingOnly(left: 12.0)),
            if (!isOutgoingOnly) const Divider(height: 1),
            if (!isOutgoingOnly) OnlineStatusWidget()
          ],
        ),
        // 우하단 ChainRemote 버전 라벨 — 사용자가 한눈에 현재 버전 확인
        Positioned(
          right: 8,
          bottom: 4,
          child: IgnorePointer(
            child: Text(
              'v$chainRemoteVersion',
              style: const TextStyle(
                fontSize: 10,
                color: Color(0xFF9E9E9E),
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Callback for the connect button.
  /// Connects to the selected peer.
  void onConnect(
      {bool isFileTransfer = false,
      bool isViewCamera = false,
      bool isTerminal = false}) {
    var id = _idController.id;
    if (id.isEmpty) return;
    void doConnect() => connect(context, id,
        isFileTransfer: isFileTransfer,
        isViewCamera: isViewCamera,
        isTerminal: isTerminal);
    // ChainRemote: 미등록 ID 접속 시 안내 — 오타로 무반응 클릭을 반복하는 문제 방지.
    //   등록 거래처(전체 거래처 = 패널 DB) 목록에 없으면 확인 다이얼로그(취소 / 그래도 접속).
    //   목록이 아직 로드 안 됐으면(빈 배열) 오판 방지로 바로 접속. 하드 차단 아님 —
    //   방금 설치한 새 에이전트 ID 를 수동 접속하는 정상 케이스를 막지 않기 위함.
    final customers = gFFI.allCustomersPeersModel.peers;
    final known = customers.any((p) => p.id == id);
    if (customers.isNotEmpty && !known) {
      gFFI.dialogManager.show((setState, close, context) => CustomAlertDialog(
            title: Text(translate('등록되지 않은 ID')),
            content: Text(
                '입력한 ID  ${formatID(id)}  는 등록된 거래처가 아닙니다.\nID 를 다시 확인해 주세요. 그래도 접속할까요?'),
            actions: [
              dialogButton('취소', onPressed: close, isOutline: true),
              dialogButton('그래도 접속', onPressed: () {
                close();
                doConnect();
              }),
            ],
          ));
      return;
    }
    doConnect();
  }

  /// UI for the remote ID TextField.
  /// Search for a peer.
  Widget _buildRemoteIDTextField(BuildContext context) {
    // ChainRemote: 외곽 박스/제목 제거 — 미니멀 단일 행
    var w = Container(
      width: 320 + 20 * 2,
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 16),
      child: Ink(
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                    child: RawAutocomplete<Peer>(
                  optionsBuilder: (TextEditingValue textEditingValue) {
                    if (textEditingValue.text == '') {
                      _autocompleteOpts = const Iterable<Peer>.empty();
                    } else if (_allPeersLoader.peers.isEmpty &&
                        !_allPeersLoader.isPeersLoaded) {
                      Peer emptyPeer = Peer(
                        id: '',
                        username: '',
                        hostname: '',
                        alias: '',
                        platform: '',
                        tags: [],
                        hash: '',
                        password: '',
                        forceAlwaysRelay: false,
                        rdpPort: '',
                        rdpUsername: '',
                        loginName: '',
                        device_group_name: '',
                        note: '',
                      );
                      _autocompleteOpts = [emptyPeer];
                    } else {
                      String textWithoutSpaces =
                          textEditingValue.text.replaceAll(" ", "");
                      if (int.tryParse(textWithoutSpaces) != null) {
                        textEditingValue = TextEditingValue(
                          text: textWithoutSpaces,
                          selection: textEditingValue.selection,
                        );
                      }
                      String textToFind = textEditingValue.text.toLowerCase();
                      _autocompleteOpts = _allPeersLoader.peers
                          .where((peer) =>
                              peer.id.toLowerCase().contains(textToFind) ||
                              peer.username
                                  .toLowerCase()
                                  .contains(textToFind) ||
                              peer.hostname
                                  .toLowerCase()
                                  .contains(textToFind) ||
                              peer.alias.toLowerCase().contains(textToFind))
                          .toList();
                    }
                    return _autocompleteOpts;
                  },
                  focusNode: _idFocusNode,
                  textEditingController: _idEditingController,
                  fieldViewBuilder: (
                    BuildContext context,
                    TextEditingController fieldTextEditingController,
                    FocusNode fieldFocusNode,
                    VoidCallback onFieldSubmitted,
                  ) {
                    updateTextAndPreserveSelection(
                        fieldTextEditingController, _idController.text);
                    return Obx(() => TextField(
                          autocorrect: false,
                          enableSuggestions: false,
                          keyboardType: TextInputType.visiblePassword,
                          focusNode: fieldFocusNode,
                          style: const TextStyle(
                            fontFamily: 'WorkSans',
                            fontSize: 18,
                            height: 1.4,
                            color: MyTheme.neuInk,
                            letterSpacing: 1,
                          ),
                          maxLines: 1,
                          cursorColor:
                              Theme.of(context).textTheme.titleLarge?.color,
                          decoration: InputDecoration(
                              filled: true,
                              fillColor: MyTheme.neuInset,
                              counterText: '',
                              hintText: _idInputFocused.value
                                  ? null
                                  : translate('Enter Remote ID'),
                              hintStyle: const TextStyle(
                                  color: Color(0xFF9DA7B4),
                                  fontWeight: FontWeight.w600),
                              contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 17, vertical: 15),
                              border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(13),
                                  borderSide: BorderSide.none),
                              enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(13),
                                  borderSide: BorderSide.none),
                              focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(13),
                                  borderSide: BorderSide.none)),
                          controller: fieldTextEditingController,
                          inputFormatters: [IDTextInputFormatter()],
                          onChanged: (v) {
                            _idController.id = v;
                          },
                          onSubmitted: (_) {
                            onConnect();
                          },
                        ).workaroundFreezeLinuxMint());
                  },
                  onSelected: (option) {
                    setState(() {
                      _idController.id = option.id;
                      FocusScope.of(context).unfocus();
                    });
                  },
                  optionsViewBuilder: (BuildContext context,
                      AutocompleteOnSelected<Peer> onSelected,
                      Iterable<Peer> options) {
                    options = _autocompleteOpts;
                    double maxHeight = options.length * 50;
                    if (options.length == 1) {
                      maxHeight = 52;
                    } else if (options.length == 3) {
                      maxHeight = 146;
                    } else if (options.length == 4) {
                      maxHeight = 193;
                    }
                    maxHeight = maxHeight.clamp(0, 200);

                    return Align(
                      alignment: Alignment.topLeft,
                      child: Container(
                          decoration: BoxDecoration(
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.3),
                                blurRadius: 5,
                                spreadRadius: 1,
                              ),
                            ],
                          ),
                          child: ClipRRect(
                              borderRadius: BorderRadius.circular(5),
                              child: Material(
                                elevation: 4,
                                child: ConstrainedBox(
                                  constraints: BoxConstraints(
                                    maxHeight: maxHeight,
                                    maxWidth: 319,
                                  ),
                                  child: _allPeersLoader.peers.isEmpty &&
                                          !_allPeersLoader.isPeersLoaded
                                      ? Container(
                                          height: 80,
                                          child: Center(
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          ))
                                      : Padding(
                                          padding:
                                              const EdgeInsets.only(top: 5),
                                          child: ListView(
                                            children: options
                                                .map((peer) =>
                                                    AutocompletePeerTile(
                                                        onSelect: () =>
                                                            onSelected(peer),
                                                        peer: peer))
                                                .toList(),
                                          ),
                                        ),
                                ),
                              ))),
                    );
                  },
                )),
                // ChainRemote: 연결 버튼을 ID 입력란 우측으로 이동
                const SizedBox(width: 10),
                SizedBox(
                  height: 50.0,
                  child: GestureDetector(
                    onTap: () {
                      onConnect();
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(13),
                        gradient: const LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [MyTheme.neuBtnTop, MyTheme.neuBtnBottom],
                        ),
                        boxShadow: [
                          BoxShadow(
                              color: const Color(0x6B4669AF),
                              offset: const Offset(6, 6),
                              blurRadius: 13),
                          BoxShadow(
                              color: MyTheme.neuShadowLight,
                              offset: const Offset(-5, -5),
                              blurRadius: 11),
                        ],
                      ),
                      child: Text(translate("Connect"),
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w800)),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  height: 50.0,
                  width: 44.0,
                  decoration: BoxDecoration(
                    color: MyTheme.neuSurface,
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                          color: MyTheme.neuShadowDark,
                          offset: const Offset(4, 4),
                          blurRadius: 9),
                      BoxShadow(
                          color: MyTheme.neuShadowLight,
                          offset: const Offset(-4, -4),
                          blurRadius: 8),
                    ],
                  ),
                  child: Center(
                    child: StatefulBuilder(
                      builder: (context, setState) {
                        var offset = Offset(0, 0);
                        return Obx(() => InkWell(
                              child: _menuOpen.value
                                  ? Transform.rotate(
                                      angle: pi,
                                      child: Icon(IconFont.more, size: 14),
                                    )
                                  : Icon(IconFont.more, size: 14),
                              onTapDown: (e) {
                                offset = e.globalPosition;
                              },
                              onTap: () async {
                                _menuOpen.value = true;
                                final x = offset.dx;
                                final y = offset.dy;
                                await mod_menu
                                    .showMenu(
                                  context: context,
                                  position: RelativeRect.fromLTRB(x, y, x, y),
                                  items: [
                                    (
                                      'Transfer file',
                                      () => onConnect(isFileTransfer: true)
                                    ),
                                    (
                                      'View camera',
                                      () => onConnect(isViewCamera: true)
                                    ),
                                    (
                                      '${translate('Terminal')} (beta)',
                                      () => onConnect(isTerminal: true)
                                    ),
                                    // ChainRemote: ID 입력 → 즐겨찾기 추가. 최근세션 누적에 의존 안 함.
                                    //   auto-enroll로 등록된 거래처면 즐겨찾기에서 거래처명 자동 매핑.
                                    (
                                      'Add to Favorites',
                                      () {
                                        final favId = _idController.id;
                                        if (favId.isNotEmpty) {
                                          bind.chainremoteAddFavorite(
                                              remoteId: favId);
                                          bind.chainremoteLoadFavorites();
                                          showToast(translate('Successful'));
                                        }
                                      }
                                    ),
                                  ]
                                      .map((e) => MenuEntryButton<String>(
                                            childBuilder: (TextStyle? style) =>
                                                Text(
                                              translate(e.$1),
                                              style: style,
                                            ),
                                            proc: () => e.$2(),
                                            padding: EdgeInsets.symmetric(
                                                horizontal:
                                                    kDesktopMenuPadding.left),
                                            dismissOnClicked: true,
                                          ))
                                      .map((e) => e.build(
                                          context,
                                          const MenuConfig(
                                              commonColor: CustomPopupMenuTheme
                                                  .commonColor,
                                              height:
                                                  CustomPopupMenuTheme.height,
                                              dividerHeight:
                                                  CustomPopupMenuTheme
                                                      .dividerHeight)))
                                      .expand((i) => i)
                                      .toList(),
                                  elevation: 8,
                                )
                                    .then((_) {
                                  _menuOpen.value = false;
                                });
                              },
                            ));
                      },
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    return Container(
        constraints: const BoxConstraints(maxWidth: 600), child: w);
  }
}

// ChainRemote: 페이드 그라디언트 분리선 + 가운데 라벨 칩.
//   - 창 좌우 가장자리에서 28px 여백 유지 (창 크기와 무관)
//   - 가장자리 쪽: 페이드 / 가운데 칩 쪽: 진한 브랜드 블루
class _FadeSectionDivider extends StatelessWidget {
  final String label;
  const _FadeSectionDivider({Key? key, required this.label}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    const brandBlue = Color(0xFF1E5BFF);
    final lineSolid = brandBlue.withOpacity(0.45);
    final lineFade = brandBlue.withOpacity(0.05);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Container(
              height: 1,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [lineFade, lineSolid],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
              decoration: BoxDecoration(
                color: brandBlue.withOpacity(0.10),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                    color: brandBlue.withOpacity(0.30), width: 0.8),
              ),
              child: Text(
                label,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: brandBlue,
                  letterSpacing: 0.4,
                ),
              ),
            ),
          ),
          Expanded(
            child: Container(
              height: 1,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [lineSolid, lineFade],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
