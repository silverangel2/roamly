// B01 (customer-booking audit): segment-replacement RPCs must bind the caller
// to the session identity. This script proves, without production access:
//   1. The correction is forward-only (the 20261014 migration is untouched).
//   2. The authenticated function gates on auth.uid() BEFORE any delete, and
//      re-checks booking + trip ownership against auth.uid() server-side.
//   3. The service function is service-role-only and never depends on a
//      session identity.
//   4. The gate logic, mirrored faithfully from the SQL predicates, denies
//      the exact B01 exploit (authenticated A naming B's identifiers) while
//      allowing A's own replacement and the trusted service path.
//   5. The TypeScript call sites route to the matching function.
// Fidelity note: this executes the gate logic as mirrored in JS and asserts
// the migration's SQL structure; it does not execute PostgreSQL. A live
// two-account test against a real database still requires the owner's
// read-only production access decision (see the PR body).
import { readFileSync } from "node:fs";
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

const oldSql = read("supabase/migrations/20261014_roamly_replace_booking_segments_rpc.sql");
const newSql = read("supabase/migrations/20261024_roamly_replace_booking_segments_auth_binding.sql");
const wallet = read("lib/roamly/bookingWallet.ts");
const affiliate = read("lib/roamly/affiliateTracking.ts");
const extraction = read("lib/roamly/bookingExtraction.ts");
const manualRoute = read("app/api/trips/[id]/bookings/route.ts");
const confirmRoute = read("app/api/roamly/bookings/confirm/route.ts");
const attachRoute = read("app/api/trips/[id]/bookings/email-imports/attach/route.ts");

// Split the new migration into the two function bodies (main first, service
// second) so assertions target the right function.
const mainBody = newSql.slice(
  newSql.indexOf("create or replace function public.roamly_replace_booking_segments("),
  newSql.indexOf("create or replace function public.roamly_replace_booking_segments_service("),
);
const serviceBody = newSql.slice(
  newSql.indexOf("create or replace function public.roamly_replace_booking_segments_service("),
);
const mainAcl = newSql.slice(newSql.indexOf("-- Authenticated path only."));
const serviceAcl = newSql.slice(newSql.indexOf("-- Service path only."));

function insertMapping(sql) {
  const start = sql.indexOf("insert into public.booking_segments (");
  const end = sql.indexOf("from jsonb_array_elements", start);
  if (start < 0 || end < 0) return null;
  return norm(sql.slice(start, end));
}

// --- A. Forward-only: the 20261014 migration is not rewritten as the fix. ---
check("old migration still gates on caller-supplied p_user_id (untouched)", oldSql.includes("user_id = p_user_id"));
check("old migration has no auth.uid() binding (fix lives in the new file)", !oldSql.includes("auth.uid()"));
check("old migration still grants authenticated + service_role (untouched)", /grant execute on function public\.roamly_replace_booking_segments\(uuid, uuid, uuid, jsonb\)\s+to authenticated, service_role/.test(oldSql));

// --- B. Authenticated function: binding before any delete, server-side. ---
const bindIdx = mainBody.indexOf("p_user_id is distinct from auth.uid()");
const deleteIdx = mainBody.indexOf("delete from public.booking_segments");
check("authenticated function binds p_user_id to auth.uid()", bindIdx >= 0);
check("authenticated function rejects a null session identity", mainBody.includes("auth.uid() is null"));
check("binding gate sits BEFORE the delete", bindIdx >= 0 && deleteIdx > bindIdx);
check("ownership predicate uses auth.uid(), not the caller value", mainBody.includes("b.user_id = auth.uid()"));
check("trip ownership is re-checked against auth.uid()", mainBody.includes("t.user_id = auth.uid()"));
check("booking row is locked FOR UPDATE OF b", mainBody.includes("for update of b"));
check("authenticated function keeps SECURITY DEFINER + public search_path", mainBody.includes("security definer") && mainBody.includes("set search_path = public"));
check(
  "authenticated ACL revokes service_role (no silent server-path fallback)",
  /revoke all on function public\.roamly_replace_booking_segments\(uuid, uuid, uuid, jsonb\)\s+from public, anon, service_role/.test(mainAcl),
);
check(
  "authenticated ACL grants authenticated only",
  /grant execute on function public\.roamly_replace_booking_segments\(uuid, uuid, uuid, jsonb\)\s+to authenticated;/.test(mainAcl),
);

// --- C. Service function: trusted path, service-role only. ---
check("service function is defined", serviceBody.includes("roamly_replace_booking_segments_service"));
check("service function never depends on auth.uid()", !serviceBody.includes("auth.uid()"));
check("service function still checks caller-supplied ownership", serviceBody.includes("user_id = p_user_id") && serviceBody.includes("trip_id = p_trip_id"));
check("service function keeps the FOR UPDATE lock", serviceBody.includes("for update"));
check(
  "service ACL revokes authenticated (unreachable from a user session)",
  /revoke all on function public\.roamly_replace_booking_segments_service\(uuid, uuid, uuid, jsonb\)\s+from public, anon, authenticated/.test(serviceAcl),
);
check(
  "service ACL grants service_role only",
  /grant execute on function public\.roamly_replace_booking_segments_service\(uuid, uuid, uuid, jsonb\)\s+to service_role;/.test(serviceAcl),
);

// --- D. Segment mapping identical across old, authenticated, and service. ---
const oldMap = insertMapping(oldSql);
const mainMap = insertMapping(mainBody);
const serviceMap = insertMapping(serviceBody);
check("segment mapping extracted from all three functions", Boolean(oldMap && mainMap && serviceMap));
check("authenticated mapping is identical to the 20261014 mapping", oldMap !== null && oldMap === mainMap);
check("service mapping is identical to the 20261014 mapping", oldMap !== null && oldMap === serviceMap);

// --- E. Gate-logic simulation, mirrored exactly from the SQL predicates. ---
// Booking B belongs to user B on trip T (also B's). Trip T2 belongs to user A.
const bookingB = { id: "booking-b", user_id: "user-b", trip_id: "trip-t" };
const tripT = { id: "trip-t", user_id: "user-b" };
const tripT2 = { id: "trip-t2", user_id: "user-a" };
// Authenticated function: null ids -> deny; session null or p_user_id !=
// session -> deny; booking.user_id != session or booking.trip_id != p_trip_id
// or trip.user_id != session -> deny; else allow.
function authenticatedGate({ sessionUid, pUserId, pTripId, booking, trip }) {
  if (!booking?.id || !pUserId || !pTripId) return false;
  if (sessionUid == null || pUserId !== sessionUid) return false;
  if (!booking || booking.user_id !== sessionUid || booking.trip_id !== pTripId) return false;
  if (!trip || trip.user_id !== sessionUid) return false;
  return true;
}
// Service function: null ids -> deny; booking must match supplied ids.
function serviceGate({ pUserId, pTripId, booking }) {
  if (!booking?.id || !pUserId || !pTripId) return false;
  return booking.user_id === pUserId && booking.trip_id === pTripId;
}
// ACL simulation: which (role, function) pairs may execute.
function aclAllows(role, fn) {
  if (fn === "main") return role === "authenticated";
  if (fn === "service") return role === "service_role";
  return false;
}
function attempt(role, fn, args) {
  if (!aclAllows(role, fn)) return false;
  return fn === "main" ? authenticatedGate(args) : serviceGate(args);
}
check("A replaces A's own segments (authenticated path)", attempt("authenticated", "main", { sessionUid: "user-a", pUserId: "user-a", pTripId: "trip-t2", booking: { id: "booking-a", user_id: "user-a", trip_id: "trip-t2" }, trip: tripT2 }));
check("B01 EXPLOIT DENIED: A naming B's ids cannot touch B's segments", !attempt("authenticated", "main", { sessionUid: "user-a", pUserId: "user-b", pTripId: "trip-t", booking: bookingB, trip: tripT }));
check("A naming own id but B's booking is denied", !attempt("authenticated", "main", { sessionUid: "user-a", pUserId: "user-a", pTripId: "trip-t", booking: bookingB, trip: tripT }));
check("A's booking on B's trip is denied (trip re-check)", !attempt("authenticated", "main", { sessionUid: "user-a", pUserId: "user-a", pTripId: "trip-t", booking: { id: "booking-a", user_id: "user-a", trip_id: "trip-t" }, trip: tripT }));
check("service-role JWT calling the authenticated function is denied", !attempt("service_role", "main", { sessionUid: null, pUserId: "user-b", pTripId: "trip-t", booking: bookingB, trip: tripT }));
check("service path replaces B's segments for a trusted server caller", attempt("service_role", "service", { pUserId: "user-b", pTripId: "trip-t", booking: bookingB }));
check("authenticated caller cannot invoke the service function (ACL)", !attempt("authenticated", "service", { sessionUid: "user-a", pUserId: "user-b", pTripId: "trip-t", booking: bookingB }));
check("null ids are denied on both paths", !attempt("authenticated", "main", { sessionUid: "user-a", pUserId: null, pTripId: "trip-t", booking: bookingB, trip: tripT }) && !attempt("service_role", "service", { pUserId: null, pTripId: "trip-t", booking: bookingB }));

// --- F. Call-site routing. ---
check("bookingWallet routes by segmentReplacement with both RPC names", wallet.includes('"roamly_replace_booking_segments_service"') && wallet.includes('"roamly_replace_booking_segments"') && wallet.includes('segmentReplacement === "service"'));
check("bookingWallet default is the authenticated function", /params\.segmentReplacement === "service"\s+\? "roamly_replace_booking_segments_service"\s+:\s+"roamly_replace_booking_segments"/.test(wallet));
check("bookingWallet param type declares both literals", wallet.includes('segmentReplacement?: "authenticated" | "service"'));
check("affiliate webhook flow uses the service function", affiliate.includes('segmentReplacement: "service"'));
check("gmail sync uses service only with the admin client", extraction.includes('const adminClient = createSupabaseAdminClient();') && extraction.includes('segmentReplacement: adminClient ? "service" : "authenticated"'));
check("manual booking route uses the default authenticated path", !manualRoute.includes("segmentReplacement"));
check("screenshot confirm route uses the default authenticated path", !confirmRoute.includes("segmentReplacement"));
check("email attach route uses the default authenticated path", !attachRoute.includes("segmentReplacement"));

console.log(`\n${count - failures.length}/${count} checks passed.`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
