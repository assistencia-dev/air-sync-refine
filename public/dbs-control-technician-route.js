/* DBS CONTROL · despacho inteligente antes da abertura de OS.
   Planeja a partir do técnico, da última posição autorizada e dos locais cadastrados.
   Nenhuma OS é criada até a aprovação explícita do administrador. */
(function () {
  'use strict';

  const state = {
    technician: null,
    location: null,
    candidates: [],
    selected: [],
    review: [],
    siteMetrics: null,
    map: null,
    mapLayer: null,
    mapLibrary: null,
    originEnabled: false,
    requestId: null,
    creating: false,
    result: null,
    manualOrder: false,
    geocoding: false,
    geocodeQueue: [],
    geocodingIds: new Set(),
    geocodeGeneration: 0,
    locationGeneration: 0,
    technicians: [],
    techniciansLoaded: false
  };

  const SERVICE_TYPES = [
    'PMOC Preventiva · Mensal',
    'PMOC Preventiva · Trimestral',
    'Manutenção Corretiva',
    'Visita Técnica',
    'Manutenção Preventiva',
    'Instalação / Start-Up',
    'Atendimento Emergencial',
    'Inspeção Técnica',
    'Outro'
  ];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const byId = id => document.getElementById(id);
  const safe = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const currentDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    return parts.find(x => x.type === 'year').value + '-'
      + parts.find(x => x.type === 'month').value + '-'
      + parts.find(x => x.type === 'day').value;
  };
  const dateTime = value => value
    ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'Não informado';
  const ageLabel = milliseconds => {
    if (milliseconds == null) return 'sem horário de atualização';
    const minutes = Math.max(0, Math.floor(milliseconds / 60000));
    if (minutes < 1) return 'há menos de 1 minuto';
    if (minutes < 60) return 'há ' + minutes + ' min';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return 'há ' + hours + ' h';
    return 'há ' + Math.floor(hours / 24) + ' dia(s)';
  };
  const isPmoc = value => /pmoc/i.test(String(value || ''));
  const requiresCause = value => /corretiv|emergencial/i.test(String(value || ''));
  const planner = () => window.DbsControlRoutePlanner;

  // ERP_STATE é declarado como "let" no script principal do iframe. Nesse
  // caso ele existe no escopo global léxico, mas NÃO em window.ERP_STATE.
  function getErpState() {
    if (typeof ERP_STATE !== 'undefined' && ERP_STATE && typeof ERP_STATE === 'object') return ERP_STATE;
    return window.ERP_STATE && typeof window.ERP_STATE === 'object' ? window.ERP_STATE : {};
  }

  function getEmployeeId(technician) {
    const value = String(technician && (
      technician.employeeId || technician.employee_id || technician.rhEmployeeId || technician.rh_employee_id || technician.id
    ) || '').trim();
    return UUID.test(value) ? value : '';
  }

  function getTechnicians() {
    const erp = getErpState();
    const source = state.techniciansLoaded ? state.technicians : [];
    const seen = new Set();
    return source.filter(item => {
      if (!item || item.is_active === false || item.active === false
        || item.deleted || item.deleted_at || item.archived_at || item.archivedAt) return false;
      const status = String(item.status || item.situacao || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
      if (/^(inativ[oa]|arquivad[oa]|excluid[oa]|cancelad[oa])$/.test(status)) return false;
      const role = String(item.posicao || item.position || item.cargo || "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (!/(tecnic|hvac|refriger|instalad|mecanic|manutenc)/.test(role)) return false;
      const employeeId = getEmployeeId(item);
      if (!employeeId || seen.has(employeeId)) return false;
      seen.add(employeeId);
      return true;
    }).map(item => {
      const employeeId = getEmployeeId(item);
      return { ...item, id: employeeId, employeeId };
    });
  }

  function requestActiveTechnicians() {
    return new Promise(resolve => {
      const requestId = 'dispatch-technicians-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(value);
      };
      const onMessage = event => {
        if (event.source !== window.parent || event.data?.type !== 'DBS_CONTROL_ACTIVE_TECHNICIANS_RESULT'
          || String(event.data.requestId || '') !== requestId) return;
        finish(event.data);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'A consulta dos técnicos ativos expirou.' }), 12000);
      window.addEventListener('message', onMessage);
      window.parent.postMessage({ type: 'DBS_CONTROL_LIST_ACTIVE_TECHNICIANS', requestId }, window.location.origin);
    });
  }

  async function loadActiveTechnicians(preferredId) {
    const select = byId('dbs-dispatch-technician');
    if (!select) return;
    const status = byId('dbs-dispatch-status');
    let loadError = null;
    try {
      const result = await requestActiveTechnicians();
      if (!result || !result.ok || !Array.isArray(result.technicians)) {
        throw new Error(result && result.error || 'Não foi possível consultar o cadastro ativo do RH.');
      }
      state.technicians = result.technicians;
      state.techniciansLoaded = true;
    } catch (error) {
      state.technicians = [];
      state.techniciansLoaded = true;
      loadError = error && error.message || 'Consulta do RH indisponível.';
    }
    const technicians = getTechnicians();
    const keepId = String(preferredId || state.technician?.id || '');
    select.innerHTML = '<option value="">'
      + (technicians.length ? 'Selecione um técnico ativo' : 'Nenhum técnico ativo encontrado no RH')
      + '</option>'
      + technicians.map(tech => '<option value="' + safe(tech.id) + '">' + safe(getTechnicianLabel(tech)) + '</option>').join('');
    select.value = technicians.some(tech => String(tech.id) === keepId) ? keepId : '';
    if (select.value) select.dispatchEvent(new Event('change'));
    else {
      state.technician = null;
      if (status) {
        status.textContent = loadError
          ? 'GPS do técnico indisponível (' + loadError + '). O mapa de clientes será carregado pelo endereço cadastrado.'
          : 'Selecione um técnico para usar o GPS como origem. O mapa de clientes será carregado independentemente.';
      }
      void buildSuggestions();
    }
  }

  function getTechnicianLabel(technician) {
    return String(technician && (technician.nome || technician.name || technician.full_name) || 'Técnico').trim();
  }

  function originForRoute() {
    const location = state.location;
    if (!state.originEnabled || !location) return null;
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat, lng: lng } : null;
  }

  function resetPlan() {
    state.candidates = [];
    state.selected = [];
    state.review = [];
    state.siteMetrics = null;
    state.manualOrder = false;
    state.result = null;
    state.geocoding = false;
    state.geocodeQueue = [];
    state.geocodingIds = new Set();
    state.geocodeGeneration += 1;
    state.locationGeneration += 1;
  }

  function ensureStyle() {
    if (byId('dbs-dispatch-route-style')) return;
    const style = document.createElement('style');
    style.id = 'dbs-dispatch-route-style';
    style.textContent = [
      '#dbs-dispatch-route-modal{position:fixed;inset:0;z-index:9600;display:flex;align-items:center;justify-content:center;padding:12px;background:rgba(8,20,37,.68)}',
      '#dbs-dispatch-route-modal *{box-sizing:border-box}',
      '#dbs-dispatch-route-modal .dbs-dispatch-dialog{width:min(1120px,100%);max-height:94vh;overflow:auto;border:1px solid #d8e4ef;border-radius:20px;background:#f8fafc;color:#172b43;box-shadow:0 26px 90px rgba(0,0,0,.3)}',
      '#dbs-dispatch-route-modal .dbs-dispatch-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px;background:#10243b;color:#fff}',
      '#dbs-dispatch-route-modal h2{margin:0;font-size:19px;font-weight:900;color:#fff}',
      '#dbs-dispatch-route-modal h3{margin:0;font-size:13px;font-weight:900;color:#183b5a}',
      '#dbs-dispatch-route-modal p{margin:4px 0 0;font-size:11px;line-height:1.5;color:#60758c}',
      '#dbs-dispatch-route-modal .dbs-dispatch-close{width:40px;height:40px;border:1px solid #ffffff35;border-radius:10px;background:#ffffff12;color:#fff;font-size:23px;cursor:pointer}',
      '#dbs-dispatch-route-modal .dbs-dispatch-body{padding:16px;display:grid;gap:13px}',
      '#dbs-dispatch-route-modal .dbs-dispatch-card{padding:13px;border:1px solid #dce6ef;border-radius:14px;background:#fff}',
      '#dbs-dispatch-route-modal .dbs-dispatch-toolbar{display:grid;grid-template-columns:minmax(200px,1fr) 170px auto;gap:10px;align-items:end}',
      '#dbs-dispatch-route-modal label{display:block;font-size:10px;font-weight:850;color:#466078}',
      '#dbs-dispatch-route-modal input,#dbs-dispatch-route-modal select,#dbs-dispatch-route-modal textarea{width:100%;min-height:40px;margin-top:5px;padding:9px 10px;border:1px solid #cbd8e4;border-radius:9px;background:#fff;color:#172b43;font:inherit;font-size:12px}',
      '#dbs-dispatch-route-modal textarea{min-height:66px;resize:vertical}',
      '#dbs-dispatch-route-modal button{font:inherit}',
      '#dbs-dispatch-route-modal .dbs-dispatch-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:9px 13px;border:0;border-radius:9px;background:#1769c2;color:#fff;font-size:11px;font-weight:900;cursor:pointer}',
      '#dbs-dispatch-route-modal .dbs-dispatch-btn.secondary{border:1px solid #cfdae5;background:#fff;color:#294762}',
      '#dbs-dispatch-route-modal .dbs-dispatch-btn.danger{background:#fff1f1;color:#a52e2e;border:1px solid #f1cccc}',
      '#dbs-dispatch-route-modal .dbs-dispatch-btn:disabled{opacity:.45;cursor:not-allowed}',
      '#dbs-dispatch-route-modal .dbs-dispatch-location{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:11px;padding:11px;border:1px solid #d8e6f3;border-radius:11px;background:#f3f8fd}',
      '#dbs-dispatch-route-modal .dbs-dispatch-location strong{display:block;font-size:12px;color:#183b5a}',
      '#dbs-dispatch-route-modal .dbs-dispatch-location small{display:block;margin-top:3px;font-size:10px;color:#65798f;line-height:1.45}',
      '#dbs-dispatch-route-modal .dbs-dispatch-origin-toggle{display:flex;align-items:center;gap:8px;margin-top:9px;font-size:11px;color:#27445e}',
      '#dbs-dispatch-route-modal .dbs-dispatch-origin-toggle input{width:16px;min-height:16px;margin:0}',
      '#dbs-dispatch-route-modal .dbs-dispatch-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:7px;margin-top:11px}',
      '#dbs-dispatch-route-modal .dbs-dispatch-metric{display:flex;flex-direction:column;gap:2px;min-width:0;padding:9px 10px;border:1px solid #dfe8f0;border-radius:10px;background:#f8fbfe}',
      '#dbs-dispatch-route-modal .dbs-dispatch-metric strong{font-size:18px;line-height:1.1;color:#173b60}',
      '#dbs-dispatch-route-modal .dbs-dispatch-metric span{font-size:9px;font-weight:800;color:#65798f}',
      '#dbs-dispatch-route-modal .dbs-dispatch-route-label{border:0;border-radius:8px;background:#1d4ed8;color:white;font-size:10px;font-weight:900;box-shadow:0 2px 8px #0f172a33}',
      '#dbs-dispatch-route-modal .dbs-dispatch-map{height:300px;min-height:240px;overflow:hidden;border:1px solid #d8e2ec;border-radius:13px;background:#eaf0f5}',
      '#dbs-dispatch-route-modal .dbs-dispatch-columns{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}',
      '#dbs-dispatch-route-modal .dbs-dispatch-list{display:grid;gap:8px;max-height:390px;overflow:auto;margin-top:10px}',
      '#dbs-dispatch-route-modal .dbs-dispatch-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:9px;align-items:center;padding:10px;border:1px solid #e0e8f0;border-radius:11px;background:#fff}',
      '#dbs-dispatch-route-modal .dbs-dispatch-item strong{display:block;font-size:11px;color:#24435f;overflow-wrap:anywhere}',
      '#dbs-dispatch-route-modal .dbs-dispatch-item small{display:block;margin-top:3px;font-size:10px;line-height:1.4;color:#718399;overflow-wrap:anywhere}',
      '#dbs-dispatch-route-modal .dbs-dispatch-number{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;background:#e7f1fb;color:#155a9c;font-size:11px;font-weight:900}',
      '#dbs-dispatch-route-modal .dbs-dispatch-actions{display:flex;gap:4px;align-items:center}',
      '#dbs-dispatch-route-modal .dbs-dispatch-iconbtn{width:30px;height:30px;border:1px solid #d7e1eb;border-radius:8px;background:#fff;color:#245273;font-weight:900;cursor:pointer}',
      '#dbs-dispatch-route-modal .dbs-dispatch-stop-fields{grid-column:2 / 4;display:grid;grid-template-columns:minmax(180px,.8fr) minmax(220px,1.2fr);gap:8px;width:100%}',
      '#dbs-dispatch-route-modal .dbs-dispatch-stop-fields label{font-size:9px}',
      '#dbs-dispatch-route-modal .dbs-dispatch-stop-fields input,#dbs-dispatch-route-modal .dbs-dispatch-stop-fields select{min-height:36px;font-size:11px}',
      '#dbs-dispatch-route-modal .dbs-dispatch-review{padding:10px 12px;border:1px solid #f1dcaa;border-radius:10px;background:#fffbeb;color:#875a0b;font-size:10px;line-height:1.5}',
      '#dbs-dispatch-route-modal .dbs-dispatch-status{padding:11px 12px;border:1px solid #d8e6f3;border-radius:10px;background:#f3f8fd;color:#31516e;font-size:11px;line-height:1.5}',
      '#dbs-dispatch-route-modal .dbs-dispatch-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-top:12px;border-top:1px solid #e2eaf1}',
      '#dbs-dispatch-route-modal .dbs-dispatch-footer strong{font-size:12px;color:#173b5a}',
      '#dbs-dispatch-route-modal .dbs-dispatch-maplinks{display:grid;gap:7px;margin-top:9px}',
      '#dbs-dispatch-route-modal .dbs-dispatch-maplink{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 11px;border:1px solid #dce5ee;border-radius:10px;background:#fff}',
      '#dbs-dispatch-route-modal .dbs-dispatch-maplink span{font-size:10px;color:#50677e}',
      '#dbs-dispatch-route-modal .dbs-dispatch-empty{padding:18px;border:1px dashed #cbd7e2;border-radius:10px;background:#fff;text-align:center;font-size:11px;color:#73869a}',
      '@media(max-width:760px){#dbs-dispatch-route-modal{padding:5px;align-items:flex-end}#dbs-dispatch-route-modal .dbs-dispatch-dialog{max-height:96vh;border-radius:16px}#dbs-dispatch-route-modal .dbs-dispatch-toolbar{grid-template-columns:1fr 1fr}#dbs-dispatch-route-modal .dbs-dispatch-toolbar .dbs-dispatch-btn{grid-column:1 / -1;width:100%}#dbs-dispatch-route-modal .dbs-dispatch-columns{grid-template-columns:1fr}#dbs-dispatch-route-modal .dbs-dispatch-map{height:260px}#dbs-dispatch-route-modal .dbs-dispatch-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}#dbs-dispatch-route-modal .dbs-dispatch-metric:first-child{grid-column:span 2}#dbs-dispatch-route-modal .dbs-dispatch-stop-fields{grid-template-columns:1fr}#dbs-dispatch-route-modal .dbs-dispatch-footer{align-items:stretch}#dbs-dispatch-route-modal .dbs-dispatch-footer .dbs-dispatch-btn{width:100%}}'
    ].join('');
    document.head.appendChild(style);
  }

  function closePlanner() {
    const modal = byId('dbs-dispatch-route-modal');
    if (modal) {
      const previous = modal.__previousFocus;
      modal.remove();
      if (previous && typeof previous.focus === 'function') previous.focus();
    }
    if (state.map) {
      state.map.remove();
      state.map = null;
      state.mapLayer = null;
      state.mapLibrary = null;
    }
  }

  function requestTechnicianLocation(employeeId) {
    return new Promise(resolve => {
      const requestId = 'fleet-route-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(value);
      };
      const onMessage = event => {
        if (event.source !== window.parent || event.data?.type !== 'DBS_CONTROL_TECHNICIAN_LOCATION_RESULT'
          || String(event.data.requestId || '') !== requestId) return;
        finish(event.data);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'A consulta de localização expirou. Tente atualizar novamente.' }), 10000);
      window.addEventListener('message', onMessage);
      window.parent.postMessage({
        type: 'DBS_CONTROL_GET_TECHNICIAN_LOCATION',
        requestId: requestId,
        employeeId: employeeId
      }, window.location.origin);
    });
  }

  async function refreshLocation() {
    const generation = ++state.locationGeneration;
    const employeeId = getEmployeeId(state.technician);
    state.location = null;
    state.originEnabled = false;
    const box = byId('dbs-dispatch-location-summary');
    if (box) box.innerHTML = '<strong>Consultando última posição compartilhada…</strong><small>O planejamento dos endereços continua carregado enquanto o GPS é consultado.</small>';
    const toggle = byId('dbs-dispatch-use-origin');
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = true;
    }
    if (!employeeId) {
      if (generation !== state.locationGeneration) return;
      if (box) box.innerHTML = '<strong>Este técnico ainda não está vinculado a um colaborador do RH.</strong><small>A rota continua disponível pelos endereços cadastrados; o GPS não será usado como origem.</small>';
      renderMapAndLinks();
      return;
    }
    let result;
    try {
      result = await requestTechnicianLocation(employeeId);
    } catch (error) {
      if (generation !== state.locationGeneration) return;
      if (box) box.innerHTML = '<strong>Consulta de GPS indisponível.</strong><small>' + safe(error && error.message || 'O mapa e a navegação pelos endereços continuam disponíveis.') + '</small>';
      renderMapAndLinks();
      return;
    }
    if (generation !== state.locationGeneration) return;
    if (!result || !result.ok) {
      if (box) box.innerHTML = '<strong>Não foi possível obter a posição.</strong><small>' + safe(result && result.error || 'O mapa e a navegação pelos endereços continuam disponíveis.') + '</small>';
      renderMapAndLinks();
      return;
    }
    state.location = result.location || null;
    const location = state.location;
    const hasCoordinates = location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
    if (!location || !hasCoordinates) {
      const gpsMessage = String(result.warning || '').trim();
      if (box) box.innerHTML = '<strong>' + safe(gpsMessage ? 'GPS ainda indisponível neste banco' : 'Nenhuma posição compartilhada encontrada.') + '</strong><small>'
        + safe(gpsMessage || 'O mapa dos clientes continua disponível pelos endereços cadastrados, mesmo sem GPS do técnico.')
        + ' A rota poderá ser organizada pelos endereços, sem afirmar onde o técnico está.</small>';
      renderMapAndLinks();
      return;
    }
    state.originEnabled = Boolean(location.is_live);
    if (toggle) {
      toggle.disabled = !location.is_live;
      toggle.checked = state.originEnabled;
    }
    const status = location.location_source === 'ponto'
      ? 'Última coordenada da batida de ponto · NÃO é rastreamento ao vivo'
      : location.is_live ? 'GPS atualizado nos últimos 3 minutos' : 'Última posição conhecida · pode estar desatualizada';
    const accuracy = location.accuracy_m == null ? '' : ' · precisão aproximada ±' + Math.round(Number(location.accuracy_m)) + ' m';
    if (box) box.innerHTML = '<strong>' + safe(status) + '</strong><small>' + safe(location.full_name || getTechnicianLabel(state.technician))
      + ' · ' + safe(location.unit || 'Unidade não informada') + '<br>Registrada em ' + safe(dateTime(location.last_position_at))
      + ' (' + safe(ageLabel(location.position_age_ms)) + ')' + safe(accuracy) + '</small>';
    if (location.is_live && !state.manualOrder) {
      state.candidates = optimizeRoutePreservingUnlocated(state.candidates, originForRoute());
      state.selected = optimizeRoutePreservingUnlocated(state.selected, originForRoute());
      renderLists();
    } else {
      renderMapAndLinks();
    }
  }

  function getLocationSources() {
    const erp = getErpState();
    const sites = []
      .concat(Array.isArray(erp.locais) ? erp.locais : [])
      .concat(Array.isArray(erp.sites) ? erp.sites : [])
      .concat(Array.isArray(erp.unidades) ? erp.unidades : []);
    return planner().buildSiteCandidates(sites, Array.isArray(erp.clientes) ? erp.clientes : []);
  }

  function geocodeAddress(address) {
    return new Promise((resolve, reject) => {
      const requestId = 'dispatch-geocode-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        if (value && value.ok && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude))) {
          resolve({ lat: Number(value.latitude), lng: Number(value.longitude) });
          return;
        }
        const error = new Error(value && value.message || 'O serviço de geocodificação não respondeu. O endereço foi preservado.');
        error.code = value && value.code || 'provider_unavailable';
        reject(error);
      };
      const onMessage = event => {
        if (event.source !== window.parent || event.data?.type !== 'DBS_CONTROL_SITE_ADDRESS_GEOCODE_RESULT'
          || String(event.data.requestId || '') !== requestId) return;
        finish(event.data);
      };
      const timer = setTimeout(() => finish({
        ok: false,
        code: 'provider_unavailable',
        message: 'A aplicação não respondeu à consulta de geocodificação. O endereço foi preservado.'
      }), 12000);
      window.addEventListener('message', onMessage);
      window.parent.postMessage({
        type: 'DBS_CONTROL_GEOCODE_SITE_ADDRESS',
        requestId,
        address: String(address || '').trim()
      }, window.location.origin);
    });
  }

  function persistGeocodedSiteCoordinates(coordinates) {
    if (!Array.isArray(coordinates) || !coordinates.length) return Promise.resolve({ ok: true, saved: 0, skipped: 0 });
    return new Promise(resolve => {
      const requestId = 'dispatch-map-coordinates-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve(value);
      };
      const onMessage = event => {
        if (event.source !== window.parent || event.data?.type !== 'DBS_CONTROL_SITE_MAP_COORDINATES_RESULT'
          || String(event.data.requestId || '') !== requestId) return;
        finish(event.data);
      };
      const timer = setTimeout(() => finish({ ok: false, error: 'O cache das coordenadas não respondeu. Os pontos continuarão visíveis nesta sessão.' }), 20000);
      window.addEventListener('message', onMessage);
      window.parent.postMessage({
        type: 'DBS_CONTROL_SAVE_SITE_MAP_COORDINATES',
        requestId,
        coordinates
      }, window.location.origin);
    });
  }

  function hasValidCoordinates(item) {
    return Boolean(item && item.lat !== null && item.lat !== undefined && item.lng !== null && item.lng !== undefined
      && item.lat !== '' && item.lng !== '' && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng)));
  }

  // Endereço cadastrado é suficiente para abrir a rota no Google Maps.
  // Coordenadas servem para desenhar/otimizar pinos, nunca para excluir a parada.
  function optimizeRoutePreservingUnlocated(items, origin) {
    const source = Array.isArray(items) ? items.slice() : [];
    const located = source.filter(hasValidCoordinates);
    const unlocated = source.filter(item => !hasValidCoordinates(item));
    const ordered = planner().optimizeStops(located, origin).stops.concat(unlocated);
    if (items && items.unallocated) ordered.unallocated = Object.assign({}, items.unallocated);
    if (items && items.activeSiteCountByClient) ordered.activeSiteCountByClient = Object.assign({}, items.activeSiteCountByClient);
    return ordered;
  }

  function updateCandidateCoordinates(candidate, point) {
    if (!candidate || !point) return;
    const id = String(candidate.id || '');
    [state.candidates, state.selected].forEach(collection => {
      const target = collection.find(item => String(item.id || '') === id);
      if (target) {
        target.lat = point.lat;
        target.lng = point.lng;
        target.mapCoordinatesSource = 'address_geocoded';
      }
    });
  }

  function addReviewItem(candidate, error) {
    const id = String(candidate && candidate.id || '');
    const code = String(error && error.code || 'provider_unavailable');
    const detail = String(error && error.message || 'falha ao consultar o serviço externo');
    const reason = code === 'not_found'
      ? 'Endereço cadastrado; o provedor não encontrou correspondência segura. ' + detail
      : code === 'invalid_query'
        ? 'Endereço cadastrado; o provedor não confirmou uma consulta válida. ' + detail
        : 'Endereço cadastrado; serviço de geocodificação indisponível. ' + detail;
    const existing = state.review.find(item => String(item.id || '') === id);
    const next = { id, name: candidate && candidate.name, address: candidate && candidate.address, reason, geocodeStatus: code };
    if (existing) Object.assign(existing, next);
    else state.review.push(next);
  }

  function queueSelectedGeocoding(items) {
    (Array.isArray(items) ? items : []).forEach(item => {
      if (!item || hasValidCoordinates(item) || state.geocodingIds.has(String(item.id || ''))) return;
      state.geocodingIds.add(String(item.id || ''));
      state.geocodeQueue.push(item);
    });
    if (state.geocodeQueue.length && !state.geocoding) void drainGeocodingQueue(state.geocodeGeneration);
  }

  async function drainGeocodingQueue(generation) {
    if (state.geocoding || generation !== state.geocodeGeneration) return;
    state.geocoding = true;
    const successfullyGeocoded = [];
    let completed = 0;
    const total = state.geocodeQueue.length;
    const status = byId('dbs-dispatch-status');
    try {
      while (state.geocodeQueue.length && generation === state.geocodeGeneration && byId('dbs-dispatch-route-modal')) {
        const candidate = state.geocodeQueue.shift();
        if (!candidate) continue;
        try {
          const stillSelected = state.selected.some(item => String(item.id || '') === String(candidate.id || ''));
          if (!stillSelected) {
            state.geocodingIds.delete(String(candidate.id || ''));
            continue;
          }
          const point = await geocodeAddress(candidate.address);
          if (generation !== state.geocodeGeneration) return;
          updateCandidateCoordinates(candidate, point);
          state.siteMetrics = planner().summarizeSiteMetrics(state.candidates);
          if (!state.manualOrder) {
            state.candidates = optimizeRoutePreservingUnlocated(state.candidates, originForRoute());
            state.selected = optimizeRoutePreservingUnlocated(state.selected, originForRoute());
          }
          successfullyGeocoded.push({
            siteId: String(candidate.siteId || ''),
            address: candidate.address,
            latitude: point.lat,
            longitude: point.lng
          });
          state.review = state.review.filter(item => String(item.id || '') !== String(candidate.id || ''));
        } catch (error) {
          if (generation !== state.geocodeGeneration) return;
          addReviewItem(candidate, error);
        } finally {
          state.geocodingIds.delete(String(candidate.id || ''));
        }
        completed += 1;
        if (status) status.textContent = 'Pinos localizados nesta sessão: ' + completed
          + '. Ainda na fila: ' + state.geocodeQueue.length + '. A rota e os links do Google Maps já podem ser usados pelos endereços.';
        renderLists();
        if (state.geocodeQueue.length && generation === state.geocodeGeneration) {
          await new Promise(resolve => setTimeout(resolve, 1100));
        }
      }
      const persist = successfullyGeocoded.filter(item => UUID.test(item.siteId));
      if (persist.length && generation === state.geocodeGeneration) {
        const saved = await persistGeocodedSiteCoordinates(persist);
        if (status && saved && saved.ok) {
          status.textContent = completed + ' parada(s) verificadas. ' + Number(saved.saved || 0)
            + ' pino(s) guardado(s) no cadastro. A rota continua disponível pelos endereços.';
        }
      }
    } finally {
      if (generation === state.geocodeGeneration) {
        state.geocoding = false;
        renderLists();
        if (status && !state.geocodeQueue.length && successfullyGeocoded.length === 0 && state.review.length) {
          status.textContent = 'Não foi possível criar todos os pinos. Os endereços continuam na rota e podem ser abertos no Google Maps.';
        }
      }
    }
  }

  async function buildSuggestions() {
    const button = byId('dbs-dispatch-build');
    const status = byId('dbs-dispatch-status');
    resetPlan();
    if (button) { button.disabled = true; button.textContent = 'Carregando locais…'; }
    if (status) status.textContent = 'Carregando endereços e indicadores reais. A rota não ficará bloqueada pela geocodificação dos pinos.';
    try {
      const audit = getLocationSources();
      state.review = audit.review.slice();
      const candidates = audit.candidates.slice(0, 250);
      candidates.activeSiteCountByClient = audit.activeSiteCountByClient || {};
      if (audit.candidates.length > candidates.length) {
        state.review.push({ reason: 'A lista excede 250 locais. Divida a análise por região para manter o mapa responsivo.' });
      }
      if (!candidates.length) {
        if (status) status.textContent = 'Não encontrei locais ativos com endereço e vínculo de cliente. Confira o cadastro de locais e clientes.';
        renderLists();
        return;
      }

      const erp = getErpState();
      const measured = planner().enrichSiteCandidates(
        candidates,
        Array.isArray(erp.ordens) ? erp.ordens : [],
        Array.isArray(erp.equipamentos) ? erp.equipamentos : []
      );
      state.siteMetrics = planner().summarizeSiteMetrics(measured);
      state.candidates = optimizeRoutePreservingUnlocated(measured, originForRoute());

      state.selected = state.technician
        ? state.candidates.slice(0, Math.min(5, state.candidates.length))
            .map(item => Object.assign({}, item, { serviceType: '', cause: '' }))
        : [];
      state.manualOrder = false;
      renderLists();

      const metrics = state.siteMetrics || planner().summarizeSiteMetrics(state.candidates);
      const pendingPins = Math.max(0, metrics.locations - metrics.mappedLocations);
      if (status) {
        status.textContent = state.technician
          ? state.candidates.length + ' locais carregados para ' + getTechnicianLabel(state.technician) + '. '
            + state.selected.length + ' paradas sugeridas. ' + metrics.mappedLocations + ' com pino salvo e '
            + pendingPins + ' roteáveis pelo endereço enquanto o pino é localizado. '
            + metrics.openOrders + ' OS abertas, ' + metrics.inProgressOrders + ' em atendimento e '
            + metrics.overdueOrders + ' vencidas.'
          : state.candidates.length + ' locais ativos carregados com endereço. Selecione um técnico para montar a rota. '
            + metrics.mappedLocations + ' pinos já salvos; os demais locais permanecem selecionáveis pelo endereço.';
      }
      if (state.technician && state.selected.length) queueSelectedGeocoding(state.selected);
    } catch (error) {
      if (status) status.textContent = error && error.message || 'Não foi possível carregar os locais do despacho.';
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Atualizar mapa e sugestão de rota'; }
    }
  }

  function reorderSelected() {
    if (state.manualOrder) return;
    state.selected = optimizeRoutePreservingUnlocated(state.selected, originForRoute());
  }

  function addStop(id) {
    if (state.selected.length >= 50) {
      const status = byId('dbs-dispatch-status');
      if (status) status.textContent = 'O limite é de 50 OS por lote. Conclua este lote e depois planeje o próximo.';
      return;
    }
    const candidate = state.candidates.find(item => String(item.id) === String(id));
    if (!candidate || state.selected.some(item => String(item.id) === String(id))) return;
    const added = Object.assign({}, candidate, { serviceType: '', cause: '' });
    state.selected.push(added);
    reorderSelected();
    renderLists();
    queueSelectedGeocoding([added]);
  }

  function addNearestFive() {
    const remainingCapacity = 50 - state.selected.length;
    if (remainingCapacity <= 0) {
      const status = byId('dbs-dispatch-status');
      if (status) status.textContent = 'O limite é de 50 OS por lote. Conclua este lote e depois planeje o próximo.';
      return;
    }
    const selectedIds = new Set(state.selected.map(item => String(item.id)));
    const available = state.candidates.filter(item => !selectedIds.has(String(item.id)));
    const optimized = optimizeRoutePreservingUnlocated(available, originForRoute());
    const added = optimized.slice(0, Math.min(5, remainingCapacity))
      .map(item => Object.assign({}, item, { serviceType: '', cause: '' }));
    state.selected.push(...added);
    reorderSelected();
    renderLists();
    queueSelectedGeocoding(added);
  }

  function removeStop(index) {
    state.selected.splice(index, 1);
    renderLists();
  }

  function moveStop(index, direction) {
    const next = index + direction;
    if (next < 0 || next >= state.selected.length) return;
    const item = state.selected[index];
    state.selected[index] = state.selected[next];
    state.selected[next] = item;
    state.manualOrder = true;
    renderLists();
  }

  function renderLists() {
    const selected = byId('dbs-dispatch-selected');
    const available = byId('dbs-dispatch-available');
    const count = byId('dbs-dispatch-count');
    const availableCount = byId('dbs-dispatch-available-count');
    if (!selected || !available) return;
    if (count) count.textContent = state.selected.length + ' paradas';
    const chosen = new Set(state.selected.map(item => String(item.id)));
    const search = String(byId('dbs-dispatch-search') && byId('dbs-dispatch-search').value || '').trim().toLocaleLowerCase('pt-BR');
    const rows = state.candidates.filter(item => !chosen.has(String(item.id))
      && (!search || [item.name, item.clientName, item.address].join(' ').toLocaleLowerCase('pt-BR').includes(search)));
    if (availableCount) availableCount.textContent = rows.length + ' locais disponíveis';
    available.innerHTML = rows.length ? rows.map((item, index) => {
      const distance = item.distanceFromTechnicianKm != null ? ' · ' + item.distanceFromTechnicianKm.toLocaleString('pt-BR') + ' km do técnico'
        : item.distanceFromPreviousKm != null ? ' · ' + item.distanceFromPreviousKm.toLocaleString('pt-BR') + ' km da parada anterior' : '';
      const indicators = 'OS: ' + Number(item.openOrders || 0) + ' abertas · ' + Number(item.inProgressOrders || 0)
        + ' em atendimento · ' + Number(item.overdueOrders || 0) + ' vencidas · ' + Number(item.equipmentCount || 0) + ' equipamentos';
      return '<article class="dbs-dispatch-item"><span class="dbs-dispatch-number">' + (index + 1) + '</span>'
        + '<div><strong>' + safe(item.name) + '</strong><small>' + safe(item.clientName + ' · ' + item.address + distance) + '</small>'
        + '<small style="color:#365f86;font-weight:800">' + safe(indicators) + '</small>'
        + '<small style="color:' + (hasValidCoordinates(item) ? '#047857' : '#9a6700') + '">' + (hasValidCoordinates(item) ? 'Pino salvo no mapa' : 'Sem pino ainda · continua roteável pelo endereço') + '</small></div>'
        + '<button type="button" class="dbs-dispatch-iconbtn" data-action="add" data-id="' + safe(item.id) + '" aria-label="Adicionar ' + safe(item.name) + '"' + (!state.technician ? ' disabled title="Selecione um técnico primeiro"' : '') + '>+</button></article>';
    }).join('') : '<div class="dbs-dispatch-empty">Nenhum outro local corresponde ao filtro.</div>';

    selected.innerHTML = state.selected.length ? state.selected.map((item, index) => {
      const typeOptions = '<option value="">Selecione o tipo de atendimento</option>' + SERVICE_TYPES.map(type => '<option value="' + safe(type) + '"' + (item.serviceType === type ? ' selected' : '') + '>' + safe(type) + '</option>').join('');
      const causeField = isPmoc(item.serviceType)
        ? '<label>Observação PMOC (opcional)<input data-field="cause" data-index="' + index + '" maxlength="500" value="' + safe(item.cause || '') + '" placeholder="Observação complementar, se necessário"></label>'
        : '<label>' + (requiresCause(item.serviceType) ? 'Motivo / problema (obrigatório)' : 'Motivo / observação (opcional)')
          + '<textarea data-field="cause" data-index="' + index + '" maxlength="500" placeholder="' + (requiresCause(item.serviceType) ? 'Descreva o defeito, sintoma ou solicitação que motivou esta corretiva (mínimo 5 caracteres)' : 'Descreva o motivo deste atendimento, se necessário') + '">' + safe(item.cause || '') + '</textarea></label>';
      return '<article class="dbs-dispatch-card" style="padding:10px">'
        + '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between">'
        + '<div style="display:flex;gap:8px;align-items:center;min-width:0"><span class="dbs-dispatch-number">' + (index + 1) + '</span><div style="min-width:0"><strong style="display:block;font-size:11px;color:#24435f">' + safe(item.name) + '</strong><small style="display:block;margin-top:3px;color:#718399;font-size:10px;overflow-wrap:anywhere">' + safe(item.address) + '</small><small style="display:block;margin-top:3px;color:#365f86;font-size:9px;font-weight:800">OS: ' + Number(item.openOrders || 0) + ' abertas · ' + Number(item.inProgressOrders || 0) + ' em atendimento · ' + Number(item.overdueOrders || 0) + ' vencidas · ' + Number(item.equipmentCount || 0) + ' equipamentos</small><small style="display:block;margin-top:3px;color:' + (hasValidCoordinates(item) ? '#047857' : '#9a6700') + ';font-size:9px">' + (hasValidCoordinates(item) ? 'Pino salvo' : 'Endereço pronto para navegação; pino em processamento') + '</small></div></div>'
        + '<div class="dbs-dispatch-actions"><button class="dbs-dispatch-iconbtn" type="button" data-action="up" data-index="' + index + '" aria-label="Subir parada">↑</button><button class="dbs-dispatch-iconbtn" type="button" data-action="down" data-index="' + index + '" aria-label="Descer parada">↓</button><button class="dbs-dispatch-iconbtn" type="button" data-action="remove" data-index="' + index + '" aria-label="Remover parada">×</button></div></div>'
        + '<div class="dbs-dispatch-stop-fields"><label>Tipo de atendimento<select data-field="serviceType" data-index="' + index + '">' + typeOptions + '</select></label>'
        + causeField + '</div></article>';
    }).join('') : '<div class="dbs-dispatch-empty">O DBS sugere os cinco primeiros locais por proximidade. Defina o tipo e o motivo de cada atendimento e reorganize tudo antes de abrir as OS.</div>';

    showReview();
    validateCreateButton();
    renderMapAndLinks();
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return new Promise((resolve, reject) => {
      let css = byId('dbs-dispatch-leaflet-css');
      if (!css) {
        css = document.createElement('link');
        css.id = 'dbs-dispatch-leaflet-css';
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(css);
      }
      let script = byId('dbs-leaflet-js');
      if (script) {
        if (window.L) return resolve(window.L);
        script.addEventListener('load', () => window.L ? resolve(window.L) : reject(new Error('Biblioteca de mapa indisponível.')), { once: true });
        script.addEventListener('error', () => reject(new Error('Não foi possível carregar o mapa.')), { once: true });
        return;
      }
      script = document.createElement('script');
      script.id = 'dbs-leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => window.L ? resolve(window.L) : reject(new Error('Biblioteca de mapa indisponível.'));
      script.onerror = () => reject(new Error('Não foi possível carregar o mapa.'));
      document.head.appendChild(script);
    });
  }

  async function renderMapAndLinks() {
    const mapElement = byId('dbs-dispatch-map');
    const links = byId('dbs-dispatch-maplinks');
    const status = byId('dbs-dispatch-map-status');
    const metricsElement = byId('dbs-dispatch-metrics');
    const legs = planner() && planner().buildRouteLegs(state.selected, originForRoute());
    if (links) {
      links.innerHTML = legs && legs.length ? legs.map(leg => {
        const title = 'Etapa ' + leg.index + ' · paradas ' + leg.firstStop + '–' + leg.lastStop;
        return leg.url
          ? '<div class="dbs-dispatch-maplink"><span>' + safe(title) + '</span><button type="button" class="dbs-dispatch-btn" data-dbs-maps-url="' + safe(leg.url) + '">Abrir no Google Maps →</button></div>'
          : '<div class="dbs-dispatch-status">Etapa longa para um único link; abra as paradas individualmente.</div>';
      }).join('') : '<div class="dbs-dispatch-empty">A sugestão inicial será exibida após posicionar os endereços cadastrados.</div>';
    }
    if (!mapElement) return;
    if (!state.candidates.length && !state.location && status) {
      status.textContent = 'Mapa-base carregado. Os endereços cadastrados serão posicionados automaticamente pelo endereço registrado.';
    }
    try {
      const L = await loadLeaflet();
      if (!state.map) {
        state.mapLibrary = L;
        state.map = L.map(mapElement, { scrollWheelZoom: false, preferCanvas: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
        }).addTo(state.map);
        state.mapLayer = L.layerGroup().addTo(state.map);
      }
      state.mapLayer.clearLayers();
      const bounds = [];
      const techPoint = state.location && Number.isFinite(Number(state.location.latitude))
        && Number.isFinite(Number(state.location.longitude))
        ? [Number(state.location.latitude), Number(state.location.longitude)] : null;
      if (techPoint) {
        const recent = Boolean(state.location.is_live);
        L.circleMarker(techPoint, {
          radius: 11,
          color: recent ? '#064e3b' : '#92400e',
          weight: 3,
          fillColor: recent ? '#34d399' : '#fbbf24',
          fillOpacity: 1
        }).bindPopup('<strong>Última posição de ' + safe(getTechnicianLabel(state.technician)) + '</strong><br>'
          + safe(dateTime(state.location.last_position_at)) + '<br>'
          + (recent ? 'GPS atualizado nos últimos 3 minutos' : 'Última posição conhecida; não usada como origem da rota')).addTo(state.mapLayer);
        bounds.push(techPoint);
      }

      const selectedIds = new Set(state.selected.map(item => String(item.id)));
      const mapped = state.candidates.filter(stop => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)));
      mapped.forEach((stop, index) => {
        const point = [Number(stop.lat), Number(stop.lng)];
        const urgent = Number(stop.overdueOrders || 0) > 0 || Number(stop.emergencyOrders || 0) > 0;
        const pending = Number(stop.openOrders || 0) > 0 || Number(stop.inProgressOrders || 0) > 0;
        const color = urgent ? '#b91c1c' : pending ? '#b45309' : '#047857';
        const fill = urgent ? '#f87171' : pending ? '#fbbf24' : '#34d399';
        const popup = '<strong>' + safe(stop.name) + '</strong><br>' + safe(stop.clientName || 'Cliente')
          + '<br>' + safe(stop.address)
          + '<hr style="margin:6px 0;border:0;border-top:1px solid #e2e8f0">'
          + 'OS abertas: <strong>' + Number(stop.openOrders || 0) + '</strong>'
          + ' · em atendimento: <strong>' + Number(stop.inProgressOrders || 0) + '</strong>'
          + '<br>OS vencidas: <strong>' + Number(stop.overdueOrders || 0) + '</strong>'
          + ' · emergenciais: <strong>' + Number(stop.emergencyOrders || 0) + '</strong>'
          + '<br>Equipamentos cadastrados: <strong>' + Number(stop.equipmentCount || 0) + '</strong>'
          + '<br><small>Posição aproximada, calculada pelo endereço cadastrado.</small>';
        L.circleMarker(point, {
          radius: selectedIds.has(String(stop.id)) ? 8 : 6,
          color, weight: selectedIds.has(String(stop.id)) ? 4 : 2,
          fillColor: fill, fillOpacity: 0.92
        }).bindPopup(popup).addTo(state.mapLayer);
        bounds.push(point);
      });

      const routePoints = state.selected
        .filter(stop => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)))
        .map(stop => [Number(stop.lat), Number(stop.lng)]);
      if (routePoints.length > 1) {
        L.polyline(routePoints, { color: '#1d4ed8', weight: 4, opacity: 0.9, dashArray: '8 6' }).addTo(state.mapLayer);
        routePoints.forEach((point, index) => {
          L.circleMarker(point, { radius: 10, color: '#1e40af', weight: 2, fillColor: '#2563eb', fillOpacity: 0.25 })
            .bindTooltip('Parada ' + (index + 1), { permanent: true, direction: 'top', className: 'dbs-dispatch-route-label' })
            .addTo(state.mapLayer);
        });
      }

      if (bounds.length > 1) state.map.fitBounds(L.latLngBounds(bounds).pad(0.16));
      else if (bounds.length === 1) state.map.setView(bounds[0], 13);
      else state.map.setView([-22.9, -43.2], 10);
      setTimeout(() => state.map && state.map.invalidateSize(), 120);

      const metrics = state.siteMetrics || planner().summarizeSiteMetrics(state.candidates);
      if (metricsElement) {
        metricsElement.innerHTML = [
          ['Locais', metrics.locations],
          ['No mapa', metrics.mappedLocations],
          ['Endereços sem pino', Math.max(0, metrics.locations - metrics.mappedLocations)],
          ['OS abertas', metrics.openOrders],
          ['Em atendimento', metrics.inProgressOrders],
          ['Vencidas', metrics.overdueOrders],
          ['Emergenciais', metrics.emergencyOrders],
          ['Equipamentos', metrics.equipment],
          ['OS sem local definido', metrics.ordersWithoutSpecificSite],
          ['Equip. sem local definido', metrics.equipmentWithoutSpecificSite],
          ['Cadastros a revisar', state.review.length]
        ].map(([label, value]) => '<div class="dbs-dispatch-metric"><strong>' + Number(value).toLocaleString('pt-BR') + '</strong><span>' + safe(label) + '</span></div>').join('');
      }
      const unmapped = Math.max(0, metrics.locations - metrics.mappedLocations);
      if (status) status.textContent = metrics.mappedLocations + '/' + metrics.locations + ' locais posicionados pelo endereço. '
        + metrics.openOrders + ' OS abertas · ' + metrics.inProgressOrders + ' em atendimento · '
        + metrics.overdueOrders + ' vencidas · ' + metrics.equipment + ' equipamentos. '
        + metrics.ordersWithoutSpecificSite + ' OS e ' + metrics.equipmentWithoutSpecificSite + ' equipamentos sem vínculo de local específico. '
        + (unmapped ? unmapped + ' endereço(s) continuam roteáveis pelo cadastro, mesmo sem pino no mapa. ' : '')
        + (originForRoute() ? 'A rota considera o GPS recente do técnico.' : 'Sem GPS recente: a rota não usa a posição do administrador como origem.')
        + ' Pinos verdes: sem OS pendente; âmbar: OS em aberto/atendimento; vermelhos: OS vencida/emergencial.';
    } catch (error) {
      if (status) status.textContent = error && error.message || 'Mapa indisponível. A lista e os links do Google Maps continuam funcionando.';
    }
  }

  function renderModal() {
    const modal = byId('dbs-dispatch-route-modal');
    if (!modal) return;
    const selected = state.technician ? String(state.technician.id) : '';
    const options = getTechnicians().map(tech => '<option value="' + safe(tech.id) + '"' + (String(tech.id) === selected ? ' selected' : '') + '>' + safe(getTechnicianLabel(tech)) + '</option>').join('');
    modal.innerHTML = '<div class="dbs-dispatch-dialog">'
      + '<header class="dbs-dispatch-head"><div><p style="color:#93c5fd;font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase">DBS CONTROL · despacho inteligente</p><h2 id="dbs-dispatch-title">Planejar rota antes de abrir OS</h2><p style="color:#c6d3df">Visualize todos os locais cadastrados, acompanhe indicadores das OS, escolha o técnico e revise uma rota editável antes de abrir qualquer OS.</p></div><button type="button" class="dbs-dispatch-close" data-action="close" aria-label="Fechar">×</button></header>'
      + '<div class="dbs-dispatch-body">'
      + '<section class="dbs-dispatch-card"><div class="dbs-dispatch-toolbar">'
      + '<label>Técnico responsável<select id="dbs-dispatch-technician"><option value="">Selecione um técnico</option>' + options + '</select></label>'
      + '<label>Data da rota<input id="dbs-dispatch-date" type="date" value="' + safe((byId('day-filter-date') && byId('day-filter-date').value) || currentDate()) + '"></label>'
      + '<button type="button" class="dbs-dispatch-btn secondary" data-action="refresh-location">Atualizar posição do GPS</button></div>'
      + '<div id="dbs-dispatch-location-summary" class="dbs-dispatch-location"><div><strong>Selecione o técnico para consultar a localização.</strong><small>O sistema mostrará a hora da última leitura para diferenciar posição recente de ponto antigo.</small></div></div>'
      + '<label class="dbs-dispatch-origin-toggle"><input id="dbs-dispatch-use-origin" type="checkbox" disabled> Usar a última posição do técnico como ponto de partida da rota</label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="dbs-dispatch-btn" id="dbs-dispatch-build" data-action="build">Atualizar mapa e sugestão de rota</button><button type="button" class="dbs-dispatch-btn secondary" data-action="nearest-five"' + (!state.technician ? ' disabled' : '') + '>Adicionar 5 locais seguintes</button><button type="button" class="dbs-dispatch-btn secondary" data-action="geocode-selected"' + (!state.technician || !state.selected.length ? ' disabled' : '') + '>Localizar pinos das paradas</button></div>'
      + '</section>'
      + '<section class="dbs-dispatch-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h3>Mapa de clientes e operação</h3><p>Os marcadores representam os endereços ativos cadastrados. A posição é aproximada pelo endereço; não é GPS do cliente.</p><p>Todos os endereços cadastrados permanecem selecionáveis e roteáveis. Os pinos são localizados progressivamente pelo Photon/OpenStreetMap apenas nas paradas escolhidas; uma falha de geocodificação não bloqueia a rota pelo endereço. As cores e os indicadores usam as OS e os equipamentos reais do DBS CONTROL. A sequência considera proximidade quando há coordenadas e preserva as paradas sem pino. O Google Maps calcula o trajeto pelas vias. Sem GPS recente do técnico, a rota começa na primeira parada, nunca na localização do administrador.</p></div><span id="dbs-dispatch-map-status" style="font-size:10px;color:#6b7f93">Lendo cadastros.</span></div><div id="dbs-dispatch-metrics" class="dbs-dispatch-metrics" aria-live="polite"></div><div id="dbs-dispatch-map" class="dbs-dispatch-map" style="margin-top:10px"></div><div id="dbs-dispatch-maplinks" class="dbs-dispatch-maplinks"></div></section>'
      + '<section class="dbs-dispatch-columns">'
      + '<div class="dbs-dispatch-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h3>Rota selecionada e editável</h3><p>Defina o tipo e o motivo de cada atendimento.</p></div><strong id="dbs-dispatch-count">0 paradas</strong></div><div id="dbs-dispatch-selected" class="dbs-dispatch-list"><div class="dbs-dispatch-empty">Carregue a sugestão e adicione os locais que deseja atender.</div></div></div>'
      + '<div class="dbs-dispatch-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h3>Locais cadastrados próximos</h3><p id="dbs-dispatch-available-count">Aguardando análise</p></div></div><input id="dbs-dispatch-search" type="search" placeholder="Filtrar por loja, cliente, bairro ou endereço"><div id="dbs-dispatch-available" class="dbs-dispatch-list"><div class="dbs-dispatch-empty">Os primeiros cinco locais formam uma sugestão editável após o carregamento do mapa.</div></div></div>'
      + '</section>'
      + '<div id="dbs-dispatch-review" class="dbs-dispatch-review" hidden></div>'
      + '<div id="dbs-dispatch-status" class="dbs-dispatch-status" role="status" aria-live="polite">O mapa e a sugestão são carregados sem abrir OS. Nenhuma OS será criada até sua confirmação.</div>'
      + '<footer class="dbs-dispatch-footer"><div><strong>Etapa final: criação em lote</strong><p>As OS serão atribuídas ao técnico escolhido. Locais não selecionados não serão alterados.</p></div><button type="button" class="dbs-dispatch-btn" id="dbs-dispatch-create" data-action="create" disabled>Revisar e abrir OS em lote</button></footer>'
      + '</div></div>';

    const technicianSelect = byId('dbs-dispatch-technician');
    technicianSelect.addEventListener('change', function () {
      state.technician = getTechnicians().find(item => String(item.id) === String(this.value)) || null;
      resetPlan();
      // Não esperar o GPS: carrega imediatamente todos os endereços e monta
      // a rota; a posição do técnico é apenas um refinamento opcional da origem.
      void buildSuggestions();
      void refreshLocation();
    });
    const toggle = byId('dbs-dispatch-use-origin');
    toggle.addEventListener('change', function () {
      state.originEnabled = Boolean(this.checked);
      if (state.candidates.length) {
        state.candidates = optimizeRoutePreservingUnlocated(state.candidates, originForRoute());
        reorderSelected();
        renderLists();
      } else renderMapAndLinks();
    });
    byId('dbs-dispatch-search').addEventListener('input', renderLists);
    modal.addEventListener('click', async function (event) {
      const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
      if (!button) return;
      const action = button.getAttribute('data-action');
      if (action === 'close') { closePlanner(); return; }
      if (action === 'refresh-location') { await refreshLocation(); return; }
      if (action === 'review-map') {
        const item = state.review.find(entry => String(entry.id || '') === String(button.getAttribute('data-id') || ''));
        if (item && item.address) {
          const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(item.address);
          window.parent.postMessage({ type: 'DBS_CONTROL_OPEN_MAPS', url }, window.location.origin);
        }
        return;
      }
      if (action === 'build') { await buildSuggestions(); return; }
      if (action === 'geocode-selected') { queueSelectedGeocoding(state.selected); return; }
      if (action === 'nearest-five') { addNearestFive(); return; }
      if (action === 'add') { addStop(button.getAttribute('data-id')); return; }
      if (action === 'remove') { removeStop(Number(button.getAttribute('data-index'))); return; }
      if (action === 'up') { moveStop(Number(button.getAttribute('data-index')), -1); return; }
      if (action === 'down') { moveStop(Number(button.getAttribute('data-index')), 1); return; }
      if (action === 'create') { await createOrders(); }
    });
    modal.addEventListener('change', function (event) {
      const field = event.target instanceof Element ? event.target.getAttribute('data-field') : null;
      if (!field) return;
      const index = Number(event.target.getAttribute('data-index'));
      const stop = state.selected[index];
      if (!stop) return;
      stop[field] = event.target.value;
      if (field === 'serviceType') renderLists();
      else validateCreateButton();
    });
    modal.addEventListener('input', function (event) {
      const field = event.target instanceof Element ? event.target.getAttribute('data-field') : null;
      if (field !== 'cause') return;
      const stop = state.selected[Number(event.target.getAttribute('data-index'))];
      if (stop) stop.cause = event.target.value;
      validateCreateButton();
    });
    if (selected) {
      state.technician = getTechnicians().find(item => String(item.id) === selected) || null;
      void refreshLocation();
    }
    void renderMapAndLinks();
  }

  function validateCreateButton() {
    const button = byId('dbs-dispatch-create');
    if (!button) return;
    const technicianEmployeeId = getEmployeeId(state.technician);
    const valid = state.selected.length > 0 && state.selected.length <= 50 && Boolean(technicianEmployeeId)
      && state.selected.every(item => SERVICE_TYPES.includes(item.serviceType)
        && (!requiresCause(item.serviceType) || String(item.cause || '').trim().length >= 5));
    button.disabled = !valid || state.creating;
  }

  function showReview() {
    const review = byId('dbs-dispatch-review');
    if (!review) return;
    const items = state.review.slice(0, 20);
    if (!items.length) {
      review.hidden = true;
      review.textContent = '';
      return;
    }
    review.hidden = false;
    review.innerHTML = '<strong>' + state.review.length + ' endereço(s) não tiveram o pino confirmado. Eles continuam na rota pelo endereço e podem ser abertos no Google Maps:</strong><ul style="margin:6px 0 0;padding-left:18px">'
      + items.map(item => {
        const mapsButton = item.address
          ? ' <button type="button" class="dbs-dispatch-btn secondary" data-action="review-map" data-id="' + safe(item.id || '') + '">Abrir endereço no Google Maps</button>'
          : '';
        return '<li><strong>' + safe(item.name || item.id || 'Registro') + '</strong>: ' + safe(item.reason || 'Conferir cadastro')
          + (item.address ? '<br><small>Endereço cadastrado: ' + safe(item.address) + '</small>' : '')
          + mapsButton + '</li>';
      }).join('')
      + (state.review.length > items.length ? '<li>Mais ' + (state.review.length - items.length) + ' registro(s).</li>' : '')
      + '</ul>';
  }

  async function createOrders() {
    if (state.creating || !state.selected.length) return;
    const technician = state.technician;
    const employeeId = getEmployeeId(technician);
    if (!employeeId) {
      alert('Este técnico precisa estar vinculado ao cadastro de colaborador do RH antes de receber OS por esta rota.');
      return;
    }
    const invalid = state.selected.find(item => requiresCause(item.serviceType) && String(item.cause || '').trim().length < 5);
    if (invalid) {
      alert('Descreva o motivo/problema da OS corretiva ou do atendimento em: ' + invalid.name + '.');
      return;
    }
    if (state.selected.length > 50) {
      alert('O limite é de 50 OS por lote. Divida a rota em dois lotes.');
      return;
    }
    const routeDate = String(byId('dbs-dispatch-date') && byId('dbs-dispatch-date').value || currentDate());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) {
      alert('Informe uma data válida para a rota.');
      return;
    }
    const requestId = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : 'dispatch-route-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const createdAt = new Date().toISOString();
    const orders = state.selected.map((stop, index) => {
      const type = stop.serviceType;
      const cause = String(stop.cause || '').trim();
      const idKey = stop.siteId || stop.clientId;
      const slug = type.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return {
        id: 'ROUTE:' + routeDate + ':' + slug + ':' + idKey,
        clienteId: stop.clientId,
        siteId: stop.siteId || null,
        employeeId: employeeId,
        tecnicoId: employeeId,
        tipo: type,
        status: 'aberta',
        prioridade: /emergencial/i.test(type) ? 'alta' : 'normal',
        data: routeDate,
        desc: type + ' · ' + stop.name + (cause ? ' · ' + cause : ''),
        observacao: 'OS criada pelo planejamento de rota do DBS CONTROL. Técnico: ' + getTechnicianLabel(technician)
          + '. Rota planejada para ' + routeDate + ', parada ' + (index + 1) + ' de ' + state.selected.length
          + '. Endereço: ' + stop.address + (cause ? '. Motivo informado: ' + cause : ''),
        createdAt: createdAt,
        updatedAt: createdAt,
        causaSolicitacao: cause,
        rotaOrigem: requestId,
        rotaTecnicoId: String(technician.id),
        rotaData: routeDate,
        rotaSequencia: index + 1,
        ...(isPmoc(type) ? { pmocCompetencia: routeDate.slice(0, 7), pmocOrigemRota: requestId } : {})
      };
    });

    const summary = state.selected.map((stop, index) => (index + 1) + '. ' + stop.name + ' — ' + stop.serviceType
      + (stop.cause ? ' — ' + stop.cause : '')).join('\n');
    if (!confirm('Confirmar a abertura de ' + orders.length + ' OS para ' + getTechnicianLabel(technician) + '?\n\n'
      + 'As ordens serão atribuídas a este técnico. Nenhuma OS existente será modificada.\n\n' + summary)) return;

    state.creating = true;
    state.requestId = requestId;
    validateCreateButton();
    const status = byId('dbs-dispatch-status');
    if (status) status.textContent = 'Enviando lote ao fluxo relacional oficial. Não feche esta tela até receber a confirmação.';
    const button = byId('dbs-dispatch-create');
    if (button) button.textContent = 'Registrando OS…';
    window.parent.postMessage({
      type: 'DBS_CONTROL_CREATE_DISPATCH_ROUTE_ORDERS',
      requestId: requestId,
      technicianEmployeeId: employeeId,
      routeDate: routeDate,
      orders: orders
    }, window.location.origin);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || event.data?.type !== 'DBS_CONTROL_DISPATCH_ROUTE_RESULT') return;
    if (String(event.data.requestId || '') !== String(state.requestId || '')) return;
    state.creating = false;
    state.result = event.data;
    const result = event.data;
    const applied = Array.isArray(result.appliedOrders) ? result.appliedOrders.length : 0;
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    const status = byId('dbs-dispatch-status');
    const button = byId('dbs-dispatch-create');
    if (result.ok && applied === state.selected.length) {
      if (status) status.textContent = 'Rota concluída: ' + applied + ' OS registradas e atribuídas a '
        + getTechnicianLabel(state.technician) + '. Protocolos: '
        + (result.appliedOrders || []).map(item => item.protocol || item.protocolo).filter(Boolean).join(', ') + '.';
      if (button) { button.disabled = true; button.textContent = 'OS abertas e atribuídas'; }
    } else {
      if (status) status.textContent = 'Resultado parcial: ' + applied + ' OS confirmadas e ' + conflicts.length
        + ' conflito(s). ' + (result.error || conflicts.map(item => item.message).join(' · ') || 'Confira a sincronização antes de tentar novamente.');
      if (button) { button.textContent = 'Conferir resultado do lote'; validateCreateButton(); }
    }
  });

  function openPlanner() {
    if (byId('dbs-dispatch-route-modal')) closePlanner();
    ensureStyle();
    resetPlan();
    state.location = null;
    state.originEnabled = false;
    state.requestId = null;
    state.creating = false;
    state.result = null;
    state.technician = null;
    const modal = document.createElement('div');
    modal.id = 'dbs-dispatch-route-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'dbs-dispatch-title');
    modal.__previousFocus = document.activeElement;
    document.body.appendChild(modal);
    renderModal();
    const dayTechnician = byId('day-filter-tecnico');
    void loadActiveTechnicians(dayTechnician && dayTechnician.value || '');
    return modal;
  }

  window.abrirRotaAtividadesDia = openPlanner;
})();