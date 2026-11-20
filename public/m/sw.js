// NetERP mobil service worker: bildirimler + uygulama kabuğunun önbelleği (veri önbelleğe alınmaz).
const KABUK = 'neterp-m-v1';
const DOSYALAR = ['./', 'index.html', 'm.css', 'm.js', 'dil-yol.js', '../dil/yukle.js', 'ikon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(KABUK).then((c) => c.addAll(DOSYALAR)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((L) => Promise.all(L.filter((k) => k !== KABUK).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Kabuk: önce ağ, olmazsa önbellek. API istekleri hiç önbelleğe alınmaz.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && (u.pathname.startsWith('/m/') || u.pathname.startsWith('/dil/'))) { const k = r.clone(); caches.open(KABUK).then((c) => c.put(e.request, k)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

self.addEventListener('push', (e) => {
  let v = {};
  try { v = e.data ? e.data.json() : {}; } catch (x) { v = { govde: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(v.baslik || 'NetERP', {
    body: v.govde || '', tag: v.etiket || undefined, renotify: !!v.etiket,
    icon: 'ikon-192.png', badge: 'ikon-rozet.png', data: { url: v.url || '/m/' },
  }).then(() => self.clients.matchAll({ type: 'window' }).then((L) => L.forEach((c) => c.postMessage({ tur: 'push' })))));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hedef = new URL((e.notification.data && e.notification.data.url) || '/m/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((L) => {
    for (const c of L) if (c.url.includes('/m/')) { c.focus(); c.postMessage({ tur: 'git', url: hedef }); return; }
    return self.clients.openWindow(hedef);
  }));
});
