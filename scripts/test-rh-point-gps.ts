import assert from "node:assert/strict";
import { distanceMeters, validatePontoGps } from "../src/lib/ponto-geo";

const employee = { ponto_base_lat: -22.9, ponto_base_lng: -43.2, ponto_raio_m: 150 };

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

// A Entrada não pode ser liberada sem uma base geográfica cadastrada pelo RH.
assert.throws(
  () => validatePontoGps({ latitude: -22.9, longitude: -43.2, gps_accuracy_m: 5 }, {}, "entrada"),
  /Base GPS não configurada/i,
);

// Para outras batidas, a posição é gravada mesmo que esteja fora do raio,
// mantendo a regra atual que restringe a geocerca à Entrada.
const lunchOutside = validatePontoGps(outsideCoords, employee, "almoco_saida");
assert.equal(lunchOutside.inside_radius, false);
assert.ok((lunchOutside.distance_m ?? 0) > 150);

// Coordenadas incompletas e configuração parcial da base nunca são aceitas.
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

// Valores de distância/raio enviados pelo cliente não participam do cálculo.
assert.throws(
  () => validatePontoGps({ ...outsideCoords, distance_m: 0, inside_radius: true } as any, employee, "entrada"),
  /fora do raio/i,
);

console.log("RH GPS: captura obrigatória, precisão, geocerca server-side, raio e proteção contra valores adulterados passaram.");
