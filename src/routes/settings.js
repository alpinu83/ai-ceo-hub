// routes/settings.js: server.js에서 분리 (HTTP 라우트)
import { normalizeDevPolicy } from '../hub/dev-policy.js';
import { appendLog, flushCloudBackup, loadDb, sanitizeStateForClient, saveDb, uid } from '../store.js';
import { buildAnalyticsContext, describeGoogleDataStatus } from '../google-data.js';
import { buildCompanyContext, ensureLeadDefaults, forgetFact, getLeadSettings, rememberFact } from '../lead-engine.js';
import { describeSkillsForClient, getSkillSettings, renderSkills, selectSkills } from '../skills.js';
import { getOutsourcingSettings } from '../outsourcing.js';
import { syncTelegramPolling } from '../telegram.js';
import { getTelegramCallbacks } from '../hub/ceo-chat.js';
import { sanitizeNotifyPrefs } from '../hub/notify.js';
import { updateOutsourceRouting } from '../hub/outsourcing-bridge.js';


export function registerSettingsRoutes(app) {
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

    // 폐지(retired): 조직에서 완전히 빠짐, 다시 활성화하려면 retired=false 먼저
    if (typeof body.retired === 'boolean') {
      agent.retired = body.retired;
      if (body.retired) agent.active = false;
    }
    if (typeof body.active === 'boolean' && !(agent.retired && body.active)) agent.active = body.active;
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
    if (typeof body.globalDirectives === 'string') s.globalDirectives = body.globalDirectives.slice(0, 4000);
    if (body.devPolicy && typeof body.devPolicy === 'object') s.devPolicy = normalizeDevPolicy(body.devPolicy, s.devPolicy);
    if (body.outsourcing && typeof body.outsourcing === 'object') {
      const os = { ...getOutsourcingSettings(s) };
      for (const k of ['enabled', 'autoOnFailure', 'autoForBrowser']) {
        if (typeof body.outsourcing[k] === 'boolean') os[k] = body.outsourcing[k];
      }
      if (['off', 'proposals', 'proposals_and_reports'].includes(body.outsourcing.consultMode)) os.consultMode = body.outsourcing.consultMode;
      s.outsourcing = { ...(s.outsourcing || {}), ...os };
      updateOutsourceRouting(db, { routing: body.outsourcing.routing, officeHours: body.outsourcing.officeHours, leaseMinutes: body.outsourcing.leaseMinutes, awayHours: body.outsourcing.awayHours, roles: body.outsourcing.roles, geminiWaitMinutes: body.outsourcing.geminiWaitMinutes, priorities: body.outsourcing.priorities, waitMinutes: body.outsourcing.waitMinutes, codeWorkflow: body.outsourcing.codeWorkflow });
    }
    if (body.leadEngine && typeof body.leadEngine === 'object') {
      const le = getLeadSettings(s);
      for (const k of ['enabled', 'telegramReports', 'autoFollowUp']) {
        if (typeof body.leadEngine[k] === 'boolean') le[k] = body.leadEngine[k];
      }
      const clampNum = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def);
      le.followUpMinutes = clampNum(body.leadEngine.followUpMinutes ?? le.followUpMinutes, 10, 1440, 30);
      le.maxAutoRounds = clampNum(body.leadEngine.maxAutoRounds ?? le.maxAutoRounds, 0, 5, 2);
      le.reminderHours = clampNum(body.leadEngine.reminderHours ?? le.reminderHours, 1, 72, 6);
      s.leadEngine = le;
    }

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
      if (body.telegram.notify && typeof body.telegram.notify === 'object') {
        s.telegram.notify = sanitizeNotifyPrefs(body.telegram.notify, s.telegram.notify);
      }
    }
    if (body.skills && typeof body.skills === 'object') {
      const cur = getSkillSettings(s);
      const next = { ...cur };
      if (typeof body.skills.enabled === 'boolean') next.enabled = body.skills.enabled;
      if (['off', 'important', 'always'].includes(body.skills.reviewMode)) next.reviewMode = body.skills.reviewMode;
      if (Number.isFinite(Number(body.skills.minScore))) next.minScore = Math.min(10, Math.max(1, Math.round(Number(body.skills.minScore))));
      if (Number.isFinite(Number(body.skills.maxSkills))) next.maxSkills = Math.min(4, Math.max(0, Math.round(Number(body.skills.maxSkills))));
      if (Array.isArray(body.skills.disabled)) next.disabled = body.skills.disabled.map(String).filter((x) => x !== 'core_operating').slice(0, 30);
      s.skills = next;
    }

    if (body.providers) {
      for (const pKey of ['gemini', 'groq', 'openrouter', 'exaone', 'manus', 'litellm', 'ollama', 'githubRepo', 'googleData']) {
        const incoming = body.providers[pKey];
        if (!incoming) continue;
        if (pKey === 'googleData' && typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) {
          // 서비스 계정 JSON이 맞는지 저장 전에 확인
          try {
            const sa = JSON.parse(incoming.apiKey);
            if (!sa.client_email || !sa.private_key) throw new Error('client_email/private_key 없음');
          } catch (err) {
            return c.json({ error: `서비스 계정 JSON 키 형식이 아닙니다: ${err.message}` }, 400);
          }
        }
        const target = s.providers[pKey] || (s.providers[pKey] = {});
        if (incoming.clearApiKey) {
          target.apiKey = '';
          target.enabled = false;
        } else if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) {
          target.apiKey = incoming.apiKey.trim();
          target.enabled = true;
        }
        for (const field of ['freeModel', 'paidModel', 'model', 'baseUrl', 'cueEmail', 'repo', 'allowedRepos', 'branch', 'ga4PropertyId', 'searchConsoleSite']) {
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

  // ---- GA4 · 서치콘솔 실제 데이터 (팀원들이 보는 것과 같은 요약) ----
  app.get('/api/analytics', async (c) => {
    const db = loadDb();
    const status = describeGoogleDataStatus(db.settings);
    const text = await buildAnalyticsContext(db.settings, { siteUrl: String(c.req.query('site') || '') }).catch((err) => `조회 실패: ${err.message}`);
    return c.json({ status, text });
  });

  // ---- AI 스킬 (작업 유형별 절차·출력 형식·점검표) + 교차 검수 ----
  app.get('/api/skills', (c) => c.json(describeSkillsForClient(loadDb().settings)));

  app.post('/api/skills/custom', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 60);
    const instructions = String(body.instructions || '').trim().slice(0, 1500);
    if (!name || !instructions) return c.json({ error: '스킬 이름과 지침을 입력해 주세요.' }, 400);
    const db = loadDb();
    const cfg = getSkillSettings(db.settings);
    const skill = {
      id: uid('skl'),
      name,
      keywords: String(body.keywords || '').slice(0, 300),
      instructions,
      always: Boolean(body.always) || !String(body.keywords || '').trim(),
      important: Boolean(body.important)
    };
    db.settings.skills = { ...cfg, custom: [...cfg.custom, skill].slice(-20) };
    appendLog(db, 'CEO', `AI 스킬 "${name}"을 추가했습니다.`, 'info');
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ ok: true, skill, skills: describeSkillsForClient(db.settings), state: sanitizeStateForClient(db) });
  });

  app.delete('/api/skills/custom/:id', async (c) => {
    const db = loadDb();
    const cfg = getSkillSettings(db.settings);
    db.settings.skills = { ...cfg, custom: cfg.custom.filter((s) => s.id !== c.req.param('id')) };
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ ok: true, skills: describeSkillsForClient(db.settings), state: sanitizeStateForClient(db) });
  });

  // 어떤 작업에 어떤 스킬이 붙는지 미리보기
  app.post('/api/skills/preview', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    const agent = db.agents.find((a) => a.id === body.agentId) || null;
    const task = { title: String(body.title || ''), description: String(body.description || ''), domain: body.domain || '' };
    const skills = selectSkills({ agent, task, purpose: body.purpose || 'task', settings: db.settings });
    return c.json({ skills: skills.map((s) => ({ id: s.id, name: s.name })), prompt: renderSkills(skills) });
  });

  // ---- 회사 기억 (모든 AI 팀원이 공유하는 장기 기억) ----
  app.get('/api/memory', (c) => {
    const db = loadDb();
    ensureLeadDefaults(db);
    const missionId = String(c.req.query('missionId') || '');
    return c.json({
      globalDirectives: db.settings.globalDirectives,
      leadEngine: getLeadSettings(db.settings),
      facts: db.memory.facts,
      context: buildCompanyContext(db, missionId)
    });
  });

  app.post('/api/memory', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = String(body.text || '').trim();
    if (!text) return c.json({ error: '기억할 내용을 입력해 주세요.' }, 400);
    const db = loadDb();
    const fact = rememberFact(db, {
      text,
      kind: ['directive', 'decision', 'result', 'lesson', 'note'].includes(body.kind) ? body.kind : 'note',
      missionId: String(body.missionId || ''),
      pinned: body.pinned !== false,
      source: 'ceo_manual'
    });
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ ok: true, fact, state: sanitizeStateForClient(db) });
  });

  app.delete('/api/memory/:id', async (c) => {
    const db = loadDb();
    const removed = forgetFact(db, c.req.param('id'));
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ ok: removed, state: sanitizeStateForClient(db) });
  });
}
