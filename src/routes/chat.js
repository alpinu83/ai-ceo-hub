// routes/chat.js: server.js에서 분리 (HTTP 라우트)
import { appendLog, appendMessage, flushCloudBackup, loadDb, sanitizeStateForClient, saveDb } from '../store.js';
import { generateStandupSession } from '../orchestrator.js';
import { processCeoChat } from '../hub/ceo-chat.js';


export function registerChatRoutes(app) {
  // Live Team Lounge Chat — CEO talks to AI employees
  // CEO가 "앞으로/항상/기억해" 같은 상시 지침을 말하면 고정 기억으로 저장해 모든 AI 호출에 계속 적용

  app.post('/api/chat/send', async (c) => {
    const body = await c.req.json();
    const text = String(body.text || '').trim();
    if (!text) return c.json({ error: '메시지를 입력해 주세요.' }, 400);
    const res = await processCeoChat(text, String(body.missionId || '').trim());
    return c.json({
      ceoMessage: res.ceoMessage,
      replies: res.replies,
      intake: res.intake,
      state: sanitizeStateForClient(loadDb())
    });
  });

  app.delete('/api/chat', async (c) => {
    const missionId = String(c.req.query('missionId') || '').trim();
    const db = loadDb();
    if (missionId && missionId !== 'all') {
      db.messages = (db.messages || []).filter((m) => m.missionId !== missionId);
    } else {
      db.messages = [];
    }
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ state: sanitizeStateForClient(db) });
  });

  // Live Team Standup — watch Lead & team members report real current status
  app.post('/api/missions/:id/standup', async (c) => {
    const missionId = c.req.param('id');
    const db = loadDb();
    const mission = db.missions.find((m) => m.id === missionId);
    if (!mission) return c.json({ error: '미션을 찾을 수 없습니다.' }, 404);

    const missionTasks = db.tasks.filter((t) => t.missionId === missionId);
    const turns = await generateStandupSession({
      mission,
      tasks: missionTasks,
      agents: db.agents,
      settings: db.settings
    });

    const savedTurns = turns.map((t) => appendMessage(db, t));
    appendLog(db, '회의실', `"${mission.title}" 현황 점검(${savedTurns.length}건).`, 'info');
    saveDb(db);
    flushCloudBackup(db).catch(() => {});

    return c.json({
      turns: savedTurns,
      state: sanitizeStateForClient(db)
    });
  });
}
