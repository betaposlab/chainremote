; ChainRemote 거래처 배포용 ★통합★ 인스톨러 (Inno Setup) — x64 + 32비트 자동 판별
; 빌드: 윈컴에서 ISCC.exe agent-installer.iss  (사전: build-all.ps1 → x64 / build-agent32.ps1 → x86 페이로드)
; 결과물: ChainRemote_Agent_Setup_v{version}.exe  (파일명 규약 유지 — 패널 푸시/release 파이프라인 무변경)
;
; ★ 통합 동작 (2026-06-10, Chang 결정):
;   Inno 의 셋업 본체(stub)는 원래 32비트 → Win7 SP1 32비트부터 Win11 x64 까지 어디서든 실행됨.
;   두 페이로드를 모두 담고, 설치 시 OS 아키텍처에 맞는 쪽만 풀어서 설치:
;     - 64비트 OS (Is64BitInstallMode)  → Flutter x64 빌드 (기존 거래처 빌드 그대로)
;     - 32비트 OS                        → Sciter i686 빌드 (ChainRemote.exe + sciter.dll + custom.txt)
;   → 패널/업데이트 채널이 arch 구분할 필요 자체가 소멸 (한 파일을 아무 거래처에나 푸시 OK).
;
; Phase 1 분기: 거래처 빌드 = conn-type=incoming (..\custom-agent.txt → custom.txt, click-only override 포함).
; 본사 빌드는 hq-installer.iss (x64 전용) 가 별도.
;
; 설치 순서 (두 아키텍처 동일):
;   1. 페이로드를 {tmp}\chainremote_payload 에 풀고 ChainRemote.exe --silent-install 실행
;      → install_me() 가 페이로드 폴더 전체(XCOPY /E — 32비트는 sciter.dll/custom.txt 동반)를
;        Program Files\ChainRemote 로 복사 + ChainRemote Service 등록 + 단축아이콘 생성
;   2. NAS 설정 toml 을 user + LocalService 두 경로에 배치 (보존 가드 포함)
;   3. 서비스 기동 + watchdog 예약작업 + 잔재 정리 + self-test
;
; ⚠ PowerShell 단계는 전부 PS 2.0 호환 문법 (Win7 기본 PS2: *>$null / -Raw / -Directory 금지).
;   PS5 에서도 동일 동작 — x64 경로도 이 문법으로 통일됨 (2026-06-10).

#define APP_NAME       "ChainRemote"
#define APP_VERSION    "1.4.22"
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
; 파일명에 버전 박기 — 옛/새 빌드 혼동 방지 + NAS URL 캐시 무관
OutputBaseFilename=ChainRemote_Agent_Setup_v{#APP_VERSION}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; 설치 마법사 첫 단계 = 사용 동의 페이지 (원격 수신 동의 + AGPL 고지. 파일은 UTF-8 BOM 필수 — 없으면 CP949 로 읽혀 한글 깨짐).
; 자동 업데이트(/VERYSILENT)는 이 페이지를 표시하지 않음 → 기존 푸시/업데이트 플로우 무영향.
LicenseFile=license-agent-ko.txt
PrivilegesRequired=admin
; 64비트 OS 에선 64비트 설치 모드 ({commonpf}=C:\Program Files), 32비트 OS 에선 자동으로 32비트 모드.
; 어느 쪽이든 {commonpf}\ChainRemote = install_me() 의 %ProgramFiles% 계산과 일치.
ArchitecturesInstallIn64BitMode=x64compatible
; Win7 SP1 이상 (XP/Vista 차단 — 32비트 페이로드의 최저선과 일치)
MinVersion=6.1sp1
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
Source: "{#BUILD_DIR_X64}\*"; DestDir: "{tmp}\chainremote_payload"; Check: Is64BitInstallMode; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs
Source: "{#BUILD_DIR_X86}\*"; DestDir: "{tmp}\chainremote_payload"; Check: not Is64BitInstallMode; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs

; 우리 toml — [Run] 단계에서 두 경로(user + LocalService)에 동시 배치
;   - RustDesk2-agent.toml   : Config2 (서버 + 옵션) — agent 전용 (approve-mode=click,
;                              영구비번 미사용). APP_NAME=ChainRemote 라 ChainRemote2.toml 이름으로 배치.
;   - RustDesk_default.toml  : UserDefaultConfig — 디스플레이/원격커서/음소거 등 기본값
Source: "RustDesk2-agent.toml";  DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote2.toml"; Flags: deleteafterinstall ignoreversion
Source: "RustDesk_default.toml"; DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote_default.toml"; Flags: deleteafterinstall ignoreversion

; Phase 1 분기 플래그 — ★단일 원천 = 루트 deploy/custom-agent.txt (override-settings approve-mode=click 포함).
; silent-install 이 {app} 을 클린업하므로 임시 폴더에 두고 [Run] 1.5 에서 절대 경로로 박음.
; (32비트 페이로드엔 build-agent32.ps1 이 같은 파일을 동봉 — XCOPY 로도 들어감. 이중 안전벨트.)
Source: "..\custom-agent.txt"; DestDir: "{tmp}\custom_payload"; DestName: "custom.txt"; Flags: deleteafterinstall ignoreversion

; ChainRemote 단축아이콘에 쓸 .ico (Program Files 안에 영구 보관)
Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

; 서비스 watchdog (PS2-safe — Win7/Win10 공용). 공백 없는 ProgramData 경로 = schtasks /TR 중첩인용 회피.
Source: "watchdog.ps1"; DestDir: "{commonappdata}\ChainRemote"; Flags: ignoreversion

[Run]
; 0. ★ Windows ephemeral port range 확장 (사업화 안전망 — 다른 원격 SW 의 socket 누수에 피해 안 봄)
Filename: "netsh.exe"; Parameters: "int ipv4 set dynamicport tcp start=10000 num=55000"; StatusMsg: "Windows ephemeral port 확장 적용..."; Flags: runhidden waituntilterminated
Filename: "netsh.exe"; Parameters: "int ipv6 set dynamicport tcp start=10000 num=55000"; Flags: runhidden waituntilterminated

; 0.5. ★ silent-install 직전 옛 ChainRemote 강제 종료 (옛 file 잠금 해제 + 옛/새 프로세스 공존 방지)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; taskkill /F /IM ChainRemote.exe /T >$null 2>&1; Start-Sleep -Seconds 2"""; StatusMsg: "옛 ChainRemote 프로세스 정리 중..."; Flags: runhidden waituntilterminated

; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 페이로드 폴더 전체를 Program Files 로 복사
;    + ChainRemote Service 등록 + 서비스 시작 + ChainRemote.lnk 단축아이콘 자동 생성.
;    (x64 = Flutter 빌드 / x86 = Sciter 빌드 — 같은 코어라 동작 동일)
Filename: "{tmp}\chainremote_payload\ChainRemote.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 1.5. ★ custom.txt 절대 경로 박기 (silent-install 후) — load_custom_client() 는 설치된 exe 옆만 읽음.
;    옛 Inno AppId 잔재로 {app} 이 다른 폴더를 가리켜도 안전하도록 절대 경로 강제 (2026-05-26 fix).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$dst='{commonpf}\ChainRemote'; New-Item -Path $dst -ItemType Directory -Force | Out-Null; Copy-Item '{tmp}\custom_payload\custom.txt' (Join-Path $dst 'custom.txt') -Force"""; StatusMsg: "ChainRemote 분기 설정 적용 중..."; Flags: runhidden waituntilterminated

; 2. ★ 서비스 + 잔여 프로세스 강제 정지 — toml 박기 전 필수 (file lock 해제).
;    .NET Status enum 비교 = 한국어 Windows "중지됨" 문자열 미스매치 회피.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; for ($i=0; $i -lt 30; $i++) {{ $svc = Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($null -eq $svc -or $svc.Status -eq 'Stopped') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM ChainRemote.exe /T >$null 2>&1; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. ★ toml 을 두 경로에 동시 배치 (LICENSE_MISMATCH 근본 해결) + 자동업데이트 보존 가드
;    (dst 에 ChainRemote2.toml 이미 있으면 안 박음 — 거래처 자체 설정 보존. 신규 설치만 박힘.)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force | Out-Null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ([System.IO.File]::ReadAllText(""$dst\ChainRemote2.toml"") -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{sys}\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force | Out-Null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ([System.IO.File]::ReadAllText(""$dst\ChainRemote2.toml"") -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. ★ 서비스 재시작 — Running 도달 폴링 + 3회 재시도 + updater.log 기록 (죽으면 진단 단서 남김)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$log='C:\ProgramData\ChainRemote\updater.log'; New-Item -Path (Split-Path $log) -ItemType Directory -Force | Out-Null; $ok=$false; for ($a=0; $a -lt 3; $a++) {{ try {{ Start-Service ChainRemote -ErrorAction Stop }} catch {{ sc.exe start ChainRemote >$null 2>&1 }}; for ($i=0; $i -lt 30; $i++) {{ $svc=Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($svc -ne $null -and $svc.Status -eq 'Running') {{ $ok=$true; break }}; Start-Sleep -Seconds 1 }}; if ($ok) {{ break }} }}; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $res= if ($ok) {{ 'Running OK' }} else {{ 'FAILED to reach Running after 3x30s' }}; Add-Content -Path $log -Value ($st + ' installer: sc start ChainRemote -> ' + $res)"""; StatusMsg: "ChainRemote 서비스 시작 중..."; Flags: runhidden waituntilterminated

; 4b. ★ 서비스 watchdog 예약작업 — 죽은 서비스를 재부팅 없이 복구 (10분 주기 SYSTEM)
Filename: "schtasks.exe"; Parameters: "/Create /TN ChainRemoteServiceWatchdog /TR ""powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\ChainRemote\watchdog.ps1"" /SC MINUTE /MO 10 /RU SYSTEM /RL HIGHEST /F"; StatusMsg: "ChainRemote 자동복구 등록 중..."; Flags: runhidden waituntilterminated
Filename: "schtasks.exe"; Parameters: "/Run /TN ChainRemoteServiceWatchdog"; Flags: runhidden waituntilterminated

; 5~7. 옛 RustDesk 잔재 정리 (마이그레이션 보조 — chainremote_migrate.rs 와 안전 중첩)
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%PUBLIC%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%USERPROFILE%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 8. 단축아이콘 IconLocation 을 ChainRemote .ico 로 갱신
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{app}\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 8.5. ★ 인스톨 후 self-test 스모크 — Service/Process/Exe 3종 체크를 updater.log 에 PASS/FAIL 기록
;     (절대 경로 하드코딩 대신 {commonpf} — 32/64비트 설치 모드 모두 정확)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Start-Sleep -Seconds 8; $log='C:\ProgramData\ChainRemote\updater.log'; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $svcobj=Get-Service ChainRemote -ErrorAction SilentlyContinue; $svc='None'; if ($svcobj) {{ $svc=[string]$svcobj.Status }}; $procs=@(Get-Process ChainRemote -ErrorAction SilentlyContinue).Count; $exe='{commonpf}\ChainRemote\ChainRemote.exe'; $exists=Test-Path $exe; $verdict='FAIL'; if (($svc -eq 'Running') -and ($procs -ge 1) -and $exists) {{ $verdict='PASS' }}; Add-Content -Path $log -Value ($st + ' installer: SELFTEST v{#APP_VERSION} svc=' + $svc + ' procs=' + $procs + ' exe=' + $exists + ' -> ' + $verdict)"""; StatusMsg: "ChainRemote 설치 self-test 중..."; Flags: runhidden waituntilterminated

; 8.6. ★ 설치 환경(Win7 변종) 기록 — "모든 윈도우 버전 대비"의 눈. Win7 은 RTM/SP1/POSReady/
;     Embedded + 에디션 + x86/x64 로 제각각이라 거래처별 실제 변종을 모르면 대응 불가.
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

[Code]
// ── ChainRemote 다운그레이드 가드 (2026-06-06) ────────────────────────────────
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

function InitializeSetup(): Boolean;
var
  Installed, Dir, WriteStr, Diag, Probe: String;
  V: TWindowsVersion;
  WriteOk: Boolean;
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
  // ★ 임시 시작 진단 팝업 (2026-06-15, 향우정 설치실패 원인규명용 — 정상설치 확인되면 제거).
  //   설치 맨 처음(권한 승격 직후)에 환경+Program Files 쓰기시험을 팝업으로 보여주고 확인을 받음.
  //   대화형(수동 설치)만 — 자동업데이트(/VERYSILENT)엔 절대 안 뜸 (안 그러면 기존 거래처 자동업뎃이
  //   확인 대기로 멈춤). 향우정 정상설치 확인되면 이 블록만 제거하면 됨.
  if not WizardSilent() then begin
    GetWindowsVersionEx(V);
    Diag := 'os=' + IntToStr(V.Major) + '.' + IntToStr(V.Minor) + ' sp=' + IntToStr(V.ServicePackMajor);
    if Is64BitInstallMode() then Diag := Diag + ' mode=x64' else Diag := Diag + ' mode=x86';
    if IsAdminInstallMode() then Diag := Diag + ' admin=yes' else Diag := Diag + ' admin=no';
    Dir := ExpandConstant('{app}');
    WriteOk := True;
    if not DirExists(Dir) then WriteOk := ForceDirectories(Dir);
    if WriteOk then begin
      Probe := Dir + '\.cr_writetest.tmp';
      WriteOk := SaveStringToFile(Probe, 'probe', False);
      if WriteOk then DeleteFile(Probe);
    end;
    if WriteOk then WriteStr := 'OK (정상 — 설치 진행됩니다)'
    else WriteStr := '실패! 액세스 거부 (이게 설치 안 되는 원인)';
    CRLog('installer: STARTUP-DIAG ' + Diag + ' writetest=' + WriteStr);
    MsgBox('[ChainRemote 설치 진단]' + #13#10 + #13#10 +
           '환경: ' + Diag + #13#10 +
           'Program Files 쓰기 시험: ' + WriteStr + #13#10 + #13#10 +
           '※ 이 창을 사진 찍어 두세요 (특히 "쓰기 시험: 실패" 면 꼭).' + #13#10 +
           '[확인] 을 누르면 설치를 계속합니다.', mbInformation, MB_OK);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then begin
    // 옛 Agent32 단독 인스톨러(2026-06-10, 테스트 POS 1대에만 배포됨) 의 제어판 중복 항목 정리.
    // 같은 경로/서비스에 덮어 설치되므로 uninstall 레지스트리 키만 제거하면 됨.
    RegDeleteKeyIncludingSubkeys(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{7C4D9A2E-5B31-4F8C-B2D6-1E9F3A6C8D52}_is1');
    RegDeleteKeyIncludingSubkeys(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{7C4D9A2E-5B31-4F8C-B2D6-1E9F3A6C8D52}_is1');
  end;
end;

// ── 설치 전 쓰기 보호 자가진단 (2026-06-15) ──────────────────────────────────
// {app}(=Program Files\ChainRemote)에 실제 파일 쓰기를 미리 시도한다. 쓰기 보호
//   (쓰기 필터 UWF/FBWF/EWF · 폴더 Deny 권한 · 백신 실시간 차단)면 설치 중간(install_me
//   복사 단계)에 뜨던 암호 같은 'CreateFile 실패 코드5' / '디렉터리 생성 액세스 거부'
//   대신, 여기서 원인+처방을 한글로 보여주고 깔끔히 중단한다. (향우정 Win7 32bit 사고 가시화.)
// 자동 업데이트(/VERYSILENT, 이미 설치돼 쓰기 가능한 기기)는 중단하지 않음 — 기존 플로우 무영향.
function CRDiag(): String;
var
  V: TWindowsVersion;
  S: String;
begin
  // 실패해도(=[Files] 전) updater.log/메시지에 남길 환경 한 줄. 향우정류 진단의 핵심 데이터.
  GetWindowsVersionEx(V);
  S := 'os=' + IntToStr(V.Major) + '.' + IntToStr(V.Minor) + ' sp=' + IntToStr(V.ServicePackMajor);
  if Is64BitInstallMode() then S := S + ' mode=x64' else S := S + ' mode=x86';
  // ★ 핵심: 이 설치가 실제로 관리자 권한으로 승격됐는지. no 면 "권한 승격 실패"가 범인.
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
    // 자동 업데이트 경로(이미 설치/쓰기가능 기기)는 기존대로 진행 — 무영향.
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
