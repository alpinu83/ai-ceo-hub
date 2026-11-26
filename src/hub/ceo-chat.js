// hub/ceo-chat.js: server.js에서 분리 (공유 로직)
import { ASSIGNMENT_RULES, buildPlanningRoster, ensureLeadDefaults, escapeTelegramHtml, findScopeViolations, isForbiddenCodeTask, isStandingOrder, markCeoActivity, rebalanceAssignments, rememberFact, addLeadNote } from '../lead-engine.js';
import { appendLog, appendMessage, flushCloudBackup, loadDb, saveDb, uid } from '../store.js';
import { buildDispatchPrompt, classifyChatDirective, generateTeamChatReplies } from '../orchestrator.js';
import { applyApprovalDecisionInDb, autoStartLiveMissionTasks, createMissionInDb } from './missions.js';
import { getMissionRepoCfg, handleCodeDecision, isCodeApproval } from './code-pipeline.js';
import { handleNotifyCommand } from './notify.js';
import { handleOutsourceTelegramCallback, handleOutsourceTelegramCommand } from './outsourcing-bridge.js';
import { handleStageGateDecision } from './lead-ops.js';
import { buildApprovalDeliverable } from './deliverables.js';

export function getTelegramCallbacks() {
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
      if (res.ok && res.approval?.kind === 'stage_gate') {
        await handleStageGateDecision(res.approval, decision, note === 'Telegram 모바일 원터치 결재' ? '' : note);
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
        `명령어: /approvals · /doc (결재 성과품 파일) · /order 지시내용 · /out (외주 현황) · /away 3 (PC 자리비움, Aside 건너뜀) · /office · /route`,
        `자유 대화: 그냥 메시지를 보내면 총괄 팀장이 답하고, 지시면 실제 업무로 등록합니다. (#업무명 으로 채널 지정, #전체 로 해제)`,
        `알림: /notify 상태 · /report on|off · /quiet 23:00-08:00 · /quiet off`
      ].join('\n');
    },
    onChat: async (text) => handleTelegramChat(text),
    onNotifyCommand: async (cmd, arg) => handleNotifyCommand(cmd, arg),
    onOutsourceCommand: async (cmd, arg) => handleOutsourceTelegramCommand(cmd, arg),
    onOutsourceCallback: async (action, id) => handleOutsourceTelegramCallback(action, id),
    onDeliverable: async (aprId) => buildApprovalDeliverable(loadDb(), aprId),
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

export async function processCeoChat(text, reqMissionIdRaw = '', { channel = 'web' } = {}) {
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
    autoStartLiveMissionTasks(intake.startMissionId).catch(() => {});
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
export function resolveTelegramChannel(db, rawText) {
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

export async function handleTelegramChat(rawText) {
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

export const MAJOR_DECISION_RE = /결제|송금|계약|광고비|예약\s*확정|최종\s*예약|실제\s*발송|대외\s*발송/;

export async function intakeChatDirective(text, missionId) {
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
    repoLinked,
    planningRoster: buildPlanningRoster(db),
    assignmentRules: ASSIGNMENT_RULES
  });
  if (cls.kind !== 'directive') return { note: '' };
  if (Array.isArray(cls.tasks) && cls.tasks.length && mission) {
    const before = cls.tasks.length;
    cls.tasks = cls.tasks.filter((t) => !findScopeViolations(mission, `${t.title} ${t.description || ''}`).length && !isForbiddenCodeTask(mission, t));
    if (cls.tasks.length < before) appendLog(db, '총괄 팀장', `회의실 지시 중 업무 범위 밖·코드 금지 단계 작업 ${before - cls.tasks.length}건 제외`, 'info');
  }
  if (Array.isArray(cls.tasks) && cls.tasks.length) {
    const rb = rebalanceAssignments(db, cls.tasks);
    cls.tasks = rb.tasks;
    if (rb.changes.length) appendLog(db, '총괄 팀장', `회의실 지시 배정 보정: ${rb.changes.join(' / ')}`.slice(0, 600), 'info');
  }

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
        addLeadNote(t, 'ceo', `대표님 회의실 지시: ${text}`);
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
