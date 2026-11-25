/**
 * 근거 기반 작업(Grounding) + 자동 사실 확인(Fact-check)
 *
 * 무료 모델이 틀리는 가장 큰 이유는 "실제 코드를 보지 않고 추측"하기 때문입니다.
 *  1) buildCodeEvidence: 작업 내용에서 키워드를 뽑아 연결된 저장소의 실제 코드에서 해당 줄을 찾아 프롬프트에 넣어 줍니다.
 *     (찾지 못한 키워드도 "저장소에 없음"으로 알려 줘서, 없는 클래스·파일을 고치는 실수를 막습니다)
 *  2) factCheckOutput: 결과물에서 존재하지 않는 파일 경로, 없는 PR 번호, 지어낸 측정값, 실행 권한 없는 "했다" 보고,
 *     저장소에 없는 CSS 클래스를 기계적으로 찾아냅니다. (AI 검수 한도가 바닥나도 항상 동작)
 */

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;
const snapshotCache = new Map();
const TEXT_EXT_RE = /\.(js|mjs|cjs|ts|jsx|tsx|css|html|json|yml|yaml|md|txt|xml|svg)$/i;
const SKIP_PATH_RE = /^(node_modules\/|dist\/|\.git\/)|package-lock\.json$|\.min\.(js|css)$/i;

function ghHeaders(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ai-ceo-hub-grounding' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function cleanRepoSlug(repo) {
  return String(repo || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

/**
 * 저장소 스냅샷: 전체 파일 목록 + 텍스트 파일 내용(작은 저장소 기준) + 최근 PR 번호.
 * 10분 캐시. 실패하면 null.
 */
export async function getRepoSnapshot({ repo, branch = 'main', token = '' }) {
  const slug = cleanRepoSlug(repo);
  if (!slug.includes('/')) return null;
  const key = `${slug}@${branch}`;
  const hit = snapshotCache.get(key);
  if (hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.data;
  try {
    const headers = ghHeaders(token);
    const [treeRes, prRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers, signal: AbortSignal.timeout(10000) }),
      fetch(`https://api.github.com/repos/${slug}/pulls?state=all&per_page=100`, { headers, signal: AbortSignal.timeout(10000) })
    ]);
    if (!treeRes.ok) return null;
    const tree = await treeRes.json();
    const blobs = (tree.tree || []).filter((i) => i.type === 'blob' && i.path && !/^\.git\//.test(i.path));
    const files = blobs.map((i) => i.path);
    const prs = prRes.ok ? await prRes.json() : [];
    const prNumbers = new Set((Array.isArray(prs) ? prs : []).map((p) => Number(p.number)));
    const prState = Object.fromEntries((Array.isArray(prs) ? prs : []).map((p) => [Number(p.number), p.merged_at ? 'merged' : p.state]));

    // 텍스트 파일 내용 (총 1.5MB, 파일당 300KB 이하)
    const textFiles = blobs.filter((b) => TEXT_EXT_RE.test(b.path) && !SKIP_PATH_RE.test(b.path) && (b.size || 0) < 300000).slice(0, 80);
    const contents = {};
    let total = 0;
    const queue = [...textFiles];
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        if (total > 1500000) return;
        try {
          const r = await fetch(`https://api.github.com/repos/${slug}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`, {
            headers: { ...headers, Accept: 'application/vnd.github.raw' },
            signal: AbortSignal.timeout(10000)
          });
          if (!r.ok) continue;
          const text = await r.text();
          total += text.length;
          contents[f.path] = text;
        } catch {
          // skip file
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const corpusLower = Object.values(contents).join('\n').toLowerCase();
    const data = { repo: slug, branch, files, fileSet: new Set(files), contents, prNumbers, prState, corpusLower, fetchedAt: Date.now() };
    snapshotCache.set(key, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

// 한국어 업무 표현 → 실제 코드에서 찾을 단어
const CONCEPT_MAP = [
  [/광고|애드센스|adsense/i, ['adsbygoogle', 'ad-unit', 'data-ad-slot', 'monetization', 'adsense']],
  [/사이트맵|sitemap/i, ['sitemap']],
  [/robots/i, ['robots']],
  [/메타|SEO|검색\s*최적화|타이틀|description/i, ['<meta', 'canonical', 'og:title', 'description:']],
  [/GA4|애널리틱스|analytics|추적|gtag/i, ['gtag', 'ga4MeasurementId', 'googletagmanager']],
  [/서치\s*콘솔|search\s*console|소유권/i, ['google-site-verification']],
  [/푸터|하단|저작권|카피라이트|copyright/i, ['footer', 'copyright']],
  [/공유|share/i, ['share']],
  [/재계산|다시\s*계산|초기화|reset/i, ['reset']],
  [/모바일|반응형|미디어\s*쿼리/i, ['@media']],
  [/버튼/i, ['<button']],
  [/결과\s*(페이지|화면|영역)/i, ['result']],
  [/연말정산/i, ['year-end', 'yearend']],
  [/실수령|연봉/i, ['salary']],
  [/퇴직금/i, ['severance']],
  [/텔레그램/i, ['telegram']],
  [/결재/i, ['approval']],
  [/루틴/i, ['routine']],
  [/제휴|링크프라이스|숨고/i, ['partner', 'affiliate']]
];
const STOP = new Set(
  'the and for with from this that http https www com html css json yml yaml src dist main true false null undefined const let var function return import export default class new api url get post put patch pr prs github repo commit commits feat fix chore test docs page pages site file files code script scripts index node npm build deploy ceo ai it ui ux qa seo styles style margin padding width height color colors mobile media query value values data display block none auto font size border radius flex grid left right top bottom center text'.split(
    ' '
  )
);

/** 클래스가 실제로 쓰이는지(HTML class 속성·CSS 선택자·classList) 확인 — data-ad-slot 같은 속성명은 제외 */
function classExists(snapshot, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(class(Name)?\\s*=\\s*["'\`][^"'\`]*(?<![\\w-])${esc}(?![\\w-]))|(\\.${esc}(?![\\w-]))|(classList\\.(add|toggle|contains)\\(\\s*["'\`]${esc}["'\`])`);
  return Object.values(snapshot.contents || {}).some((c) => re.test(c));
}

function extractKeywords(text = '') {
  const t = String(text || '');
  const words = new Set();
  for (const m of t.matchAll(/`([^`\n]{2,60})`/g)) words.add(m[1].trim());
  for (const m of t.matchAll(/(?:^|[\s(])\.([a-z][\w-]{2,40})\b/g)) words.add(m[1]); // .class
  for (const m of t.matchAll(/\b([A-Za-z_][A-Za-z0-9_-]{3,40})\b/g)) {
    const w = m[1];
    if (STOP.has(w.toLowerCase())) continue;
    if (/^[A-Z]{2,5}$/.test(w)) continue;
    words.add(w);
  }
  for (const [re, terms] of CONCEPT_MAP) if (re.test(t)) terms.forEach((x) => words.add(x));
  return [...words].filter((w) => w.length >= 3 && w.length <= 60).slice(0, 18);
}

/**
 * 작업 내용과 관련된 실제 코드 줄을 찾아 근거 블록으로 반환.
 */
export function buildCodeEvidence(snapshot, text, { compact = false } = {}) {
  if (!snapshot || !snapshot.contents) return '';
  const keywords = extractKeywords(text);
  if (!keywords.length) return '';
  const maxSnippets = compact ? 8 : 16;
  const lines = [];
  const missing = [];
  const fileLines = Object.entries(snapshot.contents).map(([p, c]) => [p, c.split('\n')]);
  const mentionedPaths = [...String(text).matchAll(/([\w.-]+\/[\w./-]+\.(?:js|mjs|css|html|json|md))/g)].map((m) => m[1]);
  for (const p of new Set(mentionedPaths)) {
    if (!snapshot.fileSet.has(p)) missing.push(`파일 ${p}`);
  }
  let count = 0;
  for (const kw of keywords) {
    if (count >= maxSnippets) break;
    const needle = kw.toLowerCase();
    if (!snapshot.corpusLower.includes(needle)) {
      missing.push(kw);
      continue;
    }
    let perKw = 0;
    for (const [p, ls] of fileLines) {
      if (perKw >= (compact ? 1 : 2) || count >= maxSnippets) break;
      const idx = ls.findIndex((l) => l.toLowerCase().includes(needle));
      if (idx < 0) continue;
      const snippet = ls
        .slice(Math.max(0, idx - 1), idx + 2)
        .map((l) => l.trim().slice(0, 150))
        .filter(Boolean)
        .join(' ⏎ ');
      lines.push(`- "${kw}" → ${p}:${idx + 1}  ${snippet}`);
      perKw += 1;
      count += 1;
    }
  }
  if (!lines.length && !missing.length) return '';
  const out = [`[실제 코드 근거 — ${snapshot.repo}@${snapshot.branch}에서 작업 키워드로 직접 찾은 줄. 수정안의 "원본"은 반드시 여기서 인용]`];
  out.push(...lines);
  if (missing.length) out.push(`- 저장소 전체에서 찾지 못함(존재한다고 가정 금지): ${[...new Set(missing)].slice(0, 12).join(', ')}`);
  out.push(`- 전체 파일 ${snapshot.files.length}개. 위에 없는 코드 내용은 "미확인"으로 쓰고 추측하지 말 것.`);
  const text2 = out.join('\n');
  return text2.slice(0, compact ? 1800 : 3600);
}

const MEASURE_RE = /(lighthouse|라이트하우스|pagespeed|\bLCP\b|\bFCP\b|\bCLS\b|\bTTI\b|\bTBT\b|성능\s*점수|performance\s*score)[^\n]{0,20}?\d/i;
const SCREENSHOT_RE = /(스크린샷|screenshot|캡처)[^\n]{0,40}?[\w/-]+\.(png|jpe?g|webp)/i;
const DID_RE = /(PR(을|를)?\s*(생성|작성|만들|올리)|머지|병합|배포|푸시|커밋|업로드|설치|삽입|적용)\s*(했습니다|하였습니다|완료했습니다|완료하였습니다|해\s*두었습니다)/;
const NEW_FILE_HINT_RE = /(신규|새\s*파일|새로\s*(추가|생성|만들)|추가할|생성할|new file|create)/i;

/**
 * Deterministic fact check. Returns [{ type, detail }]
 * canExecute: IT 파이프라인처럼 실제 실행 권한이 있는 단계면 true (일반 팀원 결과물은 false)
 */
export function factCheckOutput(text, snapshot, { canExecute = false } = {}) {
  const out = String(text || '');
  const issues = [];
  if (!out) return issues;

  if (snapshot) {
    // 1) 존재하지 않는 파일 경로
    const seen = new Set();
    for (const m of out.matchAll(/(?:^|[\s`'"(|])((?:[\w.-]+\/)+[\w.-]+\.(?:js|mjs|cjs|ts|css|html|json|ya?ml|md|xml))(?=[\s`'")|:,]|$)/gm)) {
      const p = m[1].replace(/^\.\//, '');
      if (seen.has(p) || /^https?:/i.test(p) || /^(www\.|[\w-]+\.(com|net|io|org)\/)/.test(p)) continue;
      seen.add(p);
      if (snapshot.fileSet.has(p)) continue;
      const lineStart = out.lastIndexOf('\n', m.index) + 1;
      const lineEnd = out.indexOf('\n', m.index);
      const line = out.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
      if (NEW_FILE_HINT_RE.test(line)) continue;
      issues.push({ type: 'missing_file', detail: `저장소에 없는 파일 "${p}"을(를) 기존 파일처럼 다룸` });
    }
    // 2) 없는 PR 번호
    const prSeen = new Set();
    for (const m of out.matchAll(/PR\s*#\s*(\d{1,5})/gi)) {
      const n = Number(m[1]);
      if (prSeen.has(n)) continue;
      prSeen.add(n);
      if (snapshot.prNumbers.size && !snapshot.prNumbers.has(n)) issues.push({ type: 'missing_pr', detail: `${snapshot.repo}에 없는 PR #${n}을 언급` });
    }
    // 3) 저장소에 없는 CSS 클래스를 수정
    for (const block of out.matchAll(/```css\n([\s\S]*?)```/gi)) {
      const classes = new Set([...block[1].matchAll(/\.([a-zA-Z][\w-]{2,40})/g)].map((x) => x[1]));
      for (const cls of classes) {
        if (!classExists(snapshot, cls)) {
          issues.push({ type: 'missing_class', detail: `저장소 어디에도 없는 CSS 클래스 ".${cls}"를 수정(새 클래스라면 그 클래스를 쓰는 HTML 변경도 함께 제시해야 함)` });
        }
      }
    }
  }
  // 4) 도구 없이 지어낸 측정값·스크린샷
  if (MEASURE_RE.test(out)) issues.push({ type: 'fake_measurement', detail: 'Lighthouse·LCP 등 측정 도구가 없는데 측정값을 제시(“측정 불가”로 써야 함)' });
  if (SCREENSHOT_RE.test(out)) issues.push({ type: 'fake_screenshot', detail: '캡처 도구가 없는데 스크린샷 파일을 제시' });
  // 5) 실행 권한 없는 "했다" 보고
  if (!canExecute) {
    const m = out.match(DID_RE);
    if (m) issues.push({ type: 'claimed_action', detail: `팀원은 직접 커밋·PR·배포 권한이 없는데 "${m[0]}"라고 보고(제안/변경안으로 표현해야 함. 실제 반영은 IT팀 PR→대표님 결재)` });
  }
  // 중복 제거
  const uniq = [];
  const keys = new Set();
  for (const i of issues) {
    const k = `${i.type}:${i.detail}`;
    if (!keys.has(k)) {
      keys.add(k);
      uniq.push(i);
    }
  }
  return uniq.slice(0, 10);
}

export function formatFactIssues(issues = []) {
  return issues.map((i, n) => `${n + 1}. ${i.detail}`).join('\n');
}

/** 결과물이 "할 일 없음/이미 완료"를 말하는지 (빈 결재 상신 방지) */
export function saysNothingToDo(text = '') {
  return /(이미\s*(배포|완료|반영)(된|되어|돼)|추가\s*(배포|작업|수정)(은|이|는)?\s*불필요|수정\s*대상\s*(없음|이\s*없)|변경(할|이)?\s*(사항|내용)?\s*(없음|없습니다)|생성\s*불가|진행\s*불가|PR\s*(생성)?\s*보류)/.test(
    String(text || '').slice(0, 1500)
  );
}

/** 단순 중복 판단(제목 토큰 유사도) */
export function isNearDuplicate(a = '', b = '') {
  const tok = (s) =>
    new Set(
      String(s)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    );
  const A = tok(a);
  const B = tok(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / Math.min(A.size, B.size) >= 0.7;
}
