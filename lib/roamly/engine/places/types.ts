/*
 * Google Places provider — shared types + policy constants
 * (DESIGN-PRODUCTION.md §2.5, Phase 4; CONTRACTS.md "GOOGLE
 * ENRICHMENT — match gate + cost guard contract").
 *
 * Pattern B (owner-ruled): production calls Places API (New) with
 * its OWN server-side key (GOOGLE_PLACES_API_KEY, owner-pasted into
 * Vercel). The custom.google-places Muse connector is agent-side
 * tooling only — it is never a dependency of this code, and its key
 * is never shared into the app.
 *
 * Preserved shadow semantics (zero-engine google-enrich.mjs /
 * google-ledger.mjs, proven live 2026-10-21): finalists only; exact
 * field masks; Text Search with a 2 km location bias; the first hit
 * is accepted only within 2 km of the candidate's OSM position,
 * rejections are kept as provenance; regular hours preferred over
 * current hours; price is a BAND (priceLevel), never a price;
 * Google-derived fields refresh on a 30-day discipline (Place IDs
 * are retainable indefinitely).
 */

/** Field mask for Text Search — verbatim from the shadow collector
 *  (google-enrich.mjs): id + displayName for identity, location for
 *  the distance gate. Nothing else is ever requested. */
export const PLACES_TEXT_SEARCH_FIELD_MASK = "places.id,places.displayName,places.location";

/** Field mask for Place Details (the Pro mask the engine consumes) —
 *  verbatim from the shadow collector's FIELD_MASK_DETAILS. */
export const PLACES_DETAILS_FIELD_MASK =
  "id,displayName,regularOpeningHours,currentOpeningHours,priceLevel,rating,userRatingCount,accessibilityOptions,businessStatus";

/** The distance gate (CONTRACTS.md): a search hit farther than this
 *  from the candidate's known OSM position is REJECTED — another
 *  business's hours are never attached to a plan item. */
export const MATCH_GATE_KM = 2;

/** Text Search result cap — verbatim from the shadow collector. */
export const PLACES_SEARCH_MAX_RESULTS = 3;

/** Google-derived records younger than this are reused, never
 *  re-called (cache-first is mandatory; also Google's ~30-day
 *  content-caching discipline — Place IDs excepted). */
export const ENRICHMENT_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Cost guard (owner condition: "make sure minimal expenses")          */
/* ------------------------------------------------------------------ */

export type PlacesSku = "textSearch" | "placeDetails";

/** A per-SKU number pair (caps, prices, allotments, call counts —
 *  the shape recurs; the aliases below name each use). */
export interface PlacesSkuCounts {
  textSearch: number;
  placeDetails: number;
}

export type PlacesCaps = PlacesSkuCounts;

/** Monthly caps, deliberately INSIDE the free allotments so a
 *  guarded month bills $0 by construction (CONTRACTS.md defaults;
 *  overridable only by env — see ledger.ts capsFromEnv). */
export const PLACES_DEFAULT_CAPS: PlacesSkuCounts = { textSearch: 9_000, placeDetails: 4_500 };

/** The monthly free allotments the caps sit inside (CONTRACTS.md):
 *  Text Search Essentials 10,000/month; Place Details Pro
 *  5,000/month. */
export const PLACES_FREE_ALLOTMENT_PER_MONTH: PlacesSkuCounts = { textSearch: 10_000, placeDetails: 5_000 };

/** Published list prices, USD per 1,000 calls (Google's pricing
 *  table as verified in the 2026-10-21 live proof): Text Search
 *  (Essentials mask) $5; Place Details (Pro mask) $17. */
export const PLACES_LIST_PRICES_USD_PER_1000: PlacesSkuCounts = { textSearch: 5, placeDetails: 17 };

/* ------------------------------------------------------------------ */
/* Places API (New) wire shapes — only the fields the engine consumes  */
/* ------------------------------------------------------------------ */

export interface PlacesTextSearchRequest {
  textQuery: string;
  maxResultCount: number;
  locationBias: {
    circle: {
      center: { latitude: number; longitude: number };
      radius: number; // metres — MATCH_GATE_KM * 1000
    };
  };
}

export interface PlacesRawPlace {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  location?: { latitude: number; longitude: number };
  formattedAddress?: string;
}

export interface PlacesTextSearchResponse {
  places?: PlacesRawPlace[];
}

export interface PlacesRawPeriodPoint {
  day?: number; // 0 = Sunday .. 6 = Saturday (Google's convention)
  hour?: number;
  minute?: number;
}

export interface PlacesRawPeriod {
  open?: PlacesRawPeriodPoint;
  close?: PlacesRawPeriodPoint;
}

export interface PlacesRawOpeningHours {
  periods?: PlacesRawPeriod[];
  weekdayDescriptions?: string[];
}

export interface PlacesRawDetails {
  id?: string;
  displayName?: { text?: string; languageCode?: string };
  regularOpeningHours?: PlacesRawOpeningHours;
  currentOpeningHours?: PlacesRawOpeningHours;
  priceLevel?: string;
  rating?: number;
  userRatingCount?: number;
  accessibilityOptions?: { wheelchairAccessibleEntrance?: boolean };
  businessStatus?: string;
}

/* ------------------------------------------------------------------ */
/* The match verdict (the distance gate's output)                      */
/* ------------------------------------------------------------------ */

export type MatchRejectionReason =
  | "no-results" // the search returned no usable hit at all
  | "no-location-returned" // the hit carries no location — unverifiable is not attachable
  | "candidate-position-unknown" // the candidate itself has no OSM position to verify against
  | "distance-gate"; // the hit is a different business, too far away

export interface MatchRejection {
  reason: MatchRejectionReason;
  matchedName: string | null;
  placeId: string | null;
  distanceKm: number | null;
  thresholdKm: number;
}

export type MatchVerdict =
  | { matched: true; placeId: string; matchedName: string | null; distanceKm: number }
  | { matched: false; rejection: MatchRejection };
