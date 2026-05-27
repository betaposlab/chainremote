//! ChainRemote 거래처 heartbeat — Agent (incoming-only) 가 NAS 에 주기적 status 보고.
//!
//! 사업화 가치: 관리 패널의 거래처 표에 "마지막 접속 + 버전" 가시화. 영업 자료 + 운영
//! 가시성. 코이노 대비 차별 포인트.
//!
//! 설계:
//!   - 첫 실행: POST /api/customers/register-heartbeat-token { remoteId } (1회만 성공)
//!     → 받은 token 을 LocalConfig 에 저장 (key: "chainremote-heartbeat-token")
//!   - 그 후 10분 마다: POST /api/customers/heartbeat with X-ChainRemote-Token header
//!     body: { remoteId, version }
//!
//! Agent 빌드만 동작. HQ (outgoing-only) / 정식 builds 는 skip — `is_incoming_only()` 검사.
//! 단 ChainGo 포터블도 incoming-only 가 아니므로 자동 skip.
//!
//! 권한: Windows 서비스(LocalSystem) 컨텍스트에서 실행. UAC 없음.
//! 보안 모델: lib/data/customers.ts::registerHeartbeatToken 의 doc 참조 (자가 발급 + 1회 제약).

#![cfg(target_os = "windows")]

use hbb_common::{bail, log, ResultType};
use std::time::Duration;

const REGISTER_URL: &str =
    "http://sepani.synology.me:3001/api/customers/register-heartbeat-token";
const HEARTBEAT_URL: &str = "http://sepani.synology.me:3001/api/customers/heartbeat";
/// 부팅 후 첫 heartbeat 까지 대기 — 네트워크 안정 + hbbs ID 발급 대기.
const FIRST_DELAY: Duration = Duration::from_secs(60 * 2);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60 * 10);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// LocalConfig 의 토큰 저장 키. 한 번 발급 받으면 평생 유지 (sustain across reboots).
const TOKEN_KEY: &str = "chainremote-heartbeat-token";

/// 서비스 진입점에서 호출 (windows.rs::run_service). Agent 빌드가 아니면 즉시 return.
pub fn start_in_service() {
    if !hbb_common::config::is_incoming_only() {
        log::info!(
            "[chainremote_heartbeat] not agent (incoming-only) build → skip heartbeat loop"
        );
        return;
    }
    log::info!("[chainremote_heartbeat] agent build → starting heartbeat loop");
    std::thread::spawn(|| {
        run_loop();
    });
}

fn run_loop() {
    std::thread::sleep(FIRST_DELAY);
    loop {
        if let Err(e) = tick() {
            log::warn!("[chainremote_heartbeat] tick failed: {}", e);
        }
        std::thread::sleep(HEARTBEAT_INTERVAL);
    }
}

fn tick() -> ResultType<()> {
    let remote_id = hbb_common::config::Config::get_id();
    if remote_id.is_empty() {
        bail!("remote_id empty (hbbs registration pending)");
    }

    // 1) 토큰 확보 — LocalConfig 에 저장된 게 있으면 그거 사용, 없으면 register API.
    let stored = hbb_common::config::LocalConfig::get_option(TOKEN_KEY);
    let token = if stored.is_empty() {
        let new_token = register_token(&remote_id)?;
        hbb_common::config::LocalConfig::set_option(TOKEN_KEY.to_string(), new_token.clone());
        log::info!("[chainremote_heartbeat] registered new token for remote_id={}", remote_id);
        new_token
    } else {
        stored
    };

    // 2) heartbeat 전송.
    send_heartbeat(&remote_id, &token, crate::CHAINREMOTE_VERSION)?;
    log::info!(
        "[chainremote_heartbeat] beat ok (remote_id={}, version={})",
        remote_id,
        crate::CHAINREMOTE_VERSION
    );
    Ok(())
}

fn register_token(remote_id: &str) -> ResultType<String> {
    let body = serde_json::json!({ "remoteId": remote_id }).to_string();
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp = client
        .post(REGISTER_URL)
        .header("Content-Type", "application/json")
        .body(body)
        .send()?;
    let status = resp.status();
    if !status.is_success() {
        // 409 = 이미 등록됨 또는 거래처 미등록.
        //   - "이미 등록됨" → 관리 패널에서 토큰 reset 필요 (super_admin 작업).
        //   - "거래처 미등록" → Chang 이 패널에 그 remote_id 거래처 등록 전. 다음 tick 재시도.
        bail!("register HTTP {}", status);
    }
    #[derive(serde::Deserialize)]
    struct Resp {
        token: String,
    }
    let r: Resp = resp.json()?;
    Ok(r.token)
}

fn send_heartbeat(remote_id: &str, token: &str, version: &str) -> ResultType<()> {
    let body = serde_json::json!({ "remoteId": remote_id, "version": version }).to_string();
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp = client
        .post(HEARTBEAT_URL)
        .header("Content-Type", "application/json")
        .header("X-ChainRemote-Token", token)
        .body(body)
        .send()?;
    let status = resp.status();
    if !status.is_success() {
        // 403 = token 또는 remoteId 불일치. 토큰 만료/리셋 의심 → 다음 tick 에서 register 재시도?
        // 현재는 단순 log + 재시도 안 함. 매출 후 token rotation 정책 추가 검토.
        bail!("heartbeat HTTP {}", status);
    }
    Ok(())
}
