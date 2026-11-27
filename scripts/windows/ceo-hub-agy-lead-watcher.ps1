#Requires -Version 5.1
<#
  CEO Hub <-> Local Antigravity (agy) Daytime Team Lead Watcher (Lead Desk)
  - Polls GET /api/lead-jobs?worker=agy_lead every 30s (pure HTTP, 0 AI cost; poll itself keeps 3-min onDuty signal)
  - Separate from coding watcher: uses Local\CeoHubAgyLeadWatcherMutex and %LOCALAPPDATA%\CeoHubAgyLeadWatcher
  - Reuses existing Windows DPAPI token from %LOCALAPPDATA%\CeoHubAgyWatcher\mcp-token.dpapi
  - Processes open lead jobs oldest-first, 1 at a time:
      claim -> save packet to empty temp dir (lead-job.md) -> run agy CLI (Hydrogen model, 5-min cap)
      -> extract JSON from stdout (1 retry on extraction failure) -> submit JSON
  - Never edits repository files; never logs tokens or packet contents
#>
param(
  [switch]$CheckOnce,
  [int]$IntervalSeconds = 30,
  [int]$MaxJobMinutes = 5
)

$ErrorActionPreference = 'Stop'

$BaseDir          = Join-Path $env:LOCALAPPDATA 'CeoHubAgyLeadWatcher'
$DefaultTokenFile = Join-Path $env:LOCALAPPDATA 'CeoHubAgyWatcher\mcp-token.dpapi'
$ConfigFile       = Join-Path $BaseDir 'config.json'
$StateFile        = Join-Path $BaseDir 'watcher-state.json'
$LogFile          = Join-Path $BaseDir 'watcher.log'

if (-not (Test-Path $BaseDir)) { New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null }

function Write-Log([string]$Message) {
  $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "[$ts] $Message"
  try {
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
    worker     = 'agy_lead'
    agyCliPath = ''
    leadModel  = 'gemini-4-hydrogen'
    tokenFile  = $DefaultTokenFile
  }
  if (Test-Path $ConfigFile) {
    try {
      $loaded = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($loaded.hubBaseUrl) { $defaults.hubBaseUrl = [string]$loaded.hubBaseUrl }
      if ($loaded.worker)     { $defaults.worker     = [string]$loaded.worker }
      if ($loaded.agyCliPath) { $defaults.agyCliPath = [string]$loaded.agyCliPath }
      if ($loaded.PSObject.Properties.Name -contains 'leadModel') {
        $defaults.leadModel = [string]$loaded.leadModel
      }
      if ($loaded.tokenFile)  { $defaults.tokenFile  = [string]$loaded.tokenFile }
    } catch { }
  }
  return $defaults
}

function Load-McpToken([string]$TokenPath) {
  $path = if ($TokenPath) { $TokenPath } else { $DefaultTokenFile }
  if (-not (Test-Path $path)) {
    throw "DPAPI token file not found: $path (run install-agy-watcher.ps1 or install-agy-lead-watcher.ps1 first)"
  }
  $enc = (Get-Content -Path $path -Raw -Encoding UTF8).Trim()
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
      if ($obj -and $obj.failedAt) {
        foreach ($p in $obj.failedAt.PSObject.Properties) {
          $map[$p.Name] = [int64]$p.Value
        }
      }
    } catch { }
  }
  return $map
}

function Save-State([hashtable]$FailedMap) {
  $payload = @{ failedAt = $FailedMap } | ConvertTo-Json -Depth 4
  Set-Content -Path $StateFile -Value $payload -Encoding UTF8
}

function Invoke-Utf8JsonRequest([string]$Method, [string]$Uri, [hashtable]$Headers, [string]$BodyJson = '') {
  $req = [System.Net.HttpWebRequest]::Create($Uri)
  $req.Method = $Method
  $req.Timeout = 15000
  $req.ReadWriteTimeout = 15000
  foreach ($k in $Headers.Keys) {
    if ($k -eq 'Accept') { $req.Accept = $Headers[$k] }
    elseif ($k -eq 'Content-Type') { $req.ContentType = $Headers[$k] }
    else { $req.Headers.Add($k, $Headers[$k]) }
  }
  if ($Method -ne 'GET' -and $Method -ne 'HEAD') {
    if (-not $req.ContentType) { $req.ContentType = 'application/json; charset=utf-8' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($BodyJson)
    $req.ContentLength = $bytes.Length
    $reqStream = $req.GetRequestStream()
    try {
      $reqStream.Write($bytes, 0, $bytes.Length)
    } finally {
      $reqStream.Dispose()
    }
  }
  try {
    $res = $req.GetResponse()
    try {
      $statusCode = [int]$res.StatusCode
      $reader = New-Object System.IO.StreamReader($res.GetResponseStream(), [System.Text.Encoding]::UTF8)
      try {
        $raw = $reader.ReadToEnd()
        $parsed = $null
        if ($raw) {
          try { $parsed = ($raw | ConvertFrom-Json) } catch { }
        }
        return [PSCustomObject]@{ Ok = $true; Status = $statusCode; Data = $parsed; Error = '' }
      } finally {
        $reader.Dispose()
      }
    } finally {
      $res.Close()
    }
  } catch [System.Net.WebException] {
    $statusCode = 0
    $errMsg = $_.Exception.Message
    if ($_.Exception.Response) {
      try {
        $httpRes = $_.Exception.Response
        $statusCode = [int]$httpRes.StatusCode
        $reader = New-Object System.IO.StreamReader($httpRes.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try {
          $rawErr = $reader.ReadToEnd()
          if ($rawErr) {
            try {
              $errObj = $rawErr | ConvertFrom-Json
              if ($errObj -and $errObj.error) { $errMsg = [string]$errObj.error }
            } catch { }
          }
        } finally {
          $reader.Dispose()
        }
      } catch { }
    }
    return [PSCustomObject]@{ Ok = $false; Status = $statusCode; Data = $null; Error = $errMsg }
  }
}

function Test-JsonObjectText([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) { return $false }
  $trimmed = $Candidate.Trim()
  if (-not ($trimmed.StartsWith('{') -and $trimmed.EndsWith('}'))) { return $false }
  try {
    $obj = $trimmed | ConvertFrom-Json
    if ($null -eq $obj) { return $false }
    return ($obj -is [PSCustomObject])
  } catch {
    return $false
  }
}

function Extract-JsonObjectText([string]$RawText) {
  if ([string]::IsNullOrWhiteSpace($RawText)) { return '' }
  # Strip ANSI color sequences if present (PS 5.1 compatible \x1b regex)
  $clean = [System.Text.RegularExpressions.Regex]::Replace($RawText, '\x1b\[[0-9;]*[A-Za-z]', '')
  $clean = $clean.Trim()

  # 1. Try fenced ```json ... ``` blocks (prefer the last valid JSON object block)
  $fenceMatches = [System.Text.RegularExpressions.Regex]::Matches(
    $clean,
    '```(?:json)?\s*([\s\S]*?)```',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if ($fenceMatches.Count -gt 0) {
    for ($i = $fenceMatches.Count - 1; $i -ge 0; $i--) {
      $inner = $fenceMatches[$i].Groups[1].Value.Trim()
      if (Test-JsonObjectText $inner) { return $inner }
    }
  }

  # 2. Try entire output directly
  if (Test-JsonObjectText $clean) { return $clean }

  # 3. Scan balanced top-level { ... } substrings (prefer the last valid JSON object)
  $candidates = New-Object System.Collections.Generic.List[string]
  $depth = 0
  $startIdx = -1
  $inStr = $false
  $escape = $false
  for ($i = 0; $i -lt $clean.Length; $i++) {
    $ch = $clean[$i]
    if ($inStr) {
      if ($escape) { $escape = $false }
      elseif ($ch -eq '\') { $escape = $true }
      elseif ($ch -eq '"') { $inStr = $false }
      continue
    }
    if ($ch -eq '"') {
      $inStr = $true
      continue
    }
    if ($ch -eq '{') {
      if ($depth -eq 0) { $startIdx = $i }
      $depth++
    } elseif ($ch -eq '}') {
      if ($depth -gt 0) {
        $depth--
        if ($depth -eq 0 -and $startIdx -ge 0) {
          $candidates.Add($clean.Substring($startIdx, $i - $startIdx + 1))
          $startIdx = -1
        }
      }
    }
  }
  for ($i = $candidates.Count - 1; $i -ge 0; $i--) {
    if (Test-JsonObjectText $candidates[$i]) { return $candidates[$i].Trim() }
  }

  # 4. Last-resort slice from first '{' to last '}'
  $first = $clean.IndexOf('{')
  $last = $clean.LastIndexOf('}')
  if ($first -ge 0 -and $last -gt $first) {
    $slice = $clean.Substring($first, $last - $first + 1).Trim()
    if (Test-JsonObjectText $slice) { return $slice }
  }
  return ''
}

function Start-AgyLeadProcess([string]$AgyExe, [string]$WorkDir, [string]$Arguments, [int]$TimeoutMs, [string]$JobId) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $AgyExe
  $psi.WorkingDirectory = $WorkDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  $psi.Arguments = $Arguments

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  [void]$proc.Start()

  $outTask = $proc.StandardOutput.ReadToEndAsync()
  $errTask = $proc.StandardError.ReadToEndAsync()
  $finished = $proc.WaitForExit($TimeoutMs)

  if (-not $finished) {
    Write-Log "TIMEOUT reached for job=$JobId -- terminating agy PID $($proc.Id)"
    try { & taskkill /PID $proc.Id /T /F 2>$null | Out-Null } catch { }
    try { $proc.Kill() } catch { }
    return [PSCustomObject]@{ TimedOut = $true; ExitCode = -1; Stdout = ''; Stderr = '' }
  }

  $stdout = ''
  $stderr = ''
  try { $stdout = $outTask.GetAwaiter().GetResult() } catch { }
  try { $stderr = $errTask.GetAwaiter().GetResult() } catch { }
  return [PSCustomObject]@{ TimedOut = $false; ExitCode = $proc.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

function Invoke-AgyLeadJob([string]$AgyExe, [string]$JobId, [string]$PacketText, [string]$LeadModel, [int]$BudgetMinutes) {
  $tempRoot = Join-Path $env:TEMP ("ceo-lead-job-$JobId-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  $packetFile = Join-Path $tempRoot 'lead-job.md'
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($packetFile, $PacketText, $utf8NoBom)

  $deadline = [DateTimeOffset]::UtcNow.AddMinutes($BudgetMinutes)
  $modelRejected = $false
  $activeModel = if ($LeadModel) { $LeadModel.Trim() } else { '' }

  try {
    # Pure ASCII prompts avoid PS 5.1 encoding pitfalls; agy reads UTF-8 lead-job.md directly
    $prompts = @(
      'Read the file lead-job.md in the current folder. You are the team lead. Output ONLY one valid JSON object that follows the exact answer format in lead-job.md. Do not edit, create, or delete any files.',
      'Read lead-job.md in the current folder. Output ONLY one raw valid JSON object starting with { and ending with } matching the answer format keys in lead-job.md, with no markdown fences or extra text. Do not edit any files.'
    )

    for ($attempt = 0; $attempt -lt $prompts.Count; $attempt++) {
      $remainMs = [int]([Math]::Floor(($deadline - [DateTimeOffset]::UtcNow).TotalMilliseconds))
      if ($remainMs -lt 5000) {
        Write-Log "job=$JobId skipped attempt=$($attempt + 1) (budget exhausted)"
        return [PSCustomObject]@{ Ok = $false; TimedOut = $true; JsonText = ''; Reason = 'timeout' }
      }

      $escapedPrompt = $prompts[$attempt].Replace('"', '\"')
      $baseArgs = "-p `"$escapedPrompt`" --mode=auto"
      $useModel = ($activeModel -and (-not $modelRejected))
      $runArgs = if ($useModel) { "$baseArgs --model `"$activeModel`"" } else { $baseArgs }

      Write-Log "job=$JobId attempt=$($attempt + 1) launching agy (model=$(if ($useModel) { $activeModel } else { 'default' }))"
      $res = Start-AgyLeadProcess -AgyExe $AgyExe -WorkDir $tempRoot -Arguments $runArgs -TimeoutMs $remainMs -JobId $JobId

      if ($res.TimedOut) {
        return [PSCustomObject]@{ Ok = $false; TimedOut = $true; JsonText = ''; Reason = 'timeout' }
      }

      # Safe fallback: if --model flag was rejected by CLI, retry once with default model
      if ($useModel -and ($res.ExitCode -ne 0) -and (($res.Stderr -match 'model|unknown|invalid|flag|unsupported|not found') -or [string]::IsNullOrWhiteSpace($res.Stdout))) {
        $modelRejected = $true
        $remainRetryMs = [int]([Math]::Floor(($deadline - [DateTimeOffset]::UtcNow).TotalMilliseconds))
        if ($remainRetryMs -ge 5000) {
          Write-Log "job=$JobId model flag '$activeModel' rejected (exit=$($res.ExitCode)); retrying with default model"
          $res = Start-AgyLeadProcess -AgyExe $AgyExe -WorkDir $tempRoot -Arguments $baseArgs -TimeoutMs $remainRetryMs -JobId $JobId
          if ($res.TimedOut) {
            return [PSCustomObject]@{ Ok = $false; TimedOut = $true; JsonText = ''; Reason = 'timeout' }
          }
        }
      }

      $jsonText = Extract-JsonObjectText -RawText $res.Stdout
      if ($jsonText) {
        return [PSCustomObject]@{ Ok = $true; TimedOut = $false; JsonText = $jsonText; Reason = 'ok' }
      }
      Write-Log "job=$JobId attempt=$($attempt + 1) JSON extraction failed (exit=$($res.ExitCode))"
    }

    return [PSCustomObject]@{ Ok = $false; TimedOut = $false; JsonText = ''; Reason = 'json_extract_failed' }
  } finally {
    try {
      if (Test-Path $tempRoot) { Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
    } catch { }
  }
}

# Single-instance guard (skip when -CheckOnce)
$mutex = $null
if (-not $CheckOnce) {
  $createdNew = $false
  $mutex = New-Object System.Threading.Mutex($true, 'Local\CeoHubAgyLeadWatcherMutex', [ref]$createdNew)
  if (-not $createdNew) {
    Write-Log 'Another CeoHubAgyLeadWatcher instance is already running. Exiting.'
    exit 0
  }
}

try {
  $cfg = Load-Config
  $agyExe = if ($cfg.agyCliPath -and (Test-Path $cfg.agyCliPath)) { $cfg.agyCliPath } else { Resolve-AgyCliPath }
  $baseUrl = $cfg.hubBaseUrl.TrimEnd('/')
  $pollUrl = "$baseUrl/api/lead-jobs?worker=$([uri]::EscapeDataString($cfg.worker))"
  $cliLabel = if ($agyExe) { $agyExe } else { 'NOT_FOUND' }
  $modelLabel = if ($cfg.leadModel) { $cfg.leadModel } else { 'default' }

  Write-Log "Lead watcher started (worker=$($cfg.worker), interval=${IntervalSeconds}s, cap=${MaxJobMinutes}m, model=$modelLabel, cli=$cliLabel)"

  $backoffSec = $IntervalSeconds
  $consecutiveErrors = 0
  $failCooldownMs = 3L * 60L * 1000L

  while ($true) {
    $processedJob = $false
    try {
      $token = Load-McpToken -TokenPath $cfg.tokenFile
      $headers = @{
        Authorization = "Bearer $token"
        Accept        = 'application/json'
      }
      $pollRes = Invoke-Utf8JsonRequest -Method 'GET' -Uri $pollUrl -Headers $headers
      if (-not $pollRes.Ok) {
        throw "GET /api/lead-jobs failed (HTTP $($pollRes.Status)): $($pollRes.Error)"
      }

      $consecutiveErrors = 0
      $backoffSec = $IntervalSeconds

      $resp = $pollRes.Data
      $jobs = @()
      if ($resp -and $resp.jobs) { $jobs = @($resp.jobs) }
      $openJobs = @($jobs | Where-Object { $_.status -eq 'open' } | Sort-Object { $_.createdAt })

      if ($CheckOnce) {
        $onDuty = if ($resp.status -and $resp.status.onDuty) { [string]$resp.status.onDuty } else { '' }
        $onDutyLabel = if ($resp.status -and $resp.status.onDutyLabel) { [string]$resp.status.onDutyLabel } else { '' }
        [PSCustomObject]@{
          ok          = $true
          worker      = $cfg.worker
          onDuty      = $onDuty
          onDutyLabel = $onDutyLabel
          count       = $openJobs.Count
          agyCliPath  = $agyExe
          leadModel   = $modelLabel
          jobIds      = @($openJobs | ForEach-Object { $_.id })
        } | ConvertTo-Json -Depth 4
        break
      }

      if ($openJobs.Count -gt 0) {
        $state = Load-State
        $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        foreach ($k in @($state.Keys)) {
          if (($nowMs - $state[$k]) -gt (2L * 3600L * 1000L)) { $state.Remove($k) }
        }

        $targetJob = $null
        foreach ($j in $openJobs) {
          $lastFail = if ($state.ContainsKey($j.id)) { $state[$j.id] } else { 0L }
          if (($lastFail -eq 0L) -or (($nowMs - $lastFail) -ge $failCooldownMs)) {
            $targetJob = $j
            break
          }
        }

        if ($null -ne $targetJob) {
          $jobId = [string]$targetJob.id
          $purpose = [string]$targetJob.purpose

          if (-not $agyExe -or -not (Test-Path $agyExe)) { $agyExe = Resolve-AgyCliPath }
          if (-not $agyExe) {
            Write-Log "ALERT: job=$jobId waiting but agy.exe not found"
          } else {
            $workerEsc = ($cfg.worker -replace '\\', '\\' -replace '"', '\"')
            $claimUrl = "$baseUrl/api/lead-jobs/$([uri]::EscapeDataString($jobId))/claim"
            $claimRes = Invoke-Utf8JsonRequest -Method 'POST' -Uri $claimUrl -Headers $headers -BodyJson ('{"worker":"' + $workerEsc + '"}')

            if (-not $claimRes.Ok) {
              if ($claimRes.Status -eq 409) {
                Write-Log "job=$jobId already claimed by another lead (HTTP 409) -- skipping"
              } else {
                Write-Log "job=$jobId claim failed (HTTP $($claimRes.Status))"
                $state[$jobId] = $nowMs
                Save-State $state
              }
            } else {
              $processedJob = $true
              $packet = if ($claimRes.Data -and $claimRes.Data.packet) { [string]$claimRes.Data.packet } else { '' }
              if ([string]::IsNullOrWhiteSpace($packet)) {
                Write-Log "job=$jobId empty packet after claim -- skipping"
                $state[$jobId] = $nowMs
                Save-State $state
              } else {
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $run = Invoke-AgyLeadJob -AgyExe $agyExe -JobId $jobId -PacketText $packet -LeadModel $cfg.leadModel -BudgetMinutes $MaxJobMinutes
                $sw.Stop()
                $elapsedSec = [Math]::Round($sw.Elapsed.TotalSeconds, 1)

                if ($run.Ok) {
                  $submitUrl = "$baseUrl/api/lead-jobs/$([uri]::EscapeDataString($jobId))/submit"
                  $submitBody = '{"worker":"' + $workerEsc + '","result":' + $run.JsonText + '}'
                  $subRes = Invoke-Utf8JsonRequest -Method 'POST' -Uri $submitUrl -Headers $headers -BodyJson $submitBody
                  if ($subRes.Ok) {
                    Write-Log "job=$jobId purpose=$purpose submitted OK (${elapsedSec}s, HTTP $($subRes.Status))"
                    if ($state.ContainsKey($jobId)) {
                      $state.Remove($jobId)
                      Save-State $state
                    }
                  } elseif ($subRes.Status -eq 409) {
                    Write-Log "job=$jobId submit skipped (HTTP 409 -- already finished)"
                  } elseif ($subRes.Status -eq 400) {
                    Write-Log "job=$jobId submit rejected (HTTP 400 format error, ${elapsedSec}s)"
                    $state[$jobId] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    Save-State $state
                  } else {
                    Write-Log "job=$jobId submit failed (HTTP $($subRes.Status), ${elapsedSec}s)"
                    $state[$jobId] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                    Save-State $state
                  }
                } else {
                  Write-Log "job=$jobId purpose=$purpose not submitted (reason=$($run.Reason), ${elapsedSec}s)"
                  $state[$jobId] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                  Save-State $state
                }
              }
            }
          }
        }
      }
    } catch {
      $consecutiveErrors++
      $mult = [Math]::Pow(2, [Math]::Min($consecutiveErrors - 1, 4))
      $backoffSec = [Math]::Min(300, [int]($IntervalSeconds * $mult))
      Write-Log "Poll error (#$consecutiveErrors): $($_.Exception.Message) -- retry in ${backoffSec}s"
      if ($CheckOnce) {
        Write-Error $_.Exception.Message
        exit 1
      }
    }

    # If a job was just processed and more might be waiting, re-poll quickly (2s); otherwise wait full interval
    if ($processedJob) {
      Start-Sleep -Seconds 2
    } else {
      Start-Sleep -Seconds $backoffSec
    }
  }
} finally {
  if ($mutex) {
    try { $mutex.ReleaseMutex() } catch { }
    $mutex.Dispose()
  }
}
