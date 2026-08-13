// 연결 경로 점검(프로브) — 거래처마다 "직결로 이어지는가, 서버를 경유하는가"만 재고 끊는다.
//
// ■ 왜 만들었나 (2026-08-13)
//
// 직결 비율을 올리려면 먼저 어느 거래처가 안 되는지 알아야 하는데, 그걸 알 방법이 실제
//   원격뿐이었다. 그런데 우리 원격 빈도가 30일에 19건이고 그중 계측된 건 2건이다 — 내부
//   기기(우리집·재성이 컴)는 지원기록을 안 남기므로 세션 자체가 안 만들어지고, 15초 미만도
//   버려진다. 이 속도로는 표본이 쌓이는 데 몇 달이 걸린다.
//
// ★그래서 "몇 %인가"가 아니라 **"어느 집이 안 되는가"**를 하루 만에 뽑는 게 목적이다.
//   비율 통계는 거래처 26곳으로는 어차피 ±19%p 밖에 못 좁힌다(표본 단위가 세션이 아니라
//   거래처다 — 같은 집을 100번 재도 NAT 는 하나다). 명단이면 충분하고, 명단이 나오면
//   릴레이만 타는 집을 개별로 파거나, 다수면 릴레이를 받아들이고 화질 쪽을 손보면 된다.
//
// ■ 왜 HQ 에서 도는가 (클라우드가 아니라)
//
// 클라우드 서버는 공인 IP 에 NAT 가 없다. NAT 없는 쪽 ↔ Cone NAT 는 거의 항상 뚫리므로
//   거기서 재면 실제보다 낙관적인 숫자가 나온다. 진짜 원격은 **사무실 NAT ↔ 거래처 NAT**
//   조합이라 난이도가 다르다. 측정 도구가 실제 조건을 재현하지 못하면 그 숫자는 거짓이다
//   (2026-08-12 에 옆 사무실 와이파이에서 잰 결과가 통째로 무효였던 것과 같은 함정).
//   그래서 프로브는 지원을 실제로 하는 그 기기, 그 회선에서 돈다.
//
// ■ 거래처 화면에는 아무 일도 일어나지 않는다
//
// 수락 카드는 **로그인 요청**을 받아야 뜬다(server/connection.rs 의 try_start_cm 은 전부
//   LoginRequest 처리 안에서만 불린다). 프로브는 `Client::start` 가 반환하는 지점 —
//   즉 rendezvous → 홀펀칭 → 암호화 핸드셰이크까지만 하고 그 앞에서 끊는다.
//   화면·입력·파일 어느 것도 건드리지 않고, 거래처 입장에선 카드조차 뜨지 않는다.
//   좌석(동시 1세션)도 HQ 계정 로그인 기준이라 원격 중인 사람을 밀어내지 않는다.

use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use hbb_common::{
    config::LocalConfig,
    log,
    message_proto::{Hash, PeerInfo, TestDelay, WindowsSession},
    rendezvous_proto::ConnType,
    tokio, Stream,
};

use crate::client::{Client, Data, Interface, LoginConfigHandler};

/// 한 거래처에 쓰는 최대 시간. 직결이든 릴레이든 이 안에 판가름 난다 —
///   성공하는 홀펀칭은 0.3초 안에 끝나고, 실패해도 릴레이 폴백이 1초 안팎이다.
const PROBE_TIMEOUT_SECS: u64 = 12;
/// 거래처 사이 간격. 한 번에 몰아치면 hbbs 에 순간 부하가 몰리고, POS 쪽 보안 소프트가
///   짧은 시간의 연속 접속을 이상 징후로 볼 수 있다. 급할 일이 아니니 천천히 돈다.
const GAP_MS: u64 = 700;

/// 한 거래처의 점검 결과.
pub struct ProbeResult {
    pub id: String,
    /// Some(true)=직결 / Some(false)=서버 경유 / None=연결 자체 실패(기기 꺼짐 등)
    pub direct: Option<bool>,
    pub ms: u64,
    pub error: String,
}

/// Interface 의 최소 구현 — 프로브는 화면도 세션도 없으므로 전부 아무것도 하지 않는다.
///
/// ★`update_direct` 기본 구현은 지원기록에 직결 여부를 적으려 하지만(마이그038),
///   그건 열려 있는 세션 ID 를 찾아 짝지어야 기록되므로 세션이 없는 프로브에서는
///   조용히 무시된다. 그래서 여기서 따로 막지 않아도 지원기록이 오염되지 않는다.
#[derive(Clone)]
struct ProbeInterface {
    lch: Arc<RwLock<LoginConfigHandler>>,
}

#[async_trait]
impl Interface for ProbeInterface {
    fn send(&self, _data: Data) {}
    fn msgbox(&self, _msgtype: &str, _title: &str, _text: &str, _link: &str) {}
    fn handle_login_error(&self, _err: &str) -> bool {
        true
    }
    fn handle_peer_info(&self, _pi: PeerInfo) {}
    fn set_multiple_windows_session(&self, _sessions: Vec<WindowsSession>) {}
    fn on_error(&self, _err: &str) {}

    async fn handle_hash(&self, _pass: &str, _hash: Hash, _peer: &mut Stream) {}
    async fn handle_login_from_ui(
        &self,
        _os_username: String,
        _os_password: String,
        _password: String,
        _remember: bool,
        _peer: &mut Stream,
    ) {
    }
    async fn handle_test_delay(&self, _t: TestDelay, _peer: &mut Stream) {}

    fn get_lch(&self) -> Arc<RwLock<LoginConfigHandler>> {
        self.lch.clone()
    }
}

/// 거래처 하나의 연결 경로를 잰다. 판정이 끝나면 즉시 끊는다.
///
/// ★점검이 "최근 세션"을 오염시키면 안 된다. `Client::start` 는 실제 원격과 같은 경로라
///   `peers/<id>.toml` 을 만들어 저장하는데, 최근 세션 탭은 그 파일 목록을 읽는다. 그래서
///   한 바퀴 돌면 원격한 적도 없는 거래처 39곳이 전부 최근 세션에 박혔다(2026-08-13 실측:
///   낭성 4대·월광 2대가 그렇게 올라왔다). 그 탭은 **내가 실제로 원격한 곳**이어야 한다.
///   그래서 점검 전에 그 파일이 원래 있었는지 보고, 우리가 만든 것이면 끝나고 지운다.
///   원래 있던 거래처의 기록은 손대지 않는다 — 비밀번호·별칭·해상도가 거기 들어 있다.
pub async fn probe_one(peer_id: &str) -> ProbeResult {
    let started = std::time::Instant::now();
    let had_config = peer_config_exists(peer_id);
    let mut lch = LoginConfigHandler::default();
    // force_relay=false — 이 점검의 목적이 "직결이 되는가"라 강제 릴레이를 걸면 의미가 없다.
    lch.initialize(
        peer_id.to_owned(),
        ConnType::DEFAULT_CONN,
        None,
        false,
        None,
        None,
        None,
    );
    let iface = ProbeInterface {
        lch: Arc::new(RwLock::new(lch)),
    };

    // ★키는 `get_key` 로 얻어야 한다. `Config::get_option("key")` 는 **사용자가 설정 화면에
    //   직접 넣은 값**이라 우리처럼 custom.txt(빌드 내장)로 서버 키를 박은 배포에서는 비어
    //   있다. 빈 키로 붙으면 서버가 준 공개키와 대조가 안 돼 전 거래처가 "Key mismatch" 로
    //   떨어진다(2026-08-13 첫 실행에서 39곳 전부 그랬다). 실제 세션도 io_loop 에서
    //   `crate::get_key(false)` 를 쓴다 — 같은 경로를 타야 같은 조건이 된다.
    let key = crate::get_key(false).await;
    let token = LocalConfig::get_option("access_token");
    let fut = Client::start(peer_id, &key, &token, ConnType::DEFAULT_CONN, iface);

    let out = match tokio::time::timeout(
        std::time::Duration::from_secs(PROBE_TIMEOUT_SECS),
        fut,
    )
    .await
    {
        // x.0 = (Stream, direct, pk, kcp, punch_type). Stream 은 여기서 drop 되며 닫힌다 —
        //   로그인 요청을 보내지 않았으므로 거래처는 카드도 못 본 채 끝난다.
        Ok(Ok((x, _))) => ProbeResult {
            id: peer_id.to_owned(),
            direct: Some(x.1),
            ms: started.elapsed().as_millis() as u64,
            error: String::new(),
        },
        Ok(Err(e)) => ProbeResult {
            id: peer_id.to_owned(),
            direct: None,
            ms: started.elapsed().as_millis() as u64,
            error: e.to_string(),
        },
        Err(_) => ProbeResult {
            id: peer_id.to_owned(),
            direct: None,
            ms: started.elapsed().as_millis() as u64,
            error: "시간 초과".to_owned(),
        },
    };
    // 우리가 만든 기록이면 치운다. 원래 있던 것은 그대로 둔다.
    if !had_config {
        hbb_common::config::PeerConfig::remove(peer_id);
    }
    log::info!(
        "ChainRemote 경로 점검 {} → {} ({}ms){}",
        out.id,
        match out.direct {
            Some(true) => "직결",
            Some(false) => "서버 경유",
            None => "실패",
        },
        out.ms,
        if out.error.is_empty() {
            String::new()
        } else {
            format!(" [{}]", out.error)
        }
    );
    out
}

/// 목록을 한 바퀴 돈다. **순차**로 도는 이유는 동시에 열면 우리 쪽 NAT 가 포트를 몰아 쓰면서
///   홀펀칭 조건이 실제 지원 상황과 달라지기 때문이다 — 측정이 목적이라 실제와 같아야 한다.
pub async fn probe_all(ids: Vec<String>) -> Vec<ProbeResult> {
    let mut out = Vec::with_capacity(ids.len());
    for (i, id) in ids.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(GAP_MS)).await;
        }
        out.push(probe_one(id).await);
    }
    let direct = out.iter().filter(|r| r.direct == Some(true)).count();
    let relay = out.iter().filter(|r| r.direct == Some(false)).count();
    log::info!(
        "ChainRemote 경로 점검 완료: 직결 {}곳 · 서버 경유 {}곳 · 실패 {}곳",
        direct,
        relay,
        out.len() - direct - relay
    );
    out
}

/// JSON 한 줄로 결과를 낸다(FFI 경계용). `[{"id":..,"direct":true|false|null,"ms":..,"error":..}]`
pub fn to_json(results: &[ProbeResult]) -> String {
    let arr: Vec<serde_json::Value> = results
        .iter()
        .map(|r| {
            serde_json::json!({
                "id": r.id,
                "direct": r.direct,
                "ms": r.ms,
                "error": r.error,
            })
        })
        .collect();
    serde_json::Value::Array(arr).to_string()
}

/// 이 거래처의 peer 기록이 이미 있나 — 점검이 만든 것만 골라 지우기 위한 사전 확인.
fn peer_config_exists(peer_id: &str) -> bool {
    hbb_common::config::Config::path("")
        .join("peers")
        .join(format!("{peer_id}.toml"))
        .exists()
}

/// 거래처 목록에서 원격 ID 만 뽑는다. remote_id 없는 pending 거래처는 잴 대상이 아니다.
///
/// ★내부 기기(우리집·재성이 컴)도 **포함**한다. 지원기록은 그것들을 빼지만 여기는 명단이
///   목적이라 다 잰다 — 다만 그 기기들은 우리와 같은 망일 때 랜 경로를 타므로 결과를 읽을 때
///   그 점을 감안해야 한다(공인 IP 가 같으면 서버가 사설 주소를 교환시킨다).
fn fetch_ids() -> Result<Vec<String>, String> {
    let token = crate::chainremote_auth::get_token();
    if token.is_empty() {
        return Err("로그인이 필요합니다".to_owned());
    }
    let url = format!("{}/api/customers", crate::chainremote_auth::api_base());
    let header = format!(r#"{{"Authorization":"Bearer {}"}}"#, token.replace('"', ""));
    let raw = crate::http_request_sync(url, "GET".to_owned(), None, header)
        .map_err(|e| e.to_string())?;
    // http_request_sync 는 {"status_code":..,"body":"<json>"} 로 감싸 준다.
    let outer: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("응답 파싱 실패: {e}"))?;
    let inner = outer
        .get("body")
        .and_then(|b| b.as_str())
        .ok_or_else(|| "응답에 body 없음".to_owned())?;
    let doc: serde_json::Value =
        serde_json::from_str(inner).map_err(|e| format!("거래처 목록 파싱 실패: {e}"))?;
    let arr = doc
        .get("customers")
        .and_then(|c| c.as_array())
        .ok_or_else(|| "customers 배열 없음".to_owned())?;
    let ids: Vec<String> = arr
        .iter()
        .filter_map(|c| c.get("remoteId").and_then(|v| v.as_str()))
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .collect();
    Ok(ids)
}

/// 결과를 패널에 올린다. 실패해도 점검 자체는 유효하므로 경고만 남긴다.
fn upload(results: &[ProbeResult]) -> Result<usize, String> {
    let token = crate::chainremote_auth::get_token();
    if token.is_empty() {
        return Err("로그인이 필요합니다".to_owned());
    }
    let url = format!(
        "{}/api/customers/probe",
        crate::chainremote_auth::api_base()
    );
    let header = format!(
        r#"{{"Authorization":"Bearer {}","Content-Type":"application/json"}}"#,
        token.replace('"', "")
    );
    let body = serde_json::json!({
        "results": results.iter().map(|r| serde_json::json!({
            "remoteId": r.id,
            "direct": r.direct,
            "ms": r.ms,
        })).collect::<Vec<_>>()
    });
    let raw = crate::http_request_sync(url, "POST".to_owned(), Some(body.to_string()), header)
        .map_err(|e| e.to_string())?;
    let outer: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("응답 파싱 실패: {e}"))?;
    let inner = outer.get("body").and_then(|b| b.as_str()).unwrap_or("");
    let doc: serde_json::Value = serde_json::from_str(inner).unwrap_or_default();
    Ok(doc.get("updated").and_then(|v| v.as_u64()).unwrap_or(0) as usize)
}

/// 한 바퀴 — 목록 받기 → 순차 점검 → 결과 업로드 → 요약 한 줄.
///
/// ★블로킹이다. FFI 는 별도 스레드에서 부를 것 — `http_request_sync` 가 자체 tokio 런타임을
///   만들기 때문에(`#[tokio::main(current_thread)]`) 런타임 안에서 부르면 패닉한다.
///   그래서 목록·업로드는 런타임 **밖**에서 하고, 점검만 별도 런타임 안에서 돌린다.
pub fn run_once_blocking() -> String {
    let ids = match fetch_ids() {
        Ok(v) => v,
        Err(e) => {
            // ★실패도 반드시 로그로 남긴다. 첫 실행에서 DNS 가 죽어 목록을 못 받았는데
            //   로그가 한 줄도 없어 "눌렀는데 아무 일도 안 일어난다"로 한참 헤맸다.
            log::warn!("ChainRemote 경로 점검 실패 — 거래처 목록: {e}");
            return format!("점검 실패 — {e}");
        }
    };
    if ids.is_empty() {
        return "점검할 거래처가 없습니다".to_owned();
    }
    log::info!("ChainRemote 경로 점검 시작 — {}곳", ids.len());

    let results = {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(r) => r,
            Err(e) => return format!("점검 실패 — 런타임 생성: {e}"),
        };
        rt.block_on(probe_all(ids))
    };

    let direct = results.iter().filter(|r| r.direct == Some(true)).count();
    let relay = results.iter().filter(|r| r.direct == Some(false)).count();
    let failed = results.len() - direct - relay;
    let saved = match upload(&results) {
        Ok(n) => format!("{n}곳 저장"),
        Err(e) => {
            log::warn!("ChainRemote 경로 점검 결과 업로드 실패: {e}");
            "저장 실패(패널 확인 필요)".to_owned()
        }
    };
    format!(
        "점검 완료 — 직결 {direct}곳 · 서버 경유 {relay}곳 · 연결 안 됨 {failed}곳 ({saved})"
    )
}
