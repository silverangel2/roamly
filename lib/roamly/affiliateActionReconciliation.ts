export type AffiliateActionCategory = "flight" | "hotel" | "activity" | "attraction" | "tour" | "product" | "transport" | string;

export type ConfirmedBookingEvidence = {
  trip_id?: string | null;
  booking_type?: string | null;
  booking_status?: string | null;
  title?: string | null;
  provider_name?: string | null;
  origin?: string | null;
  destination?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  flight_number?: string | null;
  address?: string | null;
  city?: string | null;
};

export type AffiliateActionEvidence = {
  tripId?: string | null;
  category: AffiliateActionCategory;
  title?: string | null;
  origin?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  flightNumber?: string | null;
  address?: string | null;
  city?: string | null;
};

export type AffiliateActionReconciliation = {
  decision: "ALLOW" | "SUPPRESS" | "UNRESOLVED";
  reason: "NO_CONFIRMED_BOOKING" | "CONFIRMED_FLIGHT_NEED_SATISFIED" | "CONFIRMED_HOTEL_NEED_SATISFIED" | "CONFIRMED_ACTIVITY_MATCH" | "WRONG_TRIP" | "OUTSIDE_CONFIRMED_CONTEXT" | "CONFIRMED_CONTEXT_UNRESOLVED";
};

const confirmedStatuses = new Set(["booked", "paid", "reserved", "confirmed", "modified", "completed"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function exact(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function date(value: unknown) {
  return text(value).slice(0, 10);
}

function bookingDate(booking: ConfirmedBookingEvidence) {
  return date(booking.start_date || booking.start_at || booking.start_time);
}

function category(value: unknown) {
  const normalized = exact(value);
  return normalized === "attraction" || normalized === "tour" ? "activity" : normalized;
}

function confirmedForTrip(booking: ConfirmedBookingEvidence, tripId?: string | null) {
  if (tripId && booking.trip_id && booking.trip_id !== tripId) return "WRONG_TRIP" as const;
  return confirmedStatuses.has(exact(booking.booking_status)) ? true : false;
}

function flightMatches(action: AffiliateActionEvidence, booking: ConfirmedBookingEvidence) {
  const actionFlight = exact(action.flightNumber).replace(/\s+/g, "");
  const bookingFlight = exact(booking.flight_number).replace(/\s+/g, "");
  if (actionFlight && bookingFlight) return actionFlight === bookingFlight && date(action.startDate) === bookingDate(booking);
  const routeMatches = Boolean(
    exact(action.origin) && exact(action.destination) &&
    exact(action.origin) === exact(booking.origin) &&
    exact(action.destination) === exact(booking.destination)
  );
  return routeMatches && Boolean(date(action.startDate) && date(action.startDate) === bookingDate(booking));
}

function hotelMatches(action: AffiliateActionEvidence, booking: ConfirmedBookingEvidence) {
  const titleMatches = Boolean(exact(action.title) && exact(action.title) === exact(booking.title));
  const addressMatches = Boolean(exact(action.address) && exact(action.address) === exact(booking.address));
  const datesProvided = Boolean(date(action.startDate) || date(action.endDate) || booking.start_date || booking.end_date || booking.start_at || booking.end_at);
  const datesMatch = !datesProvided || (
    (!date(action.startDate) || date(action.startDate) === date(booking.start_date || booking.start_at)) &&
    (!date(action.endDate) || date(action.endDate) === date(booking.end_date || booking.end_at))
  );
  return (titleMatches || addressMatches) && datesMatch;
}

function activityMatches(action: AffiliateActionEvidence, booking: ConfirmedBookingEvidence) {
  if (!exact(action.title) || exact(action.title) !== exact(booking.title)) return false;
  if (date(action.startDate) && booking.start_date && date(action.startDate) !== date(booking.start_date)) return false;
  if (exact(action.city) && exact(booking.city) && exact(action.city) !== exact(booking.city)) return false;
  return true;
}

export function reconcileAffiliateAction(
  action: AffiliateActionEvidence,
  bookings: ConfirmedBookingEvidence[] | null | undefined
): AffiliateActionReconciliation {
  const relevant = (bookings || []).filter((booking) => category(booking.booking_type) === category(action.category));
  if (!relevant.length) return { decision: "ALLOW", reason: "NO_CONFIRMED_BOOKING" };

  let sawWrongTrip = false;
  const confirmed = relevant.filter((booking) => {
    const state = confirmedForTrip(booking, action.tripId);
    if (state === "WRONG_TRIP") sawWrongTrip = true;
    return state === true;
  });
  if (!confirmed.length) return { decision: "ALLOW", reason: sawWrongTrip ? "WRONG_TRIP" : "NO_CONFIRMED_BOOKING" };

  if (category(action.category) === "flight") {
    if (confirmed.some((booking) => flightMatches(action, booking))) return { decision: "SUPPRESS", reason: "CONFIRMED_FLIGHT_NEED_SATISFIED" };
    return { decision: "UNRESOLVED", reason: "OUTSIDE_CONFIRMED_CONTEXT" };
  }
  if (category(action.category) === "hotel") {
    if (confirmed.some((booking) => hotelMatches(action, booking))) return { decision: "SUPPRESS", reason: "CONFIRMED_HOTEL_NEED_SATISFIED" };
    return { decision: "UNRESOLVED", reason: "OUTSIDE_CONFIRMED_CONTEXT" };
  }
  if (category(action.category) === "activity") {
    if (confirmed.some((booking) => activityMatches(action, booking))) return { decision: "SUPPRESS", reason: "CONFIRMED_ACTIVITY_MATCH" };
    return { decision: "UNRESOLVED", reason: "CONFIRMED_CONTEXT_UNRESOLVED" };
  }
  return { decision: "UNRESOLVED", reason: "CONFIRMED_CONTEXT_UNRESOLVED" };
}

export function confirmedNeedSatisfied(categoryValue: AffiliateActionCategory, bookings: ConfirmedBookingEvidence[] | null | undefined, tripId?: string | null) {
  const normalized = category(categoryValue);
  if (normalized !== "flight" && normalized !== "hotel") return false;
  return (bookings || []).some((booking) =>
    category(booking.booking_type) === normalized && confirmedForTrip(booking, tripId) === true
  );
}
