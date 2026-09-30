import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const originalMigration = read("supabase/migrations/20260715_roamly_generation_scalability.sql");
const correctiveMigration = read("supabase/migrations/20260929000200_roamly_generation_queue_admin_view_hardening.sql");
const generationScalability = read("lib/roamly/generationScalability.ts");
const adminRoute = read("app/api/admin/roamly/generation-queue/route.ts");
const adminGuard = read("lib/roamly/adminGuard.ts");

assert.match(originalMigration, /create or replace view public\.roamly_generation_queue_admin/i);
for (const column of [
  "j.id",
  "j.trip_id",
  "j.user_id",
  "j.status",
  "j.priority",
  "j.paid_priority",
  "j.user_plan",
  "j.current_stage",
  "j.retry_count",
  "j.next_attempt_at",
  "j.lease_expires_at",
  "j.last_error_code",
  "j.last_error_message",
  "j.dead_lettered_at",
  "j.dead_letter_reason",
  "j.created_at",
  "j.started_at",
  "j.completed_at",
  "j.updated_at",
  "count(l.id) as layer_count",
  "completed_layer_count",
  "layer_estimated_cost_usd"
]) {
  assert.match(originalMigration, new RegExp(column.replace(/[().]/g, "\\$&"), "i"), `view shape must retain ${column}`);
}
assert.match(originalMigration, /left join public\.roamly_trip_generation_layers l on l\.job_id = j\.id/i);
assert.match(originalMigration, /group by j\.id/i);

assert.match(correctiveMigration, /alter view public\.roamly_generation_queue_admin\s+set \(security_invoker = true\)/i);
for (const role of ["public", "anon", "authenticated"]) {
  assert.match(
    correctiveMigration,
    new RegExp(`revoke all on table public\\.roamly_generation_queue_admin from ${role}\\s*;`, "i"),
    `${role} must have no view access`
  );
}
assert.match(correctiveMigration, /grant select on table public\.roamly_generation_queue_admin to service_role\s*;/i);
assert.match(correctiveMigration, /notify pgrst, 'reload schema'/i);

for (const forbidden of [
  "roamly_market_prices",
  "roamly_has_operational_location_trip",
  "create policy",
  "insert into",
  "update public",
  "delete from",
  "drop view",
  "drop table"
]) {
  assert.equal(correctiveMigration.toLowerCase().includes(forbidden), false, `corrective migration must not touch ${forbidden}`);
}

assert.match(generationScalability, /createSupabaseAdminClient\(\) \|\| params\.supabase/);
assert.match(generationScalability, /\.from\("roamly_generation_queue_admin"\)/);
assert.match(adminRoute, /requireRoamlyAdmin\(\)/);
assert.match(adminRoute, /listAdminGenerationQueue/);
assert.match(adminGuard, /createSupabaseAdminClient\(\)/);
assert.match(adminGuard, /status: 401/);

assert.equal(correctiveMigration.includes("CREATE OR REPLACE VIEW"), false, "view definition must remain unchanged");
assert.equal(correctiveMigration.includes("security_definer"), false, "do not reintroduce security-definer view behavior");

console.log("roamly generation queue admin view security checks passed");
