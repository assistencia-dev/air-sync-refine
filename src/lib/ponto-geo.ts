export type PontoGeoInput = {
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy_m?: number | null;
};

export type PontoGeoEmployee = {
  ponto_base_lat?: number | string | null;
  ponto_base_lng?: number | string | null;
  ponto_raio_m?: number | string | null;
};

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Recalcula a distância no servidor a partir das coordenadas recebidas.
 * Nunca confia em distance_m/inside_radius enviados pelo navegador.
 */
export function validatePontoGps(
  input: PontoGeoInput,
  employee: PontoGeoEmployee,
  punchType: "entrada" | "almoco_saida" | "almoco_retorno" | "saida",
): { distance_m: number | null; inside_radius: boolean | null } {
  const latitude = input.latitude;
  const longitude = input.longitude;
  const accuracy = input.gps_accuracy_m;

  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("GPS obrigatório: não foi possível validar as coordenadas desta marcação.");
  }
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100_000) {
    throw new Error("Precisão do GPS inválida. Ative a localização e tente novamente.");
  }

  const hasBaseLat = employee.ponto_base_lat != null;
  const hasBaseLng = employee.ponto_base_lng != null;
  if (hasBaseLat !== hasBaseLng) {
    throw new Error("Configuração GPS da base incompleta. O RH deve cadastrar latitude e longitude.");
  }
  if (punchType === "entrada" && !hasBaseLat) {
    throw new Error("Base GPS não configurada pelo RH. Cadastre latitude e longitude antes de liberar a Entrada.");
  }
  if (!hasBaseLat || !hasBaseLng) return { distance_m: null, inside_radius: null };

  const baseLat = Number(employee.ponto_base_lat);
  const baseLng = Number(employee.ponto_base_lng);
  const radius = Number(employee.ponto_raio_m ?? 150);
  if (
    !Number.isFinite(baseLat) || baseLat < -90 || baseLat > 90 ||
    !Number.isFinite(baseLng) || baseLng < -180 || baseLng > 180 ||
    !Number.isInteger(radius) || radius < 20 || radius > 5_000
  ) {
    throw new Error("Configuração de geolocalização da base inválida. Revise a base e o raio no RH.");
  }

  const distance = distanceMeters(baseLat, baseLng, latitude, longitude);
  const inside = distance <= radius;
  if (punchType === "entrada" && !inside) {
    throw new Error("Marcação bloqueada: você está fora do raio GPS permitido pelo RH.");
  }
  return { distance_m: distance, inside_radius: inside };
}
