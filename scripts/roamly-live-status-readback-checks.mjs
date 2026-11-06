// Live status read-back checks (2026-10-31, closure findings L5/L9).
//
// Proves, against the REAL sources (lib/roamly/liveStatus.ts,
// lib/roamly/setupState.ts, app/api/roamly/setup/complete/route.ts,
// app/api/roamly/push/subscribe/route.ts, app/api/roamly/live-status/route.ts):
//   * no roamly_push_subscriptions row -> read-back says NOT subscribed
//     and the setup "alerts" step REFUSES completion with the server's
//     own reason ("No push subscription found.");
//   * the real subscribe action writes the row -> read-back flips to
//     subscribed -> the alerts step completes;
//   * another user's row (and a disabled row, and a row tied to a
//     different trip) never satisfies this user's / this trip's step;
//   * install state present with NO row still reports not subscribed;
//   * Live activation mapping is truthful across unlocked x in-window
//     (armed), unlocked x out-of-window future/past (own reasons),
//     companion-locked x in-window (unlock reason), itinerary-not-
//     locked x in-window (lock reason), and location-not-confirmed
//     (permission reason) — every condition shows its OWN reason.
//
// Deterministic under any process TZ: trip windows are computed from
// the America/Toronto calendar at runtime and every window decision
// goes through the trip's own metadata timezone. The Supabase client
// is a fake over in-memory row arrays — outcomes are SIMULATED at the
// code layer, not production reads.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const SRC_ROOT = process.env.ROAMLY_SRC_ROOT
  ? path.resolve(process.env.ROAMLY_SRC_ROOT)
  : path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}
function eq(name, actual, expected) {
  assert.equal(actual, expected, `${name} (got ${JSON.stringify(actual)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// ---------------------------------------------------------------------------
// Fake Supabase (only the surface the exercised code uses)
// ---------------------------------------------------------------------------
const USER_ID = "user-live-status";
const OTHER_USER_ID = "user-other";

class QB {
  constructor(db, table) {
    this.db = db; this.table = table; this.filters = []; this.write = null;
  }
  select() { return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  neq(k, v) { this.filters.push((r) => r[k] !== v); return this; }
  is(k, v) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  in(k, vals) { this.filters.push((r) => vals.includes(r[k])); return this; }
  order() { return this; }
  limit() { return this; }
  upsert(row, opts) { this.write = { kind: "upsert", row, onConflict: opts?.onConflict }; return this; }
  rows() { return (this.db.tables[this.table] || []).filter((r) => this.filters.every((f) => f(r))); }
  applyWrite() {
    if (!this.write) return this.rows();
    const table = (this.db.tables[this.table] = this.db.tables[this.table] || []);
    if (this.write.kind === "upsert") {
      const key = this.write.onConflict || "id";
      const at = table.findIndex((r) => r[key] === this.write.row[key]);
      if (at >= 0) table[at] = { ...table[at], ...this.write.row };
      else table.push({ id: `sub-${table.length + 1}`, ...this.write.row });
    }
    return this.rows();
  }
  async maybeSingle() { const r = this.applyWrite(); return { data: r[0] ?? null, error: null }; }
  async single() { const r = this.applyWrite(); return { data: r[0] ?? null, error: null }; }
  then(resolve) { resolve({ data: this.applyWrite(), error: null }); }
}

function makeDb() {
  const db = {
    tables: {
      roamly_push_subscriptions: [],
      roamly_trips: [],
      roamly_location_settings: [],
      roamly_companion_preferences: []
    },
    user: { id: USER_ID, email: "owner@example.com", user_metadata: {} }
  };
  db.supabase = {
    from: (table) => new QB(db, table),
    auth: {
      updateUser: async ({ data }) => {
        db.user.user_metadata = { ...db.user.user_metadata, ...data };
        return { data: { user: db.user }, error: null };
      },
      getUser: async () => ({ data: { user: db.user }, error: null })
    }
  };
  return db;
}

// ---------------------------------------------------------------------------
// Compile the REAL sources with stubbed seams (repo vm-harness style)
// ---------------------------------------------------------------------------
function compileTs(rel, stubs) {
  const compiled = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const sandbox = {
    exports: {}, module: { exports: {} }, console, Intl, Date, Math, Number, String, Boolean, RegExp, Set, Map,
    URL, process,
    require: (id) => {
      if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
      return require(id);
    }
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: rel });
  return sandbox.module.exports;
}

const NextResponseStub = {
  NextResponse: { json: (body, init) => ({ status: init?.status ?? 200, body }) },
  NextRequest: class {}
};
const gmailGateStub = {
  readGmailGateView: async () => ({
    state: "CONNECTED", connectionStatus: "connected", lastSyncedAt: null,
    emailAddress: "owner@example.com", lastSyncErrorCode: null
  })
};

function loadModules(db) {
  const placesStub = { recommendedPlaces: [] };
  const tripTimezone = compileTs("lib/roamly/tripTimezone.ts", { "@/lib/roamly/places": placesStub });
  // Integrated-RC merge (coordinator, 2026-10-31): liveCompanion now
  // also imports the shared lib/roamly/liveEligibility.ts (timezone
  // workstream) — compile the real module over the same tripTimezone
  // binding and stub it in. Loader only; no assertion changes.
  const liveEligibility = compileTs("lib/roamly/liveEligibility.ts", { "@/lib/roamly/tripTimezone": tripTimezone });
  const liveCompanion = compileTs("lib/roamly/liveCompanion.ts", {
    "@/lib/roamly/tripTimezone": tripTimezone,
    "@/lib/roamly/liveEligibility": liveEligibility
  });
  const companionPreferences = compileTs("lib/roamly/companionPreferences.ts", {});
  const notificationTrip = compileTs("lib/roamly/notificationTrip.ts", {
    "@/lib/roamly/liveCompanion": liveCompanion,
    "@/lib/roamly/tripTimezone": tripTimezone
  });
  const selectedTrip = compileTs("lib/roamly/selectedTrip.ts", {
    "@/lib/roamly/liveCompanion": liveCompanion,
    "@/lib/roamly/notificationTrip": notificationTrip
  });
  const liveStatus = compileTs("lib/roamly/liveStatus.ts", {
    "@/lib/roamly/liveCompanion": liveCompanion,
    "@/lib/roamly/companionPreferences": companionPreferences,
    "@/lib/roamly/selectedTrip": selectedTrip
  });
  const emailSyncHealth = compileTs("lib/roamly/emailSyncHealth.ts", {});
  const setupState = compileTs("lib/roamly/setupState.ts", {
    "@/lib/roamly/gateService": gmailGateStub,
    "@/lib/roamly/emailSyncHealth": emailSyncHealth,
    "@/lib/roamly/liveStatus": liveStatus
  });
  const setupGate = compileTs("lib/roamly/setupGate.ts", {});
  const pushEndpoint = compileTs("lib/roamly/pushEndpoint.ts", {});
  const authStub = {
    requireUser: async () => ({ ok: true, supabase: db.supabase, user: db.user, userId: USER_ID }),
    requireUserOrFieldTest: async () => ({ ok: true, supabase: db.supabase, userId: USER_ID, userEmail: db.user.email, fieldTest: false })
  };
  const completeRoute = compileTs("app/api/roamly/setup/complete/route.ts", {
    "next/server": NextResponseStub,
    "@/lib/roamly/auth": authStub,
    "@/lib/roamly/gateService": gmailGateStub,
    "@/lib/roamly/setupState": setupState,
    "@/lib/roamly/liveStatus": liveStatus
  });
  const subscribeRoute = compileTs("app/api/roamly/push/subscribe/route.ts", {
    "next/server": NextResponseStub,
    "@/lib/roamly/fieldTestAccess": authStub,
    "@/lib/roamly/pushEndpoint": pushEndpoint
  });
  const liveStatusRoute = compileTs("app/api/roamly/live-status/route.ts", {
    "next/server": NextResponseStub,
    "@/lib/roamly/auth": authStub,
    "@/lib/roamly/liveStatus": liveStatus
  });
  return { liveStatus, setupState, setupGate, completeRoute, subscribeRoute, liveStatusRoute };
}

// ---------------------------------------------------------------------------
// Fixtures (windows on the America/Toronto calendar, like the grant suite)
// ---------------------------------------------------------------------------
function localDateString(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(instant);
  const v = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${v("year")}-${v("month")}-${v("day")}`;
}
function torontoWindow(startOffset, endOffset) {
  const today = localDateString(new Date(), "America/Toronto");
  const base = new Date(`${today}T12:00:00Z`);
  const plus = (d) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  return { start_date: plus(startOffset), end_date: plus(endOffset) };
}
function tripRow(id, overrides = {}) {
  return {
    id, user_id: USER_ID, status: "locked",
    itinerary_locked: true, itinerary_status: "locked", itinerary_generated_at: "2026-01-01T00:00:00.000Z",
    tracking_unlocked: true, live_companion_unlocked: true,
    ...torontoWindow(-1, 2),
    metadata: { planning: { timezone: "America/Toronto", destination: "Montreal" } },
    ...overrides
  };
}
function seedArmedAccount(db, tripOverrides = {}, locationOverrides = {}) {
  db.tables.roamly_trips.push(tripRow("trip-armed", tripOverrides));
  db.tables.roamly_location_settings.push({
    user_id: USER_ID, location_tracking_enabled: true, last_permission_state: "granted", ...locationOverrides
  });
}
const req = (body) => ({ json: async () => body, headers: { get: () => "fixture-ua" } });
const getReq = (qs) => ({ nextUrl: new URL(`http://fixture.local/api/roamly/live-status${qs}`) });
const VALID_KEYS = { p256dh: "A".repeat(87), auth: "B".repeat(22) };
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/fixture-token-1";

// ---------------------------------------------------------------------------
// A. No subscription row -> not subscribed + alerts step refuses
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  seedArmedAccount(db);
  const mods = loadModules(db);

  const status = await mods.liveStatus.readPushSubscriptionStatus(db.supabase, USER_ID);
  eq("A read-back: no row -> subscribed false", status.subscribed, false);
  eq("A read-back: reason is the server's own no-subscription string", status.reason, "No push subscription found.");

  const readback = await mods.liveStatus.getLiveStatusReadback(db.supabase, USER_ID, { tripId: "trip-armed" });
  eq("A readback endpoint source: notifications not subscribed", readback.notifications.subscribed, false);
  eq("A readback: armed trip still reports armed (facts are independent)", readback.live.armed, true);

  const complete = await mods.completeRoute.POST(req({ step: "alerts" }));
  eq("A alerts step refuses completion with no row", complete.status, 409);
  eq("A alerts refusal carries the server reason", complete.body.error, "No push subscription found.");
  eq("A alerts memory NOT recorded on refusal", db.user.user_metadata.roamly_setup?.alerts, undefined);

  const state = await mods.setupState.getRoamlySetupState(db.supabase, db.user);
  eq("A setup state: notificationsSubscribed false", state.notificationsSubscribed, false);
  eq("A setup state: alertsOnce false", state.alertsOnce, false);
  eq("A setup state: notificationsReason is the server reason", state.notificationsReason, "No push subscription found.");
}

// ---------------------------------------------------------------------------
// A2. Install state present, still no row -> STILL not subscribed
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  seedArmedAccount(db);
  db.user.user_metadata = { roamly_setup: { gmail: true, app: true, location: true } };
  const mods = loadModules(db);
  const state = await mods.setupState.getRoamlySetupState(db.supabase, db.user);
  eq("A2 install recorded once (appInstalledOnce true)", state.appInstalledOnce, true);
  eq("A2 setup otherwise complete (3 steps once)", state.complete, true);
  eq("A2 install present + no row -> notificationsSubscribed STILL false", state.notificationsSubscribed, false);
  eq("A2 alertsOnce STILL false", state.alertsOnce, false);
  const limited = mods.setupGate.setupGateLimitedFeatures(state);
  check("A2 limited-features names alerts despite install", limited.some((line) => line.includes("Live Companion alerts")));
  const complete = await mods.completeRoute.POST(req({ step: "alerts" }));
  eq("A2 alerts step still refuses despite install state", complete.status, 409);
}

// ---------------------------------------------------------------------------
// B. Real subscribe action -> row exists -> read-back + step complete
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  seedArmedAccount(db);
  const mods = loadModules(db);

  const sub = await mods.subscribeRoute.POST(req({ endpoint: ENDPOINT, keys: VALID_KEYS }));
  eq("B subscribe action succeeds", sub.status, 200);
  eq("B subscribe reports deviceRegistered", sub.body.deviceRegistered, true);
  eq("B row persisted for this user", db.tables.roamly_push_subscriptions.filter((r) => r.user_id === USER_ID && r.enabled === true).length, 1);

  const viaRoute = await mods.liveStatusRoute.GET(getReq("?tripId=trip-armed"));
  eq("B live-status route: subscribed true after subscribe", viaRoute.body.status.notifications.subscribed, true);
  eq("B live-status route: reason null when subscribed", viaRoute.body.status.notifications.reason, null);

  const complete = await mods.completeRoute.POST(req({ step: "alerts" }));
  eq("B alerts step completes once the row exists", complete.status, 200);
  eq("B alerts memory recorded", db.user.user_metadata.roamly_setup.alerts, true);
  eq("B completion response state reads subscribed", complete.body.state.notificationsSubscribed, true);

  const state = await mods.setupState.getRoamlySetupState(db.supabase, db.user);
  eq("B setup state: alertsOnce true", state.alertsOnce, true);
  const limited = mods.setupGate.setupGateLimitedFeatures({ ...state, gmailConnected: true, appInstalledOnce: true });
  check("B limited-features no longer names alerts", !limited.some((line) => line.includes("Live Companion alerts")));
}

// ---------------------------------------------------------------------------
// C. Another user's row / disabled row / other-trip row never satisfies
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  seedArmedAccount(db);
  db.tables.roamly_push_subscriptions.push(
    { id: "sub-other-user", user_id: OTHER_USER_ID, trip_id: null, endpoint: "https://fcm.googleapis.com/fcm/send/other", enabled: true },
    { id: "sub-disabled", user_id: USER_ID, trip_id: null, endpoint: "https://fcm.googleapis.com/fcm/send/disabled", enabled: false }
  );
  const mods = loadModules(db);
  const status = await mods.liveStatus.readPushSubscriptionStatus(db.supabase, USER_ID);
  eq("C other user's row + own disabled row -> still not subscribed", status.subscribed, false);
  const complete = await mods.completeRoute.POST(req({ step: "alerts" }));
  eq("C alerts step refuses on another user's row", complete.status, 409);

  db.tables.roamly_push_subscriptions.push(
    { id: "sub-other-trip", user_id: USER_ID, trip_id: "some-other-trip", endpoint: "https://fcm.googleapis.com/fcm/send/othertrip", enabled: true }
  );
  const forTrip = await mods.liveStatus.readPushSubscriptionStatus(db.supabase, USER_ID, "trip-armed");
  eq("C row tied to a different trip does not satisfy this trip", forTrip.subscribed, false);
  const readback = await mods.liveStatus.getLiveStatusReadback(db.supabase, USER_ID, { tripId: "trip-armed" });
  eq("C trip read-back agrees: not subscribed", readback.notifications.subscribed, false);
}

// ---------------------------------------------------------------------------
// D. Activation mapping — each condition shows its OWN reason
// ---------------------------------------------------------------------------
{
  const mods = loadModules(makeDb());
  const reasons = new Set();
  const granted = { locationPermission: "granted", locationEnabled: true };

  const armed = mods.liveStatus.deriveLiveActivation({ trip: tripRow("t"), ...granted });
  eq("D unlocked x in-window -> armed", armed.armed, true);
  eq("D armed status", armed.status, "active");
  eq("D armed reason is the existing ready line", armed.reason, "Live Trip Companion is ready for this trip.");

  const future = mods.liveStatus.deriveLiveActivation({ trip: tripRow("t", torontoWindow(10, 12)), ...granted });
  eq("D unlocked x future window -> not armed", future.armed, false);
  eq("D future status", future.status, "future_trip");
  eq("D future reason is the existing window string", future.reason, "Trip has not started yet.");
  reasons.add(future.reason);

  const past = mods.liveStatus.deriveLiveActivation({ trip: tripRow("t", torontoWindow(-12, -10)), ...granted });
  eq("D unlocked x past window -> completed reason", past.reason, "Trip is already complete.");
  reasons.add(past.reason);

  const lockedCompanion = mods.liveStatus.deriveLiveActivation({
    trip: tripRow("t", { tracking_unlocked: false, live_companion_unlocked: false }), ...granted
  });
  eq("D companion-locked x in-window -> not armed", lockedCompanion.armed, false);
  eq("D companion-locked status", lockedCompanion.status, "not_unlocked");
  eq("D companion-locked reason is scheduleCompanionEvents' existing string",
    lockedCompanion.reason, "Live Trip Companion is not unlocked for this trip.");
  reasons.add(lockedCompanion.reason);

  const notLocked = mods.liveStatus.deriveLiveActivation({
    trip: tripRow("t", { itinerary_locked: false, itinerary_status: "draft", itinerary_generated_at: null }), ...granted
  });
  eq("D itinerary-not-locked x in-window -> lock reason",
    notLocked.reason, "Generate and lock this itinerary before adding Live Trip Companion.");
  reasons.add(notLocked.reason);

  const noLocation = mods.liveStatus.deriveLiveActivation({
    trip: tripRow("t"), locationPermission: "prompt", locationEnabled: true
  });
  eq("D unlocked x in-window x location not confirmed -> permission reason",
    noLocation.reason, "Location permission is required for live activation.");
  reasons.add(noLocation.reason);

  const locationOff = mods.liveStatus.deriveLiveActivation({
    trip: tripRow("t"), locationPermission: "granted", locationEnabled: false
  });
  eq("D granted but switch off -> location_off", locationOff.status, "location_off");
  reasons.add(locationOff.reason);

  const noTrip = mods.liveStatus.deriveLiveActivation({ trip: null, ...granted });
  eq("D no trip -> not armed", noTrip.armed, false);
  eq("D no trip status", noTrip.status, "no_trip");
  reasons.add(noTrip.reason);

  eq("D every unmet condition shows its OWN reason (7 distinct)", reasons.size, 7);
}

// ---------------------------------------------------------------------------
// D2. Activation through the full read-back (DB facts in, status out)
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  seedArmedAccount(db, { tracking_unlocked: false, live_companion_unlocked: false });
  const mods = loadModules(db);
  const readback = await mods.liveStatus.getLiveStatusReadback(db.supabase, USER_ID, { tripId: "trip-armed" });
  eq("D2 read-back: locked companion -> not armed", readback.live.armed, false);
  eq("D2 read-back: unlock reason", readback.live.reason, "Live Trip Companion is not unlocked for this trip.");

  const db2 = makeDb();
  seedArmedAccount(db2, {}, { last_permission_state: "prompt" });
  const mods2 = loadModules(db2);
  const readback2 = await mods2.liveStatus.getLiveStatusReadback(db2.supabase, USER_ID, { tripId: "trip-armed" });
  eq("D2 read-back: location not confirmed -> permission reason",
    readback2.live.reason, "Location permission is required for live activation.");

  const db3 = makeDb();
  seedArmedAccount(db3, torontoWindow(10, 12));
  const mods3 = loadModules(db3);
  const readback3 = await mods3.liveStatus.getLiveStatusReadback(db3.supabase, USER_ID, { tripId: "trip-armed" });
  eq("D2 read-back: out-of-window -> future reason", readback3.live.reason, "Trip has not started yet.");
}

// ---------------------------------------------------------------------------
// E. Surface wiring (structural): consumers use the read-back
// ---------------------------------------------------------------------------
{
  const cascade = read("components/roamly/SetupCascade.tsx");
  check("E SetupCascade completes alerts via the verified step", cascade.includes('completeStep("alerts")'));
  check("E SetupCascade fetches the live-status read-back", cascade.includes("/api/roamly/live-status"));
  check("E SetupCascade shows the read-back activation reason on the location step", cascade.includes("liveActivation.reason"));
  check("E SetupCascade All-set line requires the subscription read-back",
    cascade.includes("setup.complete && setup.notificationsSubscribed"));
  const liveClient = read("components/trip/LiveTripClient.tsx");
  check("E Live client refreshes the read-back", liveClient.includes("refreshLiveStatus"));
  check("E Live client no longer completes setup on a GPS fix alone", !liveClient.includes("setSetupComplete(!fieldTestMode)"));
  check("E Live client setup gap keys notifications on the read-back", liveClient.includes("liveStatus.notifications.subscribed"));
  const livePage = read("app/trip/[id]/live/page.tsx");
  check("E Live page computes the read-back server-side", livePage.includes("getLiveStatusReadback"));
  check("E Live page hands the read-back to the client", livePage.includes("initialLiveStatus={liveStatus}"));
  const liveStatusSrc = read("lib/roamly/liveStatus.ts");
  check("E read-back reads the subscriptions table", liveStatusSrc.includes('from("roamly_push_subscriptions")'));
  const liveStatusCode = liveStatusSrc.replace(/\/\*[\s\S]*?\*\//g, "");
  check("E read-back code never reads install/standalone state",
    !liveStatusCode.includes("isStandalone") && !liveStatusCode.includes("pushManager") && !liveStatusCode.includes("appInstalled"));
}

console.log(`\n${passed} live status read-back checks passed (source root: ${SRC_ROOT})`);
