# ChainRemote 윈컴 빌드 환경 자동 구축
# 관리자 권한 PowerShell 에서 실행
# 약 30~60분 소요 (다운로드 시간)

$ErrorActionPreference = "Stop"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "❌ 관리자 권한 PowerShell 에서 다시 실행하세요." -ForegroundColor Red
    Write-Host "   (시작 메뉴 → PowerShell 우클릭 → 관리자 권한으로 실행)" -ForegroundColor Yellow
    exit 1
}

Write-Host "=== ChainRemote 윈컴 빌드 환경 구축 ===" -ForegroundColor Cyan
Write-Host ""

# 0. Chocolatey 설치 (없으면)
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "[0/8] Chocolatey 설치..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "[0/8] Chocolatey 이미 설치됨" -ForegroundColor Green
}

# 1. Visual Studio 2022 Build Tools (MSVC C++ — Rust Windows 빌드 필수)
Write-Host "[1/8] Visual Studio 2022 Build Tools (MSVC) 설치..." -ForegroundColor Yellow
choco install -y visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows10SDK"

# 2. Rust 1.81 (rustup-init 사용)
Write-Host "[2/8] Rust 1.81 설치..." -ForegroundColor Yellow
if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
    choco install -y rustup.install
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
rustup install 1.81
rustup default 1.81

# 3. Git, Python, CMake, LLVM, NASM
Write-Host "[3/8] Git/Python/CMake/LLVM/NASM 설치..." -ForegroundColor Yellow
choco install -y git python cmake llvm nasm 7zip pkgconfiglite

# 4. Flutter 3.24.5 (RustDesk 호환 버전)
Write-Host "[4/8] Flutter 3.24.5 설치..." -ForegroundColor Yellow
$flutterDir = "C:\src\flutter-3.24.5"
if (-not (Test-Path $flutterDir)) {
    New-Item -ItemType Directory -Path "C:\src" -Force | Out-Null
    $flutterZip = "$env:TEMP\flutter-3.24.5.zip"
    Invoke-WebRequest -Uri "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.5-stable.zip" -OutFile $flutterZip
    Expand-Archive -Path $flutterZip -DestinationPath "C:\src" -Force
    Rename-Item "C:\src\flutter" $flutterDir
    Remove-Item $flutterZip
}

# 5. Flutter PATH 추가 (사용자 환경변수)
Write-Host "[5/8] PATH 환경변수 등록..." -ForegroundColor Yellow
$userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($userPath -notlike "*flutter-3.24.5\bin*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$flutterDir\bin", "User")
}
$env:Path += ";$flutterDir\bin"

# 6. Flutter 패치 (RustDesk 필수 — issue #133533 회피)
Write-Host "[6/8] Flutter SDK 패치..." -ForegroundColor Yellow
$bindingFile = "$flutterDir\packages\flutter\lib\src\scheduler\binding.dart"
if (Test-Path $bindingFile) {
    $content = Get-Content $bindingFile -Raw
    if ($content -match "_setFramesEnabledState\(false\);" -and $content -notmatch "//_setFramesEnabledState\(false\);") {
        $content = $content -replace "_setFramesEnabledState\(false\);", "//_setFramesEnabledState(false);"
        Set-Content -Path $bindingFile -Value $content -NoNewline
        Write-Host "    패치 적용됨" -ForegroundColor Green
    } else {
        Write-Host "    이미 패치되어 있거나 대상 코드 없음" -ForegroundColor Gray
    }
}

# 7. vcpkg + 의존성 라이브러리 (vpx, yuv, opus, aom)
# RustDesk CI가 핀해둔 vcpkg 커밋 사용 (AOM API 호환성 — config.rs:159-160 변경과 무관)
Write-Host "[7/8] vcpkg 설치 및 의존성 라이브러리 빌드 (시간 오래 걸림)..." -ForegroundColor Yellow
$vcpkgDir = "C:\src\vcpkg"
$vcpkgPinnedCommit = "120deac3062162151622ca4860575a33844ba10b"  # RustDesk CI flutter-build.yml 기준
if (-not (Test-Path $vcpkgDir)) {
    git clone https://github.com/microsoft/vcpkg "$vcpkgDir"
}
Push-Location $vcpkgDir
git fetch origin
git checkout $vcpkgPinnedCommit
& "$vcpkgDir\bootstrap-vcpkg.bat" -disableMetrics
Pop-Location
[System.Environment]::SetEnvironmentVariable("VCPKG_ROOT", $vcpkgDir, "User")
$env:VCPKG_ROOT = $vcpkgDir
& "$vcpkgDir\vcpkg.exe" install libvpx:x64-windows-static libyuv:x64-windows-static opus:x64-windows-static aom:x64-windows-static

# 8. flutter_rust_bridge_codegen 1.80.1
Write-Host "[8/8] flutter_rust_bridge_codegen 1.80.1 설치..." -ForegroundColor Yellow
cargo install flutter_rust_bridge_codegen --version 1.80.1

Write-Host "`n=== 환경 구축 완료 ===" -ForegroundColor Green
Write-Host ""
Write-Host "다음 단계:" -ForegroundColor Cyan
Write-Host "  1. PowerShell 새로 열기 (PATH 반영)" -ForegroundColor White
Write-Host "  2. cd C:\src" -ForegroundColor White
Write-Host "  3. git clone https://github.com/betaposlab/chainremote.git ChainRemote" -ForegroundColor White
Write-Host "  4. cd ChainRemote" -ForegroundColor White
Write-Host "  5. git submodule update --init --recursive" -ForegroundColor White
Write-Host "  6. python build.py --flutter --portable" -ForegroundColor White
Write-Host ""
Write-Host "빌드 결과: rustdesk-<version>-install.exe (= 거래처 배포용 ChainRemote 인스톨러)" -ForegroundColor Yellow
