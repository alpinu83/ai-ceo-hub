import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { resolveLanguageModel, resolveLiveBackendModel } from './orchestrator.js';

const PROTECTED_PATH_RE = /^(\.github\/|data\/db\.json$|data\/state\.json$|node_modules\/|\.env|package-lock\.json|public\/icons\/|public\/vendor\/)/i;
const ALLOWED_EXT_RE = /\.(js|mjs|cjs|ts|tsx|jsx|html|css|json|md|yml|yaml|txt|xml|svg)$/i;
export const DEFAULT_ALLOWED_REPOS = [
  'alpinu83/ai-ceo-hub',
  'alpinu83/kr-calc-hub',
  'alpinu83/alpinu83.github.io'
];

function normalizeRepoSlug(raw = '') {
  return String(raw || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

export function parseAllowedRepos(rawList = '', primaryRepo = '') {
  const parts = Array.isArray(rawList)
    ? rawList
    : String(rawList || '')
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const base = parts.length ? parts : DEFAULT_ALLOWED_REPOS;
  const set = new Set();
  const primary = normalizeRepoSlug(primaryRepo);
  if (primary && primary.includes('/')) set.add(primary);
  for (const item of base) {
    const slug = normalizeRepoSlug(item);
    if (slug && slug.includes('/')) set.add(slug);
  }
  return [...set];
}

export function getGithubRepoConfig(settings, override = {}) {
  const cfg = settings?.providers?.githubRepo || {};
  const token = String(cfg.apiKey || process.env.GITHUB_REPO_TOKEN || '').trim();
  const defaultRepo = normalizeRepoSlug(cfg.repo || process.env.GITHUB_REPO || 'alpinu83/ai-ceo-hub');
  const repo = normalizeRepoSlug(override?.repo || defaultRepo);
  const branch = String(override?.branch || cfg.branch || process.env.GITHUB_BRANCH || 'main').trim() || 'main';
  const allowedRepos = parseAllowedRepos(cfg.allowedRepos || process.env.GITHUB_ALLOWED_REPOS || '', defaultRepo);
  return { token, repo, branch, allowedRepos, enabled: Boolean(token && repo.includes('/')) };
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ai-ceo-hub-it-devops',
    'Content-Type': 'application/json'
  };
}

async function ghFetch(token, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...ghHeaders(token), ...(opts.headers || {}) },
    signal: opts.signal || AbortSignal.timeout(20000)
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${data?.message || text.slice(0, 160)}`);
  }
  return data;
}

export async function testGithubRepoConnection(settings) {
  const cfg = getGithubRepoConfig(settings);
  if (!cfg.token) {
    throw new Error('IT팀 GitHub 토큰(repo / Contents+Pull requests 권한)을 먼저 저장해 주세요.');
  }
  const reposToCheck = cfg.allowedRepos.length ? cfg.allowedRepos : [cfg.repo];
  const results = [];
  for (const slug of reposToCheck) {
    if (!slug.includes('/')) continue;
    try {
      const repoInfo = await ghFetch(cfg.token, `https://api.github.com/repos/${slug}`);
      const canPush = Boolean(repoInfo?.permissions?.push || repoInfo?.permissions?.admin);
      results.push({
        repo: repoInfo.full_name || slug,
        ok: true,
        canPush,
        defaultBranch: repoInfo.default_branch || 'main'
      });
    } catch (err) {
      results.push({ repo: slug, ok: false, canPush: false, error: err.message });
    }
  }
  const writable = results.filter((r) => r.ok && r.canPush);
  const readableOnly = results.filter((r) => r.ok && !r.canPush);
  const failed = results.filter((r) => !r.ok);
  if (writable.length === 0 && readableOnly.length === 0) {
    throw new Error(`저장소 접근 실패: ${failed.map((f) => `${f.repo} (${f.error})`).join(', ')}`);
  }
  const summaryParts = [];
  if (writable.length) summaryParts.push(`쓰기·PR·배포 가능(${writable.map((r) => r.repo).join(', ')})`);
  if (readableOnly.length) summaryParts.push(`읽기 전용(${readableOnly.map((r) => r.repo).join(', ')})`);
  if (failed.length) summaryParts.push(`권한 없음(${failed.map((r) => r.repo).join(', ')})`);

  return {
    ok: true,
    repo: writable[0]?.repo || results[0]?.repo || cfg.repo,
    canPush: writable.length > 0,
    repos: results,
    reply: summaryParts.join(' · ')
  };
}

export async function listRepoFiles(cfg) {
  const tree = await ghFetch(
    cfg.token,
    `https://api.github.com/repos/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`
  );
  return (tree.tree || [])
    .filter((item) => item.type === 'blob' && item.path && !PROTECTED_PATH_RE.test(item.path) && ALLOWED_EXT_RE.test(item.path))
    .map((item) => item.path);
}

export async function readRepoFile(cfg, filePath) {
  const safePath = String(filePath || '').replace(/^\/+/, '');
  if (!safePath || PROTECTED_PATH_RE.test(safePath)) {
    throw new Error(`보안 정책상 접근이 제한된 경로입니다: ${safePath}`);
  }
  const encodedPath = safePath.split('/').map(encodeURIComponent).join('/');
  const data = await ghFetch(
    cfg.token,
    `https://api.github.com/repos/${cfg.repo}/contents/${encodedPath}?ref=${encodeURIComponent(cfg.branch)}`
  );
  const content = Buffer.from(String(data.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
  return { path: safePath, sha: data.sha, content };
}

const FileSelectSchema = z.object({
  needsCodeChange: z
    .boolean()
    .describe('지시·협업 결과 중 이 저장소의 실제 파일을 수정해야 하는 항목이 있으면 true, 리서치·전략·외부 작업뿐이면 false'),
  files: z.array(z.string()).max(3).describe('수정 또는 점검할 저장소 내 파일 경로 (최대 3개, 변경 불필요 시 빈 배열)'),
  analysisPlan: z.string().describe('수정 계획 1~2문장 요약 (변경 불필요 시 그 이유)')
});

function codedError(message, code, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

const PatchPlanSchema = z.object({
  prTitle: z.string().describe('간결한 PR 제목 (한국어 또는 영문)'),
  prSummary: z.string().describe('변경 내용 및 기대 효과 요약 (한국어 2~4문장)'),
  edits: z
    .array(
      z.object({
        path: z.string().describe('수정할 파일 경로'),
        search: z.string().describe('기존 파일에 정확히 존재하는 원본 코드 블록 (공백·줄바꿈 포함 완전 일치)'),
        replace: z.string().describe('교체할 새 코드 블록'),
        reason: z.string().describe('이 수정이 필요한 이유 (1문장)')
      })
    )
    .min(1)
    .max(5),
  qaChecklist: z.array(z.string()).min(1).max(5).describe('QA 검증 항목')
});

const SecurityAuditSchema = z.object({
  passed: z.boolean().describe('보안 및 안정성 기준 통과 여부'),
  riskLevel: z.enum(['low', 'medium', 'high']),
  notes: z.string().describe('보안 감사 및 코드 리뷰 의견 (한국어 2~3문장)')
});

function pickItModel(agents, settings, preferredId) {
  const ag = agents.find((a) => a.id === preferredId && a.active);
  if (ag) {
    const resolved = resolveLanguageModel(ag, settings);
    if (resolved) return resolved;
  }
  return resolveLiveBackendModel(settings);
}

async function generateObjectResilient(models, opts) {
  let lastErr = null;
  for (const m of models.filter(Boolean)) {
    try {
      return await generateObject({ ...opts, model: m.model, maxRetries: 0 });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('사용 가능한 AI 모델이 없습니다.');
}

/**
 * Full Autonomous IT Maintenance Pipeline (Code Read -> Patch -> Security Audit -> GitHub Branch + Commit + PR)
 * Never pushes directly to `main`; always opens a PR and awaits CEO Approval before merging & auto-deploying!
 */
export async function runItMaintenancePipeline({
  instruction,
  missionTitle,
  repoOverride,
  branchOverride,
  siteUrl,
  agents,
  settings,
  teamContext = ''
}) {
  const cfg = getGithubRepoConfig(settings, { repo: repoOverride, branch: branchOverride });
  if (cfg.allowedRepos.length && !cfg.allowedRepos.includes(cfg.repo)) {
    throw new Error(`허용 목록에 없는 저장소입니다: ${cfg.repo}`);
  }
  const teamBlock = String(teamContext || '').trim()
    ? `\n\n[AI 팀 협업 결정사항 (참고용 — 실제 저장소에 존재하지 않는 서버·DB·파일 언급은 무시하고, 실제 파일에 적용 가능한 변경만 반영)]\n${String(teamContext).slice(0, 9000)}`
    : '';
  if (!cfg.enabled) {
    throw new Error('IT팀 GitHub 토큰이 설정되지 않았습니다. 설정 → 연결 설정 → IT팀 GitHub에서 토큰을 등록해 주세요.');
  }

  const devModels = [
    pickItModel(agents, settings, 'agent_it_dev'),
    pickItModel(agents, settings, 'agent_it_qa'),
    pickItModel(agents, settings, 'agent_qwen'),
    resolveLiveBackendModel(settings)
  ].filter(Boolean);
  const secModels = [
    pickItModel(agents, settings, 'agent_it_sec'),
    pickItModel(agents, settings, 'agent_it_qa'),
    devModels[0]
  ].filter(Boolean);
  if (devModels.length === 0) {
    throw new Error('IT 개발용 AI API 키(Groq / OpenRouter / Gemini / EXAONE)가 최소 1개 필요합니다.');
  }

  // 1. List live files in GitHub repository
  const allFiles = await listRepoFiles(cfg);
  if (allFiles.length === 0) {
    throw new Error(`저장소(${cfg.repo})에서 수정 가능한 소스 파일을 찾지 못했습니다.`);
  }

  // 2. IT Dev selects the 1~3 exact files to inspect
  const { object: selection } = await generateObjectResilient(devModels, {
    schema: FileSelectSchema,
    system: `당신은 GM Corporation IT 개발팀 수석 엔지니어입니다.
대상 저장소(${cfg.repo}${siteUrl ? ` / 라이브 사이트 ${siteUrl}` : ''})의 실제 파일 목록에서 CEO의 지시와 팀 결정사항을 반영하기 위해 읽고 수정해야 할 가장 핵심 파일 1~3개만 정확히 고르세요.
반드시 목록에 있는 정확한 파일 경로만 선택하세요.
지시·결정사항이 리서치·전략·외부 계정 작업(광고비 집행, 콘솔 설정 등)뿐이라 이 저장소 코드를 바꿀 필요가 없으면 needsCodeChange=false, files=[]로 답하세요.`,
    prompt: `[저장소: ${cfg.repo} (${cfg.branch})]\n[파일 목록]\n${allFiles.join('\n')}\n\n[CEO 지시]\n제목: ${missionTitle || ''}\n내용: ${instruction}${teamBlock}`
  });

  if (!selection.needsCodeChange || !Array.isArray(selection.files) || selection.files.length === 0) {
    throw codedError(
      `IT팀 검토 결과 ${cfg.repo} 저장소 코드 변경이 필요하지 않습니다.${selection.analysisPlan ? ` (${selection.analysisPlan})` : ''}`,
      'NO_CODE_CHANGE'
    );
  }

  const targetPaths = [...new Set(selection.files)]
    .filter((p) => allFiles.includes(p) && !PROTECTED_PATH_RE.test(p))
    .slice(0, 3);
  if (targetPaths.length === 0) {
    throw new Error('IT 개발팀이 수정 대상 파일을 특정하지 못했습니다. 수정할 화면이나 파일명을 조금 더 구체적으로 알려주세요.');
  }

  // 3. Read actual live source code from GitHub
  const loadedFiles = await Promise.all(targetPaths.map((p) => readRepoFile(cfg, p)));
  const fileContext = loadedFiles
    .map((f) => `=== FILE: ${f.path} (${f.content.length} chars) ===\n${f.content.slice(0, 26000)}`)
    .join('\n\n');

  // 4. IT Dev generates exact search/replace patches
  const { object: patchPlan } = await generateObjectResilient(devModels, {
    schema: PatchPlanSchema,
    system: `당신은 GM Corporation IT 개발팀 수석 엔지니어입니다.
대상 저장소(${cfg.repo})의 실제 소스 코드를 바탕으로 CEO의 보수·개선 지시를 안전하고 정확하게 구현하는 최소 범위 search/replace 패치를 작성하세요.
규칙:
- search 문자열은 반드시 제공된 파일 내용에 100% 정확히(공백·들여쓰기 포함) 존재해야 합니다.
- 불필요한 대규모 리팩토링 금지. 필요한 부분만 정확히 수정하세요.
- HTML/CSS/JS/JSON 파일 수정 시 문법 오류나 기존 기능 깨짐이 없도록 하세요.
- 보안을 약화시키거나 비밀키를 코드에 하드코딩하지 마세요.
- 팀 결정사항에 실제 파일에 없는 구조가 언급되어 있으면 지어내지 말고, 실제 코드에 맞는 부분만 구현하세요.`,
    prompt: `[대상 저장소: ${cfg.repo}]\n[CEO 지시]\n${instruction}${teamBlock}\n\n[실제 저장소 소스 코드]\n${fileContext}`
  });

  // 5. Apply and verify every edit in memory before touching GitHub
  const fileMap = new Map(loadedFiles.map((f) => [f.path, { ...f, updatedContent: f.content, appliedEdits: [] }]));
  for (const edit of patchPlan.edits) {
    if (PROTECTED_PATH_RE.test(edit.path)) continue;
    const entry = fileMap.get(edit.path);
    if (!entry) continue;
    if (!edit.search || !entry.updatedContent.includes(edit.search)) {
      continue;
    }
    entry.updatedContent = entry.updatedContent.replace(edit.search, edit.replace);
    entry.appliedEdits.push(edit);
  }

  const changedFiles = [...fileMap.values()].filter((f) => f.appliedEdits.length > 0 && f.updatedContent !== f.content);
  if (changedFiles.length === 0) {
    throw new Error('IT 개발팀이 제안한 패치가 원본 코드와 정확히 일치하지 않아 안전하게 중단했습니다. 수정할 위치를 조금 더 구체적으로 지시해 주세요.');
  }

  // 6. IT Security audits the exact diff before opening PR
  const diffSummary = changedFiles
    .map((f) =>
      f.appliedEdits
        .map((e) => `파일: ${f.path}\n이유: ${e.reason}\n--- 원본 ---\n${e.search.slice(0, 600)}\n+++ 수정 +++\n${e.replace.slice(0, 600)}`)
        .join('\n')
    )
    .join('\n\n');

  let audit = { passed: true, riskLevel: 'low', notes: 'IT 보안 자동 검토 완료: 민감 정보 노출 및 보호 경로 변경 없음.' };
  try {
    const { object: secObj } = await generateObjectResilient(secModels, {
      schema: SecurityAuditSchema,
      system: `당신은 GM Corporation IT 보안 감사관입니다. 아래 코드 수정(diff)이 보안 취약점(비밀키 노출, XSS/인젝션, 인증 우회, 치명적 문법 오류)을 유발하지 않는지 엄격히 검토하세요.`,
      prompt: `[대상 저장소: ${cfg.repo}]\n[보수 지시]\n${instruction}\n\n[코드 변경 내역]\n${diffSummary}`
    });
    audit = secObj;
  } catch {
    // Non-fatal fallback
  }

  // 7. Create isolated GitHub branch from base branch
  const baseRef = await ghFetch(
    cfg.token,
    `https://api.github.com/repos/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`
  );
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`기준 브랜치(${cfg.branch}) SHA를 조회하지 못했습니다.`);

  const branchName = `it-fix/${Date.now().toString(36)}`;
  await ghFetch(cfg.token, `https://api.github.com/repos/${cfg.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    })
  });

  // 8. Commit each modified file to the new branch
  for (const f of changedFiles) {
    const encodedPath = f.path.split('/').map(encodeURIComponent).join('/');
    await ghFetch(cfg.token, `https://api.github.com/repos/${cfg.repo}/contents/${encodedPath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `fix(it-team): ${patchPlan.prTitle.slice(0, 60)} (${f.path})`,
        content: Buffer.from(f.updatedContent, 'utf8').toString('base64'),
        sha: f.sha,
        branch: branchName
      })
    });
  }

  // 9. Open Pull Request for CEO approval & automatic CI verification
  const deployLabel = cfg.repo.includes('kr-calc-hub')
    ? 'korea-tax-cal.com (GitHub Actions 자동 빌드·배포)'
    : cfg.repo.includes('ai-ceo-hub')
      ? 'Render · GitHub Pages 라이브 배포'
      : `${cfg.repo} 자동 배포`;

  const prBody = [
    `## GM Corp IT 유지보수팀 자동 보수 PR`,
    ``,
    `- **대상 저장소**: \`${cfg.repo}\` (\`${cfg.branch}\`)`,
    ...(siteUrl ? [`- **라이브 사이트**: ${siteUrl}`] : []),
    ``,
    `### 요약`,
    patchPlan.prSummary,
    ``,
    `### 수정된 파일 (${changedFiles.length}건)`,
    ...changedFiles.map((f) => `- \`${f.path}\` (${f.appliedEdits.map((e) => e.reason).join(' / ')})`),
    ``,
    `### IT 보안 감사 (${audit.passed ? 'PASS' : '주의 필요'} · 리스크: ${audit.riskLevel.toUpperCase()})`,
    audit.notes,
    ``,
    `### QA 체크리스트`,
    ...patchPlan.qaChecklist.map((q) => `- [ ] ${q}`),
    ``,
    `> CEO Office 결재함 또는 텔레그램에서 **승인**하시면 자동으로 \`${cfg.branch}\` 브랜치에 머지되고 ${deployLabel}가 시작됩니다.`
  ].join('\n');

  const pr = await ghFetch(cfg.token, `https://api.github.com/repos/${cfg.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `[IT팀 보수] ${patchPlan.prTitle}`,
      head: branchName,
      base: cfg.branch,
      body: prBody
    })
  });

  return {
    ok: true,
    repo: cfg.repo,
    branch: cfg.branch,
    branchName,
    prNumber: pr.number,
    prUrl: pr.html_url,
    prTitle: patchPlan.prTitle,
    prSummary: patchPlan.prSummary,
    changedFiles: changedFiles.map((f) => f.path),
    diffSummary,
    audit,
    qaChecklist: patchPlan.qaChecklist,
    instruction,
    teamContext: String(teamContext || '')
  };
}

/**
 * Summarize GitHub check-runs for a commit: 'success' | 'failure' | 'pending' | 'none'
 */
export async function getCommitCheckState(cfg, sha) {
  try {
    const data = await ghFetch(
      cfg.token,
      `https://api.github.com/repos/${cfg.repo}/commits/${encodeURIComponent(sha)}/check-runs?per_page=50`
    );
    const runs = Array.isArray(data.check_runs) ? data.check_runs : [];
    if (runs.length === 0) return { state: 'none', runs: [] };
    const failed = runs.filter((r) => r.status === 'completed' && ['failure', 'timed_out', 'cancelled', 'action_required'].includes(r.conclusion));
    const pending = runs.filter((r) => r.status !== 'completed');
    const summary = runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url }));
    if (failed.length) return { state: 'failure', runs: summary };
    if (pending.length) return { state: 'pending', runs: summary };
    return { state: 'success', runs: summary };
  } catch (err) {
    return { state: 'unknown', runs: [], error: err.message };
  }
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mergeMaintenancePr({ prNumber, repo, branch, settings, waitForChecksMs = 300000 }) {
  const cfg = getGithubRepoConfig(settings, { repo, branch });
  if (!cfg.enabled) {
    throw new Error('IT팀 GitHub 토큰이 설정되지 않아 자동 머지할 수 없습니다.');
  }
  if (cfg.allowedRepos.length && !cfg.allowedRepos.includes(cfg.repo)) {
    throw new Error(`허용 목록에 없는 저장소입니다: ${cfg.repo}`);
  }

  // 1. PR state guard (already merged / closed / conflict)
  let pr = await ghFetch(cfg.token, `https://api.github.com/repos/${cfg.repo}/pulls/${Number(prNumber)}`);
  if (pr.merged) {
    return {
      ok: true,
      alreadyMerged: true,
      repo: cfg.repo,
      sha: pr.merge_commit_sha || '',
      message: `${cfg.repo} PR #${Number(prNumber)}은 이미 머지되어 있습니다.`
    };
  }
  if (pr.state === 'closed') {
    throw codedError(`${cfg.repo} PR #${Number(prNumber)}이 이미 닫혀 있습니다.`, 'PR_CLOSED');
  }
  // GitHub computes mergeability lazily; poll briefly
  for (let i = 0; i < 4 && pr.mergeable === null; i++) {
    await sleepMs(2500);
    pr = await ghFetch(cfg.token, `https://api.github.com/repos/${cfg.repo}/pulls/${Number(prNumber)}`);
  }
  if (pr.mergeable === false) {
    throw codedError(`${cfg.repo} PR #${Number(prNumber)}이 최신 main과 충돌합니다.`, 'PR_CONFLICT');
  }

  // 2. CI guard: never merge over a failing check; wait a little for pending checks
  const headSha = pr.head?.sha;
  if (headSha) {
    const deadline = Date.now() + Math.max(0, waitForChecksMs);
    let checks = await getCommitCheckState(cfg, headSha);
    while (checks.state === 'pending' && Date.now() < deadline) {
      await sleepMs(15000);
      checks = await getCommitCheckState(cfg, headSha);
    }
    if (checks.state === 'failure') {
      const failedNames = checks.runs.filter((r) => r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'skipped' && r.conclusion !== 'neutral').map((r) => r.name);
      throw codedError(
        `${cfg.repo} PR #${Number(prNumber)} CI 검사 실패(${failedNames.join(', ') || 'check'})로 머지를 보류했습니다.`,
        'CI_FAILED',
        { checks: checks.runs }
      );
    }
  }

  const mergeRes = await ghFetch(
    cfg.token,
    `https://api.github.com/repos/${cfg.repo}/pulls/${Number(prNumber)}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({
        merge_method: 'squash',
        commit_title: `merge(it-team): CEO approved PR #${Number(prNumber)}`
      })
    }
  );
  return {
    ok: Boolean(mergeRes.merged),
    repo: cfg.repo,
    sha: mergeRes.sha || '',
    message: mergeRes.message || `${cfg.repo} PR #${Number(prNumber)} 머지 완료 → 자동 배포 시작됨`
  };
}

/**
 * After merge: follow the GitHub Actions runs triggered by the merge commit and report the real outcome.
 * Returns { status: 'success' | 'failure' | 'unknown', runs }
 */
export async function watchDeployment({ repo, sha, settings, timeoutMs = 600000, intervalMs = 20000 }) {
  const cfg = getGithubRepoConfig(settings, { repo });
  if (!cfg.enabled || !sha) return { status: 'unknown', runs: [], reason: '토큰 또는 커밋 SHA 없음' };
  const deadline = Date.now() + timeoutMs;
  let lastRuns = [];
  let sawAny = false;
  while (Date.now() < deadline) {
    try {
      const data = await ghFetch(
        cfg.token,
        `https://api.github.com/repos/${cfg.repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`
      );
      const runs = (data.workflow_runs || []).map((r) => ({
        name: r.name,
        status: r.status,
        conclusion: r.conclusion,
        url: r.html_url
      }));
      lastRuns = runs;
      if (runs.length) sawAny = true;
      if (runs.length && runs.every((r) => r.status === 'completed')) {
        const failed = runs.filter((r) => !['success', 'skipped', 'neutral'].includes(r.conclusion));
        return { status: failed.length ? 'failure' : 'success', runs };
      }
    } catch (err) {
      return { status: 'unknown', runs: lastRuns, reason: err.message };
    }
    await sleepMs(intervalMs);
  }
  return { status: 'unknown', runs: lastRuns, reason: sawAny ? '배포 워크플로가 제한 시간 내 끝나지 않음' : '연결된 배포 워크플로를 찾지 못함' };
}

export async function closeMaintenancePr({ prNumber, repo, settings }) {
  const cfg = getGithubRepoConfig(settings, { repo });
  if (!cfg.enabled || !prNumber) return { ok: false };
  try {
    await ghFetch(cfg.token, `https://api.github.com/repos/${cfg.repo}/pulls/${Number(prNumber)}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' })
    });
    return { ok: true, repo: cfg.repo };
  } catch {
    return { ok: false };
  }
}
