#Requires -Version 5.1
<#
  CEO Hub <-> Local Antigravity (agy) Real-Time Watcher
  - Parity with Aside's ceo-hub-watcher.ps1 (no CEO Hub server changes / no SSE)
  - Polls GET /api/outsourcing?worker=antigravity every 60s (pure HTTP, 0 AI cost)
  - Decrypts MCP token via Windows DPAPI (CurrentUser scope only)
  - Invokes Antigravity CLI (%LOCALAPPDATA%\agy\bin\agy.exe) in headless auto mode
  - Supports optional per-kind/effort model overrides in config.json with safe fallback
  - Enforces 4-step code verification loop (AGENTS.md + origin/main sync + npm test + self diff review; never push to main)
  - 20-minute per-request dedup, 90-minute hard timeout, single-instance mutex, exponential backoff
  - Reports AGY quota/rate-limit (and the next normal finish) to the CEO Hub AI usage widget (POST /api/ops/usage-snapshot, non-blocking)
#>
param(
  [switch]$CheckOnce,
  [int]$IntervalSeconds = 60,
  [int]$DedupMinutes = 20,
  [int]$MaxRunMinutes = 90
)

$ErrorActionPreference = 'Stop'

$BaseDir    = Join-Path $env:LOCALAPPDATA 'CeoHubAgyWatcher'
$TokenFile  = Join-Path $BaseDir 'mcp-token.dpapi'
$ConfigFile = Join-Path $BaseDir 'config.json'
$StateFile  = Join-Path $BaseDir 'watcher-state.json'
$LogFile    = Join-Path $BaseDir 'watcher.log'

if (-not (Test-Path $BaseDir)) { New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null }

function Write-Log([string]$Message) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "[$ts] $Message"
  try {
    # Rotate log if > 2MB
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 2MB)) {
      Move-Item -Path $LogFile -Destination "$LogFile.bak" -Force
    }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
}

function Resolve-AgyCliPath {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'),
    (Join-Path $env:USERPROFILE '.local\bin\agy.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  $cmd = Get-Command 'agy.exe' -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and ($cmd.Source -notmatch 'Antigravity\.exe$')) {
    return $cmd.Source
  }
  return $null
}

function Load-Config {
  $defaults = [PSCustomObject]@{
    hubBaseUrl = 'https://ai-ceo-hub.onrender.com'
    worker     = 'antigravity'
    workDir    = (Join-Path $env:USERPROFILE 'ceo-hub-work')
    agyCliPath = ''
    models     = [PSCustomObject]@{
      code  = ''
      deep  = ''
      light = ''
    }
  }
  if (Test-Path $ConfigFile) {
    try {
      $loaded = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($loaded.hubBaseUrl) { $defaults.hubBaseUrl = [string]$loaded.hubBaseUrl }
      if ($loaded.worker)     { $defaults.worker     = [string]$loaded.worker }
      if ($loaded.workDir)    { $defaults.workDir    = [string]$loaded.workDir }
      if ($loaded.agyCliPath) { $defaults.agyCliPath = [string]$loaded.agyCliPath }
      if ($loaded.models) {
        if ($loaded.models.code)  { $defaults.models.code  = [string]$loaded.models.code }
        if ($loaded.models.deep)  { $defaults.models.deep  = [string]$loaded.models.deep }
        if ($loaded.models.light) { $defaults.models.light = [string]$loaded.models.light }
      }
    } catch { }
  }
  return $defaults
}

function Select-ModelForRequests([object]$Cfg, [object[]]$Requests) {
  if (-not $Cfg -or -not $Cfg.models) { return '' }
  $hasCode = $false
  $hasDeep = $false
  foreach ($r in $Requests) {
    if ($r.kind -eq 'code') { $hasCode = $true }
    if ($r.effort -eq 'deep') { $hasDeep = $true }
  }
  if ($hasCode -and $Cfg.models.code)  { return [string]$Cfg.models.code }
  if ($hasDeep -and $Cfg.models.deep)  { return [string]$Cfg.models.deep }
  if ($Cfg.models.light)               { return [string]$Cfg.models.light }
  return ''
}

function Load-McpToken {
  if (-not (Test-Path $TokenFile)) {
    throw "DPAPI token file not found: $TokenFile (run install-agy-watcher.ps1 first)"
  }
  $enc = (Get-Content -Path $TokenFile -Raw -Encoding UTF8).Trim()
  $secure = ConvertTo-SecureString $enc
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Load-State {
  $map = @{}
  if (Test-Path $StateFile) {
    try {
      $obj = Get-Content -Path $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($obj -and $obj.triggeredAt) {
        foreach ($p in $obj.triggeredAt.PSObject.Properties) {
          $map[$p.Name] = [int64]$p.Value
        }
      }
    } catch { }
  }
  return $map
}

function Save-State([hashtable]$TriggeredMap) {
  $payload = @{ triggeredAt = $TriggeredMap } | ConvertTo-Json -Depth 4
  Set-Content -Path $StateFile -Value $payload -Encoding UTF8
}

# ---------- AI usage widget hook (POST /api/ops/usage-snapshot, worker 'agy') ----------
# Non-blocking: any error here is logged and ignored so the watcher keeps running.
# Shared with the other AGY watcher through one state file, so a limit seen by one is cleared by the next normal run of either.
$AgyUsageStateFile = Join-Path $BaseDir 'usage-state.json'
$script:UsageBaseUrl = ''
$script:UsageToken = ''
$AgyQuotaRe = '(?i)(RESOURCE_EXHAUSTED|quota[ _-]?(exceeded|exhausted|limit)|exceeded (your|the) (current )?quota|rate[ _-]?limit(ed| exceeded| reached)|too many requests|\b429\b|usage limit|limit (reached|exceeded)|out of (credits|quota))'

function K([string]$Escaped) { return [System.Text.RegularExpressions.Regex]::Unescape($Escaped) }

function Find-AgyQuotaLine([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
  foreach ($ln in ($Text -split "\r?\n")) {
    # GitHub API rate-limit messages from git/gh tools are not an AGY quota problem
    if ($ln -match '(?i)github') { continue }
    if ([System.Text.RegularExpressions.Regex]::IsMatch($ln, $AgyQuotaRe)) { return $ln.Trim() }
  }
  return ''
}

function Resolve-AgyRetryAt([string]$Line) {
  $m = [System.Text.RegularExpressions.Regex]::Match($Line, '(?i)retry(?:Delay)?["'']?\s*(?:after|in|:)?\s*["'']?(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?)\b')
  if (-not $m.Success) { return $null }
  $n = [double]$m.Groups[1].Value
  $u = $m.Groups[2].Value.ToLower()
  if ($u.StartsWith('h')) { return [DateTime]::UtcNow.AddHours($n) }
  if ($u.StartsWith('m')) { return [DateTime]::UtcNow.AddMinutes($n) }
  return [DateTime]::UtcNow.AddSeconds($n)
}

function Get-AgyUsageLimitedFlag {
  try {
    if (Test-Path $AgyUsageStateFile) {
      $o = Get-Content -Path $AgyUsageStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      return ($o.limited -eq $true)
    }
  } catch { }
  return $false
}

function Set-AgyUsageLimitedFlag([bool]$IsLimited) {
  try { Set-Content -Path $AgyUsageStateFile -Value (@{ limited = $IsLimited; at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json) -Encoding UTF8 } catch { }
}

function Send-AgyUsageSnapshot([hashtable]$Body) {
  if (-not $script:UsageBaseUrl -or -not $script:UsageToken) { return $false }
  $json = $Body | ConvertTo-Json -Compress -Depth 4
  $req = [System.Net.HttpWebRequest]::Create("$($script:UsageBaseUrl.TrimEnd('/'))/api/ops/usage-snapshot")
  $req.Method = 'POST'
  $req.Timeout = 10000
  $req.ReadWriteTimeout = 10000
  $req.Accept = 'application/json'
  $req.ContentType = 'application/json; charset=utf-8'
  $req.Headers.Add('Authorization', "Bearer $($script:UsageToken)")
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $req.ContentLength = $bytes.Length
  try {
    $s = $req.GetRequestStream()
    try { $s.Write($bytes, 0, $bytes.Length) } finally { $s.Dispose() }
    $res = $req.GetResponse()
    $res.Close()
    return $true
  } catch {
    Write-Log "usage: snapshot POST failed ($($_.Exception.Message))"
    return $false
  }
}

# Call after every agy.exe run (not after a timeout). limited = quota text in stderr, or in stdout when agy exited non-zero.
function Update-AgyUsageFromRun([int]$ExitCode, [string]$Stdout, [string]$Stderr, [string]$Source) {
  try {
    $line = Find-AgyQuotaLine $Stderr
    if (-not $line -and $ExitCode -ne 0) {
      $tail = [string]$Stdout
      if ($tail.Length -gt 4000) { $tail = $tail.Substring($tail.Length - 4000) }
      $line = Find-AgyQuotaLine $tail
    }
    if ($line) {
      $short = $line
      if ($short.Length -gt 120) { $short = $short.Substring(0, 120) }
      $body = @{ worker = 'agy'; by = "agy-watcher:$Source"; limited = $true; note = (K '\ud55c\ub3c4 \ucd08\uacfc \uac10\uc9c0') + " ($Source, exit=$ExitCode): $short" }
      $retryAt = Resolve-AgyRetryAt $line
      if ($retryAt) { $body.resetAt = $retryAt.ToString('o') }
      if (Send-AgyUsageSnapshot $body) {
        Set-AgyUsageLimitedFlag $true
        Write-Log "usage: AGY quota/rate-limit detected ($Source, exit=$ExitCode) -> reported limited=true"
      }
    } elseif ($ExitCode -eq 0 -and (Get-AgyUsageLimitedFlag)) {
      # Only clear a limit this hook reported earlier, so a manual remaining-% snapshot is not overwritten after every run
      $body = @{ worker = 'agy'; by = "agy-watcher:$Source"; limited = $false; note = (K '\uc815\uc0c1 \uc644\ub8cc \ud655\uc778 (\ud55c\ub3c4 \ud574\uc81c)') + " ($Source)" }
      if (Send-AgyUsageSnapshot $body) {
        Set-AgyUsageLimitedFlag $false
        Write-Log "usage: AGY run finished normally ($Source) -> reported limited=false"
      }
    }
  } catch {
    Write-Log "usage: snapshot report skipped ($($_.Exception.Message))"
  }
}

function Start-AgyProcess([string]$AgyExe, [string]$WorkDir, [string]$Arguments, [string]$IdList) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $AgyExe
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.Arguments = $Arguments

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()

  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $timeoutMs = $MaxRunMinutes * 60 * 1000
  $finished = $proc.WaitForExit($timeoutMs)

  if (-not $finished) {
    Write-Log "TIMEOUT ($MaxRunMinutes min) reached for [$IdList] -- terminating agy PID $($proc.Id)"
    try { & taskkill /PID $proc.Id /T /F 2>$null | Out-Null } catch { }
    try { $proc.Kill() } catch { }
    return [PSCustomObject]@{ TimedOut = $true; ExitCode = -1; Stdout = ''; Stderr = '' }
  }

  $outText = ''
  $errText = ''
  try { $outText = $outTask.GetAwaiter().GetResult() } catch { }
  try { $errText = $errTask.GetAwaiter().GetResult() } catch { }
  return [PSCustomObject]@{ TimedOut = $false; ExitCode = $proc.ExitCode; Stdout = $outText; Stderr = $errText }
}

function Invoke-AgyRun([string]$AgyExe, [string]$WorkDir, [object[]]$Requests, [object]$Cfg) {
  if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null }

  $ids = @($Requests | ForEach-Object { [string]$_.id })
  $idList = $ids -join ', '
  $modelSlug = Select-ModelForRequests -Cfg $Cfg -Requests $Requests

  # Pure ASCII prompt avoids Windows PowerShell 5.1 UTF-8-without-BOM encoding issues;
  # agy.exe reads the Korean ceo-outsourcing SKILL.md and repo AGENTS.md directly in UTF-8.
  $prompt = "Use the ceo-outsourcing skill to process open CEO Office outsourcing requests assigned to worker antigravity (detected: $idList). Follow Carbon > Neon > Hydrogen model delegation from SKILL.md. For any code task, follow the mandatory 4-step loop: (1) read repo AGENTS.md and docs/ARCHITECTURE.md plus all affected files/callers, and sync latest origin/main via git fetch origin; (2) branch from origin/main as out/<REQ-ID> (or checkout the existing PR branch for agy_rework), make minimal focused edits, and NEVER push directly to main or edit data/db.json/.env/.github; (3) run repo tests (npm test, or npm test && npm run build && npm run verify) until 100% passing, and NEVER git push any branch (out/*, feat/*, any WIP) before npm test passes locally, because every failing push sends a CI failure email to the CEO; if tests cannot pass, do not push and report via request_ceo_action or pass_outsourcing_request; (4) before opening/updating PR, run git fetch origin && git merge origin/main, re-run tests, and self-review git diff origin/main...HEAD for regressions or cache-busting. Include changed files, test output, and review notes in the PR body and submit via submit_outsourcing_result (or request_ceo_action / pass_outsourcing_request if blocked). If no open requests remain, exit briefly."

  $escapedPrompt = $prompt.Replace('"', '\"')
  $baseArgs = "-p `"$escapedPrompt`" --mode=auto"
  $runArgs = if ($modelSlug) { "$baseArgs --model `"$modelSlug`"" } else { $baseArgs }
  $modelNote = if ($modelSlug) { " model=$modelSlug" } else { '' }

  Write-Log "Launching Antigravity CLI for [$idList]: $AgyExe$modelNote"
  $res = Start-AgyProcess -AgyExe $AgyExe -WorkDir $WorkDir -Arguments $runArgs -IdList $idList

  # Safe fallback: if an explicit --model flag was rejected by CLI, retry once with default model
  if ((-not $res.TimedOut) -and ($res.ExitCode -ne 0) -and $modelSlug -and ($res.Stderr -match 'model|unknown|invalid|flag')) {
    Write-Log "Model flag '$modelSlug' rejected for [$idList]; retrying with default model"
    $res = Start-AgyProcess -AgyExe $AgyExe -WorkDir $WorkDir -Arguments $baseArgs -IdList $idList
  }

  if (-not $res.TimedOut) {
    $stderrNote = ''
    if ($res.Stderr) {
      $errTrim = ($res.Stderr.Trim() -replace '\s+', ' ')
      if ($errTrim.Length -gt 240) { $errTrim = $errTrim.Substring(0, 240) }
      if ($errTrim) { $stderrNote = " stderr=$errTrim" }
    }
    Write-Log "Antigravity CLI finished for [$idList] (exit=$($res.ExitCode))$stderrNote"
    Update-AgyUsageFromRun -ExitCode $res.ExitCode -Stdout $res.Stdout -Stderr $res.Stderr -Source 'code'
  }
}

function Invoke-Utf8JsonGet([string]$Uri, [hashtable]$Headers) {
  $req = [System.Net.HttpWebRequest]::Create($Uri)
  $req.Method = 'GET'
  $req.Timeout = 15000
  $req.ReadWriteTimeout = 15000
  foreach ($k in $Headers.Keys) {
    if ($k -eq 'Accept') { $req.Accept = $Headers[$k] }
    else { $req.Headers.Add($k, $Headers[$k]) }
  }
  $res = $req.GetResponse()
  try {
    $reader = New-Object System.IO.StreamReader($res.GetResponseStream(), [System.Text.Encoding]::UTF8)
    try {
      $raw = $reader.ReadToEnd()
      return ($raw | ConvertFrom-Json)
    } finally {
      $reader.Dispose()
    }
  } finally {
    $res.Close()
  }
}

# Single-instance guard (skip when -CheckOnce)
$mutex = $null
if (-not $CheckOnce) {
  $createdNew = $false
  $mutex = New-Object System.Threading.Mutex($true, 'Local\CeoHubAgyWatcherMutex', [ref]$createdNew)
  if (-not $createdNew) {
    Write-Log 'Another CeoHubAgyWatcher instance is already running. Exiting.'
    exit 0
  }
}

try {
  $cfg = Load-Config
  $agyExe = if ($cfg.agyCliPath -and (Test-Path $cfg.agyCliPath)) { $cfg.agyCliPath } else { Resolve-AgyCliPath }
  $pollUrl = "$($cfg.hubBaseUrl.TrimEnd('/'))/api/outsourcing?worker=$([uri]::EscapeDataString($cfg.worker))"
  $cliLabel = if ($agyExe) { $agyExe } else { 'NOT_FOUND' }

  Write-Log "Watcher started (worker=$($cfg.worker), interval=${IntervalSeconds}s, cli=$cliLabel)"

  $backoffSec = $IntervalSeconds
  $consecutiveErrors = 0

  while ($true) {
    try {
      $token = Load-McpToken
      $script:UsageToken = $token
      $script:UsageBaseUrl = $cfg.hubBaseUrl
      $headers = @{
        Authorization = "Bearer $token"
        Accept        = 'application/json'
      }
      $resp = Invoke-Utf8JsonGet -Uri $pollUrl -Headers $headers
      $consecutiveErrors = 0
      $backoffSec = $IntervalSeconds

      $reqs = @()
      if ($resp -and $resp.requests) { $reqs = @($resp.requests) }
      $openReqs = @($reqs | Where-Object { $_.status -eq 'open' })

      $state = Load-State
      $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      $dedupMs = [int64]$DedupMinutes * 60 * 1000

      # Prune entries older than 6 hours
      foreach ($k in @($state.Keys)) {
        if (($nowMs - $state[$k]) -gt (6L * 3600L * 1000L)) { $state.Remove($k) }
      }

      $actionable = @($openReqs | Where-Object {
        $last = if ($state.ContainsKey($_.id)) { $state[$_.id] } else { 0L }
        ($last -eq 0L) -or (($nowMs - $last) -ge $dedupMs)
      })

      if ($CheckOnce) {
        [PSCustomObject]@{
          ok              = $true
          worker          = $cfg.worker
          agyCliPath      = $agyExe
          openCount       = $openReqs.Count
          actionableCount = $actionable.Count
          routing         = if ($resp.routing) { "$($resp.routing.label) ($($resp.routing.why))" } else { '' }
          codeWorkflow    = if ($resp.routing -and $resp.routing.codeWorkflow) { [string]$resp.routing.codeWorkflow } else { 'single' }
          actionableIds   = @($actionable | ForEach-Object { $_.id })
        } | ConvertTo-Json -Depth 4
        break
      }

      if ($actionable.Count -gt 0) {
        $ids = @($actionable | ForEach-Object { [string]$_.id })
        foreach ($id in $ids) { $state[$id] = $nowMs }
        Save-State $state

        if (-not $agyExe -or -not (Test-Path $agyExe)) {
          $agyExe = Resolve-AgyCliPath
        }
        if (-not $agyExe) {
          Write-Log "ALERT: open request(s) [$($ids -join ', ')] found, but agy.exe not installed! Run: irm https://antigravity.google/cli/install.ps1 | iex"
        } else {
          Invoke-AgyRun -AgyExe $agyExe -WorkDir $cfg.workDir -Requests $actionable -Cfg $cfg
        }
      }
    } catch {
      $consecutiveErrors++
      $mult = [Math]::Pow(2, [Math]::Min($consecutiveErrors - 1, 4))
      $backoffSec = [Math]::Min(600, [int]($IntervalSeconds * $mult))
      Write-Log "Poll error (#$consecutiveErrors): $($_.Exception.Message) -- retry in ${backoffSec}s"
      if ($CheckOnce) {
        Write-Error $_.Exception.Message
        exit 1
      }
    }

    Start-Sleep -Seconds $backoffSec
  }
} finally {
  if ($mutex) {
    try { $mutex.ReleaseMutex() } catch { }
    $mutex.Dispose()
  }
}
