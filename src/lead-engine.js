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
import { isDailyExhausted } from './ai-guard.js';

/** 목표 추진 원칙 (팀장이 Goal을 향해 밀고 나가도록) */
export const GOAL_DIRECTIVES = [
  '6. [목표 우선] 모든 판단의 기준은 프로젝트 목표(지표·목표치·기한)다. 계획·제안은 "목표까지 남은 차이 → 그 차이를 가장 크게 줄일 병목 1~2개 → 이번 단계에서 움직일 지표와 목표치" 순서로 쓴다. 목표가 숫자로 없으면 첫 과제로 측정 가능한 목표를 제안한다.',
  '7. [성과의 정의] 문서·초안·분석 보고서는 성과가 아니다. 성과는 실제 배포·게시·색인·트래픽·전환·수익처럼 측정 가능한 변화다. 보고할 때 "무엇을 만들었다"가 아니라 "지표가 어떻게 바뀌었다(또는 언제 확인 가능)"로 쓴다.',
  '8. [데이터로 판단] GA4·서치콘솔 등 실제 데이터를 먼저 보고 가장 큰 병목을 고른다. 측정 수단이 없으면 측정 수단 확보가 최우선이다. 확인하지 않은 수치를 쓰지 않는다.',
  '9. [안 되면 방향 전환] 두 단계 연속 목표 지표가 움직이지 않았으면 같은 방향의 일을 반복하지 말고, 원인 진단과 함께 전략 전환안 또는 중단안을 대표님께 올린다.',
  '10. [우선순위·속도] 일의 순서는 목표 기여도 × 실행 가능성 ÷ 비용(대표님 손이 필요한 정도 포함)으로 정한다. 대표님 손이 필요한 일은 가장 먼저 한 번에 묶어 요청한다. 한 단계는 1~2주 안에 끝나고, 끝났는지 검증할 수 있는 완료 기준을 미리 정한다.'
];

export const DEFAULT_GLOBAL_DIRECTIVES = [
  '1. 지시받은 일이 끝나면(성공·실패·보류 모두) 총괄 팀장이 대표님께 먼저 결과를 보고한다. 대표님이 물어볼 때까지 기다리지 않는다.',
  '2. 막힌 일은 원인·대안·대표님이 해줘야 할 일(권한·키·결정)을 구체적으로 요청한다. 말없이 대기하지 않는다.',
  '3. 실제로 확인한 사실만 보고한다. 확인하지 않은 것은 "미확인"이라고 쓴다.',
  '4. 이전 지시·결재 결정·반려 사유를 기억하고 같은 실수를 반복하지 않는다.',
  '5. 결제·외부 발송·실배포처럼 되돌리기 어려운 일만 결재를 받고, 나머지 일반 실무는 팀장 전결로 끝까지 추진한다.',
  ...GOAL_DIRECTIVES
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
  return { focus: String(s.focus || '').trim().slice(0, 600), exclude, noCode: Boolean(s.noCode) };
}

const NEGATION_NEAR_RE = /(제외|말고|빼고|아닌|아니라|금지|않|없이|대신|보류)/;
const CODE_PLAN_RE = /(\bPR\b|풀\s*리퀘|브랜치|커밋|배포|저장소에|레포에|컴포넌트\s*구현|코드\s*(작성|구현|수정)|git\s+(push|commit))/i;

/**
 * 결과물·계획이 이 업무의 지침을 어겼는지 (금지 키워드 사용 · 코드 금지 단계에서 코드·PR 계획)
 * "세무는 제외했습니다"처럼 부정 문맥에서 언급한 것은 위반으로 보지 않음
 */
export function findOutputViolations(mission, text = '') {
  const { exclude, noCode } = getMissionScope(mission);
  const src = String(text || '');
  const out = [];
  for (const k of exclude) {
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, (ch) => '\\' + ch), 'gi');
    let m;
    while ((m = re.exec(src))) {
      const around = src.slice(Math.max(0, m.index - 20), m.index + k.length + 20);
      if (!NEGATION_NEAR_RE.test(around)) {
        out.push(`금지 범위 "${k}" 사용`);
        break;
      }
    }
  }
  if (noCode) {
    const m = src.match(CODE_PLAN_RE);
    if (m) {
      const around = src.slice(Math.max(0, m.index - 20), m.index + 30);
      if (!NEGATION_NEAR_RE.test(around)) out.push(`코드·PR 금지 단계인데 "${m[0]}" 계획`);
    }
  }
  return out;
}

/** 작업 제목·설명이 코드 금지 단계에 맞지 않는지 */
export function isForbiddenCodeTask(mission, spec = {}) {
  const { noCode } = getMissionScope(mission);
  if (!noCode) return false;
  return Boolean(spec.isCodeChange) || CODE_PLAN_RE.test(`${spec.title || ''} ${spec.description || ''}`);
}

/** 맨 앞에 두는 업무 브리핑: 목표 · 지금 단계 · 절대 하지 말 것 (작은 모델도 놓치지 않게 짧고 단정하게) */
export function buildMissionBrief(mission, otherProjects = []) {
  if (!mission) return '';
  const { focus, exclude, noCode } = getMissionScope(mission);
  const g = getMissionGoal(mission);
  const lines = [`[이번 업무 브리핑 — "${mission.title}" · 아래와 다르게 하면 결과물은 반려됨]`];
  lines.push(`- 목표: ${g.objective || oneLine(mission.directive, 160)}${g.metric && g.target !== null ? ` (${g.metric} ${g.target}${g.unit ? ` ${g.unit}` : ''})` : ''}`);
  if (focus) lines.push(`- 지금 단계에서 할 일: ${focus}`);
  const nots = [];
  if (exclude.length) nots.push(`${exclude.join(', ')} 관련 내용·데이터·사례`);
  if (noCode) nots.push('코드 작성·PR·배포·저장소 작업 계획 (지금은 기획·조사 단계)');
  if (otherProjects.length) nots.push(`다른 프로젝트(${otherProjects.join(', ')})의 데이터·결과·사례`);
  if (nots.length) lines.push(`- 절대 하지 말 것: ${nots.join(' / ')}`);
  if (!mission.siteUrl) lines.push('- 이 업무에는 연결된 사이트·분석 데이터가 없음 (수치는 웹 근거나 가정으로만)');
  const lessons = Array.isArray(mission.reviewLessons) ? mission.reviewLessons.slice(0, 3) : [];
  if (lessons.length) lines.push(`- 최근 반려된 실수 (반복 금지): ${lessons.map((l) => l.text).join(' / ')}`);
  return lines.join('\n');
}

/** 맨 뒤에 두는 제출 전 자가 점검 */
export function buildComplianceChecklist(mission) {
  if (!mission) return '';
  const { exclude, noCode, focus } = getMissionScope(mission);
  const items = [];
  if (focus) items.push('결과물이 "지금 단계에서 할 일"에 직접 기여하는가?');
  if (exclude.length) items.push(`${exclude.join(', ')} 관련 내용·데이터가 하나도 없는가?`);
  if (noCode) items.push('코드·PR·배포·저장소 작업을 계획하거나 쓰지 않았는가?');
  items.push('확인하지 않은 수치를 사실처럼 쓰지 않았는가? (모르면 "가정:")');
  items.push('정보를 달라는 말만 하지 않고 실제 결과물을 만들었는가?');
  return `[제출 전 자가 점검 — 하나라도 "아니오"면 고쳐서 제출]\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
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
// ---------------------------------------------------------------- orchestration (팀장의 지휘·검토)

const CANNOT_RE = /(접근(이|할 수)?\s*(불가|없)|확인할 수 없|실행할 수 없|진행할 수 없|작성할 수 없|생성(이|할 수)?\s*(불가|없)|제공해\s*주(세요|십시오|시면)|알려\s*주(세요|십시오|시면)|미지정|지정되지 않|권한(이)?\s*(없|필요)|토큰(이)?\s*(없|필요)|정보가 (없|부족)|자료가 (없|부족))/;
const LOGIN_RE = /(로그인|콘솔|계정 (설정|접속|등록)|애드센스|adsense|서치\s*콘솔\s*(설정|등록|제출|인증)|2단계|본인\s*인증|결제 수단)/i;
const REPO_RE = /(저장소|repo|github|깃허브|\bPR\b|풀\s*리퀘|브랜치|커밋|파일 구조|기존 코드)/i;

/**
 * 팀원 결과가 "실제 결과물"이 아니라 못 한다는 말·정보 요청뿐인지 판단
 * osFlag: 팀원이 [외주 필요: 사유]를 단 경우 그 사유
 */
export function detectNonResult(output = '', osFlag = '') {
  const text = String(output || '');
  if (osFlag) return { nonResult: true, reason: osFlag };
  const head = text.replace(/[*#>\s]+/g, ' ').slice(0, 500);
  const m = head.match(CANNOT_RE);
  if (!m) return { nonResult: false, reason: '' };
  // 앞부분이 "못 함/정보 달라"이고 본문이 짧으면 결과물이 아님
  const substantive = text.replace(/\s+/g, ' ').length;
  if (substantive > 2200) return { nonResult: false, reason: '' };
  const idx = Math.max(0, head.indexOf(m[0]) - 60);
  return { nonResult: true, reason: head.slice(idx, idx + 160).trim() };
}

/** 막힌 이유 분류: login(실제 계정 작업 → 외주) / repo(저장소 필요) / info(정보 부족) / capability(능력 부족) */
export function classifyBlocker(reason = '', { repoLinked = false } = {}) {
  const t = String(reason || '');
  if (LOGIN_RE.test(t)) return 'login';
  if (REPO_RE.test(t)) return repoLinked ? 'capability' : 'repo';
  if (CANNOT_RE.test(t)) return 'info';
  return 'capability';
}

/** 팀장 피드백: 다시 맡길 때 무엇을 어떻게 만들라고 할지 */
export function triageGuidance(blocker, { repoLinked = false, violations = [] } = {}) {
  if (blocker === 'scope') {
    return `결과물이 이 업무의 지침을 어겼습니다(${violations.join(', ')}). 맨 위 "이번 업무 브리핑"의 "절대 하지 말 것"을 지켜서, 해당 내용을 빼고 "지금 단계에서 할 일"에 맞게 다시 만드세요.`;
  }
  if (blocker === 'repo') {
    return '이 업무에는 연결된 저장소가 없습니다. 저장소·PR을 기다리지 말고, 바로 쓸 수 있는 결과물(새로 만들 파일의 경로와 전체 내용을 코드 블록으로, 또는 완성된 문서)을 만드세요. 저장소 연결은 팀장이 대표님께 따로 요청합니다.';
  }
  if (blocker === 'info') {
    return '모르는 값은 합리적인 가정을 세우고 "가정:"으로 표시한 뒤 결과물을 끝까지 만드세요. 확인이 필요한 항목은 맨 끝에 "확인 필요" 목록으로 모으세요. 정보를 달라는 답만 쓰면 완료로 인정하지 않습니다.';
  }
  return `이전 담당자가 실제 결과물을 만들지 못했습니다. 당신의 역할에서 할 수 있는 범위까지 실제 결과물을 만드세요${repoLinked ? ' (코드면 바꿀 파일 경로와 변경 내용을 구체적으로)' : ''}. 정말 불가능한 부분만 이유와 함께 짧게 적으세요.`;
}

const ROLE_HINTS = [
  { re: /(코드|개발|구현|컴포넌트|스크립트|자동화|html|css|js|api|버그|빌드)/i, ids: ['agent_it_dev', 'agent_qwen'] },
  { re: /(보안|취약|감사|권한)/i, ids: ['agent_it_sec', 'agent_deepseek'] },
  { re: /(테스트|qa|검증|릴리스|무결성)/i, ids: ['agent_it_qa', 'agent_groq'] },
  { re: /(전략|분석|수익|추론|비교|시장|진단|우선순위)/i, ids: ['agent_deepseek', 'agent_gemma'] },
  { re: /(기획|ux|글|콘텐츠|카피|문서|초안|랜딩|키워드|seo)/i, ids: ['agent_gemma', 'agent_groq'] },
  { re: /(요약|번역|정리|한국어)/i, ids: ['agent_exaone', 'agent_groq'] }
];
const INTERNAL_PROVIDERS = new Set(['exaone', 'gemini', 'groq', 'openrouter']);

/**
 * 팀원별 실제 역량 (팀장이 적재적소에 배정하도록 계획 프롬프트에 그대로 들어감)
 * async: 외부 앱이 업무를 가져가 처리(즉시 응답 아님) · web: 실제 웹 조사 가능 · simpleOnly: 단순 업무만
 */
export const AGENT_PROFILES = {
  agent_gemma: { good: '기획안·UX 개선·카피·문서 초안', bad: '웹 직접 조사 불가 → 실제 수치·사례가 필요한 조사는 맡기지 말 것' },
  agent_deepseek: { good: '수익 모델 설계·비교 분석·리스크 검토 같은 추론', bad: '웹 직접 조사 불가' },
  agent_qwen: { good: '코드·스크립트·HTML/CSS·SEO 파일 작성', bad: '전략 판단' },
  agent_groq: { good: '빠른 기획·마케팅 문서·구조화·체크리스트', bad: '웹 직접 조사 불가' },
  agent_exaone: { good: '짧은 한국어 요약·정리·번역·이메일 초안', bad: '분석·전략·코드·조사는 품질이 낮아 맡기지 말 것', simpleOnly: true },
  agent_it_dev: { good: '코드 수정·버그 수정·리팩토링(연결 저장소 있을 때 PR까지)', bad: '비즈니스 기획' },
  agent_it_sec: { good: '보안 감사·코드 리뷰·배포 전 점검', bad: '비즈니스 기획' },
  agent_it_qa: { good: '테스트 시나리오·QA 체크리스트·릴리스 노트', bad: '비즈니스 기획' },
  agent_cue: { good: '실제 웹 딥리서치(가상 컴퓨터로 사이트 방문)·시장·경쟁·가격 조사·외부 메일 초안', bad: '즉시 응답 아님(외부 앱이 가져가 몇 시간 내 처리). 메일 실제 발송은 대표님 승인', async: true, web: true },
  agent_muse: { good: '대표님 취향·제약 기억 정리, 프로젝트 보드·체크리스트, 개인화 기획', bad: '즉시 응답 아님(외부 앱이 가져가 처리)', async: true },
  agent_pickle: { good: '국내 전화 문의·예약 실행(결제 전 대표님 승인)', bad: '문서·분석 업무 불가. 실제 전화가 필요한 일만', async: true, realWorld: true },
  agent_instinct: { good: '문자·전화로 빠른 확인·심부름', bad: '문서·분석 업무 불가', async: true, realWorld: true },
  agent_vooy: { good: '매일 같은 조건의 뉴스·가격 반복 수집', bad: '연동 대기 중', async: true }
};
const COMPLEX_RE = /(분석|전략|설계|조사|리서치|코드|구현|개발|비교|진단|수익|기획안|검증|아키텍처|리스크)/;
// 실제 웹을 봐야 하는 일 (시장·경쟁·수요·사례·가격 조사)
const WEB_RE = /(시장\s*(조사|검증)|경쟁|수요|사례|가격\s*조사|웹\s*조사|리서치|벤치마크|트렌드|겹치는지)/;

function lastSeenHours(db, id) {
  const at = db.agentConnections?.[id]?.lastSeenAt;
  return at ? (Date.now() - Date.parse(at)) / 3600000 : Infinity;
}

/** 계획용 조직도: 잘하는 일·맡기면 안 되는 일·응답 방식·현재 업무량 */
export function buildPlanningRoster(db) {
  const active = (db.agents || []).filter((a) => a.active && a.tier !== 'lead');
  return active
    .map((a) => {
      const p = AGENT_PROFILES[a.id] || { good: a.strengths || a.roleTitle, bad: '' };
      const busy = (db.tasks || []).filter((t) => t.assigneeId === a.id && ['queued', 'running', 'awaiting_bridge'].includes(t.status)).length;
      let mode = '즉시 응답(API)';
      if (p.async) {
        const h = lastSeenHours(db, a.id);
        mode = h < 48 ? `외부 앱(최근 ${h < 1 ? '1시간 내' : `${Math.round(h)}시간 전`} 접속 · 몇 시간 내 처리)` : '외부 앱(최근 접속 없음 → 배정 금지)';
      } else if (isAgentExhausted(a, db.settings)) {
        mode = '오늘 사용 한도 소진 → 자정까지 배정 금지';
      }
      return `- id: "${a.id}", ${a.name} — 잘함: ${p.good}${p.bad ? ` / 주의: ${p.bad}` : ''} / ${mode} / 진행 ${busy}건${busy === 0 ? ' (대기 중, 우선 배정)' : ''}`;
    })
    .join('\n');
}

/** 계획 프롬프트에 붙는 배정 원칙 */
export const ASSIGNMENT_RULES = [
  '배정 원칙(적재적소):',
  '- 위 조직도의 "잘함/주의"를 보고 업무 성격에 가장 맞는 사람에게 배정하세요. 한 사람에게 몰지 말고, 한 단계에서 한 팀원은 최대 2건까지.',
  '- "대기 중, 우선 배정" 팀원을 먼저 쓰세요. 같은 팀원만 반복해서 쓰지 마세요.',
  '- 실제 웹 조사(시장·경쟁·가격·사례)가 필요한 일은 웹 조사가 되는 팀원(Manus Cue)에게 맡기세요. 웹을 못 보는 API 팀원에게 맡기면 근거를 지어냅니다.',
  '- 실제 전화·예약·문자처럼 현실 행동이 필요한 일만 피클·인스팅스에게 맡기세요(결제·확정은 대표님 승인).',
  '- LG EXAONE에게는 짧은 요약·정리·번역 같은 단순 작업만 맡기세요.',
  '- "최근 접속 없음" 외부 앱 팀원에게는 배정하지 마세요.',
  '- "오늘 사용 한도 소진" 팀원에게는 오늘 배정하지 마세요. 같은 일을 할 수 있는 다른 팀원에게 맡기세요.'
].join('\n');

/** 계획 후 보정: EXAONE에 어려운 일, 응답 없는 외부 앱, 한 사람 몰림을 고쳐서 재배정 */
export function rebalanceAssignments(db, tasks = []) {
  const changes = [];
  const agentsById = Object.fromEntries((db.agents || []).map((a) => [a.id, a]));
  const planLoad = {};
  const out = tasks.map((t) => ({ ...t }));
  const reassign = (t, reason, exclude = []) => {
    const alt = pickAlternateMember(db, t, [t.assigneeId, ...exclude], planLoad);
    if (!alt) return;
    changes.push(`"${String(t.title).slice(0, 40)}": ${agentsById[t.assigneeId]?.name || t.assigneeId} → ${alt.name} (${reason})`);
    t.assigneeId = alt.id;
  };
  for (const t of out) {
    const p = AGENT_PROFILES[t.assigneeId] || {};
    const text = `${t.title || ''} ${t.description || ''}`;
    const webAgent = Object.keys(AGENT_PROFILES).find((id) => AGENT_PROFILES[id].web && agentsById[id]?.active && lastSeenHours(db, id) < 48 && (planLoad[id] || 0) < 2);
    if (WEB_RE.test(text) && !p.web && webAgent && !/(초안|기획서|명세)/.test(String(t.title || ''))) {
      changes.push(`"${String(t.title).slice(0, 40)}": ${agentsById[t.assigneeId]?.name || t.assigneeId} → ${agentsById[webAgent]?.name || webAgent} (실제 웹 조사 필요)`);
      t.assigneeId = webAgent;
    } else if (agentsById[t.assigneeId] && isAgentExhausted(agentsById[t.assigneeId], db.settings)) reassign(t, '오늘 사용 한도 소진');
    else if (p.simpleOnly && COMPLEX_RE.test(text)) reassign(t, '단순 업무 전용 팀원');
    else if (p.async && lastSeenHours(db, t.assigneeId) >= 48) reassign(t, '외부 앱 최근 접속 없음');
    else if (p.realWorld && !/(전화|예약|문자|연락|방문|확인 전화)/.test(text)) reassign(t, '현실 행동 전용 팀원');
    planLoad[t.assigneeId] = (planLoad[t.assigneeId] || 0) + 1;
    if (planLoad[t.assigneeId] > 2) {
      planLoad[t.assigneeId] -= 1;
      reassign(t, '한 사람에게 몰림');
      planLoad[t.assigneeId] = (planLoad[t.assigneeId] || 0) + 1;
    }
  }
  return { tasks: out, changes };
}

/** 다시 맡길 내부 팀원 고르기: 업무 성격에 맞고, 아직 시도하지 않았고, 지금 일이 적은 사람 */
export function pickAlternateMember(db, task, triedIds = [], planLoad = {}) {
  const text = `${task?.title || ''} ${task?.description || ''}`;
  const complex = COMPLEX_RE.test(text);
  // 오늘 한도를 다 쓴 팀원은 후보에서 제외 (한국 시간 자정에 자동 복귀)
  const active = (db.agents || []).filter(
    (a) => a.active && INTERNAL_PROVIDERS.has(a.provider) && a.tier !== 'lead' && !(complex && AGENT_PROFILES[a.id]?.simpleOnly) && !isAgentExhausted(a, db.settings)
  );
  const load = (id) => (db.tasks || []).filter((t) => t.assigneeId === id && ['queued', 'running'].includes(t.status)).length + (planLoad[id] || 0);
  const preferred = ROLE_HINTS.filter((h) => h.re.test(text)).flatMap((h) => h.ids);
  const candidates = active.filter((a) => !triedIds.includes(a.id));
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const pa = preferred.indexOf(a.id) === -1 ? 99 : preferred.indexOf(a.id);
    const pb = preferred.indexOf(b.id) === -1 ? 99 : preferred.indexOf(b.id);
    return pa - pb || load(a.id) - load(b.id);
  });
  return candidates[0];
}

/** 팀장 후속 계획용: 내부 팀원별 현재 업무량 */
export function describeTeamLoad(db) {
  const active = (db.agents || []).filter((a) => a.active && INTERNAL_PROVIDERS.has(a.provider) && a.tier !== 'lead');
  return active
    .map((a) => {
      const mine = (db.tasks || []).filter((t) => t.assigneeId === a.id);
      const busy = mine.filter((t) => ['queued', 'running'].includes(t.status)).length;
      return `- id: "${a.id}", ${a.name} (${a.roleTitle}) — 진행 ${busy}건${busy === 0 ? ' · 대기 중(우선 배정)' : ''}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------- work items (업무의 완료 기준)

// ---------------------------------------------------------------- 지침 준수·맥락 유지 (무료 모델이 지시를 놓치지 않게)

/** 작업 설명에서 뒤에 붙은 팀장 피드백 단락을 떼어낸 원래 지시 (피드백은 별도 블록으로 맨 앞에 둔다) */
export function baseTaskDescription(task = {}) {
  return String(task.description || '').split(/\n\n\[(?:팀장 검수|팀장 피드백|팀장 검토)/)[0].trim();
}

/** 팀장 피드백을 구조화해 쌓음 (설명 끝에 붙이면 짧은 프롬프트에서 잘려 나가 같은 실수가 반복됨) */
export function addLeadNote(task, kind, text) {
  const t = String(text || '').trim();
  if (!task || !t) return;
  task.leadNotes = Array.isArray(task.leadNotes) ? task.leadNotes : [];
  task.leadNotes.unshift({ at: new Date().toISOString(), kind, text: t.slice(0, 900) });
  task.leadNotes = task.leadNotes.slice(0, 6);
}

/** 업무(미션) 단위 반려 교훈: 한 작업에서 나온 실수를 다른 작업·다른 팀원도 반복하지 않게 브리핑에 넣음 */
export function addReviewLesson(mission, text) {
  const t = oneLine(text, 160);
  if (!mission || t.length < 6) return;
  const list = Array.isArray(mission.reviewLessons) ? mission.reviewLessons : [];
  const key = t.replace(/\s+/g, '').slice(0, 40);
  const rest = list.filter((x) => String(x.text || '').replace(/\s+/g, '').slice(0, 40) !== key);
  const prev = list.find((x) => String(x.text || '').replace(/\s+/g, '').slice(0, 40) === key);
  mission.reviewLessons = [{ text: t, count: Number(prev?.count || 0) + 1, at: new Date().toISOString() }, ...rest].slice(0, 6);
}

/**
 * 팀원에게 주는 작업 지시서 (프롬프트 맨 앞): 목표와 연결된 마일스톤, 완료 기준, 팀장 피드백, 지난 제출물, 반복 금지 실수.
 * 작은 모델은 긴 프롬프트의 중간·끝을 놓치므로 꼭 지켜야 할 것만 짧게 모아 맨 앞에 둔다.
 */
export function buildTaskWorkOrder(task = {}, mission = null, { compact = false } = {}) {
  const lines = [`[이번 작업 지시서 — 팀장 · 이 지시서와 다르면 반려됨]`];
  lines.push(`- 작업: ${oneLine(task.title, 120)}`);
  const ms = mission?.plan?.milestones?.find((x) => x.id === task.milestoneId);
  if (ms) lines.push(`- 이 작업이 기여할 마일스톤: ${oneLine(ms.title, 100)} (완료 기준: ${oneLine(ms.doneWhen, 160)})`);
  const g = mission ? getMissionGoal(mission) : null;
  if (g?.metric && g.target !== null) lines.push(`- 프로젝트 목표: ${g.metric} ${g.current ?? '?'} → ${g.target}${g.unit ? ` ${g.unit}` : ''}`);
  const acc = deriveAcceptance(task);
  lines.push('- 완료 기준 (팀장이 이 기준으로 검수):', ...acc.map((x, i) => `  ${i + 1}. ${oneLine(x, 180)}`));
  const notes = Array.isArray(task.leadNotes) ? task.leadNotes : [];
  if (notes.length) {
    lines.push('- 팀장 피드백 (최신순 · 모두 반영해야 통과):', ...notes.slice(0, compact ? 2 : 4).map((n) => `  - ${oneLine(n.text, compact ? 300 : 600)}`));
  }
  if (task.previousOutput) {
    lines.push(`- 지난 제출물 (반려됨 · 같은 내용을 다시 내지 말고 피드백대로 고칠 것) 앞부분: ${oneLine(task.previousOutput, compact ? 260 : 600)}`);
  }
  const lessons = Array.isArray(mission?.reviewLessons) ? mission.reviewLessons : [];
  if (lessons.length) lines.push(`- 이 업무에서 최근 반려된 실수 (반복 금지): ${lessons.slice(0, compact ? 3 : 5).map((l) => `${l.text}${l.count > 1 ? ` (${l.count}회)` : ''}`).join(' / ')}`);
  return lines.join('\n');
}

/** 맨 끝 다짐: 완료 기준·피드백 반영 여부를 스스로 확인 */
export function buildTaskRecap(task = {}) {
  const acc = deriveAcceptance(task);
  const items = [`완료 기준 ${acc.length}개를 모두 충족했는가? (하나씩 확인)`];
  if (Array.isArray(task.leadNotes) && task.leadNotes.length) items.push('팀장 피드백을 빠짐없이 반영했는가? (지난 제출물과 달라졌는가?)');
  return items.map((x) => `- ${x}`).join('\n');
}

// ---------------------------------------------------------------- 하루 사용 한도 소진 팀원 제외·대체

const GROQ_MODEL_MAP = { 'llama-3.3-70b-versatile': 'openai/gpt-oss-120b', 'qwen/qwen3-32b': 'qwen/qwen3.8-27b' };
const OR_MODEL_MAP = { 'deepseek/deepseek-r1:free': 'nvidia/nemotron-3.5-lightning:free', 'qwen/qwen3-coder:free': 'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free': 'nvidia/nemotron-3.5-lightning:free' };

/** 팀원이 실제로 호출하는 엔진·모델 (orchestrator.resolveLanguageModel과 같은 규칙) */
export function agentModelKey(agent, settings = {}) {
  const p = settings?.providers || {};
  if (!agent) return null;
  if (agent.provider === 'gemini') {
    const raw = String(p.gemini?.freeModel || '').trim();
    return { provider: 'gemini', model: raw && raw !== 'gemini-2.5-flash' ? raw : 'gemini-4-hydrogen' };
  }
  if (agent.provider === 'groq') {
    if (!p.groq?.apiKey && p.openrouter?.apiKey) return { provider: 'openrouter', model: 'openrouter/free' };
    const raw = agent.modelId || p.groq?.model || 'openai/gpt-oss-120b';
    return { provider: 'groq', model: GROQ_MODEL_MAP[raw] || raw };
  }
  if (agent.provider === 'openrouter') {
    if (!p.openrouter?.apiKey && p.groq?.apiKey) return { provider: 'groq', model: 'openai/gpt-oss-120b' };
    const raw = agent.modelId || p.openrouter?.model || 'openrouter/free';
    return { provider: 'openrouter', model: OR_MODEL_MAP[raw] || raw };
  }
  if (agent.provider === 'exaone') return { provider: 'exaone', model: agent.modelId || p.exaone?.model || 'k-exaone_v2.5' };
  if (agent.provider === 'claude') return { provider: 'claude', model: agent.modelId || p.claude?.model || 'claude-sonnet-4-5' };
  return null;
}

/** 오늘 하루 한도를 다 쓴 팀원 (한국 시간 자정까지 업무 배정·실행에서 제외) */
export function isAgentExhausted(agent, settings = {}) {
  const k = agentModelKey(agent, settings);
  return Boolean(k && isDailyExhausted(k.provider, k.model));
}

/** 한도 소진 팀원의 작업을 대신할 팀원: 같은 역할 힌트 → 다른 엔진 → 일이 적은 사람 순 */
export function pickQuotaSubstitute(db, task, exhaustedAgent, triedIds = [], planLoad = {}) {
  const tried = [...new Set([exhaustedAgent?.id, ...triedIds].filter(Boolean))];
  return pickAlternateMember(db, task, tried, planLoad);
}

/** 업무 완료 기준: 계획 단계에서 정한 것이 있으면 그대로, 없으면 설명에서 뽑거나 기본 기준 */
export function deriveAcceptance(task = {}) {
  if (Array.isArray(task.acceptance) && task.acceptance.length) return task.acceptance.slice(0, 6).map((x) => String(x).slice(0, 200));
  const desc = String(task.description || '');
  const m = desc.match(/완료\s*기준\s*[:：]?\s*([^\n]+(?:\n[-•*\d].+){0,5})/);
  if (m) {
    const items = m[1]
      .split(/\n|(?:\s*[;·]\s*)/)
      .map((x) => x.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter((x) => x.length >= 4);
    if (items.length) return items.slice(0, 6);
  }
  return [
    `"${String(task.title || '').slice(0, 60)}"에 대한 결과물이 바로 쓸 수 있는 형태로 완성돼 있음 (정보 요청·계획만 있는 것은 미완료)`,
    '수치·사실은 확인한 근거가 있거나 "가정:"으로 표시돼 있음',
    '이번 업무 브리핑의 "절대 하지 말 것"을 지킴'
  ];
}

/** 프로젝트 목표 (지표·목표치·현재값·기한) 정리 */
export function getMissionGoal(mission) {
  const g = (mission && mission.goal) || {};
  const num = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const str = (v, n) => String(v || '').trim().slice(0, n);
  return {
    objective: str(g.objective, 300),
    metric: str(g.metric, 120),
    unit: str(g.unit, 20),
    target: num(g.target),
    baseline: num(g.baseline),
    current: num(g.current),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(g.deadline || '')) ? g.deadline : '',
    note: str(g.note, 400),
    updatedAt: g.updatedAt || ''
  };
}

export function hasMeasurableGoal(mission) {
  const g = getMissionGoal(mission);
  return Boolean(g.metric && g.target !== null);
}

/** 목표 블록: 모든 AI 호출에 들어가는 "판단 기준" */
export function describeMissionGoal(mission, now = Date.now()) {
  if (!mission) return '';
  const g = getMissionGoal(mission);
  const fmt = (n) => (n === null ? '미확인' : `${Number(n).toLocaleString('ko-KR')}${g.unit ? ` ${g.unit}` : ''}`);
  if (!g.metric || g.target === null) {
    return [
      `- 목표 문장: ${g.objective || oneLine(mission.directive, 200)}`,
      '- ⚠️ 숫자 목표 미설정: 지표·목표치·기한이 없습니다. 팀장은 첫 과제로 측정 가능한 목표(지표, 현재값, 목표치, 기한)를 제안하고, 그 전까지는 가장 측정하기 쉬운 선행 지표를 기준으로 판단하세요.'
    ].join('\n');
  }
  const lines = [`- 목표: ${g.objective || oneLine(mission.directive, 200)}`, `- 핵심 지표: ${g.metric}`];
  lines.push(`- 현재 ${fmt(g.current)} → 목표 ${fmt(g.target)}${g.baseline !== null ? ` (시작 ${fmt(g.baseline)})` : ''}`);
  if (g.current !== null) {
    const gap = g.target - g.current;
    let prog = '';
    if (g.baseline !== null && g.target !== g.baseline) prog = ` · 진척 ${Math.max(0, Math.min(100, Math.round(((g.current - g.baseline) / (g.target - g.baseline)) * 100)))}%`;
    lines.push(`- 남은 차이: ${fmt(gap)}${prog}`);
  }
  if (g.deadline) {
    const days = Math.ceil((Date.parse(`${g.deadline}T23:59:59+09:00`) - now) / 86400000);
    lines.push(`- 기한: ${g.deadline} (${days >= 0 ? `${days}일 남음` : `${-days}일 지남`})`);
  }
  if (g.note) lines.push(`- 참고: ${g.note}`);
  if (g.updatedAt) lines.push(`- 현재값 갱신: ${kstShort(g.updatedAt)}`);
  return lines.join('\n');
}

export function buildCompanyContext(db, missionId = '', { compact = false } = {}) {
  if (!db) return '';
  ensureLeadDefaults(db);
  const maxChars = compact ? 2900 : 4600;
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
  const missionObj = missionId ? (db.missions || []).find((m) => m.id === missionId) : null;
  // 다른 프로젝트 이름·저장소·사이트 (이 업무에 섞이면 그 일을 따라 하게 됨)
  const others = missionObj ? (db.missions || []).filter((m) => m.id !== missionObj.id) : [];
  const otherMarkers = others
    .flatMap((m) => [m.title, m.githubRepo, String(m.githubRepo || '').split('/')[1], String(m.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')])
    .map((x) => String(x || '').trim().toLowerCase())
    .filter((x) => x.length >= 4);
  if (missionObj) parts.push(buildMissionBrief(missionObj, others.map((m) => m.title).slice(0, 4)));
  if (directives) parts.push(`[CEO 전역 지침 — 모든 AI 팀원 공통, 항상 최우선 적용]\n${directives}`);
  const scope = getMissionScope(missionObj);
  if (missionObj && (scope.focus || scope.exclude.length || missionPinned.length)) {
    const sl = [];
    if (scope.focus) sl.push(`- 이 업무가 집중할 일: ${scope.focus}`);
    if (scope.exclude.length) sl.push(`- 이 업무에서 하지 말 것(다른 팀 담당): ${scope.exclude.join(', ')} — 관련 작업·제안·분석 금지`);
    for (const f of missionPinned) sl.push(`- (${kstShort(f.createdAt)}) ${f.text}`);
    parts.push(`["${missionObj.title}" 업무에 대한 대표님 고정 지침 — 최우선, 어기면 안 됨]\n${sl.join('\n')}`);
  }
  if (missionObj) parts.push(`["${missionObj.title}" 목표 — 모든 판단·계획·보고의 기준]\n${describeMissionGoal(missionObj)}`);
  // 이 업무에 관계없는 전역 기억(다른 프로젝트 이야기·금지 범위 언급)은 빼서 엉뚱한 일을 따라 하지 않게
  const scopeEx = getMissionScope(missionObj).exclude.map((k) => k.toLowerCase());
  const relevant = (f) => {
    if (!missionObj || f.missionId) return true;
    const t = String(f.text || '').toLowerCase();
    return !otherMarkers.some((x) => t.includes(x)) && !scopeEx.some((k) => t.includes(k));
  };
  const memLines = [...globalPinned.filter(relevant), ...own, ...global.filter(relevant)].map((f) => formatFact(f, missionTitles));
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
      mission.githubRepo
        ? `- 연결 저장소: ${mission.githubRepo} (PR로 실제 반영 가능)`
        : '- 연결 저장소: 없음 → PR·배포·저장소 작업은 계획하지 말고, 결과물은 파일 내용·문서로 만들 것. 저장소가 꼭 필요하면 팀장이 대표님께 연결을 요청',
      mission.siteUrl ? `- 라이브 사이트: ${mission.siteUrl}` : '',
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
      // 프로젝트(운영 사이클)는 마일스톤별 시도 횟수로 제한하므로 자율 라운드 제한을 쓰지 않음
      (m.mode === 'project' || Number(st.autoRounds || 0) < Math.max(0, Number(cfg.maxAutoRounds) || 0)) &&
      tasks.every((t) => ['completed', 'rejected', ...(m.mode === 'project' ? ['blocked'] : [])].includes(t.status)) &&
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
    `목표:\n${describeMissionGoal(mission)}`,
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
