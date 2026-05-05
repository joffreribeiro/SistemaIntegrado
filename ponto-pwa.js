/**
 * pwa.js - Gerenciamento de PWA (Progressive Web App)
 * Registra service worker e gerencia instalação
 */

const PWA = {
    deferredPrompt: null,
    isInstalled: false,

    /**
     * Inicializa PWA
     */
    init() {
        this.registerServiceWorker();
        this.setupInstallPrompt();
        this.checkInstallStatus();
        this.setupUpdateNotification();
    },

    /**
     * Registra Service Worker
     */
    async registerServiceWorker() {
        // Skip service worker registration on unsupported protocols (file:// or null origin)
        if (location.protocol === 'file:' || location.origin === 'null') {
            console.log('[PWA] Ambiente local (file://) detectado — registro de Service Worker ignorado');
            return;
        }

        if (!('serviceWorker' in navigator)) {
            console.log('[PWA] Service Worker não suportado');
            return;
        }

        try {
            const registration = await navigator.serviceWorker.register('./sw.js');
            console.log('[PWA] Service Worker registrado:', registration);

            // Verificar atualizações
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        this.showUpdateNotification();
                    }
                });
            });
        } catch (error) {
            console.error('[PWA] Erro ao registrar Service Worker:', error);
        }
    },

    /**
     * Configura prompt de instalação
     */
    setupInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            console.log('[PWA] Prompt de instalação disponível');
            e.preventDefault();
            this.deferredPrompt = e;
            this.showInstallButton();
        });

        window.addEventListener('appinstalled', () => {
            console.log('[PWA] App instalado');
            this.isInstalled = true;
            this.hideInstallButton();
            Notifications.success('🎉 App instalado com sucesso!');
        });
    },

    /**
     * Mostra botão de instalação
     */
    showInstallButton() {
        let btn = document.getElementById('pwa-install-btn');
        
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'pwa-install-btn';
            btn.className = 'btn-primary pwa-install';
            btn.innerHTML = '📱 Instalar App';
            btn.onclick = () => this.promptInstall();
            
            // Adicionar no header
            const header = document.querySelector('header');
            if (header) {
                header.appendChild(btn);
            }
        }

        btn.style.display = 'inline-flex';
    },

    /**
     * Esconde botão de instalação
     */
    hideInstallButton() {
        const btn = document.getElementById('pwa-install-btn');
        if (btn) {
            btn.style.display = 'none';
        }
    },

    /**
     * Solicita instalação
     */
    async promptInstall() {
        if (!this.deferredPrompt) {
            Notifications.info('App já está instalado ou não pode ser instalado neste navegador');
            return;
        }

        this.deferredPrompt.prompt();
        
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log('[PWA] Resultado da instalação:', outcome);

        if (outcome === 'accepted') {
            Notifications.success('✅ Instalando aplicativo...');
        }

        this.deferredPrompt = null;
        this.hideInstallButton();
    },

    /**
     * Verifica se já está instalado
     */
    checkInstallStatus() {
        // PWA instalado via display-mode
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
        
        // iOS Safari
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isIOSStandalone = isIOS && window.navigator && !!window.navigator.standalone;

        this.isInstalled = isStandalone || isIOSStandalone;

        if (this.isInstalled) {
            console.log('[PWA] App está rodando como instalado');
            this.hideInstallButton();
        }
    },

    /**
     * Mostra notificação de atualização
     */
    showUpdateNotification() {
        Notifications.confirm(
            '🔄 Nova versão disponível! Deseja atualizar agora?',
            () => {
                window.location.reload();
            }
        );
    },

    /**
     * Configura notificação de atualização
     */
    setupUpdateNotification() {
        let refreshing = false;
        
        navigator.serviceWorker?.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        });
    },

    /**
     * Verifica status online/offline
     */
    setupOnlineStatus() {
        window.addEventListener('online', () => {
            Notifications.success('🌐 Você está online novamente!');
            // Sincronizar dados pendentes
            this.syncPendingData();
        });

        window.addEventListener('offline', () => {
            Notifications.warning('📡 Você está offline. Dados serão salvos localmente.');
        });

        // Status inicial
        if (!navigator.onLine) {
            setTimeout(() => {
                Notifications.info('📡 Modo offline - dados salvos localmente');
            }, 1000);
        }
    },

    /**
     * Sincroniza dados pendentes
     */
    async syncPendingData() {
        if ('serviceWorker' in navigator && 'sync' in navigator.serviceWorker) {
            try {
                const registration = await navigator.serviceWorker.ready;
                await registration.sync.register('sync-data');
                console.log('[PWA] Sincronização agendada');
            } catch (error) {
                console.error('[PWA] Erro ao agendar sincronização:', error);
            }
        }
    },

    /**
     * Solicitar permissão para notificações
     */
    async requestNotificationPermission() {
        if (!('Notification' in window)) {
            console.log('[PWA] Notificações não suportadas');
            return false;
        }

        if (Notification.permission === 'granted') {
            return true;
        }

        if (Notification.permission !== 'denied') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }

        return false;
    },

    /**
     * Mostra notificação local
     */
    async showNotification(title, options = {}) {
        const hasPermission = await this.requestNotificationPermission();
        
        if (hasPermission && 'serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            registration.showNotification(title, {
                icon: './icon-192.png',
                badge: './icon-72.png',
                vibrate: [200, 100, 200],
                ...options
            });
        }
    }
};

// Inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        PWA.init();
        PWA.setupOnlineStatus();
    });
} else {
    PWA.init();
    PWA.setupOnlineStatus();
}
