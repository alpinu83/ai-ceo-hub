import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { loadDb, saveDb, appendLog, recordAgentHeartbeat, uid } from './store.js';
import { notifyWebhook } from './orchestrator.js';
import { sendTelegramApprovalCard } from './telegram.js';
import { sendWebPushNotification } from './push.js';
import { buildCompanyContext } from './lead-engine.js';
import { listRequests, summarizeRequest, claimRequest, findRequest, buildPacket, submitResult, requestCeoAction, resolveTarget, describeRouting } from './outsourcing.js';

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
  { name: 'list_outsourcing_requests', description: '외부 AI 외주·자문 요청 목록 조회 (Antigravity·Aside용)' },
  { name: 'claim_outsourcing_request', description: '외주 요청을 잡고 요청서 전문 받기' },
  { name: 'get_outsourcing_request', description: '외주 요청서 전문 조회' },
  { name: 'submit_outsourcing_result', description: '외주 결과 문서·PR 제출' },
  { name: 'request_ceo_action', description: '로그인 등 대표님 개입이 필요할 때 멈추고 알림' }
];

/**
 * Create a fresh official @modelcontextprotocol/sdk McpServer instance
 * with all CEO Office governance & delegation tools registered via Zod schemas.
 */
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
        tasks: tasks.map((t) => ({
          id: t.id,
          missionId: t.missionId,
          assigneeId: t.assigneeId,
          title: t.title,
          description: t.description,
          status: t.status,
          requiresApproval: t.requiresApproval,
          estimatedCostKRW: t.estimatedCostKRW,
          dispatchPrompt: t.dispatchPrompt
        }))
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
          notifyWebhook(db.settings, 'approval_requested', apr).catch(() => {});
          sendTelegramApprovalCard(db.settings, apr, agent?.name || task.assigneeId).catch(() => {});
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
      appendLog(db, `${agent?.name || 'MCP 에이전트'}`, `CEO 결재 안건 상신: "${apr.title}"`, 'approval');
      saveDb(db);
      notifyWebhook(db.settings, 'approval_requested', apr).catch(() => {});
      sendTelegramApprovalCard(db.settings, apr, agent?.name || 'MCP 에이전트').catch(() => {});
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
      worker: z.string().optional().describe('작업자 이름 (antigravity, aside 등). 권장 작업자가 맞는 것 + 아무나 가능한 것만 보여줌'),
      status: z.string().optional().describe('active(기본: 대기·진행) / open / claimed / submitted / accepted / all')
    },
    async ({ worker = '', status = 'active' }) => {
      const db = loadDb();
      const list = listRequests(db, { status, worker });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { count: list.length, routing: describeRouting(db.settings), requests: list.map((r) => ({ ...summarizeRequest(r), target: resolveTarget(db.settings, r) })), next: '처리할 요청을 claim_outsourcing_request로 잡고 요청서 지시대로 작업 후 submit_outsourcing_result로 제출. 로그인·인증 등 대표님 손이 필요하면 request_ceo_action' },
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
      worker: z.string().describe('작업자 이름 (antigravity 또는 aside 등)')
    },
    async ({ request_id, worker }) => {
      try {
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
      worker: z.string().describe('작업자 이름 (antigravity, aside 등)'),
      summary: z.string().describe('결과 요약 2~4문장'),
      document: z.string().describe('결과 문서 전문 (마크다운). 실제 확인한 사실과 추정을 구분'),
      pr_url: z.string().optional().describe('코드 작업 PR 주소 (https://github.com/owner/repo/pull/번호)')
    },
    async ({ request_id, worker, summary, document, pr_url = '' }) => {
      try {
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

  return server;
}

/**
 * Stateless Official MCP Streamable HTTP handler for Node req/res
 */
export async function handleOfficialMcpHttp(req, res, parsedBody) {
  const db = loadDb();
  const expectedToken = db.settings?.mcpToken;
  const authHeader = req.headers.authorization || '';

  if (authHeader && expectedToken) {
    const provided = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (provided && provided !== expectedToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsedBody?.id ?? null,
          error: { code: -32001, message: 'Invalid MCP Bearer token' }
        })
      );
      return;
    }
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
