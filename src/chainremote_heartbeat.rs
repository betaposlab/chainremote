//! ChainRemote 거래처 heartbeat — Agent (incoming-only) 가 NAS 에 주기적 status 보고.
//!
//! 사업화 가치: 관리 패널의 거래처 표에 "마지막 접속 + 버전" 가시화. 영업 자료 + 운영
//! 가시성. 코이노 대비 차별 포인트.
//!
//! 설계:
//!   - 첫 실행: POST /api/customers/register-heartbeat-token { remoteId }
//!     → 받은 token 을 LocalConfig 에 저장 (key: "chainremote-heartbeat-token")
//!   - 그 후 10분 마다: POST /api/customers/heartbeat with X-ChainRemote-Token header
//!     body: { remoteId, version }
//!   - v1.3.7 자가회복: heartbeat 401/403 이면 LocalConfig 토큰 비우고 즉시 re-register
//!     + 1회 재시도. 서버는 idempotent rotation (1회 제약 폐기) — 인스톨 후 토큰 분실해도
//!     자동 회복. "업데이트 지옥" 탈출의 핵심.
//!
//! Agent + 옵션 B+ HQ 빌드만 동작. 일반 HQ/정식 builds 는 skip.
//!
//! 권한: Windows 서비스(LocalSystem) 컨텍스트에서 실행. UAC 없음.
//! 보안 모델: lib/data/customers.ts::registerHeartbeatToken 의 doc 참조 (자가 발급 + idempotent).

#![cfg(target_os = "windows")]

use hbb_common::{bail, log, ResultType};
use std::time::Duration;

const REGISTER_URL: &str =
    "https://sepani.synology.me:3443/api/customers/register-heartbeat-token";
const HEARTBEAT_URL: &str = "https://sepani.synology.me:3443/api/customers/heartbeat";
/// 부팅 후 첫 heartbeat 까지 대기 — 네트워크 안정 + hbbs ID 발급 대기.
const FIRST_DELAY: Duration = Duration::from_secs(60 * 2);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60 * 10);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// LocalConfig 의 토큰 저장 키. 한 번 발급 받으면 평생 유지 (sustain across reboots).
const TOKEN_KEY: &str = "chainremote-heartbeat-token";

/// 서비스 진입점에서 호출 (windows.rs::run_service). Agent 또는 옵션 B+ HQ 가 아니면 즉시 return.
///
/// 2026-05-29 게이트 확장:
///   - Agent (`is_incoming_only`) — 기존
///   - 옵션 B+ HQ (`is_option_b_plus`) — 신규: Chang/재성이 PC 처럼 HQ + 거래처 풀 등록 시.
///     custom.txt 의 `"option-b-plus": "Y"` 마커.
pub fn start_in_service() {
    let is_agent = hbb_common::config::is_incoming_only();
    let is_b_plus = hbb_common::config::is_option_b_plus();
    if !is_agent && !is_b_plus {
        log::info!(
            "[chainremote_heartbeat] not agent and not option-B+ → skip heartbeat loop"
        );
        return;
    }
    log::info!(
        "[chainremote_heartbeat] {} → starting heartbeat loop",
        if is_agent { "agent build" } else { "option-B+ HQ" }
    );
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

/// heartbeat HTTP 결과 분류 — 401/403 만 별도로 잡아 재등록 회복 경로 트리거.
enum BeatOutcome {
    Ok,
    /// 401 (token 헤더 미보유) 또는 403 (token/remoteId 불일치). 토큰 분실/회전 의심.
    AuthRejected,
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

    // 2) heartbeat 전송. 401/403 = 토큰 미스매치 → 즉시 re-register + 1회 재시도.
    //    v1.3.7 자가회복 핵심 — 매 릴리즈마다 수동 설치 강요하던 "업데이트 지옥" 탈출.
    //    (인스톨 후 LocalConfig 토큰 분실 / 서버 토큰 회전 모두 자동 회복.)
    match send_heartbeat(&remote_id, &token, crate::CHAINREMOTE_VERSION)? {
        BeatOutcome::Ok => {
            log::info!(
                "[chainremote_heartbeat] beat ok (remote_id={}, version={})",
                remote_id,
                crate::CHAINREMOTE_VERSION
            );
            Ok(())
        }
        BeatOutcome::AuthRejected => {
            log::warn!(
                "[chainremote_heartbeat] auth rejected → clear local token + re-register"
            );
            hbb_common::config::LocalConfig::set_option(TOKEN_KEY.to_string(), String::new());
            let fresh = register_token(&remote_id)?;
            hbb_common::config::LocalConfig::set_option(TOKEN_KEY.to_string(), fresh.clone());
            match send_heartbeat(&remote_id, &fresh, crate::CHAINREMOTE_VERSION)? {
                BeatOutcome::Ok => {
                    log::info!(
                        "[chainremote_heartbeat] beat ok after recovery (remote_id={})",
                        remote_id
                    );
                    Ok(())
                }
                BeatOutcome::AuthRejected => {
                    // 재발급 직후에도 거부 = 서버/네트워크 이상. 다음 tick 에서 재시도.
                    bail!("heartbeat auth rejected even after fresh register");
                }
            }
        }
    }
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
        // v1.3.7 부터 서버는 idempotent rotation → customer 존재하면 항상 200.
        // 409 = 거래처 미등록 (Chang 이 패널에 등록 전). 다음 tick 재시도.
        bail!("register HTTP {}", status);
    }
    #[derive(serde::Deserialize)]
    struct Resp {
        token: String,
    }
    let r: Resp = resp.json()?;
    Ok(r.token)
}

fn send_heartbeat(remote_id: &str, token: &str, version: &str) -> ResultType<BeatOutcome> {
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
    if status.is_success() {
        return Ok(BeatOutcome::Ok);
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Ok(BeatOutcome::AuthRejected);
    }
    bail!("heartbeat HTTP {}", status);
}
