// Minimal Network-First PWA Service Worker for CEO Office
// Enables native Chrome/Android "앱 설치" (WebAPK) without ever trapping users on stale UI caches.

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
  // Always pass through to network so live Render updates & API calls are never stale
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
