/* DBS AIR — compact one-page A4 OS renderer. Read-only: never mutates state. */
(function () {
  'use strict';

  const theme = {
    navy: [15, 23, 42],
    slate: [30, 41, 59],
    blue: [37, 99, 235],
    ink: [30, 41, 59],
    muted: [100, 116, 139],
    line: [226, 232, 240],
    soft: [248, 250, 252],
    white: [255, 255, 255],
  };
  const fallbackLogo = '/__l5e/assets-v1/4588320a-68f8-4932-9a72-8f318ecd3268/logo-dbs-air.jpg';
  const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
  const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
  const has = value => text(value) !== '';
  const first = (...values) => values.find(value => has(value)) ?? '';
  const unique = values => {
    const seen = new Set();
    return values.map(text).map(value => value.trim()).filter(value => {
      const key = value.toLocaleLowerCase('pt-BR');
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(' · ');
  };
  const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const lookup = (rows, id) => has(id) ? list(rows).find(row => String(row.id) === String(id)) || {} : {};
  const formatDate = value => {
    const raw = text(value);
    if (!raw) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.split('-').reverse().join('/');
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };
  const digits = value => text(value).replace(/\D/g, '');
  const maskDocument = value => {
    const raw = digits(value);
    if (raw.length === 11) return raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    if (raw.length === 14) return raw.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    return text(value) || '—';
  };
  const maskCep = value => {
    const raw = digits(value);
    return raw.length === 8 ? raw.replace(/(\d{5})(\d{3})/, '$1-$2') : (text(value) || '—');
  };
  const address = value => {
    if (!value) return '';
    if (typeof value === 'object') return unique([
      value.street || value.logradouro,
      value.number || value.numero,
      value.complement || value.complemento,
      value.neighborhood || value.bairro,
      value.city || value.cidade,
      value.state || value.uf,
      maskCep(value.zipCode || value.cep),
    ]);
    return text(value);
  };
  const equipmentLabel = value => {
    const raw = text(value);
    if (!raw) return 'Todos os equipamentos da unidade (Geral)';
    if (/equipamento\s+(todos|todas)|todos\s+equipamentos|todas\s+as\s+unidades/i.test(raw)) return 'Todos os equipamentos da unidade (Geral)';
    return raw;
  };
  const truncate = (value, max = 180) => {
    const raw = text(value);
    return raw.length > max ? raw.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : raw;
  };

  function base64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }

  async function fetchFont(url) {
    try {
      const response = await fetch(url);
      return response.ok ? base64(await response.arrayBuffer()) : null;
    } catch (_) { return null; }
  }

  function toCandidateUrls(value) {
    const raw = text(value);
    if (!raw) return [];
    if (/^(data:|https?:|blob:|\/)/i.test(raw)) return [raw];
    const supabaseUrl = text(window.__DBS_SUPABASE_URL || 'https://gdglototcrehvhkvcqsq.supabase.co').replace(/\/$/, '');
    const path = raw.replace(/^\/+/, '');
    return [
      `${supabaseUrl}/storage/v1/object/public/${path}`,
      `${supabaseUrl}/storage/v1/object/public/dbs-control-os/${path}`,
      `${supabaseUrl}/storage/v1/object/public/company-assets/${path}`,
      raw,
    ];
  }

  async function loadImage(source, label) {
    const raw = typeof source === 'object' ? source.data || source.url || source.src || source.storage_path : source;
    if (!has(raw) || typeof Image === 'undefined') return null;
    const resolved = text(raw);
    return new Promise(resolve => {
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 8000);
      if (!/^data:/i.test(resolved)) img.crossOrigin = 'anonymous';
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx || !canvas.width || !canvas.height) return resolve(null);
          ctx.drawImage(img, 0, 0);
          resolve({ data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, label });
        } catch (_) { resolve(null); }
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = resolved;
    });
  }

  async function prepare(state, options) {
    const company = state?.company || state?.empresa || state?.config?.company || {};
    const logoSources = [
      options.logoUrl,
      company.logo_url,
      company.logoUrl,
      state?.logo_url,
      window.__DBS_COMPANY_LOGO_URL,
      fallbackLogo,
    ].flatMap(toCandidateUrls);
    const logo = (await Promise.all(logoSources.map(url => loadImage(url, 'logo DBS AIR')))).find(Boolean) || null;
    const [regular, bold] = await Promise.all([fetchFont('/fonts/dbs-document-regular.ttf'), fetchFont('/fonts/dbs-document-bold.ttf')]);
    return { regular, bold, logo };
  }

  function equipment(state, order) {
    const refs = [
      ...list(order?.equipamentos),
      ...list(order?.equipamentosIds),
      ...list(order?.equipmentIds),
      ...list(order?.equipment_ids),
      ...[order?.equipamentoId, order?.equipment_id].filter(has),
    ];
    const rows = [];
    const seen = new Set();
    refs.forEach(ref => {
      const id = typeof ref === 'object' ? ref.id : ref;
      const master = lookup(state?.equipamentos, id);
      const row = typeof ref === 'object' ? { ...master, ...ref } : (Object.keys(master).length ? master : { id });
      const key = text(id) || JSON.stringify(row);
      if (!seen.has(key)) { seen.add(key); rows.push(row); }
    });
    if (!rows.length && has(order?.equipamento)) rows.push({ nome: equipmentLabel(order.equipamento) });
    return rows;
  }

  function setupDocument(doc, resources) {
    if (resources.regular) {
      doc.addFileToVFS('DBS-Regular.ttf', resources.regular);
      doc.addFont('DBS-Regular.ttf', 'DBS', 'normal');
    }
    if (resources.bold) {
      doc.addFileToVFS('DBS-Bold.ttf', resources.bold);
      doc.addFont('DBS-Bold.ttf', 'DBS', 'bold');
    }
    const family = resources.regular ? 'DBS' : 'helvetica';
    return (size = 8, weight = 'normal', color = theme.ink) => {
      doc.setFont(family, weight);
      doc.setFontSize(size);
      doc.setTextColor(...color);
    };
  }

  async function generate(state, id, options = {}) {
    const current = list(state?.ordens).find(row => String(row.id) === String(id));
    if (!current) throw new Error('A Ordem de Serviço não está disponível na base carregada.');
    const st = JSON.parse(JSON.stringify(state || {}));
    const order = list(st.ordens).find(row => String(row.id) === String(id));
    const client = lookup(st.clientes, first(order.clienteId, order.client_id, order.clientId));
    const site = lookup(st.locais || st.sites || st.unidades, first(order.siteId, order.localId, order.site_id));
    const service = lookup(st.servicos, first(order.servicoId, order.service_id));
    const technician = lookup(st.tecnicos, first(order.tecnicoId, order.employeeId, order.assigned_employee_id)) || {};
    const equipmentRows = equipment(st, order);
    const resources = await prepare(st, options);
    const doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const font = setupDocument(doc, resources);
    const employeeMode = new URLSearchParams(window.location.search).get('mode') === 'employee';
    const includeValues = !employeeMode && options.includeValues === true;
    const M = 10, W = 190, pageHeight = 297;
    const protocol = first(order.protocolo, order.protocol, order.id);
    const company = st.company || st.empresa || st.config?.company || {};
    const companyName = first(company.name, company.nome, company.trade_name, 'DBS AIR / DBS Control');
    const status = first(order.status, order.situacao, 'Em atendimento');
    const statusNorm = normalize(status);
    const statusFill = /conclu/.test(statusNorm) ? [220, 252, 231] : /cancel/.test(statusNorm) ? [254, 226, 226] : /atendimento|andamento|aberta/.test(statusNorm) ? [219, 234, 254] : [241, 245, 249];
    const statusInk = /conclu/.test(statusNorm) ? [22, 101, 52] : /cancel/.test(statusNorm) ? [153, 27, 27] : /atendimento|andamento|aberta/.test(statusNorm) ? [30, 64, 175] : theme.muted;
    doc.setProperties({ title: `DBS AIR · Ordem de Serviço ${protocol}`, subject: 'Registro do atendimento', author: 'DBS AIR', creator: 'DBS Control' });
    const wrap = (value, width, size = 7.4, maxLines = 2) => {
      font(size, 'normal', theme.ink);
      const lines = doc.splitTextToSize(truncate(value || '—', 320), width);
      return lines.slice(0, maxLines);
    };
    const section = (number, title, y, height) => {
      doc.setFillColor(...theme.white); doc.setDrawColor(...theme.line); doc.setLineWidth(0.28); doc.roundedRect(M, y, W, height, 1.2, 1.2, 'FD');
      doc.setFillColor(...theme.navy); doc.roundedRect(M, y, W, 6, 1.2, 1.2, 'F'); doc.rect(M, y + 2.8, W, 3.2, 'F');
      font(7.1, 'bold', theme.white); doc.text(`${String(number).padStart(2, '0')}  ${title.toUpperCase()}`, M + 3, y + 4.15);
      return y + 9;
    };
    const field = (x, y, width, label, value, maxLines = 2) => {
      font(5.9, 'bold', theme.muted); doc.text(text(label).toUpperCase(), x, y);
      const rows = wrap(value, width, 7.4, maxLines);
      font(7.4, 'normal', theme.ink); doc.text(rows, x, y + 3.8, { lineHeightFactor: 1.1 });
      return rows.length * 3.8 + 2;
    };
    const divider = (x1, y1, x2, y2) => { doc.setDrawColor(...theme.line); doc.setLineWidth(0.2); doc.line(x1, y1, x2, y2); };
    const clientName = first(client.razaoSocial, client.nome, client.nomeFantasia, 'Cliente não informado');
    const clientAddress = address(site.address_json || site.endereco || order.endereco || client.endereco) || unique([client.logradouro, client.numero, client.complemento, client.bairro, client.cidade, client.uf, maskCep(client.cep)]);
    const email = unique([site.contact_email, site.contactEmail, client.contatoEmail, client.email, order.contatoEmail]);
    const phone = unique([site.contact_phone, site.contactPhone, client.telefone, client.whatsapp, order.contatoTelefone]);
    const documentNumber = maskDocument(first(client.cnpj, client.cpf));
    const place = first(order.localAtendimento, site.name, site.nome, '—');
    let y = 10;
    // Header / branding (logo height capped at 12 mm ≈ 45 px).
    doc.setFillColor(...theme.white); doc.setDrawColor(...theme.line); doc.setLineWidth(0.35); doc.roundedRect(M, y, W, 25, 1.4, 1.4, 'FD');
    doc.setFillColor(...theme.blue); doc.rect(M, y, 1.5, 25, 'F');
    if (resources.logo) {
      const scale = Math.min(34 / resources.logo.width, 12 / resources.logo.height);
      const lw = resources.logo.width * scale, lh = resources.logo.height * scale;
      doc.addImage(resources.logo.data, 'PNG', M + 5, y + (25 - lh) / 2, lw, lh, undefined, 'FAST');
      font(6.2, 'bold', theme.navy); doc.text(companyName, M + 5, y + 21.5);
    } else {
      font(12, 'bold', theme.navy); doc.text('DBS AIR', M + 5, y + 12);
      font(6.2, 'bold', theme.muted); doc.text(companyName, M + 5, y + 20);
    }
    font(9.5, 'bold', theme.navy); doc.text('ORDEM DE SERVIÇO', M + W - 5, y + 7.5, { align: 'right' });
    font(8.2, 'bold', theme.blue); doc.text(`Nº ${protocol}`, M + W - 5, y + 14, { align: 'right' });
    const badgeWidth = Math.min(52, Math.max(25, doc.getTextWidth(text(status).toUpperCase()) + 8));
    doc.setFillColor(...statusFill); doc.roundedRect(M + W - 5 - badgeWidth, y + 16.2, badgeWidth, 5.8, 1.6, 1.6, 'F');
    font(5.9, 'bold', statusInk); doc.text(text(status).toUpperCase(), M + W - 8, y + 20.1, { align: 'right' });
    y = 39;

    // 01 — Client and location.
    let cy = section(1, 'Cliente e localização', y, 31);
    field(M + 4, cy, 88, 'Cliente', clientName, 1);
    field(M + 99, cy, 87, 'CNPJ / CPF', documentNumber, 1);
    field(M + 4, cy + 10, 88, 'Endereço completo', clientAddress || '—', 2);
    field(M + 99, cy + 10, 87, 'Unidade / local', place, 2);
    field(M + 4, cy + 21, 88, 'E-mail', email || '—', 1);
    field(M + 99, cy + 21, 87, 'Telefone', phone || '—', 1);
    y += 34;

    // 02 — Compact service summary and timeline.
    let sy = section(2, 'Resumo do atendimento', y, 25);
    field(M + 4, sy, 55, 'Tipo de serviço', first(service.nome, order.tipo, order.servico, '—'), 1);
    field(M + 64, sy, 42, 'Prioridade / SLA', unique([order.prioridade, order.sla]) || '—', 1);
    field(M + 111, sy, 75, 'Responsável técnico', first(technician.nome, order.tecnicoNome, '—'), 1);
    divider(M + 4, sy + 9, M + W - 4, sy + 9);
    const timeline = [
      ['ABERTURA', formatDate(first(order.criadoEm, order.created_at, order.createdAt))],
      ['AGENDAMENTO', formatDate(first(order.dataHora, order.data, order.scheduled_at, order.scheduledAt))],
      ['CONCLUSÃO', formatDate(first(order.concluidoEm, order.completed_at, order.completedAt, order.fim))],
    ];
    timeline.forEach((item, index) => {
      const x = M + 4 + index * 61.2;
      field(x, sy + 14, 57, item[0], item[1], 1);
      if (index < timeline.length - 1) divider(x + 59, sy + 14, x + 59, sy + 21);
    });
    y += 28;

    // 03 — Equipment grid, max three rows to keep the document on one page.
    let ey = section(3, 'Equipamentos vinculados', y, 40);
    const tableX = M + 4, tableW = W - 8, col = [48, 63, 38, 37];
    doc.setFillColor(...theme.soft); doc.rect(tableX, ey - 2, tableW, 6, 'F');
    ['TAG / PATRIMÔNIO', 'TIPO / MODELO', 'CAPACIDADE', 'SITUAÇÃO'].forEach((label, index) => { font(5.7, 'bold', theme.navy); doc.text(label, tableX + col.slice(0, index).reduce((a, b) => a + b, 0) + 2, ey + 1.8); });
    const rows = equipmentRows.slice(0, 3);
    if (!rows.length) rows.push({ nome: 'Todos os equipamentos da unidade (Geral)' });
    rows.forEach((row, index) => {
      const values = [
        first(row.tag, row.patrimonio, row.nome, row.id, '—'),
        unique([row.tipo, row.marca, row.modelo]) || equipmentLabel(row.equipamento),
        first(row.capacidade, row.btu, row.btus, '—'),
        first(row.status, row.situacao, 'Vinculado'),
      ];
      const rowY = ey + 9 + index * 8.3;
      values.forEach((value, i) => { const x = tableX + col.slice(0, i).reduce((a, b) => a + b, 0); font(6.7, 'normal', theme.ink); doc.text(wrap(value, col[i] - 4, 6.7, 1), x + 2, rowY); });
      divider(tableX, rowY + 3.2, tableX + tableW, rowY + 3.2);
    });
    if (equipmentRows.length > 3) { font(6, 'normal', theme.muted); doc.text(`+ ${equipmentRows.length - 3} equipamento(s) não exibido(s) neste resumo`, tableX, ey + 34); }
    y += 43;

    // 04 — Diagnostic and execution.
    let dy = section(4, 'Diagnóstico e execução técnica', y, 38);
    field(M + 4, dy, 88, 'Diagnóstico técnico', first(order.diagnostico, order.technical_opinion, order.sintoma, '—'), 2);
    field(M + 99, dy, 87, 'Ação / peças', first(order.trabalhoExecutado, order.acaoNecessaria, order.recomendacao, unique(list(order.pecasUsadas).map(part => part.nome || part.descricao)), '—'), 2);
    field(M + 4, dy + 13, 88, 'Tipo de atendimento', first(order.tipo, service.nome, '—'), 1);
    const evidenceCount = list(order.anexos).length + list(order.attachments).length + (order.fotoAntes ? 1 : 0) + (order.fotoDepois ? 1 : 0);
    field(M + 99, dy + 13, 87, 'Evidências registradas', evidenceCount ? `${evidenceCount} arquivo(s) anexado(s)` : 'Sem anexos', 1);
    field(M + 4, dy + 24, 182, 'Resumo da execução', first(order.relatoTecnico, order.trabalhoExecutado, order.desc, order.descricao, '—'), 2);
    y += 41;

    // 05 — Technician notes.
    let oy = section(5, 'Observações do técnico', y, 25);
    const observations = unique([order.observacaoTecnico, order.observacoesTecnico, order.observacao, order.observacaoComplementarTecnico, order.observacoes, order.obs, order.observation]);
    doc.setFillColor(...theme.soft); doc.setDrawColor(...theme.line); doc.roundedRect(M + 4, oy, W - 8, 12, 1, 1, 'FD');
    font(7.2, 'normal', theme.ink); doc.text(wrap(observations || 'Nenhuma observação registrada.', W - 16, 7.2, 3), M + 7, oy + 4.5, { lineHeightFactor: 1.12 });
    y += 28;

    // 06 — Acceptance and signature.
    let ay = section(6, 'Aceite do cliente e assinatura', y, 38);
    const signatureSource = first(order.assinatura, order.signature_data, order.signatureData, order.assinatura_url, order.signature_url);
    const signature = await loadImage(signatureSource, 'assinatura');
    if (signature) {
      const scale = Math.min(58 / signature.width, 17 / signature.height);
      doc.addImage(signature.data, 'PNG', M + 5, ay + 3, signature.width * scale, signature.height * scale, undefined, 'FAST');
    }
    divider(M + 5, ay + 23, M + 75, ay + 23);
    font(6.3, 'bold', theme.muted); doc.text('ASSINATURA / ACEITE DO CLIENTE', M + 5, ay + 27);
    field(M + 83, ay + 4, 48, 'Aceite por', first(order.assinaturaNome, order.signature_name, client.contato, '—'), 1);
    field(M + 137, ay + 4, 49, 'Data / hora', formatDate(first(order.assinaturaEm, order.accepted_at, order.concluidoEm)), 1);
    field(M + 83, ay + 16, 103, 'Observação do aceite', first(order.aceiteObservacao, order.signature_note, '—'), 1);
    y += 41;

    // 07 — Audit footer block and exact one-page marker.
    let ry = section(7, 'Rastreabilidade e auditoria', y, 19);
    const employeeUuid = first(order.concluidoPorEmployeeId, order.employeeId, order.assigned_employee_id, technician.id, '—');
    const integrityHash = first(order.integrityHash, order.hashIntegridade, order.contentHash, order.hash, '—');
    field(M + 4, ry, 82, 'UUID do colaborador', employeeUuid, 1);
    field(M + 92, ry, 94, 'Hash de integridade', integrityHash, 1);
    divider(M, pageHeight - 12, M + W, pageHeight - 12);
    font(6.4, 'normal', theme.muted); doc.text('DBS AIR · DBS Control', M, pageHeight - 6);
    doc.text(`OS ${protocol}`, M + W / 2, pageHeight - 6, { align: 'center' });
    doc.text('Página 1 de 1', M + W, pageHeight - 6, { align: 'right' });
    // `addPage` is intentionally never called: this renderer is fixed to one A4 page.
    void includeValues;
    return doc;
  }

  window.DbsControlPdf = { generate, equipment };
})();
