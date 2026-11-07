/**
 * KF-1 timeline grounding (2026-11-03) — generation-side admission control
 * for the staged pipeline's candidate pool.
 *
 * Root cause (see KF-1 ROOT-CAUSE.md): for thin destinations the market
 * pool contained ONLY `search_ready` fallback results whose titles are
 * search QUERIES ("Charlottetown hotel search", "Events in Charlottetown",
 * "Charlottetown restaurants official menu reservations", ...).
 * Deterministic stages copied those query titles onto the timeline
 * verbatim and the final validator — correctly — rejected them
 * ("search is not a plan", ungrounded hotel, cross-day repeats).
 *
 * This module is the shared vocabulary for the fix:
 *  - isSearchQueryTitle / isTimelineAdmissibleCandidate: a search-query
 *    candidate is a booking SUGGESTION, never a factual timeline place.
 *  - packFallbackMarketResults / augmentMarketResultsWithPackFallback:
 *    when a category has no named candidate, fall back to the named
 *    inventory of the destination pack (stays / sights / foods) that
 *    the staged path previously never read.
 *  - demoteToDiscoverySuggestion / neutralTimelineTitle: an item that
 *    cannot be grounded is demoted to a non-factual discovery
 *    suggestion instead of being renamed into a search query.
 *
 * The validator (lib/itinerary.ts) is untouched and remains the final
 * arbiter; nothing here weakens any validation rule.
 */
import type { RoamlyActivitySeed } from "@/lib/itinerary";
import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueKey(value: string) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

/**
 * Mirror of the validator's placeholder test (lib/itinerary.ts
 * isPlaceholderOrOperationalText), kept local so this module stays
 * import-cycle free. If the validator's notion ever widens, widen this
 * too — admission must never be LOOSER than validation.
 */
export function isPlaceholderTitle(value: unknown) {
  const text = clean(String(value ?? "")).toLowerCase();
  return (
    !text ||
    /\bsearch(?:ing)?\b|\btbd\b|to be determined|placeholder|unresolved|not provided|coming soon/.test(text) ||
    /^hotel$|^accommodation(?: tbd)?$/.test(text) ||
    /\b(?:a )?local restaurant\b|\brestaurant near\b/.test(text) ||
    /\b(?:flight|hotel|transport|tour|activity)\s+search\b/.test(text) ||
    /https?:\/\/|www\.|\.com\//.test(text)
  );
}

/** Query suffixes the market layer manufactures as request titles
 *  (lib/roamly/travelMarketSearch.ts attractionTitle / tourTitle /
 *  note-priority requests): "<Destination> <suffix>" is a search query,
 *  not a place — except Montreal's hard-coded named titles, which do
 *  not take the bare "<Destination> " prefix form used here. */
const QUERY_SUFFIXES: ReadonlySet<string> = new Set([
  "food tasting tour",
  "walking highlights tour",
  "evening guided experience",
  "top attraction ticket",
  "guided activity search",
  "official attraction search",
  "restaurant search",
  "restaurants official menu reservations",
  "hotel search",
  "flight search",
  "transport search"
]);

/**
 * True when a candidate/item title is itself a search query or
 * placeholder rather than the name of a real place or service.
 */
export function isSearchQueryTitle(value: unknown, destination?: string | null) {
  const title = clean(String(value ?? ""));
  if (isPlaceholderTitle(title)) return true;
  const lower = title.toLowerCase();
  if (/^events in\b/.test(lower)) return true;
  if (/^things to do in\b/.test(lower)) return true;
  if (/official menu reservations/.test(lower)) return true;
  if (/planning estimate/.test(lower)) return true;
  if (/^search\b/.test(lower)) return true;
  const dest = clean(destination || "").toLowerCase();
  if (dest && lower.startsWith(`${dest} `)) {
    const suffix = lower.slice(dest.length + 1).trim();
    if (QUERY_SUFFIXES.has(suffix)) return true;
  }
  return false;
}

/**
 * A market candidate may be bound as a factual timeline item only when
 * its title actually names something. Search-ready fallbacks (whose
 * title is the query itself) stay in booking suggestions / discovery.
 */
export function isTimelineAdmissibleCandidate(
  result: Pick<TravelMarketResult, "title">,
  destination?: string | null
) {
  const title = clean(result.title);
  if (!title) return false;
  return !isSearchQueryTitle(title, destination);
}

/** Neutral, validator-clean titles for demoted items. Activity/meal
 *  neutrals carry the day number because the validator's cross-day
 *  repeat rule compares normalized titles across days — a bare
 *  "Flexible meal break" demoted on two days would itself repeat. */
export function neutralTimelineTitle(
  itemType: string | null | undefined,
  destination: string | null | undefined,
  dayNumber: number | null | undefined
) {
  const day = dayNumber && dayNumber > 0 ? ` (Day ${dayNumber})` : "";
  const dest = clean(destination || "");
  switch (itemType) {
    case "hotel":
      return "Check in and settle in";
    case "meal":
      return `Flexible meal break${day}`;
    case "travel":
      return dest ? `Travel to ${dest}` : "Travel day";
    case "transfer":
      return "Local transfer";
    case "booking":
      return `Flexible booking time${day}`;
    case "rest":
      return `Rest and recharge${day}`;
    case "reminder":
      return "Planning reminder";
    default:
      return `Flexible discovery time${day}`;
  }
}

/**
 * Demote an ungroundable item to a non-factual DISCOVERY_SUGGESTION.
 * A query/placeholder title is replaced with a neutral title; a real
 * (model-written) title is kept. No search retitling, ever.
 */
export function demoteToDiscoverySuggestion(
  item: RoamlyActivitySeed,
  params: {
    destination?: string | null;
    dayNumber?: number | null;
    itemType?: string | null;
    /** Force the neutral title even when the current title is a real
     *  name — required for cross-day dedupe demotions, where keeping
     *  the (real) title would keep the repeat the validator rejects. */
    forceNeutralTitle?: boolean;
  }
): RoamlyActivitySeed {
  const type = params.itemType || item.item_type || "activity";
  const needsNeutralTitle = params.forceNeutralTitle === true || isSearchQueryTitle(item.title, params.destination);
  return {
    ...item,
    candidateId: undefined,
    source: undefined,
    factualStatus: "DISCOVERY_SUGGESTION",
    title: needsNeutralTitle
      ? neutralTimelineTitle(type, params.destination, params.dayNumber)
      : item.title,
    description:
      type === "meal"
        ? "Keep this meal flexible until a place and current details are verified."
        : type === "rest"
          ? "A flexible rest window; keep plans open."
          : type === "travel" || type === "transfer"
            ? "Travel timing is planned; confirm route details before relying on it."
            : type === "reminder"
              ? "Planning reminder."
              : "A flexible discovery suggestion; verify current details before relying on it.",
    estimated_cost: null,
    cost_status: "UNKNOWN",
    booking_label: undefined,
    booking: undefined,
    affiliate_category: undefined,
    coordinates: null,
    timing_status: "PLANNED",
    uncertainty: Array.from(
      new Set([...(item.uncertainty || []), "This is a planning suggestion, not verified inventory."])
    )
  };
}

/* ------------------------------------------------------------------ */
/* Destination-pack fallback                                           */
/* ------------------------------------------------------------------ */

export type PackNamedRecord = {
  key?: string | null;
  name?: string | null;
  kind?: string | null;
  url?: string | null;
};

/** The named inventory shape shared by the recorded pack fixtures and
 *  the engine's assembled EnginePack (stays / sights / foods / ...). */
export type PackInventoryShape = {
  stays?: readonly PackNamedRecord[] | null;
  sights?: readonly PackNamedRecord[] | null;
  excursions?: readonly PackNamedRecord[] | null;
  foods?: readonly PackNamedRecord[] | null;
  transport?: readonly PackNamedRecord[] | null;
  generatedAt?: string | null;
};

const PACK_CATEGORY_CAPS: Record<string, number> = {
  hotel: 6,
  attraction: 12,
  restaurant: 12,
  transport: 4
};

/** Generic pack names that name no specific place (mirrors the spirit
 *  of GENERIC_PLACE_PATTERNS in itineraryIntelligence.ts). */
const GENERIC_PACK_NAME =
  /\b(things to do|hotel room|hotel\/stay|local cafe|local bistro|hidden gems?|first stop)\b/i;

function packSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Convert a destination pack's named inventory into market-candidate
 * shape so the existing binding machinery (rehydrate / market
 * identity) can use it exactly like provider results. Candidates are
 * stamped retrieval_provider "native" (the pack IS Roamly's own
 * collected inventory) and carry no price — they ground identity,
 * never cost.
 */
export function packFallbackMarketResults(
  pack: PackInventoryShape,
  params: { destination: string; country?: string | null; currency?: string | null; startDate?: string | null }
): TravelMarketResult[] {
  const destination = clean(params.destination);
  if (!destination) return [];
  const searchedAt =
    clean(pack.generatedAt || "") ||
    (clean(params.startDate || "") ? `${clean(params.startDate)}T00:00:00.000Z` : "2026-01-01T00:00:00.000Z");
  const groups: Array<{ category: TravelMarketResult["category"]; records: readonly PackNamedRecord[] }> = [
    { category: "hotel", records: pack.stays || [] },
    { category: "attraction", records: [...(pack.sights || []), ...(pack.excursions || [])] },
    { category: "restaurant", records: pack.foods || [] },
    { category: "transport", records: pack.transport || [] }
  ];
  const results: TravelMarketResult[] = [];
  const seenNames = new Set<string>();
  for (const group of groups) {
    let added = 0;
    for (const record of group.records) {
      if (added >= (PACK_CATEGORY_CAPS[group.category] || 8)) break;
      const name = clean(record?.name || "");
      if (name.length < 3) continue;
      if (GENERIC_PACK_NAME.test(name)) continue;
      if (isSearchQueryTitle(name, destination)) continue;
      const key = `${group.category}|${uniqueKey(name)}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      const mapsQuery = encodeURIComponent(`${name} ${destination}`);
      results.push({
        id: `pack:${clean(record?.key || "") || packSlug(name)}`,
        category: group.category,
        title: name,
        provider: "Roamly destination pack",
        source: "roamly_internal",
        destination,
        city: destination,
        country: clean(params.country || "") || undefined,
        currency: clean(params.currency || "") || "CAD",
        price_type: "search_ready",
        confidence: "low",
        normal_search_url: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
        searched_at: searchedAt,
        expires_at: "",
        metadata: {
          retrieval_provider: "native",
          source: "destination_pack",
          kf1_pack_fallback: true,
          pack_key: clean(record?.key || "") || undefined,
          pack_url: clean(record?.url || "") || undefined
        }
      });
      added++;
    }
  }
  return results;
}

/**
 * Append pack candidates ONLY for categories whose existing pool has
 * no timeline-admissible (named) candidate. Healthy destinations —
 * whose market pool already names places — are returned unchanged.
 */
export function augmentMarketResultsWithPackFallback(
  existing: readonly TravelMarketResult[],
  packResults: readonly TravelMarketResult[],
  destination?: string | null
): TravelMarketResult[] {
  if (!packResults.length) return [...existing];
  const categoriesWithNamed = new Set<string>();
  for (const result of existing) {
    if (isTimelineAdmissibleCandidate(result, destination)) categoriesWithNamed.add(result.category);
  }
  const additions = packResults.filter((result) => !categoriesWithNamed.has(result.category));
  if (!additions.length) return [...existing];
  return [...existing, ...additions];
}
