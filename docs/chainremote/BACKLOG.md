# ChainRemote — 작업 Backlog

마지막 갱신: 2026-05-26

## 코드 작업 (우선순위 순)

1. **드래그앤드롭 파일전송** (Chang 명시 필수) — 원격 세션 창에 OS 파일 드롭 → 즉시 전송. 진단 결과: `desktop_drop` 패키지가 macOS 메인 창에만 NSView 등록 → sub-window 의 원격 화면 창에 OS drop event 미도달. vendor fork + NSWindow.didBecomeKey observer 패치 시도했으나 NSLog 미반영. 다음 시도 시 우리 macos/Runner 에 직접 native 코드 박는 방식. 0.5~1일.
2. **거래처 heartbeat** — agent 가 NAS API `/api/customers/heartbeat` 호출 → 패널 거래처 표에 "v1.x.x · 마지막 N분 전" 컬럼. Phase 3-Win 의 새 binary 활용. 0.5~1일.
3. **단위테스트** — 버전비교(Rust+Dart 일관성)/sha256/json 파싱. 자동업뎃 무음정지 방지. 0.5일.
4. **설치 후 self-test 스모크** — 인스톨러 끝나면 자가진단 → updater.log PASS/FAIL.

## B-2 (자동 업데이트 UI 완성, 일부 완료)

- ✅ Flutter "업데이트 확인" 버튼 + 현재/최신 버전 표시 (설정 → 정보)
- ✅ IPC 로 UI → 서비스 "지금 체크" 메시지
- ⏳ 본사 강제 푸시 채널 (`push.json` 별도 5~10분 폴링) + 관리 패널의 "긴급 업데이트 푸시" 버튼

## Phase 1 후속 (안정화 후)

- 거래처 PC 사용자/서비스 모드 toml 분리 문제 — UI 보안탭 빈 칸이지만 서비스 동작 OK. 메모리 [project_user_vs_service_toml]. 인스톨러 [Run] step 3 robustness 확인 또는 fork 코드에서 inherit.
- 거래처별 chainremote_version heartbeat → 관리 패널 + 본사 앱 거래처 목록에 버전 컬럼.
- 자동업데이트 실패 진단 — 중앙리 PC 의 `C:\ProgramData\ChainRemote\updater.log` 확인.
- build-all.ps1 의 [3.5/5] codegen 단계 거짓 OK 보고 버그 — 진단/실패 보고하도록 보강.

## 외부 작업 (Chang)

- 재성이 컴 v1.3.0 HQ 설치 — Phase 3-Win 검증된 빌드.
- 첫 영업 (진희씨 외) — 회사 관리 패널에서 사업자 정보 등록 → 인스톨러 배포.
- 코드 서명 인증서 (EV $300~600/년) — 매출 발생 후 영업 본격화 시점. 그 전엔 "더 보기→실행" + Defender 허용 안내.
- 결제 시스템 (Stripe/토스/수동) — 첫 결제 시점에 결정.
- 약관/개인정보처리방침 — SaaS 운영자 책임.

## 디자인 작업 (Chang 의 요구사항 — 2026-05-25 시작)

- ✅ 로그인 화면 quick win — 워드마크 + 카드 그림자 + 입력란 focus + footer + 서버 URL 제거.
- ⏳ Claude design 의뢰 spec 작성 — 메인 화면 / 상단바 / 설정 페이지 다듬기. 한국 B2B SaaS 톤 (토스/카카오뱅크 참고).
- ⏳ 베타포스랩 홈페이지의 `/chainremote` sub-page — 영업용 ChainRemote 소개 (메인 톤과 별개, B2B 톤). 첫 영업 전.

## 자동업데이트 실증 검증 (진행 중, 2026-05-26)

- NAS 에 새 v1.3.0 Agent (Phase 3-Win) push 완료 (release.sh)
- 재성이 PC 에 v1.2.8 깔고 → "업데이트 확인" 버튼 → v1.3.0 자동 마이그레이션 검증 시도

## 낮은 우선순위

- 외부망 P2P/릴레이/Mac TCC 재검증 — 옵션 B+ 로 사실상 검증됨.
- 거래처별 비번 자동 생성 — agent click 디폴트로 약화됨.

## v1.2.5+ 보류 항목

- ✅ 창/트레이/Alt+Tab 아이콘 RustDesk → ChainRemote 교체 — Phase 3-Win 으로 해결됨.

## 알려진 이슈 (계속 진단)

- **peer password decrypt race** ([libs/hbb_common/src/password_security.rs:210](../../libs/hbb_common/src/password_security.rs) + lib.rs:318): `get_uuid()` 가 macOS 첫 호출 8회 retry 다 실패 시 fallback `Config::get_key_pair().1` 로 떨어짐 → 그 시점에 encrypt 된 peer password 는 fallback key 로 암호화. 그 다음 machine_uid 정상 fetch 시 decrypt 키 불일치 → "비밀번호 필요" 다이얼로그. **dual-decrypt 는 upstream 5d2acc7 가 이미 적용** — decrypt 시 fallback 검사. 그래도 Chang 우리집 한 번 사고. 메모리 [project_peer_password_race].
- **자동업데이트 실증 검증 진행 중** (B-1 코드만, 24h 자동 적용 실제 본 적 없음). 단 **toml 보존 가드는 코드 픽스 완료** (2026-05-24, agent-installer.iss): dst 의 `RustDesk2.toml` (또는 `ChainRemote2.toml` 새 위치) 존재 시 toml 안 박음 → 거래처 영구비번/approve-mode/기타 사용자 설정 보존.
- **super_admin 도 자기 tenant(betaposlab) 의 customers/sessions 조회는 정상** — owner 권한 통과(lib/actions/users.ts:11 requireOwner 가 owner 또는 super_admin 통과).
- **NAS 패널 배포 함정**: docker compose build 가 EOF 로 중간 끊기는 경우 있음. 해결: `docker compose build` 단독 → 끝까지 대기 → `up -d`. build 가 dependent containers(postgres/hbbs/hbbr) 죽일 수 있음 → 수동 `docker start chainremote-postgres chainremote-hbbs chainremote-hbbr`.
- **NAS 코드 동기 = tar over SSH** (rsync 가 `-o`/`-g` 권한 거부): `tar -czf - --exclude=... -C ~/내작업/ChainRemote chainremote-admin/ | ssh chang@192.168.68.103 "cd /volume1/docker && tar -xzf -"`.
