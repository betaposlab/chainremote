# extract-enroll-overlay.ps1 — per-tenant enroll overlay 추출기.
#
# 관리 패널이 베이스 인스톨러 .exe 끝에 대리점별 설정 blob 을 덧붙인다:
#   [ UTF-8 custom.txt JSON ][ int32 LE length ][ 8-byte ASCII magic "CRENROL1" ]
# 이 스크립트는 실행 중인 setup .exe 의 그 blob 을 읽어 유효하면 스테이징 custom.txt 에 써넣는다
# → [Run] 1.5 가 그 per-tenant 설정을 설치한다.
# overlay 가 없으면(베이스 그대로/자동업뎃) 번들 custom.txt 를 안 건드린다 = 기존 동작 무변경.
#
# PS 2.0 안전(Win7), ASCII only (CP949 ParserError 회피).
param([string]$Setup, [string]$Stage)
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\ProgramData\ChainRemote\updater.log'
function Log($m) {
  try {
    $dir = Split-Path $log
    if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
    $d = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $log -Value ($d + ' overlay: ' + $m)
  } catch {}
}
$fs = $null
try {
  $fs = [System.IO.File]::OpenRead($Setup)
  $total = $fs.Length
  if ($total -le 12) { Log 'no overlay (file too small)'; return }
  $fs.Position = $total - 8
  $magic = New-Object byte[] 8
  [void]$fs.Read($magic, 0, 8)
  if ([System.Text.Encoding]::ASCII.GetString($magic) -ne 'CRENROL1') { Log 'no overlay marker -> bundled'; return }
  $fs.Position = $total - 12
  $lb = New-Object byte[] 4
  [void]$fs.Read($lb, 0, 4)
  $clen = [System.BitConverter]::ToInt32($lb, 0)
  if (($clen -le 0) -or ($clen -ge ($total - 12))) { Log ('bad overlay length ' + $clen); return }
  $fs.Position = $total - 12 - $clen
  $cb = New-Object byte[] $clen
  $read = 0
  while ($read -lt $clen) {
    $n = $fs.Read($cb, $read, $clen - $read)
    if ($n -le 0) { break }
    $read += $n
  }
  $cfg = [System.Text.Encoding]::UTF8.GetString($cb, 0, $read)
  if (($cfg -notmatch 'tenant-slug') -or ($cfg -notmatch 'enroll-key')) { Log 'overlay config missing fields -> bundled'; return }
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Stage, $cfg, $enc)
  Log ('overlay applied -> ' + $Stage + ' (' + $read + ' bytes)')
} catch {
  Log 'overlay extract exception -> bundled'
} finally {
  if ($fs -ne $null) { try { $fs.Close() } catch {} }
}
