// subscription-usage.js: 구독형 AI(Aside·Claude / AGY / Gemini 앱) 사용량·한도 집계
// 소비자 구독 앱은 공식 잔여량 API가 없으므로
//   (1) Hub가 직접 본 처리 건수(외주 창구 history + 팀장 업무함 leadJobs) 자동 집계
//   (2) 대표님이 정한 목표 상한(settings.subscriptionLimits) 대비 게이지
//   (3) 선택적 잔여량 스냅샷(남은 % · 리셋 시각 · 한도 도달) + 그 이후 Hub 처리 건수
// 를 합쳐 보여 준다. db만 읽고 쓰는 순수 함수라 store.js에서도 바로 쓸 수 있다 (import 없음).

export const USAGE_WORKERS = ['aside', 'agy', 'gemini_app'];
export const USAGE_LABELS = { aside: 'Aside (Claude)', agy: 'AGY', gemini_app: 'Gemini 앱' };
export const USAGE_WINDOWS = { '5h': '최근 5시간', day: '오늘' };
export const DEFAULT_SUBSCRIPTION_LIMITS = {
  aside: { window: '5h', limit: 40 },
  agy: { window: 'day', limit: 15 },
  gemini_app: { window: 'day', limit: 30 }
};

const HOUR_MS = 3600 * 1000;
const FIVE_HOURS_MS = 5 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const ONLINE_MS = 5 * 60 * 1000; // 감시기·루틴이 5분 안에 접속했으면 '접속 중'
const MAX_LIMIT = 1000;

// 외주 창구 history에서 '작업자가 실제로 한 번 일을 처리한 것'으로 세는 이벤트
const COUNTED_EVENT_RE = /^(submitted|needs_ceo|passed:|review_rework:|escalated:)/;

// 접속 기록 키 (src/routes/outsourcing.js worker:*, src/lead-desk.js lead:*)
const CONNECTION_KEYS = {
  aside: ['worker:aside'],
  agy: ['worker:antigravity', 'lead:agy_lead'],
  gemini_app: ['worker:gemini', 'lead:gemini_app']
};

/** 외주·팀장 업무함에 기록된 작업자 이름 → 위젯 작업자 id ('' = 집계 대상 아님) */
export function normalizeUsageWorker(by = '') {
  const s = String(by || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'aside' || s.startsWith('aside') || s === 'claude') return 'aside';
  if (s === 'antigravity' || s === 'agy' || s.startsWith('agy_') || s.startsWith('antigravity')) return 'agy';
  if (s === 'gemini' || s === 'gemini_app' || s.startsWith('gemini')) return 'gemini_app';
  return '';
}

/** KST 기준 오늘 0시 (epoch ms) */
export function kstDayStart(now = Date.now()) {
  const d = new Date(now + KST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - KST_OFFSET_MS;
}

function clampLimit(v, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_LIMIT);
}

/** 저장된 목표 상한 + 기본값 */
export function getSubscriptionLimits(settings = {}) {
  const saved = settings?.subscriptionLimits && typeof settings.subscriptionLimits === 'object' ? settings.subscriptionLimits : {};
  const out = {};
  for (const w of USAGE_WORKERS) {
    const def = DEFAULT_SUBSCRIPTION_LIMITS[w];
    const cur = saved[w] && typeof saved[w] === 'object' ? saved[w] : {};
    out[w] = {
      window: USAGE_WINDOWS[cur.window] ? cur.window : def.window,
      limit: clampLimit(cur.limit, def.limit)
    };
  }
  return out;
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

/**
 * 목표 상한 수정. input = { aside: { limit, window }, agy: {...} } 또는 { worker, limit, window }
 * 잘못된 값은 400 에러. 저장은 호출한 쪽(saveDb)에서.
 */
export function updateSubscriptionLimits(db, input = {}) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const next = getSubscriptionLimits(db.settings);
  const patches = {};
  if (input && typeof input === 'object' && input.worker) {
    patches[normalizeUsageWorker(input.worker) || String(input.worker)] = input;
  } else if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input)) if (v && typeof v === 'object') patches[normalizeUsageWorker(k) || k] = v;
  }
  const keys = Object.keys(patches);
  if (!keys.length) throw badRequest('바꿀 작업자의 상한(limit)을 보내 주세요. 예: { "aside": { "limit": 40 } }');
  for (const k of keys) {
    if (!USAGE_WORKERS.includes(k)) throw badRequest(`알 수 없는 작업자: ${k} (aside · agy · gemini_app 중 하나)`);
    const p = patches[k];
    if (p.limit !== undefined) {
      const n = Math.round(Number(p.limit));
      if (!Number.isFinite(n) || n < 1 || n > MAX_LIMIT) throw badRequest(`${USAGE_LABELS[k]} 상한은 1~${MAX_LIMIT} 사이 숫자여야 합니다.`);
      next[k].limit = n;
    }
    if (p.window !== undefined) {
      if (!USAGE_WINDOWS[p.window]) throw badRequest(`집계 구간은 '5h' 또는 'day'만 됩니다.`);
      next[k].window = p.window;
    }
  }
  db.settings.subscriptionLimits = next;
  return next;
}

/**
 * 잔여량 스냅샷 기록. { worker, remainingPercent?: 0~100, resetAt?: ISO, note?, limited?: boolean, clear?: true }
 * 앱 화면에서 대표님(또는 작업자)이 본 값을 그대로 적는 용도. 저장은 호출한 쪽에서.
 */
export function saveUsageSnapshot(db, input = {}, by = 'CEO') {
  const worker = normalizeUsageWorker(input.worker);
  if (!USAGE_WORKERS.includes(worker)) throw badRequest('worker는 aside · agy · gemini_app 중 하나여야 합니다.');
  if (!db.subscriptionSnapshots || typeof db.subscriptionSnapshots !== 'object') db.subscriptionSnapshots = {};
  if (input.clear === true) {
    delete db.subscriptionSnapshots[worker];
    return null;
  }
  const snap = { at: new Date().toISOString(), by: String(by || 'CEO').slice(0, 40) };
  const hasRemaining = input.remainingPercent !== undefined && input.remainingPercent !== null && input.remainingPercent !== '';
  if (hasRemaining) {
    const n = Number(input.remainingPercent);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw badRequest('remainingPercent는 0~100 사이 숫자여야 합니다.');
    snap.remainingPercent = Math.round(n);
  }
  if (input.resetAt) {
    const t = Date.parse(String(input.resetAt));
    if (!Number.isFinite(t)) throw badRequest('resetAt은 날짜·시각 형식이어야 합니다. 예: 2026-11-28T15:00:00+09:00');
    snap.resetAt = new Date(t).toISOString();
  }
  if (input.limited !== undefined) snap.limited = input.limited === true || input.limited === 'true';
  if (input.note) snap.note = String(input.note).slice(0, 200);
  if (!hasRemaining && !snap.resetAt && snap.limited === undefined) {
    throw badRequest('남은 %(remainingPercent), 리셋 시각(resetAt), 한도 도달(limited) 중 하나는 보내 주세요.');
  }
  db.subscriptionSnapshots[worker] = snap;
  return snap;
}

/** Hub가 직접 본 작업 처리 기록 [{ worker, at(ms), type: 'outsourcing' | 'leadDesk' }] */
export function collectUsageEvents(db = {}) {
  const events = [];
  for (const r of Array.isArray(db.outsourcing) ? db.outsourcing : []) {
    const hist = Array.isArray(r?.history) ? r.history : [];
    let sawSubmit = false;
    for (const h of hist) {
      if (!h || !COUNTED_EVENT_RE.test(String(h.event || ''))) continue;
      if (h.event === 'submitted') sawSubmit = true;
      const worker = normalizeUsageWorker(h.by);
      const at = Date.parse(h.at || '');
      if (worker && Number.isFinite(at)) events.push({ worker, at, type: 'outsourcing' });
    }
    // history가 잘린 옛 요청: 결과 기록으로 보충
    if (!sawSubmit && r?.result?.by && r.result.submittedAt) {
      const worker = normalizeUsageWorker(r.result.by);
      const at = Date.parse(r.result.submittedAt);
      if (worker && Number.isFinite(at)) events.push({ worker, at, type: 'outsourcing' });
    }
  }
  for (const j of Array.isArray(db.leadJobs) ? db.leadJobs : []) {
    if (!j?.doneAt) continue;
    const worker = normalizeUsageWorker(j.claimedBy || j.worker);
    const at = Date.parse(j.doneAt);
    if (worker && Number.isFinite(at)) events.push({ worker, at, type: 'leadDesk' });
  }
  return events;
}

function lastSeenFor(db, worker) {
  let best = 0;
  for (const k of CONNECTION_KEYS[worker] || []) {
    const t = Date.parse(db.agentConnections?.[k]?.lastSeenAt || '');
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

/** 화면용 사용량 요약 (sanitizeStateForClient → state.subscriptionUsage) */
export function computeSubscriptionUsage(db = {}, now = Date.now()) {
  const limits = getSubscriptionLimits(db.settings || {});
  const events = collectUsageEvents(db);
  const dayStart = kstDayStart(now);
  const fiveAgo = now - FIVE_HOURS_MS;
  const snaps = db.subscriptionSnapshots && typeof db.subscriptionSnapshots === 'object' ? db.subscriptionSnapshots : {};

  const workers = USAGE_WORKERS.map((id) => {
    const cfg = limits[id];
    const mine = events.filter((e) => e.worker === id && e.at <= now + 60 * 1000);
    const last5h = mine.filter((e) => e.at >= fiveAgo).length;
    const today = mine.filter((e) => e.at >= dayStart).length;
    const windowStart = cfg.window === '5h' ? fiveAgo : dayStart;
    const count = cfg.window === '5h' ? last5h : today;
    const inWindow = mine.filter((e) => e.at >= windowStart);
    // 집계 구간 안 건수 내역: 협업 큐(외주 창구) / 팀장 업무함 판단
    const breakdown = { outsourcing: inWindow.filter((e) => e.type === 'outsourcing').length, leadDesk: inWindow.filter((e) => e.type === 'leadDesk').length };
    const countPercent = Math.round((count / cfg.limit) * 100);

    const raw = snaps[id] && typeof snaps[id] === 'object' ? snaps[id] : null;
    let snapshot = null;
    let sinceSnapshot = 0;
    let estimatedRemainingPercent = null;
    let snapshotActive = false;
    if (raw && raw.at) {
      const snapAt = Date.parse(raw.at);
      const resetAt = raw.resetAt ? Date.parse(raw.resetAt) : NaN;
      // 리셋 시각이 있으면 그 전까지, 없으면 지금 집계 구간 안에서 찍은 것만 유효
      snapshotActive = Number.isFinite(resetAt) ? resetAt > now : Number.isFinite(snapAt) && snapAt >= windowStart;
      sinceSnapshot = Number.isFinite(snapAt) ? mine.filter((e) => e.at > snapAt).length : 0;
      if (snapshotActive && typeof raw.remainingPercent === 'number') {
        // 추정: 상한 1건 = 100/상한 % 로 보고 이후 처리 건수만큼 차감
        estimatedRemainingPercent = Math.max(0, Math.round(raw.remainingPercent - sinceSnapshot * (100 / cfg.limit)));
      }
      snapshot = { ...raw, active: snapshotActive };
    }

    let usedPercent = countPercent;
    let source = 'count';
    if (snapshotActive && raw?.limited) {
      usedPercent = 100;
      source = 'limited';
    } else if (estimatedRemainingPercent !== null) {
      usedPercent = 100 - estimatedRemainingPercent;
      source = 'snapshot';
    }
    const level = usedPercent >= 100 ? 'limit' : usedPercent >= 80 ? 'warn' : 'ok';
    const seen = lastSeenFor(db, id);

    return {
      id,
      label: USAGE_LABELS[id],
      window: cfg.window,
      windowLabel: USAGE_WINDOWS[cfg.window],
      limit: cfg.limit,
      count,
      breakdown,
      last5h,
      today,
      usedPercent: Math.max(0, Math.min(usedPercent, 999)),
      level,
      source,
      snapshot,
      sinceSnapshot,
      estimatedRemainingPercent,
      online: Boolean(seen) && now - seen < ONLINE_MS,
      lastSeenAt: seen ? new Date(seen).toISOString() : null
    };
  });

  return {
    updatedAt: new Date(now).toISOString(),
    dayStartKst: new Date(dayStart).toISOString(),
    note: 'Hub가 직접 본 처리 건수 기준입니다. 앱의 실제 남은 한도는 스냅샷으로 기록하세요.',
    workers
  };
}
