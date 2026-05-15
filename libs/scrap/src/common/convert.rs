#![allow(non_camel_case_types)]
#![allow(non_snake_case)]
#![allow(non_upper_case_globals)]
#![allow(improper_ctypes)]
#![allow(dead_code)]

include!(concat!(env!("OUT_DIR"), "/yuv_ffi.rs"));

#[cfg(not(target_os = "ios"))]
use crate::PixelBuffer;
use crate::{generate_call_macro, EncodeYuvFormat, TraitPixelBuffer};
use hbb_common::{bail, log, ResultType};

generate_call_macro!(call_yuv, false);

/// PixelBuffer wrapper — extracts raw refs then calls `convert_to_yuv_raw`.
/// ChainRemote: kept as thin wrapper so callers with PixelBuffer can use it unchanged;
/// our resize path bypasses PixelBuffer (custom Vec<u8>) and calls `_raw` directly.
#[cfg(not(target_os = "ios"))]
pub fn convert_to_yuv(
    captured: &PixelBuffer,
    dst_fmt: EncodeYuvFormat,
    dst: &mut Vec<u8>,
    mid_data: &mut Vec<u8>,
) -> ResultType<()> {
    convert_to_yuv_raw(
        captured.data(),
        captured.pixfmt(),
        captured.width(),
        captured.height(),
        captured.stride()[0],
        dst_fmt,
        dst,
        mid_data,
    )
}

/// Raw form — no PixelBuffer dependency. Used by `convert_to_yuv` and ChainRemote's
/// server-side virtual-display resize path (libs/scrap/src/common/scale.rs).
pub fn convert_to_yuv_raw(
    src: &[u8],
    src_pixfmt: crate::Pixfmt,
    src_width: usize,
    src_height: usize,
    src_stride_0: usize,
    dst_fmt: EncodeYuvFormat,
    dst: &mut Vec<u8>,
    mid_data: &mut Vec<u8>,
) -> ResultType<()> {
    if src_width > dst_fmt.w || src_height > dst_fmt.h {
        bail!(
            "src rect > dst rect: ({src_width}, {src_height}) > ({},{})",
            dst_fmt.w,
            dst_fmt.h
        );
    }
    if src_pixfmt == crate::Pixfmt::BGRA
        || src_pixfmt == crate::Pixfmt::RGBA
        || src_pixfmt == crate::Pixfmt::RGB565LE
    {
        if src_stride_0 < src_width * src_pixfmt.bytes_per_pixel() {
            bail!(
                "src_stride too small: {} < {}",
                src_stride_0,
                src_width * src_pixfmt.bytes_per_pixel()
            );
        }
        if src.len() < src_stride_0 * src_height {
            bail!(
                "wrong src len, {} < {} * {}",
                src.len(),
                src_stride_0,
                src_height
            );
        }
    }
    let align = |x: usize| (x + 63) / 64 * 64;
    let unsupported = format!(
        "unsupported pixfmt conversion: {src_pixfmt:?} -> {:?}",
        dst_fmt.pixfmt
    );

    match (src_pixfmt, dst_fmt.pixfmt) {
        (crate::Pixfmt::BGRA, crate::Pixfmt::I420)
        | (crate::Pixfmt::RGBA, crate::Pixfmt::I420)
        | (crate::Pixfmt::RGB565LE, crate::Pixfmt::I420) => {
            let dst_stride_y = dst_fmt.stride[0];
            let dst_stride_uv = dst_fmt.stride[1];
            dst.resize(dst_fmt.h * dst_stride_y * 2, 0);
            let dst_y = dst.as_mut_ptr();
            let dst_u = dst[dst_fmt.u..].as_mut_ptr();
            let dst_v = dst[dst_fmt.v..].as_mut_ptr();
            // ChainRemote: 스크린 캡처는 sRGB full range (0-255) 이므로 J 변형 사용.
            //   I 변형 (BT.601 limited 16-235) = full→limited 매핑에서 명암 약화 ("환하게" 보임)
            //   J 변형 (BT.601 full 0-255) = 명암 보존
            // SW 코덱 (VP8/VP9/AV1) 의 디코더는 색공간 메타데이터를 따라 RGB 복원하므로
            // 인코더가 full range YUV 보내면 자연스럽게 처리됨.
            let f = match src_pixfmt {
                crate::Pixfmt::BGRA => ARGBToJ420,
                crate::Pixfmt::RGBA => ABGRToJ420,
                crate::Pixfmt::RGB565LE => RGB565ToI420, // RGB565 J 변형 없음, 폴백
                _ => bail!(unsupported),
            };
            call_yuv!(f(
                src.as_ptr(),
                src_stride_0 as _,
                dst_y,
                dst_stride_y as _,
                dst_u,
                dst_stride_uv as _,
                dst_v,
                dst_stride_uv as _,
                src_width as _,
                src_height as _,
            ));
        }
        (crate::Pixfmt::BGRA, crate::Pixfmt::NV12)
        | (crate::Pixfmt::RGBA, crate::Pixfmt::NV12)
        | (crate::Pixfmt::RGB565LE, crate::Pixfmt::NV12) => {
            let dst_stride_y = dst_fmt.stride[0];
            let dst_stride_uv = dst_fmt.stride[1];
            dst.resize(
                align(dst_fmt.h) * (align(dst_stride_y) + align(dst_stride_uv / 2)),
                0,
            );
            let dst_y = dst.as_mut_ptr();
            let dst_uv = dst[dst_fmt.u..].as_mut_ptr();
            let (input, input_stride) = match src_pixfmt {
                crate::Pixfmt::BGRA => (src.as_ptr(), src_stride_0),
                crate::Pixfmt::RGBA => (src.as_ptr(), src_stride_0),
                crate::Pixfmt::RGB565LE => {
                    let mid_stride = src_width * 4;
                    mid_data.resize(mid_stride * src_height, 0);
                    call_yuv!(RGB565ToARGB(
                        src.as_ptr(),
                        src_stride_0 as _,
                        mid_data.as_mut_ptr(),
                        mid_stride as _,
                        src_width as _,
                        src_height as _,
                    ));
                    (mid_data.as_ptr(), mid_stride)
                }
                _ => bail!(unsupported),
            };
            let f = match src_pixfmt {
                crate::Pixfmt::BGRA => ARGBToNV12,
                crate::Pixfmt::RGBA => ABGRToNV12,
                crate::Pixfmt::RGB565LE => ARGBToNV12,
                _ => bail!(unsupported),
            };
            call_yuv!(f(
                input,
                input_stride as _,
                dst_y,
                dst_stride_y as _,
                dst_uv,
                dst_stride_uv as _,
                src_width as _,
                src_height as _,
            ));
        }
        (crate::Pixfmt::BGRA, crate::Pixfmt::I444)
        | (crate::Pixfmt::RGBA, crate::Pixfmt::I444)
        | (crate::Pixfmt::RGB565LE, crate::Pixfmt::I444) => {
            let dst_stride_y = dst_fmt.stride[0];
            let dst_stride_u = dst_fmt.stride[1];
            let dst_stride_v = dst_fmt.stride[2];
            dst.resize(
                align(dst_fmt.h)
                    * (align(dst_stride_y) + align(dst_stride_u) + align(dst_stride_v)),
                0,
            );
            let dst_y = dst.as_mut_ptr();
            let dst_u = dst[dst_fmt.u..].as_mut_ptr();
            let dst_v = dst[dst_fmt.v..].as_mut_ptr();
            let (input, input_stride) = match src_pixfmt {
                crate::Pixfmt::BGRA => (src.as_ptr(), src_stride_0),
                crate::Pixfmt::RGBA => {
                    mid_data.resize(src.len(), 0);
                    call_yuv!(ABGRToARGB(
                        src.as_ptr(),
                        src_stride_0 as _,
                        mid_data.as_mut_ptr(),
                        src_stride_0 as _,
                        src_width as _,
                        src_height as _,
                    ));
                    (mid_data.as_ptr(), src_stride_0)
                }
                crate::Pixfmt::RGB565LE => {
                    let mid_stride = src_width * 4;
                    mid_data.resize(mid_stride * src_height, 0);
                    call_yuv!(RGB565ToARGB(
                        src.as_ptr(),
                        src_stride_0 as _,
                        mid_data.as_mut_ptr(),
                        mid_stride as _,
                        src_width as _,
                        src_height as _,
                    ));
                    (mid_data.as_ptr(), mid_stride)
                }
                _ => bail!(unsupported),
            };

            // ChainRemote: I444 경로는 I 변형 유지. Windows 핀 libyuv 1857 에 ARGBToJ444
            // (4:4:4 JPEG full-range) 가 없음 (1916+ 에만 존재). I420 경로의 J420 으로
            // 색공간 개선의 핵심은 이미 커버됨. I444 는 i444='Y' + VP9/AV1 한정 희귀 경로.
            call_yuv!(ARGBToI444(
                input,
                input_stride as _,
                dst_y,
                dst_stride_y as _,
                dst_u,
                dst_stride_u as _,
                dst_v,
                dst_stride_v as _,
                src_width as _,
                src_height as _,
            ));
        }
        _ => {
            bail!(unsupported);
        }
    }
    Ok(())
}

#[cfg(not(target_os = "ios"))]
pub fn convert(captured: &PixelBuffer, pixfmt: crate::Pixfmt, dst: &mut Vec<u8>) -> ResultType<()> {
    if captured.pixfmt() == pixfmt {
        dst.extend_from_slice(captured.data());
        return Ok(());
    }

    let src = captured.data();
    let src_stride = captured.stride();
    let src_pixfmt = captured.pixfmt();
    let src_width = captured.width();
    let src_height = captured.height();

    let unsupported = format!(
        "unsupported pixfmt conversion: {src_pixfmt:?} -> {:?}",
        pixfmt
    );

    match (src_pixfmt, pixfmt) {
        (crate::Pixfmt::BGRA, crate::Pixfmt::RGBA) | (crate::Pixfmt::RGBA, crate::Pixfmt::BGRA) => {
            dst.resize(src.len(), 0);
            call_yuv!(ABGRToARGB(
                src.as_ptr(),
                src_stride[0] as _,
                dst.as_mut_ptr(),
                src_stride[0] as _,
                src_width as _,
                src_height as _,
            ));
        }
        _ => {
            bail!(unsupported);
        }
    }
    Ok(())
}

/// ChainRemote: ARGB/BGRA 버퍼를 libyuv 의 ARGBScale 로 다운스케일.
///
/// `filter` 는 libyuv 의 FilterMode:
///   - 0 (kFilterNone)      = 가장 빠름, 픽셀 누락 (포인트 샘플)
///   - 1 (kFilterLinear)    = 선형 보간, 빠르고 무난
///   - 2 (kFilterBilinear)  = 2D 보간, 약간 느리고 부드러움
///   - 3 (kFilterBox)       = 영역 평균 — **글자 다운샘플에 최적**, SIMD 최적화됨
///
/// `kFilterBox` 가 글자 가독성에 가장 좋음 (실제 측정 결과). Bilinear 보다 조금 느리지만
/// 4K → 1080p 같은 정수배에 가까운 비율에서 텍스트 가장자리가 깨지지 않음.
///
/// 입출력 모두 BGRA/ARGB (libyuv 는 두 포맷을 같은 함수로 처리).
pub fn argb_scale_bgra(
    src: &[u8],
    src_stride: usize,
    src_width: usize,
    src_height: usize,
    dst: &mut [u8],
    dst_stride: usize,
    dst_width: usize,
    dst_height: usize,
) -> ResultType<()> {
    if src.len() < src_stride * src_height {
        bail!(
            "argb_scale: src too small ({} < {} * {})",
            src.len(),
            src_stride,
            src_height
        );
    }
    if dst.len() < dst_stride * dst_height {
        bail!(
            "argb_scale: dst too small ({} < {} * {})",
            dst.len(),
            dst_stride,
            dst_height
        );
    }
    unsafe {
        let rc = ARGBScale(
            src.as_ptr(),
            src_stride as _,
            src_width as _,
            src_height as _,
            dst.as_mut_ptr(),
            dst_stride as _,
            dst_width as _,
            dst_height as _,
            FilterMode::kFilterBox,
        );
        if rc != 0 {
            bail!("ARGBScale failed: rc={}", rc);
        }
    }
    Ok(())
}
