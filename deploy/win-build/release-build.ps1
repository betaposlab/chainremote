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
  $payloadExe = "$payloadDir\ChainRemote.exe"
  # ★★ 32비트 페이로드 버전 자동정합 (2026-07-10 복수점/신교령/카페리치 사고 근본대책).
  #   윈7 32비트 POS 는 거래처의 큰 몫이고, 통합 인스톨러가 OS 감지로 그들에겐 이 32비트
  #   페이로드를 깐다. 그런데 32비트는 x64 자동빌드에 안 딸려오는 별도 Rust 1.75 빌드라,
  #   버전 올릴 때 재빌드를 "사람이 기억"해야 했고 → 깜빡하면 32비트 전부가 옛 버전 고착 +
  #   패널 '입뎃 미확인'. 그 기억 의존을 없앤다: 페이로드 바이너리에 이번 릴리즈 버전 문자열이
  #   실제로 박혀있는지 검사해서, 없거나(옛 고정본) 페이로드 자체가 없으면 파이프라인이
  #   build-agent32.ps1 을 스스로 돌려 v$ver 로 재빌드한다. 즉 이 원커맨드가 x64·x86 을
  #   항상 같은 버전으로 맞춰 내보낸다 = 32비트 빠뜨림이 구조적으로 불가능.
  $payloadOk = (Test-Path $payloadExe) -and ([System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($payloadExe)) -match [regex]::Escape("$ver"))
  if ($payloadOk) {
    Mark "AGENT32-PAYLOAD-OK (v$ver 정합, 기존본 재사용, mtime=$((Get-Item $payloadExe).LastWriteTime))"
  } else {
    Mark "AGENT32-REBUILD-START (페이로드가 v$ver 아님/없음 — build-agent32.ps1 자동 재빌드, ~5~10분)"
    & powershell -ExecutionPolicy Bypass -File "$repo\deploy\win-build\build-agent32.ps1" *> "$repo\_release_${Kind}_agent32.log"
    if ($LASTEXITCODE -ne 0) { Mark "FAIL agent32 자동재빌드 (build-agent32.ps1 exit=$LASTEXITCODE) — _release_${Kind}_agent32.log 확인"; exit 1 }
    $payloadOk = (Test-Path $payloadExe) -and ([System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($payloadExe)) -match [regex]::Escape("$ver"))
    if (-not $payloadOk) { Mark "FAIL agent32 재빌드했는데도 페이로드에 v$ver 없음 — _release_${Kind}_agent32.log 확인"; exit 1 }
    Mark "AGENT32-REBUILD-OK (v$ver 재빌드 완료, mtime=$((Get-Item $payloadExe).LastWriteTime))"
  }
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
