// hub/agent-inbox.js: server.js에서 분리 (공유 로직)
import { appendLog, appendMessage, flushCloudBackup, loadDb, recordAgentHeartbeat, saveDb, uid } from '../store.js';
import { addLeadNote } from '../lead-engine.js';
import { sendWebPushNotification } from '../push.js';
import { autoStartLiveMissionTasks, updateMissionStatus } from './missions.js';
import { notifyAllApprovalChannels } from './notify.js';
import { processTaskResult } from './task-results.js';

function normalizeStringList(val, maxItems = 8, maxLen = 280) {
  const arr = Array.isArray(val) ? val : typeof val === 'string' && val.trim() ? [val] : [];
  return arr
    .map((x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

// ==================== ASYNC AGENT INBOX HTTPS API (Pickle / Cue / Vooy / Instinct) ====================
export function resolveInboxAgent(db, rawKey) {
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

export function normalizeTokenCandidate(val = '') {
  return String(val || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^(?:Bearer|Token)\s+/i, '')
    .replace(/^(?:Bearer|Token)\s+/i, '')
    .trim();
}

export function checkInboxToken(c, db, body = {}) {
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

export async function handleAgentInboxReply(c) {
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
  const limitations = normalizeStringList(body.limitations ?? body.limitation ?? body.unverifiedItems ?? body.unverified_items ?? body.partialReason ?? body.partial_reason);
  const blockers = normalizeStringList(body.blockers ?? body.blocker);
  const questions = normalizeStringList(body.questions ?? body.question);
  const hasBotReport = Boolean(limitations.length || blockers.length || questions.length);
  const now = new Date().toISOString();

  const requestedTaskId = String(body.taskId || body.task_id || '').trim();
  const requestedMissionId = String(body.missionId || body.mission_id || '').trim();
  let task = null;
  let taskWarning = '';
  let openTasksHint = null;

  if (requestedTaskId) {
    task = db.tasks.find((t) => t.id === requestedTaskId) || null;
    if (!task) {
      saveDb(db);
      return c.json({ error: `요청한 taskId를 찾을 수 없습니다: ${requestedTaskId}` }, 404);
    }
    if (task.assigneeId !== agent.id) {
      saveDb(db);
      return c.json({ error: `해당 업무(${requestedTaskId})는 ${agent.name}에게 배정된 업무가 아닙니다.` }, 403);
    }
    if (requestedMissionId && task.missionId && requestedMissionId !== task.missionId) {
      saveDb(db);
      return c.json({ error: `taskId(${requestedTaskId})와 missionId(${requestedMissionId})가 서로 다른 프로젝트입니다. 올바른 taskId를 지정해 주세요.` }, 400);
    }
  } else if (body.deliverable || body.result || requestApproval) {
    // taskId가 생략된 경우: 절대 다른 프로젝트나 review_pending/awaiting_approval 업무에 무작위로 붙이지 않음.
    // 실제로 처리 대기 중(queued/awaiting_bridge)인 업무가 정확히 1건일 때만 자동 연결.
    const workable = db.tasks.filter(
      (t) =>
        t.assigneeId === agent.id &&
        ['queued', 'awaiting_bridge'].includes(t.status) &&
        (!requestedMissionId || t.missionId === requestedMissionId)
    );
    if (workable.length === 1) {
      task = workable[0];
    } else if (workable.length > 1) {
      taskWarning = `대기 중인 업무가 ${workable.length}건 있어 잘못된 프로젝트에 붙는 것을 막기 위해 자동 연결하지 않았습니다. 정확한 taskId를 지정해 다시 제출해 주세요.`;
      openTasksHint = workable.slice(0, 10).map((t) => ({
        id: t.id,
        missionId: t.missionId,
        missionTitle: db.missions.find((m) => m.id === t.missionId)?.title || '',
        title: t.title
      }));
    }
  }

  const reportSummaryParts = [];
  if (limitations.length) reportSummaryParts.push(`도구 한계·미확인: ${limitations.join(' / ')}`);
  if (blockers.length) reportSummaryParts.push(`차단 요인: ${blockers.join(' / ')}`);
  if (questions.length) reportSummaryParts.push(`팀장 질문: ${questions.join(' / ')}`);
  const roomText =
    reportSummaryParts.length && !message.includes(limitations[0] || blockers[0] || questions[0] || '__none__')
      ? `${message}\n[한계·피드백 요청] ${reportSummaryParts.join(' · ')}`
      : message;

  const postedMsg = appendMessage(db, {
    missionId: requestedMissionId || task?.missionId || db.missions[0]?.id || '',
    senderId: agent.id,
    senderName: agent.name,
    senderRole: `${agent.roleTitle} · 실제 앱 보고`,
    senderShortCode: agent.shortCode,
    senderAccent: agent.accent,
    targetAgentId: hasBotReport ? 'agent_gemini_neon' : 'ceo',
    statusText: requestApproval ? '실제 앱 결재 상신' : hasBotReport ? '한계·부분 결과 보고' : '실제 앱 보고 (LIVE)',
    type: requestApproval ? 'approval' : 'reply',
    text: roomText
  });

  let approvalId = null;
  let revisionInfo = null;
  if (task) {
    task.output = deliverable;
    task.executionModeUsed = 'external_agent_https';
    task.updatedAt = now;
    if (estimatedCostKRW > 0) task.estimatedCostKRW = estimatedCostKRW;
    if (requestApproval) task.requiresApproval = true;
    if (body.approvalTitle) task.pendingApprovalTitle = String(body.approvalTitle).trim();
    if (message) task.pendingApprovalReason = message.slice(0, 320);
    if (hasBotReport) {
      task.botReport = {
        agentId: agent.id,
        agentName: agent.name,
        limitations,
        blockers,
        questions,
        reportedAt: now
      };
      addLeadNote(task, 'bot_report', `[담당 봇(${agent.name}) 한계·질문 보고] ${reportSummaryParts.join(' · ')}`);
    } else if (task.botReport) {
      delete task.botReport;
    }

    // 결재가 필요한 업무도 반드시 팀장 검수·재가공(processTaskResult)을 거쳐 대표님 결재함으로 상신
    const missionX = db.missions.find((m) => m.id === task.missionId);
    const outX = await processTaskResult(
      db,
      task,
      agent,
      missionX,
      { output: deliverable, executionModeUsed: 'external_agent_https' },
      { message: false, hasLimitations: hasBotReport }
    );
    approvalId = outX?.approvalId || db.approvals.find((a) => a.taskId === task.id && a.status === 'pending')?.id || null;
    if (outX?.needsRevision || (task.status === 'awaiting_bridge' && task.review?.verdict === 'revise')) {
      revisionInfo = {
        needsRevision: true,
        revisionReason: outX?.revisionReason || task.review?.botReply || task.review?.feedback || '팀장 검토 결과 보완이 필요합니다.'
      };
    }
    const statusText =
      task.status === 'review_pending'
        ? '팀장 검수·재가공 대기'
        : task.status === 'awaiting_approval'
          ? '팀장 검토 후 CEO 결재 상신'
          : task.status === 'completed'
            ? task.review?.acceptedWithGaps
              ? '검수 통과(한계 반영)'
              : '검수 통과'
            : task.status === 'queued' || task.status === 'awaiting_bridge'
              ? '보완 요청'
              : task.status;
    appendLog(db, `${agent.name} (HTTPS 보고)`, `"${task.title}" 결과 보고 → ${statusText}.`, task.status === 'awaiting_approval' ? 'approval' : 'info');
    if (outX?.requeued) setTimeout(() => autoStartLiveMissionTasks(task.missionId).catch(() => {}), 1500);
    updateMissionStatus(db, task.missionId);
  } else if (requestApproval && !taskWarning) {
    const apr = {
      id: uid('apr'),
      missionId: requestedMissionId || db.missions[0]?.id || '',
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
    appendLog(db, `${agent.name} (HTTPS 보고)`, taskWarning ? `회의실 보고만 등록 (${taskWarning})` : `사내 회의실에 실제 답변을 올렸습니다.`, taskWarning ? 'warning' : 'success');
    sendWebPushNotification({
      title: `[새 보고] ${agent.name}`,
      body: message.slice(0, 100),
      view: 'office',
      tag: `msg-${postedMsg.id}`
    }).catch(() => {});
  }

  saveDb(db);
  await flushCloudBackup(db);
  const leadBotReply = String(task?.leadFeedback?.botReply || task?.review?.botReply || '').trim();
  const nextStep =
    task?.status === 'review_pending'
      ? '팀장이 보고(및 한계 사항)를 검토 중입니다. 중복 제출하지 말고 다음 수신함 조회 시 recentFeedback에서 팀장 답장을 확인하세요.'
      : leadBotReply
        ? `팀장 답장: ${leadBotReply}`
        : '';
  return c.json({
    ok: true,
    agent: agent.name,
    postedMessageId: postedMsg.id,
    taskId: task?.id || null,
    taskStatus: task?.status || null,
    approvalId,
    botReportRecorded: Boolean(task && hasBotReport),
    leadVerdict: task?.review?.verdict || null,
    acceptedWithGaps: Boolean(task?.review?.acceptedWithGaps),
    ...(leadBotReply ? { leadBotReply } : {}),
    ...(nextStep ? { nextStep } : {}),
    ...(revisionInfo || {}),
    ...(taskWarning ? { taskAutoMatchSkipped: true, warning: taskWarning, openTasks: openTasksHint } : {})
  });
}
