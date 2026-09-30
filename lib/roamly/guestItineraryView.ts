export const GUEST_ITINERARY_PATH = "/plan/itinerary";
export const GUEST_FREE_ITINERARY_DISCLAIMER = "This is your free itinerary. Nothing is booked or charged.";
export const GUEST_ACCOUNT_WALL = [
  "Save this itinerary",
  "Continue beyond this free itinerary",
  "Live Companion",
  "Paid packs"
] as const;
export const GUEST_PAID_ENTITLEMENT_MESSAGE =
  "Paid itineraries, Live Companion, and paid packs need an account and a paid entitlement.";

export type GuestItineraryStatus = "building" | "ready" | "failed";

export type GuestItineraryTimelineItem = {
  time: string;
  title: string;
  bookingUrl: string | null;
  bookingLabel: string | null;
};

export type GuestItineraryDayView = {
  dayNumber: number;
  date: string | null;
  title: string;
  morning: string;
  afternoon: string;
  evening: string;
  food: string[];
  timeline: GuestItineraryTimelineItem[];
};

export type GuestBookingCard = {
  title: string;
  detail: string;
  priceLabel: string | null;
  url: string;
  provider: string;
  ctaLabel: string;
};

export type GuestItineraryView = {
  title: string;
  summary: string;
  disclaimer: typeof GUEST_FREE_ITINERARY_DISCLAIMER;
  status: GuestItineraryStatus;
  days: GuestItineraryDayView[];
  stays: GuestBookingCard[];
  flights: GuestBookingCard[];
  experiences: GuestBookingCard[];
  essentials: GuestBookingCard[];
  continuesBehindAccount: readonly string[];
};

const FINAL_NOTE = /generated through roamly staged ai generation/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clip(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function dayFromRecord(value: unknown): GuestItineraryDayView | null {
  const day = asRecord(value);
  if (!day) return null;
  const dayNumber = Number(day.day_number ?? day.dayNumber);
  if (!Number.isFinite(dayNumber) || dayNumber < 1) return null;
  const timeline = Array.isArray(day.live_timeline) ? day.live_timeline : [];
  return {
    dayNumber,
    date: clip(day.date, 40) || null,
    title: clip(day.title, 180),
    morning: clip(day.morning),
    afternoon: clip(day.afternoon),
    evening: clip(day.evening),
    food: (Array.isArray(day.food) ? day.food : [])
      .map((item) => clip(item, 160))
      .filter(Boolean)
      .slice(0, 4),
    timeline: timeline
      .map((item) => {
        const record = asRecord(item);
        const booking = asRecord(record?.booking);
        return {
          time: clip(record?.time_label, 40),
          title: clip(record?.title, 180),
          bookingUrl: clip(booking?.url, 500) || null,
          bookingLabel: clip(booking?.ctaLabel, 80) || clip(record?.booking_label, 80) || null
        };
      })
      .filter((item) => item.title)
      .slice(0, 8)
  };
}

function daysFromItinerary(fullJson: unknown) {
  const days = asRecord(fullJson)?.daily_itinerary;
  if (!Array.isArray(days)) return [];
  return days
    .map(dayFromRecord)
    .filter((day): day is GuestItineraryDayView => Boolean(day))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

function daysFromMetadata(metadata: unknown) {
  const generatedDays = asRecord(asRecord(asRecord(metadata)?.generation)?.generatedDays);
  if (!generatedDays) return [];
  return Object.values(generatedDays)
    .map(dayFromRecord)
    .filter((day): day is GuestItineraryDayView => Boolean(day))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

function paidUnlockSource(value: string) {
  return value === "paid" || value === "bundle" || value === "admin";
}

function bookingPriceLabel(suggestion: Record<string, unknown>): string | null {
  const currency = clip(suggestion.currency, 12) || "CAD";
  const min = typeof suggestion.estimated_cost_min === "number" && Number.isFinite(suggestion.estimated_cost_min)
    ? Math.round(suggestion.estimated_cost_min)
    : null;
  const max = typeof suggestion.estimated_cost_max === "number" && Number.isFinite(suggestion.estimated_cost_max)
    ? Math.round(suggestion.estimated_cost_max)
    : null;
  const nightlyMin =
    typeof suggestion.estimated_nightly_cost_min === "number" && Number.isFinite(suggestion.estimated_nightly_cost_min)
      ? Math.round(suggestion.estimated_nightly_cost_min)
      : null;
  const nightlyMax =
    typeof suggestion.estimated_nightly_cost_max === "number" && Number.isFinite(suggestion.estimated_nightly_cost_max)
      ? Math.round(suggestion.estimated_nightly_cost_max)
      : null;
  const nightly = nightlyMin ?? nightlyMax;
  if (nightly != null) {
    const range = nightlyMin != null && nightlyMax != null && nightlyMax > nightlyMin ? `${nightlyMin}–${nightlyMax}` : `${nightly}`;
    return `about ${currency} ${range}/night`;
  }
  if (min != null && max != null && max > min) return `${currency} ${min}–${max}`;
  if (max != null) return `about ${currency} ${max}`;
  if (min != null) return `from ${currency} ${min}`;
  return null;
}

function bookingCardFromSuggestion(value: unknown): GuestBookingCard | null {
  const suggestion = asRecord(value);
  if (!suggestion) return null;
  const url = clip(suggestion.affiliate_url, 1000) || clip(suggestion.normal_search_url, 1000);
  const title = clip(suggestion.title, 180) || clip(suggestion.booking_label, 180);
  if (!url || !title) return null;
  // Never surface internal/placeholder links to guests.
  if (/^https?:\/\/roamly\.local/i.test(url)) return null;
  const detail =
    clip(suggestion.why_recommended, 280) ||
    clip(suggestion.description, 280) ||
    clip(suggestion.reason, 280);
  return {
    title,
    detail,
    priceLabel: bookingPriceLabel(suggestion),
    url,
    provider: clip(suggestion.affiliate_provider, 80) || clip(suggestion.provider, 80) || clip(suggestion.provider_or_search_source, 80),
    ctaLabel: clip(suggestion.booking_label, 80) || "View option"
  };
}

function bookingSection(fullJson: unknown, categories: string[], limit = 3): GuestBookingCard[] {
  const suggestions = asRecord(fullJson)?.booking_suggestions;
  if (!Array.isArray(suggestions)) return [];
  const cards: GuestBookingCard[] = [];
  for (const suggestion of suggestions) {
    const record = asRecord(suggestion);
    const category = (clip(record?.booking_category, 40) || clip(record?.category, 40)).toLowerCase();
    if (!categories.includes(category)) continue;
    const card = bookingCardFromSuggestion(suggestion);
    if (card && !cards.some((existing) => existing.title === card.title && existing.url === card.url)) {
      cards.push(card);
    }
    if (cards.length >= limit) break;
  }
  return cards;
}

export function guestFreeItineraryEntitlement(trip: {
  itinerary_payment_status?: string | null;
  itinerary_unlock_source?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  metadata?: unknown;
}) {
  const payment = clip(trip.itinerary_payment_status, 40).toLowerCase();
  const source = clip(trip.itinerary_unlock_source, 40).toLowerCase();
  const generationSource = clip(asRecord(asRecord(trip.metadata)?.generation)?.unlockSource, 40).toLowerCase();
  const paidItinerary = payment === "paid" || payment === "bundled" || paidUnlockSource(source) || paidUnlockSource(generationSource);
  const paidPack = trip.tracking_unlocked === true || trip.live_companion_unlocked === true;
  if (paidItinerary || paidPack) return { allowed: false as const, code: "PAYMENT_REQUIRED" as const };
  return { allowed: true as const, code: "free" as const };
}

export function publicGuestItineraryView(input: {
  tripTitle?: string | null;
  destination?: string | null;
  tripStatus?: string | null;
  itineraryStatus?: string | null;
  fullJson?: unknown;
  metadata?: unknown;
}): GuestItineraryView {
  const full = asRecord(input.fullJson);
  const generation = asRecord(asRecord(input.metadata)?.generation);
  const generationStatus = clip(generation?.status, 40).toLowerCase();
  const tripStatus = clip(input.tripStatus, 40).toLowerCase();
  const itineraryStatus = clip(input.itineraryStatus, 40).toLowerCase();
  const storedDays = daysFromItinerary(input.fullJson);
  const days = storedDays.length ? storedDays : daysFromMetadata(input.metadata);
  const final =
    FINAL_NOTE.test(clip(full?.generation_note, 200)) ||
    generationStatus === "complete" ||
    itineraryStatus === "generated" ||
    itineraryStatus === "locked";
  const failed = generationStatus === "failed" || tripStatus === "failed" || itineraryStatus === "failed";
  const status: GuestItineraryStatus = final && days.length ? "ready" : failed ? "failed" : "building";
  const destination = clip(input.destination, 160);
  const title = clip(full?.trip_title, 180) || clip(input.tripTitle, 180) || (destination ? `${destination} itinerary` : "Your free itinerary");
  const summary = clip(full?.destination_summary, 500) || (destination ? `Free itinerary for ${destination}.` : "Your free itinerary is on this page.");

  return {
    title,
    summary,
    disclaimer: GUEST_FREE_ITINERARY_DISCLAIMER,
    status,
    days,
    stays: bookingSection(input.fullJson, ["hotel"]),
    flights: bookingSection(input.fullJson, ["flight", "transport", "car_rental"]),
    experiences: bookingSection(input.fullJson, ["attraction", "tour", "activity"]),
    essentials: bookingSection(input.fullJson, ["product"], 4),
    continuesBehindAccount: GUEST_ACCOUNT_WALL
  };
}
