export const GENERATION_PERSONALIZATION_KEYS = [
  "preferred_travel_pace",
  "maximum_comfortable_driving_hours",
  "preferred_departure_windows",
  "airport_preferences",
  "transportation_preferences",
  "maximum_acceptable_transfers",
  "accommodation_types",
  "hotel_priorities",
  "preferred_neighbourhood_style",
  "nightlife_interests",
  "food_interests",
  "culture_interests",
  "nature_interests",
  "shopping_interests",
  "walking_tolerance",
  "room_preferences",
  "hotel_change_tolerance",
  "typical_budget_level",
  "likes",
  "dislikes"
] as const;

export type GenerationPersonalizationKey = (typeof GENERATION_PERSONALIZATION_KEYS)[number];

export type TravelerPersonalizationContext = {
  enabled: boolean;
  accepted: Partial<Record<GenerationPersonalizationKey, unknown>>;
  inferred: Partial<Record<GenerationPersonalizationKey, unknown>>;
};

type ProfileMemory = {
  personalization_enabled?: boolean | null;
  confirmed_preferences?: Record<string, unknown> | null;
  inferred_preferences?: Record<string, unknown> | null;
};

function safeValue(value: unknown): unknown {
  if (typeof value === "string") return value.trim().slice(0, 240);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)))
      .map((item) => (typeof item === "string" ? item.trim().slice(0, 120) : item))
      .filter(Boolean)
      .slice(0, 30);
  }
  return null;
}

function safePreferences(value: Record<string, unknown> | null | undefined) {
  const result: Partial<Record<GenerationPersonalizationKey, unknown>> = {};
  for (const key of GENERATION_PERSONALIZATION_KEYS) {
    if (!value || !Object.prototype.hasOwnProperty.call(value, key)) continue;
    const cleaned = safeValue(value[key]);
    if (cleaned === null || cleaned === "" || (Array.isArray(cleaned) && cleaned.length === 0)) continue;
    result[key] = cleaned;
  }
  return result;
}

export function buildTravelerPersonalizationContext(profile: ProfileMemory | null | undefined): TravelerPersonalizationContext {
  if (!profile || profile.personalization_enabled === false) {
    return { enabled: false, accepted: {}, inferred: {} };
  }

  const accepted = safePreferences(profile.confirmed_preferences);
  const allInferred = safePreferences(profile.inferred_preferences);
  const inferred = Object.fromEntries(
    Object.entries(allInferred).filter(([key]) => !Object.prototype.hasOwnProperty.call(accepted, key))
  ) as Partial<Record<GenerationPersonalizationKey, unknown>>;

  return { enabled: true, accepted, inferred };
}

export function personalizationText(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(" ");
  return typeof value === "string" ? value : "";
}

function matchesHotelText(hotelText: string, preference: string) {
  const actual = hotelText.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = preference.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return Boolean(actual && wanted && (actual.includes(wanted) || wanted.includes(actual)));
}

export function hotelPersonalizationScore(params: {
  hotelText: string;
  currentAccommodationPreference?: string | null;
  personalization?: TravelerPersonalizationContext;
}) {
  if (!params.personalization?.enabled || params.currentAccommodationPreference) return { score: 0, reason: null };
  const relevantKeys = new Set(["accommodation_types", "hotel_priorities", "preferred_neighbourhood_style", "room_preferences", "likes", "dislikes"]);
  const values = (source: Record<string, unknown>, keyFilter: (key: string) => boolean) => Object.entries(source)
    .filter(([key]) => relevantKeys.has(key) && keyFilter(key))
    .map(([, value]) => personalizationText(value))
    .flatMap((value) => value.split(/[,;]+/))
    .map((value) => value.trim())
    .filter(Boolean);
  const acceptedLikes = values(params.personalization.accepted, (key) => key !== "dislikes");
  const acceptedDislikes = values(params.personalization.accepted, (key) => key === "dislikes");
  if (acceptedDislikes.some((value) => matchesHotelText(params.hotelText, value))) {
    return { score: -6, reason: "accepted traveler accommodation dislike" };
  }
  if (acceptedLikes.some((value) => matchesHotelText(params.hotelText, value))) {
    return { score: 6, reason: "accepted traveler accommodation preference" };
  }
  const inferredLikes = values(params.personalization.inferred, (key) => key !== "dislikes");
  const inferredDislikes = values(params.personalization.inferred, (key) => key === "dislikes");
  if (inferredDislikes.some((value) => matchesHotelText(params.hotelText, value))) {
    return { score: -2, reason: "inferred traveler accommodation dislike" };
  }
  if (inferredLikes.some((value) => matchesHotelText(params.hotelText, value))) {
    return { score: 2, reason: "inferred traveler accommodation signal" };
  }
  return { score: 0, reason: null };
}
