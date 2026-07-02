//! 거래처 heartbeat — Agent(incoming-only)가 NAS 에 주기적 status 를 보고한다.
//! 패널 거래처 표에 "마지막 접속 + 버전"을 띄우는 재료(운영 가시성 + 영업 자료).
//!
//! 흐름: 첫 실행에 POST register-heartbeat-token 으로 토큰 받아 LocalConfig 에 저장하고,
//! 이후 10분마다 POST heartbeat(X-ChainRemote-Token 헤더 + {remoteId, version}).
//!
//! v1.3.7 자가회복: heartbeat 가 401/403 이면 로컬 토큰 비우고 즉시 re-register + 1회 재시도.
//! 서버가 idempotent rotation(옛 1회 제약 폐기)이라 인스톨 후 토큰을 잃어도 알아서 회복한다.
//! "업데이트 지옥" 탈출의 핵심.
//!
//! Agent + 옵션 B+ HQ 빌드에서만 돈다. 일반 HQ 는 skip.
//! Windows 서비스(LocalSystem) 컨텍스트 실행이라 UAC 없음.
//! 보안 모델은 lib/data/customers.ts::registerHeartbeatToken 의 doc 참조(자가 발급 + idempotent).

#![cfg(target_os = "windows")]

use hbb_common::{bail, log, ResultType};
use std::time::Duration;

const REGISTER_URL: &str =
    "https://sepani.synology.me:3443/api/customers/register-heartbeat-token";
const HEARTBEAT_URL: &str = "https://sepani.synology.me:3443/api/customers/heartbeat";
/// auto-enroll — agent 가 스스로 거래처 등록(custom.txt 에 tenant-slug+enroll-key 있을 때).
const ENROLL_URL: &str = "https://sepani.synology.me:3443/api/customers/enroll";
/// 부팅 후 첫 heartbeat 까지 대기 — 네트워크 안정 + hbbs ID 발급 시간.
const FIRST_DELAY: Duration = Duration::from_secs(60 * 2);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60 * 10);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// LocalConfig 토큰 저장 키. 한 번 발급받으면 재부팅 넘어서도 유지.
const TOKEN_KEY: &str = "chainremote-heartbeat-token";

/// 서비스 진입점(windows.rs::run_service)에서 호출. Agent 도 옵션 B+ HQ 도 아니면 즉시 return.
/// 2026-05-29 게이트 확장으로 is_incoming_only(Agent)에 더해 is_option_b_plus 도 통과시킨다
/// (Chang/재성이 PC 처럼 HQ 이면서 거래처 풀에도 등록되는 경우 — custom.txt "option-b-plus":"Y").
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

/// heartbeat HTTP 결과 분류. 401/403 만 따로 잡아 재등록 회복 경로로 보낸다.
enum BeatOutcome {
    Ok,
    /// 401(토큰 헤더 없음) 또는 403(token/remoteId 불일치) — 토큰 분실/회전 의심.
    AuthRejected,
}

fn tick() -> ResultType<()> {
    let remote_id = hbb_common::config::Config::get_id();
    if remote_id.is_empty() {
        bail!("remote_id empty (hbbs registration pending)");
    }

    // 1) 토큰 확보 — LocalConfig 에 있으면 그거, 없으면 register.
    let stored = hbb_common::config::LocalConfig::get_option(TOKEN_KEY);
    let token = if stored.is_empty() {
        let new_token = acquire_token(&remote_id)?;
        hbb_common::config::LocalConfig::set_option(TOKEN_KEY.to_string(), new_token.clone());
        log::info!("[chainremote_heartbeat] acquired new token for remote_id={}", remote_id);
        new_token
    } else {
        stored
    };

    // 2) heartbeat 전송. 401/403(토큰 미스매치)이면 즉시 re-register + 1회 재시도.
    //    v1.3.7 자가회복의 핵심 — 매 릴리즈 수동 설치를 강요하던 "업데이트 지옥" 탈출.
    //    (인스톨 후 로컬 토큰 분실이든 서버 토큰 회전이든 알아서 회복한다.)
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
            let fresh = acquire_token(&remote_id)?;
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
                    // 방금 재발급했는데도 거부면 서버/네트워크 이상 — 다음 tick 에서 재시도.
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
        // v1.3.7 부터 서버가 idempotent rotation 이라 customer 만 있으면 항상 200.
        // 409 는 거래처 미등록(Chang 이 패널에 아직 안 넣음) — 다음 tick 재시도.
        bail!("register HTTP {}", status);
    }
    #[derive(serde::Deserialize)]
    struct Resp {
        token: String,
    }
    let r: Resp = resp.json()?;
    Ok(r.token)
}

/// 토큰 획득. enroll-key 가 있으면 enroll 로 알아서 등록(신규는 pending 후보+토큰, 기존은 토큰만
/// 새로). 키 없는 옛 빌드는 register-heartbeat-token 로 폴백 — 패널 수동등록 전까진 409(옛 동작)
/// 라 유물이지만 아직 숨은 쉰다.
fn acquire_token(remote_id: &str) -> ResultType<String> {
    let slug = hbb_common::config::get_enroll_tenant_slug();
    let key = hbb_common::config::get_enroll_key();
    if !slug.is_empty() && !key.is_empty() {
        return enroll(remote_id, &slug, &key);
    }
    register_token(remote_id)
}

/// 거래처 상호 읽기 — 인스톨러가 레지스트리(HKLM\SOFTWARE\ChainRemote\CustomerName, REG_SZ)에
/// 넣은 값. 64/32비트 view 둘 다 열어본다(설치모드↔서비스 비트수 불일치 대비). 없으면
/// custom.txt customer-name 폴백(대개 빈 문자열 → 서버가 hostname placeholder 로 명명).
/// 레지스트리를 쓰는 건 한국어 상호를 인스톨러 파일/CP949 경로로 보내면 깨지기 때문 — 유니코드 채널.
fn read_customer_name() -> String {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    for flags in [KEY_READ | KEY_WOW64_64KEY, KEY_READ | KEY_WOW64_32KEY] {
        if let Ok(k) = hklm.open_subkey_with_flags("SOFTWARE\\ChainRemote", flags) {
            if let Ok(v) = k.get_value::<String, _>("CustomerName") {
                let t = v.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    hbb_common::config::get_enroll_customer_name()
}

/// 자가등록 — POST /api/customers/enroll. 신규는 pending 후보+토큰, 같은 tenant 기존이면 토큰 회전.
/// name = custom.txt customer-name(상호), hostname = 자기 hostname(상호 없을 때 서버 placeholder).
fn enroll(remote_id: &str, tenant_slug: &str, enroll_key: &str) -> ResultType<String> {
    let name = read_customer_name();
    let hostname = crate::common::hostname();
    let body = serde_json::json!({
        "remoteId": remote_id,
        "tenantSlug": tenant_slug,
        "enrollKey": enroll_key,
        "name": name,
        "hostname": hostname,
        // 기기지문 앵커: ID 가 바뀌어도(충돌/랜카드교체) 패널이 같은 거래처로 알아봐 상호 유지.
        // 빈 문자열이면 패널이 매칭에서 제외한다(폴백 안전장치).
        "machineUuid": hbb_common::get_machine_fingerprint(),
    })
    .to_string();
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp = client
        .post(ENROLL_URL)
        .header("Content-Type", "application/json")
        .body(body)
        .send()?;
    let status = resp.status();
    if !status.is_success() {
        // 403 = tenant 인증 실패(enroll-key 불일치), 409 = remote_id 가 타 tenant 소유 — 다음 tick 재시도.
        bail!("enroll HTTP {}", status);
    }
    #[derive(serde::Deserialize)]
    struct Resp {
        token: String,
    }
    let r: Resp = resp.json()?;
    Ok(r.token)
}

fn send_heartbeat(remote_id: &str, token: &str, version: &str) -> ResultType<BeatOutcome> {
    let body = serde_json::json!({
        "remoteId": remote_id,
        "version": version,
        // 기기지문 — 패널이 옛 거래처에 backfill + 향후 ID 변경 시 재링크에 쓴다.
        "machineUuid": hbb_common::get_machine_fingerprint(),
    })
    .to_string();
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
