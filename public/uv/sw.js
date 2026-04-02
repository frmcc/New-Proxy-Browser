importScripts('/uv-dist/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts(__uv$config.sw || '/uv-dist/uv.sw.js');

const uv = new UVServiceWorker();

// Activate immediately without waiting for old SW to release
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    event.respondWith(
        (async () => {
            if (uv.route(event)) {
                return await uv.fetch(event);
            }
            return await fetch(event.request);
        })().catch((err) => {
            console.error('[sw] fetch error:', err);
            return new Response(err.message, { status: 500 });
        })
    );
});
