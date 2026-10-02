//! 접속 서버의 답장이 들어오고 있는가 — 에이전트가 스스로 아는 것을 밖으로 내보낸다.
//!
//! 2026-10-01 달인식자재마트: PC 가 hbbs 로 보내는 등록 신호(UDP)는 닿는데 **hbbs 의 답장만**
//! 그 PC 에 도착하지 않는 상태가 17시간 이어졌다. hbbs 는 신호를 받기만 하면 온라인으로
//! 치므로 본사 화면엔 "온라인", 접속하면 "랑데부 서버를 통한 연결 실패". 같은 매장의 다른
//! PC 는 그 상태가 **매일** 몇 시간씩 있었는데 아무도 몰랐다 — 접속 요청도 같은 통로의
//! 답장이라 수락 카드조차 뜨지 않는다.
//!
//! 등록 루프(rendezvous_mediator::start_udp)는 그 사실을 이미 안다. 답장이 없으면 3초마다
//! 다시 보내고 30초마다 소켓을 새로 연다. 다만 그걸 아는 프로세스(`--server`)와 패널에
//! 보고하는 프로세스(`--service` 의 heartbeat)가 달라, 작은 상태 파일로 넘긴다
//! (session-operator·restart-grace 와 같은 방식).
//!
//! ★여기서는 **보기만** 한다. 등록·접속 동작은 한 줄도 바꾸지 않는다.
//! ★파일 형식: `ok:<epoch>` | `noreply:<since_epoch>:<updated_epoch>`
//!   noreply 는 60초마다 updated 를 갱신한다. 읽는 쪽은 updated 가 5분 넘게 묵었으면
//!   "모른다"로 친다 — `--server` 가 죽은 뒤에도 옛 파일이 "수신 불가"를 계속 외치면 안 된다.

use hbb_common::log;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 이만큼 연속으로 답장이 없으면 "수신 불가"로 친다. 부팅 직후나 잠깐의 순단에 깜빡이지
/// 않도록 등록 재시도 열 번 남짓을 기다린다.
const NOREPLY_AFTER: Duration = Duration::from_secs(45);
const REFRESH_EVERY: Duration = Duration::from_secs(60);
const STALE_AFTER_SECS: u64 = 300;

struct State {
    /// 답장 없는 재시도가 처음 시작된 때(단조 시계, 벽시계 epoch).
    first_timeout: Option<(Instant, u64)>,
    /// 마지막으로 파일에 쓴 상태. None = 이 프로세스가 아직 한 번도 안 썼다.
    written_noreply: Option<bool>,
    last_write: Option<Instant>,
}

static STATE: Mutex<State> = Mutex::new(State {
    first_timeout: None,
    written_noreply: None,
    last_write: None,
});

fn now_epoch() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn status_path() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        Some(std::path::PathBuf::from(
            r"C:\ProgramData\ChainRemote\rz-status",
        ))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn write(content: &str) {
    if let Some(p) = status_path() {
        if let Err(e) = std::fs::write(&p, content) {
            log::debug!("[chainremote_rz_status] write failed: {e}");
        }
    }
}

/// hbbs 의 답장을 하나 받았다.
pub fn note_reply() {
    let Ok(mut st) = STATE.lock() else { return };
    st.first_timeout = None;
    if st.written_noreply != Some(false) {
        if st.written_noreply == Some(true) {
            log::info!("[chainremote_rz_status] 접속 서버 답장 재개");
        }
        write(&format!("ok:{}", now_epoch()));
        st.written_noreply = Some(false);
        st.last_write = Some(Instant::now());
    }
}

/// 등록 신호를 보냈는데 제한 시간 안에 답장이 없었다.
pub fn note_timeout() {
    let Ok(mut st) = STATE.lock() else { return };
    let (t0, since) = *st
        .first_timeout
        .get_or_insert_with(|| (Instant::now(), now_epoch()));
    if t0.elapsed() < NOREPLY_AFTER {
        return;
    }
    let first = st.written_noreply != Some(true);
    let due = first
        || st
            .last_write
            .map(|t| t.elapsed() >= REFRESH_EVERY)
            .unwrap_or(true);
    if !due {
        return;
    }
    if first {
        log::warn!(
            "[chainremote_rz_status] 접속 서버 답장이 {}초째 없다 — 원격 요청을 받을 수 없는 상태",
            t0.elapsed().as_secs()
        );
    }
    write(&format!("noreply:{}:{}", since, now_epoch()));
    st.written_noreply = Some(true);
    st.last_write = Some(Instant::now());
}

/// 파일 내용 해석. `now` 를 받는 건 시험하려고.
fn parse(content: &str, now: u64) -> Option<u64> {
    let mut it = content.trim().split(':');
    if it.next()? != "noreply" {
        return None;
    }
    let since: u64 = it.next()?.parse().ok()?;
    let updated: u64 = it.next()?.parse().ok()?;
    if since == 0 || now.saturating_sub(updated) > STALE_AFTER_SECS {
        return None;
    }
    Some(since)
}

/// heartbeat 가 읽는다. 지금 "수신 불가"면 그 상태가 시작된 시각(epoch 초), 아니면 None.
pub fn read_noreply_since() -> Option<u64> {
    let p = status_path()?;
    let s = std::fs::read_to_string(p).ok()?;
    parse(&s, now_epoch())
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn ok_and_garbage_mean_not_lost() {
        assert_eq!(parse("ok:1790000000", 1790000100), None);
        assert_eq!(parse("", 1790000100), None);
        assert_eq!(parse("noreply", 1790000100), None);
        assert_eq!(parse("noreply:abc:def", 1790000100), None);
    }

    #[test]
    fn fresh_noreply_gives_since() {
        assert_eq!(parse("noreply:1790000000:1790000090", 1790000100), Some(1790000000));
        assert_eq!(parse("noreply:1790000000:1790000090\n", 1790000100), Some(1790000000));
    }

    #[test]
    fn stale_noreply_is_unknown() {
        // --server 가 죽어 갱신이 멈춘 파일 — 5분 넘으면 믿지 않는다.
        assert_eq!(parse("noreply:1790000000:1790000090", 1790000090 + 301), None);
        assert_eq!(parse("noreply:1790000000:1790000090", 1790000090 + 300), Some(1790000000));
    }
}
