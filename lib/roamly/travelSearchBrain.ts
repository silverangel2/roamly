import type { TravelMarketCategory } from "@/lib/roamly/travelMarketSearch";

export type TravelSearchBrief = {
  category: TravelMarketCategory;
  intent: string;
  exact_match_terms: string[];
  must_match: Record<string, string | number | null>;
  search_queries: string[];
  detail_fields: string[];
  disambiguation_rules: string[];
  output_contract: string[];
};

export type TravelSearchBriefInput = {
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

function clean(value?: string | null) {
  return (value || "").trim();
}

function compact(parts: Array<string | number | null | undefined>) {
  return parts.map((part) => clean(part == null ? "" : String(part))).filter(Boolean).join(" ");
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)));
}

function destination(input: TravelSearchBriefInput) {
  return clean(input.destination || input.city) || "destination";
}

function travelers(input: TravelSearchBriefInput) {
  return Math.max(1, Math.round(input.travelers || 1));
}

function dates(input: TravelSearchBriefInput) {
  return [clean(input.start_date), clean(input.end_date)].filter(Boolean).join(" to ");
}

function sharedRules() {
  return [
    "Prefer exact names, official/provider pages, and current availability over broad destination articles.",
    "If the source cannot prove the exact route, property, activity, date, or traveler count, mark the result search_ready instead of verified.",
    "Never infer live price, schedule, rating, review count, opening hours, cancellation policy, taxes, or availability from unrelated options."
  ];
}

function sharedContract() {
  return [
    "source_url",
    "retrieved_at",
    "confidence",
    "exact_match_status",
    "missing_fields",
    "verification_notes"
  ];
}

export function buildTravelSearchBrief(input: TravelSearchBriefInput): TravelSearchBrief {
  const dest = destination(input);
  const title = clean(input.title);
  const dateRange = dates(input);
  const travelerCount = travelers(input);
  const currency = clean(input.currency).toUpperCase() || "CAD";

  if (input.category === "flight") {
    const origin = clean(input.origin) || "origin";
    return {
      category: "flight",
      intent: "Find exact flight options for the requested route, dates, travelers, and currency.",
      exact_match_terms: uniq([origin, dest, clean(input.start_date), clean(input.end_date), `${travelerCount} traveler`, currency]),
      must_match: {
        origin,
        destination: dest,
        departure_date: clean(input.start_date) || null,
        return_date: clean(input.end_date) || null,
        travelers: travelerCount,
        currency
      },
      search_queries: uniq([
        `flights ${origin} to ${dest} ${dateRange} ${travelerCount} travelers ${currency}`,
        `${origin} ${dest} airfare ${clean(input.start_date)} ${clean(input.end_date)} ${currency}`,
        `${origin} to ${dest} flight schedule ${clean(input.start_date)}`
      ]),
      detail_fields: [
        "airline",
        "flight_numbers",
        "departure_airport",
        "arrival_airport",
        "departure_time",
        "arrival_time",
        "layovers",
        "baggage_rules",
        "total_price",
        "taxes_fees",
        "refund_change_policy",
        "booking_url"
      ],
      disambiguation_rules: [
        ...sharedRules(),
        "Airport/city code must resolve to the requested origin and destination, not a nearby unrelated route.",
        "Return flights must match the requested return date unless the trip is one-way."
      ],
      output_contract: sharedContract()
    };
  }

  if (input.category === "hotel") {
    const roomType = clean(input.room_type) || "room";
    const rooms = Math.max(1, Math.round(input.rooms || 1));
    return {
      category: "hotel",
      intent: "Find exact accommodation choices that match destination, stay dates, room needs, traveler count, price, and review evidence.",
      exact_match_terms: uniq([title, dest, clean(input.city), clean(input.country), roomType, dateRange, `${rooms} room`, `${travelerCount} traveler`]),
      must_match: {
        destination: dest,
        city: clean(input.city) || dest,
        check_in: clean(input.start_date) || null,
        check_out: clean(input.end_date) || null,
        travelers: travelerCount,
        rooms,
        room_type: roomType,
        currency
      },
      search_queries: uniq([
        compact([title || roomType, dest, dateRange, "hotel reviews price"]),
        compact(["best", roomType, "in", dest, "for", travelerCount, "travelers", dateRange]),
        compact([dest, "hotels", roomType, "rating review count cancellation fees"]),
        compact([title || dest, "hotel complaints recent reviews"])
      ]),
      detail_fields: [
        "exact_property_name",
        "address",
        "neighbourhood",
        "distance_to_activity_clusters",
        "room_type",
        "availability",
        "total_price",
        "taxes_fees",
        "cancellation_policy",
        "check_in_time",
        "luggage_storage",
        "marketplace_rating",
        "review_count",
        "repeated_praises",
        "repeated_complaints",
        "booking_url"
      ],
      disambiguation_rules: [
        ...sharedRules(),
        "Do not treat a generic city hotel search as an exact property match.",
        "Property names must be matched with city/neighbourhood to avoid similarly named hotels."
      ],
      output_contract: sharedContract()
    };
  }

  if (input.category === "attraction" || input.category === "tour") {
    const item = title || (input.category === "tour" ? `${dest} tour` : `${dest} attraction`);
    return {
      category: input.category,
      intent: "Find exact activity choices that match the destination, trip dates, traveler interests, availability, and review evidence.",
      exact_match_terms: uniq([item, dest, clean(input.start_date), ...(input.interests || [])]),
      must_match: {
        title: item,
        destination: dest,
        activity_date: clean(input.start_date) || null,
        travelers: travelerCount,
        currency
      },
      search_queries: uniq([
        `${item} ${dest} official tickets ${clean(input.start_date)}`,
        `${item} ${dest} reviews opening hours price`,
        `${item} ${dest} availability cancellation policy`,
        `${dest} ${(input.interests || []).join(" ")} top rated ${input.category === "tour" ? "tours" : "attractions"}`
      ]),
      detail_fields: [
        "exact_activity_name",
        "operator_or_venue",
        "address",
        "opening_hours",
        "available_times",
        "duration",
        "reservation_required",
        "accessibility_notes",
        "weather_constraints",
        "total_price",
        "cancellation_policy",
        "marketplace_rating",
        "review_count",
        "repeated_praises",
        "repeated_complaints",
        "booking_url"
      ],
      disambiguation_rules: [
        ...sharedRules(),
        "Activity name, city, and date must match before using the price or rating.",
        "Do not mix official venue facts with unrelated reseller facts unless source URLs are kept separate."
      ],
      output_contract: sharedContract()
    };
  }

  if (input.category === "restaurant") {
    const item = title || `${dest} restaurant`;
    return {
      category: "restaurant",
      intent: "Find exact restaurant or dining-area choices that match destination, trip dates, dietary needs, rating evidence, and reservation/search links.",
      exact_match_terms: uniq([item, dest, clean(input.start_date), ...(input.interests || [])]),
      must_match: {
        title: item,
        destination: dest,
        dining_date: clean(input.start_date) || null,
        travelers: travelerCount,
        currency
      },
      search_queries: uniq([
        compact([item, dest, "restaurant reservations rating address"]),
        compact([dest, (input.interests || []).join(" "), "top rated restaurants official menu"]),
        compact([item, dest, "Google Maps Tripadvisor OpenTable"])
      ]),
      detail_fields: [
        "exact_restaurant_name",
        "address",
        "neighbourhood",
        "cuisine",
        "opening_hours",
        "reservation_url",
        "menu_url",
        "price_level",
        "marketplace_rating",
        "review_count",
        "dietary_notes",
        "coordinates",
        "maps_url"
      ],
      disambiguation_rules: [
        ...sharedRules(),
        "Do not use generic dining labels as restaurant names.",
        "Restaurant name, city, and address must match before using rating or reservation details."
      ],
      output_contract: sharedContract()
    };
  }

  return {
    category: "transport",
    intent: "Find exact local or intercity transport options that match route, date, traveler count, schedule, and price.",
    exact_match_terms: uniq([clean(input.origin), dest, title, clean(input.start_date), `${travelerCount} traveler`]),
    must_match: {
      origin: clean(input.origin) || null,
      destination: dest,
      date: clean(input.start_date) || null,
      travelers: travelerCount,
      currency
    },
    search_queries: uniq([
      compact([clean(input.origin), "to", dest, "transport", clean(input.start_date)]),
      compact([dest, "airport transfer local transit pass", clean(input.start_date)]),
      compact([title || dest, "schedule fare booking"])
    ]),
    detail_fields: [
      "operator",
      "pickup_location",
      "dropoff_location",
      "departure_time",
      "arrival_time",
      "duration",
      "transfers",
      "total_price",
      "luggage_rules",
      "accessibility_notes",
      "booking_url"
    ],
    disambiguation_rules: sharedRules(),
    output_contract: sharedContract()
  };
}
