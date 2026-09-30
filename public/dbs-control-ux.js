(function () {
  "use strict";

  function state() {
    if (!window.ERP_STATE) return null;
    if (!Array.isArray(ERP_STATE.servicos)) ERP_STATE.servicos = [];
    if (!Array.isArray(ERP_STATE.ordens)) ERP_STATE.ordens = [];
    return ERP_STATE;
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c];
    });
  }

  function money(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function addOsFields() {
    var form = document.getElementById("form-nova-os");
    if (!form || document.getElementById("dbs-os-extra-fields")) return;

    var block = document.createElement("div");
    block.id = "dbs-os-extra-fields";
    block.style.cssText = "margin-top:14px;padding-top:14px;border-top:1px solid var(--border-color);";
    block.innerHTML =
      '<div style="font-size:12px;font-weight:800;color:var(--color-primary);margin-bottom:10px;">Detalhes do atendimento</div>' +
      '<div class="form-grid">' +
      '<div class="form-group"><label>Prioridade</label><select id="os-prioridade"><option>Normal</option><option>Alta</option><option>Urgente</option><option>Programada</option></select></div>' +
      '<div class="form-group"><label>SLA / Prazo</label><input id="os-sla" placeholder="Ex.: 24 horas"></div>' +
      '<div class="form-group"><label>Contato no local</label><input id="os-contato-local" placeholder="Nome e telefone"></div>' +
      '<div class="form-group"><label>Local / Setor</label><input id="os-local-atendimento" placeholder="Ex.: Loja, CPD, sala técnica"></div>' +
      '</div>' +
      '<div class="form-group" style="margin-top:10px;"><label>Sintoma relatado / Solicitação do cliente</label><textarea id="os-sintoma" rows="2" placeholder="O que o cliente informou antes do atendimento?"></textarea></div>' +
      '<div class="form-group" style="margin-top:10px;"><label>Orientações especiais ao técnico</label><textarea id="os-orientacoes" rows="2" placeholder="Acesso, horário, EPI, contato, restrições ou informações importantes."></textarea></div>';
    var submitWrap = form.querySelector("button[type=submit]");
    form.insertBefore(block, submitWrap ? submitWrap.parentElement : null);

    var serviceSelect = document.getElementById("os-select-servico");
    if (serviceSelect && !document.getElementById("dbs-quick-service")) {
      var wrap = serviceSelect.parentElement;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.id = "dbs-quick-service";
      btn.className = "btn btn-secondary btn-sm";
      btn.style.cssText = "margin-top:7px;";
      btn.textContent = "+ Criar serviço agora";
      btn.onclick = openQuickService;
      wrap.appendChild(btn);
    }
  }

  function openQuickService() {
    if (document.getElementById("dbs-quick-service-modal")) return;
    var modal = document.createElement("div");
    modal.id = "dbs-quick-service-modal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;";
    modal.innerHTML =
      '<div style="width:min(560px,100%);background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(15,23,42,.25);padding:20px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;"><div><strong style="font-size:17px;">Criar serviço</strong><div style="font-size:11px;color:#64748b;margin-top:3px;">Sem sair da abertura da OS</div></div><button type="button" class="btn btn-secondary btn-sm" id="dbs-close-service">Fechar</button></div>' +
      '<div class="form-grid"><div class="form-group"><label>Descrição do serviço</label><input id="quick-serv-nome" placeholder="Ex.: Troca de capacitor 40µF"></div>' +
      '<div class="form-group"><label>Tempo estimado</label><input id="quick-serv-horas" type="number" min="0.5" step="0.5" value="1"></div>' +
      '<div class="form-group"><label>Valor</label><input id="quick-serv-valor" type="number" min="0" step="0.01" value="0"></div></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;"><button type="button" class="btn btn-secondary" id="dbs-cancel-service">Cancelar</button><button type="button" class="btn btn-primary" id="dbs-save-service">Criar e usar na OS</button></div></div>';
    document.body.appendChild(modal);
    document.getElementById("dbs-close-service").onclick = closeQuickService;
    document.getElementById("dbs-cancel-service").onclick = closeQuickService;
    document.getElementById("dbs-save-service").onclick = saveQuickService;
    document.getElementById("quick-serv-nome").focus();
  }

  function closeQuickService() {
    var modal = document.getElementById("dbs-quick-service-modal");
    if (modal) modal.remove();
  }

  function saveQuickService() {
    var st = state();
    var name = document.getElementById("quick-serv-nome").value.trim();
    var hours = Number(document.getElementById("quick-serv-horas").value || 0);
    var value = Number(document.getElementById("quick-serv-valor").value || 0);
    if (!name) { alert("Informe a descrição do serviço."); return; }
    var id = st.servicos.reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0) + 1;
    st.servicos.push({ id: id, nome: name, horas: hours, valor: value });
    if (typeof window.saveState === "function") window.saveState();
    if (typeof window.atualizarSelects === "function") window.atualizarSelects();
    var select = document.getElementById("os-select-servico");
    if (select) {
      select.value = String(id);
      select.dispatchEvent(new Event("change"));
    }
    closeQuickService();
    if (typeof window.renderizarTudo === "function") window.renderizarTudo();
    setTimeout(function () {
      var s = document.getElementById("os-select-servico");
      if (s) s.value = String(id);
    }, 0);
  }

  function enrichOsAfterSave(beforeIds, meta) {
    var st = state();
    var created = st.ordens.find(function (o) { return beforeIds.indexOf(o.id) === -1; });
    if (!created) return;
    created.prioridade = meta.prioridade;
    created.sla = meta.sla;
    created.contatoLocal = meta.contatoLocal;
    created.localAtendimento = meta.localAtendimento;
    created.sintoma = meta.sintoma;
    created.orientacoes = meta.orientacoes;
    created.criadoEm = new Date().toISOString();
    if (typeof window.saveState === "function") window.saveState();
    if (typeof window.renderizarTudo === "function") window.renderizarTudo();
  }

  function wrapOsSave() {
    if (typeof window.salvarNovaOS !== "function" || window.__dbsOsSaveWrapped) return;
    var original = window.salvarNovaOS;
    window.salvarNovaOS = function (ev) {
      var st = state();
      var before = st.ordens.map(function (o) { return o.id; });
      var meta = {
        prioridade: (document.getElementById("os-prioridade") || {}).value || "Normal",
        sla: (document.getElementById("os-sla") || {}).value || "",
        contatoLocal: (document.getElementById("os-contato-local") || {}).value || "",
        localAtendimento: (document.getElementById("os-local-atendimento") || {}).value || "",
        sintoma: (document.getElementById("os-sintoma") || {}).value || "",
        orientacoes: (document.getElementById("os-orientacoes") || {}).value || ""
      };
      original(ev);
      enrichOsAfterSave(before, meta);
    };
    window.__dbsOsSaveWrapped = true;
  }

  function openOsDetail(id) {
    var st = state();
    var o = st.ordens.find(function (x) { return String(x.id) === String(id); });
    if (!o) return;
    var c = st.clientes.find(function (x) { return x.id === o.clienteId; }) || {};
    var e = st.equipamentos.find(function (x) { return x.id === o.equipamentoId; }) || {};
    var t = st.tecnicos.find(function (x) { return x.id === o.tecnicoId; }) || {};
    var s = st.servicos.find(function (x) { return x.id === o.servicoId; }) || {};
    var modal = document.getElementById("dbs-os-detail-modal");
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.id = "dbs-os-detail-modal";
    modal.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:99998;display:flex;align-items:center;justify-content:center;padding:18px;";
    modal.innerHTML =
      '<div style="width:min(980px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(15,23,42,.3);">' +
      '<div style="padding:18px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;gap:15px;align-items:center;"><div><div style="font-size:11px;color:#64748b;font-weight:800;">ORDEM DE SERVIÇO</div><strong style="font-size:21px;">' + esc(o.id) + '</strong><span style="margin-left:10px;" class="badge ' + (o.status === "Concluída" ? "badge-concluido" : "badge-andamento") + '">' + esc(o.status) + '</span></div><button class="btn btn-secondary" onclick="window.dbsCloseOsDetail()">Fechar</button></div>' +
      '<div style="padding:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;">' +
      '<section style="padding:14px;background:#f8fafc;border-radius:9px;"><b>Cliente</b><div style="margin-top:7px;">' + esc(c.nome || "-") + '</div><small>' + esc(c.cnpj || "") + '</small><div style="margin-top:5px;">' + esc(c.endereco || "") + '</div></section>' +
      '<section style="padding:14px;background:#f8fafc;border-radius:9px;"><b>Ativo</b><div style="margin-top:7px;">' + esc(e.tag || "-") + ' · ' + esc(e.tipo || "") + '</div><small>' + esc(e.marca || "") + ' ' + esc(e.modelo || "") + ' · Série ' + esc(e.serie || "") + '</small><div style="margin-top:5px;">' + esc(e.ambiente || "") + '</div></section>' +
      '<section style="padding:14px;background:#f8fafc;border-radius:9px;"><b>Atendimento</b><div style="margin-top:7px;">' + esc(t.nome || "-") + '</div><small>' + esc(o.tipo || "") + ' · ' + esc(s.nome || "") + '</small><div style="margin-top:5px;">Prioridade: <b>' + esc(o.prioridade || "Normal") + '</b> · SLA: ' + esc(o.sla || "Não informado") + '</div></section>' +
      '<section style="padding:14px;background:#f8fafc;border-radius:9px;"><b>Financeiro</b><div style="font-size:20px;font-weight:900;margin-top:7px;">' + money(o.valor) + '</div><small>Orçamento: ' + esc(o.orcamentoId || "Não vinculado") + '</small></section>' +
      '</div>' +
      '<div style="padding:0 20px 20px;display:grid;gap:12px;">' +
      '<section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px;"><b>Descrição / instruções</b><p style="white-space:pre-wrap;margin:8px 0 0;">' + esc(o.desc || "-") + '</p></section>' +
      '<section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px;"><b>Sintoma relatado</b><p style="white-space:pre-wrap;margin:8px 0 0;">' + esc(o.sintoma || "Não informado") + '</p></section>' +
      '<section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px;"><b>Orientações especiais</b><p style="white-space:pre-wrap;margin:8px 0 0;">' + esc(o.orientacoes || "Nenhuma") + '</p></section>' +
      '<section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px;"><b>Contato / local</b><p style="margin:8px 0 0;">' + esc(o.contatoLocal || "-") + ' · ' + esc(o.localAtendimento || "-") + '</p></section>' +
      '<section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px;"><b>Execução de campo</b><p style="white-space:pre-wrap;margin:8px 0 0;">' + esc(o.diagnostico || "Diagnóstico será registrado pelo técnico.") + '</p><p style="white-space:pre-wrap;margin:8px 0 0;">' + esc(o.trabalhoExecutado || "Serviço ainda não finalizado.") + '</p></section>' +
      '<section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px;"><b>Peças / insumos utilizados</b><div style="margin-top:8px;">' + ((o.pecasUsadas || []).length ? o.pecasUsadas.map(function (p) { return '<div style="display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding:6px 0;"><span>' + esc(p.nome) + ' × ' + esc(p.qtd) + '</span><b>' + money(Number(p.venda || 0) * Number(p.qtd || 0)) + '</b></div>'; }).join("") : '<span style="color:#64748b;">Nenhuma peça registrada.</span>') + '</div></section>' +
      '<section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px;"><b>Evidências</b><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;">' + (o.fotoAntes ? '<img src="' + o.fotoAntes + '" style="width:160px;height:120px;object-fit:cover;border-radius:7px;"><small>Antes</small>' : '') + (o.fotoDepois ? '<img src="' + o.fotoDepois + '" style="width:160px;height:120px;object-fit:cover;border-radius:7px;"><small>Depois</small>' : '') + (!o.fotoAntes && !o.fotoDepois ? '<span style="color:#64748b;">Sem fotos registradas.</span>' : '') + '</div></section>' +
      '</div></div>';
    document.body.appendChild(modal);
  }

  window.dbsCloseOsDetail = function () {
    var m = document.getElementById("dbs-os-detail-modal"); if (m) m.remove();
  };
  window.dbsOpenOsDetail = openOsDetail;

  function addDetailButtons() {
    var rows = document.querySelectorAll("#os-table-body tr");
    rows.forEach(function (row) {
      if (row.querySelector(".dbs-os-detail-btn")) return;
      var strong = row.querySelector("td:nth-child(2) strong");
      var action = row.querySelector("td:last-child");
      if (!strong || !action) return;
      var id = strong.textContent.trim();
      var btn = document.createElement("button");
      btn.className = "btn btn-secondary btn-sm dbs-os-detail-btn";
      btn.style.marginLeft = "5px";
      btn.textContent = "Detalhes";
      btn.onclick = function () { openOsDetail(id); };
      action.appendChild(btn);
    });
  }

  function wrapOrderRender() {
    if (typeof window.renderizarOrdens !== "function" || window.__dbsOrderRenderWrapped) return;
    var original = window.renderizarOrdens;
    window.renderizarOrdens = function () {
      original();
      addDetailButtons();
    };
    window.__dbsOrderRenderWrapped = true;
  }

  function boot() {
    addOsFields();
    wrapOsSave();
    wrapOrderRender();
    addDetailButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  setTimeout(boot, 500);
  setTimeout(boot, 1500);
})();
