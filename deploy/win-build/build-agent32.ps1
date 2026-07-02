# Agent32 빌드 — 32비트(i686) Sciter 에이전트 + 페이로드 스테이징.
#
# 통합 인스톨러 파이프라인의 한 단계 (2026-06-10~):
#   [1] build-all.ps1            -> x64 Flutter 빌드
#   [2] 이 스크립트              -> i686 Sciter 빌드 + agent32-payload 스테이징
#   [3] ISCC agent-installer.iss -> 통합 ChainRemote_Agent_Setup_v*.exe (x64+x86 동봉, OS 가 자동 선택)
#
# Rust 1.75 고정 (건드리지 말 것):
#   - upstream 핀 SCITER_RUST_VERSION="1.75". Rust 1.78+ 의 i128 ABI 변경이 sciter.dll
#     인터롭을 깨뜨린다 (flutter-build.yml:21 주석, blog.rust-lang.org 2024-03-30).
#   - Rust <=1.77 의 std 만 Win7 을 지원한다 (1.78 부터 Win10+ 전용).
#   1.75 한 벌로 Sciter ABI 안전 + Win7·Win10 32비트 커버가 동시에 된다.
#
# x86 vcpkg 충돌 자동 복원 ([3/7]):
#   build-all.ps1(x64) 의 vcpkg manifest install 이 installed/ 를 vcpkg.json 기준으로 재구성하면서
#   classic 으로 깔아둔 x86-windows-static 을 통째로 날린다(공유 installed/ 충돌). 그래서 이 스크립트가
#   빌드 직전 x86 의존성을 멱등하게 보장한다(없으면 classic 재설치). binary cache 덕에 보통 수 분.
#
# 사전 조건: vcpkg(C:\src\vcpkg), x86 sciter.dll(C:\src\sciter_x32\sciter.dll), LLVM, Python.
#
# ⚠ Write-Host 메시지는 ASCII only. powershell -File 은 한국어 윈도우에서 파일을 CP949 로 읽어
#   비ASCII 문자열 리터럴이 있으면 ParserError 가 난다. 주석(# 뒤) 한글은 파싱 무관이라 그대로 둔다.
#
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File build-agent32.ps1
# 실증: 2026-06-10 실물 POS (Win7 Enterprise SP1 32비트, Smartro/Atom D2550) 전 구간 검증 통과.

$ErrorActionPreference = 'Continue'   # EAP Stop + native stderr 함정 회피 — 판정은 exit code 로
Set-Location C:\src\ChainRemote
# rustup shim(~/.cargo/bin) 을 PATH 최우선으로 둔다. 'cargo +1.75' 의 +toolchain 셀렉터는
#   rustup shim 만 이해한다. build-all.ps1 을 같은 세션에서 먼저 돌리면 1.81 toolchain 의 bin 이
#   PATH 앞에 박혀 shim 을 가리고 'error: no such command: +1.75' 로 죽는다(통합빌드 함정).
#   shim 을 다시 맨 앞에 둬서 단독·연속 실행 모두 안전하게.
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

# x86 vcpkg deps (no-hwcodec 라 ffmpeg/mfx-dispatch 제외). repo 밖에서 실행 = classic 모드(manifest 회피).
Write-Host '[3/7] ensure x86 vcpkg deps (libvpx/libyuv/aom/opus/libjpeg-turbo/libsodium)'
if (-not (Test-Path $vpxHeader)) {
    Write-Host '    x86 deps missing (likely wiped by x64 manifest install) - classic reinstall'
    Push-Location C:\src
    & C:\src\vcpkg\vcpkg.exe install libvpx:x86-windows-static libyuv:x86-windows-static aom:x86-windows-static opus:x86-windows-static libjpeg-turbo:x86-windows-static libsodium:x86-windows-static --overlay-ports=C:\src\ChainRemote\res\vcpkg
    Pop-Location
    if (-not (Test-Path $vpxHeader)) { Write-Host 'AGENT32-FAIL: x86 vcpkg deps install (vpx header still missing)'; exit 1 }
}
Write-Host '    x86 vcpkg deps OK'

# inline feature 의 Sciter UI(cm.tis/index.tis 등)는 res/inline-sciter.py 가 src/ui/inline.rs
#   (.gitignore, untracked 생성물)로 구워넣는다. 빠뜨리면 옛 inline.rs 로 조용히 빌드된다(거짓 OK).
Write-Host '[4/7] regen Sciter inline.rs (bake cm.tis/index.tis changes)'
python res/inline-sciter.py
if ($LASTEXITCODE -ne 0) { python3 res/inline-sciter.py }
if (-not (Test-Path 'src/ui/inline.rs')) { Write-Host 'AGENT32-FAIL: inline.rs not generated (check python / res/inline-sciter.py)'; exit 1 }
$tisTime = (Get-Item 'src/ui/cm.tis').LastWriteTime
$inlineTime = (Get-Item 'src/ui/inline.rs').LastWriteTime
if ($inlineTime -lt $tisTime) { Write-Host 'AGENT32-FAIL: inline.rs older than cm.tis (regen did not run)'; exit 1 }
Write-Host '    inline.rs regen OK'

Write-Host '[5/7] clean (libsodium-sys + clipboard + main bin) + i686 build (inline sciter, no hwcodec)'
# HARDENING (2026-06-18): cargo 증분 relink 가 libs/* 의 소스 수정을 놓쳐 STALE rustdesk.exe 를
#   내보낼 수 있다. 실제로 cliprdr 수정(ff9787343)이 소스엔 있는데 v1.4.23 agent32 빌드엔 빠졌다.
#   수정된 crate + 메인 bin 을 강제 clean 해서 이 타깃에 대해 반드시 재컴파일/relink 하게 하고,
#   이전 산출물도 지운다 — 빌드가 스킵/실패하면 옛 바이너리를 조용히 내보내는 대신 [6/7] 가드에 걸리도록.
cargo +1.75 clean -p libsodium-sys
cargo +1.75 clean --target i686-pc-windows-msvc -p clipboard -p rustdesk
Remove-Item -Force $exe -ErrorAction SilentlyContinue
$cfg1 = "target.i686-pc-windows-msvc.sodium.rustc-link-search=['native=C:/src/vcpkg/installed/x86-windows-static/lib']"
$cfg2 = "target.i686-pc-windows-msvc.sodium.rustc-link-lib=['static=libsodium']"
cargo +1.75 build --target i686-pc-windows-msvc --release --features inline --config $cfg1 --config $cfg2
if ($LASTEXITCODE -ne 0) { Write-Host 'AGENT32-FAIL: cargo build'; exit 1 }
Write-Host 'AGENT32-BUILD-OK'
if (-not (Test-Path $exe)) { Write-Host 'AGENT32-FAIL: exe not produced (stale/skipped build guard)'; exit 1 }

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

# [+] Win7 런타임(UCRT + VC++ x86)을 payload 에 app-local 동봉 — 갓 설치한(미업데이트) Win7
#   32비트 POS 에서도 exe 가 실행되게. 인스톨러 [Files] 가 payload 폴더를 통째로 싸므로 이 DLL 들이
#   자동으로 딸려간다. best-effort: SDK/VS 못 찾으면 실패가 아니라 경고만 — self-contained 여부는
#   빌드 후 검증 단계가 최종 판정한다.
Write-Host '[+] bundle Win7 runtime (UCRT + VC++ x86) into payload'
try {
  & 'C:\src\ChainRemote\deploy\win-build\bundle-win7-runtime.ps1' -ReleaseDir $payload -Arch x86
} catch {
  Write-Host ('AGENT32-WARN: win7 runtime bundle failed (clean Win7 may not run): ' + $_.Exception.Message)
}

Write-Host 'AGENT32-ALL-DONE'
