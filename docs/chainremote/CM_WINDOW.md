# ChainRemote CM(피제어 수락/배너) 창 — 동작 모델 + 테스트 체크리스트

> 피제어 머신(거래처 Agent + 본사 HQ 옵션B+)에 뜨는 **"수락 카드"** / **"원격지원 중" 배너** 창.
> 이 영역은 코드 경로가 많고 창 타이밍이 예민해서, 2026-06-05 하루에만 버그가 시나리오별로 4번 따로 드러났음(배너크기·always-on-top·숨김복원·HQ흰박스). 근본 원인 = **같은 동작(크기/위치)을 여러 곳에서 따로 관리** → 한 곳 빠뜨리면 재발.
>
> **★ CM 창 관련 코드를 건드리면 반드시 아래 §5 체크리스트 전체를 검증할 것.** 한 시나리오만 보고 배포하면 다른 시나리오가 깨진다.

## 1. 두 상태 + 정렬 (단일 규칙)

- **pending(수락 대기)** = 수락카드 `kAgentAcceptCardSize` = **360x200**
- **active(원격 중)** = 배너 `kAgentSupportBannerSize` = **220x34**
- **정렬은 항상 `Alignment.topCenter`** (거래처·HQ 통일). 예전엔 HQ 콜드스타트만 topRight 라 카드가 우상단에 떴다 중앙으로 튀는 불일치가 있었음 → 2026-06-05 제거.

## 2. 핵심 규칙 — "콜드스타트/reveal 은 항상 카드 크기(360x200)"

배너 크기(220x34)로 창을 띄운 뒤 나중에 카드로 **키우면**, 피제어자가 **전체화면일 때 resize 가 안 먹어** 카드 내용이 창 밖으로 잘린 **흰 박스**로 고착됨(`postFrame resize` 레이스). 그래서:

- 콜드스타트(`showCmWindow isStartup:true`)·reveal(`isStartup:false`) 은 **무조건 360x200 + topCenter** 로 띄운다 (연결이 곧 pending 이므로).
- 수락 후 active 가 되면 `server_page` 가 220x34 배너로 **줄인다**(그땐 창이 전면이라 resize 안정적).

→ 즉 **"줄이는 건 안전, 키우는 건 위험"**. 작게 시작해서 키우지 말 것.

## 3. 코드 경로 (전부 같은 모델을 따라야 함)

| 경로 | 파일 | 동작 |
|---|---|---|
| 콜드스타트 | `main.dart` `showCmWindow(isStartup:true)` | 360x200 + topCenter 로 생성+show |
| reveal | `main.dart` `showCmWindow(isStartup:false)` | 360x200 + topCenter 로 재표시 |
| 숨김 | `main.dart` `hideCmWindow` | opacity 0 + minimize + hide |
| 상태 전환 | `server_page.dart` `_buildAgentSupportBanner` postFrame | pending→360x200 / active→220x34, topCenter (100~1000ms 4회 재적용 — 생성직후 resize 레이스 회피) |
| topmost/표시 유지 | `server_page.dart` `initState` 타이머(2초) | 활성 중 `setAlwaysOnTop(true)` + (숨겨졌으면)`show()` — UAC 보안데스크톱 복원 |
| 채팅(우리 미사용) | `chat_model.dart` `toggleCMSidePage` | 300x490/700x490 topRight — Agent 배너 UI 엔 채팅 없음. 기본 RustDesk CM 전용 |

## 4. 시나리오별 왜 (2026-06-05 saga — 반복의 정체)

- **흰박스버그**: 콜드스타트가 배너 크기로 떠서 카드 잘림 → 카드 크기 콜드스타트로 해결. 거래처(incoming)는 먼저 고쳤고 **HQ(non-incoming) 경로가 누락됐다 나중에 보강** = "한 곳 빠뜨림"의 전형.
- **grace 자동수락**: 재시작 자동재접속은 수락카드를 건너뛰고 active 직행 → 배너로 줄이는 resize 가 생성직후라 안 먹음 → 4회 재적용.
- **UAC/보안데스크톱**: 전환 후 배너 창이 topmost 잃거나(뒤로 감) 아예 hidden → 2초 타이머가 `setAlwaysOnTop` + (숨겨졌으면)`show` 로 복원.

## 5. ★ 테스트 체크리스트 — CM 창 변경 시 **전부** 확인

- [ ] **거래처(agent) 첫 원격**: 수락카드 정상(흰박스 아님), 상단중앙
- [ ] **HQ(옵션B+) 첫 원격**: 수락카드 정상(흰박스 아님), 상단중앙
- [ ] **수락 클릭 후**: 배너(220x34)로 축소 + 계속 보임
- [ ] **재시작 자동재접속(grace)**: 수락 없이 자동 접속 + 배너 정상 크기
- [ ] **UAC/보안데스크톱 후**: 배너 다시 떠서 유지(다른 앱 만져도 안 사라짐)
- [ ] **피제어 전체화면 중 원격**: 수락카드 안 잘림
- [ ] **연결 종료**: 배너 사라짐
- [ ] **두 빌드 각각**: 거래처(agent) 빌드 + 본사(HQ) 빌드 따로 검증 (경로가 incoming 으로 갈림)

## 6. 변경 시 주의

- 크기는 `kAgentAcceptCardSize`/`kAgentSupportBannerSize` 상수만 사용(하드코딩 금지).
- 정렬은 어디서든 `Alignment.topCenter`. 한 경로만 바꾸지 말 것.
- "작게 띄우고 키우기" 패턴 절대 금지(§2).
- 관련 메모리: `project_restart_reconnect_and_banner`, `project_remote_gui_verify_session1`.
