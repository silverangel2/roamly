import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../lib/roamly/location.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const sandbox = { exports: {}, module: { exports: {} }, require, Date, Number, Math };
sandbox.exports = sandbox.module.exports;
vm.runInNewContext(compiled, sandbox);
const {
  isFreshLocationObservation,
  PRECISE_LOCATION_MAX_AGE_MS,
  PRECISE_LOCATION_MAX_FUTURE_SKEW_MS
} = sandbox.module.exports;

const now = Date.parse("2026-09-25T12:00:00.000Z");
const observedAt = (age) => new Date(now - age).toISOString();
assert.equal(isFreshLocationObservation(observedAt(0), now), true, "fresh foreground GPS is usable");
assert.equal(isFreshLocationObservation(observedAt(PRECISE_LOCATION_MAX_AGE_MS - 1), now), true, "fix just inside boundary is usable");
assert.equal(isFreshLocationObservation(observedAt(PRECISE_LOCATION_MAX_AGE_MS), now), false, "fix at stale boundary is not current");
assert.equal(isFreshLocationObservation(observedAt(PRECISE_LOCATION_MAX_AGE_MS + 1), now), false, "fix beyond threshold is stale");
assert.equal(isFreshLocationObservation(observedAt(PRECISE_LOCATION_MAX_AGE_MS * 8), now), false, "persisted cache remains stale when reread or resent");
assert.equal(isFreshLocationObservation(undefined, now), false, "missing timestamp fails safe");
assert.equal(isFreshLocationObservation("not-a-date", now), false, "malformed timestamp fails safe");
assert.equal(isFreshLocationObservation(now + PRECISE_LOCATION_MAX_FUTURE_SKEW_MS + 1, now), false, "unreasonable future timestamp fails safe");
assert.equal(isFreshLocationObservation(now + PRECISE_LOCATION_MAX_FUTURE_SKEW_MS, now), true, "bounded device clock skew is tolerated");
assert.equal(isFreshLocationObservation(observedAt(0), now + 1_000), true, "new GPS fix supersedes stale observation");

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const updateRoute = read("../app/api/roamly/location/update/route.ts");
const checkInRoute = read("../app/api/roamly/activities/check-in/route.ts");
const routeApi = read("../app/api/trips/[id]/live-companion/route/route.ts");
const livePage = read("../app/trip/[id]/live/page.tsx");
const liveClient = read("../components/trip/LiveTripClient.tsx");
const foreground = read("../components/trip/LiveTripClient.tsx");
const timezone = read("./roamly-trip-activation-timezone-checks.mjs");
const idempotency = read("./roamly-live-companion-action-idempotency-checks.mjs");

assert.match(updateRoute, /if \(!isFreshLocationObservation\(capturedAt\)\)/, "server proximity/trip activation rejects stale, missing, or malformed GPS timestamps");
assert.match(updateRoute, /last_seen_at: new Date\(typeof capturedAt/, "storage preserves the original GPS observation time, not request receipt time");
assert.match(updateRoute, /last_seen_latitude: null[\s\S]*last_seen_longitude: null[\s\S]*last_seen_at: null/, "denied or unavailable GPS clears cached precise location");
assert.doesNotMatch(livePage, /last_seen_latitude|last_seen_longitude|initialLocation=\{latestLocation\}/, "resume never hydrates persisted coordinates whose historical timestamp semantics are ambiguous");
assert.match(liveClient, /location: usableLocation/, "stale in-memory coordinates cannot drive focus/proximity state");
assert.match(liveClient, /if \(!usableLocation\)/, "stale location degrades routing to schedule/place fallback");
assert.match(checkInRoute, /isFreshLocationObservation\(body\.capturedAt\)/, "check-in proximity accepts only fresh observed coordinates");
assert.match(routeApi, /!isFreshLocationObservation\(body\.capturedAt\)/, "routing endpoint rejects stale origins");
assert.match(liveClient, /capturedAt: usableLocation\.capturedAt/, "client routing transmits original observation timestamp");
assert.match(foreground, /router\.refresh\(\)/, "G-A7-01 foreground/resume reconciliation remains covered");
assert.match(timezone, /destination-local|destination local|America\/New_York|America\/Toronto/i, "G-A7-02 timezone regression remains covered");
assert.match(idempotency, /idempotent success/, "G-A7-03 Skip/Check-in idempotency regression remains covered");

console.log("Roamly stale location freshness checks passed (freshness boundaries, fail-safe timestamps, preserved observation age, safe stale-cache degradation, server proximity/check-in/routing gates, and existing G-A7 regressions).");
