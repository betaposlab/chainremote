# ChainRemote — RustDesk 대비 변경 내역

본 문서는 **AGPL v3 의 "변경 사항 명시" 의무**를 충족하기 위한 요약이자, ChainRemote 가 RustDesk 와 어떻게 다른지를 한눈에 보여주는 가이드입니다.

> 베이스: [RustDesk 1.4.6](https://github.com/rustdesk/rustdesk/releases/tag/1.4.6) (2026년 4월 fork)
> 라이선스: AGPL v3 (원본과 동일)

---

## 1. 새로 작성된 컴포넌트 (RustDesk 에 없음)

### 1-1. 관리 패널 — `chainremote-admin/`
- **스택**: Next.js 16 + TypeScript + Drizzle ORM + PostgreSQL 16
- **기능**: 멀티테넌트 회사 등록 / 거래처 풀 / 직원 즐겨찾기 / 지원 이력 / 권한 관리 (`super_admin` / `owner` / `member`)
- **API**: Bearer JWT (24 시간 TTL) 인증의 REST API. 본사 데스크톱 앱이 이 API 로 거래처 목록과 즐겨찾기를 동기화.
- **운영 위치**: 베타포스랩 자체 클라우드 서버의 Docker 컨테이너 (2026-08 NAS 에서 이전).

### 1-2. ChainGo — 무흔적 포터블 HQ — `libs/portable/`, `deploy/portable/`
- 단일 SFX `.exe` (24 MB). 빌린 PC 에서 다운 → 더블클릭 → 로그인 → 1 클릭 원격 → 닫기 시 호스트 PC 에 흔적 0.
- 격리 4 중: `Config::path()` APP_DIR honor / `Config::ipc_path()` 윈도우 파이프 접미사 / FindWindowW 분리 / quick_support 자동 추론 가드.
- 출력: `deploy/portable/ChainGo.exe`.

### 1-3. 자동 업데이트 — `src/chainremote_updater.rs` + `src/chainremote_push_agent.rs`
- **HQ 채널** (`chainremote_updater.rs`): 24 시간 latest.json 폴링. dual-channel manifest (`{ hq, agent }`) 로 HQ ↔ Agent 분리. SHA-256 검증 후 활성 세션 없을 때 `/VERYSILENT` 사일런트 재설치.
- **Agent 채널** (`chainremote_push_agent.rs`, v1.3.5+ 신규): Agent (incoming-only) 빌드 전용. latest.json 자동 채널 폐기, 본사 관리 패널의 수동 푸시만 폴링 (`/api/customers/pending-update`, 5 분 주기).
  - 영업시간 가드 (default 00:00~07:00) + 무작위지연 (default 0~7시간) + 원격세션 가드 = 영업 중 사고 방지.
  - 2026-05-28 영업시간 중 자동 인스톨러 마법사가 뜬 사고를 계기로 영구 차단.
- `MANUAL_TRIGGER_FLAG` 파일을 통한 즉시 트리거 지원 (HQ 채널).
- 본사 측 발행 스크립트: `deploy/release-full.sh` (윈컴 원격빌드 → sha 검증 → 배포처 3곳).

### 1-4. 인스톨러 (Windows) — `deploy/win-installer/`
- **`agent-installer.iss`**: 거래처용. RustDesk 1.4.6 silent install → `RustDesk2-agent.toml` 배치 → 단축 아이콘을 `ChainRemote` 로 atomic rename → 자동 시작 레지스트리 키 등록 → ephemeral port 확장.
- **`hq-installer.iss`**: 본사 직원용. 영구 비밀번호 toml 동봉 (옵션 B+ 토글로 양방향 원격 가능).
- 한국 환경 안전망: `netsh int ip set dynamicport tcp start=10000 num=55000` 자동 적용.

### 1-5. 사업화 / 멀티테넌트 — `db/migrations/006_*`
- `tenants` 테이블에 사업자 등록번호 · 대표자 · 연락처 · 결제 계좌 · 구독 정보 컬럼 추가.
- `user_role` enum 에 `super_admin` 추가.
- 신규 테넌트 등록 / 비밀번호 리셋 / 일시정지 / 해지 흐름을 패널에서 처리.

### 1-6. 거래처 push 시스템 — `db/migrations/009_pending_updates.sql` + 패널 API + Agent (v1.3.5+)
- `pending_updates` 테이블 + 부분 unique 인덱스로 거래처별 1행씩 push 큐. 일괄 푸시는 `bulk_batch_id` 로 N행 묶음.
- 관리 패널 거래처 표에서 행별 [⬆ 푸시] / 상단 [⬆ 전체 일괄 푸시] 버튼.
- 거래처 Agent 는 `chainremote_push_agent` 가 5 분 주기 GET 폴링. 영업시간/무작위지연/원격세션 가드 통과 시 사일런트 설치 → POST applied 보고.
- Pull 모델: 서버가 신호를 쏘지 않음. 2000+ 거래처에도 서버 부하 = INSERT 1회.

### 1-7. 거래처 관제 (RustDesk 에 없는 자가치유)

- **방화벽 자동 해제** — 거래처 PC 의 방화벽이 우리 포트를 막으면 에이전트가 감지해 되살린다. 거래처별 on/off.
- **카드결제 데몬 관제** — POS 의 VAN 데몬(KSNET `KSCAT`)이 멈추면 카드가 안 긁히는데 화면엔 아무 표시가 없다. 에이전트가 포트를 감시하다 되살린다. 단, IC 리더기가 꺼진 정상 상태와 고장을 구분한다(프로세스 유무 + 이번 부팅 정상 이력).
- **디스크 관제 / 원격 Temp 정리** — 여유 공간을 보고하고, 원격 접속 없이 임시파일을 정리한다.

### 1-8. 연결 경로 계측

- **직결/릴레이 기록** — 세션마다 어느 경로로 이어졌는지 남겨 릴레이 비중을 실측한다.
- **경로 점검(프로브)** — 거래처마다 연결만 해 보고 끊어 직결 여부를 판정한다. 로그인 요청 전에 끊으므로 거래처 화면에는 아무것도 뜨지 않는다.
- **UPnP 문 검증** — 공유기가 포트를 열었다고 대답해도 실제로는 전달하지 않는 제품이 있어, 서버가 바깥에서 두드려 확인한 주소만 인정한다.

---

## 2. RustDesk 코드 패치 (수정 또는 확장)

### 2-1. Rust 측 (`src/`, `libs/`)
- **`src/chainremote_auth.rs`** (신규): 본사 앱 로그인 / 토큰 메모리 전용 / 비밀번호 변경 FFI.
- **`src/chainremote_data.rs`** (신규): 관리 패널 API 호출 → 거래처 목록 캐시.
- **`src/chainremote_portable_init.rs`** (신규): ChainGo 포터블 모드 초기화.
- **`src/common.rs`**: `read_custom_client` 가 plain JSON 도 허용 (원본은 base64 + ed25519 서명만). 우리 `custom.txt` 의 `conn-type` 토글에 사용.
- **`src/rendezvous_mediator.rs`**: `chainremote-allow-incoming` 옵션을 통한 HQ 빌드 양방향 원격 (옵션 B+).
- **`libs/hbb_common/src/config.rs`**: `Config::path()` 가 데스크톱에서도 `APP_DIR` 환경 변수를 존중하도록 패치 (ChainGo 격리용).
- **`libs/hbb_common/src/lib.rs`**: peer password decrypt 의 dual-key fallback (machine_uid race 회피).

### 2-2. Flutter 측 (`flutter/lib/`)
- **`chainremote_auth_gate.dart`** (신규): 본사 앱 로그인 게이트.
- **`desktop_home_page.dart`**: 즐겨찾기 탭 디폴트 / 내 ID 칩 / 로그아웃 / 비밀번호 변경 / ChainGo 배지.
- **`desktop_tab_page.dart`**: `isIncomingOnly()` 일 때 AuthGate 우회 (거래처 빌드용).
- **`desktop_setting_page.dart`**: 외부 원격 접속 허용 토글 (옵션 B+) / 업데이트 확인 버튼 / About 화면 ChainRemote 브랜딩.
- **`remote_tab_page.dart`, `remote_toolbar.dart`**: 원격 세션 종료 확인 다이얼로그 (활성 세션 끊김 사고 방지).
- **`models/peer_tab_model.dart`**: 첫 진입 탭을 즐겨찾기로 강제.

### 2-3. 한국어 텍스트 / UI 톤
- 메인 / 설정 / 다이얼로그 / 토스트 등 사용자 노출 텍스트 다수를 한국어로 번역 또는 한국 POS A/S 컨텍스트에 맞게 수정.
- 액센트 색상 `#1E5BFF` (베타포스랩 톤) 적용.

---

## 3. 운영 인프라 (2026-08 클라우드 전환)

- **시그널링 / 릴레이**: RustDesk hbbs / hbbr 를 클라우드 Docker 로 가동. `rs.626.kr`(21115~21116) / `relay.626.kr`(21117).
- **관리 패널**: `https://626.kr` (브라우저) · `https://api.626.kr` (본사 앱·에이전트 API). TLS 자동 갱신.
- **DB**: PostgreSQL 16, 같은 호스트의 별도 컨테이너. 루프백 전용(외부 미노출).
- **자동 업데이트 채널**: `agent-push.json`(거래처) / `latest.json`(본사 앱). 정적 파일 배포만 NAS 웹스테이션에 남아 있다.

---

## 4. 제거하거나 비활성화한 부분

- **virtual_display 드라이버**: HW 인코더 충돌로 거래처에서 자동 업데이트 깨지는 사고 발생 → 제거.
- **트레이 메뉴의 "서비스 중지" / "종료"**: 거래처가 실수로 자가 중단하는 사고 방지를 위해 영구 숨김 (v1.2.20+).
- **agent 인스톨러의 영구 비밀번호 평문 박기**: 보안 약점이라 제거. `approve-mode=click` — 거래처가 **매 세션 수락을 클릭**한다. 영구 비밀번호·무인 접속 모드는 쓰지 않는다(2026-06 확정).

---

## 5. 라이선스 의무 사항

- ChainRemote 의 전체 소스 코드는 https://github.com/betaposlab/chainremote 에서 확인 가능합니다.
- AGPL v3 의 조건에 따라, ChainRemote 를 받은 사용자는 본 소스 코드에 접근하고 수정 · 재배포할 권리를 가집니다.
- RustDesk 원본의 저작권 표시는 본 저장소의 `LICENCE` 및 본 문서를 통해 명시됩니다.
- AGPL v3 라이선스 전문: https://www.gnu.org/licenses/agpl-3.0.html

---

## 6. 2026-05-25 이후 주요 변경 요약

문서를 매 릴리즈마다 다시 쓰지 않기 위해, 그 뒤의 변경은 항목만 적는다. 구체적인 내용은
언제나 커밋 히스토리가 정본이다.

- **멀티테넌트 SaaS 화** — 대리점(tenant) 단위 격리, 권한 3단(`super_admin`/`owner`/`member`),
  대리점별 설치본(auto-enroll + per-tenant overlay).
- **좌석 enforcement** — 한 계정 = 동시 1세션. 다른 기기에서 로그인하면 인수(takeover)하고
  옛 기기는 스스로 세션을 끊는다.
- **32비트 통합 인스톨러** — 한 파일이 x64(Flutter)와 i686(Sciter) 페이로드를 모두 담고
  설치 시 OS 아키텍처로 갈라 설치한다. Windows 7 SP1 32비트부터 동작.
- **거래처 관제 3종** — 방화벽 자동 해제, 카드결제(VAN) 데몬 감시·재시작, 디스크 여유 보고와
  원격 임시파일 정리. 전부 거래처별 on/off 이고 기본은 off.
- **연결 경로 계측** — 세션마다 직결/릴레이를 기록하고, 접속 없이 경로만 점검하는 프로브와
  UPnP 포트 개방 실검증을 추가.
- **원격 예약** — 본사가 시간대를 제안하고 거래처가 한 번 승인하면 그 구간에는 매번 수락을
  누르지 않아도 된다. 승인 후 24시간 상한.
- **인프라 이전** — 시그널링·릴레이·관리 패널·DB 를 자체 클라우드 서버로 이전(2026-08).
  설치파일 정적 배포만 NAS 웹스테이션에 남아 있다.

---

마지막 갱신: 2026-09-02
