// lead-desk.js: 팀장 업무함 (팀장 판단을 깨어 있는 팀장에게 보내고 결과를 받아 적용)
//
//  주간 팀장  : AGY 팀장 감시기 (Antigravity, Hydrogen 고정) · 최근 3분 안에 접속했을 때
//  야간 당직  : Gemini 앱 예약 작업 (MCP 도구로 가져가 처리, 1시간 안팎 주기)
//  비상 대비  : 기존 Gemini 무료 API (당직 팀장이 오래 처리하지 않으면)
//
//  - 대상은 백그라운드 판단만: 결과물 검수(review), 작전 계획(plan), 마일스톤 계획(milestone)
//  - 새 업무 분해·회의실 답변처럼 바로 답해야 하는 것은 Gemini API가 그대로 처리
//  - 서버는 기다리지 않음: 업무함에 올리고 "대기"로 돌려준 뒤, 결과가 제출되면 원래 일을 다시 이어서 처리
import { appendLog, loadDb, saveDb, uid } from './store.js';

export const LEAD_WORKERS = {
  agy_lead: 'AGY 팀장 (Hydrogen)',
  gemini_app: 'Gemini 앱 당직 팀장'
};
export const LEAD_ONLINE_MS = 3 * 60 * 1000; // 감시기가 이 시간 안에 접속했으면 근무 중
const LEASE_MS = { agy_lead: 6 * 60 * 1000, gemini_app: 40 * 60 * 1000 };
const AGY_GIVEUP_MS = 15 * 60 * 1000; // AGY가 잡지 못하고 15분 지나면 당직 팀장에게
const GEMINI_APP_GIVEUP_MS = 100 * 60 * 1000; // 당직 팀장이 100분 안에 못 하면 Gemini API로
const KEEP_MS = 24 * 3600 * 1000;
const MAX_JOBS = 200;

export class LeadPendingError extends Error {
  constructor(job) {
    super(`팀장 판단 대기 중 (${LEAD_WORKERS[job.worker] || job.worker} · ${job.id})`);
    this.code = 'LEAD_PENDING';
    this.jobId = job.id;
  }
}
export const isLeadPending = (err) => err?.code === 'LEAD_PENDING';

let jobHandler = null;
/** 결과가 제출되면 원래 일(검수·계획)을 이어서 처리하는 훅 (hub에서 등록) */
export function setLeadJobHandler(fn) {
  jobHandler = typeof fn === 'function' ? fn : null;
}

function jobs(db) {
  if (!Array.isArray(db.leadJobs)) db.leadJobs = [];
  return db.leadJobs;
}

export function getLeadDeskSettings(settings = {}) {
  const c = settings.leadDesk || {};
  return { enabled: c.enabled !== false };
}

export function leadWorkerSeenAt(db, worker) {
  return db.agentConnections?.[`lead:${worker}`]?.lastSeenAt || null;
}
export function leadWorkerOnline(db, worker) {
  const at = leadWorkerSeenAt(db, worker);
  return Boolean(at) && Date.now() - Date.parse(at) < LEAD_ONLINE_MS;
}
export function touchLeadWorker(db, worker, action = 'poll') {
  if (!LEAD_WORKERS[worker]) return;
  if (!db.agentConnections || typeof db.agentConnections !== 'object') db.agentConnections = {};
  db.agentConnections[`lead:${worker}`] = { lastSeenAt: new Date().toISOString(), lastAction: action };
}

/** 지금 팀장 근무 상태 (화면·텔레그램 표시용) */
export function leadDeskStatus(db) {
  const agy = leadWorkerOnline(db, 'agy_lead');
  const list = jobs(db);
  return {
    enabled: getLeadDeskSettings(db.settings).enabled,
    onDuty: agy ? 'agy_lead' : 'gemini_app',
    onDutyLabel: agy ? '주간 팀장: AGY (Hydrogen)' : '당직 팀장: Gemini 앱',
    agyLastSeenAt: leadWorkerSeenAt(db, 'agy_lead'),
    geminiAppLastSeenAt: leadWorkerSeenAt(db, 'gemini_app'),
    open: list.filter((j) => ['open', 'claimed'].includes(j.status)).length,
    doneToday: list.filter((j) => ['done', 'used'].includes(j.status) && Date.now() - Date.parse(j.doneAt || 0) < 24 * 3600 * 1000).length
  };
}

/** 회의실·보고 발신자 표기용: 팀장 업무함 가동 중이면 현재 근무 팀장(주간 AGY / 당직 Gemini 앱) 프로필 반환 */
export function leadSpeakerProfile(db) {
  if (!getLeadDeskSettings(db?.settings).enabled) return null;
  const agy = leadWorkerOnline(db, 'agy_lead');
  return agy
    ? { id: 'agent_gemini_neon', name: '총괄 팀장 (AGY · Hydrogen)', roleTitle: '주간 총괄 팀장 · AGY (Hydrogen)', shortCode: 'AG', accent: '#0E6245', onDuty: 'agy_lead' }
    : { id: 'agent_gemini_neon', name: '총괄 팀장 (Gemini 앱 당직)', roleTitle: '당직 총괄 팀장 · Gemini 앱', shortCode: '팀장', accent: '#2563EB', onDuty: 'gemini_app' };
}

/** 주간 AGY 팀장 또는 야간 Gemini 앱 당직이 실제 연결돼 있는지 (API 전멸 시 팀장 업무함 진행 가능 여부) */
export function hasLeadDeskWorker(db = loadDb()) {
  if (!getLeadDeskSettings(db?.settings).enabled) return false;
  return Boolean(leadWorkerOnline(db, 'agy_lead') || leadWorkerSeenAt(db, 'gemini_app'));
}

// ---------- zod 스키마 → 답안 형식 안내 ----------
function describeZod(s, depth = 0) {
  const def = s?._def || {};
  const desc = s?.description || def.description || '';
  const t = def.typeName;
  if (t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault') return describeZod(def.innerType, depth);
  if (t === 'ZodEffects') return describeZod(def.schema, depth);
  if (t === 'ZodObject') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape || {};
    const out = {};
    for (const [k, v] of Object.entries(shape)) out[k] = describeZod(v, depth + 1);
    return out;
  }
  if (t === 'ZodArray') return [describeZod(def.type, depth + 1)];
  if (t === 'ZodEnum') return `${def.values.join(' | ')}${desc ? ` (${desc})` : ''}`;
  if (t === 'ZodLiteral') return def.value;
  if (t === 'ZodBoolean') return `true | false${desc ? ` (${desc})` : ''}`;
  if (t === 'ZodNumber') return `숫자${desc ? ` (${desc})` : ''}`;
  return `문자열${desc ? ` (${desc})` : ''}`;
}
export function schemaHint(schema) {
  try {
    return JSON.stringify(describeZod(schema), null, 2);
  } catch {
    return '{}';
  }
}

/** 제출된 답에서 JSON 객체를 꺼냄 (코드펜스·앞뒤 설명 허용) */
export function extractJson(text) {
  if (text && typeof text === 'object') return text;
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  try {
    return JSON.parse(body);
  } catch {}
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(body.slice(a, b + 1));
    } catch {}
  }
  return null;
}

function prune(db) {
  const list = jobs(db);
  const now = Date.now();
  db.leadJobs = list.filter((j) => ['open', 'claimed'].includes(j.status) || now - Date.parse(j.updatedAt || j.createdAt) < KEEP_MS).slice(0, MAX_JOBS);
}

/** 잡혔는데 시간 안에 못 낸 일은 다시 열고, 근무 상태에 맞게 담당을 다시 정함 */
export function refreshLeadJobs(db) {
  const now = Date.now();
  const agy = leadWorkerOnline(db, 'agy_lead');
  let changed = false;
  for (const j of jobs(db)) {
    if (j.status === 'claimed' && j.leaseUntil && Date.parse(j.leaseUntil) < now) {
      j.status = 'open';
      j.claimedBy = '';
      j.leaseUntil = null;
      changed = true;
    }
    if (j.status !== 'open') continue;
    const age = now - Date.parse(j.queuedAt || j.createdAt);
    if (j.worker === 'gemini_app' && agy) {
      j.worker = 'agy_lead';
      j.queuedAt = new Date().toISOString();
      changed = true;
    } else if (j.worker === 'agy_lead' && !agy && age > AGY_GIVEUP_MS) {
      j.worker = 'gemini_app';
      j.queuedAt = new Date().toISOString();
      changed = true;
    } else if (j.worker === 'gemini_app' && age > GEMINI_APP_GIVEUP_MS) {
      j.status = 'expired';
      j.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) prune(db);
  return changed;
}

/**
 * 팀장 판단 요청. 반환:
 *  - { object, label } : 이미 받은 답이 있음
 *  - null              : 업무함을 쓰지 않음(꺼짐/만료/실패) → 호출한 쪽이 Gemini API로 처리
 *  - throw LeadPendingError : 업무함에 올림, 답이 오면 hub가 원래 일을 다시 실행
 */
export function askLeadDesk({ key, purpose, system, prompt, schema, refs = {} }) {
  const db = loadDb();
  if (!getLeadDeskSettings(db.settings).enabled || !key) return null;
  refreshLeadJobs(db);
  const list = jobs(db);
  const job = list.find((j) => j.key === key);
  if (job?.status === 'done') {
    const parsed = schema ? schema.safeParse(job.result) : { success: true, data: job.result };
    if (parsed.success) {
      job.status = 'used';
      job.updatedAt = new Date().toISOString();
      saveDb(db);
      return { object: parsed.data, label: `${job.claimedBy || job.worker}:lead-desk` };
    }
    job.status = 'invalid';
    job.error = String(parsed.error?.message || '형식 오류').slice(0, 300);
    appendLog(db, '팀장 업무함', `${job.id} 답 형식이 맞지 않아 Gemini API로 대신 판단합니다: ${job.error.slice(0, 120)}`, 'warning');
    saveDb(db);
    return null;
  }
  if (job && ['expired', 'invalid', 'used', 'failed'].includes(job.status)) return null;
  if (job) throw new LeadPendingError(job);
  const nowIso = new Date().toISOString();
  const worker = leadWorkerOnline(db, 'agy_lead') ? 'agy_lead' : 'gemini_app';
  const created = {
    id: uid('ldj'),
    key,
    purpose: purpose || 'review',
    refs,
    worker,
    status: 'open',
    system: String(system || '').slice(0, 9000),
    prompt: String(prompt || '').slice(0, 14000),
    format: schema ? schemaHint(schema) : '{}',
    createdAt: nowIso,
    queuedAt: nowIso,
    updatedAt: nowIso,
    claimedBy: '',
    leaseUntil: null
  };
  list.unshift(created);
  prune(db);
  saveDb(db);
  throw new LeadPendingError(created);
}

const PURPOSE_LABELS = { review: '결과물 검수', plan: '작전 계획 수립', milestone: '마일스톤 판정·작업 계획' };

export function summarizeLeadJob(j) {
  return {
    id: j.id,
    purpose: j.purpose,
    purposeLabel: PURPOSE_LABELS[j.purpose] || j.purpose,
    worker: j.worker,
    status: j.status,
    claimedBy: j.claimedBy || '',
    createdAt: j.createdAt,
    queuedAt: j.queuedAt,
    doneAt: j.doneAt || null,
    title: String(j.prompt || '').split('\n')[0].slice(0, 120)
  };
}

/** 이 작업자가 지금 처리할 일: AGY 팀장은 모든 대기 일, Gemini 앱은 당직 몫만 */
export function listLeadJobs(db, worker = '') {
  refreshLeadJobs(db);
  return jobs(db).filter((j) => j.status === 'open' && (!worker || worker === 'agy_lead' || j.worker === worker));
}

export function buildLeadPacket(j) {
  return [
    `# 팀장 판단 요청 ${j.id} · ${PURPOSE_LABELS[j.purpose] || j.purpose}`,
    '',
    '당신은 CEO Office의 총괄 팀장입니다. 아래 [역할·원칙]과 [자료]를 읽고 판단한 뒤, [답안 형식]과 같은 JSON 하나만 제출하세요.',
    '- 코드 수정·파일 생성·외부 발송은 하지 말고 판단만 합니다.',
    '- 자료에 없는 사실을 지어내지 말고, 업무 브리핑의 "절대 하지 말 것"을 지키세요.',
    '',
    '## 역할·원칙',
    j.system,
    '',
    '## 자료',
    j.prompt,
    '',
    '## 답안 형식 (이 키 그대로, JSON만)',
    '```json',
    j.format,
    '```',
    '',
    '## 제출',
    `- MCP: submit_lead_job (job_id: ${j.id}, worker, result_json)`,
    `- HTTPS: POST /api/lead-jobs/${j.id}/submit 본문 {"worker":"agy_lead|gemini_app","result":{...JSON...}}`
  ].join('\n');
}

export function claimLeadJob(id, worker) {
  if (!LEAD_WORKERS[worker]) throw new Error(`알 수 없는 팀장 작업자: ${worker} (agy_lead 또는 gemini_app)`);
  const db = loadDb();
  refreshLeadJobs(db);
  const j = jobs(db).find((x) => x.id === id);
  if (!j) throw new Error(`팀장 판단 요청을 찾을 수 없습니다: ${id}`);
  if (j.status === 'claimed' && j.claimedBy && j.claimedBy !== worker) {
    const e = new Error(`이미 ${LEAD_WORKERS[j.claimedBy] || j.claimedBy}가 처리 중입니다.`);
    e.status = 409;
    throw e;
  }
  if (!['open', 'claimed'].includes(j.status)) {
    const e = new Error(`이미 끝난 요청입니다 (${j.status}).`);
    e.status = 409;
    throw e;
  }
  j.status = 'claimed';
  j.claimedBy = worker;
  j.leaseUntil = new Date(Date.now() + (LEASE_MS[worker] || LEASE_MS.agy_lead)).toISOString();
  j.updatedAt = new Date().toISOString();
  touchLeadWorker(db, worker, `claim ${j.id}`);
  saveDb(db);
  return j;
}

export async function submitLeadJob(id, { worker, result }) {
  if (!LEAD_WORKERS[worker]) throw new Error(`알 수 없는 팀장 작업자: ${worker}`);
  const db = loadDb();
  const j = jobs(db).find((x) => x.id === id);
  if (!j) throw new Error(`팀장 판단 요청을 찾을 수 없습니다: ${id}`);
  if (!['open', 'claimed'].includes(j.status)) {
    const e = new Error(`이미 끝난 요청입니다 (${j.status}).`);
    e.status = 409;
    throw e;
  }
  const obj = extractJson(result);
  if (!obj || typeof obj !== 'object') throw new Error('result에 JSON 객체를 넣어 주세요 (답안 형식 참고).');
  j.result = obj;
  j.status = 'done';
  j.claimedBy = j.claimedBy || worker;
  j.doneAt = new Date().toISOString();
  j.updatedAt = j.doneAt;
  touchLeadWorker(db, worker, `submit ${j.id}`);
  appendLog(db, '팀장 업무함', `${LEAD_WORKERS[worker]}가 ${PURPOSE_LABELS[j.purpose] || j.purpose} 판단을 제출했습니다 (${j.id}).`, 'info');
  saveDb(db);
  const snapshot = { id: j.id, purpose: j.purpose, refs: j.refs || {} };
  if (jobHandler) setTimeout(() => jobHandler(snapshot).catch((err) => console.warn('lead job handler failed:', err.message)), 200);
  return j;
}
