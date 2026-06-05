; ChainRemote 거래처 배포용 인스톨러 (Inno Setup) — 자체 빌드본 직접 묶기
; 빌드: 윈컴에서 ISCC.exe agent-installer.iss
; 결과물: ChainRemote_Agent_Setup_v{version}.exe
;
; Phase 1 분기: 거래처 빌드 = conn-type=incoming (custom-agent.txt → {app}\custom.txt).
; 본사 빌드는 hq-installer.iss 가 같은 Flutter Windows 산출물 + custom-hq.txt 로 따로 묶음.
;
; 전략 (Phase 3-Win 2026-05-25 이후):
;   1. 윈컴에서 빌드한 새 ChainRemote 빌드 폴더 (ChainRemote.exe + DLL + data) 통째로 묶음
;   2. 거래처 PC 에서 임시 폴더에 풀고 ChainRemote.exe --silent-install 실행
;      → install_me() 가 C:\Program Files\ChainRemote\ 에 모든 파일 복사 + ChainRemote Service
;        등록 + ChainRemote.lnk 단축아이콘 자동 생성 (APP_NAME 따라감)
;   3. ChainRemote.exe 가 첫 실행 시 src/chainremote_migrate.rs 가 옛 RustDesk →
;      ChainRemote 데이터/서비스/레지스트리/단축아이콘 마이그레이션 (멱등성 마커).
;   4. NAS 설정(RustDesk2.toml) + 우리 .ico 배치 + 단축아이콘 IconLocation 갱신

#define APP_NAME       "ChainRemote"
#define APP_VERSION    "1.4.11"
#define APP_PUBLISHER  "BetaposLab"
#define APP_URL        "https://betaposlab.com"
; 윈컴에서 빌드한 ChainRemote.exe 가 들어있는 폴더
#define BUILD_DIR      "C:\src\ChainRemote\flutter\build\windows\x64\runner\Release"

[Setup]
AppId={{8B6F7E2A-1D4C-4A3F-9E5B-3F2C1D7E8B4A}
AppName={#APP_NAME}
AppVersion={#APP_VERSION}
AppPublisher={#APP_PUBLISHER}
AppPublisherURL={#APP_URL}
DefaultDirName={commonpf}\ChainRemote
DefaultGroupName={#APP_NAME}
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=.
; 파일명에 버전 박기 — 매 빌드마다 ChainRemote_Agent_Setup_v{버전}.exe 생성
; 이름이 매번 달라 옛 빌드 / 새 빌드 헷갈림 방지 + NAS URL 캐시 무관
OutputBaseFilename=ChainRemote_Agent_Setup_v{#APP_VERSION}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
; 자동 업데이트 호환성 — 기존 ChainRemote 프로세스 자동 종료/재시작
CloseApplications=yes
RestartApplications=yes
UninstallDisplayIcon={app}\chainremote.ico
UninstallDisplayName={#APP_NAME}
SetupIconFile=chainremote.ico

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; 윈컴 빌드 폴더 통째로 임시 폴더에 풀기 (deleteafterinstall: 설치 후 정리)
Source: "{#BUILD_DIR}\*"; DestDir: "{tmp}\chainremote_payload"; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs

; 우리 toml 파일들을 임시 폴더에 풀어두고 [Run] 단계에서 두 경로(user + LocalService)에 동시 배치
;   - RustDesk2-agent.toml   : Config2 (서버 + 옵션) — agent 전용 (approve-mode=click,
;                              영구비번 미사용). DestName 으로 RustDesk2.toml 이름으로 배치.
;   - RustDesk_default.toml  : UserDefaultConfig — 디스플레이/원격커서/음소거 등 기본값
;
; 디폴트 정책 변경 (2026-05-24):
;   거래처 PC 디폴트 = "클릭으로 세션 수락". 영구비번 평문(RustDesk.toml) 박지 않음.
;   거래처가 자기 사용성에 따라 자율적으로 영구비번 켜거나 click 그대로 사용.
;   HQ 인스톨러는 RustDesk2.toml (영구비번 모드) 그대로 유지 (옵션 B+).
; ★ 2026-06-01 fix: APP_NAME=ChainRemote 라 에이전트는 ChainRemote2.toml/ChainRemote_default.toml 을 읽음.
;   (기존 RustDesk2.toml 이름으로 박으면 에이전트가 안 읽어 인스톨러 설정 전부 무시됐음 — clean 설치 거래처 먹통 원인.)
Source: "RustDesk2-agent.toml";  DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote2.toml"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk_default.toml"; DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote_default.toml"; Flags: deleteafterinstall ignoreversion

; ChainRemote 단축아이콘에 쓸 .ico (Program Files 안에 영구 보관)
Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

; Phase 1 — 거래처 분기 플래그. silent-install([Run]1번)이 {app} 폴더를 클린업하므로
; 임시 폴더에 박아두고 [Run]에서 silent-install 후에 {app}\custom.txt 로 복사한다.
; ordering 버그 픽스 (2026-05-21): 옛 [Files] 에서 {app} 으로 박았을 때 silent-install 이
; 덮어써서 custom.txt 가 사라졌음. 이제 silent-install 후 [Run]단계에서 강제 박음.
Source: "custom-agent.txt"; DestDir: "{tmp}\custom_payload"; DestName: "custom.txt"; Flags: deleteafterinstall ignoreversion

; 서비스 watchdog 스크립트 — 공백 없는 경로(ProgramData)에 둬서 schtasks /TR 중첩인용 회피.
; SYSTEM 예약작업이 10분마다 실행 (아래 [Run] 4b 에서 등록).
Source: "watchdog.ps1"; DestDir: "{commonappdata}\ChainRemote"; Flags: ignoreversion

[Run]
; 0. ★ Windows ephemeral port range 확장 (2026-05-25 사업화 안전망).
;    기본 49152~65535 (16,384 포트) → 10000~64999 (55,000 포트).
;    근거: 거래처 PC 에 다른 원격 SW (코이노 AnySupport, Chrome Remote Desktop 등)
;    가 같이 깔려있을 때, 그쪽 SW 가 ephemeral socket 누수 시 일반 16K 한계에
;    24h 안 도달. 55K 면 3~4배 여유 → 우리 ChainRemote 가 그 누수의 *피해자*
;    가 안 됨. 또한 일반 사용자 환경 무영향(여유만 늘림). 정석 근거: Microsoft
;    KB ephemeral port exhaustion troubleshooting (MaxUserPort 권장값과 일치).
Filename: "netsh.exe"; Parameters: "int ipv4 set dynamicport tcp start=10000 num=55000"; StatusMsg: "Windows ephemeral port 확장 적용..."; Flags: runhidden waituntilterminated
Filename: "netsh.exe"; Parameters: "int ipv6 set dynamicport tcp start=10000 num=55000"; Flags: runhidden waituntilterminated

; 0.5. ★ silent-install 직전 옛 ChainRemote.exe 강제 종료 (v1.3.6 신규, 2026-05-29).
;     배경: v1.3.4 → v1.3.5 마이그레이션 후 재성이 PC 트레이에 ChainRemote 아이콘 2개 잔재
;           발견 (Inno CloseApplications=yes 가 RestartManager 신호 응답 안 함). silent-install
;           이 옛 file 잠금 상태에서 진행되어 옛 + 새 process 공존 사고.
;     수정: silent-install 전에 명시 taskkill — 옛 file 잠금 해제 + 옛 트레이 UI 즉시 종료.
;     서비스 (SessionId=0) 도 죽이는데 [Run] 4번 sc start 가 다시 살림.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; taskkill /F /IM ChainRemote.exe /T *>$null; Start-Sleep -Seconds 2"""; StatusMsg: "옛 ChainRemote 프로세스 정리 중..."; Flags: runhidden waituntilterminated

; (Phase 3-Win v2 2026-05-25): 옛 'sc delete RustDesk' + 'taskkill rustdesk.exe' 단계 제거.
;     Microsoft Defender ML (Trojan:Win32/Bearfoos.B!ml) false positive 의 트리거였음.
;     동일 정리 동작은 src/chainremote_migrate.rs 가 ChainRemote.exe 첫 실행 시 Rust 코드로
;     처리. 인스톨러는 자기 install 만 — ML 의심 패턴 감소.

; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 C:\Program Files\ChainRemote\ 로 모든 파일 복사
;    + ChainRemote Service 등록 + 서비스 시작 + ChainRemote.lnk 단축아이콘 자동 생성.
;    Phase 3-Win 으로 BINARY_NAME=ChainRemote + APP_NAME=ChainRemote 모두 정렬됨.
Filename: "{tmp}\chainremote_payload\ChainRemote.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 1.5. ★ custom.txt 박기 (silent-install 후) — Phase 3-Win 절대 경로 강제 (2026-05-26 fix).
;    Phase 3-Win 으로 install_me() 는 APP_NAME=ChainRemote 따라 {commonpf}\ChainRemote\ 에
;    ChainRemote.exe 설치. load_custom_client() 는 current_exe() 의 부모에서 custom.txt 읽음
;    = {commonpf}\ChainRemote\custom.txt 만 인식. 옛 v1.2.x 의 Inno AppId 잔재로 {app} 이
;    옛 RustDesk 폴더 가리키는 경우 mismatch → custom.txt 못 찾음 → conn-type 기본 (outgoing)
;    → 거래처에 AuthGate 노출 사고 (2026-05-26 재성이 PC). 절대 경로로 영구 회피.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$dst='{commonpf}\ChainRemote'; New-Item -Path $dst -ItemType Directory -Force *>$null; Copy-Item '{tmp}\custom_payload\custom.txt' (Join-Path $dst 'custom.txt') -Force"""; StatusMsg: "ChainRemote 분기 설정 적용 중..."; Flags: runhidden waituntilterminated

; 2. ★ 서비스 + UI/서비스 잔여 프로세스 강제 정지 — toml 박기 전 필수
;    원인: sc stop 만으론 STOP_PENDING 상태에서 file lock 유지 → 다음 copy 실패.
;    개선 (v1.2.4): Get-Service 의 .NET Status enum 비교 (한국어 Windows 의 sc.exe query 출력 "중지됨" 으로 인한
;                  "STOPPED" 문자열 미스매치 버그 수정). 최대 30초 폴링 → taskkill /F → 1초 wait.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; for ($i=0; $i -lt 30; $i++) {{ $svc = Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($null -eq $svc -or $svc.Status -eq 'Stopped') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM ChainRemote.exe /T *>$null; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. ★ toml 3종을 두 경로에 동시 배치 (LICENSE_MISMATCH 근본 해결, copy 실패 시 자동 재시도)
;    - 사용자 폴더 : %APPDATA%\RustDesk\config\           (RustDesk 가 user 모드일 때 읽음)
;    - 서비스 폴더 : C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\
;                                                          (RustDesk 가 service 모드일 때 읽음)
;    개선: PowerShell Copy-Item + 검증 + 최대 5회 재시도 (file lock 일시 보유 환경 대비)
;
;    자동업데이트 안전 가드 (2026-05-24): dst 의 RustDesk2.toml 이 이미 존재하면 toml 박지
;    않음. 자동업데이트(silent install 재실행) 시 거래처가 자체 설정한 영구비번/approve-mode
;    /기타 옵션이 reset 되는 사고 회피. 신규 설치는 dst 비어있어 정상 박힘. 우리 NAS 서버/key
;    변경 시엔 거래처 재설치 필요 (현재 sepani.synology.me 고정이라 무관).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved (auto-update mode, user toml exists)' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\ChainRemote2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{sys}\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved (auto-update mode, user toml exists)' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\ChainRemote2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. ★ 서비스 재시작 — 새 config 로 등록 (검증 + 재시도 + updater.log 기록)
;    배경: install_me 가 서비스를 start=auto 로 생성·시작하지만, 위 2단계가 강제 정지(taskkill 포함)함.
;          옛 버전은 여기서 `sc start >nul 2>&1` fire-and-forget → 실패해도 아무도 모름.
;          start=auto 라 재부팅하면 살아나지만, 절전만 하고 재부팅 안 하는 PC 는 서비스가
;          영영 죽은 채 방치 → 트레이는 떠 있는데 hbbs 미등록·자동업데이트 불능 (2026-05-18 현장 증상).
;    수정: Running 도달까지 폴링(.NET Status enum — 한국어 윈도우 "중지됨" 문자열 버그 회피),
;          최대 3회 재시도, 결과를 C:\ProgramData\ChainRemote\updater.log 에 append
;          → 서비스가 죽어도 installer 가 남긴 줄로 다음 진단 가능 (updater 는 죽은 서비스 안에선 못 남김).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$log='C:\ProgramData\ChainRemote\updater.log'; New-Item -Path (Split-Path $log) -ItemType Directory -Force *>$null; $ok=$false; for ($a=0; $a -lt 3; $a++) {{ try {{ Start-Service ChainRemote -ErrorAction Stop }} catch {{ sc.exe start ChainRemote *>$null }}; for ($i=0; $i -lt 30; $i++) {{ $svc=Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($svc -ne $null -and $svc.Status -eq 'Running') {{ $ok=$true; break }}; Start-Sleep -Seconds 1 }}; if ($ok) {{ break }} }}; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $res= if ($ok) {{ 'Running OK' }} else {{ 'FAILED to reach Running after 3x30s' }}; Add-Content -Path $log -Value ($st + ' installer: sc start ChainRemote -> ' + $res)"""; StatusMsg: "ChainRemote 서비스 시작 중..."; Flags: runhidden waituntilterminated

; 4b. ★ 서비스 watchdog 예약작업 등록 — 이미 죽은 서비스를 재부팅 없이 복구 (위 4단계의 안전망)
;     비권한 트레이 UI 는 UAC 없이 서비스를 못 켜므로 SYSTEM 예약작업이 정석.
;     /SC MINUTE /MO 10: 10분마다 SYSTEM 으로 watchdog.ps1 실행 (서비스 죽었으면 살림).
;     watchdog.ps1 은 공백 없는 ProgramData 경로라 /TR 중첩인용 불필요(한 단계 인용만).
;     /F 로 재설치 시 작업 덮어씀. 등록 직후 1회 즉시 실행해 동작 확인(서비스 정상이면 무동작).
Filename: "schtasks.exe"; Parameters: "/Create /TN ChainRemoteServiceWatchdog /TR ""powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\ChainRemote\watchdog.ps1"" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F"; StatusMsg: "ChainRemote 자동복구 등록 중..."; Flags: runhidden waituntilterminated
Filename: "schtasks.exe"; Parameters: "/Run /TN ChainRemoteServiceWatchdog"; Flags: runhidden waituntilterminated

; 5. 옛 RustDesk 단축아이콘 잔재 정리 (Phase 3-Win 마이그레이션 보조).
;    Phase 3-Win 이후 install_me() 가 APP_NAME=ChainRemote 따라 ChainRemote.lnk 자동 생성하므로
;    RENAME 불필요. 다만 옛 거래처 PC 에는 RustDesk.lnk 가 남아있을 가능성 → 제거.
;    chainremote_migrate.rs 의 cleanup_old_shortcuts 도 같은 정리 수행 (안전 중첩).
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%PUBLIC%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%USERPROFILE%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden

; 6. 옛 Start Menu RustDesk 폴더 정리 (Phase 3-Win 이후 install_me 가 ChainRemote 폴더 자동 생성).
Filename: "{cmd}"; Parameters: "/c rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" 2>nul"; Flags: runhidden

; 7. RustDesk 자동시작 reg 항목 제거 (우리 [Registry] 에서 ChainRemote 로 별도 등록)
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 8. 단축아이콘들의 IconLocation 을 ChainRemote .ico 로 갱신
;    Inno Setup constant 충돌 회피: PowerShell 의 { 들은 모두 {{ 로 이스케이프
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{app}\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 8.5. ★ 인스톨 후 self-test 스모크 (v1.3.7 신규, 2026-05-29).
;     배경: 자동 푸시 사이클에서 silent install 끝났는데 서비스가 죽거나 .exe 가 안 깔린
;           "조용한 실패" 케이스가 패널 입장에서 보이지 않음. updater.log 에 PASS/FAIL 줄을
;           남겨, 다음 진단 사이클 + 운영 가시성 강화.
;     체크 3종: Service=Running / Process count>=1 / Exe file exists.
;     실패해도 인스톨 자체는 성공 처리 — rollback 안 함 (이미 박힌 파일 검증만 추가).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Start-Sleep -Seconds 8; $log='C:\ProgramData\ChainRemote\updater.log'; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $svc=(Get-Service ChainRemote -EA SilentlyContinue).Status; $procs=(Get-Process ChainRemote -EA SilentlyContinue).Count; $exe='C:\Program Files\ChainRemote\ChainRemote.exe'; $exists=(Test-Path $exe); $verdict='FAIL'; if (($svc -eq 'Running') -and ($procs -ge 1) -and $exists) {{ $verdict='PASS' }; Add-Content -Path $log -Value ($st + ' installer: SELFTEST v{#APP_VERSION} svc=' + $svc + ' procs=' + $procs + ' exe=' + $exists + ' -> ' + $verdict)"""; StatusMsg: "ChainRemote 설치 self-test 중..."; Flags: runhidden waituntilterminated

; 9. 설치 직후 ChainRemote 실행 — 절대 경로 강제 (Phase 3-Win 사고 fix, 2026-05-25).
;    옛 v1.3.0 이 깔려있던 PC 는 Inno Setup 의 {app} 이 옛 'C:\Program Files\RustDesk\' 가리킴.
;    install_me() 는 APP_NAME='ChainRemote' 따라 'C:\Program Files\ChainRemote\' 에 설치 →
;    두 경로 mismatch → 'CreateProcess 실패 코드 2' 다이얼로그. 절대 경로로 회피.
Filename: "{commonpf}\ChainRemote\ChainRemote.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 — Phase 3-Win 이후 실행파일은 ChainRemote.exe (BINARY_NAME=ChainRemote).
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\ChainRemote.exe"" --tray"; \
  Flags: uninsdeletevalue

[UninstallRun]
; 제거 시 watchdog SYSTEM 예약작업도 정리 (고아 작업 방지)
Filename: "schtasks.exe"; Parameters: "/Delete /TN ChainRemoteServiceWatchdog /F"; Flags: runhidden; RunOnceId: "DelWatchdogTask"
