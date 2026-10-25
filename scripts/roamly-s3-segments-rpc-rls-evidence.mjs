// S3 RPC/RLS EVIDENCE PROBE — closes the evidence gap in the migration header.
// Tester account ONLY (daily.checks@roamlyhq.com via the sealed store, the
// same mechanism as the daily-test runner / prod-read probes). Tester-owned
// S3 probe booking only; labeled test data; no real bookings, no charges,
// no other accounts. NEVER prints tokens/credentials: output is statuses,
// counts, and error codes/messages only.
// Usage: node scripts/roamly-s3-segments-rpc-rls-evidence.mjs [out-json-path]
// Exit 0 only if EVERY step matches the claimed pre-fix pattern; otherwise
// exit 1 with the failing step named — and the saved log is STILL the
// evidence (a failing step disproves the claim it names; the migration
// header must then be softened to match the log, never the other way round).
import { readFileSync, writeFileSync } from "node:fs";
import { readTestAccountSecret } from "/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/daily-test-2026-10-20/secret-store.mjs";

const SUPABASE_URL = "https://ikrfkpnbtkdohoxnbphu.supabase.co";
const APP = "https://roamlyhq.com";
const ANON_KEY = readFileSync("/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/production-wiring-2026-10-21/crowd-test/.anonkey", "utf8").trim();
const TRIP_ID = "00ef4a83-26bd-4c17-8087-0c3be7706871";
const BOOKING_ID = "c53e5378-3653-49ed-9526-7a18d86d6cc4";
const OUT = process.argv[2] || null;

const steps = [];
function step(name, ok, detail) {
  steps.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}
const errSummary = (json) => {
  if (!json || typeof json !== "object") return String(json);
  return `code=${json.code || "?"} message=${String(json.message || "").slice(0, 160)}`;
};

const secret = readTestAccountSecret();
if (secret.email !== "daily.checks@roamlyhq.com") throw new Error("unexpected tester email");
const signin = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON_KEY, "content-type": "application/json" },
  body: JSON.stringify({ email: secret.email, password: secret.password }),
});
const sj = await signin.json().catch(() => null);
if (signin.status !== 200 || !sj?.access_token) throw new Error(`tester sign-in failed HTTP ${signin.status}`);
const token = sj.access_token;
const userId = sj.user?.id;
console.log(`signed in as tester (user id in JSON only), TZ=${process.env.TZ || "(default)"}`);

const headers = { apikey: ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" };
async function rpc(segments) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/roamly_replace_booking_segments`, {
    method: "POST", headers,
    body: JSON.stringify({ p_booking_id: BOOKING_ID, p_user_id: userId, p_trip_id: TRIP_ID, p_segments: segments }),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
async function directSelect() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/booking_segments?booking_id=eq.${BOOKING_ID}&select=*&order=sequence.asc`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(json) ? json : null, error: Array.isArray(json) ? null : json };
}
const leg = (sequence, serviceNumber, status = "scheduled") => ({
  sequence, origin: "YUL", destination: "YYZ",
  departure_time: "2026-11-10T20:30:00", arrival_time: "2026-11-10T22:00:00",
  provider: "S3 Probe Air", service_number: serviceNumber, terminal: null, gate: null, seat: null, status,
});
const legB = {
  sequence: 2, origin: "YYZ", destination: "YOW",
  departure_time: "2026-11-10T23:00:00", arrival_time: "2026-11-11T00:15:00",
  provider: "S3 Probe Air", service_number: "S301", terminal: null, gate: null, seat: null, status: "scheduled",
};
const twoLegs = [leg(1, "S300"), legB];

// (a) Direct RPC stores rows: expect 200 + segment_count 2.
const rpc2 = await rpc(twoLegs);
const rpc2Count = Array.isArray(rpc2.json) ? rpc2.json[0]?.segment_count : null;
step("direct-rpc-2-legs", rpc2.status === 200 && Number(rpc2Count) === 2,
  `RPC HTTP ${rpc2.status} segment_count=${rpc2Count} (expect 200/2)`);

// (a, continued) The same owner session cannot read them back: expect 200 [].
const selAfter = await directSelect();
step("direct-select-after-rpc-empty", selAfter.status === 200 && (selAfter.rows || []).length === 0,
  `direct PostgREST ${selAfter.status} rows=${(selAfter.rows || []).length} (expect 200/0 — stored-but-invisible)`);

// App GET list agrees with the direct read (0 legs), not with the RPC count.
const appList = await fetch(`${APP}/api/trips/${TRIP_ID}/bookings`, { headers: { authorization: `Bearer ${token}` } });
const appJson = await appList.json().catch(() => null);
const appRow = (appList.json ? (appJson?.bookings || []) : []).find((b) => b.id === BOOKING_ID) || null;
const appLegs = appRow?.booking_segments ?? appRow?.segments ?? null;
step("app-get-after-rpc-empty", appList.status === 200 && Array.isArray(appLegs) && appLegs.length === 0,
  `app GET ${appList.status} legs=${Array.isArray(appLegs) ? appLegs.length : "ABSENT"} (expect 200/0)`);

// (b) Direct PostgREST insert is denied by RLS: expect 403.
const ins = await fetch(`${SUPABASE_URL}/rest/v1/booking_segments`, {
  method: "POST", headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({ booking_id: BOOKING_ID, sequence: 99, origin: "YUL", destination: "YYZ", provider: "S3 Probe Air", service_number: "S399", status: "scheduled" }),
});
const insJson = await ins.json().catch(() => null);
step("direct-insert-403-rls", ins.status === 403,
  `direct insert HTTP ${ins.status} ${errSummary(insJson)} (expect 403 row-level-security violation)`);

// (c) No wallet-era constraints: sequence-0, bogus-status, duplicate-sequence
// RPCs each return a count instead of a constraint error.
const rpcSeq0 = await rpc([leg(0, "S300")]);
const c0 = Array.isArray(rpcSeq0.json) ? rpcSeq0.json[0]?.segment_count : null;
step("rpc-sequence-0-accepted", rpcSeq0.status === 200 && Number(c0) === 1,
  `seq-0 RPC HTTP ${rpcSeq0.status} segment_count=${c0} (expect 200/1 — no sequence>0 check)`);
const rpcBogus = await rpc([leg(1, "S300", "s3-test-bogus-status")]);
const cb = Array.isArray(rpcBogus.json) ? rpcBogus.json[0]?.segment_count : null;
step("rpc-bogus-status-accepted", rpcBogus.status === 200 && Number(cb) === 1,
  `bogus-status RPC HTTP ${rpcBogus.status} segment_count=${cb} (expect 200/1 — no status check)`);
const rpcDup = await rpc([leg(1, "S300"), { ...leg(1, "S301") }]);
const cd = Array.isArray(rpcDup.json) ? rpcDup.json[0]?.segment_count : null;
step("rpc-duplicate-sequence-accepted", rpcDup.status === 200 && Number(cd) === 2,
  `dup-sequence RPC HTTP ${rpcDup.status} segment_count=${cd} (expect 200/2 — no booking+sequence unique index)`);

// (d) public.trip_bookings does not exist live: expect 404 PGRST205.
const tb = await fetch(`${SUPABASE_URL}/rest/v1/trip_bookings?select=*&limit=1`, {
  headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
});
const tbJson = await tb.json().catch(() => null);
step("trip-bookings-absent-pgrst205", tb.status === 404 && tbJson?.code === "PGRST205",
  `trip_bookings HTTP ${tb.status} ${errSummary(tbJson)} (expect 404 PGRST205)`);

// Restore: the probe booking ends with its canonical 2 stored legs (the
// RPC delete+insert also cleans any row the direct-insert step may have
// left if it unexpectedly succeeded).
const restore = await rpc(twoLegs);
const rc = Array.isArray(restore.json) ? restore.json[0]?.segment_count : null;
step("restore-2-legs", restore.status === 200 && Number(rc) === 2,
  `restore RPC HTTP ${restore.status} segment_count=${rc} (expect 200/2)`);
const selFinal = await directSelect();
step("final-direct-select-still-empty", selFinal.status === 200 && (selFinal.rows || []).length === 0,
  `final direct PostgREST ${selFinal.status} rows=${(selFinal.rows || []).length} (expect 200/0 until the RLS repair lands)`);

const passed = steps.filter((s) => s.ok).length;
console.log(`\nS3 RPC/RLS EVIDENCE: ${passed}/${steps.length} steps pass; booking=${BOOKING_ID} trip=${TRIP_ID}`);
const out = { testerUserId: userId, tripId: TRIP_ID, bookingId: BOOKING_ID, steps };
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
if (passed !== steps.length) process.exit(1);
