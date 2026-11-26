// hub/routines.js: server.js에서 분리 (공유 로직)
import { appendLog, flushCloudBackup, getCloudPersistenceStatus, loadDb, saveDb, uid } from '../store.js';
import { buildDailyBriefing, buildDefaultRoutines, dueSlotKeys, kstParts, normalizeDays, normalizeTimes, runOpsCheck } from '../operations.js';
import { buildDispatchPrompt } from '../orchestrator.js';
import { findScopeViolations, getLeadSettings, isAgentExhausted } from '../lead-engine.js';
import { getAiProviderHealth, exportQuotaState } from '../ai-guard.js';
import { getGithubRepoConfig } from '../it-devops.js';
import { getOutsourcingSettings } from '../outsourcing.js';
import { sendTelegramGated } from '../telegram.js';
import { autoStartLiveMissionTasks, updateMissionStatus } from './missions.js';
import { flushTelegramQueue, notifyTelegramAnomaly } from './notify.js';
import { getMissionRepoCfg, isCodeTask } from './code-pipeline.js';
import { isOpsMission, opsCycle, runLeadFollowUp } from './lead-ops.js';
import { outsourceTask } from './task-results.js';
import { outsourcingWatch } from './outsourcing-bridge.js';

// ================================================================
// 회사 운영 엔진: 루틴(정기) 업무 · 정기 점검 · 자동 복구(워치독) · 일일 마감 보고
// ================================================================
export const OPS_SELF_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'https://ai-ceo-hub.onrender.com';

export const INTERNAL_AI_PROVIDERS = new Set(['exaone', 'gemini', 'groq', 'openrouter']);

export let opsTickRunning = false;

export let lastWatchdogAt = 0;

// first team-lead follow-up runs ~10 minutes after boot (not instantly after a Render restart)
export let lastLeadFollowUpAt = Date.now() - 20 * 60 * 1000;

export const routineRunsInFlight = new Set();

export function describeRoutineSchedule(r) {
  const days = r.days || [];
  const label = ['일', '월', '화', '수', '목', '금', '토'];
  return `${days.length ? days.map((d) => label[d]).join('·') : '매일'} ${(r.times || []).join(', ')}`;
}

export function ensureRoutines(db) {
  if (Array.isArray(db.routines)) return false;
  db.routines = buildDefaultRoutines(db.missions || []);
  return true;
}

export function getRoutineHubMission(db) {
  let m = db.missions.find((x) => x.isRoutineHub);
  if (m) return m;
  const lead = db.agents.find((a) => a.tier === 'lead' && a.active) || db.agents[0];
  m = {
    id: uid('msn'),
    title: '정기 업무 (루틴)',
    directive: '루틴 업무 메뉴에 등록된 정기 업무를 담당 팀원이 정해진 시간마다 수행합니다.',
    domain: 'business',
    costPolicy: db.settings.defaultCostPolicy || 'free_first',
    mode: 'one_off',
    githubRepo: '',
    githubBranch: 'main',
    siteUrl: '',
    extraRepos: [],
    phase: 1,
    phaseHistory: [],
    leadAgentId: lead?.id || 'agent_gemini_neon',
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    leadPlanSummary: '',
    finalReport: '',
    isRoutineHub: true
  };
  db.missions.push(m);
  return m;
}

export function performOpsCheck(db) {
  const cfg = getGithubRepoConfig(db.settings);
  return runOpsCheck({
    db,
    githubToken: cfg.token,
    repos: cfg.allowedRepos,
    aiHealth: getAiProviderHealth(),
    cloudStatus: getCloudPersistenceStatus(),
    selfUrl: OPS_SELF_URL
  });
}

export function createRoutineTask(routine) {
  const db = loadDb();
  const r = db.routines.find((x) => x.id === routine.id) || routine;
  const mission = db.missions.find((m) => m.id === r.missionId) || getRoutineHubMission(db);
  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  let ag = agentMap[r.assigneeId];
  if (!ag?.active) ag = db.agents.find((a) => a.active && INTERNAL_AI_PROVIDERS.has(a.provider) && a.tier !== 'lead') || db.agents[0];
  const now = new Date().toISOString();
  const task = {
    id: uid('tsk'),
    missionId: mission.id,
    phase: Number(mission.phase) || 1,
    title: `[루틴] ${r.title} (${kstParts().date})`,
    description: r.description || r.title,
    assigneeId: ag.id,
    domain: mission.githubRepo && (ag.team === 'it' || /코드|사이트|저장소|수정/.test(r.description || '')) ? 'it_ops' : mission.domain,
    status: ag.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued',
    requiresApproval: false,
    estimatedCostKRW: 0,
    dispatchPrompt: '',
    output: '',
    executionModeUsed: '',
    source: 'routine',
    routineId: r.id,
    createdAt: now,
    updatedAt: now
  };
  task.dispatchPrompt = buildDispatchPrompt(ag, task, mission);
  db.tasks.unshift(task);
  mission.status = 'in_progress';
  r.lastTaskId = task.id;
  saveDb(db);
  autoStartLiveMissionTasks(mission.id).catch(() => {});
  return { task, mission, agent: ag };
}

export async function runRoutine(routineId, { slotKeys = [], manual = false } = {}) {
  if (routineRunsInFlight.has(routineId)) return { ok: false, error: '이미 실행 중입니다.' };
  routineRunsInFlight.add(routineId);
  try {
    let db = loadDb();
    ensureRoutines(db);
    const r = db.routines.find((x) => x.id === routineId);
    if (!r) return { ok: false, error: '루틴을 찾을 수 없습니다.' };
    if (slotKeys.length) r.runKeys = [...(r.runKeys || []), ...slotKeys].slice(-30);
    r.lastRunAt = new Date().toISOString();
    r.lastStatus = 'running';
    r.runCount = (r.runCount || 0) + 1;
    saveDb(db);

    let status = 'ok';
    let result = '';
    let anomalies = [];
    let telegramHtml = '';
    if (r.kind === 'ops_check' || r.kind === 'briefing') {
      const ops = await performOpsCheck(loadDb());
      anomalies = ops.anomalies;
      status = ops.status;
      if (r.kind === 'ops_check') {
        result = ops.markdown;
      } else {
        const fresh = loadDb();
        const b = buildDailyBriefing({ db: fresh, ops, companyName: fresh.settings.companyName || 'CEO Office' });
        result = `${b.markdown}\n\n---\n#### 상세 점검 결과\n${ops.markdown}`;
        telegramHtml = b.telegramHtml;
      }
    } else {
      const created = createRoutineTask(r);
      status = 'started';
      result = `업무 "${created.task.title}"를 @${created.agent.name}에게 배정하고 실행을 시작했습니다. (${created.mission.title})`;
    }

    db = loadDb();
    const r2 = db.routines.find((x) => x.id === routineId);
    if (r2) {
      r2.lastStatus = status;
      r2.lastResult = result;
      r2.lastFinishedAt = new Date().toISOString();
      if (r.kind === 'task') r2.lastTaskId = r2.lastTaskId || '';
    }
    appendLog(
      db,
      '루틴 업무',
      `${manual ? '[수동 실행] ' : ''}"${r.title}" ${status === 'warning' ? `이상 ${anomalies.length}건 발견` : status === 'started' ? '업무 배정·실행 시작' : '정상 완료'}`,
      status === 'warning' ? 'warning' : 'info'
    );
    saveDb(db);
    await flushCloudBackup(db);

    const tg = db.settings.telegram || {};
    if (telegramHtml && r.notify === 'always' && tg.botToken && tg.chatId) {
      sendTelegramGated(db.settings, 'report', telegramHtml, r.title).catch(() => {});
    } else if (anomalies.length && r.notify !== 'never') {
      notifyTelegramAnomaly(db.settings, `${r.title}: 이상 ${anomalies.length}건`, anomalies.slice(0, 4).join('\n'));
    }
    return { ok: true, status, result };
  } catch (err) {
    const db = loadDb();
    const r = (db.routines || []).find((x) => x.id === routineId);
    if (r) {
      r.lastStatus = 'error';
      r.lastResult = `실행 오류: ${err.message}`;
    }
    appendLog(db, '루틴 업무', `루틴 실행 오류: ${err.message}`, 'warning');
    saveDb(db);
    return { ok: false, error: err.message };
  } finally {
    routineRunsInFlight.delete(routineId);
  }
}

/**
 * Self-maintenance: recover stuck work and restart stalled AI tasks without the CEO noticing.
 */
export async function runWatchdog() {
  const db = loadDb();
  const now = Date.now();
  const ageMin = (iso) => (iso ? (now - new Date(iso).getTime()) / 60000 : Infinity);
  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  const actions = [];
  const exhausted = [];
  const nowIso = new Date().toISOString();

  for (const t of db.tasks) {
    if (t.status === 'running' && ageMin(t.updatedAt) > 20) {
      t.status = 'queued';
      t.updatedAt = nowIso;
      actions.push(`멈춘 작업 복구 "${t.title}"`);
    }
  }

  const relaunch = new Set();
  // 외부 봇(Muse·Cue 등)이 6시간 넘게 안 가져간 업무: 대표님 범위 밖이면 보류, 실제 전화·결제·발송이 아니면 내부 AI로 재배정
  const EXTERNAL_BOTS = new Set(['pickle', 'manus', 'muse', 'vooy', 'instinct']);
  const fallbackAgent =
    (agentMap.agent_groq?.active && agentMap.agent_groq) ||
    db.agents.find((a) => a.active && INTERNAL_AI_PROVIDERS.has(a.provider) && a.tier !== 'lead' && a.provider !== 'exaone');
  for (const t of db.tasks) {
    if (t.status !== 'awaiting_bridge') continue;
    const ag = agentMap[t.assigneeId];
    if (!ag || !EXTERNAL_BOTS.has(ag.provider) || ageMin(t.updatedAt) < 6 * 60) continue;
    const mission = db.missions.find((m) => m.id === t.missionId);
    const text = `${t.title} ${t.description || ''}`;
    const outOfScope = mission ? findScopeViolations(mission, text) : [];
    if (outOfScope.length) {
      t.status = 'rejected';
      t.updatedAt = nowIso;
      t.output = `${t.output || ''}\n\n[자동 보류] 대표님이 정한 업무 범위 밖(${outOfScope.join(', ')})이라 진행하지 않습니다.`.trim();
      actions.push(`범위 밖 외부 업무 보류 "${t.title}"`);
      continue;
    }
    if (/전화|예약\s*확정|결제|송금|대외\s*발송|방문/.test(text) || !fallbackAgent || !mission) continue;
    t.description = `${t.description || ''}\n[자동 재배정] ${ag.name} 앱이 6시간 동안 가져가지 않아 내부 AI가 대신 처리합니다. 외부 앱에서만 할 수 있는 일은 대표님 실행 가이드로 정리하세요.`;
    t.assigneeId = fallbackAgent.id;
    t.status = 'queued';
    t.updatedAt = nowIso;
    t.dispatchPrompt = buildDispatchPrompt(fallbackAgent, t, mission);
    relaunch.add(t.missionId);
    actions.push(`외부 봇 무응답 → 재배정 "${t.title}" (${ag.name} → ${fallbackAgent.name})`);
  }

  // 결재 대기 상태인데 실제 대기 결재가 없는 업무는 상태를 바로잡음
  for (const m of db.missions) {
    if (m.status === 'waiting_approval' && !db.approvals.some((a) => a.missionId === m.id && a.status === 'pending')) {
      updateMissionStatus(db, m.id);
      if (m.status === 'waiting_approval') m.status = 'in_progress';
      actions.push(`업무 상태 정정 "${m.title}"`);
    }
  }

  // 작전 계획을 아직 못 세운(AI 한도 등) 프로젝트는 운영 사이클 재시도
  const duePlan = db.missions.filter((m) => isOpsMission(m) && !m.plan?.milestones?.length && !db.tasks.some((t) => t.missionId === m.id && ['queued', 'running'].includes(t.status)));
  for (const m of duePlan) actions.push(`작전 계획 재시도 "${m.title}"`);

  const cooling = new Set(getAiProviderHealth().cooldowns.map((c) => c.provider));
  const allAiCooling = ['gemini', 'groq', 'openrouter'].every((p) => cooling.has(p));
  if (!allAiCooling) {
    for (const t of db.tasks) {
      if (t.status !== 'queued') continue;
      const ag = agentMap[t.assigneeId];
      if (!ag?.active || !INTERNAL_AI_PROVIDERS.has(ag.provider)) continue;
      // 오늘 한도 소진으로 대체 팀원도 없어 멈춘 작업은 재시도 횟수를 쓰지 않고 자정까지 대기
      if (t.quotaHold && isAgentExhausted(ag, db.settings)) continue;
      const age = ageMin(t.updatedAt);
      if (age < 10 || age > 3 * 24 * 60) continue;
      if (db.tasks.some((x) => x.missionId === t.missionId && x.status === 'running')) continue;
      if ((t.autoRetries || 0) >= 3) {
        if (!t.autoRetryExhausted) {
          t.autoRetryExhausted = true;
          const osW = getOutsourcingSettings(db.settings);
          if (osW.enabled && osW.autoOnFailure && !t.outsourceDeclined) {
            const m = db.missions.find((x) => x.id === t.missionId);
            const kind = m && getMissionRepoCfg(db.settings, m) && isCodeTask(t, ag) ? 'code' : 'task';
            const req = outsourceTask(db, t, { kind, worker: kind === 'code' ? 'antigravity' : 'any', reason: 'AI 엔진으로 3번 실행했지만 결과를 만들지 못함' });
            actions.push(`재시도 3회 소진 → 외주 ${req.id} "${t.title}"`);
          } else {
            exhausted.push(t.title);
            actions.push(`자동 재시도 3회 소진 "${t.title}"`);
          }
        }
        continue;
      }
      t.autoRetries = (t.autoRetries || 0) + 1;
      relaunch.add(t.missionId);
      actions.push(`대기 업무 재실행 "${t.title}" (${t.autoRetries}회차)`);
    }
  }

  // 하루 한도 소진 기록을 저장해 서버가 재시작돼도 자정까지 제외가 유지되게 함
  db.aiQuota = exportQuotaState();
  db.settings.opsWatchdog = {
    lastRunAt: nowIso,
    lastActions: actions.slice(0, 10),
    aiCooling: [...cooling]
  };
  if (actions.length) appendLog(db, '자동 복구', actions.join(' / ').slice(0, 600), 'info');
  saveDb(db);
  if (actions.length) flushCloudBackup(db).catch(() => {});
  for (const missionId of relaunch) autoStartLiveMissionTasks(missionId).catch(() => {});
  if (!allAiCooling) {
  for (const m of duePlan) opsCycle(m.id).catch((err) => console.warn('plan retry failed:', err.message));
  }
  try {
    await outsourcingWatch();
  } catch (err) {
    console.warn('outsourcing watch failed:', err.message);
  }
  if (exhausted.length) {
    notifyTelegramAnomaly(db.settings, '자동 재시도 한계 도달', `${exhausted.slice(0, 3).join(', ')} — AI 엔진 한도나 지시 내용을 확인해 주세요.`);
  }
  return { actions };
}

export async function opsTick() {
  if (process.env.CI || opsTickRunning) return;
  opsTickRunning = true;
  try {
    const db = loadDb();
    if (ensureRoutines(db)) {
      saveDb(db);
      await flushCloudBackup(db);
    }
    for (const r of db.routines) {
      const keys = dueSlotKeys(r);
      if (keys.length) await runRoutine(r.id, { slotKeys: keys });
    }
    if (Date.now() - lastWatchdogAt > 5 * 60 * 1000) {
      lastWatchdogAt = Date.now();
      await runWatchdog();
    }
    await flushTelegramQueue();
    const leadCfg = getLeadSettings(loadDb().settings);
    const followEveryMs = Math.max(10, Number(leadCfg.followUpMinutes) || 30) * 60 * 1000;
    if (leadCfg.enabled && Date.now() - lastLeadFollowUpAt > followEveryMs) {
      lastLeadFollowUpAt = Date.now();
      await runLeadFollowUp();
    }
  } catch (err) {
    console.warn('ops tick error:', err.message);
  } finally {
    opsTickRunning = false;
  }
}

export function sanitizeRoutineInput(body, existing = {}) {
  const out = {};
  if (typeof body.title === 'string' && body.title.trim()) out.title = body.title.trim().slice(0, 80);
  if (typeof body.description === 'string') out.description = body.description.trim().slice(0, 2000);
  if (body.times !== undefined) out.times = normalizeTimes(body.times);
  if (body.days !== undefined) out.days = normalizeDays(body.days);
  if (typeof body.missionId === 'string') out.missionId = body.missionId.trim();
  if (typeof body.assigneeId === 'string') out.assigneeId = body.assigneeId.trim();
  if (['anomaly', 'always', 'never'].includes(body.notify)) out.notify = body.notify;
  if (typeof body.enabled === 'boolean') out.enabled = body.enabled;
  if (['task', 'ops_check', 'briefing'].includes(body.kind) && !existing.id) out.kind = body.kind;
  return out;
}
