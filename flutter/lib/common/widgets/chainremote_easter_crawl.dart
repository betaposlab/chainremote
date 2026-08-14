// ChainRemote 이스터에그 — 크레딧 크롤과 로켓.
//
// chainremote_easter.dart 와 나눈 이유: 이 둘은 애니메이션 덩어리라 파일이 길고,
// 정적인 카드류와 섞으면 둘 다 읽기 나빠진다.
//
// 진입점:
//   • 설정 → 정보 → 로고 길게 누르기   → showCrCreditsCrawl()
//   • 홈 → 거래처 검색창에 "gogo"      → showCrRocket()

import 'dart:math';

import 'package:flutter/material.dart';

const _kGold = Color(0xFFF0DCA0);
const _kGoldDim = Color(0xFFC9A961);

// ────────────────────────────────────────────────────────────────────────────
// 2. 크레딧 크롤 — 아래에서 위로, 부채꼴로 눕고 위로 갈수록 옅어진다
//
// 연출만 빌리고 옷은 우리 것으로 입힌다(크림 골드 + 다크). 남의 글꼴·로고·팡파르를
// 그대로 가져오는 건 다른 문제라 하지 않는다.
//
// 원리: 원근 투영이 걸린 Transform 안에 긴 글을 올리고 위로 밀어 올린다.
//   ① Matrix4 에 setEntry(3,2,...) 로 perspective 를 넣고 X축으로 눕히면 사다리꼴이 된다
//   ② ShaderMask 로 위쪽을 서서히 투명하게 — 멀어지며 사라지는 느낌
// ★어디를 눌러도 닫힌다. 40초짜리를 끝까지 봐야 하면 두 번째부터는 고문이다.
// ────────────────────────────────────────────────────────────────────────────

const List<String> _kCrawlLines = [
  'ChainRemote',
  '',
  '거래처 원격지원, 클릭 한 번으로.',
  '',
  '',
  '이 앱은 RustDesk 위에 세워졌습니다.',
  'RustDesk 와 그 기여자들에게 감사드립니다.',
  '',
  'AGPL v3 · 전체 소스 공개',
  '',
  '',
  '우리가 더한 것',
  '',
  '클릭 한 번으로 끝나는 수락',
  '스스로 등록하는 에이전트',
  '디스크가 차기 전에 알리는 관제',
  '카드결제 데몬을 되살리는 감시',
  '방화벽이 꺼지면 다시 켜는 자가치유',
  '구형 포스를 버리지 않는 32비트 지원',
  '',
  '',
  '만든 사람',
  '',
  'Chang · betaposlab',
  '채리',
  '',
  '',
  '그리고',
  '',
  '오늘도 돌아가고 있는',
  '거래처의 포스들에게',
  '',
  '',
  'made with care',
  '',
  '',
];

Future<void> showCrCreditsCrawl(BuildContext context) async {
  await Navigator.of(context).push(PageRouteBuilder(
    opaque: false,
    barrierColor: Colors.black,
    pageBuilder: (_, __, ___) => const _CrCrawlPage(),
    transitionsBuilder: (_, anim, __, child) =>
        FadeTransition(opacity: anim, child: child),
    transitionDuration: const Duration(milliseconds: 600),
  ));
}

class _CrCrawlPage extends StatefulWidget {
  const _CrCrawlPage();

  @override
  State<_CrCrawlPage> createState() => _CrCrawlPageState();
}

class _CrCrawlPageState extends State<_CrCrawlPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 42),
    )..forward();
    _c.addStatusListener((s) {
      if (s == AnimationStatus.completed && mounted) Navigator.of(context).pop();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      // 어디를 눌러도 닫힌다.
      behavior: HitTestBehavior.opaque,
      onTap: () => Navigator.of(context).pop(),
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            const Positioned.fill(child: _StarField()),
            Positioned.fill(
              child: LayoutBuilder(
                builder: (context, box) {
                  final h = box.maxHeight;
                  return ClipRect(
                    child: ShaderMask(
                      shaderCallback: (rect) => const LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        // 위로 갈수록 옅어지다 사라진다.
                        colors: [
                          Colors.transparent,
                          Colors.transparent,
                          Colors.white24,
                          Colors.white,
                          Colors.white,
                        ],
                        stops: [0.0, 0.16, 0.34, 0.62, 1.0],
                      ).createShader(rect),
                      blendMode: BlendMode.dstIn,
                      child: AnimatedBuilder(
                        animation: _c,
                        builder: (context, _) {
                          // 화면 아래에서 시작해 글 전체가 위로 빠져나갈 때까지.
                          final travel = h + _kCrawlLines.length * 44.0 + h * 0.5;
                          final dy = h - _c.value * travel;
                          return Transform(
                            alignment: Alignment.topCenter,
                            transform: Matrix4.identity()
                              ..setEntry(3, 2, 0.0016) // 원근
                              ..rotateX(1.02), // 눕히기 = 부채꼴
                            child: Transform.translate(
                              offset: Offset(0, dy),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  for (var i = 0; i < _kCrawlLines.length; i++)
                                    _crawlLine(_kCrawlLines[i], i),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  );
                },
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 26,
              child: Center(
                child: Text(
                  '아무 곳이나 누르면 닫힙니다',
                  style: TextStyle(
                      color: Colors.white.withOpacity(0.25), fontSize: 11.5),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _crawlLine(String text, int i) {
    if (text.isEmpty) return const SizedBox(height: 26);
    final isTitle = i == 0;
    final isHead = text == '우리가 더한 것' ||
        text == '만든 사람' ||
        text == '그리고' ||
        text == 'made with care';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: TextStyle(
          color: isTitle || isHead ? _kGold : _kGoldDim,
          fontSize: isTitle ? 46 : (isHead ? 26 : 21),
          fontWeight:
              isTitle ? FontWeight.w900 : (isHead ? FontWeight.w800 : FontWeight.w600),
          letterSpacing: isTitle ? 3 : 1.1,
          height: 1.45,
        ),
      ),
    );
  }
}

/// 배경 별. 크롤만 있으면 허전해서 아주 옅게 깔아 둔다(움직이지 않는다 — 시선을 뺏으면 안 된다).
class _StarField extends StatelessWidget {
  const _StarField();

  @override
  Widget build(BuildContext context) =>
      CustomPaint(painter: _StarPainter(), child: const SizedBox.expand());
}

class _StarPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    // 씨앗 고정 — 다시 그릴 때마다 별이 튀면 지저분하다.
    final r = Random(42);
    final p = Paint();
    for (var i = 0; i < 140; i++) {
      final x = r.nextDouble() * size.width;
      final y = r.nextDouble() * size.height;
      final o = 0.06 + r.nextDouble() * 0.22;
      p.color = Colors.white.withOpacity(o);
      canvas.drawCircle(Offset(x, y), r.nextDouble() * 1.1 + 0.3, p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. 로켓 — 검색창에 "gogo"
//
// 본사 쪽에서 로켓이 날아가 거래처 포스에 닿고, 그 순간 팡 터지면서 포스 화면에
// 불이 들어온다. ★"폭발"이 아니라 "폭죽 + 전원 들어옴"으로 읽히게 한 건 의도다 —
// 원격지원 앱에서 고객 컴퓨터가 터지는 그림은 농담이어도 뒷맛이 이상하다(2026-08-15).
// gogo 는 Chang 의 WoL 명령어 오마주.
// ────────────────────────────────────────────────────────────────────────────

Future<void> showCrRocket(BuildContext context) async {
  await Navigator.of(context).push(PageRouteBuilder(
    opaque: false,
    barrierColor: Colors.transparent,
    pageBuilder: (_, __, ___) => const _CrRocketPage(),
    transitionDuration: Duration.zero,
  ));
}

class _CrRocketPage extends StatefulWidget {
  const _CrRocketPage();

  @override
  State<_CrRocketPage> createState() => _CrRocketPageState();
}

class _CrRocketPageState extends State<_CrRocketPage>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c;
  final List<_Spark> _sparks = [];
  final _rnd = Random();

  @override
  void initState() {
    super.initState();
    _c = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2600),
    )..forward();
    _c.addStatusListener((s) {
      if (s == AnimationStatus.completed && mounted) Navigator.of(context).pop();
    });
    // 폭죽 파티클 — 착탄(0.55) 시점에 한꺼번에 태어난다.
    for (var i = 0; i < 54; i++) {
      final a = _rnd.nextDouble() * pi * 2;
      final v = 60 + _rnd.nextDouble() * 190;
      _sparks.add(_Spark(
        angle: a,
        speed: v,
        size: 1.6 + _rnd.nextDouble() * 2.6,
        hue: _rnd.nextDouble(),
        life: 0.5 + _rnd.nextDouble() * 0.5,
      ));
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Material(
        color: Colors.transparent,
        child: AnimatedBuilder(
          animation: _c,
          builder: (context, _) => CustomPaint(
            painter: _RocketPainter(t: _c.value, sparks: _sparks),
            child: const SizedBox.expand(),
          ),
        ),
      ),
    );
  }
}

class _Spark {
  final double angle, speed, size, hue, life;
  _Spark({
    required this.angle,
    required this.speed,
    required this.size,
    required this.hue,
    required this.life,
  });
}

class _RocketPainter extends CustomPainter {
  final double t;
  final List<_Spark> sparks;

  _RocketPainter({required this.t, required this.sparks});

  static const double _kImpact = 0.55; // 착탄 시점

  @override
  void paint(Canvas canvas, Size size) {
    // 궤적: 왼쪽 아래(본사) → 오른쪽 위(거래처 포스). 살짝 호를 그린다.
    final from = Offset(size.width * 0.12, size.height * 0.82);
    final to = Offset(size.width * 0.78, size.height * 0.24);
    final ctrl = Offset(size.width * 0.40, size.height * 0.28);

    Offset at(double u) {
      final v = 1 - u;
      return Offset(
        v * v * from.dx + 2 * v * u * ctrl.dx + u * u * to.dx,
        v * v * from.dy + 2 * v * u * ctrl.dy + u * u * to.dy,
      );
    }

    // ── 목표: 거래처 포스(모니터) ──────────────────────────────────────────
    final lit = t >= _kImpact;
    _drawMonitor(canvas, to, lit, t);

    if (t < _kImpact) {
      // ── 비행 ──────────────────────────────────────────────────────────
      final u = Curves.easeInCubic.transform(t / _kImpact);
      final pos = at(u);
      final ahead = at((u + 0.02).clamp(0.0, 1.0));
      final ang = atan2(ahead.dy - pos.dy, ahead.dx - pos.dx);

      // 꼬리 불꽃
      final trail = Paint()..style = PaintingStyle.fill;
      for (var i = 1; i <= 14; i++) {
        final tu = (u - i * 0.018).clamp(0.0, 1.0);
        if (tu <= 0) break;
        final p = at(tu);
        final f = 1 - i / 14.0;
        trail.color = Color.lerp(
                const Color(0xFFFFD27A), const Color(0xFFFF5A3C), 1 - f)!
            .withOpacity(f * 0.75);
        canvas.drawCircle(p, 1.5 + f * 5.5, trail);
      }

      _drawRocket(canvas, pos, ang);
    } else {
      // ── 폭죽 ──────────────────────────────────────────────────────────
      final e = (t - _kImpact) / (1 - _kImpact); // 0..1
      // 섬광
      if (e < 0.28) {
        final f = 1 - e / 0.28;
        canvas.drawCircle(
          to,
          20 + f * 90,
          Paint()
            ..color = Colors.white.withOpacity(f * 0.85)
            ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 18),
        );
      }
      // 충격파 링
      if (e < 0.6) {
        final f = e / 0.6;
        canvas.drawCircle(
          to,
          20 + f * 150,
          Paint()
            ..style = PaintingStyle.stroke
            ..strokeWidth = 3 * (1 - f)
            ..color = _kGold.withOpacity((1 - f) * 0.7),
        );
      }
      // 불꽃 파편
      final p = Paint()..style = PaintingStyle.fill;
      for (final s in sparks) {
        final le = e / s.life;
        if (le >= 1) continue;
        final d = s.speed * le;
        final gravity = 90 * le * le; // 아래로 처지게
        final pos = to + Offset(cos(s.angle) * d, sin(s.angle) * d + gravity);
        final o = (1 - le) * (1 - le);
        p.color = HSVColor.fromAHSV(
                o, 20 + s.hue * 45, 0.85, 1.0) // 금빛~주황
            .toColor();
        canvas.drawCircle(pos, s.size * (1 - le * 0.4), p);
      }
    }
  }

  void _drawRocket(Canvas canvas, Offset pos, double ang) {
    canvas.save();
    canvas.translate(pos.dx, pos.dy);
    canvas.rotate(ang);
    final body = Paint()..color = Colors.white;
    final accent = Paint()..color = const Color(0xFFE53935);
    // 몸통(코가 진행 방향)
    final path = Path()
      ..moveTo(16, 0)
      ..lineTo(-6, -6)
      ..lineTo(-12, -4)
      ..lineTo(-12, 4)
      ..lineTo(-6, 6)
      ..close();
    canvas.drawPath(path, body);
    // 날개
    canvas.drawPath(
        Path()
          ..moveTo(-6, -6)
          ..lineTo(-14, -12)
          ..lineTo(-10, -3)
          ..close(),
        accent);
    canvas.drawPath(
        Path()
          ..moveTo(-6, 6)
          ..lineTo(-14, 12)
          ..lineTo(-10, 3)
          ..close(),
        accent);
    // 창문
    canvas.drawCircle(const Offset(4, 0), 2.6,
        Paint()..color = const Color(0xFF1740C4));
    canvas.restore();
  }

  void _drawMonitor(Canvas canvas, Offset c, bool lit, double t) {
    const w = 78.0, h = 54.0;
    final r = Rect.fromCenter(center: c, width: w, height: h);
    // 베젤
    canvas.drawRRect(
      RRect.fromRectAndRadius(r, const Radius.circular(6)),
      Paint()..color = const Color(0xFF2A2F3A),
    );
    // 화면 — 착탄 전엔 꺼져 있고, 맞는 순간 불이 들어온다.
    final inner = r.deflate(5);
    if (lit) {
      final e = ((t - _kImpact) / 0.25).clamp(0.0, 1.0);
      canvas.drawRRect(
        RRect.fromRectAndRadius(inner, const Radius.circular(3)),
        Paint()
          ..shader = LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color.lerp(const Color(0xFF0E1117), const Color(0xFF5A8CFF), e)!,
              Color.lerp(const Color(0xFF0E1117), const Color(0xFF1740C4), e)!,
            ],
          ).createShader(inner),
      );
      // 화면 잔광
      canvas.drawRRect(
        RRect.fromRectAndRadius(inner.inflate(6), const Radius.circular(8)),
        Paint()
          ..color = const Color(0xFF5A8CFF).withOpacity(0.35 * e)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 12),
      );
    } else {
      canvas.drawRRect(
        RRect.fromRectAndRadius(inner, const Radius.circular(3)),
        Paint()..color = const Color(0xFF0E1117),
      );
    }
    // 받침
    canvas.drawRect(
      Rect.fromCenter(
          center: Offset(c.dx, c.dy + h / 2 + 6), width: 8, height: 10),
      Paint()..color = const Color(0xFF2A2F3A),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(
            center: Offset(c.dx, c.dy + h / 2 + 13), width: 34, height: 5),
        const Radius.circular(2.5),
      ),
      Paint()..color = const Color(0xFF2A2F3A),
    );
  }

  @override
  bool shouldRepaint(covariant _RocketPainter old) => old.t != t;
}
