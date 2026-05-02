$ErrorActionPreference = "Continue"
Write-Host "=== LLVM 15.0.6 직접 설치 + LIBCLANG_PATH + cargo 캐시 정리 ===" -ForegroundColor Cyan
Write-Host ""

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "❌ 관리자 권한 PowerShell 필요" -ForegroundColor Red
    exit 1
}

$llvmDir = "C:\Program Files\LLVM"
$llvmBin = "$llvmDir\bin"
$installer = "$env:TEMP\LLVM-15.0.6-win64.exe"

# 1. 기존 LLVM 정리
Write-Host "[1/6] 기존 LLVM 잔재 제거..." -ForegroundColor Yellow
choco uninstall -y llvm 2>&1 | Out-Null
if (Test-Path $llvmDir) { Remove-Item $llvmDir -Recurse -Force -ErrorAction SilentlyContinue }

# 2. LLVM 15.0.6 다운로드 (GitHub releases)
Write-Host "[2/6] LLVM 15.0.6 다운로드 (~250MB)..." -ForegroundColor Yellow
$url = "https://github.com/llvm/llvm-project/releases/download/llvmorg-15.0.6/LLVM-15.0.6-win64.exe"
$prevPP = $ProgressPreference
$ProgressPreference = "SilentlyContinue"
Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing
$ProgressPreference = $prevPP
if (-not (Test-Path $installer)) { Write-Host "❌ 다운로드 실패" -ForegroundColor Red; exit 1 }
Write-Host "    저장: $installer ($([Math]::Round((Get-Item $installer).Length/1MB,1)) MB)" -ForegroundColor Gray

# 3. 사일런트 설치 (NSIS — /S 옵션)
Write-Host "[3/6] LLVM 15.0.6 설치 중 (3~5분)..." -ForegroundColor Yellow
$proc = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
if ($proc.ExitCode -ne 0) { Write-Host "⚠ 설치 종료 코드 $($proc.ExitCode), 그래도 검증 진행" -ForegroundColor Yellow }

# 4. libclang.dll 검증
Write-Host "[4/6] libclang.dll 검증..." -ForegroundColor Yellow
if (-not (Test-Path "$llvmBin\libclang.dll")) {
    Write-Host "❌ $llvmBin\libclang.dll 못 찾음. 설치 실패." -ForegroundColor Red
    Write-Host "    LLVM 흔적 검색:" -ForegroundColor Yellow
    Get-ChildItem -Path "C:\Program Files" -Filter "libclang.dll" -Recurse -ErrorAction SilentlyContinue | Select-Object FullName | Format-Table -AutoSize
    exit 1
}
Write-Host "    OK: $llvmBin\libclang.dll" -ForegroundColor Gray
& "$llvmBin\clang.exe" --version 2>&1 | Select-Object -First 2

# 5. LIBCLANG_PATH + PATH 등록
Write-Host "[5/6] 환경변수 등록..." -ForegroundColor Yellow
[System.Environment]::SetEnvironmentVariable("LIBCLANG_PATH", $llvmBin, "User")
$userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($userPath -notlike "*$llvmBin*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$llvmBin;$userPath", "User")
}
$env:LIBCLANG_PATH = $llvmBin
$env:Path = "$llvmBin;$env:Path"
Write-Host "    LIBCLANG_PATH=$llvmBin (사용자 환경변수)" -ForegroundColor Gray

# 6. ChainRemote target 폴더 정리 (재bindgen 강제)
Write-Host "[6/6] ChainRemote 빌드 캐시 정리..." -ForegroundColor Yellow
$repoDir = "C:\src\ChainRemote"
if (Test-Path "$repoDir\target") {
    Remove-Item "$repoDir\target" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "    target/ 제거됨" -ForegroundColor Gray
}

Write-Host "`n=== 완료 ===" -ForegroundColor Green
Write-Host ""
Write-Host "다음: 새 PowerShell 창 열고 빌드 재시도:" -ForegroundColor Cyan
Write-Host "    iex (irm http://192.168.68.108:8765/build-all.ps1)" -ForegroundColor White
