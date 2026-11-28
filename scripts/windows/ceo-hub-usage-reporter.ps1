#Requires -Version 5.1
<#
  CEO Hub <- Local AI usage reporter (Aside / Claude, plus a manual/hook one-shot for any worker)
  - Reads ONLY local evidence on this PC (no AI calls, no browser, no credential files are read):
      1) Claude Code local session logs (%USERPROFILE%\.claude\projects\**\*.jsonl or CLAUDE_CONFIG_DIR):
         token usage per assistant message -> current 5-hour block and its reset time,
         "usage limit reached" / rate_limit_error lines -> limited=true (+ reset time when the text has one)
      2) Aside watcher task logs (%LOCALAPPDATA%\CeoHubWatcher\task-*.log):
         Claude usage-limit / 429 phrases written by the Aside CLI -> limited=true
  - Posts POST /api/ops/usage-snapshot { worker:'aside', limited, resetAt, remainingPercent?, note }
    only when the state changes (or every HeartbeatMinutes while a 5h block is active).
  - remainingPercent is sent ONLY when config.json has claudeTokenBudget5h > 0 (your own budget).
    Claude has no official local "remaining %" value, so it is never guessed otherwise.
  - Auth (never printed or logged): own DPAPI MCP token -> AGY watcher MCP token -> Aside watcher CEO key.
  - Manual / hook one-shot: -Worker aside|agy|gemini_app [-Limited] [-ResetAt ISO] [-RemainingPercent N] [-Note text] [-Clear]

  Usage (Windows PowerShell 5.1):
    powershell -ExecutionPolicy Bypass -File .\ceo-hub-usage-reporter.ps1 -Install    # copy + auto start at login (every 5 min)
    powershell -ExecutionPolicy Bypass -File .\ceo-hub-usage-reporter.ps1 -DryRun     # collect only, print, send nothing
    powershell -ExecutionPolicy Bypass -File .\ceo-hub-usage-reporter.ps1 -Once       # collect + send once
    powershell -ExecutionPolicy Bypass -File .\ceo-hub-usage-reporter.ps1 -Status     # running? + last log lines
    powershell -ExecutionPolicy Bypass -File .\ceo-hub-usage-reporter.ps1 -Uninstall  # stop + remove auto start
    powershell -ExecutionPolicy Bypass -File .\ceo-hub-usage-reporter.ps1 -Worker aside -Limited -ResetAt 2026-11-28T15:00:00+09:00
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Status,
  [switch]$Once,
  [switch]$DryRun,
  [switch]$ResetToken,
  [int]$IntervalMinutes = 5,
  [int]$HeartbeatMinutes = 60,
  [string]$Worker = '',
  [switch]$Limited,
  [string]$ResetAt = '',
  [int]$RemainingPercent = -1,
  [string]$Note = '',
  [switch]$Clear
)

$ErrorActionPreference = 'Stop'

$BaseDir       = Join-Path $env:LOCALAPPDATA 'CeoHubUsageReporter'
$OwnTokenFile  = Join-Path $BaseDir 'mcp-token.dpapi'
$AgyTokenFile  = Join-Path $env:LOCALAPPDATA 'CeoHubAgyWatcher\mcp-token.dpapi'
$AsideKeyFile  = Join-Path $env:LOCALAPPDATA 'CeoHubWatcher\key.xml'
$AsideTaskDir  = Join-Path $env:LOCALAPPDATA 'CeoHubWatcher'
$ConfigFile    = Join-Path $BaseDir 'config.json'
$StateFile     = Join-Path $BaseDir 'reporter-state.json'
$LogFile       = Join-Path $BaseDir 'reporter.log'
$Target        = Join-Path $BaseDir 'ceo-hub-usage-reporter.ps1'
$StartupDir    = [Environment]::GetFolderPath('Startup')
if (-not $StartupDir -and $env:APPDATA) { $StartupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup' }
$StartupVbs    = ''
if ($StartupDir) { $StartupVbs = Join-Path $StartupDir 'CeoHubUsageReporter.vbs' }

if (-not (Test-Path $BaseDir)) { New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# Korean text is kept as \uXXXX escapes so this file stays pure ASCII (PS 5.1 reads BOM-less files as ANSI)
function K([string]$Escaped) { return [System.Text.RegularExpressions.Regex]::Unescape($Escaped) }

function Write-Log([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) { Move-Item -Path $LogFile -Destination "$LogFile.bak" -Force }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
  if ($Once -or $DryRun -or $Worker -or $Install) { Write-Host $line }
}

function Load-Config {
  $cfg = [PSCustomObject]@{
    hubBaseUrl          = 'https://ai-ceo-hub.onrender.com'
    claudeTokenBudget5h = 0
    claudeLogDirs       = @()
    asideTaskLogDir     = $AsideTaskDir
  }
  if (Test-Path $ConfigFile) {
    try {
      $loaded = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($loaded.hubBaseUrl) { $cfg.hubBaseUrl = [string]$loaded.hubBaseUrl }
      if ($loaded.claudeTokenBudget5h) { $cfg.claudeTokenBudget5h = [double]$loaded.claudeTokenBudget5h }
      if ($loaded.claudeLogDirs) { $cfg.claudeLogDirs = @($loaded.claudeLogDirs | ForEach-Object { [string]$_ }) }
      if ($loaded.asideTaskLogDir) { $cfg.asideTaskLogDir = [string]$loaded.asideTaskLogDir }
    } catch { }
  }
  return $cfg
}

function Read-DpapiText([string]$Path) {
  $enc = (Get-Content -Path $Path -Raw -Encoding UTF8).Trim()
  $secure = ConvertTo-SecureString $enc
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Returns @{ Header; Value; Source } -- the secret value is never written to the log or console
function Get-HubAuth([bool]$AllowPrompt) {
  if ($ResetToken -and (Test-Path $OwnTokenFile)) { Remove-Item $OwnTokenFile -Force }
  if (Test-Path $OwnTokenFile) { return @{ Header = 'Authorization'; Value = ('Bearer ' + (Read-DpapiText $OwnTokenFile)); Source = 'reporter MCP token' } }
  if (Test-Path $AgyTokenFile) { return @{ Header = 'Authorization'; Value = ('Bearer ' + (Read-DpapiText $AgyTokenFile)); Source = 'AGY watcher MCP token' } }
  if (Test-Path $AsideKeyFile) {
    $sec = Import-Clixml -Path $AsideKeyFile
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
    return @{ Header = 'x-ceo-key'; Value = $plain; Source = 'Aside watcher CEO key' }
  }
  if (-not $AllowPrompt) { throw 'No saved token. Run with -Install first (or install the AGY / Aside watcher).' }
  $secToken = Read-Host 'CEO Office MCP token (hidden, saved with Windows DPAPI)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secToken)
  try { $plainToken = ([Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)).Trim() -replace '^Bearer\s+', '' } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if ([string]::IsNullOrWhiteSpace($plainToken)) { throw 'MCP token is empty.' }
  Set-Content -Path $OwnTokenFile -Value (ConvertFrom-SecureString (ConvertTo-SecureString $plainToken -AsPlainText -Force)) -Encoding UTF8
  return @{ Header = 'Authorization'; Value = ('Bearer ' + $plainToken); Source = 'reporter MCP token' }
}

function Send-UsageSnapshot([hashtable]$Auth, [string]$BaseUrl, [hashtable]$Body) {
  $json = $Body | ConvertTo-Json -Compress -Depth 4
  $req = [System.Net.HttpWebRequest]::Create("$($BaseUrl.TrimEnd('/'))/api/ops/usage-snapshot")
  $req.Method = 'POST'
  $req.Timeout = 20000
  $req.ReadWriteTimeout = 20000
  $req.Accept = 'application/json'
  $req.ContentType = 'application/json; charset=utf-8'
  $req.Headers.Add($Auth.Header, $Auth.Value)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream()
  try { $s.Write($bytes, 0, $bytes.Length) } finally { $s.Dispose() }
  try {
    $res = $req.GetResponse()
    $code = [int]$res.StatusCode
    $res.Close()
    return [PSCustomObject]@{ Ok = $true; Status = $code; Error = '' }
  } catch [System.Net.WebException] {
    $code = 0
    $msg = $_.Exception.Message
    if ($_.Exception.Response) {
      $code = [int]$_.Exception.Response.StatusCode
      try {
        $rd = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try { $raw = $rd.ReadToEnd(); $o = $raw | ConvertFrom-Json; if ($o.error) { $msg = [string]$o.error } } finally { $rd.Dispose() }
      } catch { }
    }
    return [PSCustomObject]@{ Ok = $false; Status = $code; Error = $msg }
  }
}

# ---------- local evidence ----------

function Read-SharedLines([string]$Path) {
  # FileShare.ReadWrite: never block the app that is still writing the log
  $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    $rd = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    try { return ($rd.ReadToEnd() -split "\r?\n") } finally { $rd.Dispose() }
  } finally { $fs.Dispose() }
}

function Resolve-ResetFromText([string]$Text, [DateTime]$SeenAtUtc) {
  # 1) Older Claude Code format: "Claude AI usage limit reached|1764310800"
  $m = [System.Text.RegularExpressions.Regex]::Match($Text, 'limit reached\|(\d{10})')
  if ($m.Success) { return [DateTimeOffset]::FromUnixTimeSeconds([int64]$m.Groups[1].Value).UtcDateTime }
  # 2) "resets 3pm" / "resets 3:30 pm" / "resets 15:00" (PC local time, next occurrence after the message)
  $m = [System.Text.RegularExpressions.Regex]::Match($Text, '(?i)resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?')
  if ($m.Success) {
    $h = [int]$m.Groups[1].Value
    $mi = 0
    if ($m.Groups[2].Success) { $mi = [int]$m.Groups[2].Value }
    if ($m.Groups[3].Success) {
      $ap = $m.Groups[3].Value.ToLower()
      if ($ap -eq 'pm' -and $h -lt 12) { $h += 12 }
      if ($ap -eq 'am' -and $h -eq 12) { $h = 0 }
    }
    if ($h -le 23 -and $mi -le 59) {
      $seenLocal = $SeenAtUtc.ToLocalTime()
      $cand = New-Object DateTime($seenLocal.Year, $seenLocal.Month, $seenLocal.Day, $h, $mi, 0, [DateTimeKind]::Local)
      if ($cand -le $seenLocal) { $cand = $cand.AddDays(1) }
      return $cand.ToUniversalTime()
    }
  }
  return $null
}

$ClaudeLimitRe = '(?i)(usage limit reached|limit reached\|\d{10}|hit your (usage )?limit|5-hour limit|weekly limit reached|rate_limit_error)'

function Get-ClaudeLogDirs([object]$Cfg) {
  $dirs = New-Object System.Collections.Generic.List[string]
  foreach ($d in @($Cfg.claudeLogDirs)) { if ($d) { $dirs.Add([string]$d) } }
  if ($env:CLAUDE_CONFIG_DIR) {
    foreach ($d in ($env:CLAUDE_CONFIG_DIR -split ',')) { if ($d.Trim()) { $dirs.Add((Join-Path $d.Trim() 'projects')) } }
  }
  $dirs.Add((Join-Path $env:USERPROFILE '.claude\projects'))
  $dirs.Add((Join-Path $env:USERPROFILE '.config\claude\projects'))
  return @($dirs | Select-Object -Unique | Where-Object { Test-Path $_ })
}

function Get-ClaudeUsage([object]$Cfg, [DateTime]$NowUtc) {
  $result = [PSCustomObject]@{ Found = $false; Files = 0; BlockStart = $null; ResetAt = $null; Tokens = 0; Messages = 0; LimitedAt = $null; LimitResetAt = $null }
  $since = $NowUtc.AddHours(-12)
  $entries = New-Object System.Collections.Generic.List[object]
  $seenReq = @{}
  foreach ($dir in (Get-ClaudeLogDirs $Cfg)) {
    $files = @(Get-ChildItem -Path $dir -Filter '*.jsonl' -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -ge $since })
    foreach ($f in $files) {
      $result.Files++
      $lines = @()
      try { $lines = Read-SharedLines $f.FullName } catch { continue }
      foreach ($ln in $lines) {
        if ($ln.Length -lt 20) { continue }
        $hasUsage = $ln.Contains('"usage"')
        $hasLimit = [System.Text.RegularExpressions.Regex]::IsMatch($ln, $ClaudeLimitRe)
        if (-not $hasUsage -and -not $hasLimit) { continue }
        $o = $null
        try { $o = $ln | ConvertFrom-Json } catch { continue }
        if (-not $o -or -not $o.timestamp) { continue }
        $t = [DateTime]::MinValue
        if (-not [DateTime]::TryParse([string]$o.timestamp, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal, [ref]$t)) { continue }
        if ($t -lt $since) { continue }
        if ($hasLimit) {
          if ((-not $result.LimitedAt) -or ($t -gt $result.LimitedAt)) {
            $result.LimitedAt = $t
            $result.LimitResetAt = Resolve-ResetFromText -Text $ln -SeenAtUtc $t
          }
        }
        if ($hasUsage -and $o.message -and $o.message.usage) {
          # The same API response can be logged on several lines: count it once per requestId / message id
          $rid = ''
          if ($o.requestId) { $rid = [string]$o.requestId } elseif ($o.message.id) { $rid = [string]$o.message.id }
          if ($rid) {
            if ($seenReq.ContainsKey($rid)) { continue }
            $seenReq[$rid] = $true
          }
          $u = $o.message.usage
          $tok = 0
          foreach ($k in @('input_tokens', 'output_tokens', 'cache_creation_input_tokens')) { if ($u.$k) { $tok += [double]$u.$k } }
          $entries.Add([PSCustomObject]@{ T = $t; Tokens = $tok })
        }
      }
    }
  }
  if ($entries.Count -eq 0 -and -not $result.LimitedAt) { return $result }
  $result.Found = $true
  # 5-hour blocks: a block starts at the hour of the first message after the previous block ended
  $blockStart = $null
  foreach ($e in ($entries | Sort-Object T)) {
    if ((-not $blockStart) -or ($e.T -ge $blockStart.AddHours(5))) {
      $blockStart = New-Object DateTime($e.T.Year, $e.T.Month, $e.T.Day, $e.T.Hour, 0, 0, [DateTimeKind]::Utc)
    }
  }
  if ($blockStart -and ($NowUtc -lt $blockStart.AddHours(5))) {
    $result.BlockStart = $blockStart
    $result.ResetAt = $blockStart.AddHours(5)
    foreach ($e in $entries) { if ($e.T -ge $blockStart) { $result.Tokens += $e.Tokens; $result.Messages++ } }
  }
  return $result
}

# GitHub "API rate limit exceeded" text is deliberately NOT matched (Aside tasks often mention it)
$AsideCliLimitRe = '(?i)(usage limit reached|limit reached\|\d{10}|hit your (usage )?limit|5-hour limit|weekly limit reached|rate_limit_error|claude.{0,40}\b429\b|\b429\b.{0,40}(anthropic|claude))'

function Get-AsideTaskLogLimit([object]$Cfg, [DateTime]$NowUtc) {
  $hit = $null
  if (-not $Cfg.asideTaskLogDir -or -not (Test-Path $Cfg.asideTaskLogDir)) { return $null }
  $files = @(Get-ChildItem -Path $Cfg.asideTaskLogDir -Filter 'task-*.log' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -ge $NowUtc.AddHours(-6) } | Sort-Object LastWriteTimeUtc)
  foreach ($f in $files) {
    $lines = @()
    try { $lines = @(Read-SharedLines $f.FullName) } catch { continue }
    $tail = $lines
    if ($lines.Count -gt 200) { $tail = $lines[($lines.Count - 200)..($lines.Count - 1)] }
    foreach ($ln in $tail) {
      if ([System.Text.RegularExpressions.Regex]::IsMatch($ln, $AsideCliLimitRe)) {
        $hit = [PSCustomObject]@{ At = $f.LastWriteTimeUtc; ResetAt = (Resolve-ResetFromText -Text $ln -SeenAtUtc $f.LastWriteTimeUtc); File = $f.Name }
      }
    }
  }
  return $hit
}

function Load-State {
  if (Test-Path $StateFile) { try { return (Get-Content -Path $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { } }
  return [PSCustomObject]@{ lastKey = ''; lastSentAt = ''; limited = $false }
}

function Save-State([string]$Key, [bool]$IsLimited) {
  $o = @{ lastKey = $Key; lastSentAt = [DateTime]::UtcNow.ToString('o'); limited = $IsLimited }
  Set-Content -Path $StateFile -Value ($o | ConvertTo-Json) -Encoding UTF8
}

function Build-AsideSnapshot([object]$Cfg) {
  $nowUtc = [DateTime]::UtcNow
  $cu = Get-ClaudeUsage -Cfg $Cfg -NowUtc $nowUtc
  $tl = Get-AsideTaskLogLimit -Cfg $Cfg -NowUtc $nowUtc

  # Limit evidence (newest wins). It stays active until its reset time, or 5h after it was seen when no reset time is known.
  $limAt = $null; $limReset = $null; $limSrc = ''
  if ($cu.LimitedAt) { $limAt = $cu.LimitedAt; $limReset = $cu.LimitResetAt; $limSrc = 'Claude Code log' }
  if ($tl -and ((-not $limAt) -or ($tl.At -gt $limAt))) { $limAt = $tl.At; $limReset = $tl.ResetAt; $limSrc = "Aside task log $($tl.File)" }
  $isLimited = $false
  if ($limAt) {
    $until = $limAt.AddHours(5)
    if ($limReset) { $until = $limReset }
    # a new 5h block that started after the limit message means the limit already lifted
    $usedAfter = ($cu.BlockStart -ne $null) -and ($cu.Messages -gt 0) -and ($cu.BlockStart -gt $limAt)
    if (($nowUtc -lt $until) -and (-not $usedAfter)) { $isLimited = $true }
  }

  $body = @{ worker = 'aside'; by = 'usage-reporter' }
  if ($isLimited) {
    $body.limited = $true
    if ($limReset) { $body.resetAt = $limReset.ToString('o') }
    $body.note = (K '\ud55c\ub3c4 \ub3c4\ub2ec \uac10\uc9c0') + " ($limSrc)"
  } elseif ($cu.ResetAt) {
    $body.limited = $false
    $body.resetAt = $cu.ResetAt.ToString('o')
    $tokK = [Math]::Round($cu.Tokens / 1000)
    $body.note = (K 'Claude Code \ub85c\uceec \uae30\ub85d: \uc774\ubc88 5\uc2dc\uac04 \ube14\ub85d \uba54\uc2dc\uc9c0 ') + $cu.Messages + ', ' + (K '\ud1a0\ud070 \uc57d ') + $tokK + 'k'
    if ($Cfg.claudeTokenBudget5h -gt 0) {
      $pct = [Math]::Max(0, [Math]::Min(100, [Math]::Round(100 - ($cu.Tokens / $Cfg.claudeTokenBudget5h) * 100)))
      $body.remainingPercent = $pct
      $body.note += ' / ' + (K '\ub0a8\uc740 %\ub294 config \uc608\uc0b0 \uae30\uc900 \ucd94\uc815')
    }
  } else {
    return [PSCustomObject]@{ Body = $null; Usage = $cu; TaskLog = $tl; Reason = 'no active 5h block and no limit evidence (nothing to report)' }
  }
  return [PSCustomObject]@{ Body = $body; Usage = $cu; TaskLog = $tl; Reason = '' }
}

function Get-SnapshotKey([hashtable]$Body) {
  $r = ''
  if ($Body.resetAt) { $r = ([DateTime]::Parse([string]$Body.resetAt)).ToUniversalTime().ToString('yyyyMMddHHmm') }
  $p = ''
  if ($Body.ContainsKey('remainingPercent')) { $p = [string]([Math]::Floor([double]$Body.remainingPercent / 5) * 5) }
  return "$($Body.limited)|$r|$p"
}

function Invoke-ReportCycle([object]$Cfg, [object]$Auth, [bool]$Force) {
  $snap = Build-AsideSnapshot -Cfg $Cfg
  $state = Load-State
  if (-not $snap.Body) {
    if ($state.limited -eq $true) {
      # Clear the limit we reported earlier once the evidence is gone (reset time passed)
      $clearBody = @{ worker = 'aside'; by = 'usage-reporter'; limited = $false; note = (K '\ud55c\ub3c4 \ub9ac\uc14b \uc2dc\uac01 \uc9c0\ub0a8 (\ub85c\uceec \uae30\ub85d \uae30\uc900)') }
      $snap = [PSCustomObject]@{ Body = $clearBody; Usage = $snap.Usage; TaskLog = $snap.TaskLog; Reason = '' }
    } else {
      Write-Log "aside: $($snap.Reason) (claude files=$($snap.Usage.Files))"
      return
    }
  }
  $key = Get-SnapshotKey $snap.Body
  $due = $Force -or ($key -ne [string]$state.lastKey)
  if ((-not $due) -and $state.lastSentAt) {
    $last = [DateTime]::Parse([string]$state.lastSentAt).ToUniversalTime()
    if (([DateTime]::UtcNow - $last).TotalMinutes -ge $HeartbeatMinutes) { $due = $true }
  }
  $summary = "aside: limited=$($snap.Body.limited) resetAt=$($snap.Body.resetAt) remaining=$($snap.Body.remainingPercent) msgs=$($snap.Usage.Messages) files=$($snap.Usage.Files)"
  if ($DryRun) { Write-Log "DRY RUN (not sent) $summary"; return }
  if (-not $due) { Write-Log "$summary (unchanged, not sent)"; return }
  $res = Send-UsageSnapshot -Auth $Auth -BaseUrl $Cfg.hubBaseUrl -Body $snap.Body
  if ($res.Ok) {
    Save-State -Key $key -IsLimited ([bool]$snap.Body.limited)
    Write-Log "$summary -> sent (HTTP $($res.Status))"
  } else {
    Write-Log "$summary -> send failed (HTTP $($res.Status)): $($res.Error)"
  }
}

# ---------- commands ----------

if ($Status) {
  $running = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*ceo-hub-usage-reporter.ps1*' -and $_.ProcessId -ne $PID }
  Write-Host ('Reporter running: ' + [bool]$running)
  Write-Host ('Auto start: ' + [bool]($StartupVbs -and (Test-Path $StartupVbs)))
  Write-Host ('Claude log dirs: ' + ((Get-ClaudeLogDirs (Load-Config)) -join '; '))
  if (Test-Path $LogFile) { Get-Content $LogFile -Tail 15 }
  exit 0
}

if ($Uninstall) {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*ceo-hub-usage-reporter.ps1*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  if ($StartupVbs -and (Test-Path $StartupVbs)) { Remove-Item $StartupVbs -Force }
  Write-Host "Reporter stopped and auto start removed. (Token, config and log stay in $BaseDir)"
  exit 0
}

$cfg = Load-Config

if ($Worker) {
  # One-shot manual / hook report
  $body = @{ worker = $Worker; by = 'usage-reporter' }
  if ($Clear) { $body.clear = $true }
  if ($Limited) { $body.limited = $true }
  if ($ResetAt) { $body.resetAt = $ResetAt }
  if ($RemainingPercent -ge 0) { $body.remainingPercent = $RemainingPercent }
  if ($Note) { $body.note = $Note }
  if ((-not $Clear) -and (-not $Limited) -and (-not $ResetAt) -and ($RemainingPercent -lt 0)) { $body.limited = $false }
  $auth = Get-HubAuth $true
  $res = Send-UsageSnapshot -Auth $auth -BaseUrl $cfg.hubBaseUrl -Body $body
  if ($res.Ok) { Write-Log "manual $Worker snapshot sent (HTTP $($res.Status), auth=$($auth.Source))"; exit 0 }
  Write-Log "manual $Worker snapshot failed (HTTP $($res.Status)): $($res.Error)"
  exit 1
}

if ($Install) {
  if ($PSCommandPath -ne $Target) { Copy-Item $PSCommandPath $Target -Force }
  $auth = Get-HubAuth $true
  Write-Host "Auth: $($auth.Source)"
  if (-not (Test-Path $ConfigFile)) {
    @{ hubBaseUrl = $cfg.hubBaseUrl; claudeTokenBudget5h = 0; claudeLogDirs = @(); asideTaskLogDir = $AsideTaskDir } | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
  }
  $DryRun = $true
  Invoke-ReportCycle -Cfg $cfg -Auth $auth -Force $true
  $DryRun = $false
  if (-not $StartupVbs) { throw 'Windows Startup folder not found; cannot register auto start.' }
  $vbs = 'Set WshShell = CreateObject("WScript.Shell")' + "`r`n" + 'WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + $Target + '""", 0, False' + "`r`n"
  Set-Content -Path $StartupVbs -Value $vbs -Encoding ASCII
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$StartupVbs`""
  Write-Host "Installed. Reports every $IntervalMinutes min in background and at every Windows login."
  Write-Host "Log: $LogFile  /  Config: $ConfigFile"
  exit 0
}

if ($Once -or $DryRun) {
  $auth = $null
  if (-not $DryRun) { $auth = Get-HubAuth $false }
  Invoke-ReportCycle -Cfg $cfg -Auth $auth -Force $true
  exit 0
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\CeoHubUsageReporterMutex')
if (-not $mutex.WaitOne(0)) { Write-Log 'Reporter is already running. Exiting.'; exit 0 }
try {
  Write-Log "Reporter started (every $IntervalMinutes min, heartbeat $HeartbeatMinutes min)"
  while ($true) {
    try {
      $cfg = Load-Config
      $auth = Get-HubAuth $false
      Invoke-ReportCycle -Cfg $cfg -Auth $auth -Force $false
    } catch {
      Write-Log "Report cycle error: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds ([Math]::Max(60, $IntervalMinutes * 60))
  }
} finally {
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
}
