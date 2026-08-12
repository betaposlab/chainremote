// 거래처 공유기가 UPnP(포트 열기)를 지원하는지 조사한다.
//
// ■ 왜 재는가 (2026-08-12)
//
// 홀펀칭이 실패하는 거래처가 실제로 있다. 테스트1 은 양쪽 다 Cone(ASYMMETRIC)으로 판정되는데
//   구멍 주소는 309ms 만에 받고도 그 주소로 접속이 안 돼 릴레이로 떨어진다. 즉 NAT 유형
//   판정만으로는 "직결이 되는가"를 못 맞춘다 — 상류의 판정은 **같은 서버 IP 의 두 포트**로만
//   재기 때문에, 목적지 IP 마다 포트를 바꾸는 공유기를 Cone 으로 잘못 센다.
//
// 그 벽을 넘는 방법이 UPnP 다. 공유기에 "이 포트를 나한테 열어 달라"고 **직접 요청**하므로
//   NAT 유형과 무관하게 직결이 선다. 다만 공유기가 UPnP 를 켜 뒀어야 한다 — 업무용 장비는
//   꺼 둔 경우가 많다. 그래서 포트 매핑 본체를 만들기 전에 **"우리 플릿에서 몇 곳이나 되는가"**
//   부터 센다. NAT 유형을 세어 UPnP 착수를 정하려던 것과 같은 방식이고, 짐작으로 큰 걸
//   만들었다가 헛수고하는 걸 이미 두 번 피했다.
//
// ■ 조사에서 실제 포트 열기로 (2026-08-12 오후)
//
// 조사 결과가 나왔다 — 26곳 중 14곳(54%)이 제어까지 열려 있었다. 절반이 넘으므로 세는 데서
//   멈추지 않고 **실제로 포트를 연다**. 순서는 그대로다: SSDP → 장치설명 → 읽기 전용
//   GetExternalIPAddress(제어가 사는지 확인) → AddPortMapping.
//   SSDP 응답만 보면 "광고는 하는데 제어는 막힌" 장비를 못 거르므로 읽기 전용 호출은 남긴다.
//
// ★임대(LEASE_SECS)를 반드시 건다. 영구 매핑은 에이전트가 죽거나 PC 를 치운 뒤에도 남의
//   공유기에 구멍을 남긴다. 살아 있는 동안만 절반 주기로 갱신하고, 꺼지면 저절로 닫힌다.
//
// ■ 결과값
//
//   ""        측정 전/불가(비 Windows 등)
//   "no"      IGD 를 못 찾음 — UPnP 가 꺼져 있거나 없는 공유기
//   "found"   IGD 는 찾았지만 제어 호출이 실패 — 광고만 하고 막아 둔 상태
//   "yes"     제어까지 성공(공인 IP 를 받아옴) — 포트 열기를 시도해 볼 수 있는 곳

use hbb_common::log;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

static RESULT: Mutex<Option<String>> = Mutex::new(None);
/// 공유기가 열어 준 바깥 주소("ip:port"). 본사가 여기로 곧장 붙는다.
static ENDPOINT: Mutex<Option<String>> = Mutex::new(None);

/// 매핑 임대 시간(초). ★영구 매핑을 걸지 않는다 — 에이전트가 죽거나 PC 를 치워도 남의
///   공유기에 구멍이 영영 남으면 안 된다. 짧게 걸고 살아 있는 동안 갱신한다.
const LEASE_SECS: u32 = 3600;
/// 갱신 주기 — 임대의 절반이면 한 번 실패해도 만료 전에 한 번 더 기회가 있다.
const RENEW_SECS: u64 = (LEASE_SECS / 2) as u64;

/// 이 거래처에 포트를 열어도 되는가(마이그041). heartbeat 응답이 정한다. **기본 꺼짐** —
///   포트를 열면 그 POS 가 인터넷에서 도달 가능해지므로 켠 곳에만 연다.
static ENABLED: AtomicBool = AtomicBool::new(false);
/// 이미 열어 뒀나 — 매 heartbeat 마다 다시 열지 않기 위한 래치.
static OPENED: AtomicBool = AtomicBool::new(false);

/// 조사 결과(캐시). 아직 안 끝났으면 빈 문자열.
pub fn result() -> String {
    RESULT.lock().unwrap().clone().unwrap_or_default()
}

/// 이 거래처가 포트 열기 대상인가 — 직접 접속 리스너를 켤지 판단하는 데도 쓴다.
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// 공유기가 열어 준 바깥 주소. 못 열었으면 빈 문자열.
pub fn endpoint() -> String {
    ENDPOINT.lock().unwrap().clone().unwrap_or_default()
}

/// heartbeat 가 알려 준 스위치를 반영한다. 켜지는 순간 한 번만 문을 연다.
///   끄면 갱신을 멈추고 보고할 주소를 지운다 — 임대가 만료되면 공유기 쪽도 저절로 닫힌다
///   (우리가 DeletePortMapping 을 못 보내고 죽는 경우까지 임대가 덮어 준다).
pub fn set_enabled(on: bool) {
    let was = ENABLED.swap(on, Ordering::SeqCst);
    if was == on {
        return;
    }
    // ★리스너는 **다른 프로세스**에서 돈다. 에이전트는 서비스 프로세스와 `--server`
    //   프로세스로 나뉘는데, 이 스위치를 받는 하트비트는 서비스 쪽이고 직접 접속 리스너
    //   (rendezvous_mediator::direct_server)는 `--server` 쪽이다. 메모리 안의 플래그는
    //   프로세스를 못 넘으므로, 포트만 열리고 정작 듣는 사람이 없었다(2026-08-12 실측:
    //   매핑은 성공했는데 그 주소로 붙으면 Connection refused).
    //   그래서 옵션으로 바꿔 IPC 로 넘긴다 — UI 가 설정을 바꿀 때 쓰는 기존 통로다.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    crate::ipc::set_option(
        hbb_common::config::keys::OPTION_DIRECT_SERVER,
        if on { "Y" } else { "" },
    );
    if on {
        log::info!("ChainRemote UPnP 포트 열기 켜짐 — 매핑을 시도한다");
        open_async();
    } else {
        log::info!("ChainRemote UPnP 포트 열기 꺼짐 — 갱신 중단, 임대 만료로 닫힌다");
        OPENED.store(false, Ordering::SeqCst);
        *ENDPOINT.lock().unwrap() = None;
    }
}

/// 백그라운드로 한 번 조사한다. 부팅 경로에서 부르되 **절대 블로킹하지 않는다** —
///   공유기가 응답을 안 하면 몇 초씩 걸리는데 그동안 에이전트가 멈추면 안 된다.
pub fn probe_async() {
    std::thread::spawn(|| {
        let r = probe();
        log::info!("ChainRemote UPnP 조사 결과: {}", r);
        *RESULT.lock().unwrap() = Some(r);
    });
}

fn probe() -> String {
    let Some(location) = discover() else {
        return "no".to_owned();
    };
    let Some((url, service)) = control_url(&location) else {
        return "found".to_owned();
    };
    let Some(external_ip) = get_external_ip(&url, &service) else {
        return "found".to_owned();
    };
    // 제어가 열려 있다는 것까지가 조사다. **여기서 포트를 열지는 않는다** — 여는 건
    //   거래처별 스위치가 켜졌을 때만(set_enabled → open_async).
    let _ = external_ip;
    "yes".to_owned()
}

/// 스위치가 켜졌을 때 실제로 문을 연다. 조사와 같은 경로를 다시 타고 AddPortMapping 까지.
fn open_async() {
    std::thread::spawn(|| {
        if OPENED.swap(true, Ordering::SeqCst) {
            return; // 이미 열어 뒀다
        }
        let Some(location) = discover() else {
            OPENED.store(false, Ordering::SeqCst);
            return;
        };
        let Some((url, service)) = control_url(&location) else {
            OPENED.store(false, Ordering::SeqCst);
            return;
        };
        let Some(external_ip) = get_external_ip(&url, &service) else {
            OPENED.store(false, Ordering::SeqCst);
            return;
        };
        let Some(local_ip) = local_ip_for(&url) else {
            OPENED.store(false, Ordering::SeqCst);
            return;
        };
        let port = crate::rendezvous_mediator::cr_direct_port() as u16;
        if add_mapping(&url, &service, &local_ip, port) {
            *ENDPOINT.lock().unwrap() = Some(format!("{external_ip}:{port}"));
            log::info!("ChainRemote UPnP 포트 매핑 성공: {external_ip}:{port}");
            spawn_renew(url, service, local_ip, port);
        } else {
            log::info!("ChainRemote UPnP 제어는 되지만 포트 매핑은 거부됨");
            OPENED.store(false, Ordering::SeqCst);
        }
    });
}

/// 임대가 끝나기 전에 다시 건다. 실패해도 조용히 — 다음 주기에 또 시도한다.
fn spawn_renew(url: String, service: String, local_ip: String, port: u16) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(RENEW_SECS));
        // 스위치가 꺼졌으면 갱신을 멈춘다 — 임대가 만료되며 공유기 쪽도 닫힌다.
        if !ENABLED.load(Ordering::SeqCst) {
            log::info!("ChainRemote UPnP 갱신 종료(스위치 꺼짐)");
            return;
        }
        if !add_mapping(&url, &service, &local_ip, port) {
            log::warn!("ChainRemote UPnP 매핑 갱신 실패 — 다음 주기에 재시도");
        }
    });
}

/// 공유기와 통신할 때 쓰는 우리 쪽 사설 IP. 매핑의 내부 주소로 넣어야 한다.
///   랜카드가 여럿이면(가상 어댑터 등) 어느 IP 를 넣을지가 문제라, 실제로 공유기까지
///   나가는 경로의 IP 를 커널에게 물어본다(UDP connect 는 패킷을 안 보낸다).
fn local_ip_for(url: &str) -> Option<String> {
    let rest = url.strip_prefix("http://")?;
    let hostport = rest.split('/').next()?;
    let addr = hostport.to_socket_addrs().ok()?.next()?;
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect(addr).ok()?;
    Some(sock.local_addr().ok()?.ip().to_string())
}

fn add_mapping(url: &str, service: &str, local_ip: &str, port: u16) -> bool {
    let body = format!(
        "<?xml version=\"1.0\"?>\
         <s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" \
         s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
         <s:Body><u:AddPortMapping xmlns:u=\"{service}\">\
         <NewRemoteHost></NewRemoteHost>\
         <NewExternalPort>{port}</NewExternalPort>\
         <NewProtocol>TCP</NewProtocol>\
         <NewInternalPort>{port}</NewInternalPort>\
         <NewInternalClient>{local_ip}</NewInternalClient>\
         <NewEnabled>1</NewEnabled>\
         <NewPortMappingDescription>ChainRemote</NewPortMappingDescription>\
         <NewLeaseDuration>{lease}</NewLeaseDuration>\
         </u:AddPortMapping></s:Body></s:Envelope>",
        lease = LEASE_SECS
    );
    let extra = format!(
        "SOAPAction: \"{service}#AddPortMapping\"\r\nContent-Type: text/xml; charset=\"utf-8\"\r\n"
    );
    match http_request(url, "POST", &extra, Some(&body)) {
        // 성공은 200 + AddPortMappingResponse. 공유기가 거부하면 500 + UPnPError 를 준다.
        Some(resp) => resp.contains("AddPortMappingResponse") && !resp.contains("UPnPError"),
        None => false,
    }
}

/// SSDP M-SEARCH — 같은 랜의 공유기(IGD)에게 자기 소개 주소를 묻는다.
fn discover() -> Option<String> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.set_read_timeout(Some(Duration::from_millis(1200))).ok()?;
    // MX 는 응답을 흩뿌리는 최대 지연(초). 1 로 두어 조사 시간을 짧게 묶는다.
    let msg = "M-SEARCH * HTTP/1.1\r\n\
               HOST: 239.255.255.250:1900\r\n\
               MAN: \"ssdp:discover\"\r\n\
               MX: 1\r\n\
               ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n";
    sock.send_to(msg.as_bytes(), "239.255.255.250:1900").ok()?;

    let mut buf = [0u8; 2048];
    // 랜에 장비가 여러 대면 여러 응답이 온다 — 처음 오는 IGD 하나면 충분하다.
    for _ in 0..4 {
        let Ok((n, _)) = sock.recv_from(&mut buf) else {
            break;
        };
        let text = String::from_utf8_lossy(&buf[..n]);
        for line in text.lines() {
            let lower = line.to_ascii_lowercase();
            if let Some(rest) = lower.strip_prefix("location:") {
                let _ = rest;
                // 값은 원문에서 잘라야 한다(대소문자를 바꿔 놓으면 URL 이 깨질 수 있다).
                if let Some(v) = line.splitn(2, ':').nth(1) {
                    let v = v.trim();
                    if v.starts_with("http") {
                        return Some(v.to_owned());
                    }
                }
            }
        }
    }
    None
}

/// 장치 설명 XML 을 받아 WAN 연결 서비스의 제어 주소를 찾는다.
fn control_url(location: &str) -> Option<(String, String)> {
    let xml = http_get(location)?;
    // 정식 XML 파서를 붙일 만한 일이 아니다 — 우리가 찾는 건 두 서비스 중 하나의
    //   serviceType 과 그 뒤에 오는 controlURL 뿐이고, 형식은 UPnP 규격이 고정한다.
    for service in [
        "urn:schemas-upnp-org:service:WANIPConnection:1",
        "urn:schemas-upnp-org:service:WANPPPConnection:1",
        "urn:schemas-upnp-org:service:WANIPConnection:2",
    ] {
        if let Some(pos) = xml.find(service) {
            let tail = &xml[pos..];
            if let Some(cs) = tail.find("<controlURL>") {
                let after = &tail[cs + "<controlURL>".len()..];
                if let Some(ce) = after.find("</controlURL>") {
                    let path = after[..ce].trim();
                    return Some((join_url(location, path), service.to_owned()));
                }
            }
        }
    }
    None
}

/// 읽기 전용 제어 호출 — 공인 IP 를 물어본다. 성공하면 이 공유기는 제어까지 열려 있다.
fn get_external_ip(url: &str, service: &str) -> Option<String> {
    let body = format!(
        "<?xml version=\"1.0\"?>\
         <s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" \
         s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">\
         <s:Body><u:GetExternalIPAddress xmlns:u=\"{service}\"/></s:Body></s:Envelope>"
    );
    let extra = format!(
        "SOAPAction: \"{service}#GetExternalIPAddress\"\r\nContent-Type: text/xml; charset=\"utf-8\"\r\n"
    );
    let resp = http_request(url, "POST", &extra, Some(&body))?;
    let start = resp.find("<NewExternalIPAddress>")? + "<NewExternalIPAddress>".len();
    let end = resp[start..].find("</NewExternalIPAddress>")?;
    let ip = resp[start..start + end].trim().to_owned();
    if ip.is_empty() || ip == "0.0.0.0" {
        None
    } else {
        Some(ip)
    }
}

fn http_get(url: &str) -> Option<String> {
    http_request(url, "GET", "", None)
}

/// 아주 작은 HTTP 클라이언트.
///   공유기는 사설망 주소이고 응답도 작다. 여기에 reqwest 를 끌어들이면 32비트 페이로드까지
///   무게가 늘어나므로 표준 라이브러리로 끝낸다.
fn http_request(url: &str, method: &str, extra: &str, body: Option<&str>) -> Option<String> {
    let rest = url.strip_prefix("http://")?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let addr = hostport.to_socket_addrs().ok()?.next()?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(1500)).ok()?;
    stream.set_read_timeout(Some(Duration::from_millis(2000))).ok()?;
    stream.set_write_timeout(Some(Duration::from_millis(1500))).ok()?;

    let payload = body.unwrap_or("");
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {hostport}\r\nConnection: close\r\n\
         Content-Length: {}\r\n{extra}\r\n{payload}",
        payload.len()
    );
    stream.write_all(req.as_bytes()).ok()?;

    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                out.extend_from_slice(&buf[..n]);
                // 공유기 설명 XML 이 수십 KB 를 넘는 일은 없다 — 무한정 읽지 않는다.
                if out.len() > 256 * 1024 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    Some(String::from_utf8_lossy(&out).into_owned())
}

/// LOCATION 이 준 절대 주소를 기준으로 controlURL(상대 경로일 수 있다)을 푼다.
fn join_url(base: &str, path: &str) -> String {
    if path.starts_with("http") {
        return path.to_owned();
    }
    let rest = base.strip_prefix("http://").unwrap_or(base);
    let hostport = rest.split('/').next().unwrap_or(rest);
    if path.starts_with('/') {
        format!("http://{hostport}{path}")
    } else {
        format!("http://{hostport}/{path}")
    }
}
