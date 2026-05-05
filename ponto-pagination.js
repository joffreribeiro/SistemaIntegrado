/**
 * pagination.js - Sistema de paginação e virtual scrolling
 * Melhora performance com grandes volumes de dados
 */

const Pagination = {
    configs: {},

    /**
     * Inicializa paginação para uma tabela
     * @param {string} tableId - ID da tabela
     * @param {Array} data - Dados completos
     * @param {Function} renderFn - Função de renderização
     * @param {number} itemsPerPage - Items por página (padrão: 50)
     */
    init(tableId, data, renderFn, itemsPerPage = 50) {
        this.configs[tableId] = {
            data,
            renderFn,
            itemsPerPage,
            currentPage: 1,
            totalPages: Math.ceil(data.length / itemsPerPage)
        };

        this.render(tableId);
        this.renderControls(tableId);
    },

    /**
     * Renderiza página atual
     */
    render(tableId) {
        const config = this.configs[tableId];
        if (!config) return;

        const start = (config.currentPage - 1) * config.itemsPerPage;
        const end = start + config.itemsPerPage;
        const pageData = config.data.slice(start, end);

        config.renderFn(pageData, start);
    },

    /**
     * Renderiza controles de paginação
     */
    renderControls(tableId) {
        const config = this.configs[tableId];
        if (!config) return;

        let container = document.getElementById(`${tableId}-pagination`);
        if (!container) {
            container = document.createElement('div');
            container.id = `${tableId}-pagination`;
            container.className = 'pagination-container';
            
            const table = document.getElementById(tableId);
            if (table && table.parentElement) {
                table.parentElement.insertAdjacentElement('afterend', container);
            }
        }

        const { currentPage, totalPages, data, itemsPerPage } = config;
        const start = (currentPage - 1) * itemsPerPage + 1;
        const end = Math.min(currentPage * itemsPerPage, data.length);

        container.innerHTML = `
            <div class="pagination-info">
                <span>Mostrando ${start}-${end} de ${data.length} registros</span>
            </div>
            <div class="pagination-buttons">
                <button class="btn-pagination" data-action="first" ${currentPage === 1 ? 'disabled' : ''}>
                    ⏮️ Primeiro
                </button>
                <button class="btn-pagination" data-action="prev" ${currentPage === 1 ? 'disabled' : ''}>
                    ◀️ Anterior
                </button>
                <span class="pagination-current">
                    Página ${currentPage} de ${totalPages}
                </span>
                <button class="btn-pagination" data-action="next" ${currentPage === totalPages ? 'disabled' : ''}>
                    Próxima ▶️
                </button>
                <button class="btn-pagination" data-action="last" ${currentPage === totalPages ? 'disabled' : ''}>
                    Último ⏭️
                </button>
            </div>
            <div class="pagination-jump">
                <select class="pagination-select" data-action="goto">
                    ${Array.from({ length: totalPages }, (_, i) => i + 1)
                        .map(page => `<option value="${page}" ${page === currentPage ? 'selected' : ''}>Página ${page}</option>`)
                        .join('')}
                </select>
                <select class="pagination-select" data-action="pagesize">
                    ${[25, 50, 100, 200].map(size => 
                        `<option value="${size}" ${size === itemsPerPage ? 'selected' : ''}>${size} por página</option>`
                    ).join('')}
                </select>
            </div>
        `;

        // Event listeners
        container.querySelectorAll('.btn-pagination').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                this.navigate(tableId, action);
            });
        });

        container.querySelector('[data-action="goto"]')?.addEventListener('change', (e) => {
            this.goToPage(tableId, parseInt(e.target.value));
        });

        container.querySelector('[data-action="pagesize"]')?.addEventListener('change', (e) => {
            this.setPageSize(tableId, parseInt(e.target.value));
        });
    },

    /**
     * Navega entre páginas
     */
    navigate(tableId, action) {
        const config = this.configs[tableId];
        if (!config) return;

        switch (action) {
            case 'first':
                config.currentPage = 1;
                break;
            case 'prev':
                config.currentPage = Math.max(1, config.currentPage - 1);
                break;
            case 'next':
                config.currentPage = Math.min(config.totalPages, config.currentPage + 1);
                break;
            case 'last':
                config.currentPage = config.totalPages;
                break;
        }

        this.render(tableId);
        this.renderControls(tableId);
    },

    /**
     * Vai para página específica
     */
    goToPage(tableId, page) {
        const config = this.configs[tableId];
        if (!config) return;

        config.currentPage = Math.max(1, Math.min(page, config.totalPages));
        this.render(tableId);
        this.renderControls(tableId);
    },

    /**
     * Altera tamanho da página
     */
    setPageSize(tableId, size) {
        const config = this.configs[tableId];
        if (!config) return;

        config.itemsPerPage = size;
        config.totalPages = Math.ceil(config.data.length / size);
        config.currentPage = 1;
        
        this.render(tableId);
        this.renderControls(tableId);
    },

    /**
     * Atualiza dados
     */
    updateData(tableId, newData) {
        const config = this.configs[tableId];
        if (!config) return;

        config.data = newData;
        config.totalPages = Math.ceil(newData.length / config.itemsPerPage);
        config.currentPage = Math.min(config.currentPage, config.totalPages || 1);
        
        this.render(tableId);
        this.renderControls(tableId);
    },

    /**
     * Pesquisa e filtragem
     */
    search(tableId, searchTerm, searchFields) {
        const config = this.configs[tableId];
        if (!config) return;

        if (!searchTerm) {
            this.render(tableId);
            return;
        }

        const term = searchTerm.toLowerCase();
        const filtered = config.data.filter(item => {
            return searchFields.some(field => {
                const value = String(item[field] || '').toLowerCase();
                return value.includes(term);
            });
        });

        const tempData = config.data;
        config.data = filtered;
        config.totalPages = Math.ceil(filtered.length / config.itemsPerPage);
        config.currentPage = 1;

        this.render(tableId);
        this.renderControls(tableId);

        // Restaurar dados originais para próxima pesquisa
        config.originalData = tempData;
    },

    /**
     * Limpar pesquisa
     */
    clearSearch(tableId) {
        const config = this.configs[tableId];
        if (!config || !config.originalData) return;

        config.data = config.originalData;
        delete config.originalData;
        config.totalPages = Math.ceil(config.data.length / config.itemsPerPage);
        config.currentPage = 1;

        this.render(tableId);
        this.renderControls(tableId);
    }
};
