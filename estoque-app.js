// ── WRAPPER: encapsula o módulo de estoque para evitar conflitos de nomes globais ──
(function(window) {
'use strict';
// Salva referências globais que o estoque pode sobrescrever
var _pontoInicializar = window.inicializar;
// ========================================
// SISTEMA DE CONTROLE DE ESTOQUE
// Material Bélico - v2.0
// ========================================

// ----------------------------------------
// Variáveis globais de dados — declaradas aqui para garantir disponibilidade em todo o arquivo
// ----------------------------------------
let estoque = {};
let clientes = [];
let propostas = [];
let precificacoesCliente = [];

// ----------------------------------------
// Utilitários globais (declarados primeiro para uso em todo o arquivo)
// ----------------------------------------
function _escapeHtml(texto) {
    return String(texto || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function aplicarDesconto(inputDesconto) {
    const row = inputDesconto.closest('.item-venda-row') || inputDesconto.closest('.item-proposta-row');
    if (!row) return;
    const prodSelect = row.querySelector('.item-produto');
    const valorInput = row.querySelector('.item-valor');
    if (!prodSelect || !valorInput) return;

    // resolver nome do produto a partir do id/valor do select
    const prodVal = prodSelect.value;
    let nomeProduto = prodVal;
    const produtoObj = (estoque.produtos || []).find(p => String(p.id) === String(prodVal) || p.nome === prodVal);
    if (produtoObj) nomeProduto = produtoObj.nome;

    const descPct = parseFloat(inputDesconto.value) || 0;
    const precoBase = parseFloat((valorInput.dataset.original || String(valorInput.value)).toString().replace(/\./g, '').replace(',', '.')) || 0;
    const descontoMax = precificacao[nomeProduto] ? parseFloat(precificacao[nomeProduto].descontoMaximo) : null;

    const novoPreco = precoBase * (1 - descPct / 100);
    valorInput.value = Number(novoPreco || 0).toFixed(2).replace('.', ',');

    // feedback visual se excedeu
    const badgeClass = 'badge-excedeu-desconto';
    if (descontoMax !== null && descPct > descontoMax) {
        valorInput.style.border = '2px solid #7c3aed';
        valorInput.style.background = '#f5f3ff';
        let badge = row.querySelector('.' + badgeClass);
        if (!badge) {
            badge = document.createElement('span');
            badge.className = badgeClass;
            badge.style.cssText = 'background:#7c3aed;color:#fff;padding:2px 8px;border-radius:10px;margin-left:8px;font-size:0.75rem';
            badge.innerText = 'Excede desconto máximo';
            inputDesconto.parentNode.appendChild(badge);
        }
    } else {
        valorInput.style.border = '';
        valorInput.style.background = '';
        const badge = row.querySelector('.' + badgeClass);
        if (badge) badge.remove();
    }

    try { calcularTotalProposta(); } catch (e) {}
}

function _escapeJsString(texto) {
    return String(texto || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function _fmtMoeda(v) {
    return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Estrutura de dados principal
if (location.hostname !== 'localhost') {
    // console.log = () => {};  // desativado para permitir depuração em produção
    console.debug = () => {};
}
// Flag para indicar que há dados locais alterados que ainda não foram sincronizados com o cloud
let _dadosAlterados = false;
// Marca que houve sincronização recente com o cloud (evita warning ao fechar)
let _cloudSyncedRecently = false;
// Feature flags: controlar painel debug e notificações automáticas do cloud
try { window.__SHOW_DEBUG_PANEL = window.__SHOW_DEBUG_PANEL || false; } catch(e) { window.__SHOW_DEBUG_PANEL = false; }
try { window.__SHOW_AUTO_UPDATE_NOTIFICATION = window.__SHOW_AUTO_UPDATE_NOTIFICATION || false; } catch(e) { window.__SHOW_AUTO_UPDATE_NOTIFICATION = false; }

// Atualiza contadores/badges relacionados às precificações (sidebar + elementos opcionais)
function atualizarIndicadoresPrecificacao() {
    try {
        const total = Array.isArray(precificacoesCliente) ? precificacoesCliente.length : 0;
        // atualizar badge na sidebar (botão Precificação)
        const navBtn = document.querySelector('.nav-item[data-tab="precificacao"]');
        if (navBtn) {
            let badge = document.getElementById('badgePrecificacoes');
            if (!badge) {
                badge = document.createElement('span');
                badge.id = 'badgePrecificacoes';
                badge.style.background = '#1e3a5f';
                badge.style.color = '#fff';
                badge.style.fontSize = '0.72rem';
                badge.style.padding = '2px 6px';
                badge.style.borderRadius = '999px';
                badge.style.marginLeft = '8px';
                badge.style.display = 'inline-block';
                badge.className = 'badge';
                navBtn.appendChild(badge);
            }
            badge.textContent = String(total);
            badge.style.display = total > 0 ? 'inline-block' : 'none';
        }

        // elementos opcionais na página (se existirem)
        const el1 = document.getElementById('precifTotalCount') || document.getElementById('precifCount');
        if (el1) el1.textContent = String(total);
    } catch (e) { console.warn('atualizarIndicadoresPrecificacao', e); }
}
// FIM AJUSTE PRECIFICAÇÃO
// RETID + Benefícios fiscais (estado por sessão de precificação)
let retidPorProduto = {};
let beneficioFiscalAtivo = false;
let beneficiosPorProduto = {};

const CATEGORIAS_PRODUTO = [
        'Arma Curta', 'Arma Longa', 'Acessório', 'Faca', 'Munição', 'Outro'
];

// Listeners para conectividade — atualiza banner e tenta sincronizar ao reconectar
try {
    window.addEventListener('online', () => {
        const banner = document.getElementById('offlineBanner');
        if (banner) banner.style.display = 'none';
        const dot = document.getElementById('fsDot');
        const txt = document.getElementById('fsText');
        // Tentar sincronizar com cloud ao reconectar
        try {
            if (dot) { dot.classList.remove('fs-offline'); dot.classList.add('fs-online'); }
            if (txt) txt.textContent = 'Reconectado — sincronizando...';
            scheduleCloudSaveDebounced();
        } catch(e) {}
        try { mostrarNotificacao('Conexão restaurada. Sincronizando dados...', 'success'); } catch(e){}
    });

    window.addEventListener('offline', () => {
        const banner = document.getElementById('offlineBanner');
        if (banner) banner.style.display = 'block';
        const dot = document.getElementById('fsDot');
        const txt = document.getElementById('fsText');
        if (dot) { dot.classList.remove('fs-online'); dot.classList.add('fs-offline'); }
        if (txt) txt.textContent = 'Offline — sem conexão';
        try { mostrarNotificacao('Conexão perdida. Dados sendo salvos localmente.', 'warning'); } catch(e){}
    });

    // Verificar estado inicial
    try {
        if (!navigator.onLine) {
            const banner = document.getElementById('offlineBanner');
            if (banner) banner.style.display = 'block';
        }
    } catch(e) {}
} catch(e) {}

let categoriaPorProduto = {};

// ----------------------------------------
// Debug helpers: overlay de erro e painel de diagnóstico
// (ajuda a capturar erros que antes eram suprimidos)
;(function(){
    function showRuntimeErrorOverlay(msg) {
        try {
            const id = 'runtime-error-overlay';
            let el = document.getElementById(id);
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.style.position = 'fixed';
                el.style.right = '12px';
                el.style.bottom = '12px';
                el.style.zIndex = 2000;
                el.style.maxWidth = '520px';
                el.style.background = 'rgba(220,38,38,0.95)';
                el.style.color = '#fff';
                el.style.padding = '12px';
                el.style.borderRadius = '8px';
                el.style.fontSize = '0.9rem';
                el.style.boxShadow = '0 8px 30px rgba(0,0,0,0.3)';
                el.style.whiteSpace = 'pre-wrap';
                el.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
                el.style.cursor = 'pointer';
                el.title = 'Clique para esconder este painel de erro';
                el.addEventListener('click', () => { el.style.display = 'none'; });
                (document.body || document.documentElement).appendChild(el);
            }
            const text = (typeof msg === 'string') ? msg : (msg && msg.stack) ? msg.stack : JSON.stringify(msg, null, 2);
            el.textContent = 'Erro em tempo de execução detectado:\n' + text;
        } catch (e) { try { console.error('Falha ao exibir overlay de erro', e); } catch(_){} }
    }

    function createDebugPanel(){
        try {
            if (!window.__SHOW_DEBUG_PANEL) return;
            const id = 'debug-panel-mini';
            if (document.getElementById(id)) return;
            const p = document.createElement('div');
            p.id = id;
            p.style.position = 'fixed';
            p.style.left = '12px';
            p.style.bottom = '12px';
            p.style.zIndex = 2000;
            p.style.background = 'rgba(15,23,42,0.95)';
            p.style.color = '#cbd5e1';
            p.style.padding = '10px';
            p.style.borderRadius = '8px';
            p.style.fontSize = '0.85rem';
            p.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)';
            p.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial';
            p.style.maxWidth = '360px';
            p.style.whiteSpace = 'nowrap';
            p.innerHTML = '<strong style="color:#fff;display:block;margin-bottom:6px">Debug</strong>' +
                '<div id="debug-panel-content">carregando...</div>' +
                '<div style="margin-top:8px;text-align:right"><button id="debug-copy-json" style="background:#1f2937;color:#fff;border:none;padding:6px 8px;border-radius:6px;cursor:pointer">Copiar JSON</button></div>';
            (document.body || document.documentElement).appendChild(p);
            document.getElementById('debug-copy-json')?.addEventListener('click', () => {
                try {
                    const raw = localStorage.getItem('estoqueArmasV2') || '{}';
                    navigator.clipboard?.writeText(raw);
                    mostrarNotificacao && mostrarNotificacao('JSON copiado para área de transferência', 'info');
                } catch(e) { showRuntimeErrorOverlay(e); }
            });
        } catch(e){}
    }

    function updateDebugPanel(){
        try {
            if (!window.__SHOW_DEBUG_PANEL) return;
            createDebugPanel();
            const el = document.getElementById('debug-panel-content');
            if (!el) return;
            const raw = localStorage.getItem('estoqueArmasV2');
            let parsed = null;
            try { parsed = raw ? JSON.parse(raw) : null; } catch(e) { parsed = null; }
            const cfgRaw = localStorage.getItem('configContrato');
            let cfg = null;
            try { cfg = cfgRaw ? JSON.parse(cfgRaw) : null; } catch(e){ cfg = cfgRaw; }
            const lines = [];
            lines.push('produtos: ' + (Array.isArray(parsed?.produtos) ? parsed.produtos.length : '-'));
            lines.push('registroVendas: ' + (Array.isArray(parsed?.registroVendas) ? parsed.registroVendas.length : '-'));
            lines.push('registroDistribuicao: ' + (Array.isArray(parsed?.registroDistribuicao) ? parsed.registroDistribuicao.length : '-'));
            lines.push('clientes: ' + (Array.isArray(parsed?.clientes) ? parsed.clients?.length || parsed?.clientes.length : '-'));
            lines.push('configContrato: ' + (cfg ? (cfg.proximo || '-') + '/' + (cfg.ano || '-') : 'ausente'));
            lines.push('abaAtiva: ' + (window.abaAtiva || '-'));
            el.textContent = lines.join('\n');
        } catch(e) { showRuntimeErrorOverlay(e); }
    }

    window.__showRuntimeErrorOverlay = showRuntimeErrorOverlay;
    window.__updateDebugPanel = updateDebugPanel;

    window.addEventListener('error', function(ev){ try { showRuntimeErrorOverlay(ev.error || ev.message || ev); console.error('Unhandled error', ev.error || ev.message || ev); } catch(e){} });
    window.addEventListener('unhandledrejection', function(ev){ try { showRuntimeErrorOverlay(ev.reason || ev); console.error('Unhandled rejection', ev.reason || ev); } catch(e){} });
    document.addEventListener('DOMContentLoaded', function(){ try { if (window.__SHOW_DEBUG_PANEL) setTimeout(updateDebugPanel, 400); } catch(e){} });
    // Garantir salvamento síncrono/local ao fechar a aba
    try { window.addEventListener('beforeunload', function(){ try { salvarDados({imediato:true}); } catch(e){} }); } catch(e) {}
})();
// ===== NCM / Predefinições fiscais =====
const NCM_PRODUTOS = {
    "9301.90.00": "Fuzil de assalto IMBEL",
    "9305.91.00": "Partes de armas de guerra 93.01",
    "9302.00.00": "Revólveres e pistolas",
    "9305.10.00": "Partes de revólveres ou pistolas",
    "8211.10.00": "Faca",
    "8201.40.00": "Machadinha"
};

const NCM_POR_CATEGORIA = {
    "FUZIL":      "9301.90.00",
    "PEÇAS":      "9305.91.00",
    "PISTOLA":    "9302.00.00",
    "REVÓLVER":   "9302.00.00",
    "CARABINA":   "9302.00.00",
    "CARREGADOR": "9305.10.00",
    "FACA":       "8211.10.00",
    "MACHADINHA": "8201.40.00"
};

const IMPOSTOS_FEDERAIS_POR_NCM = {
    "9301.90.00": { pis: 1.65, cofins: 7.60, ipi: 55.00 },
    "9305.91.00": { pis: 1.65, cofins: 7.60, ipi:  0.00 },
    "9302.00.00": { pis: 1.65, cofins: 7.60, ipi: 55.00 },
    "9305.10.00": { pis: 1.65, cofins: 7.60, ipi: 29.25 },
    "8211.10.00": { pis: 1.65, cofins: 7.60, ipi:  7.80 },
    "8201.40.00": { pis: 1.65, cofins: 7.60, ipi:  0.00 }
};

const ICMS_PJ_POR_NCM = {
    "9301.90.00": {
        AC:7, AL:7, AP:7, AM:7, BA:7, CE:7, DF:7, ES:7, GO:7,
        MA:7, MS:7, PA:7, PB:7, PR:12, PE:7, PI:7, RJ:12,
        RN:7, RS:12, RO:7, RR:7, SC:12, SP:12, SE:7, TO:7, MG:12
    },
    "9305.91.00": {
        AC:7, AL:7, AP:7, AM:7, BA:7, CE:7, DF:7, ES:7, GO:7,
        MA:7, MS:7, PA:7, PB:7, PR:12, PE:7, PI:7, RJ:12,
        RN:7, RS:12, RO:7, RR:7, SC:12, SP:12, SE:7, TO:7, MG:12
    },
    "9302.00.00": {
        AC:7, AL:7, AP:7, AM:7, BA:7, CE:7, DF:7, ES:7, GO:7,
        MA:7, MS:7, PA:7, PB:7, PR:12, PE:7, PI:7, RJ:12,
        RN:7, RS:12, RO:7, RR:7, SC:12, SP:12, SE:7, TO:7, MG:12
    },
    "9305.10.00": {
        AC:7, AL:7, AP:7, AM:7, BA:7, CE:7, DF:7, ES:7, GO:7,
        MA:7, MS:7, PA:7, PB:7, PR:12, PE:7, PI:7, RJ:12,
        RN:7, RS:12, RO:7, RR:7, SC:12, SP:12, SE:7, TO:7, MG:12
    },
    "8211.10.00": {
        AC:7, AL:7, AP:7, AM:7, BA:7, CE:7, DF:7, ES:7, GO:7,
        MA:7, MS:7, PA:7, PB:7, PR:12, PE:7, PI:7, RJ:12,
        RN:7, RS:12, RO:7, RR:7, SC:12, SP:12, SE:7, TO:7, MG:12
    },
    "8201.40.00": {
        AC:7, AL:7, AP:7, AM:7, BA:7, CE:7, DF:7, ES:7, GO:7,
        MA:7, MS:7, PA:7, PB:7, PR:12, PE:7, PI:7, RJ:12,
        RN:7, RS:12, RO:7, RR:7, SC:12, SP:12, SE:7, TO:7, MG:12
    }
};

const ICMS_PF_POR_NCM = {
    "9301.90.00": {
        AC:25, AL:29, AP:29, AM:25, BA:38, CE:28, DF:25, ES:25, GO:25,
        MA:30.5, MT:35, MS:25, PA:30, PB:25, PR:25, PE:27, PI:33,
        RJ:37, RN:25, RS:25, RO:25, RR:25, SC:25, SP:25, SE:28,
        TO:27, MG:25
    },
    "9305.91.00": {
        AC:19, AL:29, AP:29, AM:20, BA:20.5, CE:20, DF:20, ES:25, GO:25,
        MA:23, MT:35, MS:25, PA:30, PB:20, PR:25, PE:27, PI:22.5,
        RJ:37, RN:20, RS:25, RO:25, RR:25, SC:25, SP:25, SE:28,
        TO:20, MG:18
    },
    "9302.00.00": {
        AC:25, AL:29, AP:29, AM:25, BA:38, CE:28, DF:27, ES:25, GO:25,
        MA:30.5, MT:35, MS:25, PA:30, PB:25, PR:25, PE:27, PI:33,
        RJ:37, RN:25, RS:25, RO:25, RR:25, SC:25, SP:25, SE:28,
        TO:27, MG:25
    },
    "9305.10.00": {
        AC:19, AL:29, AP:29, AM:20, BA:20.5, CE:20, DF:20, ES:25, GO:25,
        MA:23, MT:35, MS:25, PA:30, PB:20, PR:25, PE:27, PI:22.5,
        RJ:37, RN:20, RS:25, RO:25, RR:25, SC:25, SP:25, SE:28,
        TO:20, MG:18
    },
    "8211.10.00": {
        AC:19, AL:19, AP:18, AM:20, BA:20.5, CE:20, DF:20, ES:17, GO:19,
        MA:23, MT:17, MS:17, PA:19, PB:20, PR:19.5, PE:20.5, PI:22.5,
        RJ:20, RN:20, RS:17, RO:19.5, RR:20, SC:17, SP:18, SE:19,
        TO:20, MG:18
    },
    "8201.40.00": {
        AC:19, AL:19, AP:18, AM:20, BA:20.5, CE:20, DF:20, ES:17, GO:19,
        MA:23, MT:17, MS:17, PA:19, PB:20, PR:19.5, PE:20.5, PI:22.5,
        RJ:20, RN:20, RS:17, RO:19.5, RR:20, SC:17, SP:18, SE:19,
        TO:20, MG:18
    }
};


let abaAtiva = 'estoque';

// Configuração de alertas (persistida separadamente)
let configAlertas = { limite: 5, ativo: true };

// Helper: cálculo de estoque/vendas/distribuições
function obterTotalVendasProduto(produto) {
    if (!produto) return 0;
    // Verificar se há registros detalhados para este produto específico (fonte de verdade)
    const registrosDesteProduto = Array.isArray(estoque.registroVendas)
        ? estoque.registroVendas.filter(v => {
            if (Array.isArray(v.items) && v.items.length) {
                return v.items.some(it =>
                    Number(it.produtoId) === Number(produto.id) ||
                    it.produto === produto.nome ||
                    it.produtoNome === produto.nome
                );
            }
            return Number(v.produtoId) === Number(produto.id) || v.produtoNome === produto.nome;
        })
        : [];
    if (registrosDesteProduto.length > 0) {
        return registrosDesteProduto.reduce((sum, v) => {
            if (Array.isArray(v.items) && v.items.length) {
                return sum + v.items.reduce((s, it) => {
                    if (Number(it.produtoId) === Number(produto.id) || (it.produto === produto.nome) || (it.produtoNome === produto.nome)) return s + (Number(it.quantidade) || 0);
                    return s;
                }, 0);
            }
            if (Number(v.produtoId) === Number(produto.id) || v.produtoNome === produto.nome) return sum + (Number(v.quantidade) || 0);
            return sum;
        }, 0);
    }
    // Fallback para agregado em produto.vendas quando não há registros para este produto
    if (!produto.vendas) return 0;
    return Object.keys(produto.vendas).reduce((s, k) => s + (Number(produto.vendas[k]) || 0), 0);
}

function obterDistribuicaoTotalExcluindoImbel(produto) {
    if (!produto) return 0;
    // Verificar se há registros de distribuição para este produto específico (fonte de verdade)
    const registrosDesteProduto = Array.isArray(estoque.registroDistribuicao)
        ? estoque.registroDistribuicao.filter(d =>
            Number(d.produtoId) === Number(produto.id) ||
            (d.produtoNome && d.produtoNome === produto.nome)
        )
        : [];
    if (registrosDesteProduto.length > 0) {
        return registrosDesteProduto.reduce((s, d) => {
            try {
                const rep = (d.representante || '').toString().toUpperCase();
                if (rep === 'IMBEL') return s;
                return s + (Number(d.quantidade) || 0);
            } catch (e) {
                console.warn('obterDistribuicaoTotalExcluindoImbel: erro ao processar registro', e);
                return s;
            }
        }, 0);
    }
    // Fallback para o objeto produto.distribuicao (legado) quando não há registros para este produto
    if (!produto.distribuicao) return 0;
    return Object.keys(produto.distribuicao).reduce((s, k) => {
        if ((k || '').toUpperCase() === 'IMBEL') return s;
        return s + (Number(produto.distribuicao[k]) || 0);
    }, 0);
}

function calcularSaldoConsolidado(produto) {
    if (!produto) return 0;
    const estoqueConc = Number(produto.estoqueConsolidado || 0);
    const vendas = obterTotalVendasProduto(produto);
    return estoqueConc - vendas;
}

function calcularImbelDisponivel(produto) {
    // Retornar o saldo disponível na IMBEL considerando:
    // estoque consolidado, distribuições (exceto IMBEL), devoluções para IMBEL
    // e apenas as vendas atribuídas à IMBEL — mantém coerência com `obterMetricasImbelProduto`.
    try {
        if (!produto) return 0;
        const met = obterMetricasImbelProduto(produto);
        return Number(met.imbelSaldo || 0);
    } catch (e) {
        return 0;
    }
}

// Calcula estoque disponível na IMBEL baseado exclusivamente em registros
function calcularEstoqueIMBEL(nomeProduto) {
    if (!nomeProduto) return 0;
    const produtos = estoque.produtos || [];
    const produto = produtos.find(p => {
        try {
            if (!p || !p.nome) return false;
            return p.nome.toString().toUpperCase() === nomeProduto.toString().toUpperCase();
        } catch (e) { return false; }
    });
    if (!produto) return 0;

    const estoqueTotal = Number(produto.estoqueConsolidado || produto.estoqueTotal || produto.estoque || 0);

    const totalDistribuido = (estoque.registroDistribuicao || []).reduce((sum, d) => {
        try {
            const match = (Number(d.produtoId) === Number(produto.id)) || ((d.produtoNome || '').toString().toUpperCase() === produto.nome.toString().toUpperCase());
            if (!match) return sum;
            const rep = (d.representante || '').toString().toUpperCase();
            if (rep === 'IMBEL') return sum; // não descontar distribuições para IMBEL
            return sum + (Number(d.quantidade) || 0);
        } catch (e) { return sum; }
    }, 0);

    const totalDevolvido = (estoque.registroDevolucoes || []).reduce((sum, d) => {
        try {
            const match = (Number(d.produtoId) === Number(produto.id)) || ((d.produtoNome || '').toString().toUpperCase() === produto.nome.toString().toUpperCase());
            if (!match) return sum;
            const destino = (d.destino || '').toString().toUpperCase();
            if (destino === 'IMBEL') return sum + (Number(d.quantidade) || 0);
        } catch (e) {
            console.warn('calcularEstoqueIMBEL: erro ao processar devolução', e);
        }
        return sum;
    }, 0);

    return estoqueTotal - totalDistribuido + totalDevolvido;
}

function obterMetricasImbelProduto(produto) {
    if (!produto) {
        return { estoqueTotal: 0, imbelDisp: 0, imbelVenda: 0, imbelSaldo: 0 };
    }

    const produtoId = produto.id;
    const estoqueTotal = Number(
        (produto.estoqueConsolidado ?? produto.estoqueTotal ?? produto.estoque ?? produto.qtdTotal ?? produto.estoqueInicial) || 0
    );

    const distPorRep = {};
    (estoque.registroDistribuicao || []).forEach(d => {
        try {
            if (Number(d.produtoId) === Number(produtoId) || (d.produtoNome && d.produtoNome === produto.nome)) {
                const r = (d.representante || '').toString().toUpperCase();
                distPorRep[r] = (distPorRep[r] || 0) + (Number(d.quantidade) || 0);
            }
        } catch (e) {
            console.warn('obterMetricasImbelProduto: erro ao processar distribuição', e);
        }
    });
    const totalDistribuido = Object.values(distPorRep).reduce((s, v) => s + v, 0);

    let totalDevolvidoParaImbel = 0;
    (estoque.registroDevolucoes || []).forEach(d => {
        try {
            if (Number(d.produtoId) === Number(produtoId) || (d.produtoNome && d.produtoNome === produto.nome)) {
                const destino = (d.destino || '').toString().toUpperCase();
                if (destino === 'IMBEL') totalDevolvidoParaImbel += (Number(d.quantidade) || 0);
            }
        } catch (e) {
            console.warn('obterMetricasImbelProduto: erro ao processar devolução', e);
        }
    });

    const vendasPorRep = {};
    let agregadoTemValores = false;
    if (produto.vendas && typeof produto.vendas === 'object') {
        Object.keys(produto.vendas).forEach(k => {
            const val = Number(produto.vendas[k]) || 0;
            if (val !== 0) agregadoTemValores = true;
            vendasPorRep[(k || '').toString().toUpperCase()] = val;
        });
    }
    
    if (!agregadoTemValores) {
        (estoque.registroVendas || []).forEach(v => {
            try {
                const rep = (v.representante || '').toString().toUpperCase();
                if (Array.isArray(v.items) && v.items.length) {
                    v.items.forEach(it => {
                        if (Number(it.produtoId) === Number(produtoId) || (it.produto === produto.nome) || (it.produtoNome === produto.nome)) {
                            vendasPorRep[rep] = (vendasPorRep[rep] || 0) + (Number(it.quantidade) || 0);
                        }
                    });
                } else if (Number(v.produtoId) === Number(produtoId) || (v.produtoNome === produto.nome)) {
                    vendasPorRep[rep] = (vendasPorRep[rep] || 0) + (Number(v.quantidade) || 0);
                }
            } catch (e) {
                console.warn('obterMetricasImbelProduto: erro ao processar venda', e);
            }
        });
    }

    const totalVendasProduto = Object.values(vendasPorRep).reduce((s, v) => s + v, 0);
    const consolidadoDisp = estoqueTotal;
    const consolidadoVenda = totalVendasProduto;
    const consolidadoSaldo = consolidadoDisp - consolidadoVenda;

    const imbelDisp = estoqueTotal - totalDistribuido + totalDevolvidoParaImbel;
    const imbelVenda = Number(vendasPorRep['IMBEL'] || 0);
    const imbelSaldo = imbelDisp - imbelVenda;

    return {
        estoqueTotal,
        imbelDisp,
        imbelVenda,
        imbelSaldo,
        consolidadoDisp,
        consolidadoVenda,
        consolidadoSaldo
    };
}

// Reconstrói o objeto `produto.distribuicao` a partir dos registros de distribuição e devolução
function reconstruirDistribuicaoAPartirDeRegistros() {
    if (!Array.isArray(estoque.produtos)) return;
    // Inicializar chaves
    estoque.produtos.forEach(p => {
        try {
            if (!p.distribuicao) p.distribuicao = {};
            (estoque.representantes || []).forEach(r => { p.distribuicao[r] = 0; });
            // manter IMBEL sempre 0 (é derivado)
            p.distribuicao.IMBEL = 0;
        } catch (e) {
            console.warn('reconstruirDistribuicaoAPartirDeRegistros: erro ao inicializar produto', e);
        }
    });

    // Somar todas as distribuições
    (estoque.registroDistribuicao || []).forEach(d => {
        try {
            const prod = estoque.produtos.find(p => Number(p.id) === Number(d.produtoId) || (d.produtoNome && p.nome === d.produtoNome));
            if (!prod) return;
            const rep = (d.representante || '').toString().toUpperCase();
            if (!rep) return;
            prod.distribuicao[rep] = (prod.distribuicao[rep] || 0) + (Number(d.quantidade) || 0);
        } catch (e) {
            console.warn('reconstruirDistribuicaoAPartirDeRegistros: erro ao processar distribuição', e);
        }
    });

    // Aplicar devoluções: subtrair do origem, somar para destino quando não for IMBEL
    (estoque.registroDevolucoes || []).forEach(dev => {
        try {
            const prod = estoque.produtos.find(p => Number(p.id) === Number(dev.produtoId) || (dev.produtoNome && p.nome === dev.produtoNome));
            if (!prod) return;
            const origem = (dev.origem || '').toString().toUpperCase();
            const destino = (dev.destino || '').toString().toUpperCase();
            prod.distribuicao[origem] = Math.max(0, (prod.distribuicao[origem] || 0) - (Number(dev.quantidade) || 0));
            if (destino && destino !== 'IMBEL') {
                prod.distribuicao[destino] = (prod.distribuicao[destino] || 0) + (Number(dev.quantidade) || 0);
            }
        } catch (e) {
            console.warn('reconstruirDistribuicaoAPartirDeRegistros: erro ao processar devolução', e);
        }
    });
}

// Função de diagnóstico disponível no console para inspecionar um produto rapidamente
function diagnosticarProduto(produtoId) {
    try {
        const p = estoque.produtos.find(x => Number(x.id) === Number(produtoId) || String(x.id) === String(produtoId));
        if (!p) { console.warn('Produto não encontrado:', produtoId); return null; }
        const estoqueConsolidado = Number(p.estoqueConsolidado) || 0;
        const totalDistribuido = (estoque.registroDistribuicao || []).reduce((s, d) => {
            try {
                if (Number(d.produtoId) === Number(p.id) || (d.produtoNome && d.produtoNome === p.nome)) return s + (Number(d.quantidade) || 0);
            } catch (e) {
                console.warn('diagnosticarProduto: erro ao processar distribuição', e);
            }
            return s;
        }, 0);
        const totalDevolvidoParaImbel = (estoque.registroDevolucoes || []).reduce((s, d) => {
            try {
                if ((Number(d.produtoId) === Number(p.id) || (d.produtoNome && d.produtoNome === p.nome)) && ((d.destino || '').toString().toUpperCase() === 'IMBEL')) return s + (Number(d.quantidade) || 0);
            } catch (e) {
                console.warn('diagnosticarProduto: erro ao processar devolução', e);
            }
            return s;
        }, 0);
        const totalVendas = obterTotalVendasProduto(p);
        const imbelDisponivel = estoqueConsolidado - totalDistribuido + totalDevolvidoParaImbel;
        const distribuicaoPorRep = {};
        (estoque.representantes || []).forEach(r => { distribuicaoPorRep[r] = p.distribuicao ? (p.distribuicao[r] || 0) : 0; });
        const result = { produtoId: p.id, nome: p.nome, estoqueConsolidado, totalDistribuido, totalDevolvidoParaImbel, totalVendas, imbelDisponivel, distribuicaoPorRep };
        console.debug('Diagnóstico do produto:', result);
        return result;
    } catch (e) { console.error('Erro no diagnóstico:', e); return null; }
}
window.diagnosticarProduto = diagnosticarProduto;

// Atalho por nome (útil para console): `diagnosticarProdutoPorNome("NOME DO PRODUTO")`
function diagnosticarProdutoPorNome(nome) {
    if (!nome) return null;
    const p = (estoque.produtos || []).find(x => (x.nome || '').toString().toUpperCase() === nome.toString().toUpperCase());
    if (!p) { console.warn('Produto não encontrado por nome:', nome); return null; }
    return diagnosticarProduto(p.id);
}
window.diagnosticarProdutoPorNome = diagnosticarProdutoPorNome;

// =============================
// Firebase (inicialização e helpers)
// =============================
// Atualiza o indicador visual de status do Firestore (presente no header)
function updateFirestoreStatus(connected, lastSyncDate, message) {
    try {
        const el = document.getElementById('firestoreStatus');
        const dot = document.getElementById('fsDot');
        const text = document.getElementById('fsText');
        if (!el || !dot || !text) return;
        if (connected) {
            dot.classList.remove('fs-offline');
            dot.classList.remove('fs-warning');
            dot.classList.add('fs-online');
            const label = message || 'Cloud: conectado';
            if (lastSyncDate) {
                const dt = (lastSyncDate instanceof Date) ? lastSyncDate : new Date(lastSyncDate);
                text.textContent = `${label} — último sync: ${dt.toLocaleString('pt-BR')}`;
            } else {
                text.textContent = message || 'Cloud: conectado — sem sync';
            }
        } else {
            dot.classList.remove('fs-online');
            dot.classList.remove('fs-warning');
            dot.classList.add('fs-offline');
            text.textContent = message || 'Cloud: desconectado';
        }
    } catch (e) {
        // ignore UI update errors
    }
}

try {
    if (typeof firebase !== 'undefined') {
        const firebaseConfig = {
            apiKey: "AIzaSyBizembCnAJpVe4TCcTTJvCickREOa_f1Y",
            authDomain: "estoquefi.firebaseapp.com",
            databaseURL: "https://estoquefi-default-rtdb.firebaseio.com",
            projectId: "estoquefi",
            storageBucket: "estoquefi.firebasestorage.app",
            messagingSenderId: "339770116384",
            appId: "1:339770116384:web:3b51acfbc9f18162c5af45",
            measurementId: "G-RVK6BC5TDP"
        };

        // Inicializa apenas se ainda não inicializado
        if (!firebase.apps || firebase.apps.length === 0) {
            firebase.initializeApp(firebaseConfig);
        }

        // Instância do Firestore para uso nas funções abaixo
        try {
            window.firestoreDB = firebase.firestore();
            // Não tentar ler do cloud antes da autenticação para evitar erros de permissão
            updateFirestoreStatus(true, null, 'Cloud: aguardando login');
        } catch (e) {
            console.warn('Firestore não disponível:', e);
            window.firestoreDB = null;
            updateFirestoreStatus(false, null, 'Cloud: não disponível');
        }
    } else {
        console.warn('Firebase SDK não carregado — funções cloud desativadas.');
        // atualizar UI se possível
        try { updateFirestoreStatus(false, null, 'SDK não carregado'); } catch (e) {}
    }
} catch (e) {
    console.error('Erro inicializando Firebase:', e);
}



// ID da venda que está sendo editada (null quando criando nova)
let vendaEditandoId = null;
// ID do produto que está sendo editado no modal de produto (null quando criando novo)
let produtoEditandoId = null;

// Dados iniciais com PREÇOS baseados na planilha - SEM dados de distribuição/vendas (zerados)
const dadosIniciais = [
    {
        nome: 'CARABINA IA2 5,56',
        preco: 10420.75,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'CARABINA IA2 7,62',
        preco: 12690.21,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'FACA CAMPANHA AMZ',
        preco: 360.00,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'FACA POLICIAL AMZ',
        preco: 352.45,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'FACA POLICIAL IA2',
        preco: 380.00,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'FUZIL DE ALTA PRECISÃO IMBEL 308 AGLC (COMPLETO)',
        preco: 13500.00,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'PISTOLA .40 GC MD7 C/ ADC',
        preco: 5159.71,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'PISTOLA 380 GC MD1 C/ ADC',
        preco: 5219.54,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'PISTOLA 380 GC MD1 S/ ADC',
        preco: 5406.19,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'PISTOLA 380 GC MD2 C/ ADC',
        preco: 5162.57,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'PISTOLA 380 GC MD2 S/ ADC',
        preco: 5207.87,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    },
    {
        nome: 'PISTOLA 9 GC MD1 S/ ADC',
        preco: 5236.30,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    }
];

// ========================================
// FUNÇÕES DE INICIALIZAÇÃO
// ========================================

function popularSelectRepresentantes(selectId, incluirImbel = true) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const reps = estoque.representantes || 
        ['KOLTE', 'ISA', 'LC', 'ADES', 'FL'];
    // evitar duplicar IMBEL caso esteja presente em `estoque.representantes`
    const repsSemImbel = reps.filter(r => String(r).toUpperCase() !== 'IMBEL');
    sel.innerHTML = '<option value="">Selecione...</option>'
        + (incluirImbel ? '<option value="IMBEL">IMBEL (Venda Direta)</option>' : '')
        + repsSemImbel.map(r => `<option value="${r}">${r}</option>`).join('');
}

function renderizarListaRepresentantesConfig() {
    const lista = document.getElementById('listaRepresentantesConfig');
    if (!lista) return;
    const reps = estoque.representantes || [];
    const repColors = {
        KOLTE:'#79c0ff', ISA:'#7ee787', LC:'#58a6ff',
        ADES:'#ffa657', FL:'#d2a8ff', IMBEL:'#ff7b72'
    };
    lista.innerHTML = reps.map(rep => {
        const cor = repColors[rep] || '#94a3b8';
        return `<span style="display:inline-flex;align-items:center;gap:6px;
                background:${cor}22;border:1px solid ${cor}66;border-radius:20px;
                padding:4px 12px;font-weight:700;font-size:0.85rem">
            ${rep}
            <button onclick="removerRepresentante('${rep}')"
                    style="background:none;border:none;cursor:pointer;
                           color:#94a3b8;font-size:0.9rem;padding:0"
                    onmouseover="this.style.color='#dc2626'"
                    onmouseout="this.style.color='#94a3b8'">×</button>
        </span>`;
    }).join('') || '<span style="color:#94a3b8;font-size:0.85rem">Nenhum representante cadastrado</span>';
}

function adicionarRepresentante() {
    const input = document.getElementById('novoRepresentante');
    const nome = (input?.value || '').trim().toUpperCase();
    if (!nome || nome.length < 2) {
        mostrarNotificacao('Nome inválido.', 'warning'); return;
    }
    if (!Array.isArray(estoque.representantes)) estoque.representantes = [];
    if (estoque.representantes.includes(nome)) {
        mostrarNotificacao(`${nome} já existe.`, 'warning'); return;
    }
    estoque.representantes.push(nome);
    // Adicionar chave nos produtos existentes
    (estoque.produtos||[]).forEach(p => {
        if (!p.distribuicao) p.distribuicao = {};
        if (!p.vendas) p.vendas = {};
        if (p.distribuicao[nome] === undefined) p.distribuicao[nome] = 0;
        if (p.vendas[nome] === undefined) p.vendas[nome] = 0;
    });
    if (input) input.value = '';
    salvarDados();
    renderizarListaRepresentantesConfig();
    // Atualizar todos os selects do sistema
    [
        'filtroRepresentante','filtroDistribuicaoRep','filtroControleEnvioRep',
        'filtroRelatoriosRep','representanteVendaDet','clienteRepresentante',
        'propostaRepresentante','representanteDistDet','precifRepresentanteSelect'
    ].forEach(id => popularSelectRepresentantes(id, true));
    mostrarNotificacao(`Representante ${nome} adicionado!`, 'success');
}

function removerRepresentante(nome) {
    const totalVendas = (estoque.registroVendas||[]).filter(v=>v.representante===nome).length;
    const totalDist   = (estoque.registroDistribuicao||[]).filter(d=>d.representante===nome).length;
    let aviso = `Remover ${nome}?`;
    if (totalVendas || totalDist) {
        aviso += `\n\n⚠️ Possui ${totalVendas} venda(s) e ${totalDist} distribuição(ões).\nO histórico será mantido.`;
    }
    if (!confirm(aviso)) return;
    estoque.representantes = (estoque.representantes||[]).filter(r => r !== nome);
    salvarDados();
    renderizarListaRepresentantesConfig();
    mostrarNotificacao(`Representante ${nome} removido.`, 'warning');
}

async function inicializar() {
    carregarDados();
    try { renderizarListaRepresentantesConfig(); } catch (e) {}
    try { carregarPrecificacoesSalvas(); } catch (e) {}
    // Load contract config into Configurações tab
    try {
        const cfg = carregarConfigContrato();
        const anoEl = document.getElementById('configContratoAno');
        const proxEl = document.getElementById('configContratoProximo');
        if (anoEl) anoEl.value = cfg.ano;
        if (proxEl) proxEl.value = cfg.proximo;
        atualizarPreviaContrato();
    } catch (e) {}
    try { verificarExpiracaoPrecificacoes(); } catch (e) {}
    try { inicializarImpostosPreDefinidos(); } catch (e) { console.warn('Inicialização de impostos predefinidos falhou:', e); }

    try { inicializarImpostosEditaveis(); } catch (e) {}
    try { inicializarICMSEditavel(); } catch (e) {}

    // Sync automático com cloud ocorre após autenticação (onAuthStateChanged)

    try { renderizarTabela(); } catch (e) { console.error('renderizarTabela:', e); }
    try { renderizarCadastroProdutos(); } catch (e) { console.error('renderizarCadastroProdutos:', e); }
    try { renderizarDashboard(); } catch (e) { console.error('renderizarDashboard:', e); }
    try { renderizarRegistroVendas(); } catch (e) { console.error('renderizarVendas:', e); }
    try { renderizarRegistroDistribuicao(); } catch (e) { console.error('renderizarDist:', e); }
    try { renderizarControleEnvio(); } catch (e) { console.error('renderizarEnvio:', e); }
    try { renderizarClientes(); } catch (e) { console.error('renderizarClientes:', e); }
    try { atualizarKPIsClientes(); } catch (e) {}
    try { atualizarDatalistClientes(); } catch (e) {}
    try { renderizarPropostas(); } catch (e) { console.error('renderizarPropostas:', e); }
    try { atualizarKPIsPropostas(); } catch (e) {}
    try { renderizarPrecificacao(); } catch (e) { console.error('renderizarPrecif:', e); }
    try { atualizarSelectsProdutos(); } catch (e) {}
    try { popularSelectProdutosPrecif(); } catch (e) {}
    try { atualizarSelectsRelatorios(); } catch (e) {}
    try { atualizarEstatisticas(); } catch (e) {}
    try { atualizarData(); } catch (e) {}

    // Popular selects visíveis de representantes (filtros) na inicialização
    try { popularSelectRepresentantes('filtroDistribuicaoRep', true); } catch (e) {}
    try { popularSelectRepresentantes('filtroRepresentante', true); } catch (e) {}
    try { popularSelectRepresentantes('filtroControleEnvioRep', true); } catch (e) {}
    try { popularSelectRepresentantes('filtroRelatoriosRep', true); } catch (e) {}
    try { popularSelectRepresentantes('precifRepresentanteSelect', true); } catch (e) {}
    

    // Check proposal alerts every hour
    if (!window.__PROPOSTA_ALERTAS_INTERVALO__) {
        window.__PROPOSTA_ALERTAS_INTERVALO__ = setInterval(() => {
            try { verificarAlertasEstoque(); } catch (e) {}
        }, 60 * 60 * 1000);
    }

    // Re-check when user returns to tab
    if (!window.__PROPOSTA_ALERTAS_VISIBILITY__) {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                try { verificarAlertasEstoque(); } catch (e) {}
            }
        });
        window.__PROPOSTA_ALERTAS_VISIBILITY__ = true;
    }

    // Reativar auto-save: habilita salvamento automático (debounced + periódico)
    try { window.__AUTO_SAVE_CLOUD.enabled = true; } catch (e) {}
    try { iniciarAutoSaveCloud(); } catch (e) { console.warn('Falha ao iniciar auto-save:', e); }
}

// INÍCIO AJUSTE PRECIFICAÇÃO: normalizarPrecificacoesCliente
function normalizarPrecificacoesCliente(origem) {
    // Normaliza várias formas de estrutura de precificações (arrays, objetos mapeados, versões antigas)
    const lista = Array.isArray(origem)
        ? origem
        : (origem && typeof origem === 'object')
            ? Object.values(origem)
            : [];

    return lista.map((p, idx) => {
        const raw = (p && typeof p === 'object') ? p : {};

        // Normalizar a lista de itens (suporta item.itens, item.items, objetos mapeados ou arrays)
        let itensRaw = [];
        if (Array.isArray(raw.itens)) itensRaw = raw.itens;
        else if (Array.isArray(raw.items)) itensRaw = raw.items;
        else if (raw.itens && typeof raw.itens === 'object') itensRaw = Object.values(raw.itens);
        else if (raw.items && typeof raw.items === 'object') itensRaw = Object.values(raw.items);
        else if (Array.isArray(raw.produtos)) itensRaw = raw.produtos;

        const itens = (itensRaw || []).map(item => {
            const it = (item && typeof item === 'object') ? item : {};
            // tentar enriquecer descrição a partir do produto cadastrado quando possível
            let descricaoFromProduto = '';
            try {
                if (typeof estoque !== 'undefined' && Array.isArray(estoque.produtos)) {
                    const p = estoque.produtos.find(pp => (pp.nome || '') === (it.produto || it.produtoNome || it.nome || ''));
                    if (p) descricaoFromProduto = p.descricao || p.obs || p.observacoes || '';
                }
            } catch (e) { descricaoFromProduto = ''; }

            const ciVal = Number(isFinite(it.ci) ? it.ci : (it.custo || 0)) || 0;
            const taxaVal = Number(isFinite(it.taxa) ? it.taxa : (it.taxaPct || 0)) || 0;
            const roiVal = Number(isFinite(it.roi) ? it.roi : (it.roiPct || 0)) || 0;
            const valorBaseVal = Number(it.valorBase || it.valor_base || 0) || 0;
            const pisVal = Number(it.pis || 0) || 0;
            const pisRVal = Number(it.pisR || 0) || 0;
            const cofinsVal = Number(it.cofins || 0) || 0;
            const cofinsRVal = Number(it.cofinsR || 0) || 0;
            const icmsVal = Number(it.icms || 0) || 0;
            const icmsRVal = Number(it.icmsR || it.icmsR$ || 0) || 0;
            const ipiVal = Number(it.ipi || 0) || 0;
            const ipiRVal = Number(it.ipiR || 0) || 0;
            const valorImpostosVal = Number(it.valorImpostos || it.valor_impostos || 0) || 0;
            const comissaoVal = Number(it.comissao || it.comissaoPct || 0) || 0;
            const comissaoRVal = Number(it.comissaoR || 0) || 0;
            const precoFinalVal = Number(it.precoFinal || it.preco_final || it.valorUnitario || 0) || 0;
            const quantidadeVal = Number(it.quantidade || it.qtd || 1) || 1;
            const freteVal = Number(it.frete || it.freteR || 0) || 0;
            const valorSemIPIVal = Number(it.valorSemIPI || valorImpostosVal || 0) || 0;
            const valorComIPIVal = Number(it.valorComIPI || (valorSemIPIVal + ipiRVal) || 0) || 0;
            const valorFinalVal = Number(it.valorFinal || it.valorFinalCalc || precoFinalVal) || 0;
            const valorTotalVal = Number(it.valorTotal || it.total || (valorFinalVal * quantidadeVal) + freteVal) || 0;

            return {
                produto: it.produto || it.produtoNome || it.nome || '',
                produtoId: it.produtoId || it.produtoID || it.id || '',
                ncm: it.ncm || it.NCM || '',
                ci: ciVal,
                taxa: taxaVal,
                roi: roiVal,
                valorBase: valorBaseVal,
                icms: icmsVal,
                icmsR: icmsRVal,
                pis: pisVal,
                pisR: pisRVal,
                cofins: cofinsVal,
                cofinsR: cofinsRVal,
                ipi: ipiVal,
                ipiR: ipiRVal,
                valorImpostos: valorImpostosVal,
                valorSemIPI: valorSemIPIVal,
                valorComIPI: valorComIPIVal,
                comissao: comissaoVal,
                comissaoR: comissaoRVal,
                precoFinal: precoFinalVal,
                valorFinal: valorFinalVal,
                quantidade: quantidadeVal,
                frete: freteVal,
                valorTotal: valorTotalVal,
                margem: Number(it.margem || 0) || 0,
                descricao: it.descricao || it.descricaoProduto || it.desc || it.observacoes || descricaoFromProduto || ''
            };
        });

        const clienteNome = raw.clienteNome || raw.cliente || (raw.clienteObj && raw.clienteObj.nome) || '';
        const clienteId = raw.clienteId || raw.cliente_id || (raw.clienteObj && raw.clienteObj.id) || '';
        const clienteUF = raw.clienteUF || raw.clienteUf || (raw.clienteObj && raw.clienteObj.uf) || '';
        const representante = raw.representante || raw.rep || (raw.clienteObj && raw.clienteObj.representante) || '';
        const dataCriacao = raw.dataCriacao || raw.data || raw.createdAt || new Date().toISOString();

        return {
            id: raw.id || raw._id || ('precif-' + (Date.now() + idx)),
            clienteId: clienteId,
            clienteNome: clienteNome,
            clienteUF: clienteUF,
            representante: representante,
            tipoPessoa: raw.tipoPessoa || raw.tipo || raw.tipo_pessoa || '',
            dataCriacao: dataCriacao,
            versao: Number(raw.versao || raw.version || (idx + 1)) || (idx + 1),
            status: raw.status || 'ativa',
            propostaId: raw.propostaId || raw.proposta_id || null,
            descricao: raw.descricao || raw.obs || '',
            itens: itens,
            // preservar campos de nível superior quando existirem ou derivar de itens
            taxa: Number(raw.taxa || raw.taxaPadrao || raw.taxaFinal || (itens.length ? itens[0].taxa : 0)) || 0,
            roi: Number(raw.roi || raw.roiPadrao || raw.roiFinal || (itens.length ? itens[0].roi : 0)) || 0,
            comissao: Number(raw.comissao || raw.comissaoPadrao || (itens.length ? itens[0].comissao : 0)) || 0,
            totalFaturamento: Number(raw.totalFaturamento || raw.total_faturamento || itens.reduce((s,i)=>s + Number(i.valorTotal || i.valorFinal || i.precoFinal || 0),0)) || 0,
            validadeDias: Number(raw.validadeDias || raw.validade || 30) || 30,
            dataExpiracao: raw.dataExpiracao || raw.expiracao || null,
            retidPorProduto: raw.retidPorProduto || raw.retid || {},
            beneficioFiscalAtivo: !!raw.beneficioFiscalAtivo,
            beneficiosPorProduto: raw.beneficiosPorProduto || raw.beneficios || {}
        };
    });
}

// FIM AJUSTE PRECIFICAÇÃO
// FIM AJUSTE PRECIFICAÇÃO

// =============================
// CONSULTA DE PRECIFICAÇÕES - Estado e Helpers (Parte A)
// =============================
const _cpState = {
    pagina: 1,
    porPagina: 20,
    sortCol: 'dataCriacao',
    sortDir: 'desc',
    dados: []
};

// Formata moeda BR
function _cpFmt(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Formata percentual
function _cpPct(v) {
    return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

// Formata percentual com valor em moeda abaixo (ex: 27% \n R$ 270,00)
function _cpPctWithValor(pct, base) {
    const percent = Number(pct || 0);
    const baseVal = Number(base || 0);
    const amount = (baseVal * percent) / 100;
    return `<div style="display:flex;flex-direction:column;align-items:flex-end"><div>${_cpPct(percent)}</div><div style="font-size:0.82rem;color:#64748b">${_cpFmt(amount)}</div></div>`;
}
// Verifica se precificação está expirada
function _cpExpirada(p) {
    if (!p) return false;
    const exp = p.dataExpiracao || p.data || p.validade || null;
    if (!exp) return false;
    try { return new Date(exp) < new Date(); } catch (e) { return false; }
}

// =============================
// Render: Consulta de Precificações (Parte B)
// Recebe array de precificações (já paginadas) e renderiza as linhas
// =============================
function renderConsultaPrecificacoes(dados) {
    try {
        const body = document.getElementById('bodyConsultaPrec');
        if (!body) return;
        body.innerHTML = '';

        const totalRegistros = Array.isArray(_cpState.dados) ? _cpState.dados.length : 0;

                if (!Array.isArray(dados) || dados.length === 0) {
                        body.innerHTML = `
                        <tr>
                            <td colspan="26">
                                <div class="empty-state">
                                    <div class="empty-icon">📋</div>
                                    <div class="empty-text">Nenhuma precificação salva</div>
                                    <div class="empty-hint">Calcule e salve uma precificação na aba "Por Cliente"</div>
                                </div>
                            </td>
                        </tr>`;
            if (typeof _cpRenderPaginacao === 'function') _cpRenderPaginacao(totalRegistros);
            return;
        }

        let html = '';
        // contador de linhas (para exibir Nº se desejar)
        let rowCounter = (_cpState.pagina - 1) * _cpState.porPagina + 1;

        // construir mapa de numeração por ano (AAAA/NNN) baseado em _cpState.dados
        const seqMap = new Map();
        try {
            const all = Array.isArray(_cpState.dados) ? _cpState.dados.slice() : [];
            const sortedAll = all.slice().sort((a, b) => {
                const da = new Date(a.dataCriacao || a.data || a.createdAt || 0).getTime() || 0;
                const db = new Date(b.dataCriacao || b.data || b.createdAt || 0).getTime() || 0;
                return da - db;
            });
            const counters = {};
            sortedAll.forEach(p => {
                const y = new Date(p.dataCriacao || p.data || p.createdAt || Date.now()).getFullYear();
                counters[y] = (counters[y] || 0) + 1;
                seqMap.set(p, counters[y]);
            });
        } catch (e) { console.warn('seqMap erro', e); }

        dados.forEach((prec) => {
            const produtos = Array.isArray(prec.itens) ? prec.itens : (Array.isArray(prec.produtos) ? prec.produtos : []);
            produtos.forEach((prod, idxProd) => {
                const exp = _cpExpirada(prec);
                // rótulo de numeração AAAA/NNN para a precificação
                const precYear = new Date(prec.dataCriacao || prec.data || prec.createdAt || Date.now()).getFullYear();
                const precSeq = seqMap.get(prec) || rowCounter;
                const precLabel = `${precYear}/${String(precSeq).padStart(3, '0')}`;
                const trClass = exp ? 'prec-expirada' : '';
                const statusBadge = exp ? '<span class="badge-prec-expirada">✗ Expirada</span>' : '<span class="badge-prec-ativa">✓ Ativa</span>';
                const rep = prec.representante || prec.rep || '';
                const repClass = rep ? (' ' + String(rep).toLowerCase().replace(/[^a-z0-9\-]/g, '')) : '';
                const beneficios = (prec.beneficiosPorProduto && (prec.beneficiosPorProduto[prod.produto] || prec.beneficiosPorProduto[prod.produtoId])) || (prec.descricao || '');

                html += `<tr class="${trClass}">`;
                html += `<td style="min-width:60px">${_escapeHtml(String(precLabel || prec.id || prec.versao || rowCounter))}</td>`;
                html += `<td style="min-width:100px">${prec.dataCriacao ? new Date(prec.dataCriacao).toLocaleString('pt-BR') : (prec.data ? new Date(prec.data).toLocaleString('pt-BR') : '-')}</td>`;
                html += `<td style="min-width:100px">${prec.dataExpiracao ? new Date(prec.dataExpiracao).toLocaleDateString('pt-BR') : '-'}</td>`;
                html += `<td style="min-width:80px">${statusBadge}</td>`;
                html += `<td style="min-width:160px;text-align:left">${_escapeHtml(prec.clienteNome || prec.cliente || '')}</td>`;
                html += `<td style="min-width:50px">${_escapeHtml(prec.clienteUF || prec.uf || '')}</td>`;
                html += `<td style="min-width:50px">${_escapeHtml(prec.tipoPessoa || '')}</td>`;
                html += `<td style="min-width:90px"><span class="badge-rep${repClass}">${_escapeHtml(rep)}</span></td>`;
                html += `<td style="min-width:160px;text-align:left">${_escapeHtml(prod.produto || prod.produtoNome || prod.nome || '')}</td>`;
                // Descrição do produto (quando disponível)
                html += `<td style="min-width:200px;text-align:left;color:#475569">${_escapeHtml(prod.descricao || prod.descricaoProduto || '')}</td>`;
                // Quantidade — logo após a descrição
                html += `<td style="min-width:80px;text-align:center">${_escapeHtml(String(prod.quantidade || prod.qtd || 1))}</td>`;
                html += `<td style="min-width:100px;text-align:right">${_fmtMoeda(prod.ci)}</td>`;
                // A partir do CI: alinhar com tabela 'Por Cliente' (Taxa% / ROI% combinado, Valor Base, PIS/COFINS, ICMS, IPI, s/Impostos, c/ IPI, Comissão, Frete, Valor Final, Valor Total, Margem, Benefícios)
                const tipoPessoa = prec.tipoPessoa || '';
                const impostoPctStyle = 'font-size:0.75rem;color:#64748b';
                const impostoValStyle = 'font-weight:600';
                const icmsBg = tipoPessoa === 'PF' ? '#fef2f2' : '#f0fdf4';
                const icmsColor = tipoPessoa === 'PF' ? '#dc2626' : '#16a34a';
                const taxaRoiCell = `<td style="text-align:center;color:#475569">\n                    <div style="font-size:0.75rem;color:#64748b">Taxa: ${(Number(prod.taxa || 0)).toFixed(2)}%</div>\n                    <div style="font-size:0.75rem;color:#64748b">ROI: ${(Number(prod.roi || 0)).toFixed(2)}%</div>\n                </td>`;
                const pisCofinsCell = `<td style="text-align:center">\n                    <div style="${impostoPctStyle}">PIS: ${Number(prod.pis || 0).toFixed(2)}%</div>\n                    <div style="${impostoValStyle}">${_cpFmt(Number(prod.pisR || 0))}</div>\n                    <div style="${impostoPctStyle};margin-top:4px">COFINS: ${Number(prod.cofins || 0).toFixed(2)}%</div>\n                    <div style="${impostoValStyle}">${_cpFmt(Number(prod.cofinsR || 0))}</div>\n                </td>`;
                const icmsCell = `<td style="text-align:center;background:${icmsBg}">\n                    <div style="${impostoPctStyle};color:${icmsColor}">${Number(prod.icms || 0).toFixed(2)}%</div>\n                    <div style="${impostoValStyle}">${_cpFmt(Number(prod.icmsR || 0))}</div>\n                </td>`;
                const valorSemIPI = Number(prod.valorImpostos || prod.valorBase || 0);
                const ipiCell = `<td style="text-align:center">\n                    <div style="${impostoPctStyle}">${Number(prod.ipi || 0).toFixed(2)}%</div>\n                    <div style="${impostoValStyle}">${_cpFmt(Number(prod.ipiR || 0))}</div>\n                </td>`;
                const valorComIPI = valorSemIPI + (Number(prod.ipiR || 0));
                const comissaoCell = `<td style="text-align:center;color:#d97706">\n                    <div style="${impostoPctStyle}">${(Number(prod.comissao || 0)).toFixed(2)}%</div>\n                    <div style="${impostoValStyle}">${_cpFmt(Number(prod.comissaoR || 0))}</div>\n                </td>`;

                html += taxaRoiCell;
                html += `<td style="min-width:110px;text-align:right">${_cpFmt(prod.valorBase)}</td>`;
                html += pisCofinsCell;
                html += icmsCell;
                // Ordem: Valor s/ IPI, IPI, Valor c/ IPI, Comissão, Frete, Valor Final, Valor Total
                html += `<td style="min-width:110px;text-align:right">${_cpFmt(valorSemIPI)}</td>`;
                html += ipiCell;
                html += `<td style="min-width:110px;text-align:right">${_cpFmt(valorComIPI)}</td>`;
                html += comissaoCell;
                const freteVal = Number(prod.frete || prod.freteR || prec.frete || 0) || 0;
                html += `<td style="min-width:100px;text-align:right">${_cpFmt(freteVal)}</td>`;
                const comissaoR = Number(prod.comissaoR || 0);
                const valorFinalCalc = valorComIPI + comissaoR;
                html += `<td style="min-width:120px;text-align:right">${_cpFmt(valorFinalCalc)}</td>`;
                const quantidade = Number(prod.quantidade || prod.qtd || 1) || 1;
                const valorTotalCalc = (valorFinalCalc * quantidade) + freteVal;
                html += `<td style="min-width:120px;text-align:right">${_cpFmt(valorTotalCalc)}</td>`;
                html += `<td style="min-width:80px;text-align:right">${_cpPct(prod.margem)}</td>`;
                html += `<td style="min-width:160px">${_escapeHtml(beneficios || '')}</td>`;
                html += `<td style="min-width:110px;position:sticky;right:0">`;
                html += `<button class="btn-action btn-edit" onclick="gerarPropostaDePrecificacao('${prec.id}', ${idxProd})">📋 Proposta</button>`;
                html += `<button class="btn-action btn-delete" onclick="excluirPrecificacao('${prec.id}')">🗑</button>`;
                html += `</td>`;
                html += `</tr>`;

                rowCounter++;
            });
        });

        body.innerHTML = html;
        if (typeof _cpRenderPaginacao === 'function') _cpRenderPaginacao(totalRegistros);
    } catch (e) {
        console.error('renderConsultaPrecificacoes erro:', e);
    }
}

// =============================
// Consulta: filtros, paginação e exclusão (Partes C/D/E)
// =============================
function filtrarConsultaPrecificacoes(page) {
    try {
        const clienteEl = document.getElementById('fcp-cliente');
        const repEl = document.getElementById('fcp-rep');
        const statusEl = document.getElementById('fcp-status');
        const deEl = document.getElementById('fcp-de');
        const ateEl = document.getElementById('fcp-ate');

        const cliente = clienteEl ? (clienteEl.value || '').toString().trim() : '';
        const rep = repEl ? (repEl.value || '').toString().trim() : '';
        const status = statusEl ? (statusEl.value || '').toString().trim() : '';
        const de = deEl ? (deEl.value || '').toString().trim() : '';
        const ate = ateEl ? (ateEl.value || '').toString().trim() : '';

        let lista = Array.isArray(precificacoesCliente) ? precificacoesCliente.slice() : [];

        if (cliente) {
            const s = cliente.toLowerCase();
            lista = lista.filter(p => ((p.clienteNome || p.cliente || '') + '').toLowerCase().includes(s) || ((p.clienteId || '') + '').toLowerCase().includes(s));
        }

        if (rep) {
            const s = rep.toLowerCase();
            lista = lista.filter(p => ((p.representante || p.rep || '') + '').toLowerCase().includes(s));
        }

        if (status) {
            if (status === 'ativa') lista = lista.filter(p => !_cpExpirada(p));
            if (status === 'expirada') lista = lista.filter(p => _cpExpirada(p));
        }

        if (de) {
            const deDate = new Date(de);
            lista = lista.filter(p => {
                const d = new Date(p.dataCriacao || p.data || p.createdAt || null);
                return d && !isNaN(d) && d >= deDate;
            });
        }

        if (ate) {
            const ateDate = new Date(ate + 'T23:59:59');
            lista = lista.filter(p => {
                const d = new Date(p.dataCriacao || p.data || p.createdAt || null);
                return d && !isNaN(d) && d <= ateDate;
            });
        }

        // ordenação simples
        const col = _cpState.sortCol || 'dataCriacao';
        const dir = (_cpState.sortDir || 'desc').toLowerCase();
        lista.sort((a, b) => {
            try {
                let va = a[col];
                let vb = b[col];
                if (col === 'dataCriacao') {
                    va = new Date(a.dataCriacao || a.data || 0).getTime() || 0;
                    vb = new Date(b.dataCriacao || b.data || 0).getTime() || 0;
                } else {
                    va = (va || '') + '';
                    vb = (vb || '') + '';
                }
                if (va < vb) return dir === 'asc' ? -1 : 1;
                if (va > vb) return dir === 'asc' ? 1 : -1;
                return 0;
            } catch (e) { return 0; }
        });

        _cpState.dados = lista;
        _cpState.pagina = (typeof page === 'number' && page > 0) ? page : 1; // aceitar page opcional

        const start = (_cpState.pagina - 1) * (_cpState.porPagina || 20);
        const paged = lista.slice(start, start + (_cpState.porPagina || 20));
        renderConsultaPrecificacoes(paged);
    } catch (e) {
        console.error('filtrarConsultaPrecificacoes erro:', e);
    }
}

function _cpGoToPagina(n) {
    const num = Number(n) || 1;
    if (num < 1) return;
    _cpState.pagina = num;
    filtrarConsultaPrecificacoes(num);
}

function _cpRenderPaginacao(total) {
    try {
        const cont = document.getElementById('paginacaoConsultaPrec');
        if (!cont) return;
        const per = _cpState.porPagina || 20;
        const totalPages = Math.max(1, Math.ceil((total || 0) / per));
        const current = Math.min(Math.max(1, _cpState.pagina || 1), totalPages);

        let html = '';
        html += `<div class="page-info">Página ${current} de ${totalPages} — ${total || 0} registros</div>`;
        html += '<div class="page-buttons">';

        const prevDisabledAttr = current <= 1 ? 'disabled' : '';
        html += `<button class="page-btn prev" ${prevDisabledAttr} onclick="_cpGoToPagina(${Math.max(1, current - 1)})">◀</button>`;

        let start = Math.max(1, current - 3);
        let end = Math.min(totalPages, start + 6);
        if (end - start < 6) start = Math.max(1, end - 6);
        for (let p = start; p <= end; p++) {
            const active = p === current ? 'active' : '';
            html += `<button class="page-btn ${active}" onclick="_cpGoToPagina(${p})">${p}</button>`;
        }

        const nextDisabledAttr = current >= totalPages ? 'disabled' : '';
        html += `<button class="page-btn next" ${nextDisabledAttr} onclick="_cpGoToPagina(${Math.min(totalPages, current + 1)})">▶</button>`;
        html += '</div>';

        cont.innerHTML = html;
    } catch (e) {
        console.error('_cpRenderPaginacao erro:', e);
    }
}

function excluirPrecificacao(id) {
    try {
        if (!id) return;
        if (!confirm('Confirma exclusão desta precificação?')) return;
        const idx = (precificacoesCliente || []).findIndex(p => String(p.id) === String(id) || String(p.versao) === String(id));
        if (idx === -1) {
            try { mostrarNotificacao && mostrarNotificacao('Precificação não encontrada.', 'warning'); } catch (e) {}
            return;
        }
        precificacoesCliente.splice(idx, 1);
        try { estoque.precificacoesCliente = precificacoesCliente; } catch (e) {}
        try { salvarDados(); } catch (e) {}
        try { filtrarConsultaPrecificacoes(); } catch (e) {}
        try { mostrarNotificacao && mostrarNotificacao('Precificação excluída.', 'success'); } catch (e) {}
    } catch (e) {
        console.error('excluirPrecificacao erro:', e);
        try { mostrarNotificacao && mostrarNotificacao('Falha ao excluir precificação.', 'error'); } catch (ex) {}
    }
}

function _cpPopularFiltroCliente() {
    try {
        const sel = document.getElementById('fcp-cliente');
        if (!sel) return;
        const seen = new Set();
        let options = '<option value="">Todos</option>';
        (precificacoesCliente || []).forEach(p => {
            const name = (p.clienteNome || p.cliente || '') + '';
            if (!name) return;
            if (!seen.has(name)) { seen.add(name); options += `<option value="${_escapeHtml(name)}">${_escapeHtml(name)}</option>`; }
        });
        sel.innerHTML = options;
    } catch (e) { console.error('_cpPopularFiltroCliente erro:', e); }
}

// Tornar funções acessíveis no console/global (útil para debug e onclicks dinâmicos)
try {
    window.filtrarConsultaPrecificacoes = filtrarConsultaPrecificacoes;
    window._cpGoToPagina = _cpGoToPagina;
    window._cpRenderPaginacao = _cpRenderPaginacao;
    window.excluirPrecificacao = excluirPrecificacao;
    window.gerarPropostaDePrecificacao = gerarPropostaDePrecificacao;
    window.exportarPrecificacoesExcel = exportarPrecificacoesExcel;
    window.limparFiltrosConsultaPrec = limparFiltrosConsultaPrec;
    window._cpPopularFiltroCliente = _cpPopularFiltroCliente;
    window.renderConsultaPrecificacoes = renderConsultaPrecificacoes;
} catch (e) {}

function gerarPropostaDePrecificacao(id, idxProduto) {
    try {
        const prec = (precificacoesCliente || []).find(p => String(p.id) === String(id) || String(p.versao) === String(id));
        if (!prec) { mostrarNotificacao && mostrarNotificacao('Precificação não encontrada.', 'error'); return; }
        const produtos = Array.isArray(prec.itens) ? prec.itens : (Array.isArray(prec.produtos) ? prec.produtos : []);
        const prod = produtos[(typeof idxProduto === 'number') ? idxProduto : 0];
        abrirModalProposta();
        // Aguarda o modal abrir e a estrutura ser criada
        setTimeout(() => {
            try {
                if (document.getElementById('propostaCliente')) document.getElementById('propostaCliente').value = prec.clienteNome || prec.cliente || '';
                if (document.getElementById('propostaRepresentante')) document.getElementById('propostaRepresentante').value = prec.representante || prec.rep || '';
                if (document.getElementById('propostaValidade')) document.getElementById('propostaValidade').value = prec.validade || prec.validadeDias || prec.validadeDias || 30;
                const container = document.getElementById('itensPropostaContainer');
                if (container) container.innerHTML = '';
                const valorUnit = prod ? (prod.precoFinal || prod.valorBase || prod.valor || 0) : 0;
                adicionarItemPropostaRow({ produtoId: prod ? (prod.produtoId || prod.produto || prod.id) : '', quantidade: prod && prod.quantidade ? prod.quantidade : 1, valorUnit: valorUnit ? Number(valorUnit).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '' });
                try { calcularTotalProposta(); } catch (e) {}
            } catch (e) { console.error('erro ao popular modal proposta:', e); }
        }, 120);
    } catch (e) {
        console.error('gerarPropostaDePrecificacao erro:', e);
    }
}

function exportarPrecificacoesExcel() {
    try {
        const lista = Array.isArray(precificacoesCliente) ? precificacoesCliente : [];
        if (!lista.length) { mostrarNotificacao && mostrarNotificacao('Nenhuma precificação para exportar.', 'warning'); return; }

        const rows = [];
        lista.forEach(p => {
            const produtos = Array.isArray(p.itens) ? p.itens : (Array.isArray(p.produtos) ? p.produtos : []);
            produtos.forEach(prod => {
                rows.push({
                    id: p.id || p.versao || '',
                    dataCriacao: p.dataCriacao || p.data || '',
                    dataExpiracao: p.dataExpiracao || '',
                    status: _cpExpirada(p) ? 'expirada' : 'ativa',
                    cliente: p.clienteNome || p.cliente || '',
                    clienteUF: p.clienteUF || p.uf || '',
                    tipoPessoa: p.tipoPessoa || '',
                    representante: p.representante || p.rep || '',
                    produtoNome: prod.produto || prod.produtoNome || prod.nome || '',
                    produtoId: prod.produtoId || prod.id || '',
                    ci: prod.ci || '',
                    taxa: prod.taxa || '',
                    roi: prod.roi || '',
                    valorBase: prod.valorBase || prod.valor || '',
                    pis: prod.pis || '',
                    cofins: prod.cofins || '',
                    ipi: prod.ipi || '',
                    icms: prod.icms || '',
                    semImpostos: (prod.semImpostos !== undefined && prod.semImpostos !== null) ? prod.semImpostos : prod.valorBase,
                    valorSemIPI: prod.valorSemIPI || prod.valorImpostos || prod.valorBase || '',
                    valorComIPI: prod.valorComIPI || '',
                    frete: prod.frete || 0,
                    quantidade: prod.quantidade || 1,
                    valorFinal: prod.valorFinal || prod.precoFinal || '',
                    valorTotal: prod.valorTotal || '',
                    comissao: prod.comissao || '',
                    precoFinal: prod.precoFinal || '',
                    margem: prod.margem || '',
                    beneficios: (p.beneficiosPorProduto && (p.beneficiosPorProduto[prod.produto] || p.beneficiosPorProduto[prod.produtoId])) || p.descricao || ''
                });
            });
        });

        const nowTs = new Date().toISOString().slice(0,19).replace(/[:T]/g,'_');
        const filename = 'precificacoes_export_' + nowTs + (window.XLSX ? '.xlsx' : '.csv');

        if (window.XLSX) {
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Precificacoes');
            XLSX.writeFile(wb, filename);
            return;
        }

        const headers = ['id','dataCriacao','dataExpiracao','status','cliente','clienteUF','tipoPessoa','representante','produtoNome','produtoId','ci','taxa','roi','valorBase','pis','cofins','icms','valorSemIPI','ipi','valorComIPI','comissao','frete','quantidade','valorFinal','valorTotal','precoFinal','margem','beneficios'];
        const csvRows = [headers.join(';')];
        rows.forEach(r => {
            const line = headers.map(h => (r[h] === undefined || r[h] === null) ? '' : String(r[h]).replace(/"/g, '""'))
                                .map(v => `"${v}"`).join(';');
            csvRows.push(line);
        });
        const csv = '\uFEFF' + csvRows.join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);

    } catch (e) {
        console.error('exportarPrecificacoesExcel erro:', e);
        mostrarNotificacao && mostrarNotificacao('Erro ao exportar precificações.', 'error');
    }
}

function limparFiltrosConsultaPrec() {
    try {
        const clienteEl = document.getElementById('fcp-cliente'); if (clienteEl) clienteEl.value = '';
        const repEl = document.getElementById('fcp-rep'); if (repEl) repEl.value = '';
        const statusEl = document.getElementById('fcp-status'); if (statusEl) statusEl.value = '';
        const deEl = document.getElementById('fcp-de'); if (deEl) deEl.value = '';
        const ateEl = document.getElementById('fcp-ate'); if (ateEl) ateEl.value = '';
        filtrarConsultaPrecificacoes(1);
    } catch (e) { console.error('limparFiltrosConsultaPrec erro:', e); }
}

function carregarDados() {
    const dadosSalvos = localStorage.getItem('estoqueArmasV2');
    if (dadosSalvos) {
        try {
            estoque = JSON.parse(dadosSalvos);
        } catch (e) {
            console.error('Falha ao interpretar localStorage estoqueArmasV2:', e);
            localStorage.removeItem('estoqueArmasV2');
            estoque = {
                produtos: [],
                representantes: ['KOLTE', 'ISA', 'LC', 'ADES', 'FL', 'IMBEL'],
                registroVendas: [],
                registroDistribuicao: [],
                registroDevolucoes: [],
                registroEntradas: [],
                controleEnvio: {},
                auditoriaVendas: [],
                fechamentosComissoes: [],
                clientes: [],
                propostas: [],
                precificacao: {},
                precificacaoConfig: null,
                precificacoesCliente: []
            };
        }
        // Garantir que registroVendas existe
        if (!estoque.registroVendas) {
            estoque.registroVendas = [];
        }
        // Garantir que registroDistribuicao existe
        if (!estoque.registroDistribuicao) {
            estoque.registroDistribuicao = [];
        }
        // Garantir que registroDevolucoes existe
        if (!estoque.registroDevolucoes) {
            estoque.registroDevolucoes = [];
        }
        // Garantir que registroEntradas existe (novidade)
        if (!estoque.registroEntradas) {
            estoque.registroEntradas = [];
        }
        // Garantir que controleEnvio existe
        if (!estoque.controleEnvio) {
            estoque.controleEnvio = {};
        }
        if (!Array.isArray(estoque.auditoriaVendas)) {
            estoque.auditoriaVendas = [];
        }
        if (!Array.isArray(estoque.fechamentosComissoes)) {
            estoque.fechamentosComissoes = [];
        }
        if (!Array.isArray(estoque.clientes)) {
            estoque.clientes = [];
        }
        clientes = estoque.clientes;
        if (!Array.isArray(estoque.propostas)) {
            estoque.propostas = [];
        }
        propostas = estoque.propostas;
        if (!Array.isArray(estoque.precificacoesCliente)) {
            estoque.precificacoesCliente = [];
        }
        estoque.precificacoesCliente = normalizarPrecificacoesCliente(estoque.precificacoesCliente);
        if (!Array.isArray(estoque.tabelaCI)) {
            estoque.tabelaCI = [];
        }
        // Carregar configuração de alertas se presente
        try {
            const cfg = localStorage.getItem('configAlertas');
            if (cfg) configAlertas = JSON.parse(cfg);
        } catch (e) { console.warn('Erro ao carregar configAlertas:', e); }
        // Migrar produtos antigos para nova propriedade `estoqueConsolidado` quando necessário
        try {
            if (Array.isArray(estoque.produtos)) {
                estoque.produtos.forEach(p => {
                    if (typeof p.estoqueConsolidado === 'undefined' || p.estoqueConsolidado === null) {
                        // fallback: somar todas as chaves de distribuição armazenadas
                        try {
                            const totalDisp = Object.keys(p.distribuicao || {}).reduce((s, k) => s + (Number(p.distribuicao[k]) || 0), 0);
                            p.estoqueConsolidado = totalDisp;
                        } catch (inner) { p.estoqueConsolidado = 0; }
                    }
                    // padronizar: manter distribuições por representantes; zerar/ignorar IMBEL armazenado (IMBEL será calculado dinamicamente a partir do consolidado)
                    try { if (!p.distribuicao) p.distribuicao = {}; p.distribuicao.IMBEL = 0; } catch (e) {}
                });
            }
        } catch (e) { console.warn('Migração estoqueConsolidado falhou:', e); }
        if (estoque.precificacao && typeof estoque.precificacao === 'object') {
            precificacao = estoque.precificacao;
        } else {
            precificacao = {};
            estoque.precificacao = precificacao;
        }
        // carregar precificações por cliente, se presente
        try { precificacoesCliente = normalizarPrecificacoesCliente(estoque.precificacoesCliente); } catch (e) { precificacoesCliente = []; }
        if (!precificacoesCliente || !precificacoesCliente.length) {
            try {
                const rawEspelho = localStorage.getItem('precificacoesClienteBackupV1');
                const espelho = normalizarPrecificacoesCliente(rawEspelho ? JSON.parse(rawEspelho) : []);
                if (espelho.length) precificacoesCliente = espelho;
            } catch (e) {}
        }
        estoque.precificacoesCliente = precificacoesCliente;
        try { atualizarIndicadoresPrecificacao(); } catch (e) {}
        tabelaAliquotas = (estoque.tabelaAliquotas && typeof estoque.tabelaAliquotas === 'object')
            ? estoque.tabelaAliquotas
            : {};
        tabelaICMS = Array.isArray(estoque.tabelaICMS) ? estoque.tabelaICMS : [];
        categoriaPorProduto = (estoque.categoriaPorProduto && typeof estoque.categoriaPorProduto === 'object')
            ? estoque.categoriaPorProduto
            : {};
        // Reconstruir distribuições por produto a partir dos registros (corrige inconsistências legadas)
        try { reconstruirDistribuicaoAPartirDeRegistros(); } catch (e) { /* ignore */ }

        // Restore IMBEL data if it was saved in the main object
        try {
            if (estoque && estoque._imbelData) {
                const existing = localStorage.getItem(IMBEL_KEY);
                // Only restore if IMBEL localStorage is empty or default
                if (!existing || existing === '{"produtos":[],"movimentacoes":[]}') {
                    localStorage.setItem(IMBEL_KEY, JSON.stringify(estoque._imbelData));
                    console.info('IMBEL: dados restaurados do backup principal');
                }
            }
        } catch (e) {}
    } else {
        estoque.produtos = dadosIniciais.map((item, index) => ({
            id: index + 1,
            nome: item.nome,
            preco: item.preco,
            distribuicao: { ...item.distribuicao },
            vendas: { ...item.vendas }
        }));
        estoque.registroVendas = [];
        estoque.registroDistribuicao = [];
        estoque.registroDevolucoes = [];
        estoque.registroEntradas = [];
        estoque.controleEnvio = {};
        estoque.auditoriaVendas = [];
        estoque.fechamentosComissoes = [];
        estoque.clientes = [];
        clientes = estoque.clientes;
        estoque.precificacao = {};
        estoque.precificacaoConfig = null;
        precificacao = estoque.precificacao;
        tabelaAliquotas = {};
        tabelaICMS = [];
        categoriaPorProduto = {};
        estoque.precificacoesCliente = [];
        estoque.tabelaAliquotas = tabelaAliquotas;
        estoque.tabelaICMS = tabelaICMS;
        estoque.categoriaPorProduto = categoriaPorProduto;
        salvarDados();
    }
}

// Debounce para localStorage — evita 60 escritas seguidas
let __localSaveTimer = null;
function agendarSalvarLocal() {
    if (__localSaveTimer) clearTimeout(__localSaveTimer);
    __localSaveTimer = setTimeout(() => {
        __localSaveTimer = null;
        _executarSalvarLocal();
    }, 300); // 300ms de espera
}

function _executarSalvarLocal() {
    // Sincronizar aliases mutáveis de volta para estoque antes de persistir
    // (clientes e propostas são arrays compartilhados que podem ter sido mutados diretamente)
    if (Array.isArray(clientes)) estoque.clientes = clientes;
    if (Array.isArray(propostas)) estoque.propostas = propostas;
    // Sincroniza os objetos de precificação no estado persistido
    estoque.precificacao = precificacao;
    estoque.tabelaAliquotas = tabelaAliquotas;
    estoque.tabelaICMS = tabelaICMS;
    estoque.categoriaPorProduto = categoriaPorProduto;
    // Persistir precificações salvas por cliente
    try { estoque.precificacoesCliente = precificacoesCliente || []; } catch (e) {}
    // Persistir tabelas de impostos editáveis
    try { estoque.impostosEditaveis = impostosEditaveis || {}; } catch (e) {}
    try { estoque.icmsEditavelPJ = icmsEditavelPJ || {}; } catch (e) {}
    try { estoque.icmsEditavelPF = icmsEditavelPF || {}; } catch (e) {}
    // marca hora local de atualização para comparação com o remoto
    try { estoque._localUpdatedAt = new Date().toISOString(); } catch (e) {}
    // Include IMBEL data in main save
    try {
        const imbelData = loadImbel();
        estoque._imbelData = imbelData;
    } catch(e) {}
    localStorage.setItem('estoqueArmasV2', JSON.stringify(estoque));
    try { localStorage.setItem('precificacoesClienteBackupV1', JSON.stringify(precificacoesCliente || [])); } catch (e) {}
    atualizarEstatisticas();

    // agendar salvamento no cloud (debounced) se habilitado
    try { scheduleCloudSaveDebounced(); } catch (e) {}
    try {
        if (!_cloudSyncedRecently) _dadosAlterados = true;
    } catch (e) {}
}

function salvarDados(opcoes = {}) {
    if (opcoes && opcoes.imediato) {
        if (__localSaveTimer) { clearTimeout(__localSaveTimer); __localSaveTimer = null; }
        _executarSalvarLocal();
    } else {
        agendarSalvarLocal();
    }
}

// =============================
// Controle de versão local
// =============================
function getLocalUpdatedAt() {
    try {
        const v = localStorage.getItem('_cloudUpdatedAt');
        return v ? new Date(v) : null;
    } catch(e) { return null; }
}

function setLocalUpdatedAt(date) {
    try {
        localStorage.setItem('_cloudUpdatedAt', date instanceof Date ? date.toISOString() : date);
    } catch(e) {}
}

// =============================
// Funções para salvar/carregar no Firestore
// =============================
async function salvarNoCloud() {
    if (!window.firestoreDB) {
        console.warn('Firestore não inicializado. Impossível salvar no cloud.');
        return false;
    }
    const indicator = document.getElementById('cloudSaveIndicator');
    if (indicator) { indicator.textContent = '☁️ Salvando...'; indicator.style.color = '#d97706'; }
    try {
        // Garantir que estoque reflete o estado atual das variáveis globais antes de salvar
        if (Array.isArray(precificacoesCliente)) estoque.precificacoesCliente = precificacoesCliente;
        if (Array.isArray(clientes)) estoque.clientes = clientes;
        if (Array.isArray(propostas)) estoque.propostas = propostas;
        // Incluir dados IMBEL no backup Cloud (pegar do localStorage antes de enviar)
        try {
            const imbelDataToSave = (typeof loadImbel === 'function') ? loadImbel() : null;
            if (imbelDataToSave) estoque._imbelData = imbelDataToSave;
        } catch (e) { /* ignore */ }
        const docRef = window.firestoreDB.collection('app_data').doc('latest');
        await docRef.set({
            estado: estoque,
            precificacao,
            tabelaAliquotas,
            tabelaICMS,
            categoriaPorProduto,
            impostosEditaveis: impostosEditaveis || {},
            icmsEditavelPJ: icmsEditavelPJ || {},
            icmsEditavelPF: icmsEditavelPF || {},
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // ler o documento para obter o updatedAt do servidor
            try {
            const savedDoc = await docRef.get();
            const d = savedDoc && savedDoc.exists ? savedDoc.data() : null;
            const updatedAt = d && d.updatedAt ? d.updatedAt.toDate() : new Date();
            updateFirestoreStatus(true, updatedAt, 'Cloud: salvo');
        } catch (inner) {
            updateFirestoreStatus(true, new Date(), 'Cloud: salvo');
        }
        if (indicator) {
            indicator.textContent = '✅ Salvo';
            indicator.style.color = '#16a34a';
            setTimeout(() => { if (indicator) indicator.textContent = ''; }, 3000);
        }
        try {
            _cloudSyncedRecently = true;
            _dadosAlterados = false;
            if (__cloudSyncResetTimer) clearTimeout(__cloudSyncResetTimer);
            __cloudSyncResetTimer = setTimeout(() => { _cloudSyncedRecently = false; }, 30000);
        } catch (e) {}
        console.debug('Dados salvos no Firestore (coleção app_data / doc latest)');
        return true;
    } catch (e) {
        console.error('Erro salvando no Firestore:', e);
        // Detectar esgotamento de writes no Firestore e pausar auto-save temporariamente
        try {
            const errMsg = (e && (e.code || e.message || e.toString())) ? (e.code || e.message || e.toString()) : '';
            if (errMsg && (errMsg.indexOf('resource-exhausted') !== -1 || errMsg.indexOf('exhausted') !== -1)) {
                console.warn('Firestore resource-exhausted detectado — pausando auto-save por 60s.');
                window.__AUTO_SAVE_CLOUD = window.__AUTO_SAVE_CLOUD || {};
                window.__AUTO_SAVE_CLOUD.enabled = false;
                try { if (typeof mostrarNotificacao === 'function') mostrarNotificacao('Auto-save pausado por 1 minuto devido a limites do Firestore.', 'warning'); } catch (_) {}
                setTimeout(() => {
                    try { window.__AUTO_SAVE_CLOUD.enabled = true; } catch (_) {}
                }, 60000);
            }
        } catch (inner) { console.warn('Erro ao processar erro do Firestore:', inner); }

        updateFirestoreStatus(false, null, 'Cloud: erro ao salvar');
        if (indicator) { indicator.textContent = '❌ Erro ao salvar'; indicator.style.color = '#dc2626'; }
        return false;
    }
}

// UI wrappers for manual save/load triggered by user buttons
async function salvarNoCloudUI() {
    if (typeof requireAdminOrNotify === 'function' && !requireAdminOrNotify()) return false;
    if (typeof showProgressBar === 'function') showProgressBar('Salvando no Cloud...');
    try {
        mostrarNotificacao('Salvando dados no cloud...', 'info');
        const ok = await salvarNoCloud();
        if (ok) mostrarNotificacao('Dados salvos no Firestore com sucesso.', 'success');
        else mostrarNotificacao('Falha ao salvar no Firestore. Veja o console para detalhes.', 'error');
        return ok;
    } catch (e) {
        console.error('salvarNoCloudUI erro:', e);
        mostrarNotificacao('Erro ao salvar no cloud.', 'error');
        return false;
    } finally {
        if (typeof hideProgressBar === 'function') hideProgressBar();
    }
}

async function carregarDoCloudUI() {
    if (typeof requireAdminOrNotify === 'function' && !requireAdminOrNotify()) return false;
    if (typeof showProgressBar === 'function') showProgressBar('Carregando do Cloud...');
    try {
        const confirmed = confirm('Carregar do cloud substituirá os dados locais. Deseja continuar?');
        if (!confirmed) return false;
        mostrarNotificacao('Carregando dados do cloud...', 'info');
        const ok = await carregarDoCloud({ confirmOverwrite: false });
        if (ok) mostrarNotificacao('Dados carregados do Firestore com sucesso.', 'success');
        else mostrarNotificacao('Nenhum backup encontrado no Firestore ou falha ao carregar.', 'warning');
        return ok;
    } catch (e) {
        console.error('carregarDoCloudUI erro:', e);
        mostrarNotificacao('Erro ao carregar do cloud.', 'error');
        return false;
    } finally {
        if (typeof hideProgressBar === 'function') hideProgressBar();
    }
}

async function carregarDoCloud({confirmOverwrite=true} = {}) {
    if (!window.firestoreDB) {
        console.warn('Firestore não inicializado. Impossível carregar do cloud.');
        return false;
    }
    try {
        const docRef = window.firestoreDB.collection('app_data').doc('latest');
        const doc = await docRef.get();
        if (!doc.exists) {
            console.warn('Nenhum backup encontrado no Firestore.');
            updateFirestoreStatus(true, null, 'Cloud: pronto (sem backup)');
            return false;
        }
        const data = doc.data();
        if (!data || !data.estado) {
            console.warn('Documento encontrado não contém campo estado.');
            return false;
        }
        // obter timestamp de atualização remoto se disponível
        try {
            const updatedAt = data.updatedAt ? data.updatedAt.toDate() : null;
            updateFirestoreStatus(true, updatedAt, 'Cloud: carregado');
        } catch (inner) { updateFirestoreStatus(true, null, 'Cloud: carregado'); }
        if (confirmOverwrite) {
            const ok = confirm('Carregar dados do cloud irá substituir os dados locais. Deseja continuar?');
            if (!ok) return false;
        }
        estoque = data.estado;
        // Restaurar dados IMBEL salvos no backup principal (se existirem)
        try {
            if (data && data.estado && data.estado._imbelData) {
                try { localStorage.setItem(IMBEL_KEY, JSON.stringify(data.estado._imbelData)); console.info('IMBEL: restaurado do Cloud'); } catch (e) { console.warn('IMBEL: falha ao restaurar do Cloud', e); }
            } else if (estoque && estoque._imbelData) {
                try { localStorage.setItem(IMBEL_KEY, JSON.stringify(estoque._imbelData)); console.info('IMBEL: restaurado do backup principal'); } catch (e) { /* ignore */ }
            }
        } catch (e) {}
        const precifsCloudFinal = (data.precificacoesCliente && data.precificacoesCliente.length)
            ? data.precificacoesCliente
            : (estoque.precificacoesCliente || []);
        estoque.precificacoesCliente = normalizarPrecificacoesCliente(precifsCloudFinal);
        precificacoesCliente = estoque.precificacoesCliente;
        try { atualizarIndicadoresPrecificacao(); } catch (e) {}
        try { localStorage.setItem('precificacoesClienteBackupV1', JSON.stringify(precificacoesCliente || [])); } catch (e) {}
        if (!Array.isArray(estoque.auditoriaVendas)) estoque.auditoriaVendas = [];
        if (!Array.isArray(estoque.fechamentosComissoes)) estoque.fechamentosComissoes = [];
        if (!Array.isArray(estoque.clientes)) estoque.clientes = [];
        clientes = estoque.clientes;
        if (!Array.isArray(estoque.propostas)) estoque.propostas = [];
        propostas = estoque.propostas;
        if (estoque.precificacao && typeof estoque.precificacao === 'object') precificacao = estoque.precificacao;
        else { estoque.precificacao = {}; precificacao = estoque.precificacao; }

        precificacao = (data.precificacao && typeof data.precificacao === 'object')
            ? data.precificacao
            : (estoque.precificacao || {});
        tabelaAliquotas = (data.tabelaAliquotas && typeof data.tabelaAliquotas === 'object')
            ? data.tabelaAliquotas
            : (estoque.tabelaAliquotas || {});
        tabelaICMS = Array.isArray(data.tabelaICMS)
            ? data.tabelaICMS
            : (Array.isArray(estoque.tabelaICMS) ? estoque.tabelaICMS : []);
        categoriaPorProduto = (data.categoriaPorProduto && typeof data.categoriaPorProduto === 'object')
            ? data.categoriaPorProduto
            : (estoque.categoriaPorProduto || {});
        try { verificarExpiracaoPrecificacoes(); } catch (e) {}

        try { inicializarImpostosPreDefinidos(); } catch (e) { console.warn('Inicializar impostos predefinidos após cloud falhou:', e); }

        salvarDados();
        renderizarTabela();
        renderizarDashboard();
        renderizarRegistroVendas();
        renderizarRegistroDistribuicao();
        renderizarControleEnvio();
        renderizarClientes();
        atualizarKPIsClientes();
        atualizarDatalistClientes();
        renderizarPropostas();
        atualizarKPIsPropostas();
        if (abaAtiva === 'precificacao') renderizarPrecificacao();
        atualizarSelectsProdutos();
        atualizarSelectsRelatorios();
        try {
            // Detectar se a aba de Precificação está visível
            const tabPrecif = document.querySelector('#tab-precificacao');
            const tabPrecifVisivel = tabPrecif && (
                tabPrecif.style.display !== 'none' &&
                tabPrecif.classList.contains('active') ||
                tabPrecif.offsetParent !== null
            );

            if (tabPrecifVisivel) {
                // Tentar renderizar todas as subabas de precificação que possam estar ativas
                try { renderizarConsultaPrecificacao && renderizarConsultaPrecificacao(); } catch(e) {}
                try { renderizarRastreabilidade && renderizarRastreabilidade(); } catch(e) {}
            } else {
                // Marcar flag para renderizar quando a aba for aberta
                window._precificacaoPendenteRender = true;
            }
        } catch(e) { console.error('Erro re-render precif:', e); }
        console.debug('Dados carregados do Firestore com sucesso.');
        // Forçar re-render das abas de precificação após carregamento completo
        try {
            precificacoesCliente = Array.isArray(estoque.precificacoesCliente)
                ? estoque.precificacoesCliente
                : [];
            setTimeout(() => {
                try {
                    const abaAtiva = document.querySelector(
                        '#subaba-precif-consulta, #subaba-precif-rastreabilidade, ' +
                        '#subaba-precif-comparativo, #subaba-precif-imagem'
                    );
                    renderizarConsultaPrecificacao && renderizarConsultaPrecificacao();
                    renderizarRastreabilidade && renderizarRastreabilidade();
                } catch(e) {}
            }, 400);
        } catch(e) {}
        return true;
    } catch (e) {
        console.error('Erro carregando do Firestore:', e);
        return false;
    }
}

// Carrega automaticamente do cloud se o documento remoto for mais recente que o local
async function carregarDoCloudAuto() {
    if (!window.firestoreDB) return false;
    // Evitar leitura sem autenticação (causa Missing or insufficient permissions)
    try {
        if (!firebase || !firebase.auth || !firebase.auth().currentUser) {
            updateFirestoreStatus(true, null, 'Cloud: aguardando login');
            return false;
        }
    } catch (e) {
        return false;
    }
    try {
        const docRef = window.firestoreDB.collection('app_data').doc('latest');
        const doc = await docRef.get();
        if (!doc.exists) return false;
        const data = doc.data();
        const remoteUpdated = data.updatedAt ? data.updatedAt.toDate().getTime() : null;
        const localUpdated = estoque._localUpdatedAt ? new Date(estoque._localUpdatedAt).getTime() : 0;
        if (remoteUpdated && remoteUpdated > localUpdated) {
            // substituir local automaticamente
            estoque = data.estado;
            // Restaurar dados IMBEL salvos no backup principal (se existirem)
            try {
                if (data && data.estado && data.estado._imbelData) {
                    try { localStorage.setItem(IMBEL_KEY, JSON.stringify(data.estado._imbelData)); console.info('IMBEL: restaurado do Cloud (auto)'); } catch (e) { console.warn('IMBEL: falha ao restaurar do Cloud (auto)', e); }
                } else if (estoque && estoque._imbelData) {
                    try { localStorage.setItem(IMBEL_KEY, JSON.stringify(estoque._imbelData)); console.info('IMBEL: restaurado do backup principal (auto)'); } catch (e) { /* ignore */ }
                }
            } catch (e) {}
            estoque.precificacoesCliente = normalizarPrecificacoesCliente(
                data.precificacoesCliente && data.precificacoesCliente.length
                    ? data.precificacoesCliente
                    : (estoque.precificacoesCliente || [])
            );
            precificacoesCliente = estoque.precificacoesCliente; // sincroniza variável global
            try { atualizarIndicadoresPrecificacao(); } catch (e) {}
            try { localStorage.setItem('precificacoesClienteBackupV1', JSON.stringify(precificacoesCliente || [])); } catch (e) {}
            if (!Array.isArray(estoque.auditoriaVendas)) estoque.auditoriaVendas = [];
            if (!Array.isArray(estoque.fechamentosComissoes)) estoque.fechamentosComissoes = [];
            if (!Array.isArray(estoque.clientes)) estoque.clientes = [];
            clientes = estoque.clientes;
            if (!Array.isArray(estoque.propostas)) estoque.propostas = [];
            propostas = estoque.propostas;
            if (estoque.precificacao && typeof estoque.precificacao === 'object') precificacao = estoque.precificacao;
            else { estoque.precificacao = {}; precificacao = estoque.precificacao; }

            precificacao = (data.precificacao && typeof data.precificacao === 'object')
                ? data.precificacao
                : (estoque.precificacao || {});
            tabelaAliquotas = (data.tabelaAliquotas && typeof data.tabelaAliquotas === 'object')
                ? data.tabelaAliquotas
                : (estoque.tabelaAliquotas || {});
            tabelaICMS = Array.isArray(data.tabelaICMS)
                ? data.tabelaICMS
                : (Array.isArray(estoque.tabelaICMS) ? estoque.tabelaICMS : []);
            categoriaPorProduto = (data.categoriaPorProduto && typeof data.categoriaPorProduto === 'object')
                ? data.categoriaPorProduto
                : (estoque.categoriaPorProduto || {});

            // Restaurar tabelas de impostos editáveis quando disponíveis
            impostosEditaveis = (data.impostosEditaveis && typeof data.impostosEditaveis === 'object') ? data.impostosEditaveis : (estoque.impostosEditaveis || {});
            icmsEditavelPJ    = (data.icmsEditavelPJ && typeof data.icmsEditavelPJ === 'object') ? data.icmsEditavelPJ : (estoque.icmsEditavelPJ || {});
            icmsEditavelPF    = (data.icmsEditavelPF && typeof data.icmsEditavelPF === 'object') ? data.icmsEditavelPF : (estoque.icmsEditavelPF || {});
            try { inicializarImpostosEditaveis(); } catch (e) {}
            try { inicializarICMSEditavel(); } catch (e) {}

            salvarDados();
            renderizarTabela();
            renderizarDashboard();
            renderizarRegistroVendas();
            renderizarRegistroDistribuicao();
            renderizarControleEnvio();
            renderizarClientes();
            atualizarKPIsClientes();
            atualizarDatalistClientes();
            renderizarPropostas();
            atualizarKPIsPropostas();
            if (abaAtiva === 'precificacao') renderizarPrecificacao();
            atualizarSelectsProdutos();
            atualizarSelectsRelatorios();
            try {
                const consultaEl = document.getElementById('subaba-precif-consulta');
                const rastreaEl = document.getElementById('subaba-precif-rastreabilidade');
                const isConsultaVis = consultaEl ? consultaEl.style.display !== 'none' : false;
                const isRastreaVis  = rastreaEl ? rastreaEl.style.display !== 'none' : false;
                if (isConsultaVis && typeof renderizarConsultaPrecificacao === 'function') renderizarConsultaPrecificacao();
                if (isRastreaVis && typeof renderizarRastreabilidade === 'function') renderizarRastreabilidade();
            } catch (e) {}
            console.debug('Dados carregados automaticamente do Firestore (remoto mais recente).');
            return true;
        }
        return false;
    } catch (e) {
        // Quando regras bloquearem leitura, não poluir console com erro fatal
        console.warn('carregarDoCloudAuto: leitura não permitida pelo perfil atual.');
        return false;
    }
}

// ============================
// Auto-save (debounced) helpers
// ============================
window.__AUTO_SAVE_CLOUD = {
    enabled: true,
    debounceMs: 2500,
    timerId: null,
    inProgress: false
};

function scheduleCloudSaveDebounced() {
    if (!window.__AUTO_SAVE_CLOUD.enabled) return;
    if (!window.firestoreDB) return;
    // permitir auto-save para usuários autenticados OU para admin (fallback)
    try {
        const fbUser = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
        const cachedAdmin = (typeof isCurrentUserAdmin === 'function') ? isCurrentUserAdmin() : false;
        if (!fbUser && !cachedAdmin) return;
    } catch (e) {
        if (!isCurrentUserAdmin()) return;
    }
    if (window.__AUTO_SAVE_CLOUD.timerId) clearTimeout(window.__AUTO_SAVE_CLOUD.timerId);
    window.__AUTO_SAVE_CLOUD.timerId = setTimeout(async () => {
        window.__AUTO_SAVE_CLOUD.timerId = null;
        if (window.__AUTO_SAVE_CLOUD.inProgress) return;
        window.__AUTO_SAVE_CLOUD.inProgress = true;
        try {
            await salvarNoCloud();
        } catch (e) {
            console.error('Auto-save falhou:', e);
        } finally {
            window.__AUTO_SAVE_CLOUD.inProgress = false;
        }
    }, window.__AUTO_SAVE_CLOUD.debounceMs);
}

function iniciarAutoSaveCloud() {
    // ativa auto-save se Firestore presente
    if (!window.firestoreDB) return;
    window.__AUTO_SAVE_CLOUD.enabled = true;
    // salvar a cada X minutos também (fallback periódico)
    if (!window.__AUTO_SAVE_CLOUD.periodicId) {
        window.__AUTO_SAVE_CLOUD.periodicId = setInterval(() => {
            if (!window.__AUTO_SAVE_CLOUD.inProgress) {
                salvarNoCloud().catch(e => console.error('Auto-save periódico falhou:', e));
            }
        }, 1000 * 60 * 5); // a cada 5 minutos
    }
}

function pararAutoSaveCloud() {
    window.__AUTO_SAVE_CLOUD.enabled = false;
    if (window.__AUTO_SAVE_CLOUD.timerId) {
        clearTimeout(window.__AUTO_SAVE_CLOUD.timerId);
        window.__AUTO_SAVE_CLOUD.timerId = null;
    }
    if (window.__AUTO_SAVE_CLOUD.periodicId) {
        clearInterval(window.__AUTO_SAVE_CLOUD.periodicId);
        window.__AUTO_SAVE_CLOUD.periodicId = null;
    }
}

function atualizarData() {
    const agora = new Date();
    const opcoes = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    const dataFormatada = agora.toLocaleDateString('pt-BR', opcoes);
    const dataAtualEl = document.getElementById('dataAtual');
    if (dataAtualEl) dataAtualEl.textContent = dataFormatada;
}

function atualizarEstatisticas() {
    let totalEstoque = 0;
    let totalVendas = 0;
    let valorTotalVendas = 0;

    estoque.produtos.forEach(produto => {
        estoque.representantes.forEach(rep => {
            const disp = produto.distribuicao[rep] || 0;
            const venda = produto.vendas[rep] || 0;
            totalEstoque += (disp - venda);
            totalVendas += venda;
        });
    });

    // Corrigir cálculo de faturamento: somar valorTotal de todas vendas registradas
    valorTotalVendas = 0;
    if (Array.isArray(estoque.registroVendas)) {
        estoque.registroVendas.forEach(venda => {
            if (venda && venda.cancelado) return; // ignorar vendas canceladas ao somar faturamento
            if (Array.isArray(venda.items) && venda.items.length > 0) {
                venda.items.forEach(it => {
                    valorTotalVendas += it.valorTotal || 0;
                });
            } else {
                valorTotalVendas += venda.valorTotal || 0;
            }
        });
    }

    const totalProdutosEl = document.getElementById('totalProdutos');
    if (totalProdutosEl) totalProdutosEl.textContent = estoque.produtos.length;

    const totalEstoqueEl = document.getElementById('totalEstoque');
    if (totalEstoqueEl) totalEstoqueEl.textContent = totalEstoque.toLocaleString('pt-BR');

    const totalVendasEl = document.getElementById('totalVendas');
    if (totalVendasEl) totalVendasEl.textContent = totalVendas.toLocaleString('pt-BR');

    const dashContainer = document.getElementById('tab-dashboard');
    const valorTotalVendasEl = (dashContainer && dashContainer.querySelector)
        ? (dashContainer.querySelector('#valorTotalVendas') || document.getElementById('valorTotalVendas'))
        : document.getElementById('valorTotalVendas');
    if (valorTotalVendasEl) valorTotalVendasEl.textContent = formatarMoedaValor(valorTotalVendas);
    // Calcular total de comissões (5%) excluindo vendas da IMBEL
    let totalComissoes = 0;
    if (Array.isArray(estoque.registroVendas)) {
        estoque.registroVendas.forEach(venda => {
            if (venda && venda.cancelado) return; // ignorar vendas canceladas
            const rep = (venda.representante || '').toString().trim().toUpperCase();
            if (rep === 'IMBEL') return; // sem comissão
            let valor = 0;
            if (Array.isArray(venda.items) && venda.items.length > 0) {
                venda.items.forEach(it => {
                    const valorItem = typeof it.valorTotal === 'number'
                        ? it.valorTotal
                        : ((Number(it.valorUnitario) || 0) * (Number(it.quantidade) || 0));
                    valor += valorItem;
                });
            } else {
                valor = typeof venda.valorTotal === 'number'
                    ? venda.valorTotal
                    : ((Number(venda.valorUnitario) || 0) * (Number(venda.quantidade) || 0));
            }
            totalComissoes += (Math.round((valor * 0.05) * 100) / 100);
        });
    }
    try {
        const totalComissoesEl = (dashContainer && dashContainer.querySelector)
            ? (dashContainer.querySelector('#totalComissoes') || document.getElementById('totalComissoes'))
            : document.getElementById('totalComissoes');
        if (totalComissoesEl) totalComissoesEl.textContent = formatarMoedaValor(totalComissoes);
    } catch (e) {}
}

// Helper global: normaliza várias formas de data para YYYY-MM-DD
function parseDateToYYYYMMDD(input) {
    if (!input && input !== 0) return null;
    // Firestore Timestamp-like objects (has toDate)
    try {
        if (input && typeof input.toDate === 'function') {
            const dt = input.toDate();
            if (dt instanceof Date && !isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
        }
    } catch (e) {}
    // Objects with seconds (e.g., { seconds, nanoseconds })
    if (input && typeof input === 'object') {
        if (typeof input.seconds === 'number') {
            const dt = new Date(input.seconds * 1000);
            if (!isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
        }
        if (typeof input._seconds === 'number') {
            const dt = new Date(input._seconds * 1000);
            if (!isNaN(dt.getTime())) return dt.toISOString().slice(0,10);
        }
    }

    if (input instanceof Date) {
        if (isNaN(input.getTime())) return null;
        return input.toISOString().slice(0,10);
    }

    let s = String(input).trim();
    // ISO-like (starts with YYYY-MM-DD)
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    // BR format DD/MM/YYYY
    const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    // Try parsing general string
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
    return null;
}

// Formata uma data (aceita 'YYYY-MM-DD', Date ou strings) para 'DD/MM/YYYY'
function formatDateToDDMMYYYY(input) {
    if (!input && input !== 0) return '-';
    try {
        // Already in YYYY-MM-DD
        if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
            const parts = input.split('-');
            return `${parts[2].padStart(2,'0')}/${parts[1].padStart(2,'0')}/${parts[0]}`;
        }
        // Date-like
        const d = (input instanceof Date) ? input : new Date(input);
        if (!isNaN(d.getTime())) {
            const dd = String(d.getDate()).padStart(2,'0');
            const mm = String(d.getMonth() + 1).padStart(2,'0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        }
    } catch (e) {}
    return '-';
}

function formatCpfCnpjMask(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 14);
    if (!digits) return '';

    if (digits.length <= 11) {
        if (digits.length <= 3) return digits;
        if (digits.length <= 6) return `${digits.slice(0,3)}.${digits.slice(3)}`;
        if (digits.length <= 9) return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6)}`;
        return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
    }

    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return `${digits.slice(0,2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
    if (digits.length <= 12) return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8)}`;
    return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
}

// Validação de CPF/CNPJ (dígitos verificadores)
function validarCPF(cpf) {
    const digits = String(cpf || '').replace(/\D/g, '');
    if (digits.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(digits)) return false;

    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * (10 - i);
    let rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(digits[9], 10)) return false;

    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(digits[i], 10) * (11 - i);
    rest = (sum * 10) % 11;
    if (rest === 10 || rest === 11) rest = 0;
    if (rest !== parseInt(digits[10], 10)) return false;

    return true;
}

function validarCNPJ(cnpj) {
    const digits = String(cnpj || '').replace(/\D/g, '');
    if (digits.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(digits)) return false;

    let len = digits.length - 2;
    let nums = digits.substring(0, len);
    const digs = digits.substring(len);
    let sum = 0;
    let pos = len - 7;

    for (let i = len; i >= 1; i--) {
        sum += parseInt(nums.charAt(len - i), 10) * pos--;
        if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digs.charAt(0), 10)) return false;

    len = digits.length - 1;
    nums = digits.substring(0, len);
    sum = 0;
    pos = len - 7;

    for (let i = len; i >= 1; i--) {
        sum += parseInt(nums.charAt(len - i), 10) * pos--;
        if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digs.charAt(1), 10)) return false;

    return true;
}

function validarDocumentoCliente() {
    const cnpjEl = document.getElementById('clienteCnpj');
    const tipoEl = document.getElementById('clienteTipoPessoa');
    if (!cnpjEl) return true;

    const valor = String(cnpjEl.value || '').trim();
    if (!valor) return true;

    const tipo = tipoEl?.value || 'PJ';
    const digits = valor.replace(/\D/g, '');
    const valido = tipo === 'PF' ? validarCPF(digits) : validarCNPJ(digits);

    if (!valido) {
        cnpjEl.style.borderColor = '#dc2626';
        cnpjEl.style.background = '#fef2f2';
        let errEl = document.getElementById('erroCnpj');
        if (!errEl) {
            errEl = document.createElement('div');
            errEl.id = 'erroCnpj';
            errEl.style.cssText = 'color:#dc2626;font-size:0.78rem;margin-top:4px;font-weight:500';
            cnpjEl.parentNode.appendChild(errEl);
        }
        errEl.textContent = tipo === 'PF' ? '❌ CPF inválido — verifique os dígitos' : '❌ CNPJ inválido — verifique os dígitos';
        cnpjEl.focus();
        return false;
    }

    cnpjEl.style.borderColor = '#22c55e';
    cnpjEl.style.background = '#f0fdf4';
    const errEl = document.getElementById('erroCnpj');
    if (errEl) errEl.textContent = '✅ ' + (tipo === 'PF' ? 'CPF válido' : 'CNPJ válido');
    return true;
}

function limparValidacaoDocumento() {
    const cnpjEl = document.getElementById('clienteCnpj');
    if (cnpjEl) {
        cnpjEl.style.borderColor = '';
        cnpjEl.style.background = '';
    }
    const errEl = document.getElementById('erroCnpj');
    if (errEl) errEl.textContent = '';
}

function formatPhoneMask(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
    return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
}

function formatCurrencyBRLInput(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits) return '';
    const cents = Number(digits);
    return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCurrencyBRLToNumber(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const normalized = text
        .replace(/\s/g, '')
        .replace(/[R$r$]/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const parsed = Number(normalized.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function bindImbelMovInputMasks() {
    const cpfInput = document.getElementById('imbel_mov_cpf');
    const telInput = document.getElementById('imbel_mov_tel');
    const valorInput = document.getElementById('imbel_mov_valor');

    if (cpfInput && !cpfInput.dataset.maskBound) {
        cpfInput.addEventListener('input', function() {
            this.value = formatCpfCnpjMask(this.value);
        });
        cpfInput.dataset.maskBound = '1';
    }

    if (telInput && !telInput.dataset.maskBound) {
        telInput.addEventListener('input', function() {
            this.value = formatPhoneMask(this.value);
        });
        telInput.dataset.maskBound = '1';
    }

    if (valorInput && !valorInput.dataset.maskBound) {
        valorInput.addEventListener('input', function() {
            this.value = formatCurrencyBRLInput(this.value);
        });
        valorInput.dataset.maskBound = '1';
    }
}

function normalizarContratoKey(valor) {
    const bruto = (valor ?? '').toString().normalize('NFKC');
    const clean = bruto.replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
    const digitos = clean.replace(/\D+/g, '');
    return digitos ? String(parseInt(digitos, 10)) : clean.toUpperCase();
}

function formatarContratoDisplay(valor, fallbackYear) {
    const bruto = (valor ?? '').toString().normalize('NFKC');
    const clean = bruto.replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
    const currentYear = fallbackYear || new Date().getFullYear();
    // formato com separador: 002/2026 ou 2-2026
    const m = clean.match(/^(\d+)\D+(\d{4})$/);
    if (m) {
        const seq = String(parseInt(m[1], 10)).padStart(3, '0');
        const yr = m[2];
        return seq + '/' + yr;
    }
    const digits = clean.replace(/\D+/g, '');
    if (digits) {
        if (digits.length > 4) {
            const maybeYear = parseInt(digits.slice(-4), 10);
            if (!isNaN(maybeYear) && maybeYear >= 2000 && maybeYear <= 2099) {
                const seq = String(parseInt(digits.slice(0, -4), 10) || 0).padStart(3, '0');
                return seq + '/' + maybeYear;
            }
        }
        const seq = String(parseInt(digits, 10) || 0).padStart(3, '0');
        return seq + '/' + currentYear;
    }
    return '-';
}

function getUsuarioAtual() {
    let usuario = '';
    try { usuario = (localStorage.getItem('estoqueUsuarioAtual') || '').trim(); } catch (e) {}
    if (!usuario) {
        usuario = (prompt('Informe seu nome/usuário para auditoria:') || '').trim();
        if (!usuario) usuario = 'Usuário';
        try { localStorage.setItem('estoqueUsuarioAtual', usuario); } catch (e) {}
    }
    return usuario;
}

function registrarAuditoriaVenda(acao, vendaAntes, vendaDepois, detalhes = '') {
    if (!Array.isArray(estoque.auditoriaVendas)) estoque.auditoriaVendas = [];
    const base = vendaDepois || vendaAntes || {};
    const contrato = normalizarContratoKey(base.contrato || '');
    const entry = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        quando: new Date().toISOString(),
        quem: getUsuarioAtual(),
        acao: acao,
        contrato: contrato || '-',
        vendaId: base.id || null,
        antes: vendaAntes || null,
        depois: vendaDepois || null,
        detalhes: detalhes || ''
    };
    estoque.auditoriaVendas.push(entry);
    if (estoque.auditoriaVendas.length > 1000) {
        estoque.auditoriaVendas = estoque.auditoriaVendas.slice(-1000);
    }
}

function obterAuditoriaPorContrato(contrato) {
    const key = normalizarContratoKey(contrato || '');
    const lista = Array.isArray(estoque.auditoriaVendas) ? estoque.auditoriaVendas : [];
    return lista.filter(a => normalizarContratoKey(a.contrato || '') === key)
        .sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime());
}

// ========================================
// RENDER: AUDITORIA DE VENDAS
// ========================================

function renderizarAuditoria() {
    const tbody = document.getElementById('auditoriaTbody');
    if (!tbody) return;

    const busca  = (document.getElementById('auditoriaBusca')?.value || '').toLowerCase();
    const filtroAcao = document.getElementById('auditoriaFiltroAcao')?.value || '';

    const lista = (estoque.auditoriaVendas || [])
        .slice()
        .reverse()
        .filter(a => {
            if (filtroAcao && !(a.acao||'').toUpperCase().includes(filtroAcao)) return false;
            if (busca) {
                return (a.contrato||'').toLowerCase().includes(busca) ||
                             (a.quem||'').toLowerCase().includes(busca) ||
                             (a.acao||'').toLowerCase().includes(busca) ||
                             (a.detalhes||'').toLowerCase().includes(busca);
            }
            return true;
        });

    const acaoColor = {
        'CRIAÇÃO':      { bg:'#f0fdf4', text:'#16a34a', icon:'➕' },
        'EDIÇÃO':       { bg:'#eff6ff', text:'#1d4ed8', icon:'✏️' },
        'EXCLUSÃO':     { bg:'#fef2f2', text:'#dc2626', icon:'🗑️' },
        'CANCELAMENTO': { bg:'#fff8f0', text:'#d97706', icon:'⛔' },
    };

    if (!lista.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;color:#94a3b8;padding:40px">Nenhum registro de auditoria encontrado</td>
            </tr>`;
        const cnt = document.getElementById('auditoriaCount');
        if (cnt) cnt.textContent = '0 registros';
        return;
    }

    tbody.innerHTML = lista.map((a, i) => {
        const dt = a.quando ? new Date(a.quando).toLocaleString('pt-BR') : '—';
        const acaoUpper = (a.acao||'').toUpperCase();
        const colorKey = Object.keys(acaoColor).find(k => acaoUpper.includes(k));
        const ac = acaoColor[colorKey] || { bg:'#f8fafc', text:'#475569', icon:'📝' };

        let delta = a.detalhes || '';
        if (a.antes && a.depois) {
            const campos = [];
            ['valorTotal','representante','contrato','loja'].forEach(campo => {
                const antes  = a.antes[campo];
                const depois = a.depois[campo];
                if (antes !== undefined && depois !== undefined && antes !== depois) {
                    campos.push(`${campo}: ${antes} → ${depois}`);
                }
            });
            if (campos.length) delta = campos.join(' | ');
        }

        return `
            <tr style="background:${i%2===0?'#fff':'#f8fafc'};border-bottom:1px solid #f1f5f9">
                <td style="font-size:0.78rem;color:#475569;white-space:nowrap">${dt}</td>
                <td style="font-size:0.8rem;font-weight:500;color:#1e293b">${a.quem || 'Sistema'}</td>
                <td><span style="background:${ac.bg};color:${ac.text};font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:20px;white-space:nowrap">${ac.icon} ${a.acao || '—'}</span></td>
                <td style="font-weight:700;color:#1e3a5f">${a.contrato ? '#' + a.contrato : '—'}</td>
                <td style="font-size:0.78rem;color:#64748b;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${delta}">${delta || '—'}</td>
            </tr>`;
    }).join('');

    const cnt = document.getElementById('auditoriaCount');
    if (cnt) cnt.textContent = `${lista.length} de ${(estoque.auditoriaVendas||[]).length} registros`;
}

function exportarAuditoria() {
    const lista = (estoque.auditoriaVendas||[]).slice().reverse();
    if (!lista.length) { mostrarNotificacao('Nenhum registro para exportar.', 'warning'); return; }
    const rows = lista.map(a => ({
        'Data/Hora': a.quando ? new Date(a.quando).toLocaleString('pt-BR') : '',
        'Usuário':   a.quem   || 'Sistema',
        'Ação':      a.acao   || '',
        'Contrato':  a.contrato || '',
        'Detalhes':  a.detalhes || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Auditoria');
    XLSX.writeFile(wb, 'auditoria_' + new Date().toISOString().split('T')[0] + '.xlsx');
}

// ========================================
// NAVEGAÇÃO POR ABAS
// ========================================

function trocarAba(aba) {
    try {
        const targetId = `tab-${aba}`;
        const target = document.getElementById(targetId);
        if (!target) {
            const msg = `Aba não encontrada: ${targetId}`;
            console.error(msg);
            if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(msg);
            return;
        }

        abaAtiva = aba;
        try { window.abaAtiva = aba; } catch (e) {}

        // Atualizar botões de navegação — escopo restrito ao estoque
        const estoqueScope = document.getElementById('estoqueSidebar') || document.getElementById('estoqueContainer');
        if (estoqueScope) {
            estoqueScope.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
            const activeBtn = estoqueScope.querySelector(`.nav-item[data-estoque-tab-internal="${aba}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }
        // Atualizar botão no sidebar externo do Ponto
        document.querySelectorAll('[data-estoque-tab]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.estoqueTab === aba);
        });

        // Atualizar conteúdo — escopo restrito ao container do estoque
        const estoqueContent = document.getElementById('estoqueMainContent') || document;
        estoqueContent.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        target.classList.add('active');

        // Mostrar/ocultar barra de ações
        const acoesEstoque = document.getElementById('acoesEstoque');
        if (acoesEstoque) acoesEstoque.style.display = (aba === 'estoque') ? 'flex' : 'none';

        if (aba === 'dashboard') {
            try { renderizarDashboard(); } catch (e) { console.error('dashboard:', e); if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'cadastro-produtos') {
            try { renderizarCadastroProdutos(); } catch (e) { console.error('cadastro-produtos:', e); if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'vendas') {
            try { renderizarRegistroVendas(); } catch (e) { console.error('vendas:', e); if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'distribuicao') {
            try { popularSelectRepresentantes('filtroDistribuicaoRep', true); } catch (e) {}
            try { atualizarSelectDistribuicaoProduto(); } catch (e) {}
            try { renderizarRegistroDistribuicao(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'relatorios') {
            try { prepararRelatorioInventario(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
            try { gerarRelatorioRentabilidade(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'controleenvio') {
            try { renderizarControleEnvio(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'controleimbel') {
            try { trocarSubAbaControleImbel('dashboard'); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'precificacao') {
            try { trocarSubabaPrecif('porcliente'); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
            try { renderizarPrecificacao(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
            try { popularSelectProdutosPrecif(); } catch (e) {}
            // Se o carregamento anterior deixou uma render pendente, disparar agora
            try {
                if (window._precificacaoPendenteRender) {
                    window._precificacaoPendenteRender = false;
                    setTimeout(() => {
                        try { renderizarConsultaPrecificacao && renderizarConsultaPrecificacao(); } catch(e) {}
                        try { renderizarRastreabilidade && renderizarRastreabilidade(); } catch(e) {}
                    }, 100);
                }
            } catch(e) {}
        } else if (aba === 'clientes') {
            try { renderizarClientes(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'propostas') {
            try { renderizarPropostas(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'estoque') {
            try { renderizarTabela(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
        } else if (aba === 'configuracoes') {
            try { atualizarPreviaContrato(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
            try { renderizarAuditoria(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
            try { renderizarConfigVendedor(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
            try { renderizarSelectConfigRep(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
            try { renderizarListaRepresentantesConfig(); } catch(e) {}
        }

        try { if (window.__updateDebugPanel) window.__updateDebugPanel(); } catch (e) {}

        // Fechar drawer mobile ao trocar aba
        try { document.body.classList.remove('mobile-sidebar-open'); } catch (e) {}
    } catch (err) {
        console.error('trocarAba falhou:', err);
        if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(err);
    }
}

// ========================================
// RENDERIZAÇÃO DA TABELA DE ESTOQUE
// ========================================

function getInventoryRepsOrder() {
    const stored = Array.isArray(estoque.representantes) ? estoque.representantes.map(r => String(r).toUpperCase()) : [];
    const baseline = ['ISA','KOLTE','ADES','FL','LC'];
    // Começar sempre com a ordem fixa solicitada
    const order = baseline.slice();
    // Não adicionar representantes extras — manter apenas a baseline solicitada e IMBEL
    if (!order.includes('IMBEL')) order.push('IMBEL');
    return order;
}

function repClassName(rep) {
    return 'rep-' + String(rep || '').toLowerCase().replace(/[^a-z0-9\-]/g, '-');
}

// Abre a aba 'vendas' filtrada por produto e representante (função global usada por onclick)
function abrirVendasPorProduto(produtoId, representante) {
    try {
        try { atualizarSelectsProdutos(); } catch (e) {}
        try { popularSelectRepresentantes('filtroRepresentante', true); } catch (e) {}
        const filtroProduto = document.getElementById('filtroProduto');
        const filtroRep = document.getElementById('filtroRepresentante');
        if (filtroProduto) filtroProduto.value = produtoId || '';
        if (filtroRep) filtroRep.value = representante || '';
        trocarAba('vendas');
        setTimeout(() => {
            try {
                renderizarRegistroVendas();
                // rolar para a primeira linha que contenha o produto (se houver)
                try {
                    const prod = (estoque.produtos || []).find(p => Number(p.id) === Number(produtoId));
                    if (prod) {
                        const rows = Array.from(document.querySelectorAll('#tabelaRegistroVendasBody tr'));
                        for (const r of rows) {
                            if ((r.textContent || '').includes(prod.nome)) { r.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; }
                        }
                    }
                } catch (e) {}
            } catch (e) { console.warn('abrirVendasPorProduto renderizar erro', e); }
        }, 80);
    } catch (e) { console.warn('abrirVendasPorProduto erro', e); }
}

function renderizarTabela() {
    const tbody = document.getElementById('corpoTabela');
    if (!tbody) return;
    tbody.innerHTML = '';
    const totais = { GERAL: { disp: 0, venda: 0, saldo: 0 } };
    const repsOrder = getInventoryRepsOrder();
    repsOrder.forEach(rep => { totais[rep] = { disp: 0, venda: 0, saldo: 0 }; });

    // Ordem de exibição: apenas produtos marcados para exibir no estoque
    const produtosOrdenados = [...estoque.produtos]
        .filter(p => p.exibirNoEstoque === true)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    let countConsolidadoZeradoOuNegativo = 0;

    produtosOrdenados.forEach(produto => {
        const tr = document.createElement('tr');
        tr.dataset.id = produto.id;
        let produtoHtml = produto.nome;
        // Incluir observações internas junto ao nome (exibidas em pequena linha)
        const obs = produto.observacoes ? String(produto.observacoes).trim() : '';
        const obsHtml = obs
            ? `<div style="font-size:0.72rem;color:#94a3b8;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="${_escapeHtml(obs)}">📝 ${_escapeHtml(obs)}</div>`
            : '';
        // Produto HTML com escape para evitar XSS
        produtoHtml = `${_escapeHtml(String(produto.nome || ''))}${obsHtml}`;
        const metricaImbel = obterMetricasImbelProduto(produto);

        const produtoId = produto.id;
        const estoqueTotal = Number(
            (produto.estoqueConsolidado ?? produto.estoqueTotal ?? produto.estoque ?? produto.qtdTotal ?? produto.estoqueInicial) || 0
        ); // fonte de verdade (compatível com vários nomes)

        // === STEP 2: distribuições por representante (agregar do registro)
        const distPorRep = {};
        (estoque.registroDistribuicao || []).forEach(d => {
            try {
                if (Number(d.produtoId) === Number(produtoId) || (d.produtoNome && d.produtoNome === produto.nome)) {
                    const r = (d.representante || '').toString().toUpperCase();
                    distPorRep[r] = (distPorRep[r] || 0) + (Number(d.quantidade) || 0);
                }
            } catch (e) {}
        });
        const totalDistribuido = Object.values(distPorRep).reduce((s, v) => s + v, 0);

        // === STEP 3: devoluções por representante (origem da devolução)
        const devPorRep = {};
        let totalDevolvidoParaImbel = 0;
        (estoque.registroDevolucoes || []).forEach(d => {
            try {
                if (Number(d.produtoId) === Number(produtoId) || (d.produtoNome && d.produtoNome === produto.nome)) {
                    const origem = (d.origem || d.representante || '').toString().toUpperCase();
                    const destino = (d.destino || '').toString().toUpperCase();
                    devPorRep[origem] = (devPorRep[origem] || 0) + (Number(d.quantidade) || 0);
                    if (destino === 'IMBEL') totalDevolvidoParaImbel += (Number(d.quantidade) || 0);
                }
            } catch (e) {}
        });
        const totalDevolvido = Object.values(devPorRep).reduce((s, v) => s + v, 0);

        // === STEP 4: vendas por representante - preferir o agregado em produto.vendas
        const vendasPorRep = {};
        let agregadoTemValores = false;
        if (produto.vendas && typeof produto.vendas === 'object') {
            Object.keys(produto.vendas).forEach(k => {
                const val = Number(produto.vendas[k]) || 0;
                if (val !== 0) agregadoTemValores = true;
                vendasPorRep[(k||'').toString().toUpperCase()] = val;
            });
        }
        // Se o agregado estiver zerado (produto.vendas não confiável), popular a partir de registroVendas
        if (!agregadoTemValores) {
            (estoque.registroVendas || []).forEach(v => {
                try {
                    const rep = (v.representante || '').toString().toUpperCase();
                    if (Array.isArray(v.items) && v.items.length) {
                        v.items.forEach(it => {
                            if (Number(it.produtoId) === Number(produtoId) || (it.produto === produto.nome) || (it.produtoNome === produto.nome)) {
                                vendasPorRep[rep] = (vendasPorRep[rep] || 0) + (Number(it.quantidade) || 0);
                            }
                        });
                    } else {
                        if (Number(v.produtoId) === Number(produtoId) || (v.produtoNome === produto.nome)) {
                            vendasPorRep[rep] = (vendasPorRep[rep] || 0) + (Number(v.quantidade) || 0);
                        }
                    }
                } catch (e) {}
            });
        }

        // total vendas do produto (em todos os reps)
        const totalVendasProduto = Object.values(vendasPorRep).reduce((s, v) => s + v, 0);

        // === STEP 5: montar colunas por representante na ordem configurada (ISA, KOLTE, ADES, FL, LC, IMBEL)
        repsOrder.forEach(rep => {
            const repKey = (rep || '').toString().toUpperCase();
            const repCls = repClassName(repKey);
            let disp = 0, venda = 0, saldo = 0;
            if (repKey === 'IMBEL') {
                // IMBEL centralizado para evitar divergência entre abas
                disp = metricaImbel.imbelDisp;
                venda = metricaImbel.imbelVenda;
                saldo = metricaImbel.imbelSaldo;
            } else {
                const dist = distPorRep[repKey] || 0;
                const dev = devPorRep[repKey] || 0;
                disp = dist - dev; // enviado ao rep menos o que ele devolveu
                venda = vendasPorRep[repKey] || 0;
                saldo = disp - venda;
            }

            // Determinar se há movimento para este rep (usado para mostrar '-')
            const repTeveMovimento = (Number(distPorRep[repKey] || 0) !== 0) || (Number(devPorRep[repKey] || 0) !== 0) || (Number(vendasPorRep[repKey] || 0) !== 0);

            // Formatação de células e classes conforme regras
            const dispText = (repKey === 'IMBEL' && estoqueTotal === 0) ? '-' : (repTeveMovimento || repKey === 'IMBEL' ? formatarNumero(disp) : '-');
            const vendaText = repTeveMovimento || (repKey === 'IMBEL' && (vendasPorRep['IMBEL']||0) > 0) ? formatarNumero(venda) : '-';
            let saldoText = '-';
            if (repKey === 'IMBEL' && estoqueTotal === 0) {
                saldoText = '-';
            } else if (!repTeveMovimento && repKey !== 'IMBEL') {
                saldoText = '-';
            } else {
                saldoText = formatarNumero(saldo);
            }

            const vendaClass = (Number(venda) > 0) ? 'cell-venda' : 'cell-zero';
            // saldo sempre usa 'cell-saldo' e adiciona modificadores
            let saldoClass = 'cell-saldo';
            if (Number(saldo) > 0) saldoClass += ' saldo-positivo';
            else if (Number(saldo) === 0) {
                const dispVal = Number(disp) || 0;
                saldoClass += (dispVal > 0) ? ' negativo' : ' saldo-zero';
            } else { // negativo
                saldoClass += ' negativo';
            }

            // tornar o número de vendas clicável para abrir a aba de vendas filtrada
            let vendaInner = vendaText;
            try {
                if (Number(venda) > 0) {
                    const repEsc = _escapeJsString(repKey);
                    vendaInner = `<a href="#" onclick="abrirVendasPorProduto(${produtoId}, '${repEsc}'); return false;" style="color:inherit;text-decoration:underline">${formatarNumero(venda)}</a>`;
                }
            } catch (e) {}

            tr.innerHTML += `
                <td class="cell-disp numeric-cell ${(!isFinite(disp) || disp === 0) ? 'cell-zero' : ''} ${repCls}">${dispText}</td>
                <td class="cell-venda numeric-cell ${venda === 0 ? 'cell-zero' : ''} ${vendaClass} ${repCls}">${vendaInner}</td>
                <td class="cell-saldo numeric-cell ${saldoClass} ${saldo === 0 ? 'cell-zero' : ''} ${repCls}">${saldoText}</td>
            `;

            // Atualizar totais por rep
            totais[repKey].disp += Number(disp) || 0;
            totais[repKey].venda += Number(venda) || 0;
            totais[repKey].saldo += Number(saldo) || 0;
        });

        // === STEP 7: CONSOLIDADO (sempre exibir número)
        const consolidadoDisp = metricaImbel.consolidadoDisp;
        const consolidadoVenda = metricaImbel.consolidadoVenda;
        const consolidadoSaldo = metricaImbel.consolidadoSaldo;

        tr.innerHTML = `<td class="produto-nome col-produto" title="${_escapeHtml(String(produto.nome || ''))}" onclick="abrirModalEditarProduto(${produtoId})" style="cursor:pointer">${produtoHtml}</td>` + tr.innerHTML;
        // armazenar observações no dataset para buscas e mostrar tooltip ao passar o mouse sobre a linha
        try { tr.dataset.observacoes = obs; } catch (e) {}
        tr.title = obs ? `📝 ${obs}` : (tr.title || '');

        const saldoGeralClass = consolidadoSaldo > 0 ? 'saldo-positivo' : 'negativo';
        tr.innerHTML += `
            <td class="geral-disp numeric-cell">${formatarNumero(consolidadoDisp)}</td>
            <td class="geral-venda numeric-cell ${consolidadoVenda > 0 ? 'venda-positiva' : ''}">${formatarNumero(consolidadoVenda)}</td>
            <td class="geral-saldo numeric-cell ${saldoGeralClass}">${formatarNumero(consolidadoSaldo)}</td>
        `;

        // Marcar linha quando o saldo consolidado for exatamente zero
        if (Number(consolidadoSaldo) === 0) {
            tr.classList.add('row-saldo-zero');
        } else {
            tr.classList.remove('row-saldo-zero');
        }

        // Flag produto com consolidado zerado ou negativo (para KPI)
        if (consolidadoSaldo <= 0) countConsolidadoZeradoOuNegativo += 1;

        // Atualizar totais gerais
        totais.GERAL.disp += consolidadoDisp;
        totais.GERAL.venda += consolidadoVenda;
        totais.GERAL.saldo += consolidadoSaldo;

        tbody.appendChild(tr);
    });

    // Linha de totais
    const trTotal = document.createElement('tr');
    trTotal.className = 'total-row';
    trTotal.innerHTML = `<td class="produto-nome col-produto"><strong>TOTAL GERAL</strong></td>`;

    repsOrder.forEach(rep => {
        const repKey = (rep || '').toString().toUpperCase();
        const saldoRep = totais[repKey].saldo;
        const saldoRepClass = saldoRep > 0 ? 'saldo-positivo' : 'negativo';
        const repCls = repClassName(repKey);
        trTotal.innerHTML += `
            <td class="cell-disp numeric-cell ${repCls}"><strong>${formatarNumero(totais[repKey].disp)}</strong></td>
            <td class="cell-venda numeric-cell ${totais[repKey].venda > 0 ? 'venda-positiva' : ''} ${repCls}"><strong>${formatarNumero(totais[repKey].venda)}</strong></td>
            <td class="cell-saldo numeric-cell ${saldoRepClass} ${repCls}"><strong>${formatarNumero(totais[repKey].saldo)}</strong></td>
        `;
    });

    const saldoGeralTotalClass = totais.GERAL.saldo > 0 ? 'saldo-positivo' : 'negativo';
    trTotal.innerHTML += `
        <td class="geral-disp numeric-cell"><strong>${formatarNumero(totais.GERAL.disp)}</strong></td>
        <td class="geral-venda numeric-cell"><strong>${formatarNumero(totais.GERAL.venda)}</strong></td>
        <td class="geral-saldo numeric-cell ${saldoGeralTotalClass}"><strong>${formatarNumero(totais.GERAL.saldo)}</strong></td>
    `;

    const tfoot = document.getElementById('rodapeTabela');
    if (tfoot) {
        tfoot.innerHTML = '';
        tfoot.appendChild(trTotal);
    } else {
        tbody.appendChild(trTotal);
    }
    // KPIs da aba estoque (agora renderizados no Dashboard)
    const dashContainer = document.getElementById('tab-dashboard');
    const kpiTotalVendidoEl = (dashContainer && dashContainer.querySelector)
        ? (dashContainer.querySelector('#kpiTotalVendido') || document.getElementById('kpiTotalVendido'))
        : document.getElementById('kpiTotalVendido');
    const kpiSaldoZeroEl = (dashContainer && dashContainer.querySelector)
        ? (dashContainer.querySelector('#kpiSaldoZero') || document.getElementById('kpiSaldoZero'))
        : document.getElementById('kpiSaldoZero');
    // Calcular total vendido com fallback: prefer registroVendas, se vazio usar produto.vendas agregado
    let totalUnidadesVendidas = 0;
    if (Array.isArray(estoque.registroVendas) && estoque.registroVendas.length > 0) {
        totalUnidadesVendidas = estoque.registroVendas.reduce((sum, v) => {
            if (Array.isArray(v.items)) return sum + v.items.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
            return sum + (Number(v.quantidade) || 0);
        }, 0);
    } else {
        totalUnidadesVendidas = (estoque.produtos || []).reduce((sumP, p) => {
            if (p.vendas && typeof p.vendas === 'object') return sumP + Object.values(p.vendas).reduce((s, vv) => s + (Number(vv) || 0), 0);
            return sumP;
        }, 0);
    }
    if (kpiTotalVendidoEl) kpiTotalVendidoEl.textContent = `${totalUnidadesVendidas.toLocaleString('pt-BR')} un.`;
    if (kpiSaldoZeroEl) kpiSaldoZeroEl.textContent = `${countConsolidadoZeradoOuNegativo.toLocaleString('pt-BR')} produtos`;

    // Ajustar posição sticky da segunda linha do header
    ajustarStickyHeader();
    try { renderizarCadastroProdutos(); } catch (e) {}
}

function renderizarCadastroProdutos() {
    const tbody = document.getElementById('corpoCadastroProdutos');
    const empty = document.getElementById('cadastroProdutosEmpty');
    const tabelaWrap = document.getElementById('cadastroProdutosTabelaWrap');
    if (!tbody || !empty || !tabelaWrap) return;

    const produtos = Array.isArray(estoque.produtos) ? [...estoque.produtos] : [];
    produtos.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    const total = produtos.length;
    let comCI = 0;

    tbody.innerHTML = '';

    produtos.forEach(produto => {
        const nome = produto.nome || '-';
        const regra = (precificacao && precificacao[nome]) ? precificacao[nome] : {};
        const ci = Number(regra.ci ?? produto.ci ?? 0) || 0;
        const margemMin = Number(regra.margemMinima ?? produto.margemMinima ?? 0) || 0;
        const descontoMax = Number(regra.descontoMaximo ?? produto.descontoMaximo ?? 0) || 0;
        const categoria = (categoriaPorProduto && categoriaPorProduto[nome]) || produto.categoria || '-';
        const ncm = produto.ncm || '-';
        const metricaImbel = obterMetricasImbelProduto(produto);
        const imbelTexto = metricaImbel.estoqueTotal === 0
            ? '-'
            : formatarNumero(metricaImbel.imbelDisp);
        // Mesmo valor do bloco CONSOLIDADO > SALDO da aba Estoque
        const saldoConsolidado = metricaImbel.consolidadoSaldo;
        const saldoConsolidadoTexto = formatarNumero(saldoConsolidado);
        const saldoConsolidadoCor = saldoConsolidado > 0 ? '#2da44e' : '#cf222e';
        const saldoConsolidadoClasse = saldoConsolidado < 0 ? 'negativo' : '';
        const atualizadoEm = produto.atualizadoEm || produto.dataAtualizacao || produto.criadoEm || '';
        const atualizadoTxt = atualizadoEm
            ? (typeof formatDateToDDMMYYYY === 'function'
                ? formatDateToDDMMYYYY(atualizadoEm)
                : new Date(atualizadoEm).toLocaleDateString('pt-BR'))
            : '-';

        if (ci > 0) comCI += 1;

        const noEstoque = produto.exibirNoEstoque === true;
        const noEstoqueBadge = noEstoque
            ? `<span style="display:inline-block;background:#dcfce7;color:#166534;border-radius:10px;padding:2px 10px;font-size:0.78rem;font-weight:700">Sim</span>`
            : `<span style="display:inline-block;background:#f1f5f9;color:#94a3b8;border-radius:10px;padding:2px 10px;font-size:0.78rem">Não</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:left; font-weight:600">${nome}</td>
            <td>
                <div style="display:flex;gap:6px;align-items:center">
                    <select onchange="salvarNCMProduto(${Number(produto.id)}, this.value)" style="width:240px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-family:monospace">
                        ${gerarOptionsNCM(ncm)}
                    </select>
                    <button class="btn btn-outline btn-sm" title="Detectar NCM" onclick="detectarNCMVincular(${Number(produto.id)})">🔍</button>
                </div>
            </td>
            <td>${categoria}</td>
            <td>${ci > 0 ? formatarMoedaValor(ci) : '-'}</td>
            <td>${margemMin > 0 ? margemMin.toFixed(1).replace('.', ',') : '-'}</td>
            <td>${descontoMax > 0 ? descontoMax.toFixed(1).replace('.', ',') : '-'}</td>
            <td>${imbelTexto}</td>
            <td class="${saldoConsolidadoClasse}" style="color:${saldoConsolidadoCor}; font-weight:700; font-family:monospace;">${saldoConsolidadoTexto}</td>
            <td>${atualizadoTxt}</td>
            <td style="text-align:center">${noEstoqueBadge}</td>
            <td>
                <button class="btn btn-outline btn-sm" data-admin="true" onclick="abrirModalEditarProduto(${Number(produto.id)})">Editar</button>
            </td>
        `;

        // Garantia defensiva: tbody deve ter o mesmo número de colunas do thead
        const expectedCols = document.querySelectorAll('#tabelaCadastroProdutos thead th').length;
        let actualCols = tr.querySelectorAll('td').length;
        if (actualCols !== expectedCols) {
            while (actualCols < expectedCols) {
                tr.appendChild(document.createElement('td'));
                actualCols += 1;
            }
            while (actualCols > expectedCols) {
                tr.removeChild(tr.lastElementChild);
                actualCols -= 1;
            }
        }

        tbody.appendChild(tr);
    });

    const semCI = Math.max(0, total - comCI);
    const totalEl = document.getElementById('cadProdTotal');
    const comCIEl = document.getElementById('cadProdComCI');
    const semCIEl = document.getElementById('cadProdSemCI');
    if (totalEl) totalEl.textContent = String(total);
    if (comCIEl) comCIEl.textContent = String(comCI);
    if (semCIEl) semCIEl.textContent = String(semCI);

    const vazio = total === 0;
    empty.style.display = vazio ? 'block' : 'none';
    tabelaWrap.style.display = vazio ? 'none' : 'block';
}

// Calcula e aplica o top correto para a segunda linha do thead (sub-headers)
function ajustarStickyHeader() {
    const tabela = document.getElementById('tabelaEstoque');
    if (!tabela) return;
    const firstRow = tabela.querySelector('thead tr:first-child');
    if (!firstRow) return;
    requestAnimationFrame(() => {
        const h = firstRow.getBoundingClientRect().height;
        const secondRowThs = tabela.querySelectorAll('thead tr:nth-child(2) th');
        secondRowThs.forEach(th => { th.style.top = h + 'px'; });
    });
}

// ========================================
// RENDERIZAÇÃO DO DASHBOARD
// ========================================

// ========================================
// RELATÓRIOS / IMPRESSÃO
// ========================================

function prepararRelatorioInventario() {
    // Only render if the relatorios tab is currently active
    const tabEl = document.getElementById('tab-relatorios');
    if (!tabEl || !tabEl.classList.contains('active')) return;
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) return;

    const tabela = document.getElementById('tabelaEstoque');
    if (!tabela) {
        preview.innerHTML = '<p>Tabela de estoque não encontrada.</p>';
        return;
    }
    // Atualizar selects de relatorio (caso a lista de produtos tenha mudado)
    atualizarSelectsRelatorios();

    const filtroRep = document.getElementById('filtroRelatoriosRep').value;
    const filtroProduto = document.getElementById('filtroRelatoriosProduto').value;

    // Clonar a tabela para preview/print, evitando ids duplicados
    const clone = tabela.cloneNode(true);
    clone.id = 'tabelaEstoqueRelatorio';

    // Remover possíveis estilos de posicionamento que atrapalham impressão
    clone.querySelectorAll('thead th').forEach(th => { th.style.position = 'static'; th.style.left = 'auto'; th.style.top = 'auto'; });
    clone.querySelectorAll('td').forEach(td => { td.style.position = 'static'; td.style.left = 'auto'; });

    // Filtrar por produto (se selecionado) e por representante (linha com valores)
    const corpo = clone.querySelector('tbody');
    if (corpo) {
        const rows = Array.from(corpo.querySelectorAll('tr'));
        rows.forEach(row => {
            const pid = row.dataset.id;
            // Se é a linha de totais sem dataset, manter
            if (!pid) return;

            // Filtrar por produto
            if (filtroProduto && filtroProduto !== '' && pid !== filtroProduto) {
                row.remove();
                return;
            }

            // Filtrar por representante: manter apenas se houver quantidade ou venda para esse rep
            if (filtroRep && filtroRep !== '') {
                const produto = estoque.produtos.find(p => String(p.id) === String(pid));
                if (produto) {
                    const disp = produto.distribuicao[filtroRep] || 0;
                    const venda = produto.vendas[filtroRep] || 0;
                    if ((disp + venda) === 0) {
                        row.remove();
                        return;
                    }
                }
            }
        });
    }

    // Se foi selecionado um representante, reconstruir o THEAD reduzido e remover colunas que não pertencem
    const selRep = filtroRep || '';
    if (selRep) {
        const repsCount = estoque.representantes.length;
        const repIndex = estoque.representantes.indexOf(selRep);
        // índices baseados na ordem dos tds no tbody: 0 = produto, then reps*3, then GERAL*3
        const produtoColIndex = 0;
        const repStart = 1 + (repIndex * 3);
        const repCols = [repStart, repStart + 1, repStart + 2];
        const geralStart = 1 + (repsCount * 3);
        const geralCols = [geralStart, geralStart + 1, geralStart + 2];

        // Reconstruir THEAD com apenas PRODUTOS | REP (colspan=3) | CONSOLIDADO (colspan=3)
        const newThead = document.createElement('thead');
        const first = document.createElement('tr');
        const thProdutos = document.createElement('th');
        thProdutos.className = 'col-produto';
        thProdutos.rowSpan = 2;
        thProdutos.textContent = 'PRODUTOS';
        first.appendChild(thProdutos);

        const thRep = document.createElement('th');
        thRep.className = 'header-rep ' + selRep.toLowerCase();
        thRep.colSpan = 3;
        thRep.textContent = selRep;
        first.appendChild(thRep);

        const thGeral = document.createElement('th');
        thGeral.className = 'header-geral';
        thGeral.colSpan = 3;
        thGeral.textContent = 'CONSOLIDADO';
        first.appendChild(thGeral);

        const second = document.createElement('tr');
        const subLabels = ['DIST', 'VENDA', 'SALDO', 'TOTAL', 'VENDA', 'SALDO'];
        const ariaMap = {
            'DIST': 'Quantidade distribuída para este representante',
            'ESTOQUE': 'Quantidade disponível no galpão IMBEL',
            'TOTAL': 'Estoque total cadastrado no sistema',
            'VENDA': 'Total vendido',
            'SALDO': 'Saldo disponível para venda'
        };
        subLabels.forEach(text => {
            const t = document.createElement('th');
            t.className = 'sub-header';
            t.textContent = text;
            const aria = ariaMap[text] || '';
            if (aria) {
                t.setAttribute('aria-label', aria);
                t.setAttribute('title', aria);
            }
            second.appendChild(t);
        });

        newThead.appendChild(first);
        newThead.appendChild(second);

        // Substituir thead do clone
        const oldThead = clone.querySelector('thead');
        if (oldThead) oldThead.remove();
        clone.insertBefore(newThead, clone.firstChild);

        // Agora remover das linhas do corpo as colunas que não estão em repCols ou geralCols
        if (corpo) {
            const rowsAll = Array.from(corpo.querySelectorAll('tr'));
            rowsAll.forEach(row => {
                const cells = Array.from(row.children);
                // construir lista de índices a manter
                const keep = new Set([produtoColIndex, ...repCols, ...geralCols]);
                // iterar de trás para frente ao remover
                for (let i = cells.length - 1; i >= 0; i--) {
                    if (!keep.has(i)) {
                        cells[i].remove();
                    }
                }
            });
        }
    }

    preview.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'report-printable';
    wrapper.appendChild(clone);
    preview.appendChild(wrapper);
}

function imprimirInventario() {
    prepararRelatorioInventario();
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) return;
    const content = preview.innerHTML;
    const filtroRep = document.getElementById('filtroRelatoriosRep') ? document.getElementById('filtroRelatoriosRep').value : '';
    const filtroProduto = document.getElementById('filtroRelatoriosProduto') ? document.getElementById('filtroRelatoriosProduto').value : '';
    const orient = document.getElementById('filtroRelatoriosOrientacao') ? document.getElementById('filtroRelatoriosOrientacao').value : 'landscape';

    // Montar cabeçalho resumido para o relatório
    const produtoNome = filtroProduto ? (estoque.produtos.find(p => String(p.id) === String(filtroProduto)) || {}).nome : '';
    const dataAgora = new Date().toLocaleString('pt-BR');
    const headerHTML = `<div style="margin-bottom:8px;font-size:13px;color:#222"><strong>Representante:</strong> ${filtroRep || 'Todos'} &nbsp;|&nbsp; <strong>Produto:</strong> ${produtoNome || 'Todos'} &nbsp;|&nbsp; <strong>Data:</strong> ${dataAgora}</div>`;
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) {
        alert('Não foi possível abrir a janela de impressão. Permita popups ou use a impressão do navegador.');
        return;
    }

    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>Relatório - Inventário</title>
            <link rel="stylesheet" href="styles.css">
            <style>
                @page { size: A4 ${orient}; margin: 10mm; }
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 12px; color: #222; }
                h1 { margin-bottom: 12px; font-size: 18px; }
                .report-printable table { width: 100%; border-collapse: collapse; font-size: 12px; }
                .report-printable th, .report-printable td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
                thead { background: #1e3a5f; color: white; }
                th.col-produto, td.produto-nome { position: static !important; left: auto !important; }
                @media print { body { margin: 0; } }
            </style>
        </head>
        <body>
            <h1>Inventário de Produtos</h1>
            ${headerHTML}
            ${content}
            <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

function aprovarProposta(id) {
    const p = (propostas || []).find(x => x.id === id);
    if (!p) return;
    p.aguardandoAprovacao = false;
    try {
        p.aprovadoPor = (typeof auth !== 'undefined' && auth.currentUser && auth.currentUser.email) ? auth.currentUser.email : 'Admin';
    } catch (e) { p.aprovadoPor = 'Admin'; }
    p.dataAprovacao = new Date().toISOString();
    p.status = 'rascunho';
    salvarDados();
    try { renderizarPropostas(); } catch (e) {}
    mostrarNotificacao(`✅ Proposta ${p.numero} aprovada.`, 'success');
}

function recusarAprovacaoProposta(id) {
    const p = (propostas || []).find(x => x.id === id);
    if (!p) return;
    const motivo = prompt('Motivo da recusa:') || 'Sem motivo';
    p.aguardandoAprovacao = false;
    p.status = 'rascunho';
    p.observacoes = (p.observacoes || '') + `\n[RECUSADO: ${motivo} — ${new Date().toLocaleDateString('pt-BR')}]`;
    salvarDados();
    try { renderizarPropostas(); } catch (e) {}
    mostrarNotificacao('Desconto recusado. Proposta voltou para rascunho.', 'warning');
}
 

// ==============================
// RELATÓRIO DE RENTABILIDADE
// ==============================
function gerarRelatorioRentabilidade() {
    // Only render if the relatorios tab is currently active
    const tabEl = document.getElementById('tab-relatorios');
    if (!tabEl || !tabEl.classList.contains('active')) return;
    try {
        const periodo = document.getElementById('filtroRentabilidadePeriodo')?.value || 'todos';
        const hoje = new Date();
        const vendas = Array.isArray(estoque.registroVendas) ? estoque.registroVendas : (estoque.registroVendas || []);

        const vendasFiltradas = (vendas || []).filter(v => {
            // considerar apenas vendas efetivadas (não canceladas)
            if (!v || v.cancelado) return false;
            if (!v.data) return periodo === 'todos';
            const dataVenda = new Date(v.data);
            if (isNaN(dataVenda)) return periodo === 'todos';
            if (periodo === 'todos') return true;
            if (periodo === 'mes') return dataVenda.getMonth() === hoje.getMonth() && dataVenda.getFullYear() === hoje.getFullYear();
            if (periodo === 'trimestre') {
                const trimAtual = Math.floor(hoje.getMonth() / 3);
                return Math.floor(dataVenda.getMonth() / 3) === trimAtual && dataVenda.getFullYear() === hoje.getFullYear();
            }
            if (periodo === 'ano') return dataVenda.getFullYear() === hoje.getFullYear();
            return true;
        });

        // 2. Agregar por produto
        const porProduto = {};
        vendasFiltradas.forEach(venda => {
            const itens = Array.isArray(venda.items) && venda.items.length ? venda.items : (venda.itemsLegacy ? venda.itemsLegacy : []);
            if (!Array.isArray(itens) || itens.length === 0) {
                // Suporta formato legado com campos diretos
                const nome = venda.produtoNome || venda.produto || '';
                const qtd = Number(venda.quantidade) || 0;
                const valorUnit = Number(venda.valorUnitario || venda.valorUnit || (venda.valorTotal && qtd ? (venda.valorTotal / qtd) : 0)) || 0;
                if (!porProduto[nome]) porProduto[nome] = { qtd: 0, receita: 0 };
                porProduto[nome].qtd += qtd;
                porProduto[nome].receita += qtd * valorUnit;
                return;
            }
            itens.forEach(item => {
                let nome = item.produtoNome || item.produto || '';
                if (!nome && item.produtoId) {
                    const p = (estoque.produtos || []).find(pp => String(pp.id) === String(item.produtoId));
                    nome = p ? p.nome : String(item.produtoId);
                }
                const qtd = Number(item.quantidade) || 0;
                const valorUnit = Number(item.valorUnitario || item.valorUnit || (item.valorTotal && qtd ? (item.valorTotal / qtd) : 0)) || 0;
                if (!porProduto[nome]) porProduto[nome] = { qtd: 0, receita: 0 };
                porProduto[nome].qtd += qtd;
                porProduto[nome].receita += qtd * valorUnit;
            });
        });

        // 3. Enriquecer com custo da `precificacao`
        let totalReceita = 0, totalCusto = 0;
        const rows = Object.entries(porProduto).map(([nome, dados]) => {
            const prec = (typeof precificacao === 'object' && precificacao) ? (precificacao[nome] || {}) : {};
            const custoUnit = Number(prec.custoTotal || prec.custo_unitario || prec.custo || 0) || 0;
            const custoTotalProd = custoUnit * dados.qtd;
            const lucro = dados.receita - custoTotalProd;
            const margem = dados.receita > 0 ? (lucro / dados.receita) * 100 : 0;
            totalReceita += dados.receita;
            totalCusto += custoTotalProd;
            return { nome, qtd: dados.qtd, receita: dados.receita, custoUnit, custoTotal: custoTotalProd, lucro, margem };
        }).sort((a, b) => b.lucro - a.lucro);

        // 4. Montar linhas da tabela por produto
        const corMargem = m => m >= 20 ? '#16a34a' : m >= 10 ? '#d97706' : '#dc2626';
        const emojiRank = i => ['🥇','🥈','🥉'][i] || (i + 1);
        const tbodyProd = document.getElementById('tabelaRentabilidadeBody');
        if (tbodyProd) {
            tbodyProd.innerHTML = rows.map((r, i) => `
                <tr>
                  <td style="text-align:left; padding-left:15px; font-weight:500">${r.nome}</td>
                  <td>${r.qtd}</td>
                  <td style="color:#16a34a; font-weight:600">R$ ${r.receita.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                  <td>${r.custoUnit > 0 ? 'R$ ' + r.custoUnit.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '<span style="color:#94a3b8">Sem custo</span>'}</td>
                  <td>${r.custoTotal > 0 ? 'R$ ' + r.custoTotal.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'}</td>
                  <td style="font-weight:600; color:${r.lucro >= 0 ? '#16a34a' : '#dc2626'}">R$ ${r.lucro.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                  <td style="font-weight:700; color:${corMargem(r.margem)}">${r.margem.toFixed(1)}%</td>
                  <td style="text-align:center; font-size:1.1rem">${emojiRank(i)}</td>
                </tr>
            `).join('');
        }

        // 5. Agregar por representante
        const porRep = {};
        (vendasFiltradas || []).forEach(v => {
            const rep = (v.representante || 'IMBEL').toString().toUpperCase();
            if (!porRep[rep]) porRep[rep] = { qtd: 0, receita: 0, custo: 0 };
            const itens = Array.isArray(v.items) && v.items.length ? v.items : (v.itemsLegacy ? v.itemsLegacy : []);
            if (!Array.isArray(itens) || itens.length === 0) {
                const nome = v.produtoNome || v.produto || '';
                const qtd = Number(v.quantidade) || 0;
                const valorUnit = Number(v.valorUnitario || v.valorUnit || (v.valorTotal && qtd ? (v.valorTotal / qtd) : 0)) || 0;
                const prec = (precificacao && precificacao[nome]) ? precificacao[nome] : {};
                porRep[rep].qtd += qtd;
                porRep[rep].receita += qtd * valorUnit;
                porRep[rep].custo += (Number(prec.custoTotal) || 0) * qtd;
            } else {
                itens.forEach(item => {
                    let nome = item.produtoNome || item.produto || '';
                    if (!nome && item.produtoId) {
                        const p = (estoque.produtos || []).find(pp => String(pp.id) === String(item.produtoId));
                        nome = p ? p.nome : String(item.produtoId);
                    }
                    const qtd = Number(item.quantidade) || 0;
                    const valorUnit = Number(item.valorUnitario || item.valorUnit || (item.valorTotal && qtd ? (item.valorTotal / qtd) : 0)) || 0;
                    const prec = (precificacao && precificacao[nome]) ? precificacao[nome] : {};
                    porRep[rep].qtd += qtd;
                    porRep[rep].receita += qtd * valorUnit;
                    porRep[rep].custo += (Number(prec.custoTotal) || 0) * qtd;
                });
            }
        });

        const repColors = { KOLTE:'#3d5a80', ISA:'#5c4d7d', LC:'#2d6a4f', ADES:'#9c4a1a', FL:'#7b2d26', IMBEL:'#1e3a5f' };
        const tbodyRep = document.getElementById('tabelaRentabilidadeRepBody');
        if (tbodyRep) {
            tbodyRep.innerHTML = Object.entries(porRep).map(([rep, d]) => {
                const lucro = d.receita - d.custo;
                const margem = d.receita > 0 ? (lucro / d.receita) * 100 : 0;
                const cor = repColors[rep] || '#1e3a5f';
                return `
                    <tr>
                      <td><span class="badge-rep" style="background:${cor}20; color:${cor}; font-weight:700; padding:3px 10px; border-radius:20px">${rep}</span></td>
                      <td>${d.qtd}</td>
                      <td style="color:#16a34a; font-weight:600">R$ ${d.receita.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                      <td>${d.custo > 0 ? 'R$ ' + d.custo.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'}</td>
                      <td style="font-weight:600; color:${lucro>=0?'#16a34a':'#dc2626'}">R$ ${lucro.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                      <td style="font-weight:700; color:${corMargem(margem)}">${margem.toFixed(1)}%</td>
                    </tr>
                `;
            }).join('');
        }

        // 6. Atualizar KPIs
        const lucroTotal = totalReceita - totalCusto;
        const margemTotal = totalReceita > 0 ? (lucroTotal / totalReceita) * 100 : 0;
        const fmt = v => 'R$ ' + v.toLocaleString('pt-BR',{minimumFractionDigits:2});
        if (document.getElementById('rentFaturamento')) document.getElementById('rentFaturamento').textContent = fmt(totalReceita);
        if (document.getElementById('rentCusto')) document.getElementById('rentCusto').textContent = fmt(totalCusto);
        if (document.getElementById('rentLucro')) { document.getElementById('rentLucro').textContent = fmt(lucroTotal); document.getElementById('rentLucro').style.color = lucroTotal >= 0 ? '#16a34a' : '#dc2626'; }
        if (document.getElementById('rentMargem')) document.getElementById('rentMargem').textContent = margemTotal.toFixed(1) + '%';
    } catch (e) {
        console.error('Erro gerando relatório de rentabilidade:', e);
    }
}

function exportarRentabilidadeExcel() {
    try {
        const rows = [];
        const body = document.getElementById('tabelaRentabilidadeBody');
        if (body) {
            Array.from(body.querySelectorAll('tr')).forEach(tr => {
                const cols = Array.from(tr.children).map(td => td.textContent.trim().replace(/\s+/g, ' '));
                rows.push(cols.join(';'));
            });
        }
        let csv = 'Produto;Qtd Vendida;Receita Total;Custo Unit.;Custo Total;Lucro Bruto;Margem %;Ranking\n';
        csv += rows.join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rentabilidade_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Erro exportando rentabilidade:', e);
        mostrarNotificacao('Erro ao exportar relatório.', 'error');
    }
}

function imprimirRentabilidade() {
    try {
        gerarRelatorioRentabilidade();
        const prodHtml = document.getElementById('tabelaRentabilidade') ? document.getElementById('tabelaRentabilidade').outerHTML : '';
        const repHtml = document.getElementById('tabelaRentabilidadeRep') ? document.getElementById('tabelaRentabilidadeRep').outerHTML : '';
        const dataAgora = new Date().toLocaleString('pt-BR');
        const win = window.open('', '_blank', 'width=1000,height=800');
        if (!win) { alert('Permita popups para imprimir.'); return; }
        win.document.write(`
            <!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de Rentabilidade</title>
            <link rel="stylesheet" href="styles.css"><style>body{font-family:Arial,Helvetica,sans-serif;padding:12px;color:#222}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px}</style></head><body>
            <h1>Relatório de Rentabilidade</h1>
            <div style="margin-bottom:8px;font-size:13px;color:#222"><strong>Gerado em:</strong> ${dataAgora}</div>
            ${prodHtml}
            <div style="height:18px"></div>
            ${repHtml}
            <script>window.onload=function(){setTimeout(()=>window.print(),200);};</script>
            </body></html>
        `);
        win.document.close();
    } catch (e) {
        console.error('Erro imprimindo rentabilidade:', e);
    }
}

function gerarPdfProposta(propostaId, tipo = 'simples') {
    try {
        const proposta = (propostas || []).find(p => String(p.id) === String(propostaId));
        if (!proposta) { mostrarNotificacao('Proposta não encontrada.', 'error'); return; }

        if (!window.jspdf || !window.jspdf.jsPDF) {
            mostrarNotificacao('jsPDF não está disponível.', 'error');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        // HEADER
        doc.setFillColor(30, 58, 95);
        doc.rect(0, 0, 210, 35, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(255, 255, 255);
        doc.text('FÁBRICA DE ITAJUBÁ', 15, 15);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('Controle de Estoque — Material Bélico', 15, 22);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(201, 162, 39);
        doc.text('PROPOSTA ' + (proposta.numero || ''), 195, 15, { align: 'right' });
        doc.setFontSize(9);
        doc.setTextColor(200, 200, 200);
        doc.text('Data: ' + (proposta.data ? new Date(proposta.data).toLocaleDateString('pt-BR') : ''), 195, 22, { align: 'right' });
        doc.text('Validade: ' + (proposta.dataExpiracao ? new Date(proposta.dataExpiracao).toLocaleDateString('pt-BR') : ''), 195, 28, { align: 'right' });

        // CLIENT INFO
        let y = 45;
        doc.setFillColor(248, 250, 252);
        doc.rect(10, y - 5, 190, 28, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.rect(10, y - 5, 190, 28, 'S');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('CLIENTE', 15, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(30, 41, 59);
        doc.text(proposta.cliente || '-', 15, y + 7);

        const clienteObj = (clientes || []).find(c => (c.nome || '').toLowerCase() === (proposta.cliente || '').toLowerCase());
        if (clienteObj) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(71, 85, 105);
            if (clienteObj.cnpj) doc.text('CNPJ: ' + clienteObj.cnpj, 15, y + 13);
            if (clienteObj.contato) doc.text('Contato: ' + clienteObj.contato, 100, y + 13);
            if (clienteObj.telefone) doc.text('Tel: ' + clienteObj.telefone, 15, y + 19);
            if (clienteObj.email) doc.text('E-mail: ' + clienteObj.email, 100, y + 19);
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('REPRESENTANTE', 160, y);
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text(proposta.representante || '-', 160, y + 7);

        // ITENS
        y += 35;
        let finalY = y;
        const cliente = clienteObj;

        if (tipo === 'fiscal') {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(30, 58, 95);
            doc.text('ITENS E COMPOSIÇÃO DE PREÇO', 15, y);
            y += 6;

            const precifRef = (precificacoesCliente || [])
                .filter(pc => String(pc.clienteId) === String(cliente?.id))
                .sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao))[0];

            (proposta.itens || []).forEach((item, idx) => {
                const itemPrecif = precifRef?.itens?.find(i => i.produto === item.produto);
                const fmt = v => 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const pct = v => parseFloat(v || 0).toFixed(2) + '%';
                const qtd = Number(item.quantidade || 0);
                const valorUnit = Number(item.valorUnitario || item.valor || item.valorUnit || 0);

                if (y > 260 && idx < (proposta.itens || []).length - 1) {
                    doc.addPage();
                    y = 20;
                }

                doc.setFillColor(30, 58, 95);
                doc.rect(10, y, 190, 7, 'F');
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(9);
                doc.setTextColor(255, 255, 255);
                doc.text(`${idx + 1}. ${item.produto || item.produtoNome || ''}`, 14, y + 5);
                doc.text(`Qtd: ${qtd}`, 160, y + 5);
                y += 10;

                if (itemPrecif) {
                    doc.autoTable({
                        startY: y,
                        body: [
                            ['Custo de Industrialização (CI)', '—', fmt(itemPrecif.ci)],
                            ['Taxa Diretoria', pct(itemPrecif.taxa), '×' + (1 + itemPrecif.taxa / 100).toFixed(4)],
                            ['ROI', pct(itemPrecif.roi), '×' + (1 + itemPrecif.roi / 100).toFixed(4)],
                            ['Valor Base', '—', fmt(itemPrecif.valorBase)],
                            ['ICMS', pct(itemPrecif.icms), fmt(itemPrecif.icmsR)],
                            ['PIS', pct(itemPrecif.pis), fmt(itemPrecif.pisR)],
                            ['COFINS', pct(itemPrecif.cofins), fmt(itemPrecif.cofinsR)],
                            ['c/ ICMS + PIS + COFINS', '—', fmt(itemPrecif.valorImpostos)],
                            ['IPI', pct(itemPrecif.ipi), fmt(itemPrecif.ipiR)],
                            ['Valor Total s/ Comissão', '—', fmt(itemPrecif.valorTotal)],
                            ['Comissão (s/ Valor Base)', pct(itemPrecif.comissao), fmt(itemPrecif.comissaoR)],
                            ['PREÇO UNITÁRIO FINAL', '—', fmt(valorUnit)]
                        ],
                        styles: { fontSize: 8, cellPadding: 2.5 },
                        columnStyles: {
                            0: { cellWidth: 110, textColor: [71, 85, 105] },
                            1: { cellWidth: 25, halign: 'center', textColor: [100, 116, 139] },
                            2: { cellWidth: 45, halign: 'right', fontStyle: 'bold', textColor: [30, 41, 59] }
                        },
                        didParseCell(data) {
                            if (data.row.index === 11) {
                                data.cell.styles.fillColor = [30, 58, 95];
                                data.cell.styles.textColor = [201, 162, 39];
                                data.cell.styles.fontStyle = 'bold';
                            }
                            if ([3, 7, 9].includes(data.row.index)) {
                                data.cell.styles.fillColor = [240, 244, 248];
                                data.cell.styles.fontStyle = 'bold';
                            }
                        },
                        margin: { left: 10, right: 10 }
                    });
                    y = doc.lastAutoTable.finalY + 3;
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(8);
                    doc.setTextColor(22, 163, 74);
                    doc.text(`Total: ${qtd} × ${fmt(valorUnit)} = ` + fmt(qtd * valorUnit), 195, y, { align: 'right' });
                    y += 8;
                } else {
                    doc.autoTable({
                        startY: y,
                        body: [
                            ['Produto', item.produto || item.produtoNome || ''],
                            ['Qtd', qtd],
                            ['Valor Unitário', fmt(valorUnit)],
                            ['Total', fmt(qtd * valorUnit)]
                        ],
                        styles: { fontSize: 8 },
                        margin: { left: 10, right: 10 }
                    });
                    y = doc.lastAutoTable.finalY + 4;
                }
            });
            finalY = y + 2;
        } else {
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(30, 58, 95);
            doc.text('ITENS DA PROPOSTA', 15, y);
            y += 5;

            const tableData = (proposta.itens || []).map((item, idx) => {
                const nome = item.produtoNome || item.produto || '';
                const quantidade = Number(item.quantidade || 0);
                const valorUnit = Number(item.valorUnitario || item.valor || item.valorUnit || 0);
                const total = quantidade * valorUnit;
                return [
                    idx + 1,
                    nome,
                    quantidade,
                    'R$ ' + valorUnit.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
                    'R$ ' + total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
                ];
            });

            doc.autoTable({
                startY: y,
                head: [['#', 'Produto', 'Qtd', 'Valor Unit.', 'Total']],
                body: tableData,
                styles: { fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: 'bold' },
                columnStyles: { 0: { cellWidth: 12, halign: 'center' }, 1: { cellWidth: 90 }, 2: { cellWidth: 20, halign: 'center' }, 3: { cellWidth: 35, halign: 'right' }, 4: { cellWidth: 35, halign: 'right' } },
                alternateRowStyles: { fillColor: [248, 250, 252] },
                margin: { left: 10, right: 10 }
            });

            finalY = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 8 : y + 60;
        }

        doc.setFillColor(30, 58, 95);
        doc.rect(130, finalY, 70, 14, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(201, 162, 39);
        doc.text('VALOR TOTAL', 135, finalY + 5);
        doc.setFontSize(12);
        doc.setTextColor(255, 255, 255);
        doc.text('R$ ' + Number(proposta.valorTotal || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }), 195, finalY + 10, { align: 'right' });

        // OBS
        if (proposta.observacoes) {
            const obsY = finalY + 22;
            doc.setFillColor(255, 251, 240);
            doc.setDrawColor(201, 162, 39);
            doc.rect(10, obsY - 4, 190, 20, 'FD');
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text('CONDIÇÕES COMERCIAIS', 15, obsY + 1);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.setTextColor(30, 41, 59);
            const lines = doc.splitTextToSize(proposta.observacoes, 180);
            doc.text(lines, 15, obsY + 7);
        }

        // FOOTER
        const pageHeight = doc.internal.pageSize.height;
        doc.setFillColor(30, 58, 95);
        doc.rect(0, pageHeight - 15, 210, 15, 'F');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(200, 200, 200);
        doc.text('Fábrica de Itajubá — Gestão de Material Bélico', 15, pageHeight - 6);
        doc.text('Proposta válida até ' + (proposta.dataExpiracao ? new Date(proposta.dataExpiracao).toLocaleDateString('pt-BR') : ''), 195, pageHeight - 6, { align: 'right' });

        const safeName = (proposta.cliente || 'cliente').replace(/[^a-z0-9]/gi, '_');
        const sufixo = tipo === 'fiscal' ? '_fiscal' : '';
        doc.save('Proposta_' + (proposta.numero || '') + '_' + safeName + sufixo + '.pdf');

    } catch (err) {
        console.error('Erro gerarPdfProposta:', err);
        mostrarNotificacao('Erro ao gerar PDF da proposta.', 'error');
    }
}

// Imprimir exatamente o preview atual em `#relatoriosPreview`
function imprimirRelatorioPreview() {
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) { mostrarNotificacao('Preview de relatórios não encontrado.', 'error'); return; }
    // Se não há conteúdo, tentar visualizar antes de imprimir
    if (!preview.innerHTML || preview.innerHTML.trim() === '') {
        // Tenta re-gerar o preview atual com a função existente
        try { visualizarRelatorioSelecionado(); } catch (e) {}
        if (!preview.innerHTML || preview.innerHTML.trim() === '') {
            mostrarNotificacao('Nenhum relatório visualizado para imprimir.', 'warning');
            return;
        }
    }

    const content = preview.innerHTML;
    const tipo = document.getElementById('filtroRelatoriosTipo')?.value || '';
    const orient = document.getElementById('filtroRelatoriosOrientacao')?.value || 'landscape';
    const titulo = tipo === 'comissoes' ? 'Relatório - Comissões' : tipo === 'distribuicao' ? 'Relatório - Distribuição' : 'Relatório - Inventário';
    const dataAgora = new Date().toLocaleString('pt-BR');

    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) { alert('Não foi possível abrir a janela de impressão. Permita popups.'); return; }

    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>${titulo}</title>
            <link rel="stylesheet" href="styles.css">
            <style>
                @page { size: A4 ${orient}; margin: 10mm; }
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding:12px; color:#222 }
                h1 { margin-bottom:8px }
                .report-printable table { width:100%; border-collapse:collapse }
                .report-printable th, .report-printable td { border:1px solid #ddd; padding:6px 8px }
            </style>
        </head>
        <body>
            <h1>${titulo}</h1>
            <div style="margin-bottom:8px;font-size:13px;color:#222"><strong>Data:</strong> ${dataAgora}</div>
            <div class="report-printable">${content}</div>
            <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

// Imprimir diretamente o relatório selecionado no filtro (sem depender do preview)
function imprimirRelatorioSelecionado() {
    // Garantir que o preview esteja atualizado e então imprimir o conteúdo do preview
    try {
        visualizarRelatorioSelecionado();
    } catch (e) {
        // fallback: tentar preparar manualmente por tipo
        const tipo = document.getElementById('filtroRelatoriosTipo') ? document.getElementById('filtroRelatoriosTipo').value : 'inventario';
        if (tipo === 'comissoes') prepararRelatorioComissoes();
        else if (tipo === 'distribuicao') prepararRelatorioDistribuicao && prepararRelatorioDistribuicao();
        else prepararRelatorioInventario();
    }

    // Pequeno delay para garantir que o DOM do preview foi atualizado
    setTimeout(function(){ imprimirRelatorioPreview(); }, 80);
}

// =============================
// RELATÓRIO: COMISSÕES (5%)
// =============================

function obterComissoesConsolidadas({ filtroRep = '', dataInicio = '', dataFim = '' } = {}) {
    const vendas = (Array.isArray(estoque.registroVendas) ? [...estoque.registroVendas] : []).filter(v => !v.cancelado);
    const vendasSemImbel = vendas.filter(v => ((v.representante || '').toString().trim().toUpperCase() !== 'IMBEL'));

    const vendasFiltradas = vendasSemImbel.filter(v => {
        if (filtroRep && (v.representante || '') !== filtroRep) return false;
        if ((!dataInicio || dataInicio === '') && (!dataFim || dataFim === '')) return true;
        const d = parseDateToYYYYMMDD(v.data);
        if (!d) return false;
        if (dataInicio && d < dataInicio) return false;
        if (dataFim && d > dataFim) return false;
        return true;
    });

    const obterValorVenda = (venda) => {
        if (typeof venda.valorTotal === 'number') return venda.valorTotal;
        if (Array.isArray(venda.items) && venda.items.length > 0) {
            return venda.items.reduce((s, it) => s + (Number(it.valorTotal) || ((Number(it.valorUnitario) || 0) * (Number(it.quantidade) || 0))), 0);
        }
        return ((Number(venda.valorUnitario) || 0) * (Number(venda.quantidade) || 0));
    };

    const ordenarContrato = (a, b) => {
        const na = parseInt(a);
        const nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
    };

    const contratosMap = new Map();
    vendasFiltradas.forEach(v => {
        const contratoKey = normalizarContratoKey(v.contrato);
        if (!contratoKey) return;
        const dataNorm = parseDateToYYYYMMDD(v.data);
        const atual = contratosMap.get(contratoKey) || {
            contrato: contratoKey,
            loja: v.loja || '',
            representantes: new Set(),
            valorContrato: 0,
            dataMin: null,
            dataMax: null
        };
        atual.valorContrato += obterValorVenda(v);
        if (!atual.loja && v.loja) atual.loja = v.loja;
        if (v.representante) atual.representantes.add(v.representante);
        if (dataNorm) {
            if (!atual.dataMin || dataNorm < atual.dataMin) atual.dataMin = dataNorm;
            if (!atual.dataMax || dataNorm > atual.dataMax) atual.dataMax = dataNorm;
        }
        contratosMap.set(contratoKey, atual);
    });

    const contratos = Array.from(contratosMap.values()).sort((a, b) => ordenarContrato(a.contrato, b.contrato));
    let totalComissoes = 0;
    contratos.forEach(c => {
        c.comissao = Math.round((c.valorContrato * 0.05) * 100) / 100;
        totalComissoes += c.comissao;
    });

    return { contratos, totalComissoes };
}

function prepararRelatorioComissoes() {
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) return;

    const filtroRep = document.getElementById('filtroRelatoriosRep') ? document.getElementById('filtroRelatoriosRep').value : '';
    const dataInicio = document.getElementById('filtroRelatoriosDataInicio') ? document.getElementById('filtroRelatoriosDataInicio').value : '';
    const dataFim = document.getElementById('filtroRelatoriosDataFim') ? document.getElementById('filtroRelatoriosDataFim').value : '';

    // Agrupar vendas por representante (ignorar vendas da IMBEL — sem comissão)
    const vendas = (Array.isArray(estoque.registroVendas) ? [...estoque.registroVendas] : []).filter(v => !v.cancelado);
    const vendasSemImbel = vendas.filter(v => ((v.representante || '').toString().trim().toUpperCase() !== 'IMBEL'));
    
    // Filtrar por intervalo de datas se fornecido (comparação por DATA apenas, formato YYYY-MM-DD)
    const vendasFiltradas = vendasSemImbel.filter(v => {
        if ((!dataInicio || dataInicio === '') && (!dataFim || dataFim === '')) return true;
        if (!v.data) return false;
        // Normalizar data do registro para YYYY-MM-DD
        const registroDateStr = parseDateToYYYYMMDD(v.data);
        if (!registroDateStr) return false;
        if (dataInicio && dataInicio !== '' && registroDateStr < dataInicio) return false;
        if (dataFim && dataFim !== '' && registroDateStr > dataFim) return false;
        return true;
    });

    // (debug panels removed)

    // Ordenar por contrato
    vendasFiltradas.sort((a, b) => (parseInt(a.contrato) || 0) - (parseInt(b.contrato) || 0));

    let totalComissoes = 0;

    const container = document.createElement('div');
    container.className = 'report-comissoes';
    // Card resumo
    const resumo = document.createElement('div');
    resumo.className = 'comissoes-resumo';
    resumo.style.marginBottom = '12px';
    resumo.innerHTML = `<strong>Total Comissões:</strong> <span id="totalComissoesCard">R$ 0,00</span>`;
    container.appendChild(resumo);

    const obterValorVenda = (venda) => {
        if (typeof venda.valorTotal === 'number') return venda.valorTotal;
        if (Array.isArray(venda.items) && venda.items.length > 0) {
            return venda.items.reduce((s, it) => s + (Number(it.valorTotal) || ((Number(it.valorUnitario) || 0) * (Number(it.quantidade) || 0))), 0);
        }
        return ((Number(venda.valorUnitario) || 0) * (Number(venda.quantidade) || 0));
    };

    const normalizarContrato = (valor) => {
        const bruto = (valor ?? '').toString().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
        const digitos = bruto.replace(/\D+/g, '');
        return digitos ? String(parseInt(digitos, 10)) : bruto.toUpperCase();
    };

    const ordenarContrato = (a, b) => {
        const na = parseInt(a);
        const nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
    };

    const vendasConsideradas = filtroRep
        ? vendasFiltradas.filter(v => (v.representante || '') === filtroRep)
        : vendasFiltradas;

    const contratosMap = new Map();
    vendasConsideradas.forEach(v => {
        const contratoKey = normalizarContrato(v.contrato);
        if (!contratoKey) return;
        const dataNorm = parseDateToYYYYMMDD(v.data);
        const atual = contratosMap.get(contratoKey) || {
            contrato: contratoKey,
            loja: v.loja || '',
            representantes: new Set(),
            valorContrato: 0,
            dataMin: null,
            dataMax: null
        };
        atual.valorContrato += obterValorVenda(v);
        if (!atual.loja && v.loja) atual.loja = v.loja;
        if (v.representante) atual.representantes.add(v.representante);
        if (dataNorm) {
            if (!atual.dataMin || dataNorm < atual.dataMin) atual.dataMin = dataNorm;
            if (!atual.dataMax || dataNorm > atual.dataMax) atual.dataMax = dataNorm;
        }
        contratosMap.set(contratoKey, atual);
    });

    const contratos = Array.from(contratosMap.values()).sort((a, b) => ordenarContrato(a.contrato, b.contrato));

    const table = document.createElement('table');
    table.className = 'tabela-relatorio comissoes-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.innerHTML = `
        <thead>
            <tr>
                <th style="text-align:left;padding:6px;border:1px solid #ddd">Contrato</th>
                <th style="text-align:left;padding:6px;border:1px solid #ddd">Cliente / Loja</th>
                <th style="text-align:left;padding:6px;border:1px solid #ddd">Representante(s)</th>
                <th style="text-align:left;padding:6px;border:1px solid #ddd">Data</th>
                <th style="text-align:right;padding:6px;border:1px solid #ddd">Valor Contrato (R$)</th>
                <th style="text-align:right;padding:6px;border:1px solid #ddd">Comissão 5% (R$)</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    contratos.forEach(c => {
        const valor = c.valorContrato || 0;
        const comissao = Math.round((valor * 0.05) * 100) / 100;
        totalComissoes += comissao;
        const repsTexto = Array.from(c.representantes || []).join(', ');
        const dataTexto = c.dataMin
            ? (c.dataMax && c.dataMax !== c.dataMin
                ? `${new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR')} até ${new Date(c.dataMax + 'T00:00:00').toLocaleDateString('pt-BR')}`
                : new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR'))
            : '-';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:6px;border:1px solid #ddd">${c.contrato || ''}</td>
            <td style="padding:6px;border:1px solid #ddd">${c.loja || ''}</td>
            <td style="padding:6px;border:1px solid #ddd">${repsTexto || '-'}</td>
            <td style="padding:6px;border:1px solid #ddd">${dataTexto}</td>
            <td style="padding:6px;border:1px solid #ddd;text-align:right">${formatarMoedaValor(valor)}</td>
            <td style="padding:6px;border:1px solid #ddd;text-align:right">${formatarMoedaValor(comissao)}</td>
        `;
        tbody.appendChild(tr);
    });

    const trTotal = document.createElement('tr');
    trTotal.innerHTML = `
        <td colspan="5" style="padding:6px;border:1px solid #ddd;text-align:right"><strong>Total Geral de Comissões</strong></td>
        <td style="padding:6px;border:1px solid #ddd;text-align:right"><strong>${formatarMoedaValor(totalComissoes)}</strong></td>
    `;
    tbody.appendChild(trTotal);

    container.appendChild(table);

    // Atualizar card total
    const totalEl = container.querySelector('#totalComissoesCard');
    if (totalEl) totalEl.textContent = formatarMoedaValor(totalComissoes);

    // Renderizar no preview (substitui o conteúdo atual de relatoriosPreview)
    preview.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'report-printable';
    wrapper.appendChild(container);
    preview.appendChild(wrapper);
}

function imprimirComissoes() {
    prepararRelatorioComissoes();
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) return;
    const content = preview.innerHTML;
    const filtroRep = document.getElementById('filtroRelatoriosRep') ? document.getElementById('filtroRelatoriosRep').value : 'Todos';
    const dataInicio = document.getElementById('filtroRelatoriosDataInicio') ? document.getElementById('filtroRelatoriosDataInicio').value : '';
    const dataFim = document.getElementById('filtroRelatoriosDataFim') ? document.getElementById('filtroRelatoriosDataFim').value : '';
    const dataAgora = (dataInicio || dataFim) ? `${dataInicio || '-'} até ${dataFim || '-'}` : new Date().toLocaleString('pt-BR');

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Não foi possível abrir janela de impressão. Permita popups.'); return; }

    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>Relatório - Comissões</title>
            <link rel="stylesheet" href="styles.css">
            <style>
                @page { size: A4 portrait; margin: 10mm; }
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 12px; color: #222; }
                h1 { margin-bottom: 12px; font-size: 16px; }
                table { width: 100%; border-collapse: collapse; font-size: 12px; }
                th, td { border:1px solid #ddd; padding:6px 8px; }
                thead { background:#1e3a5f; color:white; }
                .comissoes-resumo { margin-bottom:12px; font-size:14px; }
            </style>
        </head>
        <body>
            <h1>Relatório de Comissões (5%)</h1>
            <div style="margin-bottom:8px;font-size:13px;color:#222"><strong>Representante:</strong> ${filtroRep || 'Todos'} &nbsp;|&nbsp; <strong>Data:</strong> ${dataAgora}</div>
            ${content}
            <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

function exportarComissoesCSV() {
    const filtroRep = document.getElementById('filtroRelatoriosRep') ? document.getElementById('filtroRelatoriosRep').value : '';
    // Excluir vendas da IMBEL (sem comissão) e aplicar filtro de datas se fornecido
    const dataInicio = document.getElementById('filtroRelatoriosDataInicio') ? document.getElementById('filtroRelatoriosDataInicio').value : '';
    const dataFim = document.getElementById('filtroRelatoriosDataFim') ? document.getElementById('filtroRelatoriosDataFim').value : '';
    const vendasRaw = (Array.isArray(estoque.registroVendas) ? [...estoque.registroVendas] : []).filter(v => !v.cancelado);
    const vendasFiltradasPorRep = vendasRaw.filter(v => ((v.representante || '').toString().trim().toUpperCase() !== 'IMBEL'));
    let startTs = null, endTs = null;
    try {
        if (dataInicio) startTs = new Date(dataInicio + 'T00:00:00').getTime();
        if (dataFim) endTs = new Date(dataFim + 'T23:59:59').getTime();
    } catch (e) { startTs = null; endTs = null; }
    const vendas = vendasFiltradasPorRep.filter(v => {
        if (!startTs && !endTs) return true;
        if (!v.data) return false;
        const t = new Date(v.data).getTime();
        if (startTs && t < startTs) return false;
        if (endTs && t > endTs) return false;
        return true;
    });

    const obterValorVenda = (venda) => {
        if (typeof venda.valorTotal === 'number') return venda.valorTotal;
        if (Array.isArray(venda.items) && venda.items.length > 0) {
            return venda.items.reduce((s, it) => s + (Number(it.valorTotal) || ((Number(it.valorUnitario) || 0) * (Number(it.quantidade) || 0))), 0);
        }
        return ((Number(venda.valorUnitario) || 0) * (Number(venda.quantidade) || 0));
    };

    const normalizarContrato = (valor) => {
        const bruto = (valor ?? '').toString().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
        const digitos = bruto.replace(/\D+/g, '');
        return digitos ? String(parseInt(digitos, 10)) : bruto.toUpperCase();
    };

    const ordenarContrato = (a, b) => {
        const na = parseInt(a);
        const nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
    };

    const contratosMap = new Map();
    vendas.forEach(v => {
        if (filtroRep && filtroRep !== '' && v.representante !== filtroRep) return;
        const contratoKey = normalizarContrato(v.contrato);
        if (!contratoKey) return;
        const mapKey = `${v.representante || ''}||${contratoKey}`;
        const dataNorm = parseDateToYYYYMMDD(v.data);
        const atual = contratosMap.get(mapKey) || {
            representante: v.representante || '',
            contrato: contratoKey,
            loja: v.loja || '',
            valorContrato: 0,
            dataMin: null,
            dataMax: null
        };
        atual.valorContrato += obterValorVenda(v);
        if (!atual.loja && v.loja) atual.loja = v.loja;
        if (dataNorm) {
            if (!atual.dataMin || dataNorm < atual.dataMin) atual.dataMin = dataNorm;
            if (!atual.dataMax || dataNorm > atual.dataMax) atual.dataMax = dataNorm;
        }
        contratosMap.set(mapKey, atual);
    });

    const contratos = Array.from(contratosMap.values()).sort((a, b) => {
        const repCmp = (a.representante || '').localeCompare(b.representante || '');
        if (repCmp !== 0) return repCmp;
        return ordenarContrato(a.contrato, b.contrato);
    });

    const sep = ';';
    let csv = `REPRESENTANTE${sep}CONTRATO${sep}CLIENTE/LOJA${sep}DATA${sep}VALOR_CONTRATO${sep}COMISSAO_5%\n`;

    contratos.forEach(c => {
        const valor = c.valorContrato || 0;
        const comissao = Math.round((valor * 0.05) * 100) / 100;
        const dataTexto = c.dataMin
            ? (c.dataMax && c.dataMax !== c.dataMin
                ? `${new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR')} até ${new Date(c.dataMax + 'T00:00:00').toLocaleDateString('pt-BR')}`
                : new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR'))
            : '-';
        csv += `${c.representante || ''}${sep}${c.contrato || ''}${sep}${(c.loja || '').replace(/\n/g,' ')}${sep}${dataTexto}${sep}${valor.toFixed(2).replace('.',',')}${sep}${comissao.toFixed(2).replace('.',',')}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comissoes_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function gerarFechamentoMensalComissoes() {
    const hoje = new Date();
    const competenciaDefault = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
    const competencia = (prompt('Informe a competência (AAAA-MM):', competenciaDefault) || '').trim();
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
        mostrarNotificacao('Competência inválida. Use AAAA-MM.', 'error');
        return;
    }

    const [ano, mes] = competencia.split('-').map(n => parseInt(n, 10));
    const dataInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const dataFim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
    const filtroRep = document.getElementById('filtroRelatoriosRep')?.value || '';

    const { contratos, totalComissoes } = obterComissoesConsolidadas({ filtroRep, dataInicio, dataFim });
    const chave = `${competencia}||${filtroRep || 'TODOS'}`;
    if (!Array.isArray(estoque.fechamentosComissoes)) estoque.fechamentosComissoes = [];
    const idxExistente = estoque.fechamentosComissoes.findIndex(f => f.chave === chave);
    if (idxExistente !== -1) {
        const ok = confirm(`Já existe fechamento para ${competencia} (${filtroRep || 'Todos'}). Deseja substituir?`);
        if (!ok) return;
    }

    const tabela = `
        <table class="dashboard-table">
            <thead>
                <tr>
                    <th>Referência</th>
                    <th>Lâmina</th>
                    <th>Matéria</th>
                    <th>Qtd</th>
                    <th>Preço</th>
                    <th>Local</th>
                </tr>
            </thead>
            <tbody>
                ${linhas}
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="5">Total no Estoque</td>
                    <td>${totalGeral}</td>
                </tr>
            </tfoot>
        </table>
    `;
    abrirFechamentosComissoes();
}

function abrirFechamentosComissoes() {
    const container = document.getElementById('fechamentosComissoesConteudo');
    const modal = document.getElementById('modalFechamentosComissoes');
    if (!container || !modal) return;

    const lista = Array.isArray(estoque.fechamentosComissoes) ? [...estoque.fechamentosComissoes] : [];
    lista.sort((a, b) => (a.competencia < b.competencia ? 1 : -1));

    if (lista.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px">Nenhum fechamento mensal registrado.</p>';
    } else {
        container.innerHTML = lista.map(f => {
            const criado = f.criadoEm ? new Date(f.criadoEm).toLocaleString('pt-BR') : '-';
            return `
                <div class="historico-item">
                    <span class="hist-data"><strong>${f.competencia}</strong><br><small>${criado}</small></span>
                    <span class="hist-tipo venda">SNAPSHOT</span>
                    <span class="hist-descricao">
                        ${f.filtroRep ? `Rep: ${f.filtroRep} | ` : ''}${f.linhas.length} contrato(s) | Total comissão: ${formatarMoedaValor(f.totalComissoes || 0)}
                        <div style="margin-top:6px">
                            <button class="btn btn-outline btn-sm" onclick="visualizarFechamentoComissoes(${f.id})">Visualizar</button>
                            <button class="btn btn-outline btn-sm" onclick="excluirFechamentoComissoes(${f.id})">Excluir</button>
                        </div>
                    </span>
                </div>
            `;
        }).join('');
    }

    modal.style.display = 'flex';
}

function visualizarFechamentoComissoes(id) {
    const fechamento = (estoque.fechamentosComissoes || []).find(f => f.id === id);
    if (!fechamento) return;
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) return;

    const container = document.createElement('div');
    container.className = 'report-comissoes';
    container.innerHTML = `<div class="comissoes-resumo" style="margin-bottom:12px"><strong>Fechamento:</strong> ${_escapeHtml(fechamento.competencia)} ${fechamento.filtroRep ? `| Rep: ${_escapeHtml(fechamento.filtroRep)}` : ''} | <strong>Total:</strong> ${formatarMoedaValor(fechamento.totalComissoes || 0)}</div>`;

    const table = document.createElement('table');
    table.className = 'tabela-relatorio comissoes-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.innerHTML = `
        <thead><tr>
            <th style="text-align:left;padding:6px;border:1px solid #ddd">Contrato</th>
            <th style="text-align:left;padding:6px;border:1px solid #ddd">Cliente / Loja</th>
            <th style="text-align:left;padding:6px;border:1px solid #ddd">Representante(s)</th>
            <th style="text-align:left;padding:6px;border:1px solid #ddd">Data</th>
            <th style="text-align:right;padding:6px;border:1px solid #ddd">Valor Contrato (R$)</th>
            <th style="text-align:right;padding:6px;border:1px solid #ddd">Comissão 5% (R$)</th>
        </tr></thead>
        <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');
    (fechamento.linhas || []).forEach(l => {
        const dataTexto = l.dataMin
            ? (l.dataMax && l.dataMax !== l.dataMin
                ? `${new Date(l.dataMin + 'T00:00:00').toLocaleDateString('pt-BR')} até ${new Date(l.dataMax + 'T00:00:00').toLocaleDateString('pt-BR')}`
                : new Date(l.dataMin + 'T00:00:00').toLocaleDateString('pt-BR'))
            : '-';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="padding:6px;border:1px solid #ddd">${_escapeHtml(l.contrato || '')}</td>
            <td style="padding:6px;border:1px solid #ddd">${_escapeHtml(l.loja || '')}</td>
            <td style="padding:6px;border:1px solid #ddd">${(l.representantes || []).map(_escapeHtml).join(', ') || '-'}</td>
            <td style="padding:6px;border:1px solid #ddd">${_escapeHtml(dataTexto)}</td>
            <td style="padding:6px;border:1px solid #ddd;text-align:right">${formatarMoedaValor(l.valorContrato || 0)}</td>
            <td style="padding:6px;border:1px solid #ddd;text-align:right">${formatarMoedaValor(l.comissao || 0)}</td>
        `;
        tbody.appendChild(tr);
    });

    container.appendChild(table);
    preview.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'report-printable';
    wrapper.appendChild(container);
    preview.appendChild(wrapper);
    trocarAba('relatorios');
    fecharModal('modalFechamentosComissoes');
}

function excluirFechamentoComissoes(id) {
    const fechamento = (estoque.fechamentosComissoes || []).find(f => f.id === id);
    if (!fechamento) return;
    if (!confirm(`Excluir fechamento ${fechamento.competencia}?`)) return;
    estoque.fechamentosComissoes = (estoque.fechamentosComissoes || []).filter(f => f.id !== id);
    salvarDados();
    abrirFechamentosComissoes();
}

function exportarExcelCompleto() {
    if (typeof XLSX === 'undefined') {
        mostrarNotificacao('Biblioteca XLSX não carregada.', 'error');
        return;
    }

    const wb = XLSX.utils.book_new();

    const invRows = estoque.produtos.map(p => {
        const row = { Produto: p.nome };
        let totalDisp = 0, totalVenda = 0;
        (estoque.representantes || []).forEach(rep => {
            const disp = p.distribuicao?.[rep] || 0;
            const venda = p.vendas?.[rep] || 0;
            row[`${rep}_Disp`] = disp;
            row[`${rep}_Venda`] = venda;
            row[`${rep}_Saldo`] = disp - venda;
            totalDisp += disp;
            totalVenda += venda;
        });
        row.Total_Disp = totalDisp;
        row.Total_Venda = totalVenda;
        row.Total_Saldo = totalDisp - totalVenda;
        return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows), 'Inventario');

    const vendasRows = [];
    (estoque.registroVendas || []).forEach(v => {
        const data = parseDateToYYYYMMDD(v.data) || '';
        if (Array.isArray(v.items) && v.items.length > 0) {
            v.items.forEach(it => vendasRows.push({
                Contrato: v.contrato,
                Cliente: v.loja,
                Representante: v.representante,
                Produto: it.produtoNome,
                Quantidade: it.quantidade || 0,
                Valor_Unitario: it.valorUnitario || 0,
                Valor_Total_Item: it.valorTotal || 0,
                Data: data,
                Observacoes: v.observacoes || ''
            }));
        } else {
            vendasRows.push({
                Contrato: v.contrato,
                Cliente: v.loja,
                Representante: v.representante,
                Produto: v.produtoNome || '',
                Quantidade: v.quantidade || 0,
                Valor_Unitario: v.valorUnitario || 0,
                Valor_Total_Item: v.valorTotal || 0,
                Data: data,
                Observacoes: v.observacoes || ''
            });
        }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vendasRows), 'Vendas');

    const distRows = (estoque.registroDistribuicao || []).map(d => ({
        Representante: d.representante,
        Produto: d.produtoNome,
        Quantidade: d.quantidade || 0,
        Data: parseDateToYYYYMMDD(d.data) || d.data || '',
        Observacoes: d.observacoes || ''
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(distRows), 'Distribuicao');

    // Incluir devoluções em aba separada
    const devolRows = (estoque.registroDevolucoes || []).map(d => ({
        Origem: d.origem,
        Destino: d.destino,
        Produto: d.produtoNome,
        Quantidade: d.quantidade || 0,
        Data: d.data || '',
        Observacoes: d.observacoes || ''
    }));
    if (devolRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(devolRows), 'Devolucoes');

    const filtroRep = document.getElementById('filtroRelatoriosRep')?.value || '';
    const dataInicio = document.getElementById('filtroRelatoriosDataInicio')?.value || '';
    const dataFim = document.getElementById('filtroRelatoriosDataFim')?.value || '';
    const { contratos } = obterComissoesConsolidadas({ filtroRep, dataInicio, dataFim });
    const comRows = contratos.map(c => {
        const dataTexto = c.dataMin
            ? (c.dataMax && c.dataMax !== c.dataMin
                ? `${new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR')} até ${new Date(c.dataMax + 'T00:00:00').toLocaleDateString('pt-BR')}`
                : new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR'))
            : '-';
        return {
            Contrato: c.contrato,
            Cliente: c.loja,
            Representantes: Array.from(c.representantes || []).join(', '),
            Data: dataTexto,
            Valor_Contrato: c.valorContrato || 0,
            Comissao_5: c.comissao || 0
        };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(comRows), 'Comissoes');

    XLSX.writeFile(wb, `controle_estoque_${new Date().toISOString().slice(0,10)}.xlsx`);
    mostrarNotificacao('Excel exportado com sucesso!', 'success');
}

function visualizarRelatorioSelecionado() {
    const tipo = document.getElementById('filtroRelatoriosTipo') ? document.getElementById('filtroRelatoriosTipo').value : 'inventario';
    if (tipo === 'comissoes') {
        prepararRelatorioComissoes();
    } else {
        prepararRelatorioInventario();
    }
}

function imprimirTabelaSeparada(tableId, titulo, subtitulo = '', orientacao = 'landscape') {
    const tabela = document.getElementById(tableId);
    if (!tabela) {
        mostrarNotificacao('Tabela não encontrada para impressão.', 'error');
        return;
    }

    const clone = tabela.cloneNode(true);

    // Converter campos editáveis em texto para impressão limpa
    clone.querySelectorAll('td').forEach(td => {
        const checkbox = td.querySelector('input[type="checkbox"]');
        if (checkbox) {
            td.textContent = checkbox.checked ? 'Sim' : 'Não';
            return;
        }

        const select = td.querySelector('select');
        if (select) {
            const opt = select.options[select.selectedIndex];
            td.textContent = opt ? opt.text : '-';
            return;
        }

        const inputTexto = td.querySelector('input[type="text"], input:not([type]), textarea');
        if (inputTexto) {
            td.textContent = inputTexto.value || '-';
            return;
        }
    });

    // Remover coluna de ações, se existir
    const headerRow = clone.querySelector('thead tr');
    let indiceAcoes = -1;
    if (headerRow) {
        const headers = Array.from(headerRow.children);
        indiceAcoes = headers.findIndex(th => {
            const txt = (th.textContent || '').trim().toUpperCase();
            return txt === 'AÇÕES' || txt === 'ACOES';
        });
        if (indiceAcoes >= 0 && headers[indiceAcoes]) {
            headers[indiceAcoes].remove();
        }
    }

    if (indiceAcoes >= 0) {
        clone.querySelectorAll('tbody tr, tfoot tr').forEach(row => {
            const cells = Array.from(row.children);
            if (cells[indiceAcoes]) {
                cells[indiceAcoes].remove();
            }
        });
    }

    const dataAgora = new Date().toLocaleString('pt-BR');
    const subtituloFinal = subtitulo ? `<div style="margin-bottom:8px;font-size:13px;color:#222">${subtitulo}</div>` : '';

    const win = window.open('', '_blank', 'width=1100,height=700');
    if (!win) {
        alert('Não foi possível abrir a janela de impressão. Permita popups ou use a impressão do navegador.');
        return;
    }

    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>${titulo}</title>
            <link rel="stylesheet" href="styles.css">
            <style>
                @page { size: A4 ${orientacao}; margin: 10mm; }
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding: 12px; color: #222; }
                h1 { margin-bottom: 8px; font-size: 18px; }
                .meta { margin-bottom: 10px; font-size: 13px; color: #222; }
                .report-printable table { width: 100%; border-collapse: collapse; font-size: 12px; }
                .report-printable th, .report-printable td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
                .report-printable thead th { background: #1e3a5f; color: #fff; }
                @media print { body { margin: 0; } }
            </style>
        </head>
        <body>
            <h1>${titulo}</h1>
            <div class="meta"><strong>Data:</strong> ${dataAgora}</div>
            ${subtituloFinal}
            <div class="report-printable">${clone.outerHTML}</div>
            <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

function imprimirControleEnvio() {
    renderizarControleEnvio();

    const tabela = document.getElementById('tabelaControleEnvio');
    if (!tabela) { mostrarNotificacao('Tabela não encontrada.', 'error'); return; }

    const filtroRep    = document.getElementById('filtroControleEnvioRep')?.value      || '';
    const filtroSistema  = document.getElementById('filtroControleEnvioSistema')?.value  || '';
    const filtroAssinado = document.getElementById('filtroControleEnvioAssinado')?.value || '';
    const filtroEnviado  = document.getElementById('filtroControleEnvioEnviado')?.value  || '';

    const fmt = v => v === 'sim' ? 'Marcado' : v === 'nao' ? 'Não marcado' : 'Todos';

    // Clonar tabela e converter campos editáveis para texto simples
    const clone = tabela.cloneNode(true);

    clone.querySelectorAll('td').forEach(td => {
        const cb = td.querySelector('input[type="checkbox"]');
        if (cb) { td.innerHTML = cb.checked ? '✔' : ''; return; }

        const status = td.querySelector('.status-indicator');
        if (status) { td.innerHTML = status.classList.contains('checked') ? '✔' : ''; return; }

        const inp = td.querySelector('input[type="text"], textarea');
        if (inp) { td.textContent = inp.value || '-'; return; }

        const sel = td.querySelector('select');
        if (sel) { td.textContent = sel.options[sel.selectedIndex]?.text || '-'; return; }
    });

    // Remover coluna Ações
    const headerCells = Array.from(clone.querySelectorAll('thead tr:first-child th'));
    const idxAcoes = headerCells.findIndex(th => /^a[çc][oõ]es$/i.test(th.textContent.trim()));
    if (idxAcoes >= 0) {
        clone.querySelectorAll('thead tr, tbody tr, tfoot tr').forEach(row => {
            const cells = Array.from(row.children);
            if (cells[idxAcoes]) cells[idxAcoes].remove();
        });
    }

    const dataAgora = new Date().toLocaleString('pt-BR');
    const filtrosHtml = `<div class="filtros-info">
        <strong>Representante:</strong> ${filtroRep || 'Todos'} &nbsp;|&nbsp;
        <strong>Sistema:</strong> ${fmt(filtroSistema)} &nbsp;|&nbsp;
        <strong>Assinado:</strong> ${fmt(filtroAssinado)} &nbsp;|&nbsp;
        <strong>Enviado:</strong> ${fmt(filtroEnviado)}
    </div>`;

    const win = window.open('', '_blank', 'width=1200,height=700');
    if (!win) { alert('Permita popups para imprimir.'); return; }

    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>Controle de Envio de Contratos</title>
            <style>
                @page {
                    size: A4 portrait;
                    margin: 8mm 6mm;
                }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                    font-size: 8px;
                    color: #222;
                    padding: 6px 6px;
                }
                h1 {
                    font-size: 12px;
                    margin-bottom: 3px;
                    color: #1e3a5f;
                }
                .meta {
                    font-size: 8px;
                    color: #555;
                    margin-bottom: 2px;
                }
                .filtros-info {
                    font-size: 8px;
                    color: #333;
                    margin-bottom: 5px;
                    padding: 2px 5px;
                    background: #f4f6f9;
                    border-left: 3px solid #1e3a5f;
                    line-height: 1.3;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                    font-size: 7.5px;
                }
                th, td {
                    border: 1px solid #ccc;
                    padding: 2px 3px;
                    text-align: left;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    line-height: 1.2;
                }
                /* Permitir quebra de linha na coluna NOME para impressão */
                th:nth-child(2), td:nth-child(2) {
                    white-space: normal;
                    overflow-wrap: anywhere;
                }
                thead th {
                    background: #1e3a5f;
                    color: #fff;
                    font-size: 7.5px;
                    font-weight: 600;
                    text-align: center;
                    padding: 3px 3px;
                }
                tbody tr:nth-child(even) { background: #f7f9fc; }
                /* Larguras ajustadas para impressão: CTR menor, REPRESENTANTE menor, NOME maior */
                /* CTR | NOME | REP | SISTEMA | ASSINADO | ENVIADO | SOLICITAÇÃO */
                col.col-ctr        { width: 5%; }
                col.col-nome       { width: 45%; }
                col.col-rep        { width: 8%; }
                col.col-sistema    { width: 7%; }
                col.col-assinado   { width: 7%; }
                col.col-enviado    { width: 7%; }
                col.col-solic      { width: 21%; }
                /* Centralizar colunas de marcação */
                td:nth-child(4), td:nth-child(5), td:nth-child(6) { text-align: center; }
                .badge-rep {
                    display: inline-block;
                    padding: 0px 4px;
                    border-radius: 3px;
                    font-size: 7px;
                    font-weight: 700;
                    color: #fff;
                    background: #1e3a5f;
                }
                @media print { body { padding: 0; } }
            </style>
        </head>
        <body>
            <h1>Controle de Envio de Contratos</h1>
            <div class="meta"><strong>Data:</strong> ${dataAgora}</div>
            ${filtrosHtml}
            <colgroup>
                <col class="col-ctr">
                <col class="col-nome">
                <col class="col-rep">
                <col class="col-sistema">
                <col class="col-assinado">
                <col class="col-enviado">
                <col class="col-solic">
            </colgroup>
            ${clone.outerHTML}
            <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };<\/script>
        </body>
        </html>
    `);
    win.document.close();
}

function imprimirDashboardQtdProduto() {
    renderizarDashboard();
    imprimirTabelaSeparada('tabelaDashboardQtdProduto', 'Dashboard - Quantidade Vendida por Produto', '', 'portrait');
}

function imprimirDashboardValorProduto() {
    renderizarDashboard();
    imprimirTabelaSeparada('tabelaDashboardValorProduto', 'Dashboard - Valor das Vendas por Produto', '', 'portrait');
}

function imprimirDashboardVendasRepresentante() {
    renderizarDashboard();
    imprimirTabelaSeparada('tabelaVendasRep', 'Dashboard - Quantidade de Vendas por Representante', '', 'landscape');
}

// Dispatcher: imprime o relatório associado à aba informada
function imprimirRelatorioAba(tabId) {
    try {
        if (!tabId) tabId = document.querySelector('.tabs-navigation .tab-btn.active')?.dataset.tab || 'estoque';
        switch ((tabId || '').toString()) {
            case 'estoque':
                // utiliza o mecanismo de relatório/inventário já existente
                prepararRelatorioInventario();
                imprimirInventario();
                break;
            case 'distribuicao':
                imprimirDistribuicao();
                break;
            case 'vendas':
                imprimirVendas();
                break;
            case 'controleenvio':
                imprimirControleEnvio();
                break;
            case 'dashboard':
                // imprime o principal quadro de vendas por representante (mais completo)
                renderizarDashboard();
                imprimirDashboardVendasRepresentante();
                break;
            case 'relatorios':
                // decide com base no tipo selecionado
                const tipo = document.getElementById('filtroRelatoriosTipo')?.value || 'inventario';
                if (tipo === 'comissoes') imprimirComissoes();
                else if (tipo === 'distribuicao') imprimirDistribuicao();
                else imprimirInventario();
                break;
            case 'configuracoes':
                imprimirConfiguracoes();
                break;
            case 'clientes':
                imprimirClientes();
                break;
            case 'precificacao':
                imprimirPrecificacao();
                break;
            case 'propostas':
                imprimirPropostas();
                break;
            default:
                alert('Não há relatório configurado para esta aba.');
        }
    } catch (e) {
        console.error('Erro imprimindo aba', tabId, e);
        mostrarNotificacao('Falha ao iniciar impressão. Veja o console.', 'error');
    }
}

function imprimirDistribuicao() {
    prepararRelatorioDistribuicao();
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) { mostrarNotificacao('Preview não disponível para distribuição.', 'error'); return; }
    const content = preview.innerHTML;
    const win = window.open('', '_blank', 'width=1000,height=700');
    if (!win) { alert('Não foi possível abrir a janela de impressão. Permita popups.'); return; }
    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>Relatório - Distribuição</title>
            <link rel="stylesheet" href="styles.css">
            <style> @page { size: A4 portrait; margin: 10mm; } body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; padding:12px; color:#222 } .report-printable table{width:100%;border-collapse:collapse} .report-printable th, .report-printable td{border:1px solid #ddd;padding:6px 8px} thead{background:#1e3a5f;color:#fff} </style>
        </head>
        <body>
            <h1>Relatório de Distribuição</h1>
            ${content}
            <script>window.onload=function(){ setTimeout(function(){ window.print(); },200); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

function imprimirVendas() {
    // Gera relatório em uma única tabela: cada produto/linha de venda em uma linha, com subtotal por contrato
    renderizarRegistroVendas();

    const vendas = Array.isArray(estoque.registroVendas) ? [...estoque.registroVendas] : [];
    if (vendas.length === 0) {
        mostrarNotificacao('Não há vendas registradas para imprimir.', 'warning');
        return;
    }

    // Montar linhas expandidas
    const linhas = [];
    vendas.forEach(venda => {
        const contratoKey = normalizarContratoKey(venda.contrato || '');
        const dataNorm = parseDateToYYYYMMDD(venda.data) || '';
        if (Array.isArray(venda.items) && venda.items.length > 0) {
            venda.items.forEach(it => {
                linhas.push({
                    contratoKey,
                    contratoRaw: venda.contrato || contratoKey,
                    vendaId: venda.id,
                    dataNorm,
                    loja: venda.loja || '-',
                    representante: venda.representante || '-',
                    produtoNome: it.produtoNome || '-',
                    quantidade: Number(it.quantidade || 0),
                    valorUnitario: Number(it.valorUnitario || 0),
                    valorTotal: Number(it.valorTotal !== undefined ? it.valorTotal : ((Number(it.valorUnitario)||0) * (Number(it.quantidade)||0))),
                    observacoes: venda.observacoes || '-'
                });
            });
        } else {
            linhas.push({
                contratoKey,
                contratoRaw: venda.contrato || contratoKey,
                vendaId: venda.id,
                dataNorm,
                loja: venda.loja || '-',
                representante: venda.representante || '-',
                produtoNome: venda.produtoNome || '-',
                quantidade: Number(venda.quantidade || 0),
                valorUnitario: Number(venda.valorUnitario || 0),
                valorTotal: Number(venda.valorTotal !== undefined ? venda.valorTotal : ((Number(venda.valorUnitario)||0) * (Number(venda.quantidade)||0))),
                observacoes: venda.observacoes || '-'
            });
        }
    });

    // Agrupar por contrato e ordenar
    const grupos = {};
    linhas.forEach(l => { if (!grupos[l.contratoKey]) grupos[l.contratoKey] = []; grupos[l.contratoKey].push(l); });
    const chavesOrdenadas = Object.keys(grupos).sort((a,b) => {
        const na = parseInt(a); const nb = parseInt(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
    });

    // Construir tabela única (removida coluna OBS; mesclar células de contrato/loja/total por contrato quando for >1 linha)
    let tabelaHtml = `
        <table class="tabela-relatorio vendas-table" style="width:100%;border-collapse:collapse">
            <colgroup>
                <col style="width:8%" />
                <col style="width:18%" />
                <col style="width:10%" />
                <col style="width:18%" />
                <col style="width:4%" />
                <col style="width:10%" />
                <col style="width:14%" />
                <col style="width:12%" />
                <col style="width:6%" />
            </colgroup>
            <thead>
                <tr>
                    <th style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">CONTRATO</th>
                    <th style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">LOJA / CLIENTE</th>
                    <th style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">REPRESENTANTE</th>
                    <th style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">PRODUTO</th>
                    <th class="numeric" style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">QTD</th>
                    <th class="numeric" style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">VALOR UN.</th>
                    <th class="numeric" style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">VALOR TOTAL</th>
                    <th class="numeric" style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">TOTAL CONTRATO (R$)</th>
                    <th style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">DATA</th>
                </tr>
            </thead>
            <tbody>`;

    let grandTotalQtd = 0;
    let grandTotalValor = 0;

    chavesOrdenadas.forEach(ck => {
        const grupo = grupos[ck] || [];
        if (!grupo.length) return;
        // calcular subtotal do contrato
        let subtotalQtd = 0; let subtotalValor = 0;
        grupo.forEach(r => { subtotalQtd += r.quantidade || 0; subtotalValor += r.valorTotal || 0; });

        // adicionar linhas do contrato — se houver mais de uma linha, usar rowspan para CONTRATO, LOJA e TOTAL CONTRATO
        const rowspanAttr = grupo.length > 1 ? ` rowspan="${grupo.length}"` : '';
        let primeiraLinha = true;
        grupo.forEach(r => {
            const dataFmt = formatDateToDDMMYYYY(r.dataNorm);
            tabelaHtml += `<tr>`;

            if (primeiraLinha) {
                tabelaHtml += `<td style="padding:6px;border:1px solid #ddd;text-align:center"${rowspanAttr}>${r.contratoRaw || ck}</td>`;
                tabelaHtml += `<td style="padding:6px;border:1px solid #ddd;text-align:center"${rowspanAttr}>${r.loja}</td>`;
            }

            tabelaHtml += `
                <td style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">${r.representante}</td>
                <td style="padding:6px;border:1px solid #ddd;vertical-align:middle;white-space:normal;word-break:break-word;overflow-wrap:anywhere;text-align:center">${r.produtoNome}</td>
                <td class="numeric" style="padding:6px;border:1px solid #ddd;text-align:center;vertical-align:middle">${r.quantidade}</td>
                <td class="numeric" style="padding:6px;border:1px solid #ddd;text-align:center;vertical-align:middle">${r.valorUnitario ? formatarMoedaValor(r.valorUnitario) : '-'}</td>
                <td class="numeric" style="padding:6px;border:1px solid #ddd;text-align:center;vertical-align:middle">${formatarMoedaValor(r.valorTotal || 0)}</td>`;

            if (primeiraLinha) {
                tabelaHtml += `<td class="numeric" style="padding:6px;border:1px solid #ddd;text-align:center;vertical-align:middle"${rowspanAttr}><strong>${formatarMoedaValor(subtotalValor)}</strong></td>`;
            }

            tabelaHtml += `<td style="padding:6px;border:1px solid #ddd;vertical-align:middle;text-align:center">${dataFmt}</td>`;
            tabelaHtml += `</tr>`;

            primeiraLinha = false;
            grandTotalQtd += r.quantidade || 0;
            grandTotalValor += r.valorTotal || 0;
        });
        // não adicionar linha de subtotal separada — valor mostrado na primeira linha do contrato
    });

    tabelaHtml += `</tbody></table>`;

    tabelaHtml += `<div style="margin-top:12px;font-weight:700">Total Geral: ${grandTotalQtd} item(ns) — ${formatarMoedaValor(grandTotalValor)}</div>`;

    const win = window.open('', '_blank', 'width=1200,height=900');
    if (!win) { alert('Não foi possível abrir a janela de impressão. Permita popups.'); return; }

    // Forçar estilos inline para evitar CSS de impressão que esconda o conteúdo
    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>Relatório - Registro de Vendas</title>
            <style>
                @page { size: A4 landscape; margin: 8mm; }
                html, body { height: auto; margin: 0; padding:8px; }
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color:#000; background:#fff; font-size:11px; -webkit-print-color-adjust: exact; }
                h1 { margin:0 0 6px 0; font-size:14px }
                /* reduzir fonte da tabela para caber mais conteúdo */
                .tabela-relatorio, .tabela-relatorio table { font-size:9px; border-collapse:collapse; width:100% !important; table-layout: fixed; }
                /* garantir box-sizing e reduzir padding para evitar corte do conteúdo */
                .tabela-relatorio th, .tabela-relatorio td { box-sizing: border-box; border:1px solid #ddd; padding:3px !important; vertical-align: middle; word-break: break-word; }
                /* evitar quebra nas colunas numéricas */
                .tabela-relatorio th.numeric, .tabela-relatorio td.numeric { white-space: nowrap; }
                .tabela-relatorio thead th { background: #1e3a5f; color: #fff; text-align: center; font-size:10px }
                .tabela-relatorio tbody tr:nth-child(even) { background: #f7f9fc; }
                .tabela-relatorio td { background: #fff; }
                .tabela-relatorio td[colspan] { white-space: normal; }
                /* garantir que o wrapper de impressão não seja posicionado fora da página */
                .report-printable { position: static !important; left: auto !important; top: auto !important; width: 100% !important; }
                table { page-break-inside: auto; }
                /* permitir que a tabela quebre entre páginas — evitando empurrar toda a tabela para a próxima página */
                tr { page-break-inside: auto; page-break-after: auto }
                thead { display: table-header-group }
                tfoot { display: table-footer-group }
                @media print { body { margin: 0; } .tabela-relatorio { break-inside: auto; } }
            </style>
        </head>
        <body>
            <div class="report-printable">
                <h1 style="margin-bottom:8px">Registro de Vendas</h1>
                ${tabelaHtml}
            </div>
            <script>window.onload=function(){ setTimeout(function(){ window.print(); },200); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

function imprimirConfiguracoes() {
    const tab = document.getElementById('tab-configuracoes');
    if (!tab) { mostrarNotificacao('Aba de configurações não encontrada.', 'error'); return; }
    const contentArea = tab.querySelector('.content-area');
    const cloneHtml = contentArea ? contentArea.innerHTML : tab.innerHTML;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { alert('Não foi possível abrir a janela de impressão. Permita popups.'); return; }
    win.document.write(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>Configurações</title>
            <link rel="stylesheet" href="styles.css">
            <style> @page{size:A4 portrait;margin:10mm} body{font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;padding:12px;color:#222} </style>
        </head>
        <body>
            <h1>Configurações do Sistema</h1>
            <div>${cloneHtml}</div>
            <script>window.onload=function(){ setTimeout(function(){ window.print(); },200); };</script>
        </body>
        </html>
    `);
    win.document.close();
}

// ================================
// CONTROLE IMBEL (separado) - storage chave: 'estoqueImbelV1'
// ================================
const IMBEL_KEY = 'estoqueImbelV1';

// Tenta migrar dados IMBEL caso exista alguma chave antiga no localStorage
function migrateImbelStorage() {
    try {
        // já existe a chave atual
        if (localStorage.getItem(IMBEL_KEY)) return false;

        const candidates = Object.keys(localStorage).filter(k => /imbel/i.test(k) && k !== IMBEL_KEY);
        if (candidates.length === 0) return false;

        for (const k of candidates) {
            try {
                const raw = localStorage.getItem(k);
                if (!raw) continue;
                const v = JSON.parse(raw);
                if (v && (Array.isArray(v.produtos) || Array.isArray(v.movimentacoes) || (v.produtos && v.movimentacoes))) {
                    localStorage.setItem(IMBEL_KEY, JSON.stringify(v));
                    console.info(`IMBEL: migrado ${k} -> ${IMBEL_KEY}`);
                    try { mostrarNotificacao(`Dados IMBEL restaurados de "${k}"`, 'success'); } catch(e) {}
                    return true;
                }
            } catch(e) {
                // ignora chaves que não são JSON válidos
            }
        }
    } catch(e) {}
    return false;
}

function loadImbel() {
    try {
        return JSON.parse(localStorage.getItem(IMBEL_KEY) || '{"produtos":[],"movimentacoes":[]}');
    } catch (e) { return {produtos:[], movimentacoes:[]}; }
}

function saveImbel(data) {
    try { localStorage.setItem(IMBEL_KEY, JSON.stringify(data)); } catch (e) { console.error('Erro salvando IMBEL', e); }
}

// Migrar movimentações antigas para novos tipos (executar uma vez no carregamento)
function migrateImbelTipos() {
    const data = loadImbel();
    let changed = false;
    (data.movimentacoes||[]).forEach(m => {
        const tipo = (m.tipo||'').toString().trim();
        if (tipo === 'Entrada' || tipo === 'ENTRADA') {
            m.tipo = 'RECEBIMENTO_FABRICA';
            changed = true;
        } else if (tipo === 'Saída' || tipo === 'SAÍDA' || tipo === 'Saida' || tipo === 'SAIDA') {
            m.tipo = 'VENDA';
            changed = true;
        }
    });
    if (changed) {
        saveImbel(data);
        console.info('IMBEL: tipos migrados para novo formato');
    }
}

// Migrar registro que estão sem `produtoNome` para garantir compatibilidade
function migrarProdutoNomeImbel() {
    const data = loadImbel();
    let changed = false;
    (data.movimentacoes||[]).forEach(m => {
        try {
            if (!m.produtoNome && m.produtoId) {
                const prod = (data.produtos||[]).find(p => p.id === m.produtoId);
                if (prod?.nome) { m.produtoNome = prod.nome; changed = true; }
            }
            // migrar também itens internos, se houver
            if (m.items && (m.items||[]).length) {
                m.items.forEach(it => {
                    if (!it.produtoNome && it.produtoId) {
                        const prod2 = (data.produtos||[]).find(p => p.id === it.produtoId);
                        if (prod2?.nome) { it.produtoNome = prod2.nome; changed = true; }
                    }
                });
            }
        } catch(e) {}
    });
    if (changed) {
        saveImbel(data);
        console.info('IMBEL: produtoNome migrado em registros existentes');
    }
}

// ===================== IMBEL: Tabela de Preços =====================
function getImbelPrecoAtual(produtoId) {
    const data = loadImbel();
    const anoAtual = new Date().getFullYear();
    const precos = (data.precos || []).filter(p => p.produtoId === produtoId)
        .slice().sort((a,b) => (b.ano - a.ano) || (new Date(b.criadoEm||0) - new Date(a.criadoEm||0)));
    if (!precos.length) return null;
    const porAno = precos.find(p => Number(p.ano) === Number(anoAtual));
    return porAno || precos[0] || null;
}

function abrirModalPrecoImbel(editId = null) {
    const data = loadImbel();
    const prodSelect = document.getElementById('imbel_preco_produto');
    if (prodSelect) {
        prodSelect.innerHTML = '<option value="">Selecione o produto</option>' + (data.produtos||[]).map(p => `
            <option value="${p.id}">${p.nome || p.descricao || p.codigo || p.id}</option>
        `).join('');
    }
    const editField = document.getElementById('imbel_preco_edit_id'); if (editField) editField.value = '';
    const anoField = document.getElementById('imbel_preco_ano'); if (anoField) anoField.value = new Date().getFullYear();
    const valorField = document.getElementById('imbel_preco_valor'); if (valorField) valorField.value = '';
    const obsField = document.getElementById('imbel_preco_obs'); if (obsField) obsField.value = '';

    if (editId) {
        const existing = (data.precos||[]).find(x => x.id === editId);
        if (existing) {
            if (editField) editField.value = existing.id;
            if (prodSelect) prodSelect.value = existing.produtoId;
            if (anoField) anoField.value = existing.ano;
            if (valorField) valorField.value = existing.valor;
            if (obsField) obsField.value = existing.obs || '';
        }
    }

    const modal = document.getElementById('imbel_preco_modal');
    if (modal) modal.style.display = 'flex';
}

function fecharModalPrecoImbel() {
    const modal = document.getElementById('imbel_preco_modal');
    if (modal) modal.style.display = 'none';
    const editField = document.getElementById('imbel_preco_edit_id'); if (editField) editField.value = '';
}

function renderControleImbelPrecos() {
    const data = loadImbel();
    const container = document.getElementById('controleImbelPrecosContainer');
    if (!container) return;
    container.innerHTML = '';

    const byProduto = {};
    (data.precos || []).forEach(p => {
        if (!byProduto[p.produtoId]) byProduto[p.produtoId] = { produto: (data.produtos||[]).find(x => x.id === p.produtoId) || { id: p.produtoId, nome: '(Produto não encontrado)' }, precos: [] };
        byProduto[p.produtoId].precos.push(p);
    });

    const anoAtual = new Date().getFullYear();
    if (Object.keys(byProduto).length === 0) {
        container.innerHTML = '<div class="muted">Nenhum preço cadastrado ainda.</div>';
        return;
    }

    container.innerHTML = Object.entries(byProduto).map(([prodId, grupo]) => {
        const precosOrdenados = grupo.precos.slice().sort((a,b) => b.ano - a.ano);
        const produtoNome = grupo.produto.nome || grupo.produto.descricao || prodId;
        return `
          <div class="card" style="margin-bottom:12px">
            <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
              <strong>${produtoNome}</strong>
              <div style="display:flex;gap:8px">
                <button class="btn btn-outline" onclick="abrirModalPrecoImbel()">Novo</button>
              </div>
            </div>
            <div class="card-body" style="padding:8px 12px">
              <table style="width:100%;border-collapse:collapse">
                <thead><tr><th style="text-align:left">Ano</th><th style="text-align:right">Valor (R$)</th><th style="text-align:left">Obs</th><th></th></tr></thead>
                <tbody>
                  ${precosOrdenados.map(pr => {
                     const isAtual = Number(pr.ano) === Number(anoAtual);
                     return `
                       <tr style="${isAtual ? 'background:#f8fafc' : ''}">
                         <td style="padding:8px 6px">${pr.ano}</td>
                         <td style="padding:8px 6px;text-align:right">${(Number(pr.valor)||0).toFixed(2).replace('.',',')}</td>
                         <td style="padding:8px 6px">${pr.obs||''}</td>
                         <td style="padding:8px 6px;text-align:right">
                           <button class="btn btn-outline" onclick="abrirModalPrecoImbel('${pr.id}')">Editar</button>
                           <button class="btn btn-danger" onclick="excluirPrecoImbel('${pr.id}')">Excluir</button>
                         </td>
                       </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
    }).join('');

    const btnSalvar = document.getElementById('imbel_preco_salvar');
    if (btnSalvar) {
        btnSalvar.onclick = function() {
            const editId = (document.getElementById('imbel_preco_edit_id')||{value:''}).value || null;
            const produtoId = (document.getElementById('imbel_preco_produto')||{value:''}).value;
            const ano = parseInt((document.getElementById('imbel_preco_ano')||{value:''}).value,10) || new Date().getFullYear();
            const valor = parseFloat((document.getElementById('imbel_preco_valor')||{value:'0'}).value) || 0;
            const obs = (document.getElementById('imbel_preco_obs')||{value:''}).value || '';
            if (!produtoId) { try { mostrarNotificacao('Selecione um produto antes de salvar', 'error'); } catch(e) {} return; }
            const d = loadImbel(); d.precos = d.precos || [];
            if (editId) {
                const idx = d.precos.findIndex(x => x.id === editId);
                if (idx >= 0) {
                    d.precos[idx].produtoId = produtoId;
                    d.precos[idx].ano = ano;
                    d.precos[idx].valor = valor;
                    d.precos[idx].obs = obs;
                }
            } else {
                d.precos.push({ id: 'p_' + Date.now(), produtoId, ano, valor, obs, criadoEm: new Date().toISOString() });
            }
            saveImbel(d);
            fecharModalPrecoImbel();
            renderControleImbelPrecos();
            try { mostrarNotificacao('Preço salvo', 'success'); } catch(e) {}
        };
    }
}

function excluirPrecoImbel(id) {
    if (!confirm('Excluir este preço?')) return;
    const d = loadImbel(); d.precos = (d.precos||[]).filter(x => x.id !== id);
    saveImbel(d);
    renderControleImbelPrecos();
    try { mostrarNotificacao('Preço excluído', 'success'); } catch(e) {}
}

// Definições de tipos de movimentação IMBEL
const IMBEL_TIPOS = {
    RECEBIMENTO_FABRICA: {
        label: 'Recebimento Fábrica', categoria: 'entrada', icon: '📦', cor: '#16a34a', bg: '#f0fdf4', contaReceita: false,
        descricao: 'Produto recebido da Fábrica de Itajubá'
    },
    RETORNO_MARKETING: {
        label: 'Retorno Marketing', categoria: 'entrada', icon: '↩️', cor: '#0369a1', bg: '#eff6ff', contaReceita: false,
        descricao: 'Produto devolvido pelo setor de marketing'
    },
    AJUSTE_ENTRADA: {
        label: 'Ajuste de Inventário (+)', categoria: 'entrada', icon: '🔧', cor: '#64748b', bg: '#f8fafc', contaReceita: false,
        descricao: 'Correção de estoque — entrada'
    },
    VENDA: {
        label: 'Venda', categoria: 'saida', icon: '💰', cor: '#d97706', bg: '#fffbeb', contaReceita: true,
        descricao: 'Venda ao cliente final'
    },
    SAIDA_MARKETING: {
        label: 'Saída Marketing', categoria: 'saida', icon: '📣', cor: '#7c3aed', bg: '#faf5ff', contaReceita: false,
        descricao: 'Produto cedido para ação de marketing ou evento'
    },
    DEVOLUCAO_FABRICA: {
        label: 'Devolução à Fábrica', categoria: 'saida', icon: '🔙', cor: '#dc2626', bg: '#fef2f2', contaReceita: false,
        descricao: 'Produto devolvido à Fábrica de Itajubá'
    },
    AJUSTE_SAIDA: {
        label: 'Ajuste de Inventário (-)', categoria: 'saida', icon: '🔧', cor: '#64748b', bg: '#f8fafc', contaReceita: false,
        descricao: 'Correção de estoque — saída'
    }
};

function getImbelTipo(tipoKey) {
    return IMBEL_TIPOS[tipoKey]
        || IMBEL_TIPOS[(tipoKey||'').toString().toUpperCase().replace(/\s+/g,'_')]
        || { label: tipoKey, categoria: 'saida', icon: '•', cor: '#64748b', bg: '#f8fafc', contaReceita: false };
}

function imbelTipoAumentaEstoque(tipoKey) {
    try { const t = getImbelTipo(tipoKey); return t.categoria === 'entrada'; } catch(e) { return false; }
}

let _tooltipSaidaEl = null;
function mostrarTooltipSaida(event, anchor, html) {
    ocultarTooltipSaida();
    const el = document.createElement('div');
    el.id = '_tooltipSaida';
    el.innerHTML = html;
    Object.assign(el.style, {
        position: 'fixed', zIndex: '99999',
        background: '#1e293b', color: '#f1f5f9',
        padding: '8px 12px', borderRadius: '8px',
        fontSize: '0.8rem', lineHeight: '1.6',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        pointerEvents: 'none', whiteSpace: 'nowrap'
    });
    document.body.appendChild(el);
    _tooltipSaidaEl = el;
    const r = anchor.getBoundingClientRect();
    el.style.left = (r.left + r.width / 2 - el.offsetWidth / 2) + 'px';
    el.style.top  = (r.top - el.offsetHeight - 8) + 'px';
}
function ocultarTooltipSaida() {
    if (_tooltipSaidaEl) { _tooltipSaidaEl.remove(); _tooltipSaidaEl = null; }
}

// Migrar movimentações antigas para novos tipos (executar uma vez no carregamento)
function initControleImbel() {
    // mostrar dashboard por padrão quando a aba for aberta
    // hook: chamar trocarSubAbaControleImbel('dashboard') para inicializar
    try { trocarSubAbaControleImbel('dashboard'); } catch(e) {}
}

function trocarSubAbaControleImbel(sub) {
    // Atualizar botões ativos (sub-navegação IMBEL)
    document.querySelectorAll('#imbelSubNav .tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`#imbelSubNav .tab-btn[data-imbeltab="${sub}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Mostrar / ocultar painéis
    document.querySelectorAll('.controleimbel-subtab').forEach(el => el.style.display = 'none');
    const sel = document.getElementById(`controleImbel-${sub}`);
    if (sel) sel.style.display = 'block';

    // Renderizar conteúdo
    if (sub === 'estoque') renderControleImbelEstoque();
    else if (sub === 'cadastro') renderControleImbelCadastro();
    else if (sub === 'movimentacao') renderControleImbelMovimentacao();
    else if (sub === 'dashboard') renderControleImbelDashboard();
    else if (sub === 'precos') renderControleImbelPrecos();
}

// ========== MODAL FUNCTIONS ==========
function openImbelProdModal() {
    const modal = document.getElementById('imbel_prod_modal');
    if (modal) modal.classList.add('open');
}

function closeImbelProdModal() {
    const modal = document.getElementById('imbel_prod_modal');
    if (modal) modal.classList.remove('open');
    // limpar formulário
    document.getElementById('imbel_prod_nome').value = '';
    document.getElementById('imbel_prod_codigo').value = '';
    document.getElementById('imbel_prod_qtd_inicial').value = '0';
    document.getElementById('imbel_prod_obs').value = '';
    const editField = document.getElementById('imbel_prod_edit_id'); if (editField) editField.value = '';
    document.getElementById('imbel_prod_salvar').textContent = 'Salvar';
}

function openImbelMovModal() {
    const modal = document.getElementById('imbel_mov_modal');
    if (modal) modal.classList.add('open');
    try { onImbelTipoChange(); } catch(e) {}
}

function closeImbelMovModal() {
    const modal = document.getElementById('imbel_mov_modal');
    if (modal) modal.classList.remove('open');
    // limpar formulário
    try { document.getElementById('imbel_mov_tipo').value = 'VENDA'; } catch(e) {}
    const hoje = new Date().toISOString().slice(0,10);
    document.getElementById('imbel_mov_data').value = hoje;
    document.getElementById('imbel_mov_dest').value = '';
    document.getElementById('imbel_mov_cpf').value = '';
    document.getElementById('imbel_mov_endereco').value = '';
    document.getElementById('imbel_mov_tel').value = '';
    document.getElementById('imbel_mov_email').value = '';
    document.getElementById('imbel_mov_obs').value = '';
    const editField = document.getElementById('imbel_mov_edit_id'); if (editField) editField.value = '';
    document.getElementById('imbel_mov_salvar').textContent = 'Registrar Movimentação';
    try { clearImbelMovItensDOM(); } catch(e){}
}

// Helpers para gerenciar itens na modal de movimentação
function populateProductOptions(selectEl) {
    if (!selectEl) return;
    const data = loadImbel();
    selectEl.innerHTML = '';
    const optEmpty = document.createElement('option'); optEmpty.value = ''; optEmpty.textContent = '— selecione o produto —'; selectEl.appendChild(optEmpty);
    (data.produtos || []).forEach(p => {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.nome + (p.codigo ? ' ('+p.codigo+')' : '');
        selectEl.appendChild(o);
    });
}

function renderImbelMovItensDOM(items) {
    const wrap = document.getElementById('imbel_mov_itens') || document.getElementById('imbel_mov_itens_container');
    if (!wrap) return;
    wrap.innerHTML = '';
    const data = loadImbel();
    (items || []).forEach((it, idx) => {
        const row = document.createElement('div');
        row.className = 'imbel-mov-item';
        row.style.cssText = 'display:flex;gap:8px;align-items:center';

        const sel = document.createElement('select'); sel.className = 'imbel_mov_item_prod'; sel.style.cssText = 'padding:6px;border:1px solid #ddd;border-radius:6px;min-width:220px';
        populateProductOptions(sel);
        sel.value = it.produtoId || '';

        const inpQtd = document.createElement('input'); inpQtd.type = 'number'; inpQtd.min = '1'; inpQtd.className = 'imbel_mov_item_qtd'; inpQtd.style.cssText = 'width:80px;padding:6px;border:1px solid #ddd;border-radius:6px;text-align:center'; inpQtd.value = Number(it.quantidade) || 1;

        const inpVal = document.createElement('input'); inpVal.type = 'text'; inpVal.className = 'imbel_mov_item_valor'; inpVal.style.cssText = 'width:120px;padding:6px;border:1px solid #ddd;border-radius:6px;text-align:right';
        inpVal.value = (Number(it.valor) ? Number(it.valor).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '');
        inpVal.addEventListener('input', function(){ this.value = formatCurrencyBRLInput(this.value); });

        // when product changes, if type is VENDA and value empty, try to fill from price ref
        sel.addEventListener('change', function(){
            try {
                const tipo = document.getElementById('imbel_mov_tipo')?.value;
                if (tipo === 'VENDA' && (!inpVal.value || inpVal.value.trim()==='')) {
                    const p = getImbelPrecoAtual(this.value);
                    if (p) {
                        const qtd = Number(inpQtd.value) || 1;
                        inpVal.value = (Number(p.valor) * qtd).toLocaleString('pt-BR',{minimumFractionDigits:2});
                    }
                }
            } catch(e){}
        });

        // when qty changes, if price ref exists and valor blank-ish, update total
        inpQtd.addEventListener('change', function(){
            try {
                const tipo = document.getElementById('imbel_mov_tipo')?.value;
                if (tipo === 'VENDA') {
                    const p = getImbelPrecoAtual(sel.value);
                    if (p && (!inpVal.value || inpVal.value.trim()==='')) {
                        inpVal.value = (Number(p.valor) * (Number(this.value)||1)).toLocaleString('pt-BR',{minimumFractionDigits:2});
                    }
                }
            } catch(e){}
        });

        const btnRem = document.createElement('button'); btnRem.type='button'; btnRem.className='btn btn-outline btn-sm'; btnRem.style.cssText='margin-left:auto'; btnRem.textContent='Remover';
        btnRem.onclick = function(){ row.remove(); };

        row.appendChild(sel);
        row.appendChild(inpQtd);
        row.appendChild(inpVal);
        row.appendChild(btnRem);
        wrap.appendChild(row);
    });
}

function collectImbelMovItensFromDOM() {
    const wrap = document.getElementById('imbel_mov_itens') || document.getElementById('imbel_mov_itens_container');
    if (!wrap) return [];
    const rows = wrap.querySelectorAll('.imbel-mov-item');
    const items = [];
    rows.forEach(r => {
        const prod = r.querySelector('.imbel_mov_item_prod')?.value || '';
        const qtd = Number(r.querySelector('.imbel_mov_item_qtd')?.value) || 0;
        const val = parseCurrencyBRLToNumber(r.querySelector('.imbel_mov_item_valor')?.value || '');
        if (!prod || qtd <= 0) return;
        items.push({ produtoId: prod, quantidade: qtd, valor: val });
    });
    return items;
}

function clearImbelMovItensDOM() {
    const wrap = document.getElementById('imbel_mov_itens') || document.getElementById('imbel_mov_itens_container'); if (wrap) wrap.innerHTML = ''; }

function addImbelMovItemFromFields() {
    const prod = document.getElementById('imbel_mov_prod')?.value || '';
    const qtd = Number(document.getElementById('imbel_mov_qtd')?.value) || 0;
    const rawVal = (document.getElementById('imbel_mov_valor')||{value:''}).value || '';
    let val = parseCurrencyBRLToNumber(rawVal);
    const tipo = document.getElementById('imbel_mov_tipo')?.value || '';
    if ((!val || val === 0) && tipo === 'VENDA' && prod) {
        const p = getImbelPrecoAtual(prod);
        if (p) val = Number(p.valor) * (qtd || 1);
    }
    if (!prod) { mostrarNotificacao('Selecione um produto para adicionar.', 'warning'); return; }
    if (qtd <= 0) { mostrarNotificacao('Informe uma quantidade válida.', 'warning'); return; }
    const items = collectImbelMovItensFromDOM();
    items.push({ produtoId: prod, quantidade: qtd, valor: val });
    renderImbelMovItensDOM(items);
    // keep the top-level inputs for convenience
}

// Adiciona uma linha de item vazia na lista (usado pelo botão + Adicionar Item no novo modal)
function adicionarItemMovImbel(item = null) {
    try {
        const data = loadImbel();
        const container = document.getElementById('imbel_mov_itens_container') || document.getElementById('imbel_mov_itens');
        if (!container) return;

        const rowId = 'imbel_item_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);

        const div = document.createElement('div');
        div.id = rowId;
        div.className = 'imbel-mov-item';
        div.style.cssText = 'display:grid;grid-template-columns:1fr 80px 130px auto;gap:8px;align-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px';

        // produto (select)
        const sel = document.createElement('select');
        sel.className = 'imbel_mov_item_prod';
        sel.style.cssText = 'padding:7px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.875rem;width:100%';
        const emptyOpt = document.createElement('option'); emptyOpt.value = ''; emptyOpt.textContent = 'Selecione um produto'; sel.appendChild(emptyOpt);
        (data.produtos||[]).forEach(p => {
            const o = document.createElement('option'); o.value = p.id; o.textContent = p.nome || p.descricao || p.id; o.setAttribute('data-nome', p.nome || '');
            if (item && item.produtoId === p.id) o.selected = true;
            sel.appendChild(o);
        });
        sel.onchange = function(){ onImbelItemProdChange(this); };

        // quantidade
        const inpQtd = document.createElement('input'); inpQtd.type = 'number'; inpQtd.min = '1'; inpQtd.step = '1'; inpQtd.className = 'imbel_mov_item_qtd';
        inpQtd.value = (item && item.quantidade) ? item.quantidade : 1;
        inpQtd.style.cssText = 'padding:7px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.875rem;text-align:center;width:100%';
        inpQtd.oninput = function(){ calcularTotalItemImbel(this); };

        // valor unitário (texto formatado)
        const inpVal = document.createElement('input'); inpVal.type = 'text'; inpVal.className = 'imbel_mov_item_valor';
        inpVal.style.cssText = 'padding:7px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:0.875rem;text-align:right;width:100%';
        if (item && item.valor) inpVal.value = Number(item.valor).toLocaleString('pt-BR',{minimumFractionDigits:2});
        inpVal.addEventListener('input', function(){ this.value = formatCurrencyBRLInput(this.value); calcularTotalItemImbel(this); });

        // total + remover
        const rightWrap = document.createElement('div'); rightWrap.style.cssText = 'display:flex;align-items:center;gap:8px';
        const totalSpan = document.createElement('span'); totalSpan.className = 'imbel-item-total'; totalSpan.style.cssText = 'font-weight:700;color:#16a34a;font-size:0.875rem;white-space:nowrap;min-width:80px;text-align:right';
        totalSpan.textContent = 'R$ 0,00';
        const btnRem = document.createElement('button'); btnRem.type = 'button'; btnRem.style.cssText = 'background:none;border:none;cursor:pointer;color:#dc2626;font-size:1rem;padding:2px 4px;line-height:1'; btnRem.title = 'Remover'; btnRem.innerHTML = '🗑';
        btnRem.onclick = function(){ removerItemMovImbel(rowId); };
        rightWrap.appendChild(totalSpan); rightWrap.appendChild(btnRem);

        div.appendChild(sel);
        div.appendChild(inpQtd);
        div.appendChild(inpVal);
        div.appendChild(rightWrap);

        container.appendChild(div);

        // calcular total inicial
        if (item && item.valor && item.quantidade) {
            const total = Number(item.valor) * Number(item.quantidade);
            totalSpan.textContent = 'R$ ' + total.toLocaleString('pt-BR',{minimumFractionDigits:2});
        } else {
            calcularTotalItemImbel(inpVal);
        }

        setTimeout(()=> sel.focus(), 10);
    } catch (e) { console.warn('adicionarItemMovImbel erro', e); }
}

function removerItemMovImbel(rowId) {
    const el = document.getElementById(rowId);
    if (el) el.remove();
}

function calcularTotalItemImbel(input) {
    const row = input.closest('.imbel-mov-item');
    if (!row) return;
    const qtd = parseFloat(row.querySelector('.imbel_mov_item_qtd')?.value) || 0;
    const val = parseCurrencyBRLToNumber(row.querySelector('.imbel_mov_item_valor')?.value || '');
    const total = qtd * val;
    const el = row.querySelector('.imbel-item-total');
    if (el) el.textContent = 'R$ ' + Number(total).toLocaleString('pt-BR',{minimumFractionDigits:2});
}

function onImbelItemProdChange(sel) {
    try {
        const tipo = document.getElementById('imbel_mov_tipo')?.value;
        if (tipo !== 'VENDA') return;
        const prodId = sel.value;
        if (!prodId) return;
        const row = sel.closest('.imbel-mov-item');
        const valorEl = row?.querySelector('.imbel_mov_item_valor');
        if (!valorEl || (valorEl.value && valorEl.value.toString().trim() !== '')) return; // não sobrescrever
        const preco = getImbelPrecoAtual(prodId);
        if (preco) {
            // preencher valor unitário
            valorEl.value = Number(preco.valor).toLocaleString('pt-BR',{minimumFractionDigits:2});
            calcularTotalItemImbel(valorEl);
        }
    } catch(e) { console.warn('onImbelItemProdChange erro', e); }
}

function limparItensMovImbel() { clearImbelMovItensDOM(); }

function getItensMovImbel() { return collectImbelMovItensFromDOM(); }

function onImbelTipoChange() {
    const tipo = document.getElementById('imbel_mov_tipo')?.value || '';
    const produtoId = document.getElementById('imbel_mov_prod')?.value || '';
    const cfg = getImbelTipo(tipo);

    // Show/hide marketing context
    const mktCtx = document.getElementById('imbel_mov_marketing_ctx');
    if (mktCtx) {
        mktCtx.style.display = (tipo === 'SAIDA_MARKETING' || tipo === 'RETORNO_MARKETING') ? 'block' : 'none';
    }

    // Show/hide destinatario (only for VENDA)
    const destGroup = document.getElementById('imbel_mov_dest')?.closest('.form-group');
    if (destGroup) { destGroup.style.display = tipo === 'VENDA' ? 'block' : 'none'; }

    // Show/hide CPF (only for VENDA)
    const cpfGroup = document.getElementById('imbel_mov_cpf')?.closest('.form-group');
    if (cpfGroup) { cpfGroup.style.display = tipo === 'VENDA' ? 'block' : 'none'; }

    // Show reference price if type counts as revenue
    const precoRef = document.getElementById('imbel_mov_preco_ref');
    if (precoRef) {
        if (tipo === 'VENDA' && produtoId) {
            const p = getImbelPrecoAtual(produtoId);
            if (p) {
                precoRef.style.display = 'block';
                precoRef.innerHTML = `\n          💰 Preço de referência ${p.ano}: \n          <strong>R$ ${Number(p.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong>\n          ${p.obs ? `<span style="color:#b45309"> — ${p.obs}</span>` : ''}\n          <br>\n          <span style="font-size:0.78rem;color:#b45309">\n            Deixe o campo Valor em branco para usar este preço.\n          </span>`;
            } else {
                precoRef.style.display = 'block';
                precoRef.innerHTML = `\n          ⚠️ Nenhum preço de referência definido para este produto.\n          <a href="#" onclick="trocarSubAbaControleImbel('precos'); fecharModalPrecoImbel();return false;" style="color:#d97706">\n            Definir preço →\n          </a>`;
            }
        } else {
            precoRef.style.display = 'none';
        }
    }
}

// Bind modal close buttons to modals
document.addEventListener('DOMContentLoaded', function(){
    // Fechar modal ao clicar no backdrop
    document.getElementById('imbel_prod_modal').querySelector('.imbel-modal-backdrop').onclick = closeImbelProdModal;
    document.getElementById('imbel_mov_modal').querySelector('.imbel-modal-backdrop').onclick = closeImbelMovModal;
    
    // Fechar modal ao clicar no X
    document.getElementById('imbel_prod_modal').querySelector('.imbel-modal-close').onclick = closeImbelProdModal;
    document.getElementById('imbel_mov_modal').querySelector('.imbel-modal-close').onclick = closeImbelMovModal;
    // Fechar modal de preços (se existir)
    const imbelPrecoModal = document.getElementById('imbel_preco_modal');
    if (imbelPrecoModal) {
        const backdrop = imbelPrecoModal.querySelector('.imbel-modal-backdrop'); if (backdrop) backdrop.onclick = fecharModalPrecoImbel;
        const closeX = imbelPrecoModal.querySelector('.imbel-modal-close'); if (closeX) closeX.onclick = fecharModalPrecoImbel;
        imbelPrecoModal.querySelectorAll('.imbel-modal-cancel').forEach(btn => { btn.onclick = fecharModalPrecoImbel; });
    }
    
    // Fechar modal ao clicar em Cancelar
    document.querySelectorAll('#imbel_prod_modal .imbel-modal-cancel').forEach(btn => {
        btn.onclick = closeImbelProdModal;
    });
    document.querySelectorAll('#imbel_mov_modal .imbel-modal-cancel').forEach(btn => {
        btn.onclick = closeImbelMovModal;
    });
    
    // Fechar modal com ESC
    document.addEventListener('keydown', function(e){
        if (e.key === 'Escape') {
            closeImbelProdModal();
            closeImbelMovModal();
            fecharModalPrecoImbel();
        }
    });

    // Tentar migrar dados IMBEL de chaves antigas (se houver)
    try { migrateImbelStorage(); } catch(e) {}
    try { migrateImbelTipos(); } catch(e) {}
    try { migrarProdutoNomeImbel(); } catch(e) {}
}, { once: true });

function renderControleImbelDashboard() {
    const data = loadImbel();
    const container = document.getElementById('controleImbelDashboardContainer');
    if (!container) return;
    container.innerHTML = '';

    // Top indicators
    const movimentacoes = (data.movimentacoes || []).slice();
    // Considerar apenas tipos que marcam receita como vendas para faturamento
    const vendas = movimentacoes.filter(m => getImbelTipo(m.tipo).contaReceita);
    const receitaTotal = vendas.reduce((s,m) => s + (Number(m.valor)||0), 0);
    const unidadesVendidas = vendas.reduce((s,m) => s + (Number(m.quantidade)||0), 0);
    const clientes = new Set(vendas.filter(v=> (v.destinatario||'').trim() ).map(v => (v.destinatario||'').toString().toUpperCase()));
    const clientesAtivos = clientes.size;
    const pedidosCount = vendas.length;
    const ticketMedio = pedidosCount > 0 ? receitaTotal / pedidosCount : 0;

    const indicadores = document.createElement('div');
    indicadores.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:12px';
    const card = (titulo, valor, destaque) => {
        const c = document.createElement('div');
        c.style.cssText = 'background:#fff;padding:14px;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.06)';
        const innerVal = destaque ? `<span style="color:#1e3a5f">${valor}</span>` : `${valor}`;
        c.innerHTML = `<div style="font-size:.78rem;color:#666">${titulo}</div><div style="font-size:1.3rem;font-weight:700;margin-top:6px">${innerVal}</div>`;
        return c;
    };

    indicadores.appendChild(card('Receita total', 'R$ ' + receitaTotal.toLocaleString('pt-BR',{minimumFractionDigits:2}), true));
    indicadores.appendChild(card('Unidades vendidas', unidadesVendidas.toString(), false));
    indicadores.appendChild(card('Clientes ativos', clientesAtivos.toString(), false));
    indicadores.appendChild(card('Ticket médio', 'R$ ' + ticketMedio.toLocaleString('pt-BR',{minimumFractionDigits:2}), false));

    container.appendChild(indicadores);

    // Inserir container da tabela detalhada de estoque logo após os KPIs
    try {
        let detalheEstoqueWrapper = document.getElementById('controleImbelEstoqueContainer');
        if (!detalheEstoqueWrapper) {
            detalheEstoqueWrapper = document.createElement('div');
            detalheEstoqueWrapper.id = 'controleImbelEstoqueContainer';
            detalheEstoqueWrapper.style.cssText = 'margin-top:16px';
            container.appendChild(detalheEstoqueWrapper);
        }
        try { renderControleImbelEstoque(); } catch(e) { console.warn('Erro ao renderizar tabela de estoque dentro do Dashboard', e); }
    } catch(e) { console.warn('Erro ao inserir container de estoque no Dashboard', e); }

    // Controle financeiro: pendentes e comparação
    const pendentes = vendas.filter(v => (v.pagamento||'').toString().toUpperCase() !== 'SIM');
    const valorPendentes = pendentes.reduce((s,m) => s + (Number(m.valor)||0), 0);
    const pagosCount = vendas.filter(v => (v.pagamento||'').toString().toUpperCase() === 'SIM').length;
    const naoConfirmadosCount = vendas.length - pagosCount;

    const financeiroWrap = document.createElement('div');
    financeiroWrap.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;align-items:stretch';
    const finCard = (title, value, sub) => {
        const el = document.createElement('div');
        el.style.cssText = 'background:#fff;padding:12px;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.06);min-width:200px;flex:1';
        el.innerHTML = `<div style="font-size:.78rem;color:#666">${title}</div><div style="font-size:1.1rem;font-weight:700;margin-top:6px">${value}</div>${sub?`<div style="font-size:.75rem;color:#888;margin-top:6px">${sub}</div>`:''}`;
        return el;
    };

    financeiroWrap.appendChild(finCard('Valor pendente de recebimento', 'R$ ' + valorPendentes.toLocaleString('pt-BR',{minimumFractionDigits:2}), `${pendentes.length} pedidos pendentes`));
    financeiroWrap.appendChild(finCard('Pedidos pagos', pagosCount.toString(), 'Confirmados'));
    financeiroWrap.appendChild(finCard('Pedidos não confirmados', naoConfirmadosCount.toString(), 'Aguardando comprovante/GRU'));

    // Chart area (paid x unconfirmed)
    const chartCard = document.createElement('div');
    chartCard.style.cssText = 'background:#fff;padding:12px;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.06);min-width:260px;flex:1';
    chartCard.innerHTML = `<div style="font-size:.78rem;color:#666">Comparação: Pagos vs Não confirmados</div><canvas id="imbelPaidChart" style="height:80px;margin-top:8px"></canvas>`;
    financeiroWrap.appendChild(chartCard);

    container.appendChild(financeiroWrap);

    // render chart if Chart available
    setTimeout(() => {
        try {
            const ctx = document.getElementById('imbelPaidChart');
            if (ctx && window.Chart) {
                // destroy previous chart instance if any
                if (ctx._chartInstance) try { ctx._chartInstance.destroy(); } catch(e){}
                const ch = new Chart(ctx.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: ['Pagos','Não confirmados'],
                        datasets: [{
                            label: 'Pedidos',
                            data: [pagosCount, naoConfirmadosCount],
                            backgroundColor: ['#28a745','#ffc107']
                        }]
                    },
                    options: {plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}
                });
                ctx._chartInstance = ch;
            }
        } catch (e) { console.warn('Chart render falhou', e); }
    }, 40);

    // Gestão de estoque em tempo real com semáforo
    const estoqueWrap = document.createElement('div');
    estoqueWrap.style.cssText = 'background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 6px rgba(0,0,0,.06);margin-top:12px';
    estoqueWrap.innerHTML = `<h3 style="margin:0 0 8px 0;font-size:1rem">Gestão de Estoque</h3>`;
    const tabela = document.createElement('table');
    tabela.style.cssText = 'width:100%;border-collapse:collapse;font-size:.9rem';
    tabela.innerHTML = `<thead><tr style="background:#1e3a5f;color:#fff"><th style="padding:8px">Produto</th><th style="padding:8px">Estoque Atual</th><th style="padding:8px">Ponto Reposição</th><th style="padding:8px">Semáforo</th><th style="padding:8px">Tempo p/ zerar lote anterior</th></tr></thead><tbody></tbody>`;
    const tb = tabela.querySelector('tbody');

    const produtos = data.produtos || [];
    // função auxiliar para calcular saldo atual (usa categoria dos tipos)
    const calcSaldo = (prodId) => {
        return (data.movimentacoes||[]).reduce((saldo, m) => {
            if (m.produtoId !== prodId) return saldo;
            const q = Number(m.quantidade) || 0;
            const cfg = getImbelTipo(m.tipo);
            return saldo + (cfg.categoria === 'entrada' ? q : -q);
        }, Number((data.produtos||[]).find(p=>p.id===prodId)?.quantidadeInicial) || 0);
    };

    // calcula tempo para zerar lote anterior (último ciclo completo)
    function tempoParaZerar(prodId) {
        const movs = (data.movimentacoes||[]).filter(m=>m.produtoId===prodId).slice().sort((a,b)=> (a.data||'').localeCompare(b.data||''));
        if (!movs.length) return null;
        let balance = 0;
        let lastEntradaDate = null;
        let lastZeroCycleDays = null;
        movs.forEach(m => {
            const q = Number(m.quantidade)||0;
            if (imbelTipoAumentaEstoque(m.tipo)) {
                balance += q;
                lastEntradaDate = m.data || null;
            } else {
                balance -= q;
            }
            if (lastEntradaDate && balance <= 0) {
                // ciclo zerou
                try {
                    const d1 = new Date(lastEntradaDate);
                    const d2 = new Date(m.data || lastEntradaDate);
                    const diff = Math.ceil((d2 - d1)/(1000*60*60*24));
                    lastZeroCycleDays = diff >= 0 ? diff : null;
                } catch(e) { lastZeroCycleDays = null; }
                // reset to look for more recent cycles
                lastEntradaDate = null;
                balance = 0;
            }
        });
        return lastZeroCycleDays;
    }

    // vamos acumular estatísticas de estoque enquanto construímos a tabela
    const esgotado = [];
    const baixo = [];
    const ok = [];
    const zerados = [];

    produtos.forEach(p => {
        const estoqueAtual = calcSaldo(p.id);
        const ponto = (p.pontoReposicao !== undefined) ? Number(p.pontoReposicao) : Math.max(1, Math.floor((Number(p.quantidadeInicial)||0) * 0.2));
        let status = 'OK';
        let color = '#28a745';
        if (estoqueAtual <= 0) { status = 'ESGOTADO'; color = '#dc3545'; esgotado.push(p); if (estoqueAtual === 0) zerados.push(p); }
        else if (estoqueAtual <= ponto) { status = 'BAIXO'; color = '#ffc107'; baixo.push(p); }
        else { ok.push(p); }

        const tempo = tempoParaZerar(p.id);
        const tr = document.createElement('tr');
        tr.style.background = '#fff';
        tr.innerHTML = `<td style="padding:8px;border:1px solid #eee">${_escapeHtml(p.nome)}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center">${estoqueAtual}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center">${p.pontoReposicao !== undefined ? p.pontoReposicao : ponto}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center"><span style="display:inline-block;padding:6px 10px;border-radius:12px;background:${color};color:#fff;font-weight:700">${_escapeHtml(status)}</span></td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center">${tempo===null?'-':(tempo + ' dias')}</td>`;
        tb.appendChild(tr);
    });

    // resumo rápido acima da tabela com alertas
    const resumo = document.createElement('div');
    resumo.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;align-items:center';
    const resumoItem = (label, value, color) => {
        const el = document.createElement('div');
        el.style.cssText = 'background:#fff;padding:8px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.04);min-width:160px';
        el.innerHTML = `<div style="font-size:.78rem;color:#666">${label}</div><div style="font-weight:700;margin-top:6px;color:${color}">${value}</div>`;
        return el;
    };
    resumo.appendChild(resumoItem('Produtos esgotados', esgotado.length.toString(), '#dc3545'));
    resumo.appendChild(resumoItem('Produtos abaixo do ponto', baixo.length.toString(), '#856404'));
    resumo.appendChild(resumoItem('Produtos OK', ok.length.toString(), '#155724'));
    if (zerados.length) {
        const listaZ = document.createElement('div');
        listaZ.style.cssText = 'background:#fff;padding:8px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.04);min-width:220px';
        listaZ.innerHTML = `<div style="font-size:.78rem;color:#666">Zerados</div><div style="font-size:.85rem;margin-top:6px;color:#333">${zerados.map(z=>_escapeHtml(z.nome)).join(', ')}</div>`;
        resumo.appendChild(listaZ);
    }

    // primeiro adiciona o resumo e depois a tabela (evita insertBefore com nó ainda não anexado)
    estoqueWrap.appendChild(resumo);
    estoqueWrap.appendChild(tabela);
    container.appendChild(estoqueWrap);

    // Acompanhamento de pedidos (pipeline)
    const pipelineWrap = document.createElement('div');
    pipelineWrap.style.cssText = 'background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 6px rgba(0,0,0,.06);margin-top:12px';
    pipelineWrap.innerHTML = `<h3 style="margin:0 0 8px 0;font-size:1rem">Acompanhamento de Pedidos</h3>`;
    const tableP = document.createElement('table');
    tableP.style.cssText = 'width:100%;border-collapse:collapse;font-size:.9rem';
    tableP.innerHTML = `<thead><tr style="background:#1e3a5f;color:#fff"><th style="padding:8px">Nº</th><th style="padding:8px">Produto</th><th style="padding:8px">Data</th><th style="padding:8px">Cliente</th><th style="padding:8px">Pipeline</th><th style="padding:8px">Ações</th></tr></thead><tbody></tbody>`;
    const tpb = tableP.querySelector('tbody');

    const vendasLista = movimentacoes.filter(m => getImbelTipo(m.tipo).contaReceita).slice().reverse();
    vendasLista.forEach((v, idx) => {
        const prod = (data.produtos||[]).find(p=>p.id===v.produtoId) || {nome: v.descricao || '-'};
        const dateFmt = formatDateToDDMMYYYY(v.data || '');
        const passos = [
            {label:'Pedido', ok:true},
            {label:'Comprovante', ok: (v.pagamento||'').toString().toUpperCase()==='SIM'},
            {label:'GRU paga', ok: (v.gruPago||'') === true ? true : false},
            {label:'Entregue', ok: (v.entregue||'').toString().toUpperCase()==='SIM'},
            {label:'FI', ok: (v.fi||'').toString().toUpperCase()==='SIM'}
        ];

        const passoHtml = passos.map(pas => `<span style="display:inline-block;margin-right:6px;padding:6px 8px;border-radius:12px;background:${pas.ok? '#d4edda':'#f8d7da'};color:${pas.ok? '#155724':'#721c24'};font-weight:600;font-size:.8rem">${pas.label}</span>`).join('');

        const tr = document.createElement('tr');
        tr.style.background = idx % 2 === 0 ? '#fff' : '#f7f9fc';
        tr.innerHTML = `<td style="padding:8px;border:1px solid #eee;text-align:center">${idx+1}</td>
                        <td style="padding:8px;border:1px solid #eee">${prod.nome}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center">${dateFmt}</td>
                        <td style="padding:8px;border:1px solid #eee">${v.destinatario||'-'}</td>
                        <td style="padding:8px;border:1px solid #eee">${passoHtml}</td>
                        <td style="padding:8px;border:1px solid #eee;text-align:center"><button class="btn btn-outline" data-toggle-pag="${v.id}">Toggle Pag.</button> <button class="btn btn-outline" data-toggle-ent="${v.id}">Toggle Entregue</button> <button class="btn btn-outline" data-toggle-fi="${v.id}">Toggle FI</button></td>`;
        tpb.appendChild(tr);
    });

    pipelineWrap.appendChild(tableP);
    container.appendChild(pipelineWrap);

    

    // bind action buttons (toggle status)
    tpb.querySelectorAll('button[data-toggle-pag]').forEach(btn => btn.onclick = function(){
        const id = this.getAttribute('data-toggle-pag');
        const mov = (data.movimentacoes||[]).find(m=>m.id===id);
        if (!mov) return; mov.pagamento = (mov.pagamento||'').toString().toUpperCase()==='SIM' ? 'NÃO' : 'SIM'; saveImbel(data); renderControleImbelDashboard(); renderControleImbelMovimentacao(); renderControleImbelEstoque();
    });
    tpb.querySelectorAll('button[data-toggle-ent]').forEach(btn => btn.onclick = function(){
        const id = this.getAttribute('data-toggle-ent');
        const mov = (data.movimentacoes||[]).find(m=>m.id===id);
        if (!mov) return; mov.entregue = (mov.entregue||'').toString().toUpperCase()==='SIM' ? 'NÃO' : 'SIM'; saveImbel(data); renderControleImbelDashboard(); renderControleImbelMovimentacao(); renderControleImbelEstoque();
    });
    tpb.querySelectorAll('button[data-toggle-fi]').forEach(btn => btn.onclick = function(){
        const id = this.getAttribute('data-toggle-fi');
        const mov = (data.movimentacoes||[]).find(m=>m.id===id);
        if (!mov) return; mov.fi = (mov.fi||'').toString().toUpperCase()==='SIM' ? 'NÃO' : 'SIM'; saveImbel(data); renderControleImbelDashboard(); renderControleImbelMovimentacao(); renderControleImbelEstoque();
    });

    // --- Seções adicionais: Receita por produto e Análise de clientes ---
    // Receita por produto
    try {
        const receitaWrap = document.createElement('div');
        receitaWrap.style.cssText = 'background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 6px rgba(0,0,0,.06);margin-top:12px';
        receitaWrap.innerHTML = `<h3 style="margin:0 0 8px 0;font-size:1rem">Receita por Produto</h3>`;
        const tableR = document.createElement('table');
        tableR.style.cssText = 'width:100%;border-collapse:collapse;font-size:.9rem;margin-top:8px';
        tableR.innerHTML = `<thead><tr style="background:#1e3a5f;color:#fff"><th style="padding:8px">Produto</th><th style="padding:8px;text-align:center">Unid. Vendidas</th><th style="padding:8px;text-align:right">Receita</th></tr></thead><tbody></tbody>`;
        const tbr = tableR.querySelector('tbody');

        const receitaPorProduto = {};
        const unidadesPorProduto = {};
        (data.movimentacoes||[]).forEach(m => {
            if (!m.produtoId) return;
            const tipoCfg = getImbelTipo(m.tipo);
                if (!tipoCfg.contaReceita) return;
            const id = m.produtoId;
            receitaPorProduto[id] = (receitaPorProduto[id]||0) + (Number(m.valor)||0);
            unidadesPorProduto[id] = (unidadesPorProduto[id]||0) + (Number(m.quantidade)||0);
        });

        const produtosList = (data.produtos||[]).slice();
        produtosList.sort((a,b) => (receitaPorProduto[b.id]||0) - (receitaPorProduto[a.id]||0));
        produtosList.forEach(p => {
            const rec = receitaPorProduto[p.id] || 0;
            const unid = unidadesPorProduto[p.id] || 0;
            const tr = document.createElement('tr');
            tr.style.background = '#fff';
            tr.innerHTML = `<td style="padding:8px;border:1px solid #eee">${_escapeHtml(p.nome)}</td><td style="padding:8px;border:1px solid #eee;text-align:center">${unid}</td><td style="padding:8px;border:1px solid #eee;text-align:right">R$ ${rec.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>`;
            tbr.appendChild(tr);
        });
        receitaWrap.appendChild(tableR);
        container.appendChild(receitaWrap);
    } catch(e){ console.warn('Erro ao gerar receita por produto', e); }

    // Análise de clientes: top 10 e clientes com múltiplos produtos
    try {
        const clientes = {};
        (data.movimentacoes||[]).forEach(m => {
            const tipo = (m.tipo||'').toString().toUpperCase();
            if (tipo !== 'SAÍDA') return;
            const nome = (m.destinatario||'').toString().trim();
            if (!nome) return;
            const key = nome.toUpperCase();
            clientes[key] = clientes[key] || {nome: nome, total:0, pedidos:0, produtos:new Set()};
            clientes[key].total += (Number(m.valor)||0);
            clientes[key].pedidos += 1;
            if (m.produtoId) clientes[key].produtos.add(m.produtoId);
        });

        const clientesArr = Object.values(clientes).map(c => ({nome:c.nome,total:c.total,pedidos:c.pedidos,produtosCount:c.produtos.size}));
        clientesArr.sort((a,b) => b.total - a.total);

        // Top 10
        const topWrap = document.createElement('div');
        topWrap.style.cssText = 'background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 6px rgba(0,0,0,.06);margin-top:12px';
        topWrap.innerHTML = `<h3 style="margin:0 0 8px 0;font-size:1rem">Top 10 Clientes (por Receita)</h3>`;
        const tableC = document.createElement('table');
        tableC.style.cssText = 'width:100%;border-collapse:collapse;font-size:.9rem;margin-top:8px';
        tableC.innerHTML = `<thead><tr style="background:#1e3a5f;color:#fff"><th style="padding:8px">#</th><th style="padding:8px">Cliente</th><th style="padding:8px;text-align:right">Total</th><th style="padding:8px;text-align:center">Pedidos</th><th style="padding:8px;text-align:center">Produtos distintos</th></tr></thead><tbody></tbody>`;
        const tbc = tableC.querySelector('tbody');
        clientesArr.slice(0,10).forEach((c, idx) => {
            const tr = document.createElement('tr');
            tr.style.background = '#fff';
            tr.innerHTML = `<td style="padding:8px;border:1px solid #eee;text-align:center">${idx+1}</td><td style="padding:8px;border:1px solid #eee">${_escapeHtml(c.nome)}</td><td style="padding:8px;border:1px solid #eee;text-align:right">R$ ${c.total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td><td style="padding:8px;border:1px solid #eee;text-align:center">${c.pedidos}</td><td style="padding:8px;border:1px solid #eee;text-align:center">${c.produtosCount}</td>`;
            tbc.appendChild(tr);
        });
        topWrap.appendChild(tableC);
        container.appendChild(topWrap);

        // Clientes que compraram múltiplos produtos
        const multi = clientesArr.filter(c => c.produtosCount > 1);
        if (multi.length) {
            const multiWrap = document.createElement('div');
            multiWrap.style.cssText = 'background:#fff;border-radius:10px;padding:12px;box-shadow:0 1px 6px rgba(0,0,0,.06);margin-top:12px';
            multiWrap.innerHTML = `<h3 style="margin:0 0 8px 0;font-size:1rem">Clientes com múltiplos produtos</h3>`;
            const tbl = document.createElement('table');
            tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:.9rem;margin-top:8px';
            tbl.innerHTML = `<thead><tr style="background:#1e3a5f;color:#fff"><th style="padding:8px">Cliente</th><th style="padding:8px;text-align:right">Total</th><th style="padding:8px;text-align:center">Produtos distintos</th></tr></thead><tbody></tbody>`;
            const tbm = tbl.querySelector('tbody');
            multi.forEach(c => {
                const tr = document.createElement('tr');
                tr.style.background = '#fff';
                tr.innerHTML = `<td style="padding:8px;border:1px solid #eee">${_escapeHtml(c.nome)}</td><td style="padding:8px;border:1px solid #eee;text-align:right">R$ ${c.total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td><td style="padding:8px;border:1px solid #eee;text-align:center">${c.produtosCount}</td>`;
                tbm.appendChild(tr);
            });
            multiWrap.appendChild(tbl);
            container.appendChild(multiWrap);
        }
    } catch(e) { console.warn('Erro ao gerar análise de clientes', e); }
}

function renderControleImbelEstoque() {
    const data = loadImbel();
    const container = document.getElementById('controleImbelEstoqueContainer');
    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'overflow-x:auto;background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.08)';

    const thStyle = 'padding:8px 12px;border:1px solid #ddd;background:#1e3a5f;color:#fff;font-size:.82rem;white-space:nowrap;text-align:center';
    const tabela = document.createElement('table');
    tabela.style.cssText = 'width:100%;border-collapse:collapse;font-size:.85rem';
    tabela.innerHTML = `<thead><tr>
        <th style="${thStyle}">#</th>
        <th style="${thStyle};text-align:left">Produto</th>
        <th style="${thStyle}">Qtd Inicial</th>
        <th style="${thStyle}">Entradas</th>
        <th style="${thStyle}">Saídas</th>
        <th style="${thStyle}">Saldo Atual</th>
        <th style="${thStyle}">Ponto Reposição</th>
        <th style="${thStyle}">Valor Unit.</th>
        <th style="${thStyle}">Valor em Estoque</th>
        <th style="${thStyle}">Ações</th>
    </tr></thead><tbody></tbody>`;

    const tbody = tabela.querySelector('tbody');
    const tdBase  = 'padding:8px 12px;border:1px solid #ddd;vertical-align:middle';
    const tdCenter = tdBase + ';text-align:center';

    // Calcular totais de Entrada e Saída por produto
    const totEntrada = {};
    const totSaida   = {};
    const totSaidaByTipo = {}; // { produtoId: { VENDA: n, SAIDA_MARKETING: n, ... } }
    (data.movimentacoes||[]).forEach(m => {
        if (!m.produtoId) return;
        const q = Number(m.quantidade) || 0;
        if (imbelTipoAumentaEstoque(m.tipo)) totEntrada[m.produtoId] = (totEntrada[m.produtoId]||0) + q;
        else {
            totSaida[m.produtoId] = (totSaida[m.produtoId]||0) + q;
            if (!totSaidaByTipo[m.produtoId]) totSaidaByTipo[m.produtoId] = {};
            totSaidaByTipo[m.produtoId][m.tipo] = (totSaidaByTipo[m.produtoId][m.tipo]||0) + q;
        }
    });

    const produtos = data.produtos || [];

    if (produtos.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="6" style="${tdBase};text-align:center;color:#999;font-style:italic">Nenhum produto cadastrado. Cadastre na sub-aba "Cadastro de Produtos".</td>`;
        tbody.appendChild(tr);
    }

    produtos.forEach((p, idx) => {
        const entrada = totEntrada[p.id] || 0;
        const saida   = totSaida[p.id]   || 0;
        const saidaByTipo = totSaidaByTipo[p.id] || {};
        const saidaTiposOrdenados = Object.keys(IMBEL_TIPOS).filter(k => {
            const t = IMBEL_TIPOS[k];
            return t.categoria === 'saida' && saidaByTipo[k];
        });
        const saidaTooltipRows = saidaTiposOrdenados.map(k => {
            const t = IMBEL_TIPOS[k];
            return `${t.icon} ${t.label}: <b>${saidaByTipo[k]}</b>`;
        }).join('<br>');
        const saidaHasBreakdown = saidaTiposOrdenados.length > 1 ||
            (saidaTiposOrdenados.length === 1 && saidaTiposOrdenados[0] !== 'VENDA');
        const saidaCell = saidaHasBreakdown
            ? `<span style="cursor:help;border-bottom:1px dashed #dc2626"
                    title=""
                    onmouseenter="mostrarTooltipSaida(event, this, \`${saidaTooltipRows}\`)"
                    onmouseleave="ocultarTooltipSaida()"
               >${saida} ℹ️</span>`
            : `${saida}`;
        const inicial = Number(p.quantidadeInicial) || 0;
        const estoqueAtual = inicial + entrada - saida;

        const ponto = (p.pontoReposicao !== undefined && p.pontoReposicao !== '')
            ? Number(p.pontoReposicao)
            : Math.max(1, Math.floor((Number(p.quantidadeInicial)||0) * 0.2));

        let saldoStatus, rowBg, saldoBadge;
        if (estoqueAtual <= 0) {
            saldoStatus = 'ESGOTADO';
            rowBg = '#fff5f5';
            saldoBadge = `<span style="display:inline-block;padding:2px 10px;border-radius:20px;background:#dc2626;color:#fff;font-size:0.75rem;font-weight:700">${estoqueAtual} 🔴</span>`;
        } else if (estoqueAtual <= ponto) {
            saldoStatus = 'BAIXO';
            rowBg = '#fffbeb';
            saldoBadge = `<span style="display:inline-block;padding:2px 10px;border-radius:20px;background:#d97706;color:#fff;font-size:0.75rem;font-weight:700">${estoqueAtual} 🟡</span>`;
        } else {
            saldoStatus = 'OK';
            rowBg = idx % 2 === 0 ? '#fff' : '#f7f9fc';
            saldoBadge = `<span style="display:inline-block;padding:2px 10px;border-radius:20px;background:#16a34a;color:#fff;font-size:0.75rem;font-weight:700">${estoqueAtual} 🟢</span>`;
        }

        const valorUnit = Number(p.valorUnitario) || 0;
        const valorEstoque = valorUnit * Math.max(0, estoqueAtual);
        const fmtR = v => v > 0
            ? 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits:2})
            : '—';

        const tr = document.createElement('tr');
        tr.style.background = rowBg;
        tr.innerHTML = `
            <td style="${tdCenter};font-weight:600">${idx + 1}</td>
            <td style="${tdBase};font-weight:500">
              ${p.nome}
              ${p.codigo ? `<span style="color:#94a3b8;font-size:0.72rem;margin-left:4px">(${p.codigo})</span>` : ''}
            </td>
            <td style="${tdCenter}">${inicial}</td>
            <td style="${tdCenter};color:#16a34a;font-weight:600">${entrada}</td>
            <td style="${tdCenter};color:#dc2626;font-weight:600">${saidaCell}</td>
            <td style="${tdCenter}">${saldoBadge}</td>
            <td style="${tdCenter}">
              <input type="number" min="0" step="1"
                     value="${p.pontoReposicao !== undefined ? p.pontoReposicao : ponto}"
                     onchange="salvarPontoReposicaoImbel('${p.id}', this.value)"
                     style="width:70px;padding:4px 6px;border:1px solid #e2e8f0;border-radius:6px;text-align:center;font-size:0.85rem">
            </td>
            <td style="${tdCenter}">${fmtR(valorUnit)}</td>
            <td style="${tdCenter};font-weight:600;color:${valorEstoque > 0 ? '#16a34a' : '#94a3b8'}">${fmtR(valorEstoque)}</td>
            <td style="${tdCenter}">
              <button class="btn btn-outline btn-sm" data-editprod="${p.id}">✎ Editar</button>
            </td>`;
        tbody.appendChild(tr);
    });

    // Totais: valor total em estoque
    const totalValorEstoque = (data.produtos||[]).reduce((s, p) => {
        const ent = totEntrada[p.id] || 0;
        const sai = totSaida[p.id]   || 0;
        const ini = Number(p.quantidadeInicial) || 0;
        const saldo = Math.max(0, ini + ent - sai);
        return s + saldo * (Number(p.valorUnitario)||0);
    }, 0);

    const tfootRow = document.createElement('tr');
    tfootRow.style.cssText = 'background:#1e3a5f;color:#fff;font-weight:700';
    tfootRow.innerHTML = `
        <td colspan="5" style="padding:10px 12px;text-align:left">Total (${produtos.length} produto(s))</td>
        <td colspan="3" style="padding:10px 12px;text-align:center">Valor total em estoque:</td>
        <td style="padding:10px 12px;text-align:center;color:#7ee787;font-size:1rem">R$ ${totalValorEstoque.toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
        <td></td>`;
    tabela.appendChild(document.createElement('tfoot')).appendChild(tfootRow);

    // Linha de totais gerais
    if (produtos.length > 0) {
        const totalInicial = (produtos||[]).reduce((s,p)=>s + (Number(p.quantidadeInicial)||0),0);
        const totalE = Object.values(totEntrada).reduce((a,b)=>a+b,0);
        const totalS = Object.values(totSaida).reduce((a,b)=>a+b,0);
        const totalSaldo = totalInicial + totalE - totalS;
        const tr = document.createElement('tr');
        tr.style.cssText = 'background:#1e3a5f;color:#fff;font-weight:700';
        tr.innerHTML = `
            <td colspan="2" style="${tdBase};background:#1e3a5f;color:#fff;text-align:right">TOTAL GERAL</td>
            <td style="${tdCenter};background:#1e3a5f;color:#fff">${totalInicial}</td>
            <td style="${tdCenter};background:#1e3a5f;color:#fff">${totalE}</td>
            <td style="${tdCenter};background:#1e3a5f;color:#fff">${totalS}</td>
            <td style="${tdCenter};background:#1e3a5f;color:#fff">${totalSaldo}</td>
        `;
        tbody.appendChild(tr);
    }

    wrap.appendChild(tabela);
    container.appendChild(wrap);

    // Handler: editar produto a partir do Estoque
    tbody.querySelectorAll('button[data-editprod]').forEach(btn => btn.onclick = function(){
        const id = this.getAttribute('data-editprod');
        if (!id) return;
        editarProdutoPorId(id);
    });

    // Atalho para cadastrar produto
    const btnCad = document.createElement('button');
    btnCad.className = 'btn btn-outline';
    btnCad.style.marginTop = '10px';
    btnCad.innerHTML = '<span class="btn-icon">➕</span> Cadastrar Produto';
    btnCad.onclick = () => trocarSubAbaControleImbel('cadastro');
    container.appendChild(btnCad);
}

function renderControleImbelCadastro() {
    const data = loadImbel();
    const container = document.getElementById('controleImbelCadastroContainer');
    container.innerHTML = '';

    const thStyle = 'padding:8px 12px;border:1px solid #ddd;background:#1e3a5f;color:#fff;font-size:.82rem;white-space:nowrap';
    const tdBase  = 'padding:8px 12px;border:1px solid #ddd;vertical-align:middle;font-size:.85rem';

    // Botões de ação no topo
    const topActions = document.createElement('div');
    topActions.style.cssText = 'display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap';
    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn btn-primary';
    btnAdd.innerHTML = '<span class="btn-icon">➕</span> Adicionar Produto';
    btnAdd.onclick = () => {
        // Limpar campos do modal
        document.getElementById('imbel_prod_nome').value = '';
        document.getElementById('imbel_prod_codigo').value = '';
        document.getElementById('imbel_prod_qtd_inicial').value = '0';
        document.getElementById('imbel_prod_valor_unit') && (document.getElementById('imbel_prod_valor_unit').value = '');
        document.getElementById('imbel_prod_ponto_reposicao') && (document.getElementById('imbel_prod_ponto_reposicao').value = '');
        document.getElementById('imbel_prod_obs').value = '';
        const editField = document.getElementById('imbel_prod_edit_id'); if (editField) editField.value = '';
        document.getElementById('imbel_prod_salvar').textContent = 'Salvar';
        document.getElementById('imbel_prod_nome').focus();
        openImbelProdModal();
    };
    topActions.appendChild(btnAdd);
    const btnExport = document.createElement('button');
    btnExport.className = 'btn btn-outline';
    btnExport.innerHTML = '<span class="btn-icon">📊</span> Exportar Excel';
    btnExport.onclick = () => exportarMovimentacoesImbel();
    topActions.appendChild(btnExport);
    container.appendChild(topActions);

    // Tabela de produtos
    const wrap = document.createElement('div');
    wrap.style.cssText = 'overflow-x:auto;background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.08)';
    const tabela = document.createElement('table');
    tabela.style.cssText = 'width:100%;border-collapse:collapse;font-size:.85rem';
    tabela.innerHTML = `<thead><tr>
        <th style="${thStyle}">Nome</th>
        <th style="${thStyle}">Código</th>
        <th style="${thStyle}">Quantidade Inicial</th>
        <th style="${thStyle}">Valor Unit.</th>
        <th style="${thStyle}">Ponto Reposição</th>
        <th style="${thStyle}">Observação</th>
        <th style="${thStyle}">Ações</th>
    </tr></thead><tbody></tbody>`;
    const tbody = tabela.querySelector('tbody');
    (data.produtos||[]).forEach((p, idx) => {
        const tr = document.createElement('tr');
        tr.style.background = idx % 2 === 0 ? '#fff' : '#f7f9fc';
        tr.innerHTML = `
            <td style="${tdBase}">${p.nome}</td>
            <td style="${tdBase}">${p.codigo||'-'}</td>
            <td style="${tdBase};text-align:center">${(p.quantidadeInicial||p.quantidadeInicial===0)?p.quantidadeInicial:'-'}</td>
            <td style="${tdBase};text-align:right">${p.valorUnitario ? 'R$ ' + Number(p.valorUnitario).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'}</td>
            <td style="${tdBase};text-align:center">${(p.pontoReposicao!==undefined && p.pontoReposicao!==null) ? p.pontoReposicao : '—'}</td>
            <td style="${tdBase}">${p.observacao||'-'}</td>
            <td style="${tdBase}"><button class="btn btn-outline" data-editid="${p.id}" style="margin-right:6px">Editar</button><button class="btn btn-outline" data-id="${p.id}">Remover</button></td>`;
        tbody.appendChild(tr);
    });
    wrap.appendChild(tabela);
    container.appendChild(wrap);

    // handlers
    document.getElementById('imbel_prod_salvar').onclick = function() {
        const editIdField = document.getElementById('imbel_prod_edit_id');
        const editId = editIdField ? editIdField.value : '';
        const nome = document.getElementById('imbel_prod_nome').value.trim().toUpperCase();
        const codigo = document.getElementById('imbel_prod_codigo').value.trim().toUpperCase();
        const quantidadeInicial = parseInt(document.getElementById('imbel_prod_qtd_inicial').value) || 0;
        const valorUnitario = parseFloat(document.getElementById('imbel_prod_valor_unit')?.value) || 0;
        const pontoReposicao = parseInt(document.getElementById('imbel_prod_ponto_reposicao')?.value) || 0;
        const observacao = document.getElementById('imbel_prod_obs').value.trim().toUpperCase();
        if (!nome) { alert('Informe o nome do produto'); return; }
        data.produtos = data.produtos || [];
        if (editId) {
            const prod = data.produtos.find(p => p.id === editId);
            if (prod) {
                prod.nome = nome;
                prod.codigo = codigo;
                prod.observacao = observacao;
                prod.quantidadeInicial = quantidadeInicial;
                prod.valorUnitario = valorUnitario;
                prod.pontoReposicao = pontoReposicao;
                saveImbel(data);
                // reset edit state
                editIdField.value = '';
                document.getElementById('imbel_prod_salvar').textContent = 'Salvar';
                closeImbelProdModal();
                renderControleImbelCadastro();
                renderControleImbelEstoque();
                return;
            }
        }
        const novo = { id: 'p' + Date.now(), nome, codigo, observacao, quantidadeInicial, valorUnitario, pontoReposicao };
        data.produtos.push(novo);
        saveImbel(data);
        closeImbelProdModal();
        renderControleImbelCadastro();
    };

    tbody.querySelectorAll('button[data-id]').forEach(b => b.onclick = function(){
        const id = this.getAttribute('data-id');
        if (!confirm('Remover produto?')) return;
        data.produtos = (data.produtos||[]).filter(p => p.id !== id);
        // também remover movimentações relacionadas
        data.movimentacoes = (data.movimentacoes||[]).filter(m => m.produtoId !== id);
        saveImbel(data);
        renderControleImbelCadastro();
    });

    tbody.querySelectorAll('button[data-editid]').forEach(b => b.onclick = function(){
        const id = this.getAttribute('data-editid');
        const prod = (data.produtos||[]).find(p => p.id === id);
        if (!prod) return;
        // preencher formulário modal
        document.getElementById('imbel_prod_nome').value = prod.nome || '';
        document.getElementById('imbel_prod_codigo').value = prod.codigo || '';
        document.getElementById('imbel_prod_qtd_inicial').value = prod.quantidadeInicial || 0;
        document.getElementById('imbel_prod_valor_unit') && (document.getElementById('imbel_prod_valor_unit').value = (prod.valorUnitario !== undefined && prod.valorUnitario !== null) ? prod.valorUnitario : '');
        document.getElementById('imbel_prod_ponto_reposicao') && (document.getElementById('imbel_prod_ponto_reposicao').value = (prod.pontoReposicao !== undefined && prod.pontoReposicao !== null) ? prod.pontoReposicao : '');
        document.getElementById('imbel_prod_obs').value = prod.observacao || '';
        const editField = document.getElementById('imbel_prod_edit_id'); if (editField) editField.value = id;
        document.getElementById('imbel_prod_salvar').textContent = 'Atualizar';
        openImbelProdModal();
        document.getElementById('imbel_prod_nome').focus();
    });
}

function salvarPontoReposicaoImbel(prodId, valor) {
    try {
        const data = loadImbel();
        const prod = (data.produtos||[]).find(p => p.id === prodId);
        if (!prod) return;
        prod.pontoReposicao = parseInt(valor) || 0;
        saveImbel(data);
        mostrarNotificacao('Ponto de reposição atualizado.', 'success');
        renderControleImbelEstoque();
    } catch (e) { console.error('Erro ao salvar ponto de reposição:', e); }
}

// Toggle selecionar todos os checkboxes de movimentação IMBEL
// Toggle selecionar todos os checkboxes de movimentação IMBEL
function imbelToggleSelectAll(checked) {
        try {
        document.querySelectorAll('.imbel_table_chk_sel').forEach(cb => { cb.checked = !!checked; });
        } catch (e) { console.warn('imbelToggleSelectAll erro', e); }
}

// Alterna exibição de detalhes de uma movimentação (insere/remove linha de detalhe abaixo da linha)
function imbelToggleDetalhes(tr, m) {
    // Remove any existing detail row
    const existing = tr.nextSibling;
    if (existing && existing.classList && existing.classList.contains('imbel-detalhe-row')) {
        existing.remove();
        tr.style.filter = '';
        return;
    }
    // Remove all other open detail rows
    document.querySelectorAll('.imbel-detalhe-row').forEach(r => r.remove());
    document.querySelectorAll('[data-mov-id]').forEach(r => {
        r.style.filter = '';
    });

    tr.style.filter = 'brightness(0.96)';

    const cfg = getImbelTipo(m.tipo);
    const detRow = document.createElement('tr');
    detRow.className = 'imbel-detalhe-row';
    detRow.style.cssText =
        `background:${cfg.bg};border-bottom:2px solid ${cfg.cor}44`;

    const fields = [
        ['📍 Endereço',   m.endereco],
        ['📞 Telefone',   m.telefone],
        ['📧 E-mail',     m.email],
        ['📣 Evento',     m.evento],
        ['💬 Observações',m.observacoes],
        ['🏛️ FI',         m.fi],
        ['💳 Pagamento',  m.pagamento],
        ['🚚 Entregue',   m.entregue],
    ].filter(([, v]) => v && v.toString().trim());

    // montar lista de itens (se houver)
    let itemsHtml = '';
    try {
        const prodMap = {};
        (loadImbel().produtos || []).forEach(p => prodMap[p.id] = p.nome);
        if (m.items && (m.items||[]).length) {
            itemsHtml = '<div style="margin-bottom:8px"><strong>Itens:</strong>' +
                (m.items||[]).map(it => `<div style="margin-top:6px;color:#0f172a;font-size:0.9rem">• ${_escapeHtml(prodMap[it.produtoId]||it.produtoId)} — <strong>${(it.quantidade||0)}</strong> un — <span style="color:#16a34a">${it.valor?('R$ ' + Number(it.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})): '—'}</span></div>`).join('')
                + '</div>';
        }
    } catch(e) { itemsHtml = ''; }

    const content = (itemsHtml || '') + (fields.length
        ? fields.map(([label, val]) =>
                `<span style="margin-right:20px;font-size:0.82rem;color:#475569">
                     <strong style="color:#1e293b">${label}:</strong> ${_escapeHtml(val)}
                 </span>`
            ).join('')
        : '<span style="color:#94a3b8;font-size:0.82rem">Sem informações adicionais</span>');

    detRow.innerHTML = `
        <td colspan="11"
                style="padding:10px 16px 12px 52px;border-left:4px solid ${cfg.cor}">
            ${content}
        </td>`;

    tr.after(detRow);
}

function renderControleImbelMovimentacao() {
    const data = loadImbel();
    try { migrarProdutoNomeImbel(); } catch(e) {}
    const container = document.getElementById('controleImbelMovContainer');
    container.innerHTML = '';

    // ---- Botões de ação (Add Movimentação / Limpar Tabela) ----
    const topActions = document.createElement('div');
    topActions.style.cssText = 'display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap';
    
    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn btn-primary';
    btnAdd.innerHTML = '<span class="btn-icon">➕</span> Adicionar Movimentação';
    btnAdd.onclick = () => {
        // Limpar campos do modal (novo layout: dados do comprador + itens)
        try { document.getElementById('imbel_mov_tipo').value = 'VENDA'; } catch(e) {}
        const hoje = new Date().toISOString().slice(0,10);
        document.getElementById('imbel_mov_data').value = hoje;
        document.getElementById('imbel_mov_dest').value = '';
        document.getElementById('imbel_mov_cpf').value = '';
        document.getElementById('imbel_mov_endereco').value = '';
        document.getElementById('imbel_mov_tel').value = '';
        document.getElementById('imbel_mov_email').value = '';
        document.getElementById('imbel_mov_obs').value = '';
        const editField = document.getElementById('imbel_mov_edit_id'); if (editField) editField.value = '';
        document.getElementById('imbel_mov_salvar').textContent = 'Registrar Movimentação';
        try { clearImbelMovItensDOM(); } catch(e) {}
        try { adicionarItemMovImbel(); } catch(e) {}
        openImbelMovModal();
        document.getElementById('imbel_mov_dest').focus();
    };
    topActions.appendChild(btnAdd);
    
    const btnClearTable = document.createElement('button');
    btnClearTable.className = 'btn btn-outline';
    btnClearTable.innerHTML = '<span class="btn-icon">🧹</span> Limpar Tabela';
    btnClearTable.onclick = function(){
        if (!confirm('Deseja apagar TODAS as movimentações? Esta ação é irreversível.')) return;
        data.movimentacoes = [];
        saveImbel(data);
        mostrarNotificacao('Todas as movimentações foram removidas.', 'success');
        renderControleImbelMovimentacao();
        renderControleImbelEstoque();
        renderControleImbelCadastro();
    };
    topActions.appendChild(btnClearTable);

    const btnRelatorio = document.createElement('button');
    btnRelatorio.className = 'btn btn-primary';
    btnRelatorio.innerHTML = '<span class="btn-icon">📋</span> Gerar Relatório';
    btnRelatorio.onclick = () => gerarRelatorioVendasImbel();
    topActions.appendChild(btnRelatorio);

    container.appendChild(topActions);

    // ---- Filtros ----
    const filtrosWrap = document.createElement('div');
    filtrosWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px;align-items:center';
    filtrosWrap.innerHTML = `
        <select id="imbel_filter_prod" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:.85rem">
            <option value="">Todos os produtos</option>
        </select>
        <select id="imbel_filter_tipo" style="padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:.85rem">
            <option value="">Todos os tipos</option>
            <option value="ENTRADA">Entrada</option>
            <option value="SAIDA">Saída</option>
        </select>
        <label style="font-size:.8rem;color:#444">De</label>
        <input type="date" id="imbel_filter_date_start" style="padding:6px;border:1px solid #ddd;border-radius:6px" />
        <label style="font-size:.8rem;color:#444">Até</label>
        <input type="date" id="imbel_filter_date_end" style="padding:6px;border:1px solid #ddd;border-radius:6px" />
        <input type="text" id="imbel_filter_dest" placeholder="Destinatário" style="padding:6px;border:1px solid #ddd;border-radius:6px;min-width:160px" />
        <input type="text" id="imbel_filter_cpf" placeholder="CPF/CNPJ" style="padding:6px;border:1px solid #ddd;border-radius:6px;min-width:140px" />
        <label style="display:flex;align-items:center;gap:6px;margin-left:auto"><input type="checkbox" id="imbel_filter_pago"/> Somente pagos</label>
        <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="imbel_filter_entregue_only"/> Somente entregues</label>
        <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="imbel_filter_fi_only"/> Somente FI</label>
        <button id="imbel_filter_reset" class="btn btn-outline" style="padding:6px 10px">Limpar filtros</button>
    `;
    container.appendChild(filtrosWrap);

    // Popular select de tipos do modal com os tipos definidos em IMBEL_TIPOS
    try {
        const tipoSelect = document.getElementById('imbel_mov_tipo');
        if (tipoSelect) {
            tipoSelect.innerHTML = '';
            const optEmpty = document.createElement('option'); optEmpty.value = ''; optEmpty.textContent = '— selecione o tipo —'; tipoSelect.appendChild(optEmpty);
            // incluir opções 'ENTRADA'/'SAIDA' como categorias rápidas
            const optE = document.createElement('option'); optE.value = 'ENTRADA'; optE.textContent = 'Entrada (categoria)'; tipoSelect.appendChild(optE);
            const optS = document.createElement('option'); optS.value = 'SAIDA'; optS.textContent = 'Saída (categoria)'; tipoSelect.appendChild(optS);
            Object.keys(IMBEL_TIPOS).forEach(key => {
                const opt = document.createElement('option'); opt.value = key; opt.textContent = IMBEL_TIPOS[key].label || key; tipoSelect.appendChild(opt);
            });
        }
    } catch(e) { console.warn('Não foi possível popular select de tipos IMBEL', e); }

    // popular opções de produto no filtro
    const selFilterProd = filtrosWrap.querySelector('#imbel_filter_prod');
    (data.produtos||[]).forEach(p=>{
        const o = document.createElement('option'); o.value = p.id; o.textContent = p.nome; selFilterProd.appendChild(o);
    });
    // popular opções de tipo no filtro com categorias e tipos específicos
    try {
        const selTipoFilter = filtrosWrap.querySelector('#imbel_filter_tipo');
        if (selTipoFilter) {
            selTipoFilter.innerHTML = '';
            const oAll = document.createElement('option'); oAll.value = ''; oAll.textContent = 'Todos os tipos'; selTipoFilter.appendChild(oAll);
            const oE = document.createElement('option'); oE.value = 'ENTRADA'; oE.textContent = 'Entrada (categoria)'; selTipoFilter.appendChild(oE);
            const oS = document.createElement('option'); oS.value = 'SAIDA'; oS.textContent = 'Saída (categoria)'; selTipoFilter.appendChild(oS);
            Object.keys(IMBEL_TIPOS).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = IMBEL_TIPOS[k].label || k; selTipoFilter.appendChild(o); });
        }
    } catch(e) { console.warn('Não foi possível popular filtro de tipos IMBEL', e); }

    // ---- Tabela histórico ----
    const tabelaWrap = document.createElement('div');
    tabelaWrap.style.cssText = 'overflow-x:auto;background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.08)';

        const thStyle = 'padding:8px 10px;border:1px solid #ddd;background:#1e3a5f;color:#fff;font-size:.8rem;white-space:nowrap;text-align:center';
        const tabela = document.createElement('table');
        tabela.style.cssText = 'width:100%;border-collapse:collapse;font-size:.78rem';
                tabela.innerHTML = `<thead><tr>
        <th style="${thStyle};width:36px">
            <input type="checkbox" id="imbelSelectAll"
                         onchange="document.querySelectorAll('.imbel_table_chk_sel')
                             .forEach(c=>c.checked=this.checked)"
                         title="Selecionar todos">
        </th>
        <th style="${thStyle}">Destinatário</th>
        <th style="${thStyle}">Data</th>
        <th style="${thStyle}">Tipo</th>
        <th style="${thStyle}">Produto</th>
        <th style="${thStyle}">Qtd</th>
        <th style="${thStyle}">Valor</th>
        <th style="${thStyle};width:50px" title="Entregue">Entregue</th>
        <th style="${thStyle};width:50px" title="Pago">Pago</th>
        <th style="${thStyle};width:50px" title="FI">FI</th>
        <th style="${thStyle}">Ações</th>
    </tr></thead><tbody></tbody>`;

        const tbody = tabela.querySelector('tbody');
        const tdStyle = 'padding:6px 8px;border:1px solid #ddd;vertical-align:middle;white-space:normal;word-break:break-word;max-width:260px';
        const tdCenter = tdStyle + ';text-align:center';
        const tdBase = tdStyle + ';text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

        // função para popular tbody com filtros (agrupa por destinatário+data ou groupId)
        function populateTbody() {
            tbody.innerHTML = '';
            const all = (data.movimentacoes||[]).slice().reverse();

            // Apply filters
            const fProd  = (document.getElementById('imbel_filter_prod')||{}).value||'';
            const fTipo  = (document.getElementById('imbel_filter_tipo')||{}).value||'';
            const fStart = (document.getElementById('imbel_filter_date_start')||{}).value||'';
            const fEnd   = (document.getElementById('imbel_filter_date_end')||{}).value||'';
            const fDest  = ((document.getElementById('imbel_filter_dest')||{}).value||'')
                .trim().toUpperCase();
            const fCpf   = ((document.getElementById('imbel_filter_cpf')||{}).value||'')
                .trim().toUpperCase();
            const fPago  = document.getElementById('imbel_filter_pago')?.checked;
            const fFi    = document.getElementById('imbel_filter_fi_only')?.checked;

            const filtered = all.filter(m => {
                if (fProd && m.produtoId !== fProd) return false;
                if (fTipo && (m.tipo||'').toUpperCase() !== fTipo.toUpperCase()) return false;
                if (fStart && (m.data||'') < fStart) return false;
                if (fEnd   && (m.data||'') > fEnd)   return false;
                if (fDest  && !(m.destinatario||'').toUpperCase().includes(fDest)) return false;
                if (fCpf   && !(m.cpfCnpj||'').replace(/\D/g,'').includes(fCpf.replace(/\D/g,''))) return false;
                if (fPago  && (m.pagamento||'').toUpperCase() !== 'SIM') return false;
                if (fFi    && (m.fi||'').toUpperCase() !== 'SIM') return false;
                return true;
            });

            // Group by groupId OR by destinatario+data (for old records)
            const groups = new Map();
            filtered.forEach(m => {
                const key = m.groupId || (m.destinatario||'') + '||' + (m.data||'') + '||' + m.tipo;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(m);
            });

            const fmt = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR',
                {minimumFractionDigits:2});
            let globalIdx = 0;

            groups.forEach((itens, key) => {
                const first   = itens[0];
                const cfg     = getImbelTipo(first.tipo);
                const dataFmt = first.data
                    ? new Date(first.data + 'T12:00:00').toLocaleDateString('pt-BR')
                    : '—';
                const totalQtd = itens.reduce((s,m) => s+(Number(m.quantidade)||0), 0);
                const totalVal = itens.reduce((s,m) => s+(Number(m.valor)||0), 0);
                const isFI     = itens.every(m => (m.fi||'').toUpperCase() === 'SIM');
                const isPago   = itens.every(m => (m.pagamento||'').toUpperCase() === 'SIM');
                const isEntregue = itens.every(m => (m.entregue||'').toUpperCase() === 'SIM');
                const groupKey = 'grp_' + globalIdx++;
                const isEven   = globalIdx % 2 === 0;

                // ── GROUP HEADER ROW ──
                const trGroup = document.createElement('tr');
                trGroup.dataset.groupKey = groupKey;
                trGroup.style.cssText =
                    `background:${isEven?'#f8fafc':'#fff'};` +
                    `border-bottom:1px solid #e2e8f0;cursor:pointer;` +
                    `font-weight:600`;
                trGroup.title = 'Clique para ver os produtos';

                                // resumo de produtos do grupo
                                const produtosUnicos = [...new Set((itens||[]).map(m => m.produtoId))];
                                const temMultiplosProdutos = produtosUnicos.length > 1;
                                const cfgSafe = (typeof getImbelTipo === 'function') ? getImbelTipo(first.tipo) : { label: first.tipo||'—', cor:'#64748b', bg:'#f8fafc', icon:'' };

                                // nome do produto (quando todos os itens forem do mesmo produto)
                                const prodNome = itens[0]?.produtoNome
                                    || (data.produtos||[]).find(p => p.id === itens[0]?.produtoId)?.nome
                                    || '—';

                                const produtoCell = temMultiplosProdutos
                                    ? `<td style="${tdBase};color:#1d4ed8;font-weight:600;cursor:pointer" onclick="imbelToggleGrupo('${groupKey}',event)">
                                         <span data-expand-ind>▸</span> ${itens.length} produto(s)
                                       </td>`
                                    : `<td style="${tdBase};font-weight:500">${prodNome}</td>`;

                                const entCell = `<td style="${tdCenter}">
                                    <input type="checkbox" class="imbel_table_chk_ent"
                                                 data-ids="${itens.map(m=>m.id).join(',')}"
                                                 ${isEntregue?'checked':''}
                                                 onchange="imbelSetGrupoField(this,'entregue')"
                                                 onclick="event.stopPropagation()"
                                                 style="width:16px;height:16px;cursor:pointer;accent-color:#16a34a"
                                                 title="Entregue">
                                </td>`;

                                const pagCell = `<td style="${tdCenter}">
                                    <input type="checkbox" class="imbel_table_chk_pag"
                                                 data-ids="${itens.map(m=>m.id).join(',')}"
                                                 ${isPago?'checked':''}
                                                 onchange="imbelSetGrupoField(this,'pagamento')"
                                                 onclick="event.stopPropagation()"
                                                 style="width:16px;height:16px;cursor:pointer;accent-color:#16a34a"
                                                 title="Pago">
                                </td>`;

                                const fiCell = `<td style="${tdCenter}">
                                    <input type="checkbox" class="imbel_table_chk_fi"
                                                 data-ids="${itens.map(m=>m.id).join(',')}"
                                                 ${isFI?'checked':''}
                                                 onchange="imbelSetGrupoField(this,'fi')"
                                                 onclick="event.stopPropagation()"
                                                 style="width:16px;height:16px;cursor:pointer;accent-color:#1e3a5f"
                                                 title="FI">
                                </td>`;

                                trGroup.innerHTML = `
        <td style="${tdCenter};width:36px" onclick="event.stopPropagation()">
            <input type="checkbox" class="imbel_table_chk_sel"
                         data-ids="${itens.map(m=>m.id).join(',')}"
                         style="width:15px;height:15px;cursor:pointer">
        </td>
        <td style="${tdStyle};font-weight:600;color:#1e293b">
            ${first.destinatario || '<span style="color:#94a3b8">—</span>'}
            ${first.cpfCnpj ? `<div style="font-size:0.72rem;color:#94a3b8;font-weight:400;margin-top:1px">${first.cpfCnpj}</div>` : ''}
        </td>
        <td style="${tdCenter};white-space:nowrap;font-size:0.82rem;color:#475569">
            ${dataFmt}
        </td>
        <td style="${tdCenter}">
            <span style="background:${cfgSafe.bg||'#f8fafc'};color:${cfgSafe.cor||'#64748b'};padding:2px 8px;border-radius:20px;font-size:0.75rem;font-weight:700;white-space:nowrap">
                ${cfgSafe.icon||''} ${cfgSafe.label||first.tipo||'—'}
            </span>
        </td>
        ${produtoCell}
        <td style="${tdCenter};font-weight:700">${totalQtd}</td>
        <td style="${tdCenter};font-weight:700;color:#16a34a">${fmt(totalVal)}</td>
        ${entCell}
        ${pagCell}
        ${fiCell}
        <td style="${tdCenter}">
            <button class="btn btn-outline" style="padding:3px 8px;font-size:.75rem;margin-right:4px" data-editmov="${itens[0].id}" data-editid="${itens[0].id}" title="Editar">✎</button>
            <button class="btn btn-outline" style="padding:3px 8px;font-size:.75rem;color:#dc2626;border-color:#fca5a5" data-delid="${itens[0].id}" title="Excluir">🗑️</button>
        </td>`;

                                // Click no cabeçalho do grupo: toggle apenas a linha de detalhes (CPF/contato/endereço/obs)
                                trGroup.style.cursor = 'pointer';
                                trGroup.addEventListener('click', function(e){
                                    if (e.target.closest('input,button,[onclick]')) return;
                                    const detailRow = document.querySelector(`[data-group-detail="${groupKey}"]`);
                                    if (!detailRow) return;
                                    const isOpen = detailRow.style.display !== 'none';
                                    // fechar outras linhas de detalhe
                                    document.querySelectorAll('[data-group-detail]').forEach(r => { if (r.dataset.groupDetail !== groupKey) r.style.display = 'none'; });
                                    detailRow.style.display = isOpen ? 'none' : '';
                                });
                tbody.appendChild(trGroup);

                // ── PRODUCT DETAIL ROWS (hidden by default) ──
                if (temMultiplosProdutos) {
                    itens.forEach(m => {
                        const pNome = m.produtoNome
                            || (data.produtos||[]).find(p=>p.id===m.produtoId)?.nome
                            || '—';
                        const trItem = document.createElement('tr');
                        trItem.dataset.groupChild = groupKey;
                        trItem.style.cssText =
                            'display:none;background:#f0f9ff;' +
                            'border-bottom:1px solid #e2e8f0;font-size:0.85rem';
                        trItem.innerHTML = `
                    <td style="${tdCenter}"></td>
                    <td colspan="2" style="${tdBase};padding-left:32px;\n                                    color:#64748b;font-size:0.8rem">
                      └
                    </td>
                    <td></td>
                    <td style="${tdBase};font-weight:500;color:#1e293b">${pNome}</td>
                    <td style="${tdCenter};font-weight:600">${m.quantidade||0}</td>
                    <td style="${tdCenter};font-weight:600;color:#16a34a">R$ ${Number(m.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                    <td colspan="4"></td>`;
                        tbody.appendChild(trItem);
                    });
                }

                // ── DETAIL EXPAND ROW (person info) ──
                const trDetail = document.createElement('tr');
                trDetail.dataset.groupDetail = groupKey;
                trDetail.style.display = 'none';

                const campos = [
                    first.cpfCnpj    ? `🪪 <strong>CPF/CNPJ:</strong> ${first.cpfCnpj}` : null,
                    first.telefone   ? `📞 ${first.telefone}` : null,
                    first.email      ? `📧 ${first.email}` : null,
                    first.endereco   ? `📍 ${first.endereco}` : null,
                    first.evento     ? `📣 ${first.evento}` : null,
                    first.observacoes? `💬 ${first.observacoes}` : null,
                ].filter(Boolean);

                trDetail.innerHTML = `
            <td colspan="11"
                    style="padding:10px 12px 10px 52px;background:#f8fafc;\n                           border-left:4px solid #1e3a5f;border-bottom:1px solid #e2e8f0;\n                           font-size:0.82rem">
                ${campos.length
                    ? campos.map(c => `<span style="margin-right:24px;color:#475569">${c}</span>`).join('')
                    : '<span style="color:#94a3b8">Sem informações adicionais</span>'}
            </td>`;
                tbody.appendChild(trDetail);
            });

                // rebind handlers for edit/delete buttons generated in the table
                tbody.querySelectorAll('button[data-delid]').forEach(btn => {
                    btn.onclick = function(){
                        const id = this.getAttribute('data-delid');
                        if (!confirm('Excluir esta movimentação?')) return;
                        data.movimentacoes = (data.movimentacoes||[]).filter(m => m.id !== id);
                        saveImbel(data);
                        mostrarNotificacao('Movimentação excluída.', 'success');
                        populateTbody();
                        renderControleImbelEstoque();
                    };
                });

                tbody.querySelectorAll('button[data-editmov], button[data-editid]').forEach(btn => {
                    btn.onclick = function(){
                        const id = this.getAttribute('data-editmov') || this.getAttribute('data-editid');
                        const mov = (data.movimentacoes||[]).find(m => m.id === id);
                        if (!mov) return;
                        const hoje = new Date().toISOString().slice(0,10);
                        const tipoLower = (mov.tipo||'').toString().toLowerCase();
                        if (tipoLower === 'entrada') document.getElementById('imbel_mov_tipo').value = 'ENTRADA';
                        else if (tipoLower === 'saída' || tipoLower === 'saida') document.getElementById('imbel_mov_tipo').value = 'SAIDA';
                        else document.getElementById('imbel_mov_tipo').value = mov.tipo || 'VENDA';
                        document.getElementById('imbel_mov_data').value = mov.data || hoje;
                        document.getElementById('imbel_mov_dest').value = mov.destinatario || '';
                        document.getElementById('imbel_mov_cpf').value = formatCpfCnpjMask(mov.cpfCnpj || '');
                        document.getElementById('imbel_mov_endereco').value = mov.endereco || '';
                        document.getElementById('imbel_mov_tel').value = formatPhoneMask(mov.telefone || '');
                        document.getElementById('imbel_mov_email').value = mov.email || '';
                        document.getElementById('imbel_mov_obs').value = mov.observacoes || '';
                        // popular lista de itens (suporta registros antigos com produtoId/quantidade)
                        try {
                            if (mov.items && (mov.items||[]).length) {
                                renderImbelMovItensDOM(mov.items);
                            } else if (mov.produtoId) {
                                renderImbelMovItensDOM([{ produtoId: mov.produtoId, quantidade: mov.quantidade || 1, valor: Number(mov.valor) || 0 }]);
                            } else {
                                renderImbelMovItensDOM([]);
                            }
                            // focar primeiro select de item, se houver
                            setTimeout(() => {
                                const wrap = document.getElementById('imbel_mov_itens') || document.getElementById('imbel_mov_itens_container');
                                if (wrap) {
                                    const firstSel = wrap.querySelector('.imbel_mov_item_prod');
                                    if (firstSel) firstSel.focus();
                                }
                            }, 10);
                        } catch(e) { console.warn('Erro ao popular itens no modal', e); }
                        const editField = document.getElementById('imbel_mov_edit_id'); if (editField) editField.value = id;
                        document.getElementById('imbel_mov_salvar').textContent = 'Atualizar Movimentação';
                        openImbelMovModal();
                        document.getElementById('imbel_mov_dest').focus();
                    };
                });

            // Update summary
            atualizarResumoMovimentacoes();
        }

        // Funções públicas para manipular grupos (tornadas globais)
        window.imbelToggleGrupo = function(groupKey, event) {
            if (event) try { event.stopPropagation(); } catch(e) {}

            const children = document.querySelectorAll(
                `[data-group-child="${groupKey}"],
                 [data-group-detail="${groupKey}"]`
            );

            const isOpen = children.length > 0 && children[0].style.display !== 'none';

            if (isOpen) {
                // Close all
                children.forEach(r => { r.style.display = 'none'; });
                const indEl = document.querySelector(`[data-group-key="${groupKey}"] [data-expand-ind]`);
                if (indEl) indEl.textContent = '▸';
            } else {
                // Open all
                children.forEach(r => { r.style.display = ''; });
                const indEl = document.querySelector(`[data-group-key="${groupKey}"] [data-expand-ind]`);
                if (indEl) indEl.textContent = '▾';
            }
        };

        window.imbelSetGrupoField = function(checkbox, field) {
            const ids  = (checkbox.dataset.ids||'').split(',').filter(Boolean);
            const val  = checkbox.checked ? 'SIM' : 'NÃO';
            const data = loadImbel();
            ids.forEach(id => {
                const mov = (data.movimentacoes||[]).find(m => m.id === id);
                if (mov) mov[field] = val;
            });
            saveImbel(data);
        };

        window.imbelExcluirGrupo = function(key) {
            const data = loadImbel();
            const grupoMovs = (data.movimentacoes||[]).filter(m =>
                (m.groupId === key) ||
                ((m.destinatario||'') + '||' + (m.data||'') + '||' + m.tipo) === key
            );
            if (!grupoMovs.length) return;
            if (!confirm(`Excluir esta movimentação (${grupoMovs.length} item(ns))?`)) return;
            const ids = grupoMovs.map(m => m.id);
            data.movimentacoes = (data.movimentacoes||[]).filter(m => !ids.includes(m.id));
            saveImbel(data);
            renderControleImbelMovimentacao();
            renderControleImbelDashboard();
            mostrarNotificacao('Movimentação excluída.', 'warning');
        };

    // conectar eventos dos filtros
    ['imbel_filter_prod','imbel_filter_tipo','imbel_filter_date_start','imbel_filter_date_end','imbel_filter_dest','imbel_filter_cpf','imbel_filter_pago','imbel_filter_entregue_only','imbel_filter_fi_only'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', function(){ populateTbody(); try{ atualizarResumoMovimentacoes(); }catch(e){} });
        if (el && el.addEventListener && el.tagName === 'INPUT') el.addEventListener('input', function(){ populateTbody(); try{ atualizarResumoMovimentacoes(); }catch(e){} });
    });
    const btnResetFiltros = document.getElementById('imbel_filter_reset'); if (btnResetFiltros) btnResetFiltros.onclick = function(){
        document.getElementById('imbel_filter_prod').value = '';
        document.getElementById('imbel_filter_tipo').value = '';
        document.getElementById('imbel_filter_date_start').value = '';
        document.getElementById('imbel_filter_date_end').value = '';
        document.getElementById('imbel_filter_dest').value = '';
        document.getElementById('imbel_filter_cpf').value = '';
        document.getElementById('imbel_filter_pago').checked = false;
        document.getElementById('imbel_filter_entregue_only').checked = false;
        document.getElementById('imbel_filter_fi_only').checked = false;
        populateTbody();
    };

    // preencher tabela inicialmente
    populateTbody();

        // Barra de resumo (entradas / saídas / valor)
        const resumoBar = document.createElement('div');
        resumoBar.id = 'imbelMovResumo';
        resumoBar.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding:8px 0';
        container.appendChild(resumoBar);

        function atualizarResumoMovimentacoes() {
                const all = (data.movimentacoes||[]).slice().reverse();
                const fProd  = (document.getElementById('imbel_filter_prod')||{value:''}).value;
                const fTipo  = (document.getElementById('imbel_filter_tipo')||{value:''}).value;
                const fStart = (document.getElementById('imbel_filter_date_start')||{value:''}).value;
                const fEnd   = (document.getElementById('imbel_filter_date_end')||{value:''}).value;

                const filtered = all.filter(m => {
                    if (fProd && String(m.produtoId) !== String(fProd)) return false;
                    if (fTipo) {
                        const fTipoU = (fTipo||'').toString().toUpperCase();
                        if (fTipoU === 'ENTRADA') {
                            if (!imbelTipoAumentaEstoque(m.tipo)) return false;
                        } else if (fTipoU === 'SAIDA' || fTipoU === 'SAÍDA') {
                            if (imbelTipoAumentaEstoque(m.tipo)) return false;
                        } else {
                            if ((m.tipo||'').toString().toUpperCase() !== fTipoU) return false;
                        }
                    }
                    if (fStart && (m.data||'') < fStart) return false;
                    if (fEnd   && (m.data||'') > fEnd)   return false;
                    return true;
                });

                const totalEntradas = filtered
                    .filter(m => imbelTipoAumentaEstoque(m.tipo))
                    .reduce((s,m) => s + (Number(m.quantidade)||0), 0);
                const totalSaidas = filtered
                    .filter(m => !imbelTipoAumentaEstoque(m.tipo))
                    .reduce((s,m) => s + (Number(m.quantidade)||0), 0);
                const totalValor = filtered
                    .reduce((s,m) => s + (Number(m.valor)||0), 0);

                const resumoEl = document.getElementById('imbelMovResumo');
                if (resumoEl) {
                    resumoEl.innerHTML = `
                        <span style="background:#f0fdf4;color:#16a34a;padding:4px 12px;border-radius:20px;font-weight:700;font-size:0.82rem">📥 Entradas: ${totalEntradas}</span>
                        <span style="background:#fef2f2;color:#dc2626;padding:4px 12px;border-radius:20px;font-weight:700;font-size:0.82rem">📤 Saídas: ${totalSaidas}</span>
                        <span style="background:#f0f9ff;color:#0369a1;padding:4px 12px;border-radius:20px;font-weight:700;font-size:0.82rem">💰 Valor: R$ ${totalValor.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
                        <span style="color:#64748b;font-size:0.78rem">${filtered.length} registro(s)</span>`;
                }
        }

        // Chamada inicial do resumo
        try { atualizarResumoMovimentacoes(); } catch(e) {}

    // Preencher select de produtos do modal (se houver produtos)
    const selec = document.getElementById('imbel_mov_prod');
    if (selec) {
        selec.innerHTML = '<option value="">— selecione o produto —</option>';
        (data.produtos||[]).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nome + (p.codigo ? ' ('+p.codigo+')' : '');
            selec.appendChild(opt);
        });
    }
    // Inicializar container de itens e botões de adicionar/limpar
    try {
        renderImbelMovItensDOM([]);
        const btnAddItem = document.getElementById('imbel_mov_add_item');
        if (btnAddItem) btnAddItem.onclick = function(e){ e.preventDefault(); addImbelMovItemFromFields(); };
        const btnClearItems = document.getElementById('imbel_mov_clear_items');
        if (btnClearItems) btnClearItems.onclick = function(e){ e.preventDefault(); clearImbelMovItensDOM(); };
    } catch(e) { console.warn('Erro inicializando itens modal IMBEL', e); }

    bindImbelMovInputMasks();

    tabelaWrap.appendChild(tabela);
    container.appendChild(tabelaWrap);

    // ---- Handler: Salvar (no modal) ----
    document.getElementById('imbel_mov_salvar').onclick = function(){
        const hoje = new Date().toISOString().slice(0,10);
        const tipoKey = document.getElementById('imbel_mov_tipo').value;
        const cfg = getImbelTipo(tipoKey);
        const dataStr = document.getElementById('imbel_mov_data').value || hoje;
        const destinatario = document.getElementById('imbel_mov_dest').value.trim();
        const cpfCnpj = document.getElementById('imbel_mov_cpf').value.trim();
        const evento = (document.getElementById('imbel_mov_evento')||{value:''}).value.trim() || '';
        const endereco = document.getElementById('imbel_mov_endereco').value.trim();
        const telefone = document.getElementById('imbel_mov_tel').value.trim();
        const email = document.getElementById('imbel_mov_email').value.trim();
        const obs = document.getElementById('imbel_mov_obs').value.trim();
        const editId = (document.getElementById('imbel_mov_edit_id') || {value:''}).value || '';

        // coletar itens da modal (agora obrigatório)
        const items = collectImbelMovItensFromDOM();
        if (!items || !items.length) { mostrarNotificacao('Adicione ao menos um item à movimentação.', 'warning'); return; }
        // garantir que cada item traga `produtoNome` (migrar para novo formato local)
        (items||[]).forEach(it => {
            try {
                const prod = (data.produtos||[]).find(p => p.id === it.produtoId);
                it.produtoNome = it.produtoNome || prod?.nome || '';
            } catch(e) {}
        });
        let totalQuantidade = items.reduce((s,it) => s + (Number(it.quantidade)||0), 0);
        let totalValor = items.reduce((s,it) => s + (Number(it.valor)||0), 0);

        // validações
        if ((!items || !items.length) && !produtoId) { mostrarNotificacao('Selecione um produto.', 'warning'); return; }
        if ((!items || !items.length) && quantidade <= 0) { mostrarNotificacao('Informe uma quantidade válida.', 'warning'); return; }
        if ((items && items.length) && items.some(it => (Number(it.quantidade)||0) <= 0)) { mostrarNotificacao('Itens com quantidade inválida.', 'warning'); return; }

        // Bloquear saída se saldo insuficiente (usa categoria dos tipos)
        if (!imbelTipoAumentaEstoque(tipoKey)) {
            const saldos = {};
            // Calcular saldos a partir das movimentações existentes, ignorando a movimentação que está sendo editada
            (data.movimentacoes||[]).forEach(m2 => {
                try {
                    if (editId && m2.id === editId) return; // não contar a movimentação atual em edição
                    if (m2.items && (m2.items||[]).length) {
                        m2.items.forEach(it => {
                            const q = Number(it.quantidade)||0;
                            const s = imbelTipoAumentaEstoque(m2.tipo) ? 1 : -1;
                            saldos[it.produtoId] = (saldos[it.produtoId]||0) + s * q;
                        });
                    } else {
                        const q = Number(m2.quantidade)||0;
                        const s = imbelTipoAumentaEstoque(m2.tipo) ? 1 : -1;
                        saldos[m2.produtoId] = (saldos[m2.produtoId]||0) + s * q;
                    }
                } catch(e) { /* ignore malformed movimentacao */ }
            });
            // Somar quantidades solicitadas por produto (caso haja múltiplas linhas para o mesmo produto)
            const solicitados = {};
            for (const it of items) {
                const pid = it.produtoId;
                solicitados[pid] = (solicitados[pid]||0) + (Number(it.quantidade)||0);
            }
            for (const pid in solicitados) {
                const req = solicitados[pid] || 0;
                const saldoAtual = saldos[pid] || 0;
                if (req > saldoAtual) {
                    mostrarNotificacao(`Saldo insuficiente para ${pid}. Saldo atual: ${saldoAtual} un.`, 'error');
                    return;
                }
            }
        }

        data.movimentacoes = data.movimentacoes || [];
        if (editId) {
            const mov = data.movimentacoes.find(m => m.id === editId);
            if (mov) {
                // sempre gravar itens (novo formato). Para compatibilidade, manter produtoId/quantidade/valor agregados
                mov.items = items;
                mov.produtoId = (items && items.length) ? items[0].produtoId : (mov.produtoId||'');
                try {
                    const prod = (data.produtos||[]).find(p => p.id === mov.produtoId);
                    mov.produtoNome = prod?.nome || (mov.produtoNome || '');
                } catch(e) {}
                mov.quantidade = totalQuantidade;
                mov.valor = totalValor;
                mov.tipo = (tipoKey||'').toString();
                mov.tipoLabel = cfg.label || mov.tipoLabel;
                mov.categoria = cfg.categoria || mov.categoria;
                mov.contaReceita = cfg.contaReceita || mov.contaReceita;
                mov.data = dataStr;
                mov.destinatario = (destinatario||'').toUpperCase();
                mov.cpfCnpj = (cpfCnpj||'').toUpperCase();
                mov.evento = evento;
                mov.endereco = (endereco||'').toUpperCase();
                mov.telefone = (telefone||'').toUpperCase();
                mov.email = (email||'').toUpperCase();
                // preserve existing pagamento/entregue/fi values (these are edited via table checkboxes)
                mov.observacoes = (obs||'').toUpperCase();
                saveImbel(data);
                mostrarNotificacao('Movimentação atualizada!', 'success');
                // reset edit state
                const editField = document.getElementById('imbel_mov_edit_id'); if (editField) editField.value = '';
                document.getElementById('imbel_mov_salvar').textContent = 'Registrar Movimentação';
                closeImbelMovModal();
                renderControleImbelMovimentacao();
                renderControleImbelEstoque();
                return;
            }
        }

        // Criar novo registro (suporta items)
        const novo = {
            id: 'm' + Date.now(), tipo: (tipoKey||'').toString(), tipoLabel: cfg.label || '', categoria: cfg.categoria || '', contaReceita: cfg.contaReceita || false,
            data: dataStr,
            destinatario: (destinatario||'').toUpperCase(), cpfCnpj: (cpfCnpj||'').toUpperCase(), evento: evento || '', pagamento: 'NÃO', endereco: (endereco||'').toUpperCase(),
            telefone: (telefone||'').toUpperCase(), email: (email||'').toUpperCase(), entregue: 'NÃO', fi: 'NÃO', observacoes: (obs||'').toUpperCase()
        };
        // gravar sempre em novo formato (itens), preencher agregados para compatibilidade
        novo.items = items;
        novo.produtoId = (items && items.length) ? items[0].produtoId : '';
        try {
            const prodNew = (data.produtos||[]).find(p => p.id === novo.produtoId);
            novo.produtoNome = prodNew?.nome || '';
        } catch(e) { novo.produtoNome = '' }
        novo.quantidade = totalQuantidade;
        novo.valor = totalValor;
        data.movimentacoes.push(novo);
        saveImbel(data);
        mostrarNotificacao('Movimentação registrada!', 'success');
        closeImbelMovModal();
        renderControleImbelMovimentacao();
        renderControleImbelEstoque();
    };
}

// Inicializar controle IMBEL (não altera outros dados)
try { initControleImbel(); } catch(e) {}

// Exportar movimentações IMBEL para Excel
function exportarMovimentacoesImbel() {
    try {
        const data = loadImbel();
        const movs = (data.movimentacoes || []).slice().reverse();
        if (!movs.length) { mostrarNotificacao('Nenhuma movimentação para exportar.', 'warning'); return; }

        const prodMap = {};
        (data.produtos||[]).forEach(p => { prodMap[p.id] = p.nome; });

        const rows = movs.map(m => {
            const produtoDesc = (m.items && (m.items||[]).length)
                ? (m.items||[]).map(it => prodMap[it.produtoId] || it.produtoId).join(' | ')
                : (prodMap[m.produtoId] || m.produtoId || '');
            const quantidade = (m.items && (m.items||[]).length)
                ? (m.items||[]).reduce((s,it) => s + (Number(it.quantidade)||0), 0)
                : Number(m.quantidade) || 0;
            const valor = (m.items && (m.items||[]).length)
                ? (m.items||[]).reduce((s,it) => s + (Number(it.valor)||0), 0)
                : Number(m.valor) || 0;
            return {
                'Data':          m.data ? new Date(m.data).toLocaleDateString('pt-BR') : '',
                'Produto':       produtoDesc,
                'Tipo':          m.tipo || '',
                'Quantidade':    quantidade,
                'Destinatário':  m.destinatario || '',
                'CPF/CNPJ':      m.cpfCnpj     || '',
                'Valor (R$)':    valor,
                'Pagamento':     m.pagamento    || '',
                'Entregue':      m.entregue     || '',
                'FI':            m.fi           || '',
                'Endereço':      m.endereco     || '',
                'Telefone':      m.telefone     || '',
                'E-mail':        m.email        || '',
                'Observações':   m.observacoes  || ''
            };
        });

        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [
            {wch:12},{wch:30},{wch:10},{wch:10},{wch:30},{wch:18},
            {wch:14},{wch:12},{wch:10},{wch:8},
            {wch:35},{wch:16},{wch:30},{wch:40}
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Movimentações IMBEL');
        XLSX.writeFile(wb, 'imbel_movimentacoes_' + new Date().toISOString().split('T')[0] + '.xlsx');
        mostrarNotificacao(`${rows.length} movimentação(ões) exportada(s)!`, 'success');
    } catch(e) {
        console.error('Erro exportarMovimentacoesImbel', e);
        mostrarNotificacao('Erro ao exportar.', 'error');
    }
}

// Abre a sub-aba de Cadastro e preenche o formulário para editar o produto indicado
function editarProdutoPorId(id) {
    try {
        const data = loadImbel();
        const prod = (data.produtos||[]).find(p => p.id === id);
        if (!prod) { mostrarNotificacao('Produto não encontrado para edição.', 'error'); return; }
        // Preencher modal
        document.getElementById('imbel_prod_nome').value = prod.nome || '';
        document.getElementById('imbel_prod_codigo').value = prod.codigo || '';
        document.getElementById('imbel_prod_qtd_inicial').value = prod.quantidadeInicial || 0;
        document.getElementById('imbel_prod_obs').value = prod.observacao || '';
        const editField = document.getElementById('imbel_prod_edit_id'); if (editField) editField.value = id;
        document.getElementById('imbel_prod_salvar').textContent = 'Atualizar';
        openImbelProdModal();
        document.getElementById('imbel_prod_nome').focus();
    } catch (e) {
        console.error('editarProdutoPorId erro:', e);
    }
}

// ========================================
// EXPORTAR / IMPORTAR IMBEL (Produtos + Saldos)
// ========================================

function exportarImbel() {
    const sep = ';';
    const data = loadImbel();
    const produtos = data.produtos || [];
    const movimentacoes = data.movimentacoes || [];

    // Calcular entradas/saidas por produto
    const totE = {};
    const totS = {};
    movimentacoes.forEach(m => {
        if (!m.produtoId) return;
        const q = Number(m.quantidade) || 0;
        if (imbelTipoAumentaEstoque(m.tipo)) totE[m.produtoId] = (totE[m.produtoId]||0) + q;
        else totS[m.produtoId] = (totS[m.produtoId]||0) + q;
    });

    let csv = `ID${sep}DESCRICAO${sep}OBSERVACAO${sep}QUANTIDADE_INICIAL${sep}ENTRADA${sep}SAIDA${sep}ESTOQUE_ATUAL\n`;
    produtos.forEach(p => {
        const entrada = totE[p.id] || 0;
        const saida = totS[p.id] || 0;
        const inicial = Number(p.quantidadeInicial) || 0;
        const saldo = inicial + entrada - saida;
        const linha = `${p.id || ''}${sep}${(p.nome||'').toString().replace(/\n/g,' ')}${sep}${(p.observacao||p.codigo||'').toString().replace(/\n/g,' ')}${sep}${inicial}${sep}${entrada}${sep}${saida}${sep}${saldo}`;
        csv += linha + '\n';
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const dataAtual = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `imbel_estoque_${dataAtual}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    mostrarNotificacao('IMBEL exportado com sucesso!', 'success');
}

function importarImbel(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const conteudo = e.target.result;
            const linhas = conteudo.split(/\r?\n/).filter(l => l.trim());
            if (linhas.length < 2) { mostrarNotificacao('Arquivo vazio ou sem dados!', 'error'); return; }

            const data = loadImbel();
            data.produtos = data.produtos || [];
            data.movimentacoes = data.movimentacoes || [];

            let importados = 0;
            let erros = [];

            for (let i = 1; i < linhas.length; i++) {
                const linha = linhas[i].trim();
                if (!linha) continue;
                const col = parseCsvLinha(linha);
                // Espera colunas: ID;DESCRICAO;OBSERVACAO;ENTRADA;SAIDA;ESTOQUE_ATUAL
                if (col.length < 3) { erros.push(`Linha ${i+1}: formato inválido`); continue; }

                const descricao = (col[1]||'').trim().toUpperCase();
                if (!descricao) { erros.push(`Linha ${i+1}: descrição vazia`); continue; }

                const observacao = (col[2]||'').trim().toUpperCase();
                const quantidadeInicial = parseInt((col[3]||'').replace(/[^0-9-]/g,'')) || 0;
                const entrada = parseInt((col[4]||'').replace(/[^0-9-]/g,'')) || 0;
                const saida = parseInt((col[5]||'').replace(/[^0-9-]/g,'')) || 0;

                // Verificar se produto já existe (por nome)
                let produto = data.produtos.find(p => (p.nome||'').toString().toUpperCase() === descricao);
                if (!produto) {
                    produto = { id: 'p' + Date.now() + i, nome: descricao, codigo: '', observacao, quantidadeInicial };
                    data.produtos.push(produto);
                } else {
                    // atualizar observacao se houver
                    produto.observacao = produto.observacao || observacao;
                    produto.quantidadeInicial = produto.quantidadeInicial || quantidadeInicial;
                }

                // Criar movimentações de entrada/saida somando valores (se informados)
                const hoje = new Date().toISOString().split('T')[0];
                if (entrada > 0) {
                    data.movimentacoes.push({ id: 'm' + Date.now() + i, produtoId: produto.id, tipo: 'ENTRADA', quantidade: entrada, data: hoje, destinatario: '', cpfCnpj: '', valor: 0, pagamento: '', endereco: '', telefone: '', email: '', entregue: 'NÃO', fi: '', observacoes: 'Importado - Entrada' });
                }
                if (saida > 0) {
                    data.movimentacoes.push({ id: 'm' + Date.now() + i + 1000, produtoId: produto.id, tipo: 'SAÍDA', quantidade: saida, data: hoje, destinatario: '', cpfCnpj: '', valor: 0, pagamento: '', endereco: '', telefone: '', email: '', entregue: 'NÃO', fi: '', observacoes: 'Importado - Saída' });
                }

                importados++;
            }

            if (importados > 0) {
                saveImbel(data);
                renderControleImbelCadastro();
                renderControleImbelMovimentacao();
                renderControleImbelEstoque();
            }

            event.target.value = '';

            if (erros.length > 0 && importados === 0) {
                mostrarNotificacao('Nenhum registro importado. Verifique o formato.', 'error');
                console.debug('Erros de importação IMBEL:', erros);
            } else if (erros.length > 0) {
                mostrarNotificacao(`${importados} registros importados. ${erros.length} linhas com erro.`, 'warning');
                console.debug('Erros de importação IMBEL:', erros);
            } else {
                mostrarNotificacao(`${importados} registros importados com sucesso!`, 'success');
            }

        } catch (err) {
            console.error('Erro ao importar IMBEL:', err);
            mostrarNotificacao('Erro ao processar o arquivo IMBEL. Verifique o formato.', 'error');
        }
    };
    reader.readAsText(file, 'UTF-8');
}

// ========================================
// EXPORT/IMPORT - IMBEL Cadastro (Produtos)
// ========================================

function exportarImbelCadastro() {
    const sep = ';';
    const data = loadImbel();
    const produtos = data.produtos || [];
    let csv = `ID${sep}NOME${sep}CODIGO${sep}OBSERVACAO${sep}QUANTIDADE_INICIAL\n`;
    produtos.forEach(p => {
        const linha = `${p.id||''}${sep}${(p.nome||'').toString().replace(/\n/g,' ')}${sep}${(p.codigo||'').toString().replace(/\n/g,' ')}${sep}${(p.observacao||'').toString().replace(/\n/g,' ')}${sep}${(Number(p.quantidadeInicial)||0)}`;
        csv += linha + '\n';
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const dataAtual = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `imbel_produtos_${dataAtual}.csv`);
    link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    mostrarNotificacao('Produtos IMBEL exportados!', 'success');
}

function importarImbelCadastro(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const conteudo = e.target.result;
            const linhas = conteudo.split(/\r?\n/).filter(l => l.trim());
            if (linhas.length < 2) { mostrarNotificacao('Arquivo vazio ou sem dados!', 'error'); return; }
            const data = loadImbel(); data.produtos = data.produtos || [];
            let importados = 0; let erros = [];
            for (let i=1;i<linhas.length;i++) {
                const linha = linhas[i].trim(); if (!linha) continue;
                const col = parseCsvLinha(linha);
                if (col.length < 2) { erros.push(`Linha ${i+1}: formato inválido`); continue; }
                const nome = (col[1]||'').trim().toUpperCase();
                if (!nome) { erros.push(`Linha ${i+1}: nome vazio`); continue; }
                const codigo = (col[2]||'').trim().toUpperCase();
                const observacao = (col[3]||'').trim().toUpperCase();
                const quantidadeInicial = parseInt((col[4]||'').replace(/[^0-9-]/g,'')) || 0;
                let produto = data.produtos.find(p => (p.nome||'').toString().toUpperCase() === nome);
                if (!produto) {
                    produto = { id: 'p' + Date.now() + i, nome, codigo, observacao, quantidadeInicial };
                    data.produtos.push(produto);
                } else {
                    produto.codigo = produto.codigo || codigo;
                    produto.observacao = produto.observacao || observacao;
                    produto.quantidadeInicial = produto.quantidadeInicial || quantidadeInicial;
                }
                importados++;
            }
            if (importados>0) { saveImbel(data); renderControleImbelCadastro(); renderControleImbelEstoque(); }
            event.target.value = '';
            if (erros.length>0 && importados===0) { mostrarNotificacao('Nenhum produto importado. Verifique o formato.', 'error'); console.debug('Erros IMBEL cadastro:',erros); }
            else if (erros.length>0) { mostrarNotificacao(`${importados} produtos importados. ${erros.length} linhas com erro.`, 'warning'); console.debug('Erros IMBEL cadastro:',erros); }
            else { mostrarNotificacao(`${importados} produtos importados com sucesso!`, 'success'); }
        } catch(err) { console.error('Erro importar cadastro IMBEL',err); mostrarNotificacao('Erro ao processar o arquivo.', 'error'); }
    };
    reader.readAsText(file,'UTF-8');
}

// ========================================
// EXPORT/IMPORT - IMBEL Movimentação
// ========================================

function exportarImbelMovimentacao() {
    const sep = ';';
    const data = loadImbel();
    const movs = data.movimentacoes || [];
    const produtos = (data.produtos||[]).reduce((acc,p)=>{acc[p.id]=p;return acc;},{})
    let csv = `ID${sep}PRODUTO_ID${sep}PRODUTO_NOME${sep}TIPO${sep}DATA${sep}QUANTIDADE${sep}DESTINATARIO${sep}CPF_CNPJ${sep}OBSERVACOES${sep}VALOR${sep}PAGAMENTO${sep}ENDERECO${sep}TELEFONE${sep}EMAIL${sep}ENTREGUE${sep}FI\n`;
    movs.forEach(m => {
        const prod = produtos[m.produtoId] || {};
        const dataCsv = formatDateToDDMMYYYY(m.data);
        const linha = `${m.id||''}${sep}${m.produtoId||''}${sep}${(prod.nome||'').toString().replace(/\n/g,' ')}${sep}${(m.tipo||'').toString()}${sep}${dataCsv}${sep}${m.quantidade||''}${sep}${(m.destinatario||'').toString().replace(/\n/g,' ')}${sep}${(m.cpfCnpj||'').toString()}${sep}${(m.observacoes||'').toString().replace(/\n/g,' ')}${sep}${(m.valor||'')}${sep}${(m.pagamento||'').toString()}${sep}${(m.endereco||'').toString().replace(/\n/g,' ')}${sep}${(m.telefone||'').toString()}${sep}${(m.email||'').toString()}${sep}${(m.entregue||'').toString()}${sep}${(m.fi||'').toString()}`;
        csv += linha + '\n';
    });
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); const url = URL.createObjectURL(blob);
    const dataAtual = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url); link.setAttribute('download', `imbel_movimentacoes_${dataAtual}.csv`);
    link.style.visibility='hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link);
    mostrarNotificacao('Movimentações exportadas!', 'success');
}

function importarImbelMovimentacao(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const conteudo = e.target.result;
            const linhas = conteudo.split(/\r?\n/).filter(l=>l.trim());
            if (linhas.length < 2) { mostrarNotificacao('Arquivo vazio ou sem dados!', 'error'); return; }
            const data = loadImbel(); data.produtos = data.produtos || []; data.movimentacoes = data.movimentacoes || [];
            let importados = 0; let erros = [];
            for (let i=1;i<linhas.length;i++) {
                const linha = linhas[i].trim(); if (!linha) continue;
                const col = parseCsvLinha(linha);
                // Espera ao menos: PRODUTO_NOME ou PRODUTO_ID e TIPO e QUANTIDADE
                if (col.length < 6) { erros.push(`Linha ${i+1}: formato inválido`); continue; }
                const produtoIdCol = (col[1]||'').trim();
                const produtoNomeCol = (col[2]||'').trim().toUpperCase();
                const tipo = (col[3]||'').trim().toUpperCase() || 'ENTRADA';
                // Normalizar campo DATA: aceitar YYYY-MM-DD ou DD/MM/YYYY e converter para YYYY-MM-DD
                let dataRaw = (col[4]||'').trim();
                let dataStr = '';
                if (!dataRaw) {
                    dataStr = new Date().toISOString().split('T')[0];
                } else {
                    // YYYY-MM-DD
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dataRaw)) {
                        dataStr = dataRaw;
                    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataRaw)) {
                        const parts = dataRaw.split('/');
                        dataStr = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
                    } else {
                        // tentar parse geral e formatar para YYYY-MM-DD quando possível
                        const d = new Date(dataRaw);
                        if (!isNaN(d.getTime())) {
                            dataStr = d.toISOString().slice(0,10);
                        } else {
                            // fallback para data atual
                            dataStr = new Date().toISOString().split('T')[0];
                        }
                    }
                }
                const quantidade = parseInt((col[5]||'').replace(/[^0-9-]/g,'')) || 0;
                if (quantidade === 0) { erros.push(`Linha ${i+1}: quantidade inválida`); continue; }

                // Encontrar produto: por ID ou por nome
                let produto = null;
                if (produtoIdCol) produto = data.produtos.find(p => p.id === produtoIdCol);
                if (!produto && produtoNomeCol) produto = data.produtos.find(p => (p.nome||'').toString().toUpperCase() === produtoNomeCol);
                if (!produto && produtoNomeCol) {
                    produto = { id: 'p' + Date.now() + i, nome: produtoNomeCol, codigo: '', observacao: '' };
                    data.produtos.push(produto);
                }

                const destinatario = (col[6]||'').trim().toUpperCase();
                const cpfCnpj = (col[7]||'').trim().toUpperCase();
                const observacoes = (col[8]||'').trim().toUpperCase();
                // Normalizar campo VALOR: remover símbolos, tratar milhares (.) e decimais (',')
                let valor = 0;
                try {
                    let vs = (col[9]||'').toString().trim();
                    // remover símbolos de moeda e espaços
                    vs = vs.replace(/[^0-9,\.\-]/g, '');
                    if (vs === '') vs = '0';
                    // se contém ',' como separador decimal (BR), remover pontos de milhares e trocar ',' por '.'
                    if (vs.indexOf(',') !== -1) {
                        vs = vs.replace(/\./g, '');
                        vs = vs.replace(/,/g, '.');
                    } else {
                        // sem vírgula, apenas remover separadores de milhar (caso existam) e keep dot
                        vs = vs.replace(/\.(?=\d{3}(?:\.|$))/g, '');
                    }
                    valor = parseFloat(vs) || 0;
                } catch (errVal) { valor = 0; }
                const pagamento = (col[10]||'').trim().toUpperCase();
                const endereco = (col[11]||'').trim().toUpperCase();
                const telefone = (col[12]||'').trim().toUpperCase();
                const email = (col[13]||'').trim().toUpperCase();
                const entregue = (col[14]||'').trim().toUpperCase() || 'NÃO';
                const fi = (col[15]||'').trim().toUpperCase();

                const mov = { id: 'm' + Date.now() + i, produtoId: produto.id, tipo, quantidade, data: dataStr, destinatario, cpfCnpj, valor, pagamento, endereco, telefone, email, entregue, fi, observacoes };
                data.movimentacoes.push(mov);
                importados++;
            }
            if (importados>0) { saveImbel(data); renderControleImbelMovimentacao(); renderControleImbelEstoque(); renderControleImbelCadastro(); }
            event.target.value = '';
            if (erros.length>0 && importados===0) { mostrarNotificacao('Nenhuma movimentação importada. Verifique o formato.', 'error'); console.debug('Erros IMBEL mov:',erros); }
            else if (erros.length>0) { mostrarNotificacao(`${importados} movimentações importadas. ${erros.length} linhas com erro.`, 'warning'); console.debug('Erros IMBEL mov:',erros); }
            else { mostrarNotificacao(`${importados} movimentações importadas com sucesso!`, 'success'); }
        } catch(err) { console.error('Erro importar movimentações IMBEL',err); mostrarNotificacao('Erro ao processar o arquivo.', 'error'); }
    };
    reader.readAsText(file,'UTF-8');
}


function obterItensVendaNormalizados(venda) {
    if (Array.isArray(venda.items) && venda.items.length > 0) {
        return venda.items.map(it => ({
            produtoNome: it.produtoNome || venda.produtoNome || '',
            quantidade: Number(it.quantidade) || 0,
            valorTotal: typeof it.valorTotal === 'number' ? it.valorTotal : ((Number(it.valorUnitario) || 0) * (Number(it.quantidade) || 0))
        }));
    }
    return [{
        produtoNome: venda.produtoNome || '',
        quantidade: Number(venda.quantidade) || 0,
        valorTotal: typeof venda.valorTotal === 'number' ? venda.valorTotal : ((Number(venda.valorUnitario) || 0) * (Number(venda.quantidade) || 0))
    }];
}

function obterVendasDashboardFiltradas() {
    const preset = document.getElementById('dashboardRangePreset')?.value || '30';
    const startInput = document.getElementById('dashboardDateStart')?.value || '';
    const endInput = document.getElementById('dashboardDateEnd')?.value || '';

    const hoje = new Date();
    let inicio = null;
    let fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);

    if (preset === '7' || preset === '30' || preset === '90') {
        const dias = Number(preset);
        inicio = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - (dias - 1), 0, 0, 0);
    } else if (preset === 'custom') {
        if (startInput) inicio = new Date(startInput + 'T00:00:00');
        if (endInput) fim = new Date(endInput + 'T23:59:59');
    }

    return (estoque.registroVendas || []).filter(v => {
        // considerar apenas vendas efetivadas (não canceladas)
        if (v.cancelado) return false;
        if (!v.data) return false;
        const d = new Date(v.data);
        if (isNaN(d.getTime())) return false;
        if (inicio && d < inicio) return false;
        if (fim && d > fim) return false;
        return true;
    });
}

function atualizarFiltroDashboardPeriodo() {
    const preset = document.getElementById('dashboardRangePreset');
    const startEl = document.getElementById('dashboardDateStart');
    const endEl = document.getElementById('dashboardDateEnd');
    if (!preset || !startEl || !endEl) return;

    const custom = preset.value === 'custom';
    startEl.style.display = custom ? '' : 'none';
    endEl.style.display = custom ? '' : 'none';

    if (!custom) {
        startEl.value = '';
        endEl.value = '';
    }
    renderizarDashboard();
}

function renderizarDashboard() {
    const vendasFiltradas = obterVendasDashboardFiltradas();
    // Aplicar filtro de período (todos / mês / trimestre / ano)
    const periodo = document.getElementById('filtroDashboardPeriodo')?.value || 'todos';
    const agora = new Date();
    const vendasPeriodo = (vendasFiltradas || []).filter(v => {
        if (periodo === 'todos') return true;
        const d = new Date(v.data || 0);
        if (isNaN(d.getTime())) return false;
        if (periodo === 'mes') return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
        if (periodo === 'trimestre') return Math.floor(d.getMonth()/3) === Math.floor(agora.getMonth()/3) && d.getFullYear() === agora.getFullYear();
        if (periodo === 'ano') return d.getFullYear() === agora.getFullYear();
        return true;
    });
    const repsOrdem = ['ADES', 'FL', 'IMBEL', 'ISA', 'KOLTE', 'LC'];
    const vendasPorRep = {};
    repsOrdem.forEach(rep => { vendasPorRep[rep] = 0; });

    const produtoMap = new Map();
    let totalUnidades = 0;
    let totalFaturamento = 0;

    vendasPeriodo.forEach(venda => {
        const rep = (venda.representante || '').toUpperCase();
        const itens = obterItensVendaNormalizados(venda);
        itens.forEach(it => {
            if (!it.produtoNome) return;
            const registro = produtoMap.get(it.produtoNome) || {
                nome: it.produtoNome,
                quantidade: 0,
                valor: 0,
                vendasPorRep: {}
            };
            registro.quantidade += it.quantidade;
            registro.valor += it.valorTotal;
            registro.vendasPorRep[rep] = (registro.vendasPorRep[rep] || 0) + it.quantidade;
            produtoMap.set(it.produtoNome, registro);

            totalUnidades += it.quantidade;
            totalFaturamento += it.valorTotal;
            if (vendasPorRep[rep] === undefined) vendasPorRep[rep] = 0;
            vendasPorRep[rep] += Number(it.valorTotal) || 0;
        });
    });

    const produtosArray = Array.from(produtoMap.values());
    const dadosVendas = [...produtosArray].sort((a, b) => b.quantidade - a.quantidade);
    const sortMode = document.getElementById('filtroOrdenacaoProdutos')?.value || 'quantidade';
    let dadosOrdenados;
    if (sortMode === 'produto') {
        dadosOrdenados = [...produtosArray].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    } else if (sortMode === 'valor') {
        dadosOrdenados = [...produtosArray].sort((a, b) => b.valor - a.valor);
    } else {
        dadosOrdenados = [...produtosArray].sort((a, b) => b.quantidade - a.quantidade);
    }

    let melhorRep = '-';
    let maxVendas = 0;
    Object.entries(vendasPorRep).forEach(([rep, qtd]) => {
        if (qtd > maxVendas) {
            melhorRep = rep;
            maxVendas = qtd;
        }
    });

    const produtoTop = dadosVendas.length > 0 && dadosVendas[0].quantidade > 0
        ? dadosVendas[0].nome.substring(0, 25) + (dadosVendas[0].nome.length > 25 ? '...' : '')
        : '-';

    const dashTotalUnidadesEl = document.getElementById('dashTotalUnidades');
    const dashTotalFaturamentoEl = document.getElementById('dashTotalFaturamento');
    const dashMelhorRepEl = document.getElementById('dashMelhorRep');
    const dashProdutoTopEl = document.getElementById('dashProdutoTop');
    if (dashTotalUnidadesEl) dashTotalUnidadesEl.textContent = totalUnidades.toLocaleString('pt-BR');
    if (dashTotalFaturamentoEl) dashTotalFaturamentoEl.textContent = formatarMoedaValor(totalFaturamento);
    if (dashMelhorRepEl) dashMelhorRepEl.textContent = maxVendas > 0 ? `${melhorRep} (${formatarMoedaValor(maxVendas)})` : '-';
    if (dashProdutoTopEl) dashProdutoTopEl.textContent = produtoTop;

    const tabelaQtd = document.getElementById('tabelaQtdProduto');
    if (tabelaQtd) {
        tabelaQtd.innerHTML = '';
        dadosOrdenados.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="produto-nome">${item.nome}</td>
                <td class="cell-qtd">${item.quantidade.toLocaleString('pt-BR')}</td>
            `;
            tabelaQtd.appendChild(tr);
        });
        const trTotalQtd = document.createElement('tr');
        trTotalQtd.className = 'total-row';
        trTotalQtd.innerHTML = `
            <td class="produto-nome"><strong>Total Geral</strong></td>
            <td class="cell-qtd"><strong>${totalUnidades.toLocaleString('pt-BR')}</strong></td>
        `;
        tabelaQtd.appendChild(trTotalQtd);
    }

    const tabelaValor = document.getElementById('tabelaValorProduto');
    if (tabelaValor) {
        tabelaValor.innerHTML = '';
        dadosOrdenados.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="produto-nome">${item.nome}</td>
                <td class="cell-valor">${formatarMoedaValor(item.valor)}</td>
            `;
            tabelaValor.appendChild(tr);
        });
        const trTotalValor = document.createElement('tr');
        trTotalValor.className = 'total-row';
        trTotalValor.innerHTML = `
            <td class="produto-nome"><strong>Total Geral</strong></td>
            <td class="cell-valor"><strong>${formatarMoedaValor(totalFaturamento)}</strong></td>
        `;
        tabelaValor.appendChild(trTotalValor);
    }

    const tabelaRep = document.getElementById('tabelaVendasRepBody');
    if (tabelaRep) {
        tabelaRep.innerHTML = '';
        const totaisPorRep = {};
        repsOrdem.forEach(rep => { totaisPorRep[rep] = 0; });

        dadosOrdenados.forEach(item => {
            const tr = document.createElement('tr');
            let html = `<td class="produto-nome">${item.nome}</td>`;
            repsOrdem.forEach(rep => {
                const qtd = item.vendasPorRep[rep] || 0;
                totaisPorRep[rep] += qtd;
                html += `<td class="${qtd === 0 ? 'cell-zero' : 'cell-qtd'}">${qtd > 0 ? qtd : '-'}</td>`;
            });
            html += `<td class="geral-venda"><strong>${item.quantidade}</strong></td>`;
            tr.innerHTML = html;
            tabelaRep.appendChild(tr);
        });

        const trTotalRep = document.createElement('tr');
        trTotalRep.className = 'total-row';
        let htmlTotal = `<td class="produto-nome"><strong>Total Geral</strong></td>`;
        repsOrdem.forEach(rep => {
            htmlTotal += `<td class="cell-qtd"><strong>${totaisPorRep[rep]}</strong></td>`;
        });
        htmlTotal += `<td class="geral-venda"><strong>${totalUnidades}</strong></td>`;
        trTotalRep.innerHTML = htmlTotal;
        tabelaRep.appendChild(trTotalRep);
    }
    try {
        if (typeof renderizarGraficoComissoes === 'function') renderizarGraficoComissoes();
    } catch (e) { console.warn('Erro ao renderizar gráfico de comissões', e); }
}

// ========================================
// FORMATAÇÃO
// ========================================

function formatarNumero(num) {
    if (num === 0) return '-';
    return num.toLocaleString('pt-BR');
}

function formatarMoedaValor(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarMoeda(input) {
    let valor = input.value.replace(/\D/g, '');
    valor = (parseInt(valor) / 100).toFixed(2);
    valor = valor.replace('.', ',');
    valor = valor.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    input.value = valor;
}

function converterMoedaParaNumero(valor) {
    if (!valor) return 0;
    return parseFloat(valor.replace(/\./g, '').replace(',', '.')) || 0;
}

// ========================================
// FUNÇÕES DOS MODAIS
// ========================================

function abrirModalProduto() {
    if (!requireAdminOrNotify()) return;
    // Abrir em modo de criar novo produto
    produtoEditandoId = null;
    document.getElementById('modalProduto').style.display = 'flex';
    document.getElementById('formProduto').reset();
    const categoriaSel = document.getElementById('produtoCategoria');
    if (categoriaSel) categoriaSel.value = '';
    // Restaurar título e botão padrão
    const header = document.querySelector('#modalProduto .modal-header h2');
    if (header) header.innerHTML = '<span>+</span> Adicionar Novo Produto';
    const submitBtn = document.querySelector('#modalProduto .modal-footer button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Salvar Produto';
}

function abrirModalNovoProduto() {
    abrirModalProduto();
}

function abrirModalEditarProduto(produtoId) {
    if (!requireAdminOrNotify()) return;
    const produto = estoque.produtos.find(p => p.id === Number(produtoId));
    if (!produto) {
        mostrarNotificacao('Produto não encontrado!', 'error');
        return;
    }
    produtoEditandoId = produto.id;
    document.getElementById('modalProduto').style.display = 'flex';
    document.getElementById('formProduto').reset();
    document.getElementById('nomeProduto').value = produto.nome || '';
    document.getElementById('estoqueTotal').value = Number(produto.estoqueConsolidado || 0);
    const regra = (precificacao && precificacao[produto.nome]) ? precificacao[produto.nome] : {};
    const cat = (categoriaPorProduto && categoriaPorProduto[produto.nome]) || produto.categoria || '';
    const ncmInput = document.getElementById('produtoNCM');
    const catInput = document.getElementById('produtoCategoria');
    const ciInput = document.getElementById('produtoCI');
    const margemInput = document.getElementById('produtoMargemMin');
    const descInput = document.getElementById('produtoDescMax');
    const obsInput = document.getElementById('produtoObservacoes');
    if (ncmInput) ncmInput.value = produto.ncm || '';
    if (catInput) catInput.value = cat || '';
    if (ciInput) {
        const ciVal = Number(regra.ci ?? produto.ci ?? 0) || 0;
        ciInput.value = ciVal ? _fmtMoeda(ciVal) : '';
    }
    if (margemInput) margemInput.value = Number(regra.margemMinima ?? produto.margemMinima ?? 0) || '';
    if (descInput) descInput.value = Number(regra.descontoMaximo ?? produto.descontoMaximo ?? 0) || '';
    if (obsInput) obsInput.value = produto.observacoes || '';
    const exibirEstoqueInput = document.getElementById('produtoExibirNoEstoque');
    if (exibirEstoqueInput) exibirEstoqueInput.checked = produto.exibirNoEstoque === true;
    // Ajustar título e botão para modo edição
    const header = document.querySelector('#modalProduto .modal-header h2');
    if (header) header.innerHTML = '<span>✎</span> Editar Produto';
    const submitBtn = document.querySelector('#modalProduto .modal-footer button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Salvar Alterações';
}

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
        vendaEditandoId = null;
    }
});

// ========================================
// FUNÇÕES DE CRUD
// ========================================

function atualizarSelectsProdutos() {
    const selects = ['produtoDistribuicao', 'produtoVenda', 'produtoDevolucao', 'produtoVendaDet', 'filtroProduto', 'produtoDistDet', 'filtroDistribuicaoProduto'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const valorAtual = select.value;
            const primeiraOpcao = (selectId === 'filtroProduto' || selectId === 'filtroDistribuicaoProduto') ? 'Todos' : 'Selecione um produto';
            select.innerHTML = `<option value="">${primeiraOpcao}</option>`;
            // Preencher em ordem alfabética
            const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
            produtosOrdenados.forEach(produto => {
                const option = document.createElement('option');
                option.value = produto.id;
                option.textContent = produto.nome;
                select.appendChild(option);
            });
            
            select.value = valorAtual;
        }
    });

    // Atualizar selects dinâmicos de itens (se existirem)
    try {
        const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        document.querySelectorAll('.item-produto-dist, .item-produto-dev').forEach(sel => {
            const cur = sel.value;
            sel.innerHTML = '<option value="">Selecione um produto</option>';
            produtosOrdenados.forEach(produto => {
                const opt = document.createElement('option');
                opt.value = produto.id;
                opt.textContent = produto.nome;
                sel.appendChild(opt);
            });
            sel.value = cur;
        });
    } catch (e) {}
}

// Helpers para adicionar/remover linhas nos modais de distribuição/devolução
function adicionarItemDistribuicao(produtoId = null, quantidade = 1) {
    const container = document.getElementById('itensDistribuicaoContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'item-dist-row';
    row.style.display = 'flex';
    row.style.gap = '8px';

    const sel = document.createElement('select');
    sel.className = 'item-produto-dist';
    sel.style.flex = '1';
    sel.innerHTML = '<option value="">Carregando...</option>';

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '1';
    inp.value = quantidade || 1;
    inp.className = 'item-quantidade-dist';
    inp.style.width = '96px';
    inp.placeholder = 'Qtd';

    const btnRem = document.createElement('button');
    btnRem.type = 'button';
    btnRem.className = 'btn btn-outline btn-sm';
    btnRem.style.width = '40px';
    btnRem.textContent = '✕';
    btnRem.title = 'Remover'
    btnRem.onclick = function() { row.remove(); };

    row.appendChild(sel);
    row.appendChild(inp);
    row.appendChild(btnRem);
    container.appendChild(row);

    // popular opções
    try {
        const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        sel.innerHTML = '<option value="">Selecione um produto</option>';
        produtosOrdenados.forEach(produto => {
            const opt = document.createElement('option');
            opt.value = produto.id;
            opt.textContent = produto.nome;
            sel.appendChild(opt);
        });
        if (produtoId) sel.value = String(produtoId);
    } catch (e) { sel.innerHTML = '<option value="">Nenhum produto</option>'; }
}

function adicionarItemDevolucao(produtoId = null, quantidade = 1) {
    const container = document.getElementById('itensDevolucaoContainer');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'item-dev-row';
    row.style.display = 'flex';
    row.style.gap = '8px';

    const sel = document.createElement('select');
    sel.className = 'item-produto-dev';
    sel.style.flex = '1';
    sel.innerHTML = '<option value="">Carregando...</option>';

    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '1';
    inp.value = quantidade || 1;
    inp.className = 'item-quantidade-dev';
    inp.style.width = '96px';
    inp.placeholder = 'Qtd';

    const btnRem = document.createElement('button');
    btnRem.type = 'button';
    btnRem.className = 'btn btn-outline btn-sm';
    btnRem.style.width = '40px';
    btnRem.textContent = '✕';
    btnRem.title = 'Remover'
    btnRem.onclick = function() { row.remove(); };

    row.appendChild(sel);
    row.appendChild(inp);
    row.appendChild(btnRem);
    container.appendChild(row);

    // popular opções
    try {
        const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        sel.innerHTML = '<option value="">Selecione um produto</option>';
        produtosOrdenados.forEach(produto => {
            const opt = document.createElement('option');
            opt.value = produto.id;
            opt.textContent = produto.nome;
            sel.appendChild(opt);
        });
        if (produtoId) sel.value = String(produtoId);
    } catch (e) { sel.innerHTML = '<option value="">Nenhum produto</option>'; }
}

function atualizarSelectsRelatorios() {
    // Popular select de representantes
    const selRep = document.getElementById('filtroRelatoriosRep');
    if (selRep) {
        const atual = selRep.value;
        selRep.innerHTML = '<option value="">Todos</option>';
        estoque.representantes.forEach(rep => {
            const opt = document.createElement('option');
            opt.value = rep;
            opt.textContent = rep;
            selRep.appendChild(opt);
        });
        selRep.value = atual;
    }

    // Popular select de produtos
    const selProd = document.getElementById('filtroRelatoriosProduto');
    if (selProd) {
        const atualP = selProd.value;
        selProd.innerHTML = '<option value="">Todos</option>';
        const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        produtosOrdenados.forEach(produto => {
            const opt = document.createElement('option');
            opt.value = produto.id;
            opt.textContent = produto.nome;
            selProd.appendChild(opt);
        });
        selProd.value = atualP;
    }
}

function atualizarSelectDistribuicaoProduto() {
    const select = document.getElementById('filtroDistribuicaoProduto');
    if (select) {
        const valorAtual = select.value;
        select.innerHTML = '<option value="">Todos</option>';
        const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        produtosOrdenados.forEach(produto => {
            const option = document.createElement('option');
            option.value = produto.id;
            option.textContent = produto.nome;
            select.appendChild(option);
        });
        
        select.value = valorAtual;
    }
}

// ========================================
// ENTRADA DE ESTOQUE (IMBEL)
// ========================================

function abrirModalEntradaEstoque() {
    if (!requireAdminOrNotify()) return;
    document.getElementById('modalEntradaEstoque').style.display = 'flex';
    document.getElementById('formEntradaEstoque').reset();
    document.getElementById('estoqueAtualIMBEL').value = '-';
    
    // Atualizar select de produtos
    const select = document.getElementById('produtoEntrada');
    select.innerHTML = '<option value="">Selecione um produto</option>';
    const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    produtosOrdenados.forEach(produto => {
        const option = document.createElement('option');
        option.value = produto.id;
        option.textContent = produto.nome;
        select.appendChild(option);
    });
}

function abrirModalDevolucao() {
    if (!requireAdminOrNotify()) return;
    const modal = document.getElementById('modalDevolucao');
    if (!modal) return;
    modal.style.display = 'flex';
    document.getElementById('formDevolucao').reset();
    // Popular selects de representantes via helper centralizado
    try { popularSelectRepresentantes('representanteDevolucao', false); } catch (e) {}
    try { popularSelectRepresentantes('destinoDevolucao', true); } catch (e) {}

    // Reset container de itens e adicionar uma linha inicial
    try {
        const container = document.getElementById('itensDevolucaoContainer');
        if (container) {
            container.innerHTML = '';
            adicionarItemDevolucao();
        }
    } catch (e) {}
}

// Fecha um modal e restaura z-index do header fixo se necessário
function fecharModal(modalId) {
    try {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
    } catch (e) { /* ignore */ }
    // Se o modal fechado for o de produto, restaurar estado de edição padrão
    try {
        if (modalId === 'modalProduto') {
            produtoEditandoId = null;
            const header = document.querySelector('#modalProduto .modal-header h2');
            if (header) header.innerHTML = '<span>+</span> Adicionar Novo Produto';
            const submitBtn = document.querySelector('#modalProduto .modal-footer button[type="submit"]');
            if (submitBtn) submitBtn.textContent = 'Salvar Produto';
        }
    } catch (e) {}
    // Sempre tentar restaurar z-index do header fixo quando um modal fechar
}

function mostrarEstoqueAtual() {
    const produtoId = parseInt(document.getElementById('produtoEntrada').value);
    const produto = estoque.produtos.find(p => p.id === produtoId);
    
    if (produto) {
        const estoqueIMBEL = calcularImbelDisponivel(produto);
        document.getElementById('estoqueAtualIMBEL').value = `${estoqueIMBEL} unidades`;
    } else {
        document.getElementById('estoqueAtualIMBEL').value = '-';
    }
}

function salvarEntradaEstoque(event) {
    if (!requireAdminOrNotify()) return;
    event.preventDefault();
    
    const produtoId = parseInt(document.getElementById('produtoEntrada').value);
    const quantidade = parseInt(document.getElementById('quantidadeEntrada').value);
    const observacao = document.getElementById('observacaoEntrada').value.trim();
    
    const produto = estoque.produtos.find(p => p.id === produtoId);
    
    if (!produto) {
        mostrarNotificacao('Produto não encontrado!', 'error');
        return;
    }
    
    // Adicionar ao estoque da IMBEL
    // Agora adicionamos ao `estoqueConsolidado` (cadastro do total disponível)
    produto.estoqueConsolidado = (Number(produto.estoqueConsolidado) || 0) + quantidade;

    // Registrar entrada histórica para permitir edição/auditoria futura
    try {
        if (!Array.isArray(estoque.registroEntradas)) estoque.registroEntradas = [];
        estoque.registroEntradas.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            produtoId: produto.id,
            produtoNome: produto.nome,
            quantidade: quantidade,
            data: (new Date()).toISOString().split('T')[0],
            observacoes: observacao
        });
    } catch (e) { /* ignore registro failure */ }
    
    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    fecharModal('modalEntradaEstoque');
    
    const msgObs = observacao ? ` (${observacao})` : '';
    mostrarNotificacao(`Entrada registrada: +${quantidade} "${produto.nome}" no estoque IMBEL${msgObs}`, 'success');
}

// ========================================
// REGISTRO DE VENDAS DETALHADO
// ========================================

// Configuração de Numeração de Contratos (NNN/AAAA)
function carregarConfigContrato() {
    try {
        const cfg = JSON.parse(localStorage.getItem('configContrato') || '{}');
        return {
            ano:     cfg.ano     || new Date().getFullYear(),
            proximo: cfg.proximo || 1,
        };
    } catch(e) {
        return { ano: new Date().getFullYear(), proximo: 1 };
    }
}

function salvarConfigContrato() {
    const ano     = parseInt(document.getElementById('configContratoAno')?.value)     || new Date().getFullYear();
    const proximo = parseInt(document.getElementById('configContratoProximo')?.value)  || 1;
    const cfg = { ano, proximo };
    localStorage.setItem('configContrato', JSON.stringify(cfg));
    try { atualizarPreviaContrato(); } catch(e) {}
    try { mostrarNotificacao('Configuração de contrato salva!', 'success'); } catch(e) {}
}

function atualizarPreviaContrato() {
    const ano     = parseInt(document.getElementById('configContratoAno')?.value)     || new Date().getFullYear();
    const proximo = parseInt(document.getElementById('configContratoProximo')?.value)  || 1;
    const previa  = document.getElementById('configContratoPreviaPrev');
    if (previa) {
        previa.textContent = String(proximo).padStart(3,'0') + '/' + ano;
    }
}

// Analisa um valor de contrato e tenta extrair sequência e ano
function parseContratoParts(contrato) {
    if (contrato === null || contrato === undefined) return null;
    const bruto = (contrato ?? '').toString().normalize('NFKC');
    const clean = bruto.replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
    if (!clean) return null;
    // formato com separador: 002/2026 ou 2-2026
    const m = clean.match(/^(\d+)\D+(\d{4})$/);
    if (m) {
        return { seq: parseInt(m[1], 10), year: parseInt(m[2], 10) };
    }
    // apenas dígitos (pode ser 22026 -> seq=2, year=2026)
    const digits = clean.replace(/\D+/g, '');
    if (digits) {
        if (digits.length > 4) {
            const maybeYear = parseInt(digits.slice(-4), 10);
            if (!isNaN(maybeYear) && maybeYear >= 2000 && maybeYear <= 2099) {
                const seq = parseInt(digits.slice(0, -4), 10) || 0;
                return { seq: seq, year: maybeYear };
            }
        }
        return { seq: parseInt(digits, 10), year: null };
    }
    return null;
}

// Retorna o próximo número sequencial (inteiro) para o ano informado
function obterProximoNumeroContratoParaAno(ano) {
    ano = parseInt(ano, 10) || new Date().getFullYear();
    let maxSeq = 0;
    (estoque.registroVendas || []).forEach(v => {
        try {
            const parsed = parseContratoParts(v.contrato || '');
            if (parsed && parsed.seq) {
                if (parsed.year) {
                    if (parsed.year === ano && parsed.seq > maxSeq) maxSeq = parsed.seq;
                } else {
                    // se contrato não tem ano explícito, use o ano da venda (quando disponível)
                    if (v && v.data) {
                        const vy = new Date(v.data).getFullYear();
                        if (vy === ano && parsed.seq > maxSeq) maxSeq = parsed.seq;
                    }
                }
            }
        } catch (e) {}
    });
    if (maxSeq > 0) return maxSeq + 1;
    // fallback para configContrato quando não houver registos
    const cfg = carregarConfigContrato();
    if (cfg && cfg.ano === ano && cfg.proximo && cfg.proximo > 0) return cfg.proximo;
    return 1;
}

// Gera o próximo número (sequência) com padding, sem incluir o ano.
function gerarNumeroContrato(preferYear) {
    const ano = preferYear || new Date().getFullYear();
    const nextSeq = obterProximoNumeroContratoParaAno(ano);
    return String(nextSeq).padStart(3, '0');
}

// ================================
// CONFIGURAÇÃO: REPRESENTANTES
// Chave localStorage: 'configRepresentantes'
// ================================

function carregarConfigRepresentantes() {
    try {
        return JSON.parse(localStorage.getItem('configRepresentantes') || '{}');
    } catch (e) {
        return {};
    }
}

function salvarConfigRepresentantes(dados) {
    try {
        localStorage.setItem('configRepresentantes', JSON.stringify(dados || {}));
    } catch (e) {
        console.error('Falha ao salvar configRepresentantes', e);
    }
}

function getConfigRep(nome) {
    if (!nome) return {};
    const todos = carregarConfigRepresentantes();
    return todos[(nome || '').toString().toUpperCase()] || {};
}

function renderizarSelectConfigRep() {
    const sel = document.getElementById('configRepSelect');
    if (!sel) return;
    const reps = (window.estoque && Array.isArray(estoque.representantes) && estoque.representantes.length)
        ? estoque.representantes
        : ['KOLTE','ISA','LC','ADES','FL'];
    const atual = sel.value || '';
    sel.innerHTML = '<option value="">Selecione o representante</option>' + reps.map(r => {
        const esc = String(r).replace(/"/g,'&quot;');
        return `<option value="${esc}" ${r===atual? 'selected':''}>${esc}</option>`;
    }).join('');
}

function carregarFormRep(rep) {
    const form = document.getElementById('configRepForm');
    if (!form) return;
    if (!rep) {
        form.style.display = 'none';
        return;
    }
    form.style.display = 'block';
    const dados = getConfigRep(rep || '');
    document.getElementById('cfgRep_razaoSocial').value = dados.razaoSocial || '';
    document.getElementById('cfgRep_nomeFantasia').value = dados.nomeFantasia || '';
    document.getElementById('cfgRep_cnpj').value = dados.cnpj || '';
    document.getElementById('cfgRep_nrCore').value = dados.nrCore || '';
    document.getElementById('cfgRep_ufCore').value = (dados.ufCore || '').toString().toUpperCase();
    document.getElementById('cfgRep_nomeResponsavel').value = dados.nomeResponsavel || '';
    document.getElementById('cfgRep_telefone').value = dados.telefone || '';
    document.getElementById('cfgRep_email').value = dados.email || '';
}

function salvarFormRep() {
    const sel = document.getElementById('configRepSelect');
    if (!sel) return mostrarNotificacao('Selecione um representante antes de salvar.', 'warning');
    const rep = (sel.value || '').toString().trim();
    if (!rep) return mostrarNotificacao('Selecione um representante antes de salvar.', 'warning');

    const dados = carregarConfigRepresentantes();
    const key = rep.toUpperCase();
    dados[key] = {
        razaoSocial: document.getElementById('cfgRep_razaoSocial').value || '',
        nomeFantasia: document.getElementById('cfgRep_nomeFantasia').value || '',
        cnpj: document.getElementById('cfgRep_cnpj').value || '',
        nrCore: document.getElementById('cfgRep_nrCore').value || '',
        ufCore: (document.getElementById('cfgRep_ufCore').value || '').toString().toUpperCase(),
        nomeResponsavel: document.getElementById('cfgRep_nomeResponsavel').value || '',
        telefone: document.getElementById('cfgRep_telefone').value || '',
        email: document.getElementById('cfgRep_email').value || ''
    };

    salvarConfigRepresentantes(dados);
    try { renderizarSelectConfigRep(); } catch (e) {}
    mostrarNotificacao('Dados do representante salvos!', 'success');
}

// ================================
// CONFIGURAÇÃO: VENDEDOR (IMBEL / Fábrica de Itajubá)
// Chave localStorage: 'configVendedor'
// ================================

function carregarConfigVendedor() {
    try {
        return JSON.parse(localStorage.getItem('configVendedor') || '{}');
    } catch (e) {
        return {};
    }
}

function salvarConfigVendedor(dados) {
    try {
        localStorage.setItem('configVendedor', JSON.stringify(dados || {}));
    } catch (e) {
        console.error('Falha ao salvar configVendedor', e);
    }
}

function renderizarConfigVendedor() {
    const dados = carregarConfigVendedor();
    const fields = [
        'nomeEmpresa','cnpj','inscricaoEstadual','endereco',
        'bairro','cidade','uf','cep','registroEB',
        'nomeResponsavel','cpfResponsavel'
    ];
    fields.forEach(f => {
        const el = document.getElementById('cfgVend_' + f);
        if (el) el.value = dados[f] || '';
    });
}

function salvarConfigVendedorForm() {
    const fields = [
        'nomeEmpresa','cnpj','inscricaoEstadual','endereco',
        'bairro','cidade','uf','cep','registroEB',
        'nomeResponsavel','cpfResponsavel'
    ];
    const dados = {};
    fields.forEach(f => {
        dados[f] = document.getElementById('cfgVend_' + f)?.value.trim() || '';
    });
    salvarConfigVendedor(dados);
    mostrarNotificacao('Dados do vendedor salvos!', 'success');
}

function abrirModalVendaDetalhada(vendaId = null, propostaId = null) {
    // vendaId: se fornecido, abre o modal em modo de edição para essa venda
    // propostaId: se fornecido, preenche campos a partir da proposta para revisão
    if (!requireAdminOrNotify()) return;
    const modalEl = document.getElementById('modalVendaDetalhada');
    modalEl.style.display = 'flex';
    document.getElementById('formVendaDetalhada').reset();
    document.getElementById('valorUnitarioVenda').value = '';
    document.getElementById('valorTotalVenda').value = '';
    atualizarSelectsProdutos();
    try { popularSelectRepresentantes('representanteVendaDet', true); } catch (e) {}

    const container = document.getElementById('itensVendaContainer');
    if (!container) return;

    // Garantir listener no campo cliente/loja para atualizar preços quando mudar
    try {
        const lojaEl = document.getElementById('lojaVenda');
        if (lojaEl) {
            lojaEl.oninput = function() {
                try { preencherDadosCliente(lojaEl.value); } catch(e) {}
                try { atualizarPrecosVendaPorCliente(); } catch(e) {}
            };
        }
    } catch (e) {}

    // Pre-fill from proposal if propostaId provided
    if (propostaId && !vendaId) {
        const proposta = (propostas || []).find(p => p.id === propostaId || p.id === String(propostaId));
        if (proposta) {
            vendaEditandoId = null;
            container.innerHTML = '';

            // preencher contrato com sequência (apenas número) baseada no ano da data
            try {
                const contratoEl = document.getElementById('contratoVenda');
                const dataEl = document.getElementById('dataVenda');
                const defaultYear = (dataEl && dataEl.value) ? new Date(dataEl.value + 'T12:00:00').getFullYear() : new Date().getFullYear();
                const seq = gerarNumeroContrato(defaultYear);
                if (contratoEl) {
                    contratoEl.value = seq;
                    contratoEl.dataset.autogenerated = '1';
                    contratoEl.oninput = function() { this.dataset.autogenerated = '0'; };
                }
                if (dataEl) {
                    dataEl.onchange = function() {
                        if (contratoEl && contratoEl.dataset.autogenerated === '1') {
                            const y = this.value ? new Date(this.value + 'T12:00:00').getFullYear() : new Date().getFullYear();
                            contratoEl.value = gerarNumeroContrato(y);
                            contratoEl.dataset.autogenerated = '1';
                        }
                    };
                }
            } catch (e) {}
            document.getElementById('lojaVenda').value = proposta.cliente || '';
            document.getElementById('representanteVendaDet').value = proposta.representante || '';
            document.getElementById('observacoesVenda').value = 'Gerado a partir da proposta ' + proposta.numero + (proposta.observacoes ? '\n' + proposta.observacoes : '');
            try { document.getElementById('dataVenda').value = new Date().toISOString().slice(0, 10); } catch (e) {}

            if (Array.isArray(proposta.itens) && proposta.itens.length > 0) {
                proposta.itens.forEach(it => {
                    const preValor = it.valorUnitario ? it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
                    adicionarItemVendaRow(it.produtoId, it.quantidade, preValor);
                });
            } else {
                adicionarItemVendaRow();
            }
            atualizarTotalVendaDetalhada();
            return;
        }
    }

    // Se estamos criando nova venda, inicializa com uma linha vazia e sugere contrato
    if (!vendaId) {
        vendaEditandoId = null;
        container.innerHTML = '';
        adicionarItemVendaRow();

        try {
            const contratoEl = document.getElementById('contratoVenda');
            const dataEl = document.getElementById('dataVenda');
            const defaultYear = (dataEl && dataEl.value) ? new Date(dataEl.value + 'T12:00:00').getFullYear() : new Date().getFullYear();
            const seq = gerarNumeroContrato(defaultYear);
            if (contratoEl) {
                contratoEl.value = seq;
                contratoEl.dataset.autogenerated = '1';
                contratoEl.oninput = function() { this.dataset.autogenerated = '0'; };
            }
            if (dataEl) {
                dataEl.onchange = function() {
                    if (contratoEl && contratoEl.dataset.autogenerated === '1') {
                        const y = this.value ? new Date(this.value + 'T12:00:00').getFullYear() : new Date().getFullYear();
                        contratoEl.value = gerarNumeroContrato(y);
                        contratoEl.dataset.autogenerated = '1';
                    }
                };
            }
        } catch (e) {}
        // Preencher data padrão como hoje
        try { document.getElementById('dataVenda').value = new Date().toISOString().slice(0,10); } catch (e) {}
        return;
    }

    // Modo edição: preencher campos com os dados da venda
    const venda = estoque.registroVendas.find(v => v.id === vendaId);
    if (!venda) {
        mostrarNotificacao('Venda não encontrada para edição', 'error');
        vendaEditandoId = null;
        container.innerHTML = '';
        adicionarItemVendaRow();
        return;
    }

    vendaEditandoId = vendaId;
    container.innerHTML = '';

    document.getElementById('contratoVenda').value = venda.contrato || '';
    document.getElementById('lojaVenda').value = venda.loja || '';
    document.getElementById('representanteVendaDet').value = venda.representante || '';
    document.getElementById('observacoesVenda').value = venda.observacoes || '';
    // Preencher campo de data com valor existente (normalizado para YYYY-MM-DD)
    try { document.getElementById('dataVenda').value = parseDateToYYYYMMDD(venda.data) || ''; } catch (e) {}

    if (Array.isArray(venda.items) && venda.items.length > 0) {
        venda.items.forEach(it => {
            const preValor = it.valorUnitario ? it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
            adicionarItemVendaRow(it.produtoId, it.quantidade, preValor);
        });
    } else {
        // compatibilidade com registro antigo
        const preValor = venda.valorUnitario ? venda.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
        adicionarItemVendaRow(venda.produtoId, venda.quantidade || 1, preValor);
    }

    atualizarTotalVendaDetalhada();

}

// Constrói opções de produtos (HTML) para selects dinâmicos
function construirOpcoesProdutos() {
    let html = '<option value="">Selecione um produto</option>';
    const produtosOrdenados = [...estoque.produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    produtosOrdenados.forEach(produto => {
        html += `<option value="${produto.id}">${produto.nome}</option>`;
    });
    return html;
}

function adicionarItemVendaRow(preProdutoId = '', preQuantidade = 1, preValor = '') {
    try {
        const container = document.getElementById('itensVendaContainer');
        if (!container) return;

        const row = document.createElement('div');
        row.className = 'item-venda-row';
        row.style.display = 'flex';
        row.style.gap = '8px';
        row.style.alignItems = 'center';
        row.style.marginBottom = '6px';

        // Construir opções com segurança
        let opcoesHtml = '';
        try {
            opcoesHtml = construirOpcoesProdutos();
        } catch (err) {
            console.error('Erro ao construir opções de produtos:', err);
            opcoesHtml = '<option value="">(nenhum produto)</option>';
        }

        row.innerHTML = `
            <select class="item-produto" onchange="autoPreencherPrecoProduto(this); atualizarItemRow(this)">${opcoesHtml}</select>
            <input type="number" class="item-quantidade" min="1" value="${preQuantidade}" style="width:90px" onchange="atualizarItemRow(this)" />
            <input type="text" class="item-valor" placeholder="Valor unit. (obrigatório)" style="width:140px" oninput="formatarMoeda(this); atualizarItemRow(this)" />
            <div class="item-subtotal" style="min-width:120px">-</div>
            <button type="button" class="btn btn-outline btn-sm" onclick="removerItemRow(this)">Remover</button>
        `;

        container.appendChild(row);

        // Preencher valores se fornecidos
        if (preProdutoId) row.querySelector('.item-produto').value = preProdutoId;
        if (preValor) row.querySelector('.item-valor').value = preValor;

        // Garantir que o input de valor remova o estado "auto-preenchido" quando o usuário editar
        try {
            const valorInp = row.querySelector('.item-valor');
            if (valorInp && !valorInp.dataset._listenerVal) {
                valorInp.addEventListener('input', () => {
                    valorInp.style.background = '';
                    valorInp.removeAttribute('data-autofilled');
                });
                valorInp.dataset._listenerVal = '1';
            }
        } catch (e) {}

        // Se já existe um cliente preenchido no modal, tentar preencher o preço salvo automaticamente
        try {
            const lojaEl = document.getElementById('lojaVenda');
            if (lojaEl && lojaEl.value && (!preValor || preValor === '')) {
                const sel = row.querySelector('.item-produto');
                if (sel) autoPreencherPrecoProduto(sel);
            }
        } catch (e) {}

        // Atualizar visual do item
        atualizarItemRow(row.querySelector('.item-produto'));
    } catch (err) {
        console.error('Erro em adicionarItemVendaRow:', err);
        mostrarNotificacao('Erro ao adicionar item. Veja o console para detalhes.', 'error');
    }
}

function removerItemRow(btn) {
    const row = btn.closest('.item-venda-row');
    if (row) {
        row.remove();
        atualizarTotalVendaDetalhada();
    }
}

function atualizarItemRow(el) {
    const row = el.closest ? el.closest('.item-venda-row') : el.parentElement;
    if (!row) return;

    const quantidade = parseInt(row.querySelector('.item-quantidade').value) || 0;
    const valorInput = row.querySelector('.item-valor').value || '';

    let unit = 0;
    if (valorInput && valorInput.trim() !== '') {
        unit = converterMoedaParaNumero(valorInput);
    }

    const subtotal = unit * quantidade;
    const subtotalEl = row.querySelector('.item-subtotal');
    subtotalEl.textContent = quantidade > 0 ? formatarMoedaValor(subtotal) : '-';

    // Placeholder fixo para reforçar valor informado na venda
    const valorEl = row.querySelector('.item-valor');
    if (valorEl && (!valorEl.value || valorEl.value.trim() === '')) {
        valorEl.placeholder = 'Valor unit. (obrigatório)';
    }

    atualizarTotalVendaDetalhada();
}

function atualizarTotalVendaDetalhada() {
    const container = document.getElementById('itensVendaContainer');
    if (!container) return;

    let total = 0;
    let totalQtd = 0;
    const rows = container.querySelectorAll('.item-venda-row');
    rows.forEach(row => {
        const quantidade = parseInt(row.querySelector('.item-quantidade').value) || 0;
        const valorInput = row.querySelector('.item-valor').value || '';

        let unit = 0;
        if (valorInput && valorInput.trim() !== '') {
            unit = converterMoedaParaNumero(valorInput);
        }

        total += unit * quantidade;
        totalQtd += quantidade;
    });

    document.getElementById('valorTotalVenda').value = total > 0 ? formatarMoedaValor(total) : '';
    document.getElementById('valorUnitarioVenda').value = totalQtd > 0 ? formatarMoedaValor(total / totalQtd) : '';
}

// Layout toggle removed per user request (button removed from modal)

function atualizarPrecoVenda() {
    // Valor de venda não é mais vinculado ao cadastro do produto.
    // Mantemos o total com base apenas nos valores informados nos itens da venda.
    atualizarTotalVendaDetalhada();
}

function validarEstoqueParaVenda(representante, itens) {
    const erros = [];
    (itens || []).forEach(it => {
        let produto = null;
        if (it.produtoId) produto = (estoque.produtos || []).find(p => p.id === it.produtoId);
        if (!produto && it.produtoNome) produto = (estoque.produtos || []).find(p => (p.nome || '').toLowerCase() === (it.produtoNome || '').toLowerCase());
        if (!produto) {
            erros.push({ produto: it.produtoNome || ('ID:' + (it.produtoId || '')), solicitado: it.quantidade || 0, disponivel: 0 });
            return;
        }
        const isImbelRep = (representante || '').toString().toUpperCase() === 'IMBEL';
        const disp = isImbelRep ? calcularImbelDisponivel(produto) : ((produto.distribuicao && produto.distribuicao[representante]) ? produto.distribuicao[representante] : 0);
        const vendido = isImbelRep ? 0 : ((produto.vendas && produto.vendas[representante]) ? produto.vendas[representante] : 0);
        const saldo = disp - vendido;
        if ((it.quantidade || 0) > saldo) {
            erros.push({ produto: produto.nome, solicitado: it.quantidade || 0, disponivel: saldo });
        }
    });
    return erros.length ? { valido: false, erros } : { valido: true };
}

function mostrarConfirmacaoEstoque(mensagem, callbackConfirmar, callbackCancelar) {
    const elMsg = document.getElementById('msgConfirmacaoEstoque');
    const modal = document.getElementById('modalConfirmacaoEstoque');
    if (!elMsg || !modal) {
        if (typeof callbackConfirmar === 'function') callbackConfirmar();
        return;
    }
    elMsg.textContent = mensagem;
    modal.style.display = 'block';
    const btn = document.getElementById('btnConfirmarVendaSemEstoque');
    if (btn) {
        btn.onclick = () => {
            fecharModal('modalConfirmacaoEstoque');
            if (typeof callbackConfirmar === 'function') callbackConfirmar();
        };
    }
    const btnCancel = modal.querySelector('.modal-footer .btn.btn-outline');
    if (btnCancel) {
        btnCancel.onclick = () => {
            fecharModal('modalConfirmacaoEstoque');
            if (typeof callbackCancelar === 'function') callbackCancelar();
        };
    }
}

function finalizarSalvamentoVendaDetalhada(params) {
    const { contrato, loja, representante, observacoes, itens, totalQtd, totalValor, isEditing, vendaAnterior, vendaAnteriorSnapshot, vendaEditandoIdLocal } = params;

    // Aplicar novos valores ao estoque
    (itens || []).forEach(it => {
        const produto = estoque.produtos.find(p => p.id === it.produtoId);
        if (produto) produto.vendas[representante] = (produto.vendas[representante] || 0) + it.quantidade;
    });

    if (isEditing && vendaAnterior) {
        const idx = estoque.registroVendas.findIndex(v => v.id === vendaEditandoIdLocal);
        if (idx !== -1) {
            estoque.registroVendas[idx].contrato = contrato;
            estoque.registroVendas[idx].loja = loja;
            estoque.registroVendas[idx].representante = representante;
            estoque.registroVendas[idx].items = itens;
            estoque.registroVendas[idx].quantidadeTotal = totalQtd;
            estoque.registroVendas[idx].valorTotal = totalValor;
            estoque.registroVendas[idx].observacoes = observacoes;
            const dataInput = document.getElementById('dataVenda') ? document.getElementById('dataVenda').value : '';
            if (dataInput && dataInput !== '') {
                try { estoque.registroVendas[idx].data = new Date(dataInput + 'T00:00:00Z').toISOString(); } catch (e) { estoque.registroVendas[idx].data = new Date().toISOString(); }
            } else {
                estoque.registroVendas[idx].data = new Date().toISOString();
            }
            try {
                registrarAuditoriaVenda(
                    'edicao',
                    vendaAnteriorSnapshot,
                    JSON.parse(JSON.stringify(estoque.registroVendas[idx])),
                    `Contrato ${contrato} atualizado (${totalQtd} itens / ${formatarMoedaValor(totalValor)})`
                );
            } catch (e) {}
        }
        vendaEditandoId = null;

        salvarDados();
        renderizarTabela();
        renderizarDashboard();
        renderizarRegistroVendas();
        fecharModal('modalVendaDetalhada');

        mostrarNotificacao(`Venda atualizada: Contrato ${contrato} - ${totalQtd} itens - ${formatarMoedaValor(totalValor)}`, 'success');
        return;
    }

    // Criar registro de venda com múltiplos itens (novo)
    const novaVenda = {
        id: Date.now(),
        contrato: contrato,
        loja: loja,
        representante: representante,
        items: itens,
        quantidadeTotal: totalQtd,
        valorTotal: totalValor,
        observacoes: observacoes,
        data: (function(){ const di = document.getElementById('dataVenda') ? document.getElementById('dataVenda').value : ''; if (di && di !== '') { try { return new Date(di + 'T00:00:00Z').toISOString(); } catch(e){} } return new Date().toISOString(); })()
    };

    estoque.registroVendas.push(novaVenda);

    try {
        registrarAuditoriaVenda(
            'criacao',
            null,
            JSON.parse(JSON.stringify(novaVenda)),
            `Contrato ${contrato} criado (${totalQtd} itens / ${formatarMoedaValor(totalValor)})`
        );
    } catch (e) {}

    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarRegistroVendas();
    fecharModal('modalVendaDetalhada');

    mostrarNotificacao(`Venda registrada: Contrato ${contrato} - ${totalQtd} itens - ${formatarMoedaValor(totalValor)}`, 'success');
}

function salvarVendaDetalhada(event) {
    if (!requireAdminOrNotify()) return;
    event.preventDefault();
    const contratoInput = (document.getElementById('contratoVenda')?.value || '').trim();
    const dataVendaVal = document.getElementById('dataVenda')?.value || '';
    const anoVenda = dataVendaVal ? new Date(dataVendaVal + 'T12:00:00').getFullYear() : new Date().getFullYear();
    const isEditing = vendaEditandoId !== null;
    let contratoFinal = contratoInput;
    if (!isEditing) {
        if (!contratoFinal) {
            contratoFinal = String(obterProximoNumeroContratoParaAno(anoVenda)).padStart(3, '0') + '/' + anoVenda;
        } else if (!contratoFinal.includes('/')) {
            contratoFinal = String(parseInt(contratoFinal, 10) || 0).padStart(3, '0') + '/' + anoVenda;
        } else {
            const parts = contratoFinal.split('/');
            const seq = String(parseInt(parts[0] || '0', 10) || 0).padStart(3, '0');
            contratoFinal = seq + '/' + anoVenda;
        }
    } else {
        // edição: manter ano se fornecido, caso contrário usar ano da data; garantir padding da sequência
        if (!contratoFinal.includes('/')) {
            contratoFinal = String(parseInt(contratoFinal || '0', 10) || 0).padStart(3, '0') + '/' + anoVenda;
        } else {
            const parts = contratoFinal.split('/');
            const seq = String(parseInt(parts[0] || '0', 10) || 0).padStart(3, '0');
            const yr = parts[1] || anoVenda;
            contratoFinal = seq + '/' + yr;
        }
    }
    const loja = document.getElementById('lojaVenda').value.trim().toUpperCase();
    const representante = document.getElementById('representanteVendaDet').value;
    const observacoes = document.getElementById('observacoesVenda').value.trim();

    // Coletar itens
    const container = document.getElementById('itensVendaContainer');
    if (!container) {
        mostrarNotificacao('Erro interno: container de itens não encontrado.', 'error');
        return;
    }

    const rows = Array.from(container.querySelectorAll('.item-venda-row'));
    if (rows.length === 0) {
        mostrarNotificacao('Adicione ao menos um item à venda.', 'error');
        return;
    }

    let itens = [];
    let erros = [];
    let totalQtd = 0;
    let totalValor = 0;

    rows.forEach((row, idx) => {
        const produtoId = parseInt(row.querySelector('.item-produto').value) || null;
        const quantidade = parseInt(row.querySelector('.item-quantidade').value) || 0;
        const valorInput = row.querySelector('.item-valor').value || '';

        if (!produtoId || quantidade <= 0) {
            erros.push(`Item ${idx + 1}: produto ou quantidade inválidos.`);
            return;
        }

        const produto = estoque.produtos.find(p => p.id === produtoId);
        if (!produto) {
            erros.push(`Item ${idx + 1}: produto não encontrado.`);
            return;
        }

        // Determinar preço unitário (obrigatório por item)
        let unit = 0;
        if (valorInput && valorInput.trim() !== '') {
            unit = converterMoedaParaNumero(valorInput);
        } else {
            erros.push(`Item ${idx + 1}: informe o valor unitário.`);
            return;
        }

        if (!unit || unit <= 0) {
            erros.push(`Item ${idx + 1}: valor unitário inválido.`);
            return;
        }

        const valorTotalItem = unit * quantidade;

        itens.push({ produtoId: produtoId, produtoNome: produto.nome, quantidade: quantidade, valorUnitario: unit, valorTotal: valorTotalItem });

        totalQtd += quantidade;
        totalValor += valorTotalItem;
    });

    if (erros.length > 0) {
        mostrarNotificacao(erros.join('\n'), 'error');
        return;
    }

    // Se estivermos editando, primeiro reverter os efeitos da venda anterior
    let vendaAnterior = null;
    let vendaAnteriorSnapshot = null;
    if (isEditing) {
        vendaAnterior = estoque.registroVendas.find(v => v.id === vendaEditandoId);
        if (!vendaAnterior) {
            mostrarNotificacao('Venda anterior não encontrada para edição.', 'error');
            vendaEditandoId = null;
            return;
        }
        try { vendaAnteriorSnapshot = JSON.parse(JSON.stringify(vendaAnterior)); } catch (e) { vendaAnteriorSnapshot = null; }

        // Reverter quantidades da venda anterior no representante antigo
        if (Array.isArray(vendaAnterior.items) && vendaAnterior.items.length > 0) {
            vendaAnterior.items.forEach(it => {
                const produto = estoque.produtos.find(p => p.id === it.produtoId);
                if (produto) {
                    produto.vendas[vendaAnterior.representante] = Math.max(0, (produto.vendas[vendaAnterior.representante] || 0) - it.quantidade);
                }
            });
        } else {
            const produto = estoque.produtos.find(p => p.id === vendaAnterior.produtoId);
            if (produto) {
                produto.vendas[vendaAnterior.representante] = Math.max(0, (produto.vendas[vendaAnterior.representante] || 0) - (vendaAnterior.quantidade || 0));
            }
        }
    }

    // Validar estoque antes de salvar
    const validacao = validarEstoqueParaVenda(representante, itens);
    if (!validacao.valido) {
        let msg = '⚠️ Estoque insuficiente para ' + representante + ':\n\n';
        validacao.erros.forEach(e => { msg += `• ${e.produto}: solicitado ${e.solicitado}, disponível ${e.disponivel}\n`; });
        msg += '\nDeseja registrar mesmo assim?';

        const cancelarCallback = () => {
            // re-aplica venda anterior caso o usuário cancele
            if (isEditing && vendaAnterior) {
                if (Array.isArray(vendaAnterior.items) && vendaAnterior.items.length > 0) {
                    vendaAnterior.items.forEach(it => {
                        const produto = estoque.produtos.find(p => p.id === it.produtoId);
                        if (produto) produto.vendas[vendaAnterior.representante] = (produto.vendas[vendaAnterior.representante] || 0) + it.quantidade;
                    });
                } else {
                    const produto = estoque.produtos.find(p => p.id === vendaAnterior.produtoId);
                    if (produto) produto.vendas[vendaAnterior.representante] = (produto.vendas[vendaAnterior.representante] || 0) + (vendaAnterior.quantidade || 0);
                }
                vendaEditandoId = null;
            }
        };

        mostrarConfirmacaoEstoque(msg, () => {
            finalizarSalvamentoVendaDetalhada({ contrato: contratoFinal, loja, representante, observacoes, itens, totalQtd, totalValor, isEditing, vendaAnterior, vendaAnteriorSnapshot, vendaEditandoIdLocal: vendaEditandoId });
        }, cancelarCallback);

        return;
    }

    // Se válido, finalizar imediatamente
    finalizarSalvamentoVendaDetalhada({ contrato: contratoFinal, loja, representante, observacoes, itens, totalQtd, totalValor, isEditing, vendaAnterior, vendaAnteriorSnapshot, vendaEditandoIdLocal: vendaEditandoId });
}

function renderizarRegistroVendas() {
    const tbody = document.getElementById('tabelaRegistroVendasBody');
    if (!tbody) return;
    
    const filtroRep = document.getElementById('filtroRepresentante')?.value || '';
    const filtroProduto = document.getElementById('filtroProduto')?.value || '';
    const filtroProdutoId = filtroProduto ? parseInt(filtroProduto) : null;
    const filtroDataInicio = document.getElementById('filtroVendasDataInicio')?.value || '';
    const filtroDataFim = document.getElementById('filtroVendasDataFim')?.value || '';
    
    let vendasFiltradas = estoque.registroVendas || [];
    
    if (filtroRep) {
        vendasFiltradas = vendasFiltradas.filter(v => v.representante === filtroRep);
    }

    // Expandir vendas para linhas de item (cada produto vira uma linha)
    const linhas = [];
    vendasFiltradas.forEach(venda => {
        const dataNorm = parseDateToYYYYMMDD(venda.data) || '';
        if (filtroDataInicio && dataNorm && dataNorm < filtroDataInicio) return;
        if (filtroDataFim && dataNorm && dataNorm > filtroDataFim) return;
        if ((filtroDataInicio || filtroDataFim) && !dataNorm) return;

        const rawContrato = (venda.contrato ?? '').toString().normalize('NFKC');
        const contratoClean = rawContrato.replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
        const somenteDigitos = contratoClean.replace(/\D+/g, '');
        const contratoKey = somenteDigitos ? String(parseInt(somenteDigitos, 10)) : contratoClean.toUpperCase();

        if (Array.isArray(venda.items) && venda.items.length > 0) {
            venda.items.forEach(it => {
                if (filtroProdutoId && it.produtoId !== filtroProdutoId) return;
                const qtd = Number(it.quantidade || 0);
                const valorUnNum = Number(it.valorUnitario || 0);
                const valorTotNum = Number(it.valorTotal || (valorUnNum * qtd) || 0);
                linhas.push({
                    vendaId: venda.id,
                    contratoKey,
                    contratoRaw: venda.contrato,
                    loja: venda.loja || '-',
                    representante: venda.representante || '-',
                    dataNorm,
                    observacoes: venda.observacoes || '-',
                    produtoNome: it.produtoNome || '-',
                    quantidade: qtd,
                    valorUnitario: valorUnNum,
                    valorTotal: valorTotNum
                });
            });
        } else {
            if (filtroProdutoId && venda.produtoId !== filtroProdutoId) return;
            const qtd = Number(venda.quantidade || 0);
            const valorUnNum = Number(venda.valorUnitario || 0);
            const valorTotNum = Number(venda.valorTotal || (valorUnNum * qtd) || 0);
            linhas.push({
                vendaId: venda.id,
                contratoKey,
                contratoRaw: venda.contrato,
                loja: venda.loja || '-',
                representante: venda.representante || '-',
                dataNorm,
                observacoes: venda.observacoes || '-',
                produtoNome: venda.produtoNome || '-',
                quantidade: qtd,
                valorUnitario: valorUnNum,
                valorTotal: valorTotNum
            });
        }
    });

    // Ordenar conforme seleção do usuário (estado genérico _sortState, fallback para _ordenVendas)
    const sortV = _sortState['vendas'] || { col: _ordenVendas.campo || 'contrato', dir: _ordenVendas.direcao || 'asc' };
    const getValVenda = (l, col) => {
        if (!l) return '';
        if (col === 'contrato') {
            const n = parseInt(l.contratoKey);
            return isNaN(n) ? String(l.contratoKey || '') : n;
        }
        if (col === 'valorTotal') return Number(l.valorTotal || 0);
        if (col === 'quantidade') return Number(l.quantidade || 0);
        if (col === 'data') return l.dataNorm || '';
        if (col === 'loja') return l.loja || '';
        if (col === 'representante') return l.representante || '';
        if (col === 'produtoNome') return l.produtoNome || '';
        return l[col] ?? '';
    };

    const linhasOrdenadas = getSortedArray(linhas, sortV.col, sortV.dir, getValVenda);

    tbody.innerHTML = '';

    if (linhasOrdenadas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="empty-state">
                    <div class="empty-icon">📋</div>
                    <div class="empty-text">Nenhuma venda registrada</div>
                    <div class="empty-hint">Clique em "Nova Venda" para adicionar o primeiro registro</div>
                </td>
            </tr>
        `;
        atualizarTotaisVendas(0, 0);
        return;
    }

    let totalQtd = 0;
    let totalValor = 0;

    // Agrupar mantendo a ordem das linhas ordenadas
    const grupos = {};
    const orderedKeys = [];
    linhasOrdenadas.forEach(linha => {
        const k = linha.contratoKey;
        if (!grupos[k]) { grupos[k] = []; orderedKeys.push(k); }
        grupos[k].push(linha);
    });

    // Determinar chaves na ordem apropriada; se o usuário ordenou por 'contrato', ordenar numericamente
    let chavesOrdenadas = orderedKeys.slice();
    if (sortV.col === 'contrato') {
        chavesOrdenadas = Object.keys(grupos).sort((a, b) => {
            const na = parseInt(a);
            const nb = parseInt(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
        });
        if (sortV.dir === 'desc') chavesOrdenadas.reverse();
    }

    // Remover overlay de debug temporário se existir
    const dbg = document.getElementById('debug-grupos-vendas');
    if (dbg) dbg.remove();

    chavesOrdenadas.forEach(contratoKey => {
        const grupo = grupos[contratoKey] || [];
        const linhasDoContrato = grupo.length;
        if (!linhasDoContrato) return;

        const totalContrato = grupo.reduce((sum, linha) => sum + (Number(linha.valorTotal) || 0), 0);
        const totalQtdContrato = grupo.reduce((sum, linha) => sum + (Number(linha.quantidade) || 0), 0);
        const primeira = grupo[0];
        const repClass = (primeira.representante || '').toLowerCase();
        const obsGrupo = grupo.find(g => g.observacoes && g.observacoes !== '-')?.observacoes || primeira.observacoes || '-';
        const minData = grupo.map(g => g.dataNorm).filter(Boolean).sort()[0] || null;
        const maxData = grupo.map(g => g.dataNorm).filter(Boolean).sort().slice(-1)[0] || null;
        const dataDisplay = minData
            ? (maxData && maxData !== minData
                ? `${formatDateToDDMMYYYY(minData)} até ${formatDateToDDMMYYYY(maxData)}`
                : formatDateToDDMMYYYY(minData))
            : '-';

        const expandido = !!_contratosExpandidos[contratoKey];

        // verificar se todas as vendas deste contrato estão canceladas
        const vendasDoContrato = (estoque.registroVendas || []).filter(v => normalizarContratoKey(v.contrato) === contratoKey);
        const contratoCancelado = vendasDoContrato.length > 0 && vendasDoContrato.every(v => !!v.cancelado);
        const cancelBadgeHtml = contratoCancelado ? '<span class="badge-cancelado">CANCELADO</span>' : '';

        const resumo = document.createElement('tr');
        resumo.className = 'row-contrato-resumo' + (contratoCancelado ? ' contrato-cancelado' : '');
        const fallbackYear = primeira.dataNorm ? (primeira.dataNorm.slice(0,4)) : new Date().getFullYear();
        const contratoDisplay = formatarContratoDisplay(primeira.contratoRaw || primeira.contratoKey, fallbackYear);
        let actionsHtml = '';
        if (contratoCancelado) {
            actionsHtml = '<span class="badge-cancelado">CANCELADO</span>';
        } else {
            actionsHtml = `<button class="btn-action btn-edit" onclick="abrirModalVendaDetalhada(${primeira.vendaId})" title="Editar venda">✎</button>` +
                          `<button class="btn-action btn-delete" onclick="excluirVenda(${primeira.vendaId})" title="Excluir venda">🗑</button>` +
                          `<button class="btn-action" onclick="abrirHistoricoContrato('${contratoKey}')" title="Histórico do Contrato">🕘</button>` +
                          `<button class="btn-action btn-cancel" onclick="cancelarContrato('${contratoKey}')" title="Cancelar contrato">✖</button>` +
                          `<button class="btn btn-outline btn-sm" onclick="gerarContratoVenda('${primeira.vendaId || primeira.contratoRaw}')" title="Gerar contrato .docx" style="color:#1e3a5f;border-color:#1e3a5f">📄 Contrato</button>`;
        }

        resumo.innerHTML = `
            <td class="col-contrato">${contratoDisplay || '-'} ${cancelBadgeHtml}</td>
            <td class="col-loja" title="${primeira.loja}">${primeira.loja}</td>
            <td class="col-representante"><span class="badge-rep ${repClass}">${primeira.representante}</span></td>
            <td class="col-produto-venda"><button class="btn-expand-contrato" onclick="toggleContratoExpandido('${contratoKey}')">${expandido ? '▾' : '▸'} ${linhasDoContrato} item(ns)</button></td>
            <td class="col-qtd">${totalQtdContrato}</td>
            <td class="col-valor-un">-</td>
            <td class="col-valor-total">${formatarMoedaValor(totalContrato)}</td>
            <td class="col-data">${dataDisplay}</td>
            <td class="col-obs" title="${obsGrupo}">${obsGrupo}</td>
            <td class="col-acoes">${actionsHtml}</td>
        `;
        tbody.appendChild(resumo);

        grupo.forEach((linha) => {
            const tr = document.createElement('tr');
            tr.className = `row-contrato-detalhe ${expandido ? '' : 'hidden-row'}`;
            const valorUn = linha.valorUnitario ? formatarMoedaValor(linha.valorUnitario) : '-';
            const valorTot = linha.valorTotal || 0;
            totalQtd += linha.quantidade || 0;
            totalValor += valorTot || 0;

            // verificar se a venda específica está cancelada
            const vendaObj = estoque.registroVendas.find(v => v.id === linha.vendaId);
            const isLinhaCancelada = vendaObj && vendaObj.cancelado;
                        const detalheAcoesHtml = isLinhaCancelada
                                ? '<span class="badge-cancelado">CANCELADO</span>'
                                : `<button class="btn-action btn-edit" onclick="abrirModalVendaDetalhada(${linha.vendaId})" title="Editar venda">✎</button>` +
                                    `<button class="btn-action btn-delete" onclick="excluirVenda(${linha.vendaId})" title="Excluir venda">🗑</button>` +
                                    `<button class="btn btn-outline btn-sm" onclick="gerarContratoVenda('${linha.vendaId || linha.contratoKey}')" title="Gerar contrato .docx" style="color:#1e3a5f;border-color:#1e3a5f">📄 Contrato</button>`;

            tr.innerHTML = `
                <td class="col-contrato detalhe-vazio"></td>
                <td class="col-loja detalhe-vazio"></td>
                <td class="col-representante detalhe-vazio"></td>
                <td class="col-produto-venda" title="${linha.produtoNome}">↳ ${linha.produtoNome}</td>
                <td class="col-qtd">${linha.quantidade}</td>
                <td class="col-valor-un">${valorUn}</td>
                <td class="col-valor-total">${valorTot > 0 ? formatarMoedaValor(valorTot) : '-'}</td>
                <td class="col-data">${linha.dataNorm ? formatDateToDDMMYYYY(linha.dataNorm) : '-'}</td>
                <td class="col-obs" title="${linha.observacoes || '-'}">${linha.observacoes || '-'}</td>
                <td class="col-acoes">${detalheAcoesHtml}</td>
            `;

            tbody.appendChild(tr);
        });
    });
    
    atualizarTotaisVendas(totalQtd, totalValor);
    // Rodapé resumido para o período filtrado
    try {
        const totalFiltrado = linhas.reduce((s, l) => s + (Number(l.valorTotal) || 0), 0);
        const totalUnidades = linhas.reduce((s, l) => s + (Number(l.quantidade) || 0), 0);
        const qtdContratos = new Set(linhas.map(l => l.contratoKey)).size;

        const tfoot = document.querySelector('#tabelaRegistroVendas tfoot') || document.createElement('tfoot');
        const fmtVal = v => formatarMoedaValor(Number(v) || 0);
        tfoot.innerHTML = `
            <tr style="background:#1e3a5f;color:#fff;font-weight:700">
              <td colspan="3" style="padding:10px 14px;text-align:left">📊 ${qtdContratos} contrato(s) · ${linhas.length} linha(s)</td>
              <td style="padding:10px;text-align:center">${totalUnidades}</td>
              <td colspan="2"></td>
              <td style="padding:10px;text-align:right;color:#7ee787;font-size:1rem">${fmtVal(totalFiltrado)}</td>
              <td></td>
            </tr>`;

        const table = document.getElementById('tabelaRegistroVendas') || (tbody && tbody.closest && tbody.closest('table'));
        if (table) {
            const existing = table.querySelector('tfoot');
            if (existing) existing.remove();
            table.appendChild(tfoot);
        }
    } catch (e) { console.warn('Erro ao renderizar rodapé de totais vendas', e); }
}

function atualizarTotaisVendas(totalQtd, totalValor) {
    const spanQtd = document.getElementById('totalQtdVendas');
    const spanValor = document.getElementById('totalValorVendas');
    
    if (spanQtd) spanQtd.innerHTML = `<strong>${totalQtd.toLocaleString('pt-BR')}</strong>`;
    if (spanValor) spanValor.innerHTML = `<strong>${formatarMoedaValor(totalValor)}</strong>`;
}

function toggleContratoExpandido(contratoKey) {
    _contratosExpandidos[contratoKey] = !_contratosExpandidos[contratoKey];
    renderizarRegistroVendas();
}

function abrirHistoricoContrato(contratoInformado = '') {
    const contrato = (contratoInformado || prompt('Informe o contrato para visualizar o histórico:') || '').trim();
    if (!contrato) return;

    const lista = obterAuditoriaPorContrato(contrato);
    const container = document.getElementById('historicoConteudo');
    if (!container) return;

    if (lista.length === 0) {
        container.innerHTML = `<p style="text-align:center;color:var(--text-secondary);padding:20px">Nenhum histórico encontrado para o contrato ${contrato}.</p>`;
    } else {
        container.innerHTML = lista.map(h => {
            const dt = h.quando ? new Date(h.quando).toLocaleString('pt-BR') : '-';
            const quem = h.quem || 'Usuário';
            const acao = (h.acao || '-').toUpperCase();
            const desc = h.detalhes || '-';
            return `<div class="historico-item">
                <span class="hist-data">${dt}<br><small>${quem}</small></span>
                <span class="hist-tipo venda">${acao}</span>
                <span class="hist-descricao">${desc}</span>
            </div>`;
        }).join('');
    }

    document.getElementById('modalHistorico').style.display = 'flex';
}

function filtrarVendas() {
    renderizarRegistroVendas();
}

function limparFiltrosVendas() {
    const fields = [
        'filtroRepresentante',
        'filtroProduto',
        'filtroVendasDataInicio',
        'filtroVendasDataFim'
    ];
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    renderizarRegistroVendas();
}

function filtroVendasRapido(periodo) {
    const inicio = document.getElementById('filtroVendasDataInicio');
    const fim = document.getElementById('filtroVendasDataFim');
    if (!inicio || !fim) return;

    const hoje = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const hojeStr = fmt(hoje);

    if (periodo === 'limpar') {
        inicio.value = '';
        fim.value = '';
        renderizarRegistroVendas();
        return;
    }

    if (periodo === 'hoje') {
        inicio.value = hojeStr;
        fim.value = hojeStr;
    }

    if (periodo === 'semana') {
        const seteDias = new Date(hoje);
        seteDias.setDate(seteDias.getDate() - 6);
        inicio.value = fmt(seteDias);
        fim.value = hojeStr;
    }

    if (periodo === 'mes') {
        const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
        const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
        inicio.value = fmt(primeiroDia);
        fim.value = fmt(ultimoDia);
    }

    if (periodo === 'ano') {
        inicio.value = `${hoje.getFullYear()}-01-01`;
        fim.value = `${hoje.getFullYear()}-12-31`;
    }

    renderizarRegistroVendas();
}

function excluirVenda(vendaId) {
    if (!requireAdminOrNotify()) return;
    const venda = estoque.registroVendas.find(v => v.id === vendaId);
    let vendaSnapshot = null;
    try { vendaSnapshot = venda ? JSON.parse(JSON.stringify(venda)) : null; } catch (e) { vendaSnapshot = null; }

    if (!venda) {
        mostrarNotificacao('Venda não encontrada!', 'error');
        return;
    }

    // Mensagem resumo para confirmação
    let resumo = '';
    if (Array.isArray(venda.items) && venda.items.length > 0) {
        resumo = venda.items.map(it => `${it.produtoNome} x ${it.quantidade}`).join('\n');
    } else {
        resumo = `${venda.produtoNome || '-'} x ${venda.quantidade || 0}`;
    }

    if (!confirm(`Deseja excluir a venda do contrato ${venda.contrato}?\n\n${resumo}\n\nATENÇÃO: As quantidades serão devolvidas ao estoque do representante.`)) {
        return;
    }

    // Devolver ao estoque: lidar com vendas multi-itens
    if (Array.isArray(venda.items) && venda.items.length > 0) {
        venda.items.forEach(it => {
            const produto = estoque.produtos.find(p => p.id === it.produtoId);
            if (produto) {
                produto.vendas[venda.representante] = Math.max(0, (produto.vendas[venda.representante] || 0) - it.quantidade);
            }
        });
    } else {
        const produto = estoque.produtos.find(p => p.id === venda.produtoId);
        if (produto) {
            produto.vendas[venda.representante] = Math.max(0, (produto.vendas[venda.representante] || 0) - venda.quantidade);
        }
    }

    // Remover do registro
    estoque.registroVendas = estoque.registroVendas.filter(v => v.id !== vendaId);
    
    // Remover do controle de envio se este era o último contrato
    const contratoRestante = estoque.registroVendas.some(v => v.contrato === venda.contrato);
    if (!contratoRestante && estoque.controleEnvio[venda.contrato]) {
        delete estoque.controleEnvio[venda.contrato];
    }

    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarRegistroVendas();
    renderizarControleEnvio();

    mostrarNotificacao(`Venda do contrato ${venda.contrato} excluída com sucesso!`, 'success');

    try {
        registrarAuditoriaVenda(
            'exclusao',
            vendaSnapshot,
            null,
            `Contrato ${venda.contrato} excluído`
        );
    } catch (e) {}
}

function cancelarContrato(contratoKey) {
    if (!requireAdminOrNotify()) return;
    if (!contratoKey) return mostrarNotificacao('Contrato inválido para cancelamento.', 'error');
    const ok = confirm(`Confirma cancelamento do contrato ${contratoKey}?\n\nAs quantidades serão devolvidas ao representante e a comissão não será considerada.`);
    if (!ok) return;

    const vendasAfetadas = (estoque.registroVendas || []).filter(v => normalizarContratoKey(v.contrato) === contratoKey && !v.cancelado);
    if (vendasAfetadas.length === 0) {
        mostrarNotificacao(`Nenhuma venda ativa encontrada para o contrato ${contratoKey}.`, 'warning');
        return;
    }

    vendasAfetadas.forEach(venda => {
        let snapshot = null;
        try { snapshot = JSON.parse(JSON.stringify(venda)); } catch (e) { snapshot = null; }

        // Reverter quantidades vendidas no representante
        if (Array.isArray(venda.items) && venda.items.length > 0) {
            venda.items.forEach(it => {
                const produto = estoque.produtos.find(p => p.id === it.produtoId);
                if (produto) produto.vendas[venda.representante] = Math.max(0, (produto.vendas[venda.representante] || 0) - it.quantidade);
            });
        } else {
            const produto = estoque.produtos.find(p => p.id === venda.produtoId);
            if (produto) produto.vendas[venda.representante] = Math.max(0, (produto.vendas[venda.representante] || 0) - (venda.quantidade || 0));
        }

        venda.cancelado = true;
        venda.canceladoEm = new Date().toISOString();
        venda.canceladoPor = getUsuarioAtual();

        try {
            registrarAuditoriaVenda('cancelamento', snapshot, JSON.parse(JSON.stringify(venda)), `Contrato ${contratoKey} cancelado`);
        } catch (e) {}
    });

    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarRegistroVendas();
    renderizarControleEnvio();

    mostrarNotificacao(`Contrato ${contratoKey} cancelado. Quantidades devolvidas ao representante.`, 'success');
}

async function gerarContratoVenda(vendaId) {
    // Find the sale
    const venda = (estoque.registroVendas||[]).find(v =>
        v.id == vendaId || v.contrato == vendaId
    );
    if (!venda) {
        mostrarNotificacao('Venda não encontrada.', 'error');
        return;
    }

    // Find client data
    const clienteObj = (clientes||[]).find(c =>
        (c.nome||'').toLowerCase() === (venda.loja||'').toLowerCase()
    );

    // Load configs
    const vendedor = carregarConfigVendedor();
    const rep      = getConfigRep(venda.representante || '');

    // Resolve items
    const itens = (venda.items || venda.itens || []);
    if (!itens.length) {
        mostrarNotificacao('Esta venda não tem itens cadastrados.', 'warning');
        return;
    }

    // Dates
    const dataVenda = venda.data
        ? new Date(venda.data + 'T12:00:00')
        : new Date();
    const dataFim   = new Date(dataVenda);
    dataFim.setMonth(dataFim.getMonth() + 6);

    const fmtDate = d => d.toLocaleDateString('pt-BR');
    const fmtMoeda = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR',
        {minimumFractionDigits:2, maximumFractionDigits:2});

    const totalContrato = itens.reduce((s, it) =>
        s + (Number(it.valorTotal || (it.quantidade*(it.valorUnitario||it.valorUnit||0))) || 0), 0);

    // ── BUILD DOCX ──
    const {
        Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign,
        HeadingLevel
    } = docx;

    const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

    const bold  = (text, sz=20) => new TextRun({ text, bold: true, size: sz, font: 'Calibri' });
    const norm  = (text, sz=20) => new TextRun({ text, size: sz, font: 'Calibri' });
    const red   = (text, sz=20) => new TextRun({ text, bold: true, size: sz, font: 'Calibri', color: 'C00000' });
    const para  = (children, align=AlignmentType.LEFT, spacing={}) =>
        new Paragraph({ children, alignment: align,
            spacing: { before: 60, after: 60, ...spacing } });
    const paraBold = (text, align=AlignmentType.LEFT) =>
        para([bold(text)], align);
    const emptyPara = () => new Paragraph({ children: [norm('')] });

    // Helper: table cell
    const cell = (children, widthDxa, opts={}) => new TableCell({
        children: Array.isArray(children) ? children : [para([norm(children||'')])],
        width: { size: widthDxa, type: WidthType.DXA },
        borders,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        ...opts
    });
    const cellBold = (text, widthDxa, opts={}) => new TableCell({
        children: [para([bold(text||'')])],
        width: { size: widthDxa, type: WidthType.DXA },
        borders,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        ...opts
    });
    const headerCell = (text, widthDxa) => new TableCell({
        children: [para([bold(text, 20)], AlignmentType.CENTER)],
        width: { size: widthDxa, type: WidthType.DXA },
        borders,
        shading: { fill: 'D9D9D9', type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });

    const TW = 9360; // table width in DXA (US Letter 1" margins)

    // ── PRODUCTS TABLE (Cláusula 1ª) ──
    const prodRows = itens.map(it => {
        const nome      = it.produtoNome || it.produto || '—';
        const qtd       = Number(it.quantidade) || 0;
        const valorUnit = Number(it.valorUnitario || it.valorUnit || 0);
        const valorTot  = Number(it.valorTotal || qtd * valorUnit || 0);
        return new TableRow({ children: [
            cell(nome,            5400),
            cell(String(qtd),      900, { verticalAlign: VerticalAlign.CENTER }),
            cell(fmtMoeda(valorUnit), 1530, { verticalAlign: VerticalAlign.CENTER }),
            cell(fmtMoeda(valorTot),  1530, { verticalAlign: VerticalAlign.CENTER }),
        ]});
    });

    const tabelaProdutos = new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [5400, 900, 1530, 1530],
        rows: [
            new TableRow({ children: [
                headerCell('Calibre/ Modelo/ ADC/ Cor\n(no caso de peça, discriminar o calibre da arma e cor)', 5400),
                headerCell('Qtd', 900),
                headerCell('Valor Unitário', 1530),
                headerCell('Valor Total', 1530),
            ]}),
            ...prodRows,
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('VALOR TOTAL DO CONTRATO')], AlignmentType.RIGHT)] ,
                    width: { size: 6300, type: WidthType.DXA },
                    columnSpan: 3,
                    borders,
                    margins: { top: 80, bottom: 80, left: 120, right: 120 },
                }),
                cellBold(fmtMoeda(totalContrato), 1530),
            ]}),
        ]
    });

    // ── VENDEDOR TABLE ──
    const tabelaVendedor = new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [2340, 2340, 2340, 2340],
        rows: [
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('VENDEDOR', 22)], AlignmentType.LEFT)],
                    columnSpan: 4,
                    width: { size: TW, type: WidthType.DXA },
                    shading: { fill: 'D9D9D9', type: ShadingType.CLEAR },
                    borders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Nome: '), norm(vendedor.nomeEmpresa||'')])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('CNPJ/MF: '), norm(vendedor.cnpj||'')])],
                    columnSpan: 2, width:{size:4680,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
                new TableCell({
                    children: [para([bold('Inscrição estadual: '), norm(vendedor.inscricaoEstadual||'')])],
                    columnSpan: 2, width:{size:4680,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Endereço: '), norm(vendedor.endereco||'')])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                cell([para([bold('Bairro: '), norm(vendedor.bairro||'')])] , 2340),
                cell([para([bold('Cidade: '), norm(vendedor.cidade||'')])] , 2340),
                cell([para([bold('UF: '),     norm(vendedor.uf||'')])]     , 2340),
                cell([para([bold('CEP: '),    norm(vendedor.cep||'')])]    , 2340),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Registro no EB: '), norm(vendedor.registroEB||'')])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
        ]
    });

    // ── COMPRADOR TABLE ──
    // Parse client address into parts
    const endCliente  = clienteObj?.endereco || '';
    const cidCliente  = clienteObj?.cidade   || '';
    const ufCliente   = clienteObj?.uf       || '';
    const cnpjCliente = clienteObj?.cnpj     || '';
    const regEB       = clienteObj?.registroEB || '';

    const tabelaComprador = new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [2340, 2340, 2340, 2340],
        rows: [
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('COMPRADOR', 22)])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    shading: { fill: 'D9D9D9', type: ShadingType.CLEAR },
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Nome: '), norm(venda.loja||'')])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('CNPJ/CPF: '), norm(cnpjCliente)])],
                    columnSpan: 2, width:{size:4680,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
                new TableCell({
                    children: [para([bold('Inscrição estadual: ')])],
                    columnSpan: 2, width:{size:4680,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Endereço: '), norm(endCliente)])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                cell([para([bold('Bairro: ')])]              , 2340),
                cell([para([bold('Cidade: '), norm(cidCliente)])], 2340),
                cell([para([bold('UF: '),     norm(ufCliente)])]  , 2340),
                cell([para([bold('CEP: ')])]                 , 2340),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Registro no EB: '), norm(regEB)])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
        ]
    });

    // ── REPRESENTANTE TABLE ──
    const tabelaRep = new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [3120, 1560, 2340, 2340],
        rows: [
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('REPRESENTANTE COMERCIAL AUTORIZADO', 22)])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    shading: { fill: 'D9D9D9', type: ShadingType.CLEAR },
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Razão Social: '), norm(rep.razaoSocial||'')])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Nome Fantasia: '), norm(rep.nomeFantasia||'')])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                cell([para([bold('CNPJ: '), norm(rep.cnpj||'')])]       , 3120),
                cell([para([bold('Nº CORE: '), norm(rep.nrCore||'')])]  , 1560),
                new TableCell({
                    children: [para([bold('UF: '), norm(rep.ufCore||'')])],
                    columnSpan: 2, width:{size:4680,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Nome do responsável: '), norm(rep.nomeResponsavel||'')])],
                    columnSpan: 4, width:{size:TW,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
            new TableRow({ children: [
                new TableCell({
                    children: [para([bold('Telefone: '), norm(rep.telefone||'')])],
                    columnSpan: 2, width:{size:4680,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
                new TableCell({
                    children: [para([bold('E-mail: '), norm(rep.email||'')])],
                    columnSpan: 2, width:{size:4680,type:WidthType.DXA},
                    borders, margins:{top:80,bottom:80,left:120,right:120},
                }),
            ]}),
        ]
    });

    // ── ASSEMBLE DOCUMENT ──
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    size: { width: 12240, height: 15840 },
                    margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
                }
            },
            children: [
                // Title
                para([bold('CONTRATO DE COMPRA E VENDA DE ARMAMENTO, PEÇAS', 28)],
                         AlignmentType.CENTER),
                para([bold('E ACESSÓRIOS DE PRODUTOS CONTROLADOS E NÃO CONTROLADOS', 28)],
                         AlignmentType.CENTER),
                emptyPara(),

                // Contract number header block
                para([
                    bold('CONTRATO Nº '),
                    red(String(venda.contrato||'____')),
                    bold('/'),
                    red(String(dataVenda.getFullYear())),
                    bold(' – Fábrica de Itajubá/IMBEL'),
                ], AlignmentType.CENTER, { before: 120, after: 80 }),

                para([bold('VENDEDOR: '), norm(vendedor.nomeEmpresa||'Fábrica de Itajubá – IMBEL')],
                         AlignmentType.LEFT),
                para([bold('COMPRADOR: '), norm(venda.loja||'')]),
                para([bold('REPRESENTANTE COMERCIAL AUTORIZADO: '),
                            norm(rep.razaoSocial || venda.representante || '')]),
                para([bold('OBJETO: '), norm(
                    'Compra e venda de armamento, peças e acessórios do portfólio da ' +
                    'Fábrica de Itajubá da IMBEL, em especial: ' +
                    itens.map(it => it.produtoNome||it.produto||'').join(', ') + '.'
                )]),
                para([bold('VIGÊNCIA DO CONTRATO: '),
                            norm(fmtDate(dataVenda) + ' a ' + fmtDate(dataFim) + '.')]),
                emptyPara(),

                // Vendedor table
                tabelaVendedor,
                emptyPara(),

                // Comprador table
                tabelaComprador,
                emptyPara(),

                // Representante table
                tabelaRep,
                emptyPara(),

                // Preamble
                para([bold('Pelo presente instrumento e na melhor forma de direito, as partes acima ' +
                    'qualificadas celebram o CONTRATO DE COMPRA E VENDA, o qual se regerá ' +
                    'pelas seguintes cláusulas e condições:')],
                    AlignmentType.JUSTIFIED),
                emptyPara(),

                // Clause 1
                para([bold('CLÁUSULA 1ª – DO OBJETO E DO VALOR TOTAL DO CONTRATO')]),
                para([norm(
                    'O VENDEDOR vende ao COMPRADOR, e este compra daquele, o(s) produto(s) ' +
                    'descrito(s) e caracterizado(s) no quadro abaixo:'
                )], AlignmentType.JUSTIFIED),
                emptyPara(),

                tabelaProdutos,
                emptyPara(),

                // Clause 2
                para([bold('CLÁUSULA 2ª – DAS CONDIÇÕES DE PAGAMENTO')]),
                para([norm('2.1 O pagamento será realizado mediante Guia de Recolhimento da União – GRU, em uma única parcela.')]),
                para([norm('2.2 A GRU será enviada para o e-mail do COMPRADOR em até 30 (trinta) dias após a assinatura deste Contrato.')]),
                para([norm('2.3 A GRU terá prazo de vencimento de 30 (trinta) dias após a sua emissão.')]),
                para([norm('2.4 O não pagamento da GRU, até a data de vencimento, implicará no cancelamento automático do contrato.')]),
                emptyPara(),

                // Clause 3
                para([bold('CLÁUSULA 3ª – DA ENTREGA')]),
                para([norm('3.1 A entrega será realizada em até 180 (cento e oitenta) dias após a data de assinatura do presente contrato pelo VENDEDOR.')]),
                para([norm('3.2 Se por motivo de força maior ou caso fortuito não for possível à IMBEL cumprir a entrega, o prazo ficará automaticamente prorrogado por 90 (noventa) dias, e assim sucessivamente.')]),
                emptyPara(),

                // Clause 4
                para([bold('CLÁUSULA 4ª – DO LOCAL E DAS CONDIÇÕES DE ENTREGA')]),
                para([norm('4.1 O(s) produto(s) somente poderão ser entregues ao COMPRADOR mediante cumprimento das Portarias emitidas pelo COLOG.')]),
                para([norm('4.2 O(s) produto(s) será(ão) entregue(s) ao COMPRADOR na Fábrica de Itajubá – FI, Av. Cel. Aventino Ribeiro, 1099 – Bairro IMBEL, Itajubá-MG, COM PRÉ-AGENDAMENTO (obrigatório).')]),
                para([norm('4.3 A retirada somente poderá ser efetuada pelo COMPRADOR na FI ou por empresa transportadora contratada pelo próprio COMPRADOR, com Certificado de Registro – CR com atividade de transporte.')]),
                emptyPara(),

                // Clause 5
                para([bold('CLÁUSULA 5ª – DA RESCISÃO DO CONTRATO')]),
                para([norm('5.1 Em caso de desistência antes do faturamento, o contrato resultará rescindido de pleno direito.')]),
                para([norm('5.2 Nesta hipótese, o VENDEDOR devolverá ao COMPRADOR, em até 30 dias, a importância paga, deduzida de 10% a título de cláusula penal compensatória.')]),
                emptyPara(),

                // Clause 6
                para([bold('CLÁUSULA 6ª – DA GARANTIA E ASSISTÊNCIA TÉCNICA')]),
                para([norm('6.1 Fica estabelecido o prazo de garantia de 12 (doze) meses contra eventuais defeitos de fabricação, desde que cumpridas as recomendações do manual do produto.')]),
                emptyPara(),

                // Clause 7
                para([bold('CLÁUSULA 7ª – DISPOSIÇÕES GERAIS')]),
                para([norm('7.1 O REPRESENTANTE COMERCIAL AUTORIZADO é responsável pela verificação de todos os documentos legais exigidos do COMPRADOR e por prestar qualquer esclarecimento sobre o presente contrato.')]),
                emptyPara(),

                // Clause 8
                para([bold('CLÁUSULA 8ª – DO FORO')]),
                para([norm('8.1 As partes elegem o foro da Justiça Federal de Pouso Alegre – MG, como competente para dirimir quaisquer questões relacionadas ao presente contrato.')]),
                emptyPara(),

                para([norm(
                    'E por estarem assim justos e contratados, assinam o presente instrumento ' +
                    'em duas vias de igual teor.'
                )], AlignmentType.JUSTIFIED),
                emptyPara(),

                // Local e data
                para([norm('Itajubá/MG, ' + fmtDate(dataVenda) + '.')], AlignmentType.RIGHT),
                emptyPara(),
                emptyPara(),

                // Signatures
                para([norm('COMPRADOR')], AlignmentType.CENTER),
                para([norm('__________________________________________________')], AlignmentType.CENTER),
                para([norm(venda.loja||'')], AlignmentType.CENTER),
                para([norm(cnpjCliente)], AlignmentType.CENTER),
                emptyPara(),
                emptyPara(),

                para([norm('REPRESENTANTE COMERCIAL DA IMBEL')], AlignmentType.CENTER),
                para([norm('__________________________________________________')], AlignmentType.CENTER),
                para([norm(rep.nomeResponsavel||venda.representante||'')], AlignmentType.CENTER),
                para([norm(rep.cnpj||'')], AlignmentType.CENTER),
                emptyPara(),
                emptyPara(),

                para([norm('VENDEDOR')], AlignmentType.CENTER),
                para([norm('__________________________________________________')], AlignmentType.CENTER),
                para([norm(vendedor.nomeResponsavel||'')], AlignmentType.CENTER),
                para([norm(vendedor.cpfResponsavel||'')], AlignmentType.CENTER),
            ]
        }]
    });

    // ── GENERATE AND DOWNLOAD ──
    try {
        mostrarNotificacao('Gerando contrato...', 'success');
        const buffer = await Packer.toBlob(doc);
        const url = URL.createObjectURL(buffer);
        const a   = document.createElement('a');
        a.href    = url;
        a.download = `Contrato_${String(venda.contrato||'').replace(/\//g,'_')}_${(venda.loja||'cliente').replace(/[^a-z0-9]/gi,'_')}.docx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        mostrarNotificacao('Contrato gerado com sucesso!', 'success');
    } catch(e) {
        console.error('Erro ao gerar contrato:', e);
        mostrarNotificacao('Erro ao gerar contrato. Verifique o console.', 'error');
    }
}

function exportarVendas() {
    const vendas = estoque.registroVendas || [];
    
    // Ordenar por contrato
    const vendasOrdenadas = [...vendas].sort((a, b) => {
        const contratoA = parseInt(a.contrato) || 0;
        const contratoB = parseInt(b.contrato) || 0;
        return contratoA - contratoB;
    });
    
    // Usar ponto-e-vírgula como separador (padrão Excel PT-BR)
    const sep = ';';
    
    // Cabeçalho
    let csv = `CONTRATO${sep}LOJA/CLIENTE${sep}REPRESENTANTE${sep}PRODUTO${sep}QUANTIDADE${sep}VALOR UNITÁRIO${sep}VALOR TOTAL${sep}OBSERVAÇÕES${sep}DATA\n`;
    
    if (vendasOrdenadas.length > 0) {
        // Percorrer vendas; suportar vendas com múltiplos itens
        vendasOrdenadas.forEach(venda => {
            const data = venda.data ? new Date(venda.data).toLocaleDateString('pt-BR') : '';
            if (Array.isArray(venda.items) && venda.items.length > 0) {
                venda.items.forEach(it => {
                    const valorUnit = typeof it.valorUnitario === 'number' ? it.valorUnitario : 0;
                    const valorTot = typeof it.valorTotal === 'number' ? it.valorTotal : (valorUnit * (it.quantidade || 0));
                    csv += `${venda.contrato}${sep}${venda.loja}${sep}${venda.representante}${sep}${it.produtoNome}${sep}${it.quantidade}${sep}${valorUnit.toFixed(2).replace('.', ',')}${sep}${valorTot.toFixed(2).replace('.', ',')}${sep}${venda.observacoes || ''}${sep}${data}\n`;
                });
            } else {
                // venda no formato antigo
                const produtoNome = venda.produtoNome || '';
                const quantidade = venda.quantidade || 0;
                const valorUnit = (typeof venda.valorUnitario === 'number') ? venda.valorUnitario : 0;
                const valorTot = (typeof venda.valorTotal === 'number') ? venda.valorTotal : 0;
                csv += `${venda.contrato}${sep}${venda.loja}${sep}${venda.representante}${sep}${produtoNome}${sep}${quantidade}${sep}${valorUnit.toFixed(2).replace('.', ',')}${sep}${valorTot.toFixed(2).replace('.', ',')}${sep}${venda.observacoes || ''}${sep}${data}\n`;
            }
        });

        // Linha de total (somar corretamente considerando itens)
        const totalQtd = vendas.reduce((sum, v) => {
            if (Array.isArray(v.items) && v.items.length > 0) return sum + v.items.reduce((s, it) => s + (it.quantidade || 0), 0);
            return sum + (v.quantidade || 0);
        }, 0);
        const totalValor = vendas.reduce((sum, v) => {
            if (Array.isArray(v.items) && v.items.length > 0) return sum + v.items.reduce((s, it) => s + (typeof it.valorTotal === 'number' ? it.valorTotal : ((it.valorUnitario||0) * (it.quantidade||0))), 0);
            return sum + (typeof v.valorTotal === 'number' ? v.valorTotal : 0);
        }, 0);
        csv += `${sep}${sep}${sep}TOTAL${sep}${totalQtd}${sep}${sep}${totalValor.toFixed(2).replace('.', ',')}${sep}${sep}\n`;
    }
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const dataAtual = new Date().toISOString().split('T')[0];
    
    link.setAttribute('href', url);
    link.setAttribute('download', `registro_vendas_${dataAtual}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    if (vendas.length === 0) {
        mostrarNotificacao('Modelo exportado (sem vendas registradas)', 'info');
    } else {
        mostrarNotificacao('Registro de vendas exportado com sucesso!', 'success');
    }
}

// ========================================
// REGISTRO DE DISTRIBUIÇÃO
// ========================================

function abrirModalNovaDistribuicao() {
    if (!requireAdminOrNotify()) return;
    document.getElementById('modalNovaDistribuicao').style.display = 'flex';
    document.getElementById('formNovaDistribuicao').reset();
    atualizarSelectsProdutos();
    try { popularSelectRepresentantes('representanteDistDet', false); } catch (e) {}
    // Reset container de itens e adicionar uma linha inicial
    try {
        const container = document.getElementById('itensDistribuicaoContainer');
        if (container) {
            container.innerHTML = '';
            adicionarItemDistribuicao();
        }
    } catch (e) {}

    // Definir data atual
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('dataDistDet').value = hoje;
}

function salvarNovaDistribuicao(event) {
    if (!requireAdminOrNotify()) return;
    event.preventDefault();
    const representante = document.getElementById('representanteDistDet').value;
    const data = document.getElementById('dataDistDet').value || new Date().toISOString().split('T')[0];
    const observacoes = document.getElementById('observacoesDistDet').value.trim();

    const container = document.getElementById('itensDistribuicaoContainer');
    if (!container) {
        mostrarNotificacao('Container de itens não encontrado.', 'error');
        return;
    }

    const rows = Array.from(container.querySelectorAll('.item-dist-row'));
    if (rows.length === 0) {
        mostrarNotificacao('Adicione ao menos um produto para distribuir.', 'error');
        return;
    }

    // Agregar solicitações por produto (para validar estoque IMBEL consolidado)
    const solicitadoMap = new Map();
    const detalhesLinhas = [];
    const erros = [];

    rows.forEach((row, idx) => {
        const prodId = parseInt(row.querySelector('.item-produto-dist')?.value || '0');
        const qtd = parseInt(row.querySelector('.item-quantidade-dist')?.value || '0');
        if (!prodId || qtd <= 0) {
            erros.push(`Linha ${idx + 1}: produto ou quantidade inválidos.`);
            return;
        }
        detalhesLinhas.push({ produtoId: prodId, quantidade: qtd });
        solicitadoMap.set(prodId, (solicitadoMap.get(prodId) || 0) + qtd);
    });

    if (erros.length > 0) {
        mostrarNotificacao(erros.join('\n'), 'error');
        return;
    }

    // Validar estoque IMBEL para cada produto agregado usando registros como fonte de verdade
    const insuficientes = [];
    solicitadoMap.forEach((totalSolicitado, produtoId) => {
        const produto = estoque.produtos.find(p => p.id === produtoId);
        if (!produto) {
            insuficientes.push({ produtoId, nome: '(produto não encontrado)', disponivel: 0, solicitado: totalSolicitado });
            return;
        }
        const disponivel = calcularEstoqueIMBEL(produto.nome);
        if (totalSolicitado > disponivel) {
            insuficientes.push({ produtoId, nome: produto.nome, disponivel, solicitado: totalSolicitado });
        }
    });

    if (insuficientes.length > 0) {
        let msg = '⚠️ Estoque insuficiente na IMBEL para os seguintes produtos:\n\n';
        insuficientes.forEach(i => { msg += `• ${i.nome}: solicitado ${i.solicitado}, disponível ${i.disponivel}\n`; });
        mostrarNotificacao(msg, 'error');
        return;
    }

    // Processar cada linha
    const registrosCriados = [];
    detalhesLinhas.forEach(item => {
        const produto = estoque.produtos.find(p => p.id === item.produtoId);
        if (!produto) return;

        // Não mutamos `produto.distribuicao` diretamente aqui; persistimos o registro.

        // Criar registro individual para cada item
        const novaDistribuicao = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            representante: representante,
            produtoId: item.produtoId,
            produtoNome: produto.nome,
            quantidade: item.quantidade,
            data: data,
            observacoes: observacoes
        };
        estoque.registroDistribuicao.push(novaDistribuicao);
        registrosCriados.push(novaDistribuicao);
    });
    // Reconstruir agregados a partir dos registros e salvar
    try { reconstruirDistribuicaoAPartirDeRegistros(); } catch (e) {}
    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarRegistroDistribuicao();
    fecharModal('modalNovaDistribuicao');

    try { verificarAlertasEstoque(); } catch (e) {}

    mostrarNotificacao(`Distribuição registrada: ${registrosCriados.length} item(s) para ${representante}`, 'success');
}

function renderizarRegistroDistribuicao() {
    const tbody = document.getElementById('tabelaRegistroDistribuicaoBody');
    if (!tbody) return;
    
    const filtroRep = document.getElementById('filtroDistribuicaoRep')?.value || '';
    const filtroProduto = document.getElementById('filtroDistribuicaoProduto')?.value || '';
    
    // Filtrar distribuições
    let distribuicoesFiltradas = estoque.registroDistribuicao || [];
    
    if (filtroRep) {
        distribuicoesFiltradas = distribuicoesFiltradas.filter(d => d.representante === filtroRep);
    }
    
    if (filtroProduto) {
        distribuicoesFiltradas = distribuicoesFiltradas.filter(d => d.produtoId === parseInt(filtroProduto));
    }
    
    // Ordenar por data (mais recente primeiro)
    distribuicoesFiltradas.sort((a, b) => new Date(b.data) - new Date(a.data));
    
    tbody.innerHTML = '';
    
    if (distribuicoesFiltradas.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <div class="empty-icon">🚚</div>
                    <div class="empty-text">Nenhuma distribuição registrada</div>
                    <div class="empty-hint">Clique em "Nova Distribuição" para adicionar o primeiro registro</div>
                </td>
            </tr>
        `;
        atualizarTotaisDistribuicao(0);
        return;
    }
    
    let totalQtd = 0;
    let numero = distribuicoesFiltradas.length;
    
    distribuicoesFiltradas.forEach(dist => {
        totalQtd += dist.quantidade;
        
        const repClass = dist.representante.toLowerCase();
        const dataFormatada = dist.data ? new Date(dist.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="col-contrato">${numero--}</td>
            <td class="col-loja"><span class="badge-rep ${repClass}">${dist.representante}</span></td>
            <td class="col-produto-venda" title="${dist.produtoNome}">${dist.produtoNome}</td>
            <td class="col-qtd">${dist.quantidade}</td>
            <td>${dataFormatada}</td>
            <td class="col-obs" title="${dist.observacoes || '-'}">${dist.observacoes || '-'}</td>
            <td class="col-acoes">
                <button class="btn-action btn-delete" onclick="excluirDistribuicao(${dist.id})" title="Excluir distribuição">🗑</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    atualizarTotaisDistribuicao(totalQtd);
}

function atualizarTotaisDistribuicao(totalQtd) {
    const spanQtd = document.getElementById('totalQtdDistribuicao');
    if (spanQtd) spanQtd.innerHTML = `<strong>${totalQtd.toLocaleString('pt-BR')}</strong>`;
}

function limparFiltrosDistribuicao() {
    const filtroRep = document.getElementById('filtroDistribuicaoRep');
    const filtroProduto = document.getElementById('filtroDistribuicaoProduto');
    
    if (filtroRep) filtroRep.value = '';
    if (filtroProduto) filtroProduto.value = '';
    
    renderizarRegistroDistribuicao();
}

function excluirDistribuicao(distId) {
    if (!requireAdminOrNotify()) return;
    const dist = estoque.registroDistribuicao.find(d => d.id === distId);
    
    if (!dist) {
        mostrarNotificacao('Distribuição não encontrada!', 'error');
        return;
    }
    
    if (!confirm(`Deseja excluir esta distribuição?\n\nRepresentante: ${dist.representante}\nProduto: ${dist.produtoNome}\nQuantidade: ${dist.quantidade}\n\nATENÇÃO: A quantidade será devolvida ao estoque da IMBEL.`)) {
        return;
    }
    
    // Devolver ao estoque da IMBEL e remover do representante
    const produto = estoque.produtos.find(p => p.id === dist.produtoId);
    if (produto) {
        produto.distribuicao[dist.representante] = Math.max(0, (produto.distribuicao[dist.representante] || 0) - dist.quantidade);
        // Nota: não alterar `estoqueConsolidado` aqui — o consolidado é cadastro.
    }
    
    // Remover do registro
    estoque.registroDistribuicao = estoque.registroDistribuicao.filter(d => d.id !== distId);
    
    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarRegistroDistribuicao();
    
    mostrarNotificacao(`Distribuição excluída! ${dist.quantidade} unidades devolvidas à IMBEL.`, 'success');
}

function excluirDevolucao(devId) {
    if (!requireAdminOrNotify()) return;
    const dev = (estoque.registroDevolucoes || []).find(d => d.id === devId);
    if (!dev) {
        mostrarNotificacao('Devolução não encontrada!', 'error');
        return;
    }

    if (!confirm(`Deseja excluir esta devolução?\n\nOrigem: ${dev.origem}\nProduto: ${dev.produtoNome}\nQuantidade: ${dev.quantidade}\n\nATENÇÃO: Esta operação irá reverter a devolução (movendo as unidades de volta ao representante).`)) {
        return;
    }

    // Reverter a devolução: subtrair do destino e recolocar no representante de origem
    const produto = estoque.produtos.find(p => p.id === dev.produtoId);
    if (produto) {
        if ((dev.destino || '').toUpperCase() === 'IMBEL') {
            // Se a devolução foi para o consolidado (IMBEL), reduzir o consolidado
            produto.estoqueConsolidado = Math.max(0, (Number(produto.estoqueConsolidado) || 0) - dev.quantidade);
            produto.distribuicao[dev.origem] = (produto.distribuicao[dev.origem] || 0) + dev.quantidade;
        } else {
            produto.distribuicao[dev.destino] = Math.max(0, (produto.distribuicao[dev.destino] || 0) - dev.quantidade);
            produto.distribuicao[dev.origem] = (produto.distribuicao[dev.origem] || 0) + dev.quantidade;
        }
    }

    // Remover registro de devolução
    estoque.registroDevolucoes = (estoque.registroDevolucoes || []).filter(d => d.id !== devId);

    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarRegistroDistribuicao();

    mostrarNotificacao(`Devolução excluída e estoque revertido (${dev.quantidade} unidades).`, 'success');
}

function exportarDistribuicao() {
    const distribuicoes = estoque.registroDistribuicao || [];
    
    // Ordenar por data
    const distribuicoesOrdenadas = [...distribuicoes].sort((a, b) => new Date(a.data) - new Date(b.data));
    
    // Usar ponto-e-vírgula como separador (padrão Excel PT-BR)
    const sep = ';';
    
    // Cabeçalho
    let csv = `REPRESENTANTE${sep}PRODUTO${sep}QUANTIDADE${sep}DATA${sep}OBSERVAÇÕES\n`;
    
    if (distribuicoesOrdenadas.length > 0) {
        distribuicoesOrdenadas.forEach(dist => {
            const dataFormatada = dist.data ? new Date(dist.data + 'T00:00:00').toLocaleDateString('pt-BR') : '';
            csv += `${dist.representante}${sep}${dist.produtoNome}${sep}${dist.quantidade}${sep}${dataFormatada}${sep}${dist.observacoes || ''}\n`;
        });
        
        // Linha de total
        const totalQtd = distribuicoes.reduce((sum, d) => sum + d.quantidade, 0);
        csv += `${sep}TOTAL${sep}${totalQtd}${sep}${sep}\n`;
    }
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const dataAtual = new Date().toISOString().split('T')[0];
    
    link.setAttribute('href', url);
    link.setAttribute('download', `registro_distribuicao_${dataAtual}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    if (distribuicoes.length === 0) {
        mostrarNotificacao('Modelo exportado (sem distribuições registradas)', 'info');
    } else {
        mostrarNotificacao('Registro de distribuição exportado com sucesso!', 'success');
    }
}

function importarDistribuicao(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const conteudo = e.target.result;
            const linhas = conteudo.split(/\r?\n/).filter(l => l.trim());
            
            if (linhas.length < 2) {
                mostrarNotificacao('Arquivo vazio ou sem dados!', 'error');
                return;
            }
            
            let distribuicoesImportadas = 0;
            let erros = [];
            
            // Processar cada linha (começando da segunda - pular cabeçalho)
            for (let i = 1; i < linhas.length; i++) {
                const linha = linhas[i].trim();
                if (!linha || linha.toLowerCase().includes('total')) continue;
                
                const colunas = parseCsvLinha(linha);
                
                // Pular linha se primeira coluna estiver vazia
                if (!colunas[0] || colunas[0].trim() === '') continue;
                
                if (colunas.length < 3) {
                    erros.push(`Linha ${i + 1}: formato inválido`);
                    continue;
                }
                
                const representante = colunas[0]?.trim().toUpperCase();
                const produtoNome = colunas[1]?.trim().toUpperCase();
                const quantidade = parseInt(colunas[2]?.trim()) || 0;
                const dataStr = colunas[3]?.trim() || '';
                const observacoes = colunas[4]?.trim() || '';
                
                if (!representante || !produtoNome || quantidade <= 0) {
                    erros.push(`Linha ${i + 1}: dados obrigatórios faltando`);
                    continue;
                }
                
                // Verificar se representante é válido
                const repsValidos = ['KOLTE', 'ISA', 'LC', 'ADES', 'FL'];
                if (!repsValidos.includes(representante)) {
                    erros.push(`Linha ${i + 1}: representante inválido (${representante})`);
                    continue;
                }
                
                // Buscar produto pelo nome
                let produto = estoque.produtos.find(p => 
                    p.nome.toUpperCase() === produtoNome || 
                    p.nome.toUpperCase().includes(produtoNome) ||
                    produtoNome.includes(p.nome.toUpperCase())
                );
                
                if (!produto) {
                    erros.push(`Linha ${i + 1}: produto não encontrado (${produtoNome})`);
                    continue;
                }
                
                // Converter data
                let data = new Date().toISOString().split('T')[0];
                if (dataStr) {
                    // Tentar converter dd/mm/yyyy para yyyy-mm-dd
                    const partes = dataStr.split('/');
                    if (partes.length === 3) {
                        data = `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
                    }
                }
                
                // Verificar estoque disponível na IMBEL usando o novo modelo
                const estoqueIMBEL = calcularImbelDisponivel(produto);
                if (quantidade > estoqueIMBEL) {
                    erros.push(`Linha ${i + 1}: estoque insuficiente na IMBEL para ${produto.nome} (disponível: ${estoqueIMBEL})`);
                    continue;
                }
                
                // Criar registro da distribuição
                const novaDistribuicao = {
                    id: Date.now() + i,
                    representante: representante,
                    produtoId: produto.id,
                    produtoNome: produto.nome,
                    quantidade: quantidade,
                    data: data,
                    observacoes: observacoes
                };
                
                // Alocar para o representante (IMBEL é derivado do consolidado)
                produto.distribuicao[representante] = (produto.distribuicao[representante] || 0) + quantidade;
                
                // Adicionar ao registro
                estoque.registroDistribuicao.push(novaDistribuicao);
                distribuicoesImportadas++;
            }
            
            if (distribuicoesImportadas > 0) {
                salvarDados();
                renderizarTabela();
                renderizarDashboard();
                renderizarRegistroDistribuicao();
            }
            
            // Limpar input
            event.target.value = '';
            
            // Mostrar resultado
            if (erros.length > 0 && distribuicoesImportadas === 0) {
                mostrarNotificacao(`Nenhuma distribuição importada. Verifique o formato.`, 'error');
                console.debug('Erros de importação:', erros);
            } else if (erros.length > 0) {
                mostrarNotificacao(`${distribuicoesImportadas} distribuições importadas. ${erros.length} linhas com erro.`, 'warning');
                console.debug('Erros de importação:', erros);
            } else {
                mostrarNotificacao(`${distribuicoesImportadas} distribuições importadas com sucesso!`, 'success');
            }
            
        } catch (error) {
            console.error('Erro ao importar:', error);
            mostrarNotificacao('Erro ao processar o arquivo. Verifique o formato.', 'error');
        }
    };
    
    reader.readAsText(file, 'UTF-8');
}

function salvarProduto(event) {
    if (!requireAdminOrNotify()) return;
    event.preventDefault();
    
    const nome = document.getElementById('nomeProduto').value.trim().toUpperCase();
    const estoqueTotal = parseInt(document.getElementById('estoqueTotal').value) || 0;
    const ncm = (document.getElementById('produtoNCM')?.value || '').trim();
    const categoria = (document.getElementById('produtoCategoria')?.value || '').trim();
    const ci = parseCurrencyBRLToNumber(document.getElementById('produtoCI')?.value) || 0;
    const margemMinima = Number(document.getElementById('produtoMargemMin')?.value || 0) || 0;
    const descontoMaximo = Number(document.getElementById('produtoDescMax')?.value || 0) || 0;
    const observacoes = (document.getElementById('produtoObservacoes')?.value || '').trim();
    const exibirNoEstoque = document.getElementById('produtoExibirNoEstoque')?.checked === true;

    if (!nome) {
        mostrarNotificacao('Informe o nome do produto.', 'error');
        return;
    }

    if (!precificacao || typeof precificacao !== 'object') precificacao = {};
    if (!categoriaPorProduto || typeof categoriaPorProduto !== 'object') categoriaPorProduto = {};

    // Se estamos editando um produto existente
    if (produtoEditandoId !== null) {
        const idx = estoque.produtos.findIndex(p => p.id === produtoEditandoId);
        if (idx === -1) {
            mostrarNotificacao('Produto não encontrado para edição.', 'error');
            produtoEditandoId = null;
            fecharModal('modalProduto');
            return;
        }
        // Verificar duplicidade de nome em outro produto
        if (estoque.produtos.some(p => p.nome === nome && p.id !== produtoEditandoId)) {
            mostrarNotificacao('Outro produto com este nome já existe!', 'error');
            return;
        }

        const produto = estoque.produtos[idx];
        const nomeAnterior = produto.nome;
        produto.nome = nome;
        produto.estoqueConsolidado = Number(estoqueTotal) || 0;
        produto.quantidadeInicial = Number(estoqueTotal) || 0;
        produto.ncm = ncm;
        produto.categoria = categoria;
        produto.ci = ci;
        produto.margemMinima = margemMinima;
        produto.margemMin = margemMinima;
        produto.descontoMaximo = descontoMaximo;
        produto.descMax = descontoMaximo;
        produto.observacoes = observacoes;
        produto.exibirNoEstoque = exibirNoEstoque;
        produto.atualizadoEm = new Date().toISOString();
        produto.dataAtualizacao = Date.now();
        // Preserve existing rep data, only add missing reps
        const repsAtivos = estoque.representantes || ['KOLTE','ISA','LC','ADES','FL','IMBEL'];
        if (!produto.distribuicao || typeof produto.distribuicao !== 'object') produto.distribuicao = {};
        if (!produto.vendas || typeof produto.vendas !== 'object') produto.vendas = {};
        repsAtivos.forEach(rep => {
            if (produto.distribuicao[rep] === undefined) produto.distribuicao[rep] = 0;
            if (produto.vendas[rep] === undefined)       produto.vendas[rep]       = 0;
        });

        if (nomeAnterior && nomeAnterior !== nome) {
            if (precificacao[nomeAnterior] && !precificacao[nome]) {
                precificacao[nome] = { ...precificacao[nomeAnterior] };
            }
            delete precificacao[nomeAnterior];

            if (categoriaPorProduto[nomeAnterior] && !categoriaPorProduto[nome]) {
                categoriaPorProduto[nome] = categoriaPorProduto[nomeAnterior];
            }
            delete categoriaPorProduto[nomeAnterior];

            if (tabelaAliquotas[nomeAnterior] && !tabelaAliquotas[nome]) {
                tabelaAliquotas[nome] = { ...tabelaAliquotas[nomeAnterior] };
            }
            delete tabelaAliquotas[nomeAnterior];
        }

        precificacao[nome] = {
            ...(precificacao[nome] || {}),
            ci,
            margemMinima,
            descontoMaximo
        };
        if (categoria) categoriaPorProduto[nome] = categoria;

        atualizarSelectsProdutos();
        try { popularSelectProdutosPrecif(); } catch (e) {}
        salvarDados();
        renderizarTabela();
        renderizarDashboard();
        renderizarCadastroProdutos();
        fecharModal('modalProduto');
        mostrarNotificacao(`Produto "${nome}" atualizado com sucesso!`, 'success');
        produtoEditandoId = null;
        return;
    }

    // Criar novo produto
    if (estoque.produtos.some(p => p.nome === nome)) {
        mostrarNotificacao('Este produto já existe no sistema!', 'error');
        return;
    }

    const novoProduto = {
        id: Date.now(),
        nome: nome,
        estoqueConsolidado: Number(estoqueTotal) || 0,
        quantidadeInicial: Number(estoqueTotal) || 0,
        ncm,
        categoria,
        ci,
        margemMinima,
        margemMin: margemMinima,
        descontoMaximo,
        descMax: descontoMaximo,
        observacoes,
        exibirNoEstoque,
        criadoEm: new Date().toISOString(),
        atualizadoEm: new Date().toISOString(),
        dataAtualizacao: Date.now(),
        distribuicao: Object.fromEntries(
            (estoque.representantes || ['KOLTE','ISA','LC','ADES','FL','IMBEL']).map(r => [r, 0])
        ),
        vendas: Object.fromEntries(
            (estoque.representantes || ['KOLTE','ISA','LC','ADES','FL','IMBEL']).map(r => [r, 0])
        )
    };

    precificacao[nome] = {
        ...(precificacao[nome] || {}),
        ci,
        margemMinima,
        margemMin: margemMinima,
        descontoMaximo,
        descMax: descontoMaximo
    };
    if (categoria) categoriaPorProduto[nome] = categoria;

    estoque.produtos.push(novoProduto);
    // Atualizar selects imediatamente para refletir o novo produto em qualquer modal aberto
    atualizarSelectsProdutos();
    try { popularSelectProdutosPrecif(); } catch (e) {}
    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarCadastroProdutos();
    fecharModal('modalProduto');

    mostrarNotificacao(`Produto "${nome}" adicionado com sucesso!`, 'success');
}

function salvarDistribuicao(event) {
    if (!requireAdminOrNotify()) return;
    event.preventDefault();
    
    const produtoId = parseInt(document.getElementById('produtoDistribuicao').value);
    const representante = document.getElementById('representanteDistribuicao').value;
    const quantidade = parseInt(document.getElementById('quantidadeDistribuicao').value);
    
    const produto = estoque.produtos.find(p => p.id === produtoId);
    
    if (!produto) {
        mostrarNotificacao('Produto não encontrado!', 'error');
        return;
    }
    
    const saldoIMBEL = calcularEstoqueIMBEL(produto.nome);
    if (quantidade > saldoIMBEL) {
        mostrarNotificacao(`Estoque insuficiente na IMBEL! Saldo disponível: ${saldoIMBEL} unidades`, 'error');
        return;
    }

    // Criar registro da distribuição (não mutamos mais produto.distribuicao diretamente)
    const novaDistribuicao = {
        id: Date.now(),
        representante: representante,
        produtoId: produto.id,
        produtoNome: produto.nome,
        quantidade: quantidade,
        data: new Date().toISOString().split('T')[0]
    };
    estoque.registroDistribuicao.push(novaDistribuicao);

    try { reconstruirDistribuicaoAPartirDeRegistros(); } catch (e) {}
    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    try { verificarAlertasEstoque(); } catch(e) {}
    fecharModal('modalDistribuicao');

    mostrarNotificacao(`${quantidade} unidades distribuídas para ${representante}!`, 'success');
}

function salvarVenda(event) {
    if (!requireAdminOrNotify()) return;
    event.preventDefault();
    const produtoId = parseInt(document.getElementById('produtoVenda').value);
    const vendedor = document.getElementById('vendedorVenda').value;
    const quantidade = parseInt(document.getElementById('quantidadeVenda').value);

    const produto = estoque.produtos.find(p => p.id === produtoId);
    if (!produto) {
        mostrarNotificacao('Produto não encontrado!', 'error');
        return;
    }

    // Usar a validação compartilhada
    const itens = [{ produtoId: produtoId, produtoNome: produto.nome, quantidade }];
    const validacao = typeof validarEstoqueParaVenda === 'function' ? validarEstoqueParaVenda(vendedor, itens) : { valido: true };
    if (!validacao.valido) {
        let msg = '⚠️ Estoque insuficiente para ' + vendedor + ':\n\n';
        validacao.erros.forEach(e => { msg += `• ${e.produto}: solicitado ${e.solicitado}, disponível ${e.disponivel}\n`; });
        msg += '\nDeseja registrar mesmo assim?';

        mostrarConfirmacaoEstoque(msg, () => {
            produto.vendas[vendedor] = (produto.vendas[vendedor] || 0) + quantidade;
            salvarDados();
            renderizarTabela();
            renderizarDashboard();
            fecharModal('modalVenda');
            mostrarNotificacao(`Venda registrada: ${quantidade}x "${produto.nome}"`, 'success');
        });
        return;
    }

    // Sem problemas de estoque — registra normalmente
    produto.vendas[vendedor] = (produto.vendas[vendedor] || 0) + quantidade;
    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    fecharModal('modalVenda');
    mostrarNotificacao(`Venda registrada: ${quantidade}x "${produto.nome}"`, 'success');
}

function salvarDevolucao(event) {
    event.preventDefault();

    const representante = document.getElementById('representanteDevolucao').value;
    const destino = document.getElementById('destinoDevolucao') ? document.getElementById('destinoDevolucao').value : 'IMBEL';
    const container = document.getElementById('itensDevolucaoContainer');
    if (!container) {
        mostrarNotificacao('Container de itens não encontrado.', 'error');
        return;
    }

    const rows = Array.from(container.querySelectorAll('.item-dev-row'));
    if (rows.length === 0) {
        mostrarNotificacao('Adicione ao menos um produto para devolução.', 'error');
        return;
    }

    // Agregar por produto para validar saldos no representante de origem
    const solicitadoMap = new Map();
    const detalhes = [];
    const erros = [];

    rows.forEach((row, idx) => {
        const prodId = parseInt(row.querySelector('.item-produto-dev')?.value || '0');
        const qtd = parseInt(row.querySelector('.item-quantidade-dev')?.value || '0');
        if (!prodId || qtd <= 0) {
            erros.push(`Linha ${idx + 1}: produto ou quantidade inválidos.`);
            return;
        }
        detalhes.push({ produtoId: prodId, quantidade: qtd });
        solicitadoMap.set(prodId, (solicitadoMap.get(prodId) || 0) + qtd);
    });

    if (erros.length > 0) {
        mostrarNotificacao(erros.join('\n'), 'error');
        return;
    }

    const insuficientes = [];
    solicitadoMap.forEach((totalSolicitado, produtoId) => {
        const produto = estoque.produtos.find(p => p.id === produtoId);
        if (!produto) { insuficientes.push({ produtoId, nome: '(produto não encontrado)', disponivel: 0, solicitado: totalSolicitado }); return; }
        const disp = produto.distribuicao[representante] || 0;
        const vendido = produto.vendas[representante] || 0;
        const saldo = disp - vendido;
        if (totalSolicitado > saldo) insuficientes.push({ produtoId, nome: produto.nome, disponivel: saldo, solicitado: totalSolicitado });
    });

    if (insuficientes.length > 0) {
        let msg = '⚠️ Saldo insuficiente no representante para:\n\n';
        insuficientes.forEach(i => { msg += `• ${i.nome}: solicitado ${i.solicitado}, disponível ${i.disponivel}\n`; });
        mostrarNotificacao(msg, 'error');
        return;
    }

    const registros = [];
    detalhes.forEach(item => {
        const produto = estoque.produtos.find(p => p.id === item.produtoId);
        if (!produto) return;

        if (destino === representante) return; // pular (não faz sentido)

        // Subtrair do representante de origem
        produto.distribuicao[representante] = (produto.distribuicao[representante] || 0) - item.quantidade;
        if (produto.distribuicao[representante] < 0) produto.distribuicao[representante] = 0;

        // Garantir chave de destino: se destino for IMBEL, incrementar o consolidado
        if ((destino || '').toString().toUpperCase() === 'IMBEL') {
            produto.estoqueConsolidado = (Number(produto.estoqueConsolidado) || 0) + item.quantidade;
        } else {
            produto.distribuicao[destino] = (produto.distribuicao[destino] || 0) + item.quantidade;
        }

        // Registrar devolução
        try {
            if (!Array.isArray(estoque.registroDevolucoes)) estoque.registroDevolucoes = [];
            const registro = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                origem: representante,
                destino: destino,
                produtoId: item.produtoId,
                produtoNome: produto.nome,
                quantidade: item.quantidade,
                data: (new Date()).toISOString().split('T')[0],
                observacoes: ''
            };
            estoque.registroDevolucoes.push(registro);
            registros.push(registro);
        } catch (e) { console.warn('Falha ao registrar devolução:', e); }
    });

    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    atualizarSelectsProdutos();

    fecharModal('modalDevolucao');

    try { verificarAlertasEstoque(); } catch(e) {}

    mostrarNotificacao(`${registros.length} item(s) devolvidos de ${representante} para ${destino}!`, 'success');
}

function limparFiltros() {
    renderizarTabela();
    renderizarDashboard();
    atualizarEstatisticas();
    mostrarNotificacao('Dados atualizados!', 'info');
}

// ========================================
// SISTEMA DE NOTIFICAÇÕES
// ========================================

function mostrarNotificacao(mensagem, tipo = 'info') {
    const notificacaoExistente = document.querySelector('.notificacao');
    if (notificacaoExistente) {
        notificacaoExistente.remove();
    }

    const cores = {
        success: { bg: '#d4edda', border: '#28a745', text: '#155724', icon: '✓' },
        error: { bg: '#f8d7da', border: '#dc3545', text: '#721c24', icon: '✕' },
        warning: { bg: '#fff3cd', border: '#ffc107', text: '#856404', icon: '⚠' },
        info: { bg: '#d1ecf1', border: '#17a2b8', text: '#0c5460', icon: 'ℹ' }
    };

    const cor = cores[tipo] || cores.info;

    const notificacao = document.createElement('div');
    notificacao.className = 'notificacao';
    notificacao.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${cor.bg};
        border: 1px solid ${cor.border};
        border-left: 4px solid ${cor.border};
        border-radius: 6px;
        color: ${cor.text};
        font-size: 0.9rem;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideInRight 0.3s ease;
        max-width: 400px;
    `;
    
    notificacao.innerHTML = `<span style="font-size: 1.2rem;">${cor.icon}</span> ${mensagem}`;
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOutRight {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notificacao);
    
    setTimeout(() => {
        notificacao.style.animation = 'slideOutRight 0.3s ease forwards';
        setTimeout(() => notificacao.remove(), 300);
    }, 4000);
}

// ========================================
// EXPORTAÇÃO DE DADOS
// ========================================

function exportarDados() {
    let csv = 'PRODUTO;';

    const valorPorProduto = {};
    (estoque.registroVendas || []).forEach(venda => {
        if (Array.isArray(venda.items) && venda.items.length > 0) {
            venda.items.forEach(it => {
                const nome = it.produtoNome || '';
                if (!nome) return;
                const valorItem = typeof it.valorTotal === 'number'
                    ? it.valorTotal
                    : ((Number(it.valorUnitario) || 0) * (Number(it.quantidade) || 0));
                valorPorProduto[nome] = (valorPorProduto[nome] || 0) + valorItem;
            });
        } else {
            const nome = venda.produtoNome || '';
            if (!nome) return;
            const valorLegacy = typeof venda.valorTotal === 'number'
                ? venda.valorTotal
                : ((Number(venda.valorUnitario) || 0) * (Number(venda.quantidade) || 0));
            valorPorProduto[nome] = (valorPorProduto[nome] || 0) + valorLegacy;
        }
    });
    
    estoque.representantes.forEach(rep => {
        csv += `${rep} Disp;${rep} Venda;${rep} Saldo;`;
    });
    csv += 'GERAL Disp;GERAL Venda;GERAL Saldo;VALOR TOTAL VENDAS\n';
    
    estoque.produtos.forEach(produto => {
        csv += `"${produto.nome}";`;
        
        let geralDisp = 0, geralVenda = 0;
        
        estoque.representantes.forEach(rep => {
            const disp = produto.distribuicao[rep] || 0;
            const venda = produto.vendas[rep] || 0;
            const saldo = disp - venda;
            
            geralDisp += disp;
            geralVenda += venda;
            
            csv += `${disp};${venda};${saldo};`;
        });
        
        const valorVendas = valorPorProduto[produto.nome] || 0;
        csv += `${geralDisp};${geralVenda};${geralDisp - geralVenda};${valorVendas.toFixed(2).replace('.', ',')}\n`;
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const dataAtual = new Date().toISOString().split('T')[0];
    
    link.setAttribute('href', url);
    link.setAttribute('download', `estoque_material_belico_${dataAtual}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    mostrarNotificacao('Arquivo exportado com sucesso!', 'success');
}

// ========================================
// EXPORTAR/IMPORTAR ESTOQUE COMPLETO
// ========================================

function exportarEstoqueCompleto() {
    const sep = ';';
    
    // Cabeçalho simples: Produto, Quantidade Total
    let csv = `PRODUTO${sep}QUANTIDADE_TOTAL\n`;
    
    // Dados
    estoque.produtos.forEach(produto => {
        // Quantidade total em estoque baseada no saldo consolidado cadastrado
        const totalEstoque = Number(produto.estoqueConsolidado) || 0;
        
        csv += `${produto.nome}${sep}${totalEstoque}\n`;
    });
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const dataAtual = new Date().toISOString().split('T')[0];
    
    link.setAttribute('href', url);
    link.setAttribute('download', `estoque_${dataAtual}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    mostrarNotificacao('Estoque exportado com sucesso!', 'success');
}

// ========================================
// EXPORTAR / IMPORTAR SISTEMA COMPLETO (JSON)
// ========================================

function exportarSistema() {
    try {
        const payload = {
            ...estoque,
            precificacao,
            tabelaAliquotas,
            tabelaICMS,
            categoriaPorProduto,
            impostosEditaveis: impostosEditaveis || {},
            icmsEditavelPJ: icmsEditavelPJ || {},
            icmsEditavelPF: icmsEditavelPF || {}
        };
        const dataStr = JSON.stringify(payload, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const dataAtual = new Date().toISOString().split('T')[0];

        link.setAttribute('href', url);
        link.setAttribute('download', `controle_estoque_full_${dataAtual}.json`);
        link.style.visibility = 'hidden';

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        mostrarNotificacao('Exportação do sistema concluída!', 'success');
    } catch (error) {
        console.error('Erro ao exportar sistema:', error);
        mostrarNotificacao('Erro ao exportar o sistema.', 'error');
    }
}

function importarSistema(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const conteudo = e.target.result;
            const obj = JSON.parse(conteudo);

            // Validações básicas
            if (!obj || !Array.isArray(obj.produtos) || !Array.isArray(obj.representantes)) {
                mostrarNotificacao('Arquivo inválido: formato JSON inesperado.', 'error');
                event.target.value = '';
                return;
            }

            if (!confirm('⚠️ Importar o arquivo substituirá TODO o estado do sistema atual (produtos, distribuições e vendas). Deseja continuar?')) {
                event.target.value = '';
                return;
            }

            // Substitui o estado em memória e persiste
            estoque = obj;
            if (!Array.isArray(estoque.clientes)) estoque.clientes = [];
            clientes = estoque.clientes;
            if (!Array.isArray(estoque.propostas)) estoque.propostas = [];
            propostas = estoque.propostas;
            if (estoque.precificacao && typeof estoque.precificacao === 'object') precificacao = estoque.precificacao;
            else { estoque.precificacao = {}; precificacao = estoque.precificacao; }

            precificacao = (obj.precificacao && typeof obj.precificacao === 'object')
                ? obj.precificacao
                : (estoque.precificacao || {});
            tabelaAliquotas = (obj.tabelaAliquotas && typeof obj.tabelaAliquotas === 'object')
                ? obj.tabelaAliquotas
                : (estoque.tabelaAliquotas || {});
            tabelaICMS = Array.isArray(obj.tabelaICMS)
                ? obj.tabelaICMS
                : (Array.isArray(estoque.tabelaICMS) ? estoque.tabelaICMS : []);
            categoriaPorProduto = (obj.categoriaPorProduto && typeof obj.categoriaPorProduto === 'object')
                ? obj.categoriaPorProduto
                : (estoque.categoriaPorProduto || {});

            // Restaurar tabelas de impostos editáveis do arquivo importado
            impostosEditaveis = obj.impostosEditaveis || {};
            icmsEditavelPJ = obj.icmsEditavelPJ || {};
            icmsEditavelPF = obj.icmsEditavelPF || {};
            try { inicializarImpostosEditaveis(); } catch (e) {}
            try { inicializarICMSEditavel(); } catch (e) {}

            salvarDados();

            // Re-renderizar tudo
            renderizarTabela();
            renderizarDashboard();
            renderizarRegistroVendas();
            renderizarRegistroDistribuicao();
            renderizarClientes();
            atualizarKPIsClientes();
            atualizarDatalistClientes();
            renderizarPropostas();
            atualizarKPIsPropostas();
            renderizarPrecificacao();
            atualizarSelectsProdutos();
            atualizarEstatisticas();

            mostrarNotificacao('Importação do sistema concluída com sucesso!', 'success');
        } catch (error) {
            console.error('Erro ao importar sistema:', error);
            mostrarNotificacao('Erro ao processar o arquivo JSON. Verifique o formato.', 'error');
        } finally {
            event.target.value = '';
        }
    };

    reader.readAsText(file, 'UTF-8');
}


function exportarBackupCompleto() {
    try {
        const backup = {
            versao: '2.0',
            data: new Date().toISOString(),
            dados: estoque,
            imbelData: loadImbel(),
            precificacoesCliente: precificacoesCliente,
            impostosEditaveis: impostosEditaveis,
            icmsEditavelPJ: icmsEditavelPJ,
            icmsEditavelPF: icmsEditavelPF
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'backup_FI_' + new Date().toISOString().split('T')[0] + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        mostrarNotificacao('Backup exportado com sucesso!', 'success');
    } catch (e) {
        console.error('Erro ao exportar backup completo:', e);
        mostrarNotificacao('Erro ao exportar backup: ' + (e.message || e), 'error');
    }
}

function importarBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const backup = JSON.parse(e.target.result);
            if (!backup || !backup.dados || !backup.versao) throw new Error('Formato inválido');
            if (!confirm('Importar backup de ' + new Date(backup.data).toLocaleDateString('pt-BR') + '?\nIsso substituirá TODOS os dados atuais.')) {
                event.target.value = ''; 
                return;
            }
            estoque = backup.dados;
            precificacoesCliente = backup.precificacoesCliente || [];
            impostosEditaveis    = backup.impostosEditaveis    || {};
            icmsEditavelPJ       = backup.icmsEditavelPJ       || {};
            icmsEditavelPF       = backup.icmsEditavelPF       || {};
            // Restore IMBEL data if present in backup
            try {
                if (backup.imbelData) {
                    localStorage.setItem(IMBEL_KEY, JSON.stringify(backup.imbelData));
                }
            } catch(e) {}
            try { salvarDados(); } catch (e) {}
            location.reload();
        } catch (err) {
            console.error('Erro ao importar backup:', err);
            mostrarNotificacao('Erro ao importar backup: ' + (err.message || err), 'error');
        } finally {
            event.target.value = '';
        }
    };
    reader.readAsText(file);
}


function importarEstoque(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const conteudo = e.target.result;
            const linhas = conteudo.split(/\r?\n/).filter(l => l.trim());
            
            if (linhas.length < 2) {
                mostrarNotificacao('Arquivo vazio ou sem dados!', 'error');
                return;
            }
            
            // Ler cabeçalho para identificar colunas
            const cabecalho = parseCsvLinha(linhas[0]);
            console.debug('Cabeçalho:', cabecalho);
            
            let produtosAtualizados = 0;
            let erros = [];
            
            // Processar cada linha
            for (let i = 1; i < linhas.length; i++) {
                const linha = linhas[i].trim();
                if (!linha) continue;
                
                const colunas = parseCsvLinha(linha);
                
                if (colunas.length < 2) {
                    erros.push(`Linha ${i + 1}: formato inválido`);
                    continue;
                }
                
                const produtoNome = colunas[0]?.trim().toUpperCase();
                
                if (!produtoNome) continue;
                
                // Buscar produto
                let produto = estoque.produtos.find(p => 
                    p.nome.toUpperCase() === produtoNome ||
                    p.nome.toUpperCase().includes(produtoNome) ||
                    produtoNome.includes(p.nome.toUpperCase())
                );
                
                if (!produto) {
                    erros.push(`Linha ${i + 1}: produto não encontrado (${produtoNome})`);
                    continue;
                }
                
                // Atualizar quantidade total no estoque IMBEL
                // Formato novo: PRODUTO;QUANTIDADE_TOTAL
                // Compatibilidade: se vier formato antigo (PRODUTO;PRECO;QUANTIDADE_TOTAL), usa a 3a coluna
                const qtdCol = (colunas.length >= 3) ? colunas[2] : colunas[1];
                if (qtdCol !== undefined) {
                    const quantidade = parseInt(qtdCol) || 0;
                    // Atualizar o saldo consolidado (campo de cadastro)
                    produto.estoqueConsolidado = quantidade;
                }
                
                produtosAtualizados++;
            }
            
            if (produtosAtualizados > 0) {
                salvarDados();
                renderizarTabela();
                renderizarDashboard();
                renderizarRegistroVendas();
                renderizarRegistroDistribuicao();
                atualizarEstatisticas();
            }
            
            // Limpar input
            event.target.value = '';
            
            // Mostrar resultado
            if (erros.length > 0 && produtosAtualizados === 0) {
                mostrarNotificacao(`Nenhum produto atualizado. Verifique o formato.`, 'error');
                console.debug('Erros de importação:', erros);
            } else if (erros.length > 0) {
                mostrarNotificacao(`${produtosAtualizados} produtos atualizados. ${erros.length} erros.`, 'warning');
                console.debug('Erros de importação:', erros);
            } else {
                mostrarNotificacao(`${produtosAtualizados} produtos atualizados com sucesso!`, 'success');
            }
            
        } catch (error) {
            console.error('Erro ao importar:', error);
            mostrarNotificacao('Erro ao processar o arquivo. Verifique o formato.', 'error');
        }
    };
    
    reader.readAsText(file, 'UTF-8');
}

// ========================================
// IMPORTAÇÃO DE VENDAS
// ========================================

function importarVendas(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const conteudo = e.target.result;
            console.debug('Conteúdo do arquivo:', conteudo); // Debug
            
            const linhas = conteudo.split(/\r?\n/).filter(l => l.trim());
            
            console.debug('Linhas encontradas:', linhas.length); // Debug
            console.debug('Primeira linha:', linhas[0]); // Debug
            if (linhas[1]) console.debug('Segunda linha:', linhas[1]); // Debug
            
            // Pular cabeçalho
            if (linhas.length < 2) {
                mostrarNotificacao('Arquivo vazio ou sem dados!', 'error');
                return;
            }
            
            let vendasImportadas = 0;
            let erros = [];
            
            // Processar cada linha (começando da segunda - pular cabeçalho)
            for (let i = 1; i < linhas.length; i++) {
                const linha = linhas[i].trim();
                if (!linha || linha.toLowerCase().includes('total')) continue;
                
                // Parse do CSV com suporte a aspas
                const colunas = parseCsvLinha(linha);
                
                console.debug(`Linha ${i + 1} - Colunas:`, colunas); // Debug
                
                // Pular linha se primeira coluna estiver vazia (linha de total ou vazia)
                if (!colunas[0] || colunas[0].trim() === '') continue;
                
                if (colunas.length < 5) {
                    erros.push(`Linha ${i + 1}: formato inválido (${colunas.length} colunas encontradas)`);
                    continue;
                }
                
                const contrato = colunas[0]?.trim();
                const loja = colunas[1]?.trim().replace(/"/g, '').toUpperCase();
                const representante = colunas[2]?.trim().toUpperCase();
                const produtoNome = colunas[3]?.trim().replace(/"/g, '').toUpperCase();
                const quantidade = parseInt(colunas[4]?.trim()) || 0;
                const observacoes = colunas[7]?.trim()?.replace(/"/g, '') || '';
                
                console.debug(`Dados: contrato=${contrato}, loja=${loja}, rep=${representante}, produto=${produtoNome}, qtd=${quantidade}`); // Debug
                
                if (!contrato || !loja || !representante || !produtoNome || quantidade <= 0) {
                    erros.push(`Linha ${i + 1}: dados obrigatórios faltando (contrato=${contrato}, loja=${loja}, rep=${representante}, produto=${produtoNome}, qtd=${quantidade})`);
                    continue;
                }
                
                // Verificar se representante é válido
                const repsValidos = ['KOLTE', 'ISA', 'LC', 'ADES', 'FL', 'IMBEL'];
                if (!repsValidos.includes(representante)) {
                    erros.push(`Linha ${i + 1}: representante inválido (${representante})`);
                    continue;
                }
                
                // Buscar produto pelo nome (correspondência parcial)
                let produto = estoque.produtos.find(p => 
                    p.nome.toUpperCase() === produtoNome || 
                    p.nome.toUpperCase().includes(produtoNome) ||
                    produtoNome.includes(p.nome.toUpperCase())
                );
                
                if (!produto) {
                    erros.push(`Linha ${i + 1}: produto não encontrado (${produtoNome})`);
                    continue;
                }
                
                // Valor deve vir do registro da venda (arquivo), sem vínculo com cadastro de produto
                const valorUnitario = parseFloat((colunas[5] || '0').toString().replace(/\./g, '').replace(',', '.')) || 0;
                const valorTotalArquivo = parseFloat((colunas[6] || '0').toString().replace(/\./g, '').replace(',', '.')) || 0;
                const valorTotal = valorTotalArquivo > 0 ? valorTotalArquivo : (valorUnitario * quantidade);
                
                // Criar registro da venda
                const novaVenda = {
                    id: Date.now() + i,
                    contrato: contrato,
                    loja: loja,
                    representante: representante,
                    produtoId: produto.id,
                    produtoNome: produto.nome,
                    quantidade: quantidade,
                    valorUnitario: valorUnitario,
                    valorTotal: valorTotal,
                    observacoes: observacoes,
                    data: new Date().toISOString()
                };
                
                // Apenas registrar a venda (NÃO mexer na distribuição)
                // A distribuição deve ser feita separadamente na aba Distribuição
                produto.vendas[representante] = (produto.vendas[representante] || 0) + quantidade;
                
                // Adicionar ao registro
                estoque.registroVendas.push(novaVenda);
                vendasImportadas++;
            }
            
            if (vendasImportadas > 0) {
                salvarDados();
                renderizarTabela();
                renderizarDashboard();
                renderizarRegistroVendas();
            }
            
            // Limpar input
            event.target.value = '';
            
            // Mostrar resultado
            if (erros.length > 0 && vendasImportadas === 0) {
                mostrarNotificacao(`Nenhuma venda importada. Verifique o formato do arquivo.`, 'error');
                console.debug('Erros de importação:', erros);
            } else if (erros.length > 0) {
                mostrarNotificacao(`${vendasImportadas} vendas importadas. ${erros.length} linhas com erro.`, 'warning');
                console.debug('Erros de importação:', erros);
            } else {
                mostrarNotificacao(`${vendasImportadas} vendas importadas com sucesso!`, 'success');
            }
            
        } catch (error) {
            console.error('Erro ao importar:', error);
            mostrarNotificacao('Erro ao processar o arquivo. Verifique o formato.', 'error');
        }
    };
    
    reader.readAsText(file, 'UTF-8');
}

function parseCsvLinha(linha) {
    const resultado = [];
    let atual = '';
    let dentroAspas = false;
    
    // Detectar separador (TAB, ponto-e-vírgula ou vírgula)
    let separador = '\t';
    if (linha.includes('\t')) {
        separador = '\t';
    } else if (linha.includes(';')) {
        separador = ';';
    } else if (linha.includes(',')) {
        separador = ',';
    }
    
    for (let i = 0; i < linha.length; i++) {
        const char = linha[i];
        
        if (char === '"') {
            dentroAspas = !dentroAspas;
        } else if (char === separador && !dentroAspas) {
            resultado.push(atual.trim());
            atual = '';
        } else {
            atual += char;
        }
    }
    resultado.push(atual.trim());
    
    return resultado;
}

// ========================================
// LIMPAR DADOS DO SISTEMA
// ========================================

function limparTodosDados() {
    if (!confirm('⚠️ ATENÇÃO!\n\nEsta ação irá APAGAR TODOS os dados do sistema:\n- Produtos\n- Distribuições\n- Vendas\n- Registro de vendas\n- Registro de distribuição\n\nOs dados serão resetados para os valores iniciais.\n\nDeseja continuar?')) {
        return;
    }
    
    if (!confirm('ÚLTIMA CONFIRMAÇÃO:\n\nVocê tem certeza absoluta? Esta ação não pode ser desfeita!')) {
        return;
    }
    
    // Remover do localStorage
    localStorage.removeItem('estoqueArmasV2');
    
    // Recarregar dados iniciais
    estoque.produtos = dadosIniciais.map((item, index) => ({
        id: index + 1,
        nome: item.nome,
        preco: item.preco,
        distribuicao: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 },
        vendas: { KOLTE: 0, ISA: 0, LC: 0, ADES: 0, FL: 0, IMBEL: 0 }
    }));
    estoque.registroVendas = [];
    estoque.registroDistribuicao = [];
    estoque.controleEnvio = {};
    estoque.clientes = [];
    clientes = estoque.clientes;
    estoque.propostas = [];
    propostas = estoque.propostas;
    estoque.precificacao = {};
    precificacoesCliente = [];
    estoque.precificacoesCliente = [];
    estoque.precificacaoConfig = null;
    precificacao = estoque.precificacao;
    tabelaAliquotas = {};
    tabelaICMS = [];
    categoriaPorProduto = {};
    // Limpar tabelas de impostos editáveis
    impostosEditaveis = {};
    icmsEditavelPJ = {};
    icmsEditavelPF = {};
    
    salvarDados();
    renderizarTabela();
    renderizarDashboard();
    renderizarRegistroVendas();
    renderizarRegistroDistribuicao();
    renderizarControleEnvio();
    renderizarClientes();
    atualizarKPIsClientes();
    atualizarDatalistClientes();
    renderizarPropostas();
    atualizarKPIsPropostas();
    renderizarPrecificacao();
    atualizarSelectsProdutos();
    atualizarEstatisticas();
    
    mostrarNotificacao('Todos os dados foram apagados!', 'success');
}

// ========================================
// CONTROLE DE ENVIO DE CONTRATOS
// ========================================

function campoMarcado(valor) {
    return valor === true || valor === 'Sim' || valor === 'SAP' || valor === 'Outro' || valor === 'true';
}

function renderizarControleEnvio() {
    const tbody = document.getElementById('tabelaControleEnvioBody');
    if (!tbody) return;

    const filtroRep = document.getElementById('filtroControleEnvioRep')?.value || '';
    const filtroSistema = document.getElementById('filtroControleEnvioSistema')?.value || '';
    const filtroAssinado = document.getElementById('filtroControleEnvioAssinado')?.value || '';
    const filtroEnviado = document.getElementById('filtroControleEnvioEnviado')?.value || '';

    // Agrupa vendas por contrato (pega a primeira ocorrência de cada contrato)
    const contratoMap = {};
    
    estoque.registroVendas.forEach(venda => {
        if (!contratoMap[venda.contrato]) {
            contratoMap[venda.contrato] = {
                contrato: venda.contrato,
                loja: venda.loja,
                representante: venda.representante,
                id: venda.id
            };
        }
    });

    let contratos = Object.values(contratoMap);

    if (filtroRep) {
        contratos = contratos.filter(c => c.representante === filtroRep);
    }

    if (filtroSistema || filtroAssinado || filtroEnviado) {
        contratos = contratos.filter(c => {
            const envio = estoque.controleEnvio[c.contrato] || {};
            const sistemaMarcado = campoMarcado(envio.sistema);
            const assinadoMarcado = campoMarcado(envio.assinado);
            const enviadoMarcado = campoMarcado(envio.enviado);

            if (filtroSistema === 'sim' && !sistemaMarcado) return false;
            if (filtroSistema === 'nao' && sistemaMarcado) return false;
            if (filtroAssinado === 'sim' && !assinadoMarcado) return false;
            if (filtroAssinado === 'nao' && assinadoMarcado) return false;
            if (filtroEnviado === 'sim' && !enviadoMarcado) return false;
            if (filtroEnviado === 'nao' && enviadoMarcado) return false;

            return true;
        });
    }

    contratos = contratos.sort((a, b) => {
        const contratoA = parseInt(a.contrato) || 0;
        const contratoB = parseInt(b.contrato) || 0;
        return contratoA - contratoB;
    });

    tbody.innerHTML = '';

    if (contratos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div class="empty-icon">📮</div>
                    <div class="empty-text">Nenhum contrato registrado</div>
                    <div class="empty-hint">Registre vendas na aba "Registro de Vendas" para aparecerem aqui</div>
                </td>
            </tr>
        `;
        return;
    }

    contratos.forEach(contrato => {
        const envio = estoque.controleEnvio[contrato.contrato] || {};
        const sistemaMarcado = campoMarcado(envio.sistema);
        const assinadoMarcado = campoMarcado(envio.assinado);
        const enviadoMarcado = campoMarcado(envio.enviado);
        const repClass = (contrato.representante || '').toLowerCase();
        const concluidos = Number(sistemaMarcado) + Number(assinadoMarcado) + Number(enviadoMarcado);

        const statusBtn = (checked, campo) => `
            <button type="button" class="status-indicator ${checked ? 'checked' : ''}" onclick="salvarControleEnvio('${contrato.contrato}', '${campo}', ${!checked})" title="${campo}">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path fill="white" d="M4.7 9.2 1.9 6.4l1.1-1.1 1.7 1.7 4.2-4.2L10 4z"/></svg>
            </button>
        `;

        const tr = document.createElement('tr');
        if (concluidos === 3) tr.classList.add('row-envio-completo');
        tr.innerHTML = `
            <td class="col-contrato">
                <div class="ctr-cell">
                    <span>${contrato.contrato}</span>
                    <span class="ctr-progress">${concluidos}/3</span>
                </div>
            </td>
            <td class="col-loja" title="${contrato.loja}">${contrato.loja}</td>
            <td class="col-representante"><span class="badge-rep ${repClass}">${contrato.representante}</span></td>
            <td class="col-sistema">
                ${statusBtn(sistemaMarcado, 'sistema')}
            </td>
            <td class="col-assinado">
                ${statusBtn(assinadoMarcado, 'assinado')}
            </td>
            <td class="col-enviado">
                ${statusBtn(enviadoMarcado, 'enviado')}
            </td>
            <td class="col-solicitacao">
                <input type="text" class="campo-editavel" value="${envio.solicitacao || ''}" placeholder="Data ou observação" onchange="salvarControleEnvio('${contrato.contrato}', 'solicitacao', this.value)">
            </td>
            <td class="col-acoes">
                <button class="btn-action btn-delete" onclick="limparControleEnvio('${contrato.contrato}')" title="Limpar dados">🗑</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function salvarControleEnvio(contrato, campo, valor) {
    if (!estoque.controleEnvio[contrato]) {
        estoque.controleEnvio[contrato] = {};
    }

    if (campo === 'sistema' || campo === 'assinado' || campo === 'enviado') {
        valor = Boolean(valor);
    }
    
    estoque.controleEnvio[contrato][campo] = valor;
    salvarDados();
    // Re-renderizar a tabela para refletir imediatamente a alteração visual
    try { renderizarControleEnvio(); } catch (e) {}
}

function limparFiltrosControleEnvio() {
    const filtroRep = document.getElementById('filtroControleEnvioRep');
    const filtroSistema = document.getElementById('filtroControleEnvioSistema');
    const filtroAssinado = document.getElementById('filtroControleEnvioAssinado');
    const filtroEnviado = document.getElementById('filtroControleEnvioEnviado');

    if (filtroRep) filtroRep.value = '';
    if (filtroSistema) filtroSistema.value = '';
    if (filtroAssinado) filtroAssinado.value = '';
    if (filtroEnviado) filtroEnviado.value = '';

    renderizarControleEnvio();
}

function limparControleEnvio(contrato) {
    if (confirm(`Deseja limpar os dados de envio do contrato ${contrato}?`)) {
        delete estoque.controleEnvio[contrato];
        salvarDados();
        renderizarControleEnvio();
        mostrarNotificacao(`Dados de envio do contrato ${contrato} removidos`, 'success');
    }
}

function exportarControleEnvio() {
    const contratoMap = {};
    
    estoque.registroVendas.forEach(venda => {
        if (!contratoMap[venda.contrato]) {
            contratoMap[venda.contrato] = {
                contrato: venda.contrato,
                loja: venda.loja,
                representante: venda.representante
            };
        }
    });

    const contratos = Object.values(contratoMap).sort((a, b) => {
        const contratoA = parseInt(a.contrato) || 0;
        const contratoB = parseInt(b.contrato) || 0;
        return contratoA - contratoB;
    });

    const dados = contratos.map(c => {
        const envio = estoque.controleEnvio[c.contrato] || {};
        const sistemaMarcado = campoMarcado(envio.sistema);
        return {
            'CTR': c.contrato,
            'NOME': c.loja,
            'REPRESENTANTE': c.representante,
            'SISTEMA': sistemaMarcado ? 'Sim' : 'Não',
            'ASSINADO': envio.assinado ? 'Sim' : 'Não',
            'ENVIADO': envio.enviado ? 'Sim' : 'Não',
            'SOLICITAÇÃO': envio.solicitacao || ''
        };
    });

    const csv = gerarCSV(dados);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Controle_Envio_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
}

function gerarCSV(dados) {
    if (!dados || dados.length === 0) return '';
    
    const headers = Object.keys(dados[0]);
    const csv = [
        headers.join(';'),
        ...dados.map(row => headers.map(header => `"${(row[header] || '').toString().replace(/"/g, '""')}"`).join(';'))
    ].join('\n');
    
    return csv;
}

// ========================================
// INICIALIZAÇÃO
// ========================================

// No sistema integrado, inicializar() é chamado sob demanda pelo roteador unificado
// document.addEventListener('DOMContentLoaded', inicializar); // DESATIVADO
window._estoqueInicializarFn = inicializar;

// ========================================
// BUSCA / FILTRO NA TABELA DE ESTOQUE
// ========================================

function filtrarTabelaEstoque(termo) {
    const tbody = document.getElementById('corpoTabela');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr:not(.total-row)');
    const termoLower = (termo || '').toLowerCase().trim();

    rows.forEach(row => {
        const nome = (row.querySelector('.produto-nome')?.textContent || '').toLowerCase();
        const obs = (row.dataset.observacoes || '').toLowerCase();
        const match = (!termoLower) || nome.includes(termoLower) || obs.includes(termoLower);
        row.style.display = match ? '' : 'none';
    });
}

// ========================================
// BUSCA GLOBAL
// ========================================

let _buscaGlobalTimer = null;
function executarBuscaGlobal(termo) {
    if (_buscaGlobalTimer) clearTimeout(_buscaGlobalTimer);
    _buscaGlobalTimer = setTimeout(() => {
        _executarBuscaGlobalReal(termo);
    }, 400);
}

function _executarBuscaGlobalReal(termo) {
    if (!termo || termo.trim().length < 2) return;
    const t = termo.toLowerCase().trim();
    const resultados = { produtos: [], vendas: [], distribuicoes: [], contratos: [] };

    // Buscar em produtos
    estoque.produtos.forEach(p => {
        if (p.nome.toLowerCase().includes(t)) {
            resultados.produtos.push(p);
        }
    });

    // Buscar em vendas
    (estoque.registroVendas || []).forEach(v => {
        const match = (v.contrato || '').toLowerCase().includes(t) ||
                      (v.loja || '').toLowerCase().includes(t) ||
                      (v.representante || '').toLowerCase().includes(t);
        if (match) resultados.vendas.push(v);
    });

    // Buscar em distribuições
    (estoque.registroDistribuicao || []).forEach(d => {
        const match = (d.produtoNome || '').toLowerCase().includes(t) ||
                      (d.representante || '').toLowerCase().includes(t);
        if (match) resultados.distribuicoes.push(d);
    });

    const container = document.getElementById('resultadosBuscaGlobal');
    if (!container) return;

    let html = '';
    const total = resultados.produtos.length + resultados.vendas.length + resultados.distribuicoes.length;

    if (total === 0) {
        html = '<p style="text-align:center;color:var(--text-secondary);padding:20px">Nenhum resultado encontrado.</p>';
    } else {
        if (resultados.produtos.length > 0) {
            html += '<div class="busca-categoria"><h4>📦 Produtos (' + resultados.produtos.length + ')</h4>';
            resultados.produtos.forEach(p => {
                html += `<div class="busca-resultado-item" onclick="fecharModal('modalBuscaGlobal');trocarAba('estoque')"><span>${p.nome}</span><span class="resultado-aba">Estoque</span></div>`;
            });
            html += '</div>';
        }
        if (resultados.vendas.length > 0) {
            html += '<div class="busca-categoria"><h4>📝 Vendas (' + resultados.vendas.length + ')</h4>';
            resultados.vendas.slice(0, 20).forEach(v => {
                html += `<div class="busca-resultado-item" onclick="fecharModal('modalBuscaGlobal');trocarAba('vendas')"><span>CTR ${v.contrato} — ${v.loja} (${v.representante})</span><span class="resultado-aba">Vendas</span></div>`;
            });
            html += '</div>';
        }
        if (resultados.distribuicoes.length > 0) {
            html += '<div class="busca-categoria"><h4>🚚 Distribuições (' + resultados.distribuicoes.length + ')</h4>';
            resultados.distribuicoes.slice(0, 20).forEach(d => {
                html += `<div class="busca-resultado-item" onclick="fecharModal('modalBuscaGlobal');trocarAba('distribuicao')"><span>${d.produtoNome} → ${d.representante} (${d.quantidade})</span><span class="resultado-aba">Distribuição</span></div>`;
            });
            html += '</div>';
        }
    }

    container.innerHTML = html;
    document.getElementById('modalBuscaGlobal').style.display = 'flex';
}

// ========================================
// SIDEBAR RESPONSIVA (DESKTOP + MOBILE)
// ========================================

function toggleSidebarExpanded() {
    document.body.classList.toggle('sidebar-expanded');
}

function toggleMobileSidebar(forceOpen) {
    const shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : !document.body.classList.contains('mobile-sidebar-open');
    document.body.classList.toggle('mobile-sidebar-open', shouldOpen);
}

// Compatibilidade com chamadas antigas
function toggleMenuMobile() {
    toggleMobileSidebar();
}

// ========================================
// ORDENAÇÃO CLICÁVEL NAS COLUNAS
// ========================================

let _ordenVendas = { campo: 'contrato', direcao: 'asc' };
let _ordenDistribuicao = { campo: 'data', direcao: 'desc' };
let _contratosExpandidos = {};

function ordenarVendas(campo) {
    if (_ordenVendas.campo === campo) {
        _ordenVendas.direcao = _ordenVendas.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        _ordenVendas.campo = campo;
        _ordenVendas.direcao = 'asc';
    }
    // Atualizar ícones
    document.querySelectorAll('#tabelaRegistroVendas th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === campo) th.classList.add('sort-' + _ordenVendas.direcao);
    });
    renderizarRegistroVendas();
}

function ordenarDistribuicao(campo) {
    if (_ordenDistribuicao.campo === campo) {
        _ordenDistribuicao.direcao = _ordenDistribuicao.direcao === 'asc' ? 'desc' : 'asc';
    } else {
        _ordenDistribuicao.campo = campo;
        _ordenDistribuicao.direcao = 'asc';
    }
    document.querySelectorAll('#tabelaRegistroDistribuicao th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sort === campo) th.classList.add('sort-' + _ordenDistribuicao.direcao);
    });
    renderizarRegistroDistribuicao();
}

// Estado genérico de ordenação para múltiplas tabelas
let _sortState = {};

function aplicarSortTabela(table, campo) {
    const cur = _sortState[table] || { col: null, dir: 'asc' };
    if (cur.col === campo) cur.dir = cur.dir === 'asc' ? 'desc' : 'asc';
    else { cur.col = campo; cur.dir = 'asc'; }
    _sortState[table] = cur;

    // Atualizar classes visuais nos cabeçalhos da tabela
    try {
        document.querySelectorAll(`[data-table="${table}"] th[data-sort]`).forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === campo) th.classList.add('sort-' + cur.dir);
        });
    } catch (e) { }

    // Compatibilidade com ordenação antiga específica de vendas
    if (table === 'vendas') {
        _ordenVendas.campo = cur.col;
        _ordenVendas.direcao = cur.dir;
    }
}

function getSortedArray(arr, campo, direcao, getValue) {
    if (!campo) return Array.isArray(arr) ? arr.slice() : [];
    const dir = (direcao === 'desc') ? -1 : 1;
    return (arr || []).slice().sort((a, b) => {
        try {
            let va = getValue ? getValue(a, campo) : a[campo];
            let vb = getValue ? getValue(b, campo) : b[campo];
            if (va == null) va = '';
            if (vb == null) vb = '';

            // Números nativos
            if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);

            // Tentar parseFloat (remoção de simbolos monetários)
            const na = parseFloat(String(va).replace(/[^0-9,.-]+/g, '').replace(',', '.'));
            const nb = parseFloat(String(vb).replace(/[^0-9,.-]+/g, '').replace(',', '.'));
            if (!isNaN(na) && !isNaN(nb)) return dir * (na - nb);

            // Datas
            const da = Date.parse(String(va));
            const db = Date.parse(String(vb));
            if (!isNaN(da) && !isNaN(db)) return dir * (da - db);

            // Texto
            const sa = String(va).toLowerCase();
            const sb = String(vb).toLowerCase();
            if (sa < sb) return -1 * dir;
            if (sa > sb) return 1 * dir;
            return 0;
        } catch (e) { return 0; }
    });
}

function sortVendas(campo) { aplicarSortTabela('vendas', campo); try { renderizarRegistroVendas(); } catch(e){} }
function sortClientes(campo) { aplicarSortTabela('clientes', campo); try { renderizarClientes(); } catch(e){} }
function sortPropostas(campo) { aplicarSortTabela('propostas', campo); try { renderizarPropostas(); } catch(e){} }

// ========================================
// PAGINAÇÃO
// ========================================

const ITENS_POR_PAGINA_OPCOES = [15, 30, 50, 100];
let _paginaVendas = 1;
let _itensPorPaginaVendas = 30;
let _paginaDistribuicao = 1;
let _itensPorPaginaDistribuicao = 30;

function renderizarPaginacao(containerId, paginaAtual, totalItens, itensPorPagina, onChangePage, onChangePerPage) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPaginas = Math.max(1, Math.ceil(totalItens / itensPorPagina));
    if (totalItens <= itensPorPagina) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button class="page-btn" ${paginaAtual <= 1 ? 'disabled' : ''} onclick="${onChangePage}(${paginaAtual - 1})">‹</button>`;

    const maxBtns = 5;
    let start = Math.max(1, paginaAtual - Math.floor(maxBtns / 2));
    let end = Math.min(totalPaginas, start + maxBtns - 1);
    if (end - start < maxBtns - 1) start = Math.max(1, end - maxBtns + 1);

    if (start > 1) html += `<button class="page-btn" onclick="${onChangePage}(1)">1</button><span class="page-info">...</span>`;

    for (let i = start; i <= end; i++) {
        html += `<button class="page-btn ${i === paginaAtual ? 'active' : ''}" onclick="${onChangePage}(${i})">${i}</button>`;
    }

    if (end < totalPaginas) html += `<span class="page-info">...</span><button class="page-btn" onclick="${onChangePage}(${totalPaginas})">${totalPaginas}</button>`;

    html += `<button class="page-btn" ${paginaAtual >= totalPaginas ? 'disabled' : ''} onclick="${onChangePage}(${paginaAtual + 1})">›</button>`;
    html += `<span class="page-info">${totalItens} registros</span>`;
    html += `<select onchange="${onChangePerPage}(parseInt(this.value))">`;
    ITENS_POR_PAGINA_OPCOES.forEach(n => {
        html += `<option value="${n}" ${n === itensPorPagina ? 'selected' : ''}>${n} por pág.</option>`;
    });
    html += '</select>';

    container.innerHTML = html;
}

function mudarPaginaVendas(p) { _paginaVendas = p; renderizarRegistroVendas(); }
function mudarItensPaginaVendas(n) { _itensPorPaginaVendas = n; _paginaVendas = 1; renderizarRegistroVendas(); }
function mudarPaginaDistribuicao(p) { _paginaDistribuicao = p; renderizarRegistroDistribuicao(); }
function mudarItensPaginaDistribuicao(n) { _itensPorPaginaDistribuicao = n; _paginaDistribuicao = 1; renderizarRegistroDistribuicao(); }

// ========================================
// NOTIFICAÇÕES DE ESTOQUE BAIXO
// ========================================

const LIMITE_ESTOQUE_BAIXO = 3;

function verificarEstoqueBaixo() {
    try {
        return verificarAlertasEstoque();
    } catch (e) {
        console.warn('verificarAlertasEstoque falhou', e);
        return 0;
    }
}

function salvarConfigAlertas() {
    try {
        const limEl = document.getElementById('limiteAlertaEstoque');
        const ativoEl = document.getElementById('alertasAtivos');
        const limite = limEl ? parseInt(limEl.value || '0', 10) : configAlertas.limite;
        const ativo = ativoEl ? !!ativoEl.checked : !!configAlertas.ativo;
        configAlertas.limite = isNaN(limite) ? configAlertas.limite : limite;
        configAlertas.ativo = ativo;
        try { localStorage.setItem('configAlertas', JSON.stringify(configAlertas)); } catch (e) {}
        mostrarNotificacao('Configurações de alertas salvas.', 'success');
        verificarAlertasEstoque();
    } catch (e) {
        console.warn('salvarConfigAlertas erro', e);
        mostrarNotificacao('Erro ao salvar configurações de alertas.', 'error');
    }
}

function togglePainelAlertas() {
    try {
        const painel = document.getElementById('painelAlertas');
        if (!painel) return;
        if (painel.style.display === 'block') painel.style.display = 'none';
        else { painel.style.display = 'block'; verificarAlertasEstoque(); }
    } catch (e) { console.warn('togglePainelAlertas erro', e); }
}

function fecharPainelAlertas() {
    const p = document.getElementById('painelAlertas');
    if (p) p.style.display = 'none';
}

function verificarAlertasEstoque() {
    try {
        const limite = (configAlertas && typeof configAlertas.limite === 'number') ? configAlertas.limite : LIMITE_ESTOQUE_BAIXO;
        const ativo = (configAlertas && typeof configAlertas.ativo !== 'undefined') ? !!configAlertas.ativo : true;
        const alertas = [];
        if (!Array.isArray(estoque.produtos) || !Array.isArray(estoque.representantes)) {
            const badge = document.getElementById('badgeAlertas'); if (badge) badge.style.display = 'none';
            const el = document.getElementById('alertaEstoqueBaixo'); if (el) el.style.display = 'none';
            const lista = document.getElementById('listaPainelAlertas'); if (lista) lista.innerHTML = '';
            return 0;
        }

        estoque.produtos.forEach(produto => {
            let totalDisp = 0, totalVenda = 0;
            const repsZerados = [];
            estoque.representantes.forEach(rep => {
                const disp = Number((produto.distribuicao && produto.distribuicao[rep]) || 0);
                const venda = Number((produto.vendas && produto.vendas[rep]) || 0);
                totalDisp += disp;
                totalVenda += venda;
                const saldoRep = disp - venda;
                if (saldoRep === 0) repsZerados.push(rep);
            });
            const saldoConsolidado = totalDisp - totalVenda;
            if (saldoConsolidado <= limite) {
                alertas.push({ id: produto.id, nome: produto.nome, saldoConsolidado, repsZerados });
            }
        });

        // Precificações expirando em até 3 dias
        const precifExpirando = (precificacoesCliente || []).filter(p => {
            if (!p || p.status !== 'ativa' || !p.dataExpiracao) return false;
            const dias = Math.ceil((new Date(p.dataExpiracao) - new Date()) / 86400000);
            return dias >= 0 && dias <= 3;
        });

        // Total de alertas inclui produtos + precificações expirando
        const totalCount = alertas.length + (precifExpirando ? precifExpirando.length : 0);

        // atualizar badge (produtos em alerta + precificações expirando)
        const badge = document.getElementById('badgeAlertas');
        if (badge) {
            if (totalCount > 0) { badge.style.display = 'inline-flex'; badge.textContent = String(totalCount); }
            else { badge.style.display = 'none'; }
        }

        const totalAlertasMsg = document.getElementById('totalAlertasMsg');
        if (totalAlertasMsg) {
            if (totalCount > 0) {
                totalAlertasMsg.textContent = `${totalCount} alerta(s) no total`;
            } else {
                totalAlertasMsg.textContent = 'Nenhum alerta no momento';
            }
        }

        // atualizar lista do painel
        const lista = document.getElementById('listaPainelAlertas');
        if (lista) {
            if (alertas.length === 0 && (!precifExpirando || precifExpirando.length === 0)) {
                lista.innerHTML = '<div style="color:#64748b">Nenhum alerta no momento.</div>';
            } else {
                let html = '';
                alertas.forEach(a => {
                    const label = (a.saldoConsolidado === 0) ? 'ZERADO' : ((a.saldoConsolidado <= Math.max(1, Math.floor(limite/2))) ? 'CRÍTICO' : 'BAIXO');
                    const color = label === 'ZERADO' ? '#ef4444' : (label === 'CRÍTICO' ? '#f59e0b' : '#fb923c');
                    const bg = label === 'ZERADO' ? '#fff1f2' : '#fff7ed';
                    html += `<div style="padding:10px; margin-bottom:8px; border-radius:8px; border-left:4px solid ${color}; background:${bg}">` +
                                `<div style="font-weight:700; color:#0f172a">${a.nome}</div>` +
                                `<div style="font-size:0.85rem; color:#334155; margin-top:6px">Saldo consolidado: <strong>${a.saldoConsolidado}</strong> un.</div>` +
                                (a.repsZerados && a.repsZerados.length ? `<div style="font-size:0.8rem; color:#64748b; margin-top:6px">Representantes sem saldo: ${a.repsZerados.join(', ')}</div>` : '') +
                              `</div>`;
                });
                lista.innerHTML = html;
                                // anexar alertas de precificações expirando/vence em até 3 dias
                if (precifExpirando && precifExpirando.length) {
                    precifExpirando.forEach(p => {
                        const dias = Math.ceil((new Date(p.dataExpiracao) - new Date()) / 86400000);
                        lista.insertAdjacentHTML('beforeend', `
                                                <div style="padding:10px; margin-bottom:8px; border-radius:8px; border-left:3px solid #f59e0b; background:#fffbeb">
                          <div style="font-weight:600; font-size:0.88rem; color:#1e293b">
                                                        ⚠️ Precificação expirando — ${p.clienteNome || ''}
                          </div>
                                                    <div style="font-size:0.78rem; color:#64748b; margin-top:3px">
                                                        v${p.versao || 1} expira em ${dias} dia(s)
                          </div>
                          <button onclick="trocarSubabaPrecif('porcliente')"
                                                                    style="font-size:0.75rem; color:#f59e0b; background:none; border:none; cursor:pointer; text-decoration:underline; padding:4px 0 0">
                            Ver precificação →
                          </button>
                        </div>
                      `);
                    });
                }
            }
        }

        // Remover exibição do aviso: esconder painel e alerta visual.
        // Mantemos a lógica de cálculo, mas não mostramos o aviso na UI.
        const el = document.getElementById('alertaEstoqueBaixo');
        if (el) {
            el.style.display = 'none';
            el.innerHTML = '';
        }
        const painel = document.getElementById('painelAlertas');
        if (painel) painel.style.display = 'none';
        const btnA = document.getElementById('btnAlertas');
        if (btnA) btnA.style.display = 'none';
        const badgeEl = document.getElementById('badgeAlertas');
        if (badgeEl) badgeEl.style.display = 'none';

        const agora = new Date();
        const alertasPropostas = [];
        let mudouStatusProposta = false;

        (propostas || []).forEach(proposta => {
            if (!proposta.dataExpiracao) return;
            if (!['enviada', 'rascunho'].includes(proposta.status)) return;

            const exp = new Date(proposta.dataExpiracao);
            const dias = Math.ceil((exp - agora) / 86400000);

            if (dias < 0 && proposta.status === 'enviada') {
                proposta.status = 'expirada';
                mudouStatusProposta = true;
                alertasPropostas.push({
                    proposta, cor: '#94a3b8', urgencia: 'EXPIRADA', tipo: 'expirada'
                });
            } else if (dias >= 0 && dias <= 3) {
                alertasPropostas.push({
                    proposta, diasRestantes: dias,
                    cor: dias === 0 ? '#dc2626' : '#d97706',
                    urgencia: dias === 0 ? 'VENCE HOJE'
                        : dias === 1 ? 'VENCE AMANHÃ'
                        : `Vence em ${dias} dias`,
                    tipo: 'expirando'
                });
            }
        });

        (propostas || []).filter(p => p.aguardandoAprovacao || p.status === 'aguardando_aprovacao')
            .forEach(p => alertasPropostas.push({
                proposta: p, cor: '#7c3aed', urgencia: 'AGUARD. APROVAÇÃO', tipo: 'aprovacao'
            }));

        // Propostas recusadas recentemente (até 7 dias) — avisar time para follow-up
        (propostas || []).forEach(p => {
            if (p && p.status === 'recusada' && p.dataRecusa) {
                const diasDesde = Math.ceil((agora - new Date(p.dataRecusa)) / 86400000);
                if (diasDesde >= 0 && diasDesde <= 7) {
                    alertasPropostas.push({ proposta: p, cor: '#ef4444', urgencia: 'RECUSADA', tipo: 'recusa' });
                }
            }
        });

        if (mudouStatusProposta) {
            try { estoque.propostas = propostas; } catch (e) {}
            try { salvarDados(); } catch (e) {}
        }

        if (alertasPropostas.length > 0) {
            const lista = document.getElementById('listaPainelAlertas');
            if (lista) {
                if ((lista.textContent || '').includes('Nenhum alerta no momento')) lista.innerHTML = '';

                const header = document.createElement('div');
                header.style.cssText = 'font-size:0.7rem;font-weight:700;color:#64748b;' +
                    'text-transform:uppercase;letter-spacing:0.8px;padding:8px 0 4px;' +
                    'margin-top:8px;border-top:1px solid #f1f5f9';
                header.textContent = `Propostas (${alertasPropostas.length})`;
                lista.appendChild(header);

                alertasPropostas.forEach(alerta => {
                    const p = alerta.proposta;
                    const fmt = v => 'R$' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                    const div = document.createElement('div');
                    div.style.cssText = `padding:10px;margin-bottom:8px;border-radius:8px; border-left:3px solid ${alerta.cor};background:${alerta.cor}10`;
                                        div.innerHTML = `
                    <div style="display:flex;justify-content:space-between;align-items:flex-start">
                        <div style="font-weight:600;font-size:0.88rem;color:#1e293b">
                            ${alerta.tipo === 'aprovacao' ? '⏳' : (alerta.tipo === 'recusa' ? '❌' : '📋')} Proposta ${p.numero}
                        </div>
                        <span style="font-size:0.68rem;font-weight:700;color:${alerta.cor};
                                                 background:${alerta.cor}20;padding:1px 7px;
                                                 border-radius:20px;white-space:nowrap">
                            ${alerta.urgencia}
                        </span>
                    </div>
                    <div style="font-size:0.78rem;color:#64748b;margin-top:3px">
                        ${p.cliente} · ${fmt(p.valorTotal)}
                    </div>
                    ${alerta.tipo === 'aprovacao' && p.motivoAprovacao
                                                        ? `<div style="font-size:0.75rem;color:#7c3aed;margin-top:3px">Motivo: ${_escapeHtml(String(p.motivoAprovacao))}</div>` : ''}
                    ${alerta.tipo === 'recusa' && p.motivoRecusa
                                                        ? `<div style="font-size:0.75rem;color:#dc2626;margin-top:3px">Motivo: ${_escapeHtml(String(p.motivoRecusa))}</div>` : ''}
                    <button onclick="trocarAba('propostas');fecharPainelAlertas();"
                                    style="font-size:0.75rem;color:${alerta.cor};background:none;
                                                 border:none;cursor:pointer;text-decoration:underline;
                                                 padding:4px 0 0">
                        Ver proposta →
                    </button>`;
                    lista.appendChild(div);
                });
            }
        }

        // Add proposal alerts to total badge count
        const countSaldoZero = alertas.length;
        const totalAlertas = totalCount;
        const totalComPropostas = (totalAlertas || 0) + alertasPropostas.length;
        const badge2 = document.getElementById('badgeAlertas');
        if (badge2) {
            badge2.textContent = totalComPropostas;
            badge2.style.display = totalComPropostas > 0 ? 'flex' : 'none';
        }
        const totalMsg = document.getElementById('totalAlertasMsg');
        if (totalMsg) {
            const partes = [];
            if ((countSaldoZero || 0) > 0) partes.push(`${countSaldoZero} produto(s) em estoque baixo`);
            if (alertasPropostas.length > 0) partes.push(`${alertasPropostas.length} alerta(s) de proposta`);
            totalMsg.textContent = partes.join(' · ') || 'Nenhum alerta';
        }

        return totalComPropostas;
    } catch (e) {
        console.warn('verificarAlertasEstoque erro', e);
        return 0;
    }
}

// ========================================
// DASHBOARD COM GRÁFICOS (Chart.js)
// ========================================

let _chartVendasRep = null;
let _chartTopProdutos = null;
let _chartComissoesRep = null;
let _chartValorVendasRep = null;

// Plugin Chart.js para desenhar valores acima das barras
const __drawValuesAbovePlugin = {
    id: 'drawValuesAbove',
    afterDatasetsDraw(chart, args, pluginOptions) {
        const opts = pluginOptions || {};
        if (opts.display === false) return;
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, dsIndex) => {
            const meta = chart.getDatasetMeta(dsIndex);
            if (!meta || !meta.data) return;
            meta.data.forEach((element, index) => {
                const val = dataset.data[index];
                if (val === null || typeof val === 'undefined') return;
                if (chart.config.type && chart.config.type !== 'bar') return;
                const x = element.x !== undefined ? element.x : (element.getCenterPoint ? element.getCenterPoint().x : null);
                const y = element.y !== undefined ? element.y : (element.getCenterPoint ? element.getCenterPoint().y : null);
                if (x === null || y === null) return;
                ctx.save();
                const fontSize = opts.fontSize || 12;
                const fontFamily = opts.fontFamily || getComputedStyle(document.documentElement).getPropertyValue('--font-primary') || 'Inter, system-ui, sans-serif';
                ctx.font = `${fontSize}px ${fontFamily}`;
                ctx.fillStyle = opts.color || '#0b1723';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                let text = '';
                if (opts.format === 'currency') {
                    const num = Number(val) || 0;
                    text = 'R$ ' + num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                } else {
                    const num = Number(val);
                    text = Number.isFinite(num) ? num.toLocaleString('pt-BR') : String(val);
                }
                const offset = opts.offset || 6;
                ctx.fillText(text, x, y - offset);
                ctx.restore();
            });
        });
    }
};
if (typeof Chart !== 'undefined' && Chart) { try { Chart.register(__drawValuesAbovePlugin); } catch (e) { } }

function renderizarGraficos() {
    if (typeof Chart === 'undefined') return;

    const reps = ['KOLTE', 'ISA', 'LC', 'ADES', 'FL', 'IMBEL'];
    const coresReps = ['#79c0ff', '#7ee787', '#58a6ff', '#ffa657', '#d2a8ff', '#ff7b72'];
    const vendasFiltradas = obterVendasDashboardFiltradas();
    const vendasPorRepMap = {};
    reps.forEach(rep => { vendasPorRepMap[rep] = 0; });

    const produtoTotals = new Map();
    vendasFiltradas.forEach(v => {
        const rep = (v.representante || '').toUpperCase();
        const itens = obterItensVendaNormalizados(v);
        itens.forEach(it => {
            if (vendasPorRepMap[rep] === undefined) vendasPorRepMap[rep] = 0;
            vendasPorRepMap[rep] += Number(it.quantidade) || 0;
            produtoTotals.set(it.produtoNome, (produtoTotals.get(it.produtoNome) || 0) + (Number(it.quantidade) || 0));
        });
    });
    const vendasPorRep = reps.map(rep => vendasPorRepMap[rep] || 0);

    // Ordenar decrescente mantendo cores e labels
    const vendasArr = reps.map((rep, i) => ({ rep, value: vendasPorRep[i] || 0, color: coresReps[i] || '#79c0ff' }));
    vendasArr.sort((a, b) => b.value - a.value);
    const vendasLabels = vendasArr.map(x => x.rep);
    const vendasValues = vendasArr.map(x => x.value);
    const vendasColors = vendasArr.map(x => x.color);

    // Chart 1: Vendas por Representante (bar)
    const ctx1 = document.getElementById('chartVendasRep');
    if (ctx1) {
        if (_chartVendasRep) _chartVendasRep.destroy();
        _chartVendasRep = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: vendasLabels,
                datasets: [{
                    label: 'Unidades Vendidas',
                    data: vendasValues,
                    backgroundColor: vendasColors,
                    borderColor: vendasColors,
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { 
                    legend: { display: false },
                    drawValuesAbove: { display: true, format: 'number', fontSize: 12, color: '#0b1723', offset: 6 }
                },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
            }
        });
    }

    // Chart 2: Top Produtos (doughnut)
    const dadosProdutos = Array.from(produtoTotals.entries())
        .map(([nome, total]) => ({ nome: (nome || '').substring(0, 20), total }))
        .filter(p => p.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);

    const ctx2 = document.getElementById('chartTopProdutos');
    if (ctx2) {
        if (_chartTopProdutos) _chartTopProdutos.destroy();
        const palette = ['#79c0ff', '#7ee787', '#58a6ff', '#ffa657', '#d2a8ff', '#ff7b72'];
        _chartTopProdutos = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: dadosProdutos.map(p => p.nome),
                datasets: [{
                    data: dadosProdutos.map(p => p.total),
                    backgroundColor: palette.slice(0, dadosProdutos.length),
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } }
                }
            }
        });
    }
}

function renderizarGraficoComissoes() {
    if (typeof Chart === 'undefined') return;
    const periodo = (document.getElementById('filtroComissoesGraficoPeriodo') || {}).value || 'todos';
    const reps = (estoque.representantes || ['KOLTE', 'ISA', 'LC', 'ADES', 'FL']).filter(r => r !== 'IMBEL');
    const coresReps = ['#79c0ff', '#7ee787', '#58a6ff', '#ffa657', '#d2a8ff', '#ff7b72'];

    const agora = new Date();
    const vendas = (Array.isArray(estoque.registroVendas) ? [...estoque.registroVendas] : [])
        .filter(v => !v.cancelado && ((v.representante || '').toUpperCase() !== 'IMBEL'));

    const vendasFiltradas = vendas.filter(v => {
        if (periodo === 'todos') return true;
        const d = new Date(v.data || v.dataVenda || '');
        if (isNaN(d)) return false;
        if (periodo === 'mes') return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
        if (periodo === 'trimestre') {
            const trimestreAtual = Math.floor(agora.getMonth() / 3);
            return Math.floor(d.getMonth() / 3) === trimestreAtual && d.getFullYear() === agora.getFullYear();
        }
        if (periodo === 'ano') return d.getFullYear() === agora.getFullYear();
        return true;
    });

    const comissoesPorRep = {};
    reps.forEach(r => { comissoesPorRep[r] = 0; });
    vendasFiltradas.forEach(v => {
        const rep = (v.representante || '').toUpperCase();
        const valor = Number(v.valorContrato || v.valorTotal || v.valor || 0);
        const pct = Number(v.comissaoPct || v.comissao || 5) / 100;
        if (comissoesPorRep[rep] !== undefined) comissoesPorRep[rep] += valor * pct;
    });

    const valores = reps.map(r => Math.round((comissoesPorRep[r] || 0) * 100) / 100);
    // ordenar decrescente mantendo cores
    const comArr = reps.map((r, i) => ({ rep: r, value: valores[i] || 0, color: coresReps[i] || '#79c0ff' }));
    comArr.sort((a, b) => b.value - a.value);
    const comLabels = comArr.map(x => x.rep);
    const comValues = comArr.map(x => x.value);
    const comColors = comArr.map(x => x.color);
    const total = comValues.reduce((a, b) => a + b, 0);

    const ctx = document.getElementById('chartComissoesRep');
    if (ctx) {
        if (_chartComissoesRep) _chartComissoesRep.destroy();
        _chartComissoesRep = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: comLabels,
                datasets: [{
                    label: 'Comissão (R$)',
                    data: comValues,
                    backgroundColor: comColors,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, drawValuesAbove: { display: true, format: 'currency', fontSize: 12, color: '#0b1723', offset: 6 } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + v.toLocaleString('pt-BR') } } }
            }
        });
    }

    const tabela = document.getElementById('tabelaComissoesGrafico');
    if (tabela) {
        tabela.innerHTML = reps.map((r, i) =>
            `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f1f5f9">
                <span style="color:${coresReps[i]};font-weight:600">${r}</span>
                <span>R$ ${(valores[i] || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</span>
            </div>`
        ).join('');
    }

    const totalEl = document.getElementById('totalComissoesGrafico');
    if (totalEl) totalEl.textContent = 'Total: R$ ' + total.toLocaleString('pt-BR', {minimumFractionDigits: 2});

    // --- Gráfico: Valor de Vendas por Representante (inclui IMBEL) ---
    try {
        const repsValor = Array.isArray(estoque.representantes) ? [...estoque.representantes] : ['KOLTE', 'ISA', 'LC', 'ADES', 'FL'];
        if (!repsValor.map(r => String(r).toUpperCase()).includes('IMBEL')) repsValor.push('IMBEL');
        const repColorMap = { KOLTE: '#79c0ff', ISA: '#7ee787', LC: '#58a6ff', ADES: '#ffa657', FL: '#d2a8ff', IMBEL: '#ff7b72' };

        const vendasAll = (Array.isArray(estoque.registroVendas) ? [...estoque.registroVendas] : []).filter(v => !v.cancelado);
        const vendasFiltradasValor = vendasAll.filter(v => {
            if (periodo === 'todos') return true;
            const d = new Date(v.data || v.dataVenda || '');
            if (isNaN(d)) return false;
            if (periodo === 'mes') return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
            if (periodo === 'trimestre') {
                const trimestreAtual = Math.floor(agora.getMonth() / 3);
                return Math.floor(d.getMonth() / 3) === trimestreAtual && d.getFullYear() === agora.getFullYear();
            }
            if (periodo === 'ano') return d.getFullYear() === agora.getFullYear();
            return true;
        });

        const vendasValorMap = {};
        repsValor.forEach(r => { vendasValorMap[(r || '').toUpperCase()] = 0; });
        vendasFiltradasValor.forEach(v => {
            const rep = ((v.representante || '') + '').toUpperCase() || 'IMBEL';
            const itens = obterItensVendaNormalizados(v);
            itens.forEach(it => {
                vendasValorMap[rep] = (vendasValorMap[rep] || 0) + (Number(it.valorTotal) || 0);
            });
        });

        // DEBUG: comparar soma por itens (vendasValorMap) vs soma por venda.valorTotal (vendasByInvoice)
        try {
            const vendasByInvoice = {};
            vendasFiltradasValor.forEach(v => {
                const rep = ((v.representante || '') + '').toUpperCase() || 'IMBEL';
                vendasByInvoice[rep] = (vendasByInvoice[rep] || 0) + (Number(v.valorTotal) || 0);
            });
            // garantir chaves一致
            Object.keys(vendasValorMap).forEach(k => { if (vendasByInvoice[k] === undefined) vendasByInvoice[k] = 0; });

            const comparison = Object.keys(vendasValorMap).map(k => {
                const byItems = Math.round((vendasValorMap[k] || 0) * 100) / 100;
                const byInvoice = Math.round((vendasByInvoice[k] || 0) * 100) / 100;
                return { representante: k, porItens: byItems, porVenda: byInvoice, diferenca: Math.round((byItems - byInvoice) * 100) / 100 };
            });
            const totalItens = comparison.reduce((s, r) => s + r.porItens, 0);
            const totalInvoice = comparison.reduce((s, r) => s + r.porVenda, 0);
            console.groupCollapsed('DEBUG: comparação vendas por representante (itens vs. venda.valorTotal)');
            console.table(comparison.map(r => ({ Representante: r.representante, 'Por itens (R$)': r.porItens.toLocaleString('pt-BR', {minimumFractionDigits:2}), 'Por venda (R$)': r.porVenda.toLocaleString('pt-BR', {minimumFractionDigits:2}), 'Diferença (R$)': r.diferenca.toLocaleString('pt-BR', {minimumFractionDigits:2}) })));
            console.log('Totais — Por itens:', totalItens.toLocaleString('pt-BR', {minimumFractionDigits:2}), ' Por venda:', totalInvoice.toLocaleString('pt-BR', {minimumFractionDigits:2}), ' Dif:', (totalItens - totalInvoice).toLocaleString('pt-BR', {minimumFractionDigits:2}));
            console.groupEnd();
        } catch (err) { console.warn('DEBUG comparação vendas por rep falhou', err); }

        const valorArr = Object.keys(vendasValorMap).map(rep => ({ rep, value: Math.round((vendasValorMap[rep] || 0) * 100) / 100, color: repColorMap[rep] || '#79c0ff' }));
        valorArr.sort((a, b) => b.value - a.value);
        const valorLabels = valorArr.map(x => x.rep);
        const valorValues = valorArr.map(x => x.value);
        const valorColors = valorArr.map(x => x.color);

        const ctxVal = document.getElementById('chartValorVendasRep');
        if (ctxVal) {
            if (_chartValorVendasRep) _chartValorVendasRep.destroy();
            _chartValorVendasRep = new Chart(ctxVal, {
                type: 'bar',
                data: {
                    labels: valorLabels,
                    datasets: [{ label: 'Vendas (R$)', data: valorValues, backgroundColor: valorColors, borderRadius: 6 }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false }, drawValuesAbove: { display: true, format: 'currency', fontSize: 12, color: '#0b1723', offset: 6 } },
                    scales: { y: { beginAtZero: true, ticks: { callback: v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) } } }
                }
            });
        }
    } catch (e) { console.warn('erro renderizar valor vendas por rep', e); }
}

// ========================================
// MÓDULO DE CLIENTES
// ========================================

function abrirModalCliente(id = null) {
    document.getElementById('clienteEditId').value = '';
    document.getElementById('clienteNome').value = '';
    document.getElementById('clienteCnpj').value = '';
    document.getElementById('clienteEndereco').value = '';
    document.getElementById('clienteCidade').value = '';
    document.getElementById('clienteUf').value = '';
    document.getElementById('clienteTelefone').value = '';
    document.getElementById('clienteEmail').value = '';
    document.getElementById('clienteContato').value = '';
    try { popularSelectRepresentantes('clienteRepresentante', true); } catch (e) {}
    document.getElementById('clienteRepresentante').value = '';
    document.getElementById('clienteObservacoes').value = '';
    document.getElementById('modalClienteTitulo').textContent = 'Novo Cliente';
    try { if (typeof selecionarTipoPessoa === 'function') selecionarTipoPessoa('PJ'); } catch(e) {}

    if (id) {
        const cliente = clientes.find(c => c.id === id);
        if (cliente) {
            document.getElementById('clienteEditId').value = cliente.id;
            document.getElementById('clienteNome').value = cliente.nome || '';
            document.getElementById('clienteCnpj').value = cliente.cnpj || '';
            document.getElementById('clienteEndereco').value = cliente.endereco || '';
            document.getElementById('clienteCidade').value = cliente.cidade || '';
            document.getElementById('clienteUf').value = cliente.uf || '';
            document.getElementById('clienteTelefone').value = cliente.telefone || '';
            document.getElementById('clienteEmail').value = cliente.email || '';
            document.getElementById('clienteContato').value = cliente.contato || '';
            document.getElementById('clienteRepresentante').value = cliente.representante || '';
            document.getElementById('clienteObservacoes').value = cliente.observacoes || '';
            document.getElementById('modalClienteTitulo').textContent = 'Editar Cliente';
            // determinar tipo de pessoa a partir do registro salvo ou do formato do documento
            try {
                const tipoPessoa = cliente.tipoPessoa || (((cliente.cnpj||'').replace(/\D/g,'').length <= 11) ? 'PF' : 'PJ');
                if (typeof selecionarTipoPessoa === 'function') selecionarTipoPessoa(tipoPessoa);
            } catch(e) {}
        }
    }

    document.getElementById('modalCliente').style.display = 'block';
    try { if (typeof limparValidacaoDocumento === 'function') limparValidacaoDocumento(); } catch(e) {}
}

function fecharModalCliente() {
    fecharModal('modalCliente');
}

// Seleciona tipo de pessoa e ajusta rótulo/placeholder/styles
function selecionarTipoPessoa(tipo) {
    const hiddenInput = document.getElementById('clienteTipoPessoa');
    const label = document.getElementById('labelClienteDocumento');
    const input = document.getElementById('clienteCnpj');
    const btnPJ = document.getElementById('btnTipoPJ');
    const btnPF = document.getElementById('btnTipoPF');

    if (hiddenInput) hiddenInput.value = tipo;

    if (tipo === 'PJ') {
        if (label) label.textContent = 'CNPJ';
        if (input) {
            input.placeholder = '00.000.000/0001-00';
            input.maxLength = 18;
        }
        if (btnPJ) { btnPJ.style.background = '#1e3a5f'; btnPJ.style.color = '#fff'; }
        if (btnPF) { btnPF.style.background = '#f1f5f9'; btnPF.style.color = '#64748b'; }
    } else {
        if (label) label.textContent = 'CPF';
        if (input) {
            input.placeholder = '000.000.000-00';
            input.maxLength = 14;
        }
        if (btnPJ) { btnPJ.style.background = '#f1f5f9'; btnPJ.style.color = '#64748b'; }
        if (btnPF) { btnPF.style.background = '#1e3a5f'; btnPF.style.color = '#fff'; }
    }

    // Clear the field when switching type
    if (input) input.value = '';
}

function aplicarMascaraDocumento(input) {
    // Uses the existing formatCpfCnpjMask() function
    const tipo = document.getElementById('clienteTipoPessoa')?.value || 'PJ';
    const digits = (input.value || '').replace(/\D/g, '');

    if (tipo === 'PF') {
        // Force CPF mask (max 11 digits)
        const cpfDigits = digits.slice(0, 11);
        input.value = formatCpfCnpjMask(cpfDigits + 'xxx');
        input.value = formatCpfCnpjMask(cpfDigits);
    } else {
        // CNPJ mask (max 14 digits)
        input.value = formatCpfCnpjMask(digits.slice(0, 14));
    }
}

function salvarCliente(event) {
    event.preventDefault();

    const editId = document.getElementById('clienteEditId').value;
    const dados = {
        nome: document.getElementById('clienteNome').value.trim(),
        cnpj: document.getElementById('clienteCnpj').value.trim(),
        tipoPessoa: document.getElementById('clienteTipoPessoa')?.value || 'PJ',
        endereco: document.getElementById('clienteEndereco').value.trim(),
        cidade: document.getElementById('clienteCidade').value.trim(),
        uf: document.getElementById('clienteUf').value.trim().toUpperCase(),
        telefone: document.getElementById('clienteTelefone').value.trim(),
        email: document.getElementById('clienteEmail').value.trim(),
        contato: document.getElementById('clienteContato').value.trim(),
        representante: document.getElementById('clienteRepresentante').value,
        observacoes: document.getElementById('clienteObservacoes').value.trim()
    };

    // Valida o CPF/CNPJ antes de salvar
    try {
        if (!validarDocumentoCliente()) {
            mostrarNotificacao('Documento inválido. Corrija antes de salvar.', 'error');
            return;
        }
    } catch (e) {}

    if (editId) {
        const idx = clientes.findIndex(c => c.id === editId);
        if (idx !== -1) {
            clientes[idx] = { ...clientes[idx], ...dados };
            registrarHistorico('edição', `Cliente editado: ${dados.nome}`);
        }
    } else {
        const novo = {
            id: Date.now().toString(),
            ...dados,
            dataCadastro: new Date().toISOString()
        };
        clientes.push(novo);
        registrarHistorico('cadastro', `Cliente cadastrado: ${dados.nome}`);
    }

    renderizarClientes();
    fecharModal('modalCliente');
    atualizarKPIsClientes();
    atualizarDatalistClientes();
    estoque.clientes = clientes;
    salvarDados();
    salvarNoCloud().catch(e => console.error('Auto-save clientes falhou:', e));
    // Se a sub-aba de precificação por cliente estiver aberta, atualizar o dropdown
    try {
        const sub = document.getElementById('subaba-precif-porcliente');
        if (sub && sub.style.display === 'block') {
            popularSelectClientesPrecif();
        }
    } catch (e) {}
}

function excluirCliente(id) {
    const cliente = clientes.find(c => c.id === id);
    if (!cliente) return;
    if (!confirm(`Deseja excluir este cliente?\n${cliente.nome}`)) return;
    clientes = clientes.filter(c => c.id !== id);
    estoque.clientes = clientes;
    registrarHistorico('exclusão', `Cliente excluído: ${cliente.nome}`);
    renderizarClientes();
    atualizarKPIsClientes();
    atualizarDatalistClientes();
    salvarDados();
    salvarNoCloud().catch(e => console.error('Auto-save clientes falhou:', e));
}

function renderizarClientes(filtro = '') {
    const tbody = document.getElementById('tabelaClientesBody');
    if (!tbody) return;

    const termo = (filtro || '').toLowerCase();
    const clientesFiltrados = (clientes || []).filter(c =>
        !termo ||
        (c.nome || '').toLowerCase().includes(termo) ||
        (c.cnpj || '').includes(termo) ||
        (c.uf || '').toLowerCase().includes(termo) ||
        (c.contato || '').toLowerCase().includes(termo)
    );

    // Aplicar ordenação de clientes se houver
    const sortC = _sortState['clientes'] || { col: 'nome', dir: 'asc' };
    const getValCliente = (c, col) => {
        if (!c) return '';
        if (col === 'nome') return c.nome || '';
        if (col === 'cnpj') return c.cnpj || '';
        if (col === 'cidade') return ((c.cidade||'') + '/' + (c.uf||'')) || '';
        if (col === 'telefone') return c.telefone || '';
        if (col === 'email') return c.email || '';
        if (col === 'representante') return c.representante || '';
        if (col === 'compras') {
            const vendas = estoque.registroVendas || [];
            return vendas.filter(v => (v.loja || '').toLowerCase() === (c.nome || '').toLowerCase()).length;
        }
        return c[col] ?? '';
    };

    const clientesOrdenados = getSortedArray(clientesFiltrados, sortC.col, sortC.dir, getValCliente);

    if (clientesOrdenados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--text-secondary)">Nenhum cliente encontrado.</td></tr>';
        return;
    }

    const vendas = estoque.registroVendas || [];

    tbody.innerHTML = clientesOrdenados.map(c => {
        const repClass = (c.representante || '').toLowerCase();
        const repBadge = c.representante
            ? `<span class="badge-rep ${repClass}">${c.representante}</span>`
            : '-';

        const tipo = c.tipoPessoa || (((c.cnpj||'').replace(/\D/g,'').length <= 11) ? 'PF' : 'PJ');
        const tipoBadge = `
            <span style="font-size:0.72rem;font-weight:700;padding:2px 7px;
                         border-radius:20px;
                         background:${tipo==='PJ'?"#eff6ff":"#faf5ff"};
                         color:${tipo==='PJ'?"#1d4ed8":"#7c3aed"}">
              ${tipo}
            </span>`;

        // Contar vendas que referenciam este cliente pelo nome
        const totalCompras = vendas.filter(v =>
            (v.loja || '').toLowerCase() === (c.nome || '').toLowerCase()
        ).length;

        const cidadeUf = [c.cidade, c.uf].filter(Boolean).join(' / ');

        return `<tr>
            <td>${c.nome || '-'}</td>
            <td style="text-align:center">${tipoBadge}</td>
            <td>${c.cnpj || '-'}</td>
            <td>${cidadeUf || '-'}</td>
            <td>${c.telefone || '-'}</td>
            <td>${c.email || '-'}</td>
            <td>${c.contato || '-'}</td>
            <td>${repBadge}</td>
            <td style="text-align:center">${totalCompras}</td>
            <td class="col-acoes">
                <button class="btn-action" onclick="abrirHistoricoCliente('${c.id}')" title="Ver histórico de compras"
                    style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:0.8rem">
                    📋 Histórico
                </button>
                <button class="btn-action btn-edit" data-admin="true" onclick="abrirModalCliente('${c.id}')" title="Editar cliente">✎</button>
                <button class="btn-action btn-delete" data-admin="true" onclick="excluirCliente('${c.id}')" title="Excluir cliente">🗑</button>
            </td>
        </tr>`;
    }).join('');

    atualizarDatalistClientes();
}

function filtrarClientes(valor) {
    renderizarClientes(valor);
}

function atualizarKPIsClientes() {
    const totalEl = document.getElementById('kpiTotalClientes');
    const ativosEl = document.getElementById('kpiClientesAtivos');
    const ticketEl = document.getElementById('kpiTicketMedio');

    if (totalEl) totalEl.textContent = clientes.length;

    const vendas = estoque.registroVendas || [];

    // Clientes com compras e totais por cliente
    let clientesComCompras = 0;
    let somaTotal = 0;

    clientes.forEach(c => {
        const vendasCliente = vendas.filter(v =>
            (v.loja || '').toLowerCase() === (c.nome || '').toLowerCase()
        );
        if (vendasCliente.length > 0) {
            clientesComCompras++;
            vendasCliente.forEach(v => {
                if (Array.isArray(v.items)) {
                    v.items.forEach(it => { somaTotal += Number(it.valorTotal || 0); });
                } else {
                    somaTotal += Number(v.valorTotal || 0);
                }
            });
        }
    });

    if (ativosEl) ativosEl.textContent = clientesComCompras;
    if (ticketEl) {
        const ticketMedio = clientesComCompras > 0 ? somaTotal / clientesComCompras : 0;
        ticketEl.textContent = formatarMoedaValor(ticketMedio);
    }
}

function getClienteNomes() {
    return clientes.map(c => c.nome);
}

function atualizarDatalistClientes() {
    const datalist = document.getElementById('clientesDatalist');
    if (!datalist) return;
    datalist.innerHTML = clientes.map(c =>
        `<option value="${(c.nome || '').replace(/"/g, '&quot;')}">`
    ).join('');
}

function imprimirClientes() {
    const tabEl = document.getElementById('tab-clientes');
    if (!tabEl) return;
    const html = tabEl.querySelector('.table-container')?.innerHTML || '';
    const win = window.open('', '_blank');
    if (!win) { mostrarNotificacao('Pop-up bloqueado pelo navegador.', 'error'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Clientes</title>
        <style>body{font-family:Inter,Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 8px;font-size:12px}th{background:#f5f5f5;font-weight:600}.col-acoes{display:none}</style>
        <script>window.onload=function(){ setTimeout(function(){ window.print(); },200); }<\/script>
    </head><body><h2>Cadastro de Clientes</h2>${html}</body></html>`);
    win.document.close();
}

function exportarClientesExcel() {
    const lista = clientes || [];
    if (!lista.length) {
        mostrarNotificacao('Nenhum cliente para exportar.', 'warning');
        return;
    }

    // Pre-calculate purchases for each client
    const vendas = estoque.registroVendas || [];

    const rows = lista
        .slice()
        .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
        .map(c => {
            const cnpjLimpo = (c.cnpj || '').replace(/\D/g, '');
            const tipo = c.tipoPessoa || (cnpjLimpo.length === 14 ? 'PJ' : 'PF');

            const vendasCliente = vendas.filter(v =>
                (v.loja || '').toLowerCase() === (c.nome || '').toLowerCase()
            );
            const totalFaturado = vendasCliente.reduce((s, v) => s + (Number(v.valorTotal) || 0), 0);
            const totalContratos = vendasCliente.length;
            const ultimaCompra = vendasCliente.length > 0
                ? (vendasCliente.slice().sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0))[0].data || '')
                : '';

            return {
                'Nome / Razão Social':  c.nome        || '',
                'Tipo':                 tipo,
                'CNPJ / CPF':           c.cnpj        || '',
                'Endereço':             c.endereco     || '',
                'Cidade':               c.cidade       || '',
                'UF':                   c.uf           || '',
                'Telefone':             c.telefone     || '',
                'E-mail':               c.email        || '',
                'Contato':              c.contato      || '',
                'Representante':        c.representante || '',
                'Observações':          c.observacoes  || '',
                'Contratos Fechados':   totalContratos,
                'Total Faturado (R$)':  parseFloat(totalFaturado.toFixed(2)),
                'Última Compra':        ultimaCompra
                  ? new Date(ultimaCompra).toLocaleDateString('pt-BR')
                  : '',
                'Data Cadastro':        c.dataCadastro
                  ? new Date(c.dataCadastro).toLocaleDateString('pt-BR')
                  : '',
            };
        });

    try {
        const ws = XLSX.utils.json_to_sheet(rows);

        // Column widths
        ws['!cols'] = [
            { wch: 35 }, // Nome
            { wch: 6  }, // Tipo
            { wch: 20 }, // CNPJ
            { wch: 35 }, // Endereço
            { wch: 20 }, // Cidade
            { wch: 5  }, // UF
            { wch: 18 }, // Telefone
            { wch: 30 }, // Email
            { wch: 25 }, // Contato
            { wch: 14 }, // Representante
            { wch: 40 }, // Observações
            { wch: 10 }, // Contratos
            { wch: 18 }, // Total Faturado
            { wch: 14 }, // Última Compra
            { wch: 14 }, // Data Cadastro
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
        XLSX.writeFile(
            wb,
            'clientes_' + new Date().toISOString().split('T')[0] + '.xlsx'
        );
        mostrarNotificacao(
            `${rows.length} cliente(s) exportado(s) com sucesso!`,
            'success'
        );
    } catch (e) {
        console.error('Erro ao exportar clientes:', e);
        mostrarNotificacao('Erro ao gerar arquivo Excel.', 'error');
    }
}

let _clienteHistoricoAtual = null;

function abrirHistoricoCliente(clienteId) {
    const cliente = (clientes||[]).find(c => String(c.id) === String(clienteId));
    if (!cliente) return;
    _clienteHistoricoAtual = cliente;

    const vendas = (estoque.registroVendas||[])
        .filter(v => (v.loja||'').toLowerCase() === (cliente.nome||'').toLowerCase())
        .sort((a,b) => new Date(b.data||0) - new Date(a.data||0));

    const propostasC = (propostas||[])
        .filter(p => p.cliente === cliente.nome)
        .sort((a,b) => new Date(b.dataCriacao||b.data||0) - new Date(a.dataCriacao||a.data||0));

    const precifs = (precificacoesCliente||[])
        .filter(p => String(p.clienteId) === String(clienteId))
        .sort((a,b) => new Date(b.dataCriacao||0) - new Date(a.dataCriacao||0));

    const fmt = v => 'R$ ' + (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const totalFaturado = vendas.reduce((s,v) => s+(v.valorTotal||0), 0);
    const ticketMedio = vendas.length > 0 ? totalFaturado / vendas.length : 0;
    const taxaConversao = propostasC.length > 0
        ? Math.round(propostasC.filter(p=>p.status==='aceita').length / propostasC.length * 100)
        : 0;
    const ultimaCompra = vendas[0]?.data
        ? new Date(vendas[0].data).toLocaleDateString('pt-BR')
        : '—';

    // Header cards
    const headerEl = document.getElementById('historicoClienteHeader');
    if (headerEl) headerEl.innerHTML = `
        <div style="background:#eff6ff;border-radius:10px;padding:14px;
                                border:1px solid #bfdbfe;text-align:center">
            <div style="font-size:1.8rem;font-weight:800;color:#1d4ed8">
                ${vendas.length}
            </div>
            <div style="font-size:0.78rem;color:#64748b;text-transform:uppercase;
                                    letter-spacing:0.5px;margin-top:2px">Contratos</div>
        </div>
        <div style="background:#f0fdf4;border-radius:10px;padding:14px;
                                border:1px solid #86efac;text-align:center">
            <div style="font-size:1.4rem;font-weight:800;color:#16a34a">
                ${fmt(totalFaturado)}
            </div>
            <div style="font-size:0.78rem;color:#64748b;text-transform:uppercase;
                                    letter-spacing:0.5px;margin-top:2px">Total Faturado</div>
        </div>
        <div style="background:#fff7ed;border-radius:10px;padding:14px;
                                border:1px solid #fdba74;text-align:center">
            <div style="font-size:1.4rem;font-weight:800;color:#d97706">
                ${fmt(ticketMedio)}
            </div>
            <div style="font-size:0.78rem;color:#64748b;text-transform:uppercase;
                                    letter-spacing:0.5px;margin-top:2px">Ticket Médio</div>
        </div>
        <div style="background:#faf5ff;border-radius:10px;padding:14px;
                                border:1px solid #d8b4fe;text-align:center">
            <div style="font-size:1.8rem;font-weight:800;color:#7c3aed">
                ${taxaConversao}%
            </div>
            <div style="font-size:0.78rem;color:#64748b;text-transform:uppercase;
                                    letter-spacing:0.5px;margin-top:2px">Taxa Conversão</div>
        </div>
        <div style="background:#f1f5f9;border-radius:10px;padding:14px;
                                border:1px solid #cbd5e1;text-align:center">
            <div style="font-size:1rem;font-weight:700;color:#1e293b">
                ${ultimaCompra}
            </div>
            <div style="font-size:0.78rem;color:#64748b;text-transform:uppercase;
                                    letter-spacing:0.5px;margin-top:2px">Última Compra</div>
        </div>
    `;

    // Contratos tab
    const elContratos = document.getElementById('hcContent-contratos');
    if (elContratos) {
        elContratos.innerHTML = vendas.length === 0
            ? `<div style="text-align:center;padding:40px;color:#94a3b8">Nenhum contrato registrado para este cliente</div>`
            : `<table class="dashboard-table" style="font-size:0.85rem">
                    <thead>
                        <tr>
                            <th>Contrato</th>
                            <th>Data</th>
                            <th>Representante</th>
                            <th style="text-align:center">Itens</th>
                            <th style="text-align:right">Valor Total</th>
                            <th>Observações</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${vendas.map(v => `
                            <tr>
                                <td style="font-weight:700;color:#1e3a5f">#${v.contrato}</td>
                                <td>${v.data ? new Date(v.data).toLocaleDateString('pt-BR') : '—'}</td>
                                <td>${v.representante || '—'}</td>
                                <td style="text-align:center">${(v.items||v.itens||[]).length}</td>
                                <td style="text-align:right;font-weight:700;color:#16a34a">${fmt(v.valorTotal)}</td>
                                <td style="font-size:0.78rem;color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${v.observacoes||''}">${v.observacoes || '—'}</td>
                            </tr>`).join('')}
                    </tbody>
                    <tfoot>
                        <tr style="background:#f8fafc;font-weight:700">
                            <td colspan="4" style="padding:10px 12px;color:#64748b">Total (${vendas.length} contrato(s))</td>
                            <td style="text-align:right;color:#16a34a;font-size:1rem">${fmt(totalFaturado)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>`;
    }

    // Propostas tab
    const elPropostas = document.getElementById('hcContent-propostas');
    const statusColor = { rascunho:'#64748b', enviada:'#1d4ed8', aceita:'#16a34a', recusada:'#dc2626', expirada:'#d97706', convertida:'#0ea5e9' };
    if (elPropostas) {
        elPropostas.innerHTML = propostasC.length === 0
            ? `<div style="text-align:center;padding:40px;color:#94a3b8">Nenhuma proposta para este cliente</div>`
            : `<table class="dashboard-table" style="font-size:0.85rem">
                    <thead>
                        <tr>
                            <th>Proposta</th>
                            <th>Data</th>
                            <th>Status</th>
                            <th style="text-align:center">Itens</th>
                            <th style="text-align:right">Valor</th>
                            <th>Contrato</th>
                            <th>Motivo Recusa</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${propostasC.map(p => {
                            const sc = statusColor[p.status]||'#64748b';
                            return `<tr>
                                <td style="font-weight:700;color:#1e3a5f">${_escapeHtml(p.numero)}</td>
                                <td>${new Date(p.dataCriacao||p.data||new Date()).toLocaleDateString('pt-BR')}</td>
                                <td><span style="background:${sc}20;color:${sc};font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:20px">${p.status}</span></td>
                                <td style="text-align:center">${(p.itens||[]).length}</td>
                                <td style="text-align:right;font-weight:600;color:#16a34a">${fmt(p.valorTotal)}</td>
                                <td style="font-weight:600;color:#1e3a5f">${p.contratoNumero ? '#'+p.contratoNumero : '—'}</td>
                                <td style="font-size:0.78rem;color:#dc2626;max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${p.motivoRecusa||''}">${p.motivoRecusa || '—'}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>`;
    }

    // Precificações tab
    const elPrec = document.getElementById('hcContent-precificacoes');
    if (elPrec) {
        elPrec.innerHTML = precifs.length === 0
            ? `<div style="text-align:center;padding:40px;color:#94a3b8">Nenhuma precificação salva para este cliente</div>`
            : `<table class="dashboard-table" style="font-size:0.85rem">
                    <thead>
                        <tr>
                            <th>Versão</th>
                            <th>Data</th>
                            <th>Descrição</th>
                            <th>Taxa</th>
                            <th>ROI</th>
                            <th style="text-align:center">Produtos</th>
                            <th>Status</th>
                            <th>Proposta</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${precifs.map(p => `
                            <tr>
                                <td style="font-weight:700;color:#1e3a5f">v${p.versao||1}</td>
                                <td>${new Date(p.dataCriacao||new Date()).toLocaleDateString('pt-BR')}</td>
                                <td style="color:#475569">${_escapeHtml(p.descricao||'—')}</td>
                                <td style="text-align:center">${p.taxa||0}%</td>
                                <td style="text-align:center">${p.roi||0}%</td>
                                <td style="text-align:center">${(p.itens||[]).length}</td>
                                <td><span style="font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:20px;background:${p.status==='ativa'?'#f0fdf4':p.status==='convertida'?'#eff6ff':'#f1f5f9'};color:${p.status==='ativa'?'#16a34a':p.status==='convertida'?'#1d4ed8':'#64748b'}">${p.status}</span></td>
                                <td style="color:#0ea5e9;font-weight:600">${p.propostaId ? ((propostas||[]).find(x=>x.id===p.propostaId)?.numero||'—') : '—'}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>`;
    }

    // Show first tab
    trocarAbaHistoricoCliente('contratos');
    const modal = document.getElementById('modalHistoricoCliente');
    if (modal) modal.style.display = 'flex';
}

function trocarAbaHistoricoCliente(aba) {
    ['contratos','propostas','precificacoes'].forEach(t => {
        const content = document.getElementById('hcContent-' + t);
        const btn = document.getElementById('hcTab-' + t);
        if (content) content.style.display = t === aba ? 'block' : 'none';
        if (btn) {
            btn.style.color = t === aba ? '#1e3a5f' : '#64748b';
            btn.style.borderBottomColor = t === aba ? '#1e3a5f' : 'transparent';
        }
    });
}

// ========================================
// MÓDULO DE PRECIFICAÇÃO
// ========================================

const ESTADOS_BR = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
];

function _nomeProdutoId(nome) {
    return String(nome || '').replace(/[^a-zA-Z0-9]/g, '_');
}

function gerarRelatorioVendasImbel() {
    const data   = loadImbel();
    const prods  = data.produtos || [];
    const checks = document.querySelectorAll('.imbel_table_chk_sel:checked, .imbel-mov-check:checked');

    if (!checks.length) {
        mostrarNotificacao(
            'Selecione ao menos uma movimentação para gerar o relatório.',
            'warning'
        );
        return;
    }

    // Coletar movimentos a partir das checkboxes selecionadas (suporta grupos com data-ids)
    const rows = [];
    const dataAll = loadImbel();
    checks.forEach(cb => {
        const singleId = cb.dataset.id;
        const groupIds = cb.dataset.ids;

        const ids = groupIds ? groupIds.split(',').filter(Boolean) : (singleId ? [singleId] : []);

        ids.forEach(id => {
            const mov = (dataAll.movimentacoes||[]).find(m => m.id === id);
            if (!mov) return;
            const prod = (dataAll.produtos||[]).find(p => p.id === mov.produtoId);
            rows.push({
                produto:    mov.produtoNome || prod?.nome || '—',
                quantidade: Number(mov.quantidade) || 0,
                nome:       mov.destinatario || '—',
                cpf:        mov.cpfCnpj     || '—',
                valor:      Number(mov.valor) || 0,
                endereco:   mov.endereco    || '—',
                email:      mov.email       || '—',
            });
        });
    });

    if (!rows.length) {
        mostrarNotificacao('Nenhuma movimentação válida selecionada.', 'warning');
        return;
    }

    const fmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const totalValor = rows.reduce((s,r) => s+r.valor, 0);
    const totalQtd   = rows.reduce((s,r) => s+Number(r.quantidade), 0);
    const dataGeracao = new Date().toLocaleDateString('pt-BR');

    const win = window.open('', '_blank', 'width=1100,height=700');
    if (!win) {
        mostrarNotificacao(
            'Não foi possível abrir a janela. Permita popups.', 'error'
        );
        return;
    }

    win.document.write(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="utf-8">
            <title>Relatório de Vendas IMBEL</title>
            <style>
                @page { size: A4 landscape; margin: 12mm; }
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    font-family: 'Segoe UI', Arial, sans-serif;
                    font-size: 11px;
                    color: #1e293b;
                }
                .header {
                    background: #1e3a5f;
                    color: #fff;
                    padding: 14px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                    border-radius: 6px;
                }
                .header h1 { font-size: 16px; font-weight: 700; }
                .header .meta { font-size: 11px; opacity: 0.8; text-align: right; }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 11px;
                }
                thead tr {
                    background: #1e3a5f;
                    color: #fff;
                }
                th {
                    padding: 9px 10px;
                    text-align: left;
                    font-weight: 600;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    white-space: nowrap;
                }
                td {
                    padding: 8px 10px;
                    border-bottom: 1px solid #e2e8f0;
                    vertical-align: top;
                }
                tr:nth-child(even) td { background: #f8fafc; }
                tr:hover td { background: #eff6ff; }
                .col-qtd { text-align: center; font-weight: 700; }
                .col-valor { text-align: right; font-weight: 700; color: #16a34a; }
                .footer-row td {
                    background: #1e3a5f !important;
                    color: #fff;
                    font-weight: 700;
                    font-size: 12px;
                    padding: 10px;
                    border: none;
                }
                .footer-row .col-valor { color: #7ee787; font-size: 13px; }
                .summary {
                    display: flex;
                    gap: 16px;
                    margin-top: 14px;
                    font-size: 11px;
                    color: #64748b;
                }
                @media print {
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .no-print { display: none !important; }
                }
            </style>
        </head>
        <body>

            <div class="header">
                <div>
                    <h1>🔪 IMBEL — Relatório de Vendas</h1>
                    <div style="font-size:11px;opacity:0.8;margin-top:3px">
                        Fábrica de Itajubá · Sede
                    </div>
                </div>
                <div class="meta">
                    Gerado em: ${dataGeracao}<br>
                    ${rows.length} venda(s) · ${totalQtd} unidade(s)
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width:25%">Produto</th>
                        <th class="col-qtd" style="width:5%">Qtd</th>
                        <th style="width:16%">Nome / Destinatário</th>
                        <th style="width:12%">CPF / CNPJ</th>
                        <th class="col-valor" style="width:9%">Valor</th>
                        <th style="width:22%">Endereço</th>
                        <th style="width:11%">E-mail</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${_escapeHtml(r.produto)}</td>
                            <td class="col-qtd">${_escapeHtml(String(r.quantidade))}</td>
                            <td>${_escapeHtml(r.nome)}</td>
                            <td style="font-size:10px;color:#475569">${_escapeHtml(r.cpf)}</td>
                            <td class="col-valor">${fmt(r.valor)}</td>
                            <td style="font-size:10px;color:#475569">${_escapeHtml(r.endereco)}</td>
                            <td style="font-size:10px;color:#475569">${_escapeHtml(r.email)}</td>
                        </tr>`).join('')}
                </tbody>
                <tfoot>
                    <tr class="footer-row">
                        <td colspan="4">
                            Total — ${rows.length} venda(s) · ${totalQtd} unidade(s)
                        </td>
                        <td class="col-valor">${fmt(totalValor)}</td>
                        <td colspan="2"></td>
                    </tr>
                </tfoot>
            </table>

            <div class="summary">
                <span>📅 Gerado em ${dataGeracao}</span>
                <span>·</span>
                <span>📦 ${totalQtd} unidades</span>
                <span>·</span>
                <span>💰 Total: ${fmt(totalValor)}</span>
            </div>

            <div class="no-print" style="margin-top:20px;text-align:center">
                <button onclick="window.print()"
                                style="background:#1e3a5f;color:#fff;border:none;
                                             padding:10px 28px;border-radius:8px;font-size:14px;
                                             cursor:pointer;margin-right:10px">
                    🖨️ Imprimir
                </button>
                <button onclick="window.close()"
                                style="background:#f1f5f9;color:#475569;border:none;
                                             padding:10px 20px;border-radius:8px;font-size:14px;
                                             cursor:pointer">
                    Fechar
                </button>
            </div>

            <script>
                window.onload = function() {
                    // Auto-focus print dialog
                };
            <\/script>
        </body>
        </html>
    `);
    win.document.close();
}

function detectarNCM(nomeProduto) {
    if (!nomeProduto) return null;
    const nomeUpper = nomeProduto.toString().toUpperCase();
    for (const [keyword, ncm] of Object.entries(NCM_POR_CATEGORIA)) {
        if (nomeUpper.includes(keyword)) return ncm;
    }
    return null;
}

function inicializarImpostosPreDefinidos() {
    try {
        // 1. Detectar NCM por nome e preencher tabelaAliquotas com impostos federais quando ausentes
        (estoque.produtos || []).forEach(produto => {
            const nomeUpper = (produto.nome || '').toString().toUpperCase();
            let ncmDetectado = null;
            for (const [keyword, ncm] of Object.entries(NCM_POR_CATEGORIA)) {
                if (nomeUpper.includes(keyword)) { ncmDetectado = ncm; break; }
            }
            if (!ncmDetectado) return;
            produto.ncm = produto.ncm || ncmDetectado;

            if (!tabelaAliquotas[produto.nome]) tabelaAliquotas[produto.nome] = {};
            const aliq = tabelaAliquotas[produto.nome];
            const fed = IMPOSTOS_FEDERAIS_POR_NCM[ncmDetectado];
            if (fed) {
                if (!aliq.pis) aliq.pis = fed.pis;
                if (!aliq.cofins) aliq.cofins = fed.cofins;
                if (!aliq.ipi) aliq.ipi = fed.ipi;
            }
        });

        // 2. Preencher tabelaICMS com regras predefinidas por NCM/UF/PF-PJ
        const regraExiste = (ncm, estado, tipoPessoa) =>
            tabelaICMS.some(r => String(r.ncm || '').toUpperCase() === String(ncm || '').toUpperCase()
                && String(r.estado).toUpperCase() === String(estado).toUpperCase()
                && String(r.tipoPessoa).toUpperCase() === String(tipoPessoa).toUpperCase()
            );

        const ESTADOS = [
            'AC','AL','AP','AM','BA','CE','DF','ES','GO',
            'MA','MT','MS','PA','PB','PR','PE','PI',
            'RJ','RN','RS','RO','RR','SC','SP','SE','TO','MG'
        ];

        Object.entries(ICMS_PJ_POR_NCM).forEach(([ncm, estadoMap]) => {
            ESTADOS.forEach(uf => {
                if (estadoMap[uf] !== undefined && !regraExiste(ncm, uf, 'PJ')) {
                    tabelaICMS.push({
                        id: `predef_${ncm}_${uf}_PJ`,
                        ncm,
                        estado: uf,
                        tipoPessoa: 'PJ',
                        categoriaProduto: 'Todos',
                        aliquota: estadoMap[uf]
                    });
                }
            });
        });

        Object.entries(ICMS_PF_POR_NCM).forEach(([ncm, estadoMap]) => {
            ESTADOS.forEach(uf => {
                if (estadoMap[uf] !== undefined && !regraExiste(ncm, uf, 'PF')) {
                    tabelaICMS.push({
                        id: `predef_${ncm}_${uf}_PF`,
                        ncm,
                        estado: uf,
                        tipoPessoa: 'PF',
                        categoriaProduto: 'Todos',
                        aliquota: estadoMap[uf]
                    });
                }
            });
        });

        // Persistir mudanças mínimas localmente
        salvarDados();
    } catch (e) {
        console.warn('inicializarImpostosPreDefinidos falhou:', e);
    }
}

function buscarAliquotaICMS(estado, tipoPessoa, nomeProduto) {
    // tentar obter produto e seu NCM
    const produto = (estoque.produtos || []).find(p => p.nome === nomeProduto);
    const ncm = produto?.ncm || detectarNCM(nomeProduto);

    // 1) tentar tabela predefinida por NCM (PJ/PF)
    if (ncm) {
        const tabela = (tipoPessoa === 'PF') ? ICMS_PF_POR_NCM : ICMS_PJ_POR_NCM;
        if (tabela[ncm] && tabela[ncm][estado] !== undefined) {
            return tabela[ncm][estado];
        }
    }

    // 2) regras usuário (tabelaICMS) com scoring incluindo NCM
    const categoria = categoriaPorProduto[nomeProduto] || 'Outro';
    const score = (rule) => {
        let s = 0;
        if (rule.ncm && ncm && rule.ncm === ncm) s += 8;
        else if (rule.ncm && rule.ncm !== 'Todos') return -1;
        if (rule.estado === estado) s += 4;
        else if (rule.estado !== 'Todos') return -1;
        if (rule.tipoPessoa === tipoPessoa) s += 2;
        else if (rule.tipoPessoa !== 'Todos') return -1;
        if (rule.categoriaProduto === categoria) s += 1;
        else if (rule.categoriaProduto !== 'Todos') return -1;
        return s;
    };

    const match = tabelaICMS
        .map(r => ({ rule: r, score: score(r) }))
        .filter(x => x.score >= 0)
        .sort((a, b) => b.score - a.score)[0];

    if (match) return match.rule.aliquota;

    // fallback: icmsBase na tabelaAliquotas do produto
    return parseFloat(tabelaAliquotas[nomeProduto]?.icmsBase) || 0;
}

function calcularPreco(nomeProduto, estado = null, tipoPessoa = null, taxaOverride = null, roiOverride = null, comissaoOverride = null) {
    const prec = precificacao[nomeProduto] || {};
    const aliq = tabelaAliquotas[nomeProduto] || {};

    const ci = parseFloat(prec.ci) || 0;
    // Prefer explicit overrides when provided (used by comparativo)
    let taxaPct = (taxaOverride !== null && taxaOverride !== undefined && !isNaN(Number(taxaOverride)))
        ? Number(taxaOverride)
        : ((prec.taxa !== null && prec.taxa !== undefined && prec.taxa !== '') ? parseFloat(prec.taxa) : parseFloat(document.getElementById('taxaPadrao')?.value));
    if (!Number.isFinite(taxaPct)) taxaPct = 1;
    let roiPct = (roiOverride !== null && roiOverride !== undefined && !isNaN(Number(roiOverride)))
        ? Number(roiOverride)
        : ((prec.roi !== null && prec.roi !== undefined && prec.roi !== '') ? parseFloat(prec.roi) : parseFloat(document.getElementById('roiPadrao')?.value));
    if (!Number.isFinite(roiPct)) roiPct = 1;
    const comissao = (comissaoOverride !== null && comissaoOverride !== undefined && !isNaN(Number(comissaoOverride)))
        ? Number(comissaoOverride)
        : (parseFloat(prec.comissao) || parseFloat(document.getElementById('comissaoPadrao')?.value) || 5);
    const pis = parseFloat(aliq.pis)
        || parseFloat(document.getElementById('pisPadrao')?.value)
        || 0;
    const cofins = parseFloat(aliq.cofins)
        || parseFloat(document.getElementById('cofinsPadrao')?.value)
        || 0;
    const ipi = parseFloat(aliq.ipi) || 0;

    const icms = (estado && tipoPessoa)
        ? buscarAliquotaICMS(estado, tipoPessoa, nomeProduto)
        : (parseFloat(aliq.icmsBase) || 0);

    if (ci === 0) return null;

    // Step 1: valorBase = CI + (CI × Taxa%) + (CI × ROI%)  →  CI × (1 + Taxa% + ROI%)
    const valorBase = ci * (1 + (Number(taxaPct) / 100) + (Number(roiPct) / 100));

    // Step 2: impostos sobre valorBase
    const icmsR = valorBase * icms / 100;
    const pisR = valorBase * pis / 100;
    const cofinsR = valorBase * cofins / 100;
    const valorImpostos = valorBase + icmsR + pisR + cofinsR;

    // Step 3: IPI sobre valorImpostos
    const ipiR = valorImpostos * ipi / 100;
    const valorTotal = valorImpostos + ipiR;

    // Step 4: comissão sobre valorImpostos (sem IPI)
    const comissaoR = valorImpostos * comissao / 100;
    const precoFinal = (prec.precoFinalManual !== null && prec.precoFinalManual !== undefined && prec.precoFinalManual !== '')
        ? parseFloat(prec.precoFinalManual)
        : valorImpostos + ipiR + comissaoR;

    return {
        ci, taxa: taxaPct, roi: roiPct,
        valorBase,
        icms, icmsR,
        pis, pisR,
        cofins, cofinsR,
        valorImpostos,
        ipi, ipiR,
        valorTotal,
        comissao, comissaoR,
        precoFinal,
        margem: (valorTotal > 0 ? ((precoFinal - valorTotal) / valorTotal * 100) : 0),
        isManual: !!(prec.precoFinalManual !== null && prec.precoFinalManual !== undefined && prec.precoFinalManual !== '')
    };
}

function renderizarPrecificacao() {
    try {
        const tbody = document.getElementById('tabelaPrecificacaoBody');
        const resumo = document.getElementById('precificacaoResumoCI');
        if (!tbody) return;

        const produtos = estoque?.produtos || [];
        if (!produtos.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">Nenhum produto cadastrado</td></tr>';
            if (resumo) resumo.innerHTML = '';
            return;
        }

        tbody.innerHTML = produtos.map((produto) => {
            const prec = precificacao[produto.nome] || {};
            const ncm = produto.ncm || detectarNCM(produto.nome) || '—';
            const nomeId = produto.nome.replace(/[^a-zA-Z0-9]/g, '_');
            const nomeJs = _escapeJsString(produto.nome);
            const categoriaAtual = categoriaPorProduto[produto.nome] || '';
            const ci = prec.ci || '';
            const ultimaAtt = prec.ciAtualizadoEm
                ? new Date(prec.ciAtualizadoEm).toLocaleDateString('pt-BR')
                : '—';
            const temCI = parseFloat(ci) > 0;

            const obs = produto.observacoes ? String(produto.observacoes) : '';
            const obsPreview = obs ? `${_escapeHtml(obs.slice(0, 50))}${obs.length > 50 ? '...' : ''}` : '';
            return `
                <tr>
                    <td style="text-align:left; padding-left:15px; font-weight:500; position:sticky; left:0; background:#fff; z-index:1; border-right:1px solid #e2e8f0">
                            ${_escapeHtml(produto.nome)}
                            ${obs ? `<div style="font-size:0.68rem;color:#94a3b8;margin-top:2px;font-style:italic" title="${_escapeHtml(obs)}">${obsPreview}</div>` : ''}
                            <div style="font-size:0.72rem; font-family:monospace; color:#94a3b8; margin-top:2px">${_escapeHtml(ncm)}</div>
                    </td>
                    <td style="text-align:center">
                        <span style="font-size:0.75rem; font-family:monospace; color:#64748b; background:#f1f5f9; padding:2px 8px; border-radius:4px">${_escapeHtml(ncm)}</span>
                    </td>
                    <td style="text-align:center">
                        <select onchange="salvarCategoriaProduto('${nomeJs}', this.value)" style="border:1px solid #e2e8f0; border-radius:6px; padding:5px 8px; font-size:0.82rem; background:#fff; min-width:110px">
                            <option value="">Selecione...</option>
                            ${CATEGORIAS_PRODUTO.map(c => `<option value="${c}" ${categoriaAtual === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </td>
                    <td style="text-align:center">
                        <div style="display:flex; align-items:center; justify-content:center; gap:6px">
                            <span style="color:#64748b; font-size:0.9rem">R$</span>
                            <input type="number" step="0.01" min="0" id="ci_${nomeId}" value="${ci}" placeholder="0,00" onchange="(typeof salvarCI === 'function') && salvarCI('${nomeJs}', this.value)" style="width:120px; border:1px solid ${temCI ? '#22c55e' : '#e2e8f0'}; border-radius:6px; padding:6px 8px; text-align:right; font-size:0.9rem; font-weight:${temCI ? '600' : '400'}; color:${temCI ? '#16a34a' : '#1e293b'}">
                        </div>
                    </td>
                    <td style="text-align:center">
                        <input type="number" step="0.1" min="0" max="100"
                               value="${precificacao[produto.nome]?.margemMinima ?? ''}"
                               placeholder="—"
                               onchange="salvarMargemMinima('${nomeJs}', this.value)"
                               style="width:75px;border:1px solid #e2e8f0;border-radius:6px;
                                      padding:5px 8px;text-align:center;font-size:0.85rem">
                    </td>
                    <td id="ci_att_${nomeId}" style="text-align:center; font-size:0.8rem; color:#94a3b8">${ultimaAtt}</td>
                </tr>
            `;
        }).join('');

        atualizarResumoPrecificacaoCI(produtos);
    } catch (e) {
        console.error('renderizarPrecificacao error:', e);
    }
}

function atualizarResumoPrecificacaoCI(produtos = estoque.produtos || []) {
    const resumo = document.getElementById('precificacaoResumoCI');
    if (!resumo) return;

    const total = produtos.length;
    const comCI = produtos.filter(produto => (parseFloat(precificacao[produto.nome]?.ci) || 0) > 0).length;
    const semCI = total - comCI;

    resumo.innerHTML = `
        <div style="font-size:0.85rem; color:#475569">Total produtos: <strong style="color:#1e3a5f">${total}</strong></div>
        <div style="font-size:0.85rem; color:#475569">Com CI: <strong style="color:#16a34a">${comCI}</strong></div>
        <div style="font-size:0.85rem; color:#475569">Sem CI: <strong style="color:#d97706">${semCI}</strong></div>
    `;
}

// Função de salvamento de CI removida: gestão de CI passa a ser feita pelo Cadastro de Produtos (modal `salvarProduto`).

function salvarMargemMinima(nomeProduto, valor) {
    if (!precificacao[nomeProduto]) precificacao[nomeProduto] = {};
    precificacao[nomeProduto].margemMinima = parseFloat(valor) || null;
    estoque.precificacao = precificacao;
    try { localStorage.setItem('estoqueArmasV2', JSON.stringify(estoque)); } catch (e) {}
}

function salvarDescontoMaximo(nomeProduto, valor) {
    if (!precificacao[nomeProduto]) precificacao[nomeProduto] = {};
    if (valor === '' || valor === null) {
        delete precificacao[nomeProduto].descontoMaximo;
    } else {
        precificacao[nomeProduto].descontoMaximo = parseFloat(valor) || null;
    }
    estoque.precificacao = precificacao;
    try { salvarDados(); } catch (e) { try { localStorage.setItem('estoqueArmasV2', JSON.stringify(estoque)); } catch (e) {} }
    try { renderizarTabelaCI(); } catch (e) {}
    try { mostrarNotificacao('Desconto máximo salvo.', 'success'); } catch (e) {}
}

function atualizarLinhaPrecificacao(nomeProduto) {
    const nomeId = _nomeProdutoId(nomeProduto);
    const ciEl = document.getElementById(`ci_${nomeId}`);
    const taxaEl = document.getElementById(`taxa_${nomeId}`);
    const roiEl = document.getElementById(`roi_${nomeId}`);
    const pisEl = document.getElementById(`pis_${nomeId}`);
    const cofinsEl = document.getElementById(`cofins_${nomeId}`);
    const icmsEl = document.getElementById(`icms_${nomeId}`);
    const ipiEl = document.getElementById(`ipi_${nomeId}`);
    const comissaoEl = document.getElementById(`comissao_${nomeId}`);

    if (!precificacao[nomeProduto]) precificacao[nomeProduto] = { ci: 0, taxa: null, roi: null, comissao: null, precoFinalManual: null };
    if (!tabelaAliquotas[nomeProduto]) tabelaAliquotas[nomeProduto] = { pis: null, cofins: null, ipi: null, icmsBase: null };

    const ciRaw = ciEl?.value ?? '';
    const taxaRaw = taxaEl?.value ?? '';
    const roiRaw = roiEl?.value ?? '';
    const pisRaw = pisEl?.value ?? '';
    const cofinsRaw = cofinsEl?.value ?? '';
    const icmsRaw = icmsEl?.value ?? '';
    const ipiRaw = ipiEl?.value ?? '';
    const comissaoRaw = comissaoEl?.value ?? '';

    const taxaDefault = parseFloat(document.getElementById('taxaPadrao')?.value) || 1;
    const roiDefault = parseFloat(document.getElementById('roiPadrao')?.value) || 1;
    const pisDefault = parseFloat(document.getElementById('pisPadrao')?.value) || 0;
    const cofinsDefault = parseFloat(document.getElementById('cofinsPadrao')?.value) || 0;
    const comissaoDefault = parseFloat(document.getElementById('comissaoPadrao')?.value) || 5;

    precificacao[nomeProduto].ci = parseFloat(ciRaw) || 0;
    precificacao[nomeProduto].taxa = taxaRaw === '' ? null : (parseFloat(taxaRaw) || taxaDefault);
    precificacao[nomeProduto].roi = roiRaw === '' ? null : (parseFloat(roiRaw) || roiDefault);
    precificacao[nomeProduto].comissao = comissaoRaw === '' ? null : (parseFloat(comissaoRaw) || comissaoDefault);

    tabelaAliquotas[nomeProduto].pis = pisRaw === '' ? null : (parseFloat(pisRaw) || pisDefault);
    tabelaAliquotas[nomeProduto].cofins = cofinsRaw === '' ? null : (parseFloat(cofinsRaw) || cofinsDefault);
    tabelaAliquotas[nomeProduto].icmsBase = icmsRaw === '' ? null : (parseFloat(icmsRaw) || 0);
    tabelaAliquotas[nomeProduto].ipi = ipiRaw === '' ? null : (parseFloat(ipiRaw) || 0);

    const r = calcularPreco(nomeProduto);

    const vbaseEl = document.getElementById(`vbase_${nomeId}`);
    const vimpEl = document.getElementById(`vimp_${nomeId}`);
    const vcomEl = document.getElementById(`vcom_${nomeId}`);
    const vpfEl = document.getElementById(`vpf_${nomeId}`);

    if (!r) {
        if (vbaseEl) vbaseEl.textContent = '-';
        if (vimpEl) vimpEl.textContent = '-';
        if (vcomEl) vcomEl.textContent = '-';
        if (vpfEl && !(precificacao[nomeProduto].precoFinalManual !== null && precificacao[nomeProduto].precoFinalManual !== undefined && precificacao[nomeProduto].precoFinalManual !== '')) {
            vpfEl.value = '';
        }
        if (vpfEl) vpfEl.style.border = '2px solid #22c55e';
        salvarDados();
        return;
    }

    if (vbaseEl) vbaseEl.textContent = _fmtMoeda(r.valorBase);
    if (vimpEl) vimpEl.textContent = _fmtMoeda(r.valorImpostos);
    if (vcomEl) vcomEl.textContent = _fmtMoeda(r.comissaoR);

    const isManual = !!(precificacao[nomeProduto].precoFinalManual !== null && precificacao[nomeProduto].precoFinalManual !== undefined && precificacao[nomeProduto].precoFinalManual !== '');
    if (vpfEl && !isManual) {
        vpfEl.value = Number(r.precoFinal).toFixed(2);
    }
    if (vpfEl) {
        vpfEl.style.border = isManual ? '2px solid #f59e0b' : '2px solid #22c55e';
    }

    salvarDados();
}

function salvarCategoriaProduto(nomeProduto, categoria) {
    categoriaPorProduto[nomeProduto] = categoria;
    salvarDados();
}

function salvarNCMProduto(produtoId, ncmValor) {
    if (!requireAdminOrNotify()) return;
    try {
        const produto = (estoque.produtos || []).find(p => Number(p.id) === Number(produtoId));
        if (!produto) { mostrarNotificacao('Produto não encontrado.', 'error'); return; }
        const ncm = (ncmValor || '').toString().trim() || null;
        produto.ncm = ncm;

        // aplicar impostos federais padrão se disponíveis e não sobrescrever valores existentes
        if (!tabelaAliquotas[produto.nome]) tabelaAliquotas[produto.nome] = {};
        const aliq = tabelaAliquotas[produto.nome];
        const fed = IMPOSTOS_FEDERAIS_POR_NCM[ncm];
        if (fed) {
            if (aliq.pis === undefined || aliq.pis === null) aliq.pis = fed.pis;
            if (aliq.cofins === undefined || aliq.cofins === null) aliq.cofins = fed.cofins;
            if (aliq.ipi === undefined || aliq.ipi === null) aliq.ipi = fed.ipi;
        }

        salvarDados();
        renderizarCadastroProdutos();
        mostrarNotificacao(`NCM atualizado para ${produto.nome}: ${produto.ncm || '—'}`, 'success');
    } catch (e) {
        console.error('salvarNCMProduto error', e);
        mostrarNotificacao('Falha ao salvar NCM.', 'error');
    }
}

function detectarNCMVincular(produtoId) {
    const produto = (estoque.produtos || []).find(p => Number(p.id) === Number(produtoId));
    if (!produto) { mostrarNotificacao('Produto não encontrado.', 'error'); return; }
    const detectado = detectarNCM(produto.nome);
    if (!detectado) {
        mostrarNotificacao('Não foi possível detectar um NCM automaticamente para este produto.', 'warning');
        return;
    }
    salvarNCMProduto(produtoId, detectado);
}

function gerarOptionsNCM(selectedNcm) {
    try {
        const entries = Object.entries(NCM_PRODUTOS || {});
        if (!entries || entries.length === 0) return '<option value="">—</option>';
        entries.sort((a, b) => a[0].localeCompare(b[0]));
        let html = '<option value="">— Selecionar —</option>';
        entries.forEach(([code, desc]) => {
            const sel = String(code) === String(selectedNcm) ? ' selected' : '';
            html += `<option value="${code}"${sel}>${_escapeHtml(code)} — ${_escapeHtml(desc || '')}</option>`;
        });
        return html;
    } catch (e) {
        console.error('gerarOptionsNCM error', e);
        return '<option value="">—</option>';
    }
}

function salvarPrecoFinalManual(nomeProduto, valor) {
    if (!precificacao[nomeProduto]) {
        precificacao[nomeProduto] = { ci: 0, taxa: null, roi: null, comissao: null, precoFinalManual: null };
    }

    const manual = parseFloat(valor);
    if (!Number.isFinite(manual)) {
        precificacao[nomeProduto].precoFinalManual = null;
        atualizarLinhaPrecificacao(nomeProduto);
        return;
    }

    const backup = precificacao[nomeProduto].precoFinalManual;
    precificacao[nomeProduto].precoFinalManual = null;
    const calculado = calcularPreco(nomeProduto);
    const precoAuto = calculado ? Number(calculado.precoFinal) : 0;
    const vpf = document.getElementById(`vpf_${_nomeProdutoId(nomeProduto)}`);

    if (Math.abs(manual - precoAuto) > 0.01) {
        precificacao[nomeProduto].precoFinalManual = manual;
        if (vpf) vpf.style.border = '2px solid #f59e0b';
    } else {
        precificacao[nomeProduto].precoFinalManual = null;
        if (vpf) vpf.style.border = '2px solid #22c55e';
    }

    if (backup !== precificacao[nomeProduto].precoFinalManual) {
        salvarDados();
    }
}

function resetarPrecoManual(nomeProduto) {
    if (!precificacao[nomeProduto]) {
        precificacao[nomeProduto] = { ci: 0, taxa: null, roi: null, comissao: null, precoFinalManual: null };
    }
    precificacao[nomeProduto].precoFinalManual = null;
    atualizarLinhaPrecificacao(nomeProduto);
    const vpf = document.getElementById(`vpf_${_nomeProdutoId(nomeProduto)}`);
    if (vpf) vpf.style.border = '2px solid #22c55e';
    salvarDados();
}

// ── SUB-TAB NAVIGATION FOR PRECIFICAÇÃO ─────────────────────────
function trocarSubabaPrecif(subaba) {
    const tabs = ['porcliente','consultaPrec','comparativo','rastreabilidade','tabelaci','icms','federais'];
    tabs.forEach(s => {
        let el = null;
        if (s === 'consultaPrec') el = document.getElementById('painel-consultaPrec');
        else el = document.getElementById('subaba-precif-' + s);
        if (el) el.style.display = (s === subaba) ? 'block' : 'none';

        const btnId = (s === 'consultaPrec') ? 'btnConsultaPrecificacao' : ('sbtn-' + s);
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.style.color = (s === subaba) ? '#1e3a5f' : '#64748b';
            btn.style.borderBottomColor = (s === subaba) ? '#1e3a5f' : 'transparent';
        }
    });

    if (subaba === 'federais') renderizarImpostosFederais();
    if (subaba === 'icms') renderizarICMSPorEstado();
    if (subaba === 'porcliente') {
        // preparar dropdown e estado inicial da sub-aba
        try {
            try { verificarExpiracaoPrecificacoes(); } catch (e) {}
            popularSelectClientesPrecif();
            try { popularSelectProdutosPrecif(); } catch (e) {}
        } catch (e) {}
        const res = document.getElementById('precifClienteResultado');
        const empty = document.getElementById('precifClienteEmpty');
        const banner = document.getElementById('precifClienteBanner');
        if (res) res.style.display = 'none';
        if (empty) empty.style.display = 'block';
        if (banner) banner.style.display = 'none';
    }

    if (subaba === 'consultaPrec') {
        try { if (typeof _cpPopularFiltroCliente === 'function') _cpPopularFiltroCliente(); filtrarConsultaPrecificacoes(); } catch (e) {}
    }

    if (subaba === 'tabelaci') {
        try { popularSelectProdutosCI(); renderizarTabelaCI(); } catch (e) {}
    }
    if (subaba === 'rastreabilidade') {
        try { renderizarRastreabilidade(); } catch (e) { if (window.__showRuntimeErrorOverlay) window.__showRuntimeErrorOverlay(e); }
    }
    if (subaba === 'comparativo') {
        try { popularSelectsComparativo(); } catch (e) {}
        const res = document.getElementById('compResultado');
        const empty = document.getElementById('compEmpty');
        if (res) res.style.display = 'none';
        if (empty) empty.style.display = 'block';
    }
}

// ========================================
// TABELA DE CI COM HISTÓRICO
// ========================================

function popularSelectProdutosCI() {
    const sel = document.getElementById('ciProdutoSelect');
    if (!sel) return;
    const cur = sel.value;
    const produtos = [...(estoque.produtos || [])].sort((a, b) => (a.nome||'').localeCompare(b.nome||'', 'pt-BR'));
    sel.innerHTML = '<option value="">Selecione um produto...</option>';
    produtos.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.nome;
        opt.textContent = p.nome;
        sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
}

function salvarNovoCI() {
    if (!requireAdminOrNotify()) return;
    const nomeProduto = (document.getElementById('ciProdutoSelect')?.value || '').trim();
    const valor = parseCurrencyBRLToNumber(document.getElementById('ciValorInput')?.value);
    const obs = (document.getElementById('ciObsInput')?.value || '').trim();

    if (!nomeProduto) { mostrarNotificacao('Selecione um produto.', 'error'); return; }
    if (!valor || valor <= 0) { mostrarNotificacao('Informe um CI válido (maior que zero).', 'error'); return; }

    if (!Array.isArray(estoque.tabelaCI)) estoque.tabelaCI = [];

    const registro = {
        id: Date.now(),
        produtoNome: nomeProduto,
        ci: valor,
        data: new Date().toISOString(),
        observacao: obs
    };
    estoque.tabelaCI.push(registro);

    // Atualiza precificacao para manter compatibilidade
    if (!precificacao[nomeProduto]) precificacao[nomeProduto] = {};
    precificacao[nomeProduto].ci = valor;
    precificacao[nomeProduto].ciAtualizadoEm = registro.data;

    salvarDados();
    renderizarTabelaCI();

    // Limpar formulário
    const valInput = document.getElementById('ciValorInput');
    const obsInput = document.getElementById('ciObsInput');
    if (valInput) valInput.value = '';
    if (obsInput) obsInput.value = '';

    mostrarNotificacao(`CI de ${nomeProduto} registrado: ${_fmtMoeda(valor)}`, 'success');
}

function renderizarTabelaCI() {
    const tbody = document.getElementById('tabelaCITbody');
    if (!tbody) return;

    const filtro = (document.getElementById('ciFiltroProduto')?.value || '').toLowerCase().trim();
    const tabelaCI = Array.isArray(estoque.tabelaCI) ? estoque.tabelaCI : [];

    const produtos = [...(estoque.produtos || [])].sort((a, b) => (a.nome||'').localeCompare(b.nome||'', 'pt-BR'));
    const produtosFiltrados = filtro ? produtos.filter(p => (p.nome||'').toLowerCase().includes(filtro)) : produtos;

    const contador = document.getElementById('ciContador');
    if (contador) contador.textContent = `${produtosFiltrados.length} produto(s)`;

    if (!produtosFiltrados.length) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">Nenhum produto encontrado</td></tr>';
        return;
    }

    tbody.innerHTML = produtosFiltrados.map(produto => {
        const registros = tabelaCI
            .filter(r => r.produtoNome === produto.nome)
            .sort((a, b) => new Date(b.data) - new Date(a.data));

        const ciVigente = registros.length > 0 ? registros[0].ci : (parseFloat(precificacao[produto.nome]?.ci) || 0);
        const ultimaData = registros.length > 0 ? new Date(registros[0].data).toLocaleDateString('pt-BR') : '-';
        const qtdRegistros = registros.length;

        const ciText = ciVigente > 0
            ? `<span style="font-weight:700;color:#1e3a5f">${_fmtMoeda(ciVigente)}</span>`
            : `<span style="color:#94a3b8;font-style:italic">Não definido</span>`;

        const histBtn = qtdRegistros > 0
            ? `<button class="btn btn-outline btn-sm" onclick="exibirHistoricoCI('${_escapeHtml(produto.nome)}')">Ver ${qtdRegistros} registro(s)</button>`
            : `<span style="color:#94a3b8;font-size:0.82rem">—</span>`;

        return `<tr>
            <td style="text-align:left;font-weight:600;padding-left:15px">${_escapeHtml(produto.nome)}</td>
            <td style="text-align:center">${ciText}</td>
            <td style="text-align:center">
                <input type="number" step="0.1" min="0" max="100"
                       value="${precificacao[produto.nome]?.descontoMaximo ?? ''}"
                       placeholder="—"
                       onchange="salvarDescontoMaximo('${_escapeJsString(produto.nome)}', this.value)"
                       style="width:80px; border:1px solid #e2e8f0; border-radius:6px; padding:5px 8px; text-align:center; font-size:0.85rem">
                <span style="font-size:0.75rem; color:#94a3b8">%</span>
            </td>
            <td style="text-align:center;color:#64748b;font-size:0.88rem">${ultimaData}</td>
            <td style="text-align:center;color:#64748b">${qtdRegistros}</td>
            <td style="text-align:center">${histBtn}</td>
        </tr>`;
    }).join('');
}

function exibirHistoricoCI(nomeProduto) {
    const painel = document.getElementById('painelHistoricoCI');
    const titulo = document.getElementById('painelHistoricoCITitulo');
    const conteudo = document.getElementById('painelHistoricoCIConteudo');
    if (!painel || !titulo || !conteudo) return;

    const tabelaCI = Array.isArray(estoque.tabelaCI) ? estoque.tabelaCI : [];
    const registros = tabelaCI
        .filter(r => r.produtoNome === nomeProduto)
        .sort((a, b) => new Date(b.data) - new Date(a.data));

    titulo.textContent = `Histórico de CI — ${nomeProduto}`;

    if (!registros.length) {
        conteudo.innerHTML = '<p style="color:#94a3b8">Nenhum registro encontrado.</p>';
    } else {
        conteudo.innerHTML = `
            <table class="dashboard-table" style="width:100%">
                <thead>
                    <tr>
                            <th style="text-align:center">Data</th>
                            <th style="text-align:center">CI</th>
                            <th style="text-align:left">Observação</th>
                    </tr>
                </thead>
                <tbody>
                    ${registros.map((r, i) => `
                        <tr style="${i === 0 ? 'background:#f0fdf4' : ''}">
                            <td style="text-align:center;color:#64748b">${new Date(r.data).toLocaleDateString('pt-BR')} ${i === 0 ? '<span style="font-size:0.7rem;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:10px;margin-left:4px">vigente</span>' : ''}</td>
                            <td style="text-align:center;font-weight:700;color:#1e3a5f">${_fmtMoeda(r.ci)}</td>
                            <td style="text-align:left;color:#475569;font-size:0.88rem">${_escapeHtml(r.observacao || '—')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    painel.style.display = 'block';
    painel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderizarConsultaPrecificacao(forceSemFiltros = false) {
    // Consulta removida: função substituída por um stub que mostra mensagem mínima se elemento existir.
    try {
        const tbody = document.getElementById('tabelaConsultaPrecifBody') || document.getElementById('tabelaConsultaPrecificacao')?.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:#64748b">Consulta removida</td></tr>';
        }
    } catch (e) { /* noop */ }
    return;
}

function exportarConsultaPrecificacao() {
    // Exportação da Consulta removida. Função substituída por stub.
    mostrarNotificacao && mostrarNotificacao('Exportação de Consulta desabilitada.', 'info');
    return;
}

function popularSelectsComparativo() {
    [1,2,3].forEach(n => {
        const sel = document.getElementById('compCliente' + n);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">— não selecionado —</option>'
            + (clientes||[]).slice().sort((a,b) => (a.nome||'').localeCompare(b.nome||''))
                .map(c => `<option value="${c.id}" ${String(c.id)===String(cur)?'selected':''}>${_escapeHtml(c.nome||'-')} (${_escapeHtml(c.uf||'??')} / ${(((c.cnpj||'').replace(/\D/g,''))).length===14?'PJ':'PF'})</option>`)
                .join('');
    });
    const taxaPadRaw = parseFloat(localStorage.getItem('precif_taxa_global'));
    const roiPadRaw  = parseFloat(localStorage.getItem('precif_roi_global'));
    const taxaPad = isNaN(taxaPadRaw) ? 20 : taxaPadRaw;
    const roiPad  = isNaN(roiPadRaw)  ? 30 : roiPadRaw;
    for (let n=1;n<=3;n++) {
        const t = document.getElementById('compTaxa' + n);
        const r = document.getElementById('compROI' + n);
        if (t && (t.value === null || t.value === '')) t.value = taxaPad;
        if (r && (r.value === null || r.value === '')) r.value = roiPad;
    }
}

function _obterCenarioComparativo(n) {
    const sel = document.getElementById('compCliente' + n);
    if (!sel || !sel.value) return null;
    const taxa = parseFloat(document.getElementById('compTaxa' + n)?.value) || parseFloat(document.getElementById('taxaPadrao')?.value) || 20;
    const roi  = parseFloat(document.getElementById('compROI' + n)?.value) || parseFloat(document.getElementById('roiPadrao')?.value) || 30;
    const c = (clientes || []).find(x => String(x.id) === String(sel.value));
    const uf = (c?.uf || '').toUpperCase();
    const cnpjLimpo = (c?.cnpj||'').replace(/\D/g,'');
    const tipo = cnpjLimpo.length === 14 ? 'PJ' : 'PF';
    return { id: sel.value, nome: c?.nome, uf, tipo, taxa, roi, comissao: parseFloat(document.getElementById('comissaoPadrao')?.value) || 5 };
}

function _calcularPrecoComparativo(nomeProduto, estado, tipoPessoa, taxa, roi, comissao) {
    try {
        return calcularPreco(nomeProduto, estado, tipoPessoa, taxa, roi, comissao);
    } catch (e) { return null; }
}

function calcularComparativo() {
    try {
        const clientesSelecionados = [1,2,3]
            .map(n => {
                const id  = document.getElementById('compCliente'+n)?.value;
                const taxa = parseFloat(document.getElementById('compTaxa'+n)?.value) || parseFloat(document.getElementById('taxaPadrao')?.value) || 20;
                const roi  = parseFloat(document.getElementById('compROI'+n)?.value) || parseFloat(document.getElementById('roiPadrao')?.value) || 30;
                const com  = parseFloat(document.getElementById('comissaoPadrao')?.value) || 5;
                return id ? { id, taxa, roi, comissao: com } : null;
            })
            .filter(Boolean);

        if (clientesSelecionados.length < 2) {
            const resEl = document.getElementById('compResultado'); if (resEl) resEl.style.display = 'none';
            const emptyEl = document.getElementById('compEmpty'); if (emptyEl) emptyEl.style.display = 'block';
            return;
        }

        const clientesData = clientesSelecionados.map(sel => {
            const c  = (clientes || []).find(x => String(x.id) === String(sel.id));
            const uf = (c?.uf || '').toUpperCase();
            const cnpjLimpo = (c?.cnpj||'').replace(/\D/g,'');
            const tipo = cnpjLimpo.length === 14 ? 'PJ' : 'PF';
            return { ...sel, nome: c?.nome, uf, tipo };
        });

        // Build header
        const nCols = clientesData.length;
        const headerEl = document.getElementById('compHeader');
        if (!headerEl) return;
        headerEl.innerHTML = `
            <tr>
              <th style="text-align:left; padding-left:15px; min-width:220px; position:sticky; left:0; background:#1e3a5f; z-index:2">Produto</th>
              ${clientesData.map((c,i) => `
                <th colspan="2" style="text-align:center; background:${['#1e3a5f','#2d5a8b','#3d7ab5'][i]}; min-width:200px">
                  ${_escapeHtml(c.nome||'')}<br>
                  <span style="font-size:0.7rem; font-weight:400; color:rgba(255,255,255,0.75)">${_escapeHtml(c.uf||'')} / ${_escapeHtml(c.tipo||'')} | Taxa ${c.taxa}% | ROI ${c.roi}%</span>
                </th>
              `).join('')}
              <th style="min-width:100px; text-align:center">Maior preço</th>
              <th style="min-width:100px; text-align:center">Menor preço</th>
              <th style="min-width:90px; text-align:center">Diferença</th>
            </tr>
            <tr>
              <th style="position:sticky; left:0; background:#161b22"></th>
              ${clientesData.map(() => `
                <th style="font-size:0.7rem; font-weight:400; background:#161b22; color:#8b949e">Preço Final</th>
                <th style="font-size:0.7rem; font-weight:400; background:#161b22; color:#8b949e">Margem</th>
              `).join('')}
              <th style="background:#161b22"></th>
              <th style="background:#161b22"></th>
              <th style="background:#161b22"></th>
            </tr>
        `;

        // Build rows
        const fmt = v => 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
        const fmtPct = v => (Number(v) || 0).toFixed(1) + '%';
        const corMargem = m => m >= 30 ? '#16a34a' : m>=15 ? '#d97706' : '#dc2626';

        const produtosLista = (estoque.produtos || []).slice();
        const bodyEl = document.getElementById('compBody');
        if (!bodyEl) return;

        bodyEl.innerHTML = produtosLista.map(produto => {
            const precos = clientesData.map(c => _calcularPrecoComparativo(produto.nome, c.uf, c.tipo, c.taxa, c.roi, c.comissao));

            if (precos.every(r => !r)) {
                return `
                    <tr style="opacity:0.4">
                      <td style="text-align:left; padding-left:15px; position:sticky; left:0; background:#fff; z-index:1">${_escapeHtml(produto.nome||'')}</td>
                      <td colspan="${nCols*2+3}" style="text-align:center; color:#94a3b8; font-size:0.8rem">CI não configurado</td>
                    </tr>
                `;
            }

            const precosFinal = precos.map(r => r?.precoFinal || 0);
            const maxPreco = Math.max(...precosFinal.filter(v => v > 0));
            const minPreco = Math.min(...precosFinal.filter(v => v > 0));
            const diff     = maxPreco - minPreco;
            const diffPct  = minPreco > 0 ? (diff / minPreco * 100) : 0;

            return `
              <tr>
                <td style="text-align:left; padding-left:15px; font-weight:500; position:sticky; left:0; background:#fff; z-index:1; border-right:1px solid #e2e8f0">${_escapeHtml(produto.nome||'')}</td>
                ${precos.map((r,i) => {
                    if (!r) return '<td colspan="2" style="text-align:center;color:#94a3b8">—</td>';
                    const isMax = r.precoFinal === maxPreco && nCols > 1;
                    const isMin = r.precoFinal === minPreco && nCols > 1 && maxPreco !== minPreco;
                    return `
                      <td style="text-align:right; padding-right:8px; font-weight:700; color:${isMin?'#16a34a':isMax?'#dc2626':'#1e3a5f'}; background:${isMin?'#f0fdf4':isMax?'#fef2f2':'transparent'}">${fmt(r.precoFinal)} ${isMin?'<span style="font-size:0.65rem">▼min</span>':''} ${isMax?'<span style="font-size:0.65rem">▲max</span>':''}</td>
                      <td style="text-align:center; font-size:0.82rem; font-weight:600; color:${corMargem(r.margem)}">${fmtPct(r.margem)}</td>
                    `;
                }).join('')}
                <td style="text-align:center; font-weight:700; color:#dc2626">${maxPreco > 0 ? fmt(maxPreco) : '—'}</td>
                <td style="text-align:center; font-weight:700; color:#16a34a">${minPreco > 0 ? fmt(minPreco) : '—'}</td>
                <td style="text-align:center; font-weight:600; color:#d97706">${diff > 0 ? fmt(diff) + '<br><span style="font-size:0.72rem">(' + fmtPct(diffPct) + ')</span>' : '—'}</td>
              </tr>
            `;
        }).join('');

        document.getElementById('compResultado').style.display = 'block';
        document.getElementById('compEmpty').style.display = 'none';

    } catch (e) { console.warn('calcularComparativo', e); }
}

function exportarComparativo() {
    try {
        const clientesSelecionados = [1,2,3].map(n => {
            const id = document.getElementById('compCliente'+n)?.value;
            const taxa = parseFloat(document.getElementById('compTaxa'+n)?.value) || parseFloat(document.getElementById('taxaPadrao')?.value) || 20;
            const roi  = parseFloat(document.getElementById('compROI'+n)?.value) || parseFloat(document.getElementById('roiPadrao')?.value) || 30;
            const com  = parseFloat(document.getElementById('comissaoPadrao')?.value) || 5;
            return id ? { id, taxa, roi, com } : null;
        }).filter(Boolean);

        if (clientesSelecionados.length < 2) { mostrarNotificacao && mostrarNotificacao('Selecione ao menos 2 clientes para exportar.', 'warning'); return; }

        const clientesData = clientesSelecionados.map(sel => {
            const c = (clientes || []).find(x => String(x.id) === String(sel.id));
            const uf = (c?.uf || '').toUpperCase();
            const cnpjLimpo = (c?.cnpj||'').replace(/\D/g,'');
            const tipo = cnpjLimpo.length === 14 ? 'PJ' : 'PF';
            return { ...sel, nome: c?.nome, uf, tipo };
        });

        const produtosLista = (estoque.produtos || []).slice();
        const rows = [];
        // Header row
        const header = ['Produto'];
        clientesData.forEach(c => { header.push(`${c.nome} - Preço Final`, `${c.nome} - Margem %`); });
        header.push('Maior preço','Menor preço','Diferença');
        rows.push(header);

        produtosLista.forEach(produto => {
            const precos = clientesData.map(c => _calcularPrecoComparativo(produto.nome, c.uf, c.tipo, c.taxa, c.roi, c.com));
            const precosFinal = precos.map(r => r ? r.precoFinal : null);
            const maxPreco = Math.max(...precosFinal.filter(v => v > 0));
            const minPreco = Math.min(...precosFinal.filter(v => v > 0));
            const diff = (maxPreco > 0 && minPreco > 0) ? (maxPreco - minPreco) : 0;
            const row = [produto.nome];
            precos.forEach(r => {
                if (!r) { row.push('—','—'); }
                else { row.push(r.precoFinal || 0, (r.margem || 0).toFixed(1) + '%'); }
            });
            row.push(maxPreco > 0 ? maxPreco : '', minPreco > 0 ? minPreco : '', diff > 0 ? diff : '');
            rows.push(row);
        });

        if (window.XLSX) {
            const ws = XLSX.utils.aoa_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Comparativo');
            const nomeArquivo = `comparativo_precos_${new Date().toISOString().slice(0,10)}.xlsx`;
            XLSX.writeFile(wb, nomeArquivo);
        } else {
            // Fallback CSV
            const csv = rows.map(r => r.map(c => typeof c === 'string' && c.includes(',') ? '"' + c.replace(/"/g,'""') + '"' : c).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `comparativo_precos_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(link); link.click(); link.remove();
        }
    } catch (e) { console.error('exportarComparativo erro:', e); mostrarNotificacao && mostrarNotificacao('Erro ao exportar comparativo.', 'error'); }
}

function renderizarRastreabilidade() {
    // Tentar recuperar do localStorage se estiver vazio
    let _dadosPrecif = (Array.isArray(precificacoesCliente) && precificacoesCliente.length > 0)
        ? precificacoesCliente
        : null;

    if (!_dadosPrecif) {
        try {
            const raw = localStorage.getItem('precificacoesCliente')
                     || localStorage.getItem('estoque_precificacoesCliente');
            if (raw) {
                const parsed = JSON.parse(raw);
                _dadosPrecif = Array.isArray(parsed) ? parsed
                    : (parsed && Array.isArray(parsed.precificacoesCliente))
                        ? parsed.precificacoesCliente : null;
                if (_dadosPrecif && _dadosPrecif.length > 0) {
                    precificacoesCliente = _dadosPrecif;
                }
            }
        } catch(e) {}
    }

    if (!_dadosPrecif || _dadosPrecif.length === 0) {
        const container = document.getElementById('painelRastreabilidade') || document.querySelector('[id*="rastreab"]');
        if (container) container.innerHTML = '<div style="padding:20px;color:#64748b;text-align:center">Nenhuma precificação salva. Calcule e salve uma precificação na aba Por Cliente.</div>';
        return;
    }
        const selCliente = document.getElementById('rastreaCliente');
        if (selCliente) {
                const currentVal = selCliente.value;
                selCliente.innerHTML = '<option value="">Todos os clientes</option>'
                        + (clientes || []).slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
                                .map(c => `<option value="${c.id}" ${String(c.id) === String(currentVal) ? 'selected' : ''}>${_escapeHtml(c.nome || '')}</option>`).join('');
        }

        const filtroId = selCliente?.value || '';
        const periodo = document.getElementById('rastreaPeriodo')?.value || 'todos';
        const agora = new Date();

        const inPeriod = iso => {
                if (!iso || periodo === 'todos') return true;
                const d = new Date(iso);
                if (periodo === 'mes') return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
                if (periodo === 'trimestre') return Math.floor(d.getMonth() / 3) === Math.floor(agora.getMonth() / 3) && d.getFullYear() === agora.getFullYear();
                if (periodo === 'ano') return d.getFullYear() === agora.getFullYear();
                return true;
        };

        const clientesFilt = (clientes || []).filter(c => !filtroId || String(c.id) === String(filtroId));
        const fmt = v => 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

        const statusColor = {
                rascunho: '#64748b', enviada: '#1d4ed8', aceita: '#166534',
                recusada: '#dc2626', expirada: '#d97706', convertida: '#0ea5e9',
                aguardando_aprovacao: '#7c3aed'
        };

        const container = document.getElementById('painelRastreabilidade');
        if (!container) return;

        const html = clientesFilt.map(cliente => {
                const precifs = (_dadosPrecif || [])
                        .filter(p => String(p.clienteId) === String(cliente.id) && inPeriod(p.dataCriacao))
                        .sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));
                const propostasC = (propostas || [])
                        .filter(p => p.cliente === cliente.nome && inPeriod(p.dataCriacao || p.data))
                        .sort((a, b) => new Date(b.dataCriacao || b.data || 0) - new Date(a.dataCriacao || a.data || 0));
                const vendasC = (estoque.registroVendas || [])
                        .filter(v => v.loja === cliente.nome && inPeriod(v.data))
                        .sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0));

                const totalFat = vendasC.reduce((s, v) => s + (v.valorTotal || 0), 0);
                const eventos = [
                        ...precifs.map(p => ({ ...p, _tipo: 'precif', _date: p.dataCriacao })),
                        ...propostasC.map(p => ({ ...p, _tipo: 'proposta', _date: p.dataCriacao || p.data })),
                        ...vendasC.map(v => ({ ...v, _tipo: 'contrato', _date: v.data }))
                ].sort((a, b) => new Date(b._date || 0) - new Date(a._date || 0));

                return `
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;
                                    margin-bottom:20px;overflow:hidden">
                <div style="background:linear-gradient(135deg,#1e3a5f,#2d5a8b);
                                        padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-size:1rem;font-weight:700;color:#fff">${_escapeHtml(cliente.nome || '')}</div>
                        <div style="font-size:0.8rem;color:rgba(255,255,255,0.7);margin-top:2px">
                            ${_escapeHtml(cliente.uf || '—')} · ${((cliente.cnpj || '').replace(/\D/g, '').length === 14 ? 'PJ' : 'PF')}
                        </div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:0.75rem;color:rgba(255,255,255,0.6)">Total faturado</div>
                        <div style="font-size:1.2rem;font-weight:800;color:#7ee787">${fmt(totalFat)}</div>
                    </div>
                </div>
                <div style="display:flex;border-bottom:1px solid #f1f5f9;background:#f8fafc">
                    ${[
                            { icon: '💰', label: 'Precificações', val: precifs.length, cor: '#c9a227' },
                            { icon: '📋', label: 'Propostas', val: propostasC.length, cor: '#1d4ed8' },
                            { icon: '✅', label: 'Aceitas', val: propostasC.filter(p => p.status === 'aceita').length, cor: '#16a34a' },
                            { icon: '📄', label: 'Contratos', val: vendasC.length, cor: '#0ea5e9' },
                    ].map(s => `<div style="flex:1;padding:10px;text-align:center;border-right:1px solid #f1f5f9">
                        <div>${s.icon}</div>
                        <div style="font-size:1.2rem;font-weight:700;color:${s.cor}">${s.val}</div>
                        <div style="font-size:0.72rem;color:#64748b">${s.label}</div>
                    </div>`).join('')}
                </div>
                <div style="padding:16px 20px">
                    <div style="position:relative;padding-left:24px">
                        <div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:#e2e8f0"></div>
                        ${eventos.map(item => {
                                const d = new Date(item._date || new Date()).toLocaleDateString('pt-BR');
                                if (item._tipo === 'precif') return `
                                <div style="position:relative;margin-bottom:14px">
                                    <div style="position:absolute;left:-19px;top:4px;width:12px;height:12px;
                                                            border-radius:50%;background:#c9a227;border:2px solid #fff;
                                                            box-shadow:0 0 0 2px #c9a227"></div>
                                    <div style="background:#fffbf0;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px">
                                        <div style="display:flex;justify-content:space-between">
                                            <span style="font-weight:600;color:#92400e;font-size:0.85rem">
                                                💰 Precificação v${item.versao || '—'}
                                            </span>
                                            <span style="font-size:0.78rem;color:#94a3b8">${d}</span>
                                        </div>
                                        <div style="font-size:0.78rem;color:#64748b;margin-top:3px">
                                            Taxa: ${item.taxa || '—'}% · ROI: ${item.roi || '—'}% ·
                                            ${(item.itens || []).length} produto(s)
                                            ${item.descricao ? ` · &quot;${_escapeHtml(item.descricao)}&quot;` : ''}
                                        </div>
                                        ${item.propostaId
                                                ? `<div style="font-size:0.72rem;color:#0ea5e9;margin-top:3px">
                                                     → Gerou proposta ${_escapeHtml((propostas || []).find(p => p.id === item.propostaId)?.numero || '—')}
                                                 </div>` : ''}
                                    </div>
                                </div>`;
                                if (item._tipo === 'proposta') {
                                        const sc = statusColor[item.status] || '#64748b';
                                        return `
                                    <div style="position:relative;margin-bottom:14px">
                                        <div style="position:absolute;left:-19px;top:4px;width:12px;height:12px;
                                                                border-radius:50%;background:${sc};border:2px solid #fff;
                                                                box-shadow:0 0 0 2px ${sc}"></div>
                                        <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px">
                                            <div style="display:flex;justify-content:space-between;align-items:center">
                                                <span style="font-weight:600;color:#0369a1;font-size:0.85rem">
                                                    📋 Proposta ${_escapeHtml(item.numero || '')}
                                                </span>
                                                <div style="display:flex;gap:6px;align-items:center">
                                                    <span style="background:${sc}20;color:${sc};font-size:0.7rem;
                                                                             font-weight:600;padding:1px 8px;border-radius:20px">
                                                        ${_escapeHtml(item.status || '')}
                                                    </span>
                                                    <span style="font-size:0.78rem;color:#94a3b8">${d}</span>
                                                </div>
                                            </div>
                                            <div style="display:flex;justify-content:space-between;margin-top:4px">
                                                <span style="font-size:0.78rem;color:#64748b">
                                                    ${(item.itens || []).length} item(ns)
                                                </span>
                                                <span style="font-size:0.85rem;font-weight:700;color:#16a34a">
                                                    ${fmt(item.valorTotal)}
                                                </span>
                                            </div>
                                            ${item.contratoNumero
                                                ? `<div style="font-size:0.72rem;color:#0ea5e9;margin-top:3px">
                                                         → Contrato #${_escapeHtml(item.contratoNumero)}
                                                     </div>` : ''}
                                        </div>
                                    </div>`;
                                }
                                if (item._tipo === 'contrato') return `
                                <div style="position:relative;margin-bottom:14px">
                                    <div style="position:absolute;left:-19px;top:4px;width:12px;height:12px;
                                                            border-radius:50%;background:#16a34a;border:2px solid #fff;
                                                            box-shadow:0 0 0 2px #16a34a"></div>
                                    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px">
                                        <div style="display:flex;justify-content:space-between;align-items:center">
                                            <span style="font-weight:700;color:#166534;font-size:0.9rem">
                                                📄 Contrato #${_escapeHtml(item.contrato || '')}
                                            </span>
                                            <span style="font-size:0.78rem;color:#94a3b8">${d}</span>
                                        </div>
                                        <div style="display:flex;justify-content:space-between;margin-top:4px">
                                            <span style="font-size:0.78rem;color:#64748b">
                                                Rep: ${_escapeHtml(item.representante || '')} · ${(item.itens || []).length} item(ns)
                                            </span>
                                            <span style="font-size:1rem;font-weight:800;color:#16a34a">
                                                ${fmt(item.valorTotal)}
                                            </span>
                                        </div>
                                    </div>
                                </div>`;
                                return '';
                        }).join('')}
                    </div>
                </div>
            </div>`;
        }).filter(Boolean).join('');

        container.innerHTML = html || `
        <div style="text-align:center;padding:60px;color:#94a3b8">
            <div style="font-size:3rem;margin-bottom:12px">🔗</div>
            <div>Nenhuma rastreabilidade encontrada</div>
        </div>`;
}

function exportarRastreabilidade() {
        const rows = [];
        (clientes || []).forEach(c => {
                (precificacoesCliente || []).filter(p => String(p.clienteId) === String(c.id)).forEach(p => rows.push({
                        'Cliente': c.nome,
                        'UF': c.uf || '',
                        'Tipo': ((c.cnpj || '').replace(/\D/g, '').length === 14 ? 'PJ' : 'PF'),
                        'Evento': 'Precificação',
                        'Data': new Date(p.dataCriacao).toLocaleDateString('pt-BR'),
                        'Versão/Nº': 'v' + (p.versao || 1),
                        'Valor': '',
                        'Status': p.status,
                        'Ligação': p.propostaId ? ((propostas || []).find(x => x.id === p.propostaId)?.numero || '') : ''
                }));
                (propostas || []).filter(p => p.cliente === c.nome).forEach(p => rows.push({
                        'Cliente': c.nome,
                        'UF': c.uf || '',
                        'Tipo': ((c.cnpj || '').replace(/\D/g, '').length === 14 ? 'PJ' : 'PF'),
                        'Evento': 'Proposta',
                        'Data': new Date(p.dataCriacao || p.data || new Date()).toLocaleDateString('pt-BR'),
                        'Versão/Nº': p.numero,
                        'Valor': p.valorTotal || 0,
                        'Status': p.status,
                        'Ligação': p.contratoNumero || ''
                }));
                (estoque.registroVendas || []).filter(v => v.loja === c.nome).forEach(v => rows.push({
                        'Cliente': c.nome,
                        'UF': c.uf || '',
                        'Tipo': ((c.cnpj || '').replace(/\D/g, '').length === 14 ? 'PJ' : 'PF'),
                        'Evento': 'Contrato',
                        'Data': new Date(v.data || new Date()).toLocaleDateString('pt-BR'),
                        'Versão/Nº': '#' + (v.contrato || ''),
                        'Valor': v.valorTotal || 0,
                        'Status': 'fechado',
                        'Ligação': ''
                }));
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Rastreabilidade');
        XLSX.writeFile(wb, 'rastreabilidade_' + new Date().toISOString().split('T')[0] + '.xlsx');
}

// ── Precificação por Cliente: utilitários e calculadora (em tempo real, não persiste dados) ──
function popularSelectClientesPrecif() {
    const select = document.getElementById('precifClienteSelect');
    if (!select) return;
    const valorAtual = select.value;
    const list = (clientes || []).slice().sort((a,b) => (a.nome||'').localeCompare(b.nome||''));
    const optionsHtml = list.map(c => {
        const tipo = c.tipoPessoa || (((c.cnpj||'').replace(/\D/g,''))).length === 14 ? 'PJ' : 'PF';
        const ultima = (propostas || [])
            .filter(p => p.cliente === c.nome)
            .sort((a,b) => new Date(b.dataCriacao||0) - new Date(a.dataCriacao||0))[0];
        const badge = ultima ? ` [${String(ultima.status || '').toUpperCase()}]` : '';
        return `<option value="${c.id}">${_escapeHtml(c.nome||'-')} — ${_escapeHtml(c.uf||'??')} (${tipo})${badge}</option>`;
    }).join('');
    select.innerHTML = '<option value="">Selecione um cliente...</option>' + optionsHtml;
    if (valorAtual) select.value = valorAtual;

    // Atualizar labels de padrão (agora vindos de configuração/localStorage)
    const taxaPadRaw = parseFloat(localStorage.getItem('precif_taxa_global'));
    const roiPadRaw  = parseFloat(localStorage.getItem('precif_roi_global'));
    const comPadRaw  = parseFloat(localStorage.getItem('precif_com_global'));
    const taxaPad = isNaN(taxaPadRaw) ? 20 : taxaPadRaw;
    const roiPad  = isNaN(roiPadRaw)  ? 30 : roiPadRaw;
    const comPad  = isNaN(comPadRaw)  ? 5  : comPadRaw;
    const elTaxa = document.getElementById('precifTaxaPadraoLabel'); if (elTaxa) elTaxa.textContent = 'Padrão: ' + taxaPad + '%';
    const elROI  = document.getElementById('precifROIPadraoLabel'); if (elROI) elROI.textContent = 'Padrão: ' + roiPad + '%';
    const elCom  = document.getElementById('precifComissaoPadraoLabel'); if (elCom) elCom.textContent = 'Padrão: ' + comPad + '%';
}

function popularSelectProdutosPrecif() {
    // Mantida para compatibilidade com chamadas antigas.
    // Agora a seleção de produtos é via checklist.
    try { precifPopularChecklist(); } catch (e) {}
}

// Populate product checklist when client is selected
function precifPopularChecklist() {
    const container = document.getElementById('precifProdutosChecklist');
    const contador  = document.getElementById('precifProdutoContador');
    if (!container) return;

    const produtos = (estoque.produtos || [])
        .filter(p => {
            const ci = parseFloat((precificacao[p.nome] || {}).ci || p.ci || 0);
            return ci > 0; // only show products with CI defined
        })
        .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

    if (!produtos.length) {
        container.innerHTML =
            '<span style="color:#94a3b8;font-size:0.85rem">' +
            'Nenhum produto com CI configurado</span>';
        if (contador) contador.textContent = '0 produto(s) selecionados';
        return;
    }

    container.innerHTML = produtos.map(p => `
        <label style="display:flex;align-items:center;gap:6px;
                      background:#fff;border:1px solid #e2e8f0;
                      border-radius:20px;padding:4px 12px;
                      cursor:pointer;font-size:0.85rem;
                      white-space:nowrap;user-select:none"
               title="${_escapeHtml(p.nome)}">
          <input type="checkbox" class="precif-prod-check"
                 value="${String(p.nome).replace(/"/g, '&quot;')}"
                 checked
                 onchange="precifAtualizarContador()"
                 style="cursor:pointer;accent-color:#1e3a5f">
          ${_escapeHtml(p.nome)}
        </label>`).join('');

    precifAtualizarContador();
}

function precifAtualizarContador() {
    const checks = document.querySelectorAll('.precif-prod-check');
    const checked = document.querySelectorAll('.precif-prod-check:checked');
    const el = document.getElementById('precifProdutoContador');
    if (el) {
        el.textContent = checked.length === checks.length
            ? `Todos os ${checks.length} produto(s) serão calculados`
            : `${checked.length} de ${checks.length} produto(s) selecionados`;
        el.style.color = checked.length === 0 ? '#dc2626' : '#64748b';
    }
}

function precifSelecionarTodosProdutos(selecionar) {
    document.querySelectorAll('.precif-prod-check').forEach(cb => {
        cb.checked = selecionar;
    });
    precifAtualizarContador();
    try { calcularPrecificacaoPorCliente(); } catch (e) {}
}

function precifGetProdutosSelecionados() {
    // Nova UX: lê da lista de linhas individuais
    const linhas = document.querySelectorAll('.precif-linha-produto');
    if (linhas.length > 0) {
        return Array.from(linhas)
            .map(l => l.dataset.nomeProduto)
            .filter(n => !!n);
    }
    // Fallback: checklist antigo (compatibilidade)
    return Array.from(document.querySelectorAll('.precif-prod-check:checked')).map(cb => cb.value);
}

// ==========================================
// UX: Lista de produtos individual na precificação
// ==========================================

// Retorna defaults globais preenchidos pelo usuário
function precifGetGlobais() {
    const taxaGlobalRaw = parseFloat(localStorage.getItem('precif_taxa_global'));
    const roiGlobalRaw  = parseFloat(localStorage.getItem('precif_roi_global'));
    const comGlobalRaw  = parseFloat(localStorage.getItem('precif_com_global'));
    const taxaGlobal = isNaN(taxaGlobalRaw) ? 20 : taxaGlobalRaw;
    const roiGlobal  = isNaN(roiGlobalRaw)  ? 30 : roiGlobalRaw;
    const comGlobal  = isNaN(comGlobalRaw)  ? 5  : comGlobalRaw;
    const taxaInput = parseFloat(document.getElementById('precifTaxaOverride')?.value);
    const roiInput  = parseFloat(document.getElementById('precifROIOverride')?.value);
    const comInput  = parseFloat(document.getElementById('precifComissaoOverride')?.value);
    return {
        taxa: !isNaN(taxaInput) ? taxaInput : taxaGlobal,
        roi:  !isNaN(roiInput)  ? roiInput  : roiGlobal,
        com:  !isNaN(comInput)  ? comInput  : comGlobal
    };
}

// Salvar/Restaurar padrões globais de precificação
function salvarPadraoPrecif() {
    try {
        const taxaVal = parseFloat(document.getElementById('precifTaxaOverride')?.value);
        const roiVal  = parseFloat(document.getElementById('precifROIOverride')?.value);
        const comVal  = parseFloat(document.getElementById('precifComissaoOverride')?.value);
        if (!isNaN(taxaVal)) localStorage.setItem('precif_taxa_global', String(taxaVal));
        if (!isNaN(roiVal))  localStorage.setItem('precif_roi_global', String(roiVal));
        if (!isNaN(comVal))  localStorage.setItem('precif_com_global', String(comVal));
        const taxaPad = isNaN(parseFloat(localStorage.getItem('precif_taxa_global'))) ? 20 : parseFloat(localStorage.getItem('precif_taxa_global'));
        const roiPad  = isNaN(parseFloat(localStorage.getItem('precif_roi_global')))  ? 30 : parseFloat(localStorage.getItem('precif_roi_global'));
        const comPad  = isNaN(parseFloat(localStorage.getItem('precif_com_global')))  ? 5  : parseFloat(localStorage.getItem('precif_com_global'));
        const elTaxa = document.getElementById('precifTaxaPadraoLabel'); if (elTaxa) elTaxa.textContent = 'Padrão: ' + taxaPad + '%';
        const elROI  = document.getElementById('precifROIPadraoLabel'); if (elROI)  elROI.textContent  = 'Padrão: ' + roiPad + '%';
        const elCom  = document.getElementById('precifComissaoPadraoLabel'); if (elCom) elCom.textContent  = 'Padrão: ' + comPad + '%';
        mostrarNotificacao && mostrarNotificacao('Padrões salvos.', 'success');
    } catch (e) { console.warn('salvarPadraoPrecif', e); mostrarNotificacao && mostrarNotificacao('Erro ao salvar padrões.', 'error'); }
}

function restaurarPadraoPrecif() {
    try {
        localStorage.removeItem('precif_taxa_global');
        localStorage.removeItem('precif_roi_global');
        localStorage.removeItem('precif_com_global');
        const elTaxa = document.getElementById('precifTaxaPadraoLabel'); if (elTaxa) elTaxa.textContent = 'Padrão: 20%';
        const elROI  = document.getElementById('precifROIPadraoLabel'); if (elROI)  elROI.textContent  = 'Padrão: 30%';
        const elCom  = document.getElementById('precifComissaoPadraoLabel'); if (elCom) elCom.textContent  = 'Padrão: 5%';
        // limpar inputs de override
        const tIn = document.getElementById('precifTaxaOverride'); if (tIn) tIn.value = '';
        const rIn = document.getElementById('precifROIOverride');  if (rIn) rIn.value = '';
        const cIn = document.getElementById('precifComissaoOverride'); if (cIn) cIn.value = '';
        mostrarNotificacao && mostrarNotificacao('Padrões restaurados.', 'success');
    } catch (e) { console.warn('restaurarPadraoPrecif', e); mostrarNotificacao && mostrarNotificacao('Erro ao restaurar padrões.', 'error'); }
}

function precifAdicionarProdutoLinha(nomeProduto = '', taxaOvr = null, roiOvr = null, freteVal = null, quantidade = 1) {
    const container = document.getElementById('precifLinhasProdutos');
    if (!container) return;

    // Remover placeholder caso exista
    const placeholder = container.querySelector('[data-placeholder]');
    if (placeholder) placeholder.remove();

    const glob = precifGetGlobais();
    const produtos = [...(estoque.produtos || [])].sort((a, b) => (a.nome||'').localeCompare(b.nome||'', 'pt-BR'));

    const linhaId = 'precif-linha-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);
    const div = document.createElement('div');
    div.className = 'precif-linha-produto';
    div.dataset.nomeProduto = nomeProduto;
    div.id = linhaId;
    div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 0.9fr 0.9fr 0.9fr 0.8fr auto;gap:8px;align-items:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px';

    // Opções de produto
    const optsHtml = produtos.map(p => {
        const ci = parseFloat(precificacao[p.nome]?.ci || p.ci || 0);
        const ciTxt = ci > 0 ? ` (CI: ${_fmtMoeda(ci)})` : ' (sem CI)';
        const sel = p.nome === nomeProduto ? ' selected' : '';
        return `<option value="${_escapeHtml(p.nome)}"${sel}>${_escapeHtml(p.nome)}${ciTxt}</option>`;
    }).join('');

    div.innerHTML = `
        <div>
            <label style="font-size:0.75rem;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Produto</label>
            <select class="precif-linha-select" onchange="precifLinhaAtualizarProduto(this)" style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.85rem">
                <option value="">Selecione...</option>
                ${optsHtml}
            </select>
        </div>
        <div>
            <label style="font-size:0.75rem;font-weight:600;color:#64748b;display:block;margin-bottom:3px">CI</label>
            <input type="text" class="precif-linha-ci" placeholder="—"
                oninput="this.value = formatCurrencyBRLInput(this.value)"
                style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.85rem;background:#fff;color:#1e3a5f;font-weight:600"
                title="CI usado nesta linha — altera apenas este cálculo">
        </div>
        <div>
            <label style="font-size:0.75rem;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Taxa (%)</label>
            <input type="number" class="precif-linha-taxa" min="0" step="0.01" value="${taxaOvr !== null ? taxaOvr : glob.taxa}" placeholder="${glob.taxa}"
                style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.85rem">
        </div>
        <div>
            <label style="font-size:0.75rem;font-weight:600;color:#64748b;display:block;margin-bottom:3px">ROI (%)</label>
            <input type="number" class="precif-linha-roi" min="0" step="0.01" value="${roiOvr !== null ? roiOvr : glob.roi}" placeholder="${glob.roi}"
                style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.85rem">
        </div>
        <div>
            <label style="font-size:0.75rem;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Frete (R$)</label>
            <input type="number" class="precif-linha-frete" min="0" step="0.01" value="${(typeof freteVal !== 'undefined' && freteVal !== null) ? freteVal : ''}" placeholder="0,00"
                style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.85rem">
        </div>
        <div>
            <label style="font-size:0.75rem;font-weight:600;color:#64748b;display:block;margin-bottom:3px">Qtd</label>
            <input type="number" class="precif-linha-quant" min="1" step="1" value="${(typeof quantidade !== 'undefined' && quantidade !== null) ? quantidade : 1}" placeholder="1"
                style="width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:5px;font-size:0.85rem">
        </div>
        <button type="button" onclick="document.getElementById('${linhaId}').remove(); atualizarContadorLinhasPrecif();"
            title="Remover produto"
            style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:6px;width:32px;height:32px;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;margin-top:18px">✕</button>
    `;

    // Se produto já estava selecionado, preenche CI (formatado)
    if (nomeProduto) {
        const ci = parseFloat(precificacao[nomeProduto]?.ci || 0);
        const ciInput = div.querySelector('.precif-linha-ci');
        if (ciInput && ci > 0) ciInput.value = _fmtMoeda(ci);
    }

    container.appendChild(div);
    atualizarContadorLinhasPrecif();
}

function precifLinhaAtualizarProduto(select) {
    const linha = select.closest('.precif-linha-produto');
    if (!linha) return;
    const nome = select.value;
    linha.dataset.nomeProduto = nome;
    const ciInput = linha.querySelector('.precif-linha-ci');
    if (ciInput && nome) {
        const ci = parseFloat(precificacao[nome]?.ci || 0);
        ciInput.value = ci > 0 ? _fmtMoeda(ci) : '';
        ciInput.placeholder = ci > 0 ? '' : 'sem CI';
    }
    atualizarContadorLinhasPrecif();
}

function atualizarContadorLinhasPrecif() {
    const linhas = document.querySelectorAll('.precif-linha-produto');
    const el = document.getElementById('precifProdutoContador');
    if (el) {
        if (linhas.length === 0) {
            el.textContent = '';
            // Mostrar placeholder
            const container = document.getElementById('precifLinhasProdutos');
            if (container && !container.querySelector('[data-placeholder]')) {
                container.innerHTML = '<div data-placeholder style="color:#94a3b8;font-size:0.85rem;text-align:center;padding:14px;background:#f8fafc;border-radius:8px;border:1px dashed #e2e8f0">Clique em &quot;+ Adicionar Produto&quot; para iniciar</div>';
            }
        } else {
            el.textContent = `${linhas.length} produto(s) na lista`;
        }
    }
}

// Retorna os dados das linhas para o cálculo
function precifGetLinhasProdutos() {
    return Array.from(document.querySelectorAll('.precif-linha-produto')).map(linha => ({
        nomeProduto: linha.dataset.nomeProduto || '',
        ci: parseCurrencyBRLToNumber(linha.querySelector('.precif-linha-ci')?.value) || 0,
        taxa: parseFloat(linha.querySelector('.precif-linha-taxa')?.value),
        roi: parseFloat(linha.querySelector('.precif-linha-roi')?.value),
        frete: parseFloat(linha.querySelector('.precif-linha-frete')?.value) || 0,
        quantidade: parseInt(linha.querySelector('.precif-linha-quant')?.value, 10) || 1
    })).filter(l => l.nomeProduto);
}

function obterUltimaPrecificacaoCliente(clienteId) {
    const registros = (precificacoesCliente || []).filter(p => String(p.clienteId) === String(clienteId));
    if (!registros.length) return null;
    return registros.sort((a, b) => new Date(b.dataCriacao || 0) - new Date(a.dataCriacao || 0))[0];
}

function limparAvisoCI() {
    const oldAviso = document.getElementById('avisoCI');
    if (oldAviso) oldAviso.remove();
}

function atualizarAvisoCIDivergente(precifSalva) {
    if (!precifSalva) {
        limparAvisoCI();
        return;
    }

    const alertaCI = [];
    (precifSalva.itens || []).forEach(item => {
        const ciAtual = parseFloat(precificacao[item.produto]?.ci) || 0;
        const ciSalvo = parseFloat(item.ci) || 0;
        if (ciAtual !== ciSalvo && ciSalvo > 0) {
            alertaCI.push({
                produto: item.produto,
                ciSalvo,
                ciAtual,
                diff: ((ciAtual - ciSalvo) / ciSalvo * 100).toFixed(1)
            });
        }
    });

    if (alertaCI.length > 0) {
        const avisoEl = document.createElement('div');
        avisoEl.style.cssText = 'background:#fff8f0; border:1px solid #fed7aa; border-radius:8px; padding:10px 14px; margin-top:10px; font-size:0.82rem; color:#92400e';
        avisoEl.innerHTML = `
            ⚠️ <strong>${alertaCI.length} produto(s)</strong> tiveram o CI alterado desde que esta precificação foi salva:<br>
            <ul style="margin:6px 0 0 16px; padding:0">
                ${alertaCI.map(a => `
                    <li>
                        ${_escapeHtml(a.produto)}:
                        salvo R$ ${a.ciSalvo.toFixed(2)} →
                        atual R$ ${a.ciAtual.toFixed(2)}
                        <span style="color:${parseFloat(a.diff) > 0 ? '#dc2626' : '#16a34a'}">
                            (${parseFloat(a.diff) > 0 ? '+' : ''}${a.diff}%)
                        </span>
                    </li>
                `).join('')}
            </ul>
            <div style="margin-top:8px">
                A precificação salva usa os valores originais.
                Para recalcular com o CI atual, clique em <strong>Calcular</strong> e salve novamente.
            </div>
        `;
        const banner = document.getElementById('precifClienteBanner');
        if (banner && banner.parentNode) {
            limparAvisoCI();
            avisoEl.id = 'avisoCI';
            banner.parentNode.insertBefore(avisoEl, banner.nextSibling);
        }
    } else {
        limparAvisoCI();
    }
}

function aplicarEstadoPrecificacaoSalva(registro) {
    if (!registro) return;

    try {
        retidPorProduto = registro.retidPorProduto || {};
        beneficioFiscalAtivo = registro.beneficioFiscalAtivo || false;
        beneficiosPorProduto = registro.beneficiosPorProduto || {};
    } catch (e) {}

    exibindoPrecifSalva = true;
    precifSalvaCarregada = registro;
    ultimaPrecificacaoCalculada = registro;
    try { ultimaVersaoSalva = registro.versao || null; } catch (e) {}

    try {
        const cliente = (clientes || []).find(c => String(c.id) === String(registro.clienteId));
        const select = document.getElementById('precifClienteSelect');
        if (select) select.value = registro.clienteId || '';
        const ufEl = document.getElementById('precifClienteUF'); if (ufEl) ufEl.value = registro.clienteUF || registro.uf || '—';
        const tipoEl = document.getElementById('precifClienteTipo'); if (tipoEl) tipoEl.value = registro.tipoPessoa || '—';
        const repSel = document.getElementById('precifRepresentanteSelect'); if (repSel) repSel.value = registro.representante || registro.rep || '';
        const banner = document.getElementById('precifClienteBanner'); if (banner) banner.style.display = 'flex';
        const name = document.getElementById('precifBannerNome'); if (name) name.textContent = cliente?.nome || registro.clienteNome || '—';
        const doc = document.getElementById('precifBannerDoc'); if (doc) doc.textContent = cliente?.cnpj || cliente?.cpf || '—';
        const ufBanner = document.getElementById('precifBannerUF'); if (ufBanner) ufBanner.textContent = registro.clienteUF || registro.uf || cliente?.uf || cliente?.estado || '—';
        const tipoBanner = document.getElementById('precifBannerTipo'); if (tipoBanner) tipoBanner.textContent = registro.tipoPessoa || cliente?.tipoPessoa || '—';
        const contato = document.getElementById('precifBannerContato'); if (contato) contato.textContent = cliente?.contato || cliente?.email || '—';
        const taxaOverride = document.getElementById('precifTaxaOverride'); if (taxaOverride) taxaOverride.value = registro.taxa ?? '';
        const roiOverride = document.getElementById('precifROIOverride'); if (roiOverride) roiOverride.value = registro.roi ?? '';
        const comOverride = document.getElementById('precifComissaoOverride'); if (comOverride) comOverride.value = registro.comissao ?? '';
        const validadeEl = document.getElementById('precifValidadeDias'); if (validadeEl) validadeEl.value = registro.validadeDias ?? 30;

        const filtros = registro.filtros || {};
        const filtroProduto = document.getElementById('precifFiltroProduto'); if (filtroProduto) filtroProduto.value = filtros.filtroProduto || '';
        const filtroNCM = document.getElementById('precifFiltroNCM'); if (filtroNCM) filtroNCM.value = filtros.filtroNCM || '';
        const filtroCI = document.getElementById('precifFiltroCI'); if (filtroCI) filtroCI.value = filtros.filtroCI || 'todos';

        const cb = document.getElementById('precifBeneficioFiscal'); if (cb) cb.checked = !!beneficioFiscalAtivo;
        const painel = document.getElementById('painelBeneficioFiscal'); if (painel) painel.style.display = beneficioFiscalAtivo ? 'block' : 'none';
        if (beneficioFiscalAtivo) renderizarTabelaBeneficios();
    } catch (e) {}

    // Repopular linhas de produtos para edição, se existirem itens salvos
    try {
        const container = document.getElementById('precifLinhasProdutos');
        const itens = registro.itens || registro.produtos || [];
        if (container) {
            if (itens.length === 0) {
                container.innerHTML = '<div data-placeholder style="color:#94a3b8;font-size:0.85rem;text-align:center;padding:14px;background:#f8fafc;border-radius:8px;border:1px dashed #e2e8f0">Clique em "+ Adicionar Produto" para iniciar</div>';
            } else {
                itens.forEach(it => {
                    try {
                        precifAdicionarProdutoLinha(it.produto || it.produtoNome || it.nome || '', it.taxa || it.taxaPct || null, it.roi || it.roiPct || null, it.frete || it.freteR || 0, it.quantidade || it.qtd || 1);
                    } catch (e) {}
                });
            }
            atualizarContadorLinhasPrecif();
        }
    } catch (e) {}

    calcularPrecificacaoPorCliente();
}

function selecionarClientePrecif() {
        const select = document.getElementById('precifClienteSelect');
        if (!select) return;
    const clienteId = select.value;
    exibindoPrecifSalva = false;
    precifSalvaCarregada = null;
    // Resetar benefícios/RETID ao trocar de cliente
    beneficioFiscalAtivo = false;
    beneficiosPorProduto = {};
    retidPorProduto = {};
    try {
        const cbBenef = document.getElementById('precifBeneficioFiscal'); if (cbBenef) cbBenef.checked = false;
        const painel = document.getElementById('painelBeneficioFiscal'); if (painel) painel.style.display = 'none';
    } catch (e) {}
        const cliente = (clientes || []).find(c => String(c.id) === String(clienteId));
        if (!cliente) {
                const banner = document.getElementById('precifClienteBanner'); if (banner) banner.style.display = 'none';
                const resultado = document.getElementById('precifClienteResultado'); if (resultado) resultado.style.display = 'none';
                const empty = document.getElementById('precifClienteEmpty'); if (empty) empty.style.display = 'block';
            try { atualizarStatusPropostaNaPrecif(''); } catch (e) {}
            limparAvisoCI();
                return;
        }

        const uf = (cliente.uf || cliente.estado || '').toUpperCase().trim();
        const cnpjLimpo = (cliente.cnpj || '').replace(/\D/g,'');
        const tipoPessoa = cliente.tipoPessoa || (cnpjLimpo.length === 14 ? 'PJ' : 'PF');

        const ufEl = document.getElementById('precifClienteUF'); if (ufEl) ufEl.value = uf || '—';
        const tipoEl = document.getElementById('precifClienteTipo'); if (tipoEl) tipoEl.value = tipoPessoa;

        const banner = document.getElementById('precifClienteBanner');
        if (banner) banner.style.display = 'flex';
        const name = document.getElementById('precifBannerNome'); if (name) name.textContent = cliente.nome || '—';
        const doc = document.getElementById('precifBannerDoc'); if (doc) doc.textContent = cliente.cnpj || cliente.cpf || '—';
        const ufB = document.getElementById('precifBannerUF'); if (ufB) ufB.textContent = uf || '—';
        const tipoB = document.getElementById('precifBannerTipo'); if (tipoB) tipoB.textContent = tipoPessoa;
        const contato = document.getElementById('precifBannerContato'); if (contato) contato.textContent = cliente.contato || cliente.email || '—';

        calcularPrecificacaoPorCliente({ forcarAtual: true });

        try { renderizarHistoricoPrecif(cliente.id); } catch (e) {}

        // Mostrar se existe precificação salva para este cliente
        try {
            const precifSalva = obterUltimaPrecificacaoCliente(cliente.id);
            const infoEl = document.getElementById('precifSalvoInfo');
            if (precifSalva && infoEl) {
                const dt = precifSalva.dataCriacao ? new Date(precifSalva.dataCriacao).toLocaleString('pt-BR') : '';
                infoEl.innerHTML = `<span style="color:#16a34a; font-size:0.82rem">✅ Precificação salva em ${dt}</span> <button onclick="carregarPrecificacaoSalva('${cliente.id}')" class="btn btn-outline btn-sm" style="margin-left:8px">↩ Carregar salva</button>`;
                atualizarAvisoCIDivergente(precifSalva);
            } else {
                const infoEl2 = document.getElementById('precifSalvoInfo'); if (infoEl2) infoEl2.innerHTML = '';
                limparAvisoCI();
            }
        } catch (e) {}
        try { atualizarStatusPropostaNaPrecif(cliente.id); } catch (e) {}
}

function calcularPrecificacaoPorCliente(opcoes = {}) {
    if (opcoes.forcarAtual) {
        exibindoPrecifSalva = false;
        precifSalvaCarregada = null;
    }

    const select = document.getElementById('precifClienteSelect');
    const clienteId = select?.value;
    const cliente = (clientes || []).find(c => String(c.id) === String(clienteId));
    if (!cliente) {
        const resultado = document.getElementById('precifClienteResultado'); if (resultado) resultado.style.display = 'none';
        const empty = document.getElementById('precifClienteEmpty'); if (empty) empty.style.display = 'block';
        const banner = document.getElementById('precifClienteBanner'); if (banner) banner.style.display = 'none';
        ultimaPrecificacaoCalculada = null;
        limparAvisoCI();
        return;
    }

    const uf = (cliente.uf || cliente.estado || '').toUpperCase().trim();
    const cnpjLimpo = (cliente.cnpj || '').replace(/\D/g,'');
    const tipoPessoa = cliente.tipoPessoa || (cnpjLimpo.length === 14 ? 'PJ' : 'PF');

    try { document.getElementById('precifClienteUF').value = uf || '—'; } catch (e) {}
    try { document.getElementById('precifClienteTipo').value = tipoPessoa; } catch (e) {}
    // pré-selecionar representante se cadastro do cliente tiver
    try { const repSel = document.getElementById('precifRepresentanteSelect'); if (repSel) repSel.value = cliente.representante || ''; } catch (e) {}

    const taxaOverride = parseFloat(document.getElementById('precifTaxaOverride')?.value);
    const roiOverride = parseFloat(document.getElementById('precifROIOverride')?.value);
    const comOverride = parseFloat(document.getElementById('precifComissaoOverride')?.value);

    const taxaGlobalRaw = parseFloat(localStorage.getItem('precif_taxa_global'));
    const roiGlobalRaw  = parseFloat(localStorage.getItem('precif_roi_global'));
    const comGlobalRaw  = parseFloat(localStorage.getItem('precif_com_global'));
    const taxaGlobal = isNaN(taxaGlobalRaw) ? 20 : taxaGlobalRaw;
    const roiGlobal  = isNaN(roiGlobalRaw)  ? 30 : roiGlobalRaw;
    const comGlobal  = isNaN(comGlobalRaw)  ? 5  : comGlobalRaw;

    const taxaLbl = document.getElementById('precifTaxaPadraoLabel');
    const roiLbl  = document.getElementById('precifROIPadraoLabel');
    const comLbl  = document.getElementById('precifComissaoPadraoLabel');
    if (taxaLbl) taxaLbl.textContent = 'Padrão: ' + taxaGlobal + '%';
    if (roiLbl)  roiLbl.textContent  = 'Padrão: ' + roiGlobal + '%';
    if (comLbl)  comLbl.textContent  = 'Padrão: ' + comGlobal + '%';

    const taxaFinal = !isNaN(taxaOverride) ? taxaOverride : taxaGlobal;
    const roiFinal  = !isNaN(roiOverride)  ? roiOverride  : roiGlobal;
    const comFinal  = !isNaN(comOverride)  ? comOverride  : comGlobal;

    // filtros via checklist (fallback para texto, caso exista)
    const filtroProdutoTexto = (document.getElementById('precifFiltroProduto')?.value || '').toLowerCase().trim();

    // Nova UX: verificar se há linhas de produto adicionadas
    const linhasAdicionadas = document.querySelectorAll('.precif-linha-produto');
    if (linhasAdicionadas.length === 0) {
        const resultado = document.getElementById('precifClienteResultado'); if (resultado) resultado.style.display = 'none';
        const empty = document.getElementById('precifClienteEmpty');
        if (empty) {
            empty.innerHTML = `<div style="font-size:2rem;margin-bottom:12px">📋</div>
                <div style="font-size:1rem;font-weight:600;color:#1e3a5f;margin-bottom:8px">Adicione produtos para calcular</div>
                <div style="font-size:0.85rem;color:#94a3b8">Clique em "+ Adicionar Produto" para inserir os produtos desta proposta, <br>ajuste a Taxa e o ROI de cada um e clique em 🧮 Calcular.</div>`;
            empty.style.display = 'block';
        }
        return;
    }

    const produtos = estoque.produtos || [];
    const fmt = v => 'R$ ' + _fmtMoeda(v);
    const pct = v => (Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '0.00') + '%';
    const corMargem = m => m >= 30 ? '#16a34a' : m >= 15 ? '#d97706' : '#dc2626';

    let totalFaturamento = 0;
    let produtosSemCI = 0;
    let produtosCalculados = 0;
    let abaixoCount = 0;

    const produtosSelecionados = precifGetProdutosSelecionados();

    const produtosFiltrados = produtos.filter(produto => {
        try {
            // If checklist has items, use it as the filter
            if (produtosSelecionados.length > 0) {
                return produtosSelecionados.includes(produto.nome);
            }
            // Fallback to old text filter if checklist is empty
            const filtroProduto = (document.getElementById('precifFiltroProduto')?.value || '').toLowerCase().trim();
            if (filtroProduto && !(produto.nome || '').toLowerCase().includes(filtroProduto)) return false;
            return true;
        } catch(e) { return false; }
    });

    const contEl = document.getElementById('precifProdutoContador');
    if (contEl && produtosSelecionados.length > 0) {
        contEl.textContent = `${produtosFiltrados.length} produto(s) sendo calculado(s)`;
    }

    const itensCalculados = [];
    const rows = produtosFiltrados.map(produto => {
        const prec = precificacao[produto.nome] || {};
        const aliq = tabelaAliquotas[produto.nome] || {};
        const ncm = produto.ncm || detectarNCM(produto.nome) || '—';

        // Verificar se existe linha individual para este produto (nova UX)
        const linhaIndividual = (() => {
            try {
                return Array.from(document.querySelectorAll('.precif-linha-produto'))
                    .find(l => l.dataset.nomeProduto === produto.nome) || null;
            } catch (e) { return null; }
        })();

        let ci;
        if (linhaIndividual) {
            // CI vem do campo da linha individual (pode ter sido editado pelo usuário)
            const ciLinha = parseCurrencyBRLToNumber(linhaIndividual.querySelector('.precif-linha-ci')?.value);
            ci = !isNaN(ciLinha) && ciLinha > 0 ? ciLinha : (parseFloat(prec.ci) || 0);
        } else if (exibindoPrecifSalva && precifSalvaCarregada) {
            const itemSalvo = (precifSalvaCarregada.itens || []).find(i => i.produto === produto.nome);
            ci = itemSalvo ? parseFloat(itemSalvo.ci) : (parseFloat(prec.ci) || 0);
        } else {
            ci = parseFloat(prec.ci) || 0;
        }
        if (ci === 0) {
            produtosSemCI++;
            const nomeId = (produto.nome || '').replace(/[^a-z0-9]/gi, '_');
            return `
                <tr id="precif_row_${nomeId}" style="opacity:0.45">
                    <td style="text-align:left; padding-left:15px; font-weight:500; position:sticky; left:0; background:#fff; z-index:1">${_escapeHtml(produto.nome)}<span style="font-size:0.7rem; color:#94a3b8; margin-left:6px">sem CI</span></td>
                    <td colspan="10" style="text-align:center; color:#94a3b8; font-size:0.85rem">CI não configurado — informe o CI na linha ou acesse a Tabela de CI</td>
                </tr>
            `;
        }

        const fedImpostos = impostosEditaveis[ncm] || {};
        const pisPadrao = parseFloat(aliq.pis ?? fedImpostos.pis ?? document.getElementById('pisPadrao')?.value) || 1.65;
        const cofinsPadrao = parseFloat(aliq.cofins ?? fedImpostos.cofins ?? document.getElementById('cofinsPadrao')?.value) || 7.6;
        const ipiPadrao = parseFloat(aliq.ipi ?? fedImpostos.ipi ?? 0) || 0;

        const icmsPadrao = uf ? buscarAliquotaICMS(uf, tipoPessoa, produto.nome) : (parseFloat(aliq.icmsBase) || 0);

        // Taxa e ROI: prioridade à linha individual > produto individual > global
        let taxaProd, roiProd;
        if (linhaIndividual) {
            const taxaLinha = parseFloat(linhaIndividual.querySelector('.precif-linha-taxa')?.value);
            const roiLinha  = parseFloat(linhaIndividual.querySelector('.precif-linha-roi')?.value);
            taxaProd = !isNaN(taxaLinha) ? taxaLinha : taxaFinal;
            roiProd  = !isNaN(roiLinha)  ? roiLinha  : roiFinal;
        } else {
            taxaProd = (prec.taxa !== null && prec.taxa !== undefined && prec.taxa !== '') ? parseFloat(prec.taxa) : taxaFinal;
            roiProd  = (prec.roi !== null && prec.roi !== undefined && prec.roi !== '') ? parseFloat(prec.roi) : roiFinal;
        }
        const comissaoProd = (prec.comissao !== null && prec.comissao !== undefined && prec.comissao !== '') ? parseFloat(prec.comissao) : comFinal;

        // resolver alíquotas com benefícios/RETID
        const pisEfetivo = resolverAliquota(produto.nome, 'pis', pisPadrao);
        const cofinsEfetivo = resolverAliquota(produto.nome, 'cofins', cofinsPadrao);
        const ipiEfetivo = resolverAliquota(produto.nome, 'ipi', ipiPadrao);
        const icmsEfetivo = resolverAliquota(produto.nome, 'icms', icmsPadrao);

        const retidAtivo = !!retidPorProduto[produto.nome];

        // valorBase = CI + (CI × Taxa%) + (CI × ROI%)  →  CI × (1 + Taxa% + ROI%)
        const valorBase = ci * (1 + taxaProd/100 + roiProd/100);
        const icmsR = valorBase * icmsEfetivo / 100;
        const pisR = valorBase * pisEfetivo / 100;
        const cofinsR = valorBase * cofinsEfetivo / 100;
        const valorImpostos = valorBase + icmsR + pisR + cofinsR;
        const ipiR = valorImpostos * ipiEfetivo / 100;
        // comissão sobre valorImpostos (sem IPI)
        const comissaoR = valorImpostos * comissaoProd / 100;
        const precoFinal = valorImpostos + ipiR + comissaoR;

        // Frete e Quantidade (pode vir da linha individual, do item salvo ou default)
        let freteVal = 0;
        let quantidade = 1;
        try {
            if (linhaIndividual) {
                const fRaw = parseFloat(linhaIndividual.querySelector('.precif-linha-frete')?.value);
                const qRaw = parseInt(linhaIndividual.querySelector('.precif-linha-quant')?.value, 10);
                freteVal = Number.isFinite(fRaw) ? fRaw : 0;
                quantidade = Number.isFinite(qRaw) && qRaw > 0 ? qRaw : 1;
            } else if (exibindoPrecifSalva && precifSalvaCarregada) {
                const itemSalvo = (precifSalvaCarregada.itens || []).find(i => i.produto === produto.nome);
                if (itemSalvo) {
                    freteVal = Number(itemSalvo.frete || itemSalvo.freteR || 0) || 0;
                    quantidade = Number(itemSalvo.quantidade || itemSalvo.qtd || 1) || 1;
                }
            }
        } catch (e) { freteVal = 0; quantidade = 1; }

        const margem = precoFinal > 0 ? ((precoFinal - ci) / precoFinal) * 100 : 0;
        const margemMinima = parseFloat(precificacao[produto.nome]?.margemMinima) || null;
        const abaixo = margemMinima !== null && margem < margemMinima;
        if (abaixo) abaixoCount++;

        totalFaturamento += precoFinal;
        produtosCalculados++;

        // valores adicionais: valorSemIPI (valorImpostos), valorComIPI, valorFinal, valorTotal
        const valorSemIPI = valorImpostos;
        const valorComIPI = valorSemIPI + ipiR;
        const valorFinalCalc = valorComIPI + comissaoR;
        const valorTotalCalc = (valorFinalCalc * quantidade) + freteVal;

        itensCalculados.push({
            produto: produto.nome,
            produtoId: produto.id || null,
            ncm,
            ci,
            taxa: taxaProd,
            roi: roiProd,
            valorBase,
            pis: pisEfetivo,
            pisR,
            cofins: cofinsEfetivo,
            cofinsR,
            icms: icmsEfetivo,
            icmsR,
            ipi: ipiEfetivo,
            ipiR,
            valorImpostos,
            valorSemIPI,
            valorComIPI,
            comissao: comissaoProd,
            comissaoR,
            precoFinal,
            valorFinal: valorFinalCalc,
            quantidade,
            frete: freteVal,
            valorTotal: valorTotalCalc,
            margem
        });

        const icmsBg = tipoPessoa === 'PF' ? '#fef2f2' : '#f0fdf4';
        const icmsColor = tipoPessoa === 'PF' ? '#dc2626' : '#16a34a';

        const nomeId = (produto.nome || '').replace(/[^a-z0-9]/gi, '_');
        const safeNome = (produto.nome || '').replace(/'/g, "\\'");
        const ciBadge = exibindoPrecifSalva
            ? '<span style="font-size:0.65rem; background:#dbeafe; color:#1d4ed8; padding:1px 5px; border-radius:10px; margin-left:4px; font-weight:600">🔒 salvo</span>'
            : '';

        // product badge
        let prodBadge = '';
        if (retidAtivo) prodBadge = '<span style="font-size:0.68rem; background:#dbeafe; color:#1d4ed8; padding:1px 6px; border-radius:10px; margin-left:6px; font-weight:700">RETID</span>';
        else if ((beneficiosPorProduto[produto.nome] && beneficiosPorProduto[produto.nome].isentoTotal)) prodBadge = '<span style="font-size:0.68rem; background:#dcfce7; color:#166534; padding:1px 6px; border-radius:10px; margin-left:6px; font-weight:700">ISENTO</span>';

        const impostoPctStyle = 'font-size:0.75rem;color:#64748b';
        const impostoValStyle = 'font-weight:600';
        const taxaRoiCell = `<td style="text-align:center;color:#475569">
            <div style="font-size:0.75rem;color:#64748b">Taxa: ${(Number(taxaProd)).toFixed(2)}%</div>
            <div style="font-size:0.75rem;color:#64748b">ROI: ${(Number(roiProd)).toFixed(2)}%</div>
        </td>`;
        const pisCofinsCell = `<td style="text-align:center">
            <div style="${impostoPctStyle}">PIS: ${Number(pisEfetivo).toFixed(2)}%</div>
            <div style="${impostoValStyle}">${fmt(pisR)}</div>
            <div style="${impostoPctStyle};margin-top:4px">COFINS: ${Number(cofinsEfetivo).toFixed(2)}%</div>
            <div style="${impostoValStyle}">${fmt(cofinsR)}</div>
        </td>`;
        const icmsCell = `<td style="text-align:center;background:${icmsBg}">
            <div style="${impostoPctStyle};color:${icmsColor}">${Number(icmsEfetivo).toFixed(2)}%</div>
            <div style="${impostoValStyle}">${fmt(icmsR)}</div>
        </td>`;
        const ipiCell = `<td style="text-align:center">
            <div style="${impostoPctStyle}">${Number(ipiEfetivo).toFixed(2)}%</div>
            <div style="${impostoValStyle}">${fmt(ipiR)}</div>
        </td>`;
        const comissaoCell = `<td style="text-align:center;color:#d97706">
            <div style="${impostoPctStyle}">${(Number(comissaoProd)).toFixed(2)}%</div>
            <div style="${impostoValStyle}">${fmt(comissaoR)}</div>
        </td>`;

        // row left border if margin below minimum (priority) or RETID active
        const rowStyle = abaixo ? 'border-left:3px solid #dc2626' : (retidAtivo ? 'border-left:3px solid #1e3a5f' : '');
        const delta = abaixo ? ((margemMinima - margem) / 100 * precoFinal) : 0;
        const precoFinalCell = `
            <td style="font-weight:800; color:#c9a227; background:#fffbf0; font-size:1rem">
                ${fmt(precoFinal)}
                ${abaixo ? `<div style="font-size:0.68rem;color:#dc2626;margin-top:2px">↑ R$ ${Math.abs(delta).toFixed(2)} abaixo do mín.</div>` : ''}
            </td>
        `;
        const margemCor = margem >= 30 ? '#16a34a' : (margem >= 15 ? '#d97706' : '#dc2626');
        const margemCell = abaixo
            ? `<td style="font-weight:700;color:#dc2626;background:#fef2f2;text-align:center">
                   ${margem.toFixed(1)}%
                   <div style="font-size:0.65rem;background:#fecaca;color:#991b1b;
                               padding:1px 5px;border-radius:10px;margin-top:2px">
                     Mín: ${margemMinima}%
                   </div>
               </td>`
            : `<td style="font-weight:700; color:${margemCor};text-align:center">${margem.toFixed(1)}%</td>`;

        return `
            <tr id="precif_row_${nomeId}" style="${rowStyle}">
                <td style="text-align:left; padding-left:15px; font-weight:500; position:sticky; left:0; background:#fff; z-index:1; border-right:1px solid #e2e8f0">${_escapeHtml(produto.nome)} ${prodBadge}${ciBadge}</td>
                <td style="text-align:center; min-width:80px; font-weight:600">${quantidade}</td>
                <td style="font-weight:600; color:#1e3a5f">${fmt(ci)}</td>
                ${taxaRoiCell}
                <td style="font-weight:600; color:#1e3a5f">${fmt(valorBase)}</td>
                ${pisCofinsCell}
                ${icmsCell}
                <td style="font-weight:600; color:#475569">${fmt(valorImpostos)}</td>
                ${ipiCell}
                <td style="font-weight:600; color:#475569">${fmt(valorComIPI)}</td>
                ${comissaoCell}
                <td style="text-align:right; font-weight:600;">${fmt(freteVal)}</td>
                <td style="font-weight:800; color:#c9a227; background:#fffbf0; font-size:1rem">${fmt(valorFinalCalc)}</td>
                <td style="text-align:right; font-weight:700; color:#1e3a5f">${fmt(valorTotalCalc)}</td>
                ${margemCell}
            </tr>
        `;
    });

    const tbody = document.getElementById('tabelaPrecifClienteBody');
    if (!tbody) {
        // Se o corpo da tabela não existe ainda, atualizamos apenas o contador (se houver) e abortamos
        try {
            const contadorEl = document.getElementById('precifProdutoContador');
            if (contadorEl) contadorEl.textContent = `${produtosFiltrados.length} produto(s) serão calculados`;
        } catch (e) {}
        return;
    }
    tbody.innerHTML = rows.join('');

    // Summary com contagem filtrada
    const totalProdutos = produtos.length;
    const filtrados = produtosFiltrados.length;
    let summaryHTML = `
        <div>
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:0.5px">Exibindo</div>
            <div style="font-size:1.1rem; font-weight:700; color:#1e3a5f">${filtrados} de ${totalProdutos}</div>
        </div>
        <div>
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:0.5px">Sem CI definido</div>
            <div style="font-size:1.2rem; font-weight:700; color:#94a3b8">${produtosSemCI}</div>
        </div>
        <div>
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:0.5px">ICMS aplicado</div>
            <div style="font-size:1rem; font-weight:700; color:${tipoPessoa==='PF'?'#dc2626':'#16a34a'}">${uf} / ${tipoPessoa}</div>
        </div>
        <div style="margin-left:auto; text-align:right">
            <div style="font-size:0.75rem; color:#64748b; text-transform:uppercase; letter-spacing:0.5px">Total da tabela</div>
            <div style="font-size:1.3rem; font-weight:800; color:#16a34a">${fmt(totalFaturamento)}</div>
        </div>
    `;
    if (abaixoCount > 0) {
        summaryHTML += `<div style="color:#dc2626;font-weight:600">⚠️ ${abaixoCount} produto(s) abaixo da margem mínima</div>`;
    }
    // If product dropdown was used, show explicit feedback about selection
    if (produtosSelecionados.length > 0) {
        summaryHTML += `<div style="font-size:0.85rem;color:#64748b;margin-top:8px">Checklist ativo — produtos calculados: ${produtosFiltrados.length}</div>`;
    }
    const summaryEl = document.getElementById('precifClienteSummary');
    if (summaryEl) summaryEl.innerHTML = summaryHTML;

    const resEl = document.getElementById('precifClienteResultado');
    if (resEl) resEl.style.display = 'block';
    const emptyEl2 = document.getElementById('precifClienteEmpty');
    if (emptyEl2) emptyEl2.style.display = 'none';

    // guardar última precificação calculada para salvar/gerar proposta
    const representanteSelecionado = (document.getElementById('precifRepresentanteSelect')?.value) || (cliente.representante || '') || '';
    ultimaPrecificacaoCalculada = {
        clienteId: cliente.id,
        clienteNome: cliente.nome,
        clienteUF: uf,
        uf,
        tipoPessoa,
        representante: representanteSelecionado,
        taxa: taxaFinal,
        roi: roiFinal,
        comissao: comFinal,
        filtros: { filtroProduto: filtroProdutoTexto, produtosSelecionados },
        dataCriacao: new Date().toISOString(),
        itens: itensCalculados,
        totalFaturamento
    };
    atualizarAvisoCIDivergente(exibindoPrecifSalva ? precifSalvaCarregada : obterUltimaPrecificacaoCliente(cliente.id));
    try { atualizarStatusPropostaNaPrecif(ultimaPrecificacaoCalculada.clienteId); } catch (e) {}
}

function exportarPrecifCliente() {
        const select = document.getElementById('precifClienteSelect');
        const clienteId = select?.value;
        const cliente = (clientes || []).find(c => String(c.id) === String(clienteId));
        if (!cliente) { alert('Selecione um cliente antes de exportar.'); return; }
        const rows = [];
        const cabecalho = ['Produto','RETID','NCM','CI (R$)','Taxa %','ROI %','Valor Base','PIS %','COFINS %','ICMS %','Valor s/ IPI','IPI %','Valor c/ IPI','Comissão R$','Frete (R$)','Quantidade','Valor Final','Valor Total','Margem%'];
        rows.push([`Cliente: ${cliente.nome}`, `UF: ${cliente.uf || cliente.estado || '—'}`, `Tipo: ${cliente.tipoPessoa || (((cliente.cnpj||'').replace(/\D/g,'')).length===14?'PJ':'PF')}`]);
        rows.push([]);
        rows.push(cabecalho);

        // Preferir usar a última precificação calculada para este cliente (mais precisa)
        const reg = (ultimaPrecificacaoCalculada && String(ultimaPrecificacaoCalculada.clienteId) === String(clienteId))
                    ? ultimaPrecificacaoCalculada
                    : obterUltimaPrecificacaoCliente(clienteId);

        if (reg && Array.isArray(reg.itens) && reg.itens.length) {
            reg.itens.forEach(prod => {
                rows.push([
                    prod.produto || prod.produtoNome || prod.nome || '',
                    (reg.retidPorProduto && reg.retidPorProduto[prod.produto]) ? 'RETID' : '',
                    prod.ncm || '',
                    (prod.ci || prod.ci === 0) ? _fmtMoeda(prod.ci) : '',
                    prod.taxa != null ? String(prod.taxa) + '%' : '',
                    prod.roi != null ? String(prod.roi) + '%' : '',
                    prod.valorBase != null ? _fmtMoeda(prod.valorBase) : '',
                    prod.pis != null ? String(prod.pis) + '%' : '',
                    prod.cofins != null ? String(prod.cofins) + '%' : '',
                    prod.icms != null ? String(prod.icms) + '%' : '',
                    (prod.valorSemIPI != null) ? _fmtMoeda(prod.valorSemIPI) : '',
                    prod.ipi != null ? String(prod.ipi) + '%' : '',
                    (prod.valorComIPI != null) ? _fmtMoeda(prod.valorComIPI) : '',
                    (prod.comissaoR != null) ? _fmtMoeda(prod.comissaoR) : '',
                    (prod.frete != null) ? _fmtMoeda(prod.frete) : '',
                    prod.quantidade != null ? String(prod.quantidade) : '1',
                    (prod.valorFinal != null) ? _fmtMoeda(prod.valorFinal) : '',
                    (prod.valorTotal != null) ? _fmtMoeda(prod.valorTotal) : '',
                    prod.margem != null ? String(prod.margem) + '%' : ''
                ]);
            });
        } else {
            // Fallback: Ler linhas da tabela DOM (para preservar a ordem e valores formatados)
            const trs = Array.from(document.querySelectorAll('#tabelaPrecifClienteBody tr'));
            trs.forEach(tr => {
                const cols = Array.from(tr.querySelectorAll('td'));
                // agora esperamos pelo menos 15 colunas (adicionado Valor c/ IPI)
                if (!cols || cols.length < 15) return; // linha de aviso / não-produto
                const produto = cols[0]?.textContent?.trim() || '';
                const quantidade = cols[1]?.textContent?.trim() || '1';
                const ci = cols[2]?.textContent?.trim() || '';
                const taxa_roi = cols[3]?.textContent?.trim() || '';
                const vbase = cols[4]?.textContent?.trim() || '';
                const pis_cof = cols[5]?.textContent?.trim() || '';
                const icms = cols[6]?.textContent?.trim() || '';
                const valorSemIPI = cols[7]?.textContent?.trim() || '';
                const ipi = cols[8]?.textContent?.trim() || '';
                const valorComIPI = cols[9]?.textContent?.trim() || '';
                const com = cols[10]?.textContent?.trim() || '';
                const frete = cols[11]?.textContent?.trim() || '';
                const vfinal = cols[12]?.textContent?.trim() || '';
                const vtotal = cols[13]?.textContent?.trim() || '';
                const margem = cols[14]?.textContent?.trim() || '';
                rows.push([produto, '', '', ci, taxa_roi, '', vbase, '', '', icms, valorSemIPI, ipi, valorComIPI, com, frete, quantidade, vfinal, vtotal, margem]);
            });
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Preços Cliente');
        const nomeArquivo = `precos_${(cliente.nome||'cliente').replace(/[^a-z0-9\-]/gi,'_')}_${(cliente.uf||'XX')}_${(cliente.tipoPessoa||'PF')}_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(wb, nomeArquivo);
}

function imprimirPrecifCliente() {
    const select = document.getElementById('precifClienteSelect');
    const clienteId = select?.value;
    const cliente = (clientes || []).find(c => String(c.id) === String(clienteId));
    const nomeCliente = cliente ? cliente.nome : 'Cliente';
    const tabela = document.getElementById('tabelaPrecifClienteBody');
    const html = tabela ? tabela.closest('table')?.outerHTML || tabela.innerHTML : '';
    const win = window.open('', '_blank');
    if (!win) { mostrarNotificacao('Pop-up bloqueado pelo navegador.', 'error'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Precificação - ${_escapeHtml(nomeCliente)}</title>
        <style>
            body{font-family:Inter,Arial,sans-serif;padding:20px;font-size:11px}
            h2{font-size:14px;margin-bottom:8px}
            table{border-collapse:collapse;width:100%}
            th,td{border:1px solid #ddd;padding:5px 7px;text-align:right}
            th{background:#f5f5f5;font-weight:600;text-align:center}
            td:first-child{text-align:left}
            @media print{@page{margin:1cm}}
        </style>
        <script>window.onload=function(){ setTimeout(function(){ window.print(); },300); }<\/script>
    </head><body><h2>Precificação — ${_escapeHtml(nomeCliente)}</h2>${html}</body></html>`);
    win.document.close();
}

function limparFiltrosPrecifCliente() {
    try {
        const fp = document.getElementById('precifFiltroProduto'); if (fp) fp.value = '';
        const fn = document.getElementById('precifFiltroNCM'); if (fn) fn.value = '';
        const fci = document.getElementById('precifFiltroCI'); if (fci) fci.value = 'todos';
        calcularPrecificacaoPorCliente();
    } catch (e) { console.warn('limparFiltrosPrecifCliente', e); }
}

function salvarPrecificacaoCliente() {
    if (!ultimaPrecificacaoCalculada) {
        calcularPrecificacaoPorCliente();
        if (!ultimaPrecificacaoCalculada) { alert('Calcule a precificação antes de salvar.'); return; }
    }
    const cId = ultimaPrecificacaoCalculada.clienteId;
    // calcular próxima versão para este cliente
    const versoesDoCliente = (precificacoesCliente || []).filter(p => String(p.clienteId) === String(cId));
    const proximaVersao = versoesDoCliente.length + 1;
    const registro = JSON.parse(JSON.stringify(ultimaPrecificacaoCalculada));
    registro.id = Date.now().toString();
    registro.dataCriacao = new Date().toISOString();
    registro.versao = proximaVersao;
    const descricao = prompt(
        `Versão ${proximaVersao} — adicione uma descrição opcional:\n` +
        `(Ex: "Negociação inicial", "Após desconto", "Preços reajustados")`
    ) || '';
    registro.descricao = descricao;
    registro.status = 'ativa';
    registro.propostaId = null;
    /*
    IMPORTANT: itens[].ci is the CI value frozen at save time.
    Future changes to precificacao[nome].ci do NOT affect this saved pricing.
    To recalculate with updated CI, the user must run a new calculation
    and save again — this will create a new version, not update the old one.
    */
    // Snapshot de RETID e benefícios no momento do salvamento
    try { registro.retidPorProduto = JSON.parse(JSON.stringify(retidPorProduto || {})); } catch (e) { registro.retidPorProduto = {}; }
    registro.beneficioFiscalAtivo = !!beneficioFiscalAtivo;
    try { registro.beneficiosPorProduto = JSON.parse(JSON.stringify(beneficiosPorProduto || {})); } catch (e) { registro.beneficiosPorProduto = {}; }
    // validade da precificação (dias) e data de expiração
    const validadeBruta = parseInt(document.getElementById('precifValidadeDias')?.value || 30, 10);
    const validadeDias = Number.isFinite(validadeBruta) ? Math.max(1, Math.min(365, validadeBruta)) : 30;
    registro.validadeDias = validadeDias;
    registro.dataExpiracao = new Date(Date.now() + validadeDias * 86400000).toISOString();
    // Garantir compatibilidade de campos de UF/representante
    try { registro.clienteUF = registro.clienteUF || registro.uf || (document.getElementById('precifClienteUF')?.value || ''); } catch (e) {}
    try { registro.uf = registro.uf || registro.clienteUF || (document.getElementById('precifClienteUF')?.value || ''); } catch (e) {}
    try { registro.representante = registro.representante || (document.getElementById('precifRepresentanteSelect')?.value || ''); } catch (e) {}
    try { console.log('salvarPrecificacaoCliente -> registro.representante:', registro.representante); console.log('salvarPrecificacaoCliente -> registro summary:', { id: registro.id, clienteId: registro.clienteId, versao: registro.versao, representante: registro.representante, itensCount: (registro.itens||[]).length }); } catch (e) {}
    precificacoesCliente.push(registro);
    try { console.log('precificacoesCliente pushed. last item:', precificacoesCliente[precificacoesCliente.length-1] || null); } catch (e) {}
    ultimaVersaoSalva = proximaVersao;
    try { estoque.precificacoesCliente = precificacoesCliente; } catch (e) {}
    salvarDados();
    try { atualizarIndicadoresPrecificacao(); } catch (e) {}
    const infoEl = document.getElementById('precifSalvoInfo');
    if (infoEl) infoEl.innerHTML = `<span style="color:#16a34a; font-size:0.82rem">✅ Precificação salva v${registro.versao} em ${new Date(registro.dataCriacao).toLocaleString('pt-BR')}</span> <button onclick="carregarVersaoPrecif('${registro.id}')" class="btn btn-outline btn-sm" style="margin-left:8px">↩ Carregar versão</button> <button onclick="renderizarHistoricoPrecif('${cId}')" class="btn btn-outline btn-sm" style="margin-left:8px">🕘 Histórico</button>`;
    mostrarNotificacao('Precificação salva para o cliente.', 'success');
    try { renderizarHistoricoPrecif(cId); } catch (e) {}
    try {
        const consultaEl = document.getElementById('subaba-precif-consulta');
        const rastreaEl = document.getElementById('subaba-precif-rastreabilidade');
        const isConsultaVis = consultaEl ? consultaEl.style.display !== 'none' : false;
        const isRastreaVis  = rastreaEl ? rastreaEl.style.display !== 'none' : false;
        if (isConsultaVis && typeof renderizarConsultaPrecificacao === 'function') renderizarConsultaPrecificacao();
        if (isRastreaVis && typeof renderizarRastreabilidade === 'function') renderizarRastreabilidade();
    } catch (e) {}
    try { if (typeof _cpPopularFiltroCliente === 'function') _cpPopularFiltroCliente(); filtrarConsultaPrecificacoes(); } catch (e) {}
}

function carregarPrecificacaoSalva(clienteId) {
    try {
        const registro = obterUltimaPrecificacaoCliente(clienteId);
        if (!registro) { mostrarNotificacao('Nenhuma precificação salva para este cliente.', 'warning'); return; }
        aplicarEstadoPrecificacaoSalva(registro);
        const infoEl = document.getElementById('precifSalvoInfo'); if (infoEl) infoEl.innerHTML = `<span style="color:#16a34a; font-size:0.82rem">Usando precificação salva v${registro.versao} em ${new Date(registro.dataCriacao).toLocaleString('pt-BR')}</span>`;
        mostrarNotificacao('Precificação carregada.', 'success');
    } catch (e) { console.error('carregarPrecificacaoSalva', e); mostrarNotificacao('Erro ao carregar precificação salva.', 'error'); }
}

function criarPropostaDaPrecificacao() {
    // Avisar se a precificação ativa para este cliente estiver expirada
    try {
        const precifAtiva = (precificacoesCliente || []).find(p =>
            String(p.clienteId) === String(ultimaPrecificacaoCalculada?.clienteId) &&
            p.status === 'ativa'
        );
        if (precifAtiva?.dataExpiracao) {
            const exp = new Date(precifAtiva.dataExpiracao);
            if (exp < new Date()) {
                const ok = confirm(
                    `⚠️ A precificação salva expirou em ${exp.toLocaleDateString('pt-BR')}.\n\n` +
                    `Deseja gerar a proposta mesmo assim com valores desatualizados?\n` +
                    `(Recomendado: cancele e recalcule)`
                );
                if (!ok) return;
            }
        }
    } catch (e) {}

    // Bloquear geração de proposta a partir de versão arquivada (quando o usuário carregou uma versão salva)
    try {
        if (exibindoPrecifSalva && precifSalvaCarregada && String(precifSalvaCarregada.status) === 'arquivada') {
            alert('Esta versão de precificação está arquivada e não pode ser usada para gerar propostas. Reative ou carregue outra versão.');
            return;
        }
    } catch (e) {}

    if (!ultimaPrecificacaoCalculada) {
        alert('Calcule ou carregue uma precificação antes de gerar proposta.');
        return;
    }
    const abaixoMinimo = (ultimaPrecificacaoCalculada?.itens || []).filter(item => {
        const mm = precificacao[item.produto]?.margemMinima;
        return mm && item.margem < mm;
    });
    if (abaixoMinimo.length > 0) {
        const lista = abaixoMinimo
            .map(i => `• ${i.produto}: ${i.margem.toFixed(1)}% (mín: ${precificacao[i.produto].margemMinima}%)`)
            .join('\n');
        if (!confirm(
            `⚠️ ${abaixoMinimo.length} produto(s) abaixo da margem mínima:\n\n${lista}\n\n` +
            `Deseja gerar a proposta mesmo assim?`
        )) return;
    }
    const reg = ultimaPrecificacaoCalculada;
    const clienteObj = (clientes || []).find(c => String(c.id) === String(reg.clienteId));
    const retidMap = (reg && reg.retidPorProduto && Object.keys(reg.retidPorProduto).length) ? reg.retidPorProduto : (retidPorProduto || {});
    const benefMap = (reg && reg.beneficiosPorProduto) ? reg.beneficiosPorProduto : (beneficiosPorProduto || {});
    const benefAtivo = (reg && reg.beneficioFiscalAtivo) || !!beneficioFiscalAtivo;
    const items = (reg.itens || []).map(it => ({ produto: it.produto, produtoId: it.produtoId, quantidade: 1, valorUnitario: Number(it.precoFinal || 0), retid: !!(retidMap[it.produto]) }));
    const valorTotal = items.reduce((s, it) => s + (Number(it.valorUnitario || 0) * (it.quantidade || 1)), 0);
    const nova = {
        id: 'prop-' + Date.now(),
        numero: gerarNumeroProposta(),
        cliente: clienteObj ? clienteObj.nome : (reg.clienteNome || ''),
        representante: clienteObj ? (clienteObj.representante || '') : '',
        data: new Date().toISOString(),
        validade: 30,
        status: 'rascunho',
        itens: items.map(it => ({ produtoId: it.produtoId, produto: it.produto, quantidade: it.quantidade, valorUnitario: it.valorUnitario, retid: !!it.retid })),
        valorTotal
    };
    // adicionar resumo de benefícios na observação da proposta
    try {
        const benefSummary = [];
        if (Object.values(retidMap || {}).some(v => v)) benefSummary.push('RETID aplicado em produtos selecionados');
        if (benefAtivo && Object.keys(benefMap || {}).length) benefSummary.push('Benefícios fiscais aplicados');
        if (benefSummary.length) nova.observacoes = (nova.observacoes || '') + ' | ' + benefSummary.join(', ');
    } catch (e) {}
    propostas.push(nova);
    estoque.propostas = propostas;
    salvarDados();
    renderizarPropostas();
    atualizarKPIsPropostas();
    mostrarNotificacao('Proposta criada a partir da precificação. Abra para editar.', 'success');
    abrirModalProposta(nova.id);
    try {
        if (ultimaVersaoSalva) {
            const precifAtual = (precificacoesCliente || []).find(p => String(p.clienteId) === String(reg.clienteId) && Number(p.versao) === Number(ultimaVersaoSalva));
            if (precifAtual) {
                precifAtual.status = 'convertida';
                precifAtual.propostaId = nova.id;
                try { estoque.precificacoesCliente = precificacoesCliente; } catch (e) {}
                salvarDados();
                try { renderizarHistoricoPrecif(reg.clienteId); } catch(e) {}
            }
        }
    } catch (e) {}
    try { atualizarStatusPropostaNaPrecif(reg.clienteId); } catch (e) {}
}

// ====== Helpers: RETID e Benefícios Fiscais ======

// ===== Histórico de precificações por cliente =====
function renderizarHistoricoPrecif(clienteId) {
        const versoes = (precificacoesCliente || [])
                .filter(p => String(p.clienteId) === String(clienteId))
                .sort((a,b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));
        if (!versoes.length) {
                const painel = document.getElementById('painelHistoricoPrecif'); if (painel) painel.style.display = 'none';
                return;
        }
        const statusColor = { ativa:'#16a34a', arquivada:'#94a3b8', convertida:'#0ea5e9', expirada:'#dc2626' };
        const statusLabel = { ativa:'Ativa', arquivada:'Arquivada', convertida:'Convertida', expirada:'Expirada' };
        const listaEl = document.getElementById('listaHistoricoPrecif');
        if (!listaEl) return;
        const rowsHtml = (versoes || []).map(v => {
            const agora = new Date();
            const exp = v.dataExpiracao ? new Date(v.dataExpiracao) : null;
            const dias = exp ? Math.ceil((exp - agora) / 86400000) : null;
            let expCell = '—';
            if (exp) {
                if (dias < 0) {
                    expCell = `<span style="color:#dc2626;font-size:0.78rem;font-weight:600">Expirada</span>`;
                } else if (dias <= 5) {
                    expCell = `<span style="color:#d97706;font-size:0.78rem;font-weight:600">⚠️ ${dias}d restantes</span>`;
                } else {
                    expCell = `<span style="color:#64748b;font-size:0.78rem">${exp.toLocaleDateString('pt-BR')} (${dias}d)</span>`;
                }
            }

            // Formatar Taxa/ROI com fallback seguro
            const taxaVal = Number(v.taxa ?? (Array.isArray(v.itens) && v.itens[0] && (v.itens[0].taxa ?? v.itens[0].taxa)) ?? 0) || 0;
            const roiVal = Number(v.roi ?? (Array.isArray(v.itens) && v.itens[0] && (v.itens[0].roi ?? v.itens[0].roi)) ?? 0) || 0;
            const taxaHtml = (typeof _cpPct === 'function') ? _cpPct(taxaVal) : (taxaVal.toFixed(2) + '%');
            const roiHtml = (typeof _cpPct === 'function') ? _cpPct(roiVal) : (roiVal.toFixed(2) + '%');

            // Resumo de produtos: mostrar até 2 produtos com quantidade, unitário e total
            const produtos = Array.isArray(v.itens) ? v.itens : [];
            let produtosSummaryHtml = '';
            if (!produtos.length) {
                produtosSummaryHtml = '—';
            } else {
                const toShow = produtos.slice(0, 2);
                produtosSummaryHtml = toShow.map(p => {
                    const nome = p.produto || p.produtoNome || '';
                    const qtd = Number(p.quantidade || p.qtd || 1) || 1;
                    const unit = Number(p.precoFinal || p.valorFinal || p.preco || p.precoUnitario || 0) || 0;
                    const total = Number(p.valorTotal || (unit * qtd) + (Number(p.frete || 0) || 0)) || (unit * qtd);
                    return `<div style="text-align:left; margin-bottom:6px"><div style="font-weight:600;color:#0f172a">${_escapeHtml(nome)}</div><div style="font-size:0.82rem;color:#64748b">Qtd: ${qtd} • Unit: ${_cpFmt(unit)} • Total: ${_cpFmt(total)}</div></div>`;
                }).join('');
                if (produtos.length > 2) produtosSummaryHtml += `<div style="font-size:0.82rem;color:#64748b">+${produtos.length - 2} outro(s)</div>`;
            }

            return `
                        <tr>
                            <td style="font-weight:700; color:#1e3a5f; text-align:center">v${v.versao}</td>
                            <td>${new Date(v.dataCriacao).toLocaleDateString('pt-BR')}</td>
                            <td style="color:#475569">${v.descricao || '<span style="color:#94a3b8">—</span>'}</td>
                            <td style="text-align:center">${taxaHtml}</td>
                            <td style="text-align:center">${roiHtml}</td>
                            <td style="text-align:left; max-width:320px">${produtosSummaryHtml}</td>
                            <td style="text-align:center"><span style="background:${statusColor[v.status]}20; color:${statusColor[v.status]}; font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:20px">${statusLabel[v.status] || v.status}</span></td>
                            <td style="text-align:center">${expCell}</td>
                            <td style="text-align:center">${v.propostaId ? `<span style="color:#0ea5e9; font-size:0.75rem">${(propostas.find(p=>p.id===v.propostaId)?.numero)||'—'}</span>` : '—'}</td>
                            <td style="text-align:center">
                                <button onclick="carregarVersaoPrecif('${v.id}')" class="btn btn-outline btn-sm" title="Carregar esta versão">↩ Carregar</button>
                                <button onclick="visualizarPrecificacao('${v.id}')" class="btn btn-outline btn-sm" title="Ver detalhado" style="margin-left:6px">👁️ Ver</button>
                                <button onclick="arquivarVersaoPrecif('${v.id}')" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:0.9rem;margin-left:6px" title="Arquivar">📦</button>
                                <button onclick="excluirVersaoPrecif('${v.id}')" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:0.9rem;margin-left:6px" title="Excluir">🗑️</button>
                            </td>
                        </tr>
                    `;
        }).join('');
        listaEl.innerHTML = `
        <div class="table-wrapper">
            <table class="dashboard-table" style="font-size:0.82rem">
                <thead>
                    <tr>
                        <th>Versão</th>
                        <th>Data</th>
                        <th>Descrição</th>
                        <th>Taxa</th>
                        <th>ROI</th>
                        <th>Produtos</th>
                        <th>Status</th>
                        <th>Expira em</th>
                        <th>Proposta</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        </div>
        `;
        const painel = document.getElementById('painelHistoricoPrecif'); if (painel) painel.style.display = 'block';
}

// Modal: visualizar precificação completa (taxas, impostos, valores)
function visualizarPrecificacao(id) {
    try {
        const registro = (precificacoesCliente || []).find(p => p.id === id);
        if (!registro) { mostrarNotificacao && mostrarNotificacao('Precificação não encontrada.', 'warning'); return; }

        // remover modal anterior se existir
        const old = document.getElementById('modalVisualizarPrecificacao'); if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = 'modalVisualizarPrecificacao';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;padding:20px;z-index:99999';

        const box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:10px;max-width:1100px;width:100%;max-height:90vh;overflow:auto;padding:18px;box-shadow:0 10px 30px rgba(2,6,23,0.15);';

        const headerHtml = `<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
            <div style="font-weight:700;font-size:1.05rem">Precificação v${registro.versao} — ${_escapeHtml(registro.clienteNome || registro.cliente || '')}</div>
            <div style="margin-left:auto;display:flex;gap:8px">
                <button class="btn btn-outline btn-sm" onclick="carregarVersaoPrecif('${registro.id}')">↩ Carregar</button>
                <button class="btn btn-outline btn-sm" id="modalVisualizarClose">Fechar</button>
            </div>
        </div>`;

        let tableHtml = `
            <div style="font-size:0.9rem;color:#64748b;margin-bottom:8px">Descrição: ${_escapeHtml(registro.descricao || '')}</div>
            <table class="dashboard-table" style="width:100%;font-size:0.88rem;">
                <thead>
                    <tr>
                        <th>Produto</th>
                        <th>Qtd</th>
                        <th>CI</th>
                        <th>Taxa %</th>
                        <th>ROI %</th>
                        <th>Valor Base</th>
                        <th>PIS %</th>
                        <th>PIS R$</th>
                        <th>COFINS %</th>
                        <th>COFINS R$</th>
                        <th>ICMS %</th>
                        <th>ICMS R$</th>
                        <th>Valor s/ IPI</th>
                        <th>IPI %</th>
                        <th>IPI R$</th>
                        <th>Comissão %</th>
                        <th>Comissão R$</th>
                        <th>Frete R$</th>
                        <th>Valor Unit.</th>
                        <th>Valor Total</th>
                        <th>Margem %</th>
                    </tr>
                </thead>
                <tbody>`;

        const itens = Array.isArray(registro.itens) ? registro.itens : [];
        itens.forEach(it => {
            const qtd = Number(it.quantidade || it.qtd || 1) || 1;
            const ci = Number(it.ci || 0) || 0;
            const taxa = Number(it.taxa || 0) || 0;
            const roi = Number(it.roi || 0) || 0;
            const valorBase = Number(it.valorBase || 0) || 0;
            const pis = Number(it.pis || 0) || 0;
            const pisR = Number(it.pisR || 0) || 0;
            const cofins = Number(it.cofins || 0) || 0;
            const cofinsR = Number(it.cofinsR || 0) || 0;
            const icms = Number(it.icms || 0) || 0;
            const icmsR = Number(it.icmsR || 0) || 0;
            const valorSemIPI = Number(it.valorSemIPI || it.valorImpostos || 0) || 0;
            const ipi = Number(it.ipi || 0) || 0;
            const ipiR = Number(it.ipiR || 0) || 0;
            const comissao = Number(it.comissao || 0) || 0;
            const comissaoR = Number(it.comissaoR || 0) || 0;
            const frete = Number(it.frete || 0) || 0;
            const unit = Number(it.precoFinal || it.valorFinal || it.preco || 0) || 0;
            const total = Number(it.valorTotal || (unit * qtd) + frete) || (unit * qtd);
            const margem = Number(it.margem || 0) || 0;

            tableHtml += `<tr>
                <td style="text-align:left">${_escapeHtml(it.produto || it.produtoNome || '')}</td>
                <td style="text-align:center">${qtd}</td>
                <td style="text-align:right">${_fmtMoeda(ci)}</td>
                <td style="text-align:center">${_cpPct(taxa)}</td>
                <td style="text-align:center">${_cpPct(roi)}</td>
                <td style="text-align:right">${_cpFmt(valorBase)}</td>
                <td style="text-align:center">${_cpPct(pis)}</td>
                <td style="text-align:right">${_cpFmt(pisR)}</td>
                <td style="text-align:center">${_cpPct(cofins)}</td>
                <td style="text-align:right">${_cpFmt(cofinsR)}</td>
                <td style="text-align:center">${_cpPct(icms)}</td>
                <td style="text-align:right">${_cpFmt(icmsR)}</td>
                <td style="text-align:right">${_cpFmt(valorSemIPI)}</td>
                <td style="text-align:center">${_cpPct(ipi)}</td>
                <td style="text-align:right">${_cpFmt(ipiR)}</td>
                <td style="text-align:center">${_cpPct(comissao)}</td>
                <td style="text-align:right">${_cpFmt(comissaoR)}</td>
                <td style="text-align:right">${_cpFmt(frete)}</td>
                <td style="text-align:right">${_cpFmt(unit)}</td>
                <td style="text-align:right">${_cpFmt(total)}</td>
                <td style="text-align:center">${_cpPct(margem)}</td>
            </tr>`;
        });

        tableHtml += `</tbody></table>`;

        box.innerHTML = headerHtml + tableHtml;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        // fechar
        const btnClose = document.getElementById('modalVisualizarClose'); if (btnClose) btnClose.addEventListener('click', () => overlay.remove());

    } catch (e) { console.error('visualizarPrecificacao erro:', e); mostrarNotificacao && mostrarNotificacao('Falha ao abrir visualização.', 'error'); }
}

function toggleHistoricoPrecif() {
        const lista = document.getElementById('listaHistoricoPrecif');
        if (!lista) return;
        lista.style.display = lista.style.display === 'none' ? 'block' : 'none';
}

function carregarVersaoPrecif(id) {
        const v = (precificacoesCliente || []).find(p => p.id === id);
        if (!v) return;
    aplicarEstadoPrecificacaoSalva(v);
    const infoEl = document.getElementById('precifSalvoInfo'); if (infoEl) infoEl.innerHTML = `<span style="color:#16a34a; font-size:0.82rem">Usando versão v${v.versao} de ${new Date(v.dataCriacao).toLocaleString('pt-BR')}</span>`;
    mostrarNotificacao('Versão carregada.', 'success');
                try { atualizarStatusPropostaNaPrecif(v.clienteId); } catch(e) { console.warn('Erro ao atualizar status da proposta:', e); }
}

function arquivarVersaoPrecif(id) {
    try {
        const v = (precificacoesCliente || []).find(p => p.id === id);
        if (!v) return;
        if (!confirm(`Arquivar versão v${v.versao}?\nEla ficará visível no histórico mas não poderá ser usada para novas propostas.`)) return;
        v.status = 'arquivada';
        try { estoque.precificacoesCliente = precificacoesCliente; } catch (e) {}
        salvarDados();
        try { renderizarHistoricoPrecif(v.clienteId); } catch (e) {}
        try { mostrarNotificacao && mostrarNotificacao('Versão arquivada.', 'success'); } catch (e) {}
    } catch (e) { console.error('arquivarVersaoPrecif erro:', e); }
}

function excluirVersaoPrecif(id) {
    try {
        const v = (precificacoesCliente || []).find(p => p.id === id);
        if (!v) return;
        if (v.propostaId) {
            alert('Esta precificação gerou uma proposta e não pode ser excluída.\nArquive-a se quiser ocultá-la.');
            return;
        }
        if (!confirm(`Excluir versão v${v.versao} permanentemente?`)) return;
        precificacoesCliente = (precificacoesCliente || []).filter(p => p.id !== id);
        try { estoque.precificacoesCliente = precificacoesCliente; } catch (e) {}
        salvarDados();
        try { renderizarHistoricoPrecif(v.clienteId); } catch (e) {}
        try { mostrarNotificacao && mostrarNotificacao('Versão excluída.', 'success'); } catch (e) {}
    } catch (e) { console.error('excluirVersaoPrecif erro:', e); }
}


function atualizarStatusPropostaNaPrecif(clienteId) {
        try {
                const clienteNome = (clientes || []).find(c => String(c.id) === String(clienteId))?.nome;
        const propostasDoCliente = (propostas || [])
            .filter(p => p.cliente === clienteNome)
            .sort((a,b) => new Date((b.dataCriacao||b.data||0)) - new Date((a.dataCriacao||a.data||0)));
                const container = document.getElementById('precifStatusProposta');
                if (!container) return;
        if (!propostasDoCliente.length) { container.innerHTML = ''; return; }
                const statusColor = {
                        rascunho:  { bg:'#f1f5f9', text:'#64748b', icon:'📝' },
                        enviada:   { bg:'#eff6ff', text:'#1d4ed8', icon:'📤' },
                        aceita:    { bg:'#f0fdf4', text:'#166534', icon:'✅' },
                        recusada:  { bg:'#fef2f2', text:'#dc2626', icon:'❌' },
                        expirada:  { bg:'#fff8f0', text:'#d97706', icon:'⏰' }
                };
                const ultima = propostasDoCliente[0];
                const sc = statusColor[ultima.status] || statusColor.rascunho;
                const fmt = v => 'R$ ' + (v || 0).toLocaleString('pt-BR',{minimumFractionDigits:2});
                container.innerHTML = `
        <div style="background:${sc.bg};border-radius:8px;padding:10px 14px;
                    display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span style="font-size:1.1rem">${sc.icon}</span>
            <div>
                <div style="font-size:0.75rem;color:#64748b;text-transform:uppercase;
                            letter-spacing:0.5px">Última proposta</div>
                <div style="font-weight:700;color:${sc.text};font-size:0.9rem">
                    ${ultima.numero} — ${String(ultima.status || '').toUpperCase()}
                </div>
            </div>
            <div>
                <div style="font-size:0.75rem;color:#64748b">Data</div>
                <div style="font-size:0.85rem;color:#1e293b">
                    ${new Date(ultima.dataCriacao||ultima.data||new Date()).toLocaleDateString('pt-BR')}
                </div>
            </div>
            <div>
                <div style="font-size:0.75rem;color:#64748b">Valor</div>
                <div style="font-size:0.85rem;font-weight:600;color:#16a34a">
                    ${fmt(ultima.valorTotal)}
                </div>
            </div>
            ${propostasDoCliente.length > 1
                ? `<div style="font-size:0.78rem;color:#64748b">
                     +${propostasDoCliente.length-1} proposta(s) anterior(es)
                   </div>` : ''}
            <div style="margin-left:auto;display:flex;gap:6px">
                <button class="btn btn-outline btn-sm" onclick="trocarAba('propostas')">
                    Ver propostas →
                </button>
                ${ultima.status === 'aceita'
                    ? `<button class="btn btn-success btn-sm"
                               onclick="converterPropostaEmVenda('${ultima.id}')">
                         📄 Gerar Contrato
                       </button>` : ''}
            </div>
        </div>
        ${propostasDoCliente.length > 1 ? `
            <details style="margin-top:6px">
                <summary style="font-size:0.8rem;color:#64748b;cursor:pointer;padding:4px 0">
                    Ver histórico completo (${propostasDoCliente.length})
                </summary>
                <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
                    ${propostasDoCliente.map(p => {
                        const s = statusColor[p.status] || statusColor.rascunho;
                        return `
                            <div style="display:flex;align-items:center;gap:10px;
                                        padding:6px 10px;background:#f8fafc;
                                        border-radius:6px;font-size:0.82rem">
                                <span>${s.icon}</span>
                                <span style="font-weight:600; color:#1e3a5f">${p.numero}</span>
                                <span style="color:${s.text}; font-weight:500">${p.status}</span>
                                <span style="color:#64748b">
                                    ${new Date(p.dataCriacao||p.data||new Date()).toLocaleDateString('pt-BR')}
                                </span>
                                <span style="color:#16a34a;margin-left:auto;font-weight:600">
                                    ${fmt(p.valorTotal)}
                                </span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </details>
        ` : ''}
    `;
        } catch (e) { console.warn('atualizarStatusPropostaNaPrecif', e); }
}
// ====== Helpers: RETID e Benefícios Fiscais ======
function resolverAliquota(nomeProduto, campo, valorPadrao) {
    try {
        // 1) isentoTotal em benefícios
        if (beneficioFiscalAtivo && beneficiosPorProduto && beneficiosPorProduto[nomeProduto] && beneficiosPorProduto[nomeProduto].isentoTotal) return 0;
        // 2) RETID zera apenas impostos federais (não ICMS)
        if (retidPorProduto && retidPorProduto[nomeProduto] && campo !== 'icms') return 0;
        // 3) override explícito por produto
        if (beneficioFiscalAtivo && beneficiosPorProduto && beneficiosPorProduto[nomeProduto]) {
            const override = beneficiosPorProduto[nomeProduto][campo];
            if (override !== null && override !== undefined && override !== '') return Number(override);
        }
    } catch (e) {}
    return Number(valorPadrao || 0);
}

function toggleRetid(nomeProduto, ativo) {
    try {
        retidPorProduto = retidPorProduto || {};
        retidPorProduto[nomeProduto] = !!ativo;
        const nomeId = (nomeProduto || '').replace(/[^a-z0-9]/gi, '_');
        const cb = document.getElementById('retid_' + nomeId); if (cb) cb.checked = !!ativo;
    } catch (e) { console.warn('toggleRetid', e); }
    try { recalcularLinhaPrecifCliente(nomeProduto); } catch (e) { calcularPrecificacaoPorCliente(); }
}

 

function toggleBeneficioFiscal(ativo) {
    beneficioFiscalAtivo = !!ativo;
    const painel = document.getElementById('painelBeneficioFiscal'); if (painel) painel.style.display = beneficioFiscalAtivo ? 'block' : 'none';
    if (beneficioFiscalAtivo) renderizarTabelaBeneficios();
}

function renderizarTabelaBeneficios() {
    const tbody = document.getElementById('tabelaBeneficioFiscalBody');
    if (!tbody) return;
    const produtos = estoque.produtos || [];
    tbody.innerHTML = produtos.map(p => {
        const nome = p.nome || '';
        const nomeId = (nome || '').replace(/[^a-z0-9]/gi, '_');
        const b = beneficiosPorProduto[nome] || { pis:null, cofins:null, ipi:null, icms:null, isentoTotal:false };
        const retChecked = retidPorProduto[nome] ? 'checked' : '';
        const isentoChecked = b.isentoTotal ? 'checked' : '';
        return `
            <tr>
              <td style="padding:6px 10px; font-weight:500">${_escapeHtml(nome)}</td>
              <td style="padding:4px 6px; text-align:center"><input type="number" step="0.01" min="0" max="100" id="bpis_${nomeId}" value="${b.pis ?? ''}" placeholder="padrão" onchange="atualizarBeneficio('${nome}','pis',this.value)" style="width:70px; border:1px solid #fed7aa; border-radius:4px; padding:3px 4px; text-align:center; font-size:0.82rem"></td>
              <td style="padding:4px 6px; text-align:center"><input type="number" step="0.01" min="0" max="100" id="bcofins_${nomeId}" value="${b.cofins ?? ''}" placeholder="padrão" onchange="atualizarBeneficio('${nome}','cofins',this.value)" style="width:70px; border:1px solid #fed7aa; border-radius:4px; padding:3px 4px; text-align:center; font-size:0.82rem"></td>
              <td style="padding:4px 6px; text-align:center"><input type="number" step="0.01" min="0" max="100" id="bipi_${nomeId}" value="${b.ipi ?? ''}" placeholder="padrão" onchange="atualizarBeneficio('${nome}','ipi',this.value)" style="width:70px; border:1px solid #fed7aa; border-radius:4px; padding:3px 4px; text-align:center; font-size:0.82rem"></td>
              <td style="padding:4px 6px; text-align:center"><input type="number" step="0.01" min="0" max="100" id="bicms_${nomeId}" value="${b.icms ?? ''}" placeholder="padrão" onchange="atualizarBeneficio('${nome}','icms',this.value)" style="width:70px; border:1px solid #fed7aa; border-radius:4px; padding:3px 4px; text-align:center; font-size:0.82rem"></td>
              <td style="padding:4px 6px; text-align:center"><input type="checkbox" id="bretid_${nomeId}" ${retChecked} onchange="atualizarBeneficio('${nome}','retid',this.checked)" style="width:16px; height:16px; accent-color:#1e3a5f"></td>
              <td style="padding:4px 6px; text-align:center"><input type="checkbox" id="bisento_${nomeId}" ${isentoChecked} onchange="atualizarBeneficio('${nome}','isentoTotal',this.checked)" style="width:16px; height:16px; accent-color:#dc2626"></td>
            </tr>
        `;
    }).join('');
}

function atualizarBeneficio(nomeProduto, campo, valor) {
    if (!beneficiosPorProduto[nomeProduto]) {
        beneficiosPorProduto[nomeProduto] = { pis:null, cofins:null, ipi:null, icms:null, isentoTotal:false };
    }
    if (campo === 'retid') {
        retidPorProduto[nomeProduto] = !!valor;
        try { recalcularLinhaPrecifCliente(nomeProduto); } catch (e) { calcularPrecificacaoPorCliente(); }
        return;
    }
    if (campo === 'isentoTotal') {
        beneficiosPorProduto[nomeProduto].isentoTotal = !!valor;
        if (valor) {
            ['pis','cofins','ipi','icms'].forEach(t => {
                beneficiosPorProduto[nomeProduto][t] = 0;
                const el = document.getElementById('b' + t + '_' + (nomeProduto || '').replace(/[^a-z0-9]/gi, '_'));
                if (el) { el.value = '0'; el.disabled = true; }
            });
        } else {
            ['pis','cofins','ipi','icms'].forEach(t => {
                beneficiosPorProduto[nomeProduto][t] = null;
                const el = document.getElementById('b' + t + '_' + (nomeProduto || '').replace(/[^a-z0-9]/gi, '_'));
                if (el) { el.value = ''; el.disabled = false; }
            });
        }
        try { recalcularLinhaPrecifCliente(nomeProduto); } catch (e) { calcularPrecificacaoPorCliente(); }
        return;
    }
    // numeric overrides
    beneficiosPorProduto[nomeProduto][campo] = (valor === '' || valor === null) ? null : parseFloat(valor);
    try { recalcularLinhaPrecifCliente(nomeProduto); } catch (e) { calcularPrecificacaoPorCliente(); }
}

function isentarTodosProdutos() {
    const produtos = estoque.produtos || [];
    produtos.forEach(p => {
        beneficiosPorProduto[p.nome] = { pis:0, cofins:0, ipi:0, icms:0, isentoTotal:true };
        retidPorProduto[p.nome] = true;
    });
    renderizarTabelaBeneficios();
}

function limparBeneficios() {
    beneficiosPorProduto = {};
    retidPorProduto = {};
    renderizarTabelaBeneficios();
}

// ── FEDERAL TAXES EDITING (mutable, persisted) ──────────────────
let impostosEditaveis = {};

function inicializarImpostosEditaveis() {
    const defaults = {
        "9301.90.00": { descricao: "Fuzil de assalto IMBEL", pis:1.65, cofins:7.60, ipi:55.00 },
        "9305.91.00": { descricao: "Partes de armas de guerra 93.01", pis:1.65, cofins:7.60, ipi:0.00 },
        "9302.00.00": { descricao: "Revólveres e pistolas", pis:1.65, cofins:7.60, ipi:55.00 },
        "9305.10.00": { descricao: "Partes de revólveres ou pistolas", pis:1.65, cofins:7.60, ipi:29.25 },
        "8211.10.00": { descricao: "Faca", pis:1.65, cofins:7.60, ipi:7.80 },
        "8201.40.00": { descricao: "Machadinha", pis:1.65, cofins:7.60, ipi:0.00 }
    };
    Object.entries(defaults).forEach(([ncm, vals]) => {
        if (!impostosEditaveis[ncm]) impostosEditaveis[ncm] = { ...vals };
    });
}

function renderizarImpostosFederais() {
    inicializarImpostosEditaveis();
    const tbody = document.getElementById('tabelaImpostosFederaisBody');
    if (!tbody) return;
    const produtos = estoque.produtos || [];
    const entries = Object.entries(impostosEditaveis);
    tbody.innerHTML = entries.map(([ncm, imp]) => {
        const vinculados = produtos.filter(p => (p.ncm || detectarNCM(p.nome)) === ncm).length;
        const idSafe = ncm.replace(/\./g,'_');
        return `
            <tr id="row-fed-${idSafe}">
                <td style="text-align:left; padding-left:15px; font-weight:600; font-family:monospace; color:#1e3a5f">${ncm}</td>
                <td style="text-align:left">
                    <input type="text" value="${(imp.descricao||'')}" onchange="editarImpostoFederal('${ncm}','descricao',this.value)" style="width:100%; border:1px solid transparent; border-radius:4px; padding:4px 6px; font-size:0.85rem; background:transparent" onfocus="this.style.borderColor='#1e3a5f'" onblur="this.style.borderColor='transparent'">
                </td>
                <td>
                    <input type="number" step="0.01" min="0" max="100" value="${imp.pis}" onchange="editarImpostoFederal('${ncm}','pis',this.value)" style="width:70px; border:1px solid #e2e8f0; border-radius:4px; padding:4px 6px; text-align:center; font-size:0.85rem">
                </td>
                <td>
                    <input type="number" step="0.01" min="0" max="100" value="${imp.cofins}" onchange="editarImpostoFederal('${ncm}','cofins',this.value)" style="width:70px; border:1px solid #e2e8f0; border-radius:4px; padding:4px 6px; text-align:center; font-size:0.85rem">
                </td>
                <td>
                    <input type="number" step="0.01" min="0" max="100" value="${imp.ipi}" onchange="editarImpostoFederal('${ncm}','ipi',this.value)" style="width:70px; border:1px solid #e2e8f0; border-radius:4px; padding:4px 6px; text-align:center; font-size:0.85rem">
                </td>
                <td style="text-align:center">
                    <span style="background:#e0f2fe; color:#0369a1; font-size:0.75rem; font-weight:600; padding:2px 8px; border-radius:20px">${vinculados} produto(s)</span>
                </td>
                <td style="text-align:center">
                    <button onclick="excluirNCM('${ncm}')" style="background:none; border:none; cursor:pointer; color:#dc2626; font-size:1rem" title="Excluir NCM">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function editarImpostoFederal(ncm, campo, valor) {
    if (!impostosEditaveis[ncm]) return;
    impostosEditaveis[ncm][campo] = campo === 'descricao' ? String(valor) : (parseFloat(valor) || 0);
    // Propagate to tabelaAliquotas for all products with this NCM
    const produtos = estoque.produtos || [];
    produtos.forEach(p => {
        if ((p.ncm || detectarNCM(p.nome)) === ncm) {
            if (!tabelaAliquotas[p.nome]) tabelaAliquotas[p.nome] = {};
            if (campo !== 'descricao') tabelaAliquotas[p.nome][campo] = impostosEditaveis[ncm][campo];
        }
    });
    salvarDados();
}

function adicionarNCM() {
    const ncm = prompt('Digite o código NCM (ex: 9302.00.00):');
    if (!ncm || ncm.trim() === '') return;
    const ncmLimpo = ncm.trim();
    if (impostosEditaveis[ncmLimpo]) { alert('NCM já existe.'); return; }
    impostosEditaveis[ncmLimpo] = { descricao: 'Novo NCM', pis:1.65, cofins:7.60, ipi:0 };
    renderizarImpostosFederais();
    salvarDados();
}

function excluirNCM(ncm) {
    const produtos = estoque.produtos || [];
    const vinculados = produtos.filter(p => (p.ncm || detectarNCM(p.nome)) === ncm).length;
    const msg = vinculados > 0 ? `Este NCM está vinculado a ${vinculados} produto(s). Deseja excluir mesmo assim?` : `Excluir NCM ${ncm}?`;
    if (!confirm(msg)) return;
    delete impostosEditaveis[ncm];
    renderizarImpostosFederais();
    salvarDados();
}

function exportarImpostosFederais() {
    const rows = Object.entries(impostosEditaveis).map(([ncm, imp]) => ({ 'NCM': ncm, 'Descrição': imp.descricao, 'PIS (%)': imp.pis, 'COFINS (%)': imp.cofins, 'IPI (%)': imp.ipi }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Impostos Federais');
    XLSX.writeFile(wb, 'impostos_federais.xlsx');
}

function importarImpostosFederais() { document.getElementById('inputImportarFederais').click(); }

function importarImpostosFederaisArquivo(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws);
        let importados = 0, atualizados = 0;
        rows.forEach(row => {
            const ncm = (row['NCM'] || row['ncm'] || '').toString().trim();
            if (!ncm) return;
            const novo = { descricao: row['Descrição'] || row['Descricao'] || row['descricao'] || '', pis: parseFloat(row['PIS (%)'] || row['PIS'] || 0), cofins: parseFloat(row['COFINS (%)'] || row['COFINS'] || 0), ipi: parseFloat(row['IPI (%)'] || row['IPI'] || 0) };
            if (impostosEditaveis[ncm]) atualizados++; else importados++;
            impostosEditaveis[ncm] = novo;
        });
        renderizarImpostosFederais();
        alert(`✅ ${importados} NCMs importados, ${atualizados} atualizados.`);
        event.target.value = '';
        salvarDados();
    };
    reader.readAsBinaryString(file);
}

// ── ICMS BY STATE MATRIX (editable) ────────────────────────────
let icmsEditavelPJ = {};
let icmsEditavelPF = {};
const ESTADOS_LISTA = [...ESTADOS_BR];

function inicializarICMSEditavel() {
    Object.entries(ICMS_PJ_POR_NCM).forEach(([ncm, mapa]) => { if (!icmsEditavelPJ[ncm]) icmsEditavelPJ[ncm] = { ...mapa }; });
    Object.entries(ICMS_PF_POR_NCM).forEach(([ncm, mapa]) => { if (!icmsEditavelPF[ncm]) icmsEditavelPF[ncm] = { ...mapa }; });
}

function renderizarICMSPorEstado() {
    inicializarICMSEditavel();
    inicializarImpostosEditaveis();
    const tipo = document.getElementById('filtroICMS_Tipo')?.value || 'PJ';
    const filtroNCM = document.getElementById('filtroICMS_NCM')?.value || '';
    const tabela = tipo === 'PF' ? icmsEditavelPF : icmsEditavelPJ;
    const selectNCM = document.getElementById('filtroICMS_NCM');
    if (selectNCM) {
        const ncms = Object.keys(impostosEditaveis);
        selectNCM.innerHTML = '<option value="">Todos os NCMs</option>' + ncms.map(ncm => `<option value="${ncm}" ${ncm===filtroNCM?'selected':''}>${ncm} — ${impostosEditaveis[ncm]?.descricao || ''}</option>`).join('');
    }
    const ncmsParaExibir = filtroNCM ? [filtroNCM] : Object.keys(tabela);
    document.getElementById('icmsEstadosHeader').innerHTML = `
        <th style="text-align:left; padding-left:10px; min-width:120px; position:sticky; left:0; background:#1e3a5f; z-index:2">NCM</th>
        <th style="text-align:left; min-width:180px; position:sticky; left:120px; background:#1e3a5f; z-index:2">Descrição</th>
        ${ESTADOS_LISTA.map(uf => `<th style="min-width:52px; text-align:center">${uf}</th>`).join('')}
    `;
    document.getElementById('tabelaICMSEstadosBody').innerHTML = ncmsParaExibir.map(ncm => {
        const mapa = tabela[ncm] || {};
        const desc = impostosEditaveis[ncm]?.descricao || ncm;
        return `
            <tr>
                <td style="text-align:left; padding-left:10px; font-weight:600; font-family:monospace; color:#1e3a5f; font-size:0.78rem; position:sticky; left:0; background:#fff; z-index:1; border-right:1px solid #e2e8f0">${ncm}</td>
                <td style="text-align:left; font-size:0.82rem; color:#475569; position:sticky; left:120px; background:#fff; z-index:1; border-right:2px solid #e2e8f0; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${desc}">${desc}</td>
                ${ESTADOS_LISTA.map(uf => {
                    const val = mapa[uf] !== undefined ? mapa[uf] : '';
                    return `<td style="padding:2px 3px; text-align:center"><input type="number" step="0.5" min="0" max="100" value="${val}" placeholder="—" title="${ncm} / ${uf} / ${tipo}: ${val}%" onchange="editarICMSEstado('${ncm}','${uf}','${tipo}',this.value)" style="width:46px; border:1px solid #e2e8f0; border-radius:4px; padding:3px 2px; text-align:center; font-size:0.8rem; background:${val===''?'#f8fafc':'#fff'}"></td>`;
                }).join('')}
            </tr>
        `;
    }).join('');
}

function editarICMSEstado(ncm, estado, tipoPessoa, valor) {
    const tabela = tipoPessoa === 'PF' ? icmsEditavelPF : icmsEditavelPJ;
    if (!tabela[ncm]) tabela[ncm] = {};
    tabela[ncm][estado] = parseFloat(valor) || 0;
    const idRegra = `predef_${ncm}_${estado}_${tipoPessoa}`;
    const idx = tabelaICMS.findIndex(r => r.id === idRegra);
    if (idx >= 0) {
        tabelaICMS[idx].aliquota = parseFloat(valor) || 0;
    } else {
        tabelaICMS.push({ id: idRegra, ncm, estado, tipoPessoa, categoriaProduto: 'Todos', aliquota: parseFloat(valor) || 0 });
    }
    salvarDados();
}

function exportarICMSEstados() {
    const tipo = document.getElementById('filtroICMS_Tipo')?.value || 'PJ';
    const tabela = tipo === 'PF' ? icmsEditavelPF : icmsEditavelPJ;
    const rows = Object.entries(tabela).map(([ncm, mapa]) => {
        const row = { 'NCM': ncm, 'Descrição': impostosEditaveis[ncm]?.descricao || '', 'Tipo': tipo };
        ESTADOS_LISTA.forEach(uf => { row[uf] = mapa[uf] ?? ''; });
        return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `ICMS_${tipo}`);
    XLSX.writeFile(wb, `icms_${tipo.toLowerCase()}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

function importarICMSEstados() { document.getElementById('inputImportarICMSEstados').click(); }

function importarICMSEstadosArquivo(event) {
    const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = (e) => {
        const wb = XLSX.read(e.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(ws);
        let count = 0; rows.forEach(row => {
            const ncm = (row['NCM'] || '').toString().trim(); const tipo = (row['Tipo'] || 'PJ').toString().trim().toUpperCase();
            if (!ncm) return; const tabela = tipo === 'PF' ? icmsEditavelPF : icmsEditavelPJ; if (!tabela[ncm]) tabela[ncm] = {};
            ESTADOS_LISTA.forEach(uf => { if (row[uf] !== undefined && row[uf] !== '') { tabela[ncm][uf] = parseFloat(row[uf]) || 0; editarICMSEstado(ncm, uf, tipo, tabela[ncm][uf]); } });
            count++;
        });
        renderizarICMSPorEstado(); alert(`✅ ${count} linha(s) de ICMS importadas.`); event.target.value = ''; salvarDados({ imediato: true }); salvarNoCloud();
    };
    reader.readAsBinaryString(file);
}

function recalcularTodosProdutos() {
    renderizarPrecificacao();
    popularSelectClientesPrecif();
    calcularPrecificacaoPorCliente({ forcarAtual: true });
}

function recalcularTodos() {
    recalcularTodosProdutos();
}

function aplicarMargemGlobal() {
    recalcularTodosProdutos();
}

function _ordenarTodosNoFim(a, b) {
    if (a === b) return 0;
    if (a === 'Todos') return 1;
    if (b === 'Todos') return -1;
    return String(a).localeCompare(String(b), 'pt-BR');
}

function renderizarTabelaICMS() {
    const tbody = document.getElementById('tabelaICMSBody');
    if (!tbody) return;

    const regrasOrdenadas = [...tabelaICMS].sort((a, b) => {
        const e = _ordenarTodosNoFim(a.estado, b.estado);
        if (e !== 0) return e;
        const t = _ordenarTodosNoFim(a.tipoPessoa, b.tipoPessoa);
        if (t !== 0) return t;
        return _ordenarTodosNoFim(a.categoriaProduto, b.categoriaProduto);
    });

    tbody.innerHTML = regrasOrdenadas.map(rule => `
        <tr id="icms_row_${_escapeHtml(rule.id)}">
            <td>${_escapeHtml(rule.ncm || '—')}</td>
            <td>${_escapeHtml(rule.estado)}</td>
            <td>${_escapeHtml(rule.tipoPessoa)}</td>
            <td>${_escapeHtml(rule.categoriaProduto)}</td>
            <td>${Number(rule.aliquota || 0).toFixed(2)}%</td>
            <td>
                <button onclick="editarRegraICMS('${_escapeJsString(rule.id)}')" style="border:none;background:none;cursor:pointer">✏️</button>
                <button onclick="excluirRegraICMS('${_escapeJsString(rule.id)}')" style="border:none;background:none;cursor:pointer">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function adicionarRegraICMS() {
    const tbody = document.getElementById('tabelaICMSBody');
    if (!tbody) return;
    if (document.getElementById('novaRegraRow')) return;

    const opcoesEstado = ['Todos', ...ESTADOS_BR].map(e => `<option value="${e}">${e}</option>`).join('');
    const opcoesCategoria = ['Todos', ...CATEGORIAS_PRODUTO].map(c => `<option value="${c}">${c}</option>`).join('');
        const opcoesNCM = ['','9301.90.00','9305.91.00','9302.00.00','9305.10.00','8211.10.00','8201.40.00']
            .map(n => n === '' ? `<option value="">Todos</option>` : `<option value="${n}">${n}</option>`).join('');

    const html = `
            <tr id="novaRegraRow">
                <td>
                    <select id="nr_ncm">${opcoesNCM}</select>
                </td>
                <td>
                    <select id="nr_estado">${opcoesEstado}</select>
                </td>
                <td>
                    <select id="nr_tipoPessoa">
                        <option value="Todos">Todos</option>
                        <option value="PJ">PJ</option>
                        <option value="PF">PF</option>
                    </select>
                </td>
                <td>
                    <select id="nr_categoria">${opcoesCategoria}</select>
                </td>
                <td>
                    <input type="number" id="nr_aliquota" step="0.01" min="0" placeholder="12" style="width:70px">
                </td>
                <td>
                    <button onclick="confirmarNovaRegraICMS()" style="color:#16a34a;font-size:1.1rem;background:none;border:none;cursor:pointer">✓</button>
                    <button onclick="cancelarNovaRegraICMS()" style="color:#dc2626;font-size:1.1rem;background:none;border:none;cursor:pointer">✗</button>
                </td>
            </tr>`;

    tbody.insertAdjacentHTML('afterbegin', html);
}

function confirmarNovaRegraICMS() {
    const ncm = (document.getElementById('nr_ncm')?.value || '').trim() || 'Todos';
    const estado = document.getElementById('nr_estado')?.value || 'Todos';
    const tipoPessoa = document.getElementById('nr_tipoPessoa')?.value || 'Todos';
    const categoria = document.getElementById('nr_categoria')?.value || 'Todos';
    const aliquota = parseFloat(document.getElementById('nr_aliquota')?.value);

    if (!Number.isFinite(aliquota) || aliquota < 0) {
        alert('Informe uma alíquota válida (>= 0).');
        return;
    }

    tabelaICMS.push({
        id: Date.now().toString(),
        ncm,
        estado,
        tipoPessoa,
        categoriaProduto: categoria,
        aliquota
    });

    renderizarTabelaICMS();
    salvarDados();
}

function cancelarNovaRegraICMS() {
    const row = document.getElementById('novaRegraRow');
    if (row) row.remove();
}

function editarRegraICMS(id) {
    const rule = tabelaICMS.find(r => String(r.id) === String(id));
    if (!rule) return;
    const row = document.getElementById(`icms_row_${id}`);
    if (!row) return;

    const opcoesNCM = ['','9301.90.00','9305.91.00','9302.00.00','9305.10.00','8211.10.00','8201.40.00']
        .map(n => n === '' ? `<option value="">Todos</option>` : `<option value="${n}" ${rule.ncm === n ? 'selected' : ''}>${n}</option>`).join('');
    const opcoesEstado = ['Todos', ...ESTADOS_BR]
        .map(e => `<option value="${e}" ${e === rule.estado ? 'selected' : ''}>${e}</option>`)
        .join('');
    const opcoesCategoria = ['Todos', ...CATEGORIAS_PRODUTO]
        .map(c => `<option value="${c}" ${c === rule.categoriaProduto ? 'selected' : ''}>${c}</option>`)
        .join('');

    row.innerHTML = `
        <td><select id="er_ncm_${id}">${opcoesNCM}</select></td>
        <td><select id="er_estado_${id}">${opcoesEstado}</select></td>
        <td>
            <select id="er_tipoPessoa_${id}">
                <option value="Todos" ${rule.tipoPessoa === 'Todos' ? 'selected' : ''}>Todos</option>
                <option value="PJ" ${rule.tipoPessoa === 'PJ' ? 'selected' : ''}>PJ</option>
                <option value="PF" ${rule.tipoPessoa === 'PF' ? 'selected' : ''}>PF</option>
            </select>
        </td>
        <td><select id="er_categoria_${id}">${opcoesCategoria}</select></td>
        <td><input type="number" id="er_aliquota_${id}" step="0.01" min="0" value="${Number(rule.aliquota || 0)}" style="width:70px"></td>
        <td>
            <button onclick="atualizarRegraICMS('${_escapeJsString(id)}')" style="color:#16a34a;font-size:1.1rem;background:none;border:none;cursor:pointer">✓</button>
            <button onclick="renderizarTabelaICMS()" style="color:#dc2626;font-size:1.1rem;background:none;border:none;cursor:pointer">✗</button>
        </td>
    `;
}

function atualizarRegraICMS(id) {
    const ncm = (document.getElementById(`er_ncm_${id}`)?.value || '').trim() || 'Todos';
    const estado = document.getElementById(`er_estado_${id}`)?.value || 'Todos';
    const tipoPessoa = document.getElementById(`er_tipoPessoa_${id}`)?.value || 'Todos';
    const categoria = document.getElementById(`er_categoria_${id}`)?.value || 'Todos';
    const aliquota = parseFloat(document.getElementById(`er_aliquota_${id}`)?.value);

    if (!Number.isFinite(aliquota) || aliquota < 0) {
        alert('Informe uma alíquota válida (>= 0).');
        return;
    }

    const idx = tabelaICMS.findIndex(r => String(r.id) === String(id));
    if (idx === -1) return;

    tabelaICMS[idx] = {
        ...tabelaICMS[idx],
        ncm,
        estado,
        tipoPessoa,
        categoriaProduto: categoria,
        aliquota
    };

    renderizarTabelaICMS();
    salvarDados();
}

function excluirRegraICMS(id) {
    if (confirm('Excluir esta regra de ICMS?')) {
        tabelaICMS = tabelaICMS.filter(r => String(r.id) !== String(id));
        renderizarTabelaICMS();
        salvarDados();
    }
}

function exportarTabelaICMS() {
    if (typeof XLSX === 'undefined') {
        mostrarNotificacao('Biblioteca XLSX não encontrada.', 'error');
        return;
    }
    const dados = tabelaICMS.map(r => ({
        'NCM': r.ncm || '',
        'Estado': r.estado,
        'Tipo Pessoa': r.tipoPessoa,
        'Categoria Produto': r.categoriaProduto,
        'Aliquota ICMS (%)': r.aliquota
    }));
    const ws = XLSX.utils.json_to_sheet(dados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tabela ICMS');
    XLSX.writeFile(wb, 'tabela_icms.xlsx');
}

function importarTabelaICMS() {
    document.getElementById('inputImportarICMS').click();
}

function _normalizarCabecalho(txt) {
    return String(txt || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function importarTabelaICMSArquivo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (typeof XLSX === 'undefined') {
        mostrarNotificacao('Biblioteca XLSX não encontrada.', 'error');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

            let importadas = 0;
            let atualizadas = 0;

            rows.forEach((row, index) => {
                const normalized = {};
                Object.keys(row).forEach(k => {
                    normalized[_normalizarCabecalho(k)] = row[k];
                });

                const ncm = String(normalized.ncm || '').trim() || '';
                const estado = String(normalized.estado || 'Todos').trim() || 'Todos';
                const tipoPessoa = String(normalized.tipopessoa || 'Todos').trim() || 'Todos';
                const categoria = String(normalized.categoriaproduto || 'Todos').trim() || 'Todos';
                const aliquota = parseFloat(normalized.aliquotaicms ?? normalized.aliquotaicmspercent ?? normalized.aliquota ?? '');

                if (!Number.isFinite(aliquota) || aliquota < 0) return;

                const idxExistente = tabelaICMS.findIndex(r =>
                    String(r.estado).toUpperCase() === estado.toUpperCase()
                    && String(r.tipoPessoa).toUpperCase() === tipoPessoa.toUpperCase()
                    && String(r.categoriaProduto).toUpperCase() === categoria.toUpperCase()
                    && (String(r.ncm || '').toUpperCase() === String(ncm || '').toUpperCase())
                );

                if (idxExistente >= 0) {
                    tabelaICMS[idxExistente].aliquota = aliquota;
                    atualizadas++;
                } else {
                    tabelaICMS.push({
                        id: `${Date.now()}_${index}`,
                        ncm: ncm || 'Todos',
                        estado,
                        tipoPessoa,
                        categoriaProduto: categoria,
                        aliquota
                    });
                    importadas++;
                }
            });

            renderizarTabelaICMS();
            salvarDados();
            alert(`${importadas} regras importadas, ${atualizadas} atualizadas.`);
        } catch (err) {
            console.error('Erro ao importar tabela ICMS:', err);
            mostrarNotificacao('Falha ao importar tabela de ICMS.', 'error');
        } finally {
            event.target.value = '';
        }
    };

    reader.readAsArrayBuffer(file);
}

function abrirModalICMS() {
    renderizarTabelaICMS();
    document.getElementById('modalICMS').style.display = 'block';
}

function abrirSimuladorICMS() {
    const select = document.getElementById('simProduto');
    if (!select) return;
    const produtos = estoque.produtos || [];

    select.innerHTML = '<option value="">Selecione...</option>'
      + produtos
          .filter(p => (precificacao[p.nome]?.ci || 0) > 0)
          .map(p => `<option value="${_escapeHtml(p.nome)}">${_escapeHtml(p.nome)}</option>`)
          .join('');

    document.getElementById('simResultado').style.display = 'none';
    document.getElementById('modalSimuladorICMS').style.display = 'block';
}

function rodarSimulador() {
    const nome = document.getElementById('simProduto').value;
    const estado = document.getElementById('simEstado').value;
    const tipoPessoa = document.getElementById('simTipoPessoa').value;
    if (!nome || !estado) return;

    const r = calcularPreco(nome, estado, tipoPessoa);
    if (!r) {
        document.getElementById('simResultado').style.display = 'none';
        return;
    }

    const fmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const pct = v => Number(v || 0).toFixed(2) + '%';

    const row = (label, pctTxt, valor, color = '#1e293b', bold = false) => `
      <tr>
        <td style="padding:6px 4px;color:#475569">${label}</td>
        <td style="text-align:center;padding:6px 4px;color:#94a3b8;font-size:0.85rem">
          ${pctTxt}
        </td>
        <td style="text-align:right;padding:6px 4px;font-weight:${bold ? 700 : 500};color:${color}">${valor}</td>
      </tr>`;

    const sep = () => `<tr><td colspan="3" style="border-top:1px solid #e2e8f0;padding:2px 0"></td></tr>`;

    document.getElementById('simDetalhamento').innerHTML = `
      ${row('Custo de Industrialização (CI)', '—', fmt(r.ci))}
      ${row('Taxa (diretoria)', '× ' + r.taxa, '—')}
      ${row('ROI', '× ' + r.roi, '—')}
      ${row('Valor Base (CI × Taxa × ROI)', '—', fmt(r.valorBase), '#1e3a5f', true)}
      ${sep()}
      ${row('ICMS (' + estado + ' / ' + tipoPessoa + ')', pct(r.icms), fmt(r.icmsR), '#dc2626')}
      ${row('PIS', pct(r.pis), fmt(r.pisR), '#dc2626')}
      ${row('COFINS', pct(r.cofins), fmt(r.cofinsR), '#dc2626')}
      ${row('Valor c/ ICMS + PIS + COFINS', '—', fmt(r.valorImpostos), '#1e3a5f', true)}
      ${sep()}
      ${row('IPI', pct(r.ipi), fmt(r.ipiR), '#dc2626')}
      ${row('Valor c/ IPI (Valor Total)', '—', fmt(r.valorTotal), '#1e3a5f', true)}
      ${sep()}
      ${row('Comissão (% s/ Valor Base)', pct(r.comissao), fmt(r.comissaoR), '#d97706')}
    `;

    document.getElementById('simPrecoFinal').textContent = fmt(r.precoFinal);
    document.getElementById('simResultado').style.display = 'block';
}

function sincronizarPrecoNasVendas(nomeProduto) {
    const container = document.getElementById('itensVendaContainer');
    if (!container) return;
    const rows = container.querySelectorAll('.item-venda-row');
    rows.forEach(row => {
        const select = row.querySelector('.item-produto');
        if (!select) return;
        const produtoId = parseInt(select.value);
        const produto = (estoque.produtos || []).find(p => p.id === produtoId);
        if (produto && produto.nome === nomeProduto) {
            const valorInput = row.querySelector('.item-valor');
            const calc = calcularPreco(nomeProduto);
            if (valorInput && calc && (!valorInput.value || valorInput.value.trim() === '')) {
                valorInput.value = Number(calc.precoFinal).toFixed(2).replace('.', ',');
            }
        }
    });
}

function autoPreencherPrecoProduto(selectEl) {
    const row = selectEl.closest('.item-venda-row');
    if (!row) return;
    const valorInput = row.querySelector('.item-valor');
    if (!valorInput) return;
    if (valorInput.value && valorInput.value.trim() !== '') return;

    const produtoId = parseInt(selectEl.value);
    const produto = (estoque.produtos || []).find(p => p.id === produtoId);
    if (!produto) return;

    // Primeiro: tentar obter preço da precificação salva para o cliente selecionado
    const lojaNome = (document.getElementById('lojaVenda')?.value || '').trim();
    let precoSalvo = null;
    try { precoSalvo = obterPrecoFinalSalvoParaClienteProduto(lojaNome, produtoId); } catch (e) { precoSalvo = null; }

    if (precoSalvo !== null && !isNaN(precoSalvo) && Number(precoSalvo) > 0) {
        valorInput.value = Number(precoSalvo).toFixed(2).replace('.', ',');
        valorInput.style.background = '#ecfdf5';
        valorInput.setAttribute('data-autofilled', '1');
        return;
    }

    // Se não houver precificação salva, tentar usar a última precificação calculada para este cliente (se existir)
    try {
        const clienteObj = (clientes || []).find(c => (c.nome||'').toLowerCase() === (lojaNome||'').toLowerCase());
        if (clienteObj && ultimaPrecificacaoCalculada && String(ultimaPrecificacaoCalculada.clienteId) === String(clienteObj.id)) {
            const item = (ultimaPrecificacaoCalculada.itens || []).find(it => Number(it.produtoId) === Number(produtoId) || (it.produto && it.produto.toLowerCase() === (produto.nome||'').toLowerCase()));
            if (item && Number(item.precoFinal) > 0) {
                valorInput.value = Number(item.precoFinal).toFixed(2).replace('.', ',');
                valorInput.style.background = '#ecfdf5';
                valorInput.setAttribute('data-autofilled', '1');
                return;
            }
        }
    } catch (e) {}

    // Caso não haja preço salvo nem versão calculada para este cliente, manter em branco (usuário preencherá manualmente)
}

// Retorna o preço final salvo (number) para um produto em uma precificação do cliente, ou null
function obterPrecoFinalSalvoParaClienteProduto(lojaNome, produtoId) {
    if (!lojaNome) return null;
    const clienteObj = (clientes || []).find(c => (c.nome||'').toLowerCase() === (lojaNome||'').toLowerCase());
    if (!clienteObj) return null;
    let registro = null;
    try { registro = obterUltimaPrecificacaoCliente(clienteObj.id); } catch (e) { registro = null; }
    if (!registro) return null;
    const itens = registro.itens || [];
    const item = itens.find(it => Number(it.produtoId) === Number(produtoId) || (it.produto && (it.produto.toLowerCase() === ((estoque.produtos.find(p=>p.id===produtoId)||{}).nome||'').toLowerCase())));
    if (!item) return null;
    return Number(item.precoFinal || item.preco || item.valorUnitario || 0) || null;
}

// Atualiza preços de todas as linhas do modal de venda de acordo com o cliente preenchido
function atualizarPrecosVendaPorCliente() {
    try {
        const lojaNome = (document.getElementById('lojaVenda')?.value || '').trim();
        if (!lojaNome) return;
        const container = document.getElementById('itensVendaContainer');
        if (!container) return;
        container.querySelectorAll('.item-venda-row').forEach(row => {
            const sel = row.querySelector('.item-produto');
            if (!sel) return;
            autoPreencherPrecoProduto(sel);
        });
    } catch (e) { console.error('atualizarPrecosVendaPorCliente erro', e); }
}

function exportarPrecificacaoExcel() {
    try {
        const federaisEl = document.getElementById('subaba-precif-federais');
        const icmsEl = document.getElementById('subaba-precif-icms');
        const porclienteEl = document.getElementById('subaba-precif-porcliente');
        const comparativoEl = document.getElementById('subaba-precif-comparativo');
        const rastreabilidadeEl = document.getElementById('subaba-precif-rastreabilidade');

        if (federaisEl && federaisEl.style.display === 'block') { exportarImpostosFederais(); return; }
        if (icmsEl && icmsEl.style.display === 'block') { exportarICMSEstados(); return; }
        if (porclienteEl && porclienteEl.style.display === 'block') { exportarPrecifCliente(); return; }
        if (comparativoEl && comparativoEl.style.display === 'block') { exportarComparativo(); return; }
        if (rastreabilidadeEl && rastreabilidadeEl.style.display === 'block') { exportarRastreabilidade(); return; }

        // fallback: exportar impostos federais
        exportarImpostosFederais();
    } catch (e) {
        console.error('exportarPrecificacaoExcel error:', e);
        mostrarNotificacao('Erro ao exportar precificação.', 'error');
    }
}

function imprimirPrecificacao() {
    const tabEl = document.getElementById('tab-precificacao');
    if (!tabEl) return;
    const html = tabEl.querySelector('.table-container')?.innerHTML || '';
    const win = window.open('', '_blank');
    if (!win) { mostrarNotificacao('Pop-up bloqueado pelo navegador.', 'error'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Precificação</title>
        <style>body{font-family:Inter,Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 8px;font-size:11px}th{background:#f5f5f5;font-weight:600}input{border:none;background:transparent;text-align:right;font-size:11px}</style>
        <script>window.onload=function(){ setTimeout(function(){ window.print(); },200); }<\/script>
    </head><body><h2>Precificação de Produtos</h2>${html}</body></html>`);
    win.document.close();
}

// ========================================
// MÓDULO: PROPOSTAS COMERCIAIS
// ========================================

function gerarNumeroProposta() {
    const existentes = propostas.map(p => {
        const m = (p.numero || '').match(/P-(\d+)/);
        return m ? parseInt(m[1]) : 0;
    });
    const proximo = existentes.length ? Math.max(...existentes) + 1 : 1;
    return 'P-' + String(proximo).padStart(3, '0');
}

function abrirModalProposta(id = null) {
    if (!requireAdminOrNotify()) return;
    const modalEl = document.getElementById('modalProposta');
    modalEl.style.display = 'flex';
    document.getElementById('formProposta').reset();
    document.getElementById('propostaEditId').value = '';
    const container = document.getElementById('itensPropostaContainer');
    if (container) container.innerHTML = '';
    try { popularSelectRepresentantes('propostaRepresentante', true); } catch (e) {}

    try { document.getElementById('propostaData').value = new Date().toISOString().slice(0, 10); } catch (e) {}

    if (!id) {
        document.getElementById('modalPropostaTitulo').textContent = 'Nova Proposta';
        document.getElementById('propostaNumero').value = gerarNumeroProposta();
        document.getElementById('propostaValidade').value = 30;
        document.getElementById('propostaValorTotal').value = '';
        adicionarItemPropostaRow();
        return;
    }

    const proposta = propostas.find(p => p.id === id);
    if (!proposta) { mostrarNotificacao('Proposta não encontrada.', 'error'); return; }

    document.getElementById('modalPropostaTitulo').textContent = 'Editar Proposta ' + proposta.numero;
    document.getElementById('propostaEditId').value = proposta.id;
    document.getElementById('propostaNumero').value = proposta.numero || '';
    document.getElementById('propostaCliente').value = proposta.cliente || '';
    document.getElementById('propostaRepresentante').value = proposta.representante || '';
    document.getElementById('propostaStatus').value = proposta.status || 'rascunho';
    document.getElementById('propostaValidade').value = proposta.validade || 30;
    document.getElementById('propostaObservacoes').value = proposta.observacoes || '';
    try { document.getElementById('propostaData').value = proposta.data ? proposta.data.split('T')[0] : ''; } catch (e) {}

    if (Array.isArray(proposta.itens) && proposta.itens.length > 0) {
        proposta.itens.forEach(it => {
            const preValor = it.valorUnitario ? it.valorUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
            adicionarItemPropostaRow({ produtoId: it.produtoId, quantidade: it.quantidade, valorUnit: preValor });
        });
    } else {
        adicionarItemPropostaRow();
    }

    calcularTotalProposta();
}

function adicionarItemPropostaRow(item = null) {
    const container = document.getElementById('itensPropostaContainer');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'item-venda-row';
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '6px';

    let opcoesHtml = '';
    try { opcoesHtml = construirOpcoesProdutos(); } catch (e) { opcoesHtml = '<option value="">(nenhum produto)</option>'; }

    const preQtd = item ? (item.quantidade || 1) : 1;
    const preValor = item ? (item.valorUnit || '') : '';
    // normalizar valor original (usar ponto decimal) para dataset
    let preValorOriginal = '';
    try {
        if (preValor !== null && preValor !== undefined && preValor !== '') {
            const norm = String(preValor).toString().replace(/\./g, '').replace(',', '.');
            const parsed = parseFloat(norm);
            if (!isNaN(parsed)) preValorOriginal = parsed.toFixed(2);
        }
    } catch (e) { preValorOriginal = ''; }

    row.innerHTML = `
        <select class="item-produto" onchange="autoPreencherPrecoItemProposta(this); atualizarItemPropostaRow(this)">${opcoesHtml}</select>
        <input type="number" class="item-quantidade" min="1" value="${preQtd}" style="width:90px" onchange="atualizarItemPropostaRow(this)" />
        <input type="text" class="item-valor" placeholder="Valor unit." style="width:140px" oninput="formatarMoeda(this); atualizarItemPropostaRow(this)" value="${preValor}" data-original="${preValorOriginal}" />
        <input type="number" step="0.01" min="0" max="100" class="item-desconto" placeholder="Desc%" oninput="aplicarDesconto(this)" style="width:65px; border:1px solid #e2e8f0; border-radius:6px; padding:5px 6px; text-align:center; font-size:0.82rem" title="Desconto % sobre o preço original">
        <span style="font-size:0.8rem; color:#94a3b8">%</span>
        <div class="item-subtotal" style="min-width:120px">-</div>
        <button type="button" class="btn btn-outline btn-sm" onclick="removerItemPropostaRow(this)">Remover</button>
    `;

    container.appendChild(row);

    if (item && item.produtoId) row.querySelector('.item-produto').value = item.produtoId;

    atualizarItemPropostaRow(row.querySelector('.item-produto'));
}

function autoPreencherPrecoItemProposta(selectEl) {
    const row = selectEl.closest('.item-venda-row');
    if (!row) return;
    const valorInput = row.querySelector('.item-valor');
    if (!valorInput) return;
    if (valorInput.value && valorInput.value.trim() !== '') return;
    const produtoId = parseInt(selectEl.value);
    const produto = (estoque.produtos || []).find(p => p.id === produtoId);
    if (produto) {
        const calc = calcularPreco(produto.nome);
        if (calc && calc.precoFinal > 0) {
            valorInput.value = Number(calc.precoFinal).toFixed(2).replace('.', ',');
            try { valorInput.dataset.original = String(Number(calc.precoFinal).toFixed(2)); } catch (e) {}
        }
    }
}

function atualizarItemPropostaRow(el) {
    const row = el.closest('.item-venda-row');
    if (!row) return;
    const qtdInput = row.querySelector('.item-quantidade');
    const valorInput = row.querySelector('.item-valor');
    const subtotalDiv = row.querySelector('.item-subtotal');

    const qtd = parseInt(qtdInput?.value) || 0;
    const valorStr = (valorInput?.value || '').replace(/\./g, '').replace(',', '.');
    const valor = parseFloat(valorStr) || 0;
    const sub = qtd * valor;

    if (subtotalDiv) subtotalDiv.textContent = sub > 0 ? formatarMoedaValor(sub) : '-';
    calcularTotalProposta();
}

function removerItemPropostaRow(btnEl) {
    const row = btnEl.closest('.item-venda-row');
    if (row) row.remove();
    calcularTotalProposta();
}

function calcularTotalProposta() {
    const container = document.getElementById('itensPropostaContainer');
    if (!container) return;
    let total = 0;
    container.querySelectorAll('.item-venda-row').forEach(row => {
        const qtd = parseInt(row.querySelector('.item-quantidade')?.value) || 0;
        const valorStr = (row.querySelector('.item-valor')?.value || '').replace(/\./g, '').replace(',', '.');
        total += qtd * (parseFloat(valorStr) || 0);
    });
    const el = document.getElementById('propostaValorTotal');
    if (el) el.value = formatarMoedaValor(total);
}

function _coletarItensProposta() {
    const container = document.getElementById('itensPropostaContainer');
    if (!container) return [];
    const itens = [];
    container.querySelectorAll('.item-venda-row').forEach(row => {
        try {
            const select = row.querySelector('.item-produto');
            const produtoId = parseInt(select?.value) || 0;
            if (!produtoId) return;
            const produto = (estoque.produtos || []).find(p => p.id === produtoId);
            const quantidade = parseInt(row.querySelector('.item-quantidade')?.value) || 0;
            const valorStr = (row.querySelector('.item-valor')?.value || '').toString().trim();
            const valorUnitarioInput = valorStr === '' ? 0 : parseFloat(valorStr.replace(/\./g, '').replace(',', '.')) || 0;

            // Calcular preços/tributos padrão via calcularPreco quando possível
            let calc = null;
            try { if (produto && produto.nome) calc = calcularPreco(produto.nome); } catch (e) { calc = null; }

            const valorUnit = (valorUnitarioInput && valorUnitarioInput > 0) ? valorUnitarioInput : (calc && calc.precoFinal ? Number(calc.precoFinal) : 0);
            const valorTotal = Number((quantidade || 0) * valorUnit);

            const descontoPct = parseFloat(row.querySelector('.item-desconto')?.value || '0') || 0;
            const valorOriginalData = (row.querySelector('.item-valor')?.dataset?.original || '').toString().replace(/\./g, '').replace(',', '.');
            const valorUnitarioOriginal = valorOriginalData ? (parseFloat(valorOriginalData) || 0) : (calc && calc.precoFinal ? Number(calc.precoFinal) : 0);

            const itemObj = {
                produtoId: produtoId,
                produto: produto?.nome || '',
                produtoNome: produto?.nome || '',
                quantidade: quantidade,
                valorUnitario: valorUnit,
                valorUnitarioOriginal: valorUnitarioOriginal,
                descontoPct: descontoPct,
                valorTotal: valorTotal
            };

            if (calc) {
                itemObj.ci = calc.ci;
                itemObj.taxa = calc.taxa;
                itemObj.roi = calc.roi;
                itemObj.valorBase = calc.valorBase;
                itemObj.pis = calc.pis; itemObj.pisR = calc.pisR;
                itemObj.cofins = calc.cofins; itemObj.cofinsR = calc.cofinsR;
                itemObj.icms = calc.icms; itemObj.icmsR = calc.icmsR;
                itemObj.ipi = calc.ipi; itemObj.ipiR = calc.ipiR;
                itemObj.comissao = calc.comissao; itemObj.comissaoR = calc.comissaoR;
                itemObj.precoFinalCalc = calc.precoFinal;
            }

            itens.push(itemObj);
        } catch (e) {
            console.error('Erro coletando item de proposta:', e);
        }
    });
    return itens;
}

function salvarProposta(event) {
    if (event) event.preventDefault();
    const editId = document.getElementById('propostaEditId').value;
    const numero = document.getElementById('propostaNumero').value;
    const cliente = document.getElementById('propostaCliente').value.trim();
    const representante = document.getElementById('propostaRepresentante').value;
    const status = document.getElementById('propostaStatus').value;
    const dataStr = document.getElementById('propostaData').value;
    const validade = parseInt(document.getElementById('propostaValidade').value) || 30;
    const observacoes = document.getElementById('propostaObservacoes').value.trim();
    const itens = _coletarItensProposta();

    if (!cliente) { mostrarNotificacao('Informe o cliente.', 'error'); return; }
    if (!representante) { mostrarNotificacao('Selecione o representante.', 'error'); return; }
    if (itens.length === 0) { mostrarNotificacao('Adicione pelo menos um item.', 'error'); return; }

    // Verificar se algum item excede o desconto máximo configurado
    let precisaAprovacao = false;
    let motivoAprovacao = null;
    try {
        const linhas = Array.from(document.querySelectorAll('.item-venda-row'));
        const excederam = linhas.map(row => {
            const prodVal = row.querySelector('.item-produto')?.value || '';
            let nome = prodVal;
            const produtoObj = (estoque.produtos || []).find(p => String(p.id) === String(prodVal) || p.nome === prodVal);
            if (produtoObj) nome = produtoObj.nome;
            const desc = parseFloat(row.querySelector('.item-desconto')?.value || '0') || 0;
            const descMax = precificacao[nome] ? parseFloat(precificacao[nome].descontoMaximo) : null;
            if (descMax !== null && desc > descMax) {
                return `${nome} (${desc}% > ${descMax}%)`;
            }
            return null;
        }).filter(Boolean);

        if (excederam.length) {
            const texto = 'Alguns itens excedem o desconto máximo configurado:\n- ' + excederam.join('\n- ') + '\n\nInforme o motivo para enviar para aprovação:';
            const motivo = prompt(texto, 'Motivo do desconto excepcional');
            if (!motivo) { mostrarNotificacao('Envio cancelado: motivo obrigatório para aprovação.', 'error'); return; }
            precisaAprovacao = true; motivoAprovacao = motivo;
        }
    } catch (e) { console.error('Erro verificando desconto máximo', e); }

    const valorTotal = itens.reduce((s, i) => s + i.valorTotal, 0);
    const dataISO = dataStr ? new Date(dataStr + 'T00:00:00').toISOString() : new Date().toISOString();
    const dataExp = new Date(dataISO);
    dataExp.setDate(dataExp.getDate() + validade);

    if (editId) {
        const idx = propostas.findIndex(p => p.id === editId);
        if (idx !== -1) {
            propostas[idx].cliente = cliente;
            propostas[idx].representante = representante;
            propostas[idx].status = status;
            propostas[idx].data = dataISO;
            propostas[idx].validade = validade;
            propostas[idx].dataExpiracao = dataExp.toISOString();
            propostas[idx].itens = itens;
            propostas[idx].valorTotal = valorTotal;
            propostas[idx].observacoes = observacoes;
            if (precisaAprovacao) {
                propostas[idx].aguardandoAprovacao = true;
                propostas[idx].motivoAprovacao = motivoAprovacao;
                propostas[idx].status = 'aguardando_aprovacao';
            } else {
                propostas[idx].aguardandoAprovacao = false;
                propostas[idx].motivoAprovacao = null;
            }
        }
    } else {
        const novaProposta = {
            id: Date.now().toString(),
            numero: numero,
            cliente: cliente,
            representante: representante,
            data: dataISO,
            validade: validade,
            dataExpiracao: dataExp.toISOString(),
            status: (precisaAprovacao ? 'aguardando_aprovacao' : status),
            itens: itens,
            valorTotal: valorTotal,
            observacoes: observacoes,
            contratoNumero: null,
            vendaId: null,
            dataCriacao: new Date().toISOString()
        };
        if (precisaAprovacao) {
            novaProposta.aguardandoAprovacao = true;
            novaProposta.motivoAprovacao = motivoAprovacao;
            novaProposta.aprovadoPor = null;
            novaProposta.dataAprovacao = null;
        } else {
            novaProposta.aguardandoAprovacao = false;
            novaProposta.motivoAprovacao = null;
            novaProposta.aprovadoPor = null;
            novaProposta.dataAprovacao = null;
        }
        propostas.push(novaProposta);
    }

    estoque.propostas = propostas;
    salvarDados();
    renderizarPropostas();
    atualizarKPIsPropostas();
    fecharModal('modalProposta');
    mostrarNotificacao(editId ? 'Proposta atualizada!' : 'Proposta criada: ' + numero, 'success');
}

function salvarPropostaRascunho() {
    document.getElementById('propostaStatus').value = 'rascunho';
    salvarProposta(null);
}

let _propostaParaConverter = null;

function converterPropostaEmVenda(propostaId) {
    const proposta = (propostas||[]).find(p => p.id === propostaId);
    if (!proposta) { mostrarNotificacao('Proposta não encontrada.', 'error'); return; }

    _propostaParaConverter = proposta;

    // Calculate next contract number (format NNN/AAAA)
    const nextNum = gerarNumeroContrato();

    // Populate modal
    const contratoEl = document.getElementById('confirmarVendaContrato');
    if (contratoEl) contratoEl.value = nextNum;
    const dataEl = document.getElementById('confirmarVendaData');
    if (dataEl) dataEl.value = new Date().toISOString().split('T')[0];

    // Set representante from proposta
    const selRep = document.getElementById('confirmarVendaRepresentante');
    if (selRep && proposta.representante) selRep.value = proposta.representante;

    // Pre-fill observations
    const obsEl = document.getElementById('confirmarVendaObs');
    if (obsEl) obsEl.value = proposta.observacoes
        ? 'Gerado da proposta ' + proposta.numero + '\n' + proposta.observacoes
        : 'Gerado da proposta ' + proposta.numero;

    // Info banner
    const fmt = v => 'R$ ' + (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2});
    const infoEl = document.getElementById('confirmarVendaInfo');
    if (infoEl) infoEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px">
            <div>
                <div style="font-size:0.75rem;color:#64748b">Proposta</div>
                <div style="font-weight:700;color:#1e3a5f;font-size:1rem">${proposta.numero}</div>
            </div>
            <div>
                <div style="font-size:0.75rem;color:#64748b">Cliente</div>
                <div style="font-weight:600;color:#1e293b">${proposta.cliente}</div>
            </div>
            <div>
                <div style="font-size:0.75rem;color:#64748b">Valor Total</div>
                <div style="font-weight:800;color:#16a34a;font-size:1.1rem">
                    ${fmt(proposta.valorTotal)}
                </div>
            </div>
        </div>
    `;

    // Items table
    const itensEl = document.getElementById('confirmarVendaItens');
    if (itensEl) itensEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem">
            <thead>
                <tr style="background:#1e3a5f;color:#fff">
                    <th style="padding:8px 12px;text-align:left">Produto</th>
                    <th style="padding:8px 12px;text-align:center">Qtd</th>
                    <th style="padding:8px 12px;text-align:right">Valor Unit.</th>
                    <th style="padding:8px 12px;text-align:right">Total</th>
                </tr>
            </thead>
            <tbody>
                ${(proposta.itens||[]).map((it,i) => `
                    <tr style="background:${i%2===0?'#fff':'#f8fafc'}">
                        <td style="padding:8px 12px;font-weight:500">
                            ${it.produtoNome || it.produto || '—'}
                        </td>
                        <td style="padding:8px 12px;text-align:center">${it.quantidade}</td>
                        <td style="padding:8px 12px;text-align:right">
                            ${fmt(it.valorUnitario || it.valorUnit || 0)}
                        </td>
                        <td style="padding:8px 12px;text-align:right;font-weight:600;color:#16a34a">
                            ${fmt(it.valorTotal || (it.quantidade*(it.valorUnitario||it.valorUnit||0)))}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    document.getElementById('modalConfirmarVenda').style.display = 'flex';
}

function confirmarConversaoVenda() {
    const proposta = _propostaParaConverter;
    if (!proposta) return;

    const contratoInput = document.getElementById('confirmarVendaContrato').value?.trim();
    const data     = document.getElementById('confirmarVendaData').value;
    const rep      = document.getElementById('confirmarVendaRepresentante').value;
    const obs      = document.getElementById('confirmarVendaObs').value;
    const ano = data ? new Date(data + 'T12:00:00').getFullYear() : new Date().getFullYear();
    let contrato = contratoInput || '';
    if (!contrato.includes('/')) {
        contrato = String(parseInt(contrato || '0', 10) || 0).padStart(3, '0') + '/' + ano;
    } else {
        const parts = contrato.split('/');
        const seq = String(parseInt(parts[0] || '0', 10) || 0).padStart(3, '0');
        const yr = parts[1] || ano;
        contrato = seq + '/' + yr;
    }

    if (!contrato) {
        mostrarNotificacao('Informe o número do contrato.', 'warning');
        document.getElementById('confirmarVendaContrato').focus();
        return;
    }

    // Check if contract number already exists
    const jaExiste = (estoque.registroVendas||[])
        .some(v => v.contrato === contrato.toString());
    if (jaExiste) {
        if (!confirm(`Contrato nº ${contrato} já existe.\nDeseja usar este número mesmo assim?`))
            return;
    }

    const itensVenda = (proposta.itens||[]).map(it => ({
        produtoId:    it.produtoId   || null,
        produtoNome:  it.produtoNome || it.produto || '',
        quantidade:   it.quantidade  || 0,
        valorUnitario: it.valorUnitario || it.valorUnit || 0,
        valorTotal:   it.valorTotal  || 0,
    }));

    const novaVenda = {
        id:             Date.now(),
        contrato:       contrato.toString(),
        loja:           proposta.cliente,
        representante:  rep || proposta.representante || '',
        data:           data || new Date().toISOString().split('T')[0],
        items:          itensVenda,
        itens:          itensVenda,
        quantidadeTotal: itensVenda.reduce((s,i) => s+i.quantidade, 0),
        valorTotal:     proposta.valorTotal,
        observacoes:    obs,
        propostaId:     proposta.id,
        propostaNumero: proposta.numero,
    };

    estoque.registroVendas.push(novaVenda);
    proposta.status         = 'aceita';
    proposta.contratoNumero = contrato;
    proposta.vendaId        = novaVenda.id;
    estoque.propostas = propostas;

    salvarDados();
    fecharModal('modalConfirmarVenda');
    _propostaParaConverter = null;

    try { renderizarRegistroVendas(); } catch(e) {}
    try { renderizarPropostas(); } catch(e) {}
    try { atualizarKPIsPropostas(); } catch(e) {}
    try { renderizarTabela(); } catch(e) {}
    try { renderizarDashboard(); } catch(e) {}
    try {
        const c = (clientes||[]).find(x => x.nome === proposta.cliente);
        if (c) atualizarStatusPropostaNaPrecif(c.id);
    } catch(e) {}

    mostrarNotificacao(
        `✅ Contrato nº ${contrato} criado! Venda registrada com sucesso.`,
        'success'
    );
    trocarAba('vendas');
}

function excluirProposta(id) {
    if (!requireAdminOrNotify()) return;
    const proposta = propostas.find(p => p.id === id);
    if (!proposta) return;
    if (!confirm('Excluir proposta ' + proposta.numero + '?')) return;

    propostas = propostas.filter(p => p.id !== id);
    estoque.propostas = propostas;
    salvarDados();
    renderizarPropostas();
    atualizarKPIsPropostas();
    mostrarNotificacao('Proposta excluída.', 'success');
}

function recusarProposta(id) {
    if (!requireAdminOrNotify()) return;
    const p = (propostas || []).find(x => x.id === id);
    if (!p) return;
    const motivo = prompt(
        `Recusar proposta ${p.numero}?\n\n` +
        `Informe o motivo da recusa (aparecerá no histórico do cliente):\n` +
        `(Ex: "Preço acima do orçamento", "Concorrente venceu", ` +
        `"Cliente desistiu", "Prazo de entrega")`
    );
    if (motivo === null) return; // user cancelled

    p.status = 'recusada';
    p.motivoRecusa = motivo || 'Sem motivo informado';
    p.dataRecusa = new Date().toISOString();
    try { estoque.propostas = propostas; } catch (e) {}
    salvarDados();
    try { renderizarPropostas(); } catch (e) {}
    try { atualizarKPIsPropostas(); } catch (e) {}
    mostrarNotificacao(`Proposta ${p.numero} marcada como recusada.`, 'warning');
    try { registrarHistorico('proposta_recusada', `Proposta ${p.numero} recusada: ${p.motivoRecusa}`); } catch (e) {}
}

function renderizarPropostas(filtro, statusFiltro) {
    const tbody = document.getElementById('tabelaPropostasBody');
    if (!tbody) return;

    if (filtro === undefined) filtro = (document.getElementById('filtroProposta')?.value || '').trim().toLowerCase();
    else filtro = (filtro || '').trim().toLowerCase();
    if (statusFiltro === undefined) statusFiltro = document.getElementById('filtroStatusProposta')?.value || '';

    const agora = new Date();
    propostas.forEach(p => {
        if (p.status === 'enviada' && p.dataExpiracao && new Date(p.dataExpiracao) < agora) {
            p.status = 'expirada';
        }
    });

    let lista = propostas;
    if (filtro) {
        lista = lista.filter(p =>
            (p.numero || '').toLowerCase().includes(filtro) ||
            (p.cliente || '').toLowerCase().includes(filtro) ||
            (p.representante || '').toLowerCase().includes(filtro)
        );
    }
    if (statusFiltro) {
        lista = lista.filter(p => p.status === statusFiltro);
    }

    const statusLabels = {
        rascunho: { label: 'Rascunho', bg: '#6b7280' },
        enviada:  { label: 'Enviada',  bg: '#0ea5e9' },
        aceita:   { label: 'Aceita',   bg: '#22c55e' },
        recusada: { label: 'Recusada', bg: '#ef4444' },
        aguardando_aprovacao: { label: '⏳ Aguard. Aprovação', bg: '#7c3aed' },
        expirada: { label: 'Expirada', bg: '#f59e0b' }
    };

    // Aplicar ordenação de propostas se houver
    const sortP = _sortState['propostas'] || { col: 'data', dir: 'desc' };
    const getValProposta = (p, col) => {
        if (!p) return '';
        if (col === 'numero') return Number(p.numero || 0);
        if (col === 'cliente') return p.cliente || '';
        if (col === 'representante') return p.representante || '';
        if (col === 'valorTotal') return Number(p.valorTotal || 0);
        if (col === 'data') return p.data || p.dataCriacao || '';
        if (col === 'contrato') return p.contratoNumero || p.contrato || '';
        if (col === 'status') return p.status || '';
        return p[col] ?? '';
    };
    const listaOrdenada = getSortedArray(lista, sortP.col, sortP.dir, getValProposta);

    tbody.innerHTML = listaOrdenada.map(p => {
        const repClass = (p.representante || '').toLowerCase();
        const statusConf = statusLabels[p.status] || statusLabels.rascunho;
        const dataProposta = p.data ? new Date(p.data).toLocaleDateString('pt-BR') : '-';
        const dataValidade = p.dataExpiracao ? new Date(p.dataExpiracao).toLocaleDateString('pt-BR') : '-';
        const validadeExpirada = p.dataExpiracao && new Date(p.dataExpiracao) < agora;
        const contratoDisplay = p.contratoNumero ? p.contratoNumero : '-';

        const podeConverter = p.status === 'rascunho' || p.status === 'enviada';

        const motivoRecusaEsc = p.motivoRecusa ? _escapeHtml(String(p.motivoRecusa)) : '';
        const motivoRecusaSmall = (p.status === 'recusada' && p.motivoRecusa) ? `<div style="font-size:0.75rem;color:#dc2626;margin-top:2px;max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${motivoRecusaEsc}">↳ ${motivoRecusaEsc}</div>` : '';

        // Resumo do primeiro item da proposta (exibir produto, qtd e valor unitário)
        const itensArr = Array.isArray(p.itens) ? p.itens : [];
        const primeiroItem = (itensArr && itensArr.length) ? itensArr[0] : null;
        const produtoDisplay = primeiroItem ? (_escapeHtml(primeiroItem.produto || primeiroItem.produtoNome || '-')) + (itensArr.length > 1 ? ` <span style="color:#64748b;font-size:0.78rem">+${itensArr.length-1}</span>` : '') : '-';
        const qtdDisplay = primeiroItem ? (primeiroItem.quantidade || 0) : '-';
        const unitDisplay = primeiroItem ? formatarMoedaValor(Number(primeiroItem.valorUnitario || primeiroItem.precoFinalCalc || 0)) : '-';

        return `<tr>
            <td><span style="background:#0ea5e9; color:#fff; padding:2px 10px; border-radius:12px; font-size:0.82rem; font-weight:600;">${_escapeHtml(String(p.numero || ''))}</span></td>
            <td style="text-align:left">${_escapeHtml(p.cliente || '-')}</td>
            <td><span class="badge-rep ${repClass}">${_escapeHtml(p.representante || '-')}</span></td>
            <td style="text-align:left">${produtoDisplay}</td>
            <td style="text-align:center">${qtdDisplay}</td>
            <td style="text-align:right">${unitDisplay}</td>
            <td style="color:#16a34a; font-weight:600">${formatarMoedaValor(p.valorTotal || 0)}</td>
            <td>${dataProposta}</td>
            <td style="${validadeExpirada ? 'color:#ef4444; font-weight:600' : ''}">${dataValidade}</td>
            <td><span style="background:${statusConf.bg}; color:#fff; padding:2px 10px; border-radius:12px; font-size:0.8rem;">${statusConf.label}</span>${motivoRecusaSmall}</td>
            <td style="font-weight:600">${_escapeHtml(String(contratoDisplay))}</td>
            <td style="font-size:0.78rem;color:#dc2626;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${motivoRecusaEsc}">${p.status === 'recusada' && p.motivoRecusa ? motivoRecusaEsc : '—'}</td>
            <td>
                                <div style="position:relative;display:inline-block">
                                    <button class="btn btn-outline btn-sm" onclick="toggleMenuPDF('${p.id}')" id="btnPDF_${p.id}">
                                        📄 PDF ▾
                                    </button>
                                    <div id="menuPDF_${p.id}" style="display:none;position:absolute;right:0;top:100%;z-index:100;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.12);min-width:180px;padding:4px 0">
                                        <button onclick="gerarPdfProposta('${p.id}','simples')" style="display:block;width:100%;text-align:left;padding:8px 14px;border:none;background:none;cursor:pointer;font-size:0.85rem">
                                            📋 Proposta simples
                                        </button>
                                        <button onclick="gerarPdfProposta('${p.id}','fiscal')" style="display:block;width:100%;text-align:left;padding:8px 14px;border:none;background:none;cursor:pointer;font-size:0.85rem">
                                            🧾 Com detalhamento fiscal
                                        </button>
                                    </div>
                                </div>
                ${(p.aguardandoAprovacao || p.status === 'aguardando_aprovacao') ? `<button class="btn btn-success btn-sm" data-admin="true" onclick="aprovarProposta('${p.id}')" title="Aprovar">✅ Aprovar</button><button class="btn btn-danger btn-sm" data-admin="true" onclick="recusarAprovacaoProposta('${p.id}')" title="Recusar">❌ Recusar</button>` : ''}
                <button class="btn btn-outline btn-sm" data-admin="true" onclick="abrirModalProposta('${p.id}')" title="Editar">✏️</button>
                ${podeConverter ? `<button class="btn btn-success btn-sm" data-admin="true" onclick="converterPropostaEmVenda('${p.id}')" title="Converter em Venda" style="font-size:0.78rem;">🔄</button>` : ''}
                ${p.status === 'enviada' ? `<button class="btn btn-outline btn-sm" data-admin="true" onclick="recusarProposta('${p.id}')" title="Recusar" style="color:#dc2626">❌</button>` : ''}
                <button class="btn btn-outline btn-sm" data-admin="true" onclick="excluirProposta('${p.id}')" title="Excluir" style="color:#ef4444">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

function toggleMenuPDF(id) {
        document.querySelectorAll('[id^="menuPDF_"]').forEach(m => {
                m.style.display = 'none';
        });
        const menu = document.getElementById('menuPDF_' + id);
        if (menu) menu.style.display = 'block';
        setTimeout(() => {
                document.addEventListener('click', function close(e) {
                        if (menu && !menu.contains(e.target)) {
                                menu.style.display = 'none';
                                document.removeEventListener('click', close);
                        }
                });
        }, 0);
}

function filtrarPropostas(valor) {
    const statusVal = document.getElementById('filtroStatusProposta')?.value || '';
    renderizarPropostas(valor || '', statusVal);
}

function atualizarKPIsPropostas() {
    const abertas = propostas.filter(p => p.status === 'rascunho' || p.status === 'enviada').length;
    const aceitas = propostas.filter(p => p.status === 'aceita').length;
    const recusadas = propostas.filter(p => p.status === 'recusada').length;
    const totalNaoRascunho = propostas.filter(p => p.status !== 'rascunho').length;
    const taxa = totalNaoRascunho > 0 ? ((aceitas / totalNaoRascunho) * 100).toFixed(1) : '0';

    const elAbertas = document.getElementById('kpiPropostasAbertas');
    const elAceitas = document.getElementById('kpiPropostasAceitas');
    const elRecusadas = document.getElementById('kpiPropostasRecusadas');
    const elTaxa = document.getElementById('kpiTaxaConversao');
    if (elAbertas) elAbertas.textContent = abertas;
    if (elAceitas) elAceitas.textContent = aceitas;
    if (elRecusadas) elRecusadas.textContent = recusadas;
    if (elTaxa) elTaxa.textContent = taxa + '%';
}

function preencherDadosCliente(nomeCliente) {
    if (!nomeCliente) return;
    const repSelect = document.getElementById('propostaRepresentante');
    if (!repSelect || repSelect.value) return;
    const cliente = (clientes || []).find(c => (c.nome || '').toLowerCase() === nomeCliente.toLowerCase());
    if (cliente && cliente.representante) {
        repSelect.value = cliente.representante;
    }
}

function imprimirPropostas() {
    const tabEl = document.getElementById('tab-propostas');
    if (!tabEl) return;
    const html = tabEl.querySelector('.table-container')?.innerHTML || '';
    const win = window.open('', '_blank');
    if (!win) { mostrarNotificacao('Pop-up bloqueado pelo navegador.', 'error'); return; }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Propostas Comerciais</title>
        <style>body{font-family:Inter,Arial,sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px 8px;font-size:11px}th{background:#f5f5f5;font-weight:600}.badge-rep,.btn{font-size:10px}span[style*="background"]{padding:2px 8px;border-radius:10px;font-size:10px}</style>
        <script>window.onload=function(){ setTimeout(function(){ window.print(); },200); }<\/script>
    </head><body><h2>Propostas Comerciais</h2>${html}</body></html>`);
    win.document.close();
}

function exportarPropostasExcel() {
    const filtroTexto = (document.getElementById('filtroProposta')?.value || '').trim().toLowerCase();
    const filtroStatus = document.getElementById('filtroStatusProposta')?.value || '';

    let lista = propostas || [];
    if (filtroTexto) {
        lista = lista.filter(p =>
            (p.numero || '').toLowerCase().includes(filtroTexto) ||
            (p.cliente || '').toLowerCase().includes(filtroTexto) ||
            (p.representante || '').toLowerCase().includes(filtroTexto)
        );
    }
    if (filtroStatus) {
        lista = lista.filter(p => p.status === filtroStatus);
    }

    if (!lista.length) {
        mostrarNotificacao('Nenhuma proposta para exportar com os filtros atuais.', 'warning');
        return;
    }

    const agora = new Date();
    const fmt = v => parseFloat((v || 0).toFixed(2));
    const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '';

    const statusLabel = {
        rascunho:  'Rascunho',
        enviada:   'Enviada',
        aceita:    'Aceita',
        recusada:  'Recusada',
        expirada:  'Expirada',
        convertida: 'Convertida',
        aguardando_aprovacao: 'Aguardando Aprovação',
    };

    const rowsResumo = lista
        .slice()
        .sort((a, b) => new Date(b.dataCriacao || b.data || 0) - new Date(a.dataCriacao || a.data || 0))
        .map(p => {
            const exp = p.dataExpiracao ? new Date(p.dataExpiracao) : null;
            const diasParaVencer = exp ? Math.ceil((exp - agora) / 86400000) : null;
            return {
                'Proposta':          p.numero       || '',
                'Cliente':           p.cliente      || '',
                'Representante':     p.representante || '',
                'Status':            statusLabel[p.status] || p.status || '',
                'Valor Total (R$)':  fmt(p.valorTotal),
                'Data Criação':      fmtDate(p.dataCriacao || p.data),
                'Data Validade':     fmtDate(p.dataExpiracao),
                'Dias p/ Vencer':    diasParaVencer !== null ? (diasParaVencer < 0 ? 'Expirada' : diasParaVencer + 'd') : '',
                'Contrato Gerado':   p.contratoNumero || '',
                'Qtd Itens':         (p.itens || []).length,
                'Motivo Recusa':     p.motivoRecusa  || '',
                'Observações':       p.observacoes   || '',
            };
        });

    const rowsItens = [];
    lista.forEach(p => {
        (p.itens || []).forEach(item => {
            rowsItens.push({
                'Proposta':         p.numero       || '',
                'Cliente':          p.cliente      || '',
                'Representante':    p.representante || '',
                'Status':           statusLabel[p.status] || p.status || '',
                'Data Criação':     fmtDate(p.dataCriacao || p.data),
                'Produto':          item.produtoNome || item.produto || '',
                'Quantidade':       item.quantidade  || 0,
                'Valor Unitário (R$)': fmt(item.valorUnitario || item.valorUnit || 0),
                'Total Item (R$)':  fmt(item.valorTotal || (item.quantidade || 0) * (item.valorUnitario || item.valorUnit || 0)),
                'Total Proposta (R$)': fmt(p.valorTotal),
            });
        });
    });

    try {
        const wsResumo = XLSX.utils.json_to_sheet(rowsResumo);
        const wsItens = XLSX.utils.json_to_sheet(rowsItens.length ? rowsItens : [{ 'Info': 'Nenhum item detalhado disponível' }]);

        wsResumo['!cols'] = [
            { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 35 }, { wch: 40 }
        ];

        wsItens['!cols'] = [
            { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 35 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 18 }
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsResumo, 'Propostas');
        XLSX.utils.book_append_sheet(wb, wsItens, 'Itens Detalhados');

        const sufixo = filtroStatus ? '_' + filtroStatus : '';
        XLSX.writeFile(wb, 'propostas' + sufixo + '_' + new Date().toISOString().split('T')[0] + '.xlsx');

        mostrarNotificacao(`${rowsResumo.length} proposta(s) exportada(s) com sucesso!`, 'success');
    } catch (e) {
        console.error('Erro ao exportar propostas:', e);
        mostrarNotificacao('Erro ao gerar arquivo Excel.', 'error');
    }
}

// ========================================
// PROGRESS BAR (CLOUD OPERATIONS)
// ========================================

function showProgressBar(text) {
    const el = document.getElementById('progressBar');
    const fill = document.getElementById('progressBarFill');
    const txt = document.getElementById('progressBarText');
    if (!el) return;
    el.style.display = 'block';
    fill.style.width = '10%';
    txt.textContent = text || 'Processando...';
    // Simulate progress
    let pct = 10;
    window._progressInterval = setInterval(() => {
        pct = Math.min(pct + Math.random() * 15, 90);
        fill.style.width = pct + '%';
    }, 300);
}

function hideProgressBar() {
    const el = document.getElementById('progressBar');
    const fill = document.getElementById('progressBarFill');
    if (!el) return;
    clearInterval(window._progressInterval);
    fill.style.width = '100%';
    setTimeout(() => {
        el.style.display = 'none';
        fill.style.width = '0%';
    }, 500);
}

// ========================================
// HISTÓRICO DE ALTERAÇÕES (AUDIT LOG)
// ========================================

function getHistorico() {
    try {
        return JSON.parse(localStorage.getItem('estoqueHistorico') || '[]');
    } catch(e) { return []; }
}

function salvarHistorico(hist) {
    // Manter últimos 200 registros
    const trimmed = hist.slice(-200);
    localStorage.setItem('estoqueHistorico', JSON.stringify(trimmed));
}

function registrarHistorico(tipo, descricao) {
    const hist = getHistorico();
    hist.push({
        data: new Date().toISOString(),
        tipo: tipo,
        descricao: descricao
    });
    salvarHistorico(hist);
}

function abrirHistorico() {
    const hist = getHistorico().reverse();
    const container = document.getElementById('historicoConteudo');
    if (!container) return;

    if (hist.length === 0) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px">Nenhuma alteração registrada.</p>';
    } else {
        container.innerHTML = hist.map(h => {
            const dt = new Date(h.data).toLocaleString('pt-BR');
            return `<div class="historico-item">
                <span class="hist-data">${dt}</span>
                <span class="hist-tipo ${h.tipo}">${h.tipo}</span>
                <span class="hist-descricao">${h.descricao}</span>
            </div>`;
        }).join('');
    }

    document.getElementById('modalHistorico').style.display = 'flex';
}

function limparHistorico() {
    localStorage.removeItem('estoqueHistorico');
    const container = document.getElementById('historicoConteudo');
    if (container) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-secondary);padding:20px">Nenhuma alteração registrada.</p>';
    }
}
// ========================================

function validarContratoUnico(contrato, vendaIdEditando) {
    const existente = (estoque.registroVendas || []).some(v =>
        v.contrato === contrato && v.id !== vendaIdEditando
    );
    return !existente;
}

// ========================================
// RELATÓRIO DE DISTRIBUIÇÃO
// ========================================

function prepararRelatorioDistribuicao() {
    const preview = document.getElementById('relatoriosPreview');
    if (!preview) return;

    const filtroRep = document.getElementById('filtroRelatoriosRep')?.value || '';
    const dataInicio = document.getElementById('filtroRelatoriosDataInicio')?.value || '';
    const dataFim = document.getElementById('filtroRelatoriosDataFim')?.value || '';

    let distribuicoes = [...(estoque.registroDistribuicao || [])];
    let devolucoes = [...(estoque.registroDevolucoes || [])];

    if (filtroRep) {
        distribuicoes = distribuicoes.filter(d => d.representante === filtroRep);
        devolucoes = devolucoes.filter(d => d.origem === filtroRep);
    }

    // Filtrar por data (comparação por DATA YYYY-MM-DD para evitar timezone/formato)
    const aplicarFiltroData = (arr) => {
        if ((!dataInicio || dataInicio === '') && (!dataFim || dataFim === '')) return arr;
        return arr.filter(d => {
            if (!d.data) return false;
            const registroDateStr = parseDateToYYYYMMDD(d.data);
            if (!registroDateStr) return false;
            if (dataInicio && dataInicio !== '' && registroDateStr < dataInicio) return false;
            if (dataFim && dataFim !== '' && registroDateStr > dataFim) return false;
            return true;
        });
    };

    distribuicoes = aplicarFiltroData(distribuicoes);
    devolucoes = aplicarFiltroData(devolucoes);

    // Ordenar por data (mais recente primeiro)
    distribuicoes.sort((a, b) => new Date(b.data) - new Date(a.data));
    devolucoes.sort((a, b) => new Date(b.data) - new Date(a.data));

    // Agrupar por representante (considerar reps presentes em distribuições E devoluções)
    const porRep = {};
    distribuicoes.forEach(d => {
        if (!porRep[d.representante]) porRep[d.representante] = { distrib: [], devol: [] };
        porRep[d.representante].distrib.push(d);
    });
    devolucoes.forEach(d => {
        const rep = d.origem || 'IMBEL';
        if (!porRep[rep]) porRep[rep] = { distrib: [], devol: [] };
        porRep[rep].devol.push(d);
    });

    const container = document.createElement('div');
    container.className = 'report-distribuicao';

    let totalGeral = 0;

    Object.keys(porRep).sort().forEach(rep => {
        const grupo = porRep[rep];
        const titulo = document.createElement('h3');
        titulo.textContent = `Representante: ${rep}`;
        titulo.style.margin = '12px 0 6px 0';
        container.appendChild(titulo);

        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        table.innerHTML = `<thead><tr>
            <th style="padding:6px;border:1px solid #ddd;text-align:left">Produto</th>
            <th style="padding:6px;border:1px solid #ddd;text-align:center">Qtd</th>
            <th style="padding:6px;border:1px solid #ddd;text-align:center">Data</th>
            <th style="padding:6px;border:1px solid #ddd;text-align:left">Obs</th>
        </tr></thead><tbody></tbody>`;

        const tbody = table.querySelector('tbody');
        // combinar listas preservando tipo
        const items = [];
        (grupo.distrib || []).forEach(d => items.push(Object.assign({ tipo: 'dist' }, d)));
        (grupo.devol || []).forEach(d => items.push(Object.assign({ tipo: 'dev' }, d)));

        // ordenar por data desc
        items.sort((a, b) => new Date(b.data) - new Date(a.data));

        let subtotalDist = 0;
        let subtotalDev = 0;
        items.forEach(d => {
            if (d.tipo === 'dist') {
                subtotalDist += d.quantidade || 0;
                totalGeral += d.quantidade || 0;
            } else {
                subtotalDev += d.quantidade || 0;
                totalGeral -= d.quantidade || 0;
            }

            const parsed = parseDateToYYYYMMDD(d.data);
            const dataFmt = parsed ? new Date(parsed).toLocaleDateString('pt-BR') : '-';
            const tr = document.createElement('tr');
            const qtdDisplay = d.tipo === 'dev' ? `-${d.quantidade}` : `${d.quantidade}`;
            const obs = d.tipo === 'dev' ? (d.observacoes ? `Devolução: ${d.observacoes}` : 'Devolução') : (d.observacoes || '-');
            tr.innerHTML = `
                <td style="padding:6px;border:1px solid #ddd">${d.produtoNome}</td>
                <td style="padding:6px;border:1px solid #ddd;text-align:center">${qtdDisplay}</td>
                <td style="padding:6px;border:1px solid #ddd;text-align:center">${dataFmt}</td>
                <td style="padding:6px;border:1px solid #ddd">${obs}</td>`;
            if (d.tipo === 'dev') tr.style.background = '#fff7f7';
            tbody.appendChild(tr);
        });

        const trSubtotal = document.createElement('tr');
        trSubtotal.innerHTML = `<td colspan="1" style="padding:6px;border:1px solid #ddd;text-align:right"><strong>Distribuído: ${subtotalDist} — Devolvido: ${subtotalDev}</strong></td>
            <td style="padding:6px;border:1px solid #ddd;text-align:center"><strong>Saldo: ${subtotalDist - subtotalDev}</strong></td>
            <td colspan="2" style="padding:6px;border:1px solid #ddd"></td>`;
        tbody.appendChild(trSubtotal);
        container.appendChild(table);
    });

    const resumo = document.createElement('div');
    resumo.style.cssText = 'margin:12px 0;font-size:1rem;font-weight:700';
    resumo.textContent = `Total Geral Distribuído: ${totalGeral} unidades`;
    container.insertBefore(resumo, container.firstChild);

    preview.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'report-printable';
    wrapper.appendChild(container);
    preview.appendChild(wrapper);
}

// ========================================
// EXPORTAR PDF (jsPDF)
// ========================================

function exportarRelatorioPDF() {
    if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
        mostrarNotificacao('Biblioteca jsPDF não carregada. Tente novamente.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const tipo = document.getElementById('filtroRelatoriosTipo')?.value || 'inventario';
    const orient = document.getElementById('filtroRelatoriosOrientacao')?.value || 'landscape';

    const doc = new jsPDF({ orientation: orient, unit: 'mm', format: 'a4' });
    doc.setFont('helvetica');

    const dataAgora = new Date().toLocaleString('pt-BR');
    let titulo = 'Relatório';

    if (tipo === 'inventario') {
        titulo = 'Inventário de Produtos';
        // Build table data from estoque
        const headers = [['Produto', 'Disp', 'Venda', 'Saldo']];
        const data = estoque.produtos.map(p => {
            let d = 0, v = 0;
            estoque.representantes.forEach(r => { d += (p.distribuicao[r]||0); v += (p.vendas[r]||0); });
            return [p.nome, d.toString(), v.toString(), (d-v).toString()];
        });
        doc.setFontSize(14);
        doc.text(titulo, 14, 15);
        doc.setFontSize(9);
        doc.text(`Data: ${dataAgora}`, 14, 22);
        doc.autoTable({ head: headers, body: data, startY: 26, styles: { fontSize: 8 } });
    } else if (tipo === 'comissoes') {
        titulo = 'Relatório de Comissões (5%)';
        const vendas = (estoque.registroVendas || []).filter(v => (v.representante||'').toUpperCase() !== 'IMBEL');
        const obterValorVenda = (venda) => {
            if (typeof venda.valorTotal === 'number') return venda.valorTotal;
            if (Array.isArray(venda.items) && venda.items.length > 0) {
                return venda.items.reduce((s, it) => s + (Number(it.valorTotal) || ((Number(it.valorUnitario) || 0) * (Number(it.quantidade) || 0))), 0);
            }
            return ((Number(venda.valorUnitario) || 0) * (Number(venda.quantidade) || 0));
        };
        const normalizarContrato = (valor) => {
            const bruto = (valor ?? '').toString().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF\s]+/g, '');
            const digitos = bruto.replace(/\D+/g, '');
            return digitos ? String(parseInt(digitos, 10)) : bruto.toUpperCase();
        };
        const contratosMap = new Map();
        vendas.forEach(v => {
            const contratoKey = normalizarContrato(v.contrato);
            if (!contratoKey) return;
            const mapKey = `${v.representante || ''}||${contratoKey}`;
            const dataNorm = parseDateToYYYYMMDD(v.data);
            const atual = contratosMap.get(mapKey) || { representante: v.representante || '', contrato: contratoKey, loja: v.loja || '', valor: 0, dataMin: null, dataMax: null };
            atual.valor += obterValorVenda(v);
            if (!atual.loja && v.loja) atual.loja = v.loja;
            if (dataNorm) {
                if (!atual.dataMin || dataNorm < atual.dataMin) atual.dataMin = dataNorm;
                if (!atual.dataMax || dataNorm > atual.dataMax) atual.dataMax = dataNorm;
            }
            contratosMap.set(mapKey, atual);
        });
        const contratos = Array.from(contratosMap.values());
        const headers = [['Rep', 'Contrato', 'Cliente', 'Data', 'Valor', 'Comissão 5%']];
        const data = contratos.map(c => {
            const valor = c.valor || 0;
            const dataTexto = c.dataMin
                ? (c.dataMax && c.dataMax !== c.dataMin
                    ? `${new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR')} até ${new Date(c.dataMax + 'T00:00:00').toLocaleDateString('pt-BR')}`
                    : new Date(c.dataMin + 'T00:00:00').toLocaleDateString('pt-BR'))
                : '-';
            return [c.representante, c.contrato, c.loja, dataTexto, formatarMoedaValor(valor), formatarMoedaValor(Math.round(valor*0.05*100)/100)];
        });
        doc.setFontSize(14);
        doc.text(titulo, 14, 15);
        doc.setFontSize(9);
        doc.text(`Data: ${dataAgora}`, 14, 22);
        doc.autoTable({ head: headers, body: data, startY: 26, styles: { fontSize: 8 } });
    } else if (tipo === 'distribuicao') {
        titulo = 'Relatório de Distribuição';
        const headers = [['Rep', 'Produto', 'Qtd', 'Data', 'Obs']];
        // combinar distribuições e devoluções (devoluções aparecem como quantidade negativa)
        const distrib = (estoque.registroDistribuicao || []).map(d => ({ rep: d.representante, produto: d.produtoNome, qtd: Number(d.quantidade||0), data: d.data || '', obs: d.observacoes || '', tipo: 'D' }));
        const devol = (estoque.registroDevolucoes || []).map(d => ({ rep: d.origem || '', produto: d.produtoNome, qtd: -(Number(d.quantidade||0)), data: d.data || '', obs: d.observacoes || '', tipo: 'R' }));
        const combined = [...distrib, ...devol].sort((a,b) => new Date(b.data||0) - new Date(a.data||0));
        const data = combined.map(d => [d.rep, d.produto, d.qtd.toString(), d.data ? new Date(d.data+'T00:00:00').toLocaleDateString('pt-BR') : '-', (d.tipo==='R'?'Devolução: ':'') + (d.obs || '-')]);
        doc.setFontSize(14);
        doc.text(titulo, 14, 15);
        doc.setFontSize(9);
        doc.text(`Data: ${dataAgora}`, 14, 22);
        doc.autoTable({ head: headers, body: data, startY: 26, styles: { fontSize: 8 } });
    }

    doc.save(`${titulo.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.pdf`);
    mostrarNotificacao('PDF exportado com sucesso!', 'success');
}

// ========================================
// VISUALIZAR RELATÓRIO (atualizado com distribuição)
// ========================================

// Override visualizarRelatorioSelecionado
const _visualizarRelatorioOriginal = visualizarRelatorioSelecionado;
visualizarRelatorioSelecionado = function() {
    const tipo = document.getElementById('filtroRelatoriosTipo')?.value || 'inventario';
    if (tipo === 'distribuicao') {
        prepararRelatorioDistribuicao();
    } else if (tipo === 'comissoes') {
        prepararRelatorioComissoes();
    } else {
        prepararRelatorioInventario();
    }
};

// ========================================
// HOOK: REGISTRAR HISTÓRICO EM OPERAÇÕES
// ========================================

// Wrap salvarVendaDetalhada
const _salvarVendaDetalhadaOriginal = salvarVendaDetalhada;
// Note: can't easily wrap form submit handlers, so we hook into salvarDados
const _salvarDadosOriginal = salvarDados;

// Hook renderizarDashboard to include charts
const _renderizarDashboardOriginal = renderizarDashboard;
renderizarDashboard = function() {
    _renderizarDashboardOriginal();
    try { renderizarGraficos(); } catch(e) { console.warn('Erro renderizando gráficos:', e); }
};

// Hook renderizarRegistroVendas to include pagination and date filters
const _renderizarRegistroVendasOriginal = renderizarRegistroVendas;
renderizarRegistroVendas = function() {
    // Delega para a implementação principal corrigida (com agrupamento por contrato e colunas alinhadas)
    _renderizarRegistroVendasOriginal();

    // Limpar paginação antiga para não confundir a interface
    const pag = document.getElementById('paginacaoVendas');
    if (pag) pag.innerHTML = '';
};

// Hook renderizarRegistroDistribuicao to include pagination, date filters and sorting
const _renderizarRegistroDistribuicaoOriginal = renderizarRegistroDistribuicao;
renderizarRegistroDistribuicao = function() {
    const tbody = document.getElementById('tabelaRegistroDistribuicaoBody');
    if (!tbody) return;

    const filtroRep = document.getElementById('filtroDistribuicaoRep')?.value || '';
    const filtroProduto = document.getElementById('filtroDistribuicaoProduto')?.value || '';
    const dataInicio = document.getElementById('filtroDistribuicaoDataInicio')?.value || '';
    const dataFim = document.getElementById('filtroDistribuicaoDataFim')?.value || '';

    // Combina distribuições e devoluções para a visualização; devoluções serão marcadas com tipo 'dev'
    const distrib = (estoque.registroDistribuicao || []).map(d => Object.assign({}, d, { tipo: 'dist' }));
    const devol = (estoque.registroDevolucoes || []).map(d => Object.assign({}, d, { tipo: 'dev', representante: d.origem, produtoNome: d.produtoNome, produtoId: d.produtoId }));

    let combinado = [...distrib, ...devol];

    if (filtroRep) combinado = combinado.filter(d => (d.representante || '') === filtroRep);
    if (filtroProduto) combinado = combinado.filter(d => (d.produtoId || 0) === parseInt(filtroProduto));

    // Filtro por data com boundaries
    if (dataInicio || dataFim) {
        const start = dataInicio ? new Date(dataInicio + 'T00:00:00').getTime() : null;
        const end = dataFim ? new Date(dataFim + 'T23:59:59').getTime() : null;
        combinado = combinado.filter(d => {
            if (!d.data) return false;
            const t = new Date(d.data + (d.data.length===10 ? 'T00:00:00' : '')).getTime();
            if (start && t < start) return false;
            if (end && t > end) return false;
            return true;
        });
    }

    // Ordenação com suporte a campos e tipos
    const campo = _ordenDistribuicao.campo;
    const dir = _ordenDistribuicao.direcao === 'asc' ? 1 : -1;
    combinado.sort((a, b) => {
        let va, vb;
        if (campo === 'representante') { va = (a.representante||'').toString(); vb = (b.representante||'').toString(); }
        else if (campo === 'produtoNome') { va = (a.produtoNome||'').toString(); vb = (b.produtoNome||'').toString(); }
        else if (campo === 'quantidade') { va = (a.tipo === 'dev' ? -(a.quantidade||0) : (a.quantidade||0)); vb = (b.tipo === 'dev' ? -(b.quantidade||0) : (b.quantidade||0)); }
        else if (campo === 'data') { va = a.data || ''; vb = b.data || ''; }
        else { va = a.data || ''; vb = b.data || ''; }
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });

    tbody.innerHTML = '';

    if (combinado.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><div class="empty-icon">🚚</div><div class="empty-text">Nenhuma distribuição ou devolução registrada</div><div class="empty-hint">Clique em "Nova Distribuição" ou registre uma devolução</div></td></tr>`;
        atualizarTotaisDistribuicao(0);
        renderizarPaginacao('paginacaoDistribuicao', 1, 0, _itensPorPaginaDistribuicao, 'mudarPaginaDistribuicao', 'mudarItensPaginaDistribuicao');
        return;
    }

    const totalLinhas = combinado.length;
    const totalPaginas = Math.max(1, Math.ceil(totalLinhas / _itensPorPaginaDistribuicao));
    if (_paginaDistribuicao > totalPaginas) _paginaDistribuicao = totalPaginas;
    const inicio = (_paginaDistribuicao - 1) * _itensPorPaginaDistribuicao;
    const pagina = combinado.slice(inicio, inicio + _itensPorPaginaDistribuicao);

    let totalQtd = 0;
    combinado.forEach(d => { totalQtd += (d.tipo === 'dev' ? -(d.quantidade||0) : (d.quantidade||0)); });

    let numero = totalLinhas - inicio;

    pagina.forEach(item => {
        const repClass = (item.representante || '').toLowerCase();
        const dataFormatada = item.data ? new Date(item.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
        const tr = document.createElement('tr');
        const qtdDisplay = item.tipo === 'dev' ? `-${(item.quantidade||0)}` : `${(item.quantidade||0)}`;
        const obs = item.tipo === 'dev' ? (item.observacoes ? `Devolução: ${item.observacoes}` : 'Devolução') : (item.observacoes || '-');
        const acaoBtn = item.tipo === 'dev'
            ? `<button class="btn-action btn-delete" onclick="excluirDevolucao(${item.id})" title="Excluir devolução">🗑</button>`
            : `<button class="btn-action btn-delete" onclick="excluirDistribuicao(${item.id})" title="Excluir">🗑</button>`;

        tr.innerHTML = `
            <td class="col-contrato">${numero--}</td>
            <td class="col-loja"><span class="badge-rep ${repClass}">${item.representante || '-'}</span></td>
            <td class="col-produto-venda" title="${item.produtoNome || '-'}">${item.produtoNome || '-'}</td>
            <td class="col-qtd">${qtdDisplay}</td>
            <td>${dataFormatada}</td>
            <td class="col-obs" title="${obs}">${obs}</td>
            <td class="col-acoes">${acaoBtn}</td>`;
        if (item.tipo === 'dev') tr.style.background = '#fff7f7';
        tbody.appendChild(tr);
    });

    atualizarTotaisDistribuicao(totalQtd);
    renderizarPaginacao('paginacaoDistribuicao', _paginaDistribuicao, totalLinhas, _itensPorPaginaDistribuicao, 'mudarPaginaDistribuicao', 'mudarItensPaginaDistribuicao');
};

// Hook limparFiltrosVendas to clear date fields
const _limparFiltrosVendasOriginal = limparFiltrosVendas;
limparFiltrosVendas = function() {
    const filtroRep = document.getElementById('filtroRepresentante');
    const filtroProduto = document.getElementById('filtroProduto');
    const dataInicio = document.getElementById('filtroVendasDataInicio');
    const dataFim = document.getElementById('filtroVendasDataFim');

    if (filtroRep) filtroRep.value = '';
    if (filtroProduto) filtroProduto.value = '';
    if (dataInicio) dataInicio.value = '';
    if (dataFim) dataFim.value = '';

    _paginaVendas = 1;
    renderizarRegistroVendas();
};

// Hook limparFiltrosDistribuicao to clear date fields
const _limparFiltrosDistribuicaoOriginal = limparFiltrosDistribuicao;
limparFiltrosDistribuicao = function() {
    const filtroRep = document.getElementById('filtroDistribuicaoRep');
    const filtroProduto = document.getElementById('filtroDistribuicaoProduto');
    const dataInicio = document.getElementById('filtroDistribuicaoDataInicio');
    const dataFim = document.getElementById('filtroDistribuicaoDataFim');

    if (filtroRep) filtroRep.value = '';
    if (filtroProduto) filtroProduto.value = '';
    if (dataInicio) dataInicio.value = '';
    if (dataFim) dataFim.value = '';

    _paginaDistribuicao = 1;
    renderizarRegistroDistribuicao();
};

// Hook inicializar to check for low stock and integrate audit log
const _inicializarOriginal = inicializar;
inicializar = async function() {
    await _inicializarOriginal();
    try { verificarAlertasEstoque(); } catch(e) {}
};

// Hook salvarDados to check low stock and register audit
const _salvarDadosHook = salvarDados;
// We can't easily re-declare salvarDados since it's used everywhere,
// but we do check low stock after renders
const _renderizarTabelaOriginal = renderizarTabela;
renderizarTabela = function() {
    _renderizarTabelaOriginal();
    try { verificarAlertasEstoque(); } catch(e) {}
};

// Hooks for audit log on key operations
const _salvarNovaDistribuicaoOriginal = salvarNovaDistribuicao;
salvarNovaDistribuicao = function(event) {
    _salvarNovaDistribuicaoOriginal(event);
    try {
        const rep = document.getElementById('representanteDistDet')?.value || '';
        const container = document.getElementById('itensDistribuicaoContainer');
        if (container) {
            const rows = Array.from(container.querySelectorAll('.item-dist-row'));
            const resumo = rows.map(r => {
                const prod = r.querySelector('.item-produto-dist')?.selectedOptions[0]?.text || '';
                const qtd = r.querySelector('.item-quantidade-dist')?.value || '';
                return `${qtd}x ${prod}`;
            }).join(', ');
            registrarHistorico('distribuicao', `${resumo} → ${rep}`);
        } else {
            const prod = document.getElementById('produtoDistDet')?.selectedOptions[0]?.text || '';
            const qtd = document.getElementById('quantidadeDistDet')?.value || '';
            registrarHistorico('distribuicao', `${qtd}x ${prod} → ${rep}`);
        }
    } catch(e) {}
};

const _salvarEntradaEstoqueOriginal = salvarEntradaEstoque;
salvarEntradaEstoque = function(event) {
    const prodEl = document.getElementById('produtoEntrada');
    const qtdEl = document.getElementById('quantidadeEntrada');
    const prodNome = prodEl?.selectedOptions[0]?.text || '';
    const qtd = qtdEl?.value || '';
    _salvarEntradaEstoqueOriginal(event);
    try { registrarHistorico('entrada', `+${qtd} ${prodNome} (IMBEL)`); } catch(e) {}
    try { verificarAlertasEstoque(); } catch(e) {}
};

const _excluirVendaOriginal = excluirVenda;
excluirVenda = function(vendaId) {
    const venda = estoque.registroVendas.find(v => v.id === vendaId);
    _excluirVendaOriginal(vendaId);
    if (venda) {
        try { registrarHistorico('exclusao', `Venda CTR ${venda.contrato} excluída`); } catch(e) {}
    }
};

const _excluirDistribuicaoOriginal = excluirDistribuicao;
excluirDistribuicao = function(distId) {
    const dist = estoque.registroDistribuicao.find(d => d.id === distId);
    _excluirDistribuicaoOriginal(distId);
    if (dist) {
        try { registrarHistorico('exclusao', `Distribuição ${dist.produtoNome} x${dist.quantidade} (${dist.representante}) excluída`); } catch(e) {}
    }
};

// ---------------------------
// Autenticação (Firebase Auth - client)
// ---------------------------

// Realiza login com email/senha usando Firebase Auth (compat)
async function signIn() {
    const emailEl = document.getElementById('authEmail');
    const passEl = document.getElementById('authPassword');
    if (!emailEl || !passEl) return;
    const email = emailEl.value.trim();
    const password = passEl.value;
    try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
        mostrarNotificacao('Login efetuado', 'success');
    } catch (err) {
        console.error('Erro signIn', err);
        mostrarNotificacao('Falha no login: ' + (err.message || err), 'error');
    }
}

// Desloga o usuário
async function signOut() {
    try {
        await firebase.auth().signOut();
        mostrarNotificacao('Sessão encerrada', 'info');
    } catch (err) {
        console.error('Erro signOut', err);
        mostrarNotificacao('Erro ao sair: ' + (err.message || err), 'error');
    }
}

// Atualiza UI conforme estado de autenticação (guardado caso Firebase esteja bloqueado)
if (window.firebase && firebase.auth) {
    try {
        firebase.auth().onAuthStateChanged(async function(user) {
            const formEl = document.getElementById('authPanelForm');
            const signedEl = document.getElementById('authSignedIn');
            const userDisplay = document.getElementById('authUserDisplay');
            const loggedEmailEl = document.getElementById('loggedAccountEmail');
            const loggedBadgeEl = document.getElementById('loggedAccountBadge');
            if (user) {
                if (formEl) formEl.style.display = 'none';
                if (signedEl) signedEl.style.display = 'flex';
                if (userDisplay) userDisplay.textContent = user.email || user.uid;

                // Verifica claims para habilitar controles de admin
                let isAdmin = false;
                try {
                    const idt = await user.getIdTokenResult();
                    isAdmin = !!idt.claims && !!idt.claims.admin;
                } catch (e) { /* ignore */ }

                // Fallback por email (temporário) — remove se preferir depender apenas da claim
                if (!isAdmin && user.email === 'joffre.ribeiro@gmail.com') isAdmin = true;

                if (isAdmin) {
                    document.body.classList.add('is-admin');
                    if (loggedBadgeEl) loggedBadgeEl.style.display = 'inline-block';
                } else {
                    document.body.classList.remove('is-admin');
                    if (loggedBadgeEl) loggedBadgeEl.style.display = 'none';
                }
                // Toggle UI controls marked as admin-only
                try {
                    const adminControls = document.querySelectorAll('[data-admin="true"]');
                    adminControls.forEach(el => {
                        if (isAdmin) {
                            el.removeAttribute('disabled');
                            el.style.pointerEvents = '';
                            el.style.opacity = '';
                        } else {
                            el.setAttribute('disabled','disabled');
                            el.style.pointerEvents = 'none';
                            el.style.opacity = '0.55';
                        }
                    });
                } catch(e) {}
                if (loggedEmailEl) loggedEmailEl.textContent = user.email || '';

                // Persist a short record of current user in localStorage for quick reference
                try {
                    localStorage.setItem('currentUser', JSON.stringify({ email: user.email || null, uid: user.uid || null, isAdmin }));
                } catch(e) {}

                // Após autenticar, atualizar status do cloud e tentar auto-load 1x por usuário
                try {
                    if (window.firestoreDB) {
                        try {
                            const doc = await window.firestoreDB.collection('app_data').doc('latest').get();
                            if (doc && doc.exists) {
                                const data = doc.data();
                                const updatedAt = data && data.updatedAt ? data.updatedAt.toDate() : null;
                                updateFirestoreStatus(true, updatedAt, 'Cloud: pronto');
                            } else {
                                updateFirestoreStatus(true, null, 'Cloud: pronto (sem backup)');
                            }
                        } catch (e) {
                            updateFirestoreStatus(true, null, 'Cloud: sem permissão de leitura');
                        }

                        // Auto-load somente uma vez por usuário autenticado
                        if (window.__cloudAutoLoadDoneForUid !== user.uid) {
                            const autoLoaded = await carregarDoCloudAuto();
                            window.__cloudAutoLoadDoneForUid = user.uid;
                            if (autoLoaded) {
                                try { if (window.__SHOW_AUTO_UPDATE_NOTIFICATION) mostrarNotificacao('Dados carregados automaticamente do Cloud (remoto mais recente).', 'success'); } catch (e) {}
                            }
                        }

                        // Registrar listener em tempo real para detectar atualizações remotas
                        try {
                            if (window.firestoreDB && !window.__firestoreAppDataUnsubscribe) {
                                const docRef = window.firestoreDB.collection('app_data').doc('latest');
                                window.__firestoreAppDataUnsubscribe = docRef.onSnapshot(async (doc) => {
                                    try {
                                        if (!doc || !doc.exists) return;
                                        const data = doc.data();
                                        const remoteUpdated = data && data.updatedAt ? data.updatedAt.toDate().getTime() : null;
                                        const localUpdated = estoque && estoque._localUpdatedAt ? new Date(estoque._localUpdatedAt).getTime() : 0;
                                        if (!remoteUpdated) return;
                                        // Se acabamos de sincronizar local->cloud, ignorar o snapshot
                                        if (window._cloudSyncedRecently) return;
                                        // Se há alterações locais não sincronizadas, não sobrescrever automaticamente
                                        if (window._dadosAlterados) {
                                            try { updateFirestoreStatus(true, new Date(remoteUpdated), 'Cloud: atualização disponível'); } catch(e) {}
                                            window.__cloudHasRemoteUpdate = true;
                                            return;
                                        }
                                        // Se remoto for mais recente que local, carregar automaticamente
                                        if (remoteUpdated > localUpdated + 1000) {
                                            await carregarDoCloud({ confirmOverwrite: false });
                                            try { if (window.__SHOW_AUTO_UPDATE_NOTIFICATION) mostrarNotificacao('Dados atualizados automaticamente do Cloud.', 'success'); } catch (e) {}
                                        }
                                    } catch (e) {
                                        console.error('Erro no snapshot do Firestore:', e);
                                    }
                                }, (err) => {
                                    console.warn('Erro no listener Firestore:', err);
                                });
                            }
                        } catch(e) {}
                    }
                } catch (e) { /* ignore */ }

            } else {
                // Se deslogou, cancelar listener em tempo real se existia
                try {
                    if (window.__firestoreAppDataUnsubscribe) {
                        try { window.__firestoreAppDataUnsubscribe(); } catch(e) {}
                        window.__firestoreAppDataUnsubscribe = null;
                    }
                } catch(e) {}
                if (formEl) formEl.style.display = 'flex';
                if (signedEl) signedEl.style.display = 'none';
                if (userDisplay) userDisplay.textContent = '';
                document.body.classList.remove('is-admin');
                if (loggedEmailEl) loggedEmailEl.textContent = '';
                if (loggedBadgeEl) loggedBadgeEl.style.display = 'none';
                try { localStorage.removeItem('currentUser'); } catch(e) {}
                try { window.__cloudAutoLoadDoneForUid = null; } catch (e) {}
                try { updateFirestoreStatus(true, null, 'Cloud: aguardando login'); } catch (e) {}
            }
        });
    } catch (err) {
        console.warn('firebase.auth() hook failed:', err);
        window.__showRuntimeErrorOverlay && window.__showRuntimeErrorOverlay('firebase.auth() hook failed: ' + (err && err.message ? err.message : err));
    }
} else {
    console.warn('Firebase SDK não disponível; pulando onAuthStateChanged.');
}

// Helper to check admin state synchronously from localStorage/cache
function isCurrentUserAdmin() {
    try {
        const raw = localStorage.getItem('currentUser');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return !!parsed && !!parsed.isAdmin;
    } catch(e) { return false; }
}

// Verifica se o usuário atual é admin; caso contrário exibe notificação e mostra o painel de login
function requireAdminOrNotify() {
    try {
        if (isCurrentUserAdmin()) return true;
        mostrarNotificacao('Ação restrita: somente administradores podem realizar esta operação.', 'warning');
        const formEl = document.getElementById('authPanelForm');
        if (formEl) formEl.style.display = 'flex';
    } catch(e) { /* ignore */ }
    return false;
}

// Forçar chamada inicial para ajustar UI caso o listener já tenha ocorrido
try { if (firebase && firebase.auth) firebase.auth().currentUser; } catch(e) {}
// Expõe funções do estoque que são chamadas por onclick no HTML
window._estoqueInicializarFn = typeof inicializar === 'function' ? inicializar : null;
window._estoqueSignIn = typeof signIn === 'function' ? signIn : null;
window._estoqueSignOut = typeof signOut === 'function' ? signOut : null;
window.trocarAba = typeof trocarAba === 'function' ? trocarAba : window.trocarAba;

// Funções de sidebar do estoque (chamadas por onclick no HTML)
window.toggleSidebarExpanded = typeof toggleSidebarExpanded === 'function' ? toggleSidebarExpanded : window.toggleSidebarExpanded;
window.toggleMobileSidebar = typeof toggleMobileSidebar === 'function' ? toggleMobileSidebar : window.toggleMobileSidebar;
window.togglePainelAlertas = typeof togglePainelAlertas === 'function' ? togglePainelAlertas : window.togglePainelAlertas;
window.abrirModalEntradaEstoque = typeof abrirModalEntradaEstoque === 'function' ? abrirModalEntradaEstoque : window.abrirModalEntradaEstoque;
window.limparFiltros = typeof limparFiltros === 'function' ? limparFiltros : window.limparFiltros;
window.salvarNoCloudUI = typeof salvarNoCloudUI === 'function' ? salvarNoCloudUI : window.salvarNoCloudUI;
window.carregarDoCloudUI = typeof carregarDoCloudUI === 'function' ? carregarDoCloudUI : window.carregarDoCloudUI;
window.filtrarTabelaEstoque = typeof filtrarTabelaEstoque === 'function' ? filtrarTabelaEstoque : window.filtrarTabelaEstoque;
window.togglePasswordVisibility = window.togglePasswordVisibility || (typeof togglePasswordVisibility === 'function' ? togglePasswordVisibility : null);
window._estoqueInicializarFn = typeof inicializar === 'function' ? inicializar : null;
window._estoqueSignIn = typeof signIn === 'function' ? signIn : null;
window._estoqueSignOut = typeof signOut === 'function' ? signOut : null;
window.trocarAba = typeof trocarAba === 'function' ? trocarAba : window.trocarAba;
// Restaura a função inicializar do Ponto
if (_pontoInicializar) window.inicializar = _pontoInicializar;

})(window);


