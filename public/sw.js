// Network-First PWA Service Worker + Native Web Push Notification Handler for CEO Office

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => {
      if (event.request.mode === 'navigate') {
        return new Response(
          '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CEO Office</title><body style="font-family:sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f5f3;color:#141413"><div style="text-align:center;padding:24px"><h2>오프라인 상태입니다</h2><p>네트워크 연결 후 다시 열어주세요.</p><button onclick="location.reload()" style="padding:10px 18px;border-radius:10px;border:none;background:#141413;color:#fff;font-size:15px">새로고침</button></div></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      return new Response('', { status: 503 });
    })
  );
});

// Receive Web Push (works even when app is closed / phone screen is locked!)
self.addEventListener('push', (event) => {
  let data = { title: 'CEO Office', body: '새 알림이 도착했습니다.', url: './?view=approvals', tag: 'ceo-office' };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'CEO Office', {
      body: data.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      vibrate: [120, 60, 120],
      tag: data.tag || 'ceo-office',
      renotify: true,
      data: { url: data.url || './', view: data.view || 'command' }
    })
  );
});

// Focus or open CEO Office directly to the target tab (approvals / missions) when tapped
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
