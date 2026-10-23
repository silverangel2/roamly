import { sha256Hex, sourceKey } from "@/lib/roamly/engine/ids";
import type { DestinationDTO, ProvenanceDTO } from "@/lib/roamly/engine/types";
import type { UtcInstant } from "@/lib/roamly/engine/time";
import type { StoredCandidate } from "@/lib/roamly/engine/packs/types";
import {
  OPEN_PLACES_CLASSIFIER_VERSION,
  OPEN_PLACES_QUERY_VERSION,
  toInstant
} from "@/lib/roamly/engine/packs/types";
import {
  COLLECTOR_USER_AGENT,
  DEFAULT_FETCH_POLICY,
  type FetchPolicy,
  type Fetcher
} from "@/lib/roamly/engine/packs/collectors";

/*
 * Open Places adapter — the independent FALLBACK supply for pack
 * building (OPEN-PLACES-SPIKE.md, verdict GO conditional; owner
 * directive 2026-10-22: layer 2 of the free protection stack, "no
 * payment" — free tier only).
 *
 * The adapter is a SIBLING collector to collectPoiCandidates: same
 * destination in, same StoredCandidate[] + provenance shape out, so
 * the queue/lease/publish path, the pack schema, and every
 * downstream consumer are untouched. builder.ts's liveCollector
 * composes the ladder: the full Overpass ladder runs first; this
 * adapter runs ONLY when the OSM lane failed outright or yielded
 * zero candidates, and ONLY when OPEN_PLACES_API_KEY is present in
 * the environment. Whole-pack fallback: one source per pack
 * version, never a family-level merge of two sources.
 *
 * Why a separate dataset at all: the public Overpass mirrors are
 * the SAME data with the SAME outage correlation (on 2026-10-22 all
 * three failed together for hours). Open Places serves Overture
 * Maps data — an independent dataset behind an independent API —
 * and its terms permit storing what it returns, so a pack built
 * from it is a durable asset exactly like an OSM-built one.
 *
 * Known data gaps (spike §2/§3, measured): Overture has NO
 * viewpoint category at all and its falls yield inside pack bboxes
 * measured zero — an adapter-built pack carries explicit zeros for
 * those kinds in its provenance counts rather than hiding them.
 */

export const OPEN_PLACES_API_URL = "https://api.openplacesapi.com/v1/places";

/** Category-browse page size: the API's browse maximum. */
export const OPEN_PLACES_PAGE_LIMIT = 50;

/** Hard browse window per (category, centre, radius): the API
 *  stops paging at offset + limit = 1,000 and answers with next_
 *  offset null plus a pagination_limit_reached warning. */
export const OPEN_PLACES_BROWSE_WINDOW = 1_000;

/** Overall wall-clock budget for one destination's Open Places
 *  collection. The adapter runs AFTER the Overpass ladder inside
 *  the same build job (300 s pack-refresh function budget; the
 *  OSM collection deadline is 210 s), so its own budget is tighter:
 *  a mid-size city needs ~60 calls, a major city ~110 (spike §4),
 *  which at healthy API latencies is well under a minute. */
export const DEFAULT_OPEN_PLACES_DEADLINE_MS = 120_000;

/** Vendor-documented Retry-After for coverage_not_ready when the
 *  response carries no readable header (docs/errors, 2026-10-23). */
const COVERAGE_NOT_READY_DEFAULT_RETRY_SEC = 30;

/* ------------------------------------------------------------------ */
/* API shapes (vendor docs + live demo captures, 2026-10-22/23)         */
/* ------------------------------------------------------------------ */

export interface OpenPlacesRecord {
  /** "overture:<uuid>" — the provider's identifier, prefix included. */
  place_id: string;
  name?: string | null;
  lat?: number | null;
  lon?: number | null;
  distance_mi?: number | null;
  /** The record's PRIMARY category slug (taxonomy.primary). */
  category?: string | null;
  /** Primary + alternate category slugs. */
  categories?: string[] | null;
  /** The primary's taxonomy path, root first, primary last. */
  category_hierarchy?: string[] | null;
  website?: string | null;
  confidence?: number | null;
  operating_status?: string | null;
}

export interface OpenPlacesWarning {
  code?: string;
  message?: string;
}

export interface OpenPlacesPage {
  results?: OpenPlacesRecord[];
  meta?: {
    data_release?: string | null;
    next_offset?: number | null;
    warnings?: OpenPlacesWarning[] | null;
  } | null;
}

export type OpenPlacesErrorCode = "quota_exhausted" | "coverage_not_ready" | "deadline" | "provider";

export class OpenPlacesError extends Error {
  readonly code: OpenPlacesErrorCode;
  readonly status: number | null;
  constructor(code: OpenPlacesErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "OpenPlacesError";
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Classification — classifyOvertureRecord                             */
/*                                                                     */
/* First-match precedence mirroring classifyElement (collectors.ts): */
/* market -> falls -> lighthouse -> museum -> gallery -> attraction  */
/* -> stay -> park -> ferry -> station -> venue -> food -> historic, */
/* with two documented deviations the Overture taxonomy forces:      */
/*   - the generic `attraction` kind has no Overture counterpart;    */
/*     it is assembled from explicit attraction primaries (at the    */
/*     OSM attraction position) PLUS a catch-all for records whose   */
/*     primary path is rooted in arts_and_entertainment and that no  */
/*     earlier kind claimed — that catch-all sits AFTER venue, so    */
/*     theatres/cinemas keep their venue kind.                       */
/*   - `historic` requires PRIMARY-path membership (category or its  */
/*     own hierarchy): an alternate-only historic membership never   */
/*     classifies a record as historic (spike §5 — Overture's        */
/*     historic_site is noisy; a restaurant with a historic          */
/*     alternate is a restaurant).                                   */
/* Membership is keyed on the record's full category membership      */
/* (category + categories[] + category_hierarchy[]) except where    */
/* the historic rule restricts it to the primary path. A record      */
/* whose taxonomy is entirely absent classifies as null — absent,    */
/* never guessed (spike §3: null-taxonomy records are real).         */
/* ------------------------------------------------------------------ */

const MARKET_SLUGS: readonly string[] = ["farmers_market", "market"];
const FALLS_SLUGS: readonly string[] = ["waterfall"];
const LIGHTHOUSE_SLUGS: readonly string[] = ["lighthouse"];
const MUSEUM_SLUGS: readonly string[] = ["museum"];
const GALLERY_SLUGS: readonly string[] = ["art_gallery"];
const ATTRACTION_PRIMARY_SLUGS: readonly string[] = [
  "amusement_attraction",
  "amusement_park",
  "aquarium",
  "science_attraction",
  "stadium_arena",
  "zoo"
];
const STAY_SLUGS: readonly string[] = [
  "hotel",
  "lodging",
  "bed_and_breakfast",
  "private_lodging",
  "inn",
  "resort",
  "campground",
  "hostel",
  "guest_house",
  "motel"
];
const PARK_SLUGS: readonly string[] = [
  "park",
  "national_park",
  "dog_park",
  "garden",
  "beach",
  "nature_reserve",
  "state_park",
  "provincial_park"
];
const FERRY_SLUGS: readonly string[] = ["ferry_service"];
const STATION_SLUGS: readonly string[] = ["train_station", "public_transit_facility_or_service"];
const VENUE_SLUGS: readonly string[] = [
  "theatre_venue",
  "movie_theater",
  "performing_arts_venue",
  "cultural_center",
  "music_venue"
];
const FOOD_SLUGS: readonly string[] = ["restaurant", "casual_eatery", "cafe", "coffee_shop", "fast_food_restaurant"];
const BAKERY_SLUGS: readonly string[] = ["bakery"];
const HISTORIC_SLUGS: readonly string[] = ["historic_site", "monument", "castle", "fort"];

/** The 14 collector kinds, in provenance-count order. viewpoint is
 *  carried explicitly: Overture has no such category, so its count
 *  is an honest zero on every adapter-built pack. */
export const OPEN_PLACES_KINDS: readonly string[] = [
  "market",
  "falls",
  "lighthouse",
  "museum",
  "gallery",
  "attraction",
  "viewpoint",
  "stay",
  "park",
  "ferry",
  "station",
  "venue",
  "food",
  "historic"
];

export function classifyOvertureRecord(rec: OpenPlacesRecord): string | null {
  if (!rec.name) return null;
  const primaryPath: string[] = [];
  if (typeof rec.category === "string" && rec.category) primaryPath.push(rec.category);
  for (const slug of rec.category_hierarchy || []) {
    if (typeof slug === "string" && slug && !primaryPath.includes(slug)) primaryPath.push(slug);
  }
  const full = new Set<string>(primaryPath);
  for (const slug of rec.categories || []) {
    if (typeof slug === "string" && slug) full.add(slug);
  }
  if (primaryPath.length === 0 && full.size === 0) return null; // no taxonomy at all — absent, never guessed
  const inFull = (slugs: readonly string[]): boolean => slugs.some((s) => full.has(s));
  const inPath = (slugs: readonly string[]): boolean => slugs.some((s) => primaryPath.includes(s));
  if (inFull(MARKET_SLUGS)) return "market";
  if (inFull(FALLS_SLUGS)) return "falls";
  if (inFull(LIGHTHOUSE_SLUGS)) return "lighthouse";
  if (inFull(MUSEUM_SLUGS)) return "museum";
  if (inFull(GALLERY_SLUGS)) return "gallery";
  if (inFull(ATTRACTION_PRIMARY_SLUGS)) return "attraction";
  if (inFull(STAY_SLUGS)) return "stay";
  if (inFull(PARK_SLUGS)) return "park";
  if (inFull(FERRY_SLUGS)) return "ferry";
  if (inFull(STATION_SLUGS)) return "station";
  if (inFull(VENUE_SLUGS)) return "venue";
  // Attraction catch-all: the primary's own path is rooted in the
  // generic arts_and_entertainment bucket and nothing above claimed
  // the record (the dataset files cinemas, escape rooms, generic
  // attractions there with no finer category).
  if (primaryPath[0] === "arts_and_entertainment" || rec.category_hierarchy?.[0] === "arts_and_entertainment") {
    return "attraction";
  }
  if (inFull(FOOD_SLUGS) || inPath(BAKERY_SLUGS)) return "food";
  if (inPath(HISTORIC_SLUGS)) return "historic";
  return null;
}

/** One API record -> the stored row shape. The place reference is
 *  the row's URL when the place has no website of its own: the
 *  verbatim API place_id ("overture:<uuid>") — visibly a reference,
 *  never an empty string and never a fabricated web link. */
export function toOpenPlacesCandidate(rec: OpenPlacesRecord, kind: string): StoredCandidate {
  const placeId = typeof rec.place_id === "string" ? rec.place_id : "";
  const sourceId = placeId.replace(/^overture:/, "");
  const tags: Record<string, string> = {};
  if (typeof rec.category === "string" && rec.category) tags.category = rec.category;
  if (typeof rec.confidence === "number") tags.confidence = String(rec.confidence);
  if (typeof rec.website === "string" && rec.website) tags.website = rec.website;
  return {
    candidateKey: sourceKey("overture", sourceId),
    osmKey: sourceId,
    kind,
    name: rec.name as string,
    nameEn: null,
    pos: typeof rec.lat === "number" && typeof rec.lon === "number" ? { lat: rec.lat, lon: rec.lon } : null,
    hoursRaw: null, // the API returns no opening hours — Google's Phase 4 finalist role is untouched
    tags,
    url: typeof rec.website === "string" && rec.website ? rec.website : placeId,
    enrichment: null
  };
}

function dedupeCandidates(list: StoredCandidate[]): { kept: StoredCandidate[]; dropped: number } {
  const seen = new Set<string>();
  const out: StoredCandidate[] = [];
  let dropped = 0;
  for (const c of list) {
    const k = `${c.name.toLowerCase()}|${c.kind}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    } else {
      dropped += 1;
    }
  }
  return { kept: out, dropped };
}

/* ------------------------------------------------------------------ */
/* Browse plan (spike §4)                                              */
/*                                                                     */
/* One browse root per family group; each root's subtree is paged   */
/* at the browse maximum (50/page, follow meta.next_offset) and     */
/* classified client-side — the dump-then-classify shape the OSM    */
/* collector already uses. Food browses child slugs rather than the */
/* food_and_drink root so the 1,000-result window binds per slug,   */
/* not once for the whole family.                                   */
/*                                                                     */
/* min_confidence is deliberately NOT sent. The spike's quality     */
/* readings (§3/§5) show the floor is a volume knob, not a purity    */
/* fix — the worst historic offenders (a condo, a retirement        */
/* residence classed historic_site) sit at confidence 1.0, while    */
/* the thin families this lane exists to rescue (ferry, station,    */
/* lighthouse) can least afford to lose low-confidence records.     */
/* Volume is already bounded by the per-root window, the bbox       */
/* post-filter, and name+kind dedupe; quality stays the job of      */
/* final validation and the judges, exactly as on the OSM lane.     */
/* ------------------------------------------------------------------ */

export const OPEN_PLACES_BROWSE_ROOTS: readonly string[] = [
  "arts_and_entertainment",
  "cultural_and_historic",
  "restaurant",
  "cafe",
  "coffee_shop",
  "casual_eatery",
  "fast_food_restaurant",
  "bakery",
  "lodging",
  "park",
  "beach",
  "travel_and_transportation",
  "farmers_market",
  "market",
  "lighthouse",
  "waterfall"
];

function haversineMi(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const p = Math.PI / 180;
  const h =
    0.5 -
    Math.cos((b.lat - a.lat) * p) / 2 +
    (Math.cos(a.lat * p) * Math.cos(b.lat * p) * (1 - Math.cos((b.lon - a.lon) * p))) / 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** Circle radius covering the whole pack bbox: ceil of the bbox
 *  half-diagonal in miles from the destination centre (the API
 *  searches circles only — the adapter post-filters returned
 *  points back to the exact bbox). Clamped to the API's 1..50. */
export function openPlacesRadiusMi(
  centre: { lat: number; lon: number },
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number }
): number {
  const corner = Math.max(
    haversineMi(centre, { lat: bbox.maxLat, lon: bbox.maxLon }),
    haversineMi(centre, { lat: bbox.minLat, lon: bbox.minLon }),
    haversineMi(centre, { lat: bbox.maxLat, lon: bbox.minLon }),
    haversineMi(centre, { lat: bbox.minLat, lon: bbox.maxLon })
  );
  return Math.min(50, Math.max(1, Math.ceil(corner)));
}

/* ------------------------------------------------------------------ */
/* Page fetch — the vendor's error contract (docs/errors)              */
/*                                                                     */
/*   402 quota_exhausted: hard cap, NEVER retried here — it aborts   */
/*     the collection as a provider failure so the job waits        */
/*     exactly as it does on an Overpass failure.                    */
/*   503 coverage_not_ready: retryable — ONE retry after the         */
/*     response's Retry-After (header when the fetcher exposes it,  */
/*     else the vendor-documented 30 s), and only when that wait     */
/*     fits inside the collection deadline. A second answer aborts.  */
/*   anything else non-OK: provider failure, no silent partials.     */
/* ------------------------------------------------------------------ */

function retryAfterSeconds(res: unknown, fallback: number | null): number | null {
  const headers = (res as { headers?: { get?: (name: string) => string | null } } | null)?.headers;
  const raw = typeof headers?.get === "function" ? headers.get("retry-after") : null;
  const parsed = raw != null ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function fetchPageOnce(
  fetcher: Fetcher,
  url: string,
  apiKey: string,
  timeoutMs: number
): Promise<{ page: OpenPlacesPage | null; errorCode: string | null; status: number; retryAfterSec: number | null; raw: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, {
      method: "GET",
      headers: { "User-Agent": COLLECTOR_USER_AGENT, Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    const text = await res.text();
    if (res.ok) {
      try {
        return { page: JSON.parse(text) as OpenPlacesPage, errorCode: null, status: res.status, retryAfterSec: null, raw: text };
      } catch {
        throw new OpenPlacesError("provider", `Open Places returned an unparseable page (HTTP ${res.status})`, res.status);
      }
    }
    let code: string | null = null;
    try {
      const parsed = JSON.parse(text) as { error?: { code?: string } };
      code = parsed?.error?.code ?? null;
    } catch {
      code = null;
    }
    return {
      page: null,
      errorCode: code,
      status: res.status,
      retryAfterSec: retryAfterSeconds(res, code === "coverage_not_ready" ? COVERAGE_NOT_READY_DEFAULT_RETRY_SEC : null),
      raw: text
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Collection                                                          */
/* ------------------------------------------------------------------ */

export interface OpenPlacesOptions {
  /** Overall collection deadline (see DEFAULT_OPEN_PLACES_DEADLINE_MS). */
  deadlineMs?: number;
  /** Injectable sleep (proofs drive the coverage retry without waiting). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (fetchedAt + deadline), defaults to real time. */
  now?: () => Date;
  /** API base override (defaults to the production endpoint). */
  baseUrl?: string;
}

export interface OpenPlacesEvidence {
  endpoint: string;
  /** meta.data_release of the pages served (null when never seen). */
  dataRelease: string | null;
  browseRoots: readonly string[];
  radiusMi: number;
  /** HTTP searches issued, retries included — the quota currency. */
  callsUsed: number;
  pagesFetched: number;
  /** Unique place_ids received across all browses. */
  recordsReceived: number;
  /** Received records the bbox post-filter discarded (the circle
   *  overshoots the bbox corners by ~50% extra area). */
  droppedOutOfBbox: number;
  /** In-bbox records no kind claimed (incl. null-taxonomy records). */
  unclassified: number;
  dedupedNameKind: number;
  /** Per-kind candidate counts — ALL 14 kinds, zeros explicit. */
  byKind: Record<string, number>;
  /** Roots whose browse window closed early (pagination_limit_
   *  reached): the pack is PARTIAL in those families, named here. */
  truncatedRoots: string[];
  /** Roots the API no longer knows (unknown_category warning):
   *  taxonomy drift, flagged — the root contributed nothing. */
  unknownCategoryRoots: string[];
  /** coverage_not_ready answers that were retried (and recovered). */
  coverageRetries: number;
  queryHash: string;
  fetchedAt: UtcInstant;
  partial: boolean;
}

export interface OpenPlacesCollection {
  candidates: StoredCandidate[];
  evidence: OpenPlacesEvidence;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function collectPoiCandidatesFromOpenPlaces(
  fetcher: Fetcher,
  destination: DestinationDTO,
  policy: FetchPolicy = DEFAULT_FETCH_POLICY,
  apiKey: string,
  options: OpenPlacesOptions = {}
): Promise<OpenPlacesCollection> {
  if (!destination.bbox) {
    throw new Error(`destination ${destination.destinationId} has no bbox — registry row is incomplete`);
  }
  if (!apiKey) {
    throw new OpenPlacesError("provider", "Open Places collection called without an API key");
  }
  const bbox = destination.bbox;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const deadlineMs = options.deadlineMs ?? DEFAULT_OPEN_PLACES_DEADLINE_MS;
  const baseUrl = options.baseUrl ?? OPEN_PLACES_API_URL;
  const radiusMi = openPlacesRadiusMi(destination.centre, bbox);
  const startedAt = now().getTime();
  const remainingMs = (): number => deadlineMs - (now().getTime() - startedAt);

  const queryHash = sha256Hex(
    `${OPEN_PLACES_QUERY_VERSION}|${OPEN_PLACES_CLASSIFIER_VERSION}|radius:${radiusMi}|${OPEN_PLACES_BROWSE_ROOTS.join(",")}`
  ).slice(0, 16);

  const records: OpenPlacesRecord[] = [];
  const seenIds = new Set<string>();
  const truncatedRoots: string[] = [];
  const unknownCategoryRoots: string[] = [];
  let dataRelease: string | null = null;
  let callsUsed = 0;
  let pagesFetched = 0;
  let coverageRetries = 0;

  const fetchBrowsePage = async (root: string, offset: number): Promise<OpenPlacesPage> => {
    const params = new URLSearchParams({
      category: root,
      lat: String(destination.centre.lat),
      lon: String(destination.centre.lon),
      radius_mi: String(radiusMi),
      limit: String(OPEN_PLACES_PAGE_LIMIT),
      offset: String(offset),
      sort: "relevance"
    });
    const url = `${baseUrl}?${params.toString()}`;
    let retried = false;
    for (;;) {
      const remaining = remainingMs();
      if (remaining <= 0) {
        throw new OpenPlacesError(
          "deadline",
          `Open Places collection deadline (${deadlineMs} ms) reached before ${root} page at offset ${offset} started`
        );
      }
      callsUsed += 1;
      const outcome = await fetchPageOnce(fetcher, url, apiKey, Math.min(policy.attemptTimeoutMs, remaining));
      if (outcome.page) {
        if (retried) coverageRetries += 1;
        return outcome.page;
      }
      if (outcome.status === 402 || outcome.errorCode === "quota_exhausted") {
        throw new OpenPlacesError(
          "quota_exhausted",
          `Open Places quota exhausted (HTTP 402) during ${root} browse at offset ${offset}: ${outcome.raw.slice(0, 160)}`,
          402
        );
      }
      if (outcome.errorCode === "coverage_not_ready" && !retried) {
        const waitSec = outcome.retryAfterSec ?? COVERAGE_NOT_READY_DEFAULT_RETRY_SEC;
        // One Retry-After-compliant retry — only when the wait fits
        // inside the deadline; otherwise the coverage gap aborts the
        // collection as the provider failure it is.
        if (waitSec * 1000 < remainingMs()) {
          await sleep(waitSec * 1000);
          retried = true;
          continue;
        }
      }
      if (outcome.errorCode === "coverage_not_ready") {
        throw new OpenPlacesError(
          "coverage_not_ready",
          `Open Places coverage not ready for ${root} at offset ${offset} (HTTP 503, retried: ${retried})`,
          503
        );
      }
      throw new OpenPlacesError(
        "provider",
        `Open Places browse failed for ${root} at offset ${offset}: HTTP ${outcome.status}${outcome.errorCode ? ` (${outcome.errorCode})` : ""}: ${outcome.raw.slice(0, 160)}`,
        outcome.status
      );
    }
  };

  for (const root of OPEN_PLACES_BROWSE_ROOTS) {
    let offset = 0;
    for (;;) {
      const page = await fetchBrowsePage(root, offset);
      pagesFetched += 1;
      if (page.meta?.data_release) dataRelease = page.meta.data_release;
      for (const warning of page.meta?.warnings || []) {
        if (warning?.code === "pagination_limit_reached" && !truncatedRoots.includes(root)) truncatedRoots.push(root);
        if (warning?.code === "unknown_category" && !unknownCategoryRoots.includes(root)) unknownCategoryRoots.push(root);
      }
      const results = Array.isArray(page.results) ? page.results : [];
      for (const rec of results) {
        if (!rec || typeof rec.place_id !== "string" || !rec.place_id) continue;
        if (seenIds.has(rec.place_id)) continue;
        seenIds.add(rec.place_id);
        records.push(rec);
      }
      const next = page.meta?.next_offset;
      if (next == null) break;
      if (typeof next !== "number" || next <= offset || next > OPEN_PLACES_BROWSE_WINDOW - OPEN_PLACES_PAGE_LIMIT) {
        // A next_offset that cannot be followed inside the API's
        // own window: the browse is truncated, named as such —
        // never silently looped or silently dropped.
        if (!truncatedRoots.includes(root)) truncatedRoots.push(root);
        break;
      }
      offset = next;
    }
  }

  let droppedOutOfBbox = 0;
  let unclassified = 0;
  const classified: StoredCandidate[] = [];
  for (const rec of records) {
    if (
      typeof rec.lat !== "number" ||
      typeof rec.lon !== "number" ||
      rec.lat < bbox.minLat ||
      rec.lat > bbox.maxLat ||
      rec.lon < bbox.minLon ||
      rec.lon > bbox.maxLon
    ) {
      droppedOutOfBbox += 1;
      continue;
    }
    const kind = classifyOvertureRecord(rec);
    if (!kind) {
      unclassified += 1;
      continue;
    }
    classified.push(toOpenPlacesCandidate(rec, kind));
  }
  const { kept, dropped } = dedupeCandidates(classified);
  const byKind: Record<string, number> = {};
  for (const kind of OPEN_PLACES_KINDS) byKind[kind] = 0;
  for (const c of kept) byKind[c.kind] = (byKind[c.kind] || 0) + 1;

  return {
    candidates: kept,
    evidence: {
      endpoint: baseUrl,
      dataRelease,
      browseRoots: OPEN_PLACES_BROWSE_ROOTS,
      radiusMi,
      callsUsed,
      pagesFetched,
      recordsReceived: records.length,
      droppedOutOfBbox,
      unclassified,
      dedupedNameKind: dropped,
      byKind,
      truncatedRoots,
      unknownCategoryRoots,
      coverageRetries,
      queryHash,
      fetchedAt: toInstant(now()),
      partial: truncatedRoots.length > 0
    }
  };
}

/** Provenance for a pack version built by the Open Places lane.
 *  Source "overture-open-places"; the label carries the classifier
 *  + browse-plan versions and the per-kind counts (zeros explicit)
 *  so a thin fallback pack is honest on its face — the pattern the
 *  OSM lane established for partial collections. */
export function openPlacesBuildProvenance(collection: OpenPlacesCollection, builtAt: UtcInstant): ProvenanceDTO {
  const ev = collection.evidence;
  const counts = OPEN_PLACES_KINDS.map((k) => `${k} ${ev.byKind[k] ?? 0}`).join(", ");
  const notes: string[] = [];
  if (ev.partial) notes.push(`PARTIAL — browse window truncated for: ${ev.truncatedRoots.join(", ")}; those families may be incomplete`);
  if (ev.unknownCategoryRoots.length) notes.push(`unknown-category roots (taxonomy drift): ${ev.unknownCategoryRoots.join(", ")}`);
  if (ev.coverageRetries > 0) notes.push(`coverage_not_ready recovered after ${ev.coverageRetries} retr${ev.coverageRetries === 1 ? "y" : "ies"}`);
  return {
    source: "overture-open-places",
    sourceRef: `open-places:${ev.dataRelease ?? "unknown-release"}:${ev.queryHash}`,
    recordedAt: builtAt,
    label:
      `Overture Maps via Open Places API (free tier) — browse plan (${OPEN_PLACES_QUERY_VERSION}), ` +
      `classifier ${OPEN_PLACES_CLASSIFIER_VERSION}; data release ${ev.dataRelease ?? "unknown"}; ` +
      `${ev.callsUsed} calls, ${ev.recordsReceived} records, ${collection.candidates.length} candidates (${counts})` +
      (notes.length ? `; ${notes.join("; ")}` : "")
  };
}
