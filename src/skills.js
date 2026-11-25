/**
 * AI 스킬 라이브러리 (Skill Playbooks)
 *
 * 무료 모델은 "무엇을 해야 하는지"는 알아도 "최상급 모델처럼 일하는 순서와 기준"을 스스로 지키지 못합니다.
 * 그래서 작업 유형마다 상위 모델이 실제로 따르는 절차·출력 형식·자체 점검표·흔한 실수를 명시한 스킬을 만들고,
 * 작업 내용에 맞는 스킬만 골라 시스템 프롬프트에 주입합니다. (작은 무료 모델의 토큰 한도를 고려해 최대 2~3개)
 *
 * 품질 검수(리뷰 루프): 중요한 작업은 다른 무료 모델이 스킬의 점검표로 채점하고, 기준 미달이면 지적사항을 반영해 고쳐 씁니다.
 */

export const SKILL_DEFAULTS = {
  enabled: true,
  reviewMode: 'important', // off | important | always
  minScore: 8, // 리뷰 점수(10점 만점)가 이 값 미만이면 수정본을 다시 씀
  maxSkills: 2, // 기본 스킬 외에 작업당 추가로 붙일 스킬 수
  disabled: [], // 끈 기본 스킬 id
  custom: [] // CEO가 추가한 스킬 { id, name, keywords, instructions }
};

export const BUILTIN_SKILLS = [
  {
    id: 'core_operating',
    name: '업무 처리 기본기',
    always: true,
    procedure: [
      '지시의 최종 목적과 "완료" 기준을 한 문장으로 정한다. 애매하면 가장 합리적인 해석을 고르고 그 가정을 명시한다.',
      '제공된 자료(실제 저장소 파일, 사이트 점검 결과, 회사 기억, 선행 결과)에서 근거를 먼저 찾는다. 없는 정보는 지어내지 않는다.',
      '결론부터 쓰고(두괄식), 근거와 실행 단계를 뒤에 붙인다.',
      '바로 실행 가능한 수준까지 구체화한다: 누가·무엇을·어디서(파일 경로/화면/URL)·어떻게·완료 확인 방법.',
      '제출 전 아래 점검표로 스스로 검사하고 고친 뒤 최종본만 낸다.'
    ],
    checklist: [
      '첫 2줄만 읽어도 결론과 다음 행동을 알 수 있는가',
      '모든 수치·사실에 출처(파일/점검 결과/기억)가 있거나 "추정"으로 표시했는가',
      '일반론·뻔한 조언·반복 문장이 없는가',
      '대표님이 직접 해야 할 일과 팀이 할 일을 구분했는가'
    ],
    pitfalls: ['"~할 수 있습니다/검토하겠습니다" 같은 빈 약속', '확인 안 한 외부 수치(트래픽·수익)를 사실처럼 쓰기', '질문과 상관없는 장황한 배경 설명']
  },
  {
    id: 'code_patch',
    name: '코드 수정·버그 수정',
    agents: ['agent_it_dev', 'agent_qwen'],
    domains: ['it_ops', 'dev'],
    keywords: /코드|수정|버그|오류|에러|패치|PR|구현|기능|HTML|CSS|JS|자바스크립트|빌드|배포|리팩터|화면|버튼|레이아웃|문구|푸터|헤더/i,
    important: true,
    procedure: [
      '바꿀 동작을 "현재 → 원하는 결과"로 한 줄 정의한다.',
      '실제 파일 목록에서 관련 파일을 찾고, 수정할 정확한 위치(함수/요소/줄)를 인용한다. 목록에 없는 파일은 만들지 않는다.',
      '최소 변경으로 고친다. 기존 코드 스타일·들여쓰기·변수명·빌드 구조(데이터 파일 → 빌드 스크립트 생성 등)를 따른다.',
      '경계 조건(빈 값, 모바일 화면, 기존 기능 회귀, 다국어/한글 줄바꿈)을 점검한다.',
      '변경 내용은 "파일 경로 · 원본 코드 · 수정 코드 · 이유" 형식으로, 검증 방법(어떤 페이지에서 무엇이 보이면 성공)을 함께 쓴다.'
    ],
    output: '## 변경 요약(1~2줄)\n## 수정 내역: 파일 경로 / 원본 / 수정 / 이유\n## 검증 방법\n## 위험·회귀 가능성',
    checklist: ['수정 위치가 실제 파일 내용에 정확히 존재하는가', '불필요한 대규모 변경이 없는가', '문법 오류·닫히지 않은 태그·따옴표가 없는가', '비밀키·토큰을 코드에 넣지 않았는가', '검증 방법이 구체적인가'],
    pitfalls: ['존재하지 않는 파일·함수 경로 추측', '빌드 산출물(dist)을 직접 수정', '설명만 하고 실제 바꿀 코드를 안 주기']
  },
  {
    id: 'security_review',
    name: '보안 감사',
    agents: ['agent_it_sec'],
    keywords: /보안|감사|취약|인증|권한|토큰|비밀|XSS|CSRF|인젝션|CSP|개인정보/i,
    important: true,
    procedure: [
      '변경 범위와 공격 표면(입력값, 외부 요청, 인증, 저장 데이터)을 먼저 나열한다.',
      'OWASP 핵심 항목을 순서대로 점검한다: 입력 검증·출력 인코딩(XSS), 인젝션, 인증/권한 우회, 비밀정보 노출, CSRF/CORS, 의존성, 로깅의 개인정보.',
      '발견 사항마다 근거(파일·줄·코드)와 재현 방법, 위험도(높음/중간/낮음), 수정안을 쓴다.',
      '근거 없는 막연한 경고는 쓰지 않는다. 문제가 없으면 무엇을 확인해서 없다고 판단했는지 쓴다.'
    ],
    output: '## 판정(통과/주의/차단)\n## 발견 사항 표: 항목 | 근거 | 위험도 | 수정안\n## 확인한 범위',
    checklist: ['모든 지적에 코드 근거가 있는가', '위험도가 실제 영향 기준인가', '수정안이 바로 적용 가능한가'],
    pitfalls: ['일반 보안 수칙 나열로 끝내기', '근거 없이 "위험할 수 있음"']
  },
  {
    id: 'qa_test',
    name: 'QA·테스트 설계',
    agents: ['agent_it_qa'],
    keywords: /테스트|QA|검증|회귀|릴리스|점검|확인해/i,
    procedure: [
      '검증 대상 기능과 성공 기준을 정의한다.',
      '정상·경계·오류·회귀 케이스를 표로 만든다(입력, 절차, 기대 결과).',
      '모바일/데스크톱, 주요 브라우저, 느린 네트워크 등 환경 차이를 반영한다.',
      '실제로 실행한 확인과 실행하지 않은 확인을 구분한다.'
    ],
    output: '## 결론(통과/실패/미확인)\n## 테스트 케이스 표: 케이스 | 절차 | 기대 결과 | 실제/상태\n## 발견된 문제와 재현 방법',
    checklist: ['경계·오류 케이스가 포함됐는가', '실행 안 한 테스트를 통과로 쓰지 않았는가', '재현 절차가 누구나 따라 할 수 있는가'],
    pitfalls: ['정상 케이스만 나열', '확인하지 않고 "정상 작동" 단정']
  },
  {
    id: 'seo_content',
    name: 'SEO·콘텐츠 작성',
    agents: ['agent_gemma', 'agent_groq'],
    domains: ['content'],
    keywords: /SEO|검색|키워드|메타|타이틀|콘텐츠|블로그|글|카피|문구|랜딩|pSEO|색인|사이트맵/i,
    procedure: [
      '검색 의도(정보형/계산형/비교형/거래형)와 핵심 키워드 1개 + 보조 키워드 3~5개를 정한다.',
      'title 60자·meta description 155자 이내, H1 1개, H2/H3 논리 구조로 설계한다.',
      '첫 문단에서 질문에 바로 답하고(두괄식), 표·예시 계산·FAQ로 체류를 늘린다.',
      'E-E-A-T: 근거(법령·공식 출처), 작성 기준일, 면책 문구를 넣는다. 세금·금융은 YMYL이므로 정확성이 최우선.',
      '내부 링크(관련 계산기·가이드)와 CTA를 자연스럽게 배치한다. 키워드 반복 남용 금지.'
    ],
    output: '## 대상 키워드·검색 의도\n## title / meta description\n## 본문 구조(H1~H3)와 초안\n## 내부 링크·FAQ',
    checklist: ['글자 수 제한을 지켰는가', '첫 문단에 답이 있는가', '숫자·법령에 출처와 기준일이 있는가', '중복·키워드 남용이 없는가'],
    pitfalls: ['검색 의도와 무관한 일반론', '기준일 없는 세율·금액', '모든 문장에 키워드 반복']
  },
  {
    id: 'korean_tax_accuracy',
    name: '한국 세금·계산 정확성',
    keywords: /세금|세율|세액|공제|연말정산|양도세|증여세|상속세|취득세|종부세|부가세|4대\s*보험|최저임금|실수령|계산기|요율|간이세액/i,
    important: true,
    procedure: [
      '적용 연도와 근거 법령(법·시행령 조문)을 먼저 확인한다. 저장소의 요율 데이터 파일(예: data/rates-2026.json)이 있으면 그 값을 기준으로 한다.',
      '계산식을 단계별로 쓰고, 예시 금액으로 직접 계산해 검산한다.',
      '경계 조건(구간 경계 금액, 비과세 한도, 원 단위 절사 규칙, 지방소득세 10%)을 점검한다.',
      '불확실한 부분은 "확인 필요"로 표시하고 국세청·법제처 확인 경로를 남긴다.'
    ],
    output: '## 결론(금액/규칙)\n## 근거 법령·기준일\n## 계산식과 예시 검산\n## 주의할 경계 조건',
    checklist: ['연도·법령이 맞는가', '예시 계산이 실제로 맞는가', '절사·한도 규칙을 반영했는가', '추정을 사실처럼 쓰지 않았는가'],
    pitfalls: ['작년 세율 사용', '지방소득세 누락', '구간 경계 금액 처리 오류']
  },
  {
    id: 'research_analysis',
    name: '리서치·분석',
    agents: ['agent_deepseek', 'agent_cue'],
    keywords: /리서치|조사|분석|시장|벤치마크|경쟁|트렌드|데이터|원인|비교|사례/i,
    procedure: [
      '답해야 할 질문을 1~3개로 좁힌다.',
      '사실(출처 있음) / 추론(근거 제시) / 가정(검증 필요)을 구분해서 쓴다.',
      '선택지를 비교할 때는 같은 기준표(비용·효과·시간·위험)로 비교한다.',
      '결론에 확신도(높음/중간/낮음)와 이를 바꿀 수 있는 정보를 적는다.',
      '실시간 데이터 접근이 없으면 그렇게 밝히고 확인 방법을 제시한다.'
    ],
    output: '## 핵심 답(3줄)\n## 근거: 사실 / 추론 / 가정\n## 비교표(해당 시)\n## 확신도와 추가 확인할 것',
    checklist: ['질문에 직접 답했는가', '사실과 추론을 섞지 않았는가', '출처 없는 구체 수치가 없는가'],
    pitfalls: ['출처 없는 통계·시장 규모', '결론 없는 나열식 조사']
  },
  {
    id: 'strategy_plan',
    name: '전략·실행 계획',
    agents: ['agent_gemini_neon', 'agent_deepseek'],
    keywords: /전략|로드맵|계획|기획|수익|성장|Phase|단계|제안|목표|KPI|마케팅|퍼널|전환/i,
    important: true,
    procedure: [
      '목표를 측정 가능한 형태(지표·기한)로 바꾸고, 현재 상태와 제약(예산 0원, 무료 도구, 대표님 시간)을 적는다.',
      '선택지 2~3개를 비용·효과·속도·위험으로 비교하고 하나를 추천한다(이유 포함).',
      '추천안을 이번 주에 바로 할 3개 행동으로 쪼갠다: 담당·산출물·완료 기준.',
      '성공/실패를 판단할 KPI와 확인 시점을 정한다.',
      '이미 한 일(회사 기억·선행 결과)을 반복하지 않는다.'
    ],
    output: '## 추천안(1줄)과 이유\n## 선택지 비교표\n## 바로 할 3가지(담당·산출물·완료 기준)\n## KPI와 점검 시점',
    checklist: ['추천이 하나로 명확한가', '행동이 담당·완료 기준까지 구체적인가', '제약(0원 등)을 지켰는가', '이전 단계와 중복되지 않는가'],
    pitfalls: ['"브랜딩 강화" 같은 추상 목표', '모든 선택지를 다 하자는 결론', '측정 불가능한 KPI']
  },
  {
    id: 'ux_writing',
    name: 'UX·화면 문구',
    agents: ['agent_gemma'],
    keywords: /UX|UI|사용자|동선|화면|버튼|온보딩|문구|안내|접근성|모바일/i,
    procedure: [
      '사용자가 이 화면에서 하려는 일 1개를 정하고, 그 흐름의 막히는 지점을 찾는다.',
      '문구는 짧고 구체적으로(동사로 시작, 숫자·결과 명시), 전문용어는 풀어쓴다.',
      '모바일 한 손 사용, 접근성(대비·글자 크기·스크린리더 라벨)을 점검한다.',
      '변경안은 "현재 → 제안 → 기대 효과"로 쓴다.'
    ],
    output: '## 핵심 문제\n## 변경안 표: 위치 | 현재 | 제안 | 기대 효과',
    checklist: ['위치가 실제 화면/파일과 대응되는가', '문구가 더 짧고 명확해졌는가'],
    pitfalls: ['근거 없는 전면 리디자인 제안']
  },
  {
    id: 'exec_report',
    name: '임원 보고서(총괄 팀장)',
    agents: ['agent_gemini_neon'],
    purposes: ['report', 'lead_plan'],
    procedure: [
      'BLUF: 첫 줄에 "무엇이 끝났고 무엇이 남았는지", 둘째 줄에 "대표님이 결정/조치할 것"을 쓴다.',
      '팀원 결과를 그대로 붙이지 말고 중복을 합치고 충돌하는 주장은 근거로 판정한다.',
      '확인된 사실과 팀원의 주장(미검증)을 구분한다. 틀린 주장은 바로잡는다(회사 기억 우선).',
      '리스크·막힌 일은 원인과 해결책을 함께 쓴다.'
    ],
    output: '## 한 줄 결론\n## 대표님 결정·조치 필요\n## 완료 / 진행 / 막힘 표\n## 다음 단계',
    checklist: ['30초 안에 읽히는가', '대표님이 할 일이 분명한가', '미검증 주장을 사실로 옮기지 않았는가'],
    pitfalls: ['팀원 보고서 요약 나열', '"수신: CEO" 같은 머리말로 시작']
  },
  {
    id: 'lead_management',
    name: '업무 분해·배정(총괄 팀장)',
    agents: ['agent_gemini_neon'],
    purposes: ['decompose', 'lead_plan'],
    procedure: [
      '지시를 완료 기준이 있는 3~5개 작업으로 나눈다. 각 작업은 산출물 1개와 완료 기준 1개를 가진다.',
      '강점에 맞게 배정한다: 코드=IT개발, 보안=IT보안, 검증=IT QA, 글·UX=Gemma, 분석·전략=Nemotron/DeepSeek, 한국어 요약=EXAONE.',
      '이미 끝난 작업·반려된 방향(회사 기억)은 다시 배정하지 않는다.',
      '대표님만 할 수 있는 일(외부 계정·결제·키)은 작업이 아니라 요청으로 분리한다.'
    ],
    checklist: ['작업마다 완료 기준이 있는가', '중복 작업이 없는가', '대표님 요청과 팀 작업이 분리됐는가'],
    pitfalls: ['"조사하기" 같은 산출물 없는 작업', '한 사람에게 모든 일 몰기']
  }
];

export function getSkillSettings(settings) {
  const s = settings?.skills && typeof settings.skills === 'object' ? settings.skills : {};
  return {
    ...SKILL_DEFAULTS,
    ...s,
    disabled: Array.isArray(s.disabled) ? s.disabled : [],
    custom: Array.isArray(s.custom) ? s.custom : []
  };
}

function customToSkill(c) {
  let re = null;
  const words = String(c.keywords || '')
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length) re = new RegExp(words.join('|'), 'i');
  return {
    id: c.id,
    name: c.name || '사용자 스킬',
    custom: true,
    always: Boolean(c.always),
    keywords: re,
    agents: Array.isArray(c.agents) ? c.agents : [],
    important: Boolean(c.important),
    instructions: String(c.instructions || '').slice(0, 1500)
  };
}

export function allSkills(settings) {
  const cfg = getSkillSettings(settings);
  return [...BUILTIN_SKILLS, ...cfg.custom.map(customToSkill)].filter((s) => !cfg.disabled.includes(s.id));
}

/**
 * Pick the skills for a piece of work.
 * purpose: task | report | decompose | lead_plan | chat | code_patch | security_audit
 */
export function selectSkills({ agent = null, task = null, mission = null, purpose = 'task', settings = null, max } = {}) {
  const cfg = getSkillSettings(settings);
  if (!cfg.enabled) return [];
  const limit = Number.isFinite(Number(max)) ? Number(max) : Math.max(0, Math.min(4, Number(cfg.maxSkills) || 2));
  const text = `${task?.title || ''} ${task?.description || ''} ${purpose === 'task' ? '' : mission?.directive || ''}`.slice(0, 3000);
  const domain = task?.domain || mission?.domain || '';
  const skills = allSkills(settings);
  const base = skills.filter((s) => s.always);
  const scored = [];
  for (const s of skills) {
    if (s.always) continue;
    let score = 0;
    if (Array.isArray(s.purposes) && s.purposes.includes(purpose)) score += 5;
    if (purpose === 'code_patch' && s.id === 'code_patch') score += 10;
    if (purpose === 'security_audit' && s.id === 'security_review') score += 10;
    if (agent?.id && Array.isArray(s.agents) && s.agents.includes(agent.id)) score += 2;
    if (domain && Array.isArray(s.domains) && s.domains.includes(domain)) score += 2;
    if (s.keywords instanceof RegExp && s.keywords.test(text)) {
      score += 3;
      if (s.custom) score += 2; // CEO가 만든 스킬은 키워드가 맞으면 우선
    }
    if (score >= 3) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return [...base, ...scored.slice(0, limit).map((x) => x.s)];
}

export function renderSkills(skills = [], { compact = false } = {}) {
  if (!skills.length) return '';
  const blocks = skills.map((s) => {
    if (s.custom) return `### 스킬: ${s.name}\n${s.instructions}`;
    const steps = (s.procedure || []).map((p, i) => `${i + 1}. ${p}`).join('\n');
    const check = (s.checklist || []).map((c) => `- [ ] ${c}`).join('\n');
    if (compact) {
      return `### 스킬: ${s.name}\n${steps}${check ? `\n제출 전 점검:\n${check}` : ''}`;
    }
    const pit = (s.pitfalls || []).length ? `\n자주 하는 실수(금지): ${s.pitfalls.join(' / ')}` : '';
    const out = s.output ? `\n출력 형식:\n${s.output}` : '';
    return `### 스킬: ${s.name}\n작업 절차:\n${steps}${out}${check ? `\n제출 전 자체 점검(모두 통과해야 제출):\n${check}` : ''}${pit}`;
  });
  let text = `[적용 스킬 — 아래 절차와 점검표를 반드시 따르세요. 점검 결과는 출력하지 말고, 통과한 최종본만 출력하세요.]\n${blocks.join('\n\n')}`;
  const cap = compact ? 2200 : 4800;
  if (text.length > cap) text = `${text.slice(0, cap - 10)}\n…`;
  return text;
}

export function skillBlock(opts = {}) {
  return renderSkills(selectSkills(opts), { compact: Boolean(opts.compact) });
}

/** Whether a finished draft should go through the cross-model review loop. */
export function shouldReview({ skills = [], task = null, agent = null, settings = null } = {}) {
  const cfg = getSkillSettings(settings);
  if (!cfg.enabled || cfg.reviewMode === 'off') return false;
  if (cfg.reviewMode === 'always') return true;
  if (skills.some((s) => s.important)) return true;
  if (task?.requiresApproval) return true;
  if (agent?.team === 'it' || /^agent_it_/.test(agent?.id || '')) return true;
  return false;
}

export function buildReviewRubric(skills = []) {
  const items = [];
  for (const s of skills) {
    for (const c of s.checklist || []) items.push(`[${s.name}] ${c}`);
    if (s.custom && s.instructions) items.push(`[${s.name}] 사용자 스킬 지침을 따랐는가`);
  }
  items.push('[공통] 지시한 내용에 실제로 답했는가(빠진 요구사항이 없는가)');
  items.push('[공통] 사실 오류·지어낸 수치/파일/기능이 없는가');
  return [...new Set(items)].slice(0, 18).map((x, i) => `${i + 1}. ${x}`).join('\n');
}

export function describeSkillsForClient(settings) {
  const cfg = getSkillSettings(settings);
  return {
    settings: { enabled: cfg.enabled, reviewMode: cfg.reviewMode, minScore: cfg.minScore, maxSkills: cfg.maxSkills, disabled: cfg.disabled },
    builtin: BUILTIN_SKILLS.map((s) => ({
      id: s.id,
      name: s.name,
      always: Boolean(s.always),
      important: Boolean(s.important),
      enabled: !cfg.disabled.includes(s.id),
      summary: (s.procedure || [])[0] || ''
    })),
    custom: cfg.custom
  };
}
