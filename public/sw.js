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

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Fetch Event (Network first, fall back to cache)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});