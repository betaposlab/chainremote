// original cm window in Sciter version.

import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:dash_chat_2/dash_chat_2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hbb/common/shared_state.dart';
import 'package:flutter_hbb/common/widgets/audio_input.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/desktop/widgets/tabbar_widget.dart';
import 'package:flutter_hbb/models/chat_model.dart';
import 'package:flutter_hbb/models/cm_file_model.dart';
import 'package:flutter_hbb/utils/platform_channel.dart';
import 'package:get/get.dart';
import 'package:percent_indicator/linear_percent_indicator.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../common.dart';
import '../../common/widgets/chat_page.dart';
import '../../models/file_model.dart';
import '../../models/platform_model.dart';
import '../../models/server_model.dart';

class DesktopServerPage extends StatefulWidget {
  const DesktopServerPage({Key? key}) : super(key: key);

  @override
  State<DesktopServerPage> createState() => _DesktopServerPageState();
}

class _DesktopServerPageState extends State<DesktopServerPage>
    with WindowListener, AutomaticKeepAliveClientMixin {
  final tabController = gFFI.serverModel.tabController;

  _DesktopServerPageState() {
    gFFI.ffiModel.updateEventListener(gFFI.sessionId, "");
    Get.put<DesktopTabController>(tabController);
    tabController.onRemoved = (_, id) {
      onRemoveId(id);
    };
  }

  Timer? _keepBannerOnTopTimer;

  @override
  void initState() {
    windowManager.addListener(this);
    super.initState();
    // KSCAT UAC 같은 보안 데스크톱을 거치고 나면 CM '원격지원 중' 배너가 topmost 를
    // 잃고 뒤로 밀려 안 보인다. 거래처는 자기가 원격당하는 중인지 늘 알아야 하므로
    // (투명성은 거래처 통제권·신뢰의 핵심), 활성 세션 동안 always-on-top 을 주기적으로
    // 다시 건다. 이미 topmost 면 OS 가 z-order 를 안 바꿔 no-op 이라 평소엔 영향 없다.
    _keepBannerOnTopTimer =
        Timer.periodic(const Duration(seconds: 2), (_) async {
      if (!mounted) return;
      // 수락 대기(authorized=false) 클라이언트도 포함한다. 잠금 화면 중에 온 요청의
      // 수락 카드가 잠금 해제(보안 데스크톱 복귀) 후 숨거나 z-order 에 묻힌 채 남는
      // 걸 같은 복원 루프로 살린다(배너와 똑같은 함정, 2026-06-12 삼익 케이스).
      final hasActive =
          gFFI.serverModel.clients.any((c) => !c.disconnected);
      if (!hasActive) return;
      try {
        // 보안 데스크톱(UAC)을 거치면 배너 창이 topmost 만 잃는 게 아니라 아예 숨거나
        // 최소화될 수 있다. 그래서 setAlwaysOnTop 만으론 부족하다(1.4.11 에선 포커스도
        // 안 뺏고 안 떴다 = 숨은 상태). 숨었으면 show, 최소화면 restore 후 topmost 재적용.
        final visible = await windowManager.isVisible();
        final minimized = await windowManager.isMinimized();
        if (!visible || minimized) {
          _bannerDiag('restore: visible=$visible minimized=$minimized');
          // ★활성화 없이 복원한다(SW_SHOWNOACTIVATE). 종전엔 restore()+show() 로 창을
          //   foreground 로 끌어올렸는데, POS 의 "바탕화면 보기"(MinimizeAll)로 배너까지
          //   최소화된 직후 이 루프가 돌면 배너가 포커스를 가져가며 셸의 show-desktop
          //   상태가 풀려, 방금 최소화한 POS 앱이 도로 떠버렸다(태조산 2026-07-25).
          //   SW_SHOWNOACTIVATE 는 최소화 복원도 함께 처리하므로 restore() 가 대개 불필요하다.
          await windowManager.show(inactive: true);
          // 폴백: 그래도 최소화가 안 풀리는 환경이면 종전 경로로 복원한다. 배너가 안 보이면
          //   거래처가 원격 중인지 알 수 없어(투명성) 그게 더 큰 손해라, 보이는 쪽을 택한다.
          if (await windowManager.isMinimized()) {
            await windowManager.restore();
            await windowManager.show(inactive: true);
          }
        }
        await windowManager.setAlwaysOnTop(true);
      } catch (e) {
        _bannerDiag('err: $e');
      }
    });
  }

  @override
  void dispose() {
    _keepBannerOnTopTimer?.cancel();
    windowManager.removeListener(this);
    super.dispose();
  }

  // 배너 복원 이벤트를 고정 경로 updater.log 에 남긴다(원격으로 쉽게 확인하려고).
  void _bannerDiag(String msg) {
    if (!Platform.isWindows) return;
    try {
      File(r'C:\ProgramData\ChainRemote\updater.log').writeAsStringSync(
          '[banner] $msg\n',
          mode: FileMode.append,
          flush: true);
    } catch (_) {}
  }

  @override
  void onWindowClose() {
    // 활성 연결이 하나라도 있으면 X 버튼은 종료가 아니라 트레이로 숨긴다.
    // 거래처나 직원이 X 를 잘못 눌러 세션이 끊기는 사고를 막는다.
    // 진짜로 끊으려면 각 탭의 "연결 해제" 버튼을 써야 한다.
    if (gFFI.serverModel.clients.isNotEmpty) {
      windowManager.hide();
      return;
    }
    Future.wait([gFFI.serverModel.closeAll(), gFFI.close()]).then((_) {
      if (isMacOS) {
        RdPlatformChannel.instance.terminate();
      } else {
        windowManager.setPreventClose(false);
        windowManager.close();
      }
    });
    super.onWindowClose();
  }

  void onRemoveId(String id) {
    if (tabController.state.value.tabs.isEmpty) {
      windowManager.close();
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: gFFI.serverModel),
        ChangeNotifierProvider.value(value: gFFI.chatModel),
      ],
      child: Consumer<ServerModel>(
        builder: (context, serverModel, child) {
          final body = Scaffold(
            backgroundColor: Theme.of(context).colorScheme.background,
            body: ConnectionManager(),
          );
          return isLinux
              ? buildVirtualWindowFrame(context, body)
              : workaroundWindowBorder(
                  context,
                  Container(
                    decoration: BoxDecoration(
                        border:
                            Border.all(color: MyTheme.color(context).border!)),
                    child: body,
                  ));
        },
      ),
    );
  }

  @override
  bool get wantKeepAlive => true;
}

class ConnectionManager extends StatefulWidget {
  @override
  State<StatefulWidget> createState() => ConnectionManagerState();
}

class ConnectionManagerState extends State<ConnectionManager>
    with WidgetsBindingObserver {
  final RxBool _controlPageBlock = false.obs;
  final RxBool _sidePageBlock = false.obs;

  ConnectionManagerState() {
    gFFI.serverModel.tabController.onSelected = (client_id_str) {
      final client_id = int.tryParse(client_id_str);
      if (client_id != null) {
        final client =
            gFFI.serverModel.clients.firstWhereOrNull((e) => e.id == client_id);
        if (client != null) {
          gFFI.chatModel.changeCurrentKey(MessageKey(client.peerId, client.id));
          if (client.unreadChatMessageCount.value > 0) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              client.unreadChatMessageCount.value = 0;
              gFFI.chatModel.showChatPage(MessageKey(client.peerId, client.id));
            });
          }
          windowManager.setTitle(getWindowNameWithId(client.peerId));
          gFFI.cmFileModel.updateCurrentClientId(client.id);
        }
      }
    };
    gFFI.chatModel.isConnManager = true;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      if (!allowRemoteCMModification()) {
        shouldBeBlocked(_controlPageBlock, null);
        shouldBeBlocked(_sidePageBlock, null);
      }
    }
  }

  @override
  void initState() {
    gFFI.serverModel.updateClientState();
    WidgetsBinding.instance.addObserver(this);
    super.initState();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _agentChatIdleTimer?.cancel();
    _agentChatInput.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final serverModel = Provider.of<ServerModel>(context);
    pointerHandler(PointerEvent e) {
      if (serverModel.cmHiddenTimer != null) {
        serverModel.cmHiddenTimer!.cancel();
        serverModel.cmHiddenTimer = null;
        debugPrint("CM hidden timer has been canceled");
      }
    }

    // 피제어될 때(거래처 Agent, 본사 HQ 옵션B+ 양쪽 다) 우상단에 슬림 수락 카드,
    // 이어서 "원격지원 중" 배너 + 종료만 보인다. HQ 가 피제어될 때도 피지원자가 원격
    // 진행을 알고 끊을 수 있어야 하므로, RustDesk 기본 CM(아래) 대신 이 배너로 통일한다.
    return _buildAgentSupportBanner(serverModel);

    return serverModel.clients.isEmpty
        ? Column(
            children: [
              buildTitleBar(),
              Expanded(
                child: Center(
                  child: Text(translate("Waiting")),
                ),
              ),
            ],
          )
        : Listener(
            onPointerDown: pointerHandler,
            onPointerMove: pointerHandler,
            child: DesktopTab(
              showTitle: false,
              showMaximize: false,
              showMinimize: true,
              showClose: true,
              onWindowCloseButton: handleWindowCloseButton,
              controller: serverModel.tabController,
              selectedBorderColor: MyTheme.accent,
              maxLabelWidth: 100,
              tail: null, //buildScrollJumper(),
              tabBuilder: (key, icon, label, themeConf) {
                final client = serverModel.clients
                    .firstWhereOrNull((client) => client.id.toString() == key);
                return Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Tooltip(
                        message: key,
                        waitDuration: Duration(seconds: 1),
                        child: label),
                    unreadMessageCountBuilder(client?.unreadChatMessageCount)
                        .marginOnly(left: 4),
                  ],
                );
              },
              pageViewBuilder: (pageView) => LayoutBuilder(
                builder: (context, constrains) {
                  var borderWidth = 0.0;
                  if (constrains.maxWidth >
                      kConnectionManagerWindowSizeClosedChat.width) {
                    borderWidth = kConnectionManagerWindowSizeOpenChat.width -
                        constrains.maxWidth;
                  } else {
                    borderWidth = kConnectionManagerWindowSizeClosedChat.width -
                        constrains.maxWidth;
                  }
                  if (borderWidth < 0 || borderWidth > 50) {
                    borderWidth = 0;
                  }
                  final realClosedWidth =
                      kConnectionManagerWindowSizeClosedChat.width -
                          borderWidth;
                  final realChatPageWidth =
                      constrains.maxWidth - realClosedWidth;
                  final row = Row(children: [
                    if (constrains.maxWidth >
                        kConnectionManagerWindowSizeClosedChat.width)
                      Consumer<ChatModel>(
                          builder: (_, model, child) => SizedBox(
                                width: realChatPageWidth,
                                child: allowRemoteCMModification()
                                    ? buildSidePage()
                                    : buildRemoteBlock(
                                        child: buildSidePage(),
                                        block: _sidePageBlock,
                                        mask: true),
                              )),
                    SizedBox(
                        width: realClosedWidth,
                        child: SizedBox(
                            width: realClosedWidth,
                            child: allowRemoteCMModification()
                                ? pageView
                                : buildRemoteBlock(
                                    child: _buildKeyEventBlock(pageView),
                                    block: _controlPageBlock,
                                    mask: false,
                                  ))),
                  ]);
                  return Container(
                    color: Theme.of(context).scaffoldBackgroundColor,
                    child: row,
                  );
                },
              ),
            ),
          );
  }

  Widget buildSidePage() {
    final selected = gFFI.serverModel.tabController.state.value.selected;
    if (selected < 0 || selected >= gFFI.serverModel.clients.length) {
      return Offstage();
    }
    final clientType = gFFI.serverModel.clients[selected].type_();
    if (clientType == ClientType.file) {
      return _FileTransferLogPage();
    } else {
      return ChatPage(type: ChatPageType.desktopCM);
    }
  }

  Widget _buildKeyEventBlock(Widget child) {
    return ExcludeFocus(child: child, excluding: true);
  }

  Widget buildTitleBar() {
    return SizedBox(
      height: kDesktopRemoteTabBarHeight,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const _AppIcon(),
          Expanded(
            child: GestureDetector(
              onPanStart: (d) {
                windowManager.startDragging();
              },
              child: Container(
                color: Theme.of(context).colorScheme.background,
              ),
            ),
          ),
          const SizedBox(
            width: 4.0,
          ),
          const _CloseButton()
        ],
      ),
    );
  }

  Widget buildScrollJumper() {
    final offstage = gFFI.serverModel.clients.length < 2;
    final sc = gFFI.serverModel.tabController.state.value.scrollController;
    return Offstage(
        offstage: offstage,
        child: Row(
          children: [
            ActionIcon(
                icon: Icons.arrow_left, iconSize: 22, onTap: sc.backward),
            ActionIcon(
                icon: Icons.arrow_right, iconSize: 22, onTap: sc.forward),
          ],
        ));
  }

  Future<bool> handleWindowCloseButton() async {
    var tabController = gFFI.serverModel.tabController;
    final connLength = tabController.length;
    if (connLength <= 1) {
      windowManager.close();
      return true;
    } else {
      final bool res;
      if (!option2bool(kOptionEnableConfirmClosingTabs,
          bind.mainGetLocalOption(key: kOptionEnableConfirmClosingTabs))) {
        res = true;
      } else {
        res = await closeConfirmDialog();
      }
      if (res) {
        windowManager.close();
      }
      return res;
    }
  }

  // Agent 전용 CM UI (클릭 수락 모드).
  // 대기 중(미승인) 연결이 있으면 [수락]/[거부] 카드를, 활성 세션이면 "원격지원 중"
  // 인디케이터를 보인다. 상태에 따라 CM 창 크기·위치(상단 중앙, 우상단 X 를 안 가림)를 맞춘다.
  bool? _agentPendingShown;

  // CM 창 크기 조정의 단일 창구(single-writer) 세대 카운터.
  // 상태 전이가 있을 때마다 증가시키고, 진행 중인 reconcile 루프는 매 틱 이 값을 검사해
  // 자기 세대가 아니면 즉시 죽는다. 예전엔 세대 개념이 없어, pending 이 빠졌다 새로 들어오면
  // 배너(220x34) 목표 루프와 카드(360x200) 목표 루프가 동시에 살아 창 크기를 놓고 싸웠다
  // → 늦게 도는 루프가 마지막 라이터가 되어 카드가 배너 크기로 쪼그라들어 버튼이 잘리거나
  //   (진희씨컴 1.4.46), 반대로 반복해서 펼쳐지는 점멸(1.4.45)이 났다.
  // 네이티브 사실(window_manager rustdesk 포크 git 85789bfe 소스 확인): Minimize/Restore 는
  //   PostMessage(WM_SYSCOMMAND) 라 비동기다. 그래서 reconcile 은 early-break 하지 않고
  //   settle 창(~1.1s) 동안 목표 크기를 계속 유지해 늦게 도착하는 네이티브 스냅백도 교정한다.
  int _cmGeomGen = 0;

  // 채팅을 펼쳤는지. 본사가 말을 걸면 자동으로 펼치고(안 읽은 수가 오르면), 피지원자가
  // 배너의 말풍선을 눌러 접을 수 있다. ★펼칠 때 창을 focus 하지 않는다 — 포스 바코드
  // 스캐너 입력을 뺏지 않으려는 것이고, 우리 창은 이미 topmost 라 끌어올릴 필요도 없다.
  bool _agentChatOpen = false;
  // reconcile 루프를 다시 킥할지 판단하려고 마지막으로 반영한 채팅 상태를 들고 있는다.
  bool _agentGeomChatShown = false;
  final TextEditingController _agentChatInput = TextEditingController();

  // 조용해지면 채팅을 스스로 접는다.
  //
  // 사장님은 채팅을 닫을 생각을 안 한다. 본사가 자기 쪽 채팅창을 닫아도 거래처 화면엔
  // 그대로 남아 포스 화면을 계속 가린다(2026-08-14 실측). 본사가 닫을 때 같이 닫으려면
  // "채팅창 닫음" 프로토콜 메시지가 필요한데 RustDesk 엔 없고, 코어 통신 경로를 건드릴
  // 값어치도 없다 — 사장님이 아직 읽는 중일 수도 있다. 로컬 타이머면 본사가 뭘 하든,
  // 연결이 끊겨도 항상 동작한다. Sciter 쪽(cm.tis)과 같은 값·같은 규칙.
  static const Duration _kChatIdleCollapse = Duration(seconds: 120);
  Timer? _agentChatIdleTimer;
  int _agentChatSeenMsgCount = -1;

  void _scheduleAgentChatCollapse() {
    _agentChatIdleTimer?.cancel();
    _agentChatIdleTimer = Timer(_kChatIdleCollapse, () {
      if (!mounted || !_agentChatOpen) return;
      // 답장을 쓰는 중이면 접지 않는다 — 쓰던 글이 사라지면 최악이다.
      if (_agentChatInput.text.trim().isNotEmpty) {
        _scheduleAgentChatCollapse();
        return;
      }
      setState(() => _agentChatOpen = false);
    });
  }

  // 본사 채팅창 신호를 따라가려고 마지막으로 반영한 값. 값이 바뀔 때만 움직인다 —
  //   매번 따라가면 거래처가 직접 접은 걸 다음 build 가 도로 펴 버린다.
  bool? _agentPeerChatShown;

  Widget _buildAgentSupportBanner(ServerModel serverModel) {
    final pending = serverModel.clients
        .firstWhereOrNull((c) => !c.authorized && !c.disconnected);
    final activeClient = serverModel.clients
        .firstWhereOrNull((c) => c.authorized && !c.disconnected);
    final wantPending = pending != null;
    // 본사가 자기 채팅창을 열거나 닫으면 따라간다(1.4.117+ HQ 만 이 신호를 보낸다).
    //   본사가 닫으면 거래처 화면도 곧바로 접혀 포스 화면이 돌아온다 — 120초를 안 기다린다.
    //   ★값이 바뀐 순간에만 반응한다. 매 build 마다 따라가면 거래처가 말풍선으로 직접
    //     접은 것을 다음 build 가 도로 펴 버린다.
    final peerChat = crAgentChatPanelOpen.value;
    if (_agentPeerChatShown != peerChat) {
      _agentPeerChatShown = peerChat;
      if (activeClient != null) {
        _agentChatOpen = peerChat;
        if (peerChat) {
          activeClient.unreadChatMessageCount.value = 0;
          _scheduleAgentChatCollapse();
        } else {
          _agentChatIdleTimer?.cancel();
        }
      }
    }
    // 본사가 말을 걸면(안 읽은 수 > 0) 자동으로 펼친다. 배너만 뜬 채로 메시지가 오면
    // 피지원자는 온 줄도 모른다 — 그게 여태의 상태였다.
    if (!_agentChatOpen &&
        activeClient != null &&
        activeClient.unreadChatMessageCount.value > 0) {
      _agentChatOpen = true;
      activeClient.unreadChatMessageCount.value = 0;
      _scheduleAgentChatCollapse();
    }
    // 활성 세션이 끝나면 접어 둔다(다음 세션이 배너로 시작하게).
    if (activeClient == null && _agentChatOpen) {
      _agentChatOpen = false;
      _agentChatIdleTimer?.cancel();
    }
    if (activeClient == null) {
      // 다음 세션이 옛 신호를 물려받지 않게 원위치.
      crAgentChatPanelOpen.value = false;
      _agentPeerChatShown = null;
    }
    // 대기↔활성↔채팅 전환이 있을 때만 CM 창 크기 reconcile 을 새로 킥한다(build 부작용 회피 post-frame).
    if (_agentPendingShown != wantPending ||
        _agentGeomChatShown != _agentChatOpen) {
      _agentPendingShown = wantPending;
      _agentGeomChatShown = _agentChatOpen;
      final int myGen = ++_cmGeomGen; // 이 킥이 이전 진행 루프를 모두 무효화한다
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        // settle 창(~1.1s) 동안 목표 크기로 수렴시키고 유지한다. 매 틱:
        //  ① 세대가 바뀌었으면(더 최근 전이) 즉시 종료 — 반대 목표 루프와 경합하지 않는다.
        //  ② 최소화 중이면 그 틱 스킵 — iconic 창의 getSize 는 -32000 쓰레기값이라 가드가 샌다.
        //  ③ 목표는 매 틱 라이브 상태로 재계산(클로저 캡처 금지) — 전이 중첩에도 항상 정답.
        //  ④ 이미 목표 크기면 재적용 안 함(불필요한 네이티브 리사이즈=펼쳐짐 방지). break 는 안 한다
        //     — 늦은 네이티브 스냅백을 남은 틱이 되돌려야 하므로.
        for (var i = 0; i < 6; i++) {
          await Future.delayed(Duration(milliseconds: i == 0 ? 80 : 200));
          if (!mounted || myGen != _cmGeomGen) return;
          try {
            if (await windowManager.isMinimized()) continue;
            // ★목표는 매 틱 라이브로 재계산한다(클로저 캡처 금지). 채팅 펼침도 여기서
            //   같이 본다 — 안 그러면 채팅을 펼친 순간 이 루프가 다음 틱에 배너 크기로
            //   되돌려 방금 펼친 창을 도로 접는다.
            final live = gFFI.serverModel.clients
                .any((c) => !c.authorized && !c.disconnected);
            final target = live
                ? kAgentAcceptCardSize
                : (_agentChatOpen
                    ? kAgentSupportChatSize
                    : kAgentSupportBannerSize);
            final cur = await windowManager.getSize();
            final same = (cur.width - target.width).abs() < 2 &&
                (cur.height - target.height).abs() < 2;
            if (!same) {
              await windowManager.setSizeAlignment(target, Alignment.topCenter);
            }
          } catch (_) {}
        }
      });
    }
    if (wantPending) {
      return _buildAgentAcceptCard(serverModel, pending);
    }
    return _buildAgentIndicator(activeClient);
  }

  // 본사 원격 요청. 거래처가 직접 [수락]/[거부]를 누른다.
  //
  // ★2026-08-06 재디자인 — Sciter(Win7) cm.css 와 같은 얼굴이다. 종전엔 흰 상자에 빨간
  // 테두리 3px 이라 윈도우 오류창처럼 보였고, 본사 ID 9자리를 그대로 노출했다(사장님에게
  // 숫자는 아무 의미가 없다). 밝은 포스 바탕화면 위에서는 어두운 카드가 저절로 눈에 띄어,
  // 시선을 끌려고 넣었던 빨간 테두리 자체가 필요 없어진다. 맥동은 [수락] 버튼으로 옮겼다.
  //
  // 두 엔진이 같은 그림이 되도록 그림자·그라디언트를 쓰지 않는다 — Sciter 엔 없는 기능이라
  // 여기서만 쓰면 Win7 과 Win10/11 이 다르게 보인다.
  Widget _buildAgentAcceptCard(ServerModel serverModel, Client client) {
    // 대리점 상호. heartbeat 가 받아 캐시해 둔 값이고, 아직 못 받았으면(구버전 서버 ·
    // 첫 하트비트 전) "본사"로 대체한다.
    //
    // ★LocalConfig 로 읽으면 안 된다. heartbeat 는 서비스(LocalSystem)에서 돌고 이 카드는
    // 사용자 세션에서 뜨는데, LocalConfig 는 그 둘이 서로 다른 파일이다 — 서비스가 캐시한
    // 값이 여기 절대 안 보여서 모든 거래처가 "본사"로만 떴다. 지금은 양쪽이 같이 읽는
    // ProgramData 파일을 본다(Rust chainremote_heartbeat::read_support_name).
    String who = '';
    try {
      who = bind.mainGetCommonSync(key: 'chainremote-support-name').trim();
    } catch (e) {
      debugPrint('support name read failed: $e');
    }
    if (who.isEmpty) who = '본사';
    return Material(
      color: const Color(0xFF22242B),
      child: Container(
        decoration: BoxDecoration(
          // 굵은 파랑 테두리. 포스 모니터 베젤이 검은 게 대부분이라 옅은 회색 1px 로는
          // 어두운 카드의 윗변이 베젤에 묻혀 "창이 잘렸다"고 읽힌다. Sciter 와 같은 값.
          border: Border.all(color: const Color(0xFF5A8CFF), width: 3),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // 좌측 컬러 기둥 + 모니터 글리프
            Container(
              width: 64,
              color: const Color(0xFF1740C4),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 34,
                      height: 30,
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.white, width: 3),
                        borderRadius: BorderRadius.circular(6),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Container(
                      width: 14,
                      height: 3,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(17, 16, 17, 15),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('원격지원 요청',
                        style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                            color: Colors.white)),
                    const SizedBox(height: 5),
                    // 상호만 흰색으로 올려 "누가" 를 먼저 읽게 한다.
                    Text.rich(
                      TextSpan(children: [
                        TextSpan(
                            text: who,
                            style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700)),
                        const TextSpan(
                            text: '에서 이 PC 에 원격 접속을 요청했습니다.'),
                      ]),
                      style: const TextStyle(
                          fontSize: 12.5,
                          height: 1.5,
                          color: Color(0xFFADB2C0)),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () =>
                                serverModel.sendLoginResponse(client, false),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFFB0B5C2),
                              side: const BorderSide(color: Color(0xFF454955)),
                              padding: const EdgeInsets.symmetric(vertical: 11),
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(9)),
                            ),
                            child: const Text('거부',
                                style: TextStyle(
                                    fontSize: 14.5,
                                    fontWeight: FontWeight.w700)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: _PulsingAcceptButton(
                            onPressed: () =>
                                serverModel.sendLoginResponse(client, true),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // 활성 세션 인디케이터. 슬림 다크 배너 + 종료 버튼. 드래그로 옮길 수 있고
  // (windowManager.startDragging), 종료 버튼으로 피지원자가 직접 연결을 끊는다.
  Widget _buildAgentIndicator(Client? activeClient) {
    final hasActive = activeClient != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onPanStart: (_) => windowManager.startDragging(),
      child: MouseRegion(
        cursor: SystemMouseCursors.move,
        child: Material(
          color: const Color(0xFF1F2937),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 배너 줄. 채팅을 펼쳐도 이 줄은 그대로 남아 드래그 핸들 겸 상태 표시를 한다.
              SizedBox(
                height: kAgentSupportBannerSize.height,
                child: Center(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: hasActive
                              ? const Color(0xFFE53935)
                              : const Color(0xFF6B7280),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        hasActive ? '원격지원 중' : '원격지원 대기',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.2,
                        ),
                      ),
                      if (activeClient != null) ...[
                        const SizedBox(width: 10),
                        _buildChatToggle(activeClient),
                        const SizedBox(width: 8),
                        _buildEndButton(activeClient),
                      ],
                    ],
                  ),
                ),
              ),
              if (activeClient != null && _agentChatOpen)
                Expanded(child: _buildAgentChatPane(activeClient)),
            ],
          ),
        ),
      ),
    );
  }

  // 채팅 펼침/접기. 안 읽은 메시지가 있으면 점을 띄운다.
  Widget _buildChatToggle(Client client) {
    return Obx(() {
      final unread = client.unreadChatMessageCount.value;
      return InkWell(
        onTap: () {
          setState(() {
            _agentChatOpen = !_agentChatOpen;
            if (_agentChatOpen) {
              client.unreadChatMessageCount.value = 0;
              _scheduleAgentChatCollapse();
            } else {
              _agentChatIdleTimer?.cancel();
            }
          });
        },
        borderRadius: BorderRadius.circular(6),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
          decoration: BoxDecoration(
            color: _agentChatOpen
                ? const Color(0xFF374151)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              const Icon(Icons.chat_bubble_outline_rounded,
                  size: 15, color: Colors.white),
              if (unread > 0 && !_agentChatOpen)
                Positioned(
                  right: -3,
                  top: -3,
                  child: Container(
                    width: 7,
                    height: 7,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      color: Color(0xFFE53935),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    });
  }

  // 대화 영역. RustDesk 기본 ChatPage 를 안 쓰고 직접 그린다 — 그건 CM 탭 레이아웃을
  // 전제로 만들어졌는데 우리 CM 은 탭이 없는 배너이고, 360px 폭에 얹으면 넘친다.
  //
  // ★입력칸에 자동 포커스를 주지 않는다. 포스에서 포커스를 뺏으면 바코드 스캐너가
  //   먹통이 된다 — 피지원자가 직접 눌러야 그때 포커스가 간다.
  Widget _buildAgentChatPane(Client client) {
    final key = MessageKey(client.peerId, client.id);
    return Consumer<ChatModel>(
      builder: (context, chat, _) {
        final msgs = chat.messages[key]?.chatMessages ?? const <ChatMessage>[];
        // 대화가 오가는 동안엔 접지 않는다 — 메시지 수가 늘 때마다 타이머를 다시 건다.
        //   (build 중 setState 금지라 post-frame 으로 미룬다.)
        if (msgs.length != _agentChatSeenMsgCount) {
          _agentChatSeenMsgCount = msgs.length;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && _agentChatOpen) _scheduleAgentChatCollapse();
          });
        }
        return Container(
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: Color(0xFF374151))),
          ),
          child: Column(
            children: [
              Expanded(
                child: msgs.isEmpty
                    ? const Center(
                        child: Text('본사가 보낸 메시지가 여기 표시됩니다.',
                            style: TextStyle(
                                color: Color(0xFF9CA3AF), fontSize: 12)),
                      )
                    : ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                        itemCount: msgs.length,
                        itemBuilder: (context, i) {
                          // reverse 라 최신이 아래에 붙는다.
                          final m = msgs[msgs.length - 1 - i];
                          final mine = m.user.id != client.peerId;
                          return Align(
                            alignment: mine
                                ? Alignment.centerRight
                                : Alignment.centerLeft,
                            child: Container(
                              margin: const EdgeInsets.only(bottom: 6),
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 9, vertical: 6),
                              constraints:
                                  const BoxConstraints(maxWidth: 250),
                              decoration: BoxDecoration(
                                color: mine
                                    ? const Color(0xFF1740C4)
                                    : const Color(0xFF374151),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(m.text,
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 12.5,
                                      height: 1.35)),
                            ),
                          );
                        },
                      ),
              ),
              _buildAgentChatInput(client),
            ],
          ),
        );
      },
    );
  }

  Widget _buildAgentChatInput(Client client) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _agentChatInput,
              autofocus: false,
              style: const TextStyle(color: Colors.white, fontSize: 12.5),
              cursorColor: Colors.white,
              decoration: InputDecoration(
                isDense: true,
                hintText: '답장 쓰기',
                hintStyle: const TextStyle(
                    color: Color(0xFF9CA3AF), fontSize: 12.5),
                filled: true,
                fillColor: const Color(0xFF111827),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(7),
                  borderSide: BorderSide.none,
                ),
              ),
              onSubmitted: (_) => _sendAgentChat(client),
            ),
          ),
          const SizedBox(width: 6),
          InkWell(
            onTap: () => _sendAgentChat(client),
            borderRadius: BorderRadius.circular(7),
            child: Container(
              padding: const EdgeInsets.all(7),
              decoration: BoxDecoration(
                color: const Color(0xFF1740C4),
                borderRadius: BorderRadius.circular(7),
              ),
              child: const Icon(Icons.send_rounded,
                  size: 15, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }

  void _sendAgentChat(Client client) {
    final text = _agentChatInput.text.trim();
    if (text.isEmpty) return;
    // ChatModel.send 는 _currentKey 로 보낸다. 우리 CM 은 탭이 없어 그 키가 안 잡힐 수
    // 있으므로(탭 onSelected 가 안 돌아서) 보내기 직전에 이 세션으로 못박는다.
    final key = MessageKey(client.peerId, client.id);
    gFFI.chatModel.changeCurrentKey(key);
    gFFI.chatModel.send(ChatMessage(
      text: text,
      user: ChatUser(id: 'me', firstName: '거래처'),
      createdAt: DateTime.now(),
    ));
    _agentChatInput.clear();
  }

  // 종료 버튼. 피지원자가 지금 원격 세션을 직접 끊는다(RustDesk CM 의 cmCloseConnection).
  Widget _buildEndButton(Client client) {
    return InkWell(
      onTap: () => bind.cmCloseConnection(connId: client.id),
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: const Color(0xFFE53935),
          borderRadius: BorderRadius.circular(6),
        ),
        child: const Text(
          '종료',
          style: TextStyle(
            color: Colors.white,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

Widget buildConnectionCard(Client client) {
  return Consumer<ServerModel>(
    builder: (context, value, child) => Column(
      mainAxisAlignment: MainAxisAlignment.start,
      crossAxisAlignment: CrossAxisAlignment.start,
      key: ValueKey(client.id),
      children: [
        _CmHeader(client: client),
        client.type_() == ClientType.file ||
                client.type_() == ClientType.portForward ||
                client.type_() == ClientType.terminal ||
                client.disconnected
            ? Offstage()
            : _PrivilegeBoard(client: client),
        Expanded(
          child: Align(
            alignment: Alignment.bottomCenter,
            child: _CmControlPanel(client: client),
          ),
        )
      ],
    ).paddingSymmetric(vertical: 4.0, horizontal: 8.0),
  );
}

class _AppIcon extends StatelessWidget {
  const _AppIcon({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.symmetric(horizontal: 4.0),
      child: loadIcon(30),
    );
  }
}

class _CloseButton extends StatelessWidget {
  const _CloseButton({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: () {
        windowManager.close();
      },
      icon: const Icon(
        IconFont.close,
        size: 18,
      ),
      splashColor: Colors.transparent,
      hoverColor: Colors.transparent,
    );
  }
}

class _CmHeader extends StatefulWidget {
  final Client client;

  const _CmHeader({Key? key, required this.client}) : super(key: key);

  @override
  State<_CmHeader> createState() => _CmHeaderState();
}

class _CmHeaderState extends State<_CmHeader>
    with AutomaticKeepAliveClientMixin {
  Client get client => widget.client;

  final _time = 0.obs;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(Duration(seconds: 1), (_) {
      if (client.authorized && !client.disconnected) {
        _time.value = _time.value + 1;
      }
    });
    // Call onSelected in post frame callback, since we cannot guarantee that the callback will not call setState.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      gFFI.serverModel.tabController.onSelected?.call(client.id.toString());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10.0),
        gradient: LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [
            Color(0xff00bfe1),
            Color(0xff0071ff),
          ],
        ),
      ),
      margin: EdgeInsets.symmetric(horizontal: 5.0, vertical: 10.0),
      padding: EdgeInsets.only(
        top: 10.0,
        bottom: 10.0,
        left: 10.0,
        right: 5.0,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildClientAvatar().marginOnly(right: 10.0),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.start,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FittedBox(
                    child: Text(
                  client.name,
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 20,
                    overflow: TextOverflow.ellipsis,
                  ),
                  maxLines: 1,
                )),
                FittedBox(
                  child: Text(
                    "(${client.peerId})",
                    style: TextStyle(color: Colors.white, fontSize: 14),
                  ),
                ),
                if (client.type_() == ClientType.terminal)
                  FittedBox(
                    child: Text(
                      translate("Terminal"),
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ),
                if (client.type_() == ClientType.file)
                  FittedBox(
                    child: Text(
                      translate("File Transfer"),
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ),
                if (client.type_() == ClientType.camera)
                  FittedBox(
                    child: Text(
                      translate("View Camera"),
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ),
                if (client.portForward.isNotEmpty)
                  FittedBox(
                    child: Text(
                      "Port Forward: ${client.portForward}",
                      style: TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ),
                SizedBox(height: 10.0),
                FittedBox(
                    child: Row(
                  children: [
                    Text(
                      client.authorized
                          ? client.disconnected
                              ? translate("Disconnected")
                              : translate("Connected")
                          : "${translate("Request access to your device")}...",
                      style: TextStyle(color: Colors.white),
                    ).marginOnly(right: 8.0),
                    if (client.authorized)
                      Obx(
                        () => Text(
                          formatDurationToTime(
                            Duration(seconds: _time.value),
                          ),
                          style: TextStyle(color: Colors.white),
                        ),
                      )
                  ],
                ))
              ],
            ),
          ),
          Offstage(
            offstage: !client.authorized ||
                (client.type_() != ClientType.remote &&
                    client.type_() != ClientType.file &&
                    client.type_() != ClientType.camera),
            child: IconButton(
              onPressed: () => checkClickTime(client.id, () {
                if (client.type_() == ClientType.file) {
                  gFFI.chatModel.toggleCMFilePage();
                } else {
                  gFFI.chatModel
                      .toggleCMChatPage(MessageKey(client.peerId, client.id));
                }
              }),
              icon: SvgPicture.asset(client.type_() == ClientType.file
                  ? 'assets/file_transfer.svg'
                  : 'assets/chat2.svg'),
              splashRadius: kDesktopIconButtonSplashRadius,
            ),
          )
        ],
      ),
    );
  }

  @override
  bool get wantKeepAlive => true;

  Widget _buildClientAvatar() {
    return buildAvatarWidget(
          avatar: client.avatar,
          size: 70,
          borderRadius: 15,
          fallback: _buildInitialAvatar(),
        ) ??
        _buildInitialAvatar();
  }

  Widget _buildInitialAvatar() {
    return Container(
      width: 70,
      height: 70,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: str2color(client.name),
        borderRadius: BorderRadius.circular(15.0),
      ),
      child: Text(
        client.name.isNotEmpty ? client.name[0] : '?',
        style: TextStyle(
          fontWeight: FontWeight.bold,
          color: Colors.white,
          fontSize: 55,
        ),
      ),
    );
  }
}

class _PrivilegeBoard extends StatefulWidget {
  final Client client;

  const _PrivilegeBoard({Key? key, required this.client}) : super(key: key);

  @override
  State<StatefulWidget> createState() => _PrivilegeBoardState();
}

class _PrivilegeBoardState extends State<_PrivilegeBoard> {
  late final client = widget.client;
  Widget buildPermissionIcon(bool enabled, IconData iconData,
      Function(bool)? onTap, String tooltipText) {
    return Tooltip(
      message: "$tooltipText: ${enabled ? "ON" : "OFF"}",
      waitDuration: Duration.zero,
      child: Container(
        decoration: BoxDecoration(
          color: enabled ? MyTheme.accent : Colors.grey[700],
          borderRadius: BorderRadius.circular(10.0),
        ),
        padding: EdgeInsets.all(8.0),
        child: InkWell(
          onTap: () =>
              checkClickTime(widget.client.id, () => onTap?.call(!enabled)),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              Expanded(
                child: Icon(
                  iconData,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final crossAxisCount = 4;
    final spacing = 10.0;
    return Container(
      width: double.infinity,
      height: 160.0,
      margin: EdgeInsets.all(5.0),
      padding: EdgeInsets.all(5.0),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10.0),
        color: Theme.of(context).colorScheme.background,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            spreadRadius: 1,
            blurRadius: 1,
            offset: Offset(0, 1.5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text(
            translate("Permissions"),
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            textAlign: TextAlign.center,
          ).marginOnly(left: 4.0, bottom: 8.0),
          Expanded(
            child: GridView.count(
              crossAxisCount: crossAxisCount,
              padding: EdgeInsets.symmetric(horizontal: spacing),
              mainAxisSpacing: spacing,
              crossAxisSpacing: spacing,
              children: client.type_() == ClientType.camera
                  ? [
                      buildPermissionIcon(
                        client.audio,
                        Icons.volume_up_rounded,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "audio",
                              enabled: enabled);
                          setState(() {
                            client.audio = enabled;
                          });
                        },
                        translate('Enable audio'),
                      ),
                      buildPermissionIcon(
                        client.recording,
                        Icons.videocam_rounded,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "recording",
                              enabled: enabled);
                          setState(() {
                            client.recording = enabled;
                          });
                        },
                        translate('Enable recording session'),
                      ),
                    ]
                  : [
                      buildPermissionIcon(
                        client.keyboard,
                        Icons.keyboard,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "keyboard",
                              enabled: enabled);
                          setState(() {
                            client.keyboard = enabled;
                          });
                        },
                        translate('Enable keyboard/mouse'),
                      ),
                      buildPermissionIcon(
                        client.clipboard,
                        Icons.assignment_rounded,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "clipboard",
                              enabled: enabled);
                          setState(() {
                            client.clipboard = enabled;
                          });
                        },
                        translate('Enable clipboard'),
                      ),
                      buildPermissionIcon(
                        client.audio,
                        Icons.volume_up_rounded,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "audio",
                              enabled: enabled);
                          setState(() {
                            client.audio = enabled;
                          });
                        },
                        translate('Enable audio'),
                      ),
                      buildPermissionIcon(
                        client.file,
                        Icons.upload_file_rounded,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "file",
                              enabled: enabled);
                          setState(() {
                            client.file = enabled;
                          });
                        },
                        translate('Enable file copy and paste'),
                      ),
                      buildPermissionIcon(
                        client.restart,
                        Icons.restart_alt_rounded,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "restart",
                              enabled: enabled);
                          setState(() {
                            client.restart = enabled;
                          });
                        },
                        translate('Enable remote restart'),
                      ),
                      buildPermissionIcon(
                        client.recording,
                        Icons.videocam_rounded,
                        (enabled) {
                          bind.cmSwitchPermission(
                              connId: client.id,
                              name: "recording",
                              enabled: enabled);
                          setState(() {
                            client.recording = enabled;
                          });
                        },
                        translate('Enable recording session'),
                      ),
                      // only windows support block input
                      if (isWindows)
                        buildPermissionIcon(
                          client.blockInput,
                          Icons.block,
                          (enabled) {
                            bind.cmSwitchPermission(
                                connId: client.id,
                                name: "block_input",
                                enabled: enabled);
                            setState(() {
                              client.blockInput = enabled;
                            });
                          },
                          translate('Enable blocking user input'),
                        )
                    ],
            ),
          ),
        ],
      ),
    );
  }
}

const double buttonBottomMargin = 8;

class _CmControlPanel extends StatelessWidget {
  final Client client;

  const _CmControlPanel({Key? key, required this.client}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return client.authorized
        ? client.disconnected
            ? buildDisconnected(context)
            : buildAuthorized(context)
        : buildUnAuthorized(context);
  }

  buildAuthorized(BuildContext context) {
    final bool canElevate = bind.cmCanElevate();
    final model = Provider.of<ServerModel>(context);
    final showElevation = canElevate &&
        model.showElevation &&
        client.type_() == ClientType.remote;
    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Offstage(
          offstage: !client.inVoiceCall,
          child: Row(
            children: [
              Expanded(
                child: buildButton(context,
                    color: MyTheme.accent,
                    onClick: null, onTapDown: (details) async {
                  final devicesInfo =
                      await AudioInput.getDevicesInfo(true, true);
                  List<String> devices = devicesInfo['devices'] as List<String>;
                  if (devices.isEmpty) {
                    msgBox(
                      gFFI.sessionId,
                      'custom-nocancel-info',
                      'Prompt',
                      'no_audio_input_device_tip',
                      '',
                      gFFI.dialogManager,
                    );
                    return;
                  }

                  String currentDevice = devicesInfo['current'] as String;
                  final x = details.globalPosition.dx;
                  final y = details.globalPosition.dy;
                  final position = RelativeRect.fromLTRB(x, y, x, y);
                  showMenu(
                    context: context,
                    position: position,
                    items: devices
                        .map((d) => PopupMenuItem<String>(
                              value: d,
                              height: 18,
                              padding: EdgeInsets.zero,
                              onTap: () => AudioInput.setDevice(d, true, true),
                              child: IgnorePointer(
                                  child: RadioMenuButton(
                                value: d,
                                groupValue: currentDevice,
                                onChanged: (v) {
                                  if (v != null)
                                    AudioInput.setDevice(v, true, true);
                                },
                                child: Container(
                                  child: Text(
                                    d,
                                    overflow: TextOverflow.ellipsis,
                                    maxLines: 1,
                                  ),
                                  constraints: BoxConstraints(
                                      maxWidth:
                                          kConnectionManagerWindowSizeClosedChat
                                                  .width -
                                              80),
                                ),
                              )),
                            ))
                        .toList(),
                  );
                },
                    icon: Icon(
                      Icons.call_rounded,
                      color: Colors.white,
                      size: 14,
                    ),
                    text: "Audio input",
                    textColor: Colors.white),
              ),
              Expanded(
                child: buildButton(
                  context,
                  color: Colors.red,
                  onClick: () => closeVoiceCall(),
                  icon: Icon(
                    Icons.call_end_rounded,
                    color: Colors.white,
                    size: 14,
                  ),
                  text: "Stop voice call",
                  textColor: Colors.white,
                ),
              )
            ],
          ),
        ),
        Offstage(
          offstage: !client.incomingVoiceCall,
          child: Row(
            children: [
              Expanded(
                child: buildButton(context,
                    color: MyTheme.accent,
                    onClick: () => handleVoiceCall(true),
                    icon: Icon(
                      Icons.call_rounded,
                      color: Colors.white,
                      size: 14,
                    ),
                    text: "Accept",
                    textColor: Colors.white),
              ),
              Expanded(
                child: buildButton(
                  context,
                  color: Colors.red,
                  onClick: () => handleVoiceCall(false),
                  icon: Icon(
                    Icons.phone_disabled_rounded,
                    color: Colors.white,
                    size: 14,
                  ),
                  text: "Dismiss",
                  textColor: Colors.white,
                ),
              )
            ],
          ),
        ),
        Offstage(
          offstage: !client.fromSwitch,
          child: buildButton(context,
              color: Colors.purple,
              onClick: () => handleSwitchBack(context),
              icon: Icon(Icons.reply, color: Colors.white),
              text: "Switch Sides",
              textColor: Colors.white),
        ),
        Offstage(
          offstage: !showElevation,
          child: buildButton(
            context,
            color: MyTheme.accent,
            onClick: () {
              handleElevate(context);
              windowManager.minimize();
            },
            icon: Icon(
              Icons.security_rounded,
              color: Colors.white,
              size: 14,
            ),
            text: 'Elevate',
            textColor: Colors.white,
          ),
        ),
        Row(
          children: [
            Expanded(
              child: buildButton(context,
                  color: Colors.redAccent,
                  onClick: handleDisconnect,
                  text: 'Disconnect',
                  icon: Icon(
                    Icons.link_off_rounded,
                    color: Colors.white,
                    size: 14,
                  ),
                  textColor: Colors.white),
            ),
          ],
        )
      ],
    ).marginOnly(bottom: buttonBottomMargin);
  }

  buildDisconnected(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Expanded(
            child: buildButton(context,
                color: MyTheme.accent,
                onClick: handleClose,
                text: 'Close',
                textColor: Colors.white)),
      ],
    ).marginOnly(bottom: buttonBottomMargin);
  }

  buildUnAuthorized(BuildContext context) {
    final bool canElevate = bind.cmCanElevate();
    final model = Provider.of<ServerModel>(context);
    final showElevation = canElevate &&
        model.showElevation &&
        client.type_() == ClientType.remote;
    final showAccept = model.approveMode != 'password';
    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Offstage(
          offstage: !showElevation || !showAccept,
          child: buildButton(context, color: Colors.green[700], onClick: () {
            handleAccept(context);
            handleElevate(context);
            windowManager.minimize();
          },
              text: 'Accept and Elevate',
              icon: Icon(
                Icons.security_rounded,
                color: Colors.white,
                size: 14,
              ),
              textColor: Colors.white,
              tooltip: 'accept_and_elevate_btn_tooltip'),
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (showAccept)
              Expanded(
                child: Column(
                  children: [
                    buildButton(
                      context,
                      color: MyTheme.accent,
                      onClick: () {
                        handleAccept(context);
                        windowManager.minimize();
                      },
                      text: 'Accept',
                      textColor: Colors.white,
                    ),
                  ],
                ),
              ),
            Expanded(
              child: buildButton(
                context,
                color: Colors.transparent,
                border: Border.all(color: Colors.grey),
                onClick: handleDisconnect,
                text: 'Cancel',
                textColor: null,
              ),
            ),
          ],
        ),
      ],
    ).marginOnly(bottom: buttonBottomMargin);
  }

  Widget buildButton(BuildContext context,
      {required Color? color,
      GestureTapCallback? onClick,
      Widget? icon,
      BoxBorder? border,
      required String text,
      required Color? textColor,
      String? tooltip,
      GestureTapDownCallback? onTapDown}) {
    assert(!(onClick == null && onTapDown == null));
    Widget textWidget;
    if (icon != null) {
      textWidget = Text(
        translate(text),
        style: TextStyle(color: textColor),
        textAlign: TextAlign.center,
      );
    } else {
      textWidget = Expanded(
        child: Text(
          translate(text),
          style: TextStyle(color: textColor),
          textAlign: TextAlign.center,
        ),
      );
    }
    final borderRadius = BorderRadius.circular(10.0);
    final btn = Container(
      height: 28,
      decoration: BoxDecoration(
          color: color, borderRadius: borderRadius, border: border),
      child: InkWell(
        borderRadius: borderRadius,
        onTap: () {
          if (onClick == null) return;
          checkClickTime(client.id, onClick);
        },
        onTapDown: (details) {
          if (onTapDown == null) return;
          checkClickTime(client.id, () {
            onTapDown.call(details);
          });
        },
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Offstage(offstage: icon == null, child: icon).marginOnly(right: 5),
            textWidget,
          ],
        ),
      ),
    );
    return (tooltip != null
            ? Tooltip(
                message: translate(tooltip),
                child: btn,
              )
            : btn)
        .marginAll(4);
  }

  void handleDisconnect() {
    bind.cmCloseConnection(connId: client.id);
  }

  void handleAccept(BuildContext context) {
    final model = Provider.of<ServerModel>(context, listen: false);
    model.sendLoginResponse(client, true);
  }

  void handleElevate(BuildContext context) {
    final model = Provider.of<ServerModel>(context, listen: false);
    model.setShowElevation(false);
    bind.cmElevatePortable(connId: client.id);
  }

  void handleClose() async {
    await bind.cmRemoveDisconnectedConnection(connId: client.id);
    if (await bind.cmGetClientsLength() == 0) {
      windowManager.close();
    }
  }

  void handleSwitchBack(BuildContext context) {
    bind.cmSwitchBack(connId: client.id);
  }

  void handleVoiceCall(bool accept) {
    bind.cmHandleIncomingVoiceCall(id: client.id, accept: accept);
  }

  void closeVoiceCall() {
    bind.cmCloseVoiceCall(id: client.id);
  }
}

void checkClickTime(int id, Function() callback) async {
  if (allowRemoteCMModification()) {
    callback();
    return;
  }
  var clickCallbackTime = DateTime.now().millisecondsSinceEpoch;
  await bind.cmCheckClickTime(connId: id);
  Timer(const Duration(milliseconds: 120), () async {
    var d = clickCallbackTime - await bind.cmGetClickTime();
    if (d > 120) callback();
  });
}

bool allowRemoteCMModification() {
  return option2bool(kOptionAllowRemoteCmModification,
      bind.mainGetLocalOption(key: kOptionAllowRemoteCmModification));
}

class _FileTransferLogPage extends StatefulWidget {
  _FileTransferLogPage({Key? key}) : super(key: key);

  @override
  State<_FileTransferLogPage> createState() => __FileTransferLogPageState();
}

class __FileTransferLogPageState extends State<_FileTransferLogPage> {
  @override
  Widget build(BuildContext context) {
    return statusList();
  }

  Widget generateCard(Widget child) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.all(
          Radius.circular(15.0),
        ),
      ),
      child: child,
    );
  }

  iconLabel(CmFileLog item) {
    switch (item.action) {
      case CmFileAction.none:
        return Container();
      case CmFileAction.localToRemote:
      case CmFileAction.remoteToLocal:
        return Column(
          children: [
            Transform.rotate(
              angle: item.action == CmFileAction.remoteToLocal ? 0 : pi,
              child: SvgPicture.asset(
                "assets/arrow.svg",
                colorFilter: svgColor(Theme.of(context).tabBarTheme.labelColor),
              ),
            ),
            Text(item.action == CmFileAction.remoteToLocal
                ? translate('Send')
                : translate('Receive'))
          ],
        );
      case CmFileAction.remove:
        return Column(
          children: [
            Icon(
              Icons.delete,
              color: Theme.of(context).tabBarTheme.labelColor,
            ),
            Text(translate('Delete'))
          ],
        );
      case CmFileAction.createDir:
        return Column(
          children: [
            Icon(
              Icons.create_new_folder,
              color: Theme.of(context).tabBarTheme.labelColor,
            ),
            Text(translate('Create Folder'))
          ],
        );
      case CmFileAction.rename:
        return Column(
          children: [
            Icon(
              Icons.drive_file_move_outlined,
              color: Theme.of(context).tabBarTheme.labelColor,
            ),
            Text(translate('Rename'))
          ],
        );
    }
  }

  Widget statusList() {
    return PreferredSize(
      preferredSize: const Size(200, double.infinity),
      child: Container(
          padding: const EdgeInsets.all(12.0),
          child: Obx(
            () {
              final jobTable = gFFI.cmFileModel.currentJobTable;
              statusListView(List<CmFileLog> jobs) => ListView.builder(
                    controller: ScrollController(),
                    itemBuilder: (BuildContext context, int index) {
                      final item = jobs[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 5),
                        child: generateCard(
                          Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  SizedBox(
                                    width: 50,
                                    child: iconLabel(item),
                                  ).paddingOnly(left: 15),
                                  const SizedBox(
                                    width: 16.0,
                                  ),
                                  Expanded(
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          item.fileName,
                                        ).paddingSymmetric(vertical: 10),
                                        if (item.totalSize > 0)
                                          Text(
                                            '${translate("Total")} ${readableFileSize(item.totalSize.toDouble())}',
                                            style: TextStyle(
                                              fontSize: 12,
                                              color: MyTheme.darkGray,
                                            ),
                                          ),
                                        if (item.totalSize > 0)
                                          Offstage(
                                            offstage: item.state !=
                                                JobState.inProgress,
                                            child: Text(
                                              '${translate("Speed")} ${readableFileSize(item.speed)}/s',
                                              style: TextStyle(
                                                fontSize: 12,
                                                color: MyTheme.darkGray,
                                              ),
                                            ),
                                          ),
                                        Offstage(
                                          offstage: !(item.isTransfer() &&
                                              item.state !=
                                                  JobState.inProgress),
                                          child: Text(
                                            translate(
                                              item.display(),
                                            ),
                                            style: TextStyle(
                                              fontSize: 12,
                                              color: MyTheme.darkGray,
                                            ),
                                          ),
                                        ),
                                        if (item.totalSize > 0)
                                          Offstage(
                                            offstage: item.state !=
                                                JobState.inProgress,
                                            child: LinearPercentIndicator(
                                              padding:
                                                  EdgeInsets.only(right: 15),
                                              animateFromLastPercent: true,
                                              center: Text(
                                                '${(item.finishedSize / item.totalSize * 100).toStringAsFixed(0)}%',
                                              ),
                                              barRadius: Radius.circular(15),
                                              percent: item.finishedSize /
                                                  item.totalSize,
                                              progressColor: MyTheme.accent,
                                              backgroundColor:
                                                  Theme.of(context).hoverColor,
                                              lineHeight:
                                                  kDesktopFileTransferRowHeight,
                                            ).paddingSymmetric(vertical: 15),
                                          ),
                                      ],
                                    ),
                                  ),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [],
                                  ),
                                ],
                              ),
                            ],
                          ).paddingSymmetric(vertical: 10),
                        ),
                      );
                    },
                    itemCount: jobTable.length,
                  );

              return jobTable.isEmpty
                  ? generateCard(
                      Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            SvgPicture.asset(
                              "assets/transfer.svg",
                              colorFilter: svgColor(
                                  Theme.of(context).tabBarTheme.labelColor),
                              height: 40,
                            ).paddingOnly(bottom: 10),
                            Text(
                              translate("No transfers in progress"),
                              textAlign: TextAlign.center,
                              textScaler: TextScaler.linear(1.20),
                              style: TextStyle(
                                  color:
                                      Theme.of(context).tabBarTheme.labelColor),
                            ),
                          ],
                        ),
                      ),
                    )
                  : statusListView(jobTable);
            },
          )),
    );
  }
}

// [수락] 버튼을 숨쉬듯 맥동시켜 "눌러주세요" 를 어필한다.
//
// ★2026-08-06 카드 테두리에서 버튼으로 옮겼다. 종전엔 카드 테두리를 빨갛게 맥동시켰는데
// (2026-07-07), 빨강은 윈도우 오류창의 문법이라 도와주러 온 요청에 "위험" 신호를 보냈다.
// 시선은 어차피 눌러야 할 버튼으로 가야 하므로 신호를 거기로 모은다.
//
// ※ 2026-07-14 에 "파랑은 시각 효과가 약하다"고 빨강으로 바꾼 적이 있는데, 그건 흰 카드
//    위의 얇은 테두리였다. 지금은 차콜 카드 위의 채워진 버튼이라 조건이 다르다.
//
// 색만 바꾼다(그림자·크기 고정) — Sciter(Win7) 에는 box-shadow 가 없어서 거기 맞춰야
// 두 엔진이 같은 그림이 된다. cm.tis applyAcceptPulse 와 같은 색·주기.
class _PulsingAcceptButton extends StatefulWidget {
  final VoidCallback onPressed;
  const _PulsingAcceptButton({required this.onPressed});

  @override
  State<_PulsingAcceptButton> createState() => _PulsingAcceptButtonState();
}

class _PulsingAcceptButtonState extends State<_PulsingAcceptButton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 750),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = Curves.easeInOut.transform(_controller.value);
        // 짙은 파랑 ↔ 밝은 파랑. Sciter 쪽 보간값과 동일.
        final bg = Color.lerp(
            const Color(0xFF1740C4), const Color(0xFF5A8CFF), t)!;
        return FilledButton(
          onPressed: widget.onPressed,
          style: FilledButton.styleFrom(
            backgroundColor: bg,
            padding: const EdgeInsets.symmetric(vertical: 11),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(9)),
          ),
          child: const Text('수락',
              style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700)),
        );
      },
    );
  }
}
