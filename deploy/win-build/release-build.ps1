# ChainRemote 릴리즈 빌드 (윈컴 실행, WMI 분리로 SSH 끊김 무관) — Agent 또는 HQ.
# 4단계 배포 룰의 [1·3·4]를 자동 연결하는 e2e 파이프라인의 윈컴측 절반.
#   Mac 쪽 절반 = deploy/release-full.sh (빌드 트리거 + 산출물 회수 + 발행).
#
# 사용: powershell -File release-build.ps1 -Kind agent   (또는 -Kind hq)
#
# 32비트 페이로드(agent32-payload) 관례: "재빌드 금지, 고정 재사용"(메모리
#   project_32bit_agent_feasibility) — Rust 1.75 별도 툴체인 필요 + sha 고정이라
#   매 릴리즈 자동 재빌드 안 함. 이 스크립트는 존재 여부만 확인하고, 없으면
#   명확히 실패시켜(자동으로 조용히 x64-only 인스톨러를 만들지 않음) 별도로
#   build-agent32.ps1 을 먼저 돌리라고 안내한다.
param(
  [Parameter(Mandatory=$true)][ValidateSet('agent','hq')][string]$Kind
)
$ErrorActionPreference = 'Continue'
Add-Type -Name Pwr -Namespace CRB -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
[CRB.Pwr]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null  # keep-awake

$repo = 'C:\src\ChainRemote'
$status = Join-Path $repo "_release_${Kind}.status"
function Mark($m) { "$((Get-Date).ToString('s')) $m" | Add-Content -Encoding ascii $status }

Set-Location $repo
Remove-Item $status -ErrorAction SilentlyContinue
Mark "START kind=$Kind"

git fetch origin 2>&1 | Out-Null
git reset --hard origin/develop 2>&1 | Out-Null
$head = git rev-parse --short=9 HEAD
$ver = (Select-String -Path 'src\chainremote_version.rs' -Pattern 'CHAINREMOTE_VERSION: &str = "([^"]+)"').Matches[0].Groups[1].Value
Mark "HEAD $head VERSION $ver"

& powershell -ExecutionPolicy Bypass -File "$repo\deploy\win-build\build-all.ps1" *> "$repo\_release_${Kind}_x64.log"
if ($LASTEXITCODE -ne 0) { Mark "FAIL x64 exit=$LASTEXITCODE"; exit 1 }
Mark 'X64-OK'

$installerFile = $null
if ($Kind -eq 'agent') {
  $payloadDir = "$repo\deploy\win-installer\agent32-payload"
  if (-not (Test-Path "$payloadDir\ChainRemote.exe")) {
    Mark "FAIL agent32-payload 없음 — build-agent32.ps1 을 먼저 1회 실행 필요(재빌드 금지 관례, 매번 자동재빌드 안 함)"
    exit 1
  }
  Mark "AGENT32-PAYLOAD-OK (기존 고정본 재사용, mtime=$((Get-Item "$payloadDir\ChainRemote.exe").LastWriteTime))"
  $installerFile = "ChainRemote_Agent_Setup_v$ver.exe"
  Set-Location "$repo\deploy\win-installer"
  & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" agent-installer.iss *> "$repo\_release_${Kind}_iscc.log"
} else {
  $installerFile = "ChainRemote_HQ_Setup_v$ver.exe"
  Set-Location "$repo\deploy\win-installer"
  & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" hq-installer.iss *> "$repo\_release_${Kind}_iscc.log"
}
if ($LASTEXITCODE -ne 0) { Mark "FAIL iscc exit=$LASTEXITCODE"; exit 1 }
Mark 'ISCC-OK'

$out = Get-ChildItem "$repo\deploy\win-installer\$installerFile" -ErrorAction SilentlyContinue
if ($out) {
  $sha = (Get-FileHash $out.FullName -Algorithm SHA256).Hash.ToLower()
  Mark "ARTIFACT $($out.FullName) VERSION=$ver size=$($out.Length) sha256=$sha"
  Mark 'ALL-DONE'
} else {
  Mark 'FAIL artifact-missing'
  exit 1
}
