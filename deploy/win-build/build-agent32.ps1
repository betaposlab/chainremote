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
#
# 사전 조건 (2026-06-09 스파이크에서 셋업됨):
#   - vcpkg x86 의존성: C:\src\vcpkg\installed\x86-windows-static (opus/vpx/aom/yuv/sodium)
#   - x86 sciter.dll: C:\src\sciter_x32\sciter.dll (PE 0x014C)
#   - Python (res/inline-sciter.py 실행용 — build.py 와 동일 환경)
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

Write-Host '[1/6] sciter.dll(x86) 존재 확인'
if (-not (Test-Path $sciterDll)) { Write-Host 'AGENT32-FAIL: sciter.dll x86 missing (C:\src\sciter_x32)'; exit 1 }

Write-Host '[2/6] Rust 1.75 toolchain + i686 target'
rustup toolchain install 1.75 --profile minimal
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: rustup toolchain install 1.75'; exit 1 }
rustup target add --toolchain 1.75 i686-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: rustup target add'; exit 1 }

# ★ 핵심: inline feature 의 Sciter UI(cm.tis/index.tis/...)는 res/inline-sciter.py 가
#   src/ui/inline.rs(.gitignore, untracked 생성물) 로 구워넣는다. 이 단계를 빠뜨리면
#   옛 inline.rs(이전 빌드 잔재)로 조용히 빌드돼 UI 변경이 반영 안 됨(거짓 OK).
Write-Host '[3/6] Sciter 리소스 임베드 재생성 (inline.rs) — cm.tis/index.tis 변경 반영'
python res/inline-sciter.py
if ($LASTEXITCODE -ne 0) { python3 res/inline-sciter.py }
if (-not (Test-Path 'src/ui/inline.rs')) { Write-Host 'AGENT32-FAIL: inline.rs 생성 실패 (python/res/inline-sciter.py 확인)'; exit 1 }
# 생성 신선도 확인 — inline.rs 가 방금 수정된 tis 보다 새것이어야 함
$tisTime = (Get-Item 'src/ui/cm.tis').LastWriteTime
$inlineTime = (Get-Item 'src/ui/inline.rs').LastWriteTime
if ($inlineTime -lt $tisTime) { Write-Host 'AGENT32-FAIL: inline.rs 가 cm.tis 보다 오래됨 (재생성 안 됨)'; exit 1 }
Write-Host '    inline.rs 재생성 OK'

Write-Host '[4/6] libsodium-sys 클린 (host+target 리셋) + i686 빌드 (inline sciter, hwcodec 제외)'
cargo +1.75 clean -p libsodium-sys
$cfg1 = "target.i686-pc-windows-msvc.sodium.rustc-link-search=['native=C:/src/vcpkg/installed/x86-windows-static/lib']"
$cfg2 = "target.i686-pc-windows-msvc.sodium.rustc-link-lib=['static=libsodium']"
cargo +1.75 build --target i686-pc-windows-msvc --release --features inline --config $cfg1 --config $cfg2
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: cargo build'; exit 1 }
Write-Host 'AGENT32-BUILD-OK'

Write-Host '[5/6] PE 검증 (machine=0x014C + subsystem min version) + 스모크'
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

Write-Host '[6/6] 페이로드 스테이징 (agent32-payload — 통합 인스톨러의 x86 쪽 재료)'
Remove-Item -Recurse -Force $payload -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item $exe (Join-Path $payload 'ChainRemote.exe') -Force
Copy-Item $sciterDll $payload -Force
Copy-Item 'C:\src\ChainRemote\deploy\custom-agent.txt' (Join-Path $payload 'custom.txt') -Force
foreach ($f in Get-ChildItem $payload) { Write-Host ('    staged: ' + $f.Name) }
Write-Host 'AGENT32-STAGE-OK'
Write-Host 'AGENT32-ALL-DONE'
