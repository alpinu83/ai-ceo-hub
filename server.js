import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getRequestListener } from '@hono/node-server';
import {
  loadDb,
  saveDb,
  flushCloudBackup,
  recordAgentHeartbeat,
  appendLog,
  appendMessage,
  initCloudPersistence,
  getCloudPersistenceStatus,
  sanitizeStateForClient,
  createDefaultState,
  applyInferredMissionBindings,
  uid
} from './src/store.js';
import { buildMissionLiveContext } from './src/live-context.js';
import {
  decomposeDirective,
  executeAgentTask,
  buildDispatchPrompt,
  synthesizeMissionReport,
  createApprovalForTask,
  proposeNextProjectPhase,
  testProviderConnection,
  notifyWebhook,
  generateTeamChatReplies,
  generateStandupSession
} from './src/orchestrator.js';
import { handleOfficialMcpHttp, MCP_TOOL_CATALOG } from './src/mcp.js';
import {
  sendTelegramAlert,
  sendTelegramApprovalCard,
  sendTelegramText,
  testTelegramBot,
  handleTelegramUpdate,
  syncTelegramPolling,
  isTelegramPollingActive
} from './src/telegram.js';
import { ensureVapidKeys, sendWebPushNotification } from './src/push.js';
import {
  getGithubRepoConfig,
  testGithubRepoConnection,
  runItMaintenancePipeline,
  mergeMaintenancePr,
  closeMaintenancePr,
  watchDeployment
} from './src/it-devops.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const PORT = Number(process.env.PORT || 3456);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.yaml': 'text/yaml; charset=utf-8'
};

function updateMissionStatus(db, missionId) {
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return;
  const tasks = db.tasks.filter((t) => t.missionId === missionId);
  if (tasks.length === 0) return;
  if (tasks.every((t) => t.status === 'completed')) {
    mission.status = 'completed';
  } else if (tasks.some((t) => t.status === 'awaiting_approval')) {
    mission.status = 'waiting_approval';
  } else {
    mission.status = 'in_progress';
  }
}

async function createMissionInDb({
  title = '',
  directive,
  domain = 'business',
  costPolicy,
  mode = 'one_off',
  githubRepo = '',
  githubBranch = 'main',
  siteUrl = '',
  extraRepos = []
}) {
  const db = loadDb();
  const safeDomain = ['business', 'life', 'content', 'dev', 'it_ops'].includes(domain) ? domain : 'business';
  const safePolicy = ['free_first', 'balanced', 'max_quality'].includes(costPolicy)
    ? costPolicy
    : db.settings.defaultCostPolicy;
  const safeMode = mode === 'project' ? 'project' : 'one_off';

  const autoTitle =
    String(title || '').trim() ||
    directive.split('\n')[0].slice(0, 40) + (directive.length > 40 ? '…' : '');

  const draftBindings = applyInferredMissionBindings({
    title: autoTitle,
    directive,
    domain: safeDomain,
    githubRepo: String(githubRepo || '').trim(),
    githubBranch: String(githubBranch || 'main').trim() || 'main',
    siteUrl: String(siteUrl || '').trim(),
    extraRepos: Array.isArray(extraRepos) ? extraRepos : []
  });

  const plan = await decomposeDirective({
    directive,
    title: autoTitle,
    domain: safeDomain,
    costPolicy: safePolicy,
    agents: db.agents,
    settings: db.settings,
    githubRepo: draftBindings.githubRepo,
    githubBranch: draftBindings.githubBranch,
    siteUrl: draftBindings.siteUrl,
    extraRepos: draftBindings.extraRepos
  });

  const now = new Date().toISOString();
  const mission = {
    id: uid('msn'),
    title: autoTitle,
    directive,
    domain: safeDomain,
    costPolicy: safePolicy,
    mode: safeMode,
    githubRepo: draftBindings.githubRepo || '',
    githubBranch: draftBindings.githubBranch || 'main',
    siteUrl: draftBindings.siteUrl || '',
    extraRepos: draftBindings.extraRepos || [],
    phase: 1,
    phaseHistory: [],
    leadAgentId: plan.leadAgentId,
    status: 'in_progress',
    createdAt: now,
    leadPlanSummary: plan.planSummary,
    finalReport: ''
  };

  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  const createdTasks = plan.tasks.map((t) => {
    const ag = agentMap[t.assigneeId] || db.agents[0];
    const taskObj = {
      id: uid('tsk'),
      missionId: mission.id,
      phase: 1,
      title: t.title,
      description: t.description,
      assigneeId: ag.id,
      domain: t.domain || safeDomain,
      status: ag.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued',
      requiresApproval: Boolean(t.requiresApproval),
      estimatedCostKRW: Number(t.estimatedCostKRW) || 0,
      dispatchPrompt: '',
      output: '',
      executionModeUsed: '',
      createdAt: now,
      updatedAt: now
    };
    taskObj.dispatchPrompt = buildDispatchPrompt(ag, taskObj, mission);
    return taskObj;
  });

  db.missions.unshift(mission);
  db.tasks.unshift(...createdTasks);

  const lead = agentMap[plan.leadAgentId];
  appendLog(
    db,
    lead?.name || '총괄 팀장',
    `새 CEO 지시 "${mission.title}"을(를) ${createdTasks.length}개 실무 작업으로 분해·배정했습니다.${plan.usedLiveApi ? ' (Vercel AI SDK)' : ''}`,
    'info'
  );

  appendMessage(db, {
    missionId: mission.id,
    senderId: 'ceo',
    senderName: `${db.settings.ceoName || '대표님'} (CEO)`,
    senderRole: '최종 지시 · 결재권자',
    senderShortCode: 'CEO',
    senderAccent: '#171614',
    targetAgentId: lead?.id || null,
    statusText: '새 지시 하달',
    type: 'directive',
    text: directive
  });

  const assignSummary = createdTasks
    .map((t) => `@${agentMap[t.assigneeId]?.name || '팀원'} → "${t.title}"`)
    .join(' / ');
  appendMessage(db, {
    missionId: mission.id,
    senderId: lead?.id || 'agent_gemini_neon',
    senderName: lead?.name || '총괄 팀장',
    senderRole: lead?.roleTitle || '총괄 팀장',
    senderShortCode: lead?.shortCode || 'GN',
    senderAccent: lead?.accent || '#0E6245',
    targetAgentId: createdTasks[0]?.assigneeId || null,
    statusText: '업무 분배 완료',
    type: 'plan',
    text: `${plan.planSummary}\n배정 내역: ${assignSummary}`
  });

  saveDb(db);
  flushCloudBackup(db).catch(() => {});

  // Auto-start live API workers immediately without requiring CEO to click "실행"
  // (repo-linked missions: once the team finishes, the IT team turns the team's decisions into a real PR for approval)
  autoStartLiveMissionTasks(mission.id).catch(() => {});

  return { mission, tasks: createdTasks, db };
}

async function autoStartLiveMissionTasks(missionId) {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return;

  const hasLiveEngine = Boolean(
    db.settings?.providers?.gemini?.apiKey ||
      db.settings?.providers?.openrouter?.apiKey ||
      db.settings?.providers?.groq?.apiKey ||
      db.settings?.providers?.exaone?.apiKey
  );
  if (!hasLiveEngine) return;

  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  // Under Team Lead authority: auto-run ALL internal AI tasks without waiting for CEO clicks
  const internalProviders = new Set(['exaone', 'gemini', 'groq', 'openrouter']);
  const autoTargets = db.tasks.filter((t) => {
    if (t.missionId !== missionId) return false;
    if (t.status !== 'queued' && t.status !== 'awaiting_bridge') return false;
    const ag = agentMap[t.assigneeId];
    return Boolean(ag && internalProviders.has(ag.provider));
  });

  // Ensure external bot tasks are cleanly marked as awaiting external inbox/MCP (never sitting in "실행 대기")
  const externalProviders = new Set(['pickle', 'manus', 'muse', 'vooy', 'instinct']);
  for (const t of db.tasks) {
    if (t.missionId === missionId && t.status === 'queued') {
      const ag = agentMap[t.assigneeId];
      if (ag && externalProviders.has(ag.provider)) {
        t.status = 'awaiting_bridge';
      }
    }
  }

  if (autoTargets.length === 0) {
    saveDb(db);
    return;
  }

  const startIso = new Date().toISOString();
  for (const t of autoTargets) {
    t.status = 'running';
    t.updatedAt = startIso;
  }
  saveDb(db);

  await Promise.all(
    autoTargets.map(async (target) => {
      const ag = agentMap[target.assigneeId];
      try {
        const res = await executeAgentTask({ task: target, mission, agent: ag, settings: db.settings });
        const fresh = loadDb();
        const taskRow = fresh.tasks.find((x) => x.id === target.id);
        if (!taskRow) return;
        const doneIso = new Date().toISOString();
        taskRow.output = res.output;
        taskRow.executionModeUsed = res.executionModeUsed;
        taskRow.updatedAt = doneIso;

        if (taskRow.requiresApproval) {
          taskRow.status = 'awaiting_approval';
          const existing = fresh.approvals.find((a) => a.taskId === taskRow.id && a.status === 'pending');
          if (!existing) {
            const apr = createApprovalForTask(taskRow, ag, mission);
            fresh.approvals.unshift(apr);
            const leadAg = fresh.agents.find((a) => a.id === (mission.leadAgentId || 'agent_gemini_neon'));
            notifyAllApprovalChannels(fresh.settings, apr, leadAg?.name || 'Gemini 4 Hydrogen');
          }
          appendLog(fresh, 'Gemini 4 Hydrogen (총괄 팀장)', `"${taskRow.title}" 검토 완료 → 중요 의사결정으로 CEO 결재 상신.`, 'approval');
        } else {
          taskRow.status = 'completed';
          appendLog(fresh, ag.name, `"${taskRow.title}" 팀장 전결 자동 완료.`, 'success');
          notifyTaskCompleted(fresh.settings, taskRow, ag.name);
        }

        const firstLine = (res.output || '')
          .split('\n')
          .find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('>'))
          ?.replace(/^[-*]\s*/, '')
          .slice(0, 140);
        appendMessage(fresh, {
          missionId: mission.id,
          senderId: ag.id,
          senderName: ag.name,
          senderRole: ag.roleTitle,
          senderShortCode: ag.shortCode,
          senderAccent: ag.accent,
          targetAgentId: taskRow.requiresApproval ? 'ceo' : (mission.leadAgentId || 'agent_gemini_neon'),
          statusText: taskRow.requiresApproval ? '결재 상신' : '자동 완료',
          type: taskRow.requiresApproval ? 'approval' : 'work',
          text: `[팀장 위임 완료] "${taskRow.title}" ${taskRow.requiresApproval ? '검토를 마쳐 CEO 결재함에 올렸습니다.' : '완료했습니다.'}${firstLine ? ` — ${firstLine}` : ''}`
        });

        updateMissionStatus(fresh, mission.id);
        saveDb(fresh);
        await flushCloudBackup(fresh);
      } catch (err) {
        const fresh = loadDb();
        const taskRow = fresh.tasks.find((x) => x.id === target.id);
        if (taskRow) {
          taskRow.status = 'queued';
          taskRow.updatedAt = new Date().toISOString();
        }
        appendLog(fresh, ag.name, `"${target.title}" 자동 실행 오류: ${err.message}`, 'warning');
        notifyTelegramAnomaly(fresh.settings, `${ag.name} 업무 실행 이상`, `"${target.title}" — ${err.message}`);
        saveDb(fresh);
      }
    })
  );

  // Team Lead automatically compiles executive summary once internal tasks finish
  let isProjectMission = false;
  try {
    const finalDb = loadDb();
    const freshMission = finalDb.missions.find((m) => m.id === missionId);
    if (freshMission) {
      isProjectMission = freshMission.mode === 'project';
      const mTasks = finalDb.tasks.filter((t) => t.missionId === missionId);
      freshMission.finalReport = await synthesizeMissionReport({
        mission: freshMission,
        tasks: mTasks,
        agents: finalDb.agents,
        settings: finalDb.settings
      });
      saveDb(finalDb);
      await flushCloudBackup(finalDb);
    }
  } catch {
    // non-fatal
  }

  // Repo-linked missions: the team's decisions become ONE real PR attached to the approval card (no extra CEO instruction)
  try {
    const dbAfter = loadDb();
    const m2 = dbAfter.missions.find((m) => m.id === missionId);
    if (getMissionRepoCfg(dbAfter.settings, m2)) {
      await runCodeBundle(missionId);
    }
  } catch (err) {
    console.warn('code bundle after team work failed:', err.message);
  }

  // Continuous Project mode: Team Lead automatically analyzes results and proposes the next phase for CEO approval
  try {
    if (isProjectMission) {
      await submitNextPhaseProposal(missionId);
    }
  } catch {
    // non-fatal
  }
}

async function submitNextPhaseProposal(missionId) {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return { ok: false, error: '미션을 찾을 수 없습니다.' };

  const currentPhase = Number(mission.phase) || 1;
  const nextPhase = currentPhase + 1;
  const existing = db.approvals.find(
    (a) =>
      a.missionId === missionId &&
      a.kind === 'next_phase' &&
      a.status === 'pending' &&
      Number(a.proposedPhase) === nextPhase
  );
  if (existing) {
    return { ok: true, approval: existing, alreadyPending: true, db };
  }

  const missionTasks = db.tasks.filter((t) => t.missionId === missionId);
  const proposal = await proposeNextProjectPhase({
    mission,
    tasks: missionTasks,
    agents: db.agents,
    settings: db.settings
  });

  const leadId = mission.leadAgentId || 'agent_gemini_neon';
  const lead = db.agents.find((a) => a.id === leadId) || db.agents[0];
  const now = new Date().toISOString();
  const stepsText = (proposal.suggestedSteps || []).map((s, i) => `${i + 1}. ${s}`).join('\n');

  const apr = {
    id: uid('apr'),
    missionId: mission.id,
    taskId: '',
    kind: 'next_phase',
    proposedPhase: proposal.nextPhase,
    proposedDirective: proposal.nextDirective,
    proposedSteps: proposal.suggestedSteps || [],
    agentId: leadId,
    title: `[Phase ${proposal.nextPhase} 제안] ${proposal.nextPhaseTitle}`,
    category: '다음 단계 제안',
    riskLevel: 'low',
    estimatedCostKRW: 0,
    depositKRW: 0,
    summary: `${proposal.rationale}\n\n기대 효과: ${proposal.expectedImpact}`,
    proposedAction: `승인 시 총괄 팀장(${lead?.name || 'Gemini 4 Hydrogen'})이 Phase ${proposal.nextPhase} 작업을 자동 분배·착수합니다:\n${stepsText}`,
    status: 'pending',
    ceoNote: '',
    createdAt: now,
    decidedAt: null
  };

  db.approvals.unshift(apr);
  mission.status = 'waiting_approval';

  appendLog(
    db,
    `${lead?.name || 'Gemini 4 Hydrogen'} (총괄 팀장)`,
    `프로젝트 "${mission.title}" Phase ${proposal.nextPhase} 후속 추진안을 CEO 결재함에 제안했습니다.`,
    'approval'
  );
  appendMessage(db, {
    missionId: mission.id,
    senderId: leadId,
    senderName: lead?.name || 'Gemini 4 Hydrogen',
    senderRole: lead?.roleTitle || '총괄 팀장',
    senderShortCode: lead?.shortCode || 'GN',
    senderAccent: lead?.accent || '#0E6245',
    targetAgentId: 'ceo',
    statusText: `Phase ${proposal.nextPhase} 제안`,
    type: 'approval',
    text: `@대표님 Phase ${currentPhase} 결과를 검토하고 다음 단계(Phase ${proposal.nextPhase}: ${proposal.nextPhaseTitle}) 추진안을 결재함에 올렸습니다. 승인해 주시면 바로 착수하겠습니다.`
  });

  saveDb(db);
  await flushCloudBackup(db);
  notifyAllApprovalChannels(db.settings, apr, lead?.name || 'Gemini 4 Hydrogen');
  return { ok: true, approval: apr, proposal, db };
}

async function launchNextProjectPhase(missionId, nextDirective, ceoNote = '') {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return null;

  const prevPhase = Number(mission.phase) || 1;
  const nextPhase = prevPhase + 1;
  const now = new Date().toISOString();

  mission.mode = 'project';
  mission.phaseHistory = Array.isArray(mission.phaseHistory) ? mission.phaseHistory : [];
  if (mission.finalReport) {
    mission.phaseHistory.unshift({
      phase: prevPhase,
      report: mission.finalReport,
      completedAt: now
    });
  }
  mission.phase = nextPhase;
  mission.finalReport = '';
  mission.status = 'in_progress';

  const combinedDirective = ceoNote
    ? `${nextDirective}\n[CEO 승인 메모 반영] ${ceoNote}`
    : nextDirective;

  const plan = await decomposeDirective({
    directive: combinedDirective,
    title: `${mission.title} (Phase ${nextPhase})`,
    domain: mission.domain,
    costPolicy: mission.costPolicy,
    agents: db.agents,
    settings: db.settings,
    githubRepo: mission.githubRepo || '',
    githubBranch: mission.githubBranch || 'main',
    siteUrl: mission.siteUrl || '',
    extraRepos: Array.isArray(mission.extraRepos) ? mission.extraRepos : []
  });

  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  const newTasks = plan.tasks.map((t) => {
    const ag = agentMap[t.assigneeId] || db.agents[0];
    const taskObj = {
      id: uid('tsk'),
      missionId: mission.id,
      phase: nextPhase,
      title: t.title,
      description: t.description,
      assigneeId: ag.id,
      domain: t.domain || mission.domain,
      status: ag.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued',
      requiresApproval: Boolean(t.requiresApproval),
      estimatedCostKRW: Number(t.estimatedCostKRW) || 0,
      dispatchPrompt: '',
      output: '',
      executionModeUsed: '',
      createdAt: now,
      updatedAt: now
    };
    taskObj.dispatchPrompt = buildDispatchPrompt(ag, taskObj, mission);
    return taskObj;
  });

  db.tasks.unshift(...newTasks);
  mission.leadPlanSummary = plan.planSummary;

  const lead = agentMap[mission.leadAgentId || 'agent_gemini_neon'];
  appendLog(
    db,
    `${lead?.name || 'Gemini 4 Hydrogen'} (총괄 팀장)`,
    `CEO 승인을 받아 "${mission.title}" Phase ${nextPhase} (${newTasks.length}개 실무)에 자동 착수했습니다.`,
    'success'
  );
  appendMessage(db, {
    missionId: mission.id,
    senderId: lead?.id || 'agent_gemini_neon',
    senderName: lead?.name || 'Gemini 4 Hydrogen',
    senderRole: lead?.roleTitle || '총괄 팀장',
    senderShortCode: lead?.shortCode || 'GN',
    senderAccent: lead?.accent || '#0E6245',
    targetAgentId: newTasks[0]?.assigneeId || null,
    statusText: `Phase ${nextPhase} 착수`,
    type: 'plan',
    text: `CEO 승인으로 Phase ${nextPhase}를 시작합니다! ${newTasks.map((t) => `@${agentMap[t.assigneeId]?.name || '팀원'} → "${t.title}"`).join(' / ')}`
  });

  saveDb(db);
  await flushCloudBackup(db);
  autoStartLiveMissionTasks(mission.id).catch(() => {});
  return { mission, newTasks, db };
}

function applyApprovalDecisionInDb(aprId, decision, ceoNote = '') {
  if (!['approved', 'revision_requested', 'rejected'].includes(decision)) {
    return { ok: false, status: 400, error: '올바른 결재 결정 값이 아닙니다.' };
  }

  const db = loadDb();
  const apr = db.approvals.find((a) => a.id === aprId);
  if (!apr) return { ok: false, status: 404, error: '결재 안건을 찾을 수 없습니다.' };

  const now = new Date().toISOString();
  apr.status = decision;
  apr.ceoNote = String(ceoNote || '').trim();
  apr.decidedAt = now;

  const task = db.tasks.find((t) => t.id === apr.taskId);
  const agent = db.agents.find((a) => a.id === apr.agentId);

  if (decision === 'approved') {
    const costAdd = Number(apr.depositKRW || apr.estimatedCostKRW || 0);
    if (costAdd > 0) {
      db.settings.spentThisMonthKRW = (db.settings.spentThisMonthKRW || 0) + costAdd;
      if (agent) agent.spentKRW = (agent.spentKRW || 0) + costAdd;
    }
  }

  if (task) {
    if (decision === 'approved') {
      task.status = 'completed';
      task.output = `${task.output || ''}\n\n---\n**CEO 최종 승인 완료** (${new Date().toLocaleString('ko-KR')})${apr.ceoNote ? `\n- CEO 메모: ${apr.ceoNote}` : ''}`.trim();
    } else if (decision === 'revision_requested') {
      task.status = agent?.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
      if (apr.ceoNote) {
        task.description = `${task.description}\n[CEO 수정 지시] ${apr.ceoNote}`;
        const mission = db.missions.find((m) => m.id === task.missionId);
        if (agent && mission) task.dispatchPrompt = buildDispatchPrompt(agent, task, mission);
      }
    } else {
      task.status = 'rejected';
    }
    task.updatedAt = now;
    updateMissionStatus(db, task.missionId);
  }

  const labelMap = { approved: '승인', revision_requested: '수정 지시', rejected: '반려' };
  appendLog(
    db,
    'CEO',
    `결재 [${labelMap[decision]}]: "${apr.title}"${apr.ceoNote ? ` — "${apr.ceoNote}"` : ''}`,
    decision === 'approved' ? 'success' : 'warning'
  );

  saveDb(db);
  return { ok: true, approval: apr, title: apr.title, db };
}

// ================================================================
// 결재 = 실코드 반영 엔진
// AI 팀 협업 결과 → (자동) 실제 저장소 PR 작성·보안 감사 → 결재 카드에 diff 첨부
// → CEO 승인 한 번으로 main 머지 → 라이브 배포 → 배포 결과 확인·보고
// ================================================================
const CODE_CONTEXT_RE =
  /배포|코드|패치|수정|버그|오류|에러|\bPR\b|SEO|메타|스키마|JSON-?LD|사이트맵|sitemap|robots|페이지|HTML|CSS|자바스크립트|\bJS\b|계산기|세율|요율|\bUI\b|\bUX\b|화면|버튼|레이아웃|문구|카피|광고\s*(태그|코드|슬롯|배치|위치|교체|로직)|애드센스|AdSense|GA4?\s*태그|기능|구현|리팩터|성능|속도|보안\s*(패치|수정|점검|검증)|접근성|모바일/i;
const NON_CODE_DECISION_RE = /결제|송금|광고비|광고\s*집행|예약\s*확정|최종\s*예약|계약|입금|구매|대외\s*발송|이메일\s*발송/;
const CODE_STATUS_PENDING = new Set(['waiting_team', 'preparing']);
const CODE_STATUS_DONE = new Set(['merging', 'merged', 'deployed', 'deploy_failed', 'deploy_unknown']);
const codeBundleLocks = new Map();
const codeBundleTimers = new Map();
const failedRetryTimers = new Map();

// AI quota / provider hiccups are usually temporary: retry failed PR preparation in the background (max 3 times)
function scheduleFailedCodeRetry(missionId, delayMs) {
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

function getMissionRepoCfg(settings, mission) {
  if (!mission?.githubRepo) return null;
  const cfg = getGithubRepoConfig(settings, { repo: mission.githubRepo, branch: mission.githubBranch });
  if (!cfg.enabled) return null;
  if (cfg.allowedRepos.length && !cfg.allowedRepos.includes(cfg.repo)) return null;
  return cfg;
}

function isCodeTask(task, agent) {
  if (!task) return false;
  const text = `${task.title || ''} ${task.description || ''}`;
  if ((Number(task.estimatedCostKRW) || 0) > 0 || NON_CODE_DECISION_RE.test(text)) return false;
  return task.domain === 'it_ops' || task.domain === 'dev' || agent?.team === 'it' || CODE_CONTEXT_RE.test(text);
}

function isCodeApproval(db, apr) {
  if (!apr || apr.kind === 'next_phase') return false;
  if (apr.kind === 'it_pr_merge' || apr.prNumber) return true;
  const mission = db.missions.find((m) => m.id === apr.missionId);
  if (!getMissionRepoCfg(db.settings, mission)) return false;
  const task = db.tasks.find((t) => t.id === apr.taskId);
  if (!task) return false;
  const agent = db.agents.find((a) => a.id === task.assigneeId);
  return isCodeTask(task, agent);
}

function deployLabelFor(repo = '') {
  if (repo.includes('kr-calc-hub')) return 'korea-tax-cal.com 라이브 빌드·배포(GitHub Actions)';
  if (repo.includes('ai-ceo-hub')) return 'CEO Office(Render) 라이브 배포';
  if (repo.includes('github.io')) return 'GitHub Pages 배포';
  return `${repo} 자동 배포`;
}

function buildTeamDecisionContext(db, mission, tasks, ceoNote = '') {
  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  const lines = tasks.map((t, i) => {
    const ag = agentMap[t.assigneeId];
    const body = String(t.output || t.description || '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 700);
    return `${i + 1}. [${t.title}] (${ag?.name || '팀원'})\n${body}`;
  });
  return [
    `[프로젝트] ${mission.title}${mission.mode === 'project' ? ` (Phase ${Number(mission.phase) || 1})` : ''}`,
    lines.join('\n\n'),
    mission.finalReport ? `[팀장 종합 보고 요약]\n${String(mission.finalReport).slice(0, 800)}` : '',
    ceoNote ? `[CEO 결재 메모]\n${ceoNote}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 3500);
}

function buildCodeInstruction(mission, tasks, extraNote = '') {
  const titles = tasks
    .map((t) => t.title)
    .filter(Boolean)
    .slice(0, 6)
    .join(' / ');
  return `${String(mission.directive || mission.title || '').slice(0, 1500)}\n\n[이번 결재 대상] ${titles || mission.title}\n위 지시와 AI 팀 협업 결정사항 중 이 저장소에 바로 반영할 수 있는 변경을 실제 코드로 구현하세요.${
    extraNote ? `\n[CEO 수정 지시] ${extraNote}` : ''
  }`;
}

function setCodeStatus(apr, status, extra = {}) {
  apr.codeChange = { ...(apr.codeChange || {}), ...extra, status, updatedAt: new Date().toISOString() };
}

function applyPrFieldsToApproval(apr, result, extra = {}) {
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

function isAuditSafe(result) {
  return result?.audit?.passed !== false && result?.audit?.riskLevel !== 'high';
}

function createItPrApproval(db, mission, result, { taskIds = [], titlePrefix = '', summaryLead = '' } = {}) {
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
    summary: `${summaryLead ? `${summaryLead}\n\n` : ''}${result.prSummary}\n\n[대상 저장소] ${result.repo} (${result.branch})\n[수정 파일] ${result.changedFiles.join(', ')}\n[IT 보안 감사: ${result.audit?.passed ? 'PASS' : '주의'} · ${String(result.audit?.riskLevel || '').toUpperCase()}] ${result.audit?.notes || ''}\n[GitHub PR] ${result.prUrl}`,
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

function itTeamMessage(db, missionId, statusText, text, type = 'work') {
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

function scheduleCodeBundle(missionId, delayMs = 4000) {
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

function runCodeBundle(missionId, opts = {}) {
  if (codeBundleLocks.has(missionId)) return codeBundleLocks.get(missionId);
  const job = runCodeBundleInner(missionId, opts).finally(() => codeBundleLocks.delete(missionId));
  codeBundleLocks.set(missionId, job);
  return job;
}

async function waitForMissionIdle(missionId, maxMs = 240000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const db = loadDb();
    if (!db.tasks.some((t) => t.missionId === missionId && t.status === 'running')) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

function maybeScheduleCodeBundle(db, mission, task) {
  try {
    if (!mission || !task || task.status !== 'completed') return;
    if (!getMissionRepoCfg(db.settings, mission)) return;
    const agent = db.agents.find((a) => a.id === task.assigneeId);
    if (isCodeTask(task, agent)) scheduleCodeBundle(mission.id, 8000);
  } catch {
    // non-fatal
  }
}

/**
 * Turns the team's finished work (and any held deploy approvals) into ONE real PR,
 * attaches it to the approval card, and only then notifies the CEO.
 */
async function runCodeBundleInner(missionId, { retryEmpty = false } = {}) {
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
        apr.summary = `${apr.summary}\n\n[실코드 변경안] ${result.prSummary}\n[수정 파일] ${result.changedFiles.join(', ')}\n[IT 보안 감사: ${result.audit?.passed ? 'PASS' : '주의'} · ${String(result.audit?.riskLevel || '').toUpperCase()}] ${result.audit?.notes || ''}`;
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
    saveDb(db);
    await flushCloudBackup(db);

    let applied = false;
    for (const apr of targets) {
      if (apr.status === 'pending') {
        sendApprovalNotifications(db.settings, apr, apr.codeChange?.agentName || 'IT 유지보수팀');
      } else if (apr.status === 'approved' && !applied) {
        applied = true;
        applyApprovedCodeChange(apr.id).catch((err) => console.warn('apply code change error:', err.message));
      }
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
  saveDb(db);
  await flushCloudBackup(db);
  if (!noChange && freshWaiting.length === 0) {
    notifyTelegramAnomaly(db.settings, 'IT팀 실코드 변경안 작성 실패', `"${mission.title}" (${cfg.repo}) — ${failure?.message}`);
  }
  let retryNeeded = false;
  for (const apr of freshWaiting) {
    if (apr.status === 'pending') {
      if (!noChange && Number(apr.codeChange?.retries || 0) < 3) retryNeeded = true;
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
async function regeneratePrForApproval(aprId, extraNote = '') {
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

function holdForSecurityReview(db, apr, result, mission) {
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
async function applyApprovedCodeChange(aprId) {
  let db = loadDb();
  let apr = db.approvals.find((a) => a.id === aprId);
  if (!apr || apr.status !== 'approved') return null;
  if (CODE_STATUS_DONE.has(apr.codeChange?.status)) return null;

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
      setCodeStatus(apr, 'ready');
      saveDb(db);
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

async function mergeApprovedPr(aprId, attempt = 1) {
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

async function watchAndReportDeployment(aprId) {
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
  if (res.status === 'success') {
    setCodeStatus(apr, 'deployed', { deployRuns: res.runs });
    appendLog(db, 'IT QA', `[${apr.repo}] ${sha7} 배포 워크플로 성공 확인 (${runNames}).`, 'success');
    itTeamMessage(
      db,
      apr.missionId,
      '배포 완료 확인',
      `[${apr.repo}] ${sha7} 배포 워크플로가 모두 성공했습니다 (${runNames}).${isSelf ? ' Render는 새 이미지로 재시작 중이며, 재기동 후 버전을 다시 확인합니다.' : ''}`
    );
    sendTelegramAlert(db.settings, `실배포 완료: ${apr.repo}`, `${apr.title}\n커밋 ${sha7} · ${deployLabelFor(apr.repo)}`).catch(() => {});
  } else if (res.status === 'failure') {
    const failedRun = (res.runs || []).find((r) => !['success', 'skipped', 'neutral'].includes(r.conclusion));
    setCodeStatus(apr, 'deploy_failed', { deployRuns: res.runs, error: failedRun?.name || '' });
    appendLog(db, 'IT QA', `[${apr.repo}] ${sha7} 배포 실패 (${runNames}) ${failedRun?.url || ''}`, 'warning');
    notifyTelegramAnomaly(db.settings, `배포 실패: ${apr.repo}`, `${apr.title}\n${failedRun?.url || runNames}`);
  } else {
    setCodeStatus(apr, 'deploy_unknown', { deployRuns: res.runs, note: res.reason || '' });
    appendLog(db, 'IT QA', `[${apr.repo}] ${sha7} 머지 완료 · 배포 상태 자동 확인 불가 (${res.reason || '알 수 없음'}).`, 'info');
  }
  saveDb(db);
  await flushCloudBackup(db);
  return res;
}

/**
 * Called after any CEO decision. Approve = real code applied & deployed. No extra instruction needed.
 */
async function handleCodeDecision(aprId, decision) {
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

async function recoverCodeApprovalsOnBoot() {
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
async function triggerItPrForMission(missionId, customInstruction = '') {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) throw new Error('미션을 찾을 수 없습니다.');

  const targetRepo = mission.githubRepo || getGithubRepoConfig(db.settings).repo;
  const targetBranch = mission.githubBranch || 'main';
  const effectiveInstruction = String(customInstruction || '').trim() || mission.directive || mission.title;

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

function getTelegramCallbacks() {
  return {
    getSettings: () => loadDb().settings,
    onAutoRegisterChatId: async (chatId) => {
      const db = loadDb();
      db.settings.telegram = db.settings.telegram || { botToken: '', chatId: '', pollingEnabled: true };
      db.settings.telegram.chatId = String(chatId).trim();
      appendLog(db, '텔레그램 봇', `CEO Chat ID(${chatId})를 /start로 자동 등록했습니다.`, 'success');
      saveDb(db);
      await flushCloudBackup(db);
    },
    onDecision: async (aprId, decision, note) => {
      const res = applyApprovalDecisionInDb(aprId, decision, note);
      if (res.ok && res.approval?.kind === 'next_phase' && decision === 'approved' && res.approval.proposedDirective) {
        await launchNextProjectPhase(res.approval.missionId, res.approval.proposedDirective, note);
      } else if (res.ok && isCodeApproval(res.db, res.approval)) {
        res.codeApply = decision === 'approved';
        handleCodeDecision(res.approval.id, decision).catch((err) => {
          const fresh = loadDb();
          appendLog(fresh, 'IT 유지보수팀', `"${res.approval.title}" 실코드 처리 오류: ${err.message}`, 'warning');
          saveDb(fresh);
        });
      }
      return res;
    },
    onStatus: async () => {
      const db = loadDb();
      const pending = db.approvals.filter((a) => a.status === 'pending').length;
      const activeMissions = db.missions.filter((m) => m.status !== 'completed').length;
      const activeAgents = db.agents.filter((a) => a.active).length;
      return [
        `<b>${db.settings.companyName} 현황 보고</b>`,
        `• 활성 AI 팀원: ${activeAgents}명`,
        `• 진행 중 업무: ${activeMissions}건`,
        `• CEO 결재 대기: <b>${pending}건</b>`,
        ``,
        `명령어: /approvals · /order 지시내용`
      ].join('\n');
    },
    onListPending: async () => {
      const db = loadDb();
      const map = Object.fromEntries(db.agents.map((a) => [a.id, a.name]));
      return db.approvals
        .filter((a) => a.status === 'pending')
        .map((approval) => ({ approval, agentName: map[approval.agentId] || approval.agentId }));
    },
    onOrder: async (directive) => {
      const { mission, tasks } = await createMissionInDb({ directive, domain: 'business' });
      return { title: mission.title, taskCount: tasks.length };
    }
  };
}

function notifyAllApprovalChannels(settings, apr, agentName) {
  // Code/deploy decisions in repo-linked missions: hold the card until the IT team attaches the real PR (diff),
  // so the CEO approves the actual change and approval alone merges & deploys it.
  if (apr && !apr.kind && apr.taskId && !apr.codeChange && !apr.prNumber) {
    try {
      const db = loadDb();
      if (isCodeApproval(db, apr)) {
        setCodeStatus(apr, 'waiting_team', { agentName: agentName || '' });
        apr.proposedAction = `IT팀이 팀 결정사항을 실제 코드(PR)로 작성 중입니다. 승인 시 main 머지 → ${deployLabelFor(getMissionRepoCfg(db.settings, db.missions.find((m) => m.id === apr.missionId))?.repo || '')}까지 자동 진행합니다.`;
        scheduleCodeBundle(apr.missionId);
        return;
      }
    } catch {
      // fall through to normal notification
    }
  }
  sendApprovalNotifications(settings, apr, agentName);
}

function sendApprovalNotifications(settings, apr, agentName) {
  let missionLabel = '';
  try {
    const db = loadDb();
    const msn = db.missions.find((m) => m.id === apr?.missionId);
    if (msn) {
      missionLabel = `${msn.mode === 'project' ? `[프로젝트 P${Number(msn.phase) || 1}] ` : '[일반 업무] '}${msn.title}`;
    }
  } catch {
    // ignore
  }
  notifyWebhook(settings, 'approval_requested', { ...apr, missionLabel }).catch(() => {});
  sendTelegramApprovalCard(settings, apr, agentName, missionLabel).catch(() => {});
  sendWebPushNotification({
    title: missionLabel ? `[결재 · ${missionLabel}]` : `[결재 요청] ${apr.title}`,
    body: `${apr.title} · ${agentName || '총괄 팀장'}`,
    view: 'approvals',
    tag: `apr-${apr.id}`
  }).catch(() => {});
}

function notifyTaskCompleted(_settings, task, agentName) {
  // Routine task completion: quiet Web Push only — NEVER spam CEO's Telegram!
  // Telegram is strictly reserved for CEO approvals and anomalies/alerts.
  sendWebPushNotification({
    title: `[업무 완료] ${task.title}`,
    body: `${agentName || 'AI 팀원'}가 작업을 완료했습니다.`,
    view: 'missions',
    tag: `tsk-${task.id}`
  }).catch(() => {});
}

function notifyTelegramAnomaly(settings, title, detail) {
  sendTelegramAlert(settings, title, detail).catch(() => {});
  sendWebPushNotification({
    title: `[특이점 알림] ${title}`,
    body: String(detail || '').slice(0, 100),
    view: 'command',
    tag: `alert-${Date.now()}`
  }).catch(() => {});
}

const app = new Hono();
app.use('*', cors());

// Optional CEO admin lock: set CEO_ADMIN_KEY on the server to require the key for every /api call
// except health checks and endpoints that carry their own token (agent inbox, MCP, Telegram webhook secret).
const CEO_ADMIN_KEY = String(process.env.CEO_ADMIN_KEY || '').trim();
const ADMIN_OPEN_PATHS = [
  /^\/api\/health$/,
  /^\/api\/push\/public-key$/,
  /^\/api\/agent-inbox\//,
  /^\/api\/telegram\/webhook$/,
  /^\/api\/mcp(\/info)?$/,
  /^\/api\/auth\/telegram-(request|verify)$/
];
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
app.use('/api/*', async (c, next) => {
  if (!CEO_ADMIN_KEY || c.req.method === 'OPTIONS') return next();
  const pathname = new URL(c.req.url).pathname;
  if (ADMIN_OPEN_PATHS.some((re) => re.test(pathname))) return next();
  if (safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY)) return next();
  return c.json({ error: 'CEO 관리자 키가 필요합니다.', code: 'CEO_KEY_REQUIRED' }, 401);
});

// Telegram login: the CEO's own Telegram chat receives a one-time code + link, so no key needs to be typed or remembered.
const telegramLogins = new Map(); // id -> { token, code, expiresAt, attempts }
let lastTelegramLoginAt = 0;
app.post('/api/auth/telegram-request', async (c) => {
  if (!CEO_ADMIN_KEY) return c.json({ ok: true, unlocked: true });
  const now = Date.now();
  if (now - lastTelegramLoginAt < 20000) {
    return c.json({ ok: false, error: '방금 보냈습니다. 텔레그램을 확인해 주세요. (20초 후 재요청 가능)' }, 429);
  }
  const tg = loadDb().settings?.telegram || {};
  if (!tg.botToken || !tg.chatId) {
    return c.json({ ok: false, error: '텔레그램 봇이 연결되어 있지 않습니다. 관리자 키를 직접 입력해 주세요.' }, 400);
  }
  lastTelegramLoginAt = now;
  for (const [id, v] of telegramLogins) if (v.expiresAt < now) telegramLogins.delete(id);
  const token = crypto.randomBytes(24).toString('hex');
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  telegramLogins.set(uid('login'), { token, code, expiresAt: now + 10 * 60 * 1000, attempts: 0 });
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'ai-ceo-hub.onrender.com';
  const proto = /^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https';
  const link = `${proto}://${host}/#login=${token}`;
  try {
    await sendTelegramText(
      tg.botToken,
      tg.chatId,
      `<b>CEO Office 로그인</b>\n로그인 코드: <code>${code}</code>\n또는 이 링크를 여세요: ${link}\n(10분 유효 · 1회용. 직접 요청하지 않았다면 무시하세요.)`
    );
  } catch (err) {
    return c.json({ ok: false, error: `텔레그램 발송 실패: ${err.message}` }, 502);
  }
  return c.json({ ok: true });
});
app.post('/api/auth/telegram-verify', async (c) => {
  if (!CEO_ADMIN_KEY) return c.json({ ok: true, key: '' });
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  const code = String(body.code || '').replace(/\D/g, '');
  const now = Date.now();
  for (const [id, v] of telegramLogins) {
    if (v.expiresAt < now || v.attempts >= 5) {
      telegramLogins.delete(id);
      continue;
    }
    if ((token && safeEqual(token, v.token)) || (code && safeEqual(code, v.code))) {
      telegramLogins.delete(id);
      return c.json({ ok: true, key: CEO_ADMIN_KEY });
    }
  }
  if (code) for (const v of telegramLogins.values()) v.attempts += 1;
  return c.json({ ok: false, error: '코드가 맞지 않거나 만료됐습니다. 다시 요청해 주세요.' }, 401);
});

// Health Check (for Railway, Render, Docker)
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    version: PKG.version,
    uptimeSec: Math.round(process.uptime()),
    telegramPolling: isTelegramPollingActive(),
    cloudBackup: getCloudPersistenceStatus()
  })
);

// Native Web Push (VAPID) Endpoints — works on Android PWA, PC Chrome, iOS Home Screen PWA
app.get('/api/push/public-key', (c) => {
  const db = loadDb();
  const { publicKey } = ensureVapidKeys(db);
  return c.json({
    ok: true,
    publicKey,
    subscribedCount: (db.pushSubscriptions || []).length
  });
});

app.post('/api/push/subscribe', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const sub = body.subscription || body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return c.json({ ok: false, error: '유효한 푸시 구독 정보가 아닙니다.' }, 400);
  }
  const db = loadDb();
  ensureVapidKeys(db);
  db.pushSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  const existingIdx = db.pushSubscriptions.findIndex((s) => s.endpoint === sub.endpoint);
  const entry = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    deviceLabel: String(body.deviceLabel || '').slice(0, 60),
    createdAt: new Date().toISOString()
  };
  if (existingIdx >= 0) db.pushSubscriptions[existingIdx] = entry;
  else db.pushSubscriptions.push(entry);
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ ok: true, subscribedCount: db.pushSubscriptions.length });
});

app.post('/api/push/unsubscribe', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const endpoint = String(body.endpoint || '').trim();
  const db = loadDb();
  db.pushSubscriptions = (db.pushSubscriptions || []).filter((s) => s.endpoint !== endpoint);
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ ok: true, subscribedCount: db.pushSubscriptions.length });
});

app.post('/api/push/test', async (c) => {
  const res = await sendWebPushNotification({
    title: 'CEO Office 푸시 알림 연결 완료',
    body: '이제 결재 요청이나 업무가 완료되면 앱을 닫아둬도 바로 알림이 옵니다!',
    view: 'approvals',
    tag: 'push-test'
  });
  if (res.total === 0) {
    return c.json({ ok: false, error: '등록된 알림 기기가 없습니다. 먼저 [알림 켜기]를 눌러주세요.' }, 400);
  }
  return c.json({ ok: res.sent > 0, ...res });
});

// Open-source vendor bundles served directly from node_modules
app.get('/vendor/marked.umd.js', (c) => {
  const file = fs.readFileSync(path.join(__dirname, 'node_modules/marked/lib/marked.umd.js'), 'utf8');
  return c.body(file, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
});

app.get('/vendor/lucide.min.js', (c) => {
  const file = fs.readFileSync(path.join(__dirname, 'node_modules/lucide/dist/umd/lucide.min.js'), 'utf8');
  return c.body(file, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
});

// State & Open-Source Stack Info
app.get('/api/state', (c) => {
  const db = loadDb();
  return c.json(sanitizeStateForClient(db));
});

app.get('/api/oss-stack', (c) => {
  const deps = PKG.dependencies || {};
  return c.json({
    builtIn: [
      {
        name: 'Hono',
        repo: 'honojs/hono',
        url: 'https://github.com/honojs/hono',
        version: deps.hono,
        role: '초경량 고성능 REST · 병렬 실행 · 정적 번들 서버 엔진',
        status: 'active'
      },
      {
        name: 'Official MCP TypeScript SDK',
        repo: 'modelcontextprotocol/typescript-sdk',
        url: 'https://github.com/modelcontextprotocol/typescript-sdk',
        version: deps['@modelcontextprotocol/sdk'],
        role: 'Meta Muse · Manus Cue · Claude Code 연결용 공식 Streamable HTTP MCP 서버',
        status: 'active'
      },
      {
        name: 'Vercel AI SDK',
        repo: 'vercel/ai',
        url: 'https://github.com/vercel/ai',
        version: deps.ai,
        role: 'Gemini(무료/4 Neon)·Claude·LiteLLM·Ollama 통합 멀티모델 실행 및 Zod 구조화 분해',
        status: 'active'
      },
      {
        name: 'Marked + Lucide + Telegram Bot',
        repo: 'markedjs/marked · lucide-icons/lucide',
        url: 'https://github.com/markedjs/marked',
        version: `${deps.marked} / ${deps.lucide}`,
        role: 'GFM 임원 보고서 렌더링, 오픈소스 벡터 아이콘 및 텔레그램 양방향 CEO 결재 봇 내장',
        status: 'active'
      }
    ],
    pluggable: [
      {
        name: 'LiteLLM AI Gateway',
        repo: 'BerriAI/litellm',
        url: 'https://github.com/BerriAI/litellm',
        role: '100+ 무료·유료·로컬 LLM 통합 프록시 + 월간 자동 지출 상한선(Spend Cap)'
      },
      {
        name: 'Paperclip AI Governance Pattern',
        repo: 'paperclipai/paperclip',
        url: 'https://github.com/paperclipai/paperclip',
        role: '조직도·팀원별 월 예산 한도·CEO 결재 거버넌스 아키텍처 반영'
      },
      {
        name: 'Ollama (Local Free LLMs)',
        repo: 'ollama/ollama',
        url: 'https://github.com/ollama/ollama',
        role: '내 PC/Mac에서 비용 0원으로 돌리는 오픈소스 로컬 AI 팀원 연결'
      },
      {
        name: 'Railway · Render · GitHub Actions CI',
        repo: 'railwayapp · render · actions',
        url: 'https://railway.com',
        role: '원클릭 HTTPS 공개 배포(모바일 Muse·Cue가 외부에서 /api/mcp 즉시 접속) 및 자동 테스트 CI'
      }
    ]
  });
});

app.get('/api/mcp/info', (c) => {
  const db = loadDb();
  return c.json({
    endpoint: '/api/mcp',
    sdk: '@modelcontextprotocol/sdk (Official Streamable HTTP)',
    token: db.settings.mcpToken,
    tools: MCP_TOOL_CATALOG
  });
});

// Deploy & Open-source Config Exports
const EXPORT_FILES = {
  litellm: { file: 'litellm_config.yaml', mime: 'text/yaml; charset=utf-8' },
  'docker-compose': { file: 'docker-compose.yml', mime: 'text/yaml; charset=utf-8' },
  railway: { file: 'railway.json', mime: 'application/json; charset=utf-8' },
  render: { file: 'render.yaml', mime: 'text/yaml; charset=utf-8' }
};

app.get('/api/exports/:name', (c) => {
  const entry = EXPORT_FILES[c.req.param('name')];
  if (!entry) return c.json({ error: '알 수 없는 설정 파일입니다.' }, 404);
  const content = fs.readFileSync(path.join(__dirname, entry.file), 'utf8');
  return c.text(content, 200, { 'Content-Type': entry.mime });
});

// Telegram Bot Test & Webhook Endpoint
app.post('/api/telegram/test', async (c) => {
  const db = loadDb();
  try {
    const callbacks = getTelegramCallbacks();
    const res = await testTelegramBot(db.settings, callbacks.onAutoRegisterChatId);
    const updated = loadDb();
    syncTelegramPolling(updated.settings, callbacks);
    return c.json({ ...res, state: sanitizeStateForClient(updated) });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/telegram/webhook', async (c) => {
  // Approvals can merge & deploy code, so forged webhook updates must be rejected.
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (webhookSecret) {
    if (!safeEqual(c.req.header('x-telegram-bot-api-secret-token'), webhookSecret)) {
      return c.json({ ok: false, error: 'invalid secret' }, 403);
    }
  } else if (isTelegramPollingActive()) {
    return c.json({ ok: true, ignored: 'long-polling mode' });
  }
  const update = await c.req.json().catch(() => ({}));
  const res = await handleTelegramUpdate(update, getTelegramCallbacks());
  return c.json({ ok: true, ...res });
});

// Live Team Lounge Chat — CEO talks to AI employees
app.post('/api/chat/send', async (c) => {
  const body = await c.req.json();
  const text = String(body.text || '').trim();
  if (!text) return c.json({ error: '메시지를 입력해 주세요.' }, 400);

  const db = loadDb();
  const reqMissionId = String(body.missionId || '').trim();
  const mission =
    reqMissionId && reqMissionId !== 'all'
      ? db.missions.find((m) => m.id === reqMissionId) || null
      : null;
  const missionTasks = mission ? db.tasks.filter((t) => t.missionId === mission.id) : [];

  const ceoMsg = appendMessage(db, {
    missionId: mission?.id || '',
    senderId: 'ceo',
    senderName: `${db.settings.ceoName || '대표님'} (CEO)`,
    senderRole: '최종 지시 · 결재권자',
    senderShortCode: 'CEO',
    senderAccent: '#171614',
    targetAgentId: null,
    statusText: '회의실 발언',
    type: 'ceo_chat',
    text
  });

  const replies = await generateTeamChatReplies({
    userMessage: text,
    mission,
    tasks: missionTasks,
    agents: db.agents,
    recentMessages: db.messages || [],
    settings: db.settings
  });

  const savedReplies = replies.map((r) => appendMessage(db, r));
  appendLog(
    db,
    '회의실',
    `CEO 메시지에 ${savedReplies.map((r) => r.senderName).join(', ')} 응답.`,
    'info'
  );
  saveDb(db);
  flushCloudBackup(db).catch(() => {});

  return c.json({
    ceoMessage: ceoMsg,
    replies: savedReplies,
    state: sanitizeStateForClient(db)
  });
});

app.delete('/api/chat', async (c) => {
  const missionId = String(c.req.query('missionId') || '').trim();
  const db = loadDb();
  if (missionId && missionId !== 'all') {
    db.messages = (db.messages || []).filter((m) => m.missionId !== missionId);
  } else {
    db.messages = [];
  }
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ state: sanitizeStateForClient(db) });
});

// Live Team Standup — watch Lead & team members report real current status
app.post('/api/missions/:id/standup', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  const missionTasks = db.tasks.filter((t) => t.missionId === missionId);
  const turns = await generateStandupSession({
    mission,
    tasks: missionTasks,
    agents: db.agents,
    settings: db.settings
  });

  const savedTurns = turns.map((t) => appendMessage(db, t));
  appendLog(db, '회의실', `"${mission.title}" 현황 점검(${savedTurns.length}건).`, 'info');
  saveDb(db);
  flushCloudBackup(db).catch(() => {});

  return c.json({
    turns: savedTurns,
    state: sanitizeStateForClient(db)
  });
});

// ==================== ASYNC AGENT INBOX HTTPS API (Pickle / Cue / Vooy / Instinct) ====================
function resolveInboxAgent(db, rawKey) {
  const key = String(rawKey || '').trim().toLowerCase();
  const alias = {
    pickle: 'agent_pickle',
    alex: 'agent_pickle',
    '피클': 'agent_pickle',
    '알렉스': 'agent_pickle',
    vooy: 'agent_vooy',
    '부이': 'agent_vooy',
    instinct: 'agent_instinct',
    '인스팅스': 'agent_instinct',
    muse: 'agent_muse',
    cue: 'agent_cue',
    manus: 'agent_cue',
    exaone: 'agent_exaone',
    groq: 'agent_groq',
    gemini: 'agent_gemini_neon',
    neon: 'agent_gemini_neon'
  };
  const targetId = alias[key] || rawKey;
  return db.agents.find((a) => a.id === targetId) || null;
}

function normalizeTokenCandidate(val = '') {
  return String(val || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^(?:Bearer|Token)\s+/i, '')
    .replace(/^(?:Bearer|Token)\s+/i, '')
    .trim();
}

function checkInboxToken(c, db, body = {}) {
  const expected = db.settings?.mcpToken;
  if (!expected) return true;
  const candidates = [
    c.req.query('token'),
    c.req.query('api_key'),
    c.req.query('key'),
    c.req.header('authorization'),
    c.req.header('x-api-key'),
    c.req.header('x-token'),
    c.req.header('x-mcp-token'),
    body?.token,
    body?.apiKey,
    body?.api_key
  ]
    .map(normalizeTokenCandidate)
    .filter(Boolean);
  return candidates.some((cand) => cand === expected);
}

app.get('/api/agent-inbox/:agentKey', (c) => {
  const db = loadDb();
  if (!checkInboxToken(c, db)) {
    return c.json({ error: '유효한 토큰이 필요합니다. (?token=<mcpToken> 또는 Authorization: Bearer <mcpToken>)' }, 401);
  }
  const agent = resolveInboxAgent(db, c.req.param('agentKey'));
  if (!agent) {
    return c.json({ error: `알 수 없는 에이전트입니다: ${c.req.param('agentKey')} (예: pickle, cue, vooy)` }, 404);
  }

  const isDryRun = c.req.query('dryRun') === '1' || c.req.query('test') === '1';
  if (!isDryRun) {
    recordAgentHeartbeat(db, agent.id, 'GET inbox');
    saveDb(db);
  }

  const parsedUrl = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto') || parsedUrl.protocol.replace(':', '');
  const origin = `${proto}://${parsedUrl.host}`;
  const token = db.settings?.mcpToken || '';
  const pendingTasks = db.tasks
    .filter((t) => t.assigneeId === agent.id && t.status !== 'completed' && t.status !== 'rejected')
    .map((t) => ({
      id: t.id,
      missionId: t.missionId,
      title: t.title,
      description: t.description,
      status: t.status,
      requiresApproval: t.requiresApproval,
      estimatedCostKRW: t.estimatedCostKRW,
      dispatchPrompt: t.dispatchPrompt
    }));

  const recentMeetingRoom = (db.messages || []).slice(-15).map((m) => ({
    sender: m.senderName,
    role: m.senderRole,
    missionId: m.missionId || '',
    text: m.text,
    timestamp: m.timestamp
  }));

  const replyUrl = `${origin}/api/agent-inbox/${encodeURIComponent(c.req.param('agentKey'))}/reply?token=${encodeURIComponent(token)}`;
  const connInfo = db.agentConnections?.[agent.id] || null;
  const externalBotConnected = Boolean(connInfo?.lastSeenAt);

  if (c.req.query('format') === 'text') {
    const lines = [
      `[${db.settings.companyName}] ${agent.name} 전용 업무·회의실 수신함`,
      `CEO: ${db.settings.ceoName || '대표님'}`,
      '',
      `=== 나에게 배정된 대기 업무 (${pendingTasks.length}건) ===`,
      ...(pendingTasks.length
        ? pendingTasks.map((t, i) => `${i + 1}. [${t.id}] ${t.title}\n   설명: ${t.description}\n   승인 필요: ${t.requiresApproval ? '예(확정·결제 전 정지)' : '아니오'}`)
        : ['현재 새로 배정된 업무가 없습니다.']),
      '',
      `=== 최근 #전사-회의실 대화 (최근 ${recentMeetingRoom.length}건) ===`,
      ...recentMeetingRoom.map((m) => `- ${m.sender}: ${m.text}`),
      '',
      `=== 답변/결과 제출 방법 (POST JSON) ===`,
      `URL: ${replyUrl}`,
      `Body: {"message":"회의실 보고 내용","taskId":"업무ID(선택)","deliverable":"상세 결과(선택)","requestApproval":true,"estimatedCostKRW":0}`
    ];
    return c.text(lines.join('\n'));
  }

  return c.json({
    ok: true,
    serverInboxReady: true,
    externalBotConnected,
    lastExternalSeenAt: connInfo?.lastSeenAt || null,
    statusNote: externalBotConnected
      ? `실제 외부 봇(${agent.name})의 접속 기록이 있습니다.`
      : `우리 서버의 ${agent.name} 수신함 주소는 정상 열려있지만, 실제 외부 봇(${agent.name})은 아직 접속한 기록이 없습니다.`,
    company: db.settings.companyName,
    ceoName: db.settings.ceoName || '대표님',
    agent: { id: agent.id, name: agent.name, roleTitle: agent.roleTitle },
    myPendingTasks: pendingTasks,
    recentMeetingRoom,
    howToReply: {
      method: 'POST',
      url: replyUrl,
      contentType: 'application/json',
      exampleBody: {
        message: '조사 결과를 보고합니다. 확정 전 CEO 결재 부탁드립니다.',
        taskId: pendingTasks[0]?.id || '',
        deliverable: '상세 결과 내용',
        requestApproval: true,
        approvalTitle: '예약/실행 승인 요청',
        estimatedCostKRW: 0
      }
    }
  });
});

async function handleAgentInboxReply(c) {
  let body = {};
  const rawText = await c.req.text().catch(() => '');
  if (rawText.trim()) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = { message: rawText.trim() };
    }
  }
  const db = loadDb();
  if (!checkInboxToken(c, db, body)) {
    return c.json({ error: '유효한 토큰이 필요합니다.' }, 401);
  }
  const agent = resolveInboxAgent(db, c.req.param('agentKey'));
  if (!agent) {
    return c.json({ error: `알 수 없는 에이전트입니다: ${c.req.param('agentKey')}` }, 404);
  }

  recordAgentHeartbeat(db, agent.id, 'POST reply');

  const message = String(
    body.message || body.text || body.reply || body.content || body.summary || body.deliverable || body.result || ''
  ).trim();
  if (!message) {
    saveDb(db);
    return c.json({ error: 'message 또는 deliverable 내용을 보내주세요.' }, 400);
  }

  const deliverable = String(body.deliverable || body.result || body.content || message).trim();
  const requestApproval = Boolean(body.requestApproval || body.requiresApproval || body.request_approval);
  const estimatedCostKRW = Number(body.estimatedCostKRW || body.estimated_cost_krw || 0) || 0;
  const now = new Date().toISOString();

  let task = body.taskId || body.task_id ? db.tasks.find((t) => t.id === (body.taskId || body.task_id)) : null;
  if (!task && (body.deliverable || body.result || requestApproval)) {
    task = db.tasks.find((t) => t.assigneeId === agent.id && t.status !== 'completed' && t.status !== 'rejected') || null;
  }

  const postedMsg = appendMessage(db, {
    missionId: body.missionId || task?.missionId || db.missions[0]?.id || '',
    senderId: agent.id,
    senderName: agent.name,
    senderRole: `${agent.roleTitle} · 실제 앱 보고`,
    senderShortCode: agent.shortCode,
    senderAccent: agent.accent,
    targetAgentId: 'ceo',
    statusText: requestApproval ? '실제 앱 결재 상신' : '실제 앱 보고 (LIVE)',
    type: requestApproval ? 'approval' : 'reply',
    text: message
  });

  let approvalId = null;
  if (task) {
    task.output = deliverable;
    task.executionModeUsed = 'external_agent_https';
    task.updatedAt = now;
    if (estimatedCostKRW > 0) task.estimatedCostKRW = estimatedCostKRW;

    const shouldPause = requestApproval || task.requiresApproval;
    if (shouldPause) {
      task.status = 'awaiting_approval';
      const existing = db.approvals.find((a) => a.taskId === task.id && a.status === 'pending');
      if (!existing) {
        const apr = {
          id: uid('apr'),
          missionId: task.missionId,
          taskId: task.id,
          agentId: agent.id,
          title: body.approvalTitle || `${task.title} — ${agent.name} 실행 승인 요청`,
          category: (task.estimatedCostKRW || 0) > 0 ? '예약 · 결제' : '외부 에이전트 실행 승인',
          riskLevel: (task.estimatedCostKRW || 0) >= 100000 ? 'high' : 'medium',
          estimatedCostKRW: task.estimatedCostKRW || 0,
          depositKRW: 0,
          summary: message.slice(0, 260),
          proposedAction: `승인 시 ${agent.name}에서 최종 확정 처리`,
          status: 'pending',
          ceoNote: '',
          createdAt: now,
          decidedAt: null
        };
        db.approvals.unshift(apr);
        approvalId = apr.id;
        notifyAllApprovalChannels(db.settings, apr, agent.name);
      } else {
        approvalId = existing.id;
      }
      appendLog(db, `${agent.name} (HTTPS 보고)`, `"${task.title}" 실제 보고 접수 → CEO 결재함 상신.`, 'approval');
    } else {
      task.status = 'completed';
      appendLog(db, `${agent.name} (HTTPS 보고)`, `"${task.title}" 실제 작업 완료 보고.`, 'success');
      notifyTaskCompleted(db.settings, task, agent.name);
    }
    updateMissionStatus(db, task.missionId);
  } else if (requestApproval) {
    const apr = {
      id: uid('apr'),
      missionId: db.missions[0]?.id || '',
      taskId: '',
      agentId: agent.id,
      title: body.approvalTitle || `${agent.name} CEO 결재 요청`,
      category: estimatedCostKRW > 0 ? '예약 · 결제' : '외부 에이전트 승인 요청',
      riskLevel: estimatedCostKRW >= 100000 ? 'high' : 'medium',
      estimatedCostKRW,
      depositKRW: 0,
      summary: message.slice(0, 260),
      proposedAction: `승인 시 ${agent.name} 실행 확정`,
      status: 'pending',
      ceoNote: '',
      createdAt: now,
      decidedAt: null
    };
    db.approvals.unshift(apr);
    approvalId = apr.id;
    notifyAllApprovalChannels(db.settings, apr, agent.name);
    appendLog(db, `${agent.name} (HTTPS 보고)`, `실제 결재 안건 상신: "${apr.title}"`, 'approval');
  } else {
    appendLog(db, `${agent.name} (HTTPS 보고)`, `사내 회의실에 실제 답변을 올렸습니다.`, 'success');
    sendWebPushNotification({
      title: `[새 보고] ${agent.name}`,
      body: message.slice(0, 100),
      view: 'office',
      tag: `msg-${postedMsg.id}`
    }).catch(() => {});
  }

  saveDb(db);
  await flushCloudBackup(db);
  return c.json({
    ok: true,
    agent: agent.name,
    postedMessageId: postedMsg.id,
    taskId: task?.id || null,
    taskStatus: task?.status || null,
    approvalId
  });
}

app.post('/api/agent-inbox/:agentKey/reply', handleAgentInboxReply);
app.post('/api/agent-inbox/:agentKey', handleAgentInboxReply);

// Create Mission & Decompose via Team Lead
app.post('/api/missions', async (c) => {
  const body = await c.req.json();
  const directive = String(body.directive || '').trim();
  if (!directive) return c.json({ error: 'CEO 지시 내용을 입력해 주세요.' }, 400);

  // Deduplicate identical directives submitted within 3 minutes (network retry / double tap)
  const existingDb = loadDb();
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const dup = existingDb.missions.find(
    (m) =>
      norm(m.directive) === norm(directive) &&
      Date.now() - Date.parse(m.createdAt || 0) < 180_000
  );
  if (dup) {
    const dupTasks = existingDb.tasks.filter((t) => t.missionId === dup.id);
    return c.json({ mission: dup, tasks: dupTasks, deduplicated: true, state: sanitizeStateForClient(existingDb) }, 200);
  }

  const { mission, tasks, db } = await createMissionInDb({
    title: body.title,
    directive,
    domain: body.domain,
    costPolicy: body.costPolicy,
    mode: body.mode,
    githubRepo: body.githubRepo,
    githubBranch: body.githubBranch,
    siteUrl: body.siteUrl
  });

  return c.json({ mission, tasks, state: sanitizeStateForClient(db) }, 201);
});

app.patch('/api/missions/:id/mode', async (c) => {
  const missionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const nextMode = body.mode === 'project' ? 'project' : 'one_off';
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  mission.mode = nextMode;
  if (!mission.phase) mission.phase = 1;
  if (!Array.isArray(mission.phaseHistory)) mission.phaseHistory = [];
  appendLog(
    db,
    'CEO',
    `"${mission.title}"을(를) ${nextMode === 'project' ? '지속 프로젝트' : '단발 업무'}로 전환했습니다.`,
    'info'
  );
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ mission, state: sanitizeStateForClient(db) });
});

app.post('/api/missions/:id/propose-next', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  if (mission.mode !== 'project') {
    mission.mode = 'project';
    if (!mission.phase) mission.phase = 1;
    if (!Array.isArray(mission.phaseHistory)) mission.phaseHistory = [];
    saveDb(db);
  }

  const res = await submitNextPhaseProposal(missionId);
  if (!res.ok) return c.json({ error: res.error || '제안 생성 실패' }, 400);
  return c.json({
    approval: res.approval,
    alreadyPending: Boolean(res.alreadyPending),
    state: sanitizeStateForClient(res.db)
  });
});

// Run all queued/non-completed tasks in a mission in parallel
app.post('/api/missions/:id/run-all', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  const targets = db.tasks.filter(
    (t) => t.missionId === missionId && (t.status === 'queued' || t.status === 'awaiting_bridge')
  );
  if (targets.length === 0) {
    return c.json({ ranCount: 0, state: sanitizeStateForClient(db) });
  }

  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  const results = await Promise.all(
    targets.map(async (task) => {
      const agent = agentMap[task.assigneeId] || db.agents[0];
      try {
        const res = await executeAgentTask({ task, mission, agent, settings: db.settings });
        return { task, agent, res };
      } catch (err) {
        return { task, agent, error: err.message };
      }
    })
  );

  const now = new Date().toISOString();
  for (const item of results) {
    if (item.error) {
      appendLog(db, item.agent.name, `"${item.task.title}" 실행 오류: ${item.error}`, 'warning');
      continue;
    }
    item.task.output = item.res.output;
    item.task.executionModeUsed = item.res.executionModeUsed;
    item.task.updatedAt = now;

    const overThreshold = (item.task.estimatedCostKRW || 0) >= (db.settings.approvalThresholdKRW || 30000);
    if (item.task.requiresApproval || overThreshold) {
      item.task.status = 'awaiting_approval';
      const existing = db.approvals.find((a) => a.taskId === item.task.id && a.status === 'pending');
      if (!existing) {
        const apr = createApprovalForTask(item.task, item.agent, mission);
        db.approvals.unshift(apr);
        const leadAg = db.agents.find((a) => a.id === (mission.leadAgentId || 'agent_gemini_neon'));
        notifyAllApprovalChannels(db.settings, apr, leadAg?.name || 'Gemini 4 Hydrogen');
      }
      appendLog(db, 'Gemini 4 Hydrogen (총괄 팀장)', `"${item.task.title}" 검토 완료 → 중요 의사결정으로 CEO 결재 상신.`, 'approval');
    } else {
      item.task.status = 'completed';
      appendLog(
        db,
        item.agent.name,
        `"${item.task.title}" 팀장 전결 완료 (${item.res.live ? 'Live SDK' : '자동 처리'}).`,
        'success'
      );
      maybeScheduleCodeBundle(db, mission, item.task);
    }
  }

  updateMissionStatus(db, missionId);
  try {
    const missionTasks = db.tasks.filter((t) => t.missionId === missionId);
    mission.finalReport = await synthesizeMissionReport({
      mission,
      tasks: missionTasks,
      agents: db.agents,
      settings: db.settings
    });
  } catch {
    // non-fatal
  }
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ ranCount: targets.length, state: sanitizeStateForClient(db) });
});

app.post('/api/missions/:id/synthesize', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  const missionTasks = db.tasks.filter((t) => t.missionId === missionId);
  const report = await synthesizeMissionReport({
    mission,
    tasks: missionTasks,
    agents: db.agents,
    settings: db.settings
  });

  mission.finalReport = report;
  const lead = db.agents.find((a) => a.id === mission.leadAgentId);
  appendLog(db, lead?.name || '총괄 팀장', `"${mission.title}" 최종 임원 보고서를 CEO에게 제출했습니다.`, 'success');
  saveDb(db);
  return c.json({ report, state: sanitizeStateForClient(db) });
});

app.patch('/api/missions/:id', async (c) => {
  const missionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  const hasTitle = typeof body.title === 'string' && body.title.trim().length > 0;
  const hasBindingUpdate =
    typeof body.githubRepo === 'string' ||
    typeof body.githubBranch === 'string' ||
    typeof body.siteUrl === 'string' ||
    Array.isArray(body.extraRepos);

  if (!hasTitle && !hasBindingUpdate && typeof body.directive !== 'string') {
    return c.json({ error: '수정할 내용을 입력해 주세요.' }, 400);
  }

  const oldTitle = mission.title;
  if (hasTitle) {
    mission.title = body.title.trim().slice(0, 120);
  }
  const replaceOld = (txt) => {
    if (typeof txt !== 'string' || !oldTitle || oldTitle === mission.title) return txt;
    return txt.split(oldTitle).join(mission.title);
  };

  if (typeof body.directive === 'string' && body.directive.trim()) {
    mission.directive = body.directive.trim();
  } else if (mission.directive) {
    mission.directive = replaceOld(mission.directive);
  }

  if (typeof body.githubRepo === 'string') {
    mission.githubRepo = body.githubRepo
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
  }
  if (typeof body.githubBranch === 'string' && body.githubBranch.trim()) {
    mission.githubBranch = body.githubBranch.trim();
  }
  if (typeof body.siteUrl === 'string') {
    mission.siteUrl = body.siteUrl.trim();
  }
  if (Array.isArray(body.extraRepos)) {
    mission.extraRepos = body.extraRepos.map((r) => String(r || '').trim()).filter(Boolean);
  }

  // Cascade rename to all tasks, dispatch prompts, approvals, and messages of this mission
  if (oldTitle !== mission.title) {
    const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
    for (const t of db.tasks) {
      if (t.missionId !== mission.id) continue;
      t.title = replaceOld(t.title);
      t.description = replaceOld(t.description);
      const ag = agentMap[t.assigneeId];
      if (ag) t.dispatchPrompt = buildDispatchPrompt(t, mission, ag);
    }
    for (const apr of db.approvals) {
      if (apr.missionId !== mission.id) continue;
      apr.title = replaceOld(apr.title);
      apr.summary = replaceOld(apr.summary);
      apr.proposedAction = replaceOld(apr.proposedAction);
    }
    for (const msg of db.messages || []) {
      if (msg.missionId !== mission.id) continue;
      msg.text = replaceOld(msg.text);
    }
    appendLog(db, 'CEO', `이름 변경: "${oldTitle}" → "${mission.title}" (관련 업무·결재·지시서 일괄 동기화)`, 'info');
  } else if (hasBindingUpdate) {
    appendLog(
      db,
      'CEO',
      `"${mission.title}" 실연동 설정 변경 — GitHub: ${mission.githubRepo || '없음'}, 사이트: ${mission.siteUrl || '없음'}`,
      'info'
    );
  }

  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ mission, state: sanitizeStateForClient(db) });
});

app.get('/api/missions/:id/live-context', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);
  const context = await buildMissionLiveContext({ mission, settings: db.settings });
  const ghCfg = getGithubRepoConfig(db.settings, { repo: mission.githubRepo, branch: mission.githubBranch });
  return c.json({
    ok: true,
    githubRepo: mission.githubRepo || '',
    siteUrl: mission.siteUrl || '',
    canEditRepo: Boolean(ghCfg.enabled && mission.githubRepo),
    context
  });
});

app.post('/api/missions/:id/it-pr', async (c) => {
  const missionId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  try {
    const res = await triggerItPrForMission(missionId, body?.instruction || '');
    return c.json({
      ok: true,
      repo: res.result.repo,
      prNumber: res.result.prNumber,
      prUrl: res.result.prUrl,
      changedFiles: res.result.changedFiles,
      approval: res.approval,
      state: sanitizeStateForClient(res.db)
    });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/missions/:id/deploy-idle', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  const openStatuses = new Set(['queued', 'running', 'awaiting_bridge', 'awaiting_approval']);
  const busyAgentIds = new Set(
    db.tasks
      .filter((t) => t.missionId === mission.id && openStatuses.has(t.status))
      .map((t) => t.assigneeId)
  );

  const isItMission = mission.domain === 'it_ops';
  const idleAgents = db.agents.filter(
    (a) =>
      a.active &&
      a.tier !== 'lead' &&
      !busyAgentIds.has(a.id) &&
      (isItMission ? a.team === 'it' : a.team !== 'it')
  );

  if (idleAgents.length === 0) {
    return c.json({ deployedCount: 0, tasks: [], state: sanitizeStateForClient(db) });
  }

  const now = new Date().toISOString();
  const phase = Number(mission.phase) || 1;
  const roleTemplates = {
    agent_deepseek: {
      title: '수익 구조·ROI 심층 추론 및 리스크 검증',
      description: `"${mission.title}"의 수익화 병목, 단위 경제성(ROI), 숨은 리스크를 Nemotron 3 Ultra 550B 심층 추론으로 검증하고 우선순위 실행안을 도출합니다.`,
      domain: 'business'
    },
    agent_gemma: {
      title: 'UX·사용자 동선 개선 및 설득력 있는 카피·문서 기획',
      description: `"${mission.title}"의 이탈 구간을 줄이고 전환을 높이는 UX 개선안, 핵심 페이지 카피, 사용자 관점 기획 문서를 작성합니다.`,
      domain: 'content'
    },
    agent_qwen: {
      title: '웹·SEO·자동화 기술 구현 및 코드 개선안',
      description: `"${mission.title}" 성과를 높일 핵심 기능·SEO 구조·자동화 스크립트 구현 코드와 적용 가이드를 작성합니다.`,
      domain: 'dev'
    },
    agent_groq: {
      title: '유입 확대용 콘텐츠·마케팅 카피 및 확산 기획',
      description: `"${mission.title}" 타깃 고객의 전환율을 높이는 핵심 메시지, 검색·SNS 유입 콘텐츠, AB 테스트 카피 초안을 제작합니다.`,
      domain: 'content'
    },
    agent_exaone: {
      title: '한국어 실무 문서·규정 점검 및 실행 체크리스트 정리',
      description: `"${mission.title}"의 국내 시장·세무/법무 유의사항과 즉시 실행 가능한 한국어 체크리스트를 정리합니다.`,
      domain: 'business'
    },
    agent_muse: {
      title: '개인 컨텍스트 연동 프로젝트 보드 및 마일스톤 정리',
      description: `"${mission.title}" Phase ${phase}의 핵심 마일스톤과 CEO 일정·리소스 연계 포인트를 프로젝트 보드로 정리합니다.`,
      domain: 'business'
    },
    agent_cue: {
      title: '외부 제휴·광고·유통 채널 리서치 및 실행안 준비',
      description: `"${mission.title}"에 연결할 수 있는 외부 파트너·제휴·광고 채널 후보와 접촉 초안을 조사해 보고합니다.`,
      domain: 'business'
    },
    agent_pickle: {
      title: '시장·현장 실무 확인 및 외부 정보 수집',
      description: `"${mission.title}"과 관련된 실제 서비스·경쟁사·현장 조건을 확인해 실행 가능한 최신 정보를 보고합니다.`,
      domain: 'business'
    },
    agent_instinct: {
      title: '외부 연락·실행 리마인드 초안 준비',
      description: `"${mission.title}" 추진 중 외부 파트너·담당자에게 보낼 간결한 확인 메시지 초안을 준비합니다.`,
      domain: 'business'
    }
  };

  const newTasks = idleAgents.map((ag) => {
    const tpl = roleTemplates[ag.id] || {
      title: `${ag.name} 전담 실무 분석 및 실행안 작성`,
      description: `"${mission.title}" 목표 달성을 위해 ${ag.name}(${ag.roleTitle})의 강점을 활용한 실행안을 작성합니다.`,
      domain: mission.domain || 'business'
    };
    const task = {
      id: uid('tsk'),
      missionId: mission.id,
      phase,
      title: tpl.title,
      description: tpl.description,
      assigneeId: ag.id,
      domain: tpl.domain,
      status: ag.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued',
      requiresApproval: false,
      estimatedCostKRW: 0,
      dispatchPrompt: '',
      output: '',
      createdAt: now,
      updatedAt: now
    };
    task.dispatchPrompt = buildDispatchPrompt(task, mission, ag);
    return task;
  });

  db.tasks.unshift(...newTasks);
  const namesList = idleAgents.map((a) => a.name).join(', ');
  appendLog(db, 'CEO', `"${mission.title}"에 대기 중이던 ${idleAgents.length}명(${namesList})을 전면 투입했습니다.`, 'success');
  appendMessage(db, {
    missionId: mission.id,
    senderId: 'agent_gemini_neon',
    senderName: 'Gemini 4 Hydrogen',
    senderRole: '전략·총괄 팀장',
    senderShortCode: 'GM',
    senderAccent: '#0E6245',
    targetAgentId: 'ceo',
    statusText: '전원 투입',
    type: 'delegation',
    text: `대기 중이던 AI 팀원 ${idleAgents.length}명(${namesList})에게 "${mission.title}" 전담 업무를 배정하고 즉시 착수시켰습니다.`
  });
  updateMissionStatus(db, mission.id);
  saveDb(db);
  await flushCloudBackup(db);

  autoStartLiveMissionTasks(mission.id).catch((err) => {
    console.warn('Auto-start after deploy-idle error:', err.message);
  });

  return c.json({ deployedCount: newTasks.length, tasks: newTasks, state: sanitizeStateForClient(db) });
});

app.delete('/api/missions/:id/completed-tasks', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

  const removedIds = new Set(
    db.tasks
      .filter((t) => t.missionId === missionId && (t.status === 'completed' || t.status === 'rejected'))
      .map((t) => t.id)
  );
  if (removedIds.size > 0) {
    db.tasks = db.tasks.filter((t) => !removedIds.has(t.id));
    db.approvals = db.approvals.filter((a) => !removedIds.has(a.taskId));
    updateMissionStatus(db, missionId);
    appendLog(db, 'CEO', `"${mission.title}"의 종료된 업무 ${removedIds.size}건을 정리했습니다.`, 'info');
    saveDb(db);
    await flushCloudBackup(db);
  }
  return c.json({ removedCount: removedIds.size, state: sanitizeStateForClient(db) });
});

app.delete('/api/tasks/:id', async (c) => {
  const taskId = c.req.param('id');
  const db = loadDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return c.json({ error: '업무를 찾을 수 없습니다.' }, 404);

  const missionId = task.missionId;
  db.tasks = db.tasks.filter((t) => t.id !== taskId);
  db.approvals = db.approvals.filter((a) => a.taskId !== taskId);
  if (missionId) updateMissionStatus(db, missionId);
  appendLog(db, 'CEO', `업무 "${task.title}"을(를) 삭제했습니다.`, 'info');
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ ok: true, state: sanitizeStateForClient(db) });
});

app.delete('/api/missions/:id', async (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  db.missions = db.missions.filter((m) => m.id !== missionId);
  db.tasks = db.tasks.filter((t) => t.missionId !== missionId);
  db.approvals = db.approvals.filter((a) => a.missionId !== missionId);
  db.messages = (db.messages || []).filter((m) => m.missionId !== missionId);
  appendLog(db, 'CEO', `미션(${missionId})과 관련 대화를 삭제했습니다.`, 'info');
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ state: sanitizeStateForClient(db) });
});

// Single Task Run
app.post('/api/tasks/:id/run', async (c) => {
  const taskId = c.req.param('id');
  const db = loadDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return c.json({ error: '업무를 찾을 수 없습니다.' }, 404);

  const mission = db.missions.find((m) => m.id === task.missionId);
  const agent = db.agents.find((a) => a.id === task.assigneeId) || db.agents[0];
  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));

  const priorOutputs = db.tasks
    .filter((t) => t.missionId === task.missionId && t.id !== task.id && t.output)
    .map((t) => ({
      title: t.title,
      agentName: agentMap[t.assigneeId]?.name || t.assigneeId,
      output: t.output
    }));

  const result = await executeAgentTask({
    task,
    mission,
    agent,
    settings: db.settings,
    priorOutputs
  });

  const now = new Date().toISOString();
  task.output = result.output;
  task.executionModeUsed = result.executionModeUsed;
  task.updatedAt = now;

  const overThreshold = (task.estimatedCostKRW || 0) >= (db.settings.approvalThresholdKRW || 30000);
  if (task.requiresApproval || overThreshold) {
    task.status = 'awaiting_approval';
    const existing = db.approvals.find((a) => a.taskId === task.id && a.status === 'pending');
    if (!existing) {
      const apr = createApprovalForTask(task, agent, mission);
      db.approvals.unshift(apr);
      notifyAllApprovalChannels(db.settings, apr, agent.name);
    }
    appendLog(db, agent.name, `"${task.title}" 사전 작업 완료 → CEO 결재함에 승인 요청을 등록했습니다.`, 'approval');
  } else {
    task.status = 'completed';
    appendLog(
      db,
      agent.name,
      `"${task.title}" 작업을 완료했습니다. (${result.live ? 'Live SDK' : '시뮬레이션'})`,
      'success'
    );
    maybeScheduleCodeBundle(db, mission, task);
  }

  updateMissionStatus(db, task.missionId);
  saveDb(db);
  return c.json({ task, live: result.live, state: sanitizeStateForClient(db) });
});

// Manual / Consumer App / Subscription Bridge Report
app.post('/api/tasks/:id/report', async (c) => {
  const taskId = c.req.param('id');
  const body = await c.req.json();
  const db = loadDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return c.json({ error: '업무를 찾을 수 없습니다.' }, 404);

  const mission = db.missions.find((m) => m.id === task.missionId);
  const agent = db.agents.find((a) => a.id === task.assigneeId) || db.agents[0];
  const now = new Date().toISOString();

  const reportText = String(body.output || '').trim();
  if (!reportText) return c.json({ error: '전달받은 실행 결과를 입력해 주세요.' }, 400);

  task.output = reportText;
  task.executionModeUsed = 'bridge_manual';
  task.updatedAt = now;
  if (body.estimatedCostKRW !== undefined) {
    task.estimatedCostKRW = Number(body.estimatedCostKRW) || 0;
  }

  if (body.requestApproval) {
    task.requiresApproval = true;
    task.status = 'awaiting_approval';
    const existing = db.approvals.find((a) => a.taskId === task.id && a.status === 'pending');
    if (!existing) {
      const apr = createApprovalForTask(
        task,
        agent,
        mission,
        String(body.approvalReason || '').trim() || reportText.slice(0, 220),
        String(body.proposedAction || '').trim() || `${agent.name} 앱에서 최종 실행(예약·결제·발송) 확정`
      );
      db.approvals.unshift(apr);
      notifyAllApprovalChannels(db.settings, apr, agent.name);
    }
    appendLog(db, `${agent.name} (브릿지)`, `"${task.title}" 결과를 등록하고 CEO 결재를 요청했습니다.`, 'approval');
  } else {
    task.status = 'completed';
    appendLog(db, `${agent.name} (브릿지)`, `"${task.title}" 결과를 브릿지로 완료 보고했습니다.`, 'success');
    maybeScheduleCodeBundle(db, mission, task);
  }

  updateMissionStatus(db, task.missionId);
  saveDb(db);
  return c.json({ task, state: sanitizeStateForClient(db) });
});

app.patch('/api/tasks/:id', async (c) => {
  const taskId = c.req.param('id');
  const body = await c.req.json();
  const db = loadDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return c.json({ error: '업무를 찾을 수 없습니다.' }, 404);

  const mission = db.missions.find((m) => m.id === task.missionId);
  if (body.assigneeId) {
    const ag = db.agents.find((a) => a.id === body.assigneeId);
    if (ag) {
      task.assigneeId = ag.id;
      task.dispatchPrompt = buildDispatchPrompt(ag, task, mission);
      if (task.status === 'queued' && ag.connectionMode === 'bridge') {
        task.status = 'awaiting_bridge';
      } else if (task.status === 'awaiting_bridge' && ag.connectionMode !== 'bridge') {
        task.status = 'queued';
      }
      appendLog(db, 'CEO', `"${task.title}" 담당자를 ${ag.name}(으)로 재배정했습니다.`, 'info');
    }
  }
  if (typeof body.requiresApproval === 'boolean') task.requiresApproval = body.requiresApproval;
  if (typeof body.dispatchPrompt === 'string') task.dispatchPrompt = body.dispatchPrompt;
  task.updatedAt = new Date().toISOString();
  saveDb(db);
  return c.json({ task, state: sanitizeStateForClient(db) });
});

// CEO Approval Decision
app.post('/api/approvals/:id/decide', async (c) => {
  const aprId = c.req.param('id');
  const body = await c.req.json();
  const res = applyApprovalDecisionInDb(aprId, body.decision, body.ceoNote);
  if (!res.ok) return c.json({ error: res.error }, res.status || 400);

  let latestDb = res.db;
  if (res.approval?.kind === 'next_phase' && body.decision === 'approved' && res.approval.proposedDirective) {
    const launched = await launchNextProjectPhase(
      res.approval.missionId,
      res.approval.proposedDirective,
      body.ceoNote
    );
    if (launched?.db) latestDb = launched.db;
  }
  let codeApply = false;
  if (isCodeApproval(res.db, res.approval)) {
    // Approve = real code merged & deployed in the background (progress shows on the card / logs / Telegram)
    codeApply = body.decision === 'approved';
    handleCodeDecision(res.approval.id, body.decision).catch((err) => {
      const fresh = loadDb();
      appendLog(fresh, 'IT 유지보수팀', `"${res.approval.title}" 실코드 처리 오류: ${err.message}`, 'warning');
      saveDb(fresh);
    });
    latestDb = loadDb();
  }
  await flushCloudBackup(latestDb);
  const latestApr = latestDb.approvals.find((a) => a.id === res.approval.id) || res.approval;
  return c.json({ approval: latestApr, codeApply, state: sanitizeStateForClient(latestDb) });
});

// Agents CRUD
app.post('/api/agents', async (c) => {
  const body = await c.req.json();
  const name = String(body.name || '').trim();
  if (!name) return c.json({ error: 'AI 이름을 입력해 주세요.' }, 400);

  const db = loadDb();
  const tier = ['lead', 'specialist', 'executor'].includes(body.tier) ? body.tier : 'specialist';
  const team = body.team === 'it' ? 'it' : 'core';
  const newAgent = {
    id: uid('agent'),
    name,
    shortCode: (String(body.shortCode || '').trim() || name.slice(0, 2)).toUpperCase(),
    roleTitle: String(body.roleTitle || (team === 'it' ? 'IT 유지보수 팀원' : '맞춤 전문 팀원')).trim(),
    team,
    tier,
    reportsTo: tier === 'lead' ? 'ceo' : 'agent_gemini_neon',
    provider: String(body.provider || 'custom').trim(),
    modelId: String(body.modelId || '').trim(),
    connectionMode: ['api', 'litellm', 'mcp', 'bridge'].includes(body.connectionMode) ? body.connectionMode : 'bridge',
    costTier: ['free', 'freemium', 'paid_or_sub'].includes(body.costTier) ? body.costTier : 'free',
    monthlyCapKRW: Number(body.monthlyCapKRW) || 0,
    spentKRW: 0,
    domains: Array.isArray(body.domains) && body.domains.length ? body.domains : (team === 'it' ? ['dev', 'it_ops'] : ['business']),
    strengths: String(body.strengths || 'CEO 지시에 맞춘 전문 실무 처리').trim(),
    bridgeGuide: String(body.bridgeGuide || '지시서를 복사하거나 API/MCP로 연결해 사용합니다.').trim(),
    active: true,
    accent: String(body.accent || (team === 'it' ? '#0F766E' : '#0E6245'))
  };

  db.agents.push(newAgent);
  appendLog(db, 'CEO', `새 AI 팀원 "${newAgent.name}" (${newAgent.roleTitle})을(를) 채용했습니다.`, 'success');
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ agent: newAgent, state: sanitizeStateForClient(db) }, 201);
});

app.patch('/api/agents/:id', async (c) => {
  const agentId = c.req.param('id');
  const body = await c.req.json();
  const db = loadDb();
  const agent = db.agents.find((a) => a.id === agentId);
  if (!agent) return c.json({ error: '에이전트를 찾을 수 없습니다.' }, 404);

  if (typeof body.active === 'boolean') agent.active = body.active;
  if (['api', 'litellm', 'mcp', 'bridge'].includes(body.connectionMode)) agent.connectionMode = body.connectionMode;
  if (['lead', 'specialist', 'executor'].includes(body.tier)) {
    agent.tier = body.tier;
    agent.reportsTo = body.tier === 'lead' ? 'ceo' : 'agent_gemini_neon';
  }
  if (['free', 'freemium', 'paid_or_sub'].includes(body.costTier)) agent.costTier = body.costTier;
  if (typeof body.monthlyCapKRW === 'number') agent.monthlyCapKRW = Math.max(0, body.monthlyCapKRW);
  if (typeof body.roleTitle === 'string' && body.roleTitle.trim()) agent.roleTitle = body.roleTitle.trim();
  if (typeof body.modelId === 'string') agent.modelId = body.modelId.trim();
  if (typeof body.strengths === 'string') agent.strengths = body.strengths.trim();

  appendLog(db, 'CEO', `"${agent.name}" 설정 업데이트 (${agent.connectionMode.toUpperCase()} / ${agent.active ? '활성' : '휴직'}).`, 'info');
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ agent, state: sanitizeStateForClient(db) });
});

// Settings, Provider Ping & Webhook Test
app.put('/api/settings', async (c) => {
  const body = await c.req.json();
  const db = loadDb();
  const s = db.settings;

  if (typeof body.companyName === 'string' && body.companyName.trim()) s.companyName = body.companyName.trim();
  if (typeof body.ceoName === 'string' && body.ceoName.trim()) s.ceoName = body.ceoName.trim();
  if (['free_first', 'balanced', 'max_quality'].includes(body.defaultCostPolicy)) {
    s.defaultCostPolicy = body.defaultCostPolicy;
  }
  if (typeof body.monthlyBudgetKRW === 'number') s.monthlyBudgetKRW = Math.max(0, body.monthlyBudgetKRW);
  if (typeof body.approvalThresholdKRW === 'number') s.approvalThresholdKRW = Math.max(0, body.approvalThresholdKRW);
  if (typeof body.webhookUrl === 'string') s.webhookUrl = body.webhookUrl.trim();

  if (body.telegram) {
    s.telegram = s.telegram || { botToken: '', chatId: '', pollingEnabled: false };
    if (typeof body.telegram.botToken === 'string' && body.telegram.botToken.trim()) {
      s.telegram.botToken = body.telegram.botToken.trim();
    }
    if (typeof body.telegram.chatId === 'string') {
      s.telegram.chatId = body.telegram.chatId.trim();
    }
    if (typeof body.telegram.pollingEnabled === 'boolean') {
      s.telegram.pollingEnabled = body.telegram.pollingEnabled;
    }
  }

  if (body.providers) {
    for (const pKey of ['gemini', 'groq', 'openrouter', 'exaone', 'manus', 'litellm', 'ollama', 'githubRepo']) {
      const incoming = body.providers[pKey];
      if (!incoming) continue;
      const target = s.providers[pKey] || (s.providers[pKey] = {});
      if (incoming.clearApiKey) {
        target.apiKey = '';
        target.enabled = false;
      } else if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) {
        target.apiKey = incoming.apiKey.trim();
        target.enabled = true;
      }
      for (const field of ['freeModel', 'paidModel', 'model', 'baseUrl', 'cueEmail', 'repo', 'allowedRepos', 'branch']) {
        if (typeof incoming[field] === 'string') target[field] = incoming[field].trim();
      }
    }
  }

  appendLog(db, 'CEO', '설정을 저장했습니다.', 'info');
  saveDb(db);
  await flushCloudBackup(db);
  syncTelegramPolling(db.settings, getTelegramCallbacks());
  return c.json({ state: sanitizeStateForClient(db) });
});

app.post('/api/providers/test', async (c) => {
  const { provider } = await c.req.json();
  const db = loadDb();
  try {
    if (provider === 'githubRepo') {
      const result = await testGithubRepoConnection(db.settings);
      return c.json({ ...result, model: result.repo });
    }
    const result = await testProviderConnection(provider, db.settings);
    if (result?.transport && db.settings?.providers?.[provider]) {
      db.settings.providers[provider].transport = result.transport;
      saveDb(db);
      await flushCloudBackup(db);
    }
    return c.json(result);
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/webhook/test', async (c) => {
  const db = loadDb();
  if (!db.settings.webhookUrl) {
    return c.json({ ok: false, error: 'Webhook URL을 먼저 저장해 주세요.' }, 400);
  }
  const result = await notifyWebhook(db.settings, 'test_ping', {
    title: 'CEO Office 결재 알림 연동 테스트',
    summary: 'OpenClaw / n8n / Slack / Discord 결재 알림 채널이 정상 연결되었습니다.'
  });
  return c.json({ ok: result.sent, ...result });
});

app.post('/api/reset', async (c) => {
  const prev = loadDb();
  const fresh = createDefaultState();
  if (prev?.settings?.mcpToken && /^ceo_mcp_[a-f0-9]{24,}$/.test(prev.settings.mcpToken)) {
    fresh.settings.mcpToken = prev.settings.mcpToken;
  }
  saveDb(fresh);
  await flushCloudBackup(fresh);
  syncTelegramPolling(fresh.settings, getTelegramCallbacks());
  return c.json({ state: sanitizeStateForClient(fresh) });
});

// Static Frontend Assets
app.get('*', (c) => {
  const pathname = new URL(c.req.url).pathname;
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);

  if (fullPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath);
    const content = fs.readFileSync(fullPath);
    const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
    if (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    return c.body(content, 200, headers);
  }
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  return c.body(indexHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
});

const honoListener = getRequestListener(app.fetch);

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (urlObj.pathname === '/api/mcp') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, x-api-key');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      // Per MCP Streamable HTTP spec, stateless servers without standalone SSE stream return 405 (never HTML)
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed: use POST for stateless MCP Streamable HTTP' } }));
      return;
    }

    if (req.method === 'DELETE') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', async () => {
        try {
          const parsed = raw.trim() ? JSON.parse(raw) : {};
          await handleOfficialMcpHttp(req, res, parsed);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message } }));
          }
        }
      });
      return;
    }
  }

  return honoListener(req, res);
});

initCloudPersistence()
  .catch(() => {})
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => {
      const db = loadDb();
      ensureVapidKeys(db);
      syncTelegramPolling(db.settings, getTelegramCallbacks());
      setTimeout(() => {
        recoverCodeApprovalsOnBoot().catch((err) => console.warn('code approval recovery failed:', err.message));
      }, 15000);
      console.log(`AI CEO Hub v2 (Hono + Official MCP SDK + Vercel AI SDK + Gemini 4 Hydrogen + Groq + OpenRouter + LG K-EXAONE 2.5 + Telegram Bot) listening on http://localhost:${PORT}`);
    });
  });
