(function(){
    var escapeHtml = Utils.escapeHtml.bind(Utils);

    function formatarDataBR(str) {
        if (!str) return '';
        const s = String(str).trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [ano, mes, dia] = s.split('-');
            return `${dia}/${mes}/${ano}`;
        }
        return s;
    }

    function statusLabel(s) {
        const m = { pendente:'Pendente', 'em andamento':'Em andamento', concluida:'Concluída', bloqueada:'Bloqueada' };
        return m[(s||'').toLowerCase()] || s || '';
    }

    function statusClass(a) {
        const s = (a.status || '').toLowerCase().trim();
        const conc = s === 'concluida' || s === 'concluída' || a.finalizado;
        const bloq = s === 'bloqueada';
        const venc = !conc && !bloq && a.prazo && new Date(a.prazo) < new Date();
        if (conc)  return 'tl-concluida';
        if (bloq)  return 'tl-bloqueada';
        if (venc)  return 'tl-vencida';
        if (s === 'em andamento') return 'tl-andamento';
        return 'tl-pendente';
    }

    function renderizarTimeline(items) {
        const container = document.getElementById('atividadesTimeline');
        if (!container) return;

        if (!items || !items.length) {
            container.innerHTML = '<div class="tl-empty">Nenhuma atividade para exibir.</div>';
            return;
        }

        // Agrupar por assunto, ordenado pelo registro mais recente de cada grupo
        const grupos = {};
        items.forEach(a => {
            const chave = (a.assunto || '').trim() || '(sem assunto)';
            if (!grupos[chave]) grupos[chave] = [];
            grupos[chave].push(a);
        });

        // Ordenar itens dentro de cada grupo por data recebida (mais recente primeiro)
        Object.values(grupos).forEach(lista => {
            lista.sort((a, b) => {
                const da = a.dataDoc ? new Date(a.dataDoc) : new Date(0);
                const db = b.dataDoc ? new Date(b.dataDoc) : new Date(0);
                return db - da;
            });
        });

        // Ordenar grupos pelo item mais recente
        const gruposOrdenados = Object.entries(grupos).sort(([, la], [, lb]) => {
            const da = la[0].dataDoc ? new Date(la[0].dataDoc) : new Date(0);
            const db = lb[0].dataDoc ? new Date(lb[0].dataDoc) : new Date(0);
            return db - da;
        });

        const html = gruposOrdenados.map(([assunto, lista]) => {
            const itensHtml = lista.map(a => {
                const sc = statusClass(a);
                const dataRecebida = formatarDataBR(a.dataDoc);
                const dataConclusao = formatarDataBR(a.dataConclusao);
                const prazo = formatarDataBR(a.prazo);
                const origem = a.origemDemanda ? `<span class="tl-origem">${escapeHtml(a.origemDemanda)}</span>` : '';
                const descFeito = a.descricaoRealizado
                    ? `<div class="tl-desc-feito"><strong>O que foi feito:</strong> ${escapeHtml(a.descricaoRealizado)}</div>`
                    : '';
                const dataLinha = dataConclusao
                    ? `<span class="tl-data-pair"><span class="tl-label">Recebido</span> ${dataRecebida}</span><span class="tl-sep">→</span><span class="tl-data-pair tl-data-conc"><span class="tl-label">Concluído</span> ${dataConclusao}</span>`
                    : `<span class="tl-data-pair"><span class="tl-label">Recebido</span> ${dataRecebida || '—'}</span>${prazo ? `<span class="tl-sep">·</span><span class="tl-data-pair"><span class="tl-label">Prazo</span> ${prazo}</span>` : ''}`;

                return `
                <div class="tl-item ${sc}">
                    <div class="tl-dot"></div>
                    <div class="tl-card">
                        <div class="tl-card-header">
                            <span class="tl-objeto">${escapeHtml(a.objeto || a.titulo || '—')}</span>
                            <span class="tl-badge tl-badge-${sc}">${statusLabel(a.status)}</span>
                        </div>
                        <div class="tl-datas">${dataLinha}</div>
                        ${origem ? `<div class="tl-origem-row">${origem}</div>` : ''}
                        ${a.acaoRealizar ? `<div class="tl-acao"><strong>Ação:</strong> ${escapeHtml(a.acaoRealizar)}</div>` : ''}
                        ${descFeito}
                        <div class="tl-card-actions">
                            <button class="btn-icon-edit" title="Editar" data-action="editarAtividade" data-id="${a.id}">✏️</button>
                        </div>
                    </div>
                </div>`;
            }).join('');

            const total = lista.length;
            const conc = lista.filter(a => a.finalizado || (a.status || '').includes('conclu')).length;

            return `
            <div class="tl-grupo">
                <div class="tl-grupo-header">
                    <span class="tl-grupo-nome">${escapeHtml(assunto)}</span>
                    <span class="tl-grupo-stats">${conc}/${total} concluídas</span>
                </div>
                <div class="tl-linha">
                    ${itensHtml}
                </div>
            </div>`;
        }).join('');

        container.innerHTML = html;
    }

    window.AtividadesTimeline = { renderizarTimeline };
})();
