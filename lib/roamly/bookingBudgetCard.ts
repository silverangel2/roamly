// Committed-budget math for the wallet budget card (B13). Pure module (no
// server imports) so the card and the check scripts share one implementation.
//
// Canonical confirmation, mirroring isConfirmedBooking in
// lib/roamly/bookingWallet.ts: operational-current + traveler-confirmed +
// a confirmed status. Both status vocabularies are accepted because the card
// sees raw roamly_bookings rows from the trip page (booked/paid/reserved)
// and serialized wallet rows after a reload (confirmed/modified/completed).
// Pending rows, cancelled rows, superseded rows, and rows with unknown
// amounts never count as committed cost. Totals are grouped per currency —
// amounts in different currencies are never summed into one number.

export const CONFIRMED_BUDGET_STATUSES = new Set([
  "confirmed",
  "modified",
  "completed",
  "booked",
  "paid",
  "reserved"
]);

export type BudgetBookingLike = {
  booking_status?: string | null;
  traveler_confirmed?: boolean | null;
  superseded_by_booking_id?: string | null;
  amount_cents?: number | null;
  total_price?: number | null;
  currency?: string | null;
};

export function isConfirmedBudgetBooking(booking: BudgetBookingLike): boolean {
  return (
    booking.superseded_by_booking_id == null &&
    booking.traveler_confirmed === true &&
    CONFIRMED_BUDGET_STATUSES.has(booking.booking_status || "")
  );
}

export function groupConfirmedBudgetTotals(bookings: BudgetBookingLike[]): {
  confirmedCount: number;
  totals: Array<{ currency: string; cents: number }>;
} {
  const confirmed = bookings.filter(isConfirmedBudgetBooking);
  const byCurrency = new Map<string, number>();
  for (const booking of confirmed) {
    const cents =
      typeof booking.amount_cents === "number"
        ? booking.amount_cents
        : typeof booking.total_price === "number"
          ? Math.round(booking.total_price * 100)
          : null;
    if (cents == null) continue;
    const currency = (booking.currency || "XXX").toUpperCase();
    byCurrency.set(currency, (byCurrency.get(currency) || 0) + cents);
  }
  return {
    confirmedCount: confirmed.length,
    totals: [...byCurrency.entries()].map(([currency, cents]) => ({ currency, cents }))
  };
}
