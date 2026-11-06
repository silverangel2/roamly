// Deterministic burst-collapse checks for the REAL companion dispatcher
// (lib/roamly/pushServer.ts sendScheduledTripNotifications) running against
// an in-process PostgREST fake. This exercises the shipped code end to end —
// claim, gates, email decision, provider result, terminal write — unlike
// roamly-companion-email-discipline-checks.mjs, which simulates the intended
// logic with the shipped helpers and therefore cannot see dispatcher-level
// defects (per-run collapse scope, markers written on only one exit path,
// the push-attempt cap retiring the emailed event, ...).
//
// Reproduces the daily-test failure pattern (2026-10-27/29/30: cumulative
// dispatcher email rows 1 -> 2 -> 2 -> 2 -> 2 and 1 -> 2 -> 3 -> 3 -> 3,
// with 2-3 distinct events carrying emailSentAt where exactly 1 may):
// a trip whose stage events become due at DIFFERENT times. Run 1 can only
// collapse the events that are due in run 1; the QA rewind (like the mere
// passage of time in production) makes the remaining stage events due in
// run 2, where a per-run collapse has forgotten run 1's email.
//
// Provider control is by env, read dynamically by lib/roamly/email.ts:
//   capture ON  -> ROAMLY_EMAIL_CAPTURE_ENABLED=true (provider accepts)
//   capture OFF -> SMTP to 127.0.0.1:1 (provider refuses: connection failed)
// emailSentAt may only ever be stamped after provider acceptance.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function providerAccepts() {
  process.env.ROAMLY_EMAIL_CAPTURE_ENABLED = "true";
}
function providerRefuses() {
  delete process.env.ROAMLY_EMAIL_CAPTURE_ENABLED;
}

const pushServer = await import(pathToFileURL(path.join(ROOT, "lib/roamly/pushServer.ts")).href);
const { sendScheduledTripNotifications } = pushServer;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_EMAIL = "traveler@roamlyhq.com";

const iso = (ms) => new Date(ms).toISOString();
const dateOnly = (ms) => iso(ms).slice(0, 10);

function seedUser() {
  fake.state.users.set(USER_ID, { id: USER_ID, email: USER_EMAIL, created_at: iso(Date.now() - 86400_000) });
}

function seedTrip(tripId, now) {
  fake.table("roamly_trips").push({
    id: tripId,
    user_id: USER_ID,
    start_date: dateOnly(now + 3 * 86400_000),
    end_date: dateOnly(now + 6 * 86400_000),
    status: "active",
    itinerary_status: "ready",
    tracking_unlocked: true,
    live_companion_unlocked: true,
    trip_companion_status: "scheduled",
    metadata: {},
    destination: "Banff",
    destination_name: "Banff",
    destination_city: "Banff",
    created_at: iso(now - 86400_000)
  });
}

const STAGE_TYPES = [
  "one_week_before",
  "document_check",
  "country_info",
  "packing_check",
  "one_day_before",
  "countdown_24h",
  "travel_day_started"
];

// The daily-test shape: 7 stage events exist before dispatch 1, but only
// the first four are due; the rest become due later (rewind / time).
function seedBurst(tripId, now, { allDue = false } = {}) {
  const created = iso(now - 86400_000);
  STAGE_TYPES.forEach((type, i) => {
    const due = allDue || i < 4;
    fake.table("roamly_trip_companion_events").push({
      id: `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      user_id: USER_ID,
      trip_id: tripId,
      booking_id: null,
      event_type: type,
      title: `${type} reminder`,
      body: `${type} body`,
      status: "scheduled",
      scheduled_for: due ? iso(now - (STAGE_TYPES.length - i) * 1800_000) : iso(now + 26 * 3600_000),
      completed_at: null,
      metadata: { generatedBy: "roamly_companion" },
      created_at: created
    });
  });
}

function seedSingleEvent(tripId, now, eventId, type = "one_week_before", createdAtMs = null) {
  fake.table("roamly_trip_companion_events").push({
    id: eventId,
    user_id: USER_ID,
    trip_id: tripId,
    booking_id: null,
    event_type: type,
    title: `${type} reminder`,
    body: `${type} body`,
    status: "scheduled",
    scheduled_for: iso(now - 3600_000),
    completed_at: null,
    metadata: { generatedBy: "roamly_companion" },
    created_at: iso(createdAtMs === null ? now - 86400_000 : createdAtMs)
  });
}

function rewind(tripId) {
  const now = new Date().toISOString();
  for (const event of fake.table("roamly_trip_companion_events")) {
    if (event.trip_id === tripId && event.status === "scheduled") event.scheduled_for = now;
  }
}

function tripEvents(tripId) {
  return fake.table("roamly_trip_companion_events").filter((event) => event.trip_id === tripId);
}
function dispatcherEmailLogs(tripId) {
  return fake.table("roamly_email_logs").filter(
    (row) => row.trip_id === tripId && String(row.metadata?.type || "") === "trip_reminder"
  );
}
function emailedEvents(tripId) {
  return tripEvents(tripId).filter(
    (event) => typeof event.metadata?.emailSentAt === "string" && event.metadata.emailSentAt.length > 0
  );
}
function resetWorld() {
  fake.reset();
  seedUser();
}

// --- S1+S2: burst collapse across rewinds, then repeated polling ----------
{
  resetWorld();
  const now = Date.now();
  const tripId = "t1111111-1111-4111-8111-111111111111";
  seedTrip(tripId, now);
  seedBurst(tripId, now);
  providerAccepts();

  const totals = [];
  for (let run = 0; run < 5; run += 1) {
    await sendScheduledTripNotifications();
    totals.push(dispatcherEmailLogs(tripId).length);
    if (run < 4) rewind(tripId);
  }
  check("S1 burst: cumulative email rows are 1 -> 1 -> 1 -> 1 -> 1", JSON.stringify(totals) === "[1,1,1,1,1]", totals.join(" -> "));
  const emailed = emailedEvents(tripId);
  check("S1 burst: exactly one event carries emailSentAt", emailed.length === 1, `${emailed.length} emailed`);
  check(
    "S1 burst: the emailed event made exactly one email attempt",
    emailed.length === 1 && emailed[0].metadata.emailAttempts === 1,
    `attempts=${emailed[0]?.metadata?.emailAttempts}`
  );
  const attemptsWithoutDelivery = tripEvents(tripId).filter(
    (event) => (event.metadata?.emailAttempts || 0) > 0 && !emailed.includes(event)
  );
  check("S1 burst: no event carries email attempts without delivery", attemptsWithoutDelivery.length === 0);
  const uncollapsed = tripEvents(tripId).filter(
    (event) => !emailed.includes(event) && event.status === "scheduled" && event.metadata?.emailCollapsed !== true
  );
  check(
    "S1 burst: every non-emailed scheduled sibling is emailCollapsed (incl. not-yet-due at run 1)",
    uncollapsed.length === 0,
    uncollapsed.map((e) => e.event_type).join(", ")
  );
  check(
    "S1 burst: emailed event is still scheduled after run 5 (push keeps retrying, email does not)",
    emailed.length === 1 && emailed[0].status === "scheduled",
    `status=${emailed[0]?.status}`
  );

  // S2: repeated polling must never re-email or re-stamp.
  const stampAfter5 = emailed[0]?.metadata?.emailSentAt;
  for (let run = 0; run < 10; run += 1) {
    rewind(tripId);
    await sendScheduledTripNotifications();
  }
  check("S2 polling: still exactly one email row after 10 more runs", dispatcherEmailLogs(tripId).length === 1);
  check(
    "S2 polling: emailSentAt stamped exactly once (value unchanged) and attempts stay 1",
    emailedEvents(tripId).length === 1 &&
      emailedEvents(tripId)[0].metadata.emailSentAt === stampAfter5 &&
      emailedEvents(tripId)[0].metadata.emailAttempts === 1
  );
  check(
    "S2 polling: emailed event still scheduled (push retry is unbounded for the emailed event)",
    emailedEvents(tripId)[0].status === "scheduled",
    `status=${emailedEvents(tripId)[0].status}`
  );
}

// --- S3: provider failure leaves emailSentAt unset, retry delivers once ----
{
  resetWorld();
  const now = Date.now();
  const tripId = "t3333333-3333-4333-8333-333333333333";
  const eventId = "e3333333-3333-4333-8333-333333333333";
  seedTrip(tripId, now);
  seedSingleEvent(tripId, now, eventId);
  providerRefuses();

  await sendScheduledTripNotifications();
  let event = tripEvents(tripId)[0];
  check(
    "S3 failure: provider refusal leaves emailSentAt unset and records the attempt",
    !event.metadata?.emailSentAt && event.metadata?.emailAttempts === 1,
    JSON.stringify(event.metadata)
  );
  check(
    "S3 failure: event stays scheduled (retryable) and the failed attempt is in the audit log",
    event.status === "scheduled" && dispatcherEmailLogs(tripId).filter((row) => row.status === "failed").length === 1
  );

  rewind(tripId);
  await sendScheduledTripNotifications();
  event = tripEvents(tripId)[0];
  check("S3 failure: second refusal increments attempts to 2, still no stamp", !event.metadata?.emailSentAt && event.metadata?.emailAttempts === 2);

  providerAccepts();
  rewind(tripId);
  await sendScheduledTripNotifications();
  event = tripEvents(tripId)[0];
  check(
    "S3 recovery: the retry delivers exactly one email and stamps emailSentAt once",
    typeof event.metadata?.emailSentAt === "string" &&
      event.metadata?.emailAttempts === 3 &&
      dispatcherEmailLogs(tripId).filter((row) => row.status === "captured").length === 1 &&
      dispatcherEmailLogs(tripId).length === 3,
    `logs=${dispatcherEmailLogs(tripId).map((r) => r.status).join(",")}`
  );

  rewind(tripId);
  await sendScheduledTripNotifications();
  event = tripEvents(tripId)[0];
  check("S3 recovery: no further attempts after delivery", event.metadata?.emailAttempts === 3 && dispatcherEmailLogs(tripId).length === 3);
}

// --- S4: persistent provider failure is bounded by the attempt cap ---------
{
  resetWorld();
  const now = Date.now();
  const tripId = "t4444444-4444-4444-8444-444444444444";
  seedTrip(tripId, now);
  seedSingleEvent(tripId, now, "e4444444-4444-4444-8444-444444444444");
  providerRefuses();

  for (let run = 0; run < 6; run += 1) {
    await sendScheduledTripNotifications();
    rewind(tripId);
  }
  const event = tripEvents(tripId)[0];
  check(
    "S4 cap: failed email attempts stop at MAX (3), emailSentAt never stamped",
    event.metadata?.emailAttempts === pushServer.MAX_COMPANION_EVENT_EMAIL_ATTEMPTS && !event.metadata?.emailSentAt,
    `attempts=${event.metadata?.emailAttempts}`
  );
  check(
    "S4 cap: exactly one failed log row per attempt (audit history, no duplicates)",
    dispatcherEmailLogs(tripId).length === 3 && dispatcherEmailLogs(tripId).every((row) => row.status === "failed")
  );
}

// --- S5: concurrent dispatcher workers still send exactly one email --------
{
  resetWorld();
  const now = Date.now();
  const tripId = "t5555555-5555-4555-8555-555555555555";
  seedTrip(tripId, now);
  seedBurst(tripId, now, { allDue: true });
  providerAccepts();

  await Promise.all([
    sendScheduledTripNotifications(),
    sendScheduledTripNotifications(),
    sendScheduledTripNotifications()
  ]);
  check(
    "S5 concurrency: 3 racing dispatcher runs produce exactly one email row",
    dispatcherEmailLogs(tripId).length === 1,
    `rows=${dispatcherEmailLogs(tripId).length}`
  );
  check("S5 concurrency: exactly one event carries emailSentAt", emailedEvents(tripId).length === 1, `${emailedEvents(tripId).length} emailed`);
  const stuck = tripEvents(tripId).filter((event) => event.status === "processing");
  check("S5 concurrency: no event is left stuck in processing", stuck.length === 0, stuck.map((e) => e.event_type).join(", "));
  const uncollapsed = tripEvents(tripId).filter(
    (event) => !emailedEvents(tripId).includes(event) && event.status === "scheduled" && event.metadata?.emailCollapsed !== true
  );
  check("S5 concurrency: every surviving scheduled sibling is emailCollapsed", uncollapsed.length === 0, uncollapsed.map((e) => e.event_type).join(", "));
}

// --- S6: terminal metadata patch helper (both exit paths share it) ---------
{
  const patch = pushServer.companionEventEmailMetadataPatch;
  if (typeof patch !== "function") {
    check("S6 helper: companionEventEmailMetadataPatch is exported", false, "export missing");
  } else {
    check(
      "S6 helper: delivered attempt patches attempts +1 and stamps emailSentAt",
      (() => {
        const p = patch({ emailAttempted: true, emailDelivered: true, emailSuppressedByCollapse: false, emailCollapsed: false, priorEmailAttempts: 0 });
        return p.emailAttempts === 1 && typeof p.emailSentAt === "string";
      })()
    );
    check(
      "S6 helper: failed attempt patches attempts +1 and never stamps",
      (() => {
        const p = patch({ emailAttempted: true, emailDelivered: false, emailSuppressedByCollapse: false, emailCollapsed: false, priorEmailAttempts: 1 });
        return p.emailAttempts === 2 && !("emailSentAt" in p);
      })()
    );
    check(
      "S6 helper: collapse-suppressed event patches emailCollapsed only",
      (() => {
        const p = patch({ emailAttempted: false, emailDelivered: false, emailSuppressedByCollapse: true, emailCollapsed: false, priorEmailAttempts: 0 });
        return p.emailCollapsed === true && !("emailAttempts" in p) && !("emailSentAt" in p);
      })()
    );
    check(
      "S6 helper: untouched event patches nothing",
      (() => {
        const p = patch({ emailAttempted: false, emailDelivered: false, emailSuppressedByCollapse: false, emailCollapsed: false, priorEmailAttempts: 0 });
        return Object.keys(p).length === 0;
      })()
    );
  }
}

// --- S6b: collapse is per-trip — a second trip still gets its one email ----
{
  resetWorld();
  const now = Date.now();
  const tripA = "t6666666-6666-4666-8666-666666666666";
  const tripB = "t7777777-7777-4777-8777-777777777777";
  seedTrip(tripA, now);
  seedTrip(tripB, now);
  seedBurst(tripA, now, { allDue: true });
  seedSingleEvent(tripB, now, "e7777777-7777-4777-8777-777777777777");
  providerAccepts();

  await sendScheduledTripNotifications();
  check(
    "S6b isolation: each trip gets exactly one emailed event in the same run",
    dispatcherEmailLogs(tripA).length === 1 && dispatcherEmailLogs(tripB).length === 1 &&
      emailedEvents(tripA).length === 1 && emailedEvents(tripB).length === 1,
    `A rows=${dispatcherEmailLogs(tripA).length} B rows=${dispatcherEmailLogs(tripB).length}`
  );
}

// --- S7: a genuinely new event (created after the burst email) may email ---
{
  resetWorld();
  const now = Date.now();
  const tripId = "t8888888-8888-4888-8888-888888888888";
  seedTrip(tripId, now);
  seedBurst(tripId, now, { allDue: true });
  providerAccepts();

  await sendScheduledTripNotifications();
  check("S7 setup: burst delivered exactly one email", dispatcherEmailLogs(tripId).length === 1);

  seedSingleEvent(tripId, Date.now(), "e8888888-8888-4888-8888-888888888888", "booking_reminder", Date.now());
  await sendScheduledTripNotifications();
  check(
    "S7 new generation: an event created after the burst email is a legitimate new alert and emails once",
    dispatcherEmailLogs(tripId).length === 2 && emailedEvents(tripId).length === 2,
    `rows=${dispatcherEmailLogs(tripId).length} emailed=${emailedEvents(tripId).length}`
  );
  rewind(tripId);
  await sendScheduledTripNotifications();
  check("S7 new generation: the new alert is not re-emailed on later runs", dispatcherEmailLogs(tripId).length === 2);
}

// --- S8: single event, capture provider — stamp exactly once ---------------
{
  resetWorld();
  const now = Date.now();
  const tripId = "t9999999-9999-4999-8999-999999999999";
  seedTrip(tripId, now);
  seedSingleEvent(tripId, now, "e9999999-9999-4999-8999-999999999999");
  providerAccepts();

  await sendScheduledTripNotifications();
  const firstStamp = tripEvents(tripId)[0].metadata?.emailSentAt;
  for (let run = 0; run < 4; run += 1) {
    rewind(tripId);
    await sendScheduledTripNotifications();
  }
  const event = tripEvents(tripId)[0];
  check(
    "S8 exactly-once: one log row, one attempt, identical stamp across 5 runs",
    dispatcherEmailLogs(tripId).length === 1 && event.metadata?.emailAttempts === 1 && event.metadata?.emailSentAt === firstStamp,
    `stamp stable=${event.metadata?.emailSentAt === firstStamp}`
  );
  assert.equal(typeof firstStamp, "string");
}

await fake.close();
const failed = results.filter((entry) => !entry.ok);
console.log(`\ncompanion email burst checks: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`failing: ${failed.map((entry) => entry.name).join(" | ")}`);
  process.exit(1);
}
console.log("companion email burst checks passed");
