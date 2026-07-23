//! 방화벽 자동 해제 관제 (패널 마이그 028) — 메인+오더 POS 구성에서만 켠다.
//!
//! 배경: 메인 POS 와 오더(주방/서브) POS 는 방화벽을 꺼야 주문 전달·프린터 공유가 된다.
//! 그런데 Windows 업데이트가 방화벽을 임의로 되살려, 어느 날 갑자기 주문이 안 넘어간다.
//! (카드 승인은 리더기 COM 직결 + VAN 아웃바운드라 방화벽과 무관 — 인바운드만 끊긴다.)
//!
//! 동작: 패널에서 거래처별로 [방화벽 설정 → 자동 해제 켜기] 하면, heartbeat 응답에
//! firewallControl=true 가 실려온다. 그러면 로컬 감시 스레드가 ~5초마다 방화벽 상태를
//! 레지스트리로 확인하고, 켜져 있으면 즉시 `netsh advfirewall set allprofiles state off`
//! 로 끈다. 동시에 "방화벽이 꺼져 있습니다" 보안센터 경고 알림도 정책 키로 억제한다
//! (사장님이 무심코 눌러 방화벽을 다시 켜는 사고 방지).
//!
//! 서버 보고: heartbeat 가 firewallEnabled(현재 켜짐 여부) + firewallDisarmed(지난 보고 후
//! 자동 해제 발생)를 싣는다. 패널은 자동 해제 누적을 표시 — 잦으면 그 기기 업데이트가 잦다는 신호.
//!
//! 감시는 전부 로컬(레지스트리 읽기)이라 NAS/서버에 부하가 없다. 저사양 POS 도 무해.
//! LocalSystem 서비스 컨텍스트라 netsh/레지스트리 쓰기에 UAC 가 없다.

#![cfg(target_os = "windows")]

use hbb_common::log;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// 이 거래처가 방화벽 자동 해제 대상인가 — heartbeat 응답이 매번 갱신한다.
static CONTROL: AtomicBool = AtomicBool::new(false);
/// 마지막 heartbeat 보고 이후 자동 해제가 한 번이라도 일어났나(보고 후 서버가 카운트++).
static DISARMED_PENDING: AtomicBool = AtomicBool::new(false);

/// 감시 주기 — 방화벽이 다시 켜졌을 때 인바운드(주문 전달·프린터 공유) 단절이 지속되는 최대 시간.
/// 5초면 오더포스가 사실상 못 느낀다(주문은 재시도로 통과). 로컬 레지스트리 몇 개 읽기라
/// 저사양 POS 도 부하 무시 가능. (레지스트리 변경 이벤트로 <1초까지 줄일 수 있으나, 드문
///  이벤트에 unsafe FFI 를 프로덕션 POS 전체에 넣는 위험 대비 이득이 낮아 단순 폴링을 택함.)
const WATCH_INTERVAL: Duration = Duration::from_secs(5);

/// LocalConfig 캐시 키 — 마지막으로 알려진 관제 상태. 재부팅 후 heartbeat 전에도 즉시 무장용.
const CONTROL_CACHE_KEY: &str = "chainremote-firewall-control";

/// heartbeat 응답의 firewallControl 을 반영. 로컬 감시 스레드가 이 값을 읽는다.
/// 값을 로컬에도 저장해 재부팅 직후(heartbeat 전)에도 감시가 바로 무장되게 한다 — 업데이트가
/// 재부팅 중 방화벽을 되살리는 바로 그 순간에 대비한다. 값이 바뀔 때만 기록(불필요 쓰기 회피).
pub fn set_control(on: bool) {
    CONTROL.store(on, Ordering::Relaxed);
    let want = if on { "Y" } else { "N" };
    if hbb_common::config::LocalConfig::get_option(CONTROL_CACHE_KEY) != want {
        hbb_common::config::LocalConfig::set_option(
            CONTROL_CACHE_KEY.to_string(),
            want.to_string(),
        );
    }
}

/// 현재 방화벽 켜짐 여부(heartbeat 보고용). 판단 불가면 None.
pub fn current_enabled() -> Option<bool> {
    firewall_state()
}

/// 지난 보고 후 자동 해제가 있었나(reset 없이 확인만 — 전송 성공 시 clear_disarmed 로 지운다).
pub fn peek_disarmed() -> bool {
    DISARMED_PENDING.load(Ordering::Relaxed)
}

/// 자동 해제 보고가 서버에 닿은 뒤 플래그를 지운다(전송 실패 시엔 남겨 다음 heartbeat 에 재보고).
pub fn clear_disarmed() {
    DISARMED_PENDING.store(false, Ordering::Relaxed);
}

/// 감시 스레드 시작 — heartbeat 로프와 함께 서비스 진입점에서 1회 호출.
/// CONTROL 이 off 인 동안은 그냥 잠만 잔다(대다수 거래처).
pub fn start_watch() {
    // 부팅 즉시 무장 — 마지막으로 알려진 관제 상태를 로컬 캐시에서 읽어, heartbeat(최대 ~2분)를
    //   기다리지 않고 감시를 켠다. 재부팅=업데이트가 방화벽을 되살리는 바로 그 상황이라 공백 0 이 관건.
    if hbb_common::config::LocalConfig::get_option(CONTROL_CACHE_KEY) == "Y" {
        CONTROL.store(true, Ordering::Relaxed);
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(WATCH_INTERVAL);
        if !CONTROL.load(Ordering::Relaxed) {
            continue;
        }
        // 관제 대상이면: 알림 억제 정책을 확인·보정하고(방화벽이 꺼진 상태에서도 경고가
        // 뜨므로 해제 여부와 무관하게 매 주기 자가치유 — 업데이트/정책 새로고침이 되돌려도
        // 다음 주기에 복구), 방화벽이 켜졌으면 즉시 끈다.
        ensure_notifications_suppressed();
        match firewall_state() {
            Some(true) => {
                log::info!("[chainremote_firewall] firewall re-enabled → disarming (netsh off)");
                if disarm_all_profiles() {
                    DISARMED_PENDING.store(true, Ordering::Relaxed);
                    // 업데이트가 방화벽을 되살릴 때 알림 정책까지 되돌렸을 수 있어 즉시 재보정.
                    ensure_notifications_suppressed();
                }
            }
            Some(false) => {}
            None => {}
        }
    });
}

/// 방화벽 상태를 레지스트리로 읽는다 — netsh 출력 파싱은 로케일(한국어 "설정/사용")에 취약해
/// EnableFirewall DWORD 를 직접 본다. 세 프로파일 중 하나라도 1이면 켜짐으로 판정.
/// 값이 없으면 Windows 기본이 '켜짐'이라 1로 간주. 프로파일 키 전부를 못 읽으면 None.
fn firewall_state() -> Option<bool> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let base =
        "SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy";
    let mut readable = false;
    for profile in ["StandardProfile", "PublicProfile", "DomainProfile"] {
        if let Ok(k) =
            hklm.open_subkey_with_flags(format!("{}\\{}", base, profile), KEY_READ)
        {
            readable = true;
            let v: u32 = k.get_value("EnableFirewall").unwrap_or(1);
            if v == 1 {
                return Some(true);
            }
        }
    }
    if readable {
        Some(false)
    } else {
        None
    }
}

/// 전 프로파일 즉시 해제 — 레지스트리만 쓰면 서비스 리프레시 전까지 미적용이라, 즉시
/// 반영되는 netsh 를 쓴다(netsh 가 EnableFirewall=0 도 같이 써 위 판정과 일관). 창 없이 실행.
fn disarm_all_profiles() -> bool {
    run_hidden(
        "netsh",
        &["advfirewall", "set", "allprofiles", "state", "off"],
    )
}

/// "방화벽이 꺼져 있습니다" 보안센터 경고 알림 억제 — 매 감시 주기에 정책 값을 확인해
/// 1이 아니면(업데이트·정책 새로고침·보안센터 재설정이 되돌렸을 수 있음) 다시 1로 세운다
/// (자가치유). 알림 정책 키는 방화벽 레지스트리와 독립 위치라, 방화벽은 그대로인데 알림만
/// 되살아나는 경우까지 다음 주기에 잡는다. 레지스트리 읽기·쓰기는 마이크로초라 90초마다
/// 확인해도 부하가 없다. 제어판 토글은 재발하지만(2026-07 Chang 실측) 이 정책 키(gpedit
/// "보안센터 알림 끄기"와 동일)는 확실하다:
///   HKLM\SOFTWARE\Policies\Microsoft\Windows Defender Security Center\Notifications
///   \DisableNotifications=1 (방화벽 꺼짐은 '중요' 알림이라 EnhancedNotifications 만으로는
///   안 꺼져 전체 off). Win7 엔 이 경로가 없어 무해한 미사용 키가 된다.
fn ensure_notifications_suppressed() {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let path =
        "SOFTWARE\\Policies\\Microsoft\\Windows Defender Security Center\\Notifications";
    // 이미 1이면 아무것도 안 한다(불필요한 쓰기·로그 회피). 값이 없거나 1이 아니면 아래서 보정.
    if let Ok(k) = hklm.open_subkey_with_flags(path, KEY_READ) {
        if k.get_value::<u32, _>("DisableNotifications").unwrap_or(0) == 1 {
            return;
        }
    }
    match hklm.create_subkey(path) {
        Ok((k, _)) => {
            if let Err(e) = k.set_value("DisableNotifications", &1u32) {
                log::warn!("[chainremote_firewall] set DisableNotifications failed: {}", e);
            } else {
                log::info!("[chainremote_firewall] security-center firewall notifications suppressed");
            }
        }
        Err(e) => {
            log::warn!("[chainremote_firewall] open Notifications policy key failed: {}", e);
        }
    }
}

/// 콘솔 창 없이 외부 명령 실행(netsh). LocalSystem 세션0 이라 창이 뜰 일은 없지만 방어적으로
/// CREATE_NO_WINDOW. 성공(exit 0) 시 true.
fn run_hidden(program: &str, args: &[&str]) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match std::process::Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(s) => s.success(),
        Err(e) => {
            log::warn!("[chainremote_firewall] run {} failed: {}", program, e);
            false
        }
    }
}
