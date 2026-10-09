(function () {
  "use strict";
  function state(){if(typeof ERP_STATE==="undefined")return null; ERP_STATE.clientes=Array.isArray(ERP_STATE.clientes)?ERP_STATE.clientes:[];ERP_STATE.equipamentos=Array.isArray(ERP_STATE.equipamentos)?ERP_STATE.equipamentos:[];ERP_STATE.servicos=Array.isArray(ERP_STATE.servicos)?ERP_STATE.servicos:[];ERP_STATE.pecas=Array.isArray(ERP_STATE.pecas)?ERP_STATE.pecas:[];ERP_STATE.ordens=Array.isArray(ERP_STATE.ordens)?ERP_STATE.ordens:[];return ERP_STATE;}
  const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
  const persist=()=>{if(typeof window.saveState==="function")window.saveState();};
  const refresh=()=>{if(typeof window.renderizarTudo==="function")window.renderizarTudo();};
  function modal(title,body,actions,id){const old=document.getElementById(id);if(old)old.remove();const m=document.createElement("div");m.id=id;m.style.cssText="position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:100000;display:flex;align-items:center;justify-content:center;padding:18px;";m.innerHTML='<div style="width:min(720px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(15,23,42,.3);"><div style="padding:18px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;"><strong style="font-size:17px;">'+esc(title)+'</strong><button type="button" class="btn btn-secondary btn-sm" id="'+id+'-close">Fechar</button></div><div style="padding:20px;">'+body+'</div>'+actions+'</div>';document.body.appendChild(m);document.getElementById(id+"-close").onclick=()=>m.remove();return m;}
  function openQuickService(){
    if(document.getElementById("dbs-quick-service-modal"))return;
    const body='<div class="form-grid"><div class="form-group"><label>Descrição do serviço</label><input id="quick-serv-nome" placeholder="Ex.: Troca de capacitor 40µF"></div><div class="form-group"><label>Tempo estimado (h)</label><input id="quick-serv-horas" type="number" min="0.5" step="0.5" value="1"></div><div class="form-group"><label>Valor</label><input id="quick-serv-valor" type="number" min="0" step="0.01" value="0"></div></div>';
    const actions='<div style="padding:0 20px 20px;display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" id="qsv-cancel">Cancelar</button><button class="btn btn-primary" id="qsv-save">Criar e usar na OS</button></div>';
    const m=modal("Criar serviço — sem sair da OS",body,actions,"dbs-quick-service-modal");
    document.getElementById("qsv-cancel").onclick=()=>m.remove();
    document.getElementById("qsv-save").onclick=()=>{
      const st=state(),nome=document.getElementById("quick-serv-nome").value.trim();
      if(!nome){alert("Informe a descrição do serviço.");return;}
      const id=st.servicos.reduce((n,x)=>Math.max(n,Number(x.id)||0),0)+1;
      st.servicos.push({id,nome,horas:Number(document.getElementById("quick-serv-horas").value||1),valor:Number(document.getElementById("quick-serv-valor").value||0)});
      persist();refresh();setTimeout(()=>{const s=document.getElementById("os-select-servico");if(s){s.value=String(id);s.dispatchEvent(new Event("change"));}},0);m.remove();
    };
    document.getElementById("quick-serv-nome").focus();
  }
  window.openQuickService=openQuickService;
  function quickClient(){const body='<div class="form-grid"><div class="form-group"><label>Razão social / Cliente</label><input id="qc-nome"></div><div class="form-group"><label>CNPJ</label><input id="qc-cnpj"></div><div class="form-group"><label>Endereço</label><input id="qc-end"></div><div class="form-group"><label>Contato</label><input id="qc-contato" placeholder="Nome / telefone"></div></div>';const actions='<div style="padding:0 20px 20px;display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" id="qc-cancel">Cancelar</button><button class="btn btn-primary" id="qc-save">Criar e selecionar</button></div>';const m=modal("Novo cliente — sem sair da OS",body,actions,"dbs-quick-client");document.getElementById("qc-cancel").onclick=()=>m.remove();document.getElementById("qc-save").onclick=()=>{const st=state(),nome=document.getElementById("qc-nome").value.trim();if(!nome){alert("Informe o nome do cliente.");return;}const id=crypto.randomUUID();st.clientes.push({id,nome,cnpj:document.getElementById("qc-cnpj").value.trim(),endereco:document.getElementById("qc-end").value.trim(),contato:document.getElementById("qc-contato").value.trim()});persist();refresh();setTimeout(()=>{const s=document.getElementById("os-select-cliente");if(s){s.value=String(id);s.dispatchEvent(new Event("change"));}},0);m.remove();};document.getElementById("qc-nome").focus();}
  function quickEquipment(){const st=state(),sel=document.getElementById("os-select-cliente"),cliId=String(sel&&sel.value||"");if(!cliId){alert("Selecione o cliente primeiro.");return;}const body='<div style="font-size:11px;color:#64748b;margin-bottom:12px;">Cliente: <b>'+esc((st.clientes.find(c=>String(c.id)===cliId)||{}).nome||"")+'</b></div><div class="form-grid"><div class="form-group"><label>TAG</label><input id="qe-tag" placeholder="Ex.: AC-001"></div><div class="form-group"><label>Tipo</label><input id="qe-tipo" placeholder="Ex.: Split, VRF, Câmara"></div><div class="form-group"><label>Marca</label><input id="qe-marca"></div><div class="form-group"><label>Modelo</label><input id="qe-modelo"></div><div class="form-group"><label>Nº de série</label><input id="qe-serie"></div><div class="form-group"><label>Capacidade</label><input id="qe-cap"></div><div class="form-group"><label>Ambiente / localização</label><input id="qe-amb"></div></div>';const actions='<div style="padding:0 20px 20px;display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" id="qe-cancel">Cancelar</button><button class="btn btn-primary" id="qe-save">Criar e selecionar</button></div>';const m=modal("Novo equipamento — sem sair da OS",body,actions,"dbs-quick-equipment");document.getElementById("qe-cancel").onclick=()=>m.remove();document.getElementById("qe-save").onclick=()=>{const tag=document.getElementById("qe-tag").value.trim();if(!tag){alert("Informe a TAG do equipamento.");return;}const id=crypto.randomUUID();st.equipamentos.push({id,clienteId:cliId,tag,tipo:document.getElementById("qe-tipo").value.trim(),marca:document.getElementById("qe-marca").value.trim(),modelo:document.getElementById("qe-modelo").value.trim(),serie:document.getElementById("qe-serie").value.trim(),capacidade:document.getElementById("qe-cap").value.trim(),ambiente:document.getElementById("qe-amb").value.trim()});persist();refresh();setTimeout(()=>{const s=document.getElementById("os-select-equipamento");if(s)s.value=String(id);},0);m.remove();};document.getElementById("qe-tag").focus();}
  function quickPart(){const body='<div class="form-grid"><div class="form-group"><label>SKU</label><input id="qp-sku" placeholder="Ex.: CAP-40UF"></div><div class="form-group"><label>Nome da peça</label><input id="qp-nome"></div><div class="form-group"><label>Estoque inicial</label><input id="qp-qtd" type="number" min="0" value="1"></div><div class="form-group"><label>Custo</label><input id="qp-custo" type="number" min="0" step="0.01" value="0"></div><div class="form-group"><label>Venda</label><input id="qp-venda" type="number" min="0" step="0.01" value="0"></div></div>';const actions='<div style="padding:0 20px 20px;display:flex;justify-content:flex-end;gap:8px;"><button class="btn btn-secondary" id="qp-cancel">Cancelar</button><button class="btn btn-primary" id="qp-save">Cadastrar peça</button></div>';const m=modal("Nova peça / insumo",body,actions,"dbs-quick-part");document.getElementById("qp-cancel").onclick=()=>m.remove();document.getElementById("qp-save").onclick=()=>{const st=state(),nome=document.getElementById("qp-nome").value.trim();if(!nome){alert("Informe o nome da peça.");return;}const id=st.pecas.reduce((n,x)=>Math.max(n,Number(x.id)||0),0)+1;st.pecas.push({id,sku:document.getElementById("qp-sku").value.trim()||("PECA-"+id),nome,qtd:Number(document.getElementById("qp-qtd").value||0),custo:Number(document.getElementById("qp-custo").value||0),venda:Number(document.getElementById("qp-venda").value||0)});persist();refresh();m.remove();};document.getElementById("qp-nome").focus();}
  function addInlineButtons(){const cli=document.getElementById("os-select-cliente"),eq=document.getElementById("os-select-equipamento"),srv=document.getElementById("os-select-servico");[[cli,quickClient,"+ Novo cliente"],[eq,quickEquipment,"+ Novo equipamento"]].forEach(x=>{if(!x[0]||document.getElementById("dbs-inline-"+x[0].id))return;const b=document.createElement("button");b.type="button";b.id="dbs-inline-"+x[0].id;b.className="btn btn-secondary btn-sm";b.style.marginTop="7px";b.textContent=x[2];b.onclick=x[1];x[0].parentElement.appendChild(b);});if(srv&&!document.getElementById("dbs-inline-service")){const b=document.createElement("button");b.type="button";b.id="dbs-inline-service";b.className="btn btn-secondary btn-sm";b.style.marginTop="7px";b.textContent="+ Criar serviço agora";b.onclick=()=>{if(typeof window.openQuickService==="function")window.openQuickService();};srv.parentElement.appendChild(b);}}
  function addPartButtonToMobile(){document.querySelectorAll(".pwa-box").forEach(box=>{if(box.querySelector(".dbs-quick-part-btn"))return;const b=document.createElement("button");b.type="button";b.className="btn btn-secondary btn-sm dbs-quick-part-btn";b.style.cssText="margin-top:5px;width:100%;justify-content:center";b.textContent="+ Cadastrar peça agora";b.onclick=quickPart;const select=box.querySelector("select[id^='pwa-peca-select-']");if(select)select.parentElement.parentElement.appendChild(b);});}
  function wrapOsSave(){if(typeof window.salvarNovaOS!=="function"||window.__dbsOsSaveWrapped)return;const original=window.salvarNovaOS;window.salvarNovaOS=function(ev){const st=state(),before=st.ordens.map(o=>o.id),meta={prioridade:(document.getElementById("os-prioridade")||{}).value||"Normal",sla:(document.getElementById("os-sla")||{}).value||"",contatoLocal:(document.getElementById("os-contato-local")||{}).value||"",localAtendimento:(document.getElementById("os-local-atendimento")||{}).value||"",sintoma:(document.getElementById("os-sintoma")||{}).value||"",orientacoes:(document.getElementById("os-orientacoes")||{}).value||""};original(ev);const created=st.ordens.find(o=>before.indexOf(o.id)===-1);if(created){Object.assign(created,meta,{criadoEm:new Date().toISOString(),timeline:[{status:created.status||"Em Atendimento",at:new Date().toISOString(),by:"Sistema"}]});persist();refresh();}};window.__dbsOsSaveWrapped=true;}
  function addOsFields(){const form=document.getElementById("form-nova-os");if(!form||document.getElementById("dbs-os-extra-fields"))return;const block=document.createElement("div");block.id="dbs-os-extra-fields";block.style.cssText="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-color)";block.innerHTML='<div style="font-size:12px;font-weight:800;color:var(--color-primary);margin-bottom:10px">Detalhes do atendimento</div><div class="form-grid"><div class="form-group"><label>Prioridade</label><select id="os-prioridade"><option>Normal</option><option>Alta</option><option>Urgente</option><option>Programada</option></select></div><div class="form-group"><label>SLA / Prazo</label><input id="os-sla" placeholder="Ex.: 24 horas"></div><div class="form-group"><label>Contato no local</label><input id="os-contato-local" placeholder="Nome e telefone"></div><div class="form-group"><label>Local / Setor</label><input id="os-local-atendimento" placeholder="Ex.: loja, CPD, sala técnica"></div></div><div class="form-group" style="margin-top:10px"><label>Sintoma relatado / Solicitação do cliente</label><textarea id="os-sintoma" rows="2" placeholder="O que o cliente informou?"></textarea></div><div class="form-group" style="margin-top:10px"><label>Orientações especiais ao técnico</label><textarea id="os-orientacoes" rows="2" placeholder="Acesso, horário, EPI, contato ou restrições"></textarea></div>';const submit=form.querySelector("button[type=submit]");form.insertBefore(block,submit?submit.parentElement:null);addInlineButtons();}
  function installFieldControlOrderDetailsBridge(){
    if(window.__dbsFieldOrderDetailsBridge)return;
    window.__dbsFieldOrderDetailsBridge=true;
    window.addEventListener("message",(event)=>{
      if(event.source!==window.parent)return;
      const msg=event.data||{};
      if(msg.type!=="DBS_CONTROL_FIELD_ORDER_DETAILS_RESULT")return;
      if(!msg.ok){alert(msg.error||"Não foi possível carregar o histórico do FieldControl.");return;}
      const st=state();
      const os=st.ordens.find(o=>String(o.id)===String(msg.workOrderId));
      if(os){os.fieldControlDetails=msg.result?.details||null;persist();openOsDetail(os.id);}
    });
  }

  function timelineText(o){return(o.timeline||[]).map(x=>new Date(x.at||Date.now()).toLocaleString("pt-BR")+" — "+(x.status||"Atualização")+(x.by?" · "+x.by:"")).join("\n");}
  function saveOsEdit(id){const st=state(),o=st.ordens.find(x=>String(x.id)===String(id));if(!o)return;["prioridade","sla","contatoLocal","localAtendimento","sintoma","orientacoes","diagnostico","trabalhoExecutado","status"].forEach(k=>{const el=document.getElementById("dbs-edit-"+k);if(el)o[k]=el.value;});o.timeline=Array.isArray(o.timeline)?o.timeline:[];o.timeline.push({status:o.status,at:new Date().toISOString(),by:"Gestão"});persist();refresh();openOsDetail(id);}
  function openOsDetail(id){const st=state(),o=st.ordens.find(x=>String(x.id)===String(id));if(!o)return;const c=st.clientes.find(x=>String(x.id)===String(o.clienteId))||{},e=st.equipamentos.find(x=>String(x.id)===String(o.equipamentoId))||{},t=st.tecnicos.find(x=>String(x.id)===String(o.tecnicoId))||{},s=st.servicos.find(x=>String(x.id)===String(o.servicoId))||{};const parts=(o.pecasUsadas||[]).map(p=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9"><span>'+esc(p.nome)+' × '+esc(p.qtd)+'</span><b>'+money(Number(p.venda||0)*Number(p.qtd||0))+'</b></div>').join("")||'<span style="color:#64748b">Nenhuma peça registrada.</span>';const body='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px"><section style="padding:14px;background:#f8fafc;border-radius:9px"><b>Cliente</b><div style="margin-top:7px">'+esc(c.nome||"-")+'</div><small>'+esc(c.cnpj||"")+'</small><div style="margin-top:5px">'+esc(c.endereco||"")+'</div></section><section style="padding:14px;background:#f8fafc;border-radius:9px"><b>Ativo</b><div style="margin-top:7px">'+esc(e.tag||"-")+' · '+esc(e.tipo||"")+'</div><small>'+esc(e.marca||"")+' '+esc(e.modelo||"")+' · Série '+esc(e.serie||"")+'</small><div style="margin-top:5px">'+esc(e.ambiente||"")+'</div></section><section style="padding:14px;background:#f8fafc;border-radius:9px"><b>Atendimento</b><div style="margin-top:7px">'+esc(t.nome||"-")+'</div><small>'+esc(o.tipo||"")+' · '+esc(s.nome||"")+'</small><div style="margin-top:5px">Prioridade: <b>'+esc(o.prioridade||"Normal")+'</b> · SLA: '+esc(o.sla||"Não informado")+'</div></section><section style="padding:14px;background:#f8fafc;border-radius:9px"><b>Financeiro</b><div style="font-size:20px;font-weight:900;margin-top:7px">'+money(o.valor)+'</div><small>Orçamento: '+esc(o.orcamentoId||"Não vinculado")+'</small></section></div><div style="display:grid;gap:12px;margin-top:14px"><section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px"><b>Gestão da OS</b><div class="form-grid" style="margin-top:10px"><div class="form-group"><label>Status</label><select id="dbs-edit-status"><option>Em Atendimento</option><option>Despachada</option><option>Aguardando peça</option><option>Aguardando cliente</option><option>Concluída</option><option>Cancelada</option></select></div><div class="form-group"><label>Prioridade</label><select id="dbs-edit-prioridade"><option>Normal</option><option>Alta</option><option>Urgente</option><option>Programada</option></select></div><div class="form-group"><label>SLA / Prazo</label><input id="dbs-edit-sla" value="'+esc(o.sla||"")+'"></div><div class="form-group"><label>Contato no local</label><input id="dbs-edit-contatoLocal" value="'+esc(o.contatoLocal||"")+'"></div><div class="form-group"><label>Local / Setor</label><input id="dbs-edit-localAtendimento" value="'+esc(o.localAtendimento||"")+'"></div></div><div class="form-group" style="margin-top:10px"><label>Sintoma relatado</label><textarea id="dbs-edit-sintoma" rows="2">'+esc(o.sintoma||"")+'</textarea></div><div class="form-group" style="margin-top:10px"><label>Orientações</label><textarea id="dbs-edit-orientacoes" rows="2">'+esc(o.orientacoes||"")+'</textarea></div><div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" id="dbs-save-os-edit">Salvar alterações</button></div></section><section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px"><b>Execução de campo</b><div class="form-group" style="margin-top:10px"><label>Diagnóstico</label><textarea id="dbs-edit-diagnostico" rows="3">'+esc(o.diagnostico||"")+'</textarea></div><div class="form-group" style="margin-top:10px"><label>Trabalho executado</label><textarea id="dbs-edit-trabalhoExecutado" rows="3">'+esc(o.trabalhoExecutado||"")+'</textarea></div></section><section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px"><b>Descrição / solicitação original</b><p style="white-space:pre-wrap;margin:8px 0">'+esc(o.desc||"-")+'</p></section><section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px"><b>Peças / insumos</b><div style="margin-top:8px">'+parts+'</div></section><section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px"><b>Evidências</b><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px">'+(o.fotoAntes?'<div><img src="'+o.fotoAntes+'" style="width:160px;height:120px;object-fit:cover;border-radius:7px"><small>Antes</small></div>':"")+(o.fotoDepois?'<div><img src="'+o.fotoDepois+'" style="width:160px;height:120px;object-fit:cover;border-radius:7px"><small>Depois</small></div>':"")+(!o.fotoAntes&&!o.fotoDepois?'<span style="color:#64748b">Sem fotos registradas.</span>':"")+'</div></section><section style="border:1px solid #e2e8f0;border-radius:9px;padding:14px"><b>Histórico da OS</b><pre style="white-space:pre-wrap;font:11px inherit;color:#475569;margin-top:8px">'+esc(timelineText(o)||"Sem histórico registrado.")+'</pre></section><section style="border:1px solid #dbe7f3;border-radius:9px;padding:14px;background:#f8fcff"><b>Histórico FieldControl</b>'+(()=>{const d=o.fieldControlDetails||{};const count=(d.tasks||[]).length+(d.comments||[]).length+(d.materials||[]).length+(d.forms||[]).length+(d.attachments||[]).length;return count?'<div style="display:grid;grid-template-columns:repeat(5,minmax(70px,1fr));gap:7px;margin-top:10px">'+[['Visitas',d.tasks],['Comentários',d.comments],['Materiais',d.materials],['Formulários',d.forms],['Anexos',d.attachments]].map(x=>'<div style="padding:8px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;text-align:center"><small style="display:block;color:#64748b;font-size:9px;font-weight:800">'+x[0]+'</small><strong style="display:block;margin-top:3px">'+String((x[1]||[]).length)+'</strong></div>').join('')+'</div><div style="margin-top:10px;font-size:10px;color:#64748b">Última leitura: '+esc(d.loadedAt?new Date(d.loadedAt).toLocaleString("pt-BR"):"agora")+'</div>':'<div style="margin-top:8px;font-size:11px;color:#64748b">Ainda não carregado. Use "Histórico FieldControl" abaixo para consultar as visitas, comentários, materiais, formulários e anexos desta OS.</div>';})()+'</section></div>';const actions='<div style="padding:0 20px 20px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-secondary" id="dbs-os-pdf">Gerar PDF</button><button class="btn btn-secondary" id="dbs-os-fc-history">Histórico FieldControl</button></div><button class="btn btn-secondary" id="dbs-os-close2">Fechar</button></div>';const m=modal("OS "+o.id+" · visão completa",body,actions,"dbs-os-detail-modal");document.getElementById("dbs-edit-status").value=o.status||"Em Atendimento";document.getElementById("dbs-edit-prioridade").value=o.prioridade||"Normal";document.getElementById("dbs-save-os-edit").onclick=()=>saveOsEdit(id);document.getElementById("dbs-os-close2").onclick=()=>m.remove();document.getElementById("dbs-os-pdf").onclick=()=>{if(typeof window.baixarPDFIndividual==="function")window.baixarPDFIndividual(id);};document.getElementById("dbs-os-fc-history").onclick=()=>{const b=document.getElementById("dbs-os-fc-history");if(b){b.disabled=true;b.textContent="Carregando...";}window.parent.postMessage({type:"DBS_CONTROL_FIELD_ORDER_DETAILS",workOrderId:String(id)},"*");};}
  window.dbsOpenOsDetail=openOsDetail;window.dbsCloseOsDetail=()=>{const m=document.getElementById("dbs-os-detail-modal");if(m)m.remove();};
  function addDetailButtons(){document.querySelectorAll("#os-table-body tr").forEach(row=>{if(row.querySelector(".dbs-os-detail-btn"))return;const strong=row.querySelector("td:nth-child(2) strong"),action=row.querySelector("td:last-child");if(!strong||!action)return;const b=document.createElement("button");b.className="btn btn-secondary btn-sm dbs-os-detail-btn";b.style.marginLeft="5px";b.textContent="Detalhes";b.onclick=()=>openOsDetail(strong.textContent.trim());action.appendChild(b);});}
  function wrapOrderRender(){if(typeof window.renderizarOrdens!=="function"||window.__dbsOrderRenderWrapped)return;const original=window.renderizarOrdens;window.renderizarOrdens=function(){original();addDetailButtons();};window.__dbsOrderRenderWrapped=true;}
  function fileToDataUrl(file,cb){if(!file){cb(null);return;}const r=new FileReader();r.onload=()=>cb(r.result);r.readAsDataURL(file);}
  function addMobileExecutionFields(){document.querySelectorAll(".pwa-box").forEach(box=>{const btn=box.querySelector("button[onclick^='concluirOSMobile']");if(!btn||box.querySelector(".dbs-mobile-execution"))return;const m=(btn.getAttribute("onclick")||"").match(/'([^']+)'/);if(!m)return;const id=m[1],o=state().ordens.find(x=>String(x.id)===String(id));if(!o)return;const wrap=document.createElement("div");wrap.className="dbs-mobile-execution";wrap.style.cssText="border-top:1px solid var(--border-light);padding-top:8px;margin-top:8px";wrap.innerHTML='<label style="font-size:10px;font-weight:700">Diagnóstico</label><textarea id="dbs-mob-diag-'+esc(id)+'" rows="2" style="width:100%;font-size:11px;padding:6px;margin:3px 0 7px">'+esc(o.diagnostico||"")+'</textarea><label style="font-size:10px;font-weight:700">Trabalho executado</label><textarea id="dbs-mob-work-'+esc(id)+'" rows="2" style="width:100%;font-size:11px;padding:6px;margin:3px 0 7px">'+esc(o.trabalhoExecutado||"")+'</textarea><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><label style="font-size:10px;font-weight:700">Foto antes<input type="file" accept="image/*" capture="environment" id="dbs-mob-before-'+esc(id)+'" style="width:100%;font-size:9px"></label><label style="font-size:10px;font-weight:700">Foto depois<input type="file" accept="image/*" capture="environment" id="dbs-mob-after-'+esc(id)+'" style="width:100%;font-size:9px"></label></div>';btn.parentElement.insertBefore(wrap,btn);const originalClick=btn.onclick;btn.onclick=function(){o.diagnostico=document.getElementById("dbs-mob-diag-"+id)?.value||"";o.trabalhoExecutado=document.getElementById("dbs-mob-work-"+id)?.value||"";const b=document.getElementById("dbs-mob-before-"+id),a=document.getElementById("dbs-mob-after-"+id);const finish=()=>{o.status="Concluída";o.timeline=Array.isArray(o.timeline)?o.timeline:[];o.timeline.push({status:"Concluída",at:new Date().toISOString(),by:o.tecnicoNome||"Campo"});persist();if(originalClick)originalClick.call(btn);else refresh();};if(b?.files?.[0]||a?.files?.[0]){let n=(b?.files?.[0]?1:0)+(a?.files?.[0]?1:0),done=0;if(b?.files?.[0])fileToDataUrl(b.files[0],d=>{o.fotoAntes=d;if(++done===n)finish();});if(a?.files?.[0])fileToDataUrl(a.files[0],d=>{o.fotoDepois=d;if(++done===n)finish();});}else finish();};});}
  function wrapPwa(){if(typeof window.renderizarPWAScreen!=="function"||window.__dbsPwaWrapped)return;const original=window.renderizarPWAScreen;window.renderizarPWAScreen=function(){original();setTimeout(()=>{addPartButtonToMobile();addMobileExecutionFields();},0);};window.__dbsPwaWrapped=true;}
  function addPartButtonToMobile(){document.querySelectorAll(".pwa-box").forEach(box=>{if(box.querySelector(".dbs-quick-part-btn"))return;const b=document.createElement("button");b.type="button";b.className="btn btn-secondary btn-sm dbs-quick-part-btn";b.style.cssText="margin-top:5px;width:100%;justify-content:center";b.textContent="+ Cadastrar peça agora";b.onclick=quickPart;const select=box.querySelector("select[id^='pwa-peca-select-']");if(select)select.parentElement.parentElement.appendChild(b);});}

  function enhanceRichClientForm(){try{if(window.__dbsRichClient)return;const form=document.getElementById("form-cliente");if(!form)return;const submit=form.querySelector("button[type=submit]");const block=document.createElement("div");block.id="dbs-rich-client-fields";block.style.cssText="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-light)";block.innerHTML='<div style="font-size:12px;font-weight:900;color:var(--color-primary);margin-bottom:10px">Dados complementares do cliente</div><div class="form-grid"><div class="form-group"><label>Nome fantasia</label><input id="cli-nome-fantasia" placeholder="Como o cliente é conhecido"></div><div class="form-group"><label>E-mail principal</label><input id="cli-email" type="email" placeholder="cliente@empresa.com.br"></div><div class="form-group"><label>Telefone</label><input id="cli-telefone" placeholder="(21) 0000-0000"></div><div class="form-group"><label>WhatsApp</label><input id="cli-whatsapp" placeholder="(21) 90000-0000"></div><div class="form-group"><label>E-mail do contato</label><input id="cli-contato-email" type="email" placeholder="responsavel@empresa.com.br"></div><div class="form-group"><label>CEP</label><input id="cli-cep" placeholder="21000-000"></div><div class="form-group"><label>Logradouro</label><input id="cli-logradouro" placeholder="Rua / Avenida"></div><div class="form-group"><label>Número</label><input id="cli-numero"></div><div class="form-group"><label>Complemento</label><input id="cli-complemento"></div><div class="form-group"><label>Bairro</label><input id="cli-bairro"></div><div class="form-group"><label>Cidade</label><input id="cli-cidade"></div><div class="form-group"><label>UF</label><input id="cli-uf" maxlength="2" placeholder="RJ"></div></div><div class="form-group" style="margin-top:10px"><label>Observações / peculiaridades de atendimento</label><textarea id="cli-observacoes" rows="3" placeholder="Horários de acesso, regras da unidade, contato alternativo, particularidades, restrições, informações úteis..."></textarea></div>';form.insertBefore(block,submit?submit.parentElement:null);const original=window.salvarCliente;if(typeof original==="function"){window.salvarCliente=function(ev){const extra={nomeFantasia:document.getElementById("cli-nome-fantasia")?.value.trim()||"",email:document.getElementById("cli-email")?.value.trim()||"",telefone:document.getElementById("cli-telefone")?.value.trim()||"",whatsapp:document.getElementById("cli-whatsapp")?.value.trim()||"",contatoEmail:document.getElementById("cli-contato-email")?.value.trim()||"",cep:document.getElementById("cli-cep")?.value.trim()||"",logradouro:document.getElementById("cli-logradouro")?.value.trim()||"",numero:document.getElementById("cli-numero")?.value.trim()||"",complemento:document.getElementById("cli-complemento")?.value.trim()||"",bairro:document.getElementById("cli-bairro")?.value.trim()||"",cidade:document.getElementById("cli-cidade")?.value.trim()||"",uf:document.getElementById("cli-uf")?.value.trim().toUpperCase()||"",observacoes:document.getElementById("cli-observacoes")?.value.trim()||""};original(ev);const st=state();const newest=st.clientes[st.clientes.length-1];if(newest){Object.assign(newest,extra);newest.endereco=[extra.logradouro,extra.numero,extra.complemento,extra.bairro,extra.cidade,extra.uf].filter(Boolean).join(", ")||newest.endereco;persist();refresh();}};window.__dbsRichClient=true;}}catch(e){console.warn("DBS rich client",e);}}
  function enhanceRichEquipmentForm(){if(window.__dbsRichEquipment)return;const form=document.getElementById("form-equipamento");if(!form)return;const submit=form.querySelector("button[type=submit]");const block=document.createElement("div");block.id="dbs-rich-equipment-fields";block.style.cssText="margin-top:14px;padding-top:14px;border-top:1px solid var(--border-light)";block.innerHTML='<div style="font-size:12px;font-weight:900;color:var(--color-primary);margin-bottom:10px">Ficha técnica avançada do ativo</div><div class="form-grid"><div class="form-group"><label>Tensão / Alimentação</label><input id="eq-tensao" placeholder="220V / 380V / Trifásico"></div><div class="form-group"><label>Tecnologia</label><input id="eq-tecnologia" placeholder="Inverter, convencional, VRF..."></div><div class="form-group"><label>Fluido refrigerante</label><input id="eq-fluido" placeholder="R-410A, R-32..."></div><div class="form-group"><label>Compressor</label><input id="eq-compressor" placeholder="Rotativo, Scroll..."></div><div class="form-group"><label>Localização / Setor</label><input id="eq-localizacao" placeholder="Sala, loja, pavimento..."></div><div class="form-group"><label>Data de instalação</label><input id="eq-data-instalacao" type="date"></div><div class="form-group"><label>Última manutenção</label><input id="eq-ultima-manutencao" type="date"></div><div class="form-group"><label>Periodicidade de manutenção</label><input id="eq-periodicidade" placeholder="Mensal, trimestral, semestral..."></div><div class="form-group"><label>Status do ativo</label><select id="eq-status"><option>Ativo</option><option>Em manutenção</option><option>Inativo</option><option>Baixado</option></select></div></div><div class="form-group" style="margin-top:10px"><label>Observações técnicas / peculiaridades</label><textarea id="eq-observacoes" rows="3" placeholder="Acesso, painel, instalação, histórico, recomendações, restrições e outras informações técnicas..."></textarea></div>';form.insertBefore(block,submit?submit.parentElement:null);const original=window.salvarEquipamento;if(typeof original==="function"){window.salvarEquipamento=function(ev){const extra={tensao:document.getElementById("eq-tensao")?.value.trim()||"",tecnologia:document.getElementById("eq-tecnologia")?.value.trim()||"",fluido:document.getElementById("eq-fluido")?.value.trim()||"",compressor:document.getElementById("eq-compressor")?.value.trim()||"",localizacao:document.getElementById("eq-localizacao")?.value.trim()||"",dataInstalacao:document.getElementById("eq-data-instalacao")?.value||"",ultimaManutencao:document.getElementById("eq-ultima-manutencao")?.value||"",periodicidade:document.getElementById("eq-periodicidade")?.value.trim()||"",status:document.getElementById("eq-status")?.value||"Ativo",observacoes:document.getElementById("eq-observacoes")?.value.trim()||""};original(ev);const st=state();const newest=st.equipamentos[st.equipamentos.length-1];if(newest){Object.assign(newest,extra);persist();refresh();}};window.__dbsRichEquipment=true;}}
  function installMultiEquipmentSelector(){if(window.__dbsMultiEquipment)return;const sel=document.getElementById("os-select-equipamento");if(!sel)return;sel.style.display="none";sel.required=false;const wrap=document.createElement("div");wrap.id="dbs-os-equipment-picker";wrap.style.cssText="border:1px solid var(--border-color);border-radius:8px;background:#fff;padding:10px;max-height:220px;overflow:auto";sel.parentElement.appendChild(wrap);const note=document.createElement("div");note.id="dbs-os-equipment-note";note.style.cssText="font-size:10px;color:var(--text-muted);margin-top:5px";sel.parentElement.appendChild(note);const originalUpdate=window.atualizarEquipamentosDoClienteOS;window.atualizarEquipamentosDoClienteOS=function(){const cliId=String(document.getElementById("os-select-cliente")?.value||"");const list=state().equipamentos.filter(e=>String(e.clienteId)===cliId);const mem=window.__dbsOsEquipChecked||{};const keep=new Set(mem.cliId===cliId&&cliId?mem.ids:[]);sel.innerHTML=list.length?list.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.tag||("EQ-"+e.id))+"</option>").join(""):'<option value="">Nenhum equipamento cadastrado</option>';wrap.innerHTML=list.length?'<label style="display:flex;gap:7px;align-items:center;padding:6px 4px;border-bottom:1px solid #e2e8f0;font-size:11px;font-weight:900"><input type="checkbox" id="dbs-os-all-equipment"> Selecionar todos os equipamentos deste cliente</label>'+list.map(e=>'<label style="display:flex;gap:8px;align-items:flex-start;padding:8px 4px;border-bottom:1px solid #f1f5f9;font-size:11px"><input type="checkbox" class="dbs-os-equipment-check" value="'+esc(e.id)+'"><span><b>'+esc(e.tag||("EQ-"+e.id))+'</b> · '+esc(e.tipo||"")+'<small style="display:block;color:#64748b">'+esc(e.marca||"")+' '+esc(e.modelo||"")+' · '+esc(e.ambiente||e.localizacao||"")+'</small></span></label>').join(""):'<div style="font-size:11px;color:#64748b;padding:8px">Nenhum equipamento vinculado ao cliente.</div>';const all=document.getElementById("dbs-os-all-equipment");if(all)all.onchange=()=>wrap.querySelectorAll(".dbs-os-equipment-check").forEach(c=>c.checked=all.checked);const remember=()=>{const checks=Array.from(wrap.querySelectorAll(".dbs-os-equipment-check"));window.__dbsOsEquipChecked={cliId,ids:checks.filter(x=>x.checked).map(x=>String(x.value))};if(all)all.checked=checks.length>0&&checks.every(x=>x.checked);if(checks.length){const first=checks.find(x=>x.checked);sel.value=first?String(first.value):"";}};wrap.querySelectorAll(".dbs-os-equipment-check").forEach(c=>{if(keep.has(String(c.value)))c.checked=true;c.onchange=remember;});if(all){const prev=all.onchange;all.onchange=()=>{prev&&prev();remember();};const cs=Array.from(wrap.querySelectorAll(".dbs-os-equipment-check"));all.checked=cs.length>0&&cs.every(x=>x.checked);}{const f=wrap.querySelector(".dbs-os-equipment-check:checked");if(f)sel.value=String(f.value);}note.textContent=list.length?"Você pode selecionar 1, vários ou todos os equipamentos.":"Cadastre o equipamento antes de abrir a OS.";if(typeof originalUpdate==="function"&&false)originalUpdate();};const originalSave=window.salvarNovaOS;if(typeof originalSave==="function"){window.salvarNovaOS=function(ev){ev&&ev.preventDefault&&ev.preventDefault();const ids=Array.from(wrap.querySelectorAll(".dbs-os-equipment-check:checked")).map(c=>String(c.value)).filter(Boolean);if(!ids.length){alert("Selecione pelo menos um equipamento para esta OS.");return;}sel.value=String(ids[0]);const before=state().ordens.length;originalSave(ev);const st=state();const created=st.ordens.length>before?st.ordens[st.ordens.length-1]:null;if(created){window.__dbsOsEquipChecked=null;created.equipamentoIds=ids;created.todosEquipamentosSelecionados=ids.length===state().equipamentos.filter(e=>String(e.clienteId)===String(created.clienteId)).length;created.equipamentosCount=ids.length;persist();refresh();}};window.__dbsMultiEquipment=true;}window.atualizarEquipamentosDoClienteOS();}
  function installReliableOsComboboxes(){
    if(window.__dbsReliableOsCombosInstalled)return;
    const ids=[["os-select-cliente","Cliente","Digite nome, CNPJ ou parte do cliente..."],["os-select-tecnico","Técnico","Digite o nome do técnico..."],["os-select-servico","Serviço","Digite o serviço..."]];
    const records=new Map();
    function closeOthers(except){document.querySelectorAll(".dbs-os-combo.open").forEach(x=>{if(x!==except)x.classList.remove("open");});}
    function renderOptions(rec){
      const term=rec.showAll?"":String(rec.input.value||"").trim().toLocaleLowerCase("pt-BR");
      const options=Array.from(rec.select.options).filter(o=>o.value);
      const filtered=term?options.filter(o=>o.textContent.toLocaleLowerCase("pt-BR").includes(term)):options;
      rec.menu.innerHTML="";
      if(!filtered.length){const empty=document.createElement("div");empty.className="dbs-os-combo-empty";empty.textContent=options.length?"Nenhum resultado encontrado.":"Nenhum cadastro disponível.";rec.menu.appendChild(empty);return;}
      filtered.slice(0,120).forEach(opt=>{
        const item=document.createElement("button");item.type="button";item.className="dbs-os-combo-option"+(String(opt.value)===String(rec.select.value)?" selected":"");item.textContent=opt.textContent.trim();item.onmousedown=e=>e.preventDefault();
        item.onclick=()=>{rec.select.value=String(opt.value);rec.input.value=opt.textContent.trim();rec.select.dispatchEvent(new Event("change",{bubbles:true}));rec.wrap.classList.remove("open");rec.input.setAttribute("aria-expanded","false");};
        rec.menu.appendChild(item);
      });
    }
    function syncCombo(id){
      const rec=records.get(id),sel=document.getElementById(id);if(!rec||!sel)return;
      const opt=sel.value?Array.from(sel.options).find(o=>o.value&&String(o.value)===String(sel.value)):null;
      rec.input.value=opt?opt.textContent.trim():"";renderOptions(rec);
    }
    function build(id,label,placeholder){
      const sel=document.getElementById(id);if(!sel||records.has(id))return;
      const parent=sel.parentElement;if(!parent)return;
      const wrap=document.createElement("div");wrap.className="dbs-os-combo";wrap.dataset.for=id;
      const input=document.createElement("input");input.type="text";input.className="dbs-os-combo-input";input.autocomplete="off";input.setAttribute("role","combobox");input.setAttribute("aria-expanded","false");input.setAttribute("aria-label",label);input.placeholder=placeholder;
      const menu=document.createElement("div");menu.className="dbs-os-combo-menu";wrap.append(input,menu);parent.insertBefore(wrap,sel);
      sel.style.cssText="margin-top:6px;font-size:11px;";sel.title="Seleção alternativa";
      const rec={select:sel,input,menu,wrap,placeholder};records.set(id,rec);
      input.addEventListener("focus",()=>{closeOthers(wrap);wrap.classList.add("open");input.setAttribute("aria-expanded","true");rec.showAll=true;renderOptions(rec);rec.showAll=false;try{input.select();}catch(_){}});
      input.addEventListener("input",()=>{wrap.classList.add("open");input.setAttribute("aria-expanded","true");renderOptions(rec);});
      input.addEventListener("keydown",e=>{
        const opts=Array.from(menu.querySelectorAll(".dbs-os-combo-option"));
        if(e.key==="Escape"){wrap.classList.remove("open");input.setAttribute("aria-expanded","false");syncCombo(id);return;}
        if((e.key==="ArrowDown"||e.key==="ArrowUp")&&opts.length){e.preventDefault();const current=opts.indexOf(menu.querySelector(".active"));const next=e.key==="ArrowDown"?Math.min(opts.length-1,current<0?0:current+1):Math.max(0,current<0?0:current-1);opts.forEach(x=>x.classList.remove("active"));opts[next].classList.add("active");opts[next].scrollIntoView({block:"nearest"});}
        if(e.key==="Enter"){e.preventDefault();const active=menu.querySelector(".active")||menu.querySelector(".selected")||opts[0];if(active)active.click();}
      });
      sel.addEventListener("change",()=>{syncCombo(id);if(id==="os-select-cliente"&&typeof window.atualizarEquipamentosDoClienteOS==="function")window.atualizarEquipamentosDoClienteOS();});
      syncCombo(id);
    }
    function rebuild(){ids.forEach(x=>build(x[0],x[1],x[2]));records.forEach((_,id)=>syncCombo(id));}
    const originalUpdate=window.atualizarSelects;
    if(typeof originalUpdate==="function"&&!window.__dbsSelectsWrapped){
      window.atualizarSelects=function(){
        const previous={};ids.forEach(x=>{const s=document.getElementById(x[0]);if(s)previous[x[0]]=String(s.value||"");});
        originalUpdate();
        ids.forEach(x=>{const s=document.getElementById(x[0]);if(s&&previous[x[0]]&&Array.from(s.options).some(o=>String(o.value)===previous[x[0]]))s.value=previous[x[0]];});
        if(typeof window.atualizarEquipamentosDoClienteOS==="function")window.atualizarEquipamentosDoClienteOS();
        rebuild();
      };
      window.__dbsSelectsWrapped=true;
    }
    rebuild();
    document.addEventListener("click",e=>{if(!e.target.closest(".dbs-os-combo"))closeOthers(null);});
    window.__dbsReliableOsCombosInstalled=true;
  }
  function installReliableOsComboStyles(){
    if(document.getElementById("dbs-os-combo-styles"))return;
    const style=document.createElement("style");style.id="dbs-os-combo-styles";
    style.textContent=".dbs-os-combo{position:relative;width:100%;z-index:30}.dbs-os-combo-input{width:100%!important;min-height:38px!important;padding:9px 11px!important;border:1px solid #b8c7d9!important;border-radius:10px!important;background:#fff!important;color:#10243f!important;font-size:13px!important;outline:none!important;box-shadow:0 1px 2px rgba(15,23,42,.03)!important}.dbs-os-combo-input:focus{border-color:#1769d1!important;box-shadow:0 0 0 3px rgba(23,105,209,.12)!important}.dbs-os-combo.open{z-index:1000}.dbs-os-combo-menu{display:none;position:absolute;left:0;right:0;top:calc(100% + 5px);max-height:270px;overflow:auto;padding:5px;background:#fff;border:1px solid #cbd8e8;border-radius:12px;box-shadow:0 18px 45px rgba(15,42,75,.18)}.dbs-os-combo.open .dbs-os-combo-menu{display:block}.dbs-os-combo-option{display:block;width:100%;padding:9px 10px;border:0;border-radius:8px;background:#fff;color:#10243f;text-align:left;font-size:12px;cursor:pointer}.dbs-os-combo-option:hover,.dbs-os-combo-option.active{background:#edf5ff;color:#0b5bb7}.dbs-os-combo-option.selected{font-weight:800;background:#f0f7ff;color:#1769d1}.dbs-os-combo-empty{padding:12px 10px;color:#64748b;font-size:11px;text-align:center}#tab-nova-os{overflow:visible}#tab-nova-os .data-card,#tab-nova-os .form-grid{overflow:visible}";
    document.head.appendChild(style);
  }

  function boot(){
    try{
      installFieldControlOrderDetailsBridge();
      enhanceRichClientForm();
      enhanceRichEquipmentForm();
      addOsFields();
      installMultiEquipmentSelector();
      installReliableOsComboStyles();
      installReliableOsComboboxes();
      wrapOsSave();
      wrapOrderRender();
      wrapPwa();
      addInlineButtons();
    }catch(error){ console.warn("DBS CONTROL UX boot",error); }
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();setTimeout(boot,500);setTimeout(boot,1500);
  function installFieldControlSyncPanel(){
    if(window.__dbsFieldControlPanel)return;
    // O painel oficial fica no HTML principal; não duplicar a área da API.
    if(document.getElementById("dbs-fieldcontrol-static")){ window.__dbsFieldControlPanel=true; return; }
    const tab=document.getElementById("tab-importacao");
    if(!tab)return;
    const card=document.createElement("div");
    card.className="data-card dbs-fieldcontrol-card";
    card.style.cssText="padding:20px;margin-bottom:20px;border:1px solid #bae6fd;background:linear-gradient(180deg,#ffffff,#f8fcff)";
    card.innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap"><div><h3 style="margin:0">Sincronização FieldControl</h3><p style="margin:4px 0 0;font-size:11px;color:var(--text-muted)">Traga clientes, locais, equipamentos, serviços e histórico operacional sem depender de várias planilhas.</p></div><span id="dbs-fc-status" style="display:inline-flex;align-items:center;padding:5px 9px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:10px;font-weight:900">Não configurado</span></div><div class="form-grid" style="margin-top:16px"><div class="form-group" style="grid-column:span 2"><label>Chave API FieldControl</label><input id="dbs-fc-api-key" type="password" autocomplete="new-password" placeholder="Cole a chave API do FieldControl aqui"><small style="font-size:9px;color:#64748b">A chave fica no servidor e não é exibida novamente.</small></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button id="dbs-fc-save" class="btn btn-primary btn-sm" type="button">Salvar chave e testar</button><button id="dbs-fc-test" class="btn btn-secondary btn-sm" type="button">Testar conexão</button><button id="dbs-fc-preview" class="btn btn-secondary btn-sm" type="button">Pré-visualizar sincronização</button><button id="dbs-fc-apply" class="btn btn-success btn-sm" type="button">Sincronizar base</button></div><div id="dbs-fc-message" style="margin-top:12px;font-size:11px;color:var(--text-muted)"></div><div id="dbs-fc-summary" style="display:none;margin-top:12px;padding:12px;border:1px solid #e2e8f0;border-radius:10px;background:#fff"></div>';
    tab.insertBefore(card,tab.firstElementChild);
    const statusEl=document.getElementById("dbs-fc-status"),msgEl=document.getElementById("dbs-fc-message"),sumEl=document.getElementById("dbs-fc-summary");
    const send=(action,extra={})=>{msgEl.textContent="Processando...";window.parent.postMessage({type:"DBS_CONTROL_FIELDCONTROL",action,...extra},"*");};
    document.getElementById("dbs-fc-save").onclick=()=>{const key=document.getElementById("dbs-fc-api-key")?.value.trim();if(!key){msgEl.textContent="Informe a chave API antes de salvar.";return;}send("save_key",{apiKey:key});};
    document.getElementById("dbs-fc-test").onclick=()=>send("test");
    document.getElementById("dbs-fc-preview").onclick=()=>send("sync_preview");
    document.getElementById("dbs-fc-apply").onclick=()=>{if(!confirm("A sincronização é não destrutiva e fará upsert dos dados do FieldControl na base DBS. Continuar?"))return;send("sync_apply");};
    window.addEventListener("message",(event)=>{
      if(event.source!==window.parent)return;
      const m=event.data||{};
      if(m.type!=="DBS_CONTROL_FIELDCONTROL_RESULT")return;
      if(!m.ok){statusEl.textContent="Erro";statusEl.style.background="#fee2e2";statusEl.style.color="#991b1b";msgEl.textContent=m.error||"Falha na integração FieldControl.";return;}
      const result=m.result||{};
      if(m.action==="status"){
        const configured=!!result.configured;
        statusEl.textContent=configured?"Configurado":"Não configurado";
        statusEl.style.background=configured?"#dcfce7":"#f1f5f9";
        statusEl.style.color=configured?"#166534":"#64748b";
        msgEl.textContent=configured&&result.last_sync_at?("Última sincronização: "+new Date(result.last_sync_at).toLocaleString("pt-BR")):"";
        return;
      }
      if(m.action==="save_key"){statusEl.textContent="Conectado";statusEl.style.background="#dcfce7";statusEl.style.color="#166534";msgEl.textContent="Chave salva e conexão validada com sucesso.";return;}
      if(m.action==="test"){statusEl.textContent="Conectado";statusEl.style.background="#dcfce7";statusEl.style.color="#166534";msgEl.textContent="Conexão FieldControl validada.";return;}
      const s=result.summary||{};
      sumEl.style.display="block";
      const rows=[["Clientes",s.customers?.fetched,s.customers?.upserted],["Locais",s.sites?.fetched,s.sites?.upserted],["Equipamentos",s.equipment?.fetched,s.equipment?.upserted],["Serviços",s.services?.fetched,s.services?.upserted],["OS",s.orders?.fetched,s.orders?.upserted],["Técnicos",s.employees?.fetched,"—"]];
      sumEl.innerHTML='<div style="font-weight:900;color:#0f172a;margin-bottom:8px">'+(m.action==="sync_apply"?"Sincronização concluída":"Pré-visualização da sincronização")+'</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">'+rows.map(x=>'<div style="padding:9px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc"><small style="display:block;font-size:9px;color:#64748b;font-weight:800;text-transform:uppercase">'+x[0]+'</small><b style="display:block;margin-top:3px;color:#0f172a">'+String(x[1]??0)+'</b><span style="font-size:9px;color:#64748b">'+(m.action==="sync_apply"?"gravados: "+String(x[2]??0):"encontrados")+'</span></div>').join("")+'</div>';
      msgEl.textContent=result.errors?.length?result.errors.join(" | "):(m.action==="sync_apply"?"Base DBS CONTROL atualizada sem apagar registros.":"Nenhum dado foi alterado.");
      if(m.action==="sync_apply")statusEl.textContent="Sincronizado";
    });
    window.__dbsFieldControlPanel=true;
    window.parent.postMessage({type:"DBS_CONTROL_FIELDCONTROL",action:"status"},"*");
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(installFieldControlSyncPanel,100));
  else setTimeout(installFieldControlSyncPanel,100);
  setTimeout(installFieldControlSyncPanel,800);


  /* DBS CONTROL UX REFORM 2026-10-06 */
  (function installDbsControlUxReform(){
    if(window.__dbsControlUxReformInstalled)return;
    window.__dbsControlUxReformInstalled=true;

    const style=document.createElement("style");
    style.id="dbs-control-ux-reform-20261006";
    style.textContent=`
      /* --- Shell: one hierarchy, one page header --- */
      :root{
        --dbs-blue:#1769d1;
        --dbs-blue-dark:#0e4fa7;
        --dbs-ink:#10243f;
        --dbs-muted:#66788a;
        --dbs-bg:#f5f8fc;
        --dbs-line:#e4ebf3;
        --dbs-soft:#f8fbff;
        --sidebar-width:238px;
      }
      html,body{background:var(--dbs-bg)!important;color:var(--dbs-ink)!important;}
      body{font-size:13px!important;}
      aside{
        width:var(--sidebar-width)!important;
        background:#082b57!important;
        background-image:none!important;
        box-shadow:none!important;
      }
      .brand-header{
        min-height:62px!important;
        padding:14px 16px!important;
        background:#07264a!important;
        box-shadow:none!important;
      }
      .nav-menu{padding:8px 8px 16px!important;}
      .nav-section{
        padding:14px 11px 5px!important;
        margin-top:4px!important;
        color:#8fb3da!important;
        font-size:9px!important;
        letter-spacing:.13em!important;
      }
      .nav-item{
        margin:2px 0!important;
        min-height:35px!important;
        padding:8px 11px!important;
        border:0!important;
        border-radius:8px!important;
        color:#c6d5e5!important;
        font-size:12px!important;
        font-weight:650!important;
        background:transparent!important;
        box-shadow:none!important;
        transform:none!important;
      }
      .nav-item:hover{background:#103f78!important;color:#fff!important;}
      .nav-item.active{
        background:#12477f!important;
        color:#fff!important;
        box-shadow:inset 3px 0 0 #55a9ef!important;
      }
      main{background:var(--dbs-bg)!important;}
      main>header{
        min-height:66px!important;
        padding:12px 24px!important;
        background:#fff!important;
        border-bottom:1px solid var(--dbs-line)!important;
        box-shadow:none!important;
        backdrop-filter:none!important;
      }
      .page-title h1{
        font-size:19px!important;
        line-height:1.15!important;
        font-weight:800!important;
        letter-spacing:-.025em!important;
      }
      .page-title p{
        margin-top:3px!important;
        font-size:11px!important;
        color:var(--dbs-muted)!important;
      }
      main>header>.page-title{min-width:0;}
      main>header>div:last-child{gap:7px!important;}
      main>header>div:last-child .btn{min-height:34px!important;}
      main>header>div:last-child .btn-secondary{
        font-size:10px!important;
        color:#66788a!important;
        border-color:#e0e7ef!important;
        background:#fff!important;
      }

      /* --- Pages: breathing room without nested boxes --- */
      .tab-view{
        padding:20px 24px 34px!important;
        background:transparent!important;
      }
      .data-card{
        border:1px solid var(--dbs-line)!important;
        border-radius:12px!important;
        box-shadow:0 2px 9px rgba(16,42,67,.035)!important;
        margin-bottom:14px!important;
        background:#fff!important;
      }
      .data-header{
        min-height:48px!important;
        padding:11px 15px!important;
        background:#fff!important;
        border-bottom:1px solid #edf2f7!important;
      }
      .data-header h3{
        font-size:12px!important;
        font-weight:800!important;
        letter-spacing:0!important;
        text-transform:none!important;
      }
      .metric-card{
        border:1px solid var(--dbs-line)!important;
        border-radius:11px!important;
        box-shadow:none!important;
        padding:14px!important;
      }
      .metrics-grid{gap:10px!important;margin-bottom:14px!important;}
      .metric-title{font-size:9px!important;letter-spacing:.04em!important;}
      .metric-value{font-size:23px!important;margin-top:3px!important;}
      .filter-bar{gap:8px!important;}
      .filter-bar input,.filter-bar select{
        min-height:36px!important;
        border-radius:8px!important;
        border-color:#d5e0eb!important;
      }
      table th{
        padding:9px 11px!important;
        background:#f8fafc!important;
        color:#718399!important;
        font-size:9px!important;
        text-transform:none!important;
        letter-spacing:.02em!important;
      }
      table td{padding:10px 11px!important;}
      tr:hover{background:#f8fbff!important;}

      /* Dashboard: one operational surface */
      #tab-dashboard .quick-start-card{
        border:0!important;
        box-shadow:none!important;
        background:transparent!important;
        margin-bottom:14px!important;
      }
      #tab-dashboard .quick-start-card .data-header{
        padding:0 0 8px!important;
        border:0!important;
        background:transparent!important;
      }
      #tab-dashboard .quick-start-card .data-header h3,
      #tab-dashboard .quick-start-card .quick-start-subtitle,
      #tab-dashboard .quick-start-card .quick-flow{display:none!important;}
      #tab-dashboard .quick-start-grid{
        display:flex!important;
        gap:8px!important;
        padding:0!important;
        overflow-x:auto!important;
      }
      #tab-dashboard .quick-start-action{
        flex:1 0 180px!important;
        min-height:58px!important;
        padding:10px 12px!important;
        border:1px solid #e1e9f2!important;
        border-radius:9px!important;
        box-shadow:none!important;
        transform:none!important;
      }
      #tab-dashboard .quick-start-action:hover{transform:none!important;box-shadow:none!important;}

      /* Operational pages: form card becomes a clean working surface */
      .dbs-ux-form-card{
        border:0!important;
        box-shadow:none!important;
        background:transparent!important;
        padding:0!important;
      }
      .dbs-ux-form-card>h3{
        display:none!important;
      }
      .dbs-ux-form-card>.data-header h3{display:none!important;}
      .dbs-ux-form-card>.data-header{
        min-height:0!important;
        padding:0 0 9px!important;
        background:transparent!important;
        border:0!important;
      }
      .dbs-ux-form-card form{
        padding:18px!important;
        background:#fff!important;
        border:1px solid var(--dbs-line)!important;
        border-radius:12px!important;
        box-shadow:0 2px 9px rgba(16,42,67,.035)!important;
      }
      .dbs-ux-form-card .form-group label{
        font-size:9px!important;
        letter-spacing:.035em!important;
      }

      /* OS list: filter first, no decorative header block */
      #tab-ordens .data-card>.data-header{
        padding:12px 14px!important;
        background:#fff!important;
      }
      #tab-ordens .data-header>div:first-child{flex:1 1 420px!important;}
      #tab-ordens .data-header .filter-bar{width:100%!important;}
      #tab-ordens .data-header .filter-bar input{width:min(360px,100%)!important;}
      #tab-ordens .data-header .filter-bar select{width:180px!important;}

      /* Activities: KPIs and filters stay compact */
      #tab-atividades .data-card:first-child{
        border:0!important;
        box-shadow:none!important;
        background:transparent!important;
      }
      #tab-atividades .data-card:first-child>.day-toolbar{
        background:#fff!important;
        border:1px solid var(--dbs-line)!important;
        border-radius:10px!important;
        box-shadow:none!important;
      }
      .day-kpi-grid{gap:9px!important;margin-bottom:12px!important;}
      .day-kpi{border:1px solid var(--dbs-line)!important;border-radius:10px!important;box-shadow:none!important;}

      /* Flatten the first registration block on CRUD pages; data remains intact. */
      .dbs-ux-registration>.data-header{padding:0 0 8px!important;}
      .dbs-ux-registration>.data-header,
      .dbs-ux-registration>h3{background:transparent!important;border:0!important;}
      .dbs-ux-registration>h3{display:none!important;}
      .dbs-ux-registration form{background:#fff!important;}

      /* Nova OS: one page hierarchy, no hero-on-hero/card stack. */
      #tab-nova-os.dbs-os-premium{
        padding:20px 24px 36px!important;
        background:transparent!important;
      }
      #tab-nova-os .os-premium-shell{width:min(1080px,100%)!important;}
      #tab-nova-os .os-premium-top{
        min-height:66px!important;
        padding:14px 18px!important;
        border-radius:12px 12px 0 0!important;
        background:#082b57!important;
        background-image:none!important;
        box-shadow:none!important;
      }
      #tab-nova-os .os-premium-heading span,
      #tab-nova-os .os-premium-mark{display:none!important;}
      #tab-nova-os .os-premium-heading h2{font-size:18px!important;}
      #tab-nova-os .os-premium-meta{display:none!important;}
      #tab-nova-os .os-premium-form{
        border-radius:0 0 12px 12px!important;
        box-shadow:0 2px 9px rgba(16,42,67,.035)!important;
      }
      #tab-nova-os .os-premium-body{padding:20px!important;}
      #tab-nova-os .os-premium-divider{margin:18px 0!important;}
      #tab-nova-os .os-premium-description{margin-top:18px!important;}
      #tab-nova-os .os-premium-footer{padding:11px 20px!important;}
      #tab-nova-os .os-premium-submit{
        background:var(--dbs-blue)!important;
        box-shadow:none!important;
      }

      /* Remove visual duplication from internal headings, never from their data/actions. */
      .dbs-ux-no-title>h3{display:none!important;}
      .dbs-ux-no-title>.data-header h3{display:none!important;}

      @media(max-width:900px){
        :root{--sidebar-width:220px;}
        .tab-view{padding:16px 16px 28px!important;}
        main>header{padding:10px 16px!important;}
      }
      @media(max-width:640px){
        aside{width:100%!important;max-height:118px!important;}
        .nav-menu{padding:7px 8px!important;}
        main{height:calc(100vh - 118px)!important;}
        main>header{padding:9px 12px!important;}
        .tab-view{padding:12px 10px 26px!important;}
        #tab-nova-os.dbs-os-premium{padding:12px 10px 28px!important;}
        #tab-nova-os .os-premium-body{padding:16px 14px!important;}
        #tab-nova-os .os-premium-top{padding:13px 14px!important;}
        .dbs-ux-form-card form{padding:14px!important;}
      }
    `;
    document.head.appendChild(style);

    const titleMap={
      "tab-dashboard":["Dashboard","Visão operacional do DBS Control"],
      "tab-atividades":["Atividades do Dia","Acompanhamento dos atendimentos de hoje"],
      "tab-despacho":["Despacho","Distribuição e acompanhamento dos atendimentos"],
      "tab-ordens":["Ordens de Serviço","Acompanhe e gerencie os atendimentos"],
      "tab-nova-os":["Nova OS","Abra e encaminhe um novo atendimento"],
      "tab-cadastros":["Cadastros","Base central e integridade das informações"],
      "tab-clientes":["Clientes","Cadastro, ativos e histórico de atendimento"],
      "tab-importacao":["Importação / Integrações","Entrada e sincronização de dados"],
      "tab-equipamentos":["Equipamentos","Ativos instalados e histórico operacional"],
      "tab-tecnicos":["Técnicos","Equipe de campo e acessos"],
      "tab-pecas":["Peças e Estoque","Insumos utilizados na operação"],
      "tab-servicos":["Serviços","Catálogo utilizado nas ordens de serviço"],
      "tab-compras":["Compras","Pedidos e insumos da operação"],
      "tab-pwa":["Minhas OS","Atendimentos atribuídos ao colaborador"]
    };

    function activeTab(){
      return document.querySelector(".tab-view.active");
    }

    function scrollToFirstForm(id){
      const form=document.getElementById(id);
      if(form)form.scrollIntoView({behavior:"smooth",block:"start"});
    }

    function syncPageHeader(){
      const tab=activeTab(), id=tab?.id;
      if(!id||!titleMap[id])return;
      const [title,subtitle]=titleMap[id];
      const h=document.getElementById("view-title"), p=document.getElementById("view-subtitle");
      if(h)h.textContent=title;
      if(p)p.textContent=subtitle;
      const headerAction=document.querySelector("main>header>div:last-child .btn-primary");
      if(!headerAction)return;
      const actions={
        "tab-dashboard":["+ Nova OS",()=>window.switchTab&&window.switchTab("tab-nova-os")],
        "tab-atividades":["+ Nova OS",()=>window.switchTab&&window.switchTab("tab-nova-os")],
        "tab-despacho":["+ Nova OS",()=>window.switchTab&&window.switchTab("tab-nova-os")],
        "tab-ordens":["+ Nova OS",()=>window.switchTab&&window.switchTab("tab-nova-os")],
        "tab-nova-os":["Emitir OS",()=>document.getElementById("form-nova-os")?.requestSubmit()],
        "tab-cadastros":["+ Nova OS",()=>window.switchTab&&window.switchTab("tab-nova-os")],
        "tab-clientes":["+ Novo cliente",()=>scrollToFirstForm("form-cliente")],
        "tab-importacao":["Importar planilha",()=>document.getElementById("import-arquivo")?.click()],
        "tab-equipamentos":["+ Novo equipamento",()=>scrollToFirstForm("form-equipamento")],
        "tab-tecnicos":["+ Novo técnico",()=>scrollToFirstForm("form-tecnico")],
        "tab-pecas":["+ Nova peça",()=>scrollToFirstForm("form-peca")],
        "tab-servicos":["+ Novo serviço",()=>scrollToFirstForm("form-servico")],
        "tab-compras":["+ Nova compra",()=>scrollToFirstForm("form-compra")],
        "tab-pwa":["Atualizar OS",()=>typeof window.renderizarPWA==="function"&&window.renderizarPWA()]
      };
      const cfg=actions[id];
      if(cfg){headerAction.textContent=cfg[0];headerAction.onclick=cfg[1];}
    }

    function classifyPages(){
      const ids=["tab-clientes","tab-equipamentos","tab-tecnicos","tab-pecas","tab-servicos","tab-compras"];
      ids.forEach(id=>{
        const tab=document.getElementById(id); if(!tab)return;
        const first=tab.querySelector(".data-card");
        if(first)first.classList.add("dbs-ux-form-card","dbs-ux-registration");
        const directHeading=first?.querySelector(":scope>h3");
        if(directHeading)first.classList.add("dbs-ux-no-title");
      });
      ["tab-dashboard","tab-atividades","tab-ordens","tab-cadastros","tab-importacao"].forEach(id=>{
        const tab=document.getElementById(id);if(tab)tab.classList.add("dbs-ux-page");
      });
      const nova=document.getElementById("tab-nova-os"); if(nova)nova.classList.add("dbs-ux-page");
    }

    function normalizeNav(){
      const sections=[...document.querySelectorAll("aside .nav-section")];
      const items=[...document.querySelectorAll("aside .nav-item")];
      const labels={
        "Dashboard Principal":"Dashboard",
        "Quadros de Despacho":"Despacho",
        "Nova OS":"Nova OS",
        "Central de Cadastros":"Cadastros",
        "Importação em Massa":"Importação / Integrações",
        "Parque de Equipamentos":"Equipamentos",
        "Equipe Técnica":"Técnicos",
        "Peças & Estoque":"Peças e Estoque",
        "Serviços":"Serviços",
        "Compras":"Compras"
      };
      items.forEach(item=>{
        const span=item.querySelector("span");
        if(span&&labels[span.textContent.trim()])span.textContent=labels[span.textContent.trim()];
      });
      if(sections[0])sections[0].textContent="OPERAÇÃO";
      if(sections[1])sections[1].textContent="CADASTROS";
      if(sections[2])sections[2].textContent="GESTÃO";
      if(sections[3])sections[3].textContent="CAMPO";
    }

    function installSwitchObserver(){
      if(typeof window.switchTab==="function"&&!window.__dbsSwitchTabWrapped){
        const original=window.switchTab;
        window.switchTab=function(tabId,el){
          const result=original.apply(this,arguments);
          setTimeout(()=>{classifyPages();normalizeNav();syncPageHeader();},0);
          return result;
        };
        window.__dbsSwitchTabWrapped=true;
      }
      const observer=new MutationObserver(()=>syncPageHeader());
      document.querySelectorAll(".tab-view").forEach(t=>observer.observe(t,{attributes:true,attributeFilter:["class"]}));
      syncPageHeader();
    }

    function bootReform(){
      classifyPages();
      normalizeNav();
      installSwitchObserver();
      syncPageHeader();
    }

    if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bootReform);
    else bootReform();
    setTimeout(bootReform,250);
    setTimeout(bootReform,1000);
  })();

})();

/* DBS CONTROL — segunda camada de reforma UX 2026-10-06
   Apenas apresentação/navegação. Nenhuma rotina de dados é removida.
*/
(function installDbsControlOperationalLayer(){
  if(window.__dbsControlOperationalLayer)return;
  window.__dbsControlOperationalLayer=true;

  const style=document.createElement("style");
  style.id="dbs-control-operational-layer-20261006";
  style.textContent=String.raw`
    main>header .page-title h1{letter-spacing:-.03em!important}
    .tab-view>.data-card{margin-bottom:14px!important}
    .tab-view>.data-card>.data-header h3,.tab-view>.data-card>div>h3{font-size:12px!important;line-height:1.25!important}
    .tab-view .data-header p{font-size:10px!important;color:#718096!important}
    .tab-view .form-group label{font-size:9px!important;letter-spacing:.02em!important}
    .tab-view .form-group input,.tab-view .form-group select,.tab-view .form-group textarea{border-radius:8px!important;border-color:#d5e0eb!important}

    #tab-dashboard .metrics-grid{grid-template-columns:repeat(4,minmax(150px,1fr))!important;gap:8px!important;margin-bottom:14px!important}
    #tab-dashboard .metric-card{min-height:76px!important;padding:11px 13px!important;border-radius:10px!important}
    #tab-dashboard .metric-title{font-size:9px!important;text-transform:none!important;color:#73869b!important}
    #tab-dashboard .metric-value{font-size:21px!important}
    #tab-dashboard .quick-start-grid{gap:7px!important}
    #tab-dashboard .quick-start-action{min-height:54px!important;flex-basis:160px!important;border-radius:9px!important}
    #tab-dashboard .quick-flow{display:none!important}
    #tab-dashboard .data-card:last-child{margin-top:2px!important}
    #tab-dashboard .data-card:last-child .data-header{padding-bottom:9px!important}
    #tab-dashboard .data-card:last-child .data-header h3{font-size:12px!important}
    #tab-dashboard .data-card:last-child table th:nth-child(7),#tab-dashboard .data-card:last-child table td:nth-child(7),
    #tab-dashboard .data-card:last-child table th:nth-child(9),#tab-dashboard .data-card:last-child table td:nth-child(9){display:none!important}

    #tab-nova-os .os-premium-body{display:flex!important;flex-direction:column!important;gap:0!important}
    #tab-nova-os .os-premium-row{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:14px!important}
    #tab-nova-os .os-premium-row-service{grid-template-columns:repeat(3,minmax(0,1fr))!important}
    #tab-nova-os .os-premium-divider{height:1px!important;background:#edf2f7!important;border:0!important}
    #tab-nova-os .os-premium-description{max-width:100%!important}
    #tab-nova-os .os-premium-footer{position:sticky!important;bottom:0!important;background:rgba(255,255,255,.97)!important;backdrop-filter:blur(8px)!important;border-top:1px solid #e5edf5!important}
    #tab-nova-os .os-premium-field:focus-within label,#tab-nova-os .os-premium-description:focus-within label{color:#1769d1!important}
    #tab-nova-os #os-select-cliente{display:none!important}
    #tab-nova-os .os-premium-client:after{content:"Selecione o cliente para liberar os equipamentos vinculados";display:block;font-size:9px;color:#8292a6;margin-top:4px}

    #tab-ordens .data-card{border-radius:10px!important}
    #tab-ordens .data-header{gap:9px!important}
    #tab-ordens table{font-size:11px!important}
    #tab-ordens th{white-space:nowrap!important}
    #tab-ordens td{padding:8px 10px!important}
    #tab-ordens .btn{min-height:29px!important}
    #tab-ordens .badge{border-radius:999px!important;padding:4px 8px!important}
    #tab-ordens .badge-pmoc{background:#eaf4ff!important;color:#1769d1!important}
    #tab-ordens .badge-andamento{background:#fff7df!important;color:#9a6700!important}
    #tab-ordens .badge-concluido{background:#e9f8ef!important;color:#167345!important}

    #tab-atividades>.data-card{border-radius:10px!important}
    #tab-atividades>.data-card:first-child,#tab-atividades>.data-card:nth-child(2){padding:14px!important}
    #tab-atividades .day-toolbar{padding:10px 12px!important;margin-bottom:12px!important}
    #tab-atividades .day-kpi-grid{grid-template-columns:repeat(4,minmax(130px,1fr))!important}
    #tab-atividades .day-kpi{padding:10px 12px!important}
    #tab-atividades .day-kpi strong{font-size:19px!important}
    #tab-atividades .day-table{min-width:960px!important}
    #tab-atividades .history-filter-grid{gap:8px!important}

    #tab-clientes .data-card,#tab-equipamentos .data-card,#tab-tecnicos .data-card,#tab-servicos .data-card,#tab-pecas .data-card,#tab-compras .data-card{border-radius:10px!important}
    #tab-clientes .data-card:first-child,#tab-equipamentos .data-card:first-child,#tab-tecnicos .data-card:first-child,#tab-servicos .data-card:first-child,#tab-pecas .data-card:first-child,#tab-compras .data-card:first-child{padding:14px!important}
    #tab-clientes .data-card:first-child h3,#tab-equipamentos .data-card:first-child h3,#tab-tecnicos .data-card:first-child h3,#tab-servicos .data-card:first-child h3,#tab-pecas .data-card:first-child h3,#tab-compras .data-card:first-child h3{font-size:13px!important}

    .table-scroll{overflow-x:auto!important;-webkit-overflow-scrolling:touch!important}
    @media(max-width:900px){
      #tab-dashboard .metrics-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      #tab-nova-os .os-premium-row,#tab-nova-os .os-premium-row-service{grid-template-columns:1fr!important}
      #tab-atividades .day-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    }
    @media(max-width:640px){
      #tab-dashboard .metrics-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}
      #tab-dashboard .metric-card{min-height:70px!important}
      #tab-dashboard .metric-value{font-size:19px!important}
      #tab-ordens .data-header{align-items:stretch!important}
      #tab-ordens .data-header>div{width:100%!important}
      #tab-ordens .data-header .filter-bar{flex-direction:column!important;align-items:stretch!important}
      #tab-ordens .data-header .filter-bar input,#tab-ordens .data-header .filter-bar select{width:100%!important}
      #tab-atividades .day-kpi-grid{grid-template-columns:1fr 1fr!important}
    }
  `;
  document.head.appendChild(style);

  const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const state=()=>window.ERP_STATE||null;
  const statusKey=s=>norm(s).replace(/\s+/g," ").trim();
  const isDone=s=>/conclu|finaliz/.test(statusKey(s));
  const isCancelled=s=>/cancel/.test(statusKey(s));
  const isActive=s=>/atendimento|campo|despach|execu/.test(statusKey(s));
  const isPending=s=>/pend|aguard|agend/.test(statusKey(s));

  function todayISO(){
    const d=new Date(),p=n=>String(n).padStart(2,"0");
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
  }
  function orderDateISO(o){
    try{if(typeof window.dataOSParaISO==="function")return window.dataOSParaISO(o?.data);}catch(_){}
    const raw=String(o?.data||"").trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
    const m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m?m[3]+"-"+m[2]+"-"+m[1]:"";
  }
  function clientName(o,st){return (st?.clientes||[]).find(c=>String(c.id)===String(o?.clienteId))?.nome||"Cliente não identificado";}
  function techName(o,st){return (st?.tecnicos||[]).find(t=>String(t.id)===String(o?.tecnicoId))?.nome||"Não atribuído";}
  function equipmentName(o,st){const e=(st?.equipamentos||[]).find(x=>String(x.id)===String(o?.equipamentoId));return e?.tag||e?.tipo||"—";}
  function timeOf(o){return o?.horario||o?.hora||o?.horaInicio||"";}

  function ensureDashboardOperational(){
    const tab=document.getElementById("tab-dashboard");if(!tab)return;
    let panel=document.getElementById("dbs-dashboard-operational");
    if(!panel){panel=document.createElement("section");panel.id="dbs-dashboard-operational";panel.className="dbs-dashboard-operational";const quick=tab.querySelector(".quick-start-card");if(quick)quick.insertAdjacentElement("afterend",panel);else tab.insertBefore(panel,tab.firstElementChild);}
    const st=state();if(!st)return;
    const orders=Array.isArray(st.ordens)?st.ordens:[];
    const today=todayISO();
    const todayOrders=orders.filter(o=>orderDateISO(o)===today);
    const attention=orders.filter(o=>{
      if(isCancelled(o.status))return false;
      if(isDone(o.status))return !String(o.assinatura||"").trim()||(!String(o.diagnostico||"").trim()&&!String(o.relatoTecnico||"").trim())||!String(o.trabalhoExecutado||"").trim();
      return isPending(o.status)||isActive(o.status)||!o.status;
    }).slice(0,6);
    const todayRows=todayOrders.slice().sort((a,b)=>String(timeOf(a)).localeCompare(String(timeOf(b)))).slice(0,8);
    const rowHtml=todayRows.length?todayRows.map(o=>{
      const stt=String(o.status||"Pendente"),statusClass=isDone(stt)?"done":(isActive(stt)?"active":(isPending(stt)?"pending":"neutral"));
      return `<tr><td><strong>${esc(o.id)}</strong></td><td>${esc(clientName(o,st))}</td><td>${esc(techName(o,st))}</td><td>${esc(equipmentName(o,st))}</td><td>${esc(timeOf(o)||"—")}</td><td><span class="dbs-op-status ${statusClass}">${esc(stt)}</span></td><td style="text-align:right"><button class="btn btn-secondary btn-sm dbs-op-open" data-os="${esc(o.id)}">Abrir OS</button></td></tr>`;
    }).join(""):`<tr><td colspan="7" style="padding:24px;text-align:center;color:#718096">Nenhum atendimento registrado para hoje.</td></tr>`;
    const attentionHtml=attention.length?attention.map(o=>{
      const reasons=[];
      if(isDone(o.status)){if(!String(o.assinatura||"").trim())reasons.push("assinatura");if(!String(o.diagnostico||"").trim()&&!String(o.relatoTecnico||"").trim())reasons.push("diagnóstico");if(!String(o.trabalhoExecutado||"").trim())reasons.push("execução");}
      else reasons.push(String(o.status||"pendente"));
      return `<button type="button" class="dbs-op-attention" data-os="${esc(o.id)}"><span><strong>OS ${esc(o.id)}</strong><small>${esc(clientName(o,st))}</small></span><span>${esc(reasons.join(" · "))}</span></button>`;
    }).join(""):`<div class="dbs-op-empty">Nenhuma pendência crítica identificada.</div>`;
    panel.innerHTML=`
      <div class="dbs-op-main"><div class="dbs-op-heading"><div><span class="dbs-op-eyebrow">OPERAÇÃO DE HOJE</span><h2>Atendimentos de hoje</h2></div><button type="button" class="btn btn-secondary btn-sm" id="dbs-op-refresh">Atualizar</button></div><div class="dbs-op-table"><table><thead><tr><th>OS</th><th>Cliente</th><th>Técnico</th><th>Ativo</th><th>Horário</th><th>Status</th><th></th></tr></thead><tbody>${rowHtml}</tbody></table></div></div>
      <aside class="dbs-op-side"><div class="dbs-op-heading"><div><span class="dbs-op-eyebrow">CONFERÊNCIA</span><h2>Atenção necessária</h2></div></div>${attentionHtml}</aside>`;
    panel.querySelectorAll(".dbs-op-open,.dbs-op-attention").forEach(btn=>{btn.onclick=()=>{const id=btn.getAttribute("data-os");if(typeof window.openOsDetail==="function"){window.openOsDetail(id);return;}if(typeof window.abrirHistoricoOS==="function"){window.abrirHistoricoOS(id);return;}if(typeof window.switchTab==="function")window.switchTab("tab-ordens");};});
    panel.querySelector("#dbs-op-refresh")?.addEventListener("click",ensureDashboardOperational);
  }

  function updateDashboardKpis(){
    const st=state();if(!st)return;
    const orders=Array.isArray(st.ordens)?st.ordens:[];
    const open=orders.filter(o=>!isDone(o.status)&&!isCancelled(o.status)).length;
    const active=orders.filter(o=>isActive(o.status)).length;
    const done=orders.filter(o=>isDone(o.status)).length;
    const pending=orders.filter(o=>isPending(o.status)||!o.status).length;
    [["dash-client-count","OS abertas",open],["dash-equip-count","Em atendimento",active],["dash-os-andamento","OS concluídas",done],["dash-os-concluidas","Pendentes",pending]].forEach(([id,label,value])=>{
      const card=document.getElementById(id)?.closest(".metric-card");if(!card)return;
      const title=card.querySelector(".metric-title"),valueEl=document.getElementById(id);
      if(title)title.textContent=label;if(valueEl)valueEl.textContent=String(value);
    });
  }

  function normalizeStatusBadges(){
    document.querySelectorAll("#tab-ordens .badge,#tab-dashboard .badge,#tab-atividades .day-status").forEach(el=>{
      const txt=String(el.textContent||"").trim();
      el.classList.remove("dbs-status-open","dbs-status-active","dbs-status-done","dbs-status-pending","dbs-status-cancelled");
      if(isDone(txt))el.classList.add("dbs-status-done");else if(isCancelled(txt))el.classList.add("dbs-status-cancelled");else if(isActive(txt))el.classList.add("dbs-status-active");else if(isPending(txt))el.classList.add("dbs-status-pending");else el.classList.add("dbs-status-open");
    });
  }

  function compactSectionHeadings(){
    document.querySelectorAll(".tab-view").forEach(tab=>tab.querySelectorAll(":scope>h3").forEach(h=>{h.style.fontSize="13px";h.style.marginBottom="6px";}));
  }
  function refreshLayer(){try{updateDashboardKpis();ensureDashboardOperational();normalizeStatusBadges();compactSectionHeadings();}catch(e){console.warn("DBS operational UX",e);}}

  if(typeof window.renderizarTudo==="function"&&!window.__dbsOperationalRenderWrapped){
    const original=window.renderizarTudo;
    window.renderizarTudo=function(){const result=original.apply(this,arguments);setTimeout(refreshLayer,0);return result;};
    window.__dbsOperationalRenderWrapped=true;
  }
  if(typeof window.switchTab==="function"&&!window.__dbsOperationalSwitchWrapped){
    const original=window.switchTab;
    window.switchTab=function(){const result=original.apply(this,arguments);setTimeout(refreshLayer,0);return result;};
    window.__dbsOperationalSwitchWrapped=true;
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",refreshLayer);else refreshLayer();
  setTimeout(refreshLayer,250);setTimeout(refreshLayer,900);
})();
