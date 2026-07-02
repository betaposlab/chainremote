// Phase 3-Win 마이그레이션 — 옛 RustDesk 의 데이터/서비스/레지스트리/단축아이콘/자동시작을
// 새 ChainRemote 로 옮긴다. 거래처 PC 가 자동업데이트나 신규 인스톨러로 새 exe 를 받았을 때
// 옛 영구비번·peer 설정을 보존해 거래처가 재설정을 안 하게 하는 게 목적.
//
// 원칙:
// - 멱등: 마커 파일 있으면 두 번째 실행은 즉시 return.
// - 삭제하지 않고 복사만. 옛 데이터 정리는 인스톨러 [InstallDelete] 나 별도 cleanup 이.
// - 한 단계 실패해도 다음 단계 계속(log::warn! 로 남기기만).
//
// 호출은 core_main 의 가장 이른 시점, APP_NAME 쓰기 직전.

#![allow(unused_imports)]

use hbb_common::log;
use std::path::{Path, PathBuf};

/// 완료 마커 파일명 — 새 데이터 폴더 안에 박는다. v1 = 첫 마이그레이션 스킴,
/// 나중에 다른 스킴이 필요하면 v2/v3 로 분리.
const MIGRATION_MARKER: &str = ".chainremote_migrated_from_rustdesk_v1";

/// 옛 RustDesk 윈도우 서비스명 (ChainRemote core 이전, RustDesk 1.4.6 fork 기본값).
#[cfg(target_os = "windows")]
const OLD_SERVICE_NAME: &str = "RustDesk";

/// 옛 트레이/메인 프로세스명.
#[cfg(target_os = "windows")]
const OLD_EXE_NAMES: &[&str] = &["RustDesk.exe", "rustdesk.exe"];

/// 옛 APP_NAME (데이터 폴더명).
const OLD_APP_NAME: &str = "RustDesk";

/// 새 APP_NAME (데이터 폴더명). config.rs 의 APP_NAME 과 일치해야 한다.
const NEW_APP_NAME: &str = "ChainRemote";

/// 마이그레이션 진입점. core_main 최이른 시점 호출, 멱등, 한 단계 실패해도 계속.
pub fn migrate_from_rustdesk_once() {
    #[cfg(target_os = "windows")]
    {
        let new_data_root = match new_appdata_root() {
            Some(p) => p,
            None => {
                log::warn!("[chainremote_migrate] APPDATA 폴더를 찾을 수 없음. 마이그레이션 skip.");
                return;
            }
        };
        let marker = new_data_root.join(MIGRATION_MARKER);
        if marker.exists() {
            return; // 이미 돌았음
        }

        // 옛 데이터가 실제로 있나 본다. 없으면 clean install — 마커만 박고 끝.
        let old_data_root = old_appdata_root();
        let has_old_data = old_data_root.as_ref().map(|p| p.exists()).unwrap_or(false);
        let has_old_service = service_exists(OLD_SERVICE_NAME);

        if !has_old_data && !has_old_service {
            log::info!(
                "[chainremote_migrate] 옛 RustDesk 데이터/서비스 없음. clean install — 마커만 박고 종료."
            );
            let _ = std::fs::create_dir_all(&new_data_root);
            let _ = std::fs::write(&marker, b"clean_install");
            return;
        }

        log::info!(
            "[chainremote_migrate] 옛 RustDesk 발견 (data={}, service={}). 마이그레이션 시작.",
            has_old_data,
            has_old_service
        );

        // Step 1: 옛 트레이/메인 프로세스 종료(파일 잠금 회피).
        kill_old_processes();

        // Step 2: 옛 윈도우 서비스 stop + delete (sc.exe).
        if has_old_service {
            stop_and_delete_service(OLD_SERVICE_NAME);
        }

        // Step 3: APPDATA 의 사용자 모드 데이터 복사.
        if let Some(old) = old_data_root.as_ref() {
            if let Err(e) = copy_dir_recursive(old, &new_data_root) {
                log::warn!("[chainremote_migrate] APPDATA 복사 실패: {}", e);
            } else {
                log::info!("[chainremote_migrate] APPDATA 복사 완료: {:?} → {:?}", old, new_data_root);
            }
        }

        // Step 4: LocalService 의 서비스 모드 데이터 복사.
        // 옛: C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk
        // 새: C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote
        if let (Some(old_ls), Some(new_ls)) = (old_local_service_root(), new_local_service_root()) {
            if old_ls.exists() {
                if let Err(e) = copy_dir_recursive(&old_ls, &new_ls) {
                    log::warn!("[chainremote_migrate] LocalService 복사 실패: {}", e);
                } else {
                    log::info!(
                        "[chainremote_migrate] LocalService 복사 완료: {:?} → {:?}",
                        old_ls,
                        new_ls
                    );
                }
            }
        }

        // Step 5: HKLM\SOFTWARE\RustDesk → HKLM\SOFTWARE\ChainRemote 레지스트리 복사.
        if let Err(e) = copy_hklm_software_key(OLD_APP_NAME, NEW_APP_NAME) {
            log::warn!("[chainremote_migrate] HKLM 레지스트리 복사 실패: {}", e);
        }

        // Step 6: 옛 자동시작 키(HKCU\...\Run\RustDesk) 정리.
        // (단축아이콘 자체는 인스톨러가 ChainRemote.lnk 로 atomic rename 한다.)
        cleanup_old_autostart_key();

        // Step 7: 옛 단축아이콘(RustDesk.lnk) 정리.
        cleanup_old_shortcuts();

        // Step 8: 완료 마커 박기.
        let _ = std::fs::create_dir_all(&new_data_root);
        if let Err(e) = std::fs::write(&marker, b"migrated") {
            log::warn!("[chainremote_migrate] 마커 파일 쓰기 실패: {} ({:?})", e, marker);
        } else {
            log::info!("[chainremote_migrate] 마이그레이션 완료. 마커: {:?}", marker);
        }
    }

    // Mac/Linux 는 옛 데이터 안 건드림 (Mac 은 HQ 빌드뿐이라 굳이 위험 감수할 이유 없음).
    #[cfg(not(target_os = "windows"))]
    {
        let _ = MIGRATION_MARKER;
        let _ = OLD_APP_NAME;
        let _ = NEW_APP_NAME;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows 전용 helpers.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn new_appdata_root() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|s| PathBuf::from(s).join(NEW_APP_NAME))
}

#[cfg(target_os = "windows")]
fn old_appdata_root() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|s| PathBuf::from(s).join(OLD_APP_NAME))
}

#[cfg(target_os = "windows")]
fn local_service_root_base() -> Option<PathBuf> {
    // %SystemRoot%\ServiceProfiles\LocalService\AppData\Roaming
    let sys_root = std::env::var_os("SystemRoot").map(PathBuf::from)?;
    Some(
        sys_root
            .join("ServiceProfiles")
            .join("LocalService")
            .join("AppData")
            .join("Roaming"),
    )
}

#[cfg(target_os = "windows")]
fn old_local_service_root() -> Option<PathBuf> {
    local_service_root_base().map(|p| p.join(OLD_APP_NAME))
}

#[cfg(target_os = "windows")]
fn new_local_service_root() -> Option<PathBuf> {
    local_service_root_base().map(|p| p.join(NEW_APP_NAME))
}

#[cfg(target_os = "windows")]
fn service_exists(name: &str) -> bool {
    use std::process::Command;
    Command::new("sc")
        .args(["query", name])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn stop_and_delete_service(name: &str) {
    use std::process::Command;
    // stop (실패 무시 — 이미 멈춰 있을 수 있음).
    let _ = Command::new("sc").args(["stop", name]).output();

    // STOPPED 될 때까지 최대 30초 polling. 옛날엔 1.5초 sleep 뒤 바로 delete 했다가
    // STOP_PENDING 상태에서 delete 가 거부돼 옛 서비스가 잔류하는 사고를 냈다(2026-05-25).
    // sc query 출력은 영문 'STOPPED' 와 한국어 윈도우 '중지됨' 둘 다 봐야 한다
    // (메모리 [project_v127_build_pitfalls] 한국어 윈도우 sc 출력 함정).
    for _ in 0..30 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        match Command::new("sc").args(["query", name]).output() {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout);
                if s.contains("STOPPED") || s.contains("중지됨") {
                    break;
                }
                // 서비스 자체가 없으면(sc 1060) 이미 정리된 것 → break.
                if !out.status.success() {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    // delete.
    match Command::new("sc").args(["delete", name]).output() {
        Ok(out) if out.status.success() => {
            log::info!("[chainremote_migrate] 옛 서비스 '{}' 제거 완료.", name);
        }
        Ok(out) => {
            log::warn!(
                "[chainremote_migrate] 옛 서비스 '{}' 제거 실패: {}",
                name,
                String::from_utf8_lossy(&out.stderr)
            );
        }
        Err(e) => log::warn!("[chainremote_migrate] sc delete 실행 실패: {}", e),
    }
}

#[cfg(target_os = "windows")]
fn kill_old_processes() {
    use std::process::Command;
    for name in OLD_EXE_NAMES {
        // /F 강제 + /T 자식까지. 실패 무시.
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/IM", name])
            .output();
    }
}

#[cfg(target_os = "windows")]
fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !src.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let src_path = entry.path();
        // 파일명의 RustDesk/rustdesk 접두사를 ChainRemote 로 바꿔 복사 (2026-05-25 v2 fix).
        // 새 core 는 APP_NAME 을 따라 ChainRemote.toml / ChainRemote2.toml /
        // ChainRemote_default.toml 을 찾는다. 옛 RustDesk*.toml 을 이름 그대로 옮기면 못 읽고
        // 빈 toml 을 새로 만들어 영구비번·peer config 를 잃는다 — v1 마이그레이션의 핵심 버그였다.
        // 접두사 변환은 최상위 파일만. peers/ 안 ID 기반 파일은 그대로 둔다.
        let dst_name = rename_legacy(&entry.file_name());
        let dst_path = dst.join(&dst_name);
        if ft.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if ft.is_file() {
            // 새 경로에 같은 파일이 이미 있으면 안 덮는다 — 우리가 만든 데이터일 수 있고,
            // 옛 데이터로 덮으면 새 설정을 잃는다.
            if !dst_path.exists() {
                if let Err(e) = std::fs::copy(&src_path, &dst_path) {
                    log::warn!(
                        "[chainremote_migrate] 파일 복사 실패: {:?} → {:?}: {}",
                        src_path,
                        dst_path,
                        e
                    );
                }
            }
        }
        // 심볼릭 링크/디바이스 등은 무시.
    }
    Ok(())
}

/// 파일명 앞의 RustDesk/rustdesk 접두사를 ChainRemote 로 바꾼다(대소문자 둘 다).
/// 예: "RustDesk2.toml" → "ChainRemote2.toml", "rustdesk_r....log" → "ChainRemote_r....log".
/// prefix 없는 것(peers 디렉터리, "445497548.toml" 등)은 그대로 둔다.
#[cfg(target_os = "windows")]
fn rename_legacy(name: &std::ffi::OsStr) -> std::ffi::OsString {
    let s = name.to_string_lossy();
    if let Some(rest) = s.strip_prefix("RustDesk") {
        let mut out = String::from("ChainRemote");
        out.push_str(rest);
        return out.into();
    }
    if let Some(rest) = s.strip_prefix("rustdesk") {
        let mut out = String::from("ChainRemote");
        out.push_str(rest);
        return out.into();
    }
    name.to_owned()
}

#[cfg(target_os = "windows")]
fn copy_hklm_software_key(old_name: &str, new_name: &str) -> std::io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let old_path = format!("SOFTWARE\\{}", old_name);
    let new_path = format!("SOFTWARE\\{}", new_name);

    let old_key = match hklm.open_subkey_with_flags(&old_path, KEY_READ) {
        Ok(k) => k,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(()); // 옛 키 없음 = clean install
        }
        Err(e) => {
            log::warn!(
                "[chainremote_migrate] HKLM\\{} 열기 실패 (관리자 권한 필요할 수 있음): {}",
                old_path,
                e
            );
            return Err(e);
        }
    };

    let (new_key, _) = hklm.create_subkey(&new_path)?;
    copy_reg_key_recursive(&old_key, &new_key)?;
    log::info!(
        "[chainremote_migrate] 레지스트리 복사 완료: HKLM\\{} → HKLM\\{}",
        old_path,
        new_path
    );
    Ok(())
}

#[cfg(target_os = "windows")]
fn copy_reg_key_recursive(src: &winreg::RegKey, dst: &winreg::RegKey) -> std::io::Result<()> {
    use winreg::enums::*;
    use winreg::types::FromRegValue;

    // Values.
    for value_result in src.enum_values() {
        let (name, data) = value_result?;
        // 새 경로에 같은 값이 이미 있으면 skip(우리가 만든 값 보존).
        if dst.get_raw_value(&name).is_ok() {
            continue;
        }
        dst.set_raw_value(&name, &data)?;
    }

    // Subkeys 재귀.
    for sub_result in src.enum_keys() {
        let sub_name = sub_result?;
        let src_sub = src.open_subkey_with_flags(&sub_name, KEY_READ)?;
        let (dst_sub, _) = dst.create_subkey(&sub_name)?;
        copy_reg_key_recursive(&src_sub, &dst_sub)?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn cleanup_old_autostart_key() {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    let Ok(run) = hkcu.open_subkey_with_flags(run_path, KEY_READ | KEY_WRITE) else {
        return;
    };
    // 옛 키 이름은 'RustDesk'(인스톨러가 atomic rename 했으면 이미 ChainRemote).
    if let Err(e) = run.delete_value("RustDesk") {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!("[chainremote_migrate] 옛 자동시작 키 삭제 실패: {}", e);
        }
    }
}

#[cfg(target_os = "windows")]
fn cleanup_old_shortcuts() {
    // 바탕화면 + 시작 메뉴(현재 사용자 + Public)의 RustDesk.lnk 정리.
    // 인스톨러가 이미 ChainRemote.lnk 로 atomic rename 했을 공산이 크지만 안전망으로.
    let candidates = ["RustDesk.lnk", "Uninstall RustDesk.lnk", "RustDesk Tray.lnk"];

    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(p) = std::env::var_os("USERPROFILE") {
        dirs.push(PathBuf::from(&p).join("Desktop"));
    }
    if let Some(p) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(&p).join("Microsoft\\Windows\\Start Menu\\Programs"));
    }
    if let Some(p) = std::env::var_os("PROGRAMDATA") {
        dirs.push(PathBuf::from(&p).join("Microsoft\\Windows\\Start Menu\\Programs"));
        dirs.push(PathBuf::from(&p).join("Microsoft\\Windows\\Start Menu\\Programs\\Startup"));
    }
    if let Some(p) = std::env::var_os("PUBLIC") {
        dirs.push(PathBuf::from(&p).join("Desktop"));
    }

    for dir in dirs {
        for cand in candidates {
            let p = dir.join(cand);
            if p.exists() {
                if let Err(e) = std::fs::remove_file(&p) {
                    log::warn!("[chainremote_migrate] 옛 단축아이콘 제거 실패: {:?}: {}", p, e);
                }
            }
        }
    }
}
