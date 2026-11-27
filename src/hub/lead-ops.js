// hub/lead-ops.js: server.js에서 분리 (공유 로직)
import { ensureShorts, findShortsMission } from './shorts.js';
import { ASSIGNMENT_RULES, buildCompletionReport, buildMissionDigest, buildPlanningRoster, collectFollowUps, ensureLeadDefaults, findScopeViolations, getLeadSettings, getMissionGoal, isForbiddenCodeTask, markCeoActivity, missionLeadState, rebalanceAssignments, rememberFact } from '../lead-engine.js';
import { appendLog, appendMessage, flushCloudBackup, loadDb, saveDb, uid } from '../store.js';
import { buildDispatchPrompt, draftMissionPlan, planLeadFollowUp, planMilestoneWork, missionRepoSnapshot } from '../orchestrator.js';
import { getAiProviderHealth } from '../ai-guard.js';
import { describeGoogleDataStatus } from '../google-data.js';
import { getOutsourcingSettings } from '../outsourcing.js';
import { isLeadPending } from '../lead-desk.js';
import { outsourceTask } from './task-results.js';
import { sendTelegramReport } from '../telegram.js';
import { MAJOR_DECISION_RE } from './ceo-chat.js';
import { autoStartLiveMissionTasks, leadSay } from './missions.js';
import { getMissionRepoCfg } from './code-pipeline.js';
import { notifyAllApprovalChannels } from './notify.js';
import { requestConsultForApproval, requestConsultForReport } from './outsourcing-bridge.js';
import { buildReportDeliverableBundle, enrichApprovalDeliverables } from './deliverables.js';

export function leadAgentFor(db, mission) {
  return (
    db.agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon')) ||
    db.agents.find((a) => a.tier === 'lead') ||
    db.agents[0]
  );
}

export function leadMessage(db, missionId, statusText, text, type = 'plan') {
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
export function leadTelegram(db, title, body, key = '', opts = {}) {
  const cfg = getLeadSettings(db.settings);
  if (!cfg.enabled) return;
  sendTelegramReport(db.settings, title, body, key, opts).catch(() => {});
}

// 현 단계가 끝나면(작업 완료·배포 완료 후) 팀장이 스스로 다음 단계 제안서를 결재에 올리도록 점검 예약
export const leadAdvanceTimers = new Map();

export function scheduleLeadAdvanceCheck(missionId, delayMs = 6 * 60 * 1000) {
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

function attachReviewDeliverablesToApproval(db, mission, reviewTasks = [], checklistItems = [], reportKey = '') {
  if (!reviewTasks.length) return { approval: null, created: false };
  const reviewIds = reviewTasks.map((t) => t.id);

  // 1) 이미 이 업무에 대기 중인 결재가 있으면 그 결재에 성과품·시안·체크리스트를 바로 첨부
  const existingPending = (db.approvals || []).find((a) => a.missionId === mission.id && a.status === 'pending');
  if (existingPending) {
    const mergedIds = [...new Set([...(existingPending.taskId ? [existingPending.taskId] : []), ...(Array.isArray(existingPending.taskIds) ? existingPending.taskIds : []), ...reviewIds])];
    existingPending.taskIds = mergedIds;
    const mergedCk = [...new Set([...(Array.isArray(existingPending.checklist) ? existingPending.checklist : []), ...checklistItems])].slice(0, 12);
    if (mergedCk.length) existingPending.checklist = mergedCk;
    return { approval: existingPending, created: false };
  }

  // 2) 대기 결재가 없으면 별도 확인이 필요한 성과품·시안·체크리스트 확인 결재를 자동 생성
  const alreadyMade = (db.approvals || []).some((a) => a.kind === 'deliverable_review' && a.reportKey === reportKey);
  if (alreadyMade) return { approval: null, created: false };

  const reviewTitles = reviewTasks.slice(0, 3).map((t) => t.title).join(', ');
  const summaryLines = [
    `별도 확인이 필요한 성과품·시안 ${reviewTasks.length}건이 완료되어 첨부합니다: ${reviewTitles}${reviewTasks.length > 3 ? ' 등' : ''}`
  ];
  if (checklistItems.length) {
    summaryLines.push('');
    summaryLines.push('대표님 확인·실행 체크리스트:');
    for (const c of checklistItems.slice(0, 5)) summaryLines.push(`- [ ] ${c}`);
    if (checklistItems.length > 5) summaryLines.push(`- … 외 ${checklistItems.length - 5}개 항목 (첨부 성과품 전문 확인)`);
  }

  const apr = {
    id: uid('apr'),
    missionId: mission.id,
    taskId: reviewIds[0] || '',
    taskIds: reviewIds,
    kind: 'deliverable_review',
    reportKey,
    agentId: mission.leadAgentId || 'agent_gemini_neon',
    title: `[성과품·체크리스트 확인] ${mission.title}`,
    category: '성과품 · 시안 · 체크리스트 확인',
    riskLevel: 'low',
    estimatedCostKRW: 0,
    depositKRW: 0,
    checklist: checklistItems.slice(0, 12),
    summary: summaryLines.join('\n'),
    proposedAction: '승인(확인 완료)하시면 해당 시안·기획안과 체크리스트를 확정으로 기록하고 다음 단계를 진행합니다. 수정이 필요하면 메모를 남겨 주세요.',
    status: 'pending',
    ceoNote: '',
    createdAt: new Date().toISOString(),
    decidedAt: null
  };
  db.approvals.unshift(apr);
  return { approval: apr, created: true };
}

export async function leadReportAfterRun(missionId, taskIds = [], { codeResult = null } = {}) {
  const db = loadDb();
  const cfg = getLeadSettings(db.settings);
  const mission = db.missions.find((m) => m.id === missionId);
  if (!cfg.enabled || !mission || mission.isRoutineHub || !taskIds.length) return null;
  const probe = buildCompletionReport(db, missionId, taskIds, { codeResult });
  if (!probe) return null;
  const st = missionLeadState(db, missionId);
  if (st.lastReportKey === probe.reportKey) return null;
  st.lastReportKey = probe.reportKey;
  st.lastReportAt = new Date().toISOString();

  // 성과품·시안·체크리스트가 있으면 결재 안건에 첨부(없으면 확인 결재 생성) + 텔레그램 문서(.md) 준비
  const attached = attachReviewDeliverablesToApproval(db, mission, probe.reviewTasks || [], probe.checklistItems || [], probe.reportKey);
  const reportBundle =
    (probe.reviewTasks || []).length || (probe.checklistItems || []).length
      ? buildReportDeliverableBundle(db, mission, probe.reviewTasks || [], probe.checklistItems || [])
      : null;
  const hasTelegram = Boolean(db.settings?.telegram?.botToken && db.settings?.telegram?.chatId);

  const report = buildCompletionReport(db, missionId, taskIds, {
    codeResult,
    attachedApprovalTitle: attached.approval?.title || '',
    telegramDocIncluded: Boolean(reportBundle && hasTelegram)
  });

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
  appendLog(db, `${lead?.name || '총괄 팀장'} (총괄 팀장)`, `"${mission.title}" 완료 보고를 올렸습니다.${attached.approval ? ` (성과품 결재 첨부: ${attached.approval.title})` : ''}`, 'success');
  const osCfgR = getOutsourcingSettings(db.settings);
  if (osCfgR.enabled && osCfgR.consultMode === 'proposals_and_reports') requestConsultForReport(db, mission, report.text);
  saveDb(db);
  await flushCloudBackup(db);

  // 새로 생성된 성과품 확인 결재가 있으면 결재 알림(웹 푸시·텔레그램 결재 카드) 전송
  if (attached.created && attached.approval) {
    notifyAllApprovalChannels(db.settings, attached.approval, `${lead?.name || '총괄 팀장'} (총괄 팀장)`);
  }

  // 텔레그램 팀장 보고 + 성과품·체크리스트 .md 파일 자동 첨부 전송
  leadTelegram(db, report.title, report.telegram, report.reportKey, {
    htmlBody: report.telegramHtml,
    document: reportBundle
      ? {
          title: reportBundle.title,
          filename: reportBundle.filename,
          markdown: reportBundle.markdown,
          caption: `📎 <b>성과품 · 체크리스트</b> · ${mission.title} (산출물 ${reportBundle.taskCount}건 · 체크리스트 ${reportBundle.checklistCount}개)`
        }
      : null
  });
  return report;
}

export function createLeadTasks(db, mission, specs = [], source = 'lead_followup') {
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
    if (isForbiddenCodeTask(mission, spec)) continue; // 코드 금지 단계
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
      ...(spec.milestoneId ? { milestoneId: spec.milestoneId } : {}),
      ...(Array.isArray(spec.acceptance) && spec.acceptance.length ? { acceptance: spec.acceptance } : {}),
      createdAt: now,
      updatedAt: now
    };
    task.dispatchPrompt = buildDispatchPrompt(ag, task, mission);
    db.tasks.unshift(task);
    existing.add(task.title);
    // IT팀(무료 API)이 휴직이면 코드 수정은 AGY 수정 → Aside 검수로 바로 외주
    if (spec.isCodeChange && repoLinked && !agentMap.agent_it_dev?.active) {
      const req = outsourceTask(db, task, { kind: 'code', worker: 'antigravity', reason: 'IT팀 휴직: 코드 수정은 AGY가 하고 Aside가 검수·보완' });
      if (req) {
        req.pinnedWorker = 'antigravity';
        req.codeWorkflow = 'agy_then_aside';
      }
    }
    created.push({ task, agent: ag });
  }
  if (created.length) mission.status = 'in_progress';
  return created;
}

// ======================================================================
// 운영 사이클 v3 (작전 계획 → 마일스톤 → 작업 → 검수 → 마일스톤 판정 → 다음)
//   · 단계마다 제안서 결재를 받지 않음. 팀장이 마일스톤을 스스로 굴리고
//   · 대표님 결정이 꼭 필요한 마일스톤(gate)에서만 "관문 결재"를 올림
// ======================================================================
export const MAX_MILESTONE_ROUNDS = 3;

export const opsCycleRunning = new Set();

/** 프로젝트는 모두 운영 사이클(작전 계획 + 관문 결재)로 진행 */
export function isOpsMission(mission) {
  return Boolean(mission) && mission.mode === 'project' && !mission.isRoutineHub;
}

export function currentMilestone(plan) {
  return (plan?.milestones || []).find((m) => m.status !== 'done') || null;
}

export function deliverablesTextFor(mission, limit = 10) {
  return (mission.deliverables || [])
    .slice(0, limit)
    .map((d) => `- ${d.title} (${d.agentName || '팀원'}): ${d.summary || ''}${d.gaps?.length ? ` [부족: ${d.gaps.join(', ')}]` : ''}`)
    .join('\n');
}

export function createStageGate(db, mission, ms, { reason = '', report = '' } = {}) {
  const pending = db.approvals.find((a) => a.missionId === mission.id && a.kind === 'stage_gate' && a.status === 'pending');
  if (pending) return pending;
  const apr = {
    id: uid('apr'),
    missionId: mission.id,
    taskId: '',
    kind: 'stage_gate',
    milestoneId: ms.id,
    agentId: mission.leadAgentId || 'agent_gemini_neon',
    title: `[관문 결재] ${ms.title}`,
    category: '관문 결재',
    riskLevel: 'low',
    estimatedCostKRW: 0,
    depositKRW: 0,
    summary: [
      reason ? `왜 결재가 필요한가: ${reason}` : '',
      ms.decision ? `결정할 것: ${ms.decision}` : '',
      `완료 기준: ${ms.doneWhen}`,
      report ? `지금까지: ${report}` : '',
      deliverablesTextFor(mission, 6) ? `관련 결과물:\n${deliverablesTextFor(mission, 6)}` : ''
    ]
      .filter(Boolean)
      .join('\n\n'),
    proposedAction: '승인하면 이 관문을 통과한 것으로 보고 팀장이 다음 마일스톤을 바로 진행합니다. 수정 지시를 주시면 메모대로 계획을 고쳐 다시 진행합니다.',
    status: 'pending',
    ceoNote: '',
    createdAt: new Date().toISOString(),
    decidedAt: null
  };
  db.approvals.unshift(apr);
  enrichApprovalDeliverables(db, apr);
  ms.status = 'gate';
  notifyAllApprovalChannels(db.settings, apr, '총괄 팀장');
  // 관문 결재에는 상위 AI 자문을 붙여 대표님 판단을 도움 (설정에서 끌 수 있음)
  const osCfgGate = getOutsourcingSettings(db.settings);
  if (osCfgGate.enabled && osCfgGate.consultMode !== 'off') requestConsultForApproval(db, apr);
  leadSay(db, mission, '관문 결재 상신', `"${ms.title}"은 대표님 결정이 필요한 관문이라 결재함에 올렸습니다.${ms.decision ? ` 결정할 것: ${ms.decision}` : ''}`);
  return apr;
}

/** 관문 결재 처리: 승인=마일스톤 통과 후 다음 진행 / 수정=메모 반영해 계획 수정 / 반려=마일스톤 보류 후 재계획 */
export async function handleStageGateDecision(apr, decision, note = '') {
  if (!apr || apr.kind !== 'stage_gate') return null;
  const db = loadDb();
  const m = db.missions.find((x) => x.id === apr.missionId);
  const ms = m?.plan?.milestones?.find((x) => x.id === apr.milestoneId);
  if (!m || !ms) return null;
  const memo = String(note || '').trim();
  if (decision === 'approved') {
    ms.status = 'done';
    ms.doneAt = new Date().toISOString();
    if (memo) ms.decisionNote = memo;
    rememberFact(db, { kind: 'decision', missionId: m.id, pinned: true, text: `[관문 통과] ${ms.title}${memo ? ` — 대표님: ${memo}` : ''}`, source: 'stage_gate' });
  } else if (decision === 'revision_requested') {
    ms.status = 'todo';
    ms.rounds = 0;
    ms.decisionNote = memo;
    if (memo) rememberFact(db, { kind: 'directive', missionId: m.id, pinned: true, text: `[관문 수정 지시] ${ms.title}: ${memo}`, source: 'stage_gate' });
  } else {
    ms.status = 'blocked';
    ms.decisionNote = memo;
    m.plan.needsReplan = true;
  }
  markCeoActivity(db, m.id);
  saveDb(db);
  await flushCloudBackup(db);
  setTimeout(() => opsCycle(m.id).catch((err) => console.warn('ops cycle after gate failed:', err.message)), 1500);
  return { db };
}

/** 성과품·시안·체크리스트 확인 결재 처리 */
export async function handleDeliverableReviewDecision(apr, decision, note = '') {
  if (!apr || apr.kind !== 'deliverable_review') return null;
  const db = loadDb();
  const m = db.missions.find((x) => x.id === apr.missionId);
  if (!m) return null;
  const memo = String(note || '').trim();
  if (decision === 'approved') {
    rememberFact(db, {
      kind: 'decision',
      missionId: m.id,
      pinned: true,
      text: `[성과품·체크리스트 확인 승인] ${apr.title}${memo ? ` — 대표님: ${memo}` : ''}`,
      source: 'deliverable_review'
    });
  } else if (decision === 'revision_requested') {
    rememberFact(db, {
      kind: 'directive',
      missionId: m.id,
      pinned: true,
      text: `[성과품·시안 수정 지시] ${apr.title}${memo ? `: ${memo}` : ''}`,
      source: 'deliverable_review'
    });
  } else {
    rememberFact(db, {
      kind: 'decision',
      missionId: m.id,
      text: `[성과품·시안 반려] ${apr.title}${memo ? ` — ${memo}` : ''}`,
      source: 'deliverable_review'
    });
  }
  markCeoActivity(db, m.id);
  saveDb(db);
  await flushCloudBackup(db);
  if (decision === 'approved' && isOpsMission(m)) {
    setTimeout(() => opsCycle(m.id).catch((err) => console.warn('ops cycle after deliverable review failed:', err.message)), 1500);
  }
  return { db };
}

/** 대표님 지시로 작전 재계획: 끝난 마일스톤은 두고, 아직 시작 안 한 작업은 정리 후 다시 계획 */
export async function replanMission(missionId, note = '') {
  const db = loadDb();
  const m = db.missions.find((x) => x.id === missionId);
  if (!isOpsMission(m)) return { ok: false, error: '프로젝트 업무에서만 재계획할 수 있습니다.' };
  const memo = String(note || '').trim().slice(0, 600);
  const doneIds = new Set((m.plan?.milestones || []).filter((x) => x.status === 'done').map((x) => x.id));
  // 아직 시작 안 한 작업만 정리 (진행 중·완료 작업과 결과물은 그대로 둠)
  const before = db.tasks.length;
  db.tasks = db.tasks.filter((t) => !(t.missionId === missionId && t.milestoneId && !doneIds.has(t.milestoneId) && ['queued', 'awaiting_bridge'].includes(t.status)));
  const dropped = before - db.tasks.length;
  m.plan = { ...(m.plan || {}), needsReplan: true };
  if (memo) rememberFact(db, { kind: 'directive', missionId, pinned: true, text: `[작전 재계획 지시] ${memo}`, source: 'replan' });
  appendLog(db, 'CEO', `"${m.title}" 작전 재계획 지시${memo ? `: ${memo.slice(0, 120)}` : ''} (대기 작업 ${dropped}건 정리)`, 'info');
  saveDb(db);
  await flushCloudBackup(db);
  setTimeout(() => opsCycle(missionId).catch((err) => console.warn('replan failed:', err.message)), 1000);
  return { ok: true, dropped, db };
}

/** 이미 연결된 도구: 팀장이 있는 기능을 또 만들지 않도록 계획 단계에 알려 줌 */
const hostOf = (u = '') => String(u).replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
export function connectedToolsNote(settings, mission) {
  let g = {};
  try {
    g = describeGoogleDataStatus(settings) || {};
  } catch {
    return '';
  }
  if (!g.hasKey) return '';
  const site = hostOf(mission?.siteUrl || '');
  const scMatch = g.scEnabled && g.searchConsoleSite && site && hostOf(g.searchConsoleSite) === site;
  if (!scMatch && !(g.gaEnabled && site)) return '';
  const have = [scMatch ? `Search Console(${g.searchConsoleSite})` : '', g.gaEnabled && g.ga4PropertyId ? `GA4(속성 ${g.ga4PropertyId})` : ''].filter(Boolean).join(' · ');
  return [
    '[이미 연결된 데이터 · 새로 만들지 말 것]',
    `- CEO Office 서버가 서비스 계정 키로 ${have} 데이터를 직접 읽고 있으며, 작업마다 최신 수치가 자동으로 들어갑니다.`,
    '- 그러므로 서비스 계정 키 발급, 데이터 추출 스크립트, CSV 저장, GitHub Actions 같은 수집 파이프라인 구축을 계획하지 마세요. 사이트 저장소에 키를 넣는 일도 금지입니다.',
    '- 수치 확인이 필요하면 "서버 지표로 확인" 수준의 작업으로 처리하고, 마일스톤은 검색 노출·색인·콘텐츠·전환처럼 지표를 실제로 움직이는 일에 쓰세요.'
  ].join('\n');
}
/** 연결 저장소의 실제 구조 (계획이 없는 파일·폴더를 지어내지 않게) */
async function repoStructureNote(m, settings) {
  if (!m?.githubRepo) return '';
  const snap = await missionRepoSnapshot(m, settings).catch(() => null);
  if (!snap) return '';
  const dirs = [...new Set(snap.files.map((f) => (f.includes('/') ? `${f.split('/')[0]}/` : f)))].slice(0, 40);
  const main = snap.files.filter((f) => /\.(html|js|mjs|json)$/.test(f) && !/node_modules|\.min\./.test(f)).slice(0, 50);
  return [
    `[연결 저장소 실제 구조 — ${snap.repo}@${snap.branch}, 파일 ${snap.files.length}개 · 서버가 직접 조회]`,
    `- 최상위: ${dirs.join(', ')}`,
    `- 주요 파일: ${main.join(', ')}`,
    '- 이 목록에 없는 파일·폴더를 수정 대상으로 계획하지 말고, 수정할 파일은 위 목록에서 고를 것.'
  ].join('\n');
}
/** 쇼츠 프로젝트: 자동 수집된 최신 뉴스 후보(링크 포함)를 계획에 제공 — AI 기억으로 지난 뉴스를 지어내지 않게 */
export function shortsCandidatesNote(db, m) {
  const sm = findShortsMission(db);
  if (!sm || sm.id !== m?.id) return '';
  const sh = ensureShorts(db);
  const fresh = sh.candidates.filter((c) => c.status === 'new').slice(0, 10);
  const lines = [
    `[쇼츠 뉴스 후보 — 자동 수집기(매일 07시·18시)가 가져온 최신 후보${sh.lastCollectedAt ? `, 마지막 수집 ${sh.lastCollectedAt.slice(0, 16).replace('T', ' ')}` : ''}]`,
    ...fresh.map((c, i) => `${i + 1}. ${c.title}${c.views ? ` (조회 ${c.views})` : ''} — ${c.url || '링크 없음'}`),
    '- 뉴스 후보는 이 목록만 씁니다. 팀이 뉴스를 따로 조사하거나 AI 기억으로 뉴스를 쓰지 마세요(지난 뉴스가 섞임). 후보 선정·고르기는 대표님이 이 목록에서 합니다.',
    '- 채널: 구국열사 https://www.youtube.com/channel/UCVz53WEz_cvd5fJl3rs1Uww (@구국열사). 다른 주소를 짐작해서 쓰지 마세요.'
  ];
  return fresh.length ? lines.join('\n') : lines.slice(-2).join('\n');
}
const digestWithTools = async (db, m) => [buildMissionDigest(db, m.id), connectedToolsNote(db.settings, m), shortsCandidatesNote(db, m), await repoStructureNote(m, db.settings)].filter(Boolean).join('\n\n');

/** 운영 사이클 1회: 계획 수립(없으면) → 현재 마일스톤 처리 */
export async function opsCycle(missionId, { depth = 0 } = {}) {
  if (opsCycleRunning.has(missionId) || depth > 3) return null;
  opsCycleRunning.add(missionId);
  try {
    let db = loadDb();
    let m = db.missions.find((x) => x.id === missionId);
    if (!isOpsMission(m)) return null;
    const st = missionLeadState(db, missionId);
    st.lastPlanAt = new Date().toISOString();

    // 1) 작전 계획 (없거나 재계획 필요)
    if (!m.plan?.milestones?.length || m.plan.needsReplan) {
      saveDb(db);
      let drafted;
      try {
        drafted = await draftMissionPlan({ mission: m, digest: await digestWithTools(db, m), agents: db.agents, settings: db.settings });
      } catch (err) {
        if (isLeadPending(err)) return { pending: true }; // 팀장 업무함에서 판단 중 (답이 오면 다시 실행)
        const fresh = loadDb();
        appendLog(fresh, '총괄 팀장', `"${m.title}" 작전 계획 수립 보류(AI 엔진): ${err.message}`.slice(0, 300), 'warning');
        saveDb(fresh);
        return null;
      }
      db = loadDb();
      m = db.missions.find((x) => x.id === missionId);
      const keepDone = (m.plan?.milestones || []).filter((x) => x.status === 'done');
      m.plan = { stage: drafted.stage, milestones: [...keepDone, ...drafted.milestones], createdAt: new Date().toISOString(), planner: drafted.planner };
      leadSay(
        db,
        m,
        '작전 계획',
        [`**[작전 계획] ${m.title} — ${drafted.stage}**`, ...drafted.milestones.map((x, i) => `${i + 1}. ${x.title}${x.gate ? ' (관문: 대표님 결정)' : ''} — 완료 기준: ${x.doneWhen}`), '', '관문이 아닌 마일스톤은 팀장 전결로 바로 진행하고, 관문에서만 결재를 올리겠습니다.'].join('\n')
      );
      saveDb(db);
    }

    // 2) 현재 마일스톤
    const ms = currentMilestone(m.plan);
    if (!ms) {
      // 모든 마일스톤 완료 → 목표 미달이면 다음 작전 계획
      const g = getMissionGoal(m);
      const reached = g.target !== null && g.current !== null && g.current >= g.target;
      leadSay(db, m, '작전 완료', reached ? '작전 계획을 모두 마쳤고 목표에 도달했습니다.' : '작전 계획의 마일스톤을 모두 마쳤습니다. 목표까지 남은 차이를 기준으로 다음 작전 계획을 세우겠습니다.');
      if (!reached) m.plan.needsReplan = true;
      saveDb(db);
      return reached ? null : opsCycle(missionId, { depth: depth + 1 });
    }
    if (ms.status === 'gate' || ms.status === 'blocked') return null; // 대표님 결정 대기
    const openTasks = db.tasks.filter((t) => t.missionId === missionId && t.milestoneId === ms.id && ['queued', 'running', 'awaiting_bridge', 'awaiting_approval', 'outsourced', 'review_pending'].includes(t.status));
    if (openTasks.length) return null; // 진행 중

    // 3) 판정 + 다음 작업
    saveDb(db);
    let work;
    try {
      work = await planMilestoneWork({
        mission: m,
        milestone: ms,
        digest: await digestWithTools(db, m),
        agents: db.agents,
        settings: db.settings,
        teamLoad: `${buildPlanningRoster(db)}\n\n${ASSIGNMENT_RULES}`,
        deliverablesText: deliverablesTextFor(m)
      });
    } catch (err) {
      if (isLeadPending(err)) return { pending: true };
      const fresh = loadDb();
      appendLog(fresh, '총괄 팀장', `"${m.title}" 마일스톤 계획 보류(AI 엔진): ${err.message}`.slice(0, 300), 'warning');
      saveDb(fresh);
      return null;
    }
    db = loadDb();
    m = db.missions.find((x) => x.id === missionId);
    const msNow = m.plan.milestones.find((x) => x.id === ms.id);
    if (work.milestoneDone) {
      if (msNow.gate) {
        createStageGate(db, m, msNow, { reason: '마일스톤 결과가 나와 대표님 결정이 필요합니다.', report: work.report });
        saveDb(db);
        await flushCloudBackup(db);
        return null;
      }
      msNow.status = 'done';
      msNow.doneAt = new Date().toISOString();
      leadSay(db, m, '마일스톤 완료', `"${msNow.title}" 완료. ${work.report}`);
      saveDb(db);
      await flushCloudBackup(db);
      return opsCycle(missionId, { depth: depth + 1 });
    }
    if (Number(msNow.rounds || 0) >= MAX_MILESTONE_ROUNDS || !work.tasks.length) {
      createStageGate(db, m, msNow, { reason: `${MAX_MILESTONE_ROUNDS}번 시도했지만 완료 기준에 못 미쳤습니다. 방향을 정해 주세요.`, report: work.report });
      saveDb(db);
      await flushCloudBackup(db);
      return null;
    }
    const created = createLeadTasks(db, m, work.tasks.map((t) => ({ ...t, milestoneId: msNow.id })), 'ops_cycle');
    msNow.status = 'doing';
    msNow.rounds = Number(msNow.rounds || 0) + 1;
    leadSay(db, m, '마일스톤 진행', [`**[${msNow.title}] ${msNow.rounds}차 작업 배정**`, work.report, ...created.map(({ task, agent }) => `- ${task.title} (@${agent.name})`)].filter(Boolean).join('\n'));
    saveDb(db);
    await flushCloudBackup(db);
    if (created.length) autoStartLiveMissionTasks(missionId).catch(() => {});
    return { created: created.length };
  } finally {
    opsCycleRunning.delete(missionId);
  }
}

/** 모든 작업이 끝난 미션을 팀장이 스스로 검토: 종료 보고 / 후속 작업 자동 배정 / 대표님께 구체적 요청 */
export async function leadAutoAdvance(missionId) {
  let db = loadDb();
  const mission = db.missions.find((m) => m.id === missionId);
  if (!mission) return null;
  if (isOpsMission(mission)) return opsCycle(missionId);
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
  if (plan.goalStatus === 'continue' && plan.nextTasks.length) {
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
  if (started) autoStartLiveMissionTasks(missionId).catch(() => {});
  return plan;
}

/** 정기 점검: 누락된 보고 · 오래된 결재 · 멈춘 외부 봇 · 실패한 코드 반영을 찾아 먼저 보고하고, 끝난 업무는 다음 단계를 스스로 추진 */
export async function runLeadFollowUp({ manual = false } = {}) {
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
