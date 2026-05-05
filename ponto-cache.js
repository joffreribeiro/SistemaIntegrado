/**
 * cache.js - Sistema de cache para cálculos pesados
 * Melhora performance evitando recalcular dados repetidamente
 */

const Cache = {
    stores: {
        calculations: new Map(),
        dashboard: new Map(),
        timesheet: new Map()
    },
    
    ttl: {
        calculations: 5 * 60 * 1000, // 5 minutos
        dashboard: 2 * 60 * 1000,    // 2 minutos
        timesheet: 10 * 60 * 1000    // 10 minutos
    },

    /**
     * Gera chave de cache
     */
    generateKey(...args) {
        return JSON.stringify(args);
    },

    /**
     * Obtém valor do cache
     */
    get(storeName, key) {
        const store = this.stores[storeName];
        if (!store) return null;

        const cached = store.get(key);
        if (!cached) return null;

        // Verificar TTL
        const now = Date.now();
        if (now - cached.timestamp > this.ttl[storeName]) {
            store.delete(key);
            return null;
        }

        return cached.value;
    },

    /**
     * Armazena no cache
     */
    set(storeName, key, value) {
        const store = this.stores[storeName];
        if (!store) return;

        store.set(key, {
            value,
            timestamp: Date.now()
        });

        // Limitar tamanho do cache
        if (store.size > 100) {
            const firstKey = store.keys().next().value;
            store.delete(firstKey);
        }
    },

    /**
     * Executa função com cache
     */
    wrap(storeName, keyArgs, fn) {
        const key = this.generateKey(...keyArgs);
        
        // Tentar obter do cache
        const cached = this.get(storeName, key);
        if (cached !== null) {
            return cached;
        }

        // Executar função e cachear resultado
        const result = fn();
        this.set(storeName, key, result);
        return result;
    },

    /**
     * Invalidar cache específico
     */
    invalidate(storeName, key) {
        const store = this.stores[storeName];
        if (!store) return;

        if (key) {
            store.delete(key);
        } else {
            store.clear();
        }
    },

    /**
     * Invalidar todos os caches
     */
    invalidateAll() {
        Object.values(this.stores).forEach(store => store.clear());
    },

    /**
     * Estatísticas do cache
     */
    stats() {
        const stats = {};
        Object.entries(this.stores).forEach(([name, store]) => {
            stats[name] = {
                size: store.size,
                entries: Array.from(store.keys())
            };
        });
        return stats;
    },

    /**
     * Cache para cálculos de dashboard
     */
    getDashboardTotals(registros, eventos, acordos, calculationFn) {
        return this.wrap(
            'dashboard',
            [registros.length, eventos.length, acordos.length],
            () => calculationFn(registros, eventos, acordos)
        );
    },

    /**
     * Cache para cálculo de dia específico
     */
    getDayCalculation(date, registro, allData, calculationFn) {
        return this.wrap(
            'calculations',
            [date, registro, allData.registros.length],
            () => calculationFn(allData.registros, allData.eventos, allData.acordos, date, registro)
        );
    },

    /**
     * Cache para timesheet de acordo
     */
    getTimesheetData(acordoIndex, periodos, calculationFn) {
        return this.wrap(
            'timesheet',
            [acordoIndex, JSON.stringify(periodos)],
            calculationFn
        );
    }
};

/**
 * Memoização para funções puras
 */
function memoize(fn) {
    const cache = new Map();
    
    return function memoized(...args) {
        const key = JSON.stringify(args);
        
        if (cache.has(key)) {
            return cache.get(key);
        }
        
        const result = fn.apply(this, args);
        cache.set(key, result);
        
        // Limitar tamanho
        if (cache.size > 50) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
        
        return result;
    };
}
