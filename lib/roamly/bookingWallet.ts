import type { SupabaseClient } from "@supabase/supabase-js";
import { recordTripEvent } from "@/lib/roamly/events";
import { sanitizeBookingCorrectionFields } from "@/lib/roamly/bookingCorrections";
import { applyStoredItineraryBookingOverride } from "@/lib/roamly/itineraryBookingOverrides";
import { processCompanionBookingChange } from "@/lib/roamly/companionOrchestrator";
import { isOperationalCurrentBooking } from "@/lib/roamly/bookingSupersession";
import { bookingTimestamp, bookingDate } from "@/lib/roamly/bookingDateTime";
export { isOperationalCurrentBooking } from "@/lib/roamly/bookingSupersession";

export const TRIP_BOOKING_TYPES = [
  "flight",
  "hotel",
  "train",
  "bus",
  "ferry",
  "rental_car",
  "transfer",
  "activity",
  "restaurant",
  "insurance",
  "other"
] as const;

export const TRIP_BOOKING_STATUSES = [
  "recommended",
  "clicked",
  "detected",
  "needs_confirmation",
  "confirmed",
  "modified",
  "cancelled",
  "refunded",
  "completed"
] as const;

export const TRIP_BOOKING_SOURCE_TYPES = [
  "brain_recommendation",
  "affiliate_click",
  "affiliate_conversion",
  "manual",
  "upload",
  "screenshot",
  "email",
  "gmail",
  "affiliate",
  "provider",
  "provider_sync",
  "live_provider",
  "admin",
  "import"
] as const;

export type TripBookingType = (typeof TRIP_BOOKING_TYPES)[number];
export type TripBookingStatus = (typeof TRIP_BOOKING_STATUSES)[number];
export type TripBookingSourceType = (typeof TRIP_BOOKING_SOURCE_TYPES)[number];

export type BookingSegmentInput = {
  sequence?: number | null;
  origin?: string | null;
  destination?: string | null;
  departureTime?: string | null;
  arrivalTime?: string | null;
  provider?: string | null;
  serviceNumber?: string | null;
  terminal?: string | null;
  gate?: string | null;
  seat?: string | null;
  status?: string | null;
};

export type TripBookingInput = {
  bookingType?: string | null;
  bookingStatus?: string | null;
  provider?: string | null;
  providerBookingId?: string | null;
  confirmationCode?: string | null;
  recommendationId?: string | null;
  referralId?: string | null;
  affiliateClickId?: string | null;
  affiliateConversionId?: string | null;
  sourceType?: string | null;
  sourceReference?: string | null;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  departureTimezone?: string | null;
  arrivalTimezone?: string | null;
  origin?: string | null;
  destination?: string | null;
  locationName?: string | null;
  address?: string | null;
  coordinates?: Record<string, unknown> | null;
  flightNumber?: string | null;
  airlineCode?: string | null;
  terminal?: string | null;
  gate?: string | null;
  roomType?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  reservationRequirements?: Record<string, unknown> | null;
  totalPrice?: number | null;
  currency?: string | null;
  taxesAndFees?: number | null;
  cancellationDeadline?: string | null;
  cancellationTerms?: string | null;
  travelerConfirmed?: boolean | null;
  lastSyncedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  segments?: BookingSegmentInput[] | null;
  reconciliation?: {
    connectionId: string;
    sourceMessageId: string;
    sourceEventAt: string;
    decision?: "applied" | "needs_review" | "ignored";
  } | null;
};

export type TripBookingRecord = {
  id: string;
  trip_id: string;
  user_id: string;
  booking_type: TripBookingType;
  booking_status: TripBookingStatus;
  provider: string | null;
  provider_booking_id: string | null;
  confirmation_code: string | null;
  recommendation_id: string | null;
  affiliate_click_id: string | null;
  referral_id: string | null;
  affiliate_conversion_id: string | null;
  source_type: TripBookingSourceType;
  source_reference: string | null;
  title: string;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  origin: string | null;
  destination: string | null;
  location_name: string | null;
  address: string | null;
  coordinates: Record<string, unknown> | null;
  flight_number: string | null;
  airline_code: string | null;
  terminal: string | null;
  gate: string | null;
  room_type: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  reservation_requirements: Record<string, unknown>;
  total_price: number | null;
  currency: string | null;
  taxes_and_fees: number | null;
  cancellation_deadline: string | null;
  cancellation_terms: string | null;
  traveler_confirmed: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  superseded_by_booking_id: string | null;
  /**
   * Traveler review state, derived from the row's metadata (never a status
   * change): "traveler_asserted" means the traveler confirmed these details
   * are theirs — it is NOT provider confirmation. "dismissed" means the
   * traveler dismissed the item with an optional reason. Null = still
   * awaiting traveler review. Set only by the bookings review route.
   */
  review_state: "traveler_asserted" | "dismissed" | null;
  /** Traveler corrections recorded as a pending assertion (see B10). */
  pending_corrections: Record<string, unknown> | null;
  booking_segments?: BookingSegmentRecord[];
};

export type BookingSegmentRecord = {
  id: string;
  booking_id: string;
  sequence: number;
  origin: string | null;
  destination: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  provider: string | null;
  service_number: string | null;
  terminal: string | null;
  gate: string | null;
  seat: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

const typeSet = new Set<string>(TRIP_BOOKING_TYPES);
const statusSet = new Set<string>(TRIP_BOOKING_STATUSES);
const sourceTypeSet = new Set<string>(TRIP_BOOKING_SOURCE_TYPES);

const confirmedStatuses = new Set<TripBookingStatus>(["confirmed", "modified", "completed"]);
const inactiveStatuses = new Set<TripBookingStatus>(["cancelled", "refunded"]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown) {
  const text = clean(value);
  return text || null;
}

const RAW_EVIDENCE_KEYS = new Set([
  "rawextractedtext",
  "rawtext",
  "ocrtext",
  "extractedtext",
  "rawevidence"
]);

function sanitizeBookingEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeBookingEvidence);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (RAW_EVIDENCE_KEYS.has(key.replace(/[_-]/g, "").toLowerCase())) continue;
    output[key] = sanitizeBookingEvidence(child);
  }
  return output;
}

function nullableTimestamp(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  // An offset-bearing instant converts to UTC exactly as before.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  // An offset-free wall clock must be preserved verbatim, NEVER run through
  // `new Date` in the server's local timezone: under America/Moncton that
  // shifted a 20:30 flight to the next day (2026-11-11T00:30Z). Validate the
  // calendar date TZ-independently via UTC components, then keep the
  // traveler's typed wall clock (seconds added when omitted).
  const wall = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(text);
  if (!wall) return null;
  const [, y, mo, d, h, mi, s] = wall;
  const check = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? "0")));
  if (
    check.getUTCFullYear() !== +y || check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d ||
    check.getUTCHours() !== +h || check.getUTCMinutes() !== +mi || check.getUTCSeconds() !== +(s ?? "0")
  ) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}`;
}

// Zone-aware instant conversion for NEW booking writes (B04 fix).
// Offset-bearing strings parse directly. Offset-free wall clocks convert
// ONLY with an explicit IANA zone; without one no instant is fabricated
// (the date-only fields preserve the calendar date instead). This replaces
// the old server-timezone parse for write paths: on Vercel, `new Date` of
// an offset-free string silently meant UTC. Legacy/read paths keep using
// nullableTimestamp so already-stored rows keep reading as before.
// NOTE: the trip's own metadata timezone is deliberately NOT used as a
// fallback here — it defaults to "UTC" when absent, which would just
// reintroduce the silent-UTC fabrication for most trips.
function convertBookingTimestamp(value: unknown, timeZone?: string | null) {
  const text = clean(value);
  if (!text) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return bookingTimestamp(text, timeZone);
}

// INTEGRATION RECONCILE (#86 vs #88 — the timestamp conversion both PRs
// own, arbitrated by test:manual-booking-save AND test:b02b06-booking-fixes).
// #88's rule: a zone-less wall clock yields no instant (the date survives
// in the date field instead). #86's rule: a typed wall clock must survive
// reload (the live bug was a 20:30 flight shifting to the next day).
// Both hold when the rule keys on whether the calendar date survives
// elsewhere: offset-bearing and zoned clocks always convert via #88;
// offset-free + zoneless clocks yield null ONLY when the corresponding
// date field already carries the date — otherwise the date would be lost
// entirely (start_at null AND start_date null), so the wall clock is
// preserved verbatim via #86's nullableTimestamp (TZ-independent, seconds
// added when omitted). Every #88 zone-less/DST case sends its date field;
// every #86 case sends none — so both suites pass on this rule.
function convertBookingTimestampPreservingDate(
  value: unknown,
  timeZone?: string | null,
  dateSurvives?: boolean
) {
  const text = clean(value);
  if (!text) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) || timeZone) {
    return convertBookingTimestamp(value, timeZone);
  }
  if (dateSurvives) return null;
  return nullableTimestamp(value);
}

function nullableMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value * 100) / 100;
  }
  return null;
}

function normalizedCurrency(value: unknown) {
  const text = clean(value).toUpperCase();
  return /^[A-Z]{3}$/.test(text) ? text : null;
}

function normalizedBookingType(value: unknown): TripBookingType {
  const text = clean(value);
  return typeSet.has(text) ? (text as TripBookingType) : "other";
}

function normalizedBookingStatus(value: unknown, travelerConfirmed: boolean): TripBookingStatus {
  const text = clean(value);
  if (statusSet.has(text)) return text as TripBookingStatus;
  return travelerConfirmed ? "confirmed" : "needs_confirmation";
}

function normalizedSourceType(value: unknown): TripBookingSourceType {
  const text = clean(value);
  if (text === "upload") return "screenshot";
  return sourceTypeSet.has(text) ? (text as TripBookingSourceType) : "manual";
}

function normalizedSegmentStatus(value: unknown) {
  const text = clean(value);
  return ["scheduled", "confirmed", "delayed", "cancelled", "completed", "unknown"].includes(text) ? text : "scheduled";
}

function safeJson(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type BookingReferralMetadata = {
  recommendationId: string | null;
  affiliateClickId: string | null;
  affiliateConversionId: string | null;
  sourceReference: string | null;
  captureState?: "customer_asserted" | "evidence_pending" | null;
};

export function bookingReferralMetadata(value: unknown): BookingReferralMetadata {
  const metadata = safeJson(value);
  return {
    recommendationId: nullableText(metadata.recommendationId),
    affiliateClickId: nullableText(metadata.affiliateClickId),
    affiliateConversionId: nullableText(metadata.affiliateConversionId),
    sourceReference: nullableText(metadata.sourceReference),
    captureState:
      metadata.captureState === "customer_asserted" || metadata.captureState === "evidence_pending"
        ? metadata.captureState
        : null
  };
}

export function withBookingReferralMetadata(
  value: unknown,
  referral: Partial<BookingReferralMetadata> & { captureState?: BookingReferralMetadata["captureState"] }
) {
  const metadata = safeJson(value);
  return {
    ...metadata,
    ...(referral.recommendationId ? { recommendationId: referral.recommendationId } : {}),
    ...(referral.affiliateClickId ? { affiliateClickId: referral.affiliateClickId } : {}),
    ...(referral.affiliateConversionId ? { affiliateConversionId: referral.affiliateConversionId } : {}),
    ...(referral.sourceReference ? { sourceReference: referral.sourceReference } : {}),
    ...(referral.captureState ? { captureState: referral.captureState } : {})
  };
}

export function isConfirmedBooking(booking: Pick<TripBookingRecord, "booking_status" | "traveler_confirmed"> & { superseded_by_booking_id?: string | null }) {
  return isOperationalCurrentBooking(booking) && booking.traveler_confirmed && confirmedStatuses.has(booking.booking_status);
}

export function isActiveTripBooking(booking: Pick<TripBookingRecord, "booking_status"> & { superseded_by_booking_id?: string | null }) {
  // ONE operational-current rule: a superseded row is history, never active,
  // even when its status still reads as a live one. isConfirmedBooking already
  // required this via isOperationalCurrentBooking; the active set now does too.
  return isOperationalCurrentBooking(booking) && !inactiveStatuses.has(booking.booking_status);
}

export function isBookingClickOnly(booking: Pick<TripBookingRecord, "booking_status" | "source_type">) {
  return booking.booking_status === "clicked" || booking.source_type === "affiliate_click";
}

export function bookingWalletTimelineSortKey(booking: Pick<TripBookingRecord, "start_time" | "check_in_time" | "created_at">) {
  return booking.start_time || booking.check_in_time || booking.created_at || "";
}

export function stableBookingKey(input: {
  userId?: string | null;
  provider?: string | null;
  providerBookingId?: string | null;
  confirmationCode?: string | null;
  bookingType?: string | null;
  flightNumber?: string | null;
  startTime?: string | null;
  origin?: string | null;
  destination?: string | null;
  title?: string | null;
}) {
  const provider = clean(input.provider).toLowerCase();
  const providerBookingId = clean(input.providerBookingId).toLowerCase();
  if (provider && providerBookingId) return `provider:${clean(input.userId)}:${provider}:${providerBookingId}`;

  const confirmation = clean(input.confirmationCode).toLowerCase();
  const type = clean(input.bookingType).toLowerCase();
  if (provider && confirmation) return `confirmation:${clean(input.userId)}:${provider}:${type}:${confirmation}`;

  const flightNumber = clean(input.flightNumber).replace(/\s+/g, "").toUpperCase();
  const startDate = clean(input.startTime).slice(0, 10);
  if (flightNumber && startDate) {
    return `flight:${clean(input.userId)}:${flightNumber}:${startDate}:${clean(input.origin).toLowerCase()}:${clean(input.destination).toLowerCase()}`;
  }

  return `loose:${clean(input.userId)}:${type}:${clean(input.title).toLowerCase()}:${clean(input.startTime).slice(0, 10)}`;
}

function canonicalBookingStatus(
  status: TripBookingStatus,
  travelerConfirmed: boolean
) {
  if (status === "cancelled") return "cancelled";
  if (status === "refunded") return "cancelled";
  if (status === "confirmed" || travelerConfirmed) return "booked";
  return "unknown";
}

function canonicalBookingType(type: TripBookingType) {
  if (type === "activity") return "attraction";
  if (type === "rental_car") return "car_rental";
  if (
    type === "train" ||
    type === "bus" ||
    type === "ferry" ||
    type === "transfer"
  ) {
    return "transport";
  }
  return type;
}

export function serializeTripBookingRecord(
  row: Record<string, unknown>
): TripBookingRecord {
  const metadata =
    row.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  const referral = bookingReferralMetadata(metadata);
  return {
    id: String(row.id || ""),
    trip_id: String(row.trip_id || ""),
    user_id: String(row.user_id || ""),
    booking_type: legacyBookingType(row.booking_type),
    booking_status: legacyBookingStatus(row.booking_status),
    provider: nullableText(row.provider_name),
    provider_booking_id: nullableText(row.provider_booking_id),
    confirmation_code: nullableText(row.confirmation_number),
    recommendation_id: referral.recommendationId,
    affiliate_click_id: referral.affiliateClickId,
    referral_id: nullableText(row.referral_id),
    affiliate_conversion_id: referral.affiliateConversionId,
    source_type: normalizedSourceType(row.source_type),
    source_reference: nullableText(row.source_reference) || referral.sourceReference,
    title: nullableText(row.title) || "Trip booking",
    start_time: typeof row.start_at === "string" ? row.start_at : null,
    end_time: typeof row.end_at === "string" ? row.end_at : null,
    start_date: typeof row.start_date === "string" ? row.start_date : null,
    end_date: typeof row.end_date === "string" ? row.end_date : null,
    timezone: typeof metadata.timezone === "string" ? metadata.timezone : null,
    origin: nullableText(row.origin),
    destination: nullableText(row.destination),
    location_name: typeof metadata.locationName === "string" ? metadata.locationName : null,
    address: nullableText(row.address),
    coordinates:
      metadata.coordinates && typeof metadata.coordinates === "object" && !Array.isArray(metadata.coordinates)
        ? sanitizeBookingEvidence(metadata.coordinates) as Record<string, unknown>
        : null,
    flight_number: nullableText(row.flight_number),
    airline_code: typeof metadata.airlineCode === "string" ? metadata.airlineCode : null,
    terminal: nullableText(row.terminal),
    gate: nullableText(row.gate),
    room_type: nullableText(row.room_type),
    check_in_time: typeof row.check_in_at === "string" ? row.check_in_at : null,
    check_out_time: typeof row.check_out_at === "string" ? row.check_out_at : null,
    reservation_requirements: sanitizeBookingEvidence(row.reservation_requirements || {}) as Record<string, unknown>,
    total_price: typeof row.total_price === "number" ? row.total_price : null,
    currency: normalizedCurrency(row.currency),
    taxes_and_fees: typeof row.taxes_and_fees === "number" ? row.taxes_and_fees : null,
    cancellation_deadline: typeof row.cancellation_deadline === "string" ? row.cancellation_deadline : null,
    cancellation_terms: nullableText(row.cancellation_terms),
    traveler_confirmed: row.traveler_confirmed === true,
    last_synced_at: typeof row.last_synced_at === "string" ? row.last_synced_at : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
    superseded_by_booking_id: nullableText(row.superseded_by_booking_id),
    review_state:
      metadata.reviewState === "traveler_asserted" || metadata.reviewState === "dismissed"
        ? metadata.reviewState
        : null,
    pending_corrections:
      safeJson(metadata.customerCorrections) && Object.keys(safeJson(metadata.customerCorrections)).length
        ? safeJson(metadata.customerCorrections)
        : null,
    booking_segments: Array.isArray(row.booking_segments)
      ? row.booking_segments as BookingSegmentRecord[]
      : undefined
  };
}

export function normalizeTripBookingInput(input: TripBookingInput, fallbackCurrency?: string | null) {
  const travelerConfirmed = input.travelerConfirmed === true;
  const bookingStatus = normalizedBookingStatus(input.bookingStatus, travelerConfirmed);
  const bookingType = normalizedBookingType(input.bookingType);
  const title =
    nullableText(input.title) ||
    nullableText(input.provider) ||
    (bookingType === "flight" ? "Flight booking" : bookingType === "hotel" ? "Hotel booking" : "Trip booking");

  const confirmed =
    travelerConfirmed ||
    confirmedStatuses.has(bookingStatus);

  // B04: booking times convert with the caller's explicit zone only.
  // Date-only facts persist as dates (start_date/end_date) even when no
  // instant can honestly be established. The start clock belongs to the
  // departure zone and the end clock to the arrival zone; both fall back
  // to the single booking zone when no leg zone is given, so hotel and
  // activity writes (which carry only `timezone`) behave unchanged.
  const zone = nullableText(input.timezone);
  const departureZone = nullableText(input.departureTimezone) || zone;
  const arrivalZone = nullableText(input.arrivalTimezone) || zone;

  return {
    booking_type: canonicalBookingType(bookingType),
    booking_status: canonicalBookingStatus(
      bookingStatus,
      confirmed
    ),

    provider_name: nullableText(input.provider),
    provider_booking_id: nullableText(input.providerBookingId),
    confirmation_number: nullableText(input.confirmationCode),

    source_type: normalizedSourceType(input.sourceType),
    title,

    start_at: convertBookingTimestampPreservingDate(input.startTime, departureZone, bookingDate(input.startDate) !== null),
    end_at: convertBookingTimestampPreservingDate(input.endTime, arrivalZone, bookingDate(input.endDate) !== null),
    start_date: bookingDate(input.startDate),
    end_date: bookingDate(input.endDate),

    origin: nullableText(input.origin),
    destination: nullableText(input.destination),
    address: nullableText(input.address),

    flight_number: nullableText(input.flightNumber),
    terminal: nullableText(input.terminal),
    gate: nullableText(input.gate),

    room_type: nullableText(input.roomType),
    check_in_at: convertBookingTimestampPreservingDate(input.checkInTime, zone, bookingDate(input.startDate) !== null),
    check_out_at: convertBookingTimestampPreservingDate(input.checkOutTime, zone, bookingDate(input.endDate) !== null),

    reservation_requirements: safeJson(
      input.reservationRequirements
    ),

    total_price: nullableMoney(input.totalPrice),
    amount_cents: nullableMoney(input.totalPrice) == null ? null : Math.round(Number(input.totalPrice) * 100),
    // Currency for a NOT NULL column: an explicit valid currency wins, then the
    // trip's own currency, then "XXX" (the ISO 4217 no-currency marker) when
    // nothing is known — never null, never an invented price: total_price
    // stays null when no price was supplied, so readers show no amount.
    currency:
      normalizedCurrency(input.currency) ??
      normalizedCurrency(fallbackCurrency) ??
      "XXX",
    taxes_and_fees: nullableMoney(input.taxesAndFees),

    cancellation_deadline: convertBookingTimestampPreservingDate(
      input.cancellationDeadline,
      zone,
      false
    ),
    cancellation_terms: nullableText(
      input.cancellationTerms
    ),

    traveler_confirmed: confirmed,
    referral_id: nullableText(input.referralId),
    last_synced_at:
      nullableTimestamp(input.lastSyncedAt) ||
      new Date().toISOString(),

    metadata: {
      ...safeJson(input.metadata),
      ...withBookingReferralMetadata(input.metadata, {
        recommendationId: nullableText(input.recommendationId),
        affiliateClickId: nullableText(input.affiliateClickId),
        affiliateConversionId: nullableText(input.affiliateConversionId),
        sourceReference: nullableText(input.sourceReference)
      }),
      timezone: nullableText(input.timezone),
      departureTimezone: nullableText(input.departureTimezone),
      arrivalTimezone: nullableText(input.arrivalTimezone),
      locationName: nullableText(input.locationName),
      coordinates:
        input.coordinates &&
        typeof input.coordinates === "object"
          ? input.coordinates
          : null,
      airlineCode:
        nullableText(input.airlineCode)?.toUpperCase() ||
        null
    }
  };
}

export function normalizeBookingSegments(
  segments: BookingSegmentInput[] | null | undefined,
  zones?: {
    timeZone?: string | null;
    departureTimeZone?: string | null;
    arrivalTimeZone?: string | null;
  }
) {
  const departureZone = zones?.departureTimeZone || zones?.timeZone || null;
  const arrivalZone = zones?.arrivalTimeZone || zones?.timeZone || null;
  return (segments || [])
    .map((segment, index) => ({
      sequence: Math.max(1, Math.round(Number(segment.sequence) || index + 1)),
      origin: nullableText(segment.origin),
      destination: nullableText(segment.destination),
      departure_time: convertBookingTimestampPreservingDate(segment.departureTime, departureZone, false),
      arrival_time: convertBookingTimestampPreservingDate(segment.arrivalTime, arrivalZone, false),
      provider: nullableText(segment.provider),
      service_number: nullableText(segment.serviceNumber),
      terminal: nullableText(segment.terminal),
      gate: nullableText(segment.gate),
      seat: nullableText(segment.seat),
      status: normalizedSegmentStatus(segment.status)
    }))
    .sort((a, b) => a.sequence - b.sequence);
}

async function assertTripOwnership(supabase: SupabaseClient, userId: string, tripId: string) {
  const { data, error } = await supabase.from("roamly_trips").select("id,budget_currency,metadata").eq("id", tripId).eq("user_id", userId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "TRIP_NOT_FOUND" };
  // The trip's own currency (planner budget currency, e.g. PHP for Philippines
  // trips) is the fallback unit for bookings saved without a currency. It labels
  // an unknown price; it never invents one.
  const row = data as Record<string, unknown>;
  const planning = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>).planning
    : null;
  const planningCurrency = planning && typeof planning === "object" && !Array.isArray(planning)
    ? (planning as Record<string, unknown>).budgetCurrency ?? (planning as Record<string, unknown>).budget_currency
    : null;
  return {
    ok: true as const,
    tripCurrency: normalizedCurrency(row.budget_currency) ?? normalizedCurrency(planningCurrency)
  };
}

export async function supersedeBooking(params: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  tripId: string;
  predecessorId: string;
  successorId: string;
}) {
  if (params.predecessorId === params.successorId) return { ok: false as const, error: "BOOKING_SELF_LINK" };
  const rows = await params.supabase
    .from("roamly_bookings")
    .select("id,user_id,trip_id,superseded_by_booking_id")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .in("id", [params.predecessorId, params.successorId]);
  if (rows.error) return { ok: false as const, error: rows.error.message };
  if ((rows.data || []).length !== 2) return { ok: false as const, error: "BOOKING_NOT_FOUND" };
  const predecessor = (rows.data || []).find((row) => row.id === params.predecessorId) as Record<string, unknown>;
  if (predecessor.superseded_by_booking_id === params.successorId) {
    return { ok: true as const, idempotent: true as const, booking: predecessor };
  }
  if (predecessor.superseded_by_booking_id) return { ok: false as const, error: "BOOKING_ALREADY_SUPERSEDED" };
  const result = await params.admin.rpc("roamly_supersede_booking", {
    p_user_id: params.userId,
    p_trip_id: params.tripId,
    p_predecessor_id: params.predecessorId,
    p_successor_id: params.successorId
  });
  if (result.error) return { ok: false as const, error: result.error.message };
  const booking = Array.isArray(result.data) ? result.data[0] : result.data;
  return { ok: true as const, idempotent: false as const, booking: booking || null };
}

/**
 * Traveler cancel for a tracked booking (manual, screenshot, email-imported).
 *
 * Cancel is a Roamly-tracking action only: it never touches Stripe, never
 * refunds anything, and never cancels a Roamly purchase/unlock (those are
 * separate purchase records, not bookings). The row is never hard-deleted —
 * its status becomes "cancelled", which drops it from the active set
 * (isActiveTripBooking) and from budget totals, while the record and its
 * provenance stay readable in booking history. Only the booking's status
 * and updated_at change: price, currency, and segments history are never
 * rewritten by a cancel.
 *
 * Edge rules: cancelling an already-cancelled booking is a harmless no-op
 * success; cancelling a superseded booking is refused (superseded rows are
 * history, not actionable); cancelling a refunded booking is refused so the
 * refund fact is never overwritten. Ownership is enforced twice: the trip
 * must belong to the caller, and the row must match id + user + trip.
 *
 * Companion reminders: after a fresh cancel succeeds, this also withdraws
 * the trip's still-scheduled companion events for this booking
 * (roamly_trip_companion_events, status 'scheduled' only). 'processing'
 * rows are never touched — dispatch may be in flight, and its emailSentAt
 * stamping must not race this withdrawal. Withdrawal is secondary to the
 * cancel: a withdrawal error is logged server-side and surfaced as
 * reminderWithdrawalFailed, and the booking stays cancelled.
 */
export async function cancelTripBooking(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  bookingId: string;
}) {
  const ownership = await assertTripOwnership(
    params.supabase,
    params.userId,
    params.tripId
  );
  if (!ownership.ok) {
    return { ok: false as const, error: ownership.error };
  }

  const existing = await params.supabase
    .from("roamly_bookings")
    .select("*")
    .eq("id", params.bookingId)
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .maybeSingle();
  if (existing.error) return { ok: false as const, error: "BOOKING_READ_FAILED" };
  if (!existing.data) return { ok: false as const, error: "BOOKING_NOT_FOUND" };

  const row = existing.data as Record<string, unknown>;
  if (row.booking_status === "cancelled") {
    // No withdrawal is attempted here: there was no fresh cancel status
    // update. (A booking cancelled after this patch already had its
    // scheduled reminders withdrawn by that cancel.)
    return {
      ok: true as const,
      idempotent: true as const,
      alreadyCancelled: true as const,
      booking: serializeTripBookingRecord(row),
      remindersWithdrawn: null as number | null,
      reminderWithdrawalFailed: false as const
    };
  }
  if (row.booking_status === "refunded") {
    return { ok: false as const, error: "BOOKING_ALREADY_REFUNDED" };
  }
  if (row.superseded_by_booking_id) {
    return { ok: false as const, error: "BOOKING_ALREADY_SUPERSEDED" };
  }

  const updated = await params.supabase
    .from("roamly_bookings")
    .update({
      booking_status: "cancelled",
      updated_at: new Date().toISOString()
    })
    .eq("id", params.bookingId)
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .select("*")
    .single();
  if (updated.error || !updated.data) {
    return { ok: false as const, error: "BOOKING_CANCEL_FAILED" };
  }
  // Withdraw this booking's still-scheduled companion reminders, using the
  // same user-session client as the cancel itself. Only 'scheduled' rows
  // for this booking + trip are withdrawn; 'processing' rows are left alone
  // so an in-flight dispatch (and its emailSentAt stamp) is never raced.
  // The booking cancel above is the primary result: a withdrawal failure is
  // logged server-side and surfaced as a flag — it never un-cancels the
  // booking.
  let remindersWithdrawn: number | null = null;
  let reminderWithdrawalFailed = false;
  try {
    const withdrawal = await params.supabase
      .from("roamly_trip_companion_events")
      .update({ status: "cancelled" })
      .eq("booking_id", params.bookingId)
      .eq("trip_id", params.tripId)
      .eq("status", "scheduled")
      .select("id");
    if (withdrawal.error) {
      reminderWithdrawalFailed = true;
      console.error("cancelTripBooking reminder withdrawal failed", withdrawal.error);
    } else if (Array.isArray(withdrawal.data)) {
      remindersWithdrawn = withdrawal.data.length;
    }
  } catch (error) {
    reminderWithdrawalFailed = true;
    console.error("cancelTripBooking reminder withdrawal failed", error);
  }
  return {
    ok: true as const,
    idempotent: false as const,
    alreadyCancelled: false as const,
    booking: serializeTripBookingRecord(updated.data as Record<string, unknown>),
    remindersWithdrawn,
    reminderWithdrawalFailed
  };
}

export async function listTripBookings(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  includeSegments?: boolean;
}) {
  const select = params.includeSegments ? "*,booking_segments(*)" : "*";
  const { data, error } = await params.supabase
    .from("roamly_bookings")
    .select(select)
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .order("start_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    return {
      bookings: [] as TripBookingRecord[],
      error: error.message
    };
  }

  return {
    bookings: (data || []).map((row) =>
      serializeTripBookingRecord(
        row as unknown as Record<string, unknown>
      )
    ),
    error: null
  };
}

export type BookingReviewAction = "assert" | "dismiss" | "correct";

/**
 * Traveler review of one wallet booking (B11). The traveler's action is
 * recorded in the row's metadata only: it NEVER changes booking_status or
 * traveler_confirmed, so a customer assertion can never become provider
 * confirmation. "assert" records that the details are the traveler's own;
 * "dismiss" records a dismissal with an optional reason; "correct" merges
 * sanitized correction fields into the pending customerCorrections assertion.
 * Superseded rows are history and cannot be reviewed.
 */
export async function reviewTripBooking(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  bookingId: string;
  action: BookingReviewAction;
  reason?: string | null;
  corrections?: unknown;
}) {
  const trip = await params.supabase
    .from("roamly_trips")
    .select("id")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (trip.error) return { ok: false as const, error: trip.error.message };
  if (!trip.data) return { ok: false as const, error: "TRIP_NOT_FOUND" };

  const existing = await params.supabase
    .from("roamly_bookings")
    .select("id,metadata,superseded_by_booking_id")
    .eq("id", params.bookingId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (existing.error) return { ok: false as const, error: existing.error.message };
  if (!existing.data) return { ok: false as const, error: "BOOKING_NOT_FOUND" };
  const row = existing.data as Record<string, unknown>;
  if (row.superseded_by_booking_id != null) return { ok: false as const, error: "BOOKING_NOT_CURRENT" };

  const metadata = safeJson(row.metadata);
  const now = new Date().toISOString();
  if (params.action === "assert") {
    metadata.reviewState = "traveler_asserted";
    metadata.travelerAssertion = { assertedAt: now };
  } else if (params.action === "dismiss") {
    metadata.reviewState = "dismissed";
    const reason = typeof params.reason === "string" ? params.reason.trim().slice(0, 500) : "";
    metadata.reviewDismissed = { dismissedAt: now, reason: reason || null };
  } else if (params.action === "correct") {
    const sanitized = sanitizeBookingCorrectionFields(params.corrections);
    const supplied = Object.fromEntries(Object.entries(sanitized).filter(([, value]) => value != null));
    if (!Object.keys(supplied).length) return { ok: false as const, error: "NO_VALID_CORRECTIONS" };
    metadata.customerCorrections = { ...safeJson(metadata.customerCorrections), ...supplied };
    metadata.correctionAssertedAt = now;
  } else {
    return { ok: false as const, error: "UNKNOWN_REVIEW_ACTION" };
  }

  const updated = await params.supabase
    .from("roamly_bookings")
    .update({ metadata })
    .eq("id", params.bookingId)
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId);
  if (updated.error) return { ok: false as const, error: updated.error.message };
  return {
    ok: true as const,
    reviewState: typeof metadata.reviewState === "string" ? metadata.reviewState : null,
    pendingCorrections: safeJson(metadata.customerCorrections)
  };
}


type MeaningfulBookingChange = {
  eventType:
    | "flight_delayed"
    | "flight_cancelled"
    | "flight_time_changed"
    | "hotel_changed"
    | "booking_confirmed"
    | "booking_cancelled"
    | "booking_updated";
  severity: "minor" | "routine" | "important" | "critical";
  title: string;
  summary: string;
  requiresUserApproval: boolean;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function activeCanonicalStatus(value: unknown) {
  return ["booked", "paid", "reserved"].includes(
    textValue(value) || ""
  );
}

function timestampValue(value: unknown) {
  const text = textValue(value);
  if (!text) return null;

  const timestamp = new Date(text).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function detectMeaningfulBookingChange(
  previous: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): MeaningfulBookingChange | null {
  const title =
    textValue(incoming.title) ||
    textValue(previous?.title) ||
    "Travel booking";

  const type =
    textValue(incoming.booking_type) ||
    textValue(previous?.booking_type) ||
    "other";

  const previousStatus =
    textValue(previous?.booking_status) || "unknown";

  const incomingStatus =
    textValue(incoming.booking_status) || "unknown";

  if (!previous) {
    if (activeCanonicalStatus(incomingStatus)) {
      return {
        eventType: "booking_confirmed",
        severity: "routine",
        title: `${title} is confirmed`,
        summary:
          "Roamly added the confirmed booking and checked it against the current itinerary.",
        requiresUserApproval: false
      };
    }

    return null;
  }

  if (
    previousStatus !== "cancelled" &&
    incomingStatus === "cancelled"
  ) {
    return {
      eventType:
        type === "flight"
          ? "flight_cancelled"
          : "booking_cancelled",
      severity: "critical",
      title: `${title} was cancelled`,
      summary:
        "Roamly detected a cancellation and checked the itinerary for affected plans.",
      requiresUserApproval: true
    };
  }

  if (
    !activeCanonicalStatus(previousStatus) &&
    activeCanonicalStatus(incomingStatus)
  ) {
    return {
      eventType: "booking_confirmed",
      severity: "routine",
      title: `${title} is confirmed`,
      summary:
        "Roamly detected that this booking is now confirmed and checked it against the itinerary.",
      requiresUserApproval: false
    };
  }

  const previousStart = timestampValue(previous.start_at);
  const incomingStart = timestampValue(incoming.start_at);

  if (
    type === "flight" &&
    previousStart !== null &&
    incomingStart !== null &&
    previousStart !== incomingStart
  ) {
    const delayMinutes = Math.round(
      (incomingStart - previousStart) / 60000
    );

    if (delayMinutes >= 15) {
      return {
        eventType: "flight_delayed",
        severity:
          delayMinutes >= 180 ? "critical" : "important",
        title: `${title} is delayed`,
        summary:
          `Roamly detected a ${delayMinutes}-minute flight delay and checked the itinerary for timing conflicts.`,
        requiresUserApproval: delayMinutes >= 60
      };
    }

    return {
      eventType: "flight_time_changed",
      severity: "important",
      title: `${title} schedule changed`,
      summary:
        "Roamly detected a flight-time change and checked the itinerary for timing conflicts.",
      requiresUserApproval: true
    };
  }

  if (type === "hotel") {
    const hotelFields = [
      "start_at",
      "end_at",
      "check_in_at",
      "check_out_at"
    ];

    const changed = hotelFields.some(
      (field) =>
        textValue(previous[field]) !==
        textValue(incoming[field])
    );

    if (changed) {
      return {
        eventType: "hotel_changed",
        severity: "important",
        title: `${title} dates changed`,
        summary:
          "Roamly detected a hotel date or check-in change and checked the itinerary for affected plans.",
        requiresUserApproval: true
      };
    }
  }

  const identityChanged =
    textValue(previous.provider_name) !==
      textValue(incoming.provider_name) ||
    textValue(previous.confirmation_number) !==
      textValue(incoming.confirmation_number);

  if (identityChanged) {
    return {
      eventType: "booking_updated",
      severity: "routine",
      title: `${title} was updated`,
      summary:
        "Roamly detected a provider or confirmation update.",
      requiresUserApproval: false
    };
  }

  return null;
}

async function findMatchingCanonicalBooking(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  booking: Record<string, unknown>;
}): Promise<{
  booking: Record<string, unknown> | null;
  error: string | null;
  ambiguous?: boolean;
  candidates?: Record<string, unknown>[];
}> {
  const base = () =>
    params.supabase
      .from("roamly_bookings")
      .select("*")
      .eq("user_id", params.userId)
      .eq("trip_id", params.tripId);

  const referral = bookingReferralMetadata(params.booking.metadata);
  const referralId = typeof params.booking.referral_id === "string" ? params.booking.referral_id : null;
  if (referralId) {
    const result = await base().eq("referral_id", referralId).maybeSingle();
    if (result.error) return { booking: null, error: result.error.message };
    if (result.data) return { booking: result.data as Record<string, unknown>, error: null };
  }

  if (referral.affiliateClickId) {
    const result = await base().contains("metadata", { affiliateClickId: referral.affiliateClickId }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error) return { booking: null, error: result.error.message };
    if (result.data) return { booking: result.data as Record<string, unknown>, error: null };
  }

  // B03: a provider identifier is an identity ONLY within its provider
  // and booking type. Two different providers — or a flight and a hotel —
  // may legitimately share one confirmation string; matching on the string
  // alone let the second import overwrite the first. Identifier matches
  // are therefore scoped by provider_name and booking_type (the normalized
  // booking carries canonical types, the same values stored rows carry,
  // so scoping is consistent; a legacy row with a non-canonical type
  // simply misses and inserts instead of overwriting — the safe side).
  // When a scoped identifier still matches more than one row, the match
  // is ambiguous: the caller inserts a new needs-review row instead of
  // overwriting any existing reservation.
  const providerName = textValue(params.booking.provider_name);
  const bookingType = textValue(params.booking.booking_type);
  async function scopedIdentifierMatch(column: string, value: string, extra?: Array<[string, string]>) {
    let query = base().eq(column, value);
    if (providerName) query = query.eq("provider_name", providerName);
    if (bookingType) query = query.eq("booking_type", bookingType);
    for (const [extraColumn, extraValue] of extra || []) {
      query = query.eq(extraColumn, extraValue);
    }
    const result = await query.order("created_at", { ascending: false }).limit(2);
    if (result.error) return { rows: null as Record<string, unknown>[] | null, error: result.error.message };
    return { rows: (result.data || []) as Record<string, unknown>[], error: null };
  }
  function scopedResult(match: { rows: Record<string, unknown>[] | null; error: string | null }) {
    if (match.error) return { booking: null as Record<string, unknown> | null, error: match.error };
    if (!match.rows || match.rows.length === 0) return null;
    if (match.rows.length > 1) {
      return { booking: null as Record<string, unknown> | null, error: null, ambiguous: true, candidates: match.rows };
    }
    return { booking: match.rows[0], error: null };
  }

  const providerBookingId = textValue(
    params.booking.provider_booking_id
  );

  if (providerBookingId) {
    const matched = scopedResult(await scopedIdentifierMatch("provider_booking_id", providerBookingId));
    if (matched) return matched;
  }

  const confirmationNumber = textValue(
    params.booking.confirmation_number
  );

  if (confirmationNumber) {
    const matched = scopedResult(await scopedIdentifierMatch("confirmation_number", confirmationNumber));
    if (matched) return matched;
  }

  const title = textValue(params.booking.title);
  const startAt = textValue(params.booking.start_at);

  if (title && startAt) {
    const matched = scopedResult(await scopedIdentifierMatch("title", title, [["start_at", startAt]]));
    if (matched) return matched;
  }

  return {
    booking: null,
    error: null
  };
}

async function reloadReferralCaptureAfterConflict(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  referralId: string;
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null };
}) {
  if (params.error.code !== "23505") return { booking: null, error: null, reusable: false };

  const errorText = [params.error.message, params.error.details, params.error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const namesTheReferralConflict = errorText.includes("roamly_bookings_referral_capture_uidx");
  const namesAnotherConstraint = /unique constraint|duplicate key value/.test(errorText) && !namesTheReferralConflict;
  if (namesAnotherConstraint) return { booking: null, error: null, reusable: false };

  const canonical = await params.supabase
    .from("roamly_bookings")
    .select("*")
    .eq("user_id", params.userId)
    .eq("trip_id", params.tripId)
    .eq("referral_id", params.referralId)
    .maybeSingle();
  if (canonical.error || !canonical.data) return { booking: null, error: null, reusable: false };
  return { booking: canonical.data as Record<string, unknown>, error: null, reusable: true };
}

function bookingRevisionPatch(booking: Record<string, unknown>) {
  return {
    booking_status: booking.booking_status,
    provider_name: booking.provider_name,
    provider_booking_id: booking.provider_booking_id,
    confirmation_number: booking.confirmation_number,
    title: booking.title,
    start_at: booking.start_at,
    end_at: booking.end_at,
    origin: booking.origin,
    destination: booking.destination,
    flight_number: booking.flight_number,
    terminal: booking.terminal,
    gate: booking.gate,
    room_type: booking.room_type,
    check_in_at: booking.check_in_at,
    check_out_at: booking.check_out_at,
    metadata: booking.metadata || {}
  };
}

async function applyGmailBookingRevision(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  bookingId: string;
  previousBooking: Record<string, unknown>;
  booking: Record<string, unknown>;
  reconciliation: NonNullable<TripBookingInput["reconciliation"]>;
}) {
  const changedFields = Object.keys(bookingRevisionPatch(params.booking)).filter((key) => {
    const previous = params.previousBooking[key];
    const next = params.booking[key];
    return JSON.stringify(previous ?? null) !== JSON.stringify(next ?? null);
  });
  const result = await params.supabase.rpc("roamly_apply_gmail_booking_revision", {
    p_booking_id: params.bookingId,
    p_user_id: params.userId,
    p_trip_id: params.tripId,
    p_source_connection_id: params.reconciliation.connectionId,
    p_source_message_id: params.reconciliation.sourceMessageId,
    p_source_event_at: params.reconciliation.sourceEventAt,
    p_decision: params.reconciliation.decision || "applied",
    p_booking_patch: bookingRevisionPatch(params.booking),
    p_changed_fields: changedFields
  });
  if (result.error) return { ok: false as const, error: result.error.message };
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row) return { ok: false as const, error: "Booking revision returned no result." };
  return {
    ok: true as const,
    applied: row.applied === true,
    duplicate: row.duplicate === true,
    stale: row.stale === true,
    needsReview: row.needs_review === true,
    version: typeof row.reconciliation_version === "number" ? row.reconciliation_version : null
  };
}

// U2 FIX — omitted-vs-explicit for money on update. This is the same
// disease B06 fixed for segments only: a matched re-save that omits a money
// field used to overwrite the stored value with null / "XXX", so a traveler
// fixing a time or title silently lost the booking's price. On update, an
// omitted field preserves the stored value; only an explicit, valid value
// replaces it. There is no clear-price signal in the API (no clearPrice /
// clear_price anywhere in the tree), so explicit null preserves too.
// Explicit zero replaces with zero (B14 rule) — it is a real price, not a
// wipe. total_price and amount_cents move together: they are one value in
// two units (B02's one-unit rule), never updated independently.
function preserveOmittedMoneyFieldsOnUpdate(
  booking: ReturnType<typeof normalizeTripBookingInput>,
  previous: Record<string, unknown>,
  input: TripBookingInput
) {
  const next = { ...booking };
  if (typeof input.totalPrice === "number" && Number.isFinite(input.totalPrice) && input.totalPrice >= 0) {
    const price = nullableMoney(input.totalPrice);
    next.total_price = price;
    next.amount_cents = price == null ? null : Math.round(price * 100);
  } else {
    next.total_price = typeof previous.total_price === "number" ? previous.total_price : null;
    next.amount_cents = typeof previous.amount_cents === "number" ? previous.amount_cents : null;
  }
  const currency = normalizedCurrency(input.currency);
  next.currency =
    currency ?? (typeof previous.currency === "string" && previous.currency ? previous.currency : "XXX");
  if (typeof input.taxesAndFees === "number" && Number.isFinite(input.taxesAndFees) && input.taxesAndFees >= 0) {
    next.taxes_and_fees = nullableMoney(input.taxesAndFees);
  } else {
    next.taxes_and_fees = typeof previous.taxes_and_fees === "number" ? previous.taxes_and_fees : null;
  }
  return next;
}

export async function createTripBooking(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  input: TripBookingInput;
  // B01: which segment-replacement RPC to call. "authenticated" (default) is
  // the session-bound function: it raises unless p_user_id = auth.uid(), so
  // user-session flows (manual booking, confirm, attach) keep working with
  // their own id. "service" is the service-role-only function for trusted
  // server flows (affiliate webhook, Gmail sync) that act on a booking
  // owner's behalf without a user session. Never pass "service" from a
  // user-session flow: the service function is unreachable from one, so the
  // call would fail closed instead of silently taking the trusted path.
  segmentReplacement?: "authenticated" | "service";
}) {
  const ownership = await assertTripOwnership(
    params.supabase,
    params.userId,
    params.tripId
  );

  if (!ownership.ok) {
    return {
      booking: null,
      error: ownership.error
    };
  }

  const booking = normalizeTripBookingInput(params.input, ownership.tripCurrency);

  const match = await findMatchingCanonicalBooking({
    supabase: params.supabase,
    userId: params.userId,
    tripId: params.tripId,
    booking
  });

  if (match.error) {
    return {
      booking: null,
      error: match.error
    };
  }

  // B03: a genuinely ambiguous identifier match never overwrites an
  // existing reservation. It inserts as a new needs-review row instead
  // (status unknown, unconfirmed, flagged in metadata) for a human to
  // resolve — a customer assertion is never turned into a provider
  // confirmation by matching alone.
  const ambiguousMatch = match.ambiguous === true;
  const previousBooking = ambiguousMatch ? null : match.booking;
  const writeBooking = ambiguousMatch
    ? {
        ...booking,
        booking_status: "unknown",
        traveler_confirmed: false,
        metadata: { ...booking.metadata, ambiguousMatch: true }
      }
    : booking;

  if (previousBooking) {
    const previousStatus = clean(previousBooking.booking_status);
    const previousConfirmed = previousBooking.traveler_confirmed === true || ["booked", "paid", "reserved"].includes(previousStatus);
    if (previousConfirmed && !booking.traveler_confirmed) {
      return {
        booking: serializeTripBookingRecord(previousBooking),
        error: null,
        created: false,
        meaningfulChange: null,
        companionWorkflow: null,
        itineraryOverride: { ok: true as const, changed: false, preservedConfirmed: true }
      };
    }
  }

  if (previousBooking && params.input.reconciliation) {
    const revision = await applyGmailBookingRevision({
      supabase: params.supabase,
      userId: params.userId,
      tripId: params.tripId,
      bookingId: String(previousBooking.id),
      previousBooking,
      booking,
      reconciliation: params.input.reconciliation
    });
    if (!revision.ok) return { booking: null, error: revision.error };
    if (!revision.applied) {
      return {
        booking: serializeTripBookingRecord(previousBooking),
        error: null,
        reconciliation: revision
      };
    }
  }

  // U2: on a matched re-save, omitted money fields keep the stored values
  // (see preserveOmittedMoneyFieldsOnUpdate) instead of wiping them.
  const updatePayload = previousBooking
    ? preserveOmittedMoneyFieldsOnUpdate(booking, previousBooking, params.input)
    : booking;

  const writeResult = previousBooking
    ? params.input.reconciliation
      ? await params.supabase
        .from("roamly_bookings")
        .select("*")
        .eq("id", String(previousBooking.id))
        .eq("user_id", params.userId)
        .eq("trip_id", params.tripId)
        .single()
      : await params.supabase
        .from("roamly_bookings")
        .update({
          // U2 (merged with B03): on a matched re-save this is the
          // money-preserved payload, not the raw normalized booking.
          // writeBooking === booking on this path (a matched update is
          // never ambiguous), so this is exactly #93's spread swap.
          ...updatePayload,
          updated_at: new Date().toISOString()
        })
        .eq("id", String(previousBooking.id))
        .eq("user_id", params.userId)
        .select("*")
        .single()
    : await params.supabase
        .from("roamly_bookings")
        .insert({
          ...writeBooking,
          user_id: params.userId,
          trip_id: params.tripId,
          source_connection_id: params.input.reconciliation?.connectionId || null,
          source_message_id: params.input.reconciliation?.sourceMessageId || null,
          reconciliation_status: params.input.reconciliation?.decision || "applied"
        })
        .select("*")
        .single();

  if (writeResult.error) {
    if (!previousBooking && booking.referral_id) {
      const duplicate = await reloadReferralCaptureAfterConflict({
        supabase: params.supabase,
        userId: params.userId,
        tripId: params.tripId,
        referralId: booking.referral_id,
        error: writeResult.error
      });
      if (duplicate.reusable && duplicate.booking) {
        return {
          booking: serializeTripBookingRecord(duplicate.booking),
          error: null,
          created: false,
          duplicate: true
        };
      }
    }
    if (!previousBooking && params.input.reconciliation) {
      const duplicate = await params.supabase
        .from("roamly_bookings")
        .select("*")
        .eq("user_id", params.userId)
        .eq("trip_id", params.tripId)
        .eq("source_connection_id", params.input.reconciliation.connectionId)
        .eq("source_message_id", params.input.reconciliation.sourceMessageId)
        .maybeSingle();
      if (!duplicate.error && duplicate.data) {
        return {
          booking: serializeTripBookingRecord(duplicate.data as Record<string, unknown>),
          error: null,
          reconciliation: {
            ok: true as const,
            applied: false,
            duplicate: true,
            stale: false,
            needsReview: false,
            version: Number(duplicate.data.reconciliation_version || 0)
          }
        };
      }
    }
    // Customer boundary: the raw database message must never reach the
    // customer. Detail stays in server logs; the caller gets one stable code.
    console.error("[Roamly bookings] booking write failed:", writeResult.error);
    return {
      booking: null,
      error: "BOOKING_SAVE_FAILED"
    };
  }

  const savedRow =
    writeResult.data as unknown as Record<string, unknown>;

  if (!previousBooking && params.input.reconciliation) {
    const revision = await applyGmailBookingRevision({
      supabase: params.supabase,
      userId: params.userId,
      tripId: params.tripId,
      bookingId: String(savedRow.id),
      previousBooking: savedRow,
      booking,
      reconciliation: params.input.reconciliation
    });
    if (!revision.ok) return { booking: null, error: revision.error };
    if (!revision.applied) return { booking: serializeTripBookingRecord(savedRow), error: null, reconciliation: revision };
    const refreshed = await params.supabase
      .from("roamly_bookings")
      .select("*")
      .eq("id", String(savedRow.id))
      .eq("user_id", params.userId)
      .eq("trip_id", params.tripId)
      .single();
    if (refreshed.error) return { booking: null, error: refreshed.error.message };
    Object.assign(savedRow, refreshed.data as Record<string, unknown>);
  }

  const createdBooking =
    serializeTripBookingRecord(savedRow);

  // B06: an OMITTED segment field preserves existing segments; only an
  // explicitly supplied list (including an explicit empty list) replaces
  // them. The distinction lives here and at the route, which passes
  // undefined for an absent field: normalizeBookingSegments alone cannot
  // tell omission from an empty list, since it normalizes both to [].
  // The RPC itself stays atomic (delete+insert in one transaction); the
  // parent write and the segment replace remain two statements, so on an
  // RPC failure the parent update stands but the OLD segments are intact
  // (preserved, not deleted) — the safe direction. True single-transaction
  // parent+segments atomicity would need a wrapping RPC and is out of scope.
  const segmentsExplicit = params.input.segments !== undefined && params.input.segments !== null;
  const segments = normalizeBookingSegments(params.input.segments, {
    timeZone: typeof booking.metadata.timezone === "string" ? booking.metadata.timezone : null,
    departureTimeZone: typeof booking.metadata.departureTimezone === "string" ? booking.metadata.departureTimezone : null,
    arrivalTimeZone: typeof booking.metadata.arrivalTimezone === "string" ? booking.metadata.arrivalTimezone : null
  });

  // CA3 FIX A — atomic segment replacement. The previous delete-then-insert ran
  // as two separate statements: if the insert failed (deploy, restart, crash in
  // between), the booking survived with all of its segments silently gone.
  // roamly_replace_booking_segments performs the delete+insert in one
  // transaction and re-checks trip ownership inside the function.
  // B01: the RPC is routed by params.segmentReplacement. The default
  // authenticated function binds p_user_id to auth.uid() inside the database,
  // so a caller can never name another owner's identifiers and pass; the
  // service function is reserved for trusted server flows and is revoked
  // from every user session.
  if ((previousBooking && segmentsExplicit) || (!previousBooking && segments.length)) {
    const segmentRpc =
      params.segmentReplacement === "service"
        ? "roamly_replace_booking_segments_service"
        : "roamly_replace_booking_segments";
    const segmentReplace = await params.supabase.rpc(segmentRpc, {
      p_booking_id: String(savedRow.id),
      p_user_id: params.userId,
      p_trip_id: params.tripId,
      p_segments: segments
    });

    if (segmentReplace.error) {
      return {
        booking: createdBooking,
        error: segmentReplace.error.message
      };
    }
  }

  // U1 + B06 (merged): whether the RPC above actually ran — the same
  // gate as the RPC condition (update: segments explicitly supplied;
  // create: at least one segment). #94's own definition could not apply
  // because #88 already owns the segmentsExplicit/condition lines; this
  // single definition serves both the RPC gate and the return attach.
  // Null counts as omitted here (see #88's route mapping), not explicit.
  const segmentsWereWritten = previousBooking
    ? segmentsExplicit
    : segments.length > 0;

  // U1: the returned booking must carry the segments just written. The
  // parent insert row has no booking_segments key, so serializing it alone
  // made every save response claim no legs — even when the RPC had just
  // written them. When nothing was written (omitted segments on update),
  // the response states nothing and the GET reload stays the source of truth.
  const bookingWithSegments = segmentsWereWritten
    ? serializeTripBookingRecord({
      ...(savedRow as Record<string, unknown>),
      booking_segments: segments
    })
    : createdBooking;

  const itineraryOverride = await applyStoredItineraryBookingOverride({
    supabase: params.supabase,
    userId: params.userId,
    tripId: params.tripId,
    booking: {
      ...(savedRow as Record<string, unknown>),
      booking_segments: segments
    }
  }).catch((error) => ({
    ok: false as const,
    error:
      error instanceof Error
        ? error.message
        : "ITINERARY_BOOKING_OVERRIDE_FAILED"
  }));

  const change = detectMeaningfulBookingChange(
    previousBooking,
    savedRow
  );

  let companionWorkflow = null;

  if (change) {
    companionWorkflow =
      await processCompanionBookingChange({
        supabase: params.supabase,
        userId: params.userId,
        tripId: params.tripId,
        bookingId: String(savedRow.id),
        eventType: change.eventType,
        severity: change.severity,
        title: change.title,
        summary: change.summary,
        oldValue: previousBooking || {},
        newValue: savedRow,
        source:
          textValue(savedRow.source_type) ||
          "booking_wallet",
        effectiveAt:
          textValue(savedRow.updated_at) ||
          new Date().toISOString(),
        affectedLayers: [
          "booking_wallet",
          "itinerary",
          "live_companion"
        ],
        requiresUserApproval:
          change.requiresUserApproval,
        fingerprintParts: [
          textValue(previousBooking?.updated_at),
          textValue(savedRow.updated_at),
          change.eventType
        ]
      }).catch((error) => ({
        ok: false as const,
        stage: "orchestrator_exception" as const,
        error:
          error instanceof Error
            ? error.message
            : "Companion orchestration failed."
      }));
  }

  await recordTripEvent(params.supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventType: "booking_wallet_updated",
    eventTitle: previousBooking
      ? "Booking updated"
      : writeBooking.traveler_confirmed
        ? "Booking confirmed"
        : "Booking added",
    eventBody: previousBooking
      ? `${booking.title} was updated in the Booking Wallet.`
      : `${booking.title} was added to the Booking Wallet.`,
    metadata: {
      bookingId: savedRow.id,
      bookingType: writeBooking.booking_type,
      bookingStatus: writeBooking.booking_status,
      sourceType: writeBooking.source_type,
      meaningfulChange: change?.eventType || null,
      companionTriggered: Boolean(change),
      itineraryOverrideChanged:
        itineraryOverride.ok === true &&
        itineraryOverride.changed === true
    }
  });

  return {
    booking: bookingWithSegments,
    companionWorkflow,
    meaningfulChange: change?.eventType || null,
    itineraryOverride,
    created: !previousBooking,
    ambiguousMatch,
    error: null
  };
}

export function confirmedBookingsForItinerary(bookings: TripBookingRecord[]) {
  return bookings.filter((booking) => isActiveTripBooking(booking) && isConfirmedBooking(booking));
}

export function bookingWalletSummary(bookings: TripBookingRecord[]) {
  const active = bookings.filter(isActiveTripBooking);
  const confirmed = confirmedBookingsForItinerary(bookings);
  return {
    total: bookings.length,
    active: active.length,
    confirmed: confirmed.length,
    needsConfirmation: active.filter((booking) => booking.booking_status === "needs_confirmation" || booking.booking_status === "detected").length,
    clickOnly: bookings.filter(isBookingClickOnly).length
  };
}

function legacyBookingType(value: unknown): TripBookingType {
  const text = clean(value);
  if (text === "attraction" || text === "event") return "activity";
  if (text === "car_rental") return "rental_car";
  if (text === "transport") return "transfer";
  return normalizedBookingType(text);
}

function legacyBookingStatus(value: unknown): TripBookingStatus {
  const text = clean(value);
  if (text === "cancelled") return "cancelled";
  if (text === "booked" || text === "paid" || text === "reserved") return "confirmed";
  return "needs_confirmation";
}

export function legacyRoamlyBookingToWallet(record: Record<string, unknown>, fallback: { userId: string; tripId: string }): TripBookingRecord {
  const status = legacyBookingStatus(record.booking_status);
  const startDate = nullableText(record.start_date);
  const startTime = nullableText(record.start_time);
  const endDate = nullableText(record.end_date);
  const endTime = nullableText(record.end_time);
  const now = new Date().toISOString();
  const amountCents = typeof record.amount_cents === "number" && Number.isFinite(record.amount_cents) ? record.amount_cents : null;

  return {
    id: nullableText(record.id) || stableBookingKey({ userId: fallback.userId, title: nullableText(record.title), startTime: startDate }),
    trip_id: nullableText(record.trip_id) || fallback.tripId,
    user_id: nullableText(record.user_id) || fallback.userId,
    booking_type: legacyBookingType(record.booking_type),
    booking_status: status,
    provider: nullableText(record.provider_name),
    provider_booking_id: null,
    confirmation_code: nullableText(record.confirmation_number),
    recommendation_id: null,
    affiliate_click_id: null,
    referral_id: null,
    affiliate_conversion_id: null,
    source_type: nullableText(record.screenshot_url) ? "upload" : "manual",
    source_reference: "roamly_bookings",
    title: nullableText(record.title) || "Imported booking",
    start_time:
      nullableText(record.start_at) ||
      (startDate
        ? nullableTimestamp(
            `${startDate}${startTime ? `T${startTime}` : "T00:00:00"}`
          )
        : null),
    end_time:
      nullableText(record.end_at) ||
      (endDate
        ? nullableTimestamp(
            `${endDate}${endTime ? `T${endTime}` : "T00:00:00"}`
          )
        : null),
    start_date: startDate,
    end_date: endDate,
    timezone: null,
    origin: nullableText(record.origin),
    destination: nullableText(record.destination),
    location_name: nullableText(record.title),
    address: nullableText(record.address),
    coordinates:
      typeof record.latitude === "number" && typeof record.longitude === "number"
        ? { latitude: record.latitude, longitude: record.longitude }
        : null,
    flight_number: nullableText(record.flight_number),
    airline_code: null,
    terminal: nullableText(record.terminal),
    gate: nullableText(record.gate),
    room_type: nullableText(record.room_type),
    check_in_time: nullableText(record.check_in_at),
    check_out_time: nullableText(record.check_out_at),
    reservation_requirements: {},
    total_price: amountCents == null ? null : Math.round(amountCents) / 100,
    currency: normalizedCurrency(record.currency),
    taxes_and_fees:
      typeof record.taxes_and_fees === "number"
        ? record.taxes_and_fees
        : null,
    cancellation_deadline:
      nullableText(record.cancellation_deadline),
    cancellation_terms:
      nullableText(record.cancellation_terms),
    traveler_confirmed: confirmedStatuses.has(status),
    last_synced_at:
      nullableText(record.last_synced_at),
    created_at: nullableText(record.created_at) || now,
    updated_at: nullableText(record.updated_at) || now,
    superseded_by_booking_id: typeof record.superseded_by_booking_id === "string" ? record.superseded_by_booking_id : null,
    review_state: null,
    pending_corrections: null,
    booking_segments: []
  };
}
