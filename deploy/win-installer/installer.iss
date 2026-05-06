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
#define APP_VERSION    "1.2.3"
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
OutputBaseFilename=ChainRemote_Setup
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

[Run]
; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 C:\Program Files\RustDesk\ 로 모든 파일 복사 + 서비스 등록 + 서비스 시작
;    BINARY_NAME=rustdesk 로 빌드해서 install_me 의 RustDesk.exe 가정과 호환됨
Filename: "{tmp}\chainremote_payload\rustdesk.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 2. ★ 서비스 + UI/서비스 잔여 프로세스 강제 정지 (PowerShell wait-loop 으로 robust 화) — toml 박기 전 필수
;    원인: sc stop 만으론 STOP_PENDING 상태에서 file lock 유지 → 다음 cmd copy 가 실패하던 문제
;    이전 fix (8초 timeout + taskkill) 가 진희씨 PC 환경에서는 부족 → 더 강한 보장 필요.
;    개선: sc stop → STOPPED 될 때까지 폴링 (최대 30초) → taskkill /F (잔여 프로세스 전체) → 1초 wait
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""sc.exe stop RustDesk *>$null; for ($i=0; $i -lt 30; $i++) {{ if ((sc.exe query RustDesk 2>$null) -match 'STOPPED') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM rustdesk.exe /T *>$null; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. ★ toml 3종을 두 경로에 동시 배치 (LICENSE_MISMATCH 근본 해결, copy 실패 시 자동 재시도)
;    - 사용자 폴더 : %APPDATA%\RustDesk\config\           (RustDesk 가 user 모드일 때 읽음)
;    - 서비스 폴더 : C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config\
;                                                          (RustDesk 가 service 모드일 때 읽음)
;    개선: PowerShell Copy-Item + 검증 + 최대 5회 재시도 (file lock 일시 보유 환경 대비)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\RustDesk\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{sys}\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ((Get-Content ""$dst\RustDesk2.toml"" -Raw) -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. ★ 서비스 재시작 — 새 config 로 등록
Filename: "{cmd}"; Parameters: "/c sc start RustDesk >nul 2>&1"; Flags: runhidden waituntilterminated

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
