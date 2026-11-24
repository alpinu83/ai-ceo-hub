/**
 * Built-in Telegram CEO Approval & Command Bot (Official Telegram Bot API).
 * Supports both Long Polling (for local / dev machines) and Webhook POST (/api/telegram/webhook for Railway/Render).
 */

let pollingActive = false;
let pollingTimer = null;
let lastUpdateId = 0;
let activeToken = '';

async function tgCall(token, method, payload = {}) {
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.description || `Telegram API 오류 (${res.status})`);
  }
  return data.result;
}

export async function sendTelegramText(token, chatId, text, replyMarkup = undefined) {
  if (!token || !chatId) return { ok: false, skipped: true };
  const result = await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
  return { ok: true, messageId: result?.message_id };
}

export async function sendTelegramApprovalCard(settings, approval, agentName) {
  const tg = settings?.telegram;
  if (!tg?.botToken || !tg?.chatId) return { ok: false, skipped: true };

  const costText =
    (approval.estimatedCostKRW || 0) > 0
      ? `${Number(approval.estimatedCostKRW).toLocaleString('ko-KR')}원`
      : '비용 없음';

  const text = [
    `<b>[CEO 결재 요청] ${escapeHtml(settings.companyName || 'CEO Office')}</b>`,
    ``,
    `<b>안건:</b> ${escapeHtml(approval.title)}`,
    `<b>상신 AI:</b> ${escapeHtml(agentName || approval.agentId)}`,
    `<b>유형 / 리스크:</b> ${escapeHtml(approval.category)} (${escapeHtml(String(approval.riskLevel || 'medium').toUpperCase())})`,
    `<b>예상 비용:</b> ${costText}`,
    ``,
    `<b>요약:</b>`,
    escapeHtml(approval.summary || ''),
    ``,
    `<b>승인 시 실행:</b> ${escapeHtml(approval.proposedAction || '')}`
  ].join('\n');

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ 승인 확정', callback_data: `decide:approved:${approval.id}` },
        { text: '✏️ 수정 지시', callback_data: `decide:revision_requested:${approval.id}` },
        { text: '❌ 반려', callback_data: `decide:rejected:${approval.id}` }
      ]
    ]
  };

  try {
    return await sendTelegramText(tg.botToken, tg.chatId, text, keyboard);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function testTelegramBot(settings) {
  const tg = settings?.telegram;
  if (!tg?.botToken || !tg?.chatId) {
    throw new Error('Telegram Bot Token과 CEO Chat ID를 먼저 입력하고 저장해 주세요.');
  }
  const me = await tgCall(tg.botToken, 'getMe', {});
  await sendTelegramText(
    tg.botToken,
    tg.chatId,
    [
      `<b>${escapeHtml(settings.companyName || 'CEO Office')} 텔레그램 결재 봇 연결 완료</b>`,
      `봇 계정: @${escapeHtml(me.username || 'bot')}`,
      ``,
      `사용 가능 명령어:`,
      `• <code>/status</code> — 현재 미션 · 예산 · 결재 대기 현황`,
      `• <code>/approvals</code> — 대기 중인 결재 카드 다시 받기`,
      `• <code>/order 지시내용</code> — 모바일에서 바로 팀장에게 새 지시 하달`
    ].join('\n')
  );
  return { ok: true, botUsername: me.username };
}

/**
 * Process a single Telegram Update (from either Long Polling or Webhook POST)
 */
export async function handleTelegramUpdate(update, callbacks) {
  const settings = callbacks.getSettings();
  const tg = settings?.telegram;
  if (!tg?.botToken) return { handled: false };

  // 1. Inline button click (Approve / Revise / Reject)
  if (update.callback_query) {
    const cq = update.callback_query;
    const fromChat = String(cq.message?.chat?.id || '');
    if (tg.chatId && fromChat !== String(tg.chatId)) {
      await tgCall(tg.botToken, 'answerCallbackQuery', {
        callback_query_id: cq.id,
        text: '인가된 CEO 계정이 아닙니다.'
      }).catch(() => {});
      return { handled: false };
    }

    const parts = String(cq.data || '').split(':');
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
          `${label}\n안건: <b>${escapeHtml(result.title || aprId)}</b>`
        ).catch(() => {});
      }
      return { handled: true, decision, aprId };
    }
  }

  // 2. Text commands (/status, /approvals, /order ...)
  if (update.message?.text) {
    const chatId = String(update.message.chat.id);
    if (tg.chatId && chatId !== String(tg.chatId)) {
      return { handled: false };
    }
    const text = update.message.text.trim();

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
  }

  return { handled: false };
}

export function syncTelegramPolling(settings, callbacks) {
  const tg = settings?.telegram;
  const shouldRun = Boolean(tg?.botToken && tg?.chatId && tg?.pollingEnabled);

  if (!shouldRun) {
    stopTelegramPolling();
    return;
  }

  if (pollingActive && activeToken === tg.botToken) return;
  stopTelegramPolling();

  pollingActive = true;
  activeToken = tg.botToken;

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
      // Back off slightly on transient network errors
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (pollingActive) {
      pollingTimer = setTimeout(loop, 800);
    }
  };

  pollingTimer = setTimeout(loop, 500);
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
