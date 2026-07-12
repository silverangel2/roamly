import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import type { RoamlyItinerary } from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";

export type RoamlyBookingCategory = "hotel" | "flight" | "attraction" | "ticket" | "tour" | "transport" | "car_rental" | "restaurant" | "insurance";

export type RoamlyAffiliateInput = {
  category?: RoamlyBookingCategory;
  destination?: string | null;
  origin?: string | null;
  title?: string | null;
  query?: string | null;
  startDate?: string | null;
  endDate?: string | null;
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
  "Roamly may earn a commission when you book through partner links. This does not change your price.";

function enabled() {
  return process.env.ROAMLY_AFFILIATES_ENABLED === "true";
}

function clean(value?: string | null) {
  return (value || "").trim();
}

function q(value?: string | null) {
  return encodeURIComponent(clean(value));
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
  if (enabled() && provider === "stay22" && process.env.ROAMLY_STAY22_PARTNER_ID) {
    return linkResult(
      input,
      "hotel",
      withParams("https://www.stay22.com/search", {
        address: destination,
        aid: process.env.ROAMLY_STAY22_PARTNER_ID
      }),
      "stay22"
    );
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
        aid: process.env.ROAMLY_BOOKING_AFFILIATE_ID
      }),
      "booking"
    );
  }
  return linkResult(input, "hotel", `https://www.google.com/maps/search/${q(`${destination} hotels`)}`, "direct");
}

export function buildFlightAffiliateUrl(input: RoamlyAffiliateInput) {
  const provider = clean(process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER).toLowerCase();
  const origin = clean(input.origin) || "your origin";
  const destination = place(input);
  if (enabled() && provider === "travelpayouts" && process.env.ROAMLY_TRAVELPAYOUTS_MARKER) {
    return linkResult(
      input,
      "flight",
      withParams("https://www.aviasales.com/search", {
        marker: process.env.ROAMLY_TRAVELPAYOUTS_MARKER,
        origin,
        destination
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
  return linkResult(input, "flight", `https://www.google.com/travel/flights?q=${q(`${origin} to ${destination} flights`)}`, "direct");
}

export function buildAttractionAffiliateUrl(input: RoamlyAffiliateInput) {
  const provider = clean(process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER).toLowerCase();
  const search = place(input);
  if (enabled() && provider === "getyourguide" && process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID) {
    return linkResult(
      input,
      "tour",
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
      "tour",
      withParams("https://www.viator.com/searchResults/all", {
        text: search,
        pid: process.env.ROAMLY_VIATOR_PARTNER_ID
      }),
      "viator"
    );
  }
  if (enabled() && provider === "klook" && process.env.ROAMLY_KLOOK_PARTNER_ID) {
    return linkResult(
      input,
      "tour",
      withParams("https://www.klook.com/en-CA/search/result/", {
        query: search,
        aid: process.env.ROAMLY_KLOOK_PARTNER_ID
      }),
      "klook"
    );
  }
  if (enabled() && provider === "tiqets" && process.env.ROAMLY_TIQETS_PARTNER_ID) {
    return linkResult(
      input,
      "ticket",
      withParams("https://www.tiqets.com/en/search", {
        q: search,
        partner: process.env.ROAMLY_TIQETS_PARTNER_ID
      }),
      "tiqets"
    );
  }
  return linkResult(input, "tour", `https://www.viator.com/searchResults/all?text=${q(`${search} tours activities tickets`)}`, "direct");
}

export function buildTransportAffiliateUrl(input: RoamlyAffiliateInput) {
  const nav = buildNavigationLinks({
    destinationLabel: input.title || input.destination || "Destination",
    address: input.address || input.destination || input.query || undefined,
    latitude: input.latitude,
    longitude: input.longitude
  });
  return linkResult(input, "transport", nav[0]?.href || `https://www.google.com/search?q=${q(`${place(input)} transport`)}`, "direct");
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
      title: "Hotels near your best area",
      label: "Find hotels",
      description: "Open hotel options near the recommended neighborhoods.",
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

export function enrichItineraryBookingSuggestions(itinerary: RoamlyItinerary, payload: TripPlannerPayload): RoamlyItinerary {
  return {
    ...itinerary,
    booking_suggestions: itinerary.booking_suggestions.map((suggestion) => {
      const link = buildRoamlyAffiliateUrl({
        category: suggestion.booking_category,
        destination: payload.destination,
        origin: payload.origin,
        title: suggestion.title || suggestion.booking_label,
        query: suggestion.title || suggestion.booking_label,
        startDate: payload.startDate,
        endDate: payload.endDate,
        url: suggestion.normal_search_url
      });
      return {
        ...suggestion,
        normal_search_url: suggestion.normal_search_url || link.href,
        affiliate_url: link.affiliate_enabled ? link.affiliate_url : "",
        affiliate_provider: link.affiliate_provider,
        affiliate_disclosure: affiliateDisclosure,
        provider: suggestion.provider || (link.affiliate_enabled ? `${link.affiliate_provider} partner link` : "Direct search"),
        price_confidence: suggestion.price_confidence || "estimated"
      };
    })
  };
}

export function getAffiliateReadiness() {
  return {
    affiliatesEnabled: enabled(),
    hotelProviderConfigured: Boolean(process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER),
    flightProviderConfigured: Boolean(process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER),
    attractionsProviderConfigured: Boolean(process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER),
    stay22PartnerConfigured: Boolean(process.env.ROAMLY_STAY22_PARTNER_ID),
    travelpayoutsMarkerConfigured: Boolean(process.env.ROAMLY_TRAVELPAYOUTS_MARKER),
    getYourGuidePartnerConfigured: Boolean(process.env.ROAMLY_GETYOURGUIDE_PARTNER_ID),
    viatorPartnerConfigured: Boolean(process.env.ROAMLY_VIATOR_PARTNER_ID),
    klookPartnerConfigured: Boolean(process.env.ROAMLY_KLOOK_PARTNER_ID)
  };
}
