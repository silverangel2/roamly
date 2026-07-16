import type { RoamlyItinerary } from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { ROAMLY_AFFILIATE_DISCLOSURE } from "@/lib/roamly/emailTemplates";
import {
  buildAttractionTicketSearchUrl,
  buildAviasalesDeepLink,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  roamlyDiscoveryUrl,
  safeExternalUrl
} from "@/lib/roamly/bookingLinks";
import { isLegacyBookingUrl, isTravelerSafeStay22Url, resolveAffiliateLink, testAffiliateLinks, type AffiliateCategory } from "@/lib/roamly/affiliateResolver";
import { calculateRoamlyBudgetBrain, type RoamlyBudgetBrainPlan } from "@/lib/roamly/budgetBrain";
import { resolveCityPlace } from "@/lib/roamly/placeResolver";

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
  const value = clean(process.env.ROAMLY_AFFILIATES_ENABLED).toLowerCase();
  return value !== "false" && value !== "0" && value !== "disabled";
}

function clean(value?: string | null) {
  return (value || "").trim();
}

function stay22PartnerId() {
  return clean(process.env.ROAMLY_STAY22_PARTNER_ID);
}

function stay22SmartLinkUrl() {
  const url = safeExternalUrl(process.env.ROAMLY_STAY22_SMART_LINK_URL);
  return isTravelerSafeStay22Url(url) ? url : "";
}

function stay22ReferralUrl() {
  const url = safeExternalUrl(process.env.ROAMLY_STAY22_REFERRAL_URL);
  return isTravelerSafeStay22Url(url) ? url : "";
}

function hasConfiguredHotelAffiliateProvider(provider: string) {
  if (provider === "stay22") return Boolean(stay22PartnerId() || stay22SmartLinkUrl() || stay22ReferralUrl());
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
  if (raw.startsWith("/")) return "";
  const external = safeExternalUrl(raw);
  if (!external) return "";
  try {
    const host = new URL(external).hostname.toLowerCase();
    if (host.includes("stay22.com") && !isTravelerSafeStay22Url(external)) return "";
  } catch {
    return "";
  }
  return external;
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

function unavailableTrainOrBusSuggestion(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  const category = suggestion.booking_category || suggestion.category;
  if (category !== "transport") return false;
  const text = `${suggestion.title} ${suggestion.description} ${suggestion.why_recommended || ""} ${suggestion.provider || ""}`.toLowerCase();
  if (!/\b(train|rail|bus)\b/.test(text)) return false;
  return /\b(not available|not recommended|did not find|unverified|too long|route not available)\b/.test(text);
}

function affiliateCategoryForSuggestion(suggestion: RoamlyItinerary["booking_suggestions"][number]): RoamlyBookingCategory {
  const category = suggestion.booking_category || suggestion.category;
  const text = `${suggestion.title} ${suggestion.description}`.toLowerCase();
  if (category === "transport" && /\b(then fly|flight option|flight search|round-trip flight)\b/.test(text)) return "flight";
  return category;
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
  if (category === "flight") return "Compare flights";
  if (category === "hotel") return "Find a hotel";
  if (category === "transport") return "Book transfer";
  if (category === "esim") return "Get an eSIM";
  if (category === "product") return "Shop travel gear";
  return "Book activity";
}

type ItineraryTransportOption = NonNullable<RoamlyItinerary["estimated_budget_breakdown"]["transport_options"]>[number];

function transportFlightOrigin(option: ItineraryTransportOption) {
  const title = cleanStringValue(option.title);
  const mixed = title.match(/drive to\s+(.+?),\s+then fly/i);
  return cleanStringValue(mixed?.[1]) || option.origin;
}

function affiliateFlightHrefForTransport(option: ItineraryTransportOption, payload: TripPlannerPayload) {
  const origin = transportFlightOrigin(option);
  const destination = option.destination || payload.destination;
  const travelers = payload.travelers?.adults || payload.travelersCount || 1;

  const aviasalesDeepLink = buildAviasalesDeepLink({
    origin,
    destination,
    departureDate: option.departure_date || payload.startDate,
    returnDate: option.return_date || payload.endDate,
    travelers,
    marker: process.env.ROAMLY_TRAVELPAYOUTS_MARKER
  });

  if (aviasalesDeepLink) {
    return safeBookingHref(aviasalesDeepLink);
  }

  return safeBookingHref(
    resolveAffiliateLink({
      category: "flight",
      origin,
      destination,
      title: option.title,
      startDate: option.departure_date || payload.startDate,
      endDate: option.return_date || payload.endDate,
      travelers: payload.travelers || payload.travelersCount || 1,
      adults: travelers,
      currency: option.currency || payload.budgetCurrency,
      locale: payload.language
    }).finalUrl
  );
}

function directionsHrefForTransport(option: ItineraryTransportOption) {
  return safeBookingHref(option.booking_url) || safeBookingHref(option.search_url) || safeBookingHref(
    buildTransportSearchUrl({
      origin: option.origin,
      destination: option.destination,
      date: option.departure_date
    })
  );
}

function enrichTransportOption(option: ItineraryTransportOption, payload: TripPlannerPayload): ItineraryTransportOption {
  if (option.mode === "flight" || option.mode === "mixed") {
    const href = affiliateFlightHrefForTransport(option, payload);
    return {
      ...option,
      search_url: href || undefined,
      booking_url: href || undefined,
      source: href ? "Travelpayouts flight search" : option.source || "Roamly flight estimate"
    };
  }

  if (option.mode === "drive") {
    const href = directionsHrefForTransport(option);
    return {
      ...option,
      search_url: href || undefined,
      booking_url: href || undefined
    };
  }

  if ((option.mode === "train" || option.mode === "bus") && (option.availability === "not_available" || !option.realistic)) {
    return {
      ...option,
      search_url: undefined,
      booking_url: undefined
    };
  }

  return {
    ...option,
    search_url: safeBookingHref(option.search_url) || undefined,
    booking_url: safeBookingHref(option.booking_url) || undefined
  };
}

function enrichTransportOptions(itinerary: RoamlyItinerary, payload: TripPlannerPayload): RoamlyItinerary["estimated_budget_breakdown"] {
  const budget = itinerary.estimated_budget_breakdown;
  const options = (budget.transport_options || []).map((option) => enrichTransportOption(option, payload));
  const recommended = budget.recommended_transport_option
    ? enrichTransportOption(budget.recommended_transport_option, payload)
    : options.find((option) => option.budget_fit === "best") || null;

  return {
    ...budget,
    recommended_transport_option: recommended,
    transport_options: options
  };
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
      const href = safeBookingHref(resolved.finalUrl);
      if (!href) {
        return {
          ...item,
          affiliate_category: category === "activity" || category === "ticket" ? "attraction" : category === "esim" || category === "product" ? category : (category as typeof item.affiliate_category),
          booking_label: undefined,
          booking: undefined
        };
      }
      return {
        ...item,
        affiliate_category: category === "activity" || category === "ticket" ? "attraction" : category === "esim" || category === "product" ? category : (category as typeof item.affiliate_category),
        booking_label: ctaLabelForTimeline(category, item.booking_label || resolved.ctaLabel),
        booking: {
          provider: resolved.provider,
          url: href,
          ctaLabel: ctaLabelForTimeline(category, item.booking_label || resolved.ctaLabel),
          disclosureRequired: resolved.disclosureRequired
        }
      };
    })
  }));
}

function suggestionCategoryValue(suggestion: RoamlyItinerary["booking_suggestions"][number]) {
  return cleanStringValue(
    suggestion.booking_category || suggestion.category
  ).toLowerCase();
}

function hasSuggestionCategory(
  suggestions: RoamlyItinerary["booking_suggestions"],
  category: string
) {
  return suggestions.some(
    (suggestion) => suggestionCategoryValue(suggestion) === category
  );
}

function recommendedStayCandidate(params: {
  destination: string;
  nightlyTarget: number | null;
}) {
  const destination = params.destination.toLowerCase();
  const nightlyTarget = params.nightlyTarget;

  if (destination.includes("montreal") || destination.includes("montréal")) {
    if (nightlyTarget && nightlyTarget < 150) {
      return {
        name: "M Montreal or similar private/budget room near the Village",
        neighborhood: "the Village / Berri-UQAM area",
        roomType: "private room / 1 bed / non-smoking when requested",
        reason:
          "close to Gay Village, Pride events, metro, nightlife, and budget-friendly food",
        searchQuery:
          "M Montreal private room Berri-UQAM Montreal Village budget hotel"
      };
    }

    return {
      name: "Hotel St-Denis or a similar central 3-star hotel",
      neighborhood: "Downtown Montreal / Berri-UQAM",
      roomType: "private room / 1 bed / non-smoking when requested",
      reason:
        "central location, metro access, walkable food, nightlife, and easier movement around Pride events",
      searchQuery:
        "Hotel St-Denis Montreal private queen room Downtown Berri-UQAM"
    };
  }

  return {
    name: `best-rated stay in ${params.destination}`,
    neighborhood: `central ${params.destination}`,
    roomType:
      nightlyTarget && nightlyTarget < 150
        ? "private room / 1 bed / budget hotel or hostel-private room"
        : "well-rated private room / 1 bed",
    reason:
      "best fit for location, budget, transit access, and the trip plan",
    searchQuery: `${params.destination} best private room budget hotel central`
  };
}

function buildBrainBookingSuggestions(params: {
  itinerary: RoamlyItinerary;
  payload: TripPlannerPayload;
  estimatedBudgetBreakdown: RoamlyItinerary["estimated_budget_breakdown"];
  budgetBrain: RoamlyBudgetBrainPlan;
}) {
  const { itinerary, payload, estimatedBudgetBreakdown, budgetBrain } = params;
  const suggestions = itinerary.booking_suggestions || [];
  const generated: RoamlyItinerary["booking_suggestions"] = [];

  const rawDestination = cleanStringValue(payload.destination);
  const resolvedDestination = resolveCityPlace(rawDestination);
  const destination = resolvedDestination?.searchLabel || rawDestination;
  const origin = cleanStringValue(payload.origin);
  const currency = cleanStringValue(payload.budgetCurrency) || "CAD";

  const recommendedTransport =
    estimatedBudgetBreakdown.recommended_transport_option ||
    estimatedBudgetBreakdown.transport_options?.find(
      (option) => option.budget_fit === "best"
    ) ||
    estimatedBudgetBreakdown.transport_options?.[0];

  if (
    recommendedTransport &&
    !hasSuggestionCategory(suggestions, "flight") &&
    (recommendedTransport.mode === "flight" || recommendedTransport.mode === "mixed")
  ) {
    generated.push({
      booking_category: "flight",
      category: "flight",
      title: `Recommended route: ${origin || "Origin"} to ${destination}`,
      description:
        recommendedTransport.reason ||
        "Best route for your dates, budget, and travel time.",
      origin: recommendedTransport.origin || origin,
      destination: recommendedTransport.destination || destination,
      departure_date: recommendedTransport.departure_date || payload.startDate,
      return_date: recommendedTransport.return_date || payload.endDate,
      provider: "Travelpayouts",
      url_type: "affiliate",
      has_affiliate_url: true,
      normal_search_url: recommendedTransport.search_url,
      affiliate_url: recommendedTransport.booking_url,
      booking_label: "Compare this route"
    } as unknown as RoamlyItinerary["booking_suggestions"][number]);
  }

  const budget = estimatedBudgetBreakdown;
  const nightlyTarget =
    budgetBrain.hotelNightlyTarget ||
    budget.hotel_nightly_target_amount ||
    budget.hotel_nightly_estimate_amount ||
    budget.selected_hotel_estimate_amount ||
    null;

  if (
    !hasSuggestionCategory(suggestions, "hotel") &&
    payload.budgetIncludesHotel !== false &&
    Boolean(resolvedDestination) &&
    (nightlyTarget || budget.hotel_estimate_note)
  ) {
    const stayCandidate = recommendedStayCandidate({
      destination,
      nightlyTarget
    });

    const budgetLabel = nightlyTarget
      ? `${Math.round(nightlyTarget)} ${currency} per night target`
      : "budget-matched nightly target";
    const reserveLabel = budgetBrain.hotelReserve
      ? `${budgetBrain.hotelReserve} ${currency} stay reserve`
      : "hotel reserve set before transport and extras";

    generated.push({
      booking_category: "hotel",
      category: "hotel",
      title: `Recommended stay: ${stayCandidate.name}`,
      description:
        `${budgetLabel}. ${reserveLabel}. Choose ${stayCandidate.roomType} around ${stayCandidate.neighborhood}.`,
      destination,
      recommended_stay_name: stayCandidate.name,
      stay_profile: stayCandidate.name,
      neighborhood: stayCandidate.neighborhood,
      room_type: stayCandidate.roomType,
      budget_target: budgetLabel,
      search_query: `${stayCandidate.searchQuery} ${budgetLabel}`,
      why_recommended: stayCandidate.reason,
      recommendation_reason: stayCandidate.reason,
      provider: "Recommended stay",
      provider_or_search_source: "Roamly recommendation",
      url_type: "affiliate",
      has_affiliate_url: false,
      booking_label: "Find this stay"
    } as unknown as RoamlyItinerary["booking_suggestions"][number]);
  }

  if (!hasSuggestionCategory(suggestions, "activity")) {
    const activities = itinerary.daily_itinerary
      .flatMap((day) => day.live_timeline || [])
      .filter((item) => {
        const title = cleanStringValue(item.title);
        const type = cleanStringValue(item.item_type).toLowerCase();

        if (!title) return false;

        return !/travel|transfer|flight|hotel|check|rest|meal|airport|station|luggage/.test(
          `${type} ${title}`.toLowerCase()
        );
      })
      .slice(0, 3);

    for (const activity of activities) {
      const title = cleanStringValue(activity.title);

      generated.push({
        booking_category: "activity",
        category: "activity",
        title: `Recommended activity: ${title}`,
        description:
          cleanStringValue(activity.description) ||
          "Chosen because it fits the trip route, timing, and destination.",
        destination: cleanStringValue(activity.location_name || destination),
        provider: "Official or local search",
        url_type: "direct",
        booking_label: "Open details",
        normal_search_url: destination
          ? `https://www.google.com/search?q=${encodeURIComponent(
              `${title} ${destination} official site details`
            )}`
          : ""
      } as unknown as RoamlyItinerary["booking_suggestions"][number]);
    }
  }

  return [...suggestions, ...generated];
}


function isUnsafeStay22TravelerUrl(value: unknown) {
  const url = cleanStringValue(value).toLowerCase();

  if (!url) return false;

  return (
    url.includes("hub.stay22.com") ||
    url.includes("app.stay22.com") ||
    url.includes("dashboard") ||
    url.includes("signin") ||
    url.includes("sign-in") ||
    url.includes("login") ||
    url.includes("account") ||
    url.includes("partner")
  );
}

function safeHotelAffiliateUrl(value: unknown) {
  const href = safeBookingHref(value);

  if (!href || isUnsafeStay22TravelerUrl(href)) {
    return "";
  }

  return href;
}

function bookingDotComHotelSearchUrl(params: {
  destination?: unknown;
  neighborhood?: unknown;
  roomType?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  travelers?: unknown;
  rooms?: unknown;
  currency?: unknown;
}) {
  const clean = (value: unknown) => String(value || "").trim();
  const search = [
    clean(params.destination),
    clean(params.neighborhood),
    clean(params.roomType),
    "hotel"
  ]
    .filter(Boolean)
    .join(" ");

  const query = new URLSearchParams();

  if (search) query.set("ss", search);
  if (clean(params.startDate)) query.set("checkin", clean(params.startDate));
  if (clean(params.endDate)) query.set("checkout", clean(params.endDate));
  query.set("group_adults", clean(params.travelers) || "1");
  query.set("no_rooms", clean(params.rooms) || "1");
  query.set("group_children", "0");
  query.set("selected_currency", clean(params.currency) || "CAD");

  return `https://www.booking.com/searchresults.html?${query.toString()}`;
}

function unsafeStay22Url(value: unknown) {
  const url = String(value || "").toLowerCase();

  return (
    url.includes("hub.stay22.com") ||
    url.includes("app.stay22.com") ||
    url.includes("dashboard") ||
    url.includes("signin") ||
    url.includes("sign-in") ||
    url.includes("login") ||
    url.includes("account") ||
    url.includes("partner")
  );
}

function safeHotelSearchUrl(value: unknown, params: Parameters<typeof bookingDotComHotelSearchUrl>[0]) {
  const href = safeBookingHref(value);

  if (!href || unsafeStay22Url(href)) {
    return bookingDotComHotelSearchUrl(params);
  }

  return href;
}

export function enrichItineraryBookingSuggestions(itinerary: RoamlyItinerary, payload: TripPlannerPayload): RoamlyItinerary {
  const estimatedBudgetBreakdown = enrichTransportOptions(itinerary, payload);
  const budgetBrain = calculateRoamlyBudgetBrain({
    trip: payload as unknown as Record<string, unknown>,
    itinerary: itinerary as unknown as Record<string, unknown>,
    budgetBreakdown: estimatedBudgetBreakdown as unknown as Record<string, unknown>,
    payload: payload as unknown as Record<string, unknown>
  });
  return {
    ...itinerary,
    estimated_budget_breakdown: {
      ...estimatedBudgetBreakdown,
      budget_brain: budgetBrain,
      hotel_budget_reserve_amount: budgetBrain.hotelReserve,
      transport_budget_reserve_amount: budgetBrain.transportReserve,
      food_budget_reserve_amount: budgetBrain.foodReserve,
      activities_budget_reserve_amount: budgetBrain.activitiesReserve,
      nightlife_budget_reserve_amount: budgetBrain.nightlifeReserve,
      buffer_budget_reserve_amount: budgetBrain.bufferReserve,
      hotel_nightly_target_amount: budgetBrain.hotelNightlyTarget,
      daily_spend_target_amount: budgetBrain.dailySpendTarget,
      budget_verdict: budgetBrain.budgetVerdict,
      budget_recommendation: budgetBrain.recommendation,
      transport_mode_recommendation: budgetBrain.transportModeRecommendation
    },
    daily_itinerary: enrichTimelineItems(itinerary, payload),
    booking_suggestions: buildBrainBookingSuggestions({
      itinerary,
      payload,
      estimatedBudgetBreakdown,
      budgetBrain
    }).filter((suggestion) => !unavailableTrainOrBusSuggestion(suggestion)).map((suggestion) => {
      const originalNormalSearchUrl = normalSearchUrlForSuggestion(suggestion, payload);
      const market = pickMarketResult(suggestion, payload);
      const marketRange = market ? marketPriceRange(market) : { min: null, max: null };
      const linkCategory = affiliateCategoryForSuggestion(suggestion);
      const link = buildRoamlyAffiliateUrl({
        category: linkCategory,
        destination: suggestion.destination || suggestion.city || payload.destination,
        origin: suggestion.origin || payload.origin,
        title: suggestion.title || suggestion.booking_label,
        query: linkCategory === "flight" ? undefined : suggestion.title || suggestion.booking_label,
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

      const isHotelSuggestion = linkCategory === "hotel";
      const hotelSearchParams = {
        destination: suggestion.destination || suggestion.city || payload.destination,
        neighborhood: suggestion.neighborhood || suggestion.location,
        roomType: suggestion.room_type,
        startDate: suggestion.departure_date || suggestion.date || payload.startDate,
        endDate: suggestion.return_date || payload.endDate,
        travelers: payload.travelers?.adults || payload.travelersCount || 1,
        rooms: payload.rooms || 1,
        currency: payload.budgetCurrency
      };
      const affiliateUrl = isHotelSuggestion
        ? safeHotelAffiliateUrl(approvedMarketAffiliateUrl(market, link))
        : approvedMarketAffiliateUrl(market, link);
      const hasAffiliateUrl = Boolean(affiliateUrl) && !unsafeStay22Url(affiliateUrl);
      const normalSearchUrl = isHotelSuggestion
        ? safeHotelSearchUrl(
            originalNormalSearchUrl || link.href,
            hotelSearchParams
          )
        : originalNormalSearchUrl || link.href || "";
      const affiliateProvider = hasAffiliateUrl
        ? link.affiliate_provider
        : "roamly_internal";

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
        affiliate_url: affiliateUrl,
        affiliate_provider: affiliateProvider,
        affiliate_disclosure: hasAffiliateUrl ? affiliateDisclosure : "",
        has_affiliate_url: hasAffiliateUrl,
        url_type: hasAffiliateUrl ? "affiliate" : "normal_search",
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
  const hotelProvider = clean(process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER || "stay22").toLowerCase();
  const flightProvider = clean(process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER || "travelpayouts").toLowerCase();
  const attractionsProvider = clean(process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER || "klook").toLowerCase();
  const linkTest = testAffiliateLinks();

  return {
    affiliatesEnabled: enabled(),
    hotelProviderConfigured: hasConfiguredHotelAffiliateProvider(hotelProvider),
    flightProviderConfigured: flightProvider === "travelpayouts" && Boolean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER),
    attractionsProviderConfigured: hasConfiguredAttractionsAffiliateProvider(attractionsProvider),
    stay22PartnerConfigured: Boolean(stay22PartnerId() || stay22SmartLinkUrl() || stay22ReferralUrl()),
    travelpayoutsMarkerConfigured: Boolean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER),
    klookPartnerConfigured: Boolean(klookPartnerId() || klookReferralUrl()),
    amazonPartnerConfigured: process.env.ROAMLY_AMAZON_ENABLED === "true" && Boolean(process.env.ROAMLY_AMAZON_ASSOCIATE_TAG),
    esimPartnerConfigured: Boolean(process.env.ROAMLY_ESIM_REFERRAL_URL || process.env.ROAMLY_ESIM_AFFILIATE_ID),
    providerStatuses: linkTest.statuses,
    linkTest
  };
}
