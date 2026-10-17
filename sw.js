/* Service worker: guarda o app para abrir sem internet (útil no culto). */
const CACHE = 'louvor-icvj-v15';
const SHELL = ['./', 'index.html', 'styles.css', 'config.js', 'app.js', 'manifest.webmanifest', 'icons/logo.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Rede primeiro (pega atualizações), cache como reserva offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (new URL(e.request.url).origin === location.origin || e.request.url.includes('fonts.g') || e.request.url.includes('cdn.jsdelivr.net'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});

/* Notificações push: escala, trocas, avisos e lembrete na véspera do culto */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Louvor ICVJ', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Louvor ICVJ', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || '#/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL('./' + ((e.notification.data && e.notification.data.url) || '#/'), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((w) => w.url.startsWith(self.registration.scope));
    if (c) { c.navigate(target).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
