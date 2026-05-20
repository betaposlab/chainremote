param(
  [ValidateSet("agent","hq","both")]
  [string]$Target = "agent"
)

$ErrorActionPreference = "Stop"
Write-Host "=== ChainRemote 인스톨러 빌드 (Inno Setup) — Target: $Target ===" -ForegroundColor Cyan

$dir = $PSScriptRoot
if (-not $dir) { $dir = (Get-Location).Path }
Push-Location $dir

# Phase 1: 거래처(agent) / 본사(hq) 분기 빌드 선택
$targets = switch ($Target) {
  "agent" { @("agent-installer.iss") }
  "hq"    { @("hq-installer.iss") }
  "both"  { @("agent-installer.iss","hq-installer.iss") }
}

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

# 3. 컴파일 (target 별로 순차 실행)
$failed = @()
foreach ($iss in $targets) {
  Write-Host "[3/3] $iss 컴파일 (1~2분)..." -ForegroundColor Yellow
  $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  & $iscc /Q $iss
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEAP
  if ($code -ne 0) {
    Write-Host "❌ $iss 빌드 실패 (exit $code)" -ForegroundColor Red
    $failed += $iss
  }
}

Pop-Location

if ($failed.Count -gt 0) {
  Write-Host ("`n실패: " + ($failed -join ", ")) -ForegroundColor Red
  exit 1
}

# 결과물 패턴: ChainRemote_Agent_Setup_v*.exe / ChainRemote_HQ_Setup_v*.exe
$outs = Get-ChildItem -Path $dir -Filter "ChainRemote_*_Setup_v*.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First $targets.Count
if ($outs) {
  Write-Host "`n=== 완료 ===" -ForegroundColor Green
  foreach ($out in $outs) {
    $sizeMB = [Math]::Round($out.Length/1MB,1)
    Write-Host "  결과물: $($out.FullName) ($sizeMB MB)" -ForegroundColor White
  }
  Write-Host "`n  검증: 다른 윈컴(또는 VM)에서 더블클릭 → 자동 설치 → ChainRemote 자동 실행" -ForegroundColor Cyan
} else {
  Write-Host "❌ ChainRemote_*_Setup_v*.exe 생성 안 됨" -ForegroundColor Red
}
