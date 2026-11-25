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
  awaiting_approval: { label: 'CEO 결재 대기', cls: 'badge-amber' },
  completed: { label: '완료', cls: 'badge-green' },
  rejected: { label: '반려', cls: 'badge-red' }
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

function renderMarkdown(md = '') {
  // Strip raw HTML tags before parsing with Marked for safety while keeping full GFM tables & checklists
  const cleaned = String(md).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (window.marked && typeof window.marked.parse === 'function') {
    return window.marked.parse(cleaned, { gfm: true, breaks: true });
  }
  return `<pre style="white-space:pre-wrap;margin:0">${cleaned}</pre>`;
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
    const entered = window.prompt('CEO 관리자 키를 입력해 주세요 (서버 CEO_ADMIN_KEY):', '');
    if (entered && entered.trim()) {
      localStorage.setItem('ceoAdminKey', entered.trim());
      return api(url, { ...options, _keyRetried: true });
    }
  }
  if (!res.ok) {
    throw new Error((typeof data === 'object' && data.error) || `요청 실패 (${res.status})`);
  }
  return data;
}

function getAgent(id) {
  return state?.agents?.find((a) => a.id === id) || null;
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
  const activeAgents = state.agents.filter((a) => a.active);
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

  // Executive 3-Cell KPI Strip (Approvals · Missions · Active AI)
  document.getElementById('kpi-approvals-val').textContent = `${pendingCount}건`;
  document.getElementById('kpi-agents-val').textContent = `${state.missions.length}건 · ${taskPct}%`;
  document.getElementById('kpi-budget-val').textContent = `${activeAgents.length}명`;

  const meta = VIEW_META[currentView] || VIEW_META.command;
  document.getElementById('page-title').textContent = meta.title;
  const sub = document.getElementById('page-subtitle');
  if (sub) sub.textContent = meta.subtitle || '';

  renderSidebarTree();
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
        const prefix = viewKey === 'projects' ? `P${Number(m.phase) || 1} ` : '';
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

function renderHomeView() {
  const aprWrap = document.getElementById('home-approvals-list');
  const msnWrap = document.getElementById('home-missions-list');
  const chatTeaser = document.getElementById('home-chat-teaser');
  if (!aprWrap || !msnWrap) return;

  const pending = state.approvals.filter((a) => a.status === 'pending');
  if (pending.length === 0) {
    aprWrap.innerHTML = '<div class="empty-state">대기 중인 결재 없음</div>';
  } else {
    aprWrap.innerHTML = pending
      .slice(0, 3)
      .map((apr) => {
        const ag = getAgent(apr.agentId);
        const msn = state.missions.find((m) => m.id === apr.missionId);
        const msnTag = msn
          ? `${msn.mode === 'project' ? '프로젝트' : '업무'} · ${msn.title}`
          : '';
        const costTxt = apr.estimatedCostKRW > 0 ? formatKRW(apr.estimatedCostKRW) : '';
        return `<div class="home-item pending-accent">
          <div class="home-item-top">
            <div style="display:flex;gap:5px;flex-wrap:wrap;min-width:0;">
              ${msnTag ? `<span class="badge badge-blue" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;">${esc(msnTag)}</span>` : ''}
              <span class="badge badge-amber">${esc(ag?.name || 'AI')}</span>
            </div>
            ${costTxt ? `<span class="mono" style="font-weight:700;">${esc(costTxt)}</span>` : ''}
          </div>
          <div class="home-item-title">${esc(apr.title)}</div>
          <div class="home-item-actions">
            <button type="button" class="btn btn-primary btn-sm" data-quick-approve="${esc(apr.id)}">승인</button>
            <button type="button" class="btn btn-ghost btn-sm" data-open-approval="${esc(apr.id)}">상세</button>
            ${msn ? `<button type="button" class="btn btn-ghost btn-sm" data-open-mission-board="${esc(msn.id)}">원본 보기</button>` : ''}
          </div>
        </div>`;
      })
      .join('');
  }

  if (state.missions.length === 0) {
    msnWrap.innerHTML = '<div class="empty-state">진행 중인 미션 없음</div>';
  } else {
    msnWrap.innerHTML = state.missions
      .slice(0, 3)
      .map((m) => {
        const tasks = state.tasks.filter((t) => t.missionId === m.id);
        const done = tasks.filter((t) => t.status === 'completed').length;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        const kindBadge =
          m.mode === 'project'
            ? `<span class="badge badge-blue">프로젝트 P${Number(m.phase) || 1}</span>`
            : '<span class="badge badge-neutral">일반 업무</span>';
        return `<div class="home-item">
          <div class="home-item-top">
            <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
              ${kindBadge}
              <div class="home-item-title">${esc(m.title)}</div>
            </div>
            <span class="mono" style="color:var(--ink-muted);">${pct}%</span>
          </div>
          <div class="progress-track thin"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="home-item-actions">
            <button type="button" class="btn btn-ghost btn-sm" data-open-mission-board="${esc(m.id)}">열기</button>
            <button type="button" class="btn btn-ghost btn-sm" data-jump-view="office">회의실</button>
          </div>
        </div>`;
      })
      .join('');
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
        const prefix = m.mode === 'project' ? `<span class="badge badge-blue" style="padding:1px 6px;font-size:10.5px;">P${Number(m.phase) || 1}</span>` : '';
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
  const currentPhase = Number(mission.phase) || 1;
  const pendingNextPhase = state.approvals.find(
    (a) => a.missionId === mission.id && a.kind === 'next_phase' && a.status === 'pending'
  );
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
                ? `<span class="badge badge-blue">프로젝트 · Phase ${currentPhase}</span>`
                : `<span class="badge badge-neutral">${esc(DOMAIN_LABELS[mission.domain] || mission.domain)}</span>`
            }
            <span class="badge badge-green">총괄 팀장: ${esc(lead?.name || '팀장')}</span>
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
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${
            pendingNextPhase
              ? `<button type="button" class="btn btn-amber btn-sm" data-jump-view="approvals">Phase ${pendingNextPhase.proposedPhase} 제안 결재</button>`
              : isProject
                ? `<button type="button" class="btn btn-primary btn-sm" id="btn-propose-next-phase" data-mission-id="${esc(mission.id)}">다음 단계 제안</button>`
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
  return esc(text).replace(/(@[^\s,!?]+)/g, '<span class="mention-tag">$1</span>');
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

  const partCount = document.getElementById('office-participant-count');
  if (partCount) {
    partCount.textContent = String(state.agents.filter((a) => a.active).length);
  }

  const renderDesk = (ag) => {
    const myTasks = missionTasks.filter((t) => t.assigneeId === ag.id);
    const hasApproval = myTasks.some((t) => t.status === 'awaiting_approval');
    const isRunning = myTasks.some((t) => t.status === 'running');
    const isSpeaking = activeSpeakerId === ag.id;

    let statusLabel = '대기';
    if (!ag.active) statusLabel = '휴직';
    else if (isSpeaking) statusLabel = '발언 중';
    else if (isRunning) statusLabel = '작업 중';
    else if (hasApproval) statusLabel = '결재';
    else if (myTasks.some((t) => t.status === 'completed')) statusLabel = '완료';
    else if (myTasks.length > 0) statusLabel = '배정';

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

  const leads = state.agents.filter((a) => a.tier === 'lead');
  const workers = state.agents.filter((a) => a.tier !== 'lead');
  leadWrap.innerHTML = leads.map(renderDesk).join('');
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
            const tb = typeBadges[m.type] || { label: '대화', cls: 'badge-neutral' };
            const mTag =
              officeMissionFilter === 'all' && m.missionId && missionTitleMap[m.missionId]
                ? `<span class="badge badge-neutral">${esc(missionTitleMap[m.missionId].slice(0, 14))}</span>`
                : '';
            return `<div class="chat-msg ${isCeo ? 'from-ceo' : ''} ${m.type === 'approval' ? 'msg-approval' : ''}">
              <span class="agent-avatar" style="background:${esc(m.senderAccent || '#0E6245')}">${esc(m.senderShortCode || 'AI')}</span>
              <div class="chat-body">
                <div class="chat-meta">
                  <span class="chat-sender">${esc(m.senderName)}</span>
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
    .filter((a) => a.active)
    .map((a) => ({ id: a.id, label: a.name }));

  if (filtered.length === 0) {
    return `${filterBar}<div class="empty-state">해당 상태의 업무가 없습니다.</div>`;
  }

  const cards = filtered
    .map((t) => {
      const ag = getAgent(t.assigneeId) || state.agents[0];
      const st = STATUS_META[t.status] || { label: t.status, cls: 'badge-neutral' };
      const isFinished = t.status === 'completed' || t.status === 'rejected';
      const selectOpts = agentOptions
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
            ${isProject ? `<span class="badge badge-neutral">P${Number(t.phase) || 1}</span>` : ''}
            ${t.requiresApproval && t.status !== 'awaiting_approval' ? '<span class="badge badge-amber">CEO 결재</span>' : ''}
            <span class="badge ${st.cls}">${esc(st.label)}</span>
          </div>
        </div>

        <div class="task-footer">
          <div class="assignee-pill">
            <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
            <select class="assignee-select" data-reassign-task="${esc(t.id)}" aria-label="담당 AI 변경">${selectOpts}</select>
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
            ? `지속 프로젝트 (Phase ${Number(mission.phase) || 1}) — 단계 완료 시 팀장이 다음 단계 전략을 결재함에 자동 제안`
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
          <h3 class="sheet-title">총괄 팀장 최종 임원 보고서${mission.mode === 'project' ? ` (Phase ${Number(mission.phase) || 1})` : ''}</h3>
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
                <summary style="cursor:pointer;font-weight:700;font-size:13.5px;">Phase ${h.phase} 완료 보고 (${esc(formatTime(h.completedAt))})</summary>
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
  const detail = cc.error || cc.note || '';
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
          ? `${msn.mode === 'project' ? `프로젝트 P${Number(msn.phase) || 1}` : '일반 업무'} · ${msn.title}`
          : a.category;
        const sel = a.id === selectedApprovalId ? 'selected' : '';
        return `<button type="button" class="queue-item ${sel} ${isPending ? 'pending-stripe' : ''}" data-select-approval="${esc(a.id)}">
          <div class="queue-item-meta">
            <span class="badge badge-blue" style="max-width:75%;overflow:hidden;text-overflow:ellipsis;">${esc(msnLabel)}</span>
            <span class="mono">${isCodeApprovalClient(a) ? `<span class="badge ${(CODE_STATUS_LABELS[a.codeChange?.status] || ['badge-green'])[0]}">${esc((CODE_STATUS_LABELS[a.codeChange?.status] || ['', '실코드'])[1])}</span>` : a.estimatedCostKRW > 0 ? formatKRW(a.estimatedCostKRW) : '무료'}</span>
          </div>
          <div class="queue-item-title">${esc(a.title)}</div>
          <div class="queue-item-meta">
            <span>상신: ${esc(ag?.name || a.agentId)}</span>
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
  const msnKind = msn?.mode === 'project' ? `프로젝트 · Phase ${Number(msn.phase) || 1}` : '일반 업무';
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
        <h2 class="memo-title">${esc(apr.title)}</h2>
      </div>
      <span class="memo-stamp ${st.cls}">${esc(st.text)}</span>
    </div>

    <div class="memo-facts">
      <div>
        <div class="memo-fact-label">관련 프로젝트 / 업무</div>
        <div class="memo-fact-val">${esc(msn ? msn.title : '단독 안건')}</div>
      </div>
      <div>
        <div class="memo-fact-label">상신 AI 팀원</div>
        <div class="memo-fact-val">${esc(ag?.name || apr.agentId)}</div>
      </div>
      <div>
        <div class="memo-fact-label">예상 비용 · 유형</div>
        <div class="memo-fact-val mono">${apr.estimatedCostKRW > 0 ? formatKRW(apr.estimatedCostKRW) : '비용 없음'} · ${esc(apr.category)}</div>
      </div>
    </div>

    <div class="memo-section">
      <h4>상신 배경 및 요약</h4>
      <p style="margin:0;font-size:14px;">${esc(apr.summary)}</p>
    </div>

    <div class="memo-section">
      <h4>승인 시 실행될 작업</h4>
      <div class="prompt-box">${esc(apr.proposedAction)}</div>
    </div>

    ${renderCodeChangeStatus(apr)}

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

    ${
      task?.output
        ? `<div class="memo-section">
            <h4>팀원 제출 산출물 미리보기</h4>
            <div class="sheet" style="padding:14px 16px;background:var(--bg-subtle);box-shadow:none;">
              <div class="markdown-body">${renderMarkdown(task.output)}</div>
            </div>
          </div>`
        : ''
    }

    ${
      apr.status === 'pending'
        ? `<div class="memo-decision-box">
            <label class="field">
              <span class="field-label">CEO 결재 메모 또는 수정 지시 (선택)</span>
              <textarea id="memo-ceo-note" rows="2" placeholder="예: 룸 좌석 창가로 요청하고 예약 확정 진행해줘 / 예산을 20만원 이내로 다시 찾아줘"></textarea>
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

function renderRosterView() {
  // Visual Org Tree
  const treeCanvas = document.getElementById('org-tree-canvas');
  const leads = state.agents.filter((a) => a.tier === 'lead');
  const coreWorkers = state.agents.filter((a) => a.tier !== 'lead' && a.team !== 'it');
  const itWorkers = state.agents.filter((a) => a.team === 'it');
  const modeDot = (m) => (m === 'api' || m === 'litellm' ? 'dot-green' : m === 'mcp' ? 'dot-blue' : 'dot-amber');

  const renderNodePill = (ag) => `<button type="button" class="org-node-pill ${ag.active ? '' : 'inactive'}" data-focus-agent="${esc(ag.id)}">
    <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
    <div style="text-align:left;">
      <div class="org-node-name">${esc(ag.name)}</div>
      <div class="org-node-role">${esc(COST_LABELS[ag.costTier])} · ${esc(MODE_LABELS[ag.connectionMode])}</div>
    </div>
    <i class="dot ${modeDot(ag.connectionMode)}"></i>
  </button>`;

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
    <div class="org-level">
      ${leads.map(renderNodePill).join('')}
    </div>
    <div class="org-connector"></div>
    <div class="org-level">
      ${coreWorkers.map(renderNodePill).join('')}
    </div>
    ${
      itWorkers.length
        ? `<div class="org-connector"></div>
           <div class="org-level">
             <span class="badge badge-green" style="align-self:center;">IT 유지보수팀</span>
             ${itWorkers.map(renderNodePill).join('')}
           </div>`
        : ''
    }
  `;

  // Tier Cards
  const renderAgentCard = (ag) => `
    <article class="agent-card ${ag.active ? '' : 'inactive'} ${highlightedAgentId === ag.id ? 'highlight' : ''}" id="agent-card-${esc(ag.id)}">
      <div class="agent-card-head">
        <div class="agent-identity">
          <span class="agent-avatar lg" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
          <div>
            <div class="agent-name">${esc(ag.name)}</div>
            <div class="agent-role">${esc(ag.roleTitle)}</div>
          </div>
        </div>
        <span class="badge ${ag.costTier === 'free' ? 'badge-green' : ag.costTier === 'freemium' ? 'badge-blue' : 'badge-amber'}">
          ${esc(COST_LABELS[ag.costTier])}
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
          ${ag.active ? '비활성' : '활성화'}
        </button>
      </div>
    </article>
  `;

  const tiers = [
    { el: document.getElementById('roster-leads'), list: state.agents.filter((a) => a.tier === 'lead') },
    { el: document.getElementById('roster-specialists'), list: state.agents.filter((a) => a.tier === 'specialist' && a.team !== 'it') },
    { el: document.getElementById('roster-executors'), list: state.agents.filter((a) => a.tier === 'executor' && a.team !== 'it') },
    { el: document.getElementById('roster-it'), list: itWorkers }
  ];

  for (const t of tiers) {
    if (!t.el) continue;
    t.el.innerHTML = t.list.map(renderAgentCard).join('');
  }
}

function renderIntegrationsView() {
  const s = state.settings;
  document.getElementById('set-company-name').value = s.companyName || '';
  document.getElementById('set-ceo-name').value = s.ceoName || '';

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
  vooy: { title: '부이 (vooy) 연결 설정 (대기 중)', inboxKey: 'vooy' },
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

  const formPanels = ['gemini', 'groq', 'openrouter', 'exaone', 'github', 'telegram', 'general'];
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
  document.getElementById('drawer-agent-meta').textContent = `${ag.name} · ${MODE_LABELS[ag.connectionMode]} · ${COST_LABELS[ag.costTier]}`;
  document.getElementById('drawer-title').textContent = task.title;

  const mailtoLink =
    ag.provider === 'manus' && cueEmail
      ? `mailto:${encodeURIComponent(cueEmail)}?subject=${encodeURIComponent(`[CEO 지시] ${task.title}`)}&body=${encodeURIComponent(task.dispatchPrompt)}`
      : '';

  document.getElementById('drawer-body').innerHTML = `
    <div class="drawer-section">
      <h3>1. ${esc(ag.name)} 전달용 맞춤 지시서</h3>
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

function switchView(viewName) {
  currentView = viewName;
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

  document.getElementById('kpi-approvals-cell')?.addEventListener('click', () => switchView('approvals'));
  document.getElementById('kpi-missions-cell')?.addEventListener('click', () => switchView('missions'));
  document.getElementById('kpi-budget-cell')?.addEventListener('click', () => switchView('roster'));

  document.getElementById('btn-focus-directive').addEventListener('click', () => {
    switchView('command');
    document.getElementById('input-directive').focus();
    document.getElementById('directive-sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      if (!confirm('이 종료된 업무를 삭제할까요?')) return;
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
      if (!confirm('이 프로젝트/업무의 종료된 업무를 모두 삭제할까요?')) return;
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

    if (target.id === 'btn-propose-next-phase') {
      const missionId = target.dataset.missionId;
      target.disabled = true;
      target.textContent = '다음 단계 구상 중…';
      try {
        const res = await api(`/api/missions/${missionId}/propose-next`, { method: 'POST' });
        state = res.state;
        if (res.approval?.id) selectedApprovalId = res.approval.id;
        renderAll();
        switchView('approvals');
        renderApprovalsView();
        refreshIcons();
        toast(
          res.alreadyPending
            ? '이미 결재 대기 중인 다음 단계 제안이 있습니다.'
            : '총괄 팀장이 다음 단계 제안을 결재함에 올렸습니다.'
        );
      } catch (err) {
        toast(err.message, true);
        target.disabled = false;
        target.textContent = '다음 단계 제안';
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
      if (!confirm('이 미션과 관련 회의실 대화를 모두 삭제할까요?')) return;
      try {
        const res = await api(`/api/missions/${missionId}`, { method: 'DELETE' });
        state = res.state;
        selectedMissionId = state.missions[0]?.id || null;
        if (officeMissionFilter === missionId) {
          officeMissionFilter = state.missions[0]?.id || 'all';
        }
        renderAll();
        toast('미션과 관련 대화를 삭제했습니다.');
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
      telegram: {
        botToken: document.getElementById('tg-bot-token').value.trim(),
        chatId: document.getElementById('tg-chat-id').value.trim(),
        pollingEnabled: document.getElementById('tg-polling-enabled').checked
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
      ['key-gemini', 'key-groq', 'key-openrouter', 'key-exaone', 'key-github', 'tg-bot-token'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      renderAll();
      toast('설정을 저장하고 암호화 클라우드에 동기화했습니다.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById('btn-reset-demo').addEventListener('click', async () => {
    if (!confirm('샘플 미션과 설정을 초기 상태로 되돌릴까요?')) return;
    try {
      const res = await api('/api/reset', { method: 'POST' });
      state = res.state;
      selectedMissionId = state.missions[0]?.id || null;
      officeMissionFilter = state.missions[0]?.id || 'all';
      selectedApprovalId = state.approvals[0]?.id || null;
      renderAll();
      toast('초기 샘플 상태로 복원했습니다.');
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
  setupVoiceInput('btn-voice-chat', 'lounge-chat-input');
}

function setupVoiceInput(btnId, targetInputId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(targetInputId);
  if (!btn || !input) return;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isListening = false;
  let baseText = '';

  btn.addEventListener('click', () => {
    if (!SpeechRecognition) {
      toast('이 브라우저에서는 음성 인식을 지원하지 않습니다. (크롬/삼성 브라우저 HTTPS에서 지원)', true);
      return;
    }

    if (isListening && recognition) {
      recognition.stop();
      return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = false;
    baseText = input.value.trim();

    recognition.onstart = () => {
      isListening = true;
      btn.classList.add('listening');
      toast('듣고 있습니다… 말씀해 주세요');
    };

    recognition.onresult = (event) => {
      let spoken = '';
      for (let i = 0; i < event.results.length; i++) {
        spoken += event.results[i][0].transcript;
      }
      input.value = baseText ? `${baseText} ${spoken.trim()}` : spoken.trim();
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        toast('마이크 권한을 허용해 주세요.', true);
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        toast(`음성 인식 오류: ${event.error}`, true);
      }
    };

    recognition.onend = () => {
      isListening = false;
      btn.classList.remove('listening');
      input.focus();
    };

    try {
      recognition.start();
    } catch {
      isListening = false;
      btn.classList.remove('listening');
    }
  });
}

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
    state = await api('/api/state');
    selectedMissionId = state.missions[0]?.id || null;
    officeMissionFilter = state.missions[0]?.id || 'all';
    const policyEl = document.getElementById('input-cost-policy');
    if (policyEl) policyEl.value = state.settings.defaultCostPolicy || 'free_first';
    renderAll();

    // Auto-sync live server state (auto-running EXAONE tasks, Pickle/Cue/Muse reports, PC↔Mobile changes)
    if (runtimeMode === 'server') {
      setInterval(async () => {
        if (isPlayingLiveSession || document.hidden) return;
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
