// hub/missions.js: server.js에서 분리 (공유 로직)
import { DEV_TEAM, dispatchDevTeamTask } from './dev-policy.js';
import { kickShortsFactory, queueShortsJob } from './shorts.js';
import { pickBotOrDevMember, ASSIGNMENT_RULES, buildPlanningRoster, isStandingOrder, markCeoActivity, rebalanceAssignments, rememberFact, addLeadNote, isAgentExhausted, pickQuotaSubstitute } from '../lead-engine.js';
import { appendLog, appendMessage, applyInferredMissionBindings, flushCloudBackup, loadDb, saveDb, uid } from '../store.js';
import { assessFeasibility, getOutsourcingSettings } from '../outsourcing.js';
import { leadSpeakerProfile } from '../lead-desk.js';
import { buildDispatchPrompt, decomposeDirective, executeAgentTask, synthesizeMissionReport } from '../orchestrator.js';
import { describeGoogleDataStatus } from '../google-data.js';
import { cancelStaleConsults } from './outsourcing-bridge.js';
import { getMissionRepoCfg, runCodeBundle } from './code-pipeline.js';
import { isOpsMission, leadReportAfterRun, opsCycle, scheduleLeadAdvanceCheck } from './lead-ops.js';
import { notifyTelegramAnomaly } from './notify.js';
import { outsourceTask, processTaskResult } from './task-results.js';

export const AI_TASK_CONCURRENCY = Math.max(1, Number(process.env.AI_TASK_CONCURRENCY || 2));

export async function runWithConcurrency(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function updateMissionStatus(db, missionId) {
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

export async function createMissionInDb({
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
    extraRepos: draftBindings.extraRepos,
    planningRoster: buildPlanningRoster(db),
    assignmentRules: ASSIGNMENT_RULES
  });
  if (Array.isArray(plan.tasks)) {
    const rb = rebalanceAssignments(db, plan.tasks);
    plan.tasks = rb.tasks;
    if (rb.changes.length) appendLog(db, '총괄 팀장', `배정 보정: ${rb.changes.join(' / ')}`.slice(0, 600), 'info');
  }

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
  const fallbackWorker = db.agents.find((a) => a.active && a.tier !== 'lead') || db.agents[0];
  const createdTasks = plan.tasks.map((t) => {
    const picked = agentMap[t.assigneeId];
    const ag = picked && picked.tier !== 'lead' ? picked : fallbackWorker;
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

  const lead = leadSpeakerProfile(db) || agentMap[plan.leadAgentId];
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
    senderShortCode: lead?.shortCode || '팀장',
    senderAccent: lead?.accent || '#0E6245',
    targetAgentId: createdTasks[0]?.assigneeId || null,
    statusText: '업무 분배 완료',
    type: 'plan',
    text: `${plan.planSummary}\n배정 내역: ${assignSummary}`
  });

  rememberFact(db, { kind: 'directive', missionId: mission.id, text: `CEO 지시(새 업무): ${directive}`, source: 'mission' });
  markCeoActivity(db, mission.id);
  saveDb(db);
  flushCloudBackup(db).catch(() => {});

  // Auto-start live API workers immediately without requiring CEO to click "실행"
  // (repo-linked missions: once the team finishes, the IT team turns the team's decisions into a real PR for approval)
  autoStartLiveMissionTasks(mission.id).catch(() => {});

  return { mission, tasks: createdTasks, db };
}

export async function autoStartLiveMissionTasks(missionId, { priorRunTaskIds = [] } = {}) {
  const requeuedIds = new Set();
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
  let autoTargets = db.tasks.filter((t) => {
    if (t.missionId !== missionId) return false;
    if (t.status !== 'queued' && t.status !== 'awaiting_bridge') return false;
    const ag = agentMap[t.assigneeId];
    return Boolean(ag && internalProviders.has(ag.provider));
  });

  // 무료 API 팀원이 실제로 할 수 없는 일(로그인이 필요한 계정·콘솔 작업)은 실행하지 않고 외부 AI 외주로 넘김
  const osCfgRun = getOutsourcingSettings(db.settings);
  if (osCfgRun.enabled && osCfgRun.autoForBrowser) {
    const gd = describeGoogleDataStatus(db.settings);
    const googleDataConnected = Boolean(gd?.hasKey && (gd.gaEnabled || gd.scEnabled));
    autoTargets = autoTargets.filter((t) => {
      if (t.outsourceDeclined) return true;
      const f = assessFeasibility(t, { googleDataConnected });
      if (!f.outsource) return true;
      outsourceTask(db, t, { kind: f.kind, worker: f.worker, reason: f.reason });
      return false;
    });
  }

  // 오늘 사용 한도를 다 쓴 팀원의 작업은 실행하지 않고, 같은 일을 할 수 있는 팀원으로 대체 (한국 시간 자정에 자동 복귀)
  const quotaLoad = {};
  autoTargets = autoTargets.filter((t) => {
    const ag = agentMap[t.assigneeId];
    if (!ag || !isAgentExhausted(ag, db.settings)) return true;
    // 같은 일을 할 API 팀원이 없으면 성격에 맞는 접속 중인 봇 팀원 → 개발팀 Aside
    const sub = pickQuotaSubstitute(db, t, ag, t.triage?.tried || [], quotaLoad) || pickBotOrDevMember(db, t, [ag.id, ...(t.triage?.tried || [])]);
    if (!sub) {
      if (!t.quotaHold) appendLog(db, '총괄 팀장', `"${t.title}" 담당 ${ag.name} 오늘 한도 소진 · 대체 가능한 팀원 없음 → 자정 이후 재개`, 'warning');
      t.quotaHold = true;
      return false;
    }
    quotaLoad[sub.id] = (quotaLoad[sub.id] || 0) + 1;
    t.quotaSwap = { from: ag.id, to: sub.id, at: new Date().toISOString() };
    delete t.quotaHold;
    t.assigneeId = sub.id;
    t.dispatchPrompt = buildDispatchPrompt(sub, t, mission);
    appendLog(db, '총괄 팀장', `"${t.title}" 담당 ${ag.name} 오늘 사용 한도 소진 → ${sub.name}이(가) 대신 처리 (자정까지 ${ag.name} 제외)`, 'info');
    if (sub.connectionMode === 'bridge') {
      // 봇·개발팀은 API로 바로 실행하지 않고 각자 앱·감시기가 가져가게
      t.status = 'awaiting_bridge';
      if (DEV_TEAM[sub.id]) dispatchDevTeamTask(db, t);
      return false;
    }
    return true;
  });

  // 개발팀(Aside·AGY)에게 배정된 작업은 작업 큐로 바로 보냄
  for (const t of db.tasks) {
    if (t.missionId === missionId && DEV_TEAM[t.assigneeId] && ['queued', 'awaiting_bridge'].includes(t.status)) dispatchDevTeamTask(db, t);
  }
  autoTargets = autoTargets.filter((t) => t.status === 'queued' || t.status === 'awaiting_bridge');

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
  const runTaskIds = autoTargets.map((t) => t.id);
  for (const t of autoTargets) {
    t.status = 'running';
    t.updatedAt = startIso;
  }
  saveDb(db);

  // 무료 API 분당 한도 때문에 동시에 너무 많이 호출하면 검수·재시도까지 같이 실패 → 동시 실행 수 제한
  await runWithConcurrency(autoTargets, AI_TASK_CONCURRENCY, async (target) => {
      const ag = agentMap[target.assigneeId];
      try {
        // 판정 오류로 보류됐던 결과는 다시 만들지 않고 저장된 결과로 재검수
        const res = target.recheckOutput
          ? { output: target.recheckOutput, executionModeUsed: target.executionModeUsed || 'recheck' }
          : await executeAgentTask({ task: target, mission, agent: ag, settings: db.settings });
        const fresh = loadDb();
        const taskRow = fresh.tasks.find((x) => x.id === target.id);
        if (!taskRow) return;
        delete taskRow.recheckOutput;
        const out = await processTaskResult(fresh, taskRow, ag, mission, res);
        if (out.requeued) requeuedIds.add(taskRow.id);
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
        // 실행 중 하루 한도가 끝난 경우: 바로 대체 팀원으로 다시 돌림
        if (taskRow && isAgentExhausted(ag, fresh.settings) && !taskRow.quotaRetried) {
          taskRow.quotaRetried = true;
          requeuedIds.add(taskRow.id);
        }
        appendLog(fresh, ag.name, `"${target.title}" 자동 실행 오류: ${err.message}`, 'warning');
        notifyTelegramAnomaly(fresh.settings, `${ag.name} 업무 실행 이상`, `"${target.title}" — ${err.message}`);
        saveDb(fresh);
      }
  });

  // 팀장이 다시 맡긴 작업이 있으면 바로 한 번 더 돌린 뒤 보고·다음 단계로 (작업당 재배정은 1회로 제한)
  if (requeuedIds.size) {
    await autoStartLiveMissionTasks(missionId, { priorRunTaskIds: [...new Set([...priorRunTaskIds, ...runTaskIds])] });
    return;
  }
  if (priorRunTaskIds.length) runTaskIds.splice(0, 0, ...priorRunTaskIds.filter((id) => !runTaskIds.includes(id)));

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
    }
  } catch {
    // non-fatal
  }

  // Repo-linked missions: the team's decisions become ONE real PR attached to the approval card (no extra CEO instruction)
  let codeBundleRes = null;
  try {
    const dbAfter = loadDb();
    const m2 = dbAfter.missions.find((m) => m.id === missionId);
    if (getMissionRepoCfg(dbAfter.settings, m2)) {
      codeBundleRes = await runCodeBundle(missionId);
    }
  } catch (err) {
    console.warn('code bundle after team work failed:', err.message);
  }

  // Team Lead reports to the CEO without being asked (완료·실패·보류 모두)
  try {
    await leadReportAfterRun(missionId, runTaskIds, { codeResult: codeBundleRes?.result || null });
  } catch (err) {
    console.warn('lead completion report failed:', err.message);
  }

  // Continuous Project mode: Team Lead automatically analyzes results and proposes the next phase for CEO approval
  try {
    const mNow = loadDb().missions.find((x) => x.id === missionId);
    if (isOpsMission(mNow)) {
      // 운영 사이클: 작업이 끝나면 팀장이 마일스톤을 판정하고 다음 작업을 바로 배정 (결재 대기 없음)
      setTimeout(() => opsCycle(missionId).catch((err) => console.warn('ops cycle failed:', err.message)), 20 * 1000);
    } else {
      // 단건 업무: 끝나면 팀장이 스스로 검토해 후속 작업을 배정하거나 마무리
      scheduleLeadAdvanceCheck(missionId);
    }
  } catch {
    // non-fatal
  }
}

export function leadSay(db, mission, statusText, text) {
  const fallback = db.agents.find((a) => a.id === (mission.leadAgentId || 'agent_gemini_neon')) || db.agents[0];
  const lead = leadSpeakerProfile(db) || fallback;
  appendMessage(db, {
    missionId: mission.id,
    senderId: lead?.id || 'agent_gemini_neon',
    senderName: lead?.name || '총괄 팀장',
    senderRole: lead?.roleTitle || '총괄 팀장',
    senderShortCode: lead?.shortCode || '팀장',
    senderAccent: lead?.accent || '#0E6245',
    targetAgentId: 'ceo',
    statusText,
    type: 'work',
    text
  });
  return lead;
}

export function applyApprovalDecisionInDb(aprId, decision, ceoNote = '') {
  if (!['approved', 'revision_requested', 'rejected'].includes(decision)) {
    return { ok: false, status: 400, error: '올바른 결재 결정 값이 아닙니다.' };
  }

  const db = loadDb();
  const apr = db.approvals.find((a) => a.id === aprId);
  if (!apr) return { ok: false, status: 404, error: '결재 안건을 찾을 수 없습니다.' };
  // 이미 결정된 안건은 다시 처리하지 않음 (중복 승인으로 단계가 두 번 시작되거나 비용이 두 번 잡히는 것 방지)
  if (apr.status !== 'pending') return { ok: false, status: 409, error: `이미 처리된 결재입니다 (${apr.status}).` };

  const now = new Date().toISOString();
  apr.status = decision;
  apr.ceoNote = String(ceoNote || '').trim();
  apr.decidedAt = now;
  // 결재가 끝났으니 이 안건의 대기 중인 자문 요청은 취소 (외부 작업자 헛일 방지)
  if (apr.missionId) cancelStaleConsults(db, apr.missionId);

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
      // 쇼츠 대본 승인 → 자동 제작기 대기열 (비공개 업로드까지 자동)
      if (task.shorts) {
        const job = queueShortsJob(db, task);
        if (job?.status === 'queued') kickShortsFactory(db.settings).catch(() => {});
      }
    } else if (decision === 'revision_requested') {
      task.status = agent?.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
      if (apr.ceoNote) {
        task.description = `${task.description}\n[CEO 수정 지시] ${apr.ceoNote}`;
      addLeadNote(task, 'ceo', `대표님 수정 지시: ${apr.ceoNote}`);
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
  // Decisions (especially rejections and their reasons) are remembered so the team doesn't repeat them
  const autoNote = /Telegram 모바일 원터치 결재|CI 테스트/.test(apr.ceoNote || '');
  rememberFact(db, {
    kind: 'decision',
    missionId: apr.missionId || '',
    text: `결재 ${labelMap[decision]}: ${apr.title}${apr.ceoNote && !autoNote ? ` — 메모: ${apr.ceoNote}` : ''}`,
    source: 'approval'
  });
  if (apr.missionId) markCeoActivity(db, apr.missionId);
  // 결재 메모에 담긴 상시 지침("앞으로 여기서 … 하지 말 것")은 그 업무의 고정 지침으로 저장
  if (apr.ceoNote && !autoNote && isStandingOrder(apr.ceoNote)) {
    rememberFact(db, {
      kind: 'directive',
      missionId: apr.missionId || '',
      pinned: true,
      text: `대표님 상시 지침(결재 메모): ${apr.ceoNote}`,
      source: 'approval'
    });
  }

  saveDb(db);
  return { ok: true, approval: apr, title: apr.title, db };
}
