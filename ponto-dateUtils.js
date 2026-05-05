/**
 * dateUtils.js - Utilitários centralizados para datas e horas
 */

const DateUtils = {
    /**
     * Normaliza uma data em qualquer formato comum para YYYY-MM-DD
     */
    normalize(str) {
        if (!str) return '';
        // Se for Date, converter para ISO
        if (str instanceof Date) {
            return str.toISOString().split('T')[0];
        }
        // Garantir que é string antes de chamar .trim()
        if (typeof str !== 'string') {
            str = String(str);
        }
        let s = str.trim();

        // Se vier com hora (ISO completo ou com espaço), mantém só a parte da data
        if (s.includes('T')) {
            s = s.split('T')[0];
        } else if (s.includes(' ')) {
            // exemplo: 2024-10-01 08:00:00
            s = s.split(' ')[0];
        }

        // DD/MM/YYYY
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
            const [d, m, a] = s.split('/');
            return `${a}-${m}-${d}`;
        }

        // DD-MM-YYYY
        if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
            const [d, m, a] = s.split('-');
            return `${a}-${m}-${d}`;
        }

        // YYYY/MM/DD
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
            const [a, m, d] = s.split('/');
            return `${a}-${m}-${d}`;
        }

        // YYYY-M-D ou YYYY-MM-DD (já no formato correto, apenas normaliza padding)
        if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
            const [a, m, d] = s.split('-');
            return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }

        return s;
    },

    /**
     * Parse data flexível (aceita múltiplos formatos)
     * Cria data na meia-noite local (não UTC) para comparações consistentes
     */
    parse(str) {
        if (!str) return null;
        const normalized = this.normalize(str);
        const [year, month, day] = normalized.split('-').map(Number);
        
        if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
        
        // Cria data na meia-noite da timezone local
        const d = new Date(year, month - 1, day, 0, 0, 0, 0);
        return !isNaN(d.getTime()) ? d : null;
    },

    /**
     * Converte tempo HH:MM para minutos totais
     */
    timeToMinutes(timeStr) {
        if (!timeStr) return null;
        const [h, m] = timeStr.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
    },

    /**
     * Converte minutos para HH:MM
     */
    minutesToTime(totalMinutes) {
        const signal = totalMinutes < 0 ? '-' : '';
        const abs = Math.abs(totalMinutes);
        const h = Math.floor(abs / 60);
        const m = abs % 60;
        return `${signal}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },

    /**
     * Verifica se é dia útil (segunda a sexta)
     */
    isBusinessDay(dateObj) {
        if (!(dateObj instanceof Date)) return false;
        const dow = dateObj.getDay();
        return dow !== 0 && dow !== 6;
    },

    /**
     * Calcula diferença entre dois horários em minutos
     */
    timeDifference(startTime, endTime) {
        const start = this.timeToMinutes(startTime);
        const end = this.timeToMinutes(endTime);
        
        if (start === null || end === null) return null;
        
        return end - start;
    },

    /**
     * Obtém data ISO do formato string
     */
    getIsoDate(dateObj) {
        if (typeof dateObj === 'string') return dateObj;
        if (!(dateObj instanceof Date)) return null;
        return dateObj.toISOString().split('T')[0];
    },

    /**
     * Formata string de data (qualquer formato aceito por normalize/parse) em DD/MM/YYYY
     */
    formatBR(str) {
        if (!str) return '';
        const d = this.parse(str);
        if (!d) return str;
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = d.getFullYear();
        return `${dia}/${mes}/${ano}`;
    },

    /**
     * Obtém data atual em formato YYYY-MM-DD
     */
    today() {
        return this.getIsoDate(new Date());
    },

    /**
     * Formata data para display
     */
    format(dateStr, pattern = 'DD/MM/YYYY') {
        const normalized = this.normalize(dateStr);
        const d = this.parse(normalized);
        if (!d) return dateStr;

        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');

        return pattern
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day);
    }
    ,
    /**
     * Formata data/hora ISO para 'DD/MM/YYYY HH:MM'
     */
    formatDateTime(isoDateTime) {
        if (!isoDateTime) return '';
        const d = new Date(isoDateTime);
        if (isNaN(d.getTime())) return isoDateTime;
        const dia = String(d.getDate()).padStart(2, '0');
        const mes = String(d.getMonth() + 1).padStart(2, '0');
        const ano = d.getFullYear();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${dia}/${mes}/${ano} ${hh}:${mm}`;
    }
};
