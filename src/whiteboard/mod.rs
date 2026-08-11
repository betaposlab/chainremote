use serde_derive::{Deserialize, Serialize};

mod client;
mod server;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod win_linux;

#[cfg(target_os = "windows")]
use windows::create_event_loop;
#[cfg(target_os = "macos")]
use macos::create_event_loop;
#[cfg(target_os = "linux")]
pub use linux::is_supported;

pub use client::*;
pub use server::*;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "t", content = "c")]
pub enum CustomEvent {
    Cursor(Cursor),
    Clear,
    Exit,
    /// ChainRemote 마킹 — 본사가 그린 자유선 한 묶음. 커서(Cursor)와 달리 화면에 **남는다**.
    Mark(Mark),
}

/// 마킹 한 묶음. 좌표는 오버레이 창(=전체 디스플레이) 픽셀 기준.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Mark {
    pub points: Vec<(f32, f32)>,
    pub argb: u32,
    pub width: f32,
    /// 이 묶음으로 한 획이 끝났다 — 다음 점은 새 획이다.
    pub end_stroke: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "t")]
pub struct Cursor {
    pub x: f32,
    pub y: f32,
    pub argb: u32,
    pub btns: i32,
    pub text: String,
}

/// 이 기기에서 투명 오버레이가 성립하는가.
///
/// ★상류는 "Windows 10 이상"으로 잘라 뒀지만 그건 버전을 능력의 대리로 쓴 것이다. 실제로
///   필요한 건 **데스크톱 합성(DWM)** 이다 — 합성이 돌아야 창의 per-pixel 알파가 살아 화면
///   위에 선만 뜨고, 꺼져 있으면 불투명 사각형이 거래처 화면을 덮어 버린다.
///   Windows 8 이상은 합성을 끌 수 없어 언제나 참이고, **Windows 7 도 Aero 가 켜져 있으면
///   참이다.** 우리 플릿엔 Win7·Embedded 가 8대 있는데, 버전으로 자르면 그중 합성이 도는
///   기기까지 근거 없이 포기하게 된다(2026-08-12 Chang: "러스트데스크가 포기한 Win7 원격도
///   우리는 해냈다"). 그래서 버전이 아니라 합성 여부를 직접 묻는다.
#[cfg(target_os = "windows")]
pub fn is_overlay_supported() -> bool {
    let mut enabled: winapi::shared::minwindef::BOOL = 0;
    let hr = unsafe { winapi::um::dwmapi::DwmIsCompositionEnabled(&mut enabled) };
    // HRESULT 는 음수가 실패. 실패하면(아주 옛 OS) 오버레이를 안 띄운다 — 덮어쓰는 것보단 낫다.
    hr >= 0 && enabled != 0
}

#[cfg(target_os = "macos")]
pub fn is_overlay_supported() -> bool {
    true
}

#[cfg(target_os = "linux")]
pub fn is_overlay_supported() -> bool {
    // 리눅스는 상류가 이미 Wayland/X11 판정을 갖고 있다.
    is_supported()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn is_overlay_supported() -> bool {
    false
}
