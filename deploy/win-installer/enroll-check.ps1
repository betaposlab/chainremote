# Ask the panel whether a customer with this name already exists, before the wizard commits the name.
#
# Why (2026-09-30): the server no longer merges a new device into an existing customer just because
# the names match and the old device is quiet. That decision belongs to the person installing.
# This script gives the wizard what it needs to ask: does the name exist, is that device alive,
# when was it last seen. The wizard shows the question; the answer goes to the registry
# (EnrollAnswer) and the agent sends it with enroll.
#
# Reads tenant-slug/enroll-key from the overlay at the end of the setup exe (same layout as
# extract-enroll-overlay.ps1). Writes one line per field to -Out so the wizard (Pascal) can read it.
#
# Exit codes: 0 = no match, 1 = match found, 2 = could not check (no overlay / no network / server error).
# ASCII only, no BOM, PS 2.0 syntax - Korean Windows reads a BOM-less .ps1 as CP949.

param(
    [Parameter(Mandatory=$true)][string]$Setup,
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$Out,
    [string]$Url = "https://api.626.kr/api/customers/enroll-check",
    [string]$Log = ""
)
$ErrorActionPreference = "Continue"
function Write-Log([string]$msg) {
    if (-not $Log) { return }
    try {
        $dir = Split-Path $Log
        if ($dir -and -not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
        Add-Content -Path $Log -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " installer: enroll-check " + $msg)
    } catch { }
}
function Finish([int]$code, [string[]]$lines) {
    try { [System.IO.File]::WriteAllLines($Out, $lines, (New-Object System.Text.UTF8Encoding($false))) } catch { }
    exit $code
}

$slug = ""; $key = ""
$fs = $null
try {
    $fs = [System.IO.File]::OpenRead($Setup)
    $total = $fs.Length
    if ($total -gt 12) {
        $fs.Position = $total - 8
        $magic = New-Object byte[] 8
        [void]$fs.Read($magic, 0, 8)
        if ([System.Text.Encoding]::ASCII.GetString($magic) -eq "CRENROL1") {
            $fs.Position = $total - 12
            $lb = New-Object byte[] 4
            [void]$fs.Read($lb, 0, 4)
            $clen = [System.BitConverter]::ToInt32($lb, 0)
            if (($clen -gt 0) -and ($clen -lt ($total - 12))) {
                $fs.Position = $total - 12 - $clen
                $cb = New-Object byte[] $clen
                $read = 0
                while ($read -lt $clen) { $n = $fs.Read($cb, $read, $clen - $read); if ($n -le 0) { break }; $read += $n }
                $cfg = [System.Text.Encoding]::UTF8.GetString($cb, 0, $read)
                if ($cfg -match '"tenant-slug"\s*:\s*"([^"]*)"') { $slug = $Matches[1] }
                if ($cfg -match '"enroll-key"\s*:\s*"([^"]*)"') { $key = $Matches[1] }
            }
        }
    }
} catch {
    Write-Log ("overlay read failed: " + $_.Exception.Message)
} finally {
    if ($fs) { $fs.Close() }
}
if (-not $slug -or -not $key) { Write-Log "no overlay -> cannot check"; Finish 2 @("nocheck") }

# Build JSON by hand - ConvertTo-Json is PS3+. Escape quotes and backslashes in the name.
$esc = $Name.Replace("\", "\\").Replace('"', '\"')
$json = '{"tenantSlug":"' + $slug + '","enrollKey":"' + $key + '","name":"' + $esc + '"}'
try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
} catch { }
$resp = ""
try {
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add("Content-Type", "application/json; charset=utf-8")
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $rb = $wc.UploadData($Url, "POST", $bytes)
    $resp = [System.Text.Encoding]::UTF8.GetString($rb)
} catch {
    Write-Log ("request failed: " + $_.Exception.Message)
    Finish 2 @("nocheck")
}
# Minimal parse: count matches, first match's fields.
$count = ([regex]::Matches($resp, '"remoteId"')).Count
if ($count -eq 0) { Write-Log ("no match for name"); Finish 0 @("0") }
$rid = ""; $alive = "false"; $seen = ""
if ($resp -match '"remoteId"\s*:\s*"([^"]*)"') { $rid = $Matches[1] }
if ($resp -match '"alive"\s*:\s*(true|false)') { $alive = $Matches[1] }
if ($resp -match '"lastHeartbeatAt"\s*:\s*"([^"]*)"') { $seen = $Matches[1] }
Write-Log ("match count=" + $count + " rid=" + $rid + " alive=" + $alive)
Finish 1 @([string]$count, $rid, $alive, $seen)
