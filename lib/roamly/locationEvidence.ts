/**
 * ONE location-evidence source for every "near" claim in the traveler UI.
 *
 * Evidence boundary (owner rule, Round 2): a planned activity must NEVER
 * render as nearby, and a calendar date must NEVER substitute for location
 * verification. "Near" renders only when ALL of these hold:
 *   (1) the trip is active in its local date window (time-eligible), AND
 *   (2) real traveler coordinates exist, AND
 *   (3) those coordinates are fresh (same 10-minute window the foreground
 *       tracker and the location-update route already enforce), AND
 *   (4) real destination coordinates exist, AND
 *   (5) the traveler is within radius of the destination.
 * Anything else is "planned / not yet" — never "near".
 *
 * Both traveler surfaces read through this module: the Alerts page feeds it
 * the persisted roamly_location_settings row (last_seen_*), and the Live
 * client feeds it live browser GPS (falling back to the same persisted row
 * via initialLocation). Same function, same freshness rule, same radius —
 * so the two surfaces cannot disagree about nearness again.
 *
 * Pure functions only: no DB, no fetch, no clock except an injectable `now`
 * (milliseconds since epoch) so tests are timezone- and time-independent.
 */
// @ts-expect-error Direct deterministic Node checks resolve local TypeScript modules by extension.
import { calculateDistanceMeters, isFreshLocationObservation } from "./location.ts";

/** Default radius: matches findNearbyActivities (activity.radius_meters || 250). */
export const LOCATION_EVIDENCE_RADIUS_METERS = 250;

export type LocationEvidenceReason =
  | "verified"
  | "trip_not_active"
  | "no_traveler_location"
  | "stale_location"
  | "no_destination_coordinates"
  | "too_far";

export type LocationEvidence = {
  verified: boolean;
  reason: LocationEvidenceReason;
  /** Haversine distance in meters, or null when it cannot be computed. */
  distanceMeters: number | null;
};

export type LocationEvidenceInput = {
  tripActive: boolean;
  travelerLatitude?: number | null;
  travelerLongitude?: number | null;
  /** ISO string or epoch ms of the traveler fix; absent means unverifiable. */
  travelerObservedAt?: string | number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  radiusMeters?: number | null;
  now?: number;
};

function finiteNumber(value: unknown): number | null {
  const num = typeof value === "string" ? Number(value) : value;
  return typeof num === "number" && Number.isFinite(num) ? num : null;
}

export function evaluateLocationEvidence(input: LocationEvidenceInput): LocationEvidence {
  if (!input.tripActive) {
    return { verified: false, reason: "trip_not_active", distanceMeters: null };
  }
  const travelerLatitude = finiteNumber(input.travelerLatitude);
  const travelerLongitude = finiteNumber(input.travelerLongitude);
  if (travelerLatitude == null || travelerLongitude == null) {
    return { verified: false, reason: "no_traveler_location", distanceMeters: null };
  }
  if (!isFreshLocationObservation(input.travelerObservedAt ?? null, input.now ?? Date.now())) {
    return { verified: false, reason: "stale_location", distanceMeters: null };
  }
  const destinationLatitude = finiteNumber(input.destinationLatitude);
  const destinationLongitude = finiteNumber(input.destinationLongitude);
  if (destinationLatitude == null || destinationLongitude == null) {
    return { verified: false, reason: "no_destination_coordinates", distanceMeters: null };
  }
  const distanceMeters = calculateDistanceMeters(
    travelerLatitude,
    travelerLongitude,
    destinationLatitude,
    destinationLongitude
  );
  const radius = input.radiusMeters != null && Number.isFinite(input.radiusMeters) && (input.radiusMeters as number) > 0
    ? (input.radiusMeters as number)
    : LOCATION_EVIDENCE_RADIUS_METERS;
  if (distanceMeters > radius) {
    return { verified: false, reason: "too_far", distanceMeters };
  }
  return { verified: true, reason: "verified", distanceMeters };
}

/** Shape of a roamly_location_settings row (only the fields this module reads). */
export type LocationSettingsRow = {
  last_seen_latitude?: unknown;
  last_seen_longitude?: unknown;
  last_seen_at?: unknown;
};

/**
 * Map the persisted location row + a destination activity to evidence.
 * A null row (traveler never shared location) is no evidence, not an error.
 */
export function locationEvidenceFromSettingsRow(
  row: LocationSettingsRow | null | undefined,
  destination: { latitude?: unknown; longitude?: unknown; radiusMeters?: unknown } | null | undefined,
  tripActive: boolean,
  now?: number
): LocationEvidence {
  return evaluateLocationEvidence({
    tripActive,
    travelerLatitude: finiteNumber(row?.last_seen_latitude),
    travelerLongitude: finiteNumber(row?.last_seen_longitude),
    travelerObservedAt:
      typeof row?.last_seen_at === "string" || typeof row?.last_seen_at === "number"
        ? row.last_seen_at
        : null,
    destinationLatitude: finiteNumber(destination?.latitude),
    destinationLongitude: finiteNumber(destination?.longitude),
    radiusMeters: finiteNumber(destination?.radiusMeters),
    now
  });
}

/**
 * Affirmative nearness claims in stored notification/event bodies.
 * Negations ("not nearby", "not near") are stripped first so honest copy
 * such as "Not nearby yet" is never mistaken for a claim.
 */
const NEGATED_NEAR = /\bnot\s+near(?:by)?\b|\bno\s+longer\s+near(?:by)?\b/gi;
const AFFIRMATIVE_NEAR_CLAIM = /\bnear\b|\bnearby\b|\byou are near\b|\bnear your\b/i;

export function containsAffirmativeNearClaim(text: string | null | undefined): boolean {
  const raw = (text || "").trim();
  if (!raw) return false;
  return AFFIRMATIVE_NEAR_CLAIM.test(raw.replace(NEGATED_NEAR, ""));
}
