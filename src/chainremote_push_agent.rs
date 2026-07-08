//! Agent 푸시 폴링 — 패널의 "푸시" 트리거를 거래처 PC 가 가져와 사일런트 설치한다.
//! 2026-05-29 신규(Chang 결정), Agent 의 옛 latest.json 자동 폴링을 폐기하고 대체.
//!
//! 왜 갈아엎었나: 2026-05-28 중앙리 사고. 영업시간(12:50PM)에 옛 단일채널 latest.json 이
//! v1.3.2 거래처에 자동 적용돼 사장님이 인스톨러 마법사 창을 봤다 — 사업화에 치명적인 UX 사고.
//! 그래서 자동 폴링을 없애고, 본사가 패널에서 "푸시"를 눌러야만 적용되게 했다. 영업시간
//! 가드(기본 00:00~07:00) + 무작위지연(기본 0~7시간 분산)으로 무인이어도 조용히 적용된다.
//!
//! 동작 (Agent 빌드 only — is_incoming_only() 게이트):
//!   1. 부팅 후 3분 + 매 5분 GET /api/customers/pending-update?remoteId=...
//!      (X-ChainRemote-Token = heartbeat 모듈이 발급/저장한 토큰 공유)
//!   2. 응답에 id 있으면 본사가 푸시한 것 → 영업시간/무작위지연/원격세션 가드 통과 여부 확인
//!   3. 다 통과 → .exe 다운 → SHA256 검증 → spawn_silent_install
//!   4. 결과를 POST(status: "applied" | "failed")
//!
//! Windows 서비스(LocalSystem) 컨텍스트 실행, UAC 없음. 실제 설치는 spawn_silent_install 이
//! 활성 세션으로 escalate.

#![cfg(target_os = "windows")]

use crate::chainremote_update_common::{is_newer_str, is_valid_sha256_hex, verify_sha256};
use hbb_common::{bail, is_valid_custom_id, log, ResultType};
use std::{
    io::Write,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const PENDING_URL_BASE: &str = "https://sepani.synology.me:3443/api/customers/pending-update";
const POLL_INTERVAL: Duration = Duration::from_secs(60 * 5); // 5분
const FIRST_DELAY: Duration = Duration::from_secs(60 * 3); // 부팅 후 3분 — 네트워크 안정 + hbbs ID + heartbeat 토큰 대기
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60 * 10);
const PENDING_DIR: &str = r"C:\ProgramData\ChainRemote\pending";
const PENDING_FILE: &str = "ChainRemote_Agent_Push.exe";
const LOG_PATH: &str = r"C:\ProgramData\ChainRemote\push_agent.log";

/// heartbeat 모듈과 같은 X-ChainRemote-Token 공유.
const TOKEN_KEY: &str = "chainremote-heartbeat-token";
/// LocalConfig key prefix — push id 별 first_seen_at (unix epoch sec).
const FIRST_SEEN_PREFIX: &str = "push-first-seen:";
/// applied/failed 보고 재시도 횟수(H4) — 즉시 N회, 끝내 실패면 보관했다 다음 tick flush.
const REPORT_RETRY: u32 = 3;
const REPORT_RETRY_DELAY: Duration = Duration::from_secs(3);
/// 미보고 결과 보관 슬롯 — "<push_id>|<status>|<reason>". push 는 거래처당 순차라 1슬롯이면 된다.
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
    /// None = 대기 푸시 없음(또는 token/remoteId 매칭 실패 — 보안상 같은 응답으로 뭉갠다).
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

/// 서비스 진입점(windows.rs::run_service)에서 호출. Agent 빌드 아니면 즉시 return.
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

    // H4: 지난 tick 에서 못 보낸 applied/failed 결과가 있으면 먼저 flush.
    //     (보고가 실패하면 서버가 push 를 영원히 pending 으로 알아 재설치 루프의 한 갈래가 된다.)
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

    // (C2) 버전 가드 — target 이 현재보다 새 버전이 아니면 재설치 루프를 끊는다.
    //   report_status("applied")가 네트워크로 실패해 서버 pending 이 남으면, 재부팅 후 같은 push 를
    //   또 받아 동일 버전 .exe 를 재설치하는 사고(중앙리 영업시간 인스톨러)가 났다. HQ 채널엔
    //   is_newer 게이트가 진작 있었는데 push 채널만 빠져 있던 구멍이다.
    match is_newer_str(&pending.target_version, crate::CHAINREMOTE_VERSION) {
        Ok(true) => {} // 진짜 새 버전 — 진행
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

    // (C3) sha 형식 가드 — 빈값/잘린값/비-hex 면 다운로드 전에 막는다.
    //   패널이 asset_sha256 을 빈값/자리표시자로 푸시하면 verify 가 영원히 mismatch → 무한 재다운에
    //   로그는 파일에만 남는 "무증상 실패"가 된다. 여기서 즉시 failed 로 보고해 패널에 드러낸다.
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

    // 영업시간 가드
    if !within_business_window(pending.window_start_hour, pending.window_end_hour) {
        let now_hour = chrono::Local::now().format("%H:%M").to_string();
        flog(&format!(
            "outside business window (now={}, win={}~{}) → waiting next poll",
            now_hour, pending.window_start_hour, pending.window_end_hour
        ));
        return Ok(());
    }

    // 무작위지연 가드
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

    // 원격세션 가드 — 작업 중인 거래처 화면을 보호
    let alive = crate::Connection::alive_conns();
    if !alive.is_empty() {
        flog(&format!(
            "active sessions ({} conn) → deferring install",
            alive.len()
        ));
        return Ok(());
    }

    // 다운로드 + SHA256 검증
    let pending_path = PathBuf::from(PENDING_DIR).join(PENDING_FILE);
    ensure_pending_dir(&pending_path)?;
    if !(pending_path.exists() && verify_sha256(&pending_path, &pending.asset_sha256).is_ok()) {
        flog(&format!(
            "downloading {} ({} bytes)...",
            pending.asset_url, pending.asset_size
        ));
        // download/verify 실패가 `?` 로 tick 밖으로 새 나가 아무도 모르던 무증상 결함을 박멸(사업화 전
        //   필수). 재빌드로 manifest sha 가 어긋난 경우: finish_report(failed) → markFailed 가
        //   failed_at 세팅 → getPendingForAgent 가 그 push 재서빙을 멈춰 무한 재다운로드가 끝난다.
        //   verify_sha256 가 손상 파일도 지우므로, Chang 이 정정한 sha 로 재푸시하면 새 행으로 깨끗이 회복.
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

    // 사일런트 설치 — updater 모듈의 검증된 launch_privileged_process 재사용
    flog("launching silent install");
    match crate::chainremote_updater::spawn_silent_install(&pending_path) {
        Ok(_) => {
            flog("install launched, reporting applied to admin panel");
            // H4: fire-and-forget 안 한다 — 재시도하고 끝내 실패하면 보관했다 다음 tick flush.
            //     (finish_report 가 clear_first_seen 도 겸한다.)
            finish_report(&remote_id, &token, &push_id, "applied", "");
            // 설치가 서비스를 재시작할 때까지 메인 루프는 계속 산다. CloseApplications 가
            // ChainRemote.exe 죽이고 sc stop/start 를 처리. 그 사이 다음 폴링은 무해(이미 applied).
        }
        Err(e) => {
            let msg = format!("{}", e);
            flog(&format!("install failed: {}", msg));
            finish_report(&remote_id, &token, &push_id, "failed", &msg);
        }
    }

    Ok(())
}

/// 영업시간 가드. start ≤ end 면 정상 창(예: 0~7), start > end 면 자정 넘는 창(예: 22~6).
/// 범위는 [start, end) — end 시각 정각엔 락.
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

/// 처음 본 시각을 LocalConfig 에 박고, 이미 있으면 그 값 반환.
/// LocalConfig 리셋으로 다시 박혀도 무해하다(delay 만 재카운트, 영업시간 가드는 그대로).
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
    // "" 박으면 사실상 리셋.
    hbb_common::config::LocalConfig::set_option(key, String::new());
}

/// hash(push_id) % max_sec 로 결정적 delay. push_id 가 UUID 라 자연히 분산된다. max_sec=0 이면 0.
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
    // remote_id 는 hbbs 발급 숫자 ID 이거나(예: 123456789), 영문자로 시작하는 커스텀 ID
    // (예: GN50840786, is_valid_custom_id 와 동일 규칙 [a-zA-Z][\w-]{5,15})일 수 있다.
    // 두 형식 다 URL 쿼리에 안전하게 들어가는 문자셋이라 인코딩은 그대로 불필요.
    // 2026-07-08: 순수 숫자만 허용하던 옛 가드가 커스텀 ID 거래처의 푸시 폴링을 매 tick
    //   조용히 bail 시켜 영구 미적용시켰던 버그(온라인인데 대기 버전이 안 풀림) 수정.
    let is_legacy_numeric_id = !remote_id.is_empty() && remote_id.chars().all(|c| c.is_ascii_digit());
    if !is_legacy_numeric_id && !is_valid_custom_id(remote_id) {
        bail!("remote_id has unrecognized/unsafe format: {}", remote_id);
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

/// applied/failed 보고 — 즉시 재시도, 끝내 실패면 LocalConfig 에 보관해 다음 tick 에 flush(H4).
/// 종전 fire-and-forget(`let _ =`)이 "서버가 push 를 영원히 pending 으로 인식"하게 두던 걸 고친다.
/// 결과가 확정되면 이 push 사이클이 끝난 것이므로 first_seen 정리도 여기서 겸한다.
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

/// 미보고 결과를 슬롯에 보관. 형식 "<push_id>|<status>|<reason>".
/// reason 에 '|' 가 섞일 수 있어 복원은 splitn(3)으로(reason 이 마지막 필드).
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
        clear_pending_report(); // 형식 깨짐 — 버림
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
