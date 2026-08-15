# ChainRemote / RustDesk traces - full wipe. Run once before a fresh install.
#
# Usage (elevated PowerShell):
#   Set-ExecutionPolicy -Scope Process Bypass; .\uninstall-clean.ps1
#
# 2026-08-16 rewrite. The previous version was wrong in two ways at once and would have
# invalidated the "clean install" premise of any test that leaned on it:
#   1. It used `*>$null` (PowerShell 3+) in nine places. Windows 7 ships PowerShell 2.0,
#      where that is a parse error - the whole script dies before its first statement, so
#      it silently did nothing at all on exactly the machines it was written for.
#   2. Even on PowerShell 5 it only knew the old RustDesk names. The service is called
#      ChainRemote, the program lives in Program Files\ChainRemote, the config sits under
#      %APPDATA%\ChainRemote, and there is a watchdog scheduled task that recreates the
#      service - none of which it touched. It reported success while leaving a working
#      install (and the device identity) in place.
#
# ASCII only, no BOM, PS 2.0 syntax - PowerShell reads a BOM-less .ps1 as the system ANSI
# codepage, so one non-ASCII byte breaks the parser on Korean Windows.
#
# Order matters: the watchdog task is disarmed first, because it exists to bring the
# service back after someone deletes it.

$ErrorActionPreference = 'Continue'

function Step($msg) { Write-Host ("[clean] " + $msg) -ForegroundColor Cyan }
function Ok($msg)   { Write-Host ("  ok   " + $msg) -ForegroundColor Green }
function Skip($msg) { Write-Host ("  --   " + $msg + " (none)") -ForegroundColor DarkGray }
function Warn($msg) { Write-Host ("  !    " + $msg) -ForegroundColor Yellow }

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: run this from an elevated PowerShell." -ForegroundColor Red
    exit 1
}

# Both generations of names. ChainRemote is what ships today; RustDesk is the pre-rebrand
# leftover that can still be sitting on a machine from 2026-05 or earlier.
$svcNames  = @('ChainRemote', 'RustDesk')
$procNames = @('ChainRemote', 'rustdesk')
$taskNames = @('ChainRemoteServiceWatchdog')

# 1) Disarm the watchdog first - it recreates the service.
Step "watchdog scheduled task"
foreach ($t in $taskNames) {
    & schtasks.exe /Delete /TN $t /F 2>&1 | Out-Null
}
Ok "watchdog task deleted (if present)"

# 2) Stop services, bounded. Stop-Service has no timeout and a service holding a live
#    remote session can sit in STOP_PENDING forever.
Step "services"
foreach ($n in $svcNames) {
    $svc = Get-Service $n -ErrorAction SilentlyContinue
    if (-not $svc) { Skip ("service " + $n); continue }
    & sc.exe stop $n 2>&1 | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        $svc = Get-Service $n -ErrorAction SilentlyContinue
        if ($null -eq $svc -or $svc.Status -eq 'Stopped') { break }
        Start-Sleep -Seconds 1
    }
    & sc.exe delete $n 2>&1 | Out-Null
    if (Get-Service $n -ErrorAction SilentlyContinue) { Warn ("service " + $n + " still registered") }
    else { Ok ("service " + $n + " stopped and deleted") }
}

# 3) Leftover processes.
Step "processes"
foreach ($p in $procNames) {
    & taskkill.exe /F /IM ($p + ".exe") /T 2>&1 | Out-Null
}
Ok "processes killed (if any)"

# 4) Autostart registry values.
Step "autostart registry"
foreach ($v in @('ChainRemote', 'RustDesk')) {
    & reg.exe delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v $v /f 2>&1 | Out-Null
}
Ok "HKLM Run values"

# 5) Add/Remove Programs entries (Inno AppId + the hidden core entry).
Step "add/remove programs registry"
$uninstallKeys = @(
    "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8B6F7E2A-1D4C-4A3F-9E5B-3F2C1D7E8B4A}_is1",
    "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{8B6F7E2A-1D4C-4A3F-9E5B-3F2C1D7E8B4A}_is1",
    "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\ChainRemote",
    "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\ChainRemote",
    "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\RustDesk",
    "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\RustDesk"
)
foreach ($k in $uninstallKeys) { & reg.exe delete $k /f 2>&1 | Out-Null }
Ok "uninstall keys"

# 6) Customer name - a reused machine must not come back under its old shop name.
Step "customer name registry"
& reg.exe delete "HKLM\SOFTWARE\ChainRemote" /v CustomerName /f /reg:64 2>&1 | Out-Null
& reg.exe delete "HKLM\SOFTWARE\ChainRemote" /v CustomerName /f /reg:32 2>&1 | Out-Null
Ok "HKLM\SOFTWARE\ChainRemote CustomerName"

# 7) Shortcuts (every profile, not just the one running this) and start menu folders.
Step "shortcuts"
$removed = 0
foreach ($pattern in @(
    "C:\Users\*\Desktop\ChainRemote.lnk",
    "C:\Users\*\Desktop\RustDesk.lnk",
    "$env:PUBLIC\Desktop\ChainRemote.lnk",
    "$env:PUBLIC\Desktop\RustDesk.lnk"
)) {
    foreach ($f in @(Get-ChildItem $pattern -ErrorAction SilentlyContinue)) {
        Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $f.FullName)) { $removed = $removed + 1 }
    }
}
# A renamed desktop icon is a supported thing for customers to do ("POS remote"), so match
# on the shortcut target as well, not just the file name.
$wsh = New-Object -ComObject WScript.Shell
foreach ($lnk in @(Get-ChildItem "C:\Users\*\Desktop\*.lnk" -ErrorAction SilentlyContinue)) {
    $target = ""
    try { $target = [string]$wsh.CreateShortcut($lnk.FullName).TargetPath } catch { }
    if ($target -and ($target -match 'ChainRemote\.exe$' -or $target -match 'rustdesk\.exe$')) {
        Remove-Item -LiteralPath $lnk.FullName -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $lnk.FullName)) { $removed = $removed + 1 }
    }
}
foreach ($f in @(
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\RustDesk"
)) {
    if (Test-Path $f) { Remove-Item -LiteralPath $f -Recurse -Force -ErrorAction SilentlyContinue }
}
Ok ("shortcuts removed=" + $removed + ", start menu folders cleared")

# 8) Program folders. Both Program Files views, both generations of names.
Step "program folders"
$progDirs = @(
    (Join-Path $env:ProgramFiles "ChainRemote"),
    (Join-Path $env:ProgramFiles "RustDesk")
)
$pf86 = ${env:ProgramFiles(x86)}
if ($pf86) {
    $progDirs = $progDirs + (Join-Path $pf86 "ChainRemote") + (Join-Path $pf86 "RustDesk")
}
foreach ($d in $progDirs) {
    if (-not (Test-Path $d)) { Skip $d; continue }
    Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $d) { Warn ($d + " partially locked - reboot and rerun") } else { Ok $d }
}

# 9) Config and state. This is what makes a reinstall a genuinely new device: the remote
#    ID and the heartbeat token live here. Every profile plus the service accounts.
Step "config and state"
$stateDirs = New-Object System.Collections.ArrayList
foreach ($pattern in @(
    "C:\Users\*\AppData\Roaming\ChainRemote",
    "C:\Users\*\AppData\Roaming\RustDesk"
)) {
    foreach ($d in @(Get-ChildItem $pattern -ErrorAction SilentlyContinue)) {
        $null = $stateDirs.Add($d.FullName)
    }
}
foreach ($d in @(
    "C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote",
    "C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk",
    "C:\Windows\ServiceProfiles\NetworkService\AppData\Roaming\ChainRemote",
    "$env:ProgramData\ChainRemote"
)) {
    if (Test-Path $d) { $null = $stateDirs.Add($d) }
}
$stateOk = 0
foreach ($d in $stateDirs) {
    Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $d) { Warn ($d + " left behind") } else { $stateOk = $stateOk + 1 }
}
Ok ("state dirs removed=" + $stateOk + " of " + $stateDirs.Count)

# 10) Firewall rules.
Step "firewall rules"
foreach ($r in @('ChainRemote Service', 'RustDesk Service', 'ChainRemote', 'RustDesk')) {
    & netsh.exe advfirewall firewall delete rule name="$r" 2>&1 | Out-Null
}
Ok "firewall rules"

# Verify rather than claim. A wipe that reports success while the service is still
# registered is worse than one that fails loudly.
Write-Host ""
Step "verification"
$leftovers = New-Object System.Collections.ArrayList
foreach ($n in $svcNames) {
    if (Get-Service $n -ErrorAction SilentlyContinue) { $null = $leftovers.Add("service " + $n) }
}
foreach ($p in $procNames) {
    if (Get-Process $p -ErrorAction SilentlyContinue) { $null = $leftovers.Add("process " + $p) }
}
foreach ($d in $progDirs) {
    if (Test-Path $d) { $null = $leftovers.Add($d) }
}
foreach ($d in @("$env:ProgramData\ChainRemote")) {
    if (Test-Path $d) { $null = $leftovers.Add($d) }
}
$taskList = & schtasks.exe /Query /TN ChainRemoteServiceWatchdog 2>&1
if ($LASTEXITCODE -eq 0) { $null = $leftovers.Add("task ChainRemoteServiceWatchdog") }

if ($leftovers.Count -eq 0) {
    Write-Host "[clean] done - nothing left behind. Ready for a fresh install." -ForegroundColor Green
    exit 0
} else {
    Write-Host "[clean] NOT fully clean. Still present:" -ForegroundColor Red
    foreach ($l in $leftovers) { Write-Host ("  - " + $l) -ForegroundColor Red }
    Write-Host "Reboot and run this again before installing." -ForegroundColor Yellow
    exit 1
}
