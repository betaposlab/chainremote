//! VAN 카드결제 데몬 관제 (패널 마이그 036) — 해당 VAN 을 쓰는 거래처에서만 켠다.
//!
//! 배경: POS 의 카드 결제는 VAN 사가 준 데몬이 떠 있어야 성립한다. KSNET 은 KSCAT.exe 가
//! 그 역할로, 27015 를 열고 POS 의 승인 요청을 받는다. 이게 멈추면 그 순간부터 카드가 안
//! 긁히는데 화면엔 아무 표시도 없어, 손님이 카드를 내밀고 나서야 발견된다.
//!
//! 실측된 고장은 둘이다(2026-08-10 테스트1):
//!   A) 프로세스가 죽는다 — 트레이 아이콘만 껍데기로 남아 마우스를 대면 사라진다.
//!   B) 프로세스는 살아 있는데 데몬만 멈춘다 — 창을 열어 [서비스 시작]을 눌러야 산다.
//! B 가 까다롭다. 프로세스가 멀쩡해 tasklist 로는 안 잡히고, 창 제목·스레드 수·핸들 수·
//! COM 점유까지 전부 그대로였다. 두 상태에서 유일하게 달랐던 것이 27015 LISTEN 이라,
//! 판정 기준은 "포트를 듣고 있는가" 하나로 잡았다.
//!
//! 복구는 한 동작으로 덮인다 — KSCAT 은 실행되면 데몬을 스스로 시작하므로(같은 실측),
//! A 는 그냥 실행, B 는 죽이고 실행이면 된다. KSNET 이 배포하는 워치독도 A 는 잡지만
//! 닫히지 않는 창이 떠서 POS 화면에 둘 수 없다.
//!
//! 안전장치 둘:
//!   - 포트에 연결이 붙어 있으면(승인 진행 중) 손대지 않는다.
//!   - 리더기 COM 이 어긋난 것 같은 고장은 재실행으로 안 고쳐진다. 무한 재시작은 POS 를
//!     괴롭히기만 하므로 연속 실패가 쌓이면 손을 떼고 패널에 알린다(사람이 갈 일).
//!
//! 감시는 관제를 켠 거래처에서만 돈다. 나머지는 스레드가 잠만 잔다.

#![cfg(target_os = "windows")]

use hbb_common::log;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// VAN 별 데몬 정의. kind 는 패널이 내려보내는 값과 글자까지 같아야 한다.
struct Daemon {
    kind: &'static str,
    process: &'static str,
    /// 데몬이 살아 있으면 LISTEN 하는 포트 — 이 관제의 유일한 판정 근거.
    port: u16,
    /// 경로 캐시가 비었을 때 뒤져볼 설치 위치. 프로세스가 한 번이라도 떠 있었으면 캐시가
    /// 채워지므로 여기까지 오는 건 "설치 후 한 번도 안 뜬 기기" 정도다.
    fallbacks: &'static [&'static str],
}

const DAEMONS: &[Daemon] = &[Daemon {
    kind: "ksnet",
    process: "KSCAT.exe",
    port: 27015,
    fallbacks: &[
        "C:\\KSCAT\\KSCAT.exe",
        "C:\\Program Files\\KSCAT\\KSCAT.exe",
        "C:\\Program Files (x86)\\KSCAT\\KSCAT.exe",
        "C:\\KSNET\\KSCAT.exe",
        "D:\\KSCAT\\KSCAT.exe",
    ],
}];

/// 관제 대상 VAN(빈 값이면 off). heartbeat 응답이 매번 갱신한다.
static KIND: Mutex<String> = Mutex::new(String::new());
/// 마지막 heartbeat 보고 이후 데몬을 되살렸나(보고 후 서버가 카운트++).
static RESTARTED_PENDING: AtomicBool = AtomicBool::new(false);
/// 마지막 점검에서 데몬이 정상이었나(표시용). 관제 off 면 의미 없다.
static LAST_OK: AtomicBool = AtomicBool::new(false);
/// 복구를 포기한 상태 — 재실행으로 안 낫는 고장이라는 뜻. 패널이 이걸 사람에게 알린다.
static GAVE_UP: AtomicBool = AtomicBool::new(false);
/// 연속 복구 실패 횟수. 정상으로 돌아오면 0.
static FAILURES: AtomicU32 = AtomicU32::new(0);
/// 이 시각까지는 복구를 시도하지 않는다(포기 후 휴지, 재실행 직후 유예).
static QUIET_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

/// 점검 주기. 카드 결제는 손님이 카드를 내미는 순간에만 필요하니 초 단위 반응이 필요 없고,
/// 30초면 "결제 한 건 실패하고 다시 긁으면 된다" 수준으로 수습된다. netstat 한 번이 전부라
/// 저사양 POS 도 부담이 없다.
const WATCH_INTERVAL: Duration = Duration::from_secs(30);
/// 재실행 후 데몬이 포트를 열 때까지 주는 시간. 이 안에 다시 판정하면 멀쩡한 걸 또 죽인다.
const START_GRACE: Duration = Duration::from_secs(60);
/// 이만큼 연속 실패하면 손을 뗀다. 재실행으로 안 낫는 원인(리더기 COM 불일치 등)이다.
const MAX_FAILURES: u32 = 3;
/// 포기 후 다시 시도해 볼 때까지의 간격. 사람이 리더기를 꽂으면 이 주기에 저절로 복구된다.
const GIVE_UP_QUIET: Duration = Duration::from_secs(30 * 60);

/// 관제 종류 로컬 캐시 — 재부팅 직후 heartbeat 를 기다리지 않고 바로 무장한다.
const KIND_CACHE_KEY: &str = "chainremote-van-kind";
/// 데몬 exe 경로 캐시 — 프로세스가 죽은 뒤엔 경로를 물어볼 데가 없어 살아 있을 때 적어 둔다.
const PATH_CACHE_KEY: &str = "chainremote-van-path";

/// heartbeat 응답의 vanWatch 를 반영. 값이 바뀔 때만 디스크에 쓴다.
pub fn set_kind(kind: &str) {
    let kind = kind.trim();
    if let Ok(mut k) = KIND.lock() {
        if *k != kind {
            log::info!("[chainremote_van] control -> {}", if kind.is_empty() { "off" } else { kind });
            *k = kind.to_string();
        }
    }
    if hbb_common::config::LocalConfig::get_option(KIND_CACHE_KEY) != kind {
        hbb_common::config::LocalConfig::set_option(KIND_CACHE_KEY.to_string(), kind.to_string());
    }
}

/// 마지막 점검 결과(정상 여부). 관제 off 면 None — 서버가 표시하지 않는다.
pub fn current_ok() -> Option<bool> {
    let on = KIND.lock().map(|k| !k.is_empty()).unwrap_or(false);
    on.then(|| LAST_OK.load(Ordering::Relaxed))
}

/// 복구를 포기한 상태인가(패널 경고용).
pub fn gave_up() -> bool {
    GAVE_UP.load(Ordering::Relaxed)
}

/// 지난 보고 후 되살린 적이 있나(전송 성공 후 clear_restarted 로 지운다).
pub fn peek_restarted() -> bool {
    RESTARTED_PENDING.load(Ordering::Relaxed)
}

/// 재시작 보고가 서버에 닿은 뒤 플래그를 지운다(전송 실패면 남겨 다음 heartbeat 에 재보고).
pub fn clear_restarted() {
    RESTARTED_PENDING.store(false, Ordering::Relaxed);
}

/// 감시 스레드 시작 — heartbeat 루프와 함께 서비스 진입점에서 1회 호출.
pub fn start_watch() {
    // 부팅 즉시 무장. POS 는 아침에 켜자마자 결제를 받으므로 heartbeat(최대 ~2분)를 기다리면
    // 하필 그 시간대에 구멍이 생긴다.
    let cached = hbb_common::config::LocalConfig::get_option(KIND_CACHE_KEY);
    if !cached.is_empty() {
        if let Ok(mut k) = KIND.lock() {
            *k = cached;
        }
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(WATCH_INTERVAL);
        if let Some(d) = current_daemon() {
            tick(d);
        }
    });
}

/// 지금 관제 중인 데몬. 관제 off 이거나 모르는 kind 면 None.
fn current_daemon() -> Option<&'static Daemon> {
    let kind = KIND.lock().ok()?.clone();
    if kind.is_empty() {
        return None;
    }
    DAEMONS.iter().find(|d| d.kind == kind)
}

fn tick(d: &'static Daemon) {
    let state = probe_port(d.port);

    // 포트를 듣고 있으면 정상. 프로세스가 살아 있다는 뜻이기도 하니 경로 캐시도 여기서 채운다.
    if state.listening {
        if !LAST_OK.swap(true, Ordering::Relaxed) {
            log::info!("[chainremote_van] {} daemon healthy (port {})", d.kind, d.port);
        }
        FAILURES.store(0, Ordering::Relaxed);
        GAVE_UP.store(false, Ordering::Relaxed);
        cache_path_if_missing(d);
        return;
    }

    LAST_OK.store(false, Ordering::Relaxed);

    // 승인이 오가는 중이면 절대 건드리지 않는다. LISTEN 없이 연결만 남는 건 흔치 않지만,
    // 카드가 긁히는 중에 프로세스를 죽이는 사고보다는 한 주기 늦게 고치는 편이 낫다.
    if state.established > 0 {
        log::info!("[chainremote_van] port {} busy ({} conn) — deferring", d.port, state.established);
        return;
    }

    // 포기 후 휴지 중이거나 방금 재실행했으면 기다린다.
    if in_quiet_period() {
        return;
    }

    recover(d);
}

/// 재실행 시도. 프로세스가 남아 있으면(데몬만 멈춘 B 상태) 먼저 정리하고 띄운다.
fn recover(d: &'static Daemon) {
    if let Some(pid) = find_pid(d.process) {
        log::info!("[chainremote_van] {} alive (pid {}) but port {} closed → restarting", d.process, pid, d.port);
        if !kill(pid) {
            log::warn!("[chainremote_van] taskkill pid {} failed", pid);
        }
        // 종료가 반영될 틈. 이걸 안 주면 방금 죽인 프로세스가 파일 잠금을 쥔 채로 새 인스턴스가 뜬다.
        std::thread::sleep(Duration::from_secs(2));
    } else {
        log::info!("[chainremote_van] {} not running → starting", d.process);
    }

    let Some(path) = daemon_path(d) else {
        log::warn!("[chainremote_van] {} path unknown — cannot start", d.process);
        note_failure();
        return;
    };

    match launch_in_user_session(&path) {
        true => {
            log::info!("[chainremote_van] launched {}", path);
            RESTARTED_PENDING.store(true, Ordering::Relaxed);
            // 데몬이 포트를 열 시간을 준다. 다음 주기에 또 판정하면 뜨는 중인 걸 죽인다.
            set_quiet(START_GRACE);
        }
        false => {
            log::warn!("[chainremote_van] launch failed: {}", path);
            note_failure();
        }
    }
}

/// 복구 실패 누적. 한계를 넘으면 손을 떼고 패널에 알린다 — 재실행으로 안 낫는 고장이다.
fn note_failure() {
    let n = FAILURES.fetch_add(1, Ordering::Relaxed) + 1;
    if n >= MAX_FAILURES {
        if !GAVE_UP.swap(true, Ordering::Relaxed) {
            log::warn!("[chainremote_van] giving up after {} attempts — needs a human (reader/COM?)", n);
        }
        FAILURES.store(0, Ordering::Relaxed);
        set_quiet(GIVE_UP_QUIET);
    }
}

fn in_quiet_period() -> bool {
    match QUIET_UNTIL.lock() {
        Ok(g) => g.map(|t| Instant::now() < t).unwrap_or(false),
        Err(_) => false,
    }
}

fn set_quiet(dur: Duration) {
    if let Ok(mut g) = QUIET_UNTIL.lock() {
        *g = Some(Instant::now() + dur);
    }
}

struct PortState {
    listening: bool,
    established: usize,
}

/// netstat 으로 포트 상태를 읽는다. 소켓을 열지 않는 순수 관찰이라 데몬의 통신을 방해할
/// 여지가 없다(연결을 시도하면 단일 연결만 받는 데몬의 승인을 가로챌 수 있다).
/// 상태 문자열은 한국어 윈도우에서도 영어로 나온다 — Win7 ko 실측 확인.
fn probe_port(port: u16) -> PortState {
    let mut st = PortState { listening: false, established: 0 };
    let Some(out) = run_capture("netstat", &["-an"]) else {
        return st;
    };
    for line in out.lines() {
        let f: Vec<&str> = line.split_whitespace().collect();
        // UDP 줄은 상태 칸이 없다. TCP 4칸(프로토콜/로컬/외부/상태)만 본다.
        if f.len() < 4 || !f[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        // 로컬 주소의 포트. IPv6 은 [::]:27015 라 마지막 ':' 뒤를 본다.
        let Some(p) = f[1].rsplit(':').next().and_then(|s| s.parse::<u16>().ok()) else {
            continue;
        };
        if p != port {
            continue;
        }
        if f[3].eq_ignore_ascii_case("LISTENING") {
            st.listening = true;
        } else if f[3].eq_ignore_ascii_case("ESTABLISHED") {
            st.established += 1;
        }
    }
    st
}

/// 프로세스 이름으로 PID. 없으면 None.
fn find_pid(name: &str) -> Option<u32> {
    let out = run_capture("tasklist", &["/FI", &format!("IMAGENAME eq {}", name), "/NH", "/FO", "CSV"])?;
    for line in out.lines() {
        // CSV: "KSCAT.exe","3384","Console","1","20,460 K"
        //   필터에 안 걸리면 "정보: 지정한 조건에 맞는..." 안내문이 나온다. 그 줄은 따옴표
        //   형식이 아니라 아래 이름 대조에서 걸러진다.
        let mut it = line.split("\",\"");
        let Some(img) = it.next().map(|s| s.trim_start_matches('"')) else {
            continue;
        };
        if !img.eq_ignore_ascii_case(name) {
            continue;
        }
        if let Some(pid) = it.next().and_then(|s| s.trim_matches('"').parse::<u32>().ok()) {
            return Some(pid);
        }
    }
    None
}

fn kill(pid: u32) -> bool {
    run_hidden("taskkill", &["/PID", &pid.to_string(), "/F"])
}

/// 데몬 실행 경로. 캐시 → 설치 후보 순. 캐시는 데몬이 살아 있을 때 채워진다.
fn daemon_path(d: &Daemon) -> Option<String> {
    let cached = hbb_common::config::LocalConfig::get_option(PATH_CACHE_KEY);
    if !cached.is_empty() && std::path::Path::new(&cached).exists() {
        return Some(cached);
    }
    for p in d.fallbacks {
        if std::path::Path::new(p).exists() {
            hbb_common::config::LocalConfig::set_option(PATH_CACHE_KEY.to_string(), p.to_string());
            return Some(p.to_string());
        }
    }
    None
}

/// 데몬이 정상일 때 실행 경로를 적어 둔다 — 죽은 뒤엔 물어볼 데가 없다.
/// wmic 은 느려서(1~2초) 캐시가 빈 첫 회에만 부른다.
fn cache_path_if_missing(d: &Daemon) {
    let cached = hbb_common::config::LocalConfig::get_option(PATH_CACHE_KEY);
    if !cached.is_empty() && std::path::Path::new(&cached).exists() {
        return;
    }
    let q = format!("name='{}'", d.process);
    let Some(out) = run_capture("wmic", &["process", "where", &q, "get", "ExecutablePath"]) else {
        return;
    };
    for line in out.lines() {
        let t = line.trim();
        if t.to_ascii_lowercase().ends_with(&d.process.to_ascii_lowercase()) {
            hbb_common::config::LocalConfig::set_option(PATH_CACHE_KEY.to_string(), t.to_string());
            log::info!("[chainremote_van] daemon path cached: {}", t);
            return;
        }
    }
}

/// 사용자 세션에서 실행. 에이전트는 LocalSystem 서비스(세션0)라 그냥 spawn 하면 사용자
/// 화면에 안 뜨고 트레이도 못 만든다. 활성 콘솔 세션을 찾아 그쪽에 띄운다.
fn launch_in_user_session(exe: &str) -> bool {
    let sid = crate::platform::windows::get_current_session_id(false);
    if sid == u32::MAX {
        log::warn!("[chainremote_van] no active console session");
        return false;
    }
    match crate::platform::windows::run_exe_in_session(exe, vec![], sid, false) {
        Ok(_) => true,
        Err(e) => {
            log::warn!("[chainremote_van] run_exe_in_session failed: {}", e);
            false
        }
    }
}

/// 표준출력을 받아오는 외부 명령 실행(창 없음). 실패하면 None.
fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    // 한국어 윈도우 콘솔은 CP949 라 UTF-8 로 못 읽는 글자가 섞인다. 우리가 보는 건 숫자와
    // 영문 상태값뿐이라 손실 변환으로 충분하다.
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn run_hidden(program: &str, args: &[&str]) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(s) => s.success(),
        Err(e) => {
            log::warn!("[chainremote_van] run {} failed: {}", program, e);
            false
        }
    }
}
