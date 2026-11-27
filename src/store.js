import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

export function resolveStableMcpToken() {
  if (process.env.MCP_TOKEN && process.env.MCP_TOKEN.trim()) {
    return process.env.MCP_TOKEN.trim();
  }
  const renderSeed = process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_HOSTNAME || '';
  if (renderSeed) {
    const secretSalt = String(process.env.GITHUB_GIST_TOKEN || '').trim() || 'local-dev-salt';
    const hash = crypto
      .createHmac('sha256', secretSalt)
      .update(`ceo-office-stable-v2:${renderSeed}`)
      .digest('hex')
      .slice(0, 24);
    return `ceo_mcp_${hash}`;
  }
  return `ceo_mcp_${crypto.randomBytes(12).toString('hex')}`;
}

export function createDefaultState() {
  const now = new Date().toISOString();
  const sampleMissionId = 'msn_welcome_01';

  return {
    settings: {
      companyName: 'CEO Office',
      ceoName: '대표님',
      defaultCostPolicy: 'free_first', // 사전 최적화: 추가 API 과금 0원 (무료 자동 + 기존 구독 브릿지)
      monthlyBudgetKRW: 150000,
      spentThisMonthKRW: 40000,
      approvalThresholdKRW: 30000,
      requireApprovalForExternal: true,
      webhookUrl: process.env.WEBHOOK_URL || '', // Slack / Discord / n8n / OpenClaw approval alert webhook
      telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN || '',
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        pollingEnabled: process.env.TELEGRAM_POLLING === 'true'
      },
      mcpToken: resolveStableMcpToken(),
      providers: {
        gemini: {
          apiKey: process.env.GEMINI_API_KEY || '',
          freeModel: 'gemini-4-hydrogen',
          paidModel: 'gemini-4-neon',
          enabled: Boolean(process.env.GEMINI_API_KEY)
        },
        groq: {
          apiKey: process.env.GROQ_API_KEY || '',
          baseUrl: 'https://api.groq.com/openai/v1',
          model: 'openai/gpt-oss-120b',
          enabled: Boolean(process.env.GROQ_API_KEY)
        },
        openrouter: {
          apiKey: process.env.OPENROUTER_API_KEY || '',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openrouter/free',
          enabled: Boolean(process.env.OPENROUTER_API_KEY)
        },
        manus: {
          apiKey: process.env.MANUS_API_KEY || '',
          baseUrl: 'https://api.manus.ai/v1',
          cueEmail: '',
          enabled: Boolean(process.env.MANUS_API_KEY)
        },
        exaone: {
          apiKey: process.env.EXAONE_API_KEY || '',
          baseUrl: process.env.EXAONE_BASE_URL || 'https://api.exaone.ai/v1',
          model: process.env.EXAONE_MODEL || 'k-exaone_v2.5',
          enabled: Boolean(process.env.EXAONE_API_KEY)
        },
        litellm: {
          apiKey: process.env.LITELLM_MASTER_KEY || '',
          baseUrl: process.env.LITELLM_BASE_URL || 'http://localhost:4000/v1',
          model: 'gemini-free',
          enabled: Boolean(process.env.LITELLM_MASTER_KEY)
        },
        ollama: {
          apiKey: '',
          baseUrl: 'http://localhost:11434/v1',
          model: 'qwen2.5:14b',
          enabled: false
        },
        githubRepo: {
          apiKey: process.env.GITHUB_REPO_TOKEN || '',
          repo: process.env.GITHUB_REPO || 'alpinu83/ai-ceo-hub',
          allowedRepos:
            process.env.GITHUB_ALLOWED_REPOS ||
            'alpinu83/ai-ceo-hub, alpinu83/kr-calc-hub, alpinu83/alpinu83.github.io',
          branch: process.env.GITHUB_BRANCH || 'main',
          enabled: Boolean(process.env.GITHUB_REPO_TOKEN)
        }
      }
    },
    agents: [
      {
        id: 'agent_gemini_neon',
        name: 'Gemini 4 Hydrogen (API)',
        shortCode: 'GM',
        roleTitle: '비상 대기 팀장 (Gemini API · 평소 대기)',
        tier: 'lead',
        reportsTo: 'ceo',
        provider: 'gemini',
        modelId: 'gemini-4-hydrogen',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://aistudio.google.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev', 'life'],
        strengths: '비상 대기 모드 — 주간 AGY(Hydrogen)·야간 Gemini 앱이 모두 처리 못 할 때와 회의실 즉답에만 자동 개입 (평소 실무 배정 제외)',
        bridgeGuide: '팀장 업무함(주간 AGY · 야간 Gemini 앱) 가동 중에는 비상 대기 모드로 유지됩니다.',
        active: true,
        accent: '#0E6245'
      },
      {
        id: 'agent_deepseek',
        name: 'Nemotron 3 Ultra (OR)',
        shortCode: 'NM',
        roleTitle: '심층 추론·전략·수익 분석 팀원 (OpenRouter 무료 550B)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'openrouter',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://openrouter.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'dev'],
        strengths: 'OpenRouter 무료 1위 550B 추론 엔진(Nemotron 3 Ultra · 자동 openrouter/free 백업)으로 수익 모델 설계, 데이터 분석, 리스크 검증 수행',
        bridgeGuide: 'OpenRouter 무료 API 키(sk-or-v1-…)를 저장하면 0원으로 자동 실행됩니다.',
        active: true,
        accent: '#2563EB'
      },
      {
        id: 'agent_gemma',
        name: 'Gemma 4 31B (OR)',
        shortCode: 'G4',
        roleTitle: '기획·UX·글쓰기·다목적 실무 팀원 (OpenRouter 무료)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'openrouter',
        modelId: 'google/gemma-4-31b-it:free',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://openrouter.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['content', 'business', 'dev'],
        strengths: 'Google Gemma 4 31B 무료 모델로 기획안, 사용자 UX 개선, 깔끔한 카피라이팅·문서·코드 보조 수행',
        bridgeGuide: 'OpenRouter 무료 API 키(sk-or-v1-…)를 공유해 0원으로 자동 실행됩니다. (한도 절약 시 AI 팀에서 비활성 가능)',
        active: true,
        accent: '#0891B2'
      },
      {
        id: 'agent_qwen',
        name: 'Qwen 3.8 (Groq)',
        shortCode: 'QW',
        roleTitle: '코딩·웹개발·자동화 전문 팀원 (Groq 무료)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'groq',
        modelId: 'qwen/qwen3.8-27b',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://console.groq.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'business'],
        strengths: 'Groq 최신 무료 Qwen 3.8 27B로 코드 작성, SEO·웹사이트 개선, 자동화 스크립트 구현',
        bridgeGuide: 'Groq 무료 API 키(gsk_…)를 저장하면 0원으로 자동 실행됩니다.',
        active: true,
        accent: '#6D28D9'
      },
      {
        id: 'agent_groq',
        name: 'GPT-OSS 120B (Groq)',
        shortCode: 'GQ',
        roleTitle: '초고속 기획·마케팅·문서 팀원 (Groq 무료)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'groq',
        modelId: 'openai/gpt-oss-120b',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://console.groq.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev'],
        strengths: 'Groq 초고속 무료 API(GPT-OSS 120B · 500t/s)로 콘텐츠 기획, 마케팅 카피, 구조화 초안을 초단위로 작성',
        bridgeGuide: 'Groq 무료 API 키(gsk_…)를 설정에 저장하면 즉시 0원으로 자동 실행됩니다.',
        active: true,
        accent: '#C2410C'
      },
      {
        id: 'agent_exaone',
        name: 'LG K-EXAONE 2.5',
        shortCode: 'EX',
        roleTitle: '한국어 실무·요약·단순업무 에이스 (무료 자동)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'exaone',
        modelId: 'k-exaone_v2.5',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://docs.exaone.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev', 'life'],
        strengths: 'LG AI연구원 무료 K-EXAONE 2.5 API(512K 컨텍스트). 한국어 문서 요약, 이메일 초안, 단순 반복 정리, 코딩 보조를 비용 0원 자동 실행',
        bridgeGuide: '보유하신 LG EXAONE API 키를 빠른 시작 화면에 넣으면 https://api.exaone.ai/v1 로 즉시 무료 자동 가동됩니다.',
        active: true,
        accent: '#A50034'
      },
      {
        id: 'agent_muse',
        name: 'Meta Muse',
        shortCode: 'MS',
        roleTitle: '개인 컨텍스트·프로젝트 팀원 (무료 MCP)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'muse',
        modelId: 'meta-muse',
        connectionMode: 'mcp',
        costTier: 'free',
        appUrl: 'https://www.meta.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['life', 'business', 'content'],
        strengths: 'CEO 취향·제약 장기 기억, Spaces 프로젝트 보드, 이메일 정리 및 개인화 기획',
        bridgeGuide: 'Render 무료 MCP 서버(/api/mcp)를 Muse Settings → Connectors에 등록하면 복사·붙여넣기 없이 자동 연동됩니다.',
        active: true,
        accent: '#2B59C3'
      },
      {
        id: 'agent_cue',
        name: 'Manus Cue',
        shortCode: 'CU',
        roleTitle: '자율 리서치·메일 팀원 (무료 MCP)',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'manus',
        modelId: 'manus-cue',
        connectionMode: 'mcp',
        costTier: 'freemium',
        appUrl: 'https://manus.im',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev'],
        strengths: '에이전트 전용 이메일·전화번호·가상 컴퓨터 기반 딥 리서치 및 외부 메일 송수신',
        bridgeGuide: 'Render 무료 MCP 서버(/api/mcp)를 Cue Integrations에 연결하거나 전용 이메일(Mail Manus)로 자동 지시합니다.',
        active: true,
        accent: '#3F6212'
      },
      {
        id: 'agent_pickle',
        name: '피클 (Pickle)',
        shortCode: 'PK',
        roleTitle: '한국 전화 예약·생활 실행 팀원 (무료 앱)',
        tier: 'executor',
        reportsTo: 'agent_gemini_neon',
        provider: 'pickle',
        modelId: 'pickle-app',
        connectionMode: 'bridge',
        costTier: 'free',
        appUrl: 'https://pickle.com/ko',
        monthlyCapKRW: 50000,
        spentKRW: 40000,
        domains: ['life', 'business'],
        strengths: '국내 식당·병원 전화 문의 및 예약, KTX·국내 플랫폼 실행 (결제 전 CEO 승인 필수)',
        bridgeGuide: '사전 추천 설정: 승인 멈춤 조건이 자동 삽입된 지시서를 복사해 피클 앱에 전달하고, 예약·결제 직전 CEO 결재를 받습니다.',
        active: true,
        accent: '#2F7D32'
      },
      {
        id: 'agent_vooy',
        name: '부이 (vooy)',
        shortCode: 'VY',
        roleTitle: '정기 브리핑·가격 모니터링 팀원 (무료)',
        tier: 'executor',
        reportsTo: 'agent_gemini_neon',
        provider: 'vooy',
        modelId: 'vooy-app',
        connectionMode: 'bridge',
        costTier: 'free',
        appUrl: '',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['life', 'business', 'content'],
        strengths: '매일 아침 같은 조건으로 뉴스·트렌드·상품 가격 반복 수집, 모임·여행 일정 조율',
        bridgeGuide: '사전 추천 설정: 기본 무료 모델만 쓰도록 조건이 들어간 지시서를 복사해 부이 앱에 등록합니다.',
        active: true,
        accent: '#A15C07'
      },
      {
        id: 'agent_agy',
        name: 'AGY (Antigravity)',
        shortCode: 'AG',
        roleTitle: '개발팀 · 구현·테스트·PR · 주간 팀장',
        tier: 'specialist',
        team: 'dev',
        reportsTo: 'agent_gemini_neon',
        provider: 'antigravity',
        modelId: 'gemini-4-carbon',
        connectionMode: 'bridge',
        costTier: 'paid_or_sub',
        appUrl: '',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'it_ops', 'business'],
        strengths: '대표님 PC의 Antigravity: 여러 파일 구현, git·npm test 실행, PR 작성. 주간에는 팀장 업무함(Hydrogen)도 맡음',
        active: true,
        accent: '#1A73E8'
      },
      {
        id: 'agent_aside',
        name: 'Aside',
        shortCode: 'AS',
        roleTitle: '개발팀 · 설계·검수·브라우저·계정',
        tier: 'specialist',
        team: 'dev',
        reportsTo: 'agent_gemini_neon',
        provider: 'aside',
        modelId: 'claude',
        connectionMode: 'bridge',
        costTier: 'paid_or_sub',
        appUrl: '',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'it_ops', 'business', 'content'],
        strengths: '대표님 PC의 Aside 브라우저: 설계·원인 분석, 코드 검수·작은 수정, 로그인된 콘솔·계정 작업, 실제 데이터 확인',
        active: true,
        accent: '#111827'
      },
      {
        id: 'agent_instinct',
        name: '인스팅스 (Instinct)',
        shortCode: 'IN',
        roleTitle: '문자·전화 빠른 심부름 팀원 (무료 베타)',
        tier: 'executor',
        reportsTo: 'agent_gemini_neon',
        provider: 'instinct',
        modelId: 'instinct-beta',
        connectionMode: 'bridge',
        costTier: 'free',
        appUrl: '',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['life'],
        strengths: '별도 앱 없이 문자(iMessage/WhatsApp)·전화만으로 빠르게 처리하는 생활 심부름',
        bridgeGuide: '사전 추천 설정: 짧은 문자 지시문을 원클릭 복사해 인스팅스 대화방에 그대로 보내고 회신을 등록합니다.',
        active: true,
        accent: '#52525B'
      },
      {
        id: 'agent_it_dev',
        name: 'IT 개발 · Qwen 3.8',
        shortCode: 'ID',
        roleTitle: 'IT팀 풀스택 개발·버그 보수 (Groq 무료)',
        team: 'it',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'groq',
        modelId: 'qwen/qwen3.8-27b',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://console.groq.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'it_ops'],
        strengths: 'CEO Office 자체 UI·API 기능 보수, 버그 수정 패치(diff) 작성, 리팩토링 및 성능 최적화 전담',
        bridgeGuide: 'Groq 무료 API 키로 GM Corp IT팀 개발 보수 작업을 0원 자동 수행합니다.',
        active: true,
        accent: '#0F766E'
      },
      {
        id: 'agent_it_sec',
        name: 'IT 보안 · Nemotron',
        shortCode: 'IS',
        roleTitle: 'IT팀 보안 감사·아키텍처 리뷰 (OR 무료 550B)',
        team: 'it',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'openrouter',
        modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://openrouter.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'it_ops'],
        strengths: 'API 키·토큰·인증 보안 감사, 취약점 진단, 코드 리뷰 및 실배포 전 안전성 검증 전담',
        bridgeGuide: 'OpenRouter 무료 API 키로 GM Corp IT팀 보안 감사를 0원 자동 수행합니다.',
        active: true,
        accent: '#1E3A8A'
      },
      {
        id: 'agent_it_qa',
        name: 'IT QA · GPT-OSS',
        shortCode: 'IQ',
        roleTitle: 'IT팀 테스트·QA·릴리스 검증 (Groq 무료)',
        team: 'it',
        tier: 'specialist',
        reportsTo: 'agent_gemini_neon',
        provider: 'groq',
        modelId: 'openai/gpt-oss-120b',
        connectionMode: 'api',
        costTier: 'free',
        appUrl: 'https://console.groq.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'it_ops'],
        strengths: 'E2E 테스트 시나리오 작성, 회귀 버그 검증 체크리스트, PR 설명 및 릴리스 노트 작성 전담',
        bridgeGuide: 'Groq 무료 API 키로 GM Corp IT팀 QA·릴리스 검증을 0원 자동 수행합니다.',
        active: true,
        accent: '#9A3412'
      }
    ],
    missions: [],
    tasks: [],
    approvals: [],
    logs: [],
    messages: []
  };
}

// One shared in-memory DB for the whole process.
// Previously every request re-read the file and long AI calls saved stale copies over each other
// (lost updates between chat, auto-run, watchdog, approvals). Now all handlers mutate the same object.
let dbCache = null;

export function invalidateDbCache() {
  dbCache = null;
}

export function loadDb() {
  if (dbCache) return dbCache;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const initial = createDefaultState();
    saveDb(initial);
    return initial;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Migrate v1 state smoothly if missing v2 fields
    const def = createDefaultState();
    parsed.settings = {
      ...def.settings,
      ...(parsed.settings || {}),
      telegram: {
        ...def.settings.telegram,
        ...(parsed.settings?.telegram || {})
      },
      providers: {
        ...def.settings.providers,
        ...(parsed.settings?.providers || {})
      }
    };
    const rawAgents = (parsed.agents || def.agents)
      .filter((a) => a.id !== 'agent_gemini_free' && a.id !== 'agent_claude')
      .map((a) => {
        if (a.id === 'agent_gemini_neon') {
          return {
            ...a,
            name: 'Gemini 4 Hydrogen (API)',
            shortCode: 'GM',
            roleTitle: '비상 대기 팀장 (Gemini API · 평소 대기)',
            modelId: 'gemini-4-hydrogen',
            connectionMode: 'api',
            costTier: 'free',
            reportsTo: 'ceo'
          };
        }
        if (a.id === 'agent_groq' && (a.name === 'Groq' || a.modelId === 'llama-3.3-70b-versatile')) {
          return {
            ...a,
            name: 'GPT-OSS 120B (Groq)',
            shortCode: 'GQ',
            roleTitle: '초고속 기획·마케팅·문서 팀원 (Groq 무료)',
            modelId: 'openai/gpt-oss-120b'
          };
        }
        if (a.id === 'agent_qwen' && a.modelId === 'qwen/qwen3-32b') {
          return {
            ...a,
            name: 'Qwen 3.8 (Groq)',
            shortCode: 'QW',
            roleTitle: '코딩·웹개발·자동화 전문 팀원 (Groq 무료)',
            modelId: 'qwen/qwen3.8-27b'
          };
        }
        if (
          a.id === 'agent_deepseek' &&
          (a.modelId === 'deepseek/deepseek-r1:free' || a.modelId === 'nvidia/nemotron-3-ultra-550b-a55b:free')
        ) {
          return {
            ...a,
            name: 'Nemotron 3.5 (OR)',
            shortCode: 'NM',
            roleTitle: '심층 추론·전략·수익 분석 팀원 (OpenRouter 무료 1M)',
            modelId: 'nvidia/nemotron-3.5-lightning:free'
          };
        }
        if (a.id === 'agent_it_sec' && a.modelId === 'nvidia/nemotron-3-ultra-550b-a55b:free') {
          return {
            ...a,
            name: 'IT 보안 · Nemotron',
            roleTitle: 'IT팀 보안 감사·아키텍처 리뷰 (OR 무료 · 자동 백업)',
            modelId: 'nvidia/nemotron-3.5-lightning:free'
          };
        }
        return {
          reportsTo: a.tier === 'lead' ? 'ceo' : 'agent_gemini_neon',
          monthlyCapKRW: 0,
          spentKRW: 0,
          ...a
        };
      });
    for (const requiredId of ['agent_groq', 'agent_qwen', 'agent_gemma', 'agent_deepseek']) {
      if (!rawAgents.some((a) => a.id === requiredId)) {
        const defAg = def.agents.find((a) => a.id === requiredId);
        if (defAg) rawAgents.splice(1, 0, defAg);
      }
    }
    for (const devId of ['agent_agy', 'agent_aside']) {
      if (!rawAgents.some((a) => a.id === devId)) {
        const defDev = def.agents.find((a) => a.id === devId);
        if (defDev) rawAgents.push(defDev);
      }
    }
    for (const itId of ['agent_it_dev', 'agent_it_sec', 'agent_it_qa']) {
      if (!rawAgents.some((a) => a.id === itId)) {
        const defIt = def.agents.find((a) => a.id === itId);
        if (defIt) rawAgents.push(defIt);
      }
    }
    parsed.agents = rawAgents;
    if (Array.isArray(parsed.tasks)) {
      parsed.tasks.forEach((t) => {
        if (t.assigneeId === 'agent_gemini_free') t.assigneeId = 'agent_exaone';
        if (t.assigneeId === 'agent_claude') t.assigneeId = 'agent_groq';
      });
    }
    if (Array.isArray(parsed.missions)) {
      parsed.missions.forEach((m) => {
        if (!m.leadAgentId || m.leadAgentId === 'agent_exaone' || m.leadAgentId === 'agent_gemini_free') {
          m.leadAgentId = 'agent_gemini_neon';
        }
        applyInferredMissionBindings(m);
      });
    }
    if (parsed.settings?.providers?.githubRepo && !parsed.settings.providers.githubRepo.allowedRepos) {
      parsed.settings.providers.githubRepo.allowedRepos =
        process.env.GITHUB_ALLOWED_REPOS ||
        'alpinu83/ai-ceo-hub, alpinu83/kr-calc-hub, alpinu83/alpinu83.github.io';
    }
    if (!Array.isArray(parsed.messages)) {
      parsed.messages = def.messages;
    } else if (Array.isArray(parsed.missions)) {
      // Remove orphaned messages belonging to deleted missions (e.g. deleted sample mission)
      const validMissionIds = new Set(parsed.missions.map((m) => m.id));
      parsed.messages = parsed.messages.filter((m) => !m.missionId || validMissionIds.has(m.missionId));
    }
    if (!parsed.agentConnections || typeof parsed.agentConnections !== 'object') {
      parsed.agentConnections = {};
    }
    if (!Array.isArray(parsed.pushSubscriptions)) {
      parsed.pushSubscriptions = [];
    }
    parsed.settings.webPush = parsed.settings.webPush || { publicKey: '', privateKey: '' };
    dbCache = parsed;
    return parsed;
  } catch {
    const initial = createDefaultState();
    saveDb(initial);
    return initial;
  }
}

export function applyInferredMissionBindings(mission) {
  if (!mission || typeof mission !== 'object') return mission;
  const text = `${mission.title || ''} ${mission.directive || ''}`;
  if (!mission.githubRepo && /korea-tax-cal|kr-calc-hub|세금계산기|셈노트/i.test(text)) {
    mission.githubRepo = 'alpinu83/kr-calc-hub';
    mission.githubBranch = mission.githubBranch || 'main';
    mission.siteUrl = mission.siteUrl || 'https://korea-tax-cal.com';
    if (!Array.isArray(mission.extraRepos) || mission.extraRepos.length === 0) {
      mission.extraRepos = ['alpinu83/alpinu83.github.io'];
    }
  } else if (
    !mission.githubRepo &&
    (mission.domain === 'it_ops' || /CEO Office|ai-ceo-hub|협업\s*시스템/i.test(text))
  ) {
    mission.githubRepo = 'alpinu83/ai-ceo-hub';
    mission.githubBranch = mission.githubBranch || 'main';
    mission.siteUrl = mission.siteUrl || 'https://ai-ceo-hub.onrender.com';
  }
  return mission;
}

let gistSyncTimer = null;
let activeGistId = '';
let cachedBackupKey = null;
let cloudBackupState = { enabled: false, restored: false, encrypted: true, purgedLegacyCount: 0, gistId: '', lastSyncAt: null, error: '' };
const GIST_ENC_FILENAME = 'ceo-office-db.enc.json';
const LEGACY_GIST_FILENAME = 'ceo-office-db.json';
const GIST_DESCRIPTION = 'CEO Office (ai-ceo-hub) Encrypted Cloud Backup';

function getGistHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_GIST_TOKEN.trim()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'ai-ceo-hub'
  };
}

function isGistTokenSet() {
  return Boolean(process.env.GITHUB_GIST_TOKEN && process.env.GITHUB_GIST_TOKEN.trim());
}

function getBackupEncryptionKey() {
  if (cachedBackupKey) return cachedBackupKey;
  const secret = (process.env.BACKUP_ENCRYPTION_KEY || process.env.GITHUB_GIST_TOKEN || '').trim();
  if (!secret) return null;
  cachedBackupKey = crypto.scryptSync(secret, 'ai-ceo-hub-aes256gcm-v1', 32);
  return cachedBackupKey;
}

export function encryptBackupPayload(plainJson) {
  const key = getBackupEncryptionKey();
  if (!key) throw new Error('Backup encryption key unavailable');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plainJson), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify(
    {
      format: 'ai-ceo-hub-enc-v1',
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ciphertext: enc.toString('base64')
    },
    null,
    2
  );
}

export function decryptBackupPayload(rawText) {
  const env = JSON.parse(rawText);
  if (env?.format !== 'ai-ceo-hub-enc-v1' || !env.iv || !env.tag || !env.ciphertext) {
    return null;
  }
  const key = getBackupEncryptionKey();
  if (!key) throw new Error('Backup encryption key unavailable');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(env.ciphertext, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(dec.toString('utf8'));
}

async function readGistFileContent(fileObj, headers) {
  let raw = fileObj?.content || '';
  if (fileObj?.truncated && fileObj?.raw_url) {
    const rawRes = await fetch(fileObj.raw_url, { headers });
    if (rawRes.ok) raw = await rawRes.text();
  }
  return raw;
}

export function getCloudPersistenceStatus() {
  return {
    enabled: cloudBackupState.enabled,
    restored: cloudBackupState.restored,
    encrypted: true,
    purgedLegacyCount: cloudBackupState.purgedLegacyCount || 0,
    gistId: activeGistId ? `${activeGistId.slice(0, 6)}…${activeGistId.slice(-4)}` : '',
    lastSyncAt: cloudBackupState.lastSyncAt,
    error: cloudBackupState.error || ''
  };
}

/**
 * Encrypted zero-data-loss persistence for Render Free Tier:
 * - Always encrypts full DB with AES-256-GCM (never stores plaintext secrets on GitHub Gist!)
 * - Automatically detects & permanently DELETES any legacy plaintext ceo-office-db.json Gists
 *   (wiping their revision history too) and rotates exposed Web Push VAPID keys.
 */
export async function initCloudPersistence() {
  if (!isGistTokenSet()) {
    cloudBackupState = { enabled: false, restored: false, encrypted: true, purgedLegacyCount: 0, gistId: '', lastSyncAt: null, error: '' };
    return cloudBackupState;
  }
  cloudBackupState.enabled = true;
  const headers = getGistHeaders();

  try {
    // 1) Discover all gists owned by the token to locate encrypted backup and ANY legacy plaintext gists
    const discovered = [];
    const listRes = await fetch('https://api.github.com/gists?per_page=50', { headers });
    if (listRes.ok) {
      const list = await listRes.json();
      if (Array.isArray(list)) discovered.push(...list);
    }

    const envGistId = (process.env.GIST_BACKUP_ID || '').trim();
    if (envGistId && !discovered.some((g) => g?.id === envGistId)) {
      const oneRes = await fetch(`https://api.github.com/gists/${encodeURIComponent(envGistId)}`, { headers });
      if (oneRes.ok) discovered.push(await oneRes.json());
    }

    const encGist = discovered.find((g) => g && g.public === false && g.files?.[GIST_ENC_FILENAME]);
    const legacyGists = discovered.filter(
      (g) =>
        g &&
        (g.files?.[LEGACY_GIST_FILENAME] || (g.public === true && g.files?.[GIST_ENC_FILENAME]))
    );

    let restoredDb = null;
    let migratedFromPlaintext = false;

    // 2) Prefer restoring from encrypted private Gist
    if (encGist?.id) {
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(encGist.id)}`, { headers });
      if (res.ok) {
        const fullGist = await res.json();
        const raw = await readGistFileContent(fullGist?.files?.[GIST_ENC_FILENAME], headers);
        if (raw) {
          try {
            const dec = decryptBackupPayload(raw);
            if (dec && dec.settings && Array.isArray(dec.agents)) {
              restoredDb = dec;
              activeGistId = encGist.id;
            }
          } catch {
            // corrupted or rotated key
          }
        }
      }
    }

    // 3) If no encrypted backup yet, restore from legacy plaintext Gist before permanently deleting it
    if (!restoredDb && legacyGists.length > 0) {
      for (const lg of legacyGists) {
        const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(lg.id)}`, { headers });
        if (!res.ok) continue;
        const fullGist = await res.json();
        const fileObj = fullGist?.files?.[LEGACY_GIST_FILENAME];
        const raw = await readGistFileContent(fileObj, headers);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.settings && Array.isArray(parsed.agents)) {
            restoredDb = parsed;
            migratedFromPlaintext = true;
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    // 4) Permanently DELETE every legacy plaintext / public Gist (destroys revision history too!)
    let purgedCount = 0;
    for (const lg of legacyGists) {
      try {
        const delRes = await fetch(`https://api.github.com/gists/${encodeURIComponent(lg.id)}`, {
          method: 'DELETE',
          headers
        });
        if (delRes.ok || delRes.status === 204 || delRes.status === 404) {
          purgedCount += 1;
          console.log(`🔒 Permanently deleted exposed legacy Gist (${lg.id})`);
        }
      } catch {
        // non-fatal
      }
    }
    cloudBackupState.purgedLegacyCount = purgedCount;

    // 5) Apply restored DB + rotate exposed Web Push VAPID keys if migrated from plaintext
    if (restoredDb) {
      if (migratedFromPlaintext && restoredDb.settings?.webPush) {
        // Force fresh VAPID keypair generation on startup since old private key was in plaintext Gist
        restoredDb.settings.webPush = { publicKey: '', privateKey: '', subject: 'mailto:ceo@ai-ceo-hub.local' };
        restoredDb.pushSubscriptions = [];
      }
      if (!restoredDb.settings.providers?.gemini?.apiKey && process.env.GEMINI_API_KEY) {
        restoredDb.settings.providers.gemini = restoredDb.settings.providers.gemini || { freeModel: 'gemini-4-hydrogen' };
        restoredDb.settings.providers.gemini.apiKey = process.env.GEMINI_API_KEY;
      }
      if (!restoredDb.settings.providers?.exaone?.apiKey && process.env.EXAONE_API_KEY) {
        restoredDb.settings.providers.exaone.apiKey = process.env.EXAONE_API_KEY;
      }
      if (!restoredDb.settings.providers?.groq?.apiKey && process.env.GROQ_API_KEY) {
        restoredDb.settings.providers.groq = restoredDb.settings.providers.groq || { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' };
        restoredDb.settings.providers.groq.apiKey = process.env.GROQ_API_KEY;
      }
      if (!restoredDb.settings.providers?.openrouter?.apiKey && process.env.OPENROUTER_API_KEY) {
        restoredDb.settings.providers.openrouter = restoredDb.settings.providers.openrouter || { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' };
        restoredDb.settings.providers.openrouter.apiKey = process.env.OPENROUTER_API_KEY;
      }
      if (!restoredDb.settings.providers?.githubRepo?.apiKey && process.env.GITHUB_REPO_TOKEN) {
        restoredDb.settings.providers.githubRepo = restoredDb.settings.providers.githubRepo || {
          repo: process.env.GITHUB_REPO || 'alpinu83/ai-ceo-hub',
          branch: process.env.GITHUB_BRANCH || 'main'
        };
        restoredDb.settings.providers.githubRepo.apiKey = process.env.GITHUB_REPO_TOKEN;
      }
      if (restoredDb.settings.providers?.claude) {
        delete restoredDb.settings.providers.claude;
      }
      const validTgToken = (v) => /^\d+:[A-Za-z0-9_-]{20,}$/.test(String(v || '').trim().replace(/^bot/i, ''));
      const validChatId = (v) => /^-?\d+$/.test(String(v || '').trim());
      if (!validTgToken(restoredDb.settings.telegram?.botToken) && validTgToken(process.env.TELEGRAM_BOT_TOKEN)) {
        restoredDb.settings.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN.trim();
      }
      if (!validChatId(restoredDb.settings.telegram?.chatId) && validChatId(process.env.TELEGRAM_CHAT_ID)) {
        restoredDb.settings.telegram.chatId = process.env.TELEGRAM_CHAT_ID.trim();
      }
      if (restoredDb.settings.telegram?.pollingEnabled === undefined && process.env.TELEGRAM_POLLING === 'true') {
        restoredDb.settings.telegram.pollingEnabled = true;
      }
      let tokenRotated = false;
      const curTok = String(restoredDb.settings.mcpToken || '').trim();
      const isStrongV2Token = /^ceo_mcp_[a-f0-9]{24,}$/.test(curTok);
      if (process.env.MCP_TOKEN && process.env.MCP_TOKEN.trim()) {
        const envTok = process.env.MCP_TOKEN.trim();
        if (curTok !== envTok) {
          restoredDb.settings.mcpToken = envTok;
          tokenRotated = true;
        }
      } else if (!isStrongV2Token && (process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_HOSTNAME)) {
        const nextToken = resolveStableMcpToken();
        if (curTok !== nextToken) {
          restoredDb.settings.mcpToken = nextToken;
          tokenRotated = true;
        }
      }
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(restoredDb, null, 2), 'utf8');
    dbCache = null; // re-read and migrate the restored copy on next load
      if (tokenRotated && activeGistId) {
        await patchGistContent(JSON.stringify(restoredDb, null, 2));
      }
    }

    // 6) Ensure an encrypted private Gist exists (create one if none yet or if we migrated from legacy)
    if (!activeGistId) {
      const currentDb = loadDb();
      const encryptedContent = encryptBackupPayload(JSON.stringify(currentDb));
      const createRes = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: GIST_DESCRIPTION,
          public: false,
          files: {
            [GIST_ENC_FILENAME]: { content: encryptedContent }
          }
        })
      });
      if (createRes.ok) {
        const created = await createRes.json();
        activeGistId = created.id || '';
        cloudBackupState = {
          enabled: true,
          restored: Boolean(restoredDb),
          encrypted: true,
          purgedLegacyCount: purgedCount,
          gistId: activeGistId,
          lastSyncAt: new Date().toISOString(),
          error: ''
        };
        console.log(`🔒 Created new AES-256-GCM encrypted secret Gist (${activeGistId})`);
        return cloudBackupState;
      }
      cloudBackupState.error = `Gist init HTTP ${createRes.status}`;
      return cloudBackupState;
    }

    cloudBackupState = {
      enabled: true,
      restored: Boolean(restoredDb),
      encrypted: true,
      purgedLegacyCount: purgedCount,
      gistId: activeGistId,
      lastSyncAt: new Date().toISOString(),
      error: ''
    };
    console.log(`🔒 Encrypted GitHub Gist backup ready (${activeGistId})`);
    return cloudBackupState;
  } catch (err) {
    cloudBackupState.error = err.message;
    return cloudBackupState;
  }
}

async function patchGistContent(plainSerialized) {
  if (!isGistTokenSet() || !activeGistId) return false;
  try {
    const encryptedContent = encryptBackupPayload(plainSerialized);
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(activeGistId)}`, {
      method: 'PATCH',
      headers: getGistHeaders(),
      body: JSON.stringify({
        files: {
          [GIST_ENC_FILENAME]: { content: encryptedContent }
        }
      })
    });
    if (res.ok) {
      cloudBackupState.lastSyncAt = new Date().toISOString();
      cloudBackupState.error = '';
      return true;
    }
    cloudBackupState.error = `Gist sync HTTP ${res.status}`;
    return false;
  } catch (err) {
    cloudBackupState.error = err.message;
    return false;
  }
}

function scheduleGistBackup(serialized) {
  if (!isGistTokenSet() || !activeGistId) return;
  if (gistSyncTimer) clearTimeout(gistSyncTimer);
  gistSyncTimer = setTimeout(() => {
    patchGistContent(serialized);
  }, 1000);
}

/** 백업 Gist의 이전 버전 목록 (관리자 복구용) */
export async function listBackupRevisions(limit = 40, page = 1) {
  if (!isGistTokenSet() || !activeGistId) throw new Error('클라우드 백업이 연결되어 있지 않습니다.');
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(activeGistId)}/commits?per_page=${Math.min(100, limit)}&page=${Math.max(1, Number(page) || 1)}`, { headers: getGistHeaders() });
  if (!res.ok) throw new Error(`Gist 이력 조회 실패 HTTP ${res.status}`);
  const list = await res.json();
  return (Array.isArray(list) ? list : []).map((c) => ({ version: c.version, committedAt: c.committed_at, changes: c.change_status || {} }));
}

/** 특정 백업 버전 내용 요약 (복구 전 확인) 또는 복구 */
export async function restoreBackupRevision(version, { dryRun = false } = {}) {
  if (!isGistTokenSet() || !activeGistId) throw new Error('클라우드 백업이 연결되어 있지 않습니다.');
  if (!/^[0-9a-f]{7,40}$/i.test(String(version || ''))) throw new Error('버전 값이 올바르지 않습니다.');
  const headers = getGistHeaders();
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(activeGistId)}/${encodeURIComponent(version)}`, { headers });
  if (!res.ok) throw new Error(`Gist 버전 조회 실패 HTTP ${res.status}`);
  const gist = await res.json();
  const raw = await readGistFileContent(gist?.files?.[GIST_ENC_FILENAME], headers);
  const data = decryptBackupPayload(raw);
  if (!data || !Array.isArray(data.missions)) throw new Error('이 버전은 복호화하거나 읽을 수 없습니다.');
  const summary = {
    version,
    missions: data.missions.length,
    tasks: (data.tasks || []).length,
    approvals: (data.approvals || []).length,
    routines: (data.routines || []).length,
    memory: (data.memory?.facts || []).length,
    agents: (data.agents || []).length,
    globalDirectives: String(data.settings?.globalDirectives || '').length,
    missionTitles: data.missions.map((m) => m.title).slice(0, 10)
  };
  if (dryRun) return summary;
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  dbCache = null; // 다음 읽기에서 마이그레이션 포함해 다시 로드
  const fresh = loadDb();
  saveDb(fresh);
  await flushCloudBackup(fresh);
  return summary;
}

export async function flushCloudBackup(db) {
  if (!isGistTokenSet() || !activeGistId) return false;
  if (gistSyncTimer) {
    clearTimeout(gistSyncTimer);
    gistSyncTimer = null;
  }
  const serialized = JSON.stringify(db || loadDb(), null, 2);
  return patchGistContent(serialized);
}

let allowWipeOnce = false;
/** 확인 문구를 거친 전체 초기화만 한 번 허용 */
export function allowDataWipeOnce() {
  allowWipeOnce = true;
}
export function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  // 안전장치: 프로젝트가 3개 이상 있던 상태에서 한 번에 0개가 되는 저장은 거부 (실수·오류로 전체 데이터가 지워지는 것 방지)
  const prevMissions = Array.isArray(dbCache?.missions) ? dbCache.missions.length : 0;
  const nextMissions = Array.isArray(db?.missions) ? db.missions.length : 0;
  if (prevMissions >= 3 && nextMissions === 0 && !allowWipeOnce && db !== dbCache) {
    console.error(`[안전장치] 프로젝트 ${prevMissions}개 → 0개 저장을 거부했습니다.`);
    throw new Error('안전장치: 모든 프로젝트가 지워지는 저장은 막혀 있습니다.');
  }
  allowWipeOnce = false;
  dbCache = db;
  const serialized = JSON.stringify(db, null, 2);
  fs.writeFileSync(DB_PATH, serialized, 'utf8');
  scheduleGistBackup(serialized);
}

export function recordAgentHeartbeat(db, agentId, action = 'ping') {
  if (!agentId) return;
  if (!db.agentConnections || typeof db.agentConnections !== 'object') {
    db.agentConnections = {};
  }
  db.agentConnections[agentId] = {
    lastSeenAt: new Date().toISOString(),
    lastAction: action
  };
}

export function appendLog(db, actor, message, level = 'info') {
  db.logs.unshift({
    id: uid('log'),
    timestamp: new Date().toISOString(),
    actor,
    level,
    message
  });
  if (db.logs.length > 100) {
    db.logs = db.logs.slice(0, 100);
  }
}

export function appendMessage(db, msg) {
  if (!Array.isArray(db.messages)) db.messages = [];
  const entry = {
    id: uid('msg'),
    timestamp: new Date().toISOString(),
    targetAgentId: null,
    statusText: '대화 중',
    type: 'reply',
    ...msg
  };
  db.messages.push(entry);
  if (db.messages.length > 160) {
    db.messages = db.messages.slice(-160);
  }
  return entry;
}

export function sanitizeStateForClient(db) {
  const clone = structuredClone(db);
  const providers = clone.settings?.providers || {};
  for (const key of Object.keys(providers)) {
    const rawKey = providers[key].apiKey || '';
    providers[key].hasApiKey = rawKey.length > 0;
    providers[key].apiKeyPreview = rawKey
      ? `${rawKey.slice(0, 4)}••••${rawKey.slice(-4)}`
      : '';
    delete providers[key].apiKey;
  }
  if (clone.settings?.telegram) {
    const rawTg = clone.settings.telegram.botToken || '';
    clone.settings.telegram.hasBotToken = rawTg.length > 0;
    clone.settings.telegram.botTokenPreview = rawTg ? `${rawTg.slice(0, 6)}••••${rawTg.slice(-4)}` : '';
    delete clone.settings.telegram.botToken;
  }
  if (clone.settings?.webPush) {
    clone.settings.webPush = {
      publicKey: clone.settings.webPush.publicKey || '',
      enabled: Boolean(clone.settings.webPush.publicKey)
    };
  }
  // 팀장 업무함은 요약만 (판단 자료 원문은 화면에 보내지 않음)
  clone.leadJobs = (Array.isArray(clone.leadJobs) ? clone.leadJobs : []).slice(0, 40).map((j) => ({ id: j.id, purpose: j.purpose, worker: j.worker, status: j.status, claimedBy: j.claimedBy || '', createdAt: j.createdAt, doneAt: j.doneAt || null }));
  clone.pushSubscribedCount = Array.isArray(clone.pushSubscriptions) ? clone.pushSubscriptions.length : 0;
  delete clone.pushSubscriptions;
  clone.cloudBackup = getCloudPersistenceStatus();
  return clone;
}
