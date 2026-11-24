import { createRequire } from 'node:module';
import { loadDb, saveDb, flushCloudBackup } from './store.js';

const require = createRequire(import.meta.url);
const webpush = require('web-push');

const VAPID_SUBJECT = 'mailto:ceo-office@ai-ceo-hub.local';

/**
 * Ensure persistent VAPID keys exist in DB (or env VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
 * Auto-generates once and persists into DB + GitHub Gist so zero manual key setup is needed.
 */
export function ensureVapidKeys(db = null) {
  const targetDb = db || loadDb();
  targetDb.settings = targetDb.settings || {};
  targetDb.settings.webPush = targetDb.settings.webPush || { publicKey: '', privateKey: '' };

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    targetDb.settings.webPush.publicKey = process.env.VAPID_PUBLIC_KEY.trim();
    targetDb.settings.webPush.privateKey = process.env.VAPID_PRIVATE_KEY.trim();
  }

  if (!targetDb.settings.webPush.publicKey || !targetDb.settings.webPush.privateKey) {
    const generated = webpush.generateVAPIDKeys();
    targetDb.settings.webPush.publicKey = generated.publicKey;
    targetDb.settings.webPush.privateKey = generated.privateKey;
    saveDb(targetDb);
    flushCloudBackup(targetDb).catch(() => {});
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT,
    targetDb.settings.webPush.publicKey,
    targetDb.settings.webPush.privateKey
  );

  return {
    publicKey: targetDb.settings.webPush.publicKey,
    privateKey: targetDb.settings.webPush.privateKey
  };
}

/**
 * Broadcast a Web Push notification to all subscribed CEO devices (Android PWA, Desktop Chrome, etc.)
 * Automatically cleans up expired (404 / 410) push subscriptions.
 */
export async function sendWebPushNotification({ title, body, view = 'command', tag = 'ceo-office' }) {
  const db = loadDb();
  const subs = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  if (subs.length === 0) {
    return { sent: 0, failed: 0, total: 0 };
  }

  ensureVapidKeys(db);

  const payload = JSON.stringify({
    title: title || 'CEO Office',
    body: body || '',
    url: `./?view=${encodeURIComponent(view)}`,
    view,
    tag,
    timestamp: Date.now()
  });

  let sent = 0;
  let failed = 0;
  const expiredEndpoints = new Set();

  await Promise.all(
    subs.map(async (sub) => {
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        failed += 1;
        return;
      }
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }
          },
          payload,
          { TTL: 3600 }
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expiredEndpoints.add(sub.endpoint);
        }
      }
    })
  );

  if (expiredEndpoints.size > 0) {
    const fresh = loadDb();
    fresh.pushSubscriptions = (fresh.pushSubscriptions || []).filter(
      (s) => !expiredEndpoints.has(s.endpoint)
    );
    saveDb(fresh);
    flushCloudBackup(fresh).catch(() => {});
  }

  return { sent, failed, total: subs.length };
}
