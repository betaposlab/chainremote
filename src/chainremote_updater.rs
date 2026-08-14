//! HQ 자체 업데이트 — NAS(latest.json) 폴링 → setup.exe 다운로드 → 무방해 적용.
//! CLAUDE.md "옵션 B" 결정. 호스팅은 Chang 댁 NAS Web Station.
//!
//! 트리거 채널 두 개: latest.json 은 24h 정기 폴링(수동 갱신 없이 자연스러운 배포), push.json 은
//! 5분 폴링으로 본사가 timestamp 를 갱신하면 즉시 적용 사이클을 발동한다. 다운로드 끝나면 바로
//! 적용 — 서비스가 LocalSystem 권한으로 setup.exe 를 사일런트 실행하고, Inno 의
//! CloseApplications=yes 가 ChainRemote.exe 종료/재시작을, install_me() 가 서비스 stop/start 를
//! 처리한다. 활성 원격 세션 중엔 어느 채널이든 적용을 보류한다(거래처 작업 보호).
//!
//! 전부 Windows 서비스(LocalSystem)에서 도니 UAC 없음. pending 파일은
//! C:\ProgramData\ChainRemote\pending\ (LocalSystem owner, Users read-only).
//!
//! RustDesk 기본 업데이트(src/updater.rs)는 GitHub releases 가정 + OPTION_ALLOW_AUTO_UPDATE
//! 게이트인데 우리는 그 옵션을 OFF 로 두니 안 돈다. 이 모듈은 포크에만 있어 빌드되면 무조건 동작.

#![cfg(target_os = "windows")]

use crate::chainremote_update_common::{is_newer, parse_version, verify_sha256};
use hbb_common::{bail, log, ResultType};
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

/// 로그 파일 머리에 한 번만 새기는 서명. 이스터에그 중 가장 조용한 것 — 화면에 안 나오고
/// 이 파일을 직접 열어 본 사람만 본다.
const LOG_SIGNATURE: &str = concat!(
    "   ______ __         _        ____                       __\r\n",
    "  / ____// /_  ____ _(_)___   / __ \\___  ____ ___  ____  / /____\r\n",
    " / /    / __ \\/ __ `/ / __ \\ / /_/ / _ \\/ __ `__ \\/ __ \\/ __/ _ \\\r\n",
    "/ /___ / / / / /_/ / / / / // _, _/  __/ / / / / / /_/ / /_/  __/\r\n",
    "\\____//_/ /_/\\__,_/_/_/ /_//_/ |_|\\___/_/ /_/ /_/\\____/\\__/\\___/\r\n",
    "\r\n",
    "        made with care  ·  betaposlab\r\n",
    "        이 로그를 열어 본 당신, 오늘도 고생 많으십니다.\r\n",
    "\r\n"
);
// 수동 "지금 설치" 트리거 파일. 비권한 UI(트레이)가 이 파일을 만들면 SYSTEM 서비스가
// ≤TICK_INTERVAL 안에 감지해 즉시 적용(다운로드+권한설치)한다. UI 는 winlogon 토큰이 없어
// 직접 설치를 못 하니 서비스에 신호만 던지는 것. ProgramData\ChainRemote ACL 은 Users 파일생성
// 허용(검증됨)이라 UI 가 쓰고 SYSTEM 이 읽고 지운다.
const MANUAL_TRIGGER_FLAG: &str = r"C:\ProgramData\ChainRemote\update_now.flag";
// 짧은 tick 으로 수동 트리거를 ≤2초 안에 잡는다. push(5분)/full(24h)은 elapsed 게이트라
// NAS 를 매 tick 두들기지 않고, 매 tick 비용은 사실상 파일 존재 확인 한 번이라 무시할 만하다.
const TICK_INTERVAL: Duration = Duration::from_secs(2);
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 10); // 인스톨러 ~30MB

/// updater 전용 로그 파일에 한 줄 append. hbb_common::log 와 별개로 디스크에 남겨 다음 디버깅에
/// 바로 쓴다. 실패는 무시(디스크 가득 같은 상황에서 메인 동작을 막지 않게).
fn flog(msg: &str) {
    let _ = std::fs::create_dir_all(r"C:\ProgramData\ChainRemote");
    // 로그 파일이 처음 생길 때만 서명을 새긴다. 화면엔 절대 안 나오고, 몇 년 뒤 누군가
    // 이 로그를 열었을 때만 보이는 조용한 인사다. append 전에 존재를 보고 판단한다 —
    // 파일이 커져 잘려도 다시 새기지는 않는다(잘림은 우리가 아니라 사람이 하는 일).
    let fresh = !std::path::Path::new(UPDATER_LOG_PATH).exists();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(UPDATER_LOG_PATH)
    {
        if fresh {
            let _ = write!(f, "{}", LOG_SIGNATURE);
        }
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "{} v{} {}", ts, crate::CHAINREMOTE_VERSION, msg);
    }
    log::info!("chainremote_updater: {}", msg);
}

#[derive(serde::Deserialize, Debug, Clone)]
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

/// 2026-05-28 dual-channel 개편 — HQ 와 Agent 를 각자 인스톨러로 업데이트되게 나눴다.
/// 단일 채널이던 옛 schema 에서 HQ 가 Agent 인스톨러로 덮어써진 사고(2026-05-28 오전) 재발 방지.
/// 새 schema 는 { "hq": {...}, "agent": {...} } 로 채널을 분리한다.
#[derive(serde::Deserialize, Debug)]
struct DualChannelManifest {
    hq: LatestRelease,
    agent: LatestRelease,
}

/// 본사가 latest.json 과 별개로 박는 "지금 폴링하라" 신호. timestamp 가 바뀔 때마다 클라이언트가
/// 새 푸시로 본다(값은 ISO8601 권장이지만 비교는 동등성만). 파일이 없거나 비면 무시하고 24h
/// 정기 채널만 돈다.
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

/// 서비스(LocalSystem)에서 호출, run_service() 진입부에서 한 번만. 부팅 후 5분 뒤부터 push.json
/// 을 5분 주기로 폴링하고 latest.json 을 24h 마다 정기 체크한다(Deferred 면 15분 후 재시도).
///
/// 2026-05-29 변경 — Agent(incoming-only) 빌드는 이 채널을 안 쓰고 chainremote_push_agent 가
/// 패널 API(/api/customers/pending-update) 폴링으로 본사 수동 푸시만 받는다. 2026-05-28 중앙리
/// 사고(영업시간 12:50PM 자동 인스톨러 마법사)를 영구 차단하려는 것 — 새벽 0~7시 영업시간
/// 가드를 박은 푸시만 받게 한다.
pub fn start_in_service() {
    if hbb_common::config::is_incoming_only() {
        flog("agent build → skip latest.json updater (push API handles updates)");
        return;
    }
    std::thread::spawn(|| {
        flog(&format!(
            "thread started, first_check_delay={:?}, push_poll={:?}, full_check={:?}, deferred_retry={:?}",
            FIRST_CHECK_DELAY, PUSH_POLL_INTERVAL, FULL_CHECK_INTERVAL, DEFERRED_RETRY_INTERVAL
        ));
        std::thread::sleep(FIRST_CHECK_DELAY);

        // last_full_check 는 AlreadyLatest/Err 때만 갱신. Deferred 는 짧은 주기 재시도하려고 별도 추적.
        let mut last_full_check: Option<Instant> = None;
        let mut last_deferred_retry: Option<Instant> = None;
        let mut last_push_timestamp: Option<String> = None;
        // push.json 폴링은 5분 게이트(루프는 짧은 tick 이라 NAS 를 매 tick 두들기지 않게).
        let mut last_push_poll: Option<Instant> = None;

        loop {
            // 수동 "지금 설치" — 최우선, 즉시 적용. 비권한 UI 가 만든 플래그를 SYSTEM 이 감지·삭제한
            //     뒤 check_and_apply_once(다운로드+검증+launch_privileged_process 로 Inno 사일런트 실행).
            if std::path::Path::new(MANUAL_TRIGGER_FLAG).exists() {
                let _ = std::fs::remove_file(MANUAL_TRIGGER_FLAG);
                flog("manual trigger detected -> applying now");
                match check_and_apply_once() {
                    Ok(CycleResult::Applied) => {
                        flog("manual apply launched, exiting loop");
                        return;
                    }
                    Ok(CycleResult::AlreadyLatest) => {
                        flog("manual trigger -> already latest");
                        last_full_check = Some(Instant::now());
                    }
                    Ok(CycleResult::Deferred) => {
                        flog("manual trigger -> deferred (active session); will retry");
                        last_deferred_retry = Some(Instant::now());
                    }
                    Err(e) => flog(&format!("manual trigger cycle failed: {}", e)),
                }
            }

            // 본사 강제 푸시 채널 — 5분 게이트. timestamp 갱신 시 즉시 적용 사이클.
            let need_push_poll = last_push_poll
                .map(|t| t.elapsed() >= PUSH_POLL_INTERVAL)
                .unwrap_or(true);
            if need_push_poll {
                last_push_poll = Some(Instant::now());
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
            }

            // 정기/재시도 채널 — 둘 중 하나라도 만료면 사이클 1회.
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
                        // Deferred 는 last_full_check 를 갱신하지 않고 last_deferred_retry 만 갱신해
                        // 15분 후 재시도한다. alive_conns 가 풀리면 즉시 적용된다.
                        flog("scheduled cycle → Deferred (active session, will retry in 15m)");
                        last_deferred_retry = Some(Instant::now());
                    }
                    Err(e) => {
                        flog(&format!("scheduled check failed: {}", e));
                        // sha-mismatch 등으로 실패했을 때 first-boot(last_full_check=None)면 매 tick(2초)
                        //   마다 25MB 를 재다운로드하는 해머가 된다. last_full_check 를 갱신해 그 해머를
                        //   끊고 last_deferred_retry 로 15분 후 재시도 — 그때 per-cycle fetch_latest 가
                        //   정정된 latest.json sha 를 집어 자가복구한다. NAS 대역폭 보호 + 무증상 방지(flog).
                        last_full_check = Some(Instant::now());
                        last_deferred_retry = Some(Instant::now());
                    }
                }
            }

            // 짧은 tick 으로 수동 트리거 플래그를 빨리 감지. push/full 폴링은 위 elapsed 게이트가 조인다.
            std::thread::sleep(TICK_INTERVAL);
        }
    });
}

#[derive(Debug)]
enum CycleResult {
    Applied,
    AlreadyLatest,
    Deferred,
}

/// push.json 은 본사가 안 박았을 수 있다(404 정상). 실패는 조용히 None.
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

/// 한 사이클: latest.json → 버전 비교 → 다운 → SHA256 검증 → setup.exe 사일런트 실행.
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
    // 지난 사이클에 받아둔 파일이 아직 유효하면 재다운 스킵(세션 중이라 보류됐던 경우 등).
    if !(pending_path.exists() && verify_sha256(&pending_path, &latest.sha256).is_ok()) {
        flog(&format!("new version {} > {}, downloading...", latest.version, crate::CHAINREMOTE_VERSION));
        download_to(&latest.url, &pending_path)?;
        verify_sha256(&pending_path, &latest.sha256)?;
        flog("download verified");
    } else {
        flog("pending file already valid, reusing");
    }

    // 원격 세션이 진행 중이면 적용 보류 — pending 파일은 두고 다음 사이클에 재시도.
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
    let body = resp.text()?;

    // 2026-05-28 dual-channel: 새 schema { hq:{...}, agent:{...} } 를 먼저 시도하고
    // 실패하면 옛 flat schema 로 폴백 — 점진 마이그레이션 안전망.
    let is_agent = hbb_common::config::is_incoming_only();
    if let Ok(dual) = serde_json::from_str::<DualChannelManifest>(&body) {
        let chan = if is_agent { dual.agent } else { dual.hq };
        flog(&format!(
            "dual-channel: selected '{}' (version={})",
            if is_agent { "agent" } else { "hq" },
            chan.version
        ));
        return Ok(chan);
    }
    // 옛 flat schema 폴백.
    let release: LatestRelease = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => bail!("latest.json parse fail (dual & flat both): {}", e),
    };
    flog(&format!(
        "legacy single-channel schema (version={}) — build={}",
        release.version,
        if is_agent { "agent" } else { "hq" }
    ));
    Ok(release)
}

// parse_version / is_newer 는 chainremote_update_common 으로 이전 (push_agent 와 공유 + 단위테스트 cross-platform).

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
    // atomic rename — 반쯤 받은 파일이 노출될 일 없음.
    if dest.exists() {
        std::fs::remove_file(dest).ok();
    }
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

// verify_sha256 은 chainremote_update_common 으로 이전 (빈/불량 expected sha 가드 추가됨).

/// pending Inno 인스톨러를 활성 사용자 세션에 권한승격으로 사일런트 실행.
///
/// 여기까지 온 길: v1.2.5 는 직접 CreateProcess 했다가 세션0 hang, ~v1.2.14 는 schtasks 로
/// 우회했다가 불안정(거짓 unhealthy/미적용 사고의 한 갈래). 둘 다 "서비스(세션0) → 사용자세션
/// 권한실행"을 자력으로 흉내내려다 깨졌다.
///
/// 정석(2026-05-18): RustDesk 가 자기 자가업데이트에 쓰는 검증된 프리미티브
/// launch_privileged_process(session_id, cmd) (platform/windows.rs)를 그대로 쓴다.
///   - 세션은 get_current_session_id(false) = WTS 활성 콘솔(로그인 사용자). 무인이면
///     0xFFFFFFFF 라 서비스 자기 세션으로 폴백(/VERYSILENT 라 UI 불필요, SYSTEM 토큰이라 UAC 도 불필요).
///   - 네이티브 --update 자가교체는 안 쓴다 — 우리 Inno 인스톨러의 필수 작업(toml→LocalService,
///     단축아이콘, watchdog, sc start 견고화)을 보존해야 하기 때문.
pub(crate) fn spawn_silent_install(setup_path: &PathBuf) -> ResultType<()> {
    let setup_str = setup_path.to_string_lossy().to_string();
    let log_path = std::path::Path::new(&setup_str)
        .parent()
        .map(|p| p.join("installer.log").to_string_lossy().to_string())
        .unwrap_or_else(|| "C:\\ProgramData\\ChainRemote\\pending\\installer.log".to_string());

    // 경로에 공백 있을 수 있어 exe·LOG 경로를 큰따옴표로 감싼다.
    let cmd = format!(
        "\"{}\" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG=\"{}\"",
        setup_str, log_path
    );

    // 활성 콘솔 세션 우선, 없으면(무인) 서비스 자기 세션으로 폴백.
    let mut sid = crate::platform::get_current_session_id(false);
    if sid == 0xFFFF_FFFF {
        match crate::platform::get_current_process_session_id() {
            Some(s) => {
                flog("no active console session → falling back to service session");
                sid = s;
            }
            None => bail!("no active console session and failed to get service session id"),
        }
    }
    flog(&format!("launch_privileged_process session={} cmd={}", sid, cmd));

    let h = crate::platform::launch_privileged_process(sid, &cmd)?;
    if h.is_null() {
        bail!("launch_privileged_process returned null handle (session={})", sid);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! latest.json 매니페스트 파싱 테스트. 버전비교/sha256 검증 테스트는
    //! chainremote_update_common::tests 로 옮겼고(cross-platform), 여기엔 updater 고유의
    //! dual/legacy 스키마 파싱만 남긴다.
    use super::*;

    #[test]
    fn dual_channel_manifest_parses_v137() {
        // 운영 latest.json 실제 schema. agent 채널은 0.0.0 으로 영구 락.
        let body = r#"{
            "hq": {
                "version": "1.3.7",
                "url": "https://sepani.synology.me/chainremote/ChainRemote_HQ_Setup_v1.3.7.exe",
                "sha256": "95c9310f499f90175b59f91acce15476d0db415d2020e8eaac0ec5247fe3a8a2",
                "size": 24099858,
                "released_at": "2026-05-29T18:30:00Z",
                "notes": "v1.3.7"
            },
            "agent": {
                "version": "0.0.0",
                "url": "",
                "sha256": "",
                "size": 0,
                "released_at": "2026-05-29T08:11:00Z",
                "notes": "agent 채널 영구 비활성"
            }
        }"#;
        let dual: DualChannelManifest = serde_json::from_str(body).expect("parse fail");
        assert_eq!(dual.hq.version, "1.3.7");
        assert_eq!(dual.agent.version, "0.0.0");
        assert_eq!(dual.agent.url, "");
    }

    #[test]
    fn legacy_single_channel_manifest_still_parses() {
        // 옛 단일 채널 schema 도 LatestRelease 로 fallback 파싱 되어야 함.
        let body = r#"{
            "version": "1.3.0",
            "url": "https://example.com/setup.exe",
            "sha256": "deadbeef"
        }"#;
        let release: LatestRelease = serde_json::from_str(body).expect("parse fail");
        assert_eq!(release.version, "1.3.0");
        assert_eq!(release.sha256, "deadbeef");
    }

    #[test]
    fn manifest_missing_required_field_errs() {
        // version 빠지면 둘 다 실패.
        let body = r#"{ "url": "x", "sha256": "y" }"#;
        assert!(serde_json::from_str::<LatestRelease>(body).is_err());
        assert!(serde_json::from_str::<DualChannelManifest>(body).is_err());
    }

    #[test]
    fn empty_or_malformed_body_errs() {
        assert!(serde_json::from_str::<LatestRelease>("").is_err());
        assert!(serde_json::from_str::<LatestRelease>("not json").is_err());
        assert!(serde_json::from_str::<DualChannelManifest>("[]").is_err());
    }
}
