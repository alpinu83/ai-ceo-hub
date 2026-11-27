// routes/agent-inbox.js: server.js에서 분리 (HTTP 라우트)
import { buildCompanyContext } from '../lead-engine.js';
import { loadDb, recordAgentHeartbeat, saveDb } from '../store.js';
import { renderSkills, selectSkills } from '../skills.js';
import { checkInboxToken, handleAgentInboxReply, resolveInboxAgent } from '../hub/agent-inbox.js';
import { buildAgentRecentFeedback, taskFeedbackSummary } from '../hub/deliverables.js';


export function registerAgentInboxRoutes(app) {
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
    const missionTitleById = Object.fromEntries((db.missions || []).map((m) => [m.id, m.title]));
    const pendingTasks = db.tasks
      .filter((t) => t.assigneeId === agent.id && t.status !== 'completed' && t.status !== 'rejected')
      .map((t) => {
        const fb = taskFeedbackSummary(db, t);
        return {
          id: t.id,
          missionId: t.missionId,
          missionTitle: missionTitleById[t.missionId] || '',
          title: t.title,
          description: t.description,
          status: t.status,
          requiresApproval: t.requiresApproval,
          estimatedCostKRW: t.estimatedCostKRW,
          dispatchPrompt: t.dispatchPrompt,
          ceoFeedback: fb.ceoFeedback,
          leadNotes: fb.leadNotes,
          lastDecision: fb.lastDecision
        };
      });

    const recentFeedback = buildAgentRecentFeedback(db, agent.id, 10);

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
          ? pendingTasks.map(
              (t, i) =>
                `${i + 1}. [${t.id}] (${t.missionTitle || t.missionId}) ${t.title} [상태: ${t.status}]\n   설명: ${t.description}${t.ceoFeedback ? `\n   CEO 피드백·수정 지시: ${t.ceoFeedback}` : ''}\n   승인 필요: ${t.requiresApproval ? '예(확정·결제 전 정지)' : '아니오'}`
            )
          : ['현재 새로 배정된 업무가 없습니다.']),
        ...(recentFeedback.length
          ? [
              '',
              `=== 최근 CEO 결재 피드백 (반려·수정 지시·승인, ${recentFeedback.length}건) ===`,
              ...recentFeedback.map((f) => `- [${f.taskId || f.approvalId}] ${f.title} → ${f.decisionLabel}: ${f.reason}`)
            ]
          : []),
        '',
        `=== 최근 #전사-회의실 대화 (최근 ${recentMeetingRoom.length}건) ===`,
        ...recentMeetingRoom.map((m) => `- ${m.sender}: ${m.text}`),
        '',
        `=== 답변/결과 제출 방법 (POST JSON) ===`,
        `URL: ${replyUrl}`,
        `규칙: 업무 결과를 제출할 때는 반드시 정확한 taskId와 missionId를 함께 보내세요. 일반 회의실 보고·정정 메시지는 taskId·deliverable 없이 message와 missionId만 보내세요.`,
        `Body: {"message":"회의실 보고 내용","missionId":"프로젝트ID","taskId":"업무ID","deliverable":"상세 결과","requestApproval":false,"estimatedCostKRW":0}`
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
      recentFeedback,
      recentMeetingRoom,
      howToReply: {
        method: 'POST',
        url: replyUrl,
        contentType: 'application/json',
        rules: [
          '업무 결과 제출 시 반드시 정확한 taskId와 missionId를 함께 보내세요 (대기 업무가 2건 이상이면 taskId 없이 제출 시 자동 연결되지 않습니다).',
          '일반 회의실 보충 보고·정정 메시지는 taskId와 deliverable을 생략하고 message와 missionId만 보내세요.'
        ],
        exampleBody: {
          message: '조사 결과를 보고합니다.',
          missionId: pendingTasks[0]?.missionId || '',
          taskId: pendingTasks[0]?.id || '',
          deliverable: '상세 결과 내용',
          requestApproval: false,
          approvalTitle: '예약/실행 승인 요청',
          estimatedCostKRW: 0
        }
      }
    });
  });

  app.post('/api/agent-inbox/:agentKey/reply', handleAgentInboxReply);

  app.post('/api/agent-inbox/:agentKey', handleAgentInboxReply);
}
