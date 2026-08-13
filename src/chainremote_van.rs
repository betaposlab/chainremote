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
//!   - 리더기 케이블이 빠졌거나 COM 이 어긋난 고장은 재실행으로 안 낫는다. 연속 실패가
//!     쌓이면 **완전히 손을 떼고** 패널로 사람을 부른다. 되풀이 재시작은 POS 를 괴롭히는
//!     데다, 하필 A/S 기사가 리더기를 붙잡고 있는 중에 프로세스를 죽여 작업을 방해한다.
//!     사람이 고쳐서 데몬이 살아나면 아래 정상 경로가 저절로 다시 무장시킨다(수동 조작 불필요).
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
/// 이번 부팅에서 데몬이 **한 번이라도** 정상이었나. 복구는 이게 참일 때만 한다.
///
/// ★2026-08-13 Chang: KSCAT 데몬은 **IC 리더기가 켜져 있어야** 뜬다. 그래서 "포트가 닫혀
///   있다"는 고장만이 아니라 **영업 준비 전(리더기 꺼짐)이라는 정상 상태**이기도 하다.
///   그 둘을 포트만으로는 구분할 수 없다 — 실제로 신부산오뎅본점을 우리가 고장으로 보고
///   세 번 죽였는데, 아무도 손대지 않았는데 영업이 시작되자 저절로 정상이 됐다.
///
///   구분은 **시간축**으로 한다. 실측한 고장 둘(프로세스 죽음 / 데몬만 멈춤)은 **돌던 것이
///   멈춘** 상황이고, 리더기 꺼짐은 **처음부터 안 돈** 상태다. 그러니 한 번 정상이던 것이
///   닫혔을 때만 손대면 남의 매장 결제 프로그램을 헛되이 죽이는 일이 사라진다.
static EVER_OK: AtomicBool = AtomicBool::new(false);
/// 위 대기 로그를 매 주기(90초) 찍지 않기 위한 1회 플래그.
static WAITING_LOGGED: AtomicBool = AtomicBool::new(false);
/// 복구를 포기한 상태 — 재실행으로 안 낫는 고장이라는 뜻. 패널이 이걸 사람에게 알린다.
static GAVE_UP: AtomicBool = AtomicBool::new(false);
/// 이 기기에 데몬 자체가 없다 = 다른 VAN 을 쓰는 거래처에 관제를 잘못 켰다는 뜻.
///   같은 '복구 실패'라도 해야 할 일이 정반대다 — 리더기 고장은 사람이 가야 하고, 이쪽은
///   관제만 끄면 끝난다. 구분해서 보고하지 않으면 헛걸음을 부른다.
static NOT_INSTALLED: AtomicBool = AtomicBool::new(false);
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
/// 이만큼 연속 실패하면 손을 뗀다. 재실행으로 안 낫는 원인(리더기 케이블·COM 불일치 등)이다.
const MAX_FAILURES: u32 = 3;

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
            // 관제 대상이 바뀌었다 = 사람이 패널에서 껐다 켰다는 뜻. 포기 상태를 턴다 —
            // 안 그러면 다시 켜도 여전히 손을 놓고 있어 "켰는데 아무것도 안 한다"가 된다.
            // VAN 을 바꿔 켰다면 찾을 프로그램도 달라지므로 '설치 안 됨'도 같이 턴다.
            GAVE_UP.store(false, Ordering::Relaxed);
            EVER_OK.store(false, Ordering::Relaxed);
            WAITING_LOGGED.store(false, Ordering::Relaxed);
            NOT_INSTALLED.store(false, Ordering::Relaxed);
            FAILURES.store(0, Ordering::Relaxed);
        }
    }
    if hbb_common::config::LocalConfig::get_option(KIND_CACHE_KEY) != kind {
        hbb_common::config::LocalConfig::set_option(KIND_CACHE_KEY.to_string(), kind.to_string());
    }
}

/// 마지막 점검 결과(정상 여부). 관제 off 면 None — 서버가 표시하지 않는다.
///
/// ★리더기 대기 상태도 None 을 낸다. 데몬이 안 도는 건 맞지만 **고장이 아니다** —
///   KSCAT 은 IC 리더기가 켜져 있어야 데몬을 띄우므로, 영업 준비 전에는 안 도는 게 정상이다.
///   이걸 false 로 보내면 화면이 빨간 "중지 — 되살리는 중"으로 뜨는데, 우리는 손도 안 대고
///   있고 매장도 멀쩡하다. 매일 아침 영업 전마다 전 매장이 빨개지는 셈이라 경보가 무뎌진다.
///   None 은 서버가 "아직 판정 못 함"으로 받아 회색 '대기'로 그린다 — 서버도 화면도 손댈 것
///   없이 사실에 맞는 표시가 된다(2026-08-13 Chang: "모든 게 정상이면 정상 메시지를 내야 한다").
///
///   판정을 보류하는 조건은 tick 의 게이트와 같다: 프로세스는 있는데 이번 부팅에서 한 번도
///   정상이었던 적이 없을 때. 한 번이라도 돌았다가 멈춘 것이면 진짜 고장이라 false 가 나간다.
pub fn current_ok() -> Option<bool> {
    let on = KIND.lock().map(|k| !k.is_empty()).unwrap_or(false);
    if !on {
        return None;
    }
    if LAST_OK.load(Ordering::Relaxed) {
        return Some(true);
    }
    // 아직 한 번도 안 돌았고 프로그램은 떠 있다 = 리더기를 안 켠 것으로 본다.
    if !EVER_OK.load(Ordering::Relaxed) && !NOT_INSTALLED.load(Ordering::Relaxed) {
        return None;
    }
    Some(false)
}

/// 관제가 켜져 있나 — 판정 보류(리더기 대기)와 관제 off 를 heartbeat 가 구분하려고 쓴다.
pub fn is_on() -> bool {
    KIND.lock().map(|k| !k.is_empty()).unwrap_or(false)
}

/// 복구를 포기한 상태인가(패널 경고용).
pub fn gave_up() -> bool {
    GAVE_UP.load(Ordering::Relaxed)
}

/// 이 기기에 데몬 자체가 없나 — 관제를 잘못 켠 경우. gave_up 과 함께 참이 된다.
pub fn not_installed() -> bool {
    NOT_INSTALLED.load(Ordering::Relaxed)
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
        NOT_INSTALLED.store(false, Ordering::Relaxed);
        EVER_OK.store(true, Ordering::Relaxed);
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

    // 손을 뗀 상태면 복구를 시도하지 않는다. 감시는 계속 돌므로, 사람이 리더기를 고치고
    // 데몬을 켜는 순간 위 정상 경로가 실패 카운트와 포기 상태를 털고 다시 무장한다.
    if GAVE_UP.load(Ordering::Relaxed) {
        return;
    }

    // 방금 재실행했으면 데몬이 뜰 때까지 기다린다.
    if in_quiet_period() {
        return;
    }

    // ★리더기 대기와 진짜 고장은 **프로세스 유무**로 갈린다.
    //
    //   KSCAT 은 IC 리더기가 꺼져 있어도 프로세스로는 떠 있다 — 리더기 스위치가 좌우하는 건
    //   *데몬이 뜨느냐*지 *프로그램이 실행돼 있느냐*가 아니다(2026-08-13 신부산오뎅본점:
    //   리더기가 꺼진 채로 프로세스는 존재했다). 그러니 프로세스가 아예 없으면 리더기와
    //   무관하게 고장이고, 이때는 지체 없이 되살린다 — 부팅 후 자동시작이 실패한 경우가
    //   여기 해당하며, 리더기 대기로 오해해 방치하면 영업이 시작돼도 카드가 안 긁힌다.
    //
    //   프로세스가 **있는데** 포트만 닫혀 있을 때가 애매한 자리다. 그건 리더기를 아직 안 켠
    //   정상 상태일 수도, 데몬만 멈춘 고장일 수도 있다. 둘을 시간축으로 가른다 —
    //   이번 부팅에서 한 번이라도 정상이었다면 "돌던 것이 멈춘" 고장이고, 한 번도 없었다면
    //   아직 안 켠 것이다.
    if find_pid(d.process).is_some() && !EVER_OK.load(Ordering::Relaxed) {
        if !WAITING_LOGGED.swap(true, Ordering::Relaxed) {
            log::info!(
                "[chainremote_van] {} 아직 정상인 적 없음 — 리더기 대기로 보고 손대지 않는다",
                d.kind
            );
        }
        return;
    }

    recover(d);
}

/// 재실행 시도. 프로세스가 남아 있으면(데몬만 멈춘 B 상태) 먼저 정리하고 띄운다.
fn recover(d: &'static Daemon) {
    let pid = find_pid(d.process);
    // ★죽이기 **전에** 경로를 확보한다. 캐시는 데몬이 정상일 때만 채워지므로(tick 의
    //   listening 분기), 우리가 붙은 뒤로 한 번도 정상인 적이 없고 설치 위치가 fallbacks 밖이면
    //   캐시가 영영 빈다. 그 상태에서 종전 코드는 **프로세스를 먼저 죽이고 나서** 경로가
    //   없다고 포기했다 — 남의 매장 카드결제를 죽여 놓고 못 살린다는 뜻이다
    //   (2026-08-13 신부산오뎅본점: 성공 재시작 0회인데 3회 실패로 포기, 프로세스는 존재).
    //   살아 있는 프로세스는 자기 실행 경로를 알고 있으니 그걸 먼저 받아 둔다.
    if pid.is_some() {
        cache_path_if_missing(d);
    }
    let path = daemon_path(d);

    // 프로세스도 없고 설치 경로에도 없다 = 이 기기는 애초에 이 VAN 을 안 쓴다.
    //   되살릴 대상이 없으니 세 번 두드려 볼 이유도 없다. 곧장 '설치 안 됨'으로 알리고
    //   시도를 접는다 — 그래야 화면에서 리더기 고장과 구분되어 헛걸음을 안 한다.
    if pid.is_none() && path.is_none() {
        if !NOT_INSTALLED.swap(true, Ordering::Relaxed) {
            log::warn!(
                "[chainremote_van] {} is not installed here — wrong VAN for this site?",
                d.process
            );
        }
        GAVE_UP.store(true, Ordering::Relaxed);
        return;
    }

    // ★경로를 모르면 **죽이지 않는다**. 못 살릴 걸 알면서 죽이는 건 관제가 아니라 고장이다.
    //   다음 주기에 다시 시도하고(캐시가 채워질 수 있다), 계속 모르면 실패로 세어 사람을 부른다.
    if path.is_none() {
        log::warn!(
            "[chainremote_van] {} path unknown — 죽이지 않고 넘어간다(못 살릴 것을 죽이지 않는다)",
            d.process
        );
        note_failure();
        return;
    }

    if let Some(pid) = pid {
        log::info!("[chainremote_van] {} alive (pid {}) but port {} closed → restarting", d.process, pid, d.port);
        if !kill(pid) {
            log::warn!("[chainremote_van] taskkill pid {} failed", pid);
        }
        // 종료가 반영될 틈. 이걸 안 주면 방금 죽인 프로세스가 파일 잠금을 쥔 채로 새 인스턴스가 뜬다.
        std::thread::sleep(Duration::from_secs(2));
    } else {
        log::info!("[chainremote_van] {} not running → starting", d.process);
    }

    // 위에서 이미 걸렀으므로 여기선 반드시 Some 이다.
    let Some(path) = path else {
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

/// 복구 실패 누적. 한계를 넘으면 **그만 시도한다** — 재실행으로 안 낫는 고장이라 계속
/// 두드려봐야 POS 만 시달린다. 재개는 시간이 아니라 사실로 판단한다: 데몬이 실제로 살아나면
/// tick 의 정상 경로가, 사람이 패널에서 관제를 껐다 켜면 set_kind 가 이 상태를 턴다.
fn note_failure() {
    let n = FAILURES.fetch_add(1, Ordering::Relaxed) + 1;
    if n >= MAX_FAILURES && !GAVE_UP.swap(true, Ordering::Relaxed) {
        log::warn!(
            "[chainremote_van] gave up after {} attempts — stopping until the daemon comes back \
             (reader cable / COM mismatch needs a human)",
            n
        );
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
