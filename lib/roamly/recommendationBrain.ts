import { resolveCityPlace } from "@/lib/roamly/placeResolver";

type AnyRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const cleaned = text(value);
    if (cleaned) return cleaned;
  }

  return "";
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = numberValue(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function money(amount: number | null, currency: string) {
  if (!amount) return "";
  return `${Math.round(amount)} ${currency}`;
}

function googleMapsSearchUrl(query: string) {
  const cleaned = text(query);
  if (!cleaned) return "";
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", cleaned);
  return url.toString();
}

function googleSearchUrl(query: string) {
  const cleaned = text(query);
  if (!cleaned) return "";
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", cleaned);
  return url.toString();
}

function nestedNumber(record: AnyRecord, key: string) {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return firstNumber((value as AnyRecord)[key], (value as AnyRecord).hotelNightlyTarget);
}

type RecommendedStayCandidate = {
  name: string;
  neighborhood: string;
  roomType: string;
  reason: string;
  searchQuery: string;
};

function recommendedStayCandidates(destinationLower: string, nightlyTarget: number | null): RecommendedStayCandidate[] {
  if (destinationLower.includes("toronto")) {
    return [
      {
        name: "Chelsea Hotel, Toronto",
        neighborhood: "Downtown / Yonge-Dundas",
        roomType: "standard private room",
        reason: "central base with straightforward transit access to downtown sights, food, shopping, and waterfront routes",
        searchQuery: "Chelsea Hotel Toronto Downtown Yonge Dundas"
      },
      {
        name: "The Anndore House",
        neighborhood: "Yorkville / Church-Wellesley",
        roomType: "standard private room",
        reason: "walkable to Yorkville, museums, restaurants, and east-west subway access without being far from downtown",
        searchQuery: "The Anndore House Toronto Yorkville Church Wellesley hotel"
      },
      {
        name: "Holiday Inn Toronto Downtown Centre",
        neighborhood: "Downtown / Church-Wellesley",
        roomType: "standard private room",
        reason: "practical downtown location for transit, restaurants, shopping, and short rides to core itinerary stops",
        searchQuery: "Holiday Inn Toronto Downtown Centre hotel"
      }
    ];
  }

  if (destinationLower.includes("montreal") || destinationLower.includes("montréal")) {
    if (nightlyTarget && nightlyTarget < 150) {
      return [
        {
          name: "M Montreal",
          neighborhood: "the Village / Berri-UQAM",
          roomType: "private room when available",
          reason: "budget-friendly base near metro access, the Village, nightlife, and casual food",
          searchQuery: "M Montreal private room Berri UQAM Montreal Village"
        },
        {
          name: "Hotel St-Denis",
          neighborhood: "Downtown / Latin Quarter",
          roomType: "standard private room",
          reason: "central location near Berri-UQAM, Old Montreal access, restaurants, and transit",
          searchQuery: "Hotel St-Denis Montreal Latin Quarter hotel"
        }
      ];
    }

    return [
      {
        name: "Hotel St-Denis",
        neighborhood: "Downtown / Latin Quarter",
        roomType: "standard private room",
        reason: "central location, metro access, walkable food, nightlife, and Old Montreal access",
        searchQuery: "Hotel St-Denis Montreal private room Downtown Berri UQAM"
      },
      {
        name: "Le Square Phillips Hotel & Suites",
        neighborhood: "Downtown Montreal",
        roomType: "standard suite or private room",
        reason: "central downtown base with easy access to shopping, food, transit, and Old Montreal",
        searchQuery: "Le Square Phillips Hotel Suites Montreal Downtown"
      },
      {
        name: "Hotel Monville",
        neighborhood: "Downtown / Quartier international",
        roomType: "standard private room",
        reason: "well-placed for downtown, Old Montreal, restaurants, and transit connections",
        searchQuery: "Hotel Monville Montreal Quartier international"
      }
    ];
  }

  if (destinationLower.includes("vancouver")) {
    return [
      {
        name: "YWCA Hotel Vancouver",
        neighborhood: "Downtown Vancouver",
        roomType: "private room when available",
        reason: "central, practical base near transit, restaurants, stadium area, and waterfront access",
        searchQuery: "YWCA Hotel Vancouver Downtown"
      },
      {
        name: "The Burrard",
        neighborhood: "Downtown Vancouver",
        roomType: "standard private room",
        reason: "walkable downtown location with easy access to West End, transit, food, and waterfront routes",
        searchQuery: "The Burrard Vancouver hotel Downtown"
      },
      {
        name: "Victorian Hotel Vancouver",
        neighborhood: "Downtown Vancouver / Gastown edge",
        roomType: "standard private room",
        reason: "central heritage hotel near Gastown, downtown restaurants, transit, and waterfront itinerary stops",
        searchQuery: "Victorian Hotel Vancouver Downtown Gastown"
      }
    ];
  }

  return [];
}

export function buildRecommendedStaySuggestions(params: {
  trip: AnyRecord;
  itinerary: AnyRecord;
}) {
  const trip = params.trip;
  const itinerary = params.itinerary;
  const budget = (itinerary.estimated_budget_breakdown || {}) as AnyRecord;
  const tripDestination = [text(trip.destination_city), text(trip.destination_country)].filter(Boolean).join(", ");

  const rawDestination = firstText(
    trip.destination,
    tripDestination,
    itinerary.destination,
    trip.city,
    trip.location,
    "your destination"
  );
  const resolvedDestination = resolveCityPlace(rawDestination);
  if (!resolvedDestination) return [];
  const destination = resolvedDestination.searchLabel;

  const currency = firstText(
    itinerary.budget_currency,
    trip.budget_currency,
    budget.currency,
    "CAD"
  );

  const nightlyTarget = firstNumber(
    budget.hotel_nightly_target_amount,
    nestedNumber(budget, "budget_brain"),
    (budget.budget_brain as AnyRecord | undefined)?.hotelNightlyTarget,
    budget.selected_hotel_estimate_amount,
    budget.hotel_nightly_estimate_amount,
    budget.hotel_estimate_amount
  );

  const includesHotel = trip.budget_includes_hotel !== false;

  if (!includesHotel) return [];

  const destinationLower = `${destination} ${resolvedDestination.asciiName} ${resolvedDestination.name}`.toLowerCase();
  const candidates = recommendedStayCandidates(destinationLower, nightlyTarget);
  if (!candidates.length) return [];

  const budgetLabel = nightlyTarget
    ? `${money(nightlyTarget, currency)} per night target`
    : "budget-matched nightly target";

  return candidates.map((candidate) => ({
    booking_category: "hotel",
    category: "hotel",
    title: candidate.name,
    description:
      `${candidate.neighborhood}. ${budgetLabel}; verify current rates and availability for ${candidate.roomType}.`,
    destination,
    recommended_stay_name: candidate.name,
    stay_profile: candidate.name,
    neighborhood: candidate.neighborhood,
    room_type: candidate.roomType,
    budget_target: budgetLabel,
    search_query: `${candidate.searchQuery} ${budgetLabel}`,
    why_recommended: candidate.reason,
    recommendation_reason: candidate.reason,
    url_type: "affiliate",
    provider: "Recommended stay",
    provider_or_search_source: "Roamly recommendation",
    booking_label: "View hotel options",
    has_affiliate_url: false,
    normal_search_url: googleMapsSearchUrl(`${candidate.name} ${destination}`)
  }));
}

export function buildRecommendedStaySuggestion(params: {
  trip: AnyRecord;
  itinerary: AnyRecord;
}) {
  return buildRecommendedStaySuggestions(params)[0] || null;
}

type RecommendedActivityCandidate = {
  name: string;
  location: string;
  duration: string;
  reason: string;
  searchQuery: string;
  freeOrPaid: "free" | "paid" | "varies";
};

function recommendedActivityCandidates(destinationLower: string): RecommendedActivityCandidate[] {
  if (destinationLower.includes("vancouver")) {
    return [
      {
        name: "Vancouver Lookout",
        location: "Harbour Centre / Downtown Vancouver",
        duration: "45-75 minutes",
        reason: "compact skyline viewpoint that fits cleanly around downtown, waterfront, and Gastown plans",
        searchQuery: "Vancouver Lookout official tickets",
        freeOrPaid: "paid"
      },
      {
        name: "Museum of Anthropology at UBC",
        location: "University of British Columbia",
        duration: "2-3 hours",
        reason: "substantial indoor cultural stop with a clear ticketing path and enough depth for a balanced itinerary",
        searchQuery: "Museum of Anthropology UBC official tickets",
        freeOrPaid: "paid"
      },
      {
        name: "FlyOver Canada",
        location: "Canada Place / Waterfront",
        duration: "30-45 minutes",
        reason: "short bookable waterfront activity that can slot into arrival, weather, or downtown walking time",
        searchQuery: "FlyOver Canada Vancouver tickets",
        freeOrPaid: "paid"
      }
    ];
  }

  if (destinationLower.includes("toronto")) {
    return [
      {
        name: "CN Tower",
        location: "Entertainment District",
        duration: "1-2 hours",
        reason: "signature timed-entry attraction close to waterfront, transit, and downtown restaurant plans",
        searchQuery: "CN Tower official tickets Toronto",
        freeOrPaid: "paid"
      },
      {
        name: "Royal Ontario Museum",
        location: "Bloor-Yorkville",
        duration: "2-3 hours",
        reason: "high-value museum stop near subway access, Yorkville, and flexible bad-weather routing",
        searchQuery: "Royal Ontario Museum official tickets",
        freeOrPaid: "paid"
      },
      {
        name: "Ripley's Aquarium of Canada",
        location: "South Core / Entertainment District",
        duration: "1.5-2.5 hours",
        reason: "bookable indoor attraction beside the CN Tower and Union Station corridor",
        searchQuery: "Ripley's Aquarium of Canada tickets Toronto",
        freeOrPaid: "paid"
      }
    ];
  }

  if (destinationLower.includes("montreal") || destinationLower.includes("montréal")) {
    return [
      {
        name: "Notre-Dame Basilica of Montreal",
        location: "Old Montreal",
        duration: "45-90 minutes",
        reason: "central landmark with timed visits that pairs well with Old Montreal walking routes",
        searchQuery: "Notre-Dame Basilica Montreal official tickets",
        freeOrPaid: "paid"
      },
      {
        name: "Montreal Museum of Fine Arts",
        location: "Golden Square Mile",
        duration: "2-3 hours",
        reason: "reliable indoor cultural stop near downtown food, shopping, and metro routes",
        searchQuery: "Montreal Museum of Fine Arts official tickets",
        freeOrPaid: "paid"
      },
      {
        name: "La Grande Roue de Montreal",
        location: "Old Port of Montreal",
        duration: "30-60 minutes",
        reason: "short bookable viewpoint that fits around Old Port, waterfront, and evening plans",
        searchQuery: "La Grande Roue de Montreal tickets",
        freeOrPaid: "paid"
      }
    ];
  }

  return [];
}

function noteTextFromTrip(trip: AnyRecord) {
  const metadata = trip.metadata && typeof trip.metadata === "object" && !Array.isArray(trip.metadata)
    ? (trip.metadata as AnyRecord)
    : {};
  const planning = metadata.planning && typeof metadata.planning === "object" && !Array.isArray(metadata.planning)
    ? (metadata.planning as AnyRecord)
    : metadata;
  return [
    trip.special_notes,
    planning.specialNotes,
    planning.special_notes,
    planning.accessibilityNeeds,
    planning.accessibility_needs,
    planning.dietaryPreference,
    planning.dietary_preference,
    Array.isArray(trip.interests) ? trip.interests.join(" ") : "",
    Array.isArray(planning.interests) ? planning.interests.join(" ") : ""
  ]
    .map(text)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function notePriorityActivityCandidates(destination: string, noteText: string): RecommendedActivityCandidate[] {
  const candidates: RecommendedActivityCandidate[] = [];
  const add = (candidate: RecommendedActivityCandidate) => {
    if (!candidates.some((item) => item.name.toLowerCase() === candidate.name.toLowerCase())) {
      candidates.push(candidate);
    }
  };

  if (/\bpride|lgbtq|lgbt|queer\b/i.test(noteText)) {
    add({
      name: `${destination} Pride official events`,
      location: "Official Pride festival schedule",
      duration: "varies by event",
      reason: "Matches the planning note and should be checked before generic sightseeing",
      searchQuery: `${destination} Pride official events festival schedule`,
      freeOrPaid: "varies"
    });
    add({
      name: `${destination} LGBTQ+ nightlife and community events`,
      location: "LGBTQ+ nightlife or festival area",
      duration: "evening",
      reason: "Keeps nightlife and event planning aligned with the reason for the trip",
      searchQuery: `${destination} LGBTQ nightlife events official`,
      freeOrPaid: "varies"
    });
  }

  if (/\bfestival|conference|wedding|concert|sporting event|sports event|game|birthday\b/i.test(noteText)) {
    add({
      name: `${destination} event schedule search`,
      location: "Official event venue or organizer",
      duration: "depends on event",
      reason: "Planning notes mention a dated event, so official schedule and venue details should be checked first",
      searchQuery: `${destination} official event schedule tickets venue`,
      freeOrPaid: "varies"
    });
  }

  if (/\baccessible|accessibility|wheelchair|step[- ]?free|mobility|stroller\b/i.test(noteText)) {
    add({
      name: `${destination} accessible attractions and step-free routes`,
      location: "Accessible routes and venues",
      duration: "planning check",
      reason: "Accessibility notes should shape activity selection, routing, and transport choices before generic sightseeing",
      searchQuery: `${destination} accessible attractions step free routes official`,
      freeOrPaid: "varies"
    });
  }

  if (/\bvegan|vegetarian|halal|kosher|gluten[- ]?free|allerg|seafood|coffee|food\b/i.test(noteText)) {
    add({
      name: `${destination} food preference search`,
      location: "Restaurant areas that match food notes",
      duration: "meal planning",
      reason: "Food preferences in the planning notes should shape meal neighbourhoods and reservation searches",
      searchQuery: `${destination} ${noteText.match(/\b(vegan|vegetarian|halal|kosher|gluten[- ]?free|seafood|coffee)\b/i)?.[0] || "notable"} restaurants official menu reservations`,
      freeOrPaid: "varies"
    });
  }

  return candidates;
}

export function buildRecommendedActivitySuggestions(params: {
  trip: AnyRecord;
  itinerary: AnyRecord;
}) {
  const trip = params.trip;
  const itinerary = params.itinerary;
  const tripDestination = [text(trip.destination_city), text(trip.destination_country)].filter(Boolean).join(", ");
  const rawDestination = firstText(
    trip.destination,
    tripDestination,
    itinerary.destination,
    trip.city,
    trip.location,
    "your destination"
  );
  const resolvedDestination = resolveCityPlace(rawDestination);
  if (!resolvedDestination) return [];
  const destination = resolvedDestination.searchLabel;
  const destinationLower = `${destination} ${resolvedDestination.asciiName} ${resolvedDestination.name}`.toLowerCase();
  const currency = firstText(itinerary.budget_currency, trip.budget_currency, "CAD");
  const noteText = noteTextFromTrip(trip);
  const noteCandidates = notePriorityActivityCandidates(destination, noteText);

  return [...noteCandidates, ...recommendedActivityCandidates(destinationLower)].map((candidate) => ({
    booking_category: "activity",
    category: "activity",
    title: candidate.name,
    description: `${candidate.location}. ${candidate.reason}`,
    destination,
    location: candidate.location,
    duration: candidate.duration,
    free_or_paid: candidate.freeOrPaid,
    currency,
    price_confidence: "unknown",
    price_type: "search_ready",
    provider: "Official or local search",
    provider_or_search_source: "Official or local search",
    url_type: "direct",
    booking_label: "Open details",
    has_affiliate_url: false,
    normal_search_url: googleSearchUrl(`${candidate.searchQuery} ${destination}`),
    note_priority: noteCandidates.includes(candidate) || undefined
  }));
}

export function hasBookingCategory(
  suggestions: unknown[],
  category: string
) {
  return suggestions.some((suggestion) => {
    if (!suggestion || typeof suggestion !== "object") return false;

    const record = suggestion as AnyRecord;
    const found = firstText(record.booking_category, record.category).toLowerCase();

    return found === category.toLowerCase();
  });
}
