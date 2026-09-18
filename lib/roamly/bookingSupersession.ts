export type BookingLineageFields = {
  id?: string | null;
  user_id?: string | null;
  trip_id?: string | null;
  superseded_by_booking_id?: string | null;
  booking_status?: string | null;
};

export function sameBookingScope(predecessor: BookingLineageFields, successor: BookingLineageFields) {
  return Boolean(predecessor.user_id && successor.user_id && predecessor.trip_id && successor.trip_id) &&
    predecessor.user_id === successor.user_id && predecessor.trip_id === successor.trip_id;
}

/** The single operational-current rule for booking truth. */
export function isOperationalCurrentBooking(booking: BookingLineageFields) {
  return booking.superseded_by_booking_id == null;
}

export function supersessionWouldCreateCycle(
  bookings: Array<Pick<BookingLineageFields, "id" | "superseded_by_booking_id">>,
  predecessorId: string,
  successorId: string
) {
  if (predecessorId === successorId) return true;
  const nextById = new Map(bookings.map((booking) => [booking.id, booking.superseded_by_booking_id]));
  let current: string | null | undefined = successorId;
  const visited = new Set<string>();
  while (current) {
    if (current === predecessorId || visited.has(current)) return true;
    visited.add(current);
    current = nextById.get(current);
  }
  return false;
}
