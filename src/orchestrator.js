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

  if (agent.connectionMode !== 'api') return null;

  if (agent.provider === 'gemini') {
    const cfg = providers.gemini;
    if (!cfg?.apiKey) return null;
    const google = createGoogleGenerativeAI({ apiKey: cfg.apiKey });
    const modelName =
      agent.costTier === 'free'
        ? cfg.freeModel || 'gemini-2.5-flash'
        : agent.modelId || cfg.paidModel || 'gemini-4-neon';
    return { model: google(modelName), label: `gemini:${modelName}` };
  }

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
    const modelName = p.freeModel || 'gemini-2.5-flash';
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

function selectLeadAgent(agents, costPolicy) {
  const active = agents.filter((a) => a.active);
  if (costPolicy === 'free_first') {
    return (
      active.find((a) => a.id === 'agent_exaone') ||
      active.find((a) => a.costTier === 'free') ||
      active[0]
    );
  }
  if (costPolicy === 'max_quality') {
    return (
      active.find((a) => a.id === 'agent_gemini_neon') ||
      active.find((a) => a.id === 'agent_claude') ||
      active[0]
    );
  }
  return (
    active.find((a) => a.id === 'agent_gemini_neon') ||
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

export async function decomposeDirective({ directive, title, domain, costPolicy, agents, settings }) {
  const leadAgent = selectLeadAgent(agents, costPolicy, settings);
  const activeAgents = agents.filter((a) => a.active);
  const resolved = resolveLanguageModel(leadAgent, settings);

  if (resolved) {
    const rosterText = activeAgents
      .map(
        (a) =>
          `- id: "${a.id}", 이름: "${a.name}", 직책: "${a.roleTitle}", 연동: "${a.connectionMode}", 비용: "${a.costTier}", 강점: "${a.strengths}"`
      )
      .join('\n');

    const system = `당신은 AI 조직의 총괄 팀장(${leadAgent.name})입니다.
CEO의 지시를 3~5개 구체적 실무 작업으로 분해하고, 아래 조직원 중 최적 담당자(assigneeId)를 배정하세요.
비용 정책: ${costPolicy} (free_first=무료 모델/에이전트 최대한 우선, balanced=핵심 기획만 유료·실무는 무료, max_quality=최고 성능 우선).
결제·예약 확정·외부 이메일/문자 발송·프로덕션 배포 등 되돌리기 어려운 행동은 반드시 requiresApproval=true로 지정하세요.

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
      const normalized = object.tasks.map((t) => ({
        ...t,
        assigneeId: validIds.has(t.assigneeId) ? t.assigneeId : activeAgents[0].id
      }));

      return {
        leadAgentId: leadAgent.id,
        planSummary: `${object.planSummary} (Vercel AI SDK · ${resolved.label})`,
        usedLiveApi: true,
        tasks: normalized
      };
    } catch (err) {
      const fallback = heuristicDecompose({ directive, domain, costPolicy, agents, leadAgent });
      fallback.planSummary = `[Live SDK 폴백: ${err.message.slice(0, 90)}] ${fallback.planSummary}`;
      return fallback;
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

  const resolved = resolveLanguageModel(agent, settings);
  if (resolved) {
    const system = `당신은 "${agent.name}" (${agent.roleTitle})입니다. 강점: ${agent.strengths}.
CEO의 지시를 완수할 수 있도록 간결하고 바로 실행 가능한 한국어 마크다운 보고서(표·체크리스트·초안 포함)를 작성하세요.
결제·예약·외부 발송·배포 등 CEO 결재가 필요한 작업이라면 실제 실행했다고 쓰지 말고 "CEO 결재 상신안"으로 정리하세요.`;

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

  // Rich simulation deliverable when API key isn't connected yet
  const modeNote =
    agent.connectionMode === 'api'
      ? 'API 키 미등록 — 드라이런 시뮬레이션'
      : agent.connectionMode === 'litellm'
        ? 'LiteLLM 프록시 미연결 — 드라이런 시뮬레이션'
        : agent.connectionMode === 'mcp'
          ? '공식 MCP 업무함 대기열 시뮬레이션'
          : '소비자 앱 · 구독 브릿지 시뮬레이션';

  const simOutput = `### ${agent.name} 실행 보고서
> **실행 방식**: ${modeNote}

#### 1. 핵심 요약
- **${task.title}** 작업을 CEO 지시("${mission.title}") 기준에 맞춰 구조화했습니다.
- ${task.description}

#### 2. 주요 산출물 · 점검표
| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 요구사항 및 선행 맥락 반영 | 완료 | 팀장 분배 전략 기준 적용 |
| 초안 / 후보안 작성 | 완료 | 바로 검토·수정 가능한 형태 |
| 외부 실행 · 결제 안전장치 | ${task.requiresApproval ? '**CEO 결재 대기**' : '해당 없음'} | ${task.requiresApproval ? '승인 전 실행 중단됨' : '내부 산출물'} |

- [x] 핵심 요구사항 충족 및 근거 정리
- [${task.requiresApproval ? ' ' : 'x'}] ${task.requiresApproval ? '예약 확정 · 결제 · 외부 발송 전 **CEO 결재함 상신**' : '팀장 종합 보고서 취합 준비 완료'}`;

  return { output: simOutput, executionModeUsed: 'simulation', live: false };
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

  const resolved = resolveLanguageModel(leadAgent, settings);
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
- 결재함에서 대기 중인 외부 실행(예약·결제·발송) 안건을 최종 확인해 주세요.
- 반복 수행할 리서치·브리핑은 **부이(vooy)** 또는 **Meta Muse** 루틴으로 고정하면 매주 자동 실행됩니다.`;
}

export function createApprovalForTask(task, agent, mission, reason, proposedAction) {
  return {
    id: uid('apr'),
    missionId: mission.id,
    taskId: task.id,
    agentId: agent.id,
    title: `${task.title} — CEO 실행 승인 요청`,
    category: task.estimatedCostKRW > 0 ? '예약 · 결제' : '대외 실행 · 최종 승인',
    riskLevel: task.estimatedCostKRW >= 100000 ? 'high' : task.estimatedCostKRW > 0 ? 'medium' : 'low',
    estimatedCostKRW: task.estimatedCostKRW || 0,
    depositKRW: 0,
    summary:
      reason ||
      `${agent.name}이(가) "${task.title}" 사전 준비를 마치고 실제 실행(예약/결제/발송/배포) 전 CEO 결재를 요청했습니다.`,
    proposedAction:
      proposedAction || `승인 시 "${task.title}" 작업이 확정 상태로 전환되며, 팀장 최종 임원 보고서에 반영됩니다.`,
    status: 'pending',
    ceoNote: '',
    createdAt: new Date().toISOString(),
    decidedAt: null
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
    { id: 'agent_gemini_neon', re: /제미나이|gemini|네온|neon|총괄|팀장/ },
    { id: 'agent_claude', re: /클로드|claude|수석|개발|코드|제안서/ },
    { id: 'agent_exaone', re: /엑사원|exaone|lg|무료|요약|정리|리서치|조사|단순|번역/ },
    { id: 'agent_muse', re: /뮤즈|muse|취향|일정|spaces/ },
    { id: 'agent_cue', re: /큐|cue|마누스|manus|이메일|메일/ },
    { id: 'agent_pickle', re: /피클|pickle|식당|예약|전화|병원|ktx/ },
    { id: 'agent_vooy', re: /부이|vooy|브리핑|뉴스|매일|모니터링|가격/ },
    { id: 'agent_instinct', re: /인스팅스|인스팅트|instinct|문자|심부름/ }
  ];

  if (/@전체|모두|전원|다들|보고해/.test(lower)) {
    const lead = active.find((a) => a.id === mission?.leadAgentId) || active[0];
    const assignedIds = [...new Set(tasks.map((t) => t.assigneeId))].filter((id) => id !== lead.id);
    const workers = assignedIds
      .map((id) => active.find((a) => a.id === id))
      .filter(Boolean)
      .slice(0, 3);
    return [lead, ...workers];
  }

  for (const item of aliasMap) {
    if (item.re.test(lower)) {
      const ag = active.find((a) => a.id === item.id);
      if (ag && !matched.some((m) => m.id === ag.id)) matched.push(ag);
    }
  }

  if (matched.length === 0) {
    const lead = active.find((a) => a.id === mission?.leadAgentId) || active[0];
    const firstWorker = active.find((a) => tasks.some((t) => t.assigneeId === a.id && a.id !== lead.id));
    if (lead) matched.push(lead);
    if (firstWorker) matched.push(firstWorker);
  }

  return matched.slice(0, 3);
}

function buildPersonaFallbackReply(agent, userMessage, mission, agentTasks, priorInTurn, ceoName) {
  const myTask = agentTasks[0];
  const prevSpeaker = priorInTurn[priorInTurn.length - 1];
  const prevRef = prevSpeaker ? `@${prevSpeaker.senderName} 님 의견 이어서 말씀드리면, ` : '';

  if (agent.tier === 'lead') {
    const taskList = agentTasks.length
      ? `현재 담당 중인 "${myTask.title}" 포함 전체 진척을 체크했습니다.`
      : `현재 미션("${mission?.title || '전사 운영'}") 기준으로 팀원들에게 우선순위를 재조정하겠습니다.`;
    return `${ceoName} 확인했습니다! "${userMessage.slice(0, 48)}${userMessage.length > 48 ? '…' : ''}" 요청을 반영해 ${taskList} 추가 비용이 발생하거나 외부 실행이 필요한 단계는 반드시 결재함으로 올리겠습니다.`;
  }

  switch (agent.provider) {
    case 'exaone':
      return `${prevRef}${ceoName}, LG K-EXAONE 2.5입니다! 한국어 요약·문서 초안·단순 반복 정리는 비용 0원 무료 API로 빠르게 처리하겠습니다. ${myTask ? `("${myTask.title}" 기준)` : '필요한 초안 바로 뽑아 팀장님께 넘기겠습니다!'}`;
    case 'pickle':
      return `${prevRef}${ceoName}, 피클입니다! 전화 문의·국내 예약 조건을 바로 반영하겠습니다. ${myTask ? `("${myTask.title}" 기준)` : ''} 실제 예약 확정이나 예약금 결제 전에는 절대 먼저 결제하지 않고 후보와 금액을 정리해서 결재 올리겠습니다!`;
    case 'vooy':
      return `${prevRef}부이(vooy)입니다! 무료 기본 모델 기준으로 반복 수집·가격 비교 조건을 업데이트해 두겠습니다. ${myTask ? `("${myTask.title}" 루틴 반영)` : ''} 매일 아침 핵심 5줄 브리핑으로 바로 받아보실 수 있게 정리할게요.`;
    case 'muse':
      return `${prevRef}Meta Muse입니다. 대표님 평소 취향과 일정 제약을 대조해 보니 충돌 없이 배치 가능합니다. Spaces 보드 형식으로 정리해 두고, MCP 커넥터로 결과를 동기화하겠습니다.`;
    case 'manus':
      return `${prevRef}Manus Cue입니다. 전용 에이전트 이메일과 가상 컴퓨터 환경에서 심층 자료를 정리하고 초안을 준비하겠습니다. 외부 수신자에게 실제 메일을 보내기 전에 꼭 CEO 승인을 요청드리겠습니다.`;
    case 'instinct':
      return `${prevRef}인스팅스입니다! 복잡한 절차 없이 문자 한 통으로 바로 확인해 회신드리겠습니다. 확정이나 결제가 필요하면 즉시 멈추고 여쭤볼게요.`;
    default:
      return `${prevRef}${agent.name}입니다. "${userMessage.slice(0, 40)}${userMessage.length > 40 ? '…' : ''}" 내용을 반영해 ${myTask ? `"${myTask.title}" 작업의 산출물` : '담당 초안과 체크리스트'}을 즉시 업데이트하고 팀장님께 보고하겠습니다.`;
  }
}

/**
 * Multi-agent live conversation in #전사-회의실 when CEO speaks
 */
export async function generateTeamChatReplies({ userMessage, mission, tasks, agents, recentMessages, settings }) {
  const responders = pickResponders(userMessage, agents, mission, tasks);
  const ceoName = settings?.ceoName || '대표님';
  const replies = [];

  for (const ag of responders) {
    const agTasks = tasks.filter((t) => t.assigneeId === ag.id);
    const resolved = resolveLanguageModel(ag, settings);
    let replyText = '';
    let live = false;

    if (resolved) {
      const threadContext = [...recentMessages.slice(-6), ...replies]
        .map((m) => `${m.senderName}: ${m.text}`)
        .join('\n');
      const taskContext = agTasks.length
        ? agTasks.map((t) => `- ${t.title} (상태: ${t.status})`).join('\n')
        : '현재 배정된 세부 업무 없음 (협업 지원)';
      const system = `당신은 AI 회사 "${settings?.companyName || 'CEO Office'}"의 직원 "${ag.name}" (${ag.roleTitle})입니다.
강점: ${ag.strengths}
동료 AI들과 사내 회의실(#전사-회의실)에서 대화하고 있습니다.
자연스럽고 간결한 한국어 사내 메신저 말투(2~3문장)로 대답하세요. 필요하면 앞선 동료(@이름)나 ${ceoName}을 멘션하며 협업·핸드오프·리스크 점검을 말하세요.`;

      try {
        const { text } = await generateText({
          model: resolved.model,
          system,
          prompt: `현재 미션: ${mission?.title || '전사 운영'}\n내 담당 업무:\n${taskContext}\n\n[최근 회의실 대화]\n${threadContext}\n\n${ceoName}: ${userMessage}\n\n당신(${ag.name})의 응답:`
        });
        replyText = text.trim();
        live = true;
      } catch {
        replyText = '';
      }
    }

    if (!replyText) {
      replyText = buildPersonaFallbackReply(ag, userMessage, mission, agTasks, replies, ceoName);
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
      statusText: live ? '실시간 AI 응답' : ag.tier === 'lead' ? '팀 조율 중' : '업무 협업 중',
      type: prevMsg ? 'handoff' : 'reply',
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
    statusText: '스탠드업 주재 중',
    type: 'plan',
    text: `팀 스탠드업 시작하겠습니다! 미션 "${mission.title}" 점검합니다. 참여 팀원(${participantNames.join(', ')}) 분들, 현재 진행 현황과 다음 담당자에게 넘길 내용 공유해 주세요.`
  });

  // 2. Each task assignee speaks & hands off to the next teammate
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const ag = agentMap[t.assigneeId] || agents[0];
    const nextTask = tasks[i + 1];
    const nextAg = nextTask ? agentMap[nextTask.assigneeId] : null;
    const resolved = resolveLanguageModel(ag, settings);

    let text = '';
    if (resolved) {
      try {
        const prevTurn = turns[turns.length - 1];
        const { text: liveText } = await generateText({
          model: resolved.model,
          system: `당신은 "${ag.name}" (${ag.roleTitle})입니다. 팀 스탠드업에서 자기 업무의 진행 상황을 2문장으로 생생하게 보고하세요.${nextAg && nextAg.id !== ag.id ? ` 다음 순서인 @${nextAg.name} 님에게 자연스럽게 바통을 넘겨주세요.` : ''}`,
          prompt: `미션: ${mission.title}\n내 업무: ${t.title} (상태: ${t.status}, 승인필요: ${t.requiresApproval})\n기존 산출물 요약: ${(t.output || t.description).slice(0, 260)}\n직전 발언(${prevTurn.senderName}): ${prevTurn.text}`
        });
        text = liveText.trim();
      } catch {
        text = '';
      }
    }

    if (!text) {
      const nextCallout =
        nextAg && nextAg.id !== ag.id ? ` 다음 단계인 @${nextAg.name} 님께 맥락 넘겨드리겠습니다!` : '';
      if (t.status === 'completed') {
        text = `"${t.title}" 작업 완료했습니다! 핵심 산출물과 근거 표를 공유함에 올려두었습니다.${nextCallout}`;
      } else if (t.status === 'awaiting_approval') {
        text = `"${t.title}" 사전 확인을 마쳤고, 실제 실행/결제 직전이라 멈춰두었습니다. @${ceoName} 결재함에서 승인해 주시면 바로 확정 처리하겠습니다!`;
      } else if (t.status === 'awaiting_bridge') {
        text = `"${t.title}" 실행 지시서 준비 끝났습니다! 지시서 복사 버튼으로 제 앱(${ag.name})에 전달해 주시면 바로 처리해서 결과 보고 올리겠습니다.${nextCallout}`;
      } else {
        text = `"${t.title}" 바로 착수할 준비가 되어 있습니다. 선행 자료 반영해서 초안 빠르게 뽑아 올리겠습니다.${nextCallout}`;
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
          ? '완료 보고 중'
          : t.status === 'awaiting_approval'
            ? 'CEO 결재 요청 중'
            : '실무 협업 중',
      type: t.status === 'awaiting_approval' ? 'approval' : nextAg ? 'handoff' : 'work',
      text
    });
  }

  // 3. Team Lead wraps up to CEO
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
    statusText: 'CEO 보고 완료',
    type: 'plan',
    text: `@${ceoName} 스탠드업 요약 보고드립니다. 전체 ${tasks.length}건 중 ${doneCount}건 완료${pendingApprovals > 0 ? `, CEO 결재 대기 ${pendingApprovals}건` : ''}입니다. 회의실에서 특정 팀원을 @멘션해 바로 수정 지시를 내리실 수 있습니다!`
  });

  return turns;
}

