import type { TripPlannerPayload } from "@/lib/trip-planner";

export const amazonAffiliateDisclosure =
  "Roamly may earn a commission from qualifying purchases. This does not change your price.";

export const travelEssentialCategories = [
  "Luggage & packing",
  "Power & tech",
  "Comfort",
  "Weather gear",
  "Documents & safety",
  "Destination-specific items"
] as const;

export type RoamlyEssentialCategory = (typeof travelEssentialCategories)[number];
export type RoamlyEssentialPriority = "high" | "medium" | "low";

export type RoamlyPreTripEssential = {
  title: string;
  reason: string;
  category: RoamlyEssentialCategory;
  search_query: string;
  amazon_url: string;
  priority: RoamlyEssentialPriority;
};

type EssentialDraft = Omit<RoamlyPreTripEssential, "amazon_url">;

function clean(value?: string | null) {
  return (value || "").trim();
}

function normalizeMarketplace(value?: string | null) {
  const host = clean(value || process.env.ROAMLY_AMAZON_MARKETPLACE || "amazon.com")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase();

  if (/^amazon\.[a-z.]+$/.test(host)) return host;
  return "amazon.com";
}

function associateTag(value?: string | null) {
  const tag = clean(value || process.env.ROAMLY_AMAZON_ASSOCIATE_TAG);
  return /^[A-Za-z0-9_-]+$/.test(tag) ? tag : "";
}

export function getAmazonAffiliateConfig() {
  const tag = associateTag();
  const enabled = process.env.ROAMLY_AMAZON_ENABLED === "true" && Boolean(tag);
  return {
    enabled,
    marketplace: normalizeMarketplace(),
    associateTag: tag
  };
}

export function buildAmazonSearchUrl(
  searchQuery: string,
  options: { marketplace?: string | null; associateTag?: string | null; enabled?: boolean } = {}
) {
  const query = clean(searchQuery) || "travel essentials";
  const marketplace = normalizeMarketplace(options.marketplace);
  const tag = associateTag(options.associateTag);
  const enabled = options.enabled ?? (process.env.ROAMLY_AMAZON_ENABLED === "true");
  const url = new URL(`https://${marketplace}/s`);
  url.searchParams.set("k", query);
  if (enabled && tag) url.searchParams.set("tag", tag);
  return url.toString();
}

function destinationLabel(payload: TripPlannerPayload) {
  if (payload.tripType === "multi_city" && payload.destinationStops?.length) {
    return payload.destinationStops.map((stop) => stop.city || stop.value || stop.label).filter(Boolean).join(", ");
  }
  return payload.destinationCity || payload.destination;
}

function hasDifferentCountries(payload: TripPlannerPayload) {
  const origin = clean(payload.originCountry).toLowerCase();
  const destination = clean(payload.destinationCountry).toLowerCase();
  return Boolean(origin && destination && origin !== destination);
}

function tripDays(payload: TripPlannerPayload) {
  if (payload.daysCount && Number.isFinite(payload.daysCount)) return Math.max(1, Math.round(payload.daysCount));
  if (!payload.startDate || !payload.endDate) return 3;
  const start = new Date(`${payload.startDate}T00:00:00`);
  const end = new Date(`${payload.endDate}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 3;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function monthFromDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.getUTCMonth() + 1;
}

function isSouthernHemisphere(payload: TripPlannerPayload) {
  const text = `${payload.destinationCountry || ""} ${payload.destination || ""}`.toLowerCase();
  return [
    "argentina",
    "australia",
    "bolivia",
    "brazil",
    "chile",
    "new zealand",
    "peru",
    "south africa",
    "uruguay"
  ].some((country) => text.includes(country));
}

export function describeTripSeason(payload: TripPlannerPayload) {
  const month = monthFromDate(payload.startDate);
  if (!month) return "season unknown; prepare for variable weather";
  const southern = isSouthernHemisphere(payload);
  const winter = southern ? [6, 7, 8] : [12, 1, 2];
  const summer = southern ? [12, 1, 2] : [6, 7, 8];
  const shoulder = southern ? [3, 4, 5, 9, 10, 11] : [3, 4, 5, 9, 10, 11];
  if (winter.includes(month)) return "winter or cooler-season travel";
  if (summer.includes(month)) return "summer or warmer-season travel";
  if (shoulder.includes(month)) return "shoulder-season travel with changeable weather";
  return "variable-season travel";
}

function interestsText(payload: TripPlannerPayload) {
  return payload.interests.length ? payload.interests.join(", ") : "general sightseeing";
}

function hasInterest(payload: TripPlannerPayload, ...needles: string[]) {
  const text = `${payload.interests.join(" ")} ${payload.travelStyle} ${payload.specialNotes} ${payload.destination}`.toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function destinationSpecificDraft(payload: TripPlannerPayload): EssentialDraft {
  const destination = destinationLabel(payload) || "your destination";
  if (hasInterest(payload, "beach", "diving", "snorkel", "island")) {
    return {
      title: "Waterproof phone pouch or dry bag",
      reason: `Useful for beach, boat, or water-heavy days around ${destination}.`,
      category: "Destination-specific items",
      search_query: "waterproof phone pouch dry bag travel beach",
      priority: "medium"
    };
  }
  if (hasInterest(payload, "hiking", "nature", "adventure")) {
    return {
      title: "Lightweight daypack",
      reason: `Fits hikes, nature stops, and longer activity days without bringing full luggage around ${destination}.`,
      category: "Destination-specific items",
      search_query: "lightweight packable daypack travel hiking",
      priority: "medium"
    };
  }
  if (hasInterest(payload, "business")) {
    return {
      title: "Travel garment folder",
      reason: `Helps keep outfits cleaner and less wrinkled for a business-focused ${destination} trip.`,
      category: "Destination-specific items",
      search_query: "travel garment folder wrinkle free packing",
      priority: "medium"
    };
  }
  if (hasInterest(payload, "family") || (payload.travelers?.children || 0) > 0) {
    return {
      title: "Kids travel activity kit",
      reason: `Keeps children occupied during transfers and slower moments on a ${tripDays(payload)}-day trip.`,
      category: "Destination-specific items",
      search_query: "kids travel activity kit airplane car trip",
      priority: "medium"
    };
  }
  return {
    title: "Anti-theft crossbody bag",
    reason: `Useful for busy transit, markets, and crowded sightseeing areas in ${destination}.`,
    category: "Destination-specific items",
    search_query: "anti theft crossbody travel bag RFID",
    priority: "medium"
  };
}

function weatherDraft(payload: TripPlannerPayload): EssentialDraft {
  const season = describeTripSeason(payload);
  const destination = destinationLabel(payload) || "your destination";
  if (season.includes("winter") || hasInterest(payload, "ski", "snow")) {
    return {
      title: "Packable insulated layer",
      reason: `Adds warmth for ${season} in ${destination} without taking over your luggage.`,
      category: "Weather gear",
      search_query: "packable insulated jacket travel lightweight",
      priority: "high"
    };
  }
  if (season.includes("summer") || hasInterest(payload, "beach", "island")) {
    return {
      title: "Sun hat and travel sunscreen",
      reason: `Good for warmer-season days, outdoor activities, and long walks around ${destination}.`,
      category: "Weather gear",
      search_query: "packable sun hat travel sunscreen",
      priority: "high"
    };
  }
  return {
    title: "Packable rain jacket",
    reason: `Covers shoulder-season or changeable weather without adding much bulk for ${destination}.`,
    category: "Weather gear",
    search_query: "packable rain jacket travel lightweight",
    priority: "high"
  };
}

export function describeTravelEssentialsContext(payload: TripPlannerPayload) {
  const destination = destinationLabel(payload) || payload.destination;
  return [
    `Destination: ${destination}`,
    `Dates: ${payload.startDate || "flexible"} to ${payload.endDate || "flexible"}`,
    `Trip length: ${tripDays(payload)} days`,
    `Travel style: ${payload.travelStyle || "Balanced"}`,
    `Activities/interests: ${interestsText(payload)}`,
    `Weather/season cue: ${describeTripSeason(payload)}`,
    `International adapter likely useful: ${hasDifferentCountries(payload) ? "yes" : "check destination plug type"}`
  ].join("; ");
}

export function withAmazonUrl(item: EssentialDraft): RoamlyPreTripEssential {
  return {
    ...item,
    amazon_url: buildAmazonSearchUrl(item.search_query)
  };
}

export function buildPreTripEssentials(payload: TripPlannerPayload): RoamlyPreTripEssential[] {
  const destination = destinationLabel(payload) || "your destination";
  const days = tripDays(payload);
  const longTrip = days >= 7;
  const multiCity = payload.tripType === "multi_city" && (payload.destinationStops?.length || 0) > 1;
  const style = payload.travelStyle || "Balanced";
  const adapterPriority: RoamlyEssentialPriority = hasDifferentCountries(payload) ? "high" : "medium";

  const drafts: EssentialDraft[] = [
    {
      title: "Carry-on luggage",
      reason: `${multiCity ? "Multi-city routing" : `${days}-day travel`} is easier with a lightweight carry-on that matches a ${style.toLowerCase()} travel style.`,
      category: "Luggage & packing",
      search_query: "carry-on luggage lightweight travel",
      priority: "high"
    },
    {
      title: "Packing cubes",
      reason: `${longTrip ? "Longer trips" : "Short trips"} stay easier to repack when outfits, layers, and laundry are separated.`,
      category: "Luggage & packing",
      search_query: "packing cubes travel organizer set",
      priority: "high"
    },
    {
      title: "Universal travel adapter",
      reason: hasDifferentCountries(payload)
        ? `Useful because this trip crosses countries; verify the plug type for ${destination}.`
        : `Helpful if hotels, airports, or activities around ${destination} use different outlet access than expected.`,
      category: "Power & tech",
      search_query: "universal travel adapter USB C international",
      priority: adapterPriority
    },
    {
      title: "Portable charger",
      reason: `Supports maps, tickets, translation, and photos during long sightseeing days around ${destination}.`,
      category: "Power & tech",
      search_query: "portable charger power bank travel USB C",
      priority: "high"
    },
    {
      title: "Travel pillow and eye mask",
      reason: `Adds comfort on flights, trains, rideshares, or recovery breaks during a ${days}-day itinerary.`,
      category: "Comfort",
      search_query: "travel pillow eye mask set",
      priority: "medium"
    },
    weatherDraft(payload),
    {
      title: "Passport and document organizer",
      reason: `Keeps IDs, insurance details, confirmations, and backup cards together before departure.`,
      category: "Documents & safety",
      search_query: "passport holder travel document organizer RFID",
      priority: "high"
    },
    destinationSpecificDraft(payload)
  ];

  return drafts.map(withAmazonUrl);
}

function cleanCategory(value: unknown): RoamlyEssentialCategory {
  const text = clean(typeof value === "string" ? value : "").toLowerCase();
  return travelEssentialCategories.find((category) => category.toLowerCase() === text) || "Destination-specific items";
}

function cleanPriority(value: unknown, index: number): RoamlyEssentialPriority {
  if (value === "high" || value === "medium" || value === "low") return value;
  if (index <= 2) return "high";
  if (index <= 6) return "medium";
  return "low";
}

function stripPriceReferences(value: string) {
  return value
    .replace(/(?:US\$|CA\$|\$|USD\s*|CAD\s*)\s?\d+(?:[.,]\d{2})?/gi, "current price")
    .replace(/\bunder\s+current price\b/gi, "check the current price")
    .replace(/\bfor\s+current price\b/gi, "at the current price")
    .trim();
}

function normalizeEssentialRecord(item: unknown, index: number, payload: TripPlannerPayload): RoamlyPreTripEssential | null {
  const record = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
  const title = stripPriceReferences(clean(typeof record.title === "string" ? record.title : ""));
  if (!title) return null;
  const searchQuery = clean(
    typeof record.search_query === "string"
      ? record.search_query
      : typeof record.searchQuery === "string"
        ? record.searchQuery
        : typeof record.query === "string"
          ? record.query
          : `${title} ${destinationLabel(payload)} travel`
  );
  const reason = stripPriceReferences(
    clean(typeof record.reason === "string" ? record.reason : "") ||
      `Recommended for ${destinationLabel(payload) || payload.destination} based on trip length, activities, and travel style.`
  );

  return withAmazonUrl({
    title,
    reason,
    category: cleanCategory(record.category),
    search_query: searchQuery || title,
    priority: cleanPriority(record.priority, index)
  });
}

function itemMatches(item: RoamlyPreTripEssential, pattern: RegExp) {
  return pattern.test(`${item.title} ${item.search_query}`.toLowerCase());
}

function priorityRank(priority: RoamlyEssentialPriority) {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}

export function normalizePreTripEssentials(
  value: unknown,
  fallback: RoamlyPreTripEssential[],
  payload: TripPlannerPayload
) {
  const raw = Array.isArray(value) ? value : [];
  const cleaned = raw
    .map((item, index) => normalizeEssentialRecord(item, index, payload))
    .filter((item): item is RoamlyPreTripEssential => Boolean(item));
  const essentials = cleaned.length ? [...cleaned] : [...fallback];
  const requiredPatterns = [/carry[- ]?on|luggage/, /packing cube/, /adapter/];

  for (const pattern of requiredPatterns) {
    const required = fallback.find((item) => itemMatches(item, pattern));
    if (required && !essentials.some((item) => itemMatches(item, pattern))) {
      essentials.push(required);
    }
  }

  return essentials
    .map((item) =>
      withAmazonUrl({
        title: stripPriceReferences(item.title),
        reason: stripPriceReferences(item.reason),
        category: cleanCategory(item.category),
        search_query: item.search_query || item.title,
        priority: cleanPriority(item.priority, 4)
      })
    )
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 10);
}
