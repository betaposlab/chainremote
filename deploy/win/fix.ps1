$ErrorActionPreference = "Stop"
Write-Host "=== ChainRemote 무인접속 수정 ===" -ForegroundColor Cyan

# 1. 프로세스 종료
Write-Host "[1/5] 프로세스 종료..." -ForegroundColor Yellow
Get-Process -Name "ChainRemote","RustDesk" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# 2. exe 찾기
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
  $found = Get-ChildItem -Path C:\ -Recurse -Include "rustdesk.exe","ChainRemote.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if($found){ $exe = $found.FullName }
}
if(-not $exe){ Write-Host "❌ 실행 파일 못 찾음" -ForegroundColor Red; exit 1 }
Write-Host "    실행 파일: $exe" -ForegroundColor Gray

# 3. 새 toml 다운로드 (approve-mode = 'password' 적용)
Write-Host "[2/5] 새 설정 다운로드 (approve-mode=password)..." -ForegroundColor Yellow
$cfg = "$env:APPDATA\RustDesk\config\RustDesk2.toml"
Invoke-WebRequest -Uri "http://192.168.68.108:8765/RustDesk2.toml" -OutFile $cfg -UseBasicParsing
Write-Host "    저장: $cfg" -ForegroundColor Gray

# 4. 비밀번호 강제 설정 (--password 옵션)
Write-Host "[3/5] 고정 비밀번호 'chain1234' 설정..." -ForegroundColor Yellow
& $exe --password "chain1234" 2>&1 | Out-Null
Start-Sleep 3

# 5. 설정 파일 직접 검증 (RustDesk.toml에 password 해시 있는지)
Write-Host "[4/5] 비밀번호 저장 검증..." -ForegroundColor Yellow
$mainCfg = "$env:APPDATA\RustDesk\config\RustDesk.toml"
if(Test-Path $mainCfg){
  $content = Get-Content $mainCfg -Raw
  if($content -match "password\s*=\s*'[^']+'"){
    Write-Host "    OK: 비밀번호 해시 저장됨" -ForegroundColor Green
  } else {
    Write-Host "    ⚠ 비밀번호 미저장. UI에서 수동 설정 필요할 수 있음" -ForegroundColor Yellow
  }
} else {
  Write-Host "    RustDesk.toml 없음" -ForegroundColor Yellow
}

# 6. 재실행
Write-Host "[5/5] ChainRemote 재실행..." -ForegroundColor Yellow
Start-Process $exe
Start-Sleep 3

Write-Host "`n=== 완료 ===" -ForegroundColor Green
Write-Host "  Mac에서 ID 129264698 접속 → 비번 chain1234 → 윈컴 클릭 없이 자동 연결되어야 함" -ForegroundColor Cyan
