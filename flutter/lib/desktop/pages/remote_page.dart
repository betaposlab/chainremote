import 'dart:async';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/scheduler.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:flutter_hbb/models/state_model.dart';

import '../../consts.dart';
import '../../common/widgets/overlay.dart';
import '../../common/widgets/remote_input.dart';
import '../../common/widgets/chainremote_session_record.dart';
import '../../common/widgets/chainremote_sched.dart';
import '../widgets/chainremote_annotate.dart';
import '../../common.dart';
import '../../common/widgets/dialog.dart';
import '../../common/widgets/toolbar.dart';
import '../../models/model.dart';
import '../../models/input_model.dart';
import '../../models/platform_model.dart';
import '../../common/shared_state.dart';
import '../../utils/image.dart';
import '../widgets/remote_toolbar.dart';
import '../widgets/kb_layout_type_chooser.dart';
import '../widgets/tabbar_widget.dart';

import 'package:flutter_hbb/native/custom_cursor.dart'
    if (dart.library.html) 'package:flutter_hbb/web/custom_cursor.dart';

final SimpleWrapper<bool> _firstEnterImage = SimpleWrapper(false);

// Used to skip session close if "move to new window" is clicked.
final Map<String, bool> closeSessionOnDispose = {};

class RemotePage extends StatefulWidget {
  RemotePage({
    Key? key,
    required this.id,
    required this.toolbarState,
    this.sessionId,
    this.tabWindowId,
    this.password,
    this.display,
    this.displays,
    this.tabController,
    this.switchUuid,
    this.forceRelay,
    this.isSharedPassword,
  }) : super(key: key) {
    initSharedStates(id);
  }

  final String id;
  final SessionID? sessionId;
  final int? tabWindowId;
  final int? display;
  final List<int>? displays;
  final String? password;
  final ToolbarState toolbarState;
  final String? switchUuid;
  final bool? forceRelay;
  final bool? isSharedPassword;
  final SimpleWrapper<State<RemotePage>?> _lastState = SimpleWrapper(null);
  final DesktopTabController? tabController;

  FFI get ffi => (_lastState.value! as _RemotePageState)._ffi;

  /// State 가 아직 붙지 않았는지(=ffi 접근이 예외를 던지는지) 미리 확인한다.
  /// PageView 는 자식(RemotePage)을 layout 단계에서 만드는데 탭바 tail 은 같은 프레임의
  /// build 단계에서 먼저 평가된다 → 새 창의 첫 프레임엔 _lastState 가 반드시 null 이다.
  /// 그걸 모르고 ffi 를 읽으면 tail 전체가 ErrorWidget 으로 바뀌어 툴바가 통째로 사라진다.
  bool get hasState => _lastState.value != null;

  @override
  State<RemotePage> createState() {
    final state = _RemotePageState(id);
    _lastState.value = state;
    return state;
  }
}

class _RemotePageState extends State<RemotePage>
    with
        AutomaticKeepAliveClientMixin,
        MultiWindowListener,
        TickerProviderStateMixin {
  Timer? _timer;
  String keyboardMode = "legacy";
  bool _isWindowBlur = false;
  final _cursorOverImage = false.obs;
  late RxBool _showRemoteCursor;
  late RxBool _zoomCursor;
  late RxBool _remoteCursorMoved;
  late RxBool _keyboardEnabled;
  final _uniqueKey = UniqueKey();

  var _blockableOverlayState = BlockableOverlayState();

  final FocusNode _rawKeyFocusNode = FocusNode(debugLabel: "rawkeyFocusNode");

  // Debounce timer for pointer lock center updates during window events.
  // Uses kDefaultPointerLockCenterThrottleMs from consts.dart for the duration.
  Timer? _pointerLockCenterDebounceTimer;

  // We need `_instanceIdOnEnterOrLeaveImage4Toolbar` together with `_onEnterOrLeaveImage4Toolbar`
  // to identify the toolbar instance and its callback function.
  int? _instanceIdOnEnterOrLeaveImage4Toolbar;
  Function(bool)? _onEnterOrLeaveImage4Toolbar;

  late FFI _ffi;

  SessionID get sessionId => _ffi.sessionId;

  _RemotePageState(String id) {
    _initStates(id);
  }

  void _initStates(String id) {
    _zoomCursor = PeerBoolOption.find(id, kOptionZoomCursor);
    _showRemoteCursor = ShowRemoteCursorState.find(id);
    _keyboardEnabled = KeyboardEnabledState.find(id);
    _remoteCursorMoved = RemoteCursorMovedState.find(id);
  }

  @override
  void initState() {
    super.initState();
    _ffi = FFI(widget.sessionId);
    Get.put<FFI>(_ffi, tag: widget.id);
    _ffi.imageModel.addCallbackOnFirstImage((String peerId) {
      _ffi.canvasModel.activateLocalCursor();
      showKBLayoutTypeChooserIfNeeded(
          _ffi.ffiModel.pi.platform, _ffi.dialogManager);
      _ffi.recordingModel
          .updateStatus(bind.sessionGetIsRecording(sessionId: _ffi.sessionId));
    });
    _ffi.canvasModel.initializeEdgeScrollFallback(this);
    _ffi.start(
      widget.id,
      password: widget.password,
      isSharedPassword: widget.isSharedPassword,
      switchUuid: widget.switchUuid,
      forceRelay: widget.forceRelay,
      tabWindowId: widget.tabWindowId,
      display: widget.display,
      displays: widget.displays,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: []);
      _ffi.dialogManager
          .showLoading(translate('Connecting...'), onCancel: closeConnection);
    });
    WakelockManager.enable(_uniqueKey);

    _ffi.ffiModel.updateEventListener(sessionId, widget.id);
    if (!isWeb) bind.pluginSyncUi(syncTo: kAppTypeDesktopRemote);
    _ffi.qualityMonitorModel.checkShowQualityMonitor(sessionId);
    _ffi.dialogManager.loadMobileActionsOverlayVisible();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Session option should be set after models.dart/FFI.start
      _showRemoteCursor.value = bind.sessionGetToggleOptionSync(
          sessionId: sessionId, arg: 'show-remote-cursor');
      _zoomCursor.value = bind.sessionGetToggleOptionSync(
          sessionId: sessionId, arg: kOptionZoomCursor);
    });
    DesktopMultiWindow.addListener(this);
    // if (!_isCustomCursorInited) {
    //   customCursorController.registerNeedUpdateCursorCallback(
    //       (String? lastKey, String? currentKey) async {
    //     if (_firstEnterImage.value) {
    //       _firstEnterImage.value = false;
    //       return true;
    //     }
    //     return lastKey == null || lastKey != currentKey;
    //   });
    //   _isCustomCursorInited = true;
    // }

    _blockableOverlayState.applyFfi(_ffi);
    // Call onSelected in post frame callback, since we cannot guarantee that the callback will not call setState.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.tabController?.onSelected?.call(widget.id);
    });

    // Register callback to cancel debounce timer when relative mouse mode is disabled
    _ffi.inputModel.onRelativeMouseModeDisabled =
        _cancelPointerLockCenterDebounceTimer;

    // ChainRemote: 원격 시작 기록(논블로킹, 전역 레지스트리). 거절/실패/내부기기는 서버·
    //   <15초 discard 가 걸러냄. 종료는 dispose 캐치올 → 메인 창 A/S 보강 모달로 이어진다.
    crSessionStart(widget.id);
  }

  /// Cancel the pointer lock center debounce timer
  void _cancelPointerLockCenterDebounceTimer() {
    _pointerLockCenterDebounceTimer?.cancel();
    _pointerLockCenterDebounceTimer = null;
  }

  @override
  void onWindowBlur() {
    super.onWindowBlur();
    // On windows, we use `focus` way to handle keyboard better.
    // Now on Linux, there's some rdev issues which will break the input.
    // We disable the `focus` way for non-Windows temporarily.
    if (isWindows) {
      _isWindowBlur = true;
      // unfocus the primary-focus when the whole window is lost focus,
      // and let OS to handle events instead.
      _rawKeyFocusNode.unfocus();
    }
    stateGlobal.isFocused.value = false;

    // When window loses focus, temporarily release relative mouse mode constraints
    // to allow user to interact with other applications normally.
    // The cursor will be re-hidden and re-centered when window regains focus.
    if (_ffi.inputModel.relativeMouseMode.value) {
      _ffi.inputModel.onWindowBlur();
    }
  }

  @override
  void onWindowFocus() {
    super.onWindowFocus();
    // See [onWindowBlur].
    if (isWindows) {
      _isWindowBlur = false;
    }
    stateGlobal.isFocused.value = true;

    // Restore relative mouse mode constraints when window regains focus.
    if (_ffi.inputModel.relativeMouseMode.value) {
      _rawKeyFocusNode.requestFocus();
      _ffi.inputModel.onWindowFocus();
    }
  }

  @override
  void onWindowRestore() {
    super.onWindowRestore();
    // On windows, we use `onWindowRestore` way to handle window restore from
    // a minimized state.
    if (isWindows) {
      _isWindowBlur = false;
    }
    WakelockManager.enable(_uniqueKey);
    // Update pointer lock center when window is restored
    _updatePointerLockCenterIfNeeded();
  }

  // When the window is unminimized, onWindowMaximize or onWindowRestore can be called when the old state was maximized or not.
  @override
  void onWindowMaximize() {
    super.onWindowMaximize();
    WakelockManager.enable(_uniqueKey);
    // Update pointer lock center when window is maximized
    _updatePointerLockCenterIfNeeded();
  }

  @override
  void onWindowResize() {
    super.onWindowResize();
    // Update pointer lock center when window is resized
    _updatePointerLockCenterIfNeeded();
  }

  @override
  void onWindowMove() {
    super.onWindowMove();
    // Update pointer lock center when window is moved
    _updatePointerLockCenterIfNeeded();
  }

  /// Update pointer lock center with debouncing to avoid excessive updates
  /// during rapid window move/resize events.
  void _updatePointerLockCenterIfNeeded() {
    if (!_ffi.inputModel.relativeMouseMode.value) return;

    // Cancel any pending update and schedule a new one (debounce pattern)
    _pointerLockCenterDebounceTimer?.cancel();
    _pointerLockCenterDebounceTimer = Timer(
      const Duration(milliseconds: kDefaultPointerLockCenterThrottleMs),
      () {
        if (!mounted) return;
        if (_ffi.inputModel.relativeMouseMode.value) {
          _ffi.inputModel.updatePointerLockCenter();
        }
      },
    );
  }

  @override
  void onWindowMinimize() {
    super.onWindowMinimize();
    WakelockManager.disable(_uniqueKey);
    // Release cursor constraints when minimized
    if (_ffi.inputModel.relativeMouseMode.value) {
      _ffi.inputModel.onWindowBlur();
    }
  }

  @override
  void onWindowEnterFullScreen() {
    super.onWindowEnterFullScreen();
    if (isMacOS) {
      stateGlobal.setFullscreen(true);
    }
  }

  @override
  void onWindowLeaveFullScreen() {
    super.onWindowLeaveFullScreen();
    if (isMacOS) {
      stateGlobal.setFullscreen(false);
    }
  }

  @override
  Future<void> dispose() async {
    final closeSession = closeSessionOnDispose.remove(widget.id) ?? true;

    // ChainRemote: 세션 종료 기록 캐치올(모달이 이미 기록했으면 skip). 창이동(closeSession=false)은
    //   세션 유지라 제외. 논블로킹 fire-and-forget — dispose 진행 안 막고 실패해도 무해.
    if (closeSession) {
      crSessionEndAuto(widget.id);
      // ChainRemote 예약원격: 창 상태 기억을 지운다. 다음에 붙으면 거래처가 다시 알려 주므로
      //   들고 있어 봐야 낡기만 한다 — 그 사이 만료되거나 사장님이 트레이에서 취소했을 수 있다.
      crSchedForgetState(widget.id);
      // 그리다 만 선을 거래처 화면에 두고 나오면 안 된다(Chang: 원격 끄면 즉시 사라질 것).
      CrAnnotateModel.of(widget.id).endSession(sessionId);
      CrAnnotateModel.dispose_(widget.id);
    }

    // https://github.com/flutter/flutter/issues/64935
    super.dispose();
    debugPrint("REMOTE PAGE dispose session $sessionId ${widget.id}");

    // Defensive cleanup: ensure host system-key propagation is reset even if
    // MouseRegion.onExit never fired (e.g., tab closed while cursor inside).
    if (!isWeb) bind.hostStopSystemKeyPropagate(stopped: true);

    _pointerLockCenterDebounceTimer?.cancel();
    _pointerLockCenterDebounceTimer = null;
    // Clear callback reference to prevent memory leaks and stale references
    _ffi.inputModel.onRelativeMouseModeDisabled = null;
    // Relative mouse mode cleanup is centralized in FFI.close(closeSession: ...).
    _ffi.textureModel.onRemotePageDispose(closeSession);
    if (closeSession) {
      // ensure we leave this session, this is a double check
      _ffi.inputModel.enterOrLeave(false);
    }
    DesktopMultiWindow.removeListener(this);
    _ffi.dialogManager.hideMobileActionsOverlay();
    _ffi.imageModel.disposeImage();
    _ffi.cursorModel.disposeImages();
    _rawKeyFocusNode.dispose();
    await _ffi.close(closeSession: closeSession);
    _timer?.cancel();
    _ffi.dialogManager.dismissAll();
    if (closeSession) {
      await SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual,
          overlays: SystemUiOverlay.values);
    }
    WakelockManager.disable(_uniqueKey);
    await Get.delete<FFI>(tag: widget.id);
    removeSharedStates(widget.id);
  }

  Widget emptyOverlay() => BlockableOverlay(
        /// the Overlay key will be set with _blockableOverlayState in BlockableOverlay
        /// see override build() in [BlockableOverlay]
        state: _blockableOverlayState,
        underlying: Container(
          color: Colors.transparent,
        ),
      );

  Widget buildBody(BuildContext context) {
    // 2026-05-27 v4: toolbar 를 DesktopTab.tail(탭바 라인)로 옮겨서 여기서는
    // 거래처 화면만 그린다. RemoteToolbar 는 remote_tab_page.dart 에서 부른다.
    bodyWidget() {
      return Stack(
            children: [
                Container(
                      color: kColorCanvas,
                      child: RawKeyFocusScope(
                          focusNode: _rawKeyFocusNode,
                          onFocusChange: (bool imageFocused) {
                            debugPrint(
                                "onFocusChange(window active:${!_isWindowBlur}) $imageFocused");
                            // See [onWindowBlur].
                            if (isWindows) {
                              if (_isWindowBlur) {
                                imageFocused = false;
                                Future.delayed(Duration.zero, () {
                                  _rawKeyFocusNode.unfocus();
                                });
                              }
                              if (imageFocused) {
                                _ffi.inputModel.enterOrLeave(true);
                              } else {
                                _ffi.inputModel.enterOrLeave(false);
                              }
                            }
                          },
                          inputModel: _ffi.inputModel,
                          child: getBodyForDesktop(context))),
                _ffi.ffiModel.pi.isSet.isTrue &&
                        _ffi.ffiModel.waitForFirstImage.isTrue
                    ? emptyOverlay()
                    : () {
                        if (!_ffi.ffiModel.isPeerAndroid) {
                          return Offstage();
                        } else {
                          return Obx(() => Offstage(
                                offstage: _ffi.dialogManager
                                    .mobileActionsOverlayVisible.isFalse,
                                child: Overlay(initialEntries: [
                                  makeMobileActionsOverlayEntry(
                                    () => _ffi.dialogManager
                                        .setMobileActionsOverlayVisible(false),
                                    ffi: _ffi,
                                  )
                                ]),
                              ));
                        }
                      }(),
                _ffi.ffiModel.pi.isSet.isFalse ? emptyOverlay() : Offstage(),
                // 전체화면 상단 hover 툴바 (2026-08-15 A안 2차). ★항상 마운트 —
                // 전체화면 여부로 이 슬롯의 위젯 타입을 갈아끼우면 형제 Element 가
                // 재생성될 수 있다. 켜고 끄기는 위젯 '안'의 Obx 가 한다.
                _FullscreenToolbarReveal(
                  id: widget.id,
                  ffi: _ffi,
                  toolbarState: widget.toolbarState,
                ),
              ],
            );
    }

    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.background,
      body: Obx(() {
        final imageReady = _ffi.ffiModel.pi.isSet.isTrue &&
            _ffi.ffiModel.waitForFirstImage.isFalse;
        if (imageReady) {
          // If the privacy mode(disable physical displays) is switched,
          // we should not dismiss the dialog immediately.
          if (DateTime.now().difference(togglePrivacyModeTime) >
              const Duration(milliseconds: 3000)) {
            // `dismissAll()` is to ensure that the state is clean.
            // It's ok to call dismissAll() here.
            _ffi.dialogManager.dismissAll();
            // Recreate the block state to refresh the state.
            _blockableOverlayState = BlockableOverlayState();
            _blockableOverlayState.applyFfi(_ffi);
          }
          // Block the whole `bodyWidget()` when dialog shows.
          return BlockableOverlay(
            underlying: bodyWidget(),
            state: _blockableOverlayState,
          );
        } else {
          // `_blockableOverlayState` is not recreated here.
          // The toolbar's block state won't work properly when reconnecting, but that's okay.
          return bodyWidget();
        }
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return WillPopScope(
        onWillPop: () async {
          clientClose(sessionId, _ffi);
          return false;
        },
        child: MultiProvider(providers: [
          ChangeNotifierProvider.value(value: _ffi.ffiModel),
          ChangeNotifierProvider.value(value: _ffi.imageModel),
          ChangeNotifierProvider.value(value: _ffi.cursorModel),
          ChangeNotifierProvider.value(value: _ffi.canvasModel),
          ChangeNotifierProvider.value(value: _ffi.recordingModel),
        ], child: buildBody(context)));
  }

  void enterView(PointerEnterEvent evt) {
    _ffi.canvasModel.rearmEdgeScroll();

    _cursorOverImage.value = true;
    _firstEnterImage.value = true;
    if (_onEnterOrLeaveImage4Toolbar != null) {
      try {
        _onEnterOrLeaveImage4Toolbar!(true);
      } catch (e) {
        //
      }
    }

    // See [onWindowBlur].
    if (!isWindows) {
      if (!_rawKeyFocusNode.hasFocus) {
        _rawKeyFocusNode.requestFocus();
      }
      _ffi.inputModel.enterOrLeave(true);
    }
  }

  void leaveView(PointerExitEvent evt) {
    _ffi.canvasModel.disableEdgeScroll();

    if (_ffi.ffiModel.keyboard) {
      _ffi.inputModel.tryMoveEdgeOnExit(evt.position);
    }

    _cursorOverImage.value = false;
    _firstEnterImage.value = false;
    if (_onEnterOrLeaveImage4Toolbar != null) {
      try {
        _onEnterOrLeaveImage4Toolbar!(false);
      } catch (e) {
        //
      }
    }

    // See [onWindowBlur].
    if (!isWindows) {
      _ffi.inputModel.enterOrLeave(false);
    }
  }

  Widget _buildRawTouchAndPointerRegion(
    Widget child,
    PointerEnterEventListener? onEnter,
    PointerExitEventListener? onExit,
  ) {
    return RawTouchGestureDetectorRegion(
      child: _buildRawPointerMouseRegion(child, onEnter, onExit),
      ffi: _ffi,
    );
  }

  Widget _buildRawPointerMouseRegion(
    Widget child,
    PointerEnterEventListener? onEnter,
    PointerExitEventListener? onExit,
  ) {
    return RawPointerMouseRegion(
      onEnter: onEnter,
      onExit: onExit,
      onPointerDown: (event) {
        // A double check for blur status.
        // Note: If there's an `onPointerDown` event is triggered, `_isWindowBlur` is expected being false.
        // Sometimes the system does not send the necessary focus event to flutter. We should manually
        // handle this inconsistent status by setting `_isWindowBlur` to false. So we can
        // ensure the grab-key thread is running when our users are clicking the remote canvas.
        if (_isWindowBlur) {
          debugPrint(
              "Unexpected status: onPointerDown is triggered while the remote window is in blur status");
          _isWindowBlur = false;
        }
        if (!_rawKeyFocusNode.hasFocus) {
          _rawKeyFocusNode.requestFocus();
        }
      },
      inputModel: _ffi.inputModel,
      child: child,
    );
  }

  Widget getBodyForDesktop(BuildContext context) {
    var paints = <Widget>[
      MouseRegion(
        onEnter: (evt) {
          if (!isWeb) bind.hostStopSystemKeyPropagate(stopped: false);
        },
        onExit: (evt) {
          if (!isWeb) bind.hostStopSystemKeyPropagate(stopped: true);
        },
        child: _ViewStyleUpdater(
          canvasModel: _ffi.canvasModel,
          inputModel: _ffi.inputModel,
          child: Builder(builder: (context) {
            final peerDisplay = CurrentDisplayState.find(widget.id);
            return Obx(
              () => _ffi.ffiModel.pi.isSet.isFalse
                  ? Container(color: Colors.transparent)
                  : Obx(() {
                      _ffi.textureModel.updateCurrentDisplay(peerDisplay.value);
                      return ImagePaint(
                        id: widget.id,
                        zoomCursor: _zoomCursor,
                        cursorOverImage: _cursorOverImage,
                        keyboardEnabled: _keyboardEnabled,
                        remoteCursorMoved: _remoteCursorMoved,
                        listenerBuilder: (child) =>
                            _buildRawTouchAndPointerRegion(
                                child, enterView, leaveView),
                        ffi: _ffi,
                      );
                    }),
            );
          }),
        ),
      )
    ];

    if (!_ffi.canvasModel.cursorEmbedded) {
      paints
          .add(Obx(() => _showRemoteCursor.isFalse || _remoteCursorMoved.isFalse
              ? Offstage()
              : CursorPaint(
                  id: widget.id,
                  zoomCursor: _zoomCursor,
                )));
    }
    paints.add(
      Positioned(
        top: 10,
        right: 10,
        child: _buildRawTouchAndPointerRegion(
            QualityMonitor(_ffi.qualityMonitorModel), null, null),
      ),
    );
    // 마킹 층 — 이미지 위. 꺼져 있으면 포인터를 그대로 흘려보내 원격 조작에 영향이 없고,
    //   켜져 있을 때만 가로채 그린다. 우클릭 두 번 감지도 여기서 한다.
    paints.add(CrAnnotateLayer(peerId: widget.id, ffi: _ffi));
    return Stack(
      children: paints,
    );
  }

  @override
  bool get wantKeepAlive => true;
}

/// A widget that tracks the view size and updates CanvasModel.updateViewStyle()
/// and InputModel.updateImageWidgetSize() only when size actually changes.
/// This avoids scheduling post-frame callbacks on every LayoutBuilder rebuild.
class _ViewStyleUpdater extends StatefulWidget {
  final CanvasModel canvasModel;
  final InputModel inputModel;
  final Widget child;

  const _ViewStyleUpdater({
    Key? key,
    required this.canvasModel,
    required this.inputModel,
    required this.child,
  }) : super(key: key);

  @override
  State<_ViewStyleUpdater> createState() => _ViewStyleUpdaterState();
}

class _ViewStyleUpdaterState extends State<_ViewStyleUpdater> {
  Size? _lastSize;
  bool _callbackScheduled = false;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxWidth = constraints.maxWidth;
        final maxHeight = constraints.maxHeight;
        // Guard against infinite constraints (e.g., unconstrained ancestor).
        if (!maxWidth.isFinite || !maxHeight.isFinite) {
          return widget.child;
        }
        final newSize = Size(maxWidth, maxHeight);
        if (_lastSize != newSize) {
          _lastSize = newSize;
          // Schedule the update for after the current frame to avoid setState during build.
          // Use _callbackScheduled flag to prevent accumulating multiple callbacks
          // when size changes rapidly before any callback executes.
          if (!_callbackScheduled) {
            _callbackScheduled = true;
            SchedulerBinding.instance.addPostFrameCallback((_) {
              _callbackScheduled = false;
              final currentSize = _lastSize;
              if (mounted && currentSize != null) {
                widget.canvasModel.updateViewStyle();
                widget.inputModel.updateImageWidgetSize(currentSize);
              }
            });
          }
        }
        return widget.child;
      },
    );
  }
}

class ImagePaint extends StatefulWidget {
  final FFI ffi;
  final String id;
  final RxBool zoomCursor;
  final RxBool cursorOverImage;
  final RxBool keyboardEnabled;
  final RxBool remoteCursorMoved;
  final Widget Function(Widget)? listenerBuilder;

  ImagePaint(
      {Key? key,
      required this.ffi,
      required this.id,
      required this.zoomCursor,
      required this.cursorOverImage,
      required this.keyboardEnabled,
      required this.remoteCursorMoved,
      this.listenerBuilder})
      : super(key: key);

  @override
  State<StatefulWidget> createState() => _ImagePaintState();
}

class _ImagePaintState extends State<ImagePaint> {
  bool _lastRemoteCursorMoved = false;

  String get id => widget.id;
  RxBool get zoomCursor => widget.zoomCursor;
  RxBool get cursorOverImage => widget.cursorOverImage;
  RxBool get keyboardEnabled => widget.keyboardEnabled;
  RxBool get remoteCursorMoved => widget.remoteCursorMoved;
  Widget Function(Widget)? get listenerBuilder => widget.listenerBuilder;

  @override
  Widget build(BuildContext context) {
    final m = Provider.of<ImageModel>(context);
    var c = Provider.of<CanvasModel>(context);
    final s = c.scale;

    bool isViewAdaptive() => c.viewStyle.style == kRemoteViewStyleAdaptive;
    bool isViewOriginal() => c.viewStyle.style == kRemoteViewStyleOriginal;

    mouseRegion({child}) => Obx(() {
          double getCursorScale() {
            var c = Provider.of<CanvasModel>(context);
            var cursorScale = 1.0;
            if (isWindows) {
              // debug win10
              if (zoomCursor.value && isViewAdaptive()) {
                cursorScale = s * c.devicePixelRatio;
              }
            } else {
              if (zoomCursor.value || isViewOriginal()) {
                cursorScale = s;
              }
            }
            return cursorScale;
          }

          return MouseRegion(
              cursor: cursorOverImage.isTrue
                  ? c.cursorEmbedded
                      ? SystemMouseCursors.none
                      // Hide cursor when relative mouse mode is active
                      : widget.ffi.inputModel.relativeMouseMode.value
                          ? SystemMouseCursors.none
                          : keyboardEnabled.isTrue
                              ? (() {
                                  if (remoteCursorMoved.isTrue) {
                                    _lastRemoteCursorMoved = true;
                                    return SystemMouseCursors.none;
                                  } else {
                                    if (_lastRemoteCursorMoved) {
                                      _lastRemoteCursorMoved = false;
                                      _firstEnterImage.value = true;
                                    }
                                    return _buildCustomCursor(
                                        context, getCursorScale());
                                  }
                                }())
                              : _buildDisabledCursor(context, getCursorScale())
                  : MouseCursor.defer,
              onHover: (evt) {},
              child: child);
        });
    if (c.imageOverflow.isTrue && c.scrollStyle != ScrollStyle.scrollauto) {
      final paintWidth = c.getDisplayWidth() * s;
      final paintHeight = c.getDisplayHeight() * s;
      final paintSize = Size(paintWidth, paintHeight);
      final paintWidget =
          m.useTextureRender || widget.ffi.ffiModel.pi.forceTextureRender
              ? _BuildPaintTextureRender(
                  c, s, Offset.zero, paintSize, isViewOriginal())
              : _buildScrollbarNonTextureRender(m, paintSize, s);
      return NotificationListener<ScrollNotification>(
          onNotification: (notification) {
            c.updateScrollPercent();
            return false;
          },
          child: mouseRegion(
            child: Obx(() => _buildCrossScrollbarFromLayout(
                  context,
                  _buildListener(paintWidget),
                  c.size,
                  paintSize,
                  c.scrollHorizontal,
                  c.scrollVertical,
                )),
          ));
    } else {
      if (c.size.width > 0 && c.size.height > 0) {
        final paintWidget =
            m.useTextureRender || widget.ffi.ffiModel.pi.forceTextureRender
                ? _BuildPaintTextureRender(
                    c,
                    s,
                    Offset(
                      isLinux ? c.x.toInt().toDouble() : c.x,
                      isLinux ? c.y.toInt().toDouble() : c.y,
                    ),
                    c.size,
                    isViewOriginal())
                : _buildScrollAutoNonTextureRender(m, c, s);
        return mouseRegion(child: _buildListener(paintWidget));
      } else {
        return Container();
      }
    }
  }

  Widget _buildScrollbarNonTextureRender(
      ImageModel m, Size imageSize, double s) {
    return CustomPaint(
      size: imageSize,
      painter: ImagePainter(image: m.image, x: 0, y: 0, scale: s),
    );
  }

  Widget _buildScrollAutoNonTextureRender(
      ImageModel m, CanvasModel c, double s) {
    double sizeScale = s;
    if (widget.ffi.ffiModel.isPeerLinux) {
      final displays = widget.ffi.ffiModel.pi.getCurDisplays();
      if (displays.isNotEmpty) {
        sizeScale = s / displays[0].scale;
      }
    }
    return CustomPaint(
      size: Size(c.size.width, c.size.height),
      painter: ImagePainter(
          image: m.image,
          x: c.x / sizeScale,
          y: c.y / sizeScale,
          scale: sizeScale),
    );
  }

  Widget _BuildPaintTextureRender(
      CanvasModel c, double s, Offset offset, Size size, bool isViewOriginal) {
    final ffiModel = c.parent.target!.ffiModel;
    final displays = ffiModel.pi.getCurDisplays();
    final children = <Widget>[];
    final rect = ffiModel.rect;
    if (rect == null) {
      return Container();
    }
    final isPeerLinux = ffiModel.isPeerLinux;
    final curDisplay = ffiModel.pi.currentDisplay;
    for (var i = 0; i < displays.length; i++) {
      final textureId = widget.ffi.textureModel
          .getTextureId(curDisplay == kAllDisplayValue ? i : curDisplay);
      if (true) {
        // both "textureId.value != -1" and "true" seems ok
        final sizeScale = isPeerLinux ? s / displays[i].scale : s;
        children.add(Positioned(
          left: (displays[i].x - rect.left) * s + offset.dx,
          top: (displays[i].y - rect.top) * s + offset.dy,
          width: displays[i].width * sizeScale,
          height: displays[i].height * sizeScale,
          child: Obx(() => Texture(
                textureId: textureId.value,
                filterQuality:
                    isViewOriginal ? FilterQuality.none : FilterQuality.low,
              )),
        ));
      }
    }
    return SizedBox(
      width: size.width,
      height: size.height,
      child: Stack(children: children),
    );
  }

  MouseCursor _buildCustomCursor(BuildContext context, double scale) {
    final cursor = Provider.of<CursorModel>(context);
    final cache = cursor.cache ?? preDefaultCursor.cache;
    return buildCursorOfCache(cursor, scale, cache);
  }

  MouseCursor _buildDisabledCursor(BuildContext context, double scale) {
    final cursor = Provider.of<CursorModel>(context);
    final cache = preForbiddenCursor.cache;
    return buildCursorOfCache(cursor, scale, cache);
  }

  Widget _buildCrossScrollbarFromLayout(
    BuildContext context,
    Widget child,
    Size layoutSize,
    Size size,
    ScrollController horizontal,
    ScrollController vertical,
  ) {
    var widget = child;
    if (layoutSize.width < size.width) {
      widget = ScrollConfiguration(
        behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false),
        child: SingleChildScrollView(
          controller: horizontal,
          scrollDirection: Axis.horizontal,
          physics: cursorOverImage.isTrue
              ? const NeverScrollableScrollPhysics()
              : null,
          child: widget,
        ),
      );
    } else {
      widget = Row(
        children: [
          Container(
            width: ((layoutSize.width - size.width) ~/ 2).toDouble(),
          ),
          widget,
        ],
      );
    }
    if (layoutSize.height < size.height) {
      widget = ScrollConfiguration(
        behavior: ScrollConfiguration.of(context).copyWith(scrollbars: false),
        child: SingleChildScrollView(
          controller: vertical,
          physics: cursorOverImage.isTrue
              ? const NeverScrollableScrollPhysics()
              : null,
          child: widget,
        ),
      );
    } else {
      widget = Column(
        children: [
          Container(
            height: ((layoutSize.height - size.height) ~/ 2).toDouble(),
          ),
          widget,
        ],
      );
    }
    if (layoutSize.width < size.width) {
      widget = RawScrollbar(
        thickness: kScrollbarThickness,
        thumbColor: Colors.grey,
        controller: horizontal,
        thumbVisibility: false,
        trackVisibility: false,
        notificationPredicate: layoutSize.height < size.height
            ? (notification) => notification.depth == 1
            : defaultScrollNotificationPredicate,
        child: widget,
      );
    }
    if (layoutSize.height < size.height) {
      widget = RawScrollbar(
        thickness: kScrollbarThickness,
        thumbColor: Colors.grey,
        controller: vertical,
        thumbVisibility: false,
        trackVisibility: false,
        child: widget,
      );
    }

    return Container(
      child: widget,
      width: layoutSize.width,
      height: layoutSize.height,
    );
  }

  Widget _buildListener(Widget child) {
    if (listenerBuilder != null) {
      return listenerBuilder!(child);
    } else {
      return child;
    }
  }
}

class CursorPaint extends StatelessWidget {
  final String id;
  final RxBool zoomCursor;

  const CursorPaint({
    Key? key,
    required this.id,
    required this.zoomCursor,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final m = Provider.of<CursorModel>(context);
    final c = Provider.of<CanvasModel>(context);
    double hotx = m.hotx;
    double hoty = m.hoty;
    if (m.image == null) {
      if (preDefaultCursor.image != null) {
        hotx = preDefaultCursor.image!.width / 2;
        hoty = preDefaultCursor.image!.height / 2;
      }
    }

    double cx = c.x;
    double cy = c.y;
    if (c.viewStyle.style == kRemoteViewStyleOriginal &&
        c.scrollStyle == ScrollStyle.scrollbar) {
      final rect = c.parent.target!.ffiModel.rect;
      if (rect == null) {
        // unreachable!
        debugPrint('unreachable! The displays rect is null.');
        return Container();
      }
      if (cx < 0) {
        final imageWidth = rect.width * c.scale;
        cx = -imageWidth * c.scrollX;
      }
      if (cy < 0) {
        final imageHeight = rect.height * c.scale;
        cy = -imageHeight * c.scrollY;
      }
    }

    double x = (m.x - hotx) * c.scale + cx;
    double y = (m.y - hoty) * c.scale + cy;
    double scale = 1.0;
    final isViewOriginal = c.viewStyle.style == kRemoteViewStyleOriginal;
    if (zoomCursor.value || isViewOriginal) {
      x = m.x - hotx + cx / c.scale;
      y = m.y - hoty + cy / c.scale;
      scale = c.scale;
    }

    return CustomPaint(
      painter: ImagePainter(
        image: m.image ?? preDefaultCursor.image,
        x: x,
        y: y,
        scale: scale,
      ),
    );
  }
}

/// 전체화면 상단 hover 툴바 (2026-08-15, Chang A안 — 2차 시도).
///
/// ★1차 시도는 DesktopTab 전체를 Stack 으로 '감쌌다'가 원격 화면을 검게 죽였다.
///   전체화면 진입 때 body 의 조상 구조가 바뀌면(직계 자식 → Stack 자식) RemotePage
///   서브트리의 Element/State 가 통째로 재생성되는데, 세션 렌더 경로(특히
///   use texture render:false)는 그걸 못 살아남는다. 연결 로그는 fps30 까지 전부
///   정상이라 "연결 문제"로 오진하기도 쉽다. → [feedback_never_wrap_remote_view_in_stack]
///
/// 그래서 이번엔 아무것도 감싸지 않는다. RemotePage 의 body Stack(원본 RustDesk 의
/// 전체화면 툴바가 원래 살던 자리)에 자식을 '맨 뒤에 덧붙이기'만 했고, 이 자식은
/// 전체화면 여부와 무관하게 항상 마운트다 — 형제(영상)의 슬롯이 절대 안 흔들린다.
///
/// 동작: 전체화면에서 화면 맨 위 12px 에 마우스가 닿으면 툴바 필이 내려오고, 필을
/// 벗어나면 0.8초 뒤 접힌다(즉시 접으면 드롭다운을 여는 순간 같이 닫혀 못 쓴다).
/// 트리거 띠는 hover 만 읽는다(opaque:false) — 클릭·이동은 아래 원격 화면으로 그대로
/// 통과해 맨 윗줄의 원격 조작이 보존된다.
class _FullscreenToolbarReveal extends StatefulWidget {
  final String id;
  final FFI ffi;
  final ToolbarState toolbarState;
  const _FullscreenToolbarReveal({
    required this.id,
    required this.ffi,
    required this.toolbarState,
  });

  @override
  State<_FullscreenToolbarReveal> createState() =>
      _FullscreenToolbarRevealState();
}

class _FullscreenToolbarRevealState extends State<_FullscreenToolbarReveal> {
  final _revealed = false.obs;
  Timer? _hideTimer;

  /// macOS 전체화면은 상단 hover 에 OS 메뉴바가 같이 내려온다(실측). 겹치면 우리
  /// 필이 그 밑에 깔리므로 메뉴바 높이만큼 내려 앉힌다. Windows 는 그런 게 없다.
  double get _topInset => isMacOS ? 28.0 : 0.0;

  void _show() {
    _hideTimer?.cancel();
    _revealed.value = true;
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(const Duration(milliseconds: 800), () {
      if (mounted) _revealed.value = false;
    });
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      height: _topInset + kDesktopRemoteTabBarHeight + 42,
      child: Obx(() {
        if (stateGlobal.fullscreen.isFalse) {
          // 전체화면을 나가면 꺼낸 상태도 접는다. Rx 쓰기는 build 중 금지라 다음 프레임에.
          _hideTimer?.cancel();
          if (_revealed.isTrue) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) _revealed.value = false;
            });
          }
          return const SizedBox.shrink();
        }
        final shown = _revealed.isTrue;
        return Stack(children: [
          // ① 트리거 띠 — 화면 최상단 12px. hover 만 감지, 포인터는 원격으로 통과.
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: 12,
            child: MouseRegion(
              opaque: false,
              onEnter: (_) => _show(),
              onExit: (_) => _scheduleHide(),
              child: const SizedBox.expand(),
            ),
          ),
          // ② 툴바 필 — 창 모드 탭바 라인의 툴바와 같은 물건을 top-center 필로.
          Positioned(
            top: _topInset,
            left: 0,
            right: 0,
            child: IgnorePointer(
              ignoring: !shown,
              child: AnimatedOpacity(
                opacity: shown ? 1 : 0,
                duration: const Duration(milliseconds: 140),
                child: AnimatedSlide(
                  offset: shown ? Offset.zero : const Offset(0, -0.4),
                  duration: const Duration(milliseconds: 140),
                  curve: Curves.easeOut,
                  // ★MouseRegion 은 Align 안(필 크기)에만 — 밖에 두면 full-width 띠가
                  //   되어 그 높이의 원격 hover 를 통째로 가로챈다.
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: MouseRegion(
                      onEnter: (_) => _show(),
                      onExit: (_) => _scheduleHide(),
                      child: Material(
                        elevation: 6,
                        color: Theme.of(context).colorScheme.background,
                        borderRadius: const BorderRadius.vertical(
                            bottom: Radius.circular(10)),
                        clipBehavior: Clip.antiAlias,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 10, vertical: 2),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              RemoteToolbar(
                                id: widget.id,
                                ffi: widget.ffi,
                                state: widget.toolbarState,
                                onEnterOrLeaveImageSetter: (_, __) {},
                                onEnterOrLeaveImageCleaner: (_) {},
                                setRemoteState: (_) {},
                                // 전체화면에선 탭바가 없어 tail 툴바도 없다 — 이게 유일한
                                // 툴바라 initialized 게이트를 건너뛰고 바로 그린다.
                                alwaysShow: true,
                                // 숨김 옵션도 여기서만 무시한다. 전체화면엔 그 옵션을
                                // 되돌릴 우클릭 메뉴가 없어, 켠 채로 들어오면 갇힌다.
                                ignoreHideOption: true,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ]);
      }),
    );
  }
}
