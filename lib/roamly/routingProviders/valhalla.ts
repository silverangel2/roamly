import type {
  RouteEndpoint,
  RouteEvidence,
  RouteMode
} from "../itineraryRouting";

export type ValhallaCosting = "auto" | "pedestrian";
export type ValhallaFreshness = "STATIC_ROUTE";
export type ValhallaAdapterStatus = "OK" | "NO_EVIDENCE" | "INVALID";

export type ValhallaProvenance = {
  routingEngine: "VALHALLA";
  routingEngineVersion: string | null;
  mapDataSource: "OPENSTREETMAP";
  mapDatasetVersion: string | null;
  retrievedAt: string;
};

export type ValhallaRouteRequest = {
  from: RouteEndpoint;
  to: RouteEndpoint;
  costing: ValhallaCosting;
  units: "kilometers" | "miles";
  retrievedAt: string;
  routingEngineVersion?: string | null;
  mapDatasetVersion?: string | null;
};

export type ValhallaNormalizedRoute = {
  status: "OK";
  provider: "VALHALLA";
  providerRouteId: string | null;
  providerRouteIdKind: "VALHALLA_NATIVE_ID" | "NONE";
  evidenceId: string;
  evidenceIdKind: "ROAMLY_ADAPTER_EVIDENCE_ID";
  fromItemId: string;
  toItemId: string;
  departureTime: string | null;
  arrivalTime: string | null;
  freshness: ValhallaFreshness;
  provenance: ValhallaProvenance;
  evidence: RouteEvidence;
};

export type ValhallaInvalidRoute = {
  status: "INVALID";
  routeIndex: number;
  reasons: string[];
};

export type ValhallaResponseResult = {
  status: ValhallaAdapterStatus;
  routes: ValhallaNormalizedRoute[];
  invalidRoutes: ValhallaInvalidRoute[];
  reasons: string[];
};

export type ValhallaMatrixPoint = {
  itemId: string;
  latitude: number;
  longitude: number;
};

export type ValhallaMatrixCell = {
  status: "OK" | "UNKNOWN";
  originItemId: string;
  destinationItemId: string;
  evidence: ValhallaNormalizedRoute | null;
  reasons: string[];
};

export type ValhallaMatrixResult = {
  status: ValhallaAdapterStatus;
  cells: ValhallaMatrixCell[];
  reasons: string[];
};

type ValhallaMatrixRequest = {
  origins: ValhallaMatrixPoint[];
  destinations: ValhallaMatrixPoint[];
  costing: ValhallaCosting;
  units: "kilometers" | "miles";
  retrievedAt: string;
  routingEngineVersion?: string | null;
  mapDatasetVersion?: string | null;
};

type RecordValue = Record<string, unknown>;
const COORDINATE_TOLERANCE_KM = 0.05;
const EARTH_RADIUS_KM = 6371.0088;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function coordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function endpointCoordinate(value: unknown): { latitude: number; longitude: number } | null {
  const point = record(value);
  const latitude = point?.latitude ?? point?.lat;
  const longitude = point?.longitude ?? point?.lon ?? point?.lng;
  return coordinate(latitude, -90, 90) && coordinate(longitude, -180, 180)
    ? { latitude, longitude }
    : null;
}

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const latA = radians(a.latitude);
  const latB = radians(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, value)));
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) return null;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : null;
}

function modeFor(costing: unknown): RouteMode {
  return costing === "auto" ? "DRIVE" : costing === "pedestrian" ? "WALK" : "UNKNOWN";
}

function convertDistanceToKm(value: unknown, units: "kilometers" | "miles"): number | null {
  if (!finiteNonNegative(value)) return null;
  return units === "miles" ? value * 1.609344 : value;
}

function summaryFromTrip(trip: RecordValue): RecordValue | null {
  const legs = trip.legs;
  if (Array.isArray(legs) && legs.length > 0) {
    const totals = { length: 0, time: 0 };
    for (const legValue of legs) {
      const leg = record(legValue);
      const summary = record(leg?.summary);
      if (!summary || !finiteNonNegative(summary.length) || !finiteNonNegative(summary.time)) return null;
      totals.length += summary.length;
      totals.time += summary.time;
    }
    return totals;
  }
  return record(trip.summary);
}

function endpointLocations(trip: RecordValue): { from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number } } | null {
  if (!Array.isArray(trip.locations) || trip.locations.length < 2) return null;
  const from = endpointCoordinate(trip.locations[0]);
  const to = endpointCoordinate(trip.locations[trip.locations.length - 1]);
  return from && to ? { from, to } : null;
}

function routeValues(trip: RecordValue, units: "kilometers" | "miles"): { distanceKm: number | null; durationMinutes: number | null; invalidDistance: boolean; invalidDuration: boolean } {
  const summary = summaryFromTrip(trip);
  const rawDistance = summary?.length;
  const rawDuration = summary?.time;
  const hasDistance = rawDistance !== undefined && rawDistance !== null;
  const hasDuration = rawDuration !== undefined && rawDuration !== null;
  return {
    distanceKm: hasDistance ? convertDistanceToKm(rawDistance, units) : null,
    durationMinutes: hasDuration && finiteNonNegative(rawDuration) ? rawDuration / 60 : null,
    invalidDistance: hasDistance && !finiteNonNegative(rawDistance),
    invalidDuration: hasDuration && !finiteNonNegative(rawDuration)
  };
}

function makeEvidenceId(request: ValhallaRouteRequest, routeIndex: number): string {
  return `valhalla-adapter:${request.from.itemId}->${request.to.itemId}:route-${routeIndex}:${request.retrievedAt}`;
}

function normalizeTrip(trip: RecordValue, request: ValhallaRouteRequest, routeIndex: number): ValhallaNormalizedRoute | ValhallaInvalidRoute {
  const reasons: string[] = [];
  const tripStatus = trip.status;
  if (tripStatus !== undefined && tripStatus !== 0 && tripStatus !== "0" && tripStatus !== "OK" && tripStatus !== "SUCCESS") {
    reasons.push("PROVIDER_TRIP_ERROR");
  }
  const from = endpointCoordinate(request.from);
  const to = endpointCoordinate(request.to);
  if (!from || !to) reasons.push("INVALID_EXPECTED_COORDINATES");
  const responseEndpoints = endpointLocations(trip);
  if (Array.isArray(trip.locations) && !responseEndpoints) reasons.push("INVALID_RESPONSE_COORDINATES");
  if (responseEndpoints && from && to) {
    if (haversineKm(responseEndpoints.from, from) > COORDINATE_TOLERANCE_KM) reasons.push("ORIGIN_COORDINATE_MISMATCH");
    if (haversineKm(responseEndpoints.to, to) > COORDINATE_TOLERANCE_KM) reasons.push("DESTINATION_COORDINATE_MISMATCH");
  }
  const values = routeValues(trip, request.units);
  if (values.invalidDistance) reasons.push("INVALID_DISTANCE");
  if (values.invalidDuration) reasons.push("INVALID_DURATION");
  const mode = modeFor(trip.costing ?? request.costing);
  if (mode === "UNKNOWN") reasons.push("UNSUPPORTED_COSTING");
  const summary = summaryFromTrip(trip);
  if (!summary) reasons.push("MISSING_OR_INVALID_SUMMARY");
  if (reasons.length) return { status: "INVALID", routeIndex, reasons };

  const providerRouteId = typeof trip.id === "string" && trip.id.length > 0 ? trip.id : null;
  const departureTime = validTimestamp(summary?.departure_time ?? summary?.departureTime);
  const arrivalTime = validTimestamp(summary?.arrival_time ?? summary?.arrivalTime);
  const provenance: ValhallaProvenance = {
    routingEngine: "VALHALLA",
    routingEngineVersion: typeof request.routingEngineVersion === "string" ? request.routingEngineVersion : null,
    mapDataSource: "OPENSTREETMAP",
    mapDatasetVersion: typeof request.mapDatasetVersion === "string" ? request.mapDatasetVersion : null,
    retrievedAt: request.retrievedAt
  };
  return {
    status: "OK",
    provider: "VALHALLA",
    providerRouteId,
    providerRouteIdKind: providerRouteId ? "VALHALLA_NATIVE_ID" : "NONE",
    evidenceId: makeEvidenceId(request, routeIndex),
    evidenceIdKind: "ROAMLY_ADAPTER_EVIDENCE_ID",
    fromItemId: request.from.itemId,
    toItemId: request.to.itemId,
    departureTime,
    arrivalTime,
    freshness: "STATIC_ROUTE",
    provenance,
    evidence: {
      fromItemId: request.from.itemId,
      toItemId: request.to.itemId,
      mode,
      distanceKm: values.distanceKm,
      distanceKind: values.distanceKm === null ? "UNKNOWN" : "ROUTE_DISTANCE",
      durationMinutes: values.durationMinutes,
      durationSource: values.durationMinutes === null ? null : "VALHALLA static route duration",
      authority: values.durationMinutes === null ? "UNKNOWN" : "AUTHORITATIVE_ROUTE",
      source: "VALHALLA_ROUTING_FIXTURE_ADAPTER",
      retrievedAt: request.retrievedAt,
      confidence: values.durationMinutes === null ? "unknown" : "high"
    }
  };
}

export function normalizeValhallaResponse(input: {
  request: ValhallaRouteRequest;
  response: unknown;
}): ValhallaResponseResult {
  const response = record(input.response);
  const responseStatus = response?.status;
  const responseFailed = responseStatus !== undefined
    && responseStatus !== 0
    && responseStatus !== "0"
    && responseStatus !== "OK"
    && responseStatus !== "SUCCESS";
  if (!response || response.error !== undefined || responseFailed || response.status === "NO_ROUTE") {
    return { status: "NO_EVIDENCE", routes: [], invalidRoutes: [], reasons: ["PROVIDER_ERROR_OR_NO_ROUTE"] };
  }
  const candidateRoutes = Array.isArray(response.trips)
    ? response.trips
    : Array.isArray(response.routes) ? response.routes : response.trip ? [response.trip] : [];
  if (!candidateRoutes.length) return { status: "NO_EVIDENCE", routes: [], invalidRoutes: [], reasons: ["NO_TRIP"] };
  const routes: ValhallaNormalizedRoute[] = [];
  const invalidRoutes: ValhallaInvalidRoute[] = [];
  candidateRoutes.forEach((value, routeIndex) => {
    const trip = record(value);
    const normalized = trip
      ? normalizeTrip(trip, input.request, routeIndex)
      : { status: "INVALID", routeIndex, reasons: ["MALFORMED_TRIP"] } as ValhallaInvalidRoute;
    if (normalized.status === "OK") routes.push(normalized);
    else invalidRoutes.push(normalized);
  });
  return {
    status: routes.length ? "OK" : "INVALID",
    routes,
    invalidRoutes,
    reasons: invalidRoutes.length ? ["SOME_TRIPS_INVALID"] : []
  };
}

function matrixPoint(value: unknown): ValhallaMatrixPoint | null {
  const point = record(value);
  const itemId = point?.itemId;
  const latitude = point?.latitude;
  const longitude = point?.longitude;
  return typeof itemId === "string" && coordinate(latitude, -90, 90) && coordinate(longitude, -180, 180)
    ? { itemId, latitude, longitude }
    : null;
}

export function normalizeValhallaMatrix(input: {
  request: ValhallaMatrixRequest;
  response: unknown;
}): ValhallaMatrixResult {
  const response = record(input.response);
  const origins = input.request.origins.map(matrixPoint);
  const destinations = input.request.destinations.map(matrixPoint);
  const rawCells = response?.sources_to_targets;
  const responseStatus = response?.status;
  const responseFailed = responseStatus !== undefined
    && responseStatus !== 0
    && responseStatus !== "0"
    && responseStatus !== "OK"
    && responseStatus !== "SUCCESS";
  if (!response || response?.error !== undefined || responseFailed || !origins.length || origins.some((point) => !point) || !destinations.length || destinations.some((point) => !point) || !Array.isArray(rawCells) || !rawCells.length) {
    return { status: "NO_EVIDENCE", cells: [], reasons: ["MATRIX_DATA_MISSING"] };
  }
  const cells: unknown[] = [];
  const nested = rawCells.every((row) => Array.isArray(row));
  if (nested) {
    rawCells.forEach((row, originIndex) => {
      if (originIndex >= origins.length) return;
      (row as unknown[]).forEach((cell, destinationIndex) => {
        const value = record(cell);
        if (!value) return;
        const explicitOrigin = value.from_index;
        const explicitDestination = value.to_index;
        if (explicitOrigin !== undefined && explicitOrigin !== originIndex) return;
        if (explicitDestination !== undefined && explicitDestination !== destinationIndex) return;
        cells.push({ ...value, from_index: originIndex, to_index: destinationIndex });
      });
    });
  } else if (rawCells.every((cell) => !Array.isArray(cell))) {
    cells.push(...rawCells);
  } else {
    return { status: "NO_EVIDENCE", cells: [], reasons: ["MATRIX_DATA_MISSING"] };
  }
  if (!cells.length) return { status: "NO_EVIDENCE", cells: [], reasons: ["MATRIX_DATA_MISSING"] };
  const normalized: ValhallaMatrixCell[] = [];
  for (const value of cells) {
    const cell = record(value);
    const originIndex = cell?.from_index;
    const destinationIndex = cell?.to_index;
    const from = typeof originIndex === "number" && Number.isInteger(originIndex) ? origins[originIndex] : null;
    const to = typeof destinationIndex === "number" && Number.isInteger(destinationIndex) ? destinations[destinationIndex] : null;
    if (!cell || !from || !to) continue;
    const request: ValhallaRouteRequest = {
      from: { itemId: from.itemId, latitude: from.latitude, longitude: from.longitude },
      to: { itemId: to.itemId, latitude: to.latitude, longitude: to.longitude },
      costing: input.request.costing,
      units: input.request.units,
      retrievedAt: input.request.retrievedAt,
      routingEngineVersion: input.request.routingEngineVersion,
      mapDatasetVersion: input.request.mapDatasetVersion
    };
    const unavailable = cell.status === "UNREACHABLE" || cell.status === "ERROR" || cell.distance === null || cell.time === null || cell.distance === undefined || cell.time === undefined;
    if (unavailable) {
      normalized.push({ status: "UNKNOWN", originItemId: from.itemId, destinationItemId: to.itemId, evidence: null, reasons: ["MATRIX_CELL_UNAVAILABLE"] });
      continue;
    }
    const route = normalizeValhallaResponse({ request, response: { trip: { costing: input.request.costing, summary: { length: cell.distance, time: cell.time } } } });
    const evidence = route.routes[0] ?? null;
    normalized.push({
      status: evidence ? "OK" : "UNKNOWN",
      originItemId: from.itemId,
      destinationItemId: to.itemId,
      evidence,
      reasons: evidence ? [] : ["MATRIX_CELL_NO_EVIDENCE"]
    });
  }
  return { status: normalized.length ? "OK" : "NO_EVIDENCE", cells: normalized, reasons: [] };
}
