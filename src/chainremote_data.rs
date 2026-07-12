// 본사 앱 데이터 fetcher — 진실 원천은 관리 패널 DB.
// 거래처 목록(GET /api/customers), 즐겨찾기(GET/POST/DELETE /api/me/favorites),
// 그리고 remote_id ↔ customer UUID 매핑 캐시.
//
// 인증은 chainremote_auth::get_token() 의 Bearer JWT.
// http_request_sync 가 raw 를 {"body":"<json>"} 로 감싸 돌려주므로 HttpWrapper 로 한 번
// 풀고 안쪽 JSON 을 다시 from_str 한다.

use std::collections::HashMap;
use std::sync::Mutex;

use hbb_common::log;
use serde::Deserialize;

use crate::chainremote_auth;

/// 패널 customers 행 (필요한 필드만).
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
    // 자가등록 상태: "active"(확정) | "pending"(미확정 후보). None 이면 확정으로 간주.
    // '전체 거래처' 탭 pending 표시 + 마스터 확정 버튼 게이트에 쓴다.
    #[serde(rename = "enrollStatus")]
    enroll_status: Option<String>,
    // 담당 직원. null/빈값 = 미배정("등록대기") — 아직 아무도 안 잡은 신규 거래처.
    #[serde(rename = "assignedUserId")]
    assigned_user_id: Option<String>,
    // 프로세스 arch("x86"=32비트 / "x64", 마이그020). 내부 진단용(어느 페이로드/버전 트랙).
    arch: Option<String>,
    // OS 표시(마이그021) — os="Windows 7/10/11", osBits="x64"/"x86"(네이티브 OS 비트수).
    //   전체 거래처 카드에 "Win7 · 64비트" 배지로 쓴다(arch=페이로드와 달라 OS 기준이 정확).
    os: Option<String>,
    #[serde(rename = "osBits")]
    os_bits: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FavoriteRow {
    // 2026-05-27 개편으로 remote_id 가 primary. customer 는 orphan(customers 미등록 머신)이면 None.
    #[serde(rename = "remoteId")]
    remote_id: String,
    customer: Option<CustomerRow>,
}

#[derive(Debug, Deserialize)]
struct FavoritesResponse {
    favorites: Vec<FavoriteRow>,
}

// remote_id → customer UUID. 즐겨찾기 토글에 필요. customers/favorites fetch 때 갱신.
static REMOTE_TO_UUID: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

// 내 즐겨찾기 remote_id 집합 — UI 가 동기로 fav 상태를 빠르게 표시. favorites fetch 때 갱신.
static MY_FAV_REMOTE_IDS: Mutex<Option<std::collections::HashSet<String>>> = Mutex::new(None);

// remote_id → 거래처명. 최근 세션 탭이 숫자 ID 대신 거래처명을 보이게 하는 용도
// (main_load_recent_peers 가 peer.alias 를 이 값으로 덮는다). customers·favorites 양쪽에서
// merge 로 채워 패널 rename 이 즐겨찾기 refresh 에도 살아 반영되게 한다.
static REMOTE_TO_NAME: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

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

/// REMOTE_TO_NAME 에 거래처명 merge. customers(전체)·favorites(부분) 양쪽에서 부르므로
/// replace 가 아닌 merge — favorites 가 전체 캐시를 부분집합으로 깎아먹지 않게. 같은 remote_id 는
/// 최신 이름으로 덮어 패널 rename 을 반영.
fn merge_remote_names(rows: &[&CustomerRow]) {
    if let Ok(mut guard) = REMOTE_TO_NAME.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        for c in rows {
            if let Some(rid) = c.remote_id.as_ref() {
                if !rid.is_empty() && !c.name.trim().is_empty() {
                    map.insert(rid.clone(), c.name.clone());
                }
            }
        }
    }
}

/// remote_id → 거래처명. 최근 세션 카드가 ID 대신 이름을 표시할 때 조회.
pub fn get_remote_name(remote_id: &str) -> Option<String> {
    REMOTE_TO_NAME
        .lock()
        .ok()
        .and_then(|g| g.as_ref()?.get(remote_id).cloned())
}

#[derive(Debug, Deserialize)]
struct CustomersResponse {
    customers: Vec<CustomerRow>,
}

/// http_request_sync 응답 wrapper — raw body 를 {"status_code":..,"body":"<json string>"} 로 감싼다.
#[derive(Debug, Deserialize)]
struct HttpWrapper {
    #[serde(default)]
    status_code: u16,
    body: String,
}

/// CustomerRow → Flutter Peer JSON 한 행.
/// remoteId→id(없으면 skip) / name→alias / contactName→hostname / notes→note.
fn customer_to_peer_json(c: &CustomerRow, with_marker: bool) -> Option<serde_json::Value> {
    let id = c.remote_id.clone()?;
    if id.trim().is_empty() {
        return None;
    }
    let empty_tags: Vec<String> = Vec::new();
    let is_pending = c.enroll_status.as_deref() == Some("pending");
    let is_unassigned = c.assigned_user_id.as_deref().unwrap_or("").trim().is_empty();
    // 별칭 앞에 마커를 붙여 카드 렌더 손 안 대고 시각 구분: pending ⏳ / 미배정 신규 🆕.
    // '전체 거래처' 탭(with_marker=true)에서만 — 즐겨찾기/최근 탭엔 노이즈라 raw 이름.
    // 누군가 먼저 즐겨찾기로 차지(claim)하면 assigned 되어 다음 fetch 때 전 HQ 에서 마커가 사라진다.
    let alias = if with_marker && is_pending {
        format!("⏳ {}", c.name)
    } else if with_marker && is_unassigned {
        format!("🆕 {}", c.name)
    } else {
        c.name.clone()
    };
    Some(serde_json::json!({
        "id": id,
        "hash": "",
        "password": "",
        "username": "",
        "hostname": c.contact_name.clone().or_else(|| c.address.clone()).unwrap_or_default(),
        // 거래처는 99% Windows POS/키오스크. platform 이 비면 UI 가 OS 아이콘 자리에 회색
        // 사각형을 그려서 그냥 "Windows" 로 박는다. 다른 OS 거래처가 생기면 DB 에 platform
        // 컬럼 추가하고 여기서 매핑.
        "platform": "Windows",
        "alias": alias,
        "tags": empty_tags,
        "forceAlwaysRelay": "false",
        "rdpPort": "",
        "rdpUsername": "",
        "loginName": "",
        "device_group_name": "",
        "note": c.notes.clone().unwrap_or_default(),
        "same_server": serde_json::Value::Null,
        // Flutter Peer.enrollStatus 로 흘러가 마스터 확정 버튼 게이트(pending 만 노출)에 쓰임.
        "enrollStatus": c.enroll_status.clone().unwrap_or_default(),
        // Flutter Peer.arch(내부 진단) + os/osBits(표시) — 카드에 "Win7 · 64비트" 배지로.
        "arch": c.arch.clone().unwrap_or_default(),
        "os": c.os.clone().unwrap_or_default(),
        "osBits": c.os_bits.clone().unwrap_or_default(),
    }))
}

/// customers 미등록 머신(orphan)용 placeholder peer — remote_id 만, 별칭/메모는 빈 값.
/// 2026-05-27 옵션 B+ 본사 PC(HQ workstation 등) 즐겨찾기 지원용.
fn orphan_peer_json(remote_id: &str) -> serde_json::Value {
    let empty_tags: Vec<String> = Vec::new();
    // orphan 즐겨찾기는 서버에 이름이 없어 탭에 ID 만 떴었다. 이 기기에 로컬 별칭(우클릭
    // 이름변경 → set_peer_option id "alias")이 있으면 폴백으로 채워, 한 기기 안에서 최근세션
    // 표시('내 맥미니' 등)와 즐겨찾기 표시를 맞춘다.
    // (별칭은 로컬 저장이라 안 붙인 다른 기기에선 여전히 ID. 서버 동기화는 별도 과제.)
    let alias = hbb_common::config::PeerConfig::load(remote_id)
        .options
        .get("alias")
        .cloned()
        .unwrap_or_default();
    serde_json::json!({
        "id": remote_id,
        "hash": "",
        "password": "",
        "username": "",
        "hostname": "",
        "platform": "Windows",
        "alias": alias,
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

/// 인증된 GET. wrapper 까지 풀어서 inner JSON 을 돌려준다.
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

/// 인증된 POST. body 는 JSON string.
/// post_request_status_sync 로 HTTP 상태코드까지 확인 — 2xx 아니면 서버가 도달 가능해도
/// (예: 401/400/500) 명확히 Err 로 취급한다. post_request_sync 는 상태코드를 버리고
/// 무조건 Ok(text) 를 반환해 즐겨찾기 실패가 "성공"으로 오인되는 사고가 있었다.
fn authed_post(url: String, body: String) -> Result<String, String> {
    let token = chainremote_auth::get_token();
    if token.is_empty() {
        return Err("토큰 없음".to_owned());
    }
    // post_request_status_sync 도 헤더를 단순 split — Authorization 한 줄만 박는다.
    let header = format!("Authorization: Bearer {}", token);
    match crate::post_request_status_sync(url, body, &header) {
        // post_request_http 는 raw body 텍스트를 그대로 준다(http_request_sync 의
        // {"status_code":..,"body":..} wrapper 와 다른 포맷) — unwrap_body 불필요.
        Ok((status, text)) if (200..300).contains(&status) => Ok(text),
        Ok((status, text)) => Err(format!("HTTP {}: {:.300}", status, text)),
        Err(e) => Err(e.to_string()),
    }
}

/// 인증된 DELETE — post_request_sync 는 POST 전용이라 http_request_sync 를 쓴다.
/// wrapper 의 status_code 확인 필수 — 안 그러면 401/404 도 "성공"으로 오인된다(add_favorite 와 동일 사고).
fn authed_delete(url: String) -> Result<String, String> {
    let token = chainremote_auth::get_token();
    if token.is_empty() {
        return Err("토큰 없음".to_owned());
    }
    let header = format!(r#"{{"Authorization":"Bearer {}"}}"#, token.replace('"', ""));
    let raw = crate::http_request_sync(url, "DELETE".to_owned(), None, header)
        .map_err(|e| e.to_string())?;
    match serde_json::from_str::<HttpWrapper>(&raw) {
        Ok(w) if (200..300).contains(&w.status_code) => Ok(w.body),
        Ok(w) => Err(format!("HTTP {}: {:.300}", w.status_code, w.body)),
        // wrapper 파싱 실패 — status_code 를 모르니 기존처럼 raw 를 성공으로 통과시킨다
        // (신규 회귀 방지: 최소 변경 원칙, 이 케이스는 원래도 발생 안 하던 경로).
        Err(_) => Ok(raw),
    }
}

fn unwrap_body(raw: String) -> String {
    serde_json::from_str::<HttpWrapper>(&raw)
        .map(|w| w.body)
        .unwrap_or(raw)
}

/// GET /api/customers → remote_id→uuid 매핑 캐시 갱신 + "전체 거래처" 탭 push.
/// 매핑은 즐겨찾기 추가 시 remote_id→uuid 변환 + 최근세션 이름 덮어쓰기에 쓴다.
/// "load_all_customers" 이벤트로 테넌트 전체(pending 포함)를 push → HQ '전체 거래처'
/// 탭(allCustomersPeersModel)에 뜬다. 어느 직원이 등록했든 다 보인다.
fn fetch_customers_blocking() -> bool {
    let url = format!("{}/api/customers", chainremote_auth::api_base());
    match authed_get(url) {
        Ok(inner) => match serde_json::from_str::<CustomersResponse>(&inner) {
            Ok(resp) => {
                let rows: Vec<&CustomerRow> = resp.customers.iter().collect();
                update_remote_to_uuid(&rows);
                merge_remote_names(&rows);
                // "전체 거래처" 탭 — remote_id 있는 거래처 전부(pending 포함)를 peer 로 push.
                let peers: Vec<_> = resp
                    .customers
                    .iter()
                    .filter_map(|c| customer_to_peer_json(c, true)) // 전체 거래처 = 마커 표시
                    .collect();
                let json = serde_json::ser::to_string(&peers).unwrap_or_default();
                push_event("load_all_customers", json);
                // REMOTE_TO_NAME 갱신 후 최근세션을 재푸시해야 패널에서 고친 거래처명이 HQ
                // 새로고침(또는 재로그인) 시 최근세션 탭에 반영된다. main_load_recent_peers 가
                // peer.alias 를 이 매핑으로 덮으므로, 재푸시 안 하면 화면이 그대로다.
                crate::flutter_ffi::main_load_recent_peers();
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

/// GET /api/me/favorites → "load_fav_peers" push + 내 즐겨찾기 remote_id 집합 캐시 갱신.
fn fetch_favorites_blocking() -> bool {
    let url = format!("{}/api/me/favorites", chainremote_auth::api_base());
    match authed_get(url) {
        Ok(inner) => match serde_json::from_str::<FavoritesResponse>(&inner) {
            Ok(resp) => {
                // remote_id 가 primary (orphan 포함).
                let mut fav_remote_ids = std::collections::HashSet::new();
                for f in &resp.favorites {
                    if !f.remote_id.is_empty() {
                        fav_remote_ids.insert(f.remote_id.clone());
                    }
                }
                *MY_FAV_REMOTE_IDS.lock().unwrap() = Some(fav_remote_ids);

                // customer 정보가 붙은 항목만 uuid 매핑에 사용.
                let mapped_customers: Vec<&CustomerRow> = resp
                    .favorites
                    .iter()
                    .filter_map(|f| f.customer.as_ref())
                    .collect();
                update_remote_to_uuid(&mapped_customers);
                merge_remote_names(&mapped_customers);

                // customer 정보 있으면 그대로, orphan 은 remote_id 만으로 placeholder.
                let peers: Vec<_> = resp
                    .favorites
                    .iter()
                    .filter_map(|f| match &f.customer {
                        Some(c) => customer_to_peer_json(c, false), // 즐겨찾기 = 마커 없는 raw 이름
                        None => Some(orphan_peer_json(&f.remote_id)),
                    })
                    .collect();
                let json = serde_json::ser::to_string(&peers).unwrap_or_default();
                push_event("load_fav_peers", json);
                true
            }
            Err(e) => {
                // 파싱 실패해도 화면은 안 비운다(마지막 정상 목록 유지). 옛 코드는 여기서
                // push_empty 로 즐겨찾기를 지웠고, 그 탓에 패널 일시장애(재배포/네트워크 블립)에
                // 즐겨찾기가 통째로 증발했다. (거래처 fetch 는 원래 안 지웠음.)
                log::warn!("ChainRemote favorites 파싱 실패(목록 유지): {} ({:.200})", e, inner);
                false
            }
        },
        Err(e) => {
            // 위와 동일 — fetch 실패해도 마지막 목록 유지. 워밍 재시도가 복구한다.
            log::warn!("ChainRemote /api/me/favorites 실패(목록 유지): {}", e);
            false
        }
    }
}

/// 즐겨찾기 추가 (POST). 2026-05-27 개편으로 remote_id 만 보내고 customer_id 매칭은 서버가.
/// customers 에 없는 머신(HQ workstation, 옵션 B+ 본사 PC)도 orphan 으로 즐겨찾기 가능.
fn add_favorite_blocking(remote_id: String) -> bool {
    let url = format!("{}/api/me/favorites", chainremote_auth::api_base());
    // 이 기기가 아는 원격 hostname(PeerConfig.info.hostname) + 로컬 별칭(우클릭 이름변경 →
    // options["alias"], orphan_peer_json 과 같은 출처)을 함께 보내 → 패널 "신규 거래처 후보"가
    // remote_id 뿐 아니라 이름으로 식별되고 "추가" 시 상호가 프리필된다.
    // (둘 다 빈 값이어도 서버가 alias→hostname→placeholder 로 폴백. FFI/브리지는 안 건드림.)
    let pc = hbb_common::config::PeerConfig::load(&remote_id);
    let hostname = pc.info.hostname.clone();
    let alias = pc.options.get("alias").cloned().unwrap_or_default();
    let body = serde_json::json!({
        "remoteId": remote_id,
        "hostname": hostname,
        "alias": alias,
    })
    .to_string();
    match authed_post(url, body) {
        Ok(_) => {
            // 캐시 즉시 반영 → 다음 read 부터 정확.
            if let Ok(mut g) = MY_FAV_REMOTE_IDS.lock() {
                if g.is_none() {
                    *g = Some(std::collections::HashSet::new());
                }
                if let Some(s) = g.as_mut() {
                    s.insert(remote_id);
                }
            }
            // 서버 반영 후 즐겨찾기 탭 재푸시 → 앱 홈 즉시 갱신.
            fetch_favorites_blocking();
            true
        }
        Err(e) => {
            log::warn!("ChainRemote add_favorite 실패: {}", e);
            false
        }
    }
}

/// 즐겨찾기 제거 (DELETE). 2026-05-27 개편으로 remote_id 직접 사용(customer_id 매핑 불필요).
fn remove_favorite_blocking(remote_id: String) -> bool {
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
            // 서버 반영 후 즐겨찾기 탭 재푸시 → 앱 홈 즉시 갱신.
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
/// 아직 캐시가 비었으면 빈 리스트(background fetch 가 채울 때까지).
pub fn get_my_favorite_remote_ids() -> Vec<String> {
    MY_FAV_REMOTE_IDS
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|s| s.iter().cloned().collect()))
        .unwrap_or_default()
}

/// 워밍 재시도 — 패널 일시장애(재배포/네트워크 블립/응답지연)에 목록이 안 채워지는 걸 막는다.
/// fetch 실패는 화면을 안 비우므로(마지막 목록 유지) 여기서 백그라운드로 재시도해 패널이 살아나면
/// 자동으로 다시 채운다. 성공 즉시 종료. 최대 10회×5s(~45s, 재배포 다운타임 커버) 후 포기 —
/// 그래도 목록은 유지되고 사용자가 새로고침/재로그인으로 강제 워밍 가능.
fn spawn_warm_with_retry(name: &'static str, f: fn() -> bool) {
    std::thread::spawn(move || {
        for attempt in 0..10u32 {
            if f() {
                return;
            }
            if attempt < 9 {
                std::thread::sleep(std::time::Duration::from_secs(5));
            }
        }
        log::warn!(
            "ChainRemote {} 워밍 10회 재시도 모두 실패 — 마지막 목록 유지(새로고침/재로그인으로 복구)",
            name
        );
    });
}

/// FFI 진입점 — thread spawn 으로 UI 안 막는다.
pub fn spawn_load_customers() {
    spawn_warm_with_retry("customers", fetch_customers_blocking);
}

pub fn spawn_load_favorites() {
    spawn_warm_with_retry("favorites", fetch_favorites_blocking);
}

pub fn spawn_add_favorite(remote_id: String) {
    std::thread::spawn(move || {
        add_favorite_blocking(remote_id);
    });
}

/// FFI sync 진입점 — 결과 토스트를 정확히 띄우려 UI thread 가 결과를 기다린다.
pub fn add_favorite_blocking_pub(remote_id: String) -> bool {
    add_favorite_blocking(remote_id)
}

pub fn remove_favorite_blocking_pub(remote_id: String) -> bool {
    remove_favorite_blocking(remote_id)
}

/// 자가등록 후보 거래처 확정 — POST /api/customers/confirm.
/// 마스터(owner) 전용 강제는 서버(requireOwner)가 담당하고, HQ UI 는 마스터에게만 버튼을
/// 노출한다(이중 방어). 성공 시 전체 거래처 재fetch → ⏳ 마커 사라지고 active 로 바뀜.
fn confirm_customer_blocking(remote_id: String) -> bool {
    let url = format!("{}/api/customers/confirm", chainremote_auth::api_base());
    let body = serde_json::json!({ "remoteId": remote_id }).to_string();
    match authed_post(url, body) {
        Ok(_) => {
            fetch_customers_blocking();
            true
        }
        Err(e) => {
            log::warn!("ChainRemote confirm_customer 실패: {}", e);
            false
        }
    }
}

pub fn confirm_customer_blocking_pub(remote_id: String) -> bool {
    confirm_customer_blocking(remote_id)
}

/// HQ 어느 직원이든 거래처명 변경 → 패널 customer.name(진실 원천)에 기록 → 최근/즐겨찾기/패널/
/// 전 직원이 일관. payload 는 JSON {"remoteId","name"}(1-arg add_favorite 브리지 패턴 재사용).
/// 등록 거래처면 true.
fn rename_customer_blocking(payload: String) -> bool {
    let v: serde_json::Value = match serde_json::from_str(&payload) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("ChainRemote rename payload 파싱 실패: {}", e);
            return false;
        }
    };
    let remote_id = v
        .get("remoteId")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let name = v
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if remote_id.is_empty() || name.is_empty() {
        return false;
    }
    let url = format!("{}/api/customers/rename", chainremote_auth::api_base());
    let body = serde_json::json!({ "remoteId": remote_id, "name": name }).to_string();
    match authed_post(url, body) {
        Ok(resp) => {
            let ok = serde_json::from_str::<serde_json::Value>(&resp)
                .ok()
                .and_then(|j| j.get("ok").and_then(|b| b.as_bool()))
                .unwrap_or(false);
            if ok {
                // 패널 반영됨 → 전 표면 재워밍(최근 overlay + 전체거래처 push + 즐겨찾기).
                // 재fetch 는 백그라운드 spawn 으로 돌려 UI 를 안 막고, POST 결과만 동기로 반환.
                std::thread::spawn(|| {
                    fetch_customers_blocking();
                    fetch_favorites_blocking();
                });
            }
            ok
        }
        Err(e) => {
            log::warn!("ChainRemote rename_customer 실패: {}", e);
            false
        }
    }
}

pub fn rename_customer_blocking_pub(payload: String) -> bool {
    rename_customer_blocking(payload)
}

pub fn spawn_remove_favorite(remote_id: String) {
    std::thread::spawn(move || {
        remove_favorite_blocking(remote_id);
    });
}
