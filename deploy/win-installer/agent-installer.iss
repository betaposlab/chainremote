; 거래처 배포용 통합 인스톨러 (Inno Setup) — x64 + 32비트 자동 판별
; 빌드: 윈컴에서 ISCC.exe agent-installer.iss  (사전: build-all.ps1 → x64 / build-agent32.ps1 → x86 페이로드)
; 결과물: ChainRemote_Agent_Setup_v{version}.exe  (파일명 규약 유지 — 패널 푸시/release 파이프라인 무변경)
;
; 통합 동작 (2026-06-10, Chang 결정):
;   Inno 셋업 본체(stub)는 원래 32비트라 Win7 SP1 32비트부터 Win11 x64 까지 어디서든 실행된다.
;   두 페이로드를 모두 담고, 설치 시 "윈도우 버전" 기준으로 한쪽만 풀어서 설치한다(UseX64Payload):
;     - 64비트 AND Win8(6.2)+           → Flutter x64 빌드 (Rust 1.81, Win10+ API 사용)
;     - Win7(6.1 이하) 또는 32비트 OS   → Sciter i686 빌드 (Rust 1.75, Win7 호환. 64비트 Win7 은 WOW64 로 실행)
;   ★비트수만 보면 안 된다 (2026-07-11 월광식자재 사고): 64비트 Win7 에 x64 빌드를 깔면 GetHostNameW
;     (Win8+ API) 를 못 찾아 실행 실패한다. Win7 은 64비트여도 반드시 i686(Win7 호환) 페이로드.
;   덕분에 패널/업데이트 채널은 여전히 arch 를 구분할 필요가 없다 (한 파일을 아무 거래처에나 푸시 OK).
;
; Phase 1 분기: 거래처 빌드 = conn-type=incoming (..\custom-agent.txt → custom.txt, click-only override 포함).
; 본사 빌드는 hq-installer.iss (x64 전용) 로 따로 있다.
;
; 설치 순서 (두 아키텍처 동일):
;   1. 페이로드를 {tmp}\chainremote_payload 에 풀고 ChainRemote.exe --silent-install 실행
;      → install_me() 가 페이로드 폴더 전체(XCOPY /E — 32비트는 sciter.dll/custom.txt 동반)를
;        Program Files\ChainRemote 로 복사 + ChainRemote Service 등록 + 단축아이콘 생성
;   2. NAS 설정 toml 을 user + LocalService 두 경로에 배치 (보존 가드 포함)
;   3. 서비스 기동 + watchdog 예약작업 + 잔재 정리 + self-test
;
; ⚠ PowerShell 단계는 전부 PS 2.0 호환 문법 (Win7 기본 PS2: *>$null / -Raw / -Directory 금지).
;   PS5 에서도 동일 동작 — x64 경로도 이 문법으로 통일했다 (2026-06-10).

#define APP_NAME       "ChainRemote"
#define APP_VERSION    "1.4.60"
#define APP_PUBLISHER  "BetaposLab"
#define APP_URL        "https://betaposlab.com"
; x64: 윈컴 Flutter 빌드 출력 (build-all.ps1)
#define BUILD_DIR_X64  "C:\src\ChainRemote\flutter\build\windows\x64\runner\Release"
; x86: build-agent32.ps1 이 스테이징 (i686 ChainRemote.exe + sciter.dll + custom.txt)
#define BUILD_DIR_X86  "agent32-payload"

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
; 파일명에 버전 박기 — 옛/새 빌드 혼동 방지 + NAS URL 캐시 이슈 회피
OutputBaseFilename=ChainRemote_Agent_Setup_v{#APP_VERSION}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; 설치 마법사 첫 단계 = 사용 동의 페이지 (원격 수신 동의 + AGPL 고지. 파일은 UTF-8 BOM 필수 — 없으면 CP949 로 읽혀 한글이 깨진다).
; 자동 업데이트(/VERYSILENT)는 이 페이지를 안 띄운다 → 기존 푸시/업데이트 플로우 무영향.
LicenseFile=license-agent-ko.txt
PrivilegesRequired=admin
; 64비트 OS 는 64비트 설치 모드({commonpf}=C:\Program Files), 32비트 OS 는 자동으로 32비트 모드.
; 어느 쪽이든 {commonpf}\ChainRemote 이 install_me() 의 %ProgramFiles% 계산과 맞는다.
ArchitecturesInstallIn64BitMode=x64compatible
; Win7 이상만 허용 (XP/Vista 차단). 2026-06-17: 'sp1' 명시를 뺐다 — Win7 Enterprise K POS 일부가
;   실제로는 SP1 인데 Inno 의 SP 감지가 SP0 으로 떨어져 "Windows 버전 미지원" 으로 설치가 막혔다
;   (호환shim/POS이미지/에디션 quirk. Windows 자체는 SP1 로 표시). SP 요구는 런타임 동봉(app-local
;   UCRT/VC++)으로 대체되므로 major.minor(6.1)만 검사하면 진짜 SP1 머신이 안 막힌다. 비-SP1 은
;   실행 시 런타임 부재로 걸러진다(설치 진단 팝업으로 드러남).
MinVersion=6.1
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
; ── 아키텍처별 페이로드 (둘 다 패키지에 담기고, 설치 시 한쪽만 풀림) ──
Source: "{#BUILD_DIR_X64}\*"; DestDir: "{tmp}\chainremote_payload"; Check: UseX64Payload; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs
; x64 페이로드에도 custom.txt 동봉 — x86(build-agent32.ps1:108)과 대칭. install_me 의 XCOPY(/E,
;   windows.rs:1351)가 payload 폴더 전체를 "설치된 exe 옆"으로 복사하므로, 레지스트리 InstallLocation 이
;   옛 설치 잔재로 어긋나도(삼성공판장 사례) custom.txt 가 항상 서비스 exe 옆에 있어 is_incoming_only 가 보장된다.
;   (그동안 x64 는 1.5 의 하드코딩 {commonpf} 복사에만 의존해, 경로가 갈라지면 조용히 미적용되던 구조적 결함을 없앰. 2026-06-20)
Source: "..\custom-agent.txt"; DestDir: "{tmp}\chainremote_payload"; DestName: "custom.txt"; Check: UseX64Payload; Flags: deleteafterinstall ignoreversion
Source: "{#BUILD_DIR_X86}\*"; DestDir: "{tmp}\chainremote_payload"; Check: UseX86Payload; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs

; 우리 toml — [Run] 단계에서 두 경로(user + LocalService)에 동시 배치
;   - RustDesk2-agent.toml   : Config2 (서버 + 옵션) — agent 전용 (approve-mode=click,
;                              영구비번 미사용). APP_NAME=ChainRemote 라 ChainRemote2.toml 이름으로 배치.
;   - RustDesk_default.toml  : UserDefaultConfig — 디스플레이/원격커서/음소거 등 기본값
Source: "RustDesk2-agent.toml";  DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote2.toml"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk_default.toml"; DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote_default.toml"; Flags: deleteafterinstall ignoreversion

; Phase 1 분기 플래그 — 단일 원천은 루트 deploy/custom-agent.txt (override-settings approve-mode=click 포함).
; silent-install 이 {app} 을 클린업하므로 임시 폴더에 두고 [Run] 1.5 에서 절대 경로로 박는다.
; (32비트 페이로드엔 build-agent32.ps1 이 같은 파일을 동봉 — XCOPY 로도 들어간다. 이중 안전벨트.)
Source: "..\custom-agent.txt"; DestDir: "{tmp}\custom_payload"; DestName: "custom.txt"; Flags: deleteafterinstall ignoreversion

; per-tenant overlay 추출기 — 패널이 베이스 .exe 끝에 덧붙인 대리점 설정을 custom.txt 로 적용.
;   overlay 없으면 번들 custom.txt 그대로 = 기존(자동업뎃 포함) 동작 무변경.
Source: "extract-enroll-overlay.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall ignoreversion

; ChainRemote 단축아이콘에 쓸 .ico (Program Files 안에 영구 보관)
Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

; 서비스 watchdog (PS2-safe — Win7/Win10 공용). 공백 없는 ProgramData 경로 = schtasks /TR 중첩인용 회피.
Source: "watchdog.ps1"; DestDir: "{commonappdata}\ChainRemote"; Flags: ignoreversion

[Run]
; 0. Windows ephemeral port range 확장 (사업화 안전망 — 다른 원격 SW 의 socket 누수에 휘말리지 않게)
Filename: "netsh.exe"; Parameters: "int ipv4 set dynamicport tcp start=10000 num=55000"; StatusMsg: "Windows ephemeral port 확장 적용..."; Flags: runhidden waituntilterminated
Filename: "netsh.exe"; Parameters: "int ipv6 set dynamicport tcp start=10000 num=55000"; Flags: runhidden waituntilterminated

; 0.5. silent-install 직전 옛 ChainRemote 강제 종료 (파일 잠금 해제 + 옛/새 프로세스 공존 방지)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; taskkill /F /IM ChainRemote.exe /T >$null 2>&1; Start-Sleep -Seconds 2"""; StatusMsg: "옛 ChainRemote 프로세스 정리 중..."; Flags: runhidden waituntilterminated

; 0.7. per-tenant overlay 를 silent-install '前'에 적용 (2026-07-01 fix — Win7 실측으로 확정).
;    install_me() 가 페이로드의 custom.txt 를 설치폴더로 그대로 복사하고 서비스를 즉시 시작하므로,
;    여기서 키를 심어야 서비스가 "키를 든 채" 시작해 첫 실행에 바로 enroll 된다 (재부팅 불필요).
;    (예전엔 1.4/1.5 에서 서비스 시작 '後' 적용 → 첫 실행은 키 없이 떠서 재부팅 전까진 자동등록이 안 됐다.
;     GN50840785 Win7 실설치에서 재부팅 후에야 등록된 게 이 순서 버그였다.)
;    overlay 없으면(베이스/자동업뎃) 스크립트가 파일을 안 건드려 기존 동작 그대로.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\extract-enroll-overlay.ps1"" -Setup ""{srcexe}"" -Stage ""{tmp}\chainremote_payload\custom.txt"""; StatusMsg: "ChainRemote 거래처 식별 설정 적용 중..."; Flags: runhidden waituntilterminated

; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 페이로드 폴더 전체를 Program Files 로 복사
;    + ChainRemote Service 등록 + 서비스 시작 + ChainRemote.lnk 단축아이콘 자동 생성.
;    (x64 = Flutter 빌드 / x86 = Sciter 빌드 — 같은 코어라 동작 동일)
Filename: "{tmp}\chainremote_payload\ChainRemote.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 1.4. per-tenant overlay 적용 — setup .exe 끝의 대리점 설정 blob 을 읽어 스테이징 custom.txt 를 덮어쓴다.
;    overlay 없으면(베이스/자동업뎃) custom_payload\custom.txt 를 안 건드려 아래 1.5 가 번들 그대로 박는다 = 무변경.
;    (인터랙티브/사일런트 무관하게 동작 — 패널이 만든 per-tenant .exe 면 어느 경로든 그 대리점으로 enroll.)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\extract-enroll-overlay.ps1"" -Setup ""{srcexe}"" -Stage ""{tmp}\custom_payload\custom.txt"""; StatusMsg: "ChainRemote 거래처 식별 설정 확인 중..."; Flags: runhidden waituntilterminated

; 1.5. custom.txt 절대 경로 박기 (silent-install 후) — load_custom_client() 는 설치된 exe 옆만 읽는다.
;    옛 Inno AppId 잔재로 {app} 이 다른 폴더를 가리켜도 안전하도록 절대 경로로 강제 (2026-05-26 fix).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$dst='{commonpf}\ChainRemote'; New-Item -Path $dst -ItemType Directory -Force | Out-Null; Copy-Item '{tmp}\custom_payload\custom.txt' (Join-Path $dst 'custom.txt') -Force"""; StatusMsg: "ChainRemote 분기 설정 적용 중..."; Flags: runhidden waituntilterminated

; 2. 서비스 + 잔여 프로세스 강제 정지 — toml 박기 전 필수 (file lock 해제).
;    상태는 .NET Status enum 으로 비교 — 한국어 Windows "중지됨" 문자열 미스매치 회피.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; for ($i=0; $i -lt 30; $i++) {{ $svc = Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($null -eq $svc -or $svc.Status -eq 'Stopped') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM ChainRemote.exe /T >$null 2>&1; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. toml 을 두 경로에 동시 배치 (LICENSE_MISMATCH 근본 해결) + 자동업데이트 보존 가드
;    (dst 에 ChainRemote2.toml 이 이미 있으면 안 박는다 — 거래처 자체 설정 보존. 신규 설치만 박힘.)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force | Out-Null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ([System.IO.File]::ReadAllText(""$dst\ChainRemote2.toml"") -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{sys}\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force | Out-Null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ([System.IO.File]::ReadAllText(""$dst\ChainRemote2.toml"") -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. 서비스 재시작 — Running 도달 폴링 + 3회 재시도 + updater.log 기록 (죽으면 진단 단서 남김)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$log='C:\ProgramData\ChainRemote\updater.log'; New-Item -Path (Split-Path $log) -ItemType Directory -Force | Out-Null; $ok=$false; for ($a=0; $a -lt 3; $a++) {{ try {{ Start-Service ChainRemote -ErrorAction Stop }} catch {{ sc.exe start ChainRemote >$null 2>&1 }}; for ($i=0; $i -lt 30; $i++) {{ $svc=Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($svc -ne $null -and $svc.Status -eq 'Running') {{ $ok=$true; break }}; Start-Sleep -Seconds 1 }}; if ($ok) {{ break }} }}; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $res= if ($ok) {{ 'Running OK' }} else {{ 'FAILED to reach Running after 3x30s' }}; Add-Content -Path $log -Value ($st + ' installer: sc start ChainRemote -> ' + $res)"""; StatusMsg: "ChainRemote 서비스 시작 중..."; Flags: runhidden waituntilterminated

; 4b. 서비스 watchdog 예약작업 — 죽은 서비스를 재부팅 없이 복구 (10분 주기 SYSTEM)
Filename: "schtasks.exe"; Parameters: "/Create /TN ChainRemoteServiceWatchdog /TR ""powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\ChainRemote\watchdog.ps1"" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F"; StatusMsg: "ChainRemote 자동복구 등록 중..."; Flags: runhidden waituntilterminated
Filename: "schtasks.exe"; Parameters: "/Run /TN ChainRemoteServiceWatchdog"; Flags: runhidden waituntilterminated

; 5~7. 옛 RustDesk 잔재 정리 (마이그레이션 보조 — chainremote_migrate.rs 와 안전 중첩)
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%PUBLIC%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%USERPROFILE%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 8. 단축아이콘 IconLocation 을 ChainRemote .ico 로 갱신
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{app}\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 8.5. 인스톨 후 self-test 스모크 — Service/Process/Exe 3종 체크를 updater.log 에 PASS/FAIL 기록.
;     (절대 경로 하드코딩 대신 {commonpf} — 32/64비트 설치 모드 모두 정확)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Start-Sleep -Seconds 8; $log='C:\ProgramData\ChainRemote\updater.log'; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $svcobj=Get-Service ChainRemote -ErrorAction SilentlyContinue; $svc='None'; if ($svcobj) {{ $svc=[string]$svcobj.Status }}; $procs=@(Get-Process ChainRemote -ErrorAction SilentlyContinue).Count; $exe='{commonpf}\ChainRemote\ChainRemote.exe'; $exists=Test-Path $exe; $verdict='FAIL'; if (($svc -eq 'Running') -and ($procs -ge 1) -and $exists) {{ $verdict='PASS' }}; Add-Content -Path $log -Value ($st + ' installer: SELFTEST v{#APP_VERSION} svc=' + $svc + ' procs=' + $procs + ' exe=' + $exists + ' -> ' + $verdict)"""; StatusMsg: "ChainRemote 설치 self-test 중..."; Flags: runhidden waituntilterminated

; 8.6. 설치 환경(Win7 변종) 기록 — 거래처 환경을 파악하는 눈. Win7 은 RTM/SP1/POSReady/
;     Embedded + 에디션 + x86/x64 로 제각각이라 거래처별 실제 변종을 모르면 대응이 안 된다.
;     OS Caption/버전/SP/아키텍처 + PowerShell 버전 + UCRT(시스템/exe옆) + VC++(exe옆) 유무를
;     updater.log 에 한 줄로 남긴다. PS 2.0 안전: Get-WmiObject(CIM 아님) + '*>' 없음 + 스칼라 .Count 미사용.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$log='C:\ProgramData\ChainRemote\updater.log'; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $os=Get-WmiObject -Class Win32_OperatingSystem -EA SilentlyContinue; $psv=$PSVersionTable.PSVersion.ToString(); $exe='{commonpf}\ChainRemote\ChainRemote.exe'; $ucrtSys=Test-Path ($env:windir + '\System32\ucrtbase.dll'); $ucrtLocal=Test-Path (Join-Path (Split-Path $exe) 'api-ms-win-crt-runtime-l1-1-0.dll'); $vcrLocal=Test-Path (Join-Path (Split-Path $exe) 'vcruntime140.dll'); Add-Content -Path $log -Value ($st + ' installer: ENV os=[' + $os.Caption + '] ver=' + $os.Version + ' sp=' + $os.ServicePackMajorVersion + ' arch=' + $os.OSArchitecture + ' ps=' + $psv + ' ucrt_sys=' + $ucrtSys + ' ucrt_local=' + $ucrtLocal + ' vcr_local=' + $vcrLocal)"""; StatusMsg: "ChainRemote 설치 환경 기록 중..."; Flags: runhidden waituntilterminated

; 9. 설치 직후 ChainRemote 실행 — 절대 경로 강제 (옛 AppId {app} mismatch 회피)
Filename: "{commonpf}\ChainRemote\ChainRemote.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 (실행파일 = ChainRemote.exe, x64/x86 동일)
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\ChainRemote.exe"" --tray"; \
  Flags: uninsdeletevalue

[UninstallRun]
; 제거 시 watchdog SYSTEM 예약작업도 정리 (고아 작업 방지)
Filename: "schtasks.exe"; Parameters: "/Delete /TN ChainRemoteServiceWatchdog /F"; Flags: runhidden; RunOnceId: "DelWatchdogTask"
; 상호 레지스트리 청소 (2026-07-14) — 기기를 다른 거래처로 재사용할 때 옛 상호("태조산 메인")가
;   남아 재enroll 시 옛 이름으로 부활하는 오염원 제거. 32/64비트 view 둘 다(설치모드 불일치 대비).
;   /reg: 스위치는 Win7+ reg.exe 지원. 값이 없어도 조용히 실패(runhidden)라 무해.
Filename: "reg.exe"; Parameters: "delete HKLM\SOFTWARE\ChainRemote /v CustomerName /f /reg:64"; Flags: runhidden; RunOnceId: "DelCustomerName64"
Filename: "reg.exe"; Parameters: "delete HKLM\SOFTWARE\ChainRemote /v CustomerName /f /reg:32"; Flags: runhidden; RunOnceId: "DelCustomerName32"

[Code]
var
  EnrollPage: TInputQueryWizardPage;  // auto-enroll 거래처 상호 입력 페이지

// ── 페이로드 선택: 비트수 아니라 "윈도우 버전" 기준 (2026-07-11 월광식자재 사고) ──────────
// x64 페이로드는 Rust 1.81 빌드라 Win10+ API(GetHostNameW 등)를 써서 Win7 에선 실행 불가
//   ("GetHostNameW 를 WS2_32.dll 에서 찾을 수 없음"). 32비트 페이로드만 Rust 1.75 = Win7 호환.
//   그래서 x64 페이로드는 "64비트 AND Win8(6.2)+" 에서만 쓰고, Win7(6.1 이하)은 64비트여도
//   32비트(Win7 호환) 페이로드를 쓴다 — 32비트 exe 는 64비트 Win7 에서 WOW64 로 정상 실행.
function IsWin8OrLater(): Boolean;
var
  V: TWindowsVersion;
begin
  GetWindowsVersionEx(V);
  Result := (V.Major > 6) or ((V.Major = 6) and (V.Minor >= 2));
end;

function UseX64Payload(): Boolean;
begin
  Result := Is64BitInstallMode() and IsWin8OrLater();
end;

function UseX86Payload(): Boolean;
begin
  Result := not UseX64Payload();
end;

// ── 다운그레이드 가드 (2026-06-06) ────────────────────────────────
// 설치된 버전이 이 인스톨러보다 높으면 설치 거부. 의도적 롤백은 /FORCE=1 로만.
procedure CRLog(Msg: String);
begin
  try
    if not DirExists(ExpandConstant('{commonappdata}\ChainRemote')) then
      CreateDir(ExpandConstant('{commonappdata}\ChainRemote'));
    SaveStringToFile(ExpandConstant('{commonappdata}\ChainRemote\updater.log'),
      GetDateTimeString('yyyy-mm-dd hh:nn:ss', '-', ':') + ' ' + Msg + #13#10, True);
  except
  end;
end;

// ── auto-enroll: 거래처 상호 수집 + 레지스트리 기록 ─────────────────────────
// 한국어 상호를 파일(CP949)/custom.txt 로 보내면 인코딩이 깨진다 → 레지스트리 REG_SZ(유니코드 네이티브)에 기록.
// 에이전트(Rust)가 HKLM\SOFTWARE\ChainRemote\CustomerName 을 읽어 enroll 시 거래처명으로 쓴다.
procedure CRWriteCustomerName(Name: String);
begin
  if Name = '' then Exit;  // 빈칸이면 안 쓴다 → 서버가 hostname placeholder 로 명명.
  try
    if RegWriteStringValue(HKLM, 'SOFTWARE\ChainRemote', 'CustomerName', Name) then
      CRLog('installer: CustomerName registry write OK')
    else
      CRLog('installer: CustomerName registry write FAILED');
  except
    CRLog('installer: CustomerName registry write EXCEPTION');
  end;
end;

procedure InitializeWizard();
begin
  // 거래처 상호 입력 페이지 (라이선스 동의 다음). 자동업뎃(/VERYSILENT)은 마법사를 안 띄우므로 안 뜬다 →
  //   기존 푸시/업데이트 플로우 무영향. ssPostInstall 의 WizardSilent 가드가 silent 기록도 막는다.
  EnrollPage := CreateInputQueryPage(wpLicense,
    '거래처 상호',
    '이 PC가 설치될 매장(거래처)의 상호를 입력하세요.',
    '신규·재설치 관계없이 항상 입력하세요. 같은 매장이면 같은 상호를 그대로 넣으면 됩니다.' + #13#10 +
    '(재설치는 아무 변화 없고, 포스 교체·기기 이동은 서버가 상호로 알아서 정리합니다.)' + #13#10 +
    '비워두면 임시 이름으로 등록되고 패널에서 지정할 수 있습니다.');
  EnrollPage.Add('상호 (매장명):', False);
end;

function CRCmpVer(A, B: String): Integer;
var
  av, bv, p: Integer;
begin
  Result := 0;
  while (Result = 0) and ((Length(A) > 0) or (Length(B) > 0)) do begin
    p := Pos('.', A);
    if p > 0 then begin av := StrToIntDef(Copy(A, 1, p - 1), 0); Delete(A, 1, p); end
    else begin av := StrToIntDef(A, 0); A := ''; end;
    p := Pos('.', B);
    if p > 0 then begin bv := StrToIntDef(Copy(B, 1, p - 1), 0); Delete(B, 1, p); end
    else begin bv := StrToIntDef(B, 0); B := ''; end;
    if av > bv then Result := 1 else if av < bv then Result := -1;
  end;
end;

function CRInstalledVer(): String;
var
  v: String;
begin
  Result := '';
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{8B6F7E2A-1D4C-4A3F-9E5B-3F2C1D7E8B4A}_is1', 'DisplayVersion', v) then Result := v
  else if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{8B6F7E2A-1D4C-4A3F-9E5B-3F2C1D7E8B4A}_is1', 'DisplayVersion', v) then Result := v;
end;

// '거래처 상호' 페이지는 항상 띄운다 (2026-07-14 "상호 = 교체 키" 재설계).
//   종전엔 재설치에서 숨겼는데(이름 오염 우려) "어느 땐 넣고 어느 땐 패스" 조건 분기가
//   현장 혼란만 낳았다. 이제 단일 룰 = 언제나 그 매장 상호 입력. 서버 enroll 매트릭스가
//   같은 상호(정규화 일치)면 무변화, 다른 매장 상호면 기기 이동/교체로 판정하고, 애매하면
//   패널 알림으로 마스터에게 넘기므로 재설치 때 상호를 넣어도 오염되지 않는다.
//   자동업뎃(/VERYSILENT)은 애초에 마법사가 안 떠서 무관.

function InitializeSetup(): Boolean;
var
  Installed: String;
begin
  Result := True;
  if ExpandConstant('{param:FORCE|0}') = '1' then Exit;
  Installed := CRInstalledVer();
  if (Installed <> '') and (CRCmpVer(Installed, '{#APP_VERSION}') > 0) then begin
    CRLog('installer: DOWNGRADE-GUARD blocked (installed=' + Installed + ' > setup={#APP_VERSION})');
    if not WizardSilent() then
      MsgBox('이미 더 높은 버전(' + Installed + ')이 설치되어 있어 설치를 중단합니다.' + #13#10 + '(강제 설치 시 /FORCE=1)', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  // 임시 시작 진단 팝업(2026-06-15 향우정 설치실패 규명용)은 제거됨(2026-06-18).
  //   정상 설치 확인 완료. 자동업뎃/수동설치 모두 팝업 없이 진행한다. 설치 전 쓰기검증은
  //   아래 PrepareToInstall() 이 (팝업 없이) 계속 수행하고, 실패 시에만 한글 사유를 보여준다.
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    // 옛 Agent32 단독 인스톨러(2026-06-10, 테스트 POS 1대에만 배포됨)의 제어판 중복 항목 정리.
    // 같은 경로/서비스에 덮어 설치되므로 uninstall 레지스트리 키만 지우면 된다.
    RegDeleteKeyIncludingSubkeys(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{7C4D9A2E-5B31-4F8C-B2D6-1E9F3A6C8D52}_is1');
    RegDeleteKeyIncludingSubkeys(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{7C4D9A2E-5B31-4F8C-B2D6-1E9F3A6C8D52}_is1');
  end;
  if CurStep = ssPostInstall then begin
    // auto-enroll — 인터랙티브 설치면 입력한 상호를 레지스트리에 기록(에이전트 enroll 시 사용).
    //   자동업뎃(/VERYSILENT)은 WizardSilent=True 라 스킵 = 기존 CustomerName 보존(상호가 안 지워짐).
    if (not WizardSilent()) and Assigned(EnrollPage) then
      CRWriteCustomerName(Trim(EnrollPage.Values[0]));
  end;
end;

// ── 설치 전 쓰기 보호 자가진단 (2026-06-15) ──────────────────────────────────
// {app}(=Program Files\ChainRemote)에 실제 파일 쓰기를 미리 시도한다. 쓰기 보호
//   (쓰기 필터 UWF/FBWF/EWF · 폴더 Deny 권한 · 백신 실시간 차단)면 설치 도중(install_me
//   복사 단계)에 뜨던 암호 같은 'CreateFile 실패 코드5' / '디렉터리 생성 액세스 거부'
//   대신, 여기서 원인+처방을 한글로 보여주고 깔끔히 중단한다. (향우정 Win7 32bit 사고를 드러냄.)
// 자동 업데이트(/VERYSILENT, 이미 설치돼 쓰기 가능한 기기)는 중단하지 않는다 — 기존 플로우 무영향.
function CRDiag(): String;
var
  V: TWindowsVersion;
  S: String;
begin
  // 실패해도([Files] 전) updater.log/메시지에 남길 환경 한 줄. 향우정류 진단의 핵심 데이터.
  GetWindowsVersionEx(V);
  S := 'os=' + IntToStr(V.Major) + '.' + IntToStr(V.Minor) + ' sp=' + IntToStr(V.ServicePackMajor);
  if Is64BitInstallMode() then S := S + ' mode=x64' else S := S + ' mode=x86';
  // 핵심: 이 설치가 실제로 관리자 권한으로 승격됐는지. no 면 "권한 승격 실패"가 범인.
  if IsAdminInstallMode() then S := S + ' admin=yes' else S := S + ' admin=no';
  Result := S;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Dir, Probe, Diag: String;
  Ok: Boolean;
begin
  Result := '';
  Dir := ExpandConstant('{app}');
  Diag := CRDiag();
  Ok := True;
  if not DirExists(Dir) then
    Ok := ForceDirectories(Dir);
  if Ok then begin
    Probe := Dir + '\.cr_writetest.tmp';
    Ok := SaveStringToFile(Probe, 'chainremote write probe', False);
    if Ok then DeleteFile(Probe);
  end;
  if Ok then begin
    CRLog('installer: write-probe OK (' + Dir + ') ' + Diag);
    Exit;
  end;
  if WizardSilent() then begin
    // 자동 업데이트 경로(이미 설치돼 쓰기 가능한 기기)는 기존대로 진행 — 무영향.
    CRLog('installer: write-probe FAILED (' + Dir + ') silent -> proceed; ' + Diag);
    Exit;
  end;
  CRLog('installer: write-probe FAILED (' + Dir + ') interactive -> abort; ' + Diag);
  Result :=
    '[ChainRemote 설치 불가 — 폴더에 쓸 수 없습니다]' + #13#10 + #13#10 +
    Dir + ' 에 파일을 쓸 수 없습니다 (액세스 거부).' + #13#10 +
    '아래 순서로 확인해 주세요:' + #13#10 + #13#10 +
    '1) 설치 파일 우클릭 → "관리자 권한으로 실행" 으로 다시 시도.' + #13#10 + #13#10 +
    '2) ' + Dir + ' 우클릭 → 속성 → [보안] 탭 →' + #13#10 +
    '   Administrators 에 "쓰기"가 허용인지 (거부면 그게 원인).' + #13#10 + #13#10 +
    '3) 백신/보안 SW 실시간 차단이면 일시 해제 후 재시도.' + #13#10 + #13#10 +
    '진단 정보: ' + Diag + #13#10 +
    '(로그: C:\ProgramData\ChainRemote\updater.log)';
end;
