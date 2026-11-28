// routes/system.js: server.js에서 분리 (HTTP 라우트)
import { buildCeoInbox, sendInboxTelegram } from '../hub/ceo-inbox.js';
import { MCP_TOOL_CATALOG } from '../mcp.js';
import { allowDataWipeOnce, listBackupRevisions, restoreBackupRevision, createDefaultState, flushCloudBackup, getCloudPersistenceStatus, loadDb, sanitizeStateForClient, saveDb } from '../store.js';
import { describeRouting } from '../outsourcing.js';
import { ensureVapidKeys, sendWebPushNotification } from '../push.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getAiProviderHealth } from '../ai-guard.js';
import { handleTelegramUpdate, isTelegramPollingActive, syncTelegramPolling, testTelegramBot } from '../telegram.js';
import { notifyWebhook, testProviderConnection } from '../orchestrator.js';
import path from 'node:path';
import { testGithubRepoConnection } from '../it-devops.js';
import { testGoogleDataConnection } from '../google-data.js';
import { CEO_ADMIN_KEY, safeEqual } from './auth.js';
import { PKG, ROOT_DIR } from '../hub/env.js';
import { ensureRoutines } from '../hub/routines.js';
import { getTelegramCallbacks } from '../hub/ceo-chat.js';
import { runLeadFollowUp } from '../hub/lead-ops.js';

// Deploy & Open-source Config Exports
export const EXPORT_FILES = {
  litellm: { file: 'litellm_config.yaml', mime: 'text/yaml; charset=utf-8' },
  'docker-compose': { file: 'docker-compose.yml', mime: 'text/yaml; charset=utf-8' },
  railway: { file: 'railway.json', mime: 'application/json; charset=utf-8' },
  render: { file: 'render.yaml', mime: 'text/yaml; charset=utf-8' }
};

export function registerSystemRoutes(app) {
  // Health Check (for Railway, Render, Docker)
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      version: PKG.version,
      uptimeSec: Math.round(process.uptime()),
      telegramPolling: isTelegramPollingActive(),
      cloudBackup: getCloudPersistenceStatus()
    })
  );

  // Native Web Push (VAPID) Endpoints — works on Android PWA, PC Chrome, iOS Home Screen PWA
  app.get('/api/push/public-key', (c) => {
    const db = loadDb();
    const { publicKey } = ensureVapidKeys(db);
    return c.json({
      ok: true,
      publicKey,
      subscribedCount: (db.pushSubscriptions || []).length
    });
  });

  app.post('/api/push/subscribe', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sub = body.subscription || body;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return c.json({ ok: false, error: '유효한 푸시 구독 정보가 아닙니다.' }, 400);
    }
    const db = loadDb();
    ensureVapidKeys(db);
    db.pushSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
    const existingIdx = db.pushSubscriptions.findIndex((s) => s.endpoint === sub.endpoint);
    const entry = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      deviceLabel: String(body.deviceLabel || '').slice(0, 60),
      createdAt: new Date().toISOString()
    };
    if (existingIdx >= 0) db.pushSubscriptions[existingIdx] = entry;
    else db.pushSubscriptions.push(entry);
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ ok: true, subscribedCount: db.pushSubscriptions.length });
  });

  app.post('/api/push/unsubscribe', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const endpoint = String(body.endpoint || '').trim();
    const db = loadDb();
    db.pushSubscriptions = (db.pushSubscriptions || []).filter((s) => s.endpoint !== endpoint);
    saveDb(db);
    await flushCloudBackup(db);
    return c.json({ ok: true, subscribedCount: db.pushSubscriptions.length });
  });

  app.post('/api/push/test', async (c) => {
    const res = await sendWebPushNotification({
      title: 'CEO Office 푸시 알림 연결 완료',
      body: '이제 결재 요청이나 업무가 완료되면 앱을 닫아둬도 바로 알림이 옵니다!',
      view: 'approvals',
      tag: 'push-test'
    });
    if (res.total === 0) {
      return c.json({ ok: false, error: '등록된 알림 기기가 없습니다. 먼저 [알림 켜기]를 눌러주세요.' }, 400);
    }
    return c.json({ ok: res.sent > 0, ...res });
  });

  // Open-source vendor bundles served directly from node_modules
  app.get('/vendor/marked.umd.js', (c) => {
    const file = fs.readFileSync(path.join(ROOT_DIR, 'node_modules/marked/lib/marked.umd.js'), 'utf8');
    return c.body(file, 200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=604800'
    });
  });

  app.get('/vendor/lucide.min.js', (c) => {
    const file = fs.readFileSync(path.join(ROOT_DIR, 'node_modules/lucide/dist/umd/lucide.min.js'), 'utf8');
    return c.body(file, 200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=604800'
    });
  });

  // State & Open-Source Stack Info
  // 대표님 할 일 (모든 프로젝트)
  app.get('/api/ceo-inbox', (c) => c.json(buildCeoInbox(loadDb())));
  app.post('/api/ceo-inbox/telegram', async (c) => {
    const r = await sendInboxTelegram(loadDb());
    return c.json(r);
  });

  app.get('/api/state', (c) => {
    const db = loadDb();
    if (ensureRoutines(db)) saveDb(db);
    const payload = { ...sanitizeStateForClient(db), aiHealth: getAiProviderHealth(), outsourcingRouting: describeRouting(db.settings) };
    // subscriptionUsage.updatedAt은 호출 시각마다 달라지므로 ETag 해시에서만 제외 (실제 상태·사용량·접속 변화는 즉시 반영)
    const hashInput = payload.subscriptionUsage
      ? { ...payload, subscriptionUsage: { ...payload.subscriptionUsage, updatedAt: '' } }
      : payload;
    const etag = `W/"${crypto.createHash('sha256').update(JSON.stringify(hashInput)).digest('hex').slice(0, 16)}"`;
    const inm = c.req.header('if-none-match') || '';
    const norm = (s) => String(s || '').trim().replace(/^W\//i, '');
    if (inm && inm.split(',').some((p) => p.trim() === '*' || norm(p) === norm(etag))) {
      return c.body(null, 304, { ETag: etag, 'Cache-Control': 'no-cache' });
    }
    c.header('ETag', etag);
    c.header('Cache-Control', 'no-cache');
    return c.json(payload);
  });

  app.get('/api/oss-stack', (c) => {
    const deps = PKG.dependencies || {};
    return c.json({
      builtIn: [
        {
          name: 'Hono',
          repo: 'honojs/hono',
          url: 'https://github.com/honojs/hono',
          version: deps.hono,
          role: '초경량 고성능 REST · 병렬 실행 · 정적 번들 서버 엔진',
          status: 'active'
        },
        {
          name: 'Official MCP TypeScript SDK',
          repo: 'modelcontextprotocol/typescript-sdk',
          url: 'https://github.com/modelcontextprotocol/typescript-sdk',
          version: deps['@modelcontextprotocol/sdk'],
          role: 'Meta Muse · Manus Cue · Claude Code 연결용 공식 Streamable HTTP MCP 서버',
          status: 'active'
        },
        {
          name: 'Vercel AI SDK',
          repo: 'vercel/ai',
          url: 'https://github.com/vercel/ai',
          version: deps.ai,
          role: 'Gemini(무료/4 Neon)·Claude·LiteLLM·Ollama 통합 멀티모델 실행 및 Zod 구조화 분해',
          status: 'active'
        },
        {
          name: 'Marked + Lucide + Telegram Bot',
          repo: 'markedjs/marked · lucide-icons/lucide',
          url: 'https://github.com/markedjs/marked',
          version: `${deps.marked} / ${deps.lucide}`,
          role: 'GFM 임원 보고서 렌더링, 오픈소스 벡터 아이콘 및 텔레그램 양방향 CEO 결재 봇 내장',
          status: 'active'
        }
      ],
      pluggable: [
        {
          name: 'LiteLLM AI Gateway',
          repo: 'BerriAI/litellm',
          url: 'https://github.com/BerriAI/litellm',
          role: '100+ 무료·유료·로컬 LLM 통합 프록시 + 월간 자동 지출 상한선(Spend Cap)'
        },
        {
          name: 'Paperclip AI Governance Pattern',
          repo: 'paperclipai/paperclip',
          url: 'https://github.com/paperclipai/paperclip',
          role: '조직도·팀원별 월 예산 한도·CEO 결재 거버넌스 아키텍처 반영'
        },
        {
          name: 'Ollama (Local Free LLMs)',
          repo: 'ollama/ollama',
          url: 'https://github.com/ollama/ollama',
          role: '내 PC/Mac에서 비용 0원으로 돌리는 오픈소스 로컬 AI 팀원 연결'
        },
        {
          name: 'Railway · Render · GitHub Actions CI',
          repo: 'railwayapp · render · actions',
          url: 'https://railway.com',
          role: '원클릭 HTTPS 공개 배포(모바일 Muse·Cue가 외부에서 /api/mcp 즉시 접속) 및 자동 테스트 CI'
        }
      ]
    });
  });

  app.get('/api/mcp/info', (c) => {
    const db = loadDb();
    // Security: never expose the MCP token publicly. Only an unlocked server or a valid CEO key gets it.
    const canSeeToken = !CEO_ADMIN_KEY || safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY);
    return c.json({
      endpoint: '/api/mcp',
      sdk: '@modelcontextprotocol/sdk (Official Streamable HTTP)',
      ...(canSeeToken ? { token: db.settings.mcpToken } : { tokenHint: 'CEO Office 설정 화면에서 확인하세요.' }),
      tools: MCP_TOOL_CATALOG
    });
  });

  app.get('/api/exports/:name', (c) => {
    const entry = EXPORT_FILES[c.req.param('name')];
    if (!entry) return c.json({ error: '알 수 없는 설정 파일입니다.' }, 404);
    const content = fs.readFileSync(path.join(ROOT_DIR, entry.file), 'utf8');
    return c.text(content, 200, { 'Content-Type': entry.mime });
  });

  // Telegram Bot Test & Webhook Endpoint
  app.post('/api/telegram/test', async (c) => {
    const db = loadDb();
    try {
      const callbacks = getTelegramCallbacks();
      const res = await testTelegramBot(db.settings, callbacks.onAutoRegisterChatId);
      const updated = loadDb();
      syncTelegramPolling(updated.settings, callbacks);
      return c.json({ ...res, state: sanitizeStateForClient(updated) });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/telegram/webhook', async (c) => {
    // Approvals can merge & deploy code, so forged webhook updates must be rejected.
    const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (webhookSecret) {
      if (!safeEqual(c.req.header('x-telegram-bot-api-secret-token'), webhookSecret)) {
        return c.json({ ok: false, error: 'invalid secret' }, 403);
      }
    } else if (isTelegramPollingActive()) {
      return c.json({ ok: true, ignored: 'long-polling mode' });
    }
    const update = await c.req.json().catch(() => ({}));
    const res = await handleTelegramUpdate(update, getTelegramCallbacks());
    return c.json({ ok: true, ...res });
  });

  // 팀장 정기 점검을 지금 바로 실행 (누락 보고·오래된 결재·후속 추진)
  app.post('/api/lead/follow-up', async (c) => {
    const res = await runLeadFollowUp({ manual: true });
    return c.json({ ok: true, ...res, state: sanitizeStateForClient(loadDb()) });
  });

  app.post('/api/providers/test', async (c) => {
    const { provider } = await c.req.json();
    const db = loadDb();
    try {
      if (provider === 'githubRepo') {
        const result = await testGithubRepoConnection(db.settings);
        return c.json({ ...result, model: result.repo });
      }
      if (provider === 'googleData') {
        return c.json(await testGoogleDataConnection(db.settings));
      }
      const result = await testProviderConnection(provider, db.settings);
      if (result?.transport && db.settings?.providers?.[provider]) {
        db.settings.providers[provider].transport = result.transport;
        saveDb(db);
        await flushCloudBackup(db);
      }
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/webhook/test', async (c) => {
    const db = loadDb();
    if (!db.settings.webhookUrl) {
      return c.json({ ok: false, error: 'Webhook URL을 먼저 저장해 주세요.' }, 400);
    }
    const result = await notifyWebhook(db.settings, 'test_ping', {
      title: 'CEO Office 결재 알림 연동 테스트',
      summary: 'OpenClaw / n8n / Slack / Discord 결재 알림 채널이 정상 연결되었습니다.'
    });
    return c.json({ ok: result.sent, ...result });
  });

  // 클라우드 백업 이전 버전 조회·복구 (CEO 관리자 키 필요)
  app.get('/api/admin/backup/revisions', async (c) => {
    try {
      return c.json({ revisions: await listBackupRevisions(Number(c.req.query('limit')) || 40, Number(c.req.query('page')) || 1) });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });
  app.post('/api/admin/backup/restore', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const summary = await restoreBackupRevision(body.version, { dryRun: body.dryRun === true });
      return c.json({ ok: true, dryRun: body.dryRun === true, summary });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 400);
    }
  });

  app.post('/api/reset', async (c) => {
    // 전체 초기화는 확인 문구가 있어야만 (실수로 모든 프로젝트가 지워지는 것 방지)
    const body = await c.req.json().catch(() => ({}));
    if (body.confirm !== 'RESET-ALL-DATA') return c.json({ error: '전체 초기화는 확인 문구가 필요합니다.' }, 400);
    const prev = loadDb();
    const fresh = createDefaultState();
    allowDataWipeOnce();
    if (prev?.settings?.mcpToken && /^ceo_mcp_[a-f0-9]{24,}$/.test(prev.settings.mcpToken)) {
      fresh.settings.mcpToken = prev.settings.mcpToken;
    }
    saveDb(fresh);
    await flushCloudBackup(fresh);
    syncTelegramPolling(fresh.settings, getTelegramCallbacks());
    return c.json({ state: sanitizeStateForClient(fresh) });
  });
}
