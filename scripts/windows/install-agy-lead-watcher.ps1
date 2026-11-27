#Requires -Version 5.1
<#
  CEO Hub <-> Local Antigravity (agy) Daytime Team Lead Watcher Installer
  - Reuses existing DPAPI token from %LOCALAPPDATA%\CeoHubAgyWatcher\mcp-token.dpapi (prompts only if absent)
  - Installs scripts/windows/ceo-hub-agy-lead-watcher.ps1 into %LOCALAPPDATA%\CeoHubAgyLeadWatcher\
  - Registers hidden Windows Scheduled Task (CeoHubAgyLeadWatcher) at logon (replaces existing)
  - Starts the watcher immediately and runs -CheckOnce to verify onDuty=agy_lead
  - Supports -CheckOnce to run a 1-shot connectivity/status check without reinstalling
#>
param(
  [string]$HubBaseUrl = 'https://ai-ceo-hub.onrender.com',
  [string]$LeadModel = '',
  [switch]$CheckOnce,
  [switch]$UpdateOnly
)

$ErrorActionPreference = 'Stop'

$BaseDir          = Join-Path $env:LOCALAPPDATA 'CeoHubAgyLeadWatcher'
$CodingBaseDir    = Join-Path $env:LOCALAPPDATA 'CeoHubAgyWatcher'
$SharedTokenFile  = Join-Path $CodingBaseDir 'mcp-token.dpapi'
$ConfigFile       = Join-Path $BaseDir 'config.json'
$WatcherDst       = Join-Path $BaseDir 'ceo-hub-agy-lead-watcher.ps1'
$LaunchVbs        = Join-Path $BaseDir 'launch-hidden.vbs'
$TaskName         = 'CeoHubAgyLeadWatcher'

if ($CheckOnce) {
  if (-not (Test-Path $WatcherDst)) {
    throw "Lead watcher is not installed yet: $WatcherDst (run without -CheckOnce first)"
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WatcherDst -CheckOnce
  return
}

Write-Host ''
if ($UpdateOnly) {
  Write-Host '=== CEO Hub <-> AGY 주간 팀장 감시기 업데이트 ===' -ForegroundColor Cyan
} else {
  Write-Host '=== CEO Hub <-> AGY 주간 팀장 감시기 설치 (팀장 업무함) ===' -ForegroundColor Cyan
}

# 1. Detect Antigravity CLI (agy.exe)
$agyCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'),
  (Join-Path $env:USERPROFILE '.local\bin\agy.exe')
)
$agyExe = $agyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $agyExe) {
  $cmd = Get-Command 'agy.exe' -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and ($cmd.Source -notmatch 'Antigravity\.exe$')) { $agyExe = $cmd.Source }
}

if ($agyExe) {
  Write-Host "[확인] Antigravity CLI 경로: $agyExe" -ForegroundColor Green
} else {
  Write-Host '[경고] agy.exe를 찾지 못했습니다. 설치 후 자동 인식됩니다: irm https://antigravity.google/cli/install.ps1 | iex' -ForegroundColor Yellow
}

# 2. Reuse existing DPAPI MCP token from CeoHubAgyWatcher (prompt only if missing)
New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
if (Test-Path $SharedTokenFile) {
  Write-Host "[유지] 기존 DPAPI 토큰 재사용: $SharedTokenFile" -ForegroundColor Green
} else {
  New-Item -ItemType Directory -Path $CodingBaseDir -Force | Out-Null
  $secToken = Read-Host 'CEO Office MCP 토큰을 입력하세요 (화면 미표시 · Windows DPAPI 암호화 저장)' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secToken)
  $plainToken = ''
  try {
    $plainToken = ([Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)).Trim()
    $plainToken = $plainToken -replace '^Bearer\s+', ''
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  if ([string]::IsNullOrWhiteSpace($plainToken)) {
    throw 'MCP 토큰이 비어 있습니다.'
  }
  $secClean = ConvertTo-SecureString $plainToken -AsPlainText -Force
  $dpapiText = ConvertFrom-SecureString $secClean
  Set-Content -Path $SharedTokenFile -Value $dpapiText -Encoding UTF8
  $plainToken = ''
  Write-Host "[완료] DPAPI 암호화 토큰 저장: $SharedTokenFile" -ForegroundColor Green
}

# 3. Stop any existing lead watcher process cleanly before updating
try {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*ceo-hub-agy-lead-watcher.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }

# 4. Install/update ceo-hub-agy-lead-watcher.ps1
$localSource = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'ceo-hub-agy-lead-watcher.ps1' } else { '' }
if ($localSource -and (Test-Path $localSource)) {
  Copy-Item -Path $localSource -Destination $WatcherDst -Force
} else {
  $rawUrl = 'https://raw.githubusercontent.com/alpinu83/ai-ceo-hub/main/scripts/windows/ceo-hub-agy-lead-watcher.ps1'
  Invoke-WebRequest -Uri $rawUrl -OutFile $WatcherDst -UseBasicParsing
}
Write-Host "[완료] 팀장 감시 스크립트 설치: $WatcherDst" -ForegroundColor Green

# 5. Write/preserve config.json (default Hydrogen slug; fallback to default model if rejected)
$resolvedModel = 'gemini-4-hydrogen'
$resolvedHub = $HubBaseUrl.TrimEnd('/')
$resolvedTokenFile = $SharedTokenFile

if (Test-Path $ConfigFile) {
  try {
    $prev = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($prev.hubBaseUrl -and $UpdateOnly) { $resolvedHub = ([string]$prev.hubBaseUrl).TrimEnd('/') }
    if ($prev.PSObject.Properties.Name -contains 'leadModel') { $resolvedModel = [string]$prev.leadModel }
    if ($prev.tokenFile) { $resolvedTokenFile = [string]$prev.tokenFile }
  } catch { }
}
if (-not [string]::IsNullOrWhiteSpace($LeadModel)) {
  $resolvedModel = $LeadModel.Trim()
}

$cfgObj = @{
  hubBaseUrl = $resolvedHub
  worker     = 'agy_lead'
  agyCliPath = $(if ($agyExe) { $agyExe } else { '' })
  leadModel  = $resolvedModel
  tokenFile  = $resolvedTokenFile
} | ConvertTo-Json -Depth 4
Set-Content -Path $ConfigFile -Value $cfgObj -Encoding UTF8
Write-Host "[완료] 설정 저장: $ConfigFile (leadModel=$resolvedModel)" -ForegroundColor Green

# 6. Create truly hidden launcher (.vbs) and register/replace logon Scheduled Task
$vbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$WatcherDst""", 0, False
"@
Set-Content -Path $LaunchVbs -Value $vbs -Encoding ASCII

$taskRegistered = $false
try {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$LaunchVbs`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'CEO Hub AGY Daytime Team Lead Watcher (30s poll)' -Force | Out-Null
  $taskRegistered = $true
  Write-Host "[완료] 예약 작업 등록(로그온 시 숨김 실행): $TaskName" -ForegroundColor Green
} catch {
  Write-Host "[안내] Register-ScheduledTask 권한 제한($($_.Exception.Message)) -- schtasks로 재시도" -ForegroundColor Yellow
  try {
    & schtasks.exe /Create /F /SC ONLOGON /TN $TaskName /TR "wscript.exe `"$LaunchVbs`"" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $taskRegistered = $true
      Write-Host "[완료] 예약 작업 등록(schtasks): $TaskName" -ForegroundColor Green
    }
  } catch { }
}

if (-not $taskRegistered) {
  $startupVbs = Join-Path ([Environment]::GetFolderPath('Startup')) 'CeoHubAgyLeadWatcher.vbs'
  Copy-Item -Path $LaunchVbs -Destination $startupVbs -Force
  Write-Host "[완료] 시작프로그램 폴더로 대체 등록: $startupVbs" -ForegroundColor Green
}

# 7. Live 1-shot check + launch background watcher immediately
Write-Host ''
Write-Host '=== 라이브 연결 테스트 (-CheckOnce) ===' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WatcherDst -CheckOnce

if ($taskRegistered) {
  try {
    Start-ScheduledTask -TaskName $TaskName
  } catch {
    Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$LaunchVbs`""
  }
} else {
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$LaunchVbs`""
}

Write-Host ''
Write-Host '[완료] AGY 주간 팀장 감시기가 백그라운드에서 실행 중입니다! (30초 폴링 · 건당 5분 제한 · AI 비용 대기 시 0원)' -ForegroundColor Green
Write-Host "모델 슬러그 변경: `"$ConfigFile`"의 leadModel 수정 (거부 시 기본 모델 자동 폴백)" -ForegroundColor Gray
Write-Host "상태 재확인: powershell -NoProfile -ExecutionPolicy Bypass -File `"$WatcherDst`" -CheckOnce" -ForegroundColor Gray
Write-Host "로그 확인: Get-Content `"$BaseDir\watcher.log`" -Tail 20 -Wait" -ForegroundColor Gray
