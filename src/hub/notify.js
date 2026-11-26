// hub/notify.js: server.js에서 분리 (공유 로직)
import { appendLog, flushCloudBackup, loadDb, saveDb } from '../store.js';
import { ensureLeadDefaults, escapeTelegramHtml } from '../lead-engine.js';
import { getTelegramNotifyPrefs, isQuietNow, sendTelegramAlert, sendTelegramApprovalCard, sendTelegramText } from '../telegram.js';
import { notifyWebhook } from '../orchestrator.js';
import { sendWebPushNotification } from '../push.js';
import { deployLabelFor, getMissionRepoCfg, isCodeApproval, scheduleCodeBundle, setCodeStatus } from './code-pipeline.js';
import { enrichApprovalDeliverables } from './deliverables.js';

// ================================================================
// 텔레그램 알림 설정: 보고 켜기/끄기 · 방해금지 시간(그 사이 알림은 모아두었다가 끝나면 요약 발송)
// ================================================================
export function sanitizeNotifyPrefs(input = {}, current = {}) {
  const cur = getTelegramNotifyPrefs({ telegram: { notify: current } });
  const hm = (v, d) => (/^\d{1,2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim().padStart(5, '0') : d);
  const q = input.quiet && typeof input.quiet === 'object' ? input.quiet : {};
  return {
    reports: typeof input.reports === 'boolean' ? input.reports : cur.reports,
    alerts: typeof input.alerts === 'boolean' ? input.alerts : cur.alerts,
    approvals: typeof input.approvals === 'boolean' ? input.approvals : cur.approvals,
    quiet: {
      enabled: typeof q.enabled === 'boolean' ? q.enabled : cur.quiet.enabled,
      start: hm(q.start, cur.quiet.start),
      end: hm(q.end, cur.quiet.end),
      allowUrgent: typeof q.allowUrgent === 'boolean' ? q.allowUrgent : cur.quiet.allowUrgent
    }
  };
}

export function queueDeferredTelegram(item) {
  try {
    const db = loadDb();
    ensureLeadDefaults(db);
    const q = Array.isArray(db.leadState.telegramQueue) ? db.leadState.telegramQueue : [];
    const key = `${item.kind}:${item.approvalId || item.title || ''}`;
    if (!q.some((x) => `${x.kind}:${x.approvalId || x.title || ''}` === key)) {
      q.push({ kind: item.kind, title: String(item.title || '').slice(0, 120), body: String(item.body || '').slice(0, 600), approvalId: item.approvalId || '', at: item.at || new Date().toISOString() });
    }
    db.leadState.telegramQueue = q.slice(-60);
    saveDb(db);
  } catch (err) {
    console.warn('telegram defer failed:', err.message);
  }
}

export let telegramFlushRunning = false;

export async function flushTelegramQueue({ force = false } = {}) {
  if (telegramFlushRunning) return;
  const db = loadDb();
  const q = db.leadState?.telegramQueue;
  if (!Array.isArray(q) || !q.length) return;
  if (!force && isQuietNow(db.settings)) return;
  const tg = db.settings.telegram || {};
  if (!tg.botToken || !tg.chatId) return;
  telegramFlushRunning = true;
  try {
    db.leadState.telegramQueue = [];
    saveDb(db);
    const label = { report: '보고', alert: '특이점', approval: '결재 요청' };
    const plain = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const lines = [`<b>🌅 방해금지 시간 동안 쌓인 알림 ${q.length}건</b>`, ''];
    for (const it of q) {
      lines.push(`• [${label[it.kind] || '알림'}] <b>${escapeTelegramHtml(plain(it.title))}</b>${it.body ? `\n  ${escapeTelegramHtml(plain(it.body).slice(0, 220))}` : ''}`);
    }
    let text = lines.join('\n');
    if (text.length > 3800) text = `${text.slice(0, 3780)}\n…`;
    await sendTelegramText(tg.botToken, tg.chatId, text).catch(() => {});
    // 아직 대기 중인 결재는 버튼이 있는 카드 + 성과품(.md) 파일로 다시 보냄
    const fresh = loadDb();
    const agentName = (id) => fresh.agents.find((a) => a.id === id)?.name || id;
    let enrichedAny = false;
    for (const it of q.filter((x) => x.kind === 'approval' && x.approvalId).slice(0, 6)) {
      const apr = fresh.approvals.find((a) => a.id === it.approvalId && a.status === 'pending');
      if (apr) {
        const { changed, deliverable } = enrichApprovalDeliverables(fresh, apr);
        if (changed) enrichedAny = true;
        await sendTelegramApprovalCard(fresh.settings, apr, agentName(apr.agentId), '', {
          force: true,
          deliverableDoc: deliverable
        }).catch(() => {});
      }
    }
    if (enrichedAny) saveDb(fresh);
  } finally {
    telegramFlushRunning = false;
  }
}

export async function handleNotifyCommand(cmd, arg = '') {
  const db = loadDb();
  db.settings.telegram = db.settings.telegram || {};
  const cur = getTelegramNotifyPrefs(db.settings);
  const a = String(arg || '').trim().toLowerCase();
  let msg = '';
  if (cmd === 'report') {
    if (['on', '켜기', '켜', 'start'].includes(a)) cur.reports = true;
    else if (['off', '끄기', '꺼', 'stop'].includes(a)) cur.reports = false;
    msg = `팀장 보고 알림: <b>${cur.reports ? '켜짐' : '꺼짐'}</b>${cur.reports ? '' : ' (회의실에는 계속 기록됩니다)'}`;
  } else if (cmd === 'quiet') {
    const m = a.match(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/);
    if (m) {
      cur.quiet = { ...cur.quiet, enabled: true, start: m[1].padStart(5, '0'), end: m[2].padStart(5, '0') };
    } else if (['off', '끄기', '해제'].includes(a)) {
      cur.quiet = { ...cur.quiet, enabled: false };
    } else if (['on', '켜기'].includes(a)) {
      cur.quiet = { ...cur.quiet, enabled: true };
    }
    msg = cur.quiet.enabled
      ? `방해금지: <b>${cur.quiet.start} ~ ${cur.quiet.end}</b> (한국 시간). 이 시간에 온 알림은 모아두었다가 끝나면 요약해서 보내드려요.${cur.quiet.allowUrgent ? ' 긴급 특이점 알림은 바로 보냅니다.' : ''}`
      : '방해금지: <b>꺼짐</b>. 예) /quiet 23:00-08:00';
  } else {
    msg = [
      `보고: <b>${cur.reports ? '켜짐' : '꺼짐'}</b> · 특이점: <b>${cur.alerts ? '켜짐' : '꺼짐'}</b> · 결재 요청: <b>${cur.approvals ? '켜짐' : '꺼짐'}</b>`,
      `방해금지: <b>${cur.quiet.enabled ? `${cur.quiet.start} ~ ${cur.quiet.end}` : '꺼짐'}</b>${isQuietNow({ telegram: { notify: cur } }) ? ' (지금 방해금지 중)' : ''}`,
      '변경: /report on|off · /quiet 23:00-08:00 · /quiet off'
    ].join('\n');
  }
  db.settings.telegram.notify = sanitizeNotifyPrefs(cur, db.settings.telegram.notify);
  appendLog(db, '텔레그램 봇', `알림 설정 변경/조회: /${cmd} ${arg}`.trim(), 'info');
  saveDb(db);
  await flushCloudBackup(db);
  if (cmd === 'quiet' && !isQuietNow(db.settings)) flushTelegramQueue().catch(() => {});
  return msg;
}

export function notifyAllApprovalChannels(settings, apr, agentName) {
  // Code/deploy decisions in repo-linked missions: hold the card until the IT team attaches the real PR (diff),
  // so the CEO approves the actual change and approval alone merges & deploys it.
  if (apr && !apr.kind && apr.taskId && !apr.codeChange && !apr.prNumber) {
    try {
      const db = loadDb();
      if (isCodeApproval(db, apr)) {
        setCodeStatus(apr, 'waiting_team', { agentName: agentName || '' });
        apr.proposedAction = `IT팀이 팀 결정사항을 실제 코드(PR)로 작성 중입니다. 승인 시 main 머지 → ${deployLabelFor(getMissionRepoCfg(db.settings, db.missions.find((m) => m.id === apr.missionId))?.repo || '')}까지 자동 진행합니다.`;
        scheduleCodeBundle(apr.missionId);
        return;
      }
    } catch {
      // fall through to normal notification
    }
  }
  sendApprovalNotifications(settings, apr, agentName);
}

export function sendApprovalNotifications(settings, apr, agentName) {
  let missionLabel = '';
  let deliverableDoc = null;
  let effectiveApr = apr;
  try {
    const db = loadDb();
    const msn = db.missions.find((m) => m.id === apr?.missionId);
    if (msn) {
      missionLabel = `${msn.mode === 'project' ? `[프로젝트 P${Number(msn.phase) || 1}] ` : '[일반 업무] '}${msn.title}`;
    }
    // 모든 업무의 모든 결재 안건에 관련 성과품·시안·체크리스트 자동 첨부 및 번들 생성
    const liveApr = db.approvals.find((a) => a.id === apr?.id) || apr;
    if (liveApr) {
      const { changed, deliverable } = enrichApprovalDeliverables(db, liveApr);
      deliverableDoc = deliverable;
      effectiveApr = liveApr;
      if (changed && db.approvals.some((a) => a.id === liveApr.id)) {
        saveDb(db);
        flushCloudBackup(db).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
  notifyWebhook(settings, 'approval_requested', { ...effectiveApr, missionLabel }).catch(() => {});
  sendTelegramApprovalCard(settings, effectiveApr, agentName, missionLabel, { deliverableDoc }).catch(() => {});
  sendWebPushNotification({
    title: missionLabel ? `[결재 · ${missionLabel}]` : `[결재 요청] ${effectiveApr.title}`,
    body: `${effectiveApr.title} · ${agentName || '총괄 팀장'}`,
    view: 'approvals',
    tag: `apr-${effectiveApr.id}`
  }).catch(() => {});
}

export function notifyTaskCompleted(_settings, task, agentName) {
  // Routine task completion: quiet Web Push only — NEVER spam CEO's Telegram!
  // Telegram is strictly reserved for CEO approvals and anomalies/alerts.
  sendWebPushNotification({
    title: `[업무 완료] ${task.title}`,
    body: `${agentName || 'AI 팀원'}가 작업을 완료했습니다.`,
    view: 'missions',
    tag: `tsk-${task.id}`
  }).catch(() => {});
}

export function notifyTelegramAnomaly(settings, title, detail) {
  sendTelegramAlert(settings, title, detail).catch(() => {});
  sendWebPushNotification({
    title: `[특이점 알림] ${title}`,
    body: String(detail || '').slice(0, 100),
    view: 'command',
    tag: `alert-${Date.now()}`
  }).catch(() => {});
}
