/**
 * notificationBookingAttribution — X1 residual, Round 3 Lane N.
 *
 * Read-time attribution of already-persisted Alerts notification rows
 * to bookings whose CURRENT truth (lib/roamly/bookingTruth) is
 * inactive, for the app/notifications Travel-updates feed. Pure and
 * I/O-free: the page passes the rows it already fetched; nothing here
 * writes or mutates stored rows (audit history is preserved).
 *
 * Round 1 covered, and this module preserves exactly:
 *  - "withdrawn": metadata.withdrawn === true (X1 write paths);
 *  - "event_link": event_id -> companion event -> booking_id naming a
 *    booking in an inactive truth state (cancelled / refunded /
 *    superseded / test);
 *  - "exact_title": a booking-typed row (type contains "booking")
 *    whose title matches an inactive booking's title under the page's
 *    original normalization (trim, whitespace-collapse, lowercase —
 *    punctuation kept).
 *
 * Round 3 adds two CONSERVATIVE tiers for pre-fix rows with no event
 * link and no exact title match. Precision over recall — a false
 * suppression of a live booking's notification is worse than a
 * leftover, so the new tiers act ONLY when ALL of these hold:
 *  - the candidate booking's CURRENT truth is cancelled or refunded
 *    (never superseded/test — those stay on the round-1 tiers only);
 *  - the row is booking-related (type contains "booking", or the
 *    check_in_reminder type whose rows are minted with the booking's
 *    own title / provider / start — tripCompanion booking events);
 *  - the booking is on the notification's trip (when both rows carry
 *    a trip_id they must be equal; the Alerts query is already
 *    trip-scoped, so a missing trip_id on a booking row inherits the
 *    page's scope);
 *  - MULTIPLE signals agree (see tiers below); a single signal never
 *    suppresses;
 *  - NO active booking explains the row at least as well (ambiguity
 *    veto below).
 *
 * Tier "fuzzy_title": the aggressively normalized titles match —
 * stamp prefixes ("Confirmed:" / "Confirmed by you:" / "Cancelled:"
 * …) stripped, case folded, punctuation folded to spaces — by
 * equality, by containment (shorter side >= 10 chars, >= 2 tokens,
 * and >= 55% of the longer side), or by token-set similarity
 * (Jaccard >= 0.80, both sides >= 2 tokens) — AND at least one
 * corroborating signal: the booking's real provider name appears in
 * the row's title/body, or the row's scheduled_for falls inside the
 * booking's stay window.
 *
 * Tier "provider_window": no title match at all, but BOTH
 * corroborating signals agree — the booking's real provider name
 * appears in the row's title/body AND scheduled_for falls inside
 * the booking's stay window.
 *
 * Ambiguity veto (both new tiers): if any ACTIVE booking on the same
 * trip aggressively-exact-matches the row's title, or matches the
 * same tier's signal combination, the row is left rendering — it
 * cannot be reliably attributed to the cancelled booking. When every
 * matching candidate is cancelled/refunded the row is suppressed
 * whichever of them minted it, because the rendering harm (a
 * cancelled booking posing as live travel) is identical.
 *
 * Suppression, not relabelling, is the chosen handling (as in round
 * 1): the Travel-updates surface (AlertsSectionRow) has no per-row
 * status badge, and a "Cancelled:" prefix on a row whose own title
 * may not even name the booking (provider_window tier) would present
 * an attribution guess as a booking fact. A suppressed row stays in
 * the table, in history, and in the badge's non-rendered set exactly
 * as round-1 suppressed rows do.
 */

import {
  bookingTruthState,
  isInactiveTruthState,
  isRealProviderIdentity,
  providerIdentity,
  stripBookingStampPrefix,
  type BookingLike
} from "@/lib/roamly/bookingTruth";

export type AttributionNotification = {
  id?: unknown;
  trip_id?: unknown;
  event_id?: unknown;
  type?: unknown;
  title?: unknown;
  body?: unknown;
  scheduled_for?: unknown;
  metadata?: unknown;
  [key: string]: unknown;
};

export type AttributionBooking = BookingLike & {
  id?: unknown;
  trip_id?: unknown;
  booking_type?: unknown;
  start_at?: unknown;
  start_date?: unknown;
  end_at?: unknown;
  end_date?: unknown;
};

export type AttributionTier =
  | "withdrawn"
  | "event_link"
  | "exact_title"
  | "fuzzy_title"
  | "provider_window";

export type AttributionResult = {
  bookingId: string | null;
  tier: AttributionTier;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The page's original (round-1) normalization: trim, collapse
 *  whitespace, lowercase. Punctuation is KEPT. */
export function normalizeExactTitle(value: unknown): string {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Aggressive normalization for fuzzy attribution ONLY: booking stamp
 *  prefixes stripped (repeatedly), case folded, every run of
 *  non-alphanumerics folded to one space. */
export function normalizeAttributionTitle(value: unknown): string {
  let text = clean(value);
  for (let i = 0; i < 3; i += 1) {
    const stripped = stripBookingStampPrefix(text);
    if (stripped === text) break;
    text = stripped;
  }
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokensOf(normalized: string): string[] {
  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

export type TitleMatchKind = "exact" | "containment" | "tokens" | null;

/** Fuzzy title agreement between two ALREADY aggressively-normalized
 *  titles. Deliberately strict: short or single-token titles can only
 *  ever match exactly. */
export function attributionTitleMatch(notificationTitle: string, bookingTitle: string): TitleMatchKind {
  if (!notificationTitle || !bookingTitle) return null;
  if (notificationTitle === bookingTitle) return "exact";
  const shorter = notificationTitle.length <= bookingTitle.length ? notificationTitle : bookingTitle;
  const longer = notificationTitle.length <= bookingTitle.length ? bookingTitle : notificationTitle;
  if (
    shorter.length >= 10 &&
    tokensOf(shorter).length >= 2 &&
    longer.includes(shorter) &&
    shorter.length / longer.length >= 0.55
  ) {
    return "containment";
  }
  const a = new Set(tokensOf(notificationTitle));
  const b = new Set(tokensOf(bookingTitle));
  if (a.size >= 2 && b.size >= 2) {
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    const union = a.size + b.size - intersection;
    if (union > 0 && intersection / union >= 0.8) return "tokens";
  }
  return null;
}

/** Provider signal: the booking's REAL provider identity (never a
 *  pseudo-provider like "manual") appears in the notification's
 *  title or body, compared under aggressive normalization so
 *  "Booking.com" in a body matches provider "Booking.com". */
export function notificationProviderSignal(
  notification: AttributionNotification,
  booking: AttributionBooking
): boolean {
  const provider = providerIdentity(booking);
  if (!isRealProviderIdentity(provider)) return false;
  const providerNorm = normalizeAttributionTitle(provider);
  if (providerNorm.length < 3) return false;
  const haystack = normalizeAttributionTitle(`${clean(notification.title)} ${clean(notification.body)}`);
  return haystack.includes(providerNorm);
}

function parseInstant(value: unknown): number | null {
  const text = clean(value);
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function parseDateOnlyStart(value: unknown): number | null {
  const text = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = new Date(`${text}T00:00:00.000Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function parseDateOnlyEnd(value: unknown): number | null {
  const start = parseDateOnlyStart(value);
  return start == null ? null : start + 24 * 60 * 60 * 1000 - 1;
}

/** Window signal: the notification's scheduled_for falls inside the
 *  booking's stay window [start, end] (start_at/start_date through
 *  end_at/end_date, falling back to the start day). Date-only bounds
 *  are read as UTC days so the result is timezone-independent.
 *  scheduled_for is the booking reminder's own scheduled instant
 *  (tripCompanion mints it from the booking start); a row with no
 *  usable scheduled_for carries no window signal. */
export function notificationWindowSignal(
  notification: AttributionNotification,
  booking: AttributionBooking
): boolean {
  const scheduled = parseInstant(notification.scheduled_for);
  if (scheduled == null) return false;
  const start = parseInstant(booking.start_at) ?? parseDateOnlyStart(booking.start_date);
  if (start == null) return false;
  const end =
    parseInstant(booking.end_at) ?? parseDateOnlyEnd(booking.end_date) ?? parseDateOnlyEnd(booking.start_date) ?? start;
  return scheduled >= start && scheduled <= end;
}

/** Booking-related row types for the NEW tiers: any type containing
 *  "booking" (booking_confirmed / booking_changed / booking_detected /
 *  booking_reminder …) plus check_in_reminder, whose rows are minted
 *  from a booking's own title/provider/start. */
export function isBookingRelatedNotificationType(type: unknown): boolean {
  const text = clean(type).toLowerCase();
  return text.includes("booking") || text === "check_in_reminder";
}

function sameTrip(notification: AttributionNotification, booking: AttributionBooking): boolean {
  const notificationTrip = clean(notification.trip_id);
  const bookingTrip = clean(booking.trip_id);
  return !notificationTrip || !bookingTrip || notificationTrip === bookingTrip;
}

type CandidateSignals = {
  booking: AttributionBooking;
  bookingId: string;
  titleMatch: TitleMatchKind;
  provider: boolean;
  window: boolean;
};

/**
 * The Alerts read path: which persisted notification rows are
 * suppressed because they belong to a booking whose CURRENT truth is
 * inactive. Returns a map notification id -> attribution (tier +
 * booking). Rows not in the map render exactly as before.
 */
export function suppressedCancelledNotifications(params: {
  notifications: readonly AttributionNotification[];
  bookings: readonly AttributionBooking[];
  /** event_id -> booking_id, from roamly_trip_companion_events. */
  eventBookingById?: ReadonlyMap<string, string> | Record<string, string>;
}): Map<string, AttributionResult> {
  const suppressed = new Map<string, AttributionResult>();
  const eventBookingById: ReadonlyMap<string, string> =
    params.eventBookingById instanceof Map
      ? params.eventBookingById
      : new Map(Object.entries(params.eventBookingById || {}));

  const bookings = params.bookings.filter((booking) => booking && typeof booking === "object");
  const truthOf = new Map<AttributionBooking, ReturnType<typeof bookingTruthState>>();
  for (const booking of bookings) truthOf.set(booking, bookingTruthState(booking));
  const isInactive = (booking: AttributionBooking) => isInactiveTruthState(truthOf.get(booking)!);
  const isCancelledOrRefunded = (booking: AttributionBooking) => {
    const state = truthOf.get(booking);
    return state === "cancelled" || state === "refunded";
  };
  const bookingById = new Map<string, AttributionBooking>();
  for (const booking of bookings) {
    const id = clean(booking.id);
    if (id && !bookingById.has(id)) bookingById.set(id, booking);
  }
  // Round-1 exact-title set (inactive bookings, page normalization).
  const exactInactiveTitles = new Set(
    bookings.filter(isInactive).map((booking) => normalizeExactTitle(booking.title)).filter(Boolean)
  );

  for (const notification of params.notifications) {
    const id = clean(notification.id);
    if (!id || suppressed.has(id)) continue;

    // Tier: withdrawn (round 1, write-side mark).
    const metadata =
      notification.metadata && typeof notification.metadata === "object" && !Array.isArray(notification.metadata)
        ? (notification.metadata as Record<string, unknown>)
        : null;
    if (metadata?.withdrawn === true) {
      const markedId = clean(metadata.booking_id);
      suppressed.set(id, { bookingId: markedId || null, tier: "withdrawn" });
      continue;
    }

    // Tier: event link (round 1).
    const eventId = clean(notification.event_id);
    if (eventId) {
      const linkedId = eventBookingById.get(eventId);
      const linked = linkedId ? bookingById.get(linkedId) : undefined;
      if (linkedId && linked && isInactive(linked)) {
        suppressed.set(id, { bookingId: linkedId, tier: "event_link" });
        continue;
      }
    }

    if (!isBookingRelatedNotificationType(notification.type)) continue;

    // Tier: exact title (round 1 — booking-typed rows only, exactly
    // the page's original rule).
    if (
      clean(notification.type).toLowerCase().includes("booking") &&
      exactInactiveTitles.has(normalizeExactTitle(notification.title))
    ) {
      const match = bookings.find(
        (booking) => isInactive(booking) && normalizeExactTitle(booking.title) === normalizeExactTitle(notification.title)
      );
      suppressed.set(id, { bookingId: match ? clean(match.id) || null : null, tier: "exact_title" });
      continue;
    }

    // ---- Round-3 tiers: cancelled/refunded candidates only. ----
    const notificationTitle = normalizeAttributionTitle(notification.title);
    const signalsFor = (booking: AttributionBooking): CandidateSignals => ({
      booking,
      bookingId: clean(booking.id),
      titleMatch: attributionTitleMatch(notificationTitle, normalizeAttributionTitle(booking.title)),
      provider: notificationProviderSignal(notification, booking),
      window: notificationWindowSignal(notification, booking)
    });
    const tripBookings = bookings.filter((booking) => sameTrip(notification, booking));
    const cancelledSignals = tripBookings.filter(isCancelledOrRefunded).map(signalsFor);
    const activeSignals = tripBookings.filter((booking) => !isInactive(booking)).map(signalsFor);

    // Ambiguity veto: an active booking that aggressively-exact
    // matches the row's title can own this row — never suppress on
    // the fuzzy tiers.
    if (activeSignals.some((signal) => signal.titleMatch === "exact")) continue;

    // Tier: fuzzy title + corroboration.
    const fuzzyHit = cancelledSignals.find((signal) => signal.titleMatch !== null && (signal.provider || signal.window));
    if (fuzzyHit) {
      const activeFuzzy = activeSignals.some(
        (signal) => signal.titleMatch !== null && (signal.provider || signal.window)
      );
      if (!activeFuzzy) {
        suppressed.set(id, { bookingId: fuzzyHit.bookingId || null, tier: "fuzzy_title" });
        continue;
      }
    }

    // Tier: provider + window, no title match.
    const providerWindowHit = cancelledSignals.find(
      (signal) => signal.titleMatch === null && signal.provider && signal.window
    );
    if (providerWindowHit) {
      const activeProviderWindow = activeSignals.some((signal) => signal.provider && signal.window);
      if (!activeProviderWindow) {
        suppressed.set(id, { bookingId: providerWindowHit.bookingId || null, tier: "provider_window" });
      }
    }
  }
  return suppressed;
}
