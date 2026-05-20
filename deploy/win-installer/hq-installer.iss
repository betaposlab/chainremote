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
#define APP_VERSION    "1.3.0"
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
DefaultDirName={commonpf}\RustDesk
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

; HQ 는 RustDesk2.toml (rendezvous server) + RustDesk_default.toml (디스플레이 기본값) 만.
; RustDesk.toml (영구 비번) 은 본사 PC 에 의미 없으므로 제외.
Source: "RustDesk2.toml";        DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk_default.toml"; DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion

Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

; Phase 1 — 본사 분기 플래그. {app}\custom.txt 로 박혀 HARD_SETTINGS["conn-type"]="outgoing" (송신 전용).
Source: "custom-hq.txt"; DestDir: "{app}"; DestName: "custom.txt"; Flags: ignoreversion

[Run]
; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 C:\Program Files\RustDesk\ 로 모든 파일 복사 + 서비스 등록.
;    HQ 는 outgoing-only 이므로 서비스가 incoming 을 받을 일 없지만, install_me 의 기본 흐름 그대로 둠.
Filename: "{tmp}\chainremote_payload\rustdesk.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 2. 서비스/UI 강제 정지 — toml 박기 전 file lock 해제
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service RustDesk -Force -ErrorAction SilentlyContinue }} catch {{}}; for ($i=0; $i -lt 30; $i++) {{ $svc = Get-Service RustDesk -ErrorAction SilentlyContinue; if ($null -eq $svc -or $svc.Status -eq 'Stopped') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM rustdesk.exe /T *>$null; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. toml 2종을 사용자/서비스 두 경로에 동시 배치 (rendezvous server 인식)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\RustDesk\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{sys}\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. 서비스 재시작 (간단판 — HQ 는 watchdog 없으므로 1회 시도면 충분)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Start-Service RustDesk -ErrorAction Stop }} catch {{ sc.exe start RustDesk *>$null }}"""; StatusMsg: "ChainRemote 서비스 시작 중..."; Flags: runhidden waituntilterminated

; 5. RustDesk 단축아이콘 → ChainRemote 로 rename
Filename: "{cmd}"; Parameters: "/c if exist ""%PUBLIC%\Desktop\RustDesk.lnk"" (del /F /Q ""%PUBLIC%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%PUBLIC%\Desktop\RustDesk.lnk"" ""%PUBLIC%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/c if exist ""%USERPROFILE%\Desktop\RustDesk.lnk"" (del /F /Q ""%USERPROFILE%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%USERPROFILE%\Desktop\RustDesk.lnk"" ""%USERPROFILE%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated

; 6. Start Menu RustDesk → ChainRemote 폴더 rename
Filename: "{cmd}"; Parameters: "/c if exist ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" (rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"" 2>nul & move /Y ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"")"; Flags: runhidden waituntilterminated

; 7. RustDesk 자동시작 reg 제거 (우리 [Registry] 에서 ChainRemote 별도 등록)
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 8. 단축아이콘 IconLocation 갱신
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{app}\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 9. 설치 직후 실행 (재성이 검증용)
Filename: "{app}\rustdesk.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 — HQ 도 재성이 편의상 유지 (트레이 아이콘으로 떠 있음).
; --tray 가 아닌 일반 실행으로 박으면 매 부팅마다 메인 창이 뜨므로 동일하게 --tray.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\rustdesk.exe"" --tray"; \
  Flags: uninsdeletevalue
