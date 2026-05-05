/**
 * utils.js - Funções utilitárias gerais
 * Inclui debounce, throttle e outras helpers
 */

const Utils = {
    /**
     * Debounce - Executa função após delay sem novas chamadas
     * @param {Function} func - Função a executar
     * @param {number} wait - Tempo de espera em ms
     * @param {boolean} immediate - Executar imediatamente na primeira chamada
     */
    debounce(func, wait = 300, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };
            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
            if (callNow) func.apply(context, args);
        };
    },

    /**
     * Throttle - Limita execuções a uma por intervalo
     * @param {Function} func - Função a executar
     * @param {number} limit - Intervalo mínimo em ms
     */
    throttle(func, limit = 300) {
        let inThrottle;
        return function executedFunction(...args) {
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    /**
     * Sanitiza HTML para prevenir XSS
     * @param {string} text - Texto a sanitizar
     */
    sanitizeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Escapa caracteres especiais HTML para uso em template literals (XSS-safe).
     * Centralizado aqui para evitar duplicação em múltiplos módulos.
     * @param {string} s - Valor a escapar
     */
    escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    },

    /**
     * Formata número com padding
     * @param {number} num - Número
     * @param {number} size - Tamanho mínimo
     */
    pad(num, size = 2) {
        return String(num).padStart(size, '0');
    },

    /**
     * Copia texto para clipboard
     * @param {string} text - Texto a copiar
     */
    async copyToClipboard(text) {
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(text);
                return true;
            } else {
                // Fallback para navegadores antigos
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                return success;
            }
        } catch (err) {
            console.error('Erro ao copiar:', err);
            return false;
        }
    },

    /**
     * Formata bytes em formato legível
     * @param {number} bytes - Bytes
     * @param {number} decimals - Casas decimais
     */
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
    },

    /**
     * Download de arquivo
     * @param {string} content - Conteúdo do arquivo
     * @param {string} filename - Nome do arquivo
     * @param {string} type - MIME type
     */
    downloadFile(content, filename, type = 'text/plain') {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    },

    /**
     * Verifica se dispositivo é mobile
     */
    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
        );
    },

    /**
     * Verifica se está online
     */
    isOnline() {
        return navigator.onLine;
    },

    /**
     * Gera ID único
     */
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    /**
     * Deep clone de objeto
     * @param {any} obj - Objeto a clonar
     */
    deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => this.deepClone(item));
        if (obj instanceof Object) {
            const clonedObj = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = this.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    },

    /**
     * Retry com backoff exponencial
     * @param {Function} fn - Função a executar
     * @param {number} maxRetries - Máximo de tentativas
     * @param {number} delay - Delay inicial em ms
     */
    async retry(fn, maxRetries = 3, delay = 1000) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
    },

    /**
     * Formata data para exibição
     * @param {string} dateStr - Data no formato YYYY-MM-DD
     */
    formatDateDisplay(dateStr) {
        if (!dateStr) return '';
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    },

    /**
     * Valida e-mail
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },

    /**
     * Agrupa array por propriedade
     * @param {Array} array - Array a agrupar
     * @param {string|Function} key - Chave ou função
     */
    groupBy(array, key) {
        return array.reduce((result, item) => {
            const group = typeof key === 'function' ? key(item) : item[key];
            if (!result[group]) result[group] = [];
            result[group].push(item);
            return result;
        }, {});
    }
};

/**
 * Função para gerar ícones SVG padronizados
 * @param {string} iconName - Nome do ícone (edit, trash, plus, check, etc)
 * @param {string|object} titleOrOptions - Título para acessibilidade ou objeto de opções
 */
function svgIcon(iconName, titleOrOptions = '') {
    const options = typeof titleOrOptions === 'string' 
        ? { title: titleOrOptions, color: 'currentColor' }
        : { title: '', color: 'currentColor', ...titleOrOptions };
    
    const { title, color } = options;
    const titleAttr = title ? ` aria-label="${title}"` : '';
    
    const icons = {
        edit: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
        trash: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
        plus: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><path d="M12 5v14M5 12h14"/></svg>`,
        check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><path d="M20 6L9 17l-5-5"/></svg>`,
        calendar: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
        timer: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
        help: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r="0.5" fill="${color}"/></svg>`,
        close: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"${titleAttr}><path d="M18 6L6 18M6 6l12 12"/></svg>`
    };
    
    return icons[iconName] || icons.help;
}

// Exportar para uso global
window.Utils = Utils;
window.svgIcon = svgIcon;
