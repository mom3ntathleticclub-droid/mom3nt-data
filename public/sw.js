// Minimal service worker: claim clients so it feels app-like
self.addEventListener('install', (event) => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
// (Optional) passthrough fetch; add caching later if you want offline
self.addEventListener('fetch', () => {});
