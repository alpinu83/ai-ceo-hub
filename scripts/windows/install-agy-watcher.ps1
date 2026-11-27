#Requires -Version 5.1
<#
  CEO Hub <-> Local Antigravity (agy) One-Click Windows Installer & Updater
  - Parity with Aside's %LOCALAPPDATA%\CeoHubWatcher setup:
    1) Verifies (or guides installing) Antigravity CLI (%LOCALAPPDATA%\agy\bin\agy.exe)
    2) Encrypts CEO Hub MCP token with Windows DPAPI (CurrentUser scope; -UpdateOnly reuses existing token)
    3) Registers "ceo-office" MCP server in %USERPROFILE%\.gemini\config\mcp_config.json (preserving existing servers)
    4) Installs upgraded ceo-outsourcing SKILL.md into %USERPROFILE%\.gemini\config\skills\ceo-outsourcing\SKILL.md
    5) Installs ceo-hub-agy-watcher.ps1 to %LOCALAPPDATA%\CeoHubAgyWatcher\ and preserves config.json model overrides
    6) Registers hidden background Startup launcher in Windows Startup folder
    7) Restarts running watcher cleanly, runs a live 1-shot connectivity check, and launches the background watcher
#>
param(
  [string]$HubBaseUrl = 'https://ai-ceo-hub.onrender.com',
  [string]$WorkDir = (Join-Path $env:USERPROFILE 'ceo-hub-work'),
  [switch]$UpdateOnly
)

$ErrorActionPreference = 'Stop'

$BaseDir    = Join-Path $env:LOCALAPPDATA 'CeoHubAgyWatcher'
$TokenFile  = Join-Path $BaseDir 'mcp-token.dpapi'
$ConfigFile = Join-Path $BaseDir 'config.json'
$WatcherDst = Join-Path $BaseDir 'ceo-hub-agy-watcher.ps1'

$GeminiCfgDir = Join-Path $env:USERPROFILE '.gemini\config'
$McpCfgPath   = Join-Path $GeminiCfgDir 'mcp_config.json'
$SkillDir     = Join-Path $GeminiCfgDir 'skills\ceo-outsourcing'
$SkillPath    = Join-Path $SkillDir 'SKILL.md'

$StartupDir   = [Environment]::GetFolderPath('Startup')
$StartupVbs   = Join-Path $StartupDir 'CeoHubAgyWatcher.vbs'

Write-Host ''
if ($UpdateOnly) {
  Write-Host '=== CEO Hub <-> Antigravity (agy) 감시기 · 스킬 업데이트 ===' -ForegroundColor Cyan
} else {
  Write-Host '=== CEO Hub <-> Antigravity (agy) 실시간 감시 설치 ===' -ForegroundColor Cyan
}

# 1. Check Antigravity CLI (agy.exe)
$agyCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'),
  (Join-Path $env:USERPROFILE '.local\bin\agy.exe')
)
$agyExe = $agyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $agyExe) {
  $cmd = Get-Command 'agy.exe' -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and ($cmd.Source -notmatch 'Antigravity\.exe$')) { $agyExe = $cmd.Source }
}

if (-not $agyExe) {
  Write-Host '[안내] Antigravity CLI (agy.exe)가 아직 설치되어 있지 않습니다.' -ForegroundColor Yellow
  if (-not $UpdateOnly) {
    $ans = Read-Host '지금 공식 설치 명령(irm https://antigravity.google/cli/install.ps1 | iex)을 실행할까요? (Y/n)'
    if ($ans -eq '' -or $ans -match '^[Yy]') {
      Invoke-RestMethod 'https://antigravity.google/cli/install.ps1' | Invoke-Expression
      $agyExe = $agyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    }
  }
  if ($agyExe) {
    Write-Host "[완료] Antigravity CLI 확인: $agyExe" -ForegroundColor Green
    Write-Host '[참고] 처음 설치하셨다면 PowerShell에서 `agy`를 1회 실행해 Google 로그인을 완료해 주세요.' -ForegroundColor Yellow
  } else {
    Write-Host '[경고] agy.exe를 찾지 못했습니다. 감시기는 설치하되 agy 설치 후 자동 인식됩니다.' -ForegroundColor Yellow
  }
} else {
  Write-Host "[확인] Antigravity CLI 경로: $agyExe" -ForegroundColor Green
}

# 2. Prompt MCP token (or reuse existing DPAPI token when updating)
New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
$hasExistingToken = Test-Path $TokenFile
$needTokenPrompt = (-not $UpdateOnly) -or (-not $hasExistingToken)
$plainToken = ''

if ($needTokenPrompt) {
  $promptMsg = if ($hasExistingToken) {
    'CEO Office MCP 토큰을 입력하세요 (기존 토큰을 그대로 쓰려면 그냥 Enter)'
  } else {
    'CEO Office MCP 토큰을 입력하세요 (화면 미표시 · Windows DPAPI 암호화 저장)'
  }
  $secToken = Read-Host $promptMsg -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secToken)
  try {
    $plainToken = ([Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)).Trim()
    $plainToken = $plainToken -replace '^Bearer\s+', ''
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  if ([string]::IsNullOrWhiteSpace($plainToken)) {
    if ($hasExistingToken) {
      Write-Host "[유지] 기존 DPAPI 토큰 사용: $TokenFile" -ForegroundColor Green
    } else {
      throw 'MCP 토큰이 비어 있습니다.'
    }
  } else {
    $secClean = ConvertTo-SecureString $plainToken -AsPlainText -Force
    $dpapiText = ConvertFrom-SecureString $secClean
    Set-Content -Path $TokenFile -Value $dpapiText -Encoding UTF8
    Write-Host "[완료] DPAPI 암호화 토큰 저장: $TokenFile" -ForegroundColor Green
  }
} else {
  Write-Host "[유지] 기존 DPAPI 토큰 사용: $TokenFile" -ForegroundColor Green
}

# 3. Merge ceo-office MCP server into ~/.gemini/config/mcp_config.json (only when new token entered)
if (-not [string]::IsNullOrWhiteSpace($plainToken)) {
  New-Item -ItemType Directory -Path $GeminiCfgDir -Force | Out-Null
  $mcpRoot = @{ mcpServers = @{} }
  if (Test-Path $McpCfgPath) {
    try {
      $existing = Get-Content -Path $McpCfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($existing -and $existing.mcpServers) {
        foreach ($p in $existing.mcpServers.PSObject.Properties) {
          $mcpRoot.mcpServers[$p.Name] = $p.Value
        }
      }
    } catch { }
  }
  $mcpRoot.mcpServers['ceo-office'] = @{
    serverUrl = "$($HubBaseUrl.TrimEnd('/'))/api/mcp"
    headers   = @{ Authorization = "Bearer $plainToken" }
  }
  Set-Content -Path $McpCfgPath -Value ($mcpRoot | ConvertTo-Json -Depth 6) -Encoding UTF8
  $plainToken = '' # wipe from memory immediately
  Write-Host "[완료] MCP 서버 등록(기존 설정 유지): $McpCfgPath" -ForegroundColor Green
}

# 4. Install/update ceo-outsourcing SKILL.md
New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null
$localSkillSource = if ($PSScriptRoot) { Join-Path $PSScriptRoot '..\..\.agents\skills\ceo-outsourcing\SKILL.md' } else { '' }
if ($localSkillSource -and (Test-Path $localSkillSource)) {
  Copy-Item -Path $localSkillSource -Destination $SkillPath -Force
} else {
  try {
    $rawSkillUrl = 'https://raw.githubusercontent.com/alpinu83/ai-ceo-hub/main/.agents/skills/ceo-outsourcing/SKILL.md'
    Invoke-WebRequest -Uri $rawSkillUrl -OutFile $SkillPath -UseBasicParsing
  } catch {
    $skillContent = @'
---
name: ceo-outsourcing
description: CEO Office(ai-ceo-hub) 외주 창구에서 Antigravity에 배정된 요청(코드 수정, 외부 자문, 브라우저 작업, 리서치)을 가져와 처리하고 결과를 제출한다. "CEO Office 외주 처리", "외주 확인" 같은 요청에 사용.
---

# CEO Office 외주 처리 (Antigravity)

CEO Office(https://ai-ceo-hub.onrender.com)의 무료 AI 팀이 할 수 없어서 외부로 넘긴 일을 처리한다. MCP 서버 이름은 `ceo-office`.

## 모델 계층 (Carbon > Neon > Hydrogen)
- Carbon(최상위, 이 대화의 기본): 요청서 해석, 계획·설계, 위험 판단, 하위 결과 검토, PR 전 최종 리뷰, 제출 문서 작성
- Neon(중간): 여러 파일 구현, 원인 추적이 필요한 디버깅, 판단이 들어가는 분석 → Neon 하위 에이전트
- Hydrogen(하위): 자료 조사, 파일·코드 검색, 정해진 대로 하는 단순 수정, 테스트·빌드 실행, 문서 갱신 → Hydrogen 하위 에이전트(Orchestrator 실행 모델)

## 순서
1. `list_outsourcing_requests`를 worker "antigravity"로 호출한다. 없으면 "처리할 외주 없음"으로 끝낸다.
2. 한 건씩 `claim_outsourcing_request`(worker "antigravity")로 잡고 요청서를 끝까지 읽는다.
3. 코드 수정은 반드시 4단계 검증 루프를 따른다: (1) `git fetch origin` + `AGENTS.md`/`docs/ARCHITECTURE.md`/호출부 선행 읽기 (2) 최신 `origin/main` 기준 `out/<요청ID>` 브랜치(반려 재수정은 기존 PR 브랜치)로 최소 수정 · `main` 직접 push 금지 (3) `npm test`(또는 저장소 테스트·빌드) 100% 통과 (4) PR 직전 `git merge origin/main` + `git diff origin/main...HEAD` 자가 검수.
4. `submit_outsourcing_result`로 제출한다 (로그인·인증 등 대표님 개입 필요 시 `request_ceo_action`).
'@
    Set-Content -Path $SkillPath -Value $skillContent -Encoding UTF8
  }
}
Write-Host "[완료] 스킬 설치/갱신: $SkillPath" -ForegroundColor Green

# 5. Stop existing watcher instance cleanly before replacing script
try {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*ceo-hub-agy-watcher.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch { }

# 6. Install/update watcher script & preserve config.json overrides
$localSource = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'ceo-hub-agy-watcher.ps1' } else { '' }
if ($localSource -and (Test-Path $localSource)) {
  Copy-Item -Path $localSource -Destination $WatcherDst -Force
} else {
  $rawUrl = 'https://raw.githubusercontent.com/alpinu83/ai-ceo-hub/main/scripts/windows/ceo-hub-agy-watcher.ps1'
  Invoke-WebRequest -Uri $rawUrl -OutFile $WatcherDst -UseBasicParsing
}

$existingModels = @{ code = ''; deep = ''; light = '' }
if (Test-Path $ConfigFile) {
  try {
    $prev = Get-Content -Path $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($prev.hubBaseUrl -and $UpdateOnly) { $HubBaseUrl = [string]$prev.hubBaseUrl }
    if ($prev.workDir -and $UpdateOnly)    { $WorkDir    = [string]$prev.workDir }
    if ($prev.models) {
      if ($prev.models.code)  { $existingModels.code  = [string]$prev.models.code }
      if ($prev.models.deep)  { $existingModels.deep  = [string]$prev.models.deep }
      if ($prev.models.light) { $existingModels.light = [string]$prev.models.light }
    }
  } catch { }
}

$cfgObj = @{
  hubBaseUrl = $HubBaseUrl.TrimEnd('/')
  worker     = 'antigravity'
  workDir    = $WorkDir
  agyCliPath = $(if ($agyExe) { $agyExe } else { '' })
  models     = $existingModels
} | ConvertTo-Json -Depth 4
Set-Content -Path $ConfigFile -Value $cfgObj -Encoding UTF8
Write-Host "[완료] 감시 스크립트 설치/갱신: $WatcherDst" -ForegroundColor Green

# 7. Register hidden Windows Startup launcher (.vbs)
$vbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$WatcherDst""", 0, False
"@
Set-Content -Path $StartupVbs -Value $vbs -Encoding ASCII
Write-Host "[완료] Windows 시작프로그램 등록: $StartupVbs" -ForegroundColor Green

# 8. Live connectivity check + start watcher immediately
Write-Host ''
Write-Host '=== 라이브 연결 테스트 ===' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WatcherDst -CheckOnce

Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$StartupVbs`""
Write-Host ''
Write-Host '[완료] CEO Hub <-> Antigravity 실시간 감시기가 백그라운드에서 실행 중입니다! (60초 폴링 · AI 비용 0원)' -ForegroundColor Green
Write-Host "모델 지정이 필요하면 `"$ConfigFile`"의 models.code / deep / light에 모델 슬러그를 넣을 수 있습니다." -ForegroundColor Gray
Write-Host "로그 확인: Get-Content `"$BaseDir\watcher.log`" -Tail 20 -Wait" -ForegroundColor Gray
