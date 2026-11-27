import './ai-guard.js';
import { generateText, generateObject } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { uid } from './store.js';
import { buildMissionLiveContext } from './live-context.js';
import { askLeadDesk, hasLeadDeskWorker, isLeadPending } from './lead-desk.js';
import { isProviderCooling } from './ai-guard.js';
import { selectSkills, renderSkills, skillBlock, shouldReview, buildReviewRubric, getSkillSettings } from './skills.js';
import { getRepoSnapshot, buildCodeEvidence, factCheckOutput } from './grounding.js';
import { buildAnalyticsContext } from './google-data.js';
import { buildComplianceChecklist, deriveAcceptance, buildMissionBrief, buildTaskWorkOrder, buildTaskRecap, baseTaskDescription, extractChecklistItems } from './lead-engine.js';

function repoTokenFrom(settings) {
  return String(settings?.providers?.githubRepo?.apiKey || process.env.GITHUB_REPO_TOKEN || '').trim();
}

/** 미션에 연결된 저장소의 실제 코드 스냅샷(코드 근거·사실 확인용) */
export async function missionRepoSnapshot(mission, settings) {
  if (!mission?.githubRepo) return null;
  return getRepoSnapshot({ repo: mission.githubRepo, branch: mission.githubBranch || 'main', token: repoTokenFrom(settings) }).catch(() => null);
}

// ---- Company context hook (CEO 전역 지침 + 회사 기억 + 업무 상태) ----
// API로 연결된 모델은 호출마다 기억이 없으므로, 서버가 등록한 provider가 매 호출에 공통 맥락을 붙여 줍니다.
let companyContextProvider = null;
export function setCompanyContextProvider(fn) {
  companyContextProvider = typeof fn === 'function' ? fn : null;
}
function companyContextFor(missionId = '', opts = {}) {
  if (!companyContextProvider) return '';
  try {
    return String(companyContextProvider(missionId || '', opts) || '').trim();
  } catch {
    return '';
  }
}
function withCompanyContext(system, missionId = '', opts = {}) {
  const ctx = companyContextFor(missionId, opts);
  return ctx ? `${system}\n\n${ctx}` : system;
}

/**
 * Resolve a Vercel AI SDK model instance for any configured provider:
 * - Google Gemini (Free tier & Gemini 4 Neon) via @ai-sdk/google
 * - Anthropic Claude via @ai-sdk/anthropic
 * - LiteLLM Proxy (100+ providers & spend caps) via @ai-sdk/openai
 * - Ollama (Local open-source free models) via @ai-sdk/openai
 */
function createGeminiResilientFetch(primaryModel) {
  const fallbacks = ['gemini-3.8-flash', 'gemini-3.1-flash-lite-preview'].filter((m) => m !== primaryModel);
  return async (url, init) => {
    const res = await fetch(url, init);
    if (res.status !== 503 && res.status !== 429) return res;
    const urlStr = String(url);
    for (const fb of fallbacks) {
      if (urlStr.includes(encodeURIComponent(primaryModel)) || urlStr.includes(primaryModel)) {
        const fbUrl = urlStr
          .replace(encodeURIComponent(primaryModel), encodeURIComponent(fb))
          .replace(primaryModel, fb);
        try {
          const fbRes = await fetch(fbUrl, init);
          if (fbRes.ok) return fbRes;
        } catch {
          // try next fallback
        }
      }
    }
    return res;
  };
}

function createOpenAiModelFallbackFetch(fallbackModels = []) {
  return async (url, init) => {
    const withTimeout = (opts) => ({
      ...opts,
      signal: opts?.signal || AbortSignal.timeout(22000)
    });
    let res;
    try {
      res = await fetch(url, withTimeout(init));
      if (res.ok || ![400, 404, 429, 502, 503].includes(res.status)) return res;
    } catch {
      res = null;
    }
    if (!init?.body || typeof init.body !== 'string') {
      if (res) return res;
      throw new Error('모델 요청 시간 초과');
    }
    let parsed;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      if (res) return res;
      throw new Error('모델 요청 시간 초과');
    }
    if (!parsed?.model) {
      if (res) return res;
      throw new Error('모델 요청 시간 초과');
    }
    for (const fb of fallbackModels) {
      if (!fb || fb === parsed.model) continue;
      try {
        const fbRes = await fetch(url, withTimeout({
          ...init,
          body: JSON.stringify({ ...parsed, model: fb })
        }));
        if (fbRes.ok) return fbRes;
      } catch {
        // try next fallback
      }
    }
    if (res) return res;
    throw new Error('모델 응답 시간 초과');
  };
}

export function resolveLanguageModel(agent, settings) {
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

  // Gemini Team Lead runs directly on real Google AI Studio / Vertex Express API whenever a Gemini API key is configured
  if (agent.provider === 'gemini') {
    const cfg = providers.gemini;
    if (!cfg?.apiKey) return null;
    const rawModel = String(cfg.freeModel || '').trim();
    const modelName = rawModel && rawModel !== 'gemini-2.5-flash' ? rawModel : 'gemini-4-hydrogen';
    const resilientFetch = createGeminiResilientFetch(modelName);
    if (cfg.transport === 'openai_compat') {
      const client = createOpenAI({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: cfg.apiKey.trim(),
        compatibility: 'compatible'
      });
      return { model: client(modelName), label: `gemini-openai:${modelName}` };
    }
    if (cfg.transport === 'vertex_express') {
      const google = createGoogleGenerativeAI({
        baseURL: 'https://aiplatform.googleapis.com/v1beta1/publishers/google',
        apiKey: cfg.apiKey.trim(),
        fetch: resilientFetch
      });
      return { model: google(modelName), label: `gemini-vertex:${modelName}` };
    }
    const google = createGoogleGenerativeAI({ apiKey: cfg.apiKey.trim(), fetch: resilientFetch });
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

  if (agent.provider === 'groq') {
    const groqCfg = providers.groq;
    if (groqCfg?.apiKey) {
      const client = createOpenAI({
        baseURL: groqCfg.baseUrl || 'https://api.groq.com/openai/v1',
        apiKey: groqCfg.apiKey.trim(),
        compatibility: 'compatible',
        fetch: createOpenAiModelFallbackFetch(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
      });
      const rawModel = agent.modelId || groqCfg.model || 'openai/gpt-oss-120b';
      const modelName =
        rawModel === 'llama-3.3-70b-versatile'
          ? 'openai/gpt-oss-120b'
          : rawModel === 'qwen/qwen3-32b'
            ? 'qwen/qwen3.8-27b'
            : rawModel;
      return { model: client(modelName), label: `groq:${modelName}` };
    }
    const orCfg = providers.openrouter;
    if (orCfg?.apiKey) {
      const client = createOpenAI({
        baseURL: orCfg.baseUrl || 'https://openrouter.ai/api/v1',
        apiKey: orCfg.apiKey.trim(),
        compatibility: 'compatible',
        headers: { 'HTTP-Referer': 'https://ai-ceo-hub.onrender.com', 'X-Title': 'CEO Office' },
        fetch: createOpenAiModelFallbackFetch(['openrouter/free'])
      });
      return { model: client('openrouter/free'), label: 'openrouter:openrouter/free' };
    }
    return null;
  }

  if (agent.provider === 'openrouter') {
    const orCfg = providers.openrouter;
    if (orCfg?.apiKey) {
      const client = createOpenAI({
        baseURL: orCfg.baseUrl || 'https://openrouter.ai/api/v1',
        apiKey: orCfg.apiKey.trim(),
        compatibility: 'compatible',
        headers: {
          'HTTP-Referer': 'https://ai-ceo-hub.onrender.com',
          'X-Title': 'CEO Office'
        },
        fetch: createOpenAiModelFallbackFetch(['nvidia/nemotron-3.5-super-vl:free', 'openrouter/free'])
      });
      const rawModel = agent.modelId || orCfg.model || 'openrouter/free';
      const modelName =
        rawModel === 'deepseek/deepseek-r1:free' ||
        rawModel === 'qwen/qwen3-coder:free' ||
        rawModel === 'nvidia/nemotron-3-ultra-550b-a55b:free'
          ? 'nvidia/nemotron-3.5-lightning:free'
          : rawModel;
      return { model: client(modelName), label: `openrouter:${modelName}` };
    }
    const groqCfg = providers.groq;
    if (groqCfg?.apiKey) {
      const client = createOpenAI({
        baseURL: groqCfg.baseUrl || 'https://api.groq.com/openai/v1',
        apiKey: groqCfg.apiKey.trim(),
        compatibility: 'compatible',
        fetch: createOpenAiModelFallbackFetch(['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
      });
      return { model: client('openai/gpt-oss-120b'), label: 'groq:openai/gpt-oss-120b' };
    }
    return null;
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
    const apiKey = p.apiKey.trim();
    const rawModel = String(p.freeModel || '').trim();
    const modelName = rawModel && rawModel !== 'gemini-2.5-flash' ? rawModel : 'gemini-4-hydrogen';
    const nativeBody = {
      contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
      ...(/^gemini-[34]/.test(modelName)
        ? { generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } }
        : {})
    };

    const probes = [
      {
        transport: 'native',
        label: 'AI Studio Native',
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: nativeBody,
        extract: (d) => (d?.candidates?.[0]?.content?.parts || []).map((pt) => pt?.text || '').join('').trim()
      },
      {
        transport: 'openai_compat',
        label: 'AI Studio OpenAI호환',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: { model: modelName, messages: [{ role: 'user', content: 'Reply with OK' }] },
        extract: (d) => String(d?.choices?.[0]?.message?.content || '').trim()
      },
      {
        transport: 'vertex_express',
        label: 'Vertex Express',
        url: `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodeURIComponent(modelName)}:generateContent`,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: nativeBody,
        extract: (d) => (d?.candidates?.[0]?.content?.parts || []).map((pt) => pt?.text || '').join('').trim()
      },
      {
        transport: 'interactions',
        label: 'AI Studio Interactions',
        url: 'https://generativelanguage.googleapis.com/v1beta/interactions',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: { model: modelName, input: 'Reply with OK' },
        extract: (d) => String(d?.outputs?.[0]?.text || d?.text || 'OK').trim()
      }
    ];

    const results = await Promise.all(
      probes.map(async (pr) => {
        try {
          const r = await fetch(pr.url, {
            method: 'POST',
            headers: pr.headers,
            body: JSON.stringify(pr.body),
            signal: AbortSignal.timeout(10000)
          });
          const raw = await r.text();
          let data = {};
          try {
            data = JSON.parse(raw);
          } catch {
            // ignore
          }
          if (r.ok) {
            return { ok: true, transport: pr.transport, label: pr.label, reply: pr.extract(data) || 'OK' };
          }
          const errObj = Array.isArray(data) ? data[0]?.error : data?.error;
          const reason = errObj?.details?.[0]?.reason || errObj?.status || '';
          const msg = errObj?.message || raw.slice(0, 120) || `HTTP ${r.status}`;
          return { ok: false, transport: pr.transport, label: pr.label, status: r.status, reason, msg };
        } catch (err) {
          return {
            ok: false,
            transport: pr.transport,
            label: pr.label,
            status: 0,
            reason: err?.name || 'ERR',
            msg: err?.message || 'timeout'
          };
        }
      })
    );

    const winner = results.find((r) => r.ok);
    if (winner) {
      return {
        ok: true,
        model: modelName,
        transport: winner.transport,
        reply: `${winner.reply.slice(0, 40)} (${winner.label})`
      };
    }

    // 503 UNAVAILABLE on AI Studio means the API key PASSED authentication and only the model is temporarily overloaded!
    const overloaded = results.find(
      (r) => (r.transport === 'native' || r.transport === 'openai_compat') && r.status === 503
    );
    if (overloaded) {
      const fallbacks = ['gemini-3.8-flash', 'gemini-3.1-flash-lite-preview'].filter((m) => m !== modelName);
      for (const fb of fallbacks) {
        try {
          const fbRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(fb)}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
                generationConfig: { thinkingConfig: { thinkingLevel: 'low' } }
              }),
              signal: AbortSignal.timeout(8000)
            }
          );
          if (fbRes.ok) {
            const fbData = await fbRes.json().catch(() => ({}));
            const fbText = (fbData?.candidates?.[0]?.content?.parts || []).map((pt) => pt?.text || '').join('').trim() || 'OK';
            return {
              ok: true,
              model: `${modelName} (혼잡 시 ${fb} 자동전환)`,
              transport: 'native',
              reply: `키 인증 성공! ${fbText.slice(0, 20)} (${modelName} 구글 서버 일시 혼잡 → ${fb} 자동 대체)`
            };
          }
        } catch {
          // try next fallback
        }
      }
      return {
        ok: true,
        model: modelName,
        transport: 'native',
        reply: `API 키 인증 통과! (현재 ${modelName} 구글 서버 일시 혼잡 503 — 잠시 후 자동 정상화)`
      };
    }

    const summary = results
      .map((r) => `[${r.label}: ${r.status}${r.reason ? ` ${r.reason}` : ''}] ${r.msg}`)
      .join(' | ');
    throw new Error(`Gemini 4개 공식 경로 모두 거절됨 — ${summary}`);
  }

  if (providerKey === 'claude') {
    if (!p.apiKey) throw new Error('Claude API 키가 설정되지 않았습니다.');
    const anthropic = createAnthropic({ apiKey: p.apiKey });
    const modelName = p.model || 'claude-sonnet-4-5';
    const { text } = await generateText({
      model: anthropic(modelName),
      prompt: 'Respond with exactly: OK',
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15000)
    });
    return { ok: true, model: modelName, reply: text.trim().slice(0, 60) };
  }

  if (providerKey === 'groq') {
    if (!p.apiKey) throw new Error('Groq API 키가 설정되지 않았습니다.');
    const client = createOpenAI({
      baseURL: p.baseUrl || 'https://api.groq.com/openai/v1',
      apiKey: p.apiKey.trim(),
      compatibility: 'compatible'
    });
    const modelName = p.model || 'openai/gpt-oss-120b';
    const { text } = await generateText({
      model: client(modelName),
      prompt: 'Reply with OK',
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(12000)
    });
    return { ok: true, model: modelName, reply: text.trim().slice(0, 60) };
  }

  if (providerKey === 'openrouter') {
    if (!p.apiKey) throw new Error('OpenRouter API 키가 설정되지 않았습니다.');
    const client = createOpenAI({
      baseURL: p.baseUrl || 'https://openrouter.ai/api/v1',
      apiKey: p.apiKey.trim(),
      compatibility: 'compatible',
      headers: {
        'HTTP-Referer': 'https://ai-ceo-hub.onrender.com',
        'X-Title': 'CEO Office'
      }
    });
    const modelName = p.model || 'openrouter/free';
    const { text } = await generateText({
      model: client(modelName),
      prompt: 'Reply with OK',
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15000)
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
      prompt: '간단히 "연결 OK"라고 답하세요.',
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15000)
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
      prompt: 'Respond with exactly: OK',
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15000)
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
  // 외부 봇에도 같은 작업 지시서(완료 기준·팀장 피드백·반복 금지 실수)를 맨 앞에 붙임
  if (mission && !['pickle', 'instinct'].includes(agent.provider)) {
    const order = buildTaskWorkOrder(task, mission, { compact: true });
    const body = buildDispatchPromptBody(agent, { ...task, description: baseTaskDescription(task) }, mission, approvalRule);
    return `${order}\n\n${body}`;
  }
  return buildDispatchPromptBody(agent, task, mission, approvalRule);
}

function buildDispatchPromptBody(agent, task, mission, approvalRule) {
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

function pickFallbackWorker(agents) {
  const nonLeadActive = agents.filter((a) => a.active && a.tier !== 'lead');
  return nonLeadActive[0] || agents.find((a) => a.active) || agents[0];
}

function selectLeadAgent(agents) {
  // 팀장 업무함(AGY 주간 · Gemini 앱 당직) 기준 팀장 슬롯 참조 — 비상 API 팀장이 휴직이어도 실무 봇(Muse 등)으로 튀지 않게 유지
  return (
    agents.find((a) => a.id === 'agent_gemini_neon') ||
    agents.find((a) => a.tier === 'lead') ||
    agents.find((a) => a.active) ||
    agents[0]
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
        domain: z.enum(['business', 'life', 'content', 'dev', 'it_ops']),
        requiresApproval: z.boolean().describe('결제/예약확정/외부발송/배포 포함 시 true'),
        estimatedCostKRW: z.number().min(0).describe('예상 외부 비용(원), 없으면 0')
      })
    )
    .min(2)
    .max(6)
});

function heuristicDecompose({ directive, domain, costPolicy, agents, leadAgent }) {
  const active = agents.filter((a) => a.active && a.tier !== 'lead');
  const fallback = active[0] || agents.find((a) => a.active) || agents[0];
  const byId = (id) => active.find((a) => a.id === id);
  const pick = (ids) => ids.map(byId).find(Boolean) || fallback;

  const text = directive.toLowerCase();
  const tasks = [];
  const isFreeOnly = costPolicy === 'free_first';

  const researchAgent = pick(['agent_deepseek', 'agent_gemma', 'agent_groq', 'agent_exaone']);

  const deepWorkAgent = pick(['agent_gemma', 'agent_groq', 'agent_deepseek', 'agent_exaone']);

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
    const devAgent = pick(['agent_qwen', 'agent_it_dev', 'agent_groq']);
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
      ? pick(['agent_cue', 'agent_groq', 'agent_exaone'])
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

export function resolveLiveBackendModel(settings) {
  const gem = settings?.providers?.gemini;
  if (gem?.apiKey) {
    const rawModel = String(gem.freeModel || '').trim();
    const modelName = rawModel && rawModel !== 'gemini-2.5-flash' ? rawModel : 'gemini-4-hydrogen';
    if (gem.transport === 'openai_compat') {
      const client = createOpenAI({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: gem.apiKey.trim(),
        compatibility: 'compatible'
      });
      return { model: client(modelName), label: `gemini-openai:${modelName}` };
    }
    if (gem.transport === 'vertex_express') {
      const google = createGoogleGenerativeAI({
        baseURL: 'https://aiplatform.googleapis.com/v1beta1/publishers/google',
        apiKey: gem.apiKey.trim()
      });
      return { model: google(modelName), label: `gemini-vertex:${modelName}` };
    }
    const google = createGoogleGenerativeAI({ apiKey: gem.apiKey.trim() });
    return { model: google(modelName), label: `gemini:${modelName}` };
  }
  const orCfg = settings?.providers?.openrouter;
  if (orCfg?.apiKey) {
    const client = createOpenAI({
      baseURL: orCfg.baseUrl || 'https://openrouter.ai/api/v1',
      apiKey: orCfg.apiKey.trim(),
      compatibility: 'compatible',
      headers: {
        'HTTP-Referer': 'https://ai-ceo-hub.onrender.com',
        'X-Title': 'CEO Office'
      }
    });
    const modelName = orCfg.model || 'openrouter/free';
    return { model: client(modelName), label: `openrouter:${modelName}` };
  }
  const groq = settings?.providers?.groq;
  if (groq?.apiKey) {
    const client = createOpenAI({
      baseURL: groq.baseUrl || 'https://api.groq.com/openai/v1',
      apiKey: groq.apiKey.trim(),
      compatibility: 'compatible'
    });
    const modelName = groq.model || 'openai/gpt-oss-120b';
    return { model: client(modelName), label: `groq:${modelName}` };
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
  return null;
}

/**
 * 팀장 판단(업무 분해·다음 단계 제안)용 모델 체인.
 * Gemini 무료 한도(하루 20회)가 바닥나도 Groq → OpenRouter → Gemini Flash → 기본 엔진 순으로 이어서 판단합니다.
 * (예전에는 팀장 모델 하나만 쓰다가 실패하면 '고도화 · 실행 확장' 같은 일반 템플릿으로 채워 같은 결재가 반복됨)
 */
function buildLeadModelChain(leadAgent, settings, agents = null) {
  const p = settings?.providers || {};
  const chain = [];
  // 휴직 중인 무료 API(Groq·OpenRouter·Gemini 비상 API 등)는 팀장 대체 엔진으로도 쓰지 않음 (활성 팀원이 그 제공자를 쓸 때만)
  const providerOn = (prov) => !Array.isArray(agents) || agents.some((a) => a.active && a.provider === prov);
  const push = (m) => {
    if (m && m.model && !chain.some((c) => c.label === m.label)) chain.push(m);
  };
  if (leadAgent && (!Array.isArray(agents) || leadAgent.active)) push(resolveLanguageModel(leadAgent, settings));
  if (p.groq?.apiKey && providerOn('groq')) {
    const client = createOpenAI({
      baseURL: p.groq.baseUrl || 'https://api.groq.com/openai/v1',
      apiKey: p.groq.apiKey.trim(),
      compatibility: 'compatible'
    });
    push({ model: client('openai/gpt-oss-120b'), label: 'groq:openai/gpt-oss-120b' });
    push({ model: client('openai/gpt-oss-20b'), label: 'groq:openai/gpt-oss-20b' });
  }
  if (p.openrouter?.apiKey && providerOn('openrouter')) {
    const client = createOpenAI({
      baseURL: p.openrouter.baseUrl || 'https://openrouter.ai/api/v1',
      apiKey: p.openrouter.apiKey.trim(),
      compatibility: 'compatible'
    });
    push({ model: client('openrouter/free'), label: 'openrouter:openrouter/free' });
  }
  if (p.gemini?.apiKey && providerOn('gemini')) {
    const google = createGoogleGenerativeAI({ apiKey: p.gemini.apiKey.trim() });
    push({ model: google('gemini-3.8-flash'), label: 'gemini:gemini-3.8-flash' });
  }
  if (!Array.isArray(agents) || agents.some((a) => a.active && ['gemini', 'groq', 'openrouter', 'exaone'].includes(a.provider))) {
    push(resolveLiveBackendModel(settings));
  }
  return chain;
}

async function generateObjectChain(models, opts) {
  // 팀장 업무함: 깨어 있는 팀장(AGY 주간 · Gemini 앱 당직)에게 먼저. 답이 없으면 LeadPendingError, 쓰지 않으면 아래 API 체인
  if (opts.leadDesk) {
    const { leadDesk, ...rest } = opts;
    const viaDesk = askLeadDesk({ ...leadDesk, system: rest.system, prompt: rest.prompt, schema: rest.schema });
    if (viaDesk) return viaDesk;
    opts = rest;
  } else if ('leadDesk' in opts) {
    const { leadDesk, ...rest } = opts;
    opts = rest;
  }
  if (!Array.isArray(models) || !models.length) throw new Error('사용 가능한 AI 엔진 없음');
  const errors = [];
  for (const m of models) {
    for (const mode of ['auto', 'json']) {
      try {
        const { object } = await generateObject({
          ...opts,
          model: m.model,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(90000),
          ...(mode === 'json' ? { mode: 'json' } : {})
        });
        return { object, label: m.label };
      } catch (err) {
        const msg = String(err?.message || err).replace(/\s+/g, ' ').slice(0, 120);
        errors.push(`${m.label}${mode === 'json' ? '(json)' : ''}: ${msg}`);
        if (/quota|cooldown|429|rate limit|401|403|api key/i.test(msg)) break;
      }
    }
  }
  const e = new Error(`모든 AI 엔진 호출 실패 → ${errors.slice(0, 4).join(' | ')}`);
  e.errors = errors;
  throw e;
}

export async function decomposeDirective({
  directive,
  title,
  domain,
  costPolicy,
  agents,
  settings,
  githubRepo = '',
  githubBranch = 'main',
  siteUrl = '',
  extraRepos = [],
  planningRoster = '',
  assignmentRules = ''
}) {
  const leadAgent = selectLeadAgent(agents, costPolicy, settings);
  const assignableAgents = agents.filter((a) => a.active && a.tier !== 'lead');
  const fallbackWorker = pickFallbackWorker(agents);
  const chain = buildLeadModelChain(leadAgent, settings, agents);

  if (chain.length) {
    const rosterText = assignableAgents
      .map(
        (a) =>
          `- id: "${a.id}", 이름: "${a.name}", 소속: "${a.team === 'it' ? 'IT유지보수팀' : '전략실행본부'}", 직책: "${a.roleTitle}", 연동: "${a.connectionMode}", 비용: "${a.costTier}", 강점: "${a.strengths}"`
      )
      .join('\n');

    const liveContext =
      githubRepo || siteUrl
        ? await buildMissionLiveContext({
            mission: { title, directive, domain, githubRepo, githubBranch, siteUrl, extraRepos },
            settings
          }).catch(() => '')
        : '';

    const system = withCompanyContext(`당신은 AI 조직의 총괄 팀장(${leadAgent.name})입니다.
CEO의 지시를 3~5개 구체적 실무 작업으로 분해하고, 아래 조직원 중 최적 담당자(assigneeId)를 배정하세요.
부서 배정 규칙:
- 업무 영역이 "it_ops"이거나 코드 수정·버그 해결·SEO/데이터 파일 수정·보안 점검 지시일 때는 **IT유지보수팀(agent_it_dev, agent_it_sec, agent_it_qa)** 에게 우선 배정하세요.
- 일반 비즈니스·콘텐츠·생활 프로젝트는 **전략실행본부** 팀원에게 우선 배정하세요.
권한 위임 및 정직성 규칙 (매우 중요):
- 리서치, 시장 조사, 전략/로드맵 수립, MVP 기획, SEO·콘텐츠·문서 초안, 코드 패치 초안·보안 감사·QA 시나리오 등 일반 실무는 모두 **팀장 전결(requiresApproval=false)**로 자동 진행합니다.
- CEO 결재(requiresApproval=true)는 오직 **실제 금전 결제/송금/광고비 집행, 외부 식당·병원 예약 최종 확정, 대외 공식 발송·프로덕션 코드 실배포**처럼 되돌리기 어렵고 영향이 큰 의사결정에만 지정하세요.
- GitHub 저장소나 라이브 사이트 현황이 제공된 경우, 추상적 작업 대신 **실제 저장소 파일과 라이브 페이지 점검 결과에 기반한 구체적 개선 작업**을 배정하세요.
- GA4·AdSense 등 미연동 외부 API를 "실제 조회 완료"하라는 허위 업무 대신, 실제 코드·SEO·콘텐츠·체크리스트 중심으로 분해하세요.

[활성 AI 조직원]
${planningRoster || rosterText}
${assignmentRules ? `\n${assignmentRules}\n` : ''}
${skillBlock({ agent: leadAgent, mission: { directive, domain }, purpose: 'decompose', settings, compact: true, max: 1 })}`, '', { compact: true });

    try {
      const { object } = await generateObjectChain(chain, {
        schema: PlanSchema,
        system,
        prompt: `미션 제목: ${title || '(자동)'}\n업무 영역: ${domain}\nCEO 지시:\n${directive}${
          liveContext ? `\n\n${liveContext}` : ''
        }`
      });

      const validIds = new Set(assignableAgents.map((a) => a.id));
      const majorDecisionRe = /결제|송금|계약|광고비|예약\s*확정|최종\s*예약|실제\s*발송|대외\s*발송|프로덕션\s*배포|실배포/;
      const normalized = object.tasks.map((t) => {
        const safeAssignee = validIds.has(t.assigneeId) ? t.assigneeId : fallbackWorker.id;
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
    } catch (err) {
      const fb = heuristicDecompose({ directive, domain, costPolicy, agents, leadAgent });
      return { ...fb, usedLiveApi: false, aiFailed: true, fallbackReason: String(err?.message || err).slice(0, 300) };
    }
  }

  return { ...heuristicDecompose({ directive, domain, costPolicy, agents, leadAgent }), usedLiveApi: false, fallbackReason: '사용 가능한 AI 엔진 없음' };
}

// 빈 응답(예: EXAONE이 200 OK로 빈 문자열을 돌려줌)을 '완료'로 처리하지 않도록 실패로 취급해 다음 엔진으로 넘깁니다.
function assertUsableOutput(text, label = '') {
  const t = String(text || '').trim();
  if (t.length < 80) {
    throw new Error(`${label || 'AI'} 응답이 비어 있거나 너무 짧음(${t.length}자)`);
  }
}

export async function executeAgentTask({ task, mission, agent, settings, priorOutputs = [] }) {
  const contextBlock =
    priorOutputs.length > 0
      ? `\n\n[다른 팀원 선행 결과]\n${priorOutputs
          .map((o) => `- ${o.title} (${o.agentName}): ${o.output.slice(0, 350)}`)
          .join('\n')}`
      : '';

  const [liveContext, snapshot] = await Promise.all([
    buildMissionLiveContext({ mission, settings }).catch(() => ''),
    missionRepoSnapshot(mission, settings)
  ]);
  // 실제 코드 근거: 작업 키워드로 저장소에서 찾은 줄(없는 것은 "없음"으로 명시)
  const evidenceText = `${task?.title || ''}\n${task?.description || ''}`;
  const evidence = snapshot ? buildCodeEvidence(snapshot, evidenceText) : '';
  const evidenceCompact = snapshot ? buildCodeEvidence(snapshot, evidenceText, { compact: true }) : '';
  const liveBlock = `${liveContext ? `\n\n${liveContext}` : ''}${evidence ? `\n\n${evidence}` : ''}`;

  // Manus API dedicated path
  if (agent.provider === 'manus' && agent.connectionMode === 'api' && settings?.providers?.manus?.apiKey) {
    const output = await callManusApi({
      apiKey: settings.providers.manus.apiKey,
      baseUrl: settings.providers.manus.baseUrl,
      prompt: `미션: ${mission.title}\n작업: ${task.title}\n상세: ${task.description}${liveBlock}${contextBlock}`
    });
    return { output, executionModeUsed: 'live_api:manus', live: true };
  }

  // Internal AI agents run autonomously under Team Lead authority using direct API or live backend engine
  const isInternalAi = ['exaone', 'gemini', 'groq', 'openrouter'].includes(agent.provider);
  const resolved = resolveLanguageModel(agent, settings) || (isInternalAi ? resolveLiveBackendModel(settings) : null);
  if (resolved) {
    const system = `당신은 "${agent.name}" (${agent.roleTitle})입니다. 강점: ${agent.strengths}.
총괄 팀장(${mission?.leadAgentId === 'agent_gemini_neon' ? 'Gemini 4 Hydrogen' : '팀장'})의 위임을 받아 CEO 지시를 완수할 수 있도록 바로 실행 가능한 한국어 마크다운 결과물(표·체크리스트·실제 파일 기반 패치안 포함)을 작성하세요.

[사실 기반 실행 & 거짓 보고 금지 규칙 — 엄수]
1. 아래 [실제 시스템 권한 및 도구 현황]에 제공된 실제 사이트 점검 결과와 실제 GitHub 저장소 파일 목록·커밋을 근거로 분석하고, **존재하는 실제 파일 경로**를 정확히 인용하세요.
2. GA4 실제 트래픽·이탈률 수치, AdSense 수익, 서치콘솔 클릭수, 유료 광고 집행, 대외 이메일 발송 등 **미연동 외부 시스템에 접속·조회·실행했다고 절대 거짓으로 쓰지 마세요.** (추정치나 가설 수치를 실제 측정값처럼 꾸며내는 것도 금지)
3. 미연동 외부 작업이 필요하면 반드시 \`[외부 권한 미연동 — 대표님 실행 가이드/초안]\` 배지를 달아 대표님이 직접 실행할 체크리스트로 정리하세요.
4. 연동된 GitHub 저장소의 코드·SEO·데이터 수정안은 IT 유지보수팀이 \`실코드 수정 · GitHub PR\`로 즉시 반영할 수 있게 **대상 파일 경로와 구체적 변경 내용**을 명확히 제시하세요.
5. 아래 [CEO 전역 지침]과 [회사 기억]은 이전 대화·결정의 요약입니다. 이미 결정·반려된 내용을 되풀이하지 말고, 그 결정을 전제로 작업하세요.
6. 당신의 결과물은 팀장이 검토합니다. "정보를 주세요·접근할 수 없습니다"라는 답만 쓰면 완료로 인정되지 않고 다시 배정됩니다. 저장소가 없거나 값을 모르면 가정을 "가정:"으로 밝히고, 바로 쓸 수 있는 결과물(파일 경로와 전체 내용, 완성 문서)을 끝까지 만드세요. 확인이 필요한 항목은 맨 끝 "확인 필요" 목록으로 모으세요.
7. 오직 로그인이 필요한 계정·콘솔 작업(애드센스·서치콘솔 설정, 결제 수단 등)이나 실제 브라우저 조작이 꼭 필요한 일만 결과 맨 앞줄에 \`[외주 필요: 구체적인 사유]\`를 쓰세요(저장소 미연결·정보 부족은 외주 사유가 아님). 그 아래에 외부 작업자가 바로 시작할 수 있게 해야 할 일·완료 기준·확인할 곳을 정리하세요.`;
    const companyCtx = companyContextFor(mission?.id);
    const companyCtxCompact = companyContextFor(mission?.id, { compact: true });
    // 작업 유형에 맞는 스킬(절차·출력 형식·자체 점검표) 주입
    const skills = selectSkills({ agent, task, mission, purpose: 'task', settings });
    const skillsFull = renderSkills(skills);
    const skillsCompact = renderSkills(skills, { compact: true });
    const systemFull = [system, skillsFull, companyCtx].filter(Boolean).join('\n\n');
    const systemCompact = [system, skillsCompact, companyCtxCompact].filter(Boolean).join('\n\n');

    // 지시서(맨 앞) + 본문 + 자가 점검(맨 끝): 작은 모델이 팀장 피드백·완료 기준을 놓치지 않게 양쪽에 둡니다
    const recap = buildTaskRecap(task);
    const checklistBlock = [buildComplianceChecklist(mission), recap].filter(Boolean).join('\n');
    const workOrder = buildTaskWorkOrder(task, mission);
    const workOrderCompact = buildTaskWorkOrder(task, mission, { compact: true });
    const baseDesc = baseTaskDescription(task);
    const prompt = `${workOrder}

미션: ${mission.title}
CEO 원지시: ${mission.directive}
담당 작업: ${task.title}
상세 요구사항: ${baseDesc}${liveBlock}${contextBlock}${checklistBlock ? `\n\n${checklistBlock}` : ''}`;

    const buildBackupModels = () => {
      const backups = [];
      const p = settings?.providers || {};
      if (agent.provider !== 'groq' && p.groq?.apiKey) {
        const client = createOpenAI({
          baseURL: p.groq.baseUrl || 'https://api.groq.com/openai/v1',
          apiKey: p.groq.apiKey.trim(),
          compatibility: 'compatible',
          fetch: createOpenAiModelFallbackFetch(['openai/gpt-oss-20b'])
        });
        backups.push({ model: client('openai/gpt-oss-120b'), label: 'groq-backup:openai/gpt-oss-120b' });
      }
      if (agent.provider !== 'exaone' && p.exaone?.apiKey) {
        const client = createOpenAI({
          baseURL: p.exaone.baseUrl || 'https://api.exaone.ai/v1',
          apiKey: p.exaone.apiKey.trim(),
          compatibility: 'compatible'
        });
        backups.push({ model: client(p.exaone.model || 'k-exaone_v2.5'), label: 'exaone-backup:k-exaone_v2.5' });
      }
      if (agent.provider !== 'gemini' && p.gemini?.apiKey) {
        const google = createGoogleGenerativeAI({
          apiKey: p.gemini.apiKey.trim(),
          fetch: createGeminiResilientFetch('gemini-3.8-flash')
        });
        backups.push({ model: google('gemini-3.8-flash'), label: 'gemini-backup:gemini-3.8-flash' });
      }
      return backups;
    };

    // Compact variant for free tiers with small per-minute token budgets (e.g. Groq "Request too large")
    const compactPrompt = `${workOrderCompact}

미션: ${mission.title}
CEO 원지시: ${String(mission.directive || '').slice(0, 800)}
담당 작업: ${task.title}
상세 요구사항: ${baseDesc.slice(0, 1500)}${evidenceCompact ? `\n\n${evidenceCompact}` : ''}${liveContext ? `\n\n${String(liveContext).slice(0, 2200)}` : ''}${contextBlock ? `\n${contextBlock.slice(0, 1200)}` : ''}${checklistBlock ? `\n\n${checklistBlock}` : ''}`;
    const isSizeError = (err) => /too large|413|context length|maximum context|tokens per mi|reduce the length/i.test(String(err?.message || err));

    // 초안 → (중요 작업이면) 다른 모델의 스킬 점검표 채점 → 기준 미달 시 수정본
    const finish = async (text, label) => {
      const draftText = String(text || '').trim();
      // 기계적 사실 확인: 없는 파일·PR·클래스, 지어낸 측정값, 권한 없는 "했다" 보고
      const factIssues = factCheckOutput(draftText, snapshot, { canExecute: false });
      const refined = await refineDraft({
        draft: draftText,
        forcedIssues: factIssues,
        recheck: (t) => factCheckOutput(t, snapshot, { canExecute: false }),
        authorLabel: label,
        system: systemCompact,
        taskPrompt: compactPrompt,
        skills,
        task,
        agent,
        settings,
        references: companyCtxCompact
      });
      return {
        output: refined.output,
        executionModeUsed: `live_sdk:${label}${refined.quality?.revised ? '+review' : ''}`,
        live: true,
        quality: refined.quality
      };
    };

    let draft = null;
    let draftLabel = '';
    try {
      const { text } = await generateText({
        model: resolved.model,
        system: systemFull,
        prompt,
        maxTokens: 2800,
        maxRetries: 0, abortSignal: AbortSignal.timeout(120000)
      });
      assertUsableOutput(text, resolved.label);
      draft = text;
      draftLabel = resolved.label;
    } catch (primaryErr) {
      const sizeErr = isSizeError(primaryErr);
      if (sizeErr) {
        try {
          const { text } = await generateText({ model: resolved.model, system: systemCompact, prompt: compactPrompt, maxTokens: 2000, maxRetries: 0, abortSignal: AbortSignal.timeout(120000) });
          assertUsableOutput(text, resolved.label);
          draft = text;
          draftLabel = `${resolved.label}(compact)`;
        } catch {
          // fall through to backups
        }
      }
      if (draft !== null) return finish(draft, draftLabel);
      for (const backup of buildBackupModels()) {
        try {
          const useCompact = sizeErr || /groq/.test(backup.label);
          const { text } = await generateText({
            model: backup.model,
            system: useCompact ? systemCompact : systemFull,
            prompt: useCompact ? compactPrompt : prompt,
            maxTokens: 2800,
            maxRetries: 0, abortSignal: AbortSignal.timeout(120000)
          });
          assertUsableOutput(text, backup.label);
          return finish(text, backup.label);
        } catch {
          // try next backup
        }
      }
      throw primaryErr;
    }
    return finish(draft, draftLabel);
  }

  // External action bots (Pickle / Cue / Muse / Vooy / Instinct): prepare honest handoff brief without faking phone calls/emails
  const helperModel = resolveLiveBackendModel(settings);
  const channelLabel =
    agent.provider === 'pickle'
      ? '피클(알렉스) HTTPS 수신함 전달 완료'
      : agent.provider === 'vooy'
        ? '부이(vooy) HTTPS 수신함 전달 완료'
        : agent.provider === 'muse'
          ? 'Meta Muse 공식 MCP 전달 완료'
          : agent.provider === 'manus'
            ? 'Manus Cue HTTPS/MCP 전달 완료'
            : `${agent.name} 전달 대기`;

  if (helperModel) {
    try {
      const { text } = await generateText({
        model: helperModel.model,
        system: withCompanyContext(`당신은 총괄 팀장 보좌 AI입니다. 외부 실행 봇(${agent.name})이 바로 처리할 수 있도록 핵심 실행 체크리스트와 조건을 간결한 한국어 마크다운으로 정리하세요. 전화 예약·결제·이메일 발송을 "이미 완료했다"고 거짓으로 쓰지 마세요.`, mission?.id, { compact: true }),
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
        system: withCompanyContext(
          `당신은 총괄 팀장(${leadAgent.name})입니다. 팀원 결과를 취합해 CEO가 30초 안에 파악하고 의사결정할 수 있는 최종 임원 보고서(Executive Brief)를 한국어 마크다운(표·체크리스트 포함)으로 작성하세요. 첫 두 줄은 "무엇이 끝났고 무엇이 남았는지"를 한 문장씩 사실대로 쓰고, 대표님이 직접 해야 할 일이 있으면 별도 체크리스트로 분리하세요.

${skillBlock({ agent: leadAgent, mission, purpose: 'report', settings, compact: true, max: 1 })}`,
          mission?.id,
          { compact: true }
        ),
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
  const checklist = extractChecklistItems(`${task?.leadBrief || ''}\n${task?.output || ''}`, 10);
  const leadSummary = String(task?.review?.executiveSummary || '').trim();
  const leadBrief = String(task?.leadBrief || task?.review?.refinedReport || '').trim();
  const leadRec = String(task?.review?.recommendedAction || '').trim();
  const fallbackReason = String(reason || task?.pendingApprovalReason || '').trim();
  const customTitle = String(task?.pendingApprovalTitle || '').trim();
  return {
    id: uid('apr'),
    missionId: mission?.id || task?.missionId || '',
    taskId: task.id,
    taskIds: task?.id ? [task.id] : [],
    agentId: leadId,
    workerName: agent?.name || '',
    ...(task?.review?.score != null ? { leadScore: task.review.score } : {}),
    ...(task?.review?.reviewer ? { leadReviewer: task.review.reviewer } : {}),
    ...(leadBrief ? { leadBrief } : {}),
    title: customTitle || `${task.title} — CEO 실행 승인 요청`,
    category: task.estimatedCostKRW > 0 ? '예약 · 결제' : '대외 실행 · 최종 승인',
    riskLevel: task.estimatedCostKRW >= 100000 ? 'high' : task.estimatedCostKRW > 0 ? 'medium' : 'low',
    estimatedCostKRW: task.estimatedCostKRW || 0,
    depositKRW: 0,
    ...(checklist.length ? { checklist } : {}),
    summary:
      leadSummary ||
      fallbackReason ||
      `[실무: ${agent?.name || '팀원'} → 총괄 팀장 검토 후 상신] "${task.title}" 사전 준비를 마치고 실제 실행(예약/결제/발송/배포) 전 CEO 결재를 요청합니다.`,
    proposedAction:
      leadRec ||
      proposedAction ||
      `승인 시 "${task.title}" 작업이 확정 상태로 전환되며, 팀장 최종 임원 보고서에 반영됩니다.`,
    status: 'pending',
    ceoNote: '',
    createdAt: new Date().toISOString(),
    decidedAt: null
  };
}

const LeadReviewSchema = z.object({
  verdict: z.enum(['accept', 'revise', 'escalate']).describe('accept: 완료 기준을 모두 충족하고 품질이 충분해 대표님 보고 가능 / revise: 품질 미흡·핵심 누락·초안 수준이라 보완 필요 / escalate: 이 팀원·도구로는 불가(실제 웹 조사·로그인·실행 필요 등)'),
  score: z.number().describe('0~10 (품질·근거·실행력 종합 점수)'),
  missing: z.array(z.string()).max(6).describe('충족하지 못한 완료 기준이나 빠진 것 (구체적으로)'),
  feedback: z.string().describe('revise/escalate일 때 다음 작업자가 바로 고칠 수 있는 구체적 지시 (무엇을, 어떻게). accept면 간단한 검토 메모 또는 빈 문자열'),
  executiveSummary: z.string().optional().describe('accept일 때 필수: 대표님이 10초 안에 핵심을 파악하고 결정할 수 있도록 팀장이 직접 재가공한 임원 보고 요약(핵심 결론·근거 수치·주의점 포함 3~5문장. 봇 원문 복붙·형식적 문구 금지)'),
  refinedReport: z.string().optional().describe('accept일 때 필수: 팀원 원문을 대표님 보고용 양질의 마크다운 보고서(## 핵심 결론 / ## 정리된 본문·안건 / ## 리스크 및 검토 의견 / ## 팀장 권고)로 재가공한 본문. 쇼츠 대본처럼 JSON 코드 블록이 포함된 경우 사람이 읽기 좋게 대본을 정리하고 JSON 원문은 건드리지 말 것'),
  recommendedAction: z.string().optional().describe('accept일 때 권장: 대표님께 권고하는 결정(승인/조건부 승인/수정 요청)과 그 이유 1~2문장')
});

/**
 * 팀장 검수: 팀원 결과물을 업무의 완료 기준과 업무 브리핑으로 판정 + 대표님 보고용 양질 재가공
 * AI 엔진을 쓸 수 없으면 판정을 건너뜀(skipped) — 업무를 멈추지 않기 위해
 */
// 결과물·피드백에 나온 파일 경로 (저장소 실제 확인용)
const REPO_PATH_RE = /((?:[\w.-]+\/)+[\w.-]+\.(?:json|js|mjs|cjs|tsx|ts|jsx|css|html|ya?ml|md|xml|txt))(?![\w-])/g;
const pathsIn = (text = '') => [...new Set([...String(text).matchAll(REPO_PATH_RE)].map((m) => m[1].replace(/^\.\//, '')).filter((p) => !/^(https?:|www\.)/.test(p)))];
/** "없는 파일"이라고 했는데 실제로는 저장소에 있는 파일을 가리키는 지적 */
export function isFalseMissingClaim(text = '', fileSet = null) {
  if (!fileSet || !/(없|존재하지|가상|찾을 수 없)/.test(String(text))) return false;
  return pathsIn(text).some((p) => fileSet.has(p));
}

export async function leadReviewDeliverable({ task, output, mission, agents, settings }) {
  const leadAgent = agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon')) || agents.find((a) => a.tier === 'lead') || agents[0];
  const chain = buildLeadModelChain(leadAgent, settings, agents);
  const acceptance = deriveAcceptance(task);
  if (!chain.length && !hasLeadDeskWorker()) return { verdict: 'accept', skipped: true, reason: 'AI 엔진 없음', acceptance };
  const system = `당신은 총괄 팀장(${leadAgent?.name || '팀장'})입니다.
당신의 의무는 단순히 "규정 위반만 없으면 통과시키는 전달자"가 아니라, ① 엄격한 품질 검증 후 ② 대표님이 바로 의사결정할 수 있는 **양질의 임원 보고서로 재가공**해 올리는 것입니다.

판정 및 재가공 원칙:
- accept: 완료 기준을 모두 충족하고, 사실 근거·구체성·실행력이 충분할 때만.
- revise: 규정 위반이 없더라도 내용이 빈약하거나, 두서없는 메모·날것 JSON·복붙 초안 수준이거나, 핵심 수치·근거가 빠졌으면 반드시 revise로 돌려보내세요. feedback에 무엇을 어떻게 보완할지 구체적으로 지시하세요.
- escalate: 이 팀원과 무료 도구로는 불가능할 때(실제 웹 조사, 로그인, 현실 행동 필요 등). feedback에 무엇이 필요한지.
- 계획·목차·"정보를 주세요"·"~하겠습니다"만 있는 결과는 accept 금지.
- 근거 없는 수치를 사실처럼 쓴 경우, 브리핑의 금지 사항을 어긴 경우 accept 금지.
- **임원 보고 재가공 의무(accept 시 필수)**:
  1) executiveSummary: 대표님이 10초 안에 핵심 결론·주요 수치·주의점을 파악할 수 있는 3~5문장 요약(단순 "사전 준비를 마치고 승인 요청합니다" 같은 형식적 문구 절대 금지).
  2) refinedReport: 팀원 원문을 그대로 복붙하지 말고, 대표님이 원문을 뒤지지 않아도 바로 판단할 수 있게 **## 핵심 결론 / ## 정리된 내용 / ## 리스크·확인 포인트 / ## 팀장 검토 의견** 구조의 양질의 한국어 마크다운 보고서로 재가공하세요. (쇼츠 대본이라면 장면별 자막·핵심 포인트·논조·사실/의견 구분을 사람이 읽기 좋게 정리)
  3) recommendedAction: 승인/조건부 승인/수정 요청 중 팀장 권고안과 근거 1~2문장.
- 판정 범위는 이 작업의 [요구사항]과 [완료 기준]뿐입니다. 프로젝트 전체 목표나 다른 작업의 일(예: 분석 작업에 코드 수정·PR·배포·색인 요청)을 이 결과물에 요구하지 마세요. 필요한 후속 일은 feedback에 "후속 작업 제안"으로만 적고 판정에는 반영하지 마세요.
- 팀원은 PR 생성·머지·배포·계정 로그인을 직접 할 수 없습니다(IT팀 코드 반영 절차와 외주가 담당). 그런 실행을 하지 않았다는 이유로 revise 금지.
${mission ? `\n${buildMissionBrief(mission)}` : ''}`;
  // 저장소 실제 확인: 검수자가 파일 존재 여부를 추측하지 않게 (없는 파일 판정 오류 방지)
  const snapshot = mission?.githubRepo ? await missionRepoSnapshot(mission, settings).catch(() => null) : null;
  let repoFacts = '';
  if (snapshot) {
    const mentioned = pathsIn(output).slice(0, 30);
    const exist = mentioned.filter((p) => snapshot.fileSet.has(p));
    const absent = mentioned.filter((p) => !snapshot.fileSet.has(p));
    const dirs = [...new Set(snapshot.files.map((f) => (f.includes('/') ? `${f.split('/')[0]}/` : f)))].slice(0, 40);
    repoFacts = [
      `[저장소 실제 확인 — ${snapshot.repo}@${snapshot.branch}, 파일 ${snapshot.files.length}개 · 서버가 직접 조회한 사실]`,
      `- 최상위 구조: ${dirs.join(', ')}`,
      mentioned.length ? `- 결과물에 나온 파일 중 실제로 있음: ${exist.join(', ') || '없음'}` : '',
      mentioned.length ? `- 결과물에 나온 파일 중 저장소에 없음: ${absent.join(', ') || '없음'}` : '',
      '- 파일이 있는지 없는지는 이 확인 결과만 따르세요. "실제로 있음"인 파일을 없다고 판정하거나, 위 구조에 없는 경로(예: src/app.js)를 요구하지 마세요.'
    ]
      .filter(Boolean)
      .join('\n');
  }
  const priorNotes = (Array.isArray(task.leadNotes) ? task.leadNotes.slice(0, 3) : []).filter((n) => !isFalseMissingClaim(n.text, snapshot?.fileSet));
  const prompt = `[업무] ${task.title}
[CEO 결재 상신 여부] ${task.requiresApproval ? '예 — 통과 시 대표님 결재함에 바로 올라갑니다. executiveSummary·refinedReport·recommendedAction을 대표님 보고 품질로 반드시 작성하세요.' : '아니오 — 통과 시 완료 보고로 기록됩니다. executiveSummary와 refinedReport로 핵심을 깔끔히 정리하세요.'}
[요구사항] ${baseTaskDescription(task).slice(0, 1500)}
[완료 기준]
${acceptance.map((x, i) => `${i + 1}. ${x}`).join('\n')}
${
  priorNotes.length
    ? `\n[이전에 준 팀장 피드백 — 반영됐는지 확인, 같은 문제가 남아 있으면 accept 금지]\n${priorNotes.map((n) => `- ${String(n.text).slice(0, 400)}`).join('\n')}\n`
    : ''
}
${repoFacts ? `\n${repoFacts}\n` : ''}
[팀원 결과물]
${String(output || '').slice(0, 8000)}`;
  try {
    const { object, label } = await generateObjectChain(chain, {
      schema: LeadReviewSchema,
      system,
      prompt,
      leadDesk: { key: `review:${task.id}:${Number(task.reviewRounds || 0)}:${textHash(output)}`, purpose: 'review', refs: { taskId: task.id, missionId: mission?.id || '' } }
    });
    const rawMissing = (object.missing || []).map((x) => String(x).slice(0, 200)).slice(0, 6);
    // 저장소에 실제로 있는 파일을 "없다"고 한 지적은 버림 (검수 AI의 추측)
    const missing = rawMissing.filter((x) => !isFalseMissingClaim(x, snapshot?.fileSet));
    const dropped = rawMissing.length - missing.length;
    let verdict = object.verdict;
    let feedback = String(object.feedback || '').slice(0, 1200);
    if (dropped && verdict === 'revise' && !missing.length) verdict = 'accept';
    if (dropped) feedback = `${feedback}\n(서버 확인: 검수 의견 중 "없는 파일" ${dropped}건은 실제로 저장소에 있는 파일이라 제외함)`.trim();
    return {
      verdict,
      score: Math.max(0, Math.min(10, Number(object.score) || 0)),
      missing,
      feedback,
      executiveSummary: String(object.executiveSummary || '').trim().slice(0, 1200),
      refinedReport: String(object.refinedReport || '').trim().slice(0, 8000),
      recommendedAction: String(object.recommendedAction || '').trim().slice(0, 600),
      reviewer: label,
      acceptance,
      corrected: dropped || 0,
      existingFiles: snapshot ? pathsIn(`${output}\n${rawMissing.join('\n')}\n${object.feedback || ''}`).filter((p) => snapshot.fileSet.has(p)) : []
    };
  } catch (err) {
    if (isLeadPending(err)) return { verdict: 'pending', pendingJobId: err.jobId, reason: err.message, acceptance };
    return { verdict: 'accept', skipped: true, reason: String(err?.message || err).slice(0, 200), acceptance };
  }
}

/** 같은 결과물인지 구분하는 짧은 해시 (팀장 업무함 키) */
function textHash(text = '') {
  let h = 5381;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ======================================================================
// 운영 사이클 v3: 작전 계획(마일스톤) 수립과 마일스톤별 작업 계획
// ======================================================================
const MissionPlanSchema = z.object({
  stage: z.string().describe('지금 단계 이름 (예: 수익 모델 검증)'),
  milestones: z
    .array(
      z.object({
        title: z.string().describe('마일스톤 이름 (결과 중심, 예: 미니앱 아이디어 2개 확정)'),
        doneWhen: z.string().describe('완료 판정 기준 (검증 가능한 결과물·숫자)'),
        gate: z.boolean().describe('대표님 결정이 꼭 필요한 관문이면 true (방향 선택·비용·외부 계정·출시·발송). 팀이 스스로 할 수 있으면 false'),
        decision: z.string().describe('gate=true일 때 대표님이 결정할 것 한 줄, 아니면 빈 문자열')
      })
    )
    .min(2)
    .max(6)
});

/** 목표·업무 범위·지금까지 결과를 보고 작전 계획(마일스톤 2~6개)을 세움 */
export async function draftMissionPlan({ mission, digest, agents, settings }) {
  const leadAgent = agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon')) || agents[0];
  const chain = buildLeadModelChain(leadAgent, settings, agents);
  if (!chain.length && !hasLeadDeskWorker()) throw new Error('사용 가능한 AI 엔진 없음');
  const system = `당신은 총괄 팀장(${leadAgent.name})입니다. 이 프로젝트의 목표까지 가는 "작전 계획"을 세우세요.
- 마일스톤은 결과 중심으로 2~6개, 순서대로. 각 마일스톤은 팀이 1~2주 안에 끝낼 수 있는 크기.
- doneWhen은 검증 가능한 결과(결과물·숫자·대표님 결정)로. "보고서 작성" 같은 활동은 기준이 될 수 없음.
- 대표님 결정이 꼭 필요한 지점(방향 선택, 비용, 외부 계정 가입, 출시·발송)만 gate=true. 나머지는 팀장 전결로 진행.
- 업무 브리핑의 "절대 하지 말 것"을 어기는 마일스톤은 만들지 마세요.
${companyContextFor(mission?.id, { compact: true })}`;
  const { object, label } = await generateObjectChain(chain, {
    schema: MissionPlanSchema,
    system,
    prompt: `${digest}\n\n${buildComplianceChecklist(mission)}`,
    leadDesk: mission?.id ? { key: `plan:${mission.id}:${mission.plan?.createdAt || 'new'}:${mission.plan?.needsReplan ? 'replan' : 'first'}`, purpose: 'plan', refs: { missionId: mission.id } } : null
  });
  return {
    stage: String(object.stage || '').slice(0, 80),
    milestones: object.milestones.map((m, i) => ({
      id: `ms${Date.now().toString(36)}${i}`,
      title: String(m.title || '').slice(0, 120),
      doneWhen: String(m.doneWhen || '').slice(0, 300),
      gate: Boolean(m.gate),
      decision: String(m.decision || '').slice(0, 200),
      status: 'todo',
      rounds: 0
    })),
    planner: label
  };
}

const MilestoneWorkSchema = z.object({
  milestoneDone: z.boolean().describe('지금까지의 결과물로 이 마일스톤의 완료 기준(doneWhen)을 충족했으면 true'),
  report: z.string().describe('대표님께 드리는 2~3문장 진행 보고 (확인된 사실만)'),
  synthesis: z
    .string()
    .optional()
    .describe('팀장 취합본(마크다운): 지금까지 팀원 결과물을 하나로 정리. 중복 제거, 의견이 다르면 나란히, 담당·출처 유지, 확인된 사실과 추정 구분, 마지막에 다음 결정·할 일. 새로 취합할 결과물이 없으면 빈 문자열'),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().describe('무엇을 어떤 형태로 만들지 구체적으로'),
        acceptance: z.array(z.string()).min(1).max(5).describe('이 작업의 완료 기준 (검증 가능하게)'),
        assigneeId: z.string().describe('조직도의 id'),
        isCodeChange: z.boolean(),
        codeSize: z.enum(['small', 'large']).optional().describe('코드 작업일 때: small=파일 1~2개·할 일이 분명, large=여러 파일·테스트 필요'),
        risky: z.boolean().optional().describe('코드 작업일 때: 구조 변경·데이터·보안·돈이 걸리면 true')
      })
    )
    .max(6)
    .describe('milestoneDone=false일 때 완료 기준까지 남은 차이를 메울 작업. 이미 한 일 반복 금지')
});

/** 현재 마일스톤: 완료 판정 + 남은 차이를 메울 작업 계획 (팀원 역량에 맞게 배정) */
export async function planMilestoneWork({ mission, milestone, digest, agents, settings, teamLoad = '', deliverablesText = '', extraNote = '', keySuffix = '', refsExtra = {} }) {
  const leadAgent = agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon')) || agents[0];
  const chain = buildLeadModelChain(leadAgent, settings, agents);
  if (!chain.length && !hasLeadDeskWorker()) throw new Error('사용 가능한 AI 엔진 없음');
  const system = `당신은 지휘자(Orchestrator)인 총괄 팀장(${leadAgent.name})입니다. 지금 마일스톤을 끝내기 위해 팀을 움직이세요.
- 먼저 지금까지의 결과물이 마일스톤 완료 기준을 충족하는지 판정하세요(milestoneDone).
- 아직이면, 완료 기준까지 남은 차이를 메울 작업을 최대 6개. 각 작업마다 검증 가능한 완료 기준(acceptance)을 쓰세요.
- 팀원 역량에 맞게, 대기 중인 팀원부터 서로 다른 팀원에게 나눠 배정하세요. 접속 중인 봇 팀원은 일을 많이 해도 되니 놀지 않게 각자 맞는 일을 주세요. 실제 웹 조사는 웹 조사가 되는 팀원에게.
- 이미 끝난 일을 반복하지 마세요. 업무 브리핑의 "절대 하지 말 것"을 지키세요.

[조직도]
${teamLoad}
${companyContextFor(mission?.id, { compact: true })}`;
  const prompt = `[현재 마일스톤] ${milestone.title}
[완료 기준] ${milestone.doneWhen}
[지금까지 결과물]
${deliverablesText || '(아직 없음)'}

${digest}

${buildComplianceChecklist(mission)}${extraNote ? `\n\n${extraNote}` : ''}`;
  const { object, label } = await generateObjectChain(chain, {
    schema: MilestoneWorkSchema,
    system,
    prompt,
    leadDesk: { key: `ms:${mission.id}:${milestone.id}:${Number(milestone.rounds || 0)}:${textHash(deliverablesText)}${keySuffix ? `:${keySuffix}` : ''}`, purpose: 'milestone', refs: { missionId: mission.id, ...refsExtra } }
  });
  const validIds = new Set(agents.filter((a) => a.active && a.tier !== 'lead').map((a) => a.id));
  const fallbackWorker = pickFallbackWorker(agents);
  return {
    milestoneDone: Boolean(object.milestoneDone),
    report: String(object.report || '').slice(0, 800),
    synthesis: String(object.synthesis || '').slice(0, 12000),
    tasks: (object.tasks || [])
      .filter((t) => t?.title && t?.description)
      .map((t) => ({ ...t, acceptance: (t.acceptance || []).map((x) => String(x).slice(0, 200)), assigneeId: validIds.has(t.assigneeId) ? t.assigneeId : fallbackWorker.id })),
    planner: label
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
    { id: 'agent_deepseek', re: /@?네모트론|nemotron|딥시크|deepseek/ },
    { id: 'agent_gemma', re: /@?젬마|gemma/ },
    { id: 'agent_qwen', re: /@?큐원|qwen/ },
    { id: 'agent_groq', re: /@?라마|llama|그록|groq|gpt-oss/ },
    { id: 'agent_gemini_neon', re: /@?제미나이|gemini|하이드로젠|hydrogen|네온|neon/ },
    { id: 'agent_instinct', re: /@?인스팅스|인스팅트|instinct/ },
    { id: 'agent_it_dev', re: /@?it\s*개발|@?it팀|it개발/ },
    { id: 'agent_it_sec', re: /@?it\s*보안|@?it팀|it보안/ },
    { id: 'agent_it_qa', re: /@?it\s*qa|@?it팀|itqa/ }
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
      agents.find((a) => a.id === mission?.leadAgentId) ||
      agents.find((a) => a.tier === 'lead') ||
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
      return `[수신함 전달됨] 부이(vooy) HTTPS 수신함에 대표님 메시지를 등록했습니다${taskRef}. 부이가 다음 확인 때 가져가 이곳 회의실로 결과를 보고합니다.`;
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
/**
 * Meeting-room command intake: decide whether the CEO's chat line is an actual work order,
 * and if so turn it into concrete tasks (or a re-open of a rejected task).
 */
const ChatDirectiveSchema = z.object({
  kind: z.enum(['directive', 'question', 'chat']).describe('실제로 무언가를 하라는 지시면 directive, 질문이면 question, 잡담·의견이면 chat'),
  reopenRejected: z.boolean().describe('"반려했던 거 다시 진행"처럼 최근 반려 건을 다시 하라는 뜻이면 true'),
  tasks: z
    .array(
      z.object({
        title: z.string().describe('짧은 업무 제목'),
        description: z.string().describe('담당자가 바로 실행할 수 있는 구체적 지시 (CEO 원문의 수치·문구는 그대로 유지)'),
        assigneeId: z.string().describe('조직원 id'),
        isCodeChange: z.boolean().describe('사이트·앱 코드/문구/화면 수정이면 true')
      })
    )
    .max(3)
});

const STATUS_QUESTION_RE = /(진행\s*상황|현황|알려\s*줘|공유해\s*줘|어때|뭐야|왜\s)/;
const DIRECTIVE_HINT_RE = /(해줘|해주세요|해라|하자|해봐|진행해|진행하자|진행시켜|넣어|넣는|추가|수정|바꿔|변경|만들어|삭제|제거|빼|확인해|고쳐|반영|적용|올려|다시|착수|시작해|정리해|알아봐|조사해|진행해야지|해야지)/;

export async function classifyChatDirective({ text, mission, tasks = [], agents, settings, rejectedTitles = [], repoLinked = false, planningRoster = '', assignmentRules = '' }) {
  const active = agents.filter((a) => a.active);
  const assignable = active.filter((a) => a.tier !== 'lead');
  const fallbackWorker = pickFallbackWorker(agents);
  const roster = assignable
    .filter((a) => ['exaone', 'gemini', 'groq', 'openrouter'].includes(a.provider))
    .map((a) => `- ${a.id}: ${a.name} (${a.team === 'it' ? 'IT유지보수팀' : '전략실행본부'} · ${a.roleTitle})`)
    .join('\n');
  const lead = active.find((a) => a.tier === 'lead') || null;
  const candidates = [
    lead ? resolveLanguageModel(lead, settings) : null,
    ...['agent_it_dev', 'agent_qwen', 'agent_groq', 'agent_exaone', 'agent_gemma'].map((id) => {
      const ag = active.find((a) => a.id === id);
      return ag ? resolveLanguageModel(ag, settings) : null;
    }),
    active.some((a) => ['gemini', 'groq', 'openrouter', 'exaone'].includes(a.provider)) ? resolveLiveBackendModel(settings) : null
  ].filter(Boolean);

  const system = `당신은 AI 조직의 총괄 팀장입니다. 회의실에서 CEO가 한 말이 실제 업무 지시인지 판단하고, 지시라면 1~3개의 구체적 업무로 바꾸세요.
규칙:
- 단순 질문·의견·칭찬은 directive가 아닙니다. tasks는 빈 배열.
- 최근 대화에서 이미 등록된 업무와 같은 내용이면 중복 업무를 만들지 마세요.
- 사이트·앱 코드/문구/화면 수정은 isCodeChange=true 이고 IT유지보수팀(agent_it_dev)에 배정하세요.
- 외부 계정(애드센스·GA4·서치콘솔 등) 확인은 팀이 직접 조회할 수 없으므로 "확인 방법 가이드와 후속 작업 준비"로 업무를 만드세요.
- assigneeId는 아래 목록의 id만 사용하세요.
[조직원]
${planningRoster || roster}
${assignmentRules ? `\n${assignmentRules}` : ''}`;
  const prompt = `[채널] ${mission ? `${mission.title}${repoLinked ? ' (GitHub 저장소 연동됨 — 코드 수정 가능)' : ''}` : '전체 채널(특정 프로젝트 없음)'}
[현재 업무]\n${
    tasks
      .slice(0, 12)
      .map((t) => `- [${t.status}] ${t.title}`)
      .join('\n') || '(없음)'
  }
[최근 반려 건]\n${rejectedTitles.join('\n') || '(없음)'}

[CEO 발언]\n${text}`;

  for (const m of candidates) {
    try {
      const { object } = await generateObject({ model: m.model, schema: ChatDirectiveSchema, system, prompt, maxRetries: 0 });
      const validIds = new Set(assignable.map((a) => a.id));
      object.tasks = (object.tasks || []).map((t) => ({
        ...t,
        assigneeId: validIds.has(t.assigneeId) ? t.assigneeId : t.isCodeChange && validIds.has('agent_it_dev') ? 'agent_it_dev' : fallbackWorker.id
      }));
      return { ...object, usedModel: m.label || '' };
    } catch {
      // try next model
    }
  }

  // No AI available: conservative keyword fallback so a clear order is never silently dropped
  const looksDirective = DIRECTIVE_HINT_RE.test(text) && !STATUS_QUESTION_RE.test(text) && !/[?？]\s*$/.test(text.trim());
  if (!looksDirective) return { kind: 'chat', reopenRejected: false, tasks: [], usedModel: 'fallback' };
  const reopen = /반려.*(다시|재진행|진행)/.test(text);
  const isCode = repoLinked && /(사이트|페이지|하단|푸터|문구|버튼|메뉴|화면|코드|디자인|copyright|저작권|배너|광고 ?위치)/i.test(text);
  return {
    kind: 'directive',
    reopenRejected: reopen,
    tasks: reopen
      ? []
      : [
          {
            title: text.replace(/\s+/g, ' ').slice(0, 40),
            description: text,
            assigneeId: isCode && active.some((a) => a.id === 'agent_it_dev') ? 'agent_it_dev' : fallbackWorker.id,
            isCodeChange: isCode
          }
        ],
    usedModel: 'fallback'
  };
}

export async function generateTeamChatReplies({ userMessage, mission, tasks, agents, recentMessages, settings, actionNote = '' }) {
  const responders = pickResponders(userMessage, agents, mission, tasks);
  const ceoName = settings?.ceoName || '대표님';
  const replies = [];
  const hasExplicitMention = /@(?:엑사원|피클|알렉스|뮤즈|큐|큐이|부이|네모트론|nemotron|젬마|gemma|딥시크|deepseek|큐원|qwen|라마|llama|그록|groq|제미나이|네온|하이드로젠|인스팅스|전체)/i.test(userMessage);

  for (const ag of responders) {
    const agTasks = tasks.filter((t) => t.assigneeId === ag.id);
    // 비상 API 팀장(tier=lead)이 휴직(active=false)이면 API 호출을 하지 않고 팀장 업무함 대기 안내로만 응답
    const resolved =
      ag.tier === 'lead' && !ag.active
        ? null
        : resolveLanguageModel(ag, settings) ||
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
      const chatCtx = companyContextFor(mission?.id, { compact: true });
      const system = `당신은 "${settings?.companyName || 'CEO Office'}"의 ${ag.tier === 'lead' ? '총괄 팀장' : 'AI 실무 에이전트'} "${ag.name}" (${ag.roleTitle})입니다.
${ceoName}의 지시나 질문에 팀 대표로 핵심만 간결하고 정확하게 한국어로 답하세요 (2~4문장).
다른 외부 봇(피클, Cue, Muse)이 해야 할 전화 예약·결제 등을 "이미 전화했다/완료했다"고 거짓말하지 말고, 현재 실제 진행 상태와 다음 조치만 사실대로 보고하세요.
${
  actionNote
    ? `[시스템이 실제로 수행한 조치] ${actionNote}
이 조치만 "등록했다/시작했다"고 말할 수 있습니다. 완료되지 않은 일을 완료했다고 하지 마세요.`
    : `이번 발언으로 등록된 실제 업무는 없습니다. "즉시 반영하겠습니다/전달하겠습니다/보고드리겠습니다" 같은 약속을 하지 말고, 질문에는 아는 사실만 답하세요.`
}${ag.tier === 'lead' ? `
총괄 팀장으로서 막힌 일이 있으면 원인과 대표님이 해 주셔야 할 일(권한·키·결정)을 구체적으로 요청하세요.` : ''}${chatCtx ? `\n\n${chatCtx}` : ''}`;

      try {
        const { text } = await generateText({
          model: resolved.model,
          system,
          prompt: `현재 채널 업무: ${mission?.title || '전체 자유 대화'}\n현재 업무 목록:\n${taskContext}\n\n[최근 대화]\n${threadContext || '(없음)'}\n\n${ceoName}: ${userMessage}\n\n${ag.name}의 실제 응답:`
        });
        replyText = text.trim();
        live = true;
        statusText = ag.tier === 'lead' ? '비상 즉답 (Gemini API)' : '실시간 AI 응답';
      } catch (err) {
        replyText = `[AI 응답 오류] ${err.message.slice(0, 120)}`;
        statusText = 'API 오류';
      }
    } else if (ag.tier === 'lead') {
      replyText = actionNote
        ? `접수했습니다. ${actionNote} (세부 검수·계획은 팀장 업무함에서 주간 AGY Hydrogen · 야간 Gemini 앱이 이어서 처리합니다.)`
        : '말씀을 기록했습니다. 백그라운드 팀장 판단(검수·작전 계획·마일스톤)은 팀장 업무함(주간 AGY Hydrogen · 야간 Gemini 앱)이 처리합니다.';
      statusText = '팀장 업무함 접수';
    } else {
      replyText = buildHonestDispatchNotice(ag, userMessage, agTasks);
      statusText = '수신함 대기';
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
      } else if (ag.provider === 'pickle' || ag.provider === 'manus' || ag.provider === 'muse' || ag.provider === 'vooy') {
        text = `[수신함/MCP 대기] "${t.title}" — ${ag.name}가 수신함에서 가져가 처리 대기 중입니다.`;
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


// ================================================================
// 팀장 능동 추진: 미션의 작업이 모두 끝난 뒤, 대표님이 물어보기 전에 팀장이 스스로 다음 행동을 정합니다.
//  - 목표 달성 → 종료 보고
//  - 자체 처리 가능한 후속 작업 → 팀장 전결로 배정·자동 실행
//  - 대표님만 할 수 있는 일(권한·키·결정·외부 계정 작업) → 구체적으로 요청
// ================================================================
// ================================================================
// 교차 검수(리뷰 루프): 초안을 다른 무료 모델이 스킬 점검표로 채점하고, 기준 미달이면 지적사항을 반영해 다시 씁니다.
// 한 모델의 맹점을 다른 모델이 잡아 주는 방식이라 단일 무료 모델보다 품질이 크게 올라갑니다.
// Gemini 무료 한도(하루 수십 회)는 팀장용으로 아끼려고 검수는 Groq → OpenRouter → Gemini 순으로 고릅니다.
// ================================================================
const ReviewSchema = z.object({
  score: z.number().describe('0~10점. 점검표를 모두 통과하고 바로 쓸 수 있으면 9~10, 고칠 게 있으면 7 이하'),
  verdict: z.string().describe('한 줄 총평'),
  issues: z
    .array(z.object({ problem: z.string(), fix: z.string() }))
    .max(8)
    .describe('구체적인 문제와 고치는 방법. 사실 오류·빠진 요구사항·점검표 위반 위주')
});

function providerOfLabel(label = '') {
  const m = String(label).match(/^(gemini|groq|openrouter|exaone|litellm|claude)/i);
  return m ? m[1].toLowerCase() : '';
}

function reviewerCandidates(settings, authorLabel = '') {
  const p = settings?.providers || {};
  const author = providerOfLabel(authorLabel);
  const list = [];
  if (p.groq?.apiKey) {
    const client = createOpenAI({
      baseURL: p.groq.baseUrl || 'https://api.groq.com/openai/v1',
      apiKey: p.groq.apiKey.trim(),
      compatibility: 'compatible',
      fetch: createOpenAiModelFallbackFetch(['openai/gpt-oss-20b'])
    });
    list.push({ provider: 'groq', model: client('openai/gpt-oss-120b'), label: 'groq:openai/gpt-oss-120b', compact: true });
  }
  if (p.openrouter?.apiKey) {
    const client = createOpenAI({
      baseURL: p.openrouter.baseUrl || 'https://openrouter.ai/api/v1',
      apiKey: p.openrouter.apiKey.trim(),
      compatibility: 'compatible',
      headers: { 'HTTP-Referer': 'https://ai-ceo-hub.onrender.com', 'X-Title': 'CEO Office' },
      fetch: createOpenAiModelFallbackFetch(['openrouter/free'])
    });
    const name = p.openrouter.model || 'openrouter/free';
    list.push({ provider: 'openrouter', model: client(name), label: `openrouter:${name}` });
  }
  if (p.gemini?.apiKey) {
    const g = resolveLiveBackendModel({ providers: { gemini: p.gemini } });
    if (g) list.push({ provider: 'gemini', model: g.model, label: g.label });
  }
  const usable = list.filter((c) => !isProviderCooling(c.provider));
  const others = usable.filter((c) => c.provider !== author);
  return others.length ? others : usable;
}

async function generateReview(model, opts) {
  let lastErr = null;
  for (const mode of ['auto', 'json']) {
    try {
      const { object } = await generateObject({
        model,
        schema: ReviewSchema,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(90000),
        ...(mode === 'json' ? { mode: 'json' } : {}),
        ...opts
      });
      return object;
    } catch (err) {
      lastErr = err;
      if (/quota|rate limit|429|401|403|api key|too large|tokens per/i.test(String(err?.message || err))) throw err;
    }
  }
  throw lastErr || new Error('review failed');
}

/**
 * 품질 게이트: (1) 기계적 사실 확인 결과(forcedIssues)는 반드시 고치고, (2) 중요 작업은 다른 모델이 점검표로 채점해
 * 기준 미달이면 고쳐 씁니다. 고친 뒤에도 사실 오류가 남으면 결과물 맨 위에 경고를 붙여 숨기지 않습니다.
 * Never throws. Returns { output, quality }
 */
export async function refineDraft({
  draft,
  authorLabel = '',
  system = '',
  taskPrompt = '',
  skills = [],
  task = null,
  agent = null,
  settings = null,
  references = '',
  forcedIssues = [],
  recheck = null
}) {
  const quality = {
    skills: skills.map((s) => s.id),
    reviewed: false,
    score: null,
    revised: false,
    reviewer: '',
    issues: [],
    factIssues: forcedIssues.map((i) => i.detail || String(i)),
    factIssuesAfter: []
  };
  const mustFix = quality.factIssues.length > 0;
  const wantReview = shouldReview({ skills, task, agent, settings });
  if (!draft || draft.length < 40 || (!mustFix && !wantReview)) return { output: draft, quality };
  const cfg = getSkillSettings(settings);
  const minScore = Math.max(1, Math.min(10, Number(cfg.minScore) || 8));
  const rubric = buildReviewRubric(skills);
  const warn = (issues) =>
    issues.length
      ? `> ⚠️ 자동 사실 확인 경고 — 아래 항목은 저장소·도구로 확인되지 않았습니다. 그대로 믿거나 실행하지 마세요.\n${issues.map((x, i) => `> ${i + 1}. ${x}`).join('\n')}\n\n`
      : '';

  const candidates = reviewerCandidates(settings, authorLabel).slice(0, 3);
  if (!candidates.length) quality.reviewError = '사용 가능한 검수 모델 없음(한도 소진/키 없음)';
  for (const rv of candidates) {
    let reviewIssues = [];
    if (wantReview) {
      try {
        const review = await generateReview(rv.model, {
          system: `당신은 까다로운 수석 검수자입니다. 동료 AI의 결과물을 아래 점검표로 채점하세요.
- 점수는 버트지 말고 엄격하게: 점검표를 모두 통과하고 대표님이 바로 쓸 수 있을 때만 9점 이상.
- 작업 지시와 제공 자료(특히 [실제 코드 근거])에 없는 사실·수치·파일·기능·클래스를 지어냈으면 반드시 지적하세요.
- issues에는 "무엇이 문제이고 어떻게 고치는지"를 구체적으로 쓰세요. 취향 문제는 쓰지 마세요.
- [참고 자료: 회사 기억·전역 지침]에 있는 내용은 확인된 사실입니다. 그 내용을 근거로 쓴 문장은 감점하지 말고, 오히려 그것과 충돌하는 내용을 지적하세요.

[점검표]
${rubric}${references ? `\n\n[참고 자료: 회사 기억·전역 지침]\n${String(references).slice(0, 1400)}` : ''}`,
          prompt: `[작업 지시와 자료]\n${String(taskPrompt).slice(0, rv.compact ? 3500 : 6000)}\n\n[검수할 결과물]\n${draft.slice(0, rv.compact ? 5000 : 9000)}`
        });
        quality.reviewed = true;
        quality.reviewer = rv.label;
        quality.score = Number(review.score);
        reviewIssues = (review.issues || []).slice(0, 8).map((i) => `${i.problem} → ${i.fix}`);
        quality.issues = reviewIssues;
      } catch (err) {
        quality.reviewError = `${rv.label}: ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 160)}`;
        if (!mustFix) continue; // try the next reviewer
      }
    }
    const needRevision = mustFix || (quality.score !== null && quality.score < minScore && reviewIssues.length);
    if (!needRevision) return { output: draft, quality };

    const allIssues = [...quality.factIssues.map((x) => `[사실 오류 — 반드시 수정] ${x}`), ...reviewIssues];
    try {
      const { text } = await generateText({
        model: rv.model,
        system: `${system}\n\n[수정 지시] 아래 초안을 지적사항을 모두 반영해 고친 "최종본 전체"를 다시 쓰세요. 초안의 맞는 내용은 유지하고, 확인할 수 없는 내용은 삭제하거나 "미확인"으로 바꾸세요. 지적사항·수정 내역·사과는 출력하지 마세요.`,
        prompt: `${String(taskPrompt).slice(0, rv.compact ? 3000 : 5000)}\n\n[초안]\n${draft.slice(0, rv.compact ? 5000 : 9000)}\n\n[지적사항${quality.score !== null ? ` (${quality.score}점)` : ''}]\n${allIssues.map((x, i) => `${i + 1}. ${x}`).join('\n')}`,
        maxTokens: 3000,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(120000)
      });
      const revised = String(text || '').trim();
      if (revised.length > Math.min(200, draft.length * 0.4)) {
        quality.revised = true;
        quality.reviewer = quality.reviewer || rv.label;
        const remaining = typeof recheck === 'function' ? recheck(revised) : [];
        quality.factIssuesAfter = remaining.map((i) => i.detail || String(i));
        return { output: warn(quality.factIssuesAfter) + revised, quality };
      }
    } catch (err) {
      quality.reviewError = `${rv.label}(수정): ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 160)}`;
      if (mustFix) continue;
    }
    return { output: warn(quality.factIssues) + draft, quality };
  }
  quality.factIssuesAfter = quality.factIssues;
  return { output: warn(quality.factIssues) + draft, quality };
}

const LeadFollowUpSchema = z.object({
  goalStatus: z.enum(['done', 'continue', 'blocked']).describe('원래 지시가 끝났으면 done, 팀이 더 할 일이 있으면 continue, 대표님 조치 없이는 진행 불가면 blocked'),
  report: z.string().describe('대표님께 드리는 2~4문장 보고. 실제 확인된 사실만.'),
  nextTasks: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        assigneeId: z.string().describe('아래 조직원 목록의 id'),
        isCodeChange: z.boolean().describe('연동 저장소 코드·문구·SEO 파일을 실제로 고쳐야 하는 일이면 true')
      })
    )
    .max(4),
  ceoRequests: z.array(z.string()).max(4).describe('대표님만 할 수 있는 일(권한·API 키·결정·외부 계정 작업)을 구체적으로')
});

export async function planLeadFollowUp({ mission, digest, agents, settings, teamLoad = '' }) {
  const leadAgent = agents.find((a) => a.id === (mission?.leadAgentId || 'agent_gemini_neon')) || agents[0];
  const resolved = resolveLanguageModel(leadAgent, settings) || resolveLiveBackendModel(settings);
  if (!resolved) return null;
  const roster =
    (typeof teamLoad === 'string' && teamLoad) ||
    agents
      .filter((a) => a.active && ['exaone', 'gemini', 'groq', 'openrouter'].includes(a.provider))
      .map((a) => `- id: "${a.id}", ${a.name} (${a.roleTitle})`)
      .join('\n');
  const system = withCompanyContext(
    `당신은 총괄 팀장(${leadAgent.name})입니다. 팀원들의 작업이 모두 끝난 상태입니다. 대표님이 물어보기 전에 다음 행동을 스스로 정하세요.
규칙:
- [목표] 블록의 숫자 목표를 달성했을 때만 goalStatus=done. 작업이 다 끝났어도 목표 지표가 안 움직였으면 done이 아닙니다.
- 다음 작업은 목표까지 남은 차이를 가장 크게 줄일 병목을 겨냥하세요. 각 작업 description에 "어떤 지표를 얼마나 움직이려는지"를 한 줄 넣으세요.
- 당신은 지휘자(Orchestrator)입니다. 직접 일하거나 외부 AI에 넘기기보다 내부 팀원에게 역할에 맞게 나눠 맡기세요. "대기 중(우선 배정)"인 팀원부터, 서로 다른 팀원에게 병렬로 배정하세요.
- 팀이 직접 끝낼 수 있는 구체적 후속 작업만 nextTasks에 넣으세요(최대 4개). 이미 한 일을 반복하거나 막연한 리서치·보고서만 늘리는 작업은 금지. 각 작업 description에 완료 기준(무엇이 나오면 끝인지)을 쓰세요.
- 연결 저장소가 없으면 PR·배포 작업 대신 파일 내용·문서 같은 결과물을 만들게 하고, 저장소 연결은 ceoRequests에 쓰세요.
- 결제·광고비·외부 발송·외부 계정(애드센스·GA4·서치콘솔 등) 조작은 nextTasks가 아니라 ceoRequests에 구체적 절차로 쓰세요.
- 권한·키 부족 등으로 막혔으면 goalStatus=blocked로 하고 필요한 조치를 ceoRequests에 쓰세요.
- report에는 확인된 사실만 쓰고 추측 수치를 실제값처럼 쓰지 마세요.

- 팀원 보고서의 주장과 [회사 기억]이 충돌하면 회사 기억을 따르세요.

[배정 가능한 내부 AI 조직원]
${roster}

${skillBlock({ agent: leadAgent, mission, purpose: 'lead_plan', settings, compact: true, max: 1 })}`,
    mission?.id,
    { compact: true }
  );
  const { object } = await generateObject({
    model: resolved.model,
    schema: LeadFollowUpSchema,
    system,
    prompt: `${digest}\n\n${buildComplianceChecklist(mission)}`,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(120000)
  });
  const validIds = new Set(agents.filter((a) => a.active && a.tier !== 'lead').map((a) => a.id));
  const fallbackWorker = pickFallbackWorker(agents);
  return {
    goalStatus: object.goalStatus,
    report: String(object.report || '').trim(),
    nextTasks: (object.nextTasks || [])
      .filter((t) => t?.title && t?.description)
      .map((t) => ({ ...t, assigneeId: validIds.has(t.assigneeId) ? t.assigneeId : fallbackWorker.id })),
    ceoRequests: (object.ceoRequests || []).map((s) => String(s).trim()).filter(Boolean),
    leadAgentId: leadAgent.id,
    usedModel: resolved.label || ''
  };
}
