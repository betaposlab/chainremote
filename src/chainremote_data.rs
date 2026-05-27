// ChainRemote 본사 앱 데이터 fetcher — 관리 패널 DB 가 진실 원천.
//
// 책임:
//   - 거래처 목록: GET /api/customers → "load_recent_peers" 이벤트
//   - 즐겨찾기 목록: GET /api/me/favorites → "load_fav_peers" 이벤트
//   - 즐겨찾기 추가/제거: POST/DELETE /api/me/favorites/...
//   - remote_id (RustDesk 9자리) ↔ customer UUID (DB) 매핑 캐시
//
// 인증: chainremote_auth::get_token() 의 Bearer JWT.
// 응답 wrapper: common.rs 의 http_request_sync 는 raw 를 {"body":"<json>"} 로 감싸므로
//              HttpWrapper 로 한 번 풀고 두번째 from_str.

use std::collections::HashMap;
use std::sync::Mutex;

use hbb_common::log;
use serde::Deserialize;

use crate::chainremote_auth;

/// 관리 패널의 customers 행 형태 (필요한 필드만).
#[derive(Debug, Deserialize)]
struct CustomerRow {
    id: String,
    #[serde(rename = "remoteId")]
    remote_id: Option<String>,
    name: String,
    #[serde(rename = "contactName")]
    contact_name: Option<String>,
    address: Option<String>,
    notes: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FavoriteRow {
    // 2026-05-27 개편: remote_id 가 primary, customer 는 orphan(customers 미등록 머신)일 때 None.
    #[serde(rename = "remoteId")]
    remote_id: String,
    customer: Option<CustomerRow>,
}

#[derive(Debug, Deserialize)]
struct FavoritesResponse {
    favorites: Vec<FavoriteRow>,
}

// (remote_id → customer UUID) 매핑. 즐겨찾기 토글에 필요.
// 캐시는 chainremote_load_customers / chainremote_load_favorites 호출 시 갱신.
static REMOTE_TO_UUID: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

// 내가 즐겨찾기한 customer UUID 집합 — UI 가 동기로 빠르게 fav 상태 표시.
// chainremote_load_favorites 호출 시 갱신.
static MY_FAV_REMOTE_IDS: Mutex<Option<std::collections::HashSet<String>>> = Mutex::new(None);

fn update_remote_to_uuid(rows: &[&CustomerRow]) {
    let mut map = HashMap::new();
    for c in rows {
        if let Some(rid) = c.remote_id.as_ref() {
            if !rid.is_empty() {
                map.insert(rid.clone(), c.id.clone());
            }
        }
    }
    *REMOTE_TO_UUID.lock().unwrap() = Some(map);
}

fn remote_to_uuid(remote_id: &str) -> Option<String> {
    REMOTE_TO_UUID
        .lock()
        .ok()
        .and_then(|g| g.as_ref()?.get(remote_id).cloned())
}

#[derive(Debug, Deserialize)]
struct CustomersResponse {
    customers: Vec<CustomerRow>,
}

/// http_request_sync 의 응답 wrapper — raw body 를 {"body":"<json string>"} 로 감쌈.
/// common.rs 의 http 응답 처리 흐름이 그러함.
#[derive(Debug, Deserialize)]
struct HttpWrapper {
    body: String,
}

/// Flutter Peer JSON 한 행을 생성.
/// 컬럼 매핑 (DB → Peer):
///   remoteId      → id    (없으면 그 거래처는 skip)
///   name          → alias (UI 의 별칭)
///   contactName   → hostname (보조 정보로 카드에 표시됨)
///   notes         → note
fn customer_to_peer_json(c: &CustomerRow) -> Option<serde_json::Value> {
    let id = c.remote_id.clone()?;
    if id.trim().is_empty() {
        return None;
    }
    let empty_tags: Vec<String> = Vec::new();
    Some(serde_json::json!({
        "id": id,
        "hash": "",
        "password": "",
        "username": "",
        "hostname": c.contact_name.clone().or_else(|| c.address.clone()).unwrap_or_default(),
        // ChainRemote 거래처는 99% Windows POS/키오스크. 빈 platform 이면 RustDesk UI 가
        // OS 아이콘 자리에 회색 사각형 → 무조건 "Windows" 박음. 향후 다른 OS 거래처 생기면
        // DB 에 platform 컬럼 추가 + 여기 매핑.
        "platform": "Windows",
        "alias": c.name,
        "tags": empty_tags,
        "forceAlwaysRelay": "false",
        "rdpPort": "",
        "rdpUsername": "",
        "loginName": "",
        "device_group_name": "",
        "note": c.notes.clone().unwrap_or_default(),
        "same_server": serde_json::Value::Null,
    }))
}

/// customers 에 등록 안 된 머신(orphan) peer placeholder — remote_id 만 있고 별칭/메모는 빈 값.
/// 2026-05-27: HQ workstation 등 옵션 B+ 본사 PC 즐겨찾기 지원용.
fn orphan_peer_json(remote_id: &str) -> serde_json::Value {
    let empty_tags: Vec<String> = Vec::new();
    serde_json::json!({
        "id": remote_id,
        "hash": "",
        "password": "",
        "username": "",
        "hostname": "",
        "platform": "Windows",
        "alias": "",
        "tags": empty_tags,
        "forceAlwaysRelay": "false",
        "rdpPort": "",
        "rdpUsername": "",
        "loginName": "",
        "device_group_name": "",
        "note": "",
        "same_server": serde_json::Value::Null,
    })
}

fn push_event(name: &str, peers_json: String) {
    let data = HashMap::from([("name", name.to_owned()), ("peers", peers_json)]);
    let _ = crate::flutter::push_global_event(
        crate::flutter::APP_TYPE_MAIN,
        serde_json::ser::to_string(&data).unwrap_or_default(),
    );
}

fn push_empty(event_name: &str) {
    push_event(event_name, "[]".to_owned());
}

/// 인증된 GET. 응답 wrapper 풀기까지 한다. 호출 측은 inner JSON 받음.
fn authed_get(url: String) -> Result<String, String> {
    let token = chainremote_auth::get_token();
    if token.is_empty() {
        return Err("토큰 없음".to_owned());
    }
    let header = format!(r#"{{"Authorization":"Bearer {}"}}"#, token.replace('"', ""));
    let raw = crate::http_request_sync(url, "GET".to_owned(), None, header)
        .map_err(|e| e.to_string())?;
    Ok(unwrap_body(raw))
}

/// 인증된 POST. body JSON string.
fn authed_post(url: String, body: String) -> Result<String, String> {
    let token = chainremote_auth::get_token();
    if token.is_empty() {
        return Err("토큰 없음".to_owned());
    }
    // post_request_ 의 헤더 단순 split. Authorization 만 박음.
    let header = format!("Authorization: Bearer {}", token);
    crate::post_request_sync(url, body, &header).map_err(|e| e.to_string())
}

/// 인증된 DELETE — http_request_sync 사용 (post_request_sync 는 POST 전용).
fn authed_delete(url: String) -> Result<String, String> {
    let token = chainremote_auth::get_token();
    if token.is_empty() {
        return Err("토큰 없음".to_owned());
    }
    let header = format!(r#"{{"Authorization":"Bearer {}"}}"#, token.replace('"', ""));
    let raw = crate::http_request_sync(url, "DELETE".to_owned(), None, header)
        .map_err(|e| e.to_string())?;
    Ok(unwrap_body(raw))
}

fn unwrap_body(raw: String) -> String {
    serde_json::from_str::<HttpWrapper>(&raw)
        .map(|w| w.body)
        .unwrap_or(raw)
}

/// GET /api/customers → remote_id → uuid 매핑 캐시 갱신 (silent).
/// 전체 거래처 마스터 뷰는 관리 패널 전용 — 앱은 최근세션(네이티브)+즐겨찾기만 표시하므로
/// 더 이상 "load_recent_peers" 로 push 하지 않는다. 이 fetch 는 즐겨찾기 추가 시
/// remote_id → uuid 변환에만 쓰인다 (캐시 미스 자동 보충 + 시작 시 워밍).
fn fetch_customers_blocking() -> bool {
    let url = format!("{}/api/customers", chainremote_auth::api_base());
    match authed_get(url) {
        Ok(inner) => match serde_json::from_str::<CustomersResponse>(&inner) {
            Ok(resp) => {
                update_remote_to_uuid(&resp.customers.iter().collect::<Vec<_>>());
                true
            }
            Err(e) => {
                log::warn!("ChainRemote customers 파싱 실패: {} ({:.200})", e, inner);
                false
            }
        },
        Err(e) => {
            log::warn!("ChainRemote /api/customers 실패: {}", e);
            false
        }
    }
}

/// GET /api/me/favorites → "load_fav_peers" 이벤트로 push.
/// 동시에 내 즐겨찾기 remote_id 집합 캐시 갱신 (UI sync 토글 표시).
fn fetch_favorites_blocking() -> bool {
    let url = format!("{}/api/me/favorites", chainremote_auth::api_base());
    match authed_get(url) {
        Ok(inner) => match serde_json::from_str::<FavoritesResponse>(&inner) {
            Ok(resp) => {
                // 캐시 갱신 — remote_id 가 primary (orphan 도 포함).
                let mut fav_remote_ids = std::collections::HashSet::new();
                for f in &resp.favorites {
                    if !f.remote_id.is_empty() {
                        fav_remote_ids.insert(f.remote_id.clone());
                    }
                }
                *MY_FAV_REMOTE_IDS.lock().unwrap() = Some(fav_remote_ids);

                // customers 매핑 가능한 항목만 update_remote_to_uuid 에 사용.
                let mapped_customers: Vec<&CustomerRow> = resp
                    .favorites
                    .iter()
                    .filter_map(|f| f.customer.as_ref())
                    .collect();
                update_remote_to_uuid(&mapped_customers);

                // peer 리스트 — customer 정보 있는 건 그대로, orphan 은 remote_id 만으로 placeholder.
                let peers: Vec<_> = resp
                    .favorites
                    .iter()
                    .filter_map(|f| match &f.customer {
                        Some(c) => customer_to_peer_json(c),
                        None => Some(orphan_peer_json(&f.remote_id)),
                    })
                    .collect();
                let json = serde_json::ser::to_string(&peers).unwrap_or_default();
                push_event("load_fav_peers", json);
                true
            }
            Err(e) => {
                log::warn!("ChainRemote favorites 파싱 실패: {} ({:.200})", e, inner);
                push_empty("load_fav_peers");
                false
            }
        },
        Err(e) => {
            log::warn!("ChainRemote /api/me/favorites 실패: {}", e);
            push_empty("load_fav_peers");
            false
        }
    }
}

/// 즐겨찾기 추가 (POST). 2026-05-27 개편: remote_id 만 보내고 서버가 customer_id 매칭.
/// customers 에 없는 머신(HQ workstation, 옵션 B+ 본사 PC)도 orphan 으로 즐겨찾기 가능.
fn add_favorite_blocking(remote_id: String) -> bool {
    let url = format!("{}/api/me/favorites", chainremote_auth::api_base());
    let body = serde_json::json!({ "remoteId": remote_id }).to_string();
    match authed_post(url, body) {
        Ok(_) => {
            // 캐시 즉시 업데이트 → UI 가 다음 read 에서 정확.
            if let Ok(mut g) = MY_FAV_REMOTE_IDS.lock() {
                if g.is_none() {
                    *g = Some(std::collections::HashSet::new());
                }
                if let Some(s) = g.as_mut() {
                    s.insert(remote_id);
                }
            }
            // 서버 반영 후 즐겨찾기 탭 재푸시 → 앱 홈(즐겨찾기) 즉시 갱신.
            fetch_favorites_blocking();
            true
        }
        Err(e) => {
            log::warn!("ChainRemote add_favorite 실패: {}", e);
            false
        }
    }
}

/// 즐겨찾기 제거 (DELETE).
fn remove_favorite_blocking(remote_id: String) -> bool {
    // 2026-05-27 개편: remote_id 직접 사용. customer_id 매핑 불필요.
    let url = format!(
        "{}/api/me/favorites/{}",
        chainremote_auth::api_base(),
        remote_id
    );
    match authed_delete(url) {
        Ok(_) => {
            if let Ok(mut g) = MY_FAV_REMOTE_IDS.lock() {
                if let Some(s) = g.as_mut() {
                    s.remove(&remote_id);
                }
            }
            // 서버 반영 후 즐겨찾기 탭 재푸시 → 앱 홈(즐겨찾기) 즉시 갱신.
            fetch_favorites_blocking();
            true
        }
        Err(e) => {
            log::warn!("ChainRemote remove_favorite 실패: {}", e);
            false
        }
    }
}

/// 캐시된 내 즐겨찾기 remote_id 목록 — UI sync 호출용.
/// 캐시가 비어 있으면 빈 리스트 반환 (background fetch 가 채우길 대기).
pub fn get_my_favorite_remote_ids() -> Vec<String> {
    MY_FAV_REMOTE_IDS
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.iter().cloned().collect()))
        .unwrap_or_default()
}

/// FFI 진입점 — 모두 thread spawn 으로 UI non-blocking.
pub fn spawn_load_customers() {
    std::thread::spawn(|| {
        fetch_customers_blocking();
    });
}

pub fn spawn_load_favorites() {
    std::thread::spawn(|| {
        fetch_favorites_blocking();
    });
}

pub fn spawn_add_favorite(remote_id: String) {
    std::thread::spawn(move || {
        add_favorite_blocking(remote_id);
    });
}

/// FFI sync 진입점 — 결과를 토스트로 정확히 표시 위해 UI thread 가 결과 기다림.
pub fn add_favorite_blocking_pub(remote_id: String) -> bool {
    add_favorite_blocking(remote_id)
}

pub fn remove_favorite_blocking_pub(remote_id: String) -> bool {
    remove_favorite_blocking(remote_id)
}

pub fn spawn_remove_favorite(remote_id: String) {
    std::thread::spawn(move || {
        remove_favorite_blocking(remote_id);
    });
}
