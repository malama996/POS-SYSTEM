// ShopPOS Service Worker v2.1 — ZhenchStacks

const CACHE = 'shoppos-v14';

const OFFLINE_URLS = [
  '/index.html',
  '/manifest.json',
  '/offline.html',

  // CDN Libraries (fixed URLs)
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js'
];


// 🧩 INSTALL
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(OFFLINE_URLS))
      .catch(() => {}) // skip failures silently
      .then(() => self.skipWaiting())
  );
});


// 🧹 ACTIVATE
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE).map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});


// 🌐 FETCH (Offline-first with fallback)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 🚫 Skip certain APIs
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('wa.me') ||
    url.hostname.includes('portal.zra.org.zm') ||
    url.hostname.includes('api.qrserver.com')
  ) return;

  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {

      const networkFetch = fetch(e.request)
        .then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // 🔴 If both network & cache fail → show offline page
          return cached || caches.match('/offline.html');
        });

      // ⚡ Return cached immediately, update in background
      return cached || networkFetch;
    })
  );
});


// 🔔 PUSH NOTIFICATIONS
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};

  e.waitUntil(
    self.registration.showNotification(data.title || 'ShopPOS', {
      body: data.body || 'Check your shop',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'shoppos',
      data: { url: '/index.html' }
    })
  );
});


// 👆 NOTIFICATION CLICK
self.addEventListener('notificationclick', e => {
  e.notification.close();

  e.waitUntil(
    clients.openWindow(e.notification.data?.url || '/index.html')
  );
});