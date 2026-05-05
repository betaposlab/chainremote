//! ChainRemote 자체 업데이트 모듈 — NAS(latest.json) 폴링 → setup.exe 다운로드 → 부팅 시 무방해 적용
//!
//! 설계 (CLAUDE.md "옵션 B" 결정사항):
//!   - 호스팅: Chang 댁 NAS Web Station (`https://sepani.synology.me/chainremote/`)
//!   - 트리거: 자동 24h 주기 + (B-2 단계에서 push.json 폴링 추가 예정)
//!   - 적용 시점: 다운로드 완료 후 즉시 (서비스가 LocalSystem 권한으로 setup.exe 사일런트 실행)
//!     → Inno Setup 의 CloseApplications=yes 가 ChainRemote.exe 자동 종료/재시작 처리
//!     → install_me() 가 서비스 stop/start 처리
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
use std::{path::PathBuf, time::Duration};

const LATEST_JSON_URL: &str = "https://sepani.synology.me/chainremote/latest.json";
const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60 * 24); // 24h
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60 * 5); // 부팅 후 5분 — 네트워크 안정 대기
const RETRY_INTERVAL: Duration = Duration::from_secs(60 * 30); // 실패 시 30분 후 재시도
const SESSION_BUSY_INTERVAL: Duration = Duration::from_secs(60 * 15); // 세션 중일 때 15분 후 재시도
const PENDING_DIR: &str = r"C:\ProgramData\ChainRemote\pending";
const PENDING_FILE: &str = "ChainRemote_Setup.exe";
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 10); // 인스톨러 ~30MB

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

/// 서비스(LocalSystem)에서 호출. 부팅 시 1회 + 24h 주기로 백그라운드 체크.
/// `run_service()` 의 진입부에서 한 번만 호출.
pub fn start_in_service() {
    std::thread::spawn(|| {
        log::info!("chainremote_updater: thread started, first check in {:?}", FIRST_CHECK_DELAY);
        std::thread::sleep(FIRST_CHECK_DELAY);
        let mut interval = CHECK_INTERVAL;
        loop {
            match check_and_apply_once() {
                Ok(CycleResult::Applied) => {
                    log::info!("chainremote_updater: setup.exe launched, exiting loop (service will be replaced)");
                    return;
                }
                Ok(CycleResult::AlreadyLatest) => {
                    interval = CHECK_INTERVAL;
                }
                Ok(CycleResult::Deferred) => {
                    interval = SESSION_BUSY_INTERVAL;
                }
                Err(e) => {
                    log::warn!("chainremote_updater: check failed ({}), retry in {:?}", e, RETRY_INTERVAL);
                    interval = RETRY_INTERVAL;
                }
            }
            std::thread::sleep(interval);
        }
    });
}

enum CycleResult {
    Applied,
    AlreadyLatest,
    Deferred,
}

/// 한 사이클: latest.json 가져오기 → 버전 비교 → 다운 → SHA256 검증 → setup.exe 사일런트 실행.
fn check_and_apply_once() -> ResultType<CycleResult> {
    let latest = fetch_latest()?;
    log::info!("chainremote_updater: latest.json → version={}, url={}", latest.version, latest.url);

    let current = parse_version(crate::CHAINREMOTE_VERSION)?;
    let new_v = parse_version(&latest.version)?;
    if !is_newer(new_v, current) {
        log::debug!("chainremote_updater: already on latest ({} >= {})", crate::CHAINREMOTE_VERSION, latest.version);
        return Ok(CycleResult::AlreadyLatest);
    }

    let pending_path = pending_file_path();
    ensure_pending_dir(&pending_path)?;
    // 이전 사이클에서 이미 받아둔 파일이 그대로면 재다운 스킵 (세션 중이라 보류된 상황 등)
    if !(pending_path.exists() && verify_sha256(&pending_path, &latest.sha256).is_ok()) {
        log::info!("chainremote_updater: new version {} > {}, downloading...", latest.version, crate::CHAINREMOTE_VERSION);
        download_to(&latest.url, &pending_path)?;
        verify_sha256(&pending_path, &latest.sha256)?;
        log::info!("chainremote_updater: download verified");
    } else {
        log::info!("chainremote_updater: pending file already valid, reusing");
    }

    // 진행 중인 원격 세션 중에는 적용 보류 — pending 파일은 그대로 두고 SESSION_BUSY_INTERVAL 후 재시도
    if !crate::Connection::alive_conns().is_empty() {
        log::info!("chainremote_updater: active sessions present, deferring install");
        return Ok(CycleResult::Deferred);
    }

    log::info!("chainremote_updater: launching silent install");
    spawn_silent_install(&pending_path)?;
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

/// LocalSystem 권한으로 setup.exe 사일런트 실행. UAC 없음.
/// `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` — UI 0, 메시지박스 0, 자동재부팅 X
/// Inno Setup 의 `CloseApplications=yes` 가 기존 ChainRemote.exe 종료 처리.
/// 인스톨러의 `[Run] sc stop` 이 서비스(우리) 정지 → 새 파일 복사 → `sc start` 재시작.
fn spawn_silent_install(setup_path: &PathBuf) -> ResultType<()> {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;

    // 5초 지연 후 실행 — 우리(서비스) 가 SCM 에 다음 cycle sleep 진입할 시간 확보
    let setup_str = setup_path.to_string_lossy().to_string();
    let cmd = format!(
        "ping 127.0.0.1 -n 6 >nul & \"{}\" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART",
        setup_str
    );
    std::process::Command::new("cmd.exe")
        .args(&["/c", &cmd])
        .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
        .spawn()?;
    Ok(())
}
