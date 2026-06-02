# ChainRemote iOS HQ 빌드 (Mac 전용)

> 1단계 = **브랜딩만**. HQ 로그인/즐겨찾기는 데스크탑 전용 → 모바일은 stock RustDesk UI
> (거래처 9자리 ID 직접 입력 → 접속, 1회 접속 후 '최근 세션'에 남음). 2단계에서 포팅 예정.

빌드/서명/기기 설치는 **반드시 Mac(Xcode)** 에서. 리눅스/원격 컨테이너 불가.

## 이미 소스에 적용된 브랜딩 (이 브랜치)

| 항목 | 값 |
|---|---|
| 표시명 (CFBundleDisplayName/Name) | `ChainRemote` |
| Bundle ID (PRODUCT_BUNDLE_IDENTIFIER ×3) | `com.betaposlab.chainremote` |
| URL scheme | `rustdesk://` 유지 (딥링크 호환, macOS 동일 정책) |
| 아이콘 | `res/icon.png` (ChainRemote 마크) → 자동 생성 설정 완료 |
| hbbs/relay 서버 | `sepani.synology.me` (코어 `hbb_common` 컴파일 타임 하드코딩 → 자동 상속) |
| API base | `sepani.synology.me:3443` (`src/chainremote_auth.rs` → 자동 상속) |

## Chang 가 Mac 에서 할 일

### 1. 서명 팀 설정 (필수 — 현재 RustDesk 팀 `HZF9JMC8YN` 으로 박혀 있음)
- `flutter/ios/Runner.xcodeproj` 를 Xcode 로 열기
- Runner 타깃 → Signing & Capabilities → Team = **본인 Apple Developer 계정**
- Automatic signing 켜면 `DEVELOPMENT_TEAM` 자동 갱신됨
- (TestFlight/App Store 배포 시) `flutter/ios/exportOptions.plist` 의 `teamID` + 프로비저닝 프로필명도 본인 것으로

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

## 알려진 미해결 / 2단계 예정
- HQ 로그인(chang/jaesung) + 관리패널 즐겨찾기(`/api/me/favorites`) 모바일 포팅 → 2단계
- 모바일은 현재 즐겨찾기 서버 동기화 없음 → 첫 접속은 ID 수동 입력
