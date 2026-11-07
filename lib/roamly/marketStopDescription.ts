// lib/roamly/marketStopDescription.ts — honest one-line text for
// market-grounded timeline stops (description-boilerplate fix,
// 2026-11-07).
//
// THE DEFECT: the staged pipeline's grounding writers
// (stagedItineraryGeneration.rehydrateGroundedTimelineItem and
// itineraryIntelligence.applyMarketIdentity) replaced every
// market-grounded stop's description with one canned caution
// paragraph — "Search-backed result. Confirm current hours, route,
// availability, and price before relying on it." — so a whole
// itinerary read as the same warning repeated stop after stop
// (owner screenshot, Montreal trip 1bcb0c8b, 2026-11-07).
//
// WHY A COMPOSER, NOT A LOOKUP: a market candidate
// (TravelMarketResult) is a commerce search result. It carries NO
// place facts — no address, no summary, no hours — so there is no
// real description to restore. The only honest per-stop text is
// composed from the facts that DO exist: the candidate's category,
// its city, and its provenance. That composition lives here, once,
// shared by the generation writers (which stamp new itineraries)
// and by the display layer (activityDescription.ts flattens the
// legacy stored strings into these same lines, so old trips heal
// on screen with no regeneration). One vocabulary, both sides.
//
// The full caution is NOT deleted — it is demoted: it renders once
// per itinerary (SEARCH_RESULT_CAUTION, shown by the itinerary
// home panel when any stop is search-backed) and each stop carries
// a small provenance chip instead of the paragraph.
//
// Pure functions: no I/O, no mutation.

/** Where a market-grounded stop's identity actually came from:
 *  "verified" = a verified/native partner listing; "search" = a
 *  live search result (nothing about it is confirmed); "pack" =
 *  Roamly's own destination-pack inventory, converted to candidate
 *  shape by the KF-1 fallback (timelineGrounding.ts). */
export type MarketStopProvenance = "verified" | "search" | "pack";

/** The two canned paragraphs the old writers stamped verbatim.
 *  Kept as named constants so the display layer can recognise the
 *  exact legacy strings in stored itineraries and flatten them.
 *  Never write these as a description again. */
export const LEGACY_SEARCH_BOILERPLATE =
  "Search-backed result. Confirm current hours, route, availability, and price before relying on it.";
export const LEGACY_VERIFIED_BOILERPLATE =
  "Verified source result. Confirm current hours, route, and price before relying on it.";

/** The fallback tail applyMarketIdentity appended when the item
 *  had no description of its own ("Search-backed result. Confirm
 *  current hours, route, and price before going."). */
const LEGACY_PREFIX_FALLBACK_TAIL = "Confirm current hours, route, and price before going.";

const LEGACY_PREFIX = /^(Search-backed result|Verified source result)\.\s+/;

/** The full caution, demoted to itinerary level: rendered ONCE by
 *  the itinerary home panel when the trip carries any search-backed
 *  stop — never as a stop's own description. */
export const SEARCH_RESULT_CAUTION =
  "Some stops come from live search results. Confirm current hours, route, availability, and price before relying on them.";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** If `value` is exactly one of the legacy canned paragraphs,
 *  return the provenance it was stamped with; otherwise null. */
export function legacyMarketBoilerplateProvenance(
  value: string | null | undefined
): MarketStopProvenance | null {
  const text = clean(value);
  if (text === LEGACY_SEARCH_BOILERPLATE) return "search";
  if (text === LEGACY_VERIFIED_BOILERPLATE) return "verified";
  return null;
}

/** Remove a legacy provenance stamp from a stored description.
 *  - An exact canned paragraph carries no stop text at all -> "".
 *  - A prefix form ("Search-backed result. <real text>") keeps the
 *    real text, stamp removed.
 *  - The prefix + fallback-tail form was the stamp standing in for
 *    a missing description -> "".
 *  Anything else passes through unchanged. */
export function stripLegacyMarketStamp(value: string | null | undefined): string {
  const text = clean(value);
  if (!text) return "";
  if (legacyMarketBoilerplateProvenance(text)) return "";
  const match = text.match(LEGACY_PREFIX);
  if (!match) return text;
  const rest = text.slice(match[0].length).trim();
  if (!rest || rest === LEGACY_PREFIX_FALLBACK_TAIL) return "";
  return rest;
}

/** A hotel candidate whose title names no property — a generic
 *  search result bound as if it were a stay ("Stay in Montreal
 *  city center hotel", "Hotels in Montreal", "Montreal hotel
 *  search"). Such a stop is a placeholder, and its text must say
 *  so instead of dressing it as a property. */
export function isGenericStayTitle(value: string | null | undefined): boolean {
  const title = clean(value).toLowerCase();
  if (!title) return true;
  return (
    /^stay in\b/.test(title) ||
    /^hotels?\s+(in|near)\b/.test(title) ||
    /^hotels?$/.test(title) ||
    /\bhotel search\b/.test(title) ||
    /\bhotel\/stay\b/.test(title) ||
    /\bfind hotels?\b/.test(title) ||
    /\b(city center|city centre|downtown)\s+hotels?$/.test(title)
  );
}

/** Display label for a stop's kind, from the market category when
 *  there is one, else the timeline item type. Only ever a word for
 *  what the stop IS — never a fact about the place. */
export function marketStopCategoryLabel(
  category?: string | null,
  itemType?: string | null
): string {
  const c = clean(category).toLowerCase();
  if (/\btours?\b/.test(c) || c === "tour") return "Tour";
  if (/restaurant|food|meal|dining/.test(c)) return "Restaurant";
  if (/hotel|lodging|accommodation/.test(c) || c.includes("stay")) return "Hotel";
  if (/flight/.test(c)) return "Flight";
  if (/attraction|sight|museum|landmark/.test(c)) return "Attraction";
  if (/transport/.test(c)) return "Transport";
  const t = clean(itemType).toLowerCase();
  if (t === "meal") return "Restaurant";
  if (t === "hotel") return "Hotel";
  if (t === "travel") return "Travel";
  if (t === "transfer") return "Transport";
  if (t === "activity") return "Activity";
  if (t === "booking") return "Booking";
  return "Place";
}

export type MarketStopOneLinerInput = {
  /** Market category (candidate.category) or the stored category. */
  category?: string | null;
  /** Timeline item type ("travel" | "hotel" | "meal" | ...). */
  itemType?: string | null;
  /** The city the candidate carries (candidate.city / destination,
   *  or the stored location_name for market rows). */
  city?: string | null;
  /** Travel-leg origin (candidate.origin / stored origin), when known. */
  origin?: string | null;
  provenance: MarketStopProvenance;
  /** True when a hotel stop names no property (isGenericStayTitle). */
  genericStay?: boolean;
};

/** The one honest line a market-grounded stop can carry, composed
 *  ONLY from facts the candidate actually holds: what kind of stop
 *  it is, which city, and where the result came from. No address,
 *  no hours, no summary is ever invented here — when Roamly knows
 *  nothing about a place, the line says the stop is a search
 *  result, in plain words, once. */
export function marketStopOneLiner(input: MarketStopOneLinerInput): string {
  const label = marketStopCategoryLabel(input.category, input.itemType);
  const city = clean(input.city);
  const origin = clean(input.origin);
  const cityPart = city ? ` · ${city}` : "";

  if (input.genericStay && label === "Hotel") {
    return `Hotel — not chosen yet${cityPart}.`;
  }

  const isTravelKind = label === "Flight" || label === "Transport" || label === "Travel";
  const routePart = origin && city && origin.toLowerCase() !== city.toLowerCase()
    ? ` · ${origin} to ${city}`
    : cityPart;

  if (input.provenance === "pack") {
    if (label === "Hotel") return `Hotel${cityPart} — from Roamly's destination pack, not a booked stay.`;
    if (isTravelKind) return `${label}${routePart} — from Roamly's destination pack.`;
    return `${label}${cityPart} — from Roamly's destination pack.`;
  }

  if (input.provenance === "verified") {
    if (label === "Hotel") return `Hotel${cityPart} — from a verified source, not a booked stay.`;
    if (isTravelKind) {
      return origin && city
        ? `${label}${routePart} — from a verified source, not a booked ticket.`
        : `${label}${cityPart} — from a verified source.`;
    }
    return `${label}${cityPart} — from a verified source.`;
  }

  // provenance "search": a live search result, nothing confirmed.
  if (label === "Restaurant") {
    return `Restaurant${cityPart} — found by live search, hours and price not confirmed.`;
  }
  if (label === "Hotel") {
    return `Hotel${cityPart} — a live search result, not a booked stay.`;
  }
  if (isTravelKind) {
    return `${label}${routePart} — a live search result, times and price not confirmed.`;
  }
  return `${label}${cityPart} — a live search result, not a confirmed place.`;
}

/** Market sources whose rows are commerce/search bindings (the
 *  staged lane's candidate sources). Pack-engine rows carry other
 *  sources ("openstreetmap") or none, and must NOT be re-labelled
 *  as market rows — that is what keeps pack-lane itineraries
 *  rendering exactly as before. */
const MARKET_SOURCES: ReadonlySet<string> = new Set([
  "travelpayouts",
  "stay22",
  "booking_demand",
  "klook",
  "public_web",
  "fallback_estimate"
]);

/** Provenance of a STORED timeline row, from the fields the row
 *  itself carries (source + factualStatus). Returns null for rows
 *  that are not market bindings at all (engine/pack rows, model
 *  rows, discovery suggestions, confirmed bookings). */
export function marketProvenanceForStoredItem(
  source?: string | null,
  factualStatus?: string | null
): MarketStopProvenance | null {
  const s = clean(source).toLowerCase();
  if (s === "roamly_internal") return "pack";
  if (!MARKET_SOURCES.has(s)) return null;
  return clean(factualStatus).toLowerCase() === "verified" ? "verified" : "search";
}
