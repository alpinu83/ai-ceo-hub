/**
 * Google Analytics 4 (Data API) + Search Console (Search Analytics) 읽기 전용 연동
 *
 * - 인증: Google Cloud 서비스 계정 JSON 키 → JWT(RS256) → OAuth 액세스 토큰 (외부 패키지 없이 node:crypto 사용)
 * - 권한: 서비스 계정 이메일을 GA4 속성 "뷰어", Search Console 속성 "제한됨" 사용자로 추가해야 함
 * - 설정: settings.providers.googleData = { apiKey: <서비스 계정 JSON 문자열>, ga4PropertyId, searchConsoleSite }
 *   (apiKey 필드에 두면 화면·API 응답에서 자동으로 가려지고, 클라우드 백업은 암호화됨)
 *   또는 환경변수 GOOGLE_SERVICE_ACCOUNT_JSON / GA4_PROPERTY_ID / SEARCH_CONSOLE_SITE
 */
import crypto from 'node:crypto';

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly'
];
const DATA_TTL_MS = 30 * 60 * 1000;
let tokenCache = { key: '', token: '', exp: 0 };
const dataCache = new Map();

export function getGoogleDataConfig(settings) {
  const cfg = settings?.providers?.googleData || {};
  const rawJson = String(cfg.apiKey || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  let sa = null;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed?.client_email && parsed?.private_key) sa = parsed;
    } catch {
      sa = null;
    }
  }
  const ga4PropertyId = String(cfg.ga4PropertyId || process.env.GA4_PROPERTY_ID || '')
    .replace(/^properties\//, '')
    .trim();
  const searchConsoleSite = String(cfg.searchConsoleSite || process.env.SEARCH_CONSOLE_SITE || '').trim();
  return {
    sa,
    ga4PropertyId,
    searchConsoleSite,
    hasKey: Boolean(sa),
    gaEnabled: Boolean(sa && /^\d+$/.test(ga4PropertyId)),
    scEnabled: Boolean(sa && searchConsoleSite)
  };
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.key === sa.client_email && tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPES.join(' '),
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(sa.private_key).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`
    }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google 인증 실패 (${res.status}): ${data.error_description || data.error || '토큰 없음'}`);
  tokenCache = { key: sa.client_email, token: data.access_token, exp: now + Number(data.expires_in || 3600) };
  return data.access_token;
}

async function googlePost(token, url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    throw new Error(`${res.status}: ${String(msg).slice(0, 200)}`);
  }
  return data;
}

function ymd(d) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const num = (v) => Number(v || 0);

export async function fetchGa4Summary(cfg, days = 28) {
  const token = await getAccessToken(cfg.sa);
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4PropertyId}:runReport`;
  const dateRanges = [
    { startDate: `${days}daysAgo`, endDate: 'yesterday', name: 'current' },
    { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo`, name: 'previous' }
  ];
  const metricsTotal = ['activeUsers', 'sessions', 'screenPageViews', 'engagementRate', 'averageSessionDuration'];
  const [totals, pages, channels] = await Promise.all([
    googlePost(token, url, { dateRanges, metrics: metricsTotal.map((name) => ({ name })) }),
    googlePost(token, url, {
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }, { name: 'averageSessionDuration' }],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10
    }),
    googlePost(token, url, {
      dateRanges: [dateRanges[0]],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 8
    })
  ]);
  const byRange = {};
  for (const row of totals.rows || []) {
    const rangeName = row.dimensionValues?.[0]?.value || 'current';
    byRange[rangeName] = Object.fromEntries(metricsTotal.map((m, i) => [m, num(row.metricValues?.[i]?.value)]));
  }
  if (!byRange.current && totals.rows?.[0]) {
    byRange.current = Object.fromEntries(metricsTotal.map((m, i) => [m, num(totals.rows[0].metricValues?.[i]?.value)]));
  }
  return {
    days,
    current: byRange.current || null,
    previous: byRange.previous || null,
    topPages: (pages.rows || []).map((r) => ({
      path: r.dimensionValues?.[0]?.value,
      views: num(r.metricValues?.[0]?.value),
      users: num(r.metricValues?.[1]?.value),
      avgSec: Math.round(num(r.metricValues?.[2]?.value))
    })),
    channels: (channels.rows || []).map((r) => ({ channel: r.dimensionValues?.[0]?.value, sessions: num(r.metricValues?.[0]?.value) }))
  };
}

export async function fetchSearchConsoleSummary(cfg, days = 28) {
  const token = await getAccessToken(cfg.sa);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.searchConsoleSite)}/searchAnalytics/query`;
  // Search Console 데이터는 보통 2~3일 늦게 집계됨
  const end = new Date(Date.now() - 3 * 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  const base = { startDate: ymd(start), endDate: ymd(end), dataState: 'final' };
  const [totals, queries, pages] = await Promise.all([
    googlePost(token, url, { ...base }),
    googlePost(token, url, { ...base, dimensions: ['query'], rowLimit: 15 }),
    googlePost(token, url, { ...base, dimensions: ['page'], rowLimit: 10 })
  ]);
  const t = totals.rows?.[0] || {};
  const row = (r) => ({
    key: r.keys?.[0],
    clicks: num(r.clicks),
    impressions: num(r.impressions),
    ctr: num(r.ctr),
    position: num(r.position)
  });
  return {
    startDate: base.startDate,
    endDate: base.endDate,
    totals: { clicks: num(t.clicks), impressions: num(t.impressions), ctr: num(t.ctr), position: num(t.position) },
    topQueries: (queries.rows || []).map(row),
    topPages: (pages.rows || []).map(row)
  };
}

/** Connection test for the settings screen */
export async function testGoogleDataConnection(settings) {
  const cfg = getGoogleDataConfig(settings);
  if (!cfg.hasKey) throw new Error('서비스 계정 JSON 키를 먼저 저장해 주세요.');
  const parts = [];
  if (cfg.gaEnabled) {
    try {
      const ga = await fetchGa4Summary(cfg, 7);
      parts.push(`GA4 연결됨 (최근 7일 활성 사용자 ${ga.current?.activeUsers ?? 0}명)`);
    } catch (err) {
      parts.push(`GA4 실패: ${err.message}`);
    }
  } else parts.push('GA4 속성 ID 미설정');
  if (cfg.scEnabled) {
    try {
      const sc = await fetchSearchConsoleSummary(cfg, 7);
      parts.push(`서치콘솔 연결됨 (${sc.startDate}~${sc.endDate} 클릭 ${sc.totals.clicks} · 노출 ${sc.totals.impressions})`);
    } catch (err) {
      parts.push(`서치콘솔 실패: ${err.message}`);
    }
  } else parts.push('서치콘솔 사이트 미설정');
  const ok = parts.some((p) => /연결됨/.test(p));
  if (!ok) throw new Error(parts.join(' · '));
  return { ok: true, reply: parts.join(' · '), model: cfg.sa.client_email };
}

function siteMatches(cfg, siteUrl = '') {
  if (!siteUrl) return true;
  const host = (u) => String(u || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
  return host(cfg.searchConsoleSite) === host(siteUrl);
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const delta = (cur, prev) => {
  if (!prev) return '';
  const d = ((cur - prev) / prev) * 100;
  return ` (이전 기간 대비 ${d >= 0 ? '+' : ''}${d.toFixed(0)}%)`;
};

/**
 * AI 팀원 프롬프트에 넣을 실제 수치 블록. 연동 안 됐거나 사이트가 다르면 빈 문자열.
 * 30분 캐시로 무료 할당량을 아낌.
 */
export async function buildAnalyticsContext(settings, { siteUrl = '' } = {}) {
  const cfg = getGoogleDataConfig(settings);
  if (!cfg.hasKey || (!cfg.gaEnabled && !cfg.scEnabled)) return '';
  if (cfg.scEnabled && siteUrl && !siteMatches(cfg, siteUrl)) return '';
  const cacheKey = `${cfg.ga4PropertyId}|${cfg.searchConsoleSite}`;
  const hit = dataCache.get(cacheKey);
  if (hit && Date.now() - hit.at < DATA_TTL_MS) return hit.text;

  const lines = [];
  if (cfg.gaEnabled) {
    try {
      const ga = await fetchGa4Summary(cfg, 28);
      const c = ga.current || {};
      const p = ga.previous || null;
      lines.push(`[GA4 실제 데이터 — 최근 28일(어제까지), 속성 ${cfg.ga4PropertyId}]`);
      lines.push(
        `- 활성 사용자 ${c.activeUsers ?? 0}${delta(c.activeUsers, p?.activeUsers)} · 세션 ${c.sessions ?? 0}${delta(c.sessions, p?.sessions)} · 조회수 ${c.screenPageViews ?? 0}${delta(c.screenPageViews, p?.screenPageViews)}`
      );
      lines.push(`- 참여율 ${pct(c.engagementRate || 0)} · 평균 세션 ${Math.round(c.averageSessionDuration || 0)}초`);
      if (ga.channels.length) lines.push(`- 유입 채널(세션): ${ga.channels.map((x) => `${x.channel} ${x.sessions}`).join(', ')}`);
      if (ga.topPages.length) lines.push(`- 조회수 상위 페이지: ${ga.topPages.map((x) => `${x.path} ${x.views}회(평균 ${x.avgSec}초)`).join(' | ')}`);
    } catch (err) {
      lines.push(`[GA4 조회 실패: ${err.message}]`);
    }
  }
  if (cfg.scEnabled) {
    try {
      const sc = await fetchSearchConsoleSummary(cfg, 28);
      lines.push('');
      lines.push(`[Search Console 실제 데이터 — ${sc.startDate}~${sc.endDate}, ${cfg.searchConsoleSite}]`);
      lines.push(`- 클릭 ${sc.totals.clicks} · 노출 ${sc.totals.impressions} · CTR ${pct(sc.totals.ctr)} · 평균 순위 ${sc.totals.position.toFixed(1)}`);
      if (sc.topQueries.length) {
        lines.push(`- 검색어(노출 상위): ${sc.topQueries.map((q) => `"${q.key}" 노출${q.impressions}/클릭${q.clicks}/순위${q.position.toFixed(1)}`).join(' | ')}`);
      } else {
        lines.push('- 검색어 데이터 없음(아직 노출이 거의 없거나 집계 전)');
      }
      if (sc.topPages.length) lines.push(`- 페이지(노출 상위): ${sc.topPages.map((q) => `${String(q.key).replace(/^https?:\/\/[^/]+/, '')} 노출${q.impressions}/클릭${q.clicks}`).join(' | ')}`);
    } catch (err) {
      lines.push(`[Search Console 조회 실패: ${err.message}]`);
    }
  }
  const text = lines.join('\n').trim();
  dataCache.set(cacheKey, { at: Date.now(), text });
  return text;
}

export function describeGoogleDataStatus(settings) {
  const cfg = getGoogleDataConfig(settings);
  return {
    hasKey: cfg.hasKey,
    clientEmail: cfg.sa?.client_email || '',
    ga4PropertyId: cfg.ga4PropertyId,
    searchConsoleSite: cfg.searchConsoleSite,
    gaEnabled: cfg.gaEnabled,
    scEnabled: cfg.scEnabled
  };
}
