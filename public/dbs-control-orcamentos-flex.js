(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); };
  var num = function (v) { var n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  var catalog = function () {
    var s = Array.isArray(ERP_STATE.servicos) ? ERP_STATE.servicos : [];
    var p = Array.isArray(ERP_STATE.pecas) ? ERP_STATE.pecas : [];
    return s.map(function (x) { return { tipo: "servico", id: x.id, nome: x.nome || x.descricao || "Serviço", descricao: x.descricao || x.nome || "Serviço", valor: num(x.valor || x.preco || x.valorVenda) }; })
      .concat(p.map(function (x) { return { tipo: "peca", id: x.id, nome: x.nome || x.descricao || x.codigo || "Peça", descricao: x.descricao || x.nome || x.codigo || "Peça", valor: num(x.valorVenda || x.precoVenda || x.valor || x.preco) }; }));
  };
  var clients = function () { return Array.isArray(ERP_STATE.clientes) ? ERP_STATE.clientes : []; };
  var quoteItems = function (q) {
    if (Array.isArray(q.itens) && q.itens.length) return q.itens;
    var c = catalog().find(function (x) { return String(x.id) === String(q.servicoId || q.serviceId); });
    return [{ tipo: "servico", catalogoId: q.servicoId || q.serviceId || "", descricao: c ? c.descricao : (q.desc || "Item do orçamento"), quantidade: num(q.qtd || 1), valorUnitario: num(q.valorUnitario != null ? q.valorUnitario : c && c.valor), total: num(q.subtotal != null ? q.subtotal : q.total) }];
  };
  function itemRow(item, index) {
    var options = catalog().map(function (c) {
      var selected = String(item.catalogoId || "") === String(c.id) && String(item.tipo || "") === c.tipo;
      return '<option value="' + esc(c.tipo + ":" + c.id) + '"' + (selected ? " selected" : "") + '>' + esc((c.tipo === "peca" ? "Peça · " : "Serviço · ") + c.nome) + '</option>';
    }).join("");
    return '<tr data-item-row="' + index + '"><td><select class="oq-catalog" aria-label="Item do catálogo"><option value="">Item manual / descrição livre</option>' + options + '</select></td>' +
      '<td><input class="oq-desc" aria-label="Descrição do item" value="' + esc(item.descricao || "") + '" placeholder="Descrição do produto/serviço" required></td>' +
      '<td><input class="oq-qty" aria-label="Quantidade" type="number" min="0.01" step="0.01" value="' + esc(item.quantidade == null ? 1 : item.quantidade) + '" required></td>' +
      '<td><input class="oq-price" aria-label="Valor unitário" type="number" min="0" step="0.01" value="' + esc(item.valorUnitario == null ? 0 : item.valorUnitario) + '" required></td>' +
      '<td class="oq-line-total" style="text-align:right;white-space:nowrap;font-weight:700">' + money(num(item.quantidade || 1) * num(item.valorUnitario)) + '</td>' +
      '<td><button type="button" class="btn btn-secondary btn-sm oq-remove" aria-label="Remover item">Remover</button></td></tr>';
  }
  function mount() {
    if (typeof ERP_STATE === "undefined" || !Array.isArray(ERP_STATE.orcamentos)) {
      if (typeof ERP_STATE !== "undefined") ERP_STATE.orcamentos = ERP_STATE.orcamentos || [];
    }
    var tab = $("tab-orcamentos");
    if (!tab || tab.dataset.flexReady === "1") return;
    tab.dataset.flexReady = "1";
    tab.innerHTML = '<div class="data-card oq-shell"><div class="oq-heading"><div><h2>Proposta comercial</h2><p>Monte propostas com peças, serviços ou itens livres, sem movimentar estoque.</p></div><span class="oq-brand">DBS AIR</span></div>' +
      '<form id="oq-form"><div class="oq-grid"><label>Cliente<select id="oq-client" required></select></label><label>Validade (dias)<input id="oq-validity" type="number" min="1" value="10" required></label><label>Condição de pagamento<input id="oq-payment" value="A combinar" maxlength="180"></label><label>Desconto total (R$)<input id="oq-discount" type="number" min="0" step="0.01" value="0"></label></div>' +
      '<div class="oq-items-head"><h3>Itens da proposta</h3><button type="button" class="btn btn-secondary" id="oq-add">+ Adicionar item</button></div>' +
      '<div class="oq-table-wrap"><table class="oq-items"><thead><tr><th>Catálogo</th><th>Descrição</th><th>Qtd.</th><th>Valor unitário (R$)</th><th>Total</th><th></th></tr></thead><tbody id="oq-items"></tbody></table></div>' +
      '<label class="oq-notes-label">Descrição geral, condições e observações<textarea id="oq-notes" rows="3" placeholder="Prazo de entrega, garantia, escopo, condições especiais..."></textarea></label>' +
      '<div class="oq-totals"><span>Subtotal <strong id="oq-subtotal">R$ 0,00</strong></span><span>Desconto <strong id="oq-discount-show">R$ 0,00</strong></span><span class="oq-grand">Total da proposta <strong id="oq-total">R$ 0,00</strong></span></div>' +
      '<div class="oq-actions"><button type="button" class="btn btn-secondary" id="oq-clear">Limpar formulário</button><button type="submit" class="btn btn-primary">Salvar proposta</button></div></form></div>' +
      '<div class="data-card oq-list-card"><div class="oq-list-head"><h3>Propostas registradas</h3><select id="oq-filter"><option value="TODOS">Todos os status</option><option>Rascunho</option><option>Aprovado</option><option>Rejeitado</option><option>Convertido em OS</option></select></div>' +
      '<div class="oq-table-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Validade</th><th>Status</th><th>Ações</th></tr></thead><tbody id="oq-list"></tbody></table></div></div>';
    var client = $("oq-client");
    client.innerHTML = '<option value="">Selecione o cliente...</option>' + clients().map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.nome || c.razaoSocial || c.nomeFantasia || "Cliente") + '</option>'; }).join("");
    addItem({ tipo: "", catalogoId: "", descricao: "", quantidade: 1, valorUnitario: 0 });
    $("oq-add").addEventListener("click", function () { addItem({ tipo: "", catalogoId: "", descricao: "", quantidade: 1, valorUnitario: 0 }); });
    $("oq-items").addEventListener("change", function (ev) {
      var row = ev.target.closest("tr"); if (!row) return;
      if (ev.target.classList.contains("oq-catalog") && ev.target.value) {
        var parts = ev.target.value.split(":");
        var found = catalog().find(function (c) { return c.tipo === parts[0] && String(c.id) === parts.slice(1).join(":"); });
        if (found) { row.querySelector(".oq-desc").value = found.descricao; row.querySelector(".oq-price").value = found.valor; }
      }
      totals();
    });
    $("oq-items").addEventListener("input", totals);
    $("oq-items").addEventListener("click", function (ev) { if (ev.target.classList.contains("oq-remove")) { ev.target.closest("tr").remove(); totals(); } });
    $("oq-discount").addEventListener("input", totals);
    $("oq-filter").addEventListener("change", render);
    $("oq-clear").addEventListener("click", reset);
    $("oq-form").addEventListener("submit", save);
    render(); totals();
  }
  function addItem(item) {
    var body = $("oq-items"); if (!body) return;
    body.insertAdjacentHTML("beforeend", itemRow(item, body.children.length));
    totals();
  }
  function totals() {
    var body = $("oq-items"); if (!body) return { subtotal: 0, discount: 0, total: 0 };
    var subtotal = 0;
    Array.from(body.querySelectorAll("tr")).forEach(function (row) {
      var line = Math.max(0, num(row.querySelector(".oq-qty").value)) * Math.max(0, num(row.querySelector(".oq-price").value));
      subtotal += line; row.querySelector(".oq-line-total").textContent = money(line);
    });
    var discount = Math.min(subtotal, Math.max(0, num($("oq-discount").value)));
    $("oq-subtotal").textContent = money(subtotal);
    $("oq-discount-show").textContent = money(discount);
    $("oq-total").textContent = money(Math.max(0, subtotal - discount));
    return { subtotal: subtotal, discount: discount, total: Math.max(0, subtotal - discount) };
  }
  function readItems() {
    return Array.from($("oq-items").querySelectorAll("tr")).map(function (row) {
      var selected = row.querySelector(".oq-catalog").value.split(":");
      return { tipo: selected[0] || "manual", catalogoId: selected.length > 1 ? selected.slice(1).join(":") : null,
        descricao: row.querySelector(".oq-desc").value.trim(), quantidade: num(row.querySelector(".oq-qty").value),
        valorUnitario: num(row.querySelector(".oq-price").value), total: num(row.querySelector(".oq-qty").value) * num(row.querySelector(".oq-price").value) };
    });
  }
  function save(ev) {
    ev.preventDefault();
    var items = readItems().filter(function (x) { return x.descricao && x.quantidade > 0 && x.valorUnitario >= 0; });
    if (!$("oq-client").value) { alert("Selecione o cliente da proposta."); return; }
    if (!items.length) { alert("Adicione pelo menos um item com descrição e quantidade válida."); return; }
    var sum = totals();
    var validity = Math.max(1, num($("oq-validity").value) || 10);
    var now = new Date();
    var seq = (ERP_STATE.orcamentos || []).reduce(function (m, q) { return Math.max(m, Number(String(q.id || "").replace(/\D/g, "")) || 0); }, 1000) + 1;
    var first = items[0], clientId = $("oq-client").value;
    var q = { id: "ORC-" + seq, data: now.toLocaleDateString("pt-BR"), validade: new Date(now.getTime() + validity * 86400000).toLocaleDateString("pt-BR"),
      clienteId: clientId, itens: items, subtotal: sum.subtotal, desconto: sum.discount, total: sum.total,
      serviceId: first.tipo === "servico" ? first.catalogoId : null, servicoId: first.tipo === "servico" ? first.catalogoId : null,
      qtd: first.quantidade, valorUnitario: first.valorUnitario, pagamento: $("oq-payment").value.trim(),
      desc: $("oq-notes").value.trim(), status: "Rascunho", osId: null };
    ERP_STATE.orcamentos = Array.isArray(ERP_STATE.orcamentos) ? ERP_STATE.orcamentos : [];
    ERP_STATE.orcamentos.push(q);
    if (typeof window.saveState === "function") window.saveState();
    reset(); render(); alert("Proposta " + q.id + " salva.");
  }
  function reset() {
    if (!$("oq-form")) return;
    $("oq-form").reset(); $("oq-validity").value = "10"; $("oq-payment").value = "A combinar";
    $("oq-items").innerHTML = ""; addItem({ tipo: "", catalogoId: "", descricao: "", quantidade: 1, valorUnitario: 0 }); totals();
  }
  function render() {
    var body = $("oq-list"); if (!body) return;
    var filter = $("oq-filter").value;
    var rows = (ERP_STATE.orcamentos || []).filter(function (q) { return filter === "TODOS" || q.status === filter; }).map(function (q) {
      var c = clients().find(function (x) { return String(x.id) === String(q.clienteId); }) || {};
      var items = quoteItems(q); var label = items.map(function (x) { return x.descricao || "Item"; }).join(", ");
      var actions = '<button type="button" class="btn btn-secondary btn-sm" data-pdf="' + esc(q.id) + '">PDF</button> ';
      if (q.status === "Rascunho") actions += '<button type="button" class="btn btn-secondary btn-sm" data-status="Aprovado" data-id="' + esc(q.id) + '">Aprovar</button>';
      if (q.status === "Aprovado") actions += '<button type="button" class="btn btn-success btn-sm" data-os="' + esc(q.id) + '">Gerar OS</button>';
      return '<tr><td><strong>' + esc(q.id) + '</strong></td><td>' + esc(q.data || "-") + '</td><td>' + esc(c.nome || c.razaoSocial || c.nomeFantasia || "-") + '</td><td title="' + esc(label) + '">' + items.length + ' item(ns)</td><td>' + money(q.total) + '</td><td>' + esc(q.validade || "-") + '</td><td>' + esc(q.status || "Rascunho") + '</td><td class="oq-row-actions">' + actions + '</td></tr>';
    }).join("");
    body.innerHTML = rows || '<tr><td colspan="8" style="padding:20px;text-align:center;color:#64748b">Nenhuma proposta registrada.</td></tr>';
    body.onclick = function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.pdf) pdf(b.dataset.pdf);
      if (b.dataset.status && typeof window.quoteStatus === "function") window.quoteStatus(b.dataset.id, b.dataset.status);
      if (b.dataset.os && typeof window.quoteToOs === "function") window.quoteToOs(b.dataset.os);
      render();
    };
  }
  function pdf(id) {
    var q = (ERP_STATE.orcamentos || []).find(function (x) { return String(x.id) === String(id); }); if (!q) return;
    var C = clients().find(function (x) { return String(x.id) === String(q.clienteId); }) || {};
    var items = quoteItems(q);
    var JsPDF = window.jspdf && window.jspdf.jsPDF;
    if (!JsPDF) { alert("O gerador de PDF não foi carregado. Atualize a página e tente novamente."); return; }
    var doc = new JsPDF({ unit: "mm", format: "a4" }), pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight();
    var x = 15, y = 18, maxW = pageW - 30;
    function header() {
      doc.setFillColor(16, 65, 112); doc.rect(0, 0, pageW, 31, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.text("DBS AIR", x, 13);
      doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text("PROPOSTA COMERCIAL", x, 21);
      doc.text(String(q.id || "ORÇAMENTO"), pageW - x, 14, { align: "right" });
      doc.text("Emitida em " + (q.data || new Date().toLocaleDateString("pt-BR")), pageW - x, 21, { align: "right" });
      y = 41; doc.setTextColor(25, 45, 66);
    }
    function check(needed) { if (y + needed > pageH - 18) { doc.addPage(); header(); } }
    header(); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("CLIENTE", x, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    var clientName = C.nome || C.razaoSocial || C.nomeFantasia || "Cliente";
    doc.text(doc.splitTextToSize(String(clientName), maxW), x, y); y += 6;
    var details = [C.cnpj ? "CNPJ: " + C.cnpj : "", C.email ? "E-mail: " + C.email : "", C.telefone ? "Telefone: " + C.telefone : "", C.endereco || C.logradouro || ""].filter(Boolean);
    details.forEach(function (t) { var lines = doc.splitTextToSize(String(t), maxW); check(lines.length * 5 + 1); doc.text(lines, x, y); y += lines.length * 5; });
    y += 5; check(12); doc.setFont("helvetica", "bold"); doc.text("ITENS E VALORES", x, y); y += 7;
    doc.setFillColor(230, 239, 248); doc.rect(x, y - 4, maxW, 8, "F"); doc.setFontSize(8);
    doc.text("DESCRIÇÃO", x + 2, y + 1); doc.text("QTD.", 128, y + 1, { align: "right" }); doc.text("UNITÁRIO", 157, y + 1, { align: "right" }); doc.text("TOTAL", pageW - x - 2, y + 1, { align: "right" }); y += 9;
    items.forEach(function (it) {
      var lines = doc.splitTextToSize(String(it.descricao || "Item"), 86);
      check(Math.max(8, lines.length * 4.5 + 4));
      doc.setFont("helvetica", "normal"); doc.text(lines, x + 2, y);
      doc.text(String(it.quantidade || 1), 128, y, { align: "right" });
      doc.text(money(it.valorUnitario).replace(/\s/g, " "), 157, y, { align: "right" });
      doc.text(money(num(it.quantidade || 1) * num(it.valorUnitario)).replace(/\s/g, " "), pageW - x - 2, y, { align: "right" });
      y += Math.max(7, lines.length * 4.5 + 3); doc.setDrawColor(220, 229, 237); doc.line(x, y - 2, pageW - x, y - 2);
    });
    y += 4; check(26); doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("Subtotal: " + money(q.subtotal), pageW - x, y, { align: "right" }); y += 6;
    doc.text("Desconto: " + money(q.desconto), pageW - x, y, { align: "right" }); y += 7;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(16, 65, 112); doc.text("TOTAL: " + money(q.total), pageW - x, y, { align: "right" }); y += 10;
    doc.setTextColor(25, 45, 66); doc.setFontSize(9); doc.setFont("helvetica", "bold"); check(15); doc.text("VALIDADE E CONDIÇÕES", x, y); y += 5;
    doc.setFont("helvetica", "normal"); var terms = "Validade: " + (q.validade || "A combinar") + "\nPagamento: " + (q.pagamento || "A combinar");
    var notes = String(q.desc || "").trim(); if (notes) terms += "\nObservações: " + notes;
    var termLines = doc.splitTextToSize(terms, maxW); check(termLines.length * 4.5 + 8); doc.text(termLines, x, y); y += termLines.length * 4.5 + 8;
    check(20); doc.setDrawColor(150, 170, 190); doc.line(x, y + 6, x + 70, y + 6); doc.line(pageW - x - 70, y + 6, pageW - x, y + 6);
    doc.setFontSize(8); doc.text("DBS AIR · Proposta comercial", x, pageH - 8); doc.text("Página " + doc.internal.getCurrentPageInfo().pageNumber, pageW - x, pageH - 8, { align: "right" });
    doc.save(String(q.id || "proposta").replace(/[^a-z0-9_-]/gi, "_") + ".pdf");
  }
  var style = document.createElement("style");
  style.textContent = ".oq-shell,.oq-list-card{padding:20px;margin-bottom:18px;border:1px solid #dbe7f2;border-radius:12px;background:#fff}.oq-heading,.oq-items-head,.oq-list-head,.oq-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.oq-heading{border-bottom:1px solid #e4edf5;padding-bottom:15px;margin-bottom:16px}.oq-heading h2{font-size:18px;color:#123e68}.oq-heading p{font-size:12px;color:#647b92;margin-top:4px}.oq-brand{font-weight:900;color:#1769aa;border:1px solid #b9d7ef;border-radius:8px;padding:8px 12px}.oq-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.oq-grid label,.oq-notes-label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:800;color:#36536f}.oq-grid input,.oq-grid select,.oq-notes-label textarea,.oq-items input,.oq-items select,.oq-list-head select{width:100%;min-width:0;border:1px solid #cbd9e7;border-radius:7px;background:#fff;color:#163754;padding:9px;font-size:12px}.oq-items-head{margin:22px 0 10px}.oq-items-head h3,.oq-list-head h3{font-size:14px;color:#163e65}.oq-table-wrap{width:100%;overflow:auto}.oq-items{width:100%;min-width:780px;border-collapse:collapse}.oq-items th,.oq-items td{padding:8px 6px;border-bottom:1px solid #e5edf5;text-align:left;font-size:11px}.oq-items th{background:#f1f7fc;color:#3c5a76}.oq-items td:nth-child(3){width:78px}.oq-items td:nth-child(4){width:130px}.oq-items td:nth-child(5){min-width:95px}.oq-notes-label{margin-top:16px}.oq-notes-label textarea{resize:vertical}.oq-totals{display:flex;justify-content:flex-end;gap:22px;align-items:center;flex-wrap:wrap;margin:16px 0;padding:14px;background:#f2f8fd;border:1px solid #d8e8f5;border-radius:9px;font-size:12px;color:#49627b}.oq-totals strong{display:block;color:#163e65;font-size:14px;margin-top:4px}.oq-totals .oq-grand strong{font-size:20px;color:#0b67a5}.oq-actions{justify-content:flex-end}.oq-list-head{margin-bottom:14px}.oq-row-actions{white-space:nowrap}.oq-row-actions button{margin:2px}@media(max-width:900px){.oq-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.oq-shell,.oq-list-card{padding:12px}.oq-grid{grid-template-columns:1fr}.oq-totals{justify-content:space-between;gap:12px}.oq-totals .oq-grand{width:100%}.oq-heading h2{font-size:16px}}";
  document.head.appendChild(style);
  function start() { if (typeof ERP_STATE !== "undefined" && $("tab-orcamentos")) mount(); else setTimeout(start, 200); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  var oldRender = window.renderizarOrcamentos;
  window.renderizarOrcamentos = function () { if ($("tab-orcamentos") && $("tab-orcamentos").dataset.flexReady !== "1") mount(); if (oldRender && $("tab-orcamentos") && $("tab-orcamentos").dataset.flexReady !== "1") oldRender(); render(); };
})();