@echo off
rem ChainRemote support diagnostics collector.  READ-ONLY: changes nothing on this PC.
rem Double-click it.  It asks for administrator rights once, then leaves
rem cr-diag-<date>.zip on the Desktop.  Send that zip to your support contact.
rem
rem Why it needs admin: the agent's own log lives under the LocalService profile
rem (C:\Windows\ServiceProfiles\LocalService\...), which a normal user cannot read.
rem
rem Layout: this file is a batch header followed by a PowerShell script.  The header
rem re-reads the file and runs everything after the LAST "#PSBEGIN" marker.  Keep the
rem header ASCII-only above the chcp line - cmd parses it in the system codepage.
setlocal
set "DESK=%~1"
if "%DESK%"=="" for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "DESK=%%D"
chcp 65001 >nul
fltmc >nul 2>&1
if not errorlevel 1 goto elevated
rem Not inside a ( ) block on purpose: a Desktop path containing parentheses
rem ("C:\Users\name (1)\...") would end the block early.
echo.
echo  관리자 권한이 필요합니다. 다음 창에서 [예] 를 눌러 주세요.
echo.
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '\"%DESK%\"' -Verb RunAs"
exit /b

:elevated
set "CRDESK=%DESK%"
set "CRSELF=%~f0"
echo.
echo  ChainRemote 진단 자료를 모으고 있습니다. 1분쯤 걸립니다. 창을 닫지 마세요.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:CRSELF,[Text.Encoding]::UTF8); Invoke-Expression $s.Substring($s.LastIndexOf('#PSBEGIN'))"
echo.
pause
exit /b

#PSBEGIN
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

$desk = $env:CRDESK
if (-not $desk -or -not (Test-Path -LiteralPath $desk)) { $desk = [Environment]::GetFolderPath('Desktop') }
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$work = Join-Path $env:TEMP ("cr-diag-" + $stamp)
New-Item $work -ItemType Directory -Force | Out-Null
$summary = Join-Path $work 'summary.txt'

function Note([string]$m) {
    Add-Content -LiteralPath $summary -Value $m -Encoding UTF8
    Write-Host ("  " + $m)
}
# Run one collector and never let it stop the rest: a missing cmdlet on an old
# Windows must cost one file, not the whole bundle.
function Grab([string]$name, [scriptblock]$body) {
    $out = Join-Path $work $name
    try {
        & $body 2>&1 | Out-File -LiteralPath $out -Encoding UTF8 -Width 400
        Note ("ok    " + $name)
    } catch {
        Note ("FAIL  " + $name + "  " + $_.Exception.Message)
    }
}

Note ("ChainRemote diag " + $stamp + "  host=" + $env:COMPUTERNAME + "  user=" + $env:USERNAME)

# 1) Agent logs, last 3 days only (the server log alone can be tens of MB).
#    --service and --server log under LocalService; the tray/UI under each user.
$roots = @(
    'C:\Windows\ServiceProfiles\LocalService\AppData\Roaming\ChainRemote\log',
    'C:\Windows\System32\config\systemprofile\AppData\Roaming\ChainRemote\log'
)
foreach ($u in @(Get-ChildItem 'C:\Users\*\AppData\Roaming\ChainRemote\log' -ErrorAction SilentlyContinue)) { $roots += $u.FullName }
$since = (Get-Date).AddDays(-3)
$copied = 0
foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { Note ("--    no log dir " + $root); continue }
    $tag = ($root -replace '[:\\]', '_')
    foreach ($f in @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $since })) {
        $rel = $f.FullName.Substring($root.Length).TrimStart('\')
        $dst = Join-Path (Join-Path (Join-Path $work 'log') $tag) $rel
        try {
            New-Item (Split-Path $dst) -ItemType Directory -Force | Out-Null
            Copy-Item -LiteralPath $f.FullName -Destination $dst -Force -ErrorAction Stop
            $copied++
        } catch {
            Note ("FAIL  copy " + $f.FullName + "  " + $_.Exception.Message)
        }
    }
}
Note ("ok    agent log files copied: " + $copied)
if (Test-Path 'C:\ProgramData\ChainRemote\updater.log') {
    Copy-Item 'C:\ProgramData\ChainRemote\updater.log' (Join-Path $work 'updater.log') -Force -ErrorAction SilentlyContinue
}

# 2) Power state.  The question this bundle exists to answer: did the PC (or its
#    network card) go into a low-power state while it still looked "online"?
Grab 'power-available-states.txt' { powercfg /a }
Grab 'power-scheme.txt'           { powercfg /q }
Grab 'power-lastwake.txt'         { powercfg /lastwake }
Grab 'power-requests.txt'         { powercfg /requests }
Grab 'power-events.csv' {
    Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddDays(-3);
        ProviderName = @('Microsoft-Windows-Kernel-Power', 'Microsoft-Windows-Power-Troubleshooter', 'Microsoft-Windows-Kernel-General') } -ErrorAction Stop |
        Sort-Object TimeCreated |
        Select-Object TimeCreated, ProviderName, Id, @{ n = 'Message'; e = { ($_.Message -replace '\s+', ' ') } } |
        ConvertTo-Csv -NoTypeInformation
}
# Modern Standby report.  Only exists on S0 low-power-idle machines; elsewhere it fails
# and that failure is itself the answer.
try {
    & powercfg /sleepstudy /output (Join-Path $work 'sleepstudy.html') /duration 3 2>&1 | Out-Null
    if (Test-Path (Join-Path $work 'sleepstudy.html')) { Note 'ok    sleepstudy.html' } else { Note '--    sleepstudy not available' }
} catch { Note '--    sleepstudy not available' }

# 3) Network card and its power saving.
Grab 'net-adapters.txt'       { Get-NetAdapter | Format-List Name, InterfaceDescription, Status, LinkSpeed, MediaType, DriverVersion, DriverDate }
Grab 'net-adapter-power.txt'  { Get-NetAdapterPowerManagement | Format-List * }
Grab 'net-adapter-advanced.txt' { Get-NetAdapterAdvancedProperty | Sort-Object Name, DisplayName | Format-Table Name, DisplayName, DisplayValue -AutoSize }
Grab 'net-ipconfig.txt'       { ipconfig /all }
Grab 'net-events.csv' {
    Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = (Get-Date).AddDays(-3); Level = @(1, 2, 3) } -ErrorAction Stop |
        Sort-Object TimeCreated |
        Select-Object TimeCreated, ProviderName, Id, LevelDisplayName, @{ n = 'Message'; e = { ($_.Message -replace '\s+', ' ') } } |
        ConvertTo-Csv -NoTypeInformation
}

# 4) Firewall and security software.
Grab 'firewall-state.txt' { netsh advfirewall show allprofiles state }
Grab 'firewall-rules.txt' { Get-NetFirewallRule -ErrorAction Stop | Where-Object { $_.DisplayName -like '*ChainRemote*' -or $_.DisplayName -like '*RustDesk*' } | Format-Table DisplayName, Enabled, Direction, Action, Profile -AutoSize }
Grab 'security-products.txt' { Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop | Format-List displayName, productState, pathToSignedProductExe }

# 5) Our service and processes, and the OS.
Grab 'chainremote-processes.txt' {
    Get-Service ChainRemote -ErrorAction SilentlyContinue | Format-List Name, Status, StartType
    Get-Process ChainRemote -ErrorAction SilentlyContinue | Format-Table Id, SessionId, StartTime, @{ n = 'MB'; e = { [int]($_.WorkingSet64 / 1MB) } } -AutoSize
    Get-CimInstance Win32_Process -Filter "Name='ChainRemote.exe'" -ErrorAction SilentlyContinue | Format-Table ProcessId, CommandLine -AutoSize -Wrap
}
Grab 'os.txt' { Get-CimInstance Win32_OperatingSystem | Format-List Caption, Version, OSArchitecture, LastBootUpTime, LocalDateTime }

# Zip.  Verify rather than claim - a silent failure here sends the user hunting for
# a file that does not exist.
$zip = Join-Path $desk ("cr-diag-" + $stamp + ".zip")
try {
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    Compress-Archive -Path (Join-Path $work '*') -DestinationPath $zip -Force -ErrorAction Stop
} catch {
    Write-Host ("  zip failed: " + $_.Exception.Message) -ForegroundColor Red
}
Write-Host ''
if (Test-Path -LiteralPath $zip) {
    $mb = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
    Write-Host ("  완료: " + $zip + "  (" + $mb + " MB)") -ForegroundColor Green
    Write-Host  "  이 파일을 담당자에게 보내 주세요." -ForegroundColor Green
    Start-Process explorer.exe -ArgumentList ('/select,"' + $zip + '"')
} else {
    Write-Host ("  실패: 파일을 만들지 못했습니다. 이 창을 사진 찍어 담당자에게 보내 주세요.") -ForegroundColor Red
    Write-Host ("  모은 자료는 여기 있습니다: " + $work) -ForegroundColor Yellow
}
