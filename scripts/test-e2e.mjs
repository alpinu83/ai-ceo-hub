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
    env: { ...process.env, PORT: String(TEST_PORT), TELEGRAM_POLLING: 'false', SHORTS_HOOK_TOKEN: 'ci-shorts-token' },
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
    const resetRes = await (await fetch(`${BASE}/api/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET-ALL-DATA' }) })).json();
    const mcpToken = resetRes.state.settings.mcpToken;
    assert.equal(resetRes.state.agents.length, 16, 'default org chart has 16 agents (11 core + 3 IT legacy + Aside·AGY dev team)');

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
      'pass_outsourcing_request',
      'list_lead_jobs',
      'claim_lead_job',
      'submit_lead_job'
    ]);

    // MCP는 토큰 필수 (헤더 없음·가짜 토큰·가짜 ?token= 모두 거부, 올바른 ?token=은 통과)
    const mcpBody = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} });
    const plainHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    assert.equal((await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: plainHeaders, body: mcpBody })).status, 401, 'MCP without token must be rejected');
    assert.equal((await fetch(`${BASE}/api/mcp?token=bogus`, { method: 'POST', headers: plainHeaders, body: mcpBody })).status, 401, 'MCP with wrong query token must be rejected');
    assert.equal((await fetch(`${BASE}/api/mcp`, { method: 'POST', headers: { ...plainHeaders, Authorization: 'Bearer bogus' }, body: mcpBody })).status, 401, 'MCP with wrong bearer must be rejected');
    assert.equal((await fetch(`${BASE}/api/mcp?token=${encodeURIComponent(mcpToken)}`, { method: 'POST', headers: plainHeaders, body: mcpBody })).status, 200, 'MCP with query token must work');

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
    const reDecide = await fetch(`${BASE}/api/approvals/${pendingApr.id}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approved' }) });
    assert.equal(reDecide.status, 409, 'already decided approvals are not processed twice');

    // 6-1. 홈 "대표님이 하실 일" 보류 작업 결정 API: 잘못된 값은 거부, 보류가 아닌 작업은 건너뜀(상태 그대로)
    const decideTaskId = created.tasks[0].id;
    const badDecision = await fetch(`${BASE}/api/tasks/ceo-decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: [decideTaskId], action: 'nope' }) });
    assert.equal(badDecision.status, 400, 'unknown CEO decision must be rejected');
    const emptyDecision = await fetch(`${BASE}/api/tasks/ceo-decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: [], action: 'retry' }) });
    assert.equal(emptyDecision.status, 400, 'CEO decision without tasks must be rejected');
    const beforeStatus = (await (await fetch(`${BASE}/api/state`)).json()).tasks.find((t) => t.id === decideTaskId)?.status;
    const notBlocked = await (
      await fetch(`${BASE}/api/tasks/ceo-decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds: [decideTaskId], action: 'drop', feedback: 'CI' }) })
    ).json();
    assert.equal(notBlocked.ok, true);
    assert.equal(notBlocked.done.length, 0, 'only blocked tasks can be decided');
    assert.equal(notBlocked.skipped.length, 1, 'non-blocked task is skipped');
    assert.equal(notBlocked.state.tasks.find((t) => t.id === decideTaskId)?.status, beforeStatus, 'skipped task status must not change');

    // 6-2. 외주 요청별 "AGY 수정 + Aside 검수" 협업 선택 → 코드 요청·Antigravity 지정·협업 표시
    const collabRes = await (
      await fetch(`${BASE}/api/outsourcing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'CI 협업 선택', goal: 'CI에서 협업 선택이 저장되는지 확인합니다.', kind: 'task', worker: 'agy_aside' }) })
    ).json();
    assert.equal(collabRes.request.kind, 'code', 'AGY+Aside collaboration is a code request');
    assert.equal(collabRes.request.pinnedWorker, 'antigravity', 'collaboration starts with Antigravity');
    assert.equal(collabRes.request.codeWorkflow, 'agy_then_aside', 'collaboration flag stored on request');
    const collabList = await (await fetch(`${BASE}/api/outsourcing?status=active&token=${encodeURIComponent(mcpToken)}`)).json();
    const collabRow = (collabList.requests || []).find((r) => r.id === collabRes.request.id);
    if (collabRow) assert.equal(collabRow.codeWorkflow, 'agy_then_aside', 'list exposes codeWorkflow');
    await fetch(`${BASE}/api/outsourcing/${collabRes.request.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

    // 6-3. 팀장 업무함: 목록·근무 상태 (CI에는 대기 일이 없어도 응답 형식 확인)
    const leadDesk = await (await fetch(`${BASE}/api/lead-jobs?worker=agy_lead&token=${encodeURIComponent(mcpToken)}`)).json();
    assert.equal(typeof leadDesk.count, 'number', 'lead desk returns count');
    assert.equal(leadDesk.status.onDuty, 'agy_lead', 'polling as agy_lead marks AGY on duty');
    const badClaim = await fetch(`${BASE}/api/lead-jobs/ldj_none/claim?token=${encodeURIComponent(mcpToken)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker: 'agy_lead' }) });
    assert.equal(badClaim.status, 400, 'unknown lead job claim is rejected');
    // 기존 Gemini API 팀장은 비상 대기 역할이고, 완전 휴직시켜도 실무 배정·팀장 슬롯이 깨지지 않아야 함
    const pauseLeadRes = await (
      await fetch(`${BASE}/api/agents/agent_gemini_neon`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false })
      })
    ).json();
    assert.equal(pauseLeadRes.agent.active, false, 'legacy API lead can be paused cleanly');
    assert.ok(pauseLeadRes.agent.roleTitle.includes('비상 대기'), 'legacy API lead roleTitle must indicate standby');
    const pausedMission = await (
      await fetch(`${BASE}/api/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '팀장 대기 확인 테스트', directive: '경쟁 사이트 현황을 조사하고 체크리스트를 정리해 주세요.', domain: 'business' })
      })
    ).json();
    assert.equal(pausedMission.mission.leadAgentId, 'agent_gemini_neon', 'leadAgentId stays on lead slot even when legacy API lead is paused');
    assert.ok((pausedMission.tasks || []).every((t) => t.assigneeId !== 'agent_gemini_neon'), 'legacy API lead must never receive worker tasks');
    await fetch(`${BASE}/api/missions/${pausedMission.mission.id}`, { method: 'DELETE' });
    await fetch(`${BASE}/api/agents/agent_gemini_neon`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true })
    });

    // 7. Team Lead final synthesis
    const synthRes = await (
      await fetch(`${BASE}/api/missions/${created.mission.id}/synthesize`, { method: 'POST' })
    ).json();
    assert.ok(synthRes.report.length > 50, 'synthesized executive report should be non-empty');

    // 8. Live Office Chat & Team Standup tests
    const beforeQuickMissions = (await (await fetch(`${BASE}/api/state`)).json()).missions.length;
    const quickRes = await (
      await fetch(`${BASE}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '앞으로 모든 보고서 첫 줄에 핵심 결론을 적어줘', missionId: '', quickOrder: true })
      })
    ).json();
    assert.equal(quickRes.state.missions.length, beforeQuickMissions, 'quickOrder (전체 시스템) must NOT create a new standalone mission');
    assert.ok((quickRes.intake?.note || quickRes.memoryNote || '').length > 0, 'quickOrder must record directive/intervention note');

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
          leadEngine: { maxAutoRounds: 2 },
          telegram: { notify: { reports: false, quiet: { enabled: true, start: '23:00', end: '07:30' } } }
        })
      })
    ).json();
    assert.equal(skillSet.state.settings.skills.reviewMode, 'always', 'review mode must be saved');
    assert.equal(skillSet.state.settings.leadEngine.maxAutoRounds, 2, 'lead engine settings must be saved');
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

    // 9-1. 결재 성과품 묶음 (텔레그램 📎 버튼·/doc 명령이 파일로 보내는 문서)
    const { buildApprovalDeliverable } = await import('../src/hub/deliverables.js');
    const fakeDb = {
      missions: [{ id: 'msn_t', title: '테스트 업무', deliverables: [{ taskId: 'tsk_t2' }] }],
      agents: [{ id: 'agent_t', name: '기획 팀원' }],
      tasks: [
        { id: 'tsk_t1', title: '랜딩 시안', assigneeId: 'agent_t', output: '# 시안\n헤드라인 A/B' },
        { id: 'tsk_t2', title: '실행 계획서', output: '1주차: 색인 요청' }
      ],
      outsourcing: [{ id: 'OUT-T', title: '자문', approvalId: 'apr_t1', result: { by: 'aside', summary: '수정 후 승인', document: '근거 문서' } }],
      approvals: [
        { id: 'apr_t1', missionId: 'msn_t', taskId: 'tsk_t1', title: '랜딩 시안 승인', summary: '요약', proposedAction: '게시', status: 'pending' },
        { id: 'apr_t2', missionId: 'msn_t', kind: 'stage_gate', title: '관문', summary: 's', status: 'pending' },
        { id: 'apr_t3', missionId: 'msn_t', kind: 'next_phase', title: '다음 단계', summary: 's', proposedSteps: ['A', 'B'], kpi: '노출 100', status: 'pending' },
        { id: 'apr_t4', missionId: 'msn_t', title: '요약만', summary: 's', status: 'pending' }
      ]
    };
    const d1 = buildApprovalDeliverable(fakeDb, 'apr_t1');
    assert.ok(d1.markdown.includes('헤드라인 A/B') && d1.markdown.includes('근거 문서'), 'task output and outsourcing result must be bundled');
    assert.equal(d1.sectionCount, 2);
    assert.equal(d1.filename, 'deliverable-apr_t1.md');
    assert.ok(buildApprovalDeliverable(fakeDb, 'apr_t2').markdown.includes('1주차: 색인 요청'), 'stage gate must bundle mission deliverables');
    assert.ok(buildApprovalDeliverable(fakeDb, 'apr_t3').markdown.includes('노출 100'), 'next phase plan must be included');
    assert.equal(buildApprovalDeliverable(fakeDb, 'apr_t4').sectionCount, 0, 'summary-only approval has nothing to attach');
    assert.equal(buildApprovalDeliverable(fakeDb, 'nope'), null);

    // 9-2. 팀장 완료 보고 가독성 + 체크리스트 인라인 추출 + 성과품 번들 검증
    const { buildCompletionReport, extractChecklistItems } = await import('../src/lead-engine.js');
    const { buildReportDeliverableBundle } = await import('../src/hub/deliverables.js');
    const sampleShortsOutput = [
      '# 유튜브 쇼츠 제작 프로세스 내재화 기획',
      '외주 편집비 0원을 전제로 AI 3단계 파이프라인을 구축합니다.',
      '',
      '## 대표님 실행 체크리스트',
      '- [ ] 유튜브 채널 개설 및 업로드 권한 확인',
      '- [ ] AI 영상 편집 도구 계정 연결 확정',
      '- [ ] 첫 주 쇼츠 주제 3건 승인'
    ].join('\n');
    const extractedCk = extractChecklistItems(sampleShortsOutput);
    assert.equal(extractedCk.length, 3, 'should extract all 3 checklist items');
    const repDb = {
      missions: [{ id: 'msn_s', title: '유튜브 쇼츠', finalReport: '가이드라인 수립이 완료되었습니다.\n실행 환경 확정이 필요합니다.' }],
      agents: [{ id: 'ag_q', name: 'Qwen 3.8 (Groq)' }],
      tasks: [{ id: 'tsk_s1', missionId: 'msn_s', assigneeId: 'ag_q', title: '유튜브 쇼츠 제작 프로세스 내재화 기획', status: 'completed', output: sampleShortsOutput, updatedAt: new Date().toISOString() }],
      approvals: []
    };
    const rep = buildCompletionReport(repDb, 'msn_s', ['tsk_s1'], {
      attachedApprovalTitle: '[성과품·체크리스트 확인] 유튜브 쇼츠',
      telegramDocIncluded: true
    });
    assert.ok(rep.text.includes('☑️ 대표님 확인 · 실행 체크리스트'), 'report should include checklist heading');
    assert.ok(rep.text.includes('- [ ] 유튜브 채널 개설 및 업로드 권한 확인'), 'report should inline checklist items');
    assert.ok(rep.text.includes('결재함 첨부 완료'), 'report should mention approval attachment');
    assert.ok(rep.telegramHtml.includes('<b>📌 완료된 작업</b>') && rep.telegramHtml.includes('☐ 유튜브 채널 개설'), 'telegramHtml should format bold headings and checkboxes');
    assert.equal(rep.reviewTasks.length, 1, 'deliverable task should be flagged for CEO review');
    const bundle = buildReportDeliverableBundle(repDb, repDb.missions[0], rep.reviewTasks, rep.checklistItems);
    assert.ok(bundle && bundle.markdown.includes('유튜브 채널 개설') && bundle.markdown.includes('AI 3단계 파이프라인'), 'report deliverable bundle should include checklist and full draft');

    // 9-3. 모든 결재 유형(일반 업무·관문·다음 단계)에 성과품·체크리스트 자동 첨부 검증
    const { enrichApprovalDeliverables } = await import('../src/hub/deliverables.js');
    const univDb = {
      missions: [{ id: 'msn_u', title: '앱인토스 런칭', deliverables: [{ taskId: 'tsk_u1' }] }],
      agents: [{ id: 'ag_u', name: '전략 팀원' }],
      tasks: [
        { id: 'tsk_u1', missionId: 'msn_u', milestoneId: 'ms_1', assigneeId: 'ag_u', title: '미니앱 기획서 및 심사 시안', status: 'completed', output: '## 핵심 기획\n앱인토스 미니앱 초안\n## 체크리스트\n- [ ] 사업자 등록증 업로드\n- [ ] 토스 콘솔 심사 제출', updatedAt: new Date().toISOString() }
      ],
      outsourcing: [],
      approvals: [
        { id: 'apr_u_gate', missionId: 'msn_u', milestoneId: 'ms_1', kind: 'stage_gate', title: '[관문 결재] 기획 확정', summary: '관문 요약', status: 'pending' },
        { id: 'apr_u_next', missionId: 'msn_u', kind: 'next_phase', title: '다음 단계 제안', summary: '제안 요약', proposedDirective: '개발 착수', status: 'pending' }
      ]
    };
    const eg = enrichApprovalDeliverables(univDb, univDb.approvals[0]);
    assert.ok(eg.changed && univDb.approvals[0].taskIds.includes('tsk_u1'), 'stage_gate must auto-attach milestone deliverables');
    assert.ok(univDb.approvals[0].checklist.includes('사업자 등록증 업로드'), 'stage_gate must auto-extract checklist items');
    assert.ok(eg.deliverable.sectionCount >= 2 && eg.deliverable.markdown.includes('앱인토스 미니앱 초안'), 'deliverable bundle must include checklist + full draft');
    const en = enrichApprovalDeliverables(univDb, univDb.approvals[1]);
    assert.ok(univDb.approvals[1].taskIds.includes('tsk_u1') && en.deliverable.markdown.includes('토스 콘솔 심사 제출'), 'next_phase approval must also auto-attach mission deliverables & checklist');

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

    // 13. 지속 프로젝트: 단계별 제안서(구버전) 없이 작전 계획 운영 사이클로만 진행, 결재는 한 번만 처리
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
    const legacyRoute = await fetch(`${BASE}/api/missions/${projCreated.mission.id}/propose-next`, { method: 'POST' });
    assert.ok(legacyRoute.status === 404 || legacyRoute.status === 405, 'legacy phase proposal endpoint is removed');
    const cycleRes = await fetch(`${BASE}/api/missions/${projCreated.mission.id}/ops-cycle`, { method: 'POST' });
    assert.equal(cycleRes.status, 200, 'ops cycle can be triggered');
    const replanRes = await fetch(`${BASE}/api/missions/${projCreated.mission.id}/replan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: '검색 노출 개선에 집중' }) });
    assert.equal(replanRes.status, 200, 'CEO can order a re-plan');
    const afterCycle = await (await fetch(`${BASE}/api/state`)).json();
    assert.ok(
      !afterCycle.approvals.some((a) => a.missionId === projCreated.mission.id && a.kind === 'next_phase'),
      'projects never create phase proposal approvals'
    );

    // 유튜브 쇼츠: 후보 수집(제작기) → 대표님 선택 → 대본 결재 → 제작 대기열 → 제작기 결과 보고
    const SH = { 'Content-Type': 'application/json', 'x-shorts-token': 'ci-shorts-token' };
    const denied = await fetch(`${BASE}/api/shorts/hook/candidates`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-shorts-token': 'wrong' }, body: '{}' });
    assert.equal(denied.status, 401, 'shorts hook rejects a wrong token');
    const shortsMission = await (
      await fetch(`${BASE}/api/missions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '유튜브 쇼츠 테스트', domain: 'business', mode: 'project', directive: '정치 뉴스 쇼츠 채널 운영' }) })
    ).json();
    const ing = await (
      await fetch(`${BASE}/api/shorts/hook/candidates`, { method: 'POST', headers: SH, body: JSON.stringify({ batch: 'ci', notify: false, items: [{ title: '국회 예산안 처리 논란', url: 'https://example.com/a', source: '예시일보', coverage: 5, kind: 'news', publishedAt: new Date().toISOString() }, { title: '국회 예산안 처리 논란', url: 'https://example.com/b' }, { title: '유튜브 영상만 있는 이슈', url: 'https://www.youtube.com/watch?v=x', kind: 'youtube', views: 999 }] }) })
    ).json();
    assert.equal(ing.added, 1, 'duplicate titles are merged');
    // 다른 채널 유튜브 영상만 있는 후보는 쓰지 않음 (기사 없으면 제외)
    const shList = await (await fetch(`${BASE}/api/shorts`)).json();
    assert.equal(shList.missionId, shortsMission.mission.id, 'shorts project is detected by title');
    const pick = await (await fetch(`${BASE}/api/shorts/candidates/${shList.candidates[0].id}/pick`, { method: 'POST' })).json();
    assert.ok(pick.taskId, 'picking a candidate creates a script task');
    const scriptOut = '대본\n```json\n{"title":"예산안 30초 정리","scenes":[{"text":"예산안이 또 늦어졌습니다.","keywords":"parliament"},{"text":"보도에 따르면 쟁점은 세 가지입니다.","keywords":"documents"},{"text":"제 생각은 이렇습니다.","keywords":"city night"}],"sources":["https://example.com/a"],"hashtags":["#정치"]}\n```';
    await fetch(`${BASE}/api/tasks/${pick.taskId}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ output: scriptOut }) });
    const stShorts = await (await fetch(`${BASE}/api/state`)).json();
    const scriptApr = stShorts.approvals.find((a) => a.taskId === pick.taskId && a.status === 'pending');
    assert.ok(scriptApr, 'script goes to the approval box');
    await fetch(`${BASE}/api/approvals/${scriptApr.id}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approved' }) });
    const claim = await (await fetch(`${BASE}/api/shorts/hook/claim`, { method: 'POST', headers: SH, body: '{}' })).json();
    assert.equal(claim.jobs.length, 1, 'approved script becomes a render job');
    assert.equal(claim.jobs[0].script.scenes.length, 3, 'scenes parsed from the JSON block');
    const claimAgain = await (await fetch(`${BASE}/api/shorts/hook/claim`, { method: 'POST', headers: SH, body: '{}' })).json();
    assert.equal(claimAgain.jobs.length, 0, 'a claimed job is not handed out twice');
    const done = await (await fetch(`${BASE}/api/shorts/hook/jobs/${claim.jobs[0].id}/result`, { method: 'POST', headers: SH, body: JSON.stringify({ ok: true, videoId: 'abc123', privacy: 'private' }) })).json();
    assert.equal(done.status, 'uploaded', 'render result is recorded');

    // 대표님 할 일: 모든 프로젝트에서 대표님 때문에 멈춘 일
    const ceoInbox = await (await fetch(`${BASE}/api/ceo-inbox`)).json();
    const stInbox = await (await fetch(`${BASE}/api/state`)).json();
    const pendingCount = stInbox.approvals.filter((a) => a.status === 'pending').length;
    assert.ok(ceoInbox.items.filter((i) => ['approval', 'gate'].includes(i.kind)).length === pendingCount, 'every pending approval is in the CEO to-do list');
    assert.ok(ceoInbox.items.every((i, k, arr) => k === 0 || arr[k - 1].ageHours >= i.ageHours), 'oldest waiting first');

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

    // 10. 2단계 코드 협업 (AGY 수정 + Aside 검수·보완 + 반려 재수정 루프)
    const twoStageRoute = await (
      await fetch(`${BASE}/api/outsourcing/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routing: 'auto', codeWorkflow: 'agy_then_aside' })
      })
    ).json();
    assert.equal(twoStageRoute.routing.codeWorkflow, 'agy_then_aside', 'codeWorkflow should save as agy_then_aside');
    assert.equal(twoStageRoute.routing.byKind.code.worker, 'antigravity', 'stage 1 code worker should be antigravity');
    assert.ok(twoStageRoute.routing.byKind.code.label.includes('Aside'), 'code label should show 2-stage Aside review');

    const codeReqCreated = await (
      await fetch(`${BASE}/api/outsourcing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '2단계 코드 협업 테스트', kind: 'code', goal: '테스트 기능 추가 후 PR을 열어 주세요.', worker: 'any' })
      })
    ).json();
    const codeReqId = codeReqCreated.request.id;
    const agCodeList = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=antigravity`)).json();
    assert.ok(agCodeList.requests.some((r) => r.id === codeReqId), 'antigravity should see stage-1 code request');
    const asideBeforeCode = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=aside`)).json();
    assert.ok(!asideBeforeCode.requests.some((r) => r.id === codeReqId), 'aside must not see stage-1 code request before AGY submits');

    const agClaim = await (
      await fetch(`${BASE}/api/outsourcing/${codeReqId}/claim?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker: 'antigravity' })
      })
    ).json();
    assert.ok(agClaim.packet.includes('1단계 코드 수정') && agClaim.packet.includes('4단계'), 'stage-1 packet must include 2-stage & 4-step rules');

    const testPrUrl = 'https://github.com/alpinu83/ai-ceo-hub/pull/999';
    const agSubmit = await (
      await fetch(`${BASE}/api/outsourcing/${codeReqId}/submit?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worker: 'antigravity',
          summary: '1차 수정 완료 및 테스트 통과',
          document: '변경 파일과 테스트 결과를 PR 본문에 남겼습니다. 1차 수정 완료 보고서입니다.',
          prUrl: testPrUrl
        })
      })
    ).json();
    assert.equal(agSubmit.ok, true, 'AGY stage-1 submit should succeed');
    assert.equal(agSubmit.request.status, 'accepted', 'stage-1 request should be accepted after handoff');
    assert.equal(agSubmit.request.reviewStage, 'handed_to_aside', 'stage-1 should record handed_to_aside');
    const reviewId = agSubmit.request.reviewRequestId;
    assert.ok(/^OUT-/.test(reviewId || ''), 'stage-2 Aside review request must be auto-created');

    const asideReviewList = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=aside`)).json();
    const reviewItem = asideReviewList.requests.find((r) => r.id === reviewId);
    assert.ok(reviewItem, 'Aside polling must immediately see stage-2 review request');
    assert.equal(reviewItem.reviewStage, 'aside_review', 'stage-2 reviewStage must be aside_review');
    assert.equal(reviewItem.sourcePrUrl, testPrUrl, 'stage-2 must carry sourcePrUrl');
    assert.equal(reviewItem.sourceOutsourceId, codeReqId, 'stage-2 must link sourceOutsourceId');

    // Aside가 수정 지시를 붙여 AGY에게 반려 (/pass)
    const rejectRes = await (
      await fetch(`${BASE}/api/outsourcing/${reviewId}/pass?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker: 'aside', to: 'antigravity', reason: '엣지 케이스 테스트 1건 보강해 주세요.' })
      })
    ).json();
    assert.equal(rejectRes.ok, true, 'Aside /pass rejection should succeed');
    assert.equal(rejectRes.request.reviewStage, 'agy_rework', 'rejected review should enter agy_rework');
    assert.equal(rejectRes.request.reviewRound, 2, 'reviewRound should increment to 2');
    assert.equal(rejectRes.target, 'antigravity', 'rework target should be antigravity');

    // AGY가 재수정 후 다시 제출 → Aside 2차 검수로 자동 회귀
    const agReworkSubmit = await (
      await fetch(`${BASE}/api/outsourcing/${reviewId}/submit?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worker: 'antigravity',
          summary: 'Aside 지적 사항 반영 완료',
          document: '엣지 케이스 테스트 보강 후 같은 PR 브랜치에 푸시하고 npm test 통과 확인했습니다.',
          prUrl: testPrUrl
        })
      })
    ).json();
    assert.equal(agReworkSubmit.ok, true, 'AGY rework submit should succeed');
    const reviewId2 = agReworkSubmit.request.reviewRequestId;
    assert.ok(/^OUT-/.test(reviewId2 || '') && reviewId2 !== reviewId, '2nd-round Aside review request should be created');

    const asideReviewList2 = await (await fetch(`${BASE}/api/outsourcing?${tokQ}&worker=aside`)).json();
    const reviewItem2 = asideReviewList2.requests.find((r) => r.id === reviewId2);
    assert.equal(reviewItem2?.reviewStage, 'aside_review', '2nd-round reviewStage should be aside_review');
    assert.equal(reviewItem2?.reviewRound, 2, '2nd-round reviewRound should be 2');

    // Aside 최종 통과 제출 (prUrl 생략 시 sourcePrUrl 폴백 확인, 추가 루프 생성 금지)
    const asideFinalSubmit = await (
      await fetch(`${BASE}/api/outsourcing/${reviewId2}/submit?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worker: 'aside',
          summary: '2차 검수 완료 — 문제없음',
          document: '변경 파일, CI 테스트, 최근 PR 회귀 여부 모두 확인했고 이상 없어 최종 승인합니다.'
        })
      })
    ).json();
    assert.equal(asideFinalSubmit.ok, true, 'Aside final review submit should succeed');
    assert.equal(asideFinalSubmit.request.status, 'accepted', 'Aside final review should be accepted');
    assert.equal(asideFinalSubmit.request.reviewRequestId || '', '', 'Aside final submit must NOT loop again');

    // 원복 확인
    const backSingle = await (
      await fetch(`${BASE}/api/outsourcing/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routing: 'auto', codeWorkflow: 'single', priorities: { code: ['antigravity', 'aside'] } })
      })
    ).json();
    assert.equal(backSingle.routing.codeWorkflow, 'single', 'codeWorkflow should switch back to single');

    // 13. 쇼츠 JSON 본문 자동 가독화 + 결재 반려·수정 지시 피드백이 외부 봇 수신함(HTTPS/text)과 MCP에 전달되는지 검증
    const cueReply = await (
      await fetch(`${BASE}/api/agent-inbox/cue/reply?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '쇼츠 대본 초안 제출합니다.',
          deliverable:
            '채널명: 구국열사\n\n```json\n{"title":"수능 AI 커닝, 10년 제재 확정 아냐","scenes":[{"text":"첫 장면 테스트 문장입니다.","keywords":"seoul classroom"},{"text":"둘째 장면 테스트 문장입니다.","keywords":"korea parliament"}],"sources":["https://example.com/news1"],"hashtags":["#수능","#교육"]}\n```',
          requestApproval: true,
          approvalTitle: 'Cue 쇼츠 대본 승인 테스트'
        })
      })
    ).json();
    assert.equal(cueReply.ok, true, 'Cue reply should succeed');
    assert.ok(cueReply.approvalId, 'Cue reply with requestApproval should create approval');

    // 13a. formatDeliverableOutput가 단일 라인 JSON을 읽기 좋은 마크다운 본문으로 펼쳐주는지 확인
    const { formatDeliverableOutput } = await import('../src/hub/deliverables.js');
    const prettyDoc = formatDeliverableOutput(
      '채널명: 구국열사\n\n```json\n{"title":"수능 AI 커닝, 10년 제재 확정 아냐","scenes":[{"text":"첫 장면 테스트 문장입니다.","keywords":"seoul classroom"}],"sources":["https://example.com/news1"],"hashtags":["#수능"]}\n```'
    );
    assert.ok(prettyDoc.includes('### 🎬 쇼츠 대본: 수능 AI 커닝, 10년 제재 확정 아냐 (1장면)'), 'Shorts JSON should expand into readable heading');
    assert.ok(prettyDoc.includes('1. 첫 장면 테스트 문장입니다.'), 'Shorts scenes should be listed clearly');
    assert.ok(prettyDoc.includes('**해시태그**: #수능'), 'Shorts hashtags should be included');

    // 13b. 대표님 반려 사유가 Cue 수신함(JSON + text) 및 회의실 메시지로 전달되는지 확인
    const rejectReason = '첫 장면 근거 수치를 앞세우고 톤을 더 단호하게 보완해 주세요.';
    const decideRej = await (
      await fetch(`${BASE}/api/approvals/${encodeURIComponent(cueReply.approvalId)}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected', ceoNote: rejectReason })
      })
    ).json();
    assert.equal(decideRej.approval?.status, 'rejected', 'Approval rejection should succeed');

    const cueInboxJson = await (await fetch(`${BASE}/api/agent-inbox/cue?${tokQ}`)).json();
    assert.ok(
      (cueInboxJson.recentFeedback || []).some((f) => f.approvalId === cueReply.approvalId && f.decision === 'rejected' && f.reason.includes('근거 수치를 앞세우고')),
      'Cue JSON inbox must include rejection feedback and reason'
    );
    assert.ok(
      (cueInboxJson.recentMeetingRoom || []).some((m) => String(m.text || '').includes('근거 수치를 앞세우고')),
      'Cue recentMeetingRoom must include CEO rejection feedback message'
    );

    const cueInboxText = await (await fetch(`${BASE}/api/agent-inbox/cue?${tokQ}&format=text`)).text();
    assert.ok(cueInboxText.includes('최근 CEO 결재 피드백') && cueInboxText.includes('근거 수치를 앞세우고'), 'Cue text inbox must include rejection feedback');

    // 14. 봇이 결재 필요 업무를 제출하면 팀장 업무함(검수·재가공)을 반드시 거치고, 팀장의 임원 보고서(executiveSummary·refinedReport·recommendedAction)가 결재 카드와 성과품 문서에 반영되는지 검증
    const leadMission = await (
      await fetch(`${BASE}/api/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '팀장 재가공 결재 검증',
          directive: 'Cue가 경쟁 앱 동향을 조사해 승인 요청을 올리면 팀장이 재가공해 보고하는지 확인',
          domain: 'business'
        })
      })
    ).json();
    // Cue에게 배정된 승인 필요 업무 1건 확보
    const cueTask = leadMission.tasks[0];
    await fetch(`${BASE}/api/tasks/${encodeURIComponent(cueTask.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeId: 'agent_cue' })
    });
    // AGY 팀장 근무 상태 갱신 후 Cue가 결재 요청 제출 → 바로 결재함으로 직행하지 않고 review_pending으로 팀장 검토 대기
    await fetch(`${BASE}/api/lead-jobs?worker=agy_lead&${tokQ}`);
    const cueSubmitForLead = await (
      await fetch(`${BASE}/api/agent-inbox/cue/reply?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: cueTask.id,
          message: '경쟁 앱 3곳 가격·기능 초안 조사 완료했습니다.',
          deliverable: '초안 메모: A앱 월 9,900원, B앱 무료+광고, C앱 월 4,900원. 국내 검색 수요 상승 중.',
          requestApproval: true
        })
      })
    ).json();
    assert.equal(cueSubmitForLead.ok, true, 'Cue task submission should succeed');
    assert.equal(cueSubmitForLead.taskStatus, 'review_pending', 'Approval-required bot task must go through Team Lead review_pending first');
    assert.equal(cueSubmitForLead.approvalId, null, 'Approval card must NOT bypass Team Lead before review');

    // 팀장 업무함에서 검수 건을 잡아 양질의 재가공 보고서로 submit
    const jobsList = await (await fetch(`${BASE}/api/lead-jobs?worker=agy_lead&${tokQ}`)).json();
    const reviewJob = (jobsList.jobs || []).find((j) => j.purpose === 'review' && String(j.title || '').includes(cueTask.title));
    assert.ok(reviewJob, 'Team Lead desk must contain a review job for the Cue task');
    const claimReview = await (
      await fetch(`${BASE}/api/lead-jobs/${encodeURIComponent(reviewJob.id)}/claim?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker: 'agy_lead' })
      })
    ).json();
    assert.equal(claimReview.ok, true, 'Team Lead claim should succeed');
    assert.ok(claimReview.packet.includes('executiveSummary') && claimReview.packet.includes('refinedReport'), 'Lead packet must request executiveSummary and refinedReport');

    const submitReview = await (
      await fetch(`${BASE}/api/lead-jobs/${encodeURIComponent(reviewJob.id)}/submit?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worker: 'agy_lead',
          result: {
            verdict: 'accept',
            score: 9,
            missing: [],
            feedback: '',
            executiveSummary: '경쟁 앱 3곳 분석 결과, 무료+광고 또는 월 4,900원대 구간이 가장 진입 장벽이 낮습니다. 국내 검색 수요 상승이 확인되어 MVP 착수 승인을 권고합니다.',
            refinedReport: '## 핵심 결론\n- 3개 경쟁사 가격대(무료~9,900원) 비교 결과 월 4,900원 프리미엄 모델이 최적입니다.\n\n## 팀장 검토 의견\n- 실무 초안의 핵심 가격 수치를 검증해 의사결정용으로 정리했습니다.',
            recommendedAction: '승인 권고: 월 4,900원 모델 기준으로 MVP 기획 단계 진입'
          }
        })
      })
    ).json();
    assert.equal(submitReview.ok, true, 'Team Lead review submit should succeed');

    // submitLeadJob의 비동기 200ms 핸들러(resumeReviewTask)가 결재 카드를 생성할 때까지 짧게 대기
    let refinedApr = null;
    for (let i = 0; i < 15; i += 1) {
      await new Promise((r) => setTimeout(r, 150));
      const afterLeadState = await (await fetch(`${BASE}/api/state`)).json();
      refinedApr = afterLeadState.approvals.find((a) => a.taskId === cueTask.id && a.status === 'pending') || null;
      if (refinedApr) break;
    }
    assert.ok(refinedApr, 'Approval card must be created after Team Lead accepts');
    assert.ok(refinedApr.summary.includes('월 4,900원대 구간'), 'Approval summary must use Team Lead executiveSummary');
    assert.ok((refinedApr.leadBrief || '').includes('## 핵심 결론'), 'Approval must include Team Lead refinedReport as leadBrief');
    assert.ok(refinedApr.proposedAction.includes('승인 권고'), 'Approval proposedAction must use Team Lead recommendedAction');
    assert.equal(refinedApr.leadScore, 9, 'Approval must record Team Lead review score');

    const refinedDoc = await (await fetch(`${BASE}/api/approvals/${encodeURIComponent(refinedApr.id)}/deliverable?format=json`)).json();
    assert.ok(refinedDoc.markdown.includes('총괄 팀장 재가공 보고서') && refinedDoc.markdown.includes('## 핵심 결론'), 'Deliverable markdown must include Team Lead refined report');

    // 15. Cue 등 외부 봇에 대기 업무가 2건 이상 있을 때 taskId 누락/오류 보고가 다른 프로젝트 업무에 잘못 붙지 않는지 검증
    if (leadMission.tasks.length >= 3) {
      await fetch(`${BASE}/api/tasks/${encodeURIComponent(leadMission.tasks[1].id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: 'agent_cue' })
      });
      await fetch(`${BASE}/api/tasks/${encodeURIComponent(leadMission.tasks[2].id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigneeId: 'agent_cue' })
      });
      // taskId 없이 deliverable 제출 → 임의 업무에 붙이면 안 되고 taskAutoMatchSkipped 경고 반환
      const ambigRes = await (
        await fetch(`${BASE}/api/agent-inbox/cue/reply?${tokQ}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: '보충 보고입니다.', deliverable: '보충 내용' })
        })
      ).json();
      assert.equal(ambigRes.ok, true, 'Ambiguous reply should still post message safely');
      assert.equal(ambigRes.taskId, null, 'Ambiguous reply must NOT auto-attach when 2+ tasks are open');
      assert.equal(ambigRes.taskAutoMatchSkipped, true, 'Ambiguous reply must flag taskAutoMatchSkipped');
      assert.ok(Array.isArray(ambigRes.openTasks) && ambigRes.openTasks.length >= 2, 'Ambiguous reply must list openTasks for retry');

      // 존재하지 않는 taskId → 404 (다른 업무로 폴백 금지)
      const badTaskRes = await fetch(`${BASE}/api/agent-inbox/cue/reply?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'tsk_nonexistent_999', message: '테스트', deliverable: '테스트' })
      });
      assert.equal(badTaskRes.status, 404, 'Unknown taskId must return 404 instead of attaching to another task');

      // taskId와 다른 missionId 조합 → 400 차단
      const wrongMissionRes = await fetch(`${BASE}/api/agent-inbox/cue/reply?${tokQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: leadMission.tasks[1].id, missionId: 'msn_wrong_other', message: '테스트', deliverable: '테스트' })
      });
      assert.equal(wrongMissionRes.status, 400, 'Cross-project taskId/missionId mismatch must return 400');
    }

    // Clean reset after tests
    await fetch(`${BASE}/api/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'RESET-ALL-DATA' }) });
    console.log('✅ All AI CEO Hub E2E tests (REST + Continuous Project Loop + Team Lead Chat + Official MCP SDK + Async Pickle HTTPS Inbox + Heartbeat + Cascade Delete + Web Push + Telegram) passed!');
  } finally {
    child.kill('SIGTERM');
  }
}

runTests().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
