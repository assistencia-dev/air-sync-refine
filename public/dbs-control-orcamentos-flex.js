(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var money = function (v) { return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); };
  var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); };
  var num = function (v) { var n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  var catalog = function () {
    var s = Array.isArray(ERP_STATE.servicos) ? ERP_STATE.servicos : [];
    var p = Array.isArray(ERP_STATE.pecas) ? ERP_STATE.pecas : [];
    return s.map(function (x) { return { tipo: "servico", id: x.id, nome: x.nome || x.descricao || "Serviço", descricao: x.descricao || x.nome || "Serviço", valor: num(x.valor || x.preco || x.valorVenda), unidade: "HRS" }; })
      .concat(p.map(function (x) { return { tipo: "peca", id: x.id, sku: x.sku || x.codigo || "", nome: x.nome || x.descricao || x.codigo || "Peça", descricao: x.nome || x.descricao || x.codigo || "Peça", valor: num(x.venda || x.valorVenda || x.precoVenda || x.valor || x.preco), estoque: num(x.qtd), unidade: "UN" }; }));
  };
  var clients = function () { return Array.isArray(ERP_STATE.clientes) ? ERP_STATE.clientes : []; };
  var quoteItems = function (q) {
    if (Array.isArray(q.itens) && q.itens.length) return q.itens;
    var c = catalog().find(function (x) { return String(x.id) === String(q.servicoId || q.serviceId); });
    return [{ tipo: "servico", catalogoId: q.servicoId || q.serviceId || "", descricao: c ? c.descricao : (q.desc || "Item do orçamento"), quantidade: num(q.qtd || 1), valorUnitario: num(q.valorUnitario != null ? q.valorUnitario : c && c.valor), total: num(q.subtotal != null ? q.subtotal : q.total) }];
  };
  var UNIT_GROUPS = {
    "UN":["un","unidade","unidades"],"PÇ":["pç","pc","peça","peças"],"HRS":["h","hr","hrs","hora","horas"],"DIA":["dia","dias"],
    "MM":["mm","milímetro","milímetros"],"CM":["cm","centímetro","centímetros"],"M":["m","metro","metros"],"KM":["km","quilômetro","quilômetros"],
    "M²":["m²","m2","metro quadrado","metros quadrados"],"M³":["m³","m3","metro cúbico","metros cúbicos"],
    "MG":["mg","miligrama","miligramas"],"G":["g","gr","grama","gramas"],"KG":["kg","quilo","quilos","quilograma","quilogramas"],"T":["t","ton","tonelada","toneladas"],
    "ML":["ml","mililitro","mililitros"],"L":["l","lt","litro","litros"],"GAL":["gal","galão","galões"]
  };
  var UNIT_FACTOR = {"UN":1,"PÇ":1,"HRS":1,"DIA":1,"MM":0.001,"CM":0.01,"M":1,"KM":1000,"M²":1,"M³":1,"MG":0.000001,"G":0.001,"KG":1,"T":1000,"ML":0.001,"L":1,"GAL":3.785411784};
  var UNIT_DIM = {"UN":"count","PÇ":"count","HRS":"time","DIA":"time","MM":"length","CM":"length","M":"length","KM":"length","M²":"area","M³":"volume","MG":"mass","G":"mass","KG":"mass","T":"mass","ML":"liquid","L":"liquid","GAL":"liquid"};
  function normalizeUnit(v){var raw=String(v||"UN").trim().toLocaleLowerCase("pt-BR");for(var key in UNIT_GROUPS){if(key.toLocaleLowerCase("pt-BR")===raw||UNIT_GROUPS[key].indexOf(raw)>=0)return key;}return String(v||"UN").trim().toUpperCase();}
  function unitSelect(cls,value){var selected=normalizeUnit(value), units=["UN","PÇ","HRS","DIA","MM","CM","M","KM","M²","M³","MG","G","KG","T","ML","L","GAL"];if(units.indexOf(selected)<0)units.push(selected);return '<select class="'+cls+'" aria-label="'+(cls==="oq-unit"?"Unidade da quantidade":"Unidade do preço")+'">'+units.map(function(u){return '<option value="'+esc(u)+'"'+(u===selected?" selected":"")+'>'+esc(u)+'</option>';}).join("")+'</select>';}
  function convertedLine(qty, unit, price, priceUnit){var u=normalizeUnit(unit), p=normalizeUnit(priceUnit||unit);if(u===p)return qty*price;if(UNIT_DIM[u]&&UNIT_DIM[u]===UNIT_DIM[p])return qty*(UNIT_FACTOR[u]||1)/(UNIT_FACTOR[p]||1)*price;return qty*price;}
  function itemRow(item, index) {
    var options = catalog().map(function (c) {
      var selected = String(item.catalogoId || "") === String(c.id) && String(item.tipo || "") === c.tipo;
      return '<option value="' + esc(c.tipo + ":" + c.id) + '"' + (selected ? " selected" : "") + '>' + esc((c.tipo === "peca" ? "Estoque · " + c.nome + (c.sku ? " (" + c.sku + ")" : "") + " · saldo " + c.estoque : "Serviço · " + c.nome)) + '</option>';
    }).join("");
    return '<tr data-item-row="' + index + '"><td><select class="oq-catalog" aria-label="Item do catálogo"><option value="">Item manual / descrição livre</option>' + options + '</select></td>' +
      '<td><input class="oq-desc" aria-label="Descrição do item" value="' + esc(item.descricao || "") + '" placeholder="Descrição do produto/serviço e escopo" required></td>' +
      '<td>' + unitSelect("oq-unit",item.unidade||"UN") + '</td>' +
      '<td><input class="oq-qty" aria-label="Quantidade" type="number" min="0.01" step="0.01" value="' + esc(item.quantidade == null ? 1 : item.quantidade) + '" required></td>' +
      '<td><div class="oq-price-cell"><input class="oq-price" aria-label="Preço por unidade" type="number" min="0" step="0.0001" value="' + esc(item.valorUnitario == null ? 0 : item.valorUnitario) + '" required>' + unitSelect("oq-price-unit",item.unidadePreco||item.unidade||"UN") + '</div></td>' +
      '<td class="oq-line-total" style="text-align:right;white-space:nowrap;font-weight:700">' + money(convertedLine(num(item.quantidade || 1),item.unidade||"UN",num(item.valorUnitario),item.unidadePreco||item.unidade||"UN")) + '</td>' +
      '<td><button type="button" class="btn btn-secondary btn-sm oq-remove" aria-label="Remover item">Remover</button></td></tr>';
  }
  function mount() {
    if (typeof ERP_STATE === "undefined" || !Array.isArray(ERP_STATE.orcamentos)) {
      if (typeof ERP_STATE !== "undefined") ERP_STATE.orcamentos = ERP_STATE.orcamentos || [];
    }
    var tab = $("tab-orcamentos");
    if (!tab || tab.dataset.flexReady === "1") return;
    tab.dataset.flexReady = "1";
    tab.innerHTML = '<div class="data-card oq-shell"><div class="oq-heading"><div class="oq-brand-lockup"><img class="oq-logo" src="/__l5e/assets-v1/4588320a-68f8-4932-9a72-8f318ecd3268/logo-dbs-air.jpg" alt="Logo DBS Air"><div><h2>Proposta comercial</h2><p>DBS AIR REFRIGERACAO LTDA - ME · CNPJ 13.352.707/0001-09</p><p>assistencia@dbsair.com.br · (21) 99825-6991 · Rua Nabor do Rego, 481 (ou nº 2908), Ramos, Rio de Janeiro - RJ · CEP 21031-720</p><p>Use itens do estoque cadastrado, serviços ou cadastre um produto sem sair do orçamento. A proposta não movimenta o estoque.</p></div></div></div>' +
      '<form id="oq-form"><div class="oq-grid"><label>Cliente<select id="oq-client" required></select></label><label>Validade (dias)<input id="oq-validity" type="number" min="1" value="10" required></label><label>Condição de pagamento<input id="oq-payment" value="A combinar" maxlength="180"></label><label>Desconto total (R$)<input id="oq-discount" type="number" min="0" step="0.01" value="0"></label></div><div id="oq-client-details" class="oq-client-details">Selecione um cliente para conferir os dados cadastrais.</div>' +
      '<div class="oq-items-head"><div><h3>Itens da proposta</h3><p class="oq-help">Selecione uma peça do estoque para preencher descrição e preço automaticamente.</p></div><div class="oq-item-buttons"><button type="button" class="btn btn-secondary" id="oq-quick-product">+ Cadastrar produto rápido</button><button type="button" class="btn btn-secondary" id="oq-add">+ Adicionar item</button></div></div>' +
      '<div class="oq-table-wrap"><table class="oq-items"><thead><tr><th>Catálogo</th><th>Descrição / escopo</th><th>Un.</th><th>Qtd.</th><th>Preço (R$) por</th><th>Total</th><th></th></tr></thead><tbody id="oq-items"></tbody></table></div>' +
      '<label class="oq-notes-label">Descrição geral, condições e observações<textarea id="oq-notes" rows="3" placeholder="Prazo de entrega, garantia, escopo, condições especiais..."></textarea></label>' +
      '<div class="oq-totals"><span>Subtotal <strong id="oq-subtotal">R$ 0,00</strong></span><span>Desconto <strong id="oq-discount-show">R$ 0,00</strong></span><span class="oq-grand">Total da proposta <strong id="oq-total">R$ 0,00</strong></span></div>' +
      '<div class="oq-actions"><button type="button" class="btn btn-secondary" id="oq-clear">Limpar formulário</button><button type="submit" class="btn btn-primary">Salvar proposta</button></div></form></div>' +
      '<div class="data-card oq-list-card"><div class="oq-list-head"><h3>Propostas registradas</h3><select id="oq-filter"><option value="TODOS">Todos os status</option><option>Rascunho</option><option>Aprovado</option><option>Rejeitado</option><option>Convertido em OS</option></select></div>' +
      '<div class="oq-table-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Validade</th><th>Status</th><th>Ações</th></tr></thead><tbody id="oq-list"></tbody></table></div></div>';
    var acceptance = document.createElement("div"); acceptance.id = "oq-accept-modal"; acceptance.hidden = true; acceptance.innerHTML = '<div class="oq-accept-panel" role="dialog" aria-modal="true" aria-labelledby="oq-accept-title"><div class="oq-accept-head"><div><h3 id="oq-accept-title">Aceite da proposta</h3><p>Registre a decisão e a assinatura do responsável pelo cliente.</p></div><button type="button" class="btn btn-secondary" id="oq-accept-close">Fechar</button></div><label>Comentário do cliente<textarea id="oq-accept-comment" rows="3" placeholder="Comentário, ressalvas ou motivo da recusa"></textarea></label><label>Nome do responsável<input id="oq-accept-name" maxlength="160" placeholder="Nome completo"></label><label>Assinatura digital do cliente <canvas id="oq-signature" width="900" height="180" aria-label="Área para assinatura digital"></canvas></label><div class="oq-accept-actions"><button type="button" class="btn btn-secondary" id="oq-sign-clear">Limpar assinatura</button><span></span><button type="button" class="btn btn-danger" id="oq-accept-reject">Recusar orçamento</button><button type="button" class="btn btn-primary" id="oq-accept-approve">Aprovar orçamento</button></div><p class="oq-accept-note">A assinatura é registrada neste orçamento no sistema. Confirme a identidade do responsável conforme o procedimento comercial da empresa.</p></div>'; tab.appendChild(acceptance);
    var quickProductModal = document.createElement("div"); quickProductModal.id = "oq-product-modal"; quickProductModal.hidden = true;
    quickProductModal.innerHTML = '<div class="oq-product-panel" role="dialog" aria-modal="true" aria-labelledby="oq-product-title"><div class="oq-accept-head"><div><h3 id="oq-product-title">Cadastro rápido de produto</h3><p>O produto será incluído no cadastro de peças do DBS Control.</p></div><button type="button" class="btn btn-secondary" id="oq-product-close">Fechar</button></div><form id="oq-product-form"><div class="oq-product-grid"><label>SKU / código<input id="oq-product-sku" maxlength="80" placeholder="Código interno"></label><label>Nome do produto *<input id="oq-product-name" maxlength="180" required placeholder="Nome do produto"></label><label>Quantidade inicial<input id="oq-product-qty" type="number" min="0" step="1" value="0" required></label><label>Custo unitário (R$)<input id="oq-product-cost" type="number" min="0" step="0.01" value="0"></label><label>Preço de venda (R$) *<input id="oq-product-sale" type="number" min="0" step="0.01" value="0" required></label></div><p class="oq-product-note">Cadastrar aqui não baixa nem reserva estoque. Quantidade inicial só é usada se você preencher; revise antes de salvar.</p><div class="oq-accept-actions"><span></span><button type="submit" class="btn btn-primary">Cadastrar e adicionar ao orçamento</button></div></form></div>';
    tab.appendChild(quickProductModal);
    var signatureCanvas = $("oq-signature"), signatureCtx = signatureCanvas.getContext("2d"), drawing = false, activeQuoteId = null, signed = false;
    signatureCtx.strokeStyle = "#123e65"; signatureCtx.lineWidth = 3; signatureCtx.lineCap = "round"; signatureCtx.lineJoin = "round";
    function point(ev) { var r = signatureCanvas.getBoundingClientRect(); return { x: (ev.clientX-r.left)*signatureCanvas.width/r.width, y: (ev.clientY-r.top)*signatureCanvas.height/r.height }; }
    signatureCanvas.addEventListener("pointerdown", function(ev){ drawing=true; signed=true; signatureCanvas.setPointerCapture(ev.pointerId); var p=point(ev); signatureCtx.beginPath(); signatureCtx.moveTo(p.x,p.y); });
    signatureCanvas.addEventListener("pointermove", function(ev){ if(!drawing)return; var p=point(ev); signatureCtx.lineTo(p.x,p.y); signatureCtx.stroke(); });
    signatureCanvas.addEventListener("pointerup", function(){ drawing=false; }); signatureCanvas.addEventListener("pointercancel", function(){ drawing=false; });
    function closeAcceptance(){ acceptance.hidden=true; activeQuoteId=null; }
    function commitAcceptance(status){ var q=(ERP_STATE.orcamentos||[]).find(function(x){return String(x.id)===String(activeQuoteId);}); if(!q)return;
      var name=$("oq-accept-name").value.trim(), comment=$("oq-accept-comment").value.trim();
      if(status==="Aprovado" && (!name || !signed)){ alert("Para aprovar, informe o nome do responsável e registre a assinatura."); return; }
      if(status==="Rejeitado" && !comment && !name){ alert("Informe o responsável ou o motivo da recusa."); return; }
      q.status=status; q.aceiteWeb={status:status,responsavel:name,comentario:comment,assinatura:status==="Aprovado"?signatureCanvas.toDataURL("image/png"):null,data:new Date().toISOString()};
      if(typeof window.saveState==="function")window.saveState(); closeAcceptance(); render(); alert(status==="Aprovado"?"Orçamento aprovado e aceite registrado.":"Orçamento recusado e decisão registrada.");
    }
    function openAcceptance(id){ var q=(ERP_STATE.orcamentos||[]).find(function(x){return String(x.id)===String(id);}); if(!q)return; activeQuoteId=id; signed=false; signatureCtx.clearRect(0,0,signatureCanvas.width,signatureCanvas.height); $("oq-accept-name").value=q.aceiteWeb&&q.aceiteWeb.responsavel||""; $("oq-accept-comment").value=q.aceiteWeb&&q.aceiteWeb.comentario||""; acceptance.hidden=false; }
    $("oq-accept-close").addEventListener("click",closeAcceptance); $("oq-sign-clear").addEventListener("click",function(){signatureCtx.clearRect(0,0,signatureCanvas.width,signatureCanvas.height);signed=false;}); $("oq-accept-approve").addEventListener("click",function(){commitAcceptance("Aprovado");}); $("oq-accept-reject").addEventListener("click",function(){commitAcceptance("Rejeitado");});
    function closeProductModal(){quickProductModal.hidden=true;}
    $("oq-quick-product").addEventListener("click",function(){ $("oq-product-form").reset(); $("oq-product-qty").value="0"; $("oq-product-cost").value="0"; $("oq-product-sale").value="0"; quickProductModal.hidden=false; $("oq-product-name").focus(); });
    $("oq-product-close").addEventListener("click",closeProductModal);
    $("oq-product-form").addEventListener("submit",function(ev){
      ev.preventDefault();
      var sku=$("oq-product-sku").value.trim(), name=$("oq-product-name").value.trim(), qty=Math.max(0,num($("oq-product-qty").value)), cost=Math.max(0,num($("oq-product-cost").value)), sale=Math.max(0,num($("oq-product-sale").value));
      if(!name){alert("Informe o nome do produto.");return;}
      var norm=function(v){return String(v||"").trim().toLocaleLowerCase("pt-BR");};
      if(sku && (ERP_STATE.pecas||[]).some(function(p){return norm(p.sku)===norm(sku);})){alert("Já existe um produto com esse SKU. Informe outro código.");return;}
      var product={id:(window.crypto&&crypto.randomUUID)?crypto.randomUUID():"peca-"+Date.now(),sku:sku||("ORC-"+Date.now()),nome:name,qtd:qty,custo:cost,venda:sale};
      ERP_STATE.pecas=Array.isArray(ERP_STATE.pecas)?ERP_STATE.pecas:[];
      ERP_STATE.pecas.push(product);
      if(typeof window.saveState==="function")window.saveState();
      closeProductModal();
      var item={tipo:"peca",catalogoId:product.id,descricao:product.nome,unidade:"UN",quantidade:1,valorUnitario:sale};
      addItem(item);
      var row=$("oq-items").lastElementChild;
      if(row){row.querySelector(".oq-catalog").value="peca:"+product.id;}
      totals();
      alert("Produto cadastrado e adicionado à proposta. O estoque não foi movimentado.");
    });
    var client = $("oq-client");
    client.innerHTML = '<option value="">Selecione o cliente...</option>' + clients().map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.nome || c.razaoSocial || c.nomeFantasia || "Cliente") + '</option>'; }).join("");
    function renderClientDetails(){ var c=clients().find(function(x){return String(x.id)===String(client.value);}); var el=$("oq-client-details"); if(!c){el.textContent="Selecione um cliente para conferir os dados cadastrais.";return;} var fields=[c.razaoSocial||c.nome||c.nomeFantasia,c.filial||c.nomeFantasia,c.cnpj?"CNPJ: "+c.cnpj:(c.cpf?"CPF: "+c.cpf:""),c.email,c.telefone,[c.endereco||c.logradouro,c.numero,c.complemento,c.bairro,c.cidade||c.municipio,c.estado||c.uf,c.cep].filter(Boolean).join(", ")].filter(Boolean); el.textContent=fields.join(" · ")||"Cliente selecionado; complete os dados cadastrais no cadastro de clientes se necessário."; }
    client.addEventListener("change",renderClientDetails); renderClientDetails();
    addItem({ tipo: "", catalogoId: "", descricao: "", quantidade: 1, valorUnitario: 0 });
    $("oq-add").addEventListener("click", function () { addItem({ tipo: "", catalogoId: "", descricao: "", quantidade: 1, valorUnitario: 0 }); });
    $("oq-items").addEventListener("change", function (ev) {
      var row = ev.target.closest("tr"); if (!row) return;
      if (ev.target.classList.contains("oq-catalog") && ev.target.value) {
        var parts = ev.target.value.split(":");
        var found = catalog().find(function (c) { return c.tipo === parts[0] && String(c.id) === parts.slice(1).join(":"); });
        if (found) { row.querySelector(".oq-desc").value = found.descricao; row.querySelector(".oq-price").value = found.valor; var unit=row.querySelector(".oq-unit"), priceUnit=row.querySelector(".oq-price-unit"); if(unit)unit.value=found.unidade|| (found.tipo==="peca"?"UN":"HRS"); if(priceUnit)priceUnit.value=found.unidade|| (found.tipo==="peca"?"UN":"HRS"); }
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
      var qty=Math.max(0,num(row.querySelector(".oq-qty").value)), price=Math.max(0,num(row.querySelector(".oq-price").value)), unit=row.querySelector(".oq-unit").value, priceUnit=row.querySelector(".oq-price-unit").value;
      var line=convertedLine(qty,unit,price,priceUnit);
      var compatible=!UNIT_DIM[normalizeUnit(unit)]||!UNIT_DIM[normalizeUnit(priceUnit)]||UNIT_DIM[normalizeUnit(unit)]===UNIT_DIM[normalizeUnit(priceUnit)];
      row.querySelector(".oq-line-total").title=compatible?"Quantidade convertida para a unidade do preço":"Unidades incompatíveis: cálculo direto sem conversão";
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
        descricao: row.querySelector(".oq-desc").value.trim(), unidade: (row.querySelector(".oq-unit").value || "UN").trim(), unidadePreco:(row.querySelector(".oq-price-unit").value||row.querySelector(".oq-unit").value||"UN").trim(), quantidade: num(row.querySelector(".oq-qty").value),
        valorUnitario: num(row.querySelector(".oq-price").value), total: convertedLine(num(row.querySelector(".oq-qty").value),row.querySelector(".oq-unit").value,num(row.querySelector(".oq-price").value),row.querySelector(".oq-price-unit").value) };
    });
  }
  function save(ev) {
    ev.preventDefault();
    var items = readItems().filter(function (x) { return x.descricao && x.quantidade > 0 && x.valorUnitario >= 0; });
    if (!$("oq-client").value) { alert("Selecione o cliente da proposta."); return; }
    if (!items.length) { alert("Adicione pelo menos um item com descrição e quantidade válida."); return; }
    var sum = totals();
    var subtotalProdutos = items.filter(function (x) { return x.tipo === "peca"; }).reduce(function (n, x) { return n + x.quantidade * x.valorUnitario; }, 0);
    var subtotalServicos = items.filter(function (x) { return x.tipo !== "peca"; }).reduce(function (n, x) { return n + x.quantidade * x.valorUnitario; }, 0);
    var validity = Math.max(1, num($("oq-validity").value) || 10);
    var now = new Date();
    var seq = (ERP_STATE.orcamentos || []).reduce(function (m, q) { return Math.max(m, Number(String(q.id || "").replace(/\D/g, "")) || 0); }, 1000) + 1;
    var first = items[0], clientId = $("oq-client").value;
    var q = { id: "ORC-" + seq, data: now.toLocaleDateString("pt-BR"), validade: new Date(now.getTime() + validity * 86400000).toLocaleDateString("pt-BR"),
      clienteId: clientId, itens: items, subtotal: sum.subtotal, subtotalProdutos: subtotalProdutos, subtotalServicos: subtotalServicos, desconto: sum.discount, total: sum.total,
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
      var actions = '<button type="button" class="btn btn-secondary btn-sm" data-pdf="' + esc(q.id) + '">PDF</button> <button type="button" class="btn btn-secondary btn-sm" data-accept="' + esc(q.id) + '">Aceite Web</button> ';
      if (q.status === "Rascunho") actions += '<button type="button" class="btn btn-secondary btn-sm" data-status="Aprovado" data-id="' + esc(q.id) + '">Aprovar</button>';
      if (q.status === "Aprovado") actions += '<button type="button" class="btn btn-success btn-sm" data-os="' + esc(q.id) + '">Gerar OS</button>';
      return '<tr><td><strong>' + esc(q.id) + '</strong></td><td>' + esc(q.data || "-") + '</td><td>' + esc(c.nome || c.razaoSocial || c.nomeFantasia || "-") + '</td><td title="' + esc(label) + '">' + items.length + ' item(ns)</td><td>' + money(q.total) + '</td><td>' + esc(q.validade || "-") + '</td><td>' + esc(q.status || "Rascunho") + '</td><td class="oq-row-actions">' + actions + '</td></tr>';
    }).join("");
    body.innerHTML = rows || '<tr><td colspan="8" style="padding:20px;text-align:center;color:#64748b">Nenhuma proposta registrada.</td></tr>';
    body.onclick = function (ev) {
      var b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.pdf) pdf(b.dataset.pdf);
      if (b.dataset.accept) openAcceptance(b.dataset.accept);
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
    if (!window.__DBS_QUOTE_LOGO_DATA && !window.__DBS_QUOTE_LOGO_LOADING) {
      window.__DBS_QUOTE_LOGO_LOADING = true;
      var logoImg = new Image();
      logoImg.onload = function(){ try { var cv=document.createElement("canvas"); cv.width=logoImg.naturalWidth; cv.height=logoImg.naturalHeight; cv.getContext("2d").drawImage(logoImg,0,0); window.__DBS_QUOTE_LOGO_DATA=cv.toDataURL("image/jpeg",0.92); } catch(e) {} window.__DBS_QUOTE_LOGO_LOADING=false; pdf(id); };
      logoImg.onerror = function(){ window.__DBS_QUOTE_LOGO_LOADING=false; pdf(id); };
      logoImg.src="/__l5e/assets-v1/4588320a-68f8-4932-9a72-8f318ecd3268/logo-dbs-air.jpg";
      return;
    }
    if (window.__DBS_QUOTE_LOGO_LOADING && !window.__DBS_QUOTE_LOGO_DATA) return;
    function header() {
      doc.setFillColor(16, 65, 112); doc.rect(0, 0, pageW, 31, "F");
      doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
      if(window.__DBS_QUOTE_LOGO_DATA){try{doc.addImage(window.__DBS_QUOTE_LOGO_DATA,"JPEG",x,3,25,22);}catch(e){} doc.text("DBS AIR REFRIGERAÇÃO",x+29,11);}else{doc.text("DBS AIR REFRIGERAÇÃO",x,11);}
      doc.setFontSize(6.5); doc.setFont("helvetica", "normal"); var companyX=window.__DBS_QUOTE_LOGO_DATA?x+29:x; doc.text("DBS AIR REFRIGERACAO LTDA - ME · CNPJ 13.352.707/0001-09", companyX, 16);
      doc.text("assistencia@dbsair.com.br · (21) 99825-6991", companyX, 20);
      doc.text("Rua Nabor do Rego, 481 (ou nº 2908), Ramos, Rio de Janeiro - RJ · CEP 21031-720", companyX, 24);
      doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.text("PROPOSTA COMERCIAL", x, 29);
      doc.text(String(q.id || "ORÇAMENTO"), pageW - x, 13, { align: "right" });
      doc.setFontSize(8); doc.setFont("helvetica", "normal");
      doc.text("Emissão: " + (q.data || new Date().toLocaleDateString("pt-BR")), pageW - x, 19, { align: "right" });
      doc.text("Validade: " + (q.validade || "A combinar"), pageW - x, 24, { align: "right" });
      y = 38; doc.setTextColor(25, 45, 66);
    }
    function check(needed) { if (y + needed > pageH - 18) { doc.addPage(); header(); } }
    header(); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text("CLIENTE", x, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    var clientName = C.nome || C.razaoSocial || C.nomeFantasia || "Cliente";
    doc.text(doc.splitTextToSize(String(clientName), maxW), x, y); y += 6;
    var details = [C.filial || C.nomeFantasia ? "Filial / unidade: " + (C.filial || C.nomeFantasia) : "", (C.cnpj || C.cpf) ? (C.cnpj ? "CNPJ: " + C.cnpj : "CPF: " + C.cpf) : "", C.email ? "E-mail: " + C.email : "", C.telefone ? "Telefone: " + C.telefone : "", [C.endereco || C.logradouro, C.numero ? "nº " + C.numero : "", C.complemento, C.bairro, C.cidade || C.municipio, C.estado || C.uf, C.cep ? "CEP " + C.cep : ""].filter(Boolean).join(", ")].filter(Boolean);
    details.forEach(function (t) { var lines = doc.splitTextToSize(String(t), maxW); check(lines.length * 5 + 1); doc.text(lines, x, y); y += lines.length * 5; });
    y += 5; check(12); doc.setFont("helvetica", "bold"); doc.text("ITENS E VALORES", x, y); y += 7;
    doc.setFillColor(230, 239, 248); doc.rect(x, y - 4, maxW, 8, "F"); doc.setFontSize(8);
    doc.text("DESCRIÇÃO / ESCOPO", x + 2, y + 1); doc.text("UN/QTD", 119, y + 1, { align: "right" }); doc.text("UNITÁRIO", 153, y + 1, { align: "right" }); doc.text("TOTAL", pageW - x - 2, y + 1, { align: "right" }); y += 9;
    items.forEach(function (it) {
      var lines = doc.splitTextToSize(String(it.descricao || "Item"), 86);
      check(Math.max(8, lines.length * 4.5 + 4));
      doc.setFont("helvetica", "normal"); doc.text(lines, x + 2, y);
      doc.text(String(it.unidade || "UN") + " / " + String(it.quantidade || 1), 119, y, { align: "right" });
      doc.text(money(it.valorUnitario).replace(/\s/g, " "), 153, y, { align: "right" });
      doc.text(money(num(it.quantidade || 1) * num(it.valorUnitario)).replace(/\s/g, " "), pageW - x - 2, y, { align: "right" });
      y += Math.max(7, lines.length * 4.5 + 3); doc.setDrawColor(220, 229, 237); doc.line(x, y - 2, pageW - x, y - 2);
    });
    y += 4; check(26); doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text("Subtotal de produtos: " + money(q.subtotalProdutos != null ? q.subtotalProdutos : items.filter(function (it) { return it.tipo === "peca"; }).reduce(function (n, it) { return n + num(it.quantidade) * num(it.valorUnitario); }, 0)), pageW - x, y, { align: "right" }); y += 5;
    doc.text("Subtotal de serviços: " + money(q.subtotalServicos != null ? q.subtotalServicos : items.filter(function (it) { return it.tipo !== "peca"; }).reduce(function (n, it) { return n + num(it.quantidade) * num(it.valorUnitario); }, 0)), pageW - x, y, { align: "right" }); y += 5;
    doc.text("Subtotal geral: " + money(q.subtotal), pageW - x, y, { align: "right" }); y += 5;
    doc.text("Descontos: " + money(q.desconto), pageW - x, y, { align: "right" }); y += 7;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(16, 65, 112); doc.text("TOTAL: " + money(q.total), pageW - x, y, { align: "right" }); y += 10;
    doc.setTextColor(25, 45, 66); doc.setFontSize(9); doc.setFont("helvetica", "bold"); check(15); doc.text("VALIDADE E CONDIÇÕES", x, y); y += 5;
    doc.setFont("helvetica", "normal"); var terms = "Validade: " + (q.validade || "A combinar") + "\nPagamento: " + (q.pagamento || "A combinar");
    var notes = String(q.desc || "").trim(); if (notes) terms += "\nObservações: " + notes;
    var termLines = doc.splitTextToSize(terms, maxW); check(termLines.length * 4.5 + 8); doc.text(termLines, x, y); y += termLines.length * 4.5 + 8;
    check(20); doc.setDrawColor(150, 170, 190); doc.line(x, y + 6, x + 70, y + 6); doc.line(pageW - x - 70, y + 6, pageW - x, y + 6);
    doc.setFontSize(8); doc.text("Nome e assinatura do responsável", x, y + 11); doc.text("Data: ____/____/________", pageW - x - 70, y + 11); doc.text("DBS AIR · Proposta comercial", x, pageH - 8); doc.text("Página " + doc.internal.getCurrentPageInfo().pageNumber, pageW - x, pageH - 8, { align: "right" });
    doc.save(String(q.id || "proposta").replace(/[^a-z0-9_-]/gi, "_") + ".pdf");
  }
  var style = document.createElement("style");
  style.textContent = ".oq-brand-lockup{display:flex;align-items:center;gap:16px;min-width:0}.oq-logo{width:96px;height:76px;object-fit:contain;flex:0 0 auto}.oq-help{font-size:11px;color:#647b92;margin-top:5px}.oq-item-buttons{display:flex;gap:8px;flex-wrap:wrap}.oq-price-cell{display:grid;gap:4px;min-width:100px}.oq-price-cell .oq-price{min-width:90px}.oq-product-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.oq-product-grid label{display:grid;gap:6px;font-size:12px;font-weight:800}.oq-product-grid input{width:100%;padding:10px;border:1px solid #cbd9e7;border-radius:8px;color:#163754}.oq-product-note{font-size:12px;color:#647b92;line-height:1.5}#oq-product-modal{position:fixed;inset:0;z-index:100000;background:rgba(8,25,43,.68);display:flex;align-items:center;justify-content:center;padding:18px}#oq-product-modal[hidden]{display:none}.oq-product-panel{width:min(650px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.28);display:grid;gap:14px;color:#173b5d}.oq-shell,.oq-list-card{padding:20px;margin-bottom:18px;border:1px solid #dbe7f2;border-radius:12px;background:#fff}.oq-heading,.oq-items-head,.oq-list-head,.oq-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.oq-heading{border-bottom:1px solid #e4edf5;padding-bottom:15px;margin-bottom:16px}.oq-heading h2{font-size:18px;color:#123e68}.oq-heading p{font-size:12px;color:#647b92;margin-top:4px}.oq-brand{font-weight:900;color:#1769aa;border:1px solid #b9d7ef;border-radius:8px;padding:8px 12px}.oq-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.oq-client-details{margin-top:10px;padding:12px 14px;border-radius:8px;background:#f5f9fd;border:1px solid #dce8f3;color:#49627b;font-size:11px;line-height:1.7;overflow-wrap:anywhere}.oq-grid label,.oq-notes-label{display:flex;flex-direction:column;gap:6px;font-size:11px;font-weight:800;color:#36536f}.oq-grid input,.oq-grid select,.oq-notes-label textarea,.oq-items input,.oq-items select,.oq-list-head select{width:100%;min-width:0;border:1px solid #cbd9e7;border-radius:7px;background:#fff;color:#163754;padding:9px;font-size:12px}.oq-items-head{margin:22px 0 10px}.oq-items-head h3,.oq-list-head h3{font-size:14px;color:#163e65}.oq-table-wrap{width:100%;overflow:auto}.oq-items{width:100%;min-width:780px;border-collapse:collapse}.oq-items th,.oq-items td{padding:8px 6px;border-bottom:1px solid #e5edf5;text-align:left;font-size:11px}.oq-items th{background:#f1f7fc;color:#3c5a76}.oq-items td:nth-child(3){width:78px}.oq-items td:nth-child(4){width:130px}.oq-items td:nth-child(5){min-width:95px}.oq-notes-label{margin-top:16px}.oq-notes-label textarea{resize:vertical}.oq-totals{display:flex;justify-content:flex-end;gap:22px;align-items:center;flex-wrap:wrap;margin:16px 0;padding:14px;background:#f2f8fd;border:1px solid #d8e8f5;border-radius:9px;font-size:12px;color:#49627b}.oq-totals strong{display:block;color:#163e65;font-size:14px;margin-top:4px}.oq-totals .oq-grand strong{font-size:20px;color:#0b67a5}.oq-actions{justify-content:flex-end}.oq-list-head{margin-bottom:14px}.oq-row-actions{white-space:nowrap}.oq-row-actions button{margin:2px}#oq-accept-modal{position:fixed;inset:0;z-index:99999;background:rgba(8,25,43,.68);display:flex;align-items:center;justify-content:center;padding:18px}#oq-accept-modal[hidden]{display:none}.oq-accept-panel{width:min(760px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.28);display:grid;gap:14px;color:#173b5d}.oq-accept-head,.oq-accept-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.oq-accept-head h3{font-size:18px}.oq-accept-head p,.oq-accept-note{font-size:12px;color:#647b92;margin-top:4px}.oq-accept-panel label{display:grid;gap:6px;font-size:12px;font-weight:800}.oq-accept-panel input,.oq-accept-panel textarea{width:100%;padding:10px;border:1px solid #cbd9e7;border-radius:8px;font:inherit}.oq-accept-panel canvas{display:block;width:100%;height:150px;border:1px dashed #8aa6bd;border-radius:8px;background:#fff;touch-action:none}.oq-accept-actions span{flex:1}@media(max-width:900px){.oq-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:560px){.oq-shell,.oq-list-card{padding:12px}.oq-grid,.oq-product-grid{grid-template-columns:1fr}.oq-totals{justify-content:space-between;gap:12px}.oq-totals .oq-grand{width:100%}.oq-heading h2{font-size:16px}.oq-brand-lockup{align-items:flex-start}.oq-logo{width:68px;height:60px}.oq-item-buttons{width:100%}.oq-item-buttons button{flex:1}}";
  document.head.appendChild(style);
  function start() { if (typeof ERP_STATE !== "undefined" && $("tab-orcamentos")) mount(); else setTimeout(start, 200); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  var oldRender = window.renderizarOrcamentos;
  window.renderizarOrcamentos = function () { if ($("tab-orcamentos") && $("tab-orcamentos").dataset.flexReady !== "1") mount(); if (oldRender && $("tab-orcamentos") && $("tab-orcamentos").dataset.flexReady !== "1") oldRender(); render(); };
})();