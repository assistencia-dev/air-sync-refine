import assert from "node:assert/strict";
import {
  capturePontoPosition,
  distanceMeters,
  hasPontoCoordinates,
  pontoGeolocationErrorMessage,
  pontoGoogleMapsEmbedUrl,
  pontoGoogleMapsUrl,
  validatePontoGps,
} from "../src/lib/ponto-geo";

const employee = { ponto_base_lat: -22.9, ponto_base_lng: -43.2, ponto_raio_m: 150 };

// Mensagens dos três códigos nativos de geolocalização.
assert.match(pontoGeolocationErrorMessage({ code: 1 }), /Permissão de localização negada/i);
assert.match(pontoGeolocationErrorMessage({ code: 2 }), /não conseguiu determinar sua posição/i);
assert.match(pontoGeolocationErrorMessage({ code: 3 }), /tempo limite/i);

const inside = validatePontoGps(
  { latitude: -22.9, longitude: -43.2, gps_accuracy_m: 8 },
  employee,
  "entrada",
);
assert.equal(inside.inside_radius, true);
assert.equal(inside.distance_m, 0);

const outsideCoords = { latitude: -22.89, longitude: -43.2, gps_accuracy_m: 6 };
assert.ok(distanceMeters(employee.ponto_base_lat, employee.ponto_base_lng, outsideCoords.latitude, outsideCoords.longitude) > 150);
assert.throws(() => validatePontoGps(outsideCoords, employee, "entrada"), /fora do raio/i);

// Localização é obrigatória para as quatro marcações, não só para a Entrada.
assert.throws(() => validatePontoGps({ gps_accuracy_m: 5 }, employee, "almoco_saida"), /GPS obrigatório/i);
assert.throws(() => validatePontoGps({ latitude: -22.9, longitude: -43.2 }, employee, "saida"), /Precisão do GPS inválida/i);
assert.throws(
  () => validatePontoGps({ latitude: -22.9, longitude: -43.2, gps_accuracy_m: 5 }, {}, "entrada"),
  /Base GPS não configurada/i,
);

// As demais batidas preservam a regra atual: registrar a localização mesmo fora do raio.
const lunchOutside = validatePontoGps(outsideCoords, employee, "almoco_saida");
assert.equal(lunchOutside.inside_radius, false);
assert.ok((lunchOutside.distance_m ?? 0) > 150);

assert.throws(
  () => validatePontoGps({ latitude: -22.9, longitude: -43.2, gps_accuracy_m: 5 }, { ponto_base_lat: -22.9 }, "saida"),
  /incompleta/i,
);
assert.throws(
  () => validatePontoGps({ latitude: 91, longitude: -43.2, gps_accuracy_m: 5 }, employee, "saida"),
  /GPS obrigatório/i,
);
assert.throws(
  () => validatePontoGps({ latitude: -22.9, longitude: -43.2, gps_accuracy_m: -1 }, employee, "saida"),
  /Precisão do GPS inválida/i,
);
assert.throws(
  () => validatePontoGps({ ...outsideCoords, distance_m: 0, inside_radius: true } as any, employee, "entrada"),
  /fora do raio/i,
);

// O mapa usa somente as coordenadas persistidas na marcação.
const savedLocation = { latitude: -22.9, longitude: -43.2 };
assert.equal(hasPontoCoordinates(savedLocation), true);
assert.equal(hasPontoCoordinates({ latitude: null, longitude: -43.2 }), false);
assert.equal(pontoGoogleMapsUrl(savedLocation), "https://www.google.com/maps/search/?api=1&query=-22.9,-43.2");
assert.equal(pontoGoogleMapsEmbedUrl(savedLocation), "https://maps.google.com/maps?q=-22.9,-43.2&z=17&output=embed");
assert.equal(pontoGoogleMapsUrl({ latitude: 91, longitude: -43.2 }), null);

function mockPosition(accuracy: number, latitude = -22.9, longitude = -43.2): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  } as GeolocationPosition;
}

type GpsCallbacks = {
  onPosition: PositionCallback;
  onError: PositionErrorCallback;
  options?: PositionOptions;
};

function mockGeolocation(cleared: number[], watchId = 27, onStart?: (callbacks: GpsCallbacks) => void) {
  let callbacks: GpsCallbacks | null = null;
  const geolocation = {
    watchPosition(success: PositionCallback, error: PositionErrorCallback, options?: PositionOptions) {
      const registeredCallbacks: GpsCallbacks = { onPosition: success, onError: error, options };
      callbacks = registeredCallbacks;
      onStart?.(registeredCallbacks);
      return watchId;
    },
    clearWatch(id: number) { cleared.push(id); },
  } as unknown as Geolocation;

  return {
    geolocation,
    callbacks: () => callbacks,
  };
}

// A primeira leitura aceitável abre a janela de estabilização; uma leitura
// melhor recebida dentro dela deve ser a escolhida.
async function verifyBestAccuracyDuringSettlingWindow() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 31);
  const pending = capturePontoPosition(mock.geolocation, {
    targetAccuracyMeters: 80,
    maxAccuracyMeters: 150,
    timeoutMs: 500,
    settleMs: 50,
  });
  const callbacks = mock.callbacks();
  assert.ok(callbacks);
  assert.equal(callbacks.options?.enableHighAccuracy, true);
  assert.equal(callbacks.options?.maximumAge, 0);
  assert.equal("timeout" in (callbacks.options ?? {}), false);

  callbacks.onPosition(mockPosition(72));
  setTimeout(() => callbacks.onPosition(mockPosition(18)), 15);
  setTimeout(() => callbacks.onPosition(mockPosition(40)), 25);
  const captured = await pending;
  assert.equal(captured.coords.accuracy, 18, "deve prevalecer a leitura válida de menor margem de erro");
  assert.deepEqual(cleared, [31], "o watch deve ser limpo depois da janela de estabilização");
}

// Uma leitura posterior pior não pode substituir a melhor leitura já obtida.
async function verifyWorseAccuracyDoesNotReplaceBest() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 32);
  const pending = capturePontoPosition(mock.geolocation, { timeoutMs: 500, settleMs: 35 });
  const callbacks = mock.callbacks();
  assert.ok(callbacks);
  callbacks.onPosition(mockPosition(24));
  setTimeout(() => callbacks.onPosition(mockPosition(69)), 10);
  const captured = await pending;
  assert.equal(captured.coords.accuracy, 24);
  assert.deepEqual(cleared, [32]);
}

// POSITION_UNAVAILABLE e timeout do navegador são transitórios durante a
// aquisição: o watch deve continuar e aceitar a posição recebida depois.
async function verifyTransientErrorsThenFix() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 33);
  const pending = capturePontoPosition(mock.geolocation, { timeoutMs: 500, settleMs: 15 });
  const callbacks = mock.callbacks();
  assert.ok(callbacks);
  callbacks.onError({ code: 2, message: "Position unavailable" } as GeolocationPositionError);
  callbacks.onError({ code: 3, message: "Timeout" } as GeolocationPositionError);
  assert.deepEqual(cleared, [], "códigos 2 e 3 não podem encerrar a captura");
  setTimeout(() => callbacks.onPosition(mockPosition(43)), 10);
  const captured = await pending;
  assert.equal(captured.coords.accuracy, 43);
  assert.deepEqual(cleared, [33]);
}

// Sem alcançar o alvo de 80 m, uma leitura <=150 m é fallback somente no prazo.
async function verifyFallbackAtDeadline() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 34);
  const startedAt = Date.now();
  const pending = capturePontoPosition(mock.geolocation, { timeoutMs: 45, settleMs: 500 });
  const callbacks = mock.callbacks();
  assert.ok(callbacks);
  callbacks.onPosition(mockPosition(120));
  const captured = await pending;
  assert.equal(captured.coords.accuracy, 120);
  assert.ok(Date.now() - startedAt >= 35, "a leitura fora do alvo deve aguardar o prazo configurado");
  assert.deepEqual(cleared, [34]);
}

// Leituras inválidas ou acima do limite não podem virar uma marcação GPS válida.
async function verifyInvalidAndTooImpreciseReadingsAreRejected() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 35);
  const pending = capturePontoPosition(mock.geolocation, { timeoutMs: 35, settleMs: 10 });
  const callbacks = mock.callbacks();
  assert.ok(callbacks);
  callbacks.onPosition(mockPosition(5, 91, -43.2));
  callbacks.onPosition(mockPosition(5, -22.9, Number.NaN));
  callbacks.onPosition(mockPosition(Number.NaN));
  callbacks.onPosition(mockPosition(220));
  await assert.rejects(pending, /tempo limite/i);
  assert.deepEqual(cleared, [35]);
}

// Negativa explícita da permissão deve interromper imediatamente, mesmo se
// uma leitura provisória já tiver chegado.
async function verifyPermissionDeniedStopsImmediately() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 36);
  const pending = capturePontoPosition(mock.geolocation, { timeoutMs: 500, settleMs: 300 });
  const callbacks = mock.callbacks();
  assert.ok(callbacks);
  callbacks.onPosition(mockPosition(60));
  callbacks.onError({ code: 1, message: "Permission denied" } as GeolocationPositionError);
  await assert.rejects(pending, /Permissão de localização negada/i);
  assert.deepEqual(cleared, [36]);
}

// Uma posição recebida sincronamente não pode deixar watch ativo sem ID.
async function verifySynchronousFixDoesNotLeakWatch() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 37, (callbacks) => callbacks.onPosition(mockPosition(12)));
  const pending = capturePontoPosition(mock.geolocation, { timeoutMs: 500, settleMs: 0 });
  const captured = await pending;
  assert.equal(captured.coords.accuracy, 12);
  assert.deepEqual(cleared, [37], "o ID retornado depois do callback síncrono também precisa ser limpo");
}

// Sem qualquer posição, code 2 não encerra a captura antes do prazo máximo.
async function verifyUnavailableGpsTimesOutSafely() {
  const cleared: number[] = [];
  const mock = mockGeolocation(cleared, 38);
  const startedAt = Date.now();
  const pending = capturePontoPosition(mock.geolocation, { timeoutMs: 45, settleMs: 10 });
  const callbacks = mock.callbacks();
  assert.ok(callbacks);
  callbacks.onError({ code: 2, message: "Position unavailable" } as GeolocationPositionError);
  await assert.rejects(pending, /tempo limite/i);
  assert.ok(Date.now() - startedAt >= 35);
  assert.deepEqual(cleared, [38]);
}

async function runGpsCaptureTests() {
  await verifyBestAccuracyDuringSettlingWindow();
  await verifyWorseAccuracyDoesNotReplaceBest();
  await verifyTransientErrorsThenFix();
  await verifyFallbackAtDeadline();
  await verifyInvalidAndTooImpreciseReadingsAreRejected();
  await verifyPermissionDeniedStopsImmediately();
  await verifySynchronousFixDoesNotLeakWatch();
  await verifyUnavailableGpsTimesOutSafely();
  console.log("RH GPS: melhor leitura, estabilização, erros transitórios, fallback, validação, permissão e limpeza do watch passaram.");
}

void runGpsCaptureTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});