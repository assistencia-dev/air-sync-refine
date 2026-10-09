(function () {
  "use strict";
  function ensureState() {
    if (typeof ERP_STATE === "undefined") return false;
    if (!Array.isArray(ERP_STATE.orcamentos)) ERP_STATE.orcamentos = [];
    return true;
  }

  function money(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function injectUI() {
    if (document.getElementById("tab-orcamentos")) return;
    var nav = document.querySelector(".nav-menu");
    if (nav) {
      var section = document.createElement("div");
      section.className = "nav-section";
      section.textContent = "Comercial";
      var item = document.createElement("li");
      item.className = "nav-item";
      item.innerHTML = "<span>Orçamentos</span>";
      item.onclick = function () { window.switchTab("tab-orcamentos", item); };
      nav.insertBefore(item, nav.firstChild);
    }
    var main = document.querySelector("main");
    if (!main) return;
    var tab = document.createElement("div");
    tab.id = "tab-orcamentos";
    tab.className = "tab-view";
    tab.innerHTML =
      '<div class="data-card" style="padding:20px;margin-bottom:20px;">' +
      '<h3 style="margin-bottom:14px;">Novo Orçamento</h3>' +
      '<form id="form-orcamento"><div class="form-grid">' +
      '<div class="form-group"><label>Cliente</label><select id="orc-cliente" required></select></div>' +
      '<div class="form-group"><label>Equipamento</label><select id="orc-equipamento"></select></div>' +
      '<div class="form-group"><label>Serviço</label><select id="orc-servico" required></select></div>' +
      '<div class="form-group"><label>Quantidade</label><input id="orc-qtd" type="number" min="1" value="1" required></div>' +
      '</div><div class="form-grid" style="margin-top:12px;">' +
      '<div class="form-group"><label>Desconto (R$)</label><input id="orc-desconto" type="number" min="0" step="0.01" value="0"></div>' +
      '<div class="form-group"><label>Validade (dias)</label><input id="orc-validade" type="number" min="1" value="10"></div>' +
      '<div class="form-group"><label>Pagamento</label><input id="orc-pagamento" value="A combinar"></div>' +
      '</div><div style="margin-top:12px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;display:flex;justify-content:space-between;gap:20px;">' +
      '<span>Subtotal <strong id="orc-subtotal">R$ 0,00</strong></span><span>Total <strong id="orc-total">R$ 0,00</strong></span></div>' +
      '<div class="form-group" style="margin-top:12px;"><label>Escopo / Observações</label><textarea id="orc-desc" rows="3" required></textarea></div>' +
      '<div style="margin-top:14px;text-align:right;"><button class="btn btn-primary" type="submit">Salvar Orçamento</button></div></form></div>' +
      '<div class="data-card"><div class="data-header"><h3>Orçamentos Registrados</h3><div class="filter-bar"><select id="orc-filtro"><option value="TODOS">Todos</option><option>Rascunho</option><option>Aprovado</option><option>Rejeitado</option><option>Convertido em OS</option></select></div></div>' +
      '<table><thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Serviço</th><th>Total</th><th>Validade</th><th>Status</th><th>Ações</th></tr></thead><tbody id="orc-table-body"></tbody></table></div>';
    main.appendChild(tab);
    document.getElementById("form-orcamento").addEventListener("submit", saveQuote);
    document.getElementById("orc-cliente").addEventListener("change", refreshQuoteEquipment);
    document.getElementById("orc-servico").addEventListener("change", refreshQuoteTotal);
    document.getElementById("orc-qtd").addEventListener("input", refreshQuoteTotal);
    document.getElementById("orc-desconto").addEventListener("input", refreshQuoteTotal);
    document.getElementById("orc-filtro").addEventListener("change", renderQuotes);
  }

  function refreshQuoteEquipment() {
    ensureState();
    var id = String(document.getElementById("orc-cliente").value || "");
    var select = document.getElementById("orc-equipamento");
    if (!select) return;
    var list = ERP_STATE.equipamentos.filter(function (e) { return String(e.clienteId) === id; });
    select.innerHTML = '<option value="">Serviço geral / sem equipamento</option>' + list.map(function (e) {
      return '<option value="' + e.id + '">' + e.tag + ' - ' + e.tipo + ' (' + e.ambiente + ')</option>';
    }).join("");
  }

  function refreshQuoteTotal() {
    var service = ERP_STATE.servicos.find(function (s) { return String(s.id) === String(document.getElementById("orc-servico").value || ""); });
    var qty = Math.max(1, Number(document.getElementById("orc-qtd").value || 1));
    var discount = Math.max(0, Number(document.getElementById("orc-desconto").value || 0));
    var subtotal = service ? Number(service.valor || 0) * qty : 0;
    var total = Math.max(0, subtotal - discount);
    document.getElementById("orc-subtotal").textContent = money(subtotal);
    document.getElementById("orc-total").textContent = money(total);
  }

  function populateQuoteForm() {
    ensureState();
    var c = document.getElementById("orc-cliente"), s = document.getElementById("orc-servico");
    if (!c || !s) return;
    c.innerHTML = ERP_STATE.clientes.map(function (x) { return '<option value="' + x.id + '">' + x.nome + '</option>'; }).join("");
    s.innerHTML = ERP_STATE.servicos.map(function (x) { return '<option value="' + x.id + '">' + x.nome + ' (' + money(x.valor) + ')</option>'; }).join("");
    refreshQuoteEquipment();
    refreshQuoteTotal();
  }

  function saveQuote(ev) {
    ev.preventDefault(); ensureState();
    var clientId = String(document.getElementById("orc-cliente").value || "");
    var serviceId = String(document.getElementById("orc-servico").value || "");
    var service = ERP_STATE.servicos.find(function (s) { return s.id === serviceId; });
    if (!clientId || !service) { alert("Cadastre cliente e serviço antes de criar o orçamento."); return; }
    var qty = Math.max(1, Number(document.getElementById("orc-qtd").value || 1));
    var discount = Math.max(0, Number(document.getElementById("orc-desconto").value || 0));
    var subtotal = Number(service.valor || 0) * qty;
    var total = Math.max(0, subtotal - discount);
    var validityDays = Math.max(1, Number(document.getElementById("orc-validade").value || 10));
    var due = new Date(Date.now() + validityDays * 86400000);
    var seq = ERP_STATE.orcamentos.reduce(function (m, o) { return Math.max(m, Number(String(o.id || "").replace(/\\D/g, "")) || 0); }, 1000) + 1;
    ERP_STATE.orcamentos.push({
      id: "ORC-" + seq, data: new Date().toLocaleDateString("pt-BR"), validade: due.toLocaleDateString("pt-BR"),
      clienteId: clientId, equipamentoId: Number(document.getElementById("orc-equipamento").value) || null, serviceId: serviceId,
      servicoId: serviceId, qtd: qty, desconto: discount, subtotal: subtotal, total: total,
      pagamento: document.getElementById("orc-pagamento").value.trim(), desc: document.getElementById("orc-desc").value.trim(),
      status: "Rascunho", osId: null
    });
    window.saveState();
    document.getElementById("form-orcamento").reset();
    populateQuoteForm(); renderQuotes();
    alert("Orçamento salvo com sucesso.");
  }

  function renderQuotes() {
    ensureState(); var body = document.getElementById("orc-table-body");
    if (!body) return;
    var filter = document.getElementById("orc-filtro").value;
    var rows = ERP_STATE.orcamentos.filter(function (o) { return filter === "TODOS" || o.status === filter; }).map(function (o) {
      var c = ERP_STATE.clientes.find(function (x) { return x.id === o.clienteId; }) || {};
      var s = ERP_STATE.servicos.find(function (x) { return String(x.id) === String(o.servicoId || o.serviceId); }) || {};
      var action = '<button class="btn btn-secondary btn-sm" onclick="window.quoteStatus(\'' + o.id + '\',\'Aprovado\')">Aprovar</button>';
      if (o.status === "Aprovado") action = '<button class="btn btn-success btn-sm" onclick="window.quoteToOs(\'' + o.id + '\')">Gerar OS</button>';
      if (o.status === "Convertido em OS") action = '<span class="badge badge-concluido">' + (o.osId || "OS") + "</span>";
      return '<tr><td><strong>' + o.id + '</strong></td><td>' + o.data + '</td><td>' + (c.nome || "-") + '</td><td>' + (s.nome || "-") + '</td><td>' + money(o.total) + '</td><td>' + o.validade + '</td><td><span class="badge ' + (o.status === "Aprovado" ? "badge-concluido" : "badge-andamento") + '">' + o.status + '</span></td><td>' + action + '</td></tr>';
    }).join("");
    body.innerHTML = rows || '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:20px;">Nenhum orçamento registrado.</td></tr>';
  }

  window.quoteStatus = function (id, status) {
    var q = ERP_STATE.orcamentos.find(function (x) { return x.id === id; }); if (!q) return;
    q.status = status; window.saveState(); renderQuotes();
  };

  window.quoteToOs = function (id) {
    ensureState(); var q = ERP_STATE.orcamentos.find(function (x) { return x.id === id; });
    if (!q || q.status !== "Aprovado") return;
    if (q.osId) { alert("Este orçamento já foi convertido em OS."); return; }
    if (!ERP_STATE.tecnicos.length) { alert("Cadastre ou vincule um técnico antes de gerar a OS."); return; }
    var tech = ERP_STATE.tecnicos[0];
    var os = {
      id: "OS-0" + (4891 + ERP_STATE.ordens.length), data: new Date().toLocaleDateString("pt-BR"),
      clienteId: q.clienteId, equipamentoId: q.equipamentoId || null, tecnicoId: tech.id, tecnicoEmployeeId: tech.employeeId || null,
      tecnicoEmail: tech.email || tech.loginEmail || null, servicoId: q.servicoId || q.serviceId, tipo: "Orçamento aprovado",
      valor: Number(q.total || 0), status: "Em Atendimento", desc: q.desc, pecasUsadas: [], assinatura: null, fotoAntes: null, fotoDepois: null, orcamentoId: q.id
    };
    ERP_STATE.ordens.push(os); q.status = "Convertido em OS"; q.osId = os.id;
    window.saveState();
    if (typeof window.renderizarTudo === "function") window.renderizarTudo();
    alert("Orçamento convertido em " + os.id + ".");
  };

  function migrateTechnicianLinks() {
    ensureState(); var changed = false;
    ERP_STATE.ordens.forEach(function (o) {
      var tech = ERP_STATE.tecnicos.find(function (t) { return (o.tecnicoEmployeeId && String(t.employeeId || "") === String(o.tecnicoEmployeeId || "")) || (o.tecnicoEmail && String(t.email || t.loginEmail || "").toLowerCase() === String(o.tecnicoEmail).toLowerCase()) || String(t.id) === String(o.tecnicoId); });
      if (tech) {
        if (!o.tecnicoEmployeeId && tech.employeeId) { o.tecnicoEmployeeId = tech.employeeId; changed = true; }
        if (!o.tecnicoEmail && (tech.email || tech.loginEmail)) { o.tecnicoEmail = tech.email || tech.loginEmail; changed = true; }
        if (o.tecnicoId !== tech.id) { o.tecnicoId = tech.id; changed = true; }
      }
    });
    if (changed) window.saveState();
  }

  // Expor o renderizador para a navegação por abas sob demanda.
  window.renderizarOrcamentos = function () {
    ensureState();
    populateQuoteForm();
    renderQuotes();
  };

  var oldSaveState = window.saveState;
  if (typeof oldSaveState === "function") window.saveState = function () { ensureState(); oldSaveState(); };
  var oldRenderAll = window.renderizarTudo;
  if (typeof oldRenderAll === "function") window.renderizarTudo = function () { oldRenderAll(); ensureState(); populateQuoteForm(); renderQuotes(); };

  function boot() {
    ensureState(); injectUI(); migrateTechnicianLinks(); populateQuoteForm(); renderQuotes();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
