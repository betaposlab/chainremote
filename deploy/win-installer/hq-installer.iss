; 본사 빌드용 인스톨러 (Inno Setup)
; 빌드: 윈컴에서 ISCC.exe hq-installer.iss
; 결과물: ChainRemote_HQ_Setup_v{version}.exe
;
; Phase 1 분기: 본사 빌드 = conn-type=outgoing (custom-hq.txt → {app}\custom.txt).
; Flutter Windows 산출물은 agent-installer.iss 와 같은 빌드를 공유한다.
; agent 와 다른 점: 박히는 custom.txt 가 outgoing, 영구 비번 toml 제외(본사 PC 는 피지원자 아님),
; watchdog 예약작업 제외(재성이 PC 는 interactive 사용자라 자가치유 불필요).
;
; 사용처: 재성이 윈도우 본사 PC (jaesung 계정 로그인).

#define APP_NAME       "ChainRemote"
#define APP_VERSION    "1.4.113"
#define APP_PUBLISHER  "BetaposLab"
#define APP_URL        "https://betaposlab.com"
; 윈컴에서 빌드한 ChainRemote.exe 가 들어있는 폴더 (agent 와 공유)
#define BUILD_DIR      "C:\src\ChainRemote\flutter\build\windows\x64\runner\Release"

[Setup]
; AppId 는 agent 와 다르게 둔다. 같은 PC 에 둘 다 못 깔리게 하려면 AppId 를 공유하는 게 나으나,
; HQ 와 agent 는 서로 다른 PC 에서만 도므로 별도 AppId 가 안전하다.
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
; 설치 마법사 첫 단계 = 서비스 이용약관 동의 페이지 (좌석/오남용 책임 + AGPL 고지. 파일은 UTF-8 BOM 필수 — 없으면 CP949 로 읽혀 한글이 깨진다).
; 자동 업데이트(/VERYSILENT)는 이 페이지를 안 띄운다.
LicenseFile=license-hq-ko.txt
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

; 2026-06-05: custom.txt 를 exe 옆(payload)에도 강제 배치 — install_me(--silent-install)가 바로 이 시점에
;    custom.txt 의 option-b-plus 마커를 읽어 서비스 생성 여부를 정한다(get_create_service). {#BUILD_DIR} 의
;    옛 stale custom.txt 를 덮어써 보장. (설치 후 {app} 복사는 아래 1.5 단계 그대로 유지.)
Source: "..\custom-hq.txt"; DestDir: "{tmp}\chainremote_payload"; DestName: "custom.txt"; Flags: deleteafterinstall ignoreversion

; 옵션 B+ (2026-05-21): HQ 도 영구비번 toml 을 박는다. 사용자가 "외부 원격 접속 허용"
; 토글만 ON 하면 별도 비번 설정 없이 즉시 무인 incoming 이 된다 (Chang→재성이 컴 시나리오).
; 토글 OFF 면 hbbs 등록 자체를 안 하므로 영구비번이 박혀있어도 외부에서 ID 를 못 찾는다.
; DestName 으로 ChainRemote*.toml 로 rename — APP_NAME=ChainRemote 라 앱은 Config=ChainRemote.toml /
;   Config2=ChainRemote2.toml / UserDefault=ChainRemote_default.toml 만 읽는다 (config.rs file_(suffix)).
;   종전엔 RustDesk*.toml 을 그대로 배치해 앱이 못 읽었고 rendezvous/relay/key 가 빌드 baked 기본값에만
;   의존했다(무증상 결함). agent-installer.iss 와 동일하게 교정. toml 값이 baked 기본값과 같아 동작은 불변.
Source: "RustDesk.toml";         DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote.toml";         Flags: deleteafterinstall ignoreversion
Source: "RustDesk2.toml";        DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote2.toml";        Flags: deleteafterinstall ignoreversion
Source: "RustDesk_default.toml"; DestDir: "{tmp}\chainremote_config"; DestName: "ChainRemote_default.toml"; Flags: deleteafterinstall ignoreversion

Source: "chainremote.ico"; DestDir: "{app}"; Flags: ignoreversion

; Phase 1 — 본사 분기 플래그. silent-install([Run]1번)이 {app} 폴더를 클린업하므로
; 임시 폴더에 박아두고 [Run]에서 silent-install 후 {app}\custom.txt 로 복사한다.
; ordering 버그 픽스 (2026-05-21): 옛 [Files] 처럼 {app} 에 바로 박으면 silent-install 이
; 덮어써 custom.txt 가 사라졌다. 본사 custom 파일은 win-installer 밖(deploy/)에 있다.
Source: "..\custom-hq.txt"; DestDir: "{tmp}\custom_payload"; DestName: "custom.txt"; Flags: deleteafterinstall ignoreversion

; 서버 주소 이관기 — 에이전트와 같은 스크립트를 공유한다. 아래 3번 배치 단계는 파일이
;   이미 있으면 통째로 건너뛰므로(설정 보존 가드) 주소만 따로 갈아끼워야 한다.
;   (ASCII 전용 — PS 는 BOM 없는 .ps1 을 시스템 ANSI 로 읽어 한글이 들어가면 파서가 깨진다.)
Source: "migrate-server-address.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall ignoreversion

; 재접속 grace — 에이전트와 같은 스크립트를 공유한다. HQ 도 옵션 B+ 토글을 켜면 원격 대상이
;   되므로(사무실 Mac → 집 윈컴) 업데이트 설치로 끊긴 세션에 같은 구제가 필요하다.
;   (ASCII 전용 — 위와 같은 이유.)
Source: "set-update-grace.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall ignoreversion

[Run]
; 0. Windows ephemeral port range 확장 (2026-05-25 사업화 안전망).
;    HQ 인스톨러도 같은 이유로 적용 — Chang/재성이 PC 에 다른 SW(코이노 등)가 깔려있을 때
;    그쪽 SW 의 누수 영향에서 ChainRemote 를 보호. 자세히는 agent-installer.iss 참조.
Filename: "netsh.exe"; Parameters: "int ipv4 set dynamicport tcp start=10000 num=55000"; StatusMsg: "Windows ephemeral port 확장 적용..."; Flags: runhidden waituntilterminated
Filename: "netsh.exe"; Parameters: "int ipv6 set dynamicport tcp start=10000 num=55000"; Flags: runhidden waituntilterminated

; 0.4. 원격 세션이 붙어 있으면 재접속 grace 를 깐다 — 반드시 0.5(프로세스 종료) '前'.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\set-update-grace.ps1"" -GraceFile ""{commonappdata}\ChainRemote\restart-grace"" -Log ""{commonappdata}\ChainRemote\updater.log"""; StatusMsg: "ChainRemote 재접속 준비 중..."; Flags: runhidden waituntilterminated

; 0.5. silent-install 직전 옛 ChainRemote.exe 강제 종료 (v1.3.6 신규, 2026-05-29).
;     v1.3.4 → v1.3.5 마이그레이션 후 남던 트레이 아이콘 2개 잔재 해소. 자세히는 agent-installer.iss.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; taskkill /F /IM ChainRemote.exe /T *>$null; Start-Sleep -Seconds 2"""; StatusMsg: "옛 ChainRemote 프로세스 정리 중..."; Flags: runhidden waituntilterminated

; (Phase 3-Win v2 2026-05-25): 옛 'sc delete RustDesk' + 'taskkill rustdesk.exe' 단계는 제거했다.
;     Microsoft Defender 오탐(Trojan:Win32/Bearfoos.B!ml) 트리거 회피. 같은 정리 동작은
;     src/chainremote_migrate.rs 가 첫 실행 때 처리한다. agent 와 동일.

; 1. ChainRemote 코어 사일런트 설치 — install_me() 가 C:\Program Files\ChainRemote\ 로 모든 파일 복사
;    + ChainRemote Service 등록. HQ 는 outgoing-only 라 서비스가 incoming 을 받을 일은 없지만,
;    install_me 의 기본 흐름을 그대로 둔다 (옵션 B+ 토글 ON 시엔 incoming 도 가능).
Filename: "{tmp}\chainremote_payload\ChainRemote.exe"; Parameters: "--silent-install"; StatusMsg: "ChainRemote 코어 설치 중..."; Flags: runhidden waituntilterminated

; 1.5. custom.txt 박기 (silent-install 후) — Phase 3-Win 절대 경로 강제 (2026-05-26 fix).
;    agent-installer.iss 와 같은 이유: install_me() 가 {commonpf}\ChainRemote\ 에 설치하므로
;    custom.txt 도 같은 위치에 있어야 load_custom_client() 가 인식한다. {app} 은 옛 AppId 잔재로
;    옛 RustDesk 폴더를 가리킬 수 있다.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$dst='{commonpf}\ChainRemote'; New-Item -Path $dst -ItemType Directory -Force *>$null; Copy-Item '{tmp}\custom_payload\custom.txt' (Join-Path $dst 'custom.txt') -Force"""; StatusMsg: "ChainRemote 분기 설정 적용 중..."; Flags: runhidden waituntilterminated

; 2. 서비스/UI 강제 정지 — toml 박기 전 file lock 해제
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Stop-Service ChainRemote -Force -ErrorAction SilentlyContinue }} catch {{}}; for ($i=0; $i -lt 30; $i++) {{ $svc = Get-Service ChainRemote -ErrorAction SilentlyContinue; if ($null -eq $svc -or $svc.Status -eq 'Stopped') {{ break }}; Start-Sleep -Seconds 1 }}; taskkill /F /IM ChainRemote.exe /T *>$null; Start-Sleep -Seconds 1"""; StatusMsg: "ChainRemote 서비스 정지 중..."; Flags: runhidden waituntilterminated

; 3. toml 3종을 사용자/서비스 두 경로에 동시 배치 (rendezvous server 인식). Phase 3-Win 이후 경로는 ChainRemote.
;    보존 가드(M4) + 검증 대상 교정(H5): dst 에 ChainRemote2.toml 이 이미 있으면 안 박는다
;    (재설치/자동업뎃 때 머신 고유 id/key_pair=ChainRemote.toml 및 사용자 설정 보존 — agent 와 동일).
;    검증은 [System.IO.File]::ReadAllText(ChainRemote2.toml) 로 한다. 종전 Get-Content RustDesk2.toml 은
;    앱이 안 읽는 파일을 보던 거짓 PASS 였다.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{userappdata}\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ([System.IO.File]::ReadAllText(""$dst\ChainRemote2.toml"") -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$src='{tmp}\chainremote_config'; $dst='{win}\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\config'; New-Item -Path $dst -ItemType Directory -Force *>$null; if (Test-Path ""$dst\ChainRemote2.toml"") {{ Write-Host 'preserved' }} else {{ for ($i=0; $i -lt 5; $i++) {{ try {{ Copy-Item ""$src\*.toml"" $dst -Force -ErrorAction Stop; if ([System.IO.File]::ReadAllText(""$dst\ChainRemote2.toml"") -match 'custom-rendezvous-server') {{ break }} }} catch {{ Start-Sleep -Seconds 2 }} }} }}"""; StatusMsg: "ChainRemote 설정 적용 중 (서비스)..."; Flags: runhidden waituntilterminated

; 3.5 기존 설치본의 서버 주소 이관 — 신규 설치는 위에서 이미 새 주소가 박혀 nochange 로 끝난다.
;     실패해도 원본을 그대로 두고 넘어간다. 결과는 updater.log 에 남는다.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\migrate-server-address.ps1"" -Path ""{userappdata}\ChainRemote\config\ChainRemote2.toml"" -Rs rs.626.kr -Relay relay.626.kr -Log ""{commonappdata}\ChainRemote\updater.log"""; StatusMsg: "ChainRemote 서버 주소 확인 중 (사용자)..."; Flags: runhidden waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\migrate-server-address.ps1"" -Path ""{win}\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\config\ChainRemote2.toml"" -Rs rs.626.kr -Relay relay.626.kr -Log ""{commonappdata}\ChainRemote\updater.log"""; StatusMsg: "ChainRemote 서버 주소 확인 중 (서비스)..."; Flags: runhidden waituntilterminated

; 4. 서비스 재시작 (간단판 — HQ 는 watchdog 없으므로 1회 시도면 충분)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Start-Service ChainRemote -ErrorAction Stop }} catch {{ sc.exe start ChainRemote *>$null }}"""; StatusMsg: "ChainRemote 서비스 시작 중..."; Flags: runhidden waituntilterminated

; 5. 옛 RustDesk 단축아이콘 잔재 정리 (Phase 3-Win). install_me 가 APP_NAME=ChainRemote 를
;    따라 ChainRemote.lnk 를 자동 생성하므로 RENAME 은 불필요. 옛 잔재만 제거.
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%PUBLIC%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden
Filename: "{cmd}"; Parameters: "/c del /F /Q ""%USERPROFILE%\Desktop\RustDesk.lnk"" 2>nul"; Flags: runhidden

; 6. 옛 Start Menu RustDesk 폴더 정리.
Filename: "{cmd}"; Parameters: "/c rmdir /S /Q ""%PROGRAMDATA%\Microsoft\Windows\Start Menu\Programs\RustDesk"" 2>nul"; Flags: runhidden

; 7. RustDesk 자동시작 reg 제거 (우리 [Registry] 에서 ChainRemote 별도 등록)
Filename: "{cmd}"; Parameters: "/c reg delete ""HKLM\Software\Microsoft\Windows\CurrentVersion\Run"" /v RustDesk /f 2>nul"; Flags: runhidden

; 8. 단축아이콘 IconLocation 갱신
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""$wsh=New-Object -COM WScript.Shell; $ico='{commonappdata}\ChainRemote\chainremote.ico'; foreach($p in @('$env:PUBLIC\Desktop\ChainRemote.lnk','$env:USERPROFILE\Desktop\ChainRemote.lnk','$env:ProgramData\Microsoft\Windows\Start Menu\Programs\ChainRemote\ChainRemote.lnk')) {{ $expanded=[Environment]::ExpandEnvironmentVariables($p); if(Test-Path $expanded) {{ $s=$wsh.CreateShortcut($expanded); $s.IconLocation=$ico; $s.Save() }} }}"""; Flags: runhidden waituntilterminated

; 8.5. 인스톨 후 self-test 스모크 (v1.3.7 신규, 2026-05-29).
;     자세히는 agent-installer.iss 의 동일 단계 주석 참조.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Start-Sleep -Seconds 8; $log='C:\ProgramData\ChainRemote\updater.log'; $st=Get-Date -Format 'yyyy-MM-dd HH:mm:ss'; $svc=(Get-Service ChainRemote -EA SilentlyContinue).Status; $procs=(Get-Process ChainRemote -EA SilentlyContinue).Count; $exe='C:\Program Files\ChainRemote\ChainRemote.exe'; $exists=(Test-Path $exe); $verdict='FAIL'; if (($svc -eq 'Running') -and ($procs -ge 1) -and $exists) {{ $verdict='PASS' }; Add-Content -Path $log -Value ($st + ' installer: SELFTEST v{#APP_VERSION} svc=' + $svc + ' procs=' + $procs + ' exe=' + $exists + ' -> ' + $verdict)"""; StatusMsg: "ChainRemote 설치 self-test 중..."; Flags: runhidden waituntilterminated

; 9. 설치 직후 실행 (재성이 검증용) — 절대 경로 강제 (Phase 3-Win 사고 fix, 2026-05-25).
;    옛 RustDesk 설치본의 {app} mismatch 회피. agent-installer 와 같은 이유.
Filename: "{commonpf}\ChainRemote\ChainRemote.exe"; Description: "지금 ChainRemote 실행"; Flags: nowait postinstall skipifsilent

[Registry]
; 부팅 시 자동 시작 — HQ 도 재성이 편의상 유지 (트레이 아이콘으로 떠 있음).
; Phase 3-Win 이후 실행파일은 ChainRemote.exe.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "{#APP_NAME}"; \
  ValueData: """{app}\ChainRemote.exe"" --tray"; \
  Flags: uninsdeletevalue

[UninstallDelete]
; HQ 도 ProgramData 를 쓴다(로그·아이콘·재접속 grace). 제거 후 폴더가 남으면 "지웠는데
;   남아 있다"가 되는 건 에이전트와 똑같다. 자세한 근거는 agent-installer.iss 의 같은 섹션.
;   ★자동 업데이트는 여기 안 걸린다 — Inno 는 같은 AppId 위 설치를 업그레이드로 처리하고,
;   업그레이드에서는 이 섹션이 실행되지 않는다.
Type: files; Name: "{commonappdata}\ChainRemote\*.log"
Type: files; Name: "{commonappdata}\ChainRemote\*.ico"
Type: filesandordirs; Name: "{commonappdata}\ChainRemote\pending"
Type: files; Name: "{commonappdata}\ChainRemote\restart-grace"
Type: dirifempty; Name: "{commonappdata}\ChainRemote"

[Code]
// ── 다운그레이드 가드 (2026-06-06) ────────────────────────────────
// 설치된 버전이 이 인스톨러보다 높으면 설치 거부. updater(is_newer)는 자동업뎃 경로만
// 막지만, 인스톨러를 직접 실행하는 stray 경로(잔재 예약작업·수동 더블클릭 등)는 우회가 가능하다.
// 그 부류를 인스톨러 레벨에서 영구 차단. 의도적 롤백은 /FORCE=1 로만.
// updater 정상 푸시는 늘 상향이라 가드에 안 걸린다 → 정상 동작엔 영향 0.
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
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{C7E4D8B2-9F3A-4B5C-8D1E-6F2A3C5E9B7D}_is1', 'DisplayVersion', v) then Result := v
  else if RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{C7E4D8B2-9F3A-4B5C-8D1E-6F2A3C5E9B7D}_is1', 'DisplayVersion', v) then Result := v;
end;

function InitializeSetup(): Boolean;
var
  Installed: String;
begin
  Result := True;
  // HQ(본사앱)는 x64 전용 — 32비트 Windows 에선 코어 exe 가 못 돌고
  //   "CreateProcess 실패 코드 216(아키텍처 불일치)" 로 깨진다. 거래처 32비트 POS 에 실수로
  //   HQ 를 받는 경우를 대비해, 32비트면 명확히 안내하고 중단한다(거래처용은 Agent 설치).
  if not IsWin64() then begin
    MsgBox('ChainRemote 본사앱(HQ)은 64비트 Windows 전용입니다.' + #13#10 +
           '이 컴퓨터는 32비트라 설치할 수 없습니다.' + #13#10 + #13#10 +
           '원격 지원을 받는(제어되는) 컴퓨터에는 ''Agent'' 설치 파일(ChainRemote_Agent_Setup)을 설치하세요.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if ExpandConstant('{param:FORCE|0}') = '1' then Exit;
  Installed := CRInstalledVer();
  if (Installed <> '') and (CRCmpVer(Installed, '{#APP_VERSION}') > 0) then begin
    CRLog('installer: DOWNGRADE-GUARD blocked (installed=' + Installed + ' > setup={#APP_VERSION})');
    if not WizardSilent() then
      MsgBox('이미 더 높은 버전(' + Installed + ')이 설치되어 있어 설치를 중단합니다.' + #13#10 + '(강제 설치 시 /FORCE=1)', mbError, MB_OK);
    Result := False;
  end;
end;
