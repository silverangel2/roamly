import { isBookingClickOnly, isConfirmedBooking, type TripBookingRecord } from "@/lib/roamly/bookingWallet";

export type BookingOutcomeState =
  | "UNBOOKED"
  | "REFERRED"
  | "AWAITING_CONFIRMATION"
  | "CONFIRMED"
  | "NEEDS_REVIEW";

export type BookingOutcomeReferral = {
  id: string;
  trip_id: string;
  recommendation_id?: string | null;
  category?: string | null;
  provider?: string | null;
  created_at?: string | null;
};

export type BookingOutcomeInput = {
  tripId: string;
  category: string;
  recommendationId?: string | null;
  booking?: TripBookingRecord | null;
  bookings?: TripBookingRecord[];
  referrals?: BookingOutcomeReferral[];
  conflictingEvidence?: boolean;
};

export type BookingOutcome = {
  state: BookingOutcomeState;
  reason: "canonical_confirmation" | "canonical_review" | "canonical_pending" | "tracked_referral" | "no_booking_evidence";
  referralId?: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function canonicalCategory(value: string | null | undefined) {
  const category = clean(value);
  return category === "attraction" || category === "tour" ? "activity" : category;
}

function sameCategory(left: string | null | undefined, right: string) {
  return (canonicalCategory(left) || "other") === (canonicalCategory(right) || "other");
}

function bookingMatches(input: BookingOutcomeInput, booking: TripBookingRecord) {
  if (booking.trip_id !== input.tripId || !sameCategory(booking.booking_type, input.category)) return false;
  if (input.recommendationId && booking.recommendation_id) return input.recommendationId === booking.recommendation_id;
  if (input.referrals?.some((referral) => referral.id === booking.affiliate_click_id)) return true;
  return !input.recommendationId;
}

export function deriveBookingOutcome(input: BookingOutcomeInput): BookingOutcome {
  const matchingBookings = [input.booking, ...(input.bookings || [])]
    .filter((booking): booking is TripBookingRecord => Boolean(booking))
    .filter((booking, index, all) => all.findIndex((candidate) => candidate.id === booking.id) === index)
    .filter((booking) => bookingMatches(input, booking));

  if (input.conflictingEvidence) return { state: "NEEDS_REVIEW", reason: "canonical_review" };

  if (matchingBookings.some(isConfirmedBooking)) {
    return { state: "CONFIRMED", reason: "canonical_confirmation" };
  }

  if (matchingBookings.some((booking) => booking.booking_status === "detected" || booking.booking_status === "needs_confirmation")) {
    return { state: "AWAITING_CONFIRMATION", reason: "canonical_pending" };
  }

  if (matchingBookings.some(isBookingClickOnly)) {
    return { state: "REFERRED", reason: "tracked_referral" };
  }

  const referral = (input.referrals || []).find((candidate) =>
    candidate.trip_id === input.tripId &&
    sameCategory(candidate.category, input.category) &&
    (!input.recommendationId || candidate.recommendation_id === input.recommendationId)
  );
  if (referral) return { state: "REFERRED", reason: "tracked_referral", referralId: referral.id };

  return { state: "UNBOOKED", reason: "no_booking_evidence" };
}

export function bookingOutcomeLabel(outcome: BookingOutcome) {
  if (outcome.state === "CONFIRMED") return "Confirmed";
  if (outcome.state === "AWAITING_CONFIRMATION") return "Awaiting confirmation";
  if (outcome.state === "REFERRED") return "Referred · not confirmed";
  if (outcome.state === "NEEDS_REVIEW") return "Needs review";
  return "Not booked";
}
