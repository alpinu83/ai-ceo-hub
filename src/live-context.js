import { buildAnalyticsContext, getGoogleDataConfig } from './google-data.js';

const CACHE_TTL_MS = 2 * 60 * 1000;
const siteCache = new Map();
const repoCache = new Map();

function readGhSettings(settings, override = {}) {
  const cfg = settings?.providers?.githubRepo || {};
  const token = String(cfg.apiKey || process.env.GITHUB_REPO_TOKEN || '').trim();
  const norm = (r) =>
    String(r || '')
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
  const repo = norm(override?.repo || cfg.repo || process.env.GITHUB_REPO || 'alpinu83/ai-ceo-hub');
  const branch = String(override?.branch || cfg.branch || process.env.GITHUB_BRANCH || 'main').trim() || 'main';
  return { token, repo, branch, enabled: Boolean(token && repo.includes('/')) };
}

function isSafePublicUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '::1' ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
      /^169\.254\./.test(h)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function stripTags(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMeta(html, attr, key) {
  const re = new RegExp(
    `<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`,
    'i'
  );
  const m = html.match(re);
  return m ? (m[1] || m[2] || '').trim() : '';
}

export async function inspectLiveSite(siteUrl) {
  const cleanUrl = String(siteUrl || '').trim();
  if (!cleanUrl || !isSafePublicUrl(cleanUrl)) return null;

  const cached = siteCache.get(cleanUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const t0 = Date.now();
  try {
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'CEO-Office-SiteInspector/1.0 (+https://ai-ceo-hub.onrender.com)',
        Accept: 'text/html,application/xhtml+xml'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });
    const latencyMs = Date.now() - t0;
    const html = await res.text();

    const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const description = extractMeta(html, 'name', 'description');
    const ogTitle = extractMeta(html, 'property', 'og:title');
    const canonical = ((html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || [])[1] || '').trim();

    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean)
      .slice(0, 3);
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean)
      .slice(0, 8);

    const linkCount = (html.match(/<a\s+[^>]*href=/gi) || []).length;
    const scriptCount = (html.match(/<script\b/gi) || []).length;
    const inputCount = (html.match(/<(input|select|textarea)\b/gi) || []).length;
    const hasJsonLd = /application\/ld\+json/i.test(html);
    const hasGtag = /gtag\(|googletagmanager\.com/i.test(html);
    const hasAdsense = /googlesyndication\.com|adsbygoogle/i.test(html);

    const origin = new URL(res.url || cleanUrl).origin;
    const [robotsOk, sitemapOk] = await Promise.all([
      fetch(`${origin}/robots.txt`, { method: 'GET', signal: AbortSignal.timeout(3500) })
        .then((r) => r.ok)
        .catch(() => false),
      fetch(`${origin}/sitemap.xml`, { method: 'GET', signal: AbortSignal.timeout(3500) })
        .then((r) => r.ok)
        .catch(() => false)
    ]);

    const data = {
      ok: res.ok,
      url: res.url || cleanUrl,
      status: res.status,
      latencyMs,
      htmlBytes: html.length,
      title,
      description,
      ogTitle,
      canonical,
      h1s,
      h2s,
      linkCount,
      scriptCount,
      inputCount,
      hasJsonLd,
      hasGtag,
      hasAdsense,
      robotsOk,
      sitemapOk
    };
    siteCache.set(cleanUrl, { at: Date.now(), data });
    return data;
  } catch (err) {
    return { ok: false, url: cleanUrl, error: err.message };
  }
}

export async function inspectGithubRepo({ repo, branch = 'main', token = '' }) {
  const cleanRepo = String(repo || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!cleanRepo || !cleanRepo.includes('/')) return null;

  const cacheKey = `${cleanRepo}@${branch}:${token ? 'auth' : 'pub'}`;
  const cached = repoCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ai-ceo-hub-live-context'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const [repoRes, treeRes, commitsRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${cleanRepo}`, { headers, signal: AbortSignal.timeout(7000) }),
      fetch(
        `https://api.github.com/repos/${cleanRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        { headers, signal: AbortSignal.timeout(7000) }
      ),
      fetch(
        `https://api.github.com/repos/${cleanRepo}/commits?sha=${encodeURIComponent(branch)}&per_page=5`,
        { headers, signal: AbortSignal.timeout(7000) }
      )
    ]);

    if (!repoRes.ok) {
      return { ok: false, repo: cleanRepo, error: `GitHub HTTP ${repoRes.status}` };
    }

    const repoJson = await repoRes.json();
    const treeJson = treeRes.ok ? await treeRes.json() : { tree: [] };
    const commitsJson = commitsRes.ok ? await commitsRes.json() : [];

    const files = (treeJson.tree || [])
      .filter((i) => i.type === 'blob' && i.path && !/^node_modules\/|^\.git\//i.test(i.path))
      .map((i) => i.path)
      .slice(0, 70);

    const recentCommits = Array.isArray(commitsJson)
      ? commitsJson.slice(0, 5).map((c) => ({
          sha: String(c.sha || '').slice(0, 7),
          date: String(c.commit?.author?.date || '').slice(0, 10),
          message: String(c.commit?.message || '').split('\n')[0].slice(0, 90)
        }))
      : [];

    const data = {
      ok: true,
      repo: repoJson.full_name || cleanRepo,
      description: repoJson.description || '',
      defaultBranch: repoJson.default_branch || branch,
      private: Boolean(repoJson.private),
      canPush: Boolean(token && (repoJson.permissions?.push || repoJson.permissions?.admin)),
      files,
      recentCommits
    };
    repoCache.set(cacheKey, { at: Date.now(), data });
    return data;
  } catch (err) {
    return { ok: false, repo: cleanRepo, error: err.message };
  }
}

export async function buildMissionLiveContext({ mission, settings }) {
  if (!mission) return '';
  const ghCfg = readGhSettings(settings, {
    repo: mission.githubRepo,
    branch: mission.githubBranch
  });

  const targetRepo = mission.githubRepo || (mission.domain === 'it_ops' ? ghCfg.repo : '');
  const targetBranch = mission.githubBranch || ghCfg.branch || 'main';
  const targetSite = mission.siteUrl || '';
  const extraRepos = Array.isArray(mission.extraRepos) ? mission.extraRepos.slice(0, 2) : [];

  const [siteInfo, mainRepoInfo, ...extraRepoInfos] = await Promise.all([
    targetSite ? inspectLiveSite(targetSite) : Promise.resolve(null),
    targetRepo ? inspectGithubRepo({ repo: targetRepo, branch: targetBranch, token: ghCfg.token }) : Promise.resolve(null),
    ...extraRepos.map((r) => inspectGithubRepo({ repo: r, branch: 'main', token: ghCfg.token }))
  ]);

  const lines = [];
  const gd = getGoogleDataConfig(settings);
  const hostOf = (u) => String(u || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase();
  // 분석 데이터는 이 업무의 사이트가 연동된 사이트와 같을 때만 (다른 프로젝트 수치가 섞이지 않게)
  const analyticsForThis = Boolean(targetSite) && (gd.gaEnabled || gd.scEnabled) && hostOf(gd.searchConsoleSite) === hostOf(targetSite);
  if (!targetSite && !targetRepo) {
    lines.push('[이 업무의 실제 도구 현황]');
    lines.push('- 연결된 사이트·GitHub 저장소·분석 데이터가 없는 업무입니다. 코드·PR·배포 작업 대상이 아니며, 수치는 웹에서 확인한 근거나 "가정:"으로만 쓰세요.');
    lines.push('- 결제·광고비 집행·외부 발송은 하지 않습니다(필요하면 초안만).');
    return lines.join('\n');
  }
  lines.push('[실제 시스템 권한 및 도구 현황 — 사실 기반 준수 필수]');
  if (targetSite) {
    lines.push(
      `- 공개 웹사이트 실시간 HTML/SEO 조회: ${siteInfo?.ok ? `연동됨 (${siteInfo.url})` : `시도함 (${targetSite}, 오류: ${siteInfo?.error || '응답 없음'})`}`
    );
  }
  if (targetRepo) {
    lines.push(`- GitHub 저장소 실제 소스 읽기: ${mainRepoInfo?.ok ? `연동됨 (${mainRepoInfo.repo}@${mainRepoInfo.defaultBranch})` : `연결 필요 (${targetRepo})`}`);
    lines.push(
      `- GitHub 실코드 수정 · PR 생성 · CEO 승인 후 자동 배포: ${
        ghCfg.enabled ? `권한 활성화됨 (${targetRepo} → PR 자동 보수 가능)` : '읽기만 가능 (설정 → IT팀 GitHub 토큰 등록 시 실코드 PR·자동 배포 활성화)'
      }`
    );
  } else {
    lines.push('- GitHub 저장소: 없음 (코드·PR 작업 대상 아님)');
  }
  if (analyticsForThis) {
    if (gd.gaEnabled) lines.push(`- Google Analytics(GA4) 데이터 조회: 연동됨 (읽기 전용, 속성 ${gd.ga4PropertyId}) — 아래 실제 수치만 인용`);
    if (gd.scEnabled) lines.push(`- Google 서치콘솔 데이터 조회: 연동됨 (읽기 전용, ${gd.searchConsoleSite}) — 아래 실제 수치만 인용`);
  } else {
    lines.push('- 분석 데이터(GA4·서치콘솔): 이 업무의 사이트에는 연동 안 됨 → 수치를 지어내지 말 것');
  }
  lines.push('- 하지 않는 일: 애드센스 수익 API 조회, 유료 광고 결제·집행, 외부 이메일·전화 자동 발송 (했다고 쓰지 말 것)');

  if (siteInfo?.ok) {
    lines.push('');
    lines.push(`[실시간 사이트 점검 결과: ${siteInfo.url}]`);
    lines.push(`- HTTP ${siteInfo.status} / 응답속도 ${siteInfo.latencyMs}ms / HTML ${(siteInfo.htmlBytes / 1024).toFixed(1)}KB`);
    if (siteInfo.title) lines.push(`- Title: ${siteInfo.title}`);
    if (siteInfo.description) lines.push(`- Meta Description: ${siteInfo.description.slice(0, 180)}`);
    if (siteInfo.canonical) lines.push(`- Canonical: ${siteInfo.canonical}`);
    if (siteInfo.h1s.length) lines.push(`- H1: ${siteInfo.h1s.join(' | ')}`);
    if (siteInfo.h2s.length) lines.push(`- 주요 H2: ${siteInfo.h2s.join(' | ')}`);
    lines.push(
      `- 구조: 링크 ${siteInfo.linkCount}개, 스크립트 ${siteInfo.scriptCount}개, 입력폼 ${siteInfo.inputCount}개, JSON-LD=${siteInfo.hasJsonLd ? '있음' : '없음'}, GA태그=${siteInfo.hasGtag ? '설치됨' : '없음'}, AdSense=${siteInfo.hasAdsense ? '설치됨' : '없음'}, robots.txt=${siteInfo.robotsOk ? 'OK' : '없음'}, sitemap.xml=${siteInfo.sitemapOk ? 'OK' : '없음'}`
    );
  }

  if (mainRepoInfo?.ok) {
    lines.push('');
    lines.push(`[실제 GitHub 저장소: ${mainRepoInfo.repo}]`);
    if (mainRepoInfo.description) lines.push(`- 설명: ${mainRepoInfo.description}`);
    lines.push(`- 실제 파일 목록 (${mainRepoInfo.files.length}개): ${mainRepoInfo.files.join(', ')}`);
    if (mainRepoInfo.recentCommits.length) {
      lines.push(
        `- 최근 커밋:\n${mainRepoInfo.recentCommits.map((c) => `  * [${c.date} ${c.sha}] ${c.message}`).join('\n')}`
      );
    }
  }

  for (const ex of extraRepoInfos) {
    if (ex?.ok) {
      lines.push('');
      lines.push(`[연관 보조 저장소: ${ex.repo}]`);
      lines.push(`- 파일: ${ex.files.join(', ')}`);
    }
  }

  // 웹사이트 실제 성과 데이터(GA4·서치콘솔) — 미션 사이트가 연동된 사이트일 때만
  if (analyticsForThis) {
    const analytics = await buildAnalyticsContext(settings, { siteUrl: targetSite }).catch(() => '');
    if (analytics) {
      lines.push('');
      lines.push(analytics);
    }
  }

  return lines.join('\n');
}
