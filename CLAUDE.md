# ChainRemote (체인리모트)

> RustDesk 포크 기반 자체 원격지원 솔루션. 코이노 AnySupport 대체 + B2B 사업화 진입.
> 상세 기획: `ChainRemote_기획서.md` · RustDesk 코드 가이드: `AGENTS.md`

## 문서 안내 (CLAUDE.md 슬림화, 2026-05-26)

이 파일은 **매 세션 자동 인지되는 핵심**만. 자주 안 보는 정보는 `docs/chainremote/` 분리됨:

- 옛 이슈 / 완료 history / 사업화 phase / ChainGo / 옵션 B+ → `docs/chainremote/HISTORY.md`
- 거래처 운영 워크플로우 / NAS 셋업 / DB 접속 / 관리 패널 위치 → `docs/chainremote/OPERATION.md`
- 작업 backlog / 알려진 이슈 → `docs/chainremote/BACKLOG.md`
- Phase 1~3 작업 계획 / 청사진 / 결정된 스택 → `docs/chainremote/PHASES.md`
- Mac/Windows 빌드 함정 8~12 / Next.js / TLS → `docs/chainremote/BUILD_PITFALLS.md`

---

## 프로젝트 핵심

- **베이스**: rustdesk/rustdesk (1.4.6+) 포크. 바닥부터 만들지 않음.
- **목표**: 코이노 월 10만원/seat → 우리 월 2~3만원/대리점. 50개 대리점 판매 + 거래처 200+ POS/키오스크 원격 A/S.
- **라이선스**: AGPL v3 (전체 소스 공개). About 화면에 출처 + 변경 내역 링크 명시.
- **체인오더 시스템과 완전 분리** — 별도 프로젝트.

---

## Chang 작업 환경

### 데일리 드라이버
- **MacBook Pro 16" M2 Max** — Chang 의 유일한 데일리 드라이버. 집/사무실 항상 들고 다님.
- **사무실엔 윈컴 없음.** 사무실에서 윈컴 작업 = 거래처 PC 직접 만지거나 Mac → 집 윈컴 원격.

### 집 윈컴 (Chang 본인 — 빌드/HQ 겸용)
- **위치**: 집. 사용자명 `zenta`. 절전 모드 기본.
- **하드웨어**: Ryzen 9 9900X / Radeon RX 9070 / DDR5 64GB. 하이엔드. 빌드/메모리 부족이 빌드 실패 원인일 가능성 거의 0.
- **역할**: Windows 빌드 머신 (ChainRemote 풀빌드 환경 셋업 완료) + HQ 워크스테이션.
- **원격 접속**: 사무실 Mac → 집 윈컴 = ChainRemote HQ (옵션 B+ 토글 ON). 백업 = Chrome Remote Desktop. WoL: `gogo` 명령어 (Tailscale 위로 매직패킷). 메모리 [reference_home_infra].
- **빌드 환경**: `C:\src\ChainRemote\`. 풀빌드 도구 (Rust 1.81, Flutter 3.24.5, vcpkg, LLVM 18, Inno Setup 6) 셋업 완료.

### 재성이 윈컴 (HQ 사용자)
- **위치**: 사무실 또는 본인 집. Windows 데일리드라이버.
- **역할**: 순수 HQ 사용자 — 거래처 원격만. 피지원자 아님.
- **현재 상태**: 안정화 전까지 **테스트 용**. 자동업데이트 검증 진행 중 (2026-05-26).

### NAS (Synology DS220+ "kimfam")
- **위치**: 집. KT 1Gbps. 192.168.68.103 (LAN). DDNS `sepani.synology.me`.
- **서비스**: hbbs/hbbr (21115~21118), PostgreSQL 15432 (LAN-only), chainremote-admin (3001/3443).
- **외부 접속**: API HTTP 3001 직노출 (어디서나 도달), HTTPS 3443 (브라우저). DB 직접 노출 X.
- **자세히**: 메모리 [project_admin_panel], [reference_home_infra], `docs/chainremote/OPERATION.md`.

### 거래처 PC (외부 사용자)
- **OS**: 윈도우 (POS/키오스크) 100%.
- **빌드**: Agent (`ChainRemote_Agent_Setup_v*.exe`). 영구비번 + watchdog + 자동업데이트.
- **현재 셋업된 거래처 5곳**: 중앙리, 우리집(=Chang 집 윈컴, 옛 셋업 잔재), 진희씨 컴, 바다양푼이 동태찜, 재성이 컴.

### 도구 분담
- **ChainRemote**: 거래처 원격 (본업) + 사무실 Mac → 집 윈컴 (옵션 B+ 토글 ON)
- **Chrome Remote Desktop**: 백업용. 사업화 시 영향 0.
- **Tailscale + SSH**: Mac → NAS / 집 윈컴 명령형 작업. 헤드리스 빌드 자동화는 폐기 (메모리 [feedback_no_autobuild_workflow]).

---

## 절대 원칙

### 고객 UX (★최우선)
**채택**: 옵션 C — 네이티브 .exe 단순 실행. 웹 클라이언트 폐기.

**고객이 할 일은 딱 2가지**: ① 받은 .exe 더블클릭 ② 비밀번호 입력. 끝.
- 코이노 4단계(988.co.kr 방문→세션입력→다운→실행)를 **2단계로 축소** = 핵심 차별화.
- 자주 보는 거래처는 **무인 접속 모드** 1회 설정 → 그 후 거래처 PC 조작 불필요.
- UX 단순화를 깨는 제안 거부.

**왜 웹 클라이언트(WebRTC) 폐기**: RustDesk v1 소스 삭제됨 + v2 유료. ROI 낮음. 거래처 99% Windows라 .exe로 충분. 상세는 `docs/chainremote/PHASES.md`.

### 작업 방식
- **단계별**: 기획서 §6 Step 1~8 순서 준수. 단계 완료 후 다음.
- **정석 구현**: 임시방편/Workaround 금지. 기술적으로 올바른 방식만.
- **테스트 서버 우선**: 모든 배포는 테스트 → 본서버/GitHub push는 Chang 지시 시에만.
- **결과만 보고**: 코드 덤프 X, 간결한 완료 보고만.
- **잘 돌던 로직은 건들지 말 것**: ChainRemote 의 운영 중인 시스템 (영구비번, IPC, 거래처 5곳, NAS 패널, 자동업데이트 등) 을 *부수효과로* 망가뜨리는 변경은 절대 금지. Master variable (APP_NAME / BINARY_NAME / Bundle ID / IPC pipe 이름 등 cascade 영향이 큰 핵심값) 변경은 Chang 의 명시 OK 를 받았어도 별도 안전 게이트 발동: (1) 위험 한 번 더 명시 + 재확인 (2) cascade 영향 가지 다 grep / Read 로 추적 (3) 마이그레이션 코드는 step-by-step 검증. 자세히는 메모리 [feedback_dont_touch_working_logic].

### 앱 구조 불변 원칙

이 셋은 어떤 상황·시나리오에서도 유지된다. UI/IA 설계 시 전제로 깔 것.

1. **본사 빌드는 한 벌, 거래처 빌드는 별도.** 본사 직원이 늘어도 본사 빌드는 1개. 차이는 로그인 계정으로만 갈라짐.
2. **거래처 풀의 진실 원천은 관리 패널 DB.** 로컬 peer 캐시 아님. Chang 이 등록한 거래처를 재성이가 자기 본사 앱에서 그대로 봐야 함.
3. **사업화 진입 (2026-05-24)**: 코이노 월 10만/seat 대비 월 2~3만/tenant 가격 차별로 소규모 밴 대리점(50개 목표) 에 판매. 1 카피 = 1 대리점(tenant) = 직원 N명 + 가맹점 무제한. Chang+재성이(betaposlab tenant) 는 별개 tenant 로 우리 본업 운영 그대로.

---

## 앱 구조 청사진 (8개 결정 — 변경 시 전체 작전 재검토)

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
│ [홈 = 즐겨찾기 탭 착지]  │  │ • 모든 거래처 표      │
│ • 즐겨찾기 (내 것만)    │  │ • 모든 직원 즐겨찾기  │
│ • 최근 세션 (네이티브)  │  │ • 지원이력           │
│ • 1클릭 원격            │  │ • 권한 관리          │
│ • [업데이트 확인] 버튼   │  │                      │
└────────┬────────────────┘  └──────┬───────────────┘
         └──── NAS PostgreSQL ◄─────┘
              (진실 원천)
```

**8개 결정**:
1. 사업화 진입 — 멀티테넌트 SaaS. 50 대리점 목표.
2. 거래처 빌드 = 수신만. 별도 빌드(`custom-agent.txt` = `conn-type=incoming`).
3. 본사 앱 로그인 (chang/jaesung 각자 비번 6002).
4. 동시간 각자 다른 거래처 원격 가능. RustDesk 다중 viewer native 지원.
5. **본사 앱 = 최근 세션 + 즐겨찾기 두 탭, 즐겨찾기 탭으로 착지**. 전체 거래처 마스터 뷰는 **관리 패널 전용**.
   - 최근 세션: 네이티브 `mainLoadRecentPeers`. 우클릭 → 즐겨찾기 추가.
   - 즐겨찾기: `GET /api/me/favorites` (내 것만). 앱 열면 이 탭으로 착지.
   - 코드: [peer_tab_model.dart](flutter/lib/models/peer_tab_model.dart) init `_currentTab=fav`.
6. 관리 패널 = 모든 직원의 즐겨찾기까지 조회 가능. user_favorites 테이블 신설.
7. 권한: chang = 모두. jaesung = 읽기 + 원격 + 거래처 추가 + 자기 즐겨찾기 관리. 거래처 수정/삭제·직원 관리는 chang만.
8. 업데이트 = 설정에 "업데이트 확인" 버튼 + 24h 자동 폴링.

**부수 결정** — 본사 앱 상단바에 본인 9자리 ID 칩 + 클릭 복사 ([desktop_home_page.dart](flutter/lib/desktop/pages/desktop_home_page.dart) `_buildMyIdChip`).

---

## 현재 단계 (2026-05-26 갱신)

- ✅ **Phase 1** 거래처/본사 빌드 분리 — 단계 1~5 완료. 단계 6 검증 진행 중.
- ✅ **Phase 2** 본사 협업 완성 (6/6).
- ✅ **Phase 3** Mac + Windows 브랜딩 완성 (2026-05-25~26). BINARY_NAME / APP_NAME / Bundle ID 모두 ChainRemote.
- ✅ **AGPL v3 준수** (About + README + CHANGES).
- ✅ **사업화 phase 1+2** 완성.
- ⏳ **자동업데이트 실증 검증** — 재성이 PC (테스트 용) 에서 v1.2.8 → v1.3.0 마이그레이션 검증 진행 중.
- ⏳ **드래그앤드롭 파일전송** — backlog. macOS sub-window 의 desktop_drop 미동작 진단 후 native 코드 직접 박는 방향.
- ⏳ **디자인 의뢰** — 메인/상단바/설정 페이지. 한국 B2B SaaS 톤 (토스/카카오뱅크 참고).

자세히: `docs/chainremote/HISTORY.md`, `docs/chainremote/BACKLOG.md`, `docs/chainremote/PHASES.md`.

---

## Mac 빌드 + 실행 명령 (재사용 가능)

```bash
cd ~/내작업/ChainRemote && \
  source $HOME/.cargo/env && rustup default 1.81 && \
  export PATH="$HOME/flutter-3.24.5/bin:$HOME/.local/bin:$PATH" && \
  export VCPKG_ROOT=$HOME/vcpkg && \
  export MACOSX_DEPLOYMENT_TARGET=12.3 && \
  export LANG=en_US.UTF-8 && \
  (cd flutter && rm -rf .dart_tool && flutter pub get) && \
  python3 ./build.py --flutter --unix-file-copy-paste --screencapturekit && \
  pkill -9 RustDesk ChainRemote 2>/dev/null; \
  rm -rf /Applications/ChainRemote.app && \
  cp -R flutter/build/macos/Build/Products/Release/ChainRemote.app /Applications/ChainRemote.app && \
  cp deploy/custom-hq.txt /Applications/ChainRemote.app/Contents/Resources/custom.txt && \
  codesign --force --deep --sign - /Applications/ChainRemote.app && \
  open /Applications/ChainRemote.app
```

**핵심 주의사항** (자세히는 `docs/chainremote/BUILD_PITFALLS.md`):
- ⚠️ `export` 필수 (sub-shell 까지 전파). 빌드 시작 직후 `which flutter` 가 `~/flutter-3.24.5/bin/flutter` 인지 확인.
- ⚠️ `.dart_tool` 클린 (homebrew Flutter SDK 누수 + codegen 오염 회피).
- ⚠️ `/Applications/ChainRemote.app` 까지 복사 + 재서명 (Spotlight·Dock 이 매일 켜는 것).
- Phase 3-Mac: macOS 가 새 bundle id (`com.betaposlab.chainremote`) 를 다른 앱으로 인식 → 화면 기록/입력 모니터링/접근성 권한 첫 실행 시 재승인.

## Windows 빌드 (윈컴 SSH)

자세히는 메모리 [project_win_remote_build_ssh]. Mac → Tailscale `zenta@100.120.242.67` SSH 빌드.

윈컴 직접 빌드 (Chang 윈컴 앞):
```powershell
cd C:\src\ChainRemote
.\deploy\win-build\build-all.ps1   # Rust + Flutter 풀빌드
cd deploy\win-installer
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" agent-installer.iss
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" hq-installer.iss
```

---

## 토큰 절약

- 큰 파일 전체 읽지 말고 grep/Read offset 활용.
- 광범위 탐색은 Explore 서브에이전트로 위임.
- 결과 보고는 짧게.
- 옛 기록 필요할 때만 `docs/chainremote/*.md` 명시 Read.
