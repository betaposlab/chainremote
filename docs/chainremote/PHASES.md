# ChainRemote — Phase 1~3 작업 계획 + 설계 청사진

## 작업 순서 (Phase 1~3)

- **Phase 1** (완료): 거래처 빌드 분리 (`--role=agent`). 거래처 UI = 트레이만 + ID/비번/정보 한 화면. "서비스 중지" 버튼 제거.
- **Phase 2** (6/6 sub 완료, 2026-05-20):
  - ✅ 2-A DB 토대: `user_favorites` 마이그레이션 + Bearer JWT 인증 + REST API 8개 라우트
  - ✅ 2-B 본사 앱 로그인: `chainremote_auth.rs` + `ChainRemoteAuthGate` + FFI 7개. 토큰 메모리 전용.
  - ✅ 2-C 거래처 목록 DB: `chainremote_data.rs::spawn_load_customers`
  - ✅ 2-D 즐겨찾기 user별: `user_favorites` 테이블 + load/add/remove + remote_id→UUID 캐시
  - ✅ 2-E "내 ID 큰 표시" 폐기 + 설정 "업데이트 확인" 버튼(B-2 마무리). presence 폐기.
  - ✅ 2-F 외부망 검증
- **Phase 3** (완료, 2026-05-25~26):
  - ✅ Mac: PRODUCT_NAME = ChainRemote + Bundle ID com.betaposlab.chainremote
  - ✅ Win: BINARY_NAME=ChainRemote + APP_NAME=ChainRemote + 마이그레이션 모듈 + 영구비번 IPC fix
- **AGPL v3 준수** (완료, 2026-05-25): About 화면 + README + CHANGES + LICENCE 명시
- **사업화 phase 1+2** (완료, 2026-05-24): 멀티테넌트 + HQ 비번 변경 + Agent 디폴트 정책

## Phase 2 의 협업 청사진

```
Chang Mac (chang 로그인) ─┐
재성이 Win (jaesung 로그인)─┤  POST /api/auth/token → Bearer JWT (24h)
향후 직원 ─────────────────┘  ↓
                              GET /api/customers (모두 같은 4 거래처 봄)
                              GET /api/me/favorites (자기 것만)
                              POST /api/me/favorites { customerId } (자기 즐겨찾기)
                              ↓
                      NAS PostgreSQL — 진실 원천 1개
```

## Phase 1 거래처/본사 빌드 분리 (단계 1~4 완료)

**핵심 메커니즘**: 분기는 `custom.txt` 파일 1개 로 결정. RustDesk 의 HARD_SETTINGS 활용.

- `.app/Contents/Resources/custom.txt` (Mac) 또는 윈도우 binary 옆 `custom.txt` → `src/common.rs::load_custom_client()` 가 자동 로드.
- **conn-type 은 top-level 키** (override-settings 안 X). RustDesk 코드는 HARD_SETTINGS 에서 conn-type 을 읽고, custom.txt 의 top-level key/value 만 HARD_SETTINGS 로 들어감.
- 본사 모드 = `{"conn-type":"outgoing"}` / 거래처 모드 = `{"conn-type":"incoming"}`.

**서명 함정** (정찰 단계에서 놓쳤던 것):
- 원본 RustDesk 의 `read_custom_client` 는 base64+ed25519 서명만 허용 (상용 anti-tamper). plain JSON 박으면 "Failed to decode" 로 silent fail.
- **우리 포크 패치**: [src/common.rs::read_custom_client](../../src/common.rs) 가 `{` 로 시작하면 plain JSON 직접 파싱. 서명 경로는 그대로 fallback.

**단계 1~4 (완료, 2026-05-20)**:
1. ✅ `flutter/lib/desktop/pages/desktop_tab_page.dart` — `bind.isIncomingOnly() ? homePage : ChainRemoteAuthGate(child: homePage)` 조건부 wrap.
2. ✅ `deploy/win-installer/custom-agent.txt` — `{"conn-type":"incoming"}`.
3. ✅ `deploy/custom-hq.txt` — `{"conn-type":"outgoing"}`.
4. ✅ Mac 빌드 워크플로 — `cp deploy/custom-hq.txt /Applications/ChainRemote.app/Contents/Resources/custom.txt` 추가.

**단계 5 (완료, 2026-05-20)**:
- ✅ `agent-installer.iss` + `hq-installer.iss` 분리. AppId 별도. `release.sh` agent 채널만 (HQ 는 수동 설치).

**단계 6**:
- ✅ Chang 윈컴 v1.3.0 HQ 빌드 설치 검증
- ⏳ 재성이 윈컴 v1.3.0 HQ Setup 설치 + `jaesung` 로그인 검증 (Chang 외부 작업)
- ✅ ChainGo.exe 홈피 업로드 완료 (2026-05-25)
- ⏳ 첫 영업 (진희씨 외) (Chang 외부 작업)
- ⏳ 한 거래처 자동업데이트 실증 검증 — 진희씨 컴 작업 시 `New-Item C:\ProgramData\ChainRemote\update_now.flag -Type File` 로 즉시 trigger

## 결정된 스택 (2026-04-30, NAS 자체 호스팅으로 수정)

### 관리 웹 패널 (Step 5)
- **Frontend + Backend**: Next.js (TypeScript) — 풀스택
- **DB**: PostgreSQL 16 — Chang 댁 DS220+ NAS의 도커 컨테이너 (Supabase 폐기)
- **Auth**: NextAuth.js / Auth.js
- **운영 단계 호스팅**: NAS Container Manager
- **설계 원칙**: 첫날부터 멀티테넌시(SaaS) 구조 (고객사 격리, RBAC, 감사 로그)

### 시그널링/릴레이 서버 (Step 3)
- **hbbs + hbbr**: RustDesk Rust 바이너리, NAS Docker
- 한국 VPS 후보는 NAS 안정성 확인 후 폐기 (NAS 24/7 안정 동작 확인)

## 플랫폼 우선순위

- **관리자**: macOS, Windows (Phase 1) → iPhone, iPad (Phase 3)
- **고객**: Windows + 웹브라우저만 (Phase 1)

## 확장성 가정

- **현재**: 사무실 직원 + 하루 10건
- **목표**: 고객사 100개 × 일 20건(=2,000건/일)까지 코드 재작성 0회, 플랜 업그레이드만으로 대응
- 영상은 P2P이므로 서버 부하 미미. 동시 수십 세션도 $5 VPS로 감당.

## 첫 실행 검증 (2026-04-30)

- Mac에서 ChainRemote 빌드본 실행 ✅
- 옆자리 윈컴(공식 RustDesk)과 원격 연결 성공 ✅
- → Step 3 한국 자체 서버 구축 시 큰 개선 예상 (P2P 성공률↑, 레이턴시↓).

## Web Client v1 검증 (2026-04-30, 폐기)

- v1 코드를 git history(커밋 5faf0ad3c^)에서 복원해봄
- vendor 자산 누락 + protobuf 호환 의문 + RustDesk 공식 deprecated 경고
- 결론: v1은 사용 불가, 옵션 C(.exe)로 전략 전환
- 복원된 코드는 `flutter/web/v1/`에 있으나 사용 안 함
