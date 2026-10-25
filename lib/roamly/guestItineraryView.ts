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

/** Honest empty-window copy: when a day window has no places, the guest
 *  page says so plainly instead of dressing the gap up as a plan. The
 *  zero-engine generation layer writes this same string for an empty
 *  window, and this view maps any legacy generic filler stored before
 *  the fix (see GUEST_LEGACY_GENERIC_FILLER_TEXTS) to it on read — so
 *  stored history is never rewritten, but it always renders honestly. */
export const GUEST_EMPTY_WINDOW_TEXT =
  "Nothing planned here yet — Roamly didn't find places for this part of the day.";

/** Generic filler the zero-engine used to emit for an empty window
 *  (lib/roamly/engine/generate.ts blockText fallbacks, pre-fix). These
 *  read like a plan ("a gentle start", "open time", "a quiet evening")
 *  while naming nothing — the view must never surface them. */
export const GUEST_LEGACY_GENERIC_FILLER_TEXTS = [
  "A gentle start around your stay.",
  "Open time — rest, wander, or revisit a favorite spot.",
  "A quiet evening near your stay."
] as const;

/** Honest empty-flights copy + search link. The link is a search, never
 *  a flight option: no flight, price, or time is claimed. */
export const GUEST_NO_FLIGHTS_TEXT = "No flight options found for this trip yet.";
export const GUEST_FLIGHT_SEARCH_CTA = "Search flights on Aviasales";
export const GUEST_AVIASALES_SEARCH_URL = "https://www.aviasales.com/";

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
  /** Aviasales search link for the trip, carried through only when the
   *  caller supplies a trusted aviasales.com URL. When flights is empty
   *  the guest page renders the flights section honestly with this link
   *  instead of hiding the section. Null = no search link available
   *  (older API responses), in which case the section stays hidden. */
  flightSearchUrl: string | null;
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

function isLegacyGenericFiller(value: string) {
  const normalized = value.trim().toLowerCase();
  return (GUEST_LEGACY_GENERIC_FILLER_TEXTS as readonly string[]).some(
    (filler) => filler.toLowerCase() === normalized
  );
}

/** A window with no places — blank, or carrying legacy generic filler —
 *  renders as the honest empty state, never as prose that reads like a
 *  plan. A window naming real places passes through untouched. */
function honestWindowText(value: string) {
  const text = value.trim();
  if (!text || isLegacyGenericFiller(text)) return GUEST_EMPTY_WINDOW_TEXT;
  return text;
}

function dayFromRecord(value: unknown, destination = ""): GuestItineraryDayView | null {
  const day = asRecord(value);
  if (!day) return null;
  const dayNumber = Number(day.day_number ?? day.dayNumber);
  if (!Number.isFinite(dayNumber) || dayNumber < 1) return null;
  const timeline = Array.isArray(day.live_timeline) ? day.live_timeline : [];
  const morning = honestWindowText(clip(day.morning));
  const afternoon = honestWindowText(clip(day.afternoon));
  const evening = honestWindowText(clip(day.evening));
  const food = (Array.isArray(day.food) ? day.food : [])
    .map((item) => clip(item, 160))
    .filter(Boolean)
    .slice(0, 4);
  const timelineView = timeline
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
    .slice(0, 8);
  // Day-title honesty: a first-stop name is honest only when the day
  // evidences a stop. A wholly empty day (honest-empty windows, no food,
  // no timeline) never keeps a stored stop-named title — it falls back
  // to "Day N in <destination>". A blank stored title gets the same
  // fallback. Any day with real content keeps its stored title.
  const whollyEmpty =
    morning === GUEST_EMPTY_WINDOW_TEXT &&
    afternoon === GUEST_EMPTY_WINDOW_TEXT &&
    evening === GUEST_EMPTY_WINDOW_TEXT &&
    food.length === 0 &&
    timelineView.length === 0;
  const storedTitle = clip(day.title, 180);
  const title =
    whollyEmpty || !storedTitle
      ? destination
        ? `Day ${dayNumber} in ${destination}`
        : `Day ${dayNumber}`
      : storedTitle;
  return {
    dayNumber,
    date: clip(day.date, 40) || null,
    title,
    morning,
    afternoon,
    evening,
    food,
    timeline: timelineView
  };
}

function daysFromItinerary(fullJson: unknown, destination = "") {
  const days = asRecord(fullJson)?.daily_itinerary;
  if (!Array.isArray(days)) return [];
  return days
    .map((day) => dayFromRecord(day, destination))
    .filter((day): day is GuestItineraryDayView => Boolean(day))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

function daysFromMetadata(metadata: unknown, destination = "") {
  const generatedDays = asRecord(asRecord(asRecord(metadata)?.generation)?.generatedDays);
  if (!generatedDays) return [];
  return Object.values(generatedDays)
    .map((day) => dayFromRecord(day, destination))
    .filter((day): day is GuestItineraryDayView => Boolean(day))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

function paidUnlockSource(value: string) {
  return value === "paid" || value === "bundle" || value === "admin";
}

// A price without a known currency is not a price a guest can trust: never
// invent a currency code for it (provenance law). Where a priced suggestion
// carries no currency, the label says so plainly instead of showing a
// currency-qualified amount.
const PRICE_NOT_AVAILABLE = "price not available";

function bookingPriceLabel(suggestion: Record<string, unknown>): string | null {
  const currency = clip(suggestion.currency, 12);
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
  // Amounts without a currency are not price evidence and must not render
  // as a bare or currency-qualified number.
  if (nightly != null || min != null || max != null) {
    if (!currency) return PRICE_NOT_AVAILABLE;
  }
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

function bookingSection(
  fullJson: unknown,
  categories: string[],
  limit = 3,
  requirePriceEvidence = false
): GuestBookingCard[] {
  const suggestions = asRecord(fullJson)?.booking_suggestions;
  if (!Array.isArray(suggestions)) return [];
  const cards: GuestBookingCard[] = [];
  for (const suggestion of suggestions) {
    const record = asRecord(suggestion);
    const category = (clip(record?.booking_category, 40) || clip(record?.category, 40)).toLowerCase();
    if (!categories.includes(category)) continue;
    const card = bookingCardFromSuggestion(suggestion);
    // Price evidence = a real priced label: amounts plus a known currency.
    // "price not available" (amounts, no currency) and null (no amounts) are
    // explicitly NOT evidence, so they can never appear as budget-matched.
    if (requirePriceEvidence && (!card || card.priceLabel == null || card.priceLabel === PRICE_NOT_AVAILABLE)) continue;
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
  /** Caller-supplied Aviasales search link (the guest route builds it
   *  from the trip's own origin/dates via the Travelpayouts builder).
   *  Only a trusted aviasales.com URL is carried through — any other
   *  host is dropped rather than surfaced to a guest. */
  flightSearchUrl?: string | null;
}): GuestItineraryView {
  const full = asRecord(input.fullJson);
  const generation = asRecord(asRecord(input.metadata)?.generation);
  const generationStatus = clip(generation?.status, 40).toLowerCase();
  const tripStatus = clip(input.tripStatus, 40).toLowerCase();
  const itineraryStatus = clip(input.itineraryStatus, 40).toLowerCase();
  const destination = clip(input.destination, 160);
  const storedDays = daysFromItinerary(input.fullJson, destination);
  const days = storedDays.length ? storedDays : daysFromMetadata(input.metadata, destination);
  const final =
    FINAL_NOTE.test(clip(full?.generation_note, 200)) ||
    generationStatus === "complete" ||
    itineraryStatus === "generated" ||
    itineraryStatus === "locked";
  const failed = generationStatus === "failed" || tripStatus === "failed" || itineraryStatus === "failed";
  const status: GuestItineraryStatus = final && days.length ? "ready" : failed ? "failed" : "building";
  const title = clip(full?.trip_title, 180) || clip(input.tripTitle, 180) || (destination ? `${destination} itinerary` : "Your free itinerary");
  const summary = clip(full?.destination_summary, 500) || (destination ? `Free itinerary for ${destination}.` : "Your free itinerary is on this page.");
  const flightSearchUrl = (() => {
    const raw = clip(input.flightSearchUrl, 1000);
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || (url.hostname !== "www.aviasales.com" && url.hostname !== "aviasales.com")) return null;
      return url.toString();
    } catch {
      return null;
    }
  })();

  return {
    title,
    summary,
    disclaimer: GUEST_FREE_ITINERARY_DISCLAIMER,
    status,
    days,
    // Stays render under "Stay picks matched to your budget" in
    // GuestFreeItinerary, so only priced stays may appear there. When no
    // stay carries price evidence, stays is empty and the component's
    // existing length guard hides the section entirely — unpriced stays are
    // never presented as budget-matched. Other sections keep their existing
    // behaviour (their headings make no budget claim).
    stays: bookingSection(input.fullJson, ["hotel"], 3, true),
    flights: bookingSection(input.fullJson, ["flight", "transport", "car_rental"]),
    flightSearchUrl,
    experiences: bookingSection(input.fullJson, ["attraction", "tour", "activity"]),
    essentials: bookingSection(input.fullJson, ["product"], 4),
    continuesBehindAccount: GUEST_ACCOUNT_WALL
  };
}
