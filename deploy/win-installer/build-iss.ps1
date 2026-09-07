param(
  [ValidateSet("agent","hq","both")]
  [string]$Target = "agent"
)

$ErrorActionPreference = "Stop"
Write-Host "=== ChainRemote 인스톨러 빌드 (Inno Setup) — Target: $Target ===" -ForegroundColor Cyan

$dir = $PSScriptRoot
if (-not $dir) { $dir = (Get-Location).Path }
Push-Location $dir

# 거래처(agent) / 본사(hq) 분기 빌드 선택
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

# 2.5. Inno Setup 버전 가드 (2026-09-07, 향우정 Win7 설치불가 사고).
#   Inno Setup 6.4.0 부터 생성된 Setup/Uninstall 이 Windows 10+ 를 요구한다. 그 도구로
#   빌드하면 Win7 POS 에서 실행 시 "이 프로그램은 이 Windows 버전을 지원하지 않습니다" 로
#   설치가 막힌다 (거래처의 상당수가 Win7 32비트라 조용히 대량 사고가 된다).
#   윈컴 Inno 가 자동 업데이트로 6.4+ 가 되면 아무 경고 없이 Win7 미지원 설치본이 나가므로,
#   빌드 전에 도구 버전을 검사해 6.4+ 면 기본 중단한다. 의도적으로 Win10 전용을 낼 때만
#   $env:ALLOW_WIN10_ONLY=1 로 넘어간다.
$isccVerRaw = ""
try { $isccVerRaw = (Get-Item $iscc).VersionInfo.ProductVersion } catch { }
if (-not $isccVerRaw) { try { $isccVerRaw = (Get-Item $iscc).VersionInfo.FileVersion } catch { } }
if ($isccVerRaw -match '(\d+)\.(\d+)') {
  $isccMj = [int]$Matches[1]; $isccMn = [int]$Matches[2]
  $win7ok = -not (($isccMj -gt 6) -or ($isccMj -eq 6 -and $isccMn -ge 4))
  if ($win7ok) {
    Write-Host "      Inno $isccVerRaw — Win7 지원 OK" -ForegroundColor Gray
  } elseif ($env:ALLOW_WIN10_ONLY -eq "1") {
    Write-Host "      Inno $isccVerRaw — Win7 미지원(6.4+)이지만 ALLOW_WIN10_ONLY=1 로 강행" -ForegroundColor Yellow
  } else {
    Write-Host "❌ Inno Setup $isccVerRaw 은 Win7 미지원 설치본을 만듭니다 (6.4.0+ 는 Win10 전용)." -ForegroundColor Red
    Write-Host "   거래처 상당수가 Win7 32비트라 이대로 빌드하면 그들은 설치가 막힙니다." -ForegroundColor Red
    Write-Host "   → Inno Setup 6.3.x 로 되돌린 뒤 다시 빌드하세요 (jrsoftware.org 구버전)." -ForegroundColor Yellow
    Write-Host "   → Win10 전용을 의도한 것이면: `$env:ALLOW_WIN10_ONLY='1' 후 재실행." -ForegroundColor Yellow
    Pop-Location; exit 1
  }
} else {
  Write-Host "      Inno 버전 확인 실패(형식='$isccVerRaw') — 검사 건너뜀. Win7 설치는 실기기 확인 필요." -ForegroundColor Yellow
}

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
