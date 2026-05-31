import Cocoa
import FlutterMacOS

@main
class AppDelegate: FlutterAppDelegate {
    var launched = false;
  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
      dummy_method_to_enforce_bundling()
    // https://github.com/leanflutter/window_manager/issues/214
    return false
  }
    
    override func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool {
        if (launched) {
            handle_applicationShouldOpenUntitledFile();
        }
        return true
    }
    
    // ChainRemote: 메인 창을 닫으면 windowManager.hide()(orderOut)로 창만 숨고 프로세스는 살아있다.
    // 이때 Dock 아이콘을 클릭해도 upstream 의 applicationShouldOpenUntitledFile 훅은
    // "창이 (숨겨졌지만) 존재"하므로 호출되지 않아 창이 다시 뜨지 않았다(강제종료해야 복구됨).
    // 표준 reopen 훅에서, 보이는 창이 하나도 없을 때 메인 창만 다시 표시한다.
    // (서버/CM/트레이 보조 프로세스는 제외 — 그쪽 창 가시성은 별도로 관리됨)
    override func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        let arg = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
        if arg != "--server" && arg != "--cm" && arg != "--tray" && !flag {
            for window in sender.windows where window is MainFlutterWindow {
                window.makeKeyAndOrderFront(self)
            }
        }
        return true
    }

    override func applicationDidFinishLaunching(_ aNotification: Notification) {
        launched = true;
        NSApplication.shared.activate(ignoringOtherApps: true);
    }
}
