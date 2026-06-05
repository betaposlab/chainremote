; ChainRemote 본사 빌드용 인스톨러 (Inno Setup)
; 빌드: 윈컴에서 ISCC.exe hq-installer.iss
; 결과물: ChainRemote_HQ_Setup_v{version}.exe
;
; Phase 1 분기: 본사 빌드 = conn-type=outgoing (custom-hq.txt → {app}\custom.txt).
; Flutter Windows 산출물은 agent-installer.iss 와 동일 빌드를 공유.
; 차이점은 (1) 박히는 custom.txt 가 outgoing, (2) 영구 비번 toml 제외 (본사 PC 는 피지원자 아님),
; (3) watchdog 예약작업 제외 (재성이 PC 는 interactive 사용자, 자가치유 불필요).
;
; 사용처: 재성이 윈도우 본사 PC (jaesung 계정 로그인).

#define APP_NAME       "ChainRemote"
#define APP_VERSION    "1.4.15"
#define APP_PUBLISHER  "BetaposLab"
#define APP_URL        "https://betaposlab.com"
; 윈컴에서 빌드한 ChainRemote.exe 가 들어있는 폴더 (agent 와 공유)
#define BUILD_DIR      "C:\src\ChainRemote\flutter\build\windows\x64\runner\Release"

[Setup]
; AppId 는 agent 와 다르게 — 같은 PC 에 둘 다 깔리지 않게 하려면 같이 두는 게 안전하나,
; HQ 와 agent 는 서로 다른 PC 에서만 돌므로 별 AppId 가 안전.
AppId={{C7E4D8B2-9F3A-4B5C-8D1E-6F2A3C5E9B7D}
AppName={#APP_NAME}
AppVersion={#APP_VERSION}
AppPublisher={#APP_PUBLISHER}
AppPublisherURL={#APP_URL}
DefaultDirName={commonpf}\ChainRemote
DefaultGroupName={#APP_NAME}
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=ChainRemote_HQ_Setup_v{#APP_VERSION}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=yes
UninstallDisplayIcon={app}\chainremote.ico
UninstallDisplayName={#APP_NAME}
SetupIconFile=chainremote.ico

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#BUILD_DIR}\*"; DestDir: "{tmp}\chainremote_payload"; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs

; ★ 2026-06-05: custom.txt 를 exe 옆(payload)에도 강제 배치 — install_me(--silent-install)가 *이 시점*에
;    custom.txt 의 option-b-plus 마커를 읽어 서비스 생성을 결정함(get_create_service). {#BUILD_DIR} 의
;    옛/stale custom.txt 를 덮어써 보장. (설치 후 {app} 복사는 아래 1.5 단계 그대로 유지.)
Source: "..\custom-hq.txt"; DestDir: "{tmp}\chainremote_payload"; DestName: "custom.txt"; Flags: deleteafterinstall ignoreversion

; 옵션 B+ (2026-05-21): HQ 도 영구비번 toml 박음. 사용자가 "외부 원격 접속 허용"
; 토글 ON 만 하면 별도 비번 설정 없이 즉시 무인 incoming 가능 (Chang→재성이 컴 시나리오).
; 토글 OFF 일 땐 hbbs 등록 자체 안 함 → 영구비번 박혀있어도 외부 ID 못 찾음.
Source: "RustDesk.toml";         DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk2.toml";        DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk_default.toml"; DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion

Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

; Phase 1 — 본사 분기 플래그. silent-install([Run]1번)이 {app} 폴더를 클린업하므로
; 임시 폴더에 박아두고 [Run]에서 silent-install 후에 {app}\custom.txt 로 복사한다.
; ordering 버그 픽스 (2026-05-21): 옛 [Files] 에서 {app} 으로 박았을 때 silent-install 이
; 덮어써서 custom.txt 가 사라졌음. 본사 custom 파일은 win-installer 외부(deploy/) 에 있음.
Source: "..\custom-hq.txt"; DestDir: "{tmp}\custom_payload"; DestName: "custom.txt"; Flags: deleteafterinstall ignoreversion

[Run]
; 0. ★ Windows ephemeral port range 확장 (2026-05-25 사업화 안전망).
;    동일 사유로 HQ 인스톨러도 적용 — Chang/재성이 PC 에 다른 SW (코이노 등) 깔려있을
;    때 그쪽 SW 의 누수 영향에서 ChainRemote 보호. 자세히는 agent-installer.iss 참조.
Filename: "netsh.exe"; Parameters: "int ipv4 set dynamicport tcp start=10000 num=55000"; StatusMsg: "Windows ephemeral port 확장 적용..."; Flags: runhidden waituntilterminated
Filename: "netsh.exe"; Parameters: "int ipv6 set dynamicport tcp start=10000 num=55000"; Flags: runhidden waituntilterminated

; 0.5. ★ silent-install 직전 옛 ChainRemote.exe 강제 종료 (v1.3.6 신규, 2026-05-29).
;     v1.3.4 → v1.3.5 마이그레이션 후 트레이 아이콘 2개 잔재 해소. 자세히는 agent-installer.iss.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; taskkill /F /IM ChainRemote.exe /T *>$null; Start-Sleep -Seconds 2"""; StatusMsg: "옛 ChainRemote 프로세스 정리 중..."; Flags: runhidden waituntilterminated

; (Phase 3-Win v2 2026-05-25): 옛 'sc delete RustDesk' + 'taskkill rustdesk.exe' 단계 제거.
;     Microsoft Defender false positive (Trojan:Win32/Bearfoos.B!ml) 트리거 회피.
;     동일 정리 동작은 src/chainremote_migrate.rs 가 첫 실행 시 처리. agent 와 동일.

; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 C:\Program Files\ChainRemote\ 로 모든 파일 복사
;    + ChainRemote Service 등록. HQ 는 outgoing-only 이므로 서비스가 incoming 을 받을 일 없지만,
;    install_me 의 기본 흐름 그대로 둠 (옵션 B+ 토글 ON 시 incoming 도 가능).
Filename: "{tmp}\chainremote_payload\ChainRemote.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 1.5. ★ custom.txt 박기 (silent-install 후) — Phase 3-Win 절대 경로 강제 (2026-05-26 fix).
;    agent-installer.iss 와 동일 사유: install_me() 가 {commonpf}\ChainRemote\ 에 설치하므로
;    custom.txt 도 같은 위치여야 load_custom_client() 가 인식. {app} 은 옛 AppId 잔재로
;    옛 RustDesk 폴더 가리킬 수 있음.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$dst='{commonpf}\ChainRemote'; New-Item -Path $dst -ItemType Directory -Force *>$null; Copy-Item '{tmp}\custom_payload\custom.txt' (Join-Path $dst 'custom.txt') -Force"""; StatusMsg: "ChainRemote 분기 설정 적용 중..."; Flags: runhidden waituntilterminated

; 2. 서비스/UI 강제 정지 — toml 박기 전 file lock 해제
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; for ($i=0; $i -lt 30; $i++) {{ $svc = Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($null -eq $svc -or $svc.Status -eq 'Stopped') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM ChainRemote.exe /T *>$null; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. toml 2종을 사용자/서비스 두 경로에 동시 배치 (rendezvous server 인식). Phase 3-Win 이후 경로 ChainRemote.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{sys}\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. 서비스 재시작 (간단판 — HQ 는 watchdog 없으므로 1회 시도면 충분)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Start-Service ChainRemote -ErrorAction Stop }} catch {{ sc.exe start ChainRemote *>$null }}"""; StatusMsg: "ChainRemote 서비스 시작 중..."; Flags: runhidden waituntilterminated

; 5. 옛 RustDesk 단축아이콘 잔재 정리 (Phase 3-Win). install_me 가 APP_NAME=ChainRemote
;    따라 ChainRemote.lnk 자동 생성하므로 RENAME 불필요. 옛 잔재만 제거.
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%PUBLIC%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%USERPROFILE%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden

; 6. 옛 Start Menu RustDesk 폴더 정리.
Filename: "{cmd}"; Parameters: "/c rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" 2>nul"; Flags: runhidden

; 7. RustDesk 자동시작 reg 제거 (우리 [Registry] 에서 ChainRemote 별도 등록)
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 8. 단축아이콘 IconLocation 갱신
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{app}\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 8.5. ★ 인스톨 후 self-test 스모크 (v1.3.7 신규, 2026-05-29).
;     자세히는 agent-installer.iss 의 동일 단계 doc 참조.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Start-Sleep -Seconds 8; $log='C:\ProgramData\ChainRemote\updater.log'; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $svc=(Get-Service ChainRemote -EA SilentlyContinue).Status; $procs=(Get-Process ChainRemote -EA SilentlyContinue).Count; $exe='C:\Program Files\ChainRemote\ChainRemote.exe'; $exists=(Test-Path $exe); $verdict='FAIL'; if (($svc -eq 'Running') -and ($procs -ge 1) -and $exists) {{ $verdict='PASS' }; Add-Content -Path $log -Value ($st + ' installer: SELFTEST v{#APP_VERSION} svc=' + $svc + ' procs=' + $procs + ' exe=' + $exists + ' -> ' + $verdict)"""; StatusMsg: "ChainRemote 설치 self-test 중..."; Flags: runhidden waituntilterminated

; 9. 설치 직후 실행 (재성이 검증용) — 절대 경로 강제 (Phase 3-Win 사고 fix, 2026-05-25).
;    옛 RustDesk 설치본의 {app} mismatch 회피. agent-installer 와 동일 사유.
Filename: "{commonpf}\ChainRemote\ChainRemote.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 — HQ 도 재성이 편의상 유지 (트레이 아이콘으로 떠 있음).
; Phase 3-Win 이후 실행파일은 ChainRemote.exe.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\ChainRemote.exe"" --tray"; \
  Flags: uninsdeletevalue
