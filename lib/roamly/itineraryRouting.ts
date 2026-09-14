export type RouteMode =
  | "WALK"
  | "PUBLIC_TRANSIT"
  | "DRIVE"
  | "TAXI_RIDESHARE"
  | "TRAIN"
  | "FERRY"
  | "FLIGHT_TRANSFER"
  | "OTHER"
  | "UNKNOWN";

export type RouteEvidenceAuthority =
  | "AUTHORITATIVE_ROUTE"
  | "GROUNDED_ESTIMATE"
  | "DETERMINISTIC_BOUND"
  | "UNKNOWN";

export type RouteEvidenceStatus = "GROUNDED" | "UNKNOWN";

export type RouteEndpoint = {
  itemId: string;
  locationId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationSource?: string | null;
  provenance?: string | null;
};

export type RouteEvidence = {
  fromItemId: string;
  toItemId: string;
  mode: RouteMode;
  distanceKm?: number | null;
  distanceKind?: "GEODESIC_STRAIGHT_LINE" | "ROUTE_DISTANCE" | "UNKNOWN";
  durationMinutes?: number | null;
  durationSource?: string | null;
  authority: RouteEvidenceAuthority;
  source?: string | null;
  retrievedAt?: string | null;
  confidence?: "high" | "medium" | "low" | "unknown";
};

export type RouteScheduleBounds = {
  previousEndMinutes?: number | null;
  nextStartMinutes?: number | null;
  explicitBufferMinutes?: number | null;
};

export type RouteTransitionInput = {
  from: RouteEndpoint;
  to: RouteEndpoint;
  schedule?: RouteScheduleBounds;
  evidence?: RouteEvidence | null;
  confirmedBooking?: {
    bookingId: string;
    fixedStartMinutes?: number | null;
  } | null;
};

export type RouteFeasibility = "FEASIBLE" | "INFEASIBLE" | "UNCERTAIN";

export type RouteReason =
  | "ROUTE_DURATION_WITHIN_GAP"
  | "ROUTE_DURATION_EXCEEDS_GAP"
  | "ROUTE_DURATION_UNKNOWN"
  | "PREVIOUS_END_UNKNOWN"
  | "NEXT_START_UNKNOWN"
  | "FROM_COORDINATES_UNKNOWN"
  | "TO_COORDINATES_UNKNOWN"
  | "MODE_UNKNOWN"
  | "ROUTE_SOURCE_UNKNOWN"
  | "CONFIRMED_BOOKING_CONFLICT"
  | "TRANSITION_IDENTITY_MISMATCH"
  | "EXPLICIT_BUFFER_APPLIED";

export type RouteTransitionResult = {
  transitionId: string;
  fromItemId: string;
  toItemId: string;
  feasibility: RouteFeasibility;
  reasons: RouteReason[];
  availableMinutes: number | null;
  requiredMinutes: number | null;
  distanceKm: number | null;
  distanceKind: RouteEvidence["distanceKind"];
  mode: RouteMode;
  evidenceStatus: RouteEvidenceStatus;
  evidence: RouteEvidence | null;
  confirmedBookingId: string | null;
};

const EARTH_RADIUS_KM = 6371;

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function validCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasEndpointCoordinates(endpoint: RouteEndpoint) {
  return validCoordinate(endpoint.latitude) && validCoordinate(endpoint.longitude);
}

/** Straight-line geometry only; this is never a road, walking, or transit distance. */
export function geodesicStraightLineDistanceKm(from: RouteEndpoint, to: RouteEndpoint): number | null {
  if (!hasEndpointCoordinates(from) || !hasEndpointCoordinates(to)) return null;
  const latitude1 = (from.latitude! * Math.PI) / 180;
  const latitude2 = (to.latitude! * Math.PI) / 180;
  const deltaLatitude = ((to.latitude! - from.latitude!) * Math.PI) / 180;
  const deltaLongitude = ((to.longitude! - from.longitude!) * Math.PI) / 180;
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function transitionId(fromItemId: string, toItemId: string) {
  return `${fromItemId}->${toItemId}`;
}

function routeEvidenceMatches(evidence: RouteEvidence | null | undefined, from: RouteEndpoint, to: RouteEndpoint) {
  return Boolean(evidence && evidence.fromItemId === from.itemId && evidence.toItemId === to.itemId);
}

export function buildRouteEvidence(input: {
  from: RouteEndpoint;
  to: RouteEndpoint;
  mode?: RouteMode;
  durationMinutes?: number | null;
  durationSource?: string | null;
  authority?: RouteEvidenceAuthority;
  source?: string | null;
  retrievedAt?: string | null;
  confidence?: RouteEvidence["confidence"];
}) : RouteEvidence {
  const distanceKm = geodesicStraightLineDistanceKm(input.from, input.to);
  return {
    fromItemId: input.from.itemId,
    toItemId: input.to.itemId,
    mode: input.mode || "UNKNOWN",
    distanceKm,
    distanceKind: distanceKm == null ? "UNKNOWN" : "GEODESIC_STRAIGHT_LINE",
    durationMinutes: finiteNonNegative(input.durationMinutes),
    durationSource: input.durationSource || null,
    authority: input.authority || "UNKNOWN",
    source: input.source || null,
    retrievedAt: input.retrievedAt || null,
    confidence: input.confidence || "unknown"
  };
}

export function evaluateRouteTransition(input: RouteTransitionInput): RouteTransitionResult {
  const transition = transitionId(input.from.itemId, input.to.itemId);
  const reasons: RouteReason[] = [];
  const evidenceMatches = routeEvidenceMatches(input.evidence, input.from, input.to);
  const evidence = evidenceMatches ? input.evidence! : null;
  if (input.evidence && !evidenceMatches) reasons.push("TRANSITION_IDENTITY_MISMATCH");

  const distanceKm = evidence?.distanceKm ?? geodesicStraightLineDistanceKm(input.from, input.to);
  const distanceKind = evidence?.distanceKind || (distanceKm == null ? "UNKNOWN" : "GEODESIC_STRAIGHT_LINE");
  const mode = evidence?.mode || "UNKNOWN";
  const evidenceStatus: RouteEvidenceStatus = evidence?.durationMinutes != null && evidence?.durationSource && evidence?.authority !== "UNKNOWN"
    ? "GROUNDED"
    : "UNKNOWN";

  if (!hasEndpointCoordinates(input.from)) reasons.push("FROM_COORDINATES_UNKNOWN");
  if (!hasEndpointCoordinates(input.to)) reasons.push("TO_COORDINATES_UNKNOWN");
  if (mode === "UNKNOWN") reasons.push("MODE_UNKNOWN");
  if (!evidence?.source) reasons.push("ROUTE_SOURCE_UNKNOWN");

  const previousEnd = finiteNonNegative(input.schedule?.previousEndMinutes);
  const fixedNextStart = finiteNonNegative(input.confirmedBooking?.fixedStartMinutes);
  const nextStart = fixedNextStart ?? finiteNonNegative(input.schedule?.nextStartMinutes);
  const explicitBuffer = finiteNonNegative(input.schedule?.explicitBufferMinutes) || 0;
  if (explicitBuffer > 0) reasons.push("EXPLICIT_BUFFER_APPLIED");
  if (previousEnd == null) reasons.push("PREVIOUS_END_UNKNOWN");
  if (nextStart == null) reasons.push("NEXT_START_UNKNOWN");

  const availableMinutes = previousEnd != null && nextStart != null ? nextStart - previousEnd : null;
  const durationMinutes = finiteNonNegative(evidence?.durationMinutes);
  const requiredMinutes = durationMinutes == null ? null : durationMinutes + explicitBuffer;

  let feasibility: RouteFeasibility = "UNCERTAIN";
  if (!hasEndpointCoordinates(input.from) || !hasEndpointCoordinates(input.to)) {
    // A duration without endpoint evidence cannot prove that this pair is reachable.
    feasibility = "UNCERTAIN";
  } else if (input.confirmedBooking && fixedNextStart != null && previousEnd != null && durationMinutes != null && previousEnd + requiredMinutes! > fixedNextStart) {
    feasibility = "INFEASIBLE";
    reasons.push("CONFIRMED_BOOKING_CONFLICT");
  } else if (durationMinutes == null || evidenceStatus !== "GROUNDED") {
    reasons.push("ROUTE_DURATION_UNKNOWN");
  } else if (availableMinutes != null && availableMinutes >= requiredMinutes!) {
    feasibility = "FEASIBLE";
    reasons.push("ROUTE_DURATION_WITHIN_GAP");
  } else if (availableMinutes != null) {
    feasibility = "INFEASIBLE";
    reasons.push("ROUTE_DURATION_EXCEEDS_GAP");
  }

  return {
    transitionId: transition,
    fromItemId: input.from.itemId,
    toItemId: input.to.itemId,
    feasibility,
    reasons: Array.from(new Set(reasons)),
    availableMinutes,
    requiredMinutes,
    distanceKm,
    distanceKind,
    mode,
    evidenceStatus,
    evidence,
    confirmedBookingId: input.confirmedBooking?.bookingId || null
  };
}

export function serializeRouteTransition(result: RouteTransitionResult) {
  return JSON.parse(JSON.stringify(result)) as RouteTransitionResult;
}
