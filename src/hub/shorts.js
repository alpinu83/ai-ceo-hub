// hub/shorts.js: 유튜브 쇼츠 자동 제작 연결 (뉴스 후보 → 대표님 선택 → 대본 결재 → 자동 제작기 → 비공개 업로드 보고)
// 영상 제작·업로드는 GitHub 저장소 alpinu83/shorts-factory(GitHub Actions)가 하고, 이 서버와는 전용 토큰(SHORTS_HOOK_TOKEN)으로만 주고받음.
import { appendLog, flushCloudBackup, loadDb, saveDb, uid } from '../store.js';
import { sendTelegramText } from '../telegram.js';
import { buildDispatchPrompt } from '../orchestrator.js';
import { getGithubRepoConfig } from '../it-devops.js';
import { autoStartLiveMissionTasks, leadSay } from './missions.js';
import { botConnected, isAgentExhausted } from '../lead-engine.js';
import { DEV_TEAM, dispatchDevTeamTask } from './dev-policy.js';

export const SHORTS_FACTORY_REPO = 'alpinu83/shorts-factory';
const MAX_CANDIDATES = 60;
const JOB_LEASE_MS = 60 * 60 * 1000;

export function shortsHookToken() {
  return String(process.env.SHORTS_HOOK_TOKEN || '').trim();
}

export function ensureShorts(db) {
  db.shorts = db.shorts && typeof db.shorts === 'object' ? db.shorts : {};
  db.shorts.candidates = Array.isArray(db.shorts.candidates) ? db.shorts.candidates : [];
  db.shorts.jobs = Array.isArray(db.shorts.jobs) ? db.shorts.jobs : [];
  const cutoff = Date.now() - 48 * 3600000;
  for (const c of db.shorts.candidates) {
    newsFirst(c);
    // 최근 1~2일 기사만 후보로 (지난 뉴스는 자동으로 빠짐)
    const at = Date.parse(c.publishedAt || '') || Date.parse(c.createdAt || '') || 0;
    if (c.status === 'new' && at && at < cutoff) c.status = 'expired';
  }
  return db.shorts;
}

const isYoutubeUrl = (u = '') => /(?:youtube\.com|youtu\.be)\//i.test(String(u));
/**
 * 다른 채널 영상은 쓰지 않음: 유튜브 인기 영상은 "화제도" 신호로만 남기고,
 * 후보의 제목·링크·출처는 같은 이슈를 다룬 언론 기사로 바꿈. 기사가 없으면 후보에서 뺌.
 */
export function newsFirst(c) {
  if (!c || c.newsFirst) return c;
  c.newsFirst = true;
  if (c.kind !== 'youtube' && !isYoutubeUrl(c.url)) return c;
  const article = (c.related || []).find((x) => x?.url && !isYoutubeUrl(x.url));
  c.signal = { youtubeViews: c.views || null, channel: c.source || '', videoTitle: c.title, videoUrl: c.url };
  if (!article) {
    if (c.status === 'new') c.status = 'dropped';
    c.dropReason = '같은 이슈를 다룬 언론 기사를 찾지 못함 (유튜브 영상만으로는 후보로 쓰지 않음)';
    return c;
  }
  c.title = clip(String(article.title || '').replace(/\s*-\s*[^-]{1,30}$/, ''), 160) || c.title;
  c.url = article.url;
  c.source = article.source || '언론 기사';
  c.related = (c.related || []).filter((x) => x !== article && !isYoutubeUrl(x?.url));
  return c;
}

/** 쇼츠 프로젝트: 설정에 지정된 것, 없으면 이름에 "쇼츠"가 들어간 진행 중 프로젝트 */
export function findShortsMission(db) {
  const id = db.settings?.shorts?.missionId;
  return (
    (id && db.missions.find((m) => m.id === id)) ||
    db.missions.find((m) => m.mode === 'project' && /쇼츠|shorts/i.test(m.title) && m.status !== 'completed') ||
    null
  );
}

const normTitle = (s = '') => String(s).replace(/\s*-\s*[^-]{1,30}$/, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase().slice(0, 60);
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 자동 제작기가 모아 온 뉴스 후보 저장 (같은 제목은 합치고 최신 60개만 유지) */
export function ingestCandidates(db, items = [], batchLabel = '') {
  const sh = ensureShorts(db);
  const now = new Date().toISOString();
  const added = [];
  for (const raw of Array.isArray(items) ? items.slice(0, 30) : []) {
    const title = clip(raw?.title, 160);
    if (!title) continue;
    const key = normTitle(title);
    const existing = [...added, ...sh.candidates].find((c) => normTitle(c.title) === key);
    if (existing) {
      existing.views = Math.max(Number(existing.views || 0), Number(raw.views || 0)) || existing.views;
      existing.seenAt = now;
      // 이번 수집에도 다시 올라온 기사: 지난번에 빠졌던 후보면 되살리고 최신 관심도로 갱신해 맨 위로
      if (['dropped', 'expired', 'superseded'].includes(existing.status) && raw.kind !== 'youtube') {
        Object.assign(existing, { status: 'new', url: clip(raw.url, 500) || existing.url, source: clip(raw.source, 80) || existing.source, coverage: Number(raw.coverage || 0) || existing.coverage, trends: raw.trends?.volume ? { query: clip(raw.trends.query, 60), volume: Number(raw.trends.volume) || 0 } : existing.trends, signal: raw.signal?.youtubeViews ? { youtubeViews: Number(raw.signal.youtubeViews) || 0 } : existing.signal, score: Number(raw.score || 0) || existing.score, publishedAt: clip(raw.publishedAt, 40) || existing.publishedAt, batch: clip(batchLabel, 40) });
        delete existing.dropReason;
      }
      if (existing.status === 'new' && !added.includes(existing)) added.push(existing);
      continue;
    }
    const cand = {
      id: uid('nc'),
      title,
      summary: clip(raw.summary, 300),
      url: clip(raw.url, 500),
      source: clip(raw.source, 80),
      kind: raw.kind === 'youtube' ? 'youtube' : 'news',
      views: Number(raw.views || 0) || null,
      coverage: Number(raw.coverage || 0) || null,
      related: (Array.isArray(raw.related) ? raw.related : []).slice(0, 5).map((r) => ({ title: clip(r?.title, 160), url: clip(r?.url, 500), source: clip(r?.source, 80) })),
      trends: raw.trends && raw.trends.volume ? { query: clip(raw.trends.query, 60), volume: Number(raw.trends.volume) || 0 } : null,
      signal: raw.signal && raw.signal.youtubeViews ? { youtubeViews: Number(raw.signal.youtubeViews) || 0 } : null,
      score: Number(raw.score || 0) || null,
      publishedAt: clip(raw.publishedAt, 40),
      batch: clip(batchLabel, 40),
      status: 'new',
      createdAt: now,
      seenAt: now
    };
    newsFirst(cand);
    if (cand.status === 'new') added.push(cand);
  }
  // 제작기가 보낸 순서(관심도 순)를 그대로 맨 위에, 이전 묶음의 고르지 않은 후보는 "지난 후보"로 내림
  if (added.length) {
    for (const c of sh.candidates) if (c.status === 'new' && !added.includes(c)) c.status = 'superseded';
  }
  added.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  sh.candidates = [...added, ...sh.candidates.filter((c) => !added.includes(c))].slice(0, MAX_CANDIDATES);
  sh.lastCollectedAt = now;
  return added;
}

const fmtViews = (v) => (v ? (v >= 10000 ? `${(v / 10000).toFixed(1)}만회` : `${v}회`) : '');

/** 텔레그램으로 후보 목록 + 선택 버튼 */
export async function notifyCandidates(db, cands = []) {
  const tg = db.settings?.telegram || {};
  if (!tg.botToken || !tg.chatId || !cands.length) return { ok: false };
  const top = cands.slice(0, 8);
  const lines = [
    `<b>쇼츠 후보: 최근 1~2일 국내 정치 기사 ${top.length}건</b> (관심도 순)`,
    '만들 이슈를 고르면 팀이 출처 확인된 대본을 써서 결재로 올립니다.',
    '',
    ...top.map((c, i) => `${i + 1}. ${esc(clip(c.title, 70))}${c.coverage ? ` · 보도 ${c.coverage}곳` : ''}${c.trends?.volume ? ` · 검색 ${fmtViews(c.trends.volume).replace('회', '')}+` : ''}${c.signal?.youtubeViews ? ` · 화제 👁 ${fmtViews(c.signal.youtubeViews)}` : ''}${c.source ? ` · ${esc(c.source)}` : ''}`)
  ];
  const keyboard = top.map((c, i) => [{ text: `🎬 ${i + 1}. ${clip(c.title, 28)}`, callback_data: `sh:pick:${c.id}` }]);
  try {
    await sendTelegramText(tg.botToken, tg.chatId, lines.join('\n'), { inline_keyboard: keyboard });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 대본 담당: 접속 중인 봇(Cue·피클·Muse) 중 할 일이 적은 쪽 → 한도 남은 API 팀원 → 개발팀 Aside */
function pickWriter(db) {
  const open = (id) => (db.tasks || []).filter((t) => t.assigneeId === id && !['completed', 'rejected'].includes(t.status)).length;
  const bots = ['agent_cue', 'agent_pickle', 'agent_muse'].filter((id) => botConnected(db, id, 6)).sort((a, b) => open(a) - open(b));
  if (bots.length) return db.agents.find((a) => a.id === bots[0]);
  const prefer = ['agent_gemma', 'agent_groq', 'agent_deepseek', 'agent_qwen'];
  for (const id of prefer) {
    const a = db.agents.find((x) => x.id === id && x.active);
    if (a && !isAgentExhausted(a, db.settings)) return a;
  }
  const api = db.agents.find((a) => a.active && ['groq', 'openrouter', 'gemini'].includes(a.provider) && !isAgentExhausted(a, db.settings));
  if (api) return api;
  return db.agents.find((a) => a.id === 'agent_aside' && a.active) || null;
}

export const SCRIPT_FORMAT = [
  '1. 먼저 대표님이 결재 본문에서 바로 읽을 수 있도록 한국어 마크다운으로 대본 본문을 작성하세요(영상 제목, 예상 낭독 시간, 장면 1~N 자막·내레이션, 출처 기사 URL, 해시태그).',
  '2. 그 다음 결과물 맨 끝에 아래 형식의 JSON 코드 블록(줄바꿈 포함)을 반드시 넣으세요(자동 제작기가 이 블록만 읽습니다).',
  '```json',
  '{"title":"영상 제목(40자 이내, #Shorts 제외)","scenes":[{"text":"화면 자막이자 내레이션 한두 문장(40자 안팎)","keywords":"배경 영상 검색용 영어 키워드 2~3개 (예: seoul city night, korean flag)"}],"sources":["확인한 기사 URL"],"hashtags":["#정치","#뉴스"]}',
  '```',
  '- scenes는 5~8개, 전체 낭독 30~50초. 첫 장면은 3초 안에 핵심을 던지는 문장.',
  '- 배경 키워드는 실존 인물 이름이 아닌 일반 장면으로, 한국 장면이 나오게 seoul·korea·korean을 붙여서(예: seoul skyline, korean flag, seoul street crowd, documents desk). "parliament"만 쓰면 외국 의사당이 나옴.',
  '- 사실 문장은 sources의 기사로 확인한 내용만, "보도에 따르면" 식으로. 해설·주장은 의견임이 드러나게.'
].join('\n');

/** 대표님이 후보를 고르면 대본 작업을 만들어 바로 실행 (결재 필요) */
export function pickCandidate(db, candId) {
  const sh = ensureShorts(db);
  const cand = sh.candidates.find((c) => c.id === candId);
  if (!cand) return { ok: false, error: '후보를 찾을 수 없습니다.' };
  if (cand.status === 'picked') return { ok: false, error: '이미 선택된 후보입니다.', taskId: cand.taskId };
  const mission = findShortsMission(db);
  if (!mission) return { ok: false, error: '"쇼츠" 프로젝트가 없습니다.' };
  const writer = pickWriter(db);
  if (!writer) return { ok: false, error: '대본을 쓸 AI 팀원이 없습니다.' };
  const now = new Date().toISOString();
  const srcLines = [cand.url ? `- ${cand.source || '출처'}: ${cand.url}` : '', ...cand.related.map((r) => `- ${r.source || '관련 기사'}: ${r.title} ${r.url}`)].filter(Boolean);
  const task = {
    id: uid('tsk'),
    missionId: mission.id,
    title: `쇼츠 대본: ${clip(cand.title, 60)}`,
    description: [
      `대표님이 고른 이슈로 구국열사 채널 쇼츠 대본(30~50초)을 쓰세요. 시각: 우파 성향의 차분하지만 단호한 분석형 해설.`,
      `이슈: ${cand.title}${cand.signal?.youtubeViews ? ` (유튜브 화제도: 관련 영상 조회 ${fmtViews(cand.signal.youtubeViews)})` : ''}${cand.summary ? `\n요약: ${cand.summary}` : ''}`,
      '※ 다른 유튜브 채널 영상의 화면·음성·자막·대사·구성은 절대 가져오지 마세요(저작권 신고 = 채널 경고). 화제도 참고만 하고, 사실은 아래 언론 기사로만 확인해 직접 쓰세요.',
      srcLines.length ? `참고 출처:\n${srcLines.join('\n')}` : '참고 출처: 없음 → 확인 가능한 기사만 쓰고 sources에 URL을 넣을 것',
      '',
      SCRIPT_FORMAT
    ].join('\n'),
    assigneeId: writer.id,
    status: writer.connectionMode === 'api' ? 'queued' : 'awaiting_bridge',
    requiresApproval: true,
    estimatedCostKRW: 0,
    acceptance: [
      '맨 끝에 title·scenes(5~8개)·sources·hashtags가 들어간 JSON 코드 블록이 있음',
      '사실 문장은 출처 기사로 확인된 내용만 쓰고, 의견·해설은 의견임이 드러남',
      '실존 인물 비방·모욕 표현, 확인 안 된 의혹 단정, 언론사 영상·사진 사용 계획이 없음'
    ],
    shorts: { candidateId: cand.id },
    createdAt: now,
    updatedAt: now
  };
  task.dispatchPrompt = buildDispatchPrompt(writer, task, mission);
  db.tasks.unshift(task);
  if (DEV_TEAM[writer.id]) dispatchDevTeamTask(db, task);
  cand.status = 'picked';
  cand.taskId = task.id;
  cand.pickedAt = now;
  // 대표님이 이미 뉴스 후보를 선택했으므로 "뉴스 후보 선정·선택" 마일스톤이 진행 중/관문이면 자동으로 완료 처리하고 다음(대본) 단계로 넘김
  const milestones = Array.isArray(mission.plan?.milestones) ? mission.plan.milestones : [];
  const pickMs = milestones.find((x) => ['doing', 'gate'].includes(x.status) && /(후보|뉴스.*선정|대표님.*선택)/.test(`${x.title || ''} ${x.doneWhen || ''}`));
  if (pickMs) {
    pickMs.status = 'done';
    pickMs.doneAt = now;
    pickMs.decisionNote = `쇼츠 이슈 선택 완료: ${clip(cand.title, 60)}`;
    for (const a of db.approvals || []) {
      if (a.kind === 'stage_gate' && a.missionId === mission.id && a.milestoneId === pickMs.id && a.status === 'pending') {
        a.status = 'approved';
        a.ceoNote = '대표님 쇼츠 뉴스 선택으로 자동 통과';
        a.decidedAt = now;
      }
    }
    const nextMs = milestones.find((x) => x.status === 'todo');
    if (nextMs) {
      nextMs.status = 'doing';
      task.milestoneId = nextMs.id;
    }
  }
  leadSay(db, mission, '쇼츠 이슈 선택', `대표님이 "${clip(cand.title, 60)}"을(를) 골랐습니다. ${writer.name}에게 대본을 맡겼고, 출처 확인 후 결재로 올리겠습니다.`);
  appendLog(db, 'CEO', `쇼츠 이슈 선택: "${clip(cand.title, 60)}" → 대본 작업(${writer.name})`, 'info');
  return { ok: true, task, mission, candidate: cand };
}

/** 대본 결과물에서 JSON 블록 읽기 (무료 모델의 흔한 실수: 코드 블록 누락·끝 쉼표 등은 너그럽게) */
export function parseShortsScript(output = '') {
  const text = String(output || '');
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const brace = text.lastIndexOf('{"title"');
  if (brace >= 0) blocks.push(text.slice(brace, text.lastIndexOf('}') + 1));
  for (const b of blocks.reverse()) {
    try {
      const obj = JSON.parse(b.replace(/,\s*([}\]])/g, '$1'));
      const scenes = (Array.isArray(obj.scenes) ? obj.scenes : [])
        .map((s) => ({ text: clip(s?.text, 120), keywords: clip(s?.keywords || 'city, crowd', 80) }))
        .filter((s) => s.text.length >= 4)
        .slice(0, 10);
      if (!obj.title || scenes.length < 3) continue;
      return {
        title: clip(obj.title, 90),
        scenes,
        sources: (Array.isArray(obj.sources) ? obj.sources : []).map((u) => clip(u, 400)).filter((u) => /^https?:\/\//.test(u)).slice(0, 6),
        hashtags: (Array.isArray(obj.hashtags) ? obj.hashtags : []).map((h) => clip(h, 30)).filter(Boolean).slice(0, 8)
      };
    } catch {
      // 다음 블록 시도
    }
  }
  return null;
}

/** 결재 승인된 대본 → 제작 대기열 */
export function queueShortsJob(db, task) {
  if (!task?.shorts) return null;
  const sh = ensureShorts(db);
  const script = parseShortsScript(task.output);
  const now = new Date().toISOString();
  const job = {
    id: uid('sj'),
    taskId: task.id,
    missionId: task.missionId,
    candidateId: task.shorts.candidateId || '',
    status: script ? 'queued' : 'needs_fix',
    script,
    error: script ? '' : '대본에서 제작용 JSON 블록을 읽지 못했습니다.',
    createdAt: now,
    updatedAt: now
  };
  sh.jobs.unshift(job);
  sh.jobs = sh.jobs.slice(0, 80);
  task.shorts.jobId = job.id;
  appendLog(db, '쇼츠 제작', script ? `"${script.title}" 제작 대기열 등록 (장면 ${script.scenes.length}개)` : `"${task.title}" 제작 보류: ${job.error}`, script ? 'info' : 'warning');
  return job;
}

/** 승인 직후 제작기를 바로 깨움 (GitHub 토큰에 권한이 없으면 15분 주기 점검이 가져감) */
export async function kickShortsFactory(settings) {
  try {
    const { token } = getGithubRepoConfig(settings);
    if (!token) return { ok: false, skipped: true };
    const res = await fetch(`https://api.github.com/repos/${SHORTS_FACTORY_REPO}/actions/workflows/make-shorts.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'ai-ceo-hub' },
      body: JSON.stringify({ ref: 'main' })
    });
    return { ok: res.status === 204, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** 제작기가 가져갈 작업 (가져간 작업은 1시간 동안 다른 실행이 못 가져감) */
export function claimJobs(db, limit = 2) {
  const sh = ensureShorts(db);
  const now = Date.now();
  const out = [];
  for (const j of sh.jobs) {
    if (out.length >= limit) break;
    const stale = j.status === 'rendering' && now - Date.parse(j.claimedAt || 0) > JOB_LEASE_MS;
    if (j.status !== 'queued' && !stale) continue;
    j.status = 'rendering';
    j.claimedAt = new Date().toISOString();
    j.attempts = Number(j.attempts || 0) + 1;
    out.push(j);
  }
  return out.map((j) => {
    const cand = sh.candidates.find((c) => c.id === j.candidateId);
    return { id: j.id, script: j.script, issue: cand ? { title: cand.title, url: cand.url, source: cand.source } : null };
  });
}

/** 제작기 결과 보고: 비공개 업로드 링크를 결과물로 남기고 텔레그램으로 알림 */
export async function recordJobResult(db, jobId, body = {}) {
  const sh = ensureShorts(db);
  const job = sh.jobs.find((j) => j.id === jobId);
  if (!job) return { ok: false, status: 404, error: '제작 작업을 찾을 수 없습니다.' };
  const now = new Date().toISOString();
  job.updatedAt = now;
  const mission = db.missions.find((m) => m.id === job.missionId);
  const task = db.tasks.find((t) => t.id === job.taskId);
  if (body.ok && body.videoId) {
    job.status = 'uploaded';
    job.video = { id: clip(body.videoId, 40), url: clip(body.url || `https://youtube.com/shorts/${body.videoId}`, 200), channelTitle: clip(body.channelTitle, 60), privacy: clip(body.privacy || 'private', 20), durationSec: Number(body.durationSec || 0) || null };
    job.runUrl = clip(body.runUrl, 300);
    if (task) task.output = `${task.output || ''}\n\n---\n**쇼츠 제작 완료 (비공개 업로드)**: ${job.video.url}`.trim();
    if (mission) {
      mission.deliverables = Array.isArray(mission.deliverables) ? mission.deliverables : [];
      mission.deliverables.unshift({ id: job.id, taskId: job.taskId, title: `쇼츠: ${job.script?.title || ''}`, agentName: '쇼츠 자동 제작기', summary: job.video.url, score: null, gaps: [], createdAt: now });
      leadSay(db, mission, '쇼츠 업로드', `"${job.script?.title || ''}" 쇼츠를 구국열사 채널에 비공개로 올렸습니다: ${job.video.url} — 확인 후 YouTube 스튜디오에서 공개해 주세요.`);
    }
    appendLog(db, '쇼츠 제작', `"${job.script?.title || ''}" 비공개 업로드 완료 ${job.video.url}`, 'success');
  } else {
    job.status = Number(job.attempts || 0) >= 2 ? 'failed' : 'queued';
    job.error = clip(body.error || '제작 실패', 400);
    job.runUrl = clip(body.runUrl, 300);
    appendLog(db, '쇼츠 제작', `"${job.script?.title || ''}" 제작 ${job.status === 'failed' ? '실패' : '실패 → 재시도 대기'}: ${job.error}`, 'warning');
  }
  const tg = db.settings?.telegram || {};
  if (tg.botToken && tg.chatId) {
    const msg =
      job.status === 'uploaded'
        ? `<b>쇼츠 비공개 업로드 완료</b>\n${esc(job.script?.title || '')}\n${esc(job.video.url)}\n확인 후 YouTube 스튜디오에서 공개로 바꿔 주세요.`
        : `<b>쇼츠 제작 ${job.status === 'failed' ? '실패' : '실패(재시도 예정)'}</b>\n${esc(job.script?.title || '')}\n사유: ${esc(job.error)}${job.runUrl ? `\n기록: ${esc(job.runUrl)}` : ''}`;
    sendTelegramText(tg.botToken, tg.chatId, msg).catch(() => {});
  }
  return { ok: true, job };
}

/** 텔레그램 버튼: sh:pick:<후보ID> */
export async function handleShortsCallback(action, id) {
  if (action !== 'pick') return { ok: false, text: '알 수 없는 동작입니다.' };
  const db = loadDb();
  const res = pickCandidate(db, id);
  if (!res.ok) return { ok: false, text: res.error };
  saveDb(db);
  await flushCloudBackup(db);
  autoStartLiveMissionTasks(res.mission.id).catch(() => {});
  return { ok: true, text: `선택됨: ${clip(res.candidate.title, 60)}\n대본을 쓰는 중입니다. 결재로 올라오면 확인해 주세요.` };
}
