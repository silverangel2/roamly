// Location grant-confirmation checks (release-blocker round, 2026-10-31).
//
// END-TO-END at the code layer, against the REAL route/lib sources:
//   browser grant -> PATCH /api/roamly/location/settings (switch on)
//   -> POST /api/roamly/location/update {fresh fix, permissionState:"granted"}
//   -> POST /api/roamly/setup/complete {step:"location"}
//   -> getRoamlySetupState read-back (locationGranted / locationOnce)
//   -> setupGateLimitedFeatures (the "needs location" line clears)
//
// The Supabase client is a fake whose rpc("roamly_write_foreground_location")
// MIRRORS supabase/migrations/20260928000200_roamly_terminal_location_cleanup.sql
// line for line in behaviour (operational-trip gate, coordinate nulling when
// no operational trip, granted+coords write only where the tracking switch
// is on). The mirror is a test double for the SQL, NOT the SQL itself:
// production SQL behaviour is proven only by the migration text (cited in
// verification/live/live-results.md).
//
// Run against another source root (e.g. the pristine tree, to reproduce the
// bug before the fix) with ROAMLY_SRC_ROOT=<abs path to tree root>.
// Deterministic under any process TZ: trip windows are computed from the
// America/Toronto calendar at runtime, and fixed-instant unit checks use
// explicit zones.
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
// Fake Supabase (only the surface the exercised routes/state actually use)
// ---------------------------------------------------------------------------
const USER_ID = "005f5186-1eef-4b05-9570-fdecd956e205";

function localDateString(instant, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(instant);
  const v = (t) => parts.find((p) => p.type === t)?.value || "00";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

// Mirror of the SQL timezone extraction in migration 20260928000200:
// planning.timezone, tripPlanning.timezone, timezone, destinationTimezone,
// destination_timezone — first non-empty wins, fallback 'UTC'.
function sqlTripTimezone(metadata) {
  const root = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const planning = root.planning && typeof root.planning === "object" ? root.planning : {};
  const tripPlanning = root.tripPlanning && typeof root.tripPlanning === "object" ? root.tripPlanning : {};
  const candidates = [planning.timezone, tripPlanning.timezone, root.timezone, root.destinationTimezone, root.destination_timezone];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      try { Intl.DateTimeFormat("en-CA", { timeZone: c.trim() }).format(); return c.trim(); }
      catch { return "UTC"; }
    }
  }
  return "UTC";
}

// Mirror of roamly_has_operational_location_trip (migration 20260928000200).
function hasOperationalTrip(db, userId, tripId, now) {
  return db.trips.some((t) => {
    if (t.user_id !== userId) return false;
    if (tripId != null && t.id !== tripId) return false;
    if (!["locked", "active", "planned"].includes(String(t.status || ""))) return false;
    if (t.itinerary_locked !== true) return false;
    if (!(t.tracking_unlocked === true || t.live_companion_unlocked === true)) return false;
    if (!t.start_date || !t.end_date) return false;
    const today = localDateString(now, sqlTripTimezone(t.metadata));
    return String(t.start_date) <= today && String(t.end_date) >= today;
  });
}

// Mirror of roamly_write_foreground_location (migration 20260928000200).
function rpcWriteForegroundLocation(db, args, now = new Date()) {
  const row = db.locationSettings.get(args.p_user_id) || null;
  if (!hasOperationalTrip(db, args.p_user_id, args.p_trip_id ?? null, now)) {
    if (row) { row.last_seen_latitude = null; row.last_seen_longitude = null; row.last_seen_at = null; }
    return false;
  }
  if (!row || row.location_tracking_enabled !== true) return false;
  row.last_permission_state = "granted";
  row.last_seen_latitude = args.p_latitude;
  row.last_seen_longitude = args.p_longitude;
  row.last_seen_at = args.p_observed_at;
  return true;
}

class QB {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.write = null; this.writeKind = null; }
  select() { return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  is(k, v) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  in(k, vals) { this.filters.push((r) => vals.includes(r[k])); return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  gte() { return this; }
  upsert(row, _opts) { this.write = row; this.writeKind = "upsert"; return this; }
  update(row) { this.write = row; this.writeKind = "update"; return this; }
  insert(row) { this.write = row; this.writeKind = "insert"; return this; }
  rows() {
    const all = this.table === "roamly_location_settings"
      ? [...this.db.locationSettings.values()]
      : this.table === "roamly_trips" ? this.db.trips : [];
    return all.filter((r) => this.filters.every((f) => f(r)));
  }
  applyWrite() {
    if (!this.write) return this.rows();
    if (this.table === "roamly_location_settings") {
      const key = this.write.user_id;
      if (this.writeKind === "update") {
        const existing = this.db.locationSettings.get(key);
        if (existing) Object.assign(existing, this.write);
        return existing ? [existing] : [];
      }
      const existing = this.db.locationSettings.get(key) || { user_id: key };
      Object.assign(existing, this.write);
      this.db.locationSettings.set(key, existing);
      return [existing];
    }
    return this.rows();
  }
  async maybeSingle() { const r = this.applyWrite(); return { data: r[0] ?? null, error: null }; }
  async single() { const r = this.applyWrite(); return { data: r[0] ?? null, error: null }; }
  then(resolve) { const r = this.applyWrite(); resolve({ data: this.writeKind ? r : this.rows(), error: null }); }
}

function makeDb() {
  const db = {
    locationSettings: new Map(),
    trips: [],
    user: { id: USER_ID, email: "junel.abellana@gmail.com", user_metadata: {} },
    events: []
  };
  db.supabase = {
    from: (table) => new QB(db, table),
    rpc: async (name, args) => {
      if (name === "roamly_write_foreground_location") return { data: rpcWriteForegroundLocation(db, args), error: null };
      return { data: null, error: { message: `unknown rpc ${name}` } };
    },
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
  const source = read(rel);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const sandbox = {
    exports: {}, module: { exports: {} }, console, Intl, Date, Math, Number, String, Boolean, RegExp, Set, Map,
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
    emailAddress: "junel.abellana@gmail.com", lastSyncErrorCode: null
  })
};

function loadModules(db) {
  const location = compileTs("lib/roamly/location.ts", {});
  // Integrated-RC merge (coordinator, 2026-10-31): locationLifecycle now
  // delegates eligibility to the shared lib/roamly/liveEligibility.ts
  // (timezone workstream), which resolves zones via
  // lib/roamly/tripTimezone.ts over lib/roamly/places.ts — compile the
  // REAL chain when present and share it with the live-status seam
  // below. Older source roots without liveEligibility compile
  // locationLifecycle bare, as before. No assertion changes.
  let sharedTripTimezone = null;
  let sharedLiveEligibility = null;
  let locationLifecycle;
  if (fs.existsSync(path.join(SRC_ROOT, "lib/roamly/liveEligibility.ts"))) {
    const places = compileTs("lib/roamly/places.ts", {});
    sharedTripTimezone = compileTs("lib/roamly/tripTimezone.ts", {
      "@/lib/roamly/places": places
    });
    sharedLiveEligibility = compileTs("lib/roamly/liveEligibility.ts", {
      "@/lib/roamly/tripTimezone": sharedTripTimezone
    });
    locationLifecycle = compileTs("lib/roamly/locationLifecycle.ts", {
      "@/lib/roamly/liveEligibility": sharedLiveEligibility
    });
  } else {
    locationLifecycle = compileTs("lib/roamly/locationLifecycle.ts", {});
  }
  const emailSyncHealth = compileTs("lib/roamly/emailSyncHealth.ts", {});
  // Live-status read-back seam (integrated RC, 2026-10-31): setupState
  // now reads the push-subscription fact through lib/roamly/liveStatus.
  // Compile the real chain when the tree carries it; older trees
  // (ROAMLY_SRC_ROOT pristine runs) get an inert stub — their
  // setupState never requires it.
  let liveStatus;
  if (fs.existsSync(path.join(SRC_ROOT, "lib/roamly/liveStatus.ts"))) {
    const tripTimezone = sharedTripTimezone ?? compileTs("lib/roamly/tripTimezone.ts", {
      "@/lib/roamly/places": { recommendedPlaces: [] }
    });
    const liveCompanion = compileTs("lib/roamly/liveCompanion.ts", {
      "@/lib/roamly/tripTimezone": tripTimezone,
      ...(sharedLiveEligibility ? { "@/lib/roamly/liveEligibility": sharedLiveEligibility } : {})
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
    liveStatus = compileTs("lib/roamly/liveStatus.ts", {
      "@/lib/roamly/liveCompanion": liveCompanion,
      "@/lib/roamly/companionPreferences": companionPreferences,
      "@/lib/roamly/selectedTrip": selectedTrip
    });
  } else {
    liveStatus = {
      readPushSubscriptionStatus: async () => ({
        subscribed: false, subscriptionCount: 0, reason: "No push subscription found."
      })
    };
  }
  const setupState = compileTs("lib/roamly/setupState.ts", {
    "@/lib/roamly/gateService": gmailGateStub,
    "@/lib/roamly/emailSyncHealth": emailSyncHealth,
    "@/lib/roamly/liveStatus": liveStatus
  });
  const setupGate = compileTs("lib/roamly/setupGate.ts", {});
  const authStub = {
    requireUserOrFieldTest: async () => ({ ok: true, supabase: db.supabase, userId: USER_ID, userEmail: db.user.email, fieldTest: false }),
    requireUser: async () => ({ ok: true, supabase: db.supabase, user: db.user, userId: USER_ID })
  };
  const updateRoute = compileTs("app/api/roamly/location/update/route.ts", {
    "next/server": NextResponseStub,
    "@/lib/roamly/location": location,
    "@/lib/roamly/locationLifecycle": locationLifecycle,
    "@/lib/roamly/fieldTestAccess": authStub,
    "@/lib/roamly/events": { recordTripEvent: async () => ({}) },
    "@/lib/roamly/tripActivation": {
      activateTripIfNearby: async () => ({
        tripActivated: false, trip: null, currentDay: null, nearbyActivities: [],
        checkedActivities: [], upNextActivity: null, notification: null, error: null
      })
    },
    "@/lib/roamly/access": { getRoamlyAccessForUser: () => ({ hasQaAccess: false }) },
    "@/lib/roamly/liveCompanionDemo": { processLiveCompanionDemoUpdate: async () => ({ ok: false, error: "n/a" }) }
  });
  const settingsRoute = compileTs("app/api/roamly/location/settings/route.ts", {
    "next/server": NextResponseStub,
    "@/lib/roamly/fieldTestAccess": authStub
  });
  const completeRoute = compileTs("app/api/roamly/setup/complete/route.ts", {
    "next/server": NextResponseStub,
    "@/lib/roamly/auth": authStub,
    "@/lib/roamly/gateService": gmailGateStub,
    "@/lib/roamly/setupState": setupState,
    "@/lib/roamly/liveStatus": liveStatus
  });
  return { updateRoute, settingsRoute, completeRoute, setupState, setupGate };
}

const req = (body) => ({ json: async () => body });

// Trip window: yesterday..+2 days on the America/Toronto calendar (Montreal's zone).
function torontoWindow() {
  const today = localDateString(new Date(), "America/Toronto");
  const base = new Date(`${today}T12:00:00Z`);
  const plus = (d) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  return { start: plus(-1), end: plus(2) };
}
const MONTREAL = { latitude: 45.5019, longitude: -73.5674 };
const freshFix = () => ({ ...MONTREAL, accuracy: 12, capturedAt: new Date().toISOString(), permissionState: "granted" });

async function runGrantFlow(db, mods, { switchOn = true } = {}) {
  if (switchOn) {
    const patch = await mods.settingsRoute.PATCH(req({ locationTrackingEnabled: true, notificationEnabled: true }));
    eq("settings PATCH turns the tracking switch on", patch.status, 200);
  }
  const update = await mods.updateRoute.POST(req(freshFix()));
  const complete = await mods.completeRoute.POST(req({ step: "location" }));
  return { update, complete };
}

// ---------------------------------------------------------------------------
// Unit checks on the SQL mirror itself (fixed instants, zone-explicit)
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const nov2EveningToronto = new Date("2026-11-03T01:30:00Z"); // Nov 2, 20:30 EST in Montreal
  const base = { user_id: USER_ID, status: "locked", itinerary_locked: true, tracking_unlocked: true, live_companion_unlocked: false, start_date: "2026-10-30", end_date: "2026-11-02" };
  db.trips.push({ ...base, id: "tz-trip", metadata: { planning: { timezone: "America/Toronto" } } });
  eq("mirror: metadata-zone trip is operational on its last Toronto evening (UTC already Nov 3)",
    hasOperationalTrip(db, USER_ID, null, nov2EveningToronto), true);
  db.trips[0].metadata = {};
  eq("mirror: same trip with NO metadata timezone falls back to UTC and is NOT operational at that instant",
    hasOperationalTrip(db, USER_ID, null, nov2EveningToronto), false);
  db.trips[0].status = "generated";
  db.trips[0].metadata = { planning: { timezone: "America/Toronto" } };
  eq("mirror: status 'generated' is outside the SQL status set (locked/active/planned only)",
    hasOperationalTrip(db, USER_ID, null, nov2EveningToronto), false);
  db.trips[0].status = "locked";
  db.trips[0].tracking_unlocked = false;
  eq("mirror: locked but neither tracking nor live-companion unlocked is NOT operational",
    hasOperationalTrip(db, USER_ID, null, nov2EveningToronto), false);
}

// ---------------------------------------------------------------------------
// Scenario A1: NO trips at all (grant must still be confirmable after fix)
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  db.user.user_metadata = { roamly_setup: { gmail: true, app: true } };
  // A stale fix from an earlier terminal trip is sitting on the row; the
  // migration's cleanup intent must still erase the COORDINATES.
  db.locationSettings.set(USER_ID, {
    user_id: USER_ID, location_tracking_enabled: false, last_permission_state: null,
    last_seen_latitude: 45.5, last_seen_longitude: -73.5, last_seen_at: new Date(Date.now() - 86400_000).toISOString()
  });
  const mods = loadModules(db);
  const { update, complete } = await runGrantFlow(db, mods);
  const row = db.locationSettings.get(USER_ID);
  eq("A1 location/update still returns ok", update.status, 200);
  eq("A1 coordinate write still refused with no operational trip (last_seen_at stays null)",
    row.last_seen_at, null);
  eq("A1 coordinates erased by the RPC exactly as the migration intends", row.last_seen_latitude, null);
  eq("A1 setup/complete location succeeds once the grant fact is recorded", complete.status, 200);
  eq("A1 permission fact recorded on the settings row", row.last_permission_state, "granted");
  eq("A1 setup memory marks the location step done", db.user.user_metadata.roamly_setup.location, true);
  const state = await mods.setupState.getRoamlySetupState(db.supabase, db.user);
  eq("A1 read-back: locationGranted true", state.locationGranted, true);
  eq("A1 read-back: locationOnce true", state.locationOnce, true);
  eq("A1 read-back: locationEnabled true (switch on)", state.locationEnabled, true);
  eq("A1 read-back: full setup complete (gmail+app seeded once-flags)", state.complete, true);
  check("A1 setupGate limited-features location line clears",
    !mods.setupGate.setupGateLimitedFeatures(state).some((line) => line.includes("needs location")));
}

// ---------------------------------------------------------------------------
// Scenario A2: in-window locked trip, companion NOT unlocked (owner shape)
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const w = torontoWindow();
  db.trips.push({
    id: "1bcb0c8b-shaped-fixture", user_id: USER_ID, status: "locked", itinerary_locked: true,
    tracking_unlocked: false, live_companion_unlocked: false,
    start_date: w.start, end_date: w.end, metadata: { planning: { destination: "Montreal" } }
  });
  const mods = loadModules(db);
  const { complete } = await runGrantFlow(db, mods);
  const row = db.locationSettings.get(USER_ID);
  eq("A2 setup/complete succeeds even though live_companion_unlocked=false", complete.status, 200);
  eq("A2 permission fact recorded", row.last_permission_state, "granted");
  eq("A2 coordinates still refused (trip not operational without the unlock)", row.last_seen_at, null);
}

// ---------------------------------------------------------------------------
// Scenario B1: operational trip present — original behaviour unchanged
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const w = torontoWindow();
  db.trips.push({
    id: "operational-trip", user_id: USER_ID, status: "locked", itinerary_locked: true,
    tracking_unlocked: true, live_companion_unlocked: true,
    start_date: w.start, end_date: w.end, metadata: { planning: { timezone: "America/Toronto" } }
  });
  const mods = loadModules(db);
  const { complete } = await runGrantFlow(db, mods);
  const row = db.locationSettings.get(USER_ID);
  eq("B1 setup/complete succeeds with an operational trip", complete.status, 200);
  eq("B1 RPC wrote the coordinates (last_seen_at = the fix time)", typeof row.last_seen_at, "string");
  eq("B1 RPC wrote the latitude", row.last_seen_latitude, MONTREAL.latitude);
  eq("B1 permission fact recorded", row.last_permission_state, "granted");
}

// ---------------------------------------------------------------------------
// Scenario B2: denied — records denied, never completes as granted
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  db.locationSettings.set(USER_ID, {
    user_id: USER_ID, location_tracking_enabled: true, last_permission_state: "granted",
    last_seen_latitude: 45.5, last_seen_longitude: -73.5, last_seen_at: new Date().toISOString()
  });
  const mods = loadModules(db);
  const update = await mods.updateRoute.POST(req({ permissionState: "denied" }));
  eq("B2 denied update returns ok", update.status, 200);
  const row = db.locationSettings.get(USER_ID);
  eq("B2 denied is recorded as denied", row.last_permission_state, "denied");
  eq("B2 denied clears saved coordinates", row.last_seen_latitude, null);
  const complete = await mods.completeRoute.POST(req({ step: "location" }));
  eq("B2 setup/complete refuses after a denial", complete.status, 409);
  const state = await mods.setupState.getRoamlySetupState(db.supabase, db.user);
  eq("B2 read-back: locationGranted false after denial", state.locationGranted, false);
}

// ---------------------------------------------------------------------------
// Scenario B3: granted claim WITHOUT a real fix payload — does not confirm
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const mods = loadModules(db);
  await mods.settingsRoute.PATCH(req({ locationTrackingEnabled: true }));
  const update = await mods.updateRoute.POST(req({ permissionState: "granted" }));
  eq("B3 missing coordinates are a 400, not a confirmation", update.status, 400);
  const complete = await mods.completeRoute.POST(req({ step: "location" }));
  eq("B3 setup/complete still 409s without server-seen fix evidence", complete.status, 409);
}

// ---------------------------------------------------------------------------
// Scenario B4: stale fix — behaviour unchanged, does not confirm
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const mods = loadModules(db);
  await mods.settingsRoute.PATCH(req({ locationTrackingEnabled: true }));
  const stale = { ...MONTREAL, accuracy: 12, capturedAt: new Date(Date.now() - 30 * 60_000).toISOString(), permissionState: "granted" };
  const update = await mods.updateRoute.POST(req(stale));
  eq("B4 stale fix is reported stale", update.body.staleLocation, true);
  const row = db.locationSettings.get(USER_ID);
  check("B4 stale fix records no grant", row?.last_permission_state !== "granted");
  const complete = await mods.completeRoute.POST(req({ step: "location" }));
  eq("B4 setup/complete still 409s on a stale fix", complete.status, 409);
}

// ---------------------------------------------------------------------------
// Scenario B5: tracking switch OFF — no grant recorded (setup flow turns it
// on first via enableLocationSwitch, so the real flow is unaffected)
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  db.locationSettings.set(USER_ID, {
    user_id: USER_ID, location_tracking_enabled: false, last_permission_state: null,
    last_seen_latitude: null, last_seen_longitude: null, last_seen_at: null
  });
  const mods = loadModules(db);
  const update = await mods.updateRoute.POST(req(freshFix()));
  eq("B5 switch-off update reports trackingDisabled", update.body.trackingDisabled, true);
  const row = db.locationSettings.get(USER_ID);
  check("B5 no grant recorded while the account switch is off", row.last_permission_state !== "granted");
  const complete = await mods.completeRoute.POST(req({ step: "location" }));
  eq("B5 setup/complete still 409s while the switch is off", complete.status, 409);
}

// ---------------------------------------------------------------------------
// Thread A (grant persistence): transient watch errors must never erase a
// recorded grant or flip the switch; a true denial records the fact and
// clears coordinates but does NOT flip the traveler's switch either.
// ---------------------------------------------------------------------------
{
  const db = makeDb();
  const w = torontoWindow();
  db.trips.push({
    id: "operational-trip", user_id: USER_ID, status: "locked", itinerary_locked: true,
    tracking_unlocked: true, live_companion_unlocked: true,
    start_date: w.start, end_date: w.end, metadata: { planning: { timezone: "America/Toronto" } }
  });
  const mods = loadModules(db);
  await runGrantFlow(db, mods);
  let row = db.locationSettings.get(USER_ID);
  eq("ThreadA setup: grant recorded with coordinates", row.last_permission_state, "granted");
  check("ThreadA setup: coordinates present", typeof row.last_seen_at === "string");
  const seenBefore = row.last_seen_at;

  // Transient error reports arrive as permissionState "prompt" (the Live
  // watch's mapping) — the server must write NOTHING for them.
  const prompt = await mods.updateRoute.POST(req({ tripId: "operational-trip", permissionState: "prompt" }));
  eq("ThreadA prompt report returns ok", prompt.status, 200);
  row = db.locationSettings.get(USER_ID);
  eq("ThreadA grant survives a transient (prompt) report", row.last_permission_state, "granted");
  eq("ThreadA switch survives a transient report", row.location_tracking_enabled, true);
  eq("ThreadA last_seen preserved after a transient report", row.last_seen_at, seenBefore);
  const stateAfterPrompt = await mods.setupState.getRoamlySetupState(db.supabase, db.user);
  eq("ThreadA setup state still reads the grant after a transient report", stateAfterPrompt.locationGranted, true);

  // A true denial: fact recorded, coordinates cleared, switch NOT flipped
  // (the switch is the traveler's choice; only the settings PATCH moves it).
  const denied = await mods.updateRoute.POST(req({ tripId: "operational-trip", permissionState: "denied" }));
  eq("ThreadA denied report returns ok", denied.status, 200);
  row = db.locationSettings.get(USER_ID);
  eq("ThreadA denial is recorded as denied", row.last_permission_state, "denied");
  eq("ThreadA denial clears coordinates", row.last_seen_latitude, null);
  eq("ThreadA denial does NOT flip the traveler's switch", row.location_tracking_enabled, true);
  const completeAfterDeny = await mods.completeRoute.POST(req({ step: "location" }));
  eq("ThreadA setup/complete still refuses after a true denial", completeAfterDeny.status, 409);

  // And a fresh granted fix afterwards re-records the grant (recovery path).
  const regrant = await mods.updateRoute.POST(req(freshFix()));
  eq("ThreadA re-grant update returns ok", regrant.status, 200);
  row = db.locationSettings.get(USER_ID);
  eq("ThreadA grant recovers after a later real fix", row.last_permission_state, "granted");
}

// Client-layer structural checks (repo style): the two watch posters must
// only send a server report for a true PERMISSION_DENIED.
{
  const liveClient = read("components/trip/LiveTripClient.tsx");
  const handleError = liveClient.slice(liveClient.indexOf("const handleError = (geoError"), liveClient.indexOf("watchPosition(handlePosition, handleError"));
  check("ThreadA Live watch posts to the server only inside the denied branch",
    handleError.includes("if (denied)") && !handleError.includes("denied ? \"denied\" : \"prompt\""));
  const tracker = read("components/roamly/RoamlyLocationTracker.tsx");
  const errorCallback = tracker.slice(tracker.indexOf("async (geoError)"), tracker.indexOf("enableHighAccuracy: true, timeout: 10_000"));
  check("ThreadA shell tracker error callback inspects the geolocation error code",
    errorCallback.includes("PERMISSION_DENIED") || errorCallback.includes("code === 1"));
}

console.log(`\n${passed} location grant-confirmation checks passed (source root: ${SRC_ROOT})`);
