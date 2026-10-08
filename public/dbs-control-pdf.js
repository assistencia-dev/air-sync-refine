/* DBS AIR — single OS document renderer. No storage reads or writes. */
(function () {
  'use strict';
  const theme = { blue: [2, 132, 199], navy: [15, 47, 87], ink: [31, 41, 55], muted: [100, 116, 139], line: [214, 222, 231], soft: [243, 248, 252] };
  const logoUrl = '/__l5e/assets-v1/4588320a-68f8-4932-9a72-8f318ecd3268/logo-dbs-air.jpg';
  let resources;
  const list = v => Array.isArray(v) ? v.filter(Boolean) : [];
  const clean = v => v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).trim();
  const present = v => clean(v) !== '';
  const unique = values => [...new Set(values.map(clean).filter(Boolean))].join(' · ');
  const date = v => {
    const s = clean(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
    if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString('pt-BR');
  };
  const number = v => {
    if (!present(v)) return null;
    const s = clean(v).replace(/R\$\s*/g, '').trim();
    const n = typeof v === 'number' ? v : Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
    return Number.isFinite(n) ? n : null;
  };
  const money = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const lookup = (rows, id) => present(id) ? list(rows).find(x => String(x.id) === String(id)) || {} : {};
  const address = v => typeof v === 'object' && v ? unique([v.street || v.logradouro, v.number || v.numero, v.complement || v.complemento, v.neighborhood || v.bairro, v.city || v.cidade, v.state || v.uf, v.zipCode || v.cep]) : clean(v);
  function base64(buffer) {
    const bytes = new Uint8Array(buffer); let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }
  async function fetchFont(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Não foi possível carregar as fontes do documento. Tente novamente.');
    return base64(await r.arrayBuffer());
  }
  async function image(source, label) {
    const src = typeof source === 'object' ? source.data || source.url || source.storage_path || source.src : source;
    if (!present(src)) throw new Error('O arquivo de ' + label + ' não possui endereço disponível para exportação.');
    let resolved = clean(src);
    if (!/^(data:|blob:|https?:|\/)/i.test(resolved) && /^[A-Za-z0-9+/=\s]+$/.test(resolved)) resolved = 'data:image/png;base64,' + resolved;
    return new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error('O carregamento de ' + label + ' demorou demais. Tente novamente.')), 15000);
      if (!resolved.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width || !canvas.height) throw new Error('Imagem inválida');
          ctx.drawImage(img, 0, 0);
          resolve({ data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        } catch (_) { reject(new Error('Não foi possível incluir ' + label + ' no PDF. Verifique o arquivo ou sua permissão de acesso.')); }
      };
      img.onerror = () => { clearTimeout(timer); reject(new Error('Não foi possível carregar ' + label + '. O PDF não foi gerado para evitar omitir a evidência.')); };
      img.src = resolved;
    });
  }
  function prepare() {
    if (!resources) resources = Promise.all([
      fetchFont('/fonts/dbs-document-regular.ttf'), fetchFont('/fonts/dbs-document-bold.ttf'), image(logoUrl, 'logo DBS AIR')
    ]).catch(error => { resources = null; throw error; });
    return resources;
  }
  function equipment(state, o) {
    const embedded = list(o.equipamentos);
    const refs = [...list(o.equipamentoIds), ...(present(o.equipamentoId) ? [o.equipamentoId] : []), ...embedded];
    const seen = new Set();
    return refs.map(ref => {
      const id = typeof ref === 'object' ? ref.id : ref;
      const master = lookup(state.equipamentos, id);
      const row = typeof ref === 'object' ? { ...master, ...ref } : Object.keys(master).length ? master : { id };
      const key = clean(id) || JSON.stringify(row);
      if (seen.has(key)) return null;
      seen.add(key); return row;
    }).filter(Boolean);
  }
  async function generate(state, id) {
    const current = list(state?.ordens).find(x => String(x.id) === String(id));
    if (!current) throw new Error('A Ordem de Serviço não está disponível na base carregada.');
    // Freeze this representation before asynchronous font/image reads; never mutate ERP_STATE.
    const st = JSON.parse(JSON.stringify(state));
    const o = list(st.ordens).find(x => String(x.id) === String(id));
    const cli = lookup(st.clientes, o.clienteId), srv = lookup(st.servicos, o.servicoId);
    const tec = Object.keys(lookup(st.tecnicos, o.tecnicoId)).length ? lookup(st.tecnicos, o.tecnicoId) : list(st.tecnicos).find(t => present(o.employeeId) && String(t.employeeId) === String(o.employeeId)) || {};
    const site = lookup(st.locais || st.sites || st.unidades, o.siteId || o.localId);
    const eqs = equipment(st, o);
    const [regular, bold, logo] = await prepare();
    const photos = [
      ...(o.fotoAntes ? [{ source: o.fotoAntes, label: 'Antes do atendimento' }] : []),
      ...(o.fotoDepois ? [{ source: o.fotoDepois, label: 'Depois do atendimento' }] : [])
    ];
    const attachments = [...list(o.anexos), ...list(o.attachments), ...list(o.fieldControlDetails?.attachments)];
    for (const a of attachments) {
      const url = typeof a === 'string' ? a : a.url || a.file_url || a.data || a.src;
      const type = clean(a.file_type || a.type || a.mimeType || a.contentType);
      if (url && (type.startsWith('image/') || /^data:image\//i.test(url) || /\.(png|jpe?g|webp)(\?|$)/i.test(url))) photos.push({ source: url, label: a.file_name || a.name || a.title || 'Anexo fotográfico' });
    }
    const signatures = [
      ...(o.assinatura ? [{ source: o.assinatura, label: 'Assinatura / aceite do cliente', name: o.assinaturaNome || o.signature_name || o.nomeAssinante, at: o.assinaturaEm }] : []),
      ...(o.assinaturaTecnico ? [{ source: o.assinaturaTecnico, label: 'Assinatura do responsável técnico', name: o.assinaturaTecnicoNome || tec.nome, at: o.assinaturaTecnicoEm }] : [])
    ];
    const media = await Promise.all([...photos, ...signatures].map(async p => ({ ...p, img: await image(p.source, p.label) })));
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    doc.addFileToVFS('DBS-Regular.ttf', regular); doc.addFont('DBS-Regular.ttf', 'DBS', 'normal');
    doc.addFileToVFS('DBS-Bold.ttf', bold); doc.addFont('DBS-Bold.ttf', 'DBS', 'bold');
    const M = 15, W = 180, bottom = 278;
    const protocol = clean(o.protocolo || o.protocol || o.id);
    doc.setProperties({ title: 'DBS AIR · Ordem de Serviço ' + protocol, subject: 'Registro do atendimento', author: 'DBS AIR', creator: 'DBS Control' });
    let y = 15, sectionNumber = 0;
    const font = (size = 9, weight = 'normal', color = theme.ink) => { doc.setFont('DBS', weight); doc.setFontSize(size); doc.setTextColor(...color); };
    const lines = (value, width = W, size = 9, weight = 'normal') => { font(size, weight); return doc.splitTextToSize(clean(value), width); };
    const line = (at, color = theme.line) => { doc.setDrawColor(...color); doc.setLineWidth(0.25); doc.line(M, at, M + W, at); };
    function header(first) {
      if (first) {
        doc.addImage(logo.data, 'PNG', M, 12, 42, 42 * logo.height / logo.width);
        font(8, 'bold', theme.navy); doc.text('DBS AIR', M, 35);
        font(7.3, 'normal', theme.muted); doc.text('DBS Control · Atendimento técnico', M, 40);
        font(13, 'bold', theme.navy); doc.text('ORDEM DE SERVIÇO', 195, 18, { align: 'right' });
        const pl = lines('Nº ' + protocol, 119, 10, 'bold'); doc.text(pl, 195, 25, { align: 'right' });
        const meta = lines(unique([o.tipo, o.status]), 119, 8); doc.text(meta, 195, 25 + pl.length * 4.5 + 2, { align: 'right' });
        y = Math.max(47, 25 + pl.length * 4.5 + meta.length * 4 + 7);
      } else {
        font(8, 'bold', theme.navy); doc.text('DBS AIR · ORDEM DE SERVIÇO', M, 15);
        const pl = lines(protocol, 90, 7.5); doc.text(pl, 195, 15, { align: 'right' }); y = 21 + Math.max(0, pl.length - 1) * 4;
      }
      line(y, theme.blue); y += 8;
    }
    const next = () => { doc.addPage(); header(false); };
    const ensure = h => { if (y + h > bottom) next(); };
    function section(title, minimum = 20) {
      ensure(12 + minimum); sectionNumber++;
      font(8.7, 'bold', theme.navy); doc.text(String(sectionNumber).padStart(2, '0') + '  ' + title.toUpperCase(), M, y);
      y += 3; line(y); y += 6;
    }
    function block(label, value) {
      if (!present(value)) return;
      const text = lines(value); ensure(13);
      font(7.2, 'bold', theme.muted); doc.text(label.toUpperCase(), M, y); y += 5;
      for (const row of text) {
        if (y + 4.5 > bottom) { next(); font(7, 'bold', theme.muted); doc.text(label.toUpperCase() + ' · CONTINUAÇÃO', M, y); y += 5; }
        font(); doc.text(row, M, y); y += 4.5;
      }
      y += 4;
    }
    function pair(left, right) {
      const cells = [left, right].filter(x => present(x[1]));
      if (!cells.length) return;
      const widths = cells.length === 2 ? [87, 87] : [W];
      const wrapped = cells.map((c, i) => lines(c[1], widths[i], 8.8));
      const height = 8 + Math.max(...wrapped.map(x => x.length)) * 4.4;
      if (height > 200) { cells.forEach(c => block(...c)); return; }
      ensure(height);
      cells.forEach((c, i) => { const x = M + i * 93; font(7, 'bold', theme.muted); doc.text(c[0].toUpperCase(), x, y); font(8.8); doc.text(wrapped[i], x, y + 4.8); });
      y += height;
    }
    function table(headers, rows, widths) {
      function tableHead() {
        ensure(12); doc.setFillColor(...theme.soft); doc.rect(M, y - 3, W, 8, 'F'); let x = M;
        headers.forEach((h, i) => { font(7, 'bold', theme.navy); doc.text(h, x + 2, y + 2); x += widths[i]; }); y += 9;
      }
      tableHead();
      rows.forEach(row => {
        const cells = row.map((v, i) => lines(v, widths[i] - 4, 8));
        const count = Math.max(1, ...cells.map(x => x.length)); let offset = 0;
        while (offset < count) {
          if (y + 9 > bottom) { next(); tableHead(); }
          const capacity = Math.max(1, Math.floor((bottom - y - 4) / 4.3));
          const take = Math.min(count - offset, capacity); let x = M;
          cells.forEach((ls, i) => { font(8); doc.text(ls.slice(offset, offset + take), x + 2, y + 1); x += widths[i]; });
          y += take * 4.3 + 3; line(y - 1); offset += take;
          if (offset < count) { next(); tableHead(); }
        }
      }); y += 4;
    }
    function distinct(entries) { const seen = new Set(); entries.forEach(([label, value]) => { const v = clean(value); if (v && !seen.has(v)) { seen.add(v); block(label, v); } }); }
    header(true);
    const location = o.localAtendimento || site.name || site.nome;
    const end = address(site.address_json || site.endereco || o.endereco || cli.endereco) || unique([cli.logradouro, cli.numero, cli.complemento, cli.bairro, cli.cidade, cli.uf, cli.cep]);
    if ([cli.nome, cli.razaoSocial, cli.cnpj, cli.contato, end, location].some(present)) {
      section('Cliente e local');
      pair(['Cliente', cli.razaoSocial || cli.nome], ['Nome fantasia', cli.nomeFantasia && cli.nomeFantasia !== (cli.razaoSocial || cli.nome) ? cli.nomeFantasia : '']);
      pair(['CNPJ / CPF', cli.cnpj || cli.cpf], ['Contato', unique([o.contatoLocal, site.contact_name, site.contact_phone, cli.contato, cli.telefone, cli.whatsapp])]);
      block('E-mail', unique([site.contact_email, cli.contatoEmail, cli.email]));
      if (location && clean(location) !== end) block('Unidade / local', location);
      block('Endereço', end); block('Informações do cliente / acesso', cli.observacoes);
    }
    section('Resumo do atendimento');
    pair(['Serviço', srv.nome || o.servico], ['Responsável técnico', tec.nome || o.tecnicoNome]);
    pair(['Tipo / status', unique([o.tipo, o.status])], ['Prioridade / SLA', unique([o.prioridade, date(o.sla)])]);
    pair(['Abertura', date(o.criadoEm || o.created_at)], ['Atendimento / agendamento', date(o.dataHora || o.data || o.scheduled_at)]);
    pair(['Início', date(o.inicio || o.started_at || o.horario)], ['Conclusão', date(o.concluidoEm || o.fim || o.completed_at)]);
    distinct([['Solicitação / descrição do serviço', o.desc], ['Descrição', o.descricao || o.description], ['Sintoma relatado', o.sintoma], ['Orientações ao técnico', o.orientacoes]]);
    if (eqs.length) {
      section('Equipamentos vinculados');
      eqs.forEach((e, i) => {
        ensure(24); font(9, 'bold', theme.navy); doc.text('Equipamento ' + (i + 1), M, y); y += 6;
        pair(['Identificação / TAG / patrimônio', unique([e.nome, e.tag, e.patrimonio]) || e.id], ['Tipo / situação', unique([e.tipo, e.status])]);
        pair(['Marca / modelo', unique([e.marca, e.modelo])], ['Série / capacidade', unique([e.serie || e.numeroSerie, e.capacidade])]);
        block('Ambiente / localização', unique([e.ambiente, e.localizacao]));
        block('Características técnicas', unique([e.tensao && 'Tensão: ' + e.tensao, e.fluido && 'Fluido: ' + e.fluido, e.tecnologia && 'Tecnologia: ' + e.tecnologia, e.compressor && 'Compressor: ' + e.compressor]));
        pair(['Instalação', date(e.dataInstalacao)], ['Última manutenção / periodicidade', unique([date(e.ultimaManutencao), e.periodicidade])]);
        block('Observações do equipamento', e.observacoes);
      });
    }
    const execution = [['Relato técnico do atendimento', o.relatoTecnico], ['Diagnóstico técnico', o.diagnostico || o.technical_opinion], ['Trabalho executado', o.trabalhoExecutado], ['Observação técnica', o.observacao], ['Observações', o.observacoes], ['Observação', o.obs], ['Recomendações', o.recomendacoes], ['Recomendação', o.recomendacao]];
    if (execution.some(x => present(x[1]))) { section('Execução técnica'); distinct(execution); }
    if (tec.nome || tec.posicao || tec.registro) { section('Responsável pelo atendimento'); pair(['Técnico / executante', tec.nome], ['Função / registro', unique([tec.posicao, tec.registro, tec.crea])]); }
    const checks = list(o.checklist).filter(x => x.concluido && present(x.titulo || x.descricao));
    if (checks.length) { section('Checklist técnico realizado'); table(['Item conferido', 'Registro'], checks.map(x => ['✓ ' + (x.titulo || x.descricao) + (x.observacao ? '\n' + x.observacao : ''), date(x.concluidoEm)]), [133, 47]); }
    const parts = [...list(o.pecasUsadas), ...list(o.materiais), ...list(o.servicosUsados)];
    if (parts.length) {
      section('Materiais, peças e serviços aplicados');
      const valued = parts.some(p => (number(p.venda ?? p.valorUnitario ?? p.unit_cents) || 0) !== 0);
      const rows = parts.map(p => {
        const unit = p.unit_cents != null ? number(p.unit_cents) / 100 : number(p.venda ?? p.valorUnitario);
        const qty = number(p.qtd ?? p.quantidade ?? p.quantity);
        return [clean(p.nome || p.descricao || p.description || p.id), clean(p.qtd ?? p.quantidade ?? p.quantity), ...(valued ? [unit ? money(unit) : '', unit && qty != null ? money(unit * qty) : ''] : [])];
      });
      table(valued ? ['Descrição', 'Qtd.', 'Unitário', 'Total'] : ['Descrição', 'Quantidade'], rows, valued ? [103, 17, 30, 30] : [145, 35]);
    }
    // Already-loaded integration history belongs to this OS; no API requests or invented mappings.
    const imported = o.fieldControlDetails || {};
    const groups = [['Atendimentos registrados', imported.tasks], ['Comentários do atendimento', imported.comments], ['Materiais registrados', imported.materials], ['Formulários preenchidos', imported.forms]];
    function detail(value, prefix = '') {
      if (value == null || value === '') return;
      if (Array.isArray(value)) { value.forEach((v, i) => detail(v, prefix + ' ' + (i + 1))); return; }
      if (typeof value === 'object') { Object.entries(value).forEach(([key, v]) => detail(v, prefix ? prefix + ' / ' + key : key)); return; }
      // Provider branding is not part of the DBS AIR document identity.
      block(prefix.replace(/field\s*control/ig, 'Integração'), date(value).replace(/field\s*control/ig, 'Integração'));
    }
    groups.forEach(([title, rows]) => { if (list(rows).length) { section(title); list(rows).forEach((v, i) => detail(v, 'Registro ' + (i + 1))); } });
    if (photos.length) {
      section('Evidências fotográficas', 68);
      for (const p of media.slice(0, photos.length)) {
        const w = Math.min(W, 110), h = Math.min(110, w * p.img.height / p.img.width);
        const width = Math.min(w, h * p.img.width / p.img.height);
        const caption = lines(p.label, W, 7.5); ensure(h + caption.length * 4 + 8);
        doc.addImage(p.img.data, 'PNG', M, y, width, h, undefined, 'FAST'); y += h + 5;
        font(7.5, 'normal', theme.muted); doc.text(caption, M, y); y += caption.length * 4 + 5;
      }
    }
    const nonPhotos = attachments.filter(a => !photos.some(p => p.source === (typeof a === 'string' ? a : a.url || a.file_url || a.data || a.src)));
    if (nonPhotos.length) { section('Anexos do atendimento'); nonPhotos.forEach(a => { const url = typeof a === 'string' ? a : a.url || a.file_url; block('Arquivo', typeof a === 'string' ? a : unique([a.file_name || a.name || a.title, a.file_type || a.type, url])); }); }
    const total = o.total_cents != null ? number(o.total_cents) / 100 : number(o.valor);
    if (total != null && total !== 0) {
      ensure(23); line(y); y += 7; font(8, 'bold', theme.muted); doc.text('VALOR DO ATENDIMENTO', M, y);
      font(13, 'bold', theme.navy); doc.text(money(total), 195, y, { align: 'right' }); y += 12;
    }
    if (signatures.length) {
      section('Assinaturas e aceite', 50);
      for (const s of media.slice(photos.length)) {
        ensure(48); const h = Math.min(28, 80 * s.img.height / s.img.width); const w = Math.min(80, h * s.img.width / s.img.height);
        doc.addImage(s.img.data, 'PNG', M, y, w, h, undefined, 'FAST'); y += h + 4;
        doc.setDrawColor(...theme.line); doc.line(M, y, M + 90, y); y += 5;
        font(7.5, 'bold', theme.muted); doc.text(s.label, M, y); y += 6;
        pair(['Nome', s.name], ['Data / hora do aceite', date(s.at)]);
      }
    }
    if (o.concluidoEm || o.concluidoPorEmployeeId || o.assinaturaNome) {
      section('Conclusão e rastreabilidade'); pair(['Conclusão registrada', date(o.concluidoEm)], ['Colaborador vinculado', o.concluidoPorEmployeeId]);
      if (!signatures.length && o.assinaturaNome) block('Aceite registrado por', o.assinaturaNome);
    }
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); line(285); font(7, 'normal', theme.muted);
      doc.text('DBS AIR · DBS Control', M, 291);
      const footerId = lines('OS ' + protocol, 91, 6.5).join(' ');
      if (doc.getTextWidth(footerId) < 92) doc.text(footerId, 106, 291, { align: 'center' });
      doc.text('Página ' + p + ' de ' + pages, 195, 291, { align: 'right' });
    }
    return doc;
  }
  window.DbsControlPdf = { generate, equipment };
})();
