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
    map: null,
    mapLayer: null,
    mapLibrary: null,
    originEnabled: false,
    requestId: null,
    creating: false,
    result: null,
    manualOrder: false,
    geocoding: false
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
  const requiresCause = value => !isPmoc(value);
  const planner = () => window.DbsControlRoutePlanner;

  function getTechnicians() {
    return Array.isArray(window.ERP_STATE && window.ERP_STATE.tecnicos)
      ? window.ERP_STATE.tecnicos.filter(item => item && item.id)
      : [];
  }

  function getEmployeeId(technician) {
    const value = String(technician && (
      technician.employeeId || technician.employee_id || technician.rhEmployeeId || technician.rh_employee_id
    ) || '').trim();
    return UUID.test(value) ? value : '';
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
    state.manualOrder = false;
    state.result = null;
    state.geocoding = false;
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
      '@media(max-width:760px){#dbs-dispatch-route-modal{padding:5px;align-items:flex-end}#dbs-dispatch-route-modal .dbs-dispatch-dialog{max-height:96vh;border-radius:16px}#dbs-dispatch-route-modal .dbs-dispatch-toolbar{grid-template-columns:1fr 1fr}#dbs-dispatch-route-modal .dbs-dispatch-toolbar .dbs-dispatch-btn{grid-column:1 / -1;width:100%}#dbs-dispatch-route-modal .dbs-dispatch-columns{grid-template-columns:1fr}#dbs-dispatch-route-modal .dbs-dispatch-map{height:260px}#dbs-dispatch-route-modal .dbs-dispatch-stop-fields{grid-template-columns:1fr}#dbs-dispatch-route-modal .dbs-dispatch-footer{align-items:stretch}#dbs-dispatch-route-modal .dbs-dispatch-footer .dbs-dispatch-btn{width:100%}}'
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
    const employeeId = getEmployeeId(state.technician);
    state.location = null;
    state.originEnabled = false;
    const box = byId('dbs-dispatch-location-summary');
    if (box) box.innerHTML = '<strong>Consultando última posição compartilhada…</strong><small>Consulta segura ao DBS FLEET do RH.</small>';
    const toggle = byId('dbs-dispatch-use-origin');
    if (toggle) toggle.checked = false;
    if (!employeeId) {
      if (box) box.innerHTML = '<strong>Este técnico ainda não está vinculado a um colaborador do RH.</strong><small>Sem o vínculo, o DBS não consegue associar a posição autorizada do GPS. O planejamento continua disponível pela região central.</small>';
      renderMapAndLinks();
      return;
    }
    const result = await requestTechnicianLocation(employeeId);
    if (!result || !result.ok) {
      if (box) box.innerHTML = '<strong>Não foi possível obter a posição.</strong><small>' + safe(result && result.error || 'Verifique o vínculo e as permissões do RH.') + '</small>';
      renderMapAndLinks();
      return;
    }
    state.location = result.location || null;
    const location = state.location;
    const hasCoordinates = location && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
    if (!location || !hasCoordinates) {
      if (box) box.innerHTML = '<strong>Nenhuma posição compartilhada encontrada.</strong><small>O técnico precisa autorizar o DBS FLEET durante a jornada. A rota poderá ser organizada pela proximidade entre os endereços, mas sem afirmar onde ele está.</small>';
      renderMapAndLinks();
      return;
    }
    state.originEnabled = Boolean(location.is_live);
    if (toggle) {
      toggle.disabled = false;
      toggle.checked = state.originEnabled;
    }
    const status = location.is_live ? 'GPS recente · posição atualizada' : 'Última posição conhecida · pode estar desatualizada';
    const accuracy = location.accuracy_m == null ? '' : ' · precisão aproximada ±' + Math.round(Number(location.accuracy_m)) + ' m';
    if (box) box.innerHTML = '<strong>' + safe(status) + '</strong><small>' + safe(location.full_name || getTechnicianLabel(state.technician))
      + ' · ' + safe(location.unit || 'Unidade não informada') + '<br>Registrada em ' + safe(dateTime(location.last_position_at))
      + ' (' + safe(ageLabel(location.position_age_ms)) + ')' + safe(accuracy) + '</small>';
    renderMapAndLinks();
  }

  function getLocationSources() {
    const erp = window.ERP_STATE || {};
    const sites = []
      .concat(Array.isArray(erp.locais) ? erp.locais : [])
      .concat(Array.isArray(erp.sites) ? erp.sites : [])
      .concat(Array.isArray(erp.unidades) ? erp.unidades : []);
    return planner().buildSiteCandidates(sites, erp.clientes || []);
  }

  async function geocodeAddress(address) {
    const query = /brasil|brazil/i.test(address) ? address : address + ', Brasil';
    const url = 'https://photon.komoot.io/api/?limit=1&lang=pt&q=' + encodeURIComponent(query);
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Geocodificação indisponível (' + response.status + ').');
    const data = await response.json();
    const feature = Array.isArray(data.features) ? data.features[0] : null;
    const properties = feature && feature.properties || {};
    if (!feature || (properties.country && !/brasil|brazil/i.test(String(properties.country)))) {
      throw new Error('Endereço não localizado no Brasil.');
    }
    if (!properties.city && !properties.county && !properties.state) {
      throw new Error('O resultado não confirmou cidade/região.');
    }
    const coordinates = feature.geometry && feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || !Number.isFinite(Number(coordinates[0])) || !Number.isFinite(Number(coordinates[1]))) {
      throw new Error('O endereço não retornou coordenadas válidas.');
    }
    return { lat: Number(coordinates[1]), lng: Number(coordinates[0]) };
  }

  async function buildSuggestions() {
    const button = byId('dbs-dispatch-build');
    const status = byId('dbs-dispatch-status');
    if (!state.technician) {
      if (status) status.textContent = 'Selecione primeiro o técnico responsável.';
      return;
    }
    resetPlan();
    state.geocoding = true;
    if (button) { button.disabled = true; button.textContent = 'Localizando endereços…'; }
    if (status) status.textContent = 'Lendo locais cadastrados e conferindo coordenadas. Nenhuma OS será criada nesta etapa.';
    try {
      const audit = getLocationSources();
      state.review = audit.review.slice();
      const candidates = audit.candidates.slice(0, 100);
      if (audit.candidates.length > candidates.length) {
        state.review.push({ reason: 'A lista excede 100 locais. Refine o cadastro/região antes de gerar uma rota maior.' });
      }
      if (!candidates.length) throw new Error('Não encontrei lojas/locais ativos com endereço e vínculo de cliente. Confira os cadastros.');
      let completed = 0;
      const queue = candidates.slice();
      const located = [];
      const workers = Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const candidate = queue.shift();
          if (!candidate) return;
          try {
            if (candidate.lat == null || candidate.lng == null) {
              const point = await geocodeAddress(candidate.address);
              candidate.lat = point.lat;
              candidate.lng = point.lng;
            }
            located.push(candidate);
          } catch (error) {
            state.review.push({
              id: candidate.id,
              name: candidate.name,
              address: candidate.address,
              reason: 'Endereço não localizado: ' + (error && error.message || 'revise o cadastro')
            });
          }
          completed += 1;
          if (status) status.textContent = 'Conferindo endereços ' + completed + '/' + candidates.length + '…';
          await new Promise(resolve => setTimeout(resolve, 280));
        }
      });
      await Promise.all(workers);
      const route = planner().optimizeStops(located, originForRoute());
      state.candidates = route.stops;
      if (!state.candidates.length) throw new Error('Nenhum endereço foi geocodificado com confiança. Revise os endereços cadastrados.');
      if (status) status.textContent = state.candidates.length + ' locais posicionados no mapa. '
        + (originForRoute() ? 'Sugestões ordenadas a partir da última posição selecionada do técnico.' : 'Sem GPS utilizável: sequência inicial pela região mais central dos endereços.');
      renderLists();
    } catch (error) {
      if (status) status.textContent = error && error.message || 'Não foi possível sugerir a rota.';
    } finally {
      state.geocoding = false;
      if (button) { button.disabled = false; button.textContent = 'Atualizar sugestão de rota'; }
    }
  }

  function reorderSelected() {
    if (state.manualOrder) return;
    state.selected = planner().optimizeStops(state.selected, originForRoute()).stops;
  }

  function addStop(id) {
    const candidate = state.candidates.find(item => String(item.id) === String(id));
    if (!candidate || state.selected.some(item => String(item.id) === String(id))) return;
    state.selected.push(Object.assign({}, candidate, {
      serviceType: 'Manutenção Corretiva',
      cause: ''
    }));
    reorderSelected();
    renderLists();
  }

  function addNearestFive() {
    const selectedIds = new Set(state.selected.map(item => String(item.id)));
    const available = state.candidates.filter(item => !selectedIds.has(String(item.id)));
    const optimized = planner().optimizeStops(available, originForRoute()).stops;
    optimized.slice(0, 5).forEach(item => {
      state.selected.push(Object.assign({}, item, { serviceType: 'Manutenção Corretiva', cause: '' }));
    });
    reorderSelected();
    renderLists();
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
      return '<article class="dbs-dispatch-item"><span class="dbs-dispatch-number">' + (index + 1) + '</span>'
        + '<div><strong>' + safe(item.name) + '</strong><small>' + safe(item.clientName + ' · ' + item.address + distance) + '</small></div>'
        + '<button type="button" class="dbs-dispatch-iconbtn" data-action="add" data-id="' + safe(item.id) + '" aria-label="Adicionar ' + safe(item.name) + '">+</button></article>';
    }).join('') : '<div class="dbs-dispatch-empty">Nenhum outro local corresponde ao filtro.</div>';

    selected.innerHTML = state.selected.length ? state.selected.map((item, index) => {
      const typeOptions = SERVICE_TYPES.map(type => '<option value="' + safe(type) + '"' + (item.serviceType === type ? ' selected' : '') + '>' + safe(type) + '</option>').join('');
      const causeField = requiresCause(item.serviceType)
        ? '<label>Motivo / problema a registrar na OS<textarea data-field="cause" data-index="' + index + '" maxlength="500" placeholder="Descreva o que motivou este atendimento (mínimo de 5 caracteres)">' + safe(item.cause || '') + '</textarea></label>'
        : '<label>Observação PMOC (opcional)<input data-field="cause" data-index="' + index + '" maxlength="500" value="' + safe(item.cause || '') + '" placeholder="Observação complementar, se necessário"></label>';
      return '<article class="dbs-dispatch-card" style="padding:10px">'
        + '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between">'
        + '<div style="display:flex;gap:8px;align-items:center;min-width:0"><span class="dbs-dispatch-number">' + (index + 1) + '</span><div style="min-width:0"><strong style="display:block;font-size:11px;color:#24435f">' + safe(item.name) + '</strong><small style="display:block;margin-top:3px;color:#718399;font-size:10px;overflow-wrap:anywhere">' + safe(item.address) + '</small></div></div>'
        + '<div class="dbs-dispatch-actions"><button class="dbs-dispatch-iconbtn" type="button" data-action="up" data-index="' + index + '" aria-label="Subir parada">↑</button><button class="dbs-dispatch-iconbtn" type="button" data-action="down" data-index="' + index + '" aria-label="Descer parada">↓</button><button class="dbs-dispatch-iconbtn" type="button" data-action="remove" data-index="' + index + '" aria-label="Remover parada">×</button></div></div>'
        + '<div class="dbs-dispatch-stop-fields"><label>Tipo de atendimento<select data-field="serviceType" data-index="' + index + '">' + typeOptions + '</select></label>'
        + causeField + '</div></article>';
    }).join('') : '<div class="dbs-dispatch-empty">Selecione os locais que deseja atender. O DBS sugere a sequência a partir da posição do técnico, e você pode reorganizar tudo antes de abrir as OS.</div>';

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
    const legs = planner() && planner().buildRouteLegs(state.selected, originForRoute());
    if (links) {
      links.innerHTML = legs && legs.length ? legs.map(leg => {
        const title = 'Etapa ' + leg.index + ' · paradas ' + leg.firstStop + '–' + leg.lastStop;
        return leg.url
          ? '<div class="dbs-dispatch-maplink"><span>' + safe(title) + '</span><button type="button" class="dbs-dispatch-btn" data-dbs-maps-url="' + safe(leg.url) + '">Abrir no Google Maps →</button></div>'
          : '<div class="dbs-dispatch-status">Etapa longa para um único link; abra as paradas individualmente.</div>';
      }).join('') : '<div class="dbs-dispatch-empty">Adicione locais à rota para montar as etapas do Google Maps.</div>';
    }
    if (!mapElement) return;
    if (!state.candidates.length && !state.location) {
      if (status) status.textContent = 'O mapa aparecerá depois de carregar a posição e os endereços.';
      return;
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
      const origin = state.location && Number.isFinite(Number(state.location.latitude))
        && Number.isFinite(Number(state.location.longitude))
        ? [Number(state.location.latitude), Number(state.location.longitude)] : null;
      if (origin) {
        L.circleMarker(origin, { radius: 10, color: '#064e3b', weight: 3, fillColor: '#34d399', fillOpacity: 1 })
          .bindPopup('<strong>Última posição de ' + safe(getTechnicianLabel(state.technician)) + '</strong><br>' + safe(dateTime(state.location.last_position_at))
            + '<br>' + (state.location.is_live ? 'GPS recente' : 'Última posição conhecida')).addTo(state.mapLayer);
        bounds.push(origin);
      }
      const plottedStops = state.selected.length ? state.selected : state.candidates.slice(0, 15);
      const coordinates = plottedStops.map((stop, index) => {
        const point = [Number(stop.lat), Number(stop.lng)];
        L.circleMarker(point, {
          radius: state.selected.length ? 8 : 6,
          color: '#075985', weight: 2, fillColor: '#38bdf8', fillOpacity: 0.9
        }).bindPopup('<strong>' + (index + 1) + '. ' + safe(stop.name) + '</strong><br>' + safe(stop.address)).addTo(state.mapLayer);
        bounds.push(point);
        return point;
      });
      if (coordinates.length > 1 && state.selected.length > 1) {
        L.polyline(coordinates, { color: '#0369a1', weight: 4, opacity: 0.85 }).addTo(state.mapLayer);
      }
      if (bounds.length > 1) state.map.fitBounds(L.latLngBounds(bounds).pad(0.16));
      else if (bounds.length === 1) state.map.setView(bounds[0], 13);
      else state.map.setView([-22.9, -43.2], 10);
      setTimeout(() => state.map && state.map.invalidateSize(), 120);
      if (status) status.textContent = origin
        ? (state.location.is_live ? 'Pino verde: GPS recente do técnico. ' : 'Pino verde: última posição conhecida (confira a data). ')
          + 'Pinos azuis: locais selecionados ou sugestões próximas.'
        : 'Sem coordenada GPS do técnico. Pinos azuis mostram as sugestões por proximidade geográfica.';
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
      + '<header class="dbs-dispatch-head"><div><p style="color:#93c5fd;font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase">DBS CONTROL · despacho inteligente</p><h2 id="dbs-dispatch-title">Planejar rota antes de abrir OS</h2><p style="color:#c6d3df">Escolha o técnico, veja a última posição autorizada, selecione lojas próximas e aprove a criação das OS somente no final.</p></div><button type="button" class="dbs-dispatch-close" data-action="close" aria-label="Fechar">×</button></header>'
      + '<div class="dbs-dispatch-body">'
      + '<section class="dbs-dispatch-card"><div class="dbs-dispatch-toolbar">'
      + '<label>Técnico responsável<select id="dbs-dispatch-technician"><option value="">Selecione um técnico</option>' + options + '</select></label>'
      + '<label>Data da rota<input id="dbs-dispatch-date" type="date" value="' + safe((byId('day-filter-date') && byId('day-filter-date').value) || currentDate()) + '"></label>'
      + '<button type="button" class="dbs-dispatch-btn secondary" data-action="refresh-location">Atualizar posição do GPS</button></div>'
      + '<div id="dbs-dispatch-location-summary" class="dbs-dispatch-location"><div><strong>Selecione o técnico para consultar a localização.</strong><small>O sistema mostrará a hora da última leitura para diferenciar posição recente de ponto antigo.</small></div></div>'
      + '<label class="dbs-dispatch-origin-toggle"><input id="dbs-dispatch-use-origin" type="checkbox" disabled> Usar a última posição do técnico como ponto de partida da rota</label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="dbs-dispatch-btn" id="dbs-dispatch-build" data-action="build">Sugerir rota pelas proximidades</button><button type="button" class="dbs-dispatch-btn secondary" data-action="nearest-five">Adicionar 5 locais mais próximos</button></div>'
      + '</section>'
      + '<section class="dbs-dispatch-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h3>Mapa da equipe e das lojas</h3><p>O marcador verde representa a última localização do técnico; os azuis são os locais sugeridos.</p></div><span id="dbs-dispatch-map-status" style="font-size:10px;color:#6b7f93">Aguardando dados.</span></div><div id="dbs-dispatch-map" class="dbs-dispatch-map" style="margin-top:10px"></div><div id="dbs-dispatch-maplinks" class="dbs-dispatch-maplinks"></div></section>'
      + '<section class="dbs-dispatch-columns">'
      + '<div class="dbs-dispatch-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h3>Rota selecionada e editável</h3><p>Defina o tipo e o motivo de cada atendimento.</p></div><strong id="dbs-dispatch-count">0 paradas</strong></div><div id="dbs-dispatch-selected" class="dbs-dispatch-list"><div class="dbs-dispatch-empty">Carregue a sugestão e adicione os locais que deseja atender.</div></div></div>'
      + '<div class="dbs-dispatch-card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><h3>Locais cadastrados próximos</h3><p id="dbs-dispatch-available-count">Aguardando análise</p></div></div><input id="dbs-dispatch-search" type="search" placeholder="Filtrar por loja, cliente, bairro ou endereço"><div id="dbs-dispatch-available" class="dbs-dispatch-list"><div class="dbs-dispatch-empty">Clique em “Sugerir rota pelas proximidades”.</div></div></div>'
      + '</section>'
      + '<div id="dbs-dispatch-review" class="dbs-dispatch-review" hidden></div>'
      + '<div id="dbs-dispatch-status" class="dbs-dispatch-status" role="status" aria-live="polite">Nenhuma OS será aberta até você revisar e confirmar a rota.</div>'
      + '<footer class="dbs-dispatch-footer"><div><strong>Etapa final: criação em lote</strong><p>As OS serão atribuídas ao técnico escolhido. Locais não selecionados não serão alterados.</p></div><button type="button" class="dbs-dispatch-btn" id="dbs-dispatch-create" data-action="create" disabled>Revisar e abrir OS em lote</button></footer>'
      + '</div></div>';

    const technicianSelect = byId('dbs-dispatch-technician');
    technicianSelect.addEventListener('change', async function () {
      state.technician = getTechnicians().find(item => String(item.id) === String(this.value)) || null;
      resetPlan();
      await refreshLocation();
      renderLists();
    });
    const toggle = byId('dbs-dispatch-use-origin');
    toggle.addEventListener('change', function () {
      state.originEnabled = Boolean(this.checked);
      if (state.candidates.length) {
        state.candidates = planner().optimizeStops(state.candidates, originForRoute()).stops;
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
      if (action === 'build') { await buildSuggestions(); return; }
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
    review.innerHTML = '<strong>' + state.review.length + ' cadastro(s) exigem revisão e ficaram fora da rota automática:</strong><ul style="margin:6px 0 0;padding-left:18px">'
      + items.map(item => '<li>' + safe(item.name || item.id || 'Registro') + ': ' + safe(item.reason || 'Conferir cadastro') + '</li>').join('')
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
    const orders = state.selected.map(stop => {
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
          + '. Endereço: ' + stop.address + (cause ? '. Motivo informado: ' + cause : ''),
        createdAt: createdAt,
        updatedAt: createdAt,
        causaSolicitacao: cause,
        rotaOrigem: requestId,
        rotaTecnicoId: String(technician.id),
        rotaData: routeDate,
        rotaSequencia: stop.sequence,
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
    const modal = document.createElement('div');
    modal.id = 'dbs-dispatch-route-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'dbs-dispatch-title');
    modal.__previousFocus = document.activeElement;
    document.body.appendChild(modal);
    renderModal();
    const dayTechnician = byId('day-filter-tecnico');
    if (dayTechnician && dayTechnician.value) {
      const select = byId('dbs-dispatch-technician');
      if (select) {
        select.value = dayTechnician.value;
        select.dispatchEvent(new Event('change'));
      }
    }
    return modal;
  }

  window.abrirRotaAtividadesDia = openPlanner;
})();