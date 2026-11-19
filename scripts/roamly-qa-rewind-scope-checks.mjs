// QA rewind scope checks — the Live Companion day-1 gap (2026-11-19).
//
// The daily test's Leg 8 email-consolidation proof drives the QA seam's
// `rewind` between dispatcher runs. Before this fix the seam rewound EVERY
// still-scheduled event to now — including the future per-day
// travel_day_started rows at 09:00Z — so `dispatch` fired the whole trip's
// travel-day alerts within ~2 minutes of unlock, burned their dedupe keys,
// and the reconcile could never recreate them: two test trips starting
// Nov 19 (Tbilisi, Lisbon) got no travel-day alert that morning. Real
// customer trips were never affected (no production path rewinds).
//
// The fix (app/api/roamly/qa/daily-test/route.ts) scopes the seam rewind
// to events already due (scheduled_for <= now) — the same due definition
// the dispatcher itself uses. The email burst survives because it comes
// from the already-due pre-trip reminders.
//
// This script proves, against the REAL scheduler, the REAL dispatcher,
// and the REAL seam query (issued through the Supabase client, not an
// in-memory imitation):
//   A. FIXED scope: a 3-day trip starting tomorrow keeps all 3 travel-day
//      rows `scheduled` at their 09:00Z fire times through the full
//      5-run dispatch/rewind loop, while the email burst still collapses
//      to exactly one dispatcher email row (1 -> 1 -> 1 -> 1 -> 1).
//   B. OLD scope (control): the same fixture with the pre-fix rewind
//      burns the travel-day rows — they end `shown` with their 09:00Z
//      fire times overwritten — proving this test can see the defect.
// The 5 inspect-shaped snapshots from scenario A are written to
// QA_REWIND_SNAPSHOTS_OUT (default /tmp/qa-rewind-scope-snapshots.json)
// so the ACTUAL daily-test grader (gradeEmailSequence in
// hidden_files/daily-test-2026-10-20/assertions.mjs) can be run over them.
//
// What this does NOT prove (stated, not claimed): the daily test still
// cannot prove day-1 firing inside its run window — the day-1 row stays
// future-scheduled by design. Day-1 firing proof continues to come from
// live-proof trips / real cron ticks. The route handler's auth/gating
// wrapper is unchanged by the fix and is not exercised here; the rewind
// query itself is exercised for real through the client.
//
// Provider control is by env, read dynamically by lib/roamly/email.ts:
//   capture ON  -> ROAMLY_EMAIL_CAPTURE_ENABLED=true (provider accepts)

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROAMLY_TEST_ROOT ? path.resolve(process.env.ROAMLY_TEST_ROOT) : path.resolve(here, "..");

// ---------------------------------------------------------------------------
// In-process PostgREST fake. Handlers apply filters and mutations
// synchronously after the body is read, so each request is atomic — the
// same serialization a single Postgres row write gets. Supports the query
// surface the dispatcher graph uses: eq / neq / lt / lte / gt / gte / is,
// jsonb text extraction filters (metadata->>key), multi-key order, limit,
// inserts/updates with return=representation, and object (maybeSingle)
// responses (an empty array is returned for 0 rows; @supabase/postgrest-js
// converts that to data:null with no error for maybeSingle).
// ---------------------------------------------------------------------------
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

const fake = createFakeSupabase();
const port = await fake.listen();

process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-service-key";
delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
process.env.ROAMLY_EMAIL_PROVIDER = "smtp";
process.env.ROAMLY_SMTP_HOST = "127.0.0.1";
process.env.ROAMLY_SMTP_PORT = "1";
process.env.ROAMLY_SMTP_USER = "sender@roamlyhq.com";
process.env.ROAMLY_SMTP_PASSWORD = "stub-password";
process.env.ROAMLY_SMTP_SECURE = "false";
process.env.ROAMLY_FROM_EMAIL = "support@roamlyhq.com";
delete process.env.ROAMLY_DAILY_TEST_EMAIL;
process.env.ROAMLY_EMAIL_CAPTURE_ENABLED = "true";

const { createSupabaseAdminClient } = await import(pathToFileURL(path.join(ROOT, "lib/supabase/admin.ts")).href);
const { scheduleCompanionEvents } = await import(pathToFileURL(path.join(ROOT, "lib/roamly/tripCompanion.ts")).href);
const { sendScheduledTripNotifications } = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushServer.ts")).href);
const admin = createSupabaseAdminClient();
assert.ok(admin, "admin client must be created from the fake env");

const USER_ID = "33333333-3333-4333-8333-333333333333";
const USER_EMAIL = "daily.checks@roamlyhq.com";
const TRIP_ID = "t3333333-3333-4333-8333-333333333333";
const dayMs = 86400_000;
const todayStart = new Date();
todayStart.setUTCHours(0, 0, 0, 0);
const dateOnly = (d) => d.toISOString().slice(0, 10);
const atNine = (d) => `${dateOnly(d)}T09:00:00.000Z`;
const iso = (ms) => new Date(ms).toISOString();

function seedUser() {
  fake.state.users.set(USER_ID, { id: USER_ID, email: USER_EMAIL, created_at: iso(Date.now() - dayMs) });
}

function seedTrip() {
  const start = new Date(todayStart.getTime() + dayMs); // starts tomorrow, like the daily-test trips
  const end = new Date(todayStart.getTime() + 3 * dayMs); // 3-day trip
  fake.table("roamly_trips").push({
    id: TRIP_ID,
    user_id: USER_ID,
    title: "Test trip",
    destination: "Test City",
    destination_name: "Test City",
    destination_city: "Test City",
    destination_country: "Canada",
    origin_country: "Canada",
    start_date: dateOnly(start),
    end_date: dateOnly(end),
    days_count: 3,
    status: "generated",
    itinerary_status: "generated",
    itinerary_locked: true,
    tracking_unlocked: true,
    live_companion_unlocked: true,
    live_companion_unlocked_at: new Date().toISOString(),
    live_companion_source: "admin",
    trip_companion_status: null,
    metadata: {
      planning: { destination: "Test City", origin: "Saint John", originCountry: "Canada", destinationCountry: "Canada" }
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  return { start, end };
}

const tripEvents = () => fake.table("roamly_trip_companion_events").filter((e) => e.trip_id === TRIP_ID);
const travelDayRows = () =>
  tripEvents()
    .filter((e) => e.event_type === "travel_day_started")
    .sort((a, b) => (a.metadata?.travelDayIndex ?? 0) - (b.metadata?.travelDayIndex ?? 0));
const dispatcherRows = () =>
  fake
    .table("roamly_email_logs")
    .filter((r) => r.trip_id === TRIP_ID && !String(r.metadata?.type || "").startsWith("itinerary_generation"));

// The exact query app/api/roamly/qa/daily-test/route.ts issues for the
// "rewind" action — FIXED scope: only events already due. Returns how many
// rows had their scheduled_for changed, so the test can see the scope.
async function seamRewindFixed(tripId) {
  const nowIso = new Date().toISOString();
  const before = new Map(tripEvents().map((e) => [e.id, e.scheduled_for]));
  const { error } = await admin
    .from("roamly_trip_companion_events")
    .update({ scheduled_for: nowIso }, { count: "exact" })
    .eq("trip_id", tripId)
    .eq("user_id", USER_ID)
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso);
  assert.equal(error, null, error?.message);
  return tripEvents().filter((e) => before.get(e.id) !== e.scheduled_for).length;
}

// Pre-fix behaviour, control scenario only: every still-scheduled event,
// however far in the future.
async function seamRewindOld(tripId) {
  const nowIso = new Date().toISOString();
  const before = new Map(tripEvents().map((e) => [e.id, e.scheduled_for]));
  const { error } = await admin
    .from("roamly_trip_companion_events")
    .update({ scheduled_for: nowIso }, { count: "exact" })
    .eq("trip_id", tripId)
    .eq("user_id", USER_ID)
    .eq("status", "scheduled");
  assert.equal(error, null, error?.message);
  return tripEvents().filter((e) => before.get(e.id) !== e.scheduled_for).length;
}

// Inspect-shaped snapshot, exactly what the seam's "inspect" action
// returns and what gradeEmailSequence grades.
function captureSnapshot(sinceIso) {
  const events = tripEvents()
    .map((e) => ({
      id: e.id,
      event_type: e.event_type,
      booking_id: e.booking_id ?? null,
      status: e.status,
      scheduled_for: e.scheduled_for,
      metadata: e.metadata || {},
      created_at: e.created_at
    }))
    .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)));
  const emailLogs = fake
    .table("roamly_email_logs")
    .filter((r) => r.trip_id === TRIP_ID)
    .map((r) => ({ id: r.id, to_email: r.to_email, provider: r.provider, status: r.status, metadata: r.metadata || {}, created_at: r.created_at }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const userEmailLogs = fake
    .table("roamly_email_logs")
    .filter((r) => r.user_id === USER_ID && String(r.created_at) >= sinceIso)
    .map((r) => ({
      id: r.id,
      to_email: r.to_email,
      trip_id: r.trip_id,
      provider: r.provider,
      status: r.status,
      metadata: r.metadata || {},
      created_at: r.created_at
    }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return { events, emailLogs, userEmailLogs };
}

// --- Scenario A: FIXED scope -----------------------------------------------
{
  fake.reset();
  seedUser();
  const { start } = seedTrip();
  const day2 = new Date(start.getTime() + dayMs);
  const day3 = new Date(start.getTime() + 2 * dayMs);
  const scheduled = await scheduleCompanionEvents(admin, TRIP_ID);
  check("A schedule ok", scheduled.ok === true, scheduled.error || "");
  const rows = tripEvents();
  eq("A scheduler built 9 rows (6 pre-trip + 3 travel-day)", rows.length, 9);
  check(
    "A all rows born scheduled (nothing born shown/skipped)",
    rows.every((e) => e.status === "scheduled"),
    rows.map((e) => `${e.event_type}:${e.status}`).join(", ")
  );
  const days = travelDayRows();
  eq("A three travel-day rows", days.length, 3);
  eq("A day-1 row at 09:00Z on the start day", days[0]?.scheduled_for, atNine(start));
  eq("A day-2 row at 09:00Z on start+1", days[1]?.scheduled_for, atNine(day2));
  eq("A day-3 row at 09:00Z on start+2", days[2]?.scheduled_for, atNine(day3));
  const dueNow = rows.filter((e) => Date.parse(e.scheduled_for) <= Date.now()).length;
  check("A at least 4 events already due at unlock (the burst setup)", dueNow >= 4, `${dueNow} due`);

  const dueEventsBefore = rows.filter((e) => e.status === "scheduled").length;
  const runStartedAt = new Date().toISOString();
  const snapshots = [];
  const totals = [];
  const rewoundPerRun = [];
  for (let run = 1; run <= 5; run += 1) {
    const result = await sendScheduledTripNotifications();
    snapshots.push(captureSnapshot(runStartedAt));
    totals.push(dispatcherRows().length);
    if (run < 5) rewoundPerRun.push(await seamRewindFixed(TRIP_ID));
    console.log(`  A run ${run}: dispatcher processed=${result?.processed ?? "?"} cumulative dispatcher emails=${totals[totals.length - 1]}`);
  }
  console.log(`  A rewinds between runs changed ${rewoundPerRun.join(", ")} row(s) (due-only scope)`);
  const outPath = process.env.QA_REWIND_SNAPSHOTS_OUT || "/tmp/qa-rewind-scope-snapshots.json";
  writeFileSync(outPath, `${JSON.stringify({ dueEventsBefore, testEmail: USER_EMAIL, snapshots }, null, 2)}\n`);
  console.log(`  A snapshots written to ${outPath}`);

  const finalDays = travelDayRows();
  check(
    "A travel-day rows still scheduled after all 5 runs",
    finalDays.every((e) => e.status === "scheduled"),
    finalDays.map((e) => `${e.metadata?.travelDayIndex}:${e.status}`).join(", ")
  );
  check(
    "A travel-day fire times untouched (still 09:00Z on their trip days)",
    finalDays[0]?.scheduled_for === atNine(start) && finalDays[1]?.scheduled_for === atNine(day2) && finalDays[2]?.scheduled_for === atNine(day3),
    finalDays.map((e) => e.scheduled_for).join(", ")
  );
  eq("A cumulative dispatcher email rows are 1 -> 1 -> 1 -> 1 -> 1", JSON.stringify(totals), "[1,1,1,1,1]");
  const emailed = tripEvents().filter((e) => typeof e.metadata?.emailSentAt === "string" && e.metadata.emailSentAt.length > 0);
  eq("A exactly one event carries emailSentAt", emailed.length, 1);
  check(
    "A emailed event made exactly one email attempt",
    emailed.length === 1 && emailed[0].metadata.emailAttempts === 1,
    `attempts=${emailed[0]?.metadata?.emailAttempts}`
  );
  check(
    "A emailed event still scheduled after run 5 (push keeps retrying, email does not)",
    emailed.length === 1 && emailed[0].status === "scheduled",
    `status=${emailed[0]?.status}`
  );
  const uncollapsed = tripEvents().filter(
    (e) => !emailed.includes(e) && e.status === "scheduled" && e.metadata?.emailCollapsed !== true
  );
  check(
    "A every non-emailed scheduled sibling is emailCollapsed (incl. future travel-day rows)",
    uncollapsed.length === 0,
    uncollapsed.map((e) => e.event_type).join(", ")
  );
}

// --- Scenario B: OLD scope (control — must reproduce the bug) -------------
{
  fake.reset();
  seedUser();
  const { start } = seedTrip();
  const scheduled = await scheduleCompanionEvents(admin, TRIP_ID);
  check("B schedule ok", scheduled.ok === true, scheduled.error || "");
  const fireTimesBefore = travelDayRows().map((e) => e.scheduled_for);
  for (let run = 1; run <= 5; run += 1) {
    await sendScheduledTripNotifications();
    if (run < 5) await seamRewindOld(TRIP_ID);
  }
  const daysAfter = travelDayRows();
  check(
    "B CONTROL: old rewind overwrote the travel-day fire times (bug reproduced)",
    daysAfter.every((e) => !fireTimesBefore.includes(e.scheduled_for)),
    daysAfter.map((e) => e.scheduled_for).join(", ")
  );
  const shownDays = daysAfter.filter((e) => e.status === "shown").length;
  check("B CONTROL: at least 2 travel-day rows ended shown (burned before their day)", shownDays >= 2, `${shownDays}/3 shown`);
  console.log(`  B travel-day rows after the old loop: ${daysAfter.map((e) => `${e.metadata?.travelDayIndex}:${e.status}@${e.scheduled_for}`).join(", ")}`);
}

await fake.close();
const failed = results.filter((entry) => !entry.ok);
console.log(`\nqa rewind scope checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`failing: ${failed.map((entry) => entry.name).join(" | ")}`);
  process.exit(1);
}
console.log("qa rewind scope checks passed");
