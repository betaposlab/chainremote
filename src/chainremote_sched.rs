//! 예약원격 — 거래처가 승인한 "이 시간 동안은 수락 없이 들어와도 된다" 창.
//!
//! # 왜 이게 필요한가
//!
//! 우리 정책은 클릭 수락이고 그게 강점이다. 그런데 실패하는 순간이 하나 있다 — **사장님이
//! 자리에 없을 때**(주방·배달·야간 마감). 지금은 그때마다 전화해서 "포스 앞에 가주세요"를
//! 해야 한다. 세상의 선택지는 영구 비밀번호(무인 접속) 아니면 아무것도 안 됨, 둘뿐이고
//! 중간이 없다.
//!
//! 그 중간을 만든다: 기사가 시간대를 제안하고 **사장님이 한 번 승인**하면 그 구간에는
//! 수락 창이 안 뜬다.
//!
//! # ★영구 비밀번호와 무엇이 다른가 (이걸 잃으면 이 기능은 존재 이유가 없다)
//!
//! **거래처가 손으로 눌렀다** — 이 하나가 본질적 차이다. 만료·기록·표시는 그걸 뒷받침하는
//! 장치일 뿐이다. 그래서 **본사가 혼자 창을 여는 경로는 만들지 않는다.** 구두 동의를
//! 근거로 본사가 설정하면, 그건 이름만 바꾼 영구 비밀번호다(2026-06-05 폐기한 것).
//!
//! # 저장 위치가 왜 ProgramData 인가
//!
//! 재시작 grace 와 같은 이유다(`connection.rs::restart_grace_path` 주석 참조). 이 상태는
//! ①프로세스 종료 ②세션0(서비스)↔세션1(사용자) ③사용자/서비스 toml 분리 — 이 셋을 모두
//! 넘어야 한다. Config(toml)은 그 경계를 못 넘어 2026-06-05 에 이미 한 번 실패했다.
//!
//! # 시계가 틀린 포스
//!
//! 32비트 Win7 포스는 시계가 자주 어긋난다. 절대 시각만 믿으면 시계가 3일 뒤처진 기기에서
//! **창이 3일 열린다.** 그래서 승인 시점에 본사 시각(`hq_now`)을 같이 받아 **어긋난 만큼을
//! 빼서 우리 시간축으로 옮겨 놓고**, 그것과 별개로 **승인 후 24시간**이라는 절대 상한을 함께
//! 건다. 둘 중 먼저 닫히는 쪽이 이긴다.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// 창의 최대 길이. 본사 UI 에서도 막지만, 거래처 쪽에서 한 번 더 막는다 —
/// 본사를 믿고 무제한을 허용하면 사실상 영구 비밀번호가 된다.
const MAX_WINDOW_SECS: i64 = 24 * 60 * 60;

/// 마지막 접속이 끝난 뒤 이만큼 조용하면 창을 닫는다.
///
/// ★**첫 작업이 끝난 뒤부터** 센다. 창이 열리자마자 세면 "23시에 허용받고 1시에 작업"이
/// 죽는다. 작업이 일찍 끝나 기사가 [작업 종료]를 잊고 갔을 때를 위한 안전망이다.
/// 30분이면 Win7 포스의 재부팅 대기(5분 남짓)를 넉넉히 덮는다.
const IDLE_CLOSE_SECS: i64 = 30 * 60;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SchedWindow {
    /// 창 시작·종료 — **우리 시간축으로 옮겨 놓은** epoch(초).
    pub start: i64,
    pub end: i64,
    /// 승인한 시각(우리 시계). 24시간 상한의 기준.
    pub granted_at: i64,
    /// 사장님에게 보여줬던 문구. 나중에 "무슨 시간으로 허용했더라"를 사람이 읽을 수 있게.
    pub label: String,
    /// 마지막 세션이 끝난 시각. 아직 한 번도 안 붙었으면 None — 무활동 판정을 시작하지 않는다.
    pub last_session_end: Option<i64>,
    /// 지금 세션이 붙어 있는가. 붙어 있는 동안은 무활동 시계가 돌지 않는다.
    pub in_session: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn path() -> std::path::PathBuf {
    #[cfg(windows)]
    {
        std::path::PathBuf::from(r"C:\ProgramData\ChainRemote\sched-window")
    }
    #[cfg(not(windows))]
    {
        std::env::temp_dir().join("chainremote-sched-window")
    }
}

fn read() -> Option<SchedWindow> {
    let raw = std::fs::read_to_string(path()).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write(w: &SchedWindow) {
    if let Some(dir) = path().parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(s) = serde_json::to_string(w) {
        let _ = std::fs::write(path(), s);
    }
}

/// 창을 지운다. 만료·거래처 취소·본사의 [작업 종료] 가 모두 여기로 온다.
pub fn clear() {
    let _ = std::fs::remove_file(path());
}

/// 거래처가 [수락]을 눌렀다 — 창을 연다.
///
/// `hq_now` 는 본사 시계다. 우리 시계와의 차이만큼 start/end 를 옮겨 저장한다.
/// 반환값은 사람이 읽을 로그용 요약.
pub fn grant(start: i64, end: i64, hq_now: i64, label: &str) -> String {
    let local_now = now();
    // 본사가 앞서 있으면 skew > 0. 우리 시간축 = 본사 시각 - skew.
    let skew = hq_now - local_now;
    let mut w = SchedWindow {
        start: start - skew,
        end: end - skew,
        granted_at: local_now,
        label: label.to_owned(),
        last_session_end: None,
        in_session: false,
    };
    // 상한을 거래처 쪽에서 한 번 더 건다.
    let cap = local_now + MAX_WINDOW_SECS;
    if w.end > cap {
        w.end = cap;
    }
    // 시작이 과거면 지금부터로 본다(본사가 "지금부터"를 보낸 경우).
    if w.start < local_now {
        w.start = local_now;
    }
    write(&w);
    format!(
        "sched granted: {} (skew={}s, start={}, end={})",
        label, skew, w.start, w.end
    )
}

/// 지금 이 순간 창이 열려 있는가 = 수락 없이 통과시켜도 되는가.
///
/// 닫혀 있으면 마커도 치운다 — 만료된 창이 파일로 남아 다음 판정을 헷갈리게 하지 않는다.
pub fn is_open() -> bool {
    let Some(w) = read() else {
        return false;
    };
    let t = now();

    // ① 약속한 구간 밖
    if t < w.start || t >= w.end {
        if t >= w.end {
            clear();
        }
        return false;
    }
    // ② 승인 후 24시간 절대 상한 — 시계가 뒤로 튄 경우의 안전망
    if t - w.granted_at >= MAX_WINDOW_SECS {
        clear();
        return false;
    }
    // ③ 무활동 — 한 번이라도 붙었고, 지금 붙어 있지 않고, 조용한 지 오래면 닫는다
    if !w.in_session {
        if let Some(last) = w.last_session_end {
            if t - last >= IDLE_CLOSE_SECS {
                clear();
                return false;
            }
        }
    }
    true
}

/// 사람이 읽을 현재 상태. 트레이 카드와 로그가 쓴다. 닫혀 있으면 None.
pub fn status() -> Option<SchedWindow> {
    if is_open() {
        read()
    } else {
        None
    }
}

/// 창 구간의 세션이 시작됐다 — 무활동 시계를 멈춘다.
pub fn note_session_start() {
    if let Some(mut w) = read() {
        w.in_session = true;
        write(&w);
    }
}

/// 세션이 끝났다 — 여기서부터 무활동 시계가 돈다.
pub fn note_session_end() {
    if let Some(mut w) = read() {
        w.in_session = false;
        w.last_session_end = Some(now());
        write(&w);
    }
}

/// 거래처에게 "허용을 취소할까요?"를 묻고, 그렇다면 창을 닫는다.
///
/// ★왜 시스템 대화상자인가: 거래처(i686) 트레이엔 컨텍스트 메뉴를 못 단다 — Win7 에서
/// `TrackPopupMenu` 가 c0000409(스택 버퍼 오버런)로 프로세스를 죽인다. CM 창에 새 상태를
/// 만드는 것도 피했다(카드↔배너↔채팅 기하가 이미 까다롭다). 시스템 대화상자는 둘 다
/// 비껴가면서 x86·x64 가 똑같이 동작한다.
///
/// 트레이 이벤트 루프를 막지 않으려고 별도 스레드에서 띄운다.
#[cfg(windows)]
pub fn ask_cancel_in_thread() {
    let Some(w) = status() else {
        return;
    };
    std::thread::spawn(move || {
        use std::os::windows::ffi::OsStrExt;
        fn wide(s: &str) -> Vec<u16> {
            std::ffi::OsStr::new(s)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect()
        }
        let text = format!(
            "원격 허용 중입니다.\n\n{}\n\n지금 허용을 취소할까요?\n취소하면 다음부터는 수락 창이 다시 뜹니다.",
            w.label
        );
        const MB_YESNO: u32 = 0x0000_0004;
        const MB_ICONQUESTION: u32 = 0x0000_0020;
        const MB_SYSTEMMODAL: u32 = 0x0000_1000;
        const IDYES: i32 = 6;
        extern "system" {
            fn MessageBoxW(hwnd: *mut u16, text: *const u16, caption: *const u16, utype: u32) -> i32;
        }
        let r = unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                wide(&text).as_ptr(),
                wide("ChainRemote 원격 허용").as_ptr(),
                MB_YESNO | MB_ICONQUESTION | MB_SYSTEMMODAL,
            )
        };
        if r == IDYES {
            clear();
            log::info!("[chainremote_sched] 거래처가 트레이에서 허용을 취소했다");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(start: i64, end: i64, granted: i64) -> SchedWindow {
        SchedWindow {
            start,
            end,
            granted_at: granted,
            label: "t".into(),
            last_session_end: None,
            in_session: false,
        }
    }

    // grant 는 파일을 건드리므로 순수 판정부만 따로 검증한다.
    fn open_at(w: &SchedWindow, t: i64) -> bool {
        if t < w.start || t >= w.end {
            return false;
        }
        if t - w.granted_at >= MAX_WINDOW_SECS {
            return false;
        }
        if !w.in_session {
            if let Some(last) = w.last_session_end {
                if t - last >= IDLE_CLOSE_SECS {
                    return false;
                }
            }
        }
        true
    }

    #[test]
    fn closed_before_start_and_after_end() {
        let w = win(1000, 2000, 900);
        assert!(!open_at(&w, 999));
        assert!(open_at(&w, 1000));
        assert!(open_at(&w, 1999));
        assert!(!open_at(&w, 2000));
    }

    #[test]
    fn absolute_cap_wins_even_inside_window() {
        // 시계가 뒤로 튀어 end 가 아주 멀어진 경우를 흉내 낸다.
        let w = win(0, i64::MAX / 2, 0);
        assert!(open_at(&w, 10));
        assert!(!open_at(&w, MAX_WINDOW_SECS));
    }

    #[test]
    fn idle_closes_only_after_first_session() {
        let mut w = win(0, 100_000, 0);
        // 아직 한 번도 안 붙었으면 아무리 조용해도 열려 있다 — 23시에 받고 1시에 작업.
        assert!(open_at(&w, IDLE_CLOSE_SECS * 3));
        // 한 번 붙었다 끊긴 뒤로는 무활동 시계가 돈다.
        w.last_session_end = Some(1000);
        assert!(open_at(&w, 1000 + IDLE_CLOSE_SECS - 1));
        assert!(!open_at(&w, 1000 + IDLE_CLOSE_SECS));
    }

    #[test]
    fn in_session_never_idles_out() {
        let mut w = win(0, 100_000, 0);
        w.last_session_end = Some(0);
        w.in_session = true;
        assert!(open_at(&w, IDLE_CLOSE_SECS * 5));
    }
}
