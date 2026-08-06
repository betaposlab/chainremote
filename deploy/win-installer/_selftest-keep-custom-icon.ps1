# Sandbox check for keep-custom-icon.ps1 - throwaway, not shipped.
# Builds fake desktops with shortcuts pointing at a dummy exe, so nothing on the real
# machine can match ($AppExe is the dummy). Verifies each branch end to end.

$ErrorActionPreference = "Stop"
$root = "C:\_icontest"
$script = "C:\src\ChainRemote\deploy\win-installer\keep-custom-icon.ps1"
$fails = 0

function Reset-Env {
    if (Test-Path $root) { Remove-Item $root -Recurse -Force }
    New-Item "$root\common" -ItemType Directory -Force | Out-Null
    New-Item "$root\user"   -ItemType Directory -Force | Out-Null
    Set-Content "$root\dummy.exe" "x"
    Set-Content "$root\other.exe" "x"
    Copy-Item "C:\src\ChainRemote\deploy\win-installer\chainremote.ico" "$root\test.ico" -Force
}

function New-Lnk([string]$path, [string]$target) {
    $w = New-Object -ComObject WScript.Shell
    $s = $w.CreateShortcut($path)
    $s.TargetPath = $target
    $s.Save()
}

function Run-It {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $script `
        -CommonDesktop "$root\common" -UserDesktop "$root\user" `
        -AppExe "$root\dummy.exe" -IconFile "$root\test.ico" -Log "$root\log.txt" | Out-Null
}

function Check([string]$name, $cond) {
    $cond = @($cond).Count -gt 0 -and [bool](@($cond) | Where-Object { $_ })
    if ($cond) { "  PASS  $name" }
    else { $script:fails = $script:fails + 1; "  FAIL  $name" }
}

"=== 1) renamed shortcut present -> default removed, renamed kept ==="
Reset-Env
New-Lnk "$root\common\ChainRemote.lnk" "$root\dummy.exe"
New-Lnk "$root\common\posremote.lnk"   "$root\dummy.exe"
New-Lnk "$root\common\Chrome.lnk"      "$root\other.exe"
Run-It
Check "default lnk removed"  (-not (Test-Path "$root\common\ChainRemote.lnk"))
Check "renamed lnk kept"     (Test-Path "$root\common\posremote.lnk")
Check "unrelated lnk kept"   (Test-Path "$root\common\Chrome.lnk")
Check "logged the decision"  ((Get-Content "$root\log.txt" -ErrorAction SilentlyContinue) -match "kept \[")

"=== 2) Korean name (the real field case) ==="
Reset-Env
New-Lnk "$root\common\ChainRemote.lnk" "$root\dummy.exe"
$kor = [char]0xD3EC + [char]0xC2A4 + [char]0xC6D0 + [char]0xACA9   # POS-remote in Hangul
New-Lnk "$root\common\$kor.lnk" "$root\dummy.exe"
Run-It
Check "default removed next to Hangul name" (-not (Test-Path "$root\common\ChainRemote.lnk"))
Check "Hangul lnk kept"                     (Test-Path "$root\common\$kor.lnk")

"=== 3) renamed shortcut on a DIFFERENT desktop than the default ==="
Reset-Env
New-Lnk "$root\common\ChainRemote.lnk" "$root\dummy.exe"
New-Lnk "$root\user\posremote.lnk"     "$root\dummy.exe"
Run-It
Check "cross-desktop match still removes default" (-not (Test-Path "$root\common\ChainRemote.lnk"))

"=== 4) nobody renamed -> default kept and icon refreshed ==="
Reset-Env
New-Lnk "$root\common\ChainRemote.lnk" "$root\dummy.exe"
Run-It
$w = New-Object -ComObject WScript.Shell
Check "default kept"  (Test-Path "$root\common\ChainRemote.lnk")
Check "icon applied"  ($w.CreateShortcut("$root\common\ChainRemote.lnk").IconLocation -match "test.ico")
Check "logged no-rename branch" ((Get-Content "$root\log.txt") -match "no renamed lnk")

"=== 5) broken shortcut in the folder must not stop the scan ==="
Reset-Env
New-Lnk "$root\common\ChainRemote.lnk" "$root\dummy.exe"
Set-Content "$root\common\broken.lnk" "not a real shortcut"
New-Lnk "$root\common\posremote.lnk" "$root\dummy.exe"
Run-It
Check "survived the broken lnk" (-not (Test-Path "$root\common\ChainRemote.lnk"))

"=== 6) no shortcuts at all -> no crash, still logs ==="
Reset-Env
Run-It
Check "logged empty scan" ((Get-Content "$root\log.txt" -ErrorAction SilentlyContinue) -match "scan ")

""
if ($fails -eq 0) { "ALL PASS" } else { "FAILURES: $fails" }
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
