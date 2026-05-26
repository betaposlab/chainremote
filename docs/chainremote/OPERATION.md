# ChainRemote — 운영 가이드

> 거래처 운영 워크플로우, ID 시스템, 권한, NAS Web Station / DB 접속, 관리 패널 코드 위치.

## 거래처 운영 워크플로우 (검증됨)

1. **본사**: `ChainRemote_Agent_Setup_v*.exe` 카톡/USB로 거래처 전달
2. **거래처**: 더블클릭 → UAC 예 → 자동 설치 (silent + custom config + 단축아이콘 rename)
3. **거래처**: ChainRemote 자동 실행 → 화면 ID 본사에 알림
4. **본사**: 관리 패널에 거래처 정보 + ID 등록 + 영구 비번 발급
5. **거래처**: 받은 비번을 [설정 > 보안 > 영구 비밀번호 설정] 에 1회 입력
6. **그 후 영원히**: 거래처 PC 켜져 있으면 본사가 0클릭 무인 접속

## ID 시스템 — 머신 고정

- ID는 머신 UUID 기반 deterministic 생성 (`hbb_common::machine_uid`)
- 같은 PC 재설치 → 같은 ID (피어 등록 안정성)
- 다른 PC → 자동으로 다른 ID (충돌 0)
- 메인보드/펌웨어 변경 시에만 ID 변경

## Mac 측 디스플레이 권장 (4K 거래처 대응)

- ChainRemote 메인 창 → 설정 → 디스플레이 (전역 기본값)
  - 기본 보기 스타일 = "크기 조정 가능"
  - 기본 이미지 품질 = "반응 시간 최적화"
- 또는 `~/Library/Preferences/com.carriez.RustDesk/peers/<ID>.toml` 직접 편집
  - `view_style = 'adaptive'`, `image_quality = 'low'`

## NAS Web Station 셋업 (자동업데이트 동작 전제, Chang 1회 작업)

1. DSM → 패키지 센터 → **Web Station** 설치 (없으면)
2. SSH 로 디렉터리 생성: `mkdir -p /volume1/web/chainremote && chmod 755 /volume1/web/chainremote`
3. Web Station → 가상 호스트 → `sepani.synology.me` (HTTPS, Let's Encrypt 무료 인증서)
4. 라우팅 검증: `curl -I https://sepani.synology.me/chainremote/` → 200
5. 릴리즈 푸시:
   ```bash
   NAS_HOST=chang@sepani.synology.me ./deploy/release.sh dist/ChainRemote_Agent_Setup_v*.exe "릴리즈 노트"
   ```

## 관리 패널 코드 위치

- 코드: `/Users/changsmac/내작업/ChainRemote/chainremote-admin/` (서브폴더, Next.js 16)
- DB 스키마: `db/migrations/*.sql`
- Drizzle ORM 모델: `chainremote-admin/lib/schema.ts`
- 데이터 레이어 (본사 앱·패널 공유): `chainremote-admin/lib/data/{customers,favorites,sessions}.ts`
- 인증 미들웨어: `chainremote-admin/proxy.ts` (Next 16 이름. matcher + 함수내 `/api` 명시 통과)

**실행 모드**:
- NAS 운영 (정식): `https://sepani.synology.me:3443` 브라우저 / `http://sepani.synology.me:3001` 본사 앱 API. `/volume1/docker/chainremote-admin/` + `docker compose up -d`. AUTH_SECRET 진실 원천.
- Mac 로컬 dev: `npm run dev` → http://localhost:3001. `.env.local` 의 `AUTH_SECRET` 은 NAS `.env` 와 동일하게.

## NAS PostgreSQL 접속 정보

- **호스트**: 192.168.68.103 (LAN), Synology 호스트명 `kimfam`. 외부: `sepani.synology.me` (Tailscale 또는 SSH 터널)
- **포트**: 15432 (5432는 Synology 자체 사용)
- **DB명/사용자**: `chainremote / chainremote`
- **비번**: `/Users/changsmac/내작업/ChainRemote/.nas-db-password` (gitignored)
- **컨테이너 이름**: `chainremote-postgres`
- **외부 노출**: 안 됨 (LAN 내부만, 보안 위주)

## NAS 자동화 셋업 (2026-04-30 완료)

- SSH 키 인증 (`~/.ssh/id_ed25519`) — Mac → NAS 무비번
- 패스워드리스 sudo: `chang` 사용자에게 docker/docker-compose만 한정
- 명령 예: `ssh chang@192.168.68.103 "sudo /var/packages/ContainerManager/target/usr/bin/docker ps"`
- 외부: `ssh chang@sepani.synology.me` 도 가능 (Synology DDNS + 라우터 SSH 포트 포워딩)

## 도메인 (기존 자산)

- `remote.betaposlab.com` → 거래처 가이드 페이지 (옵션 C: .exe 다운로드)
- `admin.betaposlab.com` → 관리 패널 (장래 이전 검토, 현재는 sepani.synology.me)
- 기존 betaposlab.com과 충돌 없이 공존

## 미정 / 결정 대기

- 최종 브랜드명 (chainremote 가 사실상 확정)
- 사업화 라이선스 전략 — AGPL 유지 (현재) vs RustDesk Server Pro 구매 (장래)
- 과금 모델 구체 금액

## RustDesk 코드 규칙 (참고)

`AGENTS.md` 참조 — Rust(unwrap 금지/clone 최소화), Tokio(중첩 런타임 금지/await 락 금지), 편집 위생(최소 diff).

## 기술 스택 빠른 참조

| 영역 | 스택 | 위치 |
|------|------|------|
| 코어 엔진 | Rust | `src/`, `libs/` |
| UI | Flutter (데스크톱+모바일) | `flutter/` |
| 레거시 UI | Sciter (deprecated, 무시) | `src/ui/` |
| 시그널링 서버 | hbbs (TCP 21115-21116) | NAS Docker |
| 릴레이 서버 | hbbr (TCP 21117, UDP 21116) | NAS Docker |
| 코덱 | VP8/VP9/AV1 SW, H.264/H.265 HW | `libs/scrap/` |
| 관리 패널 | Next.js 16 + TypeScript + Drizzle ORM + PostgreSQL 16 | NAS Docker |
