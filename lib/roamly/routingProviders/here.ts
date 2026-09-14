import type {
  RouteEndpoint,
  RouteEvidence,
  RouteMode
} from "../itineraryRouting";

export type HereFreshness = "STATIC_ROUTE" | "TIME_DEPENDENT_ROUTE" | "TRAFFIC_AWARE_ROUTE";

export type HereAdapterStatus = "OK" | "NO_EVIDENCE" | "INVALID";

export type HereRouteRequest = {
  from: RouteEndpoint;
  to: RouteEndpoint;
  retrievedAt: string;
};

export type HereRouteSummary = {
  lengthMeters?: unknown;
  durationSeconds?: unknown;
  baseDurationSeconds?: unknown;
  trafficDurationSeconds?: unknown;
};

export type HereLocation = {
  lat?: unknown;
  lng?: unknown;
};

export type HereSection = {
  transport?: { mode?: unknown };
  departure?: { time?: unknown; place?: { location?: HereLocation } };
  arrival?: { time?: unknown; place?: { location?: HereLocation } };
};

export type HereRouteFixture = {
  id?: unknown;
  summary?: HereRouteSummary;
  sections?: unknown;
  origin?: HereLocation;
  destination?: HereLocation;
};

export type HereResponseFixture = {
  routes?: unknown;
  error?: unknown;
};

export type HereNormalizedRoute = {
  status: "OK";
  provider: "HERE";
  providerRouteId: string | null;
  providerRouteIdKind: "NATIVE" | "NONE";
  evidenceId: string;
  evidenceIdKind: "ADAPTER_GENERATED";
  fromItemId: string;
  toItemId: string;
  departureTime: string | null;
  arrivalTime: string | null;
  freshness: HereFreshness;
  trafficDurationMinutes: number | null;
  baseDurationMinutes: number | null;
  evidence: RouteEvidence;
};

export type HereInvalidRoute = {
  status: "INVALID";
  routeIndex: number;
  reasons: string[];
};

export type HereResponseResult = {
  status: HereAdapterStatus;
  routes: HereNormalizedRoute[];
  invalidRoutes: HereInvalidRoute[];
  reasons: string[];
};

export type HereMatrixCellFixture = {
  originIndex?: unknown;
  destinationIndex?: unknown;
  status?: unknown;
  route?: HereRouteFixture;
};

export type HereMatrixFixture = {
  origins?: unknown;
  destinations?: unknown;
  matrix?: unknown;
  cells?: unknown;
};

export type HereMatrixPoint = {
  itemId: string;
  latitude: number;
  longitude: number;
};

export type HereNormalizedMatrixCell = {
  status: "OK" | "UNKNOWN";
  originItemId: string;
  destinationItemId: string;
  evidence: HereNormalizedRoute | null;
  reasons: string[];
};

export type HereMatrixResult = {
  status: HereAdapterStatus;
  cells: HereNormalizedMatrixCell[];
  reasons: string[];
};

const COORDINATE_TOLERANCE_KM = 0.05;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function location(value: unknown): { latitude: number; longitude: number } | null {
  const item = record(value);
  const latitude = item?.lat;
  const longitude = item?.lng;
  return finiteCoordinate(latitude, -90, 90) && finiteCoordinate(longitude, -180, 180)
    ? { latitude, longitude }
    : null;
}

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radiusKm = 6371;
  const latitude1 = (a.latitude * Math.PI) / 180;
  const latitude2 = (b.latitude * Math.PI) / 180;
  const deltaLatitude = ((b.latitude - a.latitude) * Math.PI) / 180;
  const deltaLongitude = ((b.longitude - a.longitude) * Math.PI) / 180;
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return radiusKm * 2 * Math.asin(Math.min(1, Math.sqrt(value)));
}

function endpointLocation(endpoint: RouteEndpoint) {
  return finiteCoordinate(endpoint.latitude, -90, 90) && finiteCoordinate(endpoint.longitude, -180, 180)
    ? { latitude: endpoint.latitude, longitude: endpoint.longitude }
    : null;
}

function routeMode(value: unknown): RouteMode {
  if (value === "car") return "DRIVE";
  if (value === "pedestrian") return "WALK";
  return "UNKNOWN";
}

function routeSections(value: unknown): HereSection[] {
  return Array.isArray(value) ? value.filter((section): section is HereSection => record(section) !== null) : [];
}

function validTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  // A timezone-less local time is ambiguous and must not be normalized as UTC.
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  return value;
}

function firstDeparture(sections: HereSection[]) {
  const item = record(sections[0]?.departure);
  return validTimestamp(item?.time);
}

function lastArrival(sections: HereSection[]) {
  const item = record(sections[sections.length - 1]?.arrival);
  return validTimestamp(item?.time);
}

function sectionLocation(sections: HereSection[], side: "from" | "to") {
  const section = side === "from" ? sections[0] : sections[sections.length - 1];
  const parent = record(side === "from" ? section?.departure : section?.arrival);
  return location(record(parent?.place)?.location);
}

function hasMalformedLocation(value: unknown) {
  return value !== undefined && location(value) === null;
}

function summaryOf(route: HereRouteFixture) {
  const summary = record(route.summary);
  return {
    lengthMeters: finiteNonNegative(summary?.lengthMeters),
    durationSeconds: finiteNonNegative(summary?.durationSeconds),
    baseDurationSeconds: finiteNonNegative(summary?.baseDurationSeconds),
    trafficDurationSeconds: finiteNonNegative(summary?.trafficDurationSeconds),
    invalidLength: summary?.lengthMeters !== undefined && finiteNonNegative(summary.lengthMeters) === null,
    invalidDuration: summary?.durationSeconds !== undefined && finiteNonNegative(summary.durationSeconds) === null,
    invalidBaseDuration: summary?.baseDurationSeconds !== undefined && finiteNonNegative(summary.baseDurationSeconds) === null,
    invalidTrafficDuration: summary?.trafficDurationSeconds !== undefined && finiteNonNegative(summary.trafficDurationSeconds) === null
  };
}

function makeEvidenceId(request: HereRouteRequest, routeIndex: number) {
  return `here-adapter:${request.from.itemId}->${request.to.itemId}:route-${routeIndex}:${request.retrievedAt}`;
}

function normalizeRoute(route: HereRouteFixture, request: HereRouteRequest, routeIndex: number): HereNormalizedRoute | HereInvalidRoute {
  const sections = routeSections(route.sections);
  const summary = summaryOf(route);
  const reasons: string[] = [];
  const expectedFrom = endpointLocation(request.from);
  const expectedTo = endpointLocation(request.to);
  const responseFrom = location(route.origin) || sectionLocation(sections, "from");
  const responseTo = location(route.destination) || sectionLocation(sections, "to");

  if (!expectedFrom || !expectedTo) reasons.push("INVALID_EXPECTED_COORDINATES");
  if (hasMalformedLocation(route.origin) || hasMalformedLocation(route.destination)) reasons.push("INVALID_RESPONSE_COORDINATES");
  if (!sections.length) reasons.push("EMPTY_SECTIONS");
  if (summary.invalidLength) reasons.push("INVALID_DISTANCE");
  if (summary.invalidDuration || summary.invalidBaseDuration || summary.invalidTrafficDuration) reasons.push("INVALID_DURATION");
  if (responseFrom && expectedFrom && haversineKm(responseFrom, expectedFrom) > COORDINATE_TOLERANCE_KM) reasons.push("ORIGIN_COORDINATE_MISMATCH");
  if (responseTo && expectedTo && haversineKm(responseTo, expectedTo) > COORDINATE_TOLERANCE_KM) reasons.push("DESTINATION_COORDINATE_MISMATCH");
  if (reasons.length) return { status: "INVALID", routeIndex, reasons };

  const firstTransport = record(sections[0]?.transport);
  const mode = routeMode(firstTransport?.mode);
  const trafficSeconds = summary.trafficDurationSeconds;
  const durationSeconds = trafficSeconds ?? summary.durationSeconds;
  const freshness: HereFreshness = trafficSeconds !== null
    ? "TRAFFIC_AWARE_ROUTE"
    : firstDeparture(sections) || lastArrival(sections)
      ? "TIME_DEPENDENT_ROUTE"
      : "STATIC_ROUTE";
  const departureTime = firstDeparture(sections);
  const arrivalTime = lastArrival(sections);
  const baseDurationMinutes = summary.baseDurationSeconds === null ? null : summary.baseDurationSeconds / 60;
  const trafficDurationMinutes = trafficSeconds === null ? null : trafficSeconds / 60;
  const durationSource = durationSeconds === null
    ? null
    : trafficSeconds !== null ? "HERE traffic-aware route duration" : "HERE route duration";

  return {
    status: "OK",
    provider: "HERE",
    providerRouteId: typeof route.id === "string" && route.id.length > 0 ? route.id : null,
    providerRouteIdKind: typeof route.id === "string" && route.id.length > 0 ? "NATIVE" : "NONE",
    evidenceId: makeEvidenceId(request, routeIndex),
    evidenceIdKind: "ADAPTER_GENERATED",
    fromItemId: request.from.itemId,
    toItemId: request.to.itemId,
    departureTime,
    arrivalTime,
    freshness,
    trafficDurationMinutes,
    baseDurationMinutes,
    evidence: {
      fromItemId: request.from.itemId,
      toItemId: request.to.itemId,
      mode,
      distanceKm: summary.lengthMeters === null ? null : summary.lengthMeters / 1000,
      distanceKind: summary.lengthMeters === null ? "UNKNOWN" : "ROUTE_DISTANCE",
      durationMinutes: durationSeconds === null ? null : durationSeconds / 60,
      durationSource,
      authority: durationSeconds === null ? "UNKNOWN" : "AUTHORITATIVE_ROUTE",
      source: "HERE_ROUTING_FIXTURE_ADAPTER",
      retrievedAt: request.retrievedAt,
      confidence: durationSeconds === null ? "unknown" : "high"
    }
  };
}

export function normalizeHereResponse(input: {
  request: HereRouteRequest;
  response: unknown;
}): HereResponseResult {
  const response = record(input.response) as HereResponseFixture | null;
  if (!response || response.error !== undefined) {
    return { status: "NO_EVIDENCE", routes: [], invalidRoutes: [], reasons: ["PROVIDER_ERROR_OR_INVALID_RESPONSE"] };
  }
  if (!Array.isArray(response.routes) || response.routes.length === 0) {
    return { status: "NO_EVIDENCE", routes: [], invalidRoutes: [], reasons: ["NO_ROUTES"] };
  }
  const routes: HereNormalizedRoute[] = [];
  const invalidRoutes: HereInvalidRoute[] = [];
  response.routes.forEach((value, routeIndex) => {
    const route = record(value) as HereRouteFixture | null;
    const normalized = route ? normalizeRoute(route, input.request, routeIndex) : { status: "INVALID", routeIndex, reasons: ["MALFORMED_ROUTE"] } as HereInvalidRoute;
    if (normalized.status === "OK") routes.push(normalized);
    else invalidRoutes.push(normalized);
  });
  return {
    status: routes.length ? "OK" : "INVALID",
    routes,
    invalidRoutes,
    reasons: invalidRoutes.length ? ["SOME_ROUTES_INVALID"] : []
  };
}

function matrixPoint(value: unknown): HereMatrixPoint | null {
  const item = record(value);
  const itemId = item?.itemId;
  const latitude = item?.latitude;
  const longitude = item?.longitude;
  return typeof itemId === "string"
    && finiteCoordinate(latitude, -90, 90)
    && finiteCoordinate(longitude, -180, 180)
    ? { itemId, latitude, longitude }
    : null;
}

export function normalizeHereMatrix(input: {
  retrievedAt: string;
  matrix: unknown;
}): HereMatrixResult {
  const matrix = record(input.matrix) as HereMatrixFixture | null;
  const origins = Array.isArray(matrix?.origins) ? matrix.origins.map(matrixPoint) : [];
  const destinations = Array.isArray(matrix?.destinations) ? matrix.destinations.map(matrixPoint) : [];
  const cells = Array.isArray(matrix?.cells) ? matrix.cells : Array.isArray(matrix?.matrix) ? matrix.matrix : [];
  if (!matrix || !origins.length || !destinations.length || !cells.length) {
    return { status: "NO_EVIDENCE", cells: [], reasons: ["MATRIX_DATA_MISSING"] };
  }

  const normalized: HereNormalizedMatrixCell[] = [];
  for (const value of cells) {
    const cell = record(value) as HereMatrixCellFixture | null;
    const originIndex = cell?.originIndex;
    const destinationIndex = cell?.destinationIndex;
    const from = typeof originIndex === "number" ? origins[originIndex] : null;
    const to = typeof destinationIndex === "number" ? destinations[destinationIndex] : null;
    if (!from || !to) continue;
    const status = cell?.status === undefined || cell.status === "OK" || cell.status === "REACHABLE";
    if (!status || !cell?.route) {
      normalized.push({ status: "UNKNOWN", originItemId: from.itemId, destinationItemId: to.itemId, evidence: null, reasons: ["MATRIX_CELL_UNAVAILABLE"] });
      continue;
    }
    const route = normalizeHereResponse({
      request: {
        from: { itemId: from.itemId, latitude: from.latitude, longitude: from.longitude },
        to: { itemId: to.itemId, latitude: to.latitude, longitude: to.longitude },
        retrievedAt: input.retrievedAt
      },
      response: { routes: [cell.route] }
    });
    const evidence = route.routes[0] || null;
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
