//! 원격 툴바 "윈도우 도구" — 본사가 거래처 화면에 장치 관리자 같은 정해진 도구를 띄운다.
//!
//! 두 단계로 돈다. 접속을 처리하는 `--server`(SYSTEM)는 번호를 확인하고, 사용자 세션에
//! 일회용 도우미(`--cr-wintool <번호>`)를 띄운 뒤 바로 손을 뗀다. 도우미가 사용자 권한으로
//! ShellExecuteEx 를 불러 도구를 연다.
//!
//! 왜 이렇게 돌아가나:
//!   - mmc(장치 관리자·서비스·이벤트 뷰어)와 taskmgr 은 "가능한 최고 권한"을 요구한다.
//!     사용자 세션에 곧장 CreateProcess 하는 `run_exe_in_session` 으로는 UAC 를 못 띄워,
//!     관리자 계정 + UAC 켜짐(포스 대부분)에서 error 740 으로 안 뜬다. UAC 는 ShellExecuteEx 만 띄운다.
//!   - `--server` 에서 바로 ShellExecuteEx 하면 도구가 SYSTEM 권한으로 거래처 화면에 뜬다.
//!     사장님 누구나 그 창으로 PC 를 바꿀 수 있는 권한 상승이라, 반드시 사용자 권한으로 연다.
//!   - UAC 응답을 기다리는 건 도우미 하나뿐이다. 파일 [실행]은 같은 기다림을 세션 처리 흐름
//!     안에서 하다가 세션을 통째로 굳혔다(1.4.81 에서 철회) — 같은 길을 다시 걷지 않는다.
//!
//! 번호 → 파일은 아래 고정 표가 전부다. 프로토콜에 명령 문자열을 실을 자리가 없고,
//! 파일은 System32 에서만 찾는다(PATH·현재 폴더에 같은 이름을 심어 두는 수법이 안 통한다).
//! 명령 프롬프트·PowerShell·레지스트리 편집기는 일부러 넣지 않았다 — 무엇이든 할 수 있는
//! 도구는 원격 실행 표면이 된다.

use hbb_common::message_proto::cr_win_tool::Tool;

/// 도구 하나. 파일 이름은 모두 System32 기준이다.
///   경로 필드는 윈도우 실행 쪽과 시험에서만 읽는다.
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Spec {
    /// 본사 화면에 쓰는 이름.
    pub name: &'static str,
    file: &'static str,
    args: &'static str,
    /// control.exe 로 여는 제어판 항목이면 그 .cpl — 제어판이 없는 항목을 열면 엉뚱한 창이
    ///   뜨므로, 이 파일도 실제로 있어야 연다. 없으면 "".
    cpl: &'static str,
}

pub fn spec(tool: Tool) -> Spec {
    let (name, file, args, cpl) = match tool {
        Tool::DEVICE_MANAGER => ("장치 관리자", "devmgmt.msc", "", ""),
        // 윈11 은 설정 앱의 프린터 화면으로 넘어간다 — 그래도 같은 일을 한다.
        Tool::PRINTERS => ("장치 및 프린터", "control.exe", "printers", ""),
        Tool::SERVICES => ("서비스", "services.msc", "", ""),
        Tool::TASK_MANAGER => ("작업 관리자", "taskmgr.exe", "", ""),
        Tool::NETWORK => ("네트워크 연결", "control.exe", "ncpa.cpl", "ncpa.cpl"),
        Tool::SOUND => ("사운드", "control.exe", "mmsys.cpl", "mmsys.cpl"),
        Tool::DATE_TIME => ("날짜와 시간", "control.exe", "timedate.cpl", "timedate.cpl"),
        Tool::PROGRAMS => ("프로그램 추가/제거", "control.exe", "appwiz.cpl", "appwiz.cpl"),
        Tool::EVENT_VIEWER => ("이벤트 뷰어", "eventvwr.msc", "", ""),
        Tool::SYSTEM_INFO => ("시스템 정보", "msinfo32.exe", "", ""),
    };
    Spec { name, file, args, cpl }
}

/// 도우미 인자(번호) → 도구. 모르는 번호는 None — 도우미는 아무것도 하지 않고 끝난다.
pub fn tool_from_arg(arg: &str) -> Option<Tool> {
    use hbb_common::protobuf::Enum;
    arg.trim().parse::<i32>().ok().and_then(Tool::from_i32)
}

#[cfg(windows)]
mod imp {
    use super::{spec, Spec, Tool};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use winapi::um::combaseapi::{CoInitializeEx, CoUninitialize};
    use winapi::um::objbase::{COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use winapi::um::shellapi::{ShellExecuteExW, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW};
    use winapi::um::sysinfoapi::GetSystemDirectoryW;
    use winapi::um::winuser::SW_SHOWNORMAL;

    /// 같은 도구를 이 안에 다시 누르면 무시한다 — 창이 겹겹이 뜨는 것 방지.
    const DEBOUNCE: Duration = Duration::from_secs(2);

    lazy_static::lazy_static! {
        static ref LAST: Mutex<Option<(i32, Instant)>> = Mutex::new(None);
    }

    /// 왜 못 여는지. 본사 화면에 보여 줄 문장은 `hq_text` 가 만든다.
    #[derive(Debug)]
    pub enum LaunchError {
        /// 그 PC 에 도구 파일이 없다(Embedded 이미지 등).
        Missing,
        /// 2초 안에 같은 요청 — 조용히 무시한다.
        Debounced,
        /// 도우미를 못 띄웠다(활성 세션 없음 등). 원문은 로그로만.
        Spawn(String),
    }

    impl LaunchError {
        /// 본사에 보여 줄 문장. 무시한 경우는 None.
        pub fn hq_text(&self, name: &str) -> Option<String> {
            match self {
                LaunchError::Missing => Some(format!("이 PC 에는 {} 이(가) 없습니다.", name)),
                LaunchError::Debounced => None,
                LaunchError::Spawn(_) => Some(format!(
                    "{} 을(를) 띄우지 못했습니다. 잠시 뒤 다시 눌러 보세요.",
                    name
                )),
            }
        }
    }

    fn system_dir() -> Option<PathBuf> {
        let mut buf = [0u16; 260];
        let n = unsafe { GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
        if n == 0 || n >= buf.len() {
            return None;
        }
        Some(PathBuf::from(String::from_utf16_lossy(&buf[..n])))
    }

    /// 표의 파일(+ 제어판 항목)이 System32 에 실제로 있으면 그 절대경로.
    fn resolve(s: &Spec) -> Option<PathBuf> {
        let dir = system_dir()?;
        let file = dir.join(s.file);
        if !file.is_file() {
            return None;
        }
        if !s.cpl.is_empty() && !dir.join(s.cpl).is_file() {
            return None;
        }
        Some(file)
    }

    /// `--server` 쪽 — 확인하고 도우미를 띄운 뒤 바로 돌아온다(도구 창을 기다리지 않는다).
    pub fn request(tool: Tool) -> Result<(), LaunchError> {
        let s = spec(tool);
        if resolve(&s).is_none() {
            return Err(LaunchError::Missing);
        }
        {
            let mut last = LAST.lock().unwrap();
            let now = Instant::now();
            if let Some((t, at)) = *last {
                if t == tool as i32 && now.duration_since(at) < DEBOUNCE {
                    return Err(LaunchError::Debounced);
                }
            }
            *last = Some((tool as i32, now));
        }
        let sid = crate::platform::windows::get_current_session_id(false);
        if sid == u32::MAX {
            return Err(LaunchError::Spawn("no active console session".to_owned()));
        }
        let exe = std::env::current_exe()
            .map_err(|e| LaunchError::Spawn(e.to_string()))?
            .to_string_lossy()
            .to_string();
        let n = (tool as i32).to_string();
        crate::platform::windows::run_exe_in_session(&exe, vec!["--cr-wintool", &n], sid, false)
            .map(|_| ())
            .map_err(|e| LaunchError::Spawn(e.to_string()))
    }

    fn wide(s: &OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    /// 도우미 본체(사용자 세션, 사용자 권한). ShellExecuteEx 가 돌아오면 바로 끝난다.
    pub fn helper_main(arg: &str) {
        let Some(tool) = super::tool_from_arg(arg) else {
            log::warn!("[cr_wintool] 모르는 번호: {:?}", arg);
            return;
        };
        let s = spec(tool);
        let Some(file) = resolve(&s) else {
            log::warn!("[cr_wintool] {} 없음", s.name);
            return;
        };
        // 우리 exe 는 RunAsInvoker 로 띄워진다(run_exe_in_session). 이 변수가 자식에게 새면
        //   도구가 "보기 전용"으로 뜨고 UAC 도 안 나온다 — 사장님이 더블클릭한 것과 같게 비운다.
        std::env::remove_var("__COMPAT_LAYER");
        let file_w = wide(file.as_os_str());
        let args_w = wide(OsStr::new(s.args));
        unsafe {
            // 셸 확장을 거칠 수 있어 STA 로 연다(MS 권고). 실패해도 시도는 해 본다.
            let co = CoInitializeEx(
                std::ptr::null_mut(),
                COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE,
            );
            let mut info: SHELLEXECUTEINFOW = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
            info.fMask = SEE_MASK_NOASYNC;
            info.lpFile = file_w.as_ptr();
            if !s.args.is_empty() {
                info.lpParameters = args_w.as_ptr();
            }
            info.nShow = SW_SHOWNORMAL;
            if ShellExecuteExW(&mut info) == 0 {
                // UAC 에서 [아니요]도 여기로 온다(ERROR_CANCELLED) — 화면에 이미 보였으니 기록만.
                log::warn!(
                    "[cr_wintool] {} 실행 안 됨: {}",
                    s.name,
                    std::io::Error::last_os_error()
                );
            } else {
                log::info!("[cr_wintool] {} 열림", s.name);
            }
            if co >= 0 {
                CoUninitialize();
            }
        }
    }
}

#[cfg(windows)]
pub use imp::{helper_main, request, LaunchError};

#[cfg(test)]
mod tests {
    use super::*;
    use hbb_common::protobuf::Enum;

    #[test]
    fn every_tool_has_a_fixed_system32_file() {
        for t in Tool::VALUES {
            let s = spec(*t);
            assert!(!s.name.is_empty());
            // 경로 구분자가 들어가면 System32 밖을 가리킬 수 있다 — 표는 파일 이름만.
            assert!(!s.file.contains('\\') && !s.file.contains('/'));
            if !s.cpl.is_empty() {
                assert_eq!(s.file, "control.exe");
                assert_eq!(s.args, s.cpl);
            }
        }
    }

    #[test]
    fn helper_arg_accepts_only_known_numbers() {
        assert_eq!(tool_from_arg("0"), Some(Tool::DEVICE_MANAGER));
        assert_eq!(tool_from_arg(" 9 "), Some(Tool::SYSTEM_INFO));
        assert_eq!(tool_from_arg("10"), None);
        assert_eq!(tool_from_arg("-1"), None);
        assert_eq!(tool_from_arg("cmd.exe"), None);
        assert_eq!(tool_from_arg(""), None);
    }
}
