# ChainRemote (체인리모트)

> RustDesk 포크 기반 자체 원격지원 솔루션. 코이노 AnySupport 대체 + 향후 B2B 사업화.
> 상세 기획: `ChainRemote_기획서.md` / RustDesk 코드 가이드: `AGENTS.md`

## 프로젝트 핵심
- **베이스**: rustdesk/rustdesk (1.4.6+) 포크. 바닥부터 만들지 않음.
- **목표**: 코이노 월 10만원+ → 자체 서버 월 1~3만원. 거래처 200+ POS/키오스크 원격 A/S.
- **라이선스**: AGPL v3 (1단계 내부 사용). 사업화 시점에 재결정.
- **체인오더 시스템과 완전 분리** — 별도 프로젝트.

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

## 현재 단계 (2026-04-30 종료)

### 완료된 것
- ✅ Step 1 Mac: 빌드 환경 + 첫 빌드 + 윈컴 원격 테스트
- ✅ Step 2 부분: UI 텍스트/아이콘/색상 (ChainRemote 가시화)
- ❌ Step 4 웹클라: 검증 결과 폐기 (옵션 C로 전환)
- ✅ NAS 인프라: PostgreSQL 16 가동, SSH/docker 자동화
- ✅ Step 5 골격: Next.js 관리 패널, 멀티테넌시 DB 스키마, 거래처 목록
- ✅ **End-to-end 1-클릭 원격**: 관리 패널 → rustdesk:// URL → Mac 앱 → 윈컴 연결

### Chang의 꿈의 워크플로우 (2026-04-30 100% 검증)
```
거래처 전화 → 관리 패널에서 거래처 클릭 → "거래처 수락 대기..." → 거래처 수락 클릭 → 연결
```
- 비번 0번 입력
- 코이노 4단계(다운→실행→세션번호→확인) → **1단계(수락)**로 축소 ★ 핵심 차별화 달성
- 검증 환경: Mac(ChainRemote) ↔ Win(공식 RustDesk 정식 설치) via 공개 RustDesk 서버

### 핵심 RustDesk 설정 (Win 거래처 PC 측)
- 정식 설치 (portable 모드 X) — Settings > Security 활성화 위해
- Settings > Security > **"클릭을 통해 세션 수락"** 선택 ★
- 이 설정이 핵심. 거래처마다 한 번씩 셋업 필요.

### Mac 측 디스플레이 권장 (4K 거래처 대응)
- `~/Library/Preferences/com.carriez.RustDesk/peers/<ID>.toml`
  - `view_style = 'adaptive'` (창에 맞춤, 1:1 panning 방지)
  - `image_quality = 'low'` (속도 우선, 4K 부드러움)

### 다음 단계 (다음 세션)
1. **Step 1 윈컴 빌드** — Chang 옆 윈컴에 Rust+Flutter 환경 구축, ChainRemote.exe 생성
   - 거래처용 빌드 (옵션 C 핵심 아티팩트)
   - Chang 본인용 윈컴 빌드도 같이
2. **고정 비번(Unattended Access) 셋업** — 거래처 PC에 한 번만 설정 → 비번 입력 단계 제거
3. **Step 3 한국 빠른 서버** — NAS 또는 VPS 결정 + hbbs/hbbr 배포
4. **Step 6 채팅** — Mac/Win 앱 안 채팅 + DB 기록
5. **Step 7 본 출시 준비** — 정식 브랜딩, 인증서 서명, 거래처 점진 전환
6. **Step 8 사업화**

### 관리 패널 코드 위치
- `/Users/changsmac/내작업/chainremote-admin/` (별도 폴더, Next.js)
- DB 스키마: `/Users/changsmac/내작업/ChainRemote/db/migrations/001_init.sql`
- Drizzle ORM 모델: `chainremote-admin/lib/schema.ts`
- 실행: `cd chainremote-admin && npm run dev` → http://localhost:3000

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

### 빌드 + 실행 명령 (재사용 가능)
```bash
cd ~/내작업/ChainRemote && \
  source $HOME/.cargo/env && rustup default 1.81 && \
  PATH="$HOME/flutter-3.24.5/bin:$HOME/.local/bin:$PATH" \
  VCPKG_ROOT=$HOME/vcpkg \
  MACOSX_DEPLOYMENT_TARGET=12.3 \
  LANG=en_US.UTF-8 \
  python3 ./build.py --flutter --unix-file-copy-paste --screencapturekit && \
  codesign --force --deep --sign - flutter/build/macos/Build/Products/Release/RustDesk.app && \
  open flutter/build/macos/Build/Products/Release/RustDesk.app
```

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
