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
- **운영 위치**: 베타포스랩 자체 NAS Docker 컨테이너.

### 1-2. ChainGo — 무흔적 포터블 HQ — `libs/portable/`, `deploy/portable/`
- 단일 SFX `.exe` (24 MB). 빌린 PC 에서 다운 → 더블클릭 → 로그인 → 1 클릭 원격 → 닫기 시 호스트 PC 에 흔적 0.
- 격리 4 중: `Config::path()` APP_DIR honor / `Config::ipc_path()` 윈도우 파이프 접미사 / FindWindowW 분리 / quick_support 자동 추론 가드.
- 출력: `deploy/portable/ChainGo.exe`.

### 1-3. 자동 업데이트 — `src/chainremote_updater.rs` + `src/chainremote_push_agent.rs`
- **HQ 채널** (`chainremote_updater.rs`): 24 시간 latest.json 폴링. dual-channel manifest (`{ hq, agent }`) 로 HQ ↔ Agent 분리. SHA-256 검증 후 활성 세션 없을 때 `/VERYSILENT` 사일런트 재설치.
- **Agent 채널** (`chainremote_push_agent.rs`, v1.3.5+ 신규): Agent (incoming-only) 빌드 전용. latest.json 자동 채널 폐기, 본사 관리 패널의 수동 푸시만 폴링 (`/api/customers/pending-update`, 5 분 주기).
  - 영업시간 가드 (default 00:00~07:00) + 무작위지연 (default 0~7시간) + 원격세션 가드 = 영업 중 사고 방지.
  - 2026-05-28 중앙리 거래처 영업시간 자동 인스톨러 마법사 사고 (12:50PM) 영구 차단.
- `MANUAL_TRIGGER_FLAG` 파일을 통한 즉시 트리거 지원 (HQ 채널).
- 본사 측 푸시 스크립트: `deploy/release.sh`.

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
- Pull 모델: NAS 가 신호 쏘지 않음. 2000+ 거래처에도 NAS 부하 = INSERT 1회.

---

## 2. RustDesk 코드 패치 (수정 또는 확장)

### 2-1. Rust 측 (`src/`, `libs/`)
- **`src/chainremote_auth.rs`** (신규): 본사 앱 로그인 / 토큰 메모리 전용 / 비밀번호 변경 FFI.
- **`src/chainremote_data.rs`** (신규): NAS 관리 패널 API 호출 → 거래처 목록 캐시.
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

## 3. 운영 인프라

- **시그널링 / 릴레이**: RustDesk hbbs / hbbr 바이너리를 NAS Docker 로 가동. 도메인 `sepani.synology.me`.
- **관리 패널 API**: HTTP 3001 (외부 직노출) + HTTPS 3443 (브라우저용 Reverse Proxy).
- **DB**: PostgreSQL 16, NAS 의 별도 Docker 컨테이너 (`chainremote-postgres`, LAN 전용 포트 15432).
- **자동 업데이트 채널**: NAS Web Station 의 `chainremote/` 디렉터리.

---

## 4. 제거하거나 비활성화한 부분

- **virtual_display 드라이버**: HW 인코더 충돌로 거래처에서 자동 업데이트 깨지는 사고 발생 → 제거.
- **트레이 메뉴의 "서비스 중지" / "종료"**: 거래처가 실수로 자가 중단하는 사고 방지를 위해 영구 숨김 (v1.2.20+).
- **agent 인스톨러의 영구 비밀번호 평문 박기**: 보안 약점이라 제거. `approve-mode=click` 로 거래처가 수락 클릭 또는 자체 영구 비밀번호 설정.

---

## 5. 라이선스 의무 사항

- ChainRemote 의 전체 소스 코드는 https://github.com/betaposlab/chainremote 에서 확인 가능합니다.
- AGPL v3 의 조건에 따라, ChainRemote 를 받은 사용자는 본 소스 코드에 접근하고 수정 · 재배포할 권리를 가집니다.
- RustDesk 원본의 저작권 표시는 본 저장소의 `LICENCE` 및 본 문서를 통해 명시됩니다.
- AGPL v3 라이선스 전문: https://www.gnu.org/licenses/agpl-3.0.html

---

마지막 갱신: 2026-05-25
