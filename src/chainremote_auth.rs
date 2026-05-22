// ChainRemote 본사 앱 인증 — 관리 패널(/api/auth/token) Bearer JWT.
//
// 책임:
//   - 로그인 (email + password) → 토큰 + 사용자 정보를 **메모리(RAM)에만** 보관
//   - 토큰/사용자 정보 조회 (Flutter UI 가 표시)
//   - 로그아웃 (메모리 자격증명 삭제)
//   - 관리 패널 API base URL 관리 (build-time 기본값 + LocalConfig override)
//
// 호출자: src/flutter_ffi.rs 의 chainremote_login/logout/get_user FFI 들.
//
// 보안 설계 (2026-05-22): 토큰을 디스크(LocalConfig)에 저장하지 않고 **프로세스
// 메모리 static 에만** 둔다. 앱 종료 시 토큰이 메모리째 증발 → 디스크 잔재 0.
//   - 매 실행마다 재로그인 (Chang·재성이 OK — 코이노식 매번 로그인에 익숙).
//   - 빌린 PC(피시방·거래처 포스)에서 써도 토큰이 디스크에 안 남음 = 보안.
//   - TTL 길이(패널 24h)는 보안과 무관해짐(앱 닫으면 어차피 죽음) → 하루 연속
//     사용 중 mid-session 만료(401) 방지용으로만 길게 둠.
//   - API base 만 LocalConfig 유지(자격증명 아닌 단순 설정).

use hbb_common::{anyhow::anyhow, lazy_static, log, ResultType};
use hbb_common::config::LocalConfig;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

lazy_static::lazy_static! {
    // 인메모리 자격증명. 프로세스 생존 중에만 유효. 종료 시 소멸 → 디스크 잔재 없음.
    static ref TOKEN: RwLock<String> = RwLock::new(String::new());
    static ref USER_JSON: RwLock<String> = RwLock::new(String::new());
}

// NAS chainremote-admin 컨테이너 (port 3001 직접 노출).
// 외부: http://sepani.synology.me:3001 (라우터 포트포워딩 3001 → 192.168.68.103:3001).
// 인터넷 어디서나 도달 (집/사무실/PC방 모두 같음). Tailscale 불필요.
// HTTPS X — RustDesk core 의 reqwest/rustls 가 Synology nginx Reverse Proxy 와
// TLS 호환 불안정 (close_notify 누락 quirk). HTTP 직노출이 안정적이고 Chang 의
// 보안 의지 (비중 낮음 + UX 우선) 와 일치. 비번 평문 전송이지만 코이노/AnySupport
// 도 같은 수준이라 사업적 격차 없음.
// 사용자 정의: LocalConfig::set_option("chainremote-api-base", ...) 또는
//             설정 UI 의 "관리 패널 주소" 필드 (있을 시).
const DEFAULT_API_BASE: &str = "http://sepani.synology.me:3001";
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

/// 메모리 자격증명 삭제.
pub fn logout() {
    if let Ok(mut t) = TOKEN.write() {
        t.clear();
    }
    if let Ok(mut u) = USER_JSON.write() {
        u.clear();
    }
}

/// POST /api/auth/token → 성공 시 토큰·사용자 정보 저장 후 UserInfo 반환.
/// 실패 시 Err(서버가 준 한글 메시지 또는 네트워크 오류).
pub fn login(email: &str, password: &str) -> ResultType<UserInfo> {
    let url = format!("{}/api/auth/token", api_base());
    let body = serde_json::json!({ "email": email, "password": password }).to_string();
    // post_request_ 는 헤더 형식이 "name: value" 단순 split — JSON 아님.
    // Content-Type 은 post_request_ 가 자동으로 application/json 박으므로 헤더 자체 불필요.
    let resp_text = crate::post_request_sync(url, body, "")?;

    // 200: TokenResponse / 4xx,5xx: ErrorResponse — 둘 다 JSON.
    if let Ok(tok) = serde_json::from_str::<TokenResponse>(&resp_text) {
        let user_json = serde_json::to_string(&tok.user)?;
        if let Ok(mut t) = TOKEN.write() {
            *t = tok.token;
        }
        if let Ok(mut u) = USER_JSON.write() {
            *u = user_json;
        }
        log::info!("ChainRemote 로그인 성공: {}", tok.user.email);
        return Ok(tok.user);
    }
    if let Ok(err) = serde_json::from_str::<ErrorResponse>(&resp_text) {
        return Err(anyhow!("{}", err.error));
    }
    Err(anyhow!("응답 파싱 실패: {}", resp_text))
}
