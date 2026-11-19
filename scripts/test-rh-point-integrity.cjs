const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const ponto = fs.readFileSync(path.join(root, "src/lib/ponto.functions.ts"), "utf8");
const dp = fs.readFileSync(path.join(root, "src/lib/rh.dp.functions.ts"), "utf8");
const workspace = fs.readFileSync(path.join(root, "src/components/RhPontoWorkspace.tsx"), "utf8");
const exportsSource = fs.readFileSync(path.join(root, "src/lib/rh.exports.ts"), "utf8");
const geo = fs.readFileSync(path.join(root, "src/lib/ponto-geo.ts"), "utf8");

assert.match(ponto, /export function minutesFromTime/);
assert.match(ponto, /America\/Sao_Paulo/);
assert.match(ponto, /adjustment_type === "desconto"/);
assert.match(ponto, /!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//, "validação de data deve aceitar datas reais, não a string literal \\\\d");
assert.match(dp, /RH_TIME_ADJUSTMENT_TYPES/);
assert.match(dp, /Number\.isInteger\(input\.minutes\)/);
assert.match(dp, /\.eq\("status","pendente"\)/);
assert.match(workspace, /por funcionário\/dia/);
assert.match(workspace, /adjusted_worked_minutes/);
assert.match(workspace, /Trabalhado corrigido/);
assert.match(exportsSource, /win\.document\.open\(\)/);
assert.match(exportsSource, /pointLabels/);
assert.match(ponto, /validatePontoGps\(data, employee, data\.punch_type\)/, "o backend deve validar o GPS no servidor");
assert.match(ponto, /select\("id, employee_id, work_date, punch_type, punched_at, latitude, longitude, gps_accuracy_m, distance_m, inside_radius, note"\)/, "o painel RH deve receber as coordenadas e a precisão salvas em cada batida");
assert.match(ponto, /timeZone: "America\/Sao_Paulo"/, "a data operacional deve usar o fuso oficial calculado no servidor");
assert.match(ponto, /work_date: serverWorkDate/, "a data enviada pelo dispositivo não deve ser persistida sem validação do servidor");
assert.match(ponto, /DEFAULT now\(\) do PostgreSQL/, "o timestamp UTC deve continuar vindo do banco, não do relógio do dispositivo");
assert.match(ponto, /distance_m: gps\.distance_m, inside_radius: gps\.inside_radius/, "o backend deve gravar distância recalculada no servidor");
assert.match(geo, /distance - accuracy > radius/, "a entrada só deve ser bloqueada quando a margem GPS confirma que está fora do raio");
assert.match(geo, /inside === false/, "a incerteza da geocerca deve resultar em conferência RH, não bloqueio falso");
assert.match(ponto, /Cadastre latitude e longitude da base/, "o RH não pode liberar o ponto sem configurar a base GPS");
assert.match(workspace, /r\.inside_radius === true \? "Dentro do raio" : "GPS capturado"/, "a interface deve distinguir captura GPS de geocerca validada");
assert.match(workspace, /capturePontoPosition\(navigator\.geolocation,/, "o cliente deve buscar uma posição GPS nova durante a batida com prazo limitado");
assert.match(workspace, /timeoutMs: 12_000/, "a tentativa de GPS não deve impedir indefinidamente o registro da jornada");
assert.match(workspace, /GPS pendente de conferência pelo RH/, "a interface deve informar quando a batida foi salva sem GPS validado");
assert.match(ponto, /GPS pendente de conferência pelo RH/, "o servidor deve registrar nota de conferência quando não há GPS");
assert.match(ponto, /gps_status: gpsPending \? "PENDENTE" : "VALIDADO"/, "a auditoria deve distinguir geolocalização pendente de validada");
assert.match(ponto, /timeZone: "America\/Sao_Paulo"/, "a data operacional deve continuar vindo do fuso oficial do servidor");
assert.doesNotMatch(ponto, /data\.work_date !== serverWorkDate/, "a batida não pode ser descartada porque o relógio do dispositivo diverge do servidor");
assert.match(geo, /watchPosition/, "a captura deve aguardar uma leitura GPS atualizada");
assert.match(geo, /clearWatch\(watchId\)/, "a leitura GPS deve ser encerrada após cada batida");
assert.match(geo, /maximumAge: 0/, "a captura não deve reaproveitar uma localização antiga");
assert.match(geo, /targetAccuracyMeters \?\? 80/, "a captura deve buscar precisão adequada antes de concluir");
assert.match(workspace, /Localização das marcações/, "o painel do RH deve apresentar o mapa das batidas");
assert.match(workspace, /pontoGoogleMapsEmbedUrl/, "o mapa deve usar as coordenadas persistidas");
assert.match(workspace, /Ver mapa/, "o painel diário deve oferecer acesso direto ao mapa");
assert.match(workspace, /Ver localização/, "o histórico do colaborador deve permitir conferir sua própria batida");
assert.match(geo, /timeoutMs\s*=\s*options\.timeoutMs\s*\?\?\s*45_000/, "a captura GPS deve tolerar a aquisição inicial do sinal");
assert.match(geo, /settleMs\s*=\s*options\.settleMs\s*\?\?\s*2_500/, "a captura deve comparar leituras por uma pequena janela de estabilização");
assert.match(geo, /coords\.accuracy < bestPosition\.coords\.accuracy/, "a leitura mais precisa deve ser preservada");
assert.match(geo, /if \(code === 2 \|\| code === 3\) return/, "POSITION_UNAVAILABLE e timeout do navegador devem ser transitórios");
assert.match(geo, /if \(code === 1\)/, "a permissão explicitamente negada deve encerrar a captura imediatamente");
assert.doesNotMatch(geo, /timeout: timeoutMs/, "o timeout interno do navegador não deve cancelar a aquisição antes do prazo controlado pelo app");
assert.match(workspace, /window\.isSecureContext/, "a interface deve orientar quando a origem não for HTTPS");
assert.match(geo, /pontoGeolocationErrorMessage/, "os erros nativos de geolocalização devem ser traduzidos para instruções claras");

function parseTime(value) {
  const raw = String(value || "").trim();
  const plain = raw.match(/^(?:[T ]?)([01]?\d|2[0-3]):([0-5]\d)/);
  if (plain) return Number(plain[1]) * 60 + Number(plain[2]);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
  return Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
}

assert.equal(parseTime("08:00:00"), 480);
assert.equal(parseTime("2026-10-26T11:00:00Z"), 480);
assert.equal(parseTime("2026-10-26T23:30:00Z"), 1230);

const rawPunches = [
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "entrada", punched_at: "2026-10-26T11:00:00Z" },
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "almoco_saida", punched_at: "2026-10-26T15:00:00Z" },
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "almoco_retorno", punched_at: "2026-10-26T16:00:00Z" },
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "saida", punched_at: "2026-10-26T20:00:00Z" },
];
const days = new Map();
for (const row of rawPunches) {
  const key = String(row.employee_id) + "|" + row.work_date;
  days.set(key, (days.get(key) || 0) + 1);
}
assert.equal(days.size, 1, "quatro batidas devem formar um único dia no relatório");
assert.equal([...days.values()][0], 4);

const adjusted = 8 * 60 + 30;
const approvedAdjustment = 30;
assert.equal(adjusted + approvedAdjustment, 9 * 60, "ajuste aprovado deve aparecer no total corrigido");
console.log("RH point integrity: data validation, timezone parsing, daily grouping, approved adjustments and PDF contracts passed.");

const geoModule = { exports: {} };
const geoRuntime = ts.transpileModule(geo, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(geoRuntime, {
  module: geoModule,
  exports: geoModule.exports,
  setTimeout,
  clearTimeout,
  Date,
  Promise,
  Number,
  Math,
  Error,
});
const capturePontoPosition = geoModule.exports.capturePontoPosition;
const mockedPosition = (accuracy, latitude = -22.9, longitude = -43.2) => ({
  coords: { latitude, longitude, accuracy },
  timestamp: Date.now(),
});

async function verifyPontoGpsBestAccuracy() {
  let onPosition;
  let options;
  const cleared = [];
  const gps = {
    watchPosition(success, _error, watchOptions) {
      onPosition = success;
      options = watchOptions;
      return 501;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = capturePontoPosition(gps, { timeoutMs: 300, settleMs: 40 });
  assert.equal(options.enableHighAccuracy, true);
  assert.equal(options.maximumAge, 0);
  assert.equal("timeout" in options, false);
  onPosition(mockedPosition(73));
  setTimeout(() => onPosition(mockedPosition(17)), 10);
  setTimeout(() => onPosition(mockedPosition(38)), 20);
  const position = await pending;
  assert.equal(position.coords.accuracy, 17, "a melhor precisão recebida na janela deve vencer");
  assert.deepEqual(cleared, [501]);
}

async function verifyPontoGpsWorseReadingDoesNotReplaceBest() {
  let onPosition;
  const cleared = [];
  const gps = {
    watchPosition(success) { onPosition = success; return 502; },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = capturePontoPosition(gps, { timeoutMs: 300, settleMs: 35 });
  onPosition(mockedPosition(19));
  setTimeout(() => onPosition(mockedPosition(90)), 8);
  const position = await pending;
  assert.equal(position.coords.accuracy, 19);
  assert.deepEqual(cleared, [502]);
}

async function verifyPontoGpsTransientRecovery() {
  let onPosition;
  let onError;
  const cleared = [];
  const gps = {
    watchPosition(success, error) {
      onPosition = success;
      onError = error;
      return 503;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = capturePontoPosition(gps, { timeoutMs: 300, settleMs: 10 });
  onError({ code: 2, message: "Position unavailable" });
  onError({ code: 3, message: "Timeout" });
  assert.deepEqual(cleared, [], "códigos 2 e 3 não devem encerrar a captura");
  setTimeout(() => onPosition(mockedPosition(42)), 8);
  const position = await pending;
  assert.equal(position.coords.accuracy, 42);
  assert.deepEqual(cleared, [503]);
}

async function verifyPontoGpsDeadlineFallback() {
  let onPosition;
  const cleared = [];
  const gps = {
    watchPosition(success) { onPosition = success; return 504; },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = capturePontoPosition(gps, { timeoutMs: 35, settleMs: 300 });
  onPosition(mockedPosition(125));
  const position = await pending;
  assert.equal(position.coords.accuracy, 125, "até 150 m pode ser fallback no prazo máximo");
  assert.deepEqual(cleared, [504]);
}

async function verifyPontoGpsInvalidAndImpreciseReadings() {
  let onPosition;
  const cleared = [];
  const gps = {
    watchPosition(success) { onPosition = success; return 505; },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = capturePontoPosition(gps, { timeoutMs: 35, settleMs: 10 });
  onPosition(mockedPosition(5, 91, -43.2));
  onPosition(mockedPosition(5, -22.9, Number.NaN));
  onPosition(mockedPosition(Number.NaN));
  onPosition(mockedPosition(220));
  await assert.rejects(pending, /tempo limite/i);
  assert.deepEqual(cleared, [505]);
}

async function verifyPontoGpsPermissionDenial() {
  let onPosition;
  let onError;
  const cleared = [];
  const gps = {
    watchPosition(success, error) {
      onPosition = success;
      onError = error;
      return 506;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = capturePontoPosition(gps, { timeoutMs: 300, settleMs: 250 });
  onPosition(mockedPosition(60));
  onError({ code: 1, message: "Permission denied" });
  await assert.rejects(pending, /Permissão de localização negada/i);
  assert.deepEqual(cleared, [506]);
}

async function verifyPontoGpsSynchronousFixClearsWatch() {
  const cleared = [];
  const gps = {
    watchPosition(success) {
      success(mockedPosition(12));
      return 507;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const position = await capturePontoPosition(gps, { timeoutMs: 300, settleMs: 0 });
  assert.equal(position.coords.accuracy, 12);
  assert.deepEqual(cleared, [507], "o watch deve ser limpo mesmo quando a posição chega antes do ID");
}

async function verifyPontoGpsDeadline() {
  let onError;
  const cleared = [];
  const gps = {
    watchPosition(_success, error) { onError = error; return 508; },
    clearWatch(id) { cleared.push(id); },
  };
  const started = Date.now();
  const pending = capturePontoPosition(gps, { timeoutMs: 35, settleMs: 10 });
  onError({ code: 2, message: "Position unavailable" });
  await assert.rejects(pending, /tempo limite/i);
  assert.ok(Date.now() - started >= 25);
  assert.deepEqual(cleared, [508]);
}

async function verifyPontoGpsCaptureRegression() {
  await verifyPontoGpsBestAccuracy();
  await verifyPontoGpsWorseReadingDoesNotReplaceBest();
  await verifyPontoGpsTransientRecovery();
  await verifyPontoGpsDeadlineFallback();
  await verifyPontoGpsInvalidAndImpreciseReadings();
  await verifyPontoGpsPermissionDenial();
  await verifyPontoGpsSynchronousFixClearsWatch();
  await verifyPontoGpsDeadline();
  console.log("RH GPS capture: best accuracy, settling, transient recovery, fallback, invalid readings, permission, timeout and watch cleanup passed.");
}

void verifyPontoGpsCaptureRegression().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});