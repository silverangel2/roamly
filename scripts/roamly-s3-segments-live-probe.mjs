// S3 LIVE PROBE — booking-segment persistence, database-level evidence.
// Tester account ONLY (daily.checks@roamlyhq.com via the sealed store, the
// same mechanism as the daily-test runner / prod-read probes). Labeled test
// data only: a fresh flight on the tester's round-1 trip, unique
// confirmation per run. No real bookings, no charges, no other accounts.
// NEVER prints tokens/credentials: all output is status + ids + leg summaries.
// Usage: node scripts/roamly-s3-segments-live-probe.mjs [out-json-path]
// Exit 0 only if EVERY step matches expectation; otherwise exit 1 with the
// failing step named. An HTTP 200 or echoed request is never counted as
// proof — only the direct PostgREST booking_segments select counts.
import { readFileSync, writeFileSync } from "node:fs";
import { readTestAccountSecret } from "/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/daily-test-2026-10-20/secret-store.mjs";

const APP = "https://roamlyhq.com";
const SUPABASE_URL = "https://ikrfkpnbtkdohoxnbphu.supabase.co";
const ANON_KEY = readFileSync("/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/production-wiring-2026-10-21/crowd-test/.anonkey", "utf8").trim();
// Round-1 Moncton trip, tester-owned, already proven in prod-read U1.
const TRIP_ID = "00ef4a83-26bd-4c17-8087-0c3be7706871";
const BOGUS_TRIP_ID = "00000000-0000-0000-0000-000000000000";
const OUT = process.argv[2] || null;

const steps = [];
function step(name, ok, detail) {
  steps.push({ name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} — ${detail}`);
}
const legSummary = (rows) => (rows || []).map((s) => ({
  seq: s.sequence, o: s.origin, d: s.destination,
  dep: s.departure_time || null, arr: s.arrival_time || null,
  svc: s.service_number || null,
}));
const summarize = (rows) => ({ count: (rows || []).length, legs: legSummary(rows) });
const sameLegs = (a, b) => JSON.stringify(legSummary(a)) === JSON.stringify(legSummary(b));

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}
async function directSegments(token, bookingId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/booking_segments?booking_id=eq.${bookingId}&select=*&order=sequence.asc`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(json) ? json : null, error: Array.isArray(json) ? null : json };
}
async function appListRow(token, bookingId) {
  const r = await api(`/api/trips/${TRIP_ID}/bookings`, { token });
  const row = (r.json?.bookings || []).find((b) => b.id === bookingId) || null;
  return { http: r.status, row };
}

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
const userId = sj.user?.id || "withheld";
console.log(`signed in as tester (user id withheld in detail; domain roamlyhq.com), TZ=${process.env.TZ || "(default)"}`);

// Wrong-owner / unauthenticated proofs (available routes only).
const unauth = await api(`/api/trips/${TRIP_ID}/bookings`);
step("wrong-owner-unauth-get-401", unauth.status === 401, `GET bookings without auth -> HTTP ${unauth.status} (expect 401)`);
const bogus = await api(`/api/trips/${BOGUS_TRIP_ID}/bookings`, {
  token, method: "POST",
  body: { bookingType: "flight", provider: "S3 Probe Air", title: "S3 bogus-trip probe", confirmationCode: "S3BOGUS", segments: [] },
});
step("wrong-owner-bogus-trip-save-fails", bogus.status !== 200, `POST save vs unowned/bogus trip -> HTTP ${bogus.status} ${bogus.json?.error || ""} (expect non-200)`);

const code = `S3SEG-${Date.now().toString(36).toUpperCase()}`;
const base = {
  bookingType: "flight", travelerConfirmed: false, sourceType: "manual",
  provider: "S3 Probe Air", flightNumber: "S300",
  origin: "YUL", destination: "YYZ",
  startTime: "2026-11-10T20:30:00", endTime: "2026-11-10T22:00:00",
  confirmationCode: code, totalPrice: 249, currency: "CAD",
};
const legA = { sequence: 1, origin: "YUL", destination: "YYZ", departureTime: "2026-11-10T20:30:00", arrivalTime: "2026-11-10T22:00:00", provider: "S3 Probe Air", serviceNumber: "S300", status: "scheduled" };
const legB = { sequence: 2, origin: "YYZ", destination: "YOW", departureTime: "2026-11-10T23:00:00", arrivalTime: "2026-11-11T00:15:00", provider: "S3 Probe Air", serviceNumber: "S301", status: "scheduled" };
const legC = { sequence: 1, origin: "YUL", destination: "YOW", departureTime: "2026-11-10T21:30:00", arrivalTime: "2026-11-10T23:00:00", provider: "S3 Probe Air", serviceNumber: "S302", status: "scheduled" };

async function reloadCheck(name, bookingId, expectCount, expectLegs) {
  const app = await appListRow(token, bookingId);
  const direct = await directSegments(token, bookingId);
  const appSegs = app.row?.booking_segments ?? app.row?.segments ?? null;
  const appCount = Array.isArray(appSegs) ? appSegs.length : null;
  const detail = `app GET ${app.http} legs=${appCount} direct PostgREST ${direct.status} ${JSON.stringify(summarize(direct.rows))}`;
  const ok = app.http === 200 && appCount === expectCount && direct.status === 200 && (direct.rows || []).length === expectCount
    && (!expectLegs || sameLegs(direct.rows, expectLegs.map((l) => ({
      sequence: l.sequence, origin: l.origin, destination: l.destination,
      departure_time: l.departureTime, arrival_time: l.arrivalTime, service_number: l.serviceNumber,
    }))));
  // Note: direct departure_time values are timestamptz; compare by origin/dest/seq/svc only for time tolerance.
  const legsLoose = !expectLegs || JSON.stringify(legSummary(direct.rows).map((l) => [l.seq, l.o, l.d, l.svc])) === JSON.stringify(expectLegs.map((l) => [l.sequence, l.origin, l.destination, l.serviceNumber]));
  step(name, ok && legsLoose, detail);
  return { app, direct };
}

// 1. CREATE with 2 legs.
const create = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { ...base, title: "S3 Probe Flight YUL-YYZ-YOW", segments: [legA, legB] } });
const bookingId = create.json?.booking?.id || null;
const postSegs = create.json?.booking?.booking_segments ?? create.json?.booking?.segments ?? null;
step("create-2-legs-post", create.status === 200 && !!bookingId, `POST ${create.status} booking=${bookingId} echoed legs=${Array.isArray(postSegs) ? postSegs.length : "ABSENT"} (echo is NOT proof)`);
if (!bookingId) { if (OUT) writeFileSync(OUT, JSON.stringify({ testerUserId: userId, confirmation: code, steps }, null, 2)); process.exit(1); }
await reloadCheck("create-2-legs-db-reload", bookingId, 2, [legA, legB]);

// 2. EDIT, segments OMITTED -> legs preserved (B06).
const editOmit = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { ...base, title: "S3 Probe Flight EDIT-OMITTED" } });
step("edit-omitted-post", editOmit.status === 200, `POST ${editOmit.status} (segments field absent)`);
await reloadCheck("edit-omitted-preserves-2-legs", bookingId, 2, [legA, legB]);

// 3. EDIT, explicit new list -> replaced.
const editReplace = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { ...base, title: "S3 Probe Flight EDIT-REPLACED", segments: [legC] } });
step("edit-explicit-post", editReplace.status === 200, `POST ${editReplace.status} (explicit 1-leg list)`);
await reloadCheck("edit-explicit-replaces-to-1-leg", bookingId, 1, [legC]);

// 4. EDIT, explicit [] -> cleared.
const editClear = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { ...base, title: "S3 Probe Flight EDIT-CLEARED", segments: [] } });
step("edit-explicit-empty-post", editClear.status === 200, `POST ${editClear.status} (explicit [])`);
await reloadCheck("edit-explicit-empty-clears", bookingId, 0, []);

// 5. EDIT, explicit 2 legs again -> final stored state.
const editReadd = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { ...base, title: "S3 Probe Flight FINAL", segments: [legA, legB] } });
step("edit-readd-post", editReadd.status === 200, `POST ${editReadd.status} (explicit 2-leg list)`);
await reloadCheck("edit-readd-2-legs-db-reload", bookingId, 2, [legA, legB]);

// 6. U2 in the same run, on the same booking (segments omitted throughout).
const priceOf = async () => (await appListRow(token, bookingId)).row;
const editPriceless = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { bookingType: "flight", provider: "S3 Probe Air", title: "S3 Probe Flight PRICELESS-EDIT", confirmationCode: code } });
let row = await priceOf();
step("u2-priceless-preserves", editPriceless.status === 200 && row?.total_price === 249 && row?.currency === "CAD",
  `POST ${editPriceless.status}; reloaded total_price=${row?.total_price} currency=${row?.currency} (expect 249 CAD)`);
await reloadCheck("u2-priceless-segments-preserved", bookingId, 2, [legA, legB]);
const editZero = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { bookingType: "flight", provider: "S3 Probe Air", title: "S3 Probe Flight ZERO-EDIT", confirmationCode: code, totalPrice: 0, currency: "CAD" } });
row = await priceOf();
step("u2-explicit-zero-replaces", editZero.status === 200 && row?.total_price === 0,
  `POST ${editZero.status}; reloaded total_price=${row?.total_price} (expect 0)`);
const editNew = await api(`/api/trips/${TRIP_ID}/bookings`, { token, method: "POST", body: { bookingType: "flight", provider: "S3 Probe Air", title: "S3 Probe Flight NEWPRICE-EDIT", confirmationCode: code, totalPrice: 399, currency: "CAD" } });
row = await priceOf();
step("u2-explicit-new-price-replaces", editNew.status === 200 && row?.total_price === 399 && row?.currency === "CAD",
  `POST ${editNew.status}; reloaded total_price=${row?.total_price} currency=${row?.currency} (expect 399 CAD)`);
await reloadCheck("u2-final-segments-still-2-legs", bookingId, 2, [legA, legB]);

const failed = steps.filter((s) => !s.ok);
console.log(`\nS3 LIVE PROBE: ${steps.length - failed.length}/${steps.length} steps pass; booking=${bookingId} confirmation=${code} trip=${TRIP_ID}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ testerUserId: userId, tripId: TRIP_ID, bookingId, confirmation: code, steps }, null, 2));
process.exit(failed.length ? 1 : 0);
