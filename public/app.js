import { standaloneApi } from './standalone-runtime.js';

const PRESETS = {
  business: {
    title: 'B2B 제안서 작성 + 경쟁사 모니터링 + 고객 미팅 식당 예약',
    domain: 'business',
    directive:
      '신규 B2B 클라이언트용 5페이지 제안서 초안을 작성하고, 경쟁사 3곳 가격 변동을 매일 아침 브리핑하도록 세팅해줘. 목요일 저녁 성수역 근처 4인 비즈니스 식당도 전화로 빈자리 확인 후 예약 준비해줘.'
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
  }
};

const HIRE_PRESETS = {
  ollama: {
    name: 'Ollama Qwen 2.5 (로컬)',
    role: '보안 문서 요약 · 로컬 무료 팀원',
    tier: 'specialist',
    mode: 'api',
    cost: 'free',
    provider: 'ollama',
    model: 'qwen2.5:14b',
    cap: 0,
    strengths: '외부 전송 없이 내 PC/Mac에서 비용 0원으로 사내 민감 문서 요약·초안 작성'
  },
  openrouter: {
    name: 'Llama 3.3 70B (OpenRouter 무료)',
    role: '오픈소스 리서치 · 초안 팀원',
    tier: 'specialist',
    mode: 'litellm',
    cost: 'free',
    provider: 'litellm',
    model: 'openrouter-free',
    cap: 0,
    strengths: 'LiteLLM 게이트웨이를 통해 OpenRouter 무료 티어로 대량 번역·초안·브레인스토밍 수행'
  },
  openclaw: {
    name: 'OpenClaw (로컬 메신저 비서)',
    role: '텔레그램 · WhatsApp · 브라우저 실행 팀원',
    tier: 'executor',
    mode: 'mcp',
    cost: 'free',
    provider: 'custom',
    model: 'openclaw-local',
    cap: 0,
    strengths: '로컬 게이트웨이로 WhatsApp·Telegram·Slack·브라우저 자동화 및 CEO 결재 알림 전달'
  },
  perplexity: {
    name: 'Perplexity',
    role: '실시간 웹 검색 · 출처 검증 팀원',
    tier: 'specialist',
    mode: 'bridge',
    cost: 'freemium',
    provider: 'custom',
    model: 'sonar-pro',
    cap: 20000,
    strengths: '최신 뉴스·시장 데이터·출처 링크 기반 팩트체크 및 경쟁사 조사'
  }
};

const VIEW_META = {
  command: {
    title: '지휘실',
    subtitle: 'CEO가 목표를 지시하면 팀장이 무료·유료·앱 에이전트에게 업무를 분배합니다.'
  },
  office: {
    title: '라이브 오피스 · 사내 회의실',
    subtitle: 'AI 팀장과 팀원들이 각자 자리에서 일하고 서로 대화·협업하는 모습을 실시간으로 보고 직접 지시합니다.'
  },
  approvals: {
    title: 'CEO 결재함',
    subtitle: '결제, 예약 확정, 외부 발송 등 되돌리기 어려운 실행은 반드시 CEO 승인 후 진행됩니다.'
  },
  roster: {
    title: 'AI 조직도 · 예산',
    subtitle: 'Paperclip 패턴의 조직 계층과 팀원별 월 예산 한도·연동 방식을 한곳에서 관리합니다.'
  },
  integrations: {
    title: '오픈소스 · MCP 허브',
    subtitle: 'Vercel AI SDK, 공식 MCP SDK(/api/mcp), LiteLLM, Ollama 및 앱 브릿지를 연결합니다.'
  }
};

const DOMAIN_LABELS = {
  business: '1인 기업 · 비즈니스',
  life: '일상 · 예약',
  content: '콘텐츠 · 마케팅',
  dev: '개발 · 프로덕트'
};

const POLICY_LABELS = {
  free_first: '무료 · 구독 우선',
  balanced: '균형 배분',
  max_quality: '최고 성능'
};

const MODE_LABELS = {
  api: 'API 자동',
  litellm: 'LiteLLM 프록시',
  mcp: '공식 MCP',
  bridge: '구독 · 앱 브릿지'
};

const COST_LABELS = {
  free: '무료',
  freemium: '부분 무료',
  paid_or_sub: '유료 · 구독'
};

const STATUS_META = {
  queued: { label: '실행 대기', cls: 'badge-neutral' },
  running: { label: '진행 중', cls: 'badge-blue' },
  awaiting_bridge: { label: '앱 · MCP 전달', cls: 'badge-blue' },
  awaiting_approval: { label: 'CEO 결재 대기', cls: 'badge-amber' },
  completed: { label: '완료', cls: 'badge-green' },
  rejected: { label: '반려됨', cls: 'badge-red' }
};

let state = null;
let ossStack = null;
let currentView = 'command';
let missionViewMode = 'board'; // 'board' | 'list' | 'graph'
let selectedMissionId = null;
let selectedApprovalId = null;
let currentHubTab = 'providers';
let currentMcpTab = 'muse';
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

async function detectRuntime() {
  try {
    const res = await fetch('./api/health', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.ok === true) {
        runtimeMode = 'server';
        return;
      }
    }
  } catch {
    // static hosting (e.g. GitHub Pages)
  }
  runtimeMode = 'standalone';
}

async function api(url, options = {}) {
  if (runtimeMode === 'standalone') {
    return standaloneApi(url, options);
  }
  const targetUrl = url.startsWith('/') ? `.${url}` : url;
  const res = await fetch(targetUrl, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
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
  const freeActive = activeAgents.filter((a) => a.costTier === 'free' || a.costTier === 'freemium').length;
  const paidActive = activeAgents.length - freeActive;
  const pendingCount = state.approvals.filter((a) => a.status === 'pending').length;
  const liveProviderCount = Object.values(s.providers || {}).filter((p) => p.hasApiKey).length;

  const budget = Number(s.monthlyBudgetKRW) || 150000;
  const spent = Number(s.spentThisMonthKRW) || 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

  document.getElementById('sidebar-company-name').textContent = s.companyName || 'CEO Office';
  document.getElementById('sidebar-ceo-name').textContent = s.ceoName || '대표님';
  document.getElementById('nav-mission-count').textContent = String(state.missions.length);
  const chatCountEl = document.getElementById('nav-chat-count');
  if (chatCountEl) chatCountEl.textContent = String((state.messages || []).length);
  document.getElementById('nav-agent-count').textContent = String(activeAgents.length);

  const badge = document.getElementById('nav-approval-badge');
  badge.textContent = String(pendingCount);
  badge.classList.toggle('has-pending', pendingCount > 0);
  document.getElementById('topbar-pending-count').textContent = String(pendingCount);

  document.getElementById('sidebar-budget-text').textContent = `${formatKRW(spent)} / ${formatKRW(budget)}`;
  const bar = document.getElementById('sidebar-budget-bar');
  bar.style.width = `${pct}%`;
  bar.className = `progress-fill${pct >= 90 ? ' danger' : pct >= 70 ? ' warn' : ''}`;

  document.getElementById('stat-active-agents').textContent = `${activeAgents.length} / ${state.agents.length}명`;
  document.getElementById('stat-live-apis').textContent = liveProviderCount > 0 ? `${liveProviderCount}개 연결됨` : '시뮬레이션 · 브릿지';
  document.getElementById('stat-cost-policy').textContent = POLICY_LABELS[s.defaultCostPolicy] || s.defaultCostPolicy;

  document.getElementById('nav-api-dot').classList.toggle('connected', liveProviderCount > 0);

  // KPI Ledger
  document.getElementById('kpi-agents-val').textContent = `${activeAgents.length}명 가동 중`;
  document.getElementById('kpi-agents-sub').textContent = `무료·프리미엄 ${freeActive}명 · 유료·구독 ${paidActive}명`;
  document.getElementById('kpi-budget-val').textContent = `${formatKRW(spent)}`;
  document.getElementById('kpi-budget-sub').textContent = `월 한도 ${formatKRW(budget)} 중 ${pct}% 사용`;
  document.getElementById('kpi-approvals-val').textContent = pendingCount > 0 ? `${pendingCount}건 대기` : '대기 없음';

  const meta = VIEW_META[currentView];
  document.getElementById('page-title').textContent = meta.title;
  document.getElementById('page-subtitle').textContent = meta.subtitle;
}

function renderCommandView() {
  const tabsBar = document.getElementById('mission-tabs-bar');
  if (state.missions.length === 0) {
    tabsBar.innerHTML = '';
    document.getElementById('active-mission-container').innerHTML =
      '<div class="empty-state">진행 중인 미션이 없습니다. 위에서 CEO 지시서를 작성해 팀장에게 하달해 보세요.</div>';
  } else {
    tabsBar.innerHTML = state.missions
      .map((m) => {
        const tasks = state.tasks.filter((t) => t.missionId === m.id);
        const done = tasks.filter((t) => t.status === 'completed').length;
        const active = m.id === selectedMissionId ? 'active' : '';
        return `<button class="mission-tab ${active}" data-select-mission="${esc(m.id)}">
          <span>${esc(m.title)}</span>
          <span class="mono">${done}/${tasks.length}</span>
        </button>`;
      })
      .join('');

    const mission = state.missions.find((m) => m.id === selectedMissionId) || state.missions[0];
    renderActiveMission(mission);
  }

  // Activity Log
  const logList = document.getElementById('activity-list');
  logList.innerHTML = state.logs
    .slice(0, 28)
    .map(
      (log) => `<li class="activity-item">
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

  const missionHeader = `
    <div class="sheet mission-header-sheet">
      <div class="sheet-header compact">
        <div>
          <div class="mission-meta-row">
            <span class="badge badge-neutral">${esc(DOMAIN_LABELS[mission.domain] || mission.domain)}</span>
            <span class="badge badge-blue">${esc(POLICY_LABELS[mission.costPolicy] || mission.costPolicy)}</span>
            <span class="badge badge-green">총괄 팀장: ${esc(lead?.name || '팀장')}</span>
          </div>
          <h2 class="sheet-title">${esc(mission.title)}</h2>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${
            runnableCount > 0
              ? `<button type="button" class="btn btn-primary btn-sm" id="btn-run-all-mission" data-mission-id="${esc(mission.id)}">
                  <i data-lucide="play" class="icon-xs"></i>
                  <span>대기 AI 전원 투입 (${runnableCount})</span>
                </button>`
              : ''
          }
          <button type="button" class="btn btn-ghost btn-sm" id="btn-open-office-mission">
            <i data-lucide="messages-square" class="icon-xs"></i>
            <span>직원 회의 보기</span>
          </button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-synthesize-report" data-mission-id="${esc(mission.id)}">
            <i data-lucide="file-text" class="icon-xs"></i>
            <span>팀장 최종 보고서</span>
          </button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-delete-mission" data-mission-id="${esc(mission.id)}">
            삭제
          </button>
        </div>
      </div>

      <div class="mission-directive-quote"><strong>CEO 지시:</strong> ${esc(mission.directive)}</div>
      ${mission.leadPlanSummary ? `<div class="lead-plan-box"><strong>팀장 배분 전략:</strong> ${esc(mission.leadPlanSummary)}</div>` : ''}

      <div class="progress-row">
        <span class="mono">미션 진척도 ${pct}% (${completed}/${tasks.length} 완료)</span>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    </div>
  `;

  let bodyHtml = '';
  if (missionViewMode === 'board') {
    bodyHtml = renderKanbanBoard(tasks);
  } else if (missionViewMode === 'graph') {
    bodyHtml = renderDelegationSvg(mission, lead, tasks);
  } else {
    bodyHtml = renderTaskList(tasks);
  }

  const finalReportHtml = mission.finalReport
    ? `<div class="sheet final-report-sheet">
        <div class="sheet-header compact">
          <h3 class="sheet-title">총괄 팀장 최종 임원 보고서</h3>
          <div style="display:flex;gap:6px;">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-copy-final-report">복사</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-download-final-report">.md 다운로드</button>
          </div>
        </div>
        <div class="markdown-body">${renderMarkdown(mission.finalReport)}</div>
      </div>`
    : '';

  container.innerHTML = `${missionHeader}${bodyHtml}${finalReportHtml}`;
}

function formatMentions(text = '') {
  return esc(text).replace(/(@[^\s,!?]+)/g, '<span class="mention-tag">$1</span>');
}

function renderOfficeView() {
  const leadWrap = document.getElementById('office-lead-desks');
  const workerWrap = document.getElementById('office-worker-desks');
  const feedEl = document.getElementById('lounge-feed');
  if (!leadWrap || !workerWrap || !feedEl) return;

  const activeMission = state.missions.find((m) => m.id === selectedMissionId) || state.missions[0] || null;
  const missionTasks = activeMission ? state.tasks.filter((t) => t.missionId === activeMission.id) : [];
  const messages = state.messages || [];

  const badgeEl = document.getElementById('office-mission-badge');
  if (badgeEl) {
    badgeEl.textContent = activeMission ? `미션: ${activeMission.title.slice(0, 22)}` : '전사 대기';
  }

  // Handoff status bar
  const handoffEl = document.getElementById('office-handoff-text');
  if (handoffEl) {
    const latest = messages[messages.length - 1];
    let text = liveHandoffLabel;
    if (!text && latest) {
      const targetAg = latest.targetAgentId === 'ceo' ? { name: `${state.settings.ceoName || '대표님'} (CEO)` } : getAgent(latest.targetAgentId);
      text = targetAg
        ? `${latest.senderName}  ── ${latest.statusText || '협업'} ──▶  ${targetAg.name}`
        : `${latest.senderName}: ${latest.statusText || '회의실 발언 중'}`;
    }
    handoffEl.innerHTML = `<i data-lucide="radio" class="icon-xs"></i><span>${esc(text || '전 직원이 업무 채널에 접속해 있습니다.')}</span>`;
  }

  // Map latest speech per agent
  const latestByAgent = {};
  for (const m of messages) {
    if (m.senderId && m.senderId !== 'ceo') {
      latestByAgent[m.senderId] = m;
    }
  }

  const renderDesk = (ag) => {
    const myTasks = missionTasks.filter((t) => t.assigneeId === ag.id);
    const hasApproval = myTasks.some((t) => t.status === 'awaiting_approval');
    const isSpeaking = activeSpeakerId === ag.id;
    const latestMsg = latestByAgent[ag.id];

    let statusLabel = '업무 대기';
    if (!ag.active) statusLabel = '휴직';
    else if (isSpeaking) statusLabel = latestMsg?.statusText || '발언 · 협업 중';
    else if (hasApproval) statusLabel = 'CEO 결재 대기';
    else if (myTasks.some((t) => t.status === 'completed')) statusLabel = '작업 완료';
    else if (myTasks.length > 0) statusLabel = '업무 배정됨';

    const bubbleText = latestMsg
      ? latestMsg.text
      : myTasks[0]
        ? `배정 업무: "${myTasks[0].title}" 준비 중입니다.`
        : `${ag.strengths.slice(0, 52)}…`;

    const cls = `desk-card${isSpeaking ? ' speaking' : ''}${hasApproval && !isSpeaking ? ' waiting-approval' : ''}`;
    return `<button type="button" class="${cls}" data-mention-desk="${esc(ag.name)}">
      <div class="desk-head">
        <div class="desk-person">
          <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
          <div style="min-width:0;">
            <div class="desk-name">${esc(ag.name)}</div>
            <div class="desk-role">${esc(ag.roleTitle)}</div>
          </div>
        </div>
        <span class="desk-status">${esc(statusLabel)}</span>
      </div>
      <div class="desk-bubble">${esc(bubbleText)}</div>
      <div class="desk-work-bar"><div class="desk-work-bar-fill"></div></div>
    </button>`;
  };

  const leads = state.agents.filter((a) => a.tier === 'lead');
  const workers = state.agents.filter((a) => a.tier !== 'lead');
  leadWrap.innerHTML = leads.map(renderDesk).join('');
  workerWrap.innerHTML = workers.map(renderDesk).join('');

  // Render #전사-회의실 feed
  const typeBadges = {
    directive: { label: 'CEO 지시', cls: 'badge-neutral' },
    plan: { label: '팀장 분배', cls: 'badge-green' },
    handoff: { label: '팀원 핸드오프', cls: 'badge-blue' },
    approval: { label: '결재 상신', cls: 'badge-amber' },
    work: { label: '실무 보고', cls: 'badge-neutral' },
    ceo_chat: { label: 'CEO 발언', cls: 'badge-neutral' },
    reply: { label: '응답', cls: 'badge-green' }
  };

  feedEl.innerHTML =
    messages.length === 0
      ? '<div class="empty-state">아직 회의실 대화가 없습니다. 팀 스탠드업을 시작하거나 직원에게 말을 걸어보세요!</div>'
      : messages
          .map((m) => {
            const isCeo = m.senderId === 'ceo';
            const tb = typeBadges[m.type] || { label: '대화', cls: 'badge-neutral' };
            return `<div class="chat-msg ${isCeo ? 'from-ceo' : ''} ${m.type === 'approval' ? 'msg-approval' : ''}">
              <span class="agent-avatar" style="background:${esc(m.senderAccent || '#0E6245')}">${esc(m.senderShortCode || 'AI')}</span>
              <div class="chat-body">
                <div class="chat-meta">
                  <span class="chat-sender">${esc(m.senderName)}</span>
                  <span>${esc(m.senderRole || '')}</span>
                  <span class="badge ${tb.cls}">${esc(tb.label)}</span>
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

function renderKanbanBoard(tasks) {
  const columns = [
    { key: 'queued', title: '배정 · 실행 대기', filter: (t) => t.status === 'queued' || t.status === 'running' },
    { key: 'bridge', title: '앱 · MCP 전달 중', filter: (t) => t.status === 'awaiting_bridge' },
    { key: 'approval', title: 'CEO 결재 대기', filter: (t) => t.status === 'awaiting_approval' },
    { key: 'done', title: '완료 · 처리됨', filter: (t) => t.status === 'completed' || t.status === 'rejected' }
  ];

  return `<div class="kanban-grid">
    ${columns
      .map((col) => {
        const list = tasks.filter(col.filter);
        return `<div class="kanban-col">
          <div class="kanban-col-head">
            <span>${col.title}</span>
            <span class="mono">${list.length}</span>
          </div>
          <div class="kanban-cards">
            ${
              list.length === 0
                ? '<div class="form-hint" style="padding:12px 4px;text-align:center;">항목 없음</div>'
                : list
                    .map((t) => {
                      const ag = getAgent(t.assigneeId) || state.agents[0];
                      return `<article class="kanban-card">
                        <div style="display:flex;gap:5px;flex-wrap:wrap;">
                          <span class="badge badge-neutral">${esc(MODE_LABELS[ag.connectionMode])}</span>
                          ${t.requiresApproval ? '<span class="badge badge-amber">결재 게이트</span>' : ''}
                          ${t.estimatedCostKRW > 0 ? `<span class="badge badge-neutral mono">${formatKRW(t.estimatedCostKRW)}</span>` : ''}
                        </div>
                        <div class="kanban-card-title">${esc(t.title)}</div>
                        <div class="kanban-card-agent">
                          <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
                          <span>${esc(ag.name)}</span>
                        </div>
                        <div class="kanban-card-actions">
                          <button type="button" class="btn btn-ghost btn-sm" data-open-drawer="${esc(t.id)}">지시서 · 보고</button>
                          ${
                            t.status === 'awaiting_approval'
                              ? `<button type="button" class="btn btn-amber btn-sm" data-jump-approval="${esc(t.id)}">결재하기</button>`
                              : t.status !== 'completed'
                                ? `<button type="button" class="btn btn-primary btn-sm" data-run-task="${esc(t.id)}">실행</button>`
                                : ''
                          }
                        </div>
                      </article>`;
                    })
                    .join('')
            }
          </div>
        </div>`;
      })
      .join('')}
  </div>`;
}

function renderTaskList(tasks) {
  const agentOptions = state.agents
    .filter((a) => a.active)
    .map((a) => ({ id: a.id, label: `${a.name} (${MODE_LABELS[a.connectionMode]})` }));

  return `<div class="task-stack">
    ${tasks
      .map((t) => {
        const ag = getAgent(t.assigneeId) || state.agents[0];
        const st = STATUS_META[t.status] || { label: t.status, cls: 'badge-neutral' };
        const selectOpts = agentOptions
          .map(
            (opt) =>
              `<option value="${esc(opt.id)}" ${opt.id === t.assigneeId ? 'selected' : ''}>${esc(opt.label)}</option>`
          )
          .join('');

        return `<article class="task-row-card">
          <div class="task-top">
            <div>
              <h3 class="task-title">${esc(t.title)}</h3>
              <p class="task-desc">${esc(t.description)}</p>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
              ${t.requiresApproval ? '<span class="badge badge-amber">CEO 승인 필요</span>' : ''}
              ${t.estimatedCostKRW > 0 ? `<span class="badge badge-neutral mono">${formatKRW(t.estimatedCostKRW)}</span>` : ''}
              <span class="badge ${st.cls}">${esc(st.label)}</span>
            </div>
          </div>

          ${t.output ? `<div class="task-preview-box markdown-body">${renderMarkdown(t.output)}</div>` : ''}

          <div class="task-footer">
            <div class="assignee-pill">
              <span class="agent-avatar" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
              <select class="assignee-select" data-reassign-task="${esc(t.id)}" aria-label="담당 AI 변경">${selectOpts}</select>
              <span class="badge badge-neutral">${esc(COST_LABELS[ag.costTier])}</span>
            </div>

            <div class="task-controls">
              <button type="button" class="btn btn-ghost btn-sm" data-open-drawer="${esc(t.id)}">지시서 복사 · 결과 보고</button>
              ${
                t.status === 'awaiting_approval'
                  ? `<button type="button" class="btn btn-amber btn-sm" data-jump-approval="${esc(t.id)}">결재함 이동</button>`
                  : t.status !== 'completed'
                    ? `<button type="button" class="btn btn-primary btn-sm" data-run-task="${esc(t.id)}">실행</button>`
                    : ''
              }
            </div>
          </div>
        </article>`;
      })
      .join('')}
  </div>`;
}

function renderDelegationSvg(mission, lead, tasks) {
  const rowH = 74;
  const h = Math.max(260, tasks.length * rowH + 56);
  const w = 880;
  const cy = h / 2;

  const statusColor = (st) => {
    if (st === 'completed') return '#0e6245';
    if (st === 'awaiting_approval') return '#9e5606';
    if (st === 'rejected') return '#b42318';
    return '#1c5685';
  };

  const taskNodes = tasks
    .map((t, i) => {
      const ag = getAgent(t.assigneeId) || state.agents[0];
      const ty = 42 + i * rowH;
      const color = statusColor(t.status);
      const stLabel = (STATUS_META[t.status] || { label: t.status }).label;

      const edgeLeadToTask = `<path d="M 335 ${cy} C 385 ${cy}, 395 ${ty + 24}, 445 ${ty + 24}" fill="none" stroke="${color}" stroke-width="1.8" stroke-dasharray="${t.status === 'completed' ? '' : '4 4'}" opacity="0.7" />`;
      const edgeTaskToGate = t.requiresApproval
        ? `<path d="M 695 ${ty + 24} C 725 ${ty + 24}, 725 ${cy}, 755 ${cy}" fill="none" stroke="#9e5606" stroke-width="1.8" opacity="0.85" />`
        : '';

      return `
        ${edgeLeadToTask}
        ${edgeTaskToGate}
        <g class="flow-node" data-svg-task="${esc(t.id)}">
          <rect x="445" y="${ty}" width="250" height="50" rx="8" fill="var(--bg-surface)" stroke="${color}" stroke-width="1.4" />
          <rect x="454" y="${ty + 11}" width="28" height="28" rx="6" fill="${esc(ag.accent)}" />
          <text x="468" y="${ty + 29}" text-anchor="middle" fill="#ffffff" font-size="11" font-family="IBM Plex Mono" font-weight="600">${esc(ag.shortCode)}</text>
          <text x="492" y="${ty + 21}" fill="var(--ink-primary)" font-size="12" font-weight="700">${esc(ag.name)} · ${esc(stLabel)}</text>
          <text x="492" y="${ty + 38}" fill="var(--ink-secondary)" font-size="11">${esc(t.title.slice(0, 20))}${t.title.length > 20 ? '…' : ''}</text>
        </g>
      `;
    })
    .join('');

  return `<div class="sheet flow-graph-sheet">
    <div class="sheet-header compact">
      <div>
        <h3 class="sheet-title">실시간 지시 · 위임 토폴로지</h3>
        <p class="sheet-desc">팀원 노드를 클릭하면 맞춤 지시서와 실행 결과 드로어가 열립니다.</p>
      </div>
    </div>
    <svg class="flow-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="AI 조직 위임 흐름도">
      <!-- CEO Node -->
      <path d="M 140 ${cy} L 185 ${cy}" stroke="var(--border-strong)" stroke-width="2" />
      <g>
        <rect x="16" y="${cy - 28}" width="124" height="56" rx="10" fill="var(--ink-primary)" />
        <text x="78" y="${cy - 4}" text-anchor="middle" fill="var(--bg-canvas)" font-size="12" font-weight="700">${esc(state.settings.ceoName || 'CEO')}</text>
        <text x="78" y="${cy + 14}" text-anchor="middle" fill="var(--bg-canvas)" font-size="10.5" opacity="0.78">최종 지시권자</text>
      </g>

      <!-- Lead Node -->
      <g>
        <rect x="185" y="${cy - 30}" width="150" height="60" rx="10" fill="var(--accent-primary-soft)" stroke="var(--accent-primary)" stroke-width="1.6" />
        <text x="260" y="${cy - 5}" text-anchor="middle" fill="var(--accent-primary)" font-size="12.5" font-weight="700">${esc(lead?.name || '총괄 팀장')}</text>
        <text x="260" y="${cy + 13}" text-anchor="middle" fill="var(--ink-secondary)" font-size="10.5">업무 분배 · 종합 보고</text>
      </g>

      ${taskNodes}

      <!-- CEO Approval Gate Node -->
      <g>
        <rect x="755" y="${cy - 30}" width="112" height="60" rx="10" fill="var(--accent-amber-soft)" stroke="var(--accent-amber)" stroke-width="1.6" />
        <text x="811" y="${cy - 5}" text-anchor="middle" fill="var(--accent-amber)" font-size="12" font-weight="700">CEO 결재함</text>
        <text x="811" y="${cy + 13}" text-anchor="middle" fill="var(--ink-secondary)" font-size="10.5">결제·예약 승인</text>
      </g>
    </svg>
  </div>`;
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
        const sel = a.id === selectedApprovalId ? 'selected' : '';
        return `<button type="button" class="queue-item ${sel} ${isPending ? 'pending-stripe' : ''}" data-select-approval="${esc(a.id)}">
          <div class="queue-item-meta">
            <span>${esc(a.category)}</span>
            <span class="mono">${a.estimatedCostKRW > 0 ? formatKRW(a.estimatedCostKRW) : '무료'}</span>
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
      <div>
        <div class="memo-kicker">EXECUTIVE DECISION MEMO · ${esc(apr.id.toUpperCase())}</div>
        <h2 class="memo-title">${esc(apr.title)}</h2>
      </div>
      <span class="memo-stamp ${st.cls}">${esc(st.text)}</span>
    </div>

    <div class="memo-facts">
      <div>
        <div class="memo-fact-label">상신 AI 팀원</div>
        <div class="memo-fact-val">${esc(ag?.name || apr.agentId)}</div>
      </div>
      <div>
        <div class="memo-fact-label">예상 비용 / 예약금</div>
        <div class="memo-fact-val mono">${apr.estimatedCostKRW > 0 ? formatKRW(apr.estimatedCostKRW) : '비용 없음'}${apr.depositKRW ? ` (예약금 ${formatKRW(apr.depositKRW)})` : ''}</div>
      </div>
      <div>
        <div class="memo-fact-label">리스크 등급</div>
        <div class="memo-fact-val">${esc(apr.riskLevel.toUpperCase())} · ${esc(apr.category)}</div>
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
  const workers = state.agents.filter((a) => a.tier !== 'lead');
  const modeDot = (m) => (m === 'api' || m === 'litellm' ? 'dot-green' : m === 'mcp' ? 'dot-blue' : 'dot-amber');

  treeCanvas.innerHTML = `
    <div class="org-level">
      <div class="org-node-pill ceo-node">
        <span class="ceo-avatar" style="width:26px;height:26px;font-size:10px;">CEO</span>
        <div>
          <div class="org-node-name">${esc(state.settings.ceoName || '대표님')}</div>
          <div class="org-node-role">최종 지시 · 예산 통제 · 결재권자</div>
        </div>
      </div>
    </div>
    <div class="org-connector"></div>
    <div class="org-level">
      ${leads
        .map(
          (ag) => `<button type="button" class="org-node-pill ${ag.active ? '' : 'inactive'}" data-focus-agent="${esc(ag.id)}">
            <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
            <div style="text-align:left;">
              <div class="org-node-name">${esc(ag.name)}</div>
              <div class="org-node-role">${esc(ag.roleTitle)}</div>
            </div>
            <i class="dot ${modeDot(ag.connectionMode)}"></i>
          </button>`
        )
        .join('')}
    </div>
    <div class="org-connector"></div>
    <div class="org-level">
      ${workers
        .map(
          (ag) => `<button type="button" class="org-node-pill ${ag.active ? '' : 'inactive'}" data-focus-agent="${esc(ag.id)}">
            <span class="agent-avatar sm" style="background:${esc(ag.accent)}">${esc(ag.shortCode)}</span>
            <div style="text-align:left;">
              <div class="org-node-name">${esc(ag.name)}</div>
              <div class="org-node-role">${esc(COST_LABELS[ag.costTier])} · ${esc(MODE_LABELS[ag.connectionMode])}</div>
            </div>
            <i class="dot ${modeDot(ag.connectionMode)}"></i>
          </button>`
        )
        .join('')}
    </div>
  `;

  // Tier Cards
  const tiers = {
    lead: document.getElementById('roster-leads'),
    specialist: document.getElementById('roster-specialists'),
    executor: document.getElementById('roster-executors')
  };

  for (const key of Object.keys(tiers)) {
    const list = state.agents.filter((a) => a.tier === key);
    tiers[key].innerHTML = list
      .map(
        (ag) => `
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
          <p class="agent-guide">${esc(ag.bridgeGuide)}</p>

          <div class="agent-budget-bar">
            <span>월 예산 한도</span>
            <span class="mono">${ag.monthlyCapKRW > 0 ? `${formatKRW(ag.spentKRW || 0)} / ${formatKRW(ag.monthlyCapKRW)}` : '무료 · 0원 상한'}</span>
          </div>

          <div class="agent-card-controls">
            <select data-agent-mode="${esc(ag.id)}" aria-label="${esc(ag.name)} 연동 방식" style="width:auto;padding:5px 8px;font-size:12px;">
              <option value="api" ${ag.connectionMode === 'api' ? 'selected' : ''}>API 자동 (AI SDK)</option>
              <option value="litellm" ${ag.connectionMode === 'litellm' ? 'selected' : ''}>LiteLLM 프록시</option>
              <option value="mcp" ${ag.connectionMode === 'mcp' ? 'selected' : ''}>공식 MCP</option>
              <option value="bridge" ${ag.connectionMode === 'bridge' ? 'selected' : ''}>구독 · 앱 브릿지</option>
            </select>
            <button type="button" class="btn btn-ghost btn-sm" data-toggle-agent="${esc(ag.id)}">
              ${ag.active ? '휴직 전환' : '다시 활성화'}
            </button>
          </div>
        </article>
      `
      )
      .join('');
  }
}

function renderIntegrationsView() {
  const s = state.settings;
  document.getElementById('set-company-name').value = s.companyName || '';
  document.getElementById('set-ceo-name').value = s.ceoName || '';
  document.getElementById('set-cost-policy').value = s.defaultCostPolicy || 'balanced';
  document.getElementById('set-monthly-budget').value = s.monthlyBudgetKRW ?? 150000;
  document.getElementById('set-threshold').value = s.approvalThresholdKRW ?? 30000;
  document.getElementById('set-webhook-url').value = s.webhookUrl || '';

  const p = s.providers || {};
  document.getElementById('model-gemini-free').value = p.gemini?.freeModel || 'gemini-2.5-flash';
  document.getElementById('model-gemini-paid').value = p.gemini?.paidModel || 'gemini-4-neon';
  document.getElementById('model-claude').value = p.claude?.model || 'claude-sonnet-4-5';
  document.getElementById('email-cue').value = p.manus?.cueEmail || '';
  document.getElementById('url-litellm').value = p.litellm?.baseUrl || 'http://localhost:4000/v1';
  document.getElementById('model-litellm').value = p.litellm?.model || 'gemini-free';
  document.getElementById('url-ollama').value = p.ollama?.baseUrl || 'http://localhost:11434/v1';
  document.getElementById('model-ollama').value = p.ollama?.model || 'qwen2.5:14b';

  setKeyStatus('status-gemini', p.gemini);
  setKeyStatus('status-claude', p.claude);
  setKeyStatus('status-manus', p.manus);
  setKeyStatus('status-litellm', p.litellm);

  const tg = s.telegram || {};
  document.getElementById('tg-chat-id').value = tg.chatId || '';
  document.getElementById('tg-polling-enabled').checked = Boolean(tg.pollingEnabled);
  const tgStatus = document.getElementById('status-telegram');
  if (tgStatus) {
    if (tg.hasBotToken) {
      tgStatus.textContent = `연결됨 (${tg.botTokenPreview})`;
      tgStatus.classList.add('ok');
    } else {
      tgStatus.textContent = '미연결';
      tgStatus.classList.remove('ok');
    }
  }

  const endpoint = `${window.location.origin}/api/mcp`;
  document.getElementById('mcp-endpoint-url').textContent = endpoint;
  document.getElementById('mcp-token-value').textContent = `Bearer ${s.mcpToken || ''}`;
  renderMcpSnippet(endpoint, s.mcpToken || '');

  if (ossStack) {
    document.getElementById('oss-builtin-grid').innerHTML = ossStack.builtIn
      .map(
        (item) => `<article class="oss-card">
          <div class="oss-card-head">
            <div>
              <div class="oss-name">${esc(item.name)}</div>
              <a class="oss-repo" href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(item.repo)}</a>
            </div>
            <span class="badge badge-green mono">${esc(item.version)}</span>
          </div>
          <p class="oss-role">${esc(item.role)}</p>
        </article>`
      )
      .join('');

    document.getElementById('oss-pluggable-grid').innerHTML = ossStack.pluggable
      .map(
        (item) => `<article class="oss-card">
          <div class="oss-card-head">
            <div>
              <div class="oss-name">${esc(item.name)}</div>
              <a class="oss-repo" href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(item.repo)}</a>
            </div>
            <span class="badge badge-blue">연동 지원</span>
          </div>
          <p class="oss-role">${esc(item.role)}</p>
        </article>`
      )
      .join('');
  }
}

function setKeyStatus(elId, providerObj) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (providerObj?.hasApiKey) {
    el.textContent = `연결됨 (${providerObj.apiKeyPreview})`;
    el.classList.add('ok');
  } else {
    el.textContent = '미연결 (브릿지/시뮬레이션)';
    el.classList.remove('ok');
  }
}

function renderMcpSnippet(endpoint, token) {
  const snippets = {
    muse: `# Meta Muse 앱 → Settings → Connectors → Add custom connector
Remote MCP Server URL:
${endpoint}

Authorization Header:
Bearer ${token}

# 연결 후 Muse 채팅창에서 테스트:
"CEO Office MCP(list_my_tasks)에서 내게 배정된 업무를 가져와 처리하고 보고해줘."`,
    claude: JSON.stringify(
      {
        mcpServers: {
          'ceo-office-hub': {
            type: 'http',
            url: endpoint,
            headers: { Authorization: `Bearer ${token}` }
          }
        }
      },
      null,
      2
    ),
    cue: `# Manus / Cue → Settings → Integrations → Custom MCP Server
URL: ${endpoint}
Header: Authorization: Bearer ${token}

# 등록된 공식 MCP 도구 (@modelcontextprotocol/sdk):
- get_company_brief
- list_my_tasks (agent_id: "agent_cue")
- submit_task_result
- request_ceo_approval`
  };
  document.getElementById('mcp-snippet-box').textContent = snippets[currentMcpTab] || snippets.muse;
}

function renderTaskDrawer(task) {
  const ag = getAgent(task.assigneeId) || state.agents[0];
  const cueEmail = state.settings?.providers?.manus?.cueEmail || '';
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
        <button type="button" class="btn btn-primary btn-sm" id="btn-copy-dispatch">지시서 원클릭 복사</button>
        ${mailtoLink ? `<a class="btn btn-ghost btn-sm" href="${mailtoLink}">Cue 전용 이메일로 발송</a>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-run-task="${esc(task.id)}">
          ${ag.connectionMode === 'api' || ag.connectionMode === 'litellm' ? 'AI SDK 즉시 실행' : '드라이런 시뮬레이션'}
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
      <p class="form-hint">피클, 부이, 인스팅스, Muse, 또는 Claude/Gemini 웹 구독에서 받은 결과를 붙여넣으면 팀장 종합 보고와 결재함에 즉시 반영됩니다.</p>
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

function switchView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
  document.querySelectorAll('.view').forEach((sec) => {
    sec.classList.toggle('active', sec.id === `view-${viewName}`);
  });
  document.querySelector('.sidebar').classList.remove('mobile-open');
  renderChrome();
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
    toast(next === 'studio' ? '웜 스튜디오 다크 테마로 전환했습니다.' : '에디토리얼 페이퍼 테마로 전환했습니다.');
  });

  // Navigation
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('mobile-open');
  });
  document.getElementById('btn-open-approvals-quick').addEventListener('click', () => switchView('approvals'));
  document.getElementById('kpi-approvals-cell').addEventListener('click', () => switchView('approvals'));
  document.getElementById('kpi-oss-cell').addEventListener('click', () => {
    switchView('integrations');
    switchHubTab('oss');
  });
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
      toast('업무 템플릿을 채웠습니다. 팀장에게 지시를 하달해 보세요.');
    });
  });

  // Hire open-source presets
  document.querySelectorAll('[data-hire-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = HIRE_PRESETS[btn.dataset.hirePreset];
      if (!p) return;
      document.getElementById('hire-name').value = p.name;
      document.getElementById('hire-role').value = p.role;
      document.getElementById('hire-tier').value = p.tier;
      document.getElementById('hire-mode').value = p.mode;
      document.getElementById('hire-cost').value = p.cost;
      document.getElementById('hire-provider').value = p.provider;
      document.getElementById('hire-model').value = p.model;
      document.getElementById('hire-cap').value = p.cap;
      document.getElementById('hire-strengths').value = p.strengths;
    });
  });

  // Submit directive
  document.getElementById('directive-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('btn-submit-directive');
    const directive = document.getElementById('input-directive').value.trim();
    const title = document.getElementById('input-mission-title').value.trim();
    const domain = document.getElementById('input-mission-domain').value;
    const costPolicy = document.getElementById('input-cost-policy').value;

    submitBtn.disabled = true;
    submitBtn.textContent = '팀장이 분배 중…';
    try {
      const res = await api('/api/missions', {
        method: 'POST',
        body: JSON.stringify({ title, directive, domain, costPolicy })
      });
      state = res.state;
      selectedMissionId = res.mission.id;
      document.getElementById('input-mission-title').value = '';
      document.getElementById('input-directive').value = '';
      renderAll();
      toast(`총괄 팀장이 ${res.tasks.length}개 실무 작업으로 분배했습니다.`);
    } catch (err) {
      toast(err.message, true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="send" class="icon-xs"></i><span>팀장에게 지시 하달</span>';
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

    if (target.dataset.selectMission) {
      selectedMissionId = target.dataset.selectMission;
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

    if (target.id === 'btn-run-all-mission') {
      const missionId = target.dataset.missionId;
      target.disabled = true;
      target.textContent = '팀원 병렬 실행 중…';
      try {
        const res = await api(`/api/missions/${missionId}/run-all`, { method: 'POST' });
        state = res.state;
        renderAll();
        toast(`${res.ranCount}개 업무를 병렬 처리했습니다. 결재 대기 항목을 확인하세요.`);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.id === 'btn-open-office-mission') {
      switchView('office');
      renderOfficeView();
      refreshIcons();
      return;
    }

    if (target.dataset.mentionDesk) {
      const name = target.dataset.mentionDesk.split(' ')[0];
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

    if (target.id === 'btn-start-standup') {
      if (isPlayingLiveSession) return;
      const missionId = selectedMissionId || state.missions[0]?.id;
      if (!missionId) {
        toast('먼저 지휘실에서 미션을 생성해 주세요.', true);
        return;
      }
      const prevHtml = target.innerHTML;
      target.disabled = true;
      target.textContent = '팀 회의 소집 중…';
      try {
        const baseMsgs = [...(state.messages || [])];
        const res = await api(`/api/missions/${missionId}/standup`, { method: 'POST' });
        await playLiveMessages(baseMsgs, res.turns || [], res.state);
        toast('팀 스탠드업 및 협업 보고가 완료되었습니다.');
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
      if (!confirm('이 미션과 하위 업무를 삭제할까요?')) return;
      try {
        const res = await api(`/api/missions/${missionId}`, { method: 'DELETE' });
        state = res.state;
        selectedMissionId = state.missions[0]?.id || null;
        renderAll();
        toast('미션을 삭제했습니다.');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset.selectApproval) {
      selectedApprovalId = target.dataset.selectApproval;
      renderApprovalsView();
      refreshIcons();
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
            ? 'CEO 승인이 확정되었습니다.'
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
          body: JSON.stringify({ provider })
        });
        toast(`${provider} 연결 성공 (${res.model}): ${res.reply}`);
      } catch (err) {
        toast(err.message, true);
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
        toast(`텔레그램 연결 성공 (@${res.botUsername})! 테스트 메시지를 보냈습니다.`);
      } catch (err) {
        toast(err.message, true);
      } finally {
        target.disabled = false;
        target.textContent = prev;
      }
      return;
    }

    if (target.id === 'btn-test-webhook') {
      try {
        const res = await api('/api/webhook/test', { method: 'POST' });
        toast(res.ok ? 'Webhook 테스트 알림을 전송했습니다!' : `Webhook 응답 오류: ${res.error || res.status}`, !res.ok);
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (target.dataset.mcpTab) {
      currentMcpTab = target.dataset.mcpTab;
      document.querySelectorAll('[data-mcp-tab]').forEach((b) => b.classList.toggle('active', b === target));
      renderMcpSnippet(`${window.location.origin}/api/mcp`, state.settings.mcpToken || '');
      return;
    }

    if (target.id === 'btn-copy-mcp-snippet') {
      copyText(document.getElementById('mcp-snippet-box').textContent, 'MCP 연결 설정을 복사했습니다.');
      return;
    }

    if (target.dataset.mcpTest) {
      const action = target.dataset.mcpTest;
      const out = document.getElementById('mcp-test-output');
      out.textContent = '공식 @modelcontextprotocol/sdk 엔드포인트로 요청 중…';
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

    if (target.dataset.loadExport) {
      const which = target.dataset.loadExport;
      const box = document.getElementById('oss-export-preview');
      box.textContent = '불러오는 중…';
      try {
        const text = await api(`/api/exports/${which}`);
        box.textContent = text;
      } catch (err) {
        box.textContent = `오류: ${err.message}`;
      }
      return;
    }

    if (target.id === 'btn-copy-export') {
      copyText(document.getElementById('oss-export-preview').textContent, '오픈소스 배포 설정을 복사했습니다.');
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

  // Hire Modal
  const hireBackdrop = document.getElementById('hire-modal-backdrop');
  const openHire = () => {
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
    const payload = {
      name: document.getElementById('hire-name').value.trim(),
      roleTitle: document.getElementById('hire-role').value.trim(),
      tier: document.getElementById('hire-tier').value,
      connectionMode: document.getElementById('hire-mode').value,
      costTier: document.getElementById('hire-cost').value,
      provider: document.getElementById('hire-provider').value,
      modelId: document.getElementById('hire-model').value.trim(),
      monthlyCapKRW: Number(document.getElementById('hire-cap').value) || 0,
      strengths: document.getElementById('hire-strengths').value.trim()
    };
    try {
      const res = await api('/api/agents', { method: 'POST', body: JSON.stringify(payload) });
      state = res.state;
      e.target.reset();
      closeHire();
      renderAll();
      toast(`${res.agent.name} 팀원이 조직에 합류했습니다.`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Save Settings
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      companyName: document.getElementById('set-company-name').value.trim(),
      ceoName: document.getElementById('set-ceo-name').value.trim(),
      defaultCostPolicy: document.getElementById('set-cost-policy').value,
      monthlyBudgetKRW: Number(document.getElementById('set-monthly-budget').value) || 0,
      approvalThresholdKRW: Number(document.getElementById('set-threshold').value) || 0,
      webhookUrl: document.getElementById('set-webhook-url').value.trim(),
      telegram: {
        botToken: document.getElementById('tg-bot-token').value.trim(),
        chatId: document.getElementById('tg-chat-id').value.trim(),
        pollingEnabled: document.getElementById('tg-polling-enabled').checked
      },
      providers: {
        gemini: {
          apiKey: document.getElementById('key-gemini').value.trim(),
          freeModel: document.getElementById('model-gemini-free').value.trim(),
          paidModel: document.getElementById('model-gemini-paid').value.trim()
        },
        claude: {
          apiKey: document.getElementById('key-claude').value.trim(),
          model: document.getElementById('model-claude').value.trim()
        },
        manus: {
          apiKey: document.getElementById('key-manus').value.trim(),
          cueEmail: document.getElementById('email-cue').value.trim()
        },
        litellm: {
          apiKey: document.getElementById('key-litellm').value.trim(),
          baseUrl: document.getElementById('url-litellm').value.trim(),
          model: document.getElementById('model-litellm').value.trim()
        },
        ollama: {
          baseUrl: document.getElementById('url-ollama').value.trim(),
          model: document.getElementById('model-ollama').value.trim()
        }
      }
    };
    try {
      const res = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      state = res.state;
      ['key-gemini', 'key-claude', 'key-manus', 'key-litellm', 'tg-bot-token'].forEach((id) => {
        document.getElementById(id).value = '';
      });
      renderAll();
      toast('연동 설정 · 텔레그램 봇 · 예산 정책을 저장했습니다.');
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
        const res = await api('/api/chat/send', {
          method: 'POST',
          body: JSON.stringify({ text, missionId: selectedMissionId })
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
      toast(res.live ? 'Vercel AI SDK로 실시간 실행을 완료했습니다.' : '시뮬레이션 실행을 완료했습니다.');
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
    const subEl = document.querySelector('.brand-sub');
    if (subEl) {
      subEl.textContent = runtimeMode === 'server' ? 'Hono · MCP · AI SDK 서버' : 'GitHub Pages 실사용 모드';
    }
    const [st, oss] = await Promise.all([api('/api/state'), api('/api/oss-stack')]);
    state = st;
    ossStack = oss;
    document.getElementById('input-cost-policy').value = state.settings.defaultCostPolicy || 'balanced';
    renderAll();
    // Preload litellm_config.yaml preview
    api('/api/exports/litellm')
      .then((txt) => {
        document.getElementById('oss-export-preview').textContent = txt;
      })
      .catch(() => {});
  } catch (err) {
    toast(`초기 데이터 로드 실패: ${err.message}`, true);
  }
}

init();
