# Removes what the Inno uninstaller cannot see, run from [UninstallRun].
#
# The program files are XCOPY'd into place by the core's --silent-install, not by Inno,
# so Inno has no record of them and would leave a fully working install behind. Same for
# the service, the desktop shortcuts and the watchdog task.
#
# Lives in ProgramData, not {tmp}: {tmp} is gone by uninstall time.
#
# ASCII only, no BOM, PS 2.0 syntax - PowerShell reads a BOM-less .ps1 as the system ANSI
# codepage, so one non-ASCII byte breaks the parser on Korean Windows.
#
# Ordering and bounded waits matter here:
#   * The watchdog task is deleted FIRST. It exists to recreate a service someone deleted
#     (watchdog.ps1), so leaving it armed during an uninstall means it can undo the removal.
#   * The service stop is polled with a deadline instead of Stop-Service, which blocks with
#     no timeout. A service busy with a live remote session can sit in STOP_PENDING, and the
#     [UninstallRun] entry is waituntilterminated - a hang there strands every later step.
#   * Every step writes its outcome. The previous inline version wrote nothing at all, so a
#     failed uninstall left no trace and had to be guessed at.

param(
    [string]$AppDir = "",
    [string]$Log = ""
)

$ErrorActionPreference = "Continue"

function Write-Log([string]$msg) {
    if (-not $Log) { return }
    try {
        $dir = Split-Path $Log
        if ($dir -and -not (Test-Path $dir)) {
            New-Item -Path $dir -ItemType Directory -Force | Out-Null
        }
        Add-Content -Path $Log -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " uninstall: " + $msg)
    } catch { }
}

function Get-Svc {
    return (Get-Service ChainRemote -ErrorAction SilentlyContinue)
}

Write-Log ("start appdir=" + $AppDir)

# 1) Disarm the watchdog before touching the service.
& schtasks.exe /Delete /TN ChainRemoteServiceWatchdog /F 2>&1 | Out-Null
Write-Log ("watchdog task deleted (exit=" + $LASTEXITCODE + ")")

# 2) Stop the service, bounded. sc.exe returns immediately; we poll the status ourselves.
$svc = Get-Svc
if ($null -eq $svc) {
    Write-Log "service not present"
} else {
    & sc.exe stop ChainRemote 2>&1 | Out-Null
    $stopped = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 1
        $svc = Get-Svc
        if ($null -eq $svc -or $svc.Status -eq "Stopped") { $stopped = $true; break }
    }
    Write-Log ("service stop -> " + $(if ($stopped) { "Stopped" } else { "STILL RUNNING after 30s" }))
}

# 3) Delete the service registration. On a service that refused to stop this only marks it
#    for deletion, so we kill the processes next and re-check.
& sc.exe delete ChainRemote 2>&1 | Out-Null
Write-Log ("sc delete (exit=" + $LASTEXITCODE + ")")

# 4) Kill every ChainRemote process, including the LocalSystem service host and the tray.
& taskkill.exe /F /IM ChainRemote.exe /T 2>&1 | Out-Null
Write-Log ("taskkill (exit=" + $LASTEXITCODE + ")")
for ($i = 0; $i -lt 15; $i++) {
    if (-not @(Get-Process ChainRemote -ErrorAction SilentlyContinue).Count) { break }
    Start-Sleep -Seconds 1
}
$left = @(Get-Process ChainRemote -ErrorAction SilentlyContinue).Count
Write-Log ("processes left=" + $left + " service present=" + $(if (Get-Svc) { "yes" } else { "no" }))

# 5) Program folder. Retry briefly - handles are released a moment after the kill.
if ($AppDir -and (Test-Path $AppDir)) {
    for ($i = 0; $i -lt 5; $i++) {
        Remove-Item -LiteralPath $AppDir -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $AppDir)) { break }
        Start-Sleep -Seconds 2
    }
    if (Test-Path $AppDir) {
        $n = @(Get-ChildItem -LiteralPath $AppDir -Recurse -Force -ErrorAction SilentlyContinue).Count
        Write-Log ("app dir NOT removed, " + $n + " item(s) left -> " + $AppDir)
    } else {
        Write-Log "app dir removed"
    }
} else {
    Write-Log "app dir already gone"
}

# 6) Desktop shortcuts, matched by the exe they point at so a renamed icon is caught too.
#    Scanning C:\Users\*\Desktop covers the common desktop (C:\Users\Public\Desktop) as well.
$exe = Join-Path $AppDir "ChainRemote.exe"
$removed = 0
$wsh = New-Object -ComObject WScript.Shell
foreach ($lnk in @(Get-ChildItem "C:\Users\*\Desktop\*.lnk" -ErrorAction SilentlyContinue)) {
    $target = ""
    try { $target = [string]$wsh.CreateShortcut($lnk.FullName).TargetPath } catch { }
    if ($target -and $target.Trim() -eq $exe.Trim()) {
        Remove-Item -LiteralPath $lnk.FullName -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path $lnk.FullName)) { $removed = $removed + 1 }
    }
}
Write-Log ("desktop shortcuts removed=" + $removed)

# 7) Start menu folder (created by the core, so Inno does not know about it either).
$startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\ChainRemote"
if (Test-Path $startMenu) {
    Remove-Item -LiteralPath $startMenu -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log ("start menu removed=" + (-not (Test-Path $startMenu)))
} else {
    Write-Log "start menu already gone"
}

# 8) Config directories. Chang decided on 2026-08-16 that uninstall means uninstall:
#    the device ID and heartbeat token live here, so leaving them behind makes a
#    "clean reinstall" silently inherit the old identity - the machine comes back as the
#    same customer row with the same remote ID. Removing them means a reinstall enrolls
#    as a genuinely new device, which is what an operator expects after a full removal.
#
#    Every user profile is swept, not just the one running the uninstaller: the agent runs
#    in the logged-in POS user's session while the uninstall is typically launched by an
#    admin, so $env:APPDATA points at the wrong profile.
$cfgRemoved = 0
$cfgLeft = 0
$cfgDirs = New-Object System.Collections.ArrayList
foreach ($d in @(Get-ChildItem "C:\Users\*\AppData\Roaming\ChainRemote" -ErrorAction SilentlyContinue)) {
    $null = $cfgDirs.Add($d.FullName)
}
# Service-side config. The service runs as LocalService; older builds wrote under
# NetworkService, so both are swept.
foreach ($svcCfg in @(
    "C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote",
    "C:\Windows\ServiceProfiles\NetworkService\AppData\Roaming\ChainRemote"
)) {
    if (Test-Path $svcCfg) { $null = $cfgDirs.Add($svcCfg) }
}
foreach ($cfg in $cfgDirs) {
    Remove-Item -LiteralPath $cfg -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $cfg) { $cfgLeft = $cfgLeft + 1 } else { $cfgRemoved = $cfgRemoved + 1 }
}
Write-Log ("config dirs removed=" + $cfgRemoved + " left=" + $cfgLeft)

# 9) Customer name registry value - the same cleanup the installer does from [UninstallRun],
#    repeated here so a manual run of this script is enough on its own.
& reg.exe delete "HKLM\SOFTWARE\ChainRemote" /v CustomerName /f /reg:64 2>&1 | Out-Null
& reg.exe delete "HKLM\SOFTWARE\ChainRemote" /v CustomerName /f /reg:32 2>&1 | Out-Null
Write-Log "customer name registry cleared"

Write-Log "done"
exit 0
