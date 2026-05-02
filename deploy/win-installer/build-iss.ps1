$ErrorActionPreference = "Stop"
Write-Host "=== ChainRemote_Setup.exe 인스톨러 빌드 (Inno Setup) ===" -ForegroundColor Cyan

$dir = $PSScriptRoot
if (-not $dir) { $dir = (Get-Location).Path }
Push-Location $dir

# 1. RustDesk 공식 인스톨러 페이로드 (없으면 다운로드)
$inner = "rustdesk-1.4.6-x86_64.exe"
if (-not (Test-Path $inner)) {
  Write-Host "[1/3] RustDesk 공식 인스톨러 다운로드..." -ForegroundColor Yellow
  $url = "https://github.com/rustdesk/rustdesk/releases/download/1.4.6/$inner"
  $prevPP = $ProgressPreference; $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri $url -OutFile $inner -UseBasicParsing
  $ProgressPreference = $prevPP
}
Write-Host "[1/3] 페이로드 OK ($inner = $([Math]::Round((Get-Item $inner).Length/1MB,1)) MB)" -ForegroundColor Gray

# 2. ISCC.exe 위치 찾기
$isccCandidates = @(
  "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
  "C:\Program Files\Inno Setup 6\ISCC.exe",
  "C:\Program Files (x86)\Inno Setup 5\ISCC.exe"
)
$iscc = $null
foreach ($p in $isccCandidates) { if (Test-Path $p) { $iscc = $p; break } }
if (-not $iscc) {
  Write-Host "❌ ISCC.exe (Inno Setup 컴파일러) 못 찾음." -ForegroundColor Red
  Write-Host "   Inno Setup IDE 가 깔려 있다면 그곳에서 installer.iss 우클릭 → Compile 으로도 빌드 가능." -ForegroundColor Yellow
  Pop-Location; exit 1
}
Write-Host "[2/3] ISCC: $iscc" -ForegroundColor Gray

# 3. 컴파일
Write-Host "[3/3] installer.iss 컴파일 (1~2분)..." -ForegroundColor Yellow
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
& $iscc /Q installer.iss
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEAP

Pop-Location

if ($code -ne 0) {
  Write-Host "❌ 빌드 실패 (exit $code)" -ForegroundColor Red
  exit 1
}

$out = "$dir\ChainRemote_Setup.exe"
if (Test-Path $out) {
  $sizeMB = [Math]::Round((Get-Item $out).Length/1MB,1)
  Write-Host "`n=== 완료 ===" -ForegroundColor Green
  Write-Host "  결과물: $out ($sizeMB MB)" -ForegroundColor White
  Write-Host "`n  검증: 다른 윈컴(또는 VM)에서 더블클릭 → 자동 설치 → ChainRemote 자동 실행 → ID 확인" -ForegroundColor Cyan
} else {
  Write-Host "❌ ChainRemote_Setup.exe 생성 안 됨" -ForegroundColor Red
}
