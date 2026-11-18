export function pontoGeolocationErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? Number((error as { code?: unknown }).code)
    : 0;
  if (code === 1) return "Permissão de localização negada. Autorize a localização para este site no navegador e nas configurações do celular.";
  if (code === 2) return "O serviço de localização ainda não conseguiu determinar sua posição. Isso não significa necessariamente que o GPS esteja desligado; pode ser uma indisponibilidade temporária do sinal. Tente novamente em local aberto e confira a permissão do navegador.";
  if (code === 3) return "Não foi possível obter uma posição dentro do tempo limite. Mantenha esta tela aberta, tente em local aberto e confira se o navegador tem permissão de localização.";
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
    && record?.longitude != null
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
 *
 * POSITION_UNAVAILABLE (code 2) and browser timeout notifications (code 3)
 * can be transient while the device is acquiring a fresh fix. Keep the
 * one-shot watch alive until a usable reading or the app-owned deadline.
 *
 * After the first reading at or better than the target accuracy, keep a short
 * settling window open and retain the best reported accuracy. This avoids
 * accepting the first merely-acceptable fix when a better one arrives moments
 * later. At the deadline, a reading up to maxAccuracyMeters is a fallback.
 *
 * This is never a background/continuous employee tracker: the watch is
 * cleared as soon as the bounded capture finishes.
 */
export function capturePontoPosition(
  geolocation: Pick<Geolocation, "watchPosition" | "clearWatch">,
  options: {
    targetAccuracyMeters?: number;
    maxAccuracyMeters?: number;
    timeoutMs?: number;
    settleMs?: number;
  } = {},
): Promise<GeolocationPosition> {
  const targetAccuracy = options.targetAccuracyMeters ?? 80;
  const maxAccuracy = options.maxAccuracyMeters ?? 150;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const settleMs = options.settleMs ?? 2_500;

  return new Promise((resolve, reject) => {
    let watchId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let settleTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let bestPosition: GeolocationPosition | null = null;
    let settled = false;

    const stop = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = null;
      if (settleTimeoutId !== null) clearTimeout(settleTimeoutId);
      settleTimeoutId = null;
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

    const failImmediately = (error: unknown) => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error(pontoGeolocationErrorMessage(error)));
    };

    const handlePositionError = (error: unknown) => {
      if (settled) return;
      const code = error && typeof error === "object" && "code" in error
        ? Number((error as { code?: unknown }).code)
        : 0;

      // A permission denial is definitive, even if a prior reading existed.
      if (code === 1) {
        failImmediately(error);
        return;
      }

      // These device/browser errors can be transient while a fresh fix is
      // being acquired; keep the watch alive until another fix or deadline.
      if (code === 2 || code === 3) return;

      if (bestPosition && bestPosition.coords.accuracy <= maxAccuracy) {
        finish(bestPosition);
        return;
      }
      failImmediately(error);
    };

    const onPosition = (position: GeolocationPosition) => {
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

      if (coords.accuracy <= targetAccuracy && settleTimeoutId === null) {
        if (settleMs <= 0) {
          finish(bestPosition);
          return;
        }
        settleTimeoutId = setTimeout(() => {
          settleTimeoutId = null;
          if (bestPosition && bestPosition.coords.accuracy <= maxAccuracy) {
            finish(bestPosition);
          }
        }, settleMs);
      }
    };

    const onDeadline = () => {
      if (bestPosition && bestPosition.coords.accuracy <= maxAccuracy) {
        finish(bestPosition);
        return;
      }
      failImmediately({ code: 3 });
    };

    try {
      const nextWatchId = geolocation.watchPosition(
        onPosition,
        handlePositionError,
        // Use the app-owned deadline below. A browser-level timeout here can
        // emit code 3 early and prematurely stop a still-recovering GPS watch.
        { enableHighAccuracy: true, maximumAge: 0 },
      );

      // Some test doubles may invoke a callback synchronously before
      // watchPosition returns its ID. Do not leak the watch in that case.
      if (settled) {
        geolocation.clearWatch(nextWatchId);
      } else {
        watchId = nextWatchId;
        timeoutId = setTimeout(onDeadline, timeoutMs);
      }
    } catch (error) {
      failImmediately(error);
    }
  });
}