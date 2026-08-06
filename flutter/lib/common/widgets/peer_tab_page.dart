import 'dart:async';
import 'dart:ui' as ui;

import 'package:bot_toast/bot_toast.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hbb/common/widgets/address_book.dart';
import 'package:flutter_hbb/common/widgets/dialog.dart';
import 'package:flutter_hbb/common/widgets/my_group.dart';
import 'package:flutter_hbb/common/widgets/peers_view.dart';
import 'package:flutter_hbb/common/widgets/chainremote_disk.dart';
import 'package:flutter_hbb/common/widgets/chainremote_history.dart';
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
        _crDiskAlertStrip(),
        _createPeersView(),
      ],
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

  Widget _createPeerViewTypeSwitch(BuildContext context) {
    return PeerViewDropdown();
  }

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
      _createPeerViewTypeSwitch(context),
      Offstage(
        offstage: model.currentTab == PeerTabIndex.recent.index,
        child: PeerSortDropdown(),
      ),
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
      // 보기 전환 — 폴더(탐색기식) 보기로 들어가는 유일한 입구라 세로에도 필수.
      _createPeerViewTypeSwitch(context),
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
