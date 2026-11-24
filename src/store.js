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
    const hash = crypto.createHash('sha256').update(`ceo-office-stable-v1:${renderSeed}`).digest('hex').slice(0, 20);
    return `ceo_mcp_${hash}`;
  }
  return `ceo_mcp_${crypto.randomBytes(8).toString('hex')}`;
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
        claude: {
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          model: 'claude-sonnet-4-5',
          enabled: Boolean(process.env.ANTHROPIC_API_KEY)
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
        }
      }
    },
    agents: [
      {
        id: 'agent_gemini_neon',
        name: 'Gemini 4 Neon',
        shortCode: 'GN',
        roleTitle: '전략·총괄 팀장 (AI Pro 구독)',
        tier: 'lead',
        reportsTo: 'ceo',
        provider: 'gemini',
        modelId: 'gemini-4-neon',
        connectionMode: 'bridge',
        costTier: 'paid_or_sub',
        appUrl: 'https://gemini.google.com',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['business', 'content', 'dev', 'life'],
        strengths: '복합 CEO 지시 분해, 장문 문서·PDF·표 분석, 전체 팀원 업무 배정 및 임원 종합 보고',
        bridgeGuide: '사전 추천 설정: 이미 결제 중인 Google AI Pro/Ultra 구독 앱을 추가 과금 0원으로 사용합니다. (지시서 복사 → Gemini 앱 바로 열기)',
        active: true,
        accent: '#0E6245'
      },
      {
        id: 'agent_claude',
        name: 'Claude',
        shortCode: 'CL',
        roleTitle: '개발·기획 수석 팀장 (구독 활용)',
        tier: 'lead',
        reportsTo: 'ceo',
        provider: 'claude',
        modelId: 'claude-sonnet-4-5',
        connectionMode: 'bridge',
        costTier: 'paid_or_sub',
        appUrl: 'https://claude.ai',
        monthlyCapKRW: 0,
        spentKRW: 0,
        domains: ['dev', 'business', 'content'],
        strengths: '정밀 코딩·아키텍처 설계, 코드 리뷰, 높은 완성도의 제안서·기획서 작성 및 검수',
        bridgeGuide: '사전 추천 설정: Claude Pro/Max 월정액 구독을 추가 API 과금 0원으로 사용합니다. (지시서 복사 → Claude 바로 열기)',
        active: true,
        accent: '#9A4A2E'
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
      }
    ],
    missions: [],
    tasks: [],
    approvals: [],
    logs: [],
    messages: []
  };
}

export function loadDb() {
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
    parsed.agents = (parsed.agents || def.agents)
      .filter((a) => a.id !== 'agent_gemini_free')
      .map((a) => ({
        reportsTo: a.tier === 'lead' ? 'ceo' : 'agent_gemini_neon',
        monthlyCapKRW: 0,
        spentKRW: 0,
        ...a
      }));
    if (Array.isArray(parsed.tasks)) {
      parsed.tasks.forEach((t) => {
        if (t.assigneeId === 'agent_gemini_free') t.assigneeId = 'agent_exaone';
      });
    }
    if (Array.isArray(parsed.missions)) {
      parsed.missions.forEach((m) => {
        if (!m.leadAgentId || m.leadAgentId === 'agent_exaone' || m.leadAgentId === 'agent_gemini_free') {
          m.leadAgentId = 'agent_gemini_neon';
        }
      });
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
    return parsed;
  } catch {
    const initial = createDefaultState();
    saveDb(initial);
    return initial;
  }
}

let gistSyncTimer = null;
let activeGistId = (process.env.GIST_BACKUP_ID || '').trim();
let cloudBackupState = { enabled: false, restored: false, gistId: '', lastSyncAt: null, error: '' };
const GIST_FILENAME = 'ceo-office-db.json';
const GIST_DESCRIPTION = 'CEO Office (ai-ceo-hub) Private Cloud Backup';

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

export function getCloudPersistenceStatus() {
  return {
    enabled: cloudBackupState.enabled,
    restored: cloudBackupState.restored,
    gistId: activeGistId ? `${activeGistId.slice(0, 6)}…${activeGistId.slice(-4)}` : '',
    lastSyncAt: cloudBackupState.lastSyncAt,
    error: cloudBackupState.error || ''
  };
}

/**
 * Free zero-data-loss persistence for Render Free Tier:
 * Needs ONLY GITHUB_GIST_TOKEN (GIST_BACKUP_ID is optional!).
 * Auto-discovers an existing private ceo-office-db.json Gist, or auto-creates one on first run.
 */
export async function initCloudPersistence() {
  if (!isGistTokenSet()) {
    cloudBackupState = { enabled: false, restored: false, gistId: '', lastSyncAt: null, error: '' };
    return cloudBackupState;
  }
  cloudBackupState.enabled = true;
  const headers = getGistHeaders();

  try {
    // 1) If no GIST_BACKUP_ID is provided, auto-discover existing private backup Gist
    if (!activeGistId) {
      const listRes = await fetch('https://api.github.com/gists?per_page=30', { headers });
      if (listRes.ok) {
        const list = await listRes.json();
        const found = Array.isArray(list) ? list.find((g) => g?.files?.[GIST_FILENAME]) : null;
        if (found?.id) {
          activeGistId = found.id;
        }
      }
    }

    // 2) If found or provided, fetch & restore full DB from Gist
    if (activeGistId) {
      const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(activeGistId)}`, { headers });
      if (res.ok) {
        const gist = await res.json();
        const fileObj = gist?.files?.[GIST_FILENAME];
        let raw = fileObj?.content || '';
        if (fileObj?.truncated && fileObj?.raw_url) {
          const rawRes = await fetch(fileObj.raw_url, { headers });
          if (rawRes.ok) raw = await rawRes.text();
        }
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.settings && Array.isArray(parsed.agents)) {
            // App settings saved in Gist take priority! Only fall back to Render env vars when Gist value is empty/invalid.
            if (!parsed.settings.providers?.gemini?.apiKey && process.env.GEMINI_API_KEY) {
              parsed.settings.providers.gemini = parsed.settings.providers.gemini || { freeModel: 'gemini-2.5-flash' };
              parsed.settings.providers.gemini.apiKey = process.env.GEMINI_API_KEY;
            }
            if (!parsed.settings.providers?.exaone?.apiKey && process.env.EXAONE_API_KEY) {
              parsed.settings.providers.exaone.apiKey = process.env.EXAONE_API_KEY;
            }
            if (!parsed.settings.providers?.claude?.apiKey && process.env.ANTHROPIC_API_KEY) {
              parsed.settings.providers.claude.apiKey = process.env.ANTHROPIC_API_KEY;
            }
            const validTgToken = (v) => /^\d+:[A-Za-z0-9_-]{20,}$/.test(String(v || '').trim().replace(/^bot/i, ''));
            const validChatId = (v) => /^-?\d+$/.test(String(v || '').trim());
            if (!validTgToken(parsed.settings.telegram?.botToken) && validTgToken(process.env.TELEGRAM_BOT_TOKEN)) {
              parsed.settings.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN.trim();
            }
            if (!validChatId(parsed.settings.telegram?.chatId) && validChatId(process.env.TELEGRAM_CHAT_ID)) {
              parsed.settings.telegram.chatId = process.env.TELEGRAM_CHAT_ID.trim();
            }
            if (parsed.settings.telegram?.pollingEnabled === undefined && process.env.TELEGRAM_POLLING === 'true') {
              parsed.settings.telegram.pollingEnabled = true;
            }
            if (process.env.MCP_TOKEN || process.env.RENDER_SERVICE_ID) {
              parsed.settings.mcpToken = resolveStableMcpToken();
            }
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(DB_PATH, JSON.stringify(parsed, null, 2), 'utf8');
            cloudBackupState = { enabled: true, restored: true, gistId: activeGistId, lastSyncAt: new Date().toISOString(), error: '' };
            console.log(`☁️  GitHub Gist cloud backup restored (${activeGistId})`);
            return cloudBackupState;
          }
        }
      }
    }

    // 3) No backup Gist exists yet → auto-create a private (secret) Gist right now!
    const initialDb = loadDb();
    const createRes = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: {
          [GIST_FILENAME]: { content: JSON.stringify(initialDb, null, 2) }
        }
      })
    });
    if (createRes.ok) {
      const created = await createRes.json();
      activeGistId = created.id || '';
      cloudBackupState = { enabled: true, restored: false, gistId: activeGistId, lastSyncAt: new Date().toISOString(), error: '' };
      console.log(`☁️  Created new private GitHub Gist backup (${activeGistId})`);
      return cloudBackupState;
    }
    cloudBackupState.error = `Gist init HTTP ${createRes.status}`;
    return cloudBackupState;
  } catch (err) {
    cloudBackupState.error = err.message;
    return cloudBackupState;
  }
}

async function patchGistContent(serialized) {
  if (!isGistTokenSet() || !activeGistId) return false;
  try {
    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(activeGistId)}`, {
      method: 'PATCH',
      headers: getGistHeaders(),
      body: JSON.stringify({
        files: {
          [GIST_FILENAME]: { content: serialized }
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

export async function flushCloudBackup(db) {
  if (!isGistTokenSet() || !activeGistId) return false;
  if (gistSyncTimer) {
    clearTimeout(gistSyncTimer);
    gistSyncTimer = null;
  }
  const serialized = JSON.stringify(db || loadDb(), null, 2);
  return patchGistContent(serialized);
}

export function saveDb(db) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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
  clone.pushSubscribedCount = Array.isArray(clone.pushSubscriptions) ? clone.pushSubscriptions.length : 0;
  delete clone.pushSubscriptions;
  clone.cloudBackup = getCloudPersistenceStatus();
  return clone;
}
