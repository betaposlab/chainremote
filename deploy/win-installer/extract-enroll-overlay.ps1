# extract-enroll-overlay.ps1 — per-tenant enroll overlay 추출기.
#
# 관리 패널이 베이스 인스톨러 .exe 끝에 대리점별 설정 blob 을 덧붙인다:
#   [ UTF-8 custom.txt JSON ][ int32 LE length ][ 8-byte ASCII magic "CRENROL1" ]
# 이 스크립트는 실행 중인 setup .exe 의 그 blob 을 읽어 유효하면 스테이징 custom.txt 에 써넣는다
# → [Run] 1.5 가 그 per-tenant 설정을 설치한다.
# overlay 가 없으면(베이스 그대로/자동업뎃) 기존 설치본의 대리점 설정을 이어받는다 — 아래 -Existing.
#
# PS 2.0 안전(Win7), ASCII only (CP949 ParserError 회피).
#
# -Existing: path to the custom.txt of the CURRENTLY INSTALLED agent (optional).
#   An automatic update runs the plain base .exe, which carries no overlay, and step 1.5
#   then stamps the bundled custom.txt over the installed one - wiping the tenant's
#   enroll-key and, on unattended agents, the "unattended" flag that is the only switch
#   turning off click-to-accept. That silently reverted three of the friend-tenant PCs to
#   the accept card on 2026-08-07, hours after they were installed.
#   So when there is no overlay we carry the tenant-specific file forward instead.
#   Guard: only files that actually carry tenant data are preserved (a non-empty
#   enroll-key, or unattended=Y). The bundle ships an empty key, so ordinary agents keep
#   taking the fresh bundled settings exactly as before.
#
# The result is also recorded as a flag file so the installer can TELL A HUMAN when the
# install would end up with no enroll-key (2026-08-16 audit S2). Until now that case was
# completely silent: a per-tenant .exe whose tail was lost in transit still installs and
# runs perfectly on the PC, but can never auto-enroll, so the store never appears in the
# panel and nobody finds out until someone needs remote support. The overlay sits AFTER
# the Inno payload, so losing it does not break the installer's own integrity check -
# there is nothing else that would notice.
param([string]$Setup, [string]$Stage, [string]$Existing)
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\ProgramData\ChainRemote\updater.log'
$flag = 'C:\ProgramData\ChainRemote\no-enroll-key.flag'
function Log($m) {
  try {
    $dir = Split-Path $log
    if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
    $d = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $log -Value ($d + ' overlay: ' + $m)
  } catch {}
}
# No overlay in this .exe - keep the installed tenant config instead of the bundle.
function Preserve {
  if (-not $Existing) { Log 'no overlay -> bundled (no -Existing given)'; return }
  if (-not (Test-Path $Existing)) { Log 'no overlay, nothing installed -> bundled'; return }
  $old = ''
  try { $old = [System.IO.File]::ReadAllText($Existing) } catch {}
  if (-not $old) { Log 'no overlay, existing unreadable -> bundled'; return }
  if ($old -notmatch '"conn-type"') { Log 'no overlay, existing not a custom.txt -> bundled'; return }
  $hasKey = ($old -match '"enroll-key"\s*:\s*"[^"]+"')
  $hasUnattended = ($old -match '"unattended"\s*:\s*"Y"')
  if (-not ($hasKey -or $hasUnattended)) { Log 'no overlay, existing has no tenant data -> bundled'; return }
  $e = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Stage, $old, $e)
  Log ('no overlay -> preserved installed custom.txt (key=' + $hasKey + ' unattended=' + $hasUnattended + ')')
}
$fs = $null
try {
  $fs = [System.IO.File]::OpenRead($Setup)
  $total = $fs.Length
  if ($total -le 12) { Log 'no overlay (file too small)'; Preserve; return }
  $fs.Position = $total - 8
  $magic = New-Object byte[] 8
  [void]$fs.Read($magic, 0, 8)
  if ([System.Text.Encoding]::ASCII.GetString($magic) -ne 'CRENROL1') { Log 'no overlay marker -> bundled'; Preserve; return }
  $fs.Position = $total - 12
  $lb = New-Object byte[] 4
  [void]$fs.Read($lb, 0, 4)
  $clen = [System.BitConverter]::ToInt32($lb, 0)
  if (($clen -le 0) -or ($clen -ge ($total - 12))) { Log ('bad overlay length ' + $clen); Preserve; return }
  $fs.Position = $total - 12 - $clen
  $cb = New-Object byte[] $clen
  $read = 0
  while ($read -lt $clen) {
    $n = $fs.Read($cb, $read, $clen - $read)
    if ($n -le 0) { break }
    $read += $n
  }
  $cfg = [System.Text.Encoding]::UTF8.GetString($cb, 0, $read)
  if (($cfg -notmatch 'tenant-slug') -or ($cfg -notmatch 'enroll-key')) { Log 'overlay config missing fields -> bundled'; Preserve; return }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Stage, $cfg, $enc)
  Log ('overlay applied -> ' + $Stage + ' (' + $read + ' bytes)')
} catch {
  Log 'overlay extract exception -> bundled'
  Preserve
} finally {
  if ($fs -ne $null) { try { $fs.Close() } catch {} }
}

# Verdict: does the file we are about to install actually carry a tenant enroll-key?
#   No key means no auto-enroll, which means the panel will never see this PC.
#   We only leave a flag here; the installer decides whether a human is present to tell.
try {
  $staged = ''
  if (Test-Path $Stage) { $staged = [System.IO.File]::ReadAllText($Stage) }
  if ($staged -match '"enroll-key"\s*:\s*"[^"]+"') {
    if (Test-Path $flag) { Remove-Item $flag -Force }
    Log 'verdict: enroll-key present'
  } else {
    Set-Content -Path $flag -Value 'no enroll-key' -Force
    Log 'verdict: NO ENROLL-KEY - this install cannot auto-enroll (panel will not see it)'
  }
} catch { Log 'verdict check failed' }
