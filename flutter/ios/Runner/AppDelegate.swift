import UIKit
import Flutter

// ★UIScene 생애주기 (2026-10-19)
//   Xcode 27(iOS 27 SDK)로 빌드한 앱이 UIScene 을 쓰지 않으면 iOS 가 실행 자체를 거부한다:
//     "Application failed to launch: UIScene life cycle is required for apps built with this SDK."
//   아이콘을 누르면 잠깐 떴다가 바로 꺼지는 것처럼 보이고, 크래시 리포트도 남지 않는다.
//   Flutter 3.24.5 에는 공식 장면 대리자(FlutterSceneDelegate, 3.38~)가 없어서 직접 잇는다.
//   - 창과 Flutter 화면은 장면이 연결될 때 만든다(SceneDelegate). 예전엔 UIKit 이 Main.storyboard 로
//     실행 직후 만들어 줬지만, 장면 방식에선 실행 시점에 창이 아직 없다.
//   - 플러그인 등록은 그 화면을 창에 붙이기 전에 한다. 엔진은 화면이 처음 로드될 때(viewDidLoad)
//     Dart 를 시작하므로, 순서가 바뀌면 Dart 의 첫 플랫폼 호출이 빈 채널에 떨어질 수 있다.
//   - 앱 상태(포그라운드·백그라운드) 알림은 손댈 것이 없다. 엔진과 플러그인 모두 UIApplication
//     알림으로 받고, 그 알림은 장면 방식에서도 똑같이 온다.
@main
@objc class AppDelegate: FlutterAppDelegate {
  /// 앱 전체에 Flutter 화면(=엔진) 하나. 장면이 끊겼다 다시 붙어도 이걸 다시 쓴다 —
  ///   새로 만들면 Dart 가 처음부터 다시 돌아 Rust 코어 초기화가 두 번 일어난다.
  private var flutterController: FlutterViewController?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    dummyMethodToEnforceBundling();
    // 여기선 아직 창도 Flutter 화면도 없다. 플러그인 등록과 플러그인에 보내는 실행 알림(super)은
    //   장면이 연결될 때 flutterController(for:connectionOptions:) 에서 한다.
    return true
  }

  /// SceneDelegate 가 창을 만들 때마다 부른다. 화면은 처음 한 번만 만들고 그때 플러그인을 등록한다.
  ///   돌려받은 화면을 창에 붙이는 건 부른 쪽 몫이다 — 등록이 끝난 뒤에 붙어야 하므로.
  func flutterController(
    for window: UIWindow,
    connectionOptions: UIScene.ConnectionOptions
  ) -> FlutterViewController {
    // FlutterAppDelegate 와 플러그인(파일·사진 고르기 등)이 창을 delegate.window 에서 찾는다.
    self.window = window
    if let existing = flutterController {
      // 다시 붙는 장면 — 엔진은 그대로다. 링크로 깨어났다면 실행 중 링크와 같은 길로 보낸다.
      for context in connectionOptions.urlContexts {
        open(context)
      }
      return existing
    }
    let controller = FlutterViewController(project: nil, nibName: nil, bundle: nil)
    GeneratedPluginRegistrant.register(with: controller)
    // 플러그인은 UIKit 의 실행 알림이 지나간 뒤에 등록됐으니 지금 전한다. uni_links 가 여기서
    //   "앱을 켠 링크"를 읽는다 — 패널 [원격] 버튼(rustdesk://ID)이 꺼져 있던 폰 앱을 켜는 경로.
    _ = super.application(
      UIApplication.shared, didFinishLaunchingWithOptions: launchOptions(from: connectionOptions))
    flutterController = controller
    return controller
  }

  /// 앱이 떠 있을 때 들어온 rustdesk:// 링크. 장면 방식에선 UIKit 이 AppDelegate 대신 장면에 준다.
  func open(_ context: UIOpenURLContext) {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
    if let source = context.options.sourceApplication { options[.sourceApplication] = source }
    if let annotation = context.options.annotation { options[.annotation] = annotation }
    _ = application(UIApplication.shared, open: context.url, options: options)
  }

  private func launchOptions(
    from options: UIScene.ConnectionOptions
  ) -> [UIApplication.LaunchOptionsKey: Any] {
    guard let context = options.urlContexts.first else { return [:] }
    var result: [UIApplication.LaunchOptionsKey: Any] = [.url: context.url]
    if let source = context.options.sourceApplication { result[.sourceApplication] = source }
    if let annotation = context.options.annotation { result[.annotation] = annotation }
    return result
  }

  public func dummyMethodToEnforceBundling() {
      dummy_method_to_enforce_bundling();
    session_get_rgba(nil, 0);
  }
}

/// 장면(창) 하나. Info.plist 의 UIApplicationSceneManifest 가 이 클래스를 가리킨다.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate else { return }
    let window = UIWindow(windowScene: windowScene)
    // 플러그인 등록이 끝난 화면을 받아서 그다음에 창에 붙인다(엔진 시작은 붙인 뒤).
    let controller = app.flutterController(for: window, connectionOptions: connectionOptions)
    window.rootViewController = controller
    self.window = window
    window.makeKeyAndVisible()
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
    for context in URLContexts {
      app.open(context)
    }
  }
}
