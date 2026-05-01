$ErrorActionPreference = "Stop"
Write-Host "=== ChainRemote 윈컴 무인접속 자동 셋업 ===" -ForegroundColor Cyan

# 1. 실행 중인 ChainRemote/RustDesk 모두 종료
Write-Host "[1/6] 기존 프로세스 종료..." -ForegroundColor Yellow
Get-Process -Name "ChainRemote","RustDesk" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# 2. ChainRemote.exe 또는 RustDesk.exe 위치 찾기
Write-Host "[2/6] 실행 파일 검색..." -ForegroundColor Yellow
$exePaths = @(
  "$env:ProgramFiles\RustDesk\rustdesk.exe",
  "${env:ProgramFiles(x86)}\RustDesk\rustdesk.exe",
  "$env:ProgramFiles\ChainRemote\ChainRemote.exe",
  "${env:ProgramFiles(x86)}\ChainRemote\ChainRemote.exe",
  "$env:LOCALAPPDATA\RustDesk\rustdesk.exe",
  "$env:LOCALAPPDATA\ChainRemote\ChainRemote.exe",
  "$env:USERPROFILE\Desktop\ChainRemote.exe",
  "$env:USERPROFILE\Desktop\rustdesk.exe"
)
$exe = $null
foreach($p in $exePaths){ if(Test-Path $p){ $exe = $p; break } }
if(-not $exe){
  Write-Host "    기본 경로에 없음. C: 전체 검색..." -ForegroundColor Gray
  $found = Get-ChildItem -Path C:\ -Recurse -Include "rustdesk.exe","ChainRemote.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if($found){ $exe = $found.FullName }
}
if(-not $exe){
  Write-Host "❌ 실행 파일 못 찾음. ChainRemote/RustDesk 설치 후 다시 실행." -ForegroundColor Red
  exit 1
}
Write-Host "    실행 파일: $exe" -ForegroundColor Gray

# 3. 서버 설정 파일 다운로드
Write-Host "[3/6] 서버 설정 다운로드..." -ForegroundColor Yellow
$cfgDir = "$env:APPDATA\RustDesk\config"
if(-not (Test-Path $cfgDir)){ New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null }
$cfg = "$cfgDir\RustDesk2.toml"
if(Test-Path $cfg){ Copy-Item $cfg "$cfg.bak" -Force }
Invoke-WebRequest -Uri "http://192.168.68.108:8765/RustDesk2.toml" -OutFile $cfg -UseBasicParsing
Write-Host "    저장: $cfg" -ForegroundColor Gray

# 4. 고정 비밀번호 설정 (--password 옵션)
Write-Host "[4/6] 고정 비밀번호 설정 (chain1234)..." -ForegroundColor Yellow
try {
  & $exe --password "chain1234" 2>&1 | Out-Null
  Start-Sleep 2
  Write-Host "    OK" -ForegroundColor Gray
} catch {
  Write-Host "    경고: --password 옵션 미지원일 수 있음. UI에서 수동 설정 필요." -ForegroundColor Yellow
}

# 5. 부팅 시 자동 시작 (레지스트리 Run 키)
Write-Host "[5/6] 부팅 시 자동 시작 등록..." -ForegroundColor Yellow
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
Set-ItemProperty -Path $runKey -Name "ChainRemote" -Value "`"$exe`" --tray" -Force
Write-Host "    OK ($runKey\ChainRemote)" -ForegroundColor Gray

# 6. ChainRemote 재실행
Write-Host "[6/6] ChainRemote 재실행..." -ForegroundColor Yellow
Start-Process $exe
Start-Sleep 3

Write-Host "`n=== 완료 ===" -ForegroundColor Green
Write-Host "  서버: sepani.synology.me (NAS)" -ForegroundColor White
Write-Host "  비번: chain1234" -ForegroundColor White
Write-Host "  부팅 시 자동 시작: ON" -ForegroundColor White
Write-Host "`n  검증: Mac에서 ID 접속 → 비번 'chain1234' 입력 → 윈컴 클릭 없이 연결" -ForegroundColor Cyan
