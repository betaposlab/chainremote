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
    "https://api.626.kr/api/customers/register-heartbeat-token";
const HEARTBEAT_URL: &str = "https://api.626.kr/api/customers/heartbeat";
/// auto-enroll — agent 가 스스로 거래처 등록(custom.txt 에 tenant-slug+enroll-key 있을 때).
const ENROLL_URL: &str = "https://api.626.kr/api/customers/enroll";
/// 부팅 후 첫 heartbeat 까지 대기 — 네트워크 안정 + hbbs ID 발급 시간.
const FIRST_DELAY: Duration = Duration::from_secs(60 * 2);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(60 * 10);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// LocalConfig 토큰 저장 키. 한 번 발급받으면 재부팅 넘어서도 유지.
const TOKEN_KEY: &str = "chainremote-heartbeat-token";

/// 디스크 정리 명령 dedupe — 마지막으로 실행한 요청 시각(서버 cleanup_requested_at).
/// 같은 요청이 매 heartbeat 응답에 실려와도 한 번만 실행한다.
const CLEANUP_DONE_KEY: &str = "chainremote-cleanup-done";
/// 거래처 수락카드에 띄울 대리점 상호. 서버가 heartbeat 응답으로 내려주고 여기 캐시한다.
///   설치본(custom.txt)에 안 박는 이유: 자동 업데이트가 번들 파일로 덮어버리고, 대리점이
///   상호를 바꿔도 이미 깔린 거래처에 반영할 길이 없다. 이 경로면 다음 하트비트에 따라온다.
///   비어 있으면(구버전 서버 / 첫 하트비트 전) UI 가 "본사" 로 대체한다.
///
/// ★2026-08-06 LocalConfig → ProgramData 파일로 옮겼다. heartbeat 는 서비스(LocalSystem)에서
///   돌고 수락카드는 사용자 세션에서 뜨는데, LocalConfig 는 그 둘이 서로 다른 파일이라
///   (서비스 프로필에만 ChainRemote_local.toml 이 생긴다) 캐시해도 카드가 절대 못 읽었다.
///   그래서 모든 거래처에서 "본사" 로만 떴다. ProgramData 는 양쪽이 같이 읽는다
///   (updater.log·watchdog.ps1 이 이미 쓰는 검증된 자리).
///
/// 수락카드가 거래처(Windows)에만 있으니 캐시도 Windows 에서만 한다. 맥 HQ 도 옵션 B+ 면
/// 하트비트를 돌리는데, 거기서 이 경로를 만들면 "C:\ProgramData\..." 라는 이름의 폴더가
/// 통째로 생긴다 (유닉스는 역슬래시가 그냥 파일명 글자다).
#[cfg(windows)]
pub(crate) fn support_name_path() -> std::path::PathBuf {
    std::path::PathBuf::from(
        std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".to_string()),
    )
    .join("ChainRemote")
    .join("support-name.txt")
}

/// 캐시된 상호를 읽는다. 없거나 못 읽으면 빈 문자열 — UI 가 "본사" 로 대체한다.
#[cfg(windows)]
pub(crate) fn read_support_name() -> String {
    std::fs::read_to_string(support_name_path())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

#[cfg(not(windows))]
pub(crate) fn read_support_name() -> String {
    String::new()
}

/// 마지막 정리 결과(JSON) — 보고가 서버에 못 닿았을 때 다음 tick 에 재전송(자가치유).
const CLEANUP_RESULT_KEY: &str = "chainremote-cleanup-result";

/// 자동 Temp 정리 — C: 여유가 이 밑이면(32/64GB 소용량 포스의 실질 위험선, 2026-07-16
/// Chang 확정) 명령 없이도 스스로 정리한다. ★자동은 Temp 만 — 휴지통은 매장 직원이
/// "지웠다 살릴" 파일이 있을 수 있어 수동 [정리] 버튼에서만 비운다.
const AUTO_CLEAN_THRESHOLD: u64 = 5 * 1024 * 1024 * 1024;
/// 자동 정리 최소 간격 — Temp 를 비워도 5GB 를 못 넘기는 기기(원인이 딴 데)에서
/// 매 tick 헛돌지 않게 하루 1회로 절제.
const AUTO_CLEAN_MIN_INTERVAL_SECS: u64 = 24 * 3600;
/// 마지막 자동 정리 시각(epoch 초).
const AUTOCLEAN_AT_KEY: &str = "chainremote-autoclean-at";

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
    // 방화벽 자동 해제 감시 — heartbeat 응답이 대상 여부를 켜고, 이 스레드가 재활성을 잡는다.
    crate::chainremote_firewall::start_watch();
    // VAN 카드결제 데몬 감시 — heartbeat 응답이 VAN 종류를 켜고, 이 스레드가 데몬 정지를 잡는다.
    crate::chainremote_van::start_watch();
    // 공유기 UPnP 조사 — 한 번만, 백그라운드로. 결과는 다음 heartbeat 부터 실린다.
    //   공유기가 응답을 안 하면 몇 초씩 걸리므로 절대 여기서 기다리지 않는다.
    crate::chainremote_upnp::probe_async();
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
    /// 성공. 서버가 [디스크 정리]를 큐해뒀으면 요청 시각(ISO)이 실려온다(마이그 024).
    Ok(Option<String>),
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
    match send_heartbeat(&remote_id, &token, crate::CHAINREMOTE_VERSION, None)? {
        BeatOutcome::Ok(cleanup) => {
            log::info!(
                "[chainremote_heartbeat] beat ok (remote_id={}, version={})",
                remote_id,
                crate::CHAINREMOTE_VERSION
            );
            if let Some(req) = cleanup {
                handle_cleanup_request(&remote_id, &token, &req);
            }
            maybe_auto_cleanup(&remote_id, &token);
            Ok(())
        }
        BeatOutcome::AuthRejected => {
            log::warn!(
                "[chainremote_heartbeat] auth rejected → clear local token + re-register"
            );
            hbb_common::config::LocalConfig::set_option(TOKEN_KEY.to_string(), String::new());
            let fresh = acquire_token(&remote_id)?;
            hbb_common::config::LocalConfig::set_option(TOKEN_KEY.to_string(), fresh.clone());
            match send_heartbeat(&remote_id, &fresh, crate::CHAINREMOTE_VERSION, None)? {
                BeatOutcome::Ok(cleanup) => {
                    log::info!(
                        "[chainremote_heartbeat] beat ok after recovery (remote_id={})",
                        remote_id
                    );
                    if let Some(req) = cleanup {
                        handle_cleanup_request(&remote_id, &fresh, &req);
                    }
                    maybe_auto_cleanup(&remote_id, &fresh);
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

/// 패널·HQ 표시용 OS 정보 — (버전 라벨, 네이티브 OS 비트수). "Win7 · 64비트" 처럼 보여준다.
/// ★프로세스 arch 아니라 OS 자체를 본다: 64비트 Win7 이 32비트 페이로드를 돌려도 여기선
///   "Windows 7" + "x64" 로 잡혀, arch 배지만 볼 때 생기던 착각(64비트=Win10 추정)을 없앤다.
/// 버전은 레지스트리로 읽는다(매니페스트 거짓말 무관). Win11 은 ProductName 이 여전히
///   "Windows 10" 이라 CurrentBuildNumber>=22000 으로 승격. 실패하면 빈 문자열(heartbeat 안 깨짐).
fn read_os_info() -> (String, String) {
    // 네이티브 OS 비트수: 64비트 프로세스면 당연 x64. 32비트 프로세스는 WOW64(64비트 OS)일 때
    //   PROCESSOR_ARCHITEW6432 가 세팅되므로 그걸로 진짜 OS 비트수를 가른다.
    let os_bits = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if std::env::var("PROCESSOR_ARCHITEW6432").is_ok() {
        "x64"
    } else {
        "x86"
    }
    .to_string();

    let label = (|| -> Option<String> {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        let cur = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
            .ok()?;
        let product: String = cur.get_value("ProductName").unwrap_or_default();
        let build: u32 = cur
            .get_value::<String, _>("CurrentBuildNumber")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0);
        if build >= 22000 {
            Some("Windows 11".to_string())
        } else if product.contains("Windows 7") {
            Some("Windows 7".to_string())
        } else if product.contains("Windows 8.1") {
            Some("Windows 8.1".to_string())
        } else if product.contains("Windows 8") {
            Some("Windows 8".to_string())
        } else if product.contains("Windows 10") {
            Some("Windows 10".to_string())
        } else {
            let t = product.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
    })()
    .unwrap_or_default();

    (label, os_bits)
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

fn send_heartbeat(
    remote_id: &str,
    token: &str,
    version: &str,
    cleanup_result: Option<&str>,
) -> ResultType<BeatOutcome> {
    let (os, os_bits) = read_os_info();
    let mut body = serde_json::json!({
        "remoteId": remote_id,
        "version": version,
        // 프로세스 arch — 이 기기가 32비트 페이로드(i686)로 도는지 x64 로 도는지. 32비트는
        //   target_arch="x86" 으로 컴파일되므로 실행 바이너리 자신이 확실히 안다(추론 불필요).
        //   ★내부 진단용(어느 페이로드/버전 트랙인지). 표시는 os/osBits 를 쓴다(OS 기준이 정확).
        "arch": if cfg!(target_arch = "x86") { "x86" } else { "x64" },
        // OS 표시 정보 — os="Windows 7/10/11", osBits="x64"/"x86"(네이티브 OS 비트수).
        //   패널·HQ 가 "Win7 · 64비트" 로 보여줘, arch(페이로드)만 볼 때의 착각을 없앤다.
        "os": os,
        "osBits": os_bits,
        // 기기지문 — 패널이 옛 거래처에 backfill + 향후 ID 변경 시 재링크에 쓴다.
        "machineUuid": hbb_common::get_machine_fingerprint(),
        // NAT 유형(마이그039) — 0=미상 1=Cone(홀펀칭 가능) 2=Symmetric(포트 예측 불가→릴레이).
        //   코어가 부팅 때 서버 두 포트에 같은 로컬주소로 붙어보고 판정해 둔 값을 그대로 싣는다
        //   (common.rs test_nat_type). 릴레이를 타는 거래처가 어떤 환경인지 짐작하지 않고 세려는 것 —
        //   Symmetric 이 몇 대인지가 UPnP 를 만들지 말지를 정한다(2026-08-11 낭성 사례).
        "natType": hbb_common::config::Config::get_nat_type(),
    });
    // 공유기 UPnP 지원 여부(마이그040) — ""=측정 전 "no"=IGD 없음 "found"=광고만 "yes"=제어까지 OK.
    //   홀펀칭이 실패하는 거래처를 직결로 돌릴 유일한 길이 UPnP 인데, 공유기가 켜 뒀어야 한다.
    //   포트 매핑 본체를 만들기 전에 "몇 곳이나 되는가"부터 세려는 것(chainremote_upnp 주석).
    {
        let u = crate::chainremote_upnp::result();
        if !u.is_empty() {
            body["upnp"] = u.into();
        }
        // 공유기가 열어 준 바깥 주소(041). 스위치가 꺼져 있거나 매핑에 실패하면 빈 문자열을
        //   보내 서버가 옛 주소를 지우게 한다 — 닫힌 문을 본사가 계속 두드리면 안 된다.
        body["upnpEndpoint"] = crate::chainremote_upnp::endpoint().into();
    }
    // 디스크 관제(패널 마이그 024) — C드라이브 용량 + (여유 부족 시) Temp 실측.
    //   조회 실패해도 heartbeat 는 그대로 나간다. 표시·경고용 telemetry.
    if let Some((total, free)) = read_disk_info() {
        body["diskTotal"] = total.into();
        body["diskFree"] = free.into();
        if let Some(t) = measured_temp_bytes(free) {
            body["tempBytes"] = t.into();
        }
        // 용량을 먹는 폴더 상위 — 여유 부족일 때만, 6시간에 한 번. 재기만 한다(지우지 않음).
        //   "Temp 를 비워도 여유가 안 늘어나는" 기기의 진짜 범인을 데이터로 확인하려는 것.
        //   서버가 이 필드를 모르면 그냥 무시된다(옛 패널 호환).
        if let Some(dirs) = measured_top_dirs(free) {
            body["topDirs"] = dirs
                .into_iter()
                .map(|(name, bytes)| {
                    let mut o = serde_json::Map::new();
                    o.insert("name".into(), name.into());
                    o.insert("bytes".into(), bytes.into());
                    serde_json::Value::Object(o)
                })
                .collect::<Vec<_>>()
                .into();
        }
    }
    // [디스크 정리] 완료 보고 — 서버가 결과 저장 + 요청 큐를 비운다.
    if let Some(r) = cleanup_result {
        body["cleanupResult"] = r.into();
    }
    // 방화벽 관제 보고(마이그 028) — 정규 heartbeat(cleanup_result 없음)에만 싣는다.
    //   정리결과 후속 전송에 같이 실으면 disarm 카운트가 중복 증가하기 때문. firewallEnabled=
    //   현재 켜짐 여부, firewallDisarmed=지난 보고 후 자동 해제 발생. disarmed 는 peek 만 하고,
    //   전송 성공 후 clear 한다(실패 시 다음 tick 에 재보고 — 카운트 유실 방지).
    let report_firewall_disarm = if cleanup_result.is_none() {
        if let Some(en) = crate::chainremote_firewall::current_enabled() {
            body["firewallEnabled"] = en.into();
        }
        let disarmed = crate::chainremote_firewall::peek_disarmed();
        if disarmed {
            body["firewallDisarmed"] = true.into();
        }
        disarmed
    } else {
        false
    };
    // VAN 데몬 관제 보고(마이그 036) — 방화벽과 같은 이유로 정규 heartbeat 에만 싣는다
    //   (후속 전송에 같이 실으면 재시작 카운트가 중복 증가한다). vanOk=데몬이 포트를 듣고
    //   있나, vanRestarted=지난 보고 후 되살렸나, vanGaveUp=재실행으로 안 낫아 손을 뗐나.
    let report_van_restart = if cleanup_result.is_none() {
        // ★관제는 켜져 있는데 판정을 보류한 상태(리더기 대기)면 **null 을 명시해서** 보낸다.
        //   필드를 빼면 서버는 "변경 없음"으로 읽어 옛 값을 그대로 둔다 — 한 번 빨간 '중지'가
        //   박힌 거래처는 리더기를 안 켜는 한 영영 빨갛게 남는다(2026-08-13 신부산).
        if crate::chainremote_van::is_on() && crate::chainremote_van::current_ok().is_none() {
            body["vanOk"] = serde_json::Value::Null;
            body["vanGaveUp"] = false.into();
            body["vanMissing"] = false.into();
        }
        if let Some(ok) = crate::chainremote_van::current_ok() {
            body["vanOk"] = ok.into();
            body["vanGaveUp"] = crate::chainremote_van::gave_up().into();
            // 데몬 자체가 없는 경우(다른 VAN 거래처에 잘못 켬)는 리더기 고장과 조치가 달라
            // 따로 싣는다 — 패널이 "관제를 끄세요"라고 안내할 수 있게.
            body["vanMissing"] = crate::chainremote_van::not_installed().into();
        }
        let restarted = crate::chainremote_van::peek_restarted();
        if restarted {
            body["vanRestarted"] = true.into();
        }
        restarted
    } else {
        false
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()?;
    let resp = client
        .post(HEARTBEAT_URL)
        .header("Content-Type", "application/json")
        .header("X-ChainRemote-Token", token)
        .body(body.to_string())
        .send()?;
    let status = resp.status();
    if status.is_success() {
        // 응답에 [디스크 정리] 요청 + 방화벽 관제 플래그가 실려온다:
        //   {"ok":true,"cleanup":"<ISO>","firewallControl":true}.
        #[derive(serde::Deserialize, Default)]
        struct Resp {
            #[serde(default)]
            cleanup: String,
            #[serde(default, rename = "firewallControl")]
            firewall_control: bool,
            #[serde(default, rename = "vanWatch")]
            van_watch: String,
            #[serde(default, rename = "supportName")]
            support_name: String,
            #[serde(default, rename = "upnpEnabled")]
            upnp_enabled: bool,
        }
        let parsed = resp.json::<Resp>().unwrap_or_default();
        // 방화벽 자동 해제 대상 여부를 감시 스레드에 반영.
        crate::chainremote_firewall::set_control(parsed.firewall_control);
        // VAN 데몬 관제 종류("ksnet" 등, 빈 값이면 off)를 감시 스레드에 반영.
        crate::chainremote_van::set_kind(&parsed.van_watch);
        // 공유기 포트 열기(041) — 켜진 거래처만 문을 연다. 기본은 꺼짐이라 대부분 no-op.
        crate::chainremote_upnp::set_enabled(parsed.upnp_enabled);
        // 대리점 상호 캐시. 값이 실제로 달라졌을 때만 쓴다 — 매 하트비트마다 같은 값을
        // 디스크에 다시 쓸 이유가 없다. 서버가 안 내려주면(구버전) 옛 값을 그대로 둔다.
        #[cfg(windows)]
        if !parsed.support_name.is_empty() && read_support_name() != parsed.support_name {
            let path = support_name_path();
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            match std::fs::write(&path, parsed.support_name.as_bytes()) {
                Ok(_) => log::info!(
                    "[chainremote_heartbeat] support name cached -> {}",
                    parsed.support_name
                ),
                Err(e) => log::warn!("[chainremote_heartbeat] support name write failed: {}", e),
            }
        }
        // 방화벽 자동 해제 보고가 성공적으로 서버에 닿았으면 pending 플래그를 지운다.
        if report_firewall_disarm {
            crate::chainremote_firewall::clear_disarmed();
        }
        if report_van_restart {
            crate::chainremote_van::clear_restarted();
        }
        let cleanup = (!parsed.cleanup.is_empty()).then_some(parsed.cleanup);
        return Ok(BeatOutcome::Ok(cleanup));
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Ok(BeatOutcome::AuthRejected);
    }
    bail!("heartbeat HTTP {}", status);
}

/// 서버 [디스크 정리] 명령 처리 — 같은 요청(시각)은 한 번만 실행하고(dedupe), 결과를
/// 즉시 heartbeat 로 보고해 패널이 바로 갱신되게 한다. 보고가 유실되면 서버 큐가 남아
/// 다음 tick 에 같은 요청이 또 내려오는데, 그땐 실행 없이 저장해둔 결과만 재전송한다.
fn handle_cleanup_request(remote_id: &str, token: &str, requested_at: &str) {
    let done = hbb_common::config::LocalConfig::get_option(CLEANUP_DONE_KEY);
    if done == requested_at {
        // 이미 처리한 요청 — 결과 보고가 서버에 못 닿은 경우만 여기 온다. 재전송으로 해소.
        let last = hbb_common::config::LocalConfig::get_option(CLEANUP_RESULT_KEY);
        if !last.is_empty() {
            let _ = send_heartbeat(remote_id, token, crate::CHAINREMOTE_VERSION, Some(&last));
        }
        return;
    }
    log::info!(
        "[chainremote_heartbeat] disk cleanup requested (at={}) → run",
        requested_at
    );
    // 수동(사람이 버튼) = 휴지통까지 비움. 자동과 달리 명시적 의사표시가 있어서다.
    let (freed, deleted, skipped) = run_disk_cleanup(true);
    remeasure_temp_now();
    let result = serde_json::json!({
        "freedBytes": freed,
        "deleted": deleted,
        "skipped": skipped,
        "at": chrono::Utc::now().to_rfc3339(),
    })
    .to_string();
    hbb_common::config::LocalConfig::set_option(
        CLEANUP_DONE_KEY.to_string(),
        requested_at.to_string(),
    );
    hbb_common::config::LocalConfig::set_option(CLEANUP_RESULT_KEY.to_string(), result.clone());
    log::info!(
        "[chainremote_heartbeat] cleanup done: freed={}B deleted={} skipped={}",
        freed,
        deleted,
        skipped
    );
    if let Err(e) = send_heartbeat(remote_id, token, crate::CHAINREMOTE_VERSION, Some(&result)) {
        // 다음 tick 의 dedupe 경로가 저장된 결과를 재전송한다.
        log::warn!("[chainremote_heartbeat] cleanup result report failed: {}", e);
    }
}

/// 자동 Temp 정리 — 여유가 임계(5GB) 밑이면 명령 없이 스스로 비운다(하루 1회).
/// ★휴지통은 안 건드림(수동 버튼 전용). 결과는 auto 플래그를 달아 즉시 보고 —
/// 패널 칩 툴팁에 "자동 정리 N GB 확보"로 뜬다.
fn maybe_auto_cleanup(remote_id: &str, token: &str) {
    let Some((_total, free)) = read_disk_info() else {
        return;
    };
    if free >= AUTO_CLEAN_THRESHOLD {
        return;
    }
    let now = match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(_) => return,
    };
    let last: u64 = hbb_common::config::LocalConfig::get_option(AUTOCLEAN_AT_KEY)
        .parse()
        .unwrap_or(0);
    if now.saturating_sub(last) < AUTO_CLEAN_MIN_INTERVAL_SECS {
        return;
    }
    // 실행 전에 시각부터 박는다 — 정리 중 크래시해도 24시간 내 재돌입(폭주) 방지.
    hbb_common::config::LocalConfig::set_option(AUTOCLEAN_AT_KEY.to_string(), now.to_string());
    log::info!(
        "[chainremote_heartbeat] auto cleanup: free={}B < {}B → run (temp only)",
        free,
        AUTO_CLEAN_THRESHOLD
    );
    let (freed, deleted, skipped) = run_disk_cleanup(false);
    remeasure_temp_now();
    let result = serde_json::json!({
        "freedBytes": freed,
        "deleted": deleted,
        "skipped": skipped,
        "at": chrono::Utc::now().to_rfc3339(),
        "auto": true,
    })
    .to_string();
    hbb_common::config::LocalConfig::set_option(CLEANUP_RESULT_KEY.to_string(), result.clone());
    log::info!(
        "[chainremote_heartbeat] auto cleanup done: freed={}B deleted={} skipped={}",
        freed,
        deleted,
        skipped
    );
    let _ = send_heartbeat(remote_id, token, crate::CHAINREMOTE_VERSION, Some(&result));
}

/// C드라이브 전체/여유 용량 (bytes). 실패하면 None — heartbeat 는 그대로 나간다.
#[cfg(windows)]
fn read_disk_info() -> Option<(u64, u64)> {
    use std::os::windows::ffi::OsStrExt;
    let root: Vec<u16> = std::ffi::OsStr::new("C:\\")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut caller_free: u64 = 0;
    let mut total: u64 = 0;
    let mut free: u64 = 0;
    let ok = unsafe {
        winapi::um::fileapi::GetDiskFreeSpaceExW(
            root.as_ptr(),
            &mut caller_free as *mut u64 as _,
            &mut total as *mut u64 as _,
            &mut free as *mut u64 as _,
        )
    };
    if ok != 0 && total > 0 {
        Some((total, free))
    } else {
        None
    }
}
#[cfg(not(windows))]
fn read_disk_info() -> Option<(u64, u64)> {
    None
}

/// 정리 대상 Temp 폴더들 — 모든 사용자 프로필의 Local\Temp + C:\Windows\Temp.
/// 서비스(LocalSystem)라 전 프로필 접근 가능.
#[cfg(windows)]
fn temp_dirs() -> Vec<std::path::PathBuf> {
    let mut v = Vec::new();
    if let Ok(rd) = std::fs::read_dir("C:\\Users") {
        for e in rd.flatten() {
            let p = e.path().join("AppData\\Local\\Temp");
            if p.is_dir() {
                v.push(p);
            }
        }
    }
    let win_temp = std::path::PathBuf::from("C:\\Windows\\Temp");
    if win_temp.is_dir() {
        v.push(win_temp);
    }
    v
}

#[cfg(windows)]
fn dir_size(dir: &std::path::Path, depth: u32) -> u64 {
    if depth > 16 {
        return 0;
    }
    let mut sum = 0u64;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if let Ok(md) = e.metadata() {
                if md.is_dir() {
                    sum += dir_size(&e.path(), depth + 1);
                } else {
                    sum += md.len();
                }
            }
        }
    }
    sum
}

/// Temp 실측 캐시 — 평시엔 6시간에 한 번만 순회(수만 파일 폴더를 10분마다 돌리면
/// 저사양 포스에 부담). 정리 직후엔 remeasure_temp_now 가 즉시 갱신해 "정리했는데
/// Temp 숫자가 그대로" 혼동(2026-07-16 기겸컴 실검증에서 발견)을 없앤다.
#[cfg(windows)]
static TEMP_MEASURED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
#[cfg(windows)]
static TEMP_MEASURED_VAL: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(u64::MAX);

/// Temp 실측(원인 표시용) — 여유가 20GB 미만일 때만, 6시간에 한 번(캐시는 위 참조).
#[cfg(windows)]
fn measured_temp_bytes(disk_free: u64) -> Option<u64> {
    use std::sync::atomic::Ordering;
    const LOW_BYTES: u64 = 20 * 1024 * 1024 * 1024;
    const REMEASURE_SECS: u64 = 6 * 3600;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let last = TEMP_MEASURED_AT.load(Ordering::Relaxed);
    if disk_free < LOW_BYTES && (last == 0 || now.saturating_sub(last) >= REMEASURE_SECS) {
        return Some(remeasure_temp_now());
    }
    let v = TEMP_MEASURED_VAL.load(Ordering::Relaxed);
    (v != u64::MAX).then_some(v)
}
#[cfg(not(windows))]
fn measured_temp_bytes(_disk_free: u64) -> Option<u64> {
    None
}

/// Temp 즉시 재측정 + 캐시 갱신. 정리 직후 호출 — 방금 비운 폴더라 순회 비용이 거의 0이고,
/// 곧바로 나가는 결과 heartbeat 에 신선한(≈0) Temp 가 실린다.
#[cfg(windows)]
fn remeasure_temp_now() -> u64 {
    use std::sync::atomic::Ordering;
    let total: u64 = temp_dirs().iter().map(|d| dir_size(d, 0)).sum();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    TEMP_MEASURED_AT.store(now, Ordering::Relaxed);
    TEMP_MEASURED_VAL.store(total, Ordering::Relaxed);
    total
}
#[cfg(not(windows))]
fn remeasure_temp_now() -> u64 {
    0
}

/// 용량을 먹는 폴더 상위 목록 — **재기만 하고 아무것도 지우지 않는다.**
///
/// 왜 필요한가: 지금 정리 대상은 Temp + 휴지통뿐인데, 정작 요즘 포스가 차는 이유는
/// 배달 주문 접수·배달대행 앱들이다(Chang 현장 관찰 2026-08-14). 이들 대부분이 브라우저
/// 엔진을 통째로 안고 있어 앱 하나가 수백 MB 고, 자동 업데이트가 델타가 아니라 새 버전을
/// 통째로 받아 `%LOCALAPPDATA%\<앱>\app-1.2.3` 식으로 옛 버전 폴더를 남긴다. 그 자리는
/// 우리가 안 건드리므로 "정리했는데 여유가 그대로"가 된다 — 위 AUTO_CLEAN_MIN_INTERVAL_SECS
/// 주석의 "Temp 를 비워도 5GB 를 못 넘기는 기기(원인이 딴 데)"가 바로 이것으로 보인다.
///
/// ★그렇다고 짐작으로 지우면 앱이 깨진다. 무엇을 지워도 되는지 정하려면 실측이 먼저다.
/// 그래서 이 함수는 보고만 한다. 데이터가 쌓이면 그때 정리 대상을 정한다.
///
/// 절제: Temp 실측과 같은 규칙 — 여유가 부족할 때만, 6시간에 한 번.
/// ★깊이는 제한하지 않는다. 얕게 훑으면 캐시·옛 버전 폴더가 빠져 **작게 나오고**, 그러면
/// 진짜 범인을 엉뚱한 폴더로 지목하게 된다. 틀린 숫자는 없느니만 못하다. 비용은 위 두
/// 게이트로 잡는다(Temp 실측도 같은 이유로 depth 0 = 전체 순회다).
#[cfg(windows)]
fn measured_top_dirs(disk_free: u64) -> Option<Vec<(String, u64)>> {
    use std::sync::atomic::Ordering;
    const LOW_BYTES: u64 = 20 * 1024 * 1024 * 1024;
    const REMEASURE_SECS: u64 = 6 * 3600;
    const TOP_N: usize = 8;
    // 이보다 작은 폴더는 보고해 봐야 노이즈다.
    const MIN_REPORT_BYTES: u64 = 200 * 1024 * 1024;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    let last = TOPDIRS_MEASURED_AT.load(Ordering::Relaxed);
    if disk_free >= LOW_BYTES || (last != 0 && now.saturating_sub(last) < REMEASURE_SECS) {
        return None;
    }
    TOPDIRS_MEASURED_AT.store(now, Ordering::Relaxed);

    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(rd) = std::fs::read_dir("C:\\Users") {
        for e in rd.flatten() {
            for sub in ["AppData\\Local", "AppData\\Roaming"] {
                let p = e.path().join(sub);
                if p.is_dir() {
                    roots.push(p);
                }
            }
        }
    }
    let pd = std::path::PathBuf::from("C:\\ProgramData");
    if pd.is_dir() {
        roots.push(pd);
    }

    let mut found: Vec<(String, u64)> = Vec::new();
    for root in roots {
        let Ok(rd) = std::fs::read_dir(&root) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            // Temp 는 이미 tempBytes 로 따로 보고한다 — 두 번 세지 않는다.
            if p.file_name().map(|n| n.eq_ignore_ascii_case("Temp")) == Some(true) {
                continue;
            }
            let sz = dir_size(&p, 0); // 전체 순회 — 얕게 재면 캐시가 빠져 범인을 놓친다
            if sz >= MIN_REPORT_BYTES {
                // 사용자명이 섞이지 않게 마지막 두 조각만 남긴다("Local\\메신저" 꼴).
                let label = p
                    .components()
                    .rev()
                    .take(2)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .map(|c| c.as_os_str().to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join("\\");
                found.push((label, sz));
            }
        }
    }
    found.sort_by(|a, b| b.1.cmp(&a.1));
    found.truncate(TOP_N);
    (!found.is_empty()).then_some(found)
}
#[cfg(not(windows))]
fn measured_top_dirs(_disk_free: u64) -> Option<Vec<(String, u64)>> {
    None
}

#[cfg(windows)]
static TOPDIRS_MEASURED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Temp(전 프로필 + 윈도우) 정리 + (include_recycle_bin 이면) 휴지통 비우기.
/// API 삭제라 휴지통을 안 거치는 영구 삭제이며(탐색기 Shift+Delete 와 동일), 최근 1시간
/// 내 수정 파일은 돌고 있는 앱 보호로 남기고, 잠긴(사용 중) 파일은 자동 스킵 —
/// 탐색기의 '다시 시도/건너뛰기' 창이 애초에 없다. 반환 = (확보 bytes, 삭제, 스킵).
/// 휴지통은 수동 [정리] 버튼에서만 true — 자동 정리는 Temp 만 건드린다.
#[cfg(windows)]
fn run_disk_cleanup(include_recycle_bin: bool) -> (u64, u64, u64) {
    let mut freed = 0u64;
    let mut deleted = 0u64;
    let mut skipped = 0u64;
    let cutoff = std::time::SystemTime::now() - Duration::from_secs(3600);
    for d in temp_dirs() {
        clean_dir(&d, cutoff, 0, &mut freed, &mut deleted, &mut skipped);
    }
    if include_recycle_bin {
        // 휴지통 — 비우기 전에 크기를 물어 확보량에 더한다('삭제→휴지통 적체' 잔재 회수).
        unsafe {
            use winapi::um::shellapi::{SHEmptyRecycleBinW, SHQueryRecycleBinW, SHQUERYRBINFO};
            let mut info: SHQUERYRBINFO = std::mem::zeroed();
            info.cbSize = std::mem::size_of::<SHQUERYRBINFO>() as u32;
            if SHQueryRecycleBinW(std::ptr::null(), &mut info) == 0 {
                freed += info.i64Size as u64;
                deleted += info.i64NumItems as u64;
            }
            // SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND
            SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), 0x1 | 0x2 | 0x4);
        }
    }
    (freed, deleted, skipped)
}

#[cfg(windows)]
fn clean_dir(
    dir: &std::path::Path,
    cutoff: std::time::SystemTime,
    depth: u32,
    freed: &mut u64,
    deleted: &mut u64,
    skipped: &mut u64,
) {
    if depth > 16 {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for e in rd.flatten() {
        let p = e.path();
        let md = match e.metadata() {
            Ok(md) => md,
            Err(_) => {
                *skipped += 1;
                continue;
            }
        };
        if md.is_dir() {
            clean_dir(&p, cutoff, depth + 1, freed, deleted, skipped);
            // 비었을 때만 성공 — 실패(내용 잔존) 무해.
            let _ = std::fs::remove_dir(&p);
        } else {
            // 최근 1시간 내 수정 파일은 돌고 있는 앱의 작업 파일일 수 있어 남긴다.
            if md.modified().map(|m| m >= cutoff).unwrap_or(true) {
                *skipped += 1;
                continue;
            }
            let len = md.len();
            match std::fs::remove_file(&p) {
                Ok(_) => {
                    *freed += len;
                    *deleted += 1;
                }
                Err(_) => *skipped += 1, // 사용 중(잠김) — 탐색기 '건너뛰기'와 동일
            }
        }
    }
}
#[cfg(not(windows))]
fn run_disk_cleanup(_include_recycle_bin: bool) -> (u64, u64, u64) {
    (0, 0, 0)
}
