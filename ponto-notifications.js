/**
 * notifications.js - Sistema de notificações toast modernas
 * Substitui alert() nativo por mensagens mais amigáveis
 */

const Notifications = {
    container: null,

    /**
     * Inicializa o container de notificações
     */
    init() {
        if (this.container) return;
        
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
    },

    /**
     * Mostra uma notificação toast
     * @param {string} message - Mensagem a exibir
     * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
     * @param {number} duration - Duração em ms (0 = permanente)
     */
    show(message, type = 'info', duration = 4000, opts) {
        this.init();

        const toast = document.createElement('div');
        toast.className = `toast toast-${type} toast-enter`;

        // Ícone baseado no tipo
        const icons = {
            success: (typeof svgIcon === 'function') ? svgIcon('check', 'Sucesso') : '✓',
            error: (typeof svgIcon === 'function') ? svgIcon('close', 'Erro') : '✖',
            warning: (typeof svgIcon === 'function') ? svgIcon('help', 'Aviso') : '⚠',
            info: (typeof svgIcon === 'function') ? svgIcon('help', 'Informação') : 'i'
        };

        // Build inner content, allow optional undo action via opts.onUndo
        const iconHtml = icons[type] || icons.info;
        toast.innerHTML = '';
        const spanIcon = document.createElement('span');
        spanIcon.className = 'toast-icon';
        spanIcon.innerHTML = iconHtml;
        toast.appendChild(spanIcon);

        const spanMsg = document.createElement('span');
        spanMsg.className = 'toast-message';
        spanMsg.innerHTML = this.escapeHtml(message);
        toast.appendChild(spanMsg);

        // optional undo button
        if (opts && typeof opts.onUndo === 'function') {
            const btnUndo = document.createElement('button');
            btnUndo.className = 'toast-undo';
            btnUndo.type = 'button';
            btnUndo.textContent = (opts.undoLabel) ? opts.undoLabel : 'Desfazer';
            btnUndo.addEventListener('click', () => {
                try { opts.onUndo(); } catch(e){ console.warn('undo failed', e); }
                this.close(toast);
            });
            toast.appendChild(btnUndo);
        }

        const btnClose = document.createElement('button');
        btnClose.className = 'toast-close';
        btnClose.type = 'button';
        btnClose.innerHTML = (typeof svgIcon === 'function') ? svgIcon('close', 'Fechar notificação') : '×';
        btnClose.addEventListener('click', () => this.close(toast));
        toast.appendChild(btnClose);

        this.container.appendChild(toast);

        // Animação de entrada
        setTimeout(() => toast.classList.remove('toast-enter'), 10);

        // Auto-remover após duração
        if (duration > 0) {
            setTimeout(() => this.close(toast), duration);
        }

        return toast;
    },

    /**
     * Fecha uma notificação específica
     */
    close(toast) {
        if (!toast || !toast.parentElement) return;
        
        toast.classList.add('toast-exit');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 300);
    },

    /**
     * Atalhos para tipos específicos
     */
    success(message, duration) {
        return this.show(message, 'success', duration);
    },

    error(message, duration) {
        return this.show(message, 'error', duration);
    },

    warning(message, duration) {
        return this.show(message, 'warning', duration);
    },

    info(message, duration) {
        return this.show(message, 'info', duration);
    },

    /**
     * Confirmação com callback
     */
    confirm(message, onConfirm, onCancel) {
        this.init();

        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = `
            <div class="confirm-header">
                <span class="confirm-icon">❓</span>
                <h3>Confirmação</h3>
            </div>
            <div class="confirm-body">
                <p>${this.escapeHtml(message)}</p>
            </div>
            <div class="confirm-footer">
                <button class="btn-secondary confirm-cancel">Cancelar</button>
                <button class="btn-primary confirm-ok">Confirmar</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Animação de entrada
        setTimeout(() => overlay.classList.add('confirm-visible'), 10);

        // Handlers
        const close = (confirmed) => {
            overlay.classList.remove('confirm-visible');
            setTimeout(() => {
                if (overlay.parentElement) {
                    overlay.parentElement.removeChild(overlay);
                }
            }, 300);

            if (confirmed && onConfirm) onConfirm();
            if (!confirmed && onCancel) onCancel();
        };

        dialog.querySelector('.confirm-ok').onclick = () => close(true);
        dialog.querySelector('.confirm-cancel').onclick = () => close(false);
        overlay.onclick = (e) => {
            if (e.target === overlay) close(false);
        };

        // ESC para cancelar
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                close(false);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    },

    /**
     * Escapa HTML para prevenir XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Limpa todas as notificações
     */
    clearAll() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
};

// Inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Notifications.init());
} else {
    Notifications.init();
}
