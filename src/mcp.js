import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { loadDb, saveDb, appendLog, recordAgentHeartbeat, uid } from './store.js';
import { notifyWebhook } from './orchestrator.js';
import { sendTelegramApprovalCard } from './telegram.js';
import { sendWebPushNotification } from './push.js';
import { buildCompanyContext } from './lead-engine.js';
import { buildAgentRecentFeedback, enrichApprovalDeliverables, taskFeedbackSummary } from './hub/deliverables.js';
import { LEAD_WORKERS, buildLeadPacket, claimLeadJob, leadDeskStatus, listLeadJobs, submitLeadJob, summarizeLeadJob, touchLeadWorker } from './lead-desk.js';
import { listRequests, summarizeRequest, claimRequest, findRequest, buildPacket, submitResult, requestCeoAction, resolveTarget, describeRouting, passRequest } from './outsourcing.js';

export const MCP_TOOL_CATALOG = [
  {
    name: 'get_company_brief',
    description: '현재 CEO Office의 활성 미션, 조직도 및 대기 중인 결재 수를 조회합니다.'
  },
  {
    name: 'list_my_tasks',
    description: '특정 AI 에이전트(agent_muse, agent_cue, agent_claude 등)에게 배정된 업무와 맞춤 지시서를 조회합니다.'
  },
  {
    name: 'submit_task_result',
    description: '배정받은 업무의 결과물을 CEO Hub에 보고하고, 필요 시 자동으로 CEO 결재함에 상신합니다.'
  },
  {
    name: 'request_ceo_approval',
    description: '결제, 예약 확정, 외부 발송 등 중요 의사결정에 대해 즉시 CEO 결재 안건을 상신합니다.'
  },
  { name: 'list_outsourcing_requests', description: '외부 AI 외주·자문 요청 목록 조회 (Antigravity·Aside·Gemini 앱용)' },
  { name: 'claim_outsourcing_request', description: '외주 요청을 잡고 요청서 전문 받기' },
  { name: 'get_outsourcing_request', description: '외주 요청서 전문 조회' },
  { name: 'submit_outsourcing_result', description: '외주 결과 문서·PR 제출' },
  { name: 'request_ceo_action', description: '로그인 등 대표님 개입이 필요할 때 멈추고 알림' },
  { name: 'pass_outsourcing_request', description: '내가 못 하는 외주를 다른 작업자에게 넘기기' },
  { name: 'list_lead_jobs', description: '팀장 업무함: 대기 중인 팀장 판단(검수·작전 계획) 목록' },
  { name: 'claim_lead_job', description: '팀장 판단 요청을 잡고 판단 자료·답안 형식 받기' },
  { name: 'submit_lead_job', description: '팀장 판단 결과(JSON) 제출' }
];

/**
 * Create a fresh official @modelcontextprotocol/sdk McpServer instance
 * with all CEO Office governance & delegation tools registered via Zod schemas.
 */
// 서버의 업무 처리 엔진(팀장 검수·결과물 등록)으로 결과를 넘기는 훅
let taskResultHandler = null;
export function setTaskResultHandler(fn) {
  taskResultHandler = typeof fn === 'function' ? fn : null;
}

export function createCeoMcpServer() {
  const server = new McpServer({
    name: 'ai-ceo-hub-mcp',
    version: '2.0.0'
  });

  server.tool(
    'get_company_brief',
    '현재 CEO Office의 활성 미션, 조직도 및 대기 중인 결재 수를 조회합니다.',
    {},
    async () => {
      const db = loadDb();
      recordAgentHeartbeat(db, 'agent_muse', 'MCP brief');
      saveDb(db);
      const activeMissions = db.missions.filter((m) => m.status !== 'completed');
      const pendingApprovals = db.approvals.filter((a) => a.status === 'pending').length;
      const data = {
        companyName: db.settings.companyName,
        ceoName: db.settings.ceoName,
        defaultCostPolicy: db.settings.defaultCostPolicy,
        // 모든 외부 에이전트(Claude·Muse·Cue)도 내부 AI와 같은 CEO 전역 지침·회사 기억을 따르도록 공유
        globalDirectives: db.settings.globalDirectives || '',
        companyContext: buildCompanyContext(db, '', { compact: true }),
        pendingApprovals,
        activeMissions: activeMissions.map((m) => ({
          id: m.id,
          title: m.title,
          directive: m.directive,
          status: m.status,
          leadPlanSummary: m.leadPlanSummary
        })),
        agents: db.agents
          .filter((a) => a.active)
          .map((a) => ({
            id: a.id,
            name: a.name,
            roleTitle: a.roleTitle,
            connectionMode: a.connectionMode,
            costTier: a.costTier
          }))
      };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'list_my_tasks',
    '특정 AI 에이전트에게 배정된 업무 목록과 지시서를 조회합니다.',
    {
      agent_id: z.string().optional().describe('에이전트 ID (예: agent_muse, agent_cue, agent_claude)'),
      include_completed: z.boolean().optional().describe('완료된 업무 포함 여부')
    },
    async ({ agent_id, include_completed = false }) => {
      const db = loadDb();
      if (agent_id) {
        recordAgentHeartbeat(db, agent_id, 'MCP tasks');
        saveDb(db);
      }
      const tasks = db.tasks.filter((t) => {
        if (agent_id && t.assigneeId !== agent_id) return false;
        if (!include_completed && t.status === 'completed') return false;
        return true;
      });
      const data = {
        count: tasks.length,
        tasks: tasks.map((t) => {
          const fb = taskFeedbackSummary(db, t);
          return {
            id: t.id,
            missionId: t.missionId,
            assigneeId: t.assigneeId,
            title: t.title,
            description: t.description,
            status: t.status,
            requiresApproval: t.requiresApproval,
            estimatedCostKRW: t.estimatedCostKRW,
            dispatchPrompt: t.dispatchPrompt,
            ceoFeedback: fb.ceoFeedback,
            rejectionReason: fb.rejectionReason,
            leadNotes: fb.leadNotes,
            lastDecision: fb.lastDecision
          };
        }),
        ...(agent_id ? { recentFeedback: buildAgentRecentFeedback(db, agent_id, 10) } : {})
      };
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'submit_task_result',
    '배정받은 업무의 결과물을 CEO Hub에 보고합니다. 결제·예약·외부 발송 전이라면 requires_ceo_approval을 true로 설정하세요.',
    {
      task_id: z.string().describe('업무 ID (예: tsk_...)'),
      deliverable: z.string().describe('작업 결과 본문 (마크다운)'),
      requires_ceo_approval: z.boolean().optional().describe('실행 전 CEO 결재 필요 여부'),
      approval_reason: z.string().optional().describe('CEO 결재 요청 사유'),
      estimated_cost_krw: z.number().optional().describe('예상 비용 (원)')
    },
    async ({
      task_id,
      deliverable,
      requires_ceo_approval = false,
      approval_reason = '',
      estimated_cost_krw
    }) => {
      const db = loadDb();
      const task = db.tasks.find((t) => t.id === task_id);
      if (!task) {
        return {
          isError: true,
          content: [{ type: 'text', text: `업무를 찾을 수 없습니다: ${task_id}` }]
        };
      }
      const agent = db.agents.find((a) => a.id === task.assigneeId);
      const now = new Date().toISOString();

      task.output = deliverable;
      task.executionModeUsed = 'mcp_sdk_live';
      task.updatedAt = now;
      if (typeof estimated_cost_krw === 'number') {
        task.estimatedCostKRW = estimated_cost_krw;
      }

      const shouldPause = requires_ceo_approval || task.requiresApproval;
      let approvalId = null;

      if (shouldPause) {
        task.requiresApproval = true;
        if (approval_reason) task.pendingApprovalReason = String(approval_reason).trim().slice(0, 320);
      }

      // 모든 업무 결과(결재 필요 포함)는 팀장 검수·재가공을 거침 (통과·재작업·상위 처리 → 필요 시 결재 상신)
      if (taskResultHandler) {
        saveDb(db);
        const handled = await taskResultHandler(task.id, deliverable, 'mcp_sdk_live').catch((err) => ({ status: 'error', error: err.message }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: handled.status !== 'error',
                  task_id: task.id,
                  status: handled.status,
                  approval_id: handled.approvalId || null,
                  review: handled.review || null,
                  note:
                    handled.status === 'review_pending'
                      ? '총괄 팀장이 결과물을 검수·재가공한 뒤 CEO 결재함으로 상신합니다.'
                      : handled.status === 'queued' || handled.status === 'awaiting_bridge'
                        ? '팀장 검수에서 보완 요청: review.feedback을 반영해 다시 제출하세요.'
                        : ''
                },
                null,
                2
              )
            }
          ]
        };
      }

      if (shouldPause) {
        task.status = 'awaiting_approval';
        const existing = db.approvals.find((a) => a.taskId === task.id && a.status === 'pending');
        if (!existing) {
          const apr = {
            id: uid('apr'),
            missionId: task.missionId,
            taskId: task.id,
            agentId: task.assigneeId,
            title: `${task.title} (MCP 보고 승인 요청)`,
            category: (task.estimatedCostKRW || 0) > 0 ? '예약 · 결제' : 'MCP 외부 실행 승인',
            riskLevel: (task.estimatedCostKRW || 0) >= 100000 ? 'high' : 'medium',
            estimatedCostKRW: task.estimatedCostKRW || 0,
            depositKRW: 0,
            summary: approval_reason || deliverable.slice(0, 260),
            proposedAction: '승인 시 해당 에이전트의 작업 결과를 확정하고 다음 단계로 진행합니다.',
            status: 'pending',
            ceoNote: '',
            createdAt: now,
            decidedAt: null
          };
          db.approvals.unshift(apr);
          approvalId = apr.id;
          const { deliverable: mcpDeliverable } = enrichApprovalDeliverables(db, apr);
          notifyWebhook(db.settings, 'approval_requested', apr).catch(() => {});
          sendTelegramApprovalCard(db.settings, apr, agent?.name || task.assigneeId, '', {
            deliverableDoc: mcpDeliverable
          }).catch(() => {});
          sendWebPushNotification({
            title: `[결재 요청] ${apr.title}`,
            body: `${agent?.name || 'AI'} · ${apr.summary.slice(0, 90)}`,
            view: 'approvals',
            tag: `apr-${apr.id}`
          }).catch(() => {});
        } else {
          approvalId = existing.id;
        }
        appendLog(
          db,
          `${agent?.name || task.assigneeId} (MCP SDK)`,
          `"${task.title}" 결과를 보고하고 CEO 결재를 요청했습니다.`,
          'approval'
        );
      } else {
        task.status = 'completed';
        appendLog(
          db,
          `${agent?.name || task.assigneeId} (MCP SDK)`,
          `"${task.title}" 작업을 공식 MCP로 완료 보고했습니다.`,
          'success'
        );
        sendWebPushNotification({
          title: `[업무 완료] ${task.title}`,
          body: `${agent?.name || 'AI'}가 작업 결과를 보고했습니다.`,
          view: 'missions',
          tag: `tsk-${task.id}`
        }).catch(() => {});
      }

      saveDb(db);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: true, task_id: task.id, status: task.status, approval_id: approvalId },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.tool(
    'request_ceo_approval',
    '중요한 결정(결제, 예약 확정, 대외 발송, 예산 초과 등)에 대해 즉시 CEO 결재함에 안건을 상신합니다.',
    {
      agent_id: z.string().optional().describe('요청 에이전트 ID'),
      task_id: z.string().optional().describe('연관 업무 ID'),
      title: z.string().describe('결재 안건 제목'),
      summary: z.string().describe('배경 및 핵심 요약'),
      proposed_action: z.string().describe('승인 시 수행할 작업'),
      estimated_cost_krw: z.number().optional().describe('예상 비용 (원)'),
      risk_level: z.enum(['low', 'medium', 'high']).optional()
    },
    async (args) => {
      const db = loadDb();
      const now = new Date().toISOString();
      const agent = db.agents.find((a) => a.id === args.agent_id);
      const apr = {
        id: uid('apr'),
        missionId: db.missions[0]?.id || '',
        taskId: args.task_id || '',
        agentId: args.agent_id || 'agent_muse',
        title: args.title,
        category: (args.estimated_cost_krw || 0) > 0 ? '예약 · 결제' : '에이전트 의사결정 요청',
        riskLevel: args.risk_level || 'medium',
        estimatedCostKRW: Number(args.estimated_cost_krw) || 0,
        depositKRW: 0,
        summary: args.summary,
        proposedAction: args.proposed_action,
        status: 'pending',
        ceoNote: '',
        createdAt: now,
        decidedAt: null
      };
      db.approvals.unshift(apr);
      const { deliverable: mcpReqDeliverable } = enrichApprovalDeliverables(db, apr);
      appendLog(db, `${agent?.name || 'MCP 에이전트'}`, `CEO 결재 안건 상신: "${apr.title}"`, 'approval');
      saveDb(db);
      notifyWebhook(db.settings, 'approval_requested', apr).catch(() => {});
      sendTelegramApprovalCard(db.settings, apr, agent?.name || 'MCP 에이전트', '', {
        deliverableDoc: mcpReqDeliverable
      }).catch(() => {});
      sendWebPushNotification({
        title: `[결재 요청] ${apr.title}`,
        body: `${agent?.name || 'AI'} · ${apr.summary.slice(0, 90)}`,
        view: 'approvals',
        tag: `apr-${apr.id}`
      }).catch(() => {});
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, approval_id: apr.id, status: 'pending' }, null, 2) }]
      };
    }
  );

  // ---- 외부 AI 외주 · 자문 (Antigravity 등 상위 AI가 직접 가져가서 처리) ----
  server.tool(
    'list_outsourcing_requests',
    'CEO Office가 외부 AI에 맡긴 외주·자문 요청 목록을 조회합니다. 무료 AI 팀이 할 수 없는 일(코드 대규모 수정, 계정·콘솔 작업, 반복 실패 작업)과 팀장 결과물 자문이 올라옵니다.',
    {
      worker: z.string().optional().describe('작업자 이름 (antigravity, aside, gemini). 지금 그 작업자에게 배정된 것만 보여줌'),
      status: z.string().optional().describe('active(기본: 대기·진행) / open / claimed / submitted / accepted / all'),
      effort: z.string().optional().describe('난이도 필터: deep(판단·추론 필요 → 상위 모델) / light(자료 조사·단순 작업 → Hydrogen). 비우면 전부')
    },
    async ({ worker = '', status = 'active', effort = '' }) => {
      const db = loadDb();
      const list = listRequests(db, { status, worker, effort });
      // Gemini 앱: 당직 팀장 판단(ldj_)도 같은 목록·같은 잡기/제출 도구로 처리 (별도 도구가 Gemini 앱에서 막히는 문제 회피)
      const leadJobs = worker === 'gemini' ? listLeadJobs(db, 'gemini_app') : [];
      if (worker === 'gemini') touchLeadWorker(db, 'gemini_app', 'mcp outsourcing list');
      saveDb(db);
      const requests = [
        ...leadJobs.map((j) => ({ ...summarizeLeadJob(j), kind: 'lead_review', title: `[팀장 판단] ${summarizeLeadJob(j).purposeLabel}`, howTo: '이 id로 claim_outsourcing_request → 받은 자료의 답안 형식대로 JSON을 만들어 submit_outsourcing_result의 document에 JSON만 넣어 제출' })),
        ...list.map((r) => ({ ...summarizeRequest(r), target: resolveTarget(db.settings, r) }))
      ];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { count: requests.length, routing: describeRouting(db.settings), requests, next: '처리할 요청을 claim_outsourcing_request로 잡고 요청서 지시대로 작업 후 submit_outsourcing_result로 제출. id가 ldj_로 시작하면 팀장 판단: document에 답안 형식 JSON만. 로그인·인증 등 대표님 손이 필요하면 request_ceo_action' },
              null,
              2
            )
          }
        ]
      };
    }
  );

  server.tool(
    'claim_outsourcing_request',
    '외주 요청을 내가 처리하겠다고 잡습니다(다른 작업자와 중복 방지, 몇 시간 뒤 자동 해제). 요청서 전문(마크다운)을 돌려줍니다.',
    {
      request_id: z.string().describe('요청 ID (예: OUT-261126-AB12)'),
      worker: z.string().describe('작업자 이름 (antigravity, aside, gemini)')
    },
    async ({ request_id, worker }) => {
      try {
        if (/^ldj_/.test(String(request_id))) {
          const j = claimLeadJob(request_id, worker === 'antigravity' ? 'agy_lead' : 'gemini_app');
          return { content: [{ type: 'text', text: `${buildLeadPacket(j)}\n\n## 이 창구에서 제출\nsubmit_outsourcing_result (request_id: ${j.id}, worker: "${worker}", summary: 한 줄, document: 답안 형식 JSON만)` }] };
        }
        const req = claimRequest(request_id, worker);
        return { content: [{ type: 'text', text: buildPacket(loadDb(), req) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );

  server.tool(
    'get_outsourcing_request',
    '외주 요청서 전문(배경, 해야 할 일, 제출물, 회사 지침, 제출 방법)을 마크다운으로 받습니다.',
    { request_id: z.string().describe('요청 ID') },
    async ({ request_id }) => {
      const db = loadDb();
      const req = findRequest(db, request_id);
      if (!req) return { isError: true, content: [{ type: 'text', text: `요청을 찾을 수 없습니다: ${request_id}` }] };
      return { content: [{ type: 'text', text: buildPacket(db, req) }] };
    }
  );

  server.tool(
    'submit_outsourcing_result',
    '외주 결과를 제출합니다. 코드 작업이면 저장소에 브랜치 out/{요청ID}로 PR을 열고 pr_url을 함께 보내세요(대표님 결재 후 자동 머지·배포). 자문이면 document에 검토 의견을 쓰세요.',
    {
      request_id: z.string().describe('요청 ID'),
      worker: z.string().describe('작업자 이름 (antigravity, aside, gemini)'),
      summary: z.string().describe('결과 요약 2~4문장'),
      document: z.string().describe('결과 문서 전문 (마크다운). 실제 확인한 사실과 추정을 구분'),
      pr_url: z.string().optional().describe('코드 작업 PR 주소 (https://github.com/owner/repo/pull/번호)')
    },
    async ({ request_id, worker, summary, document, pr_url = '' }) => {
      try {
        if (/^ldj_/.test(String(request_id))) {
          const j = await submitLeadJob(request_id, { worker: worker === 'antigravity' ? 'agy_lead' : 'gemini_app', result: document || summary });
          return { content: [{ type: 'text', text: `제출 완료: ${j.id} (팀장 판단). 다음 요청을 처리하세요.` }] };
        }
        const req = await submitResult(request_id, { worker, summary, document, prUrl: pr_url });
        return { content: [{ type: 'text', text: `제출 완료: ${req.id} (${req.status}). 대표님께 보고됐습니다.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );

  server.tool(
    'request_ceo_action',
    '로그인, 2단계 인증, CAPTCHA, 결제·발송 승인처럼 대표님만 할 수 있는 일이 필요할 때 작업을 멈추고 대표님께 텔레그램으로 알립니다. 대표님이 처리 후 재개하면 다시 대기열에 올라옵니다.',
    {
      request_id: z.string().describe('요청 ID'),
      worker: z.string().describe('작업자 이름'),
      action: z.string().describe('대표님이 해야 할 일 한 줄 (예: 애드센스 로그인 필요)'),
      detail: z.string().optional().describe('어디서 무엇을 하면 되는지')
    },
    async ({ request_id, worker, action, detail = '' }) => {
      try {
        const req = await requestCeoAction(request_id, { worker, action, detail });
        return { content: [{ type: 'text', text: `대표님께 알렸습니다: ${req.id} — ${action}. 이 요청은 재개될 때까지 멈춥니다. 다른 요청을 처리하세요.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );

  server.tool(
    'pass_outsourcing_request',
    '이 외주가 내 환경에서 할 수 없는 일이면(예: Gemini 앱인데 코드 저장소 수정이나 로그인이 필요한 사이트 작업) 다른 작업자에게 넘깁니다. 억지로 하거나 그럴듯하게 지어내지 말고 넘기세요.',
    {
      request_id: z.string().describe('요청 ID'),
      worker: z.string().describe('내 작업자 이름 (gemini, aside, antigravity)'),
      to: z.string().optional().describe('넘길 곳: antigravity(코드 수정) / aside(로그인·콘솔 작업) / auto(시간대 담당) / deep(같은 작업자의 상위 모델로 올림: Gemini Hydrogen → Neon)'),
      reason: z.string().describe('왜 넘기는지, 지금까지 한 것과 남은 일 (다음 작업자가 이어받을 수 있게)')
    },
    async ({ request_id, worker, to = 'auto', reason }) => {
      try {
        const req = passRequest(request_id, { worker, to, reason });
        return { content: [{ type: 'text', text: `넘겼습니다: ${req.id} → ${req.pinnedWorker}. 다음 요청을 처리하세요.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );

  // ---- 팀장 업무함 (주간: AGY 팀장 감시기 · 야간 당직: Gemini 앱 예약 작업) ----
  server.tool(
    'list_lead_jobs',
    '대기 중인 판단 요청(결과물 검수, 계획 수립) 목록을 조회합니다. 읽기 전용입니다.',
    { worker: z.string().describe('gemini_app (Gemini 앱 당직 팀장) 또는 agy_lead (AGY 팀장)') },
    async ({ worker }) => {
      const db = loadDb();
      const w = LEAD_WORKERS[worker] ? worker : 'gemini_app';
      touchLeadWorker(db, w, 'mcp list');
      const list = listLeadJobs(db, w);
      saveDb(db);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: list.length, status: leadDeskStatus(db), jobs: list.map(summarizeLeadJob), next: '오래된 것부터 claim_lead_job으로 잡고, 받은 자료의 답안 형식대로 JSON을 만들어 submit_lead_job으로 제출' }, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    'claim_lead_job',
    '팀장 판단 요청을 잡고 판단 자료(역할·원칙, 자료, 답안 형식)를 받습니다.',
    { job_id: z.string().describe('요청 ID (예: ldj_xxx)'), worker: z.string().describe('gemini_app 또는 agy_lead') },
    async ({ job_id, worker }) => {
      try {
        const j = claimLeadJob(job_id, LEAD_WORKERS[worker] ? worker : 'gemini_app');
        return { content: [{ type: 'text', text: buildLeadPacket(j) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );

  server.tool(
    'submit_lead_job',
    '팀장 판단 결과를 제출합니다. result_json에는 답안 형식의 키를 그대로 쓴 JSON 하나만 넣으세요.',
    {
      job_id: z.string().describe('요청 ID'),
      worker: z.string().describe('gemini_app 또는 agy_lead'),
      result_json: z.string().describe('답안 형식대로 작성한 JSON 문자열')
    },
    async ({ job_id, worker, result_json }) => {
      try {
        const j = await submitLeadJob(job_id, { worker: LEAD_WORKERS[worker] ? worker : 'gemini_app', result: result_json });
        return { content: [{ type: 'text', text: `제출 완료: ${j.id}. 다음 팀장 판단이 있으면 이어서 처리하세요.` }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    }
  );

  return server;
}

/**
 * Stateless Official MCP Streamable HTTP handler for Node req/res
 */
export async function handleOfficialMcpHttp(req, res, parsedBody) {
  const db = loadDb();
  const expectedToken = String(db.settings?.mcpToken || '').trim();
  const authHeader = String(req.headers.authorization || '');
  // 토큰 필수: Authorization: Bearer <토큰> 또는 ?token=<토큰> (Gemini 앱 맞춤 연결 앱은 주소에 토큰을 넣음)
  let provided = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!provided) {
    try {
      provided = new URL(req.url || '/', 'http://localhost').searchParams.get('token') || '';
    } catch {
      provided = '';
    }
  }
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expectedToken);
  const valid = expectedToken.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!valid) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: parsedBody?.id ?? null,
        error: { code: -32001, message: provided ? 'Invalid MCP token' : 'MCP token required (Authorization: Bearer <token> or ?token=<token>)' }
      })
    );
    return;
  }

  // Ensure Accept header satisfies official MCP StreamableHTTP transport when called from simple clients
  if (!req.headers.accept || !req.headers.accept.includes('text/event-stream')) {
    req.headers.accept = 'application/json, text/event-stream';
  }

  const mcpServer = createCeoMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', () => {
    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
