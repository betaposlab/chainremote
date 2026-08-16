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

const PENDING_URL_BASE: &str = "https://api.626.kr/api/customers/pending-update";
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
/// LocalConfig key prefix — push id 별 다운로드 시도 횟수.
const DL_ATTEMPT_PREFIX: &str = "push-dl-attempt:";
/// 다운로드/검증을 이만큼 시도해 본 뒤에야 failed 로 보고한다.
///
/// ★왜(2026-08-16 감사 A1-4): 종전엔 **단 한 번의 실패로 failed 를 보고**했다. 서버는 그
///   push 에 failed_at 을 박고 다시 서빙하지 않으므로, NAS 순단·5xx·와이파이 한 번 끊김 같은
///   지나가는 사고 하나로 그 거래처는 그 버전을 **영영 못 받는다** — 사람이 재푸시해야만
///   복구된다. 자동 롤아웃의 의미가 사라지는 자리다.
///
///   폴링이 5분 주기이므로 5회 = 약 25분을 견딘다. 서버 재시작·회선 순단은 대개 그 안에 끝나고,
///   진짜 고장(sha 가 틀림, 파일이 없음)은 25분 뒤 똑같이 failed 로 드러나 패널에 남는다.
///   즉 잃는 것은 "고장을 아는 시점이 25분 늦어지는 것"뿐이다.
const DL_MAX_ATTEMPTS: u32 = 5;
/// LocalConfig key prefix — push id 별 "설치 결과 확인 기한"(unix epoch sec).
const VERIFY_PREFIX: &str = "push-verify:";
/// 인스톨러를 띄운 뒤 이 시간 안에 새 버전으로 돌아오지 않으면 실패로 본다.
///
/// ★왜(2026-08-16 감사 S2): 종전엔 인스톨러 **spawn 이 성공한 순간** applied 를 보고했다.
///   그 뒤에 정전·디스크 부족·서비스 시작 실패가 나도 패널엔 "적용됨"만 남아, 실제로는
///   옛 버전인 기기를 새 버전으로 착각한다(v1.2.11 브릭이 정확히 이 모양이었다).
///
///   이제는 보고를 미루고, **다음 폴링에서 자기 버전을 확인해** 판정한다. 설치가 됐으면
///   위 (C2) 가드의 "target <= current" 갈래가 applied 를 보고하고, 안 됐으면 기한이 지나
///   failed 가 남아 자동 롤아웃이 다시 시도할 수 있다. 즉 보고가 **관측에 근거**하게 된다.
///
///   ★한계: 설치가 서비스를 아예 못 살리면 폴링 자체가 없어 이 보고도 못 나간다. 그때는
///   패널에서 "적용 안 됨 + 하트비트 끊김"으로 드러난다 — 종전의 "적용됨 + 끊김"보다
///   훨씬 정확한 신호다. 서비스 부활은 watchdog 예약작업의 몫이다.
const INSTALL_VERIFY_SECS: u64 = 30 * 60;
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

    // 설치 결과 확인 대기 — 여기 왔다는 건 "아직 옛 버전"이라는 뜻이다(위 가드를 통과했으므로).
    //   인스톨러를 이미 띄웠다면 기한까지는 조용히 기다리고, 기한을 넘겼으면 실패로 보고한다.
    //   ★이 검사가 없으면 폴링마다 같은 인스톨러를 다시 띄운다.
    if let Some(deadline) = get_install_verify(&push_id) {
        let now = now_epoch_sec();
        if now < deadline {
            flog(&format!(
                "install launched earlier, still v{} — waiting {}s more before judging",
                crate::CHAINREMOTE_VERSION,
                deadline - now
            ));
            return Ok(());
        }
        let msg = format!(
            "installer ran but version is still v{} after {}s",
            crate::CHAINREMOTE_VERSION,
            INSTALL_VERIFY_SECS
        );
        flog(&msg);
        finish_report(&remote_id, &token, &push_id, "failed", &msg);
        return Ok(());
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
        // ★실패를 곧장 failed 로 보고하지 않는다 — DL_MAX_ATTEMPTS 상수 주석 참조.
        //   sha 불일치도 여기 포함한다: 회선이 끊겨 잘린 파일도 똑같이 sha 가 어긋나기 때문이다
        //   (verify_sha256 가 손상 파일을 지우므로 다음 시도는 깨끗이 다시 받는다).
        //   manifest sha 가 진짜로 틀린 경우엔 5회를 다 쓰고 나서 종전과 같은 failed 가 남고,
        //   Chang 이 정정해 재푸시하면 새 행으로 회복되는 흐름도 그대로다.
        let outcome = download_to(&pending.asset_url, &pending_path)
            .map_err(|e| format!("download failed: {}", e))
            .and_then(|_| {
                verify_sha256(&pending_path, &pending.asset_sha256).map_err(|e| {
                    format!(
                        "sha mismatch (manifest expected={}): {}",
                        pending.asset_sha256.trim(),
                        e
                    )
                })
            });
        if let Err(msg) = outcome {
            let n = bump_dl_attempt(&push_id);
            if n < DL_MAX_ATTEMPTS {
                flog(&format!(
                    "{} — attempt {}/{}, will retry next poll",
                    msg, n, DL_MAX_ATTEMPTS
                ));
                return Ok(());
            }
            let msg = format!("{} (after {} attempts)", msg, n);
            flog(&msg);
            finish_report(&remote_id, &token, &push_id, "failed", &msg);
            return Ok(());
        }
        clear_dl_attempt(&push_id);
        flog("download verified");
    } else {
        flog("pending file already valid, reusing");
    }

    // 사일런트 설치 — updater 모듈의 검증된 launch_privileged_process 재사용
    flog("launching silent install");
    match crate::chainremote_updater::spawn_silent_install(&pending_path) {
        Ok(_) => {
            // ★여기서 applied 를 보고하지 않는다 — INSTALL_VERIFY_SECS 상수 주석 참조.
            //   "인스톨러가 떴다"는 "새 버전이 돈다"가 아니다. 다음 폴링에서 우리 버전을
            //   직접 보고 판정한다(성공이면 위 (C2) 갈래가 applied 를 보고한다).
            let deadline = now_epoch_sec() + INSTALL_VERIFY_SECS;
            set_install_verify(&push_id, deadline);
            flog(&format!(
                "install launched (v{} → v{}); will confirm by version on next polls",
                crate::CHAINREMOTE_VERSION,
                pending.target_version
            ));
            // 설치가 서비스를 재시작할 때까지 메인 루프는 계속 산다. CloseApplications 가
            // ChainRemote.exe 죽이고 sc stop/start 를 처리.
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

/// 이 push 의 다운로드 시도 횟수를 1 올리고 올린 값을 돌려준다.
fn bump_dl_attempt(push_id: &str) -> u32 {
    let key = format!("{}{}", DL_ATTEMPT_PREFIX, push_id);
    let n = hbb_common::config::LocalConfig::get_option(&key)
        .parse::<u32>()
        .unwrap_or(0)
        + 1;
    hbb_common::config::LocalConfig::set_option(key, n.to_string());
    n
}

fn clear_dl_attempt(push_id: &str) {
    let key = format!("{}{}", DL_ATTEMPT_PREFIX, push_id);
    hbb_common::config::LocalConfig::set_option(key, String::new());
}

fn set_install_verify(push_id: &str, deadline_epoch: u64) {
    let key = format!("{}{}", VERIFY_PREFIX, push_id);
    hbb_common::config::LocalConfig::set_option(key, deadline_epoch.to_string());
}

fn get_install_verify(push_id: &str) -> Option<u64> {
    let key = format!("{}{}", VERIFY_PREFIX, push_id);
    hbb_common::config::LocalConfig::get_option(&key).parse::<u64>().ok()
}

fn clear_install_verify(push_id: &str) {
    let key = format!("{}{}", VERIFY_PREFIX, push_id);
    hbb_common::config::LocalConfig::set_option(key, String::new());
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
    // 이 push 는 여기서 끝난다 — 시도 카운터를 남겨 두면 다음에 같은 id 가 재큐잉될 때
    //   (다운그레이드 복귀 재큐잉 등) 남은 횟수로 시작해 재시도 여유를 잃는다.
    clear_dl_attempt(push_id);
    clear_install_verify(push_id);
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
