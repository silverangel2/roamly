/*
 * Place detail — panel 6 of the owner mock (correct-4-pages-part2.jpg,
 * 2nd panel): photo + planned time range + duration + description;
 * actions Directions / Add to calendar / Save; "About this place"
 * (Address, photos, opening hours, ticket info, helpful tips);
 * Nearby places with walk times; "Tips for your visit" checklist.
 *
 * REAL-DATA-ONLY RULES (this module is pure: no fetch, no DB, no
 * network — every claim it makes comes from its inputs, so the
 * checks script can prove each rule without a server):
 *
 * - The place shown is ALWAYS one live_timeline item of the trip's
 *   own itinerary (see resolvePlaceInItinerary). The resolver never
 *   searches another trip, a search suggestion, or a pack candidate,
 *   so per-trip isolation is structural, not a display promise.
 * - Mock sample values are never defaults here: no place name, time,
 *   description, nearby name, or walk time is hardcoded anywhere in
 *   this file. A missing field renders as null and the panel shows
 *   an honest unavailable state for it.
 * - Photos: the caller supplies at most the ONE photo the existing
 *   destination-photo pipeline returned for this place
 *   (lib/roamly/destinationPhoto.ts, Wikimedia/Wikidata, cached).
 *   The pipeline never returns six photos, so the count badge is
 *   "1/1" when a photo exists and absent entirely otherwise — the
 *   mock's "1/6" is never copied. No photo -> bare treatment.
 * - About fields: Address comes ONLY from an exactly-title-matched
 *   confirmed booking row (see findConfirmedBookingForPlace); the
 *   plan item's location_name/map_query is an area label, NOT a
 *   street address, and is never relabeled as one. Opening hours and
 *   ticket info have NO traveler-facing source for a plan item (the
 *   Places pack enrichment is keyed by pack candidates, not by
 *   itinerary item_id, and is never surfaced to traveler UI), so
 *   they are always null here — the panel says so per field.
 * - Nearby: ONLY same-day sibling stops from this trip's own plan
 *   (travel/transfer legs and generic stops excluded), CAPPED AT 2
 *   (Picture 6 shows two cards). A booking-linked sibling's card
 *   title is re-derived from its booking's CURRENT truth
 *   (placeTitleForTruth) — never the stored title verbatim, whose
 *   baked stamp can be stale (a since-cancelled booking must never
 *   appear as Confirmed here); a sibling with no resolvable booking
 *   keeps its stored title unchanged. Sibling photos come only from the
 *   real pipeline via the caller's siblingPhotos map (coords-gated);
 *   a sibling without one gets no photo element, never a broken
 *   image, and NO heart icon renders — no saved-places store exists.
 *   Walk times
 *   are NOT routed: the codebase's only routing source
 *   (lib/roamly/liveRouting.ts, Google Distance Matrix) needs a live
 *   origin and serves the live companion only. When BOTH stops carry
 *   coordinates (seed.coordinates {latitude, longitude}), the walk
 *   time is a haversine estimate at 4.8 km/h and is ALWAYS labeled
 *   "(est.)". When either side lacks coordinates, the walk time is
 *   null and the panel says "Walk time unavailable" — never a guess.
 * - Tips: there is NO per-place tips field on a plan item. The only
 *   real tip data is the trip's own itinerary.local_tips, shown with
 *   the provenance note "From this trip's plan". Empty -> null.
 * - Actions: Directions is a Google Maps dir link built from the
 *   item's own coordinates or map query (always valid while the
 *   item has a title). Add to calendar and Save have NO mechanism in
 *   this codebase (no ICS/calendar export, no saved-places store),
 *   so this module exposes them as unavailable — the panel renders
 *   them disabled with an explanation, never as working buttons.
 *
 * EVIDENCE BOUNDARIES (what each badge/claim is allowed to mean):
 * - Planned: the item is in this trip's plan. Always true for a
 *   resolved item; the badge reads "Planned" unless a confirmed
 *   booking anchors it (see Confirmed).
 * - Time-eligible: a time range is shown ONLY when the item carries
 *   a real planned window (start + end, or a parseable time_label
 *   range). Otherwise the panel shows "Flexible" and no clock times.
 * - Location-verified: a Directions link is built ONLY from the
 *   item's own coordinates / map_query / title (+ destination city),
 *   never from a guessed address; an Address row needs the confirmed
 *   booking source above.
 * - Confirmed: the badge reads the provenance label ("Confirmed · from your …") ONLY when a booking row
 *   exactly title-matches the item AND satisfies the ONE booking-
 *   truth rule at the providerConfirmationEvidence tier (lib/roamly/bookingTruth:
 *   credible provider evidence — patterned code + real provider +
 *   a RECORDED provider-issued origin — + traveler_confirmed +
 *   active status + non-test, non-superseded; mirrored locally in
 *   truthIsConfirmed below so this module stays import-free). Plan
 *   data alone never earns "Confirmed". A linked booking that is
 *   traveler-confirmed but NOT provider-verified (the legacy
 *   no-recorded-source case) earns the honest badge "Confirmed by
 *   you" instead, and its address is withheld — the address is
 *   provider-grade evidence and a traveler assertion alone does not
 *   release it. A linked booking whose current truth is
 *   cancelled/refunded earns a "Cancelled"/"Refunded" badge
 *   instead — never "Planned" as if the booking were still active.
 *
 * All clock math here is wall-clock string math (never Date), so
 * rendering is identical under every TZ. Day headings are computed
 * with timeZone "UTC" over a UTC-noon date, so the weekday never
 * shifts with the viewer's timezone.
 */

export type PlaceDetailPhoto = {
  imageUrl: string;
  credit: string | null;
  pageUrl: string | null;
  /** Always "1/1": the pipeline returns at most one photo per place. */
  countLabel: "1/1";
  /** Mirror of DestinationPhoto["source"] (lib/roamly/destinationPhoto)
   *  — declared locally so this module stays import-free for the
   *  deterministic Node checks that load it directly. */
  source: "wikimedia-commons" | "wikimedia-commons-geosearch" | "openstreetmap-image" | "openverse";
};

export type PlaceDetailNearby = {
  /** item_id when the sibling carries one, else the deterministic fallback id. */
  id: string;
  title: string;
  /** Owner-10 item 5: unverifiable junk-title sibling — the card
   *  renders "Unplanned stop" with the plan title kept. */
  unverified: boolean;
  planTitle: string | null;
  /** Real pipeline photo for this sibling, or null (no photo element). */
  photo: PlaceDetailPhotoInput | null;
  /** e.g. "8 min walk (est.)" — null when either side lacks coordinates. */
  walkLabel: string | null;
  /** Straight-line km, 1 decimal, when both sides carry coordinates. */
  distanceKm: number | null;
};

export type PlaceDetailAbout = {
  /** ONLY from an exactly-matched confirmed booking row; else null. */
  address: string | null;
  /** No traveler-facing source for a plan item: always null today. */
  openingHours: string[] | null;
  /** No traveler-facing source for a plan item: always null today. */
  ticketInfo: string | null;
  /** True when the trip's own local_tips are non-empty. */
  tipsAvailable: boolean;
};

export type PlaceDetailEvidence = {
  planned: true;
  /** True when a real planned time window exists. */
  timeKnown: boolean;
  /** True when the item carries coordinates or a map query. */
  locationKnown: boolean;
  /** True only when a confirmation-evidence booking exactly title-matches. */
  confirmed: boolean;
  /** True when the linked booking is traveler-confirmed only
   *  ("Confirmed by you") — never provider-verified. */
  travelerConfirmed: boolean;
};

/**
 * Owner-10 item 5 — the same title-echo rule as
 * itineraryHome.stripTitleEcho, duplicated here because this module
 * is loaded directly by deterministic Node checks.
 */
export function stripPlaceTitleEcho(title: string, detail: string | null): string | null {
  const text = (detail || "").trim();
  if (!text) return null;
  const plain = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  if (plain(text) === plain(title)) return null;
  let out = text;
  const rawTitle = (title || "").trim();
  if (rawTitle && text.toLowerCase().startsWith(rawTitle.toLowerCase())) {
    out = text.slice(rawTitle.length);
  } else if (rawTitle && plain(text).startsWith(plain(rawTitle))) {
    const dash = text.search(/[—–-]/);
    if (dash !== -1) out = text.slice(dash + 1);
  } else {
    return text;
  }
  out = out.trim().replace(/^[—–-]\s*/, "").trim();
  if (/^planned for day \d+ of this trip\.?$/i.test(out)) return null;
  return out || null;
}

export type PlaceDetail = {
  placeId: string;
  dayNumber: number;
  dayLabel: string;
  title: string;
  /** Owner-10 item 5: true for an unverifiable junk-title stop; the
   *  panel renders "Unplanned stop" with planTitle kept. */
  unverified: boolean;
  /** The stored plan title when unverified; null otherwise. */
  planTitle: string | null;
  description: string | null;
  badge: string; // "Planned" | provenance label ("Confirmed · from your … email") | "Confirmed by you" | "Cancelled" | "Refunded"
  evidence: PlaceDetailEvidence;
  /** e.g. "1:00 PM – 3:00 PM" — null when no real window exists. */
  timeRangeLabel: string | null;
  /**
   * Repair round item 1 — the time window's provenance, mirroring
   * lib/roamly/timeProvenance.ts provenanceForPlaceTime (kept inline
   * so this module stays import-free): "confirmed" only when the
   * record's timing_status is FACTUAL; "estimated" when the record
   * carries retimed_by_event (a recalculation, not the original plan
   * window); otherwise "planned" (the original stored plan window,
   * unchanged). The badge above is a separate fact (booking status
   * for the place); it never upgrades this window on its own.
   */
  timeProvenance: "planned" | "estimated" | "confirmed";
  /** e.g. "2h" / "45m" / "1h 15m" — null when not derivable. */
  durationLabel: string | null;
  /** Area label from the plan (NOT a street address); null when it duplicates the title. */
  locationLabel: string | null;
  /** Google Maps dir link from the item's own data; null only if no query exists. */
  directionsUrl: string | null;
  photo: PlaceDetailPhoto | null;
  about: PlaceDetailAbout;
  nearby: PlaceDetailNearby[];
  /** The trip's own local_tips; empty array when the trip has none. */
  tips: string[];
  /** Provenance note for tips; null when there are no tips. */
  tipsProvenance: string | null;
  tripHeader: {
    destination: string;
    origin: string | null;
    /** e.g. "Oct 26 – Oct 30, 2026" — null when no trip dates exist. */
    dateRangeLabel: string | null;
  };
};

export type PlaceDetailPhotoInput = {
  imageUrl: string;
  credit?: string | null;
  pageUrl?: string | null;
  /** The pipeline's provenance for this photo (DestinationPhoto["source"]);
   *  absent = a pre-fallback caller, read as Tier 0. */
  source?: PlaceDetailPhoto["source"] | null;
};

type RawRecord = Record<string, unknown>;

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanFrom(record: RawRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(record[key]);
    if (value) return value;
  }
  return null;
}

function numberFrom(record: RawRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** Titles the bundle itself marks as unresolved — never a place. */
const UNUSABLE_TITLE = /^(?:unresolved place|unknown place|unknown location|location unavailable|no destination selected|not available|n\/a|tbd)$/i;

export function isUsablePlaceTitle(value: unknown): value is string {
  const title = clean(value);
  if (!title || UNUSABLE_TITLE.test(title)) return false;
  return !/\bschemas\.live\.com\b/i.test(title);
}

/** Normalized title for EXACT matching only — fuzzy matching could
 *  attach another booking's address or Confirmed badge to this place. */
export function normalizePlaceTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Workstream A + Round 2 Lane E2: the confirmed rule is the ONE
 * booking-truth rule (lib/roamly/bookingTruth) at the
 * providerConfirmationEvidence tier, applied with an EXACT title match:
 * credible provider evidence + traveler_confirmed + active status +
 * non-test, non-superseded. The local mirror below keeps this
 * module import-free for the deterministic Node checks that load it
 * directly (the same reason bookingExtraction keeps its test-pattern
 * mirror local): it implements bookingTruth.hasProviderConfirmationEvidence /
 * isConfirmed exactly for the field shapes a booking row carries
 * here — patterned identifier (≥4 code chars with a digit, never
 * TEST-RMLY/placeholder), a real provider identity (not a
 * test/QA/self pseudo-provider), and a RECORDED provider-issued
 * origin (email/gmail or traveler-entered/screenshot source,
 * email_import/email_lookback provenance, or an email: source
 * reference). LOCKSTEP NOTE (Round 2): the round-1 mirror's legacy
 * exception — a no-recorded-source row accepted on the
 * traveler_confirmed flag alone — is REMOVED here in lockstep with
 * bookingTruth.ts under the owner's 2026-10-30 ruling; such a row
 * is travelerConfirmedOnly (truthIsTravelerConfirmedOnly below),
 * never in the confirmation-evidence tier. Keep both mirrors in lockstep with
 * bookingTruth.ts.
 */
const TRUTH_ACTIVE_STATUSES = new Set([
  "booked", "paid", "reserved", "confirmed", "modified", "completed", "ticketed", "issued"
]);
const TRUTH_PSEUDO_PROVIDERS = new Set([
  "", "unknown", "unknown provider", "test", "test provider", "qa", "qa test", "qa test provider",
  "roamly", "roamly qa", "roamly qa test provider", "self", "traveler", "manual", "gmail", "email",
  "provider", "n/a", "none", "tbd"
]);
const TRUTH_PLACEHOLDER_CODES = new Set(["unknown", "pending", "none", "null", "n/a", "tbd", "1234", "0000", "12345"]);
const TRUTH_EMAIL_SOURCES = new Set(["email", "gmail", "outlook"]);
const TRUTH_TRAVELER_SOURCES = new Set([
  "manual", "screenshot", "upload", "provider", "provider_sync", "live_provider", "affiliate", "affiliate_conversion"
]);

function truthIsTestBooking(booking: RawRecord): boolean {
  if (booking.is_test_booking === true) return true;
  const metadata = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
    ? (booking.metadata as RawRecord)
    : null;
  if (metadata?.qa_test === true) return true;
  const pattern = /\bQA\b|test stay|test provider/i;
  const title = cleanFrom(booking, "title") || "";
  const provider = cleanFrom(booking, "provider_name", "provider") || "";
  if (pattern.test(title) || pattern.test(provider)) return true;
  const code = cleanFrom(booking, "confirmation_number", "confirmation_code", "confirmationCode", "provider_booking_id") || "";
  return /TEST-RMLY/i.test(code);
}

/** Lockstep mirror of bookingTruth.isTravelerDiscardedBooking
 *  (Tombstone workstream, 2026-10-31): the discard mark stamped in
 *  the booking's metadata (or the serializer's is_discarded flag)
 *  means the traveler removed this import — it earns no tier here. */
function truthIsDiscardedBooking(booking: RawRecord): boolean {
  if (booking.is_discarded === true || booking.isDiscarded === true) return true;
  const metadata = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
    ? (booking.metadata as RawRecord)
    : null;
  if (!metadata) return false;
  const mark = metadata.emailImportDiscarded;
  return Boolean(mark && typeof mark === "object") || metadata.email_import_discarded === true;
}

function truthIsConfirmed(booking: RawRecord): boolean {
  if (booking.superseded_by_booking_id != null) return false;
  if (truthIsDiscardedBooking(booking)) return false;
  if (truthIsTestBooking(booking)) return false;
  const status = (cleanFrom(booking, "booking_status", "status") || "").toLowerCase();
  if (!TRUTH_ACTIVE_STATUSES.has(status)) return false;
  if (booking.traveler_confirmed !== true && booking.travelerConfirmed !== true) return false;
  const code = cleanFrom(booking, "confirmation_number", "confirmation_code", "confirmationCode", "provider_booking_id") || "";
  if (code.length < 4 || code.length > 64) return false;
  if (TRUTH_PLACEHOLDER_CODES.has(code.toLowerCase())) return false;
  if (/TEST-RMLY/i.test(code)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(code)) return false;
  if (!/\d/.test(code) && code.length < 6) return false;
  const provider = cleanFrom(booking, "provider_name", "provider") || "";
  if (provider.length < 2) return false;
  if (TRUTH_PSEUDO_PROVIDERS.has(provider.toLowerCase())) return false;
  if (/\bqa\b|test stay|test provider/i.test(provider)) return false;
  const source = (cleanFrom(booking, "source_type", "sourceType") || "").toLowerCase();
  if (TRUTH_EMAIL_SOURCES.has(source) || TRUTH_TRAVELER_SOURCES.has(source)) return true;
  const metadata = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
    ? (booking.metadata as RawRecord)
    : null;
  const requirements = booking.reservation_requirements && typeof booking.reservation_requirements === "object" && !Array.isArray(booking.reservation_requirements)
    ? (booking.reservation_requirements as RawRecord)
    : null;
  if (metadata?.email_import || metadata?.email_lookback || requirements?.email_import || requirements?.email_lookback) return true;
  if ((cleanFrom(booking, "source_reference", "sourceReference") || "").startsWith("email:")) return true;
  // Round 2 lockstep: NO legacy exception — a row with no recorded
  // origin never earns the confirmation-evidence tier, even with the flag set.
  return false;
}

/** Mirror of bookingTruth.isTravelerConfirmedOnly: flag set, active
 *  status, non-test, non-superseded — but NOT confirmation-evidenced. */
function truthIsTravelerConfirmedOnly(booking: RawRecord): boolean {
  if (booking.superseded_by_booking_id != null) return false;
  if (truthIsDiscardedBooking(booking)) return false;
  if (truthIsTestBooking(booking)) return false;
  const status = (cleanFrom(booking, "booking_status", "status") || "").toLowerCase();
  if (!TRUTH_ACTIVE_STATUSES.has(status)) return false;
  if (booking.traveler_confirmed !== true && booking.travelerConfirmed !== true) return false;
  return !truthIsConfirmed(booking);
}

/**
 * Round 3 (Lane T) mirror of bookingTruth.bookingProvenanceLabel:
 * the confirmation-evidence tier's badge states its provenance
 * ("Confirmed · from your {Provider} email" / "· from your
 * screenshot" / "· from details you provided" / "· reported by
 * {Provider}") and never reads plain "Confirmed" or "Verified" —
 * the evidence arrived inside traveler-supplied material; Roamly
 * did not independently check it with the provider. Keep in
 * lockstep with bookingTruth.bookingProvenanceSuffix.
 */
function placeBookingProvenanceLabel(booking: RawRecord | null): string {
  if (!booking) return "Confirmed · from your booking details";
  const provider = cleanFrom(booking, "provider_name", "provider") || "";
  const realProvider =
    provider.length >= 2 && !TRUTH_PSEUDO_PROVIDERS.has(provider.toLowerCase()) && !/\bqa\b|test stay|test provider/i.test(provider)
      ? provider
      : "";
  const source = (cleanFrom(booking, "source_type", "sourceType") || "").toLowerCase();
  const metadata = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
    ? (booking.metadata as RawRecord)
    : null;
  const requirements = booking.reservation_requirements && typeof booking.reservation_requirements === "object" && !Array.isArray(booking.reservation_requirements)
    ? (booking.reservation_requirements as RawRecord)
    : null;
  if (
    TRUTH_EMAIL_SOURCES.has(source) ||
    metadata?.email_import || metadata?.email_lookback ||
    requirements?.email_import || requirements?.email_lookback ||
    (cleanFrom(booking, "source_reference", "sourceReference") || "").startsWith("email:")
  ) {
    return realProvider ? `Confirmed · from your ${realProvider} email` : "Confirmed · from your email";
  }
  if (source === "screenshot") return "Confirmed · from your screenshot";
  if (source === "upload") return "Confirmed · from your upload";
  if (source === "manual") return "Confirmed · from details you provided";
  if (["provider", "provider_sync", "live_provider", "affiliate", "affiliate_conversion"].includes(source)) {
    return realProvider ? `Confirmed · reported by ${realProvider}` : "Confirmed · provider-reported";
  }
  return "Confirmed · from your booking details";
}

/**
 * Round 3 (Lane F) mirrors of bookingTruth.stripBookingStampPrefix
 * and bookingTruth.titleForTruth, kept in lockstep so this module
 * stays import-free: the honest display title for a booking-linked
 * item, derived from the booking's CURRENT truth — never from the
 * stamp baked into the stored title. The confirmation-evidence tier
 * stamps its provenance label, traveler_confirmed stamps
 * "Confirmed by you:", cancelled/refunded re-stamp honestly, and
 * every other truth state renders the bare title with no confirmed
 * framing.
 */
function placeStripBookingStampPrefix(title: string): string {
  return title.replace(/^(?:confirmed by you|confirmed(?:\s·\s[^:\n]+)?|cancelled|canceled|refunded):\s*/i, "");
}

function placeTitleForTruth(storedTitle: string, booking: RawRecord): string {
  const bare = placeStripBookingStampPrefix(storedTitle);
  switch (placeBookingTruthState(booking)) {
    case "confirmed":
      return `${placeBookingProvenanceLabel(booking)}: ${bare}`;
    case "traveler_confirmed":
      return `Confirmed by you: ${bare}`;
    case "cancelled":
      return `Cancelled: ${bare}`;
    case "refunded":
      return `Refunded: ${bare}`;
    default:
      return bare;
  }
}

/** The linked booking's CURRENT truth state, for badge derivation. */
export function placeBookingTruthState(booking: RawRecord): string {
  if (booking.superseded_by_booking_id != null) return "superseded";
  if (truthIsDiscardedBooking(booking)) return "discarded";
  if (truthIsTestBooking(booking)) return "test";
  const status = (cleanFrom(booking, "booking_status", "status") || "").toLowerCase();
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "refunded") return "refunded";
  if (truthIsConfirmed(booking)) return "confirmed";
  if (truthIsTravelerConfirmedOnly(booking)) return "traveler_confirmed";
  return "unverified";
}

/**
 * Exact-title match for the booking linked to this place, whatever
 * its current truth state (the badge derives from that state, so a
 * cancelled booking's place can never show Confirmed, or Planned as
 * if still active). Returns the matching row or null.
 */
export function findLinkedBookingForPlace(
  bookings: readonly RawRecord[],
  title: string
): RawRecord | null {
  // Audit fix: the confirmed-booking override bakes a "Confirmed: "
  // (or "Cancelled: ") prefix into the itinerary item's stored title,
  // which defeated this exact-title match. Strip the stamp first.
  const wanted = normalizePlaceTitle(title.replace(/^(?:confirmed by you|confirmed(?:\s·\s[^:\n]+)?|cancelled|canceled|refunded):\s*/i, ""));
  if (!wanted) return null;
  for (const booking of bookings) {
    const bookingTitle = cleanFrom(booking, "title");
    if (!bookingTitle || normalizePlaceTitle(bookingTitle) !== wanted) continue;
    return booking;
  }
  return null;
}

export function findConfirmedBookingForPlace(
  bookings: readonly RawRecord[],
  title: string
): RawRecord | null {
  const linked = findLinkedBookingForPlace(bookings, title);
  if (!linked) return null;
  return truthIsConfirmed(linked) ? linked : null;
}

/** "13:00" or "1:00 PM" -> minutes since midnight; null when unparseable. */
export function parseClockMinutes(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const military = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const hour = Number(military[1]);
    const minute = Number(military[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }
  const twelve = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|AM|PM)$/i);
  if (!twelve) return null;
  let hour = Number(twelve[1]);
  const minute = Number(twelve[2] || "0");
  const period = twelve[3].replace(/\./g, "").toUpperCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

/** Minutes since midnight -> "1:00 PM" (the mock's clock style). */
export function formatClockMinutes(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** "2 hours" / "90 min" style strings -> minutes; null when unparseable. */
export function parseDurationMinutes(value: string): number | null {
  const raw = value.trim().toLowerCase();
  const hoursOnly = raw.match(/^(\d+)\s*(?:hours?|hrs?|h)$/);
  if (hoursOnly) return Number(hoursOnly[1]) * 60;
  const minutesOnly = raw.match(/^(\d+)\s*(?:minutes?|mins?|m)$/);
  if (minutesOnly) return Number(minutesOnly[1]);
  const combined = raw.match(/^(\d+)\s*(?:hours?|hrs?|h)\s+(\d+)\s*(?:minutes?|mins?|m)$/);
  if (combined) return Number(combined[1]) * 60 + Number(combined[2]);
  return null;
}

/** Minutes -> "2h" / "45m" / "1h 15m" (the mock's duration style). */
export function formatDurationMinutes(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours > 0 && remainder > 0) return `${hours}h ${remainder}m`;
  if (hours > 0) return `${hours}h`;
  return `${remainder}m`;
}

function parseDayParts(date: string): { year: number; month: number; day: number } | null {
  const match = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** TZ-invariant: weekday/month/day from a YYYY-MM-DD date via UTC. */
export function formatDayLabel(date: string | null, dayNumber: number): string {
  const base = `Day ${dayNumber}`;
  if (!date) return base;
  const parts = parseDayParts(date);
  if (!parts) return base;
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  if (Number.isNaN(utc.getTime())) return base;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(utc);
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(utc);
  return `${base} · ${weekday}, ${monthDay}`;
}

function formatMonthDayYear(date: string | null): string | null {
  if (!date) return null;
  const parts = parseDayParts(date);
  if (!parts) return null;
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  if (Number.isNaN(utc.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(utc);
}

export function formatTripDateRange(start: string | null, end: string | null): string | null {
  const startLabel = formatMonthDayYear(start);
  const endLabel = formatMonthDayYear(end);
  if (startLabel && endLabel) {
    // "Oct 26 – Oct 30, 2026": drop the start year when both share it.
    const startParts = parseDayParts(start || "");
    const endParts = parseDayParts(end || "");
    if (startParts && endParts && startParts.year === endParts.year) {
      const utc = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day, 12));
      const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(utc);
      return `${short} – ${endLabel}`;
    }
    return `${startLabel} – ${endLabel}`;
  }
  return startLabel || endLabel;
}

/** Mirror of the timeline's transfer test: travel legs are not places. */
export function isTransferLikeItem(record: RawRecord): boolean {
  const text = [
    cleanFrom(record, "item_type", "type"),
    cleanFrom(record, "category"),
    cleanFrom(record, "title"),
    cleanFrom(record, "travel_mode", "transportMode", "transport_mode")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(travel|transfer|transit|taxi|rideshare|shuttle|walk to|travel to|transfer to|drive to|get to)\b/.test(text);
}

export function itemCoordinates(record: RawRecord): { latitude: number; longitude: number } | null {
  const directLat = numberFrom(record, "latitude");
  const directLon = numberFrom(record, "longitude");
  if (directLat != null && directLon != null) return { latitude: directLat, longitude: directLon };
  const coords = record.coordinates;
  if (coords && typeof coords === "object" && !Array.isArray(coords)) {
    const nested = coords as RawRecord;
    const lat = numberFrom(nested, "latitude", "lat");
    const lon = numberFrom(nested, "longitude", "lon", "lng");
    if (lat != null && lon != null) return { latitude: lat, longitude: lon };
  }
  return null;
}

/** Straight-line km between two coordinate pairs. */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const WALK_KM_PER_HOUR = 4.8;

/**
 * Haversine walk estimate, ALWAYS labeled "(est.)" — this is not a
 * routed walk time. Null when either side lacks coordinates.
 */
export function estimateWalk(
  from: { latitude: number; longitude: number } | null,
  to: { latitude: number; longitude: number } | null
): { walkLabel: string; distanceKm: number } | null {
  if (!from || !to) return null;
  const km = haversineKm(from, to);
  const minutes = Math.max(1, Math.round((km / WALK_KM_PER_HOUR) * 60));
  return { walkLabel: `${minutes} min walk (est.)`, distanceKm: Math.round(km * 10) / 10 };
}

/** Google Maps dir link from the item's own data (mirrors mapsUrlForActivity's shape, walking mode). */
export function buildDirectionsUrl(
  item: RawRecord,
  destination: string | null
): string | null {
  const coords = itemCoordinates(item);
  let query: string | null = null;
  if (coords) {
    query = `${coords.latitude},${coords.longitude}`;
  } else {
    const parts = [
      cleanFrom(item, "map_query", "mapQuery"),
      cleanFrom(item, "location_name", "location", "place_name"),
      cleanFrom(item, "title")
    ].filter((part): part is string => Boolean(part));
    // The destination city is appended only when the query does not
    // already name it — a map_query like "X, Montreal" must not become
    // "X, Montreal, Montreal, Canada".
    const cityPart = destination ? destination.split(",")[0].trim() : "";
    if (destination && cityPart && !parts.join(", ").toLowerCase().includes(cityPart.toLowerCase())) parts.push(destination);
    query = parts.join(", ");
  }
  if (!query) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}&travelmode=walking`;
}

/** Deterministic fallback id when a stored item carries no item_id. */
export function fallbackPlaceId(dayNumber: number, index: number): string {
  return `d${dayNumber}-${index}`;
}

export type PlaceDayInput = {
  day_number: number;
  date?: string | null;
  live_timeline: readonly RawRecord[];
};

export type PlaceDetailInput = {
  item: RawRecord;
  day: PlaceDayInput;
  /** Raw sibling items from the SAME day of the SAME trip. */
  siblings: readonly { item: RawRecord; id: string }[];
  trip: {
    destination: string | null;
    origin: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  /** The trip's own itinerary.local_tips (real plan data, or []). */
  tripTips: readonly string[];
  confirmedBookings: readonly RawRecord[];
  photo: PlaceDetailPhotoInput | null;
  /** Real pipeline photos for siblings, keyed by sibling id. */
  siblingPhotos?: Readonly<Record<string, PlaceDetailPhotoInput>>;
};

function timeWindow(item: RawRecord): { rangeLabel: string; durationFromWindow: number | null } | null {
  const startRaw = cleanFrom(item, "startTime", "start_time");
  const endRaw = cleanFrom(item, "endTime", "end_time");
  const start = startRaw ? parseClockMinutes(startRaw) : null;
  const end = endRaw ? parseClockMinutes(endRaw) : null;
  if (start != null && end != null && end > start) {
    return { rangeLabel: `${formatClockMinutes(start)} – ${formatClockMinutes(end)}`, durationFromWindow: end - start };
  }
  // A time_label range ("1:00 PM – 3:00 PM") is a real planned window too.
  const label = cleanFrom(item, "time_label", "time");
  if (label) {
    const parts = label.split(/–|-/).map((part) => part.trim());
    if (parts.length === 2) {
      const labelStart = parseClockMinutes(parts[0]);
      const labelEnd = parseClockMinutes(parts[1]);
      if (labelStart != null && labelEnd != null && labelEnd > labelStart) {
        return { rangeLabel: `${formatClockMinutes(labelStart)} – ${formatClockMinutes(labelEnd)}`, durationFromWindow: labelEnd - labelStart };
      }
    }
  }
  // Audit fix: a FACTUAL start with no end (the confirmed-booking
  // override deliberately stores start-only) is a known time. It used
  // to fall through to null, so the detail page paired a "Confirmed:"
  // title with a "Flexible" chip.
  if (start != null && (cleanFrom(item, "timing_status") || "").toUpperCase() === "FACTUAL") {
    return { rangeLabel: formatClockMinutes(start), durationFromWindow: null };
  }
  return null;
}

export function buildPlaceDetail(input: PlaceDetailInput): PlaceDetail | null {
  const { item, day, siblings, trip, tripTips, confirmedBookings, photo } = input;
  const storedTitle = cleanFrom(item, "title", "name");
  if (!storedTitle || !isUsablePlaceTitle(storedTitle)) return null;
  // X1 read path (Workstream A): the badge and the displayed title
  // derive from the linked booking's CURRENT truth, not the stored
  // stamp. A booking cancelled after its item was stamped "Confirmed:"
  // renders here with the stamp stripped and a Cancelled badge — never
  // Confirmed, and never Planned as if still active.
  const linkedBooking = findLinkedBookingForPlace(confirmedBookings, storedTitle);
  const linkedTruth = linkedBooking ? placeBookingTruthState(linkedBooking) : null;
  const title =
    linkedTruth && linkedTruth !== "confirmed"
      ? storedTitle.replace(/^(?:confirmed by you|confirmed|cancelled|canceled|refunded):\s*/i, "")
      : storedTitle;

  const rawDescription = cleanFrom(item, "description", "summary", "details", "notes");
  const description = stripPlaceTitleEcho(title, rawDescription);
  // Owner-10 item 5: a bare-acronym stop with no real description is
  // not a venue. It stays a reachable, plainly-labeled unplanned item.
  const unverified = /^[A-Z0-9]{2,4}$/.test(title) && description == null;
  const window = timeWindow(item);
  const explicitMinutes = numberFrom(item, "durationMinutes", "duration_minutes");
  const durationRaw = cleanFrom(item, "duration");
  const durationMinutes =
    explicitMinutes != null && explicitMinutes > 0
      ? explicitMinutes
      : window?.durationFromWindow ?? (durationRaw ? parseDurationMinutes(durationRaw) : null);
  const durationLabel = formatDurationMinutes(durationMinutes ?? NaN) ?? (durationRaw && parseDurationMinutes(durationRaw) == null ? durationRaw : null);

  const confirmedBooking = findConfirmedBookingForPlace(confirmedBookings, title);
  const confirmed = confirmedBooking != null;
  const address = confirmedBooking ? cleanFrom(confirmedBooking, "address") : null;

  const locationRaw = cleanFrom(item, "location_name", "location", "place_name", "venue");
  const locationLabel = locationRaw && normalizePlaceTitle(locationRaw) !== normalizePlaceTitle(title) ? locationRaw : null;
  const mapQuery = cleanFrom(item, "map_query", "mapQuery");
  const coords = itemCoordinates(item);
  const locationKnown = coords != null || mapQuery != null || locationLabel != null;

  const selfCoords = coords;
  const nearby: PlaceDetailNearby[] = [];
  const selfId = inputPlaceId(item, day);
  for (const sibling of siblings) {
    if (sibling.item === item) continue;
    const siblingTitle = cleanFrom(sibling.item, "title", "name");
    if (!siblingTitle || !isUsablePlaceTitle(siblingTitle)) continue;
    if (sibling.id === selfId) continue;
    if (isTransferLikeItem(sibling.item)) continue;
    const walk = estimateWalk(selfCoords, itemCoordinates(sibling.item));
    // Round 3 (Lane F): a booking-linked sibling's card title derives
    // from its booking's CURRENT truth (placeTitleForTruth), exactly
    // like the main place's title/badge — the stored title may carry
    // a stale baked stamp (e.g. "Confirmed: …" for a since-cancelled
    // booking). The bookings needed are already in scope here
    // (confirmedBookings carries every booking row for this trip; the
    // main place resolves its booking the same way). Siblings with no
    // resolvable booking keep their stored title byte-unchanged.
    const siblingBooking = findLinkedBookingForPlace(confirmedBookings, siblingTitle);
    const siblingDisplayTitle = siblingBooking ? placeTitleForTruth(siblingTitle, siblingBooking) : siblingTitle;
    const siblingDescription = stripPlaceTitleEcho(
      siblingDisplayTitle,
      cleanFrom(sibling.item, "description", "summary", "details", "notes")
    );
    const siblingUnverified = /^[A-Z0-9]{2,4}$/.test(siblingDisplayTitle) && siblingDescription == null;
    nearby.push({
      id: sibling.id,
      title: siblingDisplayTitle,
      unverified: siblingUnverified,
      planTitle: siblingUnverified ? siblingDisplayTitle : null,
      photo: input.siblingPhotos?.[sibling.id] ?? null,
      walkLabel: walk?.walkLabel ?? null,
      distanceKm: walk?.distanceKm ?? null
    });
    if (nearby.length >= 2) break;
  }

  const tips = Array.from(
    new Set(tripTips.map((tip) => (typeof tip === "string" ? tip.trim() : "")).filter(Boolean))
  );

  return {
    placeId: inputPlaceId(item, day),
    dayNumber: day.day_number,
    dayLabel: formatDayLabel(day.date ?? null, day.day_number),
    title,
    unverified,
    planTitle: unverified ? title : null,
    description,
    badge:
      linkedTruth === "cancelled"
        ? "Cancelled"
        : linkedTruth === "refunded"
          ? "Refunded"
          : confirmed
            ? placeBookingProvenanceLabel(confirmedBooking)
            : linkedTruth === "traveler_confirmed"
              ? "Confirmed by you"
              : "Planned",
    evidence: {
      planned: true,
      timeKnown: window != null,
      locationKnown,
      confirmed,
      travelerConfirmed: linkedTruth === "traveler_confirmed"
    },
    timeRangeLabel: window?.rangeLabel ?? null,
    timeProvenance:
      (cleanFrom(item, "timing_status") || "").toUpperCase() === "FACTUAL"
        ? "confirmed"
        : cleanFrom(item, "retimed_by_event")
          ? "estimated"
          : "planned",
    durationLabel,
    locationLabel,
    directionsUrl: buildDirectionsUrl(item, trip.destination),
    photo: photo && photo.imageUrl
      ? { imageUrl: photo.imageUrl, credit: photo.credit ?? null, pageUrl: photo.pageUrl ?? null, countLabel: "1/1", source: photo.source ?? "wikimedia-commons" }
      : null,
    about: {
      address,
      openingHours: null,
      ticketInfo: null,
      tipsAvailable: tips.length > 0
    },
    nearby,
    tips,
    tipsProvenance: tips.length > 0 ? "From this trip's plan" : null,
    tripHeader: {
      destination: trip.destination || "Your trip",
      origin: trip.origin,
      dateRangeLabel: formatTripDateRange(trip.start_date, trip.end_date)
    }
  };
}

function inputPlaceId(item: RawRecord, day: PlaceDayInput): string {
  const stored = cleanFrom(item, "item_id");
  if (stored) return stored;
  const index = day.live_timeline.indexOf(item as never);
  return fallbackPlaceId(day.day_number, index >= 0 ? index : 0);
}

/**
 * Resolve one place from a trip's OWN itinerary: by stored item_id,
 * or by the deterministic fallback id (d<day>-<live_timeline index>).
 * Returns null for an unknown id or an unusable title — the page
 * renders a not-found state, never another trip's place and never a
 * guessed one. A travel leg resolves with its own real data (its
 * title/time/description); it is never relabeled as a place, and
 * nearby lists always exclude travel legs.
 */
export function resolvePlaceInItinerary(
  itinerary: { daily_itinerary: readonly PlaceDayInput[] } | null,
  placeId: string
): { day: PlaceDayInput; item: RawRecord; index: number } | null {
  if (!itinerary || !placeId) return null;
  for (const day of itinerary.daily_itinerary || []) {
    const timeline = day.live_timeline || [];
    for (let index = 0; index < timeline.length; index += 1) {
      const item = timeline[index];
      const stored = cleanFrom(item, "item_id");
      if (stored === placeId || fallbackPlaceId(day.day_number, index) === placeId) {
        const title = cleanFrom(item, "title", "name");
        if (!title || !isUsablePlaceTitle(title)) return null;
        return { day, item, index };
      }
    }
  }
  return null;
}
