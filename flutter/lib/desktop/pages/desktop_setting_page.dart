import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hbb/common.dart';
import 'package:flutter_hbb/common/widgets/audio_input.dart';
import 'package:flutter_hbb/common/widgets/setting_widgets.dart';
import 'package:flutter_hbb/consts.dart';
import 'package:flutter_hbb/desktop/pages/desktop_home_page.dart';
import 'package:flutter_hbb/desktop/pages/desktop_tab_page.dart';
import 'package:flutter_hbb/desktop/widgets/remote_toolbar.dart';
import 'package:flutter_hbb/mobile/widgets/dialog.dart';
import 'package:flutter_hbb/models/platform_model.dart';
import 'package:flutter_hbb/models/printer_model.dart';
import 'package:flutter_hbb/models/server_model.dart';
import 'package:flutter_hbb/models/state_model.dart';
import 'package:flutter_hbb/plugin/manager.dart';
import 'package:flutter_hbb/plugin/widgets/desktop_settings.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:url_launcher/url_launcher_string.dart';

import '../../common/widgets/dialog.dart';
import '../../common/widgets/login.dart';

const double _kTabWidth = 200;
const double _kTabHeight = 42;
const double _kCardFixedWidth = 540;
const double _kCardLeftMargin = 15;
const double _kContentHMargin = 15;
const double _kContentHSubMargin = _kContentHMargin + 33;
const double _kCheckBoxLeftMargin = 10;
const double _kRadioLeftMargin = 10;
const double _kListViewBottomMargin = 15;
const double _kTitleFontSize = 20;
const double _kContentFontSize = 15;
const Color _accentColor = MyTheme.accent;
const String _kSettingPageControllerTag = 'settingPageController';
const String _kSettingPageTabKeyTag = 'settingPageTabKey';

class _TabInfo {
  late final SettingsTabKey key;
  late final String label;
  late final IconData unselected;
  late final IconData selected;
  _TabInfo(this.key, this.label, this.unselected, this.selected);
}

enum SettingsTabKey {
  general,
  safety,
  network,
  display,
  plugin,
  account,
  printer,
  about,
}

class DesktopSettingPage extends StatefulWidget {
  final SettingsTabKey initialTabkey;
  // ChainRemote: 거래처 운영에 불필요한 탭들(계정/플러그인/프린터) 비활성화.
  static final List<SettingsTabKey> tabKeys = [
    SettingsTabKey.general,
    if (!isWeb &&
        !bind.isOutgoingOnly() &&
        !bind.isDisableSettings() &&
        bind.mainGetBuildinOption(key: kOptionHideSecuritySetting) != 'Y')
      SettingsTabKey.safety,
    if (!bind.isDisableSettings() &&
        bind.mainGetBuildinOption(key: kOptionHideNetworkSetting) != 'Y')
      SettingsTabKey.network,
    if (!bind.isIncomingOnly()) SettingsTabKey.display,
    SettingsTabKey.about,
  ];

  DesktopSettingPage({Key? key, required this.initialTabkey}) : super(key: key);

  @override
  State<DesktopSettingPage> createState() =>
      _DesktopSettingPageState(initialTabkey);

  static void switch2page(SettingsTabKey page) {
    try {
      int index = tabKeys.indexOf(page);
      if (index == -1) {
        return;
      }
      if (Get.isRegistered<PageController>(tag: _kSettingPageControllerTag)) {
        DesktopTabPage.onAddSetting(initialPage: page);
        PageController controller =
            Get.find<PageController>(tag: _kSettingPageControllerTag);
        Rx<SettingsTabKey> selected =
            Get.find<Rx<SettingsTabKey>>(tag: _kSettingPageTabKeyTag);
        selected.value = page;
        controller.jumpToPage(index);
      } else {
        DesktopTabPage.onAddSetting(initialPage: page);
      }
    } catch (e) {
      debugPrintStack(label: '$e');
    }
  }
}

class _DesktopSettingPageState extends State<DesktopSettingPage>
    with
        TickerProviderStateMixin,
        AutomaticKeepAliveClientMixin,
        WidgetsBindingObserver {
  late PageController controller;
  late Rx<SettingsTabKey> selectedTab;

  @override
  bool get wantKeepAlive => true;

  final RxBool _block = false.obs;
  final RxBool _canBeBlocked = false.obs;
  Timer? _videoConnTimer;

  _DesktopSettingPageState(SettingsTabKey initialTabkey) {
    var initialIndex = DesktopSettingPage.tabKeys.indexOf(initialTabkey);
    if (initialIndex == -1) {
      initialIndex = 0;
    }
    selectedTab = DesktopSettingPage.tabKeys[initialIndex].obs;
    Get.put<Rx<SettingsTabKey>>(selectedTab, tag: _kSettingPageTabKeyTag);
    controller = PageController(initialPage: initialIndex);
    Get.put<PageController>(controller, tag: _kSettingPageControllerTag);
    controller.addListener(() {
      if (controller.page != null) {
        int page = controller.page!.toInt();
        if (page < DesktopSettingPage.tabKeys.length) {
          selectedTab.value = DesktopSettingPage.tabKeys[page];
        }
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    super.didChangeAppLifecycleState(state);
    if (state == AppLifecycleState.resumed) {
      shouldBeBlocked(_block, canBeBlocked);
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _videoConnTimer =
        periodic_immediate(Duration(milliseconds: 1000), () async {
      if (!mounted) {
        return;
      }
      _canBeBlocked.value = await canBeBlocked();
    });
  }

  @override
  void dispose() {
    super.dispose();
    Get.delete<PageController>(tag: _kSettingPageControllerTag);
    Get.delete<RxInt>(tag: _kSettingPageTabKeyTag);
    WidgetsBinding.instance.removeObserver(this);
    _videoConnTimer?.cancel();
  }

  List<_TabInfo> _settingTabs() {
    final List<_TabInfo> settingTabs = <_TabInfo>[];
    for (final tab in DesktopSettingPage.tabKeys) {
      switch (tab) {
        case SettingsTabKey.general:
          settingTabs.add(_TabInfo(
              tab, 'General', Icons.settings_outlined, Icons.settings));
          break;
        case SettingsTabKey.safety:
          settingTabs.add(_TabInfo(tab, 'Security',
              Icons.enhanced_encryption_outlined, Icons.enhanced_encryption));
          break;
        case SettingsTabKey.network:
          settingTabs
              .add(_TabInfo(tab, 'Network', Icons.link_outlined, Icons.link));
          break;
        case SettingsTabKey.display:
          settingTabs.add(_TabInfo(tab, 'Display',
              Icons.desktop_windows_outlined, Icons.desktop_windows));
          break;
        case SettingsTabKey.plugin:
          settingTabs.add(_TabInfo(
              tab, 'Plugin', Icons.extension_outlined, Icons.extension));
          break;
        case SettingsTabKey.account:
          settingTabs.add(
              _TabInfo(tab, 'Account', Icons.person_outline, Icons.person));
          break;
        case SettingsTabKey.printer:
          settingTabs
              .add(_TabInfo(tab, 'Printer', Icons.print_outlined, Icons.print));
          break;
        case SettingsTabKey.about:
          settingTabs
              .add(_TabInfo(tab, 'About', Icons.info_outline, Icons.info));
          break;
      }
    }
    return settingTabs;
  }

  List<Widget> _children() {
    final children = List<Widget>.empty(growable: true);
    for (final tab in DesktopSettingPage.tabKeys) {
      switch (tab) {
        case SettingsTabKey.general:
          children.add(const _General());
          break;
        case SettingsTabKey.safety:
          children.add(const _Safety());
          break;
        case SettingsTabKey.network:
          children.add(const _Network());
          break;
        case SettingsTabKey.display:
          children.add(const _Display());
          break;
        case SettingsTabKey.plugin:
          children.add(const _Plugin());
          break;
        case SettingsTabKey.account:
          children.add(const _Account());
          break;
        case SettingsTabKey.printer:
          children.add(const _Printer());
          break;
        case SettingsTabKey.about:
          children.add(const _About());
          break;
      }
    }
    return children;
  }

  Widget _buildBlock({required List<Widget> children}) {
    // check both mouseMoveTime and videoConnCount
    return Obx(() {
      final videoConnBlock =
          _canBeBlocked.value && stateGlobal.videoConnCount > 0;
      return Stack(children: [
        buildRemoteBlock(
          block: _block,
          mask: false,
          use: canBeBlocked,
          child: preventMouseKeyBuilder(
            child: Row(children: children),
            block: videoConnBlock,
          ),
        ),
        if (videoConnBlock)
          Container(
            color: Colors.black.withOpacity(0.5),
          )
      ]);
    });
  }

  // ChainRemote: 사이드바 폐기 → 브랜드 헤더 + 가로 칩 탭 + 본문 스타일.
  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FB),
      body: _buildBlock(
        children: <Widget>[
          Expanded(
            child: Column(
              children: [
                _brandHeader(context),
                _topTabStrip(context),
                Expanded(
                  child: Container(
                    color: const Color(0xFFF6F8FB),
                    child: PageView(
                      controller: controller,
                      physics: NeverScrollableScrollPhysics(),
                      children: _children(),
                    ),
                  ),
                ),
              ],
            ),
          )
        ],
      ),
    );
  }

  // ChainRemote 브랜드 헤더 — 그라디언트 + 로고 + 부제
  Widget _brandHeader(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(28, 22, 28, 18),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1E5BFF), Color(0xFF00B894)],
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.18),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.tune_rounded,
                color: Colors.white, size: 24),
          ),
          const SizedBox(width: 14),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: const [
              Text('환경설정',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w800)),
              SizedBox(height: 2),
              Text('ChainRemote 운영 환경 정의',
                  style: TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                      fontWeight: FontWeight.w500)),
            ],
          ),
          const Spacer(),
        ],
      ),
    );
  }

  // 가로 칩 탭 — 사이드바 대체
  Widget _topTabStrip(BuildContext context) {
    final tabs = _settingTabs();
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(
          bottom: BorderSide(color: Color(0xFFE2E8F0), width: 1),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: tabs.map((tab) => _topTabChip(tab)).toList(),
      ),
    );
  }

  Widget _topTabChip(_TabInfo tab) {
    return Obx(() {
      final selected = tab.key == selectedTab.value;
      const brandBlue = Color(0xFF1E5BFF);
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () {
              if (selectedTab.value != tab.key) {
                int index = DesktopSettingPage.tabKeys.indexOf(tab.key);
                if (index == -1) return;
                controller.jumpToPage(index);
              }
              selectedTab.value = tab.key;
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              padding: const EdgeInsets.symmetric(
                  horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: selected ? brandBlue : const Color(0xFFEEF1F5),
                borderRadius: BorderRadius.circular(10),
                boxShadow: selected
                    ? [
                        BoxShadow(
                          color: brandBlue.withOpacity(0.30),
                          blurRadius: 8,
                          offset: const Offset(0, 3),
                        )
                      ]
                    : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(selected ? tab.selected : tab.unselected,
                      size: 17,
                      color:
                          selected ? Colors.white : const Color(0xFF4A5568)),
                  const SizedBox(width: 8),
                  Text(
                    translate(tab.label),
                    style: TextStyle(
                      color:
                          selected ? Colors.white : const Color(0xFF4A5568),
                      fontWeight:
                          selected ? FontWeight.w700 : FontWeight.w500,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    });
  }

  Widget _header(BuildContext context) {
    final settingsText = Text(
      translate('Settings'),
      textAlign: TextAlign.left,
      style: const TextStyle(
        color: _accentColor,
        fontSize: _kTitleFontSize,
        fontWeight: FontWeight.w400,
      ),
    );
    return Row(
      children: [
        if (isWeb)
          IconButton(
            onPressed: () {
              if (Navigator.canPop(context)) {
                Navigator.pop(context);
              }
            },
            icon: Icon(Icons.arrow_back),
          ).marginOnly(left: 5),
        if (isWeb)
          SizedBox(
            height: 62,
            child: Align(
              alignment: Alignment.center,
              child: settingsText,
            ),
          ).marginOnly(left: 20),
        if (!isWeb)
          SizedBox(
            height: 62,
            child: settingsText,
          ).marginOnly(left: 20, top: 10),
        const Spacer(),
      ],
    );
  }

  Widget _listView({required List<_TabInfo> tabs}) {
    final scrollController = ScrollController();
    return ListView(
      controller: scrollController,
      children: tabs.map((tab) => _listItem(tab: tab)).toList(),
    );
  }

  Widget _listItem({required _TabInfo tab}) {
    return Obx(() {
      bool selected = tab.key == selectedTab.value;
      return SizedBox(
        width: _kTabWidth,
        height: _kTabHeight,
        child: InkWell(
          onTap: () {
            if (selectedTab.value != tab.key) {
              int index = DesktopSettingPage.tabKeys.indexOf(tab.key);
              if (index == -1) {
                return;
              }
              controller.jumpToPage(index);
            }
            selectedTab.value = tab.key;
          },
          child: Row(children: [
            Container(
              width: 4,
              height: _kTabHeight * 0.7,
              color: selected ? _accentColor : null,
            ),
            Icon(
              selected ? tab.selected : tab.unselected,
              color: selected ? _accentColor : null,
              size: 20,
            ).marginOnly(left: 13, right: 10),
            Text(
              translate(tab.label),
              style: TextStyle(
                  color: selected ? _accentColor : null,
                  fontWeight: FontWeight.w400,
                  fontSize: _kContentFontSize),
            ),
          ]),
        ),
      );
    });
  }
}

//#region pages

class _General extends StatefulWidget {
  const _General({Key? key}) : super(key: key);

  @override
  State<_General> createState() => _GeneralState();
}

class _GeneralState extends State<_General> {
  final RxBool serviceStop =
      isWeb ? RxBool(false) : Get.find<RxBool>(tag: 'stop-service');
  RxBool serviceBtnEnabled = true.obs;

  @override
  Widget build(BuildContext context) {
    final scrollController = ScrollController();
    return ListView(
      controller: scrollController,
      children: [
        if (!isWeb) service(),
        theme(),
        _Card(title: 'Language', children: [language()]),
        if (!isWeb) hwcodec(),
        if (!isWeb) audio(context),
        if (!isWeb) record(context),
        if (!isWeb) WaylandCard(),
        other()
      ],
    ).marginOnly(bottom: _kListViewBottomMargin);
  }

  Widget theme() {
    final current = MyTheme.getThemeModePreference().toShortString();
    onChanged(String value) async {
      await MyTheme.changeDarkMode(MyTheme.themeModeFromString(value));
      setState(() {});
    }

    final isOptFixed = isOptionFixed(kCommConfKeyTheme);
    return _Card(title: 'Theme', hint: '본사·거래처 모두 밝은 모드 권장 — 매장 시인성 좋음.', children: [
      _Radio<String>(context,
          value: 'light',
          groupValue: current,
          label: 'Light',
          onChanged: isOptFixed ? null : onChanged),
      _Radio<String>(context,
          value: 'dark',
          groupValue: current,
          label: 'Dark',
          onChanged: isOptFixed ? null : onChanged),
      _Radio<String>(context,
          value: 'system',
          groupValue: current,
          label: 'Follow System',
          onChanged: isOptFixed ? null : onChanged),
    ]);
  }

  Widget service() {
    if (bind.isOutgoingOnly()) {
      return const Offstage();
    }

    final hideStopService =
        bind.mainGetBuildinOption(key: kOptionHideStopService) == 'Y';

    return Obx(() {
      if (hideStopService && !serviceStop.value) {
        return const Offstage();
      }

      return _Card(title: 'Service', hint: '거래처 PC는 항상 실행(연결 수신 상태) 권장. 중지하면 본사가 접속 불가.', children: [
        _Button(serviceStop.value ? 'Start' : 'Stop', () {
          () async {
            serviceBtnEnabled.value = false;
            await start_service(serviceStop.value);
            // enable the button after 1 second
            Future.delayed(const Duration(seconds: 1), () {
              serviceBtnEnabled.value = true;
            });
          }();
        }, enabled: serviceBtnEnabled.value)
      ]);
    });
  }

  Widget other() {
    final showAutoUpdate = isWindows && bind.mainIsInstalled();
    final children = <Widget>[
      if (!isWeb && !bind.isIncomingOnly())
        _OptionCheckBox(context, 'Confirm before closing multiple tabs',
            kOptionEnableConfirmClosingTabs,
            isServer: false),
      _OptionCheckBox(context, 'Adaptive bitrate', kOptionEnableAbr),
      if (!isWeb) wallpaper(),
      if (!isWeb && !bind.isIncomingOnly()) ...[
        _OptionCheckBox(
          context,
          'Open connection in new tab',
          kOptionOpenNewConnInTabs,
          isServer: false,
        ),
        // though this is related to GUI, but opengl problem affects all users, so put in config rather than local
        if (isLinux)
          Tooltip(
            message: translate('software_render_tip'),
            child: _OptionCheckBox(
              context,
              "Always use software rendering",
              kOptionAllowAlwaysSoftwareRender,
            ),
          ),
        if (!isWeb)
          Tooltip(
            message: translate('texture_render_tip'),
            child: _OptionCheckBox(
              context,
              "Use texture rendering",
              kOptionTextureRender,
              optGetter: bind.mainGetUseTextureRender,
              optSetter: (k, v) async =>
                  await bind.mainSetLocalOption(key: k, value: v ? 'Y' : 'N'),
            ),
          ),
        if (isWindows)
          Tooltip(
            message: translate('d3d_render_tip'),
            child: _OptionCheckBox(
              context,
              "Use D3D rendering",
              kOptionD3DRender,
              isServer: false,
            ),
          ),
        if (!isWeb && !bind.isCustomClient())
          _OptionCheckBox(
            context,
            'Check for software update on startup',
            kOptionEnableCheckUpdate,
            isServer: false,
          ),
        if (showAutoUpdate)
          _OptionCheckBox(
            context,
            'Auto update',
            kOptionAllowAutoUpdate,
            isServer: true,
          ),
        if (isWindows && !bind.isOutgoingOnly())
          _OptionCheckBox(
            context,
            'Capture screen using DirectX',
            kOptionDirectxCapture,
          ),
        if (!bind.isIncomingOnly()) ...[
          _OptionCheckBox(
            context,
            'Enable UDP hole punching',
            kOptionEnableUdpPunch,
            isServer: false,
          ),
          _OptionCheckBox(
            context,
            'Enable IPv6 P2P connection',
            kOptionEnableIpv6Punch,
            isServer: false,
          ),
        ],
      ],
    ];

    // Add client-side wakelock option for desktop platforms
    if (!bind.isIncomingOnly()) {
      children.add(_OptionCheckBox(
        context,
        'keep-awake-during-outgoing-sessions-label',
        kOptionKeepAwakeDuringOutgoingSessions,
        isServer: false,
      ));
    }

    if (!isWeb && bind.mainShowOption(key: kOptionAllowLinuxHeadless)) {
      children.add(_OptionCheckBox(
          context, 'Allow linux headless', kOptionAllowLinuxHeadless));
    }
    if (!bind.isDisableAccount()) {
      children.add(_OptionCheckBox(
        context,
        'note-at-conn-end-tip',
        kOptionAllowAskForNoteAtEndOfConnection,
        isServer: false,
        optSetter: (key, value) async {
          if (value && !gFFI.userModel.isLogin) {
            final res = await loginDialog();
            if (res != true) return;
          }
          await mainSetLocalBoolOption(key, value);
        },
      ));
    }
    return _Card(title: 'Other', children: children);
  }

  Widget wallpaper() {
    if (bind.isOutgoingOnly()) {
      return const Offstage();
    }

    return futureBuilder(future: () async {
      final support = await bind.mainSupportRemoveWallpaper();
      return support;
    }(), hasData: (data) {
      if (data is bool && data == true) {
        bool value = mainGetBoolOptionSync(kOptionAllowRemoveWallpaper);
        return Row(
          children: [
            Flexible(
              child: _OptionCheckBox(
                context,
                'Remove wallpaper during incoming sessions',
                kOptionAllowRemoveWallpaper,
                update: (bool v) {
                  setState(() {});
                },
              ),
            ),
            if (value)
              _CountDownButton(
                text: 'Test',
                second: 5,
                onPressed: () {
                  bind.mainTestWallpaper(second: 5);
                },
              )
          ],
        );
      }

      return Offstage();
    });
  }

  Widget hwcodec() {
    final hwcodec = bind.mainHasHwcodec();
    final vram = bind.mainHasVram();
    return Offstage(
      offstage: !(hwcodec || vram),
      child: _Card(title: 'Hardware Codec', children: [
        _OptionCheckBox(
          context,
          'Enable hardware codec',
          kOptionEnableHwcodec,
          update: (bool v) {
            if (v) {
              bind.mainCheckHwcodec();
            }
          },
        )
      ]),
    );
  }

  Widget audio(BuildContext context) {
    if (bind.isOutgoingOnly()) {
      return const Offstage();
    }

    builder(devices, currentDevice, setDevice) {
      final child = ComboBox(
        keys: devices,
        values: devices,
        initialKey: currentDevice,
        onChanged: (key) async {
          setDevice(key);
          setState(() {});
        },
      ).marginOnly(left: _kContentHMargin);
      return _Card(title: 'Audio Input Device', children: [child]);
    }

    return AudioInput(builder: builder, isCm: false, isVoiceCall: false);
  }

  Widget record(BuildContext context) {
    final showRootDir = isWindows && bind.mainIsInstalled();
    return futureBuilder(future: () async {
      String user_dir = bind.mainVideoSaveDirectory(root: false);
      String root_dir =
          showRootDir ? bind.mainVideoSaveDirectory(root: true) : '';
      bool user_dir_exists = await Directory(user_dir).exists();
      bool root_dir_exists =
          showRootDir ? await Directory(root_dir).exists() : false;
      return {
        'user_dir': user_dir,
        'root_dir': root_dir,
        'user_dir_exists': user_dir_exists,
        'root_dir_exists': root_dir_exists,
      };
    }(), hasData: (data) {
      Map<String, dynamic> map = data as Map<String, dynamic>;
      String user_dir = map['user_dir']!;
      String root_dir = map['root_dir']!;
      bool root_dir_exists = map['root_dir_exists']!;
      bool user_dir_exists = map['user_dir_exists']!;
      return _Card(title: 'Recording', hint: '분쟁 시 증거가 됩니다. 거래처 운영용으로 자동 녹화(수신) 권장.', children: [
        if (!bind.isOutgoingOnly())
          _OptionCheckBox(context, 'Automatically record incoming sessions',
              kOptionAllowAutoRecordIncoming),
        if (!bind.isIncomingOnly())
          _OptionCheckBox(context, 'Automatically record outgoing sessions',
              kOptionAllowAutoRecordOutgoing,
              isServer: false),
        if (showRootDir && !bind.isOutgoingOnly())
          Row(
            children: [
              Text(
                  '${translate(bind.isIncomingOnly() ? "Directory" : "Incoming")}:'),
              Expanded(
                child: GestureDetector(
                    onTap: root_dir_exists
                        ? () => launchUrl(Uri.file(root_dir))
                        : null,
                    child: Text(
                      root_dir,
                      softWrap: true,
                      style: root_dir_exists
                          ? const TextStyle(
                              decoration: TextDecoration.underline)
                          : null,
                    )).marginOnly(left: 10),
              ),
            ],
          ).marginOnly(left: _kContentHMargin),
        if (!(showRootDir && bind.isIncomingOnly()))
          Row(
            children: [
              Text(
                  '${translate((showRootDir && !bind.isOutgoingOnly()) ? "Outgoing" : "Directory")}:'),
              Expanded(
                child: GestureDetector(
                    onTap: user_dir_exists
                        ? () => launchUrl(Uri.file(user_dir))
                        : null,
                    child: Text(
                      user_dir,
                      softWrap: true,
                      style: user_dir_exists
                          ? const TextStyle(
                              decoration: TextDecoration.underline)
                          : null,
                    )).marginOnly(left: 10),
              ),
              ElevatedButton(
                      onPressed: isOptionFixed(kOptionVideoSaveDirectory)
                          ? null
                          : () async {
                              String? initialDirectory;
                              if (await Directory.fromUri(
                                      Uri.directory(user_dir))
                                  .exists()) {
                                initialDirectory = user_dir;
                              }
                              String? selectedDirectory =
                                  await FilePicker.platform.getDirectoryPath(
                                      initialDirectory: initialDirectory);
                              if (selectedDirectory != null) {
                                await bind.mainSetLocalOption(
                                    key: kOptionVideoSaveDirectory,
                                    value: selectedDirectory);
                                setState(() {});
                              }
                            },
                      child: Text(translate('Change')))
                  .marginOnly(left: 5),
            ],
          ).marginOnly(left: _kContentHMargin),
      ]);
    });
  }

  Widget language() {
    return futureBuilder(future: () async {
      String langs = await bind.mainGetLangs();
      return {'langs': langs};
    }(), hasData: (res) {
      Map<String, String> data = res as Map<String, String>;
      List<dynamic> langsList = jsonDecode(data['langs']!);
      Map<String, String> langsMap = {for (var v in langsList) v[0]: v[1]};
      List<String> keys = langsMap.keys.toList();
      List<String> values = langsMap.values.toList();
      keys.insert(0, defaultOptionLang);
      values.insert(0, translate('Default'));
      String currentKey = bind.mainGetLocalOption(key: kCommConfKeyLang);
      if (!keys.contains(currentKey)) {
        currentKey = defaultOptionLang;
      }
      final isOptFixed = isOptionFixed(kCommConfKeyLang);
      return ComboBox(
        keys: keys,
        values: values,
        initialKey: currentKey,
        onChanged: (key) async {
          await bind.mainSetLocalOption(key: kCommConfKeyLang, value: key);
          if (isWeb) reloadCurrentWindow();
          if (!isWeb) reloadAllWindows();
          if (!isWeb) bind.mainChangeLanguage(lang: key);
        },
        enabled: !isOptFixed,
      ).marginOnly(left: _kContentHMargin);
    });
  }
}

enum _AccessMode {
  custom,
  full,
  view,
}

class _Safety extends StatefulWidget {
  const _Safety({Key? key}) : super(key: key);

  @override
  State<_Safety> createState() => _SafetyState();
}

class _SafetyState extends State<_Safety> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;
  bool locked = bind.mainIsInstalled();
  final scrollController = ScrollController();

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return SingleChildScrollView(
        controller: scrollController,
        child: Column(
          children: [
            _lock(locked, 'Unlock Security Settings', () {
              locked = false;
              setState(() => {});
            }),
            preventMouseKeyBuilder(
              block: locked,
              child: Column(children: [
                permissions(context),
                password(context),
                _Card(title: '2FA', hint: 'RustDesk 클라우드 계정용. 우리는 안 씁니다 — 끔(OFF) 권장.', children: [tfa()]),
                if (!isChangeIdDisabled())
                  _Card(title: 'ID', hint: '⚠️ ID 변경 금지. 머신 UUID 기반으로 자동 발급됨. 변경 시 거래처 재등록 필요.', children: [changeId()]),
                more(context),
              ]),
            ),
          ],
        )).marginOnly(bottom: _kListViewBottomMargin);
  }

  Widget tfa() {
    bool enabled = !locked;
    // Simple temp wrapper for PR check
    tmpWrapper() {
      RxBool has2fa = bind.mainHasValid2FaSync().obs;
      RxBool hasBot = bind.mainHasValidBotSync().obs;
      update() async {
        has2fa.value = bind.mainHasValid2FaSync();
        setState(() {});
      }

      onChanged(bool? checked) async {
        if (checked == false) {
          CommonConfirmDialog(
              gFFI.dialogManager, translate('cancel-2fa-confirm-tip'), () {
            change2fa(callback: update);
          });
        } else {
          change2fa(callback: update);
        }
      }

      final tfa = GestureDetector(
        child: InkWell(
          child: Obx(() => Row(
                children: [
                  Checkbox(
                          value: has2fa.value,
                          onChanged: enabled ? onChanged : null)
                      .marginOnly(right: 5),
                  Expanded(
                      child: Text(
                    translate('enable-2fa-title'),
                    style:
                        TextStyle(color: disabledTextColor(context, enabled)),
                  ))
                ],
              )),
        ),
        onTap: () {
          onChanged(!has2fa.value);
        },
      ).marginOnly(left: _kCheckBoxLeftMargin);
      if (!has2fa.value) {
        return tfa;
      }
      updateBot() async {
        hasBot.value = bind.mainHasValidBotSync();
        setState(() {});
      }

      onChangedBot(bool? checked) async {
        if (checked == false) {
          CommonConfirmDialog(
              gFFI.dialogManager, translate('cancel-bot-confirm-tip'), () {
            changeBot(callback: updateBot);
          });
        } else {
          changeBot(callback: updateBot);
        }
      }

      final bot = GestureDetector(
        child: Tooltip(
          waitDuration: Duration(milliseconds: 300),
          message: translate("enable-bot-tip"),
          child: InkWell(
              child: Obx(() => Row(
                    children: [
                      Checkbox(
                              value: hasBot.value,
                              onChanged: enabled ? onChangedBot : null)
                          .marginOnly(right: 5),
                      Expanded(
                          child: Text(
                        translate('Telegram bot'),
                        style: TextStyle(
                            color: disabledTextColor(context, enabled)),
                      ))
                    ],
                  ))),
        ),
        onTap: () {
          onChangedBot(!hasBot.value);
        },
      ).marginOnly(left: _kCheckBoxLeftMargin + 30);

      final trust = Row(
        children: [
          Flexible(
            child: Tooltip(
              waitDuration: Duration(milliseconds: 300),
              message: translate("enable-trusted-devices-tip"),
              child: _OptionCheckBox(context, "Enable trusted devices",
                  kOptionEnableTrustedDevices,
                  enabled: !locked, update: (v) {
                setState(() {});
              }),
            ),
          ),
          if (mainGetBoolOptionSync(kOptionEnableTrustedDevices))
            ElevatedButton(
                onPressed: locked
                    ? null
                    : () {
                        manageTrustedDeviceDialog();
                      },
                child: Text(translate('Manage trusted devices')))
        ],
      ).marginOnly(left: 30);

      return Column(
        children: [tfa, bot, trust],
      );
    }

    return tmpWrapper();
  }

  Widget changeId() {
    return ChangeNotifierProvider.value(
        value: gFFI.serverModel,
        child: Consumer<ServerModel>(builder: ((context, model, child) {
          return _Button('Change ID', changeIdDialog,
              enabled: !locked && model.connectStatus > 0);
        })));
  }

  Widget permissions(context) {
    bool enabled = !locked;
    // Simple temp wrapper for PR check
    tmpWrapper() {
      String accessMode = bind.mainGetOptionSync(key: kOptionAccessMode);
      _AccessMode mode;
      if (accessMode == 'full') {
        mode = _AccessMode.full;
      } else if (accessMode == 'view') {
        mode = _AccessMode.view;
      } else {
        mode = _AccessMode.custom;
      }
      String initialKey;
      bool? fakeValue;
      switch (mode) {
        case _AccessMode.custom:
          initialKey = '';
          fakeValue = null;
          break;
        case _AccessMode.full:
          initialKey = 'full';
          fakeValue = true;
          break;
        case _AccessMode.view:
          initialKey = 'view';
          fakeValue = false;
          break;
      }

      return _Card(title: 'Permissions', hint: '본사가 거래처 PC에 접속했을 때 허용할 동작들. 거래처 운영은 모두 켬.', children: [
        ComboBox(
            keys: [
              defaultOptionAccessMode,
              'full',
              'view',
            ],
            values: [
              translate('Custom'),
              translate('Full Access'),
              translate('Screen Share'),
            ],
            enabled: enabled && !isOptionFixed(kOptionAccessMode),
            initialKey: initialKey,
            onChanged: (mode) async {
              await bind.mainSetOption(key: kOptionAccessMode, value: mode);
              setState(() {});
            }).marginOnly(left: _kContentHMargin),
        Column(
          children: [
            _OptionCheckBox(
                context, 'Enable keyboard/mouse', kOptionEnableKeyboard,
                enabled: enabled, fakeValue: fakeValue),
            if (isWindows)
              _OptionCheckBox(
                  context, 'Enable remote printer', kOptionEnableRemotePrinter,
                  enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(context, 'Enable clipboard', kOptionEnableClipboard,
                enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(
                context, 'Enable file transfer', kOptionEnableFileTransfer,
                enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(context, 'Enable audio', kOptionEnableAudio,
                enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(context, 'Enable camera', kOptionEnableCamera,
                enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(context, 'Enable terminal', kOptionEnableTerminal,
                enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(
                context, 'Enable TCP tunneling', kOptionEnableTunnel,
                enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(
                context, 'Enable remote restart', kOptionEnableRemoteRestart,
                enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(
                context, 'Enable recording session', kOptionEnableRecordSession,
                enabled: enabled, fakeValue: fakeValue),
            if (isWindows)
              _OptionCheckBox(context, 'Enable blocking user input',
                  kOptionEnableBlockInput,
                  enabled: enabled, fakeValue: fakeValue),
            _OptionCheckBox(context, 'Enable remote configuration modification',
                kOptionAllowRemoteConfigModification,
                enabled: enabled, fakeValue: fakeValue),
          ],
        ),
      ]);
    }

    return tmpWrapper();
  }

  Widget password(BuildContext context) {
    return ChangeNotifierProvider.value(
        value: gFFI.serverModel,
        child: Consumer<ServerModel>(builder: ((context, model, child) {
          List<String> passwordKeys = [
            kUseTemporaryPassword,
            kUsePermanentPassword,
            kUseBothPasswords,
          ];
          List<String> passwordValues = [
            translate('Use one-time password'),
            translate('Use permanent password'),
            translate('Use both passwords'),
          ];
          bool tmpEnabled = model.verificationMethod != kUsePermanentPassword;
          bool permEnabled = model.verificationMethod != kUseTemporaryPassword;
          String currentValue =
              passwordValues[passwordKeys.indexOf(model.verificationMethod)];
          List<Widget> radios = passwordValues
              .map((value) => _Radio<String>(
                    context,
                    value: value,
                    groupValue: currentValue,
                    label: value,
                    onChanged: locked
                        ? null
                        : ((value) async {
                            callback() async {
                              await model.setVerificationMethod(
                                  passwordKeys[passwordValues.indexOf(value)]);
                              await model.updatePasswordModel();
                            }

                            if (value ==
                                    passwordValues[passwordKeys
                                        .indexOf(kUsePermanentPassword)] &&
                                (await bind.mainGetCommon(
                                        key: "permanent-password-set")) !=
                                    "true") {
                              if (isChangePermanentPasswordDisabled()) {
                                await callback();
                                return;
                              }
                              setPasswordDialog(notEmptyCallback: callback);
                            } else {
                              await callback();
                            }
                          }),
                  ))
              .toList();

          var onChanged = tmpEnabled && !locked
              ? (value) {
                  if (value != null) {
                    () async {
                      await model.setTemporaryPasswordLength(value.toString());
                      await model.updatePasswordModel();
                    }();
                  }
                }
              : null;
          List<Widget> lengthRadios = ['6', '8', '10']
              .map((value) => GestureDetector(
                    child: Row(
                      children: [
                        Radio(
                            value: value,
                            groupValue: model.temporaryPasswordLength,
                            onChanged: onChanged),
                        Text(
                          value,
                          style: TextStyle(
                              color: disabledTextColor(
                                  context, onChanged != null)),
                        ),
                      ],
                    ).paddingOnly(right: 10),
                    onTap: () => onChanged?.call(value),
                  ))
              .toList();

          final isOptFixedNumOTP =
              isOptionFixed(kOptionAllowNumericOneTimePassword);
          final isNumOPTChangable = !isOptFixedNumOTP && tmpEnabled && !locked;
          final numericOneTimePassword = GestureDetector(
            child: InkWell(
                child: Row(
              children: [
                Checkbox(
                        value: model.allowNumericOneTimePassword,
                        onChanged: isNumOPTChangable
                            ? (bool? v) {
                                model.switchAllowNumericOneTimePassword();
                              }
                            : null)
                    .marginOnly(right: 5),
                Expanded(
                    child: Text(
                  translate('Numeric one-time password'),
                  style: TextStyle(
                      color: disabledTextColor(context, isNumOPTChangable)),
                ))
              ],
            )),
            onTap: isNumOPTChangable
                ? () => model.switchAllowNumericOneTimePassword()
                : null,
          ).marginOnly(left: _kContentHSubMargin - 5);

          final modeKeys = <String>[
            'password',
            'click',
            defaultOptionApproveMode
          ];
          final modeValues = [
            translate('Accept sessions via password'),
            translate('Accept sessions via click'),
            translate('Accept sessions via both'),
          ];
          var modeInitialKey = model.approveMode;
          if (!modeKeys.contains(modeInitialKey)) {
            modeInitialKey = defaultOptionApproveMode;
          }
          final usePassword = model.approveMode != 'click';

          final isApproveModeFixed = isOptionFixed(kOptionApproveMode);
          return _Card(title: 'Password', hint: '거래처 운영 정공 = "영구 비밀번호 사용". 한번 설정하면 본사가 0클릭 무인 접속.', children: [
            ComboBox(
              enabled: !locked && !isApproveModeFixed,
              keys: modeKeys,
              values: modeValues,
              initialKey: modeInitialKey,
              onChanged: (key) => model.setApproveMode(key),
            ).marginOnly(left: _kContentHMargin),
            if (usePassword) radios[0],
            if (usePassword)
              _SubLabeledWidget(
                  context,
                  'One-time password length',
                  Row(
                    children: [
                      ...lengthRadios,
                    ],
                  ),
                  enabled: tmpEnabled && !locked),
            if (usePassword) numericOneTimePassword,
            if (usePassword) radios[1],
            if (usePassword && !isChangePermanentPasswordDisabled())
              _SubButton('Set permanent password', setPasswordDialog,
                  permEnabled && !locked),
            // if (usePassword)
            //   hide_cm(!locked).marginOnly(left: _kContentHSubMargin - 6),
            if (usePassword) radios[2],
          ]);
        })));
  }

  Widget more(BuildContext context) {
    bool enabled = !locked;
    return _Card(title: 'Security', hint: '거래처 운영 권장 = "수신 세션 중 화면 켜짐 유지" 만 ON, 나머지 OFF.', children: [
      shareRdp(context, enabled),
      _OptionCheckBox(context, 'Deny LAN discovery', 'enable-lan-discovery',
          reverse: true, enabled: enabled),
      ...directIp(context),
      whitelist(),
      ...autoDisconnect(context),
      _OptionCheckBox(context, 'keep-awake-during-incoming-sessions-label',
          kOptionKeepAwakeDuringIncomingSessions,
          reverse: false, enabled: enabled),
      if (bind.mainIsInstalled())
        _OptionCheckBox(context, 'allow-only-conn-window-open-tip',
            'allow-only-conn-window-open',
            reverse: false, enabled: enabled),
      if (bind.mainIsInstalled() && !isUnlockPinDisabled()) unlockPin()
    ]);
  }

  shareRdp(BuildContext context, bool enabled) {
    onChanged(bool b) async {
      await bind.mainSetShareRdp(enable: b);
      setState(() {});
    }

    bool value = bind.mainIsShareRdp();
    return Offstage(
      offstage: !(isWindows && bind.mainIsInstalled()),
      child: GestureDetector(
          child: Row(
            children: [
              Checkbox(
                      value: value,
                      onChanged: enabled ? (_) => onChanged(!value) : null)
                  .marginOnly(right: 5),
              Expanded(
                child: Text(translate('Enable RDP session sharing'),
                    style:
                        TextStyle(color: disabledTextColor(context, enabled))),
              )
            ],
          ).marginOnly(left: _kCheckBoxLeftMargin),
          onTap: enabled ? () => onChanged(!value) : null),
    );
  }

  List<Widget> directIp(BuildContext context) {
    TextEditingController controller = TextEditingController();
    update(bool v) => setState(() {});
    RxBool applyEnabled = false.obs;
    return [
      _OptionCheckBox(context, 'Enable direct IP access', kOptionDirectServer,
          update: update, enabled: !locked),
      () {
        // Simple temp wrapper for PR check
        tmpWrapper() {
          bool enabled = option2bool(kOptionDirectServer,
              bind.mainGetOptionSync(key: kOptionDirectServer));
          if (!enabled) applyEnabled.value = false;
          controller.text =
              bind.mainGetOptionSync(key: kOptionDirectAccessPort);
          final isOptFixed = isOptionFixed(kOptionDirectAccessPort);
          return Offstage(
            offstage: !enabled,
            child: _SubLabeledWidget(
              context,
              'Port',
              Row(children: [
                SizedBox(
                  width: 95,
                  child: TextField(
                    controller: controller,
                    enabled: enabled && !locked && !isOptFixed,
                    onChanged: (_) => applyEnabled.value = true,
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(
                          r'^([0-9]|[1-9]\d|[1-9]\d{2}|[1-9]\d{3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$')),
                    ],
                    decoration: const InputDecoration(
                      hintText: '21118',
                      contentPadding:
                          EdgeInsets.symmetric(vertical: 12, horizontal: 12),
                    ),
                  ).workaroundFreezeLinuxMint().marginOnly(right: 15),
                ),
                Obx(() => ElevatedButton(
                      onPressed: applyEnabled.value &&
                              enabled &&
                              !locked &&
                              !isOptFixed
                          ? () async {
                              applyEnabled.value = false;
                              await bind.mainSetOption(
                                  key: kOptionDirectAccessPort,
                                  value: controller.text);
                            }
                          : null,
                      child: Text(
                        translate('Apply'),
                      ),
                    ))
              ]),
              enabled: enabled && !locked && !isOptFixed,
            ),
          );
        }

        return tmpWrapper();
      }(),
    ];
  }

  Widget whitelist() {
    bool enabled = !locked;
    // Simple temp wrapper for PR check
    tmpWrapper() {
      RxBool hasWhitelist = whitelistNotEmpty().obs;
      update() async {
        hasWhitelist.value = whitelistNotEmpty();
      }

      onChanged(bool? checked) async {
        changeWhiteList(callback: update);
      }

      final isOptFixed = isOptionFixed(kOptionWhitelist);
      return GestureDetector(
        child: Tooltip(
          message: translate('whitelist_tip'),
          child: Obx(() => Row(
                children: [
                  Checkbox(
                          value: hasWhitelist.value,
                          onChanged: enabled && !isOptFixed ? onChanged : null)
                      .marginOnly(right: 5),
                  Offstage(
                    offstage: !hasWhitelist.value,
                    child: MouseRegion(
                      child: const Icon(Icons.warning_amber_rounded,
                              color: Color.fromARGB(255, 255, 204, 0))
                          .marginOnly(right: 5),
                      cursor: SystemMouseCursors.click,
                    ),
                  ),
                  Expanded(
                      child: Text(
                    translate('Use IP Whitelisting'),
                    style:
                        TextStyle(color: disabledTextColor(context, enabled)),
                  ))
                ],
              )),
        ),
        onTap: enabled
            ? () {
                onChanged(!hasWhitelist.value);
              }
            : null,
      ).marginOnly(left: _kCheckBoxLeftMargin);
    }

    return tmpWrapper();
  }

  Widget hide_cm(bool enabled) {
    return ChangeNotifierProvider.value(
        value: gFFI.serverModel,
        child: Consumer<ServerModel>(builder: (context, model, child) {
          final enableHideCm = model.approveMode == 'password' &&
              model.verificationMethod == kUsePermanentPassword;
          onHideCmChanged(bool? b) {
            if (b != null) {
              bind.mainSetOption(
                  key: 'allow-hide-cm', value: bool2option('allow-hide-cm', b));
            }
          }

          return Tooltip(
              message: enableHideCm ? "" : translate('hide_cm_tip'),
              child: GestureDetector(
                onTap:
                    enableHideCm ? () => onHideCmChanged(!model.hideCm) : null,
                child: Row(
                  children: [
                    Checkbox(
                            value: model.hideCm,
                            onChanged: enabled && enableHideCm
                                ? onHideCmChanged
                                : null)
                        .marginOnly(right: 5),
                    Expanded(
                      child: Text(
                        translate('Hide connection management window'),
                        style: TextStyle(
                            color: disabledTextColor(
                                context, enabled && enableHideCm)),
                      ),
                    ),
                  ],
                ),
              ));
        }));
  }

  List<Widget> autoDisconnect(BuildContext context) {
    TextEditingController controller = TextEditingController();
    update(bool v) => setState(() {});
    RxBool applyEnabled = false.obs;
    return [
      _OptionCheckBox(
          context, 'auto_disconnect_option_tip', kOptionAllowAutoDisconnect,
          update: update, enabled: !locked),
      () {
        bool enabled = option2bool(kOptionAllowAutoDisconnect,
            bind.mainGetOptionSync(key: kOptionAllowAutoDisconnect));
        if (!enabled) applyEnabled.value = false;
        controller.text =
            bind.mainGetOptionSync(key: kOptionAutoDisconnectTimeout);
        final isOptFixed = isOptionFixed(kOptionAutoDisconnectTimeout);
        return Offstage(
          offstage: !enabled,
          child: _SubLabeledWidget(
            context,
            'Timeout in minutes',
            Row(children: [
              SizedBox(
                width: 95,
                child: TextField(
                  controller: controller,
                  enabled: enabled && !locked && !isOptFixed,
                  onChanged: (_) => applyEnabled.value = true,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(
                        r'^([0-9]|[1-9]\d|[1-9]\d{2}|[1-9]\d{3}|[1-5]\d{4}|6[0-4]\d{3}|65[0-4]\d{2}|655[0-2]\d|6553[0-5])$')),
                  ],
                  decoration: const InputDecoration(
                    hintText: '10',
                    contentPadding:
                        EdgeInsets.symmetric(vertical: 12, horizontal: 12),
                  ),
                ).workaroundFreezeLinuxMint().marginOnly(right: 15),
              ),
              Obx(() => ElevatedButton(
                    onPressed:
                        applyEnabled.value && enabled && !locked && !isOptFixed
                            ? () async {
                                applyEnabled.value = false;
                                await bind.mainSetOption(
                                    key: kOptionAutoDisconnectTimeout,
                                    value: controller.text);
                              }
                            : null,
                    child: Text(
                      translate('Apply'),
                    ),
                  ))
            ]),
            enabled: enabled && !locked && !isOptFixed,
          ),
        );
      }(),
    ];
  }

  Widget unlockPin() {
    bool enabled = !locked;
    RxString unlockPin = bind.mainGetUnlockPin().obs;
    update() async {
      unlockPin.value = bind.mainGetUnlockPin();
    }

    onChanged(bool? checked) async {
      changeUnlockPinDialog(unlockPin.value, update);
    }

    final isOptFixed = isOptionFixed(kOptionWhitelist);
    return GestureDetector(
      child: Obx(() => Row(
            children: [
              Checkbox(
                      value: unlockPin.isNotEmpty,
                      onChanged: enabled && !isOptFixed ? onChanged : null)
                  .marginOnly(right: 5),
              Expanded(
                  child: Text(
                translate('Unlock with PIN'),
                style: TextStyle(color: disabledTextColor(context, enabled)),
              ))
            ],
          )),
      onTap: enabled
          ? () {
              onChanged(!unlockPin.isNotEmpty);
            }
          : null,
    ).marginOnly(left: _kCheckBoxLeftMargin);
  }
}

class _Network extends StatefulWidget {
  const _Network({Key? key}) : super(key: key);

  @override
  State<_Network> createState() => _NetworkState();
}

class _NetworkState extends State<_Network> with AutomaticKeepAliveClientMixin {
  @override
  bool get wantKeepAlive => true;
  bool locked = !isWeb && bind.mainIsInstalled();

  final scrollController = ScrollController();

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return ListView(controller: scrollController, children: [
      _lock(locked, 'Unlock Network Settings', () {
        locked = false;
        setState(() => {});
      }),
      preventMouseKeyBuilder(
        block: locked,
        child: Column(children: [
          network(context),
        ]),
      ),
    ]).marginOnly(bottom: _kListViewBottomMargin);
  }

  Widget network(BuildContext context) {
    final hideServer =
        bind.mainGetBuildinOption(key: kOptionHideServerSetting) == 'Y';
    final hideProxy =
        isWeb || bind.mainGetBuildinOption(key: kOptionHideProxySetting) == 'Y';
    final hideWebSocket = isWeb ||
        bind.mainGetBuildinOption(key: kOptionHideWebSocketSetting) == 'Y';

    if (hideServer && hideProxy && hideWebSocket) {
      return Offstage();
    }

    // Helper function to create network setting ListTiles
    Widget listTile({
      required IconData icon,
      required String title,
      VoidCallback? onTap,
      Widget? trailing,
      bool showTooltip = false,
      String tooltipMessage = '',
    }) {
      final titleWidget = showTooltip
          ? Row(
              children: [
                Tooltip(
                  waitDuration: Duration(milliseconds: 1000),
                  message: translate(tooltipMessage),
                  child: Row(
                    children: [
                      Text(
                        translate(title),
                        style: TextStyle(fontSize: _kContentFontSize),
                      ),
                      SizedBox(width: 5),
                      Icon(
                        Icons.help_outline,
                        size: 14,
                        color: Theme.of(context)
                            .textTheme
                            .titleLarge
                            ?.color
                            ?.withOpacity(0.7),
                      ),
                    ],
                  ),
                ),
              ],
            )
          : Text(
              translate(title),
              style: TextStyle(fontSize: _kContentFontSize),
            );

      return ListTile(
        leading: Icon(icon, color: _accentColor),
        title: titleWidget,
        enabled: !locked,
        onTap: onTap,
        trailing: trailing,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
        ),
        contentPadding: EdgeInsets.symmetric(horizontal: 16),
        minLeadingWidth: 0,
        horizontalTitleGap: 10,
      );
    }

    Widget switchWidget(IconData icon, String title, String tooltipMessage,
            String optionKey) =>
        listTile(
          icon: icon,
          title: title,
          showTooltip: true,
          tooltipMessage: tooltipMessage,
          trailing: Switch(
            value: mainGetBoolOptionSync(optionKey),
            onChanged: locked || isOptionFixed(optionKey)
                ? null
                : (value) {
                    mainSetBoolOption(optionKey, value);
                    setState(() {});
                  },
          ),
        );

    final outgoingOnly = bind.isOutgoingOnly();

    final divider = const Divider(height: 1, indent: 16, endIndent: 16);
    return _Card(
      title: 'Network',
      hint: '⚠️ ID/릴레이 서버는 인스톨러가 자동 설정 (sepani.synology.me). 절대 손대지 마세요. 나머지(프록시·웹소켓·TLS·UDP)는 거래처 운영에서 거의 안 씁니다.',
      children: [
        Container(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!hideServer)
                listTile(
                  icon: Icons.dns_outlined,
                  title: 'ID/Relay Server',
                  onTap: () => showServerSettings(gFFI.dialogManager, setState),
                ),
              if (!hideProxy && !hideServer) divider,
              if (!hideProxy)
                listTile(
                  icon: Icons.network_ping_outlined,
                  title: 'Socks5/Http(s) Proxy',
                  onTap: changeSocks5Proxy,
                ),
              if (!hideWebSocket && (!hideServer || !hideProxy)) divider,
              if (!hideWebSocket)
                switchWidget(
                    Icons.web_asset_outlined,
                    'Use WebSocket',
                    '${translate('websocket_tip')}\n\n${translate('server-oss-not-support-tip')}',
                    kOptionAllowWebSocket),
              if (!isWeb)
                futureBuilder(
                  future: bind.mainIsUsingPublicServer(),
                  hasData: (isUsingPublicServer) {
                    if (isUsingPublicServer) {
                      return Offstage();
                    } else {
                      return Column(
                        children: [
                          if (!hideServer || !hideProxy || !hideWebSocket)
                            divider,
                          switchWidget(
                              Icons.no_encryption_outlined,
                              'Allow insecure TLS fallback',
                              'allow-insecure-tls-fallback-tip',
                              kOptionAllowInsecureTLSFallback),
                          if (!outgoingOnly) divider,
                          if (!outgoingOnly)
                            listTile(
                              icon: Icons.lan_outlined,
                              title: 'Disable UDP',
                              showTooltip: true,
                              tooltipMessage:
                                  '${translate('disable-udp-tip')}\n\n${translate('server-oss-not-support-tip')}',
                              trailing: Switch(
                                value: bind.mainGetOptionSync(
                                        key: kOptionDisableUdp) ==
                                    'Y',
                                onChanged:
                                    locked || isOptionFixed(kOptionDisableUdp)
                                        ? null
                                        : (value) async {
                                            await bind.mainSetOption(
                                                key: kOptionDisableUdp,
                                                value: value ? 'Y' : 'N');
                                            setState(() {});
                                          },
                              ),
                            ),
                        ],
                      );
                    }
                  },
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Display extends StatefulWidget {
  const _Display({Key? key}) : super(key: key);

  @override
  State<_Display> createState() => _DisplayState();
}

class _DisplayState extends State<_Display> {
  @override
  Widget build(BuildContext context) {
    final scrollController = ScrollController();
    return ListView(controller: scrollController, children: [
      viewStyle(context),
      scrollStyle(context),
      imageQuality(context),
      codec(context),
      if (isDesktop) trackpadSpeed(context),
      if (!isWeb) privacyModeImpl(context),
      other(context),
    ]).marginOnly(bottom: _kListViewBottomMargin);
  }

  Widget viewStyle(BuildContext context) {
    final isOptFixed = isOptionFixed(kOptionViewStyle);
    onChanged(String value) async {
      await bind.mainSetUserDefaultOption(key: kOptionViewStyle, value: value);
      setState(() {});
    }

    final groupValue = bind.mainGetUserDefaultOption(key: kOptionViewStyle);
    return _Card(title: 'Default View Style', hint: '거래처 운영 권장: "크기 조정 가능". 4K 거래처 PC도 본사 창 크기에 맞춤.', children: [
      _Radio(context,
          value: kRemoteViewStyleOriginal,
          groupValue: groupValue,
          label: 'Scale original',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: kRemoteViewStyleAdaptive,
          groupValue: groupValue,
          label: 'Scale adaptive',
          onChanged: isOptFixed ? null : onChanged),
    ]);
  }

  Widget scrollStyle(BuildContext context) {
    final isOptFixed = isOptionFixed(kOptionScrollStyle);
    onChanged(String value) async {
      await bind.mainSetUserDefaultOption(
          key: kOptionScrollStyle, value: value);
      setState(() {});
    }

    final groupValue = bind.mainGetUserDefaultOption(key: kOptionScrollStyle);

    onEdgeScrollEdgeThicknessChanged(double value) async {
      await bind.mainSetUserDefaultOption(
          key: kOptionEdgeScrollEdgeThickness, value: value.round().toString());
      setState(() {});
    }

    return _Card(title: 'Default Scroll Style', children: [
      _Radio(context,
          value: kRemoteScrollStyleAuto,
          groupValue: groupValue,
          label: 'ScrollAuto',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: kRemoteScrollStyleBar,
          groupValue: groupValue,
          label: 'Scrollbar',
          onChanged: isOptFixed ? null : onChanged),
      if (!isWeb) ...[
        _Radio(context,
            value: kRemoteScrollStyleEdge,
            groupValue: groupValue,
            label: 'ScrollEdge',
            onChanged: isOptFixed ? null : onChanged),
        Offstage(
            offstage: groupValue != kRemoteScrollStyleEdge,
            child: EdgeThicknessControl(
              value: double.tryParse(bind.mainGetUserDefaultOption(
                      key: kOptionEdgeScrollEdgeThickness)) ??
                  100.0,
              onChanged: isOptionFixed(kOptionEdgeScrollEdgeThickness)
                  ? null
                  : onEdgeScrollEdgeThicknessChanged,
            )),
      ],
    ]);
  }

  Widget imageQuality(BuildContext context) {
    onChanged(String value) async {
      await bind.mainSetUserDefaultOption(
          key: kOptionImageQuality, value: value);
      setState(() {});
    }

    final isOptFixed = isOptionFixed(kOptionImageQuality);
    final groupValue = bind.mainGetUserDefaultOption(key: kOptionImageQuality);
    return _Card(title: 'Default Image Quality', hint: '거래처 운영 권장: "반응 시간 최적화". 살짝 흐려도 끊김 없이 빠르게.', children: [
      _Radio(context,
          value: kRemoteImageQualityBest,
          groupValue: groupValue,
          label: 'Good image quality',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: kRemoteImageQualityBalanced,
          groupValue: groupValue,
          label: 'Balanced',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: kRemoteImageQualityLow,
          groupValue: groupValue,
          label: 'Optimize reaction time',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: kRemoteImageQualityCustom,
          groupValue: groupValue,
          label: 'Custom',
          onChanged: isOptFixed ? null : onChanged),
      Offstage(
        offstage: groupValue != kRemoteImageQualityCustom,
        child: customImageQualitySetting(),
      )
    ]);
  }

  Widget trackpadSpeed(BuildContext context) {
    final initSpeed =
        (int.tryParse(bind.mainGetUserDefaultOption(key: kKeyTrackpadSpeed)) ??
            kDefaultTrackpadSpeed);
    final curSpeed = SimpleWrapper(initSpeed);
    void onDebouncer(int v) {
      bind.mainSetUserDefaultOption(
          key: kKeyTrackpadSpeed, value: v.toString());
      // It's better to notify all sessions that the default speed is changed.
      // But it may also be ok to take effect in the next connection.
    }

    return _Card(title: 'Default trackpad speed', children: [
      TrackpadSpeedWidget(
        value: curSpeed,
        onDebouncer: onDebouncer,
      ),
    ]);
  }

  Widget codec(BuildContext context) {
    onChanged(String value) async {
      await bind.mainSetUserDefaultOption(
          key: kOptionCodecPreference, value: value);
      setState(() {});
    }

    final groupValue =
        bind.mainGetUserDefaultOption(key: kOptionCodecPreference);
    var hwRadios = [];
    final isOptFixed = isOptionFixed(kOptionCodecPreference);
    try {
      final Map codecsJson = jsonDecode(bind.mainSupportedHwdecodings());
      final h264 = codecsJson['h264'] ?? false;
      final h265 = codecsJson['h265'] ?? false;
      if (h264) {
        hwRadios.add(_Radio(context,
            value: 'h264',
            groupValue: groupValue,
            label: 'H264',
            onChanged: isOptFixed ? null : onChanged));
      }
      if (h265) {
        hwRadios.add(_Radio(context,
            value: 'h265',
            groupValue: groupValue,
            label: 'H265',
            onChanged: isOptFixed ? null : onChanged));
      }
    } catch (e) {
      debugPrint("failed to parse supported hwdecodings, err=$e");
    }
    return _Card(title: 'Default Codec', hint: 'Auto 권장. 본사·거래처 환경 따라 자동으로 최선 선택.', children: [
      _Radio(context,
          value: 'auto',
          groupValue: groupValue,
          label: 'Auto',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: 'vp8',
          groupValue: groupValue,
          label: 'VP8',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: 'vp9',
          groupValue: groupValue,
          label: 'VP9',
          onChanged: isOptFixed ? null : onChanged),
      _Radio(context,
          value: 'av1',
          groupValue: groupValue,
          label: 'AV1',
          onChanged: isOptFixed ? null : onChanged),
      ...hwRadios,
    ]);
  }

  Widget privacyModeImpl(BuildContext context) {
    final supportedPrivacyModeImpls = bind.mainSupportedPrivacyModeImpls();
    late final List<dynamic> privacyModeImpls;
    try {
      privacyModeImpls = jsonDecode(supportedPrivacyModeImpls);
    } catch (e) {
      debugPrint('failed to parse supported privacy mode impls, err=$e');
      return Offstage();
    }
    if (privacyModeImpls.length < 2) {
      return Offstage();
    }

    final key = 'privacy-mode-impl-key';
    onChanged(String value) async {
      await bind.mainSetOption(key: key, value: value);
      setState(() {});
    }

    String groupValue = bind.mainGetOptionSync(key: key);
    if (groupValue.isEmpty) {
      groupValue = bind.mainDefaultPrivacyModeImpl();
    }
    return _Card(
      title: 'Privacy mode',
      children: privacyModeImpls.map((impl) {
        final d = impl as List<dynamic>;
        return _Radio(context,
            value: d[0] as String,
            groupValue: groupValue,
            label: d[1] as String,
            onChanged: onChanged);
      }).toList(),
    );
  }

  Widget otherRow(String label, String key) {
    final value = bind.mainGetUserDefaultOption(key: key) == 'Y';
    final isOptFixed = isOptionFixed(key);
    onChanged(bool b) async {
      await bind.mainSetUserDefaultOption(
          key: key,
          value: b
              ? 'Y'
              : (key == kOptionEnableFileCopyPaste ? 'N' : defaultOptionNo));
      setState(() {});
    }

    return GestureDetector(
        child: Row(
          children: [
            Checkbox(
                    value: value,
                    onChanged: isOptFixed ? null : (_) => onChanged(!value))
                .marginOnly(right: 5),
            Expanded(
              child: Text(translate(label)),
            )
          ],
        ).marginOnly(left: _kCheckBoxLeftMargin),
        onTap: isOptFixed ? null : () => onChanged(!value));
  }

  Widget other(BuildContext context) {
    final children =
        otherDefaultSettings().map((e) => otherRow(e.$1, e.$2)).toList();
    return _Card(title: 'Other Default Options', children: children);
  }
}

class _Account extends StatefulWidget {
  const _Account({Key? key}) : super(key: key);

  @override
  State<_Account> createState() => _AccountState();
}

class _AccountState extends State<_Account> {
  @override
  Widget build(BuildContext context) {
    final scrollController = ScrollController();
    return ListView(
      controller: scrollController,
      children: [
        _Card(title: 'Account', children: [accountAction(), useInfo()]),
      ],
    ).marginOnly(bottom: _kListViewBottomMargin);
  }

  Widget accountAction() {
    return Obx(() => _Button(
        gFFI.userModel.userName.value.isEmpty
            ? 'Login'
            : '${translate('Logout')} (${gFFI.userModel.accountLabelWithHandle})',
        () => {
              gFFI.userModel.userName.value.isEmpty
                  ? loginDialog()
                  : logOutConfirmDialog()
            }));
  }

  Widget useInfo() {
    return Obx(() => Offstage(
          offstage: gFFI.userModel.userName.value.isEmpty,
          child: Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Builder(builder: (context) {
              final avatarWidget = _buildUserAvatar();
              return Row(
                children: [
                  if (avatarWidget != null) avatarWidget,
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          gFFI.userModel.displayNameOrUserName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        SelectionArea(
                          child: Text(
                            '@${gFFI.userModel.userName.value}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 13,
                              color:
                                  Theme.of(context).textTheme.bodySmall?.color,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            }),
          ),
        )).marginOnly(left: 18, top: 16);
  }

  Widget? _buildUserAvatar() {
    // Resolve relative avatar path at display time
    final avatar =
        bind.mainResolveAvatarUrl(avatar: gFFI.userModel.avatar.value);
    return buildAvatarWidget(
      avatar: avatar,
      size: 44,
    );
  }
}

class _Checkbox extends StatefulWidget {
  final String label;
  final bool Function() getValue;
  final Future<void> Function(bool) setValue;

  const _Checkbox(
      {Key? key,
      required this.label,
      required this.getValue,
      required this.setValue})
      : super(key: key);

  @override
  State<_Checkbox> createState() => _CheckboxState();
}

class _CheckboxState extends State<_Checkbox> {
  var value = false;

  @override
  initState() {
    super.initState();
    value = widget.getValue();
  }

  @override
  Widget build(BuildContext context) {
    onChanged(bool b) async {
      await widget.setValue(b);
      setState(() {
        value = widget.getValue();
      });
    }

    return GestureDetector(
      child: Row(
        children: [
          Checkbox(
            value: value,
            onChanged: (_) => onChanged(!value),
          ).marginOnly(right: 5),
          Expanded(
            child: Text(translate(widget.label)),
          )
        ],
      ).marginOnly(left: _kCheckBoxLeftMargin),
      onTap: () => onChanged(!value),
    );
  }
}

class _Plugin extends StatefulWidget {
  const _Plugin({Key? key}) : super(key: key);

  @override
  State<_Plugin> createState() => _PluginState();
}

class _PluginState extends State<_Plugin> {
  @override
  Widget build(BuildContext context) {
    bind.pluginListReload();
    final scrollController = ScrollController();
    return ChangeNotifierProvider.value(
      value: pluginManager,
      child: Consumer<PluginManager>(builder: (context, model, child) {
        return ListView(
          controller: scrollController,
          children: model.plugins.map((entry) => pluginCard(entry)).toList(),
        ).marginOnly(bottom: _kListViewBottomMargin);
      }),
    );
  }

  Widget pluginCard(PluginInfo plugin) {
    return ChangeNotifierProvider.value(
      value: plugin,
      child: Consumer<PluginInfo>(
        builder: (context, model, child) => DesktopSettingsCard(plugin: model),
      ),
    );
  }

  Widget accountAction() {
    return Obx(() => _Button(
        gFFI.userModel.userName.value.isEmpty
            ? 'Login'
            : '${translate('Logout')} (${gFFI.userModel.accountLabelWithHandle})',
        () => {
              gFFI.userModel.userName.value.isEmpty
                  ? loginDialog()
                  : logOutConfirmDialog()
            }));
  }
}

class _Printer extends StatefulWidget {
  const _Printer({super.key});

  @override
  State<_Printer> createState() => __PrinterState();
}

class __PrinterState extends State<_Printer> {
  @override
  Widget build(BuildContext context) {
    final scrollController = ScrollController();
    return ListView(controller: scrollController, children: [
      outgoing(context),
      incoming(context),
    ]).marginOnly(bottom: _kListViewBottomMargin);
  }

  Widget outgoing(BuildContext context) {
    final isSupportPrinterDriver =
        bind.mainGetCommonSync(key: 'is-support-printer-driver') == 'true';

    Widget tipOsNotSupported() {
      return Align(
        alignment: Alignment.topLeft,
        child: Text(translate('printer-os-requirement-tip')),
      ).marginOnly(left: _kCardLeftMargin);
    }

    Widget tipClientNotInstalled() {
      return Align(
        alignment: Alignment.topLeft,
        child:
            Text(translate('printer-requires-installed-{$appName}-client-tip')),
      ).marginOnly(left: _kCardLeftMargin);
    }

    Widget tipPrinterNotInstalled() {
      final failedMsg = ''.obs;
      platformFFI.registerEventHandler(
          'install-printer-res', 'install-printer-res', (evt) async {
        if (evt['success'] as bool) {
          setState(() {});
        } else {
          failedMsg.value = evt['msg'] as String;
        }
      }, replace: true);
      return Column(children: [
        Obx(
          () => failedMsg.value.isNotEmpty
              ? Offstage()
              : Align(
                  alignment: Alignment.topLeft,
                  child: Text(translate('printer-{$appName}-not-installed-tip'))
                      .marginOnly(bottom: 10.0),
                ),
        ),
        Obx(
          () => failedMsg.value.isEmpty
              ? Offstage()
              : Align(
                  alignment: Alignment.topLeft,
                  child: Text(failedMsg.value,
                          style: DefaultTextStyle.of(context)
                              .style
                              .copyWith(color: Colors.red))
                      .marginOnly(bottom: 10.0)),
        ),
        _Button('Install {$appName} Printer', () {
          failedMsg.value = '';
          bind.mainSetCommon(key: 'install-printer', value: '');
        })
      ]).marginOnly(left: _kCardLeftMargin, bottom: 2.0);
    }

    Widget tipReady() {
      return Align(
        alignment: Alignment.topLeft,
        child: Text(translate('printer-{$appName}-ready-tip')),
      ).marginOnly(left: _kCardLeftMargin);
    }

    final installed = bind.mainIsInstalled();
    // `is-printer-installed` may fail, but it's rare case.
    // Add additional error message here if it's really needed.
    final isPrinterInstalled =
        bind.mainGetCommonSync(key: 'is-printer-installed') == 'true';

    final List<Widget> children = [];
    if (!isSupportPrinterDriver) {
      children.add(tipOsNotSupported());
    } else {
      children.addAll([
        if (!installed) tipClientNotInstalled(),
        if (installed && !isPrinterInstalled) tipPrinterNotInstalled(),
        if (installed && isPrinterInstalled) tipReady()
      ]);
    }
    return _Card(title: 'Outgoing Print Jobs', children: children);
  }

  Widget incoming(BuildContext context) {
    onRadioChanged(String value) async {
      await bind.mainSetLocalOption(
          key: kKeyPrinterIncomingJobAction, value: value);
      setState(() {});
    }

    PrinterOptions printerOptions = PrinterOptions.load();
    return _Card(title: 'Incoming Print Jobs', children: [
      _Radio(context,
          value: kValuePrinterIncomingJobDismiss,
          groupValue: printerOptions.action,
          label: 'Dismiss',
          onChanged: onRadioChanged),
      _Radio(context,
          value: kValuePrinterIncomingJobDefault,
          groupValue: printerOptions.action,
          label: 'use-the-default-printer-tip',
          onChanged: onRadioChanged),
      _Radio(context,
          value: kValuePrinterIncomingJobSelected,
          groupValue: printerOptions.action,
          label: 'use-the-selected-printer-tip',
          onChanged: onRadioChanged),
      if (printerOptions.printerNames.isNotEmpty)
        ComboBox(
          initialKey: printerOptions.printerName,
          keys: printerOptions.printerNames,
          values: printerOptions.printerNames,
          enabled: printerOptions.action == kValuePrinterIncomingJobSelected,
          onChanged: (value) async {
            await bind.mainSetLocalOption(
                key: kKeyPrinterSelected, value: value);
            setState(() {});
          },
        ).marginOnly(left: 10),
      _OptionCheckBox(
        context,
        'auto-print-tip',
        kKeyPrinterAllowAutoPrint,
        isServer: false,
        enabled: printerOptions.action != kValuePrinterIncomingJobDismiss,
      )
    ]);
  }
}

class _About extends StatefulWidget {
  const _About({Key? key}) : super(key: key);

  @override
  State<_About> createState() => _AboutState();
}

class _AboutState extends State<_About> {
  @override
  Widget build(BuildContext context) {
    return futureBuilder(future: () async {
      final license = await bind.mainGetLicense();
      final version = await bind.mainGetVersion();
      final buildDate = await bind.mainGetBuildDate();
      final fingerprint = await bind.mainGetFingerprint();
      return {
        'license': license,
        'version': version,
        'buildDate': buildDate,
        'fingerprint': fingerprint
      };
    }(), hasData: (data) {
      final license = data['license'].toString();
      final version = data['version'].toString();
      final buildDate = data['buildDate'].toString();
      final fingerprint = data['fingerprint'].toString();
      const linkStyle = TextStyle(decoration: TextDecoration.underline);
      final scrollController = ScrollController();
      return SingleChildScrollView(
        controller: scrollController,
        child: _Card(title: 'ChainRemote 정보', children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 8.0),
              // ChainRemote 브랜드 헤더
              Container(
                padding: const EdgeInsets.symmetric(
                    vertical: 16, horizontal: 12),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFF1E5BFF), Color(0xFF00B894)],
                  ),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const SelectionArea(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'ChainRemote',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w800),
                      ),
                      SizedBox(height: 4),
                      Text(
                        '체인리모트 — 베타포스랩 자체 원격지원 솔루션',
                        style: TextStyle(
                            color: Colors.white, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ).marginSymmetric(vertical: 6.0),
              const SizedBox(height: 12),
              SelectionArea(
                  child: Text('버전: $version')
                      .marginSymmetric(vertical: 4.0)),
              SelectionArea(
                  child: Text('빌드 날짜: $buildDate')
                      .marginSymmetric(vertical: 4.0)),
              if (!isWeb)
                SelectionArea(
                    child: Text('지문: $fingerprint')
                        .marginSymmetric(vertical: 4.0)),
              SelectionArea(
                  child: const Text(
                          '회사: 베타포스랩 (BetaPosLab)\n홈페이지: betaposlab.com\n관리 패널: admin.betaposlab.com\n기술지원: zentars004@gmail.com')
                      .marginSymmetric(vertical: 6.0)),
              const SizedBox(height: 8),
              const Divider(),
              // 원본 RustDesk 크레딧 (AGPL 라이선스 의무 표기)
              const Text(
                '오픈소스 기반',
                style: TextStyle(
                    fontSize: 12, fontWeight: FontWeight.w700),
              ).marginSymmetric(vertical: 4.0),
              SelectionArea(
                child: Text(
                  'ChainRemote 는 RustDesk (AGPL v3) 의 포크입니다.\n원본 저작권: Copyright © ${DateTime.now().toString().substring(0, 4)} Purslane Ltd.\n$license',
                  style: const TextStyle(fontSize: 11, color: Colors.grey),
                ),
              ).marginSymmetric(vertical: 4.0),
              InkWell(
                  onTap: () {
                    launchUrlString('https://rustdesk.com');
                  },
                  child: Text(
                    'RustDesk 원본 웹사이트',
                    style:
                        linkStyle.copyWith(fontSize: 11, color: Colors.grey),
                  ).marginSymmetric(vertical: 4.0)),
              InkWell(
                  onTap: () {
                    launchUrlString('https://rustdesk.com/privacy.html');
                  },
                  child: Text(
                    'RustDesk 개인정보 보호정책',
                    style:
                        linkStyle.copyWith(fontSize: 11, color: Colors.grey),
                  ).marginSymmetric(vertical: 4.0)),
            ],
          ).marginOnly(left: _kContentHMargin)
        ]),
      );
    });
  }
}

//#endregion

//#region components

// ignore: non_constant_identifier_names
// ChainRemote: 카드 = 좌측 브랜드 블루 강조선 + 옅은 헤더 + 옵션 힌트.
Widget _Card(
    {required String title,
    required List<Widget> children,
    List<Widget>? title_suffix,
    String? hint}) {
  const brandBlue = Color(0xFF1E5BFF);
  return Row(
    children: [
      Flexible(
        child: SizedBox(
          width: _kCardFixedWidth,
          child: Card(
            elevation: 0.5,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(10),
              side: BorderSide(
                  color: const Color(0xFFE2E8F0), width: 0.5),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 헤더: 좌측 4px 브랜드 블루 막대 + 제목
                IntrinsicHeight(
                  child: Row(
                    children: [
                      Container(
                        width: 4,
                        decoration: const BoxDecoration(
                          color: brandBlue,
                          borderRadius: BorderRadius.only(
                            topLeft: Radius.circular(10),
                          ),
                        ),
                      ),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
                          child: Row(
                            children: [
                              Expanded(
                                  child: Text(
                                translate(title),
                                textAlign: TextAlign.start,
                                style: const TextStyle(
                                  fontSize: _kTitleFontSize,
                                  fontWeight: FontWeight.w700,
                                ),
                              )),
                              ...?title_suffix
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                // ChainRemote 운영 힌트 (있을 때만)
                if (hint != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline_rounded,
                            size: 14, color: brandBlue),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            hint,
                            style: const TextStyle(
                              fontSize: 11,
                              color: Color(0xFF4A5568),
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ...children
                    .map((e) => e.marginOnly(top: 4, right: _kContentHMargin)),
                const SizedBox(height: 10),
              ],
            ),
          ).marginOnly(left: _kCardLeftMargin, top: 15),
        ),
      ),
    ],
  );
}

// ignore: non_constant_identifier_names
Widget _OptionCheckBox(
  BuildContext context,
  String label,
  String key, {
  Function(bool)? update,
  bool reverse = false,
  bool enabled = true,
  Icon? checkedIcon,
  bool? fakeValue,
  bool isServer = true,
  bool Function()? optGetter,
  Future<void> Function(String, bool)? optSetter,
}) {
  getOpt() => optGetter != null
      ? optGetter()
      : (isServer
          ? mainGetBoolOptionSync(key)
          : mainGetLocalBoolOptionSync(key));
  bool value = getOpt();
  final isOptFixed = isOptionFixed(key);
  if (reverse) value = !value;
  var ref = value.obs;
  onChanged(option) async {
    if (option != null) {
      if (reverse) option = !option;
      final setter =
          optSetter ?? (isServer ? mainSetBoolOption : mainSetLocalBoolOption);
      await setter(key, option);
      final readOption = getOpt();
      if (reverse) {
        ref.value = !readOption;
      } else {
        ref.value = readOption;
      }
      update?.call(readOption);
    }
  }

  if (fakeValue != null) {
    ref.value = fakeValue;
    enabled = false;
  }

  return GestureDetector(
    child: Obx(
      () => Row(
        children: [
          Checkbox(
                  value: ref.value,
                  onChanged: enabled && !isOptFixed ? onChanged : null)
              .marginOnly(right: 5),
          Offstage(
            offstage: !ref.value || checkedIcon == null,
            child: checkedIcon?.marginOnly(right: 5),
          ),
          Expanded(
              child: Text(
            translate(label),
            style: TextStyle(color: disabledTextColor(context, enabled)),
          ))
        ],
      ),
    ).marginOnly(left: _kCheckBoxLeftMargin),
    onTap: enabled && !isOptFixed
        ? () {
            onChanged(!ref.value);
          }
        : null,
  );
}

// ignore: non_constant_identifier_names
Widget _Radio<T>(BuildContext context,
    {required T value,
    required T groupValue,
    required String label,
    required Function(T value)? onChanged,
    bool autoNewLine = true}) {
  final onChange2 = onChanged != null
      ? (T? value) {
          if (value != null) {
            onChanged(value);
          }
        }
      : null;
  return GestureDetector(
    child: Row(
      children: [
        Radio<T>(value: value, groupValue: groupValue, onChanged: onChange2),
        Expanded(
          child: Text(translate(label),
                  overflow: autoNewLine ? null : TextOverflow.ellipsis,
                  style: TextStyle(
                      fontSize: _kContentFontSize,
                      color: disabledTextColor(context, onChange2 != null)))
              .marginOnly(left: 5),
        ),
      ],
    ).marginOnly(left: _kRadioLeftMargin),
    onTap: () => onChange2?.call(value),
  );
}

class WaylandCard extends StatefulWidget {
  const WaylandCard({Key? key}) : super(key: key);

  @override
  State<WaylandCard> createState() => _WaylandCardState();
}

class _WaylandCardState extends State<WaylandCard> {
  final restoreTokenKey = 'wayland-restore-token';
  static const _kClearShortcutsInhibitorEventKey =
      'clear-gnome-shortcuts-inhibitor-permission-res';
  final _clearShortcutsInhibitorFailedMsg = ''.obs;
  // Don't show the shortcuts permission reset button for now.
  // Users can change it manually:
  //   "Settings" -> "Apps" -> "RustDesk" -> "Permissions" -> "Inhibit Shortcuts".
  // For resetting(clearing) the permission from the portal permission store, you can
  // use (replace <desktop-id> with the RustDesk desktop file ID):
  //   busctl --user call org.freedesktop.impl.portal.PermissionStore \
  //   /org/freedesktop/impl/portal/PermissionStore org.freedesktop.impl.portal.PermissionStore \
  //   DeletePermission sss "gnome" "shortcuts-inhibitor" "<desktop-id>"
  // On a native install this is typically "rustdesk.desktop"; on Flatpak it is usually
  // the exported desktop ID derived from the Flatpak app-id (e.g. "com.rustdesk.RustDesk.desktop").
  //
  // We may add it back in the future if needed.
  final showResetInhibitorPermission = false;

  @override
  void initState() {
    super.initState();
    if (showResetInhibitorPermission) {
      platformFFI.registerEventHandler(
          _kClearShortcutsInhibitorEventKey, _kClearShortcutsInhibitorEventKey,
          (evt) async {
        if (!mounted) return;
        if (evt['success'] == true) {
          setState(() {});
        } else {
          _clearShortcutsInhibitorFailedMsg.value =
              evt['msg'] as String? ?? 'Unknown error';
        }
      });
    }
  }

  @override
  void dispose() {
    if (showResetInhibitorPermission) {
      platformFFI.unregisterEventHandler(
          _kClearShortcutsInhibitorEventKey, _kClearShortcutsInhibitorEventKey);
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return futureBuilder(
      future: bind.mainHandleWaylandScreencastRestoreToken(
          key: restoreTokenKey, value: "get"),
      hasData: (restoreToken) {
        final hasShortcutsPermission = showResetInhibitorPermission &&
            bind.mainGetCommonSync(
                    key: "has-gnome-shortcuts-inhibitor-permission") ==
                "true";

        final children = [
          if (restoreToken.isNotEmpty)
            _buildClearScreenSelection(context, restoreToken),
          if (hasShortcutsPermission)
            _buildClearShortcutsInhibitorPermission(context),
        ];
        return Offstage(
          offstage: children.isEmpty,
          child: _Card(title: 'Wayland', children: children),
        );
      },
    );
  }

  Widget _buildClearScreenSelection(BuildContext context, String restoreToken) {
    onConfirm() async {
      final msg = await bind.mainHandleWaylandScreencastRestoreToken(
          key: restoreTokenKey, value: "clear");
      gFFI.dialogManager.dismissAll();
      if (msg.isNotEmpty) {
        msgBox(gFFI.sessionId, 'custom-nocancel', 'Error', msg, '',
            gFFI.dialogManager);
      } else {
        setState(() {});
      }
    }

    showConfirmMsgBox() => msgBoxCommon(
            gFFI.dialogManager,
            'Confirmation',
            Text(
              translate('confirm_clear_Wayland_screen_selection_tip'),
            ),
            [
              dialogButton('OK', onPressed: onConfirm),
              dialogButton('Cancel',
                  onPressed: () => gFFI.dialogManager.dismissAll())
            ]);

    return _Button(
      'Clear Wayland screen selection',
      showConfirmMsgBox,
      tip: 'clear_Wayland_screen_selection_tip',
      style: ButtonStyle(
        backgroundColor: MaterialStateProperty.all<Color>(
            Theme.of(context).colorScheme.error.withOpacity(0.75)),
      ),
    );
  }

  Widget _buildClearShortcutsInhibitorPermission(BuildContext context) {
    onConfirm() {
      _clearShortcutsInhibitorFailedMsg.value = '';
      bind.mainSetCommon(
          key: "clear-gnome-shortcuts-inhibitor-permission", value: "");
      gFFI.dialogManager.dismissAll();
    }

    showConfirmMsgBox() => msgBoxCommon(
            gFFI.dialogManager,
            'Confirmation',
            Text(
              translate('confirm-clear-shortcuts-inhibitor-permission-tip'),
            ),
            [
              dialogButton('OK', onPressed: onConfirm),
              dialogButton('Cancel',
                  onPressed: () => gFFI.dialogManager.dismissAll())
            ]);

    return Column(children: [
      Obx(
        () => _clearShortcutsInhibitorFailedMsg.value.isEmpty
            ? Offstage()
            : Align(
                alignment: Alignment.topLeft,
                child: Text(_clearShortcutsInhibitorFailedMsg.value,
                        style: DefaultTextStyle.of(context)
                            .style
                            .copyWith(color: Colors.red))
                    .marginOnly(bottom: 10.0)),
      ),
      _Button(
        'Reset keyboard shortcuts permission',
        showConfirmMsgBox,
        tip: 'clear-shortcuts-inhibitor-permission-tip',
        style: ButtonStyle(
          backgroundColor: MaterialStateProperty.all<Color>(
              Theme.of(context).colorScheme.error.withOpacity(0.75)),
        ),
      ),
    ]);
  }
}

// ignore: non_constant_identifier_names
Widget _Button(String label, Function() onPressed,
    {bool enabled = true, String? tip, ButtonStyle? style}) {
  var button = ElevatedButton(
    onPressed: enabled ? onPressed : null,
    child: Text(
      translate(label),
    ).marginSymmetric(horizontal: 15),
    style: style,
  );
  StatefulWidget child;
  if (tip == null) {
    child = button;
  } else {
    child = Tooltip(message: translate(tip), child: button);
  }
  return Row(children: [
    child,
  ]).marginOnly(left: _kContentHMargin);
}

// ignore: non_constant_identifier_names
Widget _SubButton(String label, Function() onPressed, [bool enabled = true]) {
  return Row(
    children: [
      ElevatedButton(
        onPressed: enabled ? onPressed : null,
        child: Text(
          translate(label),
        ).marginSymmetric(horizontal: 15),
      ),
    ],
  ).marginOnly(left: _kContentHSubMargin);
}

// ignore: non_constant_identifier_names
Widget _SubLabeledWidget(BuildContext context, String label, Widget child,
    {bool enabled = true}) {
  return Row(
    children: [
      Text(
        '${translate(label)}: ',
        style: TextStyle(color: disabledTextColor(context, enabled)),
      ),
      SizedBox(
        width: 10,
      ),
      child,
    ],
  ).marginOnly(left: _kContentHSubMargin);
}

Widget _lock(
  bool locked,
  String label,
  Function() onUnlock,
) {
  return Offstage(
      offstage: !locked,
      child: Row(
        children: [
          Flexible(
            child: SizedBox(
              width: _kCardFixedWidth,
              child: Card(
                child: ElevatedButton(
                  child: SizedBox(
                      height: 25,
                      child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(
                              Icons.security_sharp,
                              size: 20,
                            ),
                            Text(translate(label)).marginOnly(left: 5),
                          ]).marginSymmetric(vertical: 2)),
                  onPressed: () async {
                    final unlockPin = bind.mainGetUnlockPin();
                    if (unlockPin.isEmpty || isUnlockPinDisabled()) {
                      bool checked = await callMainCheckSuperUserPermission();
                      if (checked) {
                        onUnlock();
                      }
                    } else {
                      checkUnlockPinDialog(unlockPin, onUnlock);
                    }
                  },
                ).marginSymmetric(horizontal: 2, vertical: 4),
              ).marginOnly(left: _kCardLeftMargin),
            ).marginOnly(top: 10),
          ),
        ],
      ));
}

_LabeledTextField(
    BuildContext context,
    String label,
    TextEditingController controller,
    String errorText,
    bool enabled,
    bool secure) {
  return Table(
    columnWidths: const {
      0: FixedColumnWidth(150),
      1: FlexColumnWidth(),
    },
    defaultVerticalAlignment: TableCellVerticalAlignment.middle,
    children: [
      TableRow(
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 10),
            child: Text(
              '${translate(label)}:',
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: 16,
                color: disabledTextColor(context, enabled),
              ),
            ),
          ),
          TextField(
            controller: controller,
            enabled: enabled,
            obscureText: secure,
            autocorrect: false,
            decoration: InputDecoration(
              errorText: errorText.isNotEmpty ? errorText : null,
            ),
            style: TextStyle(
              color: disabledTextColor(context, enabled),
            ),
          ).workaroundFreezeLinuxMint(),
        ],
      ),
    ],
  ).marginOnly(bottom: 8);
}

class _CountDownButton extends StatefulWidget {
  _CountDownButton({
    Key? key,
    required this.text,
    required this.second,
    required this.onPressed,
  }) : super(key: key);
  final String text;
  final VoidCallback? onPressed;
  final int second;

  @override
  State<_CountDownButton> createState() => _CountDownButtonState();
}

class _CountDownButtonState extends State<_CountDownButton> {
  bool _isButtonDisabled = false;

  late int _countdownSeconds = widget.second;

  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startCountdownTimer() {
    _timer = Timer.periodic(Duration(seconds: 1), (timer) {
      if (_countdownSeconds <= 0) {
        setState(() {
          _isButtonDisabled = false;
        });
        timer.cancel();
      } else {
        setState(() {
          _countdownSeconds--;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: _isButtonDisabled
          ? null
          : () {
              widget.onPressed?.call();
              setState(() {
                _isButtonDisabled = true;
                _countdownSeconds = widget.second;
              });
              _startCountdownTimer();
            },
      child: Text(
        _isButtonDisabled ? '$_countdownSeconds s' : translate(widget.text),
      ),
    );
  }
}

//#endregion

//#region dialogs

void changeSocks5Proxy() async {
  var socks = await bind.mainGetSocks();

  String proxy = '';
  String proxyMsg = '';
  String username = '';
  String password = '';
  if (socks.length == 3) {
    proxy = socks[0];
    username = socks[1];
    password = socks[2];
  }
  var proxyController = TextEditingController(text: proxy);
  var userController = TextEditingController(text: username);
  var pwdController = TextEditingController(text: password);
  RxBool obscure = true.obs;

  // proxy settings
  // The following option is a not real key, it is just used for custom client advanced settings.
  const String optionProxyUrl = "proxy-url";
  final isOptFixed = isOptionFixed(optionProxyUrl);

  var isInProgress = false;
  gFFI.dialogManager.show((setState, close, context) {
    submit() async {
      setState(() {
        proxyMsg = '';
        isInProgress = true;
      });
      cancel() {
        setState(() {
          isInProgress = false;
        });
      }

      proxy = proxyController.text.trim();
      username = userController.text.trim();
      password = pwdController.text.trim();

      if (proxy.isNotEmpty) {
        String domainPort = proxy;
        if (domainPort.contains('://')) {
          domainPort = domainPort.split('://')[1];
        }
        proxyMsg = translate(await bind.mainTestIfValidServer(
            server: domainPort, testWithProxy: false));
        if (proxyMsg.isEmpty) {
          // ignore
        } else {
          cancel();
          return;
        }
      }
      await bind.mainSetSocks(
          proxy: proxy, username: username, password: password);
      close();
    }

    return CustomAlertDialog(
      title: Text(translate('Socks5/Http(s) Proxy')),
      content: ConstrainedBox(
        constraints: const BoxConstraints(minWidth: 500),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (!isMobile)
                  ConstrainedBox(
                    constraints: const BoxConstraints(minWidth: 140),
                    child: Align(
                        alignment: Alignment.centerRight,
                        child: Row(
                          children: [
                            Text(
                              translate('Server'),
                            ).marginOnly(right: 4),
                            Tooltip(
                              waitDuration: Duration(milliseconds: 0),
                              message: translate("default_proxy_tip"),
                              child: Icon(
                                Icons.help_outline_outlined,
                                size: 16,
                                color: Theme.of(context)
                                    .textTheme
                                    .titleLarge
                                    ?.color
                                    ?.withOpacity(0.5),
                              ),
                            ),
                          ],
                        )).marginOnly(right: 10),
                  ),
                Expanded(
                  child: TextField(
                    decoration: InputDecoration(
                      errorText: proxyMsg.isNotEmpty ? proxyMsg : null,
                      labelText: isMobile ? translate('Server') : null,
                      helperText:
                          isMobile ? translate("default_proxy_tip") : null,
                      helperMaxLines: isMobile ? 3 : null,
                    ),
                    controller: proxyController,
                    autofocus: true,
                    enabled: !isOptFixed,
                  ).workaroundFreezeLinuxMint(),
                ),
              ],
            ).marginOnly(bottom: 8),
            Row(
              children: [
                if (!isMobile)
                  ConstrainedBox(
                      constraints: const BoxConstraints(minWidth: 140),
                      child: Text(
                        '${translate("Username")}:',
                        textAlign: TextAlign.right,
                      ).marginOnly(right: 10)),
                Expanded(
                  child: TextField(
                    controller: userController,
                    decoration: InputDecoration(
                      labelText: isMobile ? translate('Username') : null,
                    ),
                    enabled: !isOptFixed,
                  ).workaroundFreezeLinuxMint(),
                ),
              ],
            ).marginOnly(bottom: 8),
            Row(
              children: [
                if (!isMobile)
                  ConstrainedBox(
                      constraints: const BoxConstraints(minWidth: 140),
                      child: Text(
                        '${translate("Password")}:',
                        textAlign: TextAlign.right,
                      ).marginOnly(right: 10)),
                Expanded(
                  child: Obx(() => TextField(
                        obscureText: obscure.value,
                        decoration: InputDecoration(
                            labelText: isMobile ? translate('Password') : null,
                            suffixIcon: IconButton(
                                onPressed: () => obscure.value = !obscure.value,
                                icon: Icon(obscure.value
                                    ? Icons.visibility_off
                                    : Icons.visibility))),
                        controller: pwdController,
                        enabled: !isOptFixed,
                        maxLength: bind.mainMaxEncryptLen(),
                      ).workaroundFreezeLinuxMint()),
                ),
              ],
            ),
            // NOT use Offstage to wrap LinearProgressIndicator
            if (isInProgress)
              const LinearProgressIndicator().marginOnly(top: 8),
          ],
        ),
      ),
      actions: [
        dialogButton('Cancel', onPressed: close, isOutline: true),
        if (!isOptFixed) dialogButton('OK', onPressed: submit),
      ],
      onSubmit: submit,
      onCancel: close,
    );
  });
}

//#endregion
