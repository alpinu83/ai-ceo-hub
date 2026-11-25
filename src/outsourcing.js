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
 * - 그 밖의 AI(모바일 앱 등): 웹 화면에서 요청서 복사 → 결과 붙여넣기
 */
import { loadDb, saveDb, appendLog } from './store.js';
import { buildCompanyContext } from './lead-engine.js';

export const OUTSOURCE_WORKER_LABELS = {
  antigravity: 'Antigravity',
  aside: 'Aside',
  any: '먼저 잡는 쪽'
};
export const OUTSOURCE_KIND_LABELS = {
  task: '실무 작업',
  code: '코드 수정',
  consult: '외부 자문',
  browser: '브라우저·계정 작업',
  research: '심층 리서치'
};

let handlers = { onSubmitted: null, onCreated: null };
export function setOutsourcingHandlers(h = {}) {
  handlers = { ...handlers, ...h };
}

export function getOutsourcingSettings(settings) {
  const o = settings?.outsourcing || {};
  return {
    enabled: o.enabled !== false,
    autoOnFailure: o.autoOnFailure !== false,
    autoForBrowser: o.autoForBrowser !== false,
    consultMode: ['off', 'proposals', 'proposals_and_reports'].includes(o.consultMode) ? o.consultMode : 'proposals',
    leaseHours: Math.min(24, Math.max(1, Number(o.leaseHours) || 3))
  };
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

export function listRequests(db, { status = 'active', worker = '' } = {}) {
  const list = ensureList(db);
  return list.filter((r) => {
    if (status === 'active' && !['open', 'claimed'].includes(r.status)) return false;
    if (status && status !== 'active' && status !== 'all' && r.status !== status) return false;
    if (worker && worker !== 'any' && r.worker !== 'any' && r.worker !== worker) return false;
    return true;
  });
}

export function summarizeRequest(r) {
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: OUTSOURCE_KIND_LABELS[r.kind],
    title: r.title,
    status: r.status,
    preferredWorker: r.worker,
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
    throw new Error(`${req.claimedBy}가 작업 중입니다 (${req.leaseUntil}까지).`);
  }
  const lease = getOutsourcingSettings(db.settings).leaseHours;
  req.status = 'claimed';
  req.claimedBy = String(worker || 'any').slice(0, 40);
  req.claimedAt = new Date().toISOString();
  req.leaseUntil = new Date(now + lease * 3600 * 1000).toISOString();
  req.updatedAt = req.claimedAt;
  req.history.push({ at: req.claimedAt, event: 'claimed', by: req.claimedBy });
  appendLog(db, '외주 창구', `${req.id} — ${req.claimedBy}가 작업을 시작했습니다.`, 'info');
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

export function cancelRequest(id, by = 'CEO') {
  const db = loadDb();
  const req = findRequest(db, id);
  if (!req) throw new Error(`외주 요청을 찾을 수 없습니다: ${id}`);
  if (!['open', 'claimed'].includes(req.status)) throw new Error('진행 중인 요청만 취소할 수 있습니다.');
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

export function buildPacket(db, req, baseUrl = publicBaseUrl()) {
  const mission = db.missions.find((m) => m.id === req.missionId);
  const company = buildCompanyContext(db, req.missionId || '', { compact: true });
  const isCode = req.kind === 'code' || Boolean(req.repo);
  const lines = [
    `# 외주 요청서 ${req.id}`,
    '',
    `- 회사: ${db.settings.companyName || 'CEO Office'} (대표: ${db.settings.ceoName || '대표님'})`,
    `- 종류: ${OUTSOURCE_KIND_LABELS[req.kind]}`,
    `- 권장 작업자: ${OUTSOURCE_WORKER_LABELS[req.worker]}${req.worker !== 'any' ? ' (다른 작업자가 해도 됨)' : ''}`,
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
    req.context ? `## 맥락 (무료 팀 작업 내용 등)\n${req.context}` : '',
    company ? `\n## 회사 지침·기억 (반드시 지킬 것)\n${company}` : '',
    '',
    '## 지켜야 할 것',
    '- 결제, 광고비 집행, 외부 사람에게 메일·메시지 발송은 하지 말 것 (필요하면 초안만)',
    '- 비밀키·토큰을 코드나 결과 문서에 쓰지 말 것',
    isCode ? `- main 브랜치에 직접 푸시 금지. PR만 열 것 (대표님 결재 후 자동 머지·배포됨). data/db.json·.env·.github/ 수정 금지` : '',
    '- 실제로 확인하지 않은 수치·결과를 확인한 것처럼 쓰지 말 것',
    '',
    '## 진행·제출 방법 (편한 것 하나)',
    `1. MCP (Antigravity 등): \`claim_outsourcing_request\` → 작업 → \`submit_outsourcing_result\` (request_id: ${req.id})`,
    `2. HTTPS: \`POST ${baseUrl}/api/outsourcing/${req.id}/claim\` → \`POST ${baseUrl}/api/outsourcing/${req.id}/submit\` 본문 {"worker":"antigravity|aside","summary":"...","document":"마크다운","prUrl":"(코드면 PR 주소)"} · 인증: 헤더 x-ceo-key 또는 ?token=MCP토큰`,
    `3. 웹: ${baseUrl} → 외부 협업 → ${req.id} → 결과 붙여넣기`
  ];
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
