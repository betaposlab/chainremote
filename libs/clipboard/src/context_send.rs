use hbb_common::{log, ResultType};
use std::{ops::Deref, sync::Mutex};

use crate::CliprdrServiceContext;

#[allow(dead_code)]
const CLIPBOARD_RESPONSE_WAIT_TIMEOUT_SECS: u32 = 30;

lazy_static::lazy_static! {
    static ref CONTEXT_SEND: ContextSend = ContextSend::default();
}

#[derive(Default)]
pub struct ContextSend(Mutex<Option<Box<dyn CliprdrServiceContext>>>);

impl Deref for ContextSend {
    type Target = Mutex<Option<Box<dyn CliprdrServiceContext>>>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl ContextSend {
    #[inline]
    pub fn is_enabled() -> bool {
        CONTEXT_SEND.lock().unwrap().is_some()
    }

    pub fn set_is_stopped() {
        let _res = Self::proc(|c| c.set_is_stopped().map_err(|e| e.into()));
    }

    pub fn enable(enabled: bool) {
        // [ChainRemote] 32비트 Windows(거래처 POS 에이전트)에선 cliprdr(클립보드 파일 리다이렉트)를
        // 절대 켜지 않는다. 연결 종료 정리의 네이티브 empty_cliprdr(→ OLE → 레거시 msvcrt)가
        // 스택 버퍼 오버런(0xc0000409)으로 죽기 때문 — 32비트 Win7 실측, cm 로그 3회 동일 지점.
        // 수신 전용 에이전트엔 불필요한 기능이고, 텍스트 클립보드/파일전송은 별개라 그대로 동작.
        // x64(HQ/뷰어)는 cfg=false라 아래 원본 그대로 실행 — 영향 0.
        #[cfg(all(windows, target_arch = "x86"))]
        let _ = enabled;
        #[cfg(not(all(windows, target_arch = "x86")))]
        {
            let mut lock = CONTEXT_SEND.lock().unwrap();
            if enabled {
                if lock.is_some() {
                    return;
                }
                match crate::create_cliprdr_context(true, false, CLIPBOARD_RESPONSE_WAIT_TIMEOUT_SECS)
                {
                    Ok(context) => {
                        log::info!("clipboard context for file transfer created.");
                        *lock = Some(context)
                    }
                    Err(err) => {
                        log::error!(
                            "create clipboard context for file transfer: {}",
                            err.to_string()
                        );
                    }
                }
            } else if let Some(_clp) = lock.take() {
                *lock = None;
                log::info!("clipboard context for file transfer destroyed.");
            }
        }
    }

    /// make sure the clipboard context is enabled.
    pub fn make_sure_enabled() -> ResultType<()> {
        // [ChainRemote] 32비트 Windows: cliprdr 비활성(위 enable() 주석 참조) — 컨텍스트를 만들지 않는다.
        #[cfg(all(windows, target_arch = "x86"))]
        return Ok(());
        #[cfg(not(all(windows, target_arch = "x86")))]
        {
            let mut lock = CONTEXT_SEND.lock().unwrap();
            if lock.is_some() {
                return Ok(());
            }

            let ctx =
                crate::create_cliprdr_context(true, false, CLIPBOARD_RESPONSE_WAIT_TIMEOUT_SECS)?;
            *lock = Some(ctx);
            log::info!("clipboard context for file transfer recreated.");
            Ok(())
        }
    }

    pub fn proc<F: FnOnce(&mut Box<dyn CliprdrServiceContext>) -> ResultType<()>>(
        f: F,
    ) -> ResultType<()> {
        let mut lock = CONTEXT_SEND.lock().unwrap();
        match lock.as_mut() {
            Some(context) => f(context),
            None => Ok(()),
        }
    }
}
