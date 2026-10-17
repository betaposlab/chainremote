//! 수락 카드(--cm)를 못 띄웠다는 사실을 본사와 패널에 알린다.
//!
//! 2026-10-17 세종싱싱활어회배달: 서비스가 카드를 띄우다 os error 740 으로 거절당했는데,
//! 에이전트는 이유 없이 연결만 끊었다. 본사 HQ 엔 "피어에 의해 초기화"가 뜨고 그 문구는
//! 네트워크 끊김으로 취급돼 4분짜리 자동 재접속이 돌았다 — 다시 붙어도 카드는 또 안 뜨는데.
//! 원인을 찾느라 매장 PC 로그를 뒤져야 했다. 카드가 안 뜨는 건 거래처 쪽에선 아무 일도
//! 없어 보이는 고장이라, 우리가 먼저 말해 주지 않으면 아무도 모른다.
//!
//! 두 갈래로 알린다:
//! - **본사(그 자리)**: 연결을 끊기 전에 이유를 로그인 오류로 보낸다. HQ 의 "수락 대기" 창도
//!   같은 로그인 오류 신호로 뜨는 것이라 그 창이 이 문구로 바뀐다. 제목이 "Login Error" 라
//!   자동 재접속(Connection Error 에만 붙음)도 안 붙는다. 옛 HQ 도 그대로 동작한다.
//! - **패널(나중에)**: 실패를 작은 상태 파일로 남기고 heartbeat 가 그걸 실어 보낸다. 아무도
//!   접속하지 않아도 그 PC 에 카드 문제가 있다는 게 거래처 표에 보인다. 카드가 한 번이라도
//!   정상으로 뜨면 지운다.
//!
//! 실패를 아는 프로세스(`--server`)와 보고하는 프로세스(`--service`)가 달라 파일로 넘긴다
//! (rz-status·session-operator 와 같은 방식).
//! ★파일 형식: `<epoch>:<code>` — code 는 os error 번호(예: 740), 없으면 `cm`.

use hbb_common::log;
use std::time::{SystemTime, UNIX_EPOCH};

fn status_path() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        Some(std::path::PathBuf::from(r"C:\ProgramData\ChainRemote\cm-fail"))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// "…(os error 740)" 에서 번호만 뽑는다. 없으면 "cm".
fn error_code(err: &str) -> String {
    if let Some(i) = err.find("os error ") {
        let digits: String = err[i + 9..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if !digits.is_empty() {
            return digits;
        }
    }
    "cm".to_string()
}

/// 본사 HQ 에 보여 줄 문구. 라이브러리 오류 원문은 넣지 않는다 — 기사가 읽고 바로 다음
///   행동을 정할 수 있어야 한다. 원문은 로그와 패널(코드)로 간다.
pub fn hq_message(err: &str) -> String {
    let head = if error_code(err) == "740" {
        "거래처 PC 의 권한 설정 때문에 수락 창을 띄우지 못했습니다."
    } else {
        "거래처 PC 에서 수락 창을 띄우지 못했습니다."
    };
    format!("{head} 626.kr 에서 임시 원격으로 접속해 주세요.")
}

/// 카드를 못 띄웠다 — 상태 파일에 남긴다.
pub fn note_failure(err: &str) {
    let Some(path) = status_path() else { return };
    let epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!("{}:{}", epoch, error_code(err));
    if let Err(e) = std::fs::write(&path, line) {
        log::warn!("[chainremote_cm_status] 상태 파일 기록 실패: {e}");
    }
}

/// 카드가 정상으로 떴다 — 옛 실패 기록을 지운다. 없으면 아무것도 안 한다.
pub fn note_ok() {
    let Some(path) = status_path() else { return };
    if path.exists() {
        let _ = std::fs::remove_file(&path);
    }
}

/// heartbeat 용 — (실패 시각 epoch, 코드). 기록이 없거나 깨졌으면 None.
pub fn read_failure() -> Option<(u64, String)> {
    let path = status_path()?;
    let s = std::fs::read_to_string(path).ok()?;
    let (epoch, code) = s.trim().split_once(':')?;
    let epoch = epoch.parse::<u64>().ok()?;
    let code: String = code.chars().take(16).collect();
    if code.is_empty() {
        return None;
    }
    Some((epoch, code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_os_error_code() {
        assert_eq!(
            error_code(r#"Failed to launch ["--cm"] with session id 1: x (os error 740)"#),
            "740"
        );
        assert_eq!(error_code("Failed to connect to connection manager"), "cm");
    }

    #[test]
    fn hq_message_mentions_permission_only_for_740() {
        assert!(hq_message("(os error 740)").contains("권한 설정"));
        assert!(!hq_message("Failed to connect to connection manager").contains("권한 설정"));
        assert!(hq_message("anything").contains("626.kr"));
    }
}
