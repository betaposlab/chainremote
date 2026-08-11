// 원격 화면 마킹(자유선) — 본사가 그린 선을 거래처 화면에 띄운다.
//
// 왜 필요했나: 설명 중 "여기 보세요"를 말로만 하고 있었다. 상류 RustDesk 에 whiteboard 가
//   있지만 그건 **커서 위치만 실시간으로** 그리고 남기지 않아 마킹 용도로는 못 쓴다
//   (2026-08-12 Chang 실사용 확인 — 물결은 뜨는데 그려지지 않는다).
//
// 그리는 쪽은 거래처다. 뷰어가 화면 좌표를 원격 디스플레이 좌표로 환산해 보내면, 에이전트가
//   상류의 투명 오버레이 창(src/whiteboard)에 선으로 남긴다. 오버레이 인프라를 그대로 쓰되
//   남는 이벤트(Mark)를 추가했다 — 창 만들기·투명도·렌더러가 이미 검증돼 있어서다.
//
// 사라지는 규칙(Chang 지정): 수동 지우기=즉시 / 손 놓고 10초 / 원격 종료=즉시.
//   10초는 에이전트 오버레이가 스스로 센다 — 뷰어가 타이머를 들고 있으면 창을 닫거나
//   네트워크가 끊겼을 때 지우라는 말을 못 보내 선이 거래처 화면에 영영 남는다.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/model.dart';
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:flutter_hbb/common.dart';

/// 팔레트 — 화면 위에서 눈에 띄어야 하므로 채도 높은 색만 둔다. 회색·검정은 배경에 묻힌다.
const List<int> kCrAnnotateColors = [
  0xFFFF3B30, // 빨강
  0xFFFFCC00, // 노랑
  0xFF34C759, // 초록
  0xFF0A84FF, // 파랑
  0xFFFFFFFF, // 흰색(어두운 화면용)
];
const List<double> kCrAnnotateWidths = [3, 6, 10];

const String _kOptColor = 'cr-annotate-color';
const String _kOptWidth = 'cr-annotate-width';

/// 세션(원격 창)별 마킹 상태. 툴바 버튼과 그리기 층이 같은 것을 봐야 해서 peerId 로 공유한다.
class CrAnnotateModel extends ChangeNotifier {
  static final Map<String, CrAnnotateModel> _all = {};

  static CrAnnotateModel of(String peerId) =>
      _all.putIfAbsent(peerId, () => CrAnnotateModel._());

  static void dispose_(String peerId) {
    _all.remove(peerId)?._stopBatch();
  }

  CrAnnotateModel._() {
    // 색·굵기는 한 번 정하면 계속 쓴다(Chang 요청). 로컬 설정에 남겨 창을 다시 열어도 유지.
    final c = int.tryParse(bind.mainGetLocalOption(key: _kOptColor));
    if (c != null && kCrAnnotateColors.contains(c)) argb = c;
    final w = double.tryParse(bind.mainGetLocalOption(key: _kOptWidth));
    if (w != null && kCrAnnotateWidths.contains(w)) width = w;
  }

  bool active = false;
  /// 팔레트를 펼쳐 뒀나 — 아이콘으로 켰을 때만 펼치고, 더블 우클릭으로 켤 땐 안 펼친다
  /// (그때는 이미 색·굵기를 정해 둔 상태라 곧바로 그리고 싶어 하는 상황이다).
  bool paletteOpen = false;
  int argb = kCrAnnotateColors.first;
  double width = kCrAnnotateWidths[1];

  final List<Offset> _pending = [];
  Timer? _batch;

  void setColor(int v) {
    argb = v;
    bind.mainSetLocalOption(key: _kOptColor, value: '$v');
    notifyListeners();
  }

  void setWidth(double v) {
    width = v;
    bind.mainSetLocalOption(key: _kOptWidth, value: '$v');
    notifyListeners();
  }

  void toggle(SessionID sessionId, {bool openPalette = false}) {
    active = !active;
    paletteOpen = active && openPalette;
    if (!active) {
      // 끄면 그린 것도 같이 걷는다 — Chang 이 말한 "원상태로 돌아온다"가 이 뜻이다.
      _flush(sessionId, endStroke: true);
      _send(sessionId, const [], op: 2, endStroke: true);
    }
    notifyListeners();
  }

  void clear(SessionID sessionId) {
    _pending.clear();
    _send(sessionId, const [], op: 1, endStroke: true);
  }

  /// 원격 창이 닫힐 때 — 남은 선을 거래처 화면에 두고 나오면 안 된다.
  void endSession(SessionID sessionId) {
    if (!active) return;
    active = false;
    paletteOpen = false;
    _send(sessionId, const [], op: 2, endStroke: true);
  }

  void addPoint(SessionID sessionId, Offset p) {
    _pending.add(p);
    // 점 하나마다 보내면 프레임마다 메시지가 날아간다. 40ms 로 묶어 보낸다 —
    //   사람 눈엔 이어진 선으로 보이고 메시지는 25분의 1로 준다.
    _batch ??= Timer.periodic(const Duration(milliseconds: 40), (_) {
      _flush(sessionId, endStroke: false);
    });
  }

  void endStroke(SessionID sessionId) {
    _flush(sessionId, endStroke: true);
    _stopBatch();
  }

  void _stopBatch() {
    _batch?.cancel();
    _batch = null;
  }

  void _flush(SessionID sessionId, {required bool endStroke}) {
    if (_pending.isEmpty && !endStroke) return;
    final pts = List<Offset>.from(_pending);
    _pending.clear();
    // 획을 끝낼 때는 점이 없어도 보낸다 — 에이전트가 "여기서 획이 끊겼다"를 알아야
    //   다음 점이 이전 선에 이어 붙지 않는다.
    if (pts.isEmpty && !endStroke) return;
    _send(sessionId, pts, op: 0, endStroke: endStroke);
  }

  void _send(SessionID sessionId, List<Offset> pts,
      {required int op, required bool endStroke}) {
    final s = pts.map((p) => '${p.dx.toInt()},${p.dy.toInt()}').join(';');
    bind.sessionCrAnnotate(
      sessionId: sessionId,
      op: op,
      points: s,
      argb: argb,
      width: width,
      endStroke: endStroke,
    );
  }
}

/// 화면 위 그리기 층 — 켜져 있을 때만 포인터를 가로챈다.
///   꺼져 있을 땐 translucent 로 두어 원격 조작이 그대로 통과한다. 대신 우클릭만 엿봐서
///   **더블 우클릭으로 그리기를 켜고 끈다**(Chang 요청 — 툴바까지 가지 않고 손에서 바로).
class CrAnnotateLayer extends StatefulWidget {
  final String peerId;
  final FFI ffi;
  const CrAnnotateLayer({Key? key, required this.peerId, required this.ffi})
      : super(key: key);

  @override
  State<CrAnnotateLayer> createState() => _CrAnnotateLayerState();
}

class _CrAnnotateLayerState extends State<CrAnnotateLayer> {
  DateTime? _lastRightDown;

  CrAnnotateModel get _m => CrAnnotateModel.of(widget.peerId);

  // 화면 좌표 → 원격 디스플레이 좌표. 마우스 입력이 쓰는 환산기를 그대로 쓴다
  //   (배율·스크롤·다중 모니터가 이미 반영돼 있다). isMove=false 로 캔버스는 안 건드린다.
  //
  // ★반드시 **전역 좌표**(PointerEvent.position)를 넘긴다. 이 환산기는 안에서 탭바 높이
  //   (CanvasModel.topToEdge)를 빼도록 만들어져 있어서, 이미 그만큼 빠진 localPosition 을
  //   주면 두 번 빠져 그림이 포인터보다 위로 밀린다(2026-08-12 실사용에서 바로 드러났다).
  //   기존 마우스 입력도 e.position 을 넘긴다(input_model.dart:1547).
  Offset? _toRemote(Offset local) {
    final p = widget.ffi.inputModel.handlePointerDevicePos(
      kPointerEventKindMouse,
      local.dx,
      local.dy,
      false,
      kMouseEventTypeDefault,
    );
    return p == null ? null : Offset(p.x.toDouble(), p.y.toDouble());
  }

  bool _isDoubleRight() {
    final now = DateTime.now();
    final prev = _lastRightDown;
    _lastRightDown = now;
    return prev != null && now.difference(prev).inMilliseconds < 450;
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _m,
      builder: (context, _) {
        final active = _m.active;
        return Listener(
          behavior:
              active ? HitTestBehavior.opaque : HitTestBehavior.translucent,
          onPointerDown: (e) {
            if (e.buttons == kSecondaryMouseButton) {
              if (_isDoubleRight()) {
                _m.toggle(widget.ffi.sessionId);
              }
              return;
            }
            if (!active) return;
            final p = _toRemote(e.position);
            if (p != null) _m.addPoint(widget.ffi.sessionId, p);
          },
          onPointerMove: (e) {
            if (!active || e.buttons != kPrimaryMouseButton) return;
            final p = _toRemote(e.position);
            if (p != null) _m.addPoint(widget.ffi.sessionId, p);
          },
          onPointerUp: (e) {
            if (!active) return;
            _m.endStroke(widget.ffi.sessionId);
          },
          child: active
              ? MouseRegion(cursor: SystemMouseCursors.precise)
              : const SizedBox.shrink(),
        );
      },
    );
  }
}

/// 툴바의 그리기 버튼 — 음소거 옆. 누르면 그리기 모드 + 팔레트, 다시 누르면 원상 복귀.
class CrAnnotateButton extends StatefulWidget {
  final String peerId;
  final FFI ffi;
  final Widget Function({
    required Icon icon,
    required String tooltip,
    required VoidCallback onPressed,
    required Color color,
    required Color hoverColor,
  }) buttonBuilder;

  const CrAnnotateButton({
    Key? key,
    required this.peerId,
    required this.ffi,
    required this.buttonBuilder,
  }) : super(key: key);

  @override
  State<CrAnnotateButton> createState() => _CrAnnotateButtonState();
}

class _CrAnnotateButtonState extends State<CrAnnotateButton> {
  final _key = GlobalKey();
  OverlayEntry? _palette;

  CrAnnotateModel get _m => CrAnnotateModel.of(widget.peerId);

  @override
  void dispose() {
    _closePalette();
    super.dispose();
  }

  void _closePalette() {
    _palette?.remove();
    _palette = null;
  }

  void _openPalette() {
    final box = _key.currentContext?.findRenderObject() as RenderBox?;
    if (box == null) return;
    final origin = box.localToGlobal(Offset(0, box.size.height));
    _palette = OverlayEntry(
      builder: (context) => Stack(children: [
        // 바깥을 누르면 팔레트만 닫는다(그리기 모드는 유지 — 곧바로 그릴 수 있어야 한다).
        Positioned.fill(
          child: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: () {
              _closePalette();
              _m.paletteOpen = false;
            },
          ),
        ),
        Positioned(
          left: origin.dx - 60,
          top: origin.dy + 6,
          child: _paletteCard(context),
        ),
      ]),
    );
    Overlay.of(context).insert(_palette!);
  }

  Widget _paletteCard(BuildContext context) {
    return Material(
      color: const Color(0xFF1B2130),
      elevation: 8,
      borderRadius: BorderRadius.circular(10),
      child: AnimatedBuilder(
        animation: _m,
        builder: (context, _) => Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Row(
                mainAxisSize: MainAxisSize.min,
                children: kCrAnnotateColors.map((c) {
                  final on = _m.argb == c;
                  return GestureDetector(
                    onTap: () => _m.setColor(c),
                    child: Container(
                      width: 22,
                      height: 22,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        color: Color(c),
                        shape: BoxShape.circle,
                        border: Border.all(
                            color: on ? Colors.white : Colors.transparent,
                            width: 2),
                      ),
                    ),
                  );
                }).toList()),
            const SizedBox(height: 10),
            Row(
                mainAxisSize: MainAxisSize.min,
                children: kCrAnnotateWidths.map((w) {
                  final on = _m.width == w;
                  return GestureDetector(
                    onTap: () => _m.setWidth(w),
                    child: Container(
                      width: 30,
                      height: 22,
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: on ? Colors.white24 : Colors.transparent,
                        borderRadius: BorderRadius.circular(5),
                      ),
                      child: Container(
                        width: 20,
                        height: w,
                        decoration: BoxDecoration(
                          color: Color(_m.argb),
                          borderRadius: BorderRadius.circular(w),
                        ),
                      ),
                    ),
                  );
                }).toList()),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () => _m.clear(widget.ffi.sessionId),
              icon: const Icon(Icons.cleaning_services_outlined,
                  size: 14, color: Colors.white70),
              label: const Text('지우기',
                  style: TextStyle(fontSize: 12, color: Colors.white70)),
              style: TextButton.styleFrom(
                  minimumSize: const Size(0, 28),
                  padding: const EdgeInsets.symmetric(horizontal: 10)),
            ),
            const Text('우클릭 두 번으로도 켜고 끕니다',
                style: TextStyle(fontSize: 10, color: Colors.white38)),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _m,
      builder: (context, _) {
        final on = _m.active;
        // 모델이 다른 경로(더블 우클릭)로 꺼지면 팔레트도 같이 닫는다.
        if (!on && _palette != null) {
          WidgetsBinding.instance.addPostFrameCallback((_) => _closePalette());
        }
        return Container(
          key: _key,
          child: widget.buttonBuilder(
            icon: Icon(
              Icons.edit_outlined,
              size: 19,
              color: on ? Color(_m.argb) : const Color(0xFFB6BECD),
            ),
            tooltip: on ? '그리기 끄기' : '화면에 그리기',
            color: Colors.transparent,
            hoverColor: const Color(0x1AFFFFFF),
            onPressed: () {
              _m.toggle(widget.ffi.sessionId, openPalette: true);
              if (_m.active) {
                _openPalette();
              } else {
                _closePalette();
              }
            },
          ),
        );
      },
    );
  }
}
