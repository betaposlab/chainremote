//! ChainRemote 자체 업데이트 모듈 — NAS(latest.json) 폴링 → setup.exe 다운로드 → 부팅 시 무방해 적용
//!
//! 설계 (CLAUDE.md "옵션 B" 결정사항):
//!   - 호스팅: Chang 댁 NAS Web Station (`https://sepani.synology.me/chainremote/`)
//!   - 트리거 채널 2개:
//!     (a) latest.json — 24h 정기 폴링 (수동 갱신 없이 자연스러운 배포)
//!     (b) push.json   — 5분 폴링, 본사가 timestamp 갱신 시 즉시 적용 사이클 발동
//!   - 적용 시점: 다운로드 완료 후 즉시 (서비스가 LocalSystem 권한으로 setup.exe 사일런트 실행)
//!     → Inno Setup 의 CloseApplications=yes 가 ChainRemote.exe 자동 종료/재시작 처리
//!     → install_me() 가 서비스 stop/start 처리
//!   - 활성 원격 세션 중에는 어느 채널이든 적용 보류 (거래처 작업 보호)
//!
//! 권한:
//!   - 모든 로직이 Windows 서비스(LocalSystem) 컨텍스트에서 실행됨 → UAC 없음
//!   - Pending 파일은 `C:\ProgramData\ChainRemote\pending\` (LocalSystem 이 owner, Users 는 read-only)
//!
//! 기존 RustDesk 업데이트 인프라와의 분리:
//!   - RustDesk 의 `src/updater.rs` 는 GitHub releases 가정 + `OPTION_ALLOW_AUTO_UPDATE` 게이트
//!   - 우리 거래처는 그 옵션을 OFF 로 두므로 기존 채널은 비활성
//!   - 본 모듈은 ChainRemote 포크에만 존재하므로 빌드되면 무조건 동작

#![cfg(target_os = "windows")]

use hbb_common::{bail, log, ResultType};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};

const LATEST_JSON_URL: &str = "https://sepani.synology.me/chainremote/latest.json";
const PUSH_JSON_URL: &str = "https://sepani.synology.me/chainremote/push.json";
const FULL_CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60 * 24); // 24h — latest.json 정기 체크
const PUSH_POLL_INTERVAL: Duration = Duration::from_secs(60 * 5); // 5분 — push.json 즉시 알림 채널
const DEFERRED_RETRY_INTERVAL: Duration = Duration::from_secs(60 * 15); // 15분 — Deferred 후 다시 alive_conns 체크
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60 * 5); // 부팅 후 5분 — 네트워크 안정 대기
const PENDING_DIR: &str = r"C:\ProgramData\ChainRemote\pending";
const PENDING_FILE: &str = "ChainRemote_Setup.exe";
const UPDATER_LOG_PATH: &str = r"C:\ProgramData\ChainRemote\updater.log";
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 10); // 인스톨러 ~30MB

/// updater 전용 로그 파일에 한 줄 append. hbb_common::log 와 별도로 디스크에 영구 보존 — 다음 디버깅 즉시.
/// 실패해도 무시 (디스크 가득 등 예외 상황에서 메인 동작 막지 않음).
fn flog(msg: &str) {
    let _ = std::fs::create_dir_all(r"C:\ProgramData\ChainRemote");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(UPDATER_LOG_PATH)
    {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "{} v{} {}", ts, crate::CHAINREMOTE_VERSION, msg);
    }
    log::info!("chainremote_updater: {}", msg);
}

#[derive(serde::Deserialize, Debug)]
struct LatestRelease {
    version: String,
    url: String,
    sha256: String,
    #[serde(default)]
    #[allow(dead_code)]
    size: u64,
    #[serde(default)]
    #[allow(dead_code)]
    released_at: String,
    #[serde(default)]
    #[allow(dead_code)]
    notes: String,
}

/// 본사가 latest.json 외에 별도로 박는 "지금 즉시 폴링하라" 신호.
/// `timestamp` 가 갱신될 때마다 클라이언트가 새 푸시로 인식. (값 자체는 ISO8601 권장이지만 비교는 동등성 only)
/// 파일이 없거나 비어 있으면 클라이언트는 무시 (24h 정기 채널만 동작).
#[derive(serde::Deserialize, Debug, Default)]
struct PushSignal {
    #[serde(default)]
    version: String,
    #[serde(default)]
    timestamp: String,
    #[serde(default)]
    #[allow(dead_code)]
    notes: String,
}

/// 서비스(LocalSystem)에서 호출. 부팅 후 5분 → 그 다음 5분 주기로 push.json 폴링,
/// 24h 마다 latest.json 정기 체크 (단 Deferred 시 15분 후 재시도). `run_service()` 의 진입부에서 한 번만 호출.
pub fn start_in_service() {
    std::thread::spawn(|| {
        flog(&format!(
            "thread started, first_check_delay={:?}, push_poll={:?}, full_check={:?}, deferred_retry={:?}",
            FIRST_CHECK_DELAY, PUSH_POLL_INTERVAL, FULL_CHECK_INTERVAL, DEFERRED_RETRY_INTERVAL
        ));
        std::thread::sleep(FIRST_CHECK_DELAY);

        // last_full_check: AlreadyLatest / Err 시에만 갱신. Deferred 는 별도 변수로 추적해 짧은 주기로 재시도.
        let mut last_full_check: Option<Instant> = None;
        let mut last_deferred_retry: Option<Instant> = None;
        let mut last_push_timestamp: Option<String> = None;

        loop {
            // (a) 본사 강제 푸시 채널 — 5분마다, timestamp 갱신 시 즉시 적용 사이클
            if let Some(push) = try_fetch_push() {
                if !push.timestamp.is_empty()
                    && !push.version.is_empty()
                    && last_push_timestamp.as_deref() != Some(&push.timestamp)
                {
                    last_push_timestamp = Some(push.timestamp.clone());
                    flog(&format!(
                        "push signal received ts={}, target v{}", push.timestamp, push.version
                    ));
                    match check_and_apply_once() {
                        Ok(CycleResult::Applied) => {
                            flog("push-triggered apply launched, exiting loop");
                            return;
                        }
                        Ok(other) => flog(&format!("push cycle → {:?}", other)),
                        Err(e) => flog(&format!("push cycle failed: {}", e)),
                    }
                }
            }

            // (b) 정기/재시도 채널 — 둘 중 하나라도 만료면 사이클 1회
            let need_full = last_full_check
                .map(|t| t.elapsed() >= FULL_CHECK_INTERVAL)
                .unwrap_or(true);
            let need_deferred_retry = last_deferred_retry
                .map(|t| t.elapsed() >= DEFERRED_RETRY_INTERVAL)
                .unwrap_or(false);
            if need_full || need_deferred_retry {
                match check_and_apply_once() {
                    Ok(CycleResult::Applied) => {
                        flog("scheduled apply launched, exiting loop");
                        return;
                    }
                    Ok(CycleResult::AlreadyLatest) => {
                        flog("scheduled cycle → AlreadyLatest");
                        last_full_check = Some(Instant::now());
                        last_deferred_retry = None;
                    }
                    Ok(CycleResult::Deferred) => {
                        // ★ 결함 1 fix: Deferred 는 last_full_check 를 갱신하지 않음.
                        // 대신 last_deferred_retry 만 갱신 → 15분 후 재시도. alive_conns 풀리면 즉시 적용.
                        flog("scheduled cycle → Deferred (active session, will retry in 15m)");
                        last_deferred_retry = Some(Instant::now());
                    }
                    Err(e) => {
                        flog(&format!("scheduled check failed: {}", e));
                        // 실패 시 어떤 변수도 갱신 안 함 → 다음 5분 사이클에 재시도
                    }
                }
            }

            std::thread::sleep(PUSH_POLL_INTERVAL);
        }
    });
}

#[derive(Debug)]
enum CycleResult {
    Applied,
    AlreadyLatest,
    Deferred,
}

/// push.json 은 본사가 안 박았을 수도 (404 OK). 실패는 조용히 None.
fn try_fetch_push() -> Option<PushSignal> {
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .ok()?;
    let resp = client.get(PUSH_JSON_URL).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<PushSignal>().ok()
}

/// 한 사이클: latest.json 가져오기 → 버전 비교 → 다운 → SHA256 검증 → setup.exe 사일런트 실행.
fn check_and_apply_once() -> ResultType<CycleResult> {
    let latest = fetch_latest()?;
    flog(&format!("latest.json → version={}, url={}", latest.version, latest.url));

    let current = parse_version(crate::CHAINREMOTE_VERSION)?;
    let new_v = parse_version(&latest.version)?;
    if !is_newer(new_v, current) {
        return Ok(CycleResult::AlreadyLatest);
    }

    let pending_path = pending_file_path();
    ensure_pending_dir(&pending_path)?;
    // 이전 사이클에서 이미 받아둔 파일이 그대로면 재다운 스킵 (세션 중이라 보류된 상황 등)
    if !(pending_path.exists() && verify_sha256(&pending_path, &latest.sha256).is_ok()) {
        flog(&format!("new version {} > {}, downloading...", latest.version, crate::CHAINREMOTE_VERSION));
        download_to(&latest.url, &pending_path)?;
        verify_sha256(&pending_path, &latest.sha256)?;
        flog("download verified");
    } else {
        flog("pending file already valid, reusing");
    }

    // 진행 중인 원격 세션 중에는 적용 보류 — pending 파일은 그대로 두고 다음 사이클에서 재시도
    let alive = crate::Connection::alive_conns();
    if !alive.is_empty() {
        flog(&format!("active sessions ({} conn) → deferring install", alive.len()));
        return Ok(CycleResult::Deferred);
    }

    flog("launching silent install");
    spawn_silent_install(&pending_path)?;
    flog("silent install spawned successfully");
    Ok(CycleResult::Applied)
}

fn fetch_latest() -> ResultType<LatestRelease> {
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp = client.get(LATEST_JSON_URL).send()?;
    if !resp.status().is_success() {
        bail!("HTTP {}", resp.status());
    }
    let release: LatestRelease = resp.json()?;
    Ok(release)
}

fn parse_version(s: &str) -> ResultType<(u32, u32, u32)> {
    let parts: Vec<&str> = s.trim().split('.').collect();
    if parts.len() < 3 {
        bail!("malformed version: {}", s);
    }
    let major: u32 = parts[0].parse()?;
    let minor: u32 = parts[1].parse()?;
    // build 부분에 알파/베타 suffix 가 붙는 경우 대비 — 숫자 prefix 만 취함
    let build_str: String = parts[2].chars().take_while(|c| c.is_ascii_digit()).collect();
    let build: u32 = if build_str.is_empty() { 0 } else { build_str.parse()? };
    Ok((major, minor, build))
}

#[inline]
fn is_newer(a: (u32, u32, u32), b: (u32, u32, u32)) -> bool {
    a > b
}

fn pending_file_path() -> PathBuf {
    PathBuf::from(PENDING_DIR).join(PENDING_FILE)
}

fn ensure_pending_dir(file: &PathBuf) -> ResultType<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

fn download_to(url: &str, dest: &PathBuf) -> ResultType<()> {
    use std::io::Write;
    let client = reqwest::blocking::Client::builder()
        .timeout(DOWNLOAD_TIMEOUT)
        .build()?;
    let resp = client.get(url).send()?;
    if !resp.status().is_success() {
        bail!("download HTTP {}", resp.status());
    }
    let bytes = resp.bytes()?;
    let tmp = dest.with_extension("exe.partial");
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    // atomic rename — 부분 파일이 보일 일 없음
    if dest.exists() {
        std::fs::remove_file(dest).ok();
    }
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

fn verify_sha256(path: &PathBuf, expected_hex: &str) -> ResultType<()> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let got = hex::encode(hasher.finalize());
    let expected = expected_hex.trim().to_lowercase();
    if got != expected {
        // 손상된 파일 정리 — 다음 사이클에서 재다운로드 시도
        std::fs::remove_file(path).ok();
        bail!("SHA256 mismatch: expected {}, got {}", expected, got);
    }
    Ok(())
}

/// Windows Task Scheduler 를 통해 setup.exe 를 SYSTEM 권한으로 실행.
///
/// v1.2.5 까지: `cmd.exe /c ping & setup.exe` 를 `CreateProcess` 로 직접 띄움.
/// 문제: 우리 서비스가 LocalSystem 세션 0 에서 spawn 한 Inno Setup 인스톨러가
///   session-aware 한 단계에서 hang/silent fail. setup log 도 안 남기고 죽음.
///   (검증 2026-05-12: manual /SILENT 는 user 세션에서 정상, service spawn 만 실패)
///
/// 픽스: schtasks 로 일회성 작업 등록 + 즉시 실행. OS 가 task host 통해 별도 세션에서 띄움.
/// `/SILENT` 사용 (`/VERYSILENT` 가 일부 환경에서 GUI 초기화 막아 hang 유발).
fn spawn_silent_install(setup_path: &PathBuf) -> ResultType<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let setup_str = setup_path.to_string_lossy().to_string();
    let log_path = std::path::Path::new(&setup_str)
        .parent()
        .map(|p| p.join("installer.log").to_string_lossy().to_string())
        .unwrap_or_else(|| "C:\\ProgramData\\ChainRemote\\pending\\installer.log".to_string());

    // schtasks /TR 의 인용 규칙: 외부 큰 따옴표로 감싸고 내부 큰 따옴표는 \" 로 이스케이프.
    // setup.exe 경로에 공백 가능하므로 인용 필수.
    let tr_arg = format!(
        "\\\"{}\\\" /SILENT /SUPPRESSMSGBOXES /NORESTART /LOG=\\\"{}\\\"",
        setup_str, log_path
    );

    let task_name = "ChainRemoteOneShotUpdate";

    // 1) 기존 잔재 작업 삭제 (있어도 무시)
    let _ = std::process::Command::new("schtasks.exe")
        .args(&["/Delete", "/TN", task_name, "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    // 2) 신규 작업 등록 — SYSTEM, /HIGHEST, ONSTART (즉시 실행 가능, 향후 boot 트리거 안 됨)
    //    /ST 23:59 + ONCE 로 두면 자정 직전에만 동작 — 우리는 /Run 으로 즉시 트리거할 거.
    //    /RL HIGHEST 로 admin 권한 보장.
    let create = std::process::Command::new("schtasks.exe")
        .args(&[
            "/Create",
            "/TN",
            task_name,
            "/TR",
            &tr_arg,
            "/SC",
            "ONCE",
            "/ST",
            "23:59",
            "/RU",
            "SYSTEM",
            "/RL",
            "HIGHEST",
            "/F",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;
    if !create.status.success() {
        bail!(
            "schtasks /Create failed: {}",
            String::from_utf8_lossy(&create.stderr)
        );
    }

    // 3) 즉시 트리거
    let run = std::process::Command::new("schtasks.exe")
        .args(&["/Run", "/TN", task_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()?;
    if !run.status.success() {
        bail!(
            "schtasks /Run failed: {}",
            String::from_utf8_lossy(&run.stderr)
        );
    }

    Ok(())
}
