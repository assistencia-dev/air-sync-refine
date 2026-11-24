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
    const status = normalizeKey(order && (order.status ?? order.situacao ?? order.statusOS));
    return /^(concluid[ao]|finalizad[ao]|encerrad[ao]|fechad[ao])$/.test(status)
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

  function buildRouteLegs(stops) {
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
      if (originStop) params.set('origin', originStop.address);
      params.set('destination', destination.address);
      if (waypoints.length) params.set('waypoints', waypoints.join('|'));
      params.set('travelmode', 'driving');

      const url = 'https://www.google.com/maps/dir/?' + params.toString();
      legs.push({
        index: legs.length + 1,
        firstStop: start + 1,
        lastStop: start + group.length,
        origin: originStop ? originStop.address : '',
        destination: destination.address,
        url: url.length <= 2048 ? url : null,
        tooLong: url.length > 2048
      });
    }

    return legs;
  }

  root.DbsControlRoutePlanner = {
    addressFrom,
    orderAddress,
    buildStops,
    buildRouteLegs
  };
})(typeof window !== 'undefined' ? window : globalThis);
