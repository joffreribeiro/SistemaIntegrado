/**
 * charts.js - Sistema de graficos e analytics
 * Visualizacao de dados com Chart.js
 */

const Charts = {

    /** Instancias ativas dos graficos */
    instances: {},

    createHoursChart(canvasId, registros, opts) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const byMonth = {};
        registros.forEach(reg => {
            if (!reg.data || !reg.entrada || !reg.saida) return;
            const month = reg.data.substring(0, 7);
            const entrada = (typeof DateUtils !== 'undefined') ? DateUtils.timeToMinutes(reg.entrada) : 0;
            const saida   = (typeof DateUtils !== 'undefined') ? DateUtils.timeToMinutes(reg.saida)   : 0;
            const almoco  = (reg.saidaAlmoco && reg.retornoAlmoco && typeof DateUtils !== 'undefined')
                ? (DateUtils.timeToMinutes(reg.retornoAlmoco) - DateUtils.timeToMinutes(reg.saidaAlmoco))
                : 0;
            const horas = Math.max(0, (saida - entrada - almoco) / 60);
            byMonth[month] = (byMonth[month] || 0) + horas;
        });
        const labels = Object.keys(byMonth).sort();
        const data = labels.map(m => Number(byMonth[m].toFixed(1)));
        const horasDiarias = (opts && typeof opts.horasDiarias === 'number') ? opts.horasDiarias : 8;
        const providedMeta = (opts && typeof opts.metaMensal === 'number') ? opts.metaMensal : null;
        const monthlyTargets = labels.map(m => {
            try {
                if (providedMeta !== null) return providedMeta;
                const [yy, mm] = m.split('-');
                const y = Number(yy); const mo = Number(mm) - 1;
                const last = new Date(y, mo + 1, 0).getDate();
                let bd = 0;
                for (let d = 1; d <= last; d++) {
                    const dt = new Date(y, mo, d);
                    if (typeof DateUtils !== 'undefined' && typeof DateUtils.isBusinessDay === 'function') {
                        if (DateUtils.isBusinessDay(dt)) bd++;
                    } else { const dow = dt.getDay(); if (dow !== 0 && dow !== 6) bd++; }
                }
                return horasDiarias * bd;
            } catch (e) { return providedMeta || 176; }
        });
        const cfg = {
            type: 'bar',
            data: {
                labels: labels.map(m => { const [y, mo] = m.split('-'); return `${mo}/${y}`; }),
                datasets: [{
                    label: 'Horas Trabalhadas', data: data,
                    backgroundColor: '#2563eb', borderWidth: 0, borderRadius: 6, borderSkipped: false, yAxisID: 'y'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { title: { display: true, text: 'Horas Trabalhadas por Mes' }, legend: { display: true, position: 'top' } },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Horas' } } }
            }
        };
        try {
            cfg.data.datasets.push({
                label: 'Meta Mensal', data: monthlyTargets.map(v => Number(v.toFixed(1))),
                type: 'line', borderColor: '#ef4444', borderDash: [6,6], borderWidth: 2,
                fill: false, pointRadius: 0, tension: 0, yAxisID: 'y'
            });
        } catch (e) { console.warn('Erro ao adicionar meta mensal:', e); }
        return this.createChart(canvasId, cfg);
    },

    createBalanceChart(canvasId, registros, acordos) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const byMonth = {};
        registros.forEach(reg => {
            if (!reg.data || !reg.entrada || !reg.saida) return;
            const month = reg.data.substring(0, 7);
            const saldo = typeof reg.saldo === 'number' ? reg.saldo
                : (typeof reg.saldoDia === 'number' ? reg.saldoDia : 0);
            byMonth[month] = (byMonth[month] || 0) + saldo;
        });
        const labels = Object.keys(byMonth).sort();
        const data = labels.map(m => Number((byMonth[m] / 60).toFixed(2)));
        return this.createChart(canvasId, {
            type: 'bar',
            data: {
                labels: labels.map(m => { const [y, mo] = m.split('-'); return `${mo}/${y}`; }),
                datasets: [{
                    label: 'Saldo (horas)', data: data,
                    backgroundColor: data.map(v => v >= 0 ? '#059669' : '#dc2626'),
                    borderWidth: 0, borderRadius: 6, borderSkipped: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { title: { display: true, text: 'Saldo de Horas por Mes' }, legend: { display: false } },
                scales: { y: { title: { display: true, text: 'Horas' } } }
            }
        });
    },

    createEventTypesChart(canvasId, eventos, tiposEvento) {
        if (!eventos) eventos = [];
        if (!tiposEvento) tiposEvento = [];
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const counts = {};
        eventos.forEach(ev => {
            const tipo = ev.tipo || ev.tipoId || ev.tipo_evento || ev.tipoEvento || ev.type || ev.tipo_id || 'outro';
            const key = (typeof tipo === 'object' && tipo !== null) ? (tipo.id || tipo.nome || 'outro') : (tipo || 'outro');
            counts[String(key)] = (counts[String(key)] || 0) + 1;
        });
        const labels = Object.keys(counts);
        const data = labels.map(l => counts[l]);
        const defaultColors = ['#2563eb','#7c3aed','#0891b2','#059669','#d97706','#dc2626','#db2777','#6366f1','#0d9488','#ea580c'];
        const colors = labels.map((tipo, i) => {
            const t = tiposEvento.find(t => t.id === tipo || String(t.id) === tipo || t.nome === tipo);
            return (t && t.cor) ? t.cor : defaultColors[i % defaultColors.length];
        });
        return this.createChart(canvasId, {
            type: 'doughnut',
            data: {
                labels: labels.map(l => { const t = tiposEvento.find(t => t.id === l || String(t.id) === l || t.nome === l); return t ? (t.nome || String(l)) : String(l); }),
                datasets: [{ data: data, backgroundColor: colors, borderWidth: 4, borderColor: '#ffffff', hoverOffset: 8, hoverBorderWidth: 5 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right' },
                    tooltip: { callbacks: { label: function(ctx) { const v = ctx.raw; const tot = ctx.dataset.data.reduce((a,b)=>a+b,0)||0; return `${ctx.label}: ${v} (${tot?((v/tot)*100).toFixed(1):0}%)`; } } }
                }
            }
        });
    },

    createWeeklyHeatmap(canvasId, registros) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const byWeekday = {0:0,1:0,2:0,3:0,4:0,5:0,6:0};
        const counts    = {0:0,1:0,2:0,3:0,4:0,5:0,6:0};
        registros.forEach(reg => {
            if (!reg.data || !reg.entrada || !reg.saida) return;
            const weekday = new Date(reg.data + 'T00:00:00').getDay();
            const entrada = (typeof DateUtils !== 'undefined') ? DateUtils.timeToMinutes(reg.entrada) : 0;
            const saida   = (typeof DateUtils !== 'undefined') ? DateUtils.timeToMinutes(reg.saida)   : 0;
            const almoco  = (reg.saidaAlmoco && reg.retornoAlmoco && typeof DateUtils !== 'undefined')
                ? (DateUtils.timeToMinutes(reg.retornoAlmoco) - DateUtils.timeToMinutes(reg.saidaAlmoco)) : 0;
            byWeekday[weekday] += (saida - entrada - almoco) / 60;
            counts[weekday]++;
        });
        const labelNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
        const data = Object.keys(byWeekday).map(d => counts[d] > 0 ? Number((byWeekday[d]/counts[d]).toFixed(1)) : 0);
        return this.createChart(canvasId, {
            type: 'bar',
            data: {
                labels: labelNames,
                datasets: [{
                    label: 'Media de Horas', data: data,
                    backgroundColor: ['#94a3b8','#2563eb','#7c3aed','#0891b2','#059669','#d97706','#94a3b8'],
                    borderWidth: 0, borderRadius: 6, borderSkipped: false
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { title: { display: true, text: 'Media de Horas por Dia da Semana' }, legend: { display: false } },
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Horas' } } }
            }
        });
    },

    createChart(canvasId, config) {
        if (this.instances[canvasId]) {
            try { this.instances[canvasId].destroy(); } catch(e) {}
            delete this.instances[canvasId];
        }
        const canvas = document.getElementById(canvasId);
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        this.instances[canvasId] = new Chart(ctx, config);
        return this.instances[canvasId];
    },

    updateChart(canvasId, newData) {
        const chart = this.instances[canvasId];
        if (!chart) return;
        chart.data = newData;
        chart.update();
    },

    destroyChart(canvasId) {
        const chart = this.instances[canvasId];
        if (chart) {
            try { chart.destroy(); } catch(e) {}
            delete this.instances[canvasId];
        }
    },

    destroyAll() {
        Object.keys(this.instances).forEach(id => this.destroyChart(id));
    },

    exportAsImage(canvasId, filename) {
        const chart = this.instances[canvasId];
        if (!chart) return;
        let titleText = '';
        try {
            const t = chart.options && chart.options.plugins && chart.options.plugins.title;
            if (t) { titleText = Array.isArray(t.text) ? t.text.join(' ') : (typeof t.text === 'string' ? t.text : ''); }
            if (!titleText && chart.data && chart.data.datasets && chart.data.datasets[0]) titleText = chart.data.datasets[0].label || '';
        } catch(e) {}
        titleText = String(titleText||'').trim().replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_\-]/g,'');
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const outName = filename || `grafico${titleText?'_'+titleText:''}_${dateStr}.png`;
        try {
            if (chart.options && chart.options.plugins && chart.options.plugins.title) {
                const prev = chart.options.plugins.title.display;
                chart.options.plugins.title.display = true;
                try { chart.update(); } catch(e) {}
                const url = chart.toBase64Image();
                chart.options.plugins.title.display = prev;
                try { chart.update(); } catch(e) {}
                const link = document.createElement('a');
                link.href = url; link.download = outName; link.click();
                return;
            }
        } catch(e) {}
        const url = chart.toBase64Image();
        const link = document.createElement('a');
        link.href = url; link.download = outName; link.click();
    }
};

if (typeof window !== 'undefined') {
    window.Charts = Charts;
}