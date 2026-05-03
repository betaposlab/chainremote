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
#define APP_VERSION    "1.1.0"
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
UninstallDisplayIcon={app}\chainremote.ico
UninstallDisplayName={#APP_NAME}
SetupIconFile=chainremote.ico

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; 윈컴 빌드 폴더 통째로 임시 폴더에 풀기 (deleteafterinstall: 설치 후 정리)
Source: "{#BUILD_DIR}\*"; DestDir: "{tmp}\chainremote_payload"; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs

; 우리 NAS 서버 설정 파일을 사용자 AppData 에 배치
Source: "RustDesk2.toml"; DestDir: "{userappdata}\RustDesk\config"; Flags: ignoreversion

; ChainRemote 단축아이콘에 쓸 .ico (Program Files 안에 영구 보관)
Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 C:\Program Files\RustDesk\ 로 모든 파일 복사
;    install_me 는 원본 파일명(ChainRemote.exe)을 그대로 보존함 → rename 안 함, 모든 참조 ChainRemote.exe 로 통일
Filename: "{tmp}\chainremote_payload\ChainRemote.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 1-1. install_me 가 만든 RustDesk.lnk 단축아이콘들을 ChainRemote.exe 가리키도록 수정
;      (install_me 는 단축아이콘 TargetPath 를 rustdesk.exe 로 가정해서 만들었을 수 있음 — 다시 우리 .exe 로 fix)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; foreach($p in @('$env:PUBLIC\Desktop\RustDesk.lnk','$env:USERPROFILE\Desktop\RustDesk.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\RustDesk\RustDesk.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.TargetPath='{app}\ChainRemote.exe'; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 1-2. 서비스 등록 (ChainRemote.exe 로)
Filename: "{app}\ChainRemote.exe"; Parameters: "--install-service"; StatusMsg: "서비스 등록 중..."; Flags: runhidden waituntilterminated

; 2. install_me() 가 만든 RustDesk 단축아이콘들을 ChainRemote 로 RENAME
Filename: "{cmd}"; Parameters: "/c if exist ""%PUBLIC%\Desktop\RustDesk.lnk"" (del /F /Q ""%PUBLIC%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%PUBLIC%\Desktop\RustDesk.lnk"" ""%PUBLIC%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/c if exist ""%USERPROFILE%\Desktop\RustDesk.lnk"" (del /F /Q ""%USERPROFILE%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%USERPROFILE%\Desktop\RustDesk.lnk"" ""%USERPROFILE%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated

; 3. Start Menu RustDesk 폴더 → ChainRemote 폴더 RENAME
Filename: "{cmd}"; Parameters: "/c if exist ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" (rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"" 2>nul & move /Y ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"")"; Flags: runhidden waituntilterminated

; 4. RustDesk 자동시작 reg 항목 제거 (우리 [Registry] 에서 ChainRemote 로 별도 등록)
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 5. 단축아이콘들의 IconLocation 을 ChainRemote .ico 로 갱신
;    Inno Setup constant 충돌 회피: PowerShell 의 { 들은 모두 {{ 로 이스케이프
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{app}\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 6. 설치 직후 ChainRemote 실행
Filename: "{app}\ChainRemote.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 — ChainRemote 키 이름 + ChainRemote.exe 직접 가리킴
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\ChainRemote.exe"" --tray"; \
  Flags: uninsdeletevalue
