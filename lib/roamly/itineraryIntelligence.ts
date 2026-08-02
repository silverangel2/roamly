import type {
  RoamlyActivitySeed,
  RoamlyBookingCategory,
  RoamlyBookingSuggestion,
  RoamlyDayPlan,
  RoamlyItinerary
} from "@/lib/itinerary";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl
} from "@/lib/roamly/bookingLinks";
import type {
  TravelMarketCategory,
  TravelMarketResult,
  TravelRetrievalProvider
} from "@/lib/roamly/travelMarketSearch";
import type { TripPlannerPayload } from "@/lib/trip-planner";

const MAX_PRIMARY_TIMELINE_ITEMS = 6;
const SHORT_TRANSFER_MINUTES = 15;

export const GENERIC_PLACE_PATTERNS = [
  /\blocal bistro\b/i,
  /\bmuseum or gallery\b/i,
  /\bnightlife district\b/i,
  /\bhotel room\b/i,
  /\bhotel\/stay\b/i,
  /\bthings to do\b/i,
  /\bbook activities\b/i,
  /\bfind hotels?\b/i,
  /\bactivities\/tours to reserve\b/i,
  /\bneighborhood lunch\b/i,
  /\beasy evening finish\b/i,
  /\bfirst stop\b/i,
  /\bhidden gems?\b/i,
  /\blocal cafe\b/i,
  /\bcasual dinner\b/i
] as const;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function uniqueKey(value: string) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function timelineType(item: RoamlyActivitySeed): NonNullable<RoamlyActivitySeed["item_type"]> {
  if (item.item_type) return item.item_type;
  const text = `${item.category} ${item.title} ${item.description}`.toLowerCase();
  if (/\b(check[- ]?in|check[- ]?out|hotel|luggage|accommodation)\b/.test(text)) return "hotel";
  if (/\b(transfer|shuttle|taxi|rideshare|transit)\b/.test(text)) return "transfer";
  if (/\b(flight|fly|train|bus|ferry|drive|depart|arrive|arrival|return travel|journey|travel|airport|station|terminal)\b/.test(text)) {
    return "travel";
  }
  if (/\b(lunch|dinner|breakfast|cafe|restaurant|meal|food)\b/.test(text)) return "meal";
  if (/\b(rest|recover|recovery|buffer|break)\b/.test(text)) return "rest";
  if (/\b(book|ticket|reserve)\b/.test(text)) return "booking";
  return "activity";
}

function parseTimeToMinutes(value?: string | null) {
  const raw = clean(value);
  if (!raw || /^(transfer|flex|anytime)$/i.test(raw)) return null;
  const twentyFour = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFour) {
    const hours = Number(twentyFour[1]);
    const minutes = Number(twentyFour[2]);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
  }
  const twelve = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!twelve) return null;
  let hours = Number(twelve[1]);
  const minutes = Number(twelve[2] || 0);
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  const meridiem = twelve[3].toUpperCase();
  if (meridiem === "PM" && hours !== 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function parseDurationMinutes(item: RoamlyActivitySeed) {
  const explicit = asNumber(item.travelTimeMinutes ?? item.durationMinutes);
  if (explicit && explicit > 0) return Math.round(explicit);
  const text = clean(item.duration).toLowerCase();
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(hr|hour|hours|min|minute|minutes)/);
  if (range) {
    const average = (Number(range[1]) + Number(range[2])) / 2;
    return Math.round(range[3].startsWith("h") ? average * 60 : average);
  }
  const single = text.match(/(\d+(?:\.\d+)?)\s*(hr|hour|hours|min|minute|minutes)/);
  if (!single) return null;
  return Math.round(single[2].startsWith("h") ? Number(single[1]) * 60 : Number(single[1]));
}

export function isGenericPlaceName(value?: string | null) {
  const text = clean(value);
  if (!text) return true;
  return GENERIC_PLACE_PATTERNS.some((pattern) => pattern.test(text));
}

function isGenericTimelineItem(item: RoamlyActivitySeed, payload: TripPlannerPayload) {
  const destination = clean(payload.destination || payload.destinationCity);
  const title = clean(item.title);
  const location = clean(item.location_name);
  if (isGenericPlaceName(title)) return true;
  if (!location || isGenericPlaceName(location)) return true;
  if (destination && uniqueKey(location) === uniqueKey(destination) && timelineType(item) !== "travel") {
    return !/\b(city centre|downtown|old town|old port|museum|market|park|station|airport|hotel|district|neighborhood|neighbourhood)\b/i.test(title);
  }
  return false;
}

function arrayRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function resultFromRecord(record: Record<string, unknown>): TravelMarketResult | null {
  const category = clean(record.category) as TravelMarketCategory;
  const title = clean(record.title);
  if (!title || isGenericPlaceName(title)) return null;
  if (!["flight", "hotel", "attraction", "tour", "restaurant", "transport"].includes(category)) return null;
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? (record.metadata as Record<string, unknown>)
    : {};
  return {
    id: clean(record.id) || `${category}:${title}`,
    category,
    title,
    provider: clean(record.provider) || "Search",
    source: (clean(record.source) || "roamly_internal") as TravelMarketResult["source"],
    origin: clean(record.origin) || undefined,
    destination: clean(record.destination) || undefined,
    city: clean(record.city || record.destination) || undefined,
    country: clean(record.country) || undefined,
    start_date: clean(record.start_date) || undefined,
    end_date: clean(record.end_date) || undefined,
    travelers: asNumber(record.travelers) || undefined,
    rooms: asNumber(record.rooms) || undefined,
    room_type: clean(record.room_type) || undefined,
    price_amount: asNumber(record.price_amount) ?? undefined,
    price_min: asNumber(record.price_min) ?? undefined,
    price_max: asNumber(record.price_max) ?? undefined,
    currency: clean(record.currency) || "CAD",
    price_type: (clean(record.price_type) || "unknown") as TravelMarketResult["price_type"],
    confidence: (clean(record.confidence) || "low") as TravelMarketResult["confidence"],
    booking_url: clean(record.booking_url) || undefined,
    normal_search_url: clean(record.normal_search_url) || undefined,
    affiliate_url: clean(record.affiliate_url) || undefined,
    searched_at: clean(record.searched_at) || new Date().toISOString(),
    expires_at: clean(record.expires_at) || new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    metadata
  };
}

export function itineraryMarketResults(payload: TripPlannerPayload) {
  const discovery = payload.priceDiscovery || {};
  const rows = [
    ...arrayRecords(discovery.marketResults),
    ...arrayRecords(discovery.selectedMarketPrices)
  ];
  const seen = new Set<string>();
  const results: TravelMarketResult[] = [];
  for (const row of rows) {
    const result = resultFromRecord(row);
    if (!result) continue;
    const key = `${result.category}|${uniqueKey(result.title)}|${result.booking_url || result.normal_search_url || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(result);
  }
  return results.sort((a, b) => marketRank(a) - marketRank(b));
}

function marketRank(result: TravelMarketResult) {
  if (result.price_type === "live_partner") return 0;
  if (result.price_type === "cached_recent") return 1;
  if (result.source === "klook" || result.source === "travelpayouts" || result.source === "stay22") return 2;
  if (clean(result.metadata?.retrieval_provider) === "native") return 3;
  if (result.price_type === "search_ready") return 4;
  return 8;
}

function desiredCategories(item: RoamlyActivitySeed): TravelMarketCategory[] {
  const type = timelineType(item);
  const text = `${item.title} ${item.description} ${item.category}`.toLowerCase();
  if (type === "meal" || /\b(lunch|dinner|restaurant|cafe|food)\b/.test(text)) return ["restaurant"];
  if (type === "hotel" || /\bhotel|stay|check[- ]?in\b/.test(text)) return ["hotel"];
  if (/\btour\b/.test(text)) return ["tour", "attraction"];
  if (/\bticket|museum|gallery|admission|attraction|activity\b/.test(text)) return ["attraction", "tour"];
  if (type === "travel") return ["flight", "transport"];
  if (type === "transfer") return ["transport"];
  return ["attraction", "tour", "restaurant"];
}

function searchTitleForItem(item: RoamlyActivitySeed, payload: TripPlannerPayload) {
  const destination = clean(item.location_name) && !isGenericPlaceName(item.location_name)
    ? clean(item.location_name)
    : clean(payload.destination || payload.destinationCity) || "destination";
  const type = timelineType(item);
  if (type === "meal") return `Search restaurants near ${destination}`;
  if (type === "hotel") return `Search stays in ${destination}`;
  if (type === "travel") return `Search route to ${destination}`;
  return `Search verified places near ${destination}`;
}

function movementText(item: RoamlyActivitySeed) {
  const origin = clean(item.origin);
  const minutes = parseDurationMinutes(item);
  const mode = clean(item.transportMode || item.travel_mode) || "walk/transit";
  if (!origin && !minutes) return "";
  return `${origin ? `From ${origin}` : "Getting there"}: ${minutes ? `about ${minutes} min` : "verify timing"} by ${mode}.`;
}

function attachMovement(item: RoamlyActivitySeed, transfer: RoamlyActivitySeed) {
  const text = movementText(transfer);
  if (!text) return item;
  const description = clean(item.description);
  const existing = description.toLowerCase();
  return {
    ...item,
    origin: item.origin || transfer.origin || transfer.location_name,
    travelTimeMinutes: item.travelTimeMinutes || parseDurationMinutes(transfer) || undefined,
    transportMode: item.transportMode || transfer.transportMode || transfer.travel_mode,
    travel_mode: item.travel_mode || transfer.travel_mode,
    description: existing.includes(text.toLowerCase()) ? description : `${text} ${description}`.trim()
  };
}

function isMajorStandaloneTransfer(item: RoamlyActivitySeed) {
  const type = timelineType(item);
  if (type === "travel") return true;
  if (type !== "transfer") return false;
  const text = `${item.title} ${item.description} ${item.location_name} ${item.origin} ${item.destination}`.toLowerCase();
  const minutes = parseDurationMinutes(item) || 0;
  if (minutes < SHORT_TRANSFER_MINUTES) return false;
  if (/^travel to\b/i.test(clean(item.title))) return false;
  return minutes >= 45 || /\bairport|station|terminal|ferry port|border|inter-?city|departure point|arrival point\b/i.test(text);
}

export function mergeShortTransfersIntoFollowingActivity(items: RoamlyActivitySeed[]) {
  const output: RoamlyActivitySeed[] = [];
  let pendingTransfer: RoamlyActivitySeed | null = null;

  for (const rawItem of items) {
    const item = { ...rawItem, item_type: timelineType(rawItem) };
    const type = timelineType(item);
    if ((type === "transfer" || /^travel to\b/i.test(clean(item.title))) && !isMajorStandaloneTransfer(item)) {
      pendingTransfer = pendingTransfer
        ? Object.assign({}, pendingTransfer, { destination: item.destination || pendingTransfer.destination })
        : item;
      continue;
    }
    const nextItem = pendingTransfer && type !== "travel" ? attachMovement(item, pendingTransfer) : item;
    pendingTransfer = null;
    output.push(nextItem);
  }

  return output;
}

function applyMarketIdentity(
  item: RoamlyActivitySeed,
  payload: TripPlannerPayload,
  marketResults: TravelMarketResult[],
  usedMarketIds: Set<string>
) {
  if (!isGenericTimelineItem(item, payload)) return item;
  const candidate = marketResults.find((result) => desiredCategories(item).includes(result.category) && !usedMarketIds.has(result.id));
  if (!candidate) {
    const title = searchTitleForItem(item, payload);
    return {
      ...item,
      title,
      location_name: clean(payload.destination || payload.destinationCity) || clean(item.location_name) || title,
      map_query: title,
      description: "Search-only fallback; verify the exact place, hours, route, and price before relying on it."
    };
  }
  usedMarketIds.add(candidate.id);
  const verification = verificationStatus(candidate);
  const location = clean(candidate.title) || clean(candidate.city) || clean(candidate.destination) || clean(item.location_name);
  return {
    ...item,
    title: candidate.title,
    location_name: location,
    map_query: clean(candidate.normal_search_url || candidate.booking_url) ? candidate.title : `${candidate.title} ${candidate.city || candidate.destination || ""}`,
    description:
      verification === "verified" || verification === "native_verified"
        ? `Verified source result. ${clean(item.description) || "Confirm current hours, route, and price before going."}`
        : `Search-backed result. ${clean(item.description) || "Confirm current hours, route, and price before going."}`
  };
}

function isIntentionalLateMeal(item: RoamlyActivitySeed) {
  return /\bintentional|late lunch|brunch|rest day|slow morning\b/i.test(`${item.title} ${item.description}`);
}

function fixMealTiming(item: RoamlyActivitySeed) {
  const type = timelineType(item);
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (type !== "meal" || !/\blunch\b/.test(text)) return item;
  const start = parseTimeToMinutes(item.startTime || item.time_label);
  if (start == null || start <= 14 * 60 || isIntentionalLateMeal(item)) return item;
  return {
    ...item,
    title: item.title.toLowerCase().includes("late lunch") ? item.title : `Late lunch: ${item.title}`,
    description: `Intentional late lunch after the previous stop. ${item.description}`.trim()
  };
}

function visiblePriority(item: RoamlyActivitySeed) {
  const type = timelineType(item);
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (type === "travel" && /\b(return travel|flight|train|bus|drive|departure|arrival)\b/.test(text)) return 0;
  if (type === "hotel") return 1;
  if (type === "activity" || type === "booking") return 2;
  if (type === "meal") return 3;
  if (type === "travel") return 4;
  if (type === "transfer") return 5;
  if (type === "rest") return 7;
  return 8;
}

function capPrimaryItems(items: RoamlyActivitySeed[]) {
  if (items.length <= MAX_PRIMARY_TIMELINE_ITEMS) return items;
  const keepIndexes = new Set(
    items
      .map((item, index) => ({ index, priority: visiblePriority(item) }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .slice(0, MAX_PRIMARY_TIMELINE_ITEMS)
      .map((item) => item.index)
  );
  return items.filter((_, index) => keepIndexes.has(index));
}

function normalizeTimeline(items: RoamlyActivitySeed[], payload: TripPlannerPayload, marketResults: TravelMarketResult[], usedMarketIds: Set<string>) {
  const identityFixed = items
    .map((item) => ({ ...item, item_type: timelineType(item) }))
    .map((item) => applyMarketIdentity(item, payload, marketResults, usedMarketIds))
    .map(fixMealTiming);
  return capPrimaryItems(mergeShortTransfersIntoFollowingActivity(identityFixed));
}

function suggestedLabel(category: RoamlyBookingCategory, result?: TravelMarketResult | null) {
  if (category === "flight") return result?.price_type === "live_partner" ? "Open provider" : "Search flights";
  if (category === "hotel") return "Search hotels";
  if (category === "attraction" || category === "tour") return result?.source === "klook" ? "Book activity" : "Search activity";
  if (category === "restaurant") return "View on Google Maps";
  if (category === "transport" || category === "car_rental") return "Open route";
  return "Search";
}

function verificationStatus(result: TravelMarketResult | null | undefined) {
  if (!result) return "search_link_only";
  const provider = clean(result.metadata?.retrieval_provider) as TravelRetrievalProvider;
  const nativeStatus = clean(result.metadata?.verification_status);
  if (nativeStatus === "native_review_evidence") return "native_verified";
  if (result.price_type === "live_partner" || result.price_type === "cached_recent") return "verified";
  if (provider === "native") return "native_verified";
  if (provider === "provider_api") return "verified";
  if (provider === "firecrawl_fallback") return "requires_verification";
  return "search_link_only";
}

function retrievalProvider(result: TravelMarketResult | null | undefined): TravelRetrievalProvider {
  const provider = clean(result?.metadata?.retrieval_provider);
  if (provider === "native" || provider === "provider_api" || provider === "firecrawl_fallback" || provider === "search_link_only") {
    return provider;
  }
  if (result?.source === "klook" || result?.source === "stay22" || result?.source === "travelpayouts") return "provider_api";
  return "search_link_only";
}

function priceConfidence(result: TravelMarketResult | null | undefined): RoamlyBookingSuggestion["price_confidence"] {
  if (!result) return "unknown";
  if (result.price_type === "live_partner" || result.price_type === "cached_recent") return "partner";
  if (result.price_type === "estimated_fallback") return "estimated";
  return "unknown";
}

function mapMarketCategory(category: TravelMarketCategory): RoamlyBookingCategory {
  if (category === "flight" || category === "hotel" || category === "attraction" || category === "tour" || category === "restaurant" || category === "transport") {
    return category;
  }
  return "attraction";
}

function searchUrlForCategory(category: RoamlyBookingCategory, payload: TripPlannerPayload, title: string) {
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  if (category === "flight") {
    return buildFlightSearchUrl({
      origin: payload.origin,
      destination: payload.destination,
      departureDate: payload.startDate,
      returnDate: payload.returnToOrigin === false ? undefined : payload.endDate,
      travelers
    });
  }
  if (category === "hotel") {
    return buildHotelSearchUrl({
      destination: payload.destination,
      checkInDate: payload.startDate,
      checkOutDate: payload.endDate,
      adults: travelers.adults || payload.travelersCount || 1,
      children: travelers.children || 0,
      rooms: payload.rooms || 1,
      roomType: payload.bedPreference
    });
  }
  if (category === "attraction") return buildAttractionTicketSearchUrl({ attractionName: title, destination: payload.destination, date: payload.startDate });
  if (category === "tour") return buildTourSearchUrl({ tourName: title, destination: payload.destination, date: payload.startDate });
  if (category === "transport" || category === "car_rental") {
    return buildTransportSearchUrl({ origin: payload.origin, destination: payload.destination, date: payload.startDate });
  }
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${title} ${payload.destination}`);
  return url.toString();
}

function marketResultToSuggestion(result: TravelMarketResult, payload: TripPlannerPayload): RoamlyBookingSuggestion {
  const category = mapMarketCategory(result.category);
  const directUrl = clean(result.affiliate_url || result.booking_url || result.normal_search_url || searchUrlForCategory(category, payload, result.title));
  const verification = verificationStatus(result);
  const providerUsed = retrievalProvider(result);
  const price = result.price_amount ?? result.price_min ?? null;
  const max = result.price_amount ?? result.price_max ?? null;
  const source = result.provider || (providerUsed === "native" ? "ReviewIntel native retrieval" : "Search link");
  return {
    category,
    booking_category: category,
    title: result.title,
    description:
      verification === "verified" || verification === "native_verified"
        ? `${source} result. Verify final price, availability, hours, and booking terms before purchase.`
        : "Search-only recommendation. Verify exact match, current price, availability, hours, and booking terms before relying on it.",
    location: result.city || result.destination,
    city: result.city,
    country: result.country,
    date: result.start_date,
    origin: result.origin,
    destination: result.destination,
    departure_date: result.category === "flight" ? result.start_date : undefined,
    return_date: result.category === "flight" ? result.end_date : undefined,
    room_type: result.room_type,
    provider: source,
    provider_or_search_source: source,
    booking_status: "needs_booking",
    why_recommended: `Source: ${source}. Retrieved ${result.searched_at}. Verification: ${verification}.`,
    advance_booking_recommended: category !== "restaurant",
    free_or_paid: category === "restaurant" ? "unknown" : "paid",
    booking_label: suggestedLabel(category, result),
    normal_search_url: directUrl,
    affiliate_url: clean(result.affiliate_url),
    affiliate_provider: result.source === "klook" || result.source === "stay22" || result.source === "travelpayouts" ? result.source : "",
    estimated_cost_min: price,
    estimated_cost_max: max,
    estimated_nightly_cost_min: category === "hotel" ? result.price_min ?? result.price_amount ?? null : undefined,
    estimated_nightly_cost_max: category === "hotel" ? result.price_max ?? result.price_amount ?? null : undefined,
    estimated_total_cost_min: category === "hotel" ? result.price_min ?? result.price_amount ?? null : undefined,
    estimated_total_cost_max: category === "hotel" ? result.price_max ?? result.price_amount ?? null : undefined,
    currency: result.currency || payload.budgetCurrency || "CAD",
    price_confidence: priceConfidence(result),
    market_source: result.source,
    price_type: result.price_type,
    market_confidence: result.confidence,
    searched_at: result.searched_at,
    expires_at: result.expires_at,
    market_search_key: clean(result.metadata?.search_key) || clean(result.metadata?.market_search_key)
  };
}

function fallbackSuggestion(category: RoamlyBookingCategory, payload: TripPlannerPayload): RoamlyBookingSuggestion {
  const destination = clean(payload.destination || payload.destinationCity) || "destination";
  const origin = clean(payload.origin || payload.originCity);
  const title =
    category === "flight"
      ? `${origin ? `${origin} to ` : ""}${destination} flight search`
      : category === "hotel"
        ? `${destination} hotel search`
        : category === "transport"
          ? `${destination} route search`
          : `${destination} activity search`;
  const url = searchUrlForCategory(category, payload, title);
  const searchedAt = new Date().toISOString();
  return {
    category,
    booking_category: category,
    title,
    description: "Search link only because no verified provider result was available. Verify price, schedule, availability, and exact match before booking.",
    location: destination,
    city: payload.destinationCity || destination,
    origin: category === "flight" ? origin : undefined,
    destination,
    departure_date: category === "flight" ? payload.startDate : undefined,
    return_date: category === "flight" && payload.returnToOrigin !== false ? payload.endDate : undefined,
    provider: category === "restaurant" ? "Google Maps" : "Search link",
    provider_or_search_source: category === "restaurant" ? "Google Maps" : "Search link only",
    booking_status: "needs_booking",
    why_recommended: `Source: search_link_only. Retrieved ${searchedAt}. Verification: search_link_only.`,
    advance_booking_recommended: category !== "restaurant",
    free_or_paid: "unknown",
    booking_label: suggestedLabel(category),
    normal_search_url: url,
    estimated_cost_min: null,
    estimated_cost_max: null,
    currency: payload.budgetCurrency || "CAD",
    price_confidence: "unknown",
    price_type: "search_ready",
    market_confidence: "low",
    searched_at: searchedAt
  };
}

function isGenericBooking(suggestion: RoamlyBookingSuggestion) {
  return isGenericPlaceName(suggestion.title) || /^(hotel room|hotel\/stay to book|flights? to book|things to do|book activities|find hotels?)$/i.test(suggestion.title);
}

function isImpracticalTransportSuggestion(suggestion: RoamlyBookingSuggestion) {
  if (suggestion.category !== "transport" && suggestion.category !== "flight") return false;
  const text = `${suggestion.title} ${suggestion.description} ${suggestion.why_recommended || ""}`.toLowerCase();
  return /\bnot available|not recommended|unverified cross-border|too long for this trip|miserable\b/.test(text);
}

function suggestionRank(suggestion: RoamlyBookingSuggestion) {
  if (suggestion.price_type === "live_partner") return 0;
  if (suggestion.price_type === "cached_recent") return 1;
  if (suggestion.affiliate_url) return 2;
  if (suggestion.market_source === "klook" || suggestion.market_source === "stay22" || suggestion.market_source === "travelpayouts") return 3;
  if (suggestion.searched_at) return 4;
  return 8;
}

function curateBookingSuggestions(
  itinerary: RoamlyItinerary,
  payload: TripPlannerPayload,
  marketResults: TravelMarketResult[]
) {
  const marketSuggestions = marketResults.map((result) => marketResultToSuggestion(result, payload));
  const merged: RoamlyBookingSuggestion[] = [...marketSuggestions, ...(itinerary.booking_suggestions || [])]
    .filter((suggestion) => !isGenericBooking(suggestion))
    .filter((suggestion) => !isImpracticalTransportSuggestion(suggestion))
    .map((suggestion): RoamlyBookingSuggestion => ({
      ...suggestion,
      booking_label:
        suggestion.category === "flight" && suggestion.price_type !== "live_partner"
          ? "Search flights"
          : suggestion.category === "hotel"
            ? "Search hotels"
            : suggestion.booking_label,
      searched_at: suggestion.searched_at || new Date().toISOString()
    }))
    .sort((a, b) => suggestionRank(a) - suggestionRank(b));

  const recommendedTransport =
    payload.priceDiscovery?.recommendedTransportOption &&
    typeof payload.priceDiscovery.recommendedTransportOption === "object" &&
    !Array.isArray(payload.priceDiscovery.recommendedTransportOption)
      ? (payload.priceDiscovery.recommendedTransportOption as Record<string, unknown>)
      : null;
  const transportMode = clean(recommendedTransport?.mode).toLowerCase();
  const origin = uniqueKey(payload.origin || payload.originCity || "");
  const destination = uniqueKey(payload.destination || payload.destinationCity || "");
  const needsTransport = Boolean(origin && destination && origin !== destination);
  const required: RoamlyBookingCategory[] = [
    needsTransport && payload.budgetIncludesFlights !== false && (transportMode === "flight" || !transportMode) ? "flight" : null,
    needsTransport && transportMode && transportMode !== "flight" ? "transport" : null,
    payload.budgetIncludesHotel !== false ? "hotel" : null,
    payload.budgetIncludesActivities !== false ? "attraction" : null
  ].filter((category): category is RoamlyBookingCategory => Boolean(category));
  for (const category of required) {
    if (!merged.some((suggestion) => suggestion.category === category || (category === "attraction" && suggestion.category === "tour"))) {
      merged.push(fallbackSuggestion(category, payload));
    }
  }

  const seen = new Set<string>();
  const perCategory = new Map<RoamlyBookingCategory, number>();
  const curated: RoamlyBookingSuggestion[] = [];
  for (const suggestion of merged) {
    const category = suggestion.category;
    const count = perCategory.get(category) || 0;
    if (count >= 3) continue;
    const key = `${category}|${uniqueKey(suggestion.title)}|${suggestion.normal_search_url || suggestion.affiliate_url || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perCategory.set(category, count + 1);
    curated.push(suggestion);
  }
  return curated.slice(0, 18);
}

export function applyRoamlyItineraryIntelligence(
  itinerary: RoamlyItinerary,
  payload: TripPlannerPayload
): RoamlyItinerary {
  const marketResults = itineraryMarketResults(payload);
  const usedMarketIds = new Set<string>();
  const daily_itinerary: RoamlyDayPlan[] = itinerary.daily_itinerary.map((day) => ({
    ...day,
    food: (day.food || [])
      .filter((item) => !isGenericPlaceName(item))
      .slice(0, 4),
    live_timeline: normalizeTimeline(day.live_timeline || [], payload, marketResults, usedMarketIds)
  }));

  return {
    ...itinerary,
    daily_itinerary,
    booking_suggestions: curateBookingSuggestions(itinerary, payload, marketResults)
  };
}
