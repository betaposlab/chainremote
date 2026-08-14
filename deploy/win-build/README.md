# 윈컴 빌드 환경 자동 구축

거래처 배포용 ChainRemote.exe 빌드를 위한 윈컴 환경 셋업.

## 빌드되는 ChainRemote.exe의 특성

- **하드코딩된 시그널링 서버**: `rs.626.kr` (`libs/hbb_common/src/config.rs` `RENDEZVOUS_SERVERS`)
- **하드코딩된 공개키**: `C2bqeqG0Nb0EQgmtomhzcykw69gRvbSLKfm019r1C8Y=` (같은 파일 `RS_PUB_KEY`)
- **결과**: 거래처가 `RustDesk2.toml` 같은 config 파일 없이 .exe 더블클릭만 해도 우리 서버에 등록됨

> 줄 번호 대신 상수 이름으로 적어 둔다 — 종전엔 `config.rs:159` 로 적혀 있었는데 그 사이
> 파일이 밀려 엉뚱한 줄을 가리켰고, 값도 NAS 시절 `sepani.synology.me` 로 굳어 있었다.

## 사용

### 1. 빌드 환경 설치 (한 번만)

윈컴에서 **관리자 권한 PowerShell** 열고:

```powershell
iex (irm https://raw.githubusercontent.com/betaposlab/chainremote/master/deploy/win-build/setup-build-env.ps1)
```

또는 repo 클론한 상태라면:

```powershell
.\deploy\win-build\setup-build-env.ps1
```

설치되는 것:
- Chocolatey
- Visual Studio 2022 Build Tools (MSVC C++)
- Rust 1.81 (rustup)
- Git, Python 3, CMake, LLVM, NASM, 7-Zip, pkgconfiglite
- Flutter 3.24.5 (`C:\src\flutter-3.24.5`) + RustDesk 호환 패치
- vcpkg (`C:\src\vcpkg`) + libvpx/libyuv/opus/aom (x64-windows-static)
- flutter_rust_bridge_codegen 1.80.1

소요: 30~60분 (다운로드 시간)

### 2. ChainRemote 빌드

```powershell
cd C:\src
git clone https://github.com/betaposlab/chainremote.git ChainRemote
cd ChainRemote
git submodule update --init --recursive
python build.py --flutter --portable
```

소요: 30~60분 (첫 빌드)

### 3. 결과물

- `ChainRemote\rustdesk-<version>-install.exe` ← **거래처 배포용 단일 인스톨러**
- `ChainRemote\flutter\build\windows\x64\runner\Release\ChainRemote.exe` ← 빌드된 본체

## 거래처 배포 흐름

이 문서는 ChainRemote 코어 **풀빌드**만 다룬다. 빌드 산출물로 거래처/본사 인스톨러를 만드는 배포·운영 흐름(agent/hq 분리, **click 수락 정책**)은 [deploy/win-installer/README.md](../win-installer/README.md) 참조.

## 알려진 이슈

- **Visual Studio Build Tools 설치 실패 시**: 수동으로 Visual Studio Installer 열어서
  "C++를 사용한 데스크톱 개발" 워크로드 설치
- **Flutter 패치**: 스크립트가 자동 적용. SDK 재설치 시 수동 적용:
  `binding.dart` 안의 `_setFramesEnabledState(false);` 를 주석 처리
- **vcpkg install 실패**: 인터넷 끊김 또는 디스크 공간 부족. 재실행하면 이어짐.

## v1.2.7 풀빌드(--hwcodec)에서 만난 함정 7가지 (2026-05-14, 영구 픽스 commit 완료)

다음 빌드 셋업 시 미리 회피하기 위한 체크리스트. 모두 repo에 반영돼 있음 — 인프라가 깨질 때 디버그 단서로 활용.

1. **vcpkg classic 모드 → manifest 모드 강제**
   - `setup-build-env.ps1`가 `vcpkg install <name>` 으로 깔면 `res/vcpkg/` 의 RustDesk 오버레이 포트(aom 패치, ffmpeg)가 무시됨.
   - 픽스: ChainRemote 루트(vcpkg.json 위치)에서
     `vcpkg install --triplet x64-windows-static --host-triplet x64-windows-static --x-install-root=$VCPKG_ROOT/installed`

2. **host-triplet 불일치 → ffmpeg avcodec.lib 부재**
   - vcpkg.json 의 ffmpeg가 `host=true` → 기본 host-triplet(x64-windows)에 깔리고 target(x64-windows-static)에 lib 없음.
   - 픽스: `--host-triplet=x64-windows-static` 강제.

3. **LLVM 22.x → bindgen ABI 깨짐**
   - choco가 최신 LLVM 깔면 bindgen libclang API와 ABI 불일치 → aom 구조체가 opaque(`{ _address: u8 }`)로 잘못 생성.
   - 픽스: **LLVM 18.1.8** 로 핀.

4. **patch-hwcodec.py swresample 패치 = Mac 전용**
   - Windows RustDesk ffmpeg 오버레이가 `--disable-swresample --disable-swscale` 명시. OS 무관하게 swresample 링크 추가하면 .lib 부재로 link 실패.
   - 픽스: Mac에서만 적용(homebrew/vcpkg ffmpeg가 swresample 포함, opus 디코더 swr_* 호출).

5. **build.py entry exe 이름 충돌**
   - `CMakeLists.txt`의 `BINARY_NAME`은 "rustdesk" 유지(코멘트에 명시). `build.py`가 `ChainRemote.exe` 박혀있어서 `generate.py`가 못 찾음.
   - 픽스: build.py에서 `rustdesk.exe` 로 정정.

6. **Windows의 `python3` = Microsoft Store stub**
   - `system2('python3 generate.py')` 가 무음 종료.
   - 픽스: build.py의 `system2`가 win32에서 `python3 ` 접두를 `sys.executable` 로 자동 치환.

7. **build-iss.ps1 결과물 검증 파일명**
   - `installer.iss`가 `OutputBaseFilename=ChainRemote_Setup_v{version}` 로 빌드하는데 검증은 옛 이름 `ChainRemote_Setup.exe` 를 찾음.
   - 픽스: 가장 최근 `ChainRemote_Setup_v*.exe` 로 변경.

## 툴바 아이콘 tofu(빈 사각형) — `--no-tree-shake-icons` 누락 (2026-05-19)

- 증상: 원격 세션 툴바 아이콘이 식별불가 단색 사각형. RustDesk의 동적 IconData(조건부 `Icons.a/b`)를 `flutter build --release` 기본 트리셰이킹이 제거.
- 원인: `build.py` 의 4개 `flutter build (win/mac/linux) --release` 라인에 `--no-tree-shake-icons` 부재(회귀 아님, 원래부터 없었음).
- 픽스: 커밋 02165c658 — 4개 라인 전부 `--no-tree-shake-icons` 추가. 다음 빌드부터 정상.
- 교훈: "툴바/아이콘 깨짐" 신고 시 첫 의심 = tree-shake-icons. **코드가 아니라 빌드플래그**.

## Mac 측 --hwcodec 미빌드 (별도 이슈, 미해결)

- 현재 Mac ChainRemote는 `--hwcodec` 없이 빌드됨 (CLAUDE.md 빌드 명령 참조).
- 영향: Mac↔윈컴 코덱 협상에서 H264 까지만 보임. H265는 메뉴엔 보이지만 실제 협상 안 됨.
- 향후: Mac도 `--hwcodec` 빌드해야 H265 협상 가능. 윈컴과 비슷한 패턴(vcpkg ffmpeg, `patch-hwcodec.py` Mac 분기 — swresample 포함, 이미 정비됨).
