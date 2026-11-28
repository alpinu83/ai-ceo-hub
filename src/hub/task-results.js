// hub/task-results.js: server.js에서 분리 (공유 로직)
import { OUTSOURCE_KIND_LABELS, OUTSOURCE_WORKER_LABELS, createOutsourcingRequest, extractOutsourceFlag, getOutsourcingSettings, resolveTarget } from '../outsourcing.js';
import { appendLog, appendMessage } from '../store.js';
import { buildDispatchPrompt, createApprovalForTask, leadReviewDeliverable } from '../orchestrator.js';
import { pickBotOrDevMember, classifyBlocker, detectNonResult, findOutputViolations, getLeadSettings, pickAlternateMember, rebalanceAssignments, triageGuidance, addLeadNote, addReviewLesson } from '../lead-engine.js';
import { saysNothingToDo } from '../grounding.js';
import { sendTelegramReport } from '../telegram.js';
import { getMissionRepoCfg, isCodeTask, maybeScheduleCodeBundle } from './code-pipeline.js';
import { leadSay } from './missions.js';
import { notifyAllApprovalChannels, notifyTaskCompleted } from './notify.js';

// ================================================================
// 외부 AI 외주 · 자문 연계 (Antigravity · Aside · 기타)
// ================================================================
export const QUOTA_ERR_RE = /quota|cooldown|429|rate\s*limit|한도|too large|413|tokens per mi/i;

export const oneLineText = (s, n = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

export function buildOutsourceContext(db, mission, task) {
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

export function notifyOutsourceCreated(db, req) {
  const mission = db.missions.find((m) => m.id === req.missionId);
  const workerLabel = OUTSOURCE_WORKER_LABELS[resolveTarget(db.settings, req)];
  if (mission) {
    leadSay(
      db,
      mission,
      req.kind === 'consult' ? '추가 검토 요청' : '개발팀 작업 배정',
      req.kind === 'consult'
        ? `결재 전 추가 검토를 요청했습니다 (결재는 그대로 진행 가능, 의견이 오면 카드에 붙습니다).`
        : `개발팀(${workerLabel})에 작업을 배정했습니다: "${req.title}". 사유: ${req.reason}`
    );
  }
  sendTelegramReport(
    db.settings,
    `${req.kind === 'consult' ? '추가 검토 요청' : '개발팀 작업 배정'}`,
    `${OUTSOURCE_KIND_LABELS[req.kind]} · ${req.title}\n담당: ${workerLabel}\n사유: ${req.reason}`,
    `out:${req.id}`
  ).catch(() => {});
}

// ======================================================================
// 업무 처리 엔진 v3: 모든 결과(자동 실행·일괄 실행·단건 실행·외부 봇 보고·외주 결과)가 이 한 경로로 처리됨
//   1) 지침 위반·비결과물 검사 (leadTriageResult)
//   2) 팀장 검수: 완료 기준과 비교 → 통과 / 재작업(최대 2회) / 상위 처리(다른 팀원·외주·대표님)
//   3) 결재 판단 (결재 필요 표시 또는 금액 기준) → 결재 대기 / 완료
//   4) 완료된 결과는 프로젝트 "결과물"로 등록, 회의실에 한 줄 보고
// ======================================================================
export const MAX_REVIEW_ROUNDS = 2;

export function leadReviewOn(settings) {
  const mode = getLeadSettings(settings).reviewMode || 'all';
  return mode !== 'off';
}

export function registerDeliverable(db, mission, task, agent) {
  if (!mission) return;
  mission.deliverables = Array.isArray(mission.deliverables) ? mission.deliverables : [];
  const firstLine = String(task.review?.executiveSummary || task.output || '')
    .split('\n')
    .find((l) => l.trim() && !/^[#|>]/.test(l.trim()) && !/^\*\*?\[?(팀장|대표님)/.test(l.trim()))
    ?.replace(/^[-*]\s*/, '')
    .slice(0, 180);
  const entry = {
    id: task.id,
    taskId: task.id,
    title: task.title,
    agentName: agent?.name || '',
    summary: firstLine || '',
    score: task.review?.score ?? task.quality?.score ?? null,
    gaps: task.review?.acceptedWithGaps ? task.review.missing || [] : [],
    createdAt: new Date().toISOString()
  };
  mission.deliverables = [entry, ...mission.deliverables.filter((d) => d.taskId !== task.id)].slice(0, 120);
}

function recordLeadReplyToBot(db, task, agent, mission, { verdict = '', acceptedWithGaps = false, botReply = '', feedback = '', missing = [], postToRoom = false } = {}) {
  const cleanReply = String(botReply || '').trim().slice(0, 800);
  const cleanFeedback = String(feedback || '').trim().slice(0, 800);
  const replyText =
    cleanReply ||
    (acceptedWithGaps
      ? `도구 제약을 솔직히 보고해 주어 반영했습니다. 확인 불가 항목은 '미확인'으로 명시한 채 이번 업무를 통과 처리했으니 추가 재작업은 필요 없습니다.`
      : cleanFeedback);
  const nowIso = new Date().toISOString();
  task.leadFeedback = {
    forAgentId: agent?.id || task.assigneeId || '',
    forAgentName: agent?.name || '',
    verdict: verdict || task.review?.verdict || '',
    acceptedWithGaps: Boolean(acceptedWithGaps),
    botReply: replyText,
    feedback: cleanFeedback,
    missing: Array.isArray(missing) ? missing.slice(0, 6) : [],
    at: nowIso
  };
  if (replyText) {
    addLeadNote(task, 'lead_reply', `[팀장 → ${agent?.name || '담당자'}] ${replyText}`);
  }
  if (postToRoom && replyText && mission) {
    const tag = acceptedWithGaps ? '팀장 피드백 · 한계 반영 통과' : verdict === 'escalate' ? '팀장 피드백 · 담당 이관' : verdict === 'revise' ? '팀장 피드백 · 보완 요청' : '팀장 피드백';
    leadSay(db, mission, tag, `@${agent?.name || '담당자'} "${task.title}": ${replyText}`);
  }
}

/** 상위 처리: 다른(더 맞는) 팀원 → 외주 → 대표님 확인 순 */
export function escalateTask(db, task, agent, mission, reason, { botReply = '' } = {}) {
  task.triage = task.triage || { retries: 0, tried: [] };
  if (agent?.id && !task.triage.tried.includes(agent.id)) task.triage.tried.push(agent.id);
  const nowIso = new Date().toISOString();
  if (!task.triage.escalated) {
    const rb = rebalanceAssignments(db, [{ ...task, assigneeId: agent?.id }]);
    let next = rb.tasks[0].assigneeId !== agent?.id ? db.agents.find((a) => a.id === rb.tasks[0].assigneeId) : null;
    if (!next) next = pickAlternateMember(db, task, task.triage.tried);
    // API 팀원이 없으면 성격에 맞는 접속 중인 봇 팀원(Cue·Muse·부이)에게 먼저. 개발팀은 아래 작업 큐 순서로
    if (!next) {
      const bot = pickBotOrDevMember(db, task, task.triage.tried);
      if (bot && bot.team !== 'dev') next = bot;
    }
    if (next) {
      const handoffReply =
        String(botReply || '').trim() ||
        `보고한 한계(${String(reason).slice(0, 140)})를 반영해 이 업무는 ${next.name}에게 이관했습니다. ${agent?.name || '이전 담당자'}는 이 업무를 추가 재시도하지 않아도 됩니다.`;
      recordLeadReplyToBot(db, task, agent, mission, {
        verdict: 'escalate',
        botReply: handoffReply,
        feedback: reason,
        postToRoom: false
      });
      task.triage.escalated = true;
      task.assigneeId = next.id;
      task.status = next.connectionMode === 'bridge' || ['manus', 'muse', 'pickle', 'instinct', 'vooy'].includes(next.provider) ? 'awaiting_bridge' : 'queued';
      task.description = `${task.description || ''}\n\n[팀장 검수 → 담당 변경] ${String(reason).slice(0, 600)}`.slice(0, 6000);
      addLeadNote(task, 'escalate', `담당 변경(${agent?.name || '이전 담당'} → ${next.name}): ${String(reason).slice(0, 600)}`);
      task.previousOutput = String(task.output || '').slice(0, 1500);
      task.output = '';
      task.updatedAt = nowIso;
      task.dispatchPrompt = buildDispatchPrompt(next, task, mission);
      leadSay(db, mission, '팀장 검수', `@${agent?.name || '담당자'} "${task.title}"은(는) 도구 제약으로 ${next.name}에게 이관했습니다. ${agent?.name || '이전 담당자'}는 추가 재시도 불필요합니다. (${String(reason).slice(0, 100)})`);
      return { handled: true, requeued: task.status === 'queued' };
    }
  }
  const osOn = getOutsourcingSettings(db.settings).enabled && !task.outsourceDeclined;
  if (osOn) {
    const repoLinked = Boolean(getMissionRepoCfg(db.settings, mission));
    const kind = repoLinked && isCodeTask(task, agent) ? 'code' : 'task';
    const handoffReply =
      String(botReply || '').trim() ||
      `보고한 한계(${String(reason).slice(0, 140)})를 반영해 사내 개발팀으로 이관했습니다. ${agent?.name || '담당자'}는 이 업무를 종료 처리해도 됩니다.`;
    recordLeadReplyToBot(db, task, agent, mission, {
      verdict: 'escalate',
      botReply: handoffReply,
      feedback: reason,
      postToRoom: Boolean(task.botReport)
    });
    outsourceTask(db, task, { kind, worker: kind === 'code' ? 'antigravity' : 'any', reason: `팀장 검수 결과 내부 팀으로는 어려움: ${String(reason).slice(0, 300)}` });
    return { handled: true };
  }
  const blockedReply =
    String(botReply || '').trim() ||
    `보고한 차단 사유(${String(reason).slice(0, 140)})를 접수해 업무를 보류(대표님 확인 대기)로 전환했습니다. 추가 재시도하지 마세요.`;
  recordLeadReplyToBot(db, task, agent, mission, {
    verdict: 'blocked',
    botReply: blockedReply,
    feedback: reason,
    postToRoom: Boolean(task.botReport)
  });
  task.status = 'blocked';
  task.blockedReason = String(reason).slice(0, 200);
  task.updatedAt = nowIso;
  return { handled: true };
}

/**
 * 결과 처리 단일 경로. res: { output, executionModeUsed, quality }
 * opts.skipReview: 외주 결과(상위 AI)처럼 검수가 필요 없는 경우 / opts.message=false: 회의실 보고 생략
 */
export async function processTaskResult(db, task, agent, mission, res, { skipReview = false, message = true, source = 'auto', hasLimitations = false } = {}) {
  const nowIso = new Date().toISOString();
  task.output = String(res?.output || '');
  if (res?.executionModeUsed) task.executionModeUsed = res.executionModeUsed;
  if (res?.quality) task.quality = res.quality;
  task.updatedAt = nowIso;
  const reportedLimitations = Boolean(
    hasLimitations ||
      task?.botReport?.limitations?.length ||
      task?.botReport?.blockers?.length ||
      task?.botReport?.questions?.length
  );

  // 1) 지침 위반·비결과물
  const osFlag = extractOutsourceFlag(task.output);
  const triage = mission ? leadTriageResult(db, task, agent, mission, task.output, osFlag, { hasLimitations: reportedLimitations }) : { handled: false };
  if (triage.handled) return triage;

  // 2) 팀장 검수 (완료 기준 + 양질의 보고서 재가공)
  if (!skipReview && mission && leadReviewOn(db.settings)) {
    const rv = await leadReviewDeliverable({ task, output: task.output, mission, agents: db.agents, settings: db.settings }).catch(() => ({ verdict: 'accept', skipped: true }));
    if (rv.verdict === 'pending') {
      // 팀장 업무함에 검수를 올림 → 팀장이 답하면 lead-desk-bridge가 이어서 처리
      task.status = 'review_pending';
      task.review = { verdict: 'pending', jobId: rv.pendingJobId || '', at: new Date().toISOString() };
      task.updatedAt = nowIso;
      return { handled: true, pending: true };
    }
    const rounds = Number(task.reviewRounds || 0);
    task.review = {
      verdict: rv.verdict,
      score: rv.score ?? null,
      missing: rv.missing || [],
      feedback: rv.feedback || '',
      acceptedWithGaps: Boolean(rv.acceptedWithGaps),
      botReply: rv.botReply || '',
      executiveSummary: rv.executiveSummary || '',
      refinedReport: rv.refinedReport || '',
      recommendedAction: rv.recommendedAction || '',
      reviewer: rv.reviewer || '',
      skipped: Boolean(rv.skipped),
      round: rounds + 1,
      at: new Date().toISOString()
    };
    if (rv.refinedReport) task.leadBrief = rv.refinedReport;
    task.acceptance = rv.acceptance || task.acceptance;
    // 검수 AI가 "없는 파일"이라고 잘못 판정해 쌓인 교훈·피드백은 지움 (실제 저장소에 있는 파일)
    if (rv.existingFiles?.length) {
      const wrong = (t) => /(없|존재하지|가상)/.test(String(t || '')) && rv.existingFiles.some((p) => String(t).includes(p));
      if (mission && Array.isArray(mission.reviewLessons)) mission.reviewLessons = mission.reviewLessons.filter((l) => !wrong(l.text));
      if (Array.isArray(task.leadNotes)) task.leadNotes = task.leadNotes.filter((n) => !wrong(n.text));
    }
    if (rv.verdict === 'revise' && rounds < MAX_REVIEW_ROUNDS) {
      task.reviewRounds = rounds + 1;
      const reviseMsg = rv.botReply || rv.feedback;
      recordLeadReplyToBot(db, task, agent, mission, {
        verdict: 'revise',
        botReply: reviseMsg,
        feedback: rv.feedback,
        missing: rv.missing || [],
        postToRoom: false
      });
      task.description = `${task.description || ''}\n\n[팀장 검수 ${rounds + 1}차 — 재작업] 부족한 점: ${(rv.missing || []).join(' / ') || '-'}\n고칠 것: ${rv.feedback}`.slice(0, 6000);
      addLeadNote(task, 'revise', `${rounds + 1}차 검수 반려 — 부족한 점: ${(rv.missing || []).join(' / ') || '-'} → 고칠 것: ${reviseMsg}`);
      for (const miss of (rv.missing || []).slice(0, 2)) addReviewLesson(mission, miss);
      task.previousOutput = task.output.slice(0, 1500);
      task.output = '';
      task.status = agent?.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
      if (agent && mission) task.dispatchPrompt = buildDispatchPrompt(agent, task, mission);
      leadSay(db, mission, '팀장 검수', `@${agent?.name || '담당자'} "${task.title}" ${rounds + 1}차 검수 보완 요청: ${reviseMsg.slice(0, 240)}`);
      return { handled: true, requeued: task.status === 'queued', needsRevision: true, revisionReason: reviseMsg };
    }
    if (rv.verdict === 'escalate') {
      return escalateTask(db, task, agent, mission, rv.feedback || (rv.missing || []).join(', ') || '팀장 검수에서 상위 처리 판단', { botReply: rv.botReply || '' });
    }
    if (rv.verdict === 'revise') {
      // 재작업 한도 초과: "완료"로 처리하지 않음 → 더 맞는 팀원에게 한 번 넘기고, 그래도 안 되면 대표님 확인 대기(보류)
      const reason = `팀장 검수 ${rounds + 1}회 미통과: ${(rv.missing || []).join(' / ') || rv.feedback}`.slice(0, 600);
      const tried = [...new Set([...(task.triage?.tried || []), agent?.id].filter(Boolean))];
      const alt = !task.triage?.escalated ? pickAlternateMember(db, task, tried) : null;
      if (alt) {
        task.reviewRounds = 0;
        return escalateTask(db, task, agent, mission, reason, { botReply: rv.botReply || '' });
      }
      recordLeadReplyToBot(db, task, agent, mission, {
        verdict: 'blocked',
        botReply: rv.botReply || `검수 ${rounds + 1}회 미통과로 업무를 보류(대표님 확인 대기)했습니다. 추가 재시도하지 마세요.`,
        feedback: rv.feedback,
        missing: rv.missing || [],
        postToRoom: false
      });
      task.status = 'blocked';
      task.blockedReason = `검수 미통과(${rounds + 1}회) — 대표님 확인 필요`;
      task.updatedAt = nowIso;
      if (mission) leadSay(db, mission, '팀장 검수', `@${agent?.name || '담당자'} "${task.title}"은(는) 검수를 ${rounds + 1}번 통과하지 못해 완료로 처리하지 않고 보류했습니다. 남은 문제: ${(rv.missing || []).slice(0, 2).join(' / ') || rv.feedback.slice(0, 120)}`);
      appendLog(db, '총괄 팀장', `"${task.title}" 검수 미통과로 보류 (완료 처리 안 함)`, 'warning');
      return { handled: true, blocked: true };
    }
    // accept 통과 시에도 봇이 한계·질문을 보고했거나 팀장이 botReply / acceptedWithGaps를 남겼으면 반드시 양방향 피드백 기록 + 회의실 회신
    if (rv.verdict === 'accept' && (rv.botReply || rv.acceptedWithGaps || reportedLimitations)) {
      recordLeadReplyToBot(db, task, agent, mission, {
        verdict: 'accept',
        acceptedWithGaps: Boolean(rv.acceptedWithGaps),
        botReply: rv.botReply,
        feedback: rv.feedback,
        missing: rv.missing || [],
        postToRoom: true
      });
    }
  }

  // 3) 결재 판단
  if (task.requiresApproval && saysNothingToDo(task.output)) {
    task.requiresApproval = false;
    task.output = `> 팀장 판단: 실행할 변경이 없어 결재 없이 종료합니다.\n\n${task.output}`;
  }
  const overThreshold = (Number(task.estimatedCostKRW) || 0) > 0 && (Number(task.estimatedCostKRW) || 0) >= (db.settings.approvalThresholdKRW || 30000);
  if (task.requiresApproval || overThreshold) {
    task.status = 'awaiting_approval';
    let approvalId = null;
    const existing = db.approvals.find((a) => a.taskId === task.id && a.status === 'pending');
    if (!existing) {
      const apr = createApprovalForTask(task, agent, mission);
      db.approvals.unshift(apr);
      approvalId = apr.id;
      const leadAg = db.agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon'));
      notifyAllApprovalChannels(db.settings, apr, leadAg?.name || '총괄 팀장');
    } else {
      approvalId = existing.id;
    }
    delete task.pendingApprovalTitle;
    delete task.pendingApprovalReason;
    appendLog(db, '총괄 팀장', `"${task.title}" 검수·재가공 완료 → CEO 결재 상신.`, 'approval');
    return { handled: true, approvalId };
  } else {
    task.status = 'completed';
    registerDeliverable(db, mission, task, agent);
    appendLog(db, agent?.name || '팀원', `"${task.title}" 팀장 검수 통과${task.review?.acceptedWithGaps ? '(부족한 점 기록)' : ''} → 완료.`, 'success');
    notifyTaskCompleted(db.settings, task, agent?.name || '');
    if (mission) maybeScheduleCodeBundle(db, mission, task);
  }

  // 4) 회의실 한 줄 보고
  if (message && mission && agent) {
    const firstLine = task.output
      .split('\n')
      .find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('>'))
      ?.replace(/^[-*]\s*/, '')
      .slice(0, 140);
    appendMessage(db, {
      missionId: mission.id,
      senderId: agent.id,
      senderName: agent.name,
      senderRole: agent.roleTitle,
      senderShortCode: agent.shortCode,
      senderAccent: agent.accent,
      targetAgentId: task.status === 'awaiting_approval' ? 'ceo' : mission.leadAgentId || 'agent_gemini_neon',
      statusText: task.status === 'awaiting_approval' ? '결재 상신' : '검수 통과',
      type: task.status === 'awaiting_approval' ? 'approval' : 'work',
      text: `[${task.status === 'awaiting_approval' ? '결재 상신' : `검수 통과${task.review?.score != null && !task.review?.skipped ? ` ${task.review.score}/10` : ''}`}] "${task.title}"${firstLine ? ` — ${firstLine}` : ''}`
    });
  }
  return { handled: false, status: task.status };
}

/**
 * 팀장 검토 (Orchestrator): 팀원 결과가 실제 결과물인지 보고 다음 행동을 정함
 * - 로그인이 필요한 계정·콘솔 작업 → 외주 (실제로 무료 팀이 할 수 없음)
 * - 그 밖(저장소 없음·정보 부족·능력 부족) → 피드백과 함께 내부 팀원에게 1회 재배정
 * - 재배정 후에도 안 되면: 저장소·정보 문제는 대표님께 요청하고 보류, 능력 문제는 외주
 */
export function leadTriageResult(db, task, agent, mission, output, osFlag = '', { hasLimitations = false } = {}) {
  // 1) 지침 위반 검사: 금지 범위(예: 세무)·코드 금지 단계의 코드·PR 계획 → 완료로 인정하지 않고 고쳐 오게 함
  const violations = findOutputViolations(mission, output);
  if (violations.length) {
    task.triage = task.triage || { retries: 0, tried: [] };
    if (agent?.id && !task.triage.tried.includes(agent.id)) task.triage.tried.push(agent.id);
    task.triage.scopeRetries = Number(task.triage.scopeRetries || 0);
    const nowIso0 = new Date().toISOString();
    if (task.triage.scopeRetries < 1) {
      task.triage.scopeRetries += 1;
      const scopeFeedback = triageGuidance('scope', { violations });
      recordLeadReplyToBot(db, task, agent, mission, {
        verdict: 'revise',
        botReply: scopeFeedback,
        feedback: scopeFeedback,
        postToRoom: false
      });
      task.description = `${task.description || ''}\n\n[팀장 피드백] ${scopeFeedback}`.slice(0, 6000);
      addLeadNote(task, 'scope', scopeFeedback);
      addReviewLesson(mission, `업무 지침 위반: ${violations.join(', ')} 관련 내용을 썼음`);
      task.status = agent?.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
      if (agent && mission) task.dispatchPrompt = buildDispatchPrompt(agent, task, mission);
      task.previousOutput = String(output || '').slice(0, 1500);
      task.output = '';
      task.updatedAt = nowIso0;
      leadSay(db, mission, '팀장 검토', `@${agent?.name || '담당자'} "${task.title}" 결과가 업무 지침을 어겨(${violations.join(', ')}) 보완이 필요합니다.`);
      appendLog(db, '총괄 팀장', `"${task.title}" 지침 위반으로 재작업: ${violations.join(', ')}`, 'info');
      return { handled: true, requeued: task.status === 'queued', needsRevision: true, revisionReason: scopeFeedback };
    }
    task.status = 'blocked';
    task.blockedReason = `지침 위반 반복: ${violations.join(', ')}`;
    task.output = String(output || '');
    task.updatedAt = nowIso0;
    appendLog(db, '총괄 팀장', `"${task.title}" 지침 위반이 반복돼 완료 처리하지 않고 보류: ${violations.join(', ')}`, 'warning');
    return { handled: true };
  }
  const br = task.botReport || {};
  const reportText = [...(Array.isArray(br.blockers) ? br.blockers : []), ...(Array.isArray(br.questions) ? br.questions : [])].join('\n');
  const nr = detectNonResult(output, osFlag, { hasLimitations, reportText });
  if (!nr.nonResult) return { handled: false };
  const repoLinked = Boolean(getMissionRepoCfg(db.settings, mission));
  const blocker = nr.conflict ? 'conflict' : classifyBlocker(`${nr.reason} ${osFlag}`, { repoLinked });
  const osOn = getOutsourcingSettings(db.settings).enabled && !task.outsourceDeclined;
  task.triage = task.triage || { retries: 0, tried: [] };
  if (agent?.id && !task.triage.tried.includes(agent.id)) task.triage.tried.push(agent.id);
  task.triage.lastReason = String(nr.reason).slice(0, 200);
  task.triage.blocker = blocker;
  const nowIso = new Date().toISOString();

  // 지시 상충·중단 확인 보고: "가정 세워 끝까지" 자동 반려 금지 → 재지시 없이 팀장·대표님 확인 대기(보류)로 올림
  if (blocker === 'conflict') {
    recordLeadReplyToBot(db, task, agent, mission, {
      verdict: 'blocked',
      botReply: triageGuidance('conflict'),
      feedback: nr.reason,
      postToRoom: false
    });
    task.status = 'blocked';
    task.blockedReason = String(nr.reason).slice(0, 200);
    task.output = String(output || '');
    task.updatedAt = nowIso;
    const latestCeo = task.ceoFeedback ? ` 최신 대표님 지시: "${String(task.ceoFeedback).slice(0, 160)}".` : '';
    const ask = `"${task.title}" 담당 ${agent?.name || '팀원'}이(가) 지시 상충·중단 여부 확인을 요청해 보류했습니다(가정으로 진행시키지 않음): ${String(nr.reason).slice(0, 160)}.${latestCeo} "피드백 주고 다시 맡김"(확정 지시 입력) 또는 "작업 접음" 중 하나로 정해 주세요.`;
    leadSay(db, mission, '대표님 확인 필요', ask);
    sendTelegramReport(db.settings, `대표님 확인 필요 · ${mission.title}`, ask, `conflict:${task.id}`).catch(() => {});
    appendLog(db, '총괄 팀장', `"${task.title}" 지시 상충·중단 확인 요청 → 재지시 없이 대표님 확인 대기`, 'info');
    return { handled: true, blocked: true, conflict: true };
  }

  if (blocker === 'login' && osOn) {
    recordLeadReplyToBot(db, task, agent, mission, {
      verdict: 'escalate',
      botReply: `로그인·비공개 콘솔 권한이 필요한 업무로 확인돼 개발팀(Aside)으로 이관했습니다. ${agent?.name || '담당자'}는 이 업무를 종료 처리해도 됩니다.`,
      feedback: nr.reason,
      postToRoom: true
    });
    outsourceTask(db, task, { kind: 'browser', worker: 'aside', reason: nr.reason });
    return { handled: true };
  }
  if (task.triage.retries < 1) {
    const alt = blocker === 'capability' ? pickAlternateMember(db, task, task.triage.tried) : null;
    const next = alt || agent;
    task.triage.retries += 1;
    task.assigneeId = next.id;
    const triageMsg = `이전 결과("${String(nr.reason).slice(0, 120)}")는 실제 결과물이 아니라 완료로 인정하지 않았습니다. ${triageGuidance(blocker, { repoLinked })}`;
    recordLeadReplyToBot(db, task, agent, mission, {
      verdict: next.id === agent.id ? 'revise' : 'escalate',
      botReply: next.id === agent.id ? triageMsg : `도구/역량 한계로 ${next.name}에게 이관했습니다. 추가 재시도하지 않아도 됩니다.`,
      feedback: triageMsg,
      postToRoom: false
    });
    task.description = `${task.description || ''}\n\n[팀장 피드백] ${triageMsg}`.slice(0, 6000);
    addLeadNote(task, 'triage', triageMsg);
    addReviewLesson(mission, '결과물 없이 "정보를 달라·할 수 없다"만 제출');
    task.status = next?.connectionMode === 'bridge' ? 'awaiting_bridge' : 'queued';
    if (next && mission) task.dispatchPrompt = buildDispatchPrompt(next, task, mission);
    task.previousOutput = String(output || '').slice(0, 1500);
    task.output = '';
    task.updatedAt = nowIso;
    leadSay(db, mission, '팀장 검토', `@${agent?.name || '담당자'} "${task.title}" 결과가 실제 결과물이 아니어서 ${next.id === agent.id ? `${next.name}에게 방향을 다시 주고` : `${next.name}에게 넘겨`} 다시 맡겼습니다. (${String(nr.reason).slice(0, 80)})`);
    appendLog(db, '총괄 팀장', `"${task.title}" 재배정 → ${next.name} (${blocker})`, 'info');
    return { handled: true, requeued: task.status === 'queued', needsRevision: next.id === agent.id, revisionReason: triageMsg };
  }
  if (blocker === 'repo' || blocker === 'info') {
    recordLeadReplyToBot(db, task, agent, mission, {
      verdict: 'blocked',
      botReply: `차단 사유(${blocker === 'repo' ? '연결 저장소 없음' : String(nr.reason).slice(0, 120)})를 접수해 대표님 확인 대기로 전환했습니다. 추가 재시도하지 마세요.`,
      feedback: nr.reason,
      postToRoom: false
    });
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
    recordLeadReplyToBot(db, task, agent, mission, {
      verdict: 'escalate',
      botReply: `내부 팀 처리 한계로 사내 개발팀에 이관했습니다. ${agent?.name || '담당자'}는 이 업무를 종료 처리해도 됩니다.`,
      feedback: nr.reason,
      postToRoom: Boolean(task.botReport)
    });
    outsourceTask(db, task, { kind, worker: kind === 'code' ? 'antigravity' : 'any', reason: `내부 팀원 2명이 시도했지만 결과물을 만들지 못함: ${nr.reason}` });
    return { handled: true };
  }
  return { handled: false };
}

export function outsourceTask(db, task, { kind = 'task', worker = 'any', reason = '', createdBy = 'system' } = {}) {
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
