#Requires -Version 5.1
<#
  CEO Hub <-> Local Antigravity (agy) One-Click Windows Installer
  - Parity with Aside's %LOCALAPPDATA%\CeoHubWatcher setup:
    1) Verifies (or guides installing) Antigravity CLI (%LOCALAPPDATA%\agy\bin\agy.exe)
    2) Encrypts CEO Hub MCP token with Windows DPAPI (CurrentUser scope, never plaintext in logs)
    3) Registers "ceo-office" MCP server in %USERPROFILE%\.gemini\config\mcp_config.json (preserving existing servers)
    4) Installs ceo-outsourcing SKILL.md into %USERPROFILE%\.gemini\config\skills\ceo-outsourcing\SKILL.md
    5) Copies ceo-hub-agy-watcher.ps1 to %LOCALAPPDATA%\CeoHubAgyWatcher\
    6) Registers hidden background Startup launcher in Windows Startup folder
    7) Runs a live 1-shot connectivity check and starts the watcher immediately
#>
param(
  [string]$HubBaseUrl = 'https://ai-ceo-hub.onrender.com',
  [string]$WorkDir = (Join-Path $env:USERPROFILE 'ceo-hub-work')
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
Write-Host '=== CEO Hub <-> Antigravity (agy) 실시간 감시 설치 ===' -ForegroundColor Cyan

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
  $ans = Read-Host '지금 공식 설치 명령(irm https://antigravity.google/cli/install.ps1 | iex)을 실행할까요? (Y/n)'
  if ($ans -eq '' -or $ans -match '^[Yy]') {
    Invoke-RestMethod 'https://antigravity.google/cli/install.ps1' | Invoke-Expression
    $agyExe = $agyCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
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

# 2. Prompt MCP token securely and store encrypted with Windows DPAPI
New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
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
Set-Content -Path $TokenFile -Value $dpapiText -Encoding UTF8
Write-Host "[완료] DPAPI 암호화 토큰 저장: $TokenFile" -ForegroundColor Green

# 3. Merge ceo-office MCP server into ~/.gemini/config/mcp_config.json (preserve existing servers)
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

# 4. Install ceo-outsourcing SKILL.md
New-Item -ItemType Directory -Path $SkillDir -Force | Out-Null
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
- 하위 에이전트를 부를 때 "Gemini 4 Neon으로 실행"처럼 모델을 적는다. Hydrogen이 막히면 Neon, Neon이 막히면 Carbon이 직접 판단한다.
- Carbon 사용량을 아끼려고 반복·단순 작업은 직접 하지 않는다. 모델을 지정할 수 없으면 현재 모델로 하고 결과 문서 끝에 사용한 모델을 적는다.
- 요청서의 "모델 분담" 항목이 이 스킬보다 최신이면 요청서를 따른다.

## 순서
1. `list_outsourcing_requests`를 worker "antigravity"로 호출한다. 지금 Antigravity에 배정된 요청만 나온다. 없으면 "처리할 외주 없음"으로 끝낸다.
2. 한 건씩 `claim_outsourcing_request`(worker "antigravity")로 잡고, 돌려받은 요청서를 끝까지 읽는다. "회사 지침·기억"과 "지켜야 할 것"을 따른다.
3. 작업이 길어지면 같은 요청을 다시 claim해서 작업 시간을 연장한다(기본 45분).
4. 종류별 처리
   - 코드 수정: 요청서의 저장소를 연다(없으면 clone). `out/<요청ID>` 브랜치에서 수정하고, 가능한 범위에서 실행·테스트한 뒤 push한다. 제목에 `[<요청ID>]`를 넣어 main 대상 PR을 연다. main 직접 push 금지. `data/db.json`, `.env`, `.github/` 수정 금지.
   - 외부 자문: ① 총평 한 줄 ② 사실과 다르거나 근거 없는 주장 ③ 빠진 리스크 ④ 바로 실행할 개선안 3가지 ⑤ 승인/수정 후 승인/반려 의견. 라이브 사이트와 저장소를 직접 확인하고 확인한 사실과 추정을 구분한다.
   - 브라우저·계정 작업: 브라우저로 확인한다. 결제·광고비 집행·외부 발송·되돌리기 어려운 변경은 하지 않는다.
   - 리서치·실무: 출처를 확인하고 적는다.
5. 로그인, 2단계 인증, CAPTCHA, 결제·발송 승인처럼 대표님만 할 수 있는 순간이 오면 억지로 진행하지 말고 `request_ceo_action`으로 무엇이 필요한지 한 줄과 방법을 알린 뒤 다음 요청으로 넘어간다. 대표님이 처리하고 재개하면 다시 배정된다.
6. `submit_outsourcing_result`로 제출한다: request_id, worker "antigravity", summary(2~4문장), document(마크다운 전문), 코드면 pr_url.
7. 남은 요청이 있으면 반복한다.
'@
Set-Content -Path $SkillPath -Value $skillContent -Encoding UTF8
Write-Host "[완료] 스킬 설치: $SkillPath" -ForegroundColor Green

# 5. Install watcher script & config.json
$localSource = if ($PSScriptRoot) { Join-Path $PSScriptRoot 'ceo-hub-agy-watcher.ps1' } else { '' }
if ($localSource -and (Test-Path $localSource)) {
  Copy-Item -Path $localSource -Destination $WatcherDst -Force
} else {
  $rawUrl = 'https://raw.githubusercontent.com/alpinu83/ai-ceo-hub/main/scripts/windows/ceo-hub-agy-watcher.ps1'
  Invoke-WebRequest -Uri $rawUrl -OutFile $WatcherDst -UseBasicParsing
}

$cfgObj = @{
  hubBaseUrl = $HubBaseUrl.TrimEnd('/')
  worker     = 'antigravity'
  workDir    = $WorkDir
  agyCliPath = $(if ($agyExe) { $agyExe } else { '' })
} | ConvertTo-Json -Depth 4
Set-Content -Path $ConfigFile -Value $cfgObj -Encoding UTF8
Write-Host "[완료] 감시 스크립트 설치: $WatcherDst" -ForegroundColor Green

# 6. Register hidden Windows Startup launcher (.vbs)
$vbs = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$WatcherDst""", 0, False
"@
Set-Content -Path $StartupVbs -Value $vbs -Encoding ASCII
Write-Host "[완료] Windows 시작프로그램 등록: $StartupVbs" -ForegroundColor Green

# 7. Live connectivity check + start watcher immediately
Write-Host ''
Write-Host '=== 라이브 연결 테스트 ===' -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $WatcherDst -CheckOnce

# Launch background watcher right now
Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$StartupVbs`""
Write-Host ''
Write-Host '[완료] CEO Hub <-> Antigravity 실시간 감시기가 백그라운드에서 실행 중입니다! (60초 폴링 · AI 비용 0원)' -ForegroundColor Green
Write-Host "로그 확인: Get-Content `"$BaseDir\watcher.log`" -Tail 20 -Wait" -ForegroundColor Gray
