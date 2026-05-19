# ChainRemote 서비스 watchdog (강화판 2026-05-19)
# SYSTEM 권한 예약작업(ChainRemoteServiceWatchdog)이 10분마다 실행.
#
# 배경/근본원인 (코드로 규명, 2026-05-19):
#   RustDesk 트레이 "서비스 중지" 는 Config::set_option("stop-service","Y") 로
#   옵션을 **영구 저장**한다. 이 값이 Y 면 rendezvous_mediator 가 hbbs 에
#   연결하지 않으므로, Windows 서비스가 "Running" 이어도 원격 등록이 안 된다.
#   → 단순 Start-Service 만으론 복구 불가(과거 watchdog 의 갭). 거래처 무인
#     PC 에서 누가 "서비스 중지" 한 번 누르면 본사가 영영 못 붙는 사고.
#
# 이 강화판은 매 틱에:
#   1) 후보 config(RustDesk.toml/RustDesk2.toml, 서비스 LocalService 경로 +
#      사용자 프로필들)에서 영구 stop-service 라인을 제거. raw 텍스트 +
#      UTF-8 no-BOM 으로 기록(PS5.1 의 BOM 첨가로 toml 깨지는 것 회피).
#   2) 서비스 시작유형을 auto 로 보장(누가 disabled 로 바꿔도 무력화).
#   3) 서비스 미가동이면 시작. 가동 중인데 stop-service 를 방금 청소했다면
#      재시작(메모리 캐시된 옛 옵션 버리고 hbbs 재연결).
#   4) 조치한 경우에만 updater.log 에 한 줄 기록(정상 틱 무기록 — 스팸 방지).

$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\ProgramData\ChainRemote\updater.log'

function Log($msg) {
    $st = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $log -Value ($st + ' watchdog: ' + $msg)
}

# --- 1) 영구 stop-service 라인 제거 (후보 config 전부 방어적으로) ---
$cfgDirs = @(
    "$env:SystemRoot\ServiceProfiles\LocalService\AppData\Roaming\RustDesk\config",
    "$env:SystemRoot\ServiceProfiles\LocalSystem\AppData\Roaming\RustDesk\config"
)
Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $cfgDirs += (Join-Path $_.FullName 'AppData\Roaming\RustDesk\config')
}

$noBom = New-Object System.Text.UTF8Encoding($false)
$cleared = $false
foreach ($d in $cfgDirs) {
    foreach ($fn in @('RustDesk.toml', 'RustDesk2.toml')) {
        $p = Join-Path $d $fn
        if (Test-Path $p) {
            try {
                $orig = [System.IO.File]::ReadAllText($p)
                if ($orig -match '(?m)^[ \t]*stop-service[ \t]*=') {
                    # 해당 라인(및 그 줄바꿈)만 제거, 나머지는 바이트 보존
                    $new = [regex]::Replace($orig, '(?m)^[ \t]*stop-service[ \t]*=.*\r?\n?', '')
                    [System.IO.File]::WriteAllText($p, $new, $noBom)
                    $cleared = $true
                }
            } catch { }
        }
    }
}

# --- 2) 서비스 존재 확인. 트레이 "서비스 중지"(=uninstall_service)는 sc delete
#        까지 하므로 서비스가 아예 없을 수 있음 → install_service 와 동일하게 재생성.
#        (RustDesk get_create_service 의 검증된 명령 포맷 그대로 미러) ---
$svc = Get-Service RustDesk -ErrorAction SilentlyContinue
$recreated = $false
if ($null -eq $svc) {
    $exe = $null
    foreach ($cand in @("$env:ProgramFiles\RustDesk\rustdesk.exe",
                         "${env:ProgramFiles(x86)}\RustDesk\rustdesk.exe")) {
        if (Test-Path $cand) { $exe = $cand; break }
    }
    if ($null -eq $exe) { return }   # ChainRemote 미설치(파일 없음) — 관여 안 함
    $create = 'sc create RustDesk binpath= "\"' + $exe + '\" --service" start= auto DisplayName= "RustDesk Service"'
    & cmd.exe /c $create *> $null
    Start-Sleep -Seconds 2
    $svc = Get-Service RustDesk -ErrorAction SilentlyContinue
    if ($null -eq $svc) { Log '서비스 재생성 실패(sc create) -> STILL DOWN'; return }
    $recreated = $true
}

# --- 3) 시작유형 auto 보장 + 상태별 조치 ---
& sc.exe config RustDesk start= auto *> $null

$action = $null
if ($recreated) {
    $action = 'sc delete 된 서비스 재생성 + 시작'
    try { Start-Service RustDesk -ErrorAction Stop } catch { & sc.exe start RustDesk *> $null }
}
elseif ($svc.Status -ne 'Running') {
    $action = if ($cleared) { 'stop-service 해제 + 서비스 시작' } else { '서비스 시작' }
    try { Start-Service RustDesk -ErrorAction Stop } catch { & sc.exe start RustDesk *> $null }
}
elseif ($cleared) {
    $action = 'stop-service 해제 + 서비스 재시작(hbbs 재연결)'
    try { Restart-Service RustDesk -Force -ErrorAction Stop }
    catch { & sc.exe stop RustDesk *> $null; Start-Sleep -Seconds 3; & sc.exe start RustDesk *> $null }
}
else {
    return   # 정상(가동 중, 청소할 것 없음) — 무기록
}

# --- 4) 결과 검증 + 기록 ---
Start-Sleep -Seconds 6
$s2 = Get-Service RustDesk -ErrorAction SilentlyContinue
$res = if ($null -ne $s2 -and $s2.Status -eq 'Running') { 'OK(Running)' } else { 'STILL DOWN' }
Log ("$action -> $res")
