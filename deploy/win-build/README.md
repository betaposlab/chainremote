# 윈컴 빌드 환경 자동 구축

거래처 배포용 ChainRemote.exe 빌드를 위한 윈컴 환경 셋업.

## 빌드되는 ChainRemote.exe의 특성

- **하드코딩된 NAS 서버**: `sepani.synology.me` (`libs/hbb_common/src/config.rs:159`)
- **하드코딩된 공개키**: `C2bqeqG0Nb0EQgmtomhzcykw69gRvbSLKfm019r1C8Y=` (`config.rs:160`)
- **결과**: 거래처가 `RustDesk2.toml` 같은 config 파일 없이 .exe 더블클릭만 해도 우리 NAS에 등록됨

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

1. 빌드한 `rustdesk-<version>-install.exe` 를 carename(거래처에 보낼 이름)으로 rename
2. 거래처에 카톡/이메일/USB로 전달
3. 거래처가 더블클릭 → 자동 설치 + 우리 NAS에 자동 등록
4. 거래처 ID를 우리에게 전화로 1회 전달 → 관리 패널 DB 등록
5. 그 후엔 우리가 언제든 무인 접속 가능 (윈컴 영구 비번 사전 설정 필요)

## 알려진 이슈

- **Visual Studio Build Tools 설치 실패 시**: 수동으로 Visual Studio Installer 열어서
  "C++를 사용한 데스크톱 개발" 워크로드 설치
- **Flutter 패치**: 스크립트가 자동 적용. SDK 재설치 시 수동 적용:
  `binding.dart` 안의 `_setFramesEnabledState(false);` 를 주석 처리
- **vcpkg install 실패**: 인터넷 끊김 또는 디스크 공간 부족. 재실행하면 이어짐.
