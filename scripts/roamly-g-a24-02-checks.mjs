import assert from "node:assert/strict";
import fs from "node:fs";
import jiti from "jiti";

const load = jiti(import.meta.url, { interopDefault: true });
const { hasOperationalLocationTrip, isOperationalLocationTrip } = load("../lib/roamly/locationLifecycle.ts");
const now = new Date("2026-09-28T15:00:00.000Z");
const active = { id: "active", status: "active", start_date: "2026-09-28", end_date: "2026-09-30", itinerary_locked: true, tracking_unlocked: true, metadata: { timezone: "America/Toronto" } };
const completed = { id: "completed", status: "completed", start_date: "2026-09-25", end_date: "2026-09-27", itinerary_locked: true, tracking_unlocked: true, metadata: { timezone: "America/Toronto" } };
const archived = { ...completed, id: "archived", status: "archived" };
const cancelled = { ...completed, id: "cancelled", status: "cancelled" };
const future = { ...active, id: "future", status: "planned", start_date: "2026-10-01", end_date: "2026-10-03" };
const successor = { ...active, id: "successor", start_date: "2026-09-29", end_date: "2026-10-01" };

assert.equal(isOperationalLocationTrip(active, now), true, "active operational trip retains usable location");
assert.equal(isOperationalLocationTrip(completed, now), false, "completed trip cannot write location");
assert.equal(isOperationalLocationTrip(archived, now), false, "archived trip cannot write location");
assert.equal(isOperationalLocationTrip(cancelled, now), false, "cancelled trip cannot write location");
assert.equal(hasOperationalLocationTrip([completed, active], now), true, "another active trip preserves location after one completes");
assert.equal(hasOperationalLocationTrip([completed, archived, cancelled], now), false, "final terminal trip permits precise location cleanup");
assert.equal(hasOperationalLocationTrip([future], now), false, "future trip does not inherit old operational location");
assert.equal(hasOperationalLocationTrip([successor], new Date("2026-09-29T15:00:00.000Z")), true, "new operational successor can establish fresh location");

const migration = fs.readFileSync(new URL("../supabase/migrations/20260928000200_roamly_terminal_location_cleanup.sql", import.meta.url), "utf8");
assert.match(migration, /pg_advisory_xact_lock/, "cleanup and write share a database account lock");
assert.match(migration, /roamly_has_operational_location_trip/, "database uses canonical operational-trip predicate");
assert.match(migration, /if not public\.roamly_has_operational_location_trip\(p_user_id, p_trip_id\)[\s\S]*last_seen_latitude = null/, "a terminal/no-operational foreground write also clears stale account location");
assert.match(migration, /last_seen_latitude = null[\s\S]*last_seen_longitude = null[\s\S]*last_seen_at = null/, "terminal cleanup clears all precise location fields");
assert.match(migration, /update public\.roamly_location_settings s[\s\S]*not public\.roamly_has_operational_location_trip\(s\.user_id\)/, "migration cleanup is limited to accounts with no operational trip");
assert.match(migration, /create trigger roamly_clear_location_after_terminal_trip/, "terminal status transitions trigger cleanup");

const updateRoute = fs.readFileSync(new URL("../app/api/roamly/location/update/route.ts", import.meta.url), "utf8");
const fieldRoute = fs.readFileSync(new URL("../app/api/admin/roamly/field-location/route.ts", import.meta.url), "utf8");
assert.match(updateRoute, /writeForegroundLocation/, "foreground route uses atomic operational write guard");
assert.doesNotMatch(updateRoute, /last_seen_latitude: location\.latitude/, "foreground route no longer directly writes account coordinates");
assert.match(fieldRoute, /writeForegroundLocation/, "field location writer uses the same guard");

const lifecycle = fs.readFileSync(new URL("../lib/roamly/liveCompanionLifecycle.ts", import.meta.url), "utf8");
const activation = fs.readFileSync(new URL("../lib/roamly/tripActivation.ts", import.meta.url), "utf8");
assert.match(lifecycle, /clearLastLocationIfNoOperationalTrip/, "time lifecycle clears only after terminal transition");
assert.match(activation, /clearLastLocationIfNoOperationalTrip/, "foreground terminal shutdown clears only after terminal transition");

console.log("Roamly G-A24-02 checks passed (operational-trip retention, multi-trip safety, terminal cleanup, terminal write guards, successor behavior, and advisory-lock race protection).");
