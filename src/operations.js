/**
 * Company operations: routine (recurring) work, scheduled system checks, daily CEO briefing.
 * Pure helpers only — server.js wires them to the DB, agents and Telegram.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

export function kstParts(date = new Date()) {
  const k = new Date(date.getTime() + KST_OFFSET_MS);
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mm = String(k.getUTCMinutes()).padStart(2, '0');
  return {
    date: k.toISOString().slice(0, 10),
    time: `${hh}:${mm}`,
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
    weekday: k.getUTCDay()
  };
}

export function normalizeTimes(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/);
  const out = [];
  for (const item of list) {
    const m = String(item).trim().match(/^(\d{1,2}):?(\d{2})$/);
    if (!m) continue;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) continue;
    out.push(`${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`);
  }
  return [...new Set(out)].sort();
}

export function normalizeDays(raw) {
  if (raw === 'weekdays') return [1, 2, 3, 4, 5];
  if (raw === 'daily' || raw === undefined || raw === null || raw === '') return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/);
  return [...new Set(list.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
}

export function describeSchedule(routine) {
  const times = (routine.times || []).join(', ') || '시간 미정';
  const days = routine.days || [];
  let dayText = '매일';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) dayText = '평일';
  else if (days.length) dayText = `매주 ${days.map((d) => DAY_LABELS[d]).join('·')}`;
  return `${dayText} ${times}`;
}

/**
 * Slots that are due now. A slot stays catchable for 90 minutes so a sleeping/restarting server doesn't skip it.
 */
export function dueSlotKeys(routine, now = new Date()) {
  if (!routine?.enabled) return [];
  const k = kstParts(now);
  if (routine.days?.length && !routine.days.includes(k.weekday)) return [];
  const done = new Set(routine.runKeys || []);
  const due = [];
  for (const t of routine.times || []) {
    const [h, m] = t.split(':').map(Number);
    const slotMin = h * 60 + m;
    const diff = k.minutes - slotMin;
    if (diff < 0 || diff > 90) continue;
    const key = `${k.date} ${t}`;
    if (!done.has(key)) due.push(key);
  }
  return due;
}

export function buildDefaultRoutines(missions = []) {
  const now = new Date().toISOString();
  const tax = missions.find((m) => /kr-calc-hub/.test(m.githubRepo || '') || /korea-tax-cal/i.test(m.title || ''));
  const office = missions.find((m) => /ai-ceo-hub/.test(m.githubRepo || '') || /CEO Office/i.test(m.title || ''));
  const base = {
    enabled: true,
    notify: 'anomaly',
    lastRunAt: null,
    lastStatus: '',
    lastResult: '',
    lastTaskId: '',
    runKeys: [],
    runCount: 0,
    system: true,
    createdAt: now
  };
  const list = [
    {
      ...base,
      id: 'rtn_ops_am',
      kind: 'ops_check',
      title: '오전 정기 점검',
      description: '라이브 사이트 응답, 배포(GitHub Actions) 결과, 멈춘 업무, 오래된 결재, AI 엔진 한도, 백업 상태를 점검합니다. 이상이 있을 때만 텔레그램으로 알립니다.',
      times: ['10:00'],
      days: []
    },
    {
      ...base,
      id: 'rtn_daily_close',
      kind: 'briefing',
      title: '저녁 정기 점검 · 일일 마감 보고',
      description: '오늘 완료된 업무, 결재 현황, 실제 배포, 이상 징후를 정리해 대표님께 텔레그램으로 보고합니다.',
      times: ['19:00'],
      days: [],
      notify: 'always'
    },
    {
      ...base,
      id: 'rtn_lead_system_audit',
      kind: 'system_audit',
      title: '총괄 팀장 일일 시스템·운영 회고 및 개선 제안',
      description:
        '전사 봇 정체·반복 반려·도구 한계·배정 불일치·대표님 수동 개입 이력을 총괄 팀장(AGY Hydrogen)이 스스로 회고해 회사 기억에 교훈을 학습하고, 코드·규칙 개선안을 대표님 결재함으로 선제 제안합니다.',
      times: ['21:00'],
      days: [],
      notify: 'anomaly'
    }
  ];
  if (tax) {
    list.push({
      ...base,
      id: 'rtn_tax_weekly',
      kind: 'task',
      title: '주간 korea-tax-cal.com 사이트 점검·개선안',
      description:
        '라이브 사이트와 kr-calc-hub 저장소를 실제로 확인해 깨진 링크, 메타태그·구조화 데이터, 계산기 오류 가능성, 광고 배치 문제를 찾고 바로 반영할 수 있는 수정안을 파일 경로와 함께 제시하세요. 수치·트래픽은 연동되지 않았으면 추정하지 마세요.',
      times: ['09:30'],
      days: [1],
      missionId: tax.id,
      assigneeId: 'agent_aside'
    });
  }
  if (office) {
    list.push({
      ...base,
      id: 'rtn_office_weekly',
      kind: 'task',
      title: '주간 CEO Office 자체 보안·안정성 점검',
      description:
        'ai-ceo-hub 저장소의 실제 코드를 기준으로 인증·토큰 노출·에러 처리·멈춤 가능성을 점검하고, 바로 반영할 수 있는 수정안을 파일 경로와 함께 제시하세요.',
      times: ['10:30'],
      days: [1],
      missionId: office.id,
      assigneeId: 'agent_aside'
    });
  }
  return list;
}

const withTimeout = (ms) => AbortSignal.timeout(ms);

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: withTimeout(20000) });
    return { url, ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (err) {
    return { url, ok: false, status: 0, ms: Date.now() - started, error: String(err?.message || err).slice(0, 80) };
  }
}

/**
 * Deterministic health check (no AI quota needed).
 */
export async function runOpsCheck({ db, githubToken = '', repos = [], aiHealth = { cooldowns: [] }, cloudStatus = {}, selfUrl = '' }) {
  const anomalies = [];
  const lines = [];
  const now = Date.now();

  // 1. Live sites
  const urls = new Set();
  if (selfUrl) urls.add(`${selfUrl.replace(/\/$/, '')}/api/health`);
  for (const m of db.missions || []) if (m.siteUrl) urls.add(m.siteUrl);
  const probes = await Promise.all([...urls].map(probe));
  lines.push('### 1. 라이브 사이트 응답');
  lines.push('| 주소 | 결과 | 응답시간 |', '|---|---|---|');
  for (const p of probes) {
    lines.push(`| ${p.url} | ${p.ok ? `정상 (${p.status})` : `**이상** (${p.status || p.error})`} | ${p.ms}ms |`);
    if (!p.ok) anomalies.push(`사이트 응답 이상: ${p.url} (${p.status || p.error})`);
    else if (p.ms > 8000) anomalies.push(`사이트 응답 느림: ${p.url} (${p.ms}ms)`);
  }

  // 2. Deploy pipelines
  lines.push('', '### 2. 배포 파이프라인 (GitHub Actions 최근 결과)');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-ceo-hub-ops' };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  for (const repo of repos) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?branch=main&per_page=10`, { headers, signal: withTimeout(15000) });
      if (!res.ok) {
        lines.push(`- ${repo}: 조회 불가 (${res.status})`);
        continue;
      }
      const data = await res.json();
      const latestByName = new Map();
      for (const r of data.workflow_runs || []) if (!latestByName.has(r.name)) latestByName.set(r.name, r);
      const parts = [];
      for (const [name, r] of latestByName) {
        const label = r.status !== 'completed' ? '진행 중' : r.conclusion;
        parts.push(`${name}: ${label}`);
        if (r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion)) {
          anomalies.push(`배포 실패: ${repo} · ${name} (${r.html_url})`);
        }
      }
      lines.push(`- ${repo}: ${parts.join(' / ') || '실행 기록 없음'}`);
    } catch (err) {
      lines.push(`- ${repo}: 조회 오류 (${String(err?.message || err).slice(0, 60)})`);
    }
  }

  // 3. Work queue
  const tasks = db.tasks || [];
  const ageMin = (iso) => (iso ? Math.round((now - new Date(iso).getTime()) / 60000) : 0);
  const stuck = tasks.filter((t) => t.status === 'running' && ageMin(t.updatedAt) > 20);
  const queuedOld = tasks.filter((t) => t.status === 'queued' && ageMin(t.updatedAt) > 60 && ageMin(t.updatedAt) < 3 * 24 * 60);
  const pendingApr = (db.approvals || []).filter((a) => a.status === 'pending');
  const oldApr = pendingApr.filter((a) => ageMin(a.createdAt) > 24 * 60);
  const codeFail = (db.approvals || []).filter((a) => ['ci_failed', 'merge_failed', 'deploy_failed'].includes(a.codeChange?.status) && ageMin(a.codeChange?.updatedAt) < 24 * 60);
  lines.push('', '### 3. 업무·결재 큐');
  lines.push(`- 실행 중 멈춤(20분 이상): ${stuck.length}건${stuck.length ? ` — ${stuck.slice(0, 3).map((t) => t.title).join(', ')}` : ''}`);
  lines.push(`- 1시간 넘게 대기 중인 업무: ${queuedOld.length}건`);
  lines.push(`- 결재 대기: ${pendingApr.length}건 (24시간 넘은 건 ${oldApr.length}건)`);
  lines.push(`- 최근 24시간 코드 반영 실패: ${codeFail.length}건`);
  if (stuck.length) anomalies.push(`멈춘 업무 ${stuck.length}건 (자동 복구 대상)`);
  if (oldApr.length) anomalies.push(`24시간 넘은 결재 대기 ${oldApr.length}건`);
  for (const a of codeFail) anomalies.push(`코드 반영 실패: ${a.title} (${a.codeChange.status})`);

  // 4. AI engines
  lines.push('', '### 4. AI 엔진 한도');
  if (aiHealth.cooldowns?.length) {
    for (const c of aiHealth.cooldowns) lines.push(`- ${c.provider}${c.model && c.model !== '*' ? `:${c.model}` : ''} — ${c.reason}, ${new Date(c.until).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}까지 쉬는 중`);
    const providers = new Set(aiHealth.cooldowns.map((c) => c.provider));
    if (providers.size >= 3) anomalies.push(`AI 엔진 ${providers.size}곳이 한도 초과로 쉬는 중 — 업무 처리가 늦어질 수 있음`);
  } else {
    lines.push('- 모든 엔진 정상 (한도 초과 없음)');
  }

  // 5. Backup
  lines.push('', '### 5. 데이터 백업');
  if (cloudStatus.enabled) {
    lines.push(`- 클라우드 백업 사용 중 · 마지막 동기화 ${cloudStatus.lastSyncAt ? new Date(cloudStatus.lastSyncAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음'}${cloudStatus.error ? ` · 오류: ${cloudStatus.error}` : ''}`);
    if (cloudStatus.error) anomalies.push(`클라우드 백업 오류: ${cloudStatus.error}`);
  } else {
    lines.push('- 클라우드 백업 꺼짐 (서버 재시작 시 데이터 유실 위험)');
    anomalies.push('클라우드 백업이 꺼져 있음');
  }

  // 6. Warnings in logs
  const warn24 = (db.logs || []).filter((l) => l.level === 'warning' && ageMin(l.timestamp) < 24 * 60);
  lines.push('', `### 6. 최근 24시간 경고 로그: ${warn24.length}건`);
  for (const l of warn24.slice(0, 5)) lines.push(`- ${l.actor}: ${String(l.message).slice(0, 120)}`);

  const status = anomalies.length ? 'warning' : 'ok';
  const header = anomalies.length
    ? `**이상 ${anomalies.length}건**\n${anomalies.map((a) => `- ${a}`).join('\n')}\n`
    : '**이상 없음** — 모든 점검 항목 정상';
  return { status, anomalies, markdown: `${header}\n\n${lines.join('\n')}` };
}

export function buildDailyBriefing({ db, ops = null, companyName = 'CEO Office' }) {
  const today = kstParts().date;
  const isToday = (iso) => iso && kstParts(new Date(iso)).date === today;
  const missionsById = Object.fromEntries((db.missions || []).map((m) => [m.id, m]));
  const done = (db.tasks || []).filter((t) => t.status === 'completed' && isToday(t.updatedAt));
  const decided = (db.approvals || []).filter((a) => a.status !== 'pending' && isToday(a.decidedAt));
  const pending = (db.approvals || []).filter((a) => a.status === 'pending');
  const deployed = (db.approvals || []).filter(
    (a) => ['merged', 'deployed'].includes(a.codeChange?.status) && isToday(a.codeChange?.updatedAt)
  );
  const running = (db.tasks || []).filter((t) => ['queued', 'running'].includes(t.status));

  const md = [];
  md.push(`## ${companyName} 일일 마감 보고 (${today})`);
  md.push('', `### 오늘 완료한 업무 ${done.length}건`);
  for (const t of done.slice(0, 10)) md.push(`- ${t.title} · ${missionsById[t.missionId]?.title || ''}`);
  if (done.length > 10) md.push(`- 외 ${done.length - 10}건`);
  md.push('', `### 실제 배포 ${deployed.length}건`);
  for (const a of deployed) md.push(`- ${a.title} (${a.repo}, ${a.codeChange.status === 'deployed' ? '배포 완료 확인' : '머지 완료'})`);
  md.push('', `### 결재 처리 ${decided.length}건 · 대기 ${pending.length}건`);
  for (const a of pending.slice(0, 6)) md.push(`- [대기] ${a.title}`);
  md.push('', `### 진행 중·대기 업무 ${running.length}건`);
  if (ops) {
    md.push('', `### 시스템 점검: ${ops.status === 'ok' ? '이상 없음' : `이상 ${ops.anomalies.length}건`}`);
    for (const a of ops.anomalies.slice(0, 6)) md.push(`- ${a}`);
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tg = [
    `<b>${esc(companyName)} 일일 마감 (${today})</b>`,
    `완료 업무 ${done.length}건 · 배포 ${deployed.length}건 · 결재 대기 ${pending.length}건`,
    ...done.slice(0, 5).map((t) => `• ${esc(t.title)}`),
    ...(deployed.length ? ['', '<b>배포</b>', ...deployed.slice(0, 3).map((a) => `• ${esc(a.title)}`)] : []),
    ...(pending.length ? ['', '<b>결재 대기</b>', ...pending.slice(0, 3).map((a) => `• ${esc(a.title)}`)] : []),
    ...(ops && ops.anomalies.length ? ['', '<b>이상 징후</b>', ...ops.anomalies.slice(0, 4).map((a) => `• ${esc(a)}`)] : ['', ops ? '시스템 점검: 이상 없음' : ''])
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .slice(0, 3800);

  return { markdown: md.join('\n'), telegramHtml: tg };
}
