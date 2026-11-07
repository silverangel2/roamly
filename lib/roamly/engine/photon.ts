import type { GeocodeFetcher } from "@/lib/roamly/engine/geocode";

/*
 * photon — the PRIMARY place candidate source (consolidation
 * 2026-11-06, places evaluation verdict: ADOPT AS PRIMARY — WITH
 * CONDITIONS). Photon (photon.komoot.io, Komoot's open-source
 * geocoder over OpenStreetMap, Apache-2.0) finds POIs the previous
 * stack structurally could not return at all (registration filtered
 * everything that wasn't place|boundary; the picker dataset holds
 * cities only), matches or beats Nominatim on city lookup, and has
 * real typo tolerance.
 *
 * The conditions are load-bearing, from the evaluation's raw runs:
 *   - RAW GLOBAL RANKING IS NEVER SURFACED UNFILTERED. "Quebec
 *     City" unbiased returns a Tesla Supercharger first and the
 *     city not at all in the top 6. Photon is a CANDIDATE SOURCE:
 *     every result flows through Roamly's existing classify /
 *     ambiguity discipline (geocode.ts) or the picker's own
 *     scoring before a traveller sees it.
 *   - NO layer=city filter (tested: it returns zero results for
 *     "Quebec City" — a trap).
 *   - POI lookups ALWAYS carry the destination's lat/lon bias
 *     (unbiased "Triveni Sangam" resolves to a beach 2,000 km
 *     away; biased, it is the correct locality at rank 1).
 *   - Category search ("ferry terminals near X") is NOT Photon's
 *     job — bias is ignored for category phrases. Category search
 *     stays with Overpass (the fallback lane's home turf).
 *
 * Fair use: the public instance is a community service. Callers
 * cache (registry rows for generation; a short-lived in-process
 * cache for the picker) and look up only on real traveller input —
 * no bulk or prefetch querying.
 */

export const PHOTON_URL = "https://photon.komoot.io/api/";
export const PHOTON_SOURCE = "photon";

export interface PhotonFeature {
  type: "Feature";
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: {
    osm_type?: string; // "N" | "W" | "R"
    osm_id?: number;
    osm_key?: string; // "place" | "boundary" | "amenity" | "tourism" | ...
    osm_value?: string; // "city" | "ferry_terminal" | ...
    type?: string; // "city" | "district" | "street" | "house" | ...
    name?: string;
    country?: string;
    countrycode?: string; // ISO 3166-1 alpha-2, upper case
    state?: string;
    city?: string;
    postcode?: string;
  };
}

export interface PhotonSearchOptions {
  limit?: number;
  /** Destination bias — REQUIRED for POI lookups (see header). */
  bias?: { lat: number; lon: number } | null;
  lang?: string;
}

/** One Photon search. Never throws: transport/parse failures come
 *  back as an empty list plus the reason, and callers decide what
 *  the fallback lane does. */
export async function searchPhoton(
  fetcher: GeocodeFetcher,
  query: string,
  options: PhotonSearchOptions = {},
  timeoutMs = 6_000
): Promise<{ features: PhotonFeature[]; error: string | null }> {
  const params = new URLSearchParams({
    q: query,
    limit: String(options.limit ?? 8),
    lang: options.lang ?? "en"
  });
  if (options.bias) {
    params.set("lat", String(options.bias.lat));
    params.set("lon", String(options.bias.lon));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(`${PHOTON_URL}?${params.toString()}`, {
      headers: { "User-Agent": "RoamlyZeroEngine/1.0 (place lookup; contact: support@roamlyhq.com)", "Accept-Language": "en" },
      signal: controller.signal
    });
    if (!res.ok) return { features: [], error: `Photon answered HTTP ${res.status}` };
    const parsed = JSON.parse(await res.text()) as { features?: PhotonFeature[] };
    if (!Array.isArray(parsed.features)) return { features: [], error: "Photon returned an unexpected payload" };
    return { features: parsed.features, error: null };
  } catch (err) {
    return { features: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Picker-session cache — normalised query -> features, short TTL.   */
/* The picker fires per keystroke (debounced client-side); repeat    */
/* lookups within a session cost zero egress and zero Photon load.   */
/* ------------------------------------------------------------------ */

const PICKER_CACHE_TTL_MS = 10 * 60 * 1000;
const PICKER_CACHE_MAX = 200;
const pickerCache = new Map<string, { at: number; features: PhotonFeature[] }>();

export async function searchPhotonCached(
  fetcher: GeocodeFetcher,
  query: string,
  options: PhotonSearchOptions = {}
): Promise<{ features: PhotonFeature[]; error: string | null }> {
  const key = [
    query.trim().toLowerCase(),
    options.bias ? `${options.bias.lat.toFixed(3)},${options.bias.lon.toFixed(3)}` : "-",
    options.limit ?? 8
  ].join("|");
  const hit = pickerCache.get(key);
  if (hit && Date.now() - hit.at < PICKER_CACHE_TTL_MS) return { features: hit.features, error: null };
  const result = await searchPhoton(fetcher, query, options);
  if (!result.error) {
    if (pickerCache.size >= PICKER_CACHE_MAX) {
      const oldest = pickerCache.keys().next().value;
      if (oldest) pickerCache.delete(oldest);
    }
    pickerCache.set(key, { at: Date.now(), features: result.features });
  }
  return result;
}
