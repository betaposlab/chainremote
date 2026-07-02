# ChainRemote (체인리모트)

한국 POS · 키오스크 A/S 를 위한 자체 원격지원 솔루션. 베타포스랩 (BetaPosLab) 개발 · 운영.

> 이 저장소는 [RustDesk](https://github.com/rustdesk/rustdesk) 의 fork 이며, **AGPL v3** 라이선스에 따라 전체 소스가 공개되어 있습니다. 원본 저작자(Purslane Ltd.)의 노고에 감사드립니다.

---

## 무엇인가

- **거래처 (POS / 키오스크) 원격지원 도구.** 본사 직원이 거래처 PC 에 1~2 클릭으로 접속해 A/S 를 진행합니다.
- **자체 시그널링 · 자체 관리 패널 · 자체 인스톨러.** 외부 서비스에 의존하지 않고 전 구간 자체 운영.
- **소규모 밴 대리점용 SaaS.** 1 카피 = 1 회사 (테넌트) = 직원 N 명 동시 사용 + 가맹점 무제한. 코이노 AnySupport 의 seat 기반 과금 대비 저비용.

## 빠른 시작 — 사용자 입장

| 역할 | 받는 것 | 절차 |
|------|---------|------|
| **거래처 (피지원자)** | `ChainRemote_Agent_Setup_v*.exe` | 더블클릭 → UAC 예 → 끝. 그 다음 본사에 ID 알려주면 영원히 무인 접속. |
| **본사 직원** | `ChainRemote_HQ_Setup_v*.exe` (Windows) 또는 `ChainRemote.app` (macOS) | 더블클릭 설치 → 계정 로그인 → 즐겨찾기에서 거래처 클릭. |
| **빌린 PC 비상용** | `ChainGo.exe` (단일 SFX) | 다운로드 → 더블클릭 → 로그인 → 1 클릭 원격 → 닫기. 호스트 PC 에 흔적 0. |

## 빌드

본 저장소는 RustDesk 의 Rust + Flutter 빌드 시스템을 그대로 따릅니다. 자세한 빌드 절차는 [원본 RustDesk README](docs/README-RustDesk-Original.md) 의 *Raw steps to build* 섹션을 참고하세요.

- **macOS (개발자용)**: `python3 build.py --flutter --unix-file-copy-paste --screencapturekit`
- **Windows (배포용)**: `deploy/win-installer/build-iss.ps1 -Target both`
- **포터블 (ChainGo)**: `deploy/portable/build-chaingo.ps1`

빌드 환경은 [docs/README-RustDesk-Original.md](docs/README-RustDesk-Original.md) 와 [`CLAUDE.md`](CLAUDE.md) (프로젝트 인계 문서, 한글) 에 정리되어 있습니다.

## 라이선스

### AGPL v3

ChainRemote 는 [GNU Affero General Public License v3](LICENCE) 에 따라 배포됩니다.

- **소스 코드**: 본 저장소 (https://github.com/betaposlab/chainremote) 가 진실 원천입니다.
- **변경 내역**: 본 소프트웨어는 RustDesk 를 fork 하여 수정·확장한 것입니다. 구체적인 변경 사항은 커밋 히스토리에서 확인할 수 있습니다.
- **재배포**: AGPL v3 의 조건을 따른다면 누구나 본 소프트웨어를 사용 · 수정 · 재배포할 수 있습니다. 특히 SaaS 형태로 서비스 제공 시에도 사용자에게 소스 접근권을 보장해야 합니다.

### 원본 저작권

- RustDesk: Copyright © Purslane Ltd. — https://github.com/rustdesk/rustdesk
- 기타 의존성: 각 패키지의 라이선스를 따릅니다.

## 운영

- **시그널링 / 릴레이 서버 (hbbs / hbbr)**: 베타포스랩 자체 NAS 에서 Docker 로 가동 (`sepani.synology.me`, 포트 21115~21118). RustDesk 의 hbbs / hbbr 바이너리를 그대로 사용합니다.
- **관리 패널**: Next.js (TypeScript) + PostgreSQL. 베타포스랩 자체 NAS Docker 컨테이너로 가동. 접속 URL 은 운영자에게만 공유합니다 (장래 `admin.betaposlab.com` 으로 이전 검토 중).
- **자동 업데이트**: 거래처 PC 의 ChainRemote 가 24 시간마다 폴링하여 새 버전을 사일런트로 적용합니다.

## 연락처

- 회사: 베타포스랩 (BetaPosLab)
- 홈페이지: https://betaposlab.com
- 기술 문의: zentars004@gmail.com
