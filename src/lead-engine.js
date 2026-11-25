/**
 * Team Lead engine (팀장 능동 추진 엔진)
 *
 * API로 연결된 AI 팀원들은 호출할 때마다 기억이 없는(stateless) 모델입니다. 그래서 이 모듈이
 *  1) CEO 전역 지침(모든 팀원에게 항상 적용되는 규칙)
 *  2) 회사 기억(이전 지시·결재 결정·실행 결과)
 *  3) 업무별 진행 상태
 * 를 한 블록으로 만들어 모든 AI 호출에 주입합니다.
 *
 * 또한 팀장이 "물어볼 때까지 가만히 있지 않도록"
 *  - 작업 묶음이 끝나면 완료 보고서를 만들고
 *  - 정기적으로 미션을 점검해 막힌 일·오래된 결재·누락된 보고를 찾아냅니다.
 *
 * AI SDK를 import하지 않는 순수 함수만 두어 서버·테스트 어디서든 재사용할 수 있게 했습니다.
 */
import { uid } from './store.js';

export const DEFAULT_GLOBAL_DIRECTIVES = [
  '1. 지시받은 일이 끝나면(성공·실패·보류 모두) 총괄 팀장이 대표님께 먼저 결과를 보고한다. 대표님이 물어볼 때까지 기다리지 않는다.',
  '2. 막힌 일은 원인·대안·대표님이 해줘야 할 일(권한·키·결정)을 구체적으로 요청한다. 말없이 대기하지 않는다.',
  '3. 실제로 확인한 사실만 보고한다. 확인하지 않은 것은 "미확인"이라고 쓴다.',
  '4. 이전 지시·결재 결정·반려 사유를 기억하고 같은 실수를 반복하지 않는다.',
  '5. 결제·외부 발송·실배포처럼 되돌리기 어려운 일만 결재를 받고, 나머지 일반 실무는 팀장 전결로 끝까지 추진한다.'
].join('\n');

export const LEAD_ENGINE_DEFAULTS = {
  enabled: true,
  telegramReports: true, // 완료 보고·후속 추진 요약을 텔레그램으로도 보냄
  autoFollowUp: true, // 팀장이 정기적으로 미션을 점검하고 후속 업무를 스스로 배정
  followUpMinutes: 30, // 정기 점검 간격(분)
  maxAutoRounds: 2, // 대표님 개입 없이 팀장이 스스로 이어갈 수 있는 후속 라운드 수(미션별, 대표님이 말하면 초기화)
  reminderHours: 6 // 결재·외부 봇 대기가 이 시간 이상 멈춰 있으면 다시 알림
};

// 대표님의 "상시 지침"(앞으로/이제부터/~하지 마/이관 등) 감지 — 회의실 발언과 결재 메모 모두에 적용 (오타 '앛으로' 포함)
export const STANDING_ORDER_RE =
  /(기억해|기억하고|명심해|앞으로|앛으로|이제부터|지금부터|항상|절대|매번|잊지\s*마|하지\s*마|하지\s*말|하지\s*않|금지|이관|관련\s*없는|말고\s)/;

export function isStandingOrder(text = '') {
  const t = String(text || '').trim();
  if (t.length < 6) return false;
  if (/[?？]\s*$/.test(t)) return false;
  return STANDING_ORDER_RE.test(t);
}

/** 미션 범위: mission.scope = { focus: '집중할 일', exclude: ['하지 말 일 키워드', ...] } */
export function getMissionScope(mission) {
  const s = mission?.scope && typeof mission.scope === 'object' ? mission.scope : {};
  const exclude = (Array.isArray(s.exclude) ? s.exclude : String(s.exclude || '').split(','))
    .map((x) => String(x).trim())
    .filter((x) => x.length >= 2)
    .slice(0, 20);
  return { focus: String(s.focus || '').trim().slice(0, 600), exclude };
}

/** 작업/제안 텍스트가 미션의 금지 범위에 걸리면 걸린 키워드를 돌려줌 */
export function findScopeViolations(mission, text = '') {
  const { exclude } = getMissionScope(mission);
  if (!exclude.length) return [];
  const hay = String(text || '').toLowerCase().replace(/\s+/g, '');
  return exclude.filter((k) => hay.includes(k.toLowerCase().replace(/\s+/g, '')));
}

const MAX_FACTS = 150;
const MAX_PINNED = 20;
const EXTERNAL_ACTION_RE = /외부 권한 미연동|대표님 실행 가이드|대표님이 직접/;
// 보고서 머리말(수신·발신·담당·인사말 등)은 요약에서 제외
const BOILERPLATE_RE = /^(\(?\s*)?(수신|발신|담당|작성자?|위임자|날짜|일시|주제|목표|미션|대상 저장소|참고|to|from)\s*[:：–-]|^안녕하세요|^대표님,?\s*$|^총괄 팀장\(?.*\)?입니다|^모든 내용은 실제|기준\s*[–-]\s*실제/i;

function nowIso() {
  return new Date().toISOString();
}

export function kstShort(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

function oneLine(text, max = 200) {
  return String(text || '')
    .replace(/[>*`|]/g, ' ')
    .replace(/(^|\s)#{1,6}\s/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** First meaningful line(s) of a markdown output (skips headings, tables, quotes). */
export function leadLines(markdown, count = 2, max = 160) {
  return String(markdown || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(#|\||>|---|```)/.test(l))
    .map((l) => oneLine(l.replace(/^[-*\d.)\s]+/, ''), max))
    .filter((l) => l.length > 3 && !BOILERPLATE_RE.test(l.replace(/^\*+|\*+$/g, '').trim()))
    .slice(0, count);
}

export function ensureLeadDefaults(db) {
  let changed = false;
  if (!db.settings) db.settings = {};
  const s = db.settings;
  if (typeof s.globalDirectives !== 'string') {
    s.globalDirectives = DEFAULT_GLOBAL_DIRECTIVES;
    changed = true;
  }
  const merged = { ...LEAD_ENGINE_DEFAULTS, ...(s.leadEngine && typeof s.leadEngine === 'object' ? s.leadEngine : {}) };
  if (JSON.stringify(merged) !== JSON.stringify(s.leadEngine || null)) {
    s.leadEngine = merged;
    changed = true;
  }
  if (!db.memory || typeof db.memory !== 'object' || !Array.isArray(db.memory.facts)) {
    db.memory = { facts: Array.isArray(db.memory?.facts) ? db.memory.facts : [], updatedAt: '' };
    changed = true;
  }
  if (!db.leadState || typeof db.leadState !== 'object') {
    db.leadState = { missions: {}, lastFollowUpAt: '' };
    changed = true;
  }
  if (!db.leadState.missions || typeof db.leadState.missions !== 'object') {
    db.leadState.missions = {};
    changed = true;
  }
  return changed;
}

export function getLeadSettings(settings) {
  return { ...LEAD_ENGINE_DEFAULTS, ...(settings?.leadEngine || {}) };
}

export function missionLeadState(db, missionId) {
  ensureLeadDefaults(db);
  const key = missionId || '_global';
  if (!db.leadState.missions[key]) {
    db.leadState.missions[key] = {
      autoRounds: 0,
      lastReportAt: '',
      lastReportKey: '',
      lastActivityAt: '',
      reminded: {},
      lastCodeNote: null,
      closedAt: ''
    };
  }
  const st = db.leadState.missions[key];
  if (!st.reminded || typeof st.reminded !== 'object') st.reminded = {};
  return st;
}

/** CEO가 말하거나 결재하면 팀장 자율 라운드를 초기화 (대표님 의사가 새로 반영됐으므로) */
export function markCeoActivity(db, missionId) {
  const st = missionLeadState(db, missionId);
  st.autoRounds = 0;
  st.closedAt = '';
  st.lastActivityAt = nowIso();
}

// ---------------------------------------------------------------- memory

export function rememberFact(db, { text, kind = 'note', missionId = '', pinned = false, source = '' } = {}) {
  ensureLeadDefaults(db);
  const clean = oneLine(text, 400);
  if (!clean) return null;
  const facts = db.memory.facts;
  const ts = nowIso();
  const dup = facts.find((f) => f.text === clean && (f.missionId || '') === (missionId || ''));
  if (dup) {
    dup.createdAt = ts;
    if (pinned) dup.pinned = true;
    db.memory.updatedAt = ts;
    return dup;
  }
  const fact = { id: uid('mem'), text: clean, kind, missionId: missionId || '', pinned: Boolean(pinned), source, createdAt: ts };
  facts.unshift(fact);
  if (facts.length > MAX_FACTS) {
    const pinnedFacts = facts.filter((f) => f.pinned).slice(0, MAX_PINNED);
    const rest = facts.filter((f) => !f.pinned).slice(0, MAX_FACTS - pinnedFacts.length);
    db.memory.facts = [...pinnedFacts, ...rest].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  db.memory.updatedAt = ts;
  return fact;
}

export function forgetFact(db, factId) {
  ensureLeadDefaults(db);
  const before = db.memory.facts.length;
  db.memory.facts = db.memory.facts.filter((f) => f.id !== factId);
  return db.memory.facts.length !== before;
}

const KIND_LABEL = {
  directive: 'CEO 지시',
  decision: 'CEO 결정',
  result: '실행 결과',
  lesson: '교훈',
  note: '메모'
};

function formatFact(f, missionTitles) {
  const where = f.missionId ? missionTitles[f.missionId] || '' : '';
  return `- (${kstShort(f.createdAt)} · ${KIND_LABEL[f.kind] || '메모'}${where ? ` · ${where}` : ''}${f.pinned ? ' · 고정' : ''}) ${f.text}`;
}

/**
 * The shared context block injected into every AI call (team member work, team-lead chat, reports, IT PRs).
 * compact=true keeps it small for free tiers with tight per-minute token budgets.
 */
export function buildCompanyContext(db, missionId = '', { compact = false } = {}) {
  if (!db) return '';
  ensureLeadDefaults(db);
  const maxChars = compact ? 2400 : 4000;
  const missionTitles = Object.fromEntries((db.missions || []).map((m) => [m.id, m.title]));
  const directives = String(db.settings.globalDirectives || '').trim();
  const facts = db.memory.facts || [];

  // 고정 기억(대표님 지침·교훈)은 작은 모델에도 최대한 많이 전달
  // 다른 업무(미션)의 기억은 섞지 않음: 다른 프로젝트 이야기가 들어가면 그 일을 따라 하게 됨
  const missionPinned = missionId ? facts.filter((f) => f.pinned && f.missionId === missionId).slice(0, compact ? 8 : 12) : [];
  const globalPinned = facts.filter((f) => f.pinned && !f.missionId).slice(0, compact ? 6 : 10);
  const usedIds = new Set([...missionPinned, ...globalPinned].map((f) => f.id));
  const own = missionId ? facts.filter((f) => !usedIds.has(f.id) && f.missionId === missionId).slice(0, compact ? 6 : 12) : [];
  own.forEach((f) => usedIds.add(f.id));
  const global = facts.filter((f) => !usedIds.has(f.id) && !f.missionId).slice(0, compact ? 3 : 6);

  const parts = [];
  if (directives) parts.push(`[CEO 전역 지침 — 모든 AI 팀원 공통, 항상 최우선 적용]\n${directives}`);
  const missionObj = missionId ? (db.missions || []).find((m) => m.id === missionId) : null;
  const scope = getMissionScope(missionObj);
  if (missionObj && (scope.focus || scope.exclude.length || missionPinned.length)) {
    const sl = [];
    if (scope.focus) sl.push(`- 이 업무가 집중할 일: ${scope.focus}`);
    if (scope.exclude.length) sl.push(`- 이 업무에서 하지 말 것(다른 팀 담당): ${scope.exclude.join(', ')} — 관련 작업·제안·분석 금지`);
    for (const f of missionPinned) sl.push(`- (${kstShort(f.createdAt)}) ${f.text}`);
    parts.push(`["${missionObj.title}" 업무에 대한 대표님 고정 지침 — 최우선, 어기면 안 됨]\n${sl.join('\n')}`);
  }
  const memLines = [...globalPinned, ...own, ...global].map((f) => formatFact(f, missionTitles));
  if (memLines.length) parts.push(`[회사 기억 — 이전 지시·결정·결과 (최신순)]\n${memLines.join('\n')}`);

  const mission = missionId ? (db.missions || []).find((m) => m.id === missionId) : null;
  if (mission) {
    const tasks = (db.tasks || []).filter((t) => t.missionId === mission.id);
    const count = (s) => tasks.filter((t) => t.status === s).length;
    const codeLines = (db.approvals || [])
      .filter((a) => a.missionId === mission.id && (a.prNumber || a.codeChange))
      .sort((a, b) => String(b.codeChange?.updatedAt || b.createdAt || '').localeCompare(String(a.codeChange?.updatedAt || a.createdAt || '')))
      .slice(0, compact ? 2 : 4)
      .map(
        (a) =>
          `- ${a.prNumber ? `[${a.repo} PR #${a.prNumber}] ` : ''}${oneLine(a.title, 80)} → 결재 ${a.status}, 코드 ${a.codeChange?.status || '-'}${
            a.codeChange?.error ? ` (오류: ${oneLine(a.codeChange.error, 120)})` : ''
          }`
      );
    const st = db.leadState.missions[mission.id];
    const lines = [
      `- 업무: ${mission.title} (상태 ${mission.status}${mission.mode === 'project' ? `, Phase ${Number(mission.phase) || 1}` : ''})`,
      `- 작업: 완료 ${count('completed')} · 진행 ${count('running') + count('queued')} · 결재 대기 ${count('awaiting_approval')} · 외부 봇 대기 ${count('awaiting_bridge')}`,
      ...codeLines,
      st?.lastCodeNote?.message ? `- 최근 IT팀 판단: ${oneLine(st.lastCodeNote.message, 160)}` : ''
    ].filter(Boolean);
    parts.push(`[이 업무의 현재 상태]\n${lines.join('\n')}`);
  }

  let out = parts.join('\n\n');
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 20)}\n…(이하 생략)`;
  return out;
}

// ---------------------------------------------------------------- reports

/**
 * Build the Team Lead's completion report for a batch of tasks that just finished.
 * Returns { title, text (meeting room markdown), telegram (HTML-safe plain lines), needsCeo: string[] }
 */
export function buildCompletionReport(db, missionId, taskIds = [], { codeResult = null } = {}) {
  const mission = (db.missions || []).find((m) => m.id === missionId);
  if (!mission) return null;
  const agentMap = Object.fromEntries((db.agents || []).map((a) => [a.id, a]));
  const idSet = new Set(taskIds);
  const batch = (db.tasks || []).filter((t) => idSet.has(t.id));
  if (!batch.length) return null;

  const done = batch.filter((t) => t.status === 'completed');
  const waitingApproval = batch.filter((t) => t.status === 'awaiting_approval');
  const notDone = batch.filter((t) => !['completed', 'awaiting_approval', 'rejected'].includes(t.status));
  const needsCeo = [];

  const lines = [];
  lines.push(`**[팀장 완료 보고] ${mission.title}**`);
  lines.push(`이번 작업 ${batch.length}건: 완료 ${done.length} · 결재 대기 ${waitingApproval.length} · 미완료 ${notDone.length}`);

  // 최신 작업부터 보여 주고, 나머지는 개수만
  const doneSorted = [...done].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  for (const t of doneSorted.slice(0, 5)) {
    const first = leadLines(t.output, 1, 120)[0];
    lines.push(`- 완료: ${t.title} (${agentMap[t.assigneeId]?.name || '팀원'})${first ? ` — ${first}` : ''}`);
  }
  if (doneSorted.length > 5) lines.push(`- 외 완료 ${doneSorted.length - 5}건`);
  const warned = batch.filter((t) => (t.quality?.factIssuesAfter || []).length);
  if (warned.length) {
    needsCeo.push(
      `자동 사실 확인에서 고치지 못한 오류가 남은 결과 ${warned.length}건(결과 맨 위 ⚠️ 표시): ${warned
        .slice(0, 3)
        .map((t) => `"${t.title}"`)
        .join(', ')} — 그대로 실행하지 마세요.`
    );
  }
  const fixedCount = batch.filter((t) => (t.quality?.factIssues || []).length && !(t.quality?.factIssuesAfter || []).length).length;
  if (fixedCount) lines.push(`- 자동 사실 확인: ${fixedCount}건의 결과에서 없는 파일·지어낸 수치 등을 찾아 고쳤습니다.`);
  const externalTitles = done.filter((t) => EXTERNAL_ACTION_RE.test(String(t.output || ''))).map((t) => `"${t.title}"`);
  if (externalTitles.length) {
    needsCeo.push(
      `대표님이 직접 하셔야 할 외부 작업 체크리스트가 있는 결과 ${externalTitles.length}건: ${externalTitles.slice(0, 3).join(', ')}${externalTitles.length > 3 ? ' 등' : ''}`
    );
  }
  for (const t of waitingApproval.slice(0, 4)) {
    lines.push(`- 결재 대기: ${t.title}`);
    needsCeo.push(`결재함에서 "${t.title}" 승인 여부를 정해 주세요.`);
  }
  for (const t of notDone.slice(0, 4)) {
    lines.push(`- 미완료: ${t.title} (상태 ${t.status}${t.autoRetryExhausted ? ', 자동 재시도 소진' : ''})`);
  }

  // Code/PR outcome for repo-linked missions
  const st = db.leadState?.missions?.[missionId];
  const codeApr = (db.approvals || [])
    .filter((a) => a.missionId === missionId && (a.prNumber || a.codeChange))
    .sort((a, b) => String(b.codeChange?.updatedAt || b.createdAt || '').localeCompare(String(a.codeChange?.updatedAt || a.createdAt || '')))[0];
  if (codeResult?.prNumber) {
    lines.push(`- 코드 반영: [${codeResult.repo}] PR #${codeResult.prNumber} 작성 완료 (${(codeResult.changedFiles || []).join(', ')}). 승인하시면 머지·배포까지 자동 진행합니다.`);
    needsCeo.push(`PR #${codeResult.prNumber} 결재(승인/수정/반려)가 필요합니다.`);
  } else if (st?.lastCodeNote && Date.now() - new Date(st.lastCodeNote.at).getTime() < 30 * 60 * 1000) {
    if (st.lastCodeNote.status === 'failed') {
      lines.push(`- 코드 반영 실패: ${oneLine(st.lastCodeNote.message, 200)}`);
      needsCeo.push(codeFailureHelp(st.lastCodeNote.message));
    } else if (st.lastCodeNote.status === 'none') {
      lines.push(`- 코드 반영: IT팀 판단으로 저장소 수정 없음 — ${oneLine(st.lastCodeNote.message, 160)}`);
    }
  } else if (codeApr?.codeChange?.status === 'failed') {
    lines.push(`- 코드 반영 실패: ${oneLine(codeApr.codeChange.error, 200)}`);
    needsCeo.push(codeFailureHelp(codeApr.codeChange.error));
  }

  const summary = leadLines(mission.finalReport, 2, 160);
  if (summary.length) lines.push(`핵심 요약: ${summary.join(' / ')}`);

  if (needsCeo.length) {
    lines.push('');
    lines.push('**대표님 확인이 필요한 일**');
    for (const n of [...new Set(needsCeo)].slice(0, 5)) lines.push(`- ${n}`);
  } else if (!notDone.length) {
    lines.push('대표님이 따로 처리하실 일은 없습니다. 필요한 후속 작업은 팀장이 이어서 검토합니다.');
  }

  const text = lines.join('\n');
  const reportKey = `${missionId}:${batch
    .map((t) => `${t.id}:${t.status}`)
    .sort()
    .join(',')}`;
  return {
    title: `완료 보고: ${mission.title}`,
    text,
    telegram: text.replace(/\*\*/g, ''),
    needsCeo: [...new Set(needsCeo)],
    reportKey
  };
}

export function codeFailureHelp(message = '') {
  const msg = String(message || '');
  if (/403|Resource not accessible/i.test(msg)) {
    return 'GitHub 토큰이 이 저장소에 쓰기 권한이 없습니다. GitHub 설정 > Fine-grained tokens에서 해당 저장소와 Contents·Pull requests 읽기/쓰기 권한을 추가해 주세요.';
  }
  if (/401|Bad credentials/i.test(msg)) return 'GitHub 토큰이 만료되었거나 잘못되었습니다. 새 토큰을 등록해 주세요.';
  if (/too large|tokens per|429|quota|한도/i.test(msg)) return 'AI 무료 한도 문제로 실패했습니다. 한도가 회복되면 자동으로 다시 시도합니다.';
  if (/정확히 일치하지 않아|구체적으로/.test(msg)) return '수정할 위치를 찾지 못했습니다. 바꿀 파일·문구를 조금 더 구체적으로 지시해 주세요.';
  return `코드 반영이 실패했습니다: ${oneLine(msg, 140)}`;
}

// ---------------------------------------------------------------- proactive follow-up

/**
 * Scan missions for things the Team Lead should push forward without being asked.
 * Returns [{ missionId, title, items: [{ type, text, key }], autoPlan: boolean }]
 */
export function collectFollowUps(db, now = Date.now()) {
  ensureLeadDefaults(db);
  const cfg = getLeadSettings(db.settings);
  const remindMs = Math.max(1, Number(cfg.reminderHours) || 6) * 3600 * 1000;
  const ageMs = (iso) => (iso ? now - new Date(iso).getTime() : Infinity);
  const out = [];

  for (const m of db.missions || []) {
    if (m.isRoutineHub) continue;
    const tasks = (db.tasks || []).filter((t) => t.missionId === m.id);
    if (!tasks.length) continue;
    const lastTouch = tasks.reduce((acc, t) => (String(t.updatedAt || '') > acc ? String(t.updatedAt) : acc), String(m.createdAt || ''));
    if (ageMs(lastTouch) > 3 * 24 * 3600 * 1000) continue; // 3일 넘게 손대지 않은 업무는 건드리지 않음

    const st = missionLeadState(db, m.id);
    const items = [];
    const remindOnce = (key) => {
      const last = st.reminded[key];
      return !last || ageMs(last) > 12 * 3600 * 1000;
    };

    for (const a of (db.approvals || []).filter((x) => x.missionId === m.id && x.status === 'pending')) {
      if (ageMs(a.createdAt) > remindMs && remindOnce(`apr:${a.id}`)) {
        items.push({ type: 'approval_waiting', key: `apr:${a.id}`, text: `결재 "${oneLine(a.title, 80)}"가 ${Math.round(ageMs(a.createdAt) / 3600000)}시간째 대기 중입니다.` });
      }
      if (a.codeChange?.status === 'failed' && Number(a.codeChange.retries || 0) >= 3 && remindOnce(`codefail:${a.id}`)) {
        items.push({ type: 'code_failed', key: `codefail:${a.id}`, text: codeFailureHelp(a.codeChange.error) });
      }
    }
    for (const t of tasks) {
      if (t.status === 'awaiting_bridge' && ageMs(t.updatedAt) > remindMs && remindOnce(`bridge:${t.id}`)) {
        items.push({ type: 'bridge_waiting', key: `bridge:${t.id}`, text: `외부 봇 업무 "${oneLine(t.title, 80)}"가 ${Math.round(ageMs(t.updatedAt) / 3600000)}시간째 처리되지 않았습니다. 해당 앱 연동을 확인하거나 내부 AI로 재배정할까요?` });
      }
      if (t.autoRetryExhausted && remindOnce(`retry:${t.id}`)) {
        items.push({ type: 'retry_exhausted', key: `retry:${t.id}`, text: `"${oneLine(t.title, 80)}"가 자동 재시도 3회에도 실패했습니다. 지시를 바꾸거나 다른 팀원에게 맡겨야 합니다.` });
      }
    }

    const running = tasks.some((t) => ['running', 'queued'].includes(t.status));
    const pendingAny = (db.approvals || []).some((a) => a.missionId === m.id && a.status === 'pending');
    const codeBusy = (db.approvals || []).some(
      (a) => a.missionId === m.id && ['waiting_team', 'preparing', 'merging', 'merged'].includes(a.codeChange?.status)
    );
    const idle = !running && !codeBusy;
    // Report missing: tasks finished after the last report → produce one
    const finishedAfterReport = tasks.filter(
      (t) => ['completed', 'awaiting_approval'].includes(t.status) && String(t.updatedAt || '') > String(st.lastReportAt || '')
    );
    if (idle && finishedAfterReport.length && ageMs(lastTouch) > 3 * 60 * 1000) {
      items.push({ type: 'report_missing', key: `report:${lastTouch}`, taskIds: finishedAfterReport.map((t) => t.id), text: '' });
    }

    const autoPlan =
      cfg.autoFollowUp &&
      idle &&
      !pendingAny &&
      !st.closedAt &&
      Number(st.autoRounds || 0) < Math.max(0, Number(cfg.maxAutoRounds) || 0) &&
      tasks.every((t) => ['completed', 'rejected'].includes(t.status)) &&
      ageMs(lastTouch) > 5 * 60 * 1000 &&
      String(st.lastPlanAt || '') < lastTouch;

    if (items.length || autoPlan) out.push({ missionId: m.id, title: m.title, items, autoPlan });
  }
  return out;
}

/** Digest of a mission for the Team Lead's autonomous planning prompt. */
export function buildMissionDigest(db, missionId, maxChars = 2600) {
  const mission = (db.missions || []).find((m) => m.id === missionId);
  if (!mission) return '';
  const agentMap = Object.fromEntries((db.agents || []).map((a) => [a.id, a]));
  const tasks = (db.tasks || [])
    .filter((t) => t.missionId === missionId)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 10);
  const lines = tasks.map(
    (t, i) => `${i + 1}. [${t.status}] ${t.title} (${agentMap[t.assigneeId]?.name || '팀원'}): ${leadLines(t.output || t.description, 2, 160).join(' / ')}`
  );
  const ceoMsgs = (db.messages || [])
    .filter((m) => m.missionId === missionId && m.senderId === 'ceo')
    .slice(-4)
    .map((m) => `- ${kstShort(m.timestamp)} ${oneLine(m.text, 200)}`);
  return [
    `업무: ${mission.title}`,
    `원래 지시: ${oneLine(mission.directive, 500)}`,
    ceoMsgs.length ? `최근 CEO 발언:\n${ceoMsgs.join('\n')}` : '',
    `작업 현황(최신순):\n${lines.join('\n')}`
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxChars);
}

export function escapeTelegramHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
