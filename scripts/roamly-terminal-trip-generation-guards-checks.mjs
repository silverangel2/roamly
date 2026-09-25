import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261001000100_roamly_terminal_trip_generation_guards.sql"),
  "utf8"
);
const lifecycle = fs.readFileSync(path.join(root, "lib/roamly/generationLifecycle.ts"), "utf8");
const queue = fs.readFileSync(path.join(root, "lib/roamly/generationQueue.ts"), "utf8");
const worker = fs.readFileSync(path.join(root, "lib/roamly/generationWorker.ts"), "utf8");
const finalization = fs.readFileSync(path.join(root, "lib/roamly/generationFinalization.ts"), "utf8");

const isTerminal = (trip) =>
  ["archived", "cancelled", "completed"].includes(String(trip.status || "").toLowerCase()) ||
  String(trip.itinerary_status || "").toLowerCase() === "cancelled";

for (const status of ["archived", "cancelled", "completed"]) {
  assert.equal(isTerminal({ status }), true, `${status} must be terminal`);
}
assert.equal(isTerminal({ status: "generating", itinerary_status: "cancelled" }), true);
for (const status of ["draft", "preview", "generating", "generated", "locked", "active"]) {
  assert.equal(isTerminal({ status, itinerary_status: "generating" }), false, `${status} must remain eligible`);
}

assert.match(lifecycle, /archived.*cancelled.*completed/s);
assert.match(lifecycle, /itinerary_status.*cancelled/s);

const claimFunctions = [
  migration.slice(migration.indexOf("create or replace function public.roamly_claim_generation_jobs"), migration.indexOf("create or replace function public.roamly_claim_generation_job_by_trip")),
  migration.slice(migration.indexOf("create or replace function public.roamly_claim_generation_job_by_trip"), migration.indexOf("create or replace function public.roamly_finalize_generation_trip"))
];
for (const claim of claimFunctions) {
  assert.match(claim, /join public\.roamly_trips t/);
  assert.match(claim, /t\.status not in \('archived', 'cancelled', 'completed'\)/);
  assert.match(claim, /coalesce\(t\.itinerary_status, ''\) <> 'cancelled'/);
  assert.match(claim, /j\.id/);
}

assert.match(migration, /create trigger roamly_stop_generation_on_terminal_trip/);
assert.match(migration, /status = 'cancelled'/);
assert.match(migration, /status = 'skipped'/);
assert.match(migration, /cancelled_at = coalesce\(cancelled_at, now\(\)\)/);

assert.match(migration, /create or replace function public\.roamly_finalize_generation_trip/);
assert.match(migration, /returns boolean/);
assert.match(migration, /and status not in \('archived', 'cancelled', 'completed'\)/);
assert.match(migration, /and coalesce\(itinerary_status, ''\) <> 'cancelled'/);
assert.match(migration, /grant execute on function public\.roamly_finalize_generation_trip.*service_role/);
assert.match(migration, /revoke all on function public\.roamly_finalize_generation_trip.*authenticated/);

assert.match(migration, /create or replace function public\.roamly_finalize_generation_completion/);
assert.match(migration, /error', 'TRIP_TERMINAL'/);

const createJobGuard = queue.slice(queue.indexOf("export async function createOrResumeGenerationJob"));
assert.match(createJobGuard, /from\("roamly_trips"\)/);
assert.match(createJobGuard, /generationTripIsTerminal/);
assert.match(createJobGuard, /TRIP_TERMINAL/);

assert.match(worker, /generationTripIsTerminal\(trip\)/);
assert.match(worker, /cancelGenerationJobForTerminalTrip/);
assert.match(worker, /skipped: true/);

const finalizer = finalization.slice(finalization.indexOf("async function finalizeTripDirectly"));
assert.match(finalizer, /rpc\("roamly_finalize_generation_trip"/);
assert.match(finalizer, /data !== true/);
assert.match(finalizer, /TRIP_TERMINAL/);
assert.match(finalization, /generationTripIsTerminal\(trip\)/);
assert.match(finalization, /generationTripIsTerminal\(current\.trip\)/);

console.log("Roamly terminal-trip generation guard checks passed");
