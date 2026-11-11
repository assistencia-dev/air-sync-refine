/* DBS Control — visualização interna da OS (somente leitura do ERP_STATE hidratado).
   Não grava dados: as ações chamam as funções já existentes da página. */
(function () {
  'use strict';
  const S = () => (typeof ERP_STATE !== 'undefined' ? ERP_STATE : window.ERP_STATE) || {};
  const L = v => (Array.isArray(v) ? v : []);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const first = (...v) => v.find(x => x !== undefined && x !== null && String(x).trim() !== '');
  const find = (rows, id) => (id == null ? null : L(rows).find(r => [r.id, r.employeeId].some(k => k != null && String(k) === String(id))));
  const fmt = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('pt-BR'); };
  const isImg = s => /^data:image\//i.test(s) || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(s);
  const isPdf = s => /^data:application\/pdf/i.test(s) || /\.pdf(\?|#|$)/i.test(s);
  const srcOf = it => typeof it === 'string' ? it : first(it?.url, it?.dataUrl, it?.data_url, it?.src, it?.signedUrl, it?.signed_url, it?.public_url, it?.publicUrl, it?.data, it?.base64);
  const nameOf = (it, i) => (typeof it === 'object' && first(it?.name, it?.nome, it?.file_name, it?.fileName, it?.titulo, it?.path)) || `Anexo ${i + 1}`;
  const typeOf = it => (typeof it === 'object' && first(it?.type, it?.mime, it?.mime_type, it?.content_type)) || '';

  function css() {
    if (document.getElementById('osv-style')) return;
    const st = document.createElement('style'); st.id = 'osv-style';
    st.textContent = `
.osv-back{position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;justify-content:flex-end}
.osv{background:#fff;width:min(920px,100%);height:100%;display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(15,47,87,.25);color:#0f172a}
.osv-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#0f2f57;color:#fff}
.osv-head h2{margin:0;font-size:20px;line-height:1.2}.osv-head p{margin:4px 0 0;font-size:13px;opacity:.85}
.osv-close{min-width:44px;min-height:44px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;font-size:22px;cursor:pointer}
.osv-bar{display:flex;flex-wrap:wrap;gap:8px;padding:10px 20px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
.osv-bar button{min-height:40px;padding:0 14px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;color:#0f2f57;font-weight:700;cursor:pointer}
.osv-bar button.pri{background:#0284c7;border-color:#0284c7;color:#fff}.osv-bar button.warn{color:#b91c1c}
.osv-bar button:focus-visible,.osv-close:focus-visible,.osv-thumb:focus-visible{outline:3px solid #38bdf8;outline-offset:2px}
.osv-body{flex:1;overflow:auto;padding:18px 20px 40px}
.osv-sec{margin:0 0 18px}.osv-sec h3{margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#0284c7}
.osv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px 18px}
.osv-f small{display:block;font-size:11px;color:#64748b;font-weight:700}.osv-f div{font-size:14px;word-break:break-word}
.osv-text{white-space:pre-wrap;font-size:14px;line-height:1.5;background:#f8fafc;border-left:3px solid #0284c7;padding:10px 12px;border-radius:6px;margin-bottom:8px}
.osv-text b{display:block;font-size:11px;color:#64748b;margin-bottom:3px}
.osv-chip{display:inline-block;padding:3px 10px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:12px;font-weight:800}
.osv-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.osv-thumb{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#f1f5f9;cursor:zoom-in;padding:0;text-align:left}
.osv-thumb img{display:block;width:100%;height:110px;object-fit:cover}.osv-thumb span{display:block;padding:6px 8px;font-size:12px;color:#334155}
.osv-list{list-style:none;margin:0;padding:0}.osv-list li{display:flex;gap:8px;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
.osv-list button,.osv-list a{min-height:36px;padding:0 12px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#0f2f57;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.osv-sig{max-width:320px;max-height:140px;border:1px solid #e2e8f0;border-radius:8px;background:#fff}
.osv-empty{color:#64748b;font-size:13px}
.osv-lb{position:fixed;inset:0;z-index:9100;background:rgba(2,6,23,.92);display:flex;flex-direction:column}
.osv-lb-top{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;color:#fff;gap:8px}
.osv-lb-top button,.osv-lb-nav{min-width:44px;min-height:44px;border:0;border-radius:10px;background:rgba(255,255,255,.15);color:#fff;font-size:20px;cursor:pointer}
.osv-lb-main{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 8px 12px;min-height:0}
.osv-lb-main img{max-width:100%;max-height:100%;object-fit:contain}.osv-lb-main iframe{width:100%;height:100%;border:0;background:#fff;border-radius:6px}
@media (max-width:640px){.osv{width:100%}.osv-head{padding:12px 14px}.osv-body{padding:14px}.osv-bar{padding:8px 14px}.osv-bar button{flex:1 1 calc(50% - 8px)}}`;
    document.head.appendChild(st);
  }

  function lightbox(items, index) {
    let i = index;
    const lb = document.createElement('div'); lb.className = 'osv-lb'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
    const draw = () => {
      const it = items[i];
      const body = it.kind === 'pdf' ? `<iframe src="${esc(it.src)}" title="${esc(it.name)}"></iframe>` : `<img src="${esc(it.src)}" alt="${esc(it.name)}">`;
      lb.innerHTML = `<div class="osv-lb-top"><span>${esc(it.name)}${items.length > 1 ? ` · ${i + 1}/${items.length}` : ''}</span><span><a href="${esc(it.src)}" download="${esc(it.name)}" style="color:#fff;margin-right:10px">Baixar</a><button type="button" data-x aria-label="Fechar">×</button></span></div>
      <div class="osv-lb-main">${items.length > 1 ? '<button class="osv-lb-nav" data-p aria-label="Anterior">‹</button>' : ''}${body}${items.length > 1 ? '<button class="osv-lb-nav" data-n aria-label="Próximo">›</button>' : ''}</div>`;
      lb.querySelector('[data-x]').focus();
    };
    const close = () => { lb.remove(); document.removeEventListener('keydown', key, true); };
    const move = d => { i = (i + d + items.length) % items.length; draw(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else if (e.key === 'ArrowRight') move(1); else if (e.key === 'ArrowLeft') move(-1); };
    lb.addEventListener('click', e => { if (e.target.closest('[data-x]') || e.target === lb) close(); else if (e.target.closest('[data-n]')) move(1); else if (e.target.closest('[data-p]')) move(-1); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(lb); draw();
  }

  async function pdfUrl(osId) {
    if (typeof gerarPDFObjeto !== 'function') throw new Error('Gerador de PDF indisponível.');
    const options = typeof escolherModeloPdf === 'function' ? await escolherModeloPdf() : { model: 'tecnica', includeValues: false };
    if (!options) return null;
    const doc = await gerarPDFObjeto(osId, options);
    return doc ? doc.output('bloburl') : null;
  }

  function open(osId) {
    css();
    const st = S();
    const o = L(st.ordens).find(r => String(r.id) === String(osId) || String(r.protocolo || '') === String(osId));
    if (!o) { alert('OS não encontrada na base carregada. Atualize a tela e tente novamente.'); return; }
    const cli = find(st.clientes, first(o.clienteId, o.client_id, o.clientId)) || {};
    const site = find(st.locais || st.sites || st.unidades, first(o.siteId, o.localId, o.site_id)) || {};
    const srv = find(st.servicos, first(o.servicoId, o.service_id)) || {};
    const tec = find(st.tecnicos, first(o.tecnicoId, o.employeeId, o.assigned_employee_id)) || {};
    let eqs = [];
    try { eqs = window.DbsControlPdf?.equipment ? L(window.DbsControlPdf.equipment(st, o)) : []; } catch (_) { eqs = []; }
    if (!eqs.length) eqs = L(o.equipamentoIds).concat(o.equipamentoId ? [o.equipamentoId] : []).map(id => find(st.equipamentos, id)).filter(Boolean);
    eqs = eqs.filter((e, i, a) => a.findIndex(x => String(x.id) === String(e.id)) === i);

    const F = (label, v) => (v == null || String(v).trim() === '' ? '' : `<div class="osv-f"><small>${esc(label)}</small><div>${esc(v)}</div></div>`);
    const T = (label, v) => (v == null || String(v).trim() === '' ? '' : `<div class="osv-text"><b>${esc(label)}</b>${esc(v)}</div>`);
    const sec = (title, inner) => (inner && inner.trim() ? `<section class="osv-sec"><h3>${esc(title)}</h3>${inner}</section>` : '');

    const media = [];
    if (o.fotoAntes) media.push({ src: srcOf(o.fotoAntes), name: 'Foto antes', kind: 'img' });
    if (o.fotoDepois) media.push({ src: srcOf(o.fotoDepois), name: 'Foto depois', kind: 'img' });
    L(o.fotos).forEach((f, i) => { const s = srcOf(f); if (s) media.push({ src: s, name: nameOf(f, i).replace(/^Anexo/, 'Foto'), kind: 'img' }); });
    const docs = [];
    [...L(o.anexos), ...L(o.attachments), ...L(o.fieldControlDetails?.attachments)].forEach((a, i) => {
      const s = srcOf(a); const n = nameOf(a, i); const t = typeOf(a);
      if (s && (isImg(s) || /^image\//.test(t))) media.push({ src: s, name: n, kind: 'img' });
      else docs.push({ src: s, name: n, kind: s && (isPdf(s) || /pdf/.test(t)) ? 'pdf' : 'other' });
    });
    const sig = srcOf(first(o.assinatura, o.signature_data, o.signatureData, o.assinatura_url, o.signature_url));
    const sigT = srcOf(first(o.assinaturaTecnico, o.technician_signature));
    const checklist = L(o.checklist).filter(c => c && first(c.item, c.label, c.nome, c.descricao, typeof c === 'string' ? c : ''));
    const pecas = L(first(o.pecas, o.pecasUtilizadas, o.materiais, o.parts));
    const hist = L(st.osHistorico).filter(h => String(h.osId) === String(o.id)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const concl = typeof isOSConcluida === 'function' ? isOSConcluida(o) : /conclu/i.test(o.status || '');
    const s = String(o.status || '').trim();
    const canAct = !concl && !/cancelad/i.test(s) && !o.arquivadaEm;
    const pend = /\[PENDÊNCIA OPERACIONAL[^\]]*\][^\n]*/i.exec(String(o.observacao || o.observacaoTecnico || o.observacaoComplementarTecnico || ''));

    const html = [
      sec('Atendimento', `<div class="osv-grid">${F('Status', o.status)}${F('Tipo', o.tipo)}${F('Prioridade', first(o.prioridade, o.priority))}${F('SLA', o.sla)}${F('Data', o.data)}${F('Início', fmt(o.startedAt))}${F('Conclusão', fmt(first(o.concluidoEm, o.completedAt)))}${F('Técnico', first(tec.nome, o.tecnicoNome))}${F('Serviço', first(srv.nome, srv.descricao, o.servicoNome))}</div>`),
      sec('Cliente e local', `<div class="osv-grid">${F('Cliente', cli.nome)}${F('CNPJ/CPF', cli.cnpj)}${F('Contato', first(cli.contato, o.contatoNome))}${F('Telefone', first(cli.telefone, cli.phone))}${F('Local de atendimento', first(o.localAtendimento, site.nome))}${F('Endereço', first(site.endereco, o.endereco, cli.endereco))}</div>`),
      sec(`Equipamentos (${eqs.length})`, eqs.length ? `<ul class="osv-list">${eqs.map(e => `<li><span><strong>${esc(first(e.tag, 'S/N'))}</strong> ${esc([e.tipo, e.marca, e.modelo, e.capacidade].filter(Boolean).join(' · '))}${e.ambiente ? `<br><small style="color:#64748b">${esc(e.ambiente)}</small>` : ''}${e.serie ? ` <small style="color:#64748b">Série ${esc(e.serie)}</small>` : ''}</span></li>`).join('')}</ul>` : ''),
      sec('Descrição e execução', T('Solicitação / problema', first(o.desc, o.descricao)) + T('Relato técnico', o.relatoTecnico) + T('Diagnóstico', o.diagnostico) + T('Trabalho executado', o.trabalhoExecutado) + T('Observação', o.observacao) + T('Observação técnica', first(o.observacaoTecnico, o.observacaoComplementarTecnico))),
      pend ? sec('Pendência', `<div class="osv-text" style="border-color:#f59e0b">${esc(pend[0])}</div>`) : '',
      sec('Checklist', checklist.length ? `<ul class="osv-list">${checklist.map(c => `<li><span>${esc(typeof c === 'string' ? c : first(c.item, c.label, c.nome, c.descricao))}</span><span class="osv-chip">${c.ok || c.done || c.checked || c.concluido ? '✓ Conferido' : 'Pendente'}</span></li>`).join('')}</ul>` : ''),
      sec('Peças e materiais', pecas.length ? `<ul class="osv-list">${pecas.map(p => `<li><span>${esc(typeof p === 'string' ? p : first(p.nome, p.descricao, p.name, p.item))}</span><span>${esc(typeof p === 'object' ? first(p.qtd, p.quantidade, p.quantity, '') : '')}</span></li>`).join('')}</ul>` : ''),
      sec('Itens Previstos (Contrato/Orçamento)', '<div id="osv-planned-items" class="osv-empty">Carregando itens previstos…</div>'),
      sec(`Fotografias (${media.length})`, media.length ? `<div class="osv-gal">${media.map((m, i) => `<button type="button" class="osv-thumb" data-media="${i}"><img src="${esc(m.src)}" alt="${esc(m.name)}" loading="lazy"><span>${esc(m.name)}</span></button>`).join('')}</div>` : ''),
      sec(`Documentos e anexos (${docs.length})`, docs.length ? `<ul class="osv-list">${docs.map((d, i) => `<li><span>${esc(d.name)}</span>${d.kind === 'pdf' ? `<button type="button" data-doc="${i}">Visualizar</button>` : d.src ? `<a href="${esc(d.src)}" target="_blank" rel="noopener" download="${esc(d.name)}">Abrir</a>` : '<span class="osv-empty">Arquivo indisponível</span>'}</li>`).join('')}</ul>` : ''),
      sec('Assinaturas', (sig ? `<div class="osv-f" style="margin-bottom:10px"><small>Cliente${o.assinaturaNome ? ' · ' + esc(o.assinaturaNome) : ''}${o.assinaturaEm ? ' · ' + esc(fmt(o.assinaturaEm)) : ''}</small><img class="osv-sig" src="${esc(sig)}" alt="Assinatura do cliente"></div>` : '') + (sigT ? `<div class="osv-f"><small>Técnico${o.assinaturaTecnicoNome ? ' · ' + esc(o.assinaturaTecnicoNome) : ''}</small><img class="osv-sig" src="${esc(sigT)}" alt="Assinatura do técnico"></div>` : '')),
      sec(`Histórico (${hist.length})`, hist.length ? `<ul class="osv-list">${hist.map(h => `<li><span><strong>${esc(h.evento)}</strong>${h.detalhe ? `<br><small style="color:#64748b">${esc(h.detalhe)}</small>` : ''}</span><small style="white-space:nowrap;color:#64748b">${esc(fmt(h.createdAt))}</small></li>`).join('')}</ul>` : '')
    ].join('');

    const back = document.createElement('div'); back.className = 'osv-back';
    const prevFocus = document.activeElement;
    back.innerHTML = `<div class="osv" role="dialog" aria-modal="true" aria-labelledby="osv-title">
      <div class="osv-head"><div><h2 id="osv-title">${/^OS/i.test(String(o.id)) ? "" : "OS "}${esc(o.id)}${o.protocolo && o.protocolo !== o.id ? ' · ' + esc(o.protocolo) : ''}</h2><p>${esc([cli.nome, o.status].filter(Boolean).join(' · '))}</p></div><button type="button" class="osv-close" data-close aria-label="Fechar visualização">×</button></div>
      <div class="osv-bar">
        <button type="button" class="pri" data-act="preview">Ver PDF</button>
        <button type="button" data-act="print">Imprimir</button>
        <button type="button" data-act="download">Baixar PDF</button>
        ${typeof abrirHistoricoOS === 'function' ? '<button type="button" data-act="history">Histórico completo</button>' : ''}
        ${canAct && typeof transicionarStatusOS === 'function' ? `${['Pendente', 'Aguardando peça', 'Aguardando cliente'].includes(s) ? '<button type="button" data-status="Em Atendimento">Iniciar atendimento</button>' : ''}<button type="button" data-status="Concluída">Concluir OS</button><button type="button" class="warn" data-status="Cancelada">Cancelar OS</button>` : ''}
      </div>
      <div class="osv-body">${html || '<p class="osv-empty">Esta OS não tem detalhes preenchidos.</p>'}</div></div>`;
    const plannedId = String(o.work_order_id || o.workOrderId || o.id || '');
    const plannedRequestId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'planned-' + Date.now();
    const plannedBody = back.querySelector('#osv-planned-items');
    const renderPlanned = items => {
      if (!plannedBody) return;
      if (!Array.isArray(items) || !items.length) {
        plannedBody.innerHTML = '<span class="osv-empty">Nenhum item previsto vinculado a esta OS.</span>';
        return;
      }
      plannedBody.innerHTML = '<ul class="osv-list">' + items.map(it =>
        '<li><span><strong>' + esc(it.description || 'Item') + '</strong><br><small>' +
        esc(String(it.quantity ?? '') + (it.measure_unit ? ' ' + it.measure_unit : '')) +
        (it.item_type === 'manual' ? ' · item manual' : '') + '</small></span><span class="osv-chip">' +
        esc(it.installation_confirmed ? 'Confirmado' : it.reservation_status === 'reserved' ? 'Reservado' : it.reservation_status === 'consumed' ? 'Consumido' : 'Previsto') +
        '</span></li>').join('') + '</ul>' +
        (items.some(it => !it.installation_confirmed) ? '<button type="button" class="pri" data-confirm-install style="margin-top:12px;min-height:44px;padding:0 16px;border:0;border-radius:9px;background:#0284c7;color:#fff;font-weight:800">Confirmar Instalação</button>' : '');
    };
    const plannedMessage = event => {
      if (event.source !== window.parent || !event.data) return;
      const msg = event.data;
      if (msg.requestId !== plannedRequestId) return;
      if (msg.type === 'DBS_CONTROL_QUOTE_ITEMS_RESULT') {
        if (!msg.ok) { if (plannedBody) plannedBody.textContent = msg.error || 'Não foi possível carregar os itens previstos.'; return; }
        renderPlanned(msg.items);
      }
      if (msg.type === 'DBS_CONTROL_QUOTE_INSTALLATION_RESULT') {
        if (plannedBody) plannedBody.textContent = msg.ok ? 'Instalação confirmada. Atualizando itens…' : (msg.error || 'Não foi possível confirmar a instalação.');
        if (msg.ok) window.parent.postMessage({ type: 'DBS_CONTROL_QUOTE_ITEMS', workOrderId: plannedId, requestId: plannedRequestId }, '*');
      }
    };
    window.addEventListener('message', plannedMessage);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(plannedId)) {
      window.parent.postMessage({ type: 'DBS_CONTROL_QUOTE_ITEMS', workOrderId: plannedId, requestId: plannedRequestId }, '*');
    } else if (plannedBody) {
      plannedBody.textContent = 'Vínculo relacional da OS ainda não disponível.';
    }
    const close = () => { window.removeEventListener('message', plannedMessage); back.remove(); document.removeEventListener('keydown', key); prevFocus?.focus?.(); };
    const key = e => { if (e.key === 'Escape' && !document.querySelector('.osv-lb')) close(); };
    const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = 'Gerando…'; try { await fn(); } catch (err) { alert(err instanceof Error ? err.message : 'Não foi possível gerar o PDF.'); } finally { btn.disabled = false; btn.textContent = t; } };
    back.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (e.target === back || e.target.closest('[data-close]')) return close();
      if (!b) return;
      if (b.hasAttribute('data-confirm-install')) {
        b.disabled = true; b.textContent = 'Confirmando…';
        window.parent.postMessage({ type: 'DBS_CONTROL_CONFIRM_QUOTE_INSTALLATION', workOrderId: plannedId, requestId: plannedRequestId }, '*');
        return;
      }
      if (b.dataset.media != null) return lightbox(media, Number(b.dataset.media));
      if (b.dataset.doc != null) { const pdfs = docs.filter(d => d.kind === 'pdf'); return lightbox(pdfs, pdfs.indexOf(docs[Number(b.dataset.doc)])); }
      if (b.dataset.status) { close(); return transicionarStatusOS(o.id, b.dataset.status); }
      const act = b.dataset.act;
      if (act === 'history') return abrirHistoricoOS(o.id);
      if (act === 'download') return baixarPDFIndividual(o.id);
      if (act === 'preview') return busy(b, async () => { const u = await pdfUrl(o.id); if (u) lightbox([{ src: u, name: `OS ${o.id}.pdf`, kind: 'pdf' }], 0); });
      if (act === 'print') return busy(b, async () => {
        const u = await pdfUrl(o.id); if (!u) return;
        const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'; f.src = u;
        f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { window.open(u, '_blank'); } setTimeout(() => f.remove(), 60000); };
        document.body.appendChild(f);
      });
    });
    document.addEventListener('keydown', key);
    document.body.appendChild(back);
    back.querySelector('[data-close]').focus();
  }

  window.abrirVisualizacaoOS = open;
})();
