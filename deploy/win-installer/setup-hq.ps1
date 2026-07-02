# 집윈컴: 에이전트 → HQ 전환 (좌석 enforcement 2기기 테스트용).
# 실행법: 집윈컴에서 이 파일을 PowerShell 로 실행 (UAC 자동 요청 → 승인).
#   예) 탐색기에서 우클릭 "PowerShell에서 실행", 또는
#       powershell -ExecutionPolicy Bypass -File C:\src\ChainRemote\deploy\win-installer\setup-hq.ps1
#
# 하는 일: watchdog 예약작업 제거 + 옛 config 제거 + HQ 인스톨러(silent) 실행 + 검증.
# 에이전트 서비스 정지/프로세스 종료/HQ 코어 설치는 인스톨러가 처리한다.

$ErrorActionPreference = 'Continue'

# --- 자동 관리자 승격 (UAC) ---
$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "관리자 권한으로 재실행합니다 — UAC 창이 뜨면 '예' 누르세요..." -ForegroundColor Yellow
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File',"`"$PSCommandPath`"")
    return
}

Write-Host "===== ChainRemote 에이전트 -> HQ 전환 =====" -ForegroundColor Cyan

# [1] watchdog 예약작업 제거 (HQ엔 불필요한 에이전트 잔재. 두면 서비스를 자동으로 다시 살려버린다)
Write-Host "[1] watchdog 예약작업 제거..." -ForegroundColor Yellow
Get-ScheduledTask -ErrorAction SilentlyContinue |
    Where-Object { $_.TaskName -like '*ChainRemote*' -or $_.TaskName -like '*Watchdog*' } |
    ForEach-Object {
        Unregister-ScheduledTask -TaskName $_.TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host ("    제거: " + $_.TaskName)
    }
schtasks /delete /tn ChainRemoteServiceWatchdog /f 2>$null | Out-Null

# [2] 옛 에이전트 config 제거 (HQ 인스톨러가 새 toml/custom 박음)
Write-Host "[2] 옛 에이전트 config 제거..." -ForegroundColor Yellow
@(
    "$env:APPDATA\ChainRemote",
    "C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote",
    "C:\Windows\System32\config\systemprofile\AppData\Roaming\ChainRemote",
    "C:\ProgramData\ChainRemote"
) | ForEach-Object { if (Test-Path $_) { Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue } }

# [3] HQ 인스톨러 실행 (옛 서비스 정지 + HQ 코어 설치 + 서비스 시작은 인스톨러가 처리)
Write-Host "[3] HQ 인스톨러 실행 (silent, ~10초)..." -ForegroundColor Yellow
# 최신 HQ 인스톨러 자동 탐색 — 버전을 하드코딩 안 하니 빌드마다 경로를 고칠 필요 없다.
$installer = Get-ChildItem "C:\src\ChainRemote\deploy\win-installer\ChainRemote_HQ_Setup_v*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $installer -or -not (Test-Path $installer)) {
    Write-Host "  ERROR: HQ 인스톨러 없음 (ChainRemote_HQ_Setup_v*.exe)" -ForegroundColor Red
    Read-Host "엔터로 종료"; return
}
Write-Host ("    사용 인스톨러: " + (Split-Path $installer -Leaf)) -ForegroundColor Gray
Start-Process -FilePath $installer -ArgumentList '/VERYSILENT','/NORESTART','/SUPPRESSMSGBOXES' -Wait
Start-Sleep -Seconds 4

# [4] 검증
Write-Host "[4] 검증..." -ForegroundColor Yellow
$hqExe  = "$env:ProgramFiles\ChainRemote\ChainRemote.exe"
$svc    = Get-Service ChainRemote -ErrorAction SilentlyContinue
$custom = "$env:ProgramFiles\ChainRemote\custom.txt"
$wd     = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like '*ChainRemote*' }
Write-Host ("    HQ exe   : " + $(if (Test-Path $hqExe) { 'OK (' + (Get-Item $hqExe).LastWriteTime + ')' } else { '!! 없음 — 설치 실패' }))
Write-Host ("    서비스    : " + $(if ($svc) { $svc.Status } else { '없음' }))
if (Test-Path $custom) { Write-Host ("    custom.txt: " + ((Get-Content $custom -Raw).Trim()) + "  (outgoing=HQ 여야 정상)") }
Write-Host ("    watchdog : " + $(if ($wd) { '!! 잔존' } else { '없음 OK' }))

Write-Host ""
Write-Host "===== 완료 =====" -ForegroundColor Green
Write-Host "바탕화면 'ChainRemote' 아이콘을 더블클릭 -> 로그인 화면이 떠야 합니다." -ForegroundColor Green
Write-Host "(같은 아이디로 로그인하면 Mac과 좌석 충돌 테스트 가능)" -ForegroundColor Green
Read-Host "엔터로 이 창 닫기"
