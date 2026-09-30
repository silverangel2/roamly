import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20260929000400_roamly_security_definer_rpc_acl_hardening.sql", import.meta.url), "utf8");
const notificationMigration = await readFile(new URL("../supabase/migrations/20260802_roamly_notification_claims.sql", import.meta.url), "utf8");
const generationMigration = await readFile(new URL("../supabase/migrations/20260715_roamly_generation_worker.sql", import.meta.url), "utf8");
const verifiedMigration = await readFile(new URL("../supabase/migrations/20260916_roamly_verified_companion_repair.sql", import.meta.url), "utf8");
const companionNotifications = await readFile(new URL("../lib/roamly/companionNotifications.ts", import.meta.url), "utf8");
const generationQueue = await readFile(new URL("../lib/roamly/generationQueue.ts", import.meta.url), "utf8");
const repairEngine = await readFile(new URL("../lib/roamly/companionRepairEngine.ts", import.meta.url), "utf8");

const workerFunctions = [
  "roamly_claim_companion_notification_deliveries(text, integer, integer)",
  "roamly_complete_companion_notification_delivery(uuid, text, text, text, text)",
  "roamly_release_companion_notification_delivery(uuid, text, text, timestamptz, text)",
  "roamly_release_generation_layer(uuid, text, text)",
  "roamly_skip_remaining_generation_layers(uuid, text, text)"
];
const verifiedFunction = "roamly_apply_verified_companion_repair(uuid, uuid)";

for (const signature of [...workerFunctions, verifiedFunction]) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(migration, new RegExp(`public\\.${escaped}`), `${signature} remains exact and schema-qualified`);
}

for (const signature of workerFunctions) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(migration, new RegExp(`revoke execute on function public\\.${escaped}[\\s\\S]*?from public, anon, authenticated`), `${signature} denies PUBLIC, anon, and authenticated`);
  assert.match(migration, new RegExp(`grant execute on function public\\.${escaped}[\\s\\S]*?to service_role`), `${signature} preserves service_role`);
  assert.match(generationMigration + notificationMigration, new RegExp(`security definer`, "i"), "worker definitions remain SECURITY DEFINER");
}

for (const signature of workerFunctions.slice(0, 3)) {
  assert.match(notificationMigration, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${signature} still exists in its defining migration`);
}
for (const signature of workerFunctions.slice(3)) {
  assert.match(generationMigration, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${signature} still exists in its defining migration`);
}

assert.match(migration, /revoke execute on function public\.roamly_apply_verified_companion_repair\(uuid, uuid\)[\s\S]*?from public, anon/);
assert.match(migration, /grant execute on function public\.roamly_apply_verified_companion_repair\(uuid, uuid\)[\s\S]*?to authenticated/);
assert.match(verifiedMigration, /security definer/i, "verified repair remains SECURITY DEFINER");
assert.match(verifiedMigration, /if auth\.uid\(\) is null then/, "verified repair requires an authenticated caller");
assert.match(verifiedMigration, /user_id = auth\.uid\(\)/, "verified repair retains ownership checks");
assert.match(repairEngine, /params\.supabase\.rpc\("roamly_apply_verified_companion_repair"/, "verified repair remains on the authenticated caller path");

assert.match(generationQueue, /createSupabaseAdminClient\(\) \|\| client/, "generation worker uses the trusted client helper");
assert.match(generationQueue, /roamly_release_generation_layer/);
assert.match(generationQueue, /roamly_skip_remaining_generation_layers/);
assert.match(companionNotifications, /createSupabaseAdminClient\(\)/, "notification worker uses the trusted client helper");
assert.match(companionNotifications, /processQueuedCompanionNotifications/);

const migrationFunctionNames = [...migration.matchAll(/function public\.(roamly_[a-z0-9_]+)/gi)].map((match) => match[1]);
assert.deepEqual([...new Set(migrationFunctionNames)].sort(), [
  "roamly_apply_verified_companion_repair",
  "roamly_claim_companion_notification_deliveries",
  "roamly_complete_companion_notification_delivery",
  "roamly_release_companion_notification_delivery",
  "roamly_release_generation_layer",
  "roamly_skip_remaining_generation_layers"
].sort(), "migration changes no unrelated RPC ACL");

console.log("SECURITY DEFINER RPC ACL checks passed");
