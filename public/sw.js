const CACHE_NAME = 'canasta-master-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/ui.js',
  '/animations.js',
  '/state.js',
  '/Canasta logo.png',
  '/cards/BackRed.png',
  '/cards/BackBlue.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim()); 
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // IGNORE SOCKET.IO 
  if (url.pathname.includes('socket.io') || url.pathname.includes('/api/')) {
    return; 
  }

  // 2. CACHE STRATEGY 
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      return cachedResponse || fetch(e.request);
    })
  );
});