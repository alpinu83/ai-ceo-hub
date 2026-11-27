// routes/shorts.js: 유튜브 쇼츠 자동 제작 연결 API
//  - /api/shorts/hook/* : shorts-factory(GitHub Actions) 전용, 헤더 x-shorts-token = SHORTS_HOOK_TOKEN
//  - /api/shorts*       : 대표님 화면용 (CEO 관리자 키)
import { flushCloudBackup, loadDb, sanitizeStateForClient, saveDb } from '../store.js';
import { safeEqual } from './auth.js';
import { claimJobs, ensureShorts, findShortsMission, ingestCandidates, notifyCandidates, parseShortsScript, pickCandidate, queueShortsJob, recordJobResult, shortsHookToken, kickShortsFactory } from '../hub/shorts.js';
import { autoStartLiveMissionTasks } from '../hub/missions.js';

function hookAuth(c) {
  const token = shortsHookToken();
  if (!token) return c.json({ error: '서버에 SHORTS_HOOK_TOKEN이 설정되지 않았습니다.' }, 503);
  if (!safeEqual(c.req.header('x-shorts-token'), token)) return c.json({ error: '쇼츠 제작기 토큰이 맞지 않습니다.' }, 401);
  return null;
}

export function registerShortsRoutes(app) {
  // 제작기 → 서버: 뉴스 후보 전달 (매일 아침·저녁)
  app.post('/api/shorts/hook/candidates', async (c) => {
    const denied = hookAuth(c);
    if (denied) return denied;
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    const added = ingestCandidates(db, body.items, body.batch || '');
    saveDb(db);
    await flushCloudBackup(db);
    if (added.length && body.notify !== false) await notifyCandidates(db, added);
    return c.json({ ok: true, added: added.length, total: ensureShorts(db).candidates.length });
  });

  // 제작기 → 서버: 만들 작업 가져가기
  app.post('/api/shorts/hook/claim', async (c) => {
    const denied = hookAuth(c);
    if (denied) return denied;
    const db = loadDb();
    const jobs = claimJobs(db, 2);
    if (jobs.length) {
      saveDb(db);
      await flushCloudBackup(db);
    }
    return c.json({ ok: true, jobs });
  });

  // 제작기 → 서버: 제작·업로드 결과
  app.post('/api/shorts/hook/jobs/:id/result', async (c) => {
    const denied = hookAuth(c);
    if (denied) return denied;
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    const res = await recordJobResult(db, c.req.param('id'), body);
    if (!res.ok) return c.json({ error: res.error }, res.status || 400);
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ ok: true, status: res.job.status });
  });

  // 대표님: 후보·제작 현황
  app.get('/api/shorts', (c) => {
    const db = loadDb();
    const sh = ensureShorts(db);
    const mission = findShortsMission(db);
    return c.json({ missionId: mission?.id || null, hookConfigured: Boolean(shortsHookToken()), candidates: sh.candidates.slice(0, 30), jobs: sh.jobs.slice(0, 20), lastCollectedAt: sh.lastCollectedAt || null });
  });

  // 대표님: 후보 선택 → 대본 작업
  app.post('/api/shorts/candidates/:id/pick', async (c) => {
    const db = loadDb();
    const res = pickCandidate(db, c.req.param('id'));
    if (!res.ok) return c.json({ error: res.error }, 400);
    saveDb(db);
    await flushCloudBackup(db);
    autoStartLiveMissionTasks(res.mission.id).catch(() => {});
    return c.json({ ok: true, taskId: res.task.id, state: sanitizeStateForClient(db) });
  });

  // 대표님: 제작 보류·실패 작업 다시 시도 (대본을 고쳤으면 다시 읽음)
  app.post('/api/shorts/jobs/:id/retry', async (c) => {
    const db = loadDb();
    const sh = ensureShorts(db);
    const job = sh.jobs.find((j) => j.id === c.req.param('id'));
    if (!job) return c.json({ error: '제작 작업을 찾을 수 없습니다.' }, 404);
    if (job.status === 'uploaded') return c.json({ error: '이미 업로드된 작업입니다.' }, 409);
    const task = db.tasks.find((t) => t.id === job.taskId);
    const script = job.script || parseShortsScript(task?.output || '');
    if (!script) return c.json({ error: '대본에서 제작용 JSON 블록을 읽지 못했습니다. 대본을 수정 지시로 돌려주세요.' }, 400);
    job.script = script;
    job.status = 'queued';
    job.error = '';
    job.attempts = 0;
    job.updatedAt = new Date().toISOString();
    saveDb(db);
    await flushCloudBackup(db);
    kickShortsFactory(db.settings).catch(() => {});
    return c.json({ ok: true, state: sanitizeStateForClient(db) });
  });

  // 테스트·수동용: 결재 없이 승인된 대본을 바로 대기열에 넣기는 막고, 승인된 대본 작업만 재등록 허용
  app.post('/api/shorts/tasks/:id/queue', async (c) => {
    const db = loadDb();
    const task = db.tasks.find((t) => t.id === c.req.param('id'));
    if (!task?.shorts) return c.json({ error: '쇼츠 대본 작업이 아닙니다.' }, 400);
    if (task.status !== 'completed') return c.json({ error: '결재 승인된 대본만 제작할 수 있습니다.' }, 400);
    const job = queueShortsJob(db, task);
    saveDb(db);
    await flushCloudBackup(db);
    if (job?.status === 'queued') kickShortsFactory(db.settings).catch(() => {});
    return c.json({ ok: true, job });
  });
}
