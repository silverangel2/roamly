import { destinationRegistryId, shadowBBox } from "@/lib/roamly/engine/packs/destinations";
import type { DestinationDTO } from "@/lib/roamly/engine/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";

/*
 * geocode — automatic destination registration (ship fix #5,
 * owner decision 2026-10-22: "Make any city work automatically").
 *
 * Until now a trip to a destination outside the registered set
 * (8 corpus destinations + Paris) failed at the outline stage
 * with ZERO_ENGINE_DESTINATION_UNREGISTERED (crowd test,
 * 2026-10-22: Lisbon failed in 4m41s). Now the outline resolves
 * the place against OpenStreetMap's Nominatim geocoder — free,
 * no key, no paid calls — registers it in the same destination
 * registry (persisted by the pack store), and the trip takes the
 * ordinary cold-destination posture: its pack build is enqueued
 * by the serving read and the job WAITS honestly until the pack
 * exists. Registration is not grounding: generation still runs
 * only against a built pack and the same final validation.
 *
 * Nominatim usage-policy compliance (nominatim.org usage policy):
 *   - at most one request per NEW destination name per job — the
 *     registration itself is the cache (durable in the registry),
 *     and a terminal UNRESOLVABLE failure stops the job, so a bad
 *     name is never re-geocoded on a loop;
 *   - a descriptive User-Agent identifying the application;
 *   - no bulk or prefetch geocoding — lookups happen only on a
 *     real trip's outline, one place at a time.
 *
 * Honest failures stay: a name with no map match, or a genuine
 * cross-country ambiguity, fails with ZERO_ENGINE_DESTINATION_
 * UNRESOLVABLE and traveler-facing wording — distinguishable from
 * both the retired UNREGISTERED failure and system errors. A
 * geocoder OUTAGE is a different, transient failure
 * (ZERO_ENGINE_GEOCODER_UNAVAILABLE) and the job retries on
 * later wakes instead of dying.
 */

export interface GeocodedPlace {
  canonicalName: string;
  country: string;
  countryCode: string | null;
  centre: { lat: number; lon: number };
  osmType: string;
  osmId: number;
  importance: number;
  displayName: string;
}

export type GeocodeOutcome =
  | { kind: "found"; place: GeocodedPlace }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "unavailable"; reason: string };

export type GeocodeFetcher = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const GEOCODER_USER_AGENT =
  "RoamlyZeroEngine/1.0 (destination auto-registration; contact: support@roamlyhq.com)";
export const GEOCODER_SOURCE = "nominatim";

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  importance?: number;
  display_name?: string;
  address?: Record<string, string>;
}

function canonicalNameOf(result: NominatimResult): string {
  const a = result.address || {};
  return (
    a.city ||
    a.town ||
    a.village ||
    a.municipality ||
    a.county ||
    (result.display_name || "").split(",")[0]?.trim() ||
    ""
  );
}

function countryOf(result: NominatimResult): string {
  const a = result.address || {};
  if (a.country) return a.country;
  const parts = (result.display_name || "").split(",");
  return parts.length ? parts[parts.length - 1].trim() : "";
}

/** Classify raw Nominatim results into the outcome the outline
 *  acts on. Cross-country near-ties are ambiguity; everything
 *  else takes the geocoder's top-ranked real place. */
export function classifyGeocodeResults(results: NominatimResult[]): GeocodeOutcome {
  const usable = results
    .filter(
      (r) =>
        Number.isFinite(Number(r.lat)) &&
        Number.isFinite(Number(r.lon)) &&
        (r.class === "place" || r.class === "boundary") &&
        canonicalNameOf(r).length > 0 &&
        countryOf(r).length > 0
    )
    .sort((x, y) => (y.importance ?? 0) - (x.importance ?? 0));
  if (!usable.length) return { kind: "not_found" };
  const top = usable[0];
  const second = usable[1];
  if (
    second &&
    countryOf(second).toLowerCase() !== countryOf(top).toLowerCase() &&
    (second.importance ?? 0) >= 0.3 &&
    (top.importance ?? 0) - (second.importance ?? 0) < 0.1
  ) {
    return {
      kind: "ambiguous",
      candidates: usable
        .slice(0, 3)
        .map((r) => `${canonicalNameOf(r)}, ${countryOf(r)}`)
    };
  }
  return {
    kind: "found",
    place: {
      canonicalName: canonicalNameOf(top),
      country: countryOf(top),
      countryCode: top.address?.country_code || null,
      centre: { lat: Number(top.lat), lon: Number(top.lon) },
      osmType: String(top.osm_type || "node"),
      osmId: Number(top.osm_id || 0),
      importance: top.importance ?? 0,
      displayName: top.display_name || `${canonicalNameOf(top)}, ${countryOf(top)}`
    }
  };
}

/** One Nominatim lookup for one place name. Never throws: every
 *  failure mode is a classified outcome. */
export async function geocodePlaceWithNominatim(
  fetcher: GeocodeFetcher,
  name: string,
  timeoutMs = 6_000
): Promise<GeocodeOutcome> {
  const query = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    featuretype: "city",
    q: name
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(`${NOMINATIM_URL}?${query.toString()}`, {
      headers: { "User-Agent": GEOCODER_USER_AGENT, "Accept-Language": "en" },
      signal: controller.signal
    });
    if (!res.ok) return { kind: "unavailable", reason: `Nominatim answered HTTP ${res.status}` };
    const parsed = JSON.parse(await res.text()) as NominatimResult[];
    if (!Array.isArray(parsed)) return { kind: "unavailable", reason: "Nominatim returned an unexpected payload" };
    return classifyGeocodeResults(parsed);
  } catch (err) {
    return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Default production geocoder over the global fetch. */
export const liveGeocoder = (name: string): Promise<GeocodeOutcome> =>
  geocodePlaceWithNominatim((url, init) => fetch(url, init), name);

/** The plan-time zone for a place, from Open-Meteo (free, no
 *  key — the same provider the pack weather snapshots use, with
 *  timezone=auto). A failure degrades to "UTC": nothing in the
 *  engine consumes the zone for correctness today, and a wrong
 *  zone must never block a registration. */
export async function resolveTimeZoneForCoords(
  fetcher: GeocodeFetcher,
  centre: { lat: number; lon: number },
  timeoutMs = 2_500
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${centre.lat}&longitude=${centre.lon}` +
      `&timezone=auto&forecast_days=1`;
    const res = await fetcher(url, { headers: { "User-Agent": GEOCODER_USER_AGENT }, signal: controller.signal });
    if (!res.ok) return "UTC";
    const parsed = JSON.parse(await res.text()) as { timezone?: string };
    return typeof parsed.timezone === "string" && parsed.timezone.includes("/") ? parsed.timezone : "UTC";
  } catch {
    return "UTC";
  } finally {
    clearTimeout(timer);
  }
}

/** The registry row for a geocoded place. Identity is the
 *  registry's own content ID over (country, canonical name,
 *  centre) — spelling variants that geocode to the same place
 *  converge on the same canonical name + centre, hence the same
 *  ID, hence one registration. The bbox is the registry's own
 *  shadow rule, identical to the seeded destinations'. */
export function buildAutoRegistration(place: GeocodedPlace, timeZone: string, now: Date): DestinationDTO {
  return {
    destinationId: destinationRegistryId(place.country, place.canonicalName, place.centre),
    displayName: place.canonicalName,
    country: place.country,
    centre: place.centre,
    bbox: shadowBBox(place.centre, "city"),
    timeZone,
    geocodeProvenance: {
      source: GEOCODER_SOURCE,
      sourceRef: `nominatim:${place.osmType}:${place.osmId}`,
      recordedAt: now.toISOString() as UtcInstant,
      label: `Auto-registered ${now.toISOString()} from OpenStreetMap/Nominatim geocoding (${place.displayName}); first trip request for this destination.`
    }
  };
}

/** The durable identity of a geocoded place inside the registry:
 *  its Nominatim source reference. A later variant spelling that
 *  resolves to the same OSM object finds the existing row by
 *  this reference even if its content ID somehow differed. */
export function geocodeSourceRef(place: GeocodedPlace): string {
  return `nominatim:${place.osmType}:${place.osmId}`;
}
