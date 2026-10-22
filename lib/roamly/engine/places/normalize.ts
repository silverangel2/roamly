import { haversineKm } from "@/lib/roamly/engine/util";
import type { StoredEnrichment } from "@/lib/roamly/engine/packs/types";
import {
  MATCH_GATE_KM,
  type MatchRejection,
  type MatchVerdict,
  type PlacesRawDetails,
  type PlacesRawPeriod,
  type PlacesRawPlace
} from "@/lib/roamly/engine/places/types";

/*
 * Normalization + the distance gate — ported from the shadow
 * collector (zero-engine google-enrich.mjs, live-proven 2026-10-21).
 * Pure functions: no I/O, no clock of their own (the caller stamps
 * fetchedAt), so the recorded-response replay in the Phase 4 checks
 * exercises exactly the code production runs.
 */

const GOOGLE_DAY_TO_KEY: Record<number, string> = { 0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa" };

/** Google periods -> per-weekday {open, close} in minutes after
 *  local midnight (engine format). Verbatim port of the shadow's
 *  googlePeriodsToByDay, including the overnight close (+1440 when
 *  the close day differs from the open day) and the 24:00 close for
 *  a period with no close point. */
export function googlePeriodsToByDay(
  periods: readonly PlacesRawPeriod[] | undefined
): Record<string, { open: number; close: number }> {
  const byDay: Record<string, { open: number; close: number }> = {};
  for (const p of periods || []) {
    if (!p?.open) continue;
    const key = GOOGLE_DAY_TO_KEY[p.open.day ?? -1];
    if (!key) continue;
    const open = (p.open.hour || 0) * 60 + (p.open.minute || 0);
    const close = p.close
      ? (p.close.hour || 0) * 60 + (p.close.minute || 0) + (p.close.day !== p.open.day ? 1440 : 0)
      : 1440;
    byDay[key] = { open, close };
  }
  return byDay;
}

/** The 30-day refresh discipline: refreshDue is the DATE
 *  fetchedAt + 30 days (the shadow's normalizeDetails semantics —
 *  a date string, compared date-wise by the cache-first check). */
export function refreshDueOf(fetchedAtIso: string): string {
  return new Date(new Date(fetchedAtIso).getTime() + 30 * 86400000).toISOString().slice(0, 10);
}

/** Place Details -> the stored enrichment record. Verbatim port of
 *  the shadow's normalizeDetails (regular hours preferred over
 *  current hours), plus the Phase 4 ledger link fields the caller
 *  stamps (operationKey). `source` is the producing client's label
 *  ("google" for the live provider). */
export function normalizeDetails(
  details: PlacesRawDetails,
  source: string,
  fetchedAt: string,
  matchDistanceKm: number | null = null
): StoredEnrichment {
  const hours = details.regularOpeningHours || details.currentOpeningHours || null;
  return {
    source,
    placeId: details.id || null,
    fetchedAt,
    refreshDue: refreshDueOf(fetchedAt),
    // Absent (not null) when Google returned no hours — the engine
    // shape's no-hours state (EngineGoogleData.hoursByDay optional).
    hoursByDay: hours?.periods ? googlePeriodsToByDay(hours.periods) : undefined,
    priceLevel: details.priceLevel || null,
    rating: details.rating ?? null,
    userRatingCount: details.userRatingCount ?? null,
    wheelchairEntrance: details.accessibilityOptions?.wheelchairAccessibleEntrance ?? null,
    businessStatus: details.businessStatus || null,
    matchDistanceKm,
    matchRejected: null,
    operationKey: null
  };
}

/** The stored record for a REJECTED match: no Google data is
 *  attached — the rejection (with its distance) is the record, and
 *  it carries the same 30-day freshness so a rejected candidate is
 *  not re-searched inside the refresh cycle (the shadow cached
 *  rejections exactly this way). */
export function rejectionRecord(
  rejection: MatchRejection,
  source: string,
  fetchedAt: string,
  operationKey: string | null
): StoredEnrichment {
  return {
    source,
    placeId: null,
    fetchedAt,
    refreshDue: refreshDueOf(fetchedAt),
    hoursByDay: undefined,
    priceLevel: null,
    rating: null,
    userRatingCount: null,
    wheelchairEntrance: null,
    businessStatus: null,
    matchDistanceKm: null,
    matchRejected: {
      reason: rejection.reason,
      matchedName: rejection.matchedName,
      placeId: rejection.placeId,
      distanceKm: rejection.distanceKm,
      thresholdKm: rejection.thresholdKm
    },
    operationKey
  };
}

/* ------------------------------------------------------------------ */
/* The distance gate. The search's first hit is "the match"            */
/* (collector discipline); it is accepted only if its coordinates     */
/* sit within MATCH_GATE_KM of the candidate's known OSM position.    */
/* A hit with no location cannot be verified and is rejected —        */
/* unverifiable is not attachable. The rejection is provenance, kept. */
/* Ported from the shadow's evaluateMatch; the distance is rounded    */
/* to 2dp BEFORE the threshold comparison, exactly as the shadow did */
/* (the live proof's 87.39 km Bédard figure is in that rounding).     */
/* ------------------------------------------------------------------ */
export function evaluateMatch(
  candidatePos: { lat: number; lon: number } | null,
  place: PlacesRawPlace | undefined
): MatchVerdict {
  const matchedName = place?.displayName?.text || null;
  if (!place?.id) {
    return { matched: false, rejection: { reason: "no-results", matchedName, placeId: null, distanceKm: null, thresholdKm: MATCH_GATE_KM } };
  }
  if (!candidatePos) {
    return { matched: false, rejection: { reason: "candidate-position-unknown", matchedName, placeId: place.id, distanceKm: null, thresholdKm: MATCH_GATE_KM } };
  }
  if (!place.location) {
    return { matched: false, rejection: { reason: "no-location-returned", matchedName, placeId: place.id, distanceKm: null, thresholdKm: MATCH_GATE_KM } };
  }
  const distanceKm = +haversineKm(candidatePos, { lat: place.location.latitude, lon: place.location.longitude }).toFixed(2);
  if (distanceKm > MATCH_GATE_KM) {
    return { matched: false, rejection: { reason: "distance-gate", matchedName, placeId: place.id, distanceKm, thresholdKm: MATCH_GATE_KM } };
  }
  return { matched: true, placeId: place.id, matchedName, distanceKm };
}
