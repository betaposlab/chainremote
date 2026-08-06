# Desktop shortcut housekeeping, run once per install by agent-installer.iss.
#
# Field practice: shops rename the desktop icon to Korean ("POS remote") for owners who
# cannot read the English name. The core installer only knows its shortcut by file name,
# so every update recreated the default one and duplicates piled up. We match on the exe
# a shortcut points at instead of its name: if a renamed shortcut exists, the default one
# is redundant and gets removed, leaving the shop's name as the only icon.
#
# ASCII only, no BOM, PS 2.0 syntax only - PowerShell reads a BOM-less .ps1 as the system
# ANSI codepage, so a single non-ASCII byte breaks the parser on Korean Windows.
#
# Every branch writes to updater.log. The previous inline version logged only on success,
# so when it silently did nothing there was no trace to work from.

param(
    [string]$CommonDesktop = "",
    [string]$UserDesktop = "",
    [string]$StartMenuLnk = "",
    [string]$AppExe = "",
    [string]$IconFile = "",
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
        Add-Content -Path $Log -Value ($stamp + " installer: icon " + $msg)
    } catch { }
}

try {
    if (-not $AppExe) { Write-Log "no app path passed -> skip"; exit 0 }

    $wsh = New-Object -ComObject WScript.Shell

    # Inno hands us the resolved desktop paths. The old version expanded %PUBLIC% inside
    # PowerShell, which yields the literal string back when the variable is missing from
    # the process environment - the gate then failed open and the step did nothing at all.
    # C:\Users\*\Desktop is kept as a backstop: an update runs as LocalSystem, where
    # %USERPROFILE% points at systemprofile rather than the logged-on user.
    $patterns = @()
    if ($CommonDesktop) { $patterns += (Join-Path $CommonDesktop "*.lnk") }
    if ($UserDesktop) { $patterns += (Join-Path $UserDesktop "*.lnk") }
    $patterns += "C:\Users\*\Desktop\*.lnk"

    $seen = @()
    foreach ($pattern in $patterns) {
        foreach ($file in @(Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue)) {
            if ($seen -notcontains $file.FullName) { $seen += $file.FullName }
        }
    }

    $wanted = $AppExe.Trim()
    $defaults = @()
    $renamed = @()
    foreach ($full in $seen) {
        $target = ""
        try { $target = [string]$wsh.CreateShortcut($full).TargetPath } catch { }
        if (-not $target) { continue }
        if ($target.Trim() -ne $wanted) { continue }   # -ne on strings is case-insensitive
        if ([System.IO.Path]::GetFileName($full) -eq "ChainRemote.lnk") {
            $defaults += $full
        } else {
            $renamed += $full
        }
    }
    Write-Log ("scan " + $seen.Count + " lnk, ours=" + ($defaults.Count + $renamed.Count) +
               " (default=" + $defaults.Count + " renamed=" + $renamed.Count + ") exe=" + $wanted)

    if ($renamed.Count -gt 0) {
        # The shop named it themselves - that name wins and the English duplicate goes.
        # We deliberately leave the renamed shortcut's icon alone: if they picked their
        # own icon too, overwriting it would undo a second deliberate choice.
        foreach ($dup in $defaults) {
            Remove-Item -LiteralPath $dup -Force -ErrorAction SilentlyContinue
        }
        Write-Log ("kept [" + [System.IO.Path]::GetFileName($renamed[0]) + "] -> removed " +
                   $defaults.Count + " default lnk")
        exit 0
    }

    # Nobody renamed anything, so refresh the default shortcut's icon. This is what step 8
    # of the .iss was meant to do; it referenced $env:PUBLIC inside single quotes and fed
    # that to ExpandEnvironmentVariables, which only understands %VAR%, so it never once
    # matched a path. Harmless in practice (the core sets the icon at creation time) but
    # dead code, and it belongs with the scan we are already doing here.
    if ($IconFile -and (Test-Path $IconFile)) {
        $touched = 0
        $iconTargets = @()
        $iconTargets += $defaults
        if ($StartMenuLnk -and (Test-Path $StartMenuLnk)) { $iconTargets += $StartMenuLnk }
        foreach ($lnk in $iconTargets) {
            try {
                $shortcut = $wsh.CreateShortcut($lnk)
                $shortcut.IconLocation = $IconFile
                $shortcut.Save()
                $touched = $touched + 1
            } catch { }
        }
        Write-Log ("no renamed lnk -> refreshed icon on " + $touched + " lnk")
    } else {
        Write-Log "no renamed lnk, no icon file -> nothing to do"
    }
    exit 0
} catch {
    # Never fail the install over a shortcut. Worst case the default lnk stays, which is
    # exactly how things behaved before any of this existed.
    Write-Log ("ERROR " + $_.Exception.Message)
    exit 0
}
