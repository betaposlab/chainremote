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
import 'chainremote_folders.dart';

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
// 검색창 펼침 상태 — 전역인 이유: 디스크 주의 스트립의 칩 점프가 검색 필터를 걸 때
// 접힌 검색창 뒤에 필터가 숨으면 "탭이 안 된다"로 보이는 함정(2026-07-16 실사용)이 생겨서,
// 프로그램적으로 펼쳐 필터를 눈에 보이게 해야 한다.
final peerSearchBarOpen = false.obs;

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

// 거래처 폴더 — 윈도우 탐색기식(2026-07-22 재설계). 폴더는 목록 속 독립 타일이고, 클릭하면
// 그 폴더 안으로 들어가 소속 거래처만 보인다. 종전의 인라인 그룹 헤더/접기 방식은 폐기 —
// 사용자 요구: "폴더를 클릭하면 하위 거래처만 보여야 한다"(구분선 그룹이 아니라 진짜 폴더).
//   배정은 device_group_name(패널이 folder join 으로 실어줌, 마이그 026)에 담긴다.

// 열린 폴더(탐색기 진입 상태). null = 루트(폴더 타일 + 미소속 거래처를 함께 보여줌).
final crOpenFolder = RxnString();
// [새 폴더] 인라인 편집 중 — 루트 최상단에 이름 편집 타일을 띄운다.
final crNewFolderEditing = false.obs;
// 알려진 폴더 목록(빈 폴더 포함). 멤버 0 인 폴더도 타일로 보이려면 패널 API 로 채워둔다.
final crKnownFolders = <String>[].obs;

// 폴더 목록 재조회(빈 폴더 반영). 진입/새폴더 생성 후 호출. 실패는 조용히(빈 목록 유지).
Future<void> crRefreshFolders() async {
  final list = await ChainRemoteFolderApi.list();
  crKnownFolders.assignAll(list.map((f) => f.name).toList());
}

// 루트 폴더 타일 1개 분량 데이터(이름 + 소속 대수).
class _FolderTileData {
  final String name;
  final int count;
  const _FolderTileData(this.name, this.count);
}

// 루트 최상단 "새 폴더" 편집 타일 자리표시.
class _NewFolderSlot {
  const _NewFolderSlot();
}

// 폴더 안에서 상단에 뜨는 "◀ 뒤로" 바(전폭).
class _FolderBack {
  final String name;
  const _FolderBack(this.name);
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
  // [새 폴더] 인라인 편집용 — 편집 시작 때 생성, 끝나면 정리(null).
  TextEditingController? _newFolderCtrl;
  FocusNode? _newFolderFocus;

  _PeersViewState() {
    _startCheckOnlines();
  }

  @override
  void initState() {
    windowManager.addListener(this);
    WidgetsBinding.instance.addObserver(this);
    super.initState();
    // 빈 폴더도 타일로 보이도록 폴더 목록을 한 번 받아둔다(즐겨찾기·전체거래처 탭). 실패는 무해.
    if (widget.peerTabIndex == PeerTabIndex.fav ||
        widget.peerTabIndex == PeerTabIndex.customers) {
      crRefreshFolders();
    }
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    WidgetsBinding.instance.removeObserver(this);
    _exit = true;
    _newFolderCtrl?.dispose();
    _newFolderFocus?.dispose();
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

  // ── 탐색기식 폴더 UI (2026-07-22 재설계) ──

  // 루트의 폴더 타일 — 클릭하면 그 폴더 안으로 진입(소속 거래처만 표시). peer 카드와 같은 높이.
  Widget _buildFolderTile(String name, int count) {
    return SizedBox(
      height: 45,
      child: DragTarget<String>(
        onWillAcceptWithDetails: (_) => true,
        onAcceptWithDetails: (d) => _dropIntoFolder(d.data, name),
        builder: (context, candidate, rejected) {
          final hovering = candidate.isNotEmpty; // 드래그가 이 폴더 위로 올라옴
          return Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: () => crOpenFolder.value = name,
              onSecondaryTapDown: (d) =>
                  _showFolderTileMenu(d.globalPosition, name),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                decoration: BoxDecoration(
                  color: hovering
                      ? const Color(0xFFD6E4FF)
                      : const Color(0xFFEFF3FF),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: hovering
                          ? const Color(0xFF1E5BFF)
                          : const Color(0xFFBBD0FF),
                      width: hovering ? 2 : 1),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.folder_rounded,
                        size: 26, color: Color(0xFF1E5BFF)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        name,
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
                        '$count대',
                        style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF1E5BFF)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  // 루트에서 peer 카드를 드래그 가능하게 — 폴더 타일에 떨구면 그 폴더로 이동.
  Widget _draggablePeer(Peer p, Widget child) {
    return Draggable<String>(
      data: p.id,
      maxSimultaneousDrags: 1,
      dragAnchorStrategy: pointerDragAnchorStrategy,
      feedback: Material(
        color: Colors.transparent,
        child: Opacity(
          opacity: 0.85,
          child: SizedBox(width: 260, height: 45, child: child),
        ),
      ),
      childWhenDragging: Opacity(opacity: 0.35, child: child),
      child: child,
    );
  }

  // 드래그로 거래처(remoteId)를 폴더에 떨궜을 때 — 이름으로 create(findOrCreate) 후 배정.
  //   폴더 타일은 이름만 알아서 folderId 를 모른다. create 가 findOrCreate 라 기존 폴더의
  //   id 를 돌려주므로(중복 안 생김) 그걸로 assign 한다.
  void _dropIntoFolder(String remoteId, String folderName) {
    () async {
      final f = await ChainRemoteFolderApi.create(folderName);
      if (f == null) {
        showToast(translate('Failed'));
        return;
      }
      final ok = await ChainRemoteFolderApi.assign(remoteId, f.id);
      if (ok) {
        bind.chainremoteLoadCustomers();
        bind.chainremoteLoadFavorites();
        showToast('$folderName 폴더로 이동');
      } else {
        showToast(translate('Failed'));
      }
    }();
  }

  // 빈 공간 우클릭 → "새 폴더" 메뉴. 카드 위 우클릭은 카드가 먼저 처리하므로 빈 영역만 여기로 온다.
  void _showNewFolderBgMenu(Offset globalPos) async {
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox;
    final selected = await showMenu<String>(
      context: context,
      position: RelativeRect.fromRect(
        Rect.fromLTWH(globalPos.dx, globalPos.dy, 0, 0),
        Offset.zero & overlay.size,
      ),
      items: [
        PopupMenuItem<String>(
          value: 'new',
          height: 38,
          child: Row(children: const [
            Icon(Icons.create_new_folder_outlined,
                size: 18, color: Color(0xFF1E5BFF)),
            SizedBox(width: 8),
            Text('새 폴더'),
          ]),
        ),
      ],
    );
    if (selected == 'new') {
      peerCardUiType.value = PeerUiType.list;
      crOpenFolder.value = null;
      crNewFolderEditing.value = true;
      crRefreshFolders();
    }
  }

  // 폴더 타일 우클릭 → 열기 / 이름 변경 / 삭제.
  void _showFolderTileMenu(Offset globalPos, String name) async {
    final overlay =
        Overlay.of(context).context.findRenderObject() as RenderBox;
    final selected = await showMenu<String>(
      context: context,
      position: RelativeRect.fromRect(
        Rect.fromLTWH(globalPos.dx, globalPos.dy, 0, 0),
        Offset.zero & overlay.size,
      ),
      items: [
        PopupMenuItem<String>(
          value: 'open',
          height: 38,
          child: Row(children: const [
            Icon(Icons.folder_open_outlined,
                size: 18, color: Color(0xFF1E5BFF)),
            SizedBox(width: 8),
            Text('열기'),
          ]),
        ),
        PopupMenuItem<String>(
          value: 'rename',
          height: 38,
          child: Row(children: const [
            Icon(Icons.drive_file_rename_outline, size: 18),
            SizedBox(width: 8),
            Text('이름 변경'),
          ]),
        ),
        PopupMenuItem<String>(
          value: 'delete',
          height: 38,
          child: Row(children: const [
            Icon(Icons.delete_outline, size: 18, color: Colors.red),
            SizedBox(width: 8),
            Text('삭제', style: TextStyle(color: Colors.red)),
          ]),
        ),
      ],
    );
    if (selected == 'open') {
      crOpenFolder.value = name;
    } else if (selected == 'rename') {
      _renameFolderDialog(name);
    } else if (selected == 'delete') {
      _deleteFolderConfirm(name);
    }
  }

  // 폴더 이름으로 폴더 id 조회(폴더 타일은 이름만 안다). 없으면 null.
  Future<String?> _folderIdByName(String name) async {
    final list = await ChainRemoteFolderApi.list();
    for (final f in list) {
      if (f.name == name) return f.id;
    }
    return null;
  }

  void _renameFolderDialog(String oldName) {
    final ctrl = TextEditingController(text: oldName)
      ..selection =
          TextSelection(baseOffset: 0, extentOffset: oldName.length);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('폴더 이름 변경'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            isDense: true,
          ),
          onSubmitted: (_) => _doRenameFolder(ctx, oldName, ctrl.text),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('취소')),
          TextButton(
              onPressed: () => _doRenameFolder(ctx, oldName, ctrl.text),
              child: const Text('변경')),
        ],
      ),
    );
  }

  void _doRenameFolder(BuildContext dialogCtx, String oldName, String input) {
    final newName = input.trim();
    Navigator.of(dialogCtx).pop();
    if (newName.isEmpty || newName == oldName) return;
    () async {
      final id = await _folderIdByName(oldName);
      if (id == null) {
        showToast(translate('Failed'));
        return;
      }
      final r = await ChainRemoteFolderApi.rename(id, newName);
      if (r == 'ok') {
        if (crOpenFolder.value == oldName) crOpenFolder.value = newName;
        bind.chainremoteLoadCustomers();
        bind.chainremoteLoadFavorites();
        await crRefreshFolders();
      } else if (r == 'dup') {
        showToast('이미 있는 폴더 이름입니다');
      } else {
        showToast(translate('Failed'));
      }
    }();
  }

  void _deleteFolderConfirm(String name) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('폴더 삭제'),
        content: Text(
            '"$name" 폴더를 삭제할까요?\n소속 거래처는 삭제되지 않고 폴더에서만 빠집니다.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('취소')),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              () async {
                final id = await _folderIdByName(name);
                if (id == null) {
                  showToast(translate('Failed'));
                  return;
                }
                final ok = await ChainRemoteFolderApi.delete(id);
                if (ok) {
                  if (crOpenFolder.value == name) crOpenFolder.value = null;
                  bind.chainremoteLoadCustomers();
                  bind.chainremoteLoadFavorites();
                  await crRefreshFolders();
                } else {
                  showToast(translate('Failed'));
                }
              }();
            },
            child: const Text('삭제', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
  }

  // 폴더 안 상단 "◀ 뒤로" 바(전폭). 클릭하면 루트로 나간다.
  Widget _buildFolderBackBar(String name) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => crOpenFolder.value = null,
        child: Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFF1F4F8),
            borderRadius: BorderRadius.circular(8),
            border: const Border(
                left: BorderSide(color: Color(0xFF1E5BFF), width: 3)),
          ),
          child: Row(
            children: [
              const Icon(Icons.arrow_back_rounded,
                  size: 20, color: Color(0xFF1E5BFF)),
              const SizedBox(width: 6),
              const Icon(Icons.folder_open_rounded,
                  size: 18, color: Color(0xFF1E5BFF)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '$name  —  전체로 나가기',
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFF1E2B45),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 루트 최상단 "새 폴더" 인라인 편집 타일 — 이름 입력 후 엔터(또는 체크)로 생성.
  Widget _buildNewFolderTile() {
    _newFolderCtrl ??= TextEditingController(text: '새 폴더')
      ..selection = const TextSelection(baseOffset: 0, extentOffset: 3);
    _newFolderFocus ??= FocusNode();

    void finish() {
      _newFolderCtrl?.dispose();
      _newFolderFocus?.dispose();
      _newFolderCtrl = null;
      _newFolderFocus = null;
      crNewFolderEditing.value = false;
    }

    Future<void> submit() async {
      final name = _newFolderCtrl?.text.trim() ?? '';
      if (name.isEmpty) {
        finish();
        return;
      }
      final ok = await ChainRemoteFolderApi.create(name);
      finish();
      if (ok != null) {
        await crRefreshFolders();
      } else {
        showToast(translate('Failed'));
      }
    }

    return SizedBox(
      height: 45,
      child: Container(
        padding: const EdgeInsets.only(left: 12, right: 2),
        decoration: BoxDecoration(
          color: const Color(0xFFEFF3FF),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: const Color(0xFF1E5BFF), width: 1.5),
        ),
        child: Row(
          children: [
            const Icon(Icons.create_new_folder_rounded,
                size: 26, color: Color(0xFF1E5BFF)),
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _newFolderCtrl,
                focusNode: _newFolderFocus,
                autofocus: true,
                style: const TextStyle(
                    fontSize: 14, fontWeight: FontWeight.w700),
                decoration: const InputDecoration(
                  isDense: true,
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.zero,
                ),
                onSubmitted: (_) => submit(),
              ),
            ),
            IconButton(
              tooltip: '만들기',
              icon: const Icon(Icons.check_rounded,
                  size: 20, color: Color(0xFF1E5BFF)),
              onPressed: submit,
            ),
            IconButton(
              tooltip: '취소',
              icon: const Icon(Icons.close_rounded,
                  size: 20, color: Color(0xFF9CA3AF)),
              onPressed: finish,
            ),
          ],
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
                    // 탐색기식 폴더는 list view 에서만 적용한다.
                    ? Obx(() {
                        // 폴더 상태 변화 시 재빌드(진입/새폴더/알려진폴더).
                        crOpenFolder.value;
                        crNewFolderEditing.value;
                        crKnownFolders.length;
                        // 폴더는 즐겨찾기·전체거래처 탭에서만 — recent 는 네이티브라 device_group_name 없음.
                        final foldersApply = widget.peerTabIndex ==
                                PeerTabIndex.fav ||
                            widget.peerTabIndex == PeerTabIndex.customers;

                        // device_group_name 으로 폴더별 분류 + 미소속.
                        final grouped = <String, List<Peer>>{};
                        final ungrouped = <Peer>[];
                        for (final p in peers) {
                          final g = p.device_group_name.trim();
                          if (!foldersApply || g.isEmpty) {
                            ungrouped.add(p);
                          } else {
                            (grouped[g] ??= <Peer>[]).add(p);
                          }
                        }

                        // 렌더 slot 구성 — _FolderBack 은 전폭, 나머지(폴더타일/새폴더/peer)는 열 패킹.
                        final slots = <Object>[];
                        final open = foldersApply ? crOpenFolder.value : null;
                        if (open != null) {
                          slots.add(_FolderBack(open));
                          slots.addAll(grouped[open] ?? const <Peer>[]);
                        } else {
                          if (foldersApply && crNewFolderEditing.value) {
                            slots.add(const _NewFolderSlot());
                          }
                          if (foldersApply) {
                            final names = <String>{
                              ...grouped.keys,
                              ...crKnownFolders,
                            }.toList()
                              ..sort();
                            for (final n in names) {
                              slots.add(
                                  _FolderTileData(n, grouped[n]?.length ?? 0));
                            }
                          }
                          slots.addAll(ungrouped);
                        }

                        // 가로 공간을 활용해 카드/폴더 타일을 반응형 N열로 배치한다.
                        // 뒤로가기 바(_FolderBack)만 전폭, 나머지는 최소폭 기준 열 패킹.
                        return LayoutBuilder(builder: (context, constraints) {
                          const double kTargetCardWidth = 320;
                          final double avail = constraints.maxWidth.isFinite
                              ? constraints.maxWidth
                              : kTargetCardWidth * 2;
                          final int cols =
                              (avail / kTargetCardWidth).floor().clamp(1, 12);
                          final rows = <dynamic>[];
                          List<Object>? pending;
                          void flushPair() {
                            if (pending != null) {
                              rows.add(pending);
                              pending = null;
                            }
                          }

                          for (final s in slots) {
                            if (s is _FolderBack) {
                              flushPair();
                              rows.add(s);
                            } else {
                              (pending ??= <Object>[]).add(s);
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
                              if (row is _FolderBack) {
                                return _buildFolderBackBar(row.name).marginOnly(
                                    right: space,
                                    top: topMargin,
                                    bottom: space / 2);
                              }
                              final cells = row as List<Object>;
                              final children = <Widget>[];
                              for (int i = 0; i < cols; i++) {
                                if (i > 0) children.add(SizedBox(width: space));
                                Widget cell;
                                if (i < cells.length) {
                                  final c = cells[i];
                                  if (c is _FolderTileData) {
                                    cell = _buildFolderTile(c.name, c.count);
                                  } else if (c is _NewFolderSlot) {
                                    cell = _buildNewFolderTile();
                                  } else {
                                    final peer = c as Peer;
                                    final w = buildOnePeer(peer, false);
                                    // 루트에서만 드래그 가능(폴더 안/미적용 탭은 그대로).
                                    cell = (foldersApply && open == null)
                                        ? _draggablePeer(peer, w)
                                        : w;
                                  }
                                } else {
                                  cell = const SizedBox();
                                }
                                children.add(Expanded(child: cell));
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

    final foldersApply = widget.peerTabIndex == PeerTabIndex.fav ||
        widget.peerTabIndex == PeerTabIndex.customers;
    if (!foldersApply) return body;
    // 빈 공간 우클릭 → "새 폴더"(루트에서만). 카드 위 우클릭은 카드가 먼저 처리한다.
    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onSecondaryTapUp: (d) {
        if (crOpenFolder.value != null) return;
        _showNewFolderBgMenu(d.globalPosition);
      },
      child: body,
    );
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
    // 자기 자신 ID 를 모든 목록에서 숨긴다. 필터 지점이 하나라 전 탭에 일괄 적용된다.
    // async 이므로 첫 호출 때 실제 ID 를 await 로 받아 캐시해 깜빡임이 없다.
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
    // 최근 세션은 네이티브 최근 접속 기록을 사용한다.
    // 탭 진입 시 거래처명 캐시(REMOTE_TO_NAME)를 재워밍해, 패널에서 새로 등록·개명된 거래처도
    // 최근세션에 이름이 즉시 반영된다(stale "숫자만" 표시 해소). fetch 완료 시 main_load_recent_peers 를 재push 한다.
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
    // 즐겨찾기는 user 별로 DB 의 user_favorites 에서 온다 (Phase 2-D).
    bind.chainremoteLoadFavorites();
    return widget;
  }
}

// '전체 거래처' 탭. 우리 회사(테넌트) 패널에 등록된 모든 거래처(pending 포함)를 보여준다.
// 누가 등록했든 chang/c-win/jaesung 모두 같은 목록을 보고 거기서 1클릭 원격한다.
// 데이터는 Rust fetch_customers_blocking 이 "load_all_customers" 이벤트(allCustomersPeersModel)로 넘긴다.
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
    // 탭 진입 시 최신 거래처를 fetch 한다. 자동 폴링 대신 on-demand 로 재요청해 50대리점 idle 트래픽을 막는다.
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
