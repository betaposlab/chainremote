// ChainRemote 이스터에그 모음.
//
// 왜 한 파일에 모으나: 이스터에그는 본체 로직에 흩뿌리면 나중에 아무도 못 찾고, upstream
// 머지 때 조용히 사라지거나 반대로 지우려 해도 못 지운다. 여기 모아 두고 각 화면은
// 한 줄씩만 부른다(진입점은 주석에 명시).
//
// ★거래처 화면(수락카드·배너)에는 절대 넣지 않는다. 사장님이 장사 중에 이상한 걸 보면
//   "클릭 한 번" UX 약속이 깨진다. 전부 본사(HQ) 쪽 화면 전용이다.
//
// 진입점:
//   • 설정 → 정보 → 버전 7번 클릭        → showCrTogetherCard()      (함께한 시간)
//   • 설정 → 정보 → 로고 길게 누르기       → showCrCreditsCrawl()      (크레딧 크롤)
//   • 홈 → 내 ID 칩 길게 누르기            → crFortuneOfToday()        (오늘의 지원 운세)
//   • 홈 → 거래처 검색창에 "gogo"          → showCrRocket()            (로켓)
//   • 새해 첫 원격 종료 후                  → maybeShowCrYearEnd()      (연말결산)

import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_hbb/models/platform_model.dart';

import 'chainremote_history.dart';

// ────────────────────────────────────────────────────────────────────────────
// 공통
// ────────────────────────────────────────────────────────────────────────────

const _kGold = Color(0xFFF0DCA0); // 목록 폴더 아이콘과 같은 크림 골드
const _kInk = Color(0xFF0E1117);
const _kSub = Color(0xFF9CA3AF);

String _fmtHours(int sec) {
  if (sec <= 0) return '0분';
  final h = sec ~/ 3600;
  final m = (sec % 3600) ~/ 60;
  if (h <= 0) return '$m분';
  if (m <= 0) return '$h시간';
  return '$h시간 $m분';
}

// ────────────────────────────────────────────────────────────────────────────
// 1. 함께한 시간 — 설정의 버전 표기를 7번 클릭
//    데이터는 지원기록(/api/sessions/recent)에서 집계한다. 이스터에그로 시작했지만
//    내용 자체는 진짜 자랑거리라, 나중에 정식 화면으로 승격해도 되는 물건이다.
// ────────────────────────────────────────────────────────────────────────────

class CrTogetherStats {
  final int count;
  final int totalSec;
  final String topCustomer;
  final int topCount;
  final int customerCount;
  final DateTime? firstAt;

  CrTogetherStats({
    required this.count,
    required this.totalSec,
    required this.topCustomer,
    required this.topCount,
    required this.customerCount,
    required this.firstAt,
  });
}

/// 이스터에그 전용 — 지원기록 조회가 실패하면 **빈 목록으로 넘긴다.**
///
/// ★왜 여기만 삼키나(2026-08-16): `fetchCrSessions` 는 실패를 예외로 던지도록 바꿨다.
///   지원기록 창에서는 "기록 없음"과 "못 불러옴"을 반드시 갈라 보여줘야 하기 때문이다.
///   그런데 이스터에그 셋이 그 예외를 아무도 안 받고 있었다 — [함께한 시간]은 에러를
///   로딩으로 착각해 **스피너가 영원히 돌았고**, 나머지 둘은 조용히 아무 일도 안 했다.
///   이쪽은 장식이라 서버를 못 봤다고 사람에게 알릴 이유가 없다. 옛 동작(빈 목록)이 맞다.
Future<List<CrSession>> _sessionsOrEmpty({int limit = 5000}) async {
  try {
    return await fetchCrSessions(limit: limit);
  } catch (e) {
    debugPrint('easter egg: 지원기록 조회 실패 — 빈 목록으로 진행 ($e)');
    return const <CrSession>[];
  }
}

Future<CrTogetherStats> crFetchTogether() async {
  // limit 을 크게 잡는다 — 이 카드는 "여태 전부"가 의미인데 300건에서 잘리면 숫자가 거짓이 된다.
  final sessions = await _sessionsOrEmpty();
  var totalSec = 0;
  final byCustomer = <String, int>{};
  DateTime? first;
  for (final s in sessions) {
    totalSec += s.durationSec;
    final name = s.customerName.trim();
    if (name.isNotEmpty) byCustomer[name] = (byCustomer[name] ?? 0) + 1;
    final at = s.startedAt;
    if (at != null && (first == null || at.isBefore(first))) first = at;
  }
  var topName = '';
  var topCount = 0;
  byCustomer.forEach((k, v) {
    if (v > topCount) {
      topName = k;
      topCount = v;
    }
  });
  return CrTogetherStats(
    count: sessions.length,
    totalSec: totalSec,
    topCustomer: topName,
    topCount: topCount,
    customerCount: byCustomer.length,
    firstAt: first,
  );
}

Future<void> showCrTogetherCard(BuildContext context) async {
  await showDialog(
    context: context,
    barrierColor: Colors.black87,
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 420,
        padding: const EdgeInsets.fromLTRB(28, 26, 28, 22),
        decoration: BoxDecoration(
          color: _kInk,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _kGold.withOpacity(0.35)),
        ),
        child: FutureBuilder<CrTogetherStats>(
          future: crFetchTogether(),
          builder: (context, snap) {
            if (!snap.hasData) {
              return const SizedBox(
                height: 180,
                child: Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: _kGold),
                  ),
                ),
              );
            }
            final st = snap.data!;
            if (st.count == 0) {
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: const [
                  Text('아직 기록이 없습니다',
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w700)),
                  SizedBox(height: 10),
                  Text('첫 원격을 마치면 여기에 쌓이기 시작합니다.',
                      style: TextStyle(color: _kSub, fontSize: 13)),
                ],
              );
            }
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('함께한 시간',
                    style: TextStyle(
                        color: _kGold,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5)),
                const SizedBox(height: 4),
                Text(
                  st.firstAt == null
                      ? '지금까지의 기록입니다.'
                      : '${st.firstAt!.year}년 ${st.firstAt!.month}월부터 지금까지',
                  style: const TextStyle(color: _kSub, fontSize: 12),
                ),
                const SizedBox(height: 20),
                _statRow('원격 지원', '${st.count}회'),
                _statRow('함께한 시간', _fmtHours(st.totalSec)),
                _statRow('도운 거래처', '${st.customerCount}곳'),
                if (st.topCustomer.isNotEmpty)
                  _statRow('가장 자주 도운 곳', '${st.topCustomer} · ${st.topCount}회'),
                const SizedBox(height: 18),
                Container(height: 1, color: Colors.white.withOpacity(0.08)),
                const SizedBox(height: 14),
                Text(
                  '포스 ${st.customerCount}대가 오늘도 돌아가고 있습니다.',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13.5,
                      height: 1.5,
                      fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 16),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    child: const Text('닫기',
                        style: TextStyle(color: _kGold, fontSize: 13)),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    ),
  );
}

Widget _statRow(String label, String value) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 11),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        SizedBox(
          width: 120,
          child: Text(label,
              style: const TextStyle(color: _kSub, fontSize: 12.5)),
        ),
        Expanded(
          child: Text(value,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700)),
        ),
      ],
    ),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3. 오늘의 지원 운세 — 홈의 내 ID 칩을 길게 누르기
//    ★날짜로 고정한다. 누를 때마다 굴리면 그냥 랜덤 생성기지만, 하루 동안 같으면
//      "오늘 뽑힌 문장"이 되어 훨씬 그럴듯하다.
// ────────────────────────────────────────────────────────────────────────────

const List<String> kCrFortuneFun = [
  '오늘은 재부팅이 만병통치약인 날입니다.',
  '"어제까진 됐는데"는 어제와 오늘 사이에 답이 있다는 뜻입니다.',
  '사장님이 "아무것도 안 건드렸어요"라고 하시면, 무언가는 건드리신 겁니다.',
  '프린터는 당신을 미워하지 않습니다. 종이가 없을 뿐입니다.',
  '"급해요"는 언제나 점심 장사 시간에 옵니다.',
  '오늘의 행운 명령어 — 전원을 껐다 켜기.',
  '케이블부터 보면 삼십 분을 법니다.',
  '커피 한 잔에 원격 두 건. 오늘도 수지맞는 장사입니다.',
  '포스는 정직합니다. 다만 말이 짧을 뿐입니다.',
  '오늘 가장 어려운 일 — 증상을 말로만 듣고 알아맞히기.',
];

const List<String> kCrFortuneTip = [
  '작업관리자는 Ctrl+Shift+Esc 가 가장 빠릅니다. Ctrl+Alt+Del 은 한 단계를 더 거칩니다.',
  '윈도우키+R 에 ncpa.cpl — 네트워크 어댑터 창이 바로 열립니다.',
  '시간이 틀어지면 카드 결제가 실패합니다. w32tm /resync 한 줄이면 됩니다.',
  '프린터가 "오프라인"이면 Print Spooler 서비스 재시작이 가장 빠른 처방입니다.',
  '포트를 누가 쓰는지는 netstat -ano | findstr :포트번호 로 PID 를 찾습니다.',
  '디스크는 죽기 전에 신호를 보냅니다. chkdsk 보다 S.M.A.R.T. 상태를 먼저 보세요.',
  'DISM /Online /Cleanup-Image /RestoreHealth 다음에 sfc /scannow. 순서가 반대면 헛수고입니다.',
  '재부팅 원인은 이벤트 뷰어(eventvwr)의 \'시스템\' 로그가 알고 있습니다.',
  'USB 장치가 자꾸 끊기면 장치 관리자 → 전원 관리 → \'절전을 위해 끄기\'부터 해제합니다.',
  '안전 모드에서 증상이 사라지면 범인은 하드웨어가 아니라 시작 프로그램입니다.',
];

/// (문구, 팁인가) — 재미 10 + 팁 10 을 한 통에 넣고 날짜로 고른다.
(String, bool) crFortuneOfToday([DateTime? now]) {
  final d = now ?? DateTime.now();
  // 날짜만으로 시드를 만든다(시각 제외) — 같은 날엔 몇 번을 눌러도 같은 문장.
  final seed = d.year * 10000 + d.month * 100 + d.day;
  final all = [...kCrFortuneFun, ...kCrFortuneTip];
  final i = seed % all.length;
  return (all[i], i >= kCrFortuneFun.length);
}

Future<void> showCrFortune(BuildContext context) async {
  final (text, isTip) = crFortuneOfToday();
  await showDialog(
    context: context,
    barrierColor: Colors.black.withOpacity(0.6),
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 380,
        padding: const EdgeInsets.fromLTRB(24, 22, 24, 18),
        decoration: BoxDecoration(
          color: _kInk,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _kGold.withOpacity(0.3)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(isTip ? Icons.lightbulb_outline : Icons.auto_awesome,
                    size: 15, color: _kGold),
                const SizedBox(width: 6),
                Text(isTip ? '오늘의 한 수' : '오늘의 지원 운세',
                    style: const TextStyle(
                        color: _kGold,
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.4)),
              ],
            ),
            const SizedBox(height: 14),
            Text(text,
                style: const TextStyle(
                    color: Colors.white, fontSize: 14.5, height: 1.6)),
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child:
                    const Text('닫기', style: TextStyle(color: _kSub, fontSize: 12.5)),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 5. 새해 첫 원격을 마치면 작년 결산
//    ★12월 31일 고정이 아니다(Chang 2026-08-15) — 그날 원격을 안 하거나, 마지막인 줄
//      알았는데 한 건 더 들어오면 어긋난다. "해가 바뀐 뒤 첫 원격 종료"가 정확한 시점이다.
// ────────────────────────────────────────────────────────────────────────────

const String _kYearEndShownKey = 'chainremote-yearend-shown';

/// 올해 이미 보여줬으면 false. 보여줄 때가 되면 작년 집계를 반환.
Future<(int, int, int)?> crYearEndDue([DateTime? now]) async {
  final d = now ?? DateTime.now();
  final lastYear = d.year - 1;
  try {
    final shown = bind.mainGetLocalOption(key: _kYearEndShownKey).trim();
    if (shown == d.year.toString()) return null; // 올해 이미 봤다
  } catch (e) {
    debugPrint('yearend flag read failed: $e');
  }
  final sessions = await _sessionsOrEmpty();
  var count = 0;
  var sec = 0;
  for (final s in sessions) {
    final at = s.startedAt;
    if (at == null || at.year != lastYear) continue;
    count++;
    sec += s.durationSec;
  }
  if (count == 0) return null; // 작년 기록이 없으면 조용히 넘어간다
  return (lastYear, count, sec);
}

Future<void> maybeShowCrYearEnd(BuildContext context) async {
  final due = await crYearEndDue();
  if (due == null) return;
  final (year, count, sec) = due;
  try {
    await bind.mainSetLocalOption(
        key: _kYearEndShownKey, value: DateTime.now().year.toString());
  } catch (e) {
    debugPrint('yearend flag write failed: $e');
  }
  if (!context.mounted) return;
  await showDialog(
    context: context,
    barrierColor: Colors.black87,
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 400,
        padding: const EdgeInsets.fromLTRB(28, 26, 28, 20),
        decoration: BoxDecoration(
          color: _kInk,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _kGold.withOpacity(0.35)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$year년',
                style: const TextStyle(
                    color: _kGold,
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1)),
            const SizedBox(height: 16),
            Text('원격 $count회 · ${_fmtHours(sec)}',
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 18),
            const Text('작년 한 해 수고 많으셨습니다.',
                style: TextStyle(
                    color: Colors.white, fontSize: 14, height: 1.6)),
            const Text('올해에는 원격을 거의 안 보셨으면 좋겠습니다.',
                style: TextStyle(color: _kSub, fontSize: 13.5, height: 1.6)),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('고맙습니다',
                    style: TextStyle(color: _kGold, fontSize: 13)),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// 연말결산 미리보기(개발용). 12월 31일까지 못 기다리므로 숨은 트리거로 확인한다.
/// 홈 검색창에 "gogo2" 를 치면 호출된다 — 저장 플래그를 건드리지 않는다.
Future<void> showCrYearEndPreview(BuildContext context) async {
  final sessions = await _sessionsOrEmpty();
  final y = DateTime.now().year;
  var count = 0;
  var sec = 0;
  for (final s in sessions) {
    if (s.startedAt == null) continue;
    count++;
    sec += s.durationSec;
  }
  if (!context.mounted) return;
  await showDialog(
    context: context,
    barrierColor: Colors.black87,
    builder: (ctx) => Dialog(
      backgroundColor: Colors.transparent,
      child: Container(
        width: 400,
        padding: const EdgeInsets.fromLTRB(28, 26, 28, 20),
        decoration: BoxDecoration(
          color: _kInk,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _kGold.withOpacity(0.35)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${y - 1}년  (미리보기)',
                style: const TextStyle(
                    color: _kGold,
                    fontSize: 26,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1)),
            const SizedBox(height: 16),
            Text('원격 $count회 · ${_fmtHours(sec)}',
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 18),
            const Text('작년 한 해 수고 많으셨습니다.',
                style: TextStyle(
                    color: Colors.white, fontSize: 14, height: 1.6)),
            const Text('올해에는 원격을 거의 안 보셨으면 좋겠습니다.',
                style: TextStyle(color: _kSub, fontSize: 13.5, height: 1.6)),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('닫기',
                    style: TextStyle(color: _kGold, fontSize: 13)),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 유틸 — 버전 7번 클릭 감지
// ────────────────────────────────────────────────────────────────────────────

/// 안드로이드 전통대로 7번. 3초 안에 이어서 눌러야 하고, 끊기면 처음부터.
class CrTapCounter {
  final int need;
  final Duration window;
  int _n = 0;
  DateTime _last = DateTime.fromMillisecondsSinceEpoch(0);

  CrTapCounter({this.need = 7, this.window = const Duration(seconds: 3)});

  /// 이번 탭으로 조건이 채워졌으면 true(그리고 카운터를 리셋).
  bool tap([DateTime? now]) {
    final t = now ?? DateTime.now();
    if (t.difference(_last) > window) _n = 0;
    _last = t;
    _n++;
    if (_n >= need) {
      _n = 0;
      return true;
    }
    return false;
  }
}

/// 랜덤 유틸 — 로켓 파티클에서 쓴다. 씨앗 고정이 필요 없으니 전역 하나로 충분.
final crRandom = Random();
