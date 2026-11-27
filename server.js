import { importQuotaState } from './src/ai-guard.js';
import { Hono } from 'hono';
import { buildCompanyContext, ensureLeadDefaults } from './src/lead-engine.js';
import { cors } from 'hono/cors';
import { ensureVapidKeys } from './src/push.js';
import fs from 'node:fs';
import { getRequestListener } from '@hono/node-server';
import { handleOfficialMcpHttp } from './src/mcp.js';
import http from 'node:http';
import { initCloudPersistence, loadDb, saveDb } from './src/store.js';
import path from 'node:path';
import { setCompanyContextProvider } from './src/orchestrator.js';
import { setTelegramDeferHandler, syncTelegramPolling } from './src/telegram.js';
import { PUBLIC_DIR } from './src/hub/env.js';
import { getTelegramCallbacks } from './src/hub/ceo-chat.js';
import { opsTick } from './src/hub/routines.js';
import { queueDeferredTelegram } from './src/hub/notify.js';
import { recoverCodeApprovalsOnBoot } from './src/hub/code-pipeline.js';
import { registerAuthRoutes } from './src/routes/auth.js';
import { registerSystemRoutes } from './src/routes/system.js';
import { registerChatRoutes } from './src/routes/chat.js';
import { registerAgentInboxRoutes } from './src/routes/agent-inbox.js';
import { registerMissionsRoutes } from './src/routes/missions.js';
import { registerRoutinesRoutes } from './src/routes/routines.js';
import { registerOutsourcingRoutes } from './src/routes/outsourcing.js';
import { registerSettingsRoutes } from './src/routes/settings.js';
import { registerShortsRoutes } from './src/routes/shorts.js';
import { registerLeadDeskRoutes } from './src/routes/lead-desk.js';

// Every AI call (team work, team-lead chat, reports, planning) receives the CEO's global directives + company memory
setCompanyContextProvider((missionId, opts) => buildCompanyContext(loadDb(), missionId, opts));
const PORT = Number(process.env.PORT || 3456);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.yaml': 'text/yaml; charset=utf-8'
};

const app = new Hono();
app.use('*', cors());
registerAuthRoutes(app);
registerSystemRoutes(app);
registerChatRoutes(app);
registerAgentInboxRoutes(app);
registerMissionsRoutes(app);
registerRoutinesRoutes(app);
registerOutsourcingRoutes(app);
registerSettingsRoutes(app);
registerShortsRoutes(app);
registerLeadDeskRoutes(app);

// Static Frontend Assets
app.get('*', (c) => {
  const pathname = new URL(c.req.url).pathname;
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);

  if (fullPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    const ext = path.extname(fullPath);
    const content = fs.readFileSync(fullPath);
    const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
    if (ext === '.html' || ext === '.js' || ext === '.css' || ext === '.webmanifest') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }
    return c.body(content, 200, headers);
  }
  const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  return c.body(indexHtml, 200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
});

const honoListener = getRequestListener(app.fetch);

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (urlObj.pathname === '/api/mcp') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, x-api-key');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      // Per MCP Streamable HTTP spec, stateless servers without standalone SSE stream return 405 (never HTML)
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed: use POST for stateless MCP Streamable HTTP' } }));
      return;
    }

    if (req.method === 'DELETE') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', async () => {
        try {
          const parsed = raw.trim() ? JSON.parse(raw) : {};
          await handleOfficialMcpHttp(req, res, parsed);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: err.message } }));
          }
        }
      });
      return;
    }
  }

  return honoListener(req, res);
});

initCloudPersistence()
  .catch(() => {})
  .finally(() => {
    server.listen(PORT, '0.0.0.0', () => {
      const db = loadDb();
      importQuotaState(db.aiQuota); // 하루 한도 소진 기록 복원 (자정까지 해당 팀원 제외)
      ensureVapidKeys(db);
      if (ensureLeadDefaults(db)) saveDb(db);
      setTelegramDeferHandler(queueDeferredTelegram);
      syncTelegramPolling(db.settings, getTelegramCallbacks());
      setTimeout(() => {
        recoverCodeApprovalsOnBoot().catch((err) => console.warn('code approval recovery failed:', err.message));
      }, 15000);
      // Company operations loop: routines, scheduled checks, watchdog (every minute)
      setTimeout(() => {
        opsTick();
        setInterval(opsTick, 60 * 1000);
      }, 30000);
      console.log(`AI CEO Hub v2 (Hono + Official MCP SDK + Vercel AI SDK + Gemini 4 Hydrogen + Groq + OpenRouter + LG K-EXAONE 2.5 + Telegram Bot) listening on http://localhost:${PORT}`);
    });
  });
