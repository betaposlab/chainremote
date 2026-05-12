# hwcodec C++ 소스 자동 패치 — ffmpeg 8.x 호환 만들기.
#
# 배경: rustdesk-org/hwcodec 0.7.1 (commit 398e5a8) 의 C++ 가 ffmpeg 5/6 API 가정.
# vcpkg ffmpeg 8.x 에서:
#   - AVFrame.key_frame 필드 제거 → AV_FRAME_FLAG_KEY 사용
#   - FF_PROFILE_* 상수 → AV_PROFILE_*
#   - 빌드 옵션 swresample 라이브러리 링크 누락
#
# Mac 에서 같은 패치 적용 검증됨 (2026-05-12). 동일 패치를 윈컴 cargo git checkout 에도 박는다.
# 이 스크립트는 idempotent — 이미 패치돼 있으면 skip.

$ErrorActionPreference = "Stop"
Write-Host "=== hwcodec C++ ffmpeg 8.x 호환 패치 ===" -ForegroundColor Cyan

# 1. hwcodec 소스 경로 찾기 — cargo git checkout 폴더
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { "$env:USERPROFILE\.cargo" }
$checkoutsBase = Join-Path $cargoHome "git\checkouts"
if (-not (Test-Path $checkoutsBase)) {
    Write-Host "❌ cargo git checkout 폴더 없음: $checkoutsBase" -ForegroundColor Red
    Write-Host "   먼저 cargo build 한 번 돌려서 hwcodec 받아오게 해야 함" -ForegroundColor Yellow
    exit 1
}

$hwcodecDir = Get-ChildItem -Path $checkoutsBase -Directory -Filter "hwcodec-*" -ErrorAction SilentlyContinue |
              Select-Object -First 1
if (-not $hwcodecDir) {
    Write-Host "❌ hwcodec 폴더 없음 — 먼저 cargo build 실행 필요" -ForegroundColor Red
    exit 1
}

# 386e5a8 같은 commit hash sub-folder
$commitDir = Get-ChildItem -Path $hwcodecDir.FullName -Directory | Select-Object -First 1
if (-not $commitDir) {
    Write-Host "❌ hwcodec commit 폴더 없음" -ForegroundColor Red
    exit 1
}
$root = $commitDir.FullName
Write-Host "  hwcodec 소스: $root" -ForegroundColor Gray

# === Patch 1: ffmpeg_ram_decode.cpp — key_frame → flags & AV_FRAME_FLAG_KEY ===
$f1 = Join-Path $root "cpp\ffmpeg_ram\ffmpeg_ram_decode.cpp"
if (Test-Path $f1) {
    $content = Get-Content $f1 -Raw
    if ($content -match "PATCHED-2026-05-12-keyframe") {
        Write-Host "  [1/3] ffmpeg_ram_decode.cpp 이미 패치됨" -ForegroundColor Gray
    } else {
        $old = @"
#if FF_API_FRAME_KEY
      int key_frame = frame_->flags & AV_FRAME_FLAG_KEY;
#else
      int key_frame = frame_->key_frame;
#endif
"@
        $new = @"
// PATCHED-2026-05-12-keyframe : ffmpeg 8.x 에선 key_frame 필드 제거. 분기 거꾸로된 원본 무력화.
      int key_frame = frame_->flags & AV_FRAME_FLAG_KEY;
"@
        if ($content.Contains($old)) {
            $content = $content.Replace($old, $new)
            Set-Content -Path $f1 -Value $content -NoNewline
            Write-Host "  [1/3] ffmpeg_ram_decode.cpp 패치 완료" -ForegroundColor Green
        } else {
            Write-Host "  [1/3] ffmpeg_ram_decode.cpp — 예상 패턴 못 찾음. 수동 확인 필요" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  [1/3] ffmpeg_ram_decode.cpp 파일 없음" -ForegroundColor Yellow
}

# === Patch 2: util.cpp — FF_PROFILE_* → AV_PROFILE_* ===
$f2 = Join-Path $root "cpp\common\util.cpp"
if (Test-Path $f2) {
    $content = Get-Content $f2 -Raw
    if ($content -match "PATCHED-2026-05-12-profile") {
        Write-Host "  [2/3] util.cpp 이미 패치됨" -ForegroundColor Gray
    } else {
        $old = @"
  if (name.find("h264") != std::string::npos) {
    c->profile = FF_PROFILE_H264_HIGH;
  } else if (name.find("hevc") != std::string::npos) {
    c->profile = FF_PROFILE_HEVC_MAIN;
  }
"@
        $new = @"
  // PATCHED-2026-05-12-profile : FF_PROFILE_* → AV_PROFILE_* (ffmpeg 7+)
  if (name.find("h264") != std::string::npos) {
    c->profile = AV_PROFILE_H264_HIGH;
  } else if (name.find("hevc") != std::string::npos) {
    c->profile = AV_PROFILE_HEVC_MAIN;
  }
"@
        if ($content.Contains($old)) {
            $content = $content.Replace($old, $new)
            Set-Content -Path $f2 -Value $content -NoNewline
            Write-Host "  [2/3] util.cpp 패치 완료" -ForegroundColor Green
        } else {
            Write-Host "  [2/3] util.cpp — 예상 패턴 못 찾음. 수동 확인 필요" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  [2/3] util.cpp 파일 없음" -ForegroundColor Yellow
}

# === Patch 3: build.rs — swresample + swscale 정적 링크 추가 ===
$f3 = Join-Path $root "build.rs"
if (Test-Path $f3) {
    $content = Get-Content $f3 -Raw
    if ($content -match "PATCHED-2026-05-12-swresample") {
        Write-Host "  [3/3] build.rs 이미 패치됨" -ForegroundColor Gray
    } else {
        $old = 'let mut static_libs = vec!["avcodec", "avutil", "avformat"];'
        $new = @"
// PATCHED-2026-05-12-swresample : opus 디코더가 swr_* 호출 → swresample 추가 링크 필수
            let mut static_libs = vec!["avcodec", "avutil", "avformat", "swresample", "swscale"];
"@
        if ($content.Contains($old)) {
            $content = $content.Replace($old, $new)
            Set-Content -Path $f3 -Value $content -NoNewline
            Write-Host "  [3/3] build.rs 패치 완료" -ForegroundColor Green
        } else {
            Write-Host "  [3/3] build.rs — 예상 패턴 못 찾음. 수동 확인 필요" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  [3/3] build.rs 파일 없음" -ForegroundColor Yellow
}

Write-Host "=== 패치 종료 ===" -ForegroundColor Cyan
