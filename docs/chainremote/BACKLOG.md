# ChainRemote — 작업 Backlog

마지막 갱신: 2026-06-04

## ★ 좌석 enforcement 후속 — 2026-06-04 (지금 안 하고 미룬 것, 꼭 할 것)

좌석 과금(한 아이디 = 동시 1대만, 코이노식 강제 종료) 기능은 **패널 배포 + HQ 앱 2기기(Mac+집윈컴) 실증 + 1.4.4 자동업데이트 롤아웃까지 완료**. 아래는 그때 시간/위험 때문에 **미룬 것들 — 잊지 말 것.** 기술 상세: [SEAT_ENFORCEMENT.md](SEAT_ENFORCEMENT.md) §11.

1. **kick 시간 단축(5초)을 실제로 배포하기** — "다른 기기에서 로그인되면 기존 기기 강제 종료"를 감지하는 시간을 10초→5초로 줄인 코드는 **이미 짜서 커밋(버전 1.4.5)** 했지만 **아직 배포 안 됨**. 지금 깔린 건 1.4.4(10초). 다음에 HQ 앱을 빌드/배포할 때 **버전을 1.4.5로 올려서** 내보내야 5초가 실제 적용됨. (안 올리면 같은 1.4.4끼리라 자동업데이트가 안 떠서 영영 안 나감.)

2. **재성이 컴을 나중에 HQ로 전환** — 재성이 역할은 'HQ 사용자'지만 **지금은 PC에 에이전트가 깔린 테스트베드**(Chang 확정 2026-06-04). 좌석 기능은 **로그인하는 HQ 앱에만** 있고 에이전트는 로그인을 안 하니, 재성이가 좌석 대상이 되려면 **집윈컴처럼 에이전트 제거 → HQ 설치**가 필요함. 지금은 테스트베드라 그대로 두고, '재성이 컴 = hq 전용'으로 갈 때 전환. (그 PC에 SSH/원격 되면 `deploy/win-installer/setup-hq.ps1` 방식으로 진행.) ※ **에이전트와 HQ는 업데이트 경로가 다름** — 에이전트=패널 푸시(pending_updates), HQ=latest.json hq 채널. 그래서 hq 채널에 올린 1.4.4는 에이전트엔 안 닿음.

3. **집 윈컴 빌드 함정 — 다리파일 자동생성 도구** — ✅ **도구 설치 완료 (2026-06-05)**: `flutter_rust_bridge_codegen 1.80.1` + `cargo-expand 1.0.95` 를 집윈컴 `~/.cargo/bin` 에 설치(둘 다 `--version` 검증 통과). ★함정: 일반 `cargo install` 은 부품 `clap_builder` 최신판이 `edition2024`(Rust 1.85+)를 요구해 1.81에서 매니페스트 파싱 막힘 → **`--locked` 필수**(게시 당시 잠금파일 = 옛 호환 부품 사용. clap_builder 4.5.20 으로 핀됨).
   - ⚠️ **설치보다 중요한 발견 (방향 재정립 필요)**: 다리파일 3종(`bridge_generated.rs` / `.io.rs` / `flutter/lib/generated_bridge.dart`)은 이미 **git 추적(커밋)** 으로 전환돼 있음(.gitignore L22~49 에서 의도적 해제, "Mac+Win 두 머신 공용"). 따라서 **집윈컴은 codegen 재실행 없이 커밋된 다리파일을 그대로 쓰면 됨** — 재실행은 불필요+위험(정상 커밋본을 덮어쓸 소지, 플랫폼별 미세차 유발). 그런데 `build-all.ps1 [3.5/5]` 는 재생성을 시도하면서 ①`RUSTC_BOOTSTRAP=1` 미설정(stable 1.81 에서 `cargo expand` 실패) ②성공판정이 "`Test-Path bridge_generated.rs`" 뿐 → 커밋본이 항상 존재하니 **실패를 OK로 오보**(거짓 OK 버그의 실체) ③주석 L84 "gitignore라 클론에 없음" = **stale**(실제론 추적됨).
   - ✅ **적용 완료 (2026-06-05, Chang '그러자' 승인 · 미커밋)**: build-all.ps1 `[3.5/5]` = **기본=커밋된 다리파일 사용**(3종 존재+비어있지 않음 검증, 재생성 안 함), 재생성은 `-RegenBridge` opt-in 일 때만 `RUSTC_BOOTSTRAP=1` 환경에서 실행+엄격검증. 설치한 도구는 그 **수동 재생성용 비상카드**로 남음. stale 주석도 정정. → 함정(옛 파일로 조용히 빌드) 원천 제거 + 커밋-브리지 설계와 일치. (Mac build.py 쪽에 "flutter_ffi.rs 변경 시 재생성+no-diff 검증" 추가하면 '재생성 깜빡' 까지 차단 — 별도 후속.)

4. **집 윈컴 HQ "서비스" 정상 설치 + 설치 멈춤 원인 진단** — 집 윈컴에 HQ 깔 때 인스톨러가 "서비스 설치" 단계에서 멈췄음(에이전트를 HQ로 바꾸는 특수 상황 탓 추정). 지금 HQ는 화면 앱만으로 돌아감(로그인·원격 다 됨, 백그라운드 서비스만 없음). 원인 진단 + 서비스까지 정상 설치되게. 재성이 업데이트(HQ→HQ)는 이 멈춤이 안 생길 가능성 큼(에이전트 충돌이 없어서)이지만 2번 확인 때 같이 체크.

5. **옛 로그인 경로 차단(완전 강제) — 전원 업데이트 후** — 지금은 옛 앱(좌석 기능 없는 구버전)도 로그인되게 열어둠(호환성). **모든 본사 앱이 새 버전 되면**, 패널에서 옛 방식 로그인을 막아 "한 아이디 = 동시 1대"를 빈틈없이 강제. (스펙 §8 ④단계.)

## ★ 회사별 직원(아이디) 관리 화면 — 2026-06-04 (Chang 발견, 사업화 핵심)

> ✅ **배포 완료 (사용자 탭 = 회사별 아코디언)** — 2026-06-05 프로덕션 NAS 반영(sync + 패널 재빌드 + up -d, Stage1 방식). super_admin(Chang)=회사별 아코디언(회사 줄 클릭→그 회사 아이디 펼침+추가/수정/비번리셋/삭제), owner=자기 회사 직원만(기존). 회사 목록에 "아이디 N개" 칩→/users 링크. 과금(좌석한도/max_seats)은 Chang 이 직접 — 일단 미구현.

**문제**: "회사 관리"는 회사(과금) 정보만 보여주고, **그 회사 안에 어떤 아이디(직원)들이 있는지 Chang(운영자)이 못 봄.** 한 회사에 1~2 카피(좌석/아이디)를 팔았을 때 "누가 어떤 아이디 쓰는지" 관리할 화면이 없음.
- 원인: "사용자" 페이지는 **로그인한 회사 직원만** 조회(`WHERE tenantId = 내 회사` — 회사별 격리). 회사 등록 시 owner 아이디 1개만 자동 생성. 회사 수정 페이지 코드 주석에도 "관리자 계정은 별도 사용자 관리"라고만 적혀있고 **미구현**.
- **만들 것**: 회사 관리에서 회사 클릭 → 그 회사의 **아이디 목록**(이름/아이디/역할/최종로그인) + 추가/비번리셋/비활성. 회사 목록에 "아이디 N개" 표시. (super_admin=Chang 이 모든 회사 것 조회·관리.)
- **같이 정할 것 (과금 모델 결정)**: "1~2 카피"를 진짜 쓰려면 — (a) 단순: 회사당 월정액 flat + 아이디 무제한(각 아이디=동시 1명, 지금 방식) vs (b) 좌석 판매: 회사마다 "구매 좌석 수(max_seats)" 두고 그만큼만 동시 허용(더 정확한 과금, 복잡). 스펙 §4 의 `tenants.max_seats` 옵션. 어느 쪽으로 팔지 Chang 결정 후 빌드.

## 코드 작업 (우선순위 순)

1. **★ Win7 거래처용 Agent 설치파일** (Chang 명시 필수, 2026-06-01) — POS 거래처 상당수가 아직 Win7. 나중에 폐기하더라도 그 전까지 필요. **오직 agent 만** (HQ·ChainGo 의 Win7 빌드는 안 만듦).
   - 현재 막힘: 우리 빌드 = stock Flutter 3.24.5 (Flutter 3.19/Dart 3.3 부터 Win7/8 공식 폐기, Dart `File::GetType` 가 Win8+ 전용 API `PathCchCombineEx` 호출) + 64bit (RustDesk 상 64bit 는 ≤Win8.1 설치 단계 에러, 32bit 만 설치 가능).
   - 필요한 일: ① RustDesk 의 Win7 패치 Flutter 엔진으로 빌드 (참고: rustdesk.com/blog/2024/12 "How to make Flutter 3.24 run on Windows 7"; 부작용 — Platform.localHostname 中文환경/상대 심볼릭링크) ② 32bit 타깃 빌드 ③ agent 전용 인스톨러(HQ/ChainGo 제외) ④ 실제 Win7 PC 테스트.
   - 규모: 미정. Win7 패치 엔진 확보 + 32bit 툴체인 셋업이 핵심 난관. 본업 진행하며 별도 투자.

2. **HQ 로그인 유지 (자격증명/토큰 저장)** (Chang 요청, 2026-06-01) — 현재 HQ 실행 때마다 ID+비번 재입력. 토큰이 메모리 static 에만 있고 디스크 persist 안 됨 ([src/chainremote_auth.rs](../../src/chainremote_auth.rs) `TOKEN: RwLock`). 로그인 성공 시 토큰을 LocalConfig 에 저장(api-base 처럼) + 실행 시 로드/검증, 만료 시 graceful 재로그인. "로그인 유지" 체크박스로 opt-in 권장 (현재 미저장은 빌린 PC 보안 위한 의도된 설계 — 주석 명시). **규모 작음 ~0.5일.**

3. **거래처 heartbeat** — agent 가 NAS API `/api/customers/heartbeat` 호출 → 패널 거래처 표에 "v1.x.x · 마지막 N분 전" 컬럼. (heartbeat 자가회복 re-register+idempotent 는 v1.3.7 에 반영됨 — 메모리 [project_heartbeat_token_stuck]. 패널의 버전/last-seen 컬럼 UI 만 확인/구현 필요.)

4. **단위테스트** — 버전비교(Rust+Dart 일관성)/sha256/json 파싱. 자동업뎃 무음정지 방지. 0.5일.

> ✅ 완료: ~~드래그앤드롭 파일전송~~ (2026-06-05 완벽 작동 확인).

## Phase 1 후속 (안정화 후)

- 거래처 PC 사용자/서비스 모드 toml 분리 문제 — UI 보안탭 빈 칸이지만 서비스 동작 OK. 메모리 [project_user_vs_service_toml]. 인스톨러 [Run] step robustness 확인 또는 fork 코드에서 inherit.
- 자동업데이트 실패 진단 — 거래처 PC 의 `C:\ProgramData\ChainRemote\updater.log` 확인.
- ✅ ~~build-all.ps1 의 [3.5/5] codegen 단계 거짓 OK 보고 버그~~ — 2026-06-05 해결(위 좌석 후속 3번): 기본=커밋 다리파일 검증(존재+비어있지않음), 재생성은 `-RegenBridge`+exit code 검증.

## 외부 작업 (Chang)

- 첫 영업 (진희씨 외) — 회사 관리 패널에서 사업자 정보 등록 → 인스톨러 배포.
- 코드 서명 인증서 (EV $300~600/년) — 매출 발생 후 영업 본격화 시점. 그 전엔 "더 보기→실행" + Defender 허용 안내.
- 결제 시스템 (Stripe/토스/수동) — 첫 결제 시점에 결정.
- 약관/개인정보처리방침 — SaaS 운영자 책임.

## 디자인 작업 (Chang 의 요구사항 — 2026-05-25 시작)

- ⏳ Claude design 의뢰 spec 작성 — 메인 화면 / 상단바 / 설정 페이지 다듬기. 한국 B2B SaaS 톤 (토스/카카오뱅크 참고).
- ⏳ 베타포스랩 홈페이지의 `/chainremote` sub-page — 영업용 ChainRemote 소개 (메인 톤과 별개, B2B 톤). 첫 영업 전.

## 자동업데이트 실증 검증 (진행 중)

- heartbeat 자가회복(401/403 → re-register + idempotent rotation) v1.3.7 반영.
- 재성이 PC (테스트용) 에서 마이그레이션 실제 적용 검증 진행 중.

## 낮은 우선순위

- 외부망 P2P/릴레이/Mac TCC 재검증 — 옵션 B+ 로 사실상 검증됨.

## 알려진 이슈 (계속 진단)

- **peer password decrypt race** ([libs/hbb_common/src/password_security.rs](../../libs/hbb_common/src/password_security.rs)): dual-decrypt (uuid → pk fallback) 는 upstream 5d2acc7 가 이미 적용. 그래도 config 경로 리셋 시 한 번씩 사고. 메모리 [project_peer_password_race].
- **자동업데이트 toml 보존 가드 완료** (2026-05-24, agent-installer.iss): dst 의 toml 존재 시 안 박음 → 거래처 영구비번/approve-mode/기타 사용자 설정 보존.
- **NAS 패널 배포 함정**: docker compose build EOF 중단 → build 단독 후 up -d. dependent containers(postgres/hbbs/hbbr) 죽으면 수동 start. 메모리 [reference_nas_admin_deploy].
- **NAS 코드 동기 = tar over SSH** (rsync `-o`/`-g` 권한 거부). 메모리 [reference_nas_admin_deploy].
