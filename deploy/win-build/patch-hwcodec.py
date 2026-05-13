#!/usr/bin/env python3
"""
hwcodec C++ 소스 자동 패치 — ffmpeg 7.x/8.x 호환.

3개 패치:
1. ffmpeg_ram_decode.cpp : key_frame 필드 제거 대응 (조건부 분기 무력화)
2. util.cpp              : FF_PROFILE_* → AV_PROFILE_* (ffmpeg 7+ 상수명 변경)
3. build.rs              : swresample/swscale 정적 링크 추가 (opus 디코더가 swr_* 호출)

Mac 빌드에서 검증됨 (2026-05-12). Windows MSVC + cargo 동일 적용.
Idempotent — 마커 문자열로 중복 적용 방지.
"""

import os
import sys
import glob
import platform


def patch_file(path, marker, find, replace, label):
    if not os.path.exists(path):
        print(f"  {label} : 파일 없음 ({path})")
        return False
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if marker in content:
        print(f"  {label} : 이미 패치됨")
        return True
    if find not in content:
        print(f"  {label} : 원본 패턴 못 찾음")
        return False
    content = content.replace(find, replace)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  {label} : 패치 완료")
    return True


def main():
    print("=== hwcodec C++ ffmpeg 호환 패치 ===")

    cargo_home = os.environ.get("CARGO_HOME") or os.path.expanduser("~/.cargo")
    base = os.path.join(cargo_home, "git", "checkouts")
    if not os.path.isdir(base):
        print(f"cargo git checkout 폴더 없음: {base}")
        sys.exit(1)

    hwcodec_dirs = glob.glob(os.path.join(base, "hwcodec-*"))
    if not hwcodec_dirs:
        print("hwcodec-* 폴더 없음 — 먼저 cargo build 한 번 실행 필요")
        sys.exit(1)
    hwcodec_dir = hwcodec_dirs[0]
    commit_dirs = [d for d in os.listdir(hwcodec_dir) if os.path.isdir(os.path.join(hwcodec_dir, d))]
    if not commit_dirs:
        print("commit 폴더 없음")
        sys.exit(1)
    root = os.path.join(hwcodec_dir, commit_dirs[0])
    print(f"소스 위치: {root}")

    # ---- Patch 1: ffmpeg_ram_decode.cpp ----
    f1 = os.path.join(root, "cpp", "ffmpeg_ram", "ffmpeg_ram_decode.cpp")
    find1 = (
        "#if FF_API_FRAME_KEY\n"
        "      int key_frame = frame_->flags & AV_FRAME_FLAG_KEY;\n"
        "#else\n"
        "      int key_frame = frame_->key_frame;\n"
        "#endif"
    )
    replace1 = (
        "// PATCHED-keyframe : ffmpeg 8.x 호환 (key_frame 필드 제거)\n"
        "      int key_frame = frame_->flags & AV_FRAME_FLAG_KEY;"
    )
    patch_file(f1, "PATCHED-keyframe", find1, replace1, "[1/3] ffmpeg_ram_decode.cpp")

    # ---- Patch 2: util.cpp ----
    f2 = os.path.join(root, "cpp", "common", "util.cpp")
    patch_file(
        f2,
        "AV_PROFILE_H264_HIGH",
        "FF_PROFILE_H264_HIGH",
        "AV_PROFILE_H264_HIGH",
        "[2a/3] util.cpp H264_HIGH",
    )
    patch_file(
        f2,
        "AV_PROFILE_HEVC_MAIN",
        "FF_PROFILE_HEVC_MAIN",
        "AV_PROFILE_HEVC_MAIN",
        "[2b/3] util.cpp HEVC_MAIN",
    )

    # ---- Patch 3: build.rs (Mac 전용) ----
    # Windows: RustDesk 의 res/vcpkg/ffmpeg/portfile.cmake 가 swresample/swscale 명시적
    #   비활성 (--disable-swresample/swscale) → swresample.lib 자체가 없음. 원본 hwcodec
    #   build.rs 가 avcodec/avutil/avformat 만 링크하는 게 그 ffmpeg 구성과 정확히 맞음.
    # Mac:    homebrew/vcpkg ffmpeg 가 swresample 포함, opus 디코더가 swr_* 호출 →
    #   링크 필요.
    if platform.system() == "Darwin":
        f3 = os.path.join(root, "build.rs")
        find3 = 'let mut static_libs = vec!["avcodec", "avutil", "avformat"];'
        replace3 = (
            'let mut static_libs = vec!["avcodec", "avutil", "avformat", '
            '"swresample", "swscale"]; // PATCHED-swresample'
        )
        patch_file(f3, "PATCHED-swresample", find3, replace3, "[3/3] build.rs")
    else:
        print("  [3/3] build.rs : Windows — swresample 패치 skip (ffmpeg overlay 와 맞음)")

    print("=== 패치 종료 ===")


if __name__ == "__main__":
    main()
