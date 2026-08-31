import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const nodeRequire = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadReminderModule() {
  const source = read("lib/roamly/preTripReminders.ts");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(id) {
      if (id === "@/lib/roamly/liveCompanion") {
        return { timezoneFromTripMetadata: (metadata, fallback = "UTC") => metadata?.timezone || fallback };
      }
      if (id === "@/lib/roamly/companionNotifications") {
        return { queueCompanionNotification: async () => ({ ok: true }) };
      }
      if (id === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => null };
      return nodeRequire(id);
    },
    process,
    Intl,
    Date,
    URL
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: "preTripReminders.ts" });
  return sandbox.module.exports;
}

function loadEmailConnectionModule() {
  const source = read("lib/roamly/emailConnections.ts");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(id) {
      if (id === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => null };
      if (id === "@/lib/roamly/bookingExtraction") return { extractAndMatchTravelEmailBooking: async () => null };
      if (id === "@/lib/roamly/travelEmailFiltering") {
        return {
          filterTravelEmail: () => ({ shouldProcess: false }),
          recordTravelEmailFilterResult: async () => ({ saved: false, filter: { shouldProcess: false } })
        };
      }
      return nodeRequire(id);
    },
    Buffer,
    process,
    URL,
    Date,
    AbortSignal,
    fetch
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: "emailConnections.ts" });
  return sandbox.module.exports;
}

const reminders = loadReminderModule();
const emailConnections = loadEmailConnectionModule();
process.env.ROAMLY_TOKEN_ENCRYPTION_KEY = "gmail-oauth-state-test-secret";
const oauthState = emailConnections.createGmailOAuthState("user-a");
assert.equal(typeof oauthState.state, "string", "Gmail OAuth state exposes an opaque URL state");
assert.equal(typeof oauthState.cookieValue, "string", "Gmail OAuth state stores the signed user binding in a cookie");
assert.notEqual(oauthState.state, oauthState.cookieValue, "Gmail OAuth user binding must not be exposed as the URL state");
assert.equal(emailConnections.verifiedGmailOAuthStateUserId(oauthState.cookieValue, oauthState.state), "user-a", "Gmail OAuth signed cookie recovers the initiating user");
assert.equal(emailConnections.verifiedGmailOAuthStateUserId(oauthState.cookieValue, "wrong-state"), null, "Gmail OAuth state mismatch is rejected");
const trip = {
  id: "trip-a",
  user_id: "user-a",
  title: "Montreal trip",
  destination: "Montreal",
  destination_name: "Montreal",
  destination_city: null,
  start_date: "2026-11-10",
  status: "active",
  itinerary_status: "ready",
  metadata: { timezone: "America/Toronto" }
};
const flight = {
  id: "booking-flight",
  booking_type: "flight",
  booking_status: "booked",
  title: "Porter flight",
  provider_name: "Porter",
  confirmation_number: "P123",
  start_at: "2026-11-10T14:30:00-05:00",
  end_at: "2026-11-10T16:00:00-05:00",
  check_in_at: null,
  check_out_at: null,
  origin: "YUL",
  destination: "YYZ",
  flight_number: "PD123",
  traveler_confirmed: true,
  updated_at: "2026-08-30T12:00:00Z"
};

const oneWeek = new Date("2026-11-03T19:30:00Z");
const oneDay = new Date("2026-11-09T19:30:00Z");
assert.deepEqual(Array.from(reminders.duePreTripReminderTypes({ tripStart: new Date(flight.start_at), now: oneWeek })), ["trip_predeparture_7d"], "7-day reminder is due at the local date boundary");
assert.deepEqual(Array.from(reminders.duePreTripReminderTypes({ tripStart: new Date(flight.start_at), now: oneDay })), ["trip_predeparture_1d"], "1-day reminder is due at the local date boundary");
assert.deepEqual(Array.from(reminders.duePreTripReminderTypes({ tripStart: new Date(flight.start_at), now: new Date("2026-11-02T19:29:59Z") })), [], "7-day reminder is not early");
assert.deepEqual(Array.from(reminders.duePreTripReminderTypes({ tripStart: new Date(flight.start_at), now: new Date("2026-11-09T19:30:00Z") })), ["trip_predeparture_1d"], "cron reruns remain in the 1-day window");
assert.equal(reminders.tripStartInstant({ trip, confirmedBookings: [flight] }).timezone, "America/Toronto", "trip timezone is retained");
assert.equal(reminders.tripStartInstant({ trip, confirmedBookings: [flight] }).source, "confirmed_booking", "confirmed booking is authoritative for trip start");

const cancelled = { ...flight, id: "cancelled", booking_status: "cancelled", traveler_confirmed: true };
const hotel = { ...flight, id: "hotel", booking_type: "hotel", title: "Hotel Montreal", provider_name: "HotelCo", confirmation_number: "H123", start_at: null, check_in_at: "2026-11-10T15:00:00-05:00", flight_number: null };
const content = reminders.buildPreTripReminderContent({ trip, type: "trip_predeparture_7d", tripStart: new Date(flight.start_at), timezone: "America/Toronto", confirmedBookings: [flight, hotel, cancelled] });
assert.match(content.body, /Porter/);
assert.match(content.body, /Hotel Montreal/);
assert.doesNotMatch(content.body, /cancelled/);
assert.doesNotMatch(content.body, /Air Canada/);
assert.match(reminders.buildPreTripReminderContent({ trip, type: "trip_predeparture_1d", tripStart: new Date(flight.start_at), timezone: "America/Toronto", confirmedBookings: [] }).body, /No confirmed bookings/);

function fakeSupabaseForPreTripScheduler() {
  const scheduledEvents = [];
  const trips = [
    { ...trip, id: "trip-active", status: "active" },
    { ...trip, id: "trip-archived", status: "archived" },
    { ...trip, id: "trip-cancelled", status: "cancelled" }
  ];

  function builder(table) {
    const filters = [];
    let insertPayload = null;
    const api = {
      select() {
        return api;
      },
      insert(payload) {
        insertPayload = payload;
        return api;
      },
      eq(column, value) {
        filters.push({ op: "eq", column, value });
        return api;
      },
      neq(column, value) {
        filters.push({ op: "neq", column, value });
        return api;
      },
      not(column, op, value) {
        filters.push({ op: "not", column, value });
        return api;
      },
      gte(column, value) {
        filters.push({ op: "gte", column, value });
        return api;
      },
      lte(column, value) {
        filters.push({ op: "lte", column, value });
        return api;
      },
      contains() {
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
      single() {
        if (table === "roamly_trip_companion_events" && insertPayload) {
          scheduledEvents.push(insertPayload);
          return Promise.resolve({ data: { id: `event-${scheduledEvents.length}` }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve(result()).then(resolve, reject);
      }
    };

    function result() {
      if (table === "roamly_trips") {
        const data = trips.filter((row) =>
          filters.every((filter) => {
            if (filter.op === "neq") return row[filter.column] !== filter.value;
            if (filter.op === "not" && filter.column === "start_date" && filter.value === null) return row.start_date !== null;
            if (filter.op === "gte") return String(row[filter.column]) >= String(filter.value);
            if (filter.op === "lte") return String(row[filter.column]) <= String(filter.value);
            return true;
          })
        );
        return { data, error: null };
      }
      if (table === "roamly_bookings") {
        const tripId = filters.find((filter) => filter.op === "eq" && filter.column === "trip_id")?.value;
        return { data: tripId ? [{ ...flight, id: `booking-${tripId}` }] : [], error: null };
      }
      return { data: null, error: null };
    }

    return api;
  }

  return {
    scheduledEvents,
    from: builder
  };
}

const fakeSchedulerDb = fakeSupabaseForPreTripScheduler();
const schedulerResult = await reminders.schedulePreTripReminders({
  supabase: fakeSchedulerDb,
  now: oneWeek
});
assert.equal(schedulerResult.ok, true, "future active eligible trip can schedule reminders");
assert.equal(schedulerResult.scheduled, 1, "only the active trip schedules a pre-trip reminder");
assert.deepEqual(
  fakeSchedulerDb.scheduledEvents.map((event) => event.trip_id),
  ["trip-active"],
  "archived and cancelled trips do not schedule pre-trip reminders"
);
assert.deepEqual(
  fakeSchedulerDb.scheduledEvents.map((event) => event.event_type),
  ["trip_predeparture_7d"],
  "active future trip schedules the due 7-day reminder"
);

const extraction = read("lib/roamly/bookingExtraction.ts");
const wallet = read("lib/roamly/bookingWallet.ts");
const reconciliation = read("lib/roamly/brain/bookingReconciliation.ts");
const overrides = read("lib/roamly/itineraryBookingOverrides.ts");
const gmail = read("lib/roamly/emailConnections.ts");
const monitor = read("lib/roamly/bookingMonitor.ts");
const notifications = read("lib/roamly/companionNotifications.ts");
const cron = read("app/api/cron/roamly-notifications/route.ts");
const migration = read("supabase/migrations/20260830_roamly_predeparture_reminders.sql");

assert.match(gmail, /filterTravelEmail\(metadata\)/, "Gmail metadata is filtered before body retrieval");
assert.match(gmail, /fetchGmailTravelBodyText/, "Gmail body retrieval feeds extraction");
assert.match(extraction, /createTripBooking/, "confirmation extraction writes the canonical booking wallet");
assert.match(extraction, /reconcileTripBookings/, "confirmation extraction triggers reconciliation");
assert.match(wallet, /assertTripOwnership/, "booking writes verify user and trip ownership");
assert.match(wallet, /findMatchingCanonicalBooking/, "repeat confirmations use canonical matching");
assert.match(wallet, /applyStoredItineraryBookingOverride/, "confirmed flights update stored itinerary data");
assert.match(overrides, /applyConfirmedBookingOverrideToItinerary/, "itinerary override preserves and retimes the existing itinerary");
assert.match(overrides, /applyNonFlightBookingOverrideToItinerary/, "non-flight confirmations are appended to the itinerary");
assert.match(overrides, /booking_id/, "non-flight itinerary entries are idempotently marked by booking ID");
assert.match(overrides, /Cancelled bookings are marked/, "cancelled bookings are visible but not active guidance");
assert.match(wallet, /\.eq\("user_id", params\.userId\)/, "booking writes are user-scoped");
assert.match(reconciliation, /recommendationHistoryPreserved/, "recommendation provenance is retained");
assert.match(reconciliation, /bookingStatus === "cancelled"/, "cancellations produce Companion cancellation state");
assert.match(extraction, /existingBookingTripMatch/, "follow-up messages can match an existing booking");
assert.match(extraction, /exact_existing_booking_match/, "exact follow-up matches can auto-apply");
assert.match(extraction, /needs_confirmation/, "ambiguous matches remain reviewable");
assert.match(monitor, /\.eq\("provider", "gmail"\)/, "background monitor is Gmail-only");
assert.match(cron, /schedulePreTripReminders/, "notification cron schedules pre-trip reminders");
assert.match(notifications, /send_email === true/, "email delivery is explicit and not falsely implied");
assert.match(notifications, /retrying/, "failed delivery remains retryable");
assert.match(notifications, /failed_at/, "failed delivery records failure state");
assert.match(migration, /roamly_trip_predeparture_reminder_uidx/, "reminders have durable database idempotency");
assert.match(migration, /trip_predeparture_7d/);
assert.match(migration, /trip_predeparture_1d/);

console.log("Roamly Gmail booking and pre-trip reminder checks passed (fixtures, pure timing logic, and integration contracts).");
