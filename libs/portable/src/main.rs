// ChainRemote 포터블(ChainGo) SFX 래퍼.
//
// 동작 흐름:
//   1. `%TEMP%\ChainGo_<랜덤>\` 폴더를 새로 만들고 페이로드(rustdesk.exe + DLL +
//      data + custom.txt)를 전부 거기로 풀어낸다.
//   2. env `CHAINREMOTE_PORTABLE_DIR=<temp 폴더>` 를 inner 프로세스에 박는다.
//      inner 의 `core_main()` 최상단 `chainremote_portable_init()` 가 이 env 를
//      읽어 `APP_DIR = <temp>/config` 세팅 → 모든 config/peers/log 가 USB 가 아닌
//      이 임시 폴더에 쓰임. 호스트 PC %APPDATA% 는 절대 안 건드림.
//   3. inner 종료를 *대기* 한다 (예전 SFX 는 spawn 후 즉시 종료).
//   4. 종료 후 temp 폴더를 재귀 삭제한다. (`TempGuard` Drop 으로 자동.)
//   5. 시작 시 `%TEMP%\ChainGo_*` 중 1시간 이상 된 잔재를 미리 정리 (앞선 비정상
//      종료/AV 잠금/강제 kill 로 안 지워진 것 회수).
//
// 흔적 분석:
//   - %TEMP%\ChainGo_* : Drop + startup scan 으로 정리
//   - %APPDATA%\RustDesk\ : APP_DIR 우회로 *생성 자체 안 함*
//   - 레지스트리 HKCU\Software\RustDesk : SFX 가 깔지 않고, inner 는 사용자가
//     "설치" 를 클릭 안 하면 안 건드림 (UAC 도 안 띄움)
//   - 다운로드된 ChainGo.exe 자체 + 브라우저 히스토리: 사용자가 수동 정리
//
// 의도적으로 std 만 사용 (rand/signal-hook 등 새 의존성 추가 X). 랜덤은 PID+
// SystemTime nanos hash, 시그널 처리는 Drop 가드 + 시작 스캔으로 갈음.

#![windows_subsystem = "windows"]

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use bin_reader::BinaryReader;

pub mod bin_reader;
#[cfg(windows)]
mod ui;

#[cfg(windows)]
const APP_METADATA: &[u8] = include_bytes!("../app_metadata.toml");
#[cfg(not(windows))]
const APP_METADATA: &[u8] = &[];

// ChainGo 의 temp 폴더 prefix. 시작 시 스캔/정리 대상 + Drop 정리 대상.
const TEMP_PREFIX: &str = "ChainGo_";
// 잔재로 간주할 나이(초). 1시간 — 같은 USB 두 번 클릭 등 정상 동시실행 시
// 다른 폴더가 살아있어도 그건 prefix 가 같고 mtime 이 최근이라 안 건드림.
const ORPHAN_AGE_SECS: u64 = 60 * 60;

const APPNAME_RUNTIME_ENV_KEY: &str = "RUSTDESK_APPNAME";
const PORTABLE_DIR_ENV_KEY: &str = "CHAINREMOTE_PORTABLE_DIR";
#[cfg(windows)]
const SET_FOREGROUND_WINDOW_ENV_KEY: &str = "SET_FOREGROUND_WINDOW";

#[allow(dead_code)]
fn metadata_timestamp() -> u64 {
    let Ok(s) = std::str::from_utf8(APP_METADATA) else {
        return 0;
    };
    for line in s.lines() {
        if let Some(v) = line.strip_prefix("timestamp = ") {
            if let Ok(ts) = v.parse::<u64>() {
                return ts;
            }
        }
    }
    0
}

/// `%TEMP%\ChainGo_<랜덤16hex>` 형식의 새 폴더 경로 생성 (생성은 setup() 에서).
fn fresh_temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let pid = std::process::id() as u64;
    // 16 hex = 충돌 가능성 무시 수준. 동시 실행 2회 이상에서도 안전.
    let token = format!("{:08x}{:08x}", nanos.wrapping_mul(2654435761), pid);
    let mut dir = std::env::temp_dir();
    dir.push(format!("{}{}", TEMP_PREFIX, token));
    dir
}

/// 시작 시 호출. `%TEMP%\ChainGo_*` 중 ORPHAN_AGE_SECS 이상 된 폴더 정리.
/// 실패는 무시 — AV 잠금 등은 다음 실행에서 재시도.
fn cleanup_orphans() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_s) = name.to_str() else { continue };
        if !name_s.starts_with(TEMP_PREFIX) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_dir() {
            continue;
        }
        let mtime = meta.modified().unwrap_or(UNIX_EPOCH);
        let age = now
            .duration_since(mtime)
            .unwrap_or(Duration::from_secs(0))
            .as_secs();
        if age >= ORPHAN_AGE_SECS {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// RAII 가드: drop 시 temp 폴더 재귀 삭제. inner 정상/비정상 종료 모두 커버.
/// (SIGKILL / 강제종료로 Drop 자체가 안 돌면 다음 실행 cleanup_orphans 가 청소.)
struct TempGuard {
    dir: PathBuf,
    armed: bool,
}

impl TempGuard {
    fn new(dir: PathBuf) -> Self {
        Self { dir, armed: true }
    }
    #[allow(dead_code)]
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        // 두세 번 재시도(AV/파일잠금 일시적 회피). 그래도 실패하면 cleanup_orphans 가
        // 한 시간 후 정리. 어쨌든 호스트 PC `%APPDATA%` 는 안 건드렸음.
        for _ in 0..3 {
            if std::fs::remove_dir_all(&self.dir).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }
}

/// 페이로드를 temp 폴더로 풀고 inner exe 경로 반환.
fn extract(reader: BinaryReader, dir: &Path) -> Option<PathBuf> {
    if let Err(e) = std::fs::create_dir_all(dir) {
        eprintln!("create temp dir failed: {:?}", e);
        return None;
    }
    for file in reader.files.iter() {
        file.write_to_file(dir);
    }
    #[cfg(windows)]
    win::copy_runtime_broker(dir);
    #[cfg(target_os = "linux")]
    reader.configure_permission(dir);
    Some(dir.join(&reader.exe))
}

fn use_null_stdio() -> bool {
    #[cfg(windows)]
    {
        // Windows 7 의 cmd.exe 호환 이슈 — 옛 SFX 코드 그대로 유지.
        return is_windows_7();
    }
    #[cfg(not(windows))]
    false
}

#[cfg(windows)]
fn is_windows_7() -> bool {
    use windows::Wdk::System::SystemServices::RtlGetVersion;
    use windows::Win32::System::SystemInformation::OSVERSIONINFOW;
    unsafe {
        let mut v = OSVERSIONINFOW::default();
        v.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        if RtlGetVersion(&mut v).is_ok() {
            return v.dwMajorVersion == 6 && v.dwMinorVersion == 1;
        }
    }
    false
}

/// inner exe 를 동기 실행. 정상 종료까지 블록.
fn execute_wait(path: PathBuf, args: Vec<String>, temp_dir: &Path) -> std::io::Result<i32> {
    let exe = std::env::current_exe().unwrap_or_default();
    let exe_name = exe.file_name().unwrap_or_default();

    let mut cmd = Command::new(&path);
    cmd.args(&args);
    cmd.env(APPNAME_RUNTIME_ENV_KEY, exe_name);
    // 핵심: inner 의 chainremote_portable_init() 가 이걸 읽어 APP_DIR 박음.
    cmd.env(PORTABLE_DIR_ENV_KEY, temp_dir);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(winapi::um::winbase::CREATE_NO_WINDOW);
        cmd.env(SET_FOREGROUND_WINDOW_ENV_KEY, "1");
    }

    if use_null_stdio() {
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
    } else {
        cmd.stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
    }

    let mut child = cmd.spawn()?;

    #[cfg(windows)]
    unsafe {
        winapi::um::winuser::AllowSetForegroundWindow(child.id() as u32);
    }

    let status = child.wait()?;
    Ok(status.code().unwrap_or(0))
}

fn main() {
    // 1. 옛 잔재 정리(다른 시간/세션의 ChainGo_*).
    cleanup_orphans();

    // 2. 새 temp 폴더 결정 + 페이로드 추출 + Drop 가드 무장.
    let temp_dir = fresh_temp_dir();
    let _guard = TempGuard::new(temp_dir.clone());

    let reader = BinaryReader::default();
    let Some(inner_exe) = extract(reader, &temp_dir) else {
        eprintln!("extract failed");
        return;
    };

    // 3. CLI args 그대로 전달(우리는 보통 args 없이 더블클릭).
    let args: Vec<String> = std::env::args().skip(1).collect();

    // 4. inner 동기 실행 → 종료 대기 → _guard Drop 으로 temp 정리.
    if let Err(e) = execute_wait(inner_exe, args, &temp_dir) {
        eprintln!("inner exec failed: {:?}", e);
    }
}

#[cfg(windows)]
mod win {
    use std::{fs, os::windows::process::CommandExt, path::Path, process::Command};

    pub const RUNTIME_BROKER_EXE: &'static str = "C:\\Windows\\System32\\RuntimeBroker.exe";
    pub const WIN_TOPMOST_INJECTED_PROCESS_EXE: &'static str = "RuntimeBroker_ChainRemote.exe";

    pub(super) fn copy_runtime_broker(dir: &Path) {
        let src = RUNTIME_BROKER_EXE;
        let tgt = WIN_TOPMOST_INJECTED_PROCESS_EXE;
        let target_file = dir.join(tgt);
        if target_file.exists() {
            if let (Ok(s), Ok(t)) = (fs::read(src), fs::read(&target_file)) {
                let sm = format!("{:x}", md5::compute(&s));
                let tm = format!("{:x}", md5::compute(&t));
                if sm == tm {
                    return;
                }
            }
        }
        let _ = Command::new("taskkill")
            .args(&["/F", "/IM", WIN_TOPMOST_INJECTED_PROCESS_EXE])
            .creation_flags(winapi::um::winbase::CREATE_NO_WINDOW)
            .output();
        let _ = std::fs::copy(src, &format!("{}\\{}", dir.to_string_lossy(), tgt));
    }
}
