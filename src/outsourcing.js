/**
 * 외부 AI 외주 · 자문 채널
 *
 * 무료 API 팀이 할 수 없는 일(로그인이 필요한 콘솔 작업, 여러 파일에 걸친 큰 코드 수정, 반복 실패한 작업)과
 * 팀장 결과물에 대한 외부 자문을 "외주 요청서"로 만들어 두면,
 * 대표님이 구독 중인 상위 AI(Antigravity, Aside)가 MCP·HTTPS·웹 화면 중 편한 경로로 가져가서 처리하고 결과 문서(또는 PR)를 제출합니다.
 *
 * 중간 매개체 = 이 서버(이미 클라우드에 있고 인증·백업이 됨). 요청서/결과는 마크다운 문서로 주고받습니다.
 * - Antigravity: MCP 서버(/api/mcp) 도구로 직접 조회·제출, 코드 작업은 저장소에 브랜치+PR (제목에 요청 ID)
 * - Aside: 로그인된 브라우저로 HTTPS API 호출 (정기 루틴으로 자동 처리 가능)
 * - Gemini 앱: 맞춤 연결 앱(MCP)으로 자문·리서치·문서 작업을 가져가서 제출 (예약 작업으로 자동 실행)
 * - 그 밖의 AI: 웹 화면에서 요청서 복사 → 결과 붙여넣기
 */
import { loadDb, saveDb, appendLog } from './store.js';
import { buildCompanyContext } from './lead-engine.js';

export const OUTSOURCE_WORKER_LABELS = {
  antigravity: 'Antigravity',
  aside: 'Aside',
  gemini: 'Gemini 앱',
  any: '먼저 잡는 쪽'
};
export const OUTSOURCE_KIND_LABELS = {
  task: '실무 작업',
  code: '코드 수정',
  consult: '외부 자문',
  browser: '브라우저·계정 작업',
  research: '심층 리서치'
};

let handlers = { onSubmitted: null, onCreated: null, onNeedsCeo: null };
export function setOutsourcingHandlers(h = {}) {
  handlers = { ...handlers, ...h };
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * 작업자별로 실제로 할 수 있는 일 (연결성·확장성 차이)
 * - Antigravity: 저장소·터미널·브라우저·MCP 모두 가능 → 코드 수정 전담, 나머지는 예비
 * - Aside: 대표님 PC의 로그인된 브라우저 → 계정·콘솔 작업, 리서치·문서
 * - Gemini 앱: 웹 검색·Deep Research·긴 글 작성·구글 워크스페이스. 저장소 쓰기·로그인 작업은 불가
 */
export const WORKER_CAPS = {
  antigravity: ['task', 'code', 'consult', 'browser', 'research'],
  aside: ['task', 'consult', 'browser', 'research'],
  gemini: ['task', 'consult', 'research']
};
export const WORKER_STRENGTHS = {
  antigravity: '코드 수정·PR, 여러 파일 작업 (사용량 한도가 빡빡하니 코드 위주로)',
  aside: '회사 PC 로그인된 브라우저: 애드센스·서치콘솔 같은 계정·콘솔 작업, 사이트 점검',
  gemini: '자문·검토, 심층 리서치(웹 검색·Deep Research), 문서·카피 작성. 저장소 쓰기·로그인 작업은 못 함'
};
// 종류별 담당: 'time' = 업무 시간엔 Aside, 그 외·이동 중엔 Antigravity
export const ROLE_CHOICES = ['time', 'gemini', 'aside', 'antigravity'];
export const DEFAULT_ROLES = { consult: 'gemini', research: 'gemini', task: 'gemini', browser: 'time', code: 'antigravity' };

/**
 * 난이도: deep = 판단·추론이 필요한 일 (Gemini Neon / Antigravity Carbon·Neon)
 *        light = 자료 조사·단순 작업 (Hydrogen)
 */
export const EFFORT_LABELS = { deep: '깊은 판단', light: '단순·조사' };
const DEEP_RE = /(전략|분석|설계|판단|검토|기획|비교|원인|우선순위|리스크|위험|평가|의사\s*결정|아키텍처|구조\s*개선|진단)/;
export function inferEffort(req = {}) {
  if (EFFORT_LABELS[req.effort]) return req.effort;
  if (req.kind === 'consult' || req.kind === 'code') return 'deep';
  if (req.kind === 'research' || req.kind === 'browser') return 'light';
  return DEEP_RE.test(`${req.title || ''} ${req.goal || ''}`) ? 'deep' : 'light';
}

/** 요청서에 넣을 모델 분담 원칙 (작업자별) */
function modelPlanLines(target, req) {
  const effort = inferEffort(req);
  if (target === 'antigravity') {
    return [
      '## 모델 분담 (Antigravity: Carbon > Neon > Hydrogen)',
      `- 이 요청 난이도: ${EFFORT_LABELS[effort]}`,
      '- Gemini 4 Carbon (최상위, 이 대화의 기본): 요청서 해석, 계획·설계, 위험 판단, 하위 결과 검토, PR 전 최종 리뷰와 제출 문서 작성',
      '- Gemini 4 Neon (중간): 여러 파일에 걸친 구현, 원인 추적이 필요한 디버깅, 판단이 들어가는 분석 → Neon 하위 에이전트에 맡기기',
      '- Gemini 4 Hydrogen (하위): 자료 조사, 파일·코드 검색, 정해진 대로 하는 단순 수정, 테스트·빌드 실행, 문서 갱신 → Hydrogen 하위 에이전트(또는 Orchestrator 실행 모델)에 맡기기',
      '- 하위 에이전트를 부를 때 "Gemini 4 Neon으로 실행" / "Gemini 4 Hydrogen으로 실행"처럼 모델을 지시에 적을 것. Hydrogen이 막히면 Neon에, Neon이 막히면 Carbon이 직접 판단',
      '- Carbon 사용량을 아끼기 위해 반복·단순 작업은 직접 하지 말고 내려보낼 것. 모델을 지정할 수 없는 환경이면 현재 모델로 하고 결과 문서 끝에 사용한 모델을 적을 것',
      ''
    ].join('\n');
  }
  if (target === 'gemini') {
    return [
      '## 모델 분담 (Gemini 앱: Neon / Hydrogen)',
      `- 이 요청 난이도: ${EFFORT_LABELS[effort]} → ${effort === 'deep' ? 'Neon 예약 작업이 처리' : 'Hydrogen 예약 작업이 처리'}`,
      '- Hydrogen으로 처리하다가 판단·추론이 많이 필요하다고 보이면 억지로 끝내지 말고 pass_outsourcing_request(to "deep")로 Neon에 올릴 것 (지금까지 조사한 내용을 reason에 요약)',
      ''
    ].join('\n');
  }
  return '';
}

function normalizeRoles(raw = {}) {
  const out = { ...DEFAULT_ROLES };
  for (const kind of Object.keys(DEFAULT_ROLES)) {
    const v = raw?.[kind];
    if (!ROLE_CHOICES.includes(v)) continue;
    if (v !== 'time' && !WORKER_CAPS[v]?.includes(kind)) continue; // 못 하는 일은 배정 불가
    if (v === 'time' && !WORKER_CAPS.aside.includes(kind)) continue; // 시간대 담당(Aside 포함)이 못 하는 일
    out[kind] = v;
  }
  return out;
}

export function getOutsourcingSettings(settings) {
  const o = settings?.outsourcing || {};
  const oh = o.officeHours || {};
  return {
    enabled: o.enabled !== false,
    autoOnFailure: o.autoOnFailure !== false,
    autoForBrowser: o.autoForBrowser !== false,
    consultMode: ['off', 'proposals', 'proposals_and_reports'].includes(o.consultMode) ? o.consultMode : 'proposals',
    // 외주 대상: auto(업무 시간엔 Aside, 그 외·이동 중엔 Antigravity) / aside / antigravity
    routing: ['auto', 'aside', 'antigravity', 'gemini'].includes(o.routing) ? o.routing : 'auto',
    officeHours: {
      days: Array.isArray(oh.days) && oh.days.length ? oh.days.map(Number).filter((d) => d >= 0 && d <= 6) : [1, 2, 3, 4, 5],
      start: HHMM_RE.test(oh.start || '') ? oh.start : '09:00',
      end: HHMM_RE.test(oh.end || '') ? oh.end : '19:00'
    },
    awayUntil: o.awayUntil && Date.parse(o.awayUntil) > Date.now() ? o.awayUntil : '',
    // 잡은 뒤 이 시간 안에 결과·연장이 없으면 다른 작업자가 가져갈 수 있음 (같은 작업자가 다시 잡으면 연장)
    leaseMinutes: Math.min(240, Math.max(15, Number(o.leaseMinutes) || 45)),
    // 종류별 담당 (역할 분담표)
    roles: normalizeRoles(o.roles),
    // Gemini 앱이 이 시간 동안 안 가져가면 시간대 담당(Aside/Antigravity)으로 넘김. 0 = 넘기지 않음
    geminiWaitMinutes: [0, 60, 120, 180, 360, 720].includes(Number(o.geminiWaitMinutes)) ? Number(o.geminiWaitMinutes) : 180
  };
}

function kstClock(date = new Date()) {
  const k = new Date(date.getTime() + 9 * 3600 * 1000);
  return { minutes: k.getUTCHours() * 60 + k.getUTCMinutes(), weekday: k.getUTCDay() };
}

export function inOfficeHours(settings, date = new Date()) {
  const { officeHours } = getOutsourcingSettings(settings);
  const { minutes, weekday } = kstClock(date);
  if (!officeHours.days.includes(weekday)) return false;
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const a = toMin(officeHours.start);
  const b = toMin(officeHours.end);
  return a <= b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/** 시간대 담당: 이동 중이거나 업무 시간 밖이면 Antigravity, 업무 시간엔 Aside */
export function timeWorker(settings, date = new Date()) {
  const cfg = getOutsourcingSettings(settings);
  if (cfg.awayUntil) return 'antigravity';
  return inOfficeHours(settings, date) ? 'aside' : 'antigravity';
}

/** Gemini 앱 담당 요청이 너무 오래 안 잡히면 시간대 담당으로 넘김 */
function geminiStale(cfg, req, date) {
  if (!cfg.geminiWaitMinutes || req.status !== 'open') return false;
  const since = Date.parse(req.updatedAt || req.createdAt || 0);
  return Number.isFinite(since) && date.getTime() - since > cfg.geminiWaitMinutes * 60 * 1000;
}

/**
 * 지금 외주를 받을 작업자
 * 요청별 지정 > 대표님 고정 설정(그 작업자가 할 수 있는 일만) > 역할 분담표 > 시간대 담당
 */
export function resolveTarget(settings, req = {}, date = new Date()) {
  if (req.pinnedWorker && OUTSOURCE_WORKER_LABELS[req.pinnedWorker] && req.pinnedWorker !== 'any') return req.pinnedWorker;
  const cfg = getOutsourcingSettings(settings);
  const kind = OUTSOURCE_KIND_LABELS[req.kind] ? req.kind : 'task';
  if (cfg.routing !== 'auto' && WORKER_CAPS[cfg.routing]?.includes(kind)) return cfg.routing;
  const role = cfg.roles[kind] || 'time';
  if (role === 'time') return timeWorker(settings, date);
  if (role === 'gemini' && geminiStale(cfg, req, date)) return timeWorker(settings, date);
  return role;
}

export function describeRouting(settings, date = new Date()) {
  const cfg = getOutsourcingSettings(settings);
  // 한 곳에 몰기 설정이면 그 작업자, 아니면 시간대 담당
  const target = cfg.routing !== 'auto' ? cfg.routing : timeWorker(settings, date);
  let why = '';
  if (cfg.awayUntil) why = `이동 중 모드 (${new Date(cfg.awayUntil).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })}까지)`;
  else why = inOfficeHours(settings, date) ? `업무 시간 ${cfg.officeHours.start}~${cfg.officeHours.end}` : '업무 시간 밖';
  if (cfg.routing !== 'auto') why = `대표님 고정: ${OUTSOURCE_WORKER_LABELS[cfg.routing]} (못 하는 일만 분담표대로) · ${why}`;
  const byKind = {};
  for (const kind of Object.keys(OUTSOURCE_KIND_LABELS)) {
    const w = resolveTarget(settings, { kind }, date);
    byKind[kind] = { worker: w, label: OUTSOURCE_WORKER_LABELS[w], role: cfg.roles[kind] };
  }
  return {
    target,
    label: OUTSOURCE_WORKER_LABELS[target],
    why,
    routing: cfg.routing,
    awayUntil: cfg.awayUntil,
    officeHours: cfg.officeHours,
    roles: cfg.roles,
    byKind,
    geminiWaitMinutes: cfg.geminiWaitMinutes
  };
}

/** 한 줄 요약: "자문 Gemini 앱 · 리서치 Gemini 앱 · ..." */
export function describeRolesLine(settings, date = new Date()) {
  const r = describeRouting(settings, date);
  return Object.entries(r.byKind)
    .map(([k, v]) => `${OUTSOURCE_KIND_LABELS[k]} ${v.label}`)
    .join(' · ');
}

export function publicBaseUrl() {
  return String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'https://ai-ceo-hub.onrender.com').replace(/\/$/, '');
}

// 로그인이 필요한 외부 계정·콘솔 작업: 무료 API 팀원은 실제로 할 수 없음
const ACCOUNT_RE =
  /(애드센스|adsense|서치\s*콘솔|search\s*console|GA4\s*(콘솔|관리|속성)|애널리틱스\s*관리|네이버\s*서치\s*어드바이저|웹마스터\s*도구|render\s*대시보드|cloudflare\s*대시보드|도메인\s*(설정|DNS|연결)|DNS\s*레코드|광고\s*단위\s*(생성|발급)|계정\s*(설정|생성|등록)|콘솔에서|로그인해서)/i;
const ACCOUNT_ACTION_RE = /(설정|등록|제출|변경|신청|연결|인증|생성|발급|확인해|점검해|조회해)/;

export function assessFeasibility(task, { googleDataConnected = false } = {}) {
  const text = `${task?.title || ''} ${task?.description || ''}`;
  if (!ACCOUNT_RE.test(text) || !ACCOUNT_ACTION_RE.test(text)) return { outsource: false };
  // GA4·서치콘솔 "데이터 조회"는 읽기 API가 연결돼 있으면 내부에서 가능
  if (googleDataConnected && /(GA4|애널리틱스|서치\s*콘솔|search\s*console)/i.test(text) && !/(설정|등록|제출|변경|인증|신청|생성|발급)/.test(text)) {
    return { outsource: false };
  }
  return {
    outsource: true,
    kind: 'browser',
    worker: 'aside',
    reason: '로그인이 필요한 외부 계정·콘솔 작업이라 무료 API 팀원은 실제로 할 수 없습니다.'
  };
}

/** 팀원이 결과물에 "[외주 필요: 사유]"를 달면 외주로 넘김 */
export function extractOutsourceFlag(output = '') {
  const m = String(output).match(/\[외주\s*필요\s*[:：]?\s*([^\]]{0,240})\]/);
  if (!m) return '';
  return (m[1] || '').trim() || '담당 팀원이 무료 도구로는 할 수 없다고 판단';
}

function kstStamp() {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return k.toISOString().slice(2, 10).replace(/-/g, '');
}

function ensureList(db) {
  if (!Array.isArray(db.outsourcing)) db.outsourcing = [];
  return db.outsourcing;
}

export function createOutsourcingRequest(db, spec = {}) {
  const list = ensureList(db);
  const kind = OUTSOURCE_KIND_LABELS[spec.kind] ? spec.kind : 'task';
  const dup = list.find(
    (r) =>
      ['open', 'claimed'].includes(r.status) &&
      r.kind === kind &&
      ((spec.taskId && r.taskId === spec.taskId) || (spec.approvalId && r.approvalId === spec.approvalId))
  );
  if (dup) return { request: dup, created: false };
  const nowIso = new Date().toISOString();
  const req = {
    id: `OUT-${kstStamp()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    kind,
    title: String(spec.title || '외주 요청').slice(0, 120),
    missionId: spec.missionId || '',
    taskId: spec.taskId || '',
    approvalId: spec.approvalId || '',
    reason: String(spec.reason || '').slice(0, 600),
    goal: String(spec.goal || '').slice(0, 3000),
    deliverable: String(spec.deliverable || '').slice(0, 1200),
    context: String(spec.context || '').slice(0, 7000),
    repo: spec.repo || '',
    branch: spec.branch || 'main',
    siteUrl: spec.siteUrl || '',
    worker: OUTSOURCE_WORKER_LABELS[spec.worker] ? spec.worker : 'any',
    effort: inferEffort({ kind, title: spec.title, goal: spec.goal, effort: spec.effort }),
    status: 'open',
    claimedBy: '',
    claimedAt: null,
    leaseUntil: null,
    result: null,
    createdBy: spec.createdBy || 'system',
    history: [{ at: nowIso, event: 'created', by: spec.createdBy || 'system' }],
    createdAt: nowIso,
    updatedAt: nowIso
  };
  list.unshift(req);
  if (list.length > 200) db.outsourcing = list.slice(0, 200);
  appendLog(db, '외주 창구', `외주 요청 ${req.id} 등록 — ${OUTSOURCE_KIND_LABELS[kind]} · "${req.title}" (권장: ${OUTSOURCE_WORKER_LABELS[req.worker]})`, 'info');
  if (handlers.onCreated) {
    try {
      handlers.onCreated(req, db);
    } catch {
      // non-fatal
    }
  }
  return { request: req, created: true };
}

export function findRequest(db, id) {
  return ensureList(db).find((r) => r.id === String(id || '').trim());
}

export function listRequests(db, { status = 'active', worker = '', effort = '' } = {}) {
  const list = ensureList(db);
  const now = new Date();
  return list.filter((r) => {
    if (status === 'active' && !['open', 'claimed'].includes(r.status)) return false;
    if (status && status !== 'active' && status !== 'all' && r.status !== status) return false;
    // 작업자별 목록은 "지금 그 작업자에게 배정된 것"만 (대표님 라우팅 설정·요청별 지정 반영)
    if (worker && worker !== 'any' && resolveTarget(db.settings, r, now) !== worker) return false;
    if (EFFORT_LABELS[effort] && inferEffort(r) !== effort) return false;
    return true;
  });
}

export function summarizeRequest(r) {
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: OUTSOURCE_KIND_LABELS[r.kind],
    effort: inferEffort(r),
    title: r.title,
    status: r.status,
    preferredWorker: r.worker,
    pinnedWorker: r.pinnedWorker || '',
    ceoAction: r.ceoAction || null,
    claimedBy: r.claimedBy,
    leaseUntil: r.leaseUntil,
    repo: r.repo,
    reason: r.reason,
    createdAt: r.createdAt
  };
}

export function claimRequest(id, worker = 'any') {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  const now = Date.now();
  if (!['open', 'claimed'].includes(req.status)) throw new Error(`이미 ${req.status} 상태인 요청입니다.`);
  if (req.status === 'claimed' && req.claimedBy && req.claimedBy !== worker && Date.parse(req.leaseUntil || 0) > now) {
    throw new Error(`${req.claimedBy}가 작업 중입니다 (${req.leaseUntil}까지). 대표님이 대상을 바꾸면 바로 넘어옵니다.`);
  }
  const leaseMin = getOutsourcingSettings(db.settings).leaseMinutes;
  const sameWorker = req.status === 'claimed' && req.claimedBy === worker;
  req.status = 'claimed';
  req.claimedBy = String(worker || 'any').slice(0, 40);
  if (!sameWorker) req.claimedAt = new Date().toISOString();
  req.leaseUntil = new Date(now + leaseMin * 60 * 1000).toISOString();
  req.updatedAt = new Date().toISOString();
  req.history.push({ at: req.updatedAt, event: sameWorker ? 'lease_extended' : 'claimed', by: req.claimedBy });
  if (!sameWorker) appendLog(db, '외주 창구', `${req.id} — ${req.claimedBy}가 작업을 시작했습니다.`, 'info');
  saveDb(db);
  return req;
}

export async function submitResult(id, { worker = 'manual', summary = '', document = '', prUrl = '' } = {}) {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  if (!['open', 'claimed'].includes(req.status)) throw new Error(`이미 ${req.status} 상태라 결과를 받을 수 없습니다.`);
  const doc = String(document || '').trim();
  const pr = String(prUrl || '').trim();
  if (doc.length < 40 && !pr) throw new Error('결과 문서(40자 이상) 또는 PR 주소가 필요합니다.');
  if (pr && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(pr)) throw new Error('PR 주소 형식이 올바르지 않습니다 (https://github.com/owner/repo/pull/번호).');
  const nowIso = new Date().toISOString();
  req.status = 'submitted';
  req.result = {
    by: String(worker || 'manual').slice(0, 40),
    summary: String(summary || '').slice(0, 1500),
    document: doc.slice(0, 30000),
    prUrl: pr,
    submittedAt: nowIso
  };
  req.updatedAt = nowIso;
  req.history.push({ at: nowIso, event: 'submitted', by: req.result.by });
  appendLog(db, '외주 창구', `${req.id} 결과 접수 — ${req.result.by}${pr ? ` (PR ${pr})` : ''}`, 'success');
  saveDb(db);
  if (handlers.onSubmitted) await handlers.onSubmitted(req.id);
  return findRequest(loadDb(), id);
}

/** 로그인·2단계 인증·결제 승인처럼 대표님 손이 필요한 순간: 멈추고 알림 */
export async function requestCeoAction(id, { worker = '', action = '', detail = '' } = {}) {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  if (!['open', 'claimed'].includes(req.status)) throw new Error(`${req.status} 상태에서는 요청할 수 없습니다.`);
  const nowIso = new Date().toISOString();
  req.status = 'needs_ceo';
  req.ceoAction = {
    action: String(action || '대표님 확인 필요').slice(0, 200),
    detail: String(detail || '').slice(0, 1500),
    by: String(worker || req.claimedBy || '').slice(0, 40),
    at: nowIso
  };
  req.claimedBy = '';
  req.leaseUntil = null;
  req.updatedAt = nowIso;
  req.history.push({ at: nowIso, event: 'needs_ceo', by: req.ceoAction.by });
  appendLog(db, '외주 창구', `${req.id} 대표님 개입 필요 — ${req.ceoAction.action}`, 'warning');
  saveDb(db);
  if (handlers.onNeedsCeo) await handlers.onNeedsCeo(req.id);
  return req;
}

/** 대표님이 처리한 뒤 재개: 다시 대기열로 (메모는 요청서 맥락에 덧붙임). worker를 주면 그 작업자로 지정 */
export function resumeRequest(id, note = '', worker = '') {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  if (!['needs_ceo', 'open', 'claimed'].includes(req.status)) throw new Error(`${req.status} 상태라 재개할 수 없습니다.`);
  const nowIso = new Date().toISOString();
  if (req.status === 'needs_ceo' && req.ceoAction) {
    req.context = `${req.context || ''}\n\n[대표님 처리 완료 ${nowIso.slice(5, 16)}] ${req.ceoAction.action}${note ? ` — ${note}` : ''}`.slice(0, 8000);
    req.lastCeoAction = { ...req.ceoAction, note: String(note || '').slice(0, 500) };
  }
  req.ceoAction = null;
  req.status = 'open';
  req.claimedBy = '';
  req.leaseUntil = null;
  if (worker && OUTSOURCE_WORKER_LABELS[worker]) req.pinnedWorker = worker === 'any' ? '' : worker;
  req.updatedAt = nowIso;
  req.history.push({ at: nowIso, event: 'resumed', by: 'CEO' });
  saveDb(db);
  return req;
}

/** 요청별 작업자 지정(자동으로 되돌리려면 'auto'). 다른 작업자가 잡고 있으면 풀어서 바로 넘김 */
export function assignRequest(id, worker = 'auto') {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  req.pinnedWorker = worker === 'auto' || worker === 'any' || !OUTSOURCE_WORKER_LABELS[worker] ? '' : worker;
  const target = resolveTarget(db.settings, req);
  if (req.status === 'claimed' && req.claimedBy && req.claimedBy !== target) {
    req.status = 'open';
    req.history.push({ at: new Date().toISOString(), event: 'released_by_reassign', by: req.claimedBy });
    req.claimedBy = '';
    req.leaseUntil = null;
  }
  req.updatedAt = new Date().toISOString();
  req.history.push({ at: req.updatedAt, event: `assigned:${req.pinnedWorker || 'auto'}`, by: 'CEO' });
  saveDb(db);
  return req;
}

/**
 * 작업자가 "이건 내가 못 하는 일"이라고 판단하면 다른 작업자에게 넘김 (예: Gemini 앱 → 로그인 필요 → Aside)
 * to: aside | antigravity | gemini | auto(시간대 담당, 단 넘긴 쪽은 제외)
 */
export function passRequest(id, { worker = '', to = 'auto', reason = '' } = {}) {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  if (!['open', 'claimed'].includes(req.status)) throw new Error(`${req.status} 상태라 넘길 수 없습니다.`);
  const from = String(worker || req.claimedBy || '').slice(0, 40);
  if (to === 'deep') {
    // 같은 작업자 안에서 상위 모델로 올림 (Gemini Hydrogen → Neon)
    const nowIso2 = new Date().toISOString();
    req.effort = 'deep';
    if (from && WORKER_CAPS[from]?.includes(req.kind)) req.pinnedWorker = from;
    req.status = 'open';
    req.claimedBy = '';
    req.leaseUntil = null;
    req.context = `${req.context || ''}\n\n[${OUTSOURCE_WORKER_LABELS[from] || from || '작업자'} 하위 모델이 상위 모델로 올림 ${nowIso2.slice(5, 16)}] ${String(reason || '').slice(0, 600)}`.slice(0, 8000);
    req.updatedAt = nowIso2;
    req.history.push({ at: nowIso2, event: 'escalated:deep', by: from || 'worker' });
    appendLog(db, '외주 창구', `${req.id} — 깊은 판단이 필요해 상위 모델로 올렸습니다: ${String(reason || '').slice(0, 120)}`, 'info');
    saveDb(db);
    return req;
  }
  let dest = ['aside', 'antigravity', 'gemini'].includes(to) ? to : timeWorker(db.settings);
  if (dest === from) dest = from === 'antigravity' ? 'aside' : 'antigravity';
  if (!WORKER_CAPS[dest]?.includes(req.kind)) dest = 'antigravity';
  const nowIso = new Date().toISOString();
  req.pinnedWorker = dest;
  req.status = 'open';
  req.claimedBy = '';
  req.leaseUntil = null;
  req.context = `${req.context || ''}\n\n[${OUTSOURCE_WORKER_LABELS[from] || from || '작업자'}가 넘김 ${nowIso.slice(5, 16)}] ${String(reason || '').slice(0, 600)}`.slice(0, 8000);
  req.updatedAt = nowIso;
  req.history.push({ at: nowIso, event: `passed:${dest}`, by: from || 'worker' });
  appendLog(db, '외주 창구', `${req.id} — ${OUTSOURCE_WORKER_LABELS[from] || from}가 ${OUTSOURCE_WORKER_LABELS[dest]}에 넘겼습니다: ${String(reason || '').slice(0, 120)}`, 'info');
  saveDb(db);
  return req;
}

/** 대표님이 난이도 지정 (auto = 자동 판단으로 되돌림) */
export function setRequestEffort(id, effort = 'auto') {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  req.effort = EFFORT_LABELS[effort] ? effort : inferEffort({ ...req, effort: '' });
  req.updatedAt = new Date().toISOString();
  req.history.push({ at: req.updatedAt, event: `effort:${req.effort}`, by: 'CEO' });
  saveDb(db);
  return req;
}

/** 대표님이 라우팅을 바꾸면, 새 대상이 아닌 작업자가 잡고 있던 요청은 10분 안에 넘어가도록 작업 시간을 줄임 */
export function shortenForeignLeases(db) {
  const now = Date.now();
  for (const r of ensureList(db)) {
    if (r.status !== 'claimed' || !r.claimedBy) continue;
    if (resolveTarget(db.settings, r) === r.claimedBy) continue;
    const cap = now + 10 * 60 * 1000;
    if (Date.parse(r.leaseUntil || 0) > cap) r.leaseUntil = new Date(cap).toISOString();
  }
}

export function cancelRequest(id, by = 'CEO') {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  if (!['open', 'claimed', 'needs_ceo'].includes(req.status)) throw new Error('진행 중인 요청만 취소할 수 있습니다.');
  req.status = 'cancelled';
  req.updatedAt = new Date().toISOString();
  req.history.push({ at: req.updatedAt, event: 'cancelled', by });
  saveDb(db);
  return req;
}

/** 작업자가 잡고 사라진 요청은 다시 열어 다른 작업자가 가져갈 수 있게 함 */
export function releaseExpiredLeases(db) {
  const now = Date.now();
  const released = [];
  for (const r of ensureList(db)) {
    if (r.status === 'claimed' && Date.parse(r.leaseUntil || 0) < now) {
      r.status = 'open';
      r.history.push({ at: new Date().toISOString(), event: 'lease_expired', by: r.claimedBy });
      released.push(r.id);
      r.claimedBy = '';
      r.leaseUntil = null;
    }
  }
  return released;
}

export function buildPacket(db, req, baseUrl = publicBaseUrl(), { forChat = false } = {}) {
  const mission = db.missions.find((m) => m.id === req.missionId);
  const company = buildCompanyContext(db, req.missionId || '', { compact: true });
  const isCode = req.kind === 'code' || Boolean(req.repo);
  const lines = [
    `# 외주 요청서 ${req.id}`,
    '',
    `- 회사: ${db.settings.companyName || 'CEO Office'} (대표: ${db.settings.ceoName || '대표님'})`,
    `- 종류: ${OUTSOURCE_KIND_LABELS[req.kind]} · 난이도: ${EFFORT_LABELS[inferEffort(req)]}`,
    `- 지금 배정: ${OUTSOURCE_WORKER_LABELS[resolveTarget(db.settings, req)]}${req.pinnedWorker ? ' (대표님 지정)' : ''}`,
    `- 제목: ${req.title}`,
    mission ? `- 프로젝트: ${mission.title}${mission.mode === 'project' ? ` (Phase ${Number(mission.phase) || 1})` : ''}` : '',
    req.repo ? `- 저장소: https://github.com/${req.repo} (기준 브랜치 ${req.branch || 'main'})` : '',
    req.siteUrl || mission?.siteUrl ? `- 라이브 사이트: ${req.siteUrl || mission?.siteUrl}` : '',
    '',
    '## 왜 외주인가',
    req.reason || '무료 API 팀이 처리하기 어려운 작업입니다.',
    '',
    '## 해야 할 일',
    req.goal || req.title,
    '',
    '## 제출물',
    req.deliverable ||
      (req.kind === 'consult'
        ? '1) 총평(한 줄) 2) 사실과 다르거나 근거 없는 주장 3) 빠진 리스크 4) 바로 실행할 개선안 3가지 5) 이 제안을 승인해도 되는지 의견(승인/수정 후 승인/반려)'
        : isCode
          ? `저장소에 브랜치 \`out/${req.id}\`로 작업하고 제목에 [${req.id}]를 넣은 PR을 연 뒤, PR 주소와 변경 요약을 제출`
          : '바로 쓸 수 있는 결과 문서(마크다운). 실제로 확인한 사실과 추정을 구분해서 적을 것'),
    '',
    req.lastCeoAction ? `## 대표님이 처리해 준 것\n${req.lastCeoAction.action}${req.lastCeoAction.detail ? ` — ${req.lastCeoAction.detail}` : ''}` : '',
    req.context ? `## 맥락 (무료 팀 작업 내용 등)\n${req.context}` : '',
    company ? `\n## 회사 지침·기억 (반드시 지킬 것)\n${company}` : '',
    '',
    '## 지켜야 할 것',
    '- 결제, 광고비 집행, 외부 사람에게 메일·메시지 발송은 하지 말 것 (필요하면 초안만)',
    '- 비밀키·토큰을 코드나 결과 문서에 쓰지 말 것',
    isCode ? `- main 브랜치에 직접 푸시 금지. PR만 열 것 (대표님 결재 후 자동 머지·배포됨). data/db.json·.env·.github/ 수정 금지` : '',
    '- 실제로 확인하지 않은 수치·결과를 확인한 것처럼 쓰지 말 것',
    '',
    '## 대표님 손이 필요하면 (멈추고 알리기)',
    `로그인, 2단계 인증, CAPTCHA, 결제·발송 승인처럼 대표님만 할 수 있는 순간에는 억지로 진행하지 말고 MCP request_ceo_action 또는 POST ${baseUrl}/api/outsourcing/${req.id}/need-ceo 본문 {"worker":"...","action":"무엇이 필요한지 한 줄","detail":"어디서 무엇을 하면 되는지"} 로 알리세요. 대표님이 처리하고 재개하면 다시 대기열에 올라옵니다.`,
    `잡은 요청은 ${getOutsourcingSettings(db.settings).leaseMinutes}분 안에 제출하거나 같은 이름으로 다시 claim해서 연장하세요. 시간이 지나면 다른 작업자가 가져갈 수 있습니다.`,
    '',
    modelPlanLines(resolveTarget(db.settings, req), req),
    resolveTarget(db.settings, req) === 'gemini'
      ? [
          '## Gemini 앱 작업 규칙',
          '- 웹 검색·Deep Research로 근거를 확인하고, 수치·주장마다 출처 링크를 붙일 것',
          '- 저장소에 코드를 쓰거나, 로그인이 필요한 사이트에서 작업해야 하면 직접 하지 말고 pass_outsourcing_request로 넘길 것 (코드 → antigravity, 로그인·콘솔 → aside)',
          '- 결과는 submit_outsourcing_result로 제출 (worker: gemini). 대화창에 답만 쓰고 끝내지 말 것',
          ''
        ].join('\n')
      : '',
    '## 진행·제출 방법 (편한 것 하나)',
    `1. MCP (Antigravity·Gemini 앱): \`claim_outsourcing_request\` → 작업 → \`submit_outsourcing_result\` (request_id: ${req.id}). 내가 못 하는 일이면 \`pass_outsourcing_request\`로 넘기기`,
    `2. HTTPS: \`POST ${baseUrl}/api/outsourcing/${req.id}/claim\` → \`POST ${baseUrl}/api/outsourcing/${req.id}/submit\` 본문 {"worker":"antigravity|aside|gemini","summary":"...","document":"마크다운","prUrl":"(코드면 PR 주소)"} · 인증: 헤더 x-ceo-key 또는 ?token=MCP토큰`,
    `3. 웹: ${baseUrl} → 외부 협업 → ${req.id} → 결과 붙여넣기`
  ];
  if (forChat) {
    const cut = lines.findIndex((l) => typeof l === 'string' && l.startsWith('## 대표님 손이 필요하면'));
    const kept = cut > 0 ? lines.slice(0, cut) : lines;
    kept.push(
      '## 답변 형식',
      '- 첫 줄: 결과 요약 2~4문장',
      '- 그 아래: 결과 문서 전문 (마크다운). 실제 확인한 사실과 추정을 구분',
      '- 로그인·결제 승인처럼 대표님이 직접 해야 할 일이 있으면 맨 앞줄에 [대표님 필요: 할 일 한 줄]이라고 쓰고 이유와 방법을 적을 것',
      '- 코드 수정이 필요하면 바꿀 파일 경로와 바꿀 내용을 구체적으로 (CEO Office IT팀이 PR로 반영함)'
    );
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
