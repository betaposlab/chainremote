# ChainRemote Agent32 빌드 — 32비트(i686) Sciter 에이전트 빌드 + 페이로드 스테이징
#
# ★ 통합 인스톨러 파이프라인의 한 단계 (2026-06-10부터):
#   [1] build-all.ps1            -> x64 Flutter 빌드
#   [2] 이 스크립트              -> i686 Sciter 빌드 + agent32-payload 스테이징
#   [3] ISCC agent-installer.iss -> 통합 ChainRemote_Agent_Setup_v*.exe (x64+x86 동봉, OS 가 자동 선택)
#
# 왜 Rust 1.75 인가 (★변경 금지):
#   - upstream 핀 SCITER_RUST_VERSION="1.75": Rust 1.78+ 의 i128 ABI 변경이 sciter.dll
#     인터롭을 깨뜨림 (flutter-build.yml:21 주석, blog.rust-lang.org 2024-03-30).
#   - Rust <=1.77 의 std 는 Win7 을 지원 (1.78 부터 Win10+ 전용).
#   => 1.75 한 벌로 [Sciter ABI 안전] + [Win7+Win10 32비트 전부 커버] 동시 해결.
#
# ★ x86 vcpkg 충돌 자동 복원 ([3/7]):
#   build-all.ps1(x64) 의 vcpkg manifest install 은 installed/ 를 vcpkg.json 기준으로 재구성하면서
#   classic 으로 깔아둔 x86-windows-static 을 통째로 지운다(공유 installed/ 충돌). 그래서 이 스크립트가
#   빌드 직전 x86 의존성을 멱등하게 보장(없으면 classic 재설치). binary cache 덕에 보통 수 분.
#
# 사전 조건: vcpkg(C:\src\vcpkg), x86 sciter.dll(C:\src\sciter_x32\sciter.dll), LLVM, Python.
#
# ⚠ Write-Host 메시지는 ASCII only. powershell -File 은 한국어 윈도우에서 파일을 CP949 로 읽어
#   비ASCII 문자열 리터럴이 깨지면 ParserError. 주석(# 뒤) 한글은 파싱 무관이라 유지.
#
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File build-agent32.ps1
# 실증: 2026-06-10 실물 POS (Win7 Enterprise SP1 32비트, Smartro/Atom D2550) 전 구간 검증 통과.

$ErrorActionPreference = 'Continue'   # EAP Stop + native stderr 함정 회피 — exit code 로 판정
Set-Location C:\src\ChainRemote
# ★ rustup shim(~/.cargo/bin) 을 PATH 최우선으로. 'cargo +1.75' 의 +toolchain 셀렉터는
#   rustup shim 만 이해한다. build-all.ps1 을 같은 세션서 먼저 돌리면 1.81 toolchain 의
#   bin 을 PATH 앞에 박아 shim 을 가려 'error: no such command: +1.75' 로 죽는다(통합빌드 함정).
#   shim 을 다시 최우선에 둬서 단독/연속 실행 모두 안전하게.
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
if (-not $env:VCPKG_ROOT)    { $env:VCPKG_ROOT = 'C:\src\vcpkg' }
if (-not $env:LIBCLANG_PATH) { $env:LIBCLANG_PATH = 'C:\Program Files\LLVM\bin' }

$exe = 'C:\src\ChainRemote\target\i686-pc-windows-msvc\release\rustdesk.exe'
$sciterDll = 'C:\src\sciter_x32\sciter.dll'
$payload = 'C:\src\ChainRemote\deploy\win-installer\agent32-payload'
$vpxHeader = 'C:\src\vcpkg\installed\x86-windows-static\include\vpx\vp8.h'

Write-Host '[1/7] check sciter.dll (x86)'
if (-not (Test-Path $sciterDll)) { Write-Host 'AGENT32-FAIL: sciter.dll x86 missing (C:\src\sciter_x32)'; exit 1 }

Write-Host '[2/7] Rust 1.75 toolchain + i686 target'
rustup toolchain install 1.75 --profile minimal
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: rustup toolchain install 1.75'; exit 1 }
rustup target add --toolchain 1.75 i686-pc-windows-msvc
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: rustup target add'; exit 1 }

# x86 vcpkg deps (no-hwcodec 라 ffmpeg/mfx-dispatch 제외). repo 밖 cwd = classic 모드(manifest 회피).
Write-Host '[3/7] ensure x86 vcpkg deps (libvpx/libyuv/aom/opus/libjpeg-turbo/libsodium)'
if (-not (Test-Path $vpxHeader)) {
    Write-Host '    x86 deps missing (likely wiped by x64 manifest install) - classic reinstall'
    Push-Location C:\src
    & C:\src\vcpkg\vcpkg.exe install libvpx:x86-windows-static libyuv:x86-windows-static aom:x86-windows-static opus:x86-windows-static libjpeg-turbo:x86-windows-static libsodium:x86-windows-static --overlay-ports=C:\src\ChainRemote\res\vcpkg
    Pop-Location
    if (-not (Test-Path $vpxHeader)) { Write-Host 'AGENT32-FAIL: x86 vcpkg deps install (vpx header still missing)'; exit 1 }
}
Write-Host '    x86 vcpkg deps OK'

# ★ inline feature 의 Sciter UI(cm.tis/index.tis 등)는 res/inline-sciter.py 가 src/ui/inline.rs
#   (.gitignore, untracked 생성물) 로 구워넣는다. 빠뜨리면 옛 inline.rs 로 조용히 빌드(거짓 OK).
Write-Host '[4/7] regen Sciter inline.rs (bake cm.tis/index.tis changes)'
python res/inline-sciter.py
if ($LASTEXITCODE -ne 0) { python3 res/inline-sciter.py }
if (-not (Test-Path 'src/ui/inline.rs')) { Write-Host 'AGENT32-FAIL: inline.rs not generated (check python / res/inline-sciter.py)'; exit 1 }
$tisTime = (Get-Item 'src/ui/cm.tis').LastWriteTime
$inlineTime = (Get-Item 'src/ui/inline.rs').LastWriteTime
if ($inlineTime -lt $tisTime) { Write-Host 'AGENT32-FAIL: inline.rs older than cm.tis (regen did not run)'; exit 1 }
Write-Host '    inline.rs regen OK'

Write-Host '[5/7] clean libsodium-sys + i686 build (inline sciter, no hwcodec)'
cargo +1.75 clean -p libsodium-sys
$cfg1 = "target.i686-pc-windows-msvc.sodium.rustc-link-search=['native=C:/src/vcpkg/installed/x86-windows-static/lib']"
$cfg2 = "target.i686-pc-windows-msvc.sodium.rustc-link-lib=['static=libsodium']"
cargo +1.75 build --target i686-pc-windows-msvc --release --features inline --config $cfg1 --config $cfg2
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: cargo build'; exit 1 }
Write-Host 'AGENT32-BUILD-OK'

Write-Host '[6/7] PE check (machine=0x014C + subsystem min) + smoke'
$fs = [System.IO.File]::OpenRead($exe)
$br = New-Object System.IO.BinaryReader($fs)
$null = $fs.Seek(0x3C, 'Begin'); $peOff = $br.ReadInt32()
$null = $fs.Seek($peOff + 4, 'Begin'); $machine = $br.ReadUInt16()
$null = $fs.Seek($peOff + 24 + 48, 'Begin'); $ssMaj = $br.ReadUInt16(); $ssMin = $br.ReadUInt16()
$br.Close(); $fs.Close()
Write-Host ('machine=0x{0:X4} subsystem-min={1}.{2}' -f $machine, $ssMaj, $ssMin)
if ($machine -ne 0x014C) { Write-Host 'AGENT32-FAIL: not 32-bit PE'; exit 1 }
if ($ssMaj -gt 6 -or ($ssMaj -eq 6 -and $ssMin -gt 1)) { Write-Host 'AGENT32-FAIL: subsystem min > 6.1 (Win7 rejected)'; exit 1 }
& $exe --version
& $exe --get-id
Write-Host ('smoke exit=' + $LASTEXITCODE)

Write-Host '[7/7] stage payload (agent32-payload = x86 side of unified installer)'
Remove-Item -Recurse -Force $payload -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item $exe (Join-Path $payload 'ChainRemote.exe') -Force
Copy-Item $sciterDll $payload -Force
Copy-Item 'C:\src\ChainRemote\deploy\custom-agent.txt' (Join-Path $payload 'custom.txt') -Force
foreach ($f in Get-ChildItem $payload) { Write-Host ('    staged: ' + $f.Name) }
Write-Host 'AGENT32-STAGE-OK'

# [+] Win7 runtime app-local bundle (UCRT + VC++ x86) into the payload, so a clean
#   (un-updated) Win7 32-bit POS can RUN the exe. The installer [Files] globs the
#   payload dir, so these DLLs ride along automatically. Best-effort: warn (not fail)
#   if SDK/VS not found - the post-build verify step gates self-containment.
Write-Host '[+] bundle Win7 runtime (UCRT + VC++ x86) into payload'
try {
  & 'C:\src\ChainRemote\deploy\win-build\bundle-win7-runtime.ps1' -ReleaseDir $payload -Arch x86
} catch {
  Write-Host ('AGENT32-WARN: win7 runtime bundle failed (clean Win7 may not run): ' + $_.Exception.Message)
}

Write-Host 'AGENT32-ALL-DONE'
