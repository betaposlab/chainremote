import 'dart:convert';

import 'package:bot_toast/bot_toast.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hbb/common/widgets/chainremote_auth_gate.dart';
import 'package:flutter_hbb/common/widgets/chainremote_disk.dart';
import 'package:flutter_hbb/common/widgets/chainremote_firewall.dart';
import 'package:flutter_hbb/common/widgets/chainremote_van.dart';
import 'package:flutter_hbb/common/widgets/chainremote_folders.dart';
import 'package:flutter_hbb/common/widgets/chainremote_history.dart';
import 'package:flutter_hbb/common/widgets/dialog.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/peer_tab_model.dart';
import 'package:flutter_hbb/models/state_model.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../common.dart';
import '../../common/formatter/id_formatter.dart';
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';
import '../../desktop/widgets/material_mod_popup_menu.dart' as mod_menu;
import '../../desktop/widgets/popup_menu.dart';
import 'dart:math' as math;

typedef PopupMenuEntryBuilder = Future<List<mod_menu.PopupMenuEntry<String>>>
    Function(BuildContext);

// ── 디스크 배지 (마이그024) — 보고만 있으면 항상 표시(2026-07-16 Chang: HQ 가 주 화면).
//   정상=회색, 주의(<8GB)=호박, 위험(<5GB)=빨강. 미보고(구버전 에이전트)만 생략.
Widget? crDiskBadge(BuildContext context, Peer peer) {
  final info = crDiskInfo(peer);
  if (info == null) return null;
  final bg = info.level == 2
      ? CrColors.of(context).dangerBg
      : info.level == 1
          ? CrColors.of(context).warnBg
          : CrColors.of(context).chipBg;
  final fg = info.level == 2
      ? CrColors.of(context).dangerFg
      : info.level == 1
          ? CrColors.of(context).warnFg
          : CrColors.of(context).textSubtle;
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(
      // 주의/위험이면 Temp(원인 후보)도 병기 — 패널 칩과 동일 정보량.
      '여유 ${info.freeGb.toStringAsFixed(1)}GB'
      '${info.level > 0 && info.tempGb != null ? " · Temp ${info.tempGb!.toStringAsFixed(1)}GB" : ""}',
      style: TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: fg),
    ),
  );
}

// ── 관제 배지 (마이그028 방화벽 / 036 VAN) — 켜 둔 거래처에만.
//
//   왜 넣나: 지금까지 HQ 는 관제가 **실패했을 때만** 목록 위 경고 띠를 띄웠다. 그래서 정상일
//   때는 "관제를 켜 뒀는데 잘 돌고 있다"와 "애초에 안 켰다"가 화면에서 똑같아, 우클릭 메뉴를
//   하나씩 열어봐야만 알 수 있었다(2026-08-11 Chang: "큰카드 작은카드 리스트 전부 봤는데
//   안 보여"). 패널엔 칩이 있는데 정작 매일 쓰는 화면이 HQ 다. 상태는 항상 보이게 둔다.
//
//   관제를 안 켠 거래처엔 아무것도 안 그린다 — 대부분이 그쪽이라 목록이 지저분해지지 않는다.
Widget _crChip(BuildContext context,
    {required IconData icon,
    required String label,
    required Color bg,
    required Color fg,
    required String tip}) {
  return Tooltip(
    message: tip,
    waitDuration: const Duration(milliseconds: 400),
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(4)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 9, color: fg),
        const SizedBox(width: 3),
        Text(label,
            style:
                TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: fg)),
      ]),
    ),
  );
}

List<Widget> crWatchBadges(BuildContext context, Peer peer) {
  final c = CrColors.of(context);
  final out = <Widget>[];

  if (peer.firewallControl == 'Y') {
    out.add(_crChip(context,
        icon: Icons.shield_outlined,
        label: '방화벽',
        bg: c.chipBg,
        fg: c.textSubtle,
        tip: '방화벽 자동 해제 관제 켜짐 — 방화벽이 켜지면 에이전트가 바로 해제합니다.'));
  }

  if (peer.vanWatch.isNotEmpty) {
    // 거래처마다 VAN 사가 달라 종류를 그대로 쓴다("ksnet" → KSNET).
    final van = peer.vanWatch.toUpperCase();
    late final String label;
    late final Color bg, fg;
    late final String tip;
    if (peer.vanMissing == 'Y') {
      // 고장이 아니라 설정 실수다 — 같은 빨강으로 묶으면 없는 고장을 고치러 나간다.
      label = '$van 없음';
      bg = c.dangerBg;
      fg = c.dangerFg;
      tip = '이 기기엔 $van 데몬이 없습니다. VAN 사가 다른 곳이면 관제를 끄세요.';
    } else if (peer.vanGaveUp == 'Y') {
      label = '$van 실패';
      bg = c.dangerBg;
      fg = c.dangerFg;
      tip = '자동 복구를 세 번 시도했지만 안 살아났습니다 — 방문이 필요합니다.';
    } else if (peer.vanOk == 'N') {
      label = '$van 중지';
      bg = c.dangerBg;
      fg = c.dangerFg;
      tip = '카드결제 데몬이 멈춰 있습니다. 에이전트가 되살리는 중입니다.';
    } else if (peer.vanOk == 'Y') {
      label = '$van 정상';
      bg = c.okBg;
      fg = c.okFg;
      tip = '카드결제 데몬이 정상입니다(마지막 보고 기준).';
    } else {
      // 방금 켰거나 기기가 꺼져 있는 상태. 지시 전달 1회 + 결과 회신 1회라 주기 10분 × 2.
      label = '$van 대기';
      bg = c.chipBg;
      fg = c.textSubtle;
      tip = '에이전트가 다음 보고에서 확인합니다(최대 20분).';
    }
    out.add(_crChip(context,
        icon: Icons.credit_card, label: label, bg: bg, fg: fg, tip: tip));
  }

  return out;
}

// ── OS 배지 (마이그021) — "Win7 · 64비트" 식. os(버전)+osBits(네이티브 비트수) 우선, 없으면
//   arch(페이로드) 폴백. 64비트 Win7 이 32비트 페이로드를 돌려도 os 로 정확히 "Win7 · 64비트".
String? crOsBadgeText(Peer peer) {
  final bits = (peer.osBits == 'x64' || peer.arch == 'x64')
      ? '64비트'
      : (peer.osBits == 'x86' || peer.arch == 'x86')
          ? '32비트'
          : '';
  final os = peer.os;
  String osShort = '';
  if (os.contains('Windows 11')) {
    osShort = 'Win11';
  } else if (os.contains('Windows 10')) {
    osShort = 'Win10';
  } else if (os.contains('Windows 8.1')) {
    osShort = 'Win8.1';
  } else if (os.contains('Windows 8')) {
    osShort = 'Win8';
  } else if (os.contains('Windows 7')) {
    osShort = 'Win7';
  } else if (os.isNotEmpty) {
    osShort = os.replaceFirst('Windows ', 'Win');
  }
  final text =
      osShort.isNotEmpty ? (bits.isNotEmpty ? '$osShort · $bits' : osShort) : bits;
  return text.isEmpty ? null : text;
}

bool crOsBadgeIsWin7(Peer peer) => peer.os.contains('Windows 7');

// OS 배지 위젯 — crOsBadgeText 를 카드/목록 공용 배지로. Win7=호박, 그 외=회색.
//   (종전엔 카드·목록에 같은 Container 가 인라인 중복이었다. 목록 2줄화하며 헬퍼로 통일.)
Widget? crOsBadge(BuildContext context, Peer peer) {
  final text = crOsBadgeText(peer);
  if (text == null) return null;
  final win7 = crOsBadgeIsWin7(peer);
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
    decoration: BoxDecoration(
      color: win7 ? CrColors.of(context).warnBg : CrColors.of(context).chipBg,
      borderRadius: BorderRadius.circular(4),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 9,
        fontWeight: FontWeight.w600,
        color: win7 ? CrColors.of(context).warnFg : CrColors.of(context).textSubtle,
      ),
    ),
  );
}

enum PeerUiType { grid, tile, list }

final peerCardUiType = PeerUiType.grid.obs;

bool? hideUsernameOnCard;

// 플랫폼별 브랜드 색 배경. 해시 기반 색상은 거래처 구분에 혼란을 줘서 폐기했다.
Color _platformBgColor(BuildContext context, String platform) {
  switch (platform) {
    case kPeerPlatformWindows:
      return const Color(0xFF0078D4); // Windows 공식 블루
    case kPeerPlatformMacOS:
      return const Color(0xFF1D1D1F); // macOS 다크
    case kPeerPlatformLinux:
      return const Color(0xFFE95420); // Ubuntu 오렌지
    case kPeerPlatformAndroid:
      return const Color(0xFF3DDC84); // Android 그린
    default:
      return CrColors.of(context).textMuted; // 알 수 없음 = 중성 회색
  }
}

class _PeerCard extends StatefulWidget {
  final Peer peer;
  final PeerTabIndex tab;
  final Function(BuildContext, String) connect;
  final PopupMenuEntryBuilder popupMenuEntryBuilder;

  const _PeerCard(
      {required this.peer,
      required this.tab,
      required this.connect,
      required this.popupMenuEntryBuilder,
      Key? key})
      : super(key: key);

  @override
  _PeerCardState createState() => _PeerCardState();
}

/// State for the connection page.
class _PeerCardState extends State<_PeerCard>
    with AutomaticKeepAliveClientMixin {
  var _menuPos = RelativeRect.fill;
  final RxBool _rowHover = false.obs; // 행 호버 시에만 더보기 버튼 노출 (B안)
  final double _cardRadius = 16;
  final double _tileRadius = 5;
  final double _borderWidth = 2;

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Obx(() =>
        stateGlobal.isPortrait.isTrue ? _buildPortrait() : _buildLandscape());
  }

  Widget gestureDetector({required Widget child}) {
    final PeerTabModel peerTabModel = Provider.of(context);
    final peer = super.widget.peer;
    return GestureDetector(
        onDoubleTap: peerTabModel.multiSelectionMode
            ? null
            : () => widget.connect(context, peer.id),
        onTap: () {
          if (peerTabModel.multiSelectionMode) {
            peerTabModel.select(peer);
          } else {
            if (isMobile) {
              widget.connect(context, peer.id);
            } else {
              peerTabModel.select(peer);
            }
          }
        },
        onLongPress: () => peerTabModel.select(peer),
        onSecondaryTapDown: (d) {
          // 우클릭 시 거래처 메뉴 표시. 더보기 버튼과 동일하다.
          _menuPos = RelativeRect.fromLTRB(d.globalPosition.dx,
              d.globalPosition.dy, d.globalPosition.dx, d.globalPosition.dy);
          _showPeerMenu(peer.id);
        },
        child: child);
  }

  Widget _buildPortrait() {
    final peer = super.widget.peer;
    return Card(
        margin: EdgeInsets.symmetric(horizontal: 2),
        child: gestureDetector(
          child: Container(
              padding: EdgeInsets.only(left: 12, top: 8, bottom: 8),
              child: _buildPeerTile(context, peer, null)),
        ));
  }

  Widget _buildLandscape() {
    final peer = super.widget.peer;
    var deco = Rx<BoxDecoration?>(
      BoxDecoration(
        border: Border.all(color: Colors.transparent, width: _borderWidth),
        borderRadius: BorderRadius.circular(
          peerCardUiType.value == PeerUiType.grid ? _cardRadius : _tileRadius,
        ),
      ),
    );
    return MouseRegion(
      onEnter: (evt) {
        _rowHover.value = true;
        deco.value = BoxDecoration(
          border: Border.all(
              color: Theme.of(context).colorScheme.primary,
              width: _borderWidth),
          borderRadius: BorderRadius.circular(
            peerCardUiType.value == PeerUiType.grid ? _cardRadius : _tileRadius,
          ),
        );
      },
      onExit: (evt) {
        _rowHover.value = false;
        deco.value = BoxDecoration(
          border: Border.all(color: Colors.transparent, width: _borderWidth),
          borderRadius: BorderRadius.circular(
            peerCardUiType.value == PeerUiType.grid ? _cardRadius : _tileRadius,
          ),
        );
      },
      child: gestureDetector(
          child: Obx(() => peerCardUiType.value == PeerUiType.grid
              ? _buildPeerCard(context, peer, deco)
              : _buildPeerTile(context, peer, deco))),
    );
  }

  bool _showNote(Peer peer) {
    return peerTabShowNote(widget.tab) && peer.note.isNotEmpty;
  }

  makeChild(bool isPortrait, Peer peer) {
    // 거래처 운영용 표시: 별칭을 주 제목으로, 9자리 ID를 부제로 둔다.
    // 별칭이 비면 상단이 이미 ID이므로 부제를 숨겨 중복을 피한다.
    final name = peer.alias.isEmpty ? '' : formatID(peer.id);
    final greyStyle = TextStyle(
        fontSize: 11,
        color: Theme.of(context).textTheme.titleLarge?.color?.withOpacity(0.6));
    final showNote = _showNote(peer);

    return Row(
      mainAxisSize: MainAxisSize.max,
      children: [
        Container(
            // OS 로고 시절의 컬러풀한 사각 배경을 걷어내고 원형 아바타만 남겼다 (2026-05-27 Chang 피드백).
            alignment: Alignment.center,
            width: isPortrait ? 50 : 42,
            height: isPortrait ? 50 : null,
            child: Stack(
              children: [
                getChainRemoteAvatar(
                  context,
                        peer.alias.isEmpty ? peer.id : peer.alias,
                        size: isPortrait ? 38 : 30)
                    .paddingAll(6),
                if (_shouldBuildPasswordIcon(peer))
                  Positioned(
                    top: 1,
                    left: 1,
                    child: Icon(Icons.key, size: 6, color: Colors.white),
                  ),
              ],
            )),
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: Colors.transparent,
              borderRadius: BorderRadius.only(
                topRight: Radius.circular(_tileRadius),
                bottomRight: Radius.circular(_tileRadius),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    children: [
                      Row(children: [
                        if (isPortrait) getOnline(4, peer.online),
                        Expanded(
                            child: Text(
                          peer.alias.isEmpty ? formatID(peer.id) : peer.alias,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleSmall,
                        )),
                      ]).marginOnly(top: isPortrait ? 0 : 2),
                      if (name.isNotEmpty ||
                          showNote ||
                          crOsBadge(context, peer) != null ||
                          crDiskBadge(context, peer) != null ||
                          crWatchBadges(context, peer).isNotEmpty)
                      Row(
                        children: [
                          if (name.isNotEmpty) ...[
                          Flexible(
                            child: Tooltip(
                              message: name,
                              waitDuration: const Duration(seconds: 1),
                              child: Align(
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  name,
                                  style: isPortrait ? null : greyStyle,
                                  textAlign: TextAlign.start,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          ],
                          // OS·여유 배지를 이름 아래 줄(부제)로 내려, 목록에서 이름을 밀지 않게 한다(2줄화).
                          //   종전엔 오른쪽 상태 pill 옆에 있어 좁은 목록 폭에서 이름 Expanded 를 0 으로
                          //   찌부러뜨렸다(정보 보고한 거래처만 이름 증발, 미보고만 이름 노출 → 불일치).
                          if (crOsBadge(context, peer) != null) ...[
                            crOsBadge(context, peer)!,
                            const SizedBox(width: 6),
                          ],
                          if (crDiskBadge(context, peer) != null) ...[
                            crDiskBadge(context, peer)!,
                            const SizedBox(width: 6),
                          ],
                          for (final b in crWatchBadges(context, peer)) ...[
                            b,
                            const SizedBox(width: 6),
                          ],
                          if (showNote)
                            Expanded(
                              child: Tooltip(
                                message: peer.note,
                                waitDuration: const Duration(seconds: 1),
                                child: Align(
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    peer.note,
                                    style: isPortrait ? null : greyStyle,
                                    textAlign: TextAlign.start,
                                    overflow: TextOverflow.ellipsis,
                                  ).marginOnly(
                                      left: peerCardUiType.value ==
                                              PeerUiType.list
                                          ? 32
                                          : 4),
                                ),
                              ),
                            )
                        ],
                      ),
                    ],
                  ).marginOnly(top: 2),
                ),
                isPortrait
                    ? checkBoxOrActionMorePortrait(peer)
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          // OS·디스크 배지는 이름 아래 부제 줄로 옮겼다(위 참조) — 여기선 상태·더보기만.
                          _statusPill(peer.online),
                          const SizedBox(width: 8),
                          checkBoxOrActionMoreLandscape(peer, isTile: true),
                        ],
                      ),
              ],
            ).paddingOnly(left: 10.0, top: 3.0),
          ),
        )
      ],
    );
  }

  Widget _buildPeerTile(
      BuildContext context, Peer peer, Rx<BoxDecoration?>? deco) {
    hideUsernameOnCard ??=
        bind.mainGetBuildinOption(key: kHideUsernameOnCard) == 'Y';
    final colors = _frontN(peer.tags, 25)
        .map((e) => gFFI.abModel.getCurrentAbTagColor(e))
        .toList();
    return Tooltip(
      message: !(isDesktop || isWebDesktop)
          ? ''
          : peer.tags.isNotEmpty
              ? '${translate('Tags')}: ${peer.tags.join(', ')}'
              : '',
      child: Stack(children: [
        Obx(
          () => deco == null
              ? makeChild(stateGlobal.isPortrait.isTrue, peer)
              : Container(
                  foregroundDecoration: deco.value,
                  child: makeChild(stateGlobal.isPortrait.isTrue, peer),
                ),
        ),
        if (colors.isNotEmpty)
          Obx(() => Positioned(
                top: 2,
                right: stateGlobal.isPortrait.isTrue ? 20 : 10,
                child: CustomPaint(
                  painter: TagPainter(radius: 3, colors: colors),
                ),
              ))
      ]),
    );
  }

  Widget _buildPeerCard(
      BuildContext context, Peer peer, Rx<BoxDecoration?> deco) {
    hideUsernameOnCard ??=
        bind.mainGetBuildinOption(key: kHideUsernameOnCard) == 'Y';
    // 그리드 카드 (2026-05-27 톤 개편, Claude Design 시안2 반영).
    //   ┌────────────────────────┐
    //   │ [아바타] 거래처 이름   │
    //   │         323 533 778    │
    //   │                        │
    //   │ ● 온라인         [v]   │  ← 하단 상태바
    //   └────────────────────────┘
    final displayName = peer.alias.isEmpty ? formatID(peer.id) : peer.alias;
    final subtitle = peer.alias.isEmpty ? '' : formatID(peer.id);
    final child = Card(
      color: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      // to-do: memory leak here, more investigation needed.
      // Continious rebuilds of `Obx()` will cause memory leak here.
      // The simple demo does not have this issue.
      child: Obx(
        () => Container(
          foregroundDecoration: deco.value,
          decoration: BoxDecoration(
            color: CrColors.of(context).cardBg,
            borderRadius:
                BorderRadius.circular(_cardRadius - _borderWidth),
            border: Border.all(
                color: CrColors.of(context).border, width: 1),
          ),
          child: ClipRRect(
            borderRadius:
                BorderRadius.circular(_cardRadius - _borderWidth),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 12, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 상단: 아바타 + 이름/ID.
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      getChainRemoteAvatar(context, displayName, size: 44),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Tooltip(
                              message: displayName,
                              waitDuration: const Duration(seconds: 1),
                              child: Text(
                                displayName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: CrColors.of(context).textStrong,
                                ),
                              ),
                            ),
                            if (subtitle.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                subtitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11,
                                  color: CrColors.of(context).textMuted,
                                  letterSpacing: 0.3,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                  // 하단: 온라인 점 + (note 또는 alias 부제) + 더보기.
                  Row(
                    children: [
                      getOnline(8, peer.online),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          peer.online ? '온라인' : '오프라인',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            color: peer.online
                                ? CrColors.of(context).okDot
                                : CrColors.of(context).textDim,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                      // OS 배지(마이그021) — 예외(Win7/32비트)만 표시. Win7=호박, 그 외=회색.
                      //   "Win7 · 64비트"처럼 OS+비트수. 일반 Win10/11 64비트·미보고는 생략.
                      if (crOsBadgeText(peer) != null) ...[
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 5, vertical: 1),
                          decoration: BoxDecoration(
                            color: crOsBadgeIsWin7(peer)
                                ? CrColors.of(context).warnBg
                                : CrColors.of(context).chipBg,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            crOsBadgeText(peer)!,
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                              color: crOsBadgeIsWin7(peer)
                                  ? CrColors.of(context).warnFg
                                  : CrColors.of(context).textSubtle,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                      // 디스크 배지(마이그024) — 여유공간 위험/주의만.
                      if (crDiskBadge(context, peer) != null) ...[
                        crDiskBadge(context, peer)!,
                        const SizedBox(width: 6),
                      ],
                      // 관제 배지(028/036) — 켜 둔 거래처만. 대부분 꺼져 있어 폭을 안 먹는다.
                      for (final b in crWatchBadges(context, peer)) ...[
                        b,
                        const SizedBox(width: 6),
                      ],
                      checkBoxOrActionMoreLandscape(peer, isTile: false),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    final colors = _frontN(peer.tags, 25)
        .map((e) => gFFI.abModel.getCurrentAbTagColor(e))
        .toList();
    return Tooltip(
      message: peer.tags.isNotEmpty
          ? '${translate('Tags')}: ${peer.tags.join(', ')}'
          : '',
      child: Stack(children: [
        child,
        if (_shouldBuildPasswordIcon(peer))
          Positioned(
            top: 4,
            left: 12,
            child: Icon(Icons.key, size: 12, color: Colors.white),
          ),
        if (colors.isNotEmpty)
          Positioned(
            top: 4,
            right: 12,
            child: CustomPaint(
              painter: TagPainter(radius: 4, colors: colors),
            ),
          )
      ]),
    );
  }

  List _frontN<T>(List list, int n) {
    if (list.length <= n) {
      return list;
    } else {
      return list.sublist(0, n);
    }
  }

  Widget checkBoxOrActionMorePortrait(Peer peer) {
    final PeerTabModel peerTabModel = Provider.of(context);
    final selected = peerTabModel.isPeerSelected(peer.id);
    if (peerTabModel.multiSelectionMode) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: selected
            ? Icon(
                Icons.check_box,
                color: MyTheme.accent,
              )
            : Icon(Icons.check_box_outline_blank),
      );
    } else {
      return InkWell(
          child: const Padding(
              padding: EdgeInsets.all(12),
              child: Tooltip(
                message: '메뉴 (이름 바꾸기 · 비밀번호 · 삭제 등)',
                child: Icon(Icons.settings_outlined),
              )),
          onTapDown: (e) {
            final x = e.globalPosition.dx;
            final y = e.globalPosition.dy;
            _menuPos = RelativeRect.fromLTRB(x, y, x, y);
          },
          onTap: () {
            _showPeerMenu(peer.id);
          });
    }
  }

  Widget checkBoxOrActionMoreLandscape(Peer peer, {required bool isTile}) {
    final PeerTabModel peerTabModel = Provider.of(context);
    final selected = peerTabModel.isPeerSelected(peer.id);
    if (peerTabModel.multiSelectionMode) {
      final icon = selected
          ? Icon(
              Icons.check_box,
              color: MyTheme.accent,
            )
          : Icon(Icons.check_box_outline_blank);
      bool last = peerTabModel.isShiftDown && peer.id == peerTabModel.lastId;
      double right = isTile ? 4 : 0;
      if (last) {
        return Container(
          decoration: BoxDecoration(
              border: Border.all(color: MyTheme.accent, width: 1)),
          child: icon,
        ).marginOnly(right: right);
      } else {
        return icon.marginOnly(right: right);
      }
    } else {
      return _actionMore(peer);
    }
  }

  // 모바일엔 마우스 호버가 없다. 호버 기반 페이드를 그대로 두면 가로 모드 폰에서 더보기
  //   버튼이 투명한 채로 남아(탭은 되지만 보이지 않아) 메뉴가 없는 것처럼 보인다 — 늘 보인다.
  //
  // ★데스크탑도 완전 투명(0.0)은 안 쓴다 (2026-08-06 Chang). 호버해야만 나타나면
  //   컴퓨터에 익숙하지 않은 직원은 "아이콘을 못 알아보는" 게 아니라 메뉴가 있다는 것
  //   자체를 모른다. 평소 연하게 깔아 "여기 뭔가 있다"만 전하고, 호버 때 또렷해진다.
  //   (톱니바퀴로 바꾸는 안은 기각 — 이건 설정이 아니라 동작 메뉴이고 삭제까지 들어
  //    있는데, 좌측에 진짜 [설정] 메뉴가 따로 있어 같은 아이콘이 두 뜻이 된다.)
  Widget _actionMore(Peer peer) => Obx(() => AnimatedOpacity(
        opacity: isMobile || _rowHover.value ? 1.0 : 0.45,
        duration: const Duration(milliseconds: 140),
        child: Listener(
          onPointerDown: (e) {
            final x = e.position.dx;
            final y = e.position.dy;
            _menuPos = RelativeRect.fromLTRB(x, y, x, y);
          },
          onPointerUp: (_) => _showPeerMenu(peer.id),
          child: _neuMoreButton(context),
        ),
      ));

  // 뉴모 더보기 버튼. 행 호버 시 노출되며 우클릭으로도 같은 메뉴를 연다 (B안, 2026-06-06).
  Widget _neuMoreButton(BuildContext context) => Tooltip(
        message: '메뉴 · 우클릭으로도',
        waitDuration: const Duration(milliseconds: 600),
        child: Container(
          width: 34,
          height: 34,
          margin: const EdgeInsets.only(right: 4),
          decoration: BoxDecoration(
            color: CrColors.of(context).neuSurface,
            borderRadius: BorderRadius.circular(10),
            boxShadow: [
              BoxShadow(
                  color: CrColors.of(context).neuShadowDark,
                  offset: const Offset(3, 3),
                  blurRadius: 7),
              BoxShadow(
                  color: CrColors.of(context).neuShadowLight,
                  offset: const Offset(-3, -3),
                  blurRadius: 6),
            ],
          ),
          child:
              Icon(Icons.more_vert, size: 18, color: CrColors.of(context).textFaint),
        ),
      );

  // 뉴모 상태 pill. 온라인은 초록, 오프라인은 회색.
  Widget _statusPill(bool online) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: online ? CrColors.of(context).neuOnBg : CrColors.of(context).neuOffBg,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: online ? CrColors.of(context).neuOnDot : CrColors.of(context).neuOffDot,
              ),
            ),
            const SizedBox(width: 5),
            Text(
              translate(online ? 'Online' : 'Offline'),
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w800,
                color: online ? CrColors.of(context).neuOnText : CrColors.of(context).neuOffText,
              ),
            ),
          ],
        ),
      );

  bool _shouldBuildPasswordIcon(Peer peer) {
    if (gFFI.peerTabModel.currentTab != PeerTabIndex.ab.index) return false;
    if (gFFI.abModel.current.isPersonal()) return false;
    return peer.password.isNotEmpty;
  }

  /// Show the peer menu and handle user's choice.
  /// User might remove the peer or send a file to the peer.
  void _showPeerMenu(String id) async {
    await mod_menu.showMenu(
      context: context,
      position: _menuPos,
      items: await super.widget.popupMenuEntryBuilder(context),
      elevation: 8,
    );
  }

  @override
  bool get wantKeepAlive => true;
}

abstract class BasePeerCard extends StatelessWidget {
  final Peer peer;
  final PeerTabIndex tab;
  final EdgeInsets? menuPadding;

  BasePeerCard(
      {required this.peer, required this.tab, this.menuPadding, Key? key})
      : super(key: key);

  @override
  Widget build(BuildContext context) {
    return _PeerCard(
      peer: peer,
      tab: tab,
      connect: (BuildContext context, String id) =>
          connectInPeerTab(context, peer, tab),
      popupMenuEntryBuilder: _buildPopupMenuEntry,
    );
  }

  Future<List<mod_menu.PopupMenuEntry<String>>> _buildPopupMenuEntry(
          BuildContext context) async =>
      (await _buildMenuItems(context))
          .map((e) => e.build(
              context,
              const MenuConfig(
                  commonColor: CustomPopupMenuTheme.commonColor,
                  height: CustomPopupMenuTheme.height,
                  dividerHeight: CustomPopupMenuTheme.dividerHeight)))
          .expand((i) => i)
          .toList();

  @protected
  Future<List<MenuEntryBase<String>>> _buildMenuItems(BuildContext context);

  MenuEntryBase<String> _connectCommonAction(
    BuildContext context,
    String title, {
    bool isFileTransfer = false,
    bool isViewCamera = false,
    bool isTcpTunneling = false,
    bool isRDP = false,
    bool isTerminal = false,
    bool isTerminalRunAsAdmin = false,
  }) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        title,
        style: style,
      ),
      proc: () {
        if (isTerminalRunAsAdmin) {
          setEnvTerminalAdmin();
        }
        connectInPeerTab(
          context,
          peer,
          tab,
          isFileTransfer: isFileTransfer,
          isViewCamera: isViewCamera,
          isTcpTunneling: isTcpTunneling,
          isRDP: isRDP,
          isTerminal: isTerminal || isTerminalRunAsAdmin,
        );
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  MenuEntryBase<String> _connectAction(BuildContext context) {
    return _connectCommonAction(
      context,
      (peer.alias.isEmpty
          ? translate('Connect')
          : '${translate('Connect')} ${peer.id}'),
    );
  }

  @protected
  MenuEntryBase<String> _transferFileAction(BuildContext context) {
    return _connectCommonAction(
      context,
      translate('Transfer file'),
      isFileTransfer: true,
    );
  }

  @protected
  MenuEntryBase<String> _viewCameraAction(BuildContext context) {
    return _connectCommonAction(
      context,
      translate('View camera'),
      isViewCamera: true,
    );
  }

  @protected
  MenuEntryBase<String> _terminalAction(BuildContext context) {
    return _connectCommonAction(
      context,
      '${translate('Terminal')} (beta)',
      isTerminal: true,
    );
  }

  @protected
  MenuEntryBase<String> _terminalRunAsAdminAction(BuildContext context) {
    return _connectCommonAction(
      context,
      '${translate('Terminal (Run as administrator)')} (beta)',
      isTerminalRunAsAdmin: true,
    );
  }

  @protected
  MenuEntryBase<String> _tcpTunnelingAction(BuildContext context) {
    return _connectCommonAction(
      context,
      translate('TCP tunneling'),
      isTcpTunneling: true,
    );
  }

  @protected
  MenuEntryBase<String> _rdpAction(BuildContext context, String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Container(
          alignment: AlignmentDirectional.center,
          height: CustomPopupMenuTheme.height,
          child: Row(
            children: [
              Text(
                translate('RDP'),
                style: style,
              ),
              Expanded(
                  child: Align(
                alignment: Alignment.centerRight,
                child: Transform.scale(
                    scale: 0.8,
                    child: IconButton(
                      icon: const Icon(Icons.edit),
                      padding: EdgeInsets.zero,
                      onPressed: () {
                        if (Navigator.canPop(context)) {
                          Navigator.pop(context);
                        }
                        _rdpDialog(id);
                      },
                    )),
              ))
            ],
          )),
      proc: () {
        connectInPeerTab(context, peer, tab, isRDP: true);
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  MenuEntryBase<String> _wolAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('WOL'),
        style: style,
      ),
      proc: () {
        bind.mainWol(id: id);
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  /// Only available on Windows.
  @protected
  MenuEntryBase<String> _createShortCutAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('Create desktop shortcut'),
        style: style,
      ),
      proc: () {
        bind.mainCreateShortcut(id: id);
        showToast(translate('Successful'));
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  Future<MenuEntryBase<String>> _openNewConnInAction(
      String id, String label, String key) async {
    return MenuEntrySwitch<String>(
      switchType: SwitchType.scheckbox,
      text: translate(label),
      getter: () async => mainGetPeerBoolOptionSync(id, key),
      setter: (bool v) async {
        await bind.mainSetPeerOption(
            id: id, key: key, value: bool2option(key, v));
        showToast(translate('Successful'));
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  _openInTabsAction(String id) async =>
      await _openNewConnInAction(id, 'Open in New Tab', kOptionOpenInTabs);

  _openInWindowsAction(String id) async => await _openNewConnInAction(
      id, 'Open in new window', kOptionOpenInWindows);

  // ignore: unused_element
  _openNewConnInOptAction(String id) async =>
      mainGetLocalBoolOptionSync(kOptionOpenNewConnInTabs)
          ? await _openInWindowsAction(id)
          : await _openInTabsAction(id);

  @protected
  Future<bool> _isForceAlwaysRelay(String id) async {
    return option2bool(kOptionForceAlwaysRelay,
        (await bind.mainGetPeerOption(id: id, key: kOptionForceAlwaysRelay)));
  }

  @protected
  Future<MenuEntryBase<String>> _forceAlwaysRelayAction(String id) async {
    return MenuEntrySwitch<String>(
      switchType: SwitchType.scheckbox,
      text: translate('Always connect via relay'),
      getter: () async {
        return await _isForceAlwaysRelay(id);
      },
      setter: (bool v) async {
        await bind.mainSetPeerOption(
            id: id,
            key: kOptionForceAlwaysRelay,
            value: bool2option(kOptionForceAlwaysRelay, v));
        showToast(translate('Successful'));
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  // 이 거래처의 A/S 지원 이력 보기 (읽기 전용, 패널 기록 조회). 실패해도 무해.
  @protected
  MenuEntryBase<String> _supportHistoryAction(BuildContext context, String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        '지원 이력',
        style: style,
      ),
      proc: () {
        final name = peer.alias.isEmpty ? formatID(peer.id) : peer.alias;
        showCrHistoryDialog(context, remoteId: id, title: '$name 지원 이력');
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  // 원격 접속 없는 [디스크 정리] — Temp(전 프로필+윈도우)+휴지통 영구삭제 명령 큐잉.
  // 여유공간 경고(위험/주의)가 뜬 거래처에만 노출. 에이전트가 ≤10분 내 실행 후 결과 보고.
  @protected
  MenuEntryBase<String> _diskCleanupAction(BuildContext context, String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        '디스크 정리',
        style: style,
      ),
      proc: () {
        showCrDiskCleanupDialog(peer);
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  // 관제 메뉴 한 줄 — 파란 글자 + 오른쪽 아이콘.
  //   메뉴의 다른 항목은 전부 "지금 한 번 하는 동작"(접속·전송·이름 변경·디스크 정리)인데
  //   방화벽과 카드결제 데몬만 "켜 두면 계속 도는 설정"이다. 성격이 다른데 같은 무채색으로
  //   섞여 있으면 그냥 지나친다(2026-08-10 Chang 지적). 제거의 빨강과 같은 결로 묶되,
  //   파괴적 동작이 아니라 보호 장치라는 뜻에서 파랑을 쓴다.
  Widget _watchMenuRow(String label, IconData icon, TextStyle? style) {
    const color = Color(0xFF3B9EFF); // 다크·라이트 메뉴 배경 양쪽에서 읽히는 중간 톤
    return Row(
      children: [
        Text(label, style: style?.copyWith(color: color)),
        Expanded(
          child: Align(
            alignment: Alignment.centerRight,
            child: Transform.scale(
              scale: 0.8,
              child: Icon(icon, color: color),
            ),
          ).marginOnly(right: 4),
        ),
      ],
    );
  }

  // 우클릭 "방화벽 설정" — 거래처별 방화벽 자동 해제 on/off. 메인+오더 POS 구성에서
  //   업데이트가 방화벽을 되살려 주문 전달·프린터 공유가 끊기는 걸 막는다. 기본 off.
  MenuEntryBase<String> _firewallAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) =>
          _watchMenuRow('방화벽 설정', Icons.shield_outlined, style),
      proc: () {
        showCrFirewallDialog(peer);
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  // 우클릭 "카드결제 데몬 관제" — 이 거래처가 쓰는 VAN 데몬이 멈추면 에이전트가 되살린다.
  //   데몬이 죽어도 화면엔 표시가 없어 손님이 카드를 내밀 때 발견되는 고장을 덮는다. 기본 off.
  MenuEntryBase<String> _vanAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) =>
          _watchMenuRow('카드결제 데몬 관제', Icons.credit_card, style),
      proc: () {
        showCrVanDialog(peer);
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  MenuEntryBase<String> _renameAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('Rename'),
        style: style,
      ),
      proc: () async {
        String oldName = await _getAlias(id);
        renameDialog(
            oldName: oldName,
            onSubmit: (String newName) async {
              if (newName != oldName) {
                if (tab == PeerTabIndex.ab) {
                  await gFFI.abModel.changeAlias(id: id, alias: newName);
                  await bind.mainSetPeerAlias(id: id, alias: newName);
                } else {
                  await bind.mainSetPeerAlias(id: id, alias: newName);
                  // 등록 거래처면 패널 customer.name 에도 기록해, 최근/즐겨찾기/패널/전 직원이
                  // 누가 바꾸든 같은 이름으로 수렴한다. orphan 이면 서버는 no-op 이고 로컬 alias 만
                  // 유지된다. 성공 시 Rust 가 백그라운드로 캐시를 재워밍해 전 탭이 갱신된다.
                  // 결과를 확인해 정직하게 피드백한다. 종전엔 실패(미등록/네트워크)해도 무조건
                  // '성공'을 띄워 패널에 반영된 것으로 착각하게 만들었다 (2026-07-01 버그수정).
                  final synced = bind.chainremoteRenameCustomer(
                      payload: jsonEncode({"remoteId": id, "name": newName}));
                  showToast(synced
                      ? translate('Successful')
                      : '이 기기에만 적용됨 (패널 미반영 — 미등록 거래처이거나 저장 실패)');
                  _update();
                }
              }
            });
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  // 우클릭 "폴더로 이동" — 같은 매장 여러 POS 를 한 폴더로 묶는다. 폴더 조작은 HQ 에서 한다
  //   (대리점은 패널을 거의 안 봄). 다이얼로그에서 기존 폴더 선택 / 새 폴더 만들기 / 빼기.
  @protected
  MenuEntryBase<String> _moveToFolderAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Row(
        children: [
          Text('폴더로 이동', style: style),
          Expanded(
              child: Align(
            alignment: Alignment.centerRight,
            child: Transform.scale(
              scale: 0.8,
              child: const Icon(Icons.folder_outlined),
            ),
          ).marginOnly(right: 4)),
        ],
      ),
      proc: () => _showFolderPicker(id),
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  void _showFolderPicker(String remoteId) {
    () async {
      final folders = await ChainRemoteFolderApi.list();
      final newCtrl = TextEditingController();
      await gFFI.dialogManager.show<void>((setState, close, context) {
        // 배정/해제 공통 — 성공하면 패널 재조회로 device_group_name(그룹)을 갱신한다.
        Future<void> doAssign(String? folderId) async {
          final ok = await ChainRemoteFolderApi.assign(remoteId, folderId);
          close();
          showToast(ok ? translate('Successful') : translate('Failed'));
          if (ok) {
            bind.chainremoteLoadCustomers();
            bind.chainremoteLoadFavorites();
            _update();
          }
        }

        Future<void> createAndAssign() async {
          final name = newCtrl.text.trim();
          if (name.isEmpty) return;
          final f = await ChainRemoteFolderApi.create(name);
          if (f == null) {
            showToast(translate('Failed'));
            return;
          }
          await doAssign(f.id);
        }

        return CustomAlertDialog(
          title: Row(children: [
            Icon(Icons.folder_outlined, color: CrColors.of(context).accent, size: 22),
            SizedBox(width: 8),
            Text('폴더로 이동'),
          ]),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 380),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (folders.isEmpty)
                    Padding(
                      padding: EdgeInsets.only(bottom: 8),
                      child: Text('아직 폴더가 없습니다. 아래에서 새로 만드세요.',
                          style: TextStyle(
                              fontSize: 12, color: CrColors.of(context).textMuted)),
                    ),
                  ...folders.map((f) => ListTile(
                        dense: true,
                        leading: const Icon(Icons.folder, size: 20),
                        title: Text(f.name),
                        onTap: () => doAssign(f.id),
                      )),
                  const Divider(),
                  Row(children: [
                    Expanded(
                      child: TextField(
                        controller: newCtrl,
                        decoration: const InputDecoration(
                          hintText: '새 폴더 이름 (예: 낭성)',
                          isDense: true,
                          border: OutlineInputBorder(),
                        ),
                        onSubmitted: (_) => createAndAssign(),
                      ),
                    ),
                    const SizedBox(width: 6),
                    TextButton(
                      onPressed: createAndAssign,
                      child: const Text('만들기'),
                    ),
                  ]),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => doAssign(null),
                      icon: const Icon(Icons.folder_off_outlined, size: 18),
                      label: const Text('폴더에서 빼기'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [dialogButton('취소', onPressed: close, isOutline: true)],
        );
      });
    }();
  }

  @protected
  MenuEntryBase<String> _removeAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Row(
        children: [
          Text(
            translate('Delete'),
            style: style?.copyWith(color: Colors.red),
          ),
          Expanded(
              child: Align(
            alignment: Alignment.centerRight,
            child: Transform.scale(
              scale: 0.8,
              child: Icon(Icons.delete_forever, color: Colors.red),
            ),
          ).marginOnly(right: 4)),
        ],
      ),
      proc: () {
        onSubmit() async {
          switch (tab) {
            case PeerTabIndex.recent:
              await bind.mainRemovePeer(id: id);
              // 최근 세션은 네이티브 최근 접속 기록을 사용한다.
              bind.mainLoadRecentPeers();
              break;
            case PeerTabIndex.fav:
              // user_favorites DB (Phase 2-D).
              bind.chainremoteRemoveFavorite(remoteId: id);
              bind.chainremoteLoadFavorites();
              break;
            case PeerTabIndex.lan:
              await bind.mainRemoveDiscovered(id: id);
              bind.mainLoadLanPeers();
              break;
            case PeerTabIndex.ab:
              await gFFI.abModel.deletePeers([id]);
              break;
            case PeerTabIndex.group:
              break;
            case PeerTabIndex.customers:
              // 전체 거래처 탭은 삭제 메뉴를 노출하지 않는다 (거래처 삭제는 패널 owner 전용).
              break;
          }
          if (tab != PeerTabIndex.ab) {
            showToast(translate('Successful'));
          }
        }

        deleteConfirmDialog(onSubmit,
            '${translate('Delete')} "${peer.alias.isEmpty ? formatID(peer.id) : peer.alias}"?');
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  MenuEntryBase<String> _unrememberPasswordAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('Forget Password'),
        style: style,
      ),
      proc: () async {
        bool succ = await gFFI.abModel.changePersonalHashPassword(id, '');
        await bind.mainForgetPassword(id: id);
        if (succ) {
          showToast(translate('Successful'));
        } else {
          if (tab.index == PeerTabIndex.ab.index) {
            BotToast.showText(
                contentColor: Colors.red, text: translate("Failed"));
          }
        }
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  MenuEntryBase<String> _addFavAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Row(
        children: [
          Text(
            translate('Add to Favorites'),
            style: style,
          ),
          Expanded(
              child: Align(
            alignment: Alignment.centerRight,
            child: Transform.scale(
              scale: 0.8,
              child: Icon(Icons.star_outline),
            ),
          ).marginOnly(right: 4)),
        ],
      ),
      proc: () {
        () async {
          // user_favorites DB (Phase 2-D). 반환값 확인 필수 — 서버 POST 실패 시에도
          // 무조건 "성공" 토스트를 띄우면 저장 안 된 즐겨찾기를 사용자가 성공으로 오인한다.
          final ok = bind.chainremoteAddFavorite(remoteId: id);
          showToast(translate(ok ? 'Successful' : 'Failed'));
        }();
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  MenuEntryBase<String> _rmFavAction(
      String id, Future<void> Function() reloadFunc) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Row(
        children: [
          Text(
            translate('Remove from Favorites'),
            style: style,
          ),
          Expanded(
              child: Align(
            alignment: Alignment.centerRight,
            child: Transform.scale(
              scale: 0.8,
              child: Icon(Icons.star),
            ),
          ).marginOnly(right: 4)),
        ],
      ),
      proc: () {
        () async {
          // user_favorites DB (Phase 2-D). 반환값 확인 필수(위 _addFavAction과 동일 이유).
          final ok = bind.chainremoteRemoveFavorite(remoteId: id);
          await reloadFunc();
          showToast(translate(ok ? 'Successful' : 'Failed'));
        }();
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  MenuEntryBase<String> _addToAb(Peer peer) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('Add to address book'),
        style: style,
      ),
      proc: () {
        () async {
          addPeersToAbDialog([Peer.copy(peer)]);
        }();
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  Future<String> _getAlias(String id) async =>
      await bind.mainGetPeerOption(id: id, key: 'alias');

  @protected
  void _update();
}

class RecentPeerCard extends BasePeerCard {
  RecentPeerCard({required Peer peer, EdgeInsets? menuPadding, Key? key})
      : super(
            peer: peer,
            tab: PeerTabIndex.recent,
            menuPadding: menuPadding,
            key: key);

  @override
  Future<List<MenuEntryBase<String>>> _buildMenuItems(
      BuildContext context) async {
    // 카메라·터미널·TCP 터널링은 파워유저 유산 — 거래처 운영 메뉴에선 뺐다(2026-07-16 Chang).
    final List<MenuEntryBase<String>> menuItems = [
      _connectAction(context),
      _transferFileAction(context),
    ];

    // user_favorites DB 캐시 (Phase 2-D).
    final List favs = bind.chainremoteGetFavoriteIds();

    // menuItems.add(await _openNewConnInOptAction(peer.id));
    if (!isWeb) {
      menuItems.add(await _forceAlwaysRelayAction(peer.id));
    }
    if (isWindows && peer.platform == kPeerPlatformWindows) {
      menuItems.add(_rdpAction(context, peer.id));
    }
    if (isWindows) {
      menuItems.add(_createShortCutAction(peer.id));
    }
    menuItems.add(MenuEntryDivider());
    if (isMobile || isDesktop || isWebDesktop) {
      menuItems.add(_renameAction(peer.id));
      menuItems.add(_moveToFolderAction(peer.id));
    }
    if (await bind.mainPeerHasPassword(id: peer.id)) {
      menuItems.add(_unrememberPasswordAction(peer.id));
    }

    if (!favs.contains(peer.id)) {
      menuItems.add(_addFavAction(peer.id));
    } else {
      menuItems.add(_rmFavAction(peer.id, () async {}));
    }

    if (gFFI.userModel.userName.isNotEmpty) {
      menuItems.add(_addToAb(peer));
    }

    menuItems.add(_supportHistoryAction(context, peer.id));
    if (crDiskInfo(peer) != null) {
      menuItems.add(_diskCleanupAction(context, peer.id));
    }
    if (peer.platform == kPeerPlatformWindows) {
      menuItems.add(_firewallAction(peer.id));
      menuItems.add(_vanAction(peer.id));
    }

    menuItems.add(MenuEntryDivider());
    menuItems.add(_removeAction(peer.id));
    return menuItems;
  }

  @protected
  @override
  // 최근 세션은 네이티브 최근 접속 기록을 사용한다.
  void _update() => bind.mainLoadRecentPeers();
}

class FavoritePeerCard extends BasePeerCard {
  FavoritePeerCard({required Peer peer, EdgeInsets? menuPadding, Key? key})
      : super(
            peer: peer,
            tab: PeerTabIndex.fav,
            menuPadding: menuPadding,
            key: key);

  @override
  Future<List<MenuEntryBase<String>>> _buildMenuItems(
      BuildContext context) async {
    // 카메라·터미널·TCP 터널링은 파워유저 유산 — 거래처 운영 메뉴에선 뺐다(2026-07-16 Chang).
    final List<MenuEntryBase<String>> menuItems = [
      _connectAction(context),
      _transferFileAction(context),
    ];

    // menuItems.add(await _openNewConnInOptAction(peer.id));
    if (!isWeb) {
      menuItems.add(await _forceAlwaysRelayAction(peer.id));
    }
    if (isWindows && peer.platform == kPeerPlatformWindows) {
      menuItems.add(_rdpAction(context, peer.id));
    }
    if (isWindows) {
      menuItems.add(_createShortCutAction(peer.id));
    }
    menuItems.add(MenuEntryDivider());
    if (isMobile || isDesktop || isWebDesktop) {
      menuItems.add(_renameAction(peer.id));
      menuItems.add(_moveToFolderAction(peer.id));
    }
    if (await bind.mainPeerHasPassword(id: peer.id)) {
      menuItems.add(_unrememberPasswordAction(peer.id));
    }
    menuItems.add(_rmFavAction(peer.id, () async {
      // user_favorites DB (Phase 2-D).
      await bind.chainremoteLoadFavorites();
    }));

    if (gFFI.userModel.userName.isNotEmpty) {
      menuItems.add(_addToAb(peer));
    }

    menuItems.add(_supportHistoryAction(context, peer.id));
    if (crDiskInfo(peer) != null) {
      menuItems.add(_diskCleanupAction(context, peer.id));
    }
    if (peer.platform == kPeerPlatformWindows) {
      menuItems.add(_firewallAction(peer.id));
      menuItems.add(_vanAction(peer.id));
    }

    menuItems.add(MenuEntryDivider());
    menuItems.add(_removeAction(peer.id));
    return menuItems;
  }

  @protected
  @override
  // user_favorites DB (Phase 2-D).
  void _update() => bind.chainremoteLoadFavorites();
}

// '전체 거래처' 탭 카드. 테넌트 패널에 등록된 거래처 전체(pending 포함)를 다룬다.
// 1클릭 원격 연결, 내 즐겨찾기 추가/제거, 그리고 마스터 한정으로 미확정 후보를 '거래처로 확정'.
// 삭제 메뉴는 없다(거래처 삭제는 패널 owner 전용). 확정 권한은 서버(requireOwner)가 강제한다.
class AllCustomersPeerCard extends BasePeerCard {
  AllCustomersPeerCard({required Peer peer, EdgeInsets? menuPadding, Key? key})
      : super(
            peer: peer,
            tab: PeerTabIndex.customers,
            menuPadding: menuPadding,
            key: key);

  @override
  Future<List<MenuEntryBase<String>>> _buildMenuItems(
      BuildContext context) async {
    // 카메라·터미널·TCP 터널링은 파워유저 유산 — 거래처 운영 메뉴에선 뺐다(2026-07-16 Chang).
    final List<MenuEntryBase<String>> menuItems = [
      _connectAction(context),
      _transferFileAction(context),
    ];

    // user_favorites DB 캐시 (Phase 2-D).
    final List favs = bind.chainremoteGetFavoriteIds();

    if (!isWeb) {
      menuItems.add(await _forceAlwaysRelayAction(peer.id));
    }
    if (isWindows && peer.platform == kPeerPlatformWindows) {
      menuItems.add(_rdpAction(context, peer.id));
    }
    if (isWindows) {
      menuItems.add(_createShortCutAction(peer.id));
    }
    menuItems.add(MenuEntryDivider());

    // 거래처명 변경. 전체 거래처 탭에서도 패널 customer.name 에 기록해 세 화면에 전파한다.
    if (isMobile || isDesktop || isWebDesktop) {
      menuItems.add(_renameAction(peer.id));
      menuItems.add(_moveToFolderAction(peer.id));
    }

    // 전체 목록에서 내 담당 거래처를 즐겨찾기에 추가하거나 해제한다.
    if (!favs.contains(peer.id)) {
      menuItems.add(_addFavAction(peer.id));
    } else {
      menuItems.add(_rmFavAction(peer.id, () async {}));
    }

    menuItems.add(_supportHistoryAction(context, peer.id));
    if (crDiskInfo(peer) != null) {
      menuItems.add(_diskCleanupAction(context, peer.id));
    }
    if (peer.platform == kPeerPlatformWindows) {
      menuItems.add(_firewallAction(peer.id));
      menuItems.add(_vanAction(peer.id));
    }

    // 미확정(pending) 후보 확정. 버튼은 마스터(owner)에게만 노출하고, 서버도 owner 를 강제한다 (이중 게이트).
    if (peer.enrollStatus == 'pending' && ChainRemoteAuth.isMaster()) {
      menuItems.add(MenuEntryDivider());
      menuItems.add(_confirmCustomerAction(context, peer.id));
    }
    return menuItems;
  }

  MenuEntryBase<String> _confirmCustomerAction(BuildContext context, String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Row(
        children: [
          Text(
            translate('Confirm as customer'),
            style: style,
          ),
          Expanded(
              child: Align(
            alignment: Alignment.centerRight,
            child: Transform.scale(
              scale: 0.8,
              child: Icon(Icons.verified, color: CrColors.of(context).accent),
            ),
          ).marginOnly(right: 4)),
        ],
      ),
      proc: () {
        final ok = bind.chainremoteConfirmCustomer(remoteId: id);
        showToast(translate(ok ? 'Successful' : 'Failed'));
      },
      padding: menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  @override
  void _update() => bind.chainremoteLoadCustomers();
}

class DiscoveredPeerCard extends BasePeerCard {
  DiscoveredPeerCard({required Peer peer, EdgeInsets? menuPadding, Key? key})
      : super(
            peer: peer,
            tab: PeerTabIndex.lan,
            menuPadding: menuPadding,
            key: key);

  @override
  Future<List<MenuEntryBase<String>>> _buildMenuItems(
      BuildContext context) async {
    final List<MenuEntryBase<String>> menuItems = [
      _connectAction(context),
      _transferFileAction(context),
      _viewCameraAction(context),
      _terminalAction(context),
    ];

    if (peer.platform == kPeerPlatformWindows) {
      menuItems.add(_terminalRunAsAdminAction(context));
    }

    // user_favorites DB 캐시 (Phase 2-D).
    final List favs = bind.chainremoteGetFavoriteIds();

    if (isDesktop && peer.platform != kPeerPlatformAndroid) {
      menuItems.add(_tcpTunnelingAction(context));
    }
    // menuItems.add(await _openNewConnInOptAction(peer.id));
    if (!isWeb) {
      menuItems.add(await _forceAlwaysRelayAction(peer.id));
    }
    if (isWindows && peer.platform == kPeerPlatformWindows) {
      menuItems.add(_rdpAction(context, peer.id));
    }
    menuItems.add(_wolAction(peer.id));
    if (isWindows) {
      menuItems.add(_createShortCutAction(peer.id));
    }

    if (!favs.contains(peer.id)) {
      menuItems.add(_addFavAction(peer.id));
    } else {
      menuItems.add(_rmFavAction(peer.id, () async {}));
    }

    if (gFFI.userModel.userName.isNotEmpty) {
      menuItems.add(_addToAb(peer));
    }

    menuItems.add(MenuEntryDivider());
    menuItems.add(_removeAction(peer.id));
    return menuItems;
  }

  @protected
  @override
  void _update() => bind.mainLoadLanPeers();
}

class AddressBookPeerCard extends BasePeerCard {
  AddressBookPeerCard({required Peer peer, EdgeInsets? menuPadding, Key? key})
      : super(
            peer: peer,
            tab: PeerTabIndex.ab,
            menuPadding: menuPadding,
            key: key);

  @override
  Future<List<MenuEntryBase<String>>> _buildMenuItems(
      BuildContext context) async {
    final List<MenuEntryBase<String>> menuItems = [
      _connectAction(context),
      _transferFileAction(context),
      _viewCameraAction(context),
      _terminalAction(context),
    ];

    if (peer.platform == kPeerPlatformWindows) {
      menuItems.add(_terminalRunAsAdminAction(context));
    }

    if (isDesktop && peer.platform != kPeerPlatformAndroid) {
      menuItems.add(_tcpTunnelingAction(context));
    }
    // menuItems.add(await _openNewConnInOptAction(peer.id));
    if (!isWeb) {
      menuItems.add(await _forceAlwaysRelayAction(peer.id));
    }
    if (isWindows && peer.platform == kPeerPlatformWindows) {
      menuItems.add(_rdpAction(context, peer.id));
    }
    if (isWindows) {
      menuItems.add(_createShortCutAction(peer.id));
    }
    if (gFFI.abModel.current.canWrite()) {
      menuItems.add(MenuEntryDivider());
      if (isMobile || isDesktop || isWebDesktop) {
        menuItems.add(_renameAction(peer.id));
        menuItems.add(_moveToFolderAction(peer.id));
      }
      if (gFFI.abModel.current.isPersonal() && peer.hash.isNotEmpty) {
        menuItems.add(_unrememberPasswordAction(peer.id));
      }
      if (!gFFI.abModel.current.isPersonal()) {
        menuItems.add(_changeSharedAbPassword());
      }
      if (gFFI.abModel.currentAbTags.isNotEmpty) {
        menuItems.add(_editTagAction(peer.id));
      }
      menuItems.add(_editNoteAction(peer.id));
    }
    final addressbooks = gFFI.abModel.addressBooksCanWrite();
    if (gFFI.peerTabModel.currentTab == PeerTabIndex.ab.index) {
      addressbooks.remove(gFFI.abModel.currentName.value);
    }
    if (addressbooks.isNotEmpty) {
      menuItems.add(_addToAb(peer));
    }
    menuItems.add(_existIn());
    if (gFFI.abModel.current.canWrite()) {
      menuItems.add(MenuEntryDivider());
      menuItems.add(_removeAction(peer.id));
    }
    return menuItems;
  }

  // address book does not need to update
  @protected
  @override
  void _update() =>
      {}; //gFFI.abModel.pullAb(force: ForcePullAb.current, quiet: true);

  @protected
  MenuEntryBase<String> _editTagAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('Edit Tag'),
        style: style,
      ),
      proc: () {
        editAbTagDialog(gFFI.abModel.getPeerTags(id), (selectedTag) async {
          await gFFI.abModel.changeTagForPeers([id], selectedTag);
        });
      },
      padding: super.menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  MenuEntryBase<String> _editNoteAction(String id) {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('Edit note'),
        style: style,
      ),
      proc: () {
        editAbPeerNoteDialog(id);
      },
      padding: super.menuPadding,
      dismissOnClicked: true,
    );
  }

  @protected
  @override
  Future<String> _getAlias(String id) async =>
      gFFI.abModel.find(id)?.alias ?? '';

  MenuEntryBase<String> _changeSharedAbPassword() {
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate(
            peer.password.isEmpty ? 'Set shared password' : 'Change Password'),
        style: style,
      ),
      proc: () {
        setSharedAbPasswordDialog(gFFI.abModel.currentName.value, peer);
      },
      padding: super.menuPadding,
      dismissOnClicked: true,
    );
  }

  MenuEntryBase<String> _existIn() {
    final names = gFFI.abModel.idExistIn(peer.id);
    final text = names.join(', ');
    return MenuEntryButton<String>(
      childBuilder: (TextStyle? style) => Text(
        translate('Exist in'),
        style: style,
      ),
      proc: () {
        gFFI.dialogManager.show((setState, close, context) {
          return CustomAlertDialog(
            title: Text(translate('Exist in')),
            content: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [Text(text)]),
            actions: [
              dialogButton(
                "OK",
                icon: Icon(Icons.done_rounded),
                onPressed: close,
              ),
            ],
            onSubmit: close,
            onCancel: close,
          );
        });
      },
      padding: super.menuPadding,
      dismissOnClicked: true,
    );
  }
}

class MyGroupPeerCard extends BasePeerCard {
  MyGroupPeerCard({required Peer peer, EdgeInsets? menuPadding, Key? key})
      : super(
            peer: peer,
            tab: PeerTabIndex.group,
            menuPadding: menuPadding,
            key: key);

  @override
  Future<List<MenuEntryBase<String>>> _buildMenuItems(
      BuildContext context) async {
    final List<MenuEntryBase<String>> menuItems = [
      _connectAction(context),
      _transferFileAction(context),
      _viewCameraAction(context),
      _terminalAction(context),
    ];

    if (peer.platform == kPeerPlatformWindows) {
      menuItems.add(_terminalRunAsAdminAction(context));
    }

    if (isDesktop && peer.platform != kPeerPlatformAndroid) {
      menuItems.add(_tcpTunnelingAction(context));
    }
    // menuItems.add(await _openNewConnInOptAction(peer.id));
    if (!isWeb) {
      menuItems.add(await _forceAlwaysRelayAction(peer.id));
    }
    if (isWindows && peer.platform == kPeerPlatformWindows) {
      menuItems.add(_rdpAction(context, peer.id));
    }
    if (isWindows) {
      menuItems.add(_createShortCutAction(peer.id));
    }
    // menuItems.add(MenuEntryDivider());
    // menuItems.add(_renameAction(peer.id));
    // if (await bind.mainPeerHasPassword(id: peer.id)) {
    //   menuItems.add(_unrememberPasswordAction(peer.id));
    // }
    if (gFFI.userModel.userName.isNotEmpty) {
      menuItems.add(_addToAb(peer));
    }
    return menuItems;
  }

  @protected
  @override
  void _update() => gFFI.groupModel.pull();
}

void _rdpDialog(String id) async {
  final maxLength = bind.mainMaxEncryptLen();
  final port = await bind.mainGetPeerOption(id: id, key: 'rdp_port');
  final username = await bind.mainGetPeerOption(id: id, key: 'rdp_username');
  final portController = TextEditingController(text: port);
  final userController = TextEditingController(text: username);
  final passwordController = TextEditingController(
      text: await bind.mainGetPeerOption(id: id, key: 'rdp_password'));
  RxBool secure = true.obs;

  gFFI.dialogManager.show((setState, close, context) {
    submit() async {
      String port = portController.text.trim();
      String username = userController.text;
      String password = passwordController.text;
      await bind.mainSetPeerOption(id: id, key: 'rdp_port', value: port);
      await bind.mainSetPeerOption(
          id: id, key: 'rdp_username', value: username);
      await bind.mainSetPeerOption(
          id: id, key: 'rdp_password', value: password);
      showToast(translate('Successful'));
      close();
    }

    return CustomAlertDialog(
      title: Text(translate('RDP Settings')),
      content: ConstrainedBox(
        constraints: const BoxConstraints(minWidth: 500),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                isDesktop
                    ? ConstrainedBox(
                        constraints: const BoxConstraints(minWidth: 140),
                        child: Text(
                          "${translate('Port')}:",
                          textAlign: TextAlign.right,
                        ).marginOnly(right: 10))
                    : SizedBox.shrink(),
                Expanded(
                  child: TextField(
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(
                          r'^([0-9]|[1-9]\d|[1-9]\d{2}|[1-9]\d{3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$'))
                    ],
                    decoration: InputDecoration(
                        labelText: isDesktop ? null : translate('Port'),
                        hintText: '3389'),
                    controller: portController,
                    autofocus: true,
                  ).workaroundFreezeLinuxMint(),
                ),
              ],
            ).marginOnly(bottom: isDesktop ? 8 : 0),
            Obx(() => Row(
                  children: [
                    stateGlobal.isPortrait.isFalse
                        ? ConstrainedBox(
                            constraints: const BoxConstraints(minWidth: 140),
                            child: Text(
                              "${translate('Username')}:",
                              textAlign: TextAlign.right,
                            ).marginOnly(right: 10))
                        : SizedBox.shrink(),
                    Expanded(
                      child: TextField(
                        decoration: InputDecoration(
                            labelText:
                                isDesktop ? null : translate('Username')),
                        controller: userController,
                      ).workaroundFreezeLinuxMint(),
                    ),
                  ],
                ).marginOnly(bottom: stateGlobal.isPortrait.isFalse ? 8 : 0)),
            Obx(() => Row(
                  children: [
                    stateGlobal.isPortrait.isFalse
                        ? ConstrainedBox(
                            constraints: const BoxConstraints(minWidth: 140),
                            child: Text(
                              "${translate('Password')}:",
                              textAlign: TextAlign.right,
                            ).marginOnly(right: 10))
                        : SizedBox.shrink(),
                    Expanded(
                      child: Obx(() => TextField(
                            obscureText: secure.value,
                            maxLength: maxLength,
                            decoration: InputDecoration(
                                labelText:
                                    isDesktop ? null : translate('Password'),
                                suffixIcon: IconButton(
                                    onPressed: () =>
                                        secure.value = !secure.value,
                                    icon: Icon(secure.value
                                        ? Icons.visibility_off
                                        : Icons.visibility))),
                            controller: passwordController,
                          ).workaroundFreezeLinuxMint()),
                    ),
                  ],
                ))
          ],
        ),
      ),
      actions: [
        dialogButton("Cancel", onPressed: close, isOutline: true),
        dialogButton("OK", onPressed: submit),
      ],
      onSubmit: submit,
      onCancel: close,
    );
  });
}

Widget getOnline(double rightPadding, bool online) {
  return Tooltip(
      message: translate(online ? 'Online' : 'Offline'),
      waitDuration: const Duration(seconds: 1),
      child: Padding(
          padding: EdgeInsets.fromLTRB(0, 4, rightPadding, 4),
          child: CircleAvatar(
              radius: 3, backgroundColor: online ? Colors.green : kColorWarn)));
}

Widget build_more(BuildContext context, {bool invert = false}) {
  final RxBool hover = false.obs;
  return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () {},
      onHover: (value) => hover.value = value,
      child: Obx(() => CircleAvatar(
          radius: 14,
          backgroundColor: hover.value
              ? (invert
                  ? Theme.of(context).colorScheme.background
                  : Theme.of(context).scaffoldBackgroundColor)
              : (invert
                  ? Theme.of(context).scaffoldBackgroundColor
                  : Theme.of(context).colorScheme.background),
          child: Tooltip(
            message: '메뉴 (이름 바꾸기 · 비밀번호 · 삭제 등)',
            child: Icon(Icons.settings_outlined,
                size: 18,
                color: hover.value
                    ? Theme.of(context).textTheme.titleLarge?.color
                    : Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.color
                        ?.withOpacity(0.5))))));
}

class TagPainter extends CustomPainter {
  final double radius;
  late final List<Color> colors;

  TagPainter({required this.radius, required List<Color> colors}) {
    this.colors = colors.reversed.toList();
  }

  @override
  void paint(Canvas canvas, Size size) {
    double x = 0;
    double y = radius;
    for (int i = 0; i < colors.length; i++) {
      Paint paint = Paint();
      paint.color = colors[i];
      x -= radius + 1;
      if (i == colors.length - 1) {
        canvas.drawCircle(Offset(x, y), radius, paint);
      } else {
        Path path = Path();
        path.addArc(Rect.fromCircle(center: Offset(x, y), radius: radius),
            math.pi * 4 / 3, math.pi * 4 / 3);
        path.addArc(
            Rect.fromCircle(center: Offset(x - radius, y), radius: radius),
            math.pi * 5 / 3,
            math.pi * 2 / 3);
        path.fillType = PathFillType.evenOdd;
        canvas.drawPath(path, paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) {
    return true;
  }
}

void connectInPeerTab(BuildContext context, Peer peer, PeerTabIndex tab,
    {bool isFileTransfer = false,
    bool isViewCamera = false,
    bool isTcpTunneling = false,
    bool isRDP = false,
    bool isTerminal = false}) async {
  var password = '';
  bool isSharedPassword = false;
  if (tab == PeerTabIndex.ab) {
    // If recent peer's alias is empty, set it to ab's alias
    // Because the platform is not set, it may not take effect, but it is more important not to display if the connection is not successful
    if (peer.alias.isNotEmpty &&
        (await bind.mainGetPeerOption(id: peer.id, key: "alias")).isEmpty) {
      await bind.mainSetPeerAlias(
        id: peer.id,
        alias: peer.alias,
      );
    }
    if (!gFFI.abModel.current.isPersonal()) {
      if (peer.password.isNotEmpty) {
        password = peer.password;
        isSharedPassword = true;
      }
      if (password.isEmpty) {
        final abPassword = gFFI.abModel.getdefaultSharedPassword();
        if (abPassword != null) {
          password = abPassword;
          isSharedPassword = true;
        }
      }
    }
  }
  connect(context, peer.id,
      password: password,
      isSharedPassword: isSharedPassword,
      isFileTransfer: isFileTransfer,
      isTerminal: isTerminal,
      isViewCamera: isViewCamera,
      isTcpTunneling: isTcpTunneling,
      isRDP: isRDP);
}
