//! 외부 명령 실행 — 시간 제한과 강제 종료가 있는 단 한 곳.
//!
//! 2026-10-19 테스트1(윈7 32비트): 방화벽 자동 해제 감시가 netsh 를 시간 제한 없이 기다리다
//! **10분 동안 멈췄다**(16:25:34 실행 → 다음 기록 16:35:46). 감시는 5초마다 도는 스레드 하나라,
//! 외부 명령 하나에 붙잡히면 그동안 방화벽이 다시 켜져도 아무도 끄지 않는다. 같은 날 실매장
//! 샵단란주점도 "방화벽 켜짐·해제 0회"였는데 HQ 엔 "해제 대기"만 떠 아무도 몰랐다.
//!
//! 그래서 감시 기능이 쓰는 외부 명령은 전부 여기서 돌린다:
//! - 정한 시간 안에 안 끝나면 끝내고 `RunError::Timeout` 을 돌려준다.
//! - 실패 이유는 짧은 코드(`RunError::code`)로 바꿔 패널에 보고할 수 있다.
//! - 표준입력은 늘 닫는다 — 서비스에서 물려받은 입력을 명령이 붙잡고 기다릴 여지를 없앤다.
//!
//! 카드결제 데몬 관제(netstat·tasklist·wmic·taskkill)도 같은 위험이라 여기를 쓴다.
//! 특히 wmic 은 WMI 서비스 상태에 따라 오래 멈추기로 알려진 명령이다.
//!
//! 윈도우 전용 기능이 쓰지만 모듈은 모든 플랫폼에서 컴파일된다 — 시간 초과·강제 종료 동작을
//! 맥에서도 단위 시험으로 확인하려는 것이다(윈도우 게이트 모듈은 맥 검사에서 통째로 빠진다).

use std::io::Read;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

/// 끝났는지 보는 간격. 명령은 대개 1~2초면 끝나므로 짧게 둔다.
const POLL: Duration = Duration::from_millis(100);

/// 프로세스가 끝난 뒤 남은 출력을 다 읽기까지 기다리는 시간. 손자 프로세스가 파이프를 쥐고
///   있으면 읽기가 영원히 안 끝날 수 있어서, 무한정 기다리지 않는다.
const DRAIN: Duration = Duration::from_secs(5);

/// 외부 명령이 실패한 이유.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunError {
    /// 실행 자체가 안 됐다(파일 없음·권한 등).
    Spawn(String),
    /// 정한 시간(초) 안에 안 끝나 강제로 끝냈다.
    Timeout(u64),
    /// 끝났지만 실패 코드를 돌려줬다. None = 코드 없이 끝남.
    Exit(Option<i32>),
    /// 상태를 확인하다 오류가 났다.
    Wait(String),
}

impl RunError {
    /// 패널 보고용 짧은 코드 — 영숫자만 쓴다(서버도 그렇게 거른다).
    ///   `timeout` / `exit1` / `exitc0000005`(비정상 종료는 16진) / `spawn` / `wait`.
    pub fn code(&self) -> String {
        match self {
            RunError::Spawn(_) => "spawn".into(),
            RunError::Timeout(_) => "timeout".into(),
            RunError::Exit(Some(c)) if (0..=255).contains(c) => format!("exit{c}"),
            RunError::Exit(Some(c)) => format!("exit{:x}", *c as u32),
            RunError::Exit(None) => "exit".into(),
            RunError::Wait(_) => "wait".into(),
        }
    }
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::Spawn(e) => write!(f, "실행 불가: {e}"),
            RunError::Timeout(s) => write!(f, "{s}초 안에 안 끝나 강제 종료"),
            RunError::Exit(Some(c)) => write!(f, "실패 코드 {c}"),
            RunError::Exit(None) => write!(f, "코드 없이 종료"),
            RunError::Wait(e) => write!(f, "상태 확인 실패: {e}"),
        }
    }
}

fn command(program: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 서비스(세션 0)라 창이 뜰 일은 없지만, 다른 맥락에서 불려도 콘솔 창이 번쩍이지 않게.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// 끝날 때까지 기다리되, `timeout` 을 넘기면 끝내고 Timeout 을 돌려준다.
fn wait_with_deadline(child: &mut Child, timeout: Duration) -> Result<ExitStatus, RunError> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    // 끝낸 프로세스를 거둬 들인다. 강제 종료 뒤라 바로 돌아온다.
                    let _ = child.wait();
                    return Err(RunError::Timeout(timeout.as_secs()));
                }
                std::thread::sleep(POLL);
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RunError::Wait(e.to_string()));
            }
        }
    }
}

/// 출력은 버리고 성공 여부만 본다 — netsh·taskkill 처럼 "됐나 안 됐나"만 중요한 명령.
pub fn run(program: &str, args: &[&str], timeout: Duration) -> Result<(), RunError> {
    let mut child = command(program, args)
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| RunError::Spawn(e.to_string()))?;
    let status = wait_with_deadline(&mut child, timeout)?;
    if status.success() {
        Ok(())
    } else {
        Err(RunError::Exit(status.code()))
    }
}

/// 표준출력을 받아 온다 — netstat·tasklist·wmic 처럼 결과를 읽어 판단하는 명령.
///   실패 코드로 끝나도 출력은 돌려준다. 이 명령들은 찾는 게 없을 때도 실패 코드를 내므로
///   판단은 출력 내용으로 한다(종전 `Command::output` 과 같은 동작). 시간 초과·실행 불가만 Err.
pub fn capture(program: &str, args: &[&str], timeout: Duration) -> Result<String, RunError> {
    let mut child = command(program, args)
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| RunError::Spawn(e.to_string()))?;
    let mut stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RunError::Wait("stdout 파이프 없음".into()));
        }
    };
    // 출력은 다른 스레드가 읽는다 — 기다리는 동안 안 읽으면 출력이 큰 명령은 파이프가 가득 차
    //   스스로 멈추고, 그러면 멀쩡한 명령도 시간 초과로 끝난다.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        let _ = tx.send(buf);
    });
    wait_with_deadline(&mut child, timeout)?;
    let buf = rx.recv_timeout(DRAIN).unwrap_or_default();
    // 한국어 윈도우 콘솔은 CP949 라 UTF-8 로 못 읽는 글자가 섞인다. 판단에 쓰는 건 숫자와
    //   영문 상태값뿐이라 손실 변환으로 충분하다.
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    // 플랫폼마다 같은 뜻의 명령. 윈도우는 cmd 내장 명령과 ping 으로 시간을 끈다.
    #[cfg(windows)]
    fn ok_cmd() -> (&'static str, Vec<&'static str>) {
        ("cmd", vec!["/c", "exit", "0"])
    }
    #[cfg(not(windows))]
    fn ok_cmd() -> (&'static str, Vec<&'static str>) {
        ("true", vec![])
    }
    #[cfg(windows)]
    fn fail_cmd() -> (&'static str, Vec<&'static str>) {
        ("cmd", vec!["/c", "exit", "3"])
    }
    #[cfg(not(windows))]
    fn fail_cmd() -> (&'static str, Vec<&'static str>) {
        ("sh", vec!["-c", "exit 3"])
    }
    #[cfg(windows)]
    fn slow_cmd() -> (&'static str, Vec<&'static str>) {
        ("ping", vec!["-n", "10", "127.0.0.1"])
    }
    #[cfg(not(windows))]
    fn slow_cmd() -> (&'static str, Vec<&'static str>) {
        ("sleep", vec!["10"])
    }
    #[cfg(windows)]
    fn echo_cmd() -> (&'static str, Vec<&'static str>) {
        ("cmd", vec!["/c", "echo", "hello"])
    }
    #[cfg(not(windows))]
    fn echo_cmd() -> (&'static str, Vec<&'static str>) {
        ("echo", vec!["hello"])
    }

    #[test]
    fn run_reports_success_and_exit_code() {
        let (p, a) = ok_cmd();
        assert_eq!(run(p, &a, Duration::from_secs(10)), Ok(()));
        let (p, a) = fail_cmd();
        assert_eq!(run(p, &a, Duration::from_secs(10)), Err(RunError::Exit(Some(3))));
    }

    #[test]
    fn run_kills_a_hung_command_at_the_deadline() {
        let (p, a) = slow_cmd();
        let started = Instant::now();
        let r = run(p, &a, Duration::from_millis(500));
        assert_eq!(r, Err(RunError::Timeout(0)));
        // 10초짜리 명령을 0.5초에 끊었는지 — 기다리지 않고 돌아와야 한다.
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
    }

    #[test]
    fn capture_returns_output_and_times_out() {
        let (p, a) = echo_cmd();
        let out = capture(p, &a, Duration::from_secs(10)).unwrap();
        assert!(out.contains("hello"), "{out:?}");
        let (p, a) = slow_cmd();
        let started = Instant::now();
        assert_eq!(capture(p, &a, Duration::from_millis(500)), Err(RunError::Timeout(0)));
        assert!(started.elapsed() < Duration::from_secs(8), "{:?}", started.elapsed());
    }

    #[test]
    fn missing_program_is_a_spawn_error() {
        let r = run("chainremote-no-such-program", &[], Duration::from_secs(5));
        assert!(matches!(r, Err(RunError::Spawn(_))), "{r:?}");
    }

    #[test]
    fn codes_are_short_and_alphanumeric() {
        assert_eq!(RunError::Timeout(30).code(), "timeout");
        assert_eq!(RunError::Exit(Some(1)).code(), "exit1");
        // 0xC0000005(접근 위반) 같은 비정상 종료는 음수로 오므로 16진으로 적는다.
        assert_eq!(RunError::Exit(Some(0xC000_0005u32 as i32)).code(), "exitc0000005");
        assert_eq!(RunError::Spawn("x".into()).code(), "spawn");
        for e in [RunError::Exit(Some(-1)), RunError::Wait("x".into()), RunError::Exit(None)] {
            let c = e.code();
            assert!(c.len() <= 16 && c.chars().all(|ch| ch.is_ascii_alphanumeric()), "{c}");
        }
    }
}
