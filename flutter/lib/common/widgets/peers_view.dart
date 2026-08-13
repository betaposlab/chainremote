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
//   crTableSort 를 넣어야 머리글을 눌렀을 때 목록이 다시 그려진다.
RxList<RxString> get obslist => [peerSearchText, peerSort, crTableSort].obs;

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

// 이번 실행에서 내가 만든 폴더 — 비어 있어도 타일을 남겨 둔다(만들자마자 끌어다 넣어야 하니까).
// 앱을 다시 켜면 비워진다. 그 밖의 빈 폴더는 탭에 멤버가 없으면 안 그린다 — 즐겨찾기 탭에
// 회사 전체 폴더가 "0대"로 늘어서면 내가 즐겨찾기한 게 사라진 것처럼 보인다.
final crSessionFolders = <String>{}.obs;

// [새 폴더] 편집 시작 — 툴바 버튼과 빈 공간 우클릭이 공유한다.
// 검색 중에는 폴더를 안 그리므로(평면 표시) 검색부터 비운다. 안 그러면 편집 타일이
// 안 보여 버튼이 죽은 것처럼 보인다.
void crStartNewFolder() {
  peerSearchTextController.clear();
  peerSearchText.value = '';
  peerCardUiType.value = PeerUiType.list;
  crOpenFolder.value = null;
  crNewFolderEditing.value = true;
  crRefreshFolders();
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
    // 표의 한 행과 같은 높이 — 카드 격자 시절엔 45 였지만 이제 목록의 한 줄이다.
    return SizedBox(
      height: 34,
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
                      ? CrColors.of(context).tileHoverBg
                      : CrColors.of(context).tileBg,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                      color: hovering
                          ? CrColors.of(context).tileAccent
                          : CrColors.of(context).tileBorder,
                      width: hovering ? 2 : 1),
                ),
                child: Row(
                  children: [
                    // ★폴더만 다른 색 — 배경이 같아 목록을 훑을 때 폴더 행이 안 갈렸다.
                    //   배경을 물들이면 표 전체가 얼룩덜룩해지므로 아이콘 하나만 바꾼다.
                    //   윈도우 탐색기의 노란 폴더가 익숙한 신호인데 원색은 튀어서 한 톤 옅게.
                    Icon(Icons.folder_rounded,
                        size: 20, color: CrColors.of(context).folderIcon),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        name,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: CrColors.of(context).tileText,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: CrColors.of(context).tileAccent.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        '$count대',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: CrColors.of(context).tileAccent),
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
          child: Row(children: [
            Icon(Icons.create_new_folder_outlined,
                size: 18, color: CrColors.of(context).tileAccent),
            SizedBox(width: 8),
            Text('새 폴더'),
          ]),
        ),
      ],
    );
    if (selected == 'new') {
      crStartNewFolder();
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
          child: Row(children: [
            Icon(Icons.folder_open_outlined,
                size: 18, color: CrColors.of(context).tileAccent),
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
        if (crSessionFolders.remove(oldName)) crSessionFolders.add(newName);
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
                  crSessionFolders.remove(name);
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
            color: CrColors.of(context).tileBg,
            borderRadius: BorderRadius.circular(8),
            border: Border(
                left: BorderSide(color: CrColors.of(context).tileAccent, width: 3)),
          ),
          child: Row(
            children: [
              Icon(Icons.arrow_back_rounded,
                  size: 20, color: CrColors.of(context).tileAccent),
              const SizedBox(width: 6),
              Icon(Icons.folder_open_rounded,
                  size: 18, color: CrColors.of(context).folderIcon),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '$name  —  전체로 나가기',
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: CrColors.of(context).tileText,
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
    // 프리필 전체를 선택해 둔다(그대로 타이핑하면 통째로 대체). 선택 끝은 반드시
    // 문자열 길이에서 유도할 것 — 숫자를 박아두면 꼬리글자가 남는다("새 폴"+"더").
    const defaultName = '새 폴더';
    _newFolderCtrl ??= TextEditingController(text: defaultName)
      ..selection =
          TextSelection(baseOffset: 0, extentOffset: defaultName.length);
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
        crSessionFolders.add(name); // 비어 있어도 타일이 남아야 끌어다 넣을 수 있다
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
          color: CrColors.of(context).tileBg,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: CrColors.of(context).tileAccent, width: 1.5),
        ),
        child: Row(
          children: [
            Icon(Icons.create_new_folder_rounded,
                size: 26, color: CrColors.of(context).tileAccent),
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
              icon: Icon(Icons.check_rounded,
                  size: 20, color: CrColors.of(context).tileAccent),
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
            crFillFromPanel(peers);
            gFFI.peerTabModel.setCurrentTabCachedPeers(peers);
            // 관제 열은 켠 거래처가 하나라도 있을 때만 낸다 — 한 곳도 안 쓰는 대리점에겐
            //   빈 열 두 개가 그냥 소음이다(열 폭도 상호에 돌려준다).
            crShowFwCol = peers.any((p) => p.firewallControl == 'Y');
            crShowVanCol = peers.any((p) => p.vanWatch.isNotEmpty);
            crShowDiskCol = peers.any((p) => crDiskBadgeText(p) != null);
            crShowOsCol = peers.any((p) => crOsBadgeText(p) != null);
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
              // 표의 행 높이 — 한 줄이라 고정이다(세로/모바일은 카드라 자연 높이).
              return !isPortrait
                  ? Container(height: 34, child: visibilityChild)
                  : Container(child: visibilityChild);
            }

            // We should avoid too many rebuilds. Win10(Some machines) on Flutter 3.19.6.
            // Continious rebuilds of `ListView.builder` will cause memory leak.
            // Simple demo can reproduce this issue.
            // 세로(폰)에서도 list 보기면 아래 탐색기식 폴더 경로를 탄다. 종전엔 세로면 무조건
            //   평면 목록이라, 폰에서는 폴더에 넣을 수는 있는데 그 폴더를 **열 방법이 없었다**.
            //   카드형 보기는 종전대로 단순 목록(열 패킹이 폰 폭에 안 맞는다).
            //   데스크톱은 isPortrait 가 항상 false 라 이 조건에 영향받지 않는다.
            final Widget child = Obx(() => (stateGlobal.isPortrait.isTrue &&
                    peerCardUiType.value != PeerUiType.list)
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
                        // 검색 중이면 폴더를 걷어내고 결과를 평면으로 — 탐색기의 검색과 같다.
                        // 이게 없으면 폴더에 든 거래처가 검색 결과에서 통째로 사라진다
                        // (루트는 폴더타일+미소속만 그리므로). 검색을 지우면 폴더로 복귀.
                        final searching = peerSearchText.value.trim().isNotEmpty;
                        // 폴더는 즐겨찾기·전체거래처 탭에서만 — recent 는 네이티브라 device_group_name 없음.
                        final foldersApply = (widget.peerTabIndex ==
                                    PeerTabIndex.fav ||
                                widget.peerTabIndex ==
                                    PeerTabIndex.customers) &&
                            !searching;

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
                            // 이 탭에 멤버가 있는 폴더 + 방금 내가 만든 폴더만 그린다.
                            // 회사 전체 폴더를 다 그리면 즐겨찾기 탭이 "0대" 폴더로 덮인다.
                            final names = <String>{
                              ...grouped.keys,
                              ...crKnownFolders.where(crSessionFolders.contains),
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
                          // 표는 언제나 1열이다 — 열이 맞아야 훑을 수 있고, 그게 표를 쓰는
                          //   이유다(카드 시절의 반응형 N열 패킹은 여기서 끝난다).
                          final double avail = constraints.maxWidth.isFinite
                              ? constraints.maxWidth
                              : 900;
                          const int cols = 1;
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
                          // 머리글 + 표. 폴더 타일이 섞여 있어도 머리글은 목록 위 한 줄이다.
                          //   폭이 같은 LayoutBuilder 안에서 만들어야 행과 열이 어긋나지 않는다.
                          return Column(children: [
                            // 지금 이 화면이 담고 있는 대수 — 폴더 안이면 그 폴더 것만이다.
                            //   탭 전체 수를 그대로 두면 4대짜리 폴더에 들어가서도 30곳으로
                            //   보여 "왜 안 나오지"가 된다. 검색 중이면 이미 걸러진 수다.
                            crTableHeader(
                                context,
                                avail - space,
                                open != null
                                    ? (grouped[open]?.length ?? 0)
                                    : peers.length,
                                sortable: widget.peers.loadEvent !=
                                    LoadEvent.recent),
                            Expanded(
                                child: _buildTableList(
                                    rows, cols, foldersApply, open, buildOnePeer)),
                          ]);
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
    return _wrapFolderContextMenu(body);
  }

  // 표 본체 — 위 _buildPeersView 에서 머리글과 짝으로 쓴다(분리해 둔 건 중첩이 깊어져서다).
  Widget _buildTableList(List<dynamic> rows, int cols, bool foldersApply,
      String? open, Widget Function(Peer, bool) buildOnePeer) {
    return ListView.builder(
                            controller: _scrollController,
                            itemCount: rows.length,
                            itemBuilder: (BuildContext context, int index) {
                              final row = rows[index];
                              // 표는 줄 간격이 좁아야 훑힌다. 카드 격자용 space/2(6px)를
                              //   그대로 쓰면 행 하나당 12px 이 낭비돼 화면당 대수가 준다.
                              final double topMargin = index == 0 ? 0 : 3;
                              if (row is _FolderBack) {
                                return _buildFolderBackBar(row.name)
                                    .marginOnly(right: space, top: topMargin);
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
                                  .marginOnly(right: space, top: topMargin);
                            },
                          );
  }

  // 빈 공간 우클릭 → "새 폴더"(루트에서만). 카드 위 우클릭은 카드가 먼저 처리한다.
  Widget _wrapFolderContextMenu(Widget body) {
    final foldersApply = widget.peerTabIndex == PeerTabIndex.fav ||
        widget.peerTabIndex == PeerTabIndex.customers;
    if (!foldersApply) return body;
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

    // 정렬은 표 머리글이 정한다(2026-08-11). 상류의 peerSort(정렬 메뉴)는 이 화면에서
    //   더 이상 쓰지 않는다 — 진실 원천이 둘이면 눌러도 안 바뀌는 것처럼 보인다.
    //   '' = 기본 순서: 최근 세션은 최근순 그대로, 나머지는 상호 가나다순.
    final sortCol = crSortColOf(crTableSort.value);
    final asc = crSortAscOf(crTableSort.value);
    String nameKey(Peer p) =>
        (p.alias.isEmpty ? p.getId() : p.alias).toLowerCase();
    int diskKey(Peer p) => int.tryParse(p.diskFree) ?? -1;
    // 관제는 "손이 필요한 것부터" 가 오름차순이다 — 정상까지 스크롤해서 볼 일은 없다.
    int fwKey(Peer p) => p.firewallControl == 'Y' ? 0 : 1;
    int vanKey(Peer p) {
      if (p.vanWatch.isEmpty) return 5; // 관제 안 켬
      if (p.vanGaveUp == 'Y') return 0;
      if (p.vanOk == 'N') return 1;
      if (p.vanMissing == 'Y') return 2;
      if (p.vanOk != 'Y') return 3; // 보고 대기
      return 4; // 정상
    }

    int cmp(Peer a, Peer b) {
      switch (sortCol) {
        case 'name':
          return nameKey(a).compareTo(nameKey(b));
        case 'id':
          return a.getId().compareTo(b.getId());
        case 'status':
          return (a.online ? 0 : 1).compareTo(b.online ? 0 : 1);
        case 'os':
          return (crOsBadgeText(a) ?? '').compareTo(crOsBadgeText(b) ?? '');
        case 'disk':
          return diskKey(a).compareTo(diskKey(b));
        case 'fw':
          return fwKey(a).compareTo(fwKey(b));
        case 'van':
          return vanKey(a).compareTo(vanKey(b));
      }
      return 0;
    }

    // 값을 안 보낸 행(—)은 방향과 무관하게 항상 맨 뒤로. 디스크가 위험한 곳을 찾으려고
    //   눌렀는데 미보고가 위를 다 차지하면 정렬을 한 보람이 없다(내림차순도 마찬가지).
    bool noVal(Peer p) {
      switch (sortCol) {
        case 'disk':
          return int.tryParse(p.diskFree) == null;
        case 'os':
          return crOsBadgeText(p) == null;
      }
      return false;
    }

    // ★최근 세션은 이름 그대로 "최근에 본 순서"가 전부다. 다른 탭에서 고른 정렬이 여기까지
    //   따라오면 탭의 존재 이유가 사라진다(2026-08-12 Chang). 정렬은 코어가 준 순서를 그대로 둔다.
    final isRecent = widget.peers.loadEvent == LoadEvent.recent;
    if (sortCol.isNotEmpty && !isRecent) {
      // 같은 값끼리는 상호순으로 묶어야 목록이 새로고침마다 들썩이지 않는다.
      peers.sort((a, b) {
        final na = noVal(a), nb = noVal(b);
        if (na != nb) return na ? 1 : -1;
        final c = cmp(a, b);
        return c != 0 ? (asc ? c : -c) : nameKey(a).compareTo(nameKey(b));
      });
    } else if (!isRecent) {
      peers.sort((a, b) => nameKey(a).compareTo(nameKey(b)));
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

/// 로컬 캐시에서 온 peer 에 패널 값을 채운다 — OS·여유공간·관제.
///
/// ★왜 필요한가(2026-08-13): **최근 세션 탭의 거래처는 패널이 아니라 로컬 peer 캐시에서
///   온다.** 거기엔 이 필드들이 아예 없어서, 위의 "값이 있는 거래처가 하나라도 있을 때만
///   열을 낸다" 규칙에 걸려 네 열이 통째로 사라졌다. 같은 거래처인데 즐겨찾기 탭에서는
///   보이고 최근 세션 탭에서는 안 보였고, 사라진 이유가 화면 어디에도 없어서 Chang 이
///   고장으로 읽고 재로그인까지 했다. 정상 동작이 고장으로 읽히면 그건 설계 문제다.
///
///   패널 값은 이미 `allCustomersPeersModel`(전체 거래처 탭)에 다 들어와 있으므로 Rust 도
///   브리지도 건드릴 필요가 없다 — 그리는 직전에 같은 ID 를 찾아 비어 있는 칸만 메운다.
///   **덮어쓰지 않고 빈 칸만 채운다**: 패널 경로로 온 peer 는 이미 제 값을 갖고 있고,
///   그걸 다시 쓰면 마커(⏳/🆕)나 탭별 표시 규칙이 어긋난다.
void crFillFromPanel(List<Peer> peers) {
  final src = gFFI.allCustomersPeersModel.peers;
  if (src.isEmpty || peers.isEmpty) return;
  final byId = <String, Peer>{for (final p in src) p.id: p};
  for (final p in peers) {
    final c = byId[p.id];
    if (c == null) continue;
    if (p.os.isEmpty) p.os = c.os;
    if (p.osBits.isEmpty) p.osBits = c.osBits;
    if (p.arch.isEmpty) p.arch = c.arch;
    if (p.diskFree.isEmpty) p.diskFree = c.diskFree;
    if (p.diskTotal.isEmpty) p.diskTotal = c.diskTotal;
    if (p.tempBytes.isEmpty) p.tempBytes = c.tempBytes;
    if (p.firewallControl.isEmpty) p.firewallControl = c.firewallControl;
    if (p.vanWatch.isEmpty) {
      p.vanWatch = c.vanWatch;
      // vanOk/GaveUp/Missing 은 vanWatch 와 한 묶음이다 — 따로 채우면 관제가 꺼진 거래처에
      //   상태만 남아 "꺼졌는데 빨간 줄"이 된다.
      p.vanOk = c.vanOk;
      p.vanGaveUp = c.vanGaveUp;
      p.vanMissing = c.vanMissing;
    }
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
