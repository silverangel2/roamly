import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  safeExternalUrl
} from "@/lib/roamly/bookingLinks";
import { buildRoamlyAffiliateUrl } from "@/lib/roamly/affiliateLinks";
import type { NormalizedPlace } from "@/lib/roamly/places";
import { compareTransportOptions, transportOptionsToMarketResults } from "@/lib/roamly/transportOptions";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type TravelMarketCategory = "flight" | "hotel" | "attraction" | "tour" | "transport";
export type TravelMarketSource =
  | "travelpayouts"
  | "stay22"
  | "getyourguide"
  | "viator"
  | "klook"
  | "google_search"
  | "fallback_estimate";
export type TravelMarketPriceType = "live_partner" | "cached_recent" | "search_ready" | "estimated_fallback" | "unknown";
export type TravelMarketConfidence = "high" | "medium" | "low";

export type TravelMarketResult = {
  id: string;
  category: TravelMarketCategory;
  title: string;
  provider: string;
  source: TravelMarketSource;
  origin?: string;
  destination?: string;
  city?: string;
  country?: string;
  start_date?: string;
  end_date?: string;
  travelers?: number;
  rooms?: number;
  room_type?: string;
  price_amount?: number;
  price_min?: number;
  price_max?: number;
  currency: string;
  price_type: TravelMarketPriceType;
  confidence: TravelMarketConfidence;
  booking_url?: string;
  normal_search_url?: string;
  affiliate_url?: string;
  searched_at: string;
  expires_at: string;
  metadata: Record<string, unknown>;
};

export type TravelMarketSearchRequest = {
  category: TravelMarketCategory;
  origin?: string | null;
  destination?: string | null;
  city?: string | null;
  country?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  travelers?: number | null;
  rooms?: number | null;
  room_type?: string | null;
  title?: string | null;
  currency?: string | null;
  interests?: string[];
};

export type TravelMarketSearchResponse = {
  results: TravelMarketResult[];
  cacheHit: boolean;
  searchKey: string;
  providerConfigured: boolean;
  providerAttempted: boolean;
  warning?: string;
};

const ttlHours: Record<TravelMarketCategory, number> = {
  flight: 2,
  hotel: 6,
  attraction: 12,
  tour: 12,
  transport: 12
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function cleanCurrency(value?: string | null) {
  return clean(value).toUpperCase() || "CAD";
}

function cleanDate(value?: string | null) {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function positiveInteger(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return fallback;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function normalizeKeyPart(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function buildTravelMarketSearchKey(input: TravelMarketSearchRequest) {
  return [
    input.category,
    input.origin,
    input.destination,
    input.city,
    cleanDate(input.start_date),
    cleanDate(input.end_date),
    positiveInteger(input.travelers, 0),
    positiveInteger(input.rooms, 0),
    input.room_type,
    cleanCurrency(input.currency)
  ]
    .map(normalizeKeyPart)
    .join("|");
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAt(category: TravelMarketCategory, searchedAt = new Date()) {
  return new Date(searchedAt.getTime() + ttlHours[category] * 60 * 60 * 1000).toISOString();
}

function isMissingMarketTable(message?: string | null) {
  return Boolean(
    message &&
      (message.includes("roamly_market_prices") ||
        message.includes("schema cache") ||
        message.toLowerCase().includes("does not exist"))
  );
}

function travelerText(request: TravelMarketSearchRequest) {
  const travelers = positiveInteger(request.travelers, 1);
  return `${travelers} ${travelers === 1 ? "traveler" : "travelers"}`;
}

function categoryDefaultTitle(request: TravelMarketSearchRequest) {
  const destination = clean(request.destination || request.city) || "destination";
  if (request.category === "flight") return `${clean(request.origin) || "Origin"} to ${destination} flight search`;
  if (request.category === "hotel") return `${request.room_type || "Hotel room"} in ${destination}`;
  if (request.category === "attraction") return `${request.title || `${destination} attraction ticket`}`;
  if (request.category === "tour") return `${request.title || `${destination} tour`}`;
  return `${clean(request.origin) ? `${clean(request.origin)} to ` : ""}${destination} transport search`;
}

function normalSearchUrl(request: TravelMarketSearchRequest) {
  if (request.category === "flight") {
    return buildFlightSearchUrl({
      origin: request.origin,
      destination: request.destination || request.city,
      departureDate: request.start_date,
      returnDate: request.end_date,
      travelers: request.travelers || 1
    });
  }
  if (request.category === "hotel") {
    return buildHotelSearchUrl({
      destination: request.destination || request.city,
      checkInDate: request.start_date,
      checkOutDate: request.end_date,
      adults: request.travelers || 1,
      rooms: request.rooms || 1,
      roomType: request.room_type
    });
  }
  if (request.category === "attraction") {
    return buildAttractionTicketSearchUrl({
      attractionName: request.title || categoryDefaultTitle(request),
      destination: request.destination || request.city,
      date: request.start_date
    });
  }
  if (request.category === "tour") {
    return buildTourSearchUrl({
      tourName: request.title || categoryDefaultTitle(request),
      destination: request.destination || request.city,
      date: request.start_date
    });
  }
  return buildTransportSearchUrl({
    origin: request.origin,
    destination: request.destination || request.city,
    date: request.start_date
  });
}

function affiliateUrl(request: TravelMarketSearchRequest) {
  const link = buildRoamlyAffiliateUrl({
    category: request.category,
    origin: request.origin,
    destination: request.destination || request.city,
    title: request.title || categoryDefaultTitle(request),
    query: request.title || categoryDefaultTitle(request),
    startDate: request.start_date,
    endDate: request.end_date,
    travelers: request.travelers || 1,
    adults: request.travelers || 1,
    rooms: request.rooms || 1,
    roomType: request.room_type,
    date: request.start_date
  });
  return link.affiliate_enabled ? link.affiliate_url : "";
}

function baseResult(
  request: TravelMarketSearchRequest,
  overrides: Partial<TravelMarketResult> = {}
): TravelMarketResult {
  const searchedAt = overrides.searched_at || nowIso();
  const normal = safeExternalUrl(overrides.normal_search_url) || safeExternalUrl(normalSearchUrl(request));
  const affiliate = safeExternalUrl(overrides.affiliate_url) || safeExternalUrl(affiliateUrl(request));
  const booking = safeExternalUrl(overrides.booking_url) || affiliate || normal;

  return {
    id: overrides.id || randomUUID(),
    category: request.category,
    title: overrides.title || clean(request.title) || categoryDefaultTitle(request),
    provider: overrides.provider || "Search",
    source: overrides.source || "google_search",
    origin: clean(request.origin) || undefined,
    destination: clean(request.destination) || undefined,
    city: clean(request.city || request.destination) || undefined,
    country: clean(request.country) || undefined,
    start_date: cleanDate(request.start_date) || undefined,
    end_date: cleanDate(request.end_date) || undefined,
    travelers: positiveInteger(request.travelers, 0) || undefined,
    rooms: positiveInteger(request.rooms, 0) || undefined,
    room_type: clean(request.room_type) || undefined,
    price_amount: overrides.price_amount,
    price_min: overrides.price_min,
    price_max: overrides.price_max,
    currency: cleanCurrency(overrides.currency || request.currency),
    price_type: overrides.price_type || "search_ready",
    confidence: overrides.confidence || "low",
    booking_url: booking || undefined,
    normal_search_url: normal || undefined,
    affiliate_url: affiliate || undefined,
    searched_at: searchedAt,
    expires_at: overrides.expires_at || expiresAt(request.category, new Date(searchedAt)),
    metadata: {
      travelersText: travelerText(request),
      ...(overrides.metadata || {})
    }
  };
}

function rowToResult(row: Record<string, unknown>, cachedRecent: boolean): TravelMarketResult {
  const searchedAt = clean(row.searched_at as string) || nowIso();
  const category = clean(row.category as string) as TravelMarketCategory;
  const storedPriceType = (clean(row.price_type as string) || "unknown") as TravelMarketPriceType;
  const hasPrice = optionalNumber(row.price_amount) != null || optionalNumber(row.price_min) != null || optionalNumber(row.price_max) != null;
  return {
    id: clean(row.id as string) || randomUUID(),
    category,
    title: clean(row.title as string) || "Market option",
    provider: clean(row.provider as string) || "Search",
    source: (clean(row.source as string) || "google_search") as TravelMarketSource,
    origin: clean(row.origin as string) || undefined,
    destination: clean(row.destination as string) || undefined,
    city: clean(row.city as string) || undefined,
    country: clean(row.country as string) || undefined,
    start_date: cleanDate(row.start_date as string) || undefined,
    end_date: cleanDate(row.end_date as string) || undefined,
    travelers: positiveInteger(row.travelers, 0) || undefined,
    rooms: positiveInteger(row.rooms, 0) || undefined,
    room_type: clean(row.room_type as string) || undefined,
    price_amount: optionalNumber(row.price_amount),
    price_min: optionalNumber(row.price_min),
    price_max: optionalNumber(row.price_max),
    currency: cleanCurrency(row.currency as string),
    price_type: cachedRecent && hasPrice ? "cached_recent" : storedPriceType,
    confidence: (clean(row.confidence as string) || "low") as TravelMarketConfidence,
    booking_url: safeExternalUrl(row.booking_url as string) || undefined,
    normal_search_url: safeExternalUrl(row.normal_search_url as string) || undefined,
    affiliate_url: safeExternalUrl(row.affiliate_url as string) || undefined,
    searched_at: searchedAt,
    expires_at: clean(row.expires_at as string) || expiresAt(category || "tour", new Date(searchedAt)),
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {}
  };
}

function databaseRow(result: TravelMarketResult, searchKey: string) {
  return {
    category: result.category,
    provider: result.provider,
    source: result.source,
    origin: result.origin || null,
    destination: result.destination || null,
    city: result.city || null,
    country: result.country || null,
    start_date: result.start_date || null,
    end_date: result.end_date || null,
    travelers: result.travelers || null,
    rooms: result.rooms || null,
    room_type: result.room_type || null,
    title: result.title,
    price_amount: result.price_amount ?? null,
    price_min: result.price_min ?? null,
    price_max: result.price_max ?? null,
    currency: result.currency,
    price_type: result.price_type,
    confidence: result.confidence,
    booking_url: result.booking_url || null,
    normal_search_url: result.normal_search_url || null,
    affiliate_url: result.affiliate_url || null,
    search_key: searchKey,
    searched_at: result.searched_at,
    expires_at: result.expires_at,
    metadata: result.metadata || {}
  };
}

async function cachedResults(
  supabase: SupabaseClient | null | undefined,
  searchKey: string
): Promise<TravelMarketResult[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("roamly_market_prices")
    .select("*")
    .eq("search_key", searchKey)
    .gt("expires_at", nowIso())
    .order("searched_at", { ascending: false })
    .limit(8);

  if (error) {
    if (!isMissingMarketTable(error.message)) console.error("[Roamly market] cache read failed", error.message);
    return [];
  }
  return (data || []).map((row) => rowToResult(row as Record<string, unknown>, true));
}

async function storeResults(
  supabase: SupabaseClient | null | undefined,
  searchKey: string,
  results: TravelMarketResult[]
) {
  if (!supabase || !results.length) return;
  const { error } = await supabase.from("roamly_market_prices").insert(results.map((result) => databaseRow(result, searchKey)));
  if (error && !isMissingMarketTable(error.message)) {
    console.error("[Roamly market] cache write failed", error.message);
  }
}

function marketEnabled() {
  return process.env.ROAMLY_MARKET_SEARCH_ENABLED === "true";
}

function providerConfigured(category: TravelMarketCategory) {
  if (category === "flight") return Boolean(process.env.TRAVELPAYOUTS_API_TOKEN && process.env.ROAMLY_TRAVELPAYOUTS_MARKER);
  if (category === "hotel") return Boolean(process.env.ROAMLY_STAY22_PARTNER_ID || process.env.BOOKING_AFFILIATE_ID || process.env.EXPEDIA_AFFILIATE_ID);
  if (category === "attraction" || category === "tour") {
    return Boolean(
      (process.env.GETYOURGUIDE_API_KEY && process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID) ||
        (process.env.VIATOR_API_KEY && process.env.ROAMLY_VIATOR_PARTNER_ID) ||
        (process.env.KLOOK_API_KEY && process.env.ROAMLY_KLOOK_PARTNER_ID)
    );
  }
  return false;
}

function stay22AffiliateConfigured() {
  return (
    process.env.ROAMLY_AFFILIATES_ENABLED === "true" &&
    clean(process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER).toLowerCase() === "stay22" &&
    Boolean(clean(process.env.ROAMLY_STAY22_PARTNER_ID) || safeExternalUrl(process.env.ROAMLY_STAY22_REFERRAL_URL))
  );
}

function buildTransportOptionsSearchKey(payload: TripPlannerPayload) {
  return [
    "transport_options",
    buildTravelMarketSearchKey({
      category: "transport",
      origin: payload.origin,
      destination: payload.destination,
      city: payload.destinationCity,
      country: payload.destinationCountry,
      start_date: payload.startDate,
      end_date: payload.returnToOrigin === false ? undefined : payload.endDate,
      travelers: payload.travelersCount || payload.travelers?.adults || 1,
      currency: payload.budgetCurrency || "CAD"
    })
  ].join("|");
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return (await response.json()) as unknown;
}

function arrayFromUnknown(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["data", "results", "items", "products", "tours"]) {
      if (Array.isArray(record[key])) return arrayFromUnknown(record[key]);
    }
  }
  return [];
}

function providerPrice(value: Record<string, unknown>) {
  return optionalNumber(value.price) ?? optionalNumber(value.amount) ?? optionalNumber(value.value) ?? optionalNumber(value.fromPrice);
}

async function searchTravelpayouts(request: TravelMarketSearchRequest) {
  if (!marketEnabled() || !process.env.TRAVELPAYOUTS_API_TOKEN || !process.env.ROAMLY_TRAVELPAYOUTS_MARKER) return [];
  const url = new URL("https://api.travelpayouts.com/aviasales/v3/prices_for_dates");
  url.searchParams.set("origin", clean(request.origin));
  url.searchParams.set("destination", clean(request.destination || request.city));
  url.searchParams.set("departure_at", cleanDate(request.start_date));
  if (cleanDate(request.end_date)) url.searchParams.set("return_at", cleanDate(request.end_date));
  url.searchParams.set("currency", cleanCurrency(request.currency));
  url.searchParams.set("token", process.env.TRAVELPAYOUTS_API_TOKEN);
  const json = await fetchJson(url.toString());
  return arrayFromUnknown(json)
    .map((item) => {
      const price = providerPrice(item);
      if (price == null) return null;
      const link = clean(item.link as string);
      const bookingUrl = link
        ? `https://www.aviasales.com${link.startsWith("/") ? link : `/${link}`}&marker=${encodeURIComponent(process.env.ROAMLY_TRAVELPAYOUTS_MARKER || "")}`
        : undefined;
      return baseResult(request, {
        title: `${clean(request.origin) || "Origin"} to ${clean(request.destination || request.city)} flight`,
        provider: "Travelpayouts",
        source: "travelpayouts",
        price_amount: price,
        price_type: "live_partner",
        confidence: "high",
        booking_url: bookingUrl,
        metadata: { providerPayload: item }
      });
    })
    .filter((item): item is TravelMarketResult => Boolean(item))
    .slice(0, 5);
}

async function searchGetYourGuide(request: TravelMarketSearchRequest) {
  if (!marketEnabled() || !process.env.GETYOURGUIDE_API_KEY || !process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID) return [];
  const url = new URL("https://api.getyourguide.com/1/tours");
  url.searchParams.set("q", clean(request.title || request.destination || request.city));
  url.searchParams.set("currency", cleanCurrency(request.currency));
  const json = await fetchJson(url.toString(), {
    headers: {
      "x-access-token": process.env.GETYOURGUIDE_API_KEY,
      accept: "application/json"
    }
  });
  return arrayFromUnknown(json)
    .map((item) => {
      const price = providerPrice(item);
      if (price == null) return null;
      return baseResult(request, {
        title: clean(item.title as string) || categoryDefaultTitle(request),
        provider: "GetYourGuide",
        source: "getyourguide",
        price_amount: price,
        price_type: "live_partner",
        confidence: "high",
        booking_url: safeExternalUrl(item.url as string) || undefined,
        metadata: { providerPayload: item }
      });
    })
    .filter((item): item is TravelMarketResult => Boolean(item))
    .slice(0, 5);
}

async function searchViator(request: TravelMarketSearchRequest) {
  if (!marketEnabled() || !process.env.VIATOR_API_KEY || !process.env.ROAMLY_VIATOR_PARTNER_ID) return [];
  const json = await fetchJson("https://api.viator.com/partner/products/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "exp-api-key": process.env.VIATOR_API_KEY,
      accept: "application/json"
    },
    body: JSON.stringify({
      searchTerm: clean(request.title || request.destination || request.city),
      currency: cleanCurrency(request.currency),
      startDate: cleanDate(request.start_date),
      endDate: cleanDate(request.end_date || request.start_date)
    })
  });
  return arrayFromUnknown(json)
    .map((item) => {
      const price = providerPrice(item);
      if (price == null) return null;
      return baseResult(request, {
        title: clean(item.title as string) || categoryDefaultTitle(request),
        provider: "Viator",
        source: "viator",
        price_amount: price,
        price_type: "live_partner",
        confidence: "high",
        booking_url: safeExternalUrl(item.productUrl as string) || safeExternalUrl(item.url as string) || undefined,
        metadata: { providerPayload: item }
      });
    })
    .filter((item): item is TravelMarketResult => Boolean(item))
    .slice(0, 5);
}

async function searchKlook(request: TravelMarketSearchRequest) {
  if (!marketEnabled() || !process.env.KLOOK_API_KEY || !process.env.ROAMLY_KLOOK_PARTNER_ID) return [];
  const url = new URL("https://www.klook.com/v1/usrcsrv/search");
  url.searchParams.set("query", clean(request.title || request.destination || request.city));
  url.searchParams.set("currency", cleanCurrency(request.currency));
  const json = await fetchJson(url.toString(), {
    headers: {
      authorization: `Bearer ${process.env.KLOOK_API_KEY}`,
      accept: "application/json"
    }
  });
  return arrayFromUnknown(json)
    .map((item) => {
      const price = providerPrice(item);
      if (price == null) return null;
      return baseResult(request, {
        title: clean(item.title as string) || categoryDefaultTitle(request),
        provider: "Klook",
        source: "klook",
        price_amount: price,
        price_type: "live_partner",
        confidence: "high",
        booking_url: safeExternalUrl(item.url as string) || undefined,
        metadata: { providerPayload: item }
      });
    })
    .filter((item): item is TravelMarketResult => Boolean(item))
    .slice(0, 5);
}

async function liveProviderResults(request: TravelMarketSearchRequest) {
  if (request.category === "flight") return searchTravelpayouts(request);
  if (request.category === "attraction" || request.category === "tour") {
    const providers = await Promise.allSettled([searchGetYourGuide(request), searchViator(request), searchKlook(request)]);
    return providers.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  }
  return [];
}

function searchReadyResult(request: TravelMarketSearchRequest, warning?: string) {
  const source: TravelMarketSource = request.category === "hotel" && stay22AffiliateConfigured() ? "stay22" : "google_search";
  return baseResult(request, {
    provider: source === "stay22" ? "Stay22 search" : "Search-ready link",
    source,
    price_type: "search_ready",
    confidence: "low",
    metadata: {
      warning: warning || "No live provider price was returned. Verify price and availability before booking."
    }
  });
}

export async function searchTravelMarket(
  request: TravelMarketSearchRequest,
  options: {
    supabase?: SupabaseClient | null;
    forceRefresh?: boolean;
    store?: boolean;
  } = {}
): Promise<TravelMarketSearchResponse> {
  const normalized: TravelMarketSearchRequest = {
    ...request,
    currency: cleanCurrency(request.currency),
    start_date: cleanDate(request.start_date),
    end_date: cleanDate(request.end_date),
    travelers: positiveInteger(request.travelers, 1),
    rooms: request.category === "hotel" ? positiveInteger(request.rooms, 1) : positiveInteger(request.rooms, 0)
  };
  const searchKey = buildTravelMarketSearchKey(normalized);
  const configured = providerConfigured(normalized.category);

  if (!options.forceRefresh) {
    const cached = await cachedResults(options.supabase, searchKey);
    if (cached.length) {
      return { results: cached, cacheHit: true, searchKey, providerConfigured: configured, providerAttempted: false };
    }
  }

  let providerResults: TravelMarketResult[] = [];
  let providerAttempted = false;
  if (configured && marketEnabled()) {
    providerAttempted = true;
    try {
      providerResults = await liveProviderResults(normalized);
    } catch (error) {
      console.error("[Roamly market] provider search failed", error);
    }
  }

  const warning = configured
    ? "Provider did not return a numeric live price. Verify the search result before booking."
    : "Provider credentials are not configured. Verify price and availability before booking.";
  const results = providerResults.length ? providerResults : [searchReadyResult(normalized, warning)];

  if (options.store !== false) {
    await storeResults(options.supabase, searchKey, results);
  }

  return {
    results,
    cacheHit: false,
    searchKey,
    providerConfigured: configured,
    providerAttempted,
    warning: providerResults.length ? undefined : warning
  };
}

function placeLabel(place: NormalizedPlace | undefined, fallback: string) {
  return place?.value || place?.label || fallback;
}

function tripDestinations(payload: Pick<TripPlannerPayload, "tripType" | "destination" | "destinationStops" | "destinationPlace">) {
  if (payload.tripType === "multi_city" && payload.destinationStops?.length) return payload.destinationStops;
  if (payload.destinationPlace) return [payload.destinationPlace];
  return [{ label: payload.destination, value: payload.destination, source: "custom" as const }];
}

function attractionTitle(destination: string) {
  if (/montreal|montr[eé]al/i.test(destination)) return "Notre-Dame Basilica Admission Ticket";
  return `${destination} top attraction ticket`;
}

function tourTitle(destination: string, interests: string[] = []) {
  const text = interests.join(" ").toLowerCase();
  if (/montreal|montr[eé]al/i.test(destination) && text.includes("food")) return "Old Montreal food tasting tour";
  if (text.includes("food")) return `${destination} food tasting tour`;
  if (text.includes("nightlife")) return `${destination} evening guided experience`;
  return `${destination} walking highlights tour`;
}

export function buildTripMarketSearchRequests(payload: TripPlannerPayload): TravelMarketSearchRequest[] {
  const destinations = tripDestinations(payload);
  const firstDestination = destinations[0];
  const firstDestinationLabel = placeLabel(firstDestination, payload.destination);
  const travelers = payload.travelersCount || payload.travelers?.adults || 1;
  const currency = payload.budgetCurrency || "CAD";
  const requests: TravelMarketSearchRequest[] = [];

  if (payload.budgetIncludesFlights !== false && payload.origin && firstDestinationLabel) {
    requests.push({
      category: "flight",
      origin: payload.origin,
      destination: firstDestinationLabel,
      city: firstDestination?.city || firstDestinationLabel,
      country: firstDestination?.country || payload.destinationCountry,
      start_date: payload.startDate,
      end_date: payload.returnToOrigin === false ? undefined : payload.endDate,
      travelers,
      currency
    });
  }

  for (const destination of destinations.slice(0, 4)) {
    const destinationLabel = placeLabel(destination, payload.destination);
    requests.push({
      category: "hotel",
      destination: destinationLabel,
      city: destination.city || destinationLabel,
      country: destination.country || payload.destinationCountry,
      start_date: payload.startDate,
      end_date: payload.endDate,
      travelers,
      rooms: payload.rooms || 1,
      room_type: payload.bedPreference && payload.bedPreference !== "No preference" ? payload.bedPreference : "Standard queen room",
      currency
    });

    if (payload.budgetIncludesActivities !== false) {
      requests.push({
        category: "attraction",
        destination: destinationLabel,
        city: destination.city || destinationLabel,
        country: destination.country || payload.destinationCountry,
        start_date: payload.startDate,
        travelers,
        title: attractionTitle(destinationLabel),
        currency
      });
      requests.push({
        category: "tour",
        destination: destinationLabel,
        city: destination.city || destinationLabel,
        country: destination.country || payload.destinationCountry,
        start_date: payload.startDate,
        travelers,
        title: tourTitle(destinationLabel, payload.interests),
        currency
      });
    }

    requests.push({
      category: "transport",
      origin: payload.origin,
      destination: destinationLabel,
      city: destination.city || destinationLabel,
      country: destination.country || payload.destinationCountry,
      start_date: payload.startDate,
      travelers,
      title: `${destinationLabel} airport transfer and local transit`,
      currency
    });
  }

  return requests;
}

export async function searchTripMarketPrices(
  payload: TripPlannerPayload,
  options: {
    supabase?: SupabaseClient | null;
    forceRefresh?: boolean;
    store?: boolean;
  } = {}
) {
  const responses = await Promise.all(
    buildTripMarketSearchRequests(payload).map((request) => searchTravelMarket(request, options))
  );
  const baseResults = responses.flatMap((response) => response.results);
  const transportComparison = compareTransportOptions(payload, { marketResults: baseResults });
  const transportResults = transportOptionsToMarketResults(payload, transportComparison.options);

  if (options.store !== false && transportResults.length) {
    await storeResults(options.supabase, buildTransportOptionsSearchKey(payload), transportResults);
  }

  return {
    responses,
    results: [...baseResults, ...transportResults],
    searchedAt: nowIso(),
    providerWarnings: responses.map((response) => response.warning).filter((warning): warning is string => Boolean(warning))
  };
}
