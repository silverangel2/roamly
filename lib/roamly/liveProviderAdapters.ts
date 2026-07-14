import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type LiveProviderKind =
  | "live_flight_status"
  | "airport_gate"
  | "train_status"
  | "local_transit_disruption"
  | "weather"
  | "traffic"
  | "attraction_closure";

export type LiveProviderStaleStatus = "fresh" | "stale" | "unknown" | "not_applicable";

export type LiveProviderErrorState = {
  code: string;
  message: string;
  required_env?: string[];
  retryable: boolean;
};

export type LiveProviderResult<T = Record<string, unknown>> = {
  provider: string;
  kind: LiveProviderKind;
  source: string;
  retrieved_at: string;
  effective_at: string | null;
  status: "available" | "unavailable" | "degraded";
  confidence: number;
  stale_status: LiveProviderStaleStatus;
  normalized_result: T | null;
  raw_result: unknown;
  errors: LiveProviderErrorState[];
};

type LiveAdapterConfig = {
  kind: LiveProviderKind;
  provider: string;
  source: string;
  requiredEnv: string[];
  endpointEnv?: string;
};

export type LiveFlightStatusRequest = {
  flightNumber: string;
  departureDate?: string | null;
  origin?: string | null;
  destination?: string | null;
};

export type NormalizedLiveFlightStatus = {
  flightNumber: string | null;
  status:
    | "scheduled"
    | "boarding"
    | "departed"
    | "landed"
    | "delayed"
    | "cancelled"
    | "diverted"
    | "unknown";
  scheduledDeparture: string | null;
  estimatedDeparture: string | null;
  actualDeparture: string | null;
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  actualArrival: string | null;
  departureGate: string | null;
  departureTerminal: string | null;
  arrivalGate: string | null;
  arrivalTerminal: string | null;
  delayMinutes: number | null;
  cancelled: boolean;
};

function providerObject(
  value: unknown
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<string, unknown>;
}

function nestedProviderObject(
  value: Record<string, unknown>,
  keys: string[]
) {
  for (const key of keys) {
    const nested = providerObject(value[key]);

    if (nested) return nested;
  }

  return null;
}

function providerText(
  ...values: unknown[]
): string | null {
  for (const value of values) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function providerNumber(
  ...values: unknown[]
): number | null {
  for (const value of values) {
    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return value;
    }

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function providerTimestamp(
  ...values: unknown[]
): string | null {
  const value = providerText(...values);

  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizedFlightStatus(
  value: unknown
): NormalizedLiveFlightStatus["status"] {
  const status =
    providerText(value)?.toLowerCase() || "";

  if (
    status.includes("cancel")
  ) {
    return "cancelled";
  }

  if (
    status.includes("delay")
  ) {
    return "delayed";
  }

  if (
    status.includes("divert")
  ) {
    return "diverted";
  }

  if (
    status.includes("board")
  ) {
    return "boarding";
  }

  if (
    status.includes("depart") ||
    status.includes("airborne") ||
    status.includes("en route") ||
    status.includes("en-route")
  ) {
    return "departed";
  }

  if (
    status.includes("land") ||
    status.includes("arriv")
  ) {
    return "landed";
  }

  if (
    status.includes("schedule") ||
    status.includes("active") ||
    status.includes("on time") ||
    status.includes("on-time")
  ) {
    return "scheduled";
  }

  return "unknown";
}

export function normalizeLiveFlightStatus(
  raw: unknown
): NormalizedLiveFlightStatus | null {
  const root = providerObject(raw);

  if (!root) return null;

  const candidate =
    nestedProviderObject(root, [
      "data",
      "result",
      "flight",
      "flight_status"
    ]) || root;

  const departure =
    nestedProviderObject(candidate, [
      "departure",
      "departure_airport"
    ]) || {};

  const arrival =
    nestedProviderObject(candidate, [
      "arrival",
      "arrival_airport"
    ]) || {};

  const status = normalizedFlightStatus(
    candidate.status ??
      candidate.flight_status ??
      candidate.state
  );

  const scheduledDeparture = providerTimestamp(
    candidate.scheduledDeparture,
    candidate.scheduled_departure,
    departure.scheduled,
    departure.scheduled_time,
    departure.scheduledTime
  );

  const estimatedDeparture = providerTimestamp(
    candidate.estimatedDeparture,
    candidate.estimated_departure,
    departure.estimated,
    departure.estimated_time,
    departure.estimatedTime
  );

  const actualDeparture = providerTimestamp(
    candidate.actualDeparture,
    candidate.actual_departure,
    departure.actual,
    departure.actual_time,
    departure.actualTime
  );

  const scheduledArrival = providerTimestamp(
    candidate.scheduledArrival,
    candidate.scheduled_arrival,
    arrival.scheduled,
    arrival.scheduled_time,
    arrival.scheduledTime
  );

  const estimatedArrival = providerTimestamp(
    candidate.estimatedArrival,
    candidate.estimated_arrival,
    arrival.estimated,
    arrival.estimated_time,
    arrival.estimatedTime
  );

  const actualArrival = providerTimestamp(
    candidate.actualArrival,
    candidate.actual_arrival,
    arrival.actual,
    arrival.actual_time,
    arrival.actualTime
  );

  let delayMinutes = providerNumber(
    candidate.delayMinutes,
    candidate.delay_minutes,
    candidate.delay,
    departure.delay,
    departure.delay_minutes
  );

  if (
    delayMinutes === null &&
    scheduledDeparture &&
    estimatedDeparture
  ) {
    delayMinutes = Math.max(
      0,
      Math.round(
        (
          new Date(estimatedDeparture).getTime() -
          new Date(scheduledDeparture).getTime()
        ) / 60000
      )
    );
  }

  const cancelled =
    status === "cancelled" ||
    candidate.cancelled === true ||
    candidate.is_cancelled === true;

  const normalized: NormalizedLiveFlightStatus = {
    flightNumber: providerText(
      candidate.flightNumber,
      candidate.flight_number,
      candidate.number,
      candidate.ident
    ),
    status: cancelled ? "cancelled" : status,
    scheduledDeparture,
    estimatedDeparture,
    actualDeparture,
    scheduledArrival,
    estimatedArrival,
    actualArrival,
    departureGate: providerText(
      candidate.departureGate,
      candidate.departure_gate,
      departure.gate
    ),
    departureTerminal: providerText(
      candidate.departureTerminal,
      candidate.departure_terminal,
      departure.terminal
    ),
    arrivalGate: providerText(
      candidate.arrivalGate,
      candidate.arrival_gate,
      arrival.gate
    ),
    arrivalTerminal: providerText(
      candidate.arrivalTerminal,
      candidate.arrival_terminal,
      arrival.terminal
    ),
    delayMinutes,
    cancelled
  };

  const hasMeaningfulFlightData =
    normalized.status !== "unknown" ||
    normalized.scheduledDeparture !== null ||
    normalized.estimatedDeparture !== null ||
    normalized.actualDeparture !== null ||
    normalized.departureGate !== null ||
    normalized.departureTerminal !== null;

  return hasMeaningfulFlightData
    ? normalized
    : null;
}

export type LocationStatusRequest = {
  latitude?: number | null;
  longitude?: number | null;
  query?: string | null;
  date?: string | null;
};

const LIVE_ADAPTERS: Record<LiveProviderKind, LiveAdapterConfig> = {
  live_flight_status: {
    kind: "live_flight_status",
    provider: "configured_flight_status_provider",
    source: "Configured live flight status provider",
    requiredEnv: ["ROAMLY_FLIGHT_STATUS_API_KEY", "ROAMLY_FLIGHT_STATUS_API_URL"],
    endpointEnv: "ROAMLY_FLIGHT_STATUS_API_URL"
  },
  airport_gate: {
    kind: "airport_gate",
    provider: "configured_flight_status_provider",
    source: "Configured live airport gate provider",
    requiredEnv: ["ROAMLY_FLIGHT_STATUS_API_KEY", "ROAMLY_FLIGHT_STATUS_API_URL"],
    endpointEnv: "ROAMLY_FLIGHT_STATUS_API_URL"
  },
  train_status: {
    kind: "train_status",
    provider: "configured_train_status_provider",
    source: "Configured live train status provider",
    requiredEnv: ["ROAMLY_TRAIN_STATUS_API_KEY", "ROAMLY_TRAIN_STATUS_API_URL"],
    endpointEnv: "ROAMLY_TRAIN_STATUS_API_URL"
  },
  local_transit_disruption: {
    kind: "local_transit_disruption",
    provider: "configured_transit_status_provider",
    source: "Configured local transit disruption provider",
    requiredEnv: ["ROAMLY_TRANSIT_STATUS_API_KEY", "ROAMLY_TRANSIT_STATUS_API_URL"],
    endpointEnv: "ROAMLY_TRANSIT_STATUS_API_URL"
  },
  weather: {
    kind: "weather",
    provider: "configured_weather_provider",
    source: "Configured weather provider",
    requiredEnv: ["ROAMLY_WEATHER_API_KEY", "ROAMLY_WEATHER_API_URL"],
    endpointEnv: "ROAMLY_WEATHER_API_URL"
  },
  traffic: {
    kind: "traffic",
    provider: "configured_traffic_provider",
    source: "Configured traffic and driving conditions provider",
    requiredEnv: ["GOOGLE_MAPS_API_KEY"],
    endpointEnv: "ROAMLY_TRAFFIC_STATUS_API_URL"
  },
  attraction_closure: {
    kind: "attraction_closure",
    provider: "configured_attraction_status_provider",
    source: "Configured attraction opening and closure provider",
    requiredEnv: ["ROAMLY_ATTRACTION_STATUS_API_KEY", "ROAMLY_ATTRACTION_STATUS_API_URL"],
    endpointEnv: "ROAMLY_ATTRACTION_STATUS_API_URL"
  }
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function configured(config: LiveAdapterConfig) {
  return config.requiredEnv.every((key) => Boolean(clean(process.env[key])));
}

function unavailable<T>(config: LiveAdapterConfig, code = "LIVE_PROVIDER_CREDENTIALS_MISSING"): LiveProviderResult<T> {
  return {
    provider: config.provider,
    kind: config.kind,
    source: config.source,
    retrieved_at: nowIso(),
    effective_at: null,
    status: "unavailable",
    confidence: 0,
    stale_status: "unknown",
    normalized_result: null,
    raw_result: null,
    errors: [
      {
        code,
        message: `${config.source} is not configured. Roamly will not fabricate live delays, gates, cancellations, weather, traffic, or closures.`,
        required_env: config.requiredEnv,
        retryable: false
      }
    ]
  };
}

function degraded<T>(config: LiveAdapterConfig, code: string, retryable: boolean): LiveProviderResult<T> {
  return {
    provider: config.provider,
    kind: config.kind,
    source: config.source,
    retrieved_at: nowIso(),
    effective_at: null,
    status: "degraded",
    confidence: 0,
    stale_status: "unknown",
    normalized_result: null,
    raw_result: null,
    errors: [
      {
        code,
        message: `${config.source} did not return usable live data.`,
        retryable
      }
    ]
  };
}

async function fetchConfiguredEndpoint<T>(config: LiveAdapterConfig, query: Record<string, string>) {
  if (!configured(config)) return unavailable<T>(config);
  const endpoint = config.endpointEnv ? clean(process.env[config.endpointEnv]) : "";
  if (!endpoint || !endpoint.startsWith("https://")) return unavailable<T>(config, "LIVE_PROVIDER_ENDPOINT_MISSING");
  const url = new URL(endpoint);
  Object.entries(query).forEach(([key, value]) => value && url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${clean(process.env[config.requiredEnv[0]])}`,
      accept: "application/json"
    }
  });
  const data = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) return degraded<T>(config, "LIVE_PROVIDER_REQUEST_FAILED", response.status >= 500 || response.status === 429);
  return {
    provider: config.provider,
    kind: config.kind,
    source: config.source,
    retrieved_at: nowIso(),
    effective_at: nowIso(),
    status: "available",
    confidence: 0.75,
    stale_status: "fresh",
    normalized_result: data as T,
    raw_result: data,
    errors: []
  } satisfies LiveProviderResult<T>;
}

export function liveProviderDiagnostics() {
  return Object.values(LIVE_ADAPTERS).map((config) => ({
    kind: config.kind,
    provider: config.provider,
    configured: configured(config),
    required_env: config.requiredEnv,
    source: config.source
  }));
}

export async function liveFlightStatusAdapter(
  request: LiveFlightStatusRequest
) {
  const result = await fetchConfiguredEndpoint(
    LIVE_ADAPTERS.live_flight_status,
    {
      flight_number: clean(request.flightNumber),
      departure_date: clean(request.departureDate),
      origin: clean(request.origin),
      destination: clean(request.destination)
    }
  );

  if (result.status !== "available") {
    return result;
  }

  const normalized =
    normalizeLiveFlightStatus(
      result.raw_result ??
      result.normalized_result
    );

  if (!normalized) {
    return {
      ...result,
      status: "degraded" as const,
      confidence: Math.min(
        result.confidence,
        0.25
      ),
      normalized_result: null,
      errors: [
        ...result.errors,
        {
          code: "UNRECOGNIZED_FLIGHT_RESPONSE",
          message:
            "The configured provider response could not be safely normalized.",
          retryable: false
        }
      ]
    };
  }

  return {
    ...result,
    normalized_result: normalized
  };
}

export async function airportGateAdapter(
  request: LiveFlightStatusRequest
) {
  const result = await fetchConfiguredEndpoint(
    LIVE_ADAPTERS.airport_gate,
    {
      flight_number: clean(request.flightNumber),
      departure_date: clean(request.departureDate),
      origin: clean(request.origin),
      destination: clean(request.destination),
      data: "gate_terminal"
    }
  );

  if (result.status !== "available") {
    return result;
  }

  const normalized =
    normalizeLiveFlightStatus(
      result.raw_result ??
      result.normalized_result
    );

  if (!normalized) {
    return {
      ...result,
      status: "degraded" as const,
      confidence: Math.min(
        result.confidence,
        0.25
      ),
      normalized_result: null,
      errors: [
        ...result.errors,
        {
          code: "UNRECOGNIZED_GATE_RESPONSE",
          message:
            "The configured gate response could not be safely normalized.",
          retryable: false
        }
      ]
    };
  }

  return {
    ...result,
    normalized_result: normalized
  };
}

export function trainStatusAdapter(request: { serviceNumber: string; date?: string | null; origin?: string | null; destination?: string | null }) {
  return fetchConfiguredEndpoint(LIVE_ADAPTERS.train_status, {
    service_number: clean(request.serviceNumber),
    date: clean(request.date),
    origin: clean(request.origin),
    destination: clean(request.destination)
  });
}

export function localTransitDisruptionAdapter(request: LocationStatusRequest) {
  return fetchConfiguredEndpoint(LIVE_ADAPTERS.local_transit_disruption, {
    latitude: request.latitude == null ? "" : String(request.latitude),
    longitude: request.longitude == null ? "" : String(request.longitude),
    query: clean(request.query),
    date: clean(request.date)
  });
}

export function weatherStatusAdapter(request: LocationStatusRequest) {
  return fetchConfiguredEndpoint(LIVE_ADAPTERS.weather, {
    latitude: request.latitude == null ? "" : String(request.latitude),
    longitude: request.longitude == null ? "" : String(request.longitude),
    query: clean(request.query),
    date: clean(request.date)
  });
}

export function trafficDrivingConditionsAdapter(request: { origin?: string | null; destination?: string | null; departureTime?: string | null }) {
  return fetchConfiguredEndpoint(LIVE_ADAPTERS.traffic, {
    origin: clean(request.origin),
    destination: clean(request.destination),
    departure_time: clean(request.departureTime)
  });
}

export function attractionClosureAdapter(request: LocationStatusRequest) {
  return fetchConfiguredEndpoint(LIVE_ADAPTERS.attraction_closure, {
    latitude: request.latitude == null ? "" : String(request.latitude),
    longitude: request.longitude == null ? "" : String(request.longitude),
    query: clean(request.query),
    date: clean(request.date)
  });
}

export async function recordLiveProviderSnapshot(params: {
  supabase: SupabaseClient;
  tripId?: string | null;
  userId?: string | null;
  bookingId?: string | null;
  result: LiveProviderResult<unknown>;
}) {
  const writer = createSupabaseAdminClient() || params.supabase;
  const { error } = await writer.from("live_provider_status_snapshots").insert({
    trip_id: params.tripId || null,
    user_id: params.userId || null,
    booking_id: params.bookingId || null,
    provider_kind: params.result.kind,
    provider: params.result.provider,
    source: params.result.source,
    status: params.result.status,
    confidence: params.result.confidence,
    stale_status: params.result.stale_status,
    result_json: params.result.normalized_result || {},
    errors_json: params.result.errors,
    retrieved_at: params.result.retrieved_at,
    effective_at: params.result.effective_at
  });
  return { ok: !error, error: error?.message || null };
}
