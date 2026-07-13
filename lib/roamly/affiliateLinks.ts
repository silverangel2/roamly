import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import type { RoamlyItinerary } from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";
import { ROAMLY_AFFILIATE_DISCLOSURE } from "@/lib/roamly/emailTemplates";
import {
  buildAttractionTicketSearchUrl,
  buildFlightSearchUrl,
  buildHotelSearchUrl,
  buildTourSearchUrl,
  buildTransportSearchUrl,
  googleSearchUrl,
  safeExternalUrl
} from "@/lib/roamly/bookingLinks";

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

function q(value?: string | null) {
  return encodeURIComponent(clean(value));
}

function compact(parts: Array<string | null | undefined>) {
  return parts.map((part) => clean(part)).filter(Boolean).join(" ");
}

function withParams(base: string, params: Record<string, string | undefined>) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function place(input: RoamlyAffiliateInput) {
  return clean(input.query) || clean(input.title) || clean(input.destination) || "travel";
}

function directSearch(provider: string, href: string) {
  return href || googleSearchUrl(`${provider} travel search`);
}

function stay22PartnerId() {
  return clean(process.env.ROAMLY_STAY22_PARTNER_ID);
}

function stay22ReferralUrl() {
  return safeExternalUrl(process.env.ROAMLY_STAY22_REFERRAL_URL);
}

function hasConfiguredHotelAffiliateProvider(provider: string) {
  if (provider === "stay22") return Boolean(stay22PartnerId() || stay22ReferralUrl());
  if (provider === "expedia" || provider === "hotels") return Boolean(process.env.ROAMLY_EXPEDIA_AFFILIATE_ID);
  if (provider === "booking") return Boolean(process.env.ROAMLY_BOOKING_AFFILIATE_ID);
  return false;
}

function klookPartnerId() {
  return clean(process.env.ROAMLY_KLOOK_PARTNER_ID);
}

function klookReferralUrl() {
  return safeExternalUrl(process.env.ROAMLY_KLOOK_REFERRAL_URL);
}

function klookEnabled() {
  return enabled() && clean(process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER).toLowerCase() === "klook";
}

function klookSearchTarget(search: string) {
  const query = clean(search);
  const partnerId = klookPartnerId();
  if (!query || !partnerId) return "";
  return withParams("https://www.klook.com/en-CA/search/result/", {
    query,
    aid: partnerId
  });
}

function klookAffiliateHref(search: string) {
  const target = klookSearchTarget(search);
  const referral = klookReferralUrl();
  if (target) {
    if (referral) {
      const redirect = new URL(referral);
      redirect.searchParams.set("k_site", target);
      return redirect.toString();
    }
    return target;
  }
  return referral;
}

function hasConfiguredAttractionsAffiliateProvider(provider: string) {
  if (provider === "getyourguide") return Boolean(process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID);
  if (provider === "viator") return Boolean(process.env.ROAMLY_VIATOR_PARTNER_ID);
  if (provider === "klook") return Boolean(klookPartnerId() || klookReferralUrl());
  if (provider === "tiqets") return Boolean(process.env.ROAMLY_TIQETS_PARTNER_ID);
  return false;
}

function activitySearch(input: RoamlyAffiliateInput) {
  return clean(input.query) || compact([input.title, input.destination]) || clean(input.destination);
}

function klookTransportSearch(input: RoamlyAffiliateInput) {
  return compact([input.query || input.title, input.destination || input.address]);
}

function isKlookTransportSearch(input: RoamlyAffiliateInput) {
  return /\b(airport|transfer|shuttle|transit|transport pass|travel pass|city pass|metro pass|rail pass|train pass|bus pass)\b/i.test(
    klookTransportSearch(input)
  );
}

function linkResult(
  input: RoamlyAffiliateInput,
  category: RoamlyBookingCategory,
  href: string,
  provider: string
) {
  const isAffiliate = enabled() && provider !== "direct";
  return {
    href,
    affiliate_provider: isAffiliate ? provider : "direct",
    affiliate_url: href,
    affiliate_enabled: isAffiliate,
    affiliate_disclosure: affiliateDisclosure,
    booking_category: category
  };
}

export function buildHotelAffiliateUrl(input: RoamlyAffiliateInput) {
  const provider = clean(process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER).toLowerCase();
  const destination = place(input);
  if (enabled() && provider === "stay22") {
    const partnerId = stay22PartnerId();
    if (partnerId) {
      return linkResult(
        input,
        "hotel",
        withParams("https://www.stay22.com/search", {
          address: destination,
          checkin: input.startDate || undefined,
          checkout: input.endDate || undefined,
          guests: input.adults ? String(input.adults) : undefined,
          aid: partnerId
        }),
        "stay22"
      );
    }

    const referralUrl = stay22ReferralUrl();
    if (referralUrl) {
      return linkResult(input, "hotel", referralUrl, "stay22");
    }
  }
  if (enabled() && provider === "expedia" && process.env.ROAMLY_EXPEDIA_AFFILIATE_ID) {
    return linkResult(
      input,
      "hotel",
      withParams("https://www.expedia.com/Hotel-Search", {
        destination,
        affcid: process.env.ROAMLY_EXPEDIA_AFFILIATE_ID
      }),
      "expedia"
    );
  }
  if (enabled() && provider === "hotels" && process.env.ROAMLY_EXPEDIA_AFFILIATE_ID) {
    return linkResult(
      input,
      "hotel",
      withParams("https://www.hotels.com/Hotel-Search", {
        destination,
        affcid: process.env.ROAMLY_EXPEDIA_AFFILIATE_ID
      }),
      "hotels"
    );
  }
  if (enabled() && provider === "booking" && process.env.ROAMLY_BOOKING_AFFILIATE_ID) {
    return linkResult(
      input,
      "hotel",
      withParams("https://www.booking.com/searchresults.html", {
        ss: destination,
        checkin: input.startDate || undefined,
        checkout: input.endDate || undefined,
        group_adults: input.adults ? String(input.adults) : undefined,
        group_children: input.children ? String(input.children) : undefined,
        no_rooms: input.rooms ? String(input.rooms) : undefined,
        aid: process.env.ROAMLY_BOOKING_AFFILIATE_ID
      }),
      "booking"
    );
  }
  return linkResult(
    input,
    "hotel",
    directSearch(
      "hotel",
      buildHotelSearchUrl({
        destination,
        checkInDate: input.startDate,
        checkOutDate: input.endDate,
        adults: input.adults,
        children: input.children,
        rooms: input.rooms,
        neighborhood: input.neighborhood,
        roomType: input.roomType
      })
    ),
    "direct"
  );
}

export function buildFlightAffiliateUrl(input: RoamlyAffiliateInput) {
  const provider = clean(process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER).toLowerCase();
  const origin = clean(input.origin);
  const destination = clean(input.destination) || place(input);
  if (enabled() && provider === "travelpayouts" && process.env.ROAMLY_TRAVELPAYOUTS_MARKER) {
    return linkResult(
      input,
      "flight",
      withParams("https://www.aviasales.com/search", {
        marker: process.env.ROAMLY_TRAVELPAYOUTS_MARKER,
        origin,
        destination,
        depart_date: input.startDate || undefined,
        return_date: input.endDate || undefined
      }),
      "travelpayouts"
    );
  }
  if (enabled() && provider === "kiwi" && process.env.ROAMLY_FLIGHT_AFFILIATE_ID) {
    return linkResult(
      input,
      "flight",
      withParams("https://www.kiwi.com/en/search/results", {
        affiliate: process.env.ROAMLY_FLIGHT_AFFILIATE_ID,
        from: origin,
        to: destination
      }),
      "kiwi"
    );
  }
  return linkResult(
    input,
    "flight",
    directSearch(
      "flight",
      buildFlightSearchUrl({
        origin,
        destination,
        departureDate: input.startDate,
        returnDate: input.endDate,
        travelers: input.travelers
      })
    ),
    "direct"
  );
}

export function buildAttractionAffiliateUrl(input: RoamlyAffiliateInput) {
  const provider = clean(process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER).toLowerCase();
  const search = activitySearch(input) || place(input);
  const category = input.category === "ticket" || input.category === "attraction" ? input.category : "tour";
  if (enabled() && provider === "getyourguide" && process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID) {
    return linkResult(
      input,
      category,
      withParams("https://www.getyourguide.com/s/", {
        q: search,
        partner_id: process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID
      }),
      "getyourguide"
    );
  }
  if (enabled() && provider === "viator" && process.env.ROAMLY_VIATOR_PARTNER_ID) {
    return linkResult(
      input,
      category,
      withParams("https://www.viator.com/searchResults/all", {
        text: search,
        pid: process.env.ROAMLY_VIATOR_PARTNER_ID
      }),
      "viator"
    );
  }
  if (klookEnabled()) {
    const klookHref = klookAffiliateHref(search);
    if (klookHref) {
      return linkResult(input, category, klookHref, "klook");
    }
  }
  if (enabled() && provider === "tiqets" && process.env.ROAMLY_TIQETS_PARTNER_ID) {
    return linkResult(
      input,
      category,
      withParams("https://www.tiqets.com/en/search", {
        q: search,
        partner: process.env.ROAMLY_TIQETS_PARTNER_ID
      }),
      "tiqets"
    );
  }
  return linkResult(
    input,
    category,
    directSearch(
      "activities",
      category === "tour"
        ? buildTourSearchUrl({ tourName: search, destination: input.destination, date: input.date || input.startDate })
        : buildAttractionTicketSearchUrl({ attractionName: search, destination: input.destination, date: input.date || input.startDate })
    ),
    "direct"
  );
}

export function buildTransportAffiliateUrl(input: RoamlyAffiliateInput) {
  if (klookEnabled() && isKlookTransportSearch(input)) {
    const klookHref = klookAffiliateHref(klookTransportSearch(input));
    if (klookHref) {
      return linkResult(input, "transport", klookHref, "klook");
    }
  }

  const nav = buildNavigationLinks({
    destinationLabel: input.title || input.destination || "Destination",
    address: input.address || input.destination || input.query || undefined,
    latitude: input.latitude,
    longitude: input.longitude
  });
  return linkResult(
    input,
    "transport",
    nav[0]?.href ||
      buildTransportSearchUrl({
        origin: input.origin,
        destination: input.destination || input.query || input.title,
        date: input.date || input.startDate
      }) ||
      googleSearchUrl(`${place(input)} transport`),
    "direct"
  );
}

export function buildRoamlyAffiliateUrl(input: RoamlyAffiliateInput) {
  if (input.category === "hotel") return buildHotelAffiliateUrl(input);
  if (input.category === "flight") return buildFlightAffiliateUrl(input);
  if (input.category === "transport") return buildTransportAffiliateUrl(input);
  if (input.category === "attraction" || input.category === "ticket" || input.category === "tour") {
    return buildAttractionAffiliateUrl(input);
  }
  if (input.category === "car_rental") {
    return linkResult(input, "car_rental", `https://www.google.com/search?q=${q(`${place(input)} car rental`)}`, "direct");
  }
  if (input.category === "restaurant") {
    return linkResult(input, "restaurant", `https://www.google.com/search?q=${q(`${place(input)} restaurant reservations`)}`, "direct");
  }
  return linkResult(input, input.category || "insurance", `https://www.google.com/search?q=${q(place(input))}`, "direct");
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

  return googleSearchUrl(`${suggestion.title || suggestion.booking_label} ${destination}`);
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

export function enrichItineraryBookingSuggestions(itinerary: RoamlyItinerary, payload: TripPlannerPayload): RoamlyItinerary {
  return {
    ...itinerary,
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
        provider: cleanStringValue(market?.provider) || suggestion.provider || (link.affiliate_enabled ? `${link.affiliate_provider} partner link` : "Direct search"),
        provider_or_search_source:
          cleanStringValue(market?.source) ||
          suggestion.provider_or_search_source ||
          suggestion.provider ||
          (link.affiliate_enabled ? `${link.affiliate_provider} partner link` : "Direct search"),
        normal_search_url: cleanStringValue(market?.normal_search_url) || suggestion.normal_search_url || normalSearchUrl || link.href,
        affiliate_url: cleanStringValue(market?.affiliate_url) || (link.affiliate_enabled ? link.affiliate_url : ""),
        affiliate_provider: cleanStringValue(market?.source) || link.affiliate_provider,
        affiliate_disclosure: affiliateDisclosure,
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

  return {
    affiliatesEnabled: enabled(),
    hotelProviderConfigured: hasConfiguredHotelAffiliateProvider(hotelProvider),
    flightProviderConfigured: Boolean(process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER),
    attractionsProviderConfigured: hasConfiguredAttractionsAffiliateProvider(attractionsProvider),
    stay22PartnerConfigured: Boolean(stay22PartnerId() || stay22ReferralUrl()),
    travelpayoutsMarkerConfigured: Boolean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER),
    getYourGuidePartnerConfigured: Boolean(process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID),
    viatorPartnerConfigured: Boolean(process.env.ROAMLY_VIATOR_PARTNER_ID),
    klookPartnerConfigured: Boolean(klookPartnerId() || klookReferralUrl())
  };
}
