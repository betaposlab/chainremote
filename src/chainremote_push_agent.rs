//! ChainRemote Agent 푸시 폴링 — 관리 패널의 "푸시" 트리거를 거래처 PC 가 가져와 사일런트 설치.
//!
//! 2026-05-29 신규 (Chang 결정). 옛 latest.json 채널 폐기.
//!
//! 배경:
//!   - 2026-05-28 중앙리 사고: 영업시간(12:50PM) 에 옛 단일채널 latest.json 이 v1.3.2 거래처에
//!     자동 적용 → 사장님이 인스톨러 마법사 창을 봄. 사업화 치명 UX 사고.
//!   - 결정: Agent 의 자동 latest.json 폴링 폐기. 본사가 관리 패널에서 "푸시" 클릭 시에만 적용.
//!     영업시간 가드 (default 00:00~07:00) + 무작위지연 (default 0~7시간 분산) 으로 무인 안전.
//!
//! 동작 (Agent 빌드 only — `is_incoming_only()` 게이트):
//!   1. 부팅 후 3분 + 매 5분 주기로 GET /api/customers/pending-update?remoteId=...
//!      헤더: X-ChainRemote-Token (heartbeat 모듈이 발급/저장한 토큰 공유)
//!   2. 응답에 id 있으면 = 본사가 푸시 트리거함
//!      - 영업시간 가드: 현재 시각이 [window_start_hour, window_end_hour) 범위인지
//!      - 무작위지연 가드: first_seen_at + hash(push_id) % randomize_max_sec 도달했는지
//!      - 원격세션 가드: alive_conns 비어있는지
//!   3. 다 통과 → .exe 다운 → SHA256 검증 → spawn_silent_install
//!   4. 결과 POST /api/customers/pending-update (status: "applied" | "failed")
//!
//! 권한: Windows 서비스(LocalSystem) 컨텍스트. UAC 없음. spawn_silent_install 이 활성 세션으로 escalate.

#![cfg(target_os = "windows")]

use crate::chainremote_update_common::{is_newer_str, is_valid_sha256_hex, verify_sha256};
use hbb_common::{bail, log, ResultType};
use std::{
    io::Write,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const PENDING_URL_BASE: &str = "https://sepani.synology.me:3443/api/customers/pending-update";
const POLL_INTERVAL: Duration = Duration::from_secs(60 * 5); // 5분
const FIRST_DELAY: Duration = Duration::from_secs(60 * 3); // 부팅 후 3분 — 네트워크 안정 + hbbs ID 발급 + heartbeat 토큰 발급
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 10);
const PENDING_DIR: &str = r"C:\ProgramData\ChainRemote\pending";
const PENDING_FILE: &str = "ChainRemote_Agent_Push.exe";
const LOG_PATH: &str = r"C:\ProgramData\ChainRemote\push_agent.log";

/// heartbeat 모듈과 공유 — 같은 X-ChainRemote-Token.
const TOKEN_KEY: &str = "chainremote-heartbeat-token";
/// LocalConfig key prefix — push id 별 first_seen_at (unix epoch sec).
const FIRST_SEEN_PREFIX: &str = "push-first-seen:";
/// applied/failed 보고 재시도 횟수 (H4) — 즉시 N회, 끝내 실패 시 보관 후 다음 tick flush.
const REPORT_RETRY: u32 = 3;
const REPORT_RETRY_DELAY: Duration = Duration::from_secs(3);
/// 미보고 결과 단일 보관 슬롯 — "<push_id>|<status>|<reason>". push 는 거래처당 순차라 1슬롯 충분.
const PENDING_REPORT_KEY: &str = "push-pending-report";

fn flog(msg: &str) {
    let _ = std::fs::create_dir_all(r"C:\ProgramData\ChainRemote");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(LOG_PATH)
    {
        let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(f, "{} v{} {}", ts, crate::CHAINREMOTE_VERSION, msg);
    }
    log::info!("chainremote_push_agent: {}", msg);
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct PendingResponse {
    /// None = 대기 푸시 없음 (또는 token/remoteId 매칭 실패 — 보안상 동일 응답).
    id: Option<String>,
    #[serde(default)]
    target_version: String,
    #[serde(default)]
    asset_url: String,
    #[serde(default)]
    asset_sha256: String,
    #[serde(default)]
    asset_size: u64,
    #[serde(default)]
    window_start_hour: u32,
    #[serde(default = "default_end_hour")]
    window_end_hour: u32,
    #[serde(default = "default_randomize_max_sec")]
    randomize_max_sec: u32,
}

fn default_end_hour() -> u32 {
    7
}

fn default_randomize_max_sec() -> u32 {
    25200
}

/// 서비스 진입점에서 호출 (windows.rs::run_service). Agent 빌드 아니면 즉시 return.
pub fn start_in_service() {
    if !hbb_common::config::is_incoming_only() {
        log::info!("[chainremote_push_agent] not agent build → skip push polling");
        return;
    }
    flog(&format!(
        "agent build → starting push polling loop (first_delay={:?}, poll={:?})",
        FIRST_DELAY, POLL_INTERVAL
    ));
    std::thread::spawn(|| {
        std::thread::sleep(FIRST_DELAY);
        loop {
            if let Err(e) = tick() {
                flog(&format!("tick failed: {}", e));
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}

fn tick() -> ResultType<()> {
    let remote_id = hbb_common::config::Config::get_id();
    if remote_id.is_empty() {
        bail!("remote_id empty (hbbs registration pending)");
    }
    let token = hbb_common::config::LocalConfig::get_option(TOKEN_KEY);
    if token.is_empty() {
        bail!("no heartbeat token yet (waiting for heartbeat module to register)");
    }

    // H4: 지난 tick 에서 못 보낸 applied/failed 결과가 있으면 먼저 flush
    //     (보고 실패 시 서버가 push 를 영원히 pending 으로 인식 → 재설치 루프의 한 갈래).
    flush_pending_report(&remote_id, &token);

    let pending = fetch_pending(&remote_id, &token)?;
    let Some(push_id) = pending.id.clone() else {
        return Ok(());
    };

    flog(&format!(
        "pending detected: id={}, target=v{}, window={}~{}, max_delay={}s",
        push_id,
        pending.target_version,
        pending.window_start_hour,
        pending.window_end_hour,
        pending.randomize_max_sec
    ));

    // (C2) 버전 가드 — target 이 현재보다 새 버전이 아니면 재설치 루프 차단.
    //   report_status("applied") 가 네트워크로 실패해 서버 pending 이 남아도, 재부팅 후 같은 push 를
    //   다시 받아 동일 버전 .exe 를 재설치하던 사고(중앙리 영업시간 인스톨러)의 근본 차단.
    //   updater(HQ) 채널은 is_newer 게이트가 이미 있었으나 push 채널엔 없던 결함.
    match is_newer_str(&pending.target_version, crate::CHAINREMOTE_VERSION) {
        Ok(true) => {} // 진짜 새 버전 — 계속 진행
        Ok(false) => {
            flog(&format!(
                "target v{} <= current v{} → already up to date; reporting applied, no reinstall",
                pending.target_version,
                crate::CHAINREMOTE_VERSION
            ));
            finish_report(&remote_id, &token, &push_id, "applied", "already up to date");
            return Ok(());
        }
        Err(e) => {
            flog(&format!(
                "unparseable target_version {:?}: {} → reporting failed",
                pending.target_version, e
            ));
            finish_report(
                &remote_id,
                &token,
                &push_id,
                "failed",
                "unparseable target_version",
            );
            return Ok(());
        }
    }

    // (C3) sha 형식 가드 — 빈값/잘린값/비-hex 면 다운로드 전에 차단.
    //   패널이 asset_sha256 을 빈값/자리표시자로 푸시하면 verify 가 영원히 mismatch → 무한 재다운 +
    //   로그가 파일에만 남는 "무증상 실패". 여기서 즉시 failed 보고로 패널에 가시화.
    if !is_valid_sha256_hex(&pending.asset_sha256) {
        flog(&format!(
            "invalid asset_sha256 in manifest (len={}) → reporting failed, skip download",
            pending.asset_sha256.trim().len()
        ));
        finish_report(
            &remote_id,
            &token,
            &push_id,
            "failed",
            "invalid asset_sha256 in push manifest",
        );
        return Ok(());
    }

    // (1) 영업시간 가드
    if !within_business_window(pending.window_start_hour, pending.window_end_hour) {
        let now_hour = chrono::Local::now().format("%H:%M").to_string();
        flog(&format!(
            "outside business window (now={}, win={}~{}) → waiting next poll",
            now_hour, pending.window_start_hour, pending.window_end_hour
        ));
        return Ok(());
    }

    // (2) 무작위지연 가드
    let now_epoch = now_epoch_sec();
    let first_seen = first_seen_at(&push_id, now_epoch);
    let delay = compute_delay(&push_id, pending.randomize_max_sec);
    let ready = first_seen + delay;
    if now_epoch < ready {
        flog(&format!(
            "randomize delay: ready in {}s (first_seen={}, delay={}s)",
            ready - now_epoch,
            first_seen,
            delay
        ));
        return Ok(());
    }

    // (3) 원격세션 가드
    let alive = crate::Connection::alive_conns();
    if !alive.is_empty() {
        flog(&format!(
            "active sessions ({} conn) → deferring install",
            alive.len()
        ));
        return Ok(());
    }

    // (4) 다운로드 + SHA256 검증
    let pending_path = PathBuf::from(PENDING_DIR).join(PENDING_FILE);
    ensure_pending_dir(&pending_path)?;
    if !(pending_path.exists() && verify_sha256(&pending_path, &pending.asset_sha256).is_ok()) {
        flog(&format!(
            "downloading {} ({} bytes)...",
            pending.asset_url, pending.asset_size
        ));
        // ChainRemote: download/verify 실패가 `?` 로 tick 밖으로 새던 무증상 결함 박멸 (사업화 전 필수).
        //   재빌드로 manifest sha 어긋난 경우 패널에 가시화 + 자가복구: finish_report(failed) →
        //   markFailed 가 failed_at 세팅 → getPendingForAgent 가 그 push 재서빙 중단(무한 재다운로드 종료).
        //   verify_sha256 가 손상파일 삭제(update_common) → Chang 이 정정 sha 로 재푸시하면 새 행으로 깨끗이 회복.
        if let Err(e) = download_to(&pending.asset_url, &pending_path) {
            let msg = format!("download failed: {}", e);
            flog(&msg);
            finish_report(&remote_id, &token, &push_id, "failed", &msg);
            return Ok(());
        }
        if let Err(e) = verify_sha256(&pending_path, &pending.asset_sha256) {
            let msg = format!(
                "sha mismatch (manifest expected={}): {}",
                pending.asset_sha256.trim(),
                e
            );
            flog(&msg);
            finish_report(&remote_id, &token, &push_id, "failed", &msg);
            return Ok(());
        }
        flog("download verified");
    } else {
        flog("pending file already valid, reusing");
    }

    // (5) 사일런트 설치 — updater 모듈의 검증된 launch_privileged_process 재사용
    flog("launching silent install");
    match crate::chainremote_updater::spawn_silent_install(&pending_path) {
        Ok(_) => {
            flog("install launched, reporting applied to admin panel");
            // H4: fire-and-forget 금지 — 재시도 + 끝내 실패 시 보관 후 다음 tick flush.
            //     (finish_report 가 clear_first_seen 도 처리.)
            finish_report(&remote_id, &token, &push_id, "applied", "");
            // 설치 후 서비스 재시작 시점까지 메인 루프 계속 살아있음. CloseApplications 가
            // ChainRemote.exe 죽이고 sc stop/start 처리. 그동안 다음 폴링은 무해 (applied 됨).
        }
        Err(e) => {
            let msg = format!("{}", e);
            flog(&format!("install failed: {}", msg));
            finish_report(&remote_id, &token, &push_id, "failed", &msg);
        }
    }

    Ok(())
}

/// 영업시간 가드. start_hour ≤ end_hour 면 정상 창 (예: 0~7).
/// start_hour > end_hour 면 자정 넘어가는 창 (예: 22~6).
/// 양 끝 포함은 [start, end) — end 시각 정각엔 락.
fn within_business_window(start_hour: u32, end_hour: u32) -> bool {
    use chrono::Timelike;
    let hour = chrono::Local::now().hour();
    if start_hour <= end_hour {
        hour >= start_hour && hour < end_hour
    } else {
        hour >= start_hour || hour < end_hour
    }
}

fn now_epoch_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 처음 본 시각을 LocalConfig 에 박음. 이미 박혀있으면 그 값 반환.
/// LocalConfig 리셋 시 다시 박혀도 무해 (delay 만 다시 카운트, 영업시간 가드는 그대로).
fn first_seen_at(push_id: &str, now_epoch: u64) -> u64 {
    let key = format!("{}{}", FIRST_SEEN_PREFIX, push_id);
    let stored = hbb_common::config::LocalConfig::get_option(&key);
    if !stored.is_empty() {
        if let Ok(v) = stored.parse::<u64>() {
            return v;
        }
    }
    hbb_common::config::LocalConfig::set_option(key, now_epoch.to_string());
    now_epoch
}

fn clear_first_seen(push_id: &str) {
    let key = format!("{}{}", FIRST_SEEN_PREFIX, push_id);
    // LocalConfig 에 "" 박으면 effectively reset.
    hbb_common::config::LocalConfig::set_option(key, String::new());
}

/// deterministic delay: hash(push_id) % max_sec. push_id 가 UUID 라 자연 분산.
/// max_sec=0 이면 즉시 (delay=0).
fn compute_delay(push_id: &str, max_sec: u32) -> u64 {
    if max_sec == 0 {
        return 0;
    }
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    push_id.hash(&mut hasher);
    let h = hasher.finish();
    h % (max_sec as u64)
}

fn fetch_pending(remote_id: &str, token: &str) -> ResultType<PendingResponse> {
    // remote_id 는 9자리 숫자 (hbbs 발급 ID) — URL 인코딩 불필요.
    // 안전을 위해 0-9 외 문자가 있으면 거부.
    if !remote_id.chars().all(|c| c.is_ascii_digit()) {
        bail!("remote_id contains non-digit chars: {}", remote_id);
    }
    let url = format!("{}?remoteId={}", PENDING_URL_BASE, remote_id);
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp = client
        .get(&url)
        .header("X-ChainRemote-Token", token)
        .send()?;
    let status = resp.status();
    if !status.is_success() {
        bail!("fetch_pending HTTP {}", status);
    }
    let body: PendingResponse = resp.json()?;
    Ok(body)
}

fn report_status(
    remote_id: &str,
    token: &str,
    push_id: &str,
    status_str: &str,
    reason: &str,
) -> ResultType<()> {
    let body = serde_json::json!({
        "id": push_id,
        "remoteId": remote_id,
        "status": status_str,
        "reason": reason,
    })
    .to_string();
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp = client
        .post(PENDING_URL_BASE)
        .header("Content-Type", "application/json")
        .header("X-ChainRemote-Token", token)
        .body(body)
        .send()?;
    let status = resp.status();
    if !status.is_success() {
        bail!("report_status HTTP {}", status);
    }
    Ok(())
}

/// applied/failed 결과 보고 — 즉시 재시도 + 끝내 실패 시 LocalConfig 에 보관(다음 tick flush). (H4)
/// 종전 fire-and-forget(`let _ =`)의 "서버가 push 를 영원히 pending 으로 인식" 문제를 정석 해결.
/// first_seen 정리도 여기서 일괄 처리한다 (결과 확정 = 이 push 사이클 종료).
fn finish_report(remote_id: &str, token: &str, push_id: &str, status: &str, reason: &str) {
    clear_first_seen(push_id);
    for attempt in 1..=REPORT_RETRY {
        match report_status(remote_id, token, push_id, status, reason) {
            Ok(_) => {
                clear_pending_report();
                return;
            }
            Err(e) => {
                flog(&format!(
                    "report_status '{}' attempt {}/{} failed: {}",
                    status, attempt, REPORT_RETRY, e
                ));
                if attempt < REPORT_RETRY {
                    std::thread::sleep(REPORT_RETRY_DELAY);
                }
            }
        }
    }
    save_pending_report(push_id, status, reason);
    flog(&format!(
        "report_status '{}' persisted for retry on next tick (push_id={})",
        status, push_id
    ));
}

/// 미보고 결과를 단일 슬롯에 보관. 형식 "<push_id>|<status>|<reason>".
/// reason 에 '|' 가 섞일 수 있어 복원은 splitn(3) (reason 이 마지막 필드).
fn save_pending_report(push_id: &str, status: &str, reason: &str) {
    let v = format!("{}|{}|{}", push_id, status, reason);
    hbb_common::config::LocalConfig::set_option(PENDING_REPORT_KEY.to_string(), v);
}

fn clear_pending_report() {
    hbb_common::config::LocalConfig::set_option(PENDING_REPORT_KEY.to_string(), String::new());
}

/// 보관된 미보고 결과가 있으면 1회 재전송. 성공 시 슬롯 비움, 실패 시 다음 tick 에서 재시도.
fn flush_pending_report(remote_id: &str, token: &str) {
    let raw = hbb_common::config::LocalConfig::get_option(PENDING_REPORT_KEY);
    if raw.is_empty() {
        return;
    }
    let parts: Vec<&str> = raw.splitn(3, '|').collect();
    if parts.len() != 3 {
        clear_pending_report(); // 형식 깨짐 — 버린다.
        return;
    }
    match report_status(remote_id, token, parts[0], parts[1], parts[2]) {
        Ok(_) => {
            flog(&format!(
                "flushed pending report (push_id={}, status={})",
                parts[0], parts[1]
            ));
            clear_pending_report();
        }
        Err(e) => {
            flog(&format!(
                "pending report flush failed (will retry next tick): {}",
                e
            ));
        }
    }
}

fn ensure_pending_dir(file: &PathBuf) -> ResultType<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

fn download_to(url: &str, dest: &PathBuf) -> ResultType<()> {
    use std::io::Write as _;
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
    if dest.exists() {
        std::fs::remove_file(dest).ok();
    }
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

// verify_sha256 은 chainremote_update_common 으로 이전 (빈/불량 expected sha 가드 추가됨).
