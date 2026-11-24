/* DBS Control — auditoria e otimização de rotas de serviços.
   Funções puras: não grava dados, não cria OS e não solicita localização. */
(function (root) {
  'use strict';
  const list = value => Array.isArray(value) ? value : [];
  const text = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim() : '';
  const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  const idOf = value => text(value && (value.id ?? value.siteId ?? value.site_id));
  const clientIdOf = value => text(value && (value.clienteId ?? value.client_id ?? value.clientId));
  const siteIdOf = value => text(value && (value.siteId ?? value.localId ?? value.site_id));
  const statusOf = order => norm(order && (order.status ?? order.situacao ?? order.statusOS));
  const terminal = order => /^(concluida|concluido|concluida com pendencia|cancelada|cancelado|finalizada|finalizado|encerrada|encerrado)$/.test(statusOf(order));
  const cancelled = order => /cancelad/.test(statusOf(order));
  const open = order => !terminal(order) && !cancelled(order) && !order?.excluidaEm && !order?.arquivadaEm && !order?.deleted_at;
  const typeFamily = value => {
    const type = norm(value);
    if (type.includes('pmoc')) return 'pmoc';
    if (type.includes('corretiva') || type === 'corretiva') return 'corretiva';
    if (type.includes('visita')) return 'visita';
    if (type.includes('preventiva') || type === 'preventiva') return 'preventiva';
    if (type.includes('instal') || type.includes('start up')) return 'instalacao';
    if (type.includes('retorno')) return 'retorno';
    if (type.includes('emerg')) return 'emergencial';
    if (type.includes('inspec') || type.includes('avaliac') || type.includes('vistoria')) return 'inspecao';
    if (type.includes('outro')) return 'outro';
    return type;
  };
  const isPmocType = value => typeFamily(value) === 'pmoc';
  const orderType = order => order && (order.tipo ?? order.type ?? order.tipoServico ?? order.service_name);
  const isPmocOrder = order => ['pmoc','preventiva'].includes(typeFamily(orderType(order)));

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

  function monthOf(value) {
    const raw = text(value);
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return br[3] + '-' + br[2];
    return raw.slice(0,7);
  }

  function dayOf(value) {
    const raw = text(value);
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return br[3] + '-' + br[2] + '-' + br[1];
    return raw.slice(0,10);
  }

  function buildCandidates(sites, clients, orders, competence, options = {}) {
    const serviceType = text(options.serviceType) || 'PMOC Preventiva · Mensal';
    const pmocMode = isPmocType(serviceType);
    const routeDate = text(options.routeDate);
    const serviceFamily = typeFamily(serviceType);
    const clientMap = new Map(list(clients).map(row => [idOf(row), row]));
    const siteRows = list(sites);
    const sourceOrders = list(orders).filter(order => order && !order.excluidaEm && !order.arquivadaEm && !order.deleted_at);
    const candidates = [];
    const review = [];
    const monthOrders = sourceOrders.filter(order => isPmocOrder(order)
      && monthOf(order.data || order.createdAt || order.created_at || order.scheduledAt || order.scheduled_at) === competence);
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

      const allSiteOrders = sourceOrders.filter(order => siteIdOf(order) === siteId);
      if (pmocMode) {
        const siteOrders = monthOrders.filter(order => siteIdOf(order) === siteId);
        const legacyAmbiguous = monthOrders.filter(order => clientIdOf(order) === clientId && !siteIdOf(order));
        const openOrders = siteOrders.filter(open);
        const returns = siteOrders.filter(order => order.pmocResultado === 'retorno' || order.pmocPrecisaRetorno || statusOf(order).includes('retorno'));
        const done = siteOrders.some(order => terminal(order) && !cancelled(order));
        if (siteOrders.some(cancelled) && !openOrders.length && !done && !returns.length) {
          review.push({ id: siteId, name, address, clientName: text(client.nome ?? client.name ?? client.trade_name), reason: 'Há OS PMOC cancelada nesta competência; revisar o motivo antes de gerar outra.' });
          continue;
        }
        if (openOrders.length && !returns.length) continue;
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
          existingOrderIds: siteOrders.map(order => text(order.id)).filter(Boolean),
          existingOpenCount: openOrders.length,
          warning: ''
        });
        continue;
      }

      // Outros atendimentos começam com uma lista de locais ativos. Nada é
      // selecionado ou emitido automaticamente: o administrador escolhe cada parada.
      const matchingOrders = allSiteOrders.filter(order => typeFamily(orderType(order)) === serviceFamily);
      const existingOpen = matchingOrders.filter(open);
      const ambiguous = sourceOrders.filter(order => clientIdOf(order) === clientId
        && !siteIdOf(order) && typeFamily(orderType(order)) === serviceFamily);
      const warning = existingOpen.length
        ? 'Há ' + existingOpen.length + ' OS deste tipo ainda em aberto neste local; confira se não é a mesma solicitação.'
        : '';
      candidates.push({
        id: siteId, siteId, clientId, name,
        clientName: text(client.nome ?? client.name ?? client.trade_name) || 'Cliente',
        address, status: 'disponivel',
        reason: warning || (ambiguous.length ? 'Há histórico deste tipo sem loja vinculada; confira antes de emitir.' : 'Local disponível para programar atendimento'),
        existingOrderIds: matchingOrders.map(order => text(order.id)).filter(Boolean),
        existingOpenCount: existingOpen.length,
        warning: [warning, ambiguous.length ? 'Há ' + ambiguous.length + ' OS antigas deste cliente sem loja vinculada.' : ''].filter(Boolean).join(' ')
      });
    }

    const sitesByClient = new Set(siteRows.filter(site => activeSiteIds.has(idOf(site))).map(clientIdOf));
    for (const client of list(clients)) {
      const clientId = idOf(client);
      if (!sitesByClient.has(clientId)) review.push({
        id: clientId,
        name: text(client.nome ?? client.name ?? client.trade_name) || 'Cliente sem loja',
        reason: 'Cliente sem loja/unidade ativa vinculada; não programar atendimento automaticamente.'
      });
    }

    return {
      candidates,
      review,
      competence,
      routeDate,
      serviceType,
      pmocMode,
      sourceOrderCount: pmocMode ? monthOrders.length : sourceOrders.length
    };
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
    if (!cursor && remaining.length > 1) {
      const center = remaining.reduce((sum, stop) => ({ lat: sum.lat + stop.lat / remaining.length, lng: sum.lng + stop.lng / remaining.length }), { lat: 0, lng: 0 });
      let centralIndex = 0, centralDistance = Infinity;
      remaining.forEach((stop, index) => { const distance = distanceKm(center, stop); if (distance < centralDistance) { centralDistance = distance; centralIndex = index; } });
      const first = remaining.splice(centralIndex, 1)[0];
      first.distanceFromPreviousKm = null;
      first.sequence = 1;
      ordered.push(first);
      cursor = first;
    }
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

  root.DbsServiceRoutePlanner = { addressFrom, buildCandidates, distanceKm, optimize, typeFamily, dayOf, monthOf };
  // Alias to keep old PMOC route scripts and contracts backwards-compatible.
  root.DbsPmocRoutePlanner = root.DbsServiceRoutePlanner;
})(typeof window !== 'undefined' ? window : globalThis);
