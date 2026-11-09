/* DBS AIR - Ordem de Servico completa e adaptativa. Leitura apenas: nunca altera o estado. */
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
    blueSoft: [239, 246, 255],
    green: [34, 197, 94],
    white: [255, 255, 255],
  };
  const fallbackLogo = '/__l5e/assets-v1/4588320a-68f8-4932-9a72-8f318ecd3268/logo-dbs-air.jpg';
  const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
  const text = value => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
  const has = value => text(value) !== '';
  const first = (...values) => values.find(value => has(value)) ?? '';
  const normalize = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const uniqueValues = values => {
    const seen = new Set();
    return values.map(text).map(value => value.trim()).filter(value => {
      const key = value.toLocaleLowerCase('pt-BR');
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const unique = values => uniqueValues(values).join(' · ');
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
  const numeric = value => {
    if (!has(value)) return null;
    const raw = text(value).replace(/R\$\s*/g, '').trim();
    const parsed = typeof value === 'number' ? value : Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
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
    const contentBottom = 276;
    const protocol = first(order.protocolo, order.protocol, order.id);
    const company = st.company || st.empresa || st.config?.company || {};
    const companyLegalName = first(company.legal_name, company.razaoSocial, company.name, company.nome, company.trade_name, 'DBS AIR REFRIGERACAO LTDA - ME');
    const companyDocument = maskDocument(first(company.cnpj, company.cnpj_cpf, company.document, company.tax_id, '13.352.707/0001-09'));
    const companyEmail = first(company.email, company.emailAddress, company.contatoEmail, company.contact_email, 'assistencia@dbsair.com.br');
    const companyPhone = first(company.phone, company.telefone, company.contact_phone, company.whatsapp, '(21) 99825-6991');
    const companyAddress = address(company.address_json || company.endereco || company.address) || unique([
      company.logradouro,
      company.numero,
      company.complemento,
      company.bairro,
      company.cidade,
      company.uf,
      has(company.cep) ? maskCep(company.cep) : '',
    ]) || 'Rua Nabor do Rego, 481 (ou nº 2908), Ramos, Rio de Janeiro - RJ · CEP 21031-720';
    const issuerTitle = uniqueValues([
      companyLegalName,
      companyDocument !== '—' ? `CNPJ ${companyDocument}` : '',
    ]).join(' · ');
    const status = first(order.status, order.situacao, 'Em atendimento');
    const statusNorm = normalize(status);
    const statusFill = /conclu/.test(statusNorm) ? [220, 252, 231] : /cancel/.test(statusNorm) ? [254, 226, 226] : /atendimento|andamento|aberta/.test(statusNorm) ? [219, 234, 254] : [241, 245, 249];
    const statusInk = /conclu/.test(statusNorm) ? [22, 101, 52] : /cancel/.test(statusNorm) ? [153, 27, 27] : /atendimento|andamento|aberta/.test(statusNorm) ? [30, 64, 175] : theme.muted;
    const lineHeight = 3.35;
    const page = { y: 0 };
    const sectionState = { number: '', title: '' };

    doc.setProperties({ title: `DBS AIR · Ordem de Serviço ${protocol}`, subject: 'Registro completo do atendimento', author: 'DBS AIR', creator: 'DBS Control' });

    const breakLongLine = (value, width) => {
      const raw = text(value);
      if (!raw) return ['—'];
      const output = [];
      let line = '';
      for (const char of raw) {
        const candidate = line + char;
        if (line && doc.getTextWidth(candidate) > width) {
          output.push(line);
          line = char;
        } else line = candidate;
      }
      if (line || !output.length) output.push(line);
      return output;
    };
    const wrapText = (value, width, size = 7.2) => {
      font(size, 'normal', theme.ink);
      const raw = text(value) || '—';
      const paragraphs = raw.split(/\r?\n/);
      const lines = [];
      paragraphs.forEach((paragraph, index) => {
        const base = doc.splitTextToSize(paragraph || ' ', width);
        base.forEach(line => breakLongLine(line, width).forEach(part => lines.push(part)));
        if (index < paragraphs.length - 1) lines.push('');
      });
      return lines.length ? lines : ['—'];
    };
    const drawHeader = firstPage => {
      const y = 10;
      if (!firstPage) {
        doc.setFillColor(...theme.blue); doc.rect(M, 11, W, 1, 'F');
        doc.setFillColor(...theme.green); doc.rect(M, 11, 16, 1, 'F');
        font(7.8, 'bold', theme.navy); doc.text('DBS AIR · ORDEM DE SERVIÇO', M, 18);
        font(7.5, 'bold', theme.navy); doc.text(`OS ${protocol}`, M + W, 18, { align: 'right' });
        doc.setDrawColor(...theme.line); doc.setLineWidth(0.2); doc.line(M, 23, M + W, 23);
        return 30;
      }
      const height = 26;
      doc.setFillColor(...theme.soft); doc.setDrawColor(...theme.line); doc.setLineWidth(0.35); doc.roundedRect(M, y, W, height, 1.2, 1.2, 'FD');
      doc.setFillColor(...theme.blue); doc.rect(M, y, 1.5, height, 'F');
      doc.setFillColor(...theme.green); doc.rect(M + 1.5, y, 0.7, height, 'F');
      if (resources.logo) {
        const scale = Math.min(34 / resources.logo.width, 18 / resources.logo.height);
        const lw = resources.logo.width * scale, lh = resources.logo.height * scale;
        doc.addImage(resources.logo.data, 'PNG', M + 4, y + (height - lh) / 2, lw, lh, undefined, 'FAST');
      } else {
        font(12, 'bold', theme.navy); doc.text('DBS AIR', M + 5, y + 12);
        font(5.8, 'bold', theme.blue); doc.text('REFRIGERAÇÃO', M + 5, y + 17);
      }
      const issuerX = M + 43;
      font(6.8, 'bold', theme.navy); doc.text(issuerTitle, issuerX, y + 6, { maxWidth: 82 });
      font(5.8, 'normal', theme.muted); doc.text(unique([companyEmail, companyPhone]) || '—', issuerX, y + 11, { maxWidth: 82 });
      doc.text(companyAddress || '—', issuerX, y + 16, { maxWidth: 82 });
      font(6.5, 'bold', theme.blue); doc.text('ORDEM DE SERVIÇO', M + W - 4, y + 5.5, { align: 'right' });
      font(9.2, 'bold', theme.navy); doc.text(`Nº ${protocol}`, M + W - 4, y + 12.5, { align: 'right' });
      const badgeWidth = Math.min(48, Math.max(26, doc.getTextWidth(text(status).toUpperCase()) + 8));
      doc.setFillColor(...statusFill); doc.roundedRect(M + W - 4 - badgeWidth, y + 16, badgeWidth, 7, 1.5, 1.5, 'F');
      font(6.2, 'bold', statusInk); doc.text(text(status).toUpperCase(), M + W - 8, y + 20.6, { align: 'right', maxWidth: badgeWidth - 6 });
      return y + height + 5;
    };

    const addPage = () => {
      doc.addPage();
      page.y = drawHeader(false);
      if (sectionState.title) drawSectionHeader(sectionState.number, sectionState.title, true);
    };
    const ensureSpace = (height, allowSectionContinuation = true) => {
      if (page.y + height <= contentBottom) return;
      addPage();
      if (!allowSectionContinuation && sectionState.title) {
        sectionState.number = '';
        sectionState.title = '';
      }
    };
    function drawSectionHeader(number, title, continuation = false) {
      const label = `${String(number).padStart(2, '0')}  ${title.toUpperCase()}${continuation ? ' · CONTINUAÇÃO' : ''}`;
      if (page.y + 12 > contentBottom) {
        if (!continuation) {
          sectionState.number = '';
          sectionState.title = '';
        }
        addPage();
      }
      doc.setFillColor(...theme.soft); doc.setDrawColor(...theme.line); doc.setLineWidth(0.2); doc.roundedRect(M, page.y, W, 7, 1.2, 1.2, 'F');
      doc.setFillColor(...theme.blue); doc.roundedRect(M, page.y, 1.6, 7, 1, 1, 'F');
      font(7, 'bold', theme.navy); doc.text(label, M + 5, page.y + 4.55);
      page.y += 10;
      sectionState.number = number;
      sectionState.title = title;
    }
    const fieldLines = (label, value, width, size = 7.6) => {
      font(6.1, 'bold', theme.muted);
      const labelWidth = doc.getTextWidth(`${text(label).toUpperCase()}: `);
      return { labelWidth, lines: wrapText(value || '—', Math.max(14, width - labelWidth - 1.5), size) };
    };
    const inlineRow = (fields, options = {}) => {
      const gap = options.gap ?? 5;
      const available = W - 8 - gap * Math.max(0, fields.length - 1);
      const requestedWidths = fields.map(field => field.width || available / fields.length);
      const requestedTotal = requestedWidths.reduce((sum, width) => sum + width, 0);
      const scale = requestedTotal > available ? available / requestedTotal : 1;
      const widths = requestedWidths.map(width => width * scale);
      const measures = fields.map((field, index) => fieldLines(field.label, field.value, widths[index], field.size || 7.6));
      const rowHeight = Math.max(...measures.map(measure => Math.max(1, measure.lines.length))) * lineHeight + 4.8;
      ensureSpace(rowHeight + 1);
      const y = page.y;
      let x = M + 4;
      fields.forEach((field, index) => {
        const width = widths[index];
        const measure = measures[index];
        const label = `${text(field.label).toUpperCase()}: `;
        font(6.1, 'bold', theme.muted); doc.text(label, x, y + 3.4);
        font(field.size || 7.6, 'normal', theme.ink);
        const firstX = x + measure.labelWidth + 1;
        doc.text(measure.lines[0] || '—', firstX, y + 3.4);
        if (measure.lines.length > 1) doc.text(measure.lines.slice(1), x, y + 3.4 + lineHeight, { lineHeightFactor: 1.08 });
        x += width + gap;
      });
      doc.setDrawColor(...theme.line); doc.setLineWidth(0.18); doc.line(M + 4, y + rowHeight, M + W - 4, y + rowHeight);
      page.y += rowHeight + 2.5;
    };
    const paragraph = (label, value, width = W - 8, size = 7.7) => {
      const lines = wrapText(value || '—', width, size);
      const labelHeight = 4.1;
      let offset = 0;
      let firstChunk = true;
      while (offset < lines.length) {
        const remaining = lines.length - offset;
        const available = Math.floor((contentBottom - page.y - 5) / lineHeight);
        // Nunca deixe uma única linha órfã no rodapé; leve o bloco para a
        // próxima página e aproveite a área útil de forma contínua.
        if (available < Math.min(remaining, 3)) { addPage(); continue; }
        const take = Math.min(available, remaining);
        const h = labelHeight + take * lineHeight + 4;
        if (page.y + h > contentBottom) { addPage(); continue; }
        font(6.1, 'bold', theme.muted); doc.text(`${text(label).toUpperCase()}${firstChunk ? '' : ' (CONT.)'}`, M + 4, page.y + 3.4);
        font(size, 'normal', theme.ink); doc.text(lines.slice(offset, offset + take), M + 4, page.y + 7, { lineHeightFactor: 1.08 });
        page.y += h;
        offset += take;
        firstChunk = false;
        if (offset < lines.length) addPage();
      }
    };

    const clientName = first(client.razaoSocial, client.nome, client.nomeFantasia, 'Cliente não informado');
    const clientAddress = address(site.address_json || site.endereco || order.endereco || client.endereco) || unique([
      client.logradouro, client.numero, client.complemento, client.bairro, client.cidade, client.uf, maskCep(client.cep),
    ]);
    const email = unique([site.contact_email, site.contactEmail, client.contatoEmail, client.email, order.contatoEmail]);
    const phone = unique([site.contact_phone, site.contactPhone, client.telefone, client.whatsapp, order.contatoTelefone]);
    const documentNumber = maskDocument(first(client.cnpj, client.cpf));
    const osType = first(order.tipoOs, order.tipo_os, order.classificacao, order.tipo, service.nome, order.servico, '—');
    const priority = unique([order.prioridade, order.sla]) || '—';
    const openedAt = formatDate(first(order.criadoEm, order.created_at, order.createdAt));
    const scheduledAt = formatDate(first(order.dataHora, order.data, order.scheduled_at, order.scheduledAt));
    const completedAt = formatDate(first(order.concluidoEm, order.completed_at, order.completedAt, order.fim));
    const technicianName = first(technician.nome, order.tecnicoNome, order.employeeName, '—');
    const diagnostic = first(order.diagnostico, order.technical_opinion, order.sintoma, '—');
    const action = first(order.acaoNecessaria, order.recomendacao, unique(list(order.pecasUsadas).map(part => part.nome || part.descricao || part.name)), '—');
    const report = first(order.relatoTecnico, order.trabalhoExecutado, order.desc, order.descricao, '—');
    const observationValues = uniqueValues([order.observacaoTecnico, order.observacoesTecnico, order.observacao, order.observacaoComplementarTecnico, order.observacoes, order.obs, order.observation]);
    const observations = observationValues.length && normalize(observationValues.join(' ')) !== normalize(report) ? observationValues.join('\n') : '';
    const attachmentRows = uniqueValues([
      ...list(order.anexos).map(item => typeof item === 'object' ? first(item.name, item.nome, item.file_name, item.path) : item),
      ...list(order.attachments).map(item => typeof item === 'object' ? first(item.name, item.nome, item.file_name, item.path) : item),
      order.fotoAntes ? 'Foto antes' : '',
      order.fotoDepois ? 'Foto depois' : '',
    ]);
    const evidenceText = attachmentRows.length ? attachmentRows.join(' · ') : 'Nenhum anexo registrado';
    const totalValue = order.total_cents != null ? numeric(order.total_cents) / 100 : numeric(order.valor);
    const employeeUuid = first(order.concluidoPorEmployeeId, order.employeeId, order.assigned_employee_id, technician.id, '—');
    const integrityHash = first(order.integrityHash, order.hashIntegridade, order.contentHash, order.hash, '—');
    const signatureSource = first(order.assinatura, order.signature_data, order.signatureData, order.assinatura_url, order.signature_url, order.assinaturaStoragePath, order.assinatura_path, order.signature_path);

    page.y = drawHeader(true);

    drawSectionHeader(1, 'Cliente e localização');
    inlineRow([{ label: 'Cliente', value: clientName, width: 108 }, { label: 'CNPJ / CPF', value: documentNumber, width: 74 }]);
    inlineRow([{ label: 'Endereço completo', value: clientAddress || '—', width: 190 }]);
    inlineRow([{ label: 'E-mail', value: email || '—', width: 108 }, { label: 'Telefone', value: phone || '—', width: 74 }]);

    drawSectionHeader(2, 'Resumo do atendimento');
    inlineRow([{ label: 'Tipo de OS', value: osType, width: 62 }, { label: 'Prioridade / SLA', value: priority, width: 48 }, { label: 'Técnico responsável', value: technicianName, width: 72 }]);
    inlineRow([{ label: 'Abertura', value: openedAt, width: 62 }, { label: 'Agendamento', value: scheduledAt, width: 62 }, { label: 'Conclusão', value: completedAt, width: 58 }]);

    drawSectionHeader(3, 'Equipamentos vinculados');
    const tableX = M + 4, tableW = W - 8, columns = [46, 64, 32, 40];
    const drawEquipmentHeader = () => {
      ensureSpace(9);
      doc.setFillColor(...theme.blueSoft); doc.roundedRect(tableX, page.y, tableW, 6, 1, 1, 'F');
      ['TAG / PATRIMÔNIO', 'TIPO / MODELO', 'CAPACIDADE', 'SITUAÇÃO / AMBIENTE'].forEach((label, index) => {
        font(5.8, 'bold', theme.navy); doc.text(label, tableX + columns.slice(0, index).reduce((a, b) => a + b, 0) + 2, page.y + 3.8);
      });
      page.y += 8;
    };
    drawEquipmentHeader();
    const rows = equipmentRows.length ? equipmentRows : [{ nome: 'Todos os equipamentos da unidade (Geral)' }];
    rows.forEach(row => {
      const values = [
        first(row.tag, row.tagNumber, row.patrimonio, row.serial, row.serial_number, row.nome, row.id, '—'),
        unique([row.tipo, row.marca, row.modelo, row.equipment_type]) || equipmentLabel(row.equipamento),
        first(row.capacidade, row.btu, row.btus, row.capacity, '—'),
        unique([row.status, row.situacao, row.ambiente, row.environment]) || 'Vinculado',
      ];
      const measures = values.map((value, col) => wrapText(value, columns[col] - 4, 7));
      const height = Math.max(...measures.map(lines => Math.max(1, lines.length))) * 3.15 + 4.4;
      if (page.y + height > contentBottom) {
        addPage();
        drawEquipmentHeader();
      }
      let x = tableX;
      measures.forEach((lines, col) => {
        font(7, 'normal', theme.ink); doc.text(lines, x + 2, page.y + 3.2, { lineHeightFactor: 1.05 });
        x += columns[col];
      });
      doc.setDrawColor(...theme.line); doc.setLineWidth(0.18); doc.line(tableX, page.y + height, tableX + tableW, page.y + height);
      page.y += height + 1.6;
    });

    drawSectionHeader(4, 'Diagnóstico, execução e evidências');
    inlineRow([{ label: 'Diagnóstico técnico', value: diagnostic, width: 93 }, { label: 'Ação / peças', value: action, width: 89 }]);
    paragraph('Relatório técnico', report);
    inlineRow([{ label: 'Evidências registradas', value: evidenceText, width: 132 }, { label: !employeeMode && includeValues && totalValue != null ? 'Valor do atendimento' : 'Registro', value: !employeeMode && includeValues && totalValue != null ? money(totalValue) : (attachmentRows.length ? `${attachmentRows.length} anexo(s)` : 'Sem anexos'), width: 50 }]);

    const evidenceSources = [
      { title: 'Evidência: Antes do Atendimento', source: first(order.fotoAntes, order.fotoAntesUrl, order.foto_antes_url, order.fotoAntesStoragePath, order.foto_antes_storage_path), stamp: first(order.fotoAntesEm, order.fotoAntesAt, order.started_at, order.created_at) },
      { title: 'Evidência: Após Execução', source: first(order.fotoDepois, order.fotoDepoisUrl, order.foto_depois_url, order.fotoDepoisStoragePath, order.foto_depois_storage_path), stamp: first(order.fotoDepoisEm, order.fotoDepoisAt, order.completed_at, order.concluidoEm) },
    ].filter(item => has(item.source));
    if (evidenceSources.length) {
      const loaded = await Promise.all(evidenceSources.map(item => loadImage(item.source, item.title)));
      const cardGap = 5, cardWidth = (W - 8 - cardGap) / 2, cardHeight = 39;
      ensureSpace(cardHeight + 3);
      const cardY = page.y;
      evidenceSources.forEach((item, index) => {
        const x = M + 4 + index * (cardWidth + cardGap);
        doc.setDrawColor(...theme.line); doc.setLineWidth(0.25); doc.roundedRect(x, cardY, cardWidth, cardHeight, 1.5, 1.5, 'S');
        font(5.8, 'bold', theme.navy); doc.text(item.title, x + 2, cardY + 4, { maxWidth: cardWidth - 4 });
        const image = loaded[index];
        if (image) {
          const maxW = cardWidth - 6, maxH = 25;
          const scale = Math.min(maxW / image.width, maxH / image.height);
          const iw = image.width * scale, ih = image.height * scale;
          doc.addImage(image.data, 'PNG', x + (cardWidth - iw) / 2, cardY + 6 + (maxH - ih) / 2, iw, ih, undefined, 'FAST');
        } else {
          font(6.1, 'normal', theme.muted); doc.text('Imagem não disponível nesta sessão', x + 3, cardY + 19, { maxWidth: cardWidth - 6 });
        }
        font(5.2, 'normal', theme.muted); doc.text(formatDate(item.stamp), x + 2, cardY + 35, { maxWidth: cardWidth - 4 });
      });
      page.y += cardHeight + 3;
    }

    const partsRows = list(order.pecasUsadas).filter(part => Number(part?.qtd ?? part?.quantity ?? 0) > 0);
    if (partsRows.length) {
      drawSectionHeader(5, 'Peças, materiais e insumos');
      const x0 = M + 4, widths = [25, 105, 25, 25], tableWidth = widths.reduce((sum, width) => sum + width, 0);
      const headings = ['CÓDIGO/REF', 'DESCRIÇÃO DA PEÇA/MATERIAL', 'QTD', 'UNIDADE'];
      const drawPartsHeader = () => {
        ensureSpace(8);
        doc.setFillColor(...theme.blueSoft); doc.roundedRect(x0, page.y, tableWidth, 6, 1, 1, 'F');
        let x = x0;
        headings.forEach((label, index) => { font(5.5, 'bold', theme.navy); doc.text(label, x + 1.5, page.y + 3.8, { maxWidth: widths[index] - 3 }); x += widths[index]; });
        page.y += 8;
      };
      drawPartsHeader();
      partsRows.forEach((part, index) => {
        const values = [
          first(part.codigo, part.code, part.ref, part.sku, part.id, '—'),
          first(part.descricao, part.description, part.nome, part.name, 'Material não identificado'),
          String(part.qtd ?? part.quantity ?? 0),
          first(part.unidade, part.unit, part.measure, part.un, 'UN'),
        ];
        const measures = values.map((value, col) => wrapText(value, widths[col] - 3, 6.4));
        const rowHeight = Math.max(6, Math.max(...measures.map(value => value.length)) * 3.1 + 2.5);
        if (page.y + rowHeight > contentBottom) { addPage(); drawPartsHeader(); }
        let x = x0;
        measures.forEach((value, col) => { font(6.4, 'normal', theme.ink); doc.text(value, x + 1.5, page.y + 3.1, { lineHeightFactor: 1.05 }); x += widths[col]; });
        doc.setDrawColor(...theme.line); doc.setLineWidth(0.18); doc.line(x0, page.y + rowHeight, x0 + tableWidth, page.y + rowHeight);
        page.y += rowHeight + (index % 2 ? 0.8 : 1.2);
      });
    }

    const checklistEntries = [];
    const classifyChecklist = (value, explicitStatus) => {
      const raw = normalize(explicitStatus ?? value);
      if (raw === 'true' || /conforme|aprovado|ok/.test(raw)) return { label: 'CONFORME', fill: [220, 252, 231], ink: [22, 101, 52] };
      if (/nao conforme|reprovado|falha|critico/.test(raw)) return { label: 'NÃO CONFORME', fill: [254, 243, 199], ink: [146, 64, 14] };
      if (/^n\/?a$|nao aplicavel/.test(raw)) return { label: 'N/A', fill: [241, 245, 249], ink: [100, 116, 139] };
      return null;
    };
    list(order.checklist).forEach(item => {
      const status = classifyChecklist(item?.concluido, item?.status ?? item?.resultado);
      if (status) checklistEntries.push({ label: first(item?.titulo, item?.title, item?.descricao, item?.name, 'Item de checklist'), status });
    });
    const technicalChecklist = order.checklistTecnico && typeof order.checklistTecnico === 'object' ? order.checklistTecnico : {};
    Object.entries(technicalChecklist).forEach(([group, values]) => {
      if (!values || typeof values !== 'object' || Array.isArray(values)) return;
      Object.entries(values).forEach(([label, value]) => {
        const status = classifyChecklist(value, value?.status ?? value?.resultado);
        if (status) checklistEntries.push({ label: `${group}: ${label}`, status });
      });
    });
    if (checklistEntries.length) {
      drawSectionHeader(6, 'Checklist técnico / inspeção PMOC');
      const gap = 4, cellWidth = (W - 8 - gap * 2) / 3, cellHeight = 13;
      checklistEntries.forEach((entry, index) => {
        const column = index % 3;
        if (column === 0 && page.y + cellHeight > contentBottom) addPage();
        const row = Math.floor(index / 3);
        const x = M + 4 + column * (cellWidth + gap);
        const y = page.y + row * (cellHeight + 2);
        doc.setDrawColor(...theme.line); doc.setLineWidth(0.2); doc.roundedRect(x, y, cellWidth, cellHeight, 1, 1, 'S');
        font(5.7, 'normal', theme.ink); doc.text(wrapText(entry.label, cellWidth - 4, 5.7).slice(0, 2), x + 2, y + 3.3, { lineHeightFactor: 1.02 });
        const badge = entry.status, badgeWidth = badge.label === 'NÃO CONFORME' ? 25 : 18;
        doc.setFillColor(...badge.fill); doc.roundedRect(x + cellWidth - badgeWidth - 2, y + 7, badgeWidth, 4.2, 1, 1, 'F');
        font(4.8, 'bold', badge.ink); doc.text(badge.label, x + cellWidth - badgeWidth / 2 - 2, y + 9.9, { align: 'center' });
      });
      page.y += Math.ceil(checklistEntries.length / 3) * (cellHeight + 2) + 2;
    }

    if (observations) {
      const observationLines = wrapText(observations, W - 8, 7.7);
      if (page.y + 10 + 4.1 + observationLines.length * lineHeight + 4 > contentBottom) {
        sectionState.number = '';
        sectionState.title = '';
        addPage();
      }
      drawSectionHeader(7, 'Observações complementares');
      paragraph('Observações do técnico', observations);
    }

    drawSectionHeader(8, 'Responsáveis e aceite do cliente');
    const signature = await loadImage(signatureSource, 'assinatura do cliente');
    const signatureHeight = 38;
    ensureSpace(signatureHeight);
    const signatureY = page.y;
    const leftX = M + 4, rightX = M + 99, columnWidth = 87;
    const technicianRegistration = first(technician.matricula, technician.registration, technician.employee_code, order.matriculaTecnico, employeeUuid, '—');
    const technicianRole = first(technician.cargo, technician.position, technician.role, order.cargoTecnico, 'Técnico responsável');
    doc.setDrawColor(...theme.line); doc.setLineWidth(0.22);
    doc.line(leftX, signatureY + 19, leftX + columnWidth, signatureY + 19);
    font(5.8, 'bold', theme.muted); doc.text('ASSINATURA DO TÉCNICO RESPONSÁVEL', leftX, signatureY + 23);
    font(6.5, 'bold', theme.navy); doc.text(technicianName, leftX, signatureY + 28, { maxWidth: columnWidth });
    font(5.8, 'normal', theme.muted); doc.text(`Matrícula/ID: ${technicianRegistration}`, leftX, signatureY + 32, { maxWidth: columnWidth });
    doc.text(`Cargo: ${technicianRole}`, leftX, signatureY + 36, { maxWidth: columnWidth });

    if (signature) {
      const scale = Math.min(75 / signature.width, 15 / signature.height);
      const sw = signature.width * scale, sh = signature.height * scale;
      doc.addImage(signature.data, 'PNG', rightX + (columnWidth - sw) / 2, signatureY + 1 + (15 - sh) / 2, sw, sh, undefined, 'FAST');
    } else {
      font(6.2, 'normal', theme.muted); doc.text('Assinatura digital não registrada', rightX, signatureY + 10);
    }
    doc.line(rightX, signatureY + 19, rightX + columnWidth, signatureY + 19);
    font(5.8, 'bold', theme.muted); doc.text('ACEITE DO CLIENTE / RESPONSÁVEL', rightX, signatureY + 23);
    const acceptedBy = first(order.assinaturaNome, order.signature_name, order.contatoNome, client.contato, '—');
    const acceptedDocument = maskDocument(first(order.assinaturaDocumento, order.signature_document, order.cpfResponsavel, order.rgResponsavel, client.cpf, client.cnpj));
    font(6.5, 'bold', theme.navy); doc.text(acceptedBy, rightX, signatureY + 28, { maxWidth: columnWidth });
    font(5.8, 'normal', theme.muted); doc.text(`Documento: ${acceptedDocument}`, rightX, signatureY + 32, { maxWidth: columnWidth });
    doc.text(`Aceite: ${formatDate(first(order.assinaturaEm, order.accepted_at, order.concluidoEm))}`, rightX, signatureY + 36, { maxWidth: columnWidth });
    page.y = signatureY + signatureHeight;
    if (has(first(order.aceiteObservacao, order.signature_note))) paragraph('Observação do aceite', first(order.aceiteObservacao, order.signature_note));

    drawSectionHeader(9, 'Rastreabilidade e auditoria');
    inlineRow([{ label: 'UUID do colaborador', value: employeeUuid, width: 92 }, { label: 'Hash de integridade', value: integrityHash, width: 88 }]);
    inlineRow([{ label: 'UUID da OS', value: first(order.id, '—'), width: 92 }, { label: 'Versão relacional', value: first(order.version, order.expected_version, '—'), width: 88 }]);
    inlineRow([{ label: 'Gerado em', value: formatDate(new Date().toISOString()), width: 92 }, { label: 'Fonte', value: 'DBS Control · registro relacional', width: 88 }]);

    const totalPages = doc.internal.getNumberOfPages();
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      doc.setPage(pageNumber);
      doc.setDrawColor(...theme.line); doc.setLineWidth(0.18); doc.line(M, pageHeight - 12, M + W, pageHeight - 12);
      font(6.2, 'normal', theme.muted); doc.text('DBS AIR · DBS Control', M, pageHeight - 6);
      doc.text(`OS ${protocol}`, M + W / 2, pageHeight - 6, { align: 'center' });
      doc.text(`Página ${pageNumber} de ${totalPages}`, M + W, pageHeight - 6, { align: 'right' });
    }
    return doc;
  }

  window.DbsControlPdf = { generate, equipment };
})();
