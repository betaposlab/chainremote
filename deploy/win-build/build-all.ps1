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

# 3.5. flutter_rust_bridge codegen (src/bridge_generated.rs 등은 .gitignore 라 git 클론에 없음)
Write-Host "[3.5/5] flutter_rust_bridge codegen..." -ForegroundColor Yellow
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"

# ffigen 활성화 (codegen 의존성)
cmd /c "dart pub global activate ffigen --version 5.0.1" 2>&1 | Select-Object -Last 3

# flutter pub get (flutter 의존성)
Push-Location flutter
cmd /c "flutter pub get" 2>&1 | Select-Object -Last 3
Pop-Location

# bridge codegen 실행
cmd /c "flutter_rust_bridge_codegen --rust-input ./src/flutter_ffi.rs --dart-output ./flutter/lib/generated_bridge.dart" 2>&1 | Tee-Object -Append -FilePath "$env:TEMP\chainremote-codegen.log"
$ErrorActionPreference = $prevEAP

if (-not (Test-Path "src\bridge_generated.rs")) {
  Write-Host "❌ codegen 실패: src\bridge_generated.rs 생성 안 됨" -ForegroundColor Red
  Write-Host "   로그: $env:TEMP\chainremote-codegen.log" -ForegroundColor Yellow
  Pop-Location
  exit 1
}
Write-Host "    OK: src\bridge_generated.rs 및 .io.rs 생성됨" -ForegroundColor Gray

# 4. 빌드 (Rust + Flutter + portable installer)
# PowerShell의 stderr-as-error 처리를 우회하기 위해 cmd.exe로 위임
Write-Host "[4/5] 빌드 시작 (30~60분 소요)..." -ForegroundColor Yellow
Write-Host "    cmd.exe로 위임 실행. 진행은 $env:TEMP\chainremote-build.log 에서 실시간 확인 가능." -ForegroundColor Gray
Write-Host "    (다른 PowerShell 창에서: Get-Content $env:TEMP\chainremote-build.log -Wait)" -ForegroundColor Gray
$buildLog = "$env:TEMP\chainremote-build.log"
if (Test-Path $buildLog) { Remove-Item $buildLog -Force }

$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
cmd /c "python build.py --flutter --portable > `"$buildLog`" 2>&1"
$buildExitCode = $LASTEXITCODE
$ErrorActionPreference = $prevEAP

if ($buildExitCode -ne 0) {
  Write-Host "❌ 빌드 실패 (exit $buildExitCode). 로그 마지막 50줄:" -ForegroundColor Red
  if (Test-Path $buildLog) { Get-Content $buildLog | Select-Object -Last 50 }
  Pop-Location
  exit 1
}
Write-Host "    빌드 성공" -ForegroundColor Gray

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
Write-Host "        config 파일 없이도 sepani.synology.me NAS에 자동 등록되어야 함" -ForegroundColor Cyan
Write-Host ""
Write-Host "  빌드 로그: $buildLog" -ForegroundColor Gray
