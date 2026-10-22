import { sha256Hex, sourceKey } from "@/lib/roamly/engine/ids";
import type { DestinationDTO, ProvenanceDTO } from "@/lib/roamly/engine/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";
import type { EngineWeatherDay } from "@/lib/roamly/engine/util";
import type { StoredCandidate, WeatherSnapshotKind } from "@/lib/roamly/engine/packs/types";
import { PACK_CLASSIFIER_VERSION, PACK_QUERY_VERSION, toInstant } from "@/lib/roamly/engine/packs/types";

/*
 * Collectors — the typed provider services for the pack data plane
 * (DESIGN-PRODUCTION.md Phase 3: "the classification/transformation
 * logic ports from collectors.mjs").
 *
 * PORTED VERBATIM from the shadow zero-engine's collectors.mjs:
 * classifyElement, toCandidate's field selection, dedupe, the bbox
 * sizing rule, and the Overpass query pair. The shadow's diet helpers
 * are NOT here — Phase 2 ported them into solver.ts, their only core
 * consumer.
 *
 * REBUILT (the shadow's disk-cache lifecycle does not port):
 *   - no filesystem cache: responses are evidence attached to the
 *     build's provenance, never a mutable on-disk pack;
 *   - no 25-second inter-round pause: fetches carry per-attempt
 *     timeouts (AbortController) and bounded retries with jittered
 *     exponential backoff across the public Overpass instances;
 *   - weather is fetched as its own artifact (fetchWeatherDays) —
 *     the POI build never fetches weather.
 *
 * Every function takes an injectable Fetcher, so proofs replay
 * recorded provider payloads through the exact production code path;
 * the live proof passes the real global fetch.
 */

export const OVERPASS_ENDPOINTS: readonly string[] = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter"
];

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

export const COLLECTOR_USER_AGENT =
  "RoamlyZeroEngine/1.0 (zero-token shadow engine research; contact: support@roamlyhq.com)";

/** The minimal fetch surface the collectors need (the global fetch
 *  satisfies it; proofs inject recorded/fake implementations). */
export type Fetcher = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export const systemFetcher: Fetcher = (url, init) => fetch(url, init);

export interface FetchPolicy {
  /** Per-attempt timeout (AbortController). */
  attemptTimeoutMs: number;
  /** Rounds over the endpoint list (Overpass only). */
  maxRounds: number;
  /** Backoff base; delay = base * 2^attemptIndex, jittered ±50%. */
  backoffBaseMs: number;
}

export const DEFAULT_FETCH_POLICY: FetchPolicy = {
  attemptTimeoutMs: 100_000,
  maxRounds: 2,
  backoffBaseMs: 1_500
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function jitteredBackoff(baseMs: number, attemptIndex: number, random: () => number): number {
  const grown = baseMs * Math.pow(2, attemptIndex);
  return Math.round(grown * (0.5 + random()));
}

async function fetchTextWithTimeout(
  fetcher: Fetcher,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 120)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Overpass — raw element shapes (as the API returns them)             */
/* ------------------------------------------------------------------ */

export interface OsmElement {
  type: string; // "node" | "way" | "relation"
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassPayload {
  elements?: OsmElement[];
}

function coordsOf(e: OsmElement): { lat: number; lon: number } | null {
  if (e.lat != null && e.lon != null) return { lat: e.lat, lon: e.lon };
  if (e.center) return { lat: e.center.lat, lon: e.center.lon };
  return null;
}

function osmUrl(e: OsmElement): string {
  return `https://www.openstreetmap.org/${e.type}/${e.id}`;
}

/* ------------------------------------------------------------------ */
/* Classification — PORTED VERBATIM from shadow collectors.mjs         */
/* ------------------------------------------------------------------ */

export function classifyElement(e: OsmElement): string | null {
  const t = e.tags || {};
  if (!t.name) return null;
  // Markets hide under shop tags in OSM (greengrocer/farm/food), not only
  // amenity=marketplace — a name+shop rule finds them without junk:
  // second-hand/clothing "markets" are explicitly excluded.
  if (
    /market/i.test(t.name) &&
    t.second_hand !== "only" &&
    (t.amenity === "marketplace" || ["farm", "greengrocer", "food", "deli", "supermarket"].includes(t.shop || ""))
  )
    return "market";
  if (t.waterway === "waterfall") return "falls";
  if (t.man_made === "lighthouse" || t.building === "lighthouse") return "lighthouse";
  if (t.tourism === "museum") return "museum";
  if (t.tourism === "gallery") return "gallery";
  if (t.tourism === "attraction") return "attraction";
  if (t.tourism === "viewpoint") return "viewpoint";
  if (["hotel", "hostel", "guest_house", "apartment", "motel"].includes(t.tourism || "")) return "stay";
  if (t.leisure === "park") return "park";
  if (t.amenity === "marketplace") return "market";
  if (t.amenity === "ferry_terminal") return "ferry";
  if (t.railway === "station" || t.amenity === "bus_station") return "station";
  if (["theatre", "arts_centre", "cinema"].includes(t.amenity || "")) return "venue";
  if (["restaurant", "cafe", "fast_food", "bakery"].includes(t.amenity || "")) return "food";
  if (t.historic && !["memorial", "monument", "artwork"].includes(t.historic)) return "historic";
  if (t.natural === "beach") return "park";
  return null;
}

const TAG_KEEP: readonly string[] = ["cuisine", "wheelchair", "website", "charge", "fee", "operator", "description"];

/** The shadow's toCandidate, normalized into the stored row shape:
 *  same field selection (TAG_KEEP + diet:* tags), same key/URL
 *  derivation; the row additionally carries the Phase 1 source key. */
export function toStoredCandidate(e: OsmElement, kind: string): StoredCandidate {
  const t = e.tags || {};
  const tags: Record<string, string> = {};
  for (const k of Object.keys(t)) {
    if (TAG_KEEP.includes(k) || k.startsWith("diet:")) tags[k] = t[k];
  }
  const osmKey = `${e.type}/${e.id}`;
  return {
    candidateKey: sourceKey("osm", osmKey),
    osmKey,
    kind,
    name: t.name,
    nameEn: t["name:en"] || null,
    pos: coordsOf(e),
    hoursRaw: t.opening_hours || null,
    tags,
    url: osmUrl(e),
    enrichment: null
  };
}

function dedupeCandidates(list: StoredCandidate[]): StoredCandidate[] {
  const seen = new Set<string>();
  const out: StoredCandidate[] = [];
  for (const c of list) {
    const k = `${c.name.toLowerCase()}|${c.kind}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Queries — the shadow pair, verbatim, bbox interpolated              */
/* ------------------------------------------------------------------ */

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

function bboxString(b: BBox): string {
  return `${b.minLat},${b.minLon},${b.maxLat},${b.maxLon}`;
}

export function mainOverpassQuery(bbox: BBox): string {
  const b = bboxString(bbox);
  return `[out:json][timeout:90];
(
  node["tourism"~"attraction|museum|gallery|viewpoint|hotel|hostel|guest_house|apartment|motel"]["name"](${b});
  way["tourism"~"attraction|museum|gallery"]["name"](${b});
  node["historic"]["name"](${b});
  node["leisure"="park"]["name"](${b});
  way["leisure"="park"]["name"](${b});
  node["amenity"~"restaurant|cafe|fast_food|bakery|marketplace|ferry_terminal|theatre|arts_centre"]["name"](${b});
  way["amenity"~"marketplace|ferry_terminal|theatre|arts_centre"]["name"](${b});
  node["shop"~"farm|greengrocer|food|deli"]["name"~"market",i](${b});
  way["shop"~"farm|greengrocer|food|deli"]["name"~"market",i](${b});
  node["railway"="station"]["name"](${b});
  node["amenity"="bus_station"]["name"](${b});
  node["man_made"="lighthouse"]["name"](${b});
  node["natural"="beach"]["name"](${b});
);
out center;`;
}

export function wideOverpassQuery(bbox: BBox): string {
  const b = bboxString(bbox);
  return `[out:json][timeout:90];
(
  node["waterway"="waterfall"]["name"](${b});
  node["man_made"="lighthouse"]["name"](${b});
  way["man_made"="lighthouse"]["name"](${b});
);
out center;`;
}

/* ------------------------------------------------------------------ */
/* Chunked queries (ship defect #4 hardening, 2026-10-22)              */
/*                                                                     */
/* The shipped pair above is ONE union query for the whole box: on    */
/* a cold destination it exceeded the 120 s fetch timeout, its       */
/* sibling drew HTTP 429 from overpass-api.de, and a single failed    */
/* query failed the entire collection — the destination's pack        */
/* build died and only the next hourly drain could heal it. The      */
/* collection now runs the SAME union as five category chunks,       */
/* fetched sequentially (never two heavy queries in flight against   */
/* the same public endpoint), each with the standard endpoint         */
/* rotation + bounded retries, under one overall deadline. A chunk    */
/* that still fails degrades the collection to PARTIAL — recorded    */
/* honestly in the evidence and the provenance label — instead of    */
/* killing it; only a total failure (every chunk) throws.            */
/* ------------------------------------------------------------------ */

export interface OverpassChunk {
  id: string;
  query: string;
}

export function mainOverpassQueryChunks(bbox: BBox): OverpassChunk[] {
  const b = bboxString(bbox);
  const head = "[out:json][timeout:45];\n";
  return [
    {
      id: "tourism",
      query: `${head}(
  node["tourism"~"attraction|museum|gallery|viewpoint|hotel|hostel|guest_house|apartment|motel"]["name"](${b});
  way["tourism"~"attraction|museum|gallery"]["name"](${b});
);
out center;`
    },
    {
      id: "historic-parks",
      query: `${head}(
  node["historic"]["name"](${b});
  node["leisure"="park"]["name"](${b});
  way["leisure"="park"]["name"](${b});
  node["natural"="beach"]["name"](${b});
);
out center;`
    },
    {
      id: "amenities",
      query: `${head}(
  node["amenity"~"marketplace|ferry_terminal|theatre|arts_centre"]["name"](${b});
  way["amenity"~"marketplace|ferry_terminal|theatre|arts_centre"]["name"](${b});
  node["railway"="station"]["name"](${b});
  node["amenity"="bus_station"]["name"](${b});
  node["man_made"="lighthouse"]["name"](${b});
);
out center;`
    },
    {
      id: "food",
      query: `${head}(
  node["amenity"~"restaurant|cafe|fast_food|bakery"]["name"](${b});
);
out center;`
    },
    {
      id: "markets",
      query: `${head}(
  node["shop"~"farm|greengrocer|food|deli"]["name"~"market",i](${b});
  way["shop"~"farm|greengrocer|food|deli"]["name"~"market",i](${b});
);
out center;`
    }
  ];
}

/** Overall wall-clock budget for one destination's POI collection.
 *  The pack-refresh function budget is 300 s; the collection must
 *  hand time back, so the default deadline is 210 s — chunk fetches
 *  stop starting once it passes and the collection goes partial. */
export const DEFAULT_COLLECTION_DEADLINE_MS = 210_000;

/** The shadow's wide box: ±0.38 lat / ±0.5 lon around the centre —
 *  far enough to catch the falls and lighthouses a day trip reaches. */
export function wideBBox(centre: { lat: number; lon: number }): BBox {
  return {
    minLat: centre.lat - 0.38,
    minLon: centre.lon - 0.5,
    maxLat: centre.lat + 0.38,
    maxLon: centre.lon + 0.5
  };
}

/* ------------------------------------------------------------------ */
/* Overpass fetch — endpoints × bounded rounds, jittered backoff       */
/* ------------------------------------------------------------------ */

export interface OverpassFetchResult {
  elements: OsmElement[];
  endpoint: string;
  attempts: number;
}

export async function fetchOverpass(
  fetcher: Fetcher,
  query: string,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
  random: () => number = Math.random
): Promise<OverpassFetchResult> {
  let lastErr: Error | null = null;
  let attempts = 0;
  for (let round = 0; round < policy.maxRounds; round++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      attempts += 1;
      try {
        const text = await fetchTextWithTimeout(
          fetcher,
          endpoint,
          {
            method: "POST",
            headers: { "User-Agent": COLLECTOR_USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
            body: `data=${encodeURIComponent(query)}`
          },
          policy.attemptTimeoutMs
        );
        const json = JSON.parse(text) as OverpassPayload;
        if (Array.isArray(json.elements)) return { elements: json.elements, endpoint, attempts };
        lastErr = new Error(`unexpected payload from ${endpoint}`);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
      if (round + 1 < policy.maxRounds) await sleep(jitteredBackoff(policy.backoffBaseMs, attempts, random));
    }
  }
  throw new Error(`Overpass unreachable after ${attempts} attempts: ${lastErr?.message || "unknown"}`);
}

/* ------------------------------------------------------------------ */
/* POI collection — queries -> classified, deduped candidate rows      */
/* ------------------------------------------------------------------ */

export interface PoiCollection {
  candidates: StoredCandidate[];
  /** Build provenance for the pack version: which endpoints served,
   *  how many raw elements arrived, and the query fingerprint.
   *  Completeness is part of the evidence (defect #4): a PARTIAL
   *  collection names the chunks that never arrived — the pack
   *  built from it may be missing those place kinds, and its
   *  provenance label says so. */
  evidence: {
    mainEndpoint: string;
    wideEndpoint: string;
    mainElements: number;
    wideElements: number;
    queryHash: string;
    fetchedAt: UtcInstant;
    /** True when at least one chunk failed or was never attempted
     *  (deadline) while at least one succeeded. */
    partial: boolean;
    succeededChunks: string[];
    failedChunks: string[];
  };
}

export async function collectPoiCandidates(
  fetcher: Fetcher,
  destination: DestinationDTO,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
  now: () => Date = () => new Date(),
  deadlineMs: number = DEFAULT_COLLECTION_DEADLINE_MS
): Promise<PoiCollection> {
  if (!destination.bbox) {
    throw new Error(`destination ${destination.destinationId} has no bbox — registry row is incomplete`);
  }
  const chunks: OverpassChunk[] = [
    ...mainOverpassQueryChunks(destination.bbox),
    { id: "wide", query: wideOverpassQuery(wideBBox(destination.centre)) }
  ];
  const startedAt = now().getTime();
  const elements: OsmElement[] = [];
  const succeededChunks: string[] = [];
  const failedChunks: string[] = [];
  const chunkErrors: string[] = [];
  let mainEndpoint = "";
  let wideEndpoint = "";
  let mainElements = 0;
  let wideElements = 0;

  // Sequential on purpose: the shipped pair fired two heavy queries
  // at the same public endpoint at once and drew 429s; chunk-at-a-
  // time keeps the pressure polite and lets the deadline speak.
  for (const chunk of chunks) {
    const remainingMs = deadlineMs - (now().getTime() - startedAt);
    if (remainingMs <= 0) {
      failedChunks.push(chunk.id);
      chunkErrors.push(`${chunk.id}: collection deadline (${deadlineMs} ms) reached before this chunk started`);
      continue;
    }
    const chunkPolicy: FetchPolicy = {
      ...policy,
      // Deadline-bounded ladder: ONE round over the three endpoints
      // per chunk (mirror fallback preserved; six chunks give the
      // collection more total attempts than the shipped pair ever
      // had), each attempt capped at 45 s and at a third of the
      // remaining budget — so a chunk whose attempts all hang can
      // overrun the collection deadline by one bounded tail
      // (~15 s), never by a full second ladder. Observed live
      // 2026-10-22 without this bound: a 418 s all-fail collection
      // against a 210 s deadline.
      maxRounds: 1,
      attemptTimeoutMs: Math.min(45_000, Math.max(5_000, Math.floor(remainingMs / 3))),
      // Collection politeness floor: the public endpoint's failure
      // mode is fast 429 rejections under load, and a 1.5 s backoff
      // burns all rounds inside one closed rate window. A 4 s base
      // spreads attempts so later ones can land after a window opens.
      backoffBaseMs: Math.max(policy.backoffBaseMs, 4_000)
    };
    try {
      const res = await fetchOverpass(fetcher, chunk.query, chunkPolicy);
      succeededChunks.push(chunk.id);
      elements.push(...res.elements);
      if (chunk.id === "wide") {
        wideEndpoint = res.endpoint;
        wideElements = res.elements.length;
      } else {
        if (!mainEndpoint) mainEndpoint = res.endpoint;
        mainElements += res.elements.length;
      }
    } catch (err) {
      failedChunks.push(chunk.id);
      chunkErrors.push(`${chunk.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!succeededChunks.length) {
    throw new Error(
      `Overpass collection failed for every chunk (${chunks.map((c) => c.id).join(", ")}): ${chunkErrors.join(" | ")}`
    );
  }

  const all: StoredCandidate[] = [];
  for (const e of elements) {
    const kind = classifyElement(e);
    if (kind) all.push(toStoredCandidate(e, kind));
  }
  return {
    candidates: dedupeCandidates(all),
    evidence: {
      mainEndpoint,
      wideEndpoint,
      mainElements,
      wideElements,
      queryHash: sha256Hex(
        `${PACK_QUERY_VERSION}|${chunks.map((c) => `${c.id}:${c.query}`).join("|")}`
      ).slice(0, 16),
      fetchedAt: toInstant(now()),
      partial: failedChunks.length > 0,
      succeededChunks,
      failedChunks
    }
  };
}

/* ------------------------------------------------------------------ */
/* Weather — its OWN artifact fetch (never part of a POI build)        */
/* ------------------------------------------------------------------ */

export interface WeatherFetchResult {
  days: EngineWeatherDay[];
  fetchedAt: UtcInstant;
  providerTimeZone: string | null;
}

/**
 * Fetch one weather snapshot's days from Open-Meteo. Forecast and
 * historical are different endpoints AND different artifacts; the
 * caller stamps the kind. Returns null days when the provider has
 * no daily block for the range — weather UNKNOWN, stated honestly
 * by the caller, never backfilled from another range.
 */
export async function fetchWeatherDays(
  fetcher: Fetcher,
  centre: { lat: number; lon: number },
  startIso: string,
  endIso: string,
  kind: WeatherSnapshotKind,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
  now: () => Date = () => new Date()
): Promise<WeatherFetchResult | null> {
  const base = kind === "historical" ? OPEN_METEO_ARCHIVE_URL : OPEN_METEO_FORECAST_URL;
  const url =
    `${base}?latitude=${centre.lat}&longitude=${centre.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&start_date=${startIso}&end_date=${endIso}&timezone=auto`;
  const text = await fetchTextWithTimeout(fetcher, url, { headers: { "User-Agent": COLLECTOR_USER_AGENT } }, policy.attemptTimeoutMs);
  const json = JSON.parse(text) as {
    timezone?: string;
    daily?: {
      time?: string[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
      precipitation_probability_max?: (number | null)[];
    };
  };
  const daily = json?.daily;
  if (!daily?.time) return null;
  const times = daily.time;
  const days: EngineWeatherDay[] = times.map((date, i) => ({
    date: date as EngineWeatherDay["date"],
    tMax: daily.temperature_2m_max?.[i] ?? null,
    tMin: daily.temperature_2m_min?.[i] ?? null,
    precipProb: daily.precipitation_probability_max?.[i] ?? null
  }));
  return { days, fetchedAt: toInstant(now()), providerTimeZone: json.timezone ?? null };
}

/** Provenance for a pack version built by the live collector path. */
export function liveBuildProvenance(collection: PoiCollection, builtAt: UtcInstant): ProvenanceDTO {
  const ev = collection.evidence;
  const completeness = ev.partial
    ? `; PARTIAL collection — chunks ${ev.succeededChunks.length}/${ev.succeededChunks.length + ev.failedChunks.length} arrived ` +
      `(missing: ${ev.failedChunks.join(", ")}); this pack may be missing those place kinds`
    : `; collection complete (${ev.succeededChunks.length} chunks)`;
  return {
    source: "openstreetmap-overpass",
    sourceRef: `overpass-query:${ev.queryHash}`,
    recordedAt: builtAt,
    label:
      `OpenStreetMap via Overpass API (free, ODbL) — chunked queries (${PACK_QUERY_VERSION}), ` +
      `classifier ${PACK_CLASSIFIER_VERSION}; main ${ev.mainElements} elements via ${ev.mainEndpoint || "no main endpoint"}, ` +
      `wide ${ev.wideElements} via ${ev.wideEndpoint || "no wide endpoint"}${completeness}`
  };
}
