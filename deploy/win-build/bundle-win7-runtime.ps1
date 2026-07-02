# Win7 런타임 app-local 동봉 (2026-06-15)
#
# ChainRemote.exe 는 Flutter/MSVC 로 Win10 을 가정하고 빌드된다. 실행엔 두 런타임이 필요하다:
#   - Universal CRT (UCRT)  : ucrtbase.dll + api-ms-win-crt-*.dll
#   - VC++ 런타임           : vcruntime140.dll (+x64: vcruntime140_1.dll) + msvcp140.dll
# Win10/11 은 UCRT 가 OS 내장이고 VC++ 도 흔히 깔려있어 문제없다. 하지만 갓 설치한 깨끗한
# Windows 7(윈도우 업데이트 미적용)엔 둘 다 없어 exe 가 실행조차 안 된다
# (api-ms-win-crt-runtime-l1-1-0.dll / vcruntime140.dll 없음 에러).
# 이 DLL 들을 exe 옆에 같이 두면(app-local) OS 업데이트 상태와 무관하게 어떤 Win7 에서도 실행된다.
# (향우정 메인포스 POS 가 Win10 미지원이라 Win7 다운그레이드가 필수 → bone-stock Win7 대응.)
#
# 사용:
#   # 64비트 에이전트 빌드 후
#   .\bundle-win7-runtime.ps1 -ReleaseDir "C:\src\ChainRemote\flutter\build\windows\x64\runner\Release" -Arch x64
#   # 32비트(Win7 32bit 거래처) 에이전트 빌드 후 — 이땐 -Arch x86 을 빠뜨리지 말 것
#   .\bundle-win7-runtime.ps1 -ReleaseDir "<32비트 Release 폴더>" -Arch x86
#
#   ISCC 로 인스톨러 묶기 직전 1회 실행. 멱등(이미 있으면 덮어쓰기만). [Files] 가 Release 폴더를
#   통째로 싸므로 동봉된 DLL 이 인스톨러 → install_me → Program Files 까지 자동으로 따라간다.
#
# 사전조건(빌드머신):
#   - Windows 10/11 SDK ('Windows Universal CRT' 구성요소 포함) — UCRT redist 제공
#   - Visual Studio 2019/2022 (C++ 워크로드) — VC++ CRT redist 제공
param(
  [Parameter(Mandatory = $true)][string]$ReleaseDir,
  [ValidateSet('x86', 'x64')][string]$Arch
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ReleaseDir)) { Write-Error "Release 폴더 없음: $ReleaseDir"; exit 1 }

# Arch 미지정 시 ReleaseDir 경로로 추정 (…\windows\x64\… vs \x86\ 또는 \win32\)
if (-not $Arch) {
  if ($ReleaseDir -match '\\windows\\x64\\') { $Arch = 'x64' }
  elseif ($ReleaseDir -match '\\windows\\(x86|win32)\\') { $Arch = 'x86' }
  else { Write-Error "Arch 추정 실패 — -Arch x86|x64 명시하세요 (32비트 빌드는 반드시 x86)."; exit 1 }
}
Write-Host "[bundle-win7-runtime] 대상=$ReleaseDir  arch=$Arch" -ForegroundColor Cyan

# ── (1) Universal CRT redist 탐색 + 복사 ─────────────────────────────────────
#   표준: C:\Program Files (x86)\Windows Kits\10\Redist\<ver>\ucrt\DLLs\<arch>\
$ucrtSrc = $null
foreach ($kitRoot in @("${env:ProgramFiles(x86)}\Windows Kits\10\Redist", "$env:ProgramFiles\Windows Kits\10\Redist")) {
  if (-not (Test-Path $kitRoot)) { continue }
  # 버전 하위폴더(예 10.0.22621.0) 최신 우선 + 버전폴더 없는 옛 SDK 도 시도
  $verDirs = @(Get-ChildItem $kitRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
  foreach ($d in ($verDirs + (Get-Item $kitRoot))) {
    $p = Join-Path $d.FullName "ucrt\DLLs\$Arch"
    if (Test-Path (Join-Path $p 'ucrtbase.dll')) { $ucrtSrc = $p; break }
  }
  if ($ucrtSrc) { break }
}
if (-not $ucrtSrc) {
  Write-Error ("UCRT redist 못 찾음 (arch=$Arch). Windows 10/11 SDK 의 'Windows Universal CRT' 구성요소 설치 필요.`n" +
    "  표준경로: C:\Program Files (x86)\Windows Kits\10\Redist\<ver>\ucrt\DLLs\$Arch")
  exit 1
}
Copy-Item (Join-Path $ucrtSrc 'ucrtbase.dll') $ReleaseDir -Force
Get-ChildItem $ucrtSrc -Filter 'api-ms-win-*.dll' | ForEach-Object { Copy-Item $_.FullName $ReleaseDir -Force }
$ucrtN = @(Get-ChildItem $ReleaseDir -Filter 'api-ms-win-*.dll').Count
Write-Host "  UCRT: ucrtbase.dll + api-ms-win-*.dll $ucrtN개 동봉 (src: $ucrtSrc)" -ForegroundColor Green

# ── (2) VC++ CRT redist 탐색 + 복사 ──────────────────────────────────────────
#   표준: <VS설치>\VC\Redist\MSVC\<ver>\<arch>\Microsoft.VC14x.CRT\
$vcNeed = if ($Arch -eq 'x64') { @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll') }
          else { @('vcruntime140.dll', 'msvcp140.dll') }   # x86 엔 vcruntime140_1.dll 없음
$vcSrc = $null
$vsGlobs = @(
  "$env:ProgramFiles\Microsoft Visual Studio\*\*\VC\Redist\MSVC\*\$Arch\Microsoft.VC*.CRT",
  "${env:ProgramFiles(x86)}\Microsoft Visual Studio\*\*\VC\Redist\MSVC\*\$Arch\Microsoft.VC*.CRT"
)
foreach ($g in $vsGlobs) {
  $hit = @(Get-ChildItem -Path $g -Directory -ErrorAction SilentlyContinue |
           Where-Object { Test-Path (Join-Path $_.FullName 'vcruntime140.dll') } |
           Sort-Object FullName -Descending) | Select-Object -First 1
  if ($hit) { $vcSrc = $hit.FullName; break }
}
if (-not $vcSrc) {
  Write-Warning ("VC++ CRT redist 못 찾음 (arch=$Arch). VS2019/2022 C++ 워크로드 설치 필요.`n" +
    "  표준경로: <VS>\VC\Redist\MSVC\<ver>\$Arch\Microsoft.VC14x.CRT\`n" +
    "  → 이 DLL들이 Release 폴더에 없으면 깨끗한 Win7 에서 vcruntime140.dll 없음 에러로 실행 실패함. 수동 복사 필요.")
}
else {
  foreach ($f in $vcNeed) {
    $sp = Join-Path $vcSrc $f
    if (Test-Path $sp) { Copy-Item $sp $ReleaseDir -Force }
    else { Write-Warning "  VC++ 누락: $f (src: $vcSrc)" }
  }
  Write-Host "  VC++: $($vcNeed -join ', ') 동봉 (src: $vcSrc)" -ForegroundColor Green
}

# ── 검증: exe 옆 핵심 DLL 존재 확인 ─────────────────────────────────────────
$must = @('ucrtbase.dll', 'api-ms-win-crt-runtime-l1-1-0.dll', 'vcruntime140.dll', 'msvcp140.dll')
$missing = @($must | Where-Object { -not (Test-Path (Join-Path $ReleaseDir $_)) })
if ($missing.Count -gt 0) {
  Write-Warning "동봉 후에도 누락된 런타임: $($missing -join ', ') — 깨끗한 Win7 에서 실행 실패 가능. 위 경고 확인."
}
else {
  Write-Host "[bundle-win7-runtime] OK — Release 폴더가 Win7 self-contained 상태 (ucrt+vc++ 동봉)." -ForegroundColor Green
}
