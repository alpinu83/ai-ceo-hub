// hub/ceo-inbox.js: "대표님 때문에 멈춘 일" 한곳에 모으기 (모든 프로젝트)
//  - 결재 대기 / 관문 결정 / 쇼츠 뉴스 고르기 / 보류된 작업(대표님 확인 필요) / 외주 작업자의 대표님 조치 요청
//  - 텔레그램: /todo 명령, 하루 두 번(08:30·19:30) 묶음 알림
import { flushCloudBackup, loadDb, saveDb } from '../store.js';
import { sendTelegramText } from '../telegram.js';
import { ensureShorts, findShortsMission, notifyCandidates } from './shorts.js';

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const hoursSince = (iso) => (iso ? Math.max(0, (Date.now() - Date.parse(iso)) / 3600000) : 0);
const OPEN_TASK = ['queued', 'running', 'awaiting_bridge', 'awaiting_approval', 'outsourced'];

export const INBOX_KIND_LABEL = {
  approval: '결재',
  gate: '관문 결정',
  shorts_pick: '뉴스 고르기',
  blocked: '확인 필요',
  outsource: '외주 조치'
};

/** 대표님이 해야 멈춘 일이 다시 굴러가는 항목들 (오래 기다린 순) */
export function buildCeoInbox(db) {
  const items = [];
  const missionTitle = (id) => db.missions.find((m) => m.id === id)?.title || '';
  for (const a of db.approvals || []) {
    if (a.status !== 'pending') continue;
    items.push({
      key: `apr:${a.id}`,
      kind: a.kind === 'stage_gate' ? 'gate' : 'approval',
      missionId: a.missionId || '',
      missionTitle: missionTitle(a.missionId),
      title: clip(a.title, 120),
      detail: a.kind === 'stage_gate' ? '이 결정이 나야 다음 단계로 넘어갑니다' : '승인·수정·반려 중 하나를 골라 주세요',
      since: a.createdAt,
      action: { type: 'approval', id: a.id }
    });
  }
  const sm = findShortsMission(db);
  if (sm) {
    const sh = ensureShorts(db);
    const fresh = sh.candidates.filter((c) => c.status === 'new');
    const inFlight = db.tasks.some((t) => t.missionId === sm.id && t.shorts && OPEN_TASK.includes(t.status));
    if (fresh.length && !inFlight) {
      items.push({
        key: `shorts:${sm.id}`,
        kind: 'shorts_pick',
        missionId: sm.id,
        missionTitle: sm.title,
        title: `쇼츠로 만들 뉴스 1개 고르기 (후보 ${fresh.length}건)`,
        detail: clip(fresh[0].title, 80),
        since: sh.lastCollectedAt || fresh[0].createdAt,
        action: { type: 'shorts', id: sm.id }
      });
    }
  }
  for (const t of db.tasks || []) {
    if (t.status !== 'blocked') continue;
    const m = db.missions.find((x) => x.id === t.missionId);
    if (!m || m.status === 'completed') continue;
    items.push({
      key: `task:${t.id}`,
      kind: 'blocked',
      missionId: t.missionId,
      missionTitle: m.title,
      title: clip(t.title, 120),
      detail: clip(t.blockedReason || '보류됨', 140),
      since: t.updatedAt,
      action: { type: 'mission', id: t.missionId }
    });
  }
  for (const r of db.outsourcing || []) {
    if (r.status !== 'needs_ceo') continue;
    items.push({
      key: `out:${r.id}`,
      kind: 'outsource',
      missionId: r.missionId || '',
      missionTitle: missionTitle(r.missionId),
      title: `${r.id} ${clip(r.title, 100)}`,
      detail: clip(r.ceoAction?.action || '대표님 확인 필요', 140),
      since: r.ceoAction?.at || r.updatedAt,
      action: { type: 'outsource', id: r.id }
    });
  }
  for (const it of items) it.ageHours = Math.round(hoursSince(it.since) * 10) / 10;
  items.sort((a, b) => b.ageHours - a.ageHours);
  return { count: items.length, items };
}

const ageLabel = (h) => (h >= 24 ? `${Math.floor(h / 24)}일째` : h >= 1 ? `${Math.floor(h)}시간째` : '방금');

/** 텔레그램 메시지 (+ 바로 처리 버튼) */
export function formatInboxTelegram(inbox, { heading = '' } = {}) {
  if (!inbox.count) return { text: '✅ 지금 대표님 때문에 멈춘 일은 없습니다.', keyboard: null };
  const lines = [
    `<b>${esc(heading || `대표님이 하실 일 ${inbox.count}건`)}</b> (오래 기다린 순)`,
    '',
    ...inbox.items.slice(0, 12).map(
      (it, i) => `${i + 1}. [${INBOX_KIND_LABEL[it.kind]}] ${esc(it.title)}${it.missionTitle ? ` · ${esc(clip(it.missionTitle, 20))}` : ''} · <i>${ageLabel(it.ageHours)}</i>${it.detail ? `\n   └ ${esc(it.detail)}` : ''}`
    ),
    inbox.count > 12 ? `… 외 ${inbox.count - 12}건은 CEO Hub 홈에서 확인` : ''
  ].filter(Boolean);
  const rows = [];
  if (inbox.items.some((it) => it.action.type === 'approval')) rows.push([{ text: '📋 결재 카드 받기', callback_data: 'todo:apr:0' }]);
  const sh = inbox.items.find((it) => it.action.type === 'shorts');
  if (sh) rows.push([{ text: '🎬 쇼츠 뉴스 후보 보기', callback_data: 'todo:shorts:0' }]);
  return { text: lines.join('\n'), keyboard: rows.length ? { inline_keyboard: rows } : null };
}

export async function sendInboxTelegram(db, opts = {}) {
  const tg = db.settings?.telegram || {};
  if (!tg.botToken || !tg.chatId) return { ok: false, skipped: true };
  const inbox = buildCeoInbox(db);
  if (opts.skipEmpty && !inbox.count) return { ok: true, empty: true };
  const { text, keyboard } = formatInboxTelegram(inbox, opts);
  await sendTelegramText(tg.botToken, tg.chatId, text, keyboard || undefined);
  return { ok: true, count: inbox.count };
}

/** /todo 버튼: 결재 카드 다시 받기 · 쇼츠 후보 다시 받기 */
export async function handleTodoCallback(action, _id, { sendApprovalCards } = {}) {
  const db = loadDb();
  if (action === 'apr') {
    if (typeof sendApprovalCards === 'function') await sendApprovalCards();
    return { ok: true, text: '결재 카드를 보냈습니다.' };
  }
  if (action === 'shorts') {
    const sh = ensureShorts(db);
    const fresh = sh.candidates.filter((c) => c.status === 'new');
    if (!fresh.length) return { ok: false, text: '고를 쇼츠 후보가 없습니다.' };
    await notifyCandidates(db, fresh);
    return { ok: true, text: '쇼츠 후보를 보냈습니다.' };
  }
  return { ok: false, text: '알 수 없는 동작입니다.' };
}

// 하루 두 번 묶음 알림 (한국 시간 08:30, 19:30) — 같은 시간대에는 한 번만
const DIGEST_SLOTS = [
  [8, 30],
  [19, 30]
];
export async function maybeSendInboxDigest(now = Date.now()) {
  const kst = new Date(now + 9 * 3600000);
  const h = kst.getUTCHours();
  const mi = kst.getUTCMinutes();
  const slot = DIGEST_SLOTS.find(([sh, sm]) => h === sh && mi >= sm && mi < sm + 20);
  if (!slot) return null;
  const key = `${kst.toISOString().slice(0, 10)}-${slot[0]}`;
  const db = loadDb();
  db.ceoInbox = db.ceoInbox && typeof db.ceoInbox === 'object' ? db.ceoInbox : {};
  if (db.ceoInbox.lastDigestKey === key) return null;
  db.ceoInbox.lastDigestKey = key;
  saveDb(db);
  await flushCloudBackup(db).catch(() => {});
  return sendInboxTelegram(db, { skipEmpty: true, heading: `${slot[0] < 12 ? '아침' : '저녁'} 점검: 대표님이 하실 일` });
}
