// 본사 앱 인증 — 관리 패널(/api/auth/token)의 Bearer JWT.
// 로그인/takeover/heartbeat/logout, 토큰·사용자 정보 조회, API base URL 관리.
// 호출자는 flutter_ffi.rs 의 chainremote_* FFI 들.
//
// 토큰은 디스크에 안 남긴다(2026-05-22). LocalConfig 대신 프로세스 메모리 static 에만
// 둬서 앱 종료 시 통째로 증발 — 빌린 PC(피시방·거래처 포스)에 잔재가 안 남는다.
// 대가는 매 실행 재로그인인데 Chang·재성이 둘 다 코이노식에 익숙해서 문제없음.
// 패널 TTL 24h 는 보안이랑 무관(앱 닫으면 어차피 죽음) — 하루 연속 사용 중
// mid-session 만료(401) 안 나게 넉넉히 둔 것뿐. LocalConfig 에 남기는 건 API base
// 하나뿐(자격증명 아닌 설정).
//
// 좌석 enforcement(2026-06-04, 마이그 010): HQ 계정당 동시 1세션. 점유 시 takeover,
// ~10초 heartbeat 로 유지, 인계당하면 감지. 상세는 docs/chainremote/SEAT_ENFORCEMENT.md.

use hbb_common::{anyhow::anyhow, lazy_static, log, ResultType};
use hbb_common::config::LocalConfig;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

lazy_static::lazy_static! {
    // 인메모리 자격증명 — 프로세스 살아있는 동안만.
    static ref TOKEN: RwLock<String> = RwLock::new(String::new());
    static ref USER_JSON: RwLock<String> = RwLock::new(String::new());
}

// NAS chainremote-admin 컨테이너. HTTPS(3443) = Synology 발급 유효 인증서, 라우터
// 포트포워딩으로 인터넷 어디서나 도달(Tailscale 불필요).
// 2026-06-02 HTTP(3001)→HTTPS 전환: 토큰/비번 평문 노출 제거(Codex 리뷰). reqwest 기본
// 백엔드가 native-tls(Win=SChannel)라 옛 'rustls close_notify quirk' 는 애초에 남 얘기다
// — 예전 주석의 HTTPS 불안정 근거는 rustls 기준 옛 설정이었음.
// HTTP(3001)은 옛 에이전트(≤1.4.1) 호환용으로 당분간만 살려둠 — 신빌드는 HTTPS 만.
// override: LocalConfig "chainremote-api-base" 또는 설정 UI 의 "관리 패널 주소" 필드.
const DEFAULT_API_BASE: &str = "https://api.626.kr";
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
    /// 설정 → 정보 화면의 이스터에그 문구. 대리점별로 패널 DB 에 있고, 안 채운 대리점
    /// (대다수)은 서버가 아예 안 실어 보낸다 — 그러면 HQ 에서 그 기능이 없는 것처럼 된다.
    /// 코드에 문구를 박지 않는 이유: HQ 는 빌드가 한 벌이라 전 대리점에 다 보이고,
    /// 이 저장소는 AGPL 공개 소스다.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub greeting: Option<String>,
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

/// 로그인 결과. 자격 실패/네트워크 오류는 ResultType 의 Err 로 따로 뺀다.
pub enum LoginOutcome {
    Success(UserInfo),
    /// 409 — 다른 기기가 좌석 점유 중. Flutter 가 "강제 종료/취소" 모달 표시.
    Occupied {
        device_label: Option<String>,
        since: Option<String>,
    },
}

/// heartbeat 결과 — 유지 / 인계당함(즉시 종료) / 만료(재로그인 안내) / 일시오류(세션 유지).
pub enum HeartbeatStatus {
    Ok,
    /// 401 revoked — 다른 기기에 인계당함. 세션 끊고 로그아웃.
    Revoked,
    /// 비-revoked 401 이 연속(≥3) — 토큰 만료/무효. 재로그인 화면으로 안내(원격 세션은 유지).
    /// ★종전엔 이 경우를 Error(무한 재시도)로 삼켜 "좀비 로그인"이 됐다(2026-07-20 실사고:
    ///   만료 후 3일간 목록 갱신·지원기록이 전부 무음 실패, 화면은 캐시라 멀쩡해 보임).
    Expired,
    /// 네트워크 블립이나 비-revoked 일회성 오류 — 세션 유지(스펙 §7), 다음 tick 재시도.
    Error,
}

/// 비-revoked 401 연속 카운터 — 일시 오류와 진짜 만료를 가른다(3연속 = 만료 판정).
static EXPIRED_STREAK: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

/// 관리 패널 API base URL. LocalConfig override 없으면 DEFAULT_API_BASE. trailing slash 제거.
pub fn api_base() -> String {
    let v = LocalConfig::get_option(KEY_API_BASE);
    let base = if v.trim().is_empty() {
        DEFAULT_API_BASE.to_string()
    } else {
        v
    };
    base.trim_end_matches('/').to_string()
}

/// base URL override 저장 (패널 위치가 바뀌면 호출).
pub fn set_api_base(url: &str) {
    LocalConfig::set_option(KEY_API_BASE.to_string(), url.trim().to_string());
}

/// 메모리의 Bearer 토큰. 없으면 빈 문자열.
pub fn get_token() -> String {
    TOKEN.read().map(|t| t.clone()).unwrap_or_default()
}

/// 로그인 사용자 정보(JSON — Flutter 가 그대로 디코딩).
pub fn get_user_json() -> String {
    USER_JSON.read().map(|u| u.clone()).unwrap_or_default()
}

/// 토큰 존재 여부만 본다 — 만료/유효성은 서버가 401 로 알려준다.
pub fn is_authenticated() -> bool {
    !get_token().is_empty()
}

/// 좌석 best-effort 반납 + 메모리 자격증명 삭제.
/// 서버 logout 은 fire-and-forget(spawn, join 안 함) — 종료 경로를 네트워크로 막지 않는다.
/// 요청이 실패해도 orphan TTL(2분)이 좌석을 회수하므로 손해 없음.
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

/// 좌석 식별자 — device_id(machine_uid = get_uuid) + device_label(호스트명).
/// Rust 에서 계산해 Flutter 가 안 넘겨도 되게 한다(dart:io 의존 회피, FFI 단순).
fn device_info() -> (String, String) {
    // iOS/Android 는 machine_uid 가 없어 get_uuid 가 빈값일 수 있다(데스크탑은 안 빔).
    // deviceId 가 비면 좌석 토큰 API 가 "deviceId 필요"로 거부하므로, 안정적 per-install
    // 식별자(remote_id)로 대체.
    let mut uuid = hbb_common::get_uuid();
    if uuid.is_empty() {
        uuid = hbb_common::config::Config::get_id().into_bytes();
    }
    let device_id = crate::encode64(uuid);
    let device_label = crate::common::hostname();
    (device_id, device_label)
}

/// 인증 POST → (status_code, body). http_request_sync 의 wrapper 를 풀어서 돌려준다.
/// bearer 주면 Authorization 헤더 부착.
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

/// POST /api/auth/token. 200 → 저장 후 Success, 409 → Occupied(토큰 없음),
/// 그 외 → Err(서버 한글 메시지 우선). deviceId/deviceLabel 은 device_info() 가 채운다.
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

/// POST /api/auth/takeover — "강제 종료하고 사용". 자격 재검증 후 좌석 덮어쓰고 새 토큰 발급.
/// 옛 기기 토큰(jti)은 이 순간 무효 → 옛 기기 다음 heartbeat 가 Revoked 로 떨어진다.
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

/// POST /api/auth/heartbeat (Bearer) — ~10초 주기 좌석 유효성 확인.
/// 200 → Ok, 401+{"revoked":true} → Revoked, 그 외/네트워크 오류 → Error(세션 유지, §7).
pub fn heartbeat() -> HeartbeatStatus {
    let token = get_token();
    if token.is_empty() {
        return HeartbeatStatus::Error;
    }
    // HQ 앱 버전을 얹어 보고 → 패널이 직원별 버전/생존을 가시화(users.last_version).
    // 라우트가 version 을 옵셔널 처리하므로 빈 바디 보내던 옛 클라와도 호환.
    let (status, body) = match post_json(
        "/api/auth/heartbeat",
        serde_json::json!({ "version": crate::CHAINREMOTE_VERSION }),
        Some(&token),
    ) {
        Ok(v) => v,
        // 네트워크 블립 — 세션 유지(§7), 다음 tick 재시도.
        Err(_) => return HeartbeatStatus::Error,
    };
    if (200..300).contains(&status) {
        EXPIRED_STREAK.store(0, std::sync::atomic::Ordering::Relaxed);
        // 롤링 재발급 수신 — 서버가 수명 절반부터 새 토큰을 실어 보낸다(좀비 로그인 봉인).
        // 갈아끼우면 앱이 살아있는 한 만료가 오지 않는다.
        #[derive(Deserialize)]
        struct OkBody {
            #[serde(default)]
            token: String,
        }
        if let Ok(r) = serde_json::from_str::<OkBody>(&body) {
            if !r.token.is_empty() {
                if let Ok(mut t) = TOKEN.write() {
                    *t = r.token;
                }
            }
        }
        return HeartbeatStatus::Ok;
    }
    if status == 401 {
        // revoked 플래그가 명시된 401 = 인계당함(즉시). 그 외 401(만료/검증실패)은 한두 번은
        // 봐주되(프록시 순간 오류 대비) 3연속이면 만료로 확정 — 무한 재시도 좀비 금지.
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
        let streak = EXPIRED_STREAK.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
        if streak >= 3 {
            return HeartbeatStatus::Expired;
        }
    }
    HeartbeatStatus::Error
}

/// POST /api/me/password → 본인 비번 변경.
/// Bearer 가 필요해서 `post_request_sync` 가 아니라 `http_request_sync`(헤더 JSON object +
/// 응답 wrapper)를 쓴다 — 함정 10(CLAUDE.md). 둘을 헷갈리면 헤더가 안 박힌다.
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
    // 서버 한글 메시지 있으면 그대로(예: "현재 비밀번호 불일치").
    if let Ok(err) = serde_json::from_str::<ErrorResponse>(&w.body) {
        return Err(anyhow!("{}", err.error));
    }
    // 없으면 status 기반 메시지 — 사용자에게 HTML 덤프를 보여주지 않으려는 것.
    // 404 는 NAS 패널 미배포 같은 운영 이슈라 별도 문구.
    let msg = match w.status_code {
        400 => "비밀번호 형식이 올바르지 않습니다",
        401 | 403 => "현재 비밀번호가 일치하지 않습니다",
        404 => "서버 업데이트가 필요합니다 (관리자에게 문의)",
        500..=599 => "서버 오류가 발생했습니다",
        _ => "비밀번호 변경 실패",
    };
    Err(anyhow!("{}", msg))
}
