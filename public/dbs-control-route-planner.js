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
    const maxStopsPerLeg = 4; // 3 waypoints + destino: compatível com navegador móvel.
    const legs = [];

    for (let start = 0; start < source.length; start += maxStopsPerLeg) {
      const group = source.slice(start, start + maxStopsPerLeg);
      const originStop = start > 0 ? source[start - 1] : null;
      const destination = group[group.length - 1];
      const waypoints = group.slice(0, -1).map(stop => stop.address);
      const params = new URLSearchParams();
      params.set('api', '1');
      let originValue = originStop ? originStop.address : '';
      if (!originStop && routeOrigin) {
        if (typeof routeOrigin === 'string') originValue = routeOrigin.trim();
        else if (Number.isFinite(Number(routeOrigin.lat)) && Number.isFinite(Number(routeOrigin.lng))) {
          originValue = Number(routeOrigin.lat) + ',' + Number(routeOrigin.lng);
        } else originValue = asText(routeOrigin.address);
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

    list(sites).forEach(site => {
      if (!site || typeof site !== 'object') return;
      const siteId = firstText(site.id, site.siteId, site.site_id);
      const clientId = firstText(site.clienteId, site.client_id, site.clientId);
      const status = normalizeKey(site.status ?? site.situacao ?? 'ativo');
      if (/inativ|arquiv|cancelad/.test(status)) return;
      if (!siteId || seen.has(siteId)) return;
      seen.add(siteId);
      const client = clientMap.get(clientId);
      if (!clientId || !client) {
        review.push({ id: siteId, name: firstText(site.nome, site.name, 'Local sem nome'), reason: 'Local sem vínculo válido com cliente; revisar cadastro.' });
        return;
      }
      const clientStatus = normalizeKey(client.status ?? client.situacao ?? 'ativo');
      if (/inativ|arquiv|cancelad/.test(clientStatus)) {
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
      if (/inativ|arquiv|cancelad/.test(clientStatus)) return;
      const address = addressFrom(client);
      if (!address) return;
      seen.add('client:' + clientId);
      const lat = coordinate(client.latitude ?? client.lat, -90, 90);
      const lng = coordinate(client.longitude ?? client.lng ?? client.long, -180, 180);
      candidates.push({
        id: 'client:' + clientId,
        siteId: null,
        clientId,
        name: firstText(client.nome, client.name, client.trade_name, 'Cliente'),
        clientName: firstText(client.nome, client.name, client.trade_name, 'Cliente'),
        address,
        lat,
        lng,
        distanceFromOriginKm: null
      });
    });

    return { candidates, review };
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
    distanceKm,
    optimizeStops,
    buildRouteLegs
  };
})(typeof window !== 'undefined' ? window : globalThis);
