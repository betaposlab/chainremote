# Reconnect grace, dropped just before the installer kills the running service.
#
# Installing over a live support session tears that session down - the [Run] steps below stop
# the service and taskkill the process. Without a grace file the shop has to click Accept all
# over again to let the same operator back in, and when the update was kicked off remotely
# there is nobody sitting at that PC to click it.
#
# The agent reads this file in consume_restart_reconnect_grace (src/server/connection.rs).
# The operator id is left blank on purpose: the installer has no idea who was connected, and
# the consume side treats a blank id as a match. Five minutes is the whole window.
#
# Only armed when a session is actually up. An unattended overnight rollout would otherwise
# leave a no-prompt window open behind it - the same hole that was deliberately closed on
# 2026-06-19 when the always-on session grace was removed for violating click-to-accept.
#
# ASCII only, no BOM, PS 2.0 syntax only - PowerShell reads a BOM-less .ps1 as the system
# ANSI codepage, so a single non-ASCII byte breaks the parser on Korean Windows.
#
# Every branch writes to updater.log. A silent no-op here is indistinguishable from a bug.

param(
    [string]$GraceFile = "C:\ProgramData\ChainRemote\restart-grace",
    [int]$Seconds = 300,
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
        $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path $Log -Value ($stamp + " installer: grace " + $msg)
    } catch { }
}

try {
    # A live session always has a CM process next to the service: connection.rs spawns one
    # "--cm" per connection, and "--cm-no-ui" is the banner-only variant that counts the same.
    $cm = @(Get-WmiObject -Class Win32_Process -Filter "Name='ChainRemote.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match "--cm" })
    if ($cm.Count -eq 0) {
        Write-Log "no live session -> not arming"
        exit 0
    }

    $epoch = New-Object System.DateTime(1970, 1, 1, 0, 0, 0, [System.DateTimeKind]::Utc)
    $exp = [int64](([System.DateTime]::UtcNow - $epoch).TotalSeconds) + $Seconds

    $dir = Split-Path $GraceFile
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -Path $dir -ItemType Directory -Force | Out-Null
    }
    # Blank operator id, colon, expiry - the exact shape consume_restart_reconnect_grace parses.
    [System.IO.File]::WriteAllText($GraceFile, (":" + $exp))
    Write-Log ("armed " + $Seconds + "s (exp=" + $exp + ", cm=" + $cm.Count + ")")
} catch {
    Write-Log ("FAILED: " + $_.Exception.Message)
}
exit 0
