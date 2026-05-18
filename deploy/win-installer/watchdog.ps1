# ChainRemote 서비스 watchdog
# SYSTEM 권한 예약작업(ChainRemoteServiceWatchdog)이 10분마다 실행.
# RustDesk 서비스가 Running 이 아니면 되살린다. install_me 가 서비스를 start=auto 로
# 만들지만, 인스톨 중 강제정지 후 sc start 실패 + 재부팅 안 함(절전만) 이면 서비스가
# 영영 죽은 채 방치된다(2026-05-18 현장 증상). 이 작업이 그 갭을 메운다.
# 조치한 경우에만 updater.log 에 한 줄 남긴다(정상일 땐 무기록 — 로그 스팸 방지).

$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\ProgramData\ChainRemote\updater.log'

$svc = Get-Service RustDesk -ErrorAction SilentlyContinue
if ($null -eq $svc) { return }            # 서비스 미설치 — 관여 안 함
if ($svc.Status -eq 'Running') { return } # 정상 — 조용히 종료

try { Start-Service RustDesk -ErrorAction Stop } catch { & sc.exe start RustDesk *> $null }
Start-Sleep -Seconds 5

$s2 = Get-Service RustDesk -ErrorAction SilentlyContinue
$st = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$res = if ($null -ne $s2 -and $s2.Status -eq 'Running') { 'recovered' } else { 'STILL DOWN' }
Add-Content -Path $log -Value ($st + ' watchdog: service not running -> ' + $res)
