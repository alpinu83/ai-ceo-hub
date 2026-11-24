import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const TEST_PORT = 3599;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not become healthy in time');
}

async function runTests() {
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(TEST_PORT), TELEGRAM_POLLING: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer();

    // 1. Health check & static + vendor bundles
    const health = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(health.ok, true, 'health.ok should be true');

    for (const p of ['/', '/styles.css', '/app.js', '/vendor/marked.umd.js', '/vendor/lucide.min.js']) {
      const r = await fetch(`${BASE}${p}`);
      assert.equal(r.status, 200, `GET ${p} must return 200`);
    }

    // 2. Open-source stack & deploy exports
    const oss = await (await fetch(`${BASE}/api/oss-stack`)).json();
    assert.ok(oss.builtIn.length >= 4, 'builtIn OSS stack must have >=4 entries');
    for (const exp of ['litellm', 'docker-compose', 'railway', 'render']) {
      const r = await fetch(`${BASE}/api/exports/${exp}`);
      assert.equal(r.status, 200, `Export ${exp} must return 200`);
    }

    // 3. Initial state & reset
    const resetRes = await (await fetch(`${BASE}/api/reset`, { method: 'POST' })).json();
    const mcpToken = resetRes.state.settings.mcpToken;
    assert.equal(resetRes.state.agents.length, 9, 'default org chart has 9 AI agents including LG K-EXAONE 2.5');

    // 4. Create mission & parallel run-all
    const created = await (
      await fetch(`${BASE}/api/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'CI 자동화 검증 미션',
          domain: 'business',
          costPolicy: 'balanced',
          directive: '제안서 초안을 만들고 매일 아침 경쟁사 브리핑 세팅하고 식당 예약 준비해줘'
        })
      })
    ).json();
    assert.ok(created.tasks.length >= 3, 'lead should decompose directive into >=3 tasks');

    const runAll = await (
      await fetch(`${BASE}/api/missions/${created.mission.id}/run-all`, { method: 'POST' })
    ).json();
    assert.ok(runAll.ranCount >= 3, 'run-all should execute queued tasks');

    // 5. Official @modelcontextprotocol/sdk Streamable HTTP tests
    const mcpHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${mcpToken}`
    };

    const toolsRes = await (
      await fetch(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      })
    ).json();
    const toolNames = toolsRes.result.tools.map((t) => t.name);
    assert.deepEqual(toolNames, [
      'get_company_brief',
      'list_my_tasks',
      'submit_task_result',
      'request_ceo_approval'
    ]);

    const briefRes = await (
      await fetch(`${BASE}/api/mcp`, {
        method: 'POST',
        headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_company_brief', arguments: {} }
        })
      })
    ).json();
    const brief = JSON.parse(briefRes.result.content[0].text);
    assert.ok(brief.pendingApprovals >= 1, 'should report pending approvals via MCP');

    // 6. CEO approval decision updates status
    const pendingApr = runAll.state.approvals.find((a) => a.status === 'pending');
    assert.ok(pendingApr, 'must have a pending approval');
    const decRes = await (
      await fetch(`${BASE}/api/approvals/${pendingApr.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', ceoNote: 'CI 테스트 승인' })
      })
    ).json();
    assert.equal(decRes.approval.status, 'approved');

    // 7. Team Lead final synthesis
    const synthRes = await (
      await fetch(`${BASE}/api/missions/${created.mission.id}/synthesize`, { method: 'POST' })
    ).json();
    assert.ok(synthRes.report.length > 50, 'synthesized executive report should be non-empty');

    // 8. Live Office Chat & Team Standup tests
    const chatRes = await (
      await fetch(`${BASE}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '@피클 @Claude 진행 상황 공유해줘', missionId: created.mission.id })
      })
    ).json();
    assert.ok(chatRes.replies.length >= 2, 'chat should produce multi-agent replies');

    const standupRes = await (
      await fetch(`${BASE}/api/missions/${created.mission.id}/standup`, { method: 'POST' })
    ).json();
    assert.ok(standupRes.turns.length >= 4, 'standup should generate multi-turn team conversation');

    // 9. Telegram webhook endpoint responds gracefully
    const tgRes = await fetch(`${BASE}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update_id: 999 })
    });
    assert.equal(tgRes.status, 200, 'Telegram webhook should acknowledge updates with 200');

    // 10. Async External Agent HTTPS Inbox (Pickle / Vooy real pull & post)
    const inboxRes = await fetch(`${BASE}/api/agent-inbox/pickle?token=${encodeURIComponent(mcpToken)}`);
    const inbox = await inboxRes.json();
    assert.equal(inboxRes.status, 200, 'agent inbox GET should return 200');
    assert.equal(inbox.ok, true);
    assert.equal(inbox.agent.id, 'agent_pickle');

    const replyRes = await fetch(`${BASE}/api/agent-inbox/pickle/reply?token=${encodeURIComponent(mcpToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '알렉스입니다! 성수역 식당 3곳 전화 확인 완료했습니다. 예약금 3만원 결제 전 승인 부탁드립니다.',
        requestApproval: true,
        approvalTitle: '피클(알렉스) 성수역 식당 예약 승인',
        estimatedCostKRW: 30000
      })
    });
    const replyData = await replyRes.json();
    assert.equal(replyRes.status, 200, 'agent inbox POST reply should return 200');
    assert.equal(replyData.ok, true);
    assert.ok(replyData.postedMessageId);
    assert.ok(replyData.approvalId);

    // Clean reset after tests
    await fetch(`${BASE}/api/reset`, { method: 'POST' });
    console.log('✅ All AI CEO Hub E2E tests (REST + Parallel + Official MCP SDK + Async Pickle/Vooy HTTPS Inbox + Live Office Chat + Standup + Telegram) passed!');
  } finally {
    child.kill('SIGTERM');
  }
}

runTests().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
