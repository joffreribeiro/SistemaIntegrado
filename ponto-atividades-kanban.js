(function(){
    // Módulo responsável pelo Kanban de atividades
    var escapeHtml = Utils.escapeHtml.bind(Utils);

    function renderizarKanban(items) {
        const kanban = document.getElementById('atividadesKanban');
        if (!kanban) return;
        const statuses = ['pendente','em andamento','bloqueada','concluida'];
        const cols = statuses.map(s => ({ key:s, title: s === 'pendente' ? 'Pendente' : s === 'em andamento' ? 'Em andamento' : s === 'bloqueada' ? 'Bloqueada' : 'Concluída' }));
        const html = cols.map(col => {
            const cards = items.filter(i => i.status === col.key).map(a => {
                const prioClass = (a.prioridade || '').toLowerCase();
                return `
                <div class="kanban-card activity-card prio-${prioClass}" draggable="true" data-id="${a.id}">
                    <strong>${escapeHtml(a.titulo)}</strong>
                    <div class="small-text">${escapeHtml(a.responsavel||'')} • ${escapeHtml(a.prioridade||'')}</div>
                </div>
            `;
            }).join('');
            return `
                <div class="kanban-column" data-status="${col.key}">
                    <h4>${col.title}</h4>
                    <div class="kanban-list">${cards}</div>
                </div>
            `;
        }).join('');

        kanban.innerHTML = `<div class="kanban-board">${html}</div>`;

        // attach drag handlers
        kanban.querySelectorAll('.kanban-card').forEach(card => {
            card.addEventListener('dragstart', onAtividadeDragStart);
            card.addEventListener('dragend', onAtividadeDragEnd);
        });
        kanban.querySelectorAll('.kanban-list').forEach(list => {
            list.addEventListener('dragover', onAtividadeDragOver);
            list.addEventListener('drop', onAtividadeDrop);
        });
    }

    let _draggingAtividadeId = null;
    function onAtividadeDragStart(e) {
        const id = e.currentTarget.dataset.id;
        _draggingAtividadeId = id;
        try { e.dataTransfer.setData('text/plain', id); } catch (err) { /* some browsers */ }
        e.currentTarget.classList.add('dragging');
    }
    function onAtividadeDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        _draggingAtividadeId = null;
    }
    function onAtividadeDragOver(e) {
        e.preventDefault();
    }
    function onAtividadeDrop(e) {
        e.preventDefault();
        const list = e.currentTarget;
        const column = list.closest('.kanban-column');
        const status = column && column.dataset.status;
        const id = (e.dataTransfer && e.dataTransfer.getData && e.dataTransfer.getData('text/plain')) || _draggingAtividadeId;
        if (id && status) {
            if (typeof window.moveAtividadeToStatus === 'function') {
                window.moveAtividadeToStatus(id, status);
            } else if (typeof moveAtividadeToStatus === 'function') {
                moveAtividadeToStatus(id, status);
            }
        }
    }

    window.AtividadesKanban = {
        renderizarKanban,
        onAtividadeDragStart,
        onAtividadeDragEnd,
        onAtividadeDragOver,
        onAtividadeDrop
    };
})();
