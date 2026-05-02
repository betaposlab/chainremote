; ChainRemote 거래처 배포용 인스톨러 (Inno Setup)
; 빌드: 윈컴에서 .iss 우클릭 → Compile, 또는 ISCC.exe installer.iss
; 결과물: ChainRemote_Setup.exe

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
; RustDesk 폴더 안에 ChainRemote.exe 두기 (DLL 들과 같은 폴더 — 안 그러면 desktop_drop_plugin.dll 등 못 찾음)
DefaultDirName={commonpf}\RustDesk
DefaultGroupName={#APP_NAME}
DisableDirPage=yes
OutputDir=.
OutputBaseFilename=ChainRemote_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\ChainRemote.exe

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
korean.WelcomeBody=ChainRemote 를 설치하고 자동으로 원격지원 환경을 구성합니다.%n%n설치가 끝나면 화면에 표시되는 ID 를 본사에 알려주세요.%n본사가 무인 접속 비밀번호를 안내해 드립니다.
korean.PostInstallNote=설치가 완료되었습니다.%n%n다음 단계:%n1. ChainRemote 가 자동 실행되어 ID 가 발급됩니다.%n2. 본사에 그 ID 를 알려주세요.%n3. 본사가 알려준 영구 비밀번호를 [설정 > 보안 > 영구 비밀번호 설정] 에 입력하세요.

english.WelcomeBody=This will install ChainRemote with a pre-configured remote support server.%n%nAfter installation, please tell BetaposLab the ID shown in ChainRemote.
english.PostInstallNote=Installation finished.

[Files]
; RustDesk 공식 인스톨러를 임시 폴더에 풀고 사일런트 설치 실행
Source: "{#INNER_INSTALLER}"; DestDir: "{tmp}"; Flags: deleteafterinstall

; 우리 NAS 서버 설정 파일을 사용자 AppData 에 배치
Source: "RustDesk2.toml"; DestDir: "{userappdata}\RustDesk\config"; Flags: ignoreversion

[Run]
; 1. RustDesk 공식 코어 사일런트 설치 (waituntilterminated 으로 끝까지 대기)
Filename: "{tmp}\{#INNER_INSTALLER}"; Parameters: "--silent-install"; StatusMsg: "RustDesk 코어 설치 중..."; Flags: runhidden waituntilterminated

; 2. 설치된 rustdesk.exe 를 ChainRemote.exe 로 복사 (synchronous)
Filename: "{cmd}"; Parameters: "/c copy /Y ""{commonpf}\RustDesk\rustdesk.exe"" ""{app}\ChainRemote.exe"""; Flags: runhidden waituntilterminated

; 3. (선택) 설치 직후 ChainRemote 실행 — 위 2번이 끝나야 파일 존재함
Filename: "{app}\ChainRemote.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Icons]
Name: "{group}\{#APP_NAME}";              Filename: "{app}\ChainRemote.exe"
Name: "{group}\{#APP_NAME} 제거";         Filename: "{uninstallexe}"
Name: "{commondesktop}\{#APP_NAME}";      Filename: "{app}\ChainRemote.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "바탕화면 단축아이콘 만들기"; GroupDescription: "추가 단축아이콘:"

[Registry]
; 부팅 시 자동 시작 (모든 사용자)
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\ChainRemote.exe"" --tray"; \
  Flags: uninsdeletevalue

[UninstallDelete]
Type: files; Name: "{app}\ChainRemote.exe"
