/**
 * Service Worker para PWA
 * Permite funcionamento offline e cache inteligente
 */

const CACHE_NAME = 'controle-ponto-v3';
const CACHE_ASSETS = [
    'index-refatorado.html',
    'styles.css',
    'utils.js',
    'icons.js',
    'notifications.js',
    'dateUtils.js',
    'validators.js',
    'storage.js',
    'calculations.js',
    'pagination.js',
    'cache.js',
    'validation-realtime.js',
    'charts.js',
    'pwa.js',
    'atividades-tabela.js',
    'atividades-kanban.js',
    'firebase-init.js',
    'app-refatorado.js'
];

// Instalação - cachear assets
self.addEventListener('install', (event) => {
    console.log('[SW] Instalando Service Worker...');

    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            console.log('[SW] Cacheando arquivos (best-effort)');
            for (const asset of CACHE_ASSETS) {
                try {
                    const req = new Request(asset, { cache: 'no-cache' });
                    const res = await fetch(req);
                    if (res && res.ok) await cache.put(req, res);
                    else console.warn('[SW] Falha ao cachear:', asset, res && res.status);
                } catch (e) {
                    console.warn('[SW] Erro ao buscar asset:', asset, e);
                }
            }
        } catch (err) {
            console.error('[SW] Erro durante install/cache:', err);
        }
        await self.skipWaiting();
    })());
});

// Ativação - limpar caches antigos
self.addEventListener('activate', (event) => {
    console.log('[SW] Ativando Service Worker...');
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('[SW] Removendo cache antigo:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Permitir skipWaiting sob demanda
self.addEventListener('message', (event) => {
    try {
        const data = event.data || {};
        if (data && data.type === 'SKIP_WAITING') {
            self.skipWaiting();
        }
    } catch (e) { /* ignore */ }
});

// Fetch - estratégia Cache First com Network Fallback
self.addEventListener('fetch', (event) => {
    // Ignorar requisições não-GET
    if (event.request.method !== 'GET') return;

    // Ignorar URLs externas
    if (!event.request.url.startsWith(self.location.origin)) return;

    const url = new URL(event.request.url);
    const isDocument = event.request.mode === 'navigate' || event.request.destination === 'document' || url.pathname.endsWith('/index-refatorado.html');
    const isCriticalAsset = isDocument || url.pathname.endsWith('/app-refatorado.js') || url.pathname.endsWith('/styles.css');

    // Para HTML e assets críticos: Network First com fallback para cache
    if (isCriticalAsset) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(event.request);
                    return cached || caches.match('./index-refatorado.html');
                })
        );
        return;
    }

    // Demais recursos: Cache First com atualização em background
    event.respondWith(
        caches.match(event.request)
            .then(cachedResponse => {
                if (cachedResponse) {
                    // Atualizar cache em background
                    fetch(event.request).then(response => {
                        if (response.ok) {
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, response);
                            });
                        }
                    }).catch(() => {});
                    return cachedResponse;
                }
                return fetch(event.request)
                    .then(response => {
                        if (response.ok) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, responseClone);
                            });
                        }
                        return response;
                    })
                    .catch(() => caches.match('./index-refatorado.html'));
            })
    );
});

// Sincronização em background (quando voltar online)
self.addEventListener('sync', (event) => {
    console.log('[SW] Sincronização em background:', event.tag);
    
    if (event.tag === 'sync-data') {
        event.waitUntil(syncData());
    }
});

// Notificações push (preparação futura)
self.addEventListener('push', (event) => {
    console.log('[SW] Push recebido:', event);
    
    const options = {
        body: event.data ? event.data.text() : 'Nova atualização disponível',
        icon: './icon-192.png',
        badge: './badge-72.png',
        vibrate: [200, 100, 200],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        }
    };

    event.waitUntil(
        self.registration.showNotification('Controle de Ponto', options)
    );
});

// Função auxiliar de sincronização — lê dados pendentes do localStorage e envia ao Firestore
async function syncData() {
    try {
        // Notificar todos os clientes (abas) para que tentem sincronizar via FirebaseSync
        const allClients = await self.clients.matchAll({ type: 'window' });
        for (const client of allClients) {
            client.postMessage({ type: 'SYNC_REQUEST' });
        }
        return Promise.resolve();
    } catch (error) {
        return Promise.reject(error);
    }
}
