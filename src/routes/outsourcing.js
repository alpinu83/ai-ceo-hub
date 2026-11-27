// routes/outsourcing.js: server.js에서 분리 (HTTP 라우트)
import { assignRequest, buildPacket, cancelRequest, claimRequest, createOutsourcingRequest, describeRouting, findRequest, listRequests, passRequest, publicBaseUrl, requestCeoAction, resolveTarget, resumeRequest, setRequestEffort, submitResult, summarizeRequest } from '../outsourcing.js';
import { buildMissionDigest } from '../lead-engine.js';
import { flushCloudBackup, loadDb, sanitizeStateForClient, saveDb } from '../store.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../hub/env.js';
import { getMissionRepoCfg, isCodeTask } from '../hub/code-pipeline.js';
import { isCeoRequest, outsourceAuthOk, requestConsultForApproval, updateOutsourceRouting } from '../hub/outsourcing-bridge.js';
import { notifyOutsourceCreated, outsourceTask } from '../hub/task-results.js';


export function registerOutsourcingRoutes(app) {
  // ---- 외부 AI 외주 · 자문 창구 (Antigravity · Aside · 기타 AI) ----
  app.get('/api/outsourcing', (c) => {
    const db = loadDb();
    if (!outsourceAuthOk(c, db)) return c.json({ error: '인증 필요 (x-ceo-key 또는 ?token=MCP토큰)' }, 401);
    const status = String(c.req.query('status') || 'active');
    const worker = String(c.req.query('worker') || '');
    const effort = String(c.req.query('effort') || '');
    const list = listRequests(db, { status, worker, effort });
    return c.json({
      count: list.length,
      routing: describeRouting(db.settings),
      requests: list.map((r) => ({ ...summarizeRequest(r), target: resolveTarget(db.settings, r) })),
      howTo: `요청서 전문: GET ${publicBaseUrl()}/api/outsourcing/{id}/packet · 시작: POST .../{id}/claim · 제출: POST .../{id}/submit`
    });
  });

  app.get('/api/outsourcing/:id', (c) => {
    const db = loadDb();
    if (!outsourceAuthOk(c, db)) return c.json({ error: '인증 필요' }, 401);
    const req = findRequest(db, c.req.param('id'));
    if (!req) return c.json({ error: '외주 요청을 찾을 수 없습니다.' }, 404);
    return c.json({ request: req, packet: buildPacket(db, req) });
  });

  app.get('/api/outsourcing/:id/packet', (c) => {
    const db = loadDb();
    if (!outsourceAuthOk(c, db)) return c.text('인증 필요 (x-ceo-key 헤더 또는 ?token=MCP토큰)', 401);
    const req = findRequest(db, c.req.param('id'));
    if (!req) return c.text('외주 요청을 찾을 수 없습니다.', 404);
    return c.body(buildPacket(db, req), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  });

  app.post('/api/outsourcing', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 외주를 요청할 수 있습니다.' }, 401);
    const db = loadDb();
    let req;
    if (body.approvalId && (body.kind === 'consult' || !body.kind)) {
      const apr = db.approvals.find((a) => a.id === body.approvalId);
      if (!apr) return c.json({ error: '결재 안건을 찾을 수 없습니다.' }, 404);
      req = requestConsultForApproval(db, apr, 'CEO');
    } else if (body.taskId) {
      const task = db.tasks.find((t) => t.id === body.taskId);
      if (!task) return c.json({ error: '업무를 찾을 수 없습니다.' }, 404);
      const mission = db.missions.find((m) => m.id === task.missionId);
      const kind = ['task', 'code', 'browser', 'research'].includes(body.kind) ? body.kind : mission && getMissionRepoCfg(db.settings, mission) && isCodeTask(task, db.agents.find((a) => a.id === task.assigneeId)) ? 'code' : 'task';
      req = outsourceTask(db, task, {
        kind,
        worker: ['antigravity', 'aside', 'gemini', 'any'].includes(body.worker) ? body.worker : kind === 'code' ? 'antigravity' : kind === 'browser' ? 'aside' : 'any',
        reason: String(body.reason || '대표님이 외부 AI에 직접 맡김').slice(0, 400),
        createdBy: 'CEO'
      });
    } else {
      const title = String(body.title || '').trim();
      const goal = String(body.goal || '').trim();
      if (!title || goal.length < 10) return c.json({ error: '제목과 해야 할 일(10자 이상)을 입력해 주세요.' }, 400);
      const mission = body.missionId ? db.missions.find((m) => m.id === body.missionId) : null;
      const repoCfg = mission ? getMissionRepoCfg(db.settings, mission) : null;
      const kind = ['task', 'code', 'consult', 'browser', 'research'].includes(body.kind) ? body.kind : 'task';
      const made = createOutsourcingRequest(db, {
        kind,
        title,
        goal,
        deliverable: body.deliverable || '',
        missionId: mission?.id || '',
        reason: String(body.reason || '대표님 직접 요청').slice(0, 400),
        worker: ['antigravity', 'aside', 'gemini', 'any'].includes(body.worker) ? body.worker : 'any',
        repo: kind === 'code' || kind === 'task' ? repoCfg?.repo || '' : '',
        branch: repoCfg?.branch || 'main',
        siteUrl: mission?.siteUrl || '',
        context: mission ? buildMissionDigest(db, mission.id, 3000) : '',
        createdBy: 'CEO'
      });
      req = made.request;
      if (['antigravity', 'aside', 'gemini'].includes(body.worker)) req.pinnedWorker = body.worker;
      if (made.created) notifyOutsourceCreated(db, req);
    }
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ request: req, state: sanitizeStateForClient(db) });
  });

  app.get('/api/outsourcing/setup/antigravity', (c) => {
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 볼 수 있습니다 (토큰 포함).' }, 401);
    const db = loadDb();
    const base = publicBaseUrl();
    const token = db.settings?.mcpToken || '';
    let skill = '';
    try {
      skill = fs.readFileSync(path.join(ROOT_DIR, '.agents', 'skills', 'ceo-outsourcing', 'SKILL.md'), 'utf8');
    } catch {
      skill = '';
    }
    const mcpJson = { mcpServers: { 'ceo-office': { serverUrl: `${base}/api/mcp`, headers: { Authorization: `Bearer ${token}` } } } };
    const prompt = [
      'CEO Office 외주 창구를 이 Antigravity에 연결해줘. 아래 4가지를 순서대로 하고 결과를 알려줘.',
      '',
      '1) MCP 서버 등록: 전역 설정 파일 ~/.gemini/config/mcp_config.json (Windows는 %USERPROFILE%\\.gemini\\config\\mcp_config.json)을 열어 mcpServers에 아래 "ceo-office" 항목을 추가해줘. 파일이 없으면 만들고, 이미 있는 다른 서버 설정은 그대로 둬. 저장 후 MCP 서버 목록을 새로고침해서 ceo-office의 도구(list_outsourcing_requests 등)가 보이는지 확인해줘.',
      '```json',
      JSON.stringify(mcpJson, null, 2),
      '```',
      '',
      '2) 스킬 설치: ~/.gemini/config/skills/ceo-outsourcing/SKILL.md 파일을 아래 내용 그대로 만들어줘.',
      '```markdown',
      skill.trim(),
      '```',
      '',
      '3) 모델 계층 (Carbon > Neon > Hydrogen): Settings > Models > Orchestrator Settings에서 Orchestrator Model을 Gemini 4 Carbon, Executor Model을 Gemini 4 Hydrogen으로 설정해줘. 내가 직접 해야 하는 화면 설정이면 방법만 알려줘.',
      '',
      '4) 자동 실행: 30분마다 아래 지시를 실행하는 Automation(/automation)을 만들어줘. 모델은 고를 수 있으면 Orchestrator(Carbon), 없으면 가장 높은 등급(Carbon 또는 Pro)으로. 처리할 게 없으면 짧게 끝내도록 해줘.',
      '   지시: "ceo-outsourcing 스킬로 CEO Office 외주 처리해줘. 너(Carbon)는 계획·판단·최종 검토만 하고, 여러 파일 구현·원인 추적 같은 중간 난이도 일은 Gemini 4 Neon 하위 에이전트에, 자료 조사·검색·단순 수정·테스트 실행은 Gemini 4 Hydrogen 하위 에이전트에 맡겨. 하위 에이전트를 부를 때 모델 이름을 지시에 적어."',
      '',
      '주의: 위 토큰은 비밀번호와 같으니 다른 곳에 출력하거나 저장소에 커밋하지 마.'
    ].join('\n');
    return c.json({ prompt, mcpJson, base });
  });

  app.post('/api/outsourcing/route', async (c) => {
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 바꿀 수 있습니다.' }, 401);
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    const routing = updateOutsourceRouting(db, body);
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ routing, state: { ...sanitizeStateForClient(db), outsourcingRouting: routing } });
  });

  app.post('/api/outsourcing/:id/need-ceo', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
    try {
      const req = await requestCeoAction(c.req.param('id'), { worker: body.worker, action: body.action, detail: body.detail });
      return c.json({ ok: true, request: summarizeRequest(req) });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/outsourcing/:id/resume', async (c) => {
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 재개할 수 있습니다.' }, 401);
    const body = await c.req.json().catch(() => ({}));
    try {
      resumeRequest(c.req.param('id'), body.note || '', body.worker || '');
      const db = loadDb();
      return c.json({ ok: true, state: { ...sanitizeStateForClient(db), outsourcingRouting: describeRouting(db.settings) } });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/outsourcing/:id/effort', async (c) => {
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 지정할 수 있습니다.' }, 401);
    const body = await c.req.json().catch(() => ({}));
    try {
      setRequestEffort(c.req.param('id'), body.effort || 'auto');
      const db = loadDb();
      return c.json({ ok: true, state: { ...sanitizeStateForClient(db), outsourcingRouting: describeRouting(db.settings) } });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/outsourcing/:id/assign', async (c) => {
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 지정할 수 있습니다.' }, 401);
    const body = await c.req.json().catch(() => ({}));
    try {
      assignRequest(c.req.param('id'), body.worker || 'auto');
      const db = loadDb();
      return c.json({ ok: true, state: { ...sanitizeStateForClient(db), outsourcingRouting: describeRouting(db.settings) } });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/outsourcing/:id/claim', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
    try {
      const req = claimRequest(c.req.param('id'), String(body.worker || c.req.query('worker') || 'any'));
      return c.json({ ok: true, request: summarizeRequest(req), packet: buildPacket(loadDb(), req) });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 409);
    }
  });

  app.post('/api/outsourcing/:id/submit', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
    try {
      const req = await submitResult(c.req.param('id'), {
        worker: body.worker || 'manual',
        summary: body.summary || '',
        document: body.document || body.result || '',
        prUrl: body.prUrl || body.pr_url || ''
      });
      return c.json({ ok: true, request: summarizeRequest(req), state: isCeoRequest(c) ? sanitizeStateForClient(loadDb()) : undefined });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/outsourcing/:id/pass', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
    try {
      const req = passRequest(c.req.param('id'), {
        worker: body.worker || '',
        to: body.to || 'auto',
        reason: body.reason || ''
      });
      return c.json({ ok: true, request: summarizeRequest(req), target: resolveTarget(loadDb().settings, req) });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/outsourcing/:id/cancel', async (c) => {
    if (!isCeoRequest(c)) return c.json({ error: 'CEO만 취소할 수 있습니다.' }, 401);
    try {
      const req = cancelRequest(c.req.param('id'), 'CEO');
      const db = loadDb();
      const task = req.taskId ? db.tasks.find((t) => t.id === req.taskId) : null;
      if (task && task.status === 'outsourced') {
        task.status = 'queued';
        task.updatedAt = new Date().toISOString();
        task.outsourceDeclined = true;
        delete task.outsourceId;
      }
      saveDb(db);
      return c.json({ ok: true, state: sanitizeStateForClient(db) });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });
}
