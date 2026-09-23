type BookingEvidence = {
  title?: unknown;
  booking_status?: unknown;
  status?: unknown;
  traveler_confirmed?: unknown;
  superseded_by_booking_id?: unknown;
};

function normalizedTitle(value: unknown) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bookingIsConfirmed(booking: BookingEvidence) {
  if (booking.superseded_by_booking_id != null) return false;
  const status = typeof (booking.booking_status || booking.status) === "string"
    ? String(booking.booking_status || booking.status).trim().toLowerCase()
    : "";
  return booking.traveler_confirmed === true || ["confirmed", "booked", "ticketed", "issued"].includes(status);
}

/** True only when a timeline title exactly identifies a current, confirmed traveler booking. */
export function isConfirmedItineraryBookingAnchor(title: string, bookings: readonly BookingEvidence[]) {
  const normalized = normalizedTitle(title);
  if (!normalized) return false;
  return bookings.some((booking) => bookingIsConfirmed(booking) && normalizedTitle(booking.title) === normalized);
}
