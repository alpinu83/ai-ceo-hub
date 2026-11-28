import { standaloneApi } from './standalone-runtime.js';

const PRESETS = {
  business: {
    title: 'B2B 제안서 작성 + 경쟁사 모니터링 + 고객 미팅 식당 예약',
    domain: 'business',
    directive:
      '신규 B2B 클라이언트용 5페이지 제안서 초안을 작성하고, 경쟁사 3곳 가격 변동을 매일 아침 브리핑하도록 세팅해줘. 목요일 저녁 4인 비즈니스 미팅 식당도 전화로 빈자리 확인 후 예약 준비해줘.'
  },
  life: {
    title: '주말 가족 모임 식당 예약 + 선물 조사 + 매일 아침 브리핑',
    domain: 'life',
    directive:
      '토요일 오후 6시 강남역 도보 10분 이내 부모님 포함 4인 조용한 식당을 전화로 확인해 예약 준비하고, 10만원 이내 선물 후보 3개 정리해줘. 내 취향과 일정 충돌도 함께 체크하고 매일 아침 날씨·주요 뉴스 브리핑 루틴도 만들어줘.'
  },
  content: {
    title: '유튜브 "무료 AI 비서 5종 실전 비교" 기획·대본·SNS 확산',
    domain: 'content',
    directive:
      '유튜브 10분 분량 "Gemini·Muse·피클·부이·Cue로 나만의 AI 회사 만들기" 영상 기획안과 촬영 대본을 작성하고, 블로그 요약 글과 스레드 홍보 초안 3종을 준비해줘. 최종 업로드는 내 승인 후 진행해줘.'
  },
  dev: {
    title: '결제 웹훅 멱등성 리팩토링 + 단위 테스트 + 코드 리뷰',
    domain: 'dev',
    directive:
      '결제 웹훅 재시도 로직의 엣지 케이스를 조사하고, 안전한 멱등성 처리 코드와 단위 테스트를 작성해 코드 리뷰까지 마쳐줘. 프로덕션 배포는 반드시 내 결재를 받은 뒤 진행해줘.'
  },
  it_ops: {
    title: 'CEO Office 자체 기능 보수 · 보안 감사 · QA 점검',
    domain: 'it_ops',
    directive:
      'GM Corp IT 유지보수팀은 현재 CEO Office의 개선 필요 사항을 점검하고, 수정 코드 패치(diff)·보안 취약점 리뷰·QA 테스트 시나리오를 작성해 보고해줘. 실제 배포 전에는 반드시 내 결재를 받아줘.'
  }
};

const HIRE_MODEL_CATALOG = {
  groq: [
    {
      id: 'openai/gpt-oss-120b',
      label: 'GPT-OSS 120B (무료 최상위 · 500t/s)',
      name: 'GPT-OSS 120B (Groq)',
      role: '초고속 기획·마케팅·QA 팀원 (Groq 무료)',
      strengths: 'Groq 초고속 무료 API(GPT-OSS 120B · 500t/s)로 기획안, 마케팅 카피, QA 체크리스트를 초단위로 작성',
      mode: 'api',
      cost: 'free'
    },
    {
      id: 'qwen/qwen3.8-27b',
      label: 'Qwen 3.8 27B (무료 · 코딩/보안/추론)',
      name: 'Qwen 3.8 (Groq)',
      role: '풀스택 코딩·자동화·SEO 전문 팀원 (Groq 무료)',
      strengths: 'Groq 최신 무료 Qwen 3.8 27B로 프론트·백엔드 코드 패치, SEO 구조 개선, 자동화 스크립트 구현',
      mode: 'api',
      cost: 'free'
    },
    {
      id: 'openai/gpt-oss-20b',
      label: 'GPT-OSS 20B (초경량 · 1000t/s)',
      name: 'GPT-OSS 20B (Groq)',
      role: '초고속 요약·분류·모니터링 팀원 (Groq 무료)',
      strengths: '1000t/s 초고속 무료 응답으로 단순 분류, 요약, 빠른 초안 작성 수행',
      mode: 'api',
      cost: 'free'
    }
  ],
  openrouter: [
    {
      id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      label: 'NVIDIA Nemotron 3 Ultra 550B (무료 추론 1위)',
      name: 'Nemotron 3 Ultra (OR)',
      role: '심층 추론·보안 감사·전략 분석 팀원 (OR 무료 550B)',
      strengths: 'OpenRouter 무료 1위 550B 추론 엔진으로 복잡한 수익 모델 설계, 보안 감사, 리스크 검증 수행',
      mode: 'api',
      cost: 'free'
    },
    {
      id: 'google/gemma-4-31b-it:free',
      label: 'Google Gemma 4 31B (무료 · UX/기획/글쓰기)',
      name: 'Gemma 4 31B (OR)',
      role: '기획·UX·카피라이팅 전문 팀원 (OR 무료)',
      strengths: 'Google Gemma 4 31B 무료 모델로 UX 개선안, 깔끔한 기획서·카피·코드 보조 수행',
      mode: 'api',
      cost: 'free'
    },
    {
      id: 'nvidia/nemotron-3.5-super-vl:free',
      label: 'NVIDIA Nemotron 3.5 Super (무료 · 1M 컨텍스트)',
      name: 'Nemotron 3.5 Super (OR)',
      role: '장문 리서치·대용량 문서 종합 팀원 (OR 무료)',
      strengths: '1M 컨텍스트 무료 모델로 방대한 자료 요약, 장문 코드베이스 분석, 멀티모달 리서치 수행',
      mode: 'api',
      cost: 'free'
    },
    {
      id: 'openrouter/free',
      label: 'OpenRouter Free Auto (무료 자동 라우터)',
      name: 'OpenRouter Auto (OR)',
      role: '다목적 자동 무료 지원 팀원 (OR 무료)',
      strengths: '가용 무료 모델 중 최적 모델을 자동 선택해 안정적으로 실무 초안 및 분석 수행',
      mode: 'api',
      cost: 'free'
    }
  ],
  gemini: [
    {
      id: 'gemini-4-hydrogen',
      label: 'Gemini 4 Hydrogen (무료 최상위)',
      name: 'Gemini 4 Hydrogen',
      role: '전략·총괄 기획 팀원 (Gemini 무료)',
      strengths: 'Google AI Studio 무료 최상위 모델로 긴 문맥 분석, 전략 기획, 구조화 보고서 작성 수행',
      mode: 'api',
      cost: 'free'
    },
    {
      id: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash (무료 고속)',
      name: 'Gemini 3.8 Flash',
      role: '고속 리서치·요약·실무 팀원 (Gemini 무료)',
      strengths: '빠른 응답 속도와 높은 정확도로 리서치, 문서 정리, 일상 업무 자동 처리',
      mode: 'api',
      cost: 'free'
    },
    {
      id: 'gemini-3.1-flash-lite-preview',
      label: 'Gemini 3.1 Flash Lite (초경량 무료)',
      name: 'Gemini 3.1 Flash Lite',
      role: '초경량 반복 정리·분류 팀원 (Gemini 무료)',
      strengths: '대량 텍스트 분류, 알림 요약, 단순 반복 정리 작업에 최적',
      mode: 'api',
      cost: 'free'
    }
  ],
  exaone: [
    {
      id: 'k-exaone_v2.5',
      label: 'LG K-EXAONE 2.5 (한국어 무료 · 512K)',
      name: 'LG K-EXAONE 2.5',
      role: '한국어 정밀 문서·세무·법무 팀원 (EXAONE 무료)',
      strengths: '512K 컨텍스트 한국어 특화 무료 모델로 세무·법무 검토, 한국어 제안서·이메일 작성 수행',
      mode: 'api',
      cost: 'free'
    }
  ],
  manus: [
    {
      id: 'manus-cue-mcp',
      label: 'Manus / Cue (MCP 커넥터)',
      name: 'Manus Cue',
      role: '외부 자율 실행·리서치 팀원 (MCP)',
      strengths: 'MCP 커넥터를 통해 외부 웹 리서치, 문서 작성, 제휴 조사를 자율 수행',
      mode: 'mcp',
      cost: 'freemium'
    }
  ],
  custom: []
};

const HIRE_ROLE_PRESETS = {
  it_dev: {
    team: 'it',
    role: 'IT팀 풀스택 개발·버그 보수',
    strengths: 'CEO Office UI·API 기능 보수, 버그 수정 패치(diff) 작성, 리팩토링 및 성능 최적화 전담'
  },
  it_sec: {
    team: 'it',
    role: 'IT팀 보안 감사·취약점 리뷰',
    strengths: 'API 키·토큰·인증 보안 감사, 취약점 진단, 코드 리뷰 및 실배포 전 안전성 검증 전담'
  },
  it_qa: {
    team: 'it',
    role: 'IT팀 QA·테스트·릴리스 검증',
    strengths: 'E2E 테스트 시나리오 작성, 회귀 버그 검증 체크리스트, PR·릴리스 노트 작성 전담'
  },
  strategy: {
    team: 'core',
    role: '전략·수익 모델·ROI 분석 팀원',
    strengths: '비즈니스 모델 설계, 단위 경제성(ROI) 검증, 경쟁사 비교 및 리스크 분석 수행'
  },
  marketing: {
    team: 'core',
    role: '마케팅·콘텐츠·카피라이팅 팀원',
    strengths: 'SEO 콘텐츠 기획, SNS 확산 카피, 전환율 중심 랜딩 페이지 문구 작성 수행'
  },
  docs: {
    team: 'core',
    role: '한국어 문서·법무·세무 검토 팀원',
    strengths: '국내 규정·세무/법무 유의사항 점검, 정교한 한국어 제안서 및 체크리스트 작성 수행'
  }
};

const VIEW_META = {
  command: { title: '홈', subtitle: '' },
  projects: { title: '프로젝트', subtitle: '' },
  missions: { title: '일반 업무', subtitle: '' },
  office: { title: '회의실', subtitle: '' },
  approvals: { title: '결재함', subtitle: '' },
  roster: { title: 'AI 팀', subtitle: '' },
  routines: { title: '루틴 업무', subtitle: '' },
  outsourcing: { title: '협업 큐', subtitle: '' },
  integrations: { title: '설정', subtitle: '' }
};

const DOMAIN_LABELS = {
  business: '비즈니스',
  life: '일상·예약',
  content: '콘텐츠',
  dev: '개발',
  it_ops: 'IT팀 보수'
};

const POLICY_LABELS = {
  free_first: '무료 우선',
  balanced: '균형',
  max_quality: '최고 성능'
};

const MODE_LABELS = {
  api: 'API 자동',
  litellm: 'LiteLLM',
  mcp: 'MCP',
  bridge: '앱·구독'
};

const COST_LABELS = {
  free: '무료',
  freemium: '부분 무료',
  paid_or_sub: '구독'
};

const STATUS_META = {
  queued: { label: '팀장 추진 중', cls: 'badge-neutral' },
  running: { label: '자동 작업 중', cls: 'badge-blue' },
  awaiting_bridge: { label: '외부 봇 위임됨', cls: 'badge-blue' },
  review_pending: { label: '팀장 검수 대기', cls: 'badge-amber' },
  outsourced: { label: '개발팀 진행 중', cls: 'badge-blue' },
  awaiting_approval: { label: 'CEO 결재 대기', cls: 'badge-amber' },
  completed: { label: '완료', cls: 'badge-green' },
  rejected: { label: '반려', cls: 'badge-red' },
  blocked: { label: '대표님 확인 필요', cls: 'badge-amber' }
};

const RENDER_BACKEND_URL = 'https://ai-ceo-hub.onrender.com';

let state = null;
let currentView = 'command';
let missionViewMode = 'tasks'; // 'tasks' | 'report'
let missionKindFilter = 'all'; // 'all' | 'project' | 'one_off'
let missionStatusFilter = 'all'; // 'all' | 'active' | 'external' | 'approval' | 'done'
let selectedMissionId = null;
let officeMissionFilter = 'all'; // 'all' | missionId
let selectedApprovalId = null;
let currentHubTab = 'quickstart';
let currentMcpTab = 'pickle';
let openDrawerTaskId = null;
let highlightedAgentId = null;

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatKRW(amount) {
  return `${(Number(amount) || 0).toLocaleString('ko-KR')}원`;
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(iso) {
  if (!iso) return '통신 기록 없음';
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return '방금 전';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

function tryParseJsonLoose(raw = '') {
  const txt = String(raw || '').trim();
  if (!txt || (txt[0] !== '{' && txt[0] !== '[')) return null;
  try {
    return JSON.parse(txt);
  } catch {
    try {
      return JSON.parse(txt.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

function renderShortsScriptCardHtml(obj) {
  const scenes = (Array.isArray(obj.scenes) ? obj.scenes : []).filter((s) => s && String(s.text || '').trim());
  const sources = (Array.isArray(obj.sources) ? obj.sources : []).map((u) => String(u || '').trim()).filter(Boolean);
  const hashtags = (Array.isArray(obj.hashtags) ? obj.hashtags : []).map((h) => String(h || '').trim()).filter(Boolean);
  const safeHref = (u) => (/^https?:\/\//i.test(u) ? u : '');
  const prettyJson = JSON.stringify(obj, null, 2);

  return `<div class="shorts-script-card">
    <div class="shorts-script-head">
      <div class="shorts-script-title">🎬 ${esc(obj.title || '쇼츠 대본')}</div>
      <span class="shorts-script-count">${scenes.length}장면</span>
    </div>
    <ol class="shorts-scene-list">
      ${scenes
        .map(
          (s, i) => `<li class="shorts-scene-item">
            <span class="shorts-scene-num">${i + 1}</span>
            <div class="shorts-scene-body">
              <div class="shorts-scene-text">${esc(s.text)}</div>
              ${s.keywords ? `<div class="shorts-scene-kw">배경 키워드: ${esc(s.keywords)}</div>` : ''}
            </div>
          </li>`
        )
        .join('')}
    </ol>
    ${
      sources.length
        ? `<div class="shorts-meta-block">
            <div class="shorts-meta-label">출처 기사</div>
            <ul class="shorts-sources">
              ${sources
                .map((u) => {
                  const href = safeHref(u);
                  return href
                    ? `<li><a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(u)}</a></li>`
                    : `<li>${esc(u)}</li>`;
                })
                .join('')}
            </ul>
          </div>`
        : ''
    }
    ${
      hashtags.length
        ? `<div class="shorts-hashtags">${hashtags.map((h) => `<span class="shorts-hashtag">${esc(h)}</span>`).join('')}</div>`
        : ''
    }
    <details class="shorts-raw-json">
      <summary>자동 제작용 원본 JSON 보기</summary>
      <pre><code>${esc(prettyJson)}</code></pre>
    </details>
  </div>`;
}

function renderMarkdown(md = '') {
  const cards = [];
  let source = String(md || '');

  const makeCardToken = (obj) => {
    const idx = cards.length;
    cards.push(renderShortsScriptCardHtml(obj));
    return `\n\n@@SHORTS_CARD_${idx}@@\n\n`;
  };

  // 1) Fenced JSON blocks: render Shorts scripts as readable cards & pretty-print minified single-line JSON
  source = source.replace(/```(?:json)?\s*\r?\n?([\s\S]*?)```/gi, (match, inner) => {
    const obj = tryParseJsonLoose(inner);
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.title === 'string' && Array.isArray(obj.scenes) && obj.scenes.some((s) => s && String(s.text || '').trim())) {
      return makeCardToken(obj);
    }
    if (obj && !String(inner || '').trim().includes('\n') && String(inner || '').length > 100) {
      return `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
    }
    return match;
  });

  // 2) Fallback: standalone bare Shorts script JSON without code fences
  if (cards.length === 0) {
    const bareStart = source.lastIndexOf('{"title"');
    const bareEnd = source.lastIndexOf('}');
    if (bareStart >= 0 && bareEnd > bareStart) {
      const candidate = source.slice(bareStart, bareEnd + 1);
      const obj = tryParseJsonLoose(candidate);
      if (obj && typeof obj.title === 'string' && Array.isArray(obj.scenes) && obj.scenes.some((s) => s && String(s.text || '').trim())) {
        source = `${source.slice(0, bareStart)}${makeCardToken(obj)}${source.slice(bareEnd + 1)}`;
      }
    }
  }

  // Strip raw HTML tags before parsing with Marked for safety while keeping full GFM tables & checklists
  const cleaned = source.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html =
    window.marked && typeof window.marked.parse === 'function'
      ? window.marked.parse(cleaned, { gfm: true, breaks: true })
      : `<pre style="white-space:pre-wrap;margin:0">${cleaned}</pre>`;

  if (cards.length > 0) {
    html = html.replace(/(?:<p>)?@@SHORTS_CARD_(\d+)@@(?:<\/p>)?/g, (_, n) => cards[Number(n)] || '');
  }
  return html;
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function toast(msg, isError = false) {
  const region = document.getElementById('toast-region');
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = msg;
  region.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

let runtimeMode = 'detecting'; // 'server' | 'standalone'
let apiBase = ''; // '' (same-origin) | RENDER_BACKEND_URL

function getPublicServerOrigin() {
  if (apiBase) return apiBase;
  if (runtimeMode === 'server') return window.location.origin;
  return RENDER_BACKEND_URL;
}

async function probeHealth(baseUrl, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/health`, { cache: 'no-store', signal: ctrl.signal });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.ok === true) return true;
    }
  } catch {
    // retry or fallback
  } finally {
    clearTimeout(timer);
  }
  return false;
}

async function detectRuntime() {
  const host = window.location.hostname || '';
  const isStaticPages = host.endsWith('github.io');

  if (!isStaticPages) {
    // Same-origin Node/Render server: retry up to 3 times to survive Render cold starts without dropping to localStorage
    for (let i = 0; i < 3; i++) {
      if (await probeHealth('.', i === 0 ? 8000 : 18000)) {
        runtimeMode = 'server';
        apiBase = '';
        return;
      }
      if (i === 0) toast('서버 깨우는 중… 잠시만 기다려 주세요');
    }
  }

  // On GitHub Pages (or remote static host): auto-connect to unified Render server so PC and mobile share 1 DB!
  for (let i = 0; i < 2; i++) {
    if (await probeHealth(RENDER_BACKEND_URL, i === 0 ? 10000 : 20000)) {
      runtimeMode = 'server';
      apiBase = RENDER_BACKEND_URL;
      return;
    }
    if (i === 0) toast('Render 서버 연결 중…');
  }

  runtimeMode = 'standalone';
  apiBase = '';
}

async function api(url, options = {}) {
  if (runtimeMode === 'standalone') {
    return standaloneApi(url, options);
  }
  const targetUrl = apiBase
    ? `${apiBase}${url.startsWith('/') ? url : `/${url}`}`
    : url.startsWith('/')
      ? `.${url}`
      : url;
  const adminKey = localStorage.getItem('ceoAdminKey') || '';
  const res = await fetch(targetUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(adminKey ? { 'x-ceo-key': adminKey } : {}),
      ...(options.headers || {})
    }
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (res.status === 401 && typeof data === 'object' && data.code === 'CEO_KEY_REQUIRED' && !options._keyRetried) {
    const unlocked = await ensureCeoAuth();
    if (unlocked) return api(url, { ...options, _keyRetried: true });
  }
  if (!res.ok) {
    throw new Error((typeof data === 'object' && data.error) || `요청 실패 (${res.status})`);
  }
  return data;
}

// ---- CEO login (server CEO_ADMIN_KEY lock) ----
let ceoAuthPromise = null;
let ceoAuthDeclined = false;

async function rawAuthPost(path, body) {
  const base = apiBase ? apiBase : '.';
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

async function verifyTelegramLogin(payload) {
  const data = await rawAuthPost('/api/auth/telegram-verify', payload);
  if (data.key) localStorage.setItem('ceoAdminKey', data.key);
  return true;
}

function ensureCeoAuth() {
  if (ceoAuthDeclined) return Promise.resolve(false);
  if (ceoAuthPromise) return ceoAuthPromise;
  ceoAuthPromise = (async () => {
    localStorage.removeItem('ceoAdminKey');
    const useTelegram = window.confirm(
      'CEO Office 로그인이 필요합니다.\n\n[확인] 텔레그램으로 로그인 코드 받기\n[취소] 관리자 키 직접 입력'
    );
    try {
      if (useTelegram) {
        await rawAuthPost('/api/auth/telegram-request');
        for (let attempt = 0; attempt < 3; attempt++) {
          const code = window.prompt('텔레그램으로 보낸 6자리 로그인 코드를 입력하세요.\n(텔레그램 메시지의 링크를 눌러도 됩니다)', '');
          if (!code) break;
          try {
            return await verifyTelegramLogin({ code });
          } catch (err) {
            toast(err.message, true);
          }
        }
      } else {
        const entered = window.prompt('관리자 키(CEO_ADMIN_KEY)를 입력하세요:', '');
        if (entered && entered.trim()) {
          localStorage.setItem('ceoAdminKey', entered.trim());
          return true;
        }
      }
    } catch (err) {
      toast(err.message, true);
    }
    ceoAuthDeclined = true;
    toast('로그인하지 않아 데이터를 불러오지 못했습니다. 새로고침하면 다시 로그인할 수 있습니다.', true);
    return false;
  })().finally(() => {
    setTimeout(() => {
      ceoAuthPromise = null;
    }, 0);
  });
  return ceoAuthPromise;
}

async function consumeLoginLinkFromHash() {
  const m = String(location.hash || '').match(/login=([a-f0-9]{20,})/i);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    await verifyTelegramLogin({ token: m[1] });
    toast('텔레그램 로그인 완료');
  } catch (err) {
    toast(err.message, true);
  }
}

function getAgent(id) {
  return state?.agents?.find((a) => a.id === id) || null;
}

function activeLeadDisplayName() {
  const onDuty = state?.leadDesk?.onDuty;
  if (onDuty === 'agy_lead') return '총괄 팀장 (AGY · Hydrogen)';
  if (onDuty === 'gemini_app') return '총괄 팀장 (Gemini 앱 당직)';
  return '총괄 팀장';
}

function displayAgentName(id, ctx = null) {
  if (id === 'agent_gemini_neon') return activeLeadDisplayName();
  const ag = getAgent(id);
  if (ag && ag.active === false && ['agent_it_dev', 'agent_it_sec', 'agent_it_qa'].includes(id)) {
    const txt = `${ctx?.title || ''} ${ctx?.summary || ''}`;
    if (ctx?.outsourceId || ctx?.kind === 'it_pr_merge' || /OUT-|개발팀|Aside|Antigravity|AGY/i.test(txt)) {
      if (/Antigravity|AGY/i.test(ctx?.title || '') && !/Aside/i.test(ctx?.title || '')) return '개발팀 · AGY';
      if (/Aside/i.test(ctx?.title || '')) return '개발팀 · Aside';
      return '개발팀 (AGY · Aside)';
    }
  }
  return ag?.name || id || '팀원';
}

function cleanInhouseCopy(text = '') {
  return String(text || '')
    .replace(/^외주\s*요청\s*OUT-[A-Z0-9-]+:\s*/gim, '')
    .replace(/\[OUT-[A-Z0-9-]+\]\s*/gi, '')
    .replace(/\(외주\s*OUT-[A-Z0-9-]+\)/gi, '')
    .replace(/외부\s*작업자\(\s*aside\s*\)(가|이)?/gi, '개발팀(Aside)이')
    .replace(/외부\s*작업자\(\s*(?:antigravity|agy)\s*\)(가|이)?/gi, '개발팀(AGY)이')
    .replace(/외부\s*작업자\(([^)]+)\)(가|이)?/gi, '개발팀($1)이')
    .replace(/외주\s*PR\s*#/g, '개발팀 PR #');
}

async function copyText(text, label = '복사되었습니다.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(label);
  }
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ==================== RENDERING ==================== */

let activeSpeakerId = null;
let liveHandoffLabel = '';
let isPlayingLiveSession = false;

function renderAll() {
  if (!state) return;
  if (!selectedMissionId || !state.missions.some((m) => m.id === selectedMissionId)) {
    selectedMissionId = state.missions[0]?.id || null;
  }
  if (!selectedApprovalId || !state.approvals.some((a) => a.id === selectedApprovalId)) {
    const firstPending = state.approvals.find((a) => a.status === 'pending');
    selectedApprovalId = firstPending?.id || state.approvals[0]?.id || null;
  }

  renderChrome();
  renderHomeView();
  renderCommandView();
  renderOfficeView();
  renderApprovalsView();
  renderRosterView();
  renderRoutinesView();
  renderOutsourcingView();
  renderIntegrationsView();

  if (openDrawerTaskId) {
    const t = state.tasks.find((item) => item.id === openDrawerTaskId);
    if (t) renderTaskDrawer(t);
    else closeDrawer();
  }

  refreshIcons();
}

function renderChrome() {
  const s = state.settings;
  const leadDeskOn = s?.leadDesk?.enabled !== false;
  const activeWorkers = state.agents.filter((a) => a.active && (!leadDeskOn || a.tier !== 'lead'));
  const activeCount = leadDeskOn ? activeWorkers.length + 1 : activeWorkers.length;
  const pendingCount = state.approvals.filter((a) => a.status === 'pending').length;
  const totalTasks = state.tasks.length;
  const doneTasks = state.tasks.filter((t) => t.status === 'completed').length;
  const taskPct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  document.getElementById('sidebar-company-name').textContent = s.companyName || 'CEO Office';
  document.getElementById('sidebar-ceo-name').textContent = s.ceoName || '대표님';

  const badge = document.getElementById('nav-approval-badge');
  if (badge) {
    badge.textContent = String(pendingCount);
    badge.classList.toggle('has-pending', pendingCount > 0);
  }
  const mobBadge = document.getElementById('mobile-approval-badge');
  if (mobBadge) {
    mobBadge.textContent = String(pendingCount);
    mobBadge.classList.toggle('show', pendingCount > 0);
  }

  // Executive 3-Cell KPI Strip (대표님 To Do · Missions · Active AI) — 결재 대기는 To Do List에 포함
  document.getElementById('kpi-approvals-val').textContent = `${buildCeoInboxClient().length}건`;
  document.getElementById('kpi-agents-val').textContent = `${state.missions.length}건 · ${taskPct}%`;
  document.getElementById('kpi-budget-val').textContent = `${activeCount}명`;

  const meta = VIEW_META[currentView] || VIEW_META.command;
  document.getElementById('page-title').textContent = meta.title;
  const sub = document.getElementById('page-subtitle');
  if (sub) sub.textContent = meta.subtitle || '';

  renderSidebarTree();
  renderUsageWidget();
}

// ---- 좌측 메뉴 하단 AI 사용량 위젯 (Aside·Claude / AGY / Gemini 앱) ----
// 서버 state.subscriptionUsage(src/subscription-usage.js)를 그린다. 구독 앱은 공식 잔여량 API가 없어
// Hub가 직접 본 처리 건수 + 대표님이 정한 목표 상한 + (선택) 앱 화면에서 본 잔여량 기록을 함께 보여 준다.
function usageRelTime(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function usageResetText(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = new Date().toDateString() === d.toDateString();
  return `${sameDay ? '' : `${d.getMonth() + 1}/${d.getDate()} `}${hhmm} 리셋`;
}

function usageValueText(w) {
  if (w.source === 'limited') return '한도 도달';
  if (w.source === 'snapshot' && typeof w.estimatedRemainingPercent === 'number') return `잔여 ~${w.estimatedRemainingPercent}%`;
  return `${w.count}/${w.limit}`;
}

function usageOnlineText(w) {
  if (w.online) return '접속 중';
  return w.lastSeenAt ? `대기 · 마지막 접속 ${usageRelTime(w.lastSeenAt)}` : '대기 · 접속 기록 없음';
}

function renderUsageWidget() {
  const wrap = document.getElementById('ai-usage-widget');
  const box = document.getElementById('ai-usage-rows');
  if (!wrap || !box) return;
  const workers = state?.subscriptionUsage?.workers || [];
  if (!workers.length) {
    wrap.classList.add('is-empty');
    box.innerHTML = `<p class="ai-usage-empty">${runtimeMode === 'standalone' ? '서버 연결 시 표시됩니다' : '집계 준비 중'}</p>`;
    return;
  }
  wrap.classList.remove('is-empty');
  box.innerHTML = workers
    .map((w) => {
      const pct = Math.max(0, Math.min(100, Number(w.usedPercent) || 0));
      const level = ['ok', 'warn', 'limit'].includes(w.level) ? w.level : 'ok';
      const tip = [
        `${w.windowLabel} ${w.count}건 / 상한 ${w.limit}건`,
        w.breakdown ? `협업 큐 ${w.breakdown.outsourcing}건 · 팀장 판단 ${w.breakdown.leadDesk}건` : '',
        `오늘 ${w.today}건 · 최근 5시간 ${w.last5h}건`,
        w.snapshot?.active && typeof w.snapshot.remainingPercent === 'number' ? `기록한 잔여 ${w.snapshot.remainingPercent}% (${usageRelTime(w.snapshot.at)}) · 이후 ${w.sinceSnapshot}건` : '',
        w.snapshot?.active && w.snapshot.resetAt ? usageResetText(w.snapshot.resetAt) : '',
        usageOnlineText(w)
      ]
        .filter(Boolean)
        .join('\n');
      return `<button type="button" class="ai-usage-row level-${level}" data-usage-worker="${esc(w.id)}" title="${esc(tip)}">
        <span class="ai-usage-line">
          <span class="ai-usage-name"><span class="ai-usage-dot${w.online ? ' on' : ''}" aria-hidden="true"></span>${esc(w.label)}</span>
          <span class="ai-usage-val">${esc(usageValueText(w))}</span>
        </span>
        <span class="ai-usage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(w.label)} 사용률"><span class="ai-usage-fill" style="width:${pct}%"></span></span>
      </button>`;
    })
    .join('');
  if (document.getElementById('usage-modal-backdrop')?.classList.contains('open')) renderUsageModalSummary();
}

function renderUsageModalSummary() {
  const el = document.getElementById('usage-modal-summary');
  if (!el) return;
  const workers = state?.subscriptionUsage?.workers || [];
  el.innerHTML = workers
    .map((w) => {
      const snap = w.snapshot;
      let snapText = '잔여량 기록 없음';
      if (snap) {
        const parts = [];
        if (typeof snap.remainingPercent === 'number') parts.push(`남은 ${snap.remainingPercent}%`);
        if (snap.limited) parts.push('한도 도달');
        if (snap.resetAt) parts.push(usageResetText(snap.resetAt));
        parts.push(`${usageRelTime(snap.at)} 기록`);
        if (w.sinceSnapshot) parts.push(`이후 Hub 처리 ${w.sinceSnapshot}건`);
        if (snap.note) parts.push(snap.note);
        snapText = `${snap.active ? '' : '(지난 기록) '}${parts.join(' · ')}`;
      }
      return `<div class="usage-sum-row level-${esc(w.level)}">
        <div class="usage-sum-head"><strong>${esc(w.label)}</strong><span>${esc(usageValueText(w))}</span></div>
        <div class="usage-sum-meta">${esc(w.windowLabel)} ${w.count}건 / 상한 ${w.limit}건${w.breakdown ? ` (협업 큐 ${w.breakdown.outsourcing} · 팀장 판단 ${w.breakdown.leadDesk})` : ''} · ${w.window === '5h' ? `오늘 ${w.today}건` : `최근 5시간 ${w.last5h}건`} · ${esc(usageOnlineText(w))}</div>
        <div class="usage-sum-meta">${esc(snapText)}</div>
      </div>`;
    })
    .join('');
}

function renderUsageLimitFields() {
  const el = document.getElementById('usage-limits-fields');
  if (!el) return;
  const workers = state?.subscriptionUsage?.workers || [];
  el.innerHTML = workers
    .map(
      (w) => `<div class="usage-limit-row">
        <span class="usage-limit-name">${esc(w.label)}</span>
        <select data-usage-window="${esc(w.id)}" aria-label="${esc(w.label)} 집계 구간">
          <option value="5h"${w.window === '5h' ? ' selected' : ''}>5시간</option>
          <option value="day"${w.window === 'day' ? ' selected' : ''}>하루(KST)</option>
        </select>
        <input type="number" min="1" max="1000" step="1" inputmode="numeric" data-usage-limit="${esc(w.id)}" value="${Number(w.limit) || 1}" aria-label="${esc(w.label)} 상한(건)" />
        <span class="usage-limit-unit">건</span>
      </div>`
    )
    .join('');
}

function resetUsageSnapshotForm() {
  for (const id of ['usage-snap-remaining', 'usage-snap-reset', 'usage-snap-note']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  const lim = document.getElementById('usage-snap-limited');
  if (lim) lim.checked = false;
}

function openUsageModal(workerId = '') {
  if (runtimeMode === 'standalone') {
    toast('서버에 연결된 상태에서만 사용량을 기록할 수 있습니다.', true);
    return;
  }
  const bd = document.getElementById('usage-modal-backdrop');
  if (!bd) return;
  renderUsageModalSummary();
  renderUsageLimitFields();
  resetUsageSnapshotForm();
  const sel = document.getElementById('usage-snap-worker');
  if (sel && workerId && [...sel.options].some((o) => o.value === workerId)) sel.value = workerId;
  bd.classList.add('open');
  bd.setAttribute('aria-hidden', 'false');
  refreshIcons();
}

function closeUsageModal() {
  const bd = document.getElementById('usage-modal-backdrop');
  if (!bd) return;
  bd.classList.remove('open');
  bd.setAttribute('aria-hidden', 'true');
}

function applyUsageResponse(res) {
  if (res?.state) state = res.state;
  else if (res?.usage && state) state.subscriptionUsage = res.usage;
  renderUsageWidget();
  renderUsageModalSummary();
}

function bindUsageWidget() {
  document.getElementById('btn-ai-usage-open')?.addEventListener('click', () => openUsageModal());
  document.getElementById('ai-usage-rows')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-usage-worker]');
    if (row) openUsageModal(row.dataset.usageWorker);
  });
  const bd = document.getElementById('usage-modal-backdrop');
  document.getElementById('btn-close-usage-modal')?.addEventListener('click', closeUsageModal);
  bd?.addEventListener('click', (e) => {
    if (e.target === bd) closeUsageModal();
  });

  document.getElementById('usage-limits-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const limits = {};
    document.querySelectorAll('[data-usage-limit]').forEach((input) => {
      const id = input.dataset.usageLimit;
      const win = document.querySelector(`[data-usage-window="${id}"]`)?.value;
      limits[id] = { limit: Number(input.value), ...(win ? { window: win } : {}) };
    });
    const bad = Object.values(limits).find((l) => !Number.isInteger(l.limit) || l.limit < 1 || l.limit > 1000);
    if (bad) {
      toast('상한은 1~1000 사이 정수로 입력해 주세요.', true);
      return;
    }
    try {
      const res = await api('/api/ops/usage-limits', { method: 'POST', body: JSON.stringify({ limits }) });
      applyUsageResponse(res);
      renderUsageLimitFields();
      toast('AI 사용량 목표 상한을 저장했습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('usage-snapshot-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const worker = document.getElementById('usage-snap-worker')?.value || 'aside';
    const remaining = String(document.getElementById('usage-snap-remaining')?.value || '').trim();
    const resetVal = document.getElementById('usage-snap-reset')?.value || '';
    const note = String(document.getElementById('usage-snap-note')?.value || '').trim();
    const limited = Boolean(document.getElementById('usage-snap-limited')?.checked);
    const payload = { worker };
    if (remaining !== '') {
      const n = Number(remaining);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        toast('남은 %는 0~100 사이 숫자로 입력해 주세요.', true);
        return;
      }
      payload.remainingPercent = n;
    }
    if (resetVal) {
      const t = new Date(resetVal);
      if (Number.isNaN(t.getTime())) {
        toast('리셋 시각을 다시 확인해 주세요.', true);
        return;
      }
      payload.resetAt = t.toISOString();
    }
    if (limited) payload.limited = true;
    if (note) payload.note = note;
    if (payload.remainingPercent === undefined && !payload.resetAt && !limited) {
      toast('남은 %, 리셋 시각, 한도 도달 중 하나는 입력해 주세요.', true);
      return;
    }
    try {
      const res = await api('/api/ops/usage-snapshot', { method: 'POST', body: JSON.stringify(payload) });
      applyUsageResponse(res);
      resetUsageSnapshotForm();
      toast('잔여량을 기록했습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('btn-usage-snap-clear')?.addEventListener('click', async () => {
    const worker = document.getElementById('usage-snap-worker')?.value || 'aside';
    try {
      const res = await api('/api/ops/usage-snapshot', { method: 'POST', body: JSON.stringify({ worker, clear: true }) });
      applyUsageResponse(res);
      toast('잔여량 기록을 지웠습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function getNavGroupExpanded(groupKey) {
  const saved = localStorage.getItem(`ceo_nav_open_${groupKey}`);
  return saved === null ? true : saved === '1';
}

function setNavGroupExpanded(groupKey, isOpen) {
  localStorage.setItem(`ceo_nav_open_${groupKey}`, isOpen ? '1' : '0');
  const grp = document.getElementById(`nav-group-${groupKey}`);
  const btn = grp?.querySelector('.nav-toggle-btn');
  if (grp) grp.classList.toggle('expanded', isOpen);
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function renderSidebarTree() {
  if (!state) return;
  const allMissions = state.missions || [];
  const projects = allMissions.filter((m) => m.mode === 'project');
  const oneOffs = allMissions.filter((m) => m.mode !== 'project');

  const pCount = document.getElementById('nav-projects-count');
  const mCount = document.getElementById('nav-missions-count');
  if (pCount) pCount.textContent = String(projects.length);
  if (mCount) mCount.textContent = String(oneOffs.length);

  setNavGroupExpanded('projects', getNavGroupExpanded('projects'));
  setNavGroupExpanded('missions', getNavGroupExpanded('missions'));

  const renderGroup = (elId, list, viewKey, emptyLabel) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (list.length === 0) {
      el.innerHTML = `<div class="nav-subempty">${emptyLabel}</div>`;
      return;
    }
    el.innerHTML = list
      .map((m) => {
        const tasks = state.tasks.filter((t) => t.missionId === m.id);
        const done = tasks.filter((t) => t.status === 'completed').length;
        const isActive = currentView === viewKey && selectedMissionId === m.id;
        const prefix = viewKey === 'projects' && msProgress(m) ? `${msProgress(m)} ` : '';
        return `<button type="button" class="nav-subitem ${isActive ? 'active' : ''}" data-sidebar-mission="${esc(m.id)}" data-sidebar-view="${viewKey}" title="${esc(m.title)}">
          <span class="nav-subitem-title">${esc(prefix + m.title)}</span>
          <span class="nav-subitem-meta">${done}/${tasks.length}</span>
        </button>`;
      })
      .join('');
  };

  renderGroup('nav-sublist-projects', projects, 'projects', '프로젝트 없음');
  renderGroup('nav-sublist-missions', oneOffs, 'missions', '일반 업무 없음');
}

/** 대표님 할 일: 모든 프로젝트에서 대표님 때문에 멈춘 일 (서버 src/hub/ceo-inbox.js와 같은 규칙) */
const INBOX_LABEL = { approval: ['badge-amber', '결재'], gate: ['badge-red', '관문 결정'], shorts_pick: ['badge-blue', '뉴스 고르기'], blocked: ['badge-red', '확인 필요'], outsource: ['badge-amber', '개발팀 요청'] };
function buildCeoInboxClient() {
  const items = [];
  const mt = (id) => state.missions.find((m) => m.id === id)?.title || '';
  const hrs = (iso) => (iso ? Math.max(0, (Date.now() - Date.parse(iso)) / 3600000) : 0);
  for (const a of state.approvals || []) {
    if (a.status !== 'pending') continue;
    items.push({ kind: a.kind === 'stage_gate' ? 'gate' : 'approval', approvalId: a.id, missionId: a.missionId, missionTitle: mt(a.missionId), title: cleanInhouseCopy(a.title), detail: a.kind === 'stage_gate' ? '이 결정이 나야 다음 단계로 넘어갑니다' : '', since: a.createdAt, open: `data-open-approval="${esc(a.id)}"`, btn: '결재하기' });
  }
  const sm = state.missions.find((m) => m.mode === 'project' && /쇼츠|shorts/i.test(m.title) && m.status !== 'completed');
  const sh = state.shorts || {};
  const fresh = (sh.candidates || []).filter((c) => c.status === 'new');
  const inFlightTask = sm && (state.tasks || []).some((t) => t.missionId === sm.id && t.shorts && ['queued', 'running', 'awaiting_bridge', 'review_pending', 'awaiting_approval', 'outsourced'].includes(t.status));
  const inFlightJob = sm && (sh.jobs || []).some((j) => j.missionId === sm.id && ['queued', 'rendering'].includes(j.status));
  const inFlight = Boolean(inFlightTask || inFlightJob);
  if (sm && fresh.length && !inFlight) items.push({ kind: 'shorts_pick', missionId: sm.id, missionTitle: sm.title, title: `쇼츠로 만들 뉴스 1개 고르기 (후보 ${fresh.length}건)`, detail: fresh[0].title, since: sh.lastCollectedAt || fresh[0].createdAt, open: `data-open-mission-board="${esc(sm.id)}"`, btn: '고르러 가기' });
  const blockedBy = new Map();
  for (const t of state.tasks || []) {
    if (t.status !== 'blocked') continue;
    const m = state.missions.find((x) => x.id === t.missionId);
    if (!m || m.status === 'completed') continue;
    if (!blockedBy.has(m.id)) blockedBy.set(m.id, { m, tasks: [] });
    blockedBy.get(m.id).tasks.push(t);
  }
  for (const { m, tasks } of blockedBy.values()) {
    tasks.sort((x, y) => String(x.updatedAt).localeCompare(String(y.updatedAt)));
    const one = tasks.length === 1;
    items.push({ kind: 'blocked', missionId: m.id, missionTitle: m.title, title: one ? tasks[0].title : `보류된 작업 ${tasks.length}건 — 다시 맡길지 정리할지 결정`, detail: one ? tasks[0].blockedReason || '보류됨' : tasks.slice(0, 3).map((t) => t.title).join(' · '), since: tasks[0].updatedAt, open: `data-open-mission-board="${esc(m.id)}"`, btn: '프로젝트에서 확인', btnGhost: true, tasks });
  }
  for (const o of state.outsourcing || []) {
    if (o.status !== 'needs_ceo') continue;
    items.push({ kind: 'outsource', missionId: o.missionId, missionTitle: mt(o.missionId), title: o.title, detail: o.ceoAction?.action || '대표님 확인 필요', since: o.ceoAction?.at || o.updatedAt, open: 'data-jump-view="outsourcing"', btn: '협업 큐에서 보기', btnGhost: true, outsource: o });
  }
  for (const it of items) it.ageHours = hrs(it.since);
  return items.sort((x, y) => y.ageHours - x.ageHours);
}
/** 대표님 할 일 · 보류된 작업: 작업별로 피드백 주고 다시 맡기기 / 이대로 완료 / 작업 접기 (POST /api/tasks/ceo-decision) */
function renderInboxBlockedTasks(it) {
  const agents = (state.agents || []).filter((a) => a.active && a.tier !== 'lead');
  const assigneeSelect = (key) =>
    `<select class="assignee-select" data-inbox-assignee="${esc(key)}" aria-label="다시 맡길 담당"><option value="">담당 그대로</option>${agents.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}에게</option>`).join('')}</select>`;
  const actions = (ids, key, hasOutput) => `<div class="home-item-actions" style="align-items:center;">
      ${assigneeSelect(key)}
      <button type="button" class="btn btn-primary btn-sm" data-inbox-decide="retry" data-inbox-tasks="${esc(ids.join(','))}" data-inbox-key="${esc(key)}">피드백 반영해 다시 맡기기</button>
      ${hasOutput ? `<button type="button" class="btn btn-ghost btn-sm" data-inbox-decide="accept" data-inbox-tasks="${esc(ids.join(','))}" data-inbox-key="${esc(key)}">이대로 완료</button>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-inbox-decide="drop" data-inbox-tasks="${esc(ids.join(','))}" data-inbox-key="${esc(key)}" style="color:var(--accent-danger);">작업 접기</button>
    </div>`;
  const feedbackBox = (key, placeholder) => `<textarea rows="2" data-inbox-feedback="${esc(key)}" placeholder="${esc(placeholder)}" style="margin-top:6px;"></textarea>`;
  const rows = it.tasks
    .map((t) => {
      const ag = getAgent(t.assigneeId);
      const hasOutput = Boolean(String(t.output || '').trim());
      return `<div style="border-top:1px solid var(--border-hairline);padding:10px 0 4px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="min-width:0;"><div style="font-weight:600;line-height:1.4;">${esc(t.title)}</div><div class="routine-sub">보류 사유: ${esc(t.blockedReason || '보류됨')}${ag ? ` · 담당 ${esc(ag.name)}` : ''}</div></div>
          <button type="button" class="btn btn-ghost btn-sm" data-open-drawer="${esc(t.id)}">${hasOutput ? '결과 보기' : '상세'}</button>
        </div>
        ${feedbackBox(t.id, '피드백·지시 (선택) 예) 배포·코드 얘기는 빼고 문서로만 정리해')}
        ${actions([t.id], t.id, hasOutput)}
      </div>`;
    })
    .join('');
  const many = it.tasks.length > 1;
  const bulk = many
    ? `<div style="padding:4px 0 8px;">
        <div class="routine-sub">한 번에 결정 (${it.tasks.length}건 모두)</div>
        ${feedbackBox(`all:${it.missionId}`, '모두에게 줄 피드백 (선택)')}
        ${actions(it.tasks.map((t) => t.id), `all:${it.missionId}`, it.tasks.some((t) => String(t.output || '').trim()))}
      </div>`
    : '';
  return `<details data-inbox-details="${esc(it.missionId)}" ${many ? '' : 'open'} style="margin-top:4px;">
      <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--accent-primary);">${many ? `작업별로 결정하기 (${it.tasks.length}건)` : '결정하기'}</summary>
      ${bulk}${rows}
    </details>`;
}

/** 대표님 할 일 · 외주 조치: 할 일 설명 + 여기서 바로 재개 */
function renderInboxOutsourceActions(o) {
  const detail = o.ceoAction?.detail ? `<div class="routine-sub" style="width:100%;">${esc(String(o.ceoAction.detail).slice(0, 300))}</div>` : '';
  return `${detail}<button type="button" class="btn btn-primary btn-sm" data-out-resume="${esc(o.id)}" data-out-resume-worker="">처리했어요 · 재개</button>`;
}

function renderCeoInbox() {
  const wrap = document.getElementById('home-ceo-inbox');
  // 다시 그리기 전에 펼친 목록·쓰던 피드백을 기억 (5초 자동 갱신으로 사라지지 않게)
  const keepOpen = new Set(wrap ? [...wrap.querySelectorAll('details[data-inbox-details]')].filter((d) => d.open).map((d) => d.dataset.inboxDetails) : []);
  const keepVals = {};
  if (wrap) wrap.querySelectorAll('[data-inbox-feedback],[data-inbox-assignee]').forEach((el) => { if (el.value) keepVals[el.dataset.inboxFeedback !== undefined ? `f:${el.dataset.inboxFeedback}` : `a:${el.dataset.inboxAssignee}`] = el.value; });
  const items = buildCeoInboxClient();
  const base = String(document.title || 'CEO Office').replace(/^\(\d+\)\s*/, '');
  document.title = items.length ? `(${items.length}) ${base}` : base;
  const nav = document.getElementById('nav-command');
  if (nav) {
    let b = nav.querySelector('.ceo-inbox-count');
    if (!b) { b = document.createElement('span'); b.className = 'badge badge-red ceo-inbox-count'; b.style.marginLeft = 'auto'; nav.appendChild(b); }
    b.textContent = items.length ? String(items.length) : '';
    b.style.display = items.length ? '' : 'none';
  }
  if (!wrap) return;
  if (!items.length) {
    wrap.innerHTML = '<div class="card" style="margin-bottom:14px;"><div class="card-head"><h2 class="card-title">대표님 To Do List (텔레그램 /todo)</h2></div><div class="empty-state">지금 대표님 때문에 멈춘 일은 없습니다 ✓</div></div>';
    return;
  }
  const age = (h) => (h >= 24 ? `${Math.floor(h / 24)}일째 대기` : h >= 1 ? `${Math.floor(h)}시간째 대기` : '방금');
  wrap.innerHTML = `<div class="card" style="margin-bottom:14px;border:2px solid var(--accent-amber, #d97706);">
      <div class="card-head"><h2 class="card-title">대표님 To Do List (텔레그램 /todo) <span class="badge badge-red">${items.length}</span></h2></div>
      <div class="clean-stack">${items
        .slice(0, 10)
        .map((it) => {
          const [cls, label] = INBOX_LABEL[it.kind] || ['badge-neutral', it.kind];
          return `<div class="home-item pending-accent">
            <div class="home-item-top"><div style="display:flex;gap:5px;flex-wrap:wrap;min-width:0;"><span class="badge ${cls}">${label}</span>${it.missionTitle ? `<span class="badge badge-neutral">${esc(it.missionTitle)}</span>` : ''}</div><span class="mono" style="color:${it.ageHours >= 24 ? 'var(--accent-red, #dc2626)' : 'var(--ink-muted)'};">${age(it.ageHours)}</span></div>
            <div class="home-item-title">${esc(it.title)}</div>
            ${it.detail ? `<div class="routine-sub">${esc(String(it.detail).slice(0, 140))}</div>` : ''}
            ${it.kind === 'blocked' && it.tasks?.length ? renderInboxBlockedTasks(it) : ''}
            <div class="home-item-actions">${it.kind === 'outsource' && it.outsource ? renderInboxOutsourceActions(it.outsource) : ''}${it.kind === 'approval' && it.approvalId ? `<button type="button" class="btn btn-ghost btn-sm" data-quick-approve="${esc(it.approvalId)}">승인</button>` : ''}${it.kind === 'shorts_pick' ? '<button type="button" class="btn btn-ghost btn-sm" data-shorts-dismiss="1">이번 후보 건너뛰기</button>' : ''}<button type="button" class="btn ${it.btnGhost ? 'btn-ghost' : 'btn-primary'} btn-sm" ${it.open}>${it.btn}</button></div>
          </div>`;
        })
        .join('')}${items.length > 10 ? `<div class="routine-sub">… 외 ${items.length - 10}건</div>` : ''}</div>
    </div>`;
  wrap.querySelectorAll('details[data-inbox-details]').forEach((d) => { if (keepOpen.has(d.dataset.inboxDetails)) d.open = true; });
  wrap.querySelectorAll('[data-inbox-feedback]').forEach((el) => { const v = keepVals[`f:${el.dataset.inboxFeedback}`]; if (v) el.value = v; });
  wrap.querySelectorAll('[data-inbox-assignee]').forEach((el) => { const v = keepVals[`a:${el.dataset.inboxAssignee}`]; if (v && [...el.options].some((o) => o.value === v)) el.value = v; });
}

/** 바로 지시: 대상 목록(전체 + 진행 중 프로젝트·업무) */
function renderQuickOrderTargets() {
  const sel = document.getElementById('quick-order-target');
  if (!sel) return;
  const prev = sel.value;
  const active = state.missions.filter((m) => m.status !== 'completed' && !m.isRoutineHub);
  const proj = active.filter((m) => m.mode === 'project');
  const one = active.filter((m) => m.mode !== 'project');
  sel.innerHTML = [
    '<option value="">전체 시스템 (회사 공통 · 개입)</option>',
    proj.length ? `<optgroup label="프로젝트">${proj.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</optgroup>` : '',
    one.length ? `<optgroup label="일반 업무">${one.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</optgroup>` : ''
  ].join('');
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderHomeView() {
  renderCeoInbox();
  renderQuickOrderTargets();
  const msnWrap = document.getElementById('home-missions-list');
  const chatTeaser = document.getElementById('home-chat-teaser');
  if (!msnWrap) return;

  const active = (state.missions || []).filter((m) => m.status !== 'completed' && !m.isRoutineHub);
  const proj = active.filter((m) => m.mode === 'project');
  const one = active.filter((m) => m.mode !== 'project');

  const renderHomeMissionRow = (m) => {
    const tasks = state.tasks.filter((t) => t.missionId === m.id);
    const done = tasks.filter((t) => t.status === 'completed').length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const kindBadge =
      m.mode === 'project'
        ? `<span class="badge badge-blue">프로젝트${msProgress(m) ? ` ${msProgress(m)}` : ''}</span>`
        : '<span class="badge badge-neutral">일반 업무</span>';
    return `<div class="home-item">
      <div class="home-item-top">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
          ${kindBadge}
          <div class="home-item-title">${esc(m.title)}</div>
        </div>
        <span class="mono" style="color:var(--ink-muted);white-space:nowrap;">${done}/${tasks.length} · ${pct}%</span>
      </div>
      <div class="progress-track thin"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="home-item-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-open-mission-board="${esc(m.id)}">열기</button>
        <button type="button" class="btn btn-ghost btn-sm" data-jump-view="office">회의실</button>
      </div>
    </div>`;
  };

  if (active.length === 0) {
    msnWrap.innerHTML = '<div class="empty-state">진행 중인 프로젝트·업무 없음</div>';
  } else {
    const sections = [];
    if (proj.length) {
      sections.push(
        `<div class="routine-sub" style="font-weight:600;margin:2px 0 4px;">프로젝트 (${proj.length}건)</div>` +
          proj.map(renderHomeMissionRow).join('')
      );
    }
    if (one.length) {
      const shownOne = one.slice(0, 5);
      const moreBtn =
        one.length > shownOne.length
          ? `<div style="margin-top:6px;"><button type="button" class="btn btn-ghost btn-sm" data-jump-view="missions">일반 업무 ${one.length}건 전체 보기</button></div>`
          : '';
      sections.push(
        `<div class="routine-sub" style="font-weight:600;margin:${proj.length ? '12px' : '2px'} 0 4px;">일반 업무 (${one.length}건)</div>` +
          shownOne.map(renderHomeMissionRow).join('') +
          moreBtn
      );
    }
    msnWrap.innerHTML = sections.join('');
  }

  if (chatTeaser) {
    const lastMsg = (state.messages || [])[state.messages.length - 1];
    chatTeaser.innerHTML = lastMsg
      ? `<button type="button" class="home-chat-card" data-jump-view="office">
          <div style="min-width:0;">
            <div style="font-size:11.5px;color:var(--ink-muted);"><strong>${esc(lastMsg.senderName)}</strong> · 회의실</div>
            <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(lastMsg.text)}</div>
          </div>
          <i data-lucide="chevron-right" class="icon-xs"></i>
        </button>`
      : '';
  }
}

function renderCommandView() {
  const tabsBar = document.getElementById('mission-tabs-bar');
  const allMissions = state.missions || [];
  const isProjectsMenu = currentView === 'projects' || missionKindFilter === 'project';
  const visibleMissions = isProjectsMenu
    ? allMissions.filter((m) => m.mode === 'project')
    : allMissions.filter((m) => m.mode !== 'project');

  if (visibleMissions.length === 0) {
    tabsBar.innerHTML = '';
    const emptyMsg = isProjectsMenu
      ? '진행 중인 프로젝트가 없습니다. 홈에서 "프로젝트"를 선택해 지시하거나 일반 업무에서 "프로젝트 전환"을 눌러보세요.'
      : '진행 중인 일반 업무가 없습니다. 홈에서 새 지시를 내려보세요.';
    document.getElementById('active-mission-container').innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
  } else {
    if (!visibleMissions.some((m) => m.id === selectedMissionId)) {
      selectedMissionId = visibleMissions[0].id;
    }
    tabsBar.innerHTML = visibleMissions
      .map((m) => {
        const tasks = state.tasks.filter((t) => t.missionId === m.id);
        const done = tasks.filter((t) => t.status === 'completed').length;
        const active = m.id === selectedMissionId ? 'active' : '';
        const prefix = m.mode === 'project' && msProgress(m) ? `<span class="badge badge-blue" style="padding:1px 6px;font-size:10.5px;">${msProgress(m)}</span>` : '';
        return `<button class="mission-tab ${active}" data-select-mission="${esc(m.id)}" title="${esc(m.title)}">
          ${prefix}
          <span class="mission-tab-title">${esc(m.title)}</span>
          <span class="mono">${done}/${tasks.length}</span>
        </button>`;
      })
      .join('');

    const mission = visibleMissions.find((m) => m.id === selectedMissionId) || visibleMissions[0];
    renderActiveMission(mission);
  }

  // Activity Log
  const logList = document.getElementById('activity-list');
  logList.innerHTML = state.logs
    .slice(0, 28)
    .map(
      (log) => `<li class="activity-item level-${esc(log.level || 'info')}">
        <div class="activity-head">
          <span class="activity-actor">${esc(log.actor)}</span>
          <span class="activity-time">${esc(formatTime(log.timestamp))}</span>
        </div>
        <div class="activity-msg">${esc(log.message)}</div>
      </li>`
    )
    .join('');
}

function renderActiveMission(mission) {
  const container = document.getElementById('active-mission-container');
  const tasks = state.tasks.filter((t) => t.missionId === mission.id);
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const runnableCount = tasks.filter((t) => t.status === 'queued' || t.status === 'awaiting_bridge').length;
  const pct = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const lead = getAgent(mission.leadAgentId);
  const isProject = mission.mode === 'project';
  const pendingGate = state.approvals.find((a) => a.missionId === mission.id && a.kind === 'stage_gate' && a.status === 'pending');
  const currentStage = mission.plan?.milestones?.find((m) => m.status !== 'done');
  const openStatuses = new Set(['queued', 'running', 'awaiting_bridge', 'awaiting_approval']);
  const busyAgentIds = new Set(tasks.filter((t) => openStatuses.has(t.status)).map((t) => t.assigneeId));
  const idleCount = state.agents.filter((a) => a.active && a.tier !== 'lead' && !busyAgentIds.has(a.id)).length;

  const ghHasToken = Boolean(state.settings?.providers?.githubRepo?.hasApiKey);
  const linkedRepo = mission.githubRepo || (mission.domain === 'it_ops' ? state.settings?.providers?.githubRepo?.repo || 'alpinu83/ai-ceo-hub' : '');
  const linkedSite = mission.siteUrl || '';

  const missionHeader = `
    <div class="sheet mission-header-sheet">
      <div class="sheet-header compact">
        <div style="min-width:0;">
          <div class="mission-meta-row">
            ${
              isProject
                ? `<span class="badge badge-blue">프로젝트${currentStage ? ` · ${esc(currentStage.title.slice(0, 24))}` : ''}</span>`
                : `<span class="badge badge-neutral">${esc(DOMAIN_LABELS[mission.domain] || mission.domain)}</span>`
            }
            <span class="badge badge-green">${esc(displayAgentName(mission.leadAgentId || 'agent_gemini_neon'))}</span>
            ${
              linkedRepo
                ? `<span class="badge ${ghHasToken ? 'badge-green' : 'badge-amber'}" title="${ghHasToken ? '팀이 결정한 내용을 IT팀이 실제 코드(PR)로 만들어 결재에 올리고, 승인하면 바로 머지·배포합니다' : '실제 소스 읽기 가능 · 설정에서 IT팀 GitHub 토큰 등록 시 결재 승인 = 실코드 배포 활성화'}">GitHub: ${esc(linkedRepo)} · ${ghHasToken ? '승인 시 자동 배포' : '읽기 전용'}</span>`
                : ''
            }
            ${
              linkedSite
                ? `<a class="badge badge-neutral" href="${esc(linkedSite)}" target="_blank" rel="noreferrer" style="text-decoration:none;">${esc(linkedSite.replace(/^https?:\/\//, ''))} ↗</a>`
                : ''
            }
          </div>
          <div class="sheet-title-row">
            <h2 class="sheet-title">${esc(mission.title)}</h2>
            <button type="button" class="btn-inline-edit" id="btn-rename-mission" data-mission-id="${esc(mission.id)}" title="이름 수정">이름 수정</button>
            <button type="button" class="btn-inline-edit" id="btn-bind-mission-repo" data-mission-id="${esc(mission.id)}" title="GitHub 저장소 · 라이브 사이트 연결">연동 설정</button>
            <button type="button" class="btn-inline-edit" id="btn-mission-scope" data-mission-id="${esc(mission.id)}" title="이 업무가 집중할 일과 하지 말 일">${mission.scope?.exclude?.length || mission.scope?.focus ? '업무 범위 ✓' : '업무 범위'}</button>
            <button type="button" class="btn-inline-edit" id="btn-mission-goal" data-mission-id="${esc(mission.id)}" title="숫자 목표: 팀장의 모든 판단 기준">${mission.goal?.metric && mission.goal?.target !== null && mission.goal?.target !== undefined ? '목표 ✓' : '목표 설정'}</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${
            pendingGate
              ? `<button type="button" class="btn btn-amber btn-sm" data-jump-view="approvals">관문 결재 대기</button>`
              : isProject
                ? `<button type="button" class="btn btn-primary btn-sm" id="btn-ops-cycle" data-mission-id="${esc(mission.id)}">팀장 운영 사이클 실행</button>`
                : ''
          }
          ${
            isProject && currentStage
              ? `<button type="button" class="btn btn-amber btn-sm" data-advance-milestone="${esc(currentStage.id)}" data-mission-id="${esc(mission.id)}" title="현재 단계를 완료 처리하고 바로 다음 단계로 넘깁니다">다음 단계로 →</button>`
              : ''
          }
          ${
            idleCount > 0
              ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-deploy-idle" data-mission-id="${esc(mission.id)}">대기 팀원 투입 (${idleCount})</button>`
              : ''
          }
          ${
            runnableCount > 0
              ? `<button type="button" class="btn ${isProject ? 'btn-ghost' : 'btn-primary'} btn-sm" id="btn-run-all-mission" data-mission-id="${esc(mission.id)}">
                  <i data-lucide="play" class="icon-xs"></i>
                  <span>팀장 일괄 추진 (${runnableCount})</span>
                </button>`
              : ''
          }
          <button type="button" class="btn btn-ghost btn-sm" id="btn-toggle-project-mode" data-mission-id="${esc(mission.id)}" data-next-mode="${isProject ? 'one_off' : 'project'}">
            ${isProject ? '일반 업무 전환' : '프로젝트 전환'}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-open-office-mission">
            <i data-lucide="messages-square" class="icon-xs"></i>
            <span>회의실</span>
          </button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-delete-mission" data-mission-id="${esc(mission.id)}">
            삭제
          </button>
        </div>
      </div>

      <div class="mission-directive-quote"><strong>지시:</strong> ${esc(mission.directive)}</div>
      ${missionGoalHtml(mission)}
      ${missionPlanHtml(mission)}
      ${shortsPanelHtml(mission)}

      <div class="progress-row">
        <span class="mono">진척도 ${pct}% (${completed}/${tasks.length} 완료)</span>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    </div>
  `;

  const bodyHtml =
    missionViewMode === 'report'
      ? renderMissionReportAndFlow(mission, lead, tasks)
      : renderUnifiedTasksView(tasks, mission);

  container.innerHTML = `${missionHeader}${bodyHtml}`;
}

function formatMentions(text = '') {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\n)- \[ \] /g, '$1☐ ')
    .replace(/(^|\n)- \[[xX]\] /g, '$1☑ ')
    .replace(/(@[^\s,!?<]+)/g, '<span class="mention-tag">$1</span>');
}

function renderOfficeView() {
  const leadWrap = document.getElementById('office-lead-desks');
  const workerWrap = document.getElementById('office-worker-desks');
  const feedEl = document.getElementById('lounge-feed');
  const channelBar = document.getElementById('office-channel-bar');
  const titleEl = document.getElementById('lounge-channel-title');
  if (!leadWrap || !workerWrap || !feedEl) return;

  // Validate officeMissionFilter against current missions
  if (officeMissionFilter !== 'all' && !state.missions.some((m) => m.id === officeMissionFilter)) {
    officeMissionFilter = state.missions[0]?.id || 'all';
  }

  const allMessages = state.messages || [];
  const activeMission =
    officeMissionFilter === 'all'
      ? null
      : state.missions.find((m) => m.id === officeMissionFilter) || null;
  const missionTasks = activeMission
    ? state.tasks.filter((t) => t.missionId === activeMission.id)
    : state.tasks;

  if (titleEl) {
    titleEl.textContent = activeMission ? activeMission.title : '전체 회의실';
  }

  if (channelBar) {
    const pills = [
      `<button type="button" class="channel-pill ${officeMissionFilter === 'all' ? 'active' : ''}" data-office-channel="all">전체 <span class="mono">${allMessages.length}</span></button>`,
      ...state.missions.map((m) => {
        const cnt = allMessages.filter((msg) => msg.missionId === m.id).length;
        const shortTitle = m.title.length > 18 ? `${m.title.slice(0, 18)}…` : m.title;
        return `<button type="button" class="channel-pill ${officeMissionFilter === m.id ? 'active' : ''}" data-office-channel="${esc(m.id)}">${esc(shortTitle)} <span class="mono">${cnt}</span></button>`;
      })
    ];
    channelBar.innerHTML = pills.join('');
  }

  const messages =
    officeMissionFilter === 'all'
      ? allMessages
      : allMessages.filter((m) => m.missionId === officeMissionFilter);

  const leadDeskOn = state.settings?.leadDesk?.enabled !== false;
  const workers = state.agents.filter((a) => a.tier !== 'lead' && a.active);
  const partCount = document.getElementById('office-participant-count');
  if (partCount) {
    partCount.textContent = String(leadDeskOn ? workers.length + 1 : state.agents.filter((a) => a.active).length);
  }

  const renderDesk = (ag) => {
    const myTasks = missionTasks.filter((t) => t.assigneeId === ag.id);
    const hasApproval = myTasks.some((t) => t.status === 'awaiting_approval');
    const isRunning = myTasks.some((t) => t.status === 'running');
    const isSpeaking = activeSpeakerId === ag.id;

    let statusLabel = ag.tier === 'lead' ? leadDutyLabel() : '대기';
    if (!ag.active) statusLabel = '휴직';
    else if (isSpeaking) statusLabel = '발언 중';
    else if (isRunning) statusLabel = '작업 중';
    else if (hasApproval) statusLabel = '결재';
    else if (myTasks.some((t) => t.status === 'completed')) statusLabel = '완료';
    else if (myTasks.length > 0) statusLabel = '배정';
    if (ag.active && ag.tier === 'lead' && !isSpeaking) statusLabel = leadDutyLabel(); // 팀장 카드는 지금 근무 중인 팀장 표시

    const cls = `desk-card${isSpeaking ? ' speaking' : ''}${hasApproval && !isSpeaking ? ' waiting-approval' : ''}`;
    return `<button type="button" class="${cls}" data-mention-desk="${esc(ag.name)}">
      <div class="desk-head">
        <div class="desk-person">
          <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
          <div style="min-width:0;">
            <div class="desk-name">${esc(ag.name)}</div>
          </div>
        </div>
        <span class="desk-status">${esc(statusLabel)}</span>
      </div>
    </button>`;
  };

  if (leadDeskOn) {
    const agyAt = state?.agentConnections?.['lead:agy_lead']?.lastSeenAt;
    const agyOn = agyAt && Date.now() - Date.parse(agyAt) < 3 * 60 * 1000;
    const isLeadSpeaking = activeSpeakerId === 'agent_gemini_neon';
    leadWrap.innerHTML = `<button type="button" class="desk-card${isLeadSpeaking ? ' speaking' : ''}" data-mention-desk="총괄 팀장">
      <div class="desk-head">
        <div class="desk-person">
          <span class="agent-avatar sm" style="background:${agyOn ? '#0E6245' : '#2563EB'}">${agyOn ? 'AG' : '팀장'}</span>
          <div style="min-width:0;">
            <div class="desk-name">${agyOn ? '총괄 팀장 · AGY (Hydrogen)' : '총괄 팀장 · Gemini 앱'}</div>
          </div>
        </div>
        <span class="desk-status">${isLeadSpeaking ? '발언 중' : agyOn ? '주간 근무' : '야간 당직'}</span>
      </div>
    </button>`;
  } else {
    // 팀장 업무함이 꺼져 있을 때만 기존 API 팀장 카드 표시
    const leads = state.agents.filter((a) => a.tier === 'lead' && a.active);
    leadWrap.innerHTML = leads.map(renderDesk).join('');
  }
  workerWrap.innerHTML = workers.map(renderDesk).join('');

  // Render filtered channel feed
  const typeBadges = {
    directive: { label: 'CEO 지시', cls: 'badge-neutral' },
    plan: { label: '팀장 분배', cls: 'badge-green' },
    handoff: { label: '전달', cls: 'badge-blue' },
    approval: { label: '결재 상신', cls: 'badge-amber' },
    work: { label: '보고', cls: 'badge-neutral' },
    ceo_chat: { label: 'CEO', cls: 'badge-neutral' },
    reply: { label: '응답', cls: 'badge-green' }
  };

  const missionTitleMap = Object.fromEntries(state.missions.map((m) => [m.id, m.title]));

  feedEl.innerHTML =
    messages.length === 0
      ? '<div class="empty-state">이 채널에 아직 대화가 없습니다. 메시지를 보내면 팀장이 대응합니다.</div>'
      : messages
          .map((m) => {
            const isCeo = m.senderId === 'ceo';
            const senderAgent = !isCeo ? getAgent(m.senderId) : null;
            const isLead =
              !isCeo &&
              (m.senderId === 'agent_gemini_neon' ||
                m.senderId === 'agy_lead' ||
                m.senderId === 'gemini_app' ||
                senderAgent?.tier === 'lead' ||
                /^총괄\s*팀장/.test(String(m.senderName || '')) ||
                /총괄\s*팀장/.test(String(m.senderRole || '')));
            const tb = typeBadges[m.type] || { label: '대화', cls: 'badge-neutral' };
            const mTag =
              officeMissionFilter === 'all' && m.missionId && missionTitleMap[m.missionId]
                ? `<span class="badge badge-neutral">${esc(missionTitleMap[m.missionId].slice(0, 14))}</span>`
                : '';
            return `<div class="chat-msg ${isCeo ? 'from-ceo' : isLead ? 'from-lead' : ''} ${m.type === 'approval' ? 'msg-approval' : ''}">
              <span class="agent-avatar" style="background:${esc(m.senderAccent || '#0E6245')}">${esc(m.senderShortCode || 'AI')}</span>
              <div class="chat-body">
                <div class="chat-meta">
                  <span class="chat-sender">${esc(m.senderName)}</span>
                  ${isLead ? '<span class="chat-lead-tag">팀장</span>' : ''}
                  <span class="badge ${tb.cls}">${esc(tb.label)}</span>
                  ${mTag}
                  <span class="mono">${esc(formatTime(m.timestamp))}</span>
                </div>
                <div class="chat-bubble">${formatMentions(m.text)}</div>
              </div>
            </div>`;
          })
          .join('');

  feedEl.scrollTop = feedEl.scrollHeight;
}

async function playLiveMessages(baseMessages, newTurns, finalState) {
  isPlayingLiveSession = true;
  const typingBanner = document.getElementById('lounge-typing-banner');
  const typingText = document.getElementById('lounge-typing-text');

  // Show messages progressively one by one so CEO watches each employee speak & hand off live
  state.messages = [...baseMessages];
  renderOfficeView();
  refreshIcons();

  for (const turn of newTurns) {
    activeSpeakerId = turn.senderId;
    const targetAg =
      turn.targetAgentId === 'ceo'
        ? { name: `${state.settings.ceoName || '대표님'} (CEO)` }
        : getAgent(turn.targetAgentId);
    liveHandoffLabel = targetAg
      ? `${turn.senderName}  ── ${turn.statusText || '협업 중'} ──▶  ${targetAg.name}`
      : `${turn.senderName} 님이 발언을 준비하고 있습니다…`;

    if (typingBanner && typingText) {
      typingBanner.classList.add('active');
      typingText.textContent = `${turn.senderName} (${turn.senderRole || 'AI 직원'}) 님이 입력 중…`;
    }
    renderOfficeView();
    refreshIcons();

    await new Promise((r) => setTimeout(r, 850));

    state.messages.push(turn);
    renderOfficeView();
    refreshIcons();
  }

  if (typingBanner) typingBanner.classList.remove('active');
  activeSpeakerId = null;
  liveHandoffLabel = '';
  isPlayingLiveSession = false;
  state = finalState;
  renderAll();
}

function renderUnifiedTasksView(tasks, mission = null) {
  const isProject = mission?.mode === 'project';
  const filters = [
    { key: 'all', label: '전체', match: () => true },
    { key: 'active', label: '추진 중', match: (t) => t.status === 'queued' || t.status === 'running' },
    { key: 'external', label: '외부 봇', match: (t) => t.status === 'awaiting_bridge' },
    { key: 'approval', label: 'CEO 결재', match: (t) => t.status === 'awaiting_approval' },
    { key: 'done', label: '완료', match: (t) => t.status === 'completed' || t.status === 'rejected' }
  ];

  const activeFilterObj = filters.find((f) => f.key === missionStatusFilter) || filters[0];
  const filtered = tasks.filter(activeFilterObj.match);

  const finishedCount = tasks.filter((t) => t.status === 'completed' || t.status === 'rejected').length;
  const filterBar = `<div class="task-filter-bar" role="tablist" aria-label="업무 상태 필터">
    ${filters
      .map((f) => {
        const count = tasks.filter(f.match).length;
        if (f.key !== 'all' && count === 0 && missionStatusFilter !== f.key) return '';
        return `<button type="button" class="filter-chip ${missionStatusFilter === f.key ? 'active' : ''}" data-task-filter="${f.key}">
          <span>${f.label}</span>
          <span class="mono">${count}</span>
        </button>`;
      })
      .join('')}
    ${
      finishedCount > 0
        ? `<button type="button" class="filter-chip" id="btn-clear-completed-tasks" data-mission-id="${esc(mission.id)}" style="margin-left:auto;color:var(--accent-danger);">종료 업무 일괄 삭제 (${finishedCount})</button>`
        : ''
    }
  </div>`;

  const agentOptions = state.agents
    .filter((a) => a.active && a.tier !== 'lead')
    .map((a) => ({ id: a.id, label: a.name }));

  if (filtered.length === 0) {
    return `${filterBar}<div class="empty-state">해당 상태의 업무가 없습니다.</div>`;
  }

  const cards = filtered
    .map((t) => {
      const ag = getAgent(t.assigneeId) || state.agents[0];
      const isLeadTask = t.assigneeId === 'agent_gemini_neon' || ag?.tier === 'lead';
      const st = STATUS_META[t.status] || { label: t.status, cls: 'badge-neutral' };
      const isFinished = t.status === 'completed' || t.status === 'rejected';
      const hasCurrentOpt = agentOptions.some((opt) => opt.id === t.assigneeId);
      const optsForTask = hasCurrentOpt || isLeadTask
        ? agentOptions
        : [{ id: t.assigneeId, label: `${displayAgentName(t.assigneeId, t)}${ag?.active === false ? ' (휴직)' : ''}` }, ...agentOptions];
      const selectOpts = optsForTask
        .map(
          (opt) =>
            `<option value="${esc(opt.id)}" ${opt.id === t.assigneeId ? 'selected' : ''}>${esc(opt.label)}</option>`
        )
        .join('');

      return `<article class="task-row-card">
        <div class="task-top">
          <div style="flex:1;min-width:0;">
            <h3 class="task-title">${esc(t.title)}</h3>
            <p class="task-desc">${esc(t.description)}</p>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:flex-start;">
            ${isProject && t.milestoneId ? `<span class="badge badge-neutral">${esc(milestoneLabel(t))}</span>` : ''}
            ${t.requiresApproval && t.status !== 'awaiting_approval' ? '<span class="badge badge-amber">CEO 결재</span>' : ''}
            <span class="badge ${st.cls}">${esc(st.label)}</span>
          </div>
        </div>

        <div class="task-footer">
          <div class="assignee-pill">
            <span class="agent-avatar sm" style="background:${esc(isLeadTask ? '#0E6245' : ag.accent)}">${esc(isLeadTask ? 'AG' : ag.shortCode)}</span>
            ${
              isLeadTask
                ? `<span style="font-size:12.5px;font-weight:600;color:var(--accent-primary);">${esc(activeLeadDisplayName())}</span>`
                : `<select class="assignee-select" data-reassign-task="${esc(t.id)}" aria-label="담당 AI 변경">${selectOpts}</select>`
            }
          </div>

          <div class="task-controls">
            <button type="button" class="btn btn-ghost btn-sm" data-open-drawer="${esc(t.id)}">${t.output ? '결과 보기' : '상세'}</button>
            ${
              t.status === 'awaiting_approval'
                ? `<button type="button" class="btn btn-amber btn-sm" data-jump-approval="${esc(t.id)}">결재하기</button>`
                : ''
            }
            ${
              isFinished
                ? `<button type="button" class="btn btn-ghost btn-sm" data-delete-task="${esc(t.id)}" style="color:var(--accent-danger);">삭제</button>`
                : ''
            }
          </div>
        </div>
      </article>`;
    })
    .join('');

  return `${filterBar}<div class="task-stack">${cards}</div>`;
}

function renderMissionReportAndFlow(mission, lead, tasks) {
  const approvalTasks = tasks.filter((t) => t.requiresApproval || t.status === 'awaiting_approval');
  const pendingApprovalCount = approvalTasks.filter((t) => t.status === 'awaiting_approval').length;

  const pillHtml = tasks
    .map((t) => {
      const ag = getAgent(t.assigneeId) || state.agents[0];
      const st = STATUS_META[t.status] || { label: t.status };
      return `<button type="button" class="flow-pill" data-open-drawer="${esc(t.id)}">
        <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
        <span class="flow-pill-body">
          <span class="flow-pill-agent">
            <span class="flow-dot ${esc(t.status)}"></span>
            <span>${esc(ag.name)}</span>
            <span style="font-weight:500;color:var(--ink-muted);">· ${esc(st.label)}</span>
          </span>
          <span class="flow-pill-task">${esc(t.title)}</span>
        </span>
      </button>`;
    })
    .join('');

  const flowHtml = `<div class="flow-pipeline">
    <div class="flow-step">
      <div class="flow-step-head">
        <span class="flow-step-kicker">STEP 1 · 지시 &amp; 총괄</span>
        <span class="badge badge-green">팀장 전결 자동 추진</span>
      </div>
      <div class="flow-step-title">${esc(state.settings.ceoName || '대표님')} (CEO) → ${esc(lead?.name || 'Gemini 4 Hydrogen')} (총괄 팀장)</div>
    </div>

    <div class="flow-arrow">↓</div>

    <div class="flow-step">
      <div class="flow-step-head">
        <span class="flow-step-kicker">STEP 2 · 팀장 분배 &amp; 실무 (${tasks.length}건)</span>
        <span class="form-hint" style="margin:0;">항목 클릭 시 결과 확인</span>
      </div>
      <div class="flow-pill-grid">${pillHtml}</div>
    </div>

    <div class="flow-arrow">↓</div>

    <div class="flow-step">
      <div class="flow-step-head">
        <span class="flow-step-kicker">STEP 3 · CEO 최종 결재 게이트</span>
        ${
          pendingApprovalCount > 0
            ? `<button type="button" class="btn btn-amber btn-sm" data-jump-view="approvals">결재함 이동 (${pendingApprovalCount})</button>`
            : '<span class="badge badge-neutral">결재 대기 없음</span>'
        }
      </div>
      <div class="flow-step-title">
        ${
          mission.mode === 'project'
            ? '지속 프로젝트 — 팀장이 작전 계획대로 추진하고, 관문(대표님 결정)에서만 결재함에 상신'
            : approvalTasks.length > 0
              ? `중대 의사결정 ${approvalTasks.length}건만 총괄 팀장 검토 후 CEO 결재함 상신`
              : '전 항목 일반 실무 — 총괄 팀장 전결 자동 처리'
        }
      </div>
    </div>
  </div>`;

  const reportHtml = mission.finalReport
    ? `<div class="sheet final-report-sheet">
        <div class="sheet-header compact">
          <h3 class="sheet-title">총괄 팀장 최종 임원 보고서</h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-synthesize-report" data-mission-id="${esc(mission.id)}">갱신</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-copy-final-report">복사</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-download-final-report">.md</button>
          </div>
        </div>
        <div class="markdown-body">${renderMarkdown(mission.finalReport)}</div>
      </div>`
    : `<div class="sheet final-report-sheet">
        <div class="sheet-header compact">
          <h3 class="sheet-title">총괄 팀장 최종 임원 보고서</h3>
          <button type="button" class="btn btn-primary btn-sm" id="btn-synthesize-report" data-mission-id="${esc(mission.id)}">보고서 생성</button>
        </div>
        <p class="form-hint" style="margin:0;">내부 업무가 끝나면 자동 생성되며, 위 버튼으로 바로 취합할 수도 있습니다.</p>
      </div>`;

  const historyHtml =
    Array.isArray(mission.phaseHistory) && mission.phaseHistory.length > 0
      ? `<div class="sheet final-report-sheet">
          <h3 class="sheet-title" style="margin-bottom:10px;">이전 단계 보고서 이력</h3>
          ${mission.phaseHistory
            .map(
              (h) => `<details style="margin-bottom:8px;">
                <summary style="cursor:pointer;font-weight:700;font-size:13.5px;">이전 방식 ${h.phase}단계 완료 보고 (${esc(formatTime(h.completedAt))})</summary>
                <div class="markdown-body" style="margin-top:8px;">${renderMarkdown(h.report || '')}</div>
              </details>`
            )
            .join('')}
        </div>`
      : '';

  return `${flowHtml}${reportHtml}${historyHtml}`;
}

const CODE_STATUS_LABELS = {
  waiting_team: ['badge-amber', '팀 작업 마무리 대기', '팀원들이 작업을 마치면 IT팀이 결정사항을 실제 코드(PR)로 만들어 이 카드에 붙입니다. 지금 승인해도 준비되는 즉시 반영됩니다.'],
  preparing: ['badge-amber', '실코드 변경안 작성 중', 'IT팀이 실제 저장소 코드를 읽고 변경안과 보안 감사를 진행하고 있습니다.'],
  ready: ['badge-green', '승인 시 자동 머지 → 라이브 배포', '아래 diff가 승인 즉시 main에 머지되고 배포됩니다. 별도 지시는 필요 없습니다.'],
  none: ['badge-neutral', '코드 변경 불필요', 'IT팀 검토 결과 이 건은 저장소 코드를 바꿀 내용이 없습니다.'],
  unavailable: ['badge-neutral', '저장소 미연동', 'GitHub 토큰 또는 저장소 연동이 없어 코드 반영을 하지 않습니다.'],
  failed: ['badge-amber', '변경안 사전 작성 실패', '승인하면 IT팀이 다시 작성하고, 보안 감사를 통과하면 바로 머지·배포합니다.'],
  merging: ['badge-blue', 'main 머지 진행 중', 'CI 확인 후 main에 머지하고 있습니다.'],
  merged: ['badge-green', '머지 완료 · 배포 중', '배포 워크플로 결과를 확인하고 있습니다.'],
  deployed: ['badge-green', '라이브 배포 완료', '배포 워크플로 성공을 확인했습니다.'],
  deploy_failed: ['badge-red', '배포 실패', '머지는 됐지만 배포 워크플로가 실패했습니다. GitHub Actions 로그를 확인해 주세요.'],
  deploy_unknown: ['badge-neutral', '머지 완료 · 배포 확인 불가', '배포 결과를 자동으로 확인하지 못했습니다.'],
  ci_failed: ['badge-red', 'CI 실패 · 머지 보류', '자동 테스트가 실패해 라이브는 바뀌지 않았습니다. PR은 열려 있습니다.'],
  merge_failed: ['badge-red', '자동 머지 실패', '오류 내용을 확인해 주세요.'],
  needs_review: ['badge-amber', '보안 재확인 필요', '보안 감사 주의 판정으로 자동 머지를 멈추고 재확인 결재를 올렸습니다.'],
  closed: ['badge-neutral', 'PR 닫힘', '반려로 코드 변경을 취소했습니다.'],
  revision: ['badge-neutral', '수정 지시됨', '수정 지시를 반영해 새 변경안을 다시 올립니다.']
};

function renderCodeChangeStatus(apr) {
  const cc = apr?.codeChange;
  if (!cc?.status) return '';
  const [cls, label, desc] = CODE_STATUS_LABELS[cc.status] || ['badge-neutral', cc.status, ''];
  const showError = ['failed', 'ci_failed', 'merge_failed', 'deploy_failed', 'needs_review'].includes(cc.status);
  const detail = (showError ? cc.error : '') || cc.note || '';
  const sha = cc.mergeSha ? ` · 커밋 ${String(cc.mergeSha).slice(0, 7)}` : '';
  return `<div class="memo-section">
      <h4>실코드 반영 상태</h4>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
        <span class="badge ${cls}">${esc(label)}</span>
        ${apr.repo ? `<span class="mono" style="color:var(--ink-muted);">${esc(apr.repo)}${esc(sha)}</span>` : ''}
      </div>
      <p style="margin:0;font-size:13px;color:var(--ink-secondary);">${esc(desc)}${detail ? `<br><span class="mono">${esc(detail)}</span>` : ''}</p>
    </div>`;
}

function isCodeApprovalClient(apr) {
  return Boolean(apr && (apr.kind === 'it_pr_merge' || apr.prNumber || apr.codeChange?.status));
}

// ---- 결재함 대표님 체크리스트 정제 (서버 src/lead-engine.js refineChecklistItems 규칙과 동일)
// 저장된 옛 apr.checklist에 섞인 완료([x])·'해당 없음'·표 헤더·개발 기술 검수 항목을 화면에서 다시 걸러 핵심 최대 5건만 보여 줍니다.
const CEO_CK_MAX = 5;
const CEO_CK_DONE_RE = /^(?:[-*•]\s*)?(?:\[[xX]\]|☑️?|✅|✔️?)\s*(.+)$/;
const CEO_CK_NA_RE = /(해당\s*(?:사항\s*)?없음|미해당|(?:^|[:：—–-]\s*)없음\s*[.)]?$|(?:^|[\s(:：—–-])N\s*\/\s*A(?:$|[\s).,])|^N\/?A$)/i;
const CEO_CK_HEAD_CELL_RE = /^(?:검수\s*)?(?:영역|구분|항목|분류|카테고리|단계|번호|체크\s*항목|확인\s*항목|no\.?|#)$/i;
const CEO_CK_TECH_RE = /(\b(?:CSR|SSG|SSR|eval|WebView|iframe|bridge|CSP|XSS|CORS|innerHTML)\b|웹뷰|아이프레임|브릿지|네비게이션\s*바|내비게이션\s*바|스킴|URL\s*scheme|식별키)/i;
const CEO_CK_KEEP_RE = /\[\s*대표님|대표님\s*(?:확인|승인|선택|결정)/;
const CEO_CK_PRIORITY_RE = /(\[\s*대표님|승인|선택|결정|로그인|콘솔|약관|결제|등록|개설|발송|계정)/;
const ceoCkKey = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

function isCeoChecklistNoise(item) {
  const s = String(item || '').replace(/\s+/g, ' ').trim();
  if (!s) return true;
  if (CEO_CK_DONE_RE.test(s) || CEO_CK_NA_RE.test(s)) return true;
  if (s.includes('—') && CEO_CK_HEAD_CELL_RE.test(s.split(/\s+[—–]\s+/)[0].trim())) return true;
  if (/필수\s*준수\s*항목\s*요약/.test(s)) return true;
  return CEO_CK_TECH_RE.test(s) && !CEO_CK_KEEP_RE.test(s);
}

function approvalChecklistForView(apr) {
  const items = Array.isArray(apr?.checklist) ? apr.checklist : [];
  if (!items.length) return [];
  // 연결된 산출물 원문에서 이미 완료 표시된 항목 키 모음
  const doneKeys = new Set();
  const ids = new Set([apr.taskId, ...(Array.isArray(apr.taskIds) ? apr.taskIds : [])].filter(Boolean));
  for (const id of ids) {
    const t = (state.tasks || []).find((x) => x.id === id);
    for (const line of String(t?.output || '').split('\n')) {
      const m = line.trim().match(CEO_CK_DONE_RE);
      const k = m ? ceoCkKey(m[1].replace(/[*_`]/g, '')) : '';
      if (k.length >= 4) doneKeys.add(k);
    }
  }
  const isDone = (k) => {
    if (doneKeys.has(k)) return true;
    for (const d of doneKeys) if (d.length >= 8 && k.length >= 8 && (d.startsWith(k) || k.startsWith(d))) return true;
    return false;
  };
  const seen = new Set();
  const kept = [];
  for (const raw of items) {
    const s = String(raw || '').trim();
    const k = ceoCkKey(s);
    if (!s || !k || seen.has(k)) continue;
    seen.add(k);
    if (isCeoChecklistNoise(s) || isDone(k)) continue;
    kept.push(s);
  }
  return [...kept.filter((s) => CEO_CK_PRIORITY_RE.test(s)), ...kept.filter((s) => !CEO_CK_PRIORITY_RE.test(s))].slice(0, CEO_CK_MAX);
}

function renderApprovalsView() {
  const pending = state.approvals.filter((a) => a.status === 'pending');
  const decided = state.approvals.filter((a) => a.status !== 'pending');

  document.getElementById('queue-pending-count').textContent = String(pending.length);
  document.getElementById('queue-decided-count').textContent = String(decided.length);

  const renderQueue = (list, isPending) => {
    if (list.length === 0) {
      return `<div class="empty-state" style="padding:18px;">${isPending ? '대기 중인 결재가 없습니다.' : '처리 이력이 없습니다.'}</div>`;
    }
    return list
      .map((a) => {
        const ag = getAgent(a.agentId);
        const msn = state.missions.find((m) => m.id === a.missionId);
        const msnLabel = msn
          ? `${msn.mode === 'project' ? '프로젝트' : '일반 업무'} · ${msn.title}`
          : a.category;
        const sel = a.id === selectedApprovalId ? 'selected' : '';
        return `<button type="button" class="queue-item ${sel} ${isPending ? 'pending-stripe' : ''}" data-select-approval="${esc(a.id)}">
          <div class="queue-item-meta">
            <span class="badge badge-blue" style="max-width:75%;overflow:hidden;text-overflow:ellipsis;">${esc(msnLabel)}</span>
            <span class="mono">${isCodeApprovalClient(a) ? `<span class="badge ${(CODE_STATUS_LABELS[a.codeChange?.status] || ['badge-green'])[0]}">${esc((CODE_STATUS_LABELS[a.codeChange?.status] || ['', '실코드'])[1])}</span>` : a.estimatedCostKRW > 0 ? formatKRW(a.estimatedCostKRW) : '무료'}</span>
          </div>
          <div class="queue-item-title">${esc(cleanInhouseCopy(a.title))}</div>
          <div class="queue-item-meta">
            <span>상신: ${esc(displayAgentName(a.agentId, a))}</span>
            <span>${esc(formatTime(a.createdAt))}</span>
          </div>
        </button>`;
      })
      .join('');
  };

  document.getElementById('pending-approvals-list').innerHTML = renderQueue(pending, true);
  document.getElementById('decided-approvals-list').innerHTML = renderQueue(decided, false);

  const detailPane = document.getElementById('approval-detail-pane');
  const apr = state.approvals.find((a) => a.id === selectedApprovalId);
  if (!apr) {
    detailPane.innerHTML = '<div class="empty-state">좌측에서 결재 안건을 선택하면 상세 결재 상신서가 표시됩니다.</div>';
    return;
  }

  const ag = getAgent(apr.agentId);
  const msn = state.missions.find((m) => m.id === apr.missionId);
  const msnKind = msn?.mode === 'project' ? '프로젝트' : '일반 업무';
  const task = state.tasks.find((t) => t.id === apr.taskId);
  const stampLabels = {
    pending: { text: 'CEO 결재 대기', cls: 'pending' },
    approved: { text: 'CEO 승인 확정', cls: 'approved' },
    revision_requested: { text: '수정 지시됨', cls: 'pending' },
    rejected: { text: '반려됨', cls: 'rejected' }
  };
  const st = stampLabels[apr.status] || { text: apr.status, cls: 'pending' };

  detailPane.innerHTML = `
    <div class="memo-top">
      <div style="min-width:0;">
        <div class="memo-kicker" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
          ${
            msn
              ? `<span class="badge badge-blue">${esc(msnKind)} · ${esc(msn.title)}</span>
                 <button type="button" class="btn-inline-edit" data-open-mission-board="${esc(msn.id)}">원본 열기 →</button>`
              : `<span>${esc(apr.category)}</span>`
          }
        </div>
        <h2 class="memo-title">${esc(cleanInhouseCopy(apr.title))}</h2>
      </div>
      <span class="memo-stamp ${st.cls}">${esc(st.text)}</span>
    </div>

    <div class="memo-facts">
      <div>
        <div class="memo-fact-label">관련 프로젝트 / 업무</div>
        <div class="memo-fact-val">${esc(msn ? msn.title : '단독 안건')}</div>
      </div>
      <div>
        <div class="memo-fact-label">상신 · 검토</div>
        <div class="memo-fact-val">${esc(displayAgentName(apr.agentId, apr))}${apr.workerName && !displayAgentName(apr.agentId, apr).includes(apr.workerName) ? ` (실무: ${esc(apr.workerName)})` : ''}${apr.leadScore != null ? ` · 검수 ${apr.leadScore}/10` : ''}</div>
      </div>
      <div>
        <div class="memo-fact-label">예상 비용 · 유형</div>
        <div class="memo-fact-val mono">${apr.estimatedCostKRW > 0 ? formatKRW(apr.estimatedCostKRW) : '비용 없음'} · ${esc(apr.category)}</div>
      </div>
    </div>

    <div class="memo-section">
      <h4>상신 배경 및 요약</h4>
      <p style="margin:0;font-size:14px;white-space:pre-line;line-height:1.6;">${esc(cleanInhouseCopy(apr.summary))}</p>
    </div>

    ${(() => {
      const leadBrief = String(apr.leadBrief || task?.leadBrief || '').trim();
      if (!leadBrief) return '';
      return `<div class="memo-section lead-brief-panel">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <h4 style="margin:0;color:var(--accent-primary);">🧭 총괄 팀장 재가공 보고서</h4>
            ${apr.leadScore != null ? `<span class="badge badge-green">팀장 검수 ${apr.leadScore}/10</span>` : '<span class="badge badge-green">팀장 검토·재가공 완료</span>'}
          </div>
          <div class="markdown-body">${renderMarkdown(leadBrief)}</div>
        </div>`;
    })()}

    ${(() => {
      // 대표님 핵심 확인 항목만(완료·해당 없음·표 헤더·개발 기술표 제외, 최대 5건). 4건 이상이면 상위 3건만 펼치고 나머지는 접음
      const coreCk = approvalChecklistForView(apr);
      if (!coreCk.length) return '';
      const listStyle = 'margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:13.5px;line-height:1.55;list-style:decimal;';
      const shown = coreCk.length >= 4 ? coreCk.slice(0, 3) : coreCk;
      const folded = coreCk.length >= 4 ? coreCk.slice(3) : [];
      return `<div class="memo-section">
            <h4>📋 대표님 확인 · 실행 체크리스트 <span style="font-weight:500;color:var(--ink-muted);font-size:12.5px;">(핵심 확인·참고용 · ${coreCk.length}건)</span></h4>
            <ol style="${listStyle}">
              ${shown.map((item) => `<li>${esc(item)}</li>`).join('')}
            </ol>
            ${
              folded.length
                ? `<details style="margin-top:6px;">
                    <summary style="cursor:pointer;font-size:12.5px;color:var(--ink-muted);">나머지 ${folded.length}건 더 보기</summary>
                    <ol start="4" style="${listStyle}margin-top:6px;">
                      ${folded.map((item) => `<li>${esc(item)}</li>`).join('')}
                    </ol>
                  </details>`
                : ''
            }
          </div>`;
    })()}

    <div class="memo-section">
      <h4>팀장 권고 · 승인 시 실행될 작업</h4>
      <div class="prompt-box">${esc(cleanInhouseCopy(apr.proposedAction))}</div>
    </div>

    ${renderCodeChangeStatus(apr)}

    ${renderConsultSection(apr)}

    ${
      apr.prUrl
        ? `<div class="memo-section">
            <h4>GitHub Pull Request · 코드 변경 내역</h4>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
              <a class="btn btn-primary btn-sm" href="${esc(apr.prUrl)}" target="_blank" rel="noreferrer">GitHub PR #${Number(apr.prNumber) || ''} 코드 확인 ↗</a>
              ${apr.branchName ? `<span class="mono" style="color:var(--ink-muted);">${esc(apr.branchName)} → main</span>` : ''}
            </div>
            ${apr.diffSummary ? `<pre class="code-block tall">${esc(apr.diffSummary)}</pre>` : ''}
          </div>`
        : ''
    }

    ${(() => {
      const hasLeadBrief = Boolean(String(apr.leadBrief || task?.leadBrief || '').trim());
      const idSet = new Set();
      if (apr.taskId) idSet.add(apr.taskId);
      for (const id of Array.isArray(apr.taskIds) ? apr.taskIds : []) if (id) idSet.add(id);
      if ((apr.kind === 'stage_gate' || apr.kind === 'next_phase') && msn?.deliverables) {
        for (const d of msn.deliverables.slice(0, 6)) if (d?.taskId) idSet.add(d.taskId);
      }
      const attachedTasks = [...idSet]
        .map((id) => state.tasks.find((t) => t.id === id))
        .filter((t) => t && String(t.output || '').trim());
      const hasBundleable =
        attachedTasks.length > 0 ||
        hasLeadBrief ||
        (Array.isArray(apr.checklist) && apr.checklist.length > 0) ||
        Boolean(apr.proposedDirective || apr.prUrl || apr.consult?.document);
      if (!hasBundleable) return '';
      return `<div class="memo-section">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
            <h4 style="margin:0;">📎 ${hasLeadBrief ? '실무 팀원 원문 · 첨부 성과품' : '첨부 성과품 · 시안'} (${attachedTasks.length}건)</h4>
            <button type="button" class="btn btn-ghost btn-sm" data-download-deliverable="${esc(apr.id)}">성과품·체크리스트(.md) 다운로드</button>
          </div>
          ${attachedTasks
            .map((t, idx) => {
              const tAg = state.agents.find((a) => a.id === t.assigneeId);
              return `<details ${idx === 0 && !hasLeadBrief ? 'open' : ''} style="margin-bottom:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);padding:10px 14px;">
                <summary style="cursor:pointer;font-weight:600;font-size:13.5px;">${esc(t.title)} <span style="font-weight:400;color:var(--ink-muted);">(${esc(displayAgentName(t.assigneeId, t))}${hasLeadBrief ? ' · 원문 펼치기' : ''})</span></summary>
                <div class="markdown-body" style="margin-top:10px;">${renderMarkdown(t.output)}</div>
              </details>`;
            })
            .join('')}
        </div>`;
    })()}

    ${
      apr.status === 'pending'
        ? `<div class="memo-decision-box">
            <label class="field">
              <span class="field-label">CEO 결재 메모 또는 수정 지시 (선택)</span>
              <div style="display:flex;gap:6px;align-items:flex-start;">
                <textarea id="memo-ceo-note" rows="2" style="flex:1;" placeholder="예: 룸 좌석 창가로 요청하고 예약 확정 진행해줘 / 예산을 20만원 이내로 다시 찾아줘"></textarea>
                <button type="button" class="icon-btn voice-btn${voiceCtl.active?.targetId === 'memo-ceo-note' ? ' listening' : ''}" data-voice-target="memo-ceo-note" title="음성 입력" aria-label="결재 의견 음성 입력" aria-pressed="false">
                  <i data-lucide="mic" class="icon-sm"></i>
                </button>
              </div>
            </label>
            <div class="memo-decision-actions">
              <button type="button" class="btn btn-primary" data-decide-id="${esc(apr.id)}" data-decision="approved">
                <i data-lucide="check" class="icon-xs"></i>
                <span>승인 확정</span>
              </button>
              <button type="button" class="btn btn-amber" data-decide-id="${esc(apr.id)}" data-decision="revision_requested">
                <i data-lucide="rotate-ccw" class="icon-xs"></i>
                <span>수정 지시 후 재상신</span>
              </button>
              <button type="button" class="btn btn-danger" data-decide-id="${esc(apr.id)}" data-decision="rejected">
                <i data-lucide="x" class="icon-xs"></i>
                <span>반려</span>
              </button>
            </div>
          </div>`
        : `<div class="memo-decision-box">
            <div class="form-hint">결정 시각: ${new Date(apr.decidedAt).toLocaleString('ko-KR')}${apr.ceoNote ? ` · CEO 메모: "${esc(apr.ceoNote)}"` : ''}</div>
          </div>`
    }
  `;
}

/* ==================== OUTSOURCING (외부 협업: Antigravity · Aside · Gemini 앱) ==================== */
const OUT_KIND_LABELS = { task: '실무 작업', code: '코드 수정', consult: '결재 전 검토', browser: '브라우저·계정', research: '심층 리서치' };
const OUT_WORKER_LABELS = { antigravity: 'AGY', aside: 'Aside', gemini: 'Gemini 앱', any: '먼저 잡는 쪽' };
// 서버 WORKER_CAPS와 같음: 작업자별로 할 수 있는 일
const OUT_WORKER_CAPS = { antigravity: ['task', 'code', 'consult', 'browser', 'research'], aside: ['task', 'code', 'consult', 'browser', 'research'], gemini: ['task', 'consult', 'research'] };
const OUT_DEFAULT_PRIORITIES = {
  consult: ['gemini', 'aside', 'antigravity'],
  research: ['gemini', 'aside', 'antigravity'],
  task: ['gemini', 'aside', 'antigravity'],
  browser: ['aside', 'antigravity'],
  code: ['antigravity', 'aside']
};
const OUT_ROLE_LABELS = { time: '시간대 담당 (업무 시간 Aside · 그 외 Antigravity)', gemini: 'Gemini 앱', aside: 'Aside', antigravity: 'Antigravity' };
const OUT_DEFAULT_ROLES = { consult: 'gemini', research: 'gemini', task: 'gemini', browser: 'time', code: 'antigravity' };
const OUT_EFFORT_LABELS = { deep: '깊은 판단', light: '단순·조사' };
function outEffortModel(r, target) {
  const e = r.effort === 'deep' ? 'deep' : 'light';
  if (target === 'gemini') return e === 'deep' ? 'Neon' : 'Hydrogen';
  if (target === 'antigravity') return e === 'deep' ? 'Carbon 주도' : 'Hydrogen 위주';
  return '';
}
const OUT_KIND_HINTS = {
  consult: '결재안 검토·의견',
  research: '시장·경쟁·키워드 조사',
  task: '문서·카피·기획 등 일반 실무',
  browser: '애드센스·서치콘솔 등 로그인 작업',
  code: '저장소 수정·PR'
};
const OUT_STATUS = {
  open: ['badge-amber', '대기'],
  claimed: ['badge-blue', '작업 중'],
  needs_ceo: ['badge-red', '대표님 필요'],
  submitted: ['badge-blue', '결과 접수'],
  accepted: ['badge-green', '반영 완료'],
  cancelled: ['badge-neutral', '취소'],
  rejected: ['badge-red', '반려']
};
let outSubmitOpenId = null;
let lastOutRouting = null;

/** 프로젝트 진행도: 현재 마일스톤 번호/전체 (예: M2/4) */
function msProgress(mission) {
  const ms = mission?.plan?.milestones || [];
  if (!ms.length) return '';
  const idx = ms.findIndex((x) => x.status !== 'done');
  return idx < 0 ? '완료' : `M${idx + 1}/${ms.length}`;
}
function milestoneLabel(task) {
  const ms = state.missions.find((m) => m.id === task.missionId)?.plan?.milestones || [];
  const i = ms.findIndex((x) => x.id === task.milestoneId);
  return i < 0 ? '작전' : `M${i + 1}`;
}

/** 작전 계획(운영 사이클): 단계 · 마일스톤 상태 · 결과물 */
const MS_STATUS = { todo: ['badge-neutral', '대기'], doing: ['badge-blue', '진행 중'], gate: ['badge-amber', '관문 결재 대기'], blocked: ['badge-red', '보류'], done: ['badge-green', '완료'] };
/** 유튜브 쇼츠 프로젝트: 뉴스 후보 선택 · 제작 현황 */
const SHORTS_JOB_LABEL = { queued: ['badge-blue', '제작 대기'], rendering: ['badge-blue', '제작 중'], uploaded: ['badge-green', '비공개 업로드 완료'], needs_fix: ['badge-amber', '대본 형식 오류'], failed: ['badge-red', '제작 실패'] };
function shortsPanelHtml(mission) {
  if (mission.mode !== 'project' || !/쇼츠|shorts/i.test(mission.title)) return '';
  const sh = state.shorts || {};
  const cands = (sh.candidates || []).filter((c) => c.status === 'new').slice(0, 10);
  const jobs = (sh.jobs || []).filter((j) => j.missionId === mission.id).slice(0, 8);
  const inFlight =
    (state.tasks || []).some((t) => t.missionId === mission.id && t.shorts && ['queued', 'running', 'awaiting_bridge', 'review_pending', 'awaiting_approval', 'outsourced'].includes(t.status)) ||
    jobs.some((j) => ['queued', 'rendering'].includes(j.status));
  const stage1Done = Boolean((mission.plan?.milestones || [])[0]?.status === 'done');
  const views = (v) => (v ? (v >= 10000 ? `${(v / 10000).toFixed(1)}만회` : `${v}회`) : '');
  const candRows = cands
    .map((c) => `<li style="margin:6px 0;display:flex;gap:8px;align-items:flex-start;"><button type="button" class="btn btn-primary btn-sm" data-shorts-pick="${esc(c.id)}">선택</button><div><strong>${esc(c.title)}</strong><div class="routine-sub">${esc(c.source || '')}${c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noreferrer">기사 원문</a>` : ''}${c.publishedAt ? ` · ${esc(formatTime(c.publishedAt))}` : ''}${c.coverage ? ` · 보도 ${c.coverage}곳` : ''}${c.trends?.volume ? ` · 검색 관심 ${views(c.trends.volume).replace('회', '')}+` : ''}${c.signal?.youtubeViews ? ` · 화제 👁 ${views(c.signal.youtubeViews)}(관련 유튜브, 영상은 안 씀)` : ''}</div></div></li>`)
    .join('');
  const jobRows = jobs
    .map((j) => {
      const [cls, label] = SHORTS_JOB_LABEL[j.status] || ['badge-neutral', j.status];
      return `<li style="margin:4px 0;"><span class="badge ${cls}">${label}</span> ${esc(j.script?.title || '(대본 확인 필요)')}${j.video?.url ? ` · <a href="${esc(j.video.url)}" target="_blank" rel="noreferrer">영상 보기</a>` : ''}${j.error ? ` <span class="routine-sub">(${esc(j.error)})</span>` : ''}${['needs_fix', 'failed'].includes(j.status) ? ` <button type="button" class="btn-inline-edit" data-shorts-retry="${esc(j.id)}">다시 시도</button>` : ''}</li>`;
    })
    .join('');
  const candSection = candRows
    ? inFlight || stage1Done
      ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:13px;"><strong>남은 후보 기사 (${cands.length}건)</strong> <span class="routine-sub">· 대본/제작 진행 중이라 접어두었습니다</span> <button type="button" class="btn-inline-edit" data-shorts-dismiss="1">후보 닫기</button></summary><ul style="list-style:none;padding:0;margin:6px 0 0;">${candRows}</ul></details>`
      : `<div style="margin-top:8px;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><strong>후보 기사</strong> <span class="routine-sub">(최근 1~2일 국내 정치 · 보도량·검색 관심·화제도 순)</span> <button type="button" class="btn-inline-edit" data-shorts-dismiss="1">후보 닫기 (그만 고르기)</button></div><ul style="list-style:none;padding:0;margin:4px 0 0;">${candRows}</ul></div>`
    : '<div class="routine-sub" style="margin-top:6px;">현재 대기 중인 뉴스 후보가 없습니다. (다음 정기 수집: 매일 오전 7시·오후 6시)</div>';
  return `<details class="mission-directive-quote" open>
      <summary style="cursor:pointer;"><strong>쇼츠 제작</strong> <span class="routine-sub">뉴스 후보를 고르면 팀이 대본을 써서 결재로 올리고, 승인하면 자동 제작기가 구국열사 채널에 비공개로 올립니다${sh.lastCollectedAt ? ` · 후보 수집 ${esc(formatTime(sh.lastCollectedAt))}` : ''}</span></summary>
      ${candSection}
      ${jobRows ? `<div style="margin-top:10px;"><strong>제작 현황</strong><ul style="list-style:none;padding:0;margin:4px 0 0;">${jobRows}</ul></div>` : ''}
    </details>`;
}

function missionPlanHtml(mission) {
  if (mission.mode !== 'project') return '';
  const plan = mission.plan;
  const deliverables = (mission.deliverables || []).slice(0, 6);
  const msRows = (plan?.milestones || [])
    .map((m, i) => {
      const [cls, label] = MS_STATUS[m.status] || MS_STATUS.todo;
      const canAdvance = m.status === 'doing' || m.status === 'gate' || m.status === 'blocked';
      const advanceBtn = canAdvance
        ? `<div style="margin:6px 0 2px 4px;"><button type="button" class="btn btn-amber btn-sm" data-advance-milestone="${esc(m.id)}" data-mission-id="${esc(mission.id)}">이 단계 완료 · 다음 단계로 →</button></div>`
        : '';
      return `<li style="margin:8px 0;"><span class="badge ${cls}">${esc(label)}</span> <strong>${i + 1}. ${esc(m.title)}</strong>${m.gate ? ' <span class="badge badge-neutral">관문</span>' : ''}<div class="routine-sub" style="margin-left:4px;">완료 기준: ${esc(m.doneWhen)}${m.rounds ? ` · 시도 ${m.rounds}회` : ''}${m.decisionNote ? ` · 대표님: ${esc(m.decisionNote)}` : ''}</div>${advanceBtn}</li>`;
    })
    .join('');
  return `<details class="mission-directive-quote" open>
      <summary style="cursor:pointer;"><strong>작전 계획${plan?.stage ? ` — ${esc(plan.stage)}` : ''}</strong> <span class="routine-sub">관문(대표님 결정)에서만 결재를 받고 나머지는 팀장이 바로 진행합니다</span>
        <button type="button" class="btn-inline-edit" id="btn-replan" data-mission-id="${esc(mission.id)}" title="방향을 바꿔 작전 계획을 다시 세움 (끝난 마일스톤은 유지)">다시 계획</button></summary>
      ${msRows ? `<ol style="list-style:none;padding:0;margin:8px 0 0;">${msRows}</ol>` : '<div class="routine-sub" style="margin-top:6px;">아직 작전 계획이 없습니다. "팀장 운영 사이클 실행"을 누르면 팀장이 계획을 세웁니다.</div>'}
      ${deliverables.length ? `<div style="margin-top:10px;"><strong>최근 결과물</strong><ul style="margin:4px 0 0;padding-left:18px;">${deliverables.map((d) => `<li class="routine-sub">${esc(d.title)} · ${esc(d.agentName || '')}${d.score != null ? ` · 검수 ${d.score}/10` : ''}${d.gaps?.length ? ' · 부족한 점 있음' : ''}</li>`).join('')}</ul></div>` : ''}
    </details>`;
}

/** 프로젝트 목표 표시: 지표 현재값 → 목표치, 진척, 기한 */
function missionGoalHtml(mission) {
  const g = mission.goal || {};
  const has = g.metric && g.target !== null && g.target !== undefined && g.target !== '';
  if (!has) {
    return `<div class="mission-directive-quote" style="border-left-color:var(--accent-amber);"><strong>목표:</strong> 숫자 목표가 없습니다. 팀장이 무엇을 기준으로 추진할지 모르니 <button type="button" class="btn-inline-edit" id="btn-mission-goal-2" data-mission-id="${esc(mission.id)}">목표 설정</button></div>`;
  }
  const fmt = (n) => (n === null || n === undefined || n === '' ? '미확인' : `${Number(n).toLocaleString('ko-KR')}${g.unit ? ` ${g.unit}` : ''}`);
  let pct = null;
  if (g.current !== null && g.current !== undefined && g.baseline !== null && g.baseline !== undefined && Number(g.target) !== Number(g.baseline)) {
    pct = Math.max(0, Math.min(100, Math.round(((Number(g.current) - Number(g.baseline)) / (Number(g.target) - Number(g.baseline))) * 100)));
  }
  let dday = '';
  if (g.deadline) {
    const d = Math.ceil((Date.parse(`${g.deadline}T23:59:59+09:00`) - Date.now()) / 86400000);
    dday = d >= 0 ? ` · D-${d}` : ` · 기한 ${-d}일 지남`;
  }
  return `<div class="mission-directive-quote"><strong>목표:</strong> ${esc(g.objective || '')} <span class="mono">${esc(g.metric)} ${esc(fmt(g.current))} → ${esc(fmt(g.target))}${pct !== null ? ` (${pct}%)` : ''}${esc(dday)}</span>${g.updatedAt ? ` <span class="routine-sub">갱신 ${esc(formatTime(g.updatedAt))}</span>` : ''}</div>`;
}

function outsourcingSettingsClient() {
  const o = state?.settings?.outsourcing || {};
  const oh = o.officeHours || {};
  return {
    enabled: o.enabled !== false,
    autoOnFailure: o.autoOnFailure !== false,
    autoForBrowser: o.autoForBrowser !== false,
    consultMode: o.consultMode || 'proposals',
    routing: o.routing || 'auto',
    officeHours: { days: Array.isArray(oh.days) && oh.days.length ? oh.days : [1, 2, 3, 4, 5], start: oh.start || '09:00', end: oh.end || '19:00' },
    awayUntil: o.awayUntil && Date.parse(o.awayUntil) > Date.now() ? o.awayUntil : '',
    roles: { ...OUT_DEFAULT_ROLES, ...(o.roles || {}) },
    priorities: { ...OUT_DEFAULT_PRIORITIES, ...(o.priorities || {}) },
    codeWorkflow: o.codeWorkflow === 'agy_then_aside' ? 'agy_then_aside' : 'single',
    waitMinutes: Number(o.waitMinutes) || 30,
    geminiWaitMinutes: o.geminiWaitMinutes ?? 180
  };
}

/** 서버와 같은 규칙으로 요청별 현재 대상 계산 (화면 표시용) */
function outChainClient(r) {
  const cfg = outsourcingSettingsClient();
  let chain = [...(cfg.priorities[r.kind] || OUT_DEFAULT_PRIORITIES[r.kind] || OUT_DEFAULT_PRIORITIES.task)].filter((w) => OUT_WORKER_CAPS[w]?.includes(r.kind));
  if (cfg.awayUntil && chain.length > 1) chain = chain.filter((w) => w !== 'aside');
  const rest = chain.filter((w) => !(r.skipWorkers || []).includes(w));
  return rest.length ? rest : chain;
}

/** 서버와 같은 규칙으로 요청별 현재 대상과 다음 순위로 넘어가는 시각 계산 (화면 표시용) */
function outTargetInfo(r) {
  if (r.pinnedWorker) return { target: r.pinnedWorker, next: null };
  const cfg = outsourcingSettingsClient();
  if (cfg.routing !== 'auto' && OUT_WORKER_CAPS[cfg.routing]?.includes(r.kind)) return { target: cfg.routing, next: null };
  const chain = outChainClient(r);
  const since = r.queuedAt || r.createdAt ? Date.parse(r.queuedAt || r.createdAt) : 0;
  let stage = 0;
  let next = null;
  if (r.status === 'open' && since) {
    let t = since;
    stage = chain.length - 1;
    for (let i = 0; i < chain.length - 1; i++) {
      t += (chain[i] === 'gemini' ? Math.max(cfg.waitMinutes, 60) : cfg.waitMinutes) * 60000;
      if (Date.now() < t) { stage = i; next = { at: t, worker: chain[i + 1] }; break; }
    }
  }
  return { target: chain[stage] || chain[0], next };
}

function outTargetClient(r) {
  return outTargetInfo(r).target;
}

function geminiConnectorUrl() {
  return `${getPublicServerOrigin()}/api/mcp?token=${encodeURIComponent(state?.settings?.mcpToken || '')}`;
}

/** 팀장 근무: AGY 팀장 감시기가 3분 안에 접속했으면 주간(AGY), 아니면 Gemini 앱 당직 */
function leadDutyLabel() {
  const at = state?.agentConnections?.['lead:agy_lead']?.lastSeenAt;
  return at && Date.now() - Date.parse(at) < 3 * 60 * 1000 ? 'AGY 근무' : 'Gemini 앱 당직';
}

/** Gemini 앱 예약 작업(Scheduled)에 넣을 지시문 */
function geminiSchedulePrompt() {
  return "연결된 앱 \"CEO Office 외주창구\"(맞춤 MCP 앱)의 도구로 CEO Office 일을 처리해줘. 이전 실행에서 오류가 났더라도 무시하고 매번 도구를 새로 호출해.\n1) list_outsourcing_requests를 worker \"gemini\"로 호출해. id가 ldj_로 시작하는 항목은 팀장 판단(당직 팀장 몫)이니 먼저 처리해.\n2) 각 항목을 claim_outsourcing_request(request_id, worker \"gemini\")로 잡고, 돌려받은 자료를 끝까지 읽어.\n3) 팀장 판단(ldj_): 자료의 [답안 형식] 키를 그대로 쓴 JSON 하나만 만들어 submit_outsourcing_result(request_id, worker \"gemini\", summary 한 줄, document에 JSON만)로 제출. 자료에 없는 사실은 지어내지 말고 업무 브리핑의 금지 사항을 지켜. 최대 5건.\n4) 일반 요청: 요청서의 \"해야 할 일\"과 \"제출물\" 기준대로 작업해. 웹 검색으로 근거를 확인하고 수치·주장에는 출처 링크를 붙여. 확인한 사실과 추정은 구분해. 끝나면 submit_outsourcing_result(worker \"gemini\", summary 2~4문장, document 마크다운 전문)로 제출. 최대 2건.\n5) 코드 저장소 수정이나 로그인이 필요한 사이트 작업이면 직접 하지 말고 pass_outsourcing_request로 넘겨 (코드 → antigravity, 로그인·콘솔 → aside). 결제·발송·광고비 집행은 하지 마. 대화창에 답만 쓰고 끝내지 마.\n6) 처리할 게 없으면 \"처리할 일 없음\" 한 줄로 끝내.";
}

function mcpConfigSnippet() {
  const json = { mcpServers: { 'ceo-office': { serverUrl: `${getPublicServerOrigin()}/api/mcp`, headers: { Authorization: `Bearer ${state?.settings?.mcpToken || ''}` } } } };
  return JSON.stringify(json, null, 2);
}

let outListTab = 'active';
let outNewOpen = false;

function outCardHtml(r) {
  const [cls, label] = OUT_STATUS[r.status] || ['badge-neutral', r.status];
  const mission = state.missions.find((m) => m.id === r.missionId);
  const res = r.result;
  const open = ['open', 'claimed'].includes(r.status);
  const target = outTargetClient(r);
  return `<div class="sheet out-card ${r.status === 'needs_ceo' ? 'out-card-ceo' : ''}">
      <div class="routine-head">
        <div style="min-width:0;">
          <div class="routine-meta">
            <span class="badge badge-neutral mono">${esc(r.id)}</span>
            <span class="badge badge-neutral">${esc(OUT_KIND_LABELS[r.kind] || r.kind)}</span>
            <span class="badge ${cls}">${esc(label)}${r.claimedBy && r.status === 'claimed' ? ` · ${esc(r.claimedBy)}` : ''}</span>
            ${r.codeWorkflow === 'agy_then_aside' && !r.reviewStage ? '<span class="badge badge-blue">AGY 수정 → Aside 검수</span>' : ''}
            ${r.reviewStage === 'aside_review' ? `<span class="badge badge-blue">2단계 검수·보완${Number(r.reviewRound) > 1 ? ` ${r.reviewRound}차` : ''}</span>` : ''}
            ${r.reviewStage === 'agy_rework' ? `<span class="badge badge-amber">검수 반려 · AGY 재수정 ${Number(r.reviewRound) || 2}차</span>` : ''}
            ${r.reviewRequestId ? `<span class="badge badge-neutral">→ Aside 검수 (${esc(r.reviewRequestId)})</span>` : ''}
            ${open || r.status === 'needs_ceo' ? `<span class="badge badge-blue">→ ${esc(OUT_WORKER_LABELS[target] || target)}${r.pinnedWorker ? ' (지정)' : ''}</span>` : ''}
            ${res?.by ? `<span class="badge badge-neutral">작업: ${esc(res.by)}</span>` : ''}
          </div>
          <h3 class="routine-title">${esc(r.title)}</h3>
          <div class="routine-sub">${mission ? esc(mission.title) : '단독 요청'}${r.repo ? ` · ${esc(r.repo)}` : ''}${r.sourcePrUrl ? ` · <a href="${esc(r.sourcePrUrl)}" target="_blank" rel="noreferrer">1차 PR ↗</a>` : ''} · 요청 ${esc(formatTime(r.createdAt))}${res?.submittedAt ? ` · 완료 ${esc(formatTime(res.submittedAt))}` : ''}</div>
        </div>
        <div class="routine-actions">
          ${
            open
              ? `<select class="out-assign" data-out-assign="${esc(r.id)}" title="이 요청을 누구에게 맡길지">
                  <option value="auto" ${!r.pinnedWorker ? 'selected' : ''}>대상: 자동</option>
                  <option value="aside" ${r.pinnedWorker === 'aside' ? 'selected' : ''}>대상: Aside</option>
                  <option value="antigravity" ${r.pinnedWorker === 'antigravity' && r.codeWorkflow !== 'agy_then_aside' ? 'selected' : ''}>대상: Antigravity</option>
                  ${r.kind === 'code' && !r.reviewStage ? `<option value="agy_aside" ${r.codeWorkflow === 'agy_then_aside' ? 'selected' : ''}>대상: AGY 수정 + Aside 검수</option>` : ''}
                  ${OUT_WORKER_CAPS.gemini.includes(r.kind) ? `<option value="gemini" ${r.pinnedWorker === 'gemini' ? 'selected' : ''}>대상: Gemini 앱</option>` : ''}
                </select>`
              : ''
          }
          <button type="button" class="btn btn-ghost btn-sm" data-out-copy="${esc(r.id)}">요청서 복사</button>
          ${open ? `<button type="button" class="btn btn-ghost btn-sm" data-out-submit-toggle="${esc(r.id)}">결과 붙여넣기</button>` : ''}
          ${open || r.status === 'needs_ceo' ? `<button type="button" class="btn btn-ghost btn-sm" data-out-cancel="${esc(r.id)}">취소</button>` : ''}
        </div>
      </div>
      ${
        r.status === 'needs_ceo' && r.ceoAction
          ? `<div class="out-ceo-box">
              <div><strong>대표님이 해주실 일:</strong> ${esc(r.ceoAction.action)}</div>
              ${r.ceoAction.detail ? `<div class="routine-desc">${esc(r.ceoAction.detail)}</div>` : ''}
              <div class="routine-sub">알린 작업자: ${esc(r.ceoAction.by || '외부 AI')} · ${esc(formatTime(r.ceoAction.at))}</div>
              <div class="routine-form-actions" style="justify-content:flex-start;">
                <button type="button" class="btn btn-primary btn-sm" data-out-resume="${esc(r.id)}" data-out-resume-worker="">처리했어요 · 재개</button>
                <button type="button" class="btn btn-ghost btn-sm" data-out-resume="${esc(r.id)}" data-out-resume-worker="antigravity">Antigravity로 재개</button>
                <button type="button" class="btn btn-ghost btn-sm" data-out-resume="${esc(r.id)}" data-out-resume-worker="aside">Aside로 재개</button>
                ${OUT_WORKER_CAPS.gemini.includes(r.kind) ? `<button type="button" class="btn btn-ghost btn-sm" data-out-resume="${esc(r.id)}" data-out-resume-worker="gemini">Gemini 앱으로 재개</button>` : ''}
              </div>
            </div>`
          : ''
      }
      ${(() => { const nx = open ? outTargetInfo(r).next : null; return nx ? `<p class="routine-sub" style="margin:6px 0 0;">${esc(new Date(nx.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))}까지 안 가져가면 → ${esc(OUT_WORKER_LABELS[nx.worker] || nx.worker)}</p>` : ''; })()}
      ${r.reason && r.status !== 'needs_ceo' && !res ? `<p class="routine-desc">사유: ${esc(r.reason)}</p>` : ''}
      ${
        outSubmitOpenId === r.id && open
          ? `<div class="out-submit">
              <label class="field"><span class="field-label">작업한 AI</span>
                <select id="out-submit-worker"><option value="antigravity">Antigravity</option><option value="aside">Aside</option><option value="gemini">Gemini 앱</option><option value="manual">기타 (직접/다른 AI)</option></select></label>
              <label class="field"><span class="field-label">요약</span><input type="text" id="out-submit-summary" placeholder="결과 핵심 2~3문장" /></label>
              <label class="field"><span class="field-label">결과 문서 (마크다운)</span><textarea id="out-submit-doc" rows="6" placeholder="외부 AI가 만든 결과를 그대로 붙여넣으세요"></textarea></label>
              <label class="field"><span class="field-label">PR 주소 (코드 작업일 때)</span><input type="text" id="out-submit-pr" placeholder="https://github.com/alpinu83/.../pull/12" /></label>
              <div class="routine-form-actions"><button type="button" class="btn btn-primary btn-sm" data-out-submit="${esc(r.id)}">제출</button></div>
            </div>`
          : ''
      }
      ${
        res
          ? `<details class="routine-result"><summary>결과 보기${res.prUrl ? ' · PR 있음' : ''}</summary>
              ${res.prUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(res.prUrl)}" target="_blank" rel="noreferrer">PR 보기 ↗</a>` : ''}
              ${res.summary ? `<p class="routine-desc"><strong>요약</strong> ${esc(res.summary)}</p>` : ''}
              <div class="markdown-body">${renderMarkdown(res.document || '')}</div>
            </details>`
          : ''
      }
    </div>`;
}

/** 외부 협업 화면: 협업 중인 일과 완료된 일만 */
function renderOutsourcingView() {
  if (!state) return;
  if (state.outsourcingRouting) lastOutRouting = state.outsourcingRouting;
  const list = Array.isArray(state.outsourcing) ? state.outsourcing : [];
  const rank = { needs_ceo: 0, claimed: 1, open: 2 };
  const active = list.filter((r) => ['open', 'claimed', 'needs_ceo'].includes(r.status)).sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  const done = list.filter((r) => !['open', 'claimed', 'needs_ceo'].includes(r.status)).sort((a, b) => String(b.result?.submittedAt || b.updatedAt || '').localeCompare(String(a.result?.submittedAt || a.updatedAt || '')));
  const needsCeo = active.filter((r) => r.status === 'needs_ceo');
  const countEl = document.getElementById('nav-outsourcing-count');
  if (countEl) {
    countEl.textContent = needsCeo.length ? `${needsCeo.length}!` : active.length;
    countEl.style.color = needsCeo.length ? 'var(--accent-danger)' : '';
  }
  renderOutsourcingSettings();
  const root = document.getElementById('outsourcing-root');
  if (!root) return;
  const rt = lastOutRouting || { label: '-', why: '' };
  const missions = state.missions.filter((m) => !m.isRoutineHub);
  const shown = outListTab === 'done' ? done : active;

  root.innerHTML = `
    <div class="out-topbar">
      <div class="routine-sub">개발·협업 분담: <strong>${esc(rt.why || '-')}</strong></div>
      <div class="out-away">
        <button type="button" class="btn btn-ghost btn-sm" data-out-new-toggle="1">+ 개발·협업 요청</button>
        <button type="button" class="btn btn-ghost btn-sm" data-out-open-settings="1">협업 설정</button>
      </div>
    </div>
    ${
      outNewOpen
        ? `<div class="sheet out-new">
            <div class="form-row-two">
              <label class="field"><span class="field-label">제목 *</span><input type="text" id="out-new-title" maxlength="120" placeholder="예: 연말정산 계산기 페이지 새로 만들기" /></label>
              <label class="field"><span class="field-label">종류</span>
                <select id="out-new-kind"><option value="task">실무 작업</option><option value="code">코드 수정</option><option value="research">심층 리서치</option><option value="browser">브라우저·계정 작업</option></select></label>
            </div>
            <label class="field" style="margin-top:12px;"><span class="field-label">해야 할 일 *</span><textarea id="out-new-goal" rows="4" placeholder="무엇을, 어떤 기준으로 끝내면 되는지 적어 주세요."></textarea></label>
            <div class="form-row-two" style="margin-top:12px;">
              <label class="field"><span class="field-label">관련 프로젝트</span><select id="out-new-mission"><option value="">없음</option>${missions.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</select></label>
              <label class="field"><span class="field-label">맡길 곳</span><select id="out-new-worker"><option value="any">자동 (역할 분담표대로)</option><option value="antigravity">AGY (개발팀)</option><option value="aside">Aside (개발팀)</option><option value="gemini">Gemini 앱 (당직·리서치·문서)</option><option value="agy_aside">AGY 수정 + Aside 검수 (코드)</option></select></label>
            </div>
            <div class="routine-form-actions"><button type="button" class="btn btn-ghost btn-sm" data-out-new-toggle="1">닫기</button><button type="button" class="btn btn-primary btn-sm" data-out-create="1">요청 올리기</button></div>
          </div>`
        : ''
    }
    <div class="hub-tab-bar out-tabs" role="tablist">
      <button type="button" class="hub-tab ${outListTab === 'active' ? 'active' : ''}" data-out-tab="active">진행 중 ${active.length}${needsCeo.length ? ` · 대표님 필요 ${needsCeo.length}` : ''}</button>
      <button type="button" class="hub-tab ${outListTab === 'done' ? 'active' : ''}" data-out-tab="done">완료 ${done.length}</button>
    </div>
    <div class="routine-list">${
      shown.slice(0, 50).map(outCardHtml).join('') ||
      `<div class="empty-state">${outListTab === 'done' ? '완료된 개발·협업 작업이 아직 없습니다.' : '지금 진행 중인 개발·협업 작업이 없습니다.'}</div>`
    }</div>`;
}

/** 설정 → 외부 협업: 역할 분담(우선순위)·PC 자리비움·자동 외주·외부 자문·Antigravity/Aside 연결 */
function renderOutsourcingSettings(force = false) {
  const root = document.getElementById('outsourcing-settings-root');
  if (!root || !state) return;
  // 대표님이 이 탭을 보고 있는 동안에는 자동 새로고침으로 입력값이 지워지지 않게 다시 그리지 않음
  if (!force && root.dataset.rendered === '1' && currentView === 'integrations' && currentHubTab === 'outsourcing') return;
  root.dataset.rendered = '1';
  if (!root.dataset.dirtyBound) {
    root.dataset.dirtyBound = '1';
    root.addEventListener('change', (e) => {
      if (!e.target.closest('.out-route')) return;
      const d = document.getElementById('out-route-dirty');
      if (d) d.style.display = '';
      if (e.target.matches('[data-out-prio="code"][data-out-prio-idx="0"]')) {
        const twoStage = e.target.value === 'agy_then_aside';
        const sec = root.querySelector('[data-out-prio="code"][data-out-prio-idx="1"]');
        const note = document.getElementById('out-code-stage2-note');
        if (sec) sec.style.display = twoStage ? 'none' : '';
        if (note) note.style.display = twoStage ? '' : 'none';
      }
    });
  }
  const cfg = outsourcingSettingsClient();
  const rt = lastOutRouting || { label: '-', why: '' };
  const daysVal = cfg.officeHours.days.length === 7 ? 'all' : cfg.officeHours.days.join(',') === '1,2,3,4,5' ? 'weekdays' : 'custom';
  const prio = cfg.priorities;
  const codeTwoStage = cfg.codeWorkflow === 'agy_then_aside';
  const roleRows = Object.keys(OUT_DEFAULT_PRIORITIES)
    .filter((kind) => kind !== 'code') // 코드는 개발 지침이 정함
    .map((kind) => {
      const capable = ['gemini', 'aside', 'antigravity'].filter((w) => OUT_WORKER_CAPS[w].includes(kind));
      const cur = prio[kind] || OUT_DEFAULT_PRIORITIES[kind];
      const cells = [0, 1, 2]
        .map((i) => {
          if (i >= capable.length) return '<td class="routine-sub" style="padding:4px;">-</td>';
          const val = kind === 'code' && i === 0 && codeTwoStage ? 'agy_then_aside' : cur[i] || '';
          if (kind === 'code' && i === 1) {
            return `<td style="padding:4px;"><select data-out-prio="${kind}" data-out-prio-idx="${i}" style="${codeTwoStage ? 'display:none;' : ''}">
                <option value="" ${!cur[i] ? 'selected' : ''}>없음</option>
                ${capable.map((w) => `<option value="${w}" ${cur[i] === w ? 'selected' : ''}>${esc(OUT_WORKER_LABELS[w])}</option>`).join('')}
              </select><span class="routine-sub" id="out-code-stage2-note" style="${codeTwoStage ? '' : 'display:none;'}">2단계: Aside 자동 검수·보완</span></td>`;
          }
          return `<td style="padding:4px;"><select data-out-prio="${kind}" data-out-prio-idx="${i}">
              ${i > 0 ? `<option value="" ${!val ? 'selected' : ''}>없음</option>` : ''}
              ${capable.map((w) => `<option value="${w}" ${val === w ? 'selected' : ''}>${esc(OUT_WORKER_LABELS[w])}</option>`).join('')}
              ${kind === 'code' && i === 0 ? `<option value="agy_then_aside" ${val === 'agy_then_aside' ? 'selected' : ''}>AGY 수정 + Aside 검수·보완</option>` : ''}
            </select></td>`;
        })
        .join('');
      const now = rt.byKind?.[kind]?.label;
      const botFirst = { research: 'Manus Cue + 피클 동시 (교차 조사)', task: 'Meta Muse + 대안안 1명(Cue·피클 중 한가한 쪽) · 짧은 문구는 인스팅스 · 반복 수집은 부이' }[kind];
      return `<tr>
          <td style="padding:4px;"><strong>${esc(OUT_KIND_LABELS[kind])}</strong><div class="routine-sub">${esc(OUT_KIND_HINTS[kind])}</div></td>
          <td class="routine-sub" style="padding:4px;">${botFirst ? `봇 팀원: ${esc(botFirst)}` : '-'}</td>
          ${cells}
          <td class="routine-sub" style="padding:4px;">${now ? `새 요청 → ${esc(now)}` : ''}</td>
        </tr>`;
    })
    .join('');
  const connAgo = (...keys) => {
    const at = keys.map((k) => state?.agentConnections?.[k]?.lastSeenAt).filter(Boolean).sort().pop();
    if (!at) return '접속 기록 없음';
    const min = Math.round((Date.now() - Date.parse(at)) / 60000);
    return min < 3 ? `연결됨 (${min < 1 ? '방금' : `${min}분 전`})` : `마지막 접속 ${formatTime(at)} (${min < 60 ? `${min}분` : `${Math.round(min / 60)}시간`} 전)`;
  };
  const devPol = { small: 'aside', large: 'agy_aside', risky: 'design_first', incident: 'aside', ...(state.settings?.devPolicy || {}) };
  const DEV_ROUTE_LABELS = { aside: 'Aside 혼자 (수정·자체 검수)', agy: 'AGY 혼자 (구현·테스트·PR)', agy_aside: 'AGY 구현 → Aside 검수', design_first: 'Aside 설계 → 대표님 확인 → AGY 구현 → Aside 검수' };
  const DEV_CASE_LABELS = { small: '작은 수정 (파일 1~2개, 할 일이 분명)', large: '보통~큰 구현 (여러 파일, 테스트 필요)', risky: '애매하거나 위험한 일 (구조 변경·데이터·보안·돈)', incident: '운영 중 문제 (배포 후 오류·데이터 이상)' };
  const devRows = Object.keys(DEV_CASE_LABELS)
    .map((k) => `<tr><td style="padding:6px 4px;">${esc(DEV_CASE_LABELS[k])}</td><td style="padding:4px;"><select data-dev-policy="${k}">${Object.keys(DEV_ROUTE_LABELS).map((r) => `<option value="${r}" ${devPol[k] === r ? 'selected' : ''}>${esc(DEV_ROUTE_LABELS[r])}</option>`).join('')}</select></td></tr>`)
    .join('');
  root.innerHTML = `
    <div class="card">
      <div class="card-head"><h3 class="card-title">개발 지침 (개발팀 Aside · AGY)</h3></div>
      <p class="routine-desc" style="margin-top:0;">팀장이 코드 작업을 배정할 때 크기·위험도를 판단하면, 아래 지침대로 개발팀에 자동으로 보냅니다. Aside와 AGY는 같은 회사 개발팀입니다.</p>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><tbody>${devRows}</tbody></table></div>
      <div class="routine-form-actions"><button type="button" class="btn btn-primary btn-sm" data-dev-policy-save="1">개발 지침 저장</button></div>
    </div>
    <div class="card out-route">
      <div class="card-head"><h3 class="card-title">코드 외 일의 담당 순서</h3></div>
      <p class="routine-desc" style="margin-top:0;">팀장이 직접 배정하지 않고 시스템이 넘기는 일(결재 전 검토, 반복 실패한 작업, 계정·콘솔 작업)을 누가 맡을지 정합니다. 리서치·실무는 지금 접속 중인 봇 팀원이 먼저 맡고, 봇이 없거나 이미 시도했으면 1순위부터 차례로 넘어갑니다(정해진 시간 안에 안 가져가면 다음 순위, Gemini 앱은 최소 60분). 코드 작업은 위 개발 지침을 따릅니다.</p>
      <div style="overflow-x:auto;"><table class="out-role-table" style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr><th style="text-align:left;padding:6px 4px;">일의 종류</th><th style="text-align:left;padding:6px 4px;">먼저 (접속 중인 봇)</th><th style="text-align:left;padding:6px 4px;">1순위</th><th style="text-align:left;padding:6px 4px;">2순위</th><th style="text-align:left;padding:6px 4px;">3순위</th><th style="text-align:left;padding:6px 4px;">현재</th></tr></thead>
        <tbody>${roleRows}</tbody>
      </table></div>
      <div class="out-settings">
        <label class="out-check">다음 순위로 넘기기까지
          <select id="out-wait-min">
            ${[[15, '15분'], [30, '30분'], [60, '1시간'], [120, '2시간']].map(([v, t]) => `<option value="${v}" ${Number(cfg.waitMinutes) === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label class="out-check">한 곳에 몰기
          <select id="out-route-mode">
            <option value="auto" ${cfg.routing === 'auto' ? 'selected' : ''}>안 함 (순서대로)</option>
            <option value="gemini" ${cfg.routing === 'gemini' ? 'selected' : ''}>Gemini 앱에 몰기</option>
            <option value="aside" ${cfg.routing === 'aside' ? 'selected' : ''}>Aside에 몰기</option>
            <option value="antigravity" ${cfg.routing === 'antigravity' ? 'selected' : ''}>AGY에 몰기</option>
          </select>
        </label>
        <span class="routine-sub" id="out-route-dirty" style="display:none;color:var(--accent-amber);font-weight:600;">바꾼 내용이 아직 저장되지 않았습니다</span>
        <button type="button" class="btn btn-primary btn-sm" data-out-route-save="1">담당 순서 저장</button>
      </div>
      <div class="out-route-now" style="margin-top:12px;">
        <div>
          <div class="routine-sub">PC 자리비움 (PC에서 도는 Aside·AGY를 기다리지 않고 건너뜀)</div>
          <div class="routine-sub">${cfg.awayUntil ? `${esc(new Date(cfg.awayUntil).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))}까지 Aside·AGY 건너뛰는 중` : '꺼짐'}</div>
        </div>
        <div class="out-away">
          <button type="button" class="btn btn-ghost btn-sm" data-out-away="1">1시간</button>
          <button type="button" class="btn btn-ghost btn-sm" data-out-away="3">3시간</button>
          <button type="button" class="btn btn-ghost btn-sm" data-out-away="8">8시간</button>
          ${cfg.awayUntil ? `<button type="button" class="btn btn-primary btn-sm" data-out-away="0">해제</button>` : ''}
        </div>
      </div>
      <p class="routine-sub" style="margin:8px 0 0;">텔레그램: /route (순서 보기) · /away 3 (PC 자리비움) · /out 요청ID aside (요청 하나만 담당 바꾸기)</p>
    </div>

    <div class="card out-guide">
      <div class="card-head"><h3 class="card-title">자동 넘김 · 결재 전 검토</h3></div>
      <div class="out-settings" style="border-top:none;margin-top:0;padding-top:0;">
        <label class="out-check"><input type="checkbox" id="out-cfg-enabled" ${cfg.enabled ? 'checked' : ''} /> 협업 큐 사용</label>
        <label class="out-check"><input type="checkbox" id="out-cfg-browser" ${cfg.autoForBrowser ? 'checked' : ''} /> 로그인이 필요한 계정·콘솔 작업은 Aside에게 자동으로</label>
        <label class="out-check"><input type="checkbox" id="out-cfg-failure" ${cfg.autoOnFailure ? 'checked' : ''} /> 팀원이 반복 실패한 작업은 위 담당 순서대로 넘김</label>
        <label class="out-check">결재 전 검토 의견
          <select id="out-cfg-consult">
            <option value="off" ${cfg.consultMode === 'off' ? 'selected' : ''}>끄기</option>
            <option value="proposals" ${cfg.consultMode === 'proposals' ? 'selected' : ''}>관문 결재만</option>
            <option value="proposals_and_reports" ${cfg.consultMode === 'proposals_and_reports' ? 'selected' : ''}>관문 결재 + 완료 보고</option>
          </select>
        </label>
        <button type="button" class="btn btn-primary btn-sm" data-out-settings-save="1">설정 저장</button>
      </div>
      <p class="routine-desc">결재 전 검토는 팀장이 올린 관문 결재·완료 보고를 다른 AI(기본 Gemini 앱)가 한 번 더 비판적으로 보고, 의견을 결재 카드에 붙입니다. 로그인·인증처럼 대표님 손이 필요한 순간에는 작업이 멈추고 텔레그램으로 알립니다.</p>
    </div>

    <div class="card out-guide">
      <div class="card-head"><h3 class="card-title">개발팀 · 당직 팀장 연결</h3></div>
      <div class="out-guide-grid">
        <div>
          <h4>AGY (Antigravity) · 구현 · 주간 팀장</h4>
          <p class="routine-desc">코딩 감시기: ${esc(connAgo('worker:antigravity'))}<br />팀장 감시기: ${esc(connAgo('lead:agy_lead'))}</p>
          <p class="routine-desc">대표님 PC에서 감시기 2개가 돕니다. 코딩 감시기는 1분마다 AGY 몫 작업을, 팀장 감시기는 30초마다 팀장 판단(Hydrogen)을 가져갑니다. 처음 설치하거나 업데이트할 때 아래 명령을 PowerShell에 붙여 넣으세요.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" data-copy-cmd="irm https://raw.githubusercontent.com/alpinu83/ai-ceo-hub/main/scripts/windows/install-agy-watcher.ps1 | iex">코딩 감시기 설치 명령</button>
            <button type="button" class="btn btn-primary btn-sm" data-copy-cmd="irm https://raw.githubusercontent.com/alpinu83/ai-ceo-hub/main/scripts/windows/install-agy-lead-watcher.ps1 | iex">팀장 감시기 설치 명령</button>
            <button type="button" class="btn btn-ghost btn-sm" data-out-copy-setup="1">AGY 설정 프롬프트</button>
            <button type="button" class="btn btn-ghost btn-sm" data-out-copy-mcp="1">MCP 설정</button>
          </div>
        </div>
        <div>
          <h4>Aside · 설계 · 검수 · 브라우저·계정</h4>
          <p class="routine-desc">감시기: ${esc(connAgo('worker:aside'))}</p>
          <p class="routine-desc">대표님 PC의 Aside 감시기가 1분마다 Aside 몫 작업을 확인해 바로 처리합니다(설계·검수·작은 코드 수정·계정 작업). 감시기가 꺼져 있어도 Aside 정기 루틴이 매일 9:20·13:20·17:20에 남은 일을 처리합니다. PC와 Aside가 켜져 있어야 합니다.</p>
        </div>
        <div>
          <h4>Gemini 앱 · 야간 당직 팀장 · 검토·리서치</h4>
          <p class="routine-desc">마지막 실행: ${esc(connAgo('lead:gemini_app', 'worker:gemini'))}</p>
          <p class="routine-desc">Gemini 앱 예약 작업(매시간, 실제 간격은 대략 1시간으로 들쭉날쭉)이 AGY가 없을 때 팀장 판단을 처리하고, 결재 전 검토·리서치를 맡습니다. 처음 연결할 때: gemini.google.com → 설정 → Connected Apps → Custom에 "연결 주소"를 "CEO Office 외주창구"로 저장 → Scheduled에서 새 작업에 "예약 지시문"을 넣고 매시간으로 저장.</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" data-out-copy-gemini-url="1">연결 주소 복사</button>
            <button type="button" class="btn btn-ghost btn-sm" data-out-copy-gemini-prompt="1">예약 지시문 복사</button>
          </div>
        </div>
      </div>
    </div>`;
}

function renderConsultSection(apr) {
  if (apr?.consult) {
    const c = apr.consult;
    return `<div class="memo-section">
        <h4>추가 검토 의견 · ${esc(c.by || '')}</h4>
        ${c.summary ? `<p style="margin:0 0 8px;font-size:13.5px;"><strong>요약</strong> ${esc(c.summary)}</p>` : ''}
        <details><summary style="cursor:pointer;font-size:12.5px;color:var(--ink-secondary);">검토 전문 보기</summary><div class="markdown-body">${renderMarkdown(c.document || '')}</div></details>
      </div>`;
  }
  const reqId = apr?.consultRequestId;
  const req = reqId ? (state.outsourcing || []).find((r) => r.id === reqId) : null;
  if (req && ['open', 'claimed'].includes(req.status)) {
    return `<div class="memo-section"><h4>추가 검토</h4><p class="routine-desc" style="margin:0;">검토 요청 중 (${req.status === 'claimed' ? `${esc(req.claimedBy)} 작업 중` : '대기'}). 기다리지 않고 결재해도 됩니다.</p></div>`;
  }
  return '';
}

/* ==================== ROUTINES (루틴 업무) ==================== */
let lastAiHealth = null;
const ROUTINE_KIND_LABELS = { ops_check: '시스템 점검', briefing: '마감 보고', system_audit: '팀장 시스템 회고', task: '정기 업무' };
const ROUTINE_DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function routineScheduleText(r) {
  const days = r.days || [];
  let dayText = '매일';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) dayText = '평일';
  else if (days.length) dayText = `매주 ${days.map((d) => ROUTINE_DAY_LABELS[d]).join('·')}`;
  return `${dayText} ${(r.times || []).join(', ')}`;
}

function routineStatusBadge(r, task) {
  if (!r.lastRunAt) return ['badge-neutral', '실행 전'];
  if (r.lastStatus === 'running') return ['badge-blue', '실행 중'];
  if (r.lastStatus === 'pending') return ['badge-blue', '팀장 판단 대기'];
  if (r.lastStatus === 'error') return ['badge-red', '오류'];
  if (r.lastStatus === 'warning') return ['badge-amber', '이상 발견'];
  if (r.lastStatus === 'started') {
    if (!task) return ['badge-neutral', '배정됨'];
    if (task.status === 'completed') return ['badge-green', '완료'];
    if (task.status === 'awaiting_approval') return ['badge-amber', '결재 대기'];
    if (task.status === 'rejected') return ['badge-red', '반려'];
    return ['badge-blue', '진행 중'];
  }
  return ['badge-green', '정상'];
}

function renderRoutinesView() {
  if (!state) return;
  if (state.aiHealth) lastAiHealth = state.aiHealth;
  const routines = state.routines || [];
  const countEl = document.getElementById('nav-routines-count');
  if (countEl) countEl.textContent = routines.filter((r) => r.enabled).length;
  const listEl = document.getElementById('routine-list');
  if (!listEl) return;

  const assigneeSel = document.getElementById('routine-assignee');
  if (assigneeSel) {
    const prev = assigneeSel.value;
    const internal = state.agents.filter((a) => a.active && ['exaone', 'gemini', 'groq', 'openrouter'].includes(a.provider));
    assigneeSel.innerHTML = internal
      .map((a) => `<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.roleTitle || '')}</option>`)
      .join('');
    if (prev && internal.some((a) => a.id === prev)) assigneeSel.value = prev;
  }
  const missionSel = document.getElementById('routine-mission');
  if (missionSel) {
    const prev = missionSel.value;
    const ms = state.missions.filter((m) => !m.isRoutineHub);
    missionSel.innerHTML =
      '<option value="">정기 업무 (루틴) 전용 보드</option>' +
      ms.map((m) => `<option value="${esc(m.id)}">${esc(m.title)}${m.githubRepo ? ' · 코드 반영 가능' : ''}</option>`).join('');
    if (prev) missionSel.value = prev;
  }

  const opsEl = document.getElementById('routine-ops-status');
  if (opsEl) {
    const cds = lastAiHealth?.cooldowns || [];
    const wd = state.settings?.opsWatchdog;
    const fmtT = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
    opsEl.innerHTML = `<div class="sheet routine-ops">
        <div class="routine-ops-row"><strong>AI 엔진</strong>${
          cds.length
            ? cds.map((c) => `<span class="badge ${c.daily ? 'badge-red' : 'badge-amber'}" title="${esc(c.reason)}">${esc(c.provider)}${c.model && c.model !== '*' ? ` · ${esc(c.model)}` : ''} ${c.daily ? '오늘 한도 소진 · 자정까지 업무 제외(다른 팀원이 대체)' : `휴식 ~${esc(fmtT(c.until))}`}</span>`).join('')
            : '<span class="badge badge-green">모든 엔진 정상</span>'
        }</div>
        <div class="routine-ops-row"><strong>자동 복구</strong><span>${
          wd ? `5분마다 점검 · 마지막 ${esc(formatTime(wd.lastRunAt))} · ${wd.lastActions?.length ? esc(wd.lastActions.slice(0, 3).join(' / ')) : '조치할 것 없음'}` : '서버 기동 후 곧 시작'
        }</span></div>
      </div>`;
  }

  if (!routines.length) {
    listEl.innerHTML = '<div class="empty-state">등록된 루틴이 없습니다. 오른쪽 위 "루틴 추가"로 정기 업무를 만들어 보세요.</div>';
    return;
  }
  listEl.innerHTML = routines
    .map((r) => {
      const task = r.lastTaskId ? state.tasks.find((t) => t.id === r.lastTaskId) : null;
      const [cls, label] = routineStatusBadge(r, task);
      const mission = state.missions.find((m) => m.id === r.missionId);
      const agent = r.assigneeId ? getAgent(r.assigneeId) : null;
      const target =
        r.kind === 'task'
          ? `${mission ? esc(mission.title) : '정기 업무 보드'} · ${agent ? `${esc(displayAgentName(r.assigneeId, r))}${agent.active === false ? ' (휴직 → 실행 시 자동 대체)' : ''}` : '자동 배정'}`
          : '시스템 자동 실행 (AI 한도 사용 안 함)';
      const notifyText = { anomaly: '이상 시 텔레그램', always: '매번 텔레그램', never: '알림 없음' }[r.notify] || '';
      return `<div class="sheet routine-card ${r.enabled ? '' : 'is-off'}">
          <div class="routine-head">
            <div style="min-width:0;">
              <div class="routine-meta">
                <span class="badge badge-neutral">${esc(ROUTINE_KIND_LABELS[r.kind] || r.kind)}</span>
                <span class="badge ${cls}">${esc(label)}</span>
                ${r.enabled ? '' : '<span class="badge badge-neutral">꺼짐</span>'}
              </div>
              <h3 class="routine-title">${esc(r.title)}</h3>
              <div class="routine-sub">${esc(routineScheduleText(r))} · ${target} · ${esc(notifyText)}</div>
            </div>
            <div class="routine-actions">
              <button type="button" class="btn btn-ghost btn-sm" data-routine-run="${esc(r.id)}">지금 실행</button>
              <button type="button" class="btn btn-ghost btn-sm" data-routine-toggle="${esc(r.id)}">${r.enabled ? '끄기' : '켜기'}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-routine-delete="${esc(r.id)}">삭제</button>
            </div>
          </div>
          ${r.description ? `<p class="routine-desc">${esc(r.description)}</p>` : ''}
          ${
            r.lastRunAt
              ? `<details class="routine-result">
                  <summary>마지막 실행 ${esc(formatTime(r.lastRunAt))} · 누적 ${Number(r.runCount) || 0}회</summary>
                  <div class="markdown-body">${renderMarkdown(r.lastResult || '')}</div>
                  ${task ? `<button type="button" class="btn-inline-edit" data-routine-open-task="${esc(task.id)}">업무 결과 보기 →</button>` : ''}
                </details>`
              : '<div class="routine-sub" style="margin-top:8px;">아직 실행 기록이 없습니다.</div>'
          }
        </div>`;
    })
    .join('');
}

function applyStateKeepingHealth(nextState) {
  const health = state?.aiHealth || lastAiHealth;
  const routing = nextState?.outsourcingRouting || state?.outsourcingRouting || lastOutRouting;
  state = nextState;
  if (!state.aiHealth && health) state.aiHealth = health;
  if (!state.outsourcingRouting && routing) state.outsourcingRouting = routing;
}

function renderRosterView() {
  // 폐지(retired)된 팀원은 조직도에서 완전히 뺌, 휴직(비활성)은 따로 묶음
  const all = state.agents.filter((a) => !a.retired);
  const onLeave = all.filter((a) => !a.active);
  const working = all.filter((a) => a.active);
  const leadDeskOn = state.settings?.leadDesk?.enabled !== false;
  const apiLead = working.find((a) => a.tier === 'lead');
  const members = working.filter((a) => a.tier !== 'lead');
  const modeDot = (m) => (m === 'api' || m === 'litellm' ? 'dot-green' : m === 'mcp' ? 'dot-blue' : 'dot-amber');

  // 팀장 = 팀장 업무함 (주간 AGY 팀장 감시기 · 야간 Gemini 앱 당직 · 비상 Gemini API 대기)
  const seen = (k) => state?.agentConnections?.[k]?.lastSeenAt || '';
  const agyAt = seen('lead:agy_lead');
  const gemAt = seen('lead:gemini_app');
  const agyOn = agyAt && Date.now() - Date.parse(agyAt) < 3 * 60 * 1000;
  const gemOn = Boolean(gemAt && Date.now() - Date.parse(gemAt) < 90 * 60 * 1000);
  const dutyName = agyOn ? 'AGY (Hydrogen)' : 'Gemini 앱 당직';
  const ago = (iso) => (iso ? formatTime(iso) : '기록 없음');
  const isStandbyLead = (ag) => leadDeskOn && ag.tier === 'lead' && ag.active;

  const renderNodePill = (ag) => {
    const standby = isStandbyLead(ag);
    return `<button type="button" class="org-node-pill ${ag.active && !standby ? '' : 'inactive'}" data-focus-agent="${esc(ag.id)}">
    <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
    <div style="text-align:left;">
      <div class="org-node-name">${esc(ag.name)}</div>
      <div class="org-node-role">${standby ? '비상 대기 · 평소 미투입' : ag.tier === 'lead' ? '총괄 팀장 · API' : `${esc(COST_LABELS[ag.costTier])} · ${esc(MODE_LABELS[ag.connectionMode])}`}</div>
    </div>
    <i class="dot ${!ag.active || standby ? 'dot-amber' : modeDot(ag.connectionMode)}"></i>
  </button>`;
  };
  const agyLeadPill = `<div class="org-node-pill ${agyOn ? '' : 'inactive'}">
    <span class="agent-avatar sm" style="background:#0E6245">AG</span>
    <div style="text-align:left;">
      <div class="org-node-name">${agyOn ? '총괄 팀장 · AGY (Hydrogen)' : '주간 팀장 대기 · AGY (Hydrogen)'}</div>
      <div class="org-node-role">${agyOn ? '주간 근무 중 · 30초 감시' : '오프라인 대기 (PC 꺼짐)'}</div>
    </div>
    <i class="dot ${agyOn ? 'dot-green' : 'dot-amber'}"></i>
  </div>`;
  const geminiLeadPill = `<div class="org-node-pill ${agyOn ? 'inactive' : ''}">
    <span class="agent-avatar sm" style="background:#2563EB">GM</span>
    <div style="text-align:left;">
      <div class="org-node-name">${agyOn ? '당직 대기 · Gemini 앱' : '총괄 팀장 · Gemini 앱'}</div>
      <div class="org-node-role">${agyOn ? `야간·자리비움 대기 · 마지막 ${esc(ago(gemAt))}` : '야간 당직 근무 중 · 매시간'}</div>
    </div>
    <i class="dot ${!agyOn || gemOn ? 'dot-blue' : 'dot-amber'}"></i>
  </div>`;
  const leadPills = agyOn ? `${agyLeadPill}${geminiLeadPill}` : `${geminiLeadPill}${agyLeadPill}`;

  const treeCanvas = document.getElementById('org-tree-canvas');
  treeCanvas.innerHTML = `
    <div class="org-level">
      <div class="org-node-pill ceo-node">
        <span class="ceo-avatar" style="width:26px;height:26px;font-size:10px;">CEO</span>
        <div>
          <div class="org-node-name">${esc(state.settings.ceoName || '대표님')}</div>
          <div class="org-node-role">최종 지시 · 결재권자</div>
        </div>
      </div>
    </div>
    <div class="org-connector"></div>
    <div class="org-level">${leadDeskOn ? leadPills : apiLead ? renderNodePill(apiLead) : leadPills}</div>
    <div class="org-connector"></div>
    <div class="org-level">
      ${members.map(renderNodePill).join('')}
    </div>
    ${
      leadDeskOn && apiLead
        ? `<div class="org-level" style="margin-top:14px;opacity:.85;">
             <span class="badge badge-amber" style="align-self:center;">비상 대기</span>
             ${renderNodePill(apiLead)}
           </div>`
        : ''
    }
    ${
      onLeave.length
        ? `<div class="org-level" style="margin-top:14px;opacity:.75;">
             <span class="badge badge-neutral" style="align-self:center;">휴직</span>
             ${onLeave.map(renderNodePill).join('')}
           </div>`
        : ''
    }
  `;

  // Tier Cards
  const renderAgentCard = (ag) => {
    const standby = isStandbyLead(ag);
    const badgeCls = standby ? 'badge-amber' : ag.costTier === 'free' ? 'badge-green' : ag.costTier === 'freemium' ? 'badge-blue' : 'badge-amber';
    const badgeTxt = standby ? '비상 대기' : COST_LABELS[ag.costTier];
    const roleTxt = standby
      ? '비상 대기 모드 · 평소 실무 미배정 (AGY·Gemini 앱이 모두 처리 못 하거나 회의실 즉답 시에만 자동 개입)'
      : ag.tier === 'lead'
        ? '비상 대체 팀장 (휴직 중 — 완전 미사용)'
        : ag.roleTitle;
    return `
    <article class="agent-card ${ag.active && !standby ? '' : 'inactive'} ${highlightedAgentId === ag.id ? 'highlight' : ''}" id="agent-card-${esc(ag.id)}">
      <div class="agent-card-head">
        <div class="agent-identity">
          <span class="agent-avatar lg" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
          <div>
            <div class="agent-name">${esc(ag.name)}</div>
            <div class="agent-role">${esc(roleTxt)}</div>
          </div>
        </div>
        <span class="badge ${badgeCls}">
          ${esc(badgeTxt)}
        </span>
      </div>

      <p class="agent-strengths">${esc(ag.strengths)}</p>

      <div class="agent-card-controls">
        <select data-agent-mode="${esc(ag.id)}" aria-label="${esc(ag.name)} 연동 방식" style="width:auto;padding:5px 8px;font-size:12px;">
          <option value="api" ${ag.connectionMode === 'api' ? 'selected' : ''}>API 자동</option>
          <option value="mcp" ${ag.connectionMode === 'mcp' ? 'selected' : ''}>MCP</option>
          <option value="bridge" ${ag.connectionMode === 'bridge' ? 'selected' : ''}>앱·구독</option>
        </select>
        <button type="button" class="btn btn-ghost btn-sm" data-toggle-agent="${esc(ag.id)}">
          ${standby ? '완전 휴직' : ag.active ? '휴직' : '복직'}
        </button>
      </div>
    </article>
  `;
  };
  const leadDeskCard = `
    <article class="agent-card">
      <div class="agent-card-head">
        <div class="agent-identity">
          <span class="agent-avatar lg" style="background:${agyOn ? '#0E6245' : '#2563EB'}">${agyOn ? 'AG' : '팀장'}</span>
          <div>
            <div class="agent-name">총괄 팀장 (팀장 업무함)</div>
            <div class="agent-role">지금 근무: <strong>${esc(dutyName)}</strong></div>
          </div>
        </div>
        <span class="badge ${agyOn ? 'badge-green' : 'badge-blue'}">${agyOn ? '주간 근무' : '야간 당직'}</span>
      </div>
      <p class="agent-strengths">검수 · 작전 계획 · 마일스톤 판단을 지금 깨어 있는 팀장이 맡습니다.</p>
      <div class="routine-sub" style="line-height:1.7;">
        1. 주간: AGY 팀장 감시기 (Hydrogen) · 마지막 접속 ${esc(ago(agyAt))}<br />
        2. 야간·부재: Gemini 앱 예약 작업 · 마지막 실행 ${esc(ago(gemAt))}<br />
        3. 비상 대기: Gemini 4 Hydrogen API (${apiLead ? '대기 중 · 위 둘이 처리 못 할 때만 자동 개입' : '완전 휴직 중'})
      </div>
    </article>`;

  const tiers = [
    { el: document.getElementById('roster-leads'), html: leadDeskCard + (apiLead ? renderAgentCard(apiLead) : '') },
    { el: document.getElementById('roster-specialists'), list: members.filter((a) => a.tier === 'specialist') },
    { el: document.getElementById('roster-executors'), list: members.filter((a) => a.tier === 'executor') },
    { el: document.getElementById('roster-leave'), list: onLeave }
  ];

  for (const t of tiers) {
    if (!t.el) continue;
    t.el.innerHTML = t.html ?? (t.list.length ? t.list.map(renderAgentCard).join('') : '<div class="empty-state">없음</div>');
  }
}

// ---- CEO 전역 지침 · 팀장 능동 추진 · 회사 기억 ----
const MEMORY_KIND_LABEL = { directive: 'CEO 지시', decision: 'CEO 결정', result: '실행 결과', lesson: '교훈', note: '메모' };
function renderLeadEngineSettings() {
  const s = state.settings || {};
  const le = s.leadEngine || {};
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = v;
  };
  const setChk = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(v);
  };
  setVal('set-global-directives', s.globalDirectives || '');
  setChk('set-lead-enabled', le.enabled !== false);
  setChk('set-lead-autofollow', le.autoFollowUp !== false);

  // 텔레그램 알림 종류·방해금지
  const nt = s.telegram?.notify || {};
  const nq = nt.quiet || {};
  setChk('tg-notify-reports', nt.reports !== false);
  setChk('tg-notify-approvals', nt.approvals !== false);
  setChk('tg-notify-alerts', nt.alerts !== false);
  setChk('tg-quiet-enabled', nq.enabled);
  setVal('tg-quiet-start', nq.start || '23:00');
  setVal('tg-quiet-end', nq.end || '08:00');
  setChk('tg-quiet-urgent', nq.allowUrgent);

  renderSkillsSettings();
  setVal('set-lead-maxrounds', le.maxAutoRounds ?? 2);
  setVal('set-lead-interval', le.followUpMinutes ?? 30);

  const list = document.getElementById('memory-list');
  if (!list) return;
  const missionTitle = Object.fromEntries((state.missions || []).map((m) => [m.id, m.title]));
  const facts = (state.memory?.facts || []).slice(0, 40);
  list.innerHTML = facts.length
    ? facts
        .map(
          (f) => `<li style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(0,0,0,.06);">
      <span style="flex:1;font-size:13px;line-height:1.45;">${f.pinned ? '📌 ' : ''}<b>${esc(MEMORY_KIND_LABEL[f.kind] || '메모')}</b>${
        f.missionId && missionTitle[f.missionId] ? ` · ${esc(missionTitle[f.missionId])}` : ''
      } · ${esc(new Date(f.createdAt).toLocaleString('ko-KR'))}<br />${esc(f.text)}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-forget-memory="${esc(f.id)}">삭제</button>
    </li>`
        )
        .join('')
    : '<li class="field-label">아직 쌓인 기억이 없습니다.</li>';
}

// ---- AI 스킬 · 품질 검수 ----
let skillCatalog = null;
let skillCatalogLoading = false;
async function loadSkillCatalog(force = false) {
  if (skillCatalogLoading || (skillCatalog && !force)) return skillCatalog;
  skillCatalogLoading = true;
  try {
    skillCatalog = await api('/api/skills');
  } catch {
    skillCatalog = { builtin: [], custom: [] }; // 서버 없이 열린 경우 반복 요청 방지
  } finally {
    skillCatalogLoading = false;
  }
  renderSkillsSettings();
  return skillCatalog;
}

function renderSkillsSettings() {
  const list = document.getElementById('skills-list');
  if (!list) return;
  const cfg = state.settings?.skills || {};
  const en = document.getElementById('skills-enabled');
  if (en) en.checked = cfg.enabled !== false;
  const rm = document.getElementById('skills-review-mode');
  if (rm && document.activeElement !== rm) rm.value = cfg.reviewMode || 'important';
  const ms = document.getElementById('skills-min-score');
  if (ms && document.activeElement !== ms) ms.value = cfg.minScore ?? 8;
  if (!skillCatalog) {
    list.innerHTML = '<li class="field-label">스킬 목록을 불러오는 중…</li>';
    loadSkillCatalog();
    return;
  }
  const disabled = new Set(cfg.disabled || []);
  const builtin = skillCatalog.builtin
    .map(
      (s) => `<li style="padding:5px 0;border-bottom:1px solid rgba(0,0,0,.06);"><label class="checkbox-row" style="align-items:flex-start;">
      <input type="checkbox" data-skill-toggle="${esc(s.id)}" ${disabled.has(s.id) ? '' : 'checked'} ${s.always ? 'disabled' : ''} />
      <span><b>${esc(s.name)}</b>${s.always ? ' · 항상 적용' : ''}${s.important ? ' · 교차 검수 대상' : ''}<br /><span class="field-label">${esc(s.summary)}</span></span>
    </label></li>`
    )
    .join('');
  const custom = (cfg.custom || skillCatalog.custom || [])
    .map(
      (s) => `<li style="display:flex;gap:8px;padding:5px 0;border-bottom:1px solid rgba(0,0,0,.06);"><span style="flex:1;">🛠️ <b>${esc(s.name)}</b> <span class="field-label">${esc(s.keywords ? `키워드: ${s.keywords}` : '항상 적용')}</span><br /><span class="field-label">${esc(String(s.instructions || '').slice(0, 140))}</span></span>
      <button type="button" class="btn btn-ghost btn-sm" data-skill-delete="${esc(s.id)}">삭제</button></li>`
    )
    .join('');
  list.innerHTML = builtin + custom;
}

function readSkillSettingsFromForm() {
  const disabled = [...document.querySelectorAll('[data-skill-toggle]')].filter((el) => !el.checked && !el.disabled).map((el) => el.dataset.skillToggle);
  return {
    enabled: document.getElementById('skills-enabled')?.checked !== false,
    reviewMode: document.getElementById('skills-review-mode')?.value || 'important',
    minScore: Number(document.getElementById('skills-min-score')?.value || 8),
    disabled
  };
}

function renderIntegrationsView() {
  const s = state.settings;
  document.getElementById('set-company-name').value = s.companyName || '';
  document.getElementById('set-ceo-name').value = s.ceoName || '';
  renderLeadEngineSettings();

  const p = s.providers || {};
  const modelGeminiEl = document.getElementById('model-gemini');
  if (modelGeminiEl) {
    const saved = p.gemini?.freeModel || 'gemini-4-hydrogen';
    const targetVal = saved === 'gemini-2.5-flash' ? 'gemini-4-hydrogen' : saved;
    const hasOpt = Array.from(modelGeminiEl.options).some((o) => o.value === targetVal);
    modelGeminiEl.value = hasOpt ? targetVal : 'gemini-4-hydrogen';
  }
  const modelGroqEl = document.getElementById('model-groq');
  if (modelGroqEl) {
    const savedGroq = p.groq?.model || 'openai/gpt-oss-120b';
    const hasGroqOpt = Array.from(modelGroqEl.options).some((o) => o.value === savedGroq);
    modelGroqEl.value = hasGroqOpt ? savedGroq : 'openai/gpt-oss-120b';
  }
  const modelOrEl = document.getElementById('model-openrouter');
  if (modelOrEl) {
    const savedOr = p.openrouter?.model || 'openrouter/free';
    const hasOrOpt = Array.from(modelOrEl.options).some((o) => o.value === savedOr);
    modelOrEl.value = hasOrOpt ? savedOr : 'openrouter/free';
  }
  document.getElementById('model-exaone').value = p.exaone?.model || 'k-exaone_v2.5';
  const repoGhEl = document.getElementById('repo-github');
  if (repoGhEl) repoGhEl.value = p.githubRepo?.repo || 'alpinu83/ai-ceo-hub';
  const allowedGhEl = document.getElementById('allowed-repos-github');
  if (allowedGhEl) {
    allowedGhEl.value =
      p.githubRepo?.allowedRepos || 'alpinu83/ai-ceo-hub, alpinu83/kr-calc-hub, alpinu83/alpinu83.github.io';
  }

  setKeyStatus('status-gemini', p.gemini);
  setKeyStatus('status-gemini-quick', p.gemini);
  setKeyStatus('status-groq', p.groq);
  setKeyStatus('status-groq-quick', p.groq);
  setKeyStatus('status-openrouter', p.openrouter);
  setKeyStatus('status-openrouter-quick', p.openrouter);
  setKeyStatus('status-exaone', p.exaone);
  setKeyStatus('status-exaone-quick', p.exaone);
  setKeyStatus('status-github', p.githubRepo);
  {
    const gd = p.googleData || {};
    const gdEl = document.getElementById('status-googledata');
    if (gdEl) {
      gdEl.textContent = gd.hasApiKey ? `키 등록됨${gd.ga4PropertyId ? ` · GA4 ${gd.ga4PropertyId}` : ''}${gd.searchConsoleSite ? ' · 서치콘솔' : ''}` : '미연결';
      gdEl.classList.toggle('ok', Boolean(gd.hasApiKey));
    }
    const gaIdEl = document.getElementById('ga4-property-id');
    if (gaIdEl && document.activeElement !== gaIdEl) gaIdEl.value = gd.ga4PropertyId || '';
    const scEl = document.getElementById('sc-site');
    if (scEl && document.activeElement !== scEl) scEl.value = gd.searchConsoleSite || '';
  }
  setKeyStatus('status-github-quick', p.githubRepo);

  // Live server + Gist cloud sync status
  const syncEl = document.getElementById('status-sync-live');
  if (syncEl) {
    const cb = state.cloudBackup || {};
    if (runtimeMode === 'server') {
      syncEl.textContent = cb.enabled
        ? `Render + 암호화 Gist 동기화됨 (${formatRelativeTime(cb.lastSyncAt)})`
        : 'Render 서버 연결됨 (Gist 미설정)';
      syncEl.classList.add('ok');
    } else {
      syncEl.textContent = '로컬 단독 모드 (동기화 불가)';
      syncEl.classList.remove('ok');
    }
  }

  // Real live heartbeats for external bots (Muse / Pickle / Cue)
  const conns = state.agentConnections || {};
  const setConnBadge = (elId, agentId) => {
    const el = document.getElementById(elId);
    if (!el) return;
    const info = conns[agentId];
    if (info?.lastSeenAt) {
      el.textContent = `통신됨 (${formatRelativeTime(info.lastSeenAt)})`;
      el.className = 'badge badge-green';
    } else {
      el.textContent = '통신 기록 없음';
      el.className = 'badge badge-neutral';
    }
  };
  setConnBadge('status-muse-live', 'agent_muse');
  setConnBadge('status-pickle-live', 'agent_pickle');
  setConnBadge('status-cue-live', 'agent_cue');
  setConnBadge('status-instinct-live', 'agent_instinct');

  const tg = s.telegram || {};
  document.getElementById('tg-chat-id').value = tg.chatId || '';
  document.getElementById('tg-polling-enabled').checked = Boolean(tg.pollingEnabled);
  for (const tgId of ['status-telegram', 'status-telegram-quick']) {
    const tgStatus = document.getElementById(tgId);
    if (!tgStatus) continue;
    if (tg.hasBotToken) {
      tgStatus.textContent = `연결됨 (${tg.botTokenPreview})`;
      tgStatus.classList.add('ok');
    } else {
      tgStatus.textContent = '미연결';
      tgStatus.classList.remove('ok');
    }
  }

  selectConfigAgent(currentConfigAgent);
  refreshPushUi().catch(() => {});
}

let currentConfigAgent = 'gemini';

const BRIDGE_AGENT_META = {
  pickle: { title: '피클 (알렉스) 연결 설정', inboxKey: 'pickle' },
  vooy: { title: '부이 (vooy) 연결 설정', inboxKey: 'vooy' },
  instinct: { title: '인스팅스 (Instinct) 연결 설정', inboxKey: 'instinct' },
  muse: { title: 'Meta Muse 연결 설정', inboxKey: 'muse' },
  cue: { title: 'Manus Cue 연결 설정', inboxKey: 'cue' }
};

function selectConfigAgent(agentKey = 'gemini') {
  if (agentKey === 'claude') agentKey = 'gemini';
  currentConfigAgent = agentKey;
  document.querySelectorAll('[data-config-agent]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.configAgent === agentKey);
  });

  const formPanels = ['gemini', 'groq', 'openrouter', 'exaone', 'github', 'telegram'];
  const isFormPanel = formPanels.includes(agentKey);
  formPanels.forEach((key) => {
    document.getElementById(`agent-panel-${key}`)?.classList.toggle('active', agentKey === key);
  });
  document.getElementById('agent-panel-bridge')?.classList.toggle('active', !isFormPanel);

  if (!isFormPanel && state?.settings) {
    currentMcpTab = agentKey;
    const meta = BRIDGE_AGENT_META[agentKey] || { title: '연결 설정', inboxKey: 'pickle' };
    const titleEl = document.getElementById('bridge-agent-title');
    if (titleEl) titleEl.textContent = meta.title;

    const origin = getPublicServerOrigin();
    const isInboxPrimary = ['pickle', 'vooy', 'instinct'].includes(agentKey);
    const endpoint = `${origin}/api/mcp`;
    const displayUrl = isInboxPrimary
      ? `${origin}/api/agent-inbox/${agentKey}`
      : endpoint;
    const urlEl = document.getElementById('mcp-endpoint-url');
    if (urlEl) urlEl.textContent = displayUrl;
    const tokEl = document.getElementById('mcp-token-value');
    if (tokEl) tokEl.textContent = `Bearer ${state.settings.mcpToken || ''}`;
    renderMcpSnippet(endpoint, state.settings.mcpToken || '');

    const inboxBtn = document.getElementById('btn-test-pickle-inbox');
    if (inboxBtn) {
      const labelMap = { pickle: '피클', vooy: '부이', instinct: '인스팅스', muse: 'Muse', cue: 'Cue' };
      inboxBtn.textContent = `${labelMap[agentKey] || agentKey} 연결 상태 확인`;
      inboxBtn.dataset.testInboxKey = meta.inboxKey;
      inboxBtn.style.display = '';
    }
  }
}

function setKeyStatus(elId, providerObj) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (providerObj?.hasApiKey) {
    el.textContent = `연결됨 (${providerObj.apiKeyPreview})`;
    el.classList.add('ok');
  } else {
    el.textContent = '미연결';
    el.classList.remove('ok');
  }
}

function buildAsyncAgentPrompt(agentKey, label, origin, token) {
  const getUrl = `${origin}/api/agent-inbox/${agentKey}?token=${token}&format=text`;
  const postUrl = `${origin}/api/agent-inbox/${agentKey}/reply?token=${token}`;
  return `# [${label}] 앱 채팅창에 아래 명령을 그대로 붙여넣으세요!
# (정기 스케줄을 걸어두면 자동으로 확인·보고합니다)

지금 바로 아래 공개 HTTPS API에 GET 요청해서 나(${label})에게 배정된 업무와 최근 #전사-회의실 대화를 읽어와 줘:
${getUrl}

읽어온 뒤:
1. 새 업무나 내가 대답할 내용이 있으면 처리해 줘. (단, 실제 예약 확정·결제·송금은 절대 자동 실행하지 말고 반드시 멈춰!)
2. 처리 결과나 회의실 답변을 아래 URL로 POST (Content-Type: application/json) 해 줘:
${postUrl}

POST JSON 형식:
{
  "message": "회의실에 남길 내 핵심 보고 (2~3문장)",
  "taskId": "GET으로 받은 업무 id (있을 때)",
  "deliverable": "조사·전화 확인 상세 결과",
  "requestApproval": true,
  "estimatedCostKRW": 0
}`;
}

function renderMcpSnippet(endpoint, token) {
  const origin = endpoint.replace(/\/api\/mcp$/, '');
  const snippets = {
    pickle: buildAsyncAgentPrompt('pickle', '피클(알렉스)', origin, token),
    vooy: buildAsyncAgentPrompt('vooy', '부이(vooy)', origin, token),
    instinct: buildAsyncAgentPrompt('instinct', '인스팅스(Instinct)', origin, token),
    muse: `# Meta Muse 채팅창에 아래처럼 말해서 커스텀 커넥터 추가:
Add CEO Office as a custom connector. The server URL is ${endpoint}

# API Key 입력 창이 뜨면 아래 값만 붙여넣기:
${token}

# 연결 후 Muse 채팅창 테스트:
"CEO Office MCP(list_my_tasks)에서 내게 배정된 업무를 가져와 처리하고 보고해줘."`,
    cue: `# Manus / Cue → Settings → Connectors → Custom MCP → + Add custom MCP → Direct configuration
Transport: HTTP
Server URL: ${endpoint}
Header Name: Authorization
Header Value: Bearer ${token}

# 제공되는 공식 MCP 도구 (@modelcontextprotocol/sdk):
- get_company_brief
- list_my_tasks (agent_id: "agent_cue")
- submit_task_result
- request_ceo_approval`,
    gemini: `# Gemini 웹 (gemini.google.com) → Settings → Connected Apps → Add a custom app
MCP Server URL:
${endpoint}

# 또는 Gemini CLI (PC 터미널):
gemini mcp add ceo-office-hub --transport http ${endpoint} --header "Authorization: Bearer ${token}"`
  };
  document.getElementById('mcp-snippet-box').textContent = snippets[currentMcpTab] || snippets.pickle;
}

function renderTaskDrawer(task) {
  const ag = getAgent(task.assigneeId) || state.agents[0];
  const cueEmail = state.settings?.providers?.manus?.cueEmail || '';
  const isAsyncPullAgent = ['pickle', 'vooy', 'instinct'].includes(ag.provider);
  const asyncAgentKey = ag.provider === 'pickle' ? 'pickle' : ag.provider === 'vooy' ? 'vooy' : 'instinct';
  const displayAgName = displayAgentName(task.assigneeId, task);
  document.getElementById('drawer-agent-meta').textContent = `${displayAgName} · ${MODE_LABELS[ag.connectionMode]} · ${COST_LABELS[ag.costTier]}`;
  document.getElementById('drawer-title').textContent = task.title;

  const mailtoLink =
    ag.provider === 'manus' && cueEmail
      ? `mailto:${encodeURIComponent(cueEmail)}?subject=${encodeURIComponent(`[CEO 지시] ${task.title}`)}&body=${encodeURIComponent(task.dispatchPrompt)}`
      : '';

  document.getElementById('drawer-body').innerHTML = `
    <div class="drawer-section">
      <h3>1. ${esc(displayAgName)} 전달용 맞춤 지시서</h3>
      <p class="form-hint">${esc(ag.bridgeGuide)}</p>
      <div class="prompt-box">${esc(task.dispatchPrompt)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${
          isAsyncPullAgent
            ? `<button type="button" class="btn btn-primary btn-sm" id="btn-copy-async-pull" data-async-key="${esc(asyncAgentKey)}" data-async-label="${esc(ag.name)}">${esc(ag.name)} API 수신함 호출 명령 복사</button>`
            : ''
        }
        <button type="button" class="btn ${isAsyncPullAgent ? 'btn-ghost' : 'btn-primary'} btn-sm" id="btn-copy-dispatch">지시서 복사</button>
        ${typeof navigator !== 'undefined' && navigator.share ? `<button type="button" class="btn btn-ghost btn-sm" id="btn-share-dispatch">모바일 바로 공유</button>` : ''}
        ${ag.appUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(ag.appUrl)}" target="_blank" rel="noreferrer">${esc(ag.name)} 열기 ↗</a>` : ''}
        ${mailtoLink ? `<a class="btn btn-ghost btn-sm" href="${mailtoLink}">Cue 전용 이메일 발송</a>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-run-task="${esc(task.id)}">
          ${ag.connectionMode === 'api' || ag.connectionMode === 'litellm' ? '자동 실행' : '미리보기'}
        </button>
      </div>
    </div>

    ${
      task.output
        ? `<div class="drawer-section">
            <h3>기록된 실행 결과 (Marked GFM 렌더링)</h3>
            <div class="sheet" style="padding:14px 16px;box-shadow:none;background:var(--bg-subtle);">
              <div class="markdown-body">${renderMarkdown(task.output)}</div>
            </div>
          </div>`
        : ''
    }

    <div class="drawer-section">
      <h3>2. 외부 앱 · 월정액 구독 결과 붙여넣기 보고</h3>
      <p class="form-hint">피클, 부이, 인스팅스, Muse, Cue 등에서 받은 결과를 붙여넣으면 팀장 종합 보고와 결재함에 즉시 반영됩니다.</p>
      <form id="bridge-report-form" class="directive-form">
        <label class="field">
          <span class="field-label">실행 결과 내용 (마크다운 지원)</span>
          <textarea id="bridge-report-output" rows="5" placeholder="AI 앱에서 받은 조사 결과, 예약 후보, 초안을 그대로 붙여넣으세요..." required>${esc(task.output || '')}</textarea>
        </label>
        <div class="form-row-two">
          <label class="field">
            <span class="field-label">예상 비용 / 결제 금액 (원)</span>
            <input type="number" id="bridge-report-cost" min="0" step="1000" value="${Number(task.estimatedCostKRW) || 0}" />
          </label>
          <label class="field">
            <span class="field-label">결재 요청 요약 (상신 시)</span>
            <input type="text" id="bridge-approval-reason" placeholder="예: 예약금 4만원 결제 전 승인 요청" />
          </label>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="bridge-request-approval" ${task.requiresApproval ? 'checked' : ''} />
          <span>완료 대신 <strong>CEO 결재함</strong>에 상신하기 (예약 확정 · 결제 · 외부 발송 전)</span>
        </label>
        <div class="form-actions">
          <span></span>
          <button type="submit" class="btn btn-primary">결과 등록 및 반영</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('btn-copy-dispatch').addEventListener('click', () => {
    copyText(task.dispatchPrompt, `${ag.name}용 맞춤 지시서를 복사했습니다.`);
  });

  document.getElementById('btn-copy-async-pull')?.addEventListener('click', (ev) => {
    const btn = ev.currentTarget;
    const prompt = buildAsyncAgentPrompt(
      btn.dataset.asyncKey || 'pickle',
      btn.dataset.asyncLabel || ag.name,
      getPublicServerOrigin(),
      state.settings?.mcpToken || ''
    );
    copyText(prompt, `${ag.name} 앱에 붙여넣을 HTTPS 수신함 호출 명령을 복사했습니다!`);
  });

  document.getElementById('btn-share-dispatch')?.addEventListener('click', async () => {
    try {
      await navigator.share({
        title: `[CEO Office] ${task.title}`,
        text: isAsyncPullAgent
          ? buildAsyncAgentPrompt(asyncAgentKey, ag.name, getPublicServerOrigin(), state.settings?.mcpToken || '')
          : task.dispatchPrompt
      });
    } catch {
      // user canceled share sheet
    }
  });

  document.getElementById('bridge-report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const output = document.getElementById('bridge-report-output').value.trim();
    const estimatedCostKRW = Number(document.getElementById('bridge-report-cost').value) || 0;
    const approvalReason = document.getElementById('bridge-approval-reason').value.trim();
    const requestApproval = document.getElementById('bridge-request-approval').checked;
    try {
      const res = await api(`/api/tasks/${task.id}/report`, {
        method: 'POST',
        body: JSON.stringify({ output, estimatedCostKRW, approvalReason, requestApproval })
      });
      state = res.state;
      renderAll();
      toast(requestApproval ? '결과를 등록하고 CEO 결재함에 상신했습니다.' : '업무 결과를 완료 보고했습니다.');
      closeDrawer();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

function openDrawer(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  openDrawerTaskId = taskId;
  renderTaskDrawer(task);
  const backdrop = document.getElementById('task-drawer-backdrop');
  backdrop.classList.add('open');
  backdrop.setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  openDrawerTaskId = null;
  const backdrop = document.getElementById('task-drawer-backdrop');
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden', 'true');
}

function closeMobileSidebar() {
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebar-backdrop')?.classList.remove('open');
}

function closeParticipantsDrawer() {
  document.getElementById('office-participants-panel')?.classList.remove('open');
  document.getElementById('participants-backdrop')?.classList.remove('open');
}

function setOfficeMobileTab() {
  closeParticipantsDrawer();
}

/* ==================== 모바일 뒤로가기: 앱 안에서 이동 · 마지막엔 종료 확인 ==================== */
// 휴대폰 웹앱(홈 화면에 추가)에서 뒤로가기를 누르면 바로 앱이 닫히던 문제:
// 화면 이동을 브라우저 기록에 남겨 뒤로가기 = 이전 화면, 열린 창(작업 상세·메뉴·팝업)은 먼저 닫고,
// 홈에서 한 번 더 누르면 "종료하시겠습니까?"를 묻습니다.
let backNavArmed = false;
let backNavSilent = false;
let exitConfirmOpen = false;

function closeTopOverlay() {
  if (document.getElementById('usage-modal-backdrop')?.classList.contains('open')) {
    closeUsageModal();
    return true;
  }
  const hire = document.getElementById('hire-modal-backdrop');
  if (hire?.classList.contains('open')) {
    hire.classList.remove('open');
    hire.setAttribute('aria-hidden', 'true');
    return true;
  }
  if (document.getElementById('task-drawer-backdrop')?.classList.contains('open')) {
    closeDrawer();
    return true;
  }
  if (document.querySelector('.sidebar')?.classList.contains('mobile-open')) {
    closeMobileSidebar();
    return true;
  }
  if (document.getElementById('office-participants-panel')?.classList.contains('open')) {
    closeParticipantsDrawer();
    return true;
  }
  return false;
}

function pushViewHistory(viewName) {
  if (!backNavArmed || backNavSilent) return;
  if (history.state?.ceoView === viewName && !history.state?.root) return;
  history.pushState({ ceoView: viewName }, '');
}

// Chrome(안드로이드)은 사용자 동작 없이 넣은 기록을 뒤로가기에서 건너뛰므로, 첫 터치 때 기록을 준비합니다.
function armBackNav() {
  if (backNavArmed) return;
  backNavArmed = true;
  history.replaceState({ ceoView: 'command', root: true }, '');
  history.pushState({ ceoView: currentView || 'command' }, '');
}

function showViewSilently(viewName) {
  backNavSilent = true;
  try {
    switchView(viewName);
  } finally {
    backNavSilent = false;
  }
}

window.addEventListener('popstate', (e) => {
  if (!backNavArmed) return;
  const st = e.state || {};
  // 1) 열린 창이 있으면 그것만 닫고 현재 화면 유지
  if (closeTopOverlay()) {
    history.pushState({ ceoView: currentView }, '');
    return;
  }
  // 2) 이전 화면으로
  if (st.ceoView && !st.root) {
    showViewSilently(st.ceoView);
    return;
  }
  // 3) 맨 처음 기록에 도달: 홈이 아니면 홈으로, 홈이면 종료 확인
  if (currentView !== 'command') {
    showViewSilently('command');
    history.pushState({ ceoView: 'command' }, '');
    return;
  }
  if (exitConfirmOpen) return;
  exitConfirmOpen = true;
  const leave = window.confirm('CEO Office를 종료하시겠습니까?');
  exitConfirmOpen = false;
  if (!leave) {
    history.pushState({ ceoView: 'command' }, '');
    return;
  }
  backNavArmed = false;
  // 홈 화면 앱(standalone)은 창 닫기를 시도하고, 닫히지 않으면 한 번 더 뒤로가기로 종료
  try {
    window.close();
  } catch {
    // ignore
  }
  setTimeout(() => toast('한 번 더 뒤로가기를 누르면 종료됩니다.'), 300);
  // 종료하지 않고 계속 쓰면 다음 터치 때 다시 준비
  setTimeout(() => {
    document.addEventListener('pointerdown', armBackNav, { capture: true, once: true });
  }, 3000);
});

document.addEventListener('pointerdown', armBackNav, { capture: true, once: true });
document.addEventListener('keydown', armBackNav, { capture: true, once: true });

function switchView(viewName) {
  const prevView = currentView;
  currentView = viewName;
  if (prevView !== viewName) pushViewHistory(viewName);
  if (viewName === 'projects') missionKindFilter = 'project';
  else if (viewName === 'missions') missionKindFilter = 'one_off';

  const domViewId = viewName === 'projects' ? 'missions' : viewName;
  document.querySelectorAll('.nav-item, .mobile-nav-item, .nav-gear-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.view').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${domViewId}`);
  });
  if (viewName === 'projects' || viewName === 'missions') {
    missionStatusFilter = 'all';
    if (state) renderCommandView();
    refreshIcons();
  }
  closeMobileSidebar();
  closeParticipantsDrawer();
  renderChrome();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function switchHubTab(tabName) {
  currentHubTab = tabName;
  if (tabName === 'outsourcing') setTimeout(() => renderOutsourcingSettings(true), 0);
  document.querySelectorAll('.hub-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.hubTab === tabName);
  });
  document.querySelectorAll('.hub-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `hub-panel-${tabName}`);
  });
}

/* ==================== EVENTS ==================== */

function bindEvents() {
  // Theme toggle
  const savedTheme = localStorage.getItem('ceo_office_theme') || 'paper';
  document.documentElement.setAttribute('data-theme', savedTheme);
  document.getElementById('btn-toggle-theme').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'studio' ? 'paper' : 'studio';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ceo_office_theme', next);
    toast(next === 'studio' ? '다크 테마로 전환했습니다.' : '라이트 테마로 전환했습니다.');
  });

  // 좌측 메뉴 하단 AI 사용량 위젯 (상한 수정·잔여량 기록 팝업)
  bindUsageWidget();

  // 외주 요청별 대상 변경 (select)
  document.getElementById('content-area')?.addEventListener('change', async (e) => {
    const effSel = e.target.closest('[data-out-effort]');
    if (effSel) {
      try {
        const res = await api(`/api/outsourcing/${effSel.dataset.outEffort}/effort`, { method: 'POST', body: JSON.stringify({ effort: effSel.value }) });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast(effSel.value === 'deep' ? '깊은 판단으로 바꿨습니다 (Gemini는 Neon, Antigravity는 Carbon 주도).' : '단순·조사로 바꿨습니다 (Hydrogen 위주).');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const sel = e.target.closest('[data-out-assign]');
    if (!sel) return;
    try {
      const res = await api(`/api/outsourcing/${sel.dataset.outAssign}/assign`, { method: 'POST', body: JSON.stringify({ worker: sel.value }) });
      applyStateKeepingHealth(res.state);
      renderAll();
      refreshIcons();
      toast(sel.value === 'auto' ? '대상을 자동으로 되돌렸습니다.' : sel.value === 'agy_aside' ? '이 요청을 AGY 수정 + Aside 검수로 맡겼습니다.' : `이 요청을 ${OUT_WORKER_LABELS[sel.value]}로 넘겼습니다.`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Routine form
  const routineWrap = document.getElementById('routine-form-wrap');
  document.getElementById('btn-toggle-routine-form')?.addEventListener('click', () => {
    if (!routineWrap) return;
    routineWrap.style.display = routineWrap.style.display === 'none' ? 'block' : 'none';
    if (routineWrap.style.display === 'block') document.getElementById('routine-title')?.focus();
  });
  document.getElementById('btn-cancel-routine')?.addEventListener('click', () => {
    if (routineWrap) routineWrap.style.display = 'none';
  });
  document.getElementById('routine-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const daysVal = document.getElementById('routine-days').value;
    const payload = {
      title: document.getElementById('routine-title').value,
      times: document.getElementById('routine-times').value,
      description: document.getElementById('routine-description').value,
      days: daysVal === 'daily' || daysVal === 'weekdays' ? daysVal : [Number(daysVal)],
      assigneeId: document.getElementById('routine-assignee').value,
      missionId: document.getElementById('routine-mission').value,
      notify: document.getElementById('routine-notify').value,
      kind: 'task'
    };
    try {
      const res = await api('/api/routines', { method: 'POST', body: JSON.stringify(payload) });
      applyStateKeepingHealth(res.state);
      e.target.reset();
      if (routineWrap) routineWrap.style.display = 'none';
      renderAll();
      refreshIcons();
      toast(`루틴 "${res.routine.title}"을(를) 등록했습니다.`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Navigation (Desktop Sidebar + Mobile Bottom Bar + Corner Settings Gear)
  document.querySelectorAll('.nav-item, .mobile-nav-item, .nav-gear-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.querySelectorAll('[data-toggle-group]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const groupKey = btn.dataset.toggleGroup;
      const isOpen = getNavGroupExpanded(groupKey);
      setNavGroupExpanded(groupKey, !isOpen);
    });
  });
  document.querySelector('.nav-list')?.addEventListener('click', (e) => {
    const subBtn = e.target.closest('[data-sidebar-mission]');
    if (!subBtn) return;
    selectedMissionId = subBtn.dataset.sidebarMission;
    officeMissionFilter = subBtn.dataset.sidebarMission;
    const targetView = subBtn.dataset.sidebarView || 'missions';
    switchView(targetView);
  });
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar');
    const isOpen = sidebar.classList.toggle('mobile-open');
    document.getElementById('sidebar-backdrop')?.classList.toggle('open', isOpen);
  });
  document.getElementById('sidebar-backdrop')?.addEventListener('click', closeMobileSidebar);

  // Mobile Participants Slide-Over Drawer
  document.getElementById('btn-toggle-participants')?.addEventListener('click', () => {
    const panel = document.getElementById('office-participants-panel');
    const isOpen = panel?.classList.toggle('open');
    document.getElementById('participants-backdrop')?.classList.toggle('open', Boolean(isOpen));
  });
  document.getElementById('btn-close-participants')?.addEventListener('click', closeParticipantsDrawer);
  document.getElementById('participants-backdrop')?.addEventListener('click', closeParticipantsDrawer);

  // 대표님 To Do 지표: 홈의 To Do List(결재 포함)로 이동
  document.getElementById('kpi-approvals-cell')?.addEventListener('click', () => {
    if (currentView !== 'command') switchView('command');
    document.getElementById('home-ceo-inbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('kpi-missions-cell')?.addEventListener('click', () => switchView('missions'));
  document.getElementById('kpi-budget-cell')?.addEventListener('click', () => switchView('roster'));

  // 상단 "새 지시": 바로 지시 칸으로 이동 (새 업무 만들기는 홈의 버튼으로 펼침)
  document.getElementById('btn-focus-directive').addEventListener('click', () => {
    switchView('command');
    const q = document.getElementById('quick-order-text');
    (q || document.getElementById('input-directive'))?.focus();
    document.getElementById(q ? 'quick-order-sheet' : 'directive-sheet')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Mission view mode (Kanban / List / SVG Flow)
  document.querySelectorAll('[data-mission-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      missionViewMode = btn.dataset.missionMode;
      document.querySelectorAll('[data-mission-mode]').forEach((b) => b.classList.toggle('active', b === btn));
      renderCommandView();
      refreshIcons();
    });
  });

  // Hub tabs
  document.querySelectorAll('[data-hub-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchHubTab(btn.dataset.hubTab));
  });

  // Directive presets
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = PRESETS[btn.dataset.preset];
      if (!preset) return;
      document.getElementById('input-mission-title').value = preset.title;
      document.getElementById('input-mission-domain').value = preset.domain;
      document.getElementById('input-directive').value = preset.directive;
      toast('업무 템플릿을 채웠습니다.');
    });
  });

  // Submit directive (Team Lead decomposes and employees start working automatically!)
  let isSubmittingDirective = false;
  // 새 업무·프로젝트 만들기: 평소엔 접어 둠
  document.getElementById('btn-toggle-new-mission')?.addEventListener('click', () => {
    const sheet = document.getElementById('directive-sheet');
    const btn = document.getElementById('btn-toggle-new-mission');
    if (!sheet) return;
    sheet.hidden = !sheet.hidden;
    if (btn) btn.textContent = sheet.hidden ? '+ 새 업무·프로젝트 만들기' : '− 새 업무 만들기 닫기';
    if (!sheet.hidden) document.getElementById('input-directive')?.focus();
  });

  // 바로 지시: 별도 새 미션을 만들지 않고 전체 시스템 지침 또는 선택한 기존 업무·프로젝트에 직접 개입
  document.getElementById('quick-order-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('quick-order-text');
    const target = document.getElementById('quick-order-target');
    const out = document.getElementById('quick-order-result');
    const btn = document.getElementById('btn-quick-order');
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    const targetName = target.value ? target.options[target.selectedIndex].text : '전체 시스템';
    out.innerHTML = `<div class="routine-sub">"${esc(targetName)}"에 바로 지시 전달하는 중…</div>`;
    try {
      const res = await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ text, missionId: target.value, quickOrder: true }) });
      state = res.state;
      input.value = '';
      const replies = (res.replies || []).slice(0, 2);
      const note = res.intake?.note || res.memoryNote || '';
      out.innerHTML = `<div class="mission-directive-quote" style="margin:0;">
          <div class="routine-sub">→ ${esc(targetName)}${note ? ` · <strong>바로 반영:</strong> ${esc(note)}` : ''}</div>
          ${replies.map((m) => `<div style="margin-top:6px;"><strong>${esc(m.senderName)}</strong>: ${esc(String(m.text || '').slice(0, 400))}</div>`).join('')}
          <div style="margin-top:6px;"><button type="button" class="btn-inline-edit" data-jump-view="office">회의실에서 이어서 보기</button></div>
        </div>`;
      renderAll();
      toast(note ? '바로 지시를 기존 업무·전체 지침에 반영했습니다.' : '팀장에게 전달했습니다.');
    } catch (err) {
      out.innerHTML = '';
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('directive-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmittingDirective) return;
    const submitBtn = document.getElementById('btn-submit-directive');
    const directive = document.getElementById('input-directive').value.trim();
    const title = document.getElementById('input-mission-title').value.trim();
    const domain = document.getElementById('input-mission-domain').value;
    const costPolicy = document.getElementById('input-cost-policy').value;
    const mode = document.getElementById('input-mission-mode')?.value || 'one_off';
    if (!directive) return;

    isSubmittingDirective = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '분배 중…';
    try {
      const res = await api('/api/missions', {
        method: 'POST',
        body: JSON.stringify({ title, directive, domain, costPolicy, mode })
      });
      state = res.state;
      selectedMissionId = res.mission.id;
      officeMissionFilter = res.mission.id;
      document.getElementById('input-mission-title').value = '';
      document.getElementById('input-directive').value = '';
      renderAll();
      switchView(res.mission.mode === 'project' ? 'projects' : 'missions');
      toast(res.deduplicated ? '이미 접수된 지시입니다.' : `팀장이 ${res.tasks.length}개 업무로 분배했습니다.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      isSubmittingDirective = false;
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="arrow-up" class="icon-xs"></i><span>지시</span>';
      refreshIcons();
    }
  });

  // Delegated clicks inside main content
  document.getElementById('content-area').addEventListener('click', async (e) => {
    // SVG flow node click
    const svgNode = e.target.closest('[data-svg-task]');
    if (svgNode) {
      openDrawer(svgNode.getAttribute('data-svg-task'));
      return;
    }

    const target = e.target.closest('button');
    if (!target) return;

    // 홈 "대표님이 하실 일" · 보류된 작업 결정 (다시 맡기기 / 이대로 완료 / 작업 접기)
    if (target.dataset.inboxDecide) {
      const action = target.dataset.inboxDecide;
      const taskIds = String(target.dataset.inboxTasks || '').split(',').filter(Boolean);
      const key = target.dataset.inboxKey || taskIds[0] || '';
      const wrap = document.getElementById('home-ceo-inbox') || document;
      const fbEl = [...wrap.querySelectorAll('[data-inbox-feedback]')].find((el) => el.dataset.inboxFeedback === key);
      const agEl = [...wrap.querySelectorAll('[data-inbox-assignee]')].find((el) => el.dataset.inboxAssignee === key);
      const feedback = String(fbEl?.value || '').trim();
      const assigneeId = agEl?.value || '';
      if (!taskIds.length) return;
      if (action === 'retry' && !feedback && !assigneeId && !window.confirm('피드백·담당 변경 없이 그대로 다시 맡길까요? 같은 이유로 다시 보류될 수 있습니다.')) return;
      if (action === 'accept' && !window.confirm(`${taskIds.length}건을 지금 결과물 그대로 완료 처리할까요?`)) return;
      if (action === 'drop' && !window.confirm(`${taskIds.length}건을 접을까요? (반려 처리, 다시 진행하지 않음)`)) return;
      target.disabled = true;
      try {
        const res = await api('/api/tasks/ceo-decision', { method: 'POST', body: JSON.stringify({ taskIds, action, feedback, assigneeId }) });
        if (fbEl) fbEl.value = '';
        if (agEl) agEl.value = '';
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        const label = { retry: '다시 맡겼습니다. 팀장이 곧 이어서 진행합니다', accept: '완료 처리했습니다', drop: '접었습니다' }[action] || '처리했습니다';
        const doneN = (res.done || []).length;
        const skipN = (res.skipped || []).length;
        toast(`${doneN}건 ${label}.${skipN ? ` (${skipN}건 건너뜀: ${res.skipped[0].reason})` : ''}`, !doneN);
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }

    if (target.dataset.outTab) {
      outListTab = target.dataset.outTab;
      renderOutsourcingView();
      return;
    }
    if (target.dataset.outNewToggle) {
      outNewOpen = !outNewOpen;
      renderOutsourcingView();
      if (outNewOpen) document.getElementById('out-new-title')?.focus();
      return;
    }
    if (target.dataset.outOpenSettings) {
      switchView('integrations');
      switchHubTab('outsourcing');
      return;
    }
    if (target.dataset.outResume) {
      target.disabled = true;
      try {
        const res = await api(`/api/outsourcing/${target.dataset.outResume}/resume`, {
          method: 'POST',
          body: JSON.stringify({ worker: target.dataset.outResumeWorker || '', note: '대표님이 화면에서 처리 완료' })
        });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast('재개했습니다. 대상 AI가 다음 실행 때 이어서 처리합니다.');
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }
    if (target.dataset.outAway !== undefined && target.dataset.outAway !== '') {
      const hours = Number(target.dataset.outAway);
      try {
        const res = await api('/api/outsourcing/route', { method: 'POST', body: JSON.stringify({ routing: 'auto', awayHours: hours }) });
        applyStateKeepingHealth(res.state);
        lastOutRouting = res.routing;
        renderAll();
        refreshIcons();
        renderOutsourcingSettings(true);
        toast(hours > 0 ? `PC 자리비움 ${hours}시간: Aside를 건너뛰고 다음 순위로 바로 넘깁니다.` : 'PC 자리비움을 해제했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.copyCmd) {
      await copyText(target.dataset.copyCmd, '설치 명령을 복사했습니다. PC PowerShell에 붙여 넣으세요.');
      return;
    }
    if (target.dataset.devPolicySave) {
      const devPolicy = {};
      document.querySelectorAll('[data-dev-policy]').forEach((el) => {
        devPolicy[el.dataset.devPolicy] = el.value;
      });
      try {
        const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ devPolicy }) });
        if (res.state) applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        renderOutsourcingSettings(true);
        toast('개발 지침을 저장했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.outRouteSave) {
      const priorities = {};
      let codeWorkflow = 'single';
      document.querySelectorAll('[data-out-prio]').forEach((el) => {
        const k = el.dataset.outPrio;
        const idx = Number(el.dataset.outPrioIdx);
        if (k === 'code' && idx === 0 && el.value === 'agy_then_aside') {
          codeWorkflow = 'agy_then_aside';
          return;
        }
        priorities[k] = priorities[k] || [];
        priorities[k][idx] = el.value;
      });
      if (codeWorkflow === 'agy_then_aside') {
        priorities.code = ['antigravity', 'aside'];
      }
      for (const k of Object.keys(priorities)) priorities[k] = priorities[k].filter(Boolean).filter((w, i, a) => a.indexOf(w) === i);
      try {
        const res = await api('/api/outsourcing/route', {
          method: 'POST',
          body: JSON.stringify({
            routing: document.getElementById('out-route-mode')?.value || 'auto',
            priorities,
            ...(document.querySelector('[data-out-prio="code"]') ? { codeWorkflow } : {}),
            waitMinutes: Number(document.getElementById('out-wait-min')?.value || 30)
          })
        });
        applyStateKeepingHealth(res.state);
        lastOutRouting = res.routing;
        renderAll();
        refreshIcons();
        renderOutsourcingSettings(true);
        toast(codeWorkflow === 'agy_then_aside' ? '역할 분담을 저장했습니다 (코드: AGY 수정 → Aside 검수·보완).' : '역할 분담을 저장했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.outCopyGeminiUrl) {
      await copyText(geminiConnectorUrl(), 'Gemini 앱 연결 주소를 복사했습니다 (토큰 포함, 공유 금지). Connected Apps → Custom에 붙여넣으세요.');
      return;
    }
    if (target.dataset.outCopyGeminiPrompt) {
      await copyText(geminiSchedulePrompt(), 'Gemini 예약 지시문을 복사했습니다. Gemini → Scheduled → 새 작업에 붙여넣고 매시간으로 저장하세요.');
      return;
    }
    if (target.dataset.outCopySetup) {
      try {
        const res = await api('/api/outsourcing/setup/antigravity');
        await copyText(res.prompt || '', 'Antigravity 설정 프롬프트를 복사했습니다. Antigravity 에이전트 대화창에 그대로 붙여넣으세요 (토큰 포함, 공유 금지).');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset.outCopy) {
      try {
        const res = await api(`/api/outsourcing/${target.dataset.outCopy}`);
        await copyText(res.packet || '', '요청서를 복사했습니다. 외부 AI에 그대로 붙여넣으세요.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.outCopyMcp) {
      await copyText(mcpConfigSnippet(), 'Antigravity MCP 설정을 복사했습니다 (토큰 포함, 외부 공유 금지).');
      return;
    }
    if (target.dataset.outSubmitToggle) {
      outSubmitOpenId = outSubmitOpenId === target.dataset.outSubmitToggle ? null : target.dataset.outSubmitToggle;
      renderOutsourcingView();
      return;
    }
    if (target.dataset.outSubmit) {
      const id = target.dataset.outSubmit;
      target.disabled = true;
      try {
        const res = await api(`/api/outsourcing/${id}/submit`, {
          method: 'POST',
          body: JSON.stringify({
            worker: document.getElementById('out-submit-worker')?.value || 'manual',
            summary: document.getElementById('out-submit-summary')?.value || '',
            document: document.getElementById('out-submit-doc')?.value || '',
            prUrl: document.getElementById('out-submit-pr')?.value || ''
          })
        });
        outSubmitOpenId = null;
        if (res.state) applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast('외주 결과를 반영했습니다.');
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }
    if (target.dataset.outCancel) {
      if (!window.confirm('이 외주 요청을 취소할까요? 연결된 업무는 내부 AI가 다시 시도합니다.')) return;
      try {
        const res = await api(`/api/outsourcing/${target.dataset.outCancel}/cancel`, { method: 'POST' });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast('외주 요청을 취소했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.outCreate) {
      try {
        const res = await api('/api/outsourcing', {
          method: 'POST',
          body: JSON.stringify({
            title: document.getElementById('out-new-title')?.value || '',
            kind: document.getElementById('out-new-kind')?.value || 'task',
            goal: document.getElementById('out-new-goal')?.value || '',
            missionId: document.getElementById('out-new-mission')?.value || '',
            worker: document.getElementById('out-new-worker')?.value || 'any'
          })
        });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        outNewOpen = false;
        outListTab = 'active';
        renderOutsourcingView();
        toast(`외주 요청 ${res.request.id}를 올렸습니다.`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.outSettingsSave) {
      try {
        const res = await api('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            outsourcing: {
              enabled: document.getElementById('out-cfg-enabled')?.checked,
              autoForBrowser: document.getElementById('out-cfg-browser')?.checked,
              autoOnFailure: document.getElementById('out-cfg-failure')?.checked,
              consultMode: document.getElementById('out-cfg-consult')?.value
            }
          })
        });
        if (res.state) applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        renderOutsourcingSettings(true);
        toast('협업 설정을 저장했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.consultApproval) {
      target.disabled = true;
      try {
        const res = await api('/api/outsourcing', {
          method: 'POST',
          body: JSON.stringify({ kind: 'consult', approvalId: target.dataset.consultApproval })
        });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast(`외부 자문 ${res.request.id}를 요청했습니다.`);
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }

    if (target.dataset.routineRun) {
      const id = target.dataset.routineRun;
      target.disabled = true;
      target.textContent = '실행 중…';
      try {
        const res = await api(`/api/routines/${id}/run`, { method: 'POST' });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast(res.status === 'warning' ? '점검 완료: 이상 항목이 있습니다. 결과를 확인해 주세요.' : res.status === 'started' ? '담당 팀원에게 업무를 배정하고 실행을 시작했습니다.' : '실행 완료: 이상 없음');
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
        target.textContent = '지금 실행';
      }
      return;
    }
    if (target.dataset.routineToggle) {
      const id = target.dataset.routineToggle;
      const r = (state.routines || []).find((x) => x.id === id);
      try {
        const res = await api(`/api/routines/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !r?.enabled }) });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast(r?.enabled ? '루틴을 껐습니다.' : '루틴을 켰습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.routineDelete) {
      const id = target.dataset.routineDelete;
      const r = (state.routines || []).find((x) => x.id === id);
      if (!window.confirm(`"${r?.title || '루틴'}"을(를) 삭제할까요?`)) return;
      try {
        const res = await api(`/api/routines/${id}`, { method: 'DELETE' });
        applyStateKeepingHealth(res.state);
        renderAll();
        refreshIcons();
        toast('루틴을 삭제했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    if (target.dataset.routineOpenTask) {
      openDrawer(target.dataset.routineOpenTask);
      return;
    }

    if (target.dataset.officeChannel) {
      officeMissionFilter = target.dataset.officeChannel;
      if (officeMissionFilter !== 'all') selectedMissionId = officeMissionFilter;
      renderOfficeView();
      refreshIcons();
      return;
    }

    if (target.id === 'btn-clear-chat') {
      const label = officeMissionFilter === 'all' ? '전체 회의실 대화' : '현재 업무 채널 대화';
      if (!confirm(`${label}를 모두 비울까요?`)) return;
      try {
        const qs = officeMissionFilter !== 'all' ? `?missionId=${encodeURIComponent(officeMissionFilter)}` : '';
        const res = await api(`/api/chat${qs}`, { method: 'DELETE' });
        state = res.state;
        renderAll();
        toast('회의실 대화를 비웠습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset.jumpView) {
      switchView(target.dataset.jumpView);
      return;
    }

    if (target.dataset.openMissionBoard) {
      selectedMissionId = target.dataset.openMissionBoard;
      officeMissionFilter = target.dataset.openMissionBoard;
      const mObj = state.missions.find((m) => m.id === selectedMissionId);
      switchView(mObj?.mode === 'project' ? 'projects' : 'missions');
      return;
    }

    if (target.dataset.openApproval) {
      selectedApprovalId = target.dataset.openApproval;
      renderApprovalsView();
      switchView('approvals');
      refreshIcons();
      return;
    }

    if (target.dataset.quickApprove) {
      const aprId = target.dataset.quickApprove;
      target.disabled = true;
      target.textContent = '승인 중…';
      try {
        const res = await api(`/api/approvals/${aprId}/decide`, {
          method: 'POST',
          body: JSON.stringify({ decision: 'approved', ceoNote: 'CEO 홈 원터치 승인' })
        });
        state = res.state;
        renderAll();
        toast(res.codeApply ? '승인 완료. 실코드 머지·배포를 바로 진행합니다.' : 'CEO 승인이 즉시 확정되었습니다.');
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
        target.textContent = '승인';
      }
      return;
    }

    if (target.dataset.selectMission) {
      selectedMissionId = target.dataset.selectMission;
      officeMissionFilter = target.dataset.selectMission;
      renderCommandView();
      renderSidebarTree();
      refreshIcons();
      return;
    }

    if (target.dataset.missionKind) {
      missionKindFilter = target.dataset.missionKind;
      missionStatusFilter = 'all';
      renderCommandView();
      refreshIcons();
      return;
    }

    if (target.dataset.taskFilter) {
      missionStatusFilter = target.dataset.taskFilter;
      renderCommandView();
      refreshIcons();
      return;
    }

    if (target.dataset.openDrawer) {
      openDrawer(target.dataset.openDrawer);
      return;
    }

    if (target.dataset.jumpApproval) {
      const apr = state.approvals.find((a) => a.taskId === target.dataset.jumpApproval && a.status === 'pending');
      if (apr) selectedApprovalId = apr.id;
      switchView('approvals');
      renderApprovalsView();
      refreshIcons();
      return;
    }

    if (target.dataset.runTask) {
      await handleRunTask(target.dataset.runTask, target);
      return;
    }

    if (target.id === 'btn-rename-mission') {
      const missionId = target.dataset.missionId;
      const m = state.missions.find((x) => x.id === missionId);
      if (!m) return;
      const nextTitle = window.prompt('새 프로젝트 / 업무 이름을 입력하세요:', m.title);
      if (nextTitle === null) return;
      const trimmed = nextTitle.trim();
      if (!trimmed || trimmed === m.title) return;
      try {
        const res = await api(`/api/missions/${missionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: trimmed })
        });
        state = res.state;
        renderAll();
        toast('이름을 수정했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-replan') {
      const note = window.prompt('어떻게 바꿀까요? (팀장이 이 지시를 반영해 작전 계획을 다시 세웁니다. 끝난 마일스톤은 유지)', '');
      if (note === null) return;
      try {
        const res = await api(`/api/missions/${target.dataset.missionId}/replan`, { method: 'POST', body: JSON.stringify({ note }) });
        state = res.state;
        renderAll();
        toast(`재계획을 지시했습니다. 대기 작업 ${res.dropped}건을 정리하고 팀장이 곧 새 계획을 올립니다.`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset?.advanceMilestone) {
      const mId = target.dataset.missionId;
      const msId = target.dataset.advanceMilestone;
      if (!window.confirm('이 단계를 완료 처리하고 바로 다음 단계로 넘길까요?')) return;
      target.disabled = true;
      try {
        const res = await api(`/api/missions/${encodeURIComponent(mId)}/milestones/${encodeURIComponent(msId)}/advance`, {
          method: 'POST',
          body: JSON.stringify({})
        });
        state = res.state;
        renderAll();
        toast(res.next ? `완료 처리했습니다 → 다음 단계 "${res.next.title}"로 넘어갑니다.` : '완료 처리했습니다.');
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }

    if (target.dataset?.shortsPick) {
      target.disabled = true;
      try {
        const res = await api(`/api/shorts/candidates/${target.dataset.shortsPick}/pick`, { method: 'POST' });
        state = res.state;
        renderAll();
        toast('선택했습니다. 팀이 대본을 써서 결재로 올립니다.');
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }
    if (target.dataset?.shortsDismiss) {
      target.disabled = true;
      try {
        const res = await api('/api/shorts/candidates/dismiss', { method: 'POST', body: '{}' });
        state = res.state;
        renderAll();
        toast(`남은 뉴스 후보 ${res.dismissed || 0}건을 닫았습니다.`);
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }
    if (target.dataset?.shortsRetry) {
      try {
        const res = await api(`/api/shorts/jobs/${target.dataset.shortsRetry}/retry`, { method: 'POST' });
        state = res.state;
        renderAll();
        toast('제작을 다시 요청했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-ops-cycle') {
      target.disabled = true;
      try {
        const res = await api(`/api/missions/${target.dataset.missionId}/ops-cycle`, { method: 'POST' });
        state = res.state;
        renderAll();
        toast('팀장이 운영 사이클을 시작했습니다. 작전 계획·작업 배정이 회의실에 보고됩니다.');
      } catch (err) {
        toast(err.message, true);
      } finally {
        target.disabled = false;
      }
      return;
    }

    if (target.id === 'btn-mission-goal' || target.id === 'btn-mission-goal-2') {
      const missionId = target.dataset.missionId;
      const m = state.missions.find((x) => x.id === missionId);
      if (!m) return;
      const g = m.goal || {};
      const ask = (q, v) => window.prompt(q, v === null || v === undefined ? '' : String(v));
      const objective = ask('목표를 한 문장으로 (예: 연말정산 시즌 전 검색 유입 확보)', g.objective || '');
      if (objective === null) return;
      const metric = ask('핵심 지표 (예: 월 자연검색 클릭, 월 수익)', g.metric || '');
      if (metric === null) return;
      const unit = ask('단위 (예: 회, 원, 명)', g.unit || '');
      if (unit === null) return;
      const current = ask('현재값 (모르면 비워 두세요)', g.current);
      if (current === null) return;
      const target2 = ask('목표치 (숫자)', g.target);
      if (target2 === null) return;
      const deadline = ask('기한 (YYYY-MM-DD, 없으면 비워 두세요)', g.deadline || '');
      if (deadline === null) return;
      const num = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(/[,\s]/g, '')));
      try {
        const res = await api(`/api/missions/${missionId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            goal: {
              objective: objective.trim(),
              metric: metric.trim(),
              unit: unit.trim(),
              current: num(current),
              baseline: g.baseline ?? num(current),
              target: num(target2),
              deadline: deadline.trim()
            }
          })
        });
        state = res.state;
        renderAll();
        toast('목표를 저장했습니다. 팀장의 모든 계획·제안이 이 목표를 기준으로 움직입니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-mission-scope') {
      const missionId = target.dataset.missionId;
      const m = state.missions.find((x) => x.id === missionId);
      if (!m) return;
      const focus = window.prompt('이 업무가 집중할 일을 적어 주세요 (모든 AI에게 최우선 지침으로 전달):', m.scope?.focus || '');
      if (focus === null) return;
      const exclude = window.prompt(
        '이 업무에서 하지 말 일의 키워드를 쉼표로 적어 주세요 (이 단어가 들어간 작업·제안은 자동 제외):',
        (m.scope?.exclude || []).join(', ')
      );
      if (exclude === null) return;
      try {
        const res = await api(`/api/missions/${missionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ scope: { focus: focus.trim(), exclude: exclude.split(',').map((s) => s.trim()).filter(Boolean) } })
        });
        state = res.state;
        renderAll();
        toast('업무 범위를 저장했습니다. 이제부터 모든 작업·제안에 적용됩니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-bind-mission-repo') {
      const missionId = target.dataset.missionId;
      const m = state.missions.find((x) => x.id === missionId);
      if (!m) return;
      const nextRepo = window.prompt(
        '연결할 GitHub 저장소(owner/repo)를 입력하세요 (예: alpinu83/kr-calc-hub 또는 alpinu83/ai-ceo-hub):',
        m.githubRepo || ''
      );
      if (nextRepo === null) return;
      const nextSite = window.prompt(
        '연결할 라이브 웹사이트 URL을 입력하세요 (예: https://korea-tax-cal.com):',
        m.siteUrl || ''
      );
      if (nextSite === null) return;
      try {
        const res = await api(`/api/missions/${missionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ githubRepo: nextRepo.trim(), siteUrl: nextSite.trim() })
        });
        state = res.state;
        renderAll();
        toast(`실연동 저장 완료: ${nextRepo.trim() || '저장소 해제'}`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-deploy-idle') {
      const missionId = target.dataset.missionId;
      target.disabled = true;
      target.textContent = '팀원 투입 중…';
      try {
        const res = await api(`/api/missions/${missionId}/deploy-idle`, { method: 'POST' });
        state = res.state;
        renderAll();
        toast(
          res.deployedCount > 0
            ? `대기 중이던 AI 팀원 ${res.deployedCount}명을 투입하고 착수시켰습니다.`
            : '이미 모든 활성 팀원이 투입되어 있습니다.'
        );
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }

    if (target.dataset.deleteTask) {
      const taskId = target.dataset.deleteTask;
      const tObj = state.tasks.find((x) => x.id === taskId);
      const tLabel = tObj?.title ? `"${tObj.title}"` : '이 종료된 업무';
      if (!window.confirm(`${tLabel}을(를) 삭제할까요?`)) return;
      if (!window.confirm(`[최종 확인] ${tLabel}을(를) 정말 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
      try {
        const res = await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
        state = res.state;
        renderAll();
        toast('업무를 삭제했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-clear-completed-tasks') {
      const missionId = target.dataset.missionId;
      const mObj = state.missions.find((x) => x.id === missionId);
      const mLabel = mObj?.title ? `"${mObj.title}"` : '이 프로젝트/업무';
      if (!window.confirm(`${mLabel}의 종료된 업무를 모두 삭제할까요?`)) return;
      if (!window.confirm(`[최종 확인] ${mLabel}의 종료된 업무와 결과물을 정말 모두 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
      target.disabled = true;
      try {
        const res = await api(`/api/missions/${missionId}/completed-tasks`, { method: 'DELETE' });
        state = res.state;
        renderAll();
        toast(`종료된 업무 ${res.removedCount}건을 정리했습니다.`);
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }

    if (target.id === 'btn-toggle-project-mode') {
      const missionId = target.dataset.missionId;
      const nextMode = target.dataset.nextMode || 'project';
      target.disabled = true;
      try {
        const res = await api(`/api/missions/${missionId}/mode`, {
          method: 'PATCH',
          body: JSON.stringify({ mode: nextMode })
        });
        state = res.state;
        selectedMissionId = missionId;
        renderAll();
        switchView(nextMode === 'project' ? 'projects' : 'missions');
        toast(nextMode === 'project' ? '프로젝트로 전환했습니다.' : '일반 업무로 전환했습니다.');
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
      }
      return;
    }

    if (target.id === 'btn-run-all-mission') {
      const missionId = target.dataset.missionId;
      target.disabled = true;
      target.textContent = '팀장 일괄 추진 중…';
      try {
        const res = await api(`/api/missions/${missionId}/run-all`, { method: 'POST' });
        state = res.state;
        renderAll();
        toast(`총괄 팀장이 ${res.ranCount}개 업무를 일괄 추진했습니다.`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-open-office-mission') {
      if (selectedMissionId) officeMissionFilter = selectedMissionId;
      switchView('office');
      renderOfficeView();
      refreshIcons();
      return;
    }

    if (target.dataset.mentionDesk) {
      const name = target.dataset.mentionDesk.split(' ')[0];
      setOfficeMobileTab('chat');
      const input = document.getElementById('lounge-chat-input');
      if (input) {
        input.value = `${input.value ? input.value + ' ' : ''}@${name} `;
        input.focus();
      }
      return;
    }

    if (target.dataset.quickChat) {
      const input = document.getElementById('lounge-chat-input');
      if (input) {
        input.value = target.dataset.quickChat;
        document.getElementById('lounge-chat-form')?.requestSubmit();
      }
      return;
    }

    if (target.id === 'btn-start-standup' || target.id === 'btn-start-standup-mobile') {
      if (isPlayingLiveSession) return;
      const missionId =
        officeMissionFilter !== 'all' ? officeMissionFilter : selectedMissionId || state.missions[0]?.id;
      if (!missionId) {
        toast('먼저 홈에서 업무 지시를 생성해 주세요.', true);
        return;
      }
      officeMissionFilter = missionId;
      setOfficeMobileTab('chat');
      const prevHtml = target.innerHTML;
      target.disabled = true;
      target.textContent = '점검 중…';
      try {
        const baseMsgs = [...(state.messages || [])];
        const res = await api(`/api/missions/${missionId}/standup`, { method: 'POST' });
        await playLiveMessages(baseMsgs, res.turns || [], res.state);
        toast('업무 현황 점검을 완료했습니다.');
      } catch (err) {
        toast(err.message, true);
      } finally {
        target.disabled = false;
        target.innerHTML = prevHtml;
        refreshIcons();
      }
      return;
    }

    if (target.id === 'btn-synthesize-report') {
      const missionId = target.dataset.missionId;
      target.disabled = true;
      target.textContent = '임원 보고서 작성 중…';
      try {
        const res = await api(`/api/missions/${missionId}/synthesize`, { method: 'POST' });
        state = res.state;
        renderAll();
        toast('총괄 팀장의 최종 임원 보고서가 생성되었습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-copy-final-report') {
      const m = state.missions.find((x) => x.id === selectedMissionId);
      if (m?.finalReport) copyText(m.finalReport, '임원 보고서를 복사했습니다.');
      return;
    }

    if (target.id === 'btn-download-final-report') {
      const m = state.missions.find((x) => x.id === selectedMissionId);
      if (m?.finalReport) downloadFile(`${m.id}-executive-brief.md`, m.finalReport);
      return;
    }

    if (target.id === 'btn-delete-mission') {
      const missionId = target.dataset.missionId;
      const mObj = state.missions.find((x) => x.id === missionId);
      const kindLabel = mObj?.mode === 'project' ? '프로젝트' : '업무';
      const titleLabel = mObj?.title ? `"${mObj.title}"` : `이 ${kindLabel}`;
      if (!window.confirm(`[${kindLabel}] ${titleLabel}과(와) 연결된 세부 업무·결재·회의실 대화를 모두 삭제할까요?`)) return;
      if (!window.confirm(`[최종 확인] ${titleLabel}을(를) 정말 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return;
      try {
        const res = await api(`/api/missions/${missionId}`, { method: 'DELETE' });
        state = res.state;
        selectedMissionId = state.missions[0]?.id || null;
        if (officeMissionFilter === missionId) {
          officeMissionFilter = state.missions[0]?.id || 'all';
        }
        renderAll();
        toast(`${kindLabel}와 관련 대화를 삭제했습니다.`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset.selectApproval) {
      selectedApprovalId = target.dataset.selectApproval;
      renderApprovalsView();
      refreshIcons();
      if (window.innerWidth <= 980) {
        document.getElementById('approval-detail-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    if (target.dataset.downloadDeliverable) {
      const aprId = target.dataset.downloadDeliverable;
      try {
        const doc = await api(`/api/approvals/${encodeURIComponent(aprId)}/deliverable?format=json`);
        const blob = new Blob([doc.markdown || ''], { type: 'text/markdown; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.filename || `deliverable-${aprId}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('성과품·체크리스트(.md) 파일을 내려받았습니다.');
      } catch (err) {
        toast(err.message || '성과품 다운로드 실패', true);
      }
      return;
    }

    if (target.dataset.decideId) {
      const aprId = target.dataset.decideId;
      const decision = target.dataset.decision;
      const noteEl = document.getElementById('memo-ceo-note');
      const ceoNote = noteEl ? noteEl.value.trim() : '';
      try {
        const res = await api(`/api/approvals/${aprId}/decide`, {
          method: 'POST',
          body: JSON.stringify({ decision, ceoNote })
        });
        state = res.state;
        renderAll();
        toast(
          decision === 'approved'
            ? res.codeApply
              ? '승인 완료. 실코드 머지·배포를 바로 진행합니다.'
              : 'CEO 승인이 확정되었습니다.'
            : decision === 'revision_requested'
              ? '수정 지시를 담당 팀원에게 전달했습니다.'
              : '안건을 반려했습니다.'
        );
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset.focusAgent) {
      highlightedAgentId = target.dataset.focusAgent;
      renderRosterView();
      const card = document.getElementById(`agent-card-${highlightedAgentId}`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (target.dataset.toggleAgent) {
      const ag = getAgent(target.dataset.toggleAgent);
      if (!ag) return;
      try {
        const res = await api(`/api/agents/${ag.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: !ag.active })
        });
        state = res.state;
        renderAll();
        toast(`${ag.name} 상태를 변경했습니다.`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset.pingProvider) {
      const provider = target.dataset.pingProvider;
      const prev = target.textContent;
      target.disabled = true;
      target.textContent = '테스트 중…';
      try {
        const res = await api('/api/providers/test', {
          method: 'POST',
          body: JSON.stringify({ provider }),
          signal: AbortSignal.timeout(18000)
        });
        toast(`${provider} 연결 성공 (${res.model}): ${res.reply}`);
      } catch (err) {
        const msg = err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? '응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.'
          : err.message;
        toast(msg, true);
      } finally {
        target.disabled = false;
        target.textContent = prev;
      }
      return;
    }

    if (target.id === 'btn-test-telegram') {
      const prev = target.textContent;
      target.disabled = true;
      target.textContent = '발송 중…';
      try {
        const res = await api('/api/telegram/test', { method: 'POST' });
        if (res.state) {
          state = res.state;
          renderAll();
        }
        toast(`텔레그램 연결 성공 (@${res.botUsername})! 테스트 메시지를 보냈습니다.`);
      } catch (err) {
        toast(err.message, true);
      } finally {
        target.disabled = false;
        target.textContent = prev;
      }
      return;
    }

    if (target.dataset.openAgentConfig) {
      switchHubTab('mcp');
      selectConfigAgent(target.dataset.openAgentConfig);
      refreshIcons();
      return;
    }

    if (target.dataset.configAgent) {
      selectConfigAgent(target.dataset.configAgent);
      refreshIcons();
      return;
    }

    if (target.id === 'btn-copy-mcp-snippet') {
      copyText(document.getElementById('mcp-snippet-box').textContent, '연동 설정을 복사했습니다.');
      return;
    }

    if (target.id === 'btn-copy-raw-token') {
      copyText(state.settings?.mcpToken || '', '순수 토큰(ceo_mcp_...)만 복사했습니다. 보안 폼에 그대로 붙여넣으세요!');
      return;
    }

    if (target.id === 'btn-test-pickle-inbox') {
      const inboxKey = target.dataset.testInboxKey || 'pickle';
      const out = document.getElementById('mcp-test-output');
      out.textContent = `${inboxKey} 연결 상태 확인 중…`;
      try {
        const tok = encodeURIComponent(state.settings?.mcpToken || '');
        const res = await api(`/api/agent-inbox/${encodeURIComponent(inboxKey)}?token=${tok}&dryRun=1`);
        const headerLine = res.externalBotConnected
          ? `✅ 서버 수신함 정상 · 실제 외부 봇 접속 기록 있음 (${formatRelativeTime(res.lastExternalSeenAt)})`
          : `⚠️ 서버 수신함 주소는 열려있으나, 실제 외부 봇(${res.agent?.name || inboxKey})은 아직 접속 기록이 없습니다.\n→ 왼쪽 '명령어 복사'를 해당 봇 앱에 붙여넣어 실행해야 실제로 연결됩니다.`;
        out.textContent = `${headerLine}\n\n${JSON.stringify({ serverInboxReady: res.serverInboxReady, externalBotConnected: res.externalBotConnected, lastExternalSeenAt: res.lastExternalSeenAt, pendingTaskCount: (res.myPendingTasks || []).length, myPendingTasks: (res.myPendingTasks || []).map((t) => ({ id: t.id, title: t.title, status: t.status })) }, null, 2)}`;
        toast(
          res.externalBotConnected
            ? `${res.agent?.name || inboxKey} 실제 연동이 확인되었습니다.`
            : `서버 주소는 정상이지만 ${res.agent?.name || inboxKey} 봇 접속 기록은 아직 없습니다.`,
          !res.externalBotConnected
        );
      } catch (err) {
        out.textContent = `오류: ${err.message}`;
        toast(`수신함 오류: ${err.message}`, true);
      }
      return;
    }

    if (target.dataset.mcpTest) {
      const action = target.dataset.mcpTest;
      const out = document.getElementById('mcp-test-output');
      out.textContent = 'MCP 요청 중…';
      try {
        const payload =
          action === 'tools/list'
            ? { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
            : { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: action, arguments: {} } };
        const res = await api('/api/mcp', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${state.settings.mcpToken}`,
            Accept: 'application/json, text/event-stream'
          },
          body: JSON.stringify(payload)
        });
        out.textContent = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
      } catch (err) {
        out.textContent = `오류: ${err.message}`;
      }
      return;
    }
  });

  // Delegated changes
  document.getElementById('content-area').addEventListener('change', async (e) => {
    const sel = e.target;
    if (sel.dataset.reassignTask) {
      try {
        const res = await api(`/api/tasks/${sel.dataset.reassignTask}`, {
          method: 'PATCH',
          body: JSON.stringify({ assigneeId: sel.value })
        });
        state = res.state;
        renderAll();
        toast('담당 AI를 재배정하고 맞춤 지시서를 갱신했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
    }

    if (sel.dataset.agentMode) {
      try {
        const res = await api(`/api/agents/${sel.dataset.agentMode}`, {
          method: 'PATCH',
          body: JSON.stringify({ connectionMode: sel.value })
        });
        state = res.state;
        renderAll();
        toast(`연동 방식을 ${MODE_LABELS[sel.value]}(으)로 전환했습니다.`);
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  // Drawer
  document.getElementById('btn-close-drawer').addEventListener('click', closeDrawer);
  document.getElementById('task-drawer-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'task-drawer-backdrop') closeDrawer();
    const runBtn = e.target.closest('[data-run-task]');
    if (runBtn) handleRunTask(runBtn.dataset.runTask, runBtn);
  });

  // Hire Modal (Smart Provider -> Model Dropdown -> Auto-fill + Role Presets + IT Team)
  const hireBackdrop = document.getElementById('hire-modal-backdrop');
  const hireProviderEl = document.getElementById('hire-provider');
  const hireModelSelectEl = document.getElementById('hire-model-select');
  const hireCustomModelWrap = document.getElementById('hire-custom-model-wrap');
  const hireModelInput = document.getElementById('hire-model');
  const hireRolePresetEl = document.getElementById('hire-role-preset');
  const hireTeamEl = document.getElementById('hire-team');
  const hireNameEl = document.getElementById('hire-name');
  const hireRoleEl = document.getElementById('hire-role');
  const hireModeEl = document.getElementById('hire-mode');
  const hireCostEl = document.getElementById('hire-cost');
  const hireStrengthsEl = document.getElementById('hire-strengths');

  const applyHireRolePreset = () => {
    const presetKey = hireRolePresetEl?.value || 'auto';
    if (presetKey === 'auto' || presetKey === 'custom') return;
    const rp = HIRE_ROLE_PRESETS[presetKey];
    if (!rp) return;
    if (hireTeamEl) hireTeamEl.value = rp.team;
    if (hireRoleEl) hireRoleEl.value = rp.role;
    if (hireStrengthsEl) hireStrengthsEl.value = rp.strengths;
  };

  const applyHireModelAutoFill = () => {
    const provider = hireProviderEl?.value || 'groq';
    const selectedId = hireModelSelectEl?.value || '__custom__';
    const isCustom = selectedId === '__custom__';
    if (hireCustomModelWrap) hireCustomModelWrap.style.display = isCustom ? '' : 'none';

    const list = HIRE_MODEL_CATALOG[provider] || [];
    const entry = list.find((m) => m.id === selectedId);
    if (entry) {
      if (hireModelInput) hireModelInput.value = entry.id;
      if (hireModeEl) hireModeEl.value = entry.mode || 'api';
      if (hireCostEl) hireCostEl.value = entry.cost || 'free';
      if (hireNameEl) hireNameEl.value = entry.name;
      if ((hireRolePresetEl?.value || 'auto') === 'auto') {
        if (hireRoleEl) hireRoleEl.value = entry.role;
        if (hireStrengthsEl) hireStrengthsEl.value = entry.strengths;
      } else {
        applyHireRolePreset();
      }
    } else if (isCustom) {
      if (hireModelInput) hireModelInput.value = '';
      if (provider === 'custom' && hireModeEl) hireModeEl.value = 'bridge';
    }
  };

  const syncHireModelOptions = () => {
    const provider = hireProviderEl?.value || 'groq';
    const list = HIRE_MODEL_CATALOG[provider] || [];
    if (!hireModelSelectEl) return;
    const opts = list
      .map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`)
      .concat('<option value="__custom__">직접 입력…</option>');
    hireModelSelectEl.innerHTML = opts.join('');
    hireModelSelectEl.value = list[0]?.id || '__custom__';
    applyHireModelAutoFill();
  };

  hireProviderEl?.addEventListener('change', syncHireModelOptions);
  hireModelSelectEl?.addEventListener('change', applyHireModelAutoFill);
  hireRolePresetEl?.addEventListener('change', () => {
    const key = hireRolePresetEl.value;
    if (key === 'auto') {
      applyHireModelAutoFill();
    } else if (key === 'custom') {
      if (hireRoleEl) {
        hireRoleEl.value = '';
        hireRoleEl.focus();
      }
    } else {
      applyHireRolePreset();
    }
  });

  const openHire = () => {
    if (hireRolePresetEl) hireRolePresetEl.value = 'auto';
    if (hireTeamEl) hireTeamEl.value = 'core';
    syncHireModelOptions();
    hireBackdrop.classList.add('open');
    hireBackdrop.setAttribute('aria-hidden', 'false');
  };
  const closeHire = () => {
    hireBackdrop.classList.remove('open');
    hireBackdrop.setAttribute('aria-hidden', 'true');
  };

  document.getElementById('btn-open-hire-modal').addEventListener('click', openHire);
  document.getElementById('btn-close-hire-modal').addEventListener('click', closeHire);
  document.getElementById('btn-cancel-hire').addEventListener('click', closeHire);
  hireBackdrop.addEventListener('click', (e) => {
    if (e.target === hireBackdrop) closeHire();
  });

  document.getElementById('hire-agent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const chosenModel =
      hireModelSelectEl?.value && hireModelSelectEl.value !== '__custom__'
        ? hireModelSelectEl.value
        : hireModelInput?.value.trim() || '';
    const payload = {
      name: hireNameEl.value.trim(),
      roleTitle: hireRoleEl.value.trim(),
      team: hireTeamEl?.value === 'it' ? 'it' : 'core',
      tier: document.getElementById('hire-tier').value,
      connectionMode: hireModeEl.value,
      costTier: hireCostEl.value,
      provider: hireProviderEl.value,
      modelId: chosenModel,
      monthlyCapKRW: 0,
      strengths: hireStrengthsEl.value.trim()
    };
    try {
      const res = await api('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
      state = res.state;
      e.target.reset();
      closeHire();
      renderAll();
      toast(`${res.agent.name} 팀원이 ${payload.team === 'it' ? 'IT 유지보수팀' : '조직'}에 합류했습니다.`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Save Settings (Clean active stack: Gemini + Groq + OpenRouter + EXAONE + Telegram + Basic Info)
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      companyName: document.getElementById('set-company-name').value.trim(),
      ceoName: document.getElementById('set-ceo-name').value.trim(),
      ...(document.getElementById('set-global-directives')
        ? {
            globalDirectives: document.getElementById('set-global-directives').value,
            ...(document.getElementById('skills-list') && skillCatalog ? { skills: readSkillSettingsFromForm() } : {}),
            leadEngine: {
              enabled: document.getElementById('set-lead-enabled').checked,
              autoFollowUp: document.getElementById('set-lead-autofollow').checked,
                    maxAutoRounds: Number(document.getElementById('set-lead-maxrounds').value),
              followUpMinutes: Number(document.getElementById('set-lead-interval').value)
            }
          }
        : {}),
      telegram: {
        botToken: document.getElementById('tg-bot-token').value.trim(),
        chatId: document.getElementById('tg-chat-id').value.trim(),
        pollingEnabled: document.getElementById('tg-polling-enabled').checked,
        ...(document.getElementById('tg-notify-reports')
          ? {
              notify: {
                reports: document.getElementById('tg-notify-reports').checked,
                approvals: document.getElementById('tg-notify-approvals').checked,
                alerts: document.getElementById('tg-notify-alerts').checked,
                quiet: {
                  enabled: document.getElementById('tg-quiet-enabled').checked,
                  start: document.getElementById('tg-quiet-start').value || '23:00',
                  end: document.getElementById('tg-quiet-end').value || '08:00',
                  allowUrgent: document.getElementById('tg-quiet-urgent').checked
                }
              }
            }
          : {})
      },
      providers: {
        gemini: {
          apiKey: document.getElementById('key-gemini')?.value.trim() || '',
          freeModel: document.getElementById('model-gemini')?.value.trim() || 'gemini-4-hydrogen'
        },
        groq: {
          apiKey: document.getElementById('key-groq')?.value.trim() || '',
          model: document.getElementById('model-groq')?.value.trim() || 'openai/gpt-oss-120b'
        },
        openrouter: {
          apiKey: document.getElementById('key-openrouter')?.value.trim() || '',
          model: document.getElementById('model-openrouter')?.value.trim() || 'openrouter/free'
        },
        exaone: {
          apiKey: document.getElementById('key-exaone').value.trim(),
          model: document.getElementById('model-exaone').value.trim()
        },
        ...(document.getElementById('ga4-property-id')
          ? {
              googleData: {
                apiKey: document.getElementById('key-googledata')?.value.trim() || '',
                ga4PropertyId: document.getElementById('ga4-property-id').value.trim(),
                searchConsoleSite: document.getElementById('sc-site').value.trim()
              }
            }
          : {}),
        githubRepo: {
          apiKey: document.getElementById('key-github')?.value.trim() || '',
          repo: document.getElementById('repo-github')?.value.trim() || 'alpinu83/ai-ceo-hub',
          allowedRepos:
            document.getElementById('allowed-repos-github')?.value.trim() ||
            'alpinu83/ai-ceo-hub, alpinu83/kr-calc-hub, alpinu83/alpinu83.github.io'
        }
      }
    };
    try {
      const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      state = res.state;
      ['key-gemini', 'key-groq', 'key-openrouter', 'key-exaone', 'key-github', 'key-googledata', 'tg-bot-token'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      renderAll();
      toast('설정을 저장하고 암호화 클라우드에 동기화했습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('btn-skill-add')?.addEventListener('click', async () => {
    const name = document.getElementById('skill-new-name')?.value.trim();
    const keywords = document.getElementById('skill-new-keywords')?.value.trim();
    const instructions = document.getElementById('skill-new-instructions')?.value.trim();
    if (!name || !instructions) return toast('스킬 이름과 지침을 입력해 주세요.', true);
    try {
      const res = await api('/api/skills/custom', { method: 'POST', body: JSON.stringify({ name, keywords, instructions }) });
      state = res.state;
      skillCatalog = res.skills;
      ['skill-new-name', 'skill-new-keywords', 'skill-new-instructions'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      renderAll();
      toast(`"${name}" 스킬을 추가했습니다. 맞는 작업부터 바로 적용됩니다.`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('skills-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-skill-delete]');
    if (!btn) return;
    try {
      const res = await api(`/api/skills/custom/${encodeURIComponent(btn.dataset.skillDelete)}`, { method: 'DELETE' });
      state = res.state;
      skillCatalog = res.skills;
      renderAll();
      toast('스킬을 삭제했습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('btn-memory-add')?.addEventListener('click', async () => {
    const input = document.getElementById('memory-new-text');
    const text = input?.value.trim();
    if (!text) return;
    try {
      const res = await api('/api/memory', { method: 'POST', body: JSON.stringify({ text, pinned: true, kind: 'directive' }) });
      state = res.state;
      input.value = '';
      renderAll();
      toast('고정 기억에 추가했습니다. 모든 AI 팀원에게 적용됩니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('memory-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-forget-memory]');
    if (!btn) return;
    try {
      const res = await api(`/api/memory/${encodeURIComponent(btn.dataset.forgetMemory)}`, { method: 'DELETE' });
      state = res.state;
      renderAll();
      toast('기억을 삭제했습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('btn-lead-followup')?.addEventListener('click', async () => {
    try {
      const res = await api('/api/lead/follow-up', { method: 'POST' });
      state = res.state;
      renderAll();
      toast(res.actions?.length ? `팀장 점검: ${res.actions.join(' / ')}` : '팀장 점검 완료: 지금 처리할 후속 조치가 없습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // 회사 기억만 비우기 (고정 지침은 남김). 전체 데이터 초기화는 화면에서 하지 않음
  document.getElementById('btn-reset-demo').addEventListener('click', async () => {
    if (!confirm('자동으로 쌓인 회사 기억을 비울까요? (고정 지침과 프로젝트·업무는 그대로 남습니다)')) return;
    try {
      const res = await api('/api/memory/clear', { method: 'POST' });
      if (res.state) state = res.state;
      renderAll();
      toast(`회사 기억 ${res.removed || 0}건을 비웠습니다 (고정 지침 유지).`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Live Team Lounge CEO Chat Form
  const loungeForm = document.getElementById('lounge-chat-form');
  const loungeInput = document.getElementById('lounge-chat-input');
  if (loungeInput) {
    loungeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        loungeForm?.requestSubmit();
      }
    });
  }
  if (loungeForm) {
    loungeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isPlayingLiveSession) return;
      const text = loungeInput.value.trim();
      if (!text) return;

      const sendBtn = document.getElementById('btn-send-chat');
      sendBtn.disabled = true;
      loungeInput.value = '';
      try {
        const baseMsgs = [...(state.messages || [])];
        const targetMissionId = officeMissionFilter === 'all' ? '' : officeMissionFilter;
        const res = await api('/api/chat/send', {
          method: 'POST',
          body: JSON.stringify({ text, missionId: targetMissionId })
        });
        const withCeo = res.ceoMessage ? [...baseMsgs, res.ceoMessage] : baseMsgs;
        await playLiveMessages(withCeo, res.replies || [], res.state);
        if (res.intake?.note) toast(`업무로 반영됨: ${res.intake.note}`);
      } catch (err) {
        toast(err.message, true);
      } finally {
        sendBtn.disabled = false;
        loungeInput.focus();
      }
    });
  }

  // Korean Voice Input (Web Speech API — free, works on Samsung Browser / Chrome / Safari)
  setupVoiceInput('btn-voice-directive', 'input-directive');
  setupVoiceInput('btn-voice-quick', 'quick-order-text');
  setupVoiceInput('btn-voice-chat', 'lounge-chat-input');
}

// 음성 입력: 대표님이 마이크 버튼을 다시 누를 때까지 켜 둔다.
// 말을 멈추거나 브라우저 음성 엔진이 스스로 끝나도(onend) 자동으로 다시 시작하고, 인식된 문장은 입력란에 이어 붙인다.
// 한 번에 한 입력란만 듣는다(다른 마이크를 누르면 앞의 것은 꺼짐). 입력란이 화면에서 사라지면 마이크도 끈다.
const voiceCtl = { active: null };

function isVoiceListening() {
  return Boolean(voiceCtl.active);
}

function joinVoiceText(a, b) {
  const left = String(a || '');
  const right = String(b || '').trim();
  if (!right) return left;
  if (!left.trim()) return right;
  return `${left.replace(/\s+$/, '')} ${right}`;
}

function setVoiceBtnState(targetId, on) {
  document.querySelectorAll('[data-voice-target]').forEach((b) => {
    if (b.dataset.voiceTarget !== targetId) return;
    b.classList.toggle('listening', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.title = on ? '음성 입력 끄기 (다시 누르면 꺼짐)' : '음성 입력';
  });
}

function stopVoiceInput(silent = false) {
  const s = voiceCtl.active;
  if (!s) return;
  s.manualStop = true;
  voiceCtl.active = null;
  clearTimeout(s.restartTimer);
  try {
    s.rec?.stop();
  } catch {
    // already stopped
  }
  setVoiceBtnState(s.targetId, false);
  if (!silent) toast('음성 입력을 껐습니다.');
}

function startVoiceInput(targetId) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast('이 브라우저에서는 음성 인식을 지원하지 않습니다. (크롬/삼성 브라우저 HTTPS에서 지원)', true);
    return;
  }
  stopVoiceInput(true);
  const s = { targetId, manualStop: false, rec: null, committed: null, lastWritten: null, restartTimer: null, quickEnds: 0, lastFinalText: '', lastFinalAt: 0 };
  voiceCtl.active = s;
  setVoiceBtnState(targetId, true);

  const liveInput = () => {
    const el = document.getElementById(targetId);
    return el && el.isConnected ? el : null;
  };
  // 대표님이 직접 고치거나 전송해서 비운 내용은 그대로 존중하고, 그 뒤에 이어서 적는다
  const syncBase = (el) => {
    if (s.committed === null || el.value !== s.lastWritten) s.committed = el.value;
  };

  const run = () => {
    if (s.manualStop || voiceCtl.active !== s) return;
    if (!liveInput()) {
      stopVoiceInput(true);
      return;
    }
    if (document.hidden) {
      // 백그라운드에서는 브라우저가 마이크를 막으므로 화면으로 돌아오면 다시 켬
      document.addEventListener('visibilitychange', run, { once: true });
      return;
    }
    const rec = new SpeechRecognition();
    s.rec = rec;
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = true;
    const startedAt = Date.now();

    rec.onresult = (event) => {
      if (voiceCtl.active !== s) return;
      const el = liveInput();
      if (!el) return;
      syncBase(el);
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          const norm = String(piece || '').trim();
          const now = Date.now();
          // 안드로이드 크롬·삼성 브라우저에서 continuous=true 시 같은 확정 문장이 연속 중복 들어오는 현상 방지
          if (norm && !(norm === s.lastFinalText && now - s.lastFinalAt < 1500)) {
            s.committed = joinVoiceText(s.committed, norm);
            s.lastFinalText = norm;
            s.lastFinalAt = now;
          }
        } else {
          interim = joinVoiceText(interim, piece);
        }
      }
      const next = joinVoiceText(s.committed, interim);
      el.value = next;
      s.lastWritten = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        toast(event.error === 'audio-capture' ? '마이크를 찾을 수 없습니다.' : '마이크 권한을 허용해 주세요.', true);
        stopVoiceInput(true);
      } else if (event.error !== 'no-speech' && event.error !== 'aborted' && event.error !== 'network') {
        toast(`음성 인식 오류: ${event.error} (자동으로 다시 연결합니다)`, true);
      }
    };

    rec.onend = () => {
      if (s.manualStop || voiceCtl.active !== s) return;
      // 말 멈춤·시간 제한으로 엔진이 끝나도 대표님이 끄기 전까지 다시 시작. 연속으로 바로 끝나면 잠깐 쉬었다가 재시도
      s.quickEnds = Date.now() - startedAt < 1500 ? s.quickEnds + 1 : 0;
      s.restartTimer = setTimeout(run, s.quickEnds >= 3 ? 2000 : 250);
    };

    try {
      rec.start();
    } catch {
      s.restartTimer = setTimeout(run, 1000);
    }
  };

  toast('듣고 있습니다. 끌 때는 마이크 버튼을 다시 누르세요.');
  run();
}

function toggleVoiceInput(targetId) {
  if (voiceCtl.active?.targetId === targetId) stopVoiceInput();
  else startVoiceInput(targetId);
}

function setupVoiceInput(btnId, targetInputId) {
  const btn = document.getElementById(btnId);
  if (!btn || !document.getElementById(targetInputId)) return;
  btn.dataset.voiceTarget = targetInputId;
  btn.setAttribute('aria-pressed', 'false');
}

// 마이크 버튼 클릭(정적 버튼 + 결재 의견처럼 다시 그려지는 버튼 모두)
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-voice-target]');
  if (!btn) return;
  e.preventDefault();
  toggleVoiceInput(btn.dataset.voiceTarget);
});

async function handleRunTask(taskId, btn) {
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = '실행 중…';
  try {
    const res = await api(`/api/tasks/${taskId}/run`, { method: 'POST' });
    state = res.state;
    renderAll();
    if (res.task.status === 'awaiting_approval') {
      toast('사전 작업 완료 — CEO 결재함에 승인 안건이 상신되었습니다.');
    } else {
      toast(res.live ? '실시간 실행을 완료했습니다.' : '전달 준비를 완료했습니다.');
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

async function init() {
  bindEvents();
  try {
    await detectRuntime();
    await consumeLoginLinkFromHash();
    state = await api('/api/state');
    selectedMissionId = state.missions[0]?.id || null;
    officeMissionFilter = state.missions[0]?.id || 'all';
    const policyEl = document.getElementById('input-cost-policy');
    if (policyEl) policyEl.value = state.settings.defaultCostPolicy || 'free_first';
    renderAll();

    // Auto-sync live server state (auto-running EXAONE tasks, Pickle/Cue/Muse reports, PC↔Mobile changes)
    if (runtimeMode === 'server') {
      setInterval(async () => {
        if (isPlayingLiveSession || document.hidden || isVoiceListening()) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
        try {
          const fresh = await api('/api/state');
          const prevSig = `${(state?.messages || []).length}|${(state?.tasks || []).map((t) => t.status).join(',')}|${(state?.approvals || []).filter((a) => a.status === 'pending').length}|${(state?.logs || []).length}|${(state?.missions || []).map((m) => (m.finalReport || '').length).join(',')}`;
          const newSig = `${(fresh?.messages || []).length}|${(fresh?.tasks || []).map((t) => t.status).join(',')}|${(fresh?.approvals || []).filter((a) => a.status === 'pending').length}|${(fresh?.logs || []).length}|${(fresh?.missions || []).map((m) => (m.finalReport || '').length).join(',')}`;
          if (newSig !== prevSig) {
            const prevMsgLen = (state?.messages || []).length;
            const newMsgLen = (fresh?.messages || []).length;
            state = fresh;
            renderAll();
            if (newMsgLen > prevMsgLen) {
              const latest = fresh.messages[fresh.messages.length - 1];
              toast(`${latest.senderName} 님의 새 보고가 도착했습니다.`);
            }
          } else if (fresh?.subscriptionUsage && state) {
            // 다른 변화가 없어도 AI 사용량 위젯(접속·건수)은 매번 갱신
            state.subscriptionUsage = fresh.subscriptionUsage;
            renderUsageWidget();
          }
        } catch {
          // ignore transient network glitches
        }
      }, 5000);
    }
  } catch (err) {
    toast(`초기 데이터 로드 실패: ${err.message}`, true);
  }
}

let deferredInstallPrompt = null;
let swRegistration = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function refreshPushUi() {
  const statusEl = document.getElementById('status-push-live');
  const toggleBtn = document.getElementById('btn-toggle-push');
  const testBtn = document.getElementById('btn-test-push');
  if (!statusEl || !toggleBtn) return;

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    statusEl.textContent = '미지원 브라우저';
    statusEl.classList.remove('ok');
    toggleBtn.style.display = 'none';
    if (testBtn) testBtn.style.display = 'none';
    return;
  }

  try {
    const reg = swRegistration || (await navigator.serviceWorker.ready);
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') {
      const cnt = state?.pushSubscribedCount || 1;
      statusEl.textContent = `켜짐 (${cnt}대 연결)`;
      statusEl.classList.add('ok');
      toggleBtn.textContent = '알림 끄기';
      toggleBtn.className = 'btn btn-ghost btn-sm';
      if (testBtn) testBtn.style.display = 'inline-flex';
    } else {
      statusEl.textContent = Notification.permission === 'denied' ? '브라우저 차단됨' : '꺼짐';
      statusEl.classList.remove('ok');
      toggleBtn.textContent = '알림 켜기';
      toggleBtn.className = 'btn btn-primary btn-sm';
      if (testBtn) testBtn.style.display = 'none';
    }
  } catch {
    statusEl.textContent = '꺼짐';
  }
}

async function toggleWebPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('이 브라우저에서는 푸시 알림을 지원하지 않습니다. (크롬 앱 설치 후 이용해 주세요)', true);
    return;
  }
  const toggleBtn = document.getElementById('btn-toggle-push');
  if (toggleBtn) toggleBtn.disabled = true;

  try {
    const reg = swRegistration || (await navigator.serviceWorker.register('./sw.js', { scope: './' }));
    swRegistration = reg;
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await api('/api/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: existing.endpoint })
      }).catch(() => {});
      await existing.unsubscribe();
      state = await api('/api/state').catch(() => state);
      await refreshPushUi();
      toast('이 기기의 푸시 알림을 껐습니다.');
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('브라우저 알림 권한을 허용해 주세요.', true);
      await refreshPushUi();
      return;
    }

    const { publicKey } = await api('/api/push/public-key');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await api('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription: sub.toJSON(),
        deviceLabel: /Android|iPhone|iPad/i.test(navigator.userAgent) ? '모바일' : 'PC'
      })
    });

    state = await api('/api/state').catch(() => state);
    await refreshPushUi();
    toast('푸시 알림이 켜졌습니다! 결재 요청·업무 완료 시 바로 알림이 옵니다.');
  } catch (err) {
    toast(`푸시 알림 설정 오류: ${err.message}`, true);
  } finally {
    if (toggleBtn) toggleBtn.disabled = false;
  }
}

function setupPwa() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        await refreshPushUi();
      } catch {
        // ignore sw errors on unsupported local origins
      }
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.style.display = 'inline-flex';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.style.display = 'none';
    toast('CEO Office 앱이 설치되었습니다!');
  });

  document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => {});
    deferredInstallPrompt = null;
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.style.display = 'none';
  });

  document.getElementById('btn-toggle-push')?.addEventListener('click', toggleWebPush);
  document.getElementById('btn-test-push')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-test-push');
    if (btn) btn.disabled = true;
    try {
      const res = await api('/api/push/test', { method: 'POST' });
      toast(`푸시 알림 테스트 발송 완료 (${res.sent}대)`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Jump directly to requested view when opened from a push notification tap (?view=approvals / ?view=missions)
  const urlView = new URLSearchParams(window.location.search).get('view');
  if (urlView && VIEW_META[urlView]) {
    switchView(urlView);
  }
}

setupPwa();
init();
