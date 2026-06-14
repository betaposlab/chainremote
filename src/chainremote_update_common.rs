//! ChainRemote 자동업데이트 공용 로직 — push_agent(거래처 푸시 채널)와 updater(latest.json 채널) 공유.
//!
//! 2026-06-14 신규 (코워크 검토 C2/C3 정석화).
//!   종전엔 `parse_version`/`is_newer` 는 updater 에만, `verify_sha256` 는 양쪽에 **중복** 존재했고,
//!   둘 다 expected sha 의 빈값/잘린값/비-hex 를 거르지 않아 "sha-mismatch 무증상 무한 재다운"
//!   (CLAUDE.md '사업화 전 필수' 항목) 의 근원이 됐다. 한 곳으로 모으고 가드를 추가한다.
//!
//! 이 모듈은 의도적으로 **플랫폼 무관** (windows cfg 게이트 없음) — 순수 로직이라
//! `cargo test` 가 Mac/Linux 빌드 머신에서도 그물망으로 동작한다 (윈컴 전용 모듈의 한계 제거).

use hbb_common::{bail, ResultType};
use sha2::{Digest, Sha256};
use std::path::Path;

/// "major.minor.build" → (u32,u32,u32). build 부분의 알파/베타/rc suffix 는 숫자 prefix 만 취함.
/// (예: "1.4.19-pushtest" → (1,4,19)). 3파트 미만이거나 major/minor 가 비-숫자면 Err.
pub fn parse_version(s: &str) -> ResultType<(u32, u32, u32)> {
    let parts: Vec<&str> = s.trim().split('.').collect();
    if parts.len() < 3 {
        bail!("malformed version: {}", s);
    }
    let major: u32 = parts[0].parse()?;
    let minor: u32 = parts[1].parse()?;
    // build 부분에 알파/베타 suffix 가 붙는 경우 대비 — 숫자 prefix 만 취함
    let build_str: String = parts[2].chars().take_while(|c| c.is_ascii_digit()).collect();
    let build: u32 = if build_str.is_empty() { 0 } else { build_str.parse()? };
    Ok((major, minor, build))
}

#[inline]
pub fn is_newer(a: (u32, u32, u32), b: (u32, u32, u32)) -> bool {
    a > b
}

/// 두 버전 문자열을 파싱해 `a` 가 `b` 보다 새 버전인지 반환. 둘 중 하나라도 파싱 실패면 Err.
/// (push 채널 버전 가드용 — 문자열 비교 로직을 한 곳에 둔다.)
pub fn is_newer_str(a: &str, b: &str) -> ResultType<bool> {
    Ok(is_newer(parse_version(a)?, parse_version(b)?))
}

/// expected sha256 hex 문자열이 **형식상** 유효한가 — trim 후 정확히 64자 + 전부 ascii hex.
/// 빈값/자리표시자/잘린 해시(예: latest.json 의 빈 agent 채널 "", "deadbeef")를 거른다.
pub fn is_valid_sha256_hex(expected_hex: &str) -> bool {
    let t = expected_hex.trim();
    t.len() == 64 && t.bytes().all(|b| b.is_ascii_hexdigit())
}

/// 파일의 sha256 을 expected 와 비교.
/// - expected 가 형식상 불량(빈값/길이≠64/비-hex)이면 **파일을 보존한 채** 명확한 에러로 bail.
///   (매니페스트 결함이지 파일 결함이 아니므로 재다운로드로 해결되지 않음 — 무한 재다운 루프 차단.)
/// - 형식은 맞으나 실제 해시가 다르면 손상 파일로 보고 삭제 + mismatch bail (다음 사이클 재다운).
pub fn verify_sha256(path: &Path, expected_hex: &str) -> ResultType<()> {
    if !is_valid_sha256_hex(expected_hex) {
        // 빈값/자리표시자/잘린 해시 — 재다운으로 못 고침. 파일 보존하고 명확히 실패시켜 가시화.
        bail!(
            "invalid expected sha256 (need 64 hex chars, got {:?} len={})",
            expected_hex.trim(),
            expected_hex.trim().len()
        );
    }
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let got = hex::encode(hasher.finalize());
    let expected = expected_hex.trim().to_lowercase();
    if got != expected {
        // 손상된 파일 정리 — 다음 사이클에서 재다운로드 시도
        std::fs::remove_file(path).ok();
        bail!("SHA256 mismatch: expected {}, got {}", expected, got);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! 자동업데이트 핵심 로직 단위테스트. 종전엔 chainremote_updater(윈도우 전용) 안에 있어
    //! 윈컴에서만 돌았으나, 공용 모듈로 옮겨 Mac/Linux 빌드에서도 매 빌드 그물망이 된다.
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn parse_version_basic() {
        assert_eq!(parse_version("1.3.5").unwrap(), (1, 3, 5));
        assert_eq!(parse_version("10.20.30").unwrap(), (10, 20, 30));
        assert_eq!(parse_version("0.0.0").unwrap(), (0, 0, 0));
    }

    #[test]
    fn parse_version_trims_whitespace() {
        assert_eq!(parse_version("  1.3.7\n").unwrap(), (1, 3, 7));
    }

    #[test]
    fn parse_version_strips_suffix() {
        assert_eq!(parse_version("1.3.5-rc1").unwrap(), (1, 3, 5));
        assert_eq!(parse_version("1.3.7-pushtest").unwrap(), (1, 3, 7));
        assert_eq!(parse_version("1.3.0beta").unwrap(), (1, 3, 0));
    }

    #[test]
    fn parse_version_rejects_too_few_parts() {
        assert!(parse_version("1.3").is_err());
        assert!(parse_version("1").is_err());
        assert!(parse_version("").is_err());
    }

    #[test]
    fn parse_version_rejects_non_numeric_major_minor() {
        assert!(parse_version("x.3.5").is_err());
        assert!(parse_version("1.y.5").is_err());
    }

    #[test]
    fn is_newer_strict_ordering() {
        assert!(is_newer((1, 3, 7), (1, 3, 5)));
        assert!(is_newer((1, 4, 0), (1, 3, 99)));
        assert!(is_newer((2, 0, 0), (1, 999, 999)));
        assert!(!is_newer((1, 3, 5), (1, 3, 5)));
        assert!(!is_newer((1, 3, 5), (1, 3, 7)));
        assert!(!is_newer((0, 0, 0), (1, 3, 7))); // agent 채널 영구 락 케이스
    }

    #[test]
    fn is_newer_str_compares_and_rejects_garbage() {
        assert!(is_newer_str("1.4.20", "1.4.19").unwrap());
        assert!(!is_newer_str("1.4.19", "1.4.19").unwrap()); // 동일 버전 = 새 버전 아님 (C2 재설치 루프 차단 핵심)
        assert!(!is_newer_str("1.4.18", "1.4.19").unwrap()); // 다운그레이드
        assert!(is_newer_str("bad", "1.4.19").is_err());
        assert!(is_newer_str("1.4.19", "").is_err());
    }

    // --- C3: expected sha 형식 검증 ---

    #[test]
    fn is_valid_sha256_hex_accepts_canonical() {
        assert!(is_valid_sha256_hex(
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        ));
        // 대소문자 혼용 + 앞뒤 공백 허용
        assert!(is_valid_sha256_hex(
            "  2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824  "
        ));
    }

    #[test]
    fn is_valid_sha256_hex_rejects_bad() {
        assert!(!is_valid_sha256_hex("")); // 빈값 — latest.json 빈 agent 채널 / 패널 자리표시자
        assert!(!is_valid_sha256_hex("deadbeef")); // 너무 짧음
        assert!(!is_valid_sha256_hex(&"a".repeat(63))); // 63자
        assert!(!is_valid_sha256_hex(&"a".repeat(65))); // 65자
        assert!(!is_valid_sha256_hex(&"g".repeat(64))); // 길이 64지만 비-hex
        assert!(!is_valid_sha256_hex(&format!("{}zz", "a".repeat(62)))); // 끝에 비-hex
    }

    fn write_tmp(name: &str, bytes: &[u8]) -> PathBuf {
        let p = std::env::temp_dir().join(format!("cr_common_test_{}_{}", std::process::id(), name));
        std::fs::write(&p, bytes).expect("write tmp");
        p
    }

    #[test]
    fn verify_sha256_ok_when_matching() {
        // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        let p = write_tmp("hello.bin", b"hello");
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        let r = verify_sha256(&p, expected);
        let _ = std::fs::remove_file(&p);
        assert!(r.is_ok(), "verify failed unexpectedly: {:?}", r.err());
    }

    #[test]
    fn verify_sha256_accepts_mixed_case_and_whitespace() {
        let p = write_tmp("hello2.bin", b"hello");
        let expected = "  2CF24DBA5FB0A30E26E83B2AC5B9E29E1B161E5C1FA7425E73043362938B9824  ";
        let r = verify_sha256(&p, expected);
        let _ = std::fs::remove_file(&p);
        assert!(r.is_ok());
    }

    #[test]
    fn verify_sha256_err_and_deletes_on_mismatch() {
        let p = write_tmp("bad.bin", b"hello");
        let wrong = "0000000000000000000000000000000000000000000000000000000000000000";
        let r = verify_sha256(&p, wrong);
        assert!(r.is_err());
        // 형식은 맞고 값만 다른 진짜 mismatch → 손상 파일 자동 정리됨.
        assert!(!p.exists(), "mismatch 파일이 자동 정리되지 않음");
    }

    #[test]
    fn verify_sha256_err_on_missing_file() {
        let p = std::env::temp_dir().join(format!("cr_common_missing_{}.bin", std::process::id()));
        let _ = std::fs::remove_file(&p);
        let r = verify_sha256(&p, &"0".repeat(64));
        assert!(r.is_err());
    }

    #[test]
    fn verify_sha256_rejects_empty_expected_and_preserves_file() {
        // C3 핵심: 빈 expected (패널 빈 sha 푸시) → 파일 보존 + 명확한 실패 (재다운 루프 차단).
        let p = write_tmp("keep_empty.bin", b"hello");
        let r = verify_sha256(&p, "");
        assert!(r.is_err());
        assert!(p.exists(), "빈 expected 는 매니페스트 결함이므로 파일을 지우면 안 됨");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn verify_sha256_rejects_malformed_expected_and_preserves_file() {
        let p = write_tmp("keep_malformed.bin", b"hello");
        for bad in ["deadbeef", &"a".repeat(63), &"g".repeat(64)] {
            let r = verify_sha256(&p, bad);
            assert!(r.is_err(), "expected={:?} 가 통과됨", bad);
            assert!(p.exists(), "불량 expected={:?} 인데 파일이 삭제됨", bad);
        }
        let _ = std::fs::remove_file(&p);
    }
}
