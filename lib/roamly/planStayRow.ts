// lib/roamly/planStayRow.ts — DISPLAY-ONLY stay-row evidence guard
// (consistency repairs, 2026-10-28).
//
// OWNER RULE (item 4): the plan's hotel check-in row is an
// activity, never a confirmed reservation. Roamly must never
// present it — or any other unverified plan stay row — as
// Confirmed/Booked. A plan stay row is identified from the row
// itself (stored plan shape from lib/roamly/engine/generate.ts
// `staySeed`): item_type "hotel" AND one of the stay-seed shapes
// — a "Check-in"/"Check-out" time label, a "Check in at X —
// your base for this trip." description, a "Return to X for the
// night." description, or the "Return to your stay" title.
// A confirmed BOOKING row is a different object (it comes from
// the bookings table, not the plan) and is unaffected: this guard
// only stops the plan row from being PROMOTED to confirmed by a
// title match in `applyConfirmedBookings`. When a confirmed
// booking matches a plan stay row, the booking is treated as
// consumed (so it is NOT appended as a second row) but the plan
// row keeps its plan authority and its plan time — the row still
// reads as a Planned/arrival activity, never as a reservation.
// Pure functions: no I/O, no mutation.

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type PlanStayRowInput = {
  itemType?: string | null;
  category?: string | null;
  time?: string | null;
  title?: string | null;
  description?: string | null;
};

/** True for a plan stay row (check-in, check-out, or return to
 *  the stay) — the rows that must never read as confirmed. */
export function isPlanStayRow(row: PlanStayRowInput): boolean {
  const type = `${text(row.itemType)} ${text(row.category)}`.toLowerCase();
  if (!/\b(hotel|hostel|lodging|stay|accommodation)\b/.test(type)) return false;
  const time = text(row.time);
  if (/^(check-?in|check-?out)\b/i.test(time)) return true;
  const title = text(row.title);
  if (/^return to your stay$/i.test(title)) return true;
  const desc = text(row.description);
  if (/^check in at .+? — your base for this trip\.?$/i.test(desc)) return true;
  if (/^return to .+? for the night\.?$/i.test(desc)) return true;
  return false;
}
