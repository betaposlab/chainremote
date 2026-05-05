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

## 미해결 이슈 (2026-05-04 발견 — 해결 진행 중)

### 이슈 1: 인스톨러가 toml 을 잘못된 경로에 배치 (LICENSE_MISMATCH 의 root cause)
- **증상**: `ChainRemote_Setup.exe` 로 깐 PC 가 ChainRemote UI 의 ID/릴레이/Key 필드 모두 비어 있음. 수동 입력해도 POS→Mac 시도 시 "키가 일치하지 않습니다" 에러.
- **분석** ([client.rs:498-499](src/client.rs:498)): hbbs 서버가 LICENSE_MISMATCH 응답 → 클라이언트 키가 서버 공개키와 불일치. user 가 toml 수정해도 무효.
- **근본 원인** ([config.rs:484-485](libs/hbb_common/src/config.rs:484)): RustDesk 가 **서비스 모드** 로 구동되면 `C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\` 를 읽음. 인스톨러는 `%APPDATA%\RustDesk\config\` (사용자 폴더) 에만 박음 → 서비스가 빈 key 로 서버에 등록 시도.
- **왜 LAN 에선 Mac→POS 가 됐나**: P2P punch hole 로 직결되어 서버 키 검증 우회. POS→Mac 방향에서야 POS 가 요청자가 되며 키 검증 → 실패.
- **임시 해결** (이미 배포된 PC): cmd 관리자 권한으로 LocalService 경로에 toml 직접 박고 서비스 재시작.
- **영구 해결** (다음 인스톨러 빌드): `installer.iss` 의 `[Files]` 에 LocalService 경로 추가 + `[Run]` 에서 `--silent-install` 전후로 서비스 stop/start.

### 이슈 2: 사무실/외출 시 관리 패널 DB 도달 불가
- **증상**: Mac 을 사무실로 가져가면 `localhost:3000/customers` 에서 `connect ETIMEDOUT 192.168.68.103:15432`.
- **원인**: 관리 패널 .env.local 이 NAS 의 LAN IP `192.168.68.103:15432` 직접 사용. 외부 네트워크에서 도달 불가.
- **추가**: 클라이언트들의 `21114/api/sysinfo` heartbeat 도 외부에서 timeout (포트 포워딩 없음, 21115-21118 만 노출). 신규 POS 가 콘솔에 자동 등록 안 되는 이유.
- **해결 방향**: Tailscale (mesh VPN) 로 Mac↔NAS 묶음. DB 는 인터넷 노출 금지. 21114 는 별도로 포트 포워딩 추가 (RustDesk hbbs API 는 공개 노출 전제 설계, 위험도 낮음).

### 이슈 3: 어제 풀린 줄 알았던 Mac TCC 도 LAN P2P 덕에 부분만 검증된 가능성
- 어젯밤 윈컴↔Mac 동작 확인했지만 둘 다 같은 LAN 이라 P2P 직결. 외부 네트워크에서 검증 안 됨.
- 위 두 이슈 풀린 후 외부망에서 재검증 필요.

## 현재 단계 (2026-05-02 종료)

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
- ✅ **인스톨러 v1.2.0 — 자동 기본 설정 + LICENSE_MISMATCH 근본 픽스** (2026-05-06): toml 3종(`RustDesk.toml`+`RustDesk2.toml`+`RustDesk_default.toml`)을 사용자/LocalService 두 경로 동시 배치, `access-mode=full`, 영구비번(`Ch042558~` 평문→자동해싱), 디스플레이/원격커서/음소거/파일복사 기본값 적용, 인스톨 중 `sc stop`→toml 복사→`sc start` 순서. 윈컴 빌드 대기 중.
- ✅ **자동 업데이트 시스템 B-1** (2026-05-06): `src/chainremote_updater.rs` 신규 — 서비스(LocalSystem)에서 24h 주기로 NAS `latest.json` 폴링, SHA256 검증 후 `C:\ProgramData\ChainRemote\pending\` 에 다운로드, 활성 세션 없을 때 setup.exe 사일런트 적용. 본사 측 `deploy/release.sh` 로 NAS 에 새 버전 푸시. UI/푸시 채널은 B-2 에서.

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

### 다음 단계 (다음 세션)
1. **첫 거래처 실전 시도** — 가장 가까운 1곳 (코이노 대체 또는 신규)
2. **거래처별 비번 자동 생성 + 관리 패널 DB 저장** (운영 정석화)
3. **직원 윈컴 셋업** — 같은 ChainRemote_Setup.exe 설치, 관리 패널 LAN/NAS 호스팅 결정
4. **관리 패널 호스팅 결정** — Mac 로컬 → NAS Container Manager 이전 (직원/외출 시 접근)
5. **Windows 빌드 환경 부활** (`deploy/win-build/`) — 진짜 ChainRemote 브랜드 윈도우 빌드 (창 제목/서비스명까지)
6. **파일 전송 UX 개선** — 더블클릭=전송, 드래그앤드롭, OS→원격창 직접 드롭
7. **코드 서명 인증서** ($300/년) — SmartScreen 경고 제거 (사업화 단계)

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
