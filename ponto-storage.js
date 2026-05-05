/**
 * storage.js - Persistência com Firestore como fonte primária
 * localStorage serve apenas como cache offline / fallback de leitura
 * Inclui controle de conflitos via updatedAt e fila de saves
 */

const STORAGE_KEY = 'controle_ponto_avancado_v1';

const Storage = {
    _saveTimer: null,
    _saving: false,
    _pendingSave: null,   // fila: guarda o último dado pendente enquanto um save está em curso

    /**
     * Dados padrão/esquema
     */
    DEFAULT_DATA: {
        registros: [],
        configuracoes: {
            tipoJornada: 44,
            entradaPadrao: '',
            saidaPadrao: '',
            almocoMinutos: 60,
            toleranciaAtraso: 5,
            inicioPeriodoBanco: '',
            fimPeriodoBanco: ''
        },
        eventos: [],
        acordos: [],
        tiposEvento: [
            { id: 'feriado', nome: 'Feriado', cor: '#dc2626' },
            { id: 'ferias', nome: 'Férias', cor: '#d97706' },
            { id: 'afastamento', nome: 'Afastamento', cor: '#0891b2' },
            { id: 'viagem', nome: 'Viagem', cor: '#7c3aed' },
            { id: 'abono_acordo', nome: 'Abono (acordo)', cor: '#059669' },
            { id: 'compensar_acordo', nome: 'Pagar Hora (acordo)', cor: '#db2777' },
            { id: 'outro', nome: 'Outro', cor: '#64748b' }
        ],
        updatedAt: 0
    },

    // ──────────────────────────────────────────────
    //  LOAD
    // ──────────────────────────────────────────────

    /**
     * Carrega dados do Firestore (se logado); fallback para localStorage.
     * Retorna Promise<Object>.
     */
    async loadAsync() {
        try {
            if (window.FirebaseSync && typeof window.FirebaseSync.loadFromFirestore === 'function') {
                const cloud = await window.FirebaseSync.loadFromFirestore();
                if (cloud && this.isValidDataStructure(cloud)) {
                    // Atualizar cache local
                    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud)); } catch(_){}
                    return this._ensureDefaults(cloud);
                }
            }
        } catch (_) { /* Firestore indisponível — fallback local */ }
        return this.loadLocal();
    },

    /**
     * Carrega do localStorage (síncrono — usado antes do login).
     */
    load() {
        return this.loadLocal();
    },

    loadLocal() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return this.getDefaultData();
            const parsed = JSON.parse(raw);
            if (!this.isValidDataStructure(parsed)) return this.getDefaultData();
            return this._ensureDefaults(parsed);
        } catch (_) {
            return this.getDefaultData();
        }
    },

    _ensureDefaults(dados) {
        if (!dados.tiposEvento || !Array.isArray(dados.tiposEvento)) {
            dados.tiposEvento = JSON.parse(JSON.stringify(this.DEFAULT_DATA.tiposEvento));
        }
        if (!dados.updatedAt) dados.updatedAt = 0;
        return dados;
    },

    // ──────────────────────────────────────────────
    //  SAVE — Firestore (primário) + localStorage (cache)
    //  Com controle de conflitos (updatedAt) e fila de saves
    // ──────────────────────────────────────────────

    /**
     * Salva dados no Firestore E no localStorage.
     * Adiciona timestamp updatedAt automaticamente.
     */
    save(dados) {
        try {
            if (!this.isValidDataStructure(dados)) return false;

            // Marcar timestamp de atualização
            dados.updatedAt = Date.now();

            // Cache local (síncrono)
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(dados)); } catch(_){}

            // Firestore (assíncrono com fila)
            this._enqueueFirestoreSave(dados);

            return true;
        } catch (_) {
            return false;
        }
    },

    /**
     * Fila de saves: se um save está em curso, guarda o mais recente
     * e dispara quando o anterior terminar. Nunca descarta o último save.
     */
    _enqueueFirestoreSave(dados) {
        if (!window.FirebaseSync || typeof window.FirebaseSync.saveToFirestore !== 'function') return;

        if (this._saving) {
            // Já há um save em curso — guardar este como pendente (substitui anterior pendente)
            this._pendingSave = JSON.parse(JSON.stringify(dados));
            return;
        }

        this._saving = true;
        window.FirebaseSync.saveToFirestore(dados)
            .catch(_ => {})
            .finally(() => {
                this._saving = false;
                // Se acumulou um save pendente, disparar agora
                if (this._pendingSave) {
                    const pending = this._pendingSave;
                    this._pendingSave = null;
                    this._enqueueFirestoreSave(pending);
                }
            });
    },

    /**
     * Salva com debounce
     */
    saveDebounced(dados, delay = 1000) {
        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            this.save(dados);
            this._saveTimer = null;
        }, delay);
    },

    // ──────────────────────────────────────────────
    //  UTILS
    // ──────────────────────────────────────────────

    getDefaultData() {
        return JSON.parse(JSON.stringify(this.DEFAULT_DATA));
    },

    isValidDataStructure(dados) {
        if (!dados || typeof dados !== 'object') return false;
        return (
            Array.isArray(dados.registros) &&
            typeof dados.configuracoes === 'object' &&
            Array.isArray(dados.eventos) &&
            Array.isArray(dados.acordos)
        );
    },

    clear() {
        try { localStorage.removeItem(STORAGE_KEY); } catch(_){}
        return true;
    },

    export(dados) {
        try { return JSON.stringify(dados, null, 2); } catch(_) { return null; }
    },

    import(jsonStr) {
        try {
            const parsed = JSON.parse(jsonStr);
            if (!this.isValidDataStructure(parsed)) throw new Error('Estrutura inválida');
            return parsed;
        } catch (_) { return null; }
    }
};
