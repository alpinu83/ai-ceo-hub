// hub/system-audit.js: 총괄 팀장(AGY Hydrogen / Gemini 당직) 자율 시스템·운영 회고 및 개선 제안 엔진
//  1) 서버가 전사 운영 텔레메트리(봇별 반려·장기 대기·도구 한계·배정 불일치·대표님 개입)를 자동 집계 (비용 0원)
//  2) AGY 팀장 업무함(purpose: 'system_audit')에 회고 판단을 상정
//  3) 팀장 판단 결과가 도착하면 ① 회사 기억(교훈) 자동 학습, ② 회의실·텔레그램 브리핑, ③ 시스템 개선 결재 카드 자동 상신
//  4) 대표님이 개선 제안 카드를 1클릭 승인하면 사내 개발팀(AGY 구현 → Aside 검수) PR 작업으로 자동 배정
import { appendLog, flushCloudBackup, loadDb, saveDb, uid } from '../store.js';
import { leadSystemAudit } from '../orchestrator.js';
import { rememberFact } from '../lead-engine.js';
import { createOutsourcingRequest } from '../outsourcing.js';
import { getGithubRepoConfig } from '../it-devops.js';
import { kstParts } from '../operations.js';
import { sendTelegramReport } from '../telegram.js';
import { leadSay } from './missions.js';
import { notifyAllApprovalChannels } from './notify.js';
import { notifyOutsourceCreated } from './task-results.js';

const BOT_IDS = ['agent_cue', 'agent_pickle', 'agent_muse', 'agent_vooy', 'agent_instinct'];
const DEV_IDS = ['agent_aside', 'agent_agy'];
const RECURRING_RE = /(매일|일일|정기\s*(수집|브리핑|모니터링|점검)|반복\s*수집|주간\s*브리핑|모니터링\s*브리핑)/;
const LOGIN_OR_CODE_RE = /(로그인|콘솔|애드센스|adsense|서치\s*콘솔|search\s*console|\bGSC\b|\bGA4\b|유튜브\s*스튜디오|youtube\s*studio|비공개\s*업로드|PR\s*코드|코드\s*검수)/i;

function clip(s = '', n = 180) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function seenHours(db, agentId, now) {
  const aliases =
    agentId === 'agent_agy'
      ? [agentId, 'lead:agy_lead', 'worker:antigravity']
      : agentId === 'agent_aside'
        ? [agentId, 'worker:aside']
        : [agentId];
  const hrs = aliases
    .map((k) => db.agentConnections?.[k]?.lastSeenAt)
    .filter(Boolean)
    .map((iso) => (now - Date.parse(iso)) / 3600000)
    .filter((v) => Number.isFinite(v) && v >= 0);
  return hrs.length ? Number(Math.min(...hrs).toFixed(1)) : null;
}

/**
 * 1단계: 전사 운영 이상 신호 자동 집계 (순수 함수 · LLM 비용 0원)
 */
export function collectSystemAuditTelemetry(db, { windowHours = 48, now = Date.now() } = {}) {
  const windowMs = windowHours * 3600 * 1000;
  const agentsById = Object.fromEntries((db?.agents || []).map((a) => [a.id, a]));
  const missionsById = Object.fromEntries((db?.missions || []).map((m) => [m.id, m]));
  const tasks = Array.isArray(db?.tasks) ? db.tasks : [];
  const approvals = Array.isArray(db?.approvals) ? db.approvals : [];
  const leadJobs = Array.isArray(db?.leadJobs) ? db.leadJobs : [];
  const inWindow = (iso) => {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) && now - t <= windowMs;
  };
  const ageHours = (iso) => {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) ? Number(((now - t) / 3600000).toFixed(1)) : 0;
  };

  // 1) 봇/개발팀 활동·병목 현황
  const botStats = [];
  for (const id of [...BOT_IDS, ...DEV_IDS]) {
    const ag = agentsById[id];
    if (!ag?.active || ag.retired) continue;
    const mine = tasks.filter((t) => t.assigneeId === id);
    const open = mine.filter((t) => !['completed', 'rejected'].includes(t.status));
    const completedRecent = mine.filter((t) => t.status === 'completed' && inWindow(t.updatedAt || t.createdAt)).length;
    const revisionNeeded = open.filter(
      (t) =>
        ['awaiting_bridge', 'queued'].includes(t.status) &&
        (t.review?.verdict === 'revise' || t.leadFeedback?.verdict === 'revise' || Number(t.reviewRounds || 0) > 0)
    );
    const reviewPending = open.filter((t) => t.status === 'review_pending');
    const staleOpen = open.filter((t) => t.status === 'awaiting_bridge' && ageHours(t.updatedAt || t.createdAt) >= 4);
    const blocked = open.filter((t) => t.status === 'blocked');
    const lastSeenH = seenHours(db, id, now);
    botStats.push({
      id,
      name: ag.name,
      isDev: DEV_IDS.includes(id),
      lastSeenHours: lastSeenH,
      connectedRecently: lastSeenH !== null && lastSeenH <= 6,
      openCount: open.length,
      completedRecent,
      revisionNeededCount: revisionNeeded.length,
      reviewPendingCount: reviewPending.length,
      staleOpenCount: staleOpen.length,
      blockedCount: blocked.length,
      sampleStale: staleOpen.slice(0, 2).map((t) => `${t.id}(${clip(t.title, 45)}, ${ageHours(t.updatedAt || t.createdAt)}h)`),
      sampleRevisions: revisionNeeded.slice(0, 2).map((t) => `${t.id}(${clip(t.title, 45)}, ${Number(t.reviewRounds || 1)}차)`)
    });
  }

  // 2) 봇 도구 한계 보고(botReport) 및 한계 인정 통과(acceptedWithGaps) 패턴
  const limitationPatterns = tasks
    .filter((t) => (t.botReport && (t.botReport.limitations?.length || t.botReport.blockers?.length || t.botReport.questions?.length)) || t.review?.acceptedWithGaps)
    .filter((t) => inWindow(t.botReport?.reportedAt || t.review?.at || t.updatedAt))
    .slice(0, 12)
    .map((t) => ({
      taskId: t.id,
      missionTitle: missionsById[t.missionId]?.title || t.missionId || '',
      agentName: agentsById[t.botReport?.agentId || t.assigneeId]?.name || t.assigneeId,
      title: clip(t.title, 70),
      limitations: (t.botReport?.limitations || []).slice(0, 3),
      blockers: (t.botReport?.blockers || []).slice(0, 3),
      questions: (t.botReport?.questions || []).slice(0, 2),
      acceptedWithGaps: Boolean(t.review?.acceptedWithGaps),
      verdict: t.review?.verdict || t.status
    }));

  // 3) 배정 불일치·정체·쏠림 감지
  const assignmentMismatches = [];
  const vooyStat = botStats.find((b) => b.id === 'agent_vooy');
  for (const t of tasks) {
    if (['completed', 'rejected'].includes(t.status)) continue;
    const txt = `${t.title || ''} ${t.description || ''}`;
    if (BOT_IDS.includes(t.assigneeId) && LOGIN_OR_CODE_RE.test(txt)) {
      assignmentMismatches.push({
        type: 'login_or_code_on_bot',
        taskId: t.id,
        assignee: agentsById[t.assigneeId]?.name || t.assigneeId,
        title: clip(t.title, 65),
        detail: '로그인·스튜디오·GSC/GA4·코드 검수 성격 업무가 외부 봇에 배정됨'
      });
    }
    if (vooyStat?.connectedRecently && t.assigneeId !== 'agent_vooy' && BOT_IDS.includes(t.assigneeId) && RECURRING_RE.test(txt) && !LOGIN_OR_CODE_RE.test(txt)) {
      assignmentMismatches.push({
        type: 'recurring_not_on_vooy',
        taskId: t.id,
        assignee: agentsById[t.assigneeId]?.name || t.assigneeId,
        title: clip(t.title, 65),
        detail: '매일/일일/정기 반복 수집 업무가 부이(Vooy) 대신 다른 봇에 배정됨'
      });
    }
  }
  const activeBots = botStats.filter((b) => !b.isDev && b.connectedRecently);
  const idleBots = activeBots.filter((b) => b.openCount === 0);
  const overloadedBots = activeBots.filter((b) => b.openCount >= 5);
  if (idleBots.length && overloadedBots.length) {
    assignmentMismatches.push({
      type: 'load_imbalance',
      taskId: '',
      assignee: overloadedBots.map((b) => `${b.name}(${b.openCount}건)`).join(', '),
      title: `놀고 있는 봇: ${idleBots.map((b) => b.name).join(', ')}`,
      detail: '접속 중인 봇 간 업무량 편차가 큼'
    });
  }

  // 4) 최근 대표님 수동 개입·결재 반려·수정 지시
  const ceoRejections = approvals
    .filter((a) => ['rejected', 'revision_requested'].includes(a.status) && inWindow(a.decidedAt || a.createdAt))
    .slice(0, 8)
    .map((a) => ({
      approvalId: a.id,
      title: clip(a.title, 65),
      decision: a.status,
      ceoNote: clip(a.ceoNote || '사유 미입력', 140),
      decidedAt: a.decidedAt || a.createdAt
    }));
  const ceoDirectives = (db?.memory?.facts || [])
    .filter((f) => ['quick_order', 'directive', 'stage_gate'].includes(f.source) && inWindow(f.createdAt))
    .slice(0, 6)
    .map((f) => clip(f.text, 140));

  // 5) 보류·실패·만료 항목
  const blockedTasks = tasks
    .filter((t) => t.status === 'blocked')
    .slice(0, 8)
    .map((t) => ({
      taskId: t.id,
      assignee: agentsById[t.assigneeId]?.name || t.assigneeId,
      title: clip(t.title, 65),
      reason: clip(t.blockedReason || '사유 미기재', 120)
    }));
  const failedDeploys = approvals
    .filter((a) => ['ci_failed', 'merge_failed', 'deploy_failed'].includes(a.codeChange?.status) && inWindow(a.codeChange?.updatedAt || a.createdAt))
    .slice(0, 5)
    .map((a) => ({
      approvalId: a.id,
      title: clip(a.title, 65),
      status: a.codeChange?.status,
      error: clip(a.codeChange?.error || '', 120)
    }));
  const expiredLeadJobs = leadJobs.filter((j) => ['expired', 'invalid'].includes(j.status) && inWindow(j.updatedAt || j.createdAt)).length;
  const staleReviewPending = tasks.filter((t) => t.status === 'review_pending' && ageHours(t.updatedAt || t.createdAt) >= 1).length;

  const anomalyScore =
    botStats.reduce((sum, b) => sum + b.staleOpenCount + b.revisionNeededCount + b.blockedCount, 0) +
    limitationPatterns.length +
    assignmentMismatches.length +
    ceoRejections.length +
    failedDeploys.length +
    expiredLeadJobs +
    staleReviewPending;

  // 요약 마크다운 (팀장 프롬프트 입력용)
  const lines = [
    `[전사 운영 텔레메트리 — 최근 ${windowHours}시간 · 기준 ${kstParts(new Date(now)).date} ${kstParts(new Date(now)).time} KST]`,
    `- 총 이상 신호 지수: ${anomalyScore}건 (보류 ${blockedTasks.length} · 배정 불일치 ${assignmentMismatches.length} · 봇 한계 보고 ${limitationPatterns.length} · 대표님 반려/수정 ${ceoRejections.length} · 배포 실패 ${failedDeploys.length} · 팀장 업무함 만료 ${expiredLeadJobs} · 1시간+ 검수대기 ${staleReviewPending})`,
    '',
    '### 1. 봇·개발팀 가동 및 정체 현황',
    ...botStats.map(
      (b) =>
        `- ${b.name}: 최근접속 ${b.lastSeenHours === null ? '기록없음' : `${b.lastSeenHours}h전`} · 완료(${windowHours}h) ${b.completedRecent}건 · 대기 ${b.openCount}건 · 보완재제출대기 ${b.revisionNeededCount}건 · 4시간+정체 ${b.staleOpenCount}건 · 보류 ${b.blockedCount}건${b.sampleRevisions.length ? ` | 보완대기: ${b.sampleRevisions.join(', ')}` : ''}${b.sampleStale.length ? ` | 정체: ${b.sampleStale.join(', ')}` : ''}`
    )
  ];

  if (assignmentMismatches.length) {
    lines.push('', '### 2. 배정 불일치·쏠림 감지');
    for (const m of assignmentMismatches.slice(0, 8)) {
      lines.push(`- [${m.type}] ${m.taskId || '-'} (${m.assignee}) "${m.title}" — ${m.detail}`);
    }
  }
  if (limitationPatterns.length) {
    lines.push('', '### 3. 봇 도구 한계·차단 보고 패턴');
    for (const p of limitationPatterns.slice(0, 8)) {
      const details = [...p.limitations, ...p.blockers, ...p.questions].join(' / ');
      lines.push(`- [${p.taskId}] ${p.agentName} "${p.title}" (${p.acceptedWithGaps ? '한계반영통과' : p.verdict}) — ${clip(details || '한계 명시', 180)}`);
    }
  }
  if (ceoRejections.length || ceoDirectives.length) {
    lines.push('', '### 4. 대표님 수동 개입·반려·수정 지시');
    for (const r of ceoRejections) {
      lines.push(`- [결재 ${r.decision}] "${r.title}" — 대표님 메모: ${r.ceoNote}`);
    }
    for (const d of ceoDirectives) {
      lines.push(`- [대표님 직접 지시] ${d}`);
    }
  }
  if (blockedTasks.length || failedDeploys.length) {
    lines.push('', '### 5. 보류 업무 및 코드 배포 실패');
    for (const b of blockedTasks) lines.push(`- [보류 ${b.taskId}] (${b.assignee}) "${b.title}" — ${b.reason}`);
    for (const f of failedDeploys) lines.push(`- [배포실패 ${f.approvalId}] "${f.title}" (${f.status}) — ${f.error}`);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    windowHours,
    anomalyScore,
    botStats,
    limitationPatterns,
    assignmentMismatches,
    ceoRejections,
    ceoDirectives,
    blockedTasks,
    failedDeploys,
    expiredLeadJobs,
    staleReviewPending,
    summaryMarkdown: lines.join('\n').slice(0, 5000)
  };
}

// 전사 회고는 특정 사업 프로젝트 소속이 아님: CEO Office(ai-ceo-hub) 프로젝트 → 루틴 허브 순으로만 연결하고,
// 없으면 프로젝트 없이(missionId '') 처리한다. (임의의 첫 프로젝트에 붙이면 결재 카드·회의실 보고·개발 외주 요청서에
// 무관한 프로젝트 지침이 섞임)
function findHubMission(db) {
  return (
    (db.missions || []).find((m) => /ai-ceo-hub/i.test(m.githubRepo || '') || /CEO Office/i.test(m.title || '')) ||
    (db.missions || []).find((m) => m.isRoutineHub) ||
    null
  );
}

function normalizeTitleKey(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/^\[시스템 개선 제안\]\s*/i, '')
    .replace(/[^a-z0-9가-힣]+/g, '')
    .slice(0, 32);
}

function formatAuditReportMarkdown(audit, telemetry) {
  const statusLabel = audit.healthStatus === 'healthy' ? '🟢 양호' : audit.healthStatus === 'attention' ? '🟡 주의 필요' : '🔴 개선 조치 필요';
  const lines = [
    `## 🧭 총괄 팀장 전사 시스템·운영 회고 (${statusLabel})`,
    '',
    audit.executiveSummary || '전사 운영 회고를 완료했습니다.'
  ];
  if (Array.isArray(audit.findings) && audit.findings.length) {
    lines.push('', '### 발견한 운영·시스템 문제');
    for (const f of audit.findings) {
      const sev = f.severity === 'high' ? '🔴 높음' : f.severity === 'medium' ? '🟠 보통' : '🟡 낮음';
      lines.push(`- **[${sev} · ${f.area}] ${f.title}**`);
      if (f.evidence) lines.push(`  - 근거: ${f.evidence}`);
      if (f.rootCause) lines.push(`  - 원인: ${f.rootCause}`);
    }
  }
  if (Array.isArray(audit.lessonsToRemember) && audit.lessonsToRemember.length) {
    lines.push('', '### 회사 기억에 자동 학습한 운영 교훈');
    for (const l of audit.lessonsToRemember) lines.push(`- ${l}`);
  }
  if (Array.isArray(audit.improvementProposals) && audit.improvementProposals.length) {
    lines.push('', '### 대표님께 제안하는 시스템 개선 안건');
    for (const p of audit.improvementProposals) {
      lines.push(`- **[${p.priority.toUpperCase()} · ${p.needsCodeChange ? '코드 수정' : '운영 규칙'}]** ${p.title} — ${p.rationale}`);
    }
  }
  if (telemetry) {
    lines.push('', `_기준 텔레메트리: 최근 ${telemetry.windowHours}시간 · 이상 신호 ${telemetry.anomalyScore}건_`);
  }
  return lines.join('\n');
}

function resolveAllowedRepo(db, candidate = '') {
  const fallback = 'alpinu83/ai-ceo-hub';
  const clean = String(candidate || '').trim();
  const validFormat = /^[\w.-]+\/[\w.-]+$/.test(clean) ? clean : fallback;
  const cfg = getGithubRepoConfig(db?.settings || {});
  if (Array.isArray(cfg.allowedRepos) && cfg.allowedRepos.length > 0) {
    if (cfg.allowedRepos.includes(validFormat)) return validFormat;
    if (cfg.allowedRepos.includes(fallback)) return fallback;
    return cfg.allowedRepos[0];
  }
  return validFormat;
}

function applySystemAuditResult(db, record, audit, telemetry, { manual = false } = {}) {
  const nowIso = new Date().toISOString();
  const hubMission = findHubMission(db);

  // 1) 회사 기억에 운영 교훈 자동 저장 (재발 방지 학습)
  const learnedCount = (audit.lessonsToRemember || []).reduce((cnt, lesson) => {
    const clean = clip(lesson, 300);
    if (!clean) return cnt;
    rememberFact(db, {
      kind: 'lesson',
      missionId: '',
      pinned: false,
      text: `[팀장 시스템 회고] ${clean}`,
      source: 'system_audit'
    });
    return cnt + 1;
  }, 0);

  // 2) 시스템 개선 제안 → 대표님 1클릭 결재 카드 자동 생성 (중복 방지)
  const existingPendingKeys = new Set(
    (db.approvals || [])
      .filter((a) => a.kind === 'system_improvement' && a.status === 'pending')
      .map((a) => normalizeTitleKey(a.title))
  );
  const createdApprovals = [];
  for (const p of (audit.improvementProposals || []).slice(0, 3)) {
    const title = String(p?.title || '').trim();
    if (!title) continue;
    const key = normalizeTitleKey(title);
    if (!key || existingPendingKeys.has(key)) continue;
    existingPendingKeys.add(key);

    const targetRepo = resolveAllowedRepo(db, p.targetRepo);
    const leadBrief = [
      `## 문제 진단 및 배경`,
      p.rationale || audit.executiveSummary,
      '',
      `## 구체적 개선 방안`,
      p.concretePlan || title,
      p.risk ? `\n## 주의사항 및 하위 호환성\n${p.risk}` : '',
      '',
      `## 팀장 검토 의견`,
      `- 우선순위: **${p.priority || 'medium'}** · 유형: **${p.needsCodeChange ? `코드 개선 (${targetRepo})` : '운영 규칙/회사 고정 지침 반영'}**`,
      `- 대표님 승인 시 ${p.needsCodeChange ? '사내 개발팀(AGY 구현 → Aside 검수)에 바로 PR 작업이 배정됩니다.' : '회사 고정 지침(기억)에 자동 저장되어 전 팀원이 즉시 따릅니다.'}`
    ]
      .filter(Boolean)
      .join('\n');

    const apr = {
      id: uid('apr'),
      kind: 'system_improvement',
      missionId: hubMission?.id || '',
      taskId: '',
      taskIds: [],
      agentId: 'agent_gemini_neon',
      title: `[시스템 개선 제안] ${title}`.slice(0, 140),
      category: p.needsCodeChange ? '시스템 개선 (코드)' : '운영 규칙 개선',
      riskLevel: p.priority === 'high' ? 'high' : 'medium',
      estimatedCostKRW: 0,
      depositKRW: 0,
      summary: clip(p.rationale || audit.executiveSummary, 320),
      leadBrief,
      workerName: '총괄 팀장 (시스템 회고)',
      proposedAction: p.needsCodeChange
        ? `승인 시 사내 개발팀(AGY 구현 → Aside 검수)에 ${targetRepo} 개선 PR 작업을 자동 배정합니다.`
        : '승인 시 해당 운영 규칙을 회사 고정 지침(기억)에 자동 반영합니다.',
      status: 'pending',
      ceoNote: '',
      createdAt: nowIso,
      decidedAt: null,
      improvementProposal: {
        auditId: record.id,
        auditKey: record.auditKey,
        title,
        priority: p.priority || 'medium',
        needsCodeChange: Boolean(p.needsCodeChange),
        targetRepo,
        rationale: String(p.rationale || '').slice(0, 1000),
        concretePlan: String(p.concretePlan || '').slice(0, 2500),
        risk: String(p.risk || '').slice(0, 600)
      }
    };
    db.approvals.unshift(apr);
    createdApprovals.push(apr);
    notifyAllApprovalChannels(db.settings, apr, '총괄 팀장 (시스템 회고)');
  }

  // 3) 회고 이력 저장
  const markdown = formatAuditReportMarkdown(audit, telemetry);
  record.status = 'completed';
  record.completedAt = nowIso;
  record.healthStatus = audit.healthStatus;
  record.executiveSummary = audit.executiveSummary;
  record.findings = audit.findings || [];
  record.lessonsToRemember = audit.lessonsToRemember || [];
  record.improvementProposals = audit.improvementProposals || [];
  record.createdApprovalIds = createdApprovals.map((a) => a.id);
  record.learnedCount = learnedCount;
  record.reviewer = audit.reviewer || '';
  record.markdown = markdown;

  db.settings.lastSystemAudit = {
    id: record.id,
    auditKey: record.auditKey,
    at: nowIso,
    healthStatus: audit.healthStatus,
    executiveSummary: clip(audit.executiveSummary, 240),
    findingsCount: (audit.findings || []).length,
    proposalsCount: createdApprovals.length,
    learnedCount
  };

  // 4) 회의실 & 텔레그램 보고 (이상이 있거나 제안이 있거나 수동 실행일 때)
  const shouldNotify = manual || audit.healthStatus !== 'healthy' || createdApprovals.length > 0;
  if (hubMission && shouldNotify) {
    const roomSummary = [
      `[전사 시스템 회고 · ${audit.healthStatus}] ${audit.executiveSummary}`,
      createdApprovals.length ? `→ 결재함에 시스템 개선 제안 ${createdApprovals.length}건을 올렸습니다 (승인 시 개발팀 자동 배정).` : '',
      learnedCount ? `→ 운영 교훈 ${learnedCount}건을 회사 기억에 반영했습니다.` : ''
    ]
      .filter(Boolean)
      .join('\n');
    leadSay(db, hubMission, '팀장 시스템 회고', roomSummary);
  }
  if (shouldNotify) {
    sendTelegramReport(
      db.settings,
      `총괄 팀장 시스템 회고 (${audit.healthStatus})`,
      `${audit.executiveSummary}${createdApprovals.length ? `\n\n💡 개선 제안 결재 ${createdApprovals.length}건 상신:\n${createdApprovals.map((a) => `- ${a.title}`).join('\n')}` : ''}`,
      `sysaudit:${record.auditKey}`
    ).catch(() => {});
  }
  appendLog(
    db,
    '총괄 팀장 (시스템 회고)',
    `전사 운영 회고 완료 (${audit.healthStatus}) — 문제 ${(audit.findings || []).length}건, 교훈 ${learnedCount}건 학습, 개선 제안 결재 ${createdApprovals.length}건 상신.`,
    audit.healthStatus === 'action_needed' ? 'warning' : 'success'
  );

  // 루틴 상태 동기화
  const rtn = (db.routines || []).find((r) => r.kind === 'system_audit' || r.id === 'rtn_lead_system_audit');
  if (rtn) {
    rtn.lastStatus = audit.healthStatus === 'healthy' ? 'ok' : 'warning';
    rtn.lastResult = markdown;
    rtn.lastFinishedAt = nowIso;
  }

  return { record, createdApprovals, learnedCount, markdown };
}

// 같은 회고 키를 동시에 두 번 처리하지 않도록(답 제출 직후 훅과 1분 틱이 겹치는 경우 등) 진행 중인 키를 기억
const auditsInFlight = new Set();

/**
 * 2단계 실행: 전사 운영 회고를 시작 (팀장 업무함 대기 또는 즉시 완료)
 */
export async function runSystemAudit({ auditKey = '', manual = false, windowHours = 48 } = {}) {
  const db = loadDb();
  if (!Array.isArray(db.systemAudits)) db.systemAudits = [];
  const key =
    String(auditKey || '').trim() ||
    (manual ? `system_audit:manual:${Date.now().toString(36)}` : `system_audit:daily:${kstParts().date}`);
  const record = db.systemAudits.find((a) => a.auditKey === key);
  if (record?.status === 'completed') {
    return { ok: true, status: 'completed', audit: record, markdown: record.markdown || '' };
  }
  if (auditsInFlight.has(key)) {
    return {
      ok: true,
      status: 'pending',
      auditKey: key,
      telemetry: record?.telemetry || collectSystemAuditTelemetry(db, { windowHours }),
      result: '같은 전사 운영 회고가 이미 처리 중입니다.'
    };
  }
  auditsInFlight.add(key);
  try {
    return await runSystemAuditOnce({ db, key, record, manual, windowHours });
  } finally {
    auditsInFlight.delete(key);
  }
}

async function runSystemAuditOnce({ db, key, record, manual, windowHours }) {
  const telemetry = record?.telemetry || collectSystemAuditTelemetry(db, { windowHours });
  if (!record) {
    record = {
      id: uid('aud'),
      auditKey: key,
      manual: Boolean(manual),
      status: 'pending',
      jobId: '',
      createdAt: new Date().toISOString(),
      telemetry
    };
    db.systemAudits.unshift(record);
    db.systemAudits = db.systemAudits.slice(0, 15);
    saveDb(db);
  }

  const res = await leadSystemAudit({
    db,
    telemetry,
    auditKey: key,
    agents: db.agents,
    settings: db.settings
  });

  const fresh = loadDb();
  if (!Array.isArray(fresh.systemAudits)) fresh.systemAudits = [];
  const target = fresh.systemAudits.find((a) => a.auditKey === key) || record;
  if (!fresh.systemAudits.includes(target)) fresh.systemAudits.unshift(target);

  if (res.verdict === 'pending') {
    target.status = 'pending';
    target.jobId = res.pendingJobId || '';
    target.updatedAt = new Date().toISOString();
    appendLog(fresh, '총괄 팀장 (시스템 회고)', `전사 운영 회고 요청을 팀장 업무함에 올렸습니다 (${target.jobId || key}).`, 'info');
    saveDb(fresh);
    await flushCloudBackup(fresh);
    return {
      ok: true,
      status: 'pending',
      jobId: target.jobId,
      auditKey: key,
      telemetry,
      result: `전사 운영 텔레메트리(이상 신호 ${telemetry.anomalyScore}건)를 팀장 업무함에 올렸습니다. AGY 팀장이 분석을 마치면 개선 제안이 자동으로 보고됩니다.`
    };
  }

  if (res.skipped) {
    target.status = 'skipped';
    target.error = res.reason || 'AI 엔진 없음';
    target.updatedAt = new Date().toISOString();
    saveDb(fresh);
    return { ok: false, status: 'skipped', error: res.reason || '팀장 판단 엔진을 사용할 수 없습니다.', telemetry };
  }

  // 기다리는 사이 다른 경로가 이미 반영했으면 결재 카드·교훈·알림을 두 번 만들지 않음
  if (target.status === 'completed') {
    return { ok: true, status: 'completed', audit: target, markdown: target.markdown || '', result: target.markdown || '' };
  }
  const applied = applySystemAuditResult(fresh, target, res, telemetry, { manual: target.manual });
  saveDb(fresh);
  await flushCloudBackup(fresh);
  return {
    ok: true,
    status: 'completed',
    audit: applied.record,
    createdApprovalIds: applied.createdApprovals.map((a) => a.id),
    learnedCount: applied.learnedCount,
    result: applied.markdown
  };
}

/** 팀장 업무함(leadJobs)에 system_audit 답이 도착하면 이어서 적용 */
export async function resumeSystemAudit(auditKey) {
  if (!auditKey) return null;
  return runSystemAudit({ auditKey });
}

/**
 * 3단계: 대표님이 [시스템 개선 제안] 결재 카드를 승인/보완/반려했을 때 자동 후속 조치
 */
export async function handleSystemImprovementDecision(apr, decision, ceoNote = '') {
  const db = loadDb();
  const liveApr = (db.approvals || []).find((a) => a.id === apr.id) || apr;
  const p = liveApr?.improvementProposal;
  if (!p) return { ok: false, db };
  const memo = String(ceoNote || '').trim();
  const hubMission = findHubMission(db);

  if (decision === 'approved') {
    if (p.needsCodeChange) {
      const targetRepo = resolveAllowedRepo(db, p.targetRepo);
      const goal = [
        `[총괄 팀장 시스템 회고 개선 제안 → 대표님 승인] ${p.title}`,
        '',
        '## 문제 배경',
        p.rationale || liveApr.summary || '',
        '',
        '## 구현·개선 범위',
        p.concretePlan || p.title,
        p.risk ? `\n## 주의사항·호환성\n${p.risk}` : '',
        memo ? `\n## 대표님 추가 메모 (필수 반영)\n${memo}` : ''
      ]
        .filter(Boolean)
        .join('\n');
      const { request, created } = createOutsourcingRequest(db, {
        kind: 'code',
        worker: 'antigravity',
        pinnedWorker: 'antigravity',
        codeWorkflow: 'agy_then_aside',
        missionId: liveApr.missionId || hubMission?.id || '',
        approvalId: liveApr.id,
        repo: targetRepo,
        branch: 'main',
        title: `[시스템 개선] ${p.title}`.slice(0, 120),
        goal,
        reason: '총괄 팀장 시스템 회고 제안 → 대표님 승인 → AGY 구현 → Aside 검수',
        createdBy: 'CEO'
      });
      liveApr.dispatchedOutsourceId = request.id;
      if (created) notifyOutsourceCreated(db, request);
      rememberFact(db, {
        kind: 'decision',
        missionId: '',
        pinned: false,
        text: `[시스템 개선 승인·개발 착수] ${p.title}${memo ? ` (대표님: ${memo})` : ''} → 개발팀(${request.id}) 배정`,
        source: 'system_improvement'
      });
      appendLog(db, '개발팀', `시스템 개선 제안 승인 → AGY 구현 · Aside 검수 배정 (${request.id}): "${p.title}"`, 'success');
    } else {
      rememberFact(db, {
        kind: 'directive',
        missionId: '',
        pinned: true,
        text: `[승인된 운영 규칙] ${p.title}: ${clip(p.concretePlan || p.rationale, 260)}${memo ? ` (대표님 메모: ${memo})` : ''}`,
        source: 'system_improvement'
      });
      if (hubMission) {
        leadSay(db, hubMission, '운영 규칙 반영', `대표님 승인으로 운영 규칙 "${p.title}"을 회사 고정 지침에 반영했습니다.`);
      }
      appendLog(db, '총괄 팀장', `운영 규칙 개선 승인 → 회사 고정 지침 반영: "${p.title}"`, 'success');
    }
  } else {
    rememberFact(db, {
      kind: 'decision',
      missionId: '',
      pinned: false,
      text: `[시스템 개선 제안 ${decision === 'revision_requested' ? '보완 요청' : '반려'}] ${p.title}${memo ? ` — 대표님 의견: ${memo}` : ''}`,
      source: 'system_improvement'
    });
    appendLog(db, '총괄 팀장', `시스템 개선 제안 ${decision === 'revision_requested' ? '보완 요청' : '반려'} 기록: "${p.title}"`, 'info');
  }

  saveDb(db);
  await flushCloudBackup(db);
  return { ok: true, db };
}
