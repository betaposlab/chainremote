import 'dart:async';
import 'dart:ui' as ui;

import 'package:bot_toast/bot_toast.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hbb/common/widgets/address_book.dart';
import 'package:flutter_hbb/common/widgets/dialog.dart';
import 'package:flutter_hbb/common/widgets/my_group.dart';
import 'package:flutter_hbb/common/widgets/peers_view.dart';
import 'package:flutter_hbb/common/widgets/chainremote_disk.dart';
import 'package:flutter_hbb/common/widgets/chainremote_van.dart';
import 'package:flutter_hbb/common/widgets/chainremote_history.dart';
import 'package:flutter_hbb/common/widgets/chainremote_easter.dart';
import 'package:flutter_hbb/common/widgets/chainremote_easter_crawl.dart';
import 'package:flutter_hbb/common/widgets/chainremote_auth_gate.dart';
import 'package:flutter_hbb/common/widgets/peer_card.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/desktop/widgets/popup_menu.dart';
import 'package:flutter_hbb/desktop/widgets/material_mod_popup_menu.dart'
    as mod_menu;
import 'package:flutter_hbb/desktop/widgets/tabbar_widget.dart';
import 'package:flutter_hbb/models/ab_model.dart';
import 'package:flutter_hbb/models/peer_model.dart';

import 'package:flutter_hbb/models/peer_tab_model.dart';
import 'package:flutter_hbb/models/state_model.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:pull_down_button/pull_down_button.dart';

import '../../common.dart';
import '../../models/platform_model.dart';

class PeerTabPage extends StatefulWidget {
  const PeerTabPage({Key? key}) : super(key: key);
  @override
  State<PeerTabPage> createState() => _PeerTabPageState();
}

class _TabEntry {
  final Widget widget;
  final Function({dynamic hint})? load;
  _TabEntry(this.widget, [this.load]);
}

EdgeInsets? _menuPadding() {
  return (isDesktop || isWebDesktop) ? kDesktopMenuPadding : null;
}

class _PeerTabPageState extends State<PeerTabPage>
    with SingleTickerProviderStateMixin {
  final List<_TabEntry> entries = [
    _TabEntry(RecentPeersView(
      menuPadding: _menuPadding(),
    )),
    _TabEntry(FavoritePeersView(
      menuPadding: _menuPadding(),
    )),
    _TabEntry(DiscoveredPeersView(
      menuPadding: _menuPadding(),
    )),
    _TabEntry(
        AddressBook(
          menuPadding: _menuPadding(),
        ),
        ({dynamic hint}) => gFFI.abModel.pullAb(
            force: hint == null ? ForcePullAb.listAndCurrent : null,
            quiet: false)),
    _TabEntry(
      MyGroup(
        menuPadding: _menuPadding(),
      ),
      ({dynamic hint}) => gFFI.groupModel.pull(force: hint == null),
    ),
    // '전체 거래처' 탭. 인덱스 5로 enum customers 와 정렬한다. 탭 진입 시 view.build() 가
    // chainremoteLoadCustomers 를 호출하고, load_all_customers push 로 목록이 표시된다.
    _TabEntry(AllCustomersPeersView(
      menuPadding: _menuPadding(),
    )),
  ];
  RelativeRect? mobileTabContextMenuPos;

  final isOptVisiableFixed = isOptionFixed(kOptionPeerTabVisible);

  // 디스크 관제 자동 갱신(2026-07-16 Chang) — 정리 결과·여유공간이 수시로 바뀌는데 수동
  // 새로고침을 요구하면 관제가 아니다. 60초 주기로 거래처/즐겨찾기를 재조회한다(새로고침
  // 버튼과 같은 호출 — 거래처명·디스크·배지·스트립이 함께 갱신). 옛 "자동 폴링 거부"
  // 결정은 이 요청으로 뒤집힘 — 분당 1회 소형 JSON 이라 50대리점 트래픽도 무시 수준.
  Timer? _crAutoRefreshTimer;

  _PeerTabPageState() {
    _loadLocalOptions();
  }

  @override
  void initState() {
    super.initState();
    _crAutoRefreshTimer = Timer.periodic(const Duration(seconds: 60), (_) {
      if (!mounted) return;
      bind.chainremoteLoadCustomers();
      bind.chainremoteLoadFavorites();
    });
  }

  @override
  void dispose() {
    _crAutoRefreshTimer?.cancel();
    super.dispose();
  }

  void _loadLocalOptions() {
    // 데스크톱은 표 하나로 통일했다(2026-08-11) — 저장돼 있던 옛 보기 설정은 무시한다.
    //   안 그러면 종전에 '작은 카드'를 골라 뒀던 사람이 폴더가 사라진 화면을 보게 된다
    //   (폴더 렌더는 list 분기에만 있다).
    if (isDesktop || isWebDesktop) {
      peerCardUiType.value = PeerUiType.list;
      // 표 정렬은 머리글이 정하고 여기서 복원한다(앱을 다시 켜도 보던 순서 그대로).
      crTableSort.value = bind.mainGetLocalOption(key: 'cr-table-sort');
      return;
    }
    final uiType = bind.getLocalFlutterOption(k: kOptionPeerCardUiType);
    if (uiType != '') {
      peerCardUiType.value = int.parse(uiType) == 0
          ? PeerUiType.grid
          : int.parse(uiType) == 1
              ? PeerUiType.tile
              : PeerUiType.list;
    }
    hideAbTagsPanel.value =
        bind.mainGetLocalOption(key: kOptionHideAbTagsPanel) == 'Y';
  }

  Future<void> handleTabSelection(int tabIndex) async {
    if (tabIndex < entries.length) {
      if (tabIndex != gFFI.peerTabModel.currentTab) {
        gFFI.peerTabModel.setCurrentTabCachedPeers([]);
      }
      gFFI.peerTabModel.setCurrentTab(tabIndex);
      entries[tabIndex].load?.call(hint: false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final model = Provider.of<PeerTabModel>(context);
    Widget selectionWrap(Widget widget) {
      return model.multiSelectionMode ? createMultiSelectionBar(model) : widget;
    }

    return Column(
      textBaseline: TextBaseline.ideographic,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Obx(() => SizedBox(
              height: 46,
              child: Container(
                padding: stateGlobal.isPortrait.isTrue
                    ? EdgeInsets.symmetric(horizontal: 2)
                    : null,
                child: selectionWrap(Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // 탭바 우선 — 자연폭을 먼저 확보한다(아이콘 모드면 3개가 다 보임).
                    // 오른쪽 액션에 밀려 탭이 하나만 남던 문제(2026-07-23) 해결.
                    Flexible(
                        child: visibleContextMenuListener(
                            _createSwitchBar(context))),
                    // 오른쪽 액션은 남은 폭을 갖되, 좁아 넘치면 가로 스크롤로 흡수한다
                    // (검색이 맨 왼쪽이라 항상 보이고, 정렬 등 뒤쪽만 스크롤로 가려진다).
                    Expanded(
                      child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: stateGlobal.isPortrait.isTrue
                              ? _portraitRightActions(context)
                              : _landscapeRightActions(context),
                        ),
                      ),
                    ),
                  ],
                )),
              ),
            ).paddingOnly(right: stateGlobal.isPortrait.isTrue ? 0 : 12)),
        _crVanAlertStrip(),
        _crVanMissingStrip(),
        _crDiskAlertStrip(),
        _createPeersView(),
      ],
    );
  }

  // VAN 을 잘못 켠 거래처 스트립 — 그 기기에 데몬 프로그램 자체가 없다.
  // 복구 실패와 나눠 두는 이유: 저쪽은 사람이 거래처에 가야 하고, 이쪽은 관제만 끄면 끝난다.
  // 같은 빨강으로 묶으면 있지도 않은 고장을 고치러 나간다. 색도 경고(노랑)로 낮춘다 —
  // 결제가 안 되는 상황이 아니라 우리 설정이 어긋난 것뿐이다.
  Widget _crVanMissingStrip() {
    return ListenableBuilder(
      listenable: gFFI.allCustomersPeersModel,
      builder: (context, _) {
        final missing = gFFI.allCustomersPeersModel.peers
            .where((p) => p.vanMissing == 'Y')
            .toList();
        if (missing.isEmpty) return const SizedBox.shrink();
        final fg = CrColors.of(context).warnFg;
        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(right: 12, bottom: 4),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: CrColors.of(context).warnBannerBg,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: CrColors.of(context).warnBannerBorder),
          ),
          child: Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('💳 VAN 설정 확인 ${missing.length}곳 — 그 기기에 데몬이 없습니다',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: CrColors.of(context).warnBannerFg)),
              ...missing.map((p) {
                final name = p.alias
                    .replaceFirst('⏳ ', '')
                    .replaceFirst('🆕 ', '')
                    .trim();
                final label = name.isEmpty ? p.id : name;
                return Container(
                  padding: const EdgeInsets.only(left: 8, right: 4),
                  decoration: BoxDecoration(
                    color: CrColors.of(context).warnBannerBg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: CrColors.of(context).warnBannerBorder),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      InkWell(
                        onTap: () {
                          gFFI.peerTabModel
                              .setCurrentTab(PeerTabIndex.customers.index);
                          peerSearchBarOpen.value = true;
                          peerSearchTextController.text = label;
                          peerSearchText.value = label;
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Text(label,
                              style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w600,
                                  color: fg)),
                        ),
                      ),
                      // 바로 관제 창을 열어 끄거나 맞는 VAN 으로 바꾸게 한다.
                      InkWell(
                        borderRadius: BorderRadius.circular(10),
                        onTap: () => showCrVanDialog(p),
                        child: Padding(
                          padding: const EdgeInsets.all(3),
                          child: Icon(Icons.tune, size: 13, color: fg),
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }

  // 카드결제 데몬 자동 복구 실패 스트립 — 에이전트가 세 번 되살려 보고 손을 뗀 상태다.
  // 리더기 케이블이 빠졌거나 COM 이 어긋난 경우라 사람이 가야 낫는다. 관리 패널에만 빨간
  // 칩이 뜨면 HQ 를 주로 보는 직원은 영영 모르므로 디스크 주의와 같은 자리에 올린다
  // (2026-08-10 Chang: 만들면 파생되는 문제까지 먼저 챙길 것). 디스크보다 위에 두는 이유는
  // 결제 불능이 더 급하기 때문 — 여유공간은 며칠 여유가 있지만 카드는 지금 못 긁는다.
  Widget _crVanAlertStrip() {
    return ListenableBuilder(
      listenable: gFFI.allCustomersPeersModel,
      builder: (context, _) {
        // 데몬이 아예 없는 기기(관제를 잘못 켠 것)는 여기서 뺀다 — 고장이 아니라 설정
        // 실수라서 아래 별도 스트립이 "관제를 끄세요"로 안내한다. 같은 빨강으로 묶으면
        // 있지도 않은 고장을 고치러 나간다(2026-08-10 Chang: KOVAN 거래처에 켜면?).
        final failed = gFFI.allCustomersPeersModel.peers
            .where((p) => p.vanGaveUp == 'Y' && p.vanMissing != 'Y')
            .toList();
        if (failed.isEmpty) return const SizedBox.shrink();
        final fg = CrColors.of(context).dangerFg;
        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(right: 12, bottom: 4),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: CrColors.of(context).dangerBg,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: CrColors.of(context).dangerBorder),
          ),
          child: Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('💳 카드결제 데몬 복구 실패 ${failed.length}곳 — 확인 필요',
                  style: TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700, color: fg)),
              ...failed.map((p) {
                // Rust 가 별칭 앞에 붙이는 상태 마커(⏳/🆕)는 검색 필터에 안 맞으니 벗긴다.
                final name = p.alias
                    .replaceFirst('⏳ ', '')
                    .replaceFirst('🆕 ', '')
                    .trim();
                final label = name.isEmpty ? p.id : name;
                return Container(
                  padding: const EdgeInsets.only(left: 8, right: 4),
                  decoration: BoxDecoration(
                    color: CrColors.of(context).dangerBg,
                    borderRadius: BorderRadius.circular(12),
                    border:
                        Border.all(color: CrColors.of(context).dangerBorder),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      InkWell(
                        onTap: () {
                          // 카드로 점프: 전체 거래처 탭 + 검색 필터(디스크 스트립과 같은 동작).
                          gFFI.peerTabModel
                              .setCurrentTab(PeerTabIndex.customers.index);
                          peerSearchBarOpen.value = true;
                          peerSearchTextController.text = label;
                          peerSearchText.value = label;
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Text(label,
                              style: TextStyle(
                                  fontSize: 11.5,
                                  fontWeight: FontWeight.w600,
                                  color: fg)),
                        ),
                      ),
                      // 관제 설정 열기 — 고친 뒤 껐다 켜면 그 자리에서 다시 감시가 붙는다.
                      InkWell(
                        borderRadius: BorderRadius.circular(10),
                        onTap: () => showCrVanDialog(p),
                        child: Padding(
                          padding: const EdgeInsets.all(3),
                          child: Icon(Icons.credit_card, size: 13, color: fg),
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }

  // 디스크 주의 거래처 스트립 — 목록을 스크롤하지 않아도 위험 기기가 한눈에 보인다
  // (2026-07-16 Chang: 거래처 늘면 빨간불 찾으러 한참 스크롤하게 됨). 칩 클릭 =
  // 전체 거래처 탭 전환 + 검색 필터로 그 카드로 점프. 전체 거래처 모델 기준이라
  // 어느 탭에 있든 전 거래처의 경고를 다 보여준다.
  Widget _crDiskAlertStrip() {
    return ListenableBuilder(
      listenable: gFFI.allCustomersPeersModel,
      builder: (context, _) {
        final warns = gFFI.allCustomersPeersModel.peers
            .map((p) => (p, crDiskWarn(p)))
            .where((t) => t.$2 != null)
            .toList()
          ..sort((a, b) => a.$2!.freeGb.compareTo(b.$2!.freeGb));
        if (warns.isEmpty) return const SizedBox.shrink();
        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(right: 12, bottom: 4),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: CrColors.of(context).warnBannerBg,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: CrColors.of(context).warnBannerBorder),
          ),
          child: Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text('💾 디스크 주의 ${warns.length}곳',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: CrColors.of(context).warnBannerFg)),
              ...warns.map((t) {
                final p = t.$1;
                final w = t.$2!;
                // Rust 가 별칭 앞에 붙이는 상태 마커(⏳/🆕)는 검색 필터에 안 맞으니 벗긴다.
                final name = p.alias
                    .replaceFirst('⏳ ', '')
                    .replaceFirst('🆕 ', '')
                    .trim();
                final label = name.isEmpty ? p.id : name;
                final fg = w.red ? CrColors.of(context).dangerFg : CrColors.of(context).warnFg;
                return Container(
                  padding: const EdgeInsets.only(left: 8, right: 4),
                  decoration: BoxDecoration(
                    color: w.red
                        ? CrColors.of(context).dangerBg
                        : CrColors.of(context).warnBannerBg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                        color: w.red
                            ? CrColors.of(context).dangerBorder
                            : CrColors.of(context).warnBannerBorder),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      InkWell(
                        onTap: () {
                          // 카드로 점프: 전체 거래처 탭 + 검색 필터. ★검색창을 강제로 펼쳐
                          // 필터가 눈에 보이고 X 로 지울 수 있게 한다(숨은 필터 함정 방지).
                          gFFI.peerTabModel
                              .setCurrentTab(PeerTabIndex.customers.index);
                          peerSearchBarOpen.value = true;
                          peerSearchTextController.text = label;
                          peerSearchText.value = label;
                        },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Text(
                            '$label ${w.freeGb.toStringAsFixed(1)}GB'
                            '${w.tempGb != null ? " · Temp ${w.tempGb!.toStringAsFixed(1)}GB" : ""}',
                            style: TextStyle(
                                fontSize: 11.5,
                                fontWeight: FontWeight.w600,
                                color: fg),
                          ),
                        ),
                      ),
                      // 🧹 원격 정리 — 패널 [정리] 버튼과 동일 동작(HQ 가 주 화면이라 여기에도).
                      InkWell(
                        borderRadius: BorderRadius.circular(10),
                        onTap: () => showCrDiskCleanupDialog(p),
                        child: Padding(
                          padding: const EdgeInsets.all(3),
                          child: Icon(Icons.cleaning_services_rounded,
                              size: 13, color: fg),
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }

  Widget _createSwitchBar(BuildContext context) {
    final model = Provider.of<PeerTabModel>(context);
    // 뉴모 세그먼트 컨트롤 (2026-06-06 재스킨).
    // 들어간(inset) 트랙 위에, 활성 탭만 솟은(raised) 표면 + 남색 글자로 표시한다.
    //
    // 창을 좁히면 탭 묶음이 오른쪽 아이콘들 위로 밀고 올라오던 문제(2026-07-23) —
    // Expanded 안에서 Row 가 안 줄어들어 제 칸을 넘겨 그렸다. 폭에 따라 좌우 여백을
    // 줄이고, 더 좁으면 글자를 떼어 아이콘만 남기고, 그래도 모자라면 가로 스크롤로
    // 넘겨 어떤 폭에서도 겹치지 않게 한다.
    return LayoutBuilder(builder: (context, box) {
      final tight = box.maxWidth < 430;
      final showLabel = box.maxWidth >= 330;
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: CrColors.of(context).neuInset,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: model.visibleEnabledOrderedIndexs.map((t) {
          final selected = model.currentTab == t;
          final fg = selected ? CrColors.of(context).neuBlueInk : CrColors.of(context).tabIdle;
          return GestureDetector(
            key: ValueKey(t),
            behavior: HitTestBehavior.opaque,
            onTap: isOptionFixed(kOptionPeerTabIndex)
                ? null
                : () async {
                    await handleTabSelection(t);
                    await bind.setLocalFlutterOption(
                        k: kOptionPeerTabIndex, v: t.toString());
                  },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: EdgeInsets.symmetric(
                  horizontal: tight ? 9 : 15, vertical: 8),
              decoration: BoxDecoration(
                color: selected ? CrColors.of(context).neuSurface : Colors.transparent,
                borderRadius: BorderRadius.circular(9),
                boxShadow: selected
                    ? [
                        BoxShadow(
                            color: CrColors.of(context).neuShadowDark,
                            offset: const Offset(3, 3),
                            blurRadius: 7),
                        BoxShadow(
                            color: CrColors.of(context).neuShadowLight,
                            offset: const Offset(-3, -3),
                            blurRadius: 6),
                      ]
                    : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Icon(model.tabIcon(t), color: fg, size: 16),
                  if (showLabel) ...[
                    const SizedBox(width: 7),
                    Text(
                      model.tabTooltip(t),
                      style: TextStyle(
                        color: fg,
                        fontSize: 13.5,
                        fontWeight:
                            selected ? FontWeight.w800 : FontWeight.w700,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        }).toList(),
      ),
    ));
    });
  }

  Widget _createPeersView() {
    final model = Provider.of<PeerTabModel>(context);
    Widget child;
    if (model.visibleEnabledOrderedIndexs.isEmpty) {
      child = visibleContextMenuListener(Row(
        children: [Expanded(child: InkWell())],
      ));
    } else {
      if (model.visibleEnabledOrderedIndexs.contains(model.currentTab)) {
        child = entries[model.currentTab].widget;
      } else {
        debugPrint("should not happen! currentTab not in visibleIndexs");
        Future.delayed(Duration.zero, () {
          model.setCurrentTab(model.visibleEnabledOrderedIndexs[0]);
        });
        child = entries[0].widget;
      }
    }
    return Expanded(
        child: child.marginSymmetric(
            vertical: (isDesktop || isWebDesktop) ? 12.0 : 6.0));
  }

  Widget _createRefresh(
      {required PeerTabIndex index, RxBool? loading}) {
    final model = Provider.of<PeerTabModel>(context);
    final textColor = Theme.of(context).textTheme.titleLarge?.color;
    return Offstage(
      offstage: model.currentTab != index.index,
      child: Tooltip(
        message: translate('Refresh'),
        child: RefreshWidget(
            onPressed: () {
              // 패널에서 바꾼 거래처명/즐겨찾기를 즉시 반영하려고 매핑과 즐겨찾기를 on-demand 로
              // 재요청한다 (자동 폴링을 쓰지 않아 50대리점 idle 트래픽을 막는다). chainremoteLoadCustomers
              // 가 매핑 갱신 후 최근세션을 재푸시(chainremote_data.rs)하므로 최근세션 탭 이름도 갱신된다.
              bind.chainremoteLoadCustomers();
              bind.chainremoteLoadFavorites();
              if (gFFI.peerTabModel.currentTab < entries.length) {
                entries[gFFI.peerTabModel.currentTab].load?.call();
              }
            },
            spinning: loading,
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              RotatedBox(
                  quarterTurns: 2,
                  child: Icon(
                    Icons.refresh,
                    size: 18,
                    color: textColor,
                  )),
              const SizedBox(width: 3),
              // 아이콘만으론 뭔지 모른다(2026-07-16 Chang) — 검색/보기/정렬과 같은 라벨 스타일.
              Text('새로고침',
                  style: TextStyle(
                      fontSize: 12, color: Theme.of(context).hintColor)),
            ])),
      ),
    );
  }

  // [보기] 전환은 없앴다(2026-08-11) — 데스크톱 목록은 표 하나다.
  //   배치가 셋이면 필드를 하나 추가할 때마다 세 곳을 고쳐야 했고(같은 날 배지 하나에 네 번
  //   빌드했다), 정작 세 배치 어디서도 관제를 훑어볼 수가 없었다. 열이 고정된 표가 거래처가
  //   수백 곳이 될 때 유일하게 버티는 배치다. 자세한 근거는 peer_card.dart "거래처 표" 주석.
  //   PeerViewDropdown 은 상류(RustDesk) 코드라 남겨 두되 어디서도 안 쓴다 — 머지 때 충돌을
  //   줄이려는 것이고, 되살리려면 툴바에 다시 끼우기만 하면 된다.

  // 전체 지원기록(A/S 이력) 타임라인 열기 — 전 직원·전 거래처, 최신순. 읽기 전용이라 무해.
  Widget _createSupportHistory(BuildContext context) {
    final textColor = Theme.of(context).textTheme.titleLarge?.color;
    return _hoverAction(
      context: context,
      toolTip: '지원 기록',
      onTap: () => showCrHistoryDialog(context),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.history, size: 18, color: textColor),
        const SizedBox(width: 3),
        Text('지원 기록',
            style:
                TextStyle(fontSize: 12, color: Theme.of(context).hintColor)),
      ]),
    );
  }

  // 연결 경로 점검(마이그043) — 거래처를 한 바퀴 돌며 연결만 해 보고 끊어 직결/경유를 가린다.
  //
  // ★플랫폼 운영자에게만 보인다. 대리점이 보면 "이게 뭐냐"부터 묻는 물건이고(같은 이유로
  //   [공유기 포트 열기] 우클릭 메뉴를 뺐다), 실제로 이건 우리 엔지니어링 도구다.
  //   거래처 화면엔 아무것도 안 뜬다 — 수락 카드는 로그인 요청을 받아야 뜨는데 그 전에 끊는다.
  Widget _createProbe(BuildContext context) {
    final textColor = Theme.of(context).textTheme.titleLarge?.color;
    return _hoverAction(
      context: context,
      toolTip: '거래처마다 연결만 해 보고 끊어 직결/서버경유를 가립니다 (거래처 화면엔 안 뜸)',
      onTap: () async {
        showToast('경로 점검을 시작합니다 — 거래처 수에 따라 몇 분 걸립니다.');
        // FFI 가 내부에서 별도 thread 를 쓰지만 호출 자체는 블로킹이라 UI 가 멎는다.
        //   compute 대신 짧은 지연 뒤 호출해 토스트가 먼저 그려지게 한다.
        await Future.delayed(const Duration(milliseconds: 300));
        final summary = bind.chainremoteProbeRoutes();
        showToast(summary);
      },
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.network_check, size: 18, color: textColor),
        const SizedBox(width: 3),
        Text('경로 점검',
            style:
                TextStyle(fontSize: 12, color: Theme.of(context).hintColor)),
      ]),
    );
  }

  // 새 폴더 — 검색 오른쪽. 클릭하면 목록 보기 루트로 가서 최상단에 이름 편집 타일을 띄운다.
  Widget _createNewFolder(BuildContext context) {
    final textColor = Theme.of(context).textTheme.titleLarge?.color;
    return _hoverAction(
      context: context,
      toolTip: '새 폴더',
      onTap: crStartNewFolder,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.create_new_folder_outlined, size: 18, color: textColor),
        const SizedBox(width: 3),
        Text('새 폴더',
            style: TextStyle(fontSize: 12, color: Theme.of(context).hintColor)),
      ]),
    );
  }

  Widget _createMultiSelection() {
    final textColor = Theme.of(context).textTheme.titleLarge?.color;
    final model = Provider.of<PeerTabModel>(context);
    return _hoverAction(
      toolTip: translate('Select'),
      context: context,
      onTap: () {
        model.setMultiSelectionMode(true);
        if (isMobile && Navigator.canPop(context)) {
          Navigator.pop(context);
        }
      },
      child: SvgPicture.asset(
        "assets/checkbox-outline.svg",
        width: 18,
        height: 18,
        colorFilter: svgColor(textColor),
      ),
    );
  }

  void mobileShowTabVisibilityMenu() {
    final model = gFFI.peerTabModel;
    final items = List<PopupMenuItem>.empty(growable: true);
    for (int i = 0; i < PeerTabModel.maxTabCount; i++) {
      if (!model.isEnabled[i]) continue;
      items.add(PopupMenuItem(
        height: kMinInteractiveDimension * 0.8,
        onTap: isOptVisiableFixed
            ? null
            : () => model.setTabVisible(i, !model.isVisibleEnabled[i]),
        enabled: !isOptVisiableFixed,
        child: Row(
          children: [
            Checkbox(
                value: model.isVisibleEnabled[i],
                onChanged: isOptVisiableFixed
                    ? null
                    : (_) {
                        model.setTabVisible(i, !model.isVisibleEnabled[i]);
                        if (Navigator.canPop(context)) {
                          Navigator.pop(context);
                        }
                      }),
            Expanded(child: Text(model.tabTooltip(i))),
          ],
        ),
      ));
    }
    if (mobileTabContextMenuPos != null) {
      showMenu(
          context: context, position: mobileTabContextMenuPos!, items: items);
    }
  }

  Widget visibleContextMenuListener(Widget child) {
    if (!(isDesktop || isWebDesktop)) {
      return GestureDetector(
        onLongPressDown: (e) {
          final x = e.globalPosition.dx;
          final y = e.globalPosition.dy;
          mobileTabContextMenuPos = RelativeRect.fromLTRB(x, y, x, y);
        },
        onLongPressUp: () {
          mobileShowTabVisibilityMenu();
        },
        child: child,
      );
    } else {
      return Listener(
          onPointerDown: (e) {
            if (e.kind != ui.PointerDeviceKind.mouse) {
              return;
            }
            if (e.buttons == 2) {
              showRightMenu(
                (CancelFunc cancelFunc) {
                  return visibleContextMenu(cancelFunc);
                },
                target: e.position,
              );
            }
          },
          child: child);
    }
  }

  Widget visibleContextMenu(CancelFunc cancelFunc) {
    final model = Provider.of<PeerTabModel>(context);
    final menu = List<MenuEntrySwitchSync>.empty(growable: true);
    for (int i = 0; i < model.orders.length; i++) {
      int tabIndex = model.orders[i];
      if (tabIndex < 0 || tabIndex >= PeerTabModel.maxTabCount) continue;
      if (!model.isEnabled[tabIndex]) continue;
      menu.add(MenuEntrySwitchSync(
          switchType: SwitchType.scheckbox,
          text: model.tabTooltip(tabIndex),
          currentValue: model.isVisibleEnabled[tabIndex],
          setter: (show) async {
            model.setTabVisible(tabIndex, show);
            // Do not hide the current menu (checkbox)
            // cancelFunc();
          },
          enabled: (!isOptVisiableFixed).obs));
    }
    return mod_menu.PopupMenu(
        items: menu
            .map((entry) => entry.build(
                context,
                const MenuConfig(
                  commonColor: MyTheme.accent,
                  height: 20.0,
                  dividerHeight: 12.0,
                )))
            .expand((i) => i)
            .toList());
  }

  Widget createMultiSelectionBar(PeerTabModel model) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Offstage(
          offstage: model.selectedPeers.isEmpty,
          child: Row(
            children: [
              deleteSelection(),
              addSelectionToFav(),
              addSelectionToAb(),
              editSelectionTags(),
            ],
          ),
        ),
        Row(
          children: [
            selectionCount(model.selectedPeers.length),
            selectAll(model),
            closeSelection(),
          ],
        )
      ],
    );
  }

  Widget deleteSelection() {
    final model = Provider.of<PeerTabModel>(context);
    if (model.currentTab == PeerTabIndex.group.index) {
      return Offstage();
    }
    return _hoverAction(
        context: context,
        toolTip: translate('Delete'),
        onTap: () {
          onSubmit() async {
            final peers = model.selectedPeers;
            switch (model.currentTab) {
              case 0:
                for (var p in peers) {
                  await bind.mainRemovePeer(id: p.id);
                }
                // 최근 세션은 네이티브 최근 접속 기록을 사용한다.
                bind.mainLoadRecentPeers();
                break;
              case 1:
                // user_favorites DB (Phase 2-D).
                for (var p in peers) {
                  bind.chainremoteRemoveFavorite(remoteId: p.id);
                }
                bind.chainremoteLoadFavorites();
                break;
              case 2:
                for (var p in peers) {
                  await bind.mainRemoveDiscovered(id: p.id);
                }
                bind.mainLoadLanPeers();
                break;
              case 3:
                await gFFI.abModel.deletePeers(peers.map((p) => p.id).toList());
                break;
              default:
                break;
            }
            gFFI.peerTabModel.setMultiSelectionMode(false);
            if (model.currentTab != 3) showToast(translate('Successful'));
          }

          deleteConfirmDialog(onSubmit, translate('Delete'));
        },
        child: Icon(Icons.delete, color: Colors.red));
  }

  Widget addSelectionToFav() {
    final model = Provider.of<PeerTabModel>(context);
    return Offstage(
      offstage:
          model.currentTab != PeerTabIndex.recent.index, // show based on recent
      child: _hoverAction(
        context: context,
        toolTip: translate('Add to Favorites'),
        onTap: () async {
          final peers = model.selectedPeers;
          // user_favorites DB (Phase 2-D).
          for (var p in peers) {
            bind.chainremoteAddFavorite(remoteId: p.id);
          }
          model.setMultiSelectionMode(false);
          showToast(translate('Successful'));
        },
        child: Icon(PeerTabModel.icons[PeerTabIndex.fav.index]),
      ).marginOnly(left: !(isDesktop || isWebDesktop) ? 11 : 6),
    );
  }

  Widget addSelectionToAb() {
    final model = Provider.of<PeerTabModel>(context);
    final addressbooks = gFFI.abModel.addressBooksCanWrite();
    if (model.currentTab == PeerTabIndex.ab.index) {
      addressbooks.remove(gFFI.abModel.currentName.value);
    }
    return Offstage(
      offstage: !gFFI.userModel.isLogin || addressbooks.isEmpty,
      child: _hoverAction(
        context: context,
        toolTip: translate('Add to address book'),
        onTap: () {
          final peers = model.selectedPeers.map((e) => Peer.copy(e)).toList();
          addPeersToAbDialog(peers);
          model.setMultiSelectionMode(false);
        },
        child: Icon(PeerTabModel.icons[PeerTabIndex.ab.index]),
      ).marginOnly(left: !(isDesktop || isWebDesktop) ? 11 : 6),
    );
  }

  Widget editSelectionTags() {
    final model = Provider.of<PeerTabModel>(context);
    return Offstage(
      offstage: !gFFI.userModel.isLogin ||
          model.currentTab != PeerTabIndex.ab.index ||
          gFFI.abModel.currentAbTags.isEmpty,
      child: _hoverAction(
              context: context,
              toolTip: translate('Edit Tag'),
              onTap: () {
                editAbTagDialog(List.empty(), (selectedTags) async {
                  final peers = model.selectedPeers;
                  await gFFI.abModel.changeTagForPeers(
                      peers.map((p) => p.id).toList(), selectedTags);
                  model.setMultiSelectionMode(false);
                  showToast(translate('Successful'));
                });
              },
              child: Icon(Icons.tag))
          .marginOnly(left: !(isDesktop || isWebDesktop) ? 11 : 6),
    );
  }

  Widget selectionCount(int count) {
    return Align(
      alignment: Alignment.center,
      child: Text('$count ${translate('Selected')}'),
    );
  }

  Widget selectAll(PeerTabModel model) {
    return Offstage(
      offstage:
          model.selectedPeers.length >= model.currentTabCachedPeers.length,
      child: _hoverAction(
        context: context,
        toolTip: translate('Select All'),
        onTap: () {
          model.selectAll();
        },
        child: Icon(Icons.select_all),
      ).marginOnly(left: 6),
    );
  }

  Widget closeSelection() {
    final model = Provider.of<PeerTabModel>(context);
    return _hoverAction(
            context: context,
            toolTip: translate('Close'),
            onTap: () {
              model.setMultiSelectionMode(false);
            },
            child: Icon(Icons.clear))
        .marginOnly(left: 6);
  }

  Widget _toggleTags() {
    return _hoverAction(
        context: context,
        toolTip: translate('Toggle Tags'),
        hoverableWhenfalse: hideAbTagsPanel,
        child: Icon(
          Icons.tag_rounded,
          size: 18,
        ),
        onTap: () async {
          await bind.mainSetLocalOption(
              key: kOptionHideAbTagsPanel,
              value: hideAbTagsPanel.value ? defaultOptionNo : "Y");
          hideAbTagsPanel.value = !hideAbTagsPanel.value;
        });
  }

  List<Widget> _landscapeRightActions(BuildContext context) {
    final model = Provider.of<PeerTabModel>(context);
    // 검색 / 새로고침 / 보기 / 정렬. (AB·장치 탭 비활성이라 태그·다중선택은 뺐다.)
    // 새로고침은 재로그인 없이 패널 목록을 다시 받아온다 — 신규 등록 거래처가 바로 내려온다.
    return [
      const PeerSearchBar().marginOnly(right: 13),
      // 새 폴더 — 폴더가 동작하는 즐겨찾기·전체거래처 탭에서만.
      if (model.currentTab == PeerTabIndex.fav.index ||
          model.currentTab == PeerTabIndex.customers.index)
        _createNewFolder(context).marginOnly(right: 4),
      if (model.currentTab == PeerTabIndex.recent.index)
        _createRefresh(index: PeerTabIndex.recent).marginOnly(right: 4),
      if (model.currentTab == PeerTabIndex.fav.index)
        _createRefresh(index: PeerTabIndex.fav).marginOnly(right: 4),
      if (model.currentTab == PeerTabIndex.customers.index)
        _createRefresh(index: PeerTabIndex.customers).marginOnly(right: 4),
      _createSupportHistory(context).marginOnly(right: 4),
      if (ChainRemoteAuth.currentRole() == 'super_admin')
        _createProbe(context).marginOnly(right: 4),
      // [정렬] 드롭다운은 뺐다(2026-08-11) — 표 머리글을 누르면 그 열로 정렬한다.
      //   둘 다 두면 진실 원천이 갈려, 메뉴로 골랐는데 머리글 화살표는 딴 곳을 가리킨다.
    ];
  }

  List<Widget> _portraitRightActions(BuildContext context) {
    final model = Provider.of<PeerTabModel>(context);
    final screenWidth = MediaQuery.of(context).size.width;
    final leftIconSize = Theme.of(context).iconTheme.size ?? 24;
    final leftActionsSize =
        (leftIconSize + (4 + 4) * 2) * model.visibleEnabledOrderedIndexs.length;
    final availableWidth = screenWidth - 10 * 2 - leftActionsSize - 2 * 2;
    final searchWidth = 120;
    final otherActionWidth = 18 + 10;

    dropDown(List<Widget> menus) {
      final padding = 6.0;
      final textColor = Theme.of(context).textTheme.titleLarge?.color;
      return PullDownButton(
        buttonBuilder:
            (BuildContext context, Future<void> Function() showMenu) {
          return _hoverAction(
            context: context,
            toolTip: translate('More'),
            child: SvgPicture.asset(
              "assets/chevron_up_chevron_down.svg",
              width: 18,
              height: 18,
              colorFilter: svgColor(textColor),
            ),
            onTap: showMenu,
          );
        },
        routeTheme: PullDownMenuRouteTheme(
            width: menus.length * (otherActionWidth + padding * 2) * 1.0),
        itemBuilder: (context) => [
          PullDownMenuEntryImpl(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: menus
                  .map((e) =>
                      Material(child: e.paddingSymmetric(horizontal: padding)))
                  .toList(),
            ),
          )
        ],
      );
    }

    // Always show search, refresh
    List<Widget> actions = [
      const PeerSearchBar(),
      if (model.currentTab == PeerTabIndex.ab.index)
        _createRefresh(
            index: PeerTabIndex.ab, loading: gFFI.abModel.currentAbLoading),
      if (model.currentTab == PeerTabIndex.group.index)
        _createRefresh(
            index: PeerTabIndex.group, loading: gFFI.groupModel.groupLoading),
      // 최근/즐겨찾기 탭 새로고침. 패널의 거래처명/즐겨찾기를 on-demand 로 재동기화한다.
      // HQ 는 AB/Group 탭이 비활성이라 위 두 분기는 뜨지 않으므로, 실제 쓰는 두 탭에 마운트한다.
      // onPressed 는 chainremoteLoadCustomers(매핑 갱신+최근세션 재푸시)와 LoadFavorites 를 호출한다.
      if (model.currentTab == PeerTabIndex.recent.index)
        _createRefresh(index: PeerTabIndex.recent),
      if (model.currentTab == PeerTabIndex.fav.index)
        _createRefresh(index: PeerTabIndex.fav),
      // 전체 거래처 새로고침. chainremoteLoadCustomers 를 재요청한다 (onPressed 공통).
      if (model.currentTab == PeerTabIndex.customers.index)
        _createRefresh(index: PeerTabIndex.customers),
    ];
    // 다중선택/태그토글은 거래처 운영에 불필요해 제거했다.
    // ★가로(데스크톱/태블릿)에만 있던 항목을 세로(폰)에도 올린다 — 폰으로 지원하는 직원이
    //   폴더를 만들지도, 열지도, 전체 지원기록을 보지도 못했다. 공간이 모자라면 아래 로직이
    //   자동으로 '더보기' 드롭다운에 접어 넣으므로 좁은 화면에서도 안전하다.
    final List<Widget> dynamicActions = [
      // 새 폴더 — 폴더가 동작하는 즐겨찾기·전체거래처 탭에서만(가로와 동일 조건).
      if (model.currentTab == PeerTabIndex.fav.index ||
          model.currentTab == PeerTabIndex.customers.index)
        _createNewFolder(context),
      _createSupportHistory(context),
      if (ChainRemoteAuth.currentRole() == 'super_admin') _createProbe(context),
      // 세로(모바일)는 표가 아니라 카드라 머리글이 없다 — 정렬 메뉴를 여기만 남긴다.
      if (model.currentTab != PeerTabIndex.recent.index) PeerSortDropdown(),
    ];
    final rightWidth = availableWidth -
        searchWidth -
        (actions.length == 2 ? otherActionWidth : 0);
    final availablePositions = rightWidth ~/ otherActionWidth;

    if (availablePositions < dynamicActions.length &&
        dynamicActions.length > 1) {
      if (availablePositions < 2) {
        actions.addAll([
          dropDown(dynamicActions),
        ]);
      } else {
        actions.addAll([
          ...dynamicActions.sublist(0, availablePositions - 1),
          dropDown(dynamicActions.sublist(availablePositions - 1)),
        ]);
      }
    } else {
      actions.addAll(dynamicActions);
    }
    return actions;
  }
}

class PeerSearchBar extends StatefulWidget {
  const PeerSearchBar({Key? key}) : super(key: key);

  @override
  State<StatefulWidget> createState() => _PeerSearchBarState();
}

class _PeerSearchBarState extends State<PeerSearchBar> {
  @override
  Widget build(BuildContext context) {
    // 펼침 상태는 전역(peerSearchBarOpen) — 디스크 스트립 점프가 필터를 걸며 강제로 펼친다.
    return Obx(() => peerSearchBarOpen.value
        ? _buildSearchBar()
        : _hoverAction(
            context: context,
            toolTip: translate('Search'),
            padding: const EdgeInsets.only(right: 2),
            onTap: () {
              peerSearchBarOpen.value = true;
            },
            // 아이콘 + "검색" 라벨.
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.search_rounded,
                  size: 18, color: Theme.of(context).hintColor),
              const SizedBox(width: 4),
              Text('검색',
                  style: TextStyle(
                      fontSize: 12, color: Theme.of(context).hintColor)),
            ])));
  }

  Widget _buildSearchBar() {
    RxBool focused = false.obs;
    FocusNode focusNode = FocusNode();
    focusNode.addListener(() {
      focused.value = focusNode.hasFocus;
      peerSearchTextController.selection = TextSelection(
          baseOffset: 0,
          extentOffset: peerSearchTextController.value.text.length);
    });
    return Obx(() => Container(
          width: stateGlobal.isPortrait.isTrue ? 120 : 140,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.background,
            borderRadius: BorderRadius.circular(6),
          ),
          child: Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Icon(
                      Icons.search_rounded,
                      color: Theme.of(context).hintColor,
                    ).marginSymmetric(horizontal: 4),
                    Expanded(
                      child: TextField(
                        autofocus: true,
                        controller: peerSearchTextController,
                        onChanged: (searchText) {
                          peerSearchText.value = searchText;
                          // 이스터에그: 검색창에 gogo — Chang 의 WoL 명령어 오마주.
                          //   로켓이 날아가 거래처 포스에 닿고 폭죽이 터진다.
                          //   gogo2 는 연말결산 미리보기(12월까지 못 기다리므로).
                          final t = searchText.trim().toLowerCase();
                          if (t == 'gogo' || t == 'gogo2') {
                            peerSearchTextController.clear();
                            peerSearchText.value = '';
                            if (t == 'gogo') {
                              showCrRocket(context);
                            } else {
                              showCrYearEndPreview(context);
                            }
                          }
                        },
                        focusNode: focusNode,
                        textAlign: TextAlign.start,
                        maxLines: 1,
                        cursorColor: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.color
                            ?.withOpacity(0.5),
                        cursorHeight: 18,
                        cursorWidth: 1,
                        style: const TextStyle(fontSize: 14),
                        decoration: InputDecoration(
                          contentPadding:
                              const EdgeInsets.symmetric(vertical: 6),
                          hintText:
                              focused.value ? null : translate("Search ID"),
                          hintStyle: TextStyle(
                              fontSize: 14, color: Theme.of(context).hintColor),
                          border: InputBorder.none,
                          isDense: true,
                        ),
                      ).workaroundFreezeLinuxMint(),
                    ),
                    // Icon(Icons.close),
                    IconButton(
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: 2),
                      onPressed: () {
                        peerSearchTextController.clear();
                        peerSearchText.value = "";
                        peerSearchBarOpen.value = false;
                      },
                      icon: Tooltip(
                          message: translate('Close'),
                          child: Icon(
                            Icons.close,
                            color: Theme.of(context).hintColor,
                          )),
                    ),
                  ],
                ),
              )
            ],
          ),
        ));
  }
}

class PeerViewDropdown extends StatefulWidget {
  const PeerViewDropdown({super.key});

  @override
  State<PeerViewDropdown> createState() => _PeerViewDropdownState();
}

class _PeerViewDropdownState extends State<PeerViewDropdown> {
  @override
  Widget build(BuildContext context) {
    final List<PeerUiType> types = [
      PeerUiType.grid,
      PeerUiType.tile,
      PeerUiType.list
    ];
    final style = TextStyle(
        color: Theme.of(context).textTheme.titleLarge?.color,
        fontSize: MenuConfig.fontSize,
        fontWeight: FontWeight.normal);
    List<PopupMenuEntry> items = List.empty(growable: true);
    items.add(PopupMenuItem(
        height: 36,
        enabled: false,
        child: Text(translate("Change view"), style: style)));
    for (var e in PeerUiType.values) {
      items.add(PopupMenuItem(
          height: 36,
          child: Obx(() => Center(
                child: SizedBox(
                  height: 36,
                  child: getRadio<PeerUiType>(
                      // 아이콘 + 한글 라벨.
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            e == PeerUiType.grid
                                ? Icons.grid_view_rounded
                                : e == PeerUiType.list
                                    ? Icons.view_list_rounded
                                    : Icons.view_agenda_rounded,
                            size: 18,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            e == PeerUiType.grid
                                ? '큰 카드'
                                : e == PeerUiType.tile
                                    ? '작은 카드'
                                    : '리스트 (그룹화 가능)',
                            style: const TextStyle(fontSize: 13),
                          ),
                        ],
                      ),
                      e,
                      peerCardUiType.value,
                      dense: true,
                      isOptionFixed(kOptionPeerCardUiType)
                          ? null
                          : (PeerUiType? v) async {
                              if (v != null) {
                                peerCardUiType.value = v;
                                setState(() {});
                                await bind.setLocalFlutterOption(
                                  k: kOptionPeerCardUiType,
                                  v: peerCardUiType.value.index.toString(),
                                );
                                if (Navigator.canPop(context)) {
                                  Navigator.pop(context);
                                }
                              }
                            }),
                ),
              ))));
    }

    var menuPos = RelativeRect.fromLTRB(0, 0, 0, 0);
    return _hoverAction(
        context: context,
        toolTip: translate('Change view'),
        // 아이콘 + "보기" 라벨.
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(
            peerCardUiType.value == PeerUiType.grid
                ? Icons.grid_view_rounded
                : peerCardUiType.value == PeerUiType.list
                    ? Icons.view_list_rounded
                    : Icons.view_agenda_rounded,
            size: 18,
          ),
          const SizedBox(width: 4),
          const Text('보기', style: TextStyle(fontSize: 12)),
        ]),
        onTapDown: (details) {
          final x = details.globalPosition.dx;
          final y = details.globalPosition.dy;
          menuPos = RelativeRect.fromLTRB(x, y, x, y);
        },
        onTap: () => showMenu(
              context: context,
              position: menuPos,
              items: items,
              elevation: 8,
            ));
  }
}

class PeerSortDropdown extends StatefulWidget {
  const PeerSortDropdown({super.key});

  @override
  State<PeerSortDropdown> createState() => _PeerSortDropdownState();
}

class _PeerSortDropdownState extends State<PeerSortDropdown> {
  _PeerSortDropdownState() {
    if (!PeerSortType.values.contains(peerSort.value)) {
      _loadLocalOptions();
    }
  }

  void _loadLocalOptions() {
    peerSort.value = PeerSortType.remoteId;
    bind.setLocalFlutterOption(
      k: kOptionPeerSorting,
      v: peerSort.value,
    );
  }

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
        color: Theme.of(context).textTheme.titleLarge?.color,
        fontSize: MenuConfig.fontSize,
        fontWeight: FontWeight.normal);
    List<PopupMenuEntry> items = List.empty(growable: true);
    items.add(PopupMenuItem(
        height: 36,
        enabled: false,
        child: Text(translate("Sort by"), style: style)));
    for (var e in PeerSortType.values) {
      items.add(PopupMenuItem(
          height: 36,
          child: Obx(() => Center(
                child: SizedBox(
                  height: 36,
                  child: getRadio(
                      Text(translate(e), style: style), e, peerSort.value,
                      dense: true, (String? v) async {
                    if (v != null) {
                      peerSort.value = v;
                      await bind.setLocalFlutterOption(
                        k: kOptionPeerSorting,
                        v: peerSort.value,
                      );
                    }
                  }),
                ),
              ))));
    }

    var menuPos = RelativeRect.fromLTRB(0, 0, 0, 0);
    return _hoverAction(
      context: context,
      toolTip: translate('Sort by'),
      // 아이콘 + "정렬" 라벨.
      child: Row(mainAxisSize: MainAxisSize.min, children: const [
        Icon(Icons.sort_rounded, size: 18),
        SizedBox(width: 4),
        Text('정렬', style: TextStyle(fontSize: 12)),
      ]),
      onTapDown: (details) {
        final x = details.globalPosition.dx;
        final y = details.globalPosition.dy;
        menuPos = RelativeRect.fromLTRB(x, y, x, y);
      },
      onTap: () => showMenu(
        context: context,
        position: menuPos,
        items: items,
        elevation: 8,
      ),
    );
  }
}

class RefreshWidget extends StatefulWidget {
  final VoidCallback onPressed;
  final Widget child;
  final RxBool? spinning;
  const RefreshWidget(
      {super.key, required this.onPressed, required this.child, this.spinning});

  @override
  State<RefreshWidget> createState() => RefreshWidgetState();
}

class RefreshWidgetState extends State<RefreshWidget> {
  double turns = 0.0;
  bool hover = false;

  @override
  void initState() {
    super.initState();
    widget.spinning?.listen((v) {
      if (v && mounted) {
        setState(() {
          turns += 1;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final deco = BoxDecoration(
      color: Theme.of(context).colorScheme.background,
      borderRadius: BorderRadius.circular(6),
    );
    return AnimatedRotation(
        turns: turns,
        duration: const Duration(milliseconds: 200),
        onEnd: () {
          if (widget.spinning?.value == true && mounted) {
            setState(() => turns += 1.0);
          }
        },
        child: Container(
          padding: EdgeInsets.all(4.0),
          margin: EdgeInsets.symmetric(horizontal: 1),
          decoration: hover ? deco : null,
          child: InkWell(
              onTap: () {
                if (mounted) setState(() => turns += 1.0);
                widget.onPressed();
              },
              onHover: (value) {
                if (mounted) {
                  setState(() {
                    hover = value;
                  });
                }
              },
              child: widget.child),
        ));
  }
}

Widget _hoverAction(
    {required BuildContext context,
    required Widget child,
    required Function() onTap,
    required String toolTip,
    GestureTapDownCallback? onTapDown,
    RxBool? hoverableWhenfalse,
    EdgeInsetsGeometry padding = const EdgeInsets.all(4.0)}) {
  final hover = false.obs;
  final deco = BoxDecoration(
    color: Theme.of(context).colorScheme.background,
    borderRadius: BorderRadius.circular(6),
  );
  return Tooltip(
    message: toolTip,
    child: Obx(
      () => Container(
          margin: EdgeInsets.symmetric(horizontal: 1),
          decoration:
              (hover.value || hoverableWhenfalse?.value == false) ? deco : null,
          child: InkWell(
              onHover: (value) => hover.value = value,
              onTap: onTap,
              onTapDown: onTapDown,
              child: Container(padding: padding, child: child))),
    ),
  );
}

class PullDownMenuEntryImpl extends StatelessWidget
    implements PullDownMenuEntry {
  final Widget child;
  const PullDownMenuEntryImpl({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return child;
  }
}
