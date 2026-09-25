import type { TripPlannerPayload } from "@/lib/trip-planner";

export type GuestDayPreviewBlock = {
  period: "Morning" | "Afternoon" | "Evening";
  title: string;
  detail: string;
};

export type GuestDayPreview = {
  destination: string;
  origin: string;
  dateLabel: string;
  title: string;
  summary: string;
  disclaimer: string;
  blocks: GuestDayPreviewBlock[];
  continuesBehindAccount: string[];
  source: "market_result" | "known_place" | "trip_inputs";
};

type KnownStop = {
  title: string;
  area: string;
  interests: string[];
  period: "afternoon" | "evening";
  note: string;
};

type MarketStop = {
  title: string;
  area: string;
  category: string;
};

const GENERIC_ACTIVITY_TITLE =
  /top attraction ticket|walking highlights tour|food tasting tour|evening guided experience|airport transfer|local transit|official event schedule|step-free routes|community events|pride official events|^market option$|events festivals concerts|flight search|hotel search|restaurant reservations|notable restaurants|official menu reservations/i;

const KNOWN_DESTINATIONS: Array<{ match: RegExp; stops: KnownStop[] }> = [
  {
    match: /montreal|montréal/i,
    stops: [
      {
        title: "Notre-Dame Basilica of Montreal",
        area: "Old Montreal",
        interests: ["Culture", "Romance", "Museums"],
        period: "afternoon",
        note: "A central Old Montreal landmark that fits a first walk after arrival."
      },
      {
        title: "Pointe-a-Calliere Museum",
        area: "Old Montreal",
        interests: ["Culture", "Museums", "Family"],
        period: "afternoon",
        note: "The archaeology and history museum beside the Old Port."
      },
      {
        title: "Montreal Museum of Fine Arts",
        area: "Golden Square Mile",
        interests: ["Museums", "Culture"],
        period: "afternoon",
        note: "An indoor museum stop near downtown food and metro routes."
      },
      {
        title: "Mount Royal lookout",
        area: "Mount Royal",
        interests: ["Nature", "Adventure", "Family"],
        period: "afternoon",
        note: "A free lookout. Trail conditions still need a check on the day."
      },
      {
        title: "Old Montreal",
        area: "Old Montreal",
        interests: ["Food", "Romance", "Shopping"],
        period: "evening",
        note: "Keep dinner in the same area as the afternoon stop."
      },
      {
        title: "Quartier des Spectacles",
        area: "Downtown Montreal",
        interests: ["Nightlife"],
        period: "evening",
        note: "An evening area for music and nightlife, with no table held."
      }
    ]
  },
  {
    match: /toronto/i,
    stops: [
      {
        title: "CN Tower",
        area: "Entertainment District",
        interests: ["Culture", "Family", "Adventure", "Romance"],
        period: "afternoon",
        note: "A timed-entry landmark beside the waterfront and Union Station."
      },
      {
        title: "Royal Ontario Museum",
        area: "Bloor-Yorkville",
        interests: ["Museums", "Culture", "Family"],
        period: "afternoon",
        note: "An indoor museum near subway access and Yorkville."
      },
      {
        title: "Ripley's Aquarium of Canada",
        area: "South Core",
        interests: ["Family"],
        period: "afternoon",
        note: "An indoor stop next to the CN Tower corridor."
      },
      {
        title: "Entertainment District",
        area: "Entertainment District",
        interests: ["Food", "Nightlife", "Shopping"],
        period: "evening",
        note: "Dinner stays near the afternoon stop. No reservation is held."
      }
    ]
  },
  {
    match: /vancouver/i,
    stops: [
      {
        title: "Vancouver Lookout",
        area: "Harbour Centre",
        interests: ["Culture", "Family", "Adventure", "Romance"],
        period: "afternoon",
        note: "A compact downtown viewpoint above the waterfront."
      },
      {
        title: "Museum of Anthropology at UBC",
        area: "University of British Columbia",
        interests: ["Museums", "Culture"],
        period: "afternoon",
        note: "A cultural museum stop when the first day can spare the ride to UBC."
      },
      {
        title: "FlyOver Canada",
        area: "Canada Place",
        interests: ["Adventure", "Family"],
        period: "afternoon",
        note: "A short waterfront activity at Canada Place."
      },
      {
        title: "Gastown",
        area: "Gastown",
        interests: ["Food", "Nightlife", "Shopping", "Romance"],
        period: "evening",
        note: "An evening walk and dinner area. No table is held."
      }
    ]
  }
];

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function dayOneDestination(payload: TripPlannerPayload) {
  const stop = payload.tripType === "multi_city" ? payload.destinationStops?.[0] : payload.destinationPlace;
  const fromPlace = clean(stop?.city) || clean(stop?.value) || clean(stop?.label);
  if (fromPlace) return fromPlace;
  const destination = clean(payload.destinationCity) || clean(payload.destination);
  const firstLeg = destination.split(/\s*(?:→|->)\s*/)[0]?.trim() || destination;
  return firstLeg || "your destination";
}

function isGenericTitle(title: string) {
  return title.length < 3 || GENERIC_ACTIVITY_TITLE.test(title);
}

function readMarketStops(discovery: Record<string, unknown> | undefined) {
  const results = Array.isArray(discovery?.marketResults) ? discovery.marketResults : [];
  const stops: MarketStop[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const category = clean(record.category);
    if (category !== "attraction" && category !== "tour" && category !== "restaurant") continue;
    if (clean(record.source) === "fallback_estimate") continue;
    const title = clean(record.title);
    if (isGenericTitle(title)) continue;
    stops.push({
      title,
      area: clean(record.city),
      category
    });
  }
  return stops;
}

function knownStopsFor(destination: string) {
  for (const entry of KNOWN_DESTINATIONS) {
    if (entry.match.test(destination)) return entry.stops;
  }
  return [];
}

function interestScore(stop: KnownStop, interests: string[]) {
  const wanted = new Set(interests.map((interest) => interest.toLowerCase()));
  return stop.interests.reduce((sum, interest) => sum + (wanted.has(interest.toLowerCase()) ? 1 : 0), 0);
}

function pickKnown(stops: KnownStop[], interests: string[], period: "afternoon" | "evening") {
  const pool = stops.filter((stop) => stop.period === period);
  if (!pool.length) return null;
  let best = pool[0];
  let bestScore = -1;
  for (const stop of pool) {
    const score = interestScore(stop, interests);
    if (score > bestScore) {
      best = stop;
      bestScore = score;
    }
  }
  return best;
}

function samePlace(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function buildGuestDayPreview(payload: TripPlannerPayload): GuestDayPreview {
  const destination = dayOneDestination(payload);
  const origin = clean(payload.origin);
  const interests = (payload.interests || []).map((interest) => interest.trim()).filter(Boolean);
  const primaryInterest = interests[0] || "Culture";
  const pace = clean(payload.pace) || "Balanced";
  const style = clean(payload.travelStyle) || "Balanced";
  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(payload.startDate || "") ? payload.startDate : "";
  const market = readMarketStops(payload.priceDiscovery);
  const known = knownStopsFor(destination);
  const marketAfternoon = market.find((stop) => stop.category === "attraction" || stop.category === "tour") || null;
  const knownAfternoon = pickKnown(known, interests, "afternoon");
  const afternoon = marketAfternoon || knownAfternoon;
  const marketEvening = market.find((stop) => stop.category === "restaurant" && stop.title !== afternoon?.title) || null;
  const knownEvening = pickKnown(
    known.filter((stop) => stop.title !== afternoon?.title),
    interests,
    "evening"
  );
  const travelingIn = Boolean(origin) && !samePlace(origin, destination);
  const source: GuestDayPreview["source"] =
    marketAfternoon || marketEvening ? "market_result" : knownAfternoon || knownEvening ? "known_place" : "trip_inputs";

  const afternoonTitle = afternoon?.title || `${primaryInterest} time in ${destination}`;
  const afternoonDetail = marketAfternoon
    ? `${marketAfternoon.area ? `${marketAfternoon.area}. ` : ""}This stop came from the search for this trip. It is a sample only.`
    : knownAfternoon
      ? `${knownAfternoon.area}. ${knownAfternoon.note}`
      : `A ${pace.toLowerCase()} ${primaryInterest.toLowerCase()} block in ${destination}. This preview does not invent a venue.`;

  const eveningTitle = marketEvening?.title || knownEvening?.title || `Evening in ${destination}`;
  const eveningDetail = marketEvening
    ? `${marketEvening.area ? `${marketEvening.area}. ` : ""}A dinner idea from this trip's search. No table is held.`
    : knownEvening
      ? `${knownEvening.area}. ${knownEvening.note}`
      : `Keep the evening near the afternoon stop in ${destination}. Later days are generated after you save.`;

  return {
    destination,
    origin,
    dateLabel,
    title: `Day 1 in ${destination}`,
    summary: `${style} sample for ${destination}${dateLabel ? ` on ${dateLabel}` : ""}.`,
    disclaimer: "Sample of day 1. Nothing is booked or charged.",
    blocks: [
      {
        period: "Morning",
        title: travelingIn ? `Arrive from ${origin}` : `Start in ${destination}`,
        detail: travelingIn
          ? `Day 1 begins by getting from ${origin} to ${destination}. This preview does not reserve transport.`
          : `Day 1 starts in ${destination} with a short orientation before the first stop. This preview does not reserve transport.`
      },
      {
        period: "Afternoon",
        title: afternoonTitle,
        detail: afternoonDetail
      },
      {
        period: "Evening",
        title: eveningTitle,
        detail: eveningDetail
      }
    ],
    continuesBehindAccount: ["Save this plan", "Regenerate the itinerary", "Continue past day 1"],
    source
  };
}
