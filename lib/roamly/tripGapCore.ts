/**
 * tripGapCore.ts — pure, dependency-free trip-gap detection and offer assembly.
 *
 * A "trip gap" is a missing piece of an otherwise paid/active trip:
 *   flight booked but no hotel   -> Stay22 hotel offer
 *   hotel booked but no arrival transfer -> Intui transfer offer
 *   international destination but no eSIM/data -> Airalo eSIM offer
 *   no tours/activities booked   -> KKday tours offer
 *   no car booked                -> GetRentACar offer
 *   generic gap                  -> Amazon travel-gear offer (tag from config, never hardcoded here)
 *
 * Affiliate sources are exactly the ones the /finds cards use
 * (lib/roamly/findsCommercialConfig.ts and lib/roamly/amazonAffiliate.ts):
 * no new tags, markers, or providers are invented here.
 *
 * Guardrails (Junel, HARD):
 *  - follow the traveler's own preferences: a gap offer is suppressed when the
 *    traveler's accepted (or inferred) preferences state against it.
 *  - one offer per gap; frequency caps live in the server layer.
 *  - links are labeled as searches/browsing where exact products are unknown
 *    (booking-honesty: never invent live availability, prices, or hotel identities).
 *
 * Everything here is pure and deterministic — importable from node with
 * --experimental-strip-types for tests. No Supabase, no Next.js, no env reads.
 */

export const TRIP_GAP_TYPES = ["hotel", "transfer", "esim", "tours", "car", "gear"] as const;

export type TripGapType = (typeof TRIP_GAP_TYPES)[number];

/** Affiliate link/config constants, copied from the /finds cards' config.
 *  These are the canonical Junel-approved affiliate endpoints:
 *  - Stay22 smart link (hotels)
 *  - Intui tracked link (airport transfers)
 *  - KKday tracked promo link (tours — labeled as a browse link, never an exact product)
 *  - Travelpayouts widget identifiers trs=549715 / shmarker=750294 (flights, eSIM, rental cars)
 */
export const GAP_AFFILIATE_SOURCES = {
  stay22SmartLink: "https://booking.stay22.com/roamly/YhpfMFjm2n",
  intuiTransferLink: "https://intui.tpo.lu/6GQiV5Ai",
  kkdayPromoLink: "https://kkday.tpo.lu/DrPvqlSH",
  travelpayouts: {
    origin: "https://tpwdgt.com",
    path: "/content",
    trs: "549715",
    shmarker: "750294",
    esim: { promoId: "8588", campaignId: "541" },
    cars: { promoId: "3507", campaignId: "22", ag: "18", ap: "34", rid: "481" }
  }
} as const;

export const GAP_AFFILIATE_DISCLOSURE =
  "Roamly may earn a commission from some booking links. Recommendations are ranked according to your trip needs, not commission.";

export type BookingTypeLike = string;

export type GapBookingInput = {
  bookingType: BookingTypeLike | null;
  bookingStatus: string | null;
  origin: string | null;
  destination: string | null;
  provider: string | null;
};

export type GapTripInput = {
  tripId: string;
  destinationCountry: string | null;
  originCountry: string | null;
  destinationLabel: string | null;
};

export type GapPreferenceInput = {
  /** Accepted (confirmed) preference values, keyed by generation personalization key. */
  accepted: Record<string, unknown>;
  /** Inferred preference values. */
  inferred: Record<string, unknown>;
  enabled: boolean;
};

export type TripGap = {
  type: TripGapType;
  /** Short human reason shown on the card / in the email. Never invents specifics. */
  reason: string;
};

function isLiveBooking(booking: GapBookingInput) {
  const status = String(booking.bookingStatus || "").toLowerCase();
  return !["cancelled", "unknown"].includes(status);
}

function hasLiveBookingOfType(bookings: GapBookingInput[], types: string[]) {
  const wanted = new Set(types.map((type) => type.toLowerCase()));
  return bookings.some((booking) => booking.bookingType && wanted.has(String(booking.bookingType).toLowerCase()) && isLiveBooking(booking));
}

function countryOf(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isInternationalTrip(trip: GapTripInput) {
  const origin = countryOf(trip.originCountry);
  const destination = countryOf(trip.destinationCountry);
  return Boolean(origin && destination && origin !== destination);
}

function preferenceMentions(prefs: GapPreferenceInput, keys: string[], pattern: RegExp) {
  if (!prefs.enabled) return false;
  const texts: string[] = [];
  for (const key of keys) {
    for (const source of [prefs.accepted, prefs.inferred]) {
      const value = source[key];
      if (Array.isArray(value)) texts.push(...value.filter((item): item is string => typeof item === "string"));
      else if (typeof value === "string") texts.push(value);
    }
  }
  const haystack = texts.join(" ").toLowerCase();
  return pattern.test(haystack);
}

/**
 * Junel's hard rule: never suggest against stated prefs.
 * Conservative keyword matching against the traveler's own preference text.
 */
export function gapSuppressedByPreferences(gap: TripGapType, prefs: GapPreferenceInput): { suppressed: boolean; reason: string | null } {
  if (!prefs.enabled) return { suppressed: false, reason: null };
  const dislikeMentions = (pattern: RegExp) =>
    preferenceMentions(prefs, ["dislikes"], pattern);
  const transportMentions = (pattern: RegExp) =>
    preferenceMentions(prefs, ["transportation_preferences", "preferred_departure_windows", "likes"], pattern);
  const accommodationMentions = (pattern: RegExp) =>
    preferenceMentions(prefs, ["accommodation_types", "hotel_priorities", "room_preferences", "dislikes", "likes"], pattern);

  switch (gap) {
    case "hotel":
      if (accommodationMentions(/\b(no hotels?|hate hotels?|avoid hotels?|no accommodation|staying with|friends|family|couchsurf|hostel only)\b/)) {
        return { suppressed: true, reason: "traveler preference states against hotels" };
      }
      return { suppressed: false, reason: null };
    case "transfer":
      if (transportMentions(/\b(public transit|public transport|metro|subway|no transfer|no taxi|no cab|walk everywhere)\b/)) {
        return { suppressed: true, reason: "traveler prefers public transit over transfers" };
      }
      return { suppressed: false, reason: null };
    case "car":
      if (transportMentions(/\b(no driving|don'?t drive|can'?t drive|no car|public transit|public transport|train only|no rental)\b/) || dislikeMentions(/\bdriving\b/)) {
        return { suppressed: true, reason: "traveler preference states against driving" };
      }
      return { suppressed: false, reason: null };
    case "tours":
      if (dislikeMentions(/\b(tours?|guided|excursions?)\b/) || preferenceMentions(prefs, ["culture_interests", "nature_interests"], /\bno tours?\b/)) {
        return { suppressed: true, reason: "traveler preference states against tours" };
      }
      return { suppressed: false, reason: null };
    case "esim":
    case "gear":
      return { suppressed: false, reason: null };
  }
}

/**
 * Detect gaps for a paid/active trip. Pure: takes booking rows, trip facts,
 * and traveler prefs; returns the gaps in priority order (one offer per gap).
 */
export function detectTripGaps(params: {
  trip: GapTripInput;
  bookings: GapBookingInput[];
  preferences: GapPreferenceInput;
}): TripGap[] {
  const { trip, bookings, preferences } = params;
  const gaps: TripGap[] = [];

  const hasFlight = hasLiveBookingOfType(bookings, ["flight"]);
  const hasHotel = hasLiveBookingOfType(bookings, ["hotel"]);
  const hasTransfer = hasLiveBookingOfType(bookings, ["transport"]);
  const hasTours = hasLiveBookingOfType(bookings, ["attraction", "ticket", "tour", "event"]);
  const hasCar = hasLiveBookingOfType(bookings, ["car_rental"]);
  const hasConnectivity = bookings.some(
    (booking) =>
      isLiveBooking(booking) &&
      /esim|sim|data|roam/i.test([booking.provider, booking.bookingType].filter(Boolean).join(" "))
  );

  const maybeAdd = (type: TripGapType, reason: string) => {
    const { suppressed } = gapSuppressedByPreferences(type, preferences);
    if (!suppressed) gaps.push({ type, reason });
  };

  if (hasFlight && !hasHotel) {
    maybeAdd("hotel", "Your flight is booked but no stay is on file yet.");
  }
  if (hasHotel && !hasTransfer && !hasCar) {
    maybeAdd("transfer", "Your stay is booked but no airport transfer is on file yet.");
  }
  if (isInternationalTrip(trip) && !hasConnectivity) {
    maybeAdd("esim", "You're crossing a border — no data/eSIM plan is on file yet.");
  }
  if (!hasTours) {
    maybeAdd("tours", "No tours or activities are booked for this trip yet.");
  }
  if (!hasCar && !hasTransfer) {
    maybeAdd("car", "No rental car is on file for getting around.");
  }
  // Gear is the generic fallback offer: always available, surfaced last.
  maybeAdd("gear", "A few travel essentials make any trip smoother.");

  return gaps;
}

export type GapOffer = {
  type: TripGapType;
  eyebrow: string;
  title: string;
  description: string;
  /** Primary CTA link (affiliate-tracked where one exists). */
  href: string;
  /** Label that keeps booking-honesty: searches/browsing, never exact products. */
  ctaLabel: string;
  /** e.g. "Stay22", "Intui", "KKday", "Travelpayouts", "Amazon". */
  providerLabel: string;
  /** For widget-based offers (eSIM, rental cars): iframe embed config reused from /finds. */
  widget?: { src: string; minHeight: number };
  /** Amazon search query for the gear offer; the tag comes from config, not here. */
  amazonQuery?: string;
  disclosure: string;
};

function esimWidgetSrc(country: string) {
  const url = new URL(`${GAP_AFFILIATE_SOURCES.travelpayouts.origin}${GAP_AFFILIATE_SOURCES.travelpayouts.path}`);
  url.searchParams.set("trs", GAP_AFFILIATE_SOURCES.travelpayouts.trs);
  url.searchParams.set("shmarker", GAP_AFFILIATE_SOURCES.travelpayouts.shmarker);
  url.searchParams.set("locale", "en");
  url.searchParams.set("powered_by", "true");
  url.searchParams.set("country", country || "Spain");
  url.searchParams.set("promo_id", GAP_AFFILIATE_SOURCES.travelpayouts.esim.promoId);
  url.searchParams.set("campaign_id", GAP_AFFILIATE_SOURCES.travelpayouts.esim.campaignId);
  url.searchParams.set("color_button", "#f2685f");
  url.searchParams.set("plain", "false");
  return url.toString();
}

function carsWidgetSrc() {
  const url = new URL(`${GAP_AFFILIATE_SOURCES.travelpayouts.origin}${GAP_AFFILIATE_SOURCES.travelpayouts.path}`);
  url.searchParams.set("trs", GAP_AFFILIATE_SOURCES.travelpayouts.trs);
  url.searchParams.set("shmarker", GAP_AFFILIATE_SOURCES.travelpayouts.shmarker);
  url.searchParams.set("powered_by", "true");
  url.searchParams.set("locale", "en");
  url.searchParams.set("curr", "USD");
  url.searchParams.set("color", "blue");
  url.searchParams.set("ag", GAP_AFFILIATE_SOURCES.travelpayouts.cars.ag);
  url.searchParams.set("ap", GAP_AFFILIATE_SOURCES.travelpayouts.cars.ap);
  url.searchParams.set("rid", GAP_AFFILIATE_SOURCES.travelpayouts.cars.rid);
  url.searchParams.set("promo_id", GAP_AFFILIATE_SOURCES.travelpayouts.cars.promoId);
  url.searchParams.set("campaign_id", GAP_AFFILIATE_SOURCES.travelpayouts.cars.campaignId);
  return url.toString();
}

/**
 * Build the one offer per gap. The affiliate endpoints are exactly the /finds
 * cards' endpoints — nothing new is invented. Exact-product claims are never
 * made: Klook/KKday links are labeled as aid-tagged browse/search links.
 */
export function buildGapOffer(gap: TripGapType, trip: GapTripInput, amazonSearchUrl: (query: string) => string): GapOffer {
  const destination = (trip.destinationLabel || "").trim() || "your destination";
  const base = { type: gap, disclosure: GAP_AFFILIATE_DISCLOSURE };
  switch (gap) {
    case "hotel":
      return {
        ...base,
        eyebrow: "Still need a stay",
        title: `Find a stay for ${destination}`,
        description: "Search stays near your trip area and verify room type, taxes, and availability before booking.",
        href: GAP_AFFILIATE_SOURCES.stay22SmartLink,
        ctaLabel: "Search stays",
        providerLabel: "Stay22"
      };
    case "transfer":
      return {
        ...base,
        eyebrow: "Getting from the airport",
        title: "Start the trip smoothly",
        description: "Browse airport transfer options and make the first leg of the trip easier.",
        href: GAP_AFFILIATE_SOURCES.intuiTransferLink,
        ctaLabel: "Find an airport transfer",
        providerLabel: "Intui"
      };
    case "esim":
      return {
        ...base,
        eyebrow: "Stay connected",
        title: "Connected when you land",
        description: `Browse eSIM data plans for ${trip.destinationCountry || destination} before you land. Availability and prices are set by the provider.`,
        href: GAP_AFFILIATE_SOURCES.travelpayouts.origin,
        ctaLabel: "Browse eSIM plans",
        providerLabel: "Travelpayouts",
        widget: { src: esimWidgetSrc(trip.destinationCountry || ""), minHeight: 190 }
      };
    case "tours":
      return {
        ...base,
        eyebrow: "A little extra to discover",
        title: "Find something memorable",
        description: "Browse the current experience selection — a browse link, not a specific product. Verify dates and availability before booking.",
        href: GAP_AFFILIATE_SOURCES.kkdayPromoLink,
        ctaLabel: "Browse experiences",
        providerLabel: "KKday"
      };
    case "car":
      return {
        ...base,
        eyebrow: "Need a car?",
        title: "Keep the journey moving",
        description: "Browse current car options for the road ahead. Prices are shown in USD; the provider sets final terms.",
        href: GAP_AFFILIATE_SOURCES.travelpayouts.origin,
        ctaLabel: "Browse rental cars",
        providerLabel: "Travelpayouts",
        widget: { src: carsWidgetSrc(), minHeight: 300 }
      };
    case "gear":
      return {
        ...base,
        eyebrow: "Travel essentials",
        title: "Gear up for the trip",
        description: `A few well-chosen essentials for ${destination}. This is an Amazon search — prices and availability are Amazon's.`,
        href: amazonSearchUrl(`travel essentials ${destination}`),
        ctaLabel: "Shop travel gear",
        providerLabel: "Amazon",
        amazonQuery: `travel essentials ${destination}`
      };
  }
}
