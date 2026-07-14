import type { SupabaseClient } from "@supabase/supabase-js";
import { recordTripEvent } from "@/lib/roamly/events";

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
  "email",
  "provider_sync",
  "live_provider",
  "admin"
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
  affiliateClickId?: string | null;
  affiliateConversionId?: string | null;
  sourceType?: string | null;
  sourceReference?: string | null;
  title?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  timezone?: string | null;
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
  segments?: BookingSegmentInput[] | null;
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
  affiliate_conversion_id: string | null;
  source_type: TripBookingSourceType;
  source_reference: string | null;
  title: string;
  start_time: string | null;
  end_time: string | null;
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

function nullableTimestamp(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  return sourceTypeSet.has(text) ? (text as TripBookingSourceType) : "manual";
}

function normalizedSegmentStatus(value: unknown) {
  const text = clean(value);
  return ["scheduled", "confirmed", "delayed", "cancelled", "completed", "unknown"].includes(text) ? text : "scheduled";
}

function safeJson(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isConfirmedBooking(booking: Pick<TripBookingRecord, "booking_status" | "traveler_confirmed">) {
  return booking.traveler_confirmed && confirmedStatuses.has(booking.booking_status);
}

export function isActiveTripBooking(booking: Pick<TripBookingRecord, "booking_status">) {
  return !inactiveStatuses.has(booking.booking_status);
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
  if (status === "confirmed" || travelerConfirmed) return "booked";
  return "unknown";
}

function canonicalBookingType(type: TripBookingType) {
  if (type === "activity") return "attraction";
  if (type === "rental_car") return "car_rental";
  if (type === "transfer") return "transport";
  return type;
}

function canonicalRowToTripBookingRecord(
  row: Record<string, unknown>
): TripBookingRecord {
  const metadata =
    row.metadata &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};

  return {
    ...row,
    booking_type: legacyBookingType(row.booking_type),
    booking_status: legacyBookingStatus(row.booking_status),

    provider:
      typeof row.provider_name === "string"
        ? row.provider_name
        : null,

    confirmation_code:
      typeof row.confirmation_number === "string"
        ? row.confirmation_number
        : null,

    recommendation_id:
      typeof metadata.recommendationId === "string"
        ? metadata.recommendationId
        : null,

    affiliate_click_id:
      typeof metadata.affiliateClickId === "string"
        ? metadata.affiliateClickId
        : null,

    affiliate_conversion_id:
      typeof metadata.affiliateConversionId === "string"
        ? metadata.affiliateConversionId
        : null,

    source_reference:
      typeof metadata.sourceReference === "string"
        ? metadata.sourceReference
        : null,

    start_time:
      typeof row.start_at === "string"
        ? row.start_at
        : null,

    end_time:
      typeof row.end_at === "string"
        ? row.end_at
        : null,

    timezone:
      typeof metadata.timezone === "string"
        ? metadata.timezone
        : null,

    location_name:
      typeof metadata.locationName === "string"
        ? metadata.locationName
        : null,

    coordinates:
      metadata.coordinates &&
      typeof metadata.coordinates === "object"
        ? metadata.coordinates
        : null,

    airline_code:
      typeof metadata.airlineCode === "string"
        ? metadata.airlineCode
        : null,

    check_in_time:
      typeof row.check_in_at === "string"
        ? row.check_in_at
        : null,

    check_out_time:
      typeof row.check_out_at === "string"
        ? row.check_out_at
        : null
  } as TripBookingRecord;
}

export function normalizeTripBookingInput(input: TripBookingInput) {
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

    start_at: nullableTimestamp(input.startTime),
    end_at: nullableTimestamp(input.endTime),

    origin: nullableText(input.origin),
    destination: nullableText(input.destination),
    address: nullableText(input.address),

    flight_number: nullableText(input.flightNumber),
    terminal: nullableText(input.terminal),
    gate: nullableText(input.gate),

    room_type: nullableText(input.roomType),
    check_in_at: nullableTimestamp(input.checkInTime),
    check_out_at: nullableTimestamp(input.checkOutTime),

    reservation_requirements: safeJson(
      input.reservationRequirements
    ),

    total_price: nullableMoney(input.totalPrice),
    currency: normalizedCurrency(input.currency),
    taxes_and_fees: nullableMoney(input.taxesAndFees),

    cancellation_deadline: nullableTimestamp(
      input.cancellationDeadline
    ),
    cancellation_terms: nullableText(
      input.cancellationTerms
    ),

    traveler_confirmed: confirmed,
    last_synced_at:
      nullableTimestamp(input.lastSyncedAt) ||
      new Date().toISOString(),

    metadata: {
      recommendationId: nullableText(input.recommendationId),
      affiliateClickId: nullableText(input.affiliateClickId),
      affiliateConversionId: nullableText(
        input.affiliateConversionId
      ),
      sourceReference: nullableText(input.sourceReference),
      timezone: nullableText(input.timezone),
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

export function normalizeBookingSegments(segments: BookingSegmentInput[] | null | undefined) {
  return (segments || [])
    .map((segment, index) => ({
      sequence: Math.max(1, Math.round(Number(segment.sequence) || index + 1)),
      origin: nullableText(segment.origin),
      destination: nullableText(segment.destination),
      departure_time: nullableTimestamp(segment.departureTime),
      arrival_time: nullableTimestamp(segment.arrivalTime),
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
  const { data, error } = await supabase.from("roamly_trips").select("id").eq("id", tripId).eq("user_id", userId).maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "TRIP_NOT_FOUND" };
  return { ok: true as const };
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
      canonicalRowToTripBookingRecord(
        row as unknown as Record<string, unknown>
      )
    ),
    error: null
  };
}

export async function createTripBooking(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  input: TripBookingInput;
}) {
  const ownership = await assertTripOwnership(params.supabase, params.userId, params.tripId);
  if (!ownership.ok) return { booking: null, error: ownership.error };

  const booking = normalizeTripBookingInput(params.input);
  const { data, error } = await params.supabase
    .from("roamly_bookings")
    .insert({
      ...booking,
      user_id: params.userId,
      trip_id: params.tripId
    })
    .select("*")
    .single();

  if (error) {
    return {
      booking: null,
      error: error.message
    };
  }

  const createdBooking =
    canonicalRowToTripBookingRecord(
      data as Record<string, unknown>
    );

  const segments = normalizeBookingSegments(params.input.segments);
  if (segments.length) {
    const segmentInsert = await params.supabase.from("booking_segments").insert(
      segments.map((segment) => ({
        ...segment,
        booking_id: data.id
      }))
    );
    if (segmentInsert.error) {
      return {
        booking: createdBooking,
        error: segmentInsert.error.message
      };
    }
  }

  await recordTripEvent(params.supabase, {
    userId: params.userId,
    tripId: params.tripId,
    eventType: "booking_wallet_updated",
    eventTitle: booking.traveler_confirmed ? "Booking confirmed" : "Booking added",
    eventBody: `${booking.title} was added to the Booking Wallet.`,
    metadata: {
      bookingId: data.id,
      bookingType: booking.booking_type,
      bookingStatus: booking.booking_status,
      sourceType: booking.source_type
    }
  });

  return {
    booking: createdBooking,
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
    needsConfirmation: bookings.filter((booking) => booking.booking_status === "needs_confirmation" || booking.booking_status === "detected").length,
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
    affiliate_conversion_id: null,
    source_type: nullableText(record.screenshot_url) ? "upload" : "manual",
    source_reference: "roamly_bookings",
    title: nullableText(record.title) || "Imported booking",
    start_time: startDate ? nullableTimestamp(`${startDate}${startTime ? `T${startTime}` : "T00:00:00"}`) : null,
    end_time: endDate ? nullableTimestamp(`${endDate}${endTime ? `T${endTime}` : "T00:00:00"}`) : null,
    timezone: null,
    origin: null,
    destination: null,
    location_name: nullableText(record.title),
    address: nullableText(record.address),
    coordinates:
      typeof record.latitude === "number" && typeof record.longitude === "number"
        ? { latitude: record.latitude, longitude: record.longitude }
        : null,
    flight_number: null,
    airline_code: null,
    terminal: null,
    gate: null,
    room_type: null,
    check_in_time: null,
    check_out_time: null,
    reservation_requirements: {},
    total_price: amountCents == null ? null : Math.round(amountCents) / 100,
    currency: normalizedCurrency(record.currency),
    taxes_and_fees: null,
    cancellation_deadline: null,
    cancellation_terms: null,
    traveler_confirmed: confirmedStatuses.has(status),
    last_synced_at: null,
    created_at: nullableText(record.created_at) || now,
    updated_at: nullableText(record.updated_at) || now,
    booking_segments: []
  };
}
