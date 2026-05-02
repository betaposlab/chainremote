$ErrorActionPreference = "Stop"
Write-Host "=== ChainRemote_Setup.exe 인스톨러 빌드 ===" -ForegroundColor Cyan
Write-Host ""

# 1. NSIS 설치 (이미 있으면 skip)
if (-not (Get-Command makensis -ErrorAction SilentlyContinue) -and -not (Test-Path "C:\Program Files (x86)\NSIS\makensis.exe")) {
  Write-Host "[1/3] NSIS 설치 (Chocolatey)..." -ForegroundColor Yellow
  if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "❌ NSIS 설치엔 관리자 권한 PowerShell 필요" -ForegroundColor Red
    exit 1
  }
  choco install -y nsis
  $env:Path += ";C:\Program Files (x86)\NSIS"
} else {
  Write-Host "[1/3] NSIS 이미 설치됨" -ForegroundColor Green
}

# 2. 페이로드 검증/준비
$dir = "C:\src\ChainRemote\deploy\win-installer"
Push-Location $dir

# RustDesk 공식 인스톨러는 git 에 안 들어가므로 (23MB) 필요시 다운로드
$inner = "rustdesk-1.4.6-x86_64.exe"
if (-not (Test-Path $inner)) {
  Write-Host "[2/3] RustDesk 공식 인스톨러 다운로드..." -ForegroundColor Yellow
  $url = "https://github.com/rustdesk/rustdesk/releases/download/1.4.6/$inner"
  $prevPP = $ProgressPreference; $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri $url -OutFile $inner -UseBasicParsing
  $ProgressPreference = $prevPP
}
foreach ($f in @("installer.nsi","RustDesk2.toml",$inner)) {
  if (-not (Test-Path $f)) {
    Write-Host "❌ 누락: $dir\$f" -ForegroundColor Red
    Pop-Location; exit 1
  }
}
Write-Host "    페이로드 OK ($inner = $([Math]::Round((Get-Item $inner).Length/1MB,1)) MB)" -ForegroundColor Gray

# 3. makensis 실행
Write-Host "[3/3] makensis installer.nsi (1~3분, lzma 압축)..." -ForegroundColor Yellow
$nsisExe = if (Get-Command makensis -ErrorAction SilentlyContinue) { "makensis" } else { "C:\Program Files (x86)\NSIS\makensis.exe" }
& $nsisExe /V2 installer.nsi
if ($LASTEXITCODE -ne 0) { Write-Host "❌ NSIS 빌드 실패" -ForegroundColor Red; Pop-Location; exit 1 }

Pop-Location

$out = "$dir\ChainRemote_Setup.exe"
if (Test-Path $out) {
  $sizeMB = [Math]::Round((Get-Item $out).Length/1MB,1)
  Write-Host "`n=== 빌드 완료 ===" -ForegroundColor Green
  Write-Host "  결과물: $out ($sizeMB MB)" -ForegroundColor White
  Write-Host "`n  검증 절차:" -ForegroundColor Cyan
  Write-Host "    1. 이 .exe 를 VM 또는 다른 윈컴에서 더블클릭" -ForegroundColor White
  Write-Host "    2. 설치 진행 → 자동으로 ChainRemote 설치 + NAS 설정 적용" -ForegroundColor White
  Write-Host "    3. 설치된 ChainRemote 실행 → ID 발급 + 우리 NAS 등록 확인" -ForegroundColor White
} else {
  Write-Host "❌ ChainRemote_Setup.exe 못 찾음" -ForegroundColor Red
  exit 1
}
