// hub/deliverables.js: 결재 안건의 성과품(시안·계획서·외주 결과·PR)을 마크다운 문서 하나로 묶습니다.
// 텔레그램 결재 카드의 [📎 성과품 받기] 버튼과 /doc 명령이 이 문서를 파일로 보내, 대표님이 결재 전에 실제 결과물을 볼 수 있게 합니다.
// db를 인자로 받는 순수 함수라 저장소(store)를 건드리지 않습니다.

import { CHECKLIST_CORE_MAX, checklistKey, completedChecklistKeys, extractChecklistItems, refineChecklistItems } from '../lead-engine.js';

const MAX_SECTION = 12000;
const MAX_DOC = 60000;

function clip(text, max = MAX_SECTION) {
  const s = String(text || '').trim();
  return s.length > max ? `${s.slice(0, max)}\n\n…(이하 ${s.length - max}자 생략 · 전문은 웹 결재함에서 확인)` : s;
}

function asText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map((x, i) => `${i + 1}. ${asText(x)}`).join('\n');
  if (typeof v === 'object') return v.title || v.name || v.filename || v.path || JSON.stringify(v);
  return String(v);
}

function fileList(v) {
  if (!Array.isArray(v)) return asText(v);
  return v.map((f) => `- ${typeof f === 'string' ? f : f?.filename || f?.path || f?.name || JSON.stringify(f)}`).join('\n');
}

function tryParseJsonLoose(raw = '') {
  const txt = String(raw || '').trim();
  if (!txt || (txt[0] !== '{' && txt[0] !== '[')) return null;
  try {
    return JSON.parse(txt);
  } catch {
    try {
      return JSON.parse(txt.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

function shortsScriptToMarkdown(obj) {
  const scenes = (Array.isArray(obj.scenes) ? obj.scenes : []).filter((s) => s && String(s.text || '').trim());
  const sources = (Array.isArray(obj.sources) ? obj.sources : []).map((u) => String(u || '').trim()).filter(Boolean);
  const hashtags = (Array.isArray(obj.hashtags) ? obj.hashtags : []).map((h) => String(h || '').trim()).filter(Boolean);
  const lines = [`### 🎬 쇼츠 대본: ${obj.title || '제목 없음'} (${scenes.length}장면)`, ''];
  scenes.forEach((s, i) => {
    lines.push(`${i + 1}. ${String(s.text).trim()}`);
    if (s.keywords) lines.push(`   - _배경 키워드: ${String(s.keywords).trim()}_`);
  });
  if (sources.length) {
    lines.push('', '**출처 기사**');
    for (const u of sources) lines.push(`- ${u}`);
  }
  if (hashtags.length) {
    lines.push('', `**해시태그**: ${hashtags.join(' ')}`);
  }
  lines.push('', '<details>', '<summary>자동 제작용 원본 JSON 보기</summary>', '', '```json', JSON.stringify(obj, null, 2), '```', '</details>');
  return lines.join('\n');
}

export function formatDeliverableOutput(raw = '') {
  let text = String(raw || '').trim();
  if (!text) return '';
  let formattedShorts = false;
  text = text.replace(/```(?:json)?\s*\r?\n?([\s\S]*?)```/gi, (match, inner) => {
    const obj = tryParseJsonLoose(inner);
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.title === 'string' && Array.isArray(obj.scenes) && obj.scenes.some((s) => s && String(s.text || '').trim())) {
      formattedShorts = true;
      return shortsScriptToMarkdown(obj);
    }
    if (obj && !String(inner || '').trim().includes('\n') && String(inner || '').length > 100) {
      return `\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\``;
    }
    return match;
  });
  if (!formattedShorts) {
    const bareStart = text.lastIndexOf('{"title"');
    const bareEnd = text.lastIndexOf('}');
    if (bareStart >= 0 && bareEnd > bareStart) {
      const obj = tryParseJsonLoose(text.slice(bareStart, bareEnd + 1));
      if (obj && typeof obj.title === 'string' && Array.isArray(obj.scenes) && obj.scenes.some((s) => s && String(s.text || '').trim())) {
        text = `${text.slice(0, bareStart).trimEnd()}\n\n${shortsScriptToMarkdown(obj)}${text.slice(bareEnd + 1)}`;
      }
    }
  }
  return text;
}

/**
 * 결재 안건의 대표님 체크리스트를 새 추출 규칙과 같은 기준으로 정제합니다.
 * - 저장된 apr.checklist(옛 규칙으로 12건씩 쌓인 것 포함)도 다시 걸러, 완료([x])·'해당 없음'·표 헤더·개발 기술 항목이 재노출되지 않게 합니다.
 * - 완료 여부는 문자열만으로 알 수 없으므로, 연결된 산출물 원문에서 완료 표시된 항목 키를 모아 함께 제외합니다.
 */
function refineApprovalChecklist(storedItems, sourceTexts = []) {
  const excludeKeys = new Set();
  const candidates = [...(Array.isArray(storedItems) ? storedItems : [])];
  for (const text of sourceTexts) {
    if (!String(text || '').trim()) continue;
    for (const k of completedChecklistKeys(text)) excludeKeys.add(k);
    candidates.push(...extractChecklistItems(text, CHECKLIST_CORE_MAX));
  }
  return refineChecklistItems(candidates, { max: CHECKLIST_CORE_MAX, excludeKeys });
}

/**
 * 코드 PR·개발 설계·시스템 개선 결재인지.
 * 이 결재들은 본문·팀장 보고서·PR 정보만으로 판단하므로, 미션의 최근 산출물(예: 쇼츠 대본)을 자동으로 붙이지 않습니다.
 */
export function isCodeLikeApproval(apr) {
  return Boolean(
    apr &&
      (apr.prUrl ||
        apr.prNumber ||
        apr.codeChange ||
        apr.kind === 'it_pr_merge' ||
        apr.kind === 'dev_design' ||
        apr.kind === 'system_improvement' ||
        apr.category === 'dev')
  );
}

/** 미션·마일스톤 산출물을 자동으로 이어 붙이는 결재 유형: 관문·다음 단계·성과품 확인만 */
const MISSION_OUTPUT_KINDS = new Set(['stage_gate', 'next_phase', 'deliverable_review']);

/**
 * 코드 결재에서 "명시적으로 연결된" 업무 ID 목록. 예전 규칙(연결 업무가 없으면 미션 최근 산출물 자동 연결)으로
 * 잘못 붙어 저장된 taskIds를 걸러낼 때 씁니다.
 * - 외부 개발팀 PR(outsourceId)·개발 설계·시스템 개선 결재: 원래 외주 요청의 taskId만 명시적 연결로 인정
 * - 코드 번들 PR(팀 결정 업무 taskIds로 직접 생성, outsourceId 없음)·taskId가 있는 결재: 저장된 값 유지(null 반환)
 */
function explicitCodeApprovalTaskIds(db, apr) {
  if (!isCodeLikeApproval(apr) || apr.taskId) return null;
  const external = Boolean(apr.outsourceId || apr.designRequestId || apr.kind === 'dev_design' || apr.kind === 'system_improvement');
  if (!external) return null;
  const ids = new Set();
  for (const r of db?.outsourcing || []) {
    if (!r?.taskId) continue;
    if ((apr.outsourceId && r.id === apr.outsourceId) || (apr.designRequestId && r.id === apr.designRequestId)) ids.add(r.taskId);
  }
  return ids;
}

/** 결재에 명시적으로 연결된 업무 ID (taskId + taskIds, 코드 결재에 잘못 붙어 저장된 항목은 제외) */
function linkedApprovalTaskIds(db, apr) {
  const ids = [];
  if (apr?.taskId) ids.push(apr.taskId);
  for (const id of Array.isArray(apr?.taskIds) ? apr.taskIds : []) if (id && !ids.includes(id)) ids.push(id);
  const explicit = explicitCodeApprovalTaskIds(db, apr);
  return explicit ? ids.filter((id) => explicit.has(id)) : ids;
}

/** 저장된 체크리스트에서, 잘못 붙었다가 빠진 업무(무관한 성과품)에서 나온 항목을 제외 */
function storedChecklistWithoutStale(db, apr) {
  const stored = Array.isArray(apr?.checklist) ? apr.checklist : [];
  if (!stored.length) return stored;
  const kept = new Set(linkedApprovalTaskIds(db, apr));
  const staleKeys = new Set();
  for (const id of Array.isArray(apr?.taskIds) ? apr.taskIds : []) {
    if (!id || kept.has(id)) continue;
    const t = (db?.tasks || []).find((x) => x.id === id);
    for (const item of extractChecklistItems(t?.output || '', CHECKLIST_CORE_MAX)) {
      const k = checklistKey(item);
      if (k) staleKeys.add(k);
    }
  }
  return staleKeys.size ? stored.filter((c) => !staleKeys.has(checklistKey(c))) : stored;
}

/** 결재 안건과 연결된 업무 ID들: 단일 업무, 묶음(PR·성과품) 업무, 관문/다음단계 결재면 그 업무의 최근 결과물 */
export function relatedTaskIds(db, apr) {
  const ids = new Set(linkedApprovalTaskIds(db, apr));
  if ((apr?.kind === 'stage_gate' || apr?.kind === 'next_phase') && apr.missionId && !isCodeLikeApproval(apr)) {
    const mission = (db.missions || []).find((m) => m.id === apr.missionId);
    for (const d of (mission?.deliverables || []).slice(0, 6)) if (d?.taskId) ids.add(d.taskId);
  }
  return [...ids];
}

/**
 * 모든 결재 안건에 관련 성과품(taskIds)과 체크리스트(checklist)를 자동 첨부하고 번들 문서를 반환합니다.
 * - 단일 업무 결재, 관문 결재, 다음 단계 제안, 코드 PR, 외주/MCP 결재 등 모든 결재 유형에 공통 적용됩니다.
 * - 미션 산출물 자동 연결은 관문·다음 단계·성과품 확인 결재에만 합니다. 코드 PR·개발 설계·시스템 개선·일반 단독 결재는
 *   명시적으로 연결된 업무(taskId/taskIds)만 첨부하고, 예전 규칙으로 코드 결재에 잘못 붙은 업무는 정리합니다.
 */
export function enrichApprovalDeliverables(db, apr) {
  if (!db || !apr) return { changed: false, deliverable: null };
  let changed = false;

  const storedCk = storedChecklistWithoutStale(db, apr);
  const idSet = new Set(linkedApprovalTaskIds(db, apr));

  // 관문/다음단계/성과품 확인 결재만 해당 마일스톤·미션의 최근 산출물(deliverables 또는 완료된 산출물)을 자동 연결
  const shouldAttachMissionOutputs = apr.missionId && MISSION_OUTPUT_KINDS.has(apr.kind) && !isCodeLikeApproval(apr);
  if (shouldAttachMissionOutputs) {
    const mission = (db.missions || []).find((m) => m.id === apr.missionId);
    if (mission) {
      if (apr.milestoneId) {
        const msTasks = (db.tasks || [])
          .filter((t) => t.missionId === mission.id && t.milestoneId === apr.milestoneId && String(t.output || '').trim())
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
          .slice(0, 5);
        for (const t of msTasks) idSet.add(t.id);
      }
      for (const d of (mission.deliverables || []).slice(0, 6)) {
        if (d?.taskId) idSet.add(d.taskId);
      }
      if (idSet.size === 0) {
        const recentOutputs = (db.tasks || [])
          .filter(
            (t) =>
              t.missionId === mission.id &&
              ['completed', 'awaiting_approval'].includes(t.status) &&
              String(t.output || '').trim().length >= 80
          )
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
          .slice(0, 4);
        for (const t of recentOutputs) idSet.add(t.id);
      }
    }
  }

  const nextIds = [...idSet];
  const prevIds = Array.isArray(apr.taskIds) ? apr.taskIds : [];
  if ((nextIds.length || prevIds.length) && (nextIds.length !== prevIds.length || nextIds.some((id, i) => prevIds[i] !== id))) {
    apr.taskIds = nextIds;
    changed = true;
  }

  // 연결된 모든 산출물 + 외주 결과에서 체크리스트 항목 자동 추출·병합 (대표님 핵심 항목만, 최대 CHECKLIST_CORE_MAX건)
  const ckSources = [];
  for (const id of nextIds) {
    const t = (db.tasks || []).find((x) => x.id === id);
    if (t?.output) ckSources.push(t.output);
  }
  const consultId = apr.consult?.requestId || apr.consultRequestId || '';
  for (const r of db.outsourcing || []) {
    if (
      r?.result &&
      (r.approvalId === apr.id || (r.taskId && idSet.has(r.taskId)) || (apr.outsourceId && r.id === apr.outsourceId) || (consultId && r.id === consultId))
    ) {
      ckSources.push(r.result.document || r.result.summary || '');
    }
  }
  const mergedCk = refineApprovalChecklist(storedCk, ckSources);

  const prevCk = Array.isArray(apr.checklist) ? apr.checklist : [];
  if ((mergedCk.length || prevCk.length) && (mergedCk.length !== prevCk.length || mergedCk.some((c, i) => prevCk[i] !== c))) {
    apr.checklist = mergedCk;
    changed = true;
  }

  const deliverable = buildApprovalDeliverable(db, apr.id);
  return { changed, deliverable };
}

/**
 * 결재 안건 하나의 성과품 문서를 만듭니다.
 * @returns {null | { approval, title, filename, markdown, sectionCount, checklist }}
 *   sectionCount=0 이면 요약 외에 첨부할 결과물이 없다는 뜻입니다.
 */
export function buildApprovalDeliverable(db, aprId) {
  const apr = (db?.approvals || []).find((a) => a.id === aprId);
  if (!apr) return null;
  const mission = (db.missions || []).find((m) => m.id === apr.missionId);
  const agentName = (id) => (db.agents || []).find((a) => a.id === id)?.name || '';
  const sections = [];

  // 0) 대표님 확인·실행 체크리스트 (안건 자체 또는 첨부 결과물에서 추출)
  const taskIds = relatedTaskIds(db, apr);
  const checklist = refineApprovalChecklist(
    storedChecklistWithoutStale(db, apr),
    taskIds.map((id) => (db.tasks || []).find((x) => x.id === id)?.output || '')
  );
  if (checklist.length) {
    sections.push({
      heading: '☑️ 대표님 확인 · 실행 체크리스트',
      body: checklist.map((c) => `- [ ] ${c}`).join('\n')
    });
  }

  // 1) 계획서: 다음 단계 제안 등 결재 안건에 담긴 계획
  const plan = [];
  if (apr.proposedDirective) plan.push(`**지시안:** ${asText(apr.proposedDirective)}`);
  if (apr.goalGap) plan.push(`**목표까지 남은 차이:** ${asText(apr.goalGap)}`);
  if (apr.kpi) plan.push(`**이번 단계 지표·목표치:** ${asText(apr.kpi)}`);
  if (apr.doneCriteria) plan.push(`**완료 기준:** ${asText(apr.doneCriteria)}`);
  if (Array.isArray(apr.proposedSteps) && apr.proposedSteps.length) plan.push(`**진행 단계:**\n${asText(apr.proposedSteps)}`);
  if (plan.length) sections.push({ heading: '계획서', body: plan.join('\n\n') });

  // 1-2) 총괄 팀장 재가공 보고서 (대표님 보고용으로 팀장이 정리·보강한 본문)
  const leadBriefText = String(
    apr.leadBrief ||
      taskIds
        .map((id) => (db.tasks || []).find((x) => x.id === id)?.leadBrief)
        .find((b) => String(b || '').trim()) ||
      ''
  ).trim();
  if (leadBriefText) {
    sections.push({
      heading: '🧭 총괄 팀장 재가공 보고서',
      meta: [apr.workerName ? `실무: ${apr.workerName}` : '', apr.leadScore != null ? `팀장 검수 ${apr.leadScore}/10` : ''].filter(Boolean).join(' · '),
      body: clip(formatDeliverableOutput(leadBriefText))
    });
  }

  // 2) 시안·결과물: 연결된 업무의 실제 산출물
  for (const id of taskIds) {
    const t = (db.tasks || []).find((x) => x.id === id);
    if (!t || !String(t.output || '').trim()) continue;
    const score = t.review?.score ?? t.quality?.score;
    const gapNotes = [];
    if (t.review?.acceptedWithGaps) {
      const miss = Array.isArray(t.review.missing) && t.review.missing.length ? t.review.missing.join(' / ') : '';
      gapNotes.push(`> ⚠️ **도구 제약·미확인 항목 반영 통과**${miss ? `: ${miss}` : ''}`);
    }
    if (t.botReport && (t.botReport.limitations?.length || t.botReport.blockers?.length)) {
      const items = [...(t.botReport.limitations || []), ...(t.botReport.blockers || [])].join(' / ');
      gapNotes.push(`> ℹ️ **담당 봇 한계 보고**: ${items}`);
    }
    const rawBody = clip(formatDeliverableOutput(t.output));
    sections.push({
      heading: `시안·결과물: ${t.title}`,
      meta: [
        agentName(t.assigneeId),
        t.status ? `상태 ${t.status}` : '',
        score != null ? `팀장 검수 ${score}/10` : '',
        t.review?.acceptedWithGaps ? '한계 명시 통과' : ''
      ]
        .filter(Boolean)
        .join(' · '),
      body: gapNotes.length ? `${gapNotes.join('\n')}\n\n${rawBody}` : rawBody
    });
  }

  // 3) 외주 결과(자문·코드·리서치)
  const consultId = apr.consult?.requestId || apr.consultRequestId || '';
  const outs = (db.outsourcing || []).filter(
    (r) =>
      r?.result &&
      (r.approvalId === apr.id || (r.taskId && taskIds.includes(r.taskId)) || (apr.outsourceId && r.id === apr.outsourceId) || (consultId && r.id === consultId))
  );
  for (const r of outs) {
    sections.push({
      heading: `외주 결과: ${r.title || r.id} (${r.id})`,
      meta: [r.result.by, r.result.prUrl].filter(Boolean).join(' · '),
      body: clip([r.result.summary, r.result.document].filter(Boolean).join('\n\n'))
    });
  }
  if (apr.consult && (apr.consult.document || apr.consult.summary) && !outs.some((r) => r.id === apr.consult.requestId)) {
    sections.push({ heading: '외부 자문 의견', meta: apr.consult.by || '', body: clip(apr.consult.document || apr.consult.summary) });
  }

  // 4) 코드 변경(PR)
  const code = [];
  if (apr.prUrl) code.push(`**PR:** ${apr.prUrl}`);
  if (apr.branchName || apr.branch) code.push(`**브랜치:** ${apr.branchName || apr.branch}`);
  if (apr.diffSummary) code.push(`**변경 요약:**\n${clip(asText(apr.diffSummary), 6000)}`);
  if (Array.isArray(apr.changedFiles) && apr.changedFiles.length) code.push(`**바뀐 파일:**\n${fileList(apr.changedFiles)}`);
  if (code.length) sections.push({ heading: '코드 변경', body: code.join('\n\n') });

  const cost = Number(apr.estimatedCostKRW || 0) > 0 ? `${Number(apr.estimatedCostKRW).toLocaleString('ko-KR')}원` : '비용 없음';
  const head = [
    `# ${apr.title || apr.id}`,
    '',
    `- 결재 ID: ${apr.id}`,
    `- 상태: ${apr.status || '-'}`,
    apr.category ? `- 유형: ${apr.category}` : null,
    mission ? `- 관련 프로젝트/업무: ${mission.title}` : null,
    `- 예상 비용: ${cost}`,
    apr.createdAt ? `- 상신: ${apr.createdAt}` : null,
    '',
    '## 요약',
    asText(apr.summary) || '(요약 없음)',
    apr.proposedAction ? `\n## 승인 시 실행\n${asText(apr.proposedAction)}` : null
  ].filter((l) => l !== null);

  const body = sections.map((s) => [`## ${s.heading}`, s.meta ? `_${s.meta}_` : '', '', s.body].filter((l, i) => l !== '' || i === 2).join('\n'));
  let markdown = [...head, '', ...body.flatMap((b) => [b, ''])].join('\n').trim() + '\n';
  if (markdown.length > MAX_DOC) markdown = `${markdown.slice(0, MAX_DOC)}\n\n…(문서가 길어 이하 생략 · 전문은 웹 결재함에서 확인)\n`;

  return {
    approval: apr,
    title: apr.title || apr.id,
    filename: `deliverable-${String(apr.id).replace(/[^\w-]/g, '')}.md`,
    markdown,
    sectionCount: sections.length,
    checklist
  };
}

/**
 * 팀장 완료 보고 시 별도 확인이 필요한 성과품·시안·체크리스트를 마크다운 파일 하나로 묶습니다.
 * (텔레그램 sendDocument 자동 첨부 및 웹 다운로드 공용)
 */
export function buildReportDeliverableBundle(db, mission, tasks = [], checklistItems = []) {
  const validTasks = (Array.isArray(tasks) ? tasks : []).filter((t) => t && String(t.output || '').trim());
  if (!validTasks.length && !(Array.isArray(checklistItems) && checklistItems.length)) return null;
  const agentName = (id) => (db?.agents || []).find((a) => a.id === id)?.name || '팀원';

  const lines = [
    `# [성과품 · 체크리스트] ${mission?.title || '업무 보고'}`,
    '',
    `- 작성 시각: ${new Date().toISOString()}`,
    `- 첨부 성과품: ${validTasks.length}건`,
    ''
  ];

  if (Array.isArray(checklistItems) && checklistItems.length) {
    lines.push('## ☑️ 대표님 확인 · 실행 체크리스트', '');
    for (const item of checklistItems) lines.push(`- [ ] ${item}`);
    lines.push('');
  }

  for (const t of validTasks) {
    const score = t.review?.score ?? t.quality?.score;
    const meta = [agentName(t.assigneeId), score != null ? `팀장 검수 ${score}/10` : '', t.review?.acceptedWithGaps ? '한계 명시 통과' : ''].filter(Boolean).join(' · ');
    lines.push(`## 📄 ${t.title}`, meta ? `_${meta}_` : '', '', clip(formatDeliverableOutput(t.output)), '');
  }

  let markdown = lines.join('\n').trim() + '\n';
  if (markdown.length > MAX_DOC) markdown = `${markdown.slice(0, MAX_DOC)}\n\n…(문서가 길어 이하 생략 · 전문은 웹에서 확인)\n`;

  const slug = String(mission?.id || 'report').replace(/[^\w-]/g, '');
  return {
    title: `${mission?.title || '업무'} 성과품·체크리스트`,
    filename: `report-deliverables-${slug}.md`,
    markdown,
    taskCount: validTasks.length,
    checklistCount: Array.isArray(checklistItems) ? checklistItems.length : 0
  };
}

const DECISION_LABELS = {
  approved: '승인',
  revision_requested: '수정 지시',
  rejected: '반려',
  retry: '수정 재지시',
  accept: '완료 처리',
  drop: '반려·중단',
  lead_accepted_with_gaps: '팀장 검수 통과(한계 반영)',
  lead_accepted: '팀장 검수 통과',
  lead_revise: '팀장 보완 요청',
  lead_escalated: '팀장 담당 이관(종료)',
  lead_blocked: '팀장 보류(대표님 확인 대기)'
};

export function taskFeedbackSummary(db, task) {
  if (!task) {
    return {
      ceoFeedback: '',
      rejectionReason: '',
      leadFeedback: '',
      leadVerdict: '',
      acceptedWithGaps: false,
      botReport: null,
      needsRevision: false,
      revisionRound: 0,
      actionRequired: 'submit_result',
      actionLabel: '신규 업무 — 작업 후 제출 필요',
      leadNotes: [],
      lastDecision: null
    };
  }
  const linkedApr = (db?.approvals || []).find((a) => a.taskId === task.id && a.status !== 'pending');
  const ceoFeedback = String(task.ceoFeedback || task.ceoDecision?.feedback || linkedApr?.ceoNote || '').trim();
  const rejectionReason =
    task.status === 'rejected'
      ? String(task.rejectionReason || ceoFeedback || '상세 사유 미입력').trim()
      : String(task.rejectionReason || '').trim();
  const leadFeedback = String(task.leadFeedback?.botReply || task.review?.botReply || task.review?.feedback || '').trim();
  const leadVerdict = String(task.leadFeedback?.verdict || task.review?.verdict || '').trim();
  const acceptedWithGaps = Boolean(task.leadFeedback?.acceptedWithGaps || task.review?.acceptedWithGaps);
  const botReport = task.botReport || null;
  const revisionRound = Number(task.reviewRounds || 0);
  const needsRevision = Boolean(
    ['awaiting_bridge', 'queued'].includes(task.status) &&
      (leadVerdict === 'revise' ||
        task.ceoDecision?.action === 'revision_requested' ||
        task.ceoDecision?.action === 'retry' ||
        revisionRound > 0)
  );
  let actionRequired = 'submit_result';
  let actionLabel = '신규 업무 — 작업 후 제출 필요';
  if (task.status === 'review_pending') {
    actionRequired = 'wait_for_lead_review';
    actionLabel = '팀장 검수 대기 중 (중복 제출 금지)';
  } else if (task.status === 'awaiting_approval') {
    actionRequired = 'wait_for_ceo_approval';
    actionLabel = 'CEO 결재 대기 중 (중복 제출 금지)';
  } else if (task.status === 'blocked') {
    actionRequired = 'wait_for_ceo';
    actionLabel = '보류 · 대표님 확인 대기 (재시도 금지)';
  } else if (needsRevision) {
    actionRequired = 'revise_and_resubmit';
    actionLabel = `팀장 보완 요청 도착 — 수정 후 바로 재제출 필요${revisionRound > 0 ? ` (${revisionRound}차)` : ''}`;
  }
  const leadNotes = Array.isArray(task.leadNotes)
    ? task.leadNotes.slice(0, 4).map((n) => ({ by: n.by || '', kind: n.kind || '', text: String(n.text || '').trim(), at: n.at || '' }))
    : [];
  const lastDecision =
    task.ceoDecision ||
    (linkedApr
      ? {
          action: linkedApr.status,
          decision: linkedApr.status,
          feedback: String(linkedApr.ceoNote || '').trim(),
          approvalId: linkedApr.id,
          at: linkedApr.decidedAt || linkedApr.createdAt || ''
        }
      : null);
  return {
    ceoFeedback,
    rejectionReason,
    leadFeedback,
    leadVerdict,
    acceptedWithGaps,
    botReport,
    needsRevision,
    revisionRound,
    actionRequired,
    actionLabel,
    leadNotes,
    lastDecision
  };
}

export function buildAgentRecentFeedback(db, agentId, limit = 10) {
  if (!db || !agentId) return [];
  const taskById = new Map((db.tasks || []).map((t) => [t.id, t]));
  const items = [];
  const seenKeys = new Set();

  for (const a of db.approvals || []) {
    if (!a || a.status === 'pending') continue;
    const t = a.taskId ? taskById.get(a.taskId) : null;
    if (a.agentId !== agentId && t?.assigneeId !== agentId) continue;
    const key = a.taskId ? `tsk:${a.taskId}:${a.status}` : `apr:${a.id}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    items.push({
      source: 'ceo_approval',
      approvalId: a.id,
      taskId: a.taskId || '',
      missionId: a.missionId || t?.missionId || '',
      title: t?.title || a.title || a.id,
      decision: a.status,
      decisionLabel: DECISION_LABELS[a.status] || a.status,
      reason: String(a.ceoNote || t?.rejectionReason || t?.ceoFeedback || '').trim() || '상세 사유 미입력',
      decidedAt: a.decidedAt || a.createdAt || ''
    });
  }

  for (const t of db.tasks || []) {
    const matchesCeo = t.assigneeId === agentId;
    if (matchesCeo) {
      const hasDecision = Boolean(t.ceoDecision || t.rejectionReason || t.ceoFeedback);
      if (hasDecision || t.status === 'rejected') {
        const decision = t.ceoDecision?.decision || t.ceoDecision?.action || (t.status === 'rejected' ? 'rejected' : 'revision_requested');
        const key = `tsk:${t.id}:${decision}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          items.push({
            source: 'ceo_task',
            approvalId: t.ceoDecision?.approvalId || '',
            taskId: t.id,
            missionId: t.missionId || '',
            title: t.title || t.id,
            decision,
            decisionLabel: DECISION_LABELS[decision] || decision,
            reason: String(t.rejectionReason || t.ceoFeedback || t.ceoDecision?.feedback || '').trim() || '상세 사유 미입력',
            decidedAt: t.ceoDecision?.at || t.updatedAt || t.createdAt || ''
          });
        }
      }
    }

    // 팀장 검수·한계 반영·보완 요청·담당 이관 2방향 피드백 (이관돼 다른 담당자로 바뀐 업무도 원래 봇에게 답장 전달)
    const matchesLeadForAgent =
      t.assigneeId === agentId ||
      t.leadFeedback?.forAgentId === agentId ||
      t.botReport?.agentId === agentId;
    if (!matchesLeadForAgent) continue;

    const lf = t.leadFeedback;
    const rv = t.review && t.review.verdict && t.review.verdict !== 'pending' ? t.review : null;
    const replyText = String(lf?.botReply || rv?.botReply || rv?.feedback || '').trim();
    const withGaps = Boolean(lf?.acceptedWithGaps || rv?.acceptedWithGaps);
    const verdict = String(lf?.verdict || rv?.verdict || '').trim();
    if (!verdict || (!replyText && !withGaps)) continue;

    const leadDecision =
      verdict === 'accept'
        ? withGaps
          ? 'lead_accepted_with_gaps'
          : 'lead_accepted'
        : verdict === 'revise'
          ? 'lead_revise'
          : verdict === 'escalate'
            ? 'lead_escalated'
            : verdict === 'blocked'
              ? 'lead_blocked'
              : `lead_${verdict}`;
    const leadKey = `lead:${t.id}:${leadDecision}:${lf?.at || rv?.at || ''}`;
    if (seenKeys.has(leadKey)) continue;
    seenKeys.add(leadKey);
    items.push({
      source: 'lead_review',
      approvalId: '',
      taskId: t.id,
      missionId: t.missionId || '',
      title: t.title || t.id,
      decision: leadDecision,
      decisionLabel: DECISION_LABELS[leadDecision] || `팀장 검수(${verdict})`,
      acceptedWithGaps: withGaps,
      reason: replyText || (Array.isArray(rv?.missing) && rv.missing.length ? rv.missing.join(' / ') : '팀장 검수 완료'),
      decidedAt: lf?.at || rv?.at || t.updatedAt || t.createdAt || ''
    });
  }

  return items.sort((a, b) => Date.parse(b.decidedAt || 0) - Date.parse(a.decidedAt || 0)).slice(0, limit);
}
