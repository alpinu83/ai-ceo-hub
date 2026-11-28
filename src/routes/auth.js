// routes/auth.js: server.js에서 분리 (HTTP 라우트)
import crypto from 'node:crypto';
import { loadDb, uid } from '../store.js';
import { sendTelegramText } from '../telegram.js';

// Optional CEO admin lock: set CEO_ADMIN_KEY on the server to require the key for every /api call
// except health checks and endpoints that carry their own token (agent inbox, MCP, Telegram webhook secret).
export const CEO_ADMIN_KEY = String(process.env.CEO_ADMIN_KEY || '').trim();

export const ADMIN_OPEN_PATHS = [
  /^\/api\/health$/,
  /^\/api\/push\/public-key$/,
  /^\/api\/agent-inbox\//,
  /^\/api\/telegram\/webhook$/,
  /^\/api\/mcp(\/info)?$/,
  /^\/api\/auth\/telegram-(request|verify)$/,
  /^\/api\/outsourcing/,
  /^\/api\/lead-jobs/,
  /^\/api\/ops\/usage-snapshot$/, // 라우트에서 CEO 키 또는 MCP 토큰을 직접 확인 (src/routes/usage.js)
  /^\/api\/shorts\/hook\//
];

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Telegram login: the CEO's own Telegram chat receives a one-time code + link, so no key needs to be typed or remembered.
export const telegramLogins = new Map();
 // id -> { token, code, expiresAt, attempts }
export let lastTelegramLoginAt = 0;

// Global brute-force guard for the 6-digit Telegram login code: 10 wrong codes in an hour locks Telegram login for an hour.
export const telegramLoginGuard = { fails: [], lockedUntil: 0 };

export function telegramLoginLocked(now) {
  telegramLoginGuard.fails = telegramLoginGuard.fails.filter((t) => now - t < 60 * 60 * 1000);
  return telegramLoginGuard.lockedUntil > now;
}

export function registerAuthRoutes(app) {
  app.use('/api/*', async (c, next) => {
    if (!CEO_ADMIN_KEY || c.req.method === 'OPTIONS') return next();
    const pathname = new URL(c.req.url).pathname;
    if (ADMIN_OPEN_PATHS.some((re) => re.test(pathname))) return next();
    if (safeEqual(c.req.header('x-ceo-key'), CEO_ADMIN_KEY)) return next();
    return c.json({ error: 'CEO 관리자 키가 필요합니다.', code: 'CEO_KEY_REQUIRED' }, 401);
  });

  app.post('/api/auth/telegram-request', async (c) => {
    if (!CEO_ADMIN_KEY) return c.json({ ok: true, unlocked: true });
    const now = Date.now();
    if (telegramLoginLocked(now)) {
      return c.json({ ok: false, error: '로그인 시도가 너무 많아 1시간 동안 텔레그램 로그인이 잠겼습니다. 관리자 키를 직접 입력해 주세요.' }, 429);
    }
    if (now - lastTelegramLoginAt < 20000) {
      return c.json({ ok: false, error: '방금 보냈습니다. 텔레그램을 확인해 주세요. (20초 후 재요청 가능)' }, 429);
    }
    const tg = loadDb().settings?.telegram || {};
    if (!tg.botToken || !tg.chatId) {
      return c.json({ ok: false, error: '텔레그램 봇이 연결되어 있지 않습니다. 관리자 키를 직접 입력해 주세요.' }, 400);
    }
    lastTelegramLoginAt = now;
    for (const [id, v] of telegramLogins) if (v.expiresAt < now) telegramLogins.delete(id);
    const token = crypto.randomBytes(24).toString('hex');
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    telegramLogins.set(uid('login'), { token, code, expiresAt: now + 10 * 60 * 1000, attempts: 0 });
    const host = c.req.header('x-forwarded-host') || c.req.header('host') || 'ai-ceo-hub.onrender.com';
    const proto = /^(localhost|127\.0\.0\.1)/.test(host) ? 'http' : 'https';
    const link = `${proto}://${host}/#login=${token}`;
    try {
      await sendTelegramText(
        tg.botToken,
        tg.chatId,
        `<b>CEO Office 로그인</b>\n로그인 코드: <code>${code}</code>\n또는 이 링크를 여세요: ${link}\n(10분 유효 · 1회용. 직접 요청하지 않았다면 무시하세요.)`
      );
    } catch (err) {
      return c.json({ ok: false, error: `텔레그램 발송 실패: ${err.message}` }, 502);
    }
    return c.json({ ok: true });
  });

  app.post('/api/auth/telegram-verify', async (c) => {
    if (!CEO_ADMIN_KEY) return c.json({ ok: true, key: '' });
    const body = await c.req.json().catch(() => ({}));
    const token = String(body.token || '').trim();
    const code = String(body.code || '').replace(/\D/g, '');
    const now = Date.now();
    if (telegramLoginLocked(now)) {
      return c.json({ ok: false, error: '로그인 시도가 너무 많아 1시간 동안 텔레그램 로그인이 잠겼습니다.' }, 429);
    }
    for (const [id, v] of telegramLogins) {
      if (v.expiresAt < now || v.attempts >= 5) {
        telegramLogins.delete(id);
        continue;
      }
      if ((token && safeEqual(token, v.token)) || (code && safeEqual(code, v.code))) {
        telegramLogins.delete(id);
        return c.json({ ok: true, key: CEO_ADMIN_KEY });
      }
    }
    if (code) for (const v of telegramLogins.values()) v.attempts += 1;
    if (code || token) {
      telegramLoginGuard.fails.push(now);
      if (telegramLoginGuard.fails.length >= 10) {
        telegramLoginGuard.lockedUntil = now + 60 * 60 * 1000;
        telegramLogins.clear();
      }
    }
    return c.json({ ok: false, error: '코드가 맞지 않거나 만료됐습니다. 다시 요청해 주세요.' }, 401);
  });
}
