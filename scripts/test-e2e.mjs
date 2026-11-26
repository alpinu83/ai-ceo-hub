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

    for (const p of [
      '/',
      '/styles.css',
      '/app.js',
      '/manifest.webmanifest',
      '/sw.js',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/vendor/marked.umd.js',
      '/vendor/lucide.min.js'
    ]) {
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
    assert.equal(resetRes.state.agents.length, 14, 'default org chart has 14 AI agents (11 core + 3 IT Maintenance Team)');

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
      'request_ceo_approval',
      'list_outsourcing_requests',
      'claim_outsourcing_request',
      'get_outsourcing_request',
      'submit_outsourcing_result',
      'request_ceo_action',
      'pass_outsourcing_request'
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
    const leadOnlyChat = await (
      await fetch(`${BASE}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '현재 진행 상황 알려줘', missionId: created.mission.id })
      })
    ).json();
    assert.equal(leadOnlyChat.replies.length, 1, 'general CEO chat without @mention should get 1 concise Team Lead reply');

    const chatRes = await (
      await fetch(`${BASE}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '@피클 @Groq 진행 상황 공유해줘', missionId: created.mission.id })
      })
    ).json();
    assert.ok(chatRes.replies.length >= 2, 'explicit multi-@mention chat should produce multi-agent replies');

    // 8b. CEO global directives + company memory shared by every AI agent, and the Team Lead follow-up run
    const jsonHeaders = { 'Content-Type': 'application/json' };
    const setRes = await (
      await fetch(`${BASE}/api/settings`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ globalDirectives: '테스트 지침: 끝나면 먼저 보고', leadEngine: { maxAutoRounds: 1, followUpMinutes: 15 } })
      })
    ).json();
    assert.equal(setRes.state.settings.globalDirectives, '테스트 지침: 끝나면 먼저 보고', 'global directives must be saved');
    assert.equal(setRes.state.settings.leadEngine.maxAutoRounds, 1, 'lead engine settings must be saved');
    const memAdd = await (
      await fetch(`${BASE}/api/memory`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ text: '배포 전에는 모바일 화면을 확인한다', missionId: created.mission.id })
      })
    ).json();
    assert.ok(memAdd.fact?.id, 'memory fact must be created');
    const memView = await (await fetch(`${BASE}/api/memory?missionId=${created.mission.id}`)).json();
    assert.ok(memView.context.includes('테스트 지침'), 'company context must include global directives');
    assert.ok(memView.context.includes('모바일 화면'), 'company context must include remembered facts');
    assert.ok(memView.facts.some((f) => f.kind === 'decision'), 'CEO approval decisions must be remembered');
    const memDel = await (await fetch(`${BASE}/api/memory/${memAdd.fact.id}`, { method: 'DELETE' })).json();
    assert.equal(memDel.ok, true, 'memory fact must be deletable');
    const followRes = await (await fetch(`${BASE}/api/lead/follow-up`, { method: 'POST' })).json();
    assert.equal(followRes.ok, true, 'team lead follow-up must run');

    // 8c. AI skills: catalog, task-based selection, custom skill, review settings
    const skillCat = await (await fetch(`${BASE}/api/skills`)).json();
    assert.ok(skillCat.builtin.length >= 8, 'built-in skill library must be available');
    const prevCode = await (
      await fetch(`${BASE}/api/skills/preview`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: '푸터 저작권 문구 추가', description: 'HTML 푸터 코드 수정', agentId: 'agent_it_dev' })
      })
    ).json();
    assert.ok(prevCode.skills.some((s) => s.id === 'code_patch'), 'code tasks must get the code_patch skill');
    assert.ok(prevCode.skills.some((s) => s.id === 'core_operating'), 'core skill always applies');
    const prevTax = await (
      await fetch(`${BASE}/api/skills/preview`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: '양도소득세 계산기 세율 점검' })
      })
    ).json();
    assert.ok(prevTax.skills.some((s) => s.id === 'korean_tax_accuracy'), 'tax tasks must get the tax accuracy skill');
    const customRes = await (
      await fetch(`${BASE}/api/skills/custom`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ name: '브랜드 톤', keywords: '블로그, 카피', instructions: '1. 존댓말 2. 문장은 짧게' })
      })
    ).json();
    assert.ok(customRes.skill?.id, 'custom skill must be created');
    const prevCustom = await (
      await fetch(`${BASE}/api/skills/preview`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ title: '블로그 카피 작성' }) })
    ).json();
    assert.ok(prevCustom.skills.some((s) => s.id === customRes.skill.id), 'custom skill must be selected by its keywords');
    const skillSet = await (
      await fetch(`${BASE}/api/settings`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({
          skills: { reviewMode: 'always', minScore: 9 },
          leadEngine: { advanceMode: 'propose' },
          telegram: { notify: { reports: false, quiet: { enabled: true, start: '23:00', end: '07:30' } } }
        })
      })
    ).json();
    assert.equal(skillSet.state.settings.skills.reviewMode, 'always', 'review mode must be saved');
    assert.equal(skillSet.state.settings.leadEngine.advanceMode, 'propose', 'advance mode must be saved');
    assert.equal(skillSet.state.settings.telegram.notify.reports, false, 'telegram report toggle must be saved');
    assert.equal(skillSet.state.settings.telegram.notify.quiet.end, '07:30', 'quiet hours must be saved');
    await fetch(`${BASE}/api/skills/custom/${customRes.skill.id}`, { method: 'DELETE' });

    // 8d. GA4 · Search Console read-only integration: not configured by default, rejects malformed keys
    const analyticsRes = await (await fetch(`${BASE}/api/analytics`)).json();
    assert.equal(analyticsRes.status.hasKey, false, 'analytics must be unconfigured by default');
    assert.equal(analyticsRes.text, '', 'no analytics context without a key');
    const badKey = await fetch(`${BASE}/api/settings`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ providers: { googleData: { apiKey: 'not-json', ga4PropertyId: '123' } } })
    });
    assert.equal(badKey.status, 400, 'malformed service account key must be rejected');
    const goodCfg = await (
      await fetch(`${BASE}/api/settings`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ providers: { googleData: { ga4PropertyId: '565386086', searchConsoleSite: 'https://korea-tax-cal.com/' } } })
      })
    ).json();
    assert.equal(goodCfg.state.settings.providers.googleData.ga4PropertyId, '565386086', 'GA4 property id must be saved');

    // 8e. Mission scope (focus / excluded work) is saved and shown to every AI call for that mission
    const scopeRes = await (
      await fetch(`${BASE}/api/missions/${created.mission.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ scope: { focus: '새 수익 파이프라인', exclude: ['korea-tax-cal', '세금계산기'] } })
      })
    ).json();
    const scoped = scopeRes.state.missions.find((m) => m.id === created.mission.id);
    assert.deepEqual(scoped.scope.exclude, ['korea-tax-cal', '세금계산기'], 'mission scope must be saved');
    const scopedCtx = await (await fetch(`${BASE}/api/memory?missionId=${created.mission.id}`)).json();
    assert.ok(scopedCtx.context.includes('하지 말 것'), 'mission scope must be in the AI context');

    // 8f. Mission goal (metric / target / deadline) is saved and becomes the yardstick in every AI call
    const goalRes = await (
      await fetch(`${BASE}/api/missions/${created.mission.id}`, {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({ goal: { objective: '첫 수익', metric: '월 수익', unit: '원', current: 0, baseline: 0, target: 1000000, deadline: '2027-03-31' } })
      })
    ).json();
    const goaled = goalRes.state.missions.find((m) => m.id === created.mission.id);
    assert.equal(goaled.goal.target, 1000000, 'mission goal must be saved');
    const goalCtx = await (await fetch(`${BASE}/api/memory?missionId=${created.mission.id}`)).json();
    assert.ok(goalCtx.context.includes('남은 차이'), 'mission goal must be in the AI context');

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

    // 10. Async External Agent HTTPS Inbox (Pickle / Vooy real pull, flexible POST, & heartbeat tracking)
    const inboxRes = await fetch(`${BASE}/api/agent-inbox/pickle?token=${encodeURIComponent(mcpToken)}`);
    const inbox = await inboxRes.json();
    assert.equal(inboxRes.status, 200, 'agent inbox GET should return 200');
    assert.equal(inbox.ok, true);
    assert.equal(inbox.agent.id, 'agent_pickle');

    const replyRes = await fetch(`${BASE}/api/agent-inbox/pickle?token=${encodeURIComponent(mcpToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '알렉스입니다! 식당 3곳 전화 확인 완료했습니다. 예약금 3만원 결제 전 승인 부탁드립니다.',
        requestApproval: true,
        approvalTitle: '피클(알렉스) 식당 예약 승인',
        estimatedCostKRW: 30000
      })
    });
    const replyData = await replyRes.json();
    assert.equal(replyRes.status, 200, 'agent inbox direct POST should return 200');
    assert.equal(replyData.ok, true);
    assert.ok(replyData.postedMessageId);
    assert.ok(replyData.approvalId);

    const stateAfterPickle = await (await fetch(`${BASE}/api/state`)).json();
    assert.ok(stateAfterPickle.agentConnections?.agent_pickle?.lastSeenAt, 'Pickle heartbeat must be recorded');

    // 11. Deleting a mission also deletes its meeting room messages
    const delRes = await (await fetch(`${BASE}/api/missions/${created.mission.id}`, { method: 'DELETE' })).json();
    const leftoverMsgs = (delRes.state.messages || []).filter((m) => m.missionId === created.mission.id);
    assert.equal(leftoverMsgs.length, 0, 'deleting a mission must delete its meeting room messages');

    // 12. Native Web Push VAPID public key auto-generation
    const pushKeyRes = await (await fetch(`${BASE}/api/push/public-key`)).json();
    assert.equal(pushKeyRes.ok, true, 'push public-key must return ok');
    assert.ok(pushKeyRes.publicKey && pushKeyRes.publicKey.length > 40, 'VAPID publicKey must be generated');

    // 13. Continuous Project loop (Phase 1 -> Team Lead proposes Phase 2 -> CEO approves -> Phase 2 tasks launched)
    const projCreated = await (
      await fetch(`${BASE}/api/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '지속 성장 프로젝트 테스트',
          domain: 'business',
          mode: 'project',
          directive: '웹사이트 트래픽과 수익을 단계적으로 키우는 장기 전략을 실행해줘'
        })
      })
    ).json();
    assert.equal(projCreated.mission.mode, 'project', 'mission mode must be project');
    assert.equal(projCreated.mission.phase, 1, 'initial phase must be 1');

    const propRes = await (
      await fetch(`${BASE}/api/missions/${projCreated.mission.id}/propose-next`, { method: 'POST' })
    ).json();
    assert.equal(propRes.approval?.kind, 'next_phase', 'proposal approval must be kind=next_phase');
    assert.equal(propRes.approval?.proposedPhase, 2, 'proposedPhase must be 2');

    const approvePhase2 = await (
      await fetch(`${BASE}/api/approvals/${propRes.approval.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', ceoNote: '광고비 0원 조건 유지해줘' })
      })
    ).json();
    const updatedProj = approvePhase2.state.missions.find((m) => m.id === projCreated.mission.id);
    assert.equal(updatedProj.phase, 2, 'approving next_phase must advance project to phase 2');
    const phase2Tasks = approvePhase2.state.tasks.filter(
      (t) => t.missionId === projCreated.mission.id && Number(t.phase) === 2
    );
    assert.ok(phase2Tasks.length >= 2, 'Phase 2 must automatically create follow-up tasks');

    // 외부 AI 외주 창구: 요청 → 목록 → 잡기 → 요청서 → 결과 제출 → 반영
    const outCreated = await (
      await fetch(`${BASE}/api/outsourcing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '외주 테스트 리서치', kind: 'research', goal: '테스트용 외주 요청입니다. 결과 문서를 제출해 주세요.', worker: 'any' })
      })
    ).json();
    assert.ok(/^OUT-/.test(outCreated.request?.id || ''), 'outsourcing request id should start with OUT-');
    const outId = outCreated.request.id;
    const tokQ = `token=${encodeURIComponent(mcpToken)}`;
    const outDenied = await fetch(`${BASE}/api/outsourcing`);
    assert.equal(outDenied.status, 401, 'outsourcing list must require a token');
    const outList = await (await fetch(`${BASE}/api/outsourcing?${tokQ}`)).json();
    assert.ok(outList.requests.some((r) => r.id === outId), 'open request should be listed');
    const claimed = await (
      await fetch(`${BASE}/api/outsourcing/${outId}/claim?${tokQ}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: 'antigravity' }) })
    ).json();
    assert.equal(claimed.ok, true, 'claim should succeed');
    assert.ok(claimed.packet.includes(outId) && claimed.packet.includes('제출 방법'), 'packet should include id and submit instructions');
    const doubleClaim = await fetch(`${BASE}/api/outsourcing/${outId}/claim?${tokQ}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: 'aside' }) });
    assert.equal(doubleClaim.status, 409, 'another worker must not claim a leased request');
    const submitted = await (
      await fetch(`${BASE}/api/outsourcing/${outId}/submit?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker: 'antigravity', summary: '테스트 결과', document: '# 결과\n외주 테스트 결과 문서입니다. 확인한 사실과 추정을 구분했습니다.' })
      })
    ).json();
    assert.equal(submitted.ok, true, 'submit should succeed');
    // 라우팅·대표님 개입·재개
    const routeRes = await (await fetch(`${BASE}/api/outsourcing/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routing: 'antigravity' }) })).json();
    assert.equal(routeRes.routing.target, 'antigravity', 'routing should switch to antigravity');
    const out2 = await (await fetch(`${BASE}/api/outsourcing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '로그인 필요 테스트', kind: 'browser', goal: '콘솔에서 설정 상태를 확인해 주세요 (테스트).' }) })).json();
    const asideList = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=aside`)).json();
    assert.ok(!asideList.requests.some((r) => r.id === out2.request.id), 'aside must not see antigravity-routed requests');
    const agList = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=antigravity`)).json();
    assert.ok(agList.requests.some((r) => r.id === out2.request.id), 'antigravity should see its requests');
    const needCeo = await (await fetch(`${BASE}/api/outsourcing/${out2.request.id}/need-ceo?${tokQ}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: 'antigravity', action: '콘솔 로그인 필요' }) })).json();
    assert.equal(needCeo.ok, true, 'need-ceo should succeed');
    const resumed = await (await fetch(`${BASE}/api/outsourcing/${out2.request.id}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: 'aside' }) })).json();
    const out2Row = resumed.state.outsourcing.find((r) => r.id === out2.request.id);
    assert.equal(out2Row.status, 'open', 'resume should reopen the request');
    assert.equal(out2Row.pinnedWorker, 'aside', 'resume with worker should pin it');
    await fetch(`${BASE}/api/outsourcing/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routing: 'auto' }) });
    // 역할 분담: 자문·리서치·문서는 Gemini 앱, 코드는 Antigravity. Gemini가 못 하는 일은 넘김
    const out3 = await (await fetch(`${BASE}/api/outsourcing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '경쟁 사이트 리서치', kind: 'research', goal: '경쟁 계산기 사이트 5곳의 기능과 광고 배치를 조사' }) })).json();
    const gmList = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=gemini`)).json();
    assert.ok(gmList.requests.some((r) => r.id === out3.request.id), 'gemini should see research requests by default');
    assert.equal(gmList.routing.byKind.code.worker, 'antigravity', 'code stays with antigravity');
    const passRes = await (
      await fetch(`${BASE}/api/mcp?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'pass_outsourcing_request', arguments: { request_id: out3.request.id, worker: 'gemini', to: 'aside', reason: '로그인이 필요한 페이지라 넘김' } } })
      })
    ).json();
    assert.ok(passRes.result && !passRes.result.isError, 'pass tool should succeed');
    const asideList2 = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=aside`)).json();
    assert.ok(asideList2.requests.some((r) => r.id === out3.request.id), 'passed request should go to aside');
    const roleSave = await (await fetch(`${BASE}/api/outsourcing/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles: { code: 'gemini', consult: 'aside' } }) })).json();
    assert.equal(roleSave.routing.roles.code, 'antigravity', 'gemini cannot be assigned code work');
    assert.equal(roleSave.routing.roles.consult, 'aside', 'role change should be saved');
    await fetch(`${BASE}/api/outsourcing/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roles: { consult: 'gemini' } }) });
    // 종류별 우선순위 저장
    const prioSave = await (await fetch(`${BASE}/api/outsourcing/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priorities: { research: ['aside', 'gemini'], browser: ['gemini', 'aside'] }, waitMinutes: 60 }) })).json();
    assert.equal(prioSave.routing.byKind.research.worker, 'aside', 'priority 1 should be used');
    assert.deepEqual(prioSave.routing.priorities.browser, ['aside'], 'gemini cannot take browser work');
    assert.equal(prioSave.routing.waitMinutes, 60);
    await fetch(`${BASE}/api/outsourcing/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priorities: { research: ['gemini', 'aside', 'antigravity'], browser: ['aside', 'antigravity'] }, waitMinutes: 30 }) });
    // 난이도별 목록 (Gemini Neon/Hydrogen 예약이 나눠 처리)
    const lightList = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&effort=light`)).json();
    assert.ok(lightList.requests.every((r) => r.effort === 'light'), 'effort filter should work');
    const effRes = await (await fetch(`${BASE}/api/outsourcing/${out3.request.id}/effort`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ effort: 'deep' }) })).json();
    assert.equal(effRes.state.outsourcing.find((r) => r.id === out3.request.id)?.effort, 'deep', 'CEO can set effort');

    const afterOut = await (await fetch(`${BASE}/api/state`)).json();
    const outRow = (afterOut.outsourcing || []).find((r) => r.id === outId);
    assert.equal(outRow?.status, 'accepted', 'submitted outsourcing result should be accepted');

    // Clean reset after tests
    await fetch(`${BASE}/api/reset`, { method: 'POST' });
    console.log('✅ All AI CEO Hub E2E tests (REST + Continuous Project Loop + Team Lead Chat + Official MCP SDK + Async Pickle HTTPS Inbox + Heartbeat + Cascade Delete + Web Push + Telegram) passed!');
  } finally {
    child.kill('SIGTERM');
  }
}

runTests().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
