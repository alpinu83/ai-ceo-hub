import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { loadDb, saveDb, appendLog, recordAgentHeartbeat, uid } from './store.js';
import { notifyWebhook } from './orchestrator.js';
import { sendTelegramApprovalCard } from './telegram.js';
import { sendWebPushNotification } from './push.js';

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
  }
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
