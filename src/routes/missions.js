// routes/missions.js: server.js에서 분리 (HTTP 라우트)
import { DEV_TEAM, dispatchDevTeamTask, handleDevDesignDecision } from '../hub/dev-policy.js';
import { appendLog, appendMessage, flushCloudBackup, loadDb, sanitizeStateForClient, saveDb, uid } from '../store.js';
import { buildDispatchPrompt, createApprovalForTask, executeAgentTask, synthesizeMissionReport } from '../orchestrator.js';
import { buildMissionLiveContext } from '../live-context.js';
import { getGithubRepoConfig } from '../it-devops.js';
import { addLeadNote, getMissionGoal, getMissionScope, rememberFact } from '../lead-engine.js';
import { applyApprovalDecisionInDb, autoStartLiveMissionTasks, createMissionInDb, updateMissionStatus } from '../hub/missions.js';
import { handleCodeDecision, isCodeApproval, triggerItPrForMission } from '../hub/code-pipeline.js';
import { handleDeliverableReviewDecision, handleStageGateDecision, isOpsMission, opsCycle, replanMission } from '../hub/lead-ops.js';
import { buildApprovalDeliverable } from '../hub/deliverables.js';
import { isCeoRequest } from '../hub/outsourcing-bridge.js';
import { notifyAllApprovalChannels } from '../hub/notify.js';
import { processTaskResult, registerDeliverable } from '../hub/task-results.js';


export function registerMissionsRoutes(app) {
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
    appendLog(
      db,
      'CEO',
      `"${mission.title}"을(를) ${nextMode === 'project' ? '지속 프로젝트(작전 계획 운영)' : '단발 업무'}로 전환했습니다.`,
      'info'
    );
    saveDb(db);
    await flushCloudBackup(db);
    if (nextMode === 'project') setTimeout(() => opsCycle(missionId).catch((err) => console.warn('ops cycle failed:', err.message)), 3000);
    return c.json({ mission, state: sanitizeStateForClient(db) });
  });

  // 운영 사이클 지금 실행 (작전 계획 수립 또는 현재 마일스톤 진행)
  app.post('/api/missions/:id/ops-cycle', async (c) => {
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 실행할 수 있습니다.' }, 401);
    const db = loadDb();
    const mission = db.missions.find((m) => m.id === c.req.param('id'));
    if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);
    if (!isOpsMission(mission)) return c.json({ error: '프로젝트 업무에서만 운영 사이클을 실행할 수 있습니다.' }, 400);
    opsCycle(mission.id).catch((err) => console.warn('manual ops cycle failed:', err.message));
    return c.json({ ok: true, state: sanitizeStateForClient(loadDb()) });
  });

  // 작전 재계획 (대표님 지시 메모 반영)
  app.post('/api/missions/:id/replan', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const res = await replanMission(c.req.param('id'), body.note || '');
    if (!res.ok) return c.json({ error: res.error }, 400);
    return c.json({ ok: true, dropped: res.dropped, state: sanitizeStateForClient(res.db) });
  });

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
    const EXTERNAL_PROVIDERS = new Set(['pickle', 'manus', 'muse', 'vooy', 'instinct']);
    // 중복 실행 방지: 실행할 작업은 먼저 running으로 표시
    const startIso = new Date().toISOString();
    for (const t of targets) {
      const ag = agentMap[t.assigneeId];
      if (!ag || !EXTERNAL_PROVIDERS.has(ag.provider)) {
        t.status = 'running';
        t.updatedAt = startIso;
      }
    }
    saveDb(db);
    const results = await Promise.all(
      targets.map(async (task) => {
        const agent = agentMap[task.assigneeId] || db.agents[0];
        // 외부 봇 업무는 봇이 직접 가져가야 함: 결재가 필요한 실행 건만 사전 승인 요청을 올리고 나머지는 그대로 둠
        if (EXTERNAL_PROVIDERS.has(agent.provider) && !task.requiresApproval) return { task, agent, skipped: true };
        try {
          const res = await executeAgentTask({ task, mission, agent, settings: db.settings });
          return { task, agent, res };
        } catch (err) {
          return { task, agent, error: err.message };
        }
      })
    );

    let runAllRequeued = false;
    for (const item of results) {
      if (item.skipped) continue;
      if (item.error) {
        item.task.status = 'queued';
        appendLog(db, item.agent.name, `"${item.task.title}" 실행 오류: ${item.error}`, 'warning');
        continue;
      }
      if (EXTERNAL_PROVIDERS.has(item.agent.provider)) {
        // 외부 봇 실행 전 사전 승인 (예약·결제 등)
        item.task.output = item.res.output;
        item.task.executionModeUsed = item.res.executionModeUsed;
        item.task.status = 'awaiting_approval';
        if (!db.approvals.find((a) => a.taskId === item.task.id && a.status === 'pending')) {
          const apr = createApprovalForTask(item.task, item.agent, mission);
          db.approvals.unshift(apr);
          notifyAllApprovalChannels(db.settings, apr, '총괄 팀장');
        }
        continue;
      }
      const out = await processTaskResult(db, item.task, item.agent, mission, item.res);
      if (out.requeued) runAllRequeued = true;
    }

    if (runAllRequeued) setTimeout(() => autoStartLiveMissionTasks(missionId).catch(() => {}), 1500);
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
    const hasScope = body.scope && typeof body.scope === 'object';
    const hasGoal = body.goal && typeof body.goal === 'object';

    if (!hasTitle && !hasBindingUpdate && !hasScope && !hasGoal && typeof body.directive !== 'string') {
      return c.json({ error: '수정할 내용을 입력해 주세요.' }, 400);
    }
    if (hasGoal) {
      // 목표: 지표·목표치·현재값·기한. 모든 AI 호출에 "판단 기준"으로 들어감
      const prevGoal = getMissionGoal(mission);
      const merged = { ...(mission.goal || {}), ...body.goal };
      mission.goal = { ...getMissionGoal({ goal: merged }), updatedAt: new Date().toISOString() };
      const g = mission.goal;
      appendLog(db, 'CEO', `"${mission.title}" 목표 설정: ${g.metric || '-'} ${g.current ?? '?'} → ${g.target ?? '?'}${g.unit ? ` ${g.unit}` : ''}${g.deadline ? ` (기한 ${g.deadline})` : ''}`, 'info');
      if (prevGoal.target !== g.target || prevGoal.metric !== g.metric) {
        rememberFact(db, { text: `목표 설정: ${g.objective || mission.title} — ${g.metric} ${g.target}${g.unit ? ` ${g.unit}` : ''}${g.deadline ? ` (기한 ${g.deadline})` : ''}`, kind: 'directive', missionId: mission.id, pinned: true, source: 'goal' });
      }
    }
    if (hasScope) {
      // 업무 범위: 집중할 일 / 하지 말 일(키워드). 모든 AI 호출에 최우선 지침으로 들어가고, 범위 밖 작업은 자동 제외
      mission.scope = getMissionScope({ scope: body.scope });
      appendLog(db, 'CEO', `"${mission.title}" 업무 범위 설정: 집중=${mission.scope.focus || '-'} / 제외=${mission.scope.exclude.join(', ') || '-'}`, 'info');
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
      if (res.outsourced) return c.json({ ok: true, outsourced: res.outsourced, state: sanitizeStateForClient(res.db) });
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

    if (task.status === 'running') return c.json({ error: '이미 실행 중인 업무입니다.' }, 409);
    task.status = 'running';
    task.updatedAt = new Date().toISOString();
    saveDb(db);
    let result;
    try {
      result = await executeAgentTask({
        task,
        mission,
        agent,
        settings: db.settings,
        priorOutputs
      });
    } catch (err) {
      task.status = 'queued';
      saveDb(db);
      return c.json({ error: err.message }, 500);
    }
    const outOne = await processTaskResult(db, task, agent, mission, result);
    if (outOne.requeued) setTimeout(() => autoStartLiveMissionTasks(task.missionId).catch(() => {}), 1500);

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
      // 대표님이 붙여넣은 외부 앱 결과도 같은 처리 경로 (지침 위반 검사·결과물 등록)
      await processTaskResult(db, task, agent, mission, { output: reportText, executionModeUsed: 'bridge_manual' }, { skipReview: true });
      appendLog(db, `${agent.name} (브릿지)`, `"${task.title}" 결과를 브릿지로 보고했습니다.`, 'info');
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
        if (DEV_TEAM[ag.id]) dispatchDevTeamTask(db, task);
      }
    }
    if (typeof body.requiresApproval === 'boolean') task.requiresApproval = body.requiresApproval;
    if (typeof body.dispatchPrompt === 'string') task.dispatchPrompt = body.dispatchPrompt;
    task.updatedAt = new Date().toISOString();
    saveDb(db);
    return c.json({ task, state: sanitizeStateForClient(db) });
  });

  // 홈 "대표님이 하실 일"에서 보류된 작업에 바로 결정 (여러 건 한 번에 가능)
  //  - retry: 피드백(선택)·담당 변경(선택)을 반영해 다시 맡김 → 대기열로 돌려 자동 실행
  //  - accept: 지금 결과물 그대로 완료 처리 (결과물이 있을 때만)
  //  - drop: 작업 접기 (반려, 다시 진행하지 않음)
  app.post('/api/tasks/ceo-decision', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const action = String(body.action || '');
    if (!['retry', 'accept', 'drop'].includes(action)) return c.json({ error: '올바른 결정이 아닙니다 (retry · accept · drop).' }, 400);
    const rawIds = Array.isArray(body.taskIds) ? body.taskIds : [body.taskId];
    const ids = [...new Set(rawIds.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 50);
    if (!ids.length) return c.json({ error: '결정할 작업을 골라 주세요.' }, 400);
    const feedback = String(body.feedback || '').trim().slice(0, 1500);
    const db = loadDb();
    const nextAgent = body.assigneeId ? db.agents.find((a) => a.id === body.assigneeId) : null;
    if (body.assigneeId && !nextAgent) return c.json({ error: '담당 AI를 찾을 수 없습니다.' }, 400);
    const now = new Date().toISOString();
    const stamp = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const done = [];
    const skipped = [];
    const touched = new Map();
    for (const id of ids) {
      const task = db.tasks.find((t) => t.id === id);
      if (!task) {
        skipped.push({ id, reason: '없는 작업' });
        continue;
      }
      if (task.status !== 'blocked') {
        skipped.push({ id, reason: `보류 상태가 아님 (${task.status})` });
        continue;
      }
      const mission = db.missions.find((m) => m.id === task.missionId);
      if (action === 'retry') {
        const agent = nextAgent || db.agents.find((a) => a.id === task.assigneeId) || db.agents[0];
        if (agent.id !== task.assigneeId) appendLog(db, 'CEO', `"${task.title}" 담당자를 ${agent.name}(으)로 바꿔 다시 맡겼습니다.`, 'info');
        task.assigneeId = agent.id;
        if (feedback) {
          task.description = `${task.description || ''}\n[CEO 피드백] ${feedback}`.slice(0, 6000);
          addLeadNote(task, 'ceo', `대표님 피드백(보류 해제): ${feedback}`);
        }
        task.previousOutput = String(task.output || '').slice(0, 1500);
        task.output = '';
        delete task.blockedReason;
        task.reviewRounds = 0;
        if (task.triage) task.triage = { ...task.triage, retries: 0, scopeRetries: 0 };
        task.status = agent.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
        task.ceoFeedback = feedback || '';
        if (mission) task.dispatchPrompt = buildDispatchPrompt(agent, task, mission);
      } else if (action === 'accept') {
        if (!String(task.output || '').trim()) {
          skipped.push({ id, reason: '결과물이 없어 완료 처리할 수 없음' });
          continue;
        }
        task.status = 'completed';
        task.output = `${task.output}\n\n---\n**대표님 확인 후 완료 처리** (${stamp})${feedback ? `\n- 대표님 메모: ${feedback}` : ''}`;
        delete task.blockedReason;
        registerDeliverable(db, mission, task, db.agents.find((a) => a.id === task.assigneeId));
      } else {
        task.status = 'rejected';
        task.ceoFeedback = feedback || '';
        task.rejectionReason = feedback || '대표님이 작업을 접음';
        task.output = `${task.output || ''}\n\n---\n**대표님이 작업을 접음** (${stamp})${feedback ? `\n- 사유: ${feedback}` : ''}`.trim();
        delete task.blockedReason;
      }
      task.ceoDecision = { action, decision: action === 'drop' ? 'rejected' : action === 'retry' ? 'revision_requested' : 'approved', feedback, at: now };
      task.updatedAt = now;
      done.push(id);
      if (mission) {
        if (!touched.has(mission.id)) touched.set(mission.id, []);
        touched.get(mission.id).push(task.title);
      }
    }
    if (done.length) {
      const label = { retry: '피드백 주고 다시 맡김', accept: '이대로 완료', drop: '작업 접음' }[action];
      appendLog(db, 'CEO', `보류 작업 ${done.length}건 결정: ${label}${feedback ? ` — "${feedback.slice(0, 120)}"` : ''}`, action === 'drop' ? 'warning' : 'info');
      for (const [missionId, titles] of touched) {
        updateMissionStatus(db, missionId);
        rememberFact(db, {
          kind: 'decision',
          missionId,
          text: `보류 작업 ${label}: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` 외 ${titles.length - 3}건` : ''}${feedback ? ` — 대표님 피드백: ${feedback}` : ''}`,
          source: 'ceo_todo'
        });
      }
      saveDb(db);
      await flushCloudBackup(db);
      if (action === 'retry') {
        for (const missionId of touched.keys()) setTimeout(() => autoStartLiveMissionTasks(missionId).catch(() => {}), 1500);
      }
    }
    return c.json({ ok: true, action, done, skipped, state: sanitizeStateForClient(db) });
  });

  // Approval Deliverable (.md) download / preview
  app.get('/api/approvals/:id/deliverable', (c) => {
    const aprId = c.req.param('id');
    const db = loadDb();
    const doc = buildApprovalDeliverable(db, aprId);
    if (!doc) return c.json({ error: '결재 안건을 찾을 수 없습니다.' }, 404);
    if (c.req.query('format') === 'json') return c.json(doc);
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${doc.filename}"`);
    return c.body(doc.markdown);
  });

  // CEO Approval Decision
  app.post('/api/approvals/:id/decide', async (c) => {
    const aprId = c.req.param('id');
    const body = await c.req.json();
    const res = applyApprovalDecisionInDb(aprId, body.decision, body.ceoNote);
    if (!res.ok) return c.json({ error: res.error }, res.status || 400);

    let latestDb = res.db;
    if (res.approval?.kind === 'dev_design') {
      await handleDevDesignDecision(res.approval, body.decision, body.ceoNote);
      latestDb = loadDb();
    } else if (res.approval?.kind === 'stage_gate') {
      const handled = await handleStageGateDecision(res.approval, body.decision, body.ceoNote);
      latestDb = handled?.db || loadDb();
    } else if (res.approval?.kind === 'deliverable_review') {
      const handled = await handleDeliverableReviewDecision(res.approval, body.decision, body.ceoNote);
      latestDb = handled?.db || loadDb();
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
}
