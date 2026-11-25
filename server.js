import http from 'node:http';
import fs from 'node:fs';
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
  uid
} from './src/store.js';
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

async function createMissionInDb({ title = '', directive, domain = 'business', costPolicy, mode = 'one_off' }) {
  const db = loadDb();
  const safeDomain = ['business', 'life', 'content', 'dev'].includes(domain) ? domain : 'business';
  const safePolicy = ['free_first', 'balanced', 'max_quality'].includes(costPolicy)
    ? costPolicy
    : db.settings.defaultCostPolicy;
  const safeMode = mode === 'project' ? 'project' : 'one_off';

  const autoTitle =
    String(title || '').trim() ||
    directive.split('\n')[0].slice(0, 40) + (directive.length > 40 ? '…' : '');

  const plan = await decomposeDirective({
    directive,
    title: autoTitle,
    domain: safeDomain,
    costPolicy: safePolicy,
    agents: db.agents,
    settings: db.settings
  });

  const now = new Date().toISOString();
  const mission = {
    id: uid('msn'),
    title: autoTitle,
    directive,
    domain: safeDomain,
    costPolicy: safePolicy,
    mode: safeMode,
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

  // Auto-start live API workers (e.g. LG K-EXAONE 2.5) immediately without requiring CEO to click "실행"
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
  try {
    const finalDb = loadDb();
    const freshMission = finalDb.missions.find((m) => m.id === missionId);
    if (freshMission) {
      const mTasks = finalDb.tasks.filter((t) => t.missionId === missionId);
      freshMission.finalReport = await synthesizeMissionReport({
        mission: freshMission,
        tasks: mTasks,
        agents: finalDb.agents,
        settings: finalDb.settings
      });
      saveDb(finalDb);
      await flushCloudBackup(finalDb);

      // Continuous Project mode: Team Lead automatically analyzes results and proposes the next phase for CEO approval
      if (freshMission.mode === 'project') {
        await submitNextPhaseProposal(missionId);
      }
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
    settings: db.settings
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
  notifyWebhook(settings, 'approval_requested', apr).catch(() => {});
  sendTelegramApprovalCard(settings, apr, agentName).catch(() => {});
  sendWebPushNotification({
    title: `[결재 요청] ${apr.title}`,
    body: `${agentName || '총괄 팀장'} · ${(apr.summary || '').slice(0, 90)}`,
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
    mode: body.mode
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
  } else {
    await flushCloudBackup(latestDb);
  }
  return c.json({ approval: res.approval, state: sanitizeStateForClient(latestDb) });
});

// Agents CRUD
app.post('/api/agents', async (c) => {
  const body = await c.req.json();
  const name = String(body.name || '').trim();
  if (!name) return c.json({ error: 'AI 이름을 입력해 주세요.' }, 400);

  const db = loadDb();
  const tier = ['lead', 'specialist', 'executor'].includes(body.tier) ? body.tier : 'specialist';
  const newAgent = {
    id: uid('agent'),
    name,
    shortCode: (String(body.shortCode || '').trim() || name.slice(0, 2)).toUpperCase(),
    roleTitle: String(body.roleTitle || '맞춤 전문 팀원').trim(),
    tier,
    reportsTo: tier === 'lead' ? 'ceo' : 'agent_gemini_neon',
    provider: String(body.provider || 'custom').trim(),
    modelId: String(body.modelId || '').trim(),
    connectionMode: ['api', 'litellm', 'mcp', 'bridge'].includes(body.connectionMode) ? body.connectionMode : 'bridge',
    costTier: ['free', 'freemium', 'paid_or_sub'].includes(body.costTier) ? body.costTier : 'free',
    monthlyCapKRW: Number(body.monthlyCapKRW) || 0,
    spentKRW: 0,
    domains: Array.isArray(body.domains) && body.domains.length ? body.domains : ['business'],
    strengths: String(body.strengths || 'CEO 지시에 맞춘 전문 실무 처리').trim(),
    bridgeGuide: String(body.bridgeGuide || '지시서를 복사하거나 API/MCP로 연결해 사용합니다.').trim(),
    active: true,
    accent: String(body.accent || '#0E6245')
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
    for (const pKey of ['gemini', 'groq', 'openrouter', 'exaone', 'manus', 'litellm', 'ollama']) {
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
      for (const field of ['freeModel', 'paidModel', 'model', 'baseUrl', 'cueEmail']) {
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
      console.log(`AI CEO Hub v2 (Hono + Official MCP SDK + Vercel AI SDK + Gemini 4 Hydrogen + Groq + OpenRouter + LG K-EXAONE 2.5 + Telegram Bot) listening on http://localhost:${PORT}`);
    });
  });
