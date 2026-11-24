/* DBS Control — conciliação e otimização de rotas PMOC.
   Funções puras; não grava dados nem solicita localização. */
(function (root) {
  'use strict';
  const list = value => Array.isArray(value) ? value : [];
  const text = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
  const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  const idOf = value => text(value && (value.id ?? value.siteId ?? value.site_id));
  const clientIdOf = value => text(value && (value.clienteId ?? value.client_id ?? value.clientId));
  const siteIdOf = value => text(value && (value.siteId ?? value.localId ?? value.site_id));
  const terminal = order => /^(concluida|concluido|concluida com pendencia|cancelada|cancelado|finalizada|finalizado)$/.test(norm(order && (order.status ?? order.situacao ?? order.statusOS)));
  const isPmoc = order => /pmoc|preventiv/.test(norm(order && (order.tipo ?? order.type ?? order.tipoServico ?? order.service_name)));
  function addressFrom(record) {
    if (!record || typeof record !== 'object') return text(record);
    const direct = text(record.endereco ?? record.address ?? record.address_text ?? record.formatted_address);
    if (direct) return direct;
    const raw = record.address_json ?? record.addressJson;
    if (typeof raw === 'string') return raw.trim();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
    const full = text(raw.texto ?? raw.endereco ?? raw.address ?? raw.formatted_address);
    if (full) return full;
    return [raw.logradouro ?? raw.rua ?? raw.street, raw.numero ?? raw.number, raw.complemento ?? raw.complement, raw.bairro ?? raw.neighborhood, raw.cidade ?? raw.city, raw.uf ?? raw.state, raw.cep ?? raw.postal_code].map(text).filter(Boolean).join(', ');
  }
  function buildCandidates(sites, clients, orders, competence) {
    const clientMap = new Map(list(clients).map(row => [idOf(row), row]));
    const siteRows = list(sites);
    const candidates = [];
    const review = [];
    const monthOrders = list(orders).filter(order => !order.excluidaEm && !order.arquivadaEm && !order.deleted_at && isPmoc(order) && text(order.data ?? order.createdAt ?? order.created_at).slice(0,7) === competence);
    const activeSiteIds = new Set(siteRows.filter(site => !/inativ|arquiv/.test(norm(site.status))).map(idOf));
    for (const site of siteRows) {
      const siteId = idOf(site);
      const clientId = clientIdOf(site);
      const client = clientMap.get(clientId);
      const name = text(site.nome ?? site.name) || 'Loja sem nome';
      if (!siteId || !clientId || !client) {
        review.push({ id: siteId || clientId || name, name, reason: 'Loja sem vínculo válido com cliente; revisar cadastro.' });
        continue;
      }
      if (!activeSiteIds.has(siteId)) continue;
      const address = addressFrom(site);
      if (!address) {
        review.push({ id: siteId, name, clientName: text(client.nome ?? client.name ?? client.trade_name), reason: 'Endereço da loja incompleto; não é possível posicionar no mapa.' });
        continue;
      }
      const siteOrders = monthOrders.filter(order => siteIdOf(order) === siteId);
      const legacyAmbiguous = monthOrders.filter(order => clientIdOf(order) === clientId && !siteIdOf(order));
      const open = siteOrders.filter(order => !terminal(order) && !/cancelad/.test(norm(order.status)));
      const returns = siteOrders.filter(order => order.pmocResultado === 'retorno' || order.pmocPrecisaRetorno || norm(order.status).includes('retorno'));
      const done = siteOrders.some(terminal);
      if (open.length && !returns.length) continue;
      if (done && !returns.length) continue;
      if (!siteOrders.length && legacyAmbiguous.length) {
        review.push({ id: siteId, name, address, clientName: text(client.nome ?? client.name ?? client.trade_name), reason: 'Existe OS PMOC do cliente sem loja vinculada nesta competência; conciliar antes de emitir outra.' });
        continue;
      }
      candidates.push({
        id: siteId, siteId, clientId, name,
        clientName: text(client.nome ?? client.name ?? client.trade_name) || 'Cliente',
        address, status: returns.length ? 'retorno' : 'pendente',
        reason: returns.length ? 'Retorno PMOC registrado nesta loja' : 'Sem OS PMOC desta loja na competência',
        existingOrderIds: siteOrders.map(order => text(order.id)).filter(Boolean)
      });
    }
    const sitesByClient = new Set(siteRows.filter(site => activeSiteIds.has(idOf(site))).map(clientIdOf));
    for (const client of list(clients)) {
      const clientId = idOf(client);
      if (!sitesByClient.has(clientId)) review.push({ id: clientId, name: text(client.nome ?? client.name ?? client.trade_name) || 'Cliente sem loja', reason: 'Cliente sem loja/unidade ativa vinculada; não criar OS PMOC automaticamente.' });
    }
    return { candidates, review, competence, sourceOrderCount: monthOrders.length };
  }
  const radians = degrees => degrees * Math.PI / 180;
  function distanceKm(a,b) {
    const dLat = radians(b.lat-a.lat), dLon = radians(b.lng-a.lng);
    const value = Math.sin(dLat/2)**2 + Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLon/2)**2;
    return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1-value));
  }
  function optimize(stops, origin) {
    const remaining = list(stops).filter(stop => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng))).map(stop => ({...stop,lat:Number(stop.lat),lng:Number(stop.lng)}));
    const ordered = [];
    let cursor = origin && Number.isFinite(Number(origin.lat)) && Number.isFinite(Number(origin.lng))
      ? {lat:Number(origin.lat),lng:Number(origin.lng)} : null;
    while (remaining.length) {
      let bestIndex = 0, bestDistance = Infinity;
      if (cursor) remaining.forEach((stop,index) => { const distance = distanceKm(cursor,stop); if (distance < bestDistance) { bestDistance=distance; bestIndex=index; } });
      const next = remaining.splice(bestIndex,1)[0];
      next.distanceFromPreviousKm = Number.isFinite(bestDistance) ? Math.round(bestDistance*10)/10 : null;
      next.sequence = ordered.length + 1;
      ordered.push(next); cursor = next;
    }
    return { stops:ordered, distanceEstimateKm:Math.round(ordered.reduce((sum,stop)=>sum+(stop.distanceFromPreviousKm||0),0)*10)/10, hasOrigin:Boolean(origin) };
  }
  root.DbsPmocRoutePlanner = { addressFrom, buildCandidates, distanceKm, optimize };
})(typeof window !== 'undefined' ? window : globalThis);
