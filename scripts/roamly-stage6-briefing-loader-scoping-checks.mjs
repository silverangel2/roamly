// Stage 6 checks — companion-briefing loader scoping (2026-11-11).
//
// Stage 3 settlement (d) named lib/roamly/companionBriefings.ts's
// loadTripBookings as the one booking read path filtering trip_id
// ONLY, through the service-role client (RLS bypassed), while the
// money/itinerary reads and every sibling briefing loader filter
// user_id AND trip_id. Stage 6 verdict: the loader's only caller
// (scheduleCompanionBriefings) iterates trip rows and always holds
// trip.user_id, so the loader is now scoped at the loader — a
// booking whose trip_id points at another traveller's trip (the
// repoint shape) can no longer enter that traveller's briefing,
// and neither can a foreign repair proposal inflate its count.
// Runtime proof against an in-memory fake store; no network.
import assert from "node:assert/strict";

delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { loadTripBookings, unresolvedRepairCount } = await import(
  "../lib/roamly/companionBriefings.ts"
);

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

/* ------------------------------------------------ in-memory fake */
function makeFake(tables) {
  function query(table) {
    const filters = [];
    const builder = {
      select() { return builder; },
      eq(field, value) { filters.push((row) => row[field] === value); return builder; },
      neq(field, value) { filters.push((row) => row[field] !== value); return builder; },
      is(field, value) { filters.push((row) => (row[field] ?? null) === value); return builder; },
      in(field, values) { filters.push((row) => values.includes(row[field])); return builder; },
      order() { return builder; },
      limit() { return builder; },
      then(resolve, reject) {
        try {
          const rows = (tables[table] || []).filter((row) => filters.every((f) => f(row)));
          resolve({ data: rows, error: null });
        } catch (error) {
          reject(error);
        }
      }
    };
    return builder;
  }
  return { from: (table) => query(table) };
}

const TRIP = "trip-stage6";
const OWNER = "user-owner";
const FOREIGN = "user-foreign";
const TODAY = "2026-11-11";

function booking(overrides) {
  return {
    id: "b-own",
    trip_id: TRIP,
    user_id: OWNER,
    booking_type: "flight",
    booking_status: "booked",
    title: "Fixture flight",
    provider_name: "Fixture Air",
    start_at: "2026-11-11T15:00:00.000Z",
    end_at: null,
    check_in_at: null,
    check_out_at: null,
    flight_number: "FA100",
    terminal: "1",
    gate: "A1",
    superseded_by_booking_id: null,
    ...overrides
  };
}

const tables = {
  roamly_bookings: [
    booking({ id: "b-own" }),
    // THE PIN: same trip_id, another traveller's user_id — the
    // repointed-booking shape. Trip-only filtering would read it
    // into the owner's briefing.
    booking({ id: "b-foreign", user_id: FOREIGN, title: "Foreign booking", flight_number: "XX999" }),
    booking({ id: "b-superseded", superseded_by_booking_id: "b-own" }),
    booking({ id: "b-wrong-status", booking_status: "confirmed" }),
    booking({ id: "b-tomorrow", start_at: "2026-11-12T15:00:00.000Z" })
  ],
  companion_repair_proposals: [
    { id: "p-own-open", trip_id: TRIP, user_id: OWNER, status: "proposed" },
    { id: "p-foreign-open", trip_id: TRIP, user_id: FOREIGN, status: "proposed" },
    { id: "p-own-done", trip_id: TRIP, user_id: OWNER, status: "applied" }
  ]
};

const fake = makeFake(tables);

const bookings = await loadTripBookings(fake, TRIP, OWNER, TODAY, "UTC");
eq(bookings.length, 1, "only the owner's own today booking enters the briefing");
eq(bookings[0]?.id, "b-own", "the included booking is the owner's");
eq(
  bookings.some((row) => row.id === "b-foreign"),
  false,
  "a foreign booking repointed at this trip is excluded"
);

const repairs = await unresolvedRepairCount(fake, TRIP, OWNER);
eq(repairs, 1, "repair count includes only the owner's unresolved proposal");

console.log(`Stage 6 briefing-loader-scoping checks passed (${count} assertions).`);
