# 빌드 로그에서 에러 섹션만 추출 + 클립보드 복사
$log = "$env:TEMP\chainremote-build.log"
if (-not (Test-Path $log)) {
  Write-Host "❌ 로그 파일 없음: $log" -ForegroundColor Red
  exit 1
}

$content = Get-Content $log -Raw
$lines = Get-Content $log

# error[ 패턴 주위 컨텍스트 추출 + 마지막 80줄
$errorLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^error(\[|:)") {
        $start = [Math]::Max(0, $i - 1)
        $end = [Math]::Min($lines.Count - 1, $i + 8)
        for ($j = $start; $j -le $end; $j++) {
            $errorLines += $lines[$j]
        }
        $errorLines += "---"
    }
}

$tail = $lines | Select-Object -Last 80

$report = "=== ERRORS SECTIONS ===`n" + ($errorLines -join "`n") + "`n`n=== LAST 80 LINES ===`n" + ($tail -join "`n")

# 화면 출력
Write-Host $report

# 클립보드 복사
Set-Clipboard -Value $report
Write-Host "`n✅ 위 내용이 클립보드에 복사됐습니다. 붙여넣어 Claude 에게 보내주세요." -ForegroundColor Green

# 또한 Mac 으로 자동 업로드 (Mac 의 SMB 가 켜져 있으면)
# 단순히 파일을 우리가 봐야 할 위치에 둠 - Chang 의 OneDrive 같은 거 활용하거나
# 파일 자체 위치 안내
Write-Host "`n   원본 로그 파일: $log" -ForegroundColor Gray
Write-Host "   크기: $([Math]::Round((Get-Item $log).Length/1KB,1)) KB" -ForegroundColor Gray
