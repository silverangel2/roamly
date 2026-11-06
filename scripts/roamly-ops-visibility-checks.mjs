// Ops visibility checks (2026-10-31): (a) scheduling refusal records,
// (b) cron heartbeat + staleness, (c) held SMTP claims enumeration.
// Real sources compiled via the repo's vm harness; fake Supabase only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function compileTs(rel, stubs) {
  const compiled = ts.transpileModule(read(rel), {
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

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed += 1; console.log(`ok - ${name}`); }
function eq(name, a, b) { assert.equal(a, b, `${name} (got ${JSON.stringify(a)})`); passed += 1; console.log(`ok - ${name}`); }

class QB {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.write = null; this.kind = null; }
  select() { return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  is(k, v) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  in(k, vals) { this.filters.push((r) => vals.includes(r[k])); return this; }
  filter(expr, _op, v) {
    const key = expr.replace("metadata->>", "");
    this.filters.push((r) => r.metadata?.[key] === v);
    return this;
  }
  order(col, opts) { this.orderSpec = { col, asc: opts?.ascending !== false }; return this; }
  limit(n) { this.limitN = n; return this; }
  update(row) { this.write = row; this.kind = "update"; return this; }
  insert(rows) { this.write = rows; this.kind = "insert"; return this; }
  rows() { return (this.db[this.table] || []).filter((r) => this.filters.every((f) => f(r))); }
  apply() {
    if (this.kind === "insert") {
      if (this.db.failInsert?.table === this.table) return [];
      const rows = Array.isArray(this.write) ? this.write : [this.write];
      const stored = rows.map((r) => ({ id: r.id || `row-${Math.random().toString(36).slice(2, 9)}`, created_at: r.created_at || new Date().toISOString(), ...r }));
      (this.db[this.table] = this.db[this.table] || []).push(...stored);
      return stored;
    }
    if (this.kind === "update") { const m = this.rows(); for (const r of m) Object.assign(r, this.write); return m; }
    let rows = this.rows();
    if (this.orderSpec) rows = [...rows].sort((a, b) => String(a[this.orderSpec.col]).localeCompare(String(b[this.orderSpec.col])) * (this.orderSpec.asc ? 1 : -1));
    if (this.limitN) rows = rows.slice(0, this.limitN);
    return rows;
  }
  async maybeSingle() { const r = this.apply(); return { data: r[0] ?? null, error: null }; }
  then(resolve) {
    if (this.kind === "insert" && this.db.failInsert?.table === this.table) { resolve({ data: null, error: { message: this.db.failInsert.message } }); return; }
    resolve({ data: this.apply(), error: null });
  }
}
function makeDb(tables) { const db = { ...tables }; db.supabase = { from: (t) => new QB(db, t) }; return db; }

const events = compileTs("lib/roamly/events.ts", {});
const dateUtils = compileTs("lib/roamly/dateUtils.ts", {});
const tripMetadata = compileTs("lib/roamly/tripMetadata.ts", {
  "@/lib/roamly/dateUtils": dateUtils,
  "@/lib/roamly/placeResolver": { resolveCityPlace: () => null }
});
const testBooking = compileTs("lib/roamly/testBooking.ts", {});
const bookingTruth = compileTs("lib/roamly/bookingTruth.ts", { "@/lib/roamly/testBooking": testBooking });
const tripCompanion = compileTs("lib/roamly/tripCompanion.ts", {
  "@/lib/supabase/admin": { createSupabaseAdminClient: () => null },
  "@/lib/roamly/crossBorder": compileTs("lib/roamly/crossBorder.ts", {}),
  "@/lib/roamly/events": events,
  "@/lib/roamly/tripMetadata": tripMetadata,
  "@/lib/roamly/bookingSupersession": compileTs("lib/roamly/bookingSupersession.ts", {}),
  "@/lib/roamly/operationalScheduledEvents": compileTs("lib/roamly/operationalScheduledEvents.ts", {}),
  "@/lib/roamly/bookingTruth": bookingTruth
});
const heartbeat = compileTs("lib/roamly/cronHeartbeat.ts", { "@/lib/roamly/events": events });
const held = compileTs("lib/roamly/heldEmailClaims.ts", {});

const USER = "user-1";
const baseTrip = {
  id: "trip-1", user_id: USER, destination_city: "Montreal", destination_country: "Canada", origin_country: "Canada",
  start_date: "2026-11-10", end_date: "2026-11-13", status: "locked", itinerary_locked: true,
  tracking_unlocked: false, live_companion_unlocked: false, trip_companion_status: null, metadata: {}
};

// (a) locked refusal -> routine record with reason
{
  const db = makeDb({ roamly_trips: [{ ...baseTrip }], roamly_bookings: [], roamly_trip_companion_events: [], roamly_trip_events: [] });
  const res = await tripCompanion.scheduleCompanionEvents(db.supabase, "trip-1");
  eq("a locked: refuses", res.ok, false);
  eq("a locked: exactly one trip-event record", db.roamly_trip_events.length, 1);
  const rec = db.roamly_trip_events[0];
  eq("a locked: event type refused", rec.event_type, "companion_scheduling_refused");
  eq("a locked: trip id on record", rec.trip_id, "trip-1");
  eq("a locked: severity routine", rec.metadata.severity, "routine");
  check("a locked: reason recorded", String(rec.metadata.reason).includes("not unlocked"));
  check("a locked: timestamp recorded", typeof rec.metadata.recordedAt === "string");
}
// (a) unlocked failure (insert fails) -> attention record, unmissable
{
  const db = makeDb({ roamly_trips: [{ ...baseTrip, tracking_unlocked: true, live_companion_unlocked: true }], roamly_bookings: [], roamly_trip_companion_events: [], roamly_trip_events: [] });
  db.failInsert = { table: "roamly_trip_companion_events", message: "insert boom" };
  const res = await tripCompanion.scheduleCompanionEvents(db.supabase, "trip-1");
  eq("a unlocked-fail: returns failure", res.ok, false);
  const rec = db.roamly_trip_events.find((r) => r.event_type === "companion_scheduling_failed");
  check("a unlocked-fail: attention record written", Boolean(rec));
  eq("a unlocked-fail: severity attention", rec.metadata.severity, "attention");
  eq("a unlocked-fail: unlocked flag true", rec.metadata.unlocked, true);
  eq("a unlocked-fail: reason is the failure", rec.metadata.reason, "insert boom");
}
// (a) callers enumerated reach the recorder: static wiring checks
{
  const src = read("lib/roamly/tripCompanion.ts");
  check("a wiring: unlockLiveCompanion still calls scheduleCompanionEvents", /unlockLiveCompanion[\s\S]*scheduleCompanionEvents\(writer, tripId\)/.test(src));
  check("a wiring: bookings/confirm caller present", read("app/api/roamly/bookings/confirm/route.ts").includes("scheduleCompanionEvents"));
  check("a wiring: live page caller present", read("app/trip/[id]/live/page.tsx").includes("scheduleCompanionEvents"));
}

// (b) heartbeat write on handler logic + staleness
{
  const db = makeDb({ roamly_app_events: [] });
  const okWrite = await heartbeat.recordCronHeartbeat(db.supabase, "roamly-live-companion", true);
  eq("b heartbeat: write succeeds", okWrite, true);
  eq("b heartbeat: one app-event row", db.roamly_app_events.length, 1);
  eq("b heartbeat: event type", db.roamly_app_events[0].event_type, "cron_heartbeat");
  eq("b heartbeat: cron in metadata", db.roamly_app_events[0].metadata.cron, "roamly-live-companion");
  const now = new Date();
  const fresh = heartbeat.cronHeartbeatStatus("roamly-live-companion", now.toISOString(), now);
  eq("b staleness: fresh passes", fresh.stale, false);
  const old = heartbeat.cronHeartbeatStatus("roamly-live-companion", new Date(now.getTime() - 11 * 60000).toISOString(), now);
  eq("b staleness: 11min old for */5 is stale (>2x)", old.stale, true);
  eq("b staleness: never-seen is stale", heartbeat.cronHeartbeatStatus("roamly-notifications-queue", null, now).stale, true);
  const statuses = await heartbeat.getCronHeartbeatStatus(db.supabase, now);
  eq("b operator read: live-companion fresh via store", statuses.find((s) => s.cron === "roamly-live-companion").stale, false);
  eq("b operator read: notifications never seen -> stale", statuses.find((s) => s.cron === "roamly-notifications-queue").stale, true);
  check("b wiring: live-companion route records heartbeat", read("app/api/cron/roamly-live-companion/route.ts").includes("recordCronHeartbeat"));
  check("b wiring: notifications route records heartbeat", read("app/api/cron/roamly-notifications/route.ts").includes("recordCronHeartbeat"));
}

// (c) held claims enumeration: exactly ambiguous-family states
{
  const now = new Date("2026-10-31T12:00:00Z");
  const mk = (id, state, claimId, claimedAt) => ({ id, trip_id: "trip-9", created_at: claimedAt, metadata: { emailDeliveryState: state, emailClaimId: claimId, emailClaimedAt: claimedAt } });
  const db = makeDb({
    roamly_trip_companion_events: [
      mk("ev-amb", "ambiguous", "claim-amb", "2026-10-31T11:00:00Z"),
      mk("ev-inflight", "in_flight", "claim-inflight", "2026-10-31T11:30:00Z"),
      mk("ev-claimed", "claimed", "claim-claimed", "2026-10-31T11:45:00Z"),
      mk("ev-acc", "provider_accepted", "claim-acc", "2026-10-31T10:00:00Z"),
      mk("ev-fail", "provider_failed", "claim-fail", "2026-10-31T10:00:00Z"),
      mk("ev-rel", "released", "claim-rel", "2026-10-31T10:00:00Z")
    ]
  });
  const res = await held.listHeldCompanionEmailClaims(db.supabase, now);
  eq("c held: count is exactly the 3 held states", res.count, 3);
  eq("c held: claim ids exact", res.claims.map((c) => c.claimId).join(","), "claim-amb,claim-inflight,claim-claimed");
  eq("c held: oldest age 60min in ms", res.claims[0].ageMs, 3600000);
  check("c held: no accepted/failed/released", !res.claims.some((c) => ["claim-acc", "claim-fail", "claim-rel"].includes(c.claimId)));
  check("c wiring: sweep counts no longer discarded", read("lib/roamly/pushServer.ts").includes("const reconciliation = await reconcileCompanionEmailDeliveries"));
  check("c wiring: logs route selects idempotency_key + returns heldClaims", read("app/api/admin/roamly/email/logs/route.ts").includes("idempotency_key") && read("app/api/admin/roamly/email/logs/route.ts").includes("heldClaims"));
  check("c wiring: Email Center page renders held claims", read("app/admin/email/page.tsx").includes("listHeldCompanionEmailClaims"));
}

console.log(`\nOPS VISIBILITY: ${passed} checks passed`);
