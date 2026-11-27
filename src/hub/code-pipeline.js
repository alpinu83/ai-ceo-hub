// hub/code-pipeline.js: server.js에서 분리 (공유 로직)
import { appendLog, appendMessage, flushCloudBackup, loadDb, saveDb, uid } from '../store.js';
import { buildCompanyContext, missionLeadState, rememberFact } from '../lead-engine.js';
import { closeMaintenancePr, getGithubRepoConfig, mergeMaintenancePr, runItMaintenancePipeline, watchDeployment } from '../it-devops.js';
import { createOutsourcingRequest, getOutsourcingSettings } from '../outsourcing.js';
import { QUOTA_ERR_RE, buildOutsourceContext, notifyOutsourceCreated } from './task-results.js';
import { autoStartLiveMissionTasks, updateMissionStatus } from './missions.js';
import { leadMessage, leadTelegram, scheduleLeadAdvanceCheck } from './lead-ops.js';
import { notifyTelegramAnomaly, sendApprovalNotifications } from './notify.js';

// ================================================================
// 결재 = 실코드 반영 엔진
// AI 팀 협업 결과 → (자동) 실제 저장소 PR 작성·보안 감사 → 결재 카드에 diff 첨부
// → CEO 승인 한 번으로 main 머지 → 라이브 배포 → 배포 결과 확인·보고
// ================================================================
export const CODE_CONTEXT_RE =
  /배포|코드|패치|수정|버그|오류|에러|\bPR\b|SEO|메타|스키마|JSON-?LD|사이트맵|sitemap|robots|페이지|HTML|CSS|자바스크립트|\bJS\b|계산기|세율|요율|\bUI\b|\bUX\b|화면|버튼|레이아웃|문구|카피|광고\s*(태그|코드|슬롯|배치|위치|교체|로직)|애드센스|AdSense|GA4?\s*태그|기능|구현|리팩터|성능|속도|보안\s*(패치|수정|점검|검증)|접근성|모바일/i;

export const NON_CODE_DECISION_RE = /결제|송금|광고비|광고\s*집행|예약\s*확정|최종\s*예약|계약|입금|구매|대외\s*발송|이메일\s*발송/;

export const CODE_STATUS_PENDING = new Set(['waiting_team', 'preparing']);

export const CODE_STATUS_DONE = new Set(['merging', 'merged', 'deployed', 'deploy_failed', 'deploy_unknown']);

/** IT 유지보수팀(무료 API 코딩 팀)이 남아 있는지. 없으면 코드 작업은 전부 AGY 수정 → Aside 검수 외주 */
export function itTeamAvailable(db) {
  return (db.agents || []).some((a) => a.team === 'it' && a.active && !a.retired);
}

/** 코드 작업을 AGY(1차 수정·PR) → Aside(검수·보완) 외주로 넘김 */
export function outsourceCodeToAgy(db, { mission, title, goal, approvalId = '', taskId = '', reason = '' }) {
  const repoCfg = mission ? getMissionRepoCfg(db.settings, mission) : null;
  const task = taskId ? db.tasks.find((t) => t.id === taskId) : null;
  const { request, created } = createOutsourcingRequest(db, {
    kind: 'code',
    worker: 'antigravity',
    pinnedWorker: 'antigravity',
    codeWorkflow: 'agy_then_aside',
    title: String(title || '코드 수정').slice(0, 120),
    goal: String(goal || title || '').slice(0, 6000),
    missionId: mission?.id || '',
    approvalId,
    taskId,
    repo: repoCfg?.repo || mission?.githubRepo || getGithubRepoConfig(db.settings).repo || '',
    branch: repoCfg?.branch || mission?.githubBranch || 'main',
    siteUrl: mission?.siteUrl || '',
    reason: reason || 'IT 유지보수팀 폐지: 코드 수정은 AGY가 하고 Aside가 검수·보완',
    context: mission ? buildOutsourceContext(db, mission, task) : '',
    createdBy: 'system'
  });
  if (created) {
    notifyOutsourceCreated(db, request);
    appendLog(db, '총괄 팀장', `코드 작업 "${request.title}"을 AGY 수정 → Aside 검수로 넘겼습니다 (${request.id}).`, 'info');
  }
  return request;
}

/** 코드 반영을 기다리는 결재 카드를 AGY 외주로 (PR이 오면 같은 결재 카드에 붙음) */
function routeWaitingCodeToAgy(missionId) {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  let n = 0;
  for (const a of db.approvals) {
    if (a.missionId !== missionId || a.prNumber || a.agyRequestId || !['pending', 'approved'].includes(a.status) || !CODE_STATUS_PENDING.has(a.codeChange?.status)) continue;
    const req = outsourceCodeToAgy(db, {
      mission,
      title: String(a.title || '').replace(/^\[[^\]]*\]\s*/, ''),
      goal: `결재 안건의 코드 변경을 저장소에 반영해 주세요.\n\n${String(a.summary || '').slice(0, 2500)}\n\n${String(a.proposedAction || '').slice(0, 1200)}${a.ceoNote ? `\n\n[대표님 메모] ${a.ceoNote}` : ''}`,
      approvalId: a.status === 'pending' ? a.id : ''
    });
    a.agyRequestId = req.id;
    setCodeStatus(a, a.status === 'pending' ? 'waiting_team' : 'none', { note: `AGY 수정 → Aside 검수 외주로 진행 (${req.id})` });
    n += 1;
  }
  if (n) saveDb(db);
  return n;
}

export const codeBundleLocks = new Map();

export const codeBundleTimers = new Map();

export const failedRetryTimers = new Map();

// AI quota / provider hiccups are usually temporary: retry failed PR preparation in the background (max 3 times)
export function scheduleFailedCodeRetry(missionId, delayMs) {
  if (!missionId || failedRetryTimers.has(missionId)) return;
  if (delayMs === undefined) {
    // back off: free AI quotas usually reset within the hour
    const db0 = loadDb();
    const maxRetries = Math.max(0, ...db0.approvals.filter((a) => a.missionId === missionId && a.codeChange?.status === 'failed').map((a) => Number(a.codeChange.retries || 0)));
    delayMs = [8, 20, 45][Math.min(maxRetries, 2)] * 60 * 1000;
  }
  failedRetryTimers.set(
    missionId,
    setTimeout(() => {
      failedRetryTimers.delete(missionId);
      const db = loadDb();
      let count = 0;
      for (const a of db.approvals) {
        if (
          a.missionId === missionId &&
          a.status === 'pending' &&
          a.codeChange?.status === 'failed' &&
          !a.prNumber &&
          Number(a.codeChange.retries || 0) < 3
        ) {
          setCodeStatus(a, 'waiting_team', { retries: Number(a.codeChange.retries || 0) + 1 });
          count += 1;
        }
      }
      if (count) {
        appendLog(db, 'IT 유지보수팀', `실코드 변경안 작성 재시도 (${count}건)`, 'info');
        saveDb(db);
        runCodeBundle(missionId).catch((err) => console.warn('code retry error:', err.message));
      }
    }, delayMs)
  );
}

export function getMissionRepoCfg(settings, mission) {
  if (!mission?.githubRepo) return null;
  const cfg = getGithubRepoConfig(settings, { repo: mission.githubRepo, branch: mission.githubBranch });
  if (!cfg.enabled) return null;
  if (cfg.allowedRepos.length && !cfg.allowedRepos.includes(cfg.repo)) return null;
  return cfg;
}

export function isCodeTask(task, agent) {
  if (!task) return false;
  const text = `${task.title || ''} ${task.description || ''}`;
  if ((Number(task.estimatedCostKRW) || 0) > 0 || NON_CODE_DECISION_RE.test(text)) return false;
  return task.domain === 'it_ops' || task.domain === 'dev' || agent?.team === 'it' || CODE_CONTEXT_RE.test(text);
}

export function isCodeApproval(db, apr) {
  if (!apr || apr.kind === 'next_phase') return false;
  if (apr.kind === 'it_pr_merge' || apr.prNumber) return true;
  const mission = db.missions.find((m) => m.id === apr.missionId);
  if (!getMissionRepoCfg(db.settings, mission)) return false;
  const task = db.tasks.find((t) => t.id === apr.taskId);
  if (!task) return false;
  const agent = db.agents.find((a) => a.id === task.assigneeId);
  return isCodeTask(task, agent);
}

export function deployLabelFor(repo = '') {
  if (repo.includes('kr-calc-hub')) return 'korea-tax-cal.com 라이브 빌드·배포(GitHub Actions)';
  if (repo.includes('ai-ceo-hub')) return 'CEO Office(Render) 라이브 배포';
  if (repo.includes('github.io')) return 'GitHub Pages 배포';
  return `${repo} 자동 배포`;
}

export function buildTeamDecisionContext(db, mission, tasks, ceoNote = '') {
  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  const lines = tasks.map((t, i) => {
    const ag = agentMap[t.assigneeId];
    const body = String(t.output || t.description || '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 700);
    return `${i + 1}. [${t.title}] (${ag?.name || '팀원'})\n${body}`;
  });
  const companyCtx = buildCompanyContext(db, mission.id, { compact: true }).slice(0, 900);
  return [
    `[프로젝트] ${mission.title}${mission.mode === 'project' ? ` (Phase ${Number(mission.phase) || 1})` : ''}`,
    companyCtx,
    lines.join('\n\n'),
    mission.finalReport ? `[팀장 종합 보고 요약]\n${String(mission.finalReport).slice(0, 800)}` : '',
    ceoNote ? `[CEO 결재 메모]\n${ceoNote}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3500);
}

export function buildCodeInstruction(mission, tasks, extraNote = '') {
  const titles = tasks
    .map((t) => t.title)
    .filter(Boolean)
    .slice(0, 6)
    .join(' / ');
  return `${String(mission.directive || mission.title || '').slice(0, 1500)}\n\n[이번 결재 대상] ${titles || mission.title}\n위 지시와 AI 팀 협업 결정사항 중 이 저장소에 바로 반영할 수 있는 변경을 실제 코드로 구현하세요.${
    extraNote ? `\n[CEO 수정 지시] ${extraNote}` : ''
  }`;
}

export function setCodeStatus(apr, status, extra = {}) {
  const base = { ...(apr.codeChange || {}) };
  if (['ready', 'merging', 'merged', 'deployed'].includes(status)) delete base.error; // stale failure text
  apr.codeChange = { ...base, ...extra, status, updatedAt: new Date().toISOString() };
}

export function applyPrFieldsToApproval(apr, result, extra = {}) {
  Object.assign(apr, {
    repo: result.repo,
    branch: result.branch,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    branchName: result.branchName,
    changedFiles: result.changedFiles,
    diffSummary: result.diffSummary,
    codeInstruction: result.instruction || apr.codeInstruction || '',
    codeTeamContext: String(result.teamContext || apr.codeTeamContext || '').slice(0, 9000),
    codeAudit: result.audit || null,
    riskLevel: result.audit?.riskLevel || apr.riskLevel || 'medium',
    ...extra
  });
}

export function isAuditSafe(result) {
  return result?.audit?.passed !== false && result?.audit?.riskLevel !== 'high';
}

/**
 * 사전 승인된 카드(들)을 "변경 내용 확인" 결재로 대체. 새 카드를 승인해야만 병합·배포됨.
 */
export function requestDiffApproval(db, apr, result, mission, extraIds = []) {
  const taskIds = [...new Set([...(apr.taskIds || []), ...(apr.taskId ? [apr.taskId] : [])])];
  const newApr = createItPrApproval(db, mission, result, {
    taskIds,
    titlePrefix: '[변경 내용 확인] ',
    summaryLead: `먼저 승인하신 "${apr.title}"의 실제 코드 변경안(PR)입니다. 아래 변경 내용을 확인하고 승인하셔야 병합·배포됩니다. (이 결재 전에는 아무것도 배포되지 않습니다)`
  });
  newApr.supersedes = [apr.id, ...extraIds];
  for (const id of [apr.id, ...extraIds]) {
    const old = db.approvals.find((a) => a.id === id);
    if (old) setCodeStatus(old, 'superseded', { note: `변경 내용 확인 결재(${newApr.title})로 이관`, newApprovalId: newApr.id });
  }
  appendLog(db, 'IT 유지보수팀', `"${apr.title}" → PR #${result.prNumber} 변경 내용을 붙여 다시 결재 상신(자동 병합 안 함).`, 'approval');
  itTeamMessage(
    db,
    apr.missionId,
    '변경 내용 확인 요청',
    `사전 승인하신 "${apr.title}"의 실제 변경안 PR #${result.prNumber}을 만들었습니다 (${(result.changedFiles || []).join(', ')}). 변경 내용을 붙여 다시 결재에 올렸고, 승인하셔야 병합·배포됩니다.\nPR: ${result.prUrl}`,
    'approval'
  );
  return newApr;
}

export function createItPrApproval(db, mission, result, { taskIds = [], titlePrefix = '', summaryLead = '' } = {}) {
  const now = new Date().toISOString();
  const apr = {
    id: uid('apr'),
    kind: 'it_pr_merge',
    missionId: mission?.id || '',
    taskId: '',
    taskIds,
    agentId: 'agent_it_dev',
    title: `${titlePrefix}[${result.repo} PR #${result.prNumber}] ${result.prTitle}`,
    category: 'IT 코드 수정 · 실배포 승인',
    estimatedCostKRW: 0,
    depositKRW: 0,
    summary: `${summaryLead ? `${summaryLead}\n\n` : ''}${result.prSummary}\n\n[대상 저장소] ${result.repo} (${result.branch})\n[수정 파일] ${result.changedFiles.join(', ')}\n[IT 보안 감사: ${result.audit?.passed ? 'PASS' : '주의'} · ${String(result.audit?.riskLevel || '').toUpperCase()}] ${result.audit?.notes || ''}\n[GitHub PR] ${result.prUrl}${result.diffSummary ? `\n\n[변경 내용 미리보기]\n${String(result.diffSummary).slice(0, 1200)}` : ''}`,
    proposedAction: `승인 시 ${result.repo} PR #${result.prNumber}을 main에 자동 머지하고 ${deployLabelFor(result.repo)}까지 진행합니다. (CI 실패 시 머지 보류)`,
    status: 'pending',
    ceoNote: '',
    createdAt: now,
    decidedAt: null
  };
  applyPrFieldsToApproval(apr, result);
  setCodeStatus(apr, 'ready');
  db.approvals.unshift(apr);
  return apr;
}

export function itTeamMessage(db, missionId, statusText, text, type = 'work') {
  appendMessage(db, {
    missionId: missionId || '',
    senderId: 'agent_it_dev',
    senderName: 'IT 유지보수팀',
    senderRole: 'IT팀 실코드 반영·배포',
    senderShortCode: 'IT',
    senderAccent: '#0F766E',
    targetAgentId: 'ceo',
    statusText,
    type,
    text
  });
}

export function scheduleCodeBundle(missionId, delayMs = 4000) {
  if (!missionId) return;
  clearTimeout(codeBundleTimers.get(missionId));
  codeBundleTimers.set(
    missionId,
    setTimeout(() => {
      codeBundleTimers.delete(missionId);
      runCodeBundle(missionId, { retryEmpty: true }).catch((err) => console.warn('code bundle error:', err.message));
    }, delayMs)
  );
}

export function runCodeBundle(missionId, opts = {}) {
  if (!itTeamAvailable(loadDb())) return Promise.resolve({ outsourced: routeWaitingCodeToAgy(missionId) });
  if (codeBundleLocks.has(missionId)) return codeBundleLocks.get(missionId);
  const job = runCodeBundleInner(missionId, opts).finally(() => codeBundleLocks.delete(missionId));
  codeBundleLocks.set(missionId, job);
  return job;
}

export async function waitForMissionIdle(missionId, maxMs = 240000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const db = loadDb();
    if (!db.tasks.some((t) => t.missionId === missionId && t.status === 'running')) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

export function maybeScheduleCodeBundle(db, mission, task) {
  try {
    if (!mission || !task || task.status !== 'completed') return;
    if (!getMissionRepoCfg(db.settings, mission)) return;
    const agent = db.agents.find((a) => a.id === task.assigneeId);
    if (!itTeamAvailable(db)) {
      // IT팀 없음: 명시적인 코드 업무(it_ops)만 AGY로. 일반 결과물의 후속 코드는 팀장이 다음 계획에서 코드 작업으로 배정
      if (task.domain === 'it_ops' && !task.agyRequestId) {
        const req = outsourceCodeToAgy(db, { mission, title: `[코드 반영] ${task.title}`, goal: `아래 팀 결과물에 담긴 코드·사이트 변경을 저장소에 반영해 주세요.\n\n${String(task.output || '').slice(0, 4000)}`, taskId: task.id });
        task.agyRequestId = req.id;
      }
      return;
    }
    if (isCodeTask(task, agent)) scheduleCodeBundle(mission.id, 8000);
  } catch {
    // non-fatal
  }
}

/**
 * Turns the team's finished work (and any held deploy approvals) into ONE real PR,
 * attaches it to the approval card, and only then notifies the CEO.
 */
export async function runCodeBundleInner(missionId, { retryEmpty = false } = {}) {
  await waitForMissionIdle(missionId);
  let db = loadDb();
  let mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return null;

  const findWaiting = (d) =>
    d.approvals.filter(
      (a) =>
        a.missionId === missionId &&
        ['pending', 'approved'].includes(a.status) &&
        CODE_STATUS_PENDING.has(a.codeChange?.status) &&
        !a.prNumber
    );
  // The caller may still be finishing (e.g. writing a summary) before it saves the held card: wait for it to land.
  if (retryEmpty) {
    for (let i = 0; i < 12 && findWaiting(db).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      await waitForMissionIdle(missionId);
      db = loadDb();
    }
    mission = db.missions.find((m) => m.id === missionId);
    if (!mission) return null;
  }

  // Cards that were decided as reject/revision while waiting don't need a PR anymore
  let statusChanged = false;
  for (const a of db.approvals) {
    if (a.missionId === missionId && CODE_STATUS_PENDING.has(a.codeChange?.status) && !a.prNumber) {
      if (a.status === 'rejected') {
        setCodeStatus(a, 'closed');
        statusChanged = true;
      }
      if (a.status === 'revision_requested') {
        setCodeStatus(a, 'revision');
        statusChanged = true;
      }
    }
  }
  const waiting = findWaiting(db);

  const cfg = getMissionRepoCfg(db.settings, mission);
  if (!cfg) {
    for (const apr of waiting) setCodeStatus(apr, 'unavailable');
    saveDb(db);
    for (const apr of waiting) {
      if (apr.status === 'pending') sendApprovalNotifications(db.settings, apr, apr.codeChange?.agentName);
    }
    return null;
  }

  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  const waitingTaskIds = new Set(waiting.map((a) => a.taskId).filter(Boolean));
  const phase = Number(mission.phase) || 1;
  const candidates = db.tasks.filter((t) => {
    if (t.missionId !== missionId) return false;
    if (waitingTaskIds.has(t.id)) return true;
    if (t.codeBundleId) return false;
    if ((Number(t.phase) || 1) !== phase) return false;
    if (t.status !== 'completed' || !String(t.output || '').trim()) return false;
    return isCodeTask(t, agentMap[t.assigneeId]);
  });
  if (candidates.length === 0 && waiting.length === 0) {
    if (statusChanged) saveDb(db);
    return null;
  }

  const bundleId = uid('cbd');
  for (const t of candidates) t.codeBundleId = bundleId;
  for (const apr of waiting) setCodeStatus(apr, 'preparing', { bundleId });
  appendLog(
    db,
    'IT 유지보수팀',
    `"${mission.title}" 팀 협업 결과 ${candidates.length}건을 [${cfg.repo}] 실제 코드 변경안(PR)으로 작성 중…`,
    'info'
  );
  saveDb(db);

  const teamContext = buildTeamDecisionContext(db, mission, candidates);
  const instruction = buildCodeInstruction(mission, candidates);
  let result = null;
  let failure = null;
  try {
    result = await runItMaintenancePipeline({
      instruction,
      missionTitle: mission.title,
      repoOverride: cfg.repo,
      branchOverride: cfg.branch,
      siteUrl: mission.siteUrl || '',
      agents: db.agents,
      settings: db.settings,
      teamContext
    });
  } catch (err) {
    failure = err;
  }

  db = loadDb();
  const freshMission = db.missions.find((m) => m.id === missionId) || mission;
  const freshWaiting = waiting.map((w) => db.approvals.find((a) => a.id === w.id)).filter(Boolean);
  const taskIds = candidates.map((t) => t.id);

  if (result) {
    const label = deployLabelFor(result.repo);
    let targets = freshWaiting;
    if (targets.length) {
      for (const apr of targets) {
        applyPrFieldsToApproval(apr, result, { codeBundleId: bundleId, taskIds });
        apr.category = 'IT 코드 수정 · 실배포 승인';
        apr.summary = `${apr.summary}\n\n[실코드 변경안] ${result.prSummary}\n[수정 파일] ${result.changedFiles.join(', ')}\n[IT 보안 감사: ${result.audit?.passed ? 'PASS' : '주의'} · ${String(result.audit?.riskLevel || '').toUpperCase()}] ${result.audit?.notes || ''}${result.diffSummary ? `\n\n[변경 내용 미리보기]\n${String(result.diffSummary).slice(0, 1200)}` : ''}`;
        apr.proposedAction = `승인 시 ${result.repo} PR #${result.prNumber}을 main에 자동 머지하고 ${label}까지 진행합니다. (CI 실패 시 머지 보류)`;
        setCodeStatus(apr, 'ready');
      }
    } else {
      const apr = createItPrApproval(db, freshMission, result, {
        taskIds,
        summaryLead: `[팀 협업 결과 실코드 반영] ${candidates
          .map((t) => t.title)
          .slice(0, 4)
          .join(' / ')}`
      });
      apr.codeBundleId = bundleId;
      targets = [apr];
    }
    appendLog(
      db,
      'IT 유지보수팀',
      `[${result.repo}] 팀 결정사항으로 실제 PR #${result.prNumber} 작성 (${result.changedFiles.join(', ')}) → CEO 결재 상신.`,
      'approval'
    );
    itTeamMessage(
      db,
      missionId,
      `PR #${result.prNumber} 상신`,
      `팀 협업 결과를 [${result.repo}] 실제 코드에 반영한 PR #${result.prNumber}을 만들었습니다 (${result.changedFiles.join(', ')}).\nPR: ${result.prUrl}\n결재에서 승인하시면 별도 지시 없이 바로 main 머지 → ${label}까지 진행합니다.`,
      'approval'
    );
    missionLeadState(db, missionId).lastCodeNote = {
      status: 'pr',
      message: `[${result.repo}] PR #${result.prNumber} 작성 (${result.changedFiles.join(', ')})`,
      at: new Date().toISOString()
    };
    saveDb(db);
    await flushCloudBackup(db);

    const preApproved = targets.filter((a) => a.status === 'approved');
    for (const apr of targets) {
      if (apr.status === 'pending') {
        sendApprovalNotifications(db.settings, apr, apr.codeChange?.agentName || 'IT 유지보수팀');
      }
    }
    if (preApproved.length) {
      // PR이 생기기 전에 승인된 건은 자동 병합하지 않고, 변경 내용을 붙여 결재를 다시 올림
      const fresh2 = loadDb();
      const first = fresh2.approvals.find((a) => a.id === preApproved[0].id);
      const newApr = requestDiffApproval(fresh2, first, result, fresh2.missions.find((m) => m.id === missionId), preApproved.slice(1).map((a) => a.id));
      saveDb(fresh2);
      await flushCloudBackup(fresh2);
      sendApprovalNotifications(fresh2.settings, newApr, 'IT 유지보수팀');
    }
    return { ok: true, result };
  }

  const noChange = failure?.code === 'NO_CODE_CHANGE';
  for (const apr of freshWaiting) {
    apr.codeInstruction = instruction;
    apr.codeTeamContext = teamContext;
    if (noChange) {
      setCodeStatus(apr, 'none', { note: failure.message });
      apr.summary = `${apr.summary}\n\n[IT팀 검토] ${failure.message}`;
    } else {
      setCodeStatus(apr, 'failed', { error: failure?.message || '알 수 없는 오류' });
      if (!/사전 작성 실패/.test(apr.proposedAction || '')) {
        apr.proposedAction = `${apr.proposedAction}\n(실코드 변경안 사전 작성 실패: IT팀이 자동으로 다시 시도하고, 그 전에 승인하셔도 다시 작성해 보안 감사를 통과하면 바로 머지·배포합니다.)`;
      }
    }
  }
  appendLog(
    db,
    'IT 유지보수팀',
    noChange
      ? `"${mission.title}" 협업 결과 검토 — ${failure.message}`
      : `"${mission.title}" 실코드 변경안 작성 실패: ${failure?.message}`,
    noChange ? 'info' : 'warning'
  );
  missionLeadState(db, missionId).lastCodeNote = {
    status: noChange ? 'none' : 'failed',
    message: String(failure?.message || '알 수 없는 오류'),
    at: new Date().toISOString()
  };
  if (!noChange) {
    rememberFact(db, {
      kind: 'lesson',
      missionId,
      text: `[${cfg.repo}] 코드 반영 실패: ${String(failure?.message || '').slice(0, 200)}`,
      source: 'it_pipeline'
    });
  }
  saveDb(db);
  await flushCloudBackup(db);
  if (!noChange && freshWaiting.length === 0) {
    notifyTelegramAnomaly(db.settings, 'IT팀 실코드 변경안 작성 실패', `"${mission.title}" (${cfg.repo}) — ${failure?.message}`);
  }
  // 무료 IT팀이 못 만드는 코드 변경(큰 수정·패치 불일치 등) 또는 재시도 소진 → Antigravity 외주
  let outsourcedCode = null;
  const osCfgCode = getOutsourcingSettings(db.settings);
  const maxCodeRetries = Math.max(0, ...freshWaiting.map((a) => Number(a.codeChange?.retries || 0)));
  if (!noChange && osCfgCode.enabled && osCfgCode.autoOnFailure && (!QUOTA_ERR_RE.test(String(failure?.message || '')) || maxCodeRetries >= 3)) {
    const made = createOutsourcingRequest(db, {
      kind: 'code',
      worker: 'antigravity',
      title: `[코드] ${mission.title}: ${candidates.map((t) => t.title).slice(0, 2).join(' / ')}`.slice(0, 120),
      missionId,
      taskId: candidates[0]?.id || '',
      approvalId: freshWaiting[0]?.id || '',
      reason: `무료 IT팀이 실제 코드 변경안을 만들지 못함: ${String(failure?.message || '').slice(0, 300)}`,
      goal: `${instruction}\n\n[팀 결정사항]\n${teamContext}`.slice(0, 3000),
      repo: cfg.repo,
      branch: cfg.branch,
      siteUrl: mission.siteUrl || '',
      context: buildOutsourceContext(db, mission, candidates[0])
    });
    outsourcedCode = made.request;
    if (made.created) notifyOutsourceCreated(db, made.request);
    for (const apr of freshWaiting) {
      setCodeStatus(apr, 'failed', { error: `${apr.codeChange?.error || ''} → 외주 ${made.request.id}(Antigravity)로 넘김`.trim() });
    }
  }
  let retryNeeded = false;
  for (const apr of freshWaiting) {
    if (apr.status === 'pending') {
      if (!noChange && !outsourcedCode && Number(apr.codeChange?.retries || 0) < 3) retryNeeded = true;
      if (!apr.codeChange?.notified) {
        setCodeStatus(apr, apr.codeChange.status, { notified: true });
        sendApprovalNotifications(db.settings, apr, apr.codeChange?.agentName || 'IT 유지보수팀');
      }
    } else if (apr.status === 'approved' && !noChange) {
      applyApprovedCodeChange(apr.id).catch((err) => console.warn('apply code change error:', err.message));
    }
  }
  saveDb(db);
  if (retryNeeded) scheduleFailedCodeRetry(missionId);
  return { ok: false, error: failure?.message, noChange };
}

/**
 * (Re)generates a PR for an approval on the latest main. Returns the pipeline result or throws.
 */
export async function regeneratePrForApproval(aprId, extraNote = '') {
  const db = loadDb();
  const apr = db.approvals.find((a) => a.id === aprId);
  if (!apr) throw new Error('결재 안건을 찾을 수 없습니다.');
  const mission = db.missions.find((m) => m.id === apr.missionId);
  const cfg = mission
    ? getMissionRepoCfg(db.settings, mission)
    : getGithubRepoConfig(db.settings, { repo: apr.repo, branch: apr.branch });
  const repo = apr.repo || cfg?.repo;
  if (!cfg || !repo) throw new Error('연동된 GitHub 저장소 또는 토큰이 없습니다.');
  const relatedIds = new Set([apr.taskId, ...(apr.taskIds || [])].filter(Boolean));
  const tasks = db.tasks.filter((t) => relatedIds.has(t.id));
  const teamContext =
    apr.codeTeamContext || (mission ? buildTeamDecisionContext(db, mission, tasks, apr.ceoNote) : '');
  let instruction =
    apr.codeInstruction || (mission ? buildCodeInstruction(mission, tasks) : apr.summary || apr.title);
  if (extraNote) instruction = `${instruction}\n[CEO 수정 지시] ${extraNote}`;
  return runItMaintenancePipeline({
    instruction,
    missionTitle: mission?.title || apr.title,
    repoOverride: repo,
    branchOverride: apr.branch || cfg.branch,
    siteUrl: mission?.siteUrl || '',
    agents: db.agents,
    settings: db.settings,
    teamContext
  });
}

export function holdForSecurityReview(db, apr, result, mission) {
  setCodeStatus(apr, 'needs_review', { error: `보안 감사 ${result.audit?.riskLevel || '주의'}` });
  const reviewApr = createItPrApproval(db, mission, result, {
    taskIds: [apr.taskId, ...(apr.taskIds || [])].filter(Boolean),
    titlePrefix: '[보안 재확인] ',
    summaryLead: `승인하신 "${apr.title}" 건의 코드 변경안이 IT 보안 감사에서 주의 판정(${result.audit?.riskLevel || 'unknown'})을 받아 자동 머지를 멈췄습니다. diff를 확인하신 뒤 다시 승인해 주세요.`
  });
  appendLog(db, 'IT 보안팀', `"${apr.title}" 변경안 보안 감사 주의 → 자동 머지 보류, 재확인 결재 상신.`, 'warning');
  return reviewApr;
}

/**
 * CEO approved a code decision → make sure a PR exists, then merge & deploy.
 */
export async function applyApprovedCodeChange(aprId) {
  let db = loadDb();
  let apr = db.approvals.find((a) => a.id === aprId);
  if (!apr || apr.status !== 'approved') return null;
  if (CODE_STATUS_DONE.has(apr.codeChange?.status)) return null;

  if (!apr.prNumber && !itTeamAvailable(db)) {
    const n = routeWaitingCodeToAgy(apr.missionId);
    if (!n && !apr.agyRequestId) {
      const mission = db.missions.find((m) => m.id === apr.missionId);
      const req = outsourceCodeToAgy(db, { mission, title: String(apr.title || '').replace(/^\[[^\]]*\]\s*/, ''), goal: `승인된 결재 안건의 코드 변경을 저장소에 반영해 주세요.\n\n${String(apr.summary || '').slice(0, 2500)}` });
      apr.agyRequestId = req.id;
      setCodeStatus(apr, 'none', { note: `AGY 수정 → Aside 검수 외주로 진행 (${req.id})` });
      saveDb(db);
    }
    return { ok: true, outsourced: true };
  }
  if (!apr.prNumber) {
    setCodeStatus(apr, 'preparing');
    appendLog(db, 'IT 유지보수팀', `"${apr.title}" 승인 → 실제 코드 변경안을 작성해 바로 반영합니다.`, 'info');
    saveDb(db);
    try {
      const result = await regeneratePrForApproval(aprId, apr.ceoNote && !/원터치/.test(apr.ceoNote) ? apr.ceoNote : '');
      db = loadDb();
      apr = db.approvals.find((a) => a.id === aprId);
      const mission = db.missions.find((m) => m.id === apr.missionId);
      applyPrFieldsToApproval(apr, result);
      if (!isAuditSafe(result)) {
        const reviewApr = holdForSecurityReview(db, apr, result, mission);
        saveDb(db);
        await flushCloudBackup(db);
        sendApprovalNotifications(db.settings, reviewApr, 'IT 보안팀');
        return { ok: false, heldForReview: true };
      }
      // 사전 승인만 있고 PR이 없던 건: 여기서 바로 병합하지 않고 변경 내용(diff)을 붙여 결재를 다시 올림
      const diffApr = requestDiffApproval(db, apr, result, mission);
      saveDb(db);
      await flushCloudBackup(db);
      sendApprovalNotifications(db.settings, diffApr, 'IT 유지보수팀');
      return { ok: true, awaitingDiffApproval: true, approvalId: diffApr.id };
    } catch (err) {
      db = loadDb();
      apr = db.approvals.find((a) => a.id === aprId);
      if (err.code === 'NO_CODE_CHANGE') {
        setCodeStatus(apr, 'none', { note: err.message });
        appendLog(db, 'IT 유지보수팀', `"${apr.title}" — ${err.message}`, 'info');
      } else {
        setCodeStatus(apr, 'failed', { error: err.message });
        appendLog(db, 'IT 유지보수팀', `"${apr.title}" 실코드 반영 실패: ${err.message}`, 'warning');
        notifyTelegramAnomaly(db.settings, '승인 건 실코드 반영 실패', `${apr.title} — ${err.message}`);
      }
      saveDb(db);
      await flushCloudBackup(db);
      return { ok: false, error: err.message };
    }
  }
  return mergeApprovedPr(aprId, 1);
}

export async function mergeApprovedPr(aprId, attempt = 1) {
  let db = loadDb();
  let apr = db.approvals.find((a) => a.id === aprId);
  if (!apr?.prNumber) return null;
  setCodeStatus(apr, 'merging');
  saveDb(db);

  try {
    const merged = await mergeMaintenancePr({
      prNumber: apr.prNumber,
      repo: apr.repo,
      branch: apr.branch,
      settings: db.settings
    });
    db = loadDb();
    apr = db.approvals.find((a) => a.id === aprId);
    const now = new Date().toISOString();
    setCodeStatus(apr, 'merged', { mergeSha: merged.sha || '' });

    // Other cards bundled into the same PR are settled together
    for (const sib of db.approvals) {
      if (sib.id === apr.id || sib.repo !== apr.repo || Number(sib.prNumber) !== Number(apr.prNumber)) continue;
      if (sib.status === 'pending') {
        sib.status = 'approved';
        sib.decidedAt = now;
        sib.ceoNote = '동일 PR 묶음 결재로 함께 처리';
        const sibTask = db.tasks.find((t) => t.id === sib.taskId);
        if (sibTask) {
          sibTask.status = 'completed';
          sibTask.updatedAt = now;
        }
      }
      setCodeStatus(sib, 'merged', { mergeSha: merged.sha || '' });
    }
    if (apr.missionId) updateMissionStatus(db, apr.missionId);

    const label = deployLabelFor(apr.repo);
    const sha7 = merged.sha ? merged.sha.slice(0, 7) : 'merged';
    appendLog(
      db,
      'IT 유지보수팀',
      `CEO 승인 → [${apr.repo}] PR #${apr.prNumber} main 머지 완료 (${sha7}). ${label} 진행 중.`,
      'success'
    );
    itTeamMessage(
      db,
      apr.missionId,
      '머지 완료 · 배포 중',
      `[${apr.repo}] PR #${apr.prNumber}을 main에 머지했습니다 (${sha7}). ${label}가 시작됐고, 배포 결과는 확인되는 대로 보고드리겠습니다.`
    );
    saveDb(db);
    await flushCloudBackup(db);
    watchAndReportDeployment(aprId).catch((err) => console.warn('deploy watch error:', err.message));
    return { ok: true, merged };
  } catch (err) {
    db = loadDb();
    apr = db.approvals.find((a) => a.id === aprId);

    if ((err.code === 'PR_CONFLICT' || err.code === 'PR_CLOSED') && attempt === 1) {
      appendLog(
        db,
        'IT 유지보수팀',
        `[${apr.repo}] PR #${apr.prNumber}이 최신 main과 맞지 않아(${err.code}) 최신 코드 기준으로 변경안을 다시 작성합니다.`,
        'info'
      );
      setCodeStatus(apr, 'preparing');
      saveDb(db);
      if (err.code === 'PR_CONFLICT') {
        await closeMaintenancePr({ prNumber: apr.prNumber, repo: apr.repo, settings: db.settings });
      }
      try {
        const result = await regeneratePrForApproval(aprId);
        db = loadDb();
        apr = db.approvals.find((a) => a.id === aprId);
        const mission = db.missions.find((m) => m.id === apr.missionId);
        applyPrFieldsToApproval(apr, result);
        if (!isAuditSafe(result)) {
          const reviewApr = holdForSecurityReview(db, apr, result, mission);
          saveDb(db);
          await flushCloudBackup(db);
          sendApprovalNotifications(db.settings, reviewApr, 'IT 보안팀');
          return { ok: false, heldForReview: true };
        }
        saveDb(db);
        return mergeApprovedPr(aprId, 2);
      } catch (regenErr) {
        db = loadDb();
        apr = db.approvals.find((a) => a.id === aprId);
        setCodeStatus(apr, 'merge_failed', { error: regenErr.message });
        appendLog(db, 'IT 유지보수팀', `변경안 재작성 실패: ${regenErr.message}`, 'warning');
        notifyTelegramAnomaly(db.settings, '승인 건 자동 머지 실패', `${apr.title} — ${regenErr.message}`);
        saveDb(db);
        await flushCloudBackup(db);
        return { ok: false, error: regenErr.message };
      }
    }

    if (err.code === 'CI_FAILED') {
      setCodeStatus(apr, 'ci_failed', { error: err.message });
      appendLog(db, 'IT QA', `${err.message} PR은 열어둔 상태입니다: ${apr.prUrl || ''}`, 'warning');
      itTeamMessage(
        db,
        apr.missionId,
        'CI 실패 · 머지 보류',
        `승인하셨지만 [${apr.repo}] PR #${apr.prNumber}의 자동 테스트가 실패해 main 머지를 멈췄습니다. 라이브 사이트는 바뀌지 않았습니다.\nPR: ${apr.prUrl || ''}`
      );
      notifyTelegramAnomaly(db.settings, 'CI 실패로 배포 보류', `${apr.title}\n${apr.prUrl || ''}`);
    } else {
      setCodeStatus(apr, 'merge_failed', { error: err.message });
      appendLog(db, 'IT 유지보수팀', `[${apr.repo}] PR #${apr.prNumber} 자동 머지 실패: ${err.message}`, 'warning');
      notifyTelegramAnomaly(db.settings, '승인 건 자동 머지 실패', `${apr.title} — ${err.message}`);
    }
    saveDb(db);
    await flushCloudBackup(db);
    return { ok: false, error: err.message };
  }
}

export async function watchAndReportDeployment(aprId) {
  let db = loadDb();
  let apr = db.approvals.find((a) => a.id === aprId);
  const sha = apr?.codeChange?.mergeSha;
  if (!apr || !sha) return null;
  const isSelf = String(apr.repo || '').includes('ai-ceo-hub');
  const res = await watchDeployment({
    repo: apr.repo,
    sha,
    settings: db.settings,
    timeoutMs: isSelf ? 240000 : 600000
  });
  db = loadDb();
  apr = db.approvals.find((a) => a.id === aprId);
  if (!apr) return null;
  const sha7 = sha.slice(0, 7);
  const runNames = (res.runs || []).map((r) => `${r.name}:${r.conclusion || r.status}`).join(', ');
  const prLabel = apr.prNumber ? `PR #${apr.prNumber}` : sha7;
  const deployMission = db.missions.find((m) => m.id === apr.missionId);
  const liveUrl = deployMission?.siteUrl ? `\n라이브 사이트: ${deployMission.siteUrl}` : '';
  if (apr.missionId) missionLeadState(db, apr.missionId).lastReportAt = new Date().toISOString();
  if (res.status === 'success') {
    setCodeStatus(apr, 'deployed', { deployRuns: res.runs });
    appendLog(db, 'IT QA', `[${apr.repo}] ${sha7} 배포 워크플로 성공 확인 (${runNames}).`, 'success');
    itTeamMessage(
      db,
      apr.missionId,
      '배포 완료 확인',
      `[${apr.repo}] ${sha7} 배포 워크플로가 모두 성공했습니다 (${runNames}).${isSelf ? ' Render는 새 이미지로 재시작 중이며, 재기동 후 버전을 다시 확인합니다.' : ''}`
    );
    const doneText = `[완료] "${apr.title}"\n${apr.repo} ${prLabel}이 main에 합쳐지고 배포까지 끝났습니다 (커밋 ${sha7}).${liveUrl}\n추가로 바꿀 점이 있으면 말씀해 주세요.`;
    leadMessage(db, apr.missionId, '작업 완료 보고', doneText, 'plan');
    rememberFact(db, { kind: 'result', missionId: apr.missionId, text: `${apr.repo} ${prLabel} 머지·배포 완료: ${apr.title}`, source: 'deploy' });
    leadTelegram(db, `작업 완료: ${apr.repo}`, doneText, `deploy:${sha7}`);
    scheduleLeadAdvanceCheck(apr.missionId);
  } else if (res.status === 'failure') {
    const failedRun = (res.runs || []).find((r) => !['success', 'skipped', 'neutral'].includes(r.conclusion));
    setCodeStatus(apr, 'deploy_failed', { deployRuns: res.runs, error: failedRun?.name || '' });
    appendLog(db, 'IT QA', `[${apr.repo}] ${sha7} 배포 실패 (${runNames}) ${failedRun?.url || ''}`, 'warning');
    notifyTelegramAnomaly(db.settings, `배포 실패: ${apr.repo}`, `${apr.title}\n${failedRun?.url || runNames}`);
    leadMessage(
      db,
      apr.missionId,
      '배포 실패 보고',
      `[배포 실패] "${apr.title}"\n${apr.repo} ${prLabel}은 합쳐졌지만 배포 워크플로가 실패했습니다 (${failedRun?.name || runNames}).\n${failedRun?.url || ''}\n"배포 실패 고쳐줘"라고 말씀하시면 IT팀이 원인을 찾아 수정 PR을 올립니다.`,
      'approval'
    );
    rememberFact(db, { kind: 'lesson', missionId: apr.missionId, text: `${apr.repo} ${prLabel} 배포 실패 (${failedRun?.name || runNames})`, source: 'deploy' });
  } else {
    setCodeStatus(apr, 'deploy_unknown', { deployRuns: res.runs, note: res.reason || '' });
    appendLog(db, 'IT QA', `[${apr.repo}] ${sha7} 머지 완료 · 배포 상태 자동 확인 불가 (${res.reason || '알 수 없음'}).`, 'info');
    const unknownText = `[머지 완료 · 배포 확인 불가] "${apr.title}"\n${apr.repo} ${prLabel}은 main에 합쳐졌지만 배포 결과를 자동으로 확인하지 못했습니다 (${res.reason || '알 수 없음'}).${liveUrl}`;
    leadMessage(db, apr.missionId, '머지 완료 보고', unknownText, 'plan');
    rememberFact(db, { kind: 'result', missionId: apr.missionId, text: `${apr.repo} ${prLabel} 머지 완료(배포 확인 불가): ${apr.title}`, source: 'deploy' });
    leadTelegram(db, `머지 완료: ${apr.repo}`, unknownText, `deploy:${sha7}`);
  }
  saveDb(db);
  await flushCloudBackup(db);
  return res;
}

/**
 * Called after any CEO decision. Approve = real code applied & deployed. No extra instruction needed.
 */
export async function handleCodeDecision(aprId, decision) {
  const db = loadDb();
  const apr = db.approvals.find((a) => a.id === aprId);
  if (!apr || !isCodeApproval(db, apr)) return null;
  const cc = apr.codeChange || {};

  if (decision === 'approved') {
    if (CODE_STATUS_PENDING.has(cc.status) && !apr.prNumber) {
      appendLog(db, 'IT 유지보수팀', `"${apr.title}" 승인 확인 → 실코드 변경안이 준비되는 즉시 자동 머지·배포합니다.`, 'info');
      saveDb(db);
      if (!codeBundleLocks.has(apr.missionId)) scheduleCodeBundle(apr.missionId, 1000);
      return { ok: true, queued: true };
    }
    if (cc.status === 'none' || cc.status === 'unavailable') return null;
    return applyApprovedCodeChange(aprId);
  }

  if (decision === 'rejected' || decision === 'revision_requested') {
    if (apr.prNumber && !CODE_STATUS_DONE.has(cc.status)) {
      await closeMaintenancePr({ prNumber: apr.prNumber, repo: apr.repo, settings: db.settings });
    }
    setCodeStatus(apr, decision === 'rejected' ? 'closed' : 'revision');
    if (decision === 'revision_requested' && apr.kind !== 'it_pr_merge') {
      // the task is re-queued with the CEO note; let it be re-bundled into a new PR after rework
      for (const t of db.tasks) if (t.id === apr.taskId) delete t.codeBundleId;
    }
    appendLog(
      db,
      'IT 유지보수팀',
      apr.prNumber
        ? `CEO ${decision === 'rejected' ? '반려' : '수정 지시'}에 따라 [${apr.repo}] PR #${apr.prNumber}을 닫았습니다.`
        : `CEO ${decision === 'rejected' ? '반려' : '수정 지시'} 반영: "${apr.title}" 코드 반영 취소.`,
      'info'
    );
    saveDb(db);
    await flushCloudBackup(db);

    if (decision === 'revision_requested') {
      if (apr.kind === 'it_pr_merge') {
        // IT team rewrites the patch with the CEO's note and re-submits automatically
        try {
          const result = await regeneratePrForApproval(aprId, apr.ceoNote || '');
          const fresh = loadDb();
          const mission = fresh.missions.find((m) => m.id === apr.missionId);
          const newApr = createItPrApproval(fresh, mission, result, {
            taskIds: apr.taskIds || [],
            summaryLead: `[CEO 수정 지시 반영] ${apr.ceoNote || ''}`.trim()
          });
          appendLog(fresh, 'IT 유지보수팀', `수정 지시를 반영한 새 PR #${result.prNumber}을 결재에 올렸습니다.`, 'approval');
          saveDb(fresh);
          await flushCloudBackup(fresh);
          sendApprovalNotifications(fresh.settings, newApr, 'IT 유지보수팀');
        } catch (err) {
          const fresh = loadDb();
          appendLog(fresh, 'IT 유지보수팀', `수정 지시 반영 PR 재작성 실패: ${err.message}`, 'warning');
          saveDb(fresh);
        }
      } else if (apr.missionId) {
        autoStartLiveMissionTasks(apr.missionId).catch(() => {});
      }
    }
    return { ok: true };
  }
  return null;
}

export async function recoverCodeApprovalsOnBoot() {
  const db = loadDb();
  const runningCommit = String(process.env.RENDER_GIT_COMMIT || '').trim();
  const bundleMissions = new Set();
  const resumeMerge = [];
  const resumeWatch = [];
  for (const apr of db.approvals) {
    const st = apr.codeChange?.status;
    if (!st) continue;
    if (CODE_STATUS_PENDING.has(st) && !apr.prNumber && ['pending', 'approved'].includes(apr.status)) {
      setCodeStatus(apr, 'waiting_team');
      if (apr.missionId) bundleMissions.add(apr.missionId);
    } else if (st === 'failed' && apr.status === 'pending' && !apr.prNumber && Number(apr.codeChange.retries || 0) < 3) {
      if (apr.missionId) scheduleFailedCodeRetry(apr.missionId, 60 * 1000);
    } else if ((st === 'merging' || (st === 'preparing' && apr.prNumber)) && apr.status === 'approved') {
      setCodeStatus(apr, 'ready');
      resumeMerge.push(apr.id);
    } else if (st === 'merged') {
      const isSelf = String(apr.repo || '').includes('ai-ceo-hub');
      if (isSelf && runningCommit && apr.codeChange.mergeSha === runningCommit) {
        setCodeStatus(apr, 'deployed', { note: `Render 새 버전(${runningCommit.slice(0, 7)}) 기동 확인` });
        appendLog(db, 'IT QA', `CEO Office가 승인 커밋 ${runningCommit.slice(0, 7)}으로 재기동된 것을 확인했습니다.`, 'success');
      } else if (!isSelf) {
        resumeWatch.push(apr.id);
      }
    }
  }
  saveDb(db);
  for (const id of bundleMissions) scheduleCodeBundle(id, 2000);
  for (const id of resumeMerge) applyApprovedCodeChange(id).catch(() => {});
  for (const id of resumeWatch) watchAndReportDeployment(id).catch(() => {});
}

// Manual / API trigger (kept for MCP·API use; the UI no longer needs a separate button)
export async function triggerItPrForMission(missionId, customInstruction = '') {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) throw new Error('미션을 찾을 수 없습니다.');

  const targetRepo = mission.githubRepo || getGithubRepoConfig(db.settings).repo;
  const targetBranch = mission.githubBranch || 'main';
  const effectiveInstruction = String(customInstruction || '').trim() || mission.directive || mission.title;
  if (!itTeamAvailable(db)) {
    const req = outsourceCodeToAgy(db, { mission, title: `[코드 수정] ${String(effectiveInstruction).replace(/\s+/g, ' ').slice(0, 60)}`, goal: effectiveInstruction });
    saveDb(db);
    await flushCloudBackup(db);
    return { ok: true, outsourced: req.id, db };
  }

  appendLog(db, 'IT 유지보수팀', `"${mission.title}" → [${targetRepo}] 실제 소스코드 분석 및 PR 작성 시작…`, 'info');
  saveDb(db);

  try {
    const result = await runItMaintenancePipeline({
      instruction: effectiveInstruction,
      missionTitle: mission.title,
      repoOverride: targetRepo,
      branchOverride: targetBranch,
      siteUrl: mission.siteUrl || '',
      agents: db.agents,
      settings: db.settings
    });
    const fresh = loadDb();
    const apr = createItPrApproval(fresh, mission, result);
    appendLog(
      fresh,
      'IT 유지보수팀',
      `[${result.repo}] 실제 GitHub PR #${result.prNumber} 작성 (${result.changedFiles.join(', ')}) → CEO 배포 결재 상신.`,
      'approval'
    );
    itTeamMessage(
      fresh,
      mission.id,
      `PR #${result.prNumber} 상신`,
      `[${result.repo}] 실제 소스코드(${result.changedFiles.join(', ')})를 수정하고 IT 보안 감사를 마쳐 PR #${result.prNumber}을 열었습니다.\nPR: ${result.prUrl}\n승인하시면 바로 머지 → ${deployLabelFor(result.repo)}까지 진행합니다.`,
      'approval'
    );
    saveDb(fresh);
    await flushCloudBackup(fresh);
    sendApprovalNotifications(fresh.settings, apr, 'IT 유지보수팀');
    return { ok: true, result, approval: apr, db: fresh };
  } catch (err) {
    const fresh = loadDb();
    appendLog(fresh, 'IT 유지보수팀', `"${mission.title}" [${targetRepo}] PR 작성 실패: ${err.message}`, 'warning');
    if (err.code !== 'NO_CODE_CHANGE') {
      notifyTelegramAnomaly(fresh.settings, 'IT팀 GitHub PR 작성 오류', `"${mission.title}" (${targetRepo}) — ${err.message}`);
    }
    saveDb(fresh);
    await flushCloudBackup(fresh);
    throw err;
  }
}
