/**
 * Directions panel logic (Roamly UX repair, round 2, panel 7 DIRECTIONS).
 *
 * The mock panel ("Getting to your next stop") shows a map, a walk
 * summary, an "Open in Maps" button, and a step-by-step list. This module
 * is the honesty layer underneath that panel: every value it returns
 * comes from real trip data or a real routing source the codebase has,
 * and every value it cannot source is reported as unavailable — never
 * filled with the mock's numbers.
 *
 * What the codebase actually has (verified 2026-10-26 against the tree):
 * - NO embedded map anywhere: no map dependency, no map component, no
 *   map iframe, and the Valhalla file is a response normalizer with no
 *   fetch and no imports. The panel therefore renders an honest
 *   map-unavailable state in the map slot, never a fake map image.
 * - NO step-by-step source: the live route provider (Google Distance
 *   Matrix via lib/roamly/liveRouting.ts) returns a duration only — no
 *   street names, no turns, no step distances. Step text renders ONLY
 *   from a producer passed in as `steps`; today there is no producer,
 *   so the steps section is an unavailable state, not an invented list.
 * - NO terrain / sidewalk source anywhere in the tree. The mock's
 *   terrain/sidewalk claim is never rendered as fact.
 * - Duration sources that ARE real: a verified LiveRouteStatus
 *   (Distance Matrix duration), or itinerary RouteEvidence whose
 *   duration is GROUNDED (durationMinutes + durationSource + a known
 *   authority). A GROUNDED_ESTIMATE / DETERMINISTIC_BOUND duration is
 *   shown with "(est.)"; anything else is unavailable.
 * - Distance: ONLY RouteEvidence with distanceKind "ROUTE_DISTANCE"
 *   is a route distance. The itinerary builder's distanceKm is a
 *   geodesic straight line ("Straight-line geometry only; this is
 *   never a road, walking, or transit distance") — it is NEVER shown
 *   as a walking distance.
 * - Location evidence (boundary 3) reuses the codebase's own rules:
 *   fresh = isFreshLocationObservation (10-minute window), and the
 *   radius = the live-companion destination-area rule
 *   (max(10 km, destination radiusMeters || 50 km)). Without granted
 *   permission + fresh coordinates + a destination inside that radius,
 *   no "from your current location" content is rendered at all.
 * - Open in Maps links are built from the trip's REAL destination
 *   (coordinates first, else place name/address) via the same URL
 *   shapes the codebase already uses (Google / Apple / Citymapper).
 *   The origin parameter is added ONLY when the location gate above
 *   is verified; otherwise the link is destination-only and Maps
 *   itself decides the origin — Roamly never claims a route from an
 *   unverified location.
 *
 * Per-trip / per-leg isolation: every function takes the trip's own
 * destination (and, for evidence, the exact from/to item ids). Evidence
 * whose item ids do not match this leg is ignored, so one trip's — or
 * one leg's — route can never leak into another panel.
 */

import {
  calculateDistanceMeters,
  isFreshLocationObservation
} from "@/lib/roamly/location";
import type {
  LiveCoordinates,
  LiveLocationPermission,
  LiveRouteStatus
} from "@/lib/roamly/liveCompanion";

export type DirectionsDestination = {
  id: string;
  title: string;
  address?: string | null;
  placeName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number | null;
};

export type DirectionsMode = "walking" | "transit" | "driving";

export type DirectionsRouteEvidence = {
  fromItemId: string;
  toItemId: string;
  mode?: string | null;
  distanceKm?: number | null;
  distanceKind?: "GEODESIC_STRAIGHT_LINE" | "ROUTE_DISTANCE" | "UNKNOWN" | null;
  durationMinutes?: number | null;
  durationSource?: string | null;
  authority?: "AUTHORITATIVE_ROUTE" | "GROUNDED_ESTIMATE" | "DETERMINISTIC_BOUND" | "UNKNOWN" | null;
};

export type DirectionsStep = {
  instruction: string;
  distanceMeters?: number | null;
};

export type DirectionsLocationGate =
  | {
      state: "verified";
      origin: LiveCoordinates;
      distanceMeters: number;
    }
  | {
      state: "location_needed";
      reason: "permission" | "unavailable" | "stale" | "destination_coordinates_missing" | "too_far";
      detail: string;
      distanceMeters: number | null;
    };

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function cleanLabel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null;
}

/** "Day 1 · Mon, Oct 26" from a day number + YYYY-MM-DD date. TZ-stable
 *  by design: the date is parsed as a noon UTC day, so the weekday and
 *  month/day never shift between America/Moncton and UTC runs. A missing
 *  or malformed date degrades to "Day N" rather than a guessed date. */
export function formatDirectionsDayLabel(dayNumber: number | null | undefined, dateString: string | null | undefined): string {
  const day = typeof dayNumber === "number" && Number.isFinite(dayNumber) && dayNumber >= 1
    ? Math.floor(dayNumber)
    : null;
  const base = day == null ? "" : `Day ${day}`;
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return base || "Day";
  const parsed = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return base || "Day";
  const label = new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(parsed);
  return base ? `${base} · ${label}` : label;
}

function formatShortDate(dateString: string | null | undefined): string | null {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const parsed = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
}

/** Trip identity line for the panel header: destination + trip dates +
 *  origin, each only when the trip actually carries it. No segment is
 *  ever invented; an unknown segment is omitted, not filled. */
export function formatTripIdentity(input: {
  destinationLabel?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  originLabel?: string | null;
}): string {
  const parts: string[] = [];
  const destination = cleanLabel(input.destinationLabel);
  if (destination) parts.push(destination);
  const start = formatShortDate(input.startDate);
  const end = formatShortDate(input.endDate);
  if (start && end && start !== end) parts.push(`${start} – ${end}`);
  else if (start) parts.push(start);
  const origin = cleanLabel(input.originLabel);
  if (origin) parts.push(`From ${origin}`);
  return parts.join(" · ");
}

export function formatDurationMinutes(minutes: number | null | undefined): string | null {
  const value = finiteNonNegative(minutes);
  if (value == null) return null;
  if (value < 60) return `${Math.round(value)} min`;
  const hours = Math.floor(value / 60);
  const rest = Math.round(value % 60);
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function formatDistanceMeters(meters: number | null | undefined): string | null {
  const value = finiteNonNegative(meters);
  if (value == null) return null;
  if (value < 1000) return `${Math.round(value)} m`;
  const km = value / 1000;
  return `${km >= 10 ? Math.round(km) : Math.round(km * 10) / 10} km`;
}

/**
 * Boundary-3 location gate. Verified ONLY when: permission is granted,
 * coordinates are finite, the observation is fresh (the codebase's
 * 10-minute rule), the destination has coordinates to measure against,
 * and the traveler is inside the destination area (the live-companion
 * rule: max(10 km, destination radiusMeters || 50 km)). Anything else
 * is "location_needed" with a reason the UI can act on (permission /
 * retry), and NO origin is returned — so no caller can build a
 * "from your current location" route from it.
 */
export function resolveDirectionsLocationGate(input: {
  permission: LiveLocationPermission;
  location?: LiveCoordinates | null;
  destination: DirectionsDestination;
  nowMs?: number;
}): DirectionsLocationGate {
  const now = typeof input.nowMs === "number" && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  if (input.permission !== "granted") {
    return {
      state: "location_needed",
      reason: "permission",
      detail: "Location permission is not granted for this trip.",
      distanceMeters: null
    };
  }
  const location = input.location;
  if (!location || !finiteCoordinate(location.latitude) || !finiteCoordinate(location.longitude)) {
    return {
      state: "location_needed",
      reason: "unavailable",
      detail: "Your current location is unavailable right now.",
      distanceMeters: null
    };
  }
  if (!isFreshLocationObservation(location.capturedAt, now)) {
    return {
      state: "location_needed",
      reason: "stale",
      detail: "Your last location reading is too old to route from. Refresh it and try again.",
      distanceMeters: null
    };
  }
  const destination = input.destination;
  if (!finiteCoordinate(destination.latitude) || !finiteCoordinate(destination.longitude)) {
    return {
      state: "location_needed",
      reason: "destination_coordinates_missing",
      detail: "This stop has no coordinates, so your distance to it cannot be verified.",
      distanceMeters: null
    };
  }
  const distanceMeters = calculateDistanceMeters(
    location.latitude,
    location.longitude,
    Number(destination.latitude),
    Number(destination.longitude)
  );
  const radiusMeters = Math.max(10_000, destination.radiusMeters || 50_000);
  if (distanceMeters > radiusMeters) {
    return {
      state: "location_needed",
      reason: "too_far",
      detail: `You are ${formatDistanceMeters(distanceMeters) || "too far"} from this destination area to route from your current location.`,
      distanceMeters
    };
  }
  return { state: "verified", origin: location, distanceMeters };
}

export type DirectionsWalkSummary = {
  modeLabel: string;
  /** Real duration, or null when no real source carries one. */
  durationMinutes: number | null;
  durationLabel: string | null;
  /** "live" (Distance Matrix) | "verified" (authoritative evidence) |
   *  "estimated" (grounded estimate — rendered "(est.)") | null. */
  durationKind: "live" | "verified" | "estimated" | null;
  /** Real ROUTE distance only; geodesic straight lines are excluded. */
  distanceMeters: number | null;
  distanceLabel: string | null;
  /** True when itinerary evidence existed but was straight-line only,
   *  so it was deliberately NOT shown as a walking distance. */
  distanceExcludedAsStraightLine: boolean;
  /** True ONLY when the whole summary came from the opt-in fallback
   *  estimate (Picture 7 standalone screen): a haversine distance
   *  from a verified current location at walking speed, rendered
   *  "(est.)" on both duration and distance. False in every other
   *  case, including when a grounded estimate supplied the values. */
  fallbackEstimateUsed: boolean;
};

/** Opt-in fallback estimate for the Picture 7 standalone screen only:
 *  a haversine distance from a verified current location, with a
 *  walking-speed duration. NEVER a routed distance; the caller (the
 *  panel, only when its allowWalkEstimate prop is set) computes it
 *  from the location gate's verified origin, and it is used ONLY when
 *  no live route and no grounded evidence serve the leg at all — it
 *  never overrides, mixes with, or fills gaps in a real source. */
export type DirectionsFallbackEstimate = {
  durationMinutes: number | null;
  distanceMeters: number | null;
};

export function modeLabelFor(mode: DirectionsMode): string {
  return mode === "transit" ? "Transit" : mode === "driving" ? "Drive" : "Walk";
}

function evidenceModeLabel(mode: string | null | undefined): DirectionsMode | null {
  if (mode === "WALK") return "walking";
  if (mode === "PUBLIC_TRANSIT") return "transit";
  if (mode === "DRIVE" || mode === "TAXI_RIDESHARE") return "driving";
  return null;
}

/**
 * Walk summary from real sources only, in priority order:
 * 1. A verified live route (Distance Matrix duration) — live, no "(est.)".
 * 2. Itinerary RouteEvidence for THIS exact leg (from/to item ids must
 *    match; mismatched evidence is ignored — per-leg isolation) whose
 *    duration is GROUNDED. AUTHORITATIVE_ROUTE renders plain;
 *    GROUNDED_ESTIMATE / DETERMINISTIC_BOUND render "(est.)".
 * Distance renders ONLY from ROUTE_DISTANCE evidence. A geodesic
 * straight-line distance is real geometry but NOT a walking distance,
 * so it is excluded and flagged, never displayed as the route length.
 */
export function resolveWalkSummary(input: {
  mode?: DirectionsMode;
  liveRoute?: LiveRouteStatus | null;
  routeEvidence?: DirectionsRouteEvidence | null;
  originItemId?: string | null;
  destinationId: string;
  fallbackEstimate?: DirectionsFallbackEstimate | null;
}): DirectionsWalkSummary {
  const live = input.liveRoute;
  const liveDuration = live && live.status === "verified" ? finiteNonNegative(live.durationMinutes) : null;
  const liveMode: DirectionsMode | null =
    live && live.status === "verified"
      ? live.mode === "transit" ? "transit" : live.mode === "driving" || live.mode === "rideshare" ? "driving" : "walking"
      : null;

  const evidence = input.routeEvidence;
  const evidenceMatches =
    Boolean(evidence) &&
    evidence!.fromItemId === (input.originItemId || "") &&
    input.originItemId != null &&
    evidence!.toItemId === input.destinationId;
  const matched = evidenceMatches ? evidence! : null;
  const evidenceDuration = matched ? finiteNonNegative(matched.durationMinutes) : null;
  const evidenceGrounded =
    matched != null &&
    evidenceDuration != null &&
    cleanLabel(matched.durationSource) != null &&
    matched.authority != null &&
    matched.authority !== "UNKNOWN";
  const evidenceDistance =
    matched && matched.distanceKind === "ROUTE_DISTANCE" ? finiteNonNegative(
      matched.distanceKm == null ? null : matched.distanceKm * 1000
    ) : null;
  const distanceExcludedAsStraightLine =
    matched != null && matched.distanceKind === "GEODESIC_STRAIGHT_LINE" && evidenceDistance == null;

  let durationMinutes: number | null = null;
  let durationKind: DirectionsWalkSummary["durationKind"] = null;
  if (liveDuration != null) {
    durationMinutes = liveDuration;
    durationKind = "live";
  } else if (evidenceGrounded) {
    durationMinutes = evidenceDuration;
    durationKind = matched!.authority === "AUTHORITATIVE_ROUTE" ? "verified" : "estimated";
  }

  // Picture 7 standalone fallback: ONLY when the summary would
  // otherwise be fully unavailable (no live duration, no grounded
  // evidence duration, no route distance) does the opt-in haversine
  // estimate fill BOTH values, as an "(est.)" pair. It never fills a
  // gap beside a real source: grounded evidence that carries a
  // duration but no route distance keeps its distance unavailable,
  // and a live duration keeps its distance unavailable.
  let distanceMeters: number | null = evidenceDistance;
  let fallbackEstimateUsed = false;
  const fallback = input.fallbackEstimate;
  if (
    durationMinutes == null &&
    distanceMeters == null &&
    fallback != null
  ) {
    const fallbackDuration = finiteNonNegative(fallback.durationMinutes);
    const fallbackDistance = finiteNonNegative(fallback.distanceMeters);
    if (fallbackDuration != null && fallbackDistance != null) {
      durationMinutes = fallbackDuration;
      durationKind = "estimated";
      distanceMeters = fallbackDistance;
      fallbackEstimateUsed = true;
    }
  }

  const mode = input.mode || liveMode || evidenceModeLabel(matched?.mode) || "walking";
  return {
    modeLabel: modeLabelFor(mode),
    durationMinutes,
    durationLabel: formatDurationMinutes(durationMinutes),
    durationKind,
    distanceMeters,
    distanceLabel: formatDistanceMeters(distanceMeters),
    distanceExcludedAsStraightLine,
    fallbackEstimateUsed
  };
}

export type DirectionsMapsLinks = {
  google: string;
  apple: string;
  citymapper: string;
  primary: string;
  available: boolean;
};

function destinationValue(destination: DirectionsDestination): string {
  if (finiteCoordinate(destination.latitude) && finiteCoordinate(destination.longitude)) {
    return `${destination.latitude},${destination.longitude}`;
  }
  const label = [destination.placeName, destination.address, destination.title]
    .map((part) => cleanLabel(part))
    .filter((part): part is string => part != null)
    .join(" ");
  return label;
}

/**
 * Open-in-Maps links from the trip's REAL destination. The origin is
 * included ONLY when the caller passes a verified origin (the location
 * gate's output) — callers must never pass an unverified position here.
 * Google/Apple/Citymapper URL shapes match the ones the codebase
 * already builds in lib/roamly/liveCompanion.ts and
 * lib/roamly/navigationLinks.ts; the only addition is the origin
 * parameter, gated as above.
 */
export function buildDirectionsMapsLinks(input: {
  destination: DirectionsDestination;
  verifiedOrigin?: LiveCoordinates | null;
  mode?: DirectionsMode;
  isIOS?: boolean;
}): DirectionsMapsLinks {
  const value = destinationValue(input.destination);
  if (!value) return { google: "", apple: "", citymapper: "", primary: "", available: false };
  const mode = input.mode || "walking";
  const travelmode = mode === "transit" ? "transit" : mode === "driving" ? "driving" : "walking";
  const dirflg = mode === "transit" ? "r" : mode === "driving" ? "d" : "w";

  const origin = input.verifiedOrigin &&
    finiteCoordinate(input.verifiedOrigin.latitude) &&
    finiteCoordinate(input.verifiedOrigin.longitude)
    ? `${input.verifiedOrigin.latitude},${input.verifiedOrigin.longitude}`
    : null;

  const googleParams = new URLSearchParams({ api: "1", destination: value, travelmode });
  if (origin) googleParams.set("origin", origin);
  const google = `https://www.google.com/maps/dir/?${googleParams.toString()}`;

  const appleParams = new URLSearchParams({ daddr: value, dirflg });
  if (origin) appleParams.set("saddr", origin);
  const apple = `https://maps.apple.com/?${appleParams.toString()}`;

  const citymapperParams = new URLSearchParams();
  if (origin) citymapperParams.set("startcoord", origin);
  if (finiteCoordinate(input.destination.latitude) && finiteCoordinate(input.destination.longitude)) {
    citymapperParams.set("endcoord", value);
  } else {
    citymapperParams.set("endaddress", value);
  }
  const name = cleanLabel(input.destination.placeName) || cleanLabel(input.destination.title);
  if (name) citymapperParams.set("endname", name);
  const citymapper = `https://citymapper.com/directions?${citymapperParams.toString()}`;

  // Platform pick mirrors LiveTripClient: Apple Maps on iOS when
  // offered, otherwise Google, otherwise Citymapper.
  const primary = input.isIOS && apple ? apple : google || apple || citymapper;
  return { google, apple, citymapper, primary, available: true };
}

export type DirectionsStepsState =
  | { state: "location_needed"; gate: DirectionsLocationGate; steps: [] }
  | { state: "steps_unavailable"; gate: DirectionsLocationGate; steps: [] }
  | { state: "ready"; gate: DirectionsLocationGate; steps: DirectionsStep[] };

/**
 * Step-by-step resolution. The "Start from your current location" row
 * exists ONLY in the ready state (verified gate + a real step producer).
 * With no verified location, the state is location_needed — no steps,
 * no assumed origin. With a verified location but no step producer
 * (the codebase's state today: no producer exists), the state is
 * steps_unavailable — the panel says so and points at Maps instead of
 * inventing streets, turns, or distances. Producer steps are rendered
 * verbatim after shape validation (non-empty instruction, non-negative
 * distance when present); empty instructions are dropped, never
 * repaired with invented text.
 */
export function resolveDirectionsSteps(input: {
  gate: DirectionsLocationGate;
  steps?: DirectionsStep[] | null;
}): DirectionsStepsState {
  if (input.gate.state !== "verified") {
    return { state: "location_needed", gate: input.gate, steps: [] };
  }
  const cleaned = (input.steps || [])
    .map((step) => ({
      instruction: cleanLabel(step?.instruction) || "",
      distanceMeters: step?.distanceMeters == null ? null : finiteNonNegative(step.distanceMeters)
    }))
    .filter((step) => step.instruction.length > 0);
  if (cleaned.length === 0) {
    return { state: "steps_unavailable", gate: input.gate, steps: [] };
  }
  return { state: "ready", gate: input.gate, steps: cleaned };
}
