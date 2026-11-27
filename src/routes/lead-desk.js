// routes/lead-desk.js: 팀장 업무함 HTTP (AGY 팀장 감시기 · Gemini 앱은 MCP 도구 사용)
import { LEAD_WORKERS, buildLeadPacket, claimLeadJob, leadDeskStatus, listLeadJobs, submitLeadJob, summarizeLeadJob, touchLeadWorker } from '../lead-desk.js';
import { loadDb, saveDb } from '../store.js';
import { outsourceAuthOk } from '../hub/outsourcing-bridge.js';
import { publicBaseUrl } from '../outsourcing.js';

export function registerLeadDeskRoutes(app) {
  // 대기 중인 팀장 판단 목록 (worker=agy_lead 이면 근무 신호로 기록)
  app.get('/api/lead-jobs', (c) => {
    const db = loadDb();
    if (!outsourceAuthOk(c, db)) return c.json({ error: '인증 필요 (x-ceo-key 또는 Authorization: Bearer MCP토큰)' }, 401);
    const worker = String(c.req.query('worker') || '');
    if (LEAD_WORKERS[worker]) touchLeadWorker(db, worker, 'poll');
    const list = listLeadJobs(db, LEAD_WORKERS[worker] ? worker : '');
    saveDb(db);
    const base = publicBaseUrl();
    return c.json({
      count: list.length,
      status: leadDeskStatus(db),
      jobs: list.map(summarizeLeadJob),
      howTo: `잡기: POST ${base}/api/lead-jobs/{id}/claim {"worker":"agy_lead"} → 요청서(packet)의 답안 형식대로 JSON 작성 → POST ${base}/api/lead-jobs/{id}/submit {"worker":"agy_lead","result":{...}}`
    });
  });

  app.get('/api/lead-jobs/:id', (c) => {
    const db = loadDb();
    if (!outsourceAuthOk(c, db)) return c.json({ error: '인증 필요' }, 401);
    const j = (db.leadJobs || []).find((x) => x.id === c.req.param('id'));
    if (!j) return c.json({ error: '팀장 판단 요청을 찾을 수 없습니다.' }, 404);
    return c.json({ job: summarizeLeadJob(j), packet: buildLeadPacket(j) });
  });

  app.post('/api/lead-jobs/:id/claim', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
    try {
      const j = claimLeadJob(c.req.param('id'), String(body.worker || ''));
      return c.json({ ok: true, job: summarizeLeadJob(j), leaseUntil: j.leaseUntil, packet: buildLeadPacket(j) });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, err.status || 400);
    }
  });

  app.post('/api/lead-jobs/:id/submit', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    if (!outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요' }, 401);
    try {
      const j = await submitLeadJob(c.req.param('id'), { worker: String(body.worker || ''), result: body.result });
      return c.json({ ok: true, job: summarizeLeadJob(j) });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, err.status || 400);
    }
  });
}
