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
    return [PSCustomObject]@{ TimedOut = $true; ExitCode = -1; Stderr = '' }
  }

  $errText = ''
  try { $errText = $errTask.GetAwaiter().GetResult() } catch { }
  return [PSCustomObject]@{ TimedOut = $false; ExitCode = $proc.ExitCode; Stderr = $errText }
}

function Invoke-AgyRun([string]$AgyExe, [string]$WorkDir, [object[]]$Requests, [object]$Cfg) {
  if (-not (Test-Path $WorkDir)) { New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null }

  $ids = @($Requests | ForEach-Object { [string]$_.id })
  $idList = $ids -join ', '
  $modelSlug = Select-ModelForRequests -Cfg $Cfg -Requests $Requests

  # Pure ASCII prompt avoids Windows PowerShell 5.1 UTF-8-without-BOM encoding issues;
  # agy.exe reads the Korean ceo-outsourcing SKILL.md and repo AGENTS.md directly in UTF-8.
  $prompt = "Use the ceo-outsourcing skill to process open CEO Office outsourcing requests assigned to worker antigravity (detected: $idList). Follow Carbon > Neon > Hydrogen model delegation from SKILL.md. For any code task, follow the mandatory 4-step loop: (1) read repo AGENTS.md and docs/ARCHITECTURE.md plus all affected files/callers, and sync latest origin/main via git fetch origin; (2) branch from origin/main as out/<REQ-ID> (or checkout the existing PR branch for agy_rework), make minimal focused edits, and NEVER push directly to main or edit data/db.json/.env/.github; (3) run repo tests (npm test, or npm test && npm run build && npm run verify) until 100% passing; (4) before opening/updating PR, run git fetch origin && git merge origin/main, re-run tests, and self-review git diff origin/main...HEAD for regressions or cache-busting. Include changed files, test output, and review notes in the PR body and submit via submit_outsourcing_result (or request_ceo_action / pass_outsourcing_request if blocked). If no open requests remain, exit briefly."

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
