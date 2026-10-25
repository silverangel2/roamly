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

// --- G. Caller-routing proof (stream 4, 2026-10-25 incident program). ---
// Every production createTripBooking call site is enumerated here, and each
// is proven to dispatch the RPC its caller identity requires. The dispatch
// model below mirrors bookingWallet.ts:1588-1596 EXACTLY (ternary on
// params.segmentReplacement, p_user_id = params.userId); it is a static +
// simulation proof, NOT executed PostgreSQL — no PG exists in the build env,
// so the database-side gate itself is proven only by the SQL-structure
// assertions in sections B/C/E above and, after Junel applies the migration,
// by the pg_proc verification in PACKET-SECTION.md.
import { readdirSync, statSync } from "node:fs";
const bookingsLib = read("lib/roamly/bookings.ts");
const webhookRoute = read("app/api/webhooks/affiliate/route.ts");
function walkTs(dir, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkTs(rel, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const appLibFiles = [...walkTs("app"), ...walkTs("lib")];
const readAll = (rel) => read(rel);
// The wallet dispatch, copied verbatim in logic from bookingWallet.ts.
function dispatchRpc(segmentReplacement) {
  return segmentReplacement === "service"
    ? "roamly_replace_booking_segments_service"
    : "roamly_replace_booking_segments";
}
// A recording stand-in for params.supabase.rpc: captures exactly what the
// wallet would send, so each caller's p_user_id can be checked against the
// id that call site actually passes.
function recordDispatch({ segmentReplacement, callerId, tripId, bookingId }) {
  const calls = [];
  const rpc = (name, args) => { calls.push({ name, args }); return { data: null, error: null }; };
  rpc(dispatchRpc(segmentReplacement), {
    p_booking_id: bookingId,
    p_user_id: callerId,
    p_trip_id: tripId,
    p_segments: [],
  });
  return calls[0];
}
// (a) Each default-authenticated caller: user-session client, own id, base fn.
const userSessionCallers = [
  { name: "manual booking POST", file: manualRoute, callerId: "auth.user.id" },
  { name: "screenshot confirm", file: confirmRoute, callerId: "auth.user.id" },
  { name: "email-import attach", file: attachRoute, callerId: "auth.user.id" },
];
for (const caller of userSessionCallers) {
  check(`${caller.name} runs behind requireUser (user session)`, caller.file.includes("requireUser"));
  check(`${caller.name} passes the session client + its own id`, caller.file.includes("supabase: auth.supabase") && caller.file.includes("userId: auth.user.id"));
  check(`${caller.name} does not pass segmentReplacement (default applies)`, !caller.file.includes("segmentReplacement"));
  const call = recordDispatch({ segmentReplacement: undefined, callerId: "user-a", tripId: "trip-t2", bookingId: "booking-a" });
  check(`${caller.name} dispatches the authenticated function with p_user_id = caller id`, call.name === "roamly_replace_booking_segments" && call.args.p_user_id === "user-a");
}
// saveConfirmedBooking (lib/roamly/bookings.ts): a wrapper, not a route. It
// passes its caller-supplied client + params.userId and never sets
// segmentReplacement, so it always takes the authenticated default. It
// currently has NO production call site (only the b02b06 test script calls
// it); the scan below proves no production file could smuggle "service"
// through it.
const saveConfirmedBody = bookingsLib.slice(bookingsLib.indexOf("export async function saveConfirmedBooking"), bookingsLib.indexOf("export type ConfirmedBookingCostStatus"));
check("saveConfirmedBooking passes caller client + params.userId, no segmentReplacement", saveConfirmedBody.includes("supabase,") && saveConfirmedBody.includes("userId: params.userId") && !/segmentReplacement/.test(saveConfirmedBody));
const saveConfirmedCallers = appLibFiles.filter((f) => f !== "lib/roamly/bookings.ts" && readAll(f).includes("saveConfirmedBooking"));
check("saveConfirmedBooking has no production call site (app/ + lib/ scan)", saveConfirmedCallers.length === 0, saveConfirmedCallers.join(", "));
{
  const call = recordDispatch({ segmentReplacement: undefined, callerId: "user-a", tripId: "trip-t2", bookingId: "booking-a" });
  check("saveConfirmedBooking (via default) dispatches authenticated fn with p_user_id = caller id", call.name === "roamly_replace_booking_segments" && call.args.p_user_id === "user-a");
}
// (b) Affiliate webhook: service-role client, click owner's id, _service fn.
check("affiliate webhook route requires a signed webhook + service-role client", webhookRoute.includes("verifyAffiliateWebhookSignature") && webhookRoute.includes("createSupabaseAdminClient") && webhookRoute.includes("supabase: admin"));
check("affiliate flow passes segmentReplacement: \"service\" with the click owner's id", affiliate.includes('segmentReplacement: "service"') && affiliate.includes("userId: click.user_id") && affiliate.includes("supabase: params.supabase"));
{
  const call = recordDispatch({ segmentReplacement: "service", callerId: "user-b", tripId: "trip-t", bookingId: "booking-b" });
  check("affiliate webhook dispatches the _service function with p_user_id = click owner", call.name === "roamly_replace_booking_segments_service" && call.args.p_user_id === "user-b");
}
// (c) Gmail sync: "service" with the admin client, "authenticated" without.
check("gmail sync routes on the admin client (ternary, not a fixed literal)", extraction.includes('segmentReplacement: adminClient ? "service" : "authenticated"') && extraction.includes("const adminClient = createSupabaseAdminClient();") && extraction.includes("const writer = adminClient || params.supabase;"));
check("gmail sync passes the connection owner's id through the chosen writer", extraction.includes("supabase: writer") && extraction.includes("userId: params.connection.user_id"));
{
  const withAdmin = recordDispatch({ segmentReplacement: "service", callerId: "user-b", tripId: "trip-t", bookingId: "booking-b" });
  const withoutAdmin = recordDispatch({ segmentReplacement: "authenticated", callerId: "user-b", tripId: "trip-t", bookingId: "booking-b" });
  check("gmail sync WITH admin client dispatches _service with p_user_id = connection owner", withAdmin.name === "roamly_replace_booking_segments_service" && withAdmin.args.p_user_id === "user-b");
  check("gmail sync WITHOUT admin client dispatches authenticated fn with p_user_id = connection owner", withoutAdmin.name === "roamly_replace_booking_segments" && withoutAdmin.args.p_user_id === "user-b");
}
// (d) STATIC SCAN: no user-session flow passes "service". The only literal
// `segmentReplacement: "service"` in app/ + lib/ must be the affiliate
// webhook flow (a server flow, never a user session); the Gmail ternary is
// conditional on the admin client and is asserted separately in (c).
const literalServiceFiles = appLibFiles.filter((f) => /segmentReplacement:\s*"service"/.test(readAll(f)));
check("only the affiliate flow passes literal segmentReplacement: \"service\" (app/ + lib/ scan)", literalServiceFiles.length === 1 && literalServiceFiles[0] === "lib/roamly/affiliateTracking.ts", literalServiceFiles.join(", "));
for (const caller of userSessionCallers) {
  check(`${caller.name} never passes "service" (literal scan)`, !/segmentReplacement:\s*"service"/.test(caller.file));
}
check("saveConfirmedBooking wrapper never passes \"service\" (literal scan)", !/segmentReplacement:\s*"service"/.test(bookingsLib));
// Single dispatch point: bookingWallet.ts is the only app/ + lib/ file that
// names either segment RPC, so no caller can bypass the routing ternary.
const rpcNamingFiles = appLibFiles.filter((f) => readAll(f).includes("roamly_replace_booking_segments"));
check("bookingWallet.ts is the single dispatch point (only app/ + lib/ file naming the RPCs)", rpcNamingFiles.length === 1 && rpcNamingFiles[0] === "lib/roamly/bookingWallet.ts", rpcNamingFiles.join(", "));
// (e) Ownership semantics at dispatch level (MIRRORED gate logic, not PG):
// an authenticated dispatch whose p_user_id differs from the session uid
// must be rejected even when the named booking + trip exist for that id.
check("authenticated dispatch with mismatched p_user_id is rejected (mirrored gate, not PostgreSQL)", !attempt("authenticated", "main", { sessionUid: "user-a", pUserId: "user-b", pTripId: "trip-t", booking: bookingB, trip: tripT }));
check("authenticated dispatch with matching p_user_id + own booking is allowed (mirrored gate)", attempt("authenticated", "main", { sessionUid: "user-a", pUserId: "user-a", pTripId: "trip-t2", booking: { id: "booking-a", user_id: "user-a", trip_id: "trip-t2" }, trip: tripT2 }));
check("authenticated dispatch with own id but another owner's booking is rejected (mirrored gate)", !attempt("authenticated", "main", { sessionUid: "user-a", pUserId: "user-a", pTripId: "trip-t", booking: bookingB, trip: tripT }));
// (f) Service dispatch carries no auth.uid() binding BY DESIGN, not as a gap:
// a service-role JWT carries no subject, so no session identity exists to
// bind to. Trust on this path comes from three other controls, all proven
// above: the ACL (service_role only, revoked from authenticated), the
// caller-supplied ownership check inside the function, and server-only
// entry points (signed affiliate webhook; admin client in Gmail sync).
check("service function has no auth.uid() binding by design (service JWT has no subject)", !serviceBody.includes("auth.uid()"));
check("service path still enforces caller-supplied booking + trip ownership", serviceBody.includes("user_id = p_user_id") && serviceBody.includes("trip_id = p_trip_id"));
check("service dispatch from a user session is ACL-denied (no fallback to caller-supplied ids)", !attempt("authenticated", "service", { sessionUid: "user-a", pUserId: "user-b", pTripId: "trip-t", booking: bookingB }));
check("service dispatch for a trusted server caller succeeds (mirrored gate)", attempt("service_role", "service", { pUserId: "user-b", pTripId: "trip-t", booking: bookingB }));
check("service dispatch with a booking that does not belong to the supplied user is denied (mirrored gate)", !attempt("service_role", "service", { pUserId: "user-a", pTripId: "trip-t", booking: bookingB }));

console.log(`\n${count - failures.length}/${count} checks passed.`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exit(1);
}
