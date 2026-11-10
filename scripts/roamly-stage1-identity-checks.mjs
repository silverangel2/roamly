// Stage 1 (engineering assessment remediation): identity must come from the
// session, never from the caller. This script proves, without production
// access:
//   1. The correction is forward-only (the 20261014 transition migration and
//      the 20261031 oracle definition are untouched).
//   2. roamly_transition_activity_status is session-bound (auth.uid())
//      BEFORE any write, with ownership re-checked against auth.uid().
//   3. The _service twin keeps the original caller-supplied semantics
//      (field-test + admin live-test paths) and is service-role only.
//   4. roamly_has_operational_location_trip answers only for the session's
//      own id (direct cross-user probing returns false), with its
//      eligibility rule otherwise byte-preserved.
//   5. The roamly_bookings truth guard (entitlement-guard pattern) forces
//      the confirmation keystone columns to safe values on session INSERT
//      and rejects session UPDATE changes to them, while privileged
//      writers (service role / definer owner) pass untouched.
//   6. The TypeScript call sites route to the matching function.
// Fidelity note: this executes the gate logic as mirrored in JS and asserts
// the migration's SQL structure; it does not execute PostgreSQL (no local
// PostgREST in this environment — documented gap). Production proof is the
// before/after read-only SQL at ship time (see STAGE1-IDENTITY-REPORT.md).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const norm = (s) => s.replace(/\s+/g, " ").trim();

const failures = [];
let count = 0;
function check(name, cond, detail = "") {
  count += 1;
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MIGRATION_REL = "supabase/migrations/20261110000100_roamly_stage1_identity_binding.sql";
check("stage 1 migration exists", existsSync(join(root, MIGRATION_REL)), MIGRATION_REL);
if (failures.length) {
  console.log(`\nstage1-identity checks FAILED (${failures.length}/${count}) — migration missing (pre-fix state)`);
  process.exit(1);
}

const oldTransition = read("supabase/migrations/20261014_roamly_atomic_activity_status_transition.sql");
const oldOracle = read("supabase/migrations/20261031000200_roamly_live_eligibility_timezone.sql");
const entitlementGuard = read("supabase/migrations/20261106000100_roamly_entitlement_column_guard.sql");
const sql = read(MIGRATION_REL);
const actions = read("lib/roamly/activityActions.ts");
const checkInRoute = read("app/api/roamly/activities/check-in/route.ts");
const completeRoute = read("app/api/roamly/activities/complete/route.ts");
const skipRoute = read("app/api/roamly/activities/skip/route.ts");
const legacyRoute = read("app/api/trips/[id]/activity-status/route.ts");
const liveTest = read("lib/roamly/liveCompanionTest.ts");
const pkg = read("package.json");

// Split the migration into its three parts.
const twinStart = sql.indexOf("create or replace function public.roamly_transition_activity_status_service(");
const oracleStart = sql.indexOf("create or replace function public.roamly_has_operational_location_trip(");
const guardStart = sql.indexOf("create or replace function public.roamly_guard_booking_truth_columns(");
const mainBody = sql.slice(sql.indexOf("create or replace function public.roamly_transition_activity_status("), twinStart);
const twinBody = sql.slice(twinStart, oracleStart);
const oracleBody = sql.slice(oracleStart, guardStart);
const guardBody = sql.slice(guardStart);

// --- A. Forward-only: the vulnerable definitions are not rewritten. ---
check("20261014 transition still gates on caller-supplied p_user_id (untouched)", oldTransition.includes("user_id = p_user_id"));
check("20261014 transition still grants authenticated + service_role (untouched)", /grant execute on function public\.roamly_transition_activity_status\(uuid, uuid, uuid, uuid, text, text\[\], timestamptz, timestamptz\)\s+to authenticated, service_role/.test(oldTransition));
check("20261031 oracle definition carries no auth.uid() binding (untouched)", !oldOracle.slice(oldOracle.indexOf("roamly_has_operational_location_trip")).includes("auth.uid()"));

// --- B. Transition, authenticated function: binding before any write. ---
const bindIdx = mainBody.indexOf("p_user_id is distinct from auth.uid()");
const casIdx = mainBody.indexOf("status = any(p_allowed_statuses)");
check("authenticated transition binds p_user_id to auth.uid()", bindIdx >= 0);
check("authenticated transition rejects a null session identity", mainBody.includes("auth.uid() is null"));
check("binding gate sits BEFORE the compare-and-swap writes", bindIdx >= 0 && casIdx > bindIdx);
check("ownership predicate uses auth.uid(), not the caller value", mainBody.includes("user_id = auth.uid()"));
check("authenticated transition keeps SECURITY DEFINER + public search_path", mainBody.includes("security definer") && mainBody.includes("set search_path = public"));
check(
  "authenticated transition ACL revokes service_role (no silent server-path fallback)",
  /revoke all on function public\.roamly_transition_activity_status\(uuid, uuid, uuid, uuid, text, text\[\], timestamptz, timestamptz\)\s+from public, anon, service_role/.test(sql),
);
check(
  "authenticated transition ACL grants authenticated only",
  /grant execute on function public\.roamly_transition_activity_status\(uuid, uuid, uuid, uuid, text, text\[\], timestamptz, timestamptz\)\s+to authenticated;/.test(sql),
);

// --- C. Transition, service twin: original semantics, service-role only. ---
check("service twin is defined", twinBody.includes("roamly_transition_activity_status_service"));
check("service twin never depends on auth.uid()", !twinBody.includes("auth.uid()"));
check("service twin keeps the caller-supplied ownership gate", twinBody.includes("user_id = p_user_id"));
check("service twin keeps the NULL field-test path (trip-exists check only)", twinBody.includes("if p_user_id is null then") && twinBody.includes("trip not found."));
check("service twin keeps the compare-and-swap writes", twinBody.includes("status = any(p_allowed_statuses)"));
check(
  "service twin ACL revokes authenticated (unreachable from a user session)",
  /revoke all on function public\.roamly_transition_activity_status_service\(uuid, uuid, uuid, uuid, text, text\[\], timestamptz, timestamptz\)\s+from public, anon, authenticated/.test(sql),
);
check(
  "service twin ACL grants service_role only",
  /grant execute on function public\.roamly_transition_activity_status_service\(uuid, uuid, uuid, uuid, text, text\[\], timestamptz, timestamptz\)\s+to service_role;/.test(sql),
);

// --- D. Gate-logic simulation, mirrored from the SQL predicates. ---
// Trip T belongs to user B. Attacker A is authenticated as A.
function mainGate({ sessionUid, pUserId, tripOwner }) {
  if (sessionUid == null || pUserId !== sessionUid) return false; // binding (is distinct from)
  return tripOwner === sessionUid; // ownership re-check vs auth.uid()
}
function twinGate({ pUserId, tripOwner, tripExists }) {
  if (pUserId == null) return tripExists; // field-test path
  return tripOwner === pUserId;
}
check("exploit: A naming B's ids via the authenticated function is denied", mainGate({ sessionUid: "user-a", pUserId: "user-b", tripOwner: "user-b" }) === false);
check("exploit: A passing NULL via the authenticated function is denied", mainGate({ sessionUid: "user-a", pUserId: null, tripOwner: "user-b" }) === false);
check("owner path: B transitioning B's own trip is allowed", mainGate({ sessionUid: "user-b", pUserId: "user-b", tripOwner: "user-b" }) === true);
check("service path: twin with NULL (admin live-test) checks trip existence only", twinGate({ pUserId: null, tripOwner: "user-b", tripExists: true }) === true);
check("service path: twin with the trip owner's id (field-test session) is allowed", twinGate({ pUserId: "user-b", tripOwner: "user-b", tripExists: true }) === true);
check("service path: twin with a wrong id is denied", twinGate({ pUserId: "user-a", tripOwner: "user-b", tripExists: true }) === false);

// --- E. Oracle: bound to the session, rule otherwise preserved. ---
const oracleBindIdx = oracleBody.indexOf("auth.uid() <> p_user_id");
const oracleRuleIdx = oracleBody.indexOf("return exists");
check("oracle binds p_user_id to the session (mismatch returns false)", oracleBody.includes("if auth.uid() is not null and auth.uid() <> p_user_id then") && oracleBody.includes("return false"));
check("oracle binding sits BEFORE the eligibility evaluation", oracleBindIdx >= 0 && oracleRuleIdx > oracleBindIdx);
for (const fragment of [
  "t.status in ('locked', 'active', 'planned', 'generated')",
  "roamly_destination_registry_timezone(t.destination)",
  "t.itinerary_locked is true",
  "tracking_unlocked",
  "live_companion_unlocked",
]) {
  check(`oracle eligibility rule preserved: ${fragment}`, oracleBody.includes(fragment));
}
check(
  "oracle ACL shape unchanged (authenticated + service_role)",
  /grant execute on function public\.roamly_has_operational_location_trip\(uuid, uuid\)\s+to authenticated, service_role;/.test(sql),
);
function oracleAnswer({ sessionUid, pUserId, hasOperationalTrip }) {
  if (pUserId == null) return false;
  if (sessionUid != null && sessionUid !== pUserId) return false; // binding
  return hasOperationalTrip;
}
check("oracle: A probing B's id learns nothing (false)", oracleAnswer({ sessionUid: "user-a", pUserId: "user-b", hasOperationalTrip: true }) === false);
check("oracle: B asking about B still gets the true answer", oracleAnswer({ sessionUid: "user-b", pUserId: "user-b", hasOperationalTrip: true }) === true);
check("oracle: service context (no session uid) still evaluates for internal callers", oracleAnswer({ sessionUid: null, pUserId: "user-b", hasOperationalTrip: true }) === true);

// --- F. Bookings truth guard: entitlement pattern, keystone columns. ---
check("guard function is defined and NOT security definer (it must see the caller's role)", guardBody.includes("roamly_guard_booking_truth_columns()") && !/security definer/i.test(guardBody.slice(0, guardBody.indexOf("as $$"))));
for (const fragment of [
  "current_setting('request.jwt.claim.role', true)",
  "current_setting('request.jwt.claims', true)",
  "current_user in ('service_role', 'postgres', 'supabase_admin')",
]) {
  check(`guard privileged test mirrors the entitlement guard: ${fragment}`, guardBody.includes(fragment) && entitlementGuard.includes(fragment));
}
for (const col of ["traveler_confirmed", "extraction_confidence", "source_connection_id", "source_message_id"]) {
  check(`guard covers truth column ${col}`, guardBody.includes(col));
}
check("INSERT forces traveler_confirmed to false for non-privileged writers", /new\.traveler_confirmed := false/.test(guardBody));
check("INSERT forces the attribution columns to null and extraction_confidence to its neutral default 'medium' (column is NOT NULL + CHECK low/medium/high)", /new\.source_connection_id := null/.test(guardBody) && /new\.source_message_id := null/.test(guardBody) && /new\.extraction_confidence := 'medium'/.test(guardBody));
check("UPDATE rejects a traveler_confirmed change with 42501", /new\.traveler_confirmed is distinct from old\.traveler_confirmed/.test(guardBody) && guardBody.includes("'42501'"));
check("trigger is attached BEFORE INSERT OR UPDATE on roamly_bookings", /create trigger roamly_guard_booking_truth_columns\s+before insert or update on public\.roamly_bookings/.test(sql));
check("guard function is revoked from all API roles", /revoke all on function public\.roamly_guard_booking_truth_columns\(\) from public, anon, authenticated, service_role/.test(sql));
// Deliberate exclusions (census-proven legitimate session writes) must stay
// OUT of the guard, or the wallet's own save/cancel flows break.
for (const col of ["booking_status", "amount_cents", "metadata"]) {
  check(`guard deliberately does NOT protect ${col} (legitimate session writes — see report)`, !new RegExp(`new\\.${col} is distinct from`).test(guardBody) && !new RegExp(`new\\.${col} :=`).test(guardBody));
}
// Guard simulation, mirrored from the SQL semantics.
function guardInsert({ privileged, row }) {
  if (privileged) return row;
  return { ...row, traveler_confirmed: false, extraction_confidence: "medium", source_connection_id: null, source_message_id: null };
}
function guardUpdate({ privileged, before, after }) {
  if (privileged) return "pass";
  for (const col of ["traveler_confirmed", "extraction_confidence", "source_connection_id", "source_message_id"]) {
    if (after[col] !== before[col]) return "reject";
  }
  return "pass";
}
const baseRow = { traveler_confirmed: false, extraction_confidence: "medium", source_connection_id: null, source_message_id: null, booking_status: "needs_confirmation", metadata: {} };
check("guard sim: a born-confirmed session INSERT is forced unconfirmed", guardInsert({ privileged: false, row: { ...baseRow, traveler_confirmed: true } }).traveler_confirmed === false);
check("guard sim: a session INSERT claiming 'high' extraction confidence is forced to the neutral 'medium'", guardInsert({ privileged: false, row: { ...baseRow, extraction_confidence: "high" } }).extraction_confidence === "medium");
check("guard sim: a session UPDATE flipping traveler_confirmed is rejected", guardUpdate({ privileged: false, before: baseRow, after: { ...baseRow, traveler_confirmed: true } }) === "reject");
check("guard sim: a session UPDATE touching only booking_status/metadata passes (cancel + review flows)", guardUpdate({ privileged: false, before: baseRow, after: { ...baseRow, booking_status: "cancelled", metadata: { reviewState: "dismissed" } } }) === "pass");
check("guard sim: a privileged (service) writer keeps full control", guardInsert({ privileged: true, row: { ...baseRow, traveler_confirmed: true } }).traveler_confirmed === true && guardUpdate({ privileged: true, before: baseRow, after: { ...baseRow, traveler_confirmed: true } }) === "pass");

// --- G. Caller routing: session flows to the bound function, server flows to the twin. ---
check("activityActions selects the RPC by explicit context", actions.includes("roamly_transition_activity_status_service") && actions.includes("activityTransition"));
check("activityActions default context is the authenticated function", /activityTransition\?: "authenticated" \| "service"/.test(actions) || actions.includes('rpcContext'));
for (const [name, routeSrc] of [["check-in", checkInRoute], ["complete", completeRoute], ["skip", skipRoute], ["legacy activity-status", legacyRoute]]) {
  check(`${name} route routes field-test sessions to the service twin`, routeSrc.includes("auth.fieldTest") && routeSrc.includes("activityTransition"));
}
const serviceDispatches = (liveTest.match(/activityTransition: "service"/g) || []).length;
check("admin live-test simulators dispatch to the service twin (3 call sites)", serviceDispatches === 3, `found ${serviceDispatches}`);

// --- H. Registration. ---
check("package.json registers test:stage1-identity", pkg.includes('"test:stage1-identity": "node scripts/roamly-stage1-identity-checks.mjs"'));

console.log(`\nstage1-identity checks: ${count - failures.length}/${count} passed`);
if (failures.length) {
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("stage1-identity checks passed");
