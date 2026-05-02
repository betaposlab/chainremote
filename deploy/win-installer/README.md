# 거래처 배포용 NSIS 인스톨러

`ChainRemote_Setup.exe` 단일 파일 인스톨러를 생성한다.

## 결과물 동작

거래처가 `ChainRemote_Setup.exe` 더블클릭 시:

1. RustDesk 공식 코어를 사일런트 설치 (서명된 공식 바이너리)
2. `C:\Program Files\ChainRemote\ChainRemote.exe` 로 복사 (UI 친숙성)
3. `%APPDATA%\RustDesk\config\RustDesk2.toml` 에 우리 NAS(`sepani.synology.me`) 서버 정보 자동 배치
4. 시작 메뉴 + 바탕화면 단축아이콘
5. HKLM Run 자동 시작 등록 (부팅 시 트레이로 자동 실행)
6. 프로그램 추가/제거 등록 (정식 인스톨러로 인식)
7. (선택) Finish 페이지에서 ChainRemote 실행

설치 후 거래처 손이 가는 일 = **본사에 ID 알리고, 본사가 알려준 영구 비밀번호 한 번 설정**.

## 빌드 방법

### Mac에서는 빌드 불가
Mac 브루의 `makensis` 가 macOS Tahoe 에서 std::bad_alloc 으로 실패함. 윈컴 빌드만 가능.

### 윈컴에서 빌드 (관리자 권한 PowerShell)

```powershell
cd C:\src\ChainRemote
git pull
.\deploy\win-installer\build-on-win.ps1
```

자동 진행:
1. NSIS 가 없으면 Choco 로 설치
2. RustDesk 공식 인스톨러(23MB) 가 폴더에 없으면 GitHub releases 에서 다운로드
3. `makensis installer.nsi` 실행 → `ChainRemote_Setup.exe` 생성

소요: 1~3분 (NSIS 미설치 시 +5분)

## 배포 파일

| 파일 | 역할 | 크기 | git 추적 |
|------|------|------|---------|
| `installer.nsi` | NSIS 빌드 스크립트 | 4 KB | ✅ |
| `RustDesk2.toml` | NAS 서버 설정 (배포에 들어감) | 0.4 KB | ✅ |
| `build-on-win.ps1` | 윈컴 빌드 자동화 | 2 KB | ✅ |
| `rustdesk-1.4.6-x86_64.exe` | RustDesk 공식 인스톨러 (페이로드) | 23 MB | ❌ (다운로드) |
| `ChainRemote_Setup.exe` | 빌드 산출물 | ~24 MB | ❌ (재빌드) |

## SmartScreen 경고 (현 단계 한계)

빌드한 `ChainRemote_Setup.exe` 자체엔 코드 서명이 없음. 거래처 첫 실행 시 Windows Defender SmartScreen 가 "확인되지 않은 게시자" 경고를 띄울 수 있음.

해결 옵션:
- **EV 코드 서명 인증서 구매** (~$300/년, Sectigo/DigiCert) → 경고 즉시 사라짐. 사업화 단계 정석.
- **무시 + 시간 흐름**: 충분히 많은 거래처가 "그래도 실행" 누르면 Microsoft Reputation 시스템이 자동 학습 → 경고 사라짐.
- **현재 권장**: 첫 거래처들에게 "추가 정보 → 실행" 절차 안내. 한 번만 거치면 끝.

내부 페이로드인 RustDesk 공식 .exe 는 정식 서명되어 있어 사일런트 설치 단계에서는 문제 없음.

## 거래처 운영 흐름 (이 인스톨러 활용)

1. **본사**: `ChainRemote_Setup.exe` 카톡/이메일/USB 로 거래처에 전달
2. **거래처**: 더블클릭 → 설치 → ChainRemote 자동 실행
3. **거래처**: 화면에 표시된 ID (예: `123 456 789`) 를 본사에 카톡/전화로 알림
4. **본사**: 관리 패널에서 그 ID 와 거래처 정보 등록 + 거래처별 영구 비밀번호 발급 + 거래처에 비번 알림
5. **거래처**: 받은 비번을 [설정 > 보안 > 영구 비밀번호 설정] 에 한 번만 입력
6. **그 후 영원히**: 거래처 PC 켜져 있으면 본사가 0클릭으로 무인 접속 가능

## 다음 개선 (Step C 후속)

- 거래처별 비밀번호 자동 생성 + 관리 패널 DB 저장
- Finish 페이지에 ID 자동 표시 + 자동 카톡/이메일 보내기 버튼
- 코드 서명 인증서 구매 + signtool 자동화
- 진짜 ChainRemote 브랜드로 RustDesk 본체 재빌드 (Step C 정식)
