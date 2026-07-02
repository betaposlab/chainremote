# ChainRemote / RustDesk 흔적 완전 제거 — fresh install 직전에 한 번 실행.
#
# 사용:
#   관리자 권한 PowerShell 에서:
#   Set-ExecutionPolicy -Scope Process Bypass; .\uninstall-clean.ps1
#
# 제거 대상:
#   - RustDesk 서비스 (stop + delete)
#   - 잔여 rustdesk.exe / ChainRemote.exe 프로세스
#   - HKLM Run 자동시작 entry (RustDesk + ChainRemote 둘 다)
#   - C:\Program Files\RustDesk\
#   - C:\ProgramData\ChainRemote\ (pending, updater.log 포함)
#   - %APPDATA%\RustDesk\ (현재 사용자)
#   - C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\
#   - 시작 메뉴 / 바탕화면 단축아이콘 (RustDesk / ChainRemote 모두)
#   - 프로그램 추가/제거 reg key
#
# 안 건드리는 것: 다른 사용자 프로필의 %APPDATA%\RustDesk (있어도 무해하고 새 설치 후 자동 정리됨)

$ErrorActionPreference = 'Continue'

function Step($msg) { Write-Host "[uninstall-clean] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK $msg" -ForegroundColor Green }
function Skip($msg) { Write-Host "  -- $msg (없음)" -ForegroundColor DarkGray }

# 0. 관리자 확인
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: 관리자 권한 PowerShell 에서 실행해야 합니다." -ForegroundColor Red
    exit 1
}

# 1. 서비스 정지
Step "서비스 정지"
$svc = Get-Service RustDesk -ErrorAction SilentlyContinue
if ($svc) {
    Stop-Service RustDesk -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 30; $i++) {
        $svc = Get-Service RustDesk -ErrorAction SilentlyContinue
        if ($null -eq $svc -or $svc.Status -eq 'Stopped') { break }
        Start-Sleep -Seconds 1
    }
    Ok "RustDesk 서비스 정지"
} else {
    Skip "RustDesk 서비스"
}

# 2. 서비스 삭제
Step "서비스 삭제"
sc.exe delete RustDesk *>$null
if ($LASTEXITCODE -eq 0) { Ok "sc delete RustDesk" } else { Skip "sc delete (이미 없음)" }

# 3. 잔여 프로세스 강제 종료
Step "잔여 프로세스 종료"
taskkill /F /IM rustdesk.exe /T *>$null
taskkill /F /IM ChainRemote.exe /T *>$null
Ok "rustdesk.exe / ChainRemote.exe taskkill"

# 4. HKLM Run reg
Step "자동시작 reg 제거"
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v RustDesk /f *>$null
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v ChainRemote /f *>$null
Ok "HKLM Run RustDesk / ChainRemote"

# 5. 프로그램 추가/제거 등록 (Inno Setup AppId)
Step "프로그램 추가/제거 reg 제거"
$uninstallKeys = @(
    "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8B6F7E2A-1D4C-4A3F-9E5B-3F2C1D7E8B4A}_is1",
    "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\RustDesk",
    "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\RustDesk"
)
foreach ($k in $uninstallKeys) {
    reg delete $k /f *>$null
}
Ok "Uninstall reg keys"

# 6. 단축아이콘 (Public Desktop / 현재 사용자 Desktop / 시작 메뉴)
Step "단축아이콘 제거"
$shortcuts = @(
    "$env:PUBLIC\Desktop\RustDesk.lnk",
    "$env:PUBLIC\Desktop\ChainRemote.lnk",
    "$env:USERPROFILE\Desktop\RustDesk.lnk",
    "$env:USERPROFILE\Desktop\ChainRemote.lnk"
)
foreach ($s in $shortcuts) {
    if (Test-Path $s) { Remove-Item $s -Force -ErrorAction SilentlyContinue }
}
$startMenuFolders = @(
    "$env:PROGRAMDATA\Microsoft\Windows\Start Menu\Programs\RustDesk",
    "$env:PROGRAMDATA\Microsoft\Windows\Start Menu\Programs\ChainRemote"
)
foreach ($f in $startMenuFolders) {
    if (Test-Path $f) { Remove-Item $f -Recurse -Force -ErrorAction SilentlyContinue }
}
Ok "단축아이콘 + 시작 메뉴 폴더"

# 7. Program Files 폴더
Step "Program Files\RustDesk 폴더 제거"
$pf = "$env:ProgramFiles\RustDesk"
if (Test-Path $pf) {
    # 파일 lock 대비 — 한 번 더 잔여 프로세스 종료 후 삭제
    taskkill /F /IM rustdesk.exe /T *>$null
    Start-Sleep -Seconds 1
    Remove-Item $pf -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $pf) {
        Write-Host "  ! $pf 일부 파일이 lock 되어 다음 부팅 시 삭제 예약" -ForegroundColor Yellow
    } else {
        Ok "$pf 제거"
    }
} else {
    Skip "$pf"
}

# 8. ProgramData\ChainRemote
Step "ProgramData\ChainRemote 폴더 제거"
$pd = "$env:ProgramData\ChainRemote"
if (Test-Path $pd) {
    Remove-Item $pd -Recurse -Force -ErrorAction SilentlyContinue
    Ok "$pd"
} else {
    Skip "$pd"
}

# 9. 현재 사용자 %APPDATA%\RustDesk
Step "사용자 RustDesk config 제거"
$ua = "$env:APPDATA\RustDesk"
if (Test-Path $ua) {
    Remove-Item $ua -Recurse -Force -ErrorAction SilentlyContinue
    Ok "$ua"
} else {
    Skip "$ua"
}

# 10. LocalService RustDesk config
Step "LocalService RustDesk config 제거"
$ls = "C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk"
if (Test-Path $ls) {
    Remove-Item $ls -Recurse -Force -ErrorAction SilentlyContinue
    Ok "$ls"
} else {
    Skip "$ls"
}

# 11. 방화벽 규칙
Step "방화벽 규칙 제거"
netsh advfirewall firewall delete rule name="RustDesk Service" *>$null
netsh advfirewall firewall delete rule name="ChainRemote Service" *>$null
Ok "방화벽 규칙"

Write-Host ""
Write-Host "[uninstall-clean] 완료. 이제 ChainRemote_Setup_v1.2.4.exe 더블클릭으로 fresh 설치 가능." -ForegroundColor Green
Write-Host ""
