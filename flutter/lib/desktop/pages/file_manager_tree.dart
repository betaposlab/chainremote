// ChainRemote (2026-05-29): 파일전송 창 폴더 트리 패널.
//
// 코이노/윈도우 탐색기식 좌측 폴더 트리. 경로가 길어도 트리를 펼쳐 빠르게 이동.
// RustDesk 원본엔 없던 신규 기능 — 순수 Flutter + 기존 FileController/FileFetcher
// 인프라(fetchDirectory)만 재사용. native 무관.
//
// 트리 루트 = 의미 있는 3개 진입점 (시스템 루트가 아니라):
//   🏠 홈 (changsmac / zenta) — 기본 펼침 → 하위 폴더 바로 보임
//   🖥️ 바탕화면 (홈\Desktop)
//   💻 내 컴퓨터 — 펼치면 드라이브(C:/D:) 또는 볼륨 (fetchDirectory "/")
//
// 동작:
//   - 노드 펼치기(▸/▾): 그 폴더 lazy fetch → 하위 폴더/드라이브만.
//   - 노드 클릭: controller.openDirectory(path) → 우측 목록이 그 폴더로.
//   - 현재 열린 폴더는 파랑 강조.
//   - 원격(home)은 연결 후 채워지므로 options 를 ever 로 관찰해 루트 구성.

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../../common.dart';
import '../../models/file_model.dart';

// 트리 노드 — 홈/바탕화면/내컴퓨터(루트)와 하위 폴더(Entry 변환)를 통일 표현.
class _TreeNode {
  final String path; // openDirectory + fetch 경로
  final String label;
  final IconData icon;
  final IconData openIcon;
  final Color color; // 아이콘 색 (폴더=노랑, 루트/드라이브=회색)
  const _TreeNode(this.path, this.label, this.icon,
      {IconData? openIcon, this.color = const Color(0xFF8B95A1)})
      : openIcon = openIcon ?? icon;
}

// 윈도우 탐색기식 폴더 노랑.
const _kFolderYellow = Color(0xFFFFC107);

class FolderTreePane extends StatefulWidget {
  final FileController controller;
  // ChainRemote (A안): 로컬=파랑 / 원격=빨강 현재폴더 강조색.
  final Color accentColor;
  const FolderTreePane(
      {Key? key,
      required this.controller,
      this.accentColor = const Color(0xFF1B64DA)})
      : super(key: key);

  @override
  State<FolderTreePane> createState() => _FolderTreePaneState();
}

class _FolderTreePaneState extends State<FolderTreePane> {
  final Set<String> _expanded = {};
  final Map<String, List<_TreeNode>> _children = {};
  final Set<String> _loading = {};
  List<_TreeNode>? _roots;
  Worker? _homeWorker;

  FileController get controller => widget.controller;
  bool get isLocal => controller.isLocal;
  bool get _showHidden => controller.options.value.showHidden;
  bool get _isWindows => controller.options.value.isWindows;

  @override
  void initState() {
    super.initState();
    // home 준비 감지: options 는 내부 필드 mutation 이라 Rx 가 변경을 못 잡는다.
    // directory(.value 재할당으로 제대로 reactive)를 관찰 — 폴더가 열리면 home 도 준비됨.
    _tryInitRoots();
    _homeWorker = ever(controller.directory, (_) => _tryInitRoots());
  }

  void _tryInitRoots() {
    if (_roots != null) return;
    if (controller.options.value.home.isEmpty) return;
    _initRoots();
  }

  @override
  void dispose() {
    _homeWorker?.dispose();
    super.dispose();
  }

  // 경로 문자열만으로 윈도우 여부 판정. options.isWindows 플래그는 _initRoots 가
  // 도는 이른 시점엔 아직 false 일 수 있어(원격 pi.platform 동기화 지연) 신뢰 못 함.
  bool _looksWindows(String path) =>
      path.contains('\\') || RegExp(r'^[A-Za-z]:').hasMatch(path);

  void _initRoots() {
    final home = controller.options.value.home;
    final dirPath = controller.directory.value.path;
    // 윈도우 판정: 플래그 + 현재 경로/홈 형태(드라이브문자·역슬래시) 종합 — 플래그 race 회피.
    final isWin = controller.options.value.isWindows ||
        _looksWindows(dirPath) ||
        _looksWindows(home);

    // ★ 원격의 home 은 '마지막 방문 폴더'(remote_dir)라 변동값이다(예: D:\\무한도전).
    //   절대 트리 뿌리로 쓰면 안 된다 → 항상 C:\\Users 에서 실제 프로필을 찾아 고정.
    if (!isLocal) {
      if (isWin) {
        _initWinRoots(profileFromUsers: true, home: '');
      } else {
        // 원격 유닉스(드묾): 신뢰할 프로필 경로 없음 → 내 컴퓨터만.
        setState(
            () => _roots = [_TreeNode('/', '내 컴퓨터', Icons.computer_sharp)]);
        _expand(_roots!.first);
      }
      return;
    }

    // 로컬: home 은 mainGetHomeDir 로 안정적 = 실제 프로필.
    if (isWin) {
      _initWinRoots(profileFromUsers: false, home: home);
      return;
    }
    // 로컬 Mac/유닉스: home 기준 표준 경로 직접 구성.
    final roots = <_TreeNode>[];
    if (home.isNotEmpty) {
      final segs = home.split('/').where((s) => s.isNotEmpty).toList();
      roots.add(
          _TreeNode(home, segs.isNotEmpty ? segs.last : '홈', Icons.home_sharp));
      roots.add(_TreeNode('$home/Desktop', '바탕화면', Icons.desktop_windows_sharp));
      roots.add(_TreeNode('$home/Downloads', '다운로드', Icons.download_sharp));
      roots.add(_TreeNode('$home/Documents', '문서', Icons.description_sharp));
    }
    roots.add(_TreeNode('/', '내 컴퓨터', Icons.computer_sharp));
    setState(() => _roots = roots);
    _expand(roots.first);
  }

  // 윈도우 탐색기식 진입점 구성. 먼저 '내 컴퓨터'만 즉시 띄우고, 사용자 프로필을
  // 확정한 뒤 바탕화면/다운로드/문서의 *실제* 위치(OneDrive KFM 리디렉션 포함)를
  // 찾아 존재하는 폴더만 앞에 채운다.
  Future<void> _initWinRoots(
      {required bool profileFromUsers, required String home}) async {
    setState(() => _roots = [_TreeNode('/', '내 컴퓨터', Icons.computer_sharp)]);
    String? profile = home;
    final withHomeNode = !profileFromUsers;
    if (profileFromUsers) {
      profile = await _resolveWinUserProfile();
      if (!mounted) return;
      if (profile == null) {
        _expand(_roots!.first);
        return;
      }
    }
    final quick = await _resolveWinQuickLinks(profile);
    if (!mounted) return;
    final roots = <_TreeNode>[];
    if (withHomeNode) {
      final segs = profile.split('\\').where((s) => s.isNotEmpty).toList();
      roots.add(
          _TreeNode(profile, segs.isNotEmpty ? segs.last : '홈', Icons.home_sharp));
    }
    roots.addAll(quick);
    roots.add(_TreeNode('/', '내 컴퓨터', Icons.computer_sharp));
    setState(() => _roots = roots);
    // 홈 노드가 있으면 그걸, 없으면(서비스 원격) 드라이브가 보이도록 내 컴퓨터를 펼침.
    _expand(withHomeNode ? roots.first : roots.last);
  }

  // 바탕화면/다운로드/문서의 실제 경로 탐색. OneDrive 백업(KFM)으로 리디렉션된
  // 경우 C:\\Users\\<user>\\OneDrive\\... 에 실제 파일이 있으므로 OneDrive 를 우선
  // 뒤지고, 없으면 프로필 직속을 본다. 존재하는 폴더만 노드로 만든다(죽은 링크 방지).
  Future<List<_TreeNode>> _resolveWinQuickLinks(String profile) async {
    final profDirs = await _listWinSubdirs(profile);
    String? odPath;
    Map<String, String> odDirs = {};
    for (final entry in profDirs.entries) {
      if (entry.key.startsWith('onedrive')) {
        odPath = '$profile\\${entry.value}';
        odDirs = await _listWinSubdirs(odPath);
        break;
      }
    }
    String? pick(List<String> names) {
      if (odPath != null) {
        for (final n in names) {
          final real = odDirs[n];
          if (real != null) return '$odPath\\$real';
        }
      }
      for (final n in names) {
        final real = profDirs[n];
        if (real != null) return '$profile\\$real';
      }
      return null;
    }

    final out = <_TreeNode>[];
    final desktop = pick(['desktop', '바탕 화면', '바탕화면']);
    if (desktop != null) {
      out.add(_TreeNode(desktop, '바탕화면', Icons.desktop_windows_sharp));
    }
    final downloads = pick(['downloads', '다운로드']);
    if (downloads != null) {
      out.add(_TreeNode(downloads, '다운로드', Icons.download_sharp));
    }
    final documents = pick(['documents', 'my documents', '내 문서', '문서']);
    if (documents != null) {
      out.add(_TreeNode(documents, '문서', Icons.description_sharp));
    }
    return out;
  }

  // 경로의 하위 디렉터리를 {소문자이름: 실제이름} 으로 반환(대소문자 무시 매칭용).
  Future<Map<String, String>> _listWinSubdirs(String path) async {
    final fd = await _fetchRaw(path);
    if (fd == null) return {};
    fd.format(true);
    final m = <String, String>{};
    for (final e in fd.entries) {
      if (e.isDirectory) m[e.name.toLowerCase()] = e.name;
    }
    return m;
  }

  // C:\\Users 나열 → 시스템 계정 제외 → 원격 로그인 사용자명 우선 매칭,
  // 없으면 단일 후보, 그것도 아니면 최근 수정 폴더(=활성 사용자 추정).
  Future<String?> _resolveWinUserProfile() async {
    FileDirectory? fd;
    try {
      fd = await _fetchRaw('C:\\Users');
    } catch (_) {
      return null;
    }
    if (fd == null) return null;
    fd.format(true);
    const skip = {
      'public',
      'default',
      'default user',
      'all users',
      'defaultuser0',
      'wdagutilityaccount',
    };
    final dirs = fd.entries
        .where((e) => e.isDirectory && !skip.contains(e.name.toLowerCase()))
        .toList();
    if (dirs.isEmpty) return null;
    final username =
        (controller.rootState.target?.ffiModel.pi.username ?? '').trim();
    if (username.isNotEmpty) {
      for (final e in dirs) {
        if (e.name.toLowerCase() == username.toLowerCase()) {
          return 'C:\\Users\\${e.name}';
        }
      }
    }
    if (dirs.length == 1) return 'C:\\Users\\${dirs.first.name}';
    dirs.sort((a, b) => b.modifiedTime.compareTo(a.modifiedTime));
    return 'C:\\Users\\${dirs.first.name}';
  }

  // openDirectory(file_model.dart)와 동일한 윈도우 드라이브 경로 정규화.
  // 트리가 "/" fetch 로 받은 드라이브 entry 의 path 는 "/C:" 형식인데,
  // 원격 서버는 "C:\" 만 인식 → 정규화 안 하면 트리 펼침이 빈 결과가 된다.
  String _normalizePath(String path) {
    if (_isWindows && path.length > 1 && path.startsWith('/')) {
      path = path.substring(1);
      if (!path.endsWith('\\')) path = '$path\\';
    }
    return path;
  }

  // 같은 경로를 목록(openDirectory)과 트리가 동시에 fetch 하면 RustDesk 의
  // registerReadTask 가 "already have same read job" 으로 거부한다(원격은 경로별
  // 단일 작업만 허용). 행 클릭(목록 이동) 직후 화살표 클릭(트리 펼침) 시 흔히 발생.
  // → 기존 fetch 가 끝나길 잠깐 기다려 재시도.
  Future<FileDirectory?> _fetchRaw(String path) async {
    for (int attempt = 0; attempt < 5; attempt++) {
      try {
        return await controller.fileFetcher
            .fetchDirectory(path, isLocal, _showHidden);
      } catch (e) {
        if (e.toString().contains('already have same read job') &&
            attempt < 4) {
          await Future.delayed(const Duration(milliseconds: 350));
          continue;
        }
        rethrow;
      }
    }
    return null;
  }

  Future<List<_TreeNode>> _fetchDirs(String rawPath) async {
    final path = _normalizePath(rawPath);
    final fd = await _fetchRaw(path);
    if (fd == null) return [];
    fd.format(_isWindows);
    return fd.entries
        .where((e) => e.isDirectory || e.isDrive)
        .map((e) => _TreeNode(
              _normalizePath(e.path),
              e.name.isEmpty ? e.path : e.name,
              e.isDrive ? Icons.storage_sharp : Icons.folder_sharp,
              openIcon: e.isDrive ? Icons.storage_sharp : Icons.folder_open_sharp,
              color: e.isDrive ? const Color(0xFF8B95A1) : _kFolderYellow,
            ))
        .toList();
  }

  // 펼치기(자식 fetch 포함). 이미 펼쳐졌으면 무시.
  Future<void> _expand(_TreeNode n) async {
    if (_expanded.contains(n.path)) return;
    if (!_children.containsKey(n.path)) {
      setState(() => _loading.add(n.path));
      try {
        _children[n.path] = await _fetchDirs(n.path);
      } catch (_) {
        _children[n.path] = [];
      }
      if (!mounted) return;
      setState(() => _loading.remove(n.path));
    }
    if (!mounted) return;
    setState(() => _expanded.add(n.path));
  }

  Future<void> _toggle(_TreeNode n) async {
    if (_expanded.contains(n.path)) {
      setState(() => _expanded.remove(n.path));
      return;
    }
    await _expand(n);
  }

  void _open(_TreeNode n) {
    controller.selectedItems.clear();
    controller.openDirectory(n.path);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 168,
      decoration: BoxDecoration(
        color: const Color(0xFFFBFCFD),
        border: Border(
          right:
              BorderSide(color: Theme.of(context).dividerColor.withOpacity(0.5)),
        ),
      ),
      child: _roots == null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2)),
                  const SizedBox(height: 10),
                  Text(isLocal ? '' : '연결 중...',
                      style: TextStyle(fontSize: 11, color: MyTheme.darkGray)),
                ],
              ),
            )
          : Obx(() {
              final curPath = controller.directory.value.path;
              return SingleChildScrollView(
                padding:
                    const EdgeInsets.symmetric(vertical: 6, horizontal: 5),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: _buildNodes(_roots!, 0, curPath),
                ),
              );
            }),
    );
  }

  List<Widget> _buildNodes(List<_TreeNode> nodes, int depth, String curPath) {
    final widgets = <Widget>[];
    for (final n in nodes) {
      widgets.add(_buildNode(n, depth, curPath));
      if (_expanded.contains(n.path) && _children.containsKey(n.path)) {
        widgets.addAll(_buildNodes(_children[n.path]!, depth + 1, curPath));
      }
    }
    return widgets;
  }

  Widget _buildNode(_TreeNode n, int depth, String curPath) {
    final isCur = curPath == n.path;
    final isExpanded = _expanded.contains(n.path);
    final isLoading = _loading.contains(n.path);
    return InkWell(
      borderRadius: BorderRadius.circular(7),
      onTap: () => _open(n),
      child: Container(
        padding:
            EdgeInsets.only(left: 4.0 + depth * 13.0, right: 6, top: 5, bottom: 5),
        margin: const EdgeInsets.only(bottom: 1),
        decoration: BoxDecoration(
          color: isCur
              ? widget.accentColor.withOpacity(0.10)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(7),
        ),
        child: Row(
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => _toggle(n),
              child: SizedBox(
                width: 15,
                height: 16,
                child: isLoading
                    ? const Padding(
                        padding: EdgeInsets.all(2.5),
                        child: CircularProgressIndicator(strokeWidth: 1.6))
                    : Icon(
                        isExpanded
                            ? Icons.keyboard_arrow_down
                            : Icons.keyboard_arrow_right,
                        size: 15,
                        color: MyTheme.darkGray,
                      ),
              ),
            ),
            Icon(
              isExpanded ? n.openIcon : n.icon,
              size: 15,
              color: isCur ? widget.accentColor : n.color,
            ),
            const SizedBox(width: 5),
            Expanded(
              child: Text(
                n.label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12.5,
                  color: isCur
                      ? widget.accentColor
                      : const Color(0xFF191F28),
                  fontWeight: isCur ? FontWeight.w600 : FontWeight.normal,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
