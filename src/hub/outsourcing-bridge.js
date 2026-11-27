// hub/outsourcing-bridge.js: server.js에서 분리 (공유 로직)
import { createDesignApproval } from './dev-policy.js';
import { OUTSOURCE_WORKER_LABELS, assignRequest, cancelRequest, createOutsourcingRequest, describeRolesLine, describeRouting, findRequest, getOutsourcingSettings, listRequests, releaseExpiredLeases, resolveTarget, resumeRequest, setOutsourcingHandlers, shortenForeignLeases, submitResult, wantsTwoStage } from '../outsourcing.js';
import { appendLog, flushCloudBackup, loadDb, saveDb } from '../store.js';
import { buildMissionDigest, escapeTelegramHtml, findOutputViolations, rememberFact } from '../lead-engine.js';
import { createApprovalForTask } from '../orchestrator.js';
import { getGithubRepoConfig } from '../it-devops.js';
import { sendTelegramReport, sendTelegramText } from '../telegram.js';
import { setTaskResultHandler } from '../mcp.js';
import { CEO_ADMIN_KEY, safeEqual } from '../routes/auth.js';
import { applyPrFieldsToApproval, createItPrApproval, deployLabelFor, maybeScheduleCodeBundle, setCodeStatus } from './code-pipeline.js';
import { autoStartLiveMissionTasks, leadSay, updateMissionStatus } from './missions.js';
import { checkInboxToken } from './agent-inbox.js';
import { notifyAllApprovalChannels, sendApprovalNotifications } from './notify.js';
import { notifyOutsourceCreated, oneLineText, processTaskResult, registerDeliverable } from './task-results.js';

/** 결재가 끝났거나 새 제안으로 대체된 결재안의 자문 요청은 외부 작업자가 헛일하지 않게 취소 */
export function cancelStaleConsults(db, missionId, { exceptApprovalId = '' } = {}) {
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

export function requestConsultForApproval(db, apr, createdBy = 'system') {
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

export function requestConsultForReport(db, mission, reportText) {
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
export async function approvalFromExternalPr(db, req, mission) {
  const prUrl = String(req.result?.prUrl || (req.reviewStage === 'aside_review' ? req.sourcePrUrl : '') || '').trim();
  const m = prUrl.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/);
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
  const isTwoStageReviewed = req.reviewStage === 'aside_review';
  // Aside가 3번 반려한 뒤 AGY가 다시 낸 PR: 검수를 통과하지 못한 채 올라오므로 대표님 결재 카드에 분명히 표시
  const reviewExhausted = req.reviewStage === 'agy_rework' && (Number(req.reviewRound) || 0) > 3;
  const rawBy = String(req.result.by || '').toLowerCase();
  const byLabel = rawBy === 'aside' ? '개발팀(Aside)' : rawBy === 'antigravity' || rawBy === 'agy' ? '개발팀(AGY)' : rawBy === 'gemini' ? 'Gemini 앱' : req.result.by || '개발팀';
  const workerTag = isTwoStageReviewed ? 'AGY+Aside 검수' : reviewExhausted ? 'AGY · Aside 검수 미통과' : rawBy === 'aside' ? 'Aside' : rawBy === 'antigravity' ? 'AGY' : req.result.by;
  const result = {
    repo,
    branch: pr.base?.ref || 'main',
    branchName: pr.head?.ref || '',
    prNumber: num,
    prUrl: pr.html_url,
    prTitle: String(pr.title || '').replace(/\[OUT-[^\]]+\]\s*/, '') || req.title,
    prSummary: req.result.summary || oneLineText(pr.body, 600) || '개발팀 작업 PR',
    changedFiles: files.map((f) => f.filename),
    diffSummary: files
      .map((f) => `파일: ${f.filename} (+${f.additions}/-${f.deletions})\n${String(f.patch || '').slice(0, 1500)}`)
      .join('\n\n')
      .slice(0, 12000),
    audit: {
      passed: !reviewExhausted,
      riskLevel: reviewExhausted ? 'high' : 'medium',
      notes: reviewExhausted
        ? `Aside 검수에서 ${Number(req.reviewRound) - 1}번 반려된 뒤 AGY가 다시 낸 PR입니다(검수 미통과). 반려 사유를 확인하고 승인 여부를 결정해 주세요.`
        : isTwoStageReviewed
        ? '개발팀 AGY 1차 수정 후 Aside 검수·보완을 거친 PR입니다. 승인 시 CI 통과를 확인한 뒤 머지합니다.'
        : `${byLabel}이 작성한 PR입니다. 승인 시 CI 통과를 확인한 뒤 머지합니다.`
    },
    instruction: req.goal,
    teamContext: ''
  };
  const existing = req.approvalId ? db.approvals.find((a) => a.id === req.approvalId && a.status === 'pending') : null;
  if (existing && existing.kind !== 'next_phase') {
    applyPrFieldsToApproval(existing, result, { outsourceId: req.id });
    setCodeStatus(existing, 'ready');
    existing.proposedAction = `승인 시 개발팀 PR #${num}(${workerTag})을 main에 머지하고 ${deployLabelFor(repo)}까지 진행합니다. (CI 실패 시 머지 보류)`;
    sendApprovalNotifications(db.settings, existing, `개발팀 · ${workerTag}`);
    return existing;
  }
  const byAgentId = rawBy === 'antigravity' || rawBy === 'agy' ? 'agent_agy' : 'agent_aside';
  const apr = createItPrApproval(db, mission || { id: req.missionId }, result, {
    taskIds: req.taskId ? [req.taskId] : [],
    titlePrefix: `[개발팀 · ${workerTag}] `,
    summaryLead: req.title,
    agentId: byAgentId,
    workerName: workerTag
  });
  apr.outsourceId = req.id;
  sendApprovalNotifications(db.settings, apr, `개발팀 · ${workerTag}`);
  return apr;
}

export async function handleOutsourceSubmitted(id) {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req?.result) return;
  const r = req.result;
  const by = r.by || '개발팀';
  const byLabel = by === 'aside' ? 'Aside' : by === 'antigravity' ? 'AGY' : by;
  const mission = db.missions.find((m) => m.id === req.missionId);
  const nowIso = new Date().toISOString();
  try {
    if (req.kind === 'consult') {
      const apr = req.approvalId ? db.approvals.find((a) => a.id === req.approvalId) : null;
      const consult = { requestId: req.id, by: byLabel, summary: r.summary, document: String(r.document || '').slice(0, 12000), at: r.submittedAt };
      if (apr) apr.consult = consult;
      if (mission) {
        leadSay(db, mission, '검토 의견 도착', `${byLabel}의 검토 의견이 도착했습니다${apr ? ` (결재 "${apr.title}"에 첨부)` : ''}. ${oneLineText(r.summary || r.document, 220)}`);
      }
      rememberFact(db, { kind: 'lesson', missionId: req.missionId, text: `[검토 의견 · ${byLabel}] ${oneLineText(r.summary || r.document, 220)}`, source: 'outsourcing' });
      sendTelegramReport(db.settings, `검토 의견 도착`, `${apr ? `${apr.title}\n` : ''}${oneLineText(r.summary || r.document, 700)}`, `outres:${req.id}`).catch(() => {});
      req.status = 'accepted';
    } else if (req.codeWorkflow === 'design_first' && !req.designApprovalId) {
      // 개발 지침 "설계 먼저": Aside 설계서 → 대표님 확인 결재 (승인되면 AGY 구현 + Aside 검수)
      createDesignApproval(db, req, mission);
      req.status = 'accepted';
      if (mission) leadSay(db, mission, '개발 설계 확인 요청', `${req.id} "${req.title}" 설계서가 왔습니다. 결재함에서 확인해 주시면 AGY가 구현을 시작합니다.`);
    } else {
      const cfg = getOutsourcingSettings(db.settings);
      const isAgySubmit = by === 'antigravity' || (by === 'github' && req.claimedBy === 'antigravity');
      const reworkPrUrl = r.prUrl || (req.reviewStage === 'agy_rework' ? req.sourcePrUrl : '');
      // 설정(자동 배정) 또는 요청별 지정("AGY 수정 + Aside 검수")이면 Aside 검수로 인계
      const isInitialTwoStage = wantsTwoStage(db.settings, req) && isAgySubmit && Boolean(r.prUrl);
      const isReworkToReview =
        req.kind === 'code' &&
        req.reviewStage === 'agy_rework' &&
        isAgySubmit &&
        Boolean(reworkPrUrl) &&
        (Number(req.reviewRound) || 1) <= 3;
      const shouldHandoffToAside = isInitialTwoStage || isReworkToReview;

      if (shouldHandoffToAside) {
        const targetPrUrl = reworkPrUrl || r.prUrl;
        const roundNum = isReworkToReview ? Number(req.reviewRound) || 2 : 1;
        const reviewGoal = [
          `Antigravity가 ${roundNum}차로 수정한 PR을 검수하고, 문제가 없으면 승인(제출)하거나 필요한 보완을 진행해 주세요.`,
          '',
          `- 검수 대상 PR: ${targetPrUrl}`,
          `- 원본 요청: ${req.sourceOutsourceId || req.id} · ${req.title}`,
          '',
          '### 검수·보완 체크리스트',
          '1. 바뀐 파일과 자동 테스트(CI) 결과를 확인하고, 최근 PR 변경을 되돌린 줄이 없는지 확인',
          '2. 없는 파일을 불러오거나 기존 외주 API 스키마·화면(`public/index.html` 캐시 버전 포함)을 깨뜨리지 않았는지 확인',
          '3. 문제가 없으면 같은 PR 주소로 `submit` (대표님 결재 카드 생성). 작은 보완은 같은 PR 브랜치에 커밋 후 `submit`',
          `4. 큰 수정이 필요하면 \`POST /api/outsourcing/{요청ID}/pass\` ({"worker":"aside","to":"antigravity","reason":"구체적인 수정 지시"})로 AGY에게 되돌려 재수정 요청`
        ].join('\n');
        const reviewContext = [
          `### 원본 요청 목표 (${req.sourceOutsourceId || req.id})`,
          String(req.goal || req.title).slice(0, 2000),
          '',
          `### Antigravity ${roundNum}차 수정 요약`,
          String(r.summary || '(요약 없음)').slice(0, 1000),
          '',
          `### Antigravity ${roundNum}차 제출 문서`,
          String(r.document || '').slice(0, 3200)
        ].join('\n');

        const baseTitle = req.title.replace(/^\[검수·보완(?:\s*\d+차)?\]\s*/, '');
        const made = createOutsourcingRequest(db, {
          kind: 'code',
          worker: 'aside',
          pinnedWorker: 'aside',
          reviewStage: 'aside_review',
          reviewRound: roundNum,
          sourceOutsourceId: req.sourceOutsourceId || req.id,
          sourcePrUrl: targetPrUrl,
          title: `[검수·보완${roundNum > 1 ? ` ${roundNum}차` : ''}] ${baseTitle}`.slice(0, 120),
          missionId: req.missionId,
          taskId: req.taskId,
          approvalId: req.approvalId,
          repo: req.repo,
          branch: req.branch || 'main',
          siteUrl: req.siteUrl || '',
          reason: `2단계 코드 협업(AGY 수정 → Aside 검수·보완 ${roundNum}차): Antigravity PR(${targetPrUrl})을 Aside가 검수·보완한 뒤 대표님 결재에 올립니다.`,
          goal: reviewGoal,
          deliverable: `PR(${targetPrUrl}) 검수 결과 및 보완 내역 요약 + 최종 PR 주소(수정 없으면 동일 PR 주소 제출, 반려 시 /pass로 AGY에 수정 지시)`,
          context: reviewContext,
          createdBy: 'system'
        });
        const reviewReq = made.request;
        req.reviewStage = 'handed_to_aside';
        req.reviewRequestId = reviewReq.id;
        req.status = 'accepted';
        const task = req.taskId ? db.tasks.find((t) => t.id === req.taskId) : null;
        if (task) {
          task.status = 'outsourced';
          task.outsourceId = reviewReq.id;
          task.updatedAt = nowIso;
        }
        if (made.created) notifyOutsourceCreated(db, reviewReq);
        appendLog(db, '외주 창구', `${req.id} Antigravity 1차 수정 완료 (${r.prUrl}) → Aside 검수·보완(${reviewReq.id})으로 자동 인계`, 'info');
        if (mission) {
          leadSay(db, mission, '2단계 코드 검수 인계', `${req.id} "${req.title}" 1차 수정(Antigravity · ${r.prUrl})이 완료되어 Aside 검수·보완(${reviewReq.id})으로 자동 넘겼습니다.`);
        }
        sendTelegramReport(db.settings, `2단계 코드 검수 인계 ${req.id}`, `"${req.title}"\n1차 PR: ${r.prUrl}\n→ Aside 검수·보완 요청(${reviewReq.id})을 자동 생성했습니다. 검수 완료 후 결재 카드가 올라옵니다.`, `outreview:${req.id}`).catch(() => {});
      } else {
        if (req.reviewStage === 'aside_review' && !r.prUrl && req.sourcePrUrl) {
          r.prUrl = req.sourcePrUrl;
        }
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
            // 외주 결과(상위 AI)는 검수 없이, 지침 위반 검사와 결과물 등록만
            task.status = 'completed';
            if (mission) {
              const vio = findOutputViolations(mission, task.output);
              if (vio.length) appendLog(db, '총괄 팀장', `외주 결과 "${task.title}"에 지침 위반 의심: ${vio.join(', ')} (대표님 확인 권장)`, 'warning');
              registerDeliverable(db, mission, task, { name: `외주 · ${by}` });
            }
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
export async function handleOutsourceNeedsCeo(id) {
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

// MCP submit_task_result → 업무 처리 엔진
setTaskResultHandler(async (taskId, output, mode) => {
  const db = loadDb();
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return { status: 'error', error: '업무 없음' };
  const agent = db.agents.find((a) => a.id === task.assigneeId);
  const mission = db.missions.find((m) => m.id === task.missionId);
  const hasLimitations = Boolean(task.botReport?.limitations?.length || task.botReport?.blockers?.length || task.botReport?.questions?.length);
  const out = await processTaskResult(db, task, agent, mission, { output, executionModeUsed: mode }, { hasLimitations });
  updateMissionStatus(db, task.missionId);
  saveDb(db);
  await flushCloudBackup(db);
  if (out.requeued) setTimeout(() => autoStartLiveMissionTasks(task.missionId).catch(() => {}), 1500);
  const approvalId = out?.approvalId || db.approvals.find((a) => a.taskId === task.id && a.status === 'pending')?.id || null;
  return { status: task.status, approvalId, review: task.review || null, leadFeedback: task.leadFeedback || null };
});

export function updateOutsourceRouting(db, { routing, awayHours, officeHours, leaseMinutes, roles, geminiWaitMinutes, priorities, waitMinutes, codeWorkflow } = {}) {
  const os = { ...getOutsourcingSettings(db.settings) };
  if (['auto', 'aside', 'antigravity', 'gemini'].includes(routing)) os.routing = routing;
  if (roles && typeof roles === 'object') os.roles = { ...os.roles, ...roles };
  if (priorities && typeof priorities === 'object') os.priorities = { ...os.priorities, ...priorities };
  if (['single', 'agy_then_aside'].includes(codeWorkflow)) {
    os.codeWorkflow = codeWorkflow;
    // 2단계 협업 모드면 1순위는 항상 Antigravity(미처리 시 Aside 폴백)로 맞춤
    if (codeWorkflow === 'agy_then_aside') {
      os.priorities = { ...os.priorities, code: ['antigravity', 'aside'] };
    }
  }
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
export async function handleOutsourceTelegramCommand(cmd, args = '') {
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

export async function handleOutsourceTelegramCallback(action, id) {
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
export async function outsourcingWatch() {
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
  const withRepo = listRequests(db, { status: 'active' }).filter((r) => r.repo && r.kind !== 'consult' && r.reviewStage !== 'aside_review' && r.reviewStage !== 'agy_rework');
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
          document: String(pr.body || '').trim() || `개발팀이 PR을 열었습니다: ${pr.html_url}`,
          prUrl: pr.html_url
        }).catch((err) => console.warn('outsource PR submit failed:', err.message));
      }
    } catch {
      // ignore network errors
    }
  }
}

export function outsourceAuthOk(c, db, body = {}) {
  if (CEO_ADMIN_KEY && safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY)) return true;
  if (db.settings?.mcpToken) return checkInboxToken(c, db, body);
  return !CEO_ADMIN_KEY;
}

export function isCeoRequest(c) {
  return !CEO_ADMIN_KEY || safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY);
}
