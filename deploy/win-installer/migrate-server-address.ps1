# ChainRemote - rewrite the server address keys in an existing ChainRemote2.toml.
# Called once per config location from the installer [Run] section. See agent-installer.iss
# for the Korean rationale; this file stays ASCII on purpose.
#
# WHY THIS EXISTS
#   The config placement step skips entirely when ChainRemote2.toml already exists, to keep
#   whatever the customer changed in the security tab (approve-mode and friends). The server
#   address is ours, not theirs, but it got caught by the same guard and could never be
#   updated. So we rewrite exactly those three keys and leave every other byte alone.
#
# RULES
#   - Touch three keys only. Everything else keeps its spacing and comments.
#   - If the result equals the original, do not write at all. Safe to run any number of times.
#   - Write to a temp file, read it back, verify, and only then swap. If anything looks wrong
#     the original survives untouched: a broken config means that machine cannot find the
#     server, and there is no remote path back in.
#   - PowerShell 2.0 syntax only, and ASCII only. Win7 and Windows Embedded boxes are still
#     in the fleet, and PowerShell reads a BOM-less .ps1 as the system ANSI codepage - Korean
#     text here turns into mojibake that breaks the parser. Every installer script in this
#     directory is ASCII for that reason.

param(
  [string]$Path  = '',
  [string]$Rs    = '',
  [string]$Relay = '',
  [string]$Log   = ''
)

function Write-Log($msg) {
  if ($Log -eq '') { return }
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  try {
    $dir = Split-Path $Log
    if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
    Add-Content -Path $Log -Value ($ts + ' migrate-addr: ' + $msg)
  } catch { }
}

if ($Path -eq '' -or $Rs -eq '' -or $Relay -eq '') { Write-Log 'skip missing-args'; exit 0 }
if (-not (Test-Path $Path)) { Write-Log ('skip no-file ' + $Path); exit 0 }

# Test-Path follows the PowerShell location, [System.IO.File] follows the process working
# directory, and the two disagree for a relative path. Pin it to absolute before either runs.
try { $Path = (Resolve-Path -LiteralPath $Path).Path } catch { Write-Log ('skip unresolvable ' + $Path); exit 0 }

try {
  $orig = [System.IO.File]::ReadAllText($Path)
} catch {
  Write-Log ('skip read-failed ' + $Path + ' : ' + $_.Exception.Message)
  exit 0
}

# Follow whatever line ending the file already uses. The app may have rewritten it as CRLF.
$nl = "`n"
if ($orig.Contains("`r`n")) { $nl = "`r`n" }

# Replace one key in place, or insert it if the key is absent.
#   $inOptions - key belongs under [options]. Only rendezvous_server is top level.
function Set-TomlKey($text, $key, $value, $inOptions, $nl) {
  $line = $key + " = '" + $value + "'"
  $pat  = '(?m)^[ \t]*' + [Regex]::Escape($key) + '[ \t]*=.*$'

  if ([Regex]::IsMatch($text, $pat)) {
    # A '$' in the replacement string would be read as a capture reference.
    return [Regex]::Replace($text, $pat, $line.Replace('$', '$$$$'))
  }

  if (-not $inOptions) { return $line + $nl + $text }

  $idx = $text.IndexOf('[options]')
  if ($idx -ge 0) {
    $eol = $text.IndexOf("`n", $idx)
    if ($eol -ge 0) {
      return $text.Substring(0, $eol + 1) + $line + $nl + $text.Substring($eol + 1)
    }
  }
  return $text.TrimEnd() + $nl + $nl + '[options]' + $nl + $line + $nl
}

$new = $orig
$new = Set-TomlKey $new 'rendezvous_server'        ($Rs + ':21116') $false $nl
$new = Set-TomlKey $new 'custom-rendezvous-server' $Rs              $true  $nl
$new = Set-TomlKey $new 'relay-server'             $Relay           $true  $nl

if ($new -eq $orig) { Write-Log ('nochange ' + $Path); exit 0 }

# Record what the values were. If one machine ever ends up different, this is the only trail.
$before = ''
foreach ($k in @('rendezvous_server', 'custom-rendezvous-server', 'relay-server')) {
  $m = [Regex]::Match($orig, '(?m)^[ \t]*' + [Regex]::Escape($k) + '[ \t]*=[ \t]*(.*)$')
  if ($m.Success) { $before = $before + $k + '=' + $m.Groups[1].Value.Trim() + ' ' }
  else            { $before = $before + $k + '=(absent) ' }
}

$tmp = $Path + '.new'
$bak = $Path + '.bak'
try {
  # UTF-8 without BOM. That is what the Rust side writes, and a BOM hides the first key.
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tmp, $new, $enc)

  # Read it back and verify. Do not trust the write.
  $check = [System.IO.File]::ReadAllText($tmp)
  $ok = $true
  if (-not [Regex]::IsMatch($check, "(?m)^[ \t]*rendezvous_server[ \t]*=[ \t]*'" + [Regex]::Escape($Rs + ':21116') + "'")) { $ok = $false }
  if (-not [Regex]::IsMatch($check, "(?m)^[ \t]*custom-rendezvous-server[ \t]*=[ \t]*'" + [Regex]::Escape($Rs) + "'"))     { $ok = $false }
  if (-not [Regex]::IsMatch($check, "(?m)^[ \t]*relay-server[ \t]*=[ \t]*'" + [Regex]::Escape($Relay) + "'"))              { $ok = $false }
  # The customer-owned keys must survive. If approve-mode was there, it has to still be there.
  if ([Regex]::IsMatch($orig, '(?m)^[ \t]*approve-mode[ \t]*=') -and
      -not [Regex]::IsMatch($check, '(?m)^[ \t]*approve-mode[ \t]*=')) { $ok = $false }

  if (-not $ok) {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Write-Log ('FAIL verify-failed kept-original ' + $Path)
    exit 0
  }

  Copy-Item $Path $bak -Force -ErrorAction SilentlyContinue
  Move-Item $tmp $Path -Force
  Write-Log ('OK ' + $Path + ' | before: ' + $before.Trim() + ' | after: rs=' + $Rs + ' relay=' + $Relay)
} catch {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Write-Log ('FAIL write-failed kept-original ' + $Path + ' : ' + $_.Exception.Message)
}

exit 0
