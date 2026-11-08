// Travel-day lifecycle checks for the Live Companion fix (2026-11-06).
//
// Runs the REAL lib/roamly/tripCompanion.ts (scheduleCompanionEvents)
// and the REAL dispatcher (lib/roamly/pushServer.ts
// sendScheduledTripNotifications — the exact function the production
// queue cron calls) against an in-process PostgREST fake, reproducing
// the production failure proven on 2026-11-06: a trip unlocked
// mid-window ended with ZERO future-scheduled companion events (the
// one-shot batch ended at day 1 and every past-due row was terminally
// consumed), so the companion produced nothing for the rest of the
// trip. These checks pin the reconciled behaviour:
//   S1 mid-window unlock: elapsed days recorded skipped at creation,
//      today catch-up-scheduled due at the creation instant (or at
//      its natural time when that is still ahead — the fire time is
//      never pushed out past either), later days scheduled at their
//      natural times; nothing fires early; today's event fires in
//      the first dispatch that starts after it exists; later days
//      stay armed; idempotent.
//   S2 a gate-killed event for today is resurrected by the next
//      reconcile; an elapsed-day corpse is NOT duplicated.
//   S3 pre-trip creation: past-due stage events clamp for catch-up
//      delivery, nothing is born skipped or shown.
//   S4 locked trip still refuses scheduling (unchanged gate).
//   S5 a trip starting today keeps day-1 coverage and gains the
//      remaining days exactly once.
// Email provider: capture mode (accepts), as in the burst suite.
// Time passage is simulated by moving a row's scheduled_for to now —
// the same operation the production QA rewind seam performs; every
// such step is labelled in the output.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
function createFakeSupabase() {
  const state = {
    users: new Map(),
    tables: new Map()
  };
  const table = (name) => {
    if (!state.tables.has(name)) state.tables.set(name, []);
    return state.tables.get(name);
  };
  function accessor(row, key) {
    const jsonMatch = /^(.+)->>(.+)$/.exec(key);
    if (jsonMatch) {
      const parent = row[jsonMatch[1]];
      return parent && typeof parent === "object" ? parent[jsonMatch[2]] : undefined;
    }
    return row[key];
  }
  function matches(row, params) {
    for (const [key, raw] of params.entries()) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      const dot = raw.indexOf(".");
      const op = dot > 0 ? raw.slice(0, dot) : "eq";
      const value = dot > 0 ? raw.slice(dot + 1) : raw;
      const actual = accessor(row, key);
      if (op === "eq" && String(actual) !== value) return false;
      if (op === "neq" && String(actual) === value) return false;
      if (op === "is") {
        if (value === "null" && actual !== null && actual !== undefined) return false;
        if (value === "true" && actual !== true) return false;
        if (value === "false" && actual !== false) return false;
      }
      if (op === "lt" && !(String(actual) < value)) return false;
      if (op === "lte" && !(String(actual) <= value)) return false;
      if (op === "gt" && !(String(actual) > value)) return false;
      if (op === "gte" && !(String(actual) >= value)) return false;
      if (!["eq", "neq", "is", "lt", "lte", "gt", "gte"].includes(op)) {
        throw new Error(`fake supabase: unsupported filter operator "${op}"`);
      }
    }
    return true;
  }
  function applyOrder(rows, params) {
    const order = params.get("order");
    if (!order) return rows;
    const keys = order.split(",").map((part) => {
      const [col, dir] = part.split(".");
      return { col, desc: dir === "desc" };
    });
    return [...rows].sort((a, b) => {
      for (const { col, desc } of keys) {
        const av = accessor(a, col);
        const bv = accessor(b, col);
        if (av === bv) continue;
        if (av === null || av === undefined) return desc ? -1 : 1;
        if (bv === null || bv === undefined) return desc ? 1 : -1;
        const cmp = String(av) < String(bv) ? -1 : 1;
        return desc ? -cmp : cmp;
      }
      return 0;
    });
  }
  function respond(req, res, status, rows) {
    const accept = String(req.headers.accept || "");
    const wantsObject = accept.includes("application/vnd.pgrst.object+json");
    let body;
    if (wantsObject && Array.isArray(rows)) {
      body = rows.length === 1 ? rows[0] : rows;
    } else {
      body = rows;
    }
    const text = body === undefined || body === null ? "" : JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://fake.local");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : null;

      const adminUser = /^\/auth\/v1\/admin\/users\/(.+)$/.exec(url.pathname);
      if (adminUser && req.method === "GET") {
        const user = state.users.get(decodeURIComponent(adminUser[1]));
        if (!user) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ code: "user_not_found", message: "User not found" }));
        }
        return respond(req, res, 200, { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", user_metadata: {}, created_at: user.created_at });
      }

      const rest = /^\/rest\/v1\/(.+)$/.exec(url.pathname);
      if (!rest) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ code: "not_found", message: `no fake route for ${req.method} ${url.pathname}` }));
      }
      const rows = table(decodeURIComponent(rest[1]));
      const params = url.searchParams;
      const prefer = String(req.headers.prefer || "");
      const wantsRepresentation = prefer.includes("return=representation");

      if (req.method === "GET") {
        let out = rows.filter((row) => matches(row, params));
        out = applyOrder(out, params);
        const limit = Number(params.get("limit"));
        if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit);
        return respond(req, res, 200, out);
      }
      if (req.method === "POST") {
        const incoming = Array.isArray(body) ? body : [body];
        const stored = incoming.map((row) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...row
        }));
        rows.push(...stored);
        if (!wantsRepresentation) {
          res.writeHead(201);
          return res.end("");
        }
        return respond(req, res, 201, stored);
      }
      if (req.method === "PATCH") {
        const targets = rows.filter((row) => matches(row, params));
        for (const row of targets) Object.assign(row, body || {});
        if (!wantsRepresentation) {
          res.writeHead(204);
          return res.end("");
        }
        return respond(req, res, 200, targets);
      }
      res.writeHead(405, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: "method", message: "unsupported" }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ code: "fake_error", message: error instanceof Error ? error.message : String(error) }));
    }
  });
  return {
    state,
    table,
    reset() {
      state.users.clear();
      state.tables.clear();
    },
    listen() {
      return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
    },
    close() {
      return new Promise((resolve) => server.close(resolve));
    }
  };
}


// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function eq(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const ROOT = process.env.ROAMLY_TEST_ROOT
  ? path.resolve(process.env.ROAMLY_TEST_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fake = createFakeSupabase();
const port = await fake.listen();

process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
process.env.ROAMLY_EMAIL_CAPTURE_ENABLED = "true";
delete process.env.ROAMLY_DAILY_TEST_EMAIL;

const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, "stub-service-key", { auth: { persistSession: false } });
const { scheduleCompanionEvents } = await import(pathToFileURL(path.join(ROOT, "lib/roamly/tripCompanion.ts")).href);
const { sendScheduledTripNotifications } = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushServer.ts")).href);

const USER_ID = "22222222-2222-4222-8222-222222222222";
const dayMs = 86400_000;
const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
const dateOnly = (d) => d.toISOString().slice(0, 10);
const shift = (base, days) => new Date(base.getTime() + days * dayMs);
const atNine = (d) => `${dateOnly(d)}T09:00:00.000Z`;

function seedUser() {
  fake.state.users.set(USER_ID, { id: USER_ID, email: "traveler@roamlyhq.com", created_at: new Date(Date.now() - dayMs).toISOString() });
}
function seedTrip(tripId, { start, end, unlocked = true }) {
  fake.table("roamly_trips").push({
    id: tripId, user_id: USER_ID,
    title: "Montreal, Canada trip",
    destination: "Montreal, Canada", destination_name: "Montreal, Canada",
    destination_city: "Montreal", destination_country: "Canada", origin_country: "Canada",
    start_date: dateOnly(start), end_date: dateOnly(end), days_count: Math.round((end - start) / dayMs) + 1,
    status: "generated", itinerary_status: "generated", itinerary_locked: true,
    tracking_unlocked: unlocked, live_companion_unlocked: unlocked,
    live_companion_unlocked_at: unlocked ? new Date().toISOString() : null,
    live_companion_source: unlocked ? "admin" : null,
    trip_companion_status: null,
    metadata: { planning: { destination: "Montreal", origin: "Saint John", originCountry: "Canada", destinationCountry: "Canada" } },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  });
}
const eventsOf = (tripId) => fake.table("roamly_trip_companion_events").filter((e) => e.trip_id === tripId);
const travelDaysOf = (tripId) => eventsOf(tripId).filter((e) => e.event_type === "travel_day_started");
const dayRow = (tripId, n) => travelDaysOf(tripId).find((e) => (e.metadata || {}).travelDayIndex === n);
// Simulated time passage (the production QA rewind seam's operation):
// move rows due at or before the horizon to now.
function advanceTime(horizonMs) {
  const nowIso = new Date().toISOString();
  for (const e of fake.table("roamly_trip_companion_events")) {
    if (e.status === "scheduled" && Date.parse(e.scheduled_for) <= horizonMs) e.scheduled_for = nowIso;
  }
}

// ---------------------------------------------------------------------------
// S1 — mid-window unlock (the proven production failure shape)
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "33333333-3333-4333-8333-333333333331";
  seedTrip(TRIP, { start: shift(todayStart, -2), end: shift(todayStart, 2) });
  const createdMs = Date.now();
  const result = await scheduleCompanionEvents(admin, TRIP);
  eq("S1 schedule ok", result.ok, true);
  const rows = eventsOf(TRIP);
  eq("S1 total rows (7 base + 4 extra travel days)", rows.length, 11);
  const scheduled = rows.filter((e) => e.status === "scheduled");
  const skipped = rows.filter((e) => e.status === "skipped");
  eq("S1 scheduled rows (today + day 4 + day 5)", scheduled.length, 3);
  eq("S1 elapsed rows recorded skipped at creation", skipped.length, 8);
  check("S1 every skipped row is elapsed-day bookkeeping", skipped.every((e) => (e.metadata || {}).catchUp === "elapsed_day"));
  check("S1 nothing born shown", rows.every((e) => e.status !== "shown"));
  const today3 = dayRow(TRIP, 3);
  check("S1 today's travel-day event exists (dayIndex 3)", Boolean(today3));
  eq("S1 today's event status", today3?.status, "scheduled");
  // Fire-time law (2026-11-08, Paris run-1 collapse): a past-due
  // catch-up event is due AT the creation instant; an event whose
  // natural time is still ahead keeps it. Either way the fire time
  // is never pushed out — the old +60s cushion made the first
  // dispatcher run after unlock see zero due events.
  const s1NaturalMs = Date.parse(atNine(todayStart));
  const s1ExpectedFireMs = s1NaturalMs <= createdMs ? createdMs : s1NaturalMs;
  check(
    "S1 today's event fire time = creation instant when past-due, else its natural time (never pushed out)",
    Math.abs(Date.parse(today3.scheduled_for) - s1ExpectedFireMs) < 5000,
    today3.scheduled_for
  );
  eq("S1 day 4 natural fire time", dayRow(TRIP, 4)?.scheduled_for, atNine(shift(todayStart, 1)));
  eq("S1 day 5 natural fire time", dayRow(TRIP, 5)?.scheduled_for, atNine(shift(todayStart, 2)));

  const again = await scheduleCompanionEvents(admin, TRIP);
  eq("S1 re-schedule is a no-op (idempotent)", again.count, 0);
  eq("S1 row count unchanged after re-schedule", eventsOf(TRIP).length, 11);

  const d0 = await sendScheduledTripNotifications();
  // The Paris law: the first dispatch after creation carries every
  // event already due (here: today's catch-up event when its natural
  // time has passed) and nothing that is not due yet (no early burn).
  // Before 09:00Z today's event is not due and the run is empty.
  const s1DueAtCreation = s1NaturalMs <= createdMs;
  eq("S1 first dispatch carries exactly the events already due (no blind window, no early burn)", d0.processed, s1DueAtCreation ? 1 : 0);
  if (s1DueAtCreation) {
    check(
      "S1 today's event fired in the FIRST dispatch (notification minted)",
      Boolean(fake.table("roamly_notifications").find((n) => n.event_id === today3.id))
    );
    eq(
      "S1 the burst email landed in the first dispatch (run-1 collapse)",
      fake.table("roamly_email_logs").filter((l) => l.trip_id === TRIP).length,
      1
    );
  }

  // Advance to today's event's OWN fire time (the same rewind-seam
  // operation the day-4 phase uses). The old now+90s advance only
  // reached the event when the reconciler had clamped it — true only
  // after 09:00 UTC; before that the event legitimately sits at its
  // natural 09:00Z fire time and the "fires when due" checks failed
  // on any tree, and the day-4 phase below became a coin flip over
  // which of the two simultaneously-due events claimed the trip's
  // single burst email (the emailed event is cap-exempt by design).
  // Firing today's event first, as production does a day apart, makes
  // both phases deterministic at any wall-clock hour.
  advanceTime(Date.parse(today3.scheduled_for) + 1);
  await sendScheduledTripNotifications();
  const notif = fake.table("roamly_notifications").find((n) => n.event_id === today3.id);
  check("S1 today's event FIRED when due (in-app notification minted)", Boolean(notif));
  const tripEmails = fake.table("roamly_email_logs").filter((l) => l.trip_id === TRIP);
  eq("S1 exactly one trip email (burst collapse intact)", tripEmails.length, 1);
  check("S1 today's event push attempted", ((dayRow(TRIP, 3)?.metadata || {}).pushAttempts ?? 0) >= 1);

  // Day 4 becomes due; run the dispatcher until its push-attempt cap retires it.
  const day4 = dayRow(TRIP, 4);
  for (let i = 0; i < 5 && dayRow(TRIP, 4)?.status === "scheduled"; i += 1) {
    advanceTime(Date.parse(day4.scheduled_for) + 1);
    await sendScheduledTripNotifications();
  }
  eq("S1 day 4 event fired and retired through the normal path", dayRow(TRIP, 4)?.status, "shown");
  eq("S1 day 4 push attempts capped at 3", (dayRow(TRIP, 4)?.metadata || {}).pushAttempts, 3);
  const day5 = dayRow(TRIP, 5);
  eq("S1 day 5 event still armed (untouched by earlier dispatches)", day5?.status, "scheduled");
  check("S1 day 5 never push-attempted", (day5?.metadata || {}).pushAttempts === undefined);
  eq("S1 still exactly one trip email after day 4 fired", fake.table("roamly_email_logs").filter((l) => l.trip_id === TRIP).length, 1);

  const last = await scheduleCompanionEvents(admin, TRIP);
  eq("S1 final reconcile still a no-op", last.count, 0);
  eq("S1 final row count", eventsOf(TRIP).length, 11);
}

// ---------------------------------------------------------------------------
// S2 — resurrection of a gate-killed event; elapsed corpse not duplicated
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "33333333-3333-4333-8333-333333333332";
  seedTrip(TRIP, { start: shift(todayStart, -1), end: shift(todayStart, 2) });
  const nowIso = new Date().toISOString();
  fake.table("roamly_trip_companion_events").push(
    {
      id: randomUUID(), user_id: USER_ID, trip_id: TRIP, booking_id: null,
      event_type: "travel_day_started", title: "Travel day 2", body: "Day 2 of your trip.",
      scheduled_for: atNine(todayStart), status: "skipped",
      created_at: nowIso, completed_at: nowIso,
      metadata: { generatedBy: "roamly_companion", travelDayIndex: 2 }
    },
    {
      id: randomUUID(), user_id: USER_ID, trip_id: TRIP, booking_id: null,
      event_type: "one_week_before", title: "One week before your trip", body: "Review bookings.",
      scheduled_for: atNine(shift(todayStart, -8)), status: "skipped",
      created_at: nowIso, completed_at: nowIso,
      metadata: { generatedBy: "roamly_companion" }
    }
  );
  const s2CreatedMs = Date.now();
  const result = await scheduleCompanionEvents(admin, TRIP);
  eq("S2 schedule ok", result.ok, true);
  eq("S2 elapsed corpse NOT duplicated", eventsOf(TRIP).filter((e) => e.event_type === "one_week_before").length, 1);
  const day2Rows = travelDaysOf(TRIP).filter((e) => (e.metadata || {}).travelDayIndex === 2);
  eq("S2 today's killed event resurrected alongside its corpse", day2Rows.length, 2);
  const healed = day2Rows.find((e) => e.status === "scheduled");
  // Same fire-time law as S1: due at the creation instant when its
  // natural time (today 09:00Z) has passed, else at the natural time.
  const s2NaturalMs = Date.parse(atNine(todayStart));
  const s2ExpectedFireMs = s2NaturalMs <= s2CreatedMs ? s2CreatedMs : s2NaturalMs;
  check(
    "S2 resurrected row is scheduled, due at creation or its natural time (never pushed out)",
    Boolean(healed) && Math.abs(Date.parse(healed.scheduled_for) - s2ExpectedFireMs) < 5000
  );
}

// ---------------------------------------------------------------------------
// S3 — pre-trip creation: catch-up clamps, nothing born skipped/shown
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "33333333-3333-4333-8333-333333333333";
  seedTrip(TRIP, { start: shift(todayStart, 3), end: shift(todayStart, 5) });
  const result = await scheduleCompanionEvents(admin, TRIP);
  eq("S3 schedule ok", result.ok, true);
  const rows = eventsOf(TRIP);
  eq("S3 total rows (7 base + 2 extra travel days)", rows.length, 9);
  check("S3 every row scheduled", rows.every((e) => e.status === "scheduled"));
  eq("S3 past-due stage trio clamped for catch-up", rows.filter((e) => (e.metadata || {}).catchUp === "clamped").length, 3);
  check("S3 travel days 2 and 3 present at natural times",
    dayRow(TRIP, 2)?.scheduled_for === atNine(shift(todayStart, 4)) && dayRow(TRIP, 3)?.scheduled_for === atNine(shift(todayStart, 5)));
  const d0 = await sendScheduledTripNotifications();
  // Paris law (2026-11-08): the clamped catch-up events are due at
  // creation, so the FIRST dispatch carries the whole burst — and
  // the burst still collapses to exactly one email for the trip.
  const s3ClampedCount = rows.filter((e) => (e.metadata || {}).catchUp === "clamped").length;
  eq("S3 first dispatch carries the whole catch-up burst", d0.processed, s3ClampedCount);
  eq("S3 the burst collapses to exactly one email", fake.table("roamly_email_logs").filter((l) => l.trip_id === TRIP).length, 1);
  check(
    "S3 no clamped event emailed twice (one email per event)",
    rows.filter((e) => (e.metadata || {}).catchUp === "clamped").every((e) => ((e.metadata || {}).emailAttempts ?? 0) <= 1)
  );
}

// ---------------------------------------------------------------------------
// S4 — locked trip still refuses (gate unchanged)
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "33333333-3333-4333-8333-333333333334";
  seedTrip(TRIP, { start: shift(todayStart, -1), end: shift(todayStart, 1), unlocked: false });
  const result = await scheduleCompanionEvents(admin, TRIP);
  eq("S4 locked schedule refused", result.ok, false);
  eq("S4 zero events for a locked trip", eventsOf(TRIP).length, 0);
}

// ---------------------------------------------------------------------------
// S5 — pre-scheduled day 1 survives reconcile; remaining days added once
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "33333333-3333-4333-8333-333333333335";
  seedTrip(TRIP, { start: todayStart, end: shift(todayStart, 2) });
  const seededFire = atNine(todayStart);
  fake.table("roamly_trip_companion_events").push({
    id: randomUUID(), user_id: USER_ID, trip_id: TRIP, booking_id: null,
    event_type: "travel_day_started", title: "Travel day started", body: "Roamly can show what is next.",
    scheduled_for: seededFire, status: "scheduled",
    created_at: new Date(Date.now() - dayMs).toISOString(), completed_at: null,
    metadata: { generatedBy: "roamly_companion" }
  });
  const result = await scheduleCompanionEvents(admin, TRIP);
  eq("S5 schedule ok", result.ok, true);
  const days = travelDaysOf(TRIP);
  eq("S5 exactly 3 travel-day rows (no day-1 duplicate)", days.length, 3);
  const day1 = days.find((e) => (e.metadata || {}).travelDayIndex === undefined);
  eq("S5 pre-scheduled day 1 untouched (same fire time)", day1?.scheduled_for, seededFire);
  eq("S5 day 1 still scheduled", day1?.status, "scheduled");
  check("S5 days 2 and 3 added at natural times",
    dayRow(TRIP, 2)?.scheduled_for === atNine(shift(todayStart, 1)) && dayRow(TRIP, 3)?.scheduled_for === atNine(shift(todayStart, 2)));
}

// ---------------------------------------------------------------------------
// S6 — the Paris shape (2026-11-08 Europe production test): a trip
// starting TOMORROW unlocked with fast generation, so every pre-trip
// stage event is already past-due at creation and the first
// dispatcher run starts seconds later. Production run 1 produced
// ZERO email rows (the +60s clamp cushion hid the whole burst) and
// the single consolidated email only landed in run 2. The law now:
// run 1 carries the burst; the cumulative count is 1 from run 1 on.
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "33333333-3333-4333-8333-333333333336";
  seedTrip(TRIP, { start: shift(todayStart, 1), end: shift(todayStart, 4) });
  const result = await scheduleCompanionEvents(admin, TRIP);
  eq("S6 schedule ok", result.ok, true);
  const rows = eventsOf(TRIP);
  const clamped = rows.filter((e) => (e.metadata || {}).catchUp === "clamped");
  check("S6 every pre-trip stage event clamped for catch-up (trip starts tomorrow)", clamped.length >= 4, `${clamped.length} clamped`);
  check(
    "S6 clamped events are due at creation (fire time not in the future)",
    clamped.every((e) => Date.parse(e.scheduled_for) <= Date.now())
  );
  const d1 = await sendScheduledTripNotifications();
  eq("S6 run 1 processes the whole due burst", d1.processed, clamped.length);
  eq("S6 run 1 lands exactly one consolidated email", fake.table("roamly_email_logs").filter((l) => l.trip_id === TRIP).length, 1);
  const d2 = await sendScheduledTripNotifications();
  eq("S6 run 2 adds no email (cumulative stays 1)", fake.table("roamly_email_logs").filter((l) => l.trip_id === TRIP).length, 1);
  check(
    "S6 one email per event holds across runs",
    clamped.every((e) => ((e.metadata || {}).emailAttempts ?? 0) <= 1)
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live companion travel-day checks passed`);
await fake.close();
process.exit(failed.length ? 1 : 0);
