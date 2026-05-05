/* vale-refeicao.js — Módulo de Vale-Refeição (VR)
 * Autocontido: não modifica outros arquivos JS do projeto.
 * Expõe window.ValeRefeicao = { calcularVRMes, renderDashboardVR, renderVRConfigUI, setDataProvider }
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Storage keys                                                         */
  /* ------------------------------------------------------------------ */
  var KEY_TARIFAS  = 'vr_tarifas';
  var KEY_VIAGENS  = 'vr_descontos_viagem';
  var KEY_EXCECOES = 'vr_excecoes';

  /* ------------------------------------------------------------------ */
  /* Storage helpers                                                      */
  /* ------------------------------------------------------------------ */
  function loadTarifas() {
    try { return JSON.parse(localStorage.getItem(KEY_TARIFAS)) || []; } catch (e) { return []; }
  }
  function saveTarifas(arr) { localStorage.setItem(KEY_TARIFAS, JSON.stringify(arr)); }

  function loadViagens() {
    try { return JSON.parse(localStorage.getItem(KEY_VIAGENS)) || {}; } catch (e) { return {}; }
  }
  function saveViagens(obj) { localStorage.setItem(KEY_VIAGENS, JSON.stringify(obj)); }

  function loadExcecoes() {
    try { return JSON.parse(localStorage.getItem(KEY_EXCECOES)) || []; } catch (e) { return []; }
  }
  function saveExcecoes(arr) { localStorage.setItem(KEY_EXCECOES, JSON.stringify(arr)); }

  /* ------------------------------------------------------------------ */
  /* Event data access — tenta múltiplas fontes em ordem                 */
  /* ------------------------------------------------------------------ */
  function getEventos() {
    // 1. window.App.getData().eventos
    try {
      if (window.App && typeof window.App.getData === 'function') {
        var d = window.App.getData();
        if (d && Array.isArray(d.eventos)) return d.eventos;
      }
    } catch (e) { /* degradar */ }

    // 2. window.App.getEventos()
    try {
      if (window.App && typeof window.App.getEventos === 'function') {
        var ev = window.App.getEventos();
        if (Array.isArray(ev)) return ev;
      }
    } catch (e) { /* degradar */ }

    // 3. window.getAppData().eventos
    try {
      if (typeof window.getAppData === 'function') {
        var gd = window.getAppData();
        if (gd && Array.isArray(gd.eventos)) return gd.eventos;
      }
    } catch (e) { /* degradar */ }

    // 4. Varredura de localStorage
    var lsKeys = ['ponto_eventos', 'eventos', 'pontoEventos', 'appData'];
    for (var i = 0; i < lsKeys.length; i++) {
      try {
        var raw = localStorage.getItem(lsKeys[i]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.eventos)) return parsed.eventos;
      } catch (e) { /* continuar */ }
    }

    // 5. window.VRDataProvider
    try {
      if (typeof window.VRDataProvider === 'function') {
        var prov = window.VRDataProvider();
        if (Array.isArray(prov)) return prov;
      }
    } catch (e) { /* degradar */ }

    return [];
  }

  /* ------------------------------------------------------------------ */
  /* Utilities de data                                                    */
  /* ------------------------------------------------------------------ */
  function isWeekday(date) {
    var d = date.getDay();
    return d !== 0 && d !== 6; // 0 = domingo, 6 = sábado
  }

  function getWeekdaysInMonth(ano, mes) {
    var days = [];
    var cur = new Date(ano, mes - 1, 1);
    while (cur.getMonth() === mes - 1) {
      if (isWeekday(cur)) days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  function toDateStr(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, '0');
    var d = String(date.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  // padStart polyfill para strings antigas
  if (!String.prototype.padStart) {
    String.prototype.padStart = function (targetLength, padString) {
      var str = String(this);
      padString = padString || ' ';
      while (str.length < targetLength) str = padString + str;
      return str;
    };
  }

  function parseLocalDate(str) {
    if (!str) return null;
    var parts = str.split('-');
    if (parts.length < 3) return null;
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  function mesStr(ano, mes) {
    return ano + '-' + String(mes).padStart(2, '0');
  }

  /* ------------------------------------------------------------------ */
  /* Tipos de evento                                                      */
  /* ------------------------------------------------------------------ */
  var TIPOS_DESCONTO    = ['feriado', 'falta', 'afastamento', 'ferias', 'outro'];
  // viagem NÃO desconta no mês corrente — é manual no mês seguinte
  // abono_acordo e compensar_acordo NÃO descontam

  /* ------------------------------------------------------------------ */
  /* Monta conjunto de datas (YYYY-MM-DD) que têm desconto de evento     */
  /* ------------------------------------------------------------------ */
  function buildDeductedSet(eventos, ano, mes) {
    var prefix = mesStr(ano, mes);
    var set = {};

    if (!Array.isArray(eventos)) return set;

    for (var i = 0; i < eventos.length; i++) {
      var ev = eventos[i];
      var tipo = ((ev.tipo || ev.type || ev.tipoEvento || '')).toLowerCase();

      if (TIPOS_DESCONTO.indexOf(tipo) === -1) continue;

      // Suporta data única ou range
      var inicio = ev.dataInicio || ev.data || ev.date || ev.inicio || ev.dataEvento;
      var fim    = ev.dataFim    || ev.fim  || inicio;

      if (!inicio) continue;

      var startD = parseLocalDate(inicio);
      var endD   = parseLocalDate(fim);
      if (!startD || !endD) continue;

      var cur = new Date(startD);
      while (cur <= endD) {
        var s = toDateStr(cur);
        if (s.indexOf(prefix) === 0) set[s] = true;
        cur.setDate(cur.getDate() + 1);
      }
    }

    return set;
  }

  /* ------------------------------------------------------------------ */
  /* getTarifaParaData(dataStr: YYYY-MM-DD)                              */
  /* ------------------------------------------------------------------ */
  function getTarifaParaData(dataStr) {
    var tarifas = loadTarifas();
    if (!tarifas.length) return null;

    var valid = tarifas
      .filter(function (t) { return t.vigenciaInicio && t.vigenciaInicio <= dataStr; })
      .sort(function (a, b) { return b.vigenciaInicio < a.vigenciaInicio ? -1 : 1; });

    if (valid.length > 0) return valid[0];
    // fallback: tarifa mais antiga
    return tarifas.sort(function (a, b) { return a.vigenciaInicio < b.vigenciaInicio ? -1 : 1; })[0];
  }

  /* ------------------------------------------------------------------ */
  /* calcularVRMes(ano, mes)                                             */
  /* ------------------------------------------------------------------ */
  function calcularVRMes(ano, mes) {
    var ms = mesStr(ano, mes);

    var weekdays = getWeekdaysInMonth(ano, mes);
    var diasUteisTotal = weekdays.length;

    var eventos    = getEventos();
    var deducted   = buildDeductedSet(eventos, ano, mes);

    // Exceções manuais do mês
    var excecoes    = loadExcecoes().filter(function (e) { return e.data && e.data.indexOf(ms) === 0; });
    var excIncluir  = {};
    var excExcluir  = {};
    excecoes.forEach(function (e) {
      if (e.acao === 'incluir')  excIncluir[e.data]  = true;
      if (e.acao === 'excluir') excExcluir[e.data] = true;
    });

    var diasExcluidosEventos = 0;
    var excludedDays = [];

    for (var i = 0; i < weekdays.length; i++) {
      var s = toDateStr(weekdays[i]);
      var excluded = !!deducted[s];
      if (excIncluir[s])  excluded = false;
      if (excExcluir[s])  excluded = true;
      if (excluded) {
        diasExcluidosEventos++;
        excludedDays.push(s);
      }
    }

    // Descontos de viagem manuais para o mês
    var viagens          = loadViagens();
    var diasViagemDesconto = viagens[ms] || 0;

    var diasElegiveis = Math.max(0, diasUteisTotal - diasExcluidosEventos - diasViagemDesconto);

    // Tarifa vigente no último dia do mês
    var lastDay = new Date(ano, mes, 0).getDate();
    var lastDayStr = ms + '-' + String(lastDay).padStart(2, '0');
    var tarifa     = getTarifaParaData(lastDayStr);
    var valorDiario = tarifa ? (parseFloat(tarifa.valorDiario) || 0) : 0;
    var valorTotal  = diasElegiveis * valorDiario;

    return {
      diasUteisTotal:       diasUteisTotal,
      diasExcluidosEventos: diasExcluidosEventos,
      diasViagemDesconto:   diasViagemDesconto,
      diasElegiveis:        diasElegiveis,
      valorDiario:          valorDiario,
      valorTotal:           valorTotal,
      tarifa:               tarifa,
      breakdown: {
        excludedDays: excludedDays,
        excecoes:     excecoes,
        mesStr:       ms
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Formatação                                                           */
  /* ------------------------------------------------------------------ */
  function fmtCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------------ */
  /* renderDashboardVR                                                    */
  /* ------------------------------------------------------------------ */
  function renderDashboardVR() {
    var card = document.getElementById('vrDashboardCard');
    if (!card) return;

    var now  = new Date();
    var ano  = now.getFullYear();
    var mes  = now.getMonth() + 1;
    var calc = calcularVRMes(ano, mes);

    var nomeMes = new Date(ano, mes - 1, 1)
      .toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    nomeMes = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);

    var avisoViagem = calc.diasViagemDesconto > 0
      ? '<div class="vr-aviso">⚠️ ' + calc.diasViagemDesconto + ' dia(s) de viagem descontado(s) neste mês (cadastrado manualmente)</div>'
      : '';

    var avisoTarifa = !calc.tarifa
      ? '<div class="vr-aviso">⚠️ Nenhuma tarifa cadastrada. Acesse <strong>Configurações</strong> para configurar o VR.</div>'
      : '';

    var viagemRow = calc.diasViagemDesconto > 0
      ? '<div class="vr-breakdown-row vr-negativo"><span>Desconto de viagem</span><span>−' + calc.diasViagemDesconto + '</span></div>'
      : '';

    card.innerHTML =
      '<div class="vr-card-inner">' +
        '<div class="vr-header">' +
          '<span class="vr-icon">🍽️</span>' +
          '<div>' +
            '<div class="vr-title">Vale-Refeição</div>' +
            '<div class="vr-subtitle">' + nomeMes + '</div>' +
          '</div>' +
        '</div>' +
        avisoTarifa +
        avisoViagem +
        '<div class="vr-valor-principal">' + fmtCurrency(calc.valorTotal) + '</div>' +
        '<div class="vr-breakdown">' +
          '<div class="vr-breakdown-row">' +
            '<span>Dias úteis no mês</span><span>' + calc.diasUteisTotal + '</span>' +
          '</div>' +
          '<div class="vr-breakdown-row vr-negativo">' +
            '<span>Descontos por eventos</span><span>−' + calc.diasExcluidosEventos + '</span>' +
          '</div>' +
          viagemRow +
          '<div class="vr-breakdown-row vr-total">' +
            '<span>Dias elegíveis</span><span>' + calc.diasElegiveis + '</span>' +
          '</div>' +
          '<div class="vr-breakdown-row">' +
            '<span>Valor diário</span><span>' + fmtCurrency(calc.valorDiario) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Sub-renders de listas (usados por renderVRConfigUI)                 */
  /* ------------------------------------------------------------------ */
  function renderTarifasList(tarifas) {
    if (!tarifas.length) return '<p class="vr-empty">Nenhuma tarifa cadastrada.</p>';
    return tarifas
      .slice()
      .sort(function (a, b) { return b.vigenciaInicio < a.vigenciaInicio ? -1 : 1; })
      .map(function (t) {
        var retBadge = t.retroativo ? '<span class="vr-badge vr-badge-blue">retroativo</span>' : '';
        var obs = t.observacoes ? '<div class="vr-tarifa-obs">' + escHtml(t.observacoes) + '</div>' : '';
        return '<div class="vr-tarifa-item">' +
          '<div class="vr-tarifa-info">' +
            '<span class="vr-tarifa-valor">' + fmtCurrency(t.valorDiario) + '</span>' +
            '<span class="vr-tarifa-vigencia">desde ' + escHtml(t.vigenciaInicio) + '</span>' +
            retBadge +
          '</div>' +
          obs +
          '<button type="button" class="btn-outline vr-btn-sm" ' +
            'data-vr-action="excluirTarifa" data-vr-id="' + escHtml(t.id) + '">Excluir</button>' +
        '</div>';
      }).join('');
  }

  function renderViagemList(viagens) {
    var entries = Object.keys(viagens)
      .sort(function (a, b) { return b < a ? -1 : 1; })
      .map(function (k) { return [k, viagens[k]]; });

    if (!entries.length) return '<p class="vr-empty">Nenhum desconto de viagem cadastrado.</p>';

    var rows = entries.map(function (pair) {
      return '<tr><td>' + escHtml(pair[0]) + '</td><td>' + pair[1] + '</td>' +
        '<td><button type="button" class="btn-outline vr-btn-sm" ' +
          'data-vr-action="excluirViagem" data-vr-mes="' + escHtml(pair[0]) + '">Excluir</button></td></tr>';
    }).join('');

    return '<table class="vr-preview-table"><thead><tr><th>Mês</th><th>Dias</th><th></th></tr></thead>' +
           '<tbody>' + rows + '</tbody></table>';
  }

  function renderExcecoesList(excecoes) {
    if (!excecoes.length) return '<p class="vr-empty">Nenhuma exceção cadastrada.</p>';

    var rows = excecoes
      .slice()
      .sort(function (a, b) { return b.data < a.data ? -1 : 1; })
      .map(function (e) {
        var badge = e.acao === 'incluir'
          ? '<span class="vr-badge vr-badge-green">incluir</span>'
          : '<span class="vr-badge vr-badge-red">excluir</span>';
        return '<tr>' +
          '<td>' + escHtml(e.data) + '</td>' +
          '<td>' + badge + '</td>' +
          '<td>' + escHtml(e.obs || '') + '</td>' +
          '<td><button type="button" class="btn-outline vr-btn-sm" ' +
            'data-vr-action="excluirExcecao" data-vr-data="' + escHtml(e.data) + '">Excluir</button></td>' +
        '</tr>';
      }).join('');

    return '<table class="vr-preview-table">' +
           '<thead><tr><th>Data</th><th>Ação</th><th>Obs</th><th></th></tr></thead>' +
           '<tbody>' + rows + '</tbody></table>';
  }

  function renderPreviewMeses() {
    var now = new Date();
    var anoAtual = now.getFullYear();
    var mesAtual = now.getMonth() + 1;
    var msAtual  = mesStr(anoAtual, mesAtual);

    var rows = '';
    for (var offset = -3; offset <= 3; offset++) {
      var d = new Date(anoAtual, mesAtual - 1 + offset, 1);
      var a = d.getFullYear();
      var m = d.getMonth() + 1;
      var ms = mesStr(a, m);
      var calc = calcularVRMes(a, m);
      var nomeMes = d.toLocaleString('pt-BR', { month: 'short', year: 'numeric' });
      var isAtual = (ms === msAtual) ? ' class="vr-row-atual"' : '';
      rows += '<tr' + isAtual + '>' +
        '<td>' + nomeMes + '</td>' +
        '<td>' + calc.diasUteisTotal + '</td>' +
        '<td>' + calc.diasExcluidosEventos + '</td>' +
        '<td>' + calc.diasViagemDesconto + '</td>' +
        '<td>' + calc.diasElegiveis + '</td>' +
        '<td>' + fmtCurrency(calc.valorDiario) + '</td>' +
        '<td><strong>' + fmtCurrency(calc.valorTotal) + '</strong></td>' +
      '</tr>';
    }

    return '<table class="vr-preview-table">' +
      '<thead><tr><th>Mês</th><th>Dias Úteis</th><th>Descontos</th><th>Viagem</th>' +
      '<th>Elegíveis</th><th>Valor/Dia</th><th>Total</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  /* ------------------------------------------------------------------ */
  /* renderVRConfigUI                                                     */
  /* ------------------------------------------------------------------ */
  function renderVRConfigUI() {
    var section = document.getElementById('vrConfigSection');
    if (!section) return;

    var tarifas  = loadTarifas();
    var viagens  = loadViagens();
    var excecoes = loadExcecoes();

    section.innerHTML =
      '<h2>🍽️ Vale-Refeição — Configurações</h2>' +

      /* --- Tarifas --- */
      '<div class="vr-config-block">' +
        '<div class="vr-config-header">' +
          '<h3>Tarifas</h3>' +
          '<button type="button" class="btn-primary" data-vr-action="abrirModalVR">+ Nova Tarifa</button>' +
        '</div>' +
        '<div id="vrTarifasList">' + renderTarifasList(tarifas) + '</div>' +
      '</div>' +

      /* --- Descontos de Viagem --- */
      '<div class="vr-config-block">' +
        '<h3>Descontos de Viagem (mês do desconto)</h3>' +
        '<p class="vr-hint">A viagem não desconta no mês corrente — informe o mês em que o desconto deve ser aplicado.</p>' +
        '<div class="vr-form-row">' +
          '<div class="form-group">' +
            '<label for="vrViagemMes">Mês:</label>' +
            '<input type="month" id="vrViagemMes">' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="vrViagemDias">Dias:</label>' +
            '<input type="number" id="vrViagemDias" min="0" max="31" placeholder="0">' +
          '</div>' +
          '<button type="button" class="btn-primary" data-vr-action="salvarViagemDesconto">Salvar</button>' +
        '</div>' +
        '<div id="vrViagemList">' + renderViagemList(viagens) + '</div>' +
      '</div>' +

      /* --- Exceções Manuais --- */
      '<div class="vr-config-block">' +
        '<h3>Exceções Manuais</h3>' +
        '<p class="vr-hint">Inclua ou exclua dias específicos manualmente da contagem de VR.</p>' +
        '<div class="vr-form-row">' +
          '<div class="form-group">' +
            '<label for="vrExcecaoData">Data:</label>' +
            '<input type="date" id="vrExcecaoData">' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="vrExcecaoAcao">Ação:</label>' +
            '<select id="vrExcecaoAcao"><option value="incluir">Incluir</option><option value="excluir">Excluir</option></select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label for="vrExcecaoObs">Observação:</label>' +
            '<input type="text" id="vrExcecaoObs" placeholder="Opcional">' +
          '</div>' +
          '<button type="button" class="btn-primary" data-vr-action="salvarExcecao">Salvar</button>' +
        '</div>' +
        '<div id="vrExcecoesList">' + renderExcecoesList(excecoes) + '</div>' +
      '</div>' +

      /* --- Preview de Meses --- */
      '<div class="vr-config-block">' +
        '<h3>Projeção de Meses</h3>' +
        '<div id="vrPreviewMeses">' + renderPreviewMeses() + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* injetarVRNoTimesheet                                                 */
  /* ------------------------------------------------------------------ */
  var MESES_PT = ['janeiro','fevereiro','março','abril','maio','junho',
                  'julho','agosto','setembro','outubro','novembro','dezembro'];

  function parseMesAnoFromText(text) {
    var lower = text.toLowerCase();
    for (var i = 0; i < MESES_PT.length; i++) {
      if (lower.indexOf(MESES_PT[i]) !== -1) {
        var match = text.match(/\d{4}/);
        if (match) return { mes: i + 1, ano: parseInt(match[0], 10) };
      }
    }
    return null;
  }

  function injetarVRNoTimesheet() {
    var content = document.getElementById('timesheetContent');
    if (!content) return;

    var blocks = content.querySelectorAll('.timesheet-month, [data-mes], .mes-block, [data-ano]');
    blocks.forEach(function (block) {
      if (block.querySelector('.vr-timesheet-linha')) return; // já injetado

      var ano, mes;
      if (block.dataset.ano && block.dataset.mes) {
        ano = parseInt(block.dataset.ano, 10);
        mes = parseInt(block.dataset.mes, 10);
      } else {
        var header = block.querySelector('h2, h3, .timesheet-header, .month-title, [class*="month"]');
        if (!header) return;
        var parsed = parseMesAnoFromText(header.textContent);
        if (!parsed) return;
        ano = parsed.ano;
        mes = parsed.mes;
      }
      if (!ano || !mes) return;

      var calc = calcularVRMes(ano, mes);
      var vrRow = document.createElement('div');
      vrRow.className = 'vr-timesheet-linha';
      vrRow.innerHTML =
        '<span class="vr-timesheet-label">🍽️ VR</span>' +
        '<span class="vr-timesheet-info">' +
          calc.diasElegiveis + ' dias elegíveis · ' + fmtCurrency(calc.valorTotal) +
        '</span>';
      block.appendChild(vrRow);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Modal de Nova Tarifa                                                 */
  /* ------------------------------------------------------------------ */
  function abrirModalVR() {
    var modal = document.getElementById('modalVRTarifa');
    if (!modal) return;
    ['vrNovaValor','vrNovaVigencia','vrNovaObs'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    var ret = document.getElementById('vrNovaRetroativo');
    if (ret) ret.checked = false;
    modal.style.display = 'flex';
  }

  function fecharModalVR() {
    var modal = document.getElementById('modalVRTarifa');
    if (modal) modal.style.display = 'none';
  }

  function salvarNovaVRTarifa() {
    var valEl = document.getElementById('vrNovaValor');
    var vigEl = document.getElementById('vrNovaVigencia');
    var retEl = document.getElementById('vrNovaRetroativo');
    var obsEl = document.getElementById('vrNovaObs');

    var valorStr = valEl ? valEl.value.trim().replace(',', '.') : '';
    var valor    = parseFloat(valorStr);
    var vigencia = vigEl ? vigEl.value : '';

    if (!valor || valor <= 0) { alert('Informe um valor diário válido.'); return; }
    if (!vigencia)            { alert('Informe a data de vigência (início).'); return; }

    var tarifas = loadTarifas();
    tarifas.push({
      id:            Date.now().toString(),
      valorDiario:   valor,
      vigenciaInicio: vigencia,
      retroativo:    retEl ? retEl.checked : false,
      observacoes:   obsEl ? obsEl.value.trim() : ''
    });
    saveTarifas(tarifas);
    fecharModalVR();
    renderVRConfigUI();
    renderDashboardVR();
  }

  /* ------------------------------------------------------------------ */
  /* Ações de configuração                                               */
  /* ------------------------------------------------------------------ */
  function salvarViagemDesconto() {
    var mesEl  = document.getElementById('vrViagemMes');
    var diasEl = document.getElementById('vrViagemDias');
    var mes    = mesEl  ? mesEl.value : '';
    var dias   = parseInt(diasEl ? diasEl.value : '0', 10) || 0;
    if (!mes)     { alert('Informe o mês.'); return; }
    if (dias < 0) { alert('Informe um número de dias válido (≥ 0).'); return; }
    var viagens = loadViagens();
    if (dias === 0) delete viagens[mes];
    else            viagens[mes] = dias;
    saveViagens(viagens);
    renderVRConfigUI();
    renderDashboardVR();
  }

  function salvarExcecao() {
    var dataEl = document.getElementById('vrExcecaoData');
    var acaoEl = document.getElementById('vrExcecaoAcao');
    var obsEl  = document.getElementById('vrExcecaoObs');
    var data   = dataEl ? dataEl.value : '';
    var acao   = acaoEl ? acaoEl.value : 'incluir';
    var obs    = obsEl  ? obsEl.value.trim() : '';
    if (!data) { alert('Informe a data.'); return; }
    var excecoes = loadExcecoes().filter(function (e) { return e.data !== data; });
    excecoes.push({ data: data, acao: acao, obs: obs });
    saveExcecoes(excecoes);
    renderVRConfigUI();
  }

  function excluirTarifa(id) {
    saveTarifas(loadTarifas().filter(function (t) { return t.id !== id; }));
    renderVRConfigUI();
    renderDashboardVR();
  }

  function excluirViagem(mes) {
    var viagens = loadViagens();
    delete viagens[mes];
    saveViagens(viagens);
    renderVRConfigUI();
    renderDashboardVR();
  }

  function excluirExcecao(data) {
    saveExcecoes(loadExcecoes().filter(function (e) { return e.data !== data; }));
    renderVRConfigUI();
  }

  /* ------------------------------------------------------------------ */
  /* Delegação de eventos — data-vr-action                               */
  /* ------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-vr-action]') : null;
    if (!btn) return;

    var action = btn.getAttribute('data-vr-action');
    switch (action) {
      case 'abrirModalVR':         abrirModalVR();                              break;
      case 'fecharModalVR':        fecharModalVR();                             break;
      case 'salvarNovaVRTarifa':   salvarNovaVRTarifa();                        break;
      case 'salvarViagemDesconto': salvarViagemDesconto();                      break;
      case 'salvarExcecao':        salvarExcecao();                             break;
      case 'excluirTarifa':        excluirTarifa(btn.getAttribute('data-vr-id'));   break;
      case 'excluirViagem':        excluirViagem(btn.getAttribute('data-vr-mes'));  break;
      case 'excluirExcecao':       excluirExcecao(btn.getAttribute('data-vr-data')); break;
    }
  });

  /* Fechar modal ao clicar no overlay */
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'modalVRTarifa') fecharModalVR();
  });

  /* ------------------------------------------------------------------ */
  /* Integração com troca de abas                                        */
  /* ------------------------------------------------------------------ */
  function hookTabSwitching() {
    // Debounce para evitar renderização dupla quando o MutationObserver e o
    // clique na aba disparam em sequência no mesmo ciclo de eventos.
    var _vrRenderTimer = null;
    function scheduleVRRender(fn) {
      clearTimeout(_vrRenderTimer);
      _vrRenderTimer = setTimeout(fn, 80);
    }

    // Observa mudança de classe `active` nas seções — única fonte de verdade
    function onClassChange(mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          var el = m.target;
          if (!el.classList.contains('active')) return;
          if (el.id === 'dashboard')    scheduleVRRender(renderDashboardVR);
          if (el.id === 'configuracoes') scheduleVRRender(renderVRConfigUI);
        }
      });
    }

    var ids = ['dashboard', 'configuracoes'];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) new MutationObserver(onClassChange).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    // O click listener foi removido pois o MutationObserver já cobre a transição
    // de aba (o app principal adiciona .active à seção ao trocar de aba).
  }

  /* ------------------------------------------------------------------ */
  /* MutationObserver para #timesheetContent                             */
  /* ------------------------------------------------------------------ */
  function setupTimesheetObserver() {
    function attachTo(el) {
      new MutationObserver(function () { setTimeout(injetarVRNoTimesheet, 150); })
        .observe(el, { childList: true, subtree: true });
      injetarVRNoTimesheet();
    }

    var existing = document.getElementById('timesheetContent');
    if (existing) { attachTo(existing); return; }

    // Espera o elemento aparecer
    new MutationObserver(function (_, obs) {
      var el = document.getElementById('timesheetContent');
      if (el) { obs.disconnect(); attachTo(el); }
    }).observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ */
  /* setDataProvider                                                      */
  /* ------------------------------------------------------------------ */
  function setDataProvider(fn) {
    window.VRDataProvider = fn;
  }

  /* ------------------------------------------------------------------ */
  /* Inicialização                                                        */
  /* ------------------------------------------------------------------ */
  function init() {
    hookTabSwitching();
    setupTimesheetObserver();

    // Renderiza se a aba já estiver ativa no carregamento
    var dash = document.getElementById('dashboard');
    if (dash && dash.classList.contains('active')) renderDashboardVR();

    var conf = document.getElementById('configuracoes');
    if (conf && conf.classList.contains('active')) renderVRConfigUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ------------------------------------------------------------------ */
  /* API pública                                                          */
  /* ------------------------------------------------------------------ */
  window.ValeRefeicao = {
    calcularVRMes:    calcularVRMes,
    renderDashboardVR: renderDashboardVR,
    renderVRConfigUI:  renderVRConfigUI,
    setDataProvider:   setDataProvider
  };

}());
