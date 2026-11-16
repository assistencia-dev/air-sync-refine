export function pontoGeolocationErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? Number((error as { code?: unknown }).code)
    : 0;
  if (code === 1) return "Permissão de localização negada. Autorize a localização para este site no navegador e nas configurações do celular.";
  if (code === 2) return "O dispositivo não conseguiu determinar sua posição. Ative a localização/GPS, desative o modo avião e tente novamente em local aberto.";
  if (code === 3) return "O GPS excedeu o tempo de resposta. Mantenha a localização precisa ativada e tente novamente em local aberto.";
  return "Falha ao acessar o GPS. Confira a permissão de localização do navegador e tente novamente.";
}

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


export type PontoLocationRecord = {
  latitude?: number | string | null;
  longitude?: number | string | null;
};

export function hasPontoCoordinates(record: PontoLocationRecord | null | undefined): boolean {
  const latitude = Number(record?.latitude);
  const longitude = Number(record?.longitude);
  return record?.latitude != null
    && record?.longitude != null
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180;
}

/** A map link is built only from coordinates persisted on the punch record. */
export function pontoGoogleMapsUrl(record: PontoLocationRecord): string | null {
  if (!hasPontoCoordinates(record)) return null;
  return "https://www.google.com/maps/search/?api=1&query="
    + Number(record.latitude) + "," + Number(record.longitude);
}

export function pontoGoogleMapsEmbedUrl(record: PontoLocationRecord): string | null {
  if (!hasPontoCoordinates(record)) return null;
  return "https://maps.google.com/maps?q="
    + Number(record.latitude) + "," + Number(record.longitude) + "&z=17&output=embed";
}

/**
 * Obtains a fresh GPS fix only after an explicit punch action.
 * The watch is stopped immediately after an adequate fix or timeout; it is
 * never retained as a background/continuous employee tracker.
 */
export function capturePontoPosition(
  geolocation: Pick<Geolocation, "watchPosition" | "clearWatch">,
  options: { targetAccuracyMeters?: number; maxAccuracyMeters?: number; timeoutMs?: number } = {},
): Promise<GeolocationPosition> {
  const targetAccuracy = options.targetAccuracyMeters ?? 80;
  const maxAccuracy = options.maxAccuracyMeters ?? 150;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return new Promise((resolve, reject) => {
    let watchId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let bestPosition: GeolocationPosition | null = null;
    let settled = false;

    const stop = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = null;
      if (watchId !== null) {
        geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const finish = (position: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      stop();
      resolve(position);
    };

    const fail = (error: unknown) => {
      if (settled) return;
      if (bestPosition && Number(bestPosition.coords.accuracy) <= maxAccuracy) {
        finish(bestPosition);
        return;
      }
      settled = true;
      stop();
      reject(new Error(pontoGeolocationErrorMessage(error)));
    };

    try {
      watchId = geolocation.watchPosition(
        (position) => {
          const coords = position?.coords;
          if (!coords
            || !Number.isFinite(coords.latitude)
            || !Number.isFinite(coords.longitude)
            || !Number.isFinite(coords.accuracy)
            || coords.accuracy < 0
            || coords.latitude < -90 || coords.latitude > 90
            || coords.longitude < -180 || coords.longitude > 180) return;

          if (!bestPosition || coords.accuracy < bestPosition.coords.accuracy) {
            bestPosition = position;
          }
          if (coords.accuracy <= targetAccuracy) finish(position);
        },
        fail,
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
      timeoutId = setTimeout(() => {
        if (bestPosition && bestPosition.coords.accuracy <= maxAccuracy) {
          finish(bestPosition);
          return;
        }
        fail({ code: 3 });
      }, timeoutMs);
    } catch (error) {
      fail(error);
    }
  });
}
