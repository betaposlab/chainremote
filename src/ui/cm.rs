#[cfg(target_os = "linux")]
use crate::ipc::start_pa;
use crate::ui_cm_interface::{start_ipc, ConnectionManager, InvokeUiCM};

use hbb_common::{allow_err, log};
use sciter::{make_args, Element, Value, HELEMENT};
use std::sync::Mutex;
use std::{ops::Deref, sync::Arc};

lazy_static::lazy_static! {
    pub static ref HIDE_CM: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
    /// 이 cm 창의 HWND (ui.rs 가 창 생성 직후 채운다). 배너 모드 창 스타일 토글에 쓴다.
    /// 0 이면 아직 없음 — 그 경우 스타일 적용을 건너뛴다(기능 자체는 그대로 동작).
    /// ★usize 로 담는다 — u64 로 두면 32비트(Win7 POS 페이로드)에서 포인터 캐스팅이 컴파일 에러.
    pub static ref CM_HWND: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));
}

#[derive(Clone, Default)]
pub struct SciterHandler {
    pub element: Arc<Mutex<Option<Element>>>,
}

impl InvokeUiCM for SciterHandler {
    fn add_connection(&self, client: &crate::ui_cm_interface::Client) {
        self.call(
            "addConnection",
            &make_args!(
                client.id,
                client.is_file_transfer,
                client.is_view_camera,
                client.is_terminal,
                client.port_forward.clone(),
                client.peer_id.clone(),
                client.name.clone(),
                client.avatar.clone(),
                client.authorized,
                client.keyboard,
                client.clipboard,
                client.audio,
                client.file,
                client.restart,
                client.recording,
                client.block_input
            ),
        );
    }

    fn remove_connection(&self, id: i32, close: bool) {
        self.call("removeConnection", &make_args!(id, close));
        if crate::ui_cm_interface::get_clients_length().eq(&0) {
            crate::platform::quit_gui();
        }
    }

    fn new_message(&self, id: i32, text: String) {
        self.call("newMessage", &make_args!(id, text));
    }

    fn change_theme(&self, dark: String) {
        self.call("changeTheme", &make_args!(dark));
    }

    fn change_language(&self) {
        self.call("changeLanguage", &make_args!());
    }

    fn show_elevation(&self, show: bool) {
        self.call("showElevation", &make_args!(show));
    }

    fn update_voice_call_state(&self, client: &crate::ui_cm_interface::Client) {
        self.call(
            "updateVoiceCallState",
            &make_args!(client.id, client.in_voice_call, client.incoming_voice_call),
        );
    }

    fn file_transfer_log(&self, _action: &str, _log: &str) {}
}

impl SciterHandler {
    #[inline]
    fn call(&self, func: &str, args: &[Value]) {
        if let Some(e) = self.element.lock().unwrap().as_ref() {
            allow_err!(e.call_method(func, &super::value_crash_workaround(args)[..]));
        }
    }
}

pub struct SciterConnectionManager(ConnectionManager<SciterHandler>);

impl Deref for SciterConnectionManager {
    type Target = ConnectionManager<SciterHandler>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl SciterConnectionManager {
    pub fn new() -> Self {
        #[cfg(target_os = "linux")]
        std::thread::spawn(start_pa);
        let cm = ConnectionManager {
            ui_handler: SciterHandler::default(),
        };
        let cloned = cm.clone();
        std::thread::spawn(move || start_ipc(cloned));
        SciterConnectionManager(cm)
    }

    fn get_icon(&mut self) -> String {
        super::get_icon()
    }

    fn check_click_time(&mut self, id: i32) {
        crate::ui_cm_interface::check_click_time(id);
    }

    fn get_click_time(&self) -> f64 {
        crate::ui_cm_interface::get_click_time() as _
    }

    fn switch_permission(&self, id: i32, name: String, enabled: bool) {
        crate::ui_cm_interface::switch_permission(id, name, enabled);
    }

    fn close(&self, id: i32) {
        crate::ui_cm_interface::close(id);
    }

    fn remove_disconnected_connection(&self, id: i32) {
        crate::ui_cm_interface::remove(id);
    }

    fn quit(&self) {
        crate::platform::quit_gui();
    }

    fn authorize(&self, id: i32) {
        crate::ui_cm_interface::authorize(id);
    }

    fn send_msg(&self, id: i32, text: String) {
        crate::ui_cm_interface::send_chat(id, text);
    }

    fn t(&self, name: String) -> String {
        crate::client::translate(name)
    }

    fn can_elevate(&self) -> bool {
        crate::ui_cm_interface::can_elevate()
    }

    fn elevate_portable(&self, id: i32) {
        crate::ui_cm_interface::elevate_portable(id);
    }

    fn get_option(&self, key: String) -> String {
        crate::ui_interface::get_option(key)
    }

    /// 수락카드에 띄울 대리점 상호 — heartbeat 가 ProgramData 에 캐시해 둔 값.
    /// LocalConfig 를 쓰면 안 된다: heartbeat 는 서비스, 이 창은 사용자 세션이라
    /// 서로 다른 파일을 본다(그래서 한동안 전부 "본사"로만 떴다).
    /// 비면 cm.tis 가 "본사" 로 대체한다(구버전 서버 / 첫 하트비트 전).
    fn get_support_name(&self) -> String {
        // heartbeat 모듈은 Agent(윈도우) 전용이라 다른 OS 빌드엔 없다 — 그쪽은 빈 값.
        #[cfg(target_os = "windows")]
        {
            crate::chainremote_heartbeat::read_support_name()
        }
        #[cfg(not(target_os = "windows"))]
        {
            String::new()
        }
    }

    fn hide_cm(&self) -> bool {
        *crate::ui::cm::HIDE_CM.lock().unwrap()
    }

    /// 배너 모드 전환 알림 — cm.tis::applyCmBanner 가 상태가 바뀔 때만 부른다.
    /// 배너일 때 창을 NOACTIVATE/TOOLWINDOW 로, 수락 카드로 돌아가면 원복한다.
    /// 자세한 배경은 platform::windows::set_cm_banner_style 주석 참조.
    // ChainRemote: 배너로 줄어든 뒤 남는 잔상(구형 Win7 비합성 환경) 제거 — 비운 영역 재그리기.
    fn repaint_area(&self, x: i32, y: i32, w: i32, h: i32) {
        #[cfg(windows)]
        crate::platform::windows::repaint_desktop_area(x, y, w, h);
        #[cfg(not(windows))]
        let _ = (x, y, w, h);
    }

    fn set_banner_mode(&self, banner: bool) {
        #[cfg(windows)]
        {
            let hwnd = *crate::ui::cm::CM_HWND.lock().unwrap();
            if hwnd != 0 {
                crate::platform::windows::set_cm_banner_style(hwnd as _, banner);
            }
        }
        #[cfg(not(windows))]
        let _ = banner;
    }
}

impl sciter::EventHandler for SciterConnectionManager {
    fn attached(&mut self, root: HELEMENT) {
        *self.ui_handler.element.lock().unwrap() = Some(Element::from(root));
    }

    sciter::dispatch_script_call! {
        fn t(String);
        fn check_click_time(i32);
        fn get_click_time();
        fn get_icon();
        fn close(i32);
        fn remove_disconnected_connection(i32);
        fn quit();
        fn authorize(i32);
        fn switch_permission(i32, String, bool);
        fn send_msg(i32, String);
        fn can_elevate();
        fn elevate_portable(i32);
        fn get_option(String);
        fn get_support_name();
        fn hide_cm();
        fn set_banner_mode(bool);
        fn repaint_area(i32, i32, i32, i32);
    }
}
