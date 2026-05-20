# ChainRemote (체인리모트)

> RustDesk 포크 기반 자체 원격지원 솔루션. 코이노 AnySupport 대체 + 향후 B2B 사업화.
> 상세 기획: `ChainRemote_기획서.md` / RustDesk 코드 가이드: `AGENTS.md`

## 프로젝트 핵심
- **베이스**: rustdesk/rustdesk (1.4.6+) 포크. 바닥부터 만들지 않음.
- **목표**: 코이노 월 10만원+ → 자체 서버 월 1~3만원. 거래처 200+ POS/키오스크 원격 A/S.
- **라이선스**: AGPL v3 (1단계 내부 사용). 사업화 시점에 재결정.
- **체인오더 시스템과 완전 분리** — 별도 프로젝트.

## Chang 작업 환경 (2026-05-20 기준)

### 데일리 드라이버
- **MacBook Pro 16" M2 Max** — Chang 의 유일한 데일리 드라이버. 집/사무실 항상 들고 다님.
- **사무실엔 윈컴 없음.** 사무실에서 윈컴 작업 = 거래처 PC 직접 만지거나 Mac → 집 윈컴 원격.

### 집 윈컴 (Chang 본인 — 빌드/HQ 겸용)
- **위치**: 집. 사용자명 `zenta`. 절전 모드 기본.
- **하드웨어**: Ryzen 9 9900X / Radeon RX 9070 / DDR5 64GB. **하이엔드. 빌드/메모리 부족이 빌드 실패의 원인일 가능성 거의 없음** — 진단 시 "윈컴 사양이 부족할 수도" 가설은 우선순위 최하.
- **역할**: Windows 빌드 머신 (ChainRemote 풀빌드 환경 셋업 완료) + HQ 워크스테이션 (집에서 거래처 원격 볼 때 큰 모니터 활용).
- **원격 접속 경로**:
  - 사무실 Mac → 집 윈컴: **Chrome Remote Desktop** (백업/빌드용 원격). HQ 빌드라 ChainRemote 양방향 불가.
  - WoL: `gogo` 명령어 (Tailscale 위로 매직패킷). 메모리 [[reference_home_infra]].
- **빌드 환경**: `C:\src\ChainRemote\`. 풀빌드 도구 (Rust 1.81, Flutter 3.24.5, vcpkg, LLVM 18, Inno Setup 6) 셋업 완료. 함정 7가지 (메모리 [[project_v127_build_pitfalls]]) 영구 픽스됨.

### 재성이 윈컴 (HQ 사용자)
- **위치**: 사무실 또는 본인 집. Windows 데일리드라이버.
- **역할**: 순수 HQ 사용자 — 거래처 원격만. 피지원자 아님.
- **현재 상태 (2026-05-20)**: v1.3.0 HQ 인스톨러 본인 홈피에 게시됨. 내일(2026-05-21) 사무실에서 설치 + `jaesung/6002` 로그인 검증 예정.

### NAS (Synology DS220+ "kimfam")
- **위치**: 집. KT 1Gbps. 192.168.68.103 (LAN). DDNS `sepani.synology.me`.
- **서비스**:
  - hbbs/hbbr (포트 21115~21118): RustDesk 시그널링/릴레이.
  - PostgreSQL (포트 15432 LAN-only): chainremote DB.
  - chainremote-admin (Next.js 컨테이너, 포트 3001/3443): 관리 패널 + 본사 앱 API.
- **외부 접속**:
  - 본사 앱 API (`http://sepani.synology.me:3001`): HTTP 직노출, 어디서나 도달.
  - 관리 패널 브라우저 (`https://sepani.synology.me:3443`): HTTPS Reverse Proxy.
  - DB 직접 노출 안 함.
- **자세히**: 메모리 [[project_admin_panel]], [[reference_home_infra]].

### 거래처 PC (외부 사용자)
- **OS**: 윈도우 (POS/키오스크). 100% Windows.
- **빌드**: Agent (`ChainRemote_Agent_Setup_v*.exe`). 영구비번 + watchdog + 자동업데이트.
- **현재 셋업된 거래처 5곳**: 중앙리, 우리집(=Chang 집 윈컴, 옛 셋업 잔재), 진희씨 컴, 바다양푼이 동태찜, 재성이 컴.

### 도구 분담 (2026-05-20 옵션 A 결정)
- **ChainRemote**: 거래처 원격 (POS A/S 본업)
- **Chrome Remote Desktop**: Chang 개인용 (사무실 Mac → 집 윈컴 빌드). 사업화 시 영향 0.
- **Tailscale + SSH**: Mac → NAS / 집 윈컴 명령형 작업. 헤드리스 빌드 자동화는 폐기 (메모리 [[feedback_no_autobuild_workflow]]).

## 절대 원칙

### 고객 UX (★최우선) — 전략 변경 (2026-04-30)
**채택**: 옵션 C — 네이티브 .exe 단순 실행. 웹 클라이언트는 포기.

**고객이 할 일은 딱 2가지**: ① 받은 .exe 더블클릭 ② 비밀번호 입력. 끝.
- 코이노 4단계(988.co.kr 방문→세션입력→다운→실행)를 **2단계로 축소** = 핵심 차별화.
- 자주 보는 거래처는 **무인 접속 모드** 1회 설정 → 그 후 거래처 PC 조작 불필요.
- UX 단순화를 깨는 제안 거부.

**왜 웹 클라이언트(WebRTC) 포기했나** (검증 결과, 2026-04-30):
- RustDesk가 무료 v1 웹 클라이언트를 본 리포에서 **삭제** (커밋 5faf0ad3c).
- v1 README 명시: "v1 is not compatible with current Flutter source code".
- v1 복원 시도 → vendor 자산(`ogv.js`, `yuv-canvas.js`) 누락, 프로토콜 호환 의문.
- v2는 **유료 상용** (RustDesk Server Pro). 자체 구현 시 1~3개월 작업.
- 결론: 웹은 ROI 낮음. 거래처 99% Windows라 .exe로 충분.

**향후 검토 보류**: 사업화 후 거래처 다양해지면 옵션 B(자체 웹) 재검토 가능.

### 작업 방식
- **단계별**: 기획서 §6 Step 1~8 순서 준수. 단계 완료 후 다음.
- **정석 구현**: 임시방편/Workaround 금지. 기술적으로 올바른 방식만.
- **테스트 서버 우선**: 모든 배포는 테스트 → 본서버/GitHub push는 Chang 지시 시에만.
- **결과만 보고**: 코드 덤프 X, 간결한 완료 보고만.

### 앱 구조 불변 원칙 (2026-05-20 확정)
이 셋은 어떤 상황·시나리오에서도 유지된다. UI/IA 설계 시 전제로 깔 것.

1. **본사 빌드는 한 벌, 거래처 빌드는 별도.** 본사 직원이 늘어도(Chang·재성·향후 더) 본사 빌드는 1개. 차이는 로그인 계정으로만 갈라짐.
2. **거래처 풀의 진실 원천은 관리 패널 DB.** 로컬 peer 캐시 아님. Chang이 등록한 거래처를 재성이가 자기 본사 앱에서 그대로 봐야 함. ~~동시에 누가 어디 들어가 있는지(presence) 서로 보여야 사고 방지.~~ **presence 폐기 (2026-05-20)**: 거래처 200곳 중 동시 충돌 확률 ~0 + RustDesk multi-viewer 네이티브 지원 → over-engineering. 카톡 한 줄로 충분.
3. ~~판매 대비 멀티테넌시~~ **폐기 (2026-05-20)**: 판매 안 함. 우리 팀(betaposlab) 전용. 단, DB 스키마의 tenant_id는 이미 들어있으니 그대로 둠(제거할 이유 없음).

### 앱 구조 청사진 (2026-05-20 8개 결정)

판매 없음. Chang+재성이(향후 1~2명 더)가 자기 PC에서 우리 거래처들을 원격 지원하는 사내 도구.

```
┌── 거래처 윈컴 (별도 빌드) ──┐
│ ChainRemote 서비스 (트레이만)│
│ • 본사 접속 수신만           │
│ • 비번 1회 설정 → 영원히 0클릭│
│ • 설정/거래처목록 화면 없음   │
└────────────┬────────────────┘
             │ RustDesk 프로토콜 (NAS hbbs)
┌────────────┴───────────┐  ┌──────────────────────┐
│ 본사 ChainRemote 앱     │  │ 관리 패널 (브라우저) │
│ (Chang Mac, 재성이 Win) │  │                      │
│ 로그인 chang|jaesung    │  │ 로그인 chang|jaesung │
│ [홈 = RustDesk 스샷 모양]│  │ • 모든 거래처 표      │
│ • 전체 거래처(DB에서)   │  │ • 모든 직원 즐겨찾기  │
│ • 즐겨찾기 탭 (내 것만) │  │ • 지원이력           │
│ • 최근 세션 (내 것만)   │  │ • 권한 관리          │
│ • 1클릭 원격 + presence │  │                      │
│ • [업데이트 확인] 버튼   │  └──────┬───────────────┘
└────────┬────────────────┘         │
         └──── NAS PostgreSQL ◄─────┘
              (진실 원천)
              • customers, users
              • user_favorites ← 신설 필요
              • support_sessions
```

**8개 결정 (변경 시 전체 작전 재검토):**
1. 판매 없음. 우리 팀 전용.
2. 거래처 빌드 = 수신만. 별도 빌드(--role=agent).
3. 본사 앱 로그인 (chang/jaesung 각자 비번 6002).
4. 동시간 각자 다른 거래처 원격 가능. RustDesk 다중 viewer로 native 지원.
5. 본사 앱 홈 = 전체 거래처 + "내 즐겨찾기" 탭. 모두 다 보이되 즐겨찾기는 자기 것만.
6. 관리 패널 = 모든 직원의 즐겨찾기까지 조회 가능. user_favorites 테이블 신설.
7. 권한: **chang = 모두**. **jaesung = 읽기 + 원격 + 거래처 추가 + 자기 즐겨찾기 관리**. 거래처 수정/삭제·직원 관리는 chang만.
8. 업데이트 = 현재 방식 유지 (B-2 완성: 설정에 "업데이트 확인" 버튼 → 즉시 설치). 24h 자동 폴링도 그대로.

**부수 결정:**
- 본사 앱 메인의 "내 ID 큰 표시" 폐기 (본사 PC는 피지원자 아님).
- importPeer 유지하되 역할 변경: "자동 등록" → "신규 ID 발견 시 1클릭 등록 알림". 진실 원천 DB와 모순 없음.

### 작업 순서 (Phase 1~3) — Phase 2 가 먼저 진행 중

- **Phase 1** (대기): 거래처 빌드 분리 (--role=agent). 거래처 UI = 트레이만 + ID/비번/정보 한 화면. "서비스 중지" 버튼 제거.
- **Phase 2** (4/6 sub 완료, 2026-05-20):
  - ✅ 2-A DB 토대: `user_favorites` 마이그레이션 + Bearer JWT 인증 (`lib/api-auth.ts`) + REST API 8개 라우트 + 패널 Server Actions 와 `lib/data/` 공유 레이어
  - ✅ 2-B 본사 앱 로그인: `chainremote_auth.rs` + `ChainRemoteAuthGate` + FFI 7개. 토큰 LocalConfig 저장 (chainremote-token, chainremote-user)
  - ✅ 2-C 거래처 목록 DB: `chainremote_data.rs::spawn_load_customers` → push_global_event("load_recent_peers"). Flutter 측 6개 호출 자리 `mainLoadRecentPeers` → `chainremoteLoadCustomers` 교체
  - ✅ 2-D 즐겨찾기 user별: `user_favorites` 테이블 + load/add/remove + (remote_id→UUID) 캐시 + 8자리 Flutter 호출 교체. platform="Windows" cosmetic 픽스.
  - ✅ 2-E "내 ID 큰 표시" 폐기 + 설정 "업데이트 확인" 버튼(B-2 마무리). **presence 폐기** (over-engineering, 위 청사진 #2 변경 참조).
  - ✅ 2-F 외부망 검증 (Chang Mac 폰핫스팟 → 거래처 5건 로드). NAS Container Manager 패널 운영. **재성이 윈컴 검증은 Phase 1 (본사 윈도우 빌드) 후로 이월**.
- **Phase 3** (대기): 진짜 윈도우 브랜딩 (BINARY_NAME, 서비스명, 아이콘, About).

### Phase 2 의 협업 청사진 (2-D 시점 동작 검증됨)
```
Chang Mac (chang 로그인) ─┐
재성이 Win (jaesung 로그인)─┤  POST /api/auth/token → Bearer JWT (7일)
향후 직원 ─────────────────┘  ↓
                              GET /api/customers (모두 같은 4 거래처 봄)
                              GET /api/me/favorites (자기 것만)
                              POST /api/me/favorites { customerId } (자기 즐겨찾기)
                              ↓
                      NAS PostgreSQL — 진실 원천 1개

## 이슈 트래커

### ✅ 이슈 1: 인스톨러 toml 경로 (LICENSE_MISMATCH) — **해결 (v1.2.0, 2026-05-06)**
- **증상이었던 것**: `ChainRemote_Setup.exe` 로 깐 PC가 ID/릴레이/Key 필드 비어 있음. POS→Mac 시도 시 "키가 일치하지 않습니다".
- **근본 원인** ([config.rs:484-485](libs/hbb_common/src/config.rs:484)): RustDesk가 서비스 모드로 구동되면 `C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\` 를 읽는데, 옛 인스톨러는 `%APPDATA%\RustDesk\config\` 만 박았음 → 서비스가 빈 key로 등록 시도.
- **영구 해결**: v1.2.0 인스톨러가 toml 3종(`RustDesk.toml`+`RustDesk2.toml`+`RustDesk_default.toml`)을 **사용자/LocalService 두 경로 동시 배치**. 인스톨 중 `sc stop`→toml 복사→`sc start` 순서. 영구 비번 평문→자동해싱, `access-mode=full`, 디스플레이/원격커서/음소거/파일복사 기본값도 같이 적용.

### ✅ 이슈 2: 외부망에서 관리 패널 도달 — **해결 (2026-05-20, HTTP 3001 직노출)**
- **증상이었던 것**: Mac을 사무실로 가져가면 `localhost:3000/customers` 에서 `connect ETIMEDOUT 192.168.68.103:15432`. 또 재성이/총판이 Tailscale 셋업 불가 (컴맹).
- **채택한 해결**: NAS 라우터에 포트 포워딩 `3001 → 192.168.68.103:3001` (TCP). 본사 앱 `DEFAULT_API_BASE = http://sepani.synology.me:3001`. Tailscale 불필요. 어디서나 도달 (집/사무실/PC방/폰핫스팟 동일).
- **HTTPS 보류**: Synology Reverse Proxy 의 3443(HTTPS) 셋업은 이미 동작하지만, RustDesk core 의 `reqwest/rustls` 가 Synology nginx 와 TLS close_notify quirk 로 매번 끊김. native-tls fallback 도 실패 (Error -9806). HTTP 직노출이 안정적. Chang 의 보안 의지(낮음, 코이노/AnySupport 와 동급) 와 일치.
- **DB 직접 노출 안 함**: PostgreSQL 15432 은 LAN/Tailscale 만. 패널(Next.js API)이 게이트.
- **잔여**: 21114 hbbs heartbeat 외부 도달 (신규 POS 자동 등록) — 별도 결정 보류.

### ✅ AUTH_SECRET 통일 함정 (2026-05-20)
- Mac 로컬 dev 패널 `.env.local` 의 `AUTH_SECRET` 이 NAS 컨테이너 `.env` 의 값과 달랐음 → 로컬 dev 가 발급한 토큰을 NAS 가 검증 실패 ("토큰 검증 실패" 401). NAS 의 secret 을 진실 원천으로 통일. **NAS 의 `.env` 가 master**. 로컬 dev 도 같은 값 박을 것.

### ⏳ 이슈 3: 외부망 P2P / 릴레이 / Mac TCC 재검증 — **미해결**
- 윈컴↔Mac 동작 확인은 같은 LAN(P2P 직결)에서만. 외부망(릴레이 경유)에서 검증 안 됨.
- 이슈 2 해결 후 외부망에서 재검증 필요.

## 현재 단계 (2026-05-20 갱신)

### 완료된 것
- ✅ Step 1 Mac: 빌드 환경 + 첫 빌드 + 윈컴 원격 테스트
- ✅ Step 2 부분: UI 텍스트/아이콘/색상 (ChainRemote 가시화)
- ❌ Step 4 웹클라: 검증 결과 폐기 (옵션 C로 전환)
- ✅ Step 3 시그널링/릴레이: NAS Docker로 hbbs/hbbr 가동 (`sepani.synology.me`, 포트 21115-21118 외부 노출 검증)
- ✅ Step 5 골격: Next.js 관리 패널, 멀티테넌시 DB 스키마, 거래처 목록
- ✅ End-to-end 1-클릭 원격: 관리 패널 → rustdesk:// URL → Mac 앱 → 윈컴 연결
- ✅ 무인 접속 모드: 영구 비번 + 부팅 자동 시작 + approve-mode=password
- ✅ **Step C 거래처 배포 인스톨러**: Inno Setup 으로 `ChainRemote_Setup.exe` 단일 파일 (2026-05-02)
- ✅ **첫 ChainRemote 자체 개선**: 원격 세션 툴바에 파일 전송 버튼 (Mac 빌드 검증) (2026-05-02)
- ✅ **인스톨러 v1.2.0 — LICENSE_MISMATCH 근본 픽스** (2026-05-06): toml 3종을 사용자/LocalService 양쪽 배치 + 영구비번 평문→자동해싱 + `access-mode=full` 기본값.
- ✅ **자동 업데이트 시스템 B-1** (2026-05-06): `src/chainremote_updater.rs` — 서비스에서 24h 폴링, SHA256 검증, 활성 세션 없을 때 사일런트 적용. 본사 측 `deploy/release.sh`로 NAS 푸시.
- ✅ **v1.2.7 윈컴 풀빌드 함정 7가지 영구 픽스** (2026-05-14): vcpkg manifest 모드, host-triplet 강제, LLVM 18 핀, swresample 패치 Mac 전용 분기, build.py python3 stub 우회 등. 상세는 [deploy/win-build/README.md](deploy/win-build/README.md).
- ✅ **툴바 아이콘 tofu 픽스** (2026-05-19, 02165c658): `build.py`의 `flutter build --release` 4개 라인에 `--no-tree-shake-icons` 추가.
- ✅ **watchdog 강화 + v1.2.18 배포** (2026-05-20): 트레이 "서비스 중지"/서비스 삭제 케이스까지 자가치유. virtual_display 제거.
- ✅ **빌드+배포 원샷 자동화** (2026-05-20, 커밋 8a7da53b9): SSH/Tailscale 경유.
- ✅ **Phase 2-E/F 본사 협업 완성** (2026-05-20): 메인 "내 ID 큰 표시" 폐기. NAS Container Manager 패널 운영(`https://sepani.synology.me:3443` 브라우저, `http://sepani.synology.me:3001` 본사 앱 API). Mac 본사 앱 외부망 검증(폰 핫스팟 → 거래처 5건 로드). AUTH_SECRET 통일(NAS 가 master). Next 16 `proxy.ts` 대응. **presence 폐기** (over-engineering).
- ✅ **Phase 1 단계 1~4 Mac 본사 빌드 완성** (2026-05-20): `desktop_tab_page.dart:53` AuthGate 조건부 wrap (incoming-only 빌드에서 게이트 제외) / 거래처용 `deploy/win-installer/custom-agent.txt` + 본사용 `deploy/custom-hq.txt` 생성 / Mac 빌드 워크플로에 `Resources/custom.txt` 자동 copy / `src/common.rs::read_custom_client` 에 plain JSON 경로 추가. Mac HQ 빌드 검증 통과 (거래처 5건 + outgoing-only UI). 단계 5~6 (윈컴 인스톨러 2종 + 거래처 자동업데이트 검증) 은 윈컴 깨울 때 묶음.

### 거래처 배포 인스톨러 (Step C 정석, `deploy/win-installer/`, 2026-05-02 완성)
**결과물**: `ChainRemote_Setup.exe` (~25MB) — 거래처가 더블클릭만으로 원격 셋업 완료.

**파이프라인** (윈컴에서 빌드, 30초):
```powershell
cd C:\src\ChainRemote\deploy\win-installer
Invoke-WebRequest "https://github.com/rustdesk/rustdesk/releases/download/1.4.6/rustdesk-1.4.6-x86_64.exe" -OutFile rustdesk-1.4.6-x86_64.exe
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

**인스톨러 동작** (거래처 PC):
1. 공식 RustDesk 1.4.6 인스톨러를 임시 풀고 `--silent-install` (코드 서명 그대로 유지)
2. `RustDesk2.toml` (NAS 서버 + 공개키)을 `%APPDATA%\RustDesk\config\`에 자동 배치
3. RustDesk 가 만든 `RustDesk.lnk` 단축아이콘들을 **`ChainRemote.lnk`로 atomic rename** (바탕화면, 시작 메뉴)
4. 자동시작 reg `RustDesk` → `ChainRemote`
5. 첫 실행 → ID 발급 → 우리 NAS에 자동 등록

**우회한 함정들** (이 길로 가다가 실패한 것들):
- ❌ 파일명 `host=,key=` 인코딩 — 동작은 하지만 거래처 보기 흉함
- ❌ Mac 빌드 NSIS — `makensis` macOS Tahoe std::bad_alloc 크래시
- ❌ Mac 7-Zip SFX — 매니페스트 인젝션은 됐으나 SFX 모듈이 RunProgram 미지원 (7z.sfx vs 7zS.sfx)
- ❌ `--silent-install` 권한 부재 → portable 모드로 떨어짐
- ❌ `ChainRemote.exe` 별도 폴더 복사 → Flutter plugin DLL 못 찾음 (desktop_drop_plugin.dll 등)
- ✅ Inno Setup (Chang 윈컴에 이미 설치) → atomic rename → 깨끗하게 동작

### 첫 ChainRemote 자체 개선 — 원격 세션 파일 전송 버튼 (2026-05-02)
- 변경 파일: `flutter/lib/desktop/widgets/remote_toolbar.dart` (+25줄)
- `_FileTransferMenu` 신규 위젯 → 모니터/키보드 사이 툴바에 아이콘 추가
- 한 번 클릭 → `connect(context, id, isFileTransfer: true)` → 새 파일 전송 창
- 기존: 메인 창 가서 우클릭 → 파일 전송 (2단계). 이제 0이동, 1클릭.
- Mac 빌드 검증 완료 (`/Applications/ChainRemote.app` 갱신됨)
- ⚠️ 윈도우 적용은 진짜 ChainRemote 브랜딩 빌드 시점에 같이 (`deploy/win-build/` 환경)

### NAS 시그널링 인프라 (2026-05-01 가동)
- **DDNS**: `sepani.synology.me` (Synology 무료, 자동 갱신)
- **공인 IP**: `112.186.209.131` (KT)
- **공개키**: `C2bqeqG0Nb0EQgmtomhzcykw69gRvbSLKfm019r1C8Y=`
- **컨테이너**: `chainremote-hbbs`, `chainremote-hbbr` (rustdesk-server:latest)
- **포트 포워딩** (TP-Link Deco): 21115/21116(TCP+UDP)/21117/21118 → 192.168.68.103
- 하드코딩 → 클라이언트 toml은 `deploy/win-installer/RustDesk2.toml` 참조

### 거래처 운영 워크플로우 (검증됨)
1. **본사**: `ChainRemote_Setup.exe` 카톡/USB로 거래처 전달
2. **거래처**: 더블클릭 → UAC 예 → 자동 설치 (RustDesk silent + 우리 config + 단축아이콘 rename)
3. **거래처**: ChainRemote 자동 실행 → 화면 ID 본사에 알림
4. **본사**: 관리 패널에 거래처 정보 + ID 등록 + 영구 비번 발급
5. **거래처**: 받은 비번을 [설정 > 보안 > 영구 비밀번호 설정] 에 1회 입력
6. **그 후 영원히**: 거래처 PC 켜져 있으면 본사가 0클릭 무인 접속

### ID 시스템 — 머신 고정
- ID는 머신 UUID 기반 deterministic 생성 (`hbb_common::machine_uid`)
- 같은 PC 재설치 → 같은 ID (피어 등록 안정성)
- 다른 PC → 자동으로 다른 ID (충돌 0)
- 메인보드/펌웨어 변경 시에만 ID 변경

### Mac 측 디스플레이 권장 (4K 거래처 대응)
- ChainRemote 메인 창 → 설정 → 디스플레이 (전역 기본값)
  - 기본 보기 스타일 = "크기 조정 가능"
  - 기본 이미지 품질 = "반응 시간 최적화"
- 또는 `~/Library/Preferences/com.carriez.RustDesk/peers/<ID>.toml` 직접 편집
  - `view_style = 'adaptive'`, `image_quality = 'low'`

### B-2 (다음 세션) — 자동 업데이트 시스템 마무리
- Flutter "업데이트 확인" 버튼 + 현재/최신 버전 표시 (설정 페이지 "정보" 탭)
- IPC 로 UI → 서비스 "지금 체크" 메시지
- 본사 강제 푸시 채널 (`push.json` 별도 5~10분 폴링) + 관리 패널의 "긴급 업데이트 푸시" 버튼
- B-1 만 가지고도 핵심은 동작 — 거래처 PC 부팅 → 24h 안에 새 버전 자동 설치

### NAS Web Station 셋업 (B-1 동작 전제, Chang 1회 작업)
1. DSM → 패키지 센터 → **Web Station** 설치 (없으면)
2. SSH 로 디렉터리 생성: `mkdir -p /volume1/web/chainremote && chmod 755 /volume1/web/chainremote`
3. Web Station → 가상 호스트 → `sepani.synology.me` (HTTPS, Let's Encrypt 무료 인증서)
4. 라우팅 검증: `curl -I https://sepani.synology.me/chainremote/` → 200 (디렉터리 인덱스 또는 빈 응답)
5. 첫 릴리즈 푸시 (윈컴에서 v1.2.0 인스톨러 빌드 후):
   ```bash
   ./deploy/release.sh ~/Downloads/ChainRemote_Setup.exe 1.2.0 "기본 설정 자동 적용"
   ```

### v1.2.5+ 보류 항목 (다음 버전 묶을 때 같이)
- **창/트레이/Alt+Tab 아이콘 RustDesk → ChainRemote 교체** (2026-05-07 발견): `flutter/windows/runner/resources/app_icon.ico` 가 RustDesk 기본값. `deploy/win-installer/chainremote.ico` 로 덮어쓰기 + 재빌드면 끝. 동작 무관 cosmetic — 재성이 PC v1.2.4 검증 후 다른 픽스 모일 때 묶어서 진행.

### 다음 단계 (다음 세션)
1. **Phase 1 — 거래처/본사 빌드 분리** (상세는 ↓ "Phase 1 작업 계획" 섹션).
2. **재성이 윈도우 본사 빌드** — Phase 1 의 5~6 단계와 합쳐서 한 번에 (윈컴 빌드 환경 1회 깨움).
3. **첫 거래처 실전 시도** — 가장 가까운 1곳 (코이노 대체 또는 신규).
4. **거래처별 비번 자동 생성 + 관리 패널 DB 저장** (운영 정석화).
5. **이슈 3** 외부망 P2P/릴레이/Mac TCC 재검증 — Mac → 윈컴 실원격 (다른 LAN).
6. **파일 전송 UX 개선** — 더블클릭=전송, 드래그앤드롭, OS→원격창 직접 드롭.
7. **코드 서명 인증서** ($300/년) — SmartScreen 경고 제거 (사업화 단계).

### Phase 1 작업 계획 — 거래처/본사 빌드 분리 (단계 1~4 완료 2026-05-20)

**핵심 메커니즘**: 분기는 **`custom.txt` 파일 1개** 로 결정. RustDesk 의 HARD_SETTINGS 활용.

- `.app/Contents/Resources/custom.txt` (Mac) 또는 윈도우 binary 옆 `custom.txt` → `src/common.rs::load_custom_client()` 가 자동 로드.
- **conn-type 은 top-level 키** (override-settings 안 X). RustDesk 코드는 HARD_SETTINGS 에서 conn-type 을 읽고, custom.txt 의 top-level key/value 만 HARD_SETTINGS 로 들어감 ([common.rs:2245-2252](src/common.rs:2245)).
- 본사 모드 = `{"conn-type":"outgoing"}` / 거래처 모드 = `{"conn-type":"incoming"}`.

**서명 함정** (정찰 단계에서 놓쳤던 것):
- 원본 RustDesk 의 `read_custom_client` 는 base64+ed25519 서명만 허용 (상용 anti-tamper). plain JSON 박으면 "Failed to decode" 로 silent fail.
- **우리 포크 패치**: [src/common.rs::read_custom_client](src/common.rs) 가 `{` 로 시작하면 plain JSON 직접 파싱. 서명 경로는 그대로 fallback. 우리 빌드는 우리가 통제하므로 안전.

**단계 1~4 (완료, 2026-05-20)**:
1. ✅ [flutter/lib/desktop/pages/desktop_tab_page.dart](flutter/lib/desktop/pages/desktop_tab_page.dart) — `bind.isIncomingOnly() ? homePage : ChainRemoteAuthGate(child: homePage)` 조건부 wrap.
2. ✅ [deploy/win-installer/custom-agent.txt](deploy/win-installer/custom-agent.txt) — `{"conn-type":"incoming"}`.
3. ✅ [deploy/custom-hq.txt](deploy/custom-hq.txt) — `{"conn-type":"outgoing"}`.
4. ✅ Mac 빌드 워크플로 (CLAUDE.md "빌드 + 실행 명령") — `cp deploy/custom-hq.txt /Applications/ChainRemote.app/Contents/Resources/custom.txt` 추가.
- **Mac HQ 빌드 검증 완료**: 거래처 5건 로드 + ID/비번 보드 없는 outgoing-only UI.

**단계 5 (Mac-side prep 완료 2026-05-20, 실제 ISCC 컴파일은 윈컴 필요)**:
- ✅ `deploy/win-installer/installer.iss` → [agent-installer.iss](deploy/win-installer/agent-installer.iss) git rename. `custom-agent.txt` 를 `{app}\custom.txt` 로 박는 `[Files]` 항목 추가. OutputBaseFilename → `ChainRemote_Agent_Setup_v{version}`.
- ✅ [deploy/win-installer/hq-installer.iss](deploy/win-installer/hq-installer.iss) 신규 — `custom-hq.txt` → `custom.txt`, RustDesk.toml(영구비번) 제외, watchdog 예약작업 제외, 간단한 서비스 시작. OutputBaseFilename `ChainRemote_HQ_Setup_v{version}`. AppId 별도.
- ✅ [build-iss.ps1](deploy/win-installer/build-iss.ps1) `-Target agent|hq|both` 파라미터 지원 (기본 agent).
- ✅ [release.sh](deploy/release.sh) — ISS 파일 경로 갱신, REMOTE_FILENAME → `ChainRemote_Agent_Setup_v{version}.exe`. 본사 채널은 자동업데이트 푸시 X (재성이 수동 설치 1회).
- ⏳ 윈컴에서 `git pull` → Flutter Windows 빌드 (한 번이면 agent/hq 둘 다 커버, custom.txt 만 다름) → `build-iss.ps1 -Target both` → 두 .exe 산출. 함정 7가지(메모리 [project_v127_build_pitfalls]) 대응.

**단계 6 부분 완료 (2026-05-20, Chang 윈컴 dogfooding)**:
- ✅ Chang 윈컴 v1.3.0 HQ 빌드 설치 검증 — 로그인 + 거래처 5건 + outgoing-only UI 정상.
- ⏳ 재성이 윈컴 — `ChainRemote_HQ_Setup_v1.3.0.exe` 본인 홈피 게시됨. 내일(2026-05-21) 사무실에서 설치 + `jaesung` 로그인 검증.
- ⏳ 진희씨 컴 — `ChainRemote_Agent_Setup_v1.3.0.exe` 옛 v1.2.x 위에 덮어쓰기 설치 (재설치보다 깔끔). 내일.
- ⏳ 한 거래처 자동업데이트 검증 — release.sh 푸시는 위 1차 dogfooding 통과 후. 점진 배포.

**옵션 B+ 채택 결정 (2026-05-21, 옵션 A 번복)**: HQ 빌드에 사용자 토글 "외부 원격 접속 허용" 추가.
- 번복 이유: 재성이/구매자 컴맹 시 IT 자기지원 불가 = 원격 SW 자체 모순. 판매 시 신뢰 문제.
- 산업 표준 (TeamViewer Host / AnyDesk 수신 토글) 패턴. 6가지 우려 다 해소.
- 코드: `src/rendezvous_mediator.rs::start_all()` 의 outgoing-only 차단 조건에 `chainremote-allow-incoming` 옵션 추가. 디폴트 OFF (안전 디폴트).
- FFI: `chainremote_get_allow_incoming` / `chainremote_set_allow_incoming` 2개. Codegen 재생성됨.
- UI: 설정 → 보안 탭에 "외부 원격 접속 허용" 체크박스 카드 추가 (`_chainremoteAllowIncomingCard`). 토글 변경 시 ChainRemote 재시작 안내.
- 인스톨러: HQ 인스톨러에 `RustDesk.toml` (영구비번) 박기 추가. 사용자가 토글만 ON 하면 별도 비번 설정 없이 즉시 무인 incoming 가능.
- 도구 분담 수정: Mac → 재성이 컴 원격 = ChainRemote HQ 로 통일 (Chrome RD 불필요). 사무실 Mac → 집 윈컴 빌드 원격도 ChainRemote 단일 운용 가능.

**Phase 1 후속 backlog (안정화 후)**:
- 거래처 PC 사용자/서비스 모드 toml 분리 문제 — UI 보안탭 빈 칸이지만 서비스 동작 OK. 메모리 [[project_user_vs_service_toml]]. 인스톨러 [Run] step 3 robustness 확인 또는 fork 코드에서 inherit.
- 거래처별 chainremote_version heartbeat — NAS API `/api/customers/heartbeat` → 관리 패널 + 본사 앱 거래처 목록에 "v1.x.x · 마지막 보고 N분 전" 컬럼.
- 자동업데이트 실패 진단 — 중앙리 PC 의 `C:\ProgramData\ChainRemote\updater.log` 확인 (내일).
- build-all.ps1 의 [3.5/5] codegen 단계 거짓 OK 보고 버그 — 진단/실패 보고하도록 보강.

### 관리 패널 코드 위치
- `/Users/changsmac/내작업/ChainRemote/chainremote-admin/` (서브폴더, Next.js 16)
- DB 스키마: `/Users/changsmac/내작업/ChainRemote/db/migrations/*.sql`
- Drizzle ORM 모델: `chainremote-admin/lib/schema.ts`
- 데이터 레이어 (본사 앱·패널 공유): `chainremote-admin/lib/data/{customers,favorites,sessions}.ts`
- 인증 미들웨어: `chainremote-admin/proxy.ts` (Next 16 이름. matcher + 함수내 `/api` 명시 통과)
- 실행 모드:
  - **NAS 운영 (정식)**: `https://sepani.synology.me:3443` 브라우저 / `http://sepani.synology.me:3001` 본사 앱 API. `/volume1/docker/chainremote-admin/` + `docker compose up -d`. AUTH_SECRET 진실 원천.
  - **Mac 로컬 dev**: `npm run dev` → http://localhost:3001. `.env.local` 의 `AUTH_SECRET` 은 NAS `.env` 와 동일하게.

## 빌드 환경 (Step 1에서 구축됨)

### 설치된 도구
| 도구 | 버전 | 위치 |
|------|------|------|
| Rust (default) | 1.81 | `~/.cargo` |
| Rust (stable) | 1.95 | `~/.cargo` |
| Flutter (RustDesk용) | 3.24.5 | `~/flutter-3.24.5` |
| Flutter (기타) | 3.41.8 | `/opt/homebrew/bin/flutter` |
| vcpkg + libs (vpx/yuv/opus/aom) | latest | `~/vcpkg` |
| NASM | 2.16.03 | `~/.local/bin/nasm` |
| flutter_rust_bridge_codegen | 1.80.1 | `~/.cargo/bin` |
| Xcode (정식) | 26.2 | `/Applications/Xcode.app` |
| CocoaPods | 1.16.2 | brew |
| llvm, create-dmg, pkg-config | latest | brew |

### Flutter 패치 (필수)
RustDesk가 Flutter 3.24.5의 issue #133533을 회피하기 위해 패치 적용됨:
```bash
sed -i '' 's|_setFramesEnabledState(false);|//_setFramesEnabledState(false);|g' \
  ~/flutter-3.24.5/packages/flutter/lib/src/scheduler/binding.dart
```
Flutter SDK 재설치 시 다시 적용 필요.

### Mac 빌드 함정 8 — `.dart_tool` 의 homebrew Flutter SDK 누수 (2026-05-20)
- **증상**: PATH 에 `~/flutter-3.24.5/bin` 박았는데도 빌드 도중 `/opt/homebrew/share/flutter/packages/flutter/...:engineId` 에러로 실패.
- **원인**: `flutter/.dart_tool/package_config.json` 의 `flutter` 패키지 rootUri 가 과거 어떤 시점(brew Flutter 3.41.8 로 pub get 한 흔적)에서 `file:///opt/homebrew/share/flutter/packages/flutter` 로 캐시됨. PATH 1순위라도 캐시가 우선.
- **픽스**: 빌드 전 `rm -rf flutter/.dart_tool` 한 줄 추가 후 `flutter pub get` 재실행. package_config.json 의 rootUri 가 우리 SDK 로 다시 박힘. 확인: `python3 -c "import json; d=json.load(open('flutter/.dart_tool/package_config.json')); [print(p['name'],'→',p['rootUri']) for p in d['packages'] if p['name']=='flutter']"` 가 `~/flutter-3.24.5/packages/flutter` 가리켜야 정상.

### Mac 빌드 함정 9 — `flutter_rust_bridge_codegen` 이 `.dart_tool` 을 brew SDK 로 오염 (2026-05-20)
- **증상**: 함정 8 픽스 직후 `flutter pub get` 으로 package_config.json 을 우리 SDK 로 박았음에도, codegen 한 번 돌리면 brew Flutter 로 다시 바뀜.
- **원인**: `flutter_rust_bridge_codegen` 1.80.1 이 내부적으로 dart 도구 호출. dart 가 brew Flutter 일 경우 `.dart_tool` 을 brew 기준으로 재생성.
- **픽스**: 빌드 워크플로에서 **codegen 직후에도** `rm -rf flutter/.dart_tool && flutter pub get` 박을 것. 즉, 함정 8 의 클린 단계를 codegen 뒤에 한 번 더. CLAUDE.md 의 빌드 + 실행 명령 (위) 이 이미 빌드 직전에 박고 있어서 첫 빌드 정상 작동.

### Mac 빌드 함정 10 — `http_request_sync` 의 헤더 형식 + 응답 wrapper (2026-05-20)
RustDesk 의 두 HTTP 헬퍼가 서로 다른 헤더 형식을 요구하고, 응답을 다르게 감싼다. 새 API 호출 추가 시 반드시 매칭.

| 함수 | 헤더 입력 형식 | 응답 형식 |
|---|---|---|
| `post_request_sync` (common.rs:1494) | `"Name: value"` 단순 split (라인 1425). 그 외 무시 + Content-Type 자동 application/json | raw body 문자열 |
| `http_request_sync` (common.rs:1648) | **JSON object** `{"Name":"value"}` (라인 1313 `parse_json_header_entries`). array `[{...}]` 는 실패 → "HTTP header information parsing failed!" | **wrapper** `{"body":"<json string>"}` |

- **예전 실수**: 두 함수 모두에 array `[{"name":"Authorization","value":"..."}]` 박았다가 GET 인증 호출이 헤더 없이 가서 401, body 파싱도 wrapper 못 풀어서 `missing field 'customers'` 실패.
- **정석 패턴**:
  ```rust
  // 인증 헤더가 필요한 GET
  let header = format!(r#"{{"Authorization":"Bearer {}"}}"#, token);
  let raw = crate::http_request_sync(url, "GET".into(), None, header)?;
  let inner = serde_json::from_str::<HttpWrapper>(&raw).map(|w| w.body).unwrap_or(raw);
  let parsed: MyType = serde_json::from_str(&inner)?;
  ```
  `HttpWrapper { body: String }` 같은 wrapper 구조체 필수. body 가 stringified JSON 이므로 두 단계 파싱.

### Mac 빌드 함정 11 — Flutter incremental 이 dart kernel 재컴파일을 skip (2026-05-20)
- **증상**: `desktop_home_page.dart` 수정했는데 `python3 build.py --flutter` 가 통과하고 `.app` 도 갱신된 시점 박힘. 그러나 실행해보면 옛 UI 그대로. binary grep 으로 새 string 안 잡힘.
- **확인 방법**: `stat -f "%Sm" flutter/build/macos/Build/Products/Release/RustDesk.app/Contents/Frameworks/App.framework/Versions/A/App` 의 mtime vs 소스 mtime. App snapshot 이 소스보다 옛것이면 hit.
- **원인**: Flutter assemble 의 dart kernel snapshot 단계가 `.dart_tool/flutter_build/...stamp` 기반 incremental 판단 → 단일 파일 수정만으로 stamp 안 바뀌면 skip.
- **픽스**: `cd flutter && flutter clean && rm -rf .dart_tool build && flutter pub get` 후 재빌드. 단 `flutter clean` 이 `.dart_tool` 을 brew Flutter 로 재생성하므로 (함정 8) PATH 가 `~/flutter-3.24.5/bin` 가장 앞이어야 함. **export 로 sub-shell 까지 전파**되도록 빌드 명령에 `export PATH=...` 박을 것 (한 줄 변수는 sub-shell 에 inherit 안 될 수 있음).

### Next.js 16 함정 — middleware.ts → proxy.ts 이름 변경 (2026-05-20)
- **증상**: 패널의 `middleware.ts` matcher 가 `/api/*` 제외했는데도 Bearer 요청이 NextAuth 쿠키 미들웨어 307 리디렉트 → `/login?next=...` 로 떨어짐 → 본사 앱 401/거래처 0건.
- **원인**: Next 16 부터 `middleware.ts` → `proxy.ts` 로 이름 변경 (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`). 옛 `middleware.ts` 가 어떤 경로로든 동작하면서 matcher 처리 변동 발생.
- **픽스**: 파일명 `proxy.ts` 로 변경 + 내부에 이중 안전망 `if (req.nextUrl.pathname.startsWith("/api")) return NextResponse.next();` 명시 박음. matcher 만 믿지 말고 함수 진입부에서 한 번 더 거름.
- 기능 자체는 동일 (auth callback, NextAuth v5 edge runtime).

### TLS 함정 — RustDesk reqwest/rustls + Synology nginx 호환 (2026-05-20)
- **증상**: `curl https://sepani.synology.me:3443/api/customers` 는 통과(HTTP/2 200, 거래처 5건). 같은 URL 을 Mac 본사 앱이 호출하면 `peer closed connection without sending TLS close_notify` (rustls) → `Error -9806 connection closed via error` (native-tls fallback) → 둘 다 실패 → RustDesk fallback 으로 `sepani.synology.me:21116` TCP proxy 까지 떨어짐(무관한 hbbs relay 포트).
- **원인**: rustls 와 Synology DSM 의 nginx (Reverse Proxy 의 자체 nginx) 가 TLS 1.3 close_notify 처리에서 호환 불안정. native-tls (SecureTransport) 도 같은 양상.
- **채택한 해결**: HTTPS 포기 + HTTP 3001 직노출 (이슈 2 참조). Chang 의 보안 의지(낮음)와 정합.
- **향후 HTTPS 가 필요해지면**: Cloudflare Tunnel 또는 별도 nginx 컨테이너(certbot) 로 TLS termination 우회. Synology 의 Reverse Proxy 는 rustls 와 안 맞음을 전제.

### 빌드 + 실행 명령 (재사용 가능)
```bash
cd ~/내작업/ChainRemote && \
  source $HOME/.cargo/env && rustup default 1.81 && \
  PATH="$HOME/flutter-3.24.5/bin:$HOME/.local/bin:$PATH" \
  VCPKG_ROOT=$HOME/vcpkg \
  MACOSX_DEPLOYMENT_TARGET=12.3 \
  LANG=en_US.UTF-8 \
  bash -c 'cd flutter && rm -rf .dart_tool && flutter pub get && cd ..' && \
  python3 ./build.py --flutter --unix-file-copy-paste --screencapturekit && \
  pkill -9 RustDesk ChainRemote 2>/dev/null; \
  rm -rf /Applications/ChainRemote.app && \
  cp -R flutter/build/macos/Build/Products/Release/RustDesk.app /Applications/ChainRemote.app && \
  cp deploy/custom-hq.txt /Applications/ChainRemote.app/Contents/Resources/custom.txt && \
  codesign --force --deep --sign - /Applications/ChainRemote.app && \
  open /Applications/ChainRemote.app
```

**왜 `/Applications/ChainRemote.app` 까지 복사하는가** (2026-05-20 함정):
- `build/macos/Build/Products/Release/RustDesk.app` 가 새 빌드, `/Applications/ChainRemote.app` 가 매일 켜는 것 (Spotlight·Dock). 둘은 다른 파일.
- build dir 빌드만 갱신하고 `open` 하면 새 코드 검증 가능. 단, Chang/재성이가 평소 Launchpad 로 켜는 건 옛 .app → "코드 적용 안 됨" 착각.
- 빌드 워크플로에 `/Applications` 복사 + 재서명까지 포함해야 두 vector 일치.

### 알려진 이슈/생략된 옵션
- **`--hwcodec` 생략됨**: ffmpeg 컴파일 30~60분 소요. 필요해지면 `vcpkg install ffmpeg` 후 추가.
- **ad-hoc 서명**: 개발용. 배포 시 Apple Developer 인증서로 정식 서명 + notarization 필요.
- **git submodule**: `libs/hbb_common` 첫 클론 시 빠짐 → `git submodule update --init --recursive` 필수.

## 첫 실행 검증 (2026-04-30)
- Mac에서 ChainRemote 빌드본 실행 ✅
- 옆자리 윈컴(공식 RustDesk)과 원격 연결 성공 ✅
- 다만 **공개 RustDesk 서버 사용 + 소프트웨어 코덱**이라 AnySupport보다 느린 체감.
- → Step 3 한국 자체 서버 구축 시 큰 개선 예상 (P2P 성공률↑, 레이턴시↓).

## Web Client v1 검증 (2026-04-30, 폐기)
- v1 코드를 git history(커밋 5faf0ad3c^)에서 복원해봄
- 빌드 환경(yarn/protoc)까지 갖춤, 경로 문제 패치까지 마침
- vendor 자산 누락 + protobuf 호환 의문 + RustDesk 공식 deprecated 경고
- **결론: v1은 사용 불가, 옵션 C(.exe)로 전략 전환**
- 복원된 코드는 `flutter/web/v1/`에 있으나 사용하지 않음 (참고용으로만 보존)

## 기술 스택 빠른 참조
| 영역 | 스택 | 위치 |
|------|------|------|
| 코어 엔진 | Rust | `src/`, `libs/` |
| UI | Flutter (데스크톱+모바일) | `flutter/` |
| 레거시 UI | Sciter (deprecated, 무시) | `src/ui/` |
| 시그널링 서버 | hbbs (TCP 21115-21116) | 별도 배포 |
| 릴레이 서버 | hbbr (TCP 21117, UDP 21116) | 별도 배포 |
| 코덱 | VP8/VP9/AV1 SW, H.264/H.265 HW | `libs/scrap/` |

## 플랫폼 우선순위
- **관리자**: macOS, Windows (Phase 1) → iPhone, iPad (Phase 3)
- **고객**: Windows + 웹브라우저만 (Phase 1)

## 결정된 스택 (2026-04-30, **NAS 자체 호스팅으로 수정**)

### 관리 웹 패널 (Step 5)
- **Frontend + Backend**: Next.js (TypeScript) — 풀스택
- **DB**: PostgreSQL 16 — **Chang 댁 DS220+ NAS의 도커 컨테이너** (Supabase 폐기)
- **Auth**: NextAuth.js 또는 Auth.js — 나중에 추가
- **개발 단계 호스팅**: 로컬 Mac에서 `npm run dev` (DB는 NAS)
- **운영 단계 호스팅**: NAS Container Manager 또는 사무실 PC (TBD)
- **설계 원칙**: 첫날부터 **멀티테넌시(SaaS) 구조** (고객사 격리, RBAC, 감사 로그)

### 시그널링/릴레이 서버 (Step 3)
- **hbbs + hbbr**: RustDesk Rust 바이너리, 도커
- **호스팅 후보 1**: Chang 댁 NAS (KT 1Gbps, 24/7 ON, 외부 노출 가능)
- **호스팅 후보 2**: 한국 VPS ($5/월) — NAS 안정성 검증 후 결정
- 결정 시점: Step 3 착수 시

### 도메인 (기존 자산 재사용)
- `remote.betaposlab.com` → 거래처 가이드 페이지 (옵션 C: .exe 다운로드)
- `admin.betaposlab.com` → 관리 패널 (NAS 또는 Vercel — TBD)
- 기존 betaposlab.com과 충돌 없이 공존

### NAS PostgreSQL 접속 정보
- **호스트**: 192.168.68.103 (사내 LAN), Synology 호스트명 `kimfam`
- **포트**: 15432 (5432는 Synology 자체 사용 중)
- **DB명**: chainremote
- **사용자**: chainremote
- **비번**: `/Users/changsmac/내작업/ChainRemote/.nas-db-password` (gitignored)
- **접속 검증**: `psql -h 192.168.68.103 -p 15432 -U chainremote -d chainremote`
- **컨테이너 이름**: chainremote-postgres
- **외부 노출**: 안 됨 (LAN 내부만, 보안상 OK)
- **외부 접속 시**: SSH 터널 또는 향후 VPN

### NAS 자동화 셋업 (2026-04-30 완료)
- SSH 키 인증 (`~/.ssh/id_ed25519`) — Mac → NAS 무비번
- 패스워드리스 sudo: `chang` 사용자에게 docker/docker-compose만 한정
- 명령 예: `ssh chang@192.168.68.103 "sudo /var/packages/ContainerManager/target/usr/bin/docker ps"`

### 확장성 가정
- **현재**: 사무실 직원 + 하루 10건
- **목표**: 고객사 100개 × 일 20건(=2,000건/일)까지 코드 재작성 0회, 플랜 업그레이드만으로 대응
- 영상은 P2P이므로 서버 부하 미미. 동시 수십 세션도 $5 VPS로 감당.

## 미정 (Chang 지시 대기)
최종 브랜드명, 사업화 라이선스 전략(AGPL 유지 vs Server Pro 구매), 과금 모델 구체 금액.

## RustDesk 코드 규칙
`AGENTS.md` 참조 — Rust(unwrap 금지/clone 최소화), Tokio(중첩 런타임 금지/await 락 금지), 편집 위생(최소 diff).

## 토큰 절약
- 큰 파일 전체 읽지 말고 grep/Read offset 활용.
- 광범위 탐색은 Explore 서브에이전트로 위임.
- 결과 보고는 짧게.
