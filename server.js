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
  generateStandupSession,
  classifyChatDirective,
  setCompanyContextProvider,
  planLeadFollowUp
} from './src/orchestrator.js';
import {
  ensureLeadDefaults,
  getLeadSettings,
  missionLeadState,
  markCeoActivity,
  rememberFact,
  forgetFact,
  buildCompanyContext,
  buildCompletionReport,
  collectFollowUps,
  buildMissionDigest,
  escapeTelegramHtml,
  isStandingOrder,
  getMissionScope,
  findScopeViolations,
  getMissionGoal,
  detectNonResult,
  classifyBlocker,
  triageGuidance,
  pickAlternateMember,
  describeTeamLoad,
  buildPlanningRoster,
  rebalanceAssignments,
  ASSIGNMENT_RULES
} from './src/lead-engine.js';
import { describeSkillsForClient, getSkillSettings, selectSkills, renderSkills } from './src/skills.js';
import { testGoogleDataConnection, buildAnalyticsContext, describeGoogleDataStatus } from './src/google-data.js';
import { factCheckOutput, formatFactIssues, saysNothingToDo, isNearDuplicate, getRepoSnapshot } from './src/grounding.js';

const AI_TASK_CONCURRENCY = Math.max(1, Number(process.env.AI_TASK_CONCURRENCY || 2));
async function runWithConcurrency(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await fn(item);
    }
  });
  await Promise.all(workers);
}
import { handleOfficialMcpHttp, MCP_TOOL_CATALOG } from './src/mcp.js';
import {
  sendTelegramAlert,
  sendTelegramReport,
  sendTelegramGated,
  setTelegramDeferHandler,
  isQuietNow,
  getTelegramNotifyPrefs,
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
import { getAiProviderHealth } from './src/ai-guard.js';
import {
  OUTSOURCE_WORKER_LABELS,
  OUTSOURCE_KIND_LABELS,
  setOutsourcingHandlers,
  getOutsourcingSettings,
  publicBaseUrl,
  assessFeasibility,
  extractOutsourceFlag,
  createOutsourcingRequest,
  findRequest,
  listRequests,
  summarizeRequest,
  claimRequest,
  submitResult,
  cancelRequest,
  releaseExpiredLeases,
  buildPacket,
  resolveTarget,
  describeRouting,
  describeRolesLine,
  requestCeoAction,
  resumeRequest,
  assignRequest,
  setRequestEffort,
  shortenForeignLeases
} from './src/outsourcing.js';
import {
  kstParts,
  normalizeTimes,
  normalizeDays,
  dueSlotKeys,
  buildDefaultRoutines,
  runOpsCheck,
  buildDailyBriefing
} from './src/operations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PKG = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

// Every AI call (team work, team-lead chat, reports, planning) receives the CEO's global directives + company memory
setCompanyContextProvider((missionId, opts) => buildCompanyContext(loadDb(), missionId, opts));
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

  rememberFact(db, { kind: 'directive', missionId: mission.id, text: `CEO 지시(새 업무): ${directive}`, source: 'mission' });
  markCeoActivity(db, mission.id);
  saveDb(db);
  flushCloudBackup(db).catch(() => {});

  // Auto-start live API workers immediately without requiring CEO to click "실행"
  // (repo-linked missions: once the team finishes, the IT team turns the team's decisions into a real PR for approval)
  autoStartLiveMissionTasks(mission.id).catch(() => {});

  return { mission, tasks: createdTasks, db };
}

async function autoStartLiveMissionTasks(missionId, { proposeNext = true, priorRunTaskIds = [] } = {}) {
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
        const res = await executeAgentTask({ task: target, mission, agent: ag, settings: db.settings });
        const fresh = loadDb();
        const taskRow = fresh.tasks.find((x) => x.id === target.id);
        if (!taskRow) return;
        const doneIso = new Date().toISOString();
        taskRow.output = res.output;
        taskRow.executionModeUsed = res.executionModeUsed;
        if (res.quality) taskRow.quality = res.quality;
        taskRow.updatedAt = doneIso;

        // 팀원이 "[외주 필요: 사유]"라고 판단하면 억지 결과 대신 외부 AI에 맡김
        // 외주를 끈(취소한) 작업도 "[외주 필요]"만 쓴 결과는 결과물이 아니므로 팀장 검토 대상 (외주로는 보내지 않음)
        const osFlag = extractOutsourceFlag(res.output);
        // 팀장 검토: "못 한다/정보 달라"뿐인 결과는 완료로 치지 않고 다시 맡기거나(내부 우선), 진짜 계정 작업만 외주
        const triage = leadTriageResult(fresh, taskRow, ag, mission, res.output, osFlag);
        if (triage.handled) {
          if (triage.requeued) requeuedIds.add(taskRow.id);
          updateMissionStatus(fresh, mission.id);
          saveDb(fresh);
          await flushCloudBackup(fresh);
          return;
        }

        // 빈 결재 방지: 결과물 스스로 "할 일 없음/이미 완료"라고 하면 대표님께 결재를 올리지 않고 팀장 전결 종료
        if (taskRow.requiresApproval && saysNothingToDo(res.output)) {
          taskRow.requiresApproval = false;
          taskRow.output = `> 팀장 판단: 실행할 변경이 없어 결재 없이 종료합니다.\n\n${taskRow.output}`;
          appendLog(fresh, '총괄 팀장', `"${taskRow.title}" — 실행할 변경이 없다고 보고돼 빈 결재를 올리지 않고 종료했습니다.`, 'info');
        }
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
  });

  // 팀장이 다시 맡긴 작업이 있으면 바로 한 번 더 돌린 뒤 보고·다음 단계로 (작업당 재배정은 1회로 제한)
  if (requeuedIds.size) {
    await autoStartLiveMissionTasks(missionId, { proposeNext, priorRunTaskIds: [...new Set([...priorRunTaskIds, ...runTaskIds])] });
    return;
  }
  if (priorRunTaskIds.length) runTaskIds.splice(0, 0, ...priorRunTaskIds.filter((id) => !runTaskIds.includes(id)));

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
    if (isProjectMission && proposeNext) {
      await submitNextPhaseProposal(missionId);
    } else {
      // 그 외(회의실 지시·단건 업무): 단계가 끝나면 팀장이 스스로 검토해 제안서를 올림
      scheduleLeadAdvanceCheck(missionId);
    }
  } catch {
    // non-fatal
  }
}

const stripPhaseLabel = (s = '') => String(s).replace(/\[Phase\s*\d+\s*제안\]/gi, ' ').replace(/Phase\s*\d+\s*:?/gi, ' ');

function isRepeatOfRecentProposal(db, missionId, proposal) {
  const prev = db.approvals
    .filter((a) => a.missionId === missionId && a.kind === 'next_phase')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 3);
  const steps = (proposal.suggestedSteps || []).map(stripPhaseLabel);
  return prev.some((p) => {
    const sameTitle = isNearDuplicate(stripPhaseLabel(p.title), stripPhaseLabel(proposal.nextPhaseTitle));
    const prevSteps = (p.proposedSteps || []).map(stripPhaseLabel);
    const overlap = steps.filter((s) => prevSteps.some((x) => isNearDuplicate(s, x))).length;
    return sameTitle && steps.length > 0 && overlap >= Math.ceil(steps.length * 0.6);
  });
}

function leadSay(db, mission, statusText, text) {
  const lead = db.agents.find((a) => a.id === (mission.leadAgentId || 'agent_gemini_neon')) || db.agents[0];
  appendMessage(db, {
    missionId: mission.id,
    senderId: lead?.id || 'agent_gemini_neon',
    senderName: lead?.name || '총괄 팀장',
    senderRole: lead?.roleTitle || '총괄 팀장',
    senderShortCode: lead?.shortCode || 'GN',
    senderAccent: lead?.accent || '#0E6245',
    targetAgentId: 'ceo',
    statusText,
    type: 'work',
    text
  });
  return lead;
}

/** AI 엔진 한도로 제안서를 못 썼을 때: 템플릿으로 채우지 않고 30분 뒤 재시도(최대 4회) */
async function deferNextPhaseProposal(missionId, note, reason) {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return { ok: false, error: reason };
  const retries = Number(mission.pendingProposalRetries || 0) + 1;
  if (retries > 4) {
    delete mission.pendingProposalRetryAt;
    delete mission.pendingProposalNote;
    delete mission.pendingProposalRetries;
    leadSay(db, mission, '제안 보류', `다음 단계 제안서를 4번 시도했지만 AI 엔진 한도로 작성하지 못했습니다. 일반 문구로 채운 제안은 올리지 않았습니다. 한도가 풀리면(보통 다음 날 오전) 다시 쓰겠습니다. 급하면 회의실에 방향을 말씀해 주세요.`);
    notifyTelegramAnomaly(db.settings, '다음 단계 제안서 작성 실패', `${mission.title}: AI 엔진 한도로 4회 실패`);
  } else {
    mission.pendingProposalRetryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    mission.pendingProposalNote = String(note || '').slice(0, 1500);
    mission.pendingProposalRetries = retries;
    leadSay(db, mission, '제안 보류', `다음 단계 제안서를 지금은 AI 엔진 한도 때문에 쓰지 못했습니다. 똑같은 일반 제안으로 채워 올리지 않고 30분 뒤 다시 쓰겠습니다. (${retries}/4회)`);
  }
  if (mission.status === 'waiting_approval' && !db.approvals.some((a) => a.missionId === mission.id && a.status === 'pending')) {
    mission.status = 'in_progress';
  }
  appendLog(db, '총괄 팀장', `"${mission.title}" 다음 단계 제안 보류: ${String(reason || '').slice(0, 300)}`, 'warning');
  saveDb(db);
  await flushCloudBackup(db);
  return { ok: false, deferred: true, error: '다음 단계 제안서를 AI 엔진 한도로 작성하지 못해 30분 뒤 다시 시도합니다.', db };
}

/** 같은 제안이 반복될 때: 결재를 올리지 않고 대표님께 방향을 여쭘 */
async function holdRepeatedProposal(missionId, reason) {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return { ok: false, error: reason };
  delete mission.pendingProposalRetryAt;
  delete mission.pendingProposalNote;
  delete mission.pendingProposalRetries;
  if (mission.status === 'waiting_approval' && !db.approvals.some((a) => a.missionId === mission.id && a.status === 'pending')) {
    mission.status = 'in_progress';
  }
  leadSay(db, mission, '제안 보류', `다음 단계 제안이 직전 제안과 사실상 같아서 결재에 올리지 않았습니다. 지금 결과만으로는 새로 진전할 일이 뚜렷하지 않습니다. 다음 목표(예: 특정 계산기 추가, 광고 배치 변경, 검색 유입 키워드)를 회의실에 한 줄로 말씀해 주시면 그 방향으로 제안하겠습니다.`);
  appendLog(db, '총괄 팀장', `"${mission.title}" 반복 제안 차단: ${String(reason || '').slice(0, 200)}`, 'info');
  saveDb(db);
  await flushCloudBackup(db);
  return { ok: false, held: true, error: '직전 제안과 같은 내용이라 결재에 올리지 않았습니다.', db };
}

async function submitNextPhaseProposal(missionId, { leadAssessment = '' } = {}) {
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
  let proposal = await proposeNextProjectPhase({
    mission,
    tasks: missionTasks,
    agents: db.agents,
    settings: db.settings,
    leadAssessment
  });
  if (proposal.failed) return deferNextPhaseProposal(mission.id, leadAssessment, proposal.error);
  // 제안서가 업무 범위를 벗어나면(대표님이 하지 말라고 한 일) 한 번 다시 쓰고, 그래도 걸리면 해당 단계를 빼고 올림
  const proposalText = (p) => `${p.nextPhaseTitle} ${p.nextDirective} ${(p.suggestedSteps || []).join(' ')}`;
  let violations = findScopeViolations(mission, proposalText(proposal));
  if (violations.length) {
    const scope = getMissionScope(mission);
    const rewritten = await proposeNextProjectPhase({
      mission,
      tasks: missionTasks.filter((t) => !findScopeViolations(mission, `${t.title} ${t.description}`).length),
      agents: db.agents,
      settings: db.settings,
      leadAssessment: `${leadAssessment}\n[중요] 이전 제안이 대표님이 금지한 범위(${violations.join(', ')})를 포함해 폐기됐습니다. 해당 내용을 절대 넣지 말고, 집중할 일(${scope.focus || mission.directive})에만 맞춰 다시 제안하세요.`
    });
    if (!rewritten.failed) proposal = rewritten;
    violations = findScopeViolations(mission, proposalText(proposal));
    if (violations.length) {
      proposal.suggestedSteps = (proposal.suggestedSteps || []).filter((s) => !findScopeViolations(mission, s).length);
      proposal.rationale = `${proposal.rationale}\n(업무 범위 밖 내용 ${violations.join(', ')}은 자동으로 제외함)`;
    }
  }

  // 제안서 사실 확인: 없는 파일·PR을 전제로 하거나, 이미 끝난 작업을 다시 하자는 제안이면 한 번 다시 씁니다
  const snap = mission.githubRepo
    ? await getRepoSnapshot({ repo: mission.githubRepo, branch: mission.githubBranch || 'main', token: getGithubRepoConfig(db.settings).token }).catch(() => null)
    : null;
  const doneTitles = missionTasks.filter((t) => t.status === 'completed').map((t) => t.title).slice(0, 60);
  const checkProposal = (p) => {
    const issues = factCheckOutput(proposalText(p), snap, { canExecute: true }).map((i) => i.detail);
    for (const step of p.suggestedSteps || []) {
      const dup = doneTitles.find((t) => isNearDuplicate(step, t));
      if (dup) issues.push(`이미 완료된 작업 "${dup}"과 사실상 같은 단계 "${String(step).slice(0, 60)}"`);
    }
    return issues;
  };
  let proposalIssues = checkProposal(proposal);
  if (proposalIssues.length) {
    const rewritten2 = await proposeNextProjectPhase({
      mission,
      tasks: missionTasks,
      agents: db.agents,
      settings: db.settings,
      leadAssessment: `${leadAssessment}\n[중요] 직전 제안에 다음 문제가 있어 폐기했습니다. 같은 실수를 하지 말고, 실제 파일·새로운 일만 담아 다시 제안하세요:\n${proposalIssues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`
    });
    if (!rewritten2.failed) proposal = rewritten2;
    proposalIssues = checkProposal(proposal);
    if (proposalIssues.length) {
      proposal.rationale = `${proposal.rationale}\n\n⚠️ 자동 사실 확인 경고(결재 전 확인 필요):\n${proposalIssues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
    }
  }

  // 직전 제안과 사실상 같은 제안(예: 수정 지시 직후 같은 내용 재상신)은 올리지 않습니다.
  if (isRepeatOfRecentProposal(db, mission.id, proposal)) {
    const again = await proposeNextProjectPhase({
      mission,
      tasks: missionTasks,
      agents: db.agents,
      settings: db.settings,
      leadAssessment: `${leadAssessment}\n[중요] 직전 제안과 제목·단계가 사실상 같아 폐기했습니다. 대표님이 "맨날 똑같은 일"이라고 지적하셨습니다. 이번 단계에서 실제로 바뀐 것(배포·데이터·결과물)을 근거로, 이전과 다른 구체적 진전안만 제안하세요. 진전할 것이 없으면 그렇다고 쓰세요.`
    });
    if (again.failed) return deferNextPhaseProposal(mission.id, leadAssessment, again.error);
    if (isRepeatOfRecentProposal(db, mission.id, again)) return holdRepeatedProposal(mission.id, '직전 제안과 같은 내용');
    proposal = again;
  }

  const leadId = mission.leadAgentId || 'agent_gemini_neon';
  const lead = db.agents.find((a) => a.id === leadId) || db.agents[0];
  const now = new Date().toISOString();
  const stepsText = (proposal.suggestedSteps || []).map((s, i) => `${i + 1}. ${s}`).join('\n');
  delete mission.pendingProposalRetryAt;
  delete mission.pendingProposalNote;
  delete mission.pendingProposalRetries;

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
    summary: [
      proposal.goalGap ? `목표까지 남은 차이·병목: ${proposal.goalGap}` : '',
      proposal.rationale,
      proposal.kpi ? `이번 단계 지표·목표치: ${proposal.kpi}` : '',
      proposal.doneCriteria ? `완료 기준: ${proposal.doneCriteria}` : '',
      `기대 효과: ${proposal.expectedImpact}`
    ]
      .filter(Boolean)
      .join('\n\n'),
    goalGap: proposal.goalGap || '',
    kpi: proposal.kpi || '',
    doneCriteria: proposal.doneCriteria || '',
    proposedAction: `승인 시 총괄 팀장(${lead?.name || 'Gemini 4 Hydrogen'})이 Phase ${proposal.nextPhase} 작업을 자동 분배·착수합니다:\n${stepsText}`,
    status: 'pending',
    ceoNote: '',
    createdAt: now,
    decidedAt: null
  };

  db.approvals.unshift(apr);
  mission.status = 'waiting_approval';
  // 다음 제안 때 "지표가 움직였는지" 비교할 수 있도록 지금 지표를 남김
  if (proposal.metricsText) mission.lastMetricsSnapshot = { at: now, phase: currentPhase, text: String(proposal.metricsText).slice(0, 2000) };

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

  const osCfgP = getOutsourcingSettings(db.settings);
  if (osCfgP.enabled && osCfgP.consultMode !== 'off') requestConsultForApproval(db, apr);
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

  saveDb(db);
  return decomposeIntoPhaseTasks(mission.id, combinedDirective);
}

/**
 * 승인된 단계 지시를 실제 작업으로 분해해 착수합니다.
 * AI 엔진이 모두 실패하면 '핵심 자료 조사…' 같은 일반 작업으로 채우지 않고 30분 뒤 다시 분해합니다(최대 4회).
 */
async function decomposeIntoPhaseTasks(missionId, combinedDirective) {
  const db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return null;
  const nextPhase = Number(mission.phase) || 1;
  const now = new Date().toISOString();

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
    extraRepos: Array.isArray(mission.extraRepos) ? mission.extraRepos : [],
    planningRoster: buildPlanningRoster(db),
    assignmentRules: ASSIGNMENT_RULES
  });
  if (!plan.aiFailed && Array.isArray(plan.tasks)) {
    const rb = rebalanceAssignments(db, plan.tasks);
    plan.tasks = rb.tasks;
    if (rb.changes.length) appendLog(db, '총괄 팀장', `"${mission.title}" 배정 보정: ${rb.changes.join(' / ')}`.slice(0, 600), 'info');
  }

  if (plan.aiFailed) {
    const retries = Number(mission.pendingPhaseRetries || 0) + 1;
    if (retries > 4) {
      delete mission.pendingPhaseDirective;
      delete mission.pendingPhaseRetryAt;
      delete mission.pendingPhaseRetries;
      leadSay(db, mission, '착수 보류', `Phase ${nextPhase} 작업 분해를 4번 시도했지만 AI 엔진 한도로 실패했습니다. 의미 없는 일반 작업으로 채우지 않았습니다. 한도가 풀리면 다시 시도하겠습니다.`);
      notifyTelegramAnomaly(db.settings, '단계 착수 실패', `${mission.title} Phase ${nextPhase}: AI 엔진 한도로 작업 분해 4회 실패`);
    } else {
      mission.pendingPhaseDirective = combinedDirective;
      mission.pendingPhaseRetryAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      mission.pendingPhaseRetries = retries;
      leadSay(db, mission, '착수 보류', `Phase ${nextPhase} 작업 분해를 지금은 AI 엔진 한도 때문에 못 했습니다. 일반 작업으로 채우지 않고 30분 뒤 다시 나누겠습니다. (${retries}/4회)`);
    }
    appendLog(db, '총괄 팀장', `"${mission.title}" Phase ${nextPhase} 작업 분해 보류: ${String(plan.fallbackReason || '').slice(0, 300)}`, 'warning');
    saveDb(db);
    await flushCloudBackup(db);
    return { mission, newTasks: [], deferred: true, db };
  }
  delete mission.pendingPhaseDirective;
  delete mission.pendingPhaseRetryAt;
  delete mission.pendingPhaseRetries;

  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  // 업무 범위 밖(대표님이 하지 말라고 한 일) 작업은 만들지 않음
  const droppedOutOfScope = [];
  plan.tasks = plan.tasks.filter((t) => {
    const hit = findScopeViolations(mission, `${t.title} ${t.description}`);
    if (hit.length) droppedOutOfScope.push(`${t.title}(${hit.join(',')})`);
    return !hit.length;
  });
  if (droppedOutOfScope.length) {
    appendLog(db, '총괄 팀장', `"${mission.title}" 업무 범위 밖 작업 ${droppedOutOfScope.length}건 제외: ${droppedOutOfScope.join(' / ')}`.slice(0, 600), 'warning');
  }
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
  const base = { ...(apr.codeChange || {}) };
  if (['ready', 'merging', 'merged', 'deployed'].includes(status)) delete base.error; // stale failure text
  apr.codeChange = { ...base, ...extra, status, updatedAt: new Date().toISOString() };
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

/**
 * 사전 승인된 카드(들)을 "변경 내용 확인" 결재로 대체. 새 카드를 승인해야만 병합·배포됨.
 */
function requestDiffApproval(db, apr, result, mission, extraIds = []) {
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

// ================================================================
// 총괄 팀장 보고 · 회사 기억 · 능동 추진
// ================================================================
// ================================================================
// 텔레그램 알림 설정: 보고 켜기/끄기 · 방해금지 시간(그 사이 알림은 모아두었다가 끝나면 요약 발송)
// ================================================================
function sanitizeNotifyPrefs(input = {}, current = {}) {
  const cur = getTelegramNotifyPrefs({ telegram: { notify: current } });
  const hm = (v, d) => (/^\d{1,2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim().padStart(5, '0') : d);
  const q = input.quiet && typeof input.quiet === 'object' ? input.quiet : {};
  return {
    reports: typeof input.reports === 'boolean' ? input.reports : cur.reports,
    alerts: typeof input.alerts === 'boolean' ? input.alerts : cur.alerts,
    approvals: typeof input.approvals === 'boolean' ? input.approvals : cur.approvals,
    quiet: {
      enabled: typeof q.enabled === 'boolean' ? q.enabled : cur.quiet.enabled,
      start: hm(q.start, cur.quiet.start),
      end: hm(q.end, cur.quiet.end),
      allowUrgent: typeof q.allowUrgent === 'boolean' ? q.allowUrgent : cur.quiet.allowUrgent
    }
  };
}

function queueDeferredTelegram(item) {
  try {
    const db = loadDb();
    ensureLeadDefaults(db);
    const q = Array.isArray(db.leadState.telegramQueue) ? db.leadState.telegramQueue : [];
    const key = `${item.kind}:${item.approvalId || item.title || ''}`;
    if (!q.some((x) => `${x.kind}:${x.approvalId || x.title || ''}` === key)) {
      q.push({ kind: item.kind, title: String(item.title || '').slice(0, 120), body: String(item.body || '').slice(0, 600), approvalId: item.approvalId || '', at: item.at || new Date().toISOString() });
    }
    db.leadState.telegramQueue = q.slice(-60);
    saveDb(db);
  } catch (err) {
    console.warn('telegram defer failed:', err.message);
  }
}

let telegramFlushRunning = false;
async function flushTelegramQueue({ force = false } = {}) {
  if (telegramFlushRunning) return;
  const db = loadDb();
  const q = db.leadState?.telegramQueue;
  if (!Array.isArray(q) || !q.length) return;
  if (!force && isQuietNow(db.settings)) return;
  const tg = db.settings.telegram || {};
  if (!tg.botToken || !tg.chatId) return;
  telegramFlushRunning = true;
  try {
    db.leadState.telegramQueue = [];
    saveDb(db);
    const label = { report: '보고', alert: '특이점', approval: '결재 요청' };
    const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const lines = [`<b>🌅 방해금지 시간 동안 쌓인 알림 ${q.length}건</b>`, ''];
    for (const it of q) {
      lines.push(`• [${label[it.kind] || '알림'}] <b>${escapeTelegramHtml(plain(it.title))}</b>${it.body ? `\n  ${escapeTelegramHtml(plain(it.body).slice(0, 220))}` : ''}`);
    }
    let text = lines.join('\n');
    if (text.length > 3800) text = `${text.slice(0, 3780)}\n…`;
    await sendTelegramText(tg.botToken, tg.chatId, text).catch(() => {});
    // 아직 대기 중인 결재는 버튼이 있는 카드로 다시 보냄
    const fresh = loadDb();
    const agentName = (id) => fresh.agents.find((a) => a.id === id)?.name || id;
    for (const it of q.filter((x) => x.kind === 'approval' && x.approvalId).slice(0, 6)) {
      const apr = fresh.approvals.find((a) => a.id === it.approvalId && a.status === 'pending');
      if (apr) await sendTelegramApprovalCard(fresh.settings, apr, agentName(apr.agentId), '', { force: true }).catch(() => {});
    }
  } finally {
    telegramFlushRunning = false;
  }
}

async function handleNotifyCommand(cmd, arg = '') {
  const db = loadDb();
  db.settings.telegram = db.settings.telegram || {};
  const cur = getTelegramNotifyPrefs(db.settings);
  const a = String(arg || '').trim().toLowerCase();
  let msg = '';
  if (cmd === 'report') {
    if (['on', '켜기', '켜', 'start'].includes(a)) cur.reports = true;
    else if (['off', '끄기', '꺼', 'stop'].includes(a)) cur.reports = false;
    msg = `팀장 보고 알림: <b>${cur.reports ? '켜짐' : '꺼짐'}</b>${cur.reports ? '' : ' (회의실에는 계속 기록됩니다)'}`;
  } else if (cmd === 'quiet') {
    const m = a.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/);
    if (m) {
      cur.quiet = { ...cur.quiet, enabled: true, start: m[1].padStart(5, '0'), end: m[2].padStart(5, '0') };
    } else if (['off', '끄기', '해제'].includes(a)) {
      cur.quiet = { ...cur.quiet, enabled: false };
    } else if (['on', '켜기'].includes(a)) {
      cur.quiet = { ...cur.quiet, enabled: true };
    }
    msg = cur.quiet.enabled
      ? `방해금지: <b>${cur.quiet.start} ~ ${cur.quiet.end}</b> (한국 시간). 이 시간에 온 알림은 모아두었다가 끝나면 요약해서 보내드려요.${cur.quiet.allowUrgent ? ' 긴급 특이점 알림은 바로 보냅니다.' : ''}`
      : '방해금지: <b>꺼짐</b>. 예) /quiet 23:00-08:00';
  } else {
    msg = [
      `보고: <b>${cur.reports ? '켜짐' : '꺼짐'}</b> · 특이점: <b>${cur.alerts ? '켜짐' : '꺼짐'}</b> · 결재 요청: <b>${cur.approvals ? '켜짐' : '꺼짐'}</b>`,
      `방해금지: <b>${cur.quiet.enabled ? `${cur.quiet.start} ~ ${cur.quiet.end}` : '꺼짐'}</b>${isQuietNow({ telegram: { notify: cur } }) ? ' (지금 방해금지 중)' : ''}`,
      '변경: /report on|off · /quiet 23:00-08:00 · /quiet off'
    ].join('\n');
  }
  db.settings.telegram.notify = sanitizeNotifyPrefs(cur, db.settings.telegram.notify);
  appendLog(db, '텔레그램 봇', `알림 설정 변경/조회: /${cmd} ${arg}`.trim(), 'info');
  saveDb(db);
  await flushCloudBackup(db);
  if (cmd === 'quiet' && !isQuietNow(db.settings)) flushTelegramQueue().catch(() => {});
  return msg;
}

function leadAgentFor(db, mission) {
  return (
    db.agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon')) ||
    db.agents.find((a) => a.tier === 'lead') ||
    db.agents[0]
  );
}

function leadMessage(db, missionId, statusText, text, type = 'plan') {
  const mission = db.missions.find((m) => m.id === missionId);
  const lead = leadAgentFor(db, mission) || {};
  return appendMessage(db, {
    missionId: missionId || '',
    senderId: lead.id || 'agent_gemini_neon',
    senderName: lead.name || '총괄 팀장',
    senderRole: lead.roleTitle || '총괄 팀장',
    senderShortCode: lead.shortCode || 'GN',
    senderAccent: lead.accent || '#0E6245',
    targetAgentId: 'ceo',
    statusText,
    type,
    text
  });
}

/** Team-lead report to Telegram. 보고 켜기/끄기·방해금지 시간은 telegram.js의 알림 권한(gate)에서 처리 */
function leadTelegram(db, title, body, key = '') {
  const cfg = getLeadSettings(db.settings);
  if (!cfg.enabled) return;
  sendTelegramReport(db.settings, title, body, key).catch(() => {});
}

// 현 단계가 끝나면(작업 완료·배포 완료 후) 팀장이 스스로 다음 단계 제안서를 결재에 올리도록 점검 예약
const leadAdvanceTimers = new Map();
function scheduleLeadAdvanceCheck(missionId, delayMs = 6 * 60 * 1000) {
  if (!missionId || process.env.CI) return;
  clearTimeout(leadAdvanceTimers.get(missionId));
  leadAdvanceTimers.set(
    missionId,
    setTimeout(async () => {
      leadAdvanceTimers.delete(missionId);
      try {
        const db = loadDb();
        if (!getLeadSettings(db.settings).enabled) return;
        const f = collectFollowUps(db).find((x) => x.missionId === missionId);
        if (f?.autoPlan) await leadAutoAdvance(missionId);
      } catch (err) {
        console.warn('lead advance check failed:', err.message);
      }
    }, delayMs)
  );
}

/** next_phase 제안 결재 처리: 승인=착수, 수정 지시=메모 반영해 제안서 재작성 */
async function handleNextPhaseDecision(apr, decision, note = '') {
  if (!apr || apr.kind !== 'next_phase') return null;
  if (decision === 'approved' && apr.proposedDirective) {
    return launchNextProjectPhase(apr.missionId, apr.proposedDirective, note);
  }
  if (decision === 'revision_requested') {
    return submitNextPhaseProposal(apr.missionId, {
      leadAssessment: `대표님 수정 지시(이전 제안 "${apr.title}"): ${note || '다시 검토'}`
    });
  }
  return null;
}

async function leadReportAfterRun(missionId, taskIds = [], { codeResult = null } = {}) {
  const db = loadDb();
  const cfg = getLeadSettings(db.settings);
  const mission = db.missions.find((m) => m.id === missionId);
  if (!cfg.enabled || !mission || mission.isRoutineHub || !taskIds.length) return null;
  const report = buildCompletionReport(db, missionId, taskIds, { codeResult });
  if (!report) return null;
  const st = missionLeadState(db, missionId);
  if (st.lastReportKey === report.reportKey) return null;
  st.lastReportKey = report.reportKey;
  st.lastReportAt = new Date().toISOString();
  const lead = leadAgentFor(db, mission);
  leadMessage(db, missionId, report.needsCeo.length ? '완료 보고 · 확인 요청' : '완료 보고', report.text, report.needsCeo.length ? 'approval' : 'plan');
  const titles = db.tasks
    .filter((t) => taskIds.includes(t.id))
    .map((t) => `${t.title}(${t.status})`)
    .slice(0, 4)
    .join(', ');
  rememberFact(db, {
    kind: 'result',
    missionId,
    text: `작업 결과: ${titles}${report.needsCeo.length ? ` — 대표님 확인 필요: ${report.needsCeo[0]}` : ''}`,
    source: 'lead_report'
  });
  appendLog(db, `${lead?.name || '총괄 팀장'} (총괄 팀장)`, `"${mission.title}" 완료 보고를 올렸습니다.`, 'success');
  const osCfgR = getOutsourcingSettings(db.settings);
  if (osCfgR.enabled && osCfgR.consultMode === 'proposals_and_reports') requestConsultForReport(db, mission, report.text);
  saveDb(db);
  await flushCloudBackup(db);
  leadTelegram(db, report.title, report.telegram, report.reportKey);
  return report;
}

function createLeadTasks(db, mission, specs = [], source = 'lead_followup') {
  const agentMap = Object.fromEntries(db.agents.map((a) => [a.id, a]));
  {
    const rb = rebalanceAssignments(db, specs);
    specs = rb.tasks;
    if (rb.changes.length) appendLog(db, '총괄 팀장', `"${mission.title}" 후속 배정 보정: ${rb.changes.join(' / ')}`.slice(0, 600), 'info');
  }
  const repoLinked = Boolean(getMissionRepoCfg(db.settings, mission));
  const now = new Date().toISOString();
  const phase = Number(mission.phase) || 1;
  const existing = new Set(db.tasks.filter((t) => t.missionId === mission.id).map((t) => t.title));
  const created = [];
  for (const spec of specs) {
    if (!spec?.title || existing.has(spec.title)) continue;
    if (findScopeViolations(mission, `${spec.title} ${spec.description || ''}`).length) continue; // 업무 범위 밖
    let assigneeId = spec.assigneeId;
    if (spec.isCodeChange && repoLinked && agentMap.agent_it_dev?.active) assigneeId = 'agent_it_dev';
    const ag = agentMap[assigneeId] || agentMap[mission.leadAgentId] || db.agents[0];
    const task = {
      id: uid('tsk'),
      missionId: mission.id,
      phase,
      title: String(spec.title).slice(0, 120),
      description: `${spec.description || spec.title}\n[총괄 팀장 후속 배정]`,
      assigneeId: ag.id,
      domain: spec.isCodeChange ? 'it_ops' : mission.domain,
      status: ag.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued',
      requiresApproval: MAJOR_DECISION_RE.test(`${spec.title} ${spec.description}`),
      estimatedCostKRW: 0,
      dispatchPrompt: '',
      output: '',
      executionModeUsed: '',
      source,
      createdAt: now,
      updatedAt: now
    };
    task.dispatchPrompt = buildDispatchPrompt(ag, task, mission);
    db.tasks.unshift(task);
    existing.add(task.title);
    created.push({ task, agent: ag });
  }
  if (created.length) mission.status = 'in_progress';
  return created;
}

/** 모든 작업이 끝난 미션을 팀장이 스스로 검토: 종료 보고 / 후속 작업 자동 배정 / 대표님께 구체적 요청 */
async function leadAutoAdvance(missionId) {
  let db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return null;
  const cfg = getLeadSettings(db.settings);
  missionLeadState(db, missionId).lastPlanAt = new Date().toISOString();
  saveDb(db);

  let plan = null;
  try {
    plan = await planLeadFollowUp({
      mission,
      digest: buildMissionDigest(db, missionId),
      agents: db.agents,
      settings: db.settings,
      teamLoad: `${buildPlanningRoster(db)}\n\n${ASSIGNMENT_RULES}`
    });
  } catch (err) {
    const fresh = loadDb();
    appendLog(fresh, '총괄 팀장', `"${mission.title}" 후속 추진 검토 실패: ${err.message}`, 'warning');
    saveDb(fresh);
    return null;
  }
  if (!plan) return null;

  db = loadDb();
  const m = db.missions.find((x) => x.id === missionId);
  if (!m) return null;
  const st = missionLeadState(db, missionId);
  const lines = [`**[팀장 후속 추진] ${m.title}**`, plan.report || ''];
  let started = false;
  let proposed = null;
  // 기본(propose): 현 단계가 끝났으면 팀장이 다음 단계 제안서를 스스로 결재에 올림 (대표님이 요청하지 않아도)
  if ((cfg.advanceMode || 'propose') === 'propose' && plan.goalStatus !== 'blocked') {
    saveDb(db);
    const assessment = [
      plan.report,
      plan.nextTasks.length ? `팀장이 본 후속 작업 후보: ${plan.nextTasks.map((t) => t.title).join(' / ')}` : '',
      plan.ceoRequests.length ? `대표님 요청 사항(지시문에 넣지 말 것): ${plan.ceoRequests.join(' / ')}` : ''
    ]
      .filter(Boolean)
      .join('\n');
    try {
      const res = await submitNextPhaseProposal(missionId, { leadAssessment: assessment });
      if (res?.ok && res.approval) proposed = res.approval;
    } catch (err) {
      appendLog(loadDb(), '총괄 팀장', `"${m.title}" 다음 단계 제안 작성 실패: ${err.message}`, 'warning');
    }
    db = loadDb();
    if (proposed) {
      lines.push('', `현 단계를 마무리하고 다음 단계 제안서 "${proposed.title}"를 결재함에 올렸습니다. 승인하시면 바로 착수하고, 수정 지시를 주시면 반영해 다시 올리겠습니다.`);
    }
  } else if (plan.goalStatus === 'continue' && plan.nextTasks.length) {
    const created = createLeadTasks(db, m, plan.nextTasks);
    if (created.length) {
      st.autoRounds = Number(st.autoRounds || 0) + 1;
      started = true;
      lines.push(
        '',
        `팀장 전결로 후속 작업 ${created.length}건을 배정해 바로 시작합니다 (자율 라운드 ${st.autoRounds}/${cfg.maxAutoRounds}). 끝나면 다시 보고드리겠습니다.`,
        ...created.map(({ task, agent }) => `- ${task.title} (@${agent.name})`)
      );
    }
  } else if (plan.goalStatus === 'done') {
    st.closedAt = new Date().toISOString();
    lines.push('', '원래 지시는 마무리된 것으로 판단해 이 업무의 자동 후속 추진을 멈춥니다. 더 원하시는 게 있으면 말씀해 주세요.');
  }
  if (plan.ceoRequests.length) {
    lines.push('', '**대표님께 요청드립니다**', ...plan.ceoRequests.map((r) => `- ${r}`));
  }
  const text = lines.filter((l, i) => l || i > 1).join('\n');
  const st2 = missionLeadState(db, missionId);
  rememberFact(db, { kind: 'result', missionId, text: `팀장 판단(${plan.goalStatus}): ${plan.report}${proposed ? ` → 제안서 결재 상신: ${proposed.title}` : ''}`, source: 'lead_followup' });
  leadMessage(
    db,
    missionId,
    proposed ? '단계 마무리 · 제안서 상신' : started ? '후속 추진' : plan.ceoRequests.length ? '대표님 조치 요청' : '업무 마무리',
    text,
    proposed || plan.ceoRequests.length ? 'approval' : 'plan'
  );
  st2.lastReportAt = new Date().toISOString();
  appendLog(db, '총괄 팀장', `"${m.title}" 후속 추진 검토: ${plan.goalStatus}${proposed ? ' → 다음 단계 제안 결재 상신' : started ? ' → 후속 작업 배정' : ''}`, 'info');
  saveDb(db);
  await flushCloudBackup(db);
  leadTelegram(db, `${proposed ? '단계 마무리·제안 상신' : started ? '후속 추진' : '검토 결과'}: ${m.title}`, text.replace(/\*\*/g, ''), `plan:${missionId}:${st2.lastPlanAt}`);
  if (started) autoStartLiveMissionTasks(missionId, { proposeNext: false }).catch(() => {});
  return plan;
}

/** 정기 점검: 누락된 보고 · 오래된 결재 · 멈춘 외부 봇 · 실패한 코드 반영을 찾아 먼저 보고하고, 끝난 업무는 다음 단계를 스스로 추진 */
async function runLeadFollowUp({ manual = false } = {}) {
  const db = loadDb();
  ensureLeadDefaults(db);
  const cfg = getLeadSettings(db.settings);
  if (!cfg.enabled && !manual) return { actions: [] };
  const cooling = new Set(getAiProviderHealth().cooldowns.map((c) => c.provider));
  const allAiCooling = ['gemini', 'groq', 'openrouter'].every((p) => cooling.has(p));
  const followUps = collectFollowUps(db);
  db.leadState.lastFollowUpAt = new Date().toISOString();
  saveDb(db);
  const actions = [];

  for (const f of followUps) {
    const missing = f.items.find((i) => i.type === 'report_missing');
    if (missing) {
      const rep = await leadReportAfterRun(f.missionId, missing.taskIds);
      if (rep) actions.push(`누락 보고 제출: ${f.title}`);
      else {
        const d = loadDb();
        missionLeadState(d, f.missionId).lastReportAt = new Date().toISOString();
        saveDb(d);
      }
    }

    const reminders = f.items.filter((i) => i.type !== 'report_missing');
    if (reminders.length) {
      const fresh = loadDb();
      const st = missionLeadState(fresh, f.missionId);
      const nowIso = new Date().toISOString();
      for (const r of reminders) st.reminded[r.key] = nowIso;
      const text = [`**[팀장 정기 점검] ${f.title}**`, ...reminders.map((r) => `- ${r.text}`)].join('\n');
      leadMessage(fresh, f.missionId, '정기 점검', text, 'approval');
      appendLog(fresh, '총괄 팀장', `"${f.title}" 점검 알림 ${reminders.length}건`, 'info');
      saveDb(fresh);
      leadTelegram(fresh, `점검: ${f.title}`, text.replace(/\*\*/g, ''), `followup:${f.missionId}:${reminders.map((r) => r.key).join(',')}`);
      actions.push(`점검 알림 ${reminders.length}건: ${f.title}`);
    }

    if (f.autoPlan && !allAiCooling) {
      const plan = await leadAutoAdvance(f.missionId);
      if (plan) actions.push(`후속 추진 검토(${plan.goalStatus}): ${f.title}`);
    }
  }
  if (actions.length) {
    const d = loadDb();
    flushCloudBackup(d).catch(() => {});
  }
  return { actions };
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
        autoStartLiveMissionTasks(apr.missionId, { proposeNext: false }).catch(() => {});
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

// ================================================================
// 회사 운영 엔진: 루틴(정기) 업무 · 정기 점검 · 자동 복구(워치독) · 일일 마감 보고
// ================================================================
const OPS_SELF_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'https://ai-ceo-hub.onrender.com';
const INTERNAL_AI_PROVIDERS = new Set(['exaone', 'gemini', 'groq', 'openrouter']);
let opsTickRunning = false;
let lastWatchdogAt = 0;
// first team-lead follow-up runs ~10 minutes after boot (not instantly after a Render restart)
let lastLeadFollowUpAt = Date.now() - 20 * 60 * 1000;
const routineRunsInFlight = new Set();

function describeRoutineSchedule(r) {
  const days = r.days || [];
  const label = ['일', '월', '화', '수', '목', '금', '토'];
  return `${days.length ? days.map((d) => label[d]).join('·') : '매일'} ${(r.times || []).join(', ')}`;
}

function ensureRoutines(db) {
  if (Array.isArray(db.routines)) return false;
  db.routines = buildDefaultRoutines(db.missions || []);
  return true;
}

function getRoutineHubMission(db) {
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

function performOpsCheck(db) {
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

function createRoutineTask(routine) {
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
  autoStartLiveMissionTasks(mission.id, { proposeNext: false }).catch(() => {});
  return { task, mission, agent: ag };
}

async function runRoutine(routineId, { slotKeys = [], manual = false } = {}) {
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
async function runWatchdog() {
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

  // AI 한도로 미뤄 둔 제안서 작성·단계 착수 재시도
  const duePhase = db.missions.filter((m) => m.pendingPhaseDirective && Date.parse(m.pendingPhaseRetryAt || 0) <= now);
  const dueProposal = db.missions.filter((m) => m.pendingProposalRetryAt && Date.parse(m.pendingProposalRetryAt) <= now);
  for (const m of duePhase) actions.push(`단계 착수 재시도 "${m.title}"`);
  for (const m of dueProposal) actions.push(`다음 단계 제안 재시도 "${m.title}"`);

  const cooling = new Set(getAiProviderHealth().cooldowns.map((c) => c.provider));
  const allAiCooling = ['gemini', 'groq', 'openrouter'].every((p) => cooling.has(p));
  if (!allAiCooling) {
    for (const t of db.tasks) {
      if (t.status !== 'queued') continue;
      const ag = agentMap[t.assigneeId];
      if (!ag?.active || !INTERNAL_AI_PROVIDERS.has(ag.provider)) continue;
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

  db.settings.opsWatchdog = {
    lastRunAt: nowIso,
    lastActions: actions.slice(0, 10),
    aiCooling: [...cooling]
  };
  if (actions.length) appendLog(db, '자동 복구', actions.join(' / ').slice(0, 600), 'info');
  saveDb(db);
  if (actions.length) flushCloudBackup(db).catch(() => {});
  for (const missionId of relaunch) autoStartLiveMissionTasks(missionId, { proposeNext: false }).catch(() => {});
  if (!allAiCooling) {
    for (const m of duePhase) decomposeIntoPhaseTasks(m.id, m.pendingPhaseDirective).catch((err) => console.warn('phase retry failed:', err.message));
    for (const m of dueProposal) submitNextPhaseProposal(m.id, { leadAssessment: m.pendingProposalNote || '' }).catch((err) => console.warn('proposal retry failed:', err.message));
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

async function opsTick() {
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

function sanitizeRoutineInput(body, existing = {}) {
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

// ================================================================
// 외부 AI 외주 · 자문 연계 (Antigravity · Aside · 기타)
// ================================================================
const QUOTA_ERR_RE = /quota|cooldown|429|rate\s*limit|한도|too large|413|tokens per mi/i;
const oneLineText = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function buildOutsourceContext(db, mission, task) {
  const parts = [];
  if (mission) parts.push(`[프로젝트 원지시]\n${String(mission.directive || mission.title).slice(0, 1200)}`);
  if (task?.output) parts.push(`[무료 팀 초안/시도 결과 — 참고만, 사실 확인 필요]\n${String(task.output).slice(0, 2500)}`);
  if (mission) {
    const done = db.tasks
      .filter((t) => t.missionId === mission.id && t.status === 'completed' && t.id !== task?.id)
      .slice(0, 6)
      .map((t) => `- ${t.title}: ${oneLineText(t.output, 140)}`);
    if (done.length) parts.push(`[최근 완료 작업]\n${done.join('\n')}`);
  }
  return parts.join('\n\n');
}

function notifyOutsourceCreated(db, req) {
  const mission = db.missions.find((m) => m.id === req.missionId);
  const workerLabel = OUTSOURCE_WORKER_LABELS[resolveTarget(db.settings, req)];
  if (mission) {
    leadSay(
      db,
      mission,
      req.kind === 'consult' ? '외부 자문 요청' : '외주 요청',
      req.kind === 'consult'
        ? `결재 전에 상위 AI의 외부 자문을 요청했습니다: ${req.id} (결재는 그대로 진행 가능, 자문이 오면 카드에 붙습니다).`
        : `무료 팀으로는 어려운 일이라 외부 AI에 맡겼습니다: ${req.id} "${req.title}" (배정: ${workerLabel}). 사유: ${req.reason}`
    );
  }
  sendTelegramReport(
    db.settings,
    `${req.kind === 'consult' ? '외부 자문 요청' : '외주 요청'} ${req.id}`,
    `${OUTSOURCE_KIND_LABELS[req.kind]} · ${req.title}\n배정: ${workerLabel}\n사유: ${req.reason}\n다른 쪽에 맡기려면: /out ${req.id} antigravity (또는 aside, gemini)`,
    `out:${req.id}`
  ).catch(() => {});
}

/**
 * 팀장 검토 (Orchestrator): 팀원 결과가 실제 결과물인지 보고 다음 행동을 정함
 * - 로그인이 필요한 계정·콘솔 작업 → 외주 (실제로 무료 팀이 할 수 없음)
 * - 그 밖(저장소 없음·정보 부족·능력 부족) → 피드백과 함께 내부 팀원에게 1회 재배정
 * - 재배정 후에도 안 되면: 저장소·정보 문제는 대표님께 요청하고 보류, 능력 문제는 외주
 */
function leadTriageResult(db, task, agent, mission, output, osFlag = '') {
  const nr = detectNonResult(output, osFlag);
  if (!nr.nonResult) return { handled: false };
  const repoLinked = Boolean(getMissionRepoCfg(db.settings, mission));
  const blocker = classifyBlocker(`${nr.reason} ${osFlag}`, { repoLinked });
  const osOn = getOutsourcingSettings(db.settings).enabled && !task.outsourceDeclined;
  task.triage = task.triage || { retries: 0, tried: [] };
  if (agent?.id && !task.triage.tried.includes(agent.id)) task.triage.tried.push(agent.id);
  task.triage.lastReason = String(nr.reason).slice(0, 200);
  task.triage.blocker = blocker;
  const nowIso = new Date().toISOString();

  if (blocker === 'login' && osOn) {
    outsourceTask(db, task, { kind: 'browser', worker: 'aside', reason: nr.reason });
    return { handled: true };
  }
  if (task.triage.retries < 1) {
    const alt = blocker === 'capability' ? pickAlternateMember(db, task, task.triage.tried) : null;
    const next = alt || agent;
    task.triage.retries += 1;
    task.assigneeId = next.id;
    task.description = `${task.description || ''}\n\n[팀장 피드백] 이전 결과("${String(nr.reason).slice(0, 120)}")는 실제 결과물이 아니라 완료로 인정하지 않았습니다. ${triageGuidance(blocker, { repoLinked })}`.slice(0, 6000);
    task.status = 'queued';
    task.previousOutput = String(output || '').slice(0, 1500);
    task.output = '';
    task.updatedAt = nowIso;
    leadSay(db, mission, '팀장 검토', `"${task.title}" 결과가 실제 결과물이 아니어서 ${next.id === agent.id ? `${next.name}에게 방향을 다시 주고` : `${next.name}에게 넘겨`} 다시 맡겼습니다. (${String(nr.reason).slice(0, 80)})`);
    appendLog(db, '총괄 팀장', `"${task.title}" 재배정 → ${next.name} (${blocker})`, 'info');
    return { handled: true, requeued: true };
  }
  if (blocker === 'repo' || blocker === 'info') {
    task.status = 'blocked';
    task.blockedReason = blocker === 'repo' ? '연결 저장소 없음' : String(nr.reason).slice(0, 160);
    task.output = String(output || '');
    task.updatedAt = nowIso;
    const key = blocker === 'repo' ? 'repoRequestAt' : 'infoRequestAt';
    const last = Date.parse(mission[key] || 0);
    if (!last || Date.now() - last > 12 * 3600 * 1000) {
      mission[key] = nowIso;
      const ask = blocker === 'repo'
        ? `"${mission.title}"에 연결된 GitHub 저장소가 없어 코드·PR 작업("${task.title}")을 진행할 수 없습니다. 프로젝트 화면의 "연동 설정"에서 저장소를 연결해 주시거나, 저장소 없이 문서·파일 내용으로만 진행할지 알려 주세요.`
        : `"${task.title}"을 끝내려면 대표님 확인이 필요합니다: ${String(nr.reason).slice(0, 160)}`;
      leadSay(db, mission, '대표님 확인 필요', ask);
      sendTelegramReport(db.settings, `대표님 확인 필요 · ${mission.title}`, ask, `blocked:${mission.id}:${blocker}`).catch(() => {});
    }
    return { handled: true };
  }
  if (osOn) {
    const kind = repoLinked && isCodeTask(task, agent) ? 'code' : 'task';
    outsourceTask(db, task, { kind, worker: kind === 'code' ? 'antigravity' : 'any', reason: `내부 팀원 2명이 시도했지만 결과물을 만들지 못함: ${nr.reason}` });
    return { handled: true };
  }
  return { handled: false };
}

function outsourceTask(db, task, { kind = 'task', worker = 'any', reason = '', createdBy = 'system' } = {}) {
  const mission = db.missions.find((m) => m.id === task.missionId);
  const repoCfg = mission ? getMissionRepoCfg(db.settings, mission) : null;
  const { request, created } = createOutsourcingRequest(db, {
    kind,
    worker,
    reason,
    createdBy,
    title: task.title,
    missionId: task.missionId,
    taskId: task.id,
    goal: task.description || task.title,
    context: buildOutsourceContext(db, mission, task),
    repo: kind !== 'browser' && kind !== 'consult' ? repoCfg?.repo || '' : '',
    branch: repoCfg?.branch || 'main',
    siteUrl: mission?.siteUrl || ''
  });
  task.status = 'outsourced';
  task.outsourceId = request.id;
  task.updatedAt = new Date().toISOString();
  if (created) notifyOutsourceCreated(db, request);
  return request;
}

/** 결재가 끝났거나 새 제안으로 대체된 결재안의 자문 요청은 외부 작업자가 헛일하지 않게 취소 */
function cancelStaleConsults(db, missionId, { exceptApprovalId = '' } = {}) {
  const nowIso = new Date().toISOString();
  let n = 0;
  for (const r of db.outsourcing || []) {
    if (r.kind !== 'consult' || r.status !== 'open' || r.missionId !== missionId || !r.approvalId) continue;
    if (r.approvalId === exceptApprovalId) continue;
    const apr = (db.approvals || []).find((a) => a.id === r.approvalId);
    if (apr && apr.status === 'pending') continue;
    r.status = 'cancelled';
    r.updatedAt = nowIso;
    (r.history ||= []).push({ at: nowIso, event: 'cancelled', by: '총괄 팀장 (결재 종료·대체)' });
    n += 1;
  }
  if (n) appendLog(db, '외주 창구', `결재가 끝난 안건의 자문 요청 ${n}건을 취소했습니다.`, 'info');
  return n;
}

function requestConsultForApproval(db, apr, createdBy = 'system') {
  const mission = db.missions.find((m) => m.id === apr.missionId);
  cancelStaleConsults(db, apr.missionId, { exceptApprovalId: apr.id });
  const { request, created } = createOutsourcingRequest(db, {
    kind: 'consult',
    worker: 'any',
    createdBy,
    title: `[자문] ${apr.title}`,
    missionId: apr.missionId,
    approvalId: apr.id,
    reason: '무료 AI 팀장이 만든 결재안을 상위 AI가 검토해, 대표님이 결재할 때 참고 의견으로 붙입니다.',
    goal: `아래 결재안을 비판적으로 검토해 주세요. 이전 단계와 같은 일을 반복하는지, 근거 없는 주장이 있는지, 더 나은 다음 행동이 무엇인지 봐 주세요.\n\n### 결재안\n${apr.title}\n\n${String(apr.summary || '').slice(0, 2500)}\n\n${String(apr.proposedAction || '').slice(0, 1500)}${apr.diffSummary ? `\n\n### 코드 변경\n${String(apr.diffSummary).slice(0, 3000)}` : ''}`,
    context: mission ? buildMissionDigest(db, mission.id, 3500) : '',
    siteUrl: mission?.siteUrl || ''
  });
  apr.consultRequestId = request.id;
  if (created) notifyOutsourceCreated(db, request);
  return request;
}

function requestConsultForReport(db, mission, reportText) {
  // 같은 프로젝트의 완료 보고 자문이 아직 대기 중이면 새로 만들지 않음
  const pendingReport = (db.outsourcing || []).find((r) => r.kind === 'consult' && r.missionId === mission.id && !r.approvalId && ['open', 'claimed'].includes(r.status));
  if (pendingReport) return pendingReport;
  const { request, created } = createOutsourcingRequest(db, {
    kind: 'consult',
    worker: 'any',
    title: `[자문] ${mission.title} 완료 보고 검토`,
    missionId: mission.id,
    reason: '무료 AI 팀장의 완료 보고를 상위 AI가 검토합니다.',
    goal: `아래 팀장 완료 보고와 작업 결과가 실제로 목표에 다가갔는지 평가하고, 다음에 할 일 3가지를 우선순위로 제안해 주세요.\n\n${String(reportText || '').slice(0, 3000)}`,
    context: buildMissionDigest(db, mission.id, 3500),
    siteUrl: mission.siteUrl || ''
  });
  if (created) notifyOutsourceCreated(db, request);
  return request;
}

/** 외부 작업자가 연 PR을 결재 카드로: 원래 결재 카드가 있으면 거기에 붙이고, 없으면 새 카드 */
async function approvalFromExternalPr(db, req, mission) {
  const m = String(req.result?.prUrl || '').match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
  if (!m) throw new Error('PR 주소를 해석할 수 없습니다.');
  const repo = m[1];
  const num = Number(m[2]);
  const cfg = getGithubRepoConfig(db.settings, { repo });
  if (!cfg.enabled) throw new Error('IT팀 GitHub 토큰이 없어 PR을 확인할 수 없습니다.');
  if (cfg.allowedRepos.length && !cfg.allowedRepos.includes(repo)) throw new Error(`허용 목록에 없는 저장소입니다: ${repo}`);
  const gh = async (p) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${p}`, {
      headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ai-ceo-hub' },
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  };
  const pr = await gh(`/pulls/${num}`);
  if (pr.state !== 'open') throw new Error(`PR #${num}이 열려 있지 않습니다 (${pr.state}).`);
  const files = await gh(`/pulls/${num}/files?per_page=60`);
  const blocked = files.filter((f) => /^(\.github\/|data\/db\.json$|\.env)/.test(f.filename));
  if (blocked.length) throw new Error(`보호된 파일 수정이 포함돼 자동 결재에 올리지 않았습니다: ${blocked.map((f) => f.filename).join(', ')}`);
  const result = {
    repo,
    branch: pr.base?.ref || 'main',
    branchName: pr.head?.ref || '',
    prNumber: num,
    prUrl: pr.html_url,
    prTitle: String(pr.title || '').replace(/\[OUT-[^\]]+\]\s*/, '') || req.title,
    prSummary: req.result.summary || oneLineText(pr.body, 600) || '외부 AI 작업 PR',
    changedFiles: files.map((f) => f.filename),
    diffSummary: files
      .map((f) => `파일: ${f.filename} (+${f.additions}/-${f.deletions})\n${String(f.patch || '').slice(0, 1500)}`)
      .join('\n\n')
      .slice(0, 12000),
    audit: { passed: true, riskLevel: 'medium', notes: `외부 작업자(${req.result.by})가 만든 PR입니다. 승인 시 CI 통과를 확인한 뒤 머지합니다.` },
    instruction: req.goal,
    teamContext: ''
  };
  const existing = req.approvalId ? db.approvals.find((a) => a.id === req.approvalId && a.status === 'pending') : null;
  if (existing && existing.kind !== 'next_phase') {
    applyPrFieldsToApproval(existing, result, { outsourceId: req.id });
    setCodeStatus(existing, 'ready');
    existing.proposedAction = `승인 시 외주 PR #${num}(${req.result.by})을 main에 머지하고 ${deployLabelFor(repo)}까지 진행합니다. (CI 실패 시 머지 보류)`;
    sendApprovalNotifications(db.settings, existing, `외주 · ${req.result.by}`);
    return existing;
  }
  const apr = createItPrApproval(db, mission || { id: req.missionId }, result, {
    taskIds: req.taskId ? [req.taskId] : [],
    titlePrefix: `[외주 · ${req.result.by}] `,
    summaryLead: `외주 요청 ${req.id}: ${req.title}`
  });
  apr.outsourceId = req.id;
  sendApprovalNotifications(db.settings, apr, `외주 · ${req.result.by}`);
  return apr;
}

async function handleOutsourceSubmitted(id) {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req?.result) return;
  const r = req.result;
  const by = r.by || '외부 AI';
  const mission = db.missions.find((m) => m.id === req.missionId);
  const nowIso = new Date().toISOString();
  try {
    if (req.kind === 'consult') {
      const apr = req.approvalId ? db.approvals.find((a) => a.id === req.approvalId) : null;
      const consult = { requestId: req.id, by, summary: r.summary, document: String(r.document || '').slice(0, 12000), at: r.submittedAt };
      if (apr) apr.consult = consult;
      if (mission) {
        leadSay(db, mission, '외부 자문 도착', `${by}의 외부 자문이 도착했습니다${apr ? ` (결재 "${apr.title}"에 첨부)` : ''}. ${oneLineText(r.summary || r.document, 220)}`);
      }
      rememberFact(db, { kind: 'lesson', missionId: req.missionId, text: `[외부 자문 · ${by}] ${oneLineText(r.summary || r.document, 220)}`, source: 'outsourcing' });
      sendTelegramReport(db.settings, `외부 자문 도착 ${req.id}`, `${apr ? `${apr.title}\n` : ''}${oneLineText(r.summary || r.document, 700)}`, `outres:${req.id}`).catch(() => {});
      req.status = 'accepted';
    } else {
      const task = req.taskId ? db.tasks.find((t) => t.id === req.taskId) : null;
      let prNote = '';
      if (r.prUrl) {
        try {
          const apr = await approvalFromExternalPr(db, req, mission);
          prNote = ` PR을 결재 카드에 붙였습니다 ("${apr.title}").`;
        } catch (err) {
          prNote = ` 단, PR을 결재에 올리지 못했습니다: ${err.message}`;
          appendLog(db, '외주 창구', `${req.id} PR 처리 실패: ${err.message}`, 'warning');
        }
      }
      if (task) {
        task.output = `> 외주 결과 · ${by}${r.prUrl ? ` · PR ${r.prUrl}` : ''}\n\n${r.summary ? `**요약** ${r.summary}\n\n` : ''}${r.document || ''}`.trim();
        task.executionModeUsed = `external:${by}`;
        task.updatedAt = nowIso;
        delete task.autoRetryExhausted;
        if (task.requiresApproval && !r.prUrl) {
          task.status = 'awaiting_approval';
          if (!db.approvals.some((a) => a.taskId === task.id && a.status === 'pending')) {
            const ag = db.agents.find((a) => a.id === task.assigneeId) || db.agents[0];
            const apr = createApprovalForTask(task, ag, mission || { id: task.missionId });
            db.approvals.unshift(apr);
            notifyAllApprovalChannels(db.settings, apr, `외주 · ${by}`);
          }
        } else {
          task.status = 'completed';
        }
      }
      if (mission) {
        leadSay(db, mission, '외주 결과 도착', `${req.id} "${req.title}" 결과가 ${by}에게서 도착했습니다.${prNote} ${oneLineText(r.summary || r.document, 180)}`);
        updateMissionStatus(db, mission.id);
      }
      rememberFact(db, { kind: 'result', missionId: req.missionId, text: `[외주 결과 · ${by}] ${req.title}: ${oneLineText(r.summary || r.document, 180)}`, source: 'outsourcing' });
      sendTelegramReport(db.settings, `외주 결과 도착 ${req.id}`, `${req.title}\n${oneLineText(r.summary || r.document, 600)}${prNote}`, `outres:${req.id}`).catch(() => {});
      req.status = 'accepted';
      if (task && !r.prUrl && mission) maybeScheduleCodeBundle(db, mission, task);
    }
  } catch (err) {
    appendLog(db, '외주 창구', `${req.id} 결과 처리 오류: ${err.message}`, 'warning');
  }
  req.updatedAt = nowIso;
  req.history.push({ at: nowIso, event: req.status, by: 'system' });
  saveDb(db);
  await flushCloudBackup(db);
}
setOutsourcingHandlers({ onSubmitted: handleOutsourceSubmitted });

/** 외주 작업자가 "대표님 손이 필요"하다고 알릴 때: 텔레그램 버튼으로 바로 처리·재개·넘기기 */
async function handleOutsourceNeedsCeo(id) {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req?.ceoAction) return;
  const mission = db.missions.find((m) => m.id === req.missionId);
  const a = req.ceoAction;
  if (mission) leadSay(db, mission, '대표님 개입 필요', `외주 ${req.id} "${req.title}" — ${a.by || '외부 AI'}가 대표님 손이 필요하다고 알렸습니다: ${a.action}${a.detail ? ` (${oneLineText(a.detail, 200)})` : ''}. 처리하신 뒤 "재개"를 눌러 주세요.`);
  saveDb(db);
  const tg = db.settings.telegram || {};
  if (tg.botToken && tg.chatId) {
    const html = [
      `<b>🙋 대표님 개입 필요 · ${escapeTelegramHtml(req.id)}</b>`,
      escapeTelegramHtml(req.title),
      '',
      `<b>필요한 일:</b> ${escapeTelegramHtml(a.action)}`,
      a.detail ? escapeTelegramHtml(oneLineText(a.detail, 600)) : '',
      `<i>알린 작업자: ${escapeTelegramHtml(a.by || '외부 AI')}</i>`
    ]
      .filter(Boolean)
      .join('\n');
    sendTelegramText(tg.botToken, tg.chatId, html, {
      inline_keyboard: [
        [{ text: '✅ 처리했어요 · 재개', callback_data: `out:resume:${req.id}` }],
        [
          { text: 'Antigravity로 재개', callback_data: `out:ag:${req.id}` },
          { text: 'Aside로 재개', callback_data: `out:as:${req.id}` }
        ],
        ...(['task', 'consult', 'research'].includes(req.kind) ? [[{ text: 'Gemini 앱으로 재개', callback_data: `out:gm:${req.id}` }]] : []),
        [{ text: '❌ 이 외주 취소', callback_data: `out:cancel:${req.id}` }]
      ]
    }).catch(() => {});
  }
}
setOutsourcingHandlers({ onNeedsCeo: handleOutsourceNeedsCeo });

function updateOutsourceRouting(db, { routing, awayHours, officeHours, leaseMinutes, roles, geminiWaitMinutes, priorities, waitMinutes } = {}) {
  const os = { ...getOutsourcingSettings(db.settings) };
  if (['auto', 'aside', 'antigravity', 'gemini'].includes(routing)) os.routing = routing;
  if (roles && typeof roles === 'object') os.roles = { ...os.roles, ...roles };
  if (priorities && typeof priorities === 'object') os.priorities = { ...os.priorities, ...priorities };
  if (waitMinutes !== undefined && Number.isFinite(Number(waitMinutes))) os.waitMinutes = Number(waitMinutes);
  if (geminiWaitMinutes !== undefined && Number.isFinite(Number(geminiWaitMinutes))) os.geminiWaitMinutes = Number(geminiWaitMinutes);
  if (awayHours !== undefined) {
    const h = Number(awayHours);
    os.awayUntil = h > 0 ? new Date(Date.now() + Math.min(24, h) * 3600 * 1000).toISOString() : '';
  }
  if (officeHours && typeof officeHours === 'object') {
    const hh = /^([01]\d|2[0-3]):([0-5]\d)$/;
    const days = Array.isArray(officeHours.days) ? officeHours.days.map(Number).filter((d) => d >= 0 && d <= 6) : os.officeHours.days;
    os.officeHours = {
      days: days.length ? days : os.officeHours.days,
      start: hh.test(officeHours.start || '') ? officeHours.start : os.officeHours.start,
      end: hh.test(officeHours.end || '') ? officeHours.end : os.officeHours.end
    };
  }
  if (Number.isFinite(Number(leaseMinutes))) os.leaseMinutes = Math.min(240, Math.max(15, Math.round(Number(leaseMinutes))));
  db.settings.outsourcing = { ...(db.settings.outsourcing || {}), ...os };
  db.settings.outsourcing = { ...db.settings.outsourcing, ...getOutsourcingSettings(db.settings) }; // 못 하는 일 배정 등 잘못된 값 정리
  shortenForeignLeases(db);
  const r = describeRouting(db.settings);
  appendLog(db, '외주 창구', `외주 분담: ${describeRolesLine(db.settings)} (${r.why})`, 'info');
  return r;
}

/** 텔레그램: /route auto|aside|antigravity · /away 3 · /office · /out [ID 작업자] */
async function handleOutsourceTelegramCommand(cmd, args = '') {
  const db = loadDb();
  const a = String(args || '').trim();
  if (cmd === 'route') {
    const mode = /anti|agy|안티/i.test(a) ? 'antigravity' : /aside|어사이드|회사/i.test(a) ? 'aside' : /gemini|제미/i.test(a) ? 'gemini' : /auto|자동/i.test(a) ? 'auto' : '';
    if (!mode) {
      const r = describeRouting(db.settings);
      return `<b>외주 분담</b> (${escapeTelegramHtml(r.why)})\n${escapeTelegramHtml(describeRolesLine(db.settings))}\n바꾸기: /route auto (우선순위대로) · /route aside · /route antigravity · /route gemini · /away 3 (3시간 PC 자리비움: Aside 건너뜀) · /office (해제)`;
    }
    updateOutsourceRouting(db, { routing: mode, awayHours: mode === 'auto' ? undefined : 0 });
    saveDb(db);
    await flushCloudBackup(db);
    return `외주 분담을 바꿨습니다\n${escapeTelegramHtml(describeRolesLine(db.settings))}`;
  }
  if (cmd === 'away') {
    const h = Number((a.match(/[\d.]+/) || ['3'])[0]) || 3;
    const r = updateOutsourceRouting(db, { routing: 'auto', awayHours: h });
    saveDb(db);
    await flushCloudBackup(db);
    return `PC 자리비움: ${h}시간 동안 Aside를 건너뛰고 다음 순위로 바로 넘깁니다. 돌아오면 /office`;
  }
  if (cmd === 'office') {
    const r = updateOutsourceRouting(db, { routing: 'auto', awayHours: 0 });
    saveDb(db);
    await flushCloudBackup(db);
    return `자리비움을 껐습니다. 다시 우선순위대로 Aside도 받습니다.`;
  }
  if (cmd === 'out') {
    const m = a.match(/(OUT-\d{6}-[A-Z0-9]{4})\s*(\S+)?/i);
    if (m) {
      const id = m[1].toUpperCase();
      const w = /anti|agy|안티/i.test(m[2] || '') ? 'antigravity' : /aside/i.test(m[2] || '') ? 'aside' : /gemini|제미/i.test(m[2] || '') ? 'gemini' : 'auto';
      const req = findRequest(db, id);
      if (req?.status === 'needs_ceo') resumeRequest(id, '텔레그램에서 재개', w === 'auto' ? '' : w);
      else assignRequest(id, w);
      const fresh = findRequest(loadDb(), id);
      return `${id} → ${OUTSOURCE_WORKER_LABELS[resolveTarget(loadDb().settings, fresh)]}${fresh?.status === 'open' ? ' (대기열)' : ''}`;
    }
    const list = listRequests(db, { status: 'all' }).filter((r) => ['open', 'claimed', 'needs_ceo'].includes(r.status)).slice(0, 8);
    if (!list.length) return '진행 중인 외주가 없습니다.';
    const rr = describeRouting(db.settings);
    return [
      `<b>진행 중 외주</b> (${escapeTelegramHtml(describeRolesLine(db.settings))})`,
      ...list.map((r) => `• <code>${r.id}</code> ${escapeTelegramHtml(oneLineText(r.title, 40))} — ${r.status === 'needs_ceo' ? '🙋 대표님 필요' : r.status === 'claimed' ? `${escapeTelegramHtml(r.claimedBy)} 작업 중` : `대기 → ${OUTSOURCE_WORKER_LABELS[resolveTarget(db.settings, r)]}`}`),
      '',
      '대상 바꾸기: /out OUT-ID antigravity (또는 aside, gemini, auto)'
    ].join('\n');
  }
  return '';
}

async function handleOutsourceTelegramCallback(action, id) {
  try {
    if (action === 'resume') resumeRequest(id, '텔레그램에서 처리 완료');
    else if (action === 'ag') resumeRequest(id, '텔레그램에서 처리 완료', 'antigravity');
    else if (action === 'as') resumeRequest(id, '텔레그램에서 처리 완료', 'aside');
    else if (action === 'gm') resumeRequest(id, '텔레그램에서 처리 완료', 'gemini');
    else if (action === 'cancel') cancelRequest(id, 'CEO');
    else return { ok: false, text: '알 수 없는 동작' };
    const req = findRequest(loadDb(), id);
    return {
      ok: true,
      text:
        action === 'cancel'
          ? `${id} 외주를 취소했습니다.`
          : `${id} 재개 → ${OUTSOURCE_WORKER_LABELS[resolveTarget(loadDb().settings, req)]}가 다음 실행 때 이어서 처리합니다.`
    };
  } catch (err) {
    return { ok: false, text: err.message };
  }
}



/** 워치독: 잡고 사라진 요청 다시 열기, 저장소에 열린 외주 PR 자동 감지, 오래 방치된 요청 알림 */
async function outsourcingWatch() {
  const db = loadDb();
  const released = releaseExpiredLeases(db);
  if (released.length) appendLog(db, '외주 창구', `작업 시간이 지난 요청 다시 열기: ${released.join(', ')}`, 'info');
  const now = Date.now();
  for (const r of listRequests(db, { status: 'open' })) {
    if (!r.reminded && now - Date.parse(r.updatedAt || r.createdAt) > 2 * 3600 * 1000) {
      r.reminded = true;
      const tgt = OUTSOURCE_WORKER_LABELS[resolveTarget(db.settings, r)];
      sendTelegramReport(db.settings, `외주 대기 ${r.id}`, `"${r.title}"이(가) 2시간째 ${tgt}에서 처리되지 않았습니다. 다른 쪽으로 넘기려면: /out ${r.id} antigravity (또는 aside, gemini) · 이동 중이면 /away 3`, `outremind:${r.id}`).catch(() => {});
    }
  }
  saveDb(db);
  const withRepo = listRequests(db, { status: 'active' }).filter((r) => r.repo && r.kind !== 'consult');
  const byRepo = new Map();
  for (const r of withRepo) byRepo.set(r.repo, [...(byRepo.get(r.repo) || []), r]);
  for (const [repo, list] of byRepo) {
    const cfg = getGithubRepoConfig(db.settings, { repo });
    if (!cfg.enabled) continue;
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=30`, {
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ai-ceo-hub' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) continue;
      const prs = await res.json();
      for (const r of list) {
        const pr = prs.find((p) => String(p.title || '').includes(r.id) || String(p.head?.ref || '').includes(r.id));
        if (!pr) continue;
        await submitResult(r.id, {
          worker: r.claimedBy || 'github',
          summary: `PR 자동 감지: ${pr.title}`,
          document: String(pr.body || '').trim() || `외부 작업자가 PR을 열었습니다: ${pr.html_url}`,
          prUrl: pr.html_url
        }).catch((err) => console.warn('outsource PR submit failed:', err.message));
      }
    } catch {
      // ignore network errors
    }
  }
}

function outsourceAuthOk(c, db, body = {}) {
  if (CEO_ADMIN_KEY && safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY)) return true;
  if (db.settings?.mcpToken) return checkInboxToken(c, db, body);
  return !CEO_ADMIN_KEY;
}

function isCeoRequest(c) {
  return !CEO_ADMIN_KEY || safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY);
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
      if (res.ok && res.approval?.kind === 'next_phase') {
        await handleNextPhaseDecision(res.approval, decision, note === 'Telegram 모바일 원터치 결재' ? '' : note);
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
        `명령어: /approvals · /order 지시내용 · /out (외주 현황) · /away 3 (PC 자리비움, Aside 건너뜀) · /office · /route`,
        `자유 대화: 그냥 메시지를 보내면 총괄 팀장이 답하고, 지시면 실제 업무로 등록합니다. (#업무명 으로 채널 지정, #전체 로 해제)`,
        `알림: /notify 상태 · /report on|off · /quiet 23:00-08:00 · /quiet off`
      ].join('\n');
    },
    onChat: async (text) => handleTelegramChat(text),
    onNotifyCommand: async (cmd, arg) => handleNotifyCommand(cmd, arg),
    onOutsourceCommand: async (cmd, arg) => handleOutsourceTelegramCommand(cmd, arg),
    onOutsourceCallback: async (action, id) => handleOutsourceTelegramCallback(action, id),
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
  /^\/api\/auth\/telegram-(request|verify)$/,
  /^\/api\/outsourcing/
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
// Global brute-force guard for the 6-digit Telegram login code: 10 wrong codes in an hour locks Telegram login for an hour.
const telegramLoginGuard = { fails: [], lockedUntil: 0 };
function telegramLoginLocked(now) {
  telegramLoginGuard.fails = telegramLoginGuard.fails.filter((t) => now - t < 60 * 60 * 1000);
  return telegramLoginGuard.lockedUntil > now;
}
app.post('/api/auth/telegram-request', async (c) => {
  if (!CEO_ADMIN_KEY) return c.json({ ok: true, unlocked: true });
  const now = Date.now();
  if (telegramLoginLocked(now)) {
    return c.json({ ok: false, error: '로그인 시도가 너무 많아 1시간 동안 텔레그램 로그인이 잠겼습니다. 관리자 키를 직접 입력해 주세요.' }, 429);
  }
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
  if (telegramLoginLocked(now)) {
    return c.json({ ok: false, error: '로그인 시도가 너무 많아 1시간 동안 텔레그램 로그인이 잠겼습니다.' }, 429);
  }
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
  if (code || token) {
    telegramLoginGuard.fails.push(now);
    if (telegramLoginGuard.fails.length >= 10) {
      telegramLoginGuard.lockedUntil = now + 60 * 60 * 1000;
      telegramLogins.clear();
    }
  }
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
  if (ensureRoutines(db)) saveDb(db);
  return c.json({ ...sanitizeStateForClient(db), aiHealth: getAiProviderHealth(), outsourcingRouting: describeRouting(db.settings) });
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
  // Security: never expose the MCP token publicly. Only an unlocked server or a valid CEO key gets it.
  const canSeeToken = !CEO_ADMIN_KEY || safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY);
  return c.json({
    endpoint: '/api/mcp',
    sdk: '@modelcontextprotocol/sdk (Official Streamable HTTP)',
    ...(canSeeToken ? { token: db.settings.mcpToken } : { tokenHint: 'CEO Office 설정 화면에서 확인하세요.' }),
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
// CEO가 "앞으로/항상/기억해" 같은 상시 지침을 말하면 고정 기억으로 저장해 모든 AI 호출에 계속 적용

app.post('/api/chat/send', async (c) => {
  const body = await c.req.json();
  const text = String(body.text || '').trim();
  if (!text) return c.json({ error: '메시지를 입력해 주세요.' }, 400);
  const res = await processCeoChat(text, String(body.missionId || '').trim());
  return c.json({
    ceoMessage: res.ceoMessage,
    replies: res.replies,
    intake: res.intake,
    state: sanitizeStateForClient(loadDb())
  });
});

async function processCeoChat(text, reqMissionIdRaw = '', { channel = 'web' } = {}) {
  const db = loadDb();
  const reqMissionId = String(reqMissionIdRaw || '').trim();
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
    text: channel === 'telegram' ? `${text}\n(텔레그램)` : text
  });
  if (mission) markCeoActivity(db, mission.id);
  ensureLeadDefaults(db);
  db.leadState.lastCeoMissionId = mission?.id || '';
  db.leadState.lastCeoAt = new Date().toISOString();
  let memoryNote = '';
  if (isStandingOrder(text)) {
    // 업무 채널에서 말한 지침은 그 업무에만, 전체 채널에서 말한 지침은 회사 전체에 고정
    rememberFact(db, { kind: 'directive', missionId: mission?.id || '', pinned: true, text: `대표님 상시 지침: ${text}`, source: channel });
    memoryNote = mission
      ? `이 발언을 "${mission.title}" 업무의 고정 지침으로 저장해, 이 업무의 모든 작업·제안에 항상 적용합니다.`
      : '이 발언을 회사 기억(고정 지침)에 저장해 앞으로 모든 AI 팀원에게 적용합니다.';
  }
  saveDb(db);

  // CEO orders in the meeting room become real work (tasks → auto-run → PR/approval), not just chat replies
  let intake = { note: '' };
  try {
    intake = await intakeChatDirective(text, mission?.id || '');
  } catch (err) {
    console.warn('chat directive intake failed:', err.message);
  }

  let db2 = loadDb();
  const mission2 = intake.missionId ? db2.missions.find((m) => m.id === intake.missionId) || mission : mission;
  if (intake.taskIds?.length && mission) {
    rememberFact(db2, { kind: 'directive', missionId: intake.missionId || mission?.id || '', text: `CEO 지시: ${text}`, source: channel });
    if (intake.missionId) markCeoActivity(db2, intake.missionId);
    saveDb(db2);
  }
  const actionNote = [
    intake.note || '',
    intake.taskIds?.length ? '작업이 끝나면 총괄 팀장이 결과를 자동으로 보고합니다(회의실·텔레그램).' : '',
    memoryNote
  ]
    .filter(Boolean)
    .join(' ');
  const replies = await generateTeamChatReplies({
    userMessage: text,
    mission: mission2,
    tasks: mission2 ? db2.tasks.filter((t) => t.missionId === mission2.id) : missionTasks,
    agents: db2.agents,
    recentMessages: db2.messages || [],
    settings: db2.settings,
    actionNote
  });
  db2 = loadDb();

  const savedReplies = replies.map((r) => appendMessage(db2, r));
  appendLog(
    db2,
    '회의실',
    `CEO 메시지에 ${savedReplies.map((r) => r.senderName).join(', ')} 응답.${intake.note ? ` [업무 반영] ${intake.note}` : ''}`,
    'info'
  );
  saveDb(db2);
  flushCloudBackup(db2).catch(() => {});

  if (intake.startMissionId) {
    autoStartLiveMissionTasks(intake.startMissionId, { proposeNext: false }).catch(() => {});
  }

  return {
    ceoMessage: ceoMsg,
    replies: savedReplies,
    intake: { note: intake.note || '', taskIds: intake.taskIds || [], missionId: intake.missionId || '' },
    memoryNote,
    missionId: mission2?.id || ''
  };
}

/** Telegram 자유 대화가 어느 업무 채널로 갈지: "#업무명 메시지"로 지정, 없으면 최근에 대화한 업무(24시간 이내) */
function resolveTelegramChannel(db, rawText) {
  ensureLeadDefaults(db);
  let text = String(rawText || '').trim();
  let missionId = '';
  const tag = text.match(/^#(\S+)\s*([\s\S]*)$/);
  if (tag) {
    const key = tag[1].toLowerCase();
    text = tag[2].trim();
    if (['전체', 'all', '새업무', 'new'].includes(key)) {
      db.leadState.telegramMissionId = '';
      return { missionId: '', text, explicit: true };
    }
    const m = db.missions.find((x) => !x.isRoutineHub && String(x.title || '').toLowerCase().replace(/\s+/g, '').includes(key));
    if (m) {
      db.leadState.telegramMissionId = m.id;
      return { missionId: m.id, text, explicit: true };
    }
  }
  const pinnedId = db.leadState.telegramMissionId;
  if (pinnedId && db.missions.some((m) => m.id === pinnedId)) missionId = pinnedId;
  else if (
    db.leadState.lastCeoMissionId &&
    db.missions.some((m) => m.id === db.leadState.lastCeoMissionId) &&
    Date.now() - new Date(db.leadState.lastCeoAt || 0).getTime() < 24 * 3600 * 1000
  ) {
    missionId = db.leadState.lastCeoMissionId;
  }
  return { missionId, text, explicit: false };
}

async function handleTelegramChat(rawText) {
  const db = loadDb();
  const ch = resolveTelegramChannel(db, rawText);
  saveDb(db);
  const titleOf = (id) => db.missions.find((m) => m.id === id)?.title || '';
  if (!ch.text) {
    return ch.missionId
      ? `이제부터 <b>${escapeTelegramHtml(titleOf(ch.missionId))}</b> 채널로 대화합니다.`
      : '이제부터 전체 채널로 대화합니다. 새 지시는 새 업무로 등록됩니다.';
  }
  const res = await processCeoChat(ch.text, ch.missionId, { channel: 'telegram' });
  const fresh = loadDb();
  const label = res.missionId ? fresh.missions.find((m) => m.id === res.missionId)?.title || '' : '';
  const lines = [`<i>채널: ${escapeTelegramHtml(label || '전체')}</i>`];
  for (const r of res.replies) lines.push(`<b>${escapeTelegramHtml(r.senderName)}</b>: ${escapeTelegramHtml(String(r.text || '').slice(0, 1500))}`);
  if (res.intake?.note) lines.push('', `✅ ${escapeTelegramHtml(res.intake.note)}`);
  if (res.memoryNote) lines.push(`🧠 ${escapeTelegramHtml(res.memoryNote)}`);
  return lines.join('\n');
}

const MAJOR_DECISION_RE = /결제|송금|계약|광고비|예약\s*확정|최종\s*예약|실제\s*발송|대외\s*발송/;

async function intakeChatDirective(text, missionId) {
  const db = loadDb();
  const mission = missionId ? db.missions.find((m) => m.id === missionId) || null : null;
  const tasks = mission ? db.tasks.filter((t) => t.missionId === mission.id) : [];
  const rejected = mission
    ? db.approvals
        .filter((a) => a.missionId === mission.id && a.status === 'rejected' && a.taskId)
        .sort((a, b) => String(b.decidedAt || '').localeCompare(String(a.decidedAt || '')))
    : [];
  const repoLinked = Boolean(mission && getMissionRepoCfg(db.settings, mission));

  const cls = await classifyChatDirective({
    text,
    mission,
    tasks,
    agents: db.agents,
    settings: db.settings,
    rejectedTitles: rejected.slice(0, 3).map((a) => a.title),
    repoLinked
  });
  if (cls.kind !== 'directive') return { note: '' };

  // No project selected: same as a Telegram /order → new work item, decomposed and auto-run
  if (!mission) {
    const created = await createMissionInDb({ directive: text, domain: 'business' });
    return {
      note: `새 업무 "${created.mission.title}"로 등록해 ${created.tasks.length}개 작업으로 나눠 배정하고 자동 실행을 시작했습니다.`,
      missionId: created.mission.id,
      taskIds: created.tasks.map((t) => t.id)
    };
  }

  const fresh = loadDb();
  const m = fresh.missions.find((x) => x.id === mission.id);
  const agentMap = Object.fromEntries(fresh.agents.map((a) => [a.id, a]));
  const now = new Date().toISOString();
  const phase = Number(m.phase) || 1;
  const parts = [];
  const taskIds = [];

  if (cls.reopenRejected && rejected[0]) {
    const t = fresh.tasks.find((x) => x.id === rejected[0].taskId);
    if (t) {
      const ag = agentMap[t.assigneeId];
      t.status = ag?.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
      t.description = `${t.description}\n[CEO 회의실 지시] ${text}`;
      t.updatedAt = now;
      delete t.codeBundleId;
      if (ag) t.dispatchPrompt = buildDispatchPrompt(ag, t, m);
      taskIds.push(t.id);
      parts.push(`반려됐던 "${t.title}" 재작업 시작(@${ag?.name || '담당'})`);
    }
  }

  const existingTitles = new Set(
    fresh.tasks.filter((t) => t.missionId === m.id && t.status !== 'completed' && t.status !== 'rejected').map((t) => t.title)
  );
  for (const spec of cls.tasks || []) {
    if (!spec?.title || existingTitles.has(spec.title)) continue;
    let assigneeId = spec.assigneeId;
    if (spec.isCodeChange && repoLinked && agentMap.agent_it_dev?.active) assigneeId = 'agent_it_dev';
    const ag = agentMap[assigneeId] || agentMap[m.leadAgentId] || fresh.agents[0];
    const desc = `${spec.description || spec.title}\n[CEO 회의실 원문] ${text}`;
    const task = {
      id: uid('tsk'),
      missionId: m.id,
      phase,
      title: spec.title,
      description: desc,
      assigneeId: ag.id,
      domain: spec.isCodeChange ? 'it_ops' : m.domain,
      status: ag.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued',
      requiresApproval: MAJOR_DECISION_RE.test(`${spec.title} ${spec.description}`),
      estimatedCostKRW: 0,
      dispatchPrompt: '',
      output: '',
      executionModeUsed: '',
      source: 'meeting_room',
      createdAt: now,
      updatedAt: now
    };
    task.dispatchPrompt = buildDispatchPrompt(ag, task, m);
    fresh.tasks.unshift(task);
    existingTitles.add(task.title);
    taskIds.push(task.id);
    parts.push(`새 업무 "${task.title}"(@${ag.name})${spec.isCodeChange && repoLinked ? ' → 완료되면 IT팀이 실코드 PR을 만들어 결재에 올림' : ''}`);
  }

  if (!taskIds.length) return { note: '' };
  m.status = 'in_progress';
  appendLog(fresh, '회의실 지시 반영', `${m.title}: ${parts.join(' / ')}`, 'info');
  saveDb(fresh);
  await flushCloudBackup(fresh);
  return {
    note: `${parts.join(' / ')} — 등록 후 자동 실행을 시작했습니다.`,
    missionId: m.id,
    startMissionId: m.id,
    taskIds
  };
}

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
      '=== CEO 전역 지침 · 회사 기억 (항상 적용) ===',
      buildCompanyContext(db, pendingTasks[0]?.missionId || '', { compact: true }),
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
    globalDirectives: db.settings.globalDirectives || '',
    companyContext: buildCompanyContext(db, pendingTasks[0]?.missionId || '', { compact: true }),
    // 외부 봇도 내부 AI와 같은 스킬(절차·점검표)을 따르도록 업무별 가이드 제공
    skillGuides: pendingTasks.slice(0, 5).map((t) => ({
      taskId: t.id,
      guide: renderSkills(selectSkills({ agent, task: t, purpose: 'task', settings: db.settings }), { compact: true })
    })),
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
  let runAllRequeued = false;
  for (const item of results) {
    if (item.error) {
      appendLog(db, item.agent.name, `"${item.task.title}" 실행 오류: ${item.error}`, 'warning');
      continue;
    }
    item.task.output = item.res.output;
    item.task.executionModeUsed = item.res.executionModeUsed;
    if (item.res.quality) item.task.quality = item.res.quality;
    item.task.updatedAt = now;

    // 팀장 검토: 결과물이 아니면 재배정·외주·대표님 요청 (완료로 처리하지 않음)
    const osFlagRA = extractOutsourceFlag(item.res.output);
    const triageRA = leadTriageResult(db, item.task, item.agent, mission, item.res.output, osFlagRA);
    if (triageRA.handled) {
      if (triageRA.requeued) runAllRequeued = true;
      continue;
    }

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

  if (runAllRequeued) setTimeout(() => autoStartLiveMissionTasks(missionId, { proposeNext: false }).catch(() => {}), 1500);
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
  if (result.quality) task.quality = result.quality;
  task.updatedAt = now;

  // 팀장 검토 (단건 실행도 동일): 결과물이 아니면 재배정·대표님 요청·외주
  const triageOne = mission ? leadTriageResult(db, task, agent, mission, result.output, extractOutsourceFlag(result.output)) : { handled: false };
  const overThreshold = (task.estimatedCostKRW || 0) >= (db.settings.approvalThresholdKRW || 30000);
  if (triageOne.handled) {
    if (triageOne.requeued) setTimeout(() => autoStartLiveMissionTasks(task.missionId, { proposeNext: false }).catch(() => {}), 1500);
  } else if (task.requiresApproval || overThreshold) {
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
  if (res.approval?.kind === 'next_phase') {
    const handled = await handleNextPhaseDecision(res.approval, body.decision, body.ceoNote);
    if (handled?.db) latestDb = handled.db;
    else latestDb = loadDb();
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

// Routine (recurring) work
app.post('/api/routines', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = loadDb();
  ensureRoutines(db);
  const input = sanitizeRoutineInput(body);
  if (!input.title) return c.json({ error: '루틴 이름을 입력해 주세요.' }, 400);
  if (!input.times?.length) return c.json({ error: '실행 시간을 HH:MM 형식으로 입력해 주세요. (예: 09:00, 18:30)' }, 400);
  const routine = {
    id: uid('rtn'),
    kind: input.kind || 'task',
    description: '',
    days: [],
    missionId: '',
    assigneeId: '',
    notify: 'anomaly',
    enabled: true,
    lastRunAt: null,
    lastStatus: '',
    lastResult: '',
    lastTaskId: '',
    runKeys: [],
    runCount: 0,
    system: false,
    createdAt: new Date().toISOString(),
    ...input
  };
  db.routines.push(routine);
  appendLog(db, 'CEO', `루틴 업무 등록: "${routine.title}" (${describeRoutineSchedule(routine)})`, 'info');
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ routine, state: sanitizeStateForClient(db) });
});

app.patch('/api/routines/:id', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = loadDb();
  ensureRoutines(db);
  const routine = db.routines.find((r) => r.id === c.req.param('id'));
  if (!routine) return c.json({ error: '루틴을 찾을 수 없습니다.' }, 404);
  const input = sanitizeRoutineInput(body, routine);
  if (input.times && !input.times.length) return c.json({ error: '실행 시간을 HH:MM 형식으로 입력해 주세요.' }, 400);
  Object.assign(routine, input);
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ routine, state: sanitizeStateForClient(db) });
});

app.delete('/api/routines/:id', async (c) => {
  const db = loadDb();
  ensureRoutines(db);
  const before = db.routines.length;
  db.routines = db.routines.filter((r) => r.id !== c.req.param('id'));
  if (db.routines.length === before) return c.json({ error: '루틴을 찾을 수 없습니다.' }, 404);
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ state: sanitizeStateForClient(db) });
});

app.post('/api/routines/:id/run', async (c) => {
  const res = await runRoutine(c.req.param('id'), { manual: true });
  const db = loadDb();
  if (!res.ok) return c.json({ error: res.error, state: sanitizeStateForClient(db) }, 400);
  return c.json({ ...res, state: { ...sanitizeStateForClient(db), aiHealth: getAiProviderHealth() } });
});

app.get('/api/ops/health', (c) => {
  const db = loadDb();
  return c.json({ ai: getAiProviderHealth(), watchdog: db.settings.opsWatchdog || null });
});

// ---- 외부 AI 외주 · 자문 창구 (Antigravity · Aside · 기타 AI) ----
app.get('/api/outsourcing', (c) => {
  const db = loadDb();
  if (!outsourceAuthOk(c, db)) return c.json({ error: '인증 필요 (x-ceo-key 또는 ?token=MCP토큰)' }, 401);
  const status = String(c.req.query('status') || 'active');
  const worker = String(c.req.query('worker') || '');
  const effort = String(c.req.query('effort') || '');
  const list = listRequests(db, { status, worker, effort });
  return c.json({
    count: list.length,
    routing: describeRouting(db.settings),
    requests: list.map((r) => ({ ...summarizeRequest(r), target: resolveTarget(db.settings, r) })),
    howTo: `요청서 전문: GET ${publicBaseUrl()}/api/outsourcing/{id}/packet · 시작: POST .../{id}/claim · 제출: POST .../{id}/submit`
  });
});

app.get('/api/outsourcing/:id', (c) => {
  const db = loadDb();
  if (!outsourceAuthOk(c, db)) return c.json({ error: '인증 필요' }, 401);
  const req = findRequest(db, c.req.param('id'));
  if (!req) return c.json({ error: '외주 요청을 찾을 수 없습니다.' }, 404);
  return c.json({ request: req, packet: buildPacket(db, req) });
});

app.get('/api/outsourcing/:id/packet', (c) => {
  const db = loadDb();
  if (!outsourceAuthOk(c, db)) return c.text('인증 필요 (x-ceo-key 헤더 또는 ?token=MCP토큰)', 401);
  const req = findRequest(db, c.req.param('id'));
  if (!req) return c.text('외주 요청을 찾을 수 없습니다.', 404);
  return c.body(buildPacket(db, req), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

app.post('/api/outsourcing', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!isCeoRequest(c)) return c.json({ error: 'CEO만 외주를 요청할 수 있습니다.' }, 401);
  const db = loadDb();
  let req;
  if (body.approvalId && (body.kind === 'consult' || !body.kind)) {
    const apr = db.approvals.find((a) => a.id === body.approvalId);
    if (!apr) return c.json({ error: '결재 안건을 찾을 수 없습니다.' }, 404);
    req = requestConsultForApproval(db, apr, 'CEO');
  } else if (body.taskId) {
    const task = db.tasks.find((t) => t.id === body.taskId);
    if (!task) return c.json({ error: '업무를 찾을 수 없습니다.' }, 404);
    const mission = db.missions.find((m) => m.id === task.missionId);
    const kind = ['task', 'code', 'browser', 'research'].includes(body.kind) ? body.kind : mission && getMissionRepoCfg(db.settings, mission) && isCodeTask(task, db.agents.find((a) => a.id === task.assigneeId)) ? 'code' : 'task';
    req = outsourceTask(db, task, {
      kind,
      worker: ['antigravity', 'aside', 'gemini', 'any'].includes(body.worker) ? body.worker : kind === 'code' ? 'antigravity' : kind === 'browser' ? 'aside' : 'any',
      reason: String(body.reason || '대표님이 외부 AI에 직접 맡김').slice(0, 400),
      createdBy: 'CEO'
    });
  } else {
    const title = String(body.title || '').trim();
    const goal = String(body.goal || '').trim();
    if (!title || goal.length < 10) return c.json({ error: '제목과 해야 할 일(10자 이상)을 입력해 주세요.' }, 400);
    const mission = body.missionId ? db.missions.find((m) => m.id === body.missionId) : null;
    const repoCfg = mission ? getMissionRepoCfg(db.settings, mission) : null;
    const kind = ['task', 'code', 'consult', 'browser', 'research'].includes(body.kind) ? body.kind : 'task';
    const made = createOutsourcingRequest(db, {
      kind,
      title,
      goal,
      deliverable: body.deliverable || '',
      missionId: mission?.id || '',
      reason: String(body.reason || '대표님 직접 요청').slice(0, 400),
      worker: ['antigravity', 'aside', 'gemini', 'any'].includes(body.worker) ? body.worker : 'any',
      repo: kind === 'code' || kind === 'task' ? repoCfg?.repo || '' : '',
      branch: repoCfg?.branch || 'main',
      siteUrl: mission?.siteUrl || '',
      context: mission ? buildMissionDigest(db, mission.id, 3000) : '',
      createdBy: 'CEO'
    });
    req = made.request;
    if (['antigravity', 'aside', 'gemini'].includes(body.worker)) req.pinnedWorker = body.worker;
    if (made.created) notifyOutsourceCreated(db, req);
  }
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ request: req, state: sanitizeStateForClient(db) });
});

app.get('/api/outsourcing/setup/antigravity', (c) => {
  if (!isCeoRequest(c)) return c.json({ error: 'CEO만 볼 수 있습니다 (토큰 포함).' }, 401);
  const db = loadDb();
  const base = publicBaseUrl();
  const token = db.settings?.mcpToken || '';
  let skill = '';
  try {
    skill = fs.readFileSync(path.join(__dirname, '.agents', 'skills', 'ceo-outsourcing', 'SKILL.md'), 'utf8');
  } catch {
    skill = '';
  }
  const mcpJson = { mcpServers: { 'ceo-office': { serverUrl: `${base}/api/mcp`, headers: { Authorization: `Bearer ${token}` } } } };
  const prompt = [
    'CEO Office 외주 창구를 이 Antigravity에 연결해줘. 아래 4가지를 순서대로 하고 결과를 알려줘.',
    '',
    '1) MCP 서버 등록: 전역 설정 파일 ~/.gemini/config/mcp_config.json (Windows는 %USERPROFILE%\\.gemini\\config\\mcp_config.json)을 열어 mcpServers에 아래 "ceo-office" 항목을 추가해줘. 파일이 없으면 만들고, 이미 있는 다른 서버 설정은 그대로 둬. 저장 후 MCP 서버 목록을 새로고침해서 ceo-office의 도구(list_outsourcing_requests 등)가 보이는지 확인해줘.',
    '```json',
    JSON.stringify(mcpJson, null, 2),
    '```',
    '',
    '2) 스킬 설치: ~/.gemini/config/skills/ceo-outsourcing/SKILL.md 파일을 아래 내용 그대로 만들어줘.',
    '```markdown',
    skill.trim(),
    '```',
    '',
    '3) 모델 계층 (Carbon > Neon > Hydrogen): Settings > Models > Orchestrator Settings에서 Orchestrator Model을 Gemini 4 Carbon, Executor Model을 Gemini 4 Hydrogen으로 설정해줘. 내가 직접 해야 하는 화면 설정이면 방법만 알려줘.',
    '',
    '4) 자동 실행: 30분마다 아래 지시를 실행하는 Automation(/automation)을 만들어줘. 모델은 고를 수 있으면 Orchestrator(Carbon), 없으면 가장 높은 등급(Carbon 또는 Pro)으로. 처리할 게 없으면 짧게 끝내도록 해줘.',
    '   지시: "ceo-outsourcing 스킬로 CEO Office 외주 처리해줘. 너(Carbon)는 계획·판단·최종 검토만 하고, 여러 파일 구현·원인 추적 같은 중간 난이도 일은 Gemini 4 Neon 하위 에이전트에, 자료 조사·검색·단순 수정·테스트 실행은 Gemini 4 Hydrogen 하위 에이전트에 맡겨. 하위 에이전트를 부를 때 모델 이름을 지시에 적어."',
    '',
    '주의: 위 토큰은 비밀번호와 같으니 다른 곳에 출력하거나 저장소에 커밋하지 마.'
  ].join('\n');
  return c.json({ prompt, mcpJson, base });
});

app.post('/api/outsourcing/route', async (c) => {
  if (!isCeoRequest(c)) return c.json({ error: 'CEO만 바꿀 수 있습니다.' }, 401);
  const body = await c.req.json().catch(() => ({}));
  const db = loadDb();
  const routing = updateOutsourceRouting(db, body);
  saveDb(db);
  await flushCloudBackup(db);
  return c.json({ routing, state: { ...sanitizeStateForClient(db), outsourcingRouting: routing } });
});

app.post('/api/outsourcing/:id/need-ceo', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = loadDb();
  if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
  try {
    const req = await requestCeoAction(c.req.param('id'), { worker: body.worker, action: body.action, detail: body.detail });
    return c.json({ ok: true, request: summarizeRequest(req) });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/outsourcing/:id/resume', async (c) => {
  if (!isCeoRequest(c)) return c.json({ error: 'CEO만 재개할 수 있습니다.' }, 401);
  const body = await c.req.json().catch(() => ({}));
  try {
    resumeRequest(c.req.param('id'), body.note || '', body.worker || '');
    const db = loadDb();
    return c.json({ ok: true, state: { ...sanitizeStateForClient(db), outsourcingRouting: describeRouting(db.settings) } });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/outsourcing/:id/effort', async (c) => {
  if (!isCeoRequest(c)) return c.json({ error: 'CEO만 지정할 수 있습니다.' }, 401);
  const body = await c.req.json().catch(() => ({}));
  try {
    setRequestEffort(c.req.param('id'), body.effort || 'auto');
    const db = loadDb();
    return c.json({ ok: true, state: { ...sanitizeStateForClient(db), outsourcingRouting: describeRouting(db.settings) } });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/outsourcing/:id/assign', async (c) => {
  if (!isCeoRequest(c)) return c.json({ error: 'CEO만 지정할 수 있습니다.' }, 401);
  const body = await c.req.json().catch(() => ({}));
  try {
    assignRequest(c.req.param('id'), body.worker || 'auto');
    const db = loadDb();
    return c.json({ ok: true, state: { ...sanitizeStateForClient(db), outsourcingRouting: describeRouting(db.settings) } });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/outsourcing/:id/claim', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = loadDb();
  if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
  try {
    const req = claimRequest(c.req.param('id'), String(body.worker || c.req.query('worker') || 'any'));
    return c.json({ ok: true, request: summarizeRequest(req), packet: buildPacket(loadDb(), req) });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 409);
  }
});

app.post('/api/outsourcing/:id/submit', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = loadDb();
  if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
  try {
    const req = await submitResult(c.req.param('id'), {
      worker: body.worker || 'manual',
      summary: body.summary || '',
      document: body.document || body.result || '',
      prUrl: body.prUrl || body.pr_url || ''
    });
    return c.json({ ok: true, request: summarizeRequest(req), state: isCeoRequest(c) ? sanitizeStateForClient(loadDb()) : undefined });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
});

app.post('/api/outsourcing/:id/cancel', async (c) => {
  if (!isCeoRequest(c)) return c.json({ error: 'CEO만 취소할 수 있습니다.' }, 401);
  try {
    const req = cancelRequest(c.req.param('id'), 'CEO');
    const db = loadDb();
    const task = req.taskId ? db.tasks.find((t) => t.id === req.taskId) : null;
    if (task && task.status === 'outsourced') {
      task.status = 'queued';
      task.updatedAt = new Date().toISOString();
      task.outsourceDeclined = true;
      delete task.outsourceId;
    }
    saveDb(db);
    return c.json({ ok: true, state: sanitizeStateForClient(db) });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 400);
  }
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
  if (typeof body.globalDirectives === 'string') s.globalDirectives = body.globalDirectives.slice(0, 4000);
  if (body.outsourcing && typeof body.outsourcing === 'object') {
    const os = { ...getOutsourcingSettings(s) };
    for (const k of ['enabled', 'autoOnFailure', 'autoForBrowser']) {
      if (typeof body.outsourcing[k] === 'boolean') os[k] = body.outsourcing[k];
    }
    if (['off', 'proposals', 'proposals_and_reports'].includes(body.outsourcing.consultMode)) os.consultMode = body.outsourcing.consultMode;
    s.outsourcing = { ...(s.outsourcing || {}), ...os };
    updateOutsourceRouting(db, { routing: body.outsourcing.routing, officeHours: body.outsourcing.officeHours, leaseMinutes: body.outsourcing.leaseMinutes, awayHours: body.outsourcing.awayHours, roles: body.outsourcing.roles, geminiWaitMinutes: body.outsourcing.geminiWaitMinutes, priorities: body.outsourcing.priorities, waitMinutes: body.outsourcing.waitMinutes });
  }
  if (body.leadEngine && typeof body.leadEngine === 'object') {
    const le = getLeadSettings(s);
    for (const k of ['enabled', 'telegramReports', 'autoFollowUp']) {
      if (typeof body.leadEngine[k] === 'boolean') le[k] = body.leadEngine[k];
    }
    const clampNum = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def);
    if (['propose', 'auto'].includes(body.leadEngine.advanceMode)) le.advanceMode = body.leadEngine.advanceMode;
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

// 팀장 정기 점검을 지금 바로 실행 (누락 보고·오래된 결재·후속 추진)
app.post('/api/lead/follow-up', async (c) => {
  const res = await runLeadFollowUp({ manual: true });
  return c.json({ ok: true, ...res, state: sanitizeStateForClient(loadDb()) });
});

app.post('/api/providers/test', async (c) => {
  const { provider } = await c.req.json();
  const db = loadDb();
  try {
    if (provider === 'githubRepo') {
      const result = await testGithubRepoConnection(db.settings);
      return c.json({ ...result, model: result.repo });
    }
    if (provider === 'googleData') {
      return c.json(await testGoogleDataConnection(db.settings));
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
      if (ensureLeadDefaults(db)) saveDb(db);
      setTelegramDeferHandler(queueDeferredTelegram);
      syncTelegramPolling(db.settings, getTelegramCallbacks());
      setTimeout(() => {
        recoverCodeApprovalsOnBoot().catch((err) => console.warn('code approval recovery failed:', err.message));
      }, 15000);
      // Company operations loop: routines, scheduled checks, watchdog (every minute)
      setTimeout(() => {
        opsTick();
        setInterval(opsTick, 60 * 1000);
      }, 30000);
      console.log(`AI CEO Hub v2 (Hono + Official MCP SDK + Vercel AI SDK + Gemini 4 Hydrogen + Groq + OpenRouter + LG K-EXAONE 2.5 + Telegram Bot) listening on http://localhost:${PORT}`);
    });
  });
