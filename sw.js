/**
 * Service Worker — Sistema Integrado (Ponto + Estoque)
 */

const CACHE_NAME = 'sistema-integrado-v1';
const CACHE_ASSETS = [
    'index.html',
    'ponto-styles.css',
    'ponto-theme-redesign.css',
    'ponto-design-improvements.css',
    'ponto-slate-redesign.css',
    'estoque-styles.css',
    'ponto-utils.js',
    'ponto-icons.js',
    'ponto-notifications.js',
    'ponto-dateUtils.js',
    'ponto-validators.js',
    'ponto-storage.js',
    'ponto-calculations.js',
    'ponto-pagination.js',
    'ponto-cache.js',
    'ponto-charts.js',
    'ponto-pwa.js',
    'ponto-atividades-tabela.js',
    'ponto-atividades-kanban.js',
    'ponto-app-refatorado.js',
    'estoque-app.js',
    'estoque-body.html'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            for (const asset of CACHE_ASSETS) {
                try {
                    const req = new Request(asset, { cache: 'no-cache' });
                    const res = await fetch(req);
                    if (res && res.ok) await cache.put(req, res);
                } catch (e) {
                    console.warn('[SW] Erro ao cachear:', asset, e);
                }
            }
        } catch (err) {
            console.error('[SW] Erro durante install:', err);
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames =>
            Promise.all(cacheNames.map(cache => {
                if (cache !== CACHE_NAME) return caches.delete(cache);
            }))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith(self.location.origin)) return;

    const url = new URL(event.request.url);
    const isCritical = event.request.mode === 'navigate' ||
        url.pathname.endsWith('/index.html') ||
        url.pathname.endsWith('/ponto-app-refatorado.js') ||
        url.pathname.endsWith('/estoque-app.js');

    if (isCritical) {
        event.respondWith(
            fetch(event.request).then(response => {
                if (response && response.ok) {
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
                }
                return response;
            }).catch(async () => {
                const cached = await caches.match(event.request);
                return cached || caches.match('./index.html');
            })
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) {
                fetch(event.request).then(r => {
                    if (r && r.ok) caches.open(CACHE_NAME).then(c => c.put(event.request, r));
                }).catch(() => {});
                return cached;
            }
            return fetch(event.request).then(response => {
                if (response && response.ok) {
                    caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
                }
                return response;
            }).catch(() => caches.match('./index.html'));
        })
    );
});
