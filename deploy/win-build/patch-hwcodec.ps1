# hwcodec C++ 소스 자동 패치 — ffmpeg 7.x/8.x 호환.
# 적용 위치: cargo 의 git checkout 폴더 (cargo build 한 번 돌린 후 존재).
# Mac 측 동일 패치 검증됨 (2026-05-12).
# Idempotent — 마커 문자열로 중복 적용 방지.

$ErrorActionPreference = "Stop"
Write-Host "=== hwcodec C++ ffmpeg 호환 패치 ===" -ForegroundColor Cyan

$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { "$env:USERPROFILE\.cargo" }
$base = Join-Path $cargoHome "git\checkouts"
if (-not (Test-Path $base)) {
    Write-Host "cargo git checkout 없음: $base" -ForegroundColor Red
    exit 1
}
$hwcodecDir = Get-ChildItem $base -Directory -Filter "hwcodec-*" -EA SilentlyContinue | Select -First 1
if (-not $hwcodecDir) { Write-Host "hwcodec 폴더 없음" -ForegroundColor Red; exit 1 }
$commitDir = Get-ChildItem $hwcodecDir.FullName -Directory | Select -First 1
if (-not $commitDir) { Write-Host "commit 폴더 없음" -ForegroundColor Red; exit 1 }
$root = $commitDir.FullName
Write-Host "소스 위치: $root" -ForegroundColor Gray

function Apply-Patch {
    param([string]$File, [string]$Marker, [string]$Pattern, [string]$Replacement, [string]$Label)
    if (-not (Test-Path $File)) { Write-Host "  $Label : 파일 없음 ($File)" -ForegroundColor Yellow; return }
    $content = [System.IO.File]::ReadAllText($File)
    if ($content.Contains($Marker)) { Write-Host "  $Label : 이미 패치됨" -ForegroundColor Gray; return }
    if (-not ($content -match [regex]::Escape($Pattern))) {
        Write-Host "  $Label : 패턴 못 찾음" -ForegroundColor Yellow
        return
    }
    $new = $content.Replace($Pattern, $Replacement)
    [System.IO.File]::WriteAllText($File, $new)
    Write-Host "  $Label : 패치 완료" -ForegroundColor Green
}

# Patch 1: ffmpeg_ram_decode.cpp — key_frame 필드 제거 대응
$f1 = Join-Path $root "cpp\ffmpeg_ram\ffmpeg_ram_decode.cpp"
$p1Pattern = "#if FF_API_FRAME_KEY`n      int key_frame = frame_->flags & AV_FRAME_FLAG_KEY;`n#else`n      int key_frame = frame_->key_frame;`n#endif"
$p1Replace = "// PATCHED-keyframe`n      int key_frame = frame_->flags & AV_FRAME_FLAG_KEY;"
Apply-Patch -File $f1 -Marker "PATCHED-keyframe" -Pattern $p1Pattern -Replacement $p1Replace -Label "[1/3] ffmpeg_ram_decode.cpp"

# Patch 2: util.cpp — FF_PROFILE_* → AV_PROFILE_*
$f2 = Join-Path $root "cpp\common\util.cpp"
Apply-Patch -File $f2 -Marker "AV_PROFILE_H264_HIGH" -Pattern "FF_PROFILE_H264_HIGH" -Replacement "AV_PROFILE_H264_HIGH" -Label "[2a/3] util.cpp H264_HIGH"
Apply-Patch -File $f2 -Marker "AV_PROFILE_HEVC_MAIN" -Pattern "FF_PROFILE_HEVC_MAIN" -Replacement "AV_PROFILE_HEVC_MAIN" -Label "[2b/3] util.cpp HEVC_MAIN"

# Patch 3: build.rs — swresample + swscale 정적 링크 추가
$f3 = Join-Path $root "build.rs"
$p3Pattern = 'let mut static_libs = vec!["avcodec", "avutil", "avformat"];'
$p3Replace = 'let mut static_libs = vec!["avcodec", "avutil", "avformat", "swresample", "swscale"]; // PATCHED-swresample'
Apply-Patch -File $f3 -Marker "PATCHED-swresample" -Pattern $p3Pattern -Replacement $p3Replace -Label "[3/3] build.rs"

Write-Host "=== 패치 종료 ===" -ForegroundColor Cyan
