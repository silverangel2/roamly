import type { RoamlyItinerary } from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { ROAMLY_AFFILIATE_DISCLOSURE } from "@/lib/roamly/emailTemplates";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  roamlyDiscoveryUrl,
  safeExternalUrl
} from "@/lib/roamly/bookingLinks";
import { isLegacyBookingUrl, resolveAffiliateLink, testAffiliateLinks, type AffiliateCategory } from "@/lib/roamly/affiliateResolver";

export type RoamlyBookingCategory = "hotel" | "flight" | "attraction" | "ticket" | "tour" | "transport" | "car_rental" | "restaurant" | "insurance";

export type RoamlyAffiliateInput = {
  category?: RoamlyBookingCategory;
  destination?: string | null;
  origin?: string | null;
  title?: string | null;
  query?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelers?: number | { adults?: number | null; children?: number | null; infants?: number | null } | null;
  adults?: number | null;
  children?: number | null;
  rooms?: number | null;
  neighborhood?: string | null;
  roomType?: string | null;
  date?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  url?: string | null;
};

export type RoamlyAffiliateLink = {
  title: string;
  label: string;
  description: string;
  href: string;
  affiliate_provider: string;
  affiliate_url: string;
  affiliate_enabled: boolean;
  affiliate_disclosure: string;
  booking_category: RoamlyBookingCategory;
};

export const affiliateDisclosure =
  ROAMLY_AFFILIATE_DISCLOSURE;

function enabled() {
  return process.env.ROAMLY_AFFILIATES_ENABLED === "true";
}

function clean(value?: string | null) {
  return (value || "").trim();
}

function stay22PartnerId() {
  return clean(process.env.ROAMLY_STAY22_PARTNER_ID);
}

function stay22ReferralUrl() {
  return safeExternalUrl(process.env.ROAMLY_STAY22_REFERRAL_URL);
}

function hasConfiguredHotelAffiliateProvider(provider: string) {
  if (provider === "stay22") return Boolean(stay22PartnerId() || stay22ReferralUrl());
  return false;
}

function klookPartnerId() {
  return clean(process.env.ROAMLY_KLOOK_PARTNER_ID);
}

function klookReferralUrl() {
  return safeExternalUrl(process.env.ROAMLY_KLOOK_REFERRAL_URL);
}

function hasConfiguredAttractionsAffiliateProvider(provider: string) {
  if (provider === "klook") return Boolean(klookPartnerId() || klookReferralUrl());
  return false;
}

function resolverResult(input: RoamlyAffiliateInput, category: RoamlyBookingCategory) {
  const resolved = resolveAffiliateLink({
    category: category === "attraction" || category === "ticket" ? "activity" : category,
    destination: input.destination,
    origin: input.origin,
    title: input.title,
    query: input.query,
    startDate: input.startDate,
    endDate: input.endDate,
    travelers: input.travelers,
    adults: input.adults,
    children: input.children,
    rooms: input.rooms,
    neighborhood: input.neighborhood,
    roomType: input.roomType,
    activityType: input.query || input.title,
    productKeyword: input.query || input.title
  });

  return {
    href: resolved.finalUrl,
    affiliate_provider: resolved.disclosureRequired ? resolved.provider : "roamly_internal",
    affiliate_url: resolved.disclosureRequired ? resolved.finalUrl : "",
    affiliate_enabled: resolved.disclosureRequired,
    affiliate_disclosure: resolved.disclosure,
    booking_category: category
  };
}

export function buildHotelAffiliateUrl(input: RoamlyAffiliateInput) {
  return resolverResult(input, "hotel");
}

export function buildFlightAffiliateUrl(input: RoamlyAffiliateInput) {
  return resolverResult(input, "flight");
}

export function buildAttractionAffiliateUrl(input: RoamlyAffiliateInput) {
  const category = input.category === "ticket" || input.category === "attraction" ? input.category : "tour";
  return resolverResult(input, category);
}

export function buildTransportAffiliateUrl(input: RoamlyAffiliateInput) {
  return resolverResult(input, "transport");
}

export function buildRoamlyAffiliateUrl(input: RoamlyAffiliateInput) {
  if (input.category === "hotel") return buildHotelAffiliateUrl(input);
  if (input.category === "flight") return buildFlightAffiliateUrl(input);
  if (input.category === "transport") return buildTransportAffiliateUrl(input);
  if (input.category === "attraction" || input.category === "ticket" || input.category === "tour") {
    return buildAttractionAffiliateUrl(input);
  }
  if (input.category === "car_rental") {
    return resolverResult(input, "car_rental");
  }
  if (input.category === "restaurant") {
    return resolverResult(input, "restaurant");
  }
  return resolverResult(input, input.category || "insurance");
}

export function attachAffiliateMetadata<T extends Record<string, unknown>>(item: T, input?: RoamlyAffiliateInput) {
  const link = buildRoamlyAffiliateUrl({
    category: (item.booking_category as RoamlyBookingCategory | undefined) || input?.category,
    destination: (item.destination as string | undefined) || input?.destination,
    title: (item.title as string | undefined) || input?.title,
    query: (item.query as string | undefined) || input?.query,
    url: (item.url as string | undefined) || input?.url
  });
  return {
    ...item,
    affiliate_provider: link.affiliate_provider,
    affiliate_url: link.affiliate_url,
    affiliate_enabled: link.affiliate_enabled,
    affiliate_disclosure: link.affiliate_disclosure,
    booking_category: link.booking_category
  };
}

export function getRoamlyBookingLinks(input: {
  destination?: string | null;
  origin?: string | null;
}) {
  const destination = clean(input.destination) || "your destination";
  const hotel = buildHotelAffiliateUrl({ destination, category: "hotel" });
  const flight = buildFlightAffiliateUrl({ destination, origin: input.origin, category: "flight" });
  const activity = buildAttractionAffiliateUrl({ destination, query: `${destination} activities`, category: "attraction" });
  const tours = buildAttractionAffiliateUrl({ destination, query: `${destination} tours`, category: "tour" });
  const transport = buildTransportAffiliateUrl({ destination, query: `${destination} transport`, category: "transport" });

  return [
    {
      title: "Search-ready stays near your trip area",
      label: "Find a stay",
      description: "Open stay options near the recommended neighborhoods and verify room type, taxes, and availability.",
      ...hotel
    },
    {
      title: "Flights to your destination",
      label: "Find flights",
      description: "Search flight options for this trip.",
      ...flight
    },
    {
      title: "Activities that match the itinerary",
      label: "Book activities",
      description: "Find bookable things to do that fit your plan.",
      ...activity
    },
    {
      title: "Tours and local experiences",
      label: "Find tours",
      description: "Compare guided tours and experiences.",
      ...tours
    },
    {
      title: "Directions for your route",
      label: "Open directions",
      description: "Open maps or local directions search.",
      ...transport
    },
    {
      title: "Transport options",
      label: "Find transport",
      description: "Search trains, buses, airport transfers, and local transport.",
      ...buildTransportAffiliateUrl({ destination, query: `${destination} train bus airport transfer public transit`, category: "transport" })
    }
  ] satisfies RoamlyAffiliateLink[];
}

function normalSearchUrlForSuggestion(
  suggestion: RoamlyItinerary["booking_suggestions"][number],
  payload: TripPlannerPayload
) {
  const travelers = payload.travelers || { adults: payload.travelersCount || 1, children: 0, infants: 0 };
  const adults = travelers.adults || payload.travelersCount || 1;
  const children = travelers.children || 0;
  const destination = suggestion.destination || suggestion.city || payload.destination;
  const date = suggestion.date || suggestion.departure_date || payload.startDate;

  if (suggestion.booking_category === "flight" || suggestion.category === "flight") {
    return buildFlightSearchUrl({
      origin: suggestion.origin || payload.origin,
      destination,
      departureDate: suggestion.departure_date || payload.startDate,
      returnDate: suggestion.return_date || payload.endDate,
      travelers
    });
  }

  if (suggestion.booking_category === "hotel" || suggestion.category === "hotel") {
    return buildHotelSearchUrl({
      destination,
      checkInDate: payload.startDate,
      checkOutDate: payload.endDate,
      adults,
      children,
      rooms: payload.rooms || 1,
      neighborhood: suggestion.neighborhood || suggestion.location,
      roomType: suggestion.room_type
    });
  }

  if (suggestion.booking_category === "attraction" || suggestion.category === "attraction") {
    return buildAttractionTicketSearchUrl({
      attractionName: suggestion.title || suggestion.booking_label,
      destination,
      date
    });
  }

  if (suggestion.booking_category === "tour" || suggestion.category === "tour") {
    return buildTourSearchUrl({
      tourName: suggestion.title || suggestion.booking_label,
      destination,
      date
    });
  }

  if (suggestion.booking_category === "transport" || suggestion.category === "transport" || suggestion.category === "car_rental") {
    return buildTransportSearchUrl({
      origin: suggestion.origin || payload.origin,
      destination: suggestion.destination || suggestion.location || destination,
      date
    });
  }

  return roamlyDiscoveryUrl("discovery", `${suggestion.title || suggestion.booking_label} ${destination}`);
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function marketResultsFromPayload(payload: TripPlannerPayload) {
  const discovery = getRecord(payload.priceDiscovery);
  const selected = Array.isArray(discovery?.selectedMarketPrices) ? discovery.selectedMarketPrices : [];
  const all = Array.isArray(discovery?.marketResults) ? discovery.marketResults : [];
  return [...selected, ...all]
    .map(getRecord)
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function cleanNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function cleanStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeBookingHref(value: unknown) {
  const raw = cleanStringValue(value);
  if (!raw || isLegacyBookingUrl(raw)) return "";
  if (raw.startsWith("/")) return raw;
  return safeExternalUrl(raw);
}

function approvedMarketAffiliateUrl(market: Record<string, unknown> | null, link: ReturnType<typeof buildRoamlyAffiliateUrl>) {
  const source = cleanStringValue(market?.source);
  const affiliate = safeBookingHref(market?.affiliate_url);
  if (affiliate && ["travelpayouts", "stay22", "klook"].includes(source)) return affiliate;
  return link.affiliate_enabled ? link.affiliate_url : "";
}

function approvedSourceLabel(value: unknown) {
  const source = cleanStringValue(value);
  return source === "google_search" ? "" : source;
}

function approvedProviderLabel(value: unknown) {
  const label = cleanStringValue(value);
  return /\b(google flights|booking\.com|google search|google travel|getyourguide|viator)\b/i.test(label) ? "" : label;
}

function marketResultRank(result: Record<string, unknown>) {
  const type = result.price_type;
  if (result.metadata && typeof result.metadata === "object" && (result.metadata as Record<string, unknown>).source === "user_uploaded_confirmation") return 0;
  if (type === "live_partner") return 1;
  if (type === "cached_recent") return 2;
  if (type === "search_ready") return 3;
  if (type === "estimated_fallback") return 4;
  return 5;
}

function titleOverlap(a: string, b: string) {
  const left = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4));
  const right = b.toLowerCase().split(/[^a-z0-9]+/).filter((part) => part.length >= 4);
  return right.some((part) => left.has(part));
}

function pickMarketResult(
  suggestion: RoamlyItinerary["booking_suggestions"][number],
  payload: TripPlannerPayload
) {
  const category = suggestion.booking_category || suggestion.category;
  const title = suggestion.title || suggestion.booking_label;
  const sameCategory = marketResultsFromPayload(payload)
    .filter((result) => result.category === category)
    .sort((a, b) => marketResultRank(a) - marketResultRank(b));
  if (!sameCategory.length) return null;
  return (
    sameCategory.find((result) => titleOverlap(cleanStringValue(result.title), title)) ||
    sameCategory.find((result) => cleanNumber(result.price_amount) != null || cleanNumber(result.price_max) != null || cleanNumber(result.price_min) != null) ||
    sameCategory[0]
  );
}

function marketPriceRange(result: Record<string, unknown>) {
  const amount = cleanNumber(result.price_amount);
  const min = cleanNumber(result.price_min);
  const max = cleanNumber(result.price_max);
  if (amount != null) return { min: Math.round(amount), max: Math.round(amount) };
  if (min != null || max != null) return { min: min == null ? null : Math.round(min), max: max == null ? null : Math.round(max) };
  return { min: null, max: null };
}

function marketPriceConfidence(result: Record<string, unknown>) {
  if (result.metadata && typeof result.metadata === "object" && (result.metadata as Record<string, unknown>).source === "user_uploaded_confirmation") {
    return "user_uploaded" as const;
  }
  if (result.price_type === "live_partner" || result.price_type === "cached_recent") return "partner" as const;
  if (result.price_type === "estimated_fallback") return "estimated" as const;
  return "unknown" as const;
}

function timelineAffiliateCategory(item: RoamlyItinerary["daily_itinerary"][number]["live_timeline"][number]): AffiliateCategory | null {
  const explicit = cleanStringValue(item.affiliate_category).toLowerCase();
  if (
    explicit === "flight" ||
    explicit === "hotel" ||
    explicit === "activity" ||
    explicit === "attraction" ||
    explicit === "ticket" ||
    explicit === "tour" ||
    explicit === "transport" ||
    explicit === "car_rental" ||
    explicit === "restaurant" ||
    explicit === "product" ||
    explicit === "esim"
  ) {
    return explicit as AffiliateCategory;
  }
  const text = `${item.item_type || ""} ${item.category || ""} ${item.title || ""} ${item.booking_label || ""}`.toLowerCase();
  if (/\bflight|airport|plane|airfare\b/.test(text)) return "flight";
  if (/\bhotel|stay|room|check[- ]?in|check[- ]?out|luggage\b/.test(text)) return "hotel";
  if (/\btransfer|shuttle|train|bus|ferry|transport|station|terminal\b/.test(text)) return "transport";
  if (/\btour|experience|activity|ticket|admission|attraction\b/.test(text)) return "activity";
  if (/\be-?sim|roaming|mobile data\b/.test(text)) return "esim";
  if (/\bluggage|adapter|packing|gear\b/.test(text)) return "product";
  return item.booking_label ? "activity" : null;
}

function ctaLabelForTimeline(category: AffiliateCategory, label?: string | null) {
  const cleaned = cleanStringValue(label);
  if (cleaned) return cleaned;
  if (category === "flight") return "Check flights";
  if (category === "hotel") return "Find a hotel";
  if (category === "transport") return "Book transfer";
  if (category === "esim") return "Get an eSIM";
  if (category === "product") return "Shop travel gear";
  return "Book activity";
}

function enrichTimelineItems(itinerary: RoamlyItinerary, payload: TripPlannerPayload): RoamlyItinerary["daily_itinerary"] {
  const travelers = payload.travelers || payload.travelersCount || 1;
  return itinerary.daily_itinerary.map((day) => ({
    ...day,
    live_timeline: day.live_timeline.map((item) => {
      const category = timelineAffiliateCategory(item);
      if (!category) return item;
      const title = item.title || item.booking_label || day.title;
      const resolved = resolveAffiliateLink({
        category,
        origin: item.origin || payload.origin,
        destination: item.destination || item.location_name || payload.destination,
        title,
        query: category === "flight" ? undefined : title,
        startDate: day.date || payload.startDate,
        endDate: payload.endDate,
        travelers,
        adults: payload.travelers?.adults || payload.travelersCount || 1,
        children: payload.travelers?.children || 0,
        rooms: payload.rooms || 1,
        route: item.origin && item.destination ? `${item.origin} to ${item.destination}` : undefined,
        activityType: title,
        productKeyword: title,
        currency: payload.budgetCurrency,
        locale: payload.language
      });
      return {
        ...item,
        affiliate_category: category === "activity" || category === "ticket" ? "attraction" : category === "esim" || category === "product" ? category : (category as typeof item.affiliate_category),
        booking_label: ctaLabelForTimeline(category, item.booking_label || resolved.ctaLabel),
        booking: {
          provider: resolved.provider,
          url: resolved.finalUrl,
          ctaLabel: ctaLabelForTimeline(category, item.booking_label || resolved.ctaLabel),
          disclosureRequired: resolved.disclosureRequired
        }
      };
    })
  }));
}

export function enrichItineraryBookingSuggestions(itinerary: RoamlyItinerary, payload: TripPlannerPayload): RoamlyItinerary {
  return {
    ...itinerary,
    daily_itinerary: enrichTimelineItems(itinerary, payload),
    booking_suggestions: itinerary.booking_suggestions.map((suggestion) => {
      const normalSearchUrl = normalSearchUrlForSuggestion(suggestion, payload);
      const market = pickMarketResult(suggestion, payload);
      const marketRange = market ? marketPriceRange(market) : { min: null, max: null };
      const link = buildRoamlyAffiliateUrl({
        category: suggestion.booking_category,
        destination: suggestion.destination || suggestion.city || payload.destination,
        origin: suggestion.origin || payload.origin,
        title: suggestion.title || suggestion.booking_label,
        query: suggestion.booking_category === "flight" ? undefined : suggestion.title || suggestion.booking_label,
        startDate: suggestion.departure_date || suggestion.date || payload.startDate,
        endDate: suggestion.return_date || payload.endDate,
        travelers: payload.travelers || payload.travelersCount || 1,
        adults: payload.travelers?.adults || payload.travelersCount || 1,
        children: payload.travelers?.children || 0,
        rooms: payload.rooms || 1,
        neighborhood: suggestion.neighborhood || suggestion.location,
        roomType: suggestion.room_type,
        date: suggestion.date || suggestion.departure_date || payload.startDate,
        url: suggestion.normal_search_url
      });
      return {
        ...suggestion,
        provider: approvedProviderLabel(market?.provider) || approvedProviderLabel(suggestion.provider) || (link.affiliate_enabled ? `${link.affiliate_provider} partner link` : "Roamly discovery"),
        provider_or_search_source:
          approvedSourceLabel(market?.source) ||
          approvedProviderLabel(suggestion.provider_or_search_source) ||
          approvedProviderLabel(suggestion.provider) ||
          (link.affiliate_enabled ? `${link.affiliate_provider} partner link` : "Roamly discovery"),
        normal_search_url:
          safeBookingHref(market?.normal_search_url) ||
          safeBookingHref(suggestion.normal_search_url) ||
          safeBookingHref(normalSearchUrl) ||
          (!link.affiliate_enabled ? link.href : ""),
        affiliate_url: approvedMarketAffiliateUrl(market, link),
        affiliate_provider: link.affiliate_enabled ? link.affiliate_provider : "roamly_internal",
        affiliate_disclosure: link.affiliate_enabled ? affiliateDisclosure : "",
        booking_status:
          market?.metadata && typeof market.metadata === "object" && (market.metadata as Record<string, unknown>).source === "user_uploaded_confirmation"
            ? "user_uploaded"
            : suggestion.booking_status,
        estimated_cost_min: marketRange.min ?? suggestion.estimated_cost_min,
        estimated_cost_max: marketRange.max ?? suggestion.estimated_cost_max,
        estimated_total_cost_min:
          suggestion.booking_category === "hotel" ? marketRange.min ?? suggestion.estimated_total_cost_min : suggestion.estimated_total_cost_min,
        estimated_total_cost_max:
          suggestion.booking_category === "hotel" ? marketRange.max ?? suggestion.estimated_total_cost_max : suggestion.estimated_total_cost_max,
        currency: cleanStringValue(market?.currency) || suggestion.currency,
        price_confidence: market ? marketPriceConfidence(market) : suggestion.price_confidence || "estimated",
        market_source: cleanStringValue(market?.source) as RoamlyItinerary["booking_suggestions"][number]["market_source"],
        price_type: cleanStringValue(market?.price_type) as RoamlyItinerary["booking_suggestions"][number]["price_type"],
        market_confidence: cleanStringValue(market?.confidence) as RoamlyItinerary["booking_suggestions"][number]["market_confidence"],
        searched_at: cleanStringValue(market?.searched_at) || suggestion.searched_at,
        expires_at: cleanStringValue(market?.expires_at) || suggestion.expires_at,
        market_search_key: cleanStringValue(market?.search_key) || suggestion.market_search_key
      };
    })
  };
}

export function getAffiliateReadiness() {
  const hotelProvider = clean(process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER).toLowerCase();
  const attractionsProvider = clean(process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER).toLowerCase();
  const linkTest = testAffiliateLinks();

  return {
    affiliatesEnabled: enabled(),
    hotelProviderConfigured: hasConfiguredHotelAffiliateProvider(hotelProvider),
    flightProviderConfigured: clean(process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER).toLowerCase() === "travelpayouts" && Boolean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER),
    attractionsProviderConfigured: hasConfiguredAttractionsAffiliateProvider(attractionsProvider),
    stay22PartnerConfigured: Boolean(stay22PartnerId() || stay22ReferralUrl()),
    travelpayoutsMarkerConfigured: Boolean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER),
    klookPartnerConfigured: Boolean(klookPartnerId() || klookReferralUrl()),
    amazonPartnerConfigured: process.env.ROAMLY_AMAZON_ENABLED === "true" && Boolean(process.env.ROAMLY_AMAZON_ASSOCIATE_TAG),
    esimPartnerConfigured: Boolean(process.env.ROAMLY_ESIM_REFERRAL_URL || process.env.ROAMLY_ESIM_AFFILIATE_ID),
    providerStatuses: linkTest.statuses,
    linkTest
  };
}
