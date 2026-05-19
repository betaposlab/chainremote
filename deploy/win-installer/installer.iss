; ChainRemote 거래처 배포용 인스톨러 (Inno Setup) — 자체 빌드본 직접 묶기
; 빌드: 윈컴에서 ISCC.exe installer.iss
; 결과물: ChainRemote_Setup.exe
;
; 전략:
;   1. 윈컴에서 빌드한 새 ChainRemote 빌드 폴더 (ChainRemote.exe + DLL + data) 통째로 묶음
;   2. 거래처 PC 에서 임시 폴더에 풀고 ChainRemote.exe --silent-install 실행
;      → install_me() 가 C:\Program Files\RustDesk\ 에 모든 파일 복사 + 서비스 등록 + 단축아이콘 생성
;   3. RustDesk → ChainRemote 로 단축아이콘 / Start Menu 폴더 / 자동시작 reg 모두 rename
;   4. NAS 설정(RustDesk2.toml) + 우리 .ico 배치 + 단축아이콘 IconLocation 갱신

#define APP_NAME       "ChainRemote"
#define APP_VERSION    "1.2.17"
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
DefaultDirName={commonpf}\RustDesk
DefaultGroupName={#APP_NAME}
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=.
; 파일명에 버전 박기 — 매 빌드마다 ChainRemote_Setup_v{버전}.exe 생성 (예: v1.2.3)
; 이름이 매번 달라 옛 빌드 / 새 빌드 헷갈림 방지 + NAS URL 캐시 무관
OutputBaseFilename=ChainRemote_Setup_v{#APP_VERSION}
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
;   - RustDesk.toml          : Config (영구 비밀번호)  — 첫 로드 시 평문이 자동 해싱됨
;   - RustDesk2.toml         : Config2 (서버 + 옵션)  — 우리 NAS, access-mode=full 등
;   - RustDesk_default.toml  : UserDefaultConfig      — 디스플레이/원격커서/음소거 등 기본값
Source: "RustDesk.toml";         DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk2.toml";        DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk_default.toml"; DestDir: "{tmp}\chainremote_config"; Flags: deleteafterinstall ignoreversion

; ChainRemote 단축아이콘에 쓸 .ico (Program Files 안에 영구 보관)
Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

; 서비스 watchdog 스크립트 — 공백 없는 경로(ProgramData)에 둬서 schtasks /TR 중첩인용 회피.
; SYSTEM 예약작업이 10분마다 실행 (아래 [Run] 4b 에서 등록).
Source: "watchdog.ps1"; DestDir: "{commonappdata}\ChainRemote"; Flags: ignoreversion

[Run]
; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 C:\Program Files\RustDesk\ 로 모든 파일 복사 + 서비스 등록 + 서비스 시작
;    BINARY_NAME=rustdesk 로 빌드해서 install_me 의 RustDesk.exe 가정과 호환됨
Filename: "{tmp}\chainremote_payload\rustdesk.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 2. ★ 서비스 + UI/서비스 잔여 프로세스 강제 정지 — toml 박기 전 필수
;    원인: sc stop 만으론 STOP_PENDING 상태에서 file lock 유지 → 다음 copy 실패.
;    개선 (v1.2.4): Get-Service 의 .NET Status enum 비교 (한국어 Windows 의 sc.exe query 출력 "중지됨" 으로 인한
;                  "STOPPED" 문자열 미스매치 버그 수정). 최대 30초 폴링 → taskkill /F → 1초 wait.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service RustDesk -Force -ErrorAction SilentlyContinue }} catch {{}}; for ($i=0; $i -lt 30; $i++) {{ $svc = Get-Service RustDesk -ErrorAction SilentlyContinue; if ($null -eq $svc -or $svc.Status -eq 'Stopped') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM rustdesk.exe /T *>$null; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. ★ toml 3종을 두 경로에 동시 배치 (LICENSE_MISMATCH 근본 해결, copy 실패 시 자동 재시도)
;    - 사용자 폴더 : %APPDATA%\RustDesk\config\           (RustDesk 가 user 모드일 때 읽음)
;    - 서비스 폴더 : C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\
;                                                          (RustDesk 가 service 모드일 때 읽음)
;    개선: PowerShell Copy-Item + 검증 + 최대 5회 재시도 (file lock 일시 보유 환경 대비)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\RustDesk\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{sys}\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. ★ 서비스 재시작 — 새 config 로 등록 (검증 + 재시도 + updater.log 기록)
;    배경: install_me 가 서비스를 start=auto 로 생성·시작하지만, 위 2단계가 강제 정지(taskkill 포함)함.
;          옛 버전은 여기서 `sc start >nul 2>&1` fire-and-forget → 실패해도 아무도 모름.
;          start=auto 라 재부팅하면 살아나지만, 절전만 하고 재부팅 안 하는 PC 는 서비스가
;          영영 죽은 채 방치 → 트레이는 떠 있는데 hbbs 미등록·자동업데이트 불능 (2026-05-18 현장 증상).
;    수정: Running 도달까지 폴링(.NET Status enum — 한국어 윈도우 "중지됨" 문자열 버그 회피),
;          최대 3회 재시도, 결과를 C:\ProgramData\ChainRemote\updater.log 에 append
;          → 서비스가 죽어도 installer 가 남긴 줄로 다음 진단 가능 (updater 는 죽은 서비스 안에선 못 남김).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$log='C:\ProgramData\ChainRemote\updater.log'; New-Item -Path (Split-Path $log) -ItemType Directory -Force *>$null; $ok=$false; for ($a=0; $a -lt 3; $a++) {{ try {{ Start-Service RustDesk -ErrorAction Stop }} catch {{ sc.exe start RustDesk *>$null }}; for ($i=0; $i -lt 30; $i++) {{ $svc=Get-Service RustDesk -ErrorAction SilentlyContinue; if ($svc -ne $null -and $svc.Status -eq 'Running') {{ $ok=$true; break }}; Start-Sleep -Seconds 1 }}; if ($ok) {{ break }} }}; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $res= if ($ok) {{ 'Running OK' }} else {{ 'FAILED to reach Running after 3x30s' }}; Add-Content -Path $log -Value ($st + ' installer: sc start RustDesk -> ' + $res)"""; StatusMsg: "ChainRemote 서비스 시작 중..."; Flags: runhidden waituntilterminated

; 4b. ★ 서비스 watchdog 예약작업 등록 — 이미 죽은 서비스를 재부팅 없이 복구 (위 4단계의 안전망)
;     비권한 트레이 UI 는 UAC 없이 서비스를 못 켜므로 SYSTEM 예약작업이 정석.
;     /SC MINUTE /MO 10: 10분마다 SYSTEM 으로 watchdog.ps1 실행 (서비스 죽었으면 살림).
;     watchdog.ps1 은 공백 없는 ProgramData 경로라 /TR 중첩인용 불필요(한 단계 인용만).
;     /F 로 재설치 시 작업 덮어씀. 등록 직후 1회 즉시 실행해 동작 확인(서비스 정상이면 무동작).
Filename: "schtasks.exe"; Parameters: "/Create /TN ChainRemoteServiceWatchdog /TR ""powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\ChainRemote\watchdog.ps1"" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F"; StatusMsg: "ChainRemote 자동복구 등록 중..."; Flags: runhidden waituntilterminated
Filename: "schtasks.exe"; Parameters: "/Run /TN ChainRemoteServiceWatchdog"; Flags: runhidden waituntilterminated

; 5. install_me() 가 만든 RustDesk 단축아이콘들을 ChainRemote 로 RENAME
Filename: "{cmd}"; Parameters: "/c if exist ""%PUBLIC%\Desktop\RustDesk.lnk"" (del /F /Q ""%PUBLIC%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%PUBLIC%\Desktop\RustDesk.lnk"" ""%PUBLIC%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/c if exist ""%USERPROFILE%\Desktop\RustDesk.lnk"" (del /F /Q ""%USERPROFILE%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%USERPROFILE%\Desktop\RustDesk.lnk"" ""%USERPROFILE%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated

; 6. Start Menu RustDesk 폴더 → ChainRemote 폴더 RENAME
Filename: "{cmd}"; Parameters: "/c if exist ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" (rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"" 2>nul & move /Y ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"")"; Flags: runhidden waituntilterminated

; 7. RustDesk 자동시작 reg 항목 제거 (우리 [Registry] 에서 ChainRemote 로 별도 등록)
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 8. 단축아이콘들의 IconLocation 을 ChainRemote .ico 로 갱신
;    Inno Setup constant 충돌 회피: PowerShell 의 { 들은 모두 {{ 로 이스케이프
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{app}\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 9. 설치 직후 ChainRemote 실행
Filename: "{app}\rustdesk.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 — ChainRemote 키 이름 (실행파일은 rustdesk.exe)
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\rustdesk.exe"" --tray"; \
  Flags: uninsdeletevalue

[UninstallRun]
; 제거 시 watchdog SYSTEM 예약작업도 정리 (고아 작업 방지)
Filename: "schtasks.exe"; Parameters: "/Delete /TN ChainRemoteServiceWatchdog /F"; Flags: runhidden; RunOnceId: "DelWatchdogTask"
