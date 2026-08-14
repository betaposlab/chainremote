# -RegenBridge: src/flutter_ffi.rs(코어↔화면 연결부)를 바꿨을 때만 다리파일(bridge)을 재생성한다.
#   기본은 git 에 커밋된 다리파일을 그대로 쓴다 (Mac+Win 공용 설계). 재생성엔 RUSTC_BOOTSTRAP=1 +
#   flutter_rust_bridge_codegen 1.80.1 / cargo-expand 1.0.95 (집윈컴 ~/.cargo/bin) 필요.
param([switch]$RegenBridge)

$ErrorActionPreference = "Stop"
Write-Host "=== ChainRemote 풀 빌드 자동 실행 ===" -ForegroundColor Cyan
Write-Host ""

# 0. PATH refresh + 추가 경로 + 환경변수 확인
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
if (-not $env:VCPKG_ROOT) { $env:VCPKG_ROOT = "C:\src\vcpkg" }

# Chocolatey/NASM/Flutter/Cargo/LLVM 일반 설치 위치 강제 추가
$extraPaths = @(
  "C:\ProgramData\chocolatey\bin",
  "C:\Program Files\NASM",
  "C:\Program Files\LLVM\bin",
  "C:\src\flutter-3.24.5\bin",
  "$env:USERPROFILE\.cargo\bin",
  "$env:USERPROFILE\.rustup\toolchains\1.81.0-x86_64-pc-windows-msvc\bin"
)
foreach ($p in $extraPaths) {
  if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) { $env:Path = "$p;$env:Path" }
}

# LIBCLANG_PATH (bindgen 필수) — 미설정 시 자동 채움
if (-not $env:LIBCLANG_PATH) {
  if (Test-Path "C:\Program Files\LLVM\bin\libclang.dll") {
    $env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin"
    [System.Environment]::SetEnvironmentVariable("LIBCLANG_PATH", $env:LIBCLANG_PATH, "User")
  }
}

# 1. 필수 도구 검증 (nasm은 vcpkg 내부 빌드에만 필요했으므로 빌드 시점엔 선택)
Write-Host "[1/5] 빌드 환경 검증..." -ForegroundColor Yellow
$required = @("git","python","cargo","flutter","cmake")
$missing = @()
foreach ($tool in $required) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { $missing += $tool }
}
if ($missing.Count -gt 0) {
  Write-Host "❌ 누락된 도구: $($missing -join ', ')" -ForegroundColor Red
  Write-Host "   현재 PATH의 일부:" -ForegroundColor Yellow
  ($env:Path -split ';') | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
  exit 1
}
$nasmFound = (Get-Command nasm -ErrorAction SilentlyContinue) -ne $null
Write-Host "    OK (필수: $($required -join ', '))" -ForegroundColor Gray
if ($nasmFound) { Write-Host "    NASM 감지" -ForegroundColor Gray } else { Write-Host "    NASM 미감지 (괜찮음 — vcpkg 라이브러리는 이미 빌드됨)" -ForegroundColor Gray }

# 2. 소스 클론 (이미 있으면 skip)
$repoDir = "C:\src\ChainRemote"
if (-not (Test-Path $repoDir)) {
  Write-Host "[2/5] 소스 클론..." -ForegroundColor Yellow
  Write-Host "    GitHub 인증 팝업 뜨면 브라우저에서 승인하세요." -ForegroundColor Cyan
  if (-not (Test-Path "C:\src")) { New-Item -ItemType Directory -Path "C:\src" -Force | Out-Null }
  Push-Location "C:\src"
  git clone https://github.com/betaposlab/chainremote.git ChainRemote
  if ($LASTEXITCODE -ne 0) { Write-Host "❌ git clone 실패" -ForegroundColor Red; exit 1 }
  Pop-Location
} else {
  Write-Host "[2/5] 소스 이미 있음, git pull..." -ForegroundColor Yellow
  Push-Location $repoDir
  git pull
  Pop-Location
}

Push-Location $repoDir

# 3. submodule (betaposlab/hbb_common chainremote-defaults 브랜치)
Write-Host "[3/5] submodule 받기..." -ForegroundColor Yellow
git submodule sync --recursive
git submodule update --init --recursive
if ($LASTEXITCODE -ne 0) { Write-Host "❌ submodule 실패" -ForegroundColor Red; Pop-Location; exit 1 }

# submodule 브랜치 확인 (chainremote-defaults이어야 함)
Push-Location libs/hbb_common
$head = git rev-parse HEAD
$branchHead = git rev-parse origin/chainremote-defaults 2>$null
if ($head -ne $branchHead) {
  Write-Host "    submodule을 chainremote-defaults로 강제 정렬..." -ForegroundColor Yellow
  git fetch origin chainremote-defaults
  git checkout chainremote-defaults
  git reset --hard origin/chainremote-defaults
}
Pop-Location

# 3.5. flutter_rust_bridge 다리파일 (bridge)
# 다리파일 3종(src\bridge_generated.rs / .io.rs / flutter\lib\generated_bridge.dart)은
#    .gitignore 에서 의도적으로 풀어 git 에 커밋한다 — Mac+Win 두 머신 공용. 기본 동작은
#    커밋된 다리파일을 그대로 쓰는 것(재생성 안 함). 일반 `python build.py` 도 codegen 을 안 돌리므로
#    (도커 전용 함수에만 있음) 이게 빌드에서 유일한 다리파일 단계다. 재생성은 src\flutter_ffi.rs
#    (코어↔화면 연결부)를 바꿨을 때만 -RegenBridge 로 명시 실행(RUSTC_BOOTSTRAP=1 필요).
Write-Host "[3.5/5] flutter_rust_bridge 다리파일..." -ForegroundColor Yellow
$bridgeFiles = @("src\bridge_generated.rs", "src\bridge_generated.io.rs", "flutter\lib\generated_bridge.dart")
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"

# flutter 의존성 (빌드에 필수 — 재생성 여부 무관)
Push-Location flutter
cmd /c "flutter pub get" 2>&1 | Select-Object -Last 3
Pop-Location

if ($RegenBridge) {
  Write-Host "    -RegenBridge: 다리파일 재생성 (RUSTC_BOOTSTRAP=1 로 stable cargo expand 허용)..." -ForegroundColor Yellow
  cmd /c "dart pub global activate ffigen --version 5.0.1" 2>&1 | Select-Object -Last 3
  $prevBootstrap = $env:RUSTC_BOOTSTRAP; $env:RUSTC_BOOTSTRAP = "1"
  cmd /c "flutter_rust_bridge_codegen --rust-input ./src/flutter_ffi.rs --dart-output ./flutter/lib/generated_bridge.dart" 2>&1 | Tee-Object -Append -FilePath "$env:TEMP\chainremote-codegen.log"
  $codegenExit = $LASTEXITCODE
  if ($null -eq $prevBootstrap) { Remove-Item Env:\RUSTC_BOOTSTRAP -ErrorAction SilentlyContinue } else { $env:RUSTC_BOOTSTRAP = $prevBootstrap }
  if ($codegenExit -ne 0) {
    $ErrorActionPreference = $prevEAP
    Write-Host "❌ codegen 실패 (exit $codegenExit). 로그: $env:TEMP\chainremote-codegen.log" -ForegroundColor Red
    Write-Host "   도구 확인(둘 다 --locked 필수): " -ForegroundColor Yellow
    Write-Host "     cargo install flutter_rust_bridge_codegen --version 1.80.1 --locked" -ForegroundColor Yellow
    Write-Host "     cargo install cargo-expand --version 1.0.95 --locked" -ForegroundColor Yellow
    Pop-Location; exit 1
  }
  Write-Host "    재생성 완료 — 'git diff' 로 변경 확인 후 커밋하세요 (커밋해야 다른 머신에 반영됨)." -ForegroundColor Gray
}
$ErrorActionPreference = $prevEAP

# 다리파일 존재 + 비어있지 않음 검증 — 커밋본 손상/누락을 빌드 전에 잡는다(옛 '거짓 OK' 버그 방지).
foreach ($bf in $bridgeFiles) {
  if ((-not (Test-Path $bf)) -or ((Get-Item $bf).Length -eq 0)) {
    Write-Host "❌ 다리파일 없음/비어있음: $bf" -ForegroundColor Red
    Write-Host "   git 추적된 다리파일이 깨졌습니다. 'git status' 확인 또는 Mac 에서 재생성+커밋 필요." -ForegroundColor Yellow
    Pop-Location; exit 1
  }
}
if ($RegenBridge) {
  Write-Host "    OK: 다리파일 3종 재생성+검증 통과" -ForegroundColor Gray
} else {
  Write-Host "    OK: 커밋된 다리파일 3종 사용 (재생성하려면 -RegenBridge)" -ForegroundColor Gray
}

# 3.8. vcpkg 의존성 (manifest 모드 — vcpkg.json + res/vcpkg 오버레이 포트 자동 사용)
# - ChainRemote 루트(vcpkg.json 위치)에서 vcpkg install → aom/mfx-dispatch/ffmpeg 패치본 설치.
# - 멱등: 이미 설치된 항목은 hash 일치 시 skip. ffmpeg 첫 빌드는 30~60분.
# - 과거 classic 모드 잔재(C:\src\vcpkg\installed)는 aom 구버전이라 manifest install 이 재빌드한다.
Write-Host "[3.8/5] vcpkg manifest install (의존성 동기화)..." -ForegroundColor Yellow
if (-not $env:VCPKG_ROOT) { $env:VCPKG_ROOT = "C:\src\vcpkg" }
if (-not (Test-Path "$env:VCPKG_ROOT\vcpkg.exe")) {
  Write-Host "❌ vcpkg 미설치. setup-build-env.ps1 먼저 실행하세요." -ForegroundColor Red
  Pop-Location; exit 1
}
$vcpkgLog = "$env:TEMP\chainremote-vcpkg.log"
$vcpkgInstallRoot = "$env:VCPKG_ROOT\installed"
# --host-triplet 도 x64-windows-static 으로 강제한다. vcpkg.json 의 ffmpeg 가 host=true 라
# 기본 host-triplet(x64-windows)으로 깔리면 target 빌드에서 avcodec.lib 를 못 찾는다.
cmd /c "`"$env:VCPKG_ROOT\vcpkg.exe`" install --triplet x64-windows-static --host-triplet x64-windows-static --x-install-root=`"$vcpkgInstallRoot`" > `"$vcpkgLog`" 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "❌ vcpkg manifest install 실패. 로그: $vcpkgLog" -ForegroundColor Red
  Get-Content $vcpkgLog -Tail 30 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }
  Pop-Location; exit 1
}
Write-Host "    OK: 의존성 동기화 완료" -ForegroundColor Gray

# 4. 빌드 (Rust + Flutter + portable installer)
# PowerShell 의 stderr=error 처리를 피하려고 cmd.exe 로 위임한다.
Write-Host "[4/5] 빌드 시작 (30~60분 소요)..." -ForegroundColor Yellow
Write-Host "    cmd.exe로 위임 실행. 진행은 $env:TEMP\chainremote-build.log 에서 실시간 확인 가능." -ForegroundColor Gray
Write-Host "    (다른 PowerShell 창에서: Get-Content $env:TEMP\chainremote-build.log -Wait)" -ForegroundColor Gray
$buildLog = "$env:TEMP\chainremote-build.log"
if (Test-Path $buildLog) { Remove-Item $buildLog -Force }

$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"

# v1.2.7+: --hwcodec — H.264/H.265 HW 인코더 활성(Mac 측 HW 디코더와 페어).
# 사전 조건: vcpkg 에 ffmpeg 설치(`vcpkg install ffmpeg` 1회).
# 첫 빌드는 hwcodec C++ 소스가 ffmpeg 8.x 와 안 맞아(key_frame / FF_PROFILE / swresample) 실패한다.
# 그래서 첫 빌드 실패 시 patch-hwcodec.ps1 을 자동 실행하고 재빌드한다. 패치 후엔 재실행해도 그대로 성공.
$buildArgs = "--flutter --hwcodec --portable"
cmd /c "python build.py $buildArgs > `"$buildLog`" 2>&1"
$buildExitCode = $LASTEXITCODE

if ($buildExitCode -ne 0) {
  Write-Host "    [4.5/5] 첫 빌드 실패 → hwcodec C++ 자동 패치 시도..." -ForegroundColor Yellow
  $patchScript = "$repoDir\deploy\win-build\patch-hwcodec.py"
  if (Test-Path $patchScript) {
    python $patchScript
    Write-Host "    재빌드..." -ForegroundColor Yellow
    cmd /c "python build.py $buildArgs > `"$buildLog`" 2>&1"
    $buildExitCode = $LASTEXITCODE
  } else {
    Write-Host "❌ patch-hwcodec.py 못 찾음: $patchScript" -ForegroundColor Red
  }
}
$ErrorActionPreference = $prevEAP

if ($buildExitCode -ne 0) {
  Write-Host "❌ 빌드 실패 (exit $buildExitCode). 로그 마지막 50줄:" -ForegroundColor Red
  if (Test-Path $buildLog) { Get-Content $buildLog | Select-Object -Last 50 }
  Pop-Location
  exit 1
}
Write-Host "    빌드 성공" -ForegroundColor Gray

# 4.8. Win7 런타임(UCRT + VC++) app-local 동봉 — 갓 설치한(미업데이트) Win7 거래처 대응.
#   stock Win7 엔 UCRT/VC++ 런타임이 없어 exe 가 실행조차 안 된다 → DLL 을 exe 옆에 동봉.
#   best-effort: SDK/VS 못 찾아도 빌드는 성공으로 넘어간다(경고만). 이건 x64 경로용이고,
#   32비트 에이전트는 build-agent32.ps1 이 같은 스크립트를 -Arch x86 으로 직접 호출한다.
Write-Host "[4.8/5] Win7 런타임(UCRT+VC++) app-local 동봉..." -ForegroundColor Yellow
$releaseX64 = "$repoDir\flutter\build\windows\x64\runner\Release"
$bundleScript = "$repoDir\deploy\win-build\bundle-win7-runtime.ps1"
try {
  & $bundleScript -ReleaseDir $releaseX64 -Arch x64
} catch {
  Write-Host "    ⚠ 런타임 동봉 실패(빌드는 성공): $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "      → 깨끗한 Win7 대응하려면 SDK/VS 확인 후 bundle-win7-runtime.ps1 수동 실행." -ForegroundColor Yellow
}

# 5. 결과물 확인
Write-Host "[5/5] 결과물 검색..." -ForegroundColor Yellow
$installer = Get-ChildItem -Path $repoDir -Filter "rustdesk-*-install.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$mainExe = Get-ChildItem -Path "$repoDir\flutter\build\windows\x64\runner\Release" -Filter "ChainRemote.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

Pop-Location

Write-Host "`n=== 빌드 완료 ===" -ForegroundColor Green
if ($installer) {
  $sizeMB = [Math]::Round($installer.Length/1MB,1)
  Write-Host "  📦 거래처 배포용 인스톨러: $($installer.FullName) ($sizeMB MB)" -ForegroundColor White
}
if ($mainExe) {
  $sizeMB = [Math]::Round($mainExe.Length/1MB,1)
  Write-Host "  🖥  본체 ChainRemote.exe: $($mainExe.FullName) ($sizeMB MB)" -ForegroundColor White
}
Write-Host ""
Write-Host "  검증: 인스톨러를 더블클릭 → 자동 설치 → ChainRemote 실행 →" -ForegroundColor Cyan
Write-Host "        config 파일 없이도 rs.626.kr 에 자동 등록되어야 함" -ForegroundColor Cyan
Write-Host ""
Write-Host "  빌드 로그: $buildLog" -ForegroundColor Gray
