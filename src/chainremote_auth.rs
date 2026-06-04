// ChainRemote 본사 앱 인증 — 관리 패널(/api/auth/token) Bearer JWT.
//
// 책임:
//   - 로그인 (email + password + device_id) → 토큰 + 사용자 정보를 **메모리(RAM)에만** 보관
//   - 좌석 enforcement (단일 동시세션): 점유 시 takeover, ~10초 heartbeat, 인계당함 감지
//   - 토큰/사용자 정보 조회 (Flutter UI 가 표시)
//   - 로그아웃 (좌석 best-effort 반납 + 메모리 자격증명 삭제)
//   - 관리 패널 API base URL 관리 (build-time 기본값 + LocalConfig override)
//
// 호출자: src/flutter_ffi.rs 의 chainremote_login/takeover/heartbeat/logout/get_user FFI 들.
//
// 보안 설계 (2026-05-22): 토큰을 디스크(LocalConfig)에 저장하지 않고 **프로세스
// 메모리 static 에만** 둔다. 앱 종료 시 토큰이 메모리째 증발 → 디스크 잔재 0.
//   - 매 실행마다 재로그인 (Chang·재성이 OK — 코이노식 매번 로그인에 익숙).
//   - 빌린 PC(피시방·거래처 포스)에서 써도 토큰이 디스크에 안 남음 = 보안.
//   - TTL 길이(패널 24h)는 보안과 무관해짐(앱 닫으면 어차피 죽음) → 하루 연속
//     사용 중 mid-session 만료(401) 방지용으로만 길게 둠.
//   - API base 만 LocalConfig 유지(자격증명 아닌 단순 설정).
//
// 좌석 enforcement (2026-06-04, 마이그레이션 010): 한 HQ 계정 = 동시 1세션.
//   상세 설계: docs/chainremote/SEAT_ENFORCEMENT.md

use hbb_common::{anyhow::anyhow, lazy_static, log, ResultType};
use hbb_common::config::LocalConfig;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

lazy_static::lazy_static! {
    // 인메모리 자격증명. 프로세스 생존 중에만 유효. 종료 시 소멸 → 디스크 잔재 없음.
    static ref TOKEN: RwLock<String> = RwLock::new(String::new());
    static ref USER_JSON: RwLock<String> = RwLock::new(String::new());
}

// NAS chainremote-admin 컨테이너. HTTPS(3443) — Synology 발급 유효 인증서.
// 외부: https://sepani.synology.me:3443 (라우터 포트포워딩 3443 → NAS HTTPS).
// 인터넷 어디서나 도달 (집/사무실/PC방 동일). Tailscale 불필요.
// 2026-06-02: 토큰/로그인 비번 평문 노출 제거 위해 HTTP(3001)→HTTPS(3443) 전환 (Codex 리뷰 반영).
// reqwest 기본 백엔드 = native-tls (Win=SChannel) 이라 옛 'rustls close_notify quirk' 무관
// (이전 주석의 HTTPS 불안정 근거는 rustls 기준 옛 설정이었음).
// HTTP(3001) 은 옛 에이전트(≤1.4.1) 호환용으로 당분간 살려둠 — 신빌드만 HTTPS.
// 사용자 정의: LocalConfig::set_option("chainremote-api-base", ...) 또는
//             설정 UI 의 "관리 패널 주소" 필드 (있을 시).
const DEFAULT_API_BASE: &str = "https://sepani.synology.me:3443";
const KEY_API_BASE: &str = "chainremote-api-base";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserInfo {
    pub id: String,
    pub email: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub role: String,
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    token: String,
    #[allow(dead_code)]
    #[serde(rename = "expiresIn")]
    expires_in: i64,
    user: UserInfo,
}

#[derive(Debug, Deserialize)]
struct ErrorResponse {
    error: String,
}

/// 로그인 결과 — 성공(토큰 발급됨) 또는 점유됨(다른 기기 사용 중, 토큰 없음).
/// 자격 실패/네트워크 오류는 ResultType 의 Err 로.
pub enum LoginOutcome {
    Success(UserInfo),
    /// 409 OCCUPIED — 다른 기기가 좌석 점유 중. Flutter 가 "강제 종료/취소" 모달 표시.
    Occupied {
        device_label: Option<String>,
        since: Option<String>,
    },
}

/// heartbeat 결과 — 유지 / 인계당함(즉시 종료) / 일시오류(세션 유지).
pub enum HeartbeatStatus {
    /// 200 — 좌석 유효, last_seen 갱신됨.
    Ok,
    /// 401 revoked — 다른 기기에 인계당함. 앱이 세션 끊고 로그아웃해야 함.
    Revoked,
    /// 네트워크 단기 끊김 / 비-revoked 오류 — 세션 유지(스펙 §7). 다음 tick 재시도.
    Error,
}

/// 관리 패널 API 의 base URL. LocalConfig 의 chainremote-api-base 가 있으면 사용,
/// 없으면 DEFAULT_API_BASE. trailing slash 제거해서 반환.
pub fn api_base() -> String {
    let v = LocalConfig::get_option(KEY_API_BASE);
    let base = if v.trim().is_empty() {
        DEFAULT_API_BASE.to_string()
    } else {
        v
    };
    base.trim_end_matches('/').to_string()
}

/// 사용자 정의 base URL 저장 (관리 패널 위치가 바뀌면 호출).
pub fn set_api_base(url: &str) {
    LocalConfig::set_option(KEY_API_BASE.to_string(), url.trim().to_string());
}

/// 메모리에 보관된 Bearer 토큰. 없으면 빈 문자열.
pub fn get_token() -> String {
    TOKEN.read().map(|t| t.clone()).unwrap_or_default()
}

/// 현재 로그인된 사용자 정보 (JSON — Flutter 가 동일 객체 디코딩). 메모리 보관.
pub fn get_user_json() -> String {
    USER_JSON.read().map(|u| u.clone()).unwrap_or_default()
}

/// 로그인 상태인지 (토큰 존재 여부만 — 만료/유효성은 서버가 401 로 알려줌).
pub fn is_authenticated() -> bool {
    !get_token().is_empty()
}

/// 좌석 best-effort 반납 + 메모리 자격증명 삭제.
///
/// 서버 logout(POST /api/auth/logout)은 **fire-and-forget**(spawn, join 안 함) — 앱
/// 종료/로그아웃 경로를 네트워크로 막지 않는다. 실패해도 orphan TTL(2분)이 좌석 회수.
pub fn logout() {
    let token = get_token();
    if !token.is_empty() {
        let base = api_base();
        std::thread::spawn(move || {
            let url = format!("{}/api/auth/logout", base);
            let header = format!(
                r#"{{"Authorization":"Bearer {}","Content-Type":"application/json"}}"#,
                token
            );
            let _ = crate::http_request_sync(url, "POST".into(), Some("{}".into()), header);
        });
    }
    if let Ok(mut t) = TOKEN.write() {
        t.clear();
    }
    if let Ok(mut u) = USER_JSON.write() {
        u.clear();
    }
}

/// 좌석 식별자 — device_id(machine_uid, RustDesk get_uuid 와 동일) + device_label(호스트명).
/// Rust 내부 계산 → Flutter 가 안 넘겨도 됨(dart:io 의존 회피, FFI 시그니처 단순).
fn device_info() -> (String, String) {
    let device_id = crate::encode64(hbb_common::get_uuid());
    let device_label = crate::common::hostname();
    (device_id, device_label)
}

/// 인증 HTTP POST → (status_code, body) 반환. http_request_sync 래퍼
/// ({"status_code":N,"headers":{},"body":"..."}) 파싱. bearer 있으면 Authorization 헤더.
fn post_json(
    path: &str,
    body: serde_json::Value,
    bearer: Option<&str>,
) -> ResultType<(u16, String)> {
    let url = format!("{}{}", api_base(), path);
    let header = match bearer {
        Some(t) => format!(
            r#"{{"Authorization":"Bearer {}","Content-Type":"application/json"}}"#,
            t
        ),
        None => r#"{"Content-Type":"application/json"}"#.to_string(),
    };
    let raw = crate::http_request_sync(url, "POST".into(), Some(body.to_string()), header)?;
    #[derive(Deserialize)]
    struct W {
        status_code: u16,
        body: String,
    }
    let w: W = serde_json::from_str(&raw).map_err(|e| anyhow!("응답 파싱 실패: {}", e))?;
    Ok((w.status_code, w.body))
}

/// 발급된 토큰·사용자를 메모리에 저장.
fn store(tok: &TokenResponse) -> ResultType<()> {
    let user_json = serde_json::to_string(&tok.user)?;
    if let Ok(mut t) = TOKEN.write() {
        *t = tok.token.clone();
    }
    if let Ok(mut u) = USER_JSON.write() {
        *u = user_json;
    }
    Ok(())
}

/// POST /api/auth/token { email, password, deviceId, deviceLabel }
///   200 → 토큰·사용자 저장 후 Success(UserInfo)
///   409 → Occupied { device_label, since } (토큰 발급 안 됨)
///   그 외 → Err(서버 한글 메시지 또는 네트워크 오류)
///
/// device_id(machine_uid) + device_label(호스트명)은 device_info() 가 내부 계산.
pub fn login(email: &str, password: &str) -> ResultType<LoginOutcome> {
    let (device_id, device_label) = device_info();
    let body = serde_json::json!({
        "email": email,
        "password": password,
        "deviceId": device_id,
        "deviceLabel": device_label,
    });
    let (status, resp_body) = post_json("/api/auth/token", body, None)?;

    if (200..300).contains(&status) {
        let tok: TokenResponse =
            serde_json::from_str(&resp_body).map_err(|e| anyhow!("응답 파싱 실패: {}", e))?;
        store(&tok)?;
        log::info!("ChainRemote 로그인 성공: {}", tok.user.email);
        return Ok(LoginOutcome::Success(tok.user));
    }
    if status == 409 {
        #[derive(Deserialize)]
        struct Occ {
            #[serde(rename = "deviceLabel")]
            device_label: Option<String>,
            since: Option<String>,
        }
        let occ: Occ = serde_json::from_str(&resp_body).unwrap_or(Occ {
            device_label: None,
            since: None,
        });
        log::info!("ChainRemote 로그인 점유됨(409): {}", email);
        return Ok(LoginOutcome::Occupied {
            device_label: occ.device_label,
            since: occ.since,
        });
    }
    // 401 등 — 서버가 준 한글 메시지 우선.
    if let Ok(err) = serde_json::from_str::<ErrorResponse>(&resp_body) {
        return Err(anyhow!("{}", err.error));
    }
    Err(anyhow!("로그인 실패 (status {})", status))
}

/// POST /api/auth/takeover — "강제 종료하고 사용". 자격 재검증 → 좌석 덮어쓰기 →
/// 새 토큰 발급. 옛 기기의 토큰(jti)은 이 순간 무효 → 옛 기기 다음 heartbeat 가 REVOKED.
pub fn takeover(email: &str, password: &str) -> ResultType<UserInfo> {
    let (device_id, device_label) = device_info();
    let body = serde_json::json!({
        "email": email,
        "password": password,
        "deviceId": device_id,
        "deviceLabel": device_label,
    });
    let (status, resp_body) = post_json("/api/auth/takeover", body, None)?;
    if (200..300).contains(&status) {
        let tok: TokenResponse =
            serde_json::from_str(&resp_body).map_err(|e| anyhow!("응답 파싱 실패: {}", e))?;
        store(&tok)?;
        log::info!("ChainRemote 좌석 인계 성공: {}", tok.user.email);
        return Ok(tok.user);
    }
    if let Ok(err) = serde_json::from_str::<ErrorResponse>(&resp_body) {
        return Err(anyhow!("{}", err.error));
    }
    Err(anyhow!("인계 실패 (status {})", status))
}

/// POST /api/auth/heartbeat (Bearer) — ~10초 주기. 좌석 유효성 확인.
///   200 → Ok (last_seen 갱신됨)
///   401 + {"revoked":true} → Revoked (인계당함 — 앱이 세션 끊고 로그아웃)
///   네트워크 끊김 / 비-revoked 오류 → Error (세션 유지, 스펙 §7)
pub fn heartbeat() -> HeartbeatStatus {
    let token = get_token();
    if token.is_empty() {
        return HeartbeatStatus::Error;
    }
    let (status, body) = match post_json("/api/auth/heartbeat", serde_json::json!({}), Some(&token)) {
        Ok(v) => v,
        // 네트워크 단기 끊김 — 세션 유지(§7). 다음 tick 재시도.
        Err(_) => return HeartbeatStatus::Error,
    };
    if (200..300).contains(&status) {
        return HeartbeatStatus::Ok;
    }
    if status == 401 {
        // revoked 플래그가 명시된 경우만 인계당함으로 처리. 단순 토큰만료(검증 실패)는
        // Error(세션 유지) — 모호한 401 로 사용자를 쫓아내지 않음.
        #[derive(Deserialize)]
        struct R {
            #[serde(default)]
            revoked: bool,
        }
        if let Ok(r) = serde_json::from_str::<R>(&body) {
            if r.revoked {
                return HeartbeatStatus::Revoked;
            }
        }
    }
    HeartbeatStatus::Error
}

/// POST /api/me/password { currentPassword, newPassword } → 본인 비번 변경.
///
/// Bearer 헤더 필요 → `http_request_sync` 사용 (헤더 JSON object 형식, 응답 wrapper).
/// 함정 10 (CLAUDE.md) — `post_request_sync` 와 다르니 주의.
pub fn change_password(current: &str, new: &str) -> ResultType<()> {
    let token = get_token();
    if token.is_empty() {
        return Err(anyhow!("로그인 안 됨"));
    }
    let url = format!("{}/api/me/password", api_base());
    let body = serde_json::json!({
        "currentPassword": current,
        "newPassword": new,
    })
    .to_string();
    let header = format!(
        r#"{{"Authorization":"Bearer {}","Content-Type":"application/json"}}"#,
        token
    );
    let raw = crate::http_request_sync(url, "POST".into(), Some(body), header)?;

    // wrapper: {"status_code":N, "headers":{...}, "body":"<body string>"}
    #[derive(Deserialize)]
    struct HttpWrapper {
        status_code: u16,
        body: String,
    }
    let w: HttpWrapper = serde_json::from_str(&raw)
        .map_err(|e| anyhow!("응답 파싱 실패: {}", e))?;

    if (200..300).contains(&w.status_code) {
        return Ok(());
    }
    // 1순위: 서버가 한글 메시지 줬으면 그대로 (예: "현재 비밀번호 불일치")
    if let Ok(err) = serde_json::from_str::<ErrorResponse>(&w.body) {
        return Err(anyhow!("{}", err.error));
    }
    // 2순위: HTML/raw 응답은 status_code 기반 단순 메시지 (사용자에게 HTML
    // 덤프 보여주지 않기 — 404 시 NAS 패널 미배포 등 운영 이슈 분리)
    let msg = match w.status_code {
        400 => "비밀번호 형식이 올바르지 않습니다",
        401 | 403 => "현재 비밀번호가 일치하지 않습니다",
        404 => "서버 업데이트가 필요합니다 (관리자에게 문의)",
        500..=599 => "서버 오류가 발생했습니다",
        _ => "비밀번호 변경 실패",
    };
    Err(anyhow!("{}", msg))
}
