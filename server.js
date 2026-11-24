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
  appendLog,
  appendMessage,
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
  testProviderConnection,
  notifyWebhook,
  generateTeamChatReplies,
  generateStandupSession
} from './src/orchestrator.js';
import { handleOfficialMcpHttp, MCP_TOOL_CATALOG } from './src/mcp.js';
import {
  sendTelegramApprovalCard,
  testTelegramBot,
  handleTelegramUpdate,
  syncTelegramPolling,
  isTelegramPollingActive
} from './src/telegram.js';

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
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
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

async function createMissionInDb({ title = '', directive, domain = 'business', costPolicy }) {
  const db = loadDb();
  const safeDomain = ['business', 'life', 'content', 'dev'].includes(domain) ? domain : 'business';
  const safePolicy = ['free_first', 'balanced', 'max_quality'].includes(costPolicy)
    ? costPolicy
    : db.settings.defaultCostPolicy;

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
  return { mission, tasks: createdTasks, db };
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
    onDecision: async (aprId, decision, note) => applyApprovalDecisionInDb(aprId, decision, note),
    onStatus: async () => {
      const db = loadDb();
      const pending = db.approvals.filter((a) => a.status === 'pending').length;
      const activeMissions = db.missions.filter((m) => m.status !== 'completed').length;
      const activeAgents = db.agents.filter((a) => a.active).length;
      return [
        `<b>${db.settings.companyName} 현황 보고</b>`,
        `• 활성 AI 조직원: ${activeAgents}명`,
        `• 진행 중 미션: ${activeMissions}건`,
        `• CEO 결재 대기: <b>${pending}건</b>`,
        `• 월 지출: ${(db.settings.spentThisMonthKRW || 0).toLocaleString('ko-KR')}원 / ${(db.settings.monthlyBudgetKRW || 0).toLocaleString('ko-KR')}원`,
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
}

const app = new Hono();
app.use('*', cors());

// Health Check (for Railway, Render, Docker)
app.get('/api/health', (c) =>
  c.json({
    ok: true,
    version: PKG.version,
    uptimeSec: Math.round(process.uptime()),
    telegramPolling: isTelegramPollingActive()
  })
);

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
    const res = await testTelegramBot(db.settings);
    return c.json(res);
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/telegram/webhook', async (c) => {
  const update = await c.req.json().catch(() => ({}));
  const res = await handleTelegramUpdate(update, getTelegramCallbacks());
  return c.json({ ok: true, ...res });
});

// Live Team Lounge Chat — CEO talks to AI employees & watches them collaborate
app.post('/api/chat/send', async (c) => {
  const body = await c.req.json();
  const text = String(body.text || '').trim();
  if (!text) return c.json({ error: '메시지를 입력해 주세요.' }, 400);

  const db = loadDb();
  const mission =
    db.missions.find((m) => m.id === body.missionId) || db.missions[0] || null;
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
    '사내 회의실',
    `CEO 메시지에 ${savedReplies.map((r) => r.senderName).join(', ')} 직원이 응답했습니다.`,
    'info'
  );
  saveDb(db);

  return c.json({
    ceoMessage: ceoMsg,
    replies: savedReplies,
    state: sanitizeStateForClient(db)
  });
});

// Live Team Standup — watch Lead & team members report, hand off, and request CEO approval
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
  appendLog(db, '사내 회의실', `"${mission.title}" 실시간 팀 스탠드업(${savedTurns.length}턴)을 진행했습니다.`, 'info');
  saveDb(db);

  return c.json({
    turns: savedTurns,
    state: sanitizeStateForClient(db)
  });
});

// Create Mission & Decompose via Team Lead
app.post('/api/missions', async (c) => {
  const body = await c.req.json();
  const directive = String(body.directive || '').trim();
  if (!directive) return c.json({ error: 'CEO 지시 내용을 입력해 주세요.' }, 400);

  const { mission, tasks, db } = await createMissionInDb({
    title: body.title,
    directive,
    domain: body.domain,
    costPolicy: body.costPolicy
  });

  return c.json({ mission, tasks, state: sanitizeStateForClient(db) }, 201);
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
        notifyAllApprovalChannels(db.settings, apr, item.agent.name);
      }
      appendLog(db, item.agent.name, `"${item.task.title}" 준비 완료 → CEO 결재함에 상신했습니다.`, 'approval');
    } else {
      item.task.status = 'completed';
      appendLog(
        db,
        item.agent.name,
        `"${item.task.title}" 완료 (${item.res.live ? 'Live SDK' : '시뮬레이션'}).`,
        'success'
      );
    }
  }

  updateMissionStatus(db, missionId);
  saveDb(db);
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

app.delete('/api/missions/:id', (c) => {
  const missionId = c.req.param('id');
  const db = loadDb();
  db.missions = db.missions.filter((m) => m.id !== missionId);
  db.tasks = db.tasks.filter((t) => t.missionId !== missionId);
  db.approvals = db.approvals.filter((a) => a.missionId !== missionId);
  appendLog(db, 'CEO', `미션(${missionId})을 삭제했습니다.`, 'info');
  saveDb(db);
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
  return c.json({ approval: res.approval, state: sanitizeStateForClient(res.db) });
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
    provider: String(body.provider || 'litellm').trim(),
    modelId: String(body.modelId || '').trim(),
    connectionMode: ['api', 'litellm', 'mcp', 'bridge'].includes(body.connectionMode) ? body.connectionMode : 'bridge',
    costTier: ['free', 'freemium', 'paid_or_sub'].includes(body.costTier) ? body.costTier : 'free',
    monthlyCapKRW: Number(body.monthlyCapKRW) || 0,
    spentKRW: 0,
    domains: Array.isArray(body.domains) && body.domains.length ? body.domains : ['business'],
    strengths: String(body.strengths || 'CEO 지시에 맞춘 전문 실무 처리').trim(),
    bridgeGuide: String(body.bridgeGuide || '지시서를 복사하거나 API/LiteLLM/MCP로 연결해 사용합니다.').trim(),
    active: true,
    accent: String(body.accent || '#0E6245')
  };

  db.agents.push(newAgent);
  appendLog(db, 'CEO', `새 AI 팀원 "${newAgent.name}" (${newAgent.roleTitle})을(를) 채용했습니다.`, 'success');
  saveDb(db);
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
    for (const pKey of ['gemini', 'claude', 'manus', 'litellm', 'ollama']) {
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

  appendLog(db, 'CEO', '연동 설정 · 텔레그램 봇 · 예산 거버넌스 정책을 저장했습니다.', 'info');
  saveDb(db);
  syncTelegramPolling(db.settings, getTelegramCallbacks());
  return c.json({ state: sanitizeStateForClient(db) });
});

app.post('/api/providers/test', async (c) => {
  const { provider } = await c.req.json();
  const db = loadDb();
  try {
    const result = await testProviderConnection(provider, db.settings);
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

app.post('/api/reset', (c) => {
  const fresh = createDefaultState();
  saveDb(fresh);
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
    return c.body(content, 200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
  }
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  return c.html(indexHtml);
});

const honoListener = getRequestListener(app.fetch);

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (urlObj.pathname === '/api/mcp' && req.method === 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
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

  return honoListener(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  const db = loadDb();
  syncTelegramPolling(db.settings, getTelegramCallbacks());
  console.log(`AI CEO Hub v2 (Hono + Official MCP SDK + Vercel AI SDK + Telegram Bot) listening on http://localhost:${PORT}`);
});
