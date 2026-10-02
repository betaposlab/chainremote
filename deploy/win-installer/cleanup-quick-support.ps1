# Remove the temporary-remote files WE issued, run once per agent install.
#
# 626.kr's green "remote support" button hands out the official RustDesk exe under a file
# name that carries our server settings (and, since 2026-10-01, a one-time token). Every
# press downloads a new copy - a new token means a new name - so a few tries leave a stack
# of 11-24 MB files in Downloads (2026-10-02, test PC: five copies).
#
# Once our agent is installed those files have no further use. We delete ONLY files whose
# name proves we issued them:
#   rustdesk-licensed-<X>.exe   X = reversed base64url of JSON that starts with our host,
#                               key and report URL - so every X we issue ends with the same
#                               fixed tail (QS_TAIL). Computed from the panel's code, see
#                               chainremote-admin/lib/quick-support.ts.
#   rustdesk-host=rs.626.kr,key=<our key>,*.exe   the older format from the same button.
# A RustDesk the shop uses for its own purposes never matches either pattern.
#
# The file that is running right now (the session the installer is being run through) is
# locked. It is scheduled for deletion at next reboot instead - never killed.
#
# ASCII only, no BOM, PS 2.0 syntax only (Windows 7): a non-ASCII byte in a BOM-less .ps1
# breaks the parser on Korean Windows. Every branch writes to updater.log.

param([string]$Log = "")

$ErrorActionPreference = "Continue"

function L([string]$m) {
    if ($Log) {
        $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " quick-support-cleanup: " + $m
        try { Add-Content -LiteralPath $Log -Value $line -Encoding ASCII } catch { }
    }
}

$QS_TAIL = "vMXcvkGch9icr5iNyYzLvozcwRHdoJiOikGchJCLi0TW4MUMylTMw0mZLx0UiZnUnljN3tWejpHat9GdtdWUFBjYOBzRxVWciJzQiojI5V2aiwiIytmL2IjNuMnciojI0N3boJye"
$OLD_PREFIX = "rustdesk-host=rs.626.kr,key=C2bqeqG0Nb0EQgmtomhzcykw69gRvbSLKfm019r1C8Y="

try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CrMoveLater {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool MoveFileEx(string existing, string replacement, int flags);
}
"@ -ErrorAction Stop
    $canDefer = $true
} catch {
    $canDefer = $false
}

function Is-Ours([string]$name) {
    $lower = $name.ToLower()
    if (-not $lower.EndsWith(".exe")) { return $false }
    $stem = $name.Substring(0, $name.Length - 4)
    # Windows appends " (1)", " (2)" on repeat downloads.
    $stem = [regex]::Replace($stem, ' \(\d+\)$', '')
    if ($stem.StartsWith("rustdesk-licensed-") -and $stem.EndsWith($QS_TAIL)) { return $true }
    if ($name.StartsWith($OLD_PREFIX)) { return $true }
    return $false
}

$found = 0; $deleted = 0; $deferred = 0; $failed = 0
foreach ($dir in @(Get-ChildItem "C:\Users\*\Downloads" -ErrorAction SilentlyContinue)) {
    if (-not $dir.PSIsContainer) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $dir.FullName -Filter "rustdesk-*.exe" -ErrorAction SilentlyContinue)) {
        if (-not (Is-Ours $f.Name)) { continue }
        $found = $found + 1
        try {
            Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop
            $deleted = $deleted + 1
        } catch {
            # Most likely the copy running the remote session right now.
            if ($canDefer -and [CrMoveLater]::MoveFileEx($f.FullName, $null, 4)) {
                $deferred = $deferred + 1
                L ("in use, delete at next reboot: " + $f.FullName)
            } else {
                $failed = $failed + 1
                L ("could not delete: " + $f.FullName + " (" + $_.Exception.Message + ")")
            }
        }
    }
}
L ("found=" + $found + " deleted=" + $deleted + " deferred=" + $deferred + " failed=" + $failed)
exit 0
