/**
 * AI provider quota guard.
 * Free tiers (Gemini 20 req/day, OpenRouter free-models-per-day, Groq tokens-per-minute) run out often.
 * When a provider answers 429, remember it and short-circuit further calls until it recovers,
 * so agents fail over to the next provider instantly instead of hammering an exhausted one.
 * Installed once as a thin wrapper around global fetch; non-AI hosts pass through untouched.
 */

const PROVIDER_HOSTS = [
  ['generativelanguage.googleapis.com', 'gemini'],
  ['aiplatform.googleapis.com', 'gemini'],
  ['api.groq.com', 'groq'],
  ['openrouter.ai', 'openrouter'],
  ['api.exaone.ai', 'exaone'],
  ['api.anthropic.com', 'claude']
];

const cooldowns = new Map(); // key -> { until, reason, provider, model, hits }
const stats = new Map(); // provider -> { ok, limited, lastOkAt, lastErrorAt }

function providerOf(url) {
  for (const [host, key] of PROVIDER_HOSTS) if (url.includes(host)) return key;
  return null;
}

function modelOf(provider, url, init) {
  if (provider === 'gemini') {
    const m = url.match(/models\/([^:/?]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
  try {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    return String(body?.model || '');
  } catch {
    return '';
  }
}

function parseRetryMs(text, headers) {
  const ra = Number(headers?.get?.('retry-after'));
  if (Number.isFinite(ra) && ra > 0) return ra * 1000;
  const m = String(text).match(/retry in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if (m && (m[1] || m[2] || m[3])) {
    return ((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000;
  }
  const m2 = String(text).match(/try again in\s*([\d.]+)\s*(ms|s|m)/i);
  if (m2) return Number(m2[1]) * (m2[2] === 'ms' ? 1 : m2[2] === 's' ? 1000 : 60000);
  return 0;
}

function bump(provider, field) {
  const s = stats.get(provider) || { ok: 0, limited: 0, lastOkAt: null, lastErrorAt: null };
  s[field] += 1;
  if (field === 'ok') s.lastOkAt = new Date().toISOString();
  else s.lastErrorAt = new Date().toISOString();
  stats.set(provider, s);
}

function activeCooldown(provider, model) {
  const now = Date.now();
  for (const key of [`${provider}:*`, `${provider}:${model}`]) {
    const cd = cooldowns.get(key);
    if (cd && cd.until > now) return cd;
    if (cd) cooldowns.delete(key);
  }
  return null;
}

export function isProviderCooling(provider, model = '') {
  return Boolean(activeCooldown(provider, model));
}

/** 하루 무료 한도를 다 쓴 엔진인지 (한국 시간 자정까지 업무에서 제외) */
export function isDailyExhausted(provider, model = '') {
  const cd = activeCooldown(provider, model);
  return Boolean(cd && cd.daily);
}

/** 다음 한국 시간 자정 (하루 한도 소진 시 이 시각까지 제외) */
export function nextKstMidnight(now = Date.now()) {
  const KST = 9 * 60 * 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  return Math.floor((now + KST) / day) * day + day - KST;
}

/** 한도 오류 분류: 분당 한도와 하루 한도를 구분 (둘 다 "quota"라는 말이 들어가므로 quota만으로 하루 한도로 보지 않음) */
export function classifyLimit(text = '') {
  const t = String(text);
  const daily = /per[\s_-]?day|perday|daily|requests per day|free-models-per-day|RPD\b|TPD\b|tokens per day/i.test(t);
  const perMinute = /per[\s_-]?minute|perminute|tokens per mi|\bTPM\b|\bRPM\b/i.test(t);
  return daily ? 'daily' : perMinute ? 'minute' : 'other';
}

/** 서버 재시작 때도 유지하도록 하루 한도 소진 기록을 내보내기/불러오기 */
export function exportQuotaState() {
  const now = Date.now();
  return [...cooldowns.entries()]
    .filter(([, cd]) => cd.daily && cd.until > now)
    .map(([key, cd]) => ({ key, provider: cd.provider, model: cd.model, until: cd.until, reason: cd.reason, daily: true }));
}
export function importQuotaState(list = []) {
  const now = Date.now();
  for (const e of Array.isArray(list) ? list : []) {
    if (!e?.key || !(Number(e.until) > now)) continue;
    const cur = cooldowns.get(e.key);
    if (!cur || cur.until < e.until) cooldowns.set(e.key, { until: Number(e.until), provider: e.provider, model: e.model, reason: e.reason || '일일 무료 한도 소진', daily: true });
  }
}

export function getAiProviderHealth() {
  const now = Date.now();
  const list = [];
  for (const [key, cd] of cooldowns) {
    if (cd.until <= now) continue;
    list.push({ key, provider: cd.provider, model: cd.model, until: new Date(cd.until).toISOString(), reason: cd.reason, daily: Boolean(cd.daily) });
  }
  return { cooldowns: list, stats: Object.fromEntries(stats) };
}

if (!globalThis.__aiGuardInstalled) {
  globalThis.__aiGuardInstalled = true;
  const baseFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    const provider = providerOf(url);
    if (!provider) return baseFetch(input, init);
    const model = modelOf(provider, url, init);
    const cd = activeCooldown(provider, model);
    if (cd) {
      const mins = Math.max(1, Math.round((cd.until - Date.now()) / 60000));
      return new Response(
        JSON.stringify({ error: { message: `[quota cooldown] ${provider}${model ? `:${model}` : ''} 약 ${mins}분 후 재시도 (${cd.reason})`, code: 429 } }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const res = await baseFetch(input, init);
    if (res.status !== 429) {
      if (res.ok) bump(provider, 'ok');
      return res;
    }
    bump(provider, 'limited');
    let text = '';
    try {
      text = await res.clone().text();
    } catch {
      // ignore
    }
    const kind = classifyLimit(text);
    const daily = kind === 'daily';
    const perMinute = kind === 'minute';
    let until;
    if (daily) {
      // 하루 한도 소진: 한국 시간 자정까지 이 엔진은 업무에서 제외 (남은 자원으로 대체)
      until = nextKstMidnight();
    } else {
      let ms = parseRetryMs(text, res.headers);
      if (!ms) ms = perMinute ? 65 * 1000 : 60 * 1000;
      until = Date.now() + Math.min(Math.max(ms, 15 * 1000), 6 * 60 * 60 * 1000);
    }
    const accountWide = provider === 'openrouter' && /free-models-per-day/i.test(text);
    const key = accountWide ? `${provider}:*` : `${provider}:${model}`;
    cooldowns.set(key, {
      until,
      provider,
      model: accountWide ? '*' : model,
      daily,
      reason: daily ? '일일 무료 한도 소진 (자정까지 업무 제외)' : perMinute ? '분당 한도 초과' : '요청 한도 초과'
    });
    return res;
  };
}
