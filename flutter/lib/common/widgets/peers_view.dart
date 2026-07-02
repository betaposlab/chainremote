import 'dart:async';
import 'dart:collection';

import 'package:dynamic_layouts/dynamic_layouts.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/models/ab_model.dart';
import 'package:flutter_hbb/models/peer_tab_model.dart';
import 'package:flutter_hbb/models/state_model.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'package:window_manager/window_manager.dart';

import '../../common.dart';
import '../../models/peer_model.dart';
import '../../models/platform_model.dart';
import 'peer_card.dart';

typedef PeerFilter = bool Function(Peer peer);
typedef PeerCardBuilder = Widget Function(Peer peer);

class PeerSortType {
  static const String remoteId = 'Remote ID';
  static const String remoteHost = 'Remote Host';
  static const String username = 'Username';
  static const String status = 'Status';

  static List<String> values = [
    PeerSortType.remoteId,
    PeerSortType.remoteHost,
    PeerSortType.username,
    PeerSortType.status
  ];
}

class LoadEvent {
  static const String recent = 'load_recent_peers';
  static const String favorite = 'load_fav_peers';
  static const String lan = 'load_lan_peers';
  static const String addressBook = 'load_address_book_peers';
  static const String group = 'load_group_peers';
  // '전체 거래처' 탭. Rust fetch_customers_blocking 가 push 한다.
  static const String allCustomers = 'load_all_customers';
}

class PeersModelName {
  static const String recent = 'recent peer';
  static const String favorite = 'fav peer';
  static const String lan = 'discovered peer';
  static const String addressBook = 'address book peer';
  static const String group = 'group peer';
  static const String allCustomers = 'all customers peer';
}

// 이 기기 자신의 ID 캐시. 거래처 목록(최근/즐겨찾기/LAN)에서 자기 자신을 숨기는 데 쓴다.
// 집 윈컴처럼 HQ 빌드(뷰어)이면서 동시에 거래처로도 등록된 머신이, 자기 홈에서 자기 자신을
// 원격 대상으로 노출하는 무의미한 표시를 막는다. ID 는 세션 중 불변이고 Rust get_id() 가
// config 동기 읽기라, matchPeers(async) 안에서 한 번 await 캐시하면 첫 렌더부터 깜빡임 없이 가려진다.
// DB 는 건드리지 않는다. 즐겨찾기는 chang 계정에 그대로 남고, 가리기는 순전히 기기 로컬 동작이라
// 맥북에는 영향이 없다 (맥북은 자기 ID 가 달라 우리집이 그대로 보인다).
String _myOwnIdCache = '';

/// for peer search text, global obs value
final peerSearchText = "".obs;

/// for peer sort, global obs value
RxString? _peerSort;
RxString get peerSort {
  _peerSort ??= bind.getLocalFlutterOption(k: kOptionPeerSorting).obs;
  return _peerSort!;
}

// list for listener
RxList<RxString> get obslist => [peerSearchText, peerSort].obs;

final peerSearchTextController =
    TextEditingController(text: peerSearchText.value);

// 별칭 prefix 기반 거래처 그룹화.
// 운영 컨벤션상 별칭은 "거래처상호-기기명" 형식이다 (예: "ABC식당-메인", "ABC식당-오더1").
// '-' 앞부분이 같은 peer 들이 한 그룹으로 묶인다. 그룹별 펼침/접힘 상태는 전역 RxMap 에 둔다.
// 그룹원이 하나뿐이면 헤더 없이 평면으로 노출한다.
final peerGroupExpanded = <String, bool>{}.obs;

String? _groupKeyOf(Peer peer) {
  final name = peer.alias.isNotEmpty ? peer.alias : peer.hostname;
  if (name.isEmpty) return null;
  final dashIdx = name.indexOf('-');
  if (dashIdx <= 0) return null;
  final prefix = name.substring(0, dashIdx).trim();
  if (prefix.isEmpty) return null;
  return prefix;
}

class _PeerGroupHeader {
  final String prefix;
  final int count;
  _PeerGroupHeader(this.prefix, this.count);
}

// Groups peers by prefix. Returns flattened list of (_PeerGroupHeader | Peer)
// that respects ordering and current expand/collapse state.
List<Object> buildGroupedPeerItems(List<Peer> peers) {
  final groups = <String, List<Peer>>{};
  final ungrouped = <Peer>[];
  final order = <String>[]; // group keys in first-seen order
  for (final p in peers) {
    final k = _groupKeyOf(p);
    if (k == null) {
      ungrouped.add(p);
      continue;
    }
    if (!groups.containsKey(k)) {
      groups[k] = [];
      order.add(k);
    }
    groups[k]!.add(p);
  }
  final result = <Object>[];
  for (final k in order) {
    final list = groups[k]!;
    if (list.length == 1) {
      // Single-member group → show flat (no header).
      result.add(list.first);
      continue;
    }
    result.add(_PeerGroupHeader(k, list.length));
    final expanded = peerGroupExpanded[k] ?? true;
    if (expanded) result.addAll(list);
  }
  result.addAll(ungrouped);
  return result;
}

class _PeersView extends StatefulWidget {
  final Peers peers;
  final PeerFilter? peerFilter;
  final PeerCardBuilder peerCardBuilder;
  final PeerTabIndex peerTabIndex;

  const _PeersView(
      {required this.peers,
      required this.peerCardBuilder,
      required this.peerTabIndex,
      this.peerFilter,
      Key? key})
      : super(key: key);

  @override
  _PeersViewState createState() => _PeersViewState();
}

/// State for the peer widget.
class _PeersViewState extends State<_PeersView>
    with WindowListener, WidgetsBindingObserver {
  static const int _maxQueryCount = 3;
  final HashMap<String, String> _emptyMessages = HashMap.from({
    LoadEvent.recent: 'empty_recent_tip',
    LoadEvent.favorite: 'empty_favorite_tip',
    LoadEvent.lan: 'empty_lan_tip',
    LoadEvent.addressBook: 'empty_address_book_tip',
  });
  final space = (isDesktop || isWebDesktop) ? 12.0 : 8.0;
  final _curPeers = <String>{};
  var _lastChangeTime = DateTime.now();
  var _lastQueryPeers = <String>{};
  var _lastQueryTime = DateTime.now();
  var _lastWindowRestoreTime = DateTime.now();
  var _queryCount = 0;
  var _exit = false;
  bool _isActive = true;

  final _scrollController = ScrollController();

  _PeersViewState() {
    _startCheckOnlines();
  }

  @override
  void initState() {
    windowManager.addListener(this);
    WidgetsBinding.instance.addObserver(this);
    super.initState();
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    WidgetsBinding.instance.removeObserver(this);
    _exit = true;
    super.dispose();
  }

  @override
  void onWindowFocus() {
    _queryCount = 0;
    _isActive = true;
  }

  @override
  void onWindowBlur() {
    // We need this comparison because window restore (on Windows) also triggers `onWindowBlur()`.
    // Maybe it's a bug of the window manager, but the source code seems to be correct.
    //
    // Although `onWindowRestore()` is called after `onWindowBlur()` in my test,
    // we need the following comparison to ensure that `_isActive` is true in the end.
    if (isWindows &&
        DateTime.now().difference(_lastWindowRestoreTime) <
            const Duration(milliseconds: 300)) {
      return;
    }
    _queryCount = _maxQueryCount;
    _isActive = false;
  }

  @override
  void onWindowRestore() {
    // Window restore (on MacOS and Linux) also triggers `onWindowFocus()`.
    // But on Windows, it triggers `onWindowBlur()`, mybe it's a bug of the window manager.
    if (!isWindows) return;
    _queryCount = 0;
    _isActive = true;
    _lastWindowRestoreTime = DateTime.now();
  }

  @override
  void onWindowMinimize() {
    // Window minimize also triggers `onWindowBlur()`.
  }

  // This function is required for mobile.
  // `onWindowFocus` works fine for desktop.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (isDesktop || isWebDesktop) return;
    if (state == AppLifecycleState.resumed) {
      _isActive = true;
      _queryCount = 0;
    } else if (state == AppLifecycleState.inactive) {
      _isActive = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    // We should avoid too many rebuilds. MacOS(m1, 14.6.1) on Flutter 3.19.6.
    // Continious rebuilds of `ChangeNotifierProvider` will cause memory leak.
    // Simple demo can reproduce this issue.
    return ChangeNotifierProvider<Peers>.value(
      value: widget.peers,
      child: Consumer<Peers>(builder: (context, peers, child) {
        if (peers.peers.isEmpty) {
          gFFI.peerTabModel.setCurrentTabCachedPeers([]);
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.sentiment_very_dissatisfied_rounded,
                  color: Theme.of(context).tabBarTheme.labelColor,
                  size: 40,
                ).paddingOnly(bottom: 10),
                Text(
                  translate(
                    _emptyMessages[widget.peers.loadEvent] ?? 'Empty',
                  ),
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Theme.of(context).tabBarTheme.labelColor,
                  ),
                ),
              ],
            ),
          );
        } else {
          return _buildPeersView(peers);
        }
      }),
    );
  }

  onVisibilityChanged(VisibilityInfo info) {
    final peerId = _peerId((info.key as ValueKey).value);
    if (info.visibleFraction > 0.00001) {
      _curPeers.add(peerId);
    } else {
      _curPeers.remove(peerId);
    }
    _lastChangeTime = DateTime.now();
  }

  String _cardId(String id) => widget.peers.name + id;
  String _peerId(String cardId) => cardId.replaceAll(widget.peers.name, '');

  // 거래처 그룹 헤더 (펼침/접힘).
  Widget _buildGroupHeader(_PeerGroupHeader item) {
    final expanded = peerGroupExpanded[item.prefix] ?? true;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () {
          peerGroupExpanded[item.prefix] = !expanded;
          peerGroupExpanded.refresh();
        },
        child: Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFF1F4F8),
            borderRadius: BorderRadius.circular(8),
            border: Border(
                left: BorderSide(
                    color: const Color(0xFF1E5BFF), width: 3)),
          ),
          child: Row(
            children: [
              Icon(
                expanded
                    ? Icons.keyboard_arrow_down_rounded
                    : Icons.keyboard_arrow_right_rounded,
                size: 22,
                color: const Color(0xFF1E5BFF),
              ),
              const SizedBox(width: 4),
              Icon(Icons.business_rounded,
                  size: 16, color: const Color(0xFF1E5BFF)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  item.prefix,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF1E2B45),
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E5BFF).withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${item.count}대',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF1E5BFF),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPeersView(Peers peers) {
    final updateEvent = peers.event;
    final body = ObxValue<RxList>((filters) {
      return FutureBuilder<List<Peer>>(
        builder: (context, snapshot) {
          if (snapshot.hasData) {
            var peers = snapshot.data!;
            if (peers.length > 1000) peers = peers.sublist(0, 1000);
            gFFI.peerTabModel.setCurrentTabCachedPeers(peers);
            buildOnePeer(Peer peer, bool isPortrait) {
              final visibilityChild = VisibilityDetector(
                key: ValueKey(_cardId(peer.id)),
                onVisibilityChanged: onVisibilityChanged,
                child: widget.peerCardBuilder(peer),
              );
              // `Provider.of<PeerTabModel>(context)` will causes infinete loop.
              // Because `gFFI.peerTabModel.setCurrentTabCachedPeers(peers)` will trigger `notifyListeners()`.
              //
              // No need to listen the currentTab change event.
              // Because the currentTab change event will trigger the peers change event,
              // and the peers change event will trigger _buildPeersView().
              return !isPortrait
                  ? Obx(() => peerCardUiType.value == PeerUiType.list
                      ? Container(height: 45, child: visibilityChild)
                      : peerCardUiType.value == PeerUiType.grid
                          ? SizedBox(
                              width: 220, height: 140, child: visibilityChild)
                          : SizedBox(
                              width: 220, height: 42, child: visibilityChild))
                  : Container(child: visibilityChild);
            }

            // We should avoid too many rebuilds. Win10(Some machines) on Flutter 3.19.6.
            // Continious rebuilds of `ListView.builder` will cause memory leak.
            // Simple demo can reproduce this issue.
            final Widget child = Obx(() => stateGlobal.isPortrait.isTrue
                ? ListView.builder(
                    itemCount: peers.length,
                    itemBuilder: (BuildContext context, int index) {
                      return buildOnePeer(peers[index], true).marginOnly(
                          top: index == 0 ? 0 : space / 2, bottom: space / 2);
                    },
                  )
                : peerCardUiType.value == PeerUiType.list
                    // 그룹화는 list view 에서만 적용한다.
                    ? Obx(() {
                        // peerGroupExpanded 가 바뀌면 재빌드한다.
                        peerGroupExpanded.length;
                        final items = buildGroupedPeerItems(peers);
                        // 가로 공간을 활용해 peer 카드를 반응형 N열로 배치한다.
                        // 카드 최소폭(kTargetCardWidth)을 기준으로 창 너비에 맞춰 열 수를
                        // 자동 결정한다(좁으면 1열, 넓히면 그만큼 늘어나며 카드는 최소폭 유지).
                        // 그룹 헤더는 전체 폭을 쓰고, 헤더 경계에서 짝을 리셋해 그룹이 같은 행에 섞이지 않게 한다.
                        return LayoutBuilder(builder: (context, constraints) {
                          const double kTargetCardWidth = 320;
                          final double avail = constraints.maxWidth.isFinite
                              ? constraints.maxWidth
                              : kTargetCardWidth * 2;
                          final int cols =
                              (avail / kTargetCardWidth).floor().clamp(1, 12);
                          final rows = <dynamic>[];
                          List<Peer>? pending;
                          void flushPair() {
                            if (pending != null) {
                              rows.add(pending);
                              pending = null;
                            }
                          }

                          for (final item in items) {
                            if (item is _PeerGroupHeader) {
                              flushPair();
                              rows.add(item);
                            } else {
                              (pending ??= <Peer>[]).add(item as Peer);
                              if (pending!.length == cols) flushPair();
                            }
                          }
                          flushPair();
                          return ListView.builder(
                            controller: _scrollController,
                            itemCount: rows.length,
                            itemBuilder: (BuildContext context, int index) {
                              final row = rows[index];
                              final double topMargin =
                                  index == 0 ? 0 : space / 2;
                              if (row is _PeerGroupHeader) {
                                return _buildGroupHeader(row).marginOnly(
                                    right: space,
                                    top: topMargin,
                                    bottom: space / 2);
                              }
                              final pair = row as List<Peer>;
                              final children = <Widget>[];
                              for (int i = 0; i < cols; i++) {
                                if (i > 0) children.add(SizedBox(width: space));
                                children.add(Expanded(
                                    child: i < pair.length
                                        ? buildOnePeer(pair[i], false)
                                        : const SizedBox()));
                              }
                              return Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: children)
                                  .marginOnly(
                                      right: space,
                                      top: topMargin,
                                      bottom: space / 2);
                            },
                          );
                        });
                      })
                    : DynamicGridView.builder(
                        gridDelegate: SliverGridDelegateWithWrapping(
                            mainAxisSpacing: space / 2,
                            crossAxisSpacing: space),
                        itemCount: peers.length,
                        itemBuilder: (BuildContext context, int index) {
                          return buildOnePeer(peers[index], false);
                        }));

            if (updateEvent == UpdateEvent.load) {
              _curPeers.clear();
              _curPeers.addAll(peers.map((e) => e.id));
              _queryOnlines(true);
            }
            return child;
          } else {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }
        },
        future: matchPeers(filters[0].value, filters[1].value, peers.peers),
      );
    }, obslist);

    return body;
  }

  var _queryInterval = const Duration(seconds: 20);

  void _startCheckOnlines() {
    () async {
      final p = await bind.mainIsUsingPublicServer();
      if (!p) {
        _queryInterval = const Duration(seconds: 6);
      }
      while (!_exit) {
        final now = DateTime.now();
        if (!setEquals(_curPeers, _lastQueryPeers)) {
          if (now.difference(_lastChangeTime) > const Duration(seconds: 1)) {
            _queryOnlines(false);
          }
        } else {
          final skipIfIsWeb =
              isWeb && !(stateGlobal.isWebVisible && stateGlobal.isInMainPage);
          final skipIfMobile =
              (isAndroid || isIOS) && !stateGlobal.isInMainPage;
          final skipIfNotActive = skipIfIsWeb || skipIfMobile || !_isActive;
          if (!skipIfNotActive && (_queryCount < _maxQueryCount || !p)) {
            if (now.difference(_lastQueryTime) >= _queryInterval) {
              if (_curPeers.isNotEmpty) {
                bind.queryOnlines(ids: _curPeers.toList(growable: false));
                _lastQueryTime = DateTime.now();
                _queryCount += 1;
              }
            }
          }
        }
        await Future.delayed(const Duration(milliseconds: 300));
      }
    }();
  }

  _queryOnlines(bool isLoadEvent) {
    if (_curPeers.isNotEmpty) {
      bind.queryOnlines(ids: _curPeers.toList(growable: false));
      _queryCount = 0;
    }
    _lastQueryPeers = {..._curPeers};
    if (isLoadEvent) {
      _lastChangeTime = DateTime.now();
    } else {
      _lastQueryTime = DateTime.now().subtract(_queryInterval);
    }
  }

  Future<List<Peer>>? matchPeers(
      String searchText, String sortedBy, List<Peer> peers) async {
    // ChainRemote: 자기 자신 ID 를 모든 목록에서 숨김 (단일 필터 지점 = 전 탭 일괄 적용).
    // async 라 첫 호출 때 실제 ID 를 await 로 받아 캐시 → 깜빡임 없음.
    if (_myOwnIdCache.isEmpty) {
      _myOwnIdCache = (await bind.mainGetMyId()).trim();
    }
    if (_myOwnIdCache.isNotEmpty) {
      peers = peers.where((peer) => peer.id != _myOwnIdCache).toList();
    }

    if (widget.peerFilter != null) {
      peers = peers.where((peer) => widget.peerFilter!(peer)).toList();
    }

    // fallback to id sorting
    if (!PeerSortType.values.contains(sortedBy)) {
      sortedBy = PeerSortType.remoteId;
      bind.setLocalFlutterOption(
        k: kOptionPeerSorting,
        v: sortedBy,
      );
    }

    if (widget.peers.loadEvent != LoadEvent.recent) {
      switch (sortedBy) {
        case PeerSortType.remoteId:
          peers.sort((p1, p2) => p1.getId().compareTo(p2.getId()));
          break;
        case PeerSortType.remoteHost:
          peers.sort((p1, p2) =>
              p1.hostname.toLowerCase().compareTo(p2.hostname.toLowerCase()));
          break;
        case PeerSortType.username:
          peers.sort((p1, p2) =>
              p1.username.toLowerCase().compareTo(p2.username.toLowerCase()));
          break;
        case PeerSortType.status:
          peers.sort((p1, p2) => p1.online ? -1 : 1);
          break;
      }
    }

    searchText = searchText.trim();
    if (searchText.isEmpty) {
      return peers;
    }
    searchText = searchText.toLowerCase();
    final matches = await Future.wait(
        peers.map((peer) => matchPeer(searchText, peer, widget.peerTabIndex)));
    final filteredList = List<Peer>.empty(growable: true);
    for (var i = 0; i < peers.length; i++) {
      if (matches[i]) {
        filteredList.add(peers[i]);
      }
    }

    return filteredList;
  }
}

abstract class BasePeersView extends StatelessWidget {
  final PeerTabIndex peerTabIndex;
  final PeerFilter? peerFilter;
  final PeerCardBuilder peerCardBuilder;

  const BasePeersView({
    Key? key,
    required this.peerTabIndex,
    this.peerFilter,
    required this.peerCardBuilder,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    Peers peers;
    switch (peerTabIndex) {
      case PeerTabIndex.recent:
        peers = gFFI.recentPeersModel;
        break;
      case PeerTabIndex.fav:
        peers = gFFI.favoritePeersModel;
        break;
      case PeerTabIndex.lan:
        peers = gFFI.lanPeersModel;
        break;
      case PeerTabIndex.ab:
        peers = gFFI.abModel.peersModel;
        break;
      case PeerTabIndex.group:
        peers = gFFI.groupModel.peersModel;
        break;
      case PeerTabIndex.customers:
        peers = gFFI.allCustomersPeersModel;
        break;
    }
    return _PeersView(
        peers: peers,
        peerFilter: peerFilter,
        peerCardBuilder: peerCardBuilder,
        peerTabIndex: peerTabIndex);
  }
}

class RecentPeersView extends BasePeersView {
  RecentPeersView(
      {Key? key, EdgeInsets? menuPadding, ScrollController? scrollController})
      : super(
          key: key,
          peerTabIndex: PeerTabIndex.recent,
          peerCardBuilder: (Peer peer) => RecentPeerCard(
            peer: peer,
            menuPadding: menuPadding,
          ),
        );

  @override
  Widget build(BuildContext context) {
    final widget = super.build(context);
    // ChainRemote 본사 앱: 최근 세션 = 네이티브 최근 접속 기록.
    // 탭 진입 시 거래처명 캐시(REMOTE_TO_NAME) 재워밍 → 패널에서 새로 등록·개명된 거래처도
    //   최근세션에 즉시 이름 반영(stale "숫자만" 표시 해소). fetch 완료 시 main_load_recent_peers 재push.
    bind.chainremoteLoadCustomers();
    bind.mainLoadRecentPeers();
    return widget;
  }
}

class FavoritePeersView extends BasePeersView {
  FavoritePeersView(
      {Key? key, EdgeInsets? menuPadding, ScrollController? scrollController})
      : super(
          key: key,
          peerTabIndex: PeerTabIndex.fav,
          peerCardBuilder: (Peer peer) => FavoritePeerCard(
            peer: peer,
            menuPadding: menuPadding,
          ),
        );

  @override
  Widget build(BuildContext context) {
    final widget = super.build(context);
    // ChainRemote 본사 앱: 즐겨찾기는 user 별로 DB 의 user_favorites 에서 옴. (Phase 2-D)
    bind.chainremoteLoadFavorites();
    return widget;
  }
}

// ChainRemote: '전체 거래처' 탭 — 우리 회사(테넌트) 패널에 등록된 모든 거래처(pending 포함).
// 누가 등록했든 chang/c-win/jaesung 모두 동일 목록을 보고 거기서 1클릭 원격.
// 데이터는 Rust fetch_customers_blocking → "load_all_customers" 이벤트(allCustomersPeersModel).
class AllCustomersPeersView extends BasePeersView {
  AllCustomersPeersView(
      {Key? key, EdgeInsets? menuPadding, ScrollController? scrollController})
      : super(
          key: key,
          peerTabIndex: PeerTabIndex.customers,
          peerCardBuilder: (Peer peer) => AllCustomersPeerCard(
            peer: peer,
            menuPadding: menuPadding,
          ),
        );

  @override
  Widget build(BuildContext context) {
    final widget = super.build(context);
    // on-demand 재요청 (자동 폴링 대신 — 50대리점 idle 트래픽 방지). 탭 진입 시 최신 거래처 fetch.
    bind.chainremoteLoadCustomers();
    return widget;
  }
}

class DiscoveredPeersView extends BasePeersView {
  DiscoveredPeersView(
      {Key? key, EdgeInsets? menuPadding, ScrollController? scrollController})
      : super(
          key: key,
          peerTabIndex: PeerTabIndex.lan,
          peerCardBuilder: (Peer peer) => DiscoveredPeerCard(
            peer: peer,
            menuPadding: menuPadding,
          ),
        );

  @override
  Widget build(BuildContext context) {
    final widget = super.build(context);
    bind.mainLoadLanPeers();
    bind.mainDiscover();
    return widget;
  }
}

class AddressBookPeersView extends BasePeersView {
  AddressBookPeersView(
      {Key? key, EdgeInsets? menuPadding, ScrollController? scrollController})
      : super(
          key: key,
          peerTabIndex: PeerTabIndex.ab,
          peerFilter: (Peer peer) =>
              _hitTag(gFFI.abModel.selectedTags, peer.tags),
          peerCardBuilder: (Peer peer) => AddressBookPeerCard(
            peer: peer,
            menuPadding: menuPadding,
          ),
        );

  static bool _hitTag(List<dynamic> selectedTags, List<dynamic> idents) {
    if (selectedTags.isEmpty) {
      return true;
    }
    // The result of a no-tag union with normal tags, still allows normal tags to perform union or intersection operations.
    final selectedNormalTags =
        selectedTags.where((tag) => tag != kUntagged).toList();
    if (selectedTags.contains(kUntagged)) {
      if (idents.isEmpty) return true;
      if (selectedNormalTags.isEmpty) return false;
    }
    if (gFFI.abModel.filterByIntersection.value) {
      for (final tag in selectedNormalTags) {
        if (!idents.contains(tag)) {
          return false;
        }
      }
      return true;
    } else {
      for (final tag in selectedNormalTags) {
        if (idents.contains(tag)) {
          return true;
        }
      }
      return false;
    }
  }
}

class MyGroupPeerView extends BasePeersView {
  MyGroupPeerView(
      {Key? key, EdgeInsets? menuPadding, ScrollController? scrollController})
      : super(
          key: key,
          peerTabIndex: PeerTabIndex.group,
          peerFilter: filter,
          peerCardBuilder: (Peer peer) => MyGroupPeerCard(
            peer: peer,
            menuPadding: menuPadding,
          ),
        );

  static bool filter(Peer peer) {
    final model = gFFI.groupModel;
    if (model.searchAccessibleItemNameText.isNotEmpty) {
      final text = model.searchAccessibleItemNameText.value.toLowerCase();
      final searchPeersOfUser = model.users.any((user) =>
          user.name == peer.loginName &&
          (user.name.toLowerCase().contains(text) ||
              user.displayNameOrName.toLowerCase().contains(text)));
      final searchPeersOfDeviceGroup =
          peer.device_group_name.toLowerCase().contains(text) &&
              model.deviceGroups.any((g) => g.name == peer.device_group_name);
      if (!searchPeersOfUser && !searchPeersOfDeviceGroup) {
        return false;
      }
    }
    if (model.selectedAccessibleItemName.isNotEmpty) {
      if (model.isSelectedDeviceGroup.value) {
        if (model.selectedAccessibleItemName.value != peer.device_group_name) {
          return false;
        }
      } else {
        if (model.selectedAccessibleItemName.value != peer.loginName) {
          return false;
        }
      }
    }
    return true;
  }
}
