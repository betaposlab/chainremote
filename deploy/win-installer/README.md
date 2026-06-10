# 거래처/본사 배포용 인스톨러 (Inno Setup)

| 인스톨러 | 결과물 | 용도 | 접속 정책 |
|---|---|---|---|
| `agent-installer.iss` | `ChainRemote_Agent_Setup_v*.exe` | 거래처(피지원자) — **★통합: x64 + 32비트 자동 판별** | **click 수락** (`RustDesk2-agent.toml` + 루트 `custom-agent.txt` override, 영구비번 미사용) |
| `hq-installer.iss` | `ChainRemote_HQ_Setup_v*.exe` | 본사 직원 (x64 전용) | 영구비번 toml(옵션 B+). 기본 OFF, 토글 ON 시 무인 incoming |

## ★ 통합 인스톨러 (2026-06-10~)

Agent 인스톨러 한 파일이 **x64 Flutter 빌드와 32비트(i686) Sciter 빌드를 둘 다 동봉**하고, 설치 시 OS 아키텍처를 판별해 맞는 쪽만 설치한다 (Inno 셋업 본체가 원래 32비트라 Win7 SP1 32비트부터 Win11 x64까지 실행됨).

- **64비트 OS** → Flutter x64 (기존 거래처 빌드 그대로)
- **32비트 OS (Win7 SP1+/Win10)** → Sciter i686 (`ChainRemote.exe` + `sciter.dll` + `custom.txt`)
- → 패널 푸시/자동업데이트 채널이 **arch 구분 불필요** — 한 파일을 아무 거래처에나 푸시 가능.
- 32비트 쪽 UI = Sciter (수락 카드는 상단 중앙, 설정 메뉴는 다크테마/언어/정보만 — incoming-only 잠금).
- 실증: 2026-06-10 실물 POS (Win7 Enterprise SP1 32비트, Smartro/Atom D2550) 전 구간 검증.

## 공통 동작

1. 페이로드를 임시 폴더에 풀고 `ChainRemote.exe --silent-install` — `install_me()` 가 페이로드 폴더 전체를 XCOPY 로 Program Files 에 복사(32비트는 sciter.dll/custom.txt 동반) + 서비스 등록 + 단축아이콘.
2. NAS config toml **경로 2곳 동시 배치** — `%APPDATA%\ChainRemote\config\` + LocalService 경로 (서비스 모드 LICENSE_MISMATCH 방지). 기존 toml 있으면 보존(자동업데이트 가드).
3. **ephemeral port 확장** — `netsh int ip set dynamicport tcp start=10000 num=55000`.
4. watchdog 예약작업(10분, SYSTEM) + 옛 RustDesk 잔재 정리 + self-test(updater.log PASS/FAIL).
5. **PowerShell 단계 전부 PS 2.0 호환** (Win7 기본 PS2 대응 — `*>$null`/`-Raw`/`-Directory` 금지). watchdog.ps1 도 동일.

## 접속 정책 (★현재 확정 — 2026-06-01 Chang)

- **거래처(agent) = click 수락.** 매 세션 '수락' 클릭. 영구비번/0클릭 무인 모드 폐기. custom.txt 의 `override-settings approve-mode=click` 이 런타임 강제(기존 설치본도 새 빌드 받으면 전환).
- **본사(HQ) = 옵션 B+ 영구비번 토글.** 기본 OFF.

## 빌드 (윈컴)

```powershell
cd C:\src\ChainRemote
.\deploy\win-build\build-all.ps1        # [1] x64 Rust + Flutter 풀빌드 (30~60분)
.\deploy\win-build\build-agent32.ps1    # [2] i686 Sciter 빌드 + agent32-payload 스테이징 (~6분)
cd deploy\win-installer
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" agent-installer.iss   # [3] 통합 Agent
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" hq-installer.iss      # (HQ 릴리즈 시)
```

버전 올릴 때 [src/chainremote_version.rs](../../src/chainremote_version.rs) 와 두 .iss 의 `APP_VERSION` 을 항상 동기화 (binary↔installer 버전 불일치 = applied-버전불변 false alarm).

## SmartScreen 경고 (현 단계 한계)

코드 서명 없음 → 첫 실행 시 "확인되지 않은 게시자" 경고 가능. EV 인증서(~$300/년)는 매출 후 정석. 그 전엔 "추가 정보 → 실행" 1회 안내. 내부 RustDesk 공식 페이로드(x64)는 정식 서명돼 있음.

## 관련 파일

| 파일 | 역할 | git 추적 |
|---|---|---|
| `agent-installer.iss` | ★통합 Agent 인스톨러 (x64+x86) | ✅ |
| `hq-installer.iss` | HQ 인스톨러 (x64) | ✅ |
| `RustDesk2-agent.toml` | 거래처 config (click 수락) | ✅ |
| `RustDesk2.toml` / `RustDesk.toml` | HQ config (영구비번/옵션 B+) | ✅ |
| `../custom-agent.txt` (루트) | 거래처 분기 플래그 **단일 원천** (incoming + click override) | ✅ |
| `watchdog.ps1` | 서비스 watchdog (PS2-safe, x64/x86 공용) | ✅ |
| `build-iss.ps1` / `setup-hq.ps1` / `uninstall-clean.ps1` | 보조 스크립트 | ✅ |
| `agent32-payload\` | build-agent32.ps1 산출 (i686 exe + sciter.dll + custom.txt) | ❌ (재생성) |
| `ChainRemote_*_Setup_v*.exe` | 빌드 산출물 | ❌ (재빌드) |
