# ChainRemote 서비스 watchdog (v1.3.x 브랜딩 마이그레이션 2026-05-27)
# SYSTEM 권한 예약작업(ChainRemoteServiceWatchdog)이 10분마다 실행.
#
# 배경 (Phase 3-Win 이후 변화):
#   v1.2.19 부터 트레이 "서비스 중지" 메뉴가 영구 숨김 처리되어, 영구
#   stop-service 토글로 인한 hbbs 미등록 사고는 더 이상 발생하지 않는다.
#   따라서 옛 강화판의 stop-service 청소 로직(RustDesk.toml 후보 폴더 탐색)은
#   v1.3.x 에서 사실상 불필요. 안전망 차원에서 매우 가볍게 ChainRemote.toml
#   하나만 청소.
#
#   대신 v1.3.x 에서도 보존이 가치 있는 안전망:
#     (a) 서비스가 어쩌다 죽은 채 방치되는 케이스 (Windows sc failure 미설정).
#     (b) 누가 sc delete ChainRemote 로 서비스 자체를 날린 케이스 → 재생성.
#     (c) heartbeat cold-boot race (첫 부팅 직후 is_incoming_only=false 로
#         heartbeat 스레드가 skip 된 상태) — 서비스 가동 중이라도 한 번
#         Restart-Service 해주면 다음 부팅 전이라도 회복. 단, 정상 가동 중인
#         서비스를 매 틱 재시작하면 원격 끊김 사고 위험 → 이 워치독은
#         "재시작" 은 하지 않는다. cold-boot race 회복은 인스톨러 [Run]
#         단계의 Restart-Service 1회 + 다음 재부팅에 위임.
#
# 매 틱 동작:
#   1) (가벼운 정리) ChainRemote.toml 에 stop-service=Y 라인이 있으면 제거.
#      (v1.3.x 에선 트레이 메뉴가 막혔으므로 실질적으로 거의 trigger 안 됨.)
#   2) 서비스 시작유형이 auto 인지 확인하고 아니면 auto 로 설정.
#   3) 서비스가 없으면(sc delete 당했으면) 재생성 + 시작.
#   4) 서비스가 Stopped 면 시작.
#   5) 정상(가동 중)이면 무기록 종료 — 로그 스팸 방지.

$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\ProgramData\ChainRemote\updater.log'

function Log($msg) {
    $st = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $log -Value ($st + ' watchdog: ' + $msg)
}

# --- 1) (가벼운 정리) ChainRemote.toml 의 영구 stop-service 라인 제거 ---
$cfgDirs = @(
    "$env:SystemRoot\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\config",
    "$env:SystemRoot\System32\config\systemprofile\AppData\Roaming\ChainRemote\config"
)
Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $cfgDirs += (Join-Path $_.FullName 'AppData\Roaming\ChainRemote\config')
}

$noBom = New-Object System.Text.UTF8Encoding($false)
$cleared = $false
foreach ($d in $cfgDirs) {
    foreach ($fn in @('ChainRemote.toml', 'ChainRemote2.toml')) {
        $p = Join-Path $d $fn
        if (Test-Path $p) {
            try {
                $orig = [System.IO.File]::ReadAllText($p)
                if ($orig -match '(?m)^[ \t]*stop-service[ \t]*=') {
                    $new = [regex]::Replace($orig, '(?m)^[ \t]*stop-service[ \t]*=.*\r?\n?', '')
                    [System.IO.File]::WriteAllText($p, $new, $noBom)
                    $cleared = $true
                }
            } catch { }
        }
    }
}

# --- 2) 서비스 존재 확인. 없으면 재생성 (sc delete 당한 케이스 복구) ---
$svc = Get-Service ChainRemote -ErrorAction SilentlyContinue
$recreated = $false
if ($null -eq $svc) {
    $exe = $null
    foreach ($cand in @("$env:ProgramFiles\ChainRemote\ChainRemote.exe",
                         "${env:ProgramFiles(x86)}\ChainRemote\ChainRemote.exe")) {
        if (Test-Path $cand) { $exe = $cand; break }
    }
    if ($null -eq $exe) { return }   # ChainRemote 미설치(파일 없음) — 관여 안 함
    $create = 'sc create ChainRemote binpath= "\"' + $exe + '\" --service" start= auto DisplayName= "ChainRemote Service"'
    & cmd.exe /c $create *> $null
    Start-Sleep -Seconds 2
    $svc = Get-Service ChainRemote -ErrorAction SilentlyContinue
    if ($null -eq $svc) { Log '서비스 재생성 실패(sc create) -> STILL DOWN'; return }
    $recreated = $true
}

# --- 3) 시작유형 auto 보장 + 상태별 조치 ---
& sc.exe config ChainRemote start= auto *> $null

$action = $null
if ($recreated) {
    $action = 'sc delete 된 서비스 재생성 + 시작'
    try { Start-Service ChainRemote -ErrorAction Stop } catch { & sc.exe start ChainRemote *> $null }
}
elseif ($svc.Status -ne 'Running') {
    $action = if ($cleared) { 'stop-service 해제 + 서비스 시작' } else { '서비스 시작' }
    try { Start-Service ChainRemote -ErrorAction Stop } catch { & sc.exe start ChainRemote *> $null }
}
else {
    # 정상 가동 중. cleared 케이스라도 가동 중인 서비스 재시작은 원격세션 끊김 위험 → 무기록 종료.
    return
}

# --- 4) 결과 검증 + 기록 ---
Start-Sleep -Seconds 6
$s2 = Get-Service ChainRemote -ErrorAction SilentlyContinue
$res = if ($null -ne $s2 -and $s2.Status -eq 'Running') { 'OK(Running)' } else { 'STILL DOWN' }
Log ("$action -> $res")
