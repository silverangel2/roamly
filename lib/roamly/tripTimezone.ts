/**
 * ONE trip-timezone module (timezone release-blocker round, 2026-10-26).
 *
 * THE DEFECT IT FIXES: every trip-day computation used to resolve the
 * trip's zone from stored trip metadata alone
 * (`timezoneFromTripMetadata` in liveCompanion.ts), and neither tester
 * trip's metadata records any timezone — so every surface silently fell
 * back to "UTC". From 20:00–24:00 destination-local time, UTC is already
 * the next calendar day, so Live showed Day 2 while the traveler was
 * still on Day 1. Labels on the shown day were correct; the DAY was
 * wrong in that window.
 *
 * RESOLUTION ORDER (single implementation, used by every day surface):
 *  1. A valid IANA zone stored in trip metadata (same candidate keys
 *     `timezoneFromTripMetadata` always read: planning.timezone,
 *     planning.destinationTimezone / destination_timezone, and the
 *     root-level equivalents). Stored metadata wins: it is the trip's
 *     own record, and a generation-time zone must never be overridden
 *     by a registry guess.
 *  2. The trip's destination matched EXACTLY (accent-stripped,
 *     case-insensitive, city-before-comma) against a VERIFIED registry
 *     already in this codebase — `recommendedPlaces` in
 *     lib/roamly/places.ts (client-safe: that file imports nothing),
 *     plus, on the server only, `PRODUCTION_DESTINATION_SEEDS` in
 *     lib/roamly/engine/packs/destinations.ts (see
 *     tripTimezoneServer.ts). No new table is written here, no
 *     coordinates-to-timezone guess is hand-rolled, no paid provider
 *     is called. A destination that matches no registry entry is
 *     UNKNOWN, not approximated from its country ("Canada" alone
 *     never implies a zone — the country-info model already refused
 *     exactly that inference).
 *  3. UNKNOWN: `zone` is null. Callers MUST NOT silently substitute
 *     UTC. User-visible surfaces render UNKNOWN_TZ_LABEL next to the
 *     day they show and compute that day in UTC only as the labeled
 *     fallback (`zoneForMath`). Background jobs, which have no UI to
 *     carry the label, keep the module's documented fallback through
 *     `timezoneFromTripMetadata` (which now delegates to the metadata
 *     step of this module, so even those callers share this code).
 *
 * DAY MATH in this module uses the same Intl en-CA day-parts rule as
 * `tripWindowState` / `tripClockState` / `getTripDayFromDate` (those
 * functions keep their own signatures — lib/itinerary.ts is protected
 * — but every day surface now passes them the zone resolved HERE, so
 * the resolution has exactly one source).
 *
 * Pure functions; `now` injectable so tests are timezone-independent
 * (the same assertions run under TZ=America/Moncton and TZ=UTC).
 */

import { recommendedPlaces } from "@/lib/roamly/places";

export type TripTimezoneSource = "metadata" | "destination-registry" | "unknown";

export type TripTimezoneResolution = {
  /** Valid IANA zone, or null when genuinely unknown. */
  zone: string | null;
  source: TripTimezoneSource;
  /** True exactly when zone is non-null. */
  known: boolean;
};

/** Visible fallback label — never a silent UTC day. */
export const UNKNOWN_TZ_LABEL = "Timezone unknown — days shown in UTC";

export type TripTimezoneRegistryEntry = {
  displayName?: string | null;
  city?: string | null;
  label?: string | null;
  timeZone?: string | null;
  timezone?: string | null;
};

export type TripTimezoneInput = {
  metadata?: unknown;
  destination?: unknown;
  destination_name?: unknown;
  destination_city?: unknown;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** True when Intl accepts the value as an IANA zone. */
export function isValidIanaZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value.trim() }).format();
    return true;
  } catch {
    return false;
  }
}

/**
 * Step 1 — the stored-metadata zone, or null. Identical candidate keys
 * and validation to the old `timezoneFromTripMetadata` (which now
 * delegates here), minus its silent fallback: callers decide what an
 * absent zone means instead of inheriting "UTC".
 */
export function metadataZoneFromMetadata(metadata: unknown): string | null {
  const root = recordValue(metadata);
  const planning = recordValue(root?.planning) || recordValue(root?.tripPlanning) || root;
  const candidates = [
    planning?.timezone,
    planning?.destinationTimezone,
    planning?.destination_timezone,
    root?.timezone,
    root?.destinationTimezone,
    root?.destination_timezone
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && isValidIanaZone(candidate.trim())) {
      return candidate.trim();
    }
  }
  return null;
}

/** Destination strings a trip carries, in preference order. */
export function tripDestinationCandidates(input: TripTimezoneInput): string[] {
  const planning = recordValue(recordValue(input.metadata)?.planning)
    || recordValue(recordValue(input.metadata)?.tripPlanning);
  const values = [
    input.destination,
    input.destination_name,
    input.destination_city,
    planning?.destination,
    planning?.destinationCity
  ];
  const out: string[] = [];
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

/**
 * "Montreal, Canada" → "MONTREAL"; "Québec City" → "QUEBEC CITY".
 * Only the city segment (before the first comma) is ever matched, so
 * a "City, Country" label matches the registry's city row.
 */
export function normalizeDestinationKey(value: string): string {
  return value
    .split(",")[0]
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function registryZoneForDestination(
  destination: string,
  registry: readonly TripTimezoneRegistryEntry[]
): string | null {
  const key = normalizeDestinationKey(destination);
  if (!key) return null;
  // Full-label match first ("Toronto, Canada" against a "Toronto,
  // Canada" label), then city match. Exact normalized equality only —
  // no substring or fuzzy matching, so a near-named place can never
  // borrow another city's zone.
  const full = destination
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const entry of registry) {
    const zone = cleanString(entry.timeZone) || cleanString(entry.timezone);
    if (!zone || !isValidIanaZone(zone)) continue;
    const labelKey = entry.label ? normalizeDestinationKey(entry.label) : "";
    const cityKey = entry.city ? normalizeDestinationKey(entry.city) : "";
    const nameKey = entry.displayName ? normalizeDestinationKey(entry.displayName) : "";
    if (labelKey && full === entry.label?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim()) {
      return zone;
    }
    if (key === cityKey || key === nameKey || key === labelKey) return zone;
  }
  return null;
}

/** Registry rows derived from the codebase's own recommended places. */
export const RECOMMENDED_PLACE_ZONES: readonly TripTimezoneRegistryEntry[] =
  recommendedPlaces.map((place) => ({
    displayName: place.city || place.label,
    city: place.city || null,
    label: place.label,
    timeZone: place.timezone || null
  }));

/**
 * THE resolution. Stored metadata first, then the verified registry
 * (recommended places, plus any extra registry the caller supplies —
 * the server resolver supplies the destination seeds). Unknown stays
 * unknown: `zone` null, `source` "unknown".
 */
export function resolveTripTimezone(
  input: TripTimezoneInput,
  extraRegistry: readonly TripTimezoneRegistryEntry[] = []
): TripTimezoneResolution {
  const stored = metadataZoneFromMetadata(input.metadata);
  if (stored) return { zone: stored, source: "metadata", known: true };
  const registry: readonly TripTimezoneRegistryEntry[] = [...extraRegistry, ...RECOMMENDED_PLACE_ZONES];
  for (const destination of tripDestinationCandidates(input)) {
    const zone = registryZoneForDestination(destination, registry);
    if (zone) return { zone, source: "destination-registry", known: true };
  }
  return { zone: null, source: "unknown", known: false };
}

/** Zone to feed day math: the resolved zone, or UTC ONLY for unknown trips. */
export function zoneForMath(resolution: TripTimezoneResolution): string {
  return resolution.zone || "UTC";
}

/** Calendar date (YYYY-MM-DD) of `now` in the given zone. */
export function localDateInZone(now: string | Date, zone: string): string {
  const date = now instanceof Date ? now : new Date(now);
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: isValidIanaZone(zone) ? zone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(valid);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month").padStart(2, "0")}-${value("day").padStart(2, "0")}`;
}

export type TripWindow = "future_trip" | "active" | "completed_trip" | "missing_dates";

/** Same window rule as tripWindowState/tripClockState, in the resolved zone. */
export function tripWindowInZone(params: {
  startDate?: string | null;
  endDate?: string | null;
  zone?: string | null;
  now?: string | Date;
}): TripWindow {
  const zone = params.zone && isValidIanaZone(params.zone) ? params.zone : "UTC";
  const today = localDateInZone(params.now || new Date(), zone);
  const start = (params.startDate || "").slice(0, 10);
  const end = (params.endDate || "").slice(0, 10);
  if (!start || !end) return "missing_dates";
  if (start.localeCompare(today) > 0) return "future_trip";
  if (end.localeCompare(today) < 0) return "completed_trip";
  return "active";
}

function clampTripDays(daysCount: number | null | undefined): number {
  if (!daysCount || !Number.isFinite(daysCount)) return 1;
  return Math.min(Math.max(Math.floor(daysCount), 1), 365);
}

/**
 * 1-based trip-day number for `now` in the resolved zone — the same
 * calendar-date math as `getTripDayFromDate` (protected file, not
 * duplicated for production use; this copy exists so the test suite
 * can prove the zone, not just the arithmetic, without importing the
 * protected module's other surface). Production day selection passes
 * the resolved zone INTO `getTripDayFromDate`.
 */
export function tripDayNumberInZone(
  startDate: string | null | undefined,
  daysCount: number | null | undefined,
  zone: string | null | undefined,
  now: string | Date = new Date()
): number {
  if (!startDate) return 1;
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(instant.getTime())) return 1;
  const today = localDateInZone(instant, zone && isValidIanaZone(zone) ? zone : "UTC");
  const todayUtc = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)) - 1,
    Number(today.slice(8, 10))
  );
  const diff = Math.floor((todayUtc - start.getTime()) / 86_400_000) + 1;
  return Math.min(Math.max(diff, 1), clampTripDays(daysCount));
}
