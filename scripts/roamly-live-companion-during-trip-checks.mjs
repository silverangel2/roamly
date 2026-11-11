// Live Companion DURING-TRIP scheduling checks (2026-11-11).
//
// THE GAP THIS PINS: on production, a tester trip inside its travel
// window created ZERO companion events during its travel days — the
// Nov 6 feature test proved it and the Nov 11 re-test reproduced it
// on two in-window trips (records: goals/roamly-october-4-repair/
// hidden_files/feature-tests-2026-11-11/LIVE-COMPANION-RETEST.md).
// Scheduled events existed only as a setup-time batch: the only
// creator, scheduleCompanionEvents, was called from unlock, booking
// confirm, and the Live-page render — never from any background
// process. The */5 live-companion lifecycle visited in-window trips
// every five minutes and never reconciled their event schedules.
//
// THE FIX UNDER TEST: processLiveCompanionTimeLifecycle now runs the
// existing reconcile for each trip that passes its own gates
// (in-window, destination-local today inside the trip dates,
// companion enabled and not paused). These checks run the REAL
// lifecycle + REAL reconcile + REAL dispatcher against an in-process
// PostgREST fake (the travel-day suite's harness, extended for the
// lifecycle's query shapes: or= groups, in.() lists, not.is, and
// HEAD count reads).
//
// Scenarios (the promise, not the surface):
//   D1 an in-window trip with an EMPTY events store gains its full
//      timeline from a lifecycle run — today's event scheduled and
//      fireable, future days at natural times — and the real
//      dispatcher then fires the due set and lands the trip's one
//      collapsed email. A second lifecycle run is a no-op.
//   D2 a trip whose setup batch lacks the per-day events (the
//      pre-coverage shape) is healed mid-trip: missing days are
//      created, an elapsed corpse is not duplicated, run 2 no-op.
//   D3 locked, future, and completed-window trips gain nothing.
//   D4 the lifecycle's pre-existing activity processing for the
//      same trip is undisturbed (an elapsed activity still expires)
//      while scheduling happens alongside it.
//
// Dates are built from the DESTINATION-local today (the seed pins
// planning.timezone = America/Toronto and stored metadata wins in
// timezone resolution), so the suite is deterministic at any
// wall-clock hour and under either gate timezone.
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}
function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// In-process PostgREST fake (travel-day harness + lifecycle extensions)
// ---------------------------------------------------------------------------
const TABLES = [
  "users", "roamly_trips", "roamly_bookings", "roamly_trip_companion_events",
  "roamly_user_entitlements", "roamly_notifications", "roamly_notification_deliveries",
  "roamly_email_logs", "roamly_app_events", "roamly_push_subscriptions",
  "roamly_companion_preferences", "roamly_location_settings", "roamly_activities",
  "roamly_trip_companion_email_claims"
];
function compareValues(rowVal, op, rawVal) {
  if (op === "is") {
    if (rawVal === "null") return rowVal === null || rowVal === undefined;
    if (rawVal === "true") return rowVal === true;
    if (rawVal === "false") return rowVal === false;
    return String(rowVal) === rawVal;
  }
  if (rowVal === null || rowVal === undefined) return false;
  let a = rowVal; let b = rawVal;
  if (typeof rowVal === "number" || (typeof rowVal === "string" && rowVal !== "" && !Number.isNaN(Number(rowVal)) && !/^\d{4}-\d{2}-\d{2}/.test(rowVal))) {
    const n = Number(rawVal);
    if (!Number.isNaN(n)) { a = Number(rowVal); b = n; }
  }
  switch (op) {
    case "eq": return String(a) === String(b) || a === b;
    case "neq": return String(a) !== String(b) && a !== b;
    case "lt": return a < b;
    case "lte": return a <= b;
    case "gt": return a > b;
    case "gte": return a >= b;
    default: return false;
  }
}
function accessor(row, key) {
  const jsonMatch = /^(.+)->>(.+)$/.exec(key);
  if (jsonMatch) {
    const parent = row[jsonMatch[1]];
    return parent && typeof parent === "object" ? parent[jsonMatch[2]] : undefined;
  }
  return row[key];
}
function matchLeaf(row, col, expr) {
  if (expr.startsWith("not.")) return !matchLeaf(row, col, expr.slice(4));
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  if (op === "in") {
    const list = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.trim());
    const rowVal = accessor(row, col);
    if (rowVal === null || rowVal === undefined) return false;
    return list.includes(String(rowVal));
  }
  return compareValues(accessor(row, col), op, val);
}
function splitTopLevel(text) {
  const parts = [];
  let depth = 0; let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") depth -= 1;
    else if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}
function matchTerm(row, term) {
  if (term.startsWith("and(") && term.endsWith(")")) {
    return splitTopLevel(term.slice(4, -1)).every((t) => matchTerm(row, t));
  }
  if (term.startsWith("or(") && term.endsWith(")")) {
    return splitTopLevel(term.slice(3, -1)).some((t) => matchTerm(row, t));
  }
  const dot = term.indexOf(".");
  return matchLeaf(row, term.slice(0, dot), term.slice(dot + 1));
}
function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (["select", "order", "limit", "offset"].includes(key)) continue;
    if (key === "or") {
      const inner = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1) : value;
      if (!splitTopLevel(inner).some((t) => matchTerm(row, t))) return false;
      continue;
    }
    if (!matchLeaf(row, key, value)) return false;
  }
  return true;
}
function applyOrder(rows, params) {
  const order = params.get("order");
  if (!order) return rows;
  const sorted = [...rows];
  for (const part of order.split(",").reverse()) {
    const [col, dir] = part.split(".");
    sorted.sort((a, b) => {
      const av = a[col]; const bv = b[col];
      if (av === bv) return 0;
      if (av === null || av === undefined) return dir === "desc" ? -1 : 1;
      if (bv === null || bv === undefined) return dir === "desc" ? 1 : -1;
      return (av < bv ? -1 : 1) * (dir === "desc" ? -1 : 1);
    });
  }
  return sorted;
}
function project(row, params) {
  const select = params.get("select");
  if (!select || select === "*") return { ...row };
  const out = {};
  for (const col of select.split(",").map((c) => c.trim())) {
    if (col && !col.includes("(") && !col.includes(":")) out[col] = row[col] ?? null;
  }
  return out;
}
function createFake() {
  const state = { tables: {}, users: new Map() };
  for (const t of TABLES) state.tables[t] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake.local");
    const send = (status, body, extraHeaders = {}) => {
      const payload = body === undefined ? "" : JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
      res.end(payload);
    };
    let body = "";
    req.on("data", (c) => { body += c; });
    await new Promise((resolve) => req.on("end", resolve));
    const json = body ? JSON.parse(body) : null;

    const adminUser = /^\/auth\/v1\/admin\/users\/(.+)$/.exec(url.pathname);
    if (adminUser && req.method === "GET") {
      const user = state.users.get(decodeURIComponent(adminUser[1]));
      if (!user) return send(404, { code: "user_not_found", message: "User not found" });
      return send(200, { id: user.id, email: user.email, aud: "authenticated", role: "authenticated", user_metadata: {}, created_at: user.created_at });
    }
    if (url.pathname.startsWith("/auth/v1")) {
      if (url.pathname === "/auth/v1/user" && req.method === "GET") {
        const id = req.headers["x-user-id"] || state.lastUserId;
        const user = id ? state.users.get(id) : null;
        return send(user ? 200 : 401, user || { message: "unauthorized" });
      }
      return send(200, {});
    }
    const tableMatch = url.pathname.match(/^\/rest\/v1\/([a-z0-9_]+)$/i);
    if (!tableMatch) return send(404, { message: "not found" });
    const table = tableMatch[1];
    if (!(table in state.tables)) return send(404, { code: "PGRST205", message: `table ${table} missing` });
    const rows = state.tables[table];

    if (req.method === "HEAD") {
      const count = rows.filter((r) => matches(r, url.searchParams)).length;
      return send(200, undefined, { "content-range": `*/${count}` });
    }
    if (req.method === "GET") {
      let out = rows.filter((r) => matches(r, url.searchParams));
      out = applyOrder(out, url.searchParams);
      const limit = Number(url.searchParams.get("limit"));
      if (Number.isFinite(limit) && limit > 0) out = out.slice(0, limit);
      return send(200, out.map((r) => project(r, url.searchParams)));
    }
    if (req.method === "POST") {
      const items = Array.isArray(json) ? json : [json];
      const inserted = items.map((item) => {
        const row = { id: item.id || randomUUID(), ...item };
        rows.push(row);
        return row;
      });
      const wantsReturn = (req.headers.prefer || "").includes("return=representation");
      return send(201, wantsReturn ? inserted.map((r) => project(r, url.searchParams)) : []);
    }
    if (req.method === "PATCH") {
      const updated = [];
      for (const row of rows) {
        if (matches(row, url.searchParams)) { Object.assign(row, json); updated.push(row); }
      }
      const wantsReturn = (req.headers.prefer || "").includes("return=representation");
      return send(200, wantsReturn ? updated.map((r) => project(r, url.searchParams)) : []);
    }
    if (req.method === "DELETE") {
      state.tables[table] = rows.filter((r) => !matches(r, url.searchParams));
      return send(200, []);
    }
    return send(405, { message: "method" });
  });
  return {
    state,
    table: (name) => state.tables[name],
    reset() {
      for (const t of TABLES) state.tables[t] = [];
      state.users = new Map();
    },
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

const fake = createFake();
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
const { processLiveCompanionTimeLifecycle } = await import(pathToFileURL(path.join(ROOT, "lib/roamly/liveCompanionLifecycle.ts")).href);
const { sendScheduledTripNotifications } = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushServer.ts")).href);

const USER_ID = "44444444-4444-4444-8444-444444444444";
const dayMs = 86400_000;
// Destination-local today (the seed pins America/Toronto in stored
// metadata, which wins timezone resolution), assembled from parts so
// the suite means the same day at any wall-clock hour.
const torontoParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit"
}).formatToParts(new Date());
const torontoTodayStr = `${torontoParts.find((p) => p.type === "year").value}-${torontoParts.find((p) => p.type === "month").value}-${torontoParts.find((p) => p.type === "day").value}`;
const torontoToday = new Date(`${torontoTodayStr}T00:00:00.000Z`);
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
    metadata: { planning: { destination: "Montreal", origin: "Saint John", originCountry: "Canada", destinationCountry: "Canada", timezone: "America/Toronto" } },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  });
}
const eventsOf = (tripId) => fake.table("roamly_trip_companion_events").filter((e) => e.trip_id === tripId);
const travelDaysOf = (tripId) => eventsOf(tripId).filter((e) => e.event_type === "travel_day_started");
const dayRow = (tripId, n) => travelDaysOf(tripId).find((e) => (e.metadata || {}).travelDayIndex === n);
const resultFor = (run, tripId) => (run.results || []).find((r) => r.tripId === tripId)?.result;
// Simulated time passage (the production QA rewind seam's operation):
// move rows due at or before the horizon to now.
function advanceTime(horizonMs) {
  const nowIso = new Date().toISOString();
  for (const e of fake.table("roamly_trip_companion_events")) {
    if (e.status === "scheduled" && Date.parse(e.scheduled_for) <= horizonMs) e.scheduled_for = nowIso;
  }
}

// ---------------------------------------------------------------------------
// D1 — in-window trip, EMPTY store: the lifecycle creates the whole
// schedule mid-trip; the dispatcher then fires it.
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "55555555-5555-4555-8555-555555555551";
  seedTrip(TRIP, { start: shift(torontoToday, -2), end: shift(torontoToday, 2) });
  eq("D1 store empty before the run (the production shape)", eventsOf(TRIP).length, 0);
  const run = await processLiveCompanionTimeLifecycle({ admin });
  eq("D1 lifecycle run ok", run.ok, true);
  check("D1 the trip was visited by the sweep", Boolean(resultFor(run, TRIP)));
  const rows = eventsOf(TRIP);
  eq("D1 full timeline created DURING the trip (7 base + 4 extra days)", rows.length, 11);
  eq("D1 one travel-day row per trip day", travelDaysOf(TRIP).length, 5);
  check("D1 no event born shown", rows.every((e) => e.status !== "shown"));
  const day5 = dayRow(TRIP, 5);
  eq("D1 final day still armed at its natural time", day5?.status, "scheduled");
  eq("D1 final day natural fire time", day5?.scheduled_for, atNine(shift(torontoToday, 2)));
  check(
    "D1 at least one travel-day event is armed for today/future (something to fire on a travel day)",
    travelDaysOf(TRIP).some((e) => e.status === "scheduled")
  );

  const run2 = await processLiveCompanionTimeLifecycle({ admin });
  eq("D1 second lifecycle run still ok", run2.ok, true);
  eq("D1 second run creates nothing new (idempotent)", eventsOf(TRIP).length, 11);

  advanceTime(Date.parse(day5.scheduled_for) + 1);
  const dispatch = await sendScheduledTripNotifications();
  check("D1 the dispatcher processed the created events", dispatch.processed >= 1, `processed=${dispatch.processed}`);
  check(
    "D1 a notification was minted from an event the lifecycle created",
    fake.table("roamly_notifications").some((n) => eventsOf(TRIP).some((e) => e.id === n.event_id))
  );
  eq("D1 the burst collapsed to exactly one trip email", fake.table("roamly_email_logs").filter((l) => l.trip_id === TRIP).length, 1);
}

// ---------------------------------------------------------------------------
// D2 — the partial batch (pre-coverage shape): day 1 exists, the
// per-day rows do not. A day-2 lifecycle run heals the schedule.
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "55555555-5555-4555-8555-555555555552";
  seedTrip(TRIP, { start: shift(torontoToday, -1), end: shift(torontoToday, 2) });
  const nowIso = new Date().toISOString();
  fake.table("roamly_trip_companion_events").push(
    {
      id: randomUUID(), user_id: USER_ID, trip_id: TRIP, booking_id: null,
      event_type: "travel_day_started", title: "Travel day started", body: "Roamly can show what is next.",
      scheduled_for: atNine(shift(torontoToday, -1)), status: "scheduled",
      created_at: new Date(Date.now() - dayMs).toISOString(), completed_at: null,
      metadata: { generatedBy: "roamly_companion" }
    },
    {
      id: randomUUID(), user_id: USER_ID, trip_id: TRIP, booking_id: null,
      event_type: "one_week_before", title: "One week before your trip", body: "Review bookings.",
      scheduled_for: atNine(shift(torontoToday, -8)), status: "skipped",
      created_at: nowIso, completed_at: nowIso,
      metadata: { generatedBy: "roamly_companion" }
    }
  );
  const run = await processLiveCompanionTimeLifecycle({ admin });
  eq("D2 lifecycle run ok", run.ok, true);
  eq("D2 every trip day now has a travel-day row", travelDaysOf(TRIP).length, 4);
  check("D2 days 2, 3 and 4 were created during the trip",
    [2, 3, 4].every((n) => Boolean(dayRow(TRIP, n))));
  eq("D2 the final day is armed at its natural time", dayRow(TRIP, 4)?.scheduled_for, atNine(shift(torontoToday, 2)));
  eq("D2 the elapsed corpse was not duplicated", eventsOf(TRIP).filter((e) => e.event_type === "one_week_before").length, 1);
  const totalAfterHeal = eventsOf(TRIP).length;
  await processLiveCompanionTimeLifecycle({ admin });
  eq("D2 second run is a no-op", eventsOf(TRIP).length, totalAfterHeal);
}

// ---------------------------------------------------------------------------
// D3 — out-of-scope trips gain nothing: locked, future, completed.
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const LOCKED = "55555555-5555-4555-8555-555555555553";
  const FUTURE = "55555555-5555-4555-8555-555555555554";
  const PAST = "55555555-5555-4555-8555-555555555555";
  seedTrip(LOCKED, { start: shift(torontoToday, -1), end: shift(torontoToday, 1), unlocked: false });
  seedTrip(FUTURE, { start: shift(torontoToday, 3), end: shift(torontoToday, 5) });
  seedTrip(PAST, { start: shift(torontoToday, -5), end: shift(torontoToday, -1) });
  const run = await processLiveCompanionTimeLifecycle({ admin });
  eq("D3 lifecycle run ok", run.ok, true);
  eq("D3 locked trip gains no events", eventsOf(LOCKED).length, 0);
  eq("D3 future trip gains no events", eventsOf(FUTURE).length, 0);
  eq("D3 future trip reported outside its window", resultFor(run, FUTURE)?.skipped, "outside_trip_window");
  eq("D3 completed-window trip gains no events", eventsOf(PAST).length, 0);
}

// ---------------------------------------------------------------------------
// D4 — the pre-existing activity work is undisturbed: an elapsed
// activity still expires on the same run that schedules the trip.
// ---------------------------------------------------------------------------
{
  fake.reset(); seedUser();
  const TRIP = "55555555-5555-4555-8555-555555555556";
  seedTrip(TRIP, { start: shift(torontoToday, -1), end: shift(torontoToday, 2) });
  fake.table("roamly_activities").push({
    id: randomUUID(), user_id: USER_ID, trip_id: TRIP,
    title: "Old Montreal walking tour", status: "planned",
    scheduled_start: new Date(Date.now() - 26 * 3600_000).toISOString(),
    scheduled_end: new Date(Date.now() - 24 * 3600_000).toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  });
  const run = await processLiveCompanionTimeLifecycle({ admin });
  eq("D4 lifecycle run ok", run.ok, true);
  eq("D4 the elapsed activity still expired (existing behaviour intact)", resultFor(run, TRIP)?.expired, 1);
  eq("D4 the activity row was marked missed",
    fake.table("roamly_activities").find((a) => a.trip_id === TRIP)?.status, "missed");
  eq("D4 the trip's schedule was still created alongside (7 base + 3 extra days)", eventsOf(TRIP).length, 10);
  eq("D4 one travel-day row per trip day", travelDaysOf(TRIP).length, 4);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live companion during-trip checks passed`);
await fake.close();
process.exit(failed.length ? 1 : 0);
