# ChainRemote — 완료된 작업 + 이슈 트래커 + 사업화 history

> 매 세션 필수가 아닌 옛 사고/완료 기록. 새 사고 진단 시 패턴 매칭용.
> 매 세션 필수 정보는 [CLAUDE.md](../../CLAUDE.md) 참조.

## 이슈 트래커

### ✅ 이슈 1: 인스톨러 toml 경로 (LICENSE_MISMATCH) — 해결 (v1.2.0, 2026-05-06)
- **증상이었던 것**: `ChainRemote_Setup.exe` 로 깐 PC가 ID/릴레이/Key 필드 비어 있음. POS→Mac 시도 시 "키가 일치하지 않습니다".
- **근본 원인** ([config.rs:484-485](../../libs/hbb_common/src/config.rs)): RustDesk가 서비스 모드로 구동되면 `C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\` 를 읽는데, 옛 인스톨러는 `%APPDATA%\RustDesk\config\` 만 박았음 → 서비스가 빈 key로 등록 시도.
- **영구 해결**: v1.2.0 인스톨러가 toml 3종을 사용자/LocalService 두 경로 동시 배치. 인스톨 중 `sc stop`→toml 복사→`sc start` 순서. 영구 비번 평문→자동해싱, `access-mode=full`, 디스플레이/원격커서/음소거/파일복사 기본값도 같이 적용.

### ✅ 이슈 2: 외부망에서 관리 패널 도달 — 해결 (2026-05-20, HTTP 3001 직노출)
- **증상이었던 것**: Mac을 사무실로 가져가면 `localhost:3000/customers` 에서 `connect ETIMEDOUT 192.168.68.103:15432`.
- **채택한 해결**: NAS 라우터에 포트 포워딩 `3001 → 192.168.68.103:3001` (TCP). 본사 앱 `DEFAULT_API_BASE = http://sepani.synology.me:3001`. Tailscale 불필요. 어디서나 도달.
- **HTTPS 보류**: Synology Reverse Proxy 의 3443(HTTPS) 셋업은 동작하지만, RustDesk core 의 `reqwest/rustls` 가 Synology nginx 와 TLS close_notify quirk 로 매번 끊김. native-tls fallback 도 실패 (Error -9806). HTTP 직노출이 안정적.
- **DB 직접 노출 안 함**: PostgreSQL 15432 은 LAN/Tailscale 만. 패널이 게이트.

### ✅ AUTH_SECRET 통일 함정 (2026-05-20)
- Mac 로컬 dev 패널 `.env.local` 의 `AUTH_SECRET` 이 NAS 컨테이너 `.env` 의 값과 달랐음 → 로컬 dev 가 발급한 토큰을 NAS 가 검증 실패 ("토큰 검증 실패" 401). NAS 의 secret 을 진실 원천으로 통일. NAS 의 `.env` 가 master. 로컬 dev 도 같은 값 박을 것.

### ⏳ 이슈 3: 외부망 P2P / 릴레이 / Mac TCC 재검증 — 미해결
- 윈컴↔Mac 동작 확인은 같은 LAN(P2P 직결)에서만. 외부망(릴레이 경유)에서 검증 안 됨. 이슈 2 해결 후 외부망에서 재검증 필요.

---

## 완료된 작업 history

- ✅ Step 1 Mac: 빌드 환경 + 첫 빌드 + 윈컴 원격 테스트
- ✅ Step 2 부분: UI 텍스트/아이콘/색상 (ChainRemote 가시화)
- ❌ Step 4 웹클라: 검증 결과 폐기 (옵션 C로 전환)
- ✅ Step 3 시그널링/릴레이: NAS Docker로 hbbs/hbbr 가동 (`sepani.synology.me`, 포트 21115-21118 외부 노출 검증)
- ✅ Step 5 골격: Next.js 관리 패널, 멀티테넌시 DB 스키마, 거래처 목록
- ✅ End-to-end 1-클릭 원격: 관리 패널 → rustdesk:// URL → Mac 앱 → 윈컴 연결
- ✅ 무인 접속 모드: 영구 비번 + 부팅 자동 시작 + approve-mode=password
- ✅ **Step C 거래처 배포 인스톨러**: Inno Setup 으로 `ChainRemote_Setup.exe` 단일 파일 (2026-05-02)
- ✅ **첫 ChainRemote 자체 개선**: 원격 세션 툴바에 파일 전송 버튼 (Mac 빌드 검증) (2026-05-02)
- ✅ **인스톨러 v1.2.0 — LICENSE_MISMATCH 근본 픽스** (2026-05-06)
- ✅ **자동 업데이트 시스템 B-1** (2026-05-06): `src/chainremote_updater.rs` — 서비스에서 24h 폴링, SHA256 검증, 활성 세션 없을 때 사일런트 적용. 본사 측 `deploy/release.sh`로 NAS 푸시.
- ✅ **v1.2.7 윈컴 풀빌드 함정 7가지 영구 픽스** (2026-05-14): vcpkg manifest 모드, host-triplet 강제, LLVM 18 핀, swresample 패치 Mac 전용 분기, build.py python3 stub 우회 등. 상세는 [deploy/win-build/README.md](../../deploy/win-build/README.md).
- ✅ **툴바 아이콘 tofu 픽스** (2026-05-19, 02165c658): `build.py`의 `flutter build --release` 4개 라인에 `--no-tree-shake-icons` 추가.
- ✅ **watchdog 강화 + v1.2.18 배포** (2026-05-20)
- ✅ **빌드+배포 원샷 자동화** (2026-05-20, 커밋 8a7da53b9): SSH/Tailscale 경유.
- ✅ **Phase 2-E/F 본사 협업 완성** (2026-05-20): 메인 "내 ID 큰 표시" 폐기. NAS Container Manager 패널 운영. Mac 본사 앱 외부망 검증. AUTH_SECRET 통일. Next 16 `proxy.ts` 대응. presence 폐기.
- ✅ **Phase 1 단계 1~4 Mac 본사 빌드 완성** (2026-05-20)
- ✅ **Phase 3-Mac** (2026-05-25): PRODUCT_NAME = ChainRemote + Bundle ID com.betaposlab.chainremote. .app 출력이 ChainRemote.app.
- ✅ **Phase 3-Win** (2026-05-25~26): BINARY_NAME=ChainRemote + APP_NAME=ChainRemote. 마이그레이션 모듈 + 옛 RustDesk 정리. 영구비번 IPC 깨짐 fix.
- ✅ **AGPL v3 준수** (2026-05-25): About 화면에 ChainRemote 소스 URL + 변경 내역 링크. README + CHAINREMOTE_CHANGES.md 신규.
- ✅ **로그인 화면 디자인 quick win** (2026-05-26): 워드마크, 카드 그림자, 입력란 focus, footer, 서버 URL 제거.
- ✅ **GitHub Actions 정리** (2026-05-26): nightly cron 비활성화 + 옛 artifact 31개 삭제 (582 MB 회수).

---

## 거래처 배포 인스톨러 (Step C 정석, 2026-05-02 완성, Phase 3-Win 으로 갱신)

**결과물**: `ChainRemote_Agent_Setup_v*.exe` + `ChainRemote_HQ_Setup_v*.exe` 두 종

**파이프라인** (윈컴에서):
```powershell
cd C:\src\ChainRemote\deploy\win-installer
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" agent-installer.iss
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" hq-installer.iss
```

**인스톨러 동작** (Phase 3-Win 이후):
1. ChainRemote 코어 사일런트 설치 → `C:\Program Files\ChainRemote\ChainRemote.exe` + `ChainRemote Service` 등록
2. `RustDesk2.toml`/`RustDesk2-agent.toml` 을 `%APPDATA%\ChainRemote\config\` + LocalService 양쪽 배치
3. ChainRemote 가 첫 실행 시 `chainremote_migrate.rs` 가 옛 RustDesk → ChainRemote 데이터/서비스/레지스트리/단축아이콘 마이그레이션
4. ChainRemote.lnk 단축아이콘 자동 생성 (APP_NAME 따라감)
5. 첫 실행 → ID 발급 → NAS 자동 등록

**우회한 함정들** (이 길로 가다가 실패한 것들):
- ❌ 파일명 `host=,key=` 인코딩 — 동작은 하지만 거래처 보기 흉함
- ❌ Mac 빌드 NSIS — `makensis` macOS Tahoe std::bad_alloc 크래시
- ❌ Mac 7-Zip SFX — 매니페스트 인젝션은 됐으나 SFX 모듈이 RunProgram 미지원
- ❌ `--silent-install` 권한 부재 → portable 모드로 떨어짐
- ❌ `ChainRemote.exe` 별도 폴더 복사 → Flutter plugin DLL 못 찾음
- ✅ Inno Setup → atomic rename → 깨끗하게 동작

---

## ChainGo (다운로드형 무흔적 포터블 HQ) 완성 (2026-05-23)

홈피에 올려두고 빌린 PC 에서 다운→더블클릭→로그인→1클릭 원격→닫기 하면 호스트 PC %APPDATA%/레지스트리에 흔적 0 인 비상용 HQ. 출력: [deploy/portable/ChainGo.exe](../../deploy/portable/) (24MB 단일 SFX).

- **격리 4중**: ① `Config::path()` 데스크톱에서도 `APP_DIR` honor ② `Config::ipc_path()` 윈도우 파이프에 환경변수 검사 (2026-05-26 fix) ③ `chainremote_portable_init()` 에서 APP_NAME="ChainGo" 변경 → Flutter runner FindWindowW 가 호스트 "ChainRemote" 못 찾고 자기 창 새로 띄움 ④ core_main 가드: `is_chainremote_portable()` 시 quick_support 자동 추론·`start_portable_service` 자동 호출 차단.
- **SFX 래퍼** ([libs/portable/src/main.rs](../../libs/portable/src/main.rs)): `%TEMP%\ChainGo_<랜덤16hex>\` 에 페이로드 풀고 env `CHAINREMOTE_PORTABLE_DIR` 박은 채 inner 동기 실행 → 종료 시 `TempGuard` Drop 으로 재귀 삭제.
- **시각 구별 배지**: 호스트 HQ 와 ChainGo 가 동시 가동 시 UI 가 완전 동일해 헷갈림 → ChainGo 시 로고 옆 주황색 "ChainGo" 칩 표시.
- **빌드 파이프라인** ([deploy/portable/build-chaingo.ps1](../../deploy/portable/build-chaingo.ps1)).
- **알려진 한계 — Mac↔윈컴 H264/H265 안 뜸** (받아들임): Mac 빌드가 `--hwcodec` 없이 컴파일 → Mac decoder ability_h264=0. 본업 윈컴↔윈컴 은 양쪽 hwcodec 라 H264/H265 OK. **재진단 금지** — toml `enable-hwcodec` 검사 무관.

---

## HQ 앱 인증/UX 4종 완성 (2026-05-22)

- **토큰 메모리 전용**: 로그인 토큰/사용자정보를 LocalConfig(디스크) 대신 lazy_static+RwLock 인메모리 static 에만 보관. 앱 종료 시 증발. 패널 JWT TTL 7d→24h.
- **로그아웃 버튼**: 상단바에 사용자명 + 로그아웃 다이얼로그. 계정 전환(chang↔jaesung) 가능.
- **원격 세션 종료 확인 (2경로)**: 원격 중 무경고 끊김 해결. ① 원격 제어 창 X ② 세션 툴바 빨간 X. 둘 다 확인 다이얼로그.
- **자기 ID 칩**: 상단바 로고 옆 9자리 ID + 클릭 복사.

---

## 옵션 B+ 채택 결정 (2026-05-21, 옵션 A 번복)

HQ 빌드에 사용자 토글 "외부 원격 접속 허용" 추가.
- 번복 이유: 재성이/구매자 컴맹 시 IT 자기지원 불가 = 원격 SW 자체 모순. 판매 시 신뢰 문제.
- 산업 표준 (TeamViewer Host / AnyDesk 수신 토글) 패턴.
- 코드: `src/rendezvous_mediator.rs::start_all()` 의 outgoing-only 차단 조건에 `chainremote-allow-incoming` 옵션 추가. 디폴트 OFF.
- UI: 설정 → 보안 탭에 "외부 원격 접속 허용" 체크박스 카드 추가.
- 인스톨러: HQ 인스톨러에 `RustDesk.toml` (영구비번) 박기 추가. 사용자가 토글만 ON 하면 즉시 무인 incoming.

---

## 사업화 phase 1+2 완성 (2026-05-24)

멀티테넌트 SaaS 활성화 + HQ 비번 변경 + Agent 디폴트 정책 변경. 50개 대리점 판매 가능 상태 진입.

**비즈니스 모델**:
- 1 카피 = 1 대리점(tenant) = 직원 N명 동시 사용 + 가맹점 무제한
- 가격: 코이노 월 10만/seat 대비 우리 월 2~3만/tenant (1/3~1/5)
- 50개 × 월 2.5만 = 월 125만, 연 1500만 (사이드 수익)

**phase 1 (멀티테넌트 활성화)**:
- DB migration 006: tenants 에 사업자정보 + 연락처 + 결제계좌 + 구독요금 컬럼 추가. user_role enum 에 `super_admin` 추가.
- `/admin/tenants` 페이지 (super_admin 전용): 회사 목록 / 신규 등록 / 수정 / 비번리셋(1234) / 일시정지 / 해지.
- `FormattedInput` 컴포넌트: 한국 자동 하이픈.
- 비번 정책: 신규 default 1234 + 비번 리셋도 1234 통일.

**phase 2 (HQ 본인 비번 변경)**:
- `POST /api/me/password` — Bearer JWT + bcrypt 현재 비번 검증 + 새 hash 저장.
- Rust `chainremote_auth::change_password`.
- Flutter UI: 상단바 lock_reset 아이콘 → 다이얼로그 → 토스트.

**Agent 인스톨러 정책 변경 (2026-05-24)**:
- 기존: 영구비번 평문 박혀 거래처 자동 무인 접속. → 공유 비번 보안 약점.
- 신규: `RustDesk2-agent.toml` 분리. approve-mode='click', 영구비번 미박힘. 거래처가 매번 수락 클릭 또는 자기 알아서 영구비번 켬.

---

## ephemeral port exhaustion 진단 + 사업화 안전망 (2026-05-25)

- **증상**: Chang 윈컴 24h+ 가동 후 ChainRemote outbound 불가. 코이노 KoinoHost 가 ephemeral port 16,384 개 거의 다 Bound 상태로 점유.
- **4갈래 정밀 조사 결론**: 우리 fork 무관. RustDesk repo 의 socket leak issue 0건. Chang 윈컴의 환경 특이성 + 24/7 가동 누적.
- **인스톨러에 안전망 추가**: agent/hq 인스톨러 [Run] 첫 단계에 `netsh int ip set dynamicport tcp start=10000 num=55000` 자동 적용. ephemeral port 16K → 55K. 다른 SW leak 가 있어도 ChainRemote 가 피해자 안 됨.
- **다른 SW (코이노/Chrome RD) 를 지우라고 안내 절대 금지** — Chang 의 강한 피드백. 메모리 [feedback_dont_blame_third_party].

---

## NAS 시그널링 인프라 (2026-05-01 가동)

- **DDNS**: `sepani.synology.me` (Synology 무료, 자동 갱신)
- **공인 IP**: 112.186.209.131 (KT)
- **공개키**: `C2bqeqG0Nb0EQgmtomhzcykw69gRvbSLKfm019r1C8Y=`
- **컨테이너**: `chainremote-hbbs`, `chainremote-hbbr` (rustdesk-server:latest)
- **포트 포워딩** (TP-Link Deco): 21115/21116(TCP+UDP)/21117/21118 → 192.168.68.103
- **하드코딩 → 클라이언트 toml**: `deploy/win-installer/RustDesk2.toml` 참조
