//! 알려진 감염 흔적 점검 (패널 마이그 061) — "있다/없다"만 본다. 백신이 아니다.
//!
//! 2026-10-20: 사무실 재고 윈7 포스 4대가 모두 같은 백도어(Dr.Web BackDoor.KCNA.11 / Kaspersky
//! 2015 "Bright Star" 계열)에 걸려 있었다. 회수한 포스를 다시 세팅하던 방식(부팅 USB + 크랙 인증)이
//! 운반체로 보이고, 그 방식으로 세팅해 매장에 나간 포스가 있다(우리 에이전트가 깔린 채 돌아온 PC 도
//! 그중 하나였다). 매장을 하나하나 찾아가지 않고 가려내려고, 그 4대에서 실제로 확인된 흔적만
//! 점검해 heartbeat 로 보낸다. 패널은 운영자에게만 보여 준다.
//!
//! 보는 것(코드, 이 순서로 보낸다):
//!   launch      사용자 폴더 AppData\Roaming\Microsoft\Defender\launch.exe
//!   wdext       …\Microsoft\Messenger\Extension\WdExt.exe
//!   mscaps      …\Microsoft\Protect\SETUP\mscaps.exe
//!   wtime32     Windows\System32\wtime32.dll (64비트 윈도우면 SysWOW64 도)
//!   runkey      시작 프로그램 "Windows Defender Extension", 또는 위 파일을 띄우는 값(JREUpdate 등)
//!   selfappend  우리 ChainRemote.exe 뒤에 덧붙은 데이터
//!
//! selfappend 가 따로 있는 이유: 이 악성코드는 탐색기가 띄운 GUI exe 뒤에 자기를 붙인다. 우리
//! 트레이(--tray)는 로그온 때 탐색기가 Run 키로 띄운다 — 감염된 PC 라면 우리 파일이 대상이다.
//! 정상 빌드의 ChainRemote.exe 는 PE 이미지 끝이 곧 파일 끝이다(2026-10-20 1.4.154·157 x86·x64
//! 확인, 덧붙은 0바이트). 서명을 하게 되면 서명 영역까지를 끝으로 본다.
//!
//! 파일을 열어 실행하거나 지우지 않는다 — 존재 확인, 레지스트리 읽기, 우리 exe 의 헤더 읽기뿐.
//! 부팅 2분 뒤 한 번, 그다음 6시간마다. 몇 밀리초면 끝난다.

use std::sync::Mutex;

#[cfg(target_os = "windows")]
const FIRST_DELAY_SECS: u64 = 120;
#[cfg(target_os = "windows")]
const INTERVAL_SECS: u64 = 6 * 60 * 60;

/// (점검 시각 epoch, 코드 목록 "a,b" — 깨끗하면 ""). 점검 전이면 None.
static RESULT: Mutex<Option<(u64, String)>> = Mutex::new(None);

/// heartbeat 용. 아직 한 번도 점검하지 않았으면 None — 그때는 키를 싣지 않아 서버가 손대지 않는다.
pub fn result() -> Option<(u64, String)> {
    RESULT.lock().ok()?.clone()
}

/// 서비스(heartbeat 루프)에서 한 번 부른다. 윈도우가 아니면 아무것도 안 한다.
pub fn start() {
    #[cfg(target_os = "windows")]
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(FIRST_DELAY_SECS));
        let mut last: Option<String> = None;
        loop {
            let codes = join_codes(&win::scan());
            if last.as_deref() != Some(codes.as_str()) {
                if codes.is_empty() {
                    hbb_common::log::info!("[chainremote_infect_check] 알려진 감염 흔적 없음");
                } else {
                    hbb_common::log::warn!("[chainremote_infect_check] 알려진 감염 흔적: {codes}");
                }
                last = Some(codes.clone());
            }
            if let Ok(mut r) = RESULT.lock() {
                *r = Some((now_epoch(), codes));
            }
            std::thread::sleep(std::time::Duration::from_secs(INTERVAL_SECS));
        }
    });
}

#[cfg(target_os = "windows")]
fn now_epoch() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 보낼 순서를 고정한다 — 같은 상태면 같은 문자열이 되어야 서버·로그에서 변화를 셀 수 있다.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const ORDER: [&str; 6] = ["launch", "wdext", "mscaps", "wtime32", "runkey", "selfappend"];

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn join_codes(found: &[&str]) -> String {
    ORDER
        .iter()
        .filter(|c| found.contains(c))
        .copied()
        .collect::<Vec<_>>()
        .join(",")
}

/// PE 파일 끝에 덧붙은 바이트 수. PE 가 아니거나 헤더가 깨졌으면 None.
///   이미지 끝 = 섹션들의 (파일 위치 + 크기) 중 최댓값. 서명이 있으면 서명 영역 끝까지를 정상으로 본다.
pub fn appended_bytes(path: &std::path::Path) -> Option<u64> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let mut head = vec![0u8; 4096];
    let n = f.read(&mut head).ok()?;
    head.truncate(n);

    let rd16 = |b: &[u8], o: usize| b.get(o..o + 2).map(|s| u16::from_le_bytes([s[0], s[1]]));
    let rd32 =
        |b: &[u8], o: usize| b.get(o..o + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]));

    if head.get(0..2)? != b"MZ" {
        return None;
    }
    let pe = rd32(&head, 0x3C)? as usize;
    if head.get(pe..pe + 4)? != b"PE\0\0" {
        return None;
    }
    let sections = rd16(&head, pe + 6)? as usize;
    let opt_size = rd16(&head, pe + 20)? as usize;
    let opt = pe + 24;
    let dirs = match rd16(&head, opt)? {
        0x10b => opt + 96,  // PE32
        0x20b => opt + 112, // PE32+
        _ => return None,
    };
    // 데이터 디렉터리 4번 = 인증서(서명) 테이블. 여기만 파일 오프셋이다.
    let cert_off = rd32(&head, dirs + 4 * 8)? as u64;
    let cert_size = rd32(&head, dirs + 4 * 8 + 4)? as u64;
    let table = opt + opt_size;
    let need = table + sections * 40;
    if need > head.len() {
        let mut more = vec![0u8; need - head.len()];
        f.read_exact(&mut more).ok()?;
        head.extend_from_slice(&more);
    }
    let mut image_end = 0u64;
    for i in 0..sections {
        let s = table + i * 40;
        let raw_size = rd32(&head, s + 16)? as u64;
        let raw_ptr = rd32(&head, s + 20)? as u64;
        image_end = image_end.max(raw_ptr + raw_size);
    }
    let cert_end = if cert_size > 0 { cert_off + cert_size } else { 0 };
    Some(len.saturating_sub(image_end.max(cert_end)))
}

#[cfg(target_os = "windows")]
mod win {
    use std::path::{Path, PathBuf};
    use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_USERS, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY};
    use winreg::RegKey;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    pub fn scan() -> Vec<&'static str> {
        let mut found = Vec::new();
        let profiles = profile_dirs();
        let any = |rel: &str| profiles.iter().any(|p| p.join(rel).exists());
        if any(r"AppData\Roaming\Microsoft\Defender\launch.exe") {
            found.push("launch");
        }
        if any(r"AppData\Roaming\Microsoft\Messenger\Extension\WdExt.exe") {
            found.push("wdext");
        }
        if any(r"AppData\Roaming\Microsoft\Protect\SETUP\mscaps.exe") {
            found.push("mscaps");
        }
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".to_string());
        if Path::new(&root).join(r"System32\wtime32.dll").exists()
            || Path::new(&root).join(r"SysWOW64\wtime32.dll").exists()
        {
            found.push("wtime32");
        }
        if run_keys_suspicious() {
            found.push("runkey");
        }
        if let Ok(exe) = std::env::current_exe() {
            if matches!(super::appended_bytes(&exe), Some(n) if n > 0) {
                found.push("selfappend");
            }
        }
        found
    }

    /// 사용자 프로필 폴더들. 레지스트리 ProfileList 가 정본이고(프로필이 C:\Users 밖일 수 있다),
    ///   못 읽으면 C:\Users 아래 폴더로 대신한다.
    fn profile_dirs() -> Vec<PathBuf> {
        let mut out = Vec::new();
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(list) = hklm.open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList",
            KEY_READ,
        ) {
            for sid in list.enum_keys().flatten() {
                // 일반 사용자만(S-1-5-21-…). 시스템 계정 프로필은 Windows 폴더 안이라 볼 일이 없다.
                if !sid.starts_with("S-1-5-21-") {
                    continue;
                }
                if let Ok(k) = list.open_subkey_with_flags(&sid, KEY_READ) {
                    if let Ok(p) = k.get_value::<String, _>("ProfileImagePath") {
                        out.push(PathBuf::from(expand(&p)));
                    }
                }
            }
        }
        if out.is_empty() {
            let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
            if let Ok(rd) = std::fs::read_dir(format!(r"{drive}\Users")) {
                out.extend(rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
            }
        }
        out
    }

    /// ProfileImagePath 는 %SystemDrive% 같은 변수가 든 채로 저장되기도 한다.
    fn expand(p: &str) -> String {
        let mut s = p.to_string();
        for var in ["SystemDrive", "SystemRoot"] {
            if let Ok(v) = std::env::var(var) {
                let pat = format!("%{var}%");
                while let Some(i) = s.to_ascii_lowercase().find(&pat.to_ascii_lowercase()) {
                    s.replace_range(i..i + pat.len(), &v);
                }
            }
        }
        s
    }

    /// 로그온 중인 사용자(HKEY_USERS 에 올라온 하이브)와 HKLM 의 Run 키에서 이 백도어의 자동 실행 값을 찾는다.
    ///   로그온하지 않은 사용자의 Run 은 하이브가 안 올라와 있어 못 본다 — 그 경우는 파일 점검이 잡는다.
    fn run_keys_suspicious() -> bool {
        let users = RegKey::predef(HKEY_USERS);
        for sid in users.enum_keys().flatten() {
            if sid.ends_with("_Classes") {
                continue;
            }
            if let Ok(k) = users.open_subkey_with_flags(format!(r"{sid}\{RUN}"), KEY_READ) {
                if run_key_suspicious(&k) {
                    return true;
                }
            }
        }
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
            if let Ok(k) = hklm.open_subkey_with_flags(RUN, KEY_READ | view) {
                if run_key_suspicious(&k) {
                    return true;
                }
            }
        }
        false
    }

    fn run_key_suspicious(k: &RegKey) -> bool {
        k.enum_values().flatten().any(|(name, value)| {
            let data = value.to_string().to_ascii_lowercase();
            name.eq_ignore_ascii_case("Windows Defender Extension")
                || data.contains(r"\microsoft\defender\launch.exe")
                || data.contains(r"\microsoft\protect\setup\mscaps.exe")
                || data.contains(r"\microsoft\messenger\extension\wdext.exe")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 섹션 하나짜리 최소 PE32 를 만든다. 이미지 끝 = 0x400.
    fn tiny_pe(cert: Option<(u32, u32)>) -> Vec<u8> {
        let mut b = vec![0u8; 0x400];
        b[0..2].copy_from_slice(b"MZ");
        b[0x3C..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        let pe = 0x80;
        b[pe..pe + 4].copy_from_slice(b"PE\0\0");
        b[pe + 6..pe + 8].copy_from_slice(&1u16.to_le_bytes()); // 섹션 1개
        b[pe + 20..pe + 22].copy_from_slice(&0xE0u16.to_le_bytes()); // PE32 선택 헤더 크기
        let opt = pe + 24;
        b[opt..opt + 2].copy_from_slice(&0x10bu16.to_le_bytes());
        if let Some((off, size)) = cert {
            let d = opt + 96 + 4 * 8;
            b[d..d + 4].copy_from_slice(&off.to_le_bytes());
            b[d + 4..d + 8].copy_from_slice(&size.to_le_bytes());
        }
        let s = opt + 0xE0;
        b[s + 16..s + 20].copy_from_slice(&0x200u32.to_le_bytes()); // 원시 크기
        b[s + 20..s + 24].copy_from_slice(&0x200u32.to_le_bytes()); // 파일 위치
        b
    }

    fn write_tmp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("cr-infect-{}-{name}", std::process::id()));
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn clean_pe_has_nothing_appended() {
        let p = write_tmp("clean", &tiny_pe(None));
        assert_eq!(appended_bytes(&p), Some(0));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn appended_tail_is_counted() {
        let mut b = tiny_pe(None);
        b.extend_from_slice(&[0xAB; 1234]);
        let p = write_tmp("tail", &b);
        assert_eq!(appended_bytes(&p), Some(1234));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn signature_area_is_not_a_tail() {
        let mut b = tiny_pe(Some((0x400, 0x10)));
        b.extend_from_slice(&[0u8; 0x10]);
        let p = write_tmp("signed", &b);
        assert_eq!(appended_bytes(&p), Some(0));
        b.extend_from_slice(&[1u8; 7]);
        let p2 = write_tmp("signed-tail", &b);
        assert_eq!(appended_bytes(&p2), Some(7));
        let _ = std::fs::remove_file(p);
        let _ = std::fs::remove_file(p2);
    }

    #[test]
    fn not_a_pe_is_none() {
        let p = write_tmp("text", b"hello, not a program");
        assert_eq!(appended_bytes(&p), None);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn codes_keep_a_fixed_order() {
        assert_eq!(join_codes(&["selfappend", "launch"]), "launch,selfappend");
        assert_eq!(join_codes(&[]), "");
    }
}
