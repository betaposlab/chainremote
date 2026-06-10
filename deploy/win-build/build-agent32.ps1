# ChainRemote Agent32 빌드 — 32비트(i686) Sciter 에이전트 빌드 + 페이로드 스테이징
#
# ★ 통합 인스톨러 파이프라인의 한 단계 (2026-06-10부터):
#   [1] build-all.ps1            → x64 Flutter 빌드
#   [2] 이 스크립트              → i686 Sciter 빌드 + agent32-payload\ 스테이징
#   [3] ISCC agent-installer.iss → 통합 ChainRemote_Agent_Setup_v*.exe (x64+x86 동봉, OS 가 자동 선택)
#
# 왜 Rust 1.75 인가 (★변경 금지):
#   - upstream 핀 SCITER_RUST_VERSION="1.75": Rust 1.78+ 의 i128 ABI 변경이 sciter.dll
#     인터롭을 깨뜨림 (flutter-build.yml:21 주석, blog.rust-lang.org 2024-03-30).
#   - Rust ≤1.77 의 std 는 Win7 을 지원 (1.78 부터 Win10+ 전용).
#   → 1.75 한 벌로 [Sciter ABI 안전] + [Win7+Win10 32비트 전부 커버] 동시 해결.
#     nightly + i686-win7-windows-msvc(Tier3) 경로는 최신 rustc = i128 ABI 변경 포함이라
#     오히려 Sciter 가 깨짐 — 쓰지 말 것.
#
# 사전 조건 (2026-06-09 스파이크에서 셋업됨):
#   - vcpkg x86 의존성: C:\src\vcpkg\installed\x86-windows-static (opus/vpx/aom/yuv/sodium)
#   - x86 sciter.dll: C:\src\sciter_x32\sciter.dll (PE 0x014C)
#   - libsodium-sys 0.2.7 크로스컴파일 버그(호스트 cfg 로 lib arch 선택) → 타겟별
#     build-script override 로 정석 해결 (호스트 빌드스크립트는 x64 sodium 그대로)
#
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File build-agent32.ps1
# 실증: 2026-06-10 실물 POS (Win7 Enterprise SP1 32비트, Smartro/Atom D2550) 전 구간 검증 통과.

$ErrorActionPreference = 'Continue'   # EAP Stop + native stderr 함정 회피 — exit code 로 판정
Set-Location C:\src\ChainRemote
if (-not $env:VCPKG_ROOT)    { $env:VCPKG_ROOT = 'C:\src\vcpkg' }
if (-not $env:LIBCLANG_PATH) { $env:LIBCLANG_PATH = 'C:\Program Files\LLVM\bin' }

$exe = 'C:\src\ChainRemote\target\i686-pc-windows-msvc\release\rustdesk.exe'
$sciterDll = 'C:\src\sciter_x32\sciter.dll'
$payload = 'C:\src\ChainRemote\deploy\win-installer\agent32-payload'

Write-Host '[1/5] sciter.dll(x86) 존재 확인'
if (-not (Test-Path $sciterDll)) { Write-Host 'AGENT32-FAIL: sciter.dll x86 missing (C:\src\sciter_x32)'; exit 1 }

Write-Host '[2/5] Rust 1.75 toolchain + i686 target'
rustup toolchain install 1.75 --profile minimal
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: rustup toolchain install 1.75'; exit 1 }
rustup target add --toolchain 1.75 i686-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: rustup target add'; exit 1 }

Write-Host '[3/5] libsodium-sys 클린 (host+target 리셋) + i686 빌드 (inline sciter, hwcodec 제외)'
cargo +1.75 clean -p libsodium-sys
$cfg1 = "target.i686-pc-windows-msvc.sodium.rustc-link-search=['native=C:/src/vcpkg/installed/x86-windows-static/lib']"
$cfg2 = "target.i686-pc-windows-msvc.sodium.rustc-link-lib=['static=libsodium']"
cargo +1.75 build --target i686-pc-windows-msvc --release --features inline --config $cfg1 --config $cfg2
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: cargo build'; exit 1 }
Write-Host 'AGENT32-BUILD-OK'

Write-Host '[4/5] PE 검증 (machine=0x014C + subsystem min version) + 스모크'
$fs = [System.IO.File]::OpenRead($exe)
$br = New-Object System.IO.BinaryReader($fs)
$null = $fs.Seek(0x3C, 'Begin'); $peOff = $br.ReadInt32()
$null = $fs.Seek($peOff + 4, 'Begin'); $machine = $br.ReadUInt16()
$null = $fs.Seek($peOff + 24 + 48, 'Begin'); $ssMaj = $br.ReadUInt16(); $ssMin = $br.ReadUInt16()
$br.Close(); $fs.Close()
Write-Host ('machine=0x{0:X4} subsystem-min={1}.{2}' -f $machine, $ssMaj, $ssMin)
if ($machine -ne 0x014C) { Write-Host 'AGENT32-FAIL: not 32-bit PE'; exit 1 }
if ($ssMaj -gt 6 -or ($ssMaj -eq 6 -and $ssMin -gt 1)) { Write-Host 'AGENT32-FAIL: subsystem min > 6.1 (Win7 거부됨)'; exit 1 }
& $exe --version
& $exe --get-id
Write-Host ('smoke exit=' + $LASTEXITCODE)

Write-Host '[5/5] 페이로드 스테이징 (agent32-payload — 통합 인스톨러의 x86 쪽 재료)'
Remove-Item -Recurse -Force $payload -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item $exe (Join-Path $payload 'ChainRemote.exe') -Force
Copy-Item $sciterDll $payload -Force
Copy-Item 'C:\src\ChainRemote\deploy\custom-agent.txt' (Join-Path $payload 'custom.txt') -Force
Get-ChildItem $payload | ForEach-Object { Write-Host ('  staged: ' + $_.Name + ' (' + [math]::Round($_.Length/1KB) + ' KB)') }
Write-Host 'AGENT32-STAGE-OK'
Write-Host 'AGENT32-ALL-DONE'
