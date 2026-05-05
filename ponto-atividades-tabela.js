(function(){
    // Módulo responsável por renderizar a tabela de atividades
    var escapeHtml = Utils.escapeHtml.bind(Utils);

    /**
     * Formata data para DD/MM/AAAA
     * Aceita formatos: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
     */
    function formatarDataBR(str) {
        if (!str) return '';
        const s = String(str).trim();
        
        // Se já está em DD/MM/AAAA, retorna como está
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
            return s;
        }
        
        // YYYY-MM-DD -> DD/MM/AAAA
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const [ano, mes, dia] = s.split('-');
            return `${dia}/${mes}/${ano}`;
        }
        
        // DD-MM-YYYY -> DD/MM/AAAA
        if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
            const [dia, mes, ano] = s.split('-');
            return `${dia}/${mes}/${ano}`;
        }
        
        // YYYY/MM/DD -> DD/MM/AAAA
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) {
            const [ano, mes, dia] = s.split('/');
            return `${dia}/${mes}/${ano}`;
        }
        
        // Fallback: retorna original
        return s;
    }

    function renderizarTabelaAtividades(items, opcoes) {
        const agruparPor = (opcoes && opcoes.agruparPor) || '';
        try {
            console.debug('AtividadesTabela.renderizarTabelaAtividades: called with items length =', Array.isArray(items)? items.length : typeof items);
        } catch(e){}
        const tbody = document.querySelector('#tabelaAtividades tbody');
        if (!tbody) {
            console.error('AtividadesTabela: tbody not found for #tabelaAtividades');
            return;
        }

        // Agrupamento por assunto
        if (agruparPor === 'assunto') {
            const grupos = {};
            items.forEach(a => {
                const chave = (a.assunto || '').trim() || '(sem assunto)';
                if (!grupos[chave]) grupos[chave] = [];
                grupos[chave].push(a);
            });
            const gruposOrdenados = Object.entries(grupos).sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
            let allRows = '';
            gruposOrdenados.forEach(([assunto, lista]) => {
                const conc = lista.filter(a => a.finalizado || (a.status||'').includes('conclu')).length;
                allRows += `<tr class="tbl-grupo-header"><td colspan="12" style="color:#fff !important;">${escapeHtml(assunto)}<span class="tbl-grupo-stats">${conc}/${lista.length} concluídas</span></td></tr>`;
                lista.forEach((a, idx) => { allRows += buildRow(a, idx); });
            });
            try { tbody.innerHTML = allRows; } catch(e) { console.error(e); }
            return;
        }

        let rows = '';
        try {
            rows = items.map((a, idx) => buildRow(a, idx)).join('');
        } catch (err) {
            console.error('AtividadesTabela: error while creating rows HTML', err);
            tbody.innerHTML = '';
            return;
        }
        try {
            tbody.innerHTML = rows;
            console.debug('AtividadesTabela: tbody children after render =', tbody.childElementCount);
            if (tbody.childElementCount === 0) console.warn('AtividadesTabela: rendered 0 rows even though items length =', Array.isArray(items)? items.length : typeof items);
        } catch (err) {
            console.error('AtividadesTabela: error setting tbody.innerHTML', err);
        }
    }

    function buildRow(a, idx) {
            // Compatibilidade: mapear campos antigos para novos se necessário
            const ordem = a.ordem || String(idx + 1);
            const tedPtrab = a.tedPtrab || '';
            const objeto = a.objeto || a.titulo || ''; // fallback para titulo
            const processoPrincipal = a.processoPrincipal || '';
            const assunto = a.assunto || a.descricao || ''; // fallback para descricao
            const processoSolicitacao = a.processoSolicitacao || '';
            const tipoDoc = a.tipoDoc || '';
            const numeroDoc = a.numeroDoc || '';
            const remetente = a.remetente || a.responsavel || ''; // fallback para responsavel
            const destinatario = a.destinatario || '';
            const acaoRealizar = a.acaoRealizar || '';
            const observacoes = a.observacoes || '';
            const origemDemanda = a.origemDemanda || '';
            const dataConclusao = formatarDataBR(a.dataConclusao);
            const descricaoReal = a.descricaoRealizado || '';

            // Formatar datas usando função local
            const prazo = formatarDataBR(a.prazo);
            const dataDoc = formatarDataBR(a.dataDoc);
            const rawDias = typeof a.dias !== 'undefined' ? a.dias : (a.atividadeDias || '');
            const diasNum = Number(rawDias);

            // Badge TED/Ptrab
            const tedLower = tedPtrab.toLowerCase();
            const tedBadge = tedPtrab
                ? `<span class="${tedLower.includes('ted') ? 'badge-ted' : 'badge-ptrab'}">${escapeHtml(tedPtrab)}</span>`
                : '';

            // Badge Dias
            let diasDisplay = '';
            if (rawDias !== '' && rawDias !== null && rawDias !== undefined) {
                if (diasNum === 0) {
                    diasDisplay = `<span class="badge-dias-hoje">Hoje</span>`;
                } else if (diasNum < 0) {
                    diasDisplay = `<span class="badge-dias-neg">${diasNum}d</span>`;
                } else {
                    diasDisplay = `<span class="badge-dias-pos">+${diasNum}d</span>`;
                }
            }

            // Badge Status
            const statusVal = (a.status || '').toLowerCase().trim();
            let statusBadge;
            if (statusVal === 'pendente') {
                statusBadge = `<span class="badge-status-pendente">Pendente</span>`;
            } else if (statusVal === 'em andamento') {
                statusBadge = `<span class="badge-status-andamento">Em andamento</span>`;
            } else if (statusVal === 'concluida' || statusVal === 'concluída') {
                statusBadge = `<span class="badge-status-concluida">Concluída</span>`;
            } else if (statusVal === 'bloqueada') {
                statusBadge = `<span class="badge-status-bloqueada">Bloqueada</span>`;
            } else {
                statusBadge = `<span class="badge">${escapeHtml(a.status || '')}</span>`;
            }

            // Classe de linha
            const conc = statusVal === 'concluida' || statusVal === 'concluída' || a.finalizado;
            const bloq = statusVal === 'bloqueada';
            const venc = !conc && !bloq && a.prazo && new Date(a.prazo) < new Date();
            let rowClass = '';
            if (conc)                              rowClass = 'row-concluida';
            else if (bloq)                         rowClass = 'row-bloqueada';
            else if (venc)                         rowClass = 'row-vencida';
            else if (statusVal === 'em andamento') rowClass = 'row-andamento';
            else                                   rowClass = 'row-pendente';

            const origemBadge = origemDemanda
                ? `<span class="badge-origem">${escapeHtml(origemDemanda)}</span>`
                : '';
            const descTrunc = descricaoReal.length > 50
                ? escapeHtml(descricaoReal.slice(0, 50)) + '…'
                : escapeHtml(descricaoReal);

            return `<tr class="${rowClass}">
                <td>${escapeHtml(ordem)}</td>
                <td>${dataDoc}</td>
                <td>${escapeHtml(assunto)}</td>
                <td>${origemBadge}</td>
                <td><strong>${escapeHtml(objeto)}</strong></td>
                <td>${escapeHtml(acaoRealizar)}</td>
                <td>${statusBadge}</td>
                <td>${a.finalizado ? 'Sim' : 'Não'}</td>
                <td>${dataConclusao}</td>
                <td title="${escapeHtml(descricaoReal)}">${descTrunc}</td>
                <td>${prazo}</td>
                <td>
                    <button class="btn-icon-edit" title="Editar" data-action="editarAtividade" data-id="${a.id}">✏️</button>
                    <button class="btn-secondary" data-action="removerAtividade" data-id="${a.id}">${(typeof svgIcon==='function')? svgIcon('trash', { title: 'Remover atividade', color: 'currentColor' }) : '🗑️'}</button>
                </td>
            </tr>`;
    }

    window.AtividadesTabela = {
        renderizarTabelaAtividades
    };
})();
