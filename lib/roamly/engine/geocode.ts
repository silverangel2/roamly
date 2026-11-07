import { PHOTON_SOURCE, searchPhoton } from "@/lib/roamly/engine/photon";
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
  /** Which candidate source produced this place ("photon" is the
   *  primary since the 2026-11-06 consolidation; "nominatim" is
   *  the fallback lane). Absent on places built by older code and
   *  by proofs — readers default it to GEOCODER_SOURCE. */
  source?: string;
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
  /** jsonv2 names this field "category" (the v1 name "class" is
   *  accepted too) — filtering on "class" alone discarded every
   *  real result (live-caught 2026-10-22: Lisbon read as
   *  not_found against the real service). */
  category?: string;
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
  const usable = results.filter((r) => {
    const category = r.category ?? r.class;
    return (
      Number.isFinite(Number(r.lat)) &&
      Number.isFinite(Number(r.lon)) &&
      (category === "place" || category === "boundary") &&
      canonicalNameOf(r).length > 0 &&
      countryOf(r).length > 0
    );
  });
  usable.sort((x, y) => (y.importance ?? 0) - (x.importance ?? 0));
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

/* ------------------------------------------------------------------ */
/* Photon — the PRIMARY candidate source (consolidation 2026-11-06)  */
/*                                                                     */
/* Photon features are mapped into the Nominatim result shape and    */
/* run through the SAME classifyGeocodeResults discipline — place/   */
/* boundary preference, importance ordering, cross-country near-tie  */
/* ambiguity — so the flip changes where candidates come from, not   */
/* how strictly they are judged. Photon returns no importance score: */
/* its rank order is mapped onto a descending ladder with enough     */
/* spread that a clear rank-1 winner is not a near-tie, while a      */
/* genuinely split field still trips the ambiguity rule. The         */
/* picker's country (when the caller knows it) filters candidates    */
/* BEFORE classification — the evaluation's Lévis case: unbaised,    */
/* France outranks Canada; with the country the traveller picked,    */
/* the Canadian city is simply the answer. NO layer filter is used   */
/* (layer=city returns zero results for "Quebec City" — tested).     */
/* ------------------------------------------------------------------ */

const PHOTON_OSM_TYPE: Record<string, string> = { N: "node", W: "way", R: "relation" };

export function photonFeatureToNominatimShape(feature: {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}, rank: number): NominatimResult | null {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lon, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const osmKey = typeof props.osm_key === "string" ? props.osm_key : "";
  const name = typeof props.name === "string" ? props.name : "";
  const country = typeof props.country === "string" ? props.country : "";
  const city = typeof props.city === "string" ? props.city : "";
  return {
    osm_type: PHOTON_OSM_TYPE[String(props.osm_type || "N")] || "node",
    osm_id: typeof props.osm_id === "number" ? props.osm_id : 0,
    lat: String(lat),
    lon: String(lon),
    category: osmKey || undefined,
    type: typeof props.osm_value === "string" ? props.osm_value : undefined,
    // Rank ladder: 0.66, 0.56, 0.46, ... floored at 0.31 so the
    // classifier's >= 0.3 runner-up rule can still see a split
    // field, with 0.10 between adjacent ranks — a clean rank gap
    // is decisive, adjacent cross-country ranks read as the
    // near-tie they are.
    importance: Math.max(0.31, 0.66 - rank * 0.1),
    display_name: [name, city, country].filter(Boolean).join(", "),
    address: {
      ...(city ? { city } : {}),
      ...(country ? { country } : {}),
      ...(typeof props.countrycode === "string" ? { country_code: props.countrycode.toLowerCase() } : {})
    }
  };
}

/** One Photon lookup for one place name, classified by the
 *  existing discipline. Never throws. */
export async function geocodePlaceWithPhoton(
  fetcher: GeocodeFetcher,
  name: string,
  countryHint?: string | null,
  timeoutMs = 6_000
): Promise<GeocodeOutcome> {
  const { features, error } = await searchPhoton(fetcher, name, { limit: 8 }, timeoutMs);
  if (error) return { kind: "unavailable", reason: error };
  let usable = features;
  const hint = (countryHint || "").trim().toLowerCase();
  if (hint) {
    const filtered = features.filter((f) => {
      const cc = (f.properties?.countrycode || "").toLowerCase();
      const country = (f.properties?.country || "").toLowerCase();
      return cc === hint || country === hint;
    });
    // The hint narrows; it never empties the field into a false
    // not_found when Photon plainly has the place under another
    // country reading.
    if (filtered.length) usable = filtered;
  }
  const mapped: NominatimResult[] = [];
  usable.forEach((feature, i) => {
    const row = photonFeatureToNominatimShape(feature as never, i);
    if (row) mapped.push(row);
  });
  const outcome = classifyGeocodeResults(mapped);
  if (outcome.kind === "found") {
    outcome.place.source = PHOTON_SOURCE;
  }
  return outcome;
}

/** Default production geocoder over the global fetch: Photon
 *  PRIMARY, Nominatim FALLBACK (consolidation 2026-11-06). A
 *  Photon "found" or "ambiguous" is a discipline answer and
 *  stands; "not_found"/"unavailable" fall through to the
 *  Nominatim lane, whose own discipline then decides. */
export const liveGeocoder = async (name: string, countryHint?: string | null): Promise<GeocodeOutcome> => {
  const fetcher: GeocodeFetcher = (url, init) => fetch(url, init);
  const photon = await geocodePlaceWithPhoton(fetcher, name, countryHint);
  if (photon.kind === "found" || photon.kind === "ambiguous") return photon;
  return geocodePlaceWithNominatim(fetcher, name);
};

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
  const source = place.source || GEOCODER_SOURCE;
  return {
    destinationId: destinationRegistryId(place.country, place.canonicalName, place.centre),
    displayName: place.canonicalName,
    country: place.country,
    centre: place.centre,
    bbox: shadowBBox(place.centre, "city"),
    timeZone,
    geocodeProvenance: {
      source,
      sourceRef: `${source}:${place.osmType}:${place.osmId}`,
      recordedAt: now.toISOString() as UtcInstant,
      label: `Auto-registered ${now.toISOString()} from OpenStreetMap geocoding via ${source === "photon" ? "Photon" : "Nominatim"} (${place.displayName}); first trip request for this destination.`
    }
  };
}

/** The durable identity of a geocoded place inside the registry:
 *  its geocoder source reference. A later variant spelling that
 *  resolves to the same OSM object finds the existing row by
 *  this reference even if its content ID somehow differed. */
export function geocodeSourceRef(place: GeocodedPlace): string {
  const source = place.source || GEOCODER_SOURCE;
  return `${source}:${place.osmType}:${place.osmId}`;
}
