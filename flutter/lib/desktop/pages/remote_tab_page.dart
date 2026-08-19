import 'dart:convert';
import 'dart:async';
import 'dart:ui' as ui;

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hbb/common.dart';
import 'package:flutter_hbb/common/shared_state.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/input_model.dart';
import 'package:flutter_hbb/models/state_model.dart';
import 'package:flutter_hbb/desktop/pages/remote_page.dart';
import 'package:flutter_hbb/desktop/widgets/remote_toolbar.dart';
import 'package:flutter_hbb/desktop/widgets/tabbar_widget.dart';
import 'package:flutter_hbb/desktop/widgets/material_mod_popup_menu.dart'
    as mod_menu;
import 'package:flutter_hbb/desktop/widgets/popup_menu.dart';
import 'package:flutter_hbb/utils/multi_window_manager.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:get/get.dart';
import 'package:bot_toast/bot_toast.dart';

import '../../common/widgets/dialog.dart';
import '../../models/platform_model.dart';

class _MenuTheme {
  static const Color blueColor = MyTheme.button;
  // kMinInteractiveDimension
  static const double height = 20.0;
  static const double dividerHeight = 12.0;
}

class ConnectionTabPage extends StatefulWidget {
  final Map<String, dynamic> params;

  const ConnectionTabPage({Key? key, required this.params}) : super(key: key);

  @override
  State<ConnectionTabPage> createState() => _ConnectionTabPageState(params);
}

class _ConnectionTabPageState extends State<ConnectionTabPage> {
  final tabController =
      Get.put(DesktopTabController(tabType: DesktopTabType.remoteScreen));
  final contentKey = UniqueKey();
  static const IconData selectedIcon = Icons.desktop_windows_sharp;
  static const IconData unselectedIcon = Icons.desktop_windows_outlined;

  String? peerId;
  bool _isScreenRectSet = false;
  int? _display;

  var connectionMap = RxList<Widget>.empty(growable: true);

  _ConnectionTabPageState(Map<String, dynamic> params) {
    RemoteCountState.init();
    peerId = params['id'];
    final sessionId = params['session_id'];
    final tabWindowId = params['tab_window_id'];
    final display = params['display'];
    final displays = params['displays'];
    final screenRect = parseParamScreenRect(params);
    _isScreenRectSet = screenRect != null;
    _display = display as int?;
    tryMoveToScreenAndSetFullscreen(screenRect);
    if (peerId != null) {
      ConnectionTypeState.init(peerId!);
      tabController.onSelected = (id) {
        final remotePage = tabController.widget(id);
        if (remotePage is RemotePage) {
          final ffi = remotePage.ffi;
          bind.setCurSessionId(sessionId: ffi.sessionId);
        }
        WindowController.fromWindowId(params['windowId'])
            .setTitle(getWindowNameWithId(id));
        UnreadChatCountState.find(id).value = 0;
      };
      tabController.add(TabInfo(
        key: peerId!,
        label: peerId!,
        selectedIcon: selectedIcon,
        unselectedIcon: unselectedIcon,
        onTabCloseButton: () async {
          // 탭 X 도 무경고 끊김 방지 — 확인 후 닫는다. A/S 기록은 종료 후 메인 창 모달.
          if (!await _chainremoteConfirmCloseDuringSession(1)) {
            return;
          }
          tabController.closeBy(peerId!);
        },
        page: RemotePage(
          key: ValueKey(peerId),
          id: peerId!,
          sessionId: sessionId == null ? null : SessionID(sessionId),
          tabWindowId: tabWindowId,
          display: display,
          displays: displays?.cast<int>(),
          password: params['password'],
          toolbarState: ToolbarState(),
          tabController: tabController,
          switchUuid: params['switch_uuid'],
          forceRelay: params['forceRelay'],
          isSharedPassword: params['isSharedPassword'],
        ),
      ));
      _update_remote_count();
    }
    tabController.onRemoved = (_, id) => onRemoveId(id);
    rustDeskWinManager.setMethodHandler(_remoteMethodHandler);
  }

  @override
  void initState() {
    super.initState();

    if (!_isScreenRectSet) {
      Future.delayed(Duration.zero, () {
        restoreWindowPosition(
          WindowType.RemoteDesktop,
          windowId: windowId(),
          peerId: tabController.state.value.tabs.isEmpty
              ? null
              : tabController.state.value.tabs[0].key,
          display: _display,
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final child = Scaffold(
      backgroundColor: Theme.of(context).colorScheme.background,
      body: DesktopTab(
        controller: tabController,
        onWindowCloseButton: handleWindowCloseButton,
        // 2026-05-27 v4: toolbar 를 탭바 라인의 tail 슬롯에 넣었다. 거래처 화면 위에
        // 떠 있지 않고, 탭 라벨 "424... @ ..." 와 같은 행에 컨트롤이 붙는다.
        tail: Obx(() {
          final state = tabController.state.value;
          if (state.tabs.isEmpty || state.selected < 0 ||
              state.selected >= state.tabs.length) {
            return Row(mainAxisSize: MainAxisSize.min, children: [
              _RelativeMouseModeHint(tabController: tabController),
              const AddButton(),
            ]);
          }
          final activeTab = state.tabs[state.selected];
          final activePage = activeTab.page;
          if (activePage is! RemotePage) {
            return Row(mainAxisSize: MainAxisSize.min, children: [
              _RelativeMouseModeHint(tabController: tabController),
              const AddButton(),
            ]);
          }
          // ★새 창의 첫 프레임엔 RemotePage 의 State 가 아직 없다(PageView 는 자식을 layout
          //   단계에서 만드는데 이 tail 은 같은 프레임 build 단계에서 먼저 평가된다).
          //   그 상태로 activePage.ffi 를 읽으면 `_lastState.value!` 가 Null check 예외를 던져
          //   tail Row 전체(툴바+[+]버튼)가 ErrorWidget 으로 대체된다 — 릴리즈 빌드의 ErrorWidget
          //   은 연회색 박스라 "툴바만 사라진" 것처럼 보인다. 이게 신규 거래처 첫 접속마다
          //   툴바가 없다가 재접속하면 멀쩡하던 증상의 정체다(2026-07-29 규명).
          //   ★alwaysShow(79a09c4cf)로는 못 막는다 — 예외는 RemoteToolbar 인자를 만드는
          //   시점, 즉 그 위젯의 build() 에 들어가기도 전에 터지기 때문이다.
          //   여기서 예외를 원천 차단하고, State 가 붙는 다음 프레임에 다시 그리게 한다
          //   (hasState 가 true 가 되면 이 분기를 안 타므로 반복되지 않는다).
          if (!activePage.hasState) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              tabController.state.refresh();
            });
            return Row(mainAxisSize: MainAxisSize.min, children: [
              _RelativeMouseModeHint(tabController: tabController),
              const AddButton(),
            ]);
          }
          return Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              RemoteToolbar(
                key: ValueKey('toolbar-${activeTab.key}'),
                id: activePage.id,
                ffi: activePage.ffi,
                state: activePage.toolbarState,
                onEnterOrLeaveImageSetter: (_, __) {},
                onEnterOrLeaveImageCleaner: (_) {},
                setRemoteState: (_) {},
                // tab-tail 툴바는 첫 접속에도 바로 보인다(initialized 게이트 우회).
                alwaysShow: true,
              ),
              _RelativeMouseModeHint(tabController: tabController),
              const AddButton(),
            ],
          );
        }),
        selectedBorderColor: MyTheme.accent,
        pageViewBuilder: (pageView) => pageView,
        labelGetter: DesktopTab.tablabelGetter,
        tabBuilder: (key, icon, label, themeConf) => Obx(() {
          final connectionType = ConnectionTypeState.find(key);
          if (!connectionType.isValid()) {
            return Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                icon,
                label,
              ],
            );
          } else {
            bool secure =
                connectionType.secure.value == ConnectionType.strSecure;
            bool direct =
                connectionType.direct.value == ConnectionType.strDirect;
            String msgConn = getConnectionText(
                secure, direct, connectionType.stream_type.value);
            var msgFingerprint = '${translate('Fingerprint')}:\n';
            var fingerprint = FingerprintState.find(key).value;
            if (fingerprint.isEmpty) {
              fingerprint = 'N/A';
            }
            if (fingerprint.length > 5 * 8) {
              var first = fingerprint.substring(0, 39);
              var second = fingerprint.substring(40);
              msgFingerprint += '$first\n$second';
            } else {
              msgFingerprint += fingerprint;
            }

            final tab = Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                icon,
                Tooltip(
                  message: '$msgConn\n$msgFingerprint',
                  child: SvgPicture.asset(
                    'assets/${connectionType.secure.value}${connectionType.direct.value}.svg',
                    width: themeConf.iconSize,
                    height: themeConf.iconSize,
                  ).paddingOnly(right: 5),
                ),
                label,
                unreadMessageCountBuilder(UnreadChatCountState.find(key))
                    .marginOnly(left: 4),
              ],
            );

            return Listener(
              onPointerDown: (e) {
                if (e.kind != ui.PointerDeviceKind.mouse) {
                  return;
                }
                final remotePage = tabController.state.value.tabs
                    .firstWhere((tab) => tab.key == key)
                    .page as RemotePage;
                if (remotePage.ffi.ffiModel.pi.isSet.isTrue && e.buttons == 2) {
                  showRightMenu(
                    (CancelFunc cancelFunc) {
                      return _tabMenuBuilder(key, cancelFunc);
                    },
                    target: e.position,
                  );
                }
              },
              child: tab,
            );
          }
        }),
      ),
    );
    final tabWidget = isLinux
        ? buildVirtualWindowFrame(context, child)
        : workaroundWindowBorder(
            context,
            Obx(() => Container(
                  decoration: BoxDecoration(
                    border: Border.all(
                        color: MyTheme.color(context).border!,
                        width: stateGlobal.windowBorderWidth.value),
                  ),
                  child: child,
                )));
    return isMacOS || kUseCompatibleUiMode
        ? tabWidget
        : Obx(() => SubWindowDragToResizeArea(
              key: contentKey,
              child: tabWidget,
              // Specially configured for a better resize area and remote control.
              childPadding: kDragToResizeAreaPadding,
              resizeEdgeSize: stateGlobal.resizeEdgeSize.value,
              enableResizeEdges: subWindowManagerEnableResizeEdges,
              windowId: stateGlobal.windowId,
            ));
  }

  // Note: Some dup code to ../widgets/remote_toolbar
  Widget _tabMenuBuilder(String key, CancelFunc cancelFunc) {
    final List<MenuEntryBase<String>> menu = [];
    const EdgeInsets padding = EdgeInsets.only(left: 8.0, right: 5.0);
    final remotePage = tabController.state.value.tabs
        .firstWhere((tab) => tab.key == key)
        .page as RemotePage;
    final ffi = remotePage.ffi;
    final pi = ffi.ffiModel.pi;
    final perms = ffi.ffiModel.permissions;
    final sessionId = ffi.sessionId;
    final toolbarState = remotePage.toolbarState;
    menu.addAll([
      MenuEntryButton<String>(
        childBuilder: (TextStyle? style) => Obx(() => Text(
              translate(
                  toolbarState.hide.isTrue ? 'Show Toolbar' : 'Hide Toolbar'),
              style: style,
            )),
        proc: () {
          toolbarState.switchHide(sessionId);
          cancelFunc();
        },
        padding: padding,
      ),
    ]);

    if (tabController.state.value.tabs.length > 1) {
      final splitAction = MenuEntryButton<String>(
        childBuilder: (TextStyle? style) => Text(
          translate('Move tab to new window'),
          style: style,
        ),
        proc: () async {
          await DesktopMultiWindow.invokeMethod(
              kMainWindowId,
              kWindowEventMoveTabToNewWindow,
              '${windowId()},$key,$sessionId,RemoteDesktop');
          cancelFunc();
        },
        padding: padding,
      );
      menu.insert(1, splitAction);
    }

    if (perms['restart'] != false &&
        (pi.platform == kPeerPlatformLinux ||
            pi.platform == kPeerPlatformWindows ||
            pi.platform == kPeerPlatformMacOS)) {
      menu.add(MenuEntryButton<String>(
        childBuilder: (TextStyle? style) => Text(
          translate('Restart remote device'),
          style: style,
        ),
        proc: () => showRestartRemoteDevice(
            pi, peerId ?? '', sessionId, ffi.dialogManager),
        padding: padding,
        dismissOnClicked: true,
        dismissCallback: cancelFunc,
      ));
    }

    if (perms['keyboard'] != false && !ffi.ffiModel.viewOnly) {
      menu.add(RemoteMenuEntry.insertLock(sessionId, padding,
          dismissFunc: cancelFunc));

      if (pi.platform == kPeerPlatformLinux || pi.sasEnabled) {
        menu.add(RemoteMenuEntry.insertCtrlAltDel(sessionId, padding,
            dismissFunc: cancelFunc));
      }
    }

    menu.addAll([
      MenuEntryDivider<String>(),
      MenuEntryButton<String>(
        childBuilder: (TextStyle? style) => Text(
          translate('Copy Fingerprint'),
          style: style,
        ),
        proc: () => onCopyFingerprint(FingerprintState.find(key).value),
        padding: padding,
        dismissOnClicked: true,
        dismissCallback: cancelFunc,
      ),
      MenuEntryButton<String>(
        childBuilder: (TextStyle? style) => Text(
          translate('Close'),
          style: style,
        ),
        proc: () async {
          if (await desktopTryShowTabAuditDialogCloseCancelled(
            id: key,
            tabController: tabController,
          )) {
            return;
          }
          tabController.closeBy(key);
          cancelFunc();
        },
        padding: padding,
      )
    ]);

    return mod_menu.PopupMenu<String>(
      items: menu
          .map((entry) => entry.build(
              context,
              const MenuConfig(
                commonColor: _MenuTheme.blueColor,
                height: _MenuTheme.height,
                dividerHeight: _MenuTheme.dividerHeight,
              )))
          .expand((i) => i)
          .toList(),
    );
  }

  void onRemoveId(String id) async {
    if (tabController.state.value.tabs.isEmpty) {
      // Keep calling until the window status is hidden.
      //
      // Workaround for Windows:
      // If you click other buttons and close in msgbox within a very short period of time, the close may fail.
      // `await WindowController.fromWindowId(windowId()).close();`.
      Future<void> loopCloseWindow() async {
        int c = 0;
        final windowController = WindowController.fromWindowId(windowId());
        while (c < 20 &&
            tabController.state.value.tabs.isEmpty &&
            (!await windowController.isHidden())) {
          await windowController.close();
          await Future.delayed(Duration(milliseconds: 100));
          c++;
        }
      }

      loopCloseWindow();
    }
    ConnectionTypeState.delete(id);
    // Clean up relative mouse mode state for this peer.
    stateGlobal.relativeMouseModeState.remove(id);
    _update_remote_count();
  }

  int windowId() {
    return widget.params["windowId"];
  }

  Future<bool> handleWindowCloseButton() async {
    final connLength = tabController.length;
    // 원격 세션 중에 창을 닫으면 원격이 끊긴다. 경고 없이 끊겨서 거래처에
    // 다시 안내(앱 실행, ID 불러주기, 재접속)하는 일을 막으려고, 활성 세션이
    // 하나라도 있으면 항상 확인 다이얼로그를 띄운다.
    // (로그인만 한 메인 창은 hide 라서 확인 없이 그대로 둔다.)
    // A/S 기록 모달은 여기서 띄우지 않는다 — 확인 즉시 끊어 거래처 배너를 바로
    // 없애고, 기록은 종료 후 메인 창 모달로 받는다(chainremote_session_record.dart).
    if (connLength >= 1) {
      if (!await _chainremoteConfirmCloseDuringSession(connLength)) {
        return false;
      }
    }
    if (connLength <= 1) {
      tabController.clear();
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
        tabController.clear();
      }
      return res;
    }
  }

  /// 확인창이 떠 있는 동안 또 눌러도 새 창을 안 띄운다(2026-08-16 Chang 발견).
  ///   창 X·탭 X·툴바 X 는 서로 다른 경로인데 셋 다 이 확인창을 쓴다. 종전엔 누를 때마다
  ///   창이 하나씩 쌓여 화면이 계속 어두워졌고(각 창이 자기 어둠막을 깐다), 빠져나오려면
  ///   쌓인 수만큼 [취소]를 눌러야 했다. "종료가 안 먹는다"로 보여 더 누르게 되는 악순환.
  bool _closeAsking = false;

  Future<bool> _chainremoteConfirmCloseDuringSession(int connLength) async {
    if (_closeAsking) return false;
    _closeAsking = true;
    try {
      return await _chainremoteConfirmCloseDuringSessionInner(connLength);
    } finally {
      _closeAsking = false;
    }
  }

  // ChainRemote: 여기서 예약 창을 묻지 않는다(2026-08-19 제거). 종전엔 [원격 예약도 함께
  //   닫기] 체크박스가 있었는데, 창은 어차피 스스로 닫힌다 — 약속한 종료 시각, 승인 후
  //   24시간, 마지막 세션 뒤 15분 무활동. 체크박스가 앞당기는 건 그 무활동 대기뿐인데
  //   값은 매번 치렀고, 원격 창↔목록 창의 상태 동기화가 통째로 이 질문 하나를 위해
  //   존재했다. 거두는 길은 목록 우클릭 [원격 예약 취소]와 패널 칩이 맡는다.
  Future<bool> _chainremoteConfirmCloseDuringSessionInner(int connLength) async {
    final msg = connLength > 1
        ? '원격 세션 $connLength개가 진행 중입니다. 모두 종료할까요?\n거래처 연결이 끊깁니다.'
        : '원격 세션이 진행 중입니다. 종료할까요?\n거래처 연결이 끊깁니다.';
    final res = await gFFI.dialogManager.show<bool>((setState, close, context) {
      return CustomAlertDialog(
        title: Row(children: [
          const Icon(Icons.warning_amber_sharp,
              color: Colors.redAccent, size: 28),
          const SizedBox(width: 10),
          Text(translate("Warning")),
        ]),
        content: Text(msg),
        actions: [
          dialogButton("Cancel", onPressed: () => close(false), isOutline: true),
          dialogButton("OK", onPressed: () => close(true)),
        ],
        onSubmit: () => close(true),
        onCancel: () => close(false),
      );
    });
    return res == true;
  }

  _update_remote_count() =>
      RemoteCountState.find().value = tabController.length;

  Future<dynamic> _remoteMethodHandler(call, fromWindowId) async {
    debugPrint(
        "[Remote Page] call ${call.method} with args ${call.arguments} from window $fromWindowId");

    dynamic returnValue;
    // for simplify, just replace connectionId
    if (call.method == kWindowEventNewRemoteDesktop) {
      final args = jsonDecode(call.arguments);
      final id = args['id'];
      final switchUuid = args['switch_uuid'];
      final sessionId = args['session_id'];
      final tabWindowId = args['tab_window_id'];
      final display = args['display'];
      final displays = args['displays'];
      final screenRect = parseParamScreenRect(args);
      final prePeerCount = tabController.length;
      Future.delayed(Duration.zero, () async {
        if (stateGlobal.fullscreen.isTrue) {
          await WindowController.fromWindowId(windowId()).setFullscreen(false);
          stateGlobal.setFullscreen(false, procWnd: false);
        }
        await setNewConnectWindowFrame(windowId(), id!, prePeerCount,
            WindowType.RemoteDesktop, display, screenRect);
        Future.delayed(Duration(milliseconds: isWindows ? 100 : 0), () async {
          await windowOnTop(windowId());
        });
      });
      ConnectionTypeState.init(id);
      tabController.add(TabInfo(
        key: id,
        label: id,
        selectedIcon: selectedIcon,
        unselectedIcon: unselectedIcon,
        onTabCloseButton: () async {
          // 탭 X 도 무경고 끊김 방지 — 확인 후 닫는다. A/S 기록은 종료 후 메인 창 모달.
          if (!await _chainremoteConfirmCloseDuringSession(1)) {
            return;
          }
          tabController.closeBy(id);
        },
        page: RemotePage(
          key: ValueKey(id),
          id: id,
          sessionId: sessionId == null ? null : SessionID(sessionId),
          tabWindowId: tabWindowId,
          display: display,
          displays: displays?.cast<int>(),
          password: args['password'],
          toolbarState: ToolbarState(),
          tabController: tabController,
          switchUuid: switchUuid,
          forceRelay: args['forceRelay'],
          isSharedPassword: args['isSharedPassword'],
        ),
      ));
    } else if (call.method == kWindowDisableGrabKeyboard) {
      // ???
    } else if (call.method == "onDestroy") {
      tabController.clear();
    } else if (call.method == kWindowActionRebuild) {
      reloadCurrentWindow();
    } else if (call.method == kWindowEventActiveSession) {
      final jumpOk = tabController.jumpToByKey(call.arguments);
      if (jumpOk) {
        windowOnTop(windowId());
      }
      return jumpOk;
    } else if (call.method == kWindowEventActiveDisplaySession) {
      final args = jsonDecode(call.arguments);
      final id = args['id'];
      final display = args['display'];
      final jumpOk = tabController.jumpToByKeyAndDisplay(id, display);
      if (jumpOk) {
        windowOnTop(windowId());
      }
      return jumpOk;
    } else if (call.method == kWindowEventGetRemoteList) {
      return tabController.state.value.tabs
          .map((e) => e.key)
          .toList()
          .join(',');
    } else if (call.method == kWindowEventGetSessionIdList) {
      return tabController.state.value.tabs
          .map((e) => '${e.key},${(e.page as RemotePage).ffi.sessionId}')
          .toList()
          .join(';');
    } else if (call.method == kWindowEventGetCachedSessionData) {
      // Ready to show new window and close old tab.
      final args = jsonDecode(call.arguments);
      final id = args['id'];
      final close = args['close'];
      try {
        final remotePage = tabController.state.value.tabs
            .firstWhere((tab) => tab.key == id)
            .page as RemotePage;
        returnValue = remotePage.ffi.ffiModel.cachedPeerData.toString();
      } catch (e) {
        debugPrint('Failed to get cached session data: $e');
      }
      if (close && returnValue != null) {
        closeSessionOnDispose[id] = false;
        tabController.closeBy(id);
      }
    } else if (call.method == kWindowEventRemoteWindowCoords) {
      final remotePage =
          tabController.state.value.selectedTabInfo.page as RemotePage;
      final ffi = remotePage.ffi;
      final displayRect = ffi.ffiModel.displaysRect();
      if (displayRect != null) {
        final wc = WindowController.fromWindowId(windowId());
        Rect? frame;
        try {
          frame = await wc.getFrame();
        } catch (e) {
          debugPrint(
              "Failed to get frame of window $windowId, it may be hidden");
        }
        if (frame != null) {
          ffi.cursorModel.moveLocal(0, 0);
          final coords = RemoteWindowCoords(
              frame,
              CanvasCoords.fromCanvasModel(ffi.canvasModel),
              CursorCoords.fromCursorModel(ffi.cursorModel),
              displayRect);
          returnValue = jsonEncode(coords.toJson());
        }
      }
    } else if (call.method == kWindowEventSetFullscreen) {
      stateGlobal.setFullscreen(call.arguments == 'true');
    }
    _update_remote_count();
    return returnValue;
  }
}

/// A widget that displays a hint in the tab bar when relative mouse mode is active.
/// This helps users remember how to exit relative mouse mode.
class _RelativeMouseModeHint extends StatelessWidget {
  final DesktopTabController tabController;

  const _RelativeMouseModeHint({Key? key, required this.tabController})
      : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      // Check if there are any tabs
      if (tabController.state.value.tabs.isEmpty) {
        return const SizedBox.shrink();
      }

      // Get current selected tab's RemotePage
      final selectedTabInfo = tabController.state.value.selectedTabInfo;
      if (selectedTabInfo.page is! RemotePage) {
        return const SizedBox.shrink();
      }

      final remotePage = selectedTabInfo.page as RemotePage;
      final String peerId = remotePage.id;

      // Use global state to check relative mouse mode (synced from InputModel).
      // This avoids timing issues with FFI registration.
      final isRelativeMouseMode =
          stateGlobal.relativeMouseModeState[peerId] ?? false;

      if (!isRelativeMouseMode) {
        return const SizedBox.shrink();
      }

      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        margin: const EdgeInsets.only(right: 8),
        decoration: BoxDecoration(
          color: Colors.orange.withOpacity(0.2),
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: Colors.orange.withOpacity(0.5)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.mouse,
              size: 14,
              color: Colors.orange[700],
            ),
            const SizedBox(width: 4),
            Text(
              translate(
                  'rel-mouse-exit-{${isMacOS ? "Cmd+G" : "Ctrl+Alt"}}-tip'),
              style: TextStyle(
                fontSize: 11,
                color: Colors.orange[700],
              ),
            ),
          ],
        ),
      );
    });
  }
}
