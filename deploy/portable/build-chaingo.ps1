# ChainGo (포터블 HQ SFX) 빌드 — 윈컴에서 실행.
# 출력: deploy\portable\ChainGo.exe
#
# 파이프라인:
#   1. build.py --flutter --hwcodec --portable --skip-portable-pack
#      → cargo lib + Flutter Release 만 빌드 (SFX 패킹은 skip)
#   2. deploy\custom-portable.txt 를 Flutter Release\custom.txt 로 복사
#      (포터블 inner exe 의 conn-type=outgoing 보장)
#   3. libs\portable\generate.py 로 Flutter Release 를 SFX 페이로드로 변환
#   4. cargo build --release (libs/portable) → rustdesk-portable-packer.exe
#   5. deploy\portable\ChainGo.exe 로 rename·이동
#
# 흔적 메모: ChainGo.exe 실행 시 %TEMP%\ChainGo_<rand>\ 에 풀고 종료 시 정리.
# inner 가 %APPDATA%\RustDesk 안 건드림 (Config::path() 가 APP_DIR 우선).

$ErrorActionPreference = "Stop"
$repoDir = "C:\src\ChainRemote"

# env (build-all.ps1 step 0 와 동일)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
if (-not $env:VCPKG_ROOT) { $env:VCPKG_ROOT = "C:\src\vcpkg" }
$extraPaths = @(
  "C:\ProgramData\chocolatey\bin",
  "C:\Program Files\NASM",
  "C:\Program Files\LLVM\bin",
  "C:\src\flutter-3.24.5\bin",
  "$env:USERPROFILE\.cargo\bin",
  "$env:USERPROFILE\.rustup\toolchains\1.81.0-x86_64-pc-windows-msvc\bin"
)
foreach ($p in $extraPaths) {
  if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) { $env:Path = "$p;$env:Path" }
}
if (-not $env:LIBCLANG_PATH) {
  if (Test-Path "C:\Program Files\LLVM\bin\libclang.dll") { $env:LIBCLANG_PATH = "C:\Program Files\LLVM\bin" }
}

Push-Location $repoDir
Write-Host "HEAD: $(git rev-parse --short HEAD)"
Write-Host "flutter: $((Get-Command flutter).Source)"
Write-Host "cargo: $((Get-Command cargo).Source)"

# 옛 산출물 정리 (rename 충돌 방지)
foreach ($f in @("rustdesk_portable.exe","rustdesk-1.4.6-install.exe")) {
  if (Test-Path $f) { Remove-Item $f -Force; Write-Host "removed stale $f" }
}

# Rust core 변경이라 풀빌드. HQ 스크립트와 같은 클린 패턴 사용
# (flutter clean → rm .dart_tool/build → flutter pub get).
# 추가 방어: pub advisories 캐시가 손상되면 readAdvisoriesFromCache 가
# "Null check operator used on a null value" 로 panic (Dart pub 알려진 버그).
# .advisories 폴더만 골라 제거하여 다음 fetch 시 재생성되게 함.
Write-Host "[clean] pub advisories cache 정리"
# 손상된 advisories 캐시는 hosted\pub.dev\.cache\*-advisories.json. 그 .cache 폴더만
# 통째로 정리(패키지 archives 와 분리된 위치라 재다운로드 비용 없음). pub 가 다음
# resolve 시 재생성.
$pubMetaCache = "$env:LOCALAPPDATA\Pub\Cache\hosted\pub.dev\.cache"
if (Test-Path $pubMetaCache) {
  Remove-Item -Recurse -Force $pubMetaCache -ErrorAction SilentlyContinue
  Write-Host "  removed $pubMetaCache"
}

Write-Host "[clean] flutter clean + rm .dart_tool/build + flutter pub get"
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
Push-Location "$repoDir\flutter"
cmd /c "flutter clean" 2>&1 | Select-Object -Last 2
Remove-Item -Recurse -Force .dart_tool, build -ErrorAction SilentlyContinue
cmd /c "flutter pub get" 2>&1 | Select-Object -Last 3
Pop-Location
$ErrorActionPreference = $prevEAP

# pub advisories 검색이 Dart pub 의 알려진 버그(Null check panic)로 죽음.
# PUB_OFFLINE=1 = 어제 cached 패키지로만 풀어 advisories 네트워크 조회 skip.
# 만약 캐시 누락이 있으면 그때만 PUB_OFFLINE 빼고 재시도하면 됨.
$env:PUB_OFFLINE = "1"
Write-Host "[env] PUB_OFFLINE=1 (advisories panic 회피)"

# 1) Flutter + cargo lib 빌드 (SFX 패킹 skip)
$buildLog = "$env:TEMP\chaingo-build.log"
if (Test-Path $buildLog) { Remove-Item $buildLog -Force }
Write-Host "[1/5] build.py --flutter --hwcodec --portable --skip-portable-pack  (log: $buildLog)"
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
cmd /c "python build.py --flutter --hwcodec --portable --skip-portable-pack > `"$buildLog`" 2>&1"
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($code -ne 0) {
  Write-Host "BUILD FAILED (exit $code). Last 60 lines:"
  if (Test-Path $buildLog) { Get-Content $buildLog | Select-Object -Last 60 }
  Pop-Location
  exit 1
}

$releaseDir = "$repoDir\flutter\build\windows\x64\runner\Release"
if (-not (Test-Path "$releaseDir\rustdesk.exe")) {
  Write-Host "BUILD output missing: $releaseDir\rustdesk.exe"
  Pop-Location
  exit 1
}
Write-Host "[1/5] OK. Release rustdesk.exe mtime: $((Get-Item "$releaseDir\rustdesk.exe").LastWriteTime)"

# 2) custom-portable.txt → Release\custom.txt
Write-Host "[2/5] custom.txt 박기 (conn-type=outgoing)"
Copy-Item "$repoDir\deploy\custom-portable.txt" "$releaseDir\custom.txt" -Force

# 3) generate.py 로 SFX 페이로드 만들기 (pip + python 둘 다 stderr 출력 흔함 → EAP 완화)
Push-Location "$repoDir\libs\portable"
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
cmd /c "pip3 install -r requirements.txt" 2>&1 | Select-Object -Last 3
Write-Host "[3/5] generate.py (페이로드 생성)"
cmd /c "python generate.py -f ../../flutter/build/windows/x64/runner/Release -o . -e ../../flutter/build/windows/x64/runner/Release/rustdesk.exe" 2>&1 | Select-Object -Last 5
$genCode = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($genCode -ne 0) {
  Write-Host "generate.py FAILED (exit $genCode)"
  Pop-Location; Pop-Location; exit 1
}

# 4) cargo build --release of libs/portable (= SFX 래퍼)
Write-Host "[4/5] cargo build --release (libs/portable)"
$cargoLog = "$env:TEMP\chaingo-cargo.log"
if (Test-Path $cargoLog) { Remove-Item $cargoLog -Force }
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
cmd /c "cargo build --release > `"$cargoLog`" 2>&1"
$cargoCode = $LASTEXITCODE
$ErrorActionPreference = $prevEAP
if ($cargoCode -ne 0) {
  Write-Host "cargo build FAILED (exit $cargoCode). Last 40 lines:"
  if (Test-Path $cargoLog) { Get-Content $cargoLog | Select-Object -Last 40 }
  Pop-Location; Pop-Location; exit 1
}
Pop-Location

# 5) deploy\portable\ChainGo.exe 로 이동
# cargo workspace 때문에 target 이 libs/portable 가 아니라 워크스페이스 루트.
$candidates = @(
  "$repoDir\target\release\rustdesk-portable-packer.exe",
  "$repoDir\libs\portable\target\release\rustdesk-portable-packer.exe"
)
$srcPacker = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $srcPacker) {
  Write-Host "ERROR: rustdesk-portable-packer.exe 못 찾음. 후보:"
  $candidates | ForEach-Object { Write-Host "  $_" }
  exit 1
}
$outDir = "$repoDir\deploy\portable"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$outExe = "$outDir\ChainGo.exe"
if (Test-Path $outExe) { Remove-Item $outExe -Force }
Copy-Item $srcPacker $outExe -Force
$sizeMB = [Math]::Round((Get-Item $outExe).Length/1MB,1)

Pop-Location
Write-Host "=== CHAINGO BUILD COMPLETE ==="
Write-Host "DONE: $outExe ($sizeMB MB) mtime=$((Get-Item $outExe).LastWriteTime)"
