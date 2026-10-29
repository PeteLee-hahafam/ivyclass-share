// 강의실 서비스 워커
// 화면 파일은 인터넷이 될 때 늘 새로 받고, 안 될 때만 저장해 둔 것을 써요. 강의 영상과 기록(/api, /media)은 저장하지 않아요.
const CACHE = 'ivy-shell-v6';
const SHELL = ['/', '/assets/styles.css', '/assets/pretendard.css', '/assets/app.js', '/assets/ui.js', '/assets/icons.js', '/assets/student.js', '/assets/quizview.js', '/assets/vendor/standalone.mjs'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/') || url.pathname.startsWith('/_engine/') || url.pathname === '/board.html' || url.pathname === '/board' || /^\/(print|lt|lt-report)(\.html)?$/.test(url.pathname)) return;
  const keep = req.mode === 'navigate' || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/');
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && keep && !url.pathname.startsWith('/assets/fonts/board')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((m) => m || Response.error())),
  );
});
