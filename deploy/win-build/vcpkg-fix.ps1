$ErrorActionPreference = "Stop"
Write-Host "=== vcpkg 핀 커밋 정렬 + 라이브러리 재설치 ===" -ForegroundColor Cyan
Write-Host ""

$vcpkgDir = "C:\src\vcpkg"
$pinnedCommit = "120deac3062162151622ca4860575a33844ba10b"  # RustDesk CI 핀 (2025.08.27)

if (-not (Test-Path $vcpkgDir)) {
  Write-Host "❌ vcpkg 폴더 없음 ($vcpkgDir)" -ForegroundColor Red
  exit 1
}

Push-Location $vcpkgDir

Write-Host "[1/4] vcpkg fetch + checkout $pinnedCommit ..." -ForegroundColor Yellow
git fetch origin
git checkout $pinnedCommit
if ($LASTEXITCODE -ne 0) { Write-Host "❌ checkout 실패" -ForegroundColor Red; Pop-Location; exit 1 }

Write-Host "[2/4] vcpkg 재부트스트랩 ..." -ForegroundColor Yellow
& "$vcpkgDir\bootstrap-vcpkg.bat" -disableMetrics
if ($LASTEXITCODE -ne 0) { Write-Host "❌ bootstrap 실패" -ForegroundColor Red; Pop-Location; exit 1 }

Write-Host "[3/4] 기존 빌드 제거 ..." -ForegroundColor Yellow
foreach ($lib in @("libvpx","libyuv","opus","aom")) {
  & "$vcpkgDir\vcpkg.exe" remove ${lib}:x64-windows-static --recurse 2>&1 | Out-Null
}
if (Test-Path "$vcpkgDir\buildtrees") { Remove-Item "$vcpkgDir\buildtrees" -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "$vcpkgDir\packages") { Remove-Item "$vcpkgDir\packages" -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "$vcpkgDir\installed") { Remove-Item "$vcpkgDir\installed" -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "[4/4] 라이브러리 재설치 (시간 큼, 20~40분) ..." -ForegroundColor Yellow
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
cmd /c "`"$vcpkgDir\vcpkg.exe`" install libvpx:x64-windows-static libyuv:x64-windows-static opus:x64-windows-static aom:x64-windows-static"
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEAP

Pop-Location

if ($code -ne 0) {
  Write-Host "❌ vcpkg install 실패 (exit $code)" -ForegroundColor Red
  exit 1
}

Write-Host "`n=== vcpkg 정렬 완료 ===" -ForegroundColor Green
Write-Host "  이제 build-all.ps1 다시 실행:" -ForegroundColor Cyan
Write-Host "    iex (irm http://192.168.68.108:8765/build-all.ps1)" -ForegroundColor White
