# 좌석 과금 — 단일 동시세션 enforcement (코이노식 takeover)

> 사업화 좌석 과금의 핵심. 한 HQ 계정(아이디) = **동시 1세션**. 더 필요하면 HQ(=ID) 추가 구매.
> 결정: Chang 2026-06-04. 막 결정 #1 / 불변원칙 3 "직원 N명 무제한"을 **"동시 1석 기본 + 추가 석 구매"로 의식적 수정** (가맹점 무제한은 유지, 동시 *operator* 수가 과금 단위).

## 1. 목표 UX (코이노/넷플릭스식 takeover)

1. Chang 로그인 + 원격 사용 중 (기기 A).
2. 재성이가 기기 B 에서 같은 아이디/비번 로그인.
3. **기기 B 모달**: "이 계정은 현재 다른 기기에서 사용 중입니다. ①강제 종료하고 사용 ②취소".
4. ①강제종료 → 기기 A 원격 끊기고 "다른 기기에서 로그인되어 종료됨" 안내 + 로그아웃 → 기기 B 인계.
5. ②취소 → 토큰 발급 안 됨, 기기 A 계속.

## 2. 기술 현실 (중요)

원격 = **RustDesk 연결**(HQ ↔ 거래처, hbbs 릴레이). 패널 JWT 와 **별개 채널**이라 토큰 무효화만으론 진행 중 화면이 안 꺼짐.
→ "강제 종료"는 **옛 기기 앱이 스스로** 자기 RustDesk 세션 disconnect + 로그아웃 (서버는 revoke 신호만, 실행은 클라).

## 3. 현재 상태 (출발점)

- `/api/auth/token`: stateless JWT. email+password → 토큰 발급, **동시접속 체크 0**. 토큰 = 무제한 기기 발급.
- JWT payload: {uid,email,displayName,role,tenantId}. **jti 없음 → 폐기 불가.**
- `users` 테이블: 세션/디바이스 컬럼 없음. `sessions`(presence) 테이블은 거래처 원격 표시용(다른 용도).

## 4. 스키마 (마이그레이션 — 추가만, 안전)

```
active_login_sessions (
  user_id      uuid  PK, FK users(id) on delete cascade,   -- 계정당 1행(단일세션)
  jti          uuid  not null,                              -- 현재 유효 토큰 식별
  device_id    text  not null,                              -- machine_uid (RustDesk)
  device_label text,                                        -- "재성이-PC" 등 표시용
  ip           text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()           -- heartbeat 갱신
)
```
- user_id PK = 계정당 active 1건 강제. takeover = UPDATE(덮어쓰기).
- (선택) `tenants.max_seats int default 1` — 추후 좌석 수 판매 시. v1 은 계정=1석이라 불필요할 수 있음.

## 5. API 변경

- **POST /api/auth/token (로그인)** — 핵심 수정:
  1. 자격 검증(기존).
  2. active 조회. 없음 / **device_id 동일**(같은 기기 재로그인) / last_seen 이 TTL 초과(orphan) → **즉시 발급** + active UPSERT (새 jti).
  3. active 있고 device_id 다름 + 살아있음 → **409 OCCUPIED** + {device_label, since} 반환 (토큰 X).
- **POST /api/auth/takeover** — 기기 B 가 ①선택 시. 자격 재검증 → active 를 새 기기로 덮어씀(새 jti) → 토큰 발급. (옛 jti 는 이 순간 무효.)
- **POST /api/auth/heartbeat** — HQ 앱 ~10초. 본인 jti 가 active 와 일치하면 200 + last_seen 갱신. **불일치(=인계당함)면 401 REVOKED.**
- **POST /api/auth/logout** — active 삭제(깔끔한 좌석 반납).
- JWT 에 **jti 추가**. 보호 라우트 + heartbeat 에서 active 대조(폐기 가능화).

## 6. HQ 앱 변경 (Flutter + Rust FFI)

- 로그인 호출(`chainremoteLogin`)에 device_id(machine_uid) 동봉.
- 409 OCCUPIED → **모달 A** [강제 종료하고 사용 / 취소]. "강제" → /takeover → 진행. "취소" → 중단.
- 로그인 후 **heartbeat 루프(~10초)**. 401 REVOKED 수신 → **자기 RustDesk 세션 전부 disconnect + 모달 B**("다른 기기에서 로그인되어 종료됨") + 로그아웃 화면.
- 앱 종료 시 best-effort /logout.

## 7. 엣지/기본값 (확정됨)

- **같은 기기 재로그인(device_id 동일) → 프롬프트 없이 자동 회수.** (필수)
- **orphan TTL = 2분.** heartbeat 끊긴 지 2분↑이면 죽은 세션 취급 → 다음 로그인 프롬프트 없이 통과.
- **인계 지연 = heartbeat 간격(~수초~10초).** 즉시 아님(허용).
- 취소 → 토큰 0.
- 네트워크 단기 끊김(<2분) → 세션 유지.

## 8. 배포/호환 (잘 돌던 로그인 안 깨기 — 최重要)

- 현 HQ 앱(Chang Mac, 재성이=테스트)은 옛 stateless 로그인. 서버를 바꾸면 **옛 앱이 heartbeat 안 해서 잠길 수 있음.**
- 순서: ① 마이그레이션(추가) ② 서버 = **둘 다 허용**(jti 없는 옛 토큰도 당분간 통과, 단 enforcement 는 새 앱끼리만) ③ 새 HQ 빌드 → latest.json hq 채널로 자동업데이트 ④ 전원 업데이트 확인 후 옛 경로 차단.
- 테스트 = **Chang 본인 2대(Mac + 집윈컴 HQ)** 로 takeover 전 시나리오 검증 후 재성이 확대. (무인/위험 테스트는 본인 2대 원칙)

## 9. 빌드 범위

- 패널(서버): 마이그레이션 + auth 라우트 4개 + jti. **NAS 배포.**
- HQ 앱: 로그인 device_id + 모달 2종 + heartbeat + 끊김 처리. **HQ 빌드.**
- 거래처(Agent): **무관, 안 건드림.**

## 10. 리스크

- 인증 코어 변경 = 전 계정 로그인 영향. 백워드 호환(8) 철저 + 본인 2대 선검증 필수.
- jti 대조를 매 요청에 하면 DB 부하 — heartbeat + 세션시작 시점만 검증(토큰 TTL 짧게)으로 절충.
- takeover 경쟁(동시 2기기 동시 ①) → user_id PK UPSERT 로 마지막 1건만 승, 나머지 즉시 REVOKED.

## 11. 구현 상태 (진행 로그)

### ✅ 1단계 — 패널(서버) **배포 완료 + 프로덕션 검증** (2026-06-04)

**신규 파일**
- `db/migrations/010_active_login_sessions.sql` — active_login_sessions 테이블(추가만).
- `chainremote-admin/lib/data/active-sessions.ts` — claimSeat / takeoverSeat / touchHeartbeat / releaseSeat.
- `chainremote-admin/lib/request-ip.ts` — x-forwarded-for/x-real-ip 추출.
- `chainremote-admin/app/api/auth/takeover/route.ts` — POST, 자격 재검증 + 무조건 덮어쓰기.
- `chainremote-admin/app/api/auth/heartbeat/route.ts` — POST, jti 대조 → 200 / 401 REVOKED.
- `chainremote-admin/app/api/auth/logout/route.ts` — POST, 내 jti 만 삭제.

**수정 파일**
- `chainremote-admin/app/api/auth/token/route.ts` — deviceId 있으면 claimSeat → 점유 시 409 OCCUPIED.
- `chainremote-admin/lib/api-auth.ts` — signApiToken 에 jti 옵션(setJti).
- `chainremote-admin/lib/schema.ts` — activeLoginSessions Drizzle 정의.

**구현 노트**
- claimSeat = `ON CONFLICT (user_id) DO UPDATE … WHERE (same device OR orphan)` 원자적 조건부 UPSERT → race-safe. 점유 시 0행 → 409.
- jti 는 **새 경로(deviceId 동봉)만** 토큰에 박음. 옛 앱(deviceId 미전송)은 jti·active 행 없이 그대로 발급 → 백워드 호환(§8). `requireApiAuth`/보호 라우트 무변경(매요청 jti 대조 안 함, §10).
- heartbeat 401 은 `{revoked:true}` 플래그로 "인계당함"과 "토큰 만료"를 앱이 구분.
- orphan TTL = `interval '2 minutes'` (§7).

**검증 (코드)**
- `tsc --noEmit` clean, `eslint` clean.
- 일회용 로컬 PostgreSQL 16 에 마이그레이션 010 적용 → 7시나리오(최초확보/같은기기회수/타기기점유/orphan회수/heartbeat match·mismatch/takeover/logout) 모두 기대대로 통과.

**배포 (NAS, Tailscale chang@100.93.42.91)**
- 마이그레이션 010 → 프로덕션 `chainremote-postgres` 적용. 7컬럼/PK/FK/인덱스 검증. hbbs/hbbr/postgres 무손상.
- `chainremote-admin` 이미지 재빌드(`next build` 성공, 라우트 4종 등록) → 컨테이너만 `up -d`(의존 컨테이너 무접촉, NAS RAM 1.7G swap 의존).
- 무인증 스모크: token·takeover→400, heartbeat·logout→401(`Bearer 토큰 없음`). 정상.
- 백워드 호환: 옛 앱(deviceId 미전송)=jti 없이 발급, heartbeat 안 함 → 현 Chang Mac·재성이 무영향.

### ✅ 2단계 — HQ 앱(Rust+Flutter) **코드 완료 + 검증** (2026-06-04) · **빌드/롤아웃은 Chang**

**수정 파일** (tracked)
- `src/chainremote_auth.rs` — login/takeover/heartbeat/logout + `device_info()`(device_id=`encode64(get_uuid())`, device_label=`hostname()` 내부 계산). http_request_sync 로 status code 취득.
- `src/flutter_ffi.rs` — FFI 3종: `chainremote_login`(sync, 시그니처 원복)·`chainremote_takeover`(sync)·`chainremote_heartbeat`(**async** — 10초 주기 UI 비차단).
- `src/bridge_generated.rs`·`.io.rs`·`flutter/lib/generated_bridge.dart` — frb 1.80.1 codegen 재생성(+127줄, 내 함수만). `bridge_generated.h`(macos/ios)는 gitignore 생성물.
- `flutter/lib/common/widgets/chainremote_auth_gate.dart` — 게이트에 heartbeat 루프(10초) + REVOKED 시 `closeAllSubWindows()`+모달 B+로그아웃. 로그인 `_submit` 에 점유(409)→모달 A[강제/취소]→takeover.

**구현 노트**
- device_id/label = **Rust 내부 계산** → Flutter dart:io(hostname) 의존 회피, FFI 시그니처 단순.
- heartbeat 만 async FFI(나머지 sync). revoked 시에만 강제 종료, 그 외 401/네트워크오류는 세션 유지(§7).
- **앱 종료 best-effort logout 훅은 v1 생략** — 트레이 최소화 오발사(좌석 조기 반납) 위험 + orphan TTL 2분이 죽은 앱 좌석 회수. (필요 시 추후 앱-quit 훅 추가)
- Agent 빌드는 `is_incoming_only()` 로 게이트 자체가 안 끼워짐 → heartbeat/로그인 무관.

**검증 (코드)**
- `cargo check --features flutter` exit 0 (내 코드 에러·경고 0). frb 브리지 wire 일관성 확인.
- `flutter analyze` (게이트 파일) 에러 0.

**✅ 프로덕션 2기기 실증 (2026-06-04) — 전 플로우 통과**
- Mac HQ 빌드(이 머신) + 집윈컴 HQ 빌드(에이전트 제거 후 설치). 같은 chang 계정.
- Mac 로그인 → 좌석 claim + heartbeat 갱신(DB `active_login_sessions` 확인, device_label=changs-macbook-pro).
- 집윈컴 로그인 → **409 OCCUPIED → 모달 A** ("changs-macbook-pro 기기에서 사용 중" — deviceLabel 정확 표시).
- [강제 종료하고 사용] → **takeover**: DB 좌석이 Mac→집윈컴(device_id NDQyQTVCRT→OWRhNDhjMm, device_label=chang)으로 덮어써짐.
- Mac → ~10초 내 heartbeat REVOKED → **모달 B** + `closeAllSubWindows()`(열려던 원격 세션 닫힘) + 로그아웃.
- 집윈컴이 좌석 점유 + 거래처(재성이 컴) 원격 정상.
- **타이밍**: Mac kick 은 heartbeat 주기(~10초) 지연 후 — 스펙 §7 수용값. (필요 시 5초/원격시작시점 체크로 단축 가능)

**집윈컴 빌드 함정 (다음에 주의)**
- 집윈컴 PATH 에 `flutter_rust_bridge_codegen` 없음 → build-all.ps1 codegen 단계가 조용히 실패하고 **stale 브리지(이전 빌드 잔재)로 빌드**. flutter_ffi.rs 변경 시 takeover/heartbeat 심볼 누락 → 빌드/런타임 깨짐. 이번엔 Mac 생성 브리지 3파일(bridge_generated.rs/.io.rs/generated_bridge.dart) scp 로 우회. **항구 수정: 집윈컴에 frb codegen + cargo-expand 설치.**
- 집윈컴 HQ 인스톨러는 `--silent-install`(서비스 설치) 단계에서 멈출 수 있음 — **서비스는 좌석 테스트/원격-out 에 불필요**(GUI 앱만으로 로그인·heartbeat·원격 동작). 서비스 정석 셋업은 별도.

### ⏳ 남은 작업 (Chang)
- **2단계 빌드/테스트**: 본인 2대(Mac + 집윈컴 HQ)로 새 HQ 빌드 → takeover/REVOKED 전 시나리오 검증(§8) 후 재성이 확대.
- **롤아웃**: latest.json hq 채널 자동업데이트로 전원 배포.
- **④ 옛 경로 차단(추후)**: 전원 업데이트 확인 후 패널 token 라우트가 deviceId 필수화(jti 없는 로그인 거부) → 완전 strict. 지금은 옛/새 공존.
- 거래처 Agent: 무관, 안 건드림.
