import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:extended_text/extended_text.dart';
import 'package:flutter_hbb/common/widgets/dialog.dart';
import 'package:flutter_hbb/desktop/widgets/dragable_divider.dart';
import 'package:flutter_hbb/desktop/pages/file_manager_tree.dart';
import 'package:percent_indicator/percent_indicator.dart';
import 'package:desktop_drop/desktop_drop.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_breadcrumb/flutter_breadcrumb.dart';
import 'package:flutter_hbb/desktop/widgets/list_search_action_listener.dart';
import 'package:flutter_hbb/desktop/widgets/menu_button.dart';
import 'package:flutter_hbb/desktop/widgets/tabbar_widget.dart';
import 'package:flutter_hbb/models/file_model.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:get/get.dart';
import 'package:flutter_hbb/web/dummy.dart'
    if (dart.library.html) 'package:flutter_hbb/web/web_unique.dart';

import '../../consts.dart';
import '../../desktop/widgets/material_mod_popup_menu.dart' as mod_menu;
import '../../common.dart';
import '../../models/model.dart';
import '../../models/platform_model.dart';
import '../widgets/popup_menu.dart';

/// status of location bar
enum LocationStatus {
  /// normal bread crumb bar
  bread,

  /// show path text field
  pathLocation,

  /// show file search bar text field
  fileSearchBar
}

/// The status of currently focused scope of the mouse
enum MouseFocusScope {
  /// Mouse is in local field.
  local,

  /// Mouse is in remote field.
  remote,

  /// Mouse is not in local field, remote neither.
  none
}

class FileManagerPage extends StatefulWidget {
  FileManagerPage(
      {Key? key,
      required this.id,
      required this.password,
      required this.isSharedPassword,
      this.tabController,
      this.connToken,
      this.forceRelay})
      : super(key: key);
  final String id;
  final String? password;
  final bool? isSharedPassword;
  final bool? forceRelay;
  final String? connToken;
  final DesktopTabController? tabController;
  final SimpleWrapper<State<FileManagerPage>?> _lastState = SimpleWrapper(null);

  FFI get ffi => (_lastState.value! as _FileManagerPageState)._ffi;

  @override
  State<StatefulWidget> createState() {
    final state = _FileManagerPageState();
    _lastState.value = state;
    return state;
  }
}

class _FileManagerPageState extends State<FileManagerPage>
    with AutomaticKeepAliveClientMixin, WidgetsBindingObserver {
  final _mouseFocusScope = Rx<MouseFocusScope>(MouseFocusScope.none);

  final _dropMaskVisible = false.obs; // TODO impl drop mask
  final _overlayKeyState = OverlayKeyState();
  final _uniqueKey = UniqueKey();
  // 방금 활성 상태였던 전송 작업 id 배치 — 전부 끝나면 결과 토스트를 낸다(_bottomTransferBar).
  final Set<int> _lastTransferBatchIds = {};
  // 전송 진행 모달이 지금 떠 있는지 — 같은 배치에 두 번 띄우지 않기 위한 래치.
  bool _transferDialogOpen = false;

  late FFI _ffi;

  FileModel get model => _ffi.fileModel;
  JobController get jobController => model.jobController;

  @override
  void initState() {
    super.initState();
    _ffi = FFI(null);
    _ffi.start(widget.id,
        isFileTransfer: true,
        password: widget.password,
        isSharedPassword: widget.isSharedPassword,
        connToken: widget.connToken,
        forceRelay: widget.forceRelay);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _ffi.dialogManager
          .showLoading(translate('Connecting...'), onCancel: closeConnection);
    });
    Get.put<FFI>(_ffi, tag: 'ft_${widget.id}');
    WakelockManager.enable(_uniqueKey);
    if (isWeb) {
      _ffi.ffiModel.updateEventListener(_ffi.sessionId, widget.id);
    }
    debugPrint("File manager page init success with id ${widget.id}");
    _ffi.dialogManager.setOverlayState(_overlayKeyState);
    // Call onSelected in post frame callback, since we cannot guarantee that the callback will not call setState.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      widget.tabController?.onSelected?.call(widget.id);
    });
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    model.close().whenComplete(() {
      _ffi.close();
      _ffi.dialogManager.dismissAll();
      WakelockManager.disable(_uniqueKey);
      Get.delete<FFI>(tag: 'ft_${widget.id}');
    });
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  bool get wantKeepAlive => true;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      jobController.jobTable.refresh();
    }
  }

  Widget willPopScope(Widget child) {
    if (isWeb) {
      return WillPopScope(
        onWillPop: () async {
          clientClose(_ffi.sessionId, _ffi);
          return false;
        },
        child: child,
      );
    } else {
      return child;
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Overlay(key: _overlayKeyState.key, initialEntries: [
      OverlayEntry(builder: (_) {
        return willPopScope(Scaffold(
          backgroundColor: Theme.of(context).scaffoldBackgroundColor,
          // 전송 패널을 없애 로컬·원격 창을 최대로 넓혔다.
          // 전송 중일 때만 하단에 얇은 진행바를 띄운다.
          body: Column(
            children: [
              Expanded(
                child: Row(
                  children: [
                    if (!isWeb)
                      Flexible(
                          flex: 1,
                          child: dropArea(FileManagerView(
                              model.localController, _ffi, _mouseFocusScope))),
                    Flexible(
                        flex: 1,
                        child: dropArea(FileManagerView(
                            model.remoteController, _ffi, _mouseFocusScope))),
                  ],
                ),
              ),
              _bottomTransferBar(),
            ],
          ),
        ));
      })
    ]);
  }

  Widget dropArea(FileManagerView fileView) {
    final bool isLocalPane = fileView.controller.isLocal;
    return DropTarget(
        onDragDone: (detail) => handleDragDone(detail, isLocalPane),
        onDragEntered: (enter) {
          _dropMaskVisible.value = true;
        },
        onDragExited: (exit) {
          _dropMaskVisible.value = false;
        },
        // 방식1(2026-05-29). 앱 내부 드래그앤드롭.
        // 반대편 패널에서 끌어온 파일을 기존 sendFiles 로 전송한다.
        // desktop_drop(OS 파일 드롭)과 겹치지만 둘은 별개 이벤트다.
        child: DragTarget<SelectedItems>(
          onWillAcceptWithDetails: (details) =>
              details.data.isLocal != isLocalPane &&
              SelectedItems.valid(details.data.items),
          onAcceptWithDetails: (details) =>
              _handleInAppDrop(details.data, isLocalPane),
          builder: (context, candidateData, rejectedData) {
            final highlight = candidateData.isNotEmpty;
            return Container(
              decoration: highlight
                  ? BoxDecoration(
                      border: Border.all(color: MyTheme.button, width: 2.0),
                      borderRadius: BorderRadius.circular(8.0),
                    )
                  : null,
              child: fileView,
            );
          },
        ));
  }

  Widget generateCard(Widget child) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.all(
          Radius.circular(15.0),
        ),
      ),
      child: child,
    );
  }

  // 하단 전송 진행바. 전송 중(inProgress)일 때만 나타나고, 평소엔 높이 0이라
  // 로컬·원격 창이 최대로 넓어진다. 기존 전송 패널을 대체한다.
  // ★2026-07-08(Chang): 바가 작고 화면 맨 아래라 "전송이 시작됐는지/끝났는지 몰라 재전송"하는
  //   문제 → ① 정적 아이콘 대신 스피너로 "지금 진행 중"을 명확히, ② 굵은 "전송 중" 라벨 +
  //   두꺼운 진행바, ③ AnimatedSize 로 등장을 눈에 띄게, ④ 완료/실패 시 showToast 로 확실히
  //   알림(바가 사라지는 순간엔 이미 화면 밖 관심이 옮겨가 있어 그것만으론 불충분했다).
  //   전체화면 모달은 검토했으나 대용량 전송 중 다른 파일 탐색을 막는 손해가 더 커 기각.
  Widget _bottomTransferBar() {
    return Obx(() {
      final active = jobController.jobTable
          .where((j) => j.state == JobState.inProgress)
          .toList();

      if (active.isEmpty) {
        // 방금 활성 전송이 0 으로 전이했으면 — 그 배치의 결과(성공/실패)를 토스트로 확정 안내.
        if (_lastTransferBatchIds.isNotEmpty) {
          final ids = _lastTransferBatchIds.toList();
          _lastTransferBatchIds.clear();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            final finished = jobController.jobTable
                .where((j) => ids.contains(j.id) && j.type == JobType.transfer)
                .toList();
            if (finished.isEmpty) return;
            final failed =
                finished.where((j) => j.state == JobState.error).length;
            final ok = finished.length - failed;
            final String msg;
            if (failed == 0) {
              msg = finished.length == 1
                  ? '전송 완료: ${finished.first.fileName}'
                  : '전송 완료 (${finished.length}개)';
            } else if (ok == 0) {
              msg = '전송 실패 (${finished.length}개)';
            } else {
              msg = '전송 완료 $ok개 · 실패 $failed개';
            }
            showToast(msg);
          });
        }
        return const AnimatedSize(
          duration: Duration(milliseconds: 220),
          curve: Curves.easeOut,
          child: SizedBox(width: double.infinity, height: 0),
        );
      }

      // 지금 진행 중인 작업 id 를 배치로 기록 — 전부 끝나는 순간(위 분기) 결과를 안내한다.
      for (final j in active) {
        _lastTransferBatchIds.add(j.id);
      }

      // ★2026-07-30(Chang): 하단 바만으론 "전송이 시작됐는지" 여전히 헷갈린다 →
      //   전송이 시작되면 화면 중앙에 진행 창을 자동으로 띄운다. 07-08 에 전체화면 모달을
      //   기각했던 이유(대용량 전송 중 탐색을 막는다)는 '닫을 수 있게' 해서 피한다 —
      //   닫아도 이 하단 바가 그대로 남아 진행이 계속 보인다.
      if (!_transferDialogOpen) {
        _transferDialogOpen = true;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          _showTransferProgressDialog();
        });
      }

      final total = active.fold<int>(0, (s, j) => s + j.totalSize);
      final done = active.fold<int>(0, (s, j) => s + j.finishedSize);
      final pct = total > 0 ? (done / total).clamp(0.0, 1.0) : 0.0;
      final speed = active.fold<double>(0, (s, j) => s + j.speed);
      final label = active.length == 1
          ? (active.first.fileName.isNotEmpty
              ? active.first.fileName
              : active.first.jobName)
          : '${active.length}개 파일';

      return AnimatedSize(
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
        alignment: Alignment.bottomCenter,
        child: Container(
          height: 56,
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).cardColor,
            border: const Border(
              top: BorderSide(color: Color(0xFF3182F6), width: 3),
            ),
          ),
          child: Row(
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2.6, color: Color(0xFF3182F6)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('전송 중 · $label',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF3182F6))),
                    const SizedBox(height: 5),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(3),
                      child: LinearProgressIndicator(
                        value: pct,
                        minHeight: 6,
                        backgroundColor: const Color(0xFFEAEDF1),
                        color: const Color(0xFF3182F6),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${(pct * 100).toStringAsFixed(0)}%  ·  ${readableFileSize(speed)}/s',
                style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF3182F6),
                    fontWeight: FontWeight.w700),
              ),
              const SizedBox(width: 10),
              // 전송 중지. 진행 중인 작업을 모두 취소하고 목록에서 지운다.
              Tooltip(
                message: translate('Cancel'),
                child: InkWell(
                  borderRadius: BorderRadius.circular(6),
                  onTap: () {
                    for (final j in active) {
                      jobController.cancelJob(j.id);
                    }
                    jobController.jobTable
                        .removeWhere((j) => j.state == JobState.inProgress);
                    _lastTransferBatchIds.clear();
                  },
                  child: const Padding(
                    padding: EdgeInsets.all(5),
                    child:
                        Icon(Icons.close, size: 18, color: Color(0xFFE5484D)),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    });
  }

  // ChainRemote: 전송 진행 모달 — 전송이 시작되면 화면 중앙에 자동으로 뜬다.
  //   하단 바만으론 시작 여부가 안 보여 같은 파일을 두 번 보내는 일이 있었다(Chang).
  //   [백그라운드로] 로 닫으면 하단 바가 이어받으므로 대용량 전송 중 탐색을 막지 않는다.
  //   전송이 전부 끝나면 스스로 닫힌다(결과 토스트는 하단 바 쪽 로직이 띄운다).
  void _showTransferProgressDialog() {
    showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (ctx) {
        return Obx(() {
          final active = jobController.jobTable
              .where((j) => j.state == JobState.inProgress)
              .toList();
          // 진행 중인 게 없으면(=배치 완료) 스스로 닫는다.
          if (active.isEmpty) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (Navigator.canPop(ctx)) Navigator.pop(ctx);
            });
            return const SizedBox.shrink();
          }

          final total = active.fold<int>(0, (s, j) => s + j.totalSize);
          final done = active.fold<int>(0, (s, j) => s + j.finishedSize);
          final pct = total > 0 ? (done / total).clamp(0.0, 1.0) : 0.0;
          final speed = active.fold<double>(0, (s, j) => s + j.speed);
          // 남은 시간 — 속도가 0 이면(집계 전) 계산하지 않는다.
          final remainSec =
              speed > 0 ? ((total - done) / speed).round() : -1;
          String remainText;
          if (remainSec < 0) {
            remainText = '계산 중';
          } else if (remainSec < 60) {
            remainText = '약 $remainSec초 남음';
          } else {
            remainText = '약 ${(remainSec / 60).ceil()}분 남음';
          }

          return AlertDialog(
            title: Row(children: const [
              SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
              SizedBox(width: 10),
              Text('파일 전송 중'),
            ]),
            content: SizedBox(
              width: 520,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 전체 진행 — 굵은 바 + 퍼센트.
                  Row(children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(5),
                        child: LinearProgressIndicator(
                          value: pct,
                          minHeight: 10,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text('${(pct * 100).toStringAsFixed(0)}%',
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w700)),
                  ]),
                  const SizedBox(height: 8),
                  Text(
                    '${readableFileSize(done.toDouble())} / ${readableFileSize(total.toDouble())}'
                    '   ·   ${readableFileSize(speed)}/s   ·   $remainText',
                    style:
                        const TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                  const Divider(height: 22),
                  Text('파일 ${active.length}개',
                      style: const TextStyle(
                          fontSize: 12, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  // 파일별 진행 — 많으면 스크롤.
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 220),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: active.length,
                      itemBuilder: (_, i) {
                        final j = active[i];
                        final name =
                            j.fileName.isNotEmpty ? j.fileName : j.jobName;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 5),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(children: [
                                Icon(
                                    j.isRemoteToLocal
                                        ? Icons.south_west
                                        : Icons.north_east,
                                    size: 13,
                                    color: Colors.black45),
                                const SizedBox(width: 5),
                                Expanded(
                                  child: Text(name,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(fontSize: 12)),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  '${readableFileSize(j.finishedSize.toDouble())} / ${readableFileSize(j.totalSize.toDouble())}',
                                  style: const TextStyle(
                                      fontSize: 11, color: Colors.black54),
                                ),
                              ]),
                              const SizedBox(height: 3),
                              ClipRRect(
                                borderRadius: BorderRadius.circular(3),
                                child: LinearProgressIndicator(
                                  value: j.percent.clamp(0.0, 1.0),
                                  minHeight: 4,
                                ),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('백그라운드로'),
              ),
            ],
          );
        });
      },
    ).whenComplete(() {
      // 닫힌 뒤(사용자가 닫든 자동이든) 다음 배치에서 다시 뜰 수 있게 래치를 푼다.
      _transferDialogOpen = false;
    });
  }

  /// transfer status list
  /// watch transfer status
  Widget statusList() {
    Widget getIcon(JobProgress job) {
      final color = Theme.of(context).tabBarTheme.labelColor;
      switch (job.type) {
        case JobType.deleteDir:
        case JobType.deleteFile:
          return Icon(Icons.delete_outline, color: color);
        default:
          return Transform.rotate(
            angle: isWeb
                ? job.isRemoteToLocal
                    ? pi / 2
                    : pi / 2 * 3
                : job.isRemoteToLocal
                    ? pi
                    : 0,
            child: Icon(Icons.arrow_forward_ios, color: color),
          );
      }
    }

    statusListView(List<JobProgress> jobs) => ListView.builder(
          controller: ScrollController(),
          itemBuilder: (BuildContext context, int index) {
            final item = jobs[index];
            final status = item.getStatus();
            return Padding(
              padding: const EdgeInsets.only(bottom: 5),
              child: generateCard(
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        getIcon(item)
                            .marginSymmetric(horizontal: 10, vertical: 12),
                        Expanded(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Tooltip(
                                waitDuration: Duration(milliseconds: 500),
                                message: item.jobName,
                                child: ExtendedText(
                                  item.jobName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  overflowWidget: TextOverflowWidget(
                                      child: Text("..."),
                                      position: TextOverflowPosition.start),
                                ),
                              ),
                              Tooltip(
                                waitDuration: Duration(milliseconds: 500),
                                message: status,
                                child: Text(status,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: MyTheme.darkGray,
                                    )).marginOnly(top: 6),
                              ),
                              Offstage(
                                offstage: item.type != JobType.transfer ||
                                    item.state != JobState.inProgress,
                                child: LinearPercentIndicator(
                                  animateFromLastPercent: true,
                                  center: Text(item.percentText),
                                  barRadius: Radius.circular(15),
                                  percent: item.percent,
                                  progressColor: MyTheme.accent,
                                  backgroundColor: Theme.of(context).hoverColor,
                                  lineHeight: kDesktopFileTransferRowHeight,
                                ).paddingSymmetric(vertical: 8),
                              ),
                            ],
                          ),
                        ),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            Offstage(
                              offstage: item.state != JobState.paused,
                              child: MenuButton(
                                tooltip: translate("Resume"),
                                onPressed: () {
                                  jobController.resumeJob(item.id);
                                },
                                child: SvgPicture.asset(
                                  "assets/refresh.svg",
                                  colorFilter: svgColor(Colors.white),
                                ),
                                color: MyTheme.accent,
                                hoverColor: MyTheme.accent80,
                              ),
                            ),
                            MenuButton(
                              tooltip: translate("Delete"),
                              child: SvgPicture.asset(
                                "assets/close.svg",
                                colorFilter: svgColor(Colors.white),
                              ),
                              onPressed: () {
                                jobController.jobTable.removeAt(index);
                                jobController.cancelJob(item.id);
                              },
                              color: MyTheme.accent,
                              hoverColor: MyTheme.accent80,
                            ),
                          ],
                        ).marginAll(12),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
          itemCount: jobController.jobTable.length,
        );

    return PreferredSize(
      preferredSize: const Size(200, double.infinity),
      child: Container(
          margin: const EdgeInsets.only(top: 16.0, bottom: 16.0, right: 16.0),
          padding: const EdgeInsets.all(8.0),
          child: Obx(
            () => jobController.jobTable.isEmpty
                ? generateCard(
                    Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          SvgPicture.asset(
                            "assets/transfer.svg",
                            colorFilter: svgColor(
                                Theme.of(context).tabBarTheme.labelColor),
                            height: 40,
                          ).paddingOnly(bottom: 10),
                          Text(
                            translate("No transfers in progress"),
                            textAlign: TextAlign.center,
                            textScaler: TextScaler.linear(1.20),
                            style: TextStyle(
                                color:
                                    Theme.of(context).tabBarTheme.labelColor),
                          ),
                        ],
                      ),
                    ),
                  )
                : statusListView(jobController.jobTable),
          )),
    );
  }

  void handleDragDone(DropDoneDetails details, bool isLocal) {
    if (isLocal) {
      // ignore local
      return;
    }
    final items = SelectedItems(isLocal: false);
    for (var file in details.files) {
      final f = File(file.path);
      items.add(Entry()
        ..path = file.path
        ..name = file.name
        ..size = FileSystemEntity.isDirectorySync(f.path) ? 0 : f.lengthSync());
    }
    final otherSideData = model.localController.directoryData();
    model.remoteController.sendFiles(items, otherSideData);
  }

  // 방식1(2026-05-29). 파일전송 창 내부 드래그앤드롭.
  // 한 패널에서 끌어온 선택 파일을 반대편 패널로 보낸다. 보내기/받기 버튼과
  // 똑같은 sendFiles 규약을 따른다(보내는 controller.isLocal == items.isLocal).
  void _handleInAppDrop(SelectedItems dropped, bool targetIsLocal) {
    if (dropped.isLocal == targetIsLocal) return; // 같은 패널 → 무시
    if (!SelectedItems.valid(dropped.items)) return;
    if (dropped.isLocal) {
      // 로컬 → 원격
      model.localController
          .sendFiles(dropped, model.remoteController.directoryData());
      model.localController.selectedItems.clear();
    } else {
      // 원격 → 로컬
      model.remoteController
          .sendFiles(dropped, model.localController.directoryData());
      model.remoteController.selectedItems.clear();
    }
  }
}

class FileManagerView extends StatefulWidget {
  final FileController controller;
  final FFI _ffi;
  final Rx<MouseFocusScope> _mouseFocusScope;

  FileManagerView(this.controller, this._ffi, this._mouseFocusScope);

  @override
  State<StatefulWidget> createState() => _FileManagerViewState();
}

class _FileManagerViewState extends State<FileManagerView> {
  final _locationStatus = LocationStatus.bread.obs;
  final _locationNode = FocusNode();
  final _locationBarKey = GlobalKey();
  final _searchText = "".obs;
  final _breadCrumbScroller = ScrollController();
  final _keyboardNode = FocusNode();
  final _listSearchBuffer = TimeoutStringBuffer();
  final _nameColWidth = 0.0.obs;
  final _modifiedColWidth = 0.0.obs;
  final _sizeColWidth = 0.0.obs;
  final _fileListScrollController = ScrollController();
  final _globalHeaderKey = GlobalKey();

  /// [_lastClickTime], [_lastClickEntry] help to handle double click
  var _lastClickTime =
      DateTime.now().millisecondsSinceEpoch - bind.getDoubleClickTime() - 1000;
  Entry? _lastClickEntry;

  double? _windowWidthPrev;
  double _fileTransferMinimumWidth = 0.0;

  FileController get controller => widget.controller;
  bool get isLocal => widget.controller.isLocal;
  FFI get _ffi => widget._ffi;
  SelectedItems get selectedItems => controller.selectedItems;

  @override
  void initState() {
    super.initState();
    // register location listener
    _locationNode.addListener(onLocationFocusChanged);
    controller.directory.listen((e) => breadCrumbScrollToEnd());
  }

  @override
  void dispose() {
    _locationNode.removeListener(onLocationFocusChanged);
    _locationNode.dispose();
    _keyboardNode.dispose();
    _breadCrumbScroller.dispose();
    _fileListScrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _handleColumnPorportions();
    // A안. 로컬은 파랑, 원격은 빨강 박스로 영역을 구분한다.
    final accent =
        isLocal ? const Color(0xFF3182F6) : const Color(0xFFE5484D);
    return Container(
      margin: const EdgeInsets.all(12.0),
      padding: const EdgeInsets.all(8.0),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        borderRadius: BorderRadius.circular(12.0),
        border: Border.all(color: accent, width: 2.0),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          headTools(),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 좌측 폴더 트리. 코이노·탐색기식 빠른 폴더 이동.
                FolderTreePane(controller: controller, accentColor: accent),
                Expanded(
                    child: MouseRegion(
                  onEnter: (evt) {
                    widget._mouseFocusScope.value = isLocal
                        ? MouseFocusScope.local
                        : MouseFocusScope.remote;
                    _keyboardNode.requestFocus();
                  },
                  onExit: (evt) =>
                      widget._mouseFocusScope.value = MouseFocusScope.none,
                  child: _buildFileList(context, _fileListScrollController),
                ))
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _handleColumnPorportions() {
    final windowWidthNow = MediaQuery.of(context).size.width;
    if (_windowWidthPrev == null) {
      _windowWidthPrev = windowWidthNow;
      // 이름 칸은 확장자까지 보이도록 넓게, 수정일·크기는 좁게 잡는다.
      _fileTransferMinimumWidth = windowWidthNow * 0.04;
      _nameColWidth.value = windowWidthNow * 0.19;
      _modifiedColWidth.value = windowWidthNow * 0.10;
      _sizeColWidth.value = windowWidthNow * 0.055;
    }

    if (_windowWidthPrev != windowWidthNow) {
      final difference = windowWidthNow / _windowWidthPrev!;
      _windowWidthPrev = windowWidthNow;
      _fileTransferMinimumWidth *= difference;
      _nameColWidth.value *= difference;
      _modifiedColWidth.value *= difference;
      _sizeColWidth.value *= difference;
    }
  }

  void onLocationFocusChanged() {
    debugPrint("focus changed on local");
    if (_locationNode.hasFocus) {
      // ignore
    } else {
      // lost focus, change to bread
      if (_locationStatus.value != LocationStatus.fileSearchBar) {
        _locationStatus.value = LocationStatus.bread;
      }
    }
  }

  Widget headTools() {
    var uploadButtonTapPosition = RelativeRect.fill;
    // A안. 로컬은 파랑, 원격은 빨강 헤더 톤.
    final accent = isLocal ? const Color(0xFF3182F6) : const Color(0xFFE5484D);
    final headerBg = isLocal ? const Color(0xFFEAF2FE) : const Color(0xFFFDECEC);
    RxBool isUploadFolder =
        (bind.mainGetLocalOption(key: 'upload-folder-button') == 'Y').obs;
    return Container(
      child: Column(
        children: [
          // symbols
          PreferredSize(
                  child: Container(
                    decoration: BoxDecoration(
                      color: headerBg,
                      borderRadius: BorderRadius.all(Radius.circular(10)),
                    ),
                    padding:
                        EdgeInsets.symmetric(horizontal: 10.0, vertical: 8.0),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Container(
                            width: 50,
                            height: 50,
                            decoration: BoxDecoration(
                              borderRadius:
                                  BorderRadius.all(Radius.circular(8)),
                              color: accent,
                            ),
                          padding: EdgeInsets.all(8.0),
                          child: FutureBuilder<String>(
                              future: bind.sessionGetPlatform(
                                  sessionId: _ffi.sessionId,
                                  isRemote: !isLocal),
                              builder: (context, snapshot) {
                                if (snapshot.hasData &&
                                    snapshot.data!.isNotEmpty) {
                                  return getPlatformImage('${snapshot.data}');
                                } else {
                                  return CircularProgressIndicator(
                                    color: Theme.of(context)
                                        .tabBarTheme
                                        .labelColor,
                                  );
                                }
                              })),
                      Text(isLocal
                              ? translate("Local Computer")
                              : translate("Remote Computer"))
                          .marginOnly(left: 8.0)
                    ],
                  ),
                  ),
                  preferredSize: Size(double.infinity, 70))
              .paddingOnly(bottom: 15),
          // buttons
          Row(
            children: [
              Row(
                children: [
                  MenuButton(
                    tooltip: translate('Back'),
                    padding: EdgeInsets.only(
                      right: 3,
                    ),
                    child: Icon(
                      Icons.arrow_back,
                      size: 18,
                      color: Theme.of(context).tabBarTheme.labelColor,
                    ),
                    color: Theme.of(context).cardColor,
                    hoverColor: Theme.of(context).hoverColor,
                    onPressed: () {
                      selectedItems.clear();
                      controller.goBack();
                    },
                  ),
                  MenuButton(
                    tooltip: translate('Parent directory'),
                    child: Icon(
                      Icons.arrow_upward,
                      size: 18,
                      color: Theme.of(context).tabBarTheme.labelColor,
                    ),
                    color: Theme.of(context).cardColor,
                    hoverColor: Theme.of(context).hoverColor,
                    onPressed: () {
                      selectedItems.clear();
                      controller.goToParentDirectory();
                    },
                  ),
                ],
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 3.0),
                  child: Container(
                    decoration: BoxDecoration(
                      color: Theme.of(context).cardColor,
                      borderRadius: BorderRadius.all(
                        Radius.circular(8.0),
                      ),
                    ),
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 2.5),
                      child: GestureDetector(
                        onTap: () {
                          _locationStatus.value =
                              _locationStatus.value == LocationStatus.bread
                                  ? LocationStatus.pathLocation
                                  : LocationStatus.bread;
                          Future.delayed(Duration.zero, () {
                            if (_locationStatus.value ==
                                LocationStatus.pathLocation) {
                              _locationNode.requestFocus();
                            }
                          });
                        },
                        child: Obx(
                          () => Container(
                            child: Row(
                              children: [
                                Expanded(
                                    child: _locationStatus.value ==
                                            LocationStatus.bread
                                        ? buildBread()
                                        : buildPathLocation()),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              Obx(() {
                switch (_locationStatus.value) {
                  case LocationStatus.bread:
                    return MenuButton(
                      tooltip: translate('Search'),
                      onPressed: () {
                        _locationStatus.value = LocationStatus.fileSearchBar;
                        Future.delayed(
                            Duration.zero, () => _locationNode.requestFocus());
                      },
                      child: SvgPicture.asset(
                        "assets/search.svg",
                        colorFilter:
                            svgColor(Theme.of(context).tabBarTheme.labelColor),
                      ),
                      color: Theme.of(context).cardColor,
                      hoverColor: Theme.of(context).hoverColor,
                    );
                  case LocationStatus.pathLocation:
                    return MenuButton(
                      onPressed: null,
                      child: SvgPicture.asset(
                        "assets/close.svg",
                        colorFilter:
                            svgColor(Theme.of(context).tabBarTheme.labelColor),
                      ),
                      color: Theme.of(context).disabledColor,
                      hoverColor: Theme.of(context).hoverColor,
                    );
                  case LocationStatus.fileSearchBar:
                    return MenuButton(
                      tooltip: translate('Clear'),
                      onPressed: () {
                        onSearchText("", isLocal);
                        _locationStatus.value = LocationStatus.bread;
                      },
                      child: SvgPicture.asset(
                        "assets/close.svg",
                        colorFilter:
                            svgColor(Theme.of(context).tabBarTheme.labelColor),
                      ),
                      color: Theme.of(context).cardColor,
                      hoverColor: Theme.of(context).hoverColor,
                    );
                }
              }),
              // 미사용 새로고침 버튼은 없앴다. 돋보기만 남긴다.
            ],
          ),
          Row(
            textDirection: isLocal ? TextDirection.ltr : TextDirection.rtl,
            children: [
              Expanded(
                child: Row(
                  mainAxisAlignment:
                      isLocal ? MainAxisAlignment.start : MainAxisAlignment.end,
                  children: [
                    MenuButton(
                      tooltip: translate('Home'),
                      padding: EdgeInsets.only(
                        right: 3,
                      ),
                      onPressed: () {
                        controller.goToHomeDirectory();
                      },
                      child: SvgPicture.asset(
                        "assets/home.svg",
                        colorFilter:
                            svgColor(const Color(0xFF2962FF)), // 홈 = 파랑
                      ),
                      color: Theme.of(context).cardColor,
                      hoverColor: Theme.of(context).hoverColor,
                    ),
                    MenuButton(
                      tooltip: translate('Create Folder'),
                      onPressed: () {
                        final name = TextEditingController();
                        String? errorText;
                        _ffi.dialogManager.show((setState, close, context) {
                          name.addListener(() {
                            if (errorText != null) {
                              setState(() {
                                errorText = null;
                              });
                            }
                          });
                          submit() {
                            if (name.value.text.isNotEmpty) {
                              if (!PathUtil.validName(name.value.text,
                                  controller.options.value.isWindows)) {
                                setState(() {
                                  errorText = translate("Invalid folder name");
                                });
                                return;
                              }
                              controller.createDir(PathUtil.join(
                                controller.directory.value.path,
                                name.value.text,
                                controller.options.value.isWindows,
                              ));
                              close();
                            }
                          }

                          cancel() => close(false);
                          return CustomAlertDialog(
                            title: Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                SvgPicture.asset("assets/folder_new.svg",
                                    colorFilter: svgColor(MyTheme.accent)),
                                Text(
                                  translate("Create Folder"),
                                ).paddingOnly(
                                  left: 10,
                                ),
                              ],
                            ),
                            content: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                TextFormField(
                                  decoration: InputDecoration(
                                    labelText: translate(
                                      "Please enter the folder name",
                                    ),
                                    errorText: errorText,
                                  ),
                                  controller: name,
                                  autofocus: true,
                                ).workaroundFreezeLinuxMint(),
                              ],
                            ),
                            actions: [
                              dialogButton(
                                "Cancel",
                                icon: Icon(Icons.close_sharp),
                                onPressed: cancel,
                                isOutline: true,
                              ),
                              dialogButton(
                                "Ok",
                                icon: Icon(Icons.done_sharp),
                                onPressed: submit,
                              ),
                            ],
                            onSubmit: submit,
                            onCancel: cancel,
                          );
                        });
                      },
                      child: SvgPicture.asset(
                        "assets/folder_new.svg",
                        colorFilter:
                            svgColor(const Color(0xFFFFC107)), // 새 폴더 = 노랑
                      ),
                      color: Theme.of(context).cardColor,
                      hoverColor: Theme.of(context).hoverColor,
                    ),
                    Obx(() => MenuButton(
                          tooltip: translate('Delete'),
                          onPressed: SelectedItems.valid(selectedItems.items)
                              ? () async {
                                  await (controller
                                      .removeAction(selectedItems));
                                  selectedItems.clear();
                                }
                              : null,
                          child: SvgPicture.asset(
                            "assets/trash.svg",
                            colorFilter:
                                svgColor(const Color(0xFFE53935)), // 휴지통 = 빨강
                          ),
                          color: Theme.of(context).cardColor,
                          hoverColor: Theme.of(context).hoverColor,
                        )),
                    // ChainRemote: 복사/잘라내기/붙여넣기 — 탐색기 관례.
                    //   빈 폴더에선 우클릭할 항목이 없으므로 붙여넣기는 툴바가 유일 통로.
                    Obx(() => MenuButton(
                          tooltip: translate('Copy'),
                          onPressed: SelectedItems.valid(selectedItems.items)
                              ? () => _ffi.fileModel.setFileClipboard(
                                  isLocal, false, selectedItems.items.toList())
                              : null,
                          child: Icon(
                            Icons.copy,
                            size: 18,
                            color: Theme.of(context).tabBarTheme.labelColor,
                          ),
                          color: Theme.of(context).cardColor,
                          hoverColor: Theme.of(context).hoverColor,
                        )),
                    Obx(() => MenuButton(
                          tooltip: translate('Cut'),
                          onPressed: SelectedItems.valid(selectedItems.items)
                              ? () => _ffi.fileModel.setFileClipboard(
                                  isLocal, true, selectedItems.items.toList())
                              : null,
                          child: Icon(
                            Icons.cut,
                            size: 18,
                            color: Theme.of(context).tabBarTheme.labelColor,
                          ),
                          color: Theme.of(context).cardColor,
                          hoverColor: Theme.of(context).hoverColor,
                        )),
                    Obx(() {
                      final clip = _ffi.fileModel.fileClipboard.value;
                      final enabled =
                          clip != null && _pasteAllowed(clip, isLocal);
                      return MenuButton(
                        tooltip: translate('Paste'),
                        onPressed: enabled
                            ? () => _ffi.fileModel.pasteFileClipboard(isLocal)
                            : null,
                        child: Icon(
                          Icons.paste,
                          size: 18,
                          color: Theme.of(context).tabBarTheme.labelColor,
                        ),
                        color: Theme.of(context).cardColor,
                        hoverColor: Theme.of(context).hoverColor,
                      );
                    }),
                    menu(isLocal: isLocal),
                  ],
                ),
              ),
              if (isWeb)
                Obx(() => ElevatedButton.icon(
                      style: ButtonStyle(
                        padding: MaterialStateProperty.all<EdgeInsetsGeometry>(
                            isLocal
                                ? EdgeInsets.only(left: 10)
                                : EdgeInsets.only(right: 10)),
                        backgroundColor: MaterialStateProperty.all(
                          selectedItems.items.isEmpty
                              ? MyTheme.accent80
                              : MyTheme.accent,
                        ),
                      ),
                      onPressed: () =>
                          {webselectFiles(is_folder: isUploadFolder.value)},
                      label: InkWell(
                        hoverColor: Colors.transparent,
                        splashColor: Colors.transparent,
                        highlightColor: Colors.transparent,
                        focusColor: Colors.transparent,
                        onTapDown: (e) {
                          final x = e.globalPosition.dx;
                          final y = e.globalPosition.dy;
                          uploadButtonTapPosition =
                              RelativeRect.fromLTRB(x, y, x, y);
                        },
                        onTap: () async {
                          final value = await showMenu<bool>(
                              context: context,
                              position: uploadButtonTapPosition,
                              items: [
                                PopupMenuItem<bool>(
                                  value: false,
                                  child: Text(translate('Upload files')),
                                ),
                                PopupMenuItem<bool>(
                                  value: true,
                                  child: Text(translate('Upload folder')),
                                ),
                              ]);
                          if (value != null) {
                            isUploadFolder.value = value;
                            bind.mainSetLocalOption(
                                key: 'upload-folder-button',
                                value: value ? 'Y' : '');
                            webselectFiles(is_folder: value);
                          }
                        },
                        child: Icon(Icons.arrow_drop_down),
                      ),
                      icon: Text(
                        translate(isUploadFolder.isTrue
                            ? 'Upload folder'
                            : 'Upload files'),
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          color: Colors.white,
                        ),
                      ).marginOnly(left: 8),
                    )).marginOnly(left: 16),
              Obx(() => ElevatedButton.icon(
                    style: ButtonStyle(
                      padding: MaterialStateProperty.all<EdgeInsetsGeometry>(
                          isLocal
                              ? EdgeInsets.only(left: 10)
                              : EdgeInsets.only(right: 10)),
                      backgroundColor: MaterialStateProperty.all(
                        selectedItems.items.isEmpty
                            ? MyTheme.accent80
                            : MyTheme.accent,
                      ),
                    ),
                    onPressed: SelectedItems.valid(selectedItems.items)
                        ? () {
                            final otherSideData =
                                controller.getOtherSideDirectoryData();
                            controller.sendFiles(selectedItems, otherSideData);
                            selectedItems.clear();
                          }
                        : null,
                    icon: isLocal
                        ? Text(
                            translate('Send'),
                            textAlign: TextAlign.right,
                            style: TextStyle(
                              color: selectedItems.items.isEmpty
                                  ? Theme.of(context).brightness ==
                                          Brightness.light
                                      ? MyTheme.grayBg
                                      : MyTheme.darkGray
                                  : Colors.white,
                            ),
                          )
                        : isWeb
                            ? Offstage()
                            : RotatedBox(
                                quarterTurns: 2,
                                child: SvgPicture.asset(
                                  "assets/arrow.svg",
                                  colorFilter: svgColor(
                                      selectedItems.items.isEmpty
                                          ? Theme.of(context).brightness ==
                                                  Brightness.light
                                              ? MyTheme.grayBg
                                              : MyTheme.darkGray
                                          : Colors.white),
                                  alignment: Alignment.bottomRight,
                                ),
                              ),
                    label: isLocal
                        ? SvgPicture.asset(
                            "assets/arrow.svg",
                            colorFilter: svgColor(selectedItems.items.isEmpty
                                ? Theme.of(context).brightness ==
                                        Brightness.light
                                    ? MyTheme.grayBg
                                    : MyTheme.darkGray
                                : Colors.white),
                          )
                        : Text(
                            translate(isWeb ? 'Download' : 'Receive'),
                            style: TextStyle(
                              color: selectedItems.items.isEmpty
                                  ? Theme.of(context).brightness ==
                                          Brightness.light
                                      ? MyTheme.grayBg
                                      : MyTheme.darkGray
                                  : Colors.white,
                            ),
                          ),
                  )),
            ],
          ).marginOnly(top: 8.0)
        ],
      ),
    );
  }

  Widget menu({bool isLocal = false}) {
    var menuPos = RelativeRect.fill;

    final List<MenuEntryBase<String>> items = [
      MenuEntrySwitch<String>(
        switchType: SwitchType.scheckbox,
        text: translate("Show Hidden Files"),
        getter: () async {
          return controller.options.value.showHidden;
        },
        setter: (bool v) async {
          controller.toggleShowHidden();
        },
        padding: kDesktopMenuPadding,
        dismissOnClicked: true,
      ),
      MenuEntryButton(
          childBuilder: (style) => Text(translate("Select All"), style: style),
          proc: () => setState(() =>
              selectedItems.selectAll(controller.directory.value.entries)),
          padding: kDesktopMenuPadding,
          dismissOnClicked: true),
      MenuEntryButton(
          childBuilder: (style) =>
              Text(translate("Unselect All"), style: style),
          proc: () => selectedItems.clear(),
          padding: kDesktopMenuPadding,
          dismissOnClicked: true)
    ];

    return Listener(
      onPointerDown: (e) {
        final x = e.position.dx;
        final y = e.position.dy;
        menuPos = RelativeRect.fromLTRB(x, y, x, y);
      },
      child: MenuButton(
        tooltip: translate('More'),
        onPressed: () => mod_menu.showMenu(
          context: context,
          position: menuPos,
          items: items
              .map(
                (e) => e.build(
                  context,
                  MenuConfig(
                      commonColor: CustomPopupMenuTheme.commonColor,
                      height: CustomPopupMenuTheme.height,
                      dividerHeight: CustomPopupMenuTheme.dividerHeight),
                ),
              )
              .expand((i) => i)
              .toList(),
          elevation: 8,
        ),
        child: SvgPicture.asset(
          "assets/dots.svg",
          colorFilter:
              svgColor(const Color(0xFF607D8B)), // 더보기 = 청회색
        ),
        color: Theme.of(context).cardColor,
        hoverColor: Theme.of(context).hoverColor,
      ),
    );
  }

  Widget _buildFileList(
      BuildContext context, ScrollController scrollController) {
    final fd = controller.directory.value;
    final entries = fd.entries;
    Rx<Entry?> rightClickEntry = Rx(null);

    return ListSearchActionListener(
      node: _keyboardNode,
      buffer: _listSearchBuffer,
      onNext: (buffer) {
        debugPrint("searching next for $buffer");
        assert(buffer.length == 1);
        assert(selectedItems.items.length <= 1);
        var skipCount = 0;
        if (selectedItems.items.isNotEmpty) {
          final index = entries.indexOf(selectedItems.items.first);
          if (index < 0) {
            return;
          }
          skipCount = index + 1;
        }
        var searchResult = entries
            .skip(skipCount)
            .where((element) => element.name.toLowerCase().startsWith(buffer));
        if (searchResult.isEmpty) {
          // cannot find next, lets restart search from head
          debugPrint("restart search from head");
          searchResult = entries.where(
              (element) => element.name.toLowerCase().startsWith(buffer));
        }
        if (searchResult.isEmpty) {
          selectedItems.clear();
          return;
        }
        _jumpToEntry(isLocal, searchResult.first, scrollController,
            kDesktopFileTransferRowHeight);
      },
      onSearch: (buffer) {
        debugPrint("searching for $buffer");
        final selectedEntries = selectedItems;
        final searchResult = entries
            .where((element) => element.name.toLowerCase().startsWith(buffer));
        selectedEntries.clear();
        if (searchResult.isEmpty) {
          selectedItems.clear();
          return;
        }
        _jumpToEntry(isLocal, searchResult.first, scrollController,
            kDesktopFileTransferRowHeight);
      },
      child: Obx(() {
        final entries = controller.directory.value.entries;
        final filteredEntries = _searchText.isNotEmpty
            ? entries.where((element) {
                return element.name.contains(_searchText.value);
              }).toList(growable: false)
            : entries;
        final rows = filteredEntries.map((entry) {
          final sizeStr =
              entry.isFile ? readableFileSize(entry.size.toDouble()) : "";
          final lastModifiedStr = entry.isDrive
              ? " "
              : "${entry.lastModified().toString().replaceAll(".000", "")}   ";
          var secondaryPosition = RelativeRect.fromLTRB(0, 0, 0, 0);
          onTap() {
            final items = selectedItems;
            // handle double click
            if (_checkDoubleClick(entry)) {
              controller.openDirectory(entry.path);
              items.clear();
              return;
            }
            _onSelectedChanged(items, filteredEntries, entry, isLocal);
          }

          onSecondaryTap() {
            // ChainRemote: 우클릭한 항목이 선택에 포함돼 있으면 선택 전체를, 아니면 그 항목만.
            final clipEntries = selectedItems.items.contains(entry)
                ? selectedItems.items.toList()
                : [entry];
            final clip = _ffi.fileModel.fileClipboard.value;
            final items = [
              if (!entry.isDrive &&
                  versionCmp(_ffi.ffiModel.pi.version, "1.3.0") >= 0)
                mod_menu.PopupMenuItem(
                  child: Text(translate("Rename File")),
                  height: CustomPopupMenuTheme.height,
                  onTap: () {
                    controller.renameAction(entry, isLocal);
                  },
                ),
              // ChainRemote: 복사/잘라내기/붙여넣기 — 탐색기 관례. 같은 쪽 붙여넣기는 내부
              //   복사/이동(원격이면 에이전트 1.4.74+), 반대쪽 붙여넣기는 기존 전송 재사용.
              if (!entry.isDrive)
                mod_menu.PopupMenuItem(
                  child: Text(translate("Copy")),
                  height: CustomPopupMenuTheme.height,
                  onTap: () =>
                      _ffi.fileModel.setFileClipboard(isLocal, false, clipEntries),
                ),
              if (!entry.isDrive)
                mod_menu.PopupMenuItem(
                  child: Text(translate("Cut")),
                  height: CustomPopupMenuTheme.height,
                  onTap: () =>
                      _ffi.fileModel.setFileClipboard(isLocal, true, clipEntries),
                ),
              if (clip != null && _pasteAllowed(clip, isLocal))
                mod_menu.PopupMenuItem(
                  child: Text(translate("Paste")),
                  height: CustomPopupMenuTheme.height,
                  onTap: () => _ffi.fileModel.pasteFileClipboard(isLocal),
                ),
              // ChainRemote: 실행 — 원격 파일을 연결 프로그램으로 연다(에이전트 1.4.74+).
              if (!isLocal && entry.isFile && _agentSupportsFileOps())
                mod_menu.PopupMenuItem(
                  child: Text(translate("Run")),
                  height: CustomPopupMenuTheme.height,
                  onTap: () => controller.execAction(entry),
                ),
              // ChainRemote: 속성 — 이름/종류/크기/수정일/전체 경로. 원격 파일을 옮기기 전에
              //   크기와 날짜를 확인하려면 탐색기 속성이 필요했는데 파일전송 창엔 없었다.
              //   드라이브도 경로 확인용으로 열어둔다(크기·날짜는 의미 없어 생략됨).
              mod_menu.PopupMenuItem(
                child: const Text('속성'),
                height: CustomPopupMenuTheme.height,
                onTap: () => _showEntryProperties(context, entry, isLocal),
              ),
            ];
            if (items.isNotEmpty) {
              rightClickEntry.value = entry;
              final future = mod_menu.showMenu(
                context: context,
                position: secondaryPosition,
                items: items,
              );
              future.then((value) {
                rightClickEntry.value = null;
              });
              future.onError((error, stackTrace) {
                rightClickEntry.value = null;
              });
            }
          }

          onSecondaryTapDown(details) {
            secondaryPosition = RelativeRect.fromLTRB(
                details.globalPosition.dx,
                details.globalPosition.dy,
                details.globalPosition.dx,
                details.globalPosition.dy);
          }

          return Padding(
            padding: EdgeInsets.symmetric(vertical: 1),
            // 방식1. 파일 행을 끌어 반대편 패널에 떨구면 전송된다.
            child: Draggable<SelectedItems>(
              data: _buildDragPayload(entry, selectedItems, isLocal),
              dragAnchorStrategy: pointerDragAnchorStrategy,
              maxSimultaneousDrags: entry.isDrive ? 0 : null,
              feedback: _buildDragFeedback(context, entry, selectedItems),
              child: Obx(() => Container(
                decoration: BoxDecoration(
                  color: selectedItems.items.contains(entry)
                      ? MyTheme.button
                      : Theme.of(context).cardColor,
                  borderRadius: BorderRadius.all(
                    Radius.circular(5.0),
                  ),
                  border: rightClickEntry.value == entry
                      ? Border.all(
                          color: MyTheme.button,
                          width: 1.0,
                        )
                      : null,
                ),
                key: ValueKey(entry.name),
                height: kDesktopFileTransferRowHeight,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Expanded(
                      child: InkWell(
                        child: Row(
                          children: [
                            GestureDetector(
                              child: Obx(
                                () => Container(
                                    width: _nameColWidth.value,
                                    child: Tooltip(
                                      waitDuration: Duration(milliseconds: 500),
                                      message: entry.name,
                                      child: Row(children: [
                                        entry.isDrive
                                            ? Image(
                                                    image: iconHardDrive,
                                                    fit: BoxFit.scaleDown,
                                                    color: Theme.of(context)
                                                        .iconTheme
                                                        .color
                                                        ?.withOpacity(0.7))
                                                .paddingAll(4)
                                            : Padding(
                                                padding: const EdgeInsets.symmetric(
                                                    horizontal: 4, vertical: 2),
                                                child: Icon(
                                                  _fileIconFor(entry.name,
                                                      isFile: entry.isFile),
                                                  size: 20,
                                                  color: _fileIconColor(
                                                      entry.name,
                                                      isFile: entry.isFile),
                                                ),
                                              ),
                                        Expanded(
                                            child: Text(entry.name.nonBreaking,
                                                style: TextStyle(
                                                    color: selectedItems.items
                                                            .contains(entry)
                                                        ? Colors.white
                                                        : null),
                                                overflow:
                                                    TextOverflow.ellipsis))
                                      ]),
                                    )),
                              ),
                              onTap: onTap,
                              onSecondaryTap: onSecondaryTap,
                              onSecondaryTapDown: onSecondaryTapDown,
                            ),
                            SizedBox(
                              width: 2.0,
                            ),
                            GestureDetector(
                              child: Obx(
                                () => SizedBox(
                                  width: _modifiedColWidth.value,
                                  child: Tooltip(
                                      waitDuration: Duration(milliseconds: 500),
                                      message: lastModifiedStr,
                                      child: Text(
                                        lastModifiedStr,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: selectedItems.items
                                                  .contains(entry)
                                              ? Colors.white70
                                              : MyTheme.darkGray,
                                        ),
                                      )),
                                ),
                              ),
                              onTap: onTap,
                              onSecondaryTap: onSecondaryTap,
                              onSecondaryTapDown: onSecondaryTapDown,
                            ),
                            // Divider from header.
                            SizedBox(
                              width: 2.0,
                            ),
                            Expanded(
                              // width: 100,
                              child: GestureDetector(
                                child: Tooltip(
                                  waitDuration: Duration(milliseconds: 500),
                                  message: sizeStr,
                                  child: Text(
                                    sizeStr,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                        fontSize: 10,
                                        color:
                                            selectedItems.items.contains(entry)
                                                ? Colors.white70
                                                : MyTheme.darkGray),
                                  ),
                                ),
                                onTap: onTap,
                                onSecondaryTap: onSecondaryTap,
                                onSecondaryTapDown: onSecondaryTapDown,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                )))),
          );
        }).toList(growable: false);

        return Column(
          children: [
            // Header
            Row(
              children: [
                Expanded(child: _buildFileBrowserHeader(context)),
              ],
            ),
            // Body
            Expanded(
              child: ListView.builder(
                controller: scrollController,
                itemExtent: kDesktopFileTransferRowHeight,
                itemBuilder: (context, index) {
                  return rows[index];
                },
                itemCount: rows.length,
              ),
            ),
          ],
        );
      }),
    );
  }

  onSearchText(String searchText, bool isLocal) {
    selectedItems.clear();
    _searchText.value = searchText;
  }

  void _jumpToEntry(bool isLocal, Entry entry,
      ScrollController scrollController, double rowHeight) {
    final entries = controller.directory.value.entries;
    final index = entries.indexOf(entry);
    if (index == -1) {
      debugPrint("entry is not valid: ${entry.path}");
    }
    final selectedEntries = selectedItems;
    final searchResult = entries.where((element) => element == entry);
    selectedEntries.clear();
    if (searchResult.isEmpty) {
      return;
    }
    final offset = min(
        max(scrollController.position.minScrollExtent,
            entries.indexOf(searchResult.first) * rowHeight),
        scrollController.position.maxScrollExtent);
    scrollController.jumpTo(offset);
    selectedEntries.add(searchResult.first);
    debugPrint("focused on ${searchResult.first.name}");
  }

  void _onSelectedChanged(SelectedItems selectedItems, List<Entry> entries,
      Entry entry, bool isLocal) {
    final isCtrlDown = RawKeyboard.instance.keysPressed
            .contains(LogicalKeyboardKey.controlLeft) ||
        RawKeyboard.instance.keysPressed
            .contains(LogicalKeyboardKey.controlRight);
    final isShiftDown = RawKeyboard.instance.keysPressed
            .contains(LogicalKeyboardKey.shiftLeft) ||
        RawKeyboard.instance.keysPressed
            .contains(LogicalKeyboardKey.shiftRight);
    if (isCtrlDown) {
      if (selectedItems.items.contains(entry)) {
        selectedItems.remove(entry);
      } else {
        selectedItems.add(entry);
      }
    } else if (isShiftDown) {
      final List<int> indexGroup = [];
      for (var selected in selectedItems.items) {
        indexGroup.add(entries.indexOf(selected));
      }
      indexGroup.add(entries.indexOf(entry));
      indexGroup.removeWhere((e) => e == -1);
      final maxIndex = indexGroup.reduce(max);
      final minIndex = indexGroup.reduce(min);
      selectedItems.clear();
      entries
          .getRange(minIndex, maxIndex + 1)
          .forEach((e) => selectedItems.add(e));
    } else {
      selectedItems.clear();
      selectedItems.add(entry);
    }
    setState(() {});
  }

  bool _checkDoubleClick(Entry entry) {
    final current = DateTime.now().millisecondsSinceEpoch;
    final elapsed = current - _lastClickTime;
    _lastClickTime = current;
    if (_lastClickEntry == entry) {
      if (elapsed < bind.getDoubleClickTime()) {
        return true;
      }
    } else {
      _lastClickEntry = entry;
    }
    return false;
  }

  // ChainRemote: 이 패널에 붙여넣기가 가능한 상태인가.
  //   같은 쪽 = 내부 복사/이동(원격 패널이면 에이전트 1.4.74+ 필요),
  //   반대쪽 = 기존 전송 재사용(잘라내기는 유실 위험 때문에 같은 쪽 전용).
  bool _pasteAllowed(FileClipboardData clip, bool isLocal) {
    if (clip.isLocal == isLocal) {
      if (!isLocal && !_agentSupportsFileOps()) return false;
    } else {
      if (clip.isCut) return false;
    }
    return true;
  }

  // ChainRemote: 에이전트가 원격 내부 복사/실행(FileCopy/FileExecute)을 아는가.
  //   ★pi.version 으로 판단하면 안 된다 — 그건 Cargo.toml 의 RustDesk 베이스 버전(1.4.6)이라
  //   우리 버전이 아무리 올라가도 그대로다(2026-07-31 실사고: 이 오판으로 붙여넣기가 어느
  //   거래처에서도 안 떴다). 에이전트가 platform_additions 로 보내는 우리 버전을 본다.
  bool _agentSupportsFileOps() {
    final v = _ffi.ffiModel.pi.platformAdditions['chainremote_version'];
    if (v is! String || v.isEmpty) return false;
    return versionCmp(v, '1.4.74') >= 0;
  }

  // ChainRemote: 파일/폴더 속성 — 탐색기 속성창의 실무용 최소판.
  //   원격 파일을 받거나 지우기 전에 크기·수정일·전체 경로를 확인하려면 필요한데
  //   파일전송 창엔 그 수단이 없었다(2026-07-30 Chang 요청).
  void _showEntryProperties(BuildContext context, Entry entry, bool isLocal) {
    final kind = entry.isDrive
        ? '드라이브'
        : (entry.isDirectory ? '폴더' : '파일');
    final rows = <List<String>>[
      ['이름', entry.name],
      ['종류', kind],
      // 폴더/드라이브는 하위 용량을 세지 않으므로(원격 순회 비용) 파일만 크기를 보여준다.
      if (entry.isFile)
        ['크기', '${readableFileSize(entry.size.toDouble())}  (${entry.size} 바이트)'],
      if (!entry.isDrive)
        ['수정한 날짜',
          entry.lastModified().toString().replaceAll('.000', '')],
      ['위치', isLocal ? '로컬 컴퓨터' : '원격 컴퓨터'],
      ['경로', entry.path],
    ];

    // ★showDialog(Navigator 라우트)를 쓰면 안 된다 — mod_menu 의 handleTap 이 onTap 직후
    //   Navigator.pop 을 부르는데, 그 pop 이 방금 띄운 다이얼로그를 도로 닫아버려 아무것도
    //   안 뜬 것처럼 보인다(2026-07-31 실사고). 이름 바꾸기가 멀쩡했던 건 오버레이 기반
    //   dialogManager 를 쓰기 때문 — 같은 방식으로 통일한다.
    _ffi.dialogManager.show((setState, close, context) => CustomAlertDialog(
          title: Text('속성 — ${entry.name}'),
          content: SizedBox(
            width: 460,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: rows
                  .map((r) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(
                              width: 92,
                              child: Text(r[0],
                                  style: const TextStyle(
                                      fontSize: 13, color: Colors.black54)),
                            ),
                            Expanded(
                              child: SelectableText(
                                r[1],
                                style: const TextStyle(fontSize: 13),
                              ),
                            ),
                          ],
                        ),
                      ))
                  .toList(),
            ),
          ),
          actions: [
            dialogButton(
              '경로 복사',
              icon: const Icon(Icons.copy, size: 18),
              isOutline: true,
              onPressed: () {
                Clipboard.setData(ClipboardData(text: entry.path));
                showToast(translate('Copied'));
              },
            ),
            dialogButton('닫기', onPressed: close),
          ],
          onCancel: close,
        ));
  }

  // 방식1(2026-05-29). 드래그 시작 payload.
  // entry 가 현재 선택에 들어 있으면 선택 전체를, 아니면 그 entry 하나만 담는다.
  // 원본 selectedItems 를 건드리지 않도록 새 객체에 복제한다.
  SelectedItems _buildDragPayload(
      Entry entry, SelectedItems current, bool isLocal) {
    final payload = SelectedItems(isLocal: isLocal);
    if (current.items.contains(entry)) {
      for (final e in current.items) {
        payload.add(e);
      }
    } else {
      payload.add(entry);
    }
    return payload;
  }

  // 드래그 중 마우스를 따라다니는 미리보기.
  Widget _buildDragFeedback(
      BuildContext context, Entry entry, SelectedItems current) {
    final count = current.items.contains(entry) ? current.items.length : 1;
    return Material(
      color: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: MyTheme.button,
          borderRadius: BorderRadius.circular(6),
          boxShadow: const [
            BoxShadow(color: Colors.black26, blurRadius: 6, offset: Offset(0, 2))
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.drive_file_move_outline,
                color: Colors.white, size: 16),
            const SizedBox(width: 6),
            Text(
              count > 1 ? '$count개 항목' : entry.name,
              style: const TextStyle(color: Colors.white, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }

  void _onDrag(double dx, RxDouble column1, RxDouble column2) {
    if (column1.value + dx <= _fileTransferMinimumWidth ||
        column2.value - dx <= _fileTransferMinimumWidth) {
      return;
    }
    column1.value += dx;
    column2.value -= dx;
    column1.value = max(_fileTransferMinimumWidth, column1.value);
    column2.value = max(_fileTransferMinimumWidth, column2.value);
  }

  Widget _buildFileBrowserHeader(BuildContext context) {
    final padding = EdgeInsets.all(1.0);
    return SizedBox(
      key: _globalHeaderKey,
      height: kDesktopFileTransferHeaderHeight,
      child: Row(
        children: [
          Obx(
            // translate("Name") 이 "거래처 이름"으로 번역돼(거래처 등록용) 여기선
            // 어색하므로, 파일전송 컬럼은 "이름"으로 직접 적는다.
            () => headerItemFunc(_nameColWidth.value, SortBy.name, '이름'),
          ),
          DraggableDivider(
            axis: Axis.vertical,
            onPointerMove: (dx) =>
                _onDrag(dx, _nameColWidth, _modifiedColWidth),
            padding: padding,
          ),
          Obx(
            () => headerItemFunc(_modifiedColWidth.value, SortBy.modified,
                translate("Modified")),
          ),
          DraggableDivider(
              axis: Axis.vertical,
              onPointerMove: (dx) =>
                  _onDrag(dx, _modifiedColWidth, _sizeColWidth),
              padding: padding),
          Expanded(
              child: headerItemFunc(
                  _sizeColWidth.value, SortBy.size, translate("Size")))
        ],
      ),
    );
  }

  Widget headerItemFunc(double? width, SortBy sortBy, String name) {
    final headerTextStyle =
        Theme.of(context).dataTableTheme.headingTextStyle ?? TextStyle();
    return ObxValue<Rx<bool?>>(
        (ascending) => InkWell(
              onTap: () {
                if (ascending.value == null) {
                  ascending.value = true;
                } else {
                  ascending.value = !ascending.value!;
                }
                controller.changeSortStyle(sortBy,
                    isLocal: isLocal, ascending: ascending.value!);
              },
              child: SizedBox(
                width: width,
                height: kDesktopFileTransferHeaderHeight,
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        style: headerTextStyle,
                        overflow: TextOverflow.ellipsis,
                      ).marginOnly(left: 4),
                    ),
                    ascending.value != null
                        ? Icon(
                            ascending.value!
                                ? Icons.keyboard_arrow_up_sharp
                                : Icons.keyboard_arrow_down_sharp,
                          )
                        : SizedBox()
                  ],
                ),
              ),
            ), () {
      if (controller.sortBy.value == sortBy) {
        return controller.sortAscending.obs;
      } else {
        return Rx<bool?>(null);
      }
    }());
  }

  Widget buildBread() {
    final items = getPathBreadCrumbItems(isLocal, (list) {
      var path = "";
      for (var item in list) {
        path = PathUtil.join(path, item, controller.options.value.isWindows);
      }
      controller.openDirectory(path);
    });

    return items.isEmpty
        ? Offstage()
        : Row(
            key: _locationBarKey,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
                Expanded(
                  child: Listener(
                    // handle mouse wheel
                    onPointerSignal: (e) {
                      if (e is PointerScrollEvent) {
                        final sc = _breadCrumbScroller;
                        final scale = isWindows ? 2 : 4;
                        sc.jumpTo(sc.offset + e.scrollDelta.dy / scale);
                      }
                    },
                    child: BreadCrumb(
                      items: items,
                      divider: const Icon(Icons.keyboard_arrow_right_sharp),
                      overflow: ScrollableOverflow(
                        controller: _breadCrumbScroller,
                      ),
                    ),
                  ),
                ),
                ActionIcon(
                  message: "",
                  icon: Icons.keyboard_arrow_down_sharp,
                  onTap: () async {
                    final renderBox = _locationBarKey.currentContext
                        ?.findRenderObject() as RenderBox;
                    _locationBarKey.currentContext?.size;

                    final size = renderBox.size;
                    final offset = renderBox.localToGlobal(Offset.zero);

                    final x = offset.dx;
                    final y = offset.dy + size.height + 1;

                    final isPeerWindows = controller.options.value.isWindows;
                    final List<MenuEntryBase> menuItems = [
                      MenuEntryButton(
                          childBuilder: (TextStyle? style) => isPeerWindows
                              ? buildWindowsThisPC(context, style)
                              : Text(
                                  '/',
                                  style: style,
                                ),
                          proc: () {
                            controller.openDirectory('/');
                          },
                          dismissOnClicked: true),
                      MenuEntryDivider()
                    ];
                    if (isPeerWindows) {
                      var loadingTag = "";
                      if (!isLocal) {
                        loadingTag = _ffi.dialogManager.showLoading("Waiting");
                      }
                      try {
                        final showHidden = controller.options.value.showHidden;
                        final fd = await controller.fileFetcher
                            .fetchDirectory("/", isLocal, showHidden);
                        for (var entry in fd.entries) {
                          menuItems.add(MenuEntryButton(
                              childBuilder: (TextStyle? style) =>
                                  Row(children: [
                                    Image(
                                        image: iconHardDrive,
                                        fit: BoxFit.scaleDown,
                                        color: Theme.of(context)
                                            .iconTheme
                                            .color
                                            ?.withOpacity(0.7)),
                                    SizedBox(width: 10),
                                    Text(
                                      entry.name,
                                      style: style,
                                    )
                                  ]),
                              proc: () {
                                controller.openDirectory('${entry.name}\\');
                              },
                              dismissOnClicked: true));
                        }
                        menuItems.add(MenuEntryDivider());
                      } catch (e) {
                        debugPrint("buildBread fetchDirectory err=$e");
                      } finally {
                        if (!isLocal) {
                          _ffi.dialogManager.dismissByTag(loadingTag);
                        }
                      }
                    }
                    mod_menu.showMenu(
                        context: context,
                        position: RelativeRect.fromLTRB(x, y, x, y),
                        elevation: 4,
                        items: menuItems
                            .map((e) => e.build(
                                context,
                                MenuConfig(
                                    commonColor:
                                        CustomPopupMenuTheme.commonColor,
                                    height: CustomPopupMenuTheme.height,
                                    dividerHeight:
                                        CustomPopupMenuTheme.dividerHeight,
                                    boxWidth: size.width)))
                            .expand((i) => i)
                            .toList());
                  },
                  iconSize: 20,
                )
              ]);
  }

  List<BreadCrumbItem> getPathBreadCrumbItems(
      bool isLocal, void Function(List<String>) onPressed) {
    final path = controller.directory.value.path;
    final breadCrumbList = List<BreadCrumbItem>.empty(growable: true);
    final isWindows = controller.options.value.isWindows;
    if (isWindows && path == '/') {
      breadCrumbList.add(BreadCrumbItem(
          content: TextButton(
                  child: buildWindowsThisPC(context),
                  style: ButtonStyle(
                      minimumSize: MaterialStateProperty.all(Size(0, 0))),
                  onPressed: () => onPressed(['/']))
              .marginSymmetric(horizontal: 4)));
    } else {
      final list = PathUtil.split(path, isWindows);
      breadCrumbList.addAll(
        list.asMap().entries.map(
              (e) => BreadCrumbItem(
                content: TextButton(
                  child: Text(e.value),
                  style: ButtonStyle(
                    minimumSize: MaterialStateProperty.all(
                      Size(0, 0),
                    ),
                  ),
                  onPressed: () => onPressed(
                    list.sublist(0, e.key + 1),
                  ),
                ).marginSymmetric(horizontal: 4),
              ),
            ),
      );
    }
    return breadCrumbList;
  }

  breadCrumbScrollToEnd() {
    Future.delayed(Duration(milliseconds: 200), () {
      if (_breadCrumbScroller.hasClients) {
        _breadCrumbScroller.animateTo(
            _breadCrumbScroller.position.maxScrollExtent,
            duration: Duration(milliseconds: 200),
            curve: Curves.fastLinearToSlowEaseIn);
      }
    });
  }

  Widget buildPathLocation() {
    final text = _locationStatus.value == LocationStatus.pathLocation
        ? controller.directory.value.path
        : _searchText.value;
    final textController = TextEditingController(text: text)
      ..selection = TextSelection.collapsed(offset: text.length);
    return Row(
      children: [
        SvgPicture.asset(
          _locationStatus.value == LocationStatus.pathLocation
              ? "assets/folder.svg"
              : "assets/search.svg",
          colorFilter: svgColor(Theme.of(context).tabBarTheme.labelColor),
        ),
        Expanded(
          child: TextField(
            focusNode: _locationNode,
            decoration: InputDecoration(
              border: InputBorder.none,
              isDense: true,
              prefix: Padding(
                padding: EdgeInsets.only(left: 4.0),
              ),
            ),
            controller: textController,
            onSubmitted: (path) {
              controller.openDirectory(path);
            },
            onChanged: _locationStatus.value == LocationStatus.fileSearchBar
                ? (searchText) => onSearchText(searchText, isLocal)
                : null,
          ).workaroundFreezeLinuxMint(),
        )
      ],
    );
  }

  // openDirectory(String path, {bool isLocal = false}) {
  //   model.openDirectory(path, isLocal: isLocal);
  // }
}

Widget buildWindowsThisPC(BuildContext context, [TextStyle? textStyle]) {
  final color = Theme.of(context).iconTheme.color?.withOpacity(0.7);
  return Row(children: [
    Icon(Icons.computer, size: 20, color: color),
    SizedBox(width: 10),
    Text(translate('This PC'), style: textStyle)
  ]);
}

// 윈도우 탐색기풍 컬러 아이콘.
IconData _fileIconFor(String name, {required bool isFile}) {
  if (!isFile) return Icons.folder_sharp;
  final ext = name.contains('.')
      ? name.substring(name.lastIndexOf('.') + 1).toLowerCase()
      : '';
  switch (ext) {
    case 'pdf':
      return Icons.picture_as_pdf_sharp;
    case 'doc':
    case 'docx':
    case 'rtf':
    case 'odt':
      return Icons.description_sharp;
    case 'xls':
    case 'xlsx':
    case 'csv':
    case 'ods':
      return Icons.table_chart_sharp;
    case 'ppt':
    case 'pptx':
    case 'odp':
      return Icons.slideshow_sharp;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'bz2':
      return Icons.folder_zip_sharp;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'bmp':
    case 'webp':
    case 'svg':
    case 'tiff':
    case 'ico':
      return Icons.image_sharp;
    case 'mp4':
    case 'mkv':
    case 'avi':
    case 'mov':
    case 'wmv':
    case 'flv':
    case 'webm':
      return Icons.movie_sharp;
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'ogg':
    case 'm4a':
      return Icons.audio_file_sharp;
    case 'exe':
    case 'msi':
    case 'bat':
    case 'cmd':
    case 'sh':
      return Icons.settings_applications_sharp;
    case 'txt':
    case 'md':
    case 'log':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'toml':
    case 'yaml':
    case 'yml':
      return Icons.article_sharp;
    case 'py':
    case 'js':
    case 'ts':
    case 'html':
    case 'css':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'cs':
    case 'rs':
    case 'go':
    case 'rb':
    case 'php':
    case 'swift':
    case 'kt':
    case 'dart':
    case 'json':
    case 'xml':
      return Icons.code_sharp;
    case 'iso':
    case 'img':
    case 'dmg':
      return Icons.album_sharp;
    default:
      return Icons.insert_drive_file_sharp;
  }
}

Color _fileIconColor(String name, {required bool isFile}) {
  if (!isFile) return const Color(0xFFFFC107); // 폴더 = 윈도우식 노란색
  final ext = name.contains('.')
      ? name.substring(name.lastIndexOf('.') + 1).toLowerCase()
      : '';
  switch (ext) {
    case 'pdf':
      return const Color(0xFFE53935); // 빨강
    case 'doc':
    case 'docx':
    case 'rtf':
    case 'odt':
      return const Color(0xFF2962FF); // Word 블루
    case 'xls':
    case 'xlsx':
    case 'csv':
    case 'ods':
      return const Color(0xFF2E7D32); // Excel 그린
    case 'ppt':
    case 'pptx':
    case 'odp':
      return const Color(0xFFEF6C00); // PPT 오렌지
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
    case 'bz2':
      return const Color(0xFF6D4C41); // 압축 = 갈색
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'bmp':
    case 'webp':
    case 'svg':
    case 'tiff':
    case 'ico':
      return const Color(0xFF8E24AA); // 이미지 = 보라
    case 'mp4':
    case 'mkv':
    case 'avi':
    case 'mov':
    case 'wmv':
    case 'flv':
    case 'webm':
      return const Color(0xFF5E35B1); // 영상 = 진보라
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'ogg':
    case 'm4a':
      return const Color(0xFFD81B60); // 오디오 = 핑크
    case 'exe':
    case 'msi':
    case 'bat':
    case 'cmd':
    case 'sh':
      return const Color(0xFF455A64); // 실행파일 = 청회색
    case 'txt':
    case 'md':
    case 'log':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'toml':
    case 'yaml':
    case 'yml':
      return const Color(0xFF607D8B); // 텍스트 = 회색
    case 'py':
    case 'js':
    case 'ts':
    case 'html':
    case 'css':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'cs':
    case 'rs':
    case 'go':
    case 'rb':
    case 'php':
    case 'swift':
    case 'kt':
    case 'dart':
    case 'json':
    case 'xml':
      return const Color(0xFF3949AB); // 코드 = 인디고
    case 'iso':
    case 'img':
    case 'dmg':
      return const Color(0xFF00838F); // 디스크 이미지 = 청록
    default:
      return const Color(0xFF78909C); // 일반 = 옅은 청회색
  }
}
