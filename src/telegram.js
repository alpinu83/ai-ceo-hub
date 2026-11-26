/**
 * Built-in Telegram CEO Approval & Command Bot (Official Telegram Bot API).
 * Supports both Long Polling (for local / dev machines) and Webhook POST (/api/telegram/webhook for Railway/Render).
 */

let pollingActive = false;
let pollingTimer = null;
let lastUpdateId = 0;
let activeToken = '';

function cleanBotToken(token) {
  return String(token || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^bot/i, '')
    .trim();
}

function isValidBotToken(token) {
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(cleanBotToken(token));
}

function isNumericChatId(chatId) {
  return /^-?\d+$/.test(String(chatId || '').trim());
}

async function tgCall(token, method, payload = {}) {
  const cleanToken = cleanBotToken(token);
  if (!isValidBotToken(cleanToken)) {
    throw new Error(
      "Bot Token 형식이 올바르지 않습니다. 앞부분 '숫자:'까지 포함한 BotFather 전체 토큰(예: 1234567890:AAHuGU...)을 입력해 주세요."
    );
  }
  const url = `https://api.telegram.org/bot${cleanToken}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const desc = data.description || `Telegram API 오류 (${res.status})`;
    if (/not found|unauthorized/i.test(desc)) {
      throw new Error(
        `Telegram 인증 실패(${desc}) — BotFather 전체 토큰(숫자:영문)이 맞는지 확인해 주세요.`
      );
    }
    if (/chat not found|can't initiate/i.test(desc)) {
      throw new Error(
        `${desc} — 텔레그램에서 내 봇 채팅방을 열어 [시작(/start)] 버튼을 먼저 눌러주세요.`
      );
    }
    throw new Error(desc);
  }
  return data.result;
}

export async function sendTelegramText(token, chatId, text, replyMarkup = undefined) {
  if (!token || !chatId) return { ok: false, skipped: true };
  const result = await tgCall(token, 'sendMessage', {
    chat_id: String(chatId).trim(),
    text,
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
  return { ok: true, messageId: result?.message_id };
}

/**
 * 파일(문서) 보내기: 결재 성과품(시안·계획서)을 .md 파일로 전달합니다.
 * Telegram sendDocument는 새 파일을 multipart/form-data로만 받으므로 tgCall(JSON)과 따로 둡니다.
 */
export async function sendTelegramDocument(token, chatId, filename, content, caption = '') {
  if (!token || !chatId) return { ok: false, skipped: true };
  const cleanToken = cleanBotToken(token);
  if (!isValidBotToken(cleanToken)) throw new Error('Bot Token 형식이 올바르지 않습니다.');
  const form = new FormData();
  form.append('chat_id', String(chatId).trim());
  if (caption) {
    form.append('caption', String(caption).slice(0, 1000));
    form.append('parse_mode', 'HTML');
  }
  form.append('document', new Blob([String(content || '')], { type: 'text/markdown; charset=utf-8' }), filename || 'deliverable.md');
  const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendDocument`, { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram API 오류 (${res.status})`);
  return { ok: true, messageId: data.result?.message_id };
}

/** 결재 안건의 성과품 문서를 만들어(callbacks.onDeliverable) 파일로 보냅니다. */
async function deliverApprovalDeliverable(token, chatId, aprId, callbacks) {
  const d = await callbacks.onDeliverable(aprId);
  if (!d) {
    await sendTelegramText(token, chatId, `결재 안건 <code>${escapeHtml(aprId)}</code>을(를) 찾을 수 없습니다.`).catch(() => {});
    return { ok: false, text: '안건을 찾을 수 없습니다' };
  }
  const title = escapeHtml(String(d.title || aprId).slice(0, 200));
  if (!d.sectionCount) {
    await sendTelegramText(token, chatId, `<b>${title}</b>\n이 안건에는 아직 첨부할 시안·계획서·외주 결과가 없습니다. 결재 카드의 요약이 전부입니다.`).catch(() => {});
    return { ok: true, text: '첨부할 성과품이 없습니다' };
  }
  try {
    await sendTelegramDocument(token, chatId, d.filename, d.markdown, `📎 <b>성과품</b> · ${title}\n${d.sectionCount}개 항목(시안·계획서·외주 결과 등). 결정은 결재 카드 버튼으로 해 주세요.`);
    return { ok: true, text: '성과품 파일을 보냈습니다' };
  } catch (err) {
    await sendTelegramText(token, chatId, `성과품 파일 전송 실패: ${escapeHtml(String(err.message || err).slice(0, 200))}`).catch(() => {});
    return { ok: false, text: '파일 전송 실패' };
  }
}

// ================================================================
// 알림 권한(gate): 보고/특이점/결재 요청별 켜기·끄기 + 방해금지 시간(KST)
// 방해금지 중에는 보내지 않고 서버에 맡겨두었다가(defer) 끝나면 요약해서 보냅니다.
// 대표님이 직접 보낸 메시지에 대한 답장·로그인 코드는 항상 바로 보냅니다.
// ================================================================
let deferHandler = null;
export function setTelegramDeferHandler(fn) {
  deferHandler = typeof fn === 'function' ? fn : null;
}

export function getTelegramNotifyPrefs(settings) {
  const n = settings?.telegram?.notify || {};
  const q = n.quiet || {};
  return {
    reports: n.reports !== false,
    alerts: n.alerts !== false,
    approvals: n.approvals !== false,
    quiet: {
      enabled: Boolean(q.enabled),
      start: q.start || '23:00',
      end: q.end || '08:00',
      allowUrgent: Boolean(q.allowUrgent)
    }
  };
}

function hmToMinutes(s, def) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return def;
  return (Number(m[1]) % 24) * 60 + Math.min(59, Number(m[2]));
}

export function isQuietNow(settings, date = new Date()) {
  const { quiet } = getTelegramNotifyPrefs(settings);
  if (!quiet.enabled) return false;
  const start = hmToMinutes(quiet.start, 23 * 60);
  const end = hmToMinutes(quiet.end, 8 * 60);
  if (start === end) return false;
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  const now = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** returns 'send' | 'skip' | 'defer' */
function gateTelegram(settings, kind, item = {}) {
  const p = getTelegramNotifyPrefs(settings);
  if (kind === 'report' && !p.reports) return 'skip';
  if (kind === 'alert' && !p.alerts) return 'skip';
  if (kind === 'approval' && !p.approvals) return 'skip';
  if (isQuietNow(settings)) {
    if (kind === 'alert' && p.quiet.allowUrgent) return 'send';
    if (deferHandler) {
      try {
        deferHandler({ kind, ...item, at: new Date().toISOString() });
      } catch {
        // ignore
      }
    }
    return 'defer';
  }
  return 'send';
}

/** Gated plain HTML message (e.g. routine reports) */
export async function sendTelegramGated(settings, kind, html, title = '') {
  const tg = settings?.telegram;
  if (!isValidBotToken(tg?.botToken) || !isNumericChatId(tg?.chatId)) return { ok: false, skipped: true };
  const g = gateTelegram(settings, kind, { title: title || String(html || '').replace(/<[^>]+>/g, '').slice(0, 80), body: String(html || '').replace(/<[^>]+>/g, ' ').slice(0, 600) });
  if (g !== 'send') return { ok: true, [g === 'skip' ? 'skipped' : 'deferred']: true };
  try {
    return await sendTelegramText(tg.botToken, tg.chatId, html);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const recentTelegramAlerts = new Map();
const TELEGRAM_DEDUP_MS = 10 * 60 * 1000;

function shouldThrottleTelegram(dedupKey) {
  const now = Date.now();
  const prev = recentTelegramAlerts.get(dedupKey) || 0;
  if (now - prev < TELEGRAM_DEDUP_MS) return true;
  recentTelegramAlerts.set(dedupKey, now);
  if (recentTelegramAlerts.size > 100) {
    for (const [k, ts] of recentTelegramAlerts.entries()) {
      if (now - ts > TELEGRAM_DEDUP_MS) recentTelegramAlerts.delete(k);
    }
  }
  return false;
}

/**
 * 팀장 보고(완료 보고·후속 추진·배포 결과). 특이점 알림과 달리 "필요한 보고"이므로 본문을 더 길게 보냅니다.
 * dedupKey가 같으면 10분 안에 다시 보내지 않습니다.
 * htmlBody가 있으면 굵은 소제목/체크리스트로 가독성 있게 보내고, document가 있으면 .md 성과품 파일도 바로 첨부합니다.
 */
export async function sendTelegramReport(settings, title, body, dedupKey = '', { htmlBody = '', document = null } = {}) {
  const tg = settings?.telegram;
  if (!isValidBotToken(tg?.botToken) || !isNumericChatId(tg?.chatId)) return { ok: false, skipped: true };
  const g = gateTelegram(settings, 'report', { title, body: String(body || '').slice(0, 600) });
  if (g !== 'send') return { ok: true, [g === 'skip' ? 'skipped' : 'deferred']: true };
  if (shouldThrottleTelegram(`report:${dedupKey || String(title || '').slice(0, 60)}`)) return { ok: true, deduplicated: true };

  const rawBody = htmlBody ? String(htmlBody).slice(0, 3500) : escapeHtml(String(body || '').slice(0, 3500));
  const text = htmlBody ? rawBody : [`<b>📋 [팀장 보고] ${escapeHtml(title)}</b>`, '', rawBody].join('\n');
  try {
    const sent = await sendTelegramText(tg.botToken, tg.chatId, text);
    if (document?.markdown) {
      const cap =
        document.caption ||
        `📎 <b>성과품 · 체크리스트</b> · ${escapeHtml(String(document.title || title).slice(0, 180))}`;
      await sendTelegramDocument(tg.botToken, tg.chatId, document.filename || 'deliverables.md', document.markdown, cap).catch(() => {});
    }
    return sent;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendTelegramAlert(settings, title, detail) {
  const tg = settings?.telegram;
  if (!isValidBotToken(tg?.botToken) || !isNumericChatId(tg?.chatId)) return { ok: false, skipped: true };
  const g = gateTelegram(settings, 'alert', { title, body: String(detail || '').slice(0, 400) });
  if (g !== 'send') return { ok: true, [g === 'skip' ? 'skipped' : 'deferred']: true };
  const dedupKey = `alert:${String(title || '').slice(0, 60)}`;
  if (shouldThrottleTelegram(dedupKey)) return { ok: true, deduplicated: true };

  const text = [
    `<b>⚠️ [특이점 알림] ${escapeHtml(settings.companyName || 'CEO Office')}</b>`,
    ``,
    `<b>내용:</b> ${escapeHtml(title)}`,
    detail ? `${escapeHtml(String(detail).slice(0, 320))}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  try {
    return await sendTelegramText(tg.botToken, tg.chatId, text);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendTelegramApprovalCard(
  settings,
  approval,
  agentName,
  missionLabel = '',
  { force = false, deliverableDoc = null } = {}
) {
  const tg = settings?.telegram;
  if (!isValidBotToken(tg?.botToken) || !isNumericChatId(tg?.chatId)) return { ok: false, skipped: true };
  if (!force) {
    const g = gateTelegram(settings, 'approval', { title: approval?.title || '', body: String(approval?.summary || '').slice(0, 300), approvalId: approval?.id || '' });
    if (g !== 'send') return { ok: true, [g === 'skip' ? 'skipped' : 'deferred']: true };
  }
  if (!force && approval?.id && shouldThrottleTelegram(`apr:${approval.id}`)) {
    return { ok: true, deduplicated: true };
  }

  const costText =
    (approval.estimatedCostKRW || 0) > 0
      ? `${Number(approval.estimatedCostKRW).toLocaleString('ko-KR')}원`
      : '비용 없음';

  const checklistBlock =
    Array.isArray(approval.checklist) && approval.checklist.length
      ? [
          ``,
          `<b>☑️ 확인 · 실행 체크리스트:</b>`,
          ...approval.checklist.slice(0, 5).map((c) => `☐ ${escapeHtml(String(c).slice(0, 140))}`),
          ...(approval.checklist.length > 5 ? [`… 외 ${approval.checklist.length - 5}건 (아래 첨부 파일로 전문 확인)`] : [])
        ]
      : [];

  const text = [
    `<b>[CEO 결재 요청] ${escapeHtml(settings.companyName || 'CEO Office')}</b>`,
    ``,
    missionLabel ? `<b>관련 프로젝트/업무:</b> ${escapeHtml(missionLabel)}` : '',
    `<b>안건:</b> ${escapeHtml(approval.title)}`,
    `<b>상신:</b> ${escapeHtml(agentName || approval.agentId)}`,
    `<b>유형:</b> ${escapeHtml(approval.category)}`,
    `<b>예상 비용:</b> ${costText}`,
    ``,
    `<b>요약:</b>`,
    escapeHtml(String(approval.summary || '').slice(0, 1200)),
    ...checklistBlock,
    ``,
    `<b>승인 시 실행:</b> ${escapeHtml(approval.proposedAction || '')}`
  ]
    .filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))
    .join('\n')
    .slice(0, 3900);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ 승인 확정', callback_data: `decide:approved:${approval.id}` },
        { text: '✏️ 수정 지시', callback_data: `decide:revision_requested:${approval.id}` },
        { text: '❌ 반려', callback_data: `decide:rejected:${approval.id}` }
      ],
      [{ text: '📎 성과품(시안·체크리스트) 다시 받기', callback_data: `doc:${approval.id}` }]
    ]
  };

  try {
    const sent = await sendTelegramText(tg.botToken, tg.chatId, text, keyboard);
    if (deliverableDoc?.sectionCount > 0 && deliverableDoc?.markdown) {
      const cap = `📎 <b>결재 첨부 성과품 · 시안 · 체크리스트</b>\n• 안건: ${escapeHtml(String(approval.title || approval.id).slice(0, 160))}\n• 포함 항목: ${deliverableDoc.sectionCount}개 섹션 (위 결재 카드 버튼으로 승인/수정/반려)`;
      await sendTelegramDocument(
        tg.botToken,
        tg.chatId,
        deliverableDoc.filename || `deliverable-${approval.id}.md`,
        deliverableDoc.markdown,
        cap
      ).catch(() => {});
    }
    return sent;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function testTelegramBot(settings, onAutoRegisterChatId = null) {
  const tg = settings?.telegram;
  if (!tg?.botToken) {
    throw new Error('Telegram Bot Token을 먼저 입력하고 저장해 주세요.');
  }
  const me = await tgCall(tg.botToken, 'getMe', {});
  let chatId = String(tg.chatId || '').trim();

  // If Chat ID isn't numeric yet (empty or bot username), try auto-discovering it from recent /start messages!
  if (!isNumericChatId(chatId)) {
    const updates = await tgCall(tg.botToken, 'getUpdates', { limit: 10 }).catch(() => []);
    const recentChat = [...(updates || [])]
      .reverse()
      .map((u) => u?.message?.chat?.id || u?.callback_query?.message?.chat?.id)
      .find((id) => isNumericChatId(id));
    if (recentChat) {
      chatId = String(recentChat);
      if (typeof onAutoRegisterChatId === 'function') {
        await onAutoRegisterChatId(chatId);
      }
    }
  }

  if (!isNumericChatId(chatId)) {
    throw new Error(
      `봇(@${me.username}) 토큰은 정상입니다! 텔레그램에서 @${me.username} 채팅방을 열어 [시작(/start)] 버튼을 한 번 누른 뒤, 여기서 [테스트]를 다시 누르시면 숫자 Chat ID가 자동 등록됩니다.`
    );
  }
  await sendTelegramText(
    tg.botToken,
    chatId,
    [
      `<b>${escapeHtml(settings.companyName || 'CEO Office')} 텔레그램 결재 봇 연결 완료</b>`,
      `봇 계정: @${escapeHtml(me.username || 'bot')}`,
      ``,
      `사용 가능 명령어:`,
      `• <code>/status</code> — 현재 미션 · 결재 대기 현황`,
      `• <code>/approvals</code> — 대기 중인 결재 카드 다시 받기`,
      `• <code>/doc</code> — 결재 대기 안건의 성과품(시안·계획서) 파일 받기`,
      `• <code>/order 지시내용</code> — 텔레그램에서 바로 새 업무 지시`
    ].join('\n')
  );
  return { ok: true, botUsername: me.username, chatId };
}

/**
 * Process a single Telegram Update (from either Long Polling or Webhook POST)
 */
export async function handleTelegramUpdate(update, callbacks) {
  const settings = callbacks.getSettings();
  const tg = settings?.telegram;
  if (!isValidBotToken(tg?.botToken)) return { handled: false };

  const hasValidSavedChatId = isNumericChatId(tg.chatId);

  // 1. Inline button click (Approve / Revise / Reject)
  if (update.callback_query) {
    const cq = update.callback_query;
    const fromChat = String(cq.message?.chat?.id || '');
    if (hasValidSavedChatId && fromChat !== String(tg.chatId).trim()) {
      await tgCall(tg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '인가된 CEO 계정이 아닙니다.'
      }).catch(() => {});
      return { handled: false };
    }

    const parts = String(cq.data || '').split(':');
    // 결재 성과품 파일 받기
    if (parts[0] === 'doc' && parts.length === 2 && typeof callbacks.onDeliverable === 'function') {
      await tgCall(tg.botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: '성과품 파일을 준비합니다' }).catch(() => {});
      const r = await deliverApprovalDeliverable(tg.botToken, cq.message?.chat?.id || tg.chatId, parts[1], callbacks);
      return { handled: true, deliverable: parts[1], ok: r.ok };
    }
    // 외주: 대표님 개입 후 재개 / 다른 작업자로 넘기기 / 취소
    if (parts[0] === 'out' && parts.length === 3 && typeof callbacks.onOutsourceCallback === 'function') {
      const r = await callbacks.onOutsourceCallback(parts[1], parts[2]);
      await tgCall(tg.botToken, 'answerCallbackQuery', { callback_query_id: cq.id, text: String(r?.text || '처리됨').slice(0, 180) }).catch(() => {});
      if (r?.ok && cq.message?.chat?.id && cq.message?.message_id) {
        await tgCall(tg.botToken, 'editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        await sendTelegramText(tg.botToken, cq.message.chat.id, escapeHtml(r.text)).catch(() => {});
      }
      return { handled: true, outsource: parts[1] };
    }
    if (parts[0] === 'decide' && parts.length === 3) {
      const [, decision, aprId] = parts;
      const result = await callbacks.onDecision(aprId, decision, 'Telegram 모바일 원터치 결재');
      const label =
        decision === 'approved' ? '✅ 승인 확정됨' : decision === 'revision_requested' ? '✏️ 수정 지시됨' : '❌ 반려됨';

      await tgCall(tg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: result.ok ? label : result.error || '처리 실패'
      }).catch(() => {});

      if (result.ok && cq.message?.chat?.id && cq.message?.message_id) {
        await tgCall(tg.botToken, 'editMessageReplyMarkup', {
          chat_id: cq.message.chat.id,
          message_id: cq.message.message_id,
          reply_markup: { inline_keyboard: [] }
        }).catch(() => {});
        await sendTelegramText(
          tg.botToken,
          cq.message.chat.id,
          `${label}\n안건: <b>${escapeHtml(result.title || aprId)}</b>${
            result.codeApply ? '\n실코드 머지·배포를 바로 진행합니다. 배포 결과는 확인되는 대로 다시 알려드릴게요.' : ''
          }`
        ).catch(() => {});
      }
      return { handled: true, decision, aprId };
    }
  }

  // 2. Text commands (/start, /status, /approvals, /order ...)
  if (update.message?.text) {
    const chatId = String(update.message.chat.id);
    const text = update.message.text.trim();

    // Auto-register CEO numeric Chat ID on /start if unset or previously entered as bot username
    if (!hasValidSavedChatId && typeof callbacks.onAutoRegisterChatId === 'function') {
      await callbacks.onAutoRegisterChatId(chatId);
      const summary = await callbacks.onStatus();
      await sendTelegramText(
        tg.botToken,
        chatId,
        `<b>✅ CEO 텔레그램 연결 완료!</b> (Chat ID: <code>${chatId}</code> 자동 등록됨)\n\n${summary}`
      ).catch(() => {});
      return { handled: true, command: '/start', autoRegisteredChatId: chatId };
    }

    if (hasValidSavedChatId && chatId !== String(tg.chatId).trim()) {
      return { handled: false };
    }

    if (text === '/start' || text === '/help' || text === '/status') {
      const summary = await callbacks.onStatus();
      await sendTelegramText(tg.botToken, chatId, summary).catch(() => {});
      return { handled: true, command: '/status' };
    }

    if (text === '/approvals') {
      const pending = await callbacks.onListPending();
      if (pending.length === 0) {
        await sendTelegramText(tg.botToken, chatId, '현재 대기 중인 CEO 결재 안건이 없습니다.').catch(() => {});
      } else {
        for (const item of pending.slice(0, 5)) {
          await sendTelegramApprovalCard(settings, item.approval, item.agentName);
        }
      }
      return { handled: true, command: '/approvals' };
    }

    // 결재 성과품: /doc 결재ID → 파일 전송, /doc → 대기 중 결재 목록(버튼)
    const docCmd = text.match(/^\/docs?(?:@\S+)?(?:\s+(\S+))?\s*$/i);
    if (docCmd && typeof callbacks.onDeliverable === 'function') {
      if (docCmd[1]) {
        await deliverApprovalDeliverable(tg.botToken, chatId, docCmd[1], callbacks);
      } else {
        const pending = await callbacks.onListPending();
        if (!pending.length) {
          await sendTelegramText(tg.botToken, chatId, '현재 대기 중인 CEO 결재 안건이 없습니다.').catch(() => {});
        } else {
          const rows = pending.slice(0, 8).map((item) => [
            { text: `📎 ${String(item.approval.title || item.approval.id).slice(0, 40)}`, callback_data: `doc:${item.approval.id}` }
          ]);
          await sendTelegramText(tg.botToken, chatId, `<b>결재 대기 ${pending.length}건</b>\n성과품(시안·계획서)을 받을 안건을 눌러 주세요.`, { inline_keyboard: rows }).catch(() => {});
        }
      }
      return { handled: true, command: '/doc' };
    }

    if (text.startsWith('/order ')) {
      const directive = text.slice(7).trim();
      if (directive) {
        const res = await callbacks.onOrder(directive);
        await sendTelegramText(
          tg.botToken,
          chatId,
          `<b>새 CEO 지시 하달 완료</b>\n미션: ${escapeHtml(res.title)}\n총괄 팀장이 ${res.taskCount}개 실무 작업으로 분배했습니다.`
        ).catch(() => {});
        return { handled: true, command: '/order' };
      }
    }

    // 외주 라우팅: /route auto|aside|antigravity, /away 3, /office, /out [OUT-ID 작업자]
    const outCmd = text.match(/^\/(route|away|office|out)(?:@\S+)?\s*([\s\S]*)$/i);
    if (outCmd && typeof callbacks.onOutsourceCommand === 'function') {
      const reply = await callbacks.onOutsourceCommand(outCmd[1].toLowerCase(), outCmd[2] || '');
      if (reply) await sendTelegramText(tg.botToken, chatId, reply).catch(() => {});
      return { handled: true, command: `/${outCmd[1].toLowerCase()}` };
    }

    // 알림 설정 명령어: /notify, /report on|off, /quiet 23:00-08:00 | off
    const notifyCmd = text.match(/^\/(notify|report|quiet)(?:@\S+)?\s*([\s\S]*)$/i);
    if (notifyCmd && typeof callbacks.onNotifyCommand === 'function') {
      const reply = await callbacks.onNotifyCommand(notifyCmd[1].toLowerCase(), notifyCmd[2] || '');
      if (reply) await sendTelegramText(tg.botToken, chatId, reply).catch(() => {});
      return { handled: true, command: `/${notifyCmd[1].toLowerCase()}` };
    }

    // 자유 대화: 명령어가 아닌 메시지는 회의실 발언과 똑같이 처리(지시면 실제 업무 등록, 질문이면 팀장이 답변)
    if (!text.startsWith('/') && typeof callbacks.onChat === 'function') {
      try {
        const reply = await callbacks.onChat(text);
        if (reply) await sendTelegramText(tg.botToken, chatId, reply).catch(() => {});
      } catch (err) {
        await sendTelegramText(tg.botToken, chatId, `처리 중 오류가 났습니다: ${escapeHtml(String(err.message || err).slice(0, 200))}`).catch(() => {});
      }
      return { handled: true, command: 'chat' };
    }
  }

  return { handled: false };
}

export function syncTelegramPolling(settings, callbacks) {
  const tg = settings?.telegram;
  // Run polling whenever a valid botToken is present and polling is enabled (even before Chat ID is registered so /start auto-registers it!)
  const shouldRun = Boolean(isValidBotToken(tg?.botToken) && tg?.pollingEnabled);

  if (!shouldRun) {
    stopTelegramPolling();
    return;
  }

  const cleaned = cleanBotToken(tg.botToken);
  if (pollingActive && activeToken === cleaned) return;
  stopTelegramPolling();

  pollingActive = true;
  activeToken = cleaned;

  const loop = async () => {
    if (!pollingActive) return;
    try {
      const updates = await tgCall(activeToken, 'getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 20,
        allowed_updates: ['message', 'callback_query']
      });
      for (const u of updates || []) {
        lastUpdateId = Math.max(lastUpdateId, u.update_id || 0);
        await handleTelegramUpdate(u, callbacks);
      }
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (pollingActive) {
      pollingTimer = setTimeout(loop, 800);
    }
  };

  // Clear any stale webhook first so getUpdates long polling always receives /start
  tgCall(activeToken, 'deleteWebhook', { drop_pending_updates: false })
    .catch(() => {})
    .finally(() => {
      if (pollingActive) pollingTimer = setTimeout(loop, 400);
    });
}

export function stopTelegramPolling() {
  pollingActive = false;
  activeToken = '';
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

export function isTelegramPollingActive() {
  return pollingActive;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
