/**
 * fyiDigestCore.ts — pure, dependency-free building blocks for the Roamly
 * customer FYI digest.
 *
 * The FYI digest is the customer-facing voice Junel specified:
 *   1. check-in tomorrow alert (T-24h from Gmail-sensed flight segments)
 *   2. flight changed / disruption alerts (latest segment snapshot vs last sent snapshot)
 *   3. itinerary ready (post-purchase / trip created with trackingUnlocked)
 *   4. trip starting soon reminder
 *
 * Booking-honesty contract (Junel, HARD): never invent flight statuses or
 * times. Every FYI only states what the segment/booking data actually says.
 *
 * The review-ask moment ("review_ask") is registered here so the FYI and
 * review-ask moments stay distinct in code. The digest processor must never
 * send it; the review pipeline owns it.
 *
 * Everything in this file is pure and deterministic so it can be unit tested
 * without Supabase or Next.js. Node's --experimental-strip-types can import it
 * directly.
 */

export const FYI_MOMENTS = [
  "check_in_t24",
  "flight_change",
  "itinerary_ready",
  "trip_starting_soon",
  "upsell_gap",
  "review_ask"
] as const;

export type FyiMoment = (typeof FYI_MOMENTS)[number];

/** Moments the FYI digest cron is allowed to send. review_ask is owned elsewhere. */
export const DIGEST_SENDABLE_MOMENTS: readonly FyiMoment[] = [
  "check_in_t24",
  "flight_change",
  "itinerary_ready",
  "trip_starting_soon",
  "upsell_gap"
];

/** Guardrail: max 1 FYI email per trip per day. */
export const FYI_MAX_EMAILS_PER_TRIP_PER_DAY = 1;

/** Guardrail: max 1 upsell email per gap per trip per 30 days. */
export const UPSELL_GAP_EMAIL_COOLDOWN_DAYS = 30;

/** Guardrail: max 1 upsell email per trip per 7 days, across all gaps. */
export const UPSELL_TRIP_EMAIL_COOLDOWN_DAYS = 7;

/** How far back the digest looks for a booking update it has not FYI-reported yet. */
export const FLIGHT_CHANGE_LOOKBACK_MINUTES = 65;

export function isDigestSendableMoment(moment: string): moment is (typeof DIGEST_SENDABLE_MOMENTS)[number] {
  return (DIGEST_SENDABLE_MOMENTS as readonly string[]).includes(moment);
}

/** Stable dedupe key for one moment on one trip/scope. */
export function fyiDedupeKey(moment: FyiMoment, tripId: string, scopeId: string) {
  const clean = (value: string) => value.trim().slice(0, 120);
  return `fyi:${moment}:${clean(tripId)}:${clean(scopeId)}`;
}

/** Per-trip-per-day email cap key (UTC date). */
export function fyiDailyEmailCapKey(tripId: string, now: Date = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `fyi-email-daily:${tripId.trim()}:${day}`;
}

/** Per-trip upsell email cooldown key. */
export function upsellTripCooldownKey(tripId: string, now: Date = new Date()) {
  const week = now.toISOString().slice(0, 10);
  return `upsell-email-trip:${tripId.trim()}:${week}`;
}

export type FlightSegmentLike = {
  bookingId: string;
  tripId: string;
  userId: string;
  flightNumber: string | null;
  provider: string | null;
  origin: string | null;
  destination: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  terminal: string | null;
  gate: string | null;
  status: string | null;
};

/**
 * T-24h check-in window: departure is between 22h and 26h from now.
 * Wide enough for an hourly cron to catch it exactly once (dedupe keyed per segment).
 */
export function isCheckInT24Window(departureIso: string | null, now: Date = new Date()) {
  if (!departureIso) return false;
  const departure = Date.parse(departureIso);
  if (!Number.isFinite(departure)) return false;
  const hoursOut = (departure - now.getTime()) / 3_600_000;
  return hoursOut >= 22 && hoursOut <= 26;
}

export type FlightSnapshot = {
  bookingStatus: string | null;
  startAt: string | null;
  endAt: string | null;
  gate: string | null;
  terminal: string | null;
};

export type FlightChangeKind = "cancelled" | "delayed" | "rescheduled" | "gate_terminal";

function minuteDelta(first: string | null, second: string | null): number | null {
  if (!first || !second) return null;
  const a = Date.parse(first);
  const b = Date.parse(second);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 60_000);
}

/**
 * Compare the latest booking snapshot against the last snapshot we FYI-reported.
 * Returns the most severe change, or null when nothing material changed.
 * Only compares fields the booking data actually states.
 */
export function flightChangeKind(previous: FlightSnapshot | null, current: FlightSnapshot): FlightChangeKind | null {
  if (!previous) return null; // nothing to compare against — never invent a change
  const wasCancelled = String(previous.bookingStatus || "").toLowerCase() === "cancelled";
  const isCancelled = String(current.bookingStatus || "").toLowerCase() === "cancelled";
  if (!wasCancelled && isCancelled) return "cancelled";
  const departureDelta = minuteDelta(previous.startAt, current.startAt);
  if (departureDelta !== null && departureDelta >= 15) return "delayed";
  const timeChanged =
    (departureDelta !== null && Math.abs(departureDelta) >= 5) ||
    (minuteDelta(previous.endAt, current.endAt) !== null && Math.abs(minuteDelta(previous.endAt, current.endAt) as number) >= 5);
  if (timeChanged) return "rescheduled";
  // Gate/terminal changes only count when we actually gained NEW information —
  // a cleared value is not news, and identical values are not a change.
  const gateGained = (previous.gate || "") !== (current.gate || "") && Boolean(current.gate);
  const terminalGained = (previous.terminal || "") !== (current.terminal || "") && Boolean(current.terminal);
  if (gateGained || terminalGained) return "gate_terminal";
  return null;
}

function formatFlightTime(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

function flightLabel(segment: FlightSegmentLike) {
  const flight = [segment.provider, segment.flightNumber].filter(Boolean).join(" ");
  return flight || "your flight";
}

export type FyiCopy = {
  subject: string;
  title: string;
  body: string;
  actionUrl: string;
  actionLabel: string;
};

export function buildCheckInCopy(segment: FlightSegmentLike, tripId: string): FyiCopy {
  const label = flightLabel(segment);
  const route = [segment.origin, segment.destination].filter(Boolean).join(" → ");
  const when = formatFlightTime(segment.departureTime);
  const bodyParts = [
    `Check-in should be open now for ${label}${route ? ` (${route})` : ""}${when ? `, departing ${when}` : ""}.`,
    "Have your booking reference ready — most airlines open check-in 24 hours before departure."
  ];
  return {
    subject: `Check-in is open: ${label}`,
    title: `Check-in is open for ${label}`,
    body: bodyParts.join(" "),
    actionUrl: `/trip/${tripId}/bookings`,
    actionLabel: "View booking"
  };
}

export function buildFlightChangeCopy(
  segment: FlightSegmentLike,
  tripId: string,
  kind: FlightChangeKind,
  current: FlightSnapshot
): FyiCopy {
  const label = flightLabel(segment);
  const actionUrl = `/trip/${tripId}/bookings`;
  if (kind === "cancelled") {
    return {
      subject: `${label} was cancelled`,
      title: `${label} was cancelled`,
      body: `Roamly detected that ${label} is now marked cancelled in your booking data. Check with the airline for rebooking options, then update the booking in Roamly so your itinerary stays accurate.`,
      actionUrl,
      actionLabel: "Update booking"
    };
  }
  if (kind === "delayed") {
    return {
      subject: `${label} is delayed`,
      title: `${label} is delayed`,
      body: `Roamly detected a delay on ${label} in your booking data. Give yourself extra buffer at the airport and check the airline's latest update.`,
      actionUrl,
      actionLabel: "View booking"
    };
  }
  if (kind === "rescheduled") {
    const when = formatFlightTime(current.startAt);
    return {
      subject: `${label} schedule changed`,
      title: `${label} has a new schedule`,
      body: `Roamly detected a schedule change on ${label}${when ? ` — new departure ${when}` : ""}. Your itinerary has been checked against the new time.`,
      actionUrl,
      actionLabel: "View booking"
    };
  }
  const place = [current.terminal ? `Terminal ${current.terminal}` : "", current.gate ? `Gate ${current.gate}` : ""]
    .filter(Boolean)
    .join(", ");
  return {
    subject: `${label} gate update`,
    title: `${label} gate or terminal update`,
    body: `Roamly detected a gate or terminal update on ${label}${place ? ` — now ${place}` : ""}. Confirm on the airport screens before you head out.`,
    actionUrl,
    actionLabel: "View booking"
  };
}

export function buildItineraryReadyCopy(destination: string, tripId: string): FyiCopy {
  const place = destination.trim() || "your trip";
  return {
    subject: `Your ${place} itinerary is ready`,
    title: `Your ${place} itinerary is ready`,
    body: `Your AI itinerary for ${place} is ready to explore, and Live Trip Companion tracking is unlocked. Open your trip to review the plan day by day.`,
    actionUrl: `/trip/${tripId}`,
    actionLabel: "View itinerary"
  };
}

export function buildTripStartingCopy(destination: string, startDate: string | null, tripId: string): FyiCopy {
  const place = destination.trim() || "your trip";
  const when = startDate ? formatFlightTime(`${startDate}T00:00:00`) : "";
  return {
    subject: `${place} starts in 3 days`,
    title: `${place} starts in 3 days`,
    body: `Your trip to ${place} starts ${when ? `on ${when}` : "soon"}. Double-check travel documents, confirm check-in for your first flight, and pack for the season. Roamly's Live Companion will be with you from day one.`,
    actionUrl: `/trip/${tripId}/companion`,
    actionLabel: "Open companion"
  };
}

export function buildUpsellCopy(params: {
  gapTitle: string;
  gapDescription: string;
  destination: string;
  tripId: string;
  ctaUrl: string;
  ctaLabel: string;
  disclosure: string;
}): FyiCopy {
  const place = params.destination.trim() || "your trip";
  return {
    subject: `One thing missing for ${place}: ${params.gapTitle}`,
    title: `One thing missing for ${place}`,
    body: `${params.gapDescription} ${params.disclosure}`.trim(),
    actionUrl: `/trip/${params.tripId}`,
    actionLabel: params.ctaLabel
  };
}

/** One-click unsubscribe URL for a preferences token (path form). */
export function unsubscribeUrl(token: string) {
  return `/api/roamly/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
