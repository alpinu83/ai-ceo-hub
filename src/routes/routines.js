// routes/routines.js: server.js에서 분리 (HTTP 라우트)
import { appendLog, flushCloudBackup, loadDb, sanitizeStateForClient, saveDb, uid } from '../store.js';
import { getAiProviderHealth } from '../ai-guard.js';
import { describeRoutineSchedule, ensureRoutines, runRoutine, sanitizeRoutineInput } from '../hub/routines.js';


export function registerRoutinesRoutes(app) {
  // Routine (recurring) work
  app.post('/api/routines', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    ensureRoutines(db);
    const input = sanitizeRoutineInput(body);
    if (!input.title) return c.json({ error: '루틴 이름을 입력해 주세요.' }, 400);
    if (!input.times?.length) return c.json({ error: '실행 시간을 HH:MM 형식으로 입력해 주세요. (예: 09:00, 18:30)' }, 400);
    const routine = {
      id: uid('rtn'),
      kind: input.kind || 'task',
      description: '',
      days: [],
      missionId: '',
      assigneeId: '',
      notify: 'anomaly',
      enabled: true,
      lastRunAt: null,
      lastStatus: '',
      lastResult: '',
      lastTaskId: '',
      runKeys: [],
      runCount: 0,
      system: false,
      createdAt: new Date().toISOString(),
      ...input
    };
    db.routines.push(routine);
    appendLog(db, 'CEO', `루틴 업무 등록: "${routine.title}" (${describeRoutineSchedule(routine)})`, 'info');
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ routine, state: sanitizeStateForClient(db) });
  });

  app.patch('/api/routines/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    ensureRoutines(db);
    const routine = db.routines.find((r) => r.id === c.req.param('id'));
    if (!routine) return c.json({ error: '루틴을 찾을 수 없습니다.' }, 404);
    const input = sanitizeRoutineInput(body, routine);
    if (input.times && !input.times.length) return c.json({ error: '실행 시간을 HH:MM 형식으로 입력해 주세요.' }, 400);
    Object.assign(routine, input);
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ routine, state: sanitizeStateForClient(db) });
  });

  app.delete('/api/routines/:id', async (c) => {
    const db = loadDb();
    ensureRoutines(db);
    const before = db.routines.length;
    db.routines = db.routines.filter((r) => r.id !== c.req.param('id'));
    if (db.routines.length === before) return c.json({ error: '루틴을 찾을 수 없습니다.' }, 404);
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ state: sanitizeStateForClient(db) });
  });

  app.post('/api/routines/:id/run', async (c) => {
    const res = await runRoutine(c.req.param('id'), { manual: true });
    const db = loadDb();
    if (!res.ok) return c.json({ error: res.error, state: sanitizeStateForClient(db) }, 400);
    return c.json({ ...res, state: { ...sanitizeStateForClient(db), aiHealth: getAiProviderHealth() } });
  });

  app.get('/api/ops/health', (c) => {
    const db = loadDb();
    return c.json({ ai: getAiProviderHealth(), watchdog: db.settings.opsWatchdog || null });
  });
}
