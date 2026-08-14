# ChainRemote iOS HQ 빌드 (Mac 전용)

> **현황**: 1단계(브랜딩) + 2단계(HQ 로그인 게이트 + 즐겨찾기) 코드 커밋 완료. 현재 브랜치에서 호환성 검증 중.
> 데스크탑→모바일 즐겨찾기 서버 동기화 일부가 남음(아래 참조).

빌드/서명/기기 설치는 **반드시 Mac(Xcode)** 에서. 리눅스/원격 컨테이너 불가.

## 이미 소스에 적용된 브랜딩 (이 브랜치)

| 항목 | 값 |
|---|---|
| 표시명 (CFBundleDisplayName/Name) | `ChainRemote` |
| Bundle ID (PRODUCT_BUNDLE_IDENTIFIER ×3) | `com.betaposlab.chainremote` |
| URL scheme | `rustdesk://` 유지 (딥링크 호환, macOS 동일 정책) |
| 아이콘 | `res/icon.png` (ChainRemote 마크) → 자동 생성 설정 완료 |
| hbbs/relay 서버 | `rs.626.kr` (코어 `hbb_common` 컴파일 타임 하드코딩 → 자동 상속) |
| API base | `https://api.626.kr` (`src/chainremote_auth.rs` → 자동 상속) |

## Chang 가 Mac 에서 할 일

### 1. 서명 팀 (이미 박힘 — `DEVELOPMENT_TEAM = 5Q25RTUTDW`, changhyun kim 개인)
- Xcode 로 `flutter/ios/Runner.xcodeproj` 열면 Signing & Capabilities 에 본인 팀 자동 선택됨
- 처음 한 번은 Xcode 가 개발 인증서/프로비저닝 프로필을 자동 발급 (로그인 상태면 자동)
- (App Store/TestFlight 배포 시) `flutter/ios/exportOptions.plist` 의 프로비저닝 프로필명만 실제 것으로

### 2. 아이콘 생성 (1회)
```bash
cd flutter
flutter pub get
flutter pub run flutter_launcher_icons   # res/icon.png → iOS AppIcon 자동 생성
```

### 3. Rust iOS 코어 빌드 + 앱 빌드
- iOS 타깃 Rust 코어(aarch64-apple-ios) 크로스컴파일 필요. RustDesk iOS 빌드 절차 따름.
- CocoaPods: `cd flutter/ios && pod install`
- 빌드: `cd flutter && flutter build ipa --release` (또는 Xcode 에서 직접 Run → 본인 iPhone)
- 본인 폰에만 넣을 거면 **Xcode → 기기 선택 → Run** 이 가장 빠름 (개발 프로비저닝).

### 4. 검증 체크리스트
- [ ] 홈 화면 앱 이름 = ChainRemote, 아이콘 = 파란 마크
- [ ] 앱 실행 → 거래처 9자리 ID 입력 → 수락 → 화면 보임
- [ ] 접속한 거래처가 '최근 세션' 에 남는지

## 알려진 미해결 / 검증 중
- HQ 로그인(chang/jaesung) + 즐겨찾기 게이트 = **코드 커밋됨** (`feat(mobile): HQ 로그인 게이트 + 즐겨찾기`). 실기기 검증 진행 중.
- 데스크탑→모바일 즐겨찾기 서버 동기화 포팅 일부 남음 → 그 전까지 첫 접속은 ID 수동 입력 fallback.
