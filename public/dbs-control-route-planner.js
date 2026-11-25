/* DBS Control — planejamento de rota por dia e técnico.
   Funções puras: não lê GPS, não consulta serviços externos e não altera OS. */
(function (root) {
  'use strict';

  const list = value => Array.isArray(value) ? value : [];
  const asText = value => (typeof value === 'string' || typeof value === 'number')
    ? String(value).trim()
    : '';
  const firstText = (...values) => values.map(asText).find(Boolean) || '';
  const normalizeKey = value => firstText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');

  function addressFrom(record) {
    if (!record || typeof record !== 'object') return asText(record);
    const direct = firstText(
      record.endereco,
      record.address,
      record.address_text,
      record.formatted_address,
      record.full_address
    );
    if (direct) return direct;

    const raw = record.address_json ?? record.addressJson;
    if (typeof raw === 'string') return raw.trim();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';

    const full = firstText(raw.texto, raw.endereco, raw.address, raw.formatted_address, raw.full_address);
    if (full) return full;

    return [
      raw.logradouro || raw.rua || raw.street,
      raw.numero || raw.number,
      raw.complemento || raw.complement,
      raw.bairro || raw.neighborhood,
      raw.cidade || raw.city,
      raw.uf || raw.state,
      raw.cep || raw.postal_code
    ].map(asText).filter(Boolean).join(', ');
  }

  function findById(records, id) {
    const key = asText(id);
    if (!key) return null;
    return list(records).find(record => record && [record.id, record.siteId, record.client_id]
      .some(value => value != null && String(value) === key)) || null;
  }

  function orderAddress(order, clients, sites) {
    const siteId = order && (order.siteId ?? order.localId ?? order.site_id);
    const clientId = order && (order.clienteId ?? order.client_id ?? order.clientId);
    const site = findById(sites, siteId);
    const client = findById(clients, clientId);
    return addressFrom(site) || addressFrom(order) || addressFrom(client);
  }

  function terminalStatus(order) {
    const status = normalizeKey(order && (order.status ?? order.situacao ?? order.statusOS))
      .replace(/[_-]+/g, ' ');
    return /^(concluid[ao](?: com pendencia)?|finalizad[ao]|encerrad[ao]|fechad[ao])$/.test(status)
      || status.includes('cancelad');
  }

  function scheduleTime(order) {
    const raw = firstText(order && order.scheduledAt, order && order.scheduled_at);
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function buildStops(orders, clients, sites) {
    const source = list(orders);
    const entries = [];
    let ignoredTerminalCount = 0;
    let missingAddressCount = 0;

    source.forEach((order, sourceIndex) => {
      if (!order || terminalStatus(order)) {
        if (order) ignoredTerminalCount += 1;
        return;
      }

      const address = orderAddress(order, clients, sites);
      if (!address) {
        missingAddressCount += 1;
        return;
      }

      const clientId = order.clienteId ?? order.client_id ?? order.clientId;
      const client = findById(clients, clientId);
      const siteId = order.siteId ?? order.localId ?? order.site_id;
      const site = findById(sites, siteId);
      const key = normalizeKey(address);
      let stop = entries.find(item => item.key === key);

      const orderInfo = {
        id: asText(order.id),
        protocol: firstText(order.protocolo, order.protocol, order.id),
        scheduledAt: firstText(order.scheduledAt, order.scheduled_at),
        sourceIndex
      };

      if (!stop) {
        stop = {
          key,
          address,
          label: firstText(site && site.nome, site && site.name, client && client.nome, client && client.name, 'Local de atendimento'),
          clientName: firstText(client && client.nome, client && client.name),
          siteName: firstText(site && site.nome, site && site.name),
          orders: [],
          sourceIndex,
          scheduledTimes: []
        };
        entries.push(stop);
      }

      if (orderInfo.id || orderInfo.protocol) stop.orders.push(orderInfo);
      const time = scheduleTime(order);
      if (time != null) stop.scheduledTimes.push(time);
    });

    const hasCompleteSchedule = entries.length > 0 && entries.every(stop => stop.scheduledTimes.length > 0);
    if (hasCompleteSchedule) {
      entries.sort((a, b) => Math.min(...a.scheduledTimes) - Math.min(...b.scheduledTimes)
        || a.sourceIndex - b.sourceIndex);
    }

    const stops = entries.map((stop, index) => ({
      sequence: index + 1,
      address: stop.address,
      label: stop.label,
      clientName: stop.clientName,
      siteName: stop.siteName,
      orders: stop.orders,
      scheduledAt: stop.scheduledTimes.length ? new Date(Math.min(...stop.scheduledTimes)).toISOString() : null
    }));

    return {
      stops,
      includedOrderCount: stops.reduce((total, stop) => total + stop.orders.length, 0),
      missingAddressCount,
      ignoredTerminalCount,
      sortedBySchedule: hasCompleteSchedule
    };
  }

  function buildRouteLegs(stops, routeOrigin) {
    const source = list(stops).filter(stop => stop && asText(stop.address));
    const maxStopsPerLeg = 4; // 3 waypoints + destino; sem GPS, a primeira parada vira a origem.
    const legs = [];
    let start = 0;

    while (start < source.length) {
      const previousStop = start > 0 ? source[start - 1] : null;
      const group = source.slice(start, start + maxStopsPerLeg);
      const destination = group[group.length - 1];
      // With one stop and no fresh technician GPS, open the customer location
      // instead of silently generating directions from the administrator's phone.
      if (!previousStop && !routeOrigin && group.length === 1) {
        const searchParams = new URLSearchParams();
        searchParams.set('api', '1');
        searchParams.set('query', destination.address);
        const url = 'https://www.google.com/maps/search/?' + searchParams.toString();
        legs.push({
          index: legs.length + 1,
          firstStop: start + 1,
          lastStop: start + 1,
          origin: '',
          destination: destination.address,
          url: url.length <= 2048 ? url : null,
          tooLong: url.length > 2048,
          kind: 'location'
        });
        start += group.length;
        continue;
      }
      const params = new URLSearchParams();
      params.set('api', '1');
      let originValue = previousStop ? previousStop.address : '';
      if (!previousStop && routeOrigin) {
        if (typeof routeOrigin === 'string') originValue = routeOrigin.trim();
        else if (Number.isFinite(Number(routeOrigin.lat)) && Number.isFinite(Number(routeOrigin.lng))) {
          originValue = Number(routeOrigin.lat) + ',' + Number(routeOrigin.lng);
        } else originValue = asText(routeOrigin.address);
      }
      // Nunca deixar o Maps usar a localização do administrador por engano
      // quando a rota está sendo planejada sem GPS recente do técnico.
      const waypoints = group.slice(0, -1).map(stop => stop.address);
      if (!previousStop && !originValue && group.length > 1) {
        originValue = group[0].address;
        waypoints.shift();
      }
      if (originValue) params.set('origin', originValue);
      params.set('destination', destination.address);
      if (waypoints.length) params.set('waypoints', waypoints.join('|'));
      params.set('travelmode', 'driving');

      const url = 'https://www.google.com/maps/dir/?' + params.toString();
      legs.push({
        index: legs.length + 1,
        firstStop: start + 1,
        lastStop: start + group.length,
        origin: originValue,
        destination: destination.address,
        url: url.length <= 2048 ? url : null,
        tooLong: url.length > 2048
      });
      start += group.length;
    }

    return legs;
  }

  function coordinate(value, minimum, maximum) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
  }

  function buildSiteCandidates(sites, clients) {
    const clientMap = new Map(list(clients).map(client => [asText(client && client.id), client]));
    const candidates = [];
    const review = [];
    const seen = new Set();
    const linkedClients = new Set();
    const activeSiteCountByClient = new Map();
    const countedActiveSiteIds = new Set();
    list(sites).forEach(site => {
      if (!site || typeof site !== 'object') return;
      const status = normalizeKey(site.status ?? site.situacao ?? 'ativo');
      const siteId = firstText(site.id, site.siteId, site.site_id);
      const clientId = firstText(site.clienteId, site.client_id, site.clientId);
      if (!siteId || !clientId || countedActiveSiteIds.has(siteId)
        || /inativ|inactive|arquiv|archiv|cancelad/.test(status)) return;
      countedActiveSiteIds.add(siteId);
      activeSiteCountByClient.set(clientId, (activeSiteCountByClient.get(clientId) || 0) + 1);
    });

    list(sites).forEach(site => {
      if (!site || typeof site !== 'object') return;
      const siteId = firstText(site.id, site.siteId, site.site_id);
      const clientId = firstText(site.clienteId, site.client_id, site.clientId);
      const status = normalizeKey(site.status ?? site.situacao ?? 'ativo');
      if (/inativ|inactive|arquiv|archiv|cancelad/.test(status)) return;
      if (!siteId || seen.has(siteId)) return;
      seen.add(siteId);
      const client = clientMap.get(clientId);
      if (!clientId || !client) {
        review.push({ id: siteId, name: firstText(site.nome, site.name, 'Local sem nome'), reason: 'Local sem vínculo válido com cliente; revisar cadastro.' });
        return;
      }
      const clientStatus = normalizeKey(client.status ?? client.situacao ?? 'ativo');
      if (/inativ|inactive|arquiv|archiv|cancelad/.test(clientStatus)) {
        review.push({ id: siteId, name: firstText(site.nome, site.name, 'Local sem nome'), reason: 'Cliente inativo/arquivado; local não incluído na rota.' });
        return;
      }
      linkedClients.add(clientId);
      const address = addressFrom(site) || addressFrom(client);
      if (!address) {
        review.push({ id: siteId, name: firstText(site.nome, site.name, 'Local sem nome'), reason: 'Local sem endereço cadastrado; não pode ser posicionado no mapa.' });
        return;
      }
      const lat = coordinate(site.latitude ?? site.lat ?? site.latitud ?? site.location_lat, -90, 90);
      const lng = coordinate(site.longitude ?? site.lng ?? site.long ?? site.location_lng, -180, 180);
      candidates.push({
        id: siteId,
        siteId,
        clientId,
        clientSiteCount: activeSiteCountByClient.get(clientId) || 0,
        name: firstText(site.nome, site.name, site.razaoSocial, client.nome, client.name, 'Local de atendimento'),
        clientName: firstText(client.nome, client.name, client.trade_name, 'Cliente'),
        address,
        lat,
        lng,
        distanceFromOriginKm: null
      });
    });

    // Clientes sem unidade/local próprio ainda podem ser roteirizados pelo
    // endereço cadastrado, sem inventar um site_id para a OS.
    list(clients).forEach(client => {
      const clientId = firstText(client && client.id);
      if (!clientId || linkedClients.has(clientId) || seen.has('client:' + clientId)) return;
      const clientStatus = normalizeKey(client.status ?? client.situacao ?? 'ativo');
      if (/inativ|inactive|arquiv|archiv|cancelad/.test(clientStatus)) return;
      const address = addressFrom(client);
      if (!address) return;
      seen.add('client:' + clientId);
      const lat = coordinate(client.latitude ?? client.lat, -90, 90);
      const lng = coordinate(client.longitude ?? client.lng ?? client.long, -180, 180);
      candidates.push({
        id: 'client:' + clientId,
        siteId: null,
        clientId,
        clientSiteCount: activeSiteCountByClient.get(clientId) || 0,
        name: firstText(client.nome, client.name, client.trade_name, 'Cliente'),
        clientName: firstText(client.nome, client.name, client.trade_name, 'Cliente'),
        address,
        lat,
        lng,
        distanceFromOriginKm: null
      });
    });

    return { candidates, review, activeSiteCountByClient: Object.fromEntries(activeSiteCountByClient) };
  }

  function enrichSiteCandidates(candidates, orders, equipment, nowValue = Date.now()) {
    const candidateRows = list(candidates);
    const sourceOrders = list(orders).filter(order => order && !order.deleted_at && !order.excluidaEm && !order.arquivadaEm);
    const sourceEquipment = list(equipment).filter(item => item && !item.deleted_at);
    const normalizeStatus = value => normalizeKey(value).replace(/[_-]+/g, ' ');
    const isCancelled = order => /cancelad/.test(normalizeStatus(order.status ?? order.situacao));
    const isTerminal = order => terminalStatus(order) || isCancelled(order);
    const isInProgress = order => /em atendimento|em andamento|execucao|deslocamento|em campo|in loco/.test(normalizeStatus(order.status ?? order.situacao));
    const isEmergency = order => [order.type, order.tipo, order.prioridade, order.priority]
      .map(normalizeStatus).join(' ').match(/emergenc|urgente|critico|alta|high/) !== null;
    const isOverdue = order => {
      if (isTerminal(order)) return false;
      const raw = firstText(order.sla, order.sla_deadline, order.slaDeadline);
      const due = raw ? Date.parse(raw) : NaN;
      return Number.isFinite(due) && due < nowValue;
    };
    const candidateSitesByClient = new Map();
    const knownSiteCountByClient = new Map(
      Object.entries(candidateRows.activeSiteCountByClient || {})
        .map(([clientId, count]) => [clientId, Number(count) || 0])
    );
    candidateRows.forEach(candidate => {
      const clientId = asText(candidate && (candidate.clientId ?? candidate.client_id));
      if (!clientId) return;
      const sites = candidateSitesByClient.get(clientId) || [];
      sites.push(asText(candidate.siteId ?? candidate.site_id ?? candidate.id));
      candidateSitesByClient.set(clientId, sites);
      const knownCount = Number(candidate.clientSiteCount);
      const previousCount = knownSiteCountByClient.get(clientId) || 0;
      knownSiteCountByClient.set(clientId, Math.max(previousCount, Number.isFinite(knownCount) ? knownCount : sites.length));
    });
    const isUniqueClientSite = clientId => {
      const matches = candidateRows.filter(candidate => asText(candidate && (candidate.clientId ?? candidate.client_id)) === clientId);
      const knownActiveSites = Number(knownSiteCountByClient.get(clientId) ?? (matches[0] && matches[0].clientSiteCount));
      if (knownActiveSites > 1) return false;
      if (knownActiveSites === 1) return matches.length === 1 && Boolean(matches[0]?.siteId ?? matches[0]?.site_id);
      return matches.length === 1;
    };
    const belongsToCandidate = (record, siteId, clientId) => {
      const recordSiteId = asText(record.siteId ?? record.localId ?? record.site_id);
      const recordClientId = asText(record.clienteId ?? record.client_id ?? record.clientId);
      if (recordSiteId) return recordSiteId === siteId;
      return Boolean(clientId && recordClientId === clientId && isUniqueClientSite(clientId));
    };

    const enriched = candidateRows.map(candidate => {
      const siteId = asText(candidate.siteId ?? candidate.site_id ?? candidate.id);
      const clientId = asText(candidate.clientId ?? candidate.client_id);
      const siteOrders = sourceOrders.filter(order => belongsToCandidate(order, siteId, clientId));
      const siteEquipment = sourceEquipment.filter(item => belongsToCandidate(item, siteId, clientId));
      const activeOrders = siteOrders.filter(order => !isTerminal(order));
      const inProgressCount = activeOrders.filter(isInProgress).length;
      const openCount = activeOrders.length - inProgressCount;
      const overdueCount = activeOrders.filter(isOverdue).length;
      const emergencyCount = activeOrders.filter(isEmergency).length;
      const activeEquipmentCount = siteEquipment.filter(item => !/inativ|baixad|desativ|arquiv/.test(normalizeStatus(item.status))).length;
      return {
        ...candidate,
        totalOrders: siteOrders.length,
        openOrders: openCount,
        inProgressOrders: inProgressCount,
        overdueOrders: overdueCount,
        emergencyOrders: emergencyCount,
        equipmentCount: siteEquipment.length,
        activeEquipmentCount,
        mapCoordinatesSource: candidate.lat != null && candidate.lng != null ? 'saved' : null
      };
    });

    const ordersWithoutSpecificSite = sourceOrders.filter(order => {
      const siteId = asText(order.siteId ?? order.localId ?? order.site_id);
      const clientId = asText(order.clienteId ?? order.client_id ?? order.clientId);
      return !siteId && !isTerminal(order) && (!clientId || !isUniqueClientSite(clientId));
    }).length;
    const equipmentWithoutSpecificSite = sourceEquipment.filter(item => {
      const siteId = asText(item.siteId ?? item.localId ?? item.site_id);
      const clientId = asText(item.clienteId ?? item.client_id ?? item.clientId);
      return !siteId && (!clientId || !isUniqueClientSite(clientId));
    }).length;
    enriched.unallocated = { orders: ordersWithoutSpecificSite, equipment: equipmentWithoutSpecificSite };
    return enriched;
  }

  function summarizeSiteMetrics(candidates) {
    const sites = list(candidates);
    const unallocated = sites.unallocated || {};
    return {
      locations: sites.length,
      mappedLocations: sites.filter(site => coordinate(site.lat, -90, 90) !== null && coordinate(site.lng, -180, 180) !== null).length,
      openOrders: sites.reduce((sum, site) => sum + Number(site.openOrders || 0), 0),
      inProgressOrders: sites.reduce((sum, site) => sum + Number(site.inProgressOrders || 0), 0),
      overdueOrders: sites.reduce((sum, site) => sum + Number(site.overdueOrders || 0), 0),
      emergencyOrders: sites.reduce((sum, site) => sum + Number(site.emergencyOrders || 0), 0),
      equipment: sites.reduce((sum, site) => sum + Number(site.equipmentCount || 0), 0),
      ordersWithoutSpecificSite: Number(unallocated.orders || 0),
      equipmentWithoutSpecificSite: Number(unallocated.equipment || 0)
    };
  }

  const radians = degrees => degrees * Math.PI / 180;
  function distanceKm(a, b) {
    const dLat = radians(b.lat - a.lat);
    const dLng = radians(b.lng - a.lng);
    const value = Math.sin(dLat / 2) ** 2
      + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  }

  function optimizeStops(stops, origin) {
    const remaining = list(stops)
      .filter(stop => coordinate(stop && stop.lat, -90, 90) !== null && coordinate(stop && stop.lng, -180, 180) !== null)
      .map(stop => ({ ...stop, lat: Number(stop.lat), lng: Number(stop.lng) }));
    const ordered = [];
    let cursor = origin && coordinate(origin.lat, -90, 90) !== null && coordinate(origin.lng, -180, 180) !== null
      ? { lat: Number(origin.lat), lng: Number(origin.lng) }
      : null;

    while (remaining.length) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      if (cursor) {
        remaining.forEach((stop, index) => {
          const distance = distanceKm(cursor, stop);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        });
      } else if (remaining.length > 1) {
        const center = remaining.reduce((sum, stop) => ({
          lat: sum.lat + stop.lat / remaining.length,
          lng: sum.lng + stop.lng / remaining.length
        }), { lat: 0, lng: 0 });
        let centralDistance = Infinity;
        remaining.forEach((stop, index) => {
          const distance = distanceKm(center, stop);
          if (distance < centralDistance) {
            centralDistance = distance;
            bestIndex = index;
          }
        });
      }
      const next = remaining.splice(bestIndex, 1)[0];
      next.sequence = ordered.length + 1;
      next.distanceFromPreviousKm = cursor && Number.isFinite(bestDistance)
        ? Math.round(bestDistance * 10) / 10
        : null;
      if (origin && ordered.length === 0 && cursor) {
        next.distanceFromTechnicianKm = Math.round(distanceKm(cursor, next) * 10) / 10;
      }
      ordered.push(next);
      cursor = next;
    }

    if (Array.isArray(stops) && stops.unallocated) ordered.unallocated = { ...stops.unallocated };
    return {
      stops: ordered,
      distanceEstimateKm: Math.round(ordered.reduce((total, stop) => total + (stop.distanceFromPreviousKm || 0), 0) * 10) / 10,
      hasOrigin: Boolean(origin && coordinate(origin.lat, -90, 90) !== null && coordinate(origin.lng, -180, 180) !== null)
    };
  }

  root.DbsControlRoutePlanner = {
    addressFrom,
    orderAddress,
    buildStops,
    buildSiteCandidates,
    enrichSiteCandidates,
    summarizeSiteMetrics,
    distanceKm,
    optimizeStops,
    buildRouteLegs
  };
})(typeof window !== 'undefined' ? window : globalThis);
