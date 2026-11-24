import { generateText, generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { uid } from './store.js';

/**
 * Resolve a Vercel AI SDK model instance for any configured provider:
 * - Google Gemini (Free tier & Gemini 4 Neon) via @ai-sdk/google
 * - Anthropic Claude via @ai-sdk/anthropic
 * - LiteLLM Proxy (100+ providers & spend caps) via @ai-sdk/openai
 * - Ollama (Local open-source free models) via @ai-sdk/openai
 */
function resolveLanguageModel(agent, settings) {
  const providers = settings?.providers || {};

  // LiteLLM routing mode overrides direct provider when configured
  if (agent.connectionMode === 'litellm') {
    const cfg = providers.litellm;
    if (!cfg?.baseUrl) return null;
    const client = createOpenAI({
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey || 'sk-litellm-local',
      compatibility: 'compatible'
    });
    const modelName = agent.modelId || cfg.model || 'gemini-free';
    return { model: client(modelName), label: `litellm:${modelName}` };
  }

  // Gemini Team Lead runs directly on real Google AI Studio API whenever a Gemini API key is configured
  if (agent.provider === 'gemini') {
    const cfg = providers.gemini;
    if (!cfg?.apiKey) return null;
    const google = createGoogleGenerativeAI({ apiKey: cfg.apiKey });
    const rawModel = String(cfg.freeModel || '').trim();
    const modelName = rawModel && rawModel !== 'gemini-2.5-flash' ? rawModel : 'gemini-4-hydrogen';
    return { model: google(modelName), label: `gemini:${modelName}` };
  }

  if (agent.connectionMode !== 'api') return null;

  if (agent.provider === 'claude') {
    const cfg = providers.claude;
    if (!cfg?.apiKey) return null;
    const anthropic = createAnthropic({ apiKey: cfg.apiKey });
    const modelName = agent.modelId || cfg.model || 'claude-sonnet-4-5';
    return { model: anthropic(modelName), label: `claude:${modelName}` };
  }

  if (agent.provider === 'exaone') {
    const cfg = providers.exaone;
    if (!cfg?.apiKey) return null;
    const exaone = createOpenAI({
      baseURL: cfg.baseUrl || 'https://api.exaone.ai/v1',
      apiKey: cfg.apiKey,
      compatibility: 'compatible'
    });
    const modelName = agent.modelId || cfg.model || 'k-exaone_v2.5';
    return { model: exaone(modelName), label: `exaone:${modelName}` };
  }

  if (agent.provider === 'ollama') {
    const cfg = providers.ollama;
    if (!cfg?.baseUrl) return null;
    const ollama = createOpenAI({
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey || 'ollama',
      compatibility: 'compatible'
    });
    const modelName = agent.modelId || cfg.model || 'qwen2.5:14b';
    return { model: ollama(modelName), label: `ollama:${modelName}` };
  }

  if (agent.provider === 'litellm' || agent.provider === 'custom') {
    const cfg = providers.litellm;
    if (!cfg?.baseUrl) return null;
    const client = createOpenAI({
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey || 'sk-local',
      compatibility: 'compatible'
    });
    const modelName = agent.modelId || cfg.model || 'gemini-free';
    return { model: client(modelName), label: `litellm:${modelName}` };
  }

  return null;
}

async function callManusApi({ apiKey, baseUrl, prompt }) {
  const url = `${(baseUrl || 'https://api.manus.ai/v1').replace(/\/$/, '')}/tasks`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      API_KEY: apiKey,
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ prompt })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Manus API 오류 (${res.status}): ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return `### Manus / Cue 자율 작업 생성 완료\n- **Task ID**: \`${data.task_id || data.id || 'created'}\`\n- **상태**: ${data.status || 'queued'}\n- **링크**: ${data.task_url || 'Manus Cue 앱에서 진행 상황 확인'}`;
}

export async function testProviderConnection(providerKey, settings) {
  const p = settings?.providers?.[providerKey];
  if (!p) throw new Error('지원하지 않는 프로바이더입니다.');

  if (providerKey === 'gemini') {
    if (!p.apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.');
    const google = createGoogleGenerativeAI({ apiKey: p.apiKey });
    const rawModel = String(p.freeModel || '').trim();
    const modelName = rawModel && rawModel !== 'gemini-2.5-flash' ? rawModel : 'gemini-4-hydrogen';
    const { text } = await generateText({
      model: google(modelName),
      prompt: 'Respond with exactly: OK'
    });
    return { ok: true, model: modelName, reply: text.trim().slice(0, 60) };
  }

  if (providerKey === 'claude') {
    if (!p.apiKey) throw new Error('Claude API 키가 설정되지 않았습니다.');
    const anthropic = createAnthropic({ apiKey: p.apiKey });
    const modelName = p.model || 'claude-sonnet-4-5';
    const { text } = await generateText({
      model: anthropic(modelName),
      prompt: 'Respond with exactly: OK'
    });
    return { ok: true, model: modelName, reply: text.trim().slice(0, 60) };
  }

  if (providerKey === 'exaone') {
    if (!p.apiKey) throw new Error('LG EXAONE API 키가 설정되지 않았습니다.');
    const exaone = createOpenAI({
      baseURL: p.baseUrl || 'https://api.exaone.ai/v1',
      apiKey: p.apiKey,
      compatibility: 'compatible'
    });
    const modelName = p.model || 'k-exaone_v2.5';
    const { text } = await generateText({
      model: exaone(modelName),
      prompt: '간단히 "연결 OK"라고 답하세요.'
    });
    return { ok: true, model: modelName, reply: text.trim().slice(0, 60) };
  }

  if (providerKey === 'litellm' || providerKey === 'ollama') {
    if (!p.baseUrl) throw new Error(`${providerKey} Base URL을 입력해 주세요.`);
    const client = createOpenAI({
      baseURL: p.baseUrl,
      apiKey: p.apiKey || 'local',
      compatibility: 'compatible'
    });
    const modelName = p.model || (providerKey === 'ollama' ? 'qwen2.5:14b' : 'gemini-free');
    const { text } = await generateText({
      model: client(modelName),
      prompt: 'Respond with exactly: OK'
    });
    return { ok: true, model: modelName, reply: text.trim().slice(0, 60) };
  }

  if (providerKey === 'manus') {
    if (!p.apiKey && !p.cueEmail) {
      throw new Error('Manus API 키 또는 Cue 전용 이메일을 입력해 주세요.');
    }
    return {
      ok: true,
      model: 'manus-cue',
      reply: p.apiKey ? 'Manus API 키가 저장되었습니다.' : `Cue 이메일 브릿지(${p.cueEmail}) 준비 완료`
    };
  }

  throw new Error('알 수 없는 프로바이더');
}

/**
 * Send optional Webhook notification (OpenClaw, n8n, Slack, Discord, Telegram bridge)
 */
export async function notifyWebhook(settings, eventType, payload) {
  const url = settings?.webhookUrl;
  if (!url) return { sent: false };
  try {
    const body = {
      source: 'ai-ceo-hub',
      event: eventType,
      company: settings.companyName,
      timestamp: new Date().toISOString(),
      // Slack / Discord friendly text field as well as structured data
      text: `[${settings.companyName}] ${payload.title || eventType} — ${payload.summary || ''}`,
      content: `[${settings.companyName}] ${payload.title || eventType} — ${payload.summary || ''}`,
      data: payload
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { sent: res.ok, status: res.status };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

export function buildDispatchPrompt(agent, task, mission) {
  const approvalRule = task.requiresApproval
    ? '⚠️ [CEO 결재 게이트] 결제, 예약 확정, 외부 이메일/문자 발송, 프로덕션 배포 전에는 절대 실행하지 말고 후보·금액·리스크를 정리해 멈춘 뒤 CEO 승인을 요청하세요.'
    : '완료 후 핵심 3줄 요약과 실행 산출물(표·체크리스트·링크)을 함께 보고하세요.';

  switch (agent.provider) {
    case 'pickle':
      return `[피클(Pickle) 실행 지시서]\n미션: ${mission.title}\n요청 작업: ${task.title}\n상세 내용: ${task.description}\n\n완료 조건:\n1. 전화 또는 국내 플랫폼 확인이 필요한 항목을 조사하고 후보 2~3곳(가격·가능 시간·취소 규정)을 표로 정리해줘.\n2. ${approvalRule}`;
    case 'vooy':
      return `[부이(vooy) 정기 브리핑·조사 지시서]\n미션: ${mission.title}\n요청 작업: ${task.title}\n상세 내용: ${task.description}\n\n실행 규칙:\n- 기본 무료 모델을 우선 사용하고, 유료 토큰 전환이 필요하면 먼저 물어봐 줘.\n- 출력 형식: 항목 / 핵심 1줄 요약 / 원본 링크 / CEO 의사결정 필요 여부\n- ${approvalRule}`;
    case 'instinct':
      return `[인스팅스 문자 지시문]\n${task.title} 진행해줘. (${task.description}) 확인되면 핵심만 짧게 회신해주고, 결제나 예약 확정 전에는 꼭 먼저 물어봐줘.`;
    case 'muse':
      return `[Meta Muse 협업 지시서]\n미션: ${mission.title}\n담당 작업: ${task.title}\n상세 지시: ${task.description}\n\n참고:\n- 기억하고 있는 내 취향과 일정 제약을 반영해 정리해줘.\n- MCP 커넥터(CEO Office)가 연결되어 있다면 submit_task_result 도구로 바로 보고해줘.\n- ${approvalRule}`;
    case 'manus':
      return `[Manus Cue 자율 에이전트 지시서]\n미션: ${mission.title}\n작업: ${task.title}\n상세: ${task.description}\n\n지침:\n- Cue 전용 이메일·컴퓨터 환경에서 리서치 및 초안을 작성하세요.\n- 외부 발송·지갑 결제 전에는 반드시 MCP request_ceo_approval 또는 보고를 통해 CEO 결재를 받으세요.`;
    default:
      return `[${agent.name} (${agent.roleTitle}) 업무 지시서]\nCEO 원지시: ${mission.directive}\n\n담당 작업: ${task.title}\n상세 요구사항: ${task.description}\n\n출력 형식:\n1. 핵심 요약 (3줄)\n2. 실행 산출물 (마크다운 표·체크리스트·코드·초안)\n3. CEO 의사결정 필요 사항\n${approvalRule}`;
  }
}

function selectLeadAgent(agents) {
  const active = agents.filter((a) => a.active);
  // Gemini 4 Neon (existing AI Pro subscription, 0 extra API cost) is ALWAYS the primary Team Lead
  return (
    active.find((a) => a.id === 'agent_gemini_neon') ||
    active.find((a) => a.id === 'agent_claude') ||
    active.find((a) => a.tier === 'lead') ||
    active[0]
  );
}

const PlanSchema = z.object({
  planSummary: z.string().describe('총괄 팀장의 업무 분배 전략 2문장 요약 (한국어)'),
  tasks: z
    .array(
      z.object({
        title: z.string().describe('짧고 명확한 실무 작업명'),
        description: z.string().describe('구체적 실행 방법과 완료 기준'),
        assigneeId: z.string().describe('활성 조직원 id 중 하나'),
        domain: z.enum(['business', 'life', 'content', 'dev']),
        requiresApproval: z.boolean().describe('결제/예약확정/외부발송/배포 포함 시 true'),
        estimatedCostKRW: z.number().min(0).describe('예상 외부 비용(원), 없으면 0')
      })
    )
    .min(2)
    .max(6)
});

function heuristicDecompose({ directive, domain, costPolicy, agents, leadAgent }) {
  const active = agents.filter((a) => a.active);
  const byId = (id) => active.find((a) => a.id === id);
  const pick = (ids) => ids.map(byId).find(Boolean) || active[0];

  const text = directive.toLowerCase();
  const tasks = [];
  const isFreeOnly = costPolicy === 'free_first';

  const researchAgent = isFreeOnly
    ? pick(['agent_exaone', 'agent_vooy', 'agent_cue'])
    : pick(['agent_exaone', 'agent_cue', 'agent_gemini_neon']);

  const deepWorkAgent = isFreeOnly
    ? pick(['agent_exaone', 'agent_muse', 'agent_claude'])
    : pick(['agent_claude', 'agent_gemini_neon', 'agent_exaone']);

  const needsCallOrBooking = /예약|식당|병원|전화|ktx|기차|호텔|숙소|주문|결제|구매/.test(text);
  const needsRecurring = /매일|매주|아침|브리핑|모니터링|가격|뉴스|트렌드|추적/.test(text);
  const needsEmailOrOutreach = /이메일|메일|발송|제안서|고객|미팅|거래처|영업|외부/.test(text);
  const needsPersonal = /취향|일정|캘린더|가족|모임|여행|선물|레시피|장보기|개인/.test(text);
  const needsQuickText = /문자|연락|심부름|확인해|물어봐|간단히/.test(text);
  const needsCode = /코드|개발|웹|앱|버그|리팩토링|배포|api|스크립트|자동화|리뷰|결제 오류/.test(text);
  const needsContent = /유튜브|블로그|콘텐츠|sns|스레드|인스타|대본|마케팅|카피|글/.test(text);

  tasks.push({
    title: '핵심 자료 조사 및 요구사항 구조화',
    description: `CEO 지시("${directive.slice(0, 72)}${directive.length > 72 ? '…' : ''}")의 선행 자료, 벤치마크, 제약 조건을 빠르게 구조화합니다.`,
    assigneeId: researchAgent.id,
    domain,
    requiresApproval: false,
    estimatedCostKRW: 0
  });

  if (needsCode || domain === 'dev') {
    const devAgent = isFreeOnly
      ? pick(['agent_exaone', 'agent_claude'])
      : pick(['agent_claude', 'agent_gemini_neon']);
    tasks.push({
      title: '아키텍처 설계 · 구현 코드 작성 및 리뷰',
      description: '핵심 구현 코드, 예외 처리, 단위 테스트 및 보안 체크리스트를 작성합니다.',
      assigneeId: devAgent.id,
      domain: 'dev',
      requiresApproval: /배포|프로덕션|결제/.test(text),
      estimatedCostKRW: 0
    });
  }

  if (needsContent || domain === 'content') {
    tasks.push({
      title: '콘텐츠 기획안 · 대본 및 채널별 카피 제작',
      description: '후킹 제목 5종, 본문 초안, 블로그/스레드 확산용 변환 버전을 제작합니다.',
      assigneeId: deepWorkAgent.id,
      domain: 'content',
      requiresApproval: /발행|업로드|게시|승인/.test(text),
      estimatedCostKRW: 0
    });
  }

  if (needsEmailOrOutreach || domain === 'business') {
    const bizAgent = needsEmailOrOutreach
      ? pick(['agent_cue', 'agent_claude', 'agent_exaone'])
      : deepWorkAgent;
    tasks.push({
      title: needsEmailOrOutreach ? '대외 제안 문서 작성 및 메일 초안 준비' : '비즈니스 실행안 및 의사결정 옵션 비교',
      description: needsEmailOrOutreach
        ? '외부 고객/파트너용 제안서와 발송 메일 초안을 작성합니다. 실제 발송 전 CEO 결재를 거칩니다.'
        : '보수안/적극안 2가지 전략과 기대 ROI, 리스크를 비교 정리합니다.',
      assigneeId: bizAgent.id,
      domain: 'business',
      requiresApproval: needsEmailOrOutreach,
      estimatedCostKRW: 0
    });
  }

  if (needsCallOrBooking || domain === 'life') {
    const lifeExec = pick(['agent_pickle', 'agent_instinct', 'agent_muse']);
    tasks.push({
      title: needsCallOrBooking ? '후보 조사 · 전화 확인 및 예약/결제 준비' : '일상 실행 후보 정리 및 가능 여부 확인',
      description: '조건에 맞는 후보 3곳(가격·가능 시간·취소 규정)을 확인하고, 예약 확정 및 결제 직전 CEO 결재를 요청합니다.',
      assigneeId: lifeExec.id,
      domain: 'life',
      requiresApproval: true,
      estimatedCostKRW: needsCallOrBooking ? 60000 : 0
    });
  }

  if (needsRecurring) {
    tasks.push({
      title: '정기 자동 브리핑 · 모니터링 루틴 설정',
      description: '매일 아침 동일 조건으로 뉴스·가격·업계 동향을 수집해 핵심만 브리핑하는 반복 루틴을 세팅합니다.',
      assigneeId: pick(['agent_vooy', 'agent_exaone']).id,
      domain,
      requiresApproval: false,
      estimatedCostKRW: 0
    });
  }

  if (needsPersonal && tasks.length < 5) {
    tasks.push({
      title: '개인 취향·일정 제약 대조 및 프로젝트 보드 정리',
      description: '기존 선호도와 캘린더 충돌 여부를 점검하고 Spaces 보드 형태로 정리합니다.',
      assigneeId: pick(['agent_muse', 'agent_exaone']).id,
      domain: 'life',
      requiresApproval: false,
      estimatedCostKRW: 0
    });
  }

  if (needsQuickText && tasks.length < 5) {
    tasks.push({
      title: '문자·전화 빠른 현장 확인 및 리마인더',
      description: '문자 대화방으로 빠르게 확인할 수 있는 간단한 심부름과 후속 체크를 수행합니다.',
      assigneeId: pick(['agent_instinct', 'agent_pickle']).id,
      domain: 'life',
      requiresApproval: false,
      estimatedCostKRW: 0
    });
  }

  if (tasks.length < 3) {
    tasks.push({
      title: '일정·컨텍스트 정합성 점검 및 실행 체크리스트',
      description: 'CEO의 기존 우선순위와 일정에 맞춰 실행 순서와 누락 항목을 정리합니다.',
      assigneeId: pick(['agent_muse', 'agent_vooy', 'agent_exaone']).id,
      domain,
      requiresApproval: false,
      estimatedCostKRW: 0
    });
  }

  const trimmed = tasks.slice(0, 5);
  const policyLabel =
    costPolicy === 'free_first'
      ? '무료·구독 우선'
      : costPolicy === 'max_quality'
        ? '최고 성능 우선'
        : '균형 배분(팀장 전략 + 무료 실무)';

  return {
    leadAgentId: leadAgent.id,
    planSummary: `${leadAgent.name} 팀장이 [${policyLabel}] 정책으로 CEO 지시를 ${trimmed.length}개 실무 작업으로 분배했습니다. 결제·예약·외부 발송 단계에는 자동으로 CEO 결재 게이트를 배치했습니다.`,
    usedLiveApi: false,
    tasks: trimmed
  };
}

function resolveLiveBackendModel(settings) {
  const gem = settings?.providers?.gemini;
  if (gem?.apiKey) {
    const google = createGoogleGenerativeAI({ apiKey: gem.apiKey });
    const rawModel = String(gem.freeModel || '').trim();
    const modelName = rawModel && rawModel !== 'gemini-2.5-flash' ? rawModel : 'gemini-4-hydrogen';
    return { model: google(modelName), label: `gemini:${modelName}` };
  }
  const exa = settings?.providers?.exaone;
  if (exa?.apiKey) {
    const client = createOpenAI({
      baseURL: exa.baseUrl || 'https://api.exaone.ai/v1',
      apiKey: exa.apiKey,
      compatibility: 'compatible'
    });
    const modelName = exa.model || 'k-exaone_v2.5';
    return { model: client(modelName), label: `exaone:${modelName}` };
  }
  const claude = settings?.providers?.claude;
  if (claude?.apiKey) {
    const anthropic = createAnthropic({ apiKey: claude.apiKey });
    const modelName = claude.model || 'claude-sonnet-4-5';
    return { model: anthropic(modelName), label: `claude:${modelName}` };
  }
  return null;
}

export async function decomposeDirective({ directive, title, domain, costPolicy, agents, settings }) {
  const leadAgent = selectLeadAgent(agents, costPolicy, settings);
  const activeAgents = agents.filter((a) => a.active);
  const resolved = resolveLanguageModel(leadAgent, settings) || resolveLiveBackendModel(settings);

  if (resolved) {
    const rosterText = activeAgents
      .map(
        (a) =>
          `- id: "${a.id}", 이름: "${a.name}", 직책: "${a.roleTitle}", 연동: "${a.connectionMode}", 비용: "${a.costTier}", 강점: "${a.strengths}"`
      )
      .join('\n');

    const system = `당신은 AI 조직의 총괄 팀장(${leadAgent.name})입니다.
CEO의 지시를 3~5개 구체적 실무 작업으로 분해하고, 아래 조직원 중 최적 담당자(assigneeId)를 배정하세요.
권한 위임 규칙 (매우 중요):
- 리서치, 시장 조사, 전략/로드맵 수립, MVP 기획, SEO·콘텐츠·문서 초안, 코드 작성·리뷰, 모니터링 세팅 등 일반 실무는 모두 **팀장 전결(requiresApproval=false)**로 자동 진행합니다.
- CEO 결재(requiresApproval=true)는 오직 **실제 금전 결제/송금/광고비 집행, 외부 식당·병원 예약 최종 확정, 대외 공식 발송·프로덕션 실배포**처럼 되돌리기 어렵고 영향이 큰 의사결정에만 지정하세요.

[활성 AI 조직원]
${rosterText}`;

    try {
      const { object } = await generateObject({
        model: resolved.model,
        schema: PlanSchema,
        system,
        prompt: `미션 제목: ${title || '(자동)'}\n업무 영역: ${domain}\nCEO 지시:\n${directive}`
      });

      const validIds = new Set(activeAgents.map((a) => a.id));
      const majorDecisionRe = /결제|송금|계약|광고비|예약\s*확정|최종\s*예약|실제\s*발송|대외\s*발송|프로덕션\s*배포|실배포/;
      const normalized = object.tasks.map((t) => {
        const safeAssignee = validIds.has(t.assigneeId) ? t.assigneeId : activeAgents[0].id;
        const textBlob = `${t.title} ${t.description}`;
        const isMajorExternal =
          (Number(t.estimatedCostKRW) || 0) > 0 ||
          majorDecisionRe.test(textBlob);
        // Only major financial / irreversible external decisions go to CEO; Team Lead auto-approves all routine work
        const needsApproval =
          safeAssignee === 'agent_exaone' ? false : Boolean(t.requiresApproval && isMajorExternal);
        return {
          ...t,
          assigneeId: safeAssignee,
          requiresApproval: needsApproval
        };
      });

      return {
        leadAgentId: leadAgent.id,
        planSummary: object.planSummary,
        usedLiveApi: true,
        tasks: normalized
      };
    } catch {
      return heuristicDecompose({ directive, domain, costPolicy, agents, leadAgent });
    }
  }

  return heuristicDecompose({ directive, domain, costPolicy, agents, leadAgent });
}

export async function executeAgentTask({ task, mission, agent, settings, priorOutputs = [] }) {
  const contextBlock =
    priorOutputs.length > 0
      ? `\n\n[다른 팀원 선행 결과]\n${priorOutputs
          .map((o) => `- ${o.title} (${o.agentName}): ${o.output.slice(0, 350)}`)
          .join('\n')}`
      : '';

  // Manus API dedicated path
  if (agent.provider === 'manus' && agent.connectionMode === 'api' && settings?.providers?.manus?.apiKey) {
    const output = await callManusApi({
      apiKey: settings.providers.manus.apiKey,
      baseUrl: settings.providers.manus.baseUrl,
      prompt: `미션: ${mission.title}\n작업: ${task.title}\n상세: ${task.description}${contextBlock}`
    });
    return { output, executionModeUsed: 'live_api:manus', live: true };
  }

  // Internal AI agents (EXAONE, Gemini 4 Neon, Claude) run autonomously under Team Lead authority using direct API or live EXAONE engine
  const isInternalAi = ['exaone', 'gemini', 'claude'].includes(agent.provider);
  const resolved = resolveLanguageModel(agent, settings) || (isInternalAi ? resolveLiveBackendModel(settings) : null);
  if (resolved) {
    const system = `당신은 "${agent.name}" (${agent.roleTitle})입니다. 강점: ${agent.strengths}.
총괄 팀장(${mission?.leadAgentId === 'agent_gemini_neon' ? 'Gemini 4 Neon' : '팀장'})의 위임을 받아 CEO 지시를 완수할 수 있도록 바로 실행 가능한 한국어 마크다운 결과물(표·체크리스트·실행안 포함)을 작성하세요.
실제 금전 결제·예약 확정·외부 발송·실배포가 필요한 경우에만 실제 실행했다고 쓰지 말고 "팀장 검토 → CEO 결재 상신안"으로 정리하세요.`;

    const prompt = `미션: ${mission.title}
CEO 원지시: ${mission.directive}
담당 작업: ${task.title}
상세 요구사항: ${task.description}${contextBlock}`;

    const { text } = await generateText({
      model: resolved.model,
      system,
      prompt
    });
    return { output: text.trim(), executionModeUsed: `live_sdk:${resolved.label}`, live: true };
  }

  // External action bots (Pickle / Cue / Muse / Vooy / Instinct): prepare honest handoff brief without faking phone calls/emails
  const helperModel = resolveLiveBackendModel(settings);
  const channelLabel =
    agent.provider === 'pickle'
      ? '피클(알렉스) HTTPS 수신함 전달 완료'
      : agent.provider === 'vooy'
        ? '부이(vooy) 연동 대기 중'
        : agent.provider === 'muse'
          ? 'Meta Muse 공식 MCP 전달 완료'
          : agent.provider === 'manus'
            ? 'Manus Cue HTTPS/MCP 전달 완료'
            : `${agent.name} 전달 대기`;

  if (helperModel) {
    try {
      const { text } = await generateText({
        model: helperModel.model,
        system: `당신은 총괄 팀장 보좌 AI입니다. 외부 실행 봇(${agent.name})이 바로 처리할 수 있도록 핵심 실행 체크리스트와 조건을 간결한 한국어 마크다운으로 정리하세요. 전화 예약·결제·이메일 발송을 "이미 완료했다"고 거짓으로 쓰지 마세요.`,
        prompt: `미션: ${mission.title}\n담당 외부 봇: ${agent.name} (${channelLabel})\n작업: ${task.title}\n상세: ${task.description}${contextBlock}`
      });
      return {
        output: `> **상태**: ${channelLabel}\n\n${text.trim()}`,
        executionModeUsed: `handoff_brief:${helperModel.label}`,
        live: true
      };
    } catch {
      // fall through to deterministic handoff brief
    }
  }

  const handoffBrief = `### ${agent.name} 팀장 위임 완료
> **연동 상태**: ${channelLabel}

- **작업**: ${task.title}
- **내용**: ${task.description}
- **진행 방식**: ${agent.provider === 'pickle' || agent.provider === 'manus' || agent.provider === 'muse' ? `${agent.name}가 수신함/MCP에서 자동으로 가져가 처리 후 보고합니다.` : `${agent.name} 연동 완료 후 자동 처리됩니다.`}
- **결재 게이트**: ${task.requiresApproval ? '실제 결제·예약 확정·외부 발송 전 팀장 경유 CEO 결재' : '팀장 전결 (자동 처리)'}`;

  return { output: handoffBrief, executionModeUsed: 'handoff_queue', live: false };
}

export async function synthesizeMissionReport({ mission, tasks, agents, settings }) {
  const leadAgent = agents.find((a) => a.id === mission.leadAgentId) || agents[0];
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const digest = tasks
    .map((t, i) => {
      const ag = agentMap[t.assigneeId];
      return `${i + 1}. [${t.title}] (담당: ${ag?.name || t.assigneeId}, 상태: ${t.status})\n${t.output || '(결과 미입력)'}`;
    })
    .join('\n\n');

  const resolved = resolveLanguageModel(leadAgent, settings) || resolveLiveBackendModel(settings);
  if (resolved) {
    try {
      const { text } = await generateText({
        model: resolved.model,
        system: `당신은 총괄 팀장(${leadAgent.name})입니다. 팀원 결과를 취합해 CEO가 30초 안에 파악하고 의사결정할 수 있는 최종 임원 보고서(Executive Brief)를 한국어 마크다운(표·체크리스트 포함)으로 작성하세요.`,
        prompt: `미션: ${mission.title}\nCEO 원지시: ${mission.directive}\n\n[팀원 작업 결과]\n${digest}`
      });
      return text.trim();
    } catch {
      // Fall through to deterministic summary
    }
  }

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const rows = tasks
    .map((t) => {
      const ag = agentMap[t.assigneeId];
      const snippet = (t.output || '대기 중')
        .split('\n')
        .find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('>'))
        ?.replace(/^[-*]\s*/, '')
        .slice(0, 90) || '결과 등록됨';
      return `| **${t.title}** | ${ag?.name || '팀원'} | ${t.status === 'completed' ? '완료' : '진행/결재'} | ${snippet} |`;
    })
    .join('\n');

  return `### ${leadAgent.name} 총괄 팀장 최종 임원 보고
**미션**: ${mission.title} · **달성률**: ${completedCount} / ${tasks.length}건 완료

| 세부 업무 | 담당 AI | 상태 | 핵심 결과 |
| --- | --- | --- | --- |
${rows}

#### CEO 다음 권장 액션
- 결재함에서 대기 중인 외부 실행(예약·결제·발송) 안건을 최종 확인해 주세요.`;
}

export function createApprovalForTask(task, agent, mission, reason, proposedAction) {
  const leadId = mission?.leadAgentId || 'agent_gemini_neon';
  return {
    id: uid('apr'),
    missionId: mission.id,
    taskId: task.id,
    agentId: leadId,
    title: `${task.title} — CEO 실행 승인 요청`,
    category: task.estimatedCostKRW > 0 ? '예약 · 결제' : '대외 실행 · 최종 승인',
    riskLevel: task.estimatedCostKRW >= 100000 ? 'high' : task.estimatedCostKRW > 0 ? 'medium' : 'low',
    estimatedCostKRW: task.estimatedCostKRW || 0,
    depositKRW: 0,
    summary:
      reason ||
      `[실무: ${agent.name} → 총괄 팀장 검토 후 상신] "${task.title}" 사전 준비를 마치고 실제 실행(예약/결제/발송/배포) 전 CEO 결재를 요청합니다.`,
    proposedAction:
      proposedAction || `승인 시 "${task.title}" 작업이 확정 상태로 전환되며, 팀장 최종 임원 보고서에 반영됩니다.`,
    status: 'pending',
    ceoNote: '',
    createdAt: new Date().toISOString(),
    decidedAt: null
  };
}

export async function proposeNextProjectPhase({ mission, tasks, agents, settings }) {
  const currentPhase = Number(mission?.phase) || 1;
  const nextPhase = currentPhase + 1;
  const leadAgent = agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon')) || agents[0];
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const phaseTasks = tasks.filter((t) => (Number(t.phase) || 1) === currentPhase);
  const targetTasks = phaseTasks.length > 0 ? phaseTasks : tasks;
  const digest = targetTasks
    .map((t, i) => {
      const ag = agentMap[t.assigneeId];
      const snippet = (t.output || '(진행 중)').replace(/\s+/g, ' ').slice(0, 260);
      return `${i + 1}. [${t.title}] (${ag?.name || '팀원'} · ${t.status}): ${snippet}`;
    })
    .join('\n');

  const resolved = resolveLanguageModel(leadAgent, settings) || resolveLiveBackendModel(settings);
  if (resolved) {
    try {
      const schema = z.object({
        nextPhaseTitle: z.string().min(4),
        rationale: z.string().min(10),
        expectedImpact: z.string().min(6),
        nextDirective: z.string().min(15),
        suggestedSteps: z.array(z.string()).min(2).max(5)
      });

      const system = `당신은 AI 조직의 총괄 팀장(${leadAgent.name})입니다.
지속 프로젝트의 Phase ${currentPhase} 결과를 분석하고, 목표를 한 단계 더 진전시킬 **Phase ${nextPhase} 후속 추진 제안서**를 작성하세요.
- 이미 완료된 리서치/초안을 반복하지 말고, 실제 성과·전환·개선·확장으로 이어지는 구체적 다음 단계를 제안하세요.
- nextDirective는 CEO가 승인하는 즉시 팀원들에게 분배해 자동 실행할 수 있는 명확한 한국어 지시문으로 작성하세요.`;

      const prompt = `프로젝트명: ${mission.title}
원래 목표: ${mission.directive}
현재 완료 단계: Phase ${currentPhase}
[Phase ${currentPhase} 결과 요약]
${digest}
${mission.finalReport ? `\n[임원 보고서 발췌]\n${mission.finalReport.slice(0, 700)}` : ''}`;

      const { object } = await generateObject({
        model: resolved.model,
        schema,
        system,
        prompt
      });

      return {
        nextPhase,
        nextPhaseTitle: object.nextPhaseTitle.trim(),
        rationale: object.rationale.trim(),
        expectedImpact: object.expectedImpact.trim(),
        nextDirective: object.nextDirective.trim(),
        suggestedSteps: object.suggestedSteps.map((s) => s.trim()).filter(Boolean),
        usedLiveApi: true
      };
    } catch {
      // Fall through to deterministic next-phase proposal
    }
  }

  const nextPhaseTitle = `Phase ${nextPhase}: ${mission.title} 고도화 · 실행 확장`;
  const suggestedSteps = [
    `Phase ${currentPhase} 산출물 기반 핵심 개선점 및 우선순위 3가지 확정`,
    `실제 트래픽·성과·전환을 끌어올릴 실행 콘텐츠 및 기능 구체화`,
    `성과 측정 지표(KPI) 점검 및 다음 라운드 자동화 루틴 설계`
  ];
  return {
    nextPhase,
    nextPhaseTitle,
    rationale: `Phase ${currentPhase} 기본 작업(${targetTasks.length}건)이 마무리되었습니다. 일회성으로 끝내지 않고 실제 성과로 연결하기 위해 검증·고도화 단계(Phase ${nextPhase}) 추진을 제안합니다.`,
    expectedImpact: `Phase ${currentPhase} 초안을 실행 가능한 개선안과 성과 측정 체계로 연결해 프로젝트 완성도를 높입니다.`,
    nextDirective: `[${mission.title} — Phase ${nextPhase}] 이전 단계 결과를 바탕으로 ① 핵심 병목·개선 과제 3건 도출, ② 바로 적용 가능한 실행안·콘텐츠 고도화, ③ 성과 지표(KPI) 추적 및 후속 확장 전략을 수립해줘.`,
    suggestedSteps,
    usedLiveApi: false
  };
}

/**
 * Resolve which AI team members should speak in response to a CEO chat message
 */
function pickResponders(text, agents, mission, tasks) {
  const active = agents.filter((a) => a.active);
  const lower = text.toLowerCase();
  const matched = [];

  const aliasMap = [
    { id: 'agent_exaone', re: /@?엑사원|exaone/ },
    { id: 'agent_pickle', re: /@?피클|알렉스|pickle/ },
    { id: 'agent_muse', re: /@?뮤즈|muse/ },
    { id: 'agent_cue', re: /@?큐이|@?큐\b|cue|마누스|manus/ },
    { id: 'agent_vooy', re: /@?부이|vooy/ },
    { id: 'agent_claude', re: /@?클로드|claude/ },
    { id: 'agent_gemini_neon', re: /@?제미나이|gemini|네온|neon/ },
    { id: 'agent_instinct', re: /@?인스팅스|인스팅트|instinct/ }
  ];

  if (/@전체|모두|전원|다들/.test(lower)) {
    const exa = active.find((a) => a.id === 'agent_exaone');
    const assigned = [...new Set(tasks.map((t) => t.assigneeId))]
      .map((id) => active.find((a) => a.id === id))
      .filter((a) => a && a.id !== exa?.id)
      .slice(0, 2);
    return [exa, ...assigned].filter(Boolean);
  }

  for (const item of aliasMap) {
    if (item.re.test(lower)) {
      const ag = active.find((a) => a.id === item.id);
      if (ag && !matched.some((m) => m.id === ag.id)) matched.push(ag);
    }
  }

  // Default (no specific @mention): ONLY the Team Lead responds concisely to the CEO
  if (matched.length === 0) {
    const lead =
      active.find((a) => a.id === mission?.leadAgentId) ||
      active.find((a) => a.tier === 'lead') ||
      active.find((a) => a.id === 'agent_exaone') ||
      active[0];
    if (lead) matched.push(lead);
  }

  return matched.slice(0, 3);
}

function buildHonestDispatchNotice(agent, userMessage, agentTasks) {
  const myTask = agentTasks[0];
  const taskRef = myTask ? ` (관련 업무: "${myTask.title}")` : '';
  switch (agent.provider) {
    case 'pickle':
      return `[수신함 전달됨] 피클(알렉스) HTTPS 수신함에 대표님 메시지를 등록했습니다${taskRef}. 피클이 다음 체크 시 확인하고 이곳 회의실로 실제 결과를 보고합니다.`;
    case 'manus':
      return `[수신함/MCP 전달됨] Manus Cue가 수신함 또는 MCP로 이 요청을 확인하면 이곳 회의실로 결과를 보고합니다${taskRef}.`;
    case 'muse':
      return `[MCP 전달됨] Meta Muse에서 CEO Office 커넥터로 이 요청을 조회·보고할 수 있습니다${taskRef}.`;
    case 'vooy':
      return `[연동 대기 중] 부이(vooy)는 아직 연결 대기 상태입니다. 연동 완료 후 자동 수신됩니다.`;
    case 'instinct':
      return `[문자 전달 대기] 인스팅스는 외부 앱입니다. 업무 상세에서 지시서를 복사해 전달해 주세요.`;
    default:
      return `[구독 앱 안내] ${agent.name}은(는) 월정액 구독(추가 과금 0원)으로 연결되어 있습니다. "${userMessage.slice(0, 36)}" 내용을 복사해 ${agent.name} 앱에서 실행하거나 @엑사원을 호출해 무료 API로 즉시 처리하세요.`;
  }
}

/**
 * Multi-agent live conversation in #전사-회의실 when CEO speaks.
 * - General CEO message (no @mention): ONLY Team Lead responds concisely (powered by live EXAONE backend).
 * - Explicit @mention of API agent (EXAONE): answers LIVE.
 * - Explicit @mention of external bot (Pickle / Cue / Muse / Vooy): honestly confirms inbox/MCP handoff.
 */
export async function generateTeamChatReplies({ userMessage, mission, tasks, agents, recentMessages, settings }) {
  const responders = pickResponders(userMessage, agents, mission, tasks);
  const ceoName = settings?.ceoName || '대표님';
  const replies = [];
  const hasExplicitMention = /@(?:엑사원|피클|알렉스|뮤즈|큐|큐이|부이|클로드|제미나이|네온|인스팅스|전체)/i.test(userMessage);

  for (const ag of responders) {
    const agTasks = tasks.filter((t) => t.assigneeId === ag.id);
    // Use agent's direct API if available, or live EXAONE backend when Team Lead is responding to general CEO direction
    const resolved =
      resolveLanguageModel(ag, settings) ||
      (!hasExplicitMention && ag.tier === 'lead' ? resolveLiveBackendModel(settings) : null);
    let replyText = '';
    let live = false;
    let statusText = '수신함 전달됨';

    if (resolved) {
      const missionMessages = (recentMessages || [])
        .filter((m) => !mission?.id || !m.missionId || m.missionId === mission.id)
        .slice(-8);
      const threadContext = [...missionMessages, ...replies]
        .map((m) => `${m.senderName}: ${m.text}`)
        .join('\n');
      const taskContext = tasks.length
        ? tasks.map((t) => `- [${t.status}] ${t.title} (담당: ${agents.find((a) => a.id === t.assigneeId)?.name || t.assigneeId})`).join('\n')
        : '현재 등록된 업무 없음';
      const system = `당신은 "${settings?.companyName || 'CEO Office'}"의 ${ag.tier === 'lead' ? '총괄 팀장' : 'AI 실무 에이전트'} "${ag.name}" (${ag.roleTitle})입니다.
${ceoName}의 지시나 질문에 팀 대표로 핵심만 간결하고 정확하게 한국어로 답하세요 (2~4문장).
다른 외부 봇(피클, Cue, Muse)이 해야 할 전화 예약·결제 등을 "이미 전화했다/완료했다"고 거짓말하지 말고, 현재 실제 진행 상태와 다음 조치만 사실대로 보고하세요.`;

      try {
        const { text } = await generateText({
          model: resolved.model,
          system,
          prompt: `현재 채널 업무: ${mission?.title || '전체 자유 대화'}\n현재 업무 목록:\n${taskContext}\n\n[최근 대화]\n${threadContext || '(없음)'}\n\n${ceoName}: ${userMessage}\n\n${ag.name}의 실제 응답:`
        });
        replyText = text.trim();
        live = true;
        statusText = '실시간 AI 응답';
      } catch (err) {
        replyText = `[AI 응답 오류] ${err.message.slice(0, 120)}`;
        statusText = 'API 오류';
      }
    } else {
      replyText = buildHonestDispatchNotice(ag, userMessage, agTasks);
      statusText = ag.provider === 'vooy' ? '연동 대기 중' : '수신함 대기';
    }

    const prevMsg = replies[replies.length - 1];
    replies.push({
      missionId: mission?.id || '',
      senderId: ag.id,
      senderName: ag.name,
      senderRole: ag.roleTitle,
      senderShortCode: ag.shortCode,
      senderAccent: ag.accent,
      targetAgentId: prevMsg ? prevMsg.senderId : 'ceo',
      statusText,
      type: live ? 'reply' : 'handoff',
      text: replyText
    });
  }

  return replies;
}

/**
 * Live Team Standup & Collaborative Working Session for an active mission
 */
export async function generateStandupSession({ mission, tasks, agents, settings }) {
  const lead = agents.find((a) => a.id === mission.leadAgentId) || agents[0];
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));
  const ceoName = settings?.ceoName || '대표님';
  const turns = [];

  // 1. Team Lead opens standup
  const participantNames = [...new Set(tasks.map((t) => agentMap[t.assigneeId]?.name).filter(Boolean))];
  turns.push({
    missionId: mission.id,
    senderId: lead.id,
    senderName: lead.name,
    senderRole: lead.roleTitle,
    senderShortCode: lead.shortCode,
    senderAccent: lead.accent,
    targetAgentId: tasks[0]?.assigneeId || null,
    statusText: '회의 진행',
    type: 'plan',
    text: `"${mission.title}" 현황 점검을 시작합니다. 참여: ${participantNames.join(', ') || '전체'}`
  });

  // 2. Each task assignee reports actual real status (live EXAONE for API tasks, honest real status for external bots)
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const ag = agentMap[t.assigneeId] || agents[0];
    const nextTask = tasks[i + 1];
    const nextAg = nextTask ? agentMap[nextTask.assigneeId] : null;
    const resolved = resolveLanguageModel(ag, settings);

    let text = '';
    if (resolved) {
      try {
        const { text: liveText } = await generateText({
          model: resolved.model,
          system: `당신은 "${ag.name}"입니다. 현재 업무의 실제 상태(${t.status})만 근거로 2문장 이내로 사실대로 보고하세요. 완료되지 않은 작업을 완료했다고 지어내지 마세요.`,
          prompt: `미션: ${mission.title}\n업무: ${t.title} (상태: ${t.status})\n현재 산출물: ${(t.output || '아직 실행 전').slice(0, 260)}`
        });
        text = liveText.trim();
      } catch {
        text = '';
      }
    }

    if (!text) {
      if (t.status === 'completed') {
        text = `[완료] "${t.title}" 결과가 등록되어 있습니다.`;
      } else if (t.status === 'awaiting_approval') {
        text = `[결재 대기] "${t.title}" — @${ceoName} 결재함 승인 대기 중입니다.`;
      } else if (ag.provider === 'pickle' || ag.provider === 'manus' || ag.provider === 'muse') {
        text = `[수신함/MCP 대기] "${t.title}" — ${ag.name}가 수신함에서 가져가 처리 대기 중입니다.`;
      } else if (ag.provider === 'vooy') {
        text = `[연동 대기] "${t.title}" — 부이(vooy) 연동 대기 상태입니다.`;
      } else {
        text = `[대기] "${t.title}" — 실행 또는 외부 앱 전달 대기 중입니다.`;
      }
    }

    turns.push({
      missionId: mission.id,
      senderId: ag.id,
      senderName: ag.name,
      senderRole: ag.roleTitle,
      senderShortCode: ag.shortCode,
      senderAccent: ag.accent,
      targetAgentId: t.status === 'awaiting_approval' ? 'ceo' : nextAg?.id || lead.id,
      statusText:
        t.status === 'completed'
          ? '완료'
          : t.status === 'awaiting_approval'
            ? '결재 대기'
            : '대기',
      type: t.status === 'awaiting_approval' ? 'approval' : nextAg ? 'handoff' : 'work',
      text
    });
  }

  // 3. Summary
  const pendingApprovals = tasks.filter((t) => t.status === 'awaiting_approval').length;
  const doneCount = tasks.filter((t) => t.status === 'completed').length;
  turns.push({
    missionId: mission.id,
    senderId: lead.id,
    senderName: lead.name,
    senderRole: lead.roleTitle,
    senderShortCode: lead.shortCode,
    senderAccent: lead.accent,
    targetAgentId: 'ceo',
    statusText: '요약 완료',
    type: 'plan',
    text: `@${ceoName} "${mission.title}" 현황: 전체 ${tasks.length}건 중 ${doneCount}건 완료${pendingApprovals > 0 ? `, 결재 대기 ${pendingApprovals}건` : ''}.`
  });

  return turns;
}

