/**
 * Builder-L (2026-10-25): booking-level test/QA detection.
 *
 * There is no stored is_test / is_qa column on roamly_bookings, so
 * retroactive detection can only use what a row already carries: its
 * title / provider text, plus the durable metadata.qa_test flag that
 * createTripBooking now stamps on NEW rows written under a QA-tester
 * trip (see lib/roamly/bookingWallet.ts). This predicate is display
 * only — it never deletes, re-statuses, or rewrites a booking row.
 *
 * The coordinator wires this predicate into the Alerts feed rows at
 * integration; the wallet timeline uses it in customerStatus below.
 * Callers pass whatever metadata they have (it may be absent — the
 * serialized wallet record does not carry metadata today, so the
 * title/provider pattern is the retroactive catch for existing rows).
 */

export const testBookingLabel = "Test booking — not a real reservation";

const TEST_BOOKING_PATTERN = /\bQA\b|test stay|test provider/i;

export function isTestBooking(input: {
  title?: string | null;
  provider?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (input.metadata && typeof input.metadata === "object" && input.metadata.qa_test === true) {
    return true;
  }
  if (typeof input.title === "string" && TEST_BOOKING_PATTERN.test(input.title)) {
    return true;
  }
  if (typeof input.provider === "string" && TEST_BOOKING_PATTERN.test(input.provider)) {
    return true;
  }
  return false;
}
