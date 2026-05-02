; ChainRemote 거래처 배포용 인스톨러 (Inno Setup)
; 빌드: 윈컴에서 .iss 우클릭 → Compile, 또는 ISCC.exe installer.iss
; 결과물: ChainRemote_Setup.exe
;
; 단순 전략 — rename 안 함:
;   - RustDesk 공식 인스톨러를 사일런트로 깔아 rustdesk.exe + DLL 들이 정상 설치
;   - 우리 NAS 설정(RustDesk2.toml)을 사용자 AppData 에 자동 배치
;   - 단축아이콘 / 자동시작 모두 "ChainRemote" 이름으로 등록 (실행 파일은 rustdesk.exe)
; 거래처는 "ChainRemote" 아이콘만 보고 일반 사용. 창 제목만 "RustDesk" 로 뜸 (cosmetic).

#define APP_NAME       "ChainRemote"
#define APP_VERSION    "1.0.0"
#define APP_PUBLISHER  "BetaposLab"
#define APP_URL        "https://betaposlab.com"
#define INNER_INSTALLER "rustdesk-1.4.6-x86_64.exe"

[Setup]
AppId={{8B6F7E2A-1D4C-4A3F-9E5B-3F2C1D7E8B4A}
AppName={#APP_NAME}
AppVersion={#APP_VERSION}
AppPublisher={#APP_PUBLISHER}
AppPublisherURL={#APP_URL}
; RustDesk 폴더에 그대로 (DLL 들과 같은 위치이므로 단축아이콘에서 rustdesk.exe 호출 가능)
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
UninstallDisplayIcon={app}\rustdesk.exe
UninstallDisplayName={#APP_NAME}

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; RustDesk 공식 인스톨러를 임시 폴더에 풀고 사일런트 설치 실행
Source: "{#INNER_INSTALLER}"; DestDir: "{tmp}"; Flags: deleteafterinstall

; 우리 NAS 서버 설정 파일을 사용자 AppData 에 배치
Source: "RustDesk2.toml"; DestDir: "{userappdata}\RustDesk\config"; Flags: ignoreversion

[Run]
; 1. RustDesk 공식 코어 사일런트 설치 (RustDesk.lnk 단축아이콘 + Start Menu\RustDesk 자동 생성)
Filename: "{tmp}\{#INNER_INSTALLER}"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 2. RustDesk 가 만든 단축아이콘을 ChainRemote 로 RENAME (atomic move — 안정적)
Filename: "{cmd}"; Parameters: "/c if exist ""%PUBLIC%\Desktop\RustDesk.lnk"" (del /F /Q ""%PUBLIC%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%PUBLIC%\Desktop\RustDesk.lnk"" ""%PUBLIC%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated
Filename: "{cmd}"; Parameters: "/c if exist ""%USERPROFILE%\Desktop\RustDesk.lnk"" (del /F /Q ""%USERPROFILE%\Desktop\ChainRemote.lnk"" 2>nul & move /Y ""%USERPROFILE%\Desktop\RustDesk.lnk"" ""%USERPROFILE%\Desktop\ChainRemote.lnk"")"; Flags: runhidden waituntilterminated

; 3. Start Menu RustDesk 폴더 → ChainRemote 폴더 RENAME
Filename: "{cmd}"; Parameters: "/c if exist ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" (rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"" 2>nul & move /Y ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\ChainRemote"")"; Flags: runhidden waituntilterminated

; 4. RustDesk 자동시작 reg 항목 제거 (우리 [Registry] 에서 ChainRemote 로 별도 등록함)
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 5. 설치 직후 ChainRemote 실행
Filename: "{app}\rustdesk.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 — "ChainRemote" 키 이름으로 등록, 실행 대상은 rustdesk.exe
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\rustdesk.exe"" --tray"; \
  Flags: uninsdeletevalue
