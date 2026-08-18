mod keyboard;
/// cbindgen:ignore
pub mod platform;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use platform::{
    clip_cursor, get_cursor, get_cursor_data, get_cursor_pos, get_focused_display,
    set_cursor_pos, start_os_service,
};
#[cfg(not(any(target_os = "ios")))]
/// cbindgen:ignore
mod server;
#[cfg(not(any(target_os = "ios")))]
pub use self::server::*;
mod client;
mod lan;
#[cfg(not(any(target_os = "ios")))]
mod rendezvous_mediator;
#[cfg(not(any(target_os = "ios")))]
pub use self::rendezvous_mediator::*;
/// cbindgen:ignore
pub mod common;
#[cfg(not(any(target_os = "ios")))]
pub mod ipc;
#[cfg(not(any(
    target_os = "android",
    target_os = "ios",
    feature = "cli",
    feature = "flutter"
)))]
pub mod ui;
mod version;
pub use version::*;
// ChainRemote 자체 버전. version.rs 는 빌드가 자동 생성해 .gitignore 라 별도 파일로 둔다.
mod chainremote_version;
pub use chainremote_version::*;
// 관리 패널 인증 (Phase 2-B)
pub mod chainremote_auth;
// 관리 패널 데이터 fetcher (Phase 2-C)
#[cfg(any(target_os = "android", target_os = "ios", feature = "flutter"))]
pub mod chainremote_data;
pub mod chainremote_direct;
pub mod chainremote_upnp;
// 연결 경로 점검(프로브) — HQ 에서만. 거래처 에이전트(Sciter/32비트)에는 없다.
#[cfg(any(target_os = "android", target_os = "ios", feature = "flutter"))]
pub mod chainremote_probe;
#[cfg(any(target_os = "android", target_os = "ios", feature = "flutter"))]
mod bridge_generated;
#[cfg(any(target_os = "android", target_os = "ios", feature = "flutter"))]
pub mod flutter;
#[cfg(any(target_os = "android", target_os = "ios", feature = "flutter"))]
pub mod flutter_ffi;
use common::*;
mod auth_2fa;
#[cfg(feature = "cli")]
pub mod cli;
#[cfg(not(target_os = "ios"))]
mod clipboard;
#[cfg(not(any(target_os = "android", target_os = "ios", feature = "cli")))]
pub mod core_main;
mod custom_server;
mod lang;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod port_forward;

#[cfg(all(feature = "flutter", feature = "plugin_framework"))]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod plugin;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod tray;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod whiteboard;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod updater;

// 자동업데이트 공용 로직(버전비교/sha256 검증) — push_agent 와 updater 가 공유.
// 일부러 플랫폼 무관하게 뒀다 → 단위테스트가 Mac/Linux 빌드에서도 돈다.
mod chainremote_update_common;

// 자체 업데이트 (NAS latest.json 폴링 — 윈도우만)
#[cfg(target_os = "windows")]
mod chainremote_updater;

// 거래처 heartbeat (Agent 빌드만, incoming-only — 윈도우만)
#[cfg(target_os = "windows")]
mod chainremote_heartbeat;

// 방화벽 자동 해제 관제 (마이그 028, Agent/옵션B+ 빌드만 — 윈도우만).
// heartbeat 응답이 켜고, 로컬 감시 스레드가 방화벽 재활성을 감지해 즉시 끈다 + 경고 알림 억제.
#[cfg(target_os = "windows")]
mod chainremote_firewall;

// VAN 카드결제 데몬 관제 (마이그 036, Agent/옵션B+ 빌드만 — 윈도우만).
// heartbeat 응답이 VAN 종류를 내려주면, 그 데몬이 포트를 듣고 있는지 감시하다 멈추면 되살린다.
#[cfg(target_os = "windows")]
mod chainremote_van;

// 예약원격 — 거래처가 승인한 "이 시간엔 수락 없이 들어와도 된다" 창.
//   본사가 시간대를 제안하고 사장님이 한 번 누르면 그 구간은 수락 카드가 안 뜬다.
//   ★영구 비밀번호와의 차이는 "거래처가 손으로 눌렀다" 하나뿐이다(모듈 주석 참조).
mod chainremote_sched;

// Agent 푸시 폴링 (Agent 빌드만). 관리 패널의 수동 푸시 트리거를 받는다.
// 2026-05-29 신설 — 영업시간 사고를 낸 옛 latest.json 자동 채널을 대체.
#[cfg(target_os = "windows")]
mod chainremote_push_agent;

// Phase 3-Win 마이그레이션(옛 RustDesk → 새 ChainRemote 데이터/서비스/레지스트리).
// 전 플랫폼에서 컴파일된다(Mac/Linux 는 빈 함수, 실제 로직은 Windows 만).
pub mod chainremote_migrate;

mod ui_cm_interface;
mod ui_interface;
mod ui_session_interface;

mod hbbs_http;

#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
pub mod clipboard_file;

pub mod privacy_mode;

#[cfg(windows)]
pub mod virtual_display_manager;

mod kcp_stream;
