// hub/dev-policy.js: 개발 지침 (코드 작업을 누가 어떻게 할지) + 개발팀(Aside·AGY)에게 직접 배정
//  - Aside와 AGY는 같은 회사 개발팀 팀원 (agent_aside, agent_agy). 일은 기존 작업 큐(/api/outsourcing)로 주고받음
//  - 기본 지침: 작은 수정 → Aside / 큰 구현 → AGY 구현 + Aside 검수 / 위험·애매 → Aside 설계 → 대표님 확인 → AGY 구현 + Aside 검수 / 운영 장애 → Aside
import { appendLog, flushCloudBackup, loadDb, saveDb, uid } from '../store.js';
import { createOutsourcingRequest, findRequest } from '../outsourcing.js';
import { notifyOutsourceCreated, outsourceTask } from './task-results.js';
import { notifyAllApprovalChannels } from './notify.js';

export const DEV_ROUTES = {
  aside: 'Aside 혼자 (수정·자체 검수)',
  agy: 'AGY 혼자 (구현·테스트·PR)',
  agy_aside: 'AGY 구현 → Aside 검수',
  design_first: 'Aside 설계 → 대표님 확인 → AGY 구현 → Aside 검수'
};
export const DEV_CASES = {
  small: '작은 수정 (파일 1~2개, 할 일이 분명)',
  large: '보통~큰 구현 (여러 파일, 테스트 필요)',
  risky: '애매하거나 위험한 일 (구조 변경·데이터·보안·돈)',
  incident: '운영 중 문제 (배포 후 오류·데이터 이상)'
};
export const DEFAULT_DEV_POLICY = { small: 'aside', large: 'agy_aside', risky: 'design_first', incident: 'aside' };
/** 개발팀 팀원 → 작업 큐 작업자 */
export const DEV_TEAM = { agent_agy: 'antigravity', agent_aside: 'aside' };

export function getDevPolicy(settings = {}) {
  const p = settings?.devPolicy || {};
  const out = {};
  for (const k of Object.keys(DEFAULT_DEV_POLICY)) out[k] = DEV_ROUTES[p[k]] ? p[k] : DEFAULT_DEV_POLICY[k];
  return out;
}

export function normalizeDevPolicy(input = {}, current = {}) {
  const out = { ...getDevPolicy({ devPolicy: current }) };
  for (const k of Object.keys(DEFAULT_DEV_POLICY)) if (DEV_ROUTES[input?.[k]]) out[k] = input[k];
  return out;
}

const INCIDENT_RE = /(장애|긴급|운영\s*오류|배포\s*실패|서비스\s*다운|접속\s*안\s*됨|먹통)/;
const RISKY_RE = /(아키텍처|구조\s*변경|마이그레이션|db\.json|데이터\s*(이전|삭제|구조)|인증|토큰|보안\s*(수정|패치)|결제|과금|권한)/i;

export function classifyCodeWork(spec = {}) {
  const text = `${spec.title || ''} ${spec.description || ''}`;
  if (spec.incident || INCIDENT_RE.test(text)) return 'incident';
  if (spec.risky || RISKY_RE.test(text)) return 'risky';
  if (spec.codeSize === 'small') return 'small';
  return 'large';
}

/** 팀장 계획 프롬프트에 붙는 개발 지침 */
export function devPolicyRules(settings) {
  const p = getDevPolicy(settings);
  return [
    '개발 지침(코드 작업):',
    '- 코드·사이트 수정이 필요한 작업은 isCodeChange=true로 표시하고, codeSize(small: 파일 1~2개·할 일이 분명 / large: 여러 파일·테스트 필요)와 risky(구조 변경·데이터·보안·돈이 걸리면 true)를 적으세요.',
    '- 코드 작업의 담당은 서버가 아래 지침대로 정합니다:',
    ...Object.keys(DEV_CASES).map((k) => `  · ${DEV_CASES[k]} → ${DEV_ROUTES[p[k]]}`),
    '- Aside·AGY는 같은 회사 개발팀입니다. 코드가 아닌 일도 Aside(로그인된 브라우저·계정·실데이터 확인·설계 문서)와 AGY(로컬 실행이 필요한 일)에게 직접 배정할 수 있습니다.'
  ].join('\n');
}

const DESIGN_DELIVERABLE =
  '1단계 설계서(마크다운)만 제출: 목표·완료 기준·건드릴 파일과 함수·하위 호환(기존 API 필드 유지)·테스트 계획·위험과 되돌리는 방법. 이 단계에서는 코드를 수정하거나 PR을 열지 말 것. 설계서를 document로 submit하면 대표님 확인 후 AGY가 구현합니다.';

/** 코드 작업을 개발 지침대로 개발팀에 보냄 */
export function routeCodeTask(db, task, spec = {}) {
  const policy = getDevPolicy(db.settings);
  const kase = classifyCodeWork({ ...spec, title: spec.title || task.title, description: spec.description || task.description });
  const route = policy[kase];
  const toAside = route === 'aside' || route === 'design_first';
  const req = outsourceTask(db, task, { kind: 'code', worker: toAside ? 'aside' : 'antigravity', reason: `개발 지침: ${DEV_CASES[kase]} → ${DEV_ROUTES[route]}` });
  if (!req) return null;
  req.pinnedWorker = toAside ? 'aside' : 'antigravity';
  req.codeWorkflow = route === 'agy_aside' ? 'agy_then_aside' : route === 'design_first' ? 'design_first' : '';
  req.devCase = kase;
  if (route === 'design_first') req.deliverable = DESIGN_DELIVERABLE;
  const member = toAside ? 'agent_aside' : 'agent_agy';
  if (db.agents.some((a) => a.id === member)) task.assigneeId = member;
  return req;
}

/** 개발팀(Aside·AGY)에게 배정된 일반 작업 → 작업 큐로 바로 보냄 */
export function dispatchDevTeamTask(db, task) {
  const worker = DEV_TEAM[task.assigneeId];
  if (!worker || !['queued', 'awaiting_bridge'].includes(task.status)) return null;
  const req = outsourceTask(db, task, { kind: 'task', worker, reason: `개발팀 ${worker === 'aside' ? 'Aside' : 'AGY'} 직접 배정` });
  if (req) req.pinnedWorker = worker;
  return req;
}

/** 설계 단계 제출 → 대표님 확인 결재 카드 */
export function createDesignApproval(db, req, mission) {
  const r = req.result || {};
  const nowIso = new Date().toISOString();
  const apr = {
    id: uid('apr'),
    kind: 'dev_design',
    missionId: req.missionId || '',
    taskId: req.taskId || '',
    taskIds: req.taskId ? [req.taskId] : [],
    agentId: 'agent_aside',
    title: `[개발 설계] ${String(req.title || '').replace(/^\[[^\]]*\]\s*/, '')}`.slice(0, 140),
    category: 'dev',
    estimatedCostKRW: 0,
    depositKRW: 0,
    summary: `${r.summary ? `${r.summary}\n\n` : ''}${String(r.document || '').slice(0, 9000)}`,
    proposedAction: '승인하면 AGY가 이 설계대로 구현하고 Aside가 검수한 뒤 결재로 올립니다. 수정 지시를 주시면 메모를 반영해 Aside가 설계를 다시 씁니다.',
    status: 'pending',
    ceoNote: '',
    createdAt: nowIso,
    designRequestId: req.id
  };
  db.approvals.unshift(apr);
  req.designApprovalId = apr.id;
  appendLog(db, '개발팀', `"${req.title}" 설계서가 도착해 대표님 확인을 요청했습니다 (${req.id}).`, 'approval');
  notifyAllApprovalChannels(db.settings, apr, 'Aside (개발 설계)');
  return apr;
}

/** 설계 결재 결과: 승인 → AGY 구현 + Aside 검수, 수정 → Aside 재설계, 반려 → 작업 접기 */
export async function handleDevDesignDecision(apr, decision, note = '') {
  const db = loadDb();
  const req = findRequest(db, apr.designRequestId);
  if (!req) return false;
  const task = req.taskId ? db.tasks.find((t) => t.id === req.taskId) : null;
  const design = String(req.result?.document || '').slice(0, 6000);
  const memo = String(note || '').trim();
  const base = { missionId: req.missionId, taskId: req.taskId, repo: req.repo, branch: req.branch, siteUrl: req.siteUrl, context: req.context, createdBy: 'CEO' };
  if (decision === 'approved') {
    const { request, created } = createOutsourcingRequest(db, {
      ...base,
      kind: 'code',
      worker: 'antigravity',
      pinnedWorker: 'antigravity',
      codeWorkflow: 'agy_then_aside',
      title: String(req.title || '').slice(0, 120),
      goal: `${req.goal || req.title}\n\n## 대표님이 확인한 설계서 (이대로 구현)\n${design}${memo ? `\n\n[대표님 메모] ${memo}` : ''}`,
      reason: '설계 승인 → AGY 구현 → Aside 검수'
    });
    if (task) {
      task.status = 'outsourced';
      task.outsourceId = request.id;
      if (db.agents.some((a) => a.id === 'agent_agy')) task.assigneeId = 'agent_agy';
      task.updatedAt = new Date().toISOString();
    }
    if (created) notifyOutsourceCreated(db, request);
    appendLog(db, '개발팀', `설계 승인 → AGY 구현 시작 (${request.id})`, 'info');
  } else if (decision === 'revision_requested') {
    const { request, created } = createOutsourcingRequest(db, {
      ...base,
      kind: 'code',
      worker: 'aside',
      pinnedWorker: 'aside',
      title: String(req.title || '').slice(0, 120),
      goal: `${req.goal || req.title}\n\n## 이전 설계서\n${design}\n\n## 대표님 수정 지시 (반영해서 설계서를 다시 쓸 것)\n${memo || '(메모 없음)'}`,
      deliverable: DESIGN_DELIVERABLE,
      reason: '설계 수정 지시 → Aside 재설계'
    });
    request.codeWorkflow = 'design_first';
    if (task) {
      task.status = 'outsourced';
      task.outsourceId = request.id;
      task.updatedAt = new Date().toISOString();
    }
    if (created) notifyOutsourceCreated(db, request);
    appendLog(db, '개발팀', `설계 수정 지시 → Aside 재설계 (${request.id})`, 'info');
  } else if (task) {
    task.status = 'rejected';
    task.updatedAt = new Date().toISOString();
    appendLog(db, '개발팀', `설계 반려 → "${task.title}" 작업을 접었습니다.`, 'warning');
  }
  saveDb(db);
  await flushCloudBackup(db);
  return true;
}
