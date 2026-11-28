// routes/usage.js: 구독형 AI 사용량·한도 위젯 API (좌측 메뉴 하단 'AI 사용량')
import { flushCloudBackup, loadDb, sanitizeStateForClient, saveDb } from '../store.js';
import { computeSubscriptionUsage, getSubscriptionLimits, saveUsageSnapshot, updateSubscriptionLimits } from '../subscription-usage.js';
import { isCeoRequest, outsourceAuthOk } from '../hub/outsourcing-bridge.js';

function stripAuthFields(body = {}) {
  const { token, apiKey, api_key, ...rest } = body && typeof body === 'object' ? body : {};
  return rest;
}

export function registerUsageRoutes(app) {
  // 사용량 요약 (CEO 인증: 전역 미들웨어)
  app.get('/api/ops/usage', (c) => {
    const db = loadDb();
    return c.json({ ok: true, usage: computeSubscriptionUsage(db), limits: getSubscriptionLimits(db.settings) });
  });

  // 잔여량 스냅샷 기록: CEO 키 또는 MCP 토큰 (?token= · Authorization: Bearer)
  // auth.js ADMIN_OPEN_PATHS에 이 경로만 열어 두고 여기서 직접 인증한다.
  app.post('/api/ops/usage-snapshot', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    const ceo = isCeoRequest(c);
    if (!ceo && !outsourceAuthOk(c, db, body)) return c.json({ error: '인증 필요 (x-ceo-key 또는 ?token=MCP토큰)' }, 401);
    try {
      const snapshot = saveUsageSnapshot(db, stripAuthFields(body), ceo ? 'CEO' : String(body.by || body.worker || 'worker'));
      saveDb(db);
      await flushCloudBackup(db);
      return c.json({ ok: true, snapshot, usage: computeSubscriptionUsage(db), state: ceo ? sanitizeStateForClient(db) : undefined });
    } catch (err) {
      return c.json({ error: err.message }, err.status || 500);
    }
  });

  // 목표 상한 수정 (CEO 인증: 전역 미들웨어)
  app.post('/api/ops/usage-limits', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const db = loadDb();
    try {
      const input = body.limits && typeof body.limits === 'object' ? body.limits : stripAuthFields(body);
      const limits = updateSubscriptionLimits(db, input);
      saveDb(db);
      await flushCloudBackup(db);
      return c.json({ ok: true, limits, usage: computeSubscriptionUsage(db), state: sanitizeStateForClient(db) });
    } catch (err) {
      return c.json({ error: err.message }, err.status || 500);
    }
  });
}
