export type OperationalBookingReference = {
  id?: string | null;
  user_id?: string | null;
  trip_id?: string | null;
  superseded_by_booking_id?: string | null;
  booking_status?: string | null;
};

export type ScheduledBookingEvent = {
  status?: string | null;
  scheduled_for?: string | null;
  booking_id?: string | null;
};

const NON_OPERATIONAL_BOOKING_STATUSES = new Set(["cancelled", "refunded"]);

export function isOperationalBookingReference(booking: OperationalBookingReference, userId: string, tripId: string, currentBookingIds: Set<string>) {
  const status = String(booking.booking_status || "").trim().toLowerCase();
  return booking.user_id === userId && booking.trip_id === tripId && booking.trip_id != null &&
    typeof booking.id === "string" && currentBookingIds.has(booking.id) && !NON_OPERATIONAL_BOOKING_STATUSES.has(status);
}

export function bookingIdsFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const value = (metadata as Record<string, unknown>).confirmed_booking_ids;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
}

export function shouldSuppressScheduledBookingEvent(params: { event: ScheduledBookingEvent; currentBookingIds: Set<string>; now?: Date }) {
  if (params.event.status !== "scheduled" || !params.event.booking_id) return false;
  const scheduledFor = params.event.scheduled_for ? new Date(params.event.scheduled_for) : null;
  if (!scheduledFor || !Number.isFinite(scheduledFor.getTime())) return false;
  return scheduledFor.getTime() > (params.now || new Date()).getTime() && !params.currentBookingIds.has(params.event.booking_id);
}

export function bookingLinkedDeliveryState(params: {
  delivery: { booking_id?: string | null; trip_id?: string | null; user_id?: string | null; metadata_json?: unknown };
  bookings: OperationalBookingReference[];
  currentBookingIds: Set<string>;
}) {
  const references = params.delivery.booking_id ? [params.delivery.booking_id] : bookingIdsFromMetadata(params.delivery.metadata_json);
  if (!references.length) return "unlinked" as const;
  const valid = references.every((bookingId) => {
    const booking = params.bookings.find((candidate) => candidate.id === bookingId);
    return Boolean(booking && params.delivery.user_id && params.delivery.trip_id &&
      isOperationalBookingReference(booking, params.delivery.user_id, params.delivery.trip_id, params.currentBookingIds));
  });
  return valid ? ("valid" as const) : ("stale" as const);
}
