// roamly-ux-queued-reminder-audit.mjs — READ-ONLY AUDIT (final
// local round, 2026-10-27). Audits reminders already queued under
// the PREVIOUS timezone calculation (metadata-only / UTC fallback)
// for trips whose verified destination zone is not UTC.
//
// STRICT CONSTRAINT: this script performs NO production write of
// any kind. It issues ONLY Supabase .select() reads (plus the
// tester's own sign-in, which writes no reminder row). It contains
// no .insert(), .update(), .upsert(), or .delete() call anywhere.
// Nothing is rescheduled, corrected, or otherwise changed — the
// corrected times below are a PROPOSAL printed for the owner, not
// an applied change.
//
// PRIVACY: output carries trip ids, destinations, reminder types,
// and times ONLY. No email, no name, no user/account id is printed
// or written to the report file (user ids returned by the API are
// dropped before any output).
//
// Queued = roamly_companion_notification_deliveries rows with
// status "queued" (pending, unsent). Legacy pre-trip types
// (trip_predeparture_7d/1d) are the stuck ones: their send time was
// fixed at queue time under the old fallback. Briefing types are
// reported separately — pending briefing ledger rows are rewritten
// to the corrected window target on each scheduler run, so they
// self-correct and are NOT counted as stuck.
//
// Old vs new instant, per queued legacy delivery:
//   - booking-anchored start: the booking's absolute start time —
//     identical under old and new math, so NOT affected;
//   - date-only start: old = 09:00 UTC on start_date (the old
//     fallback); new = 09:00 in the resolved destination zone.
//     Affected exactly when the two instants differ.
//   - corrected send = queued scheduled_for + (newStart - oldStart).
//   - a trip whose zone is still unknown is HELD, not corrected
//     on a guess, and is listed as held (same rule as the schedulers).
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-queued-reminder-audit.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { resolveBackgroundTripTimezone } from "@/lib/roamly/backgroundNotificationTimezone.ts";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const { createClient } = require("@supabase/supabase-js");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".render-env"), "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  })
);
const OUT_DIR = "/home/hatch/workspace/roamly-ux-repair-2026-10-25/renders/queued-reminder-audit-2026-10-27";
mkdirSync(OUT_DIR, { recursive: true });

// Wall-clock (date + minutes) in an IANA zone -> UTC instant, via
// Intl offset arithmetic (the audit's own recomputation; production
// uses zonedDateTimeToUtc in lib/roamly/preTripReminders.ts).
function zonedWallToUtc(dateIso, minutes, zone) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) + minutes * 60000);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return new Date(guess.getTime() + (guess.getTime() - asUtc));
}

const LEGACY_TYPES = new Set(["trip_predeparture_7d", "trip_predeparture_1d"]);
const WINDOW_DAYS = { trip_predeparture_7d: 7, trip_predeparture_1d: 1 };
const DELIVERY_COLS = "id,trip_id,notification_type,scheduled_for,status,metadata_json";
const TRIP_COLS = "id,destination,destination_name,destination_city,start_date,metadata";

async function readQueued(client, label) {
  const { data, error } = await client
    .from("roamly_companion_notification_deliveries")
    .select(DELIVERY_COLS)
    .eq("status", "queued")
    .order("scheduled_for", { ascending: true })
    .limit(1000);
  return { label, rows: data || [], error: error ? { code: error.code || null, message: error.message } : null };
}

const anon = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
const anonAttempt = await readQueued(anon, "anon-publishable-key");
console.log(`ANON READ: error=${anonAttempt.error ? `${anonAttempt.error.code}: ${anonAttempt.error.message}` : "none"} rows=${anonAttempt.rows.length}`);

// Briefing ledger (roamly_communication_ledger): pending/failed rows
// are the briefing path's queued reminders. They are read here for
// completeness; per the notification-timezone round they are NOT
// stuck — each scheduler run rewrites their scheduled_for to the
// corrected window target. logical_key is NEVER printed (it encodes
// account identity); only purpose (from metadata), trip id (when
// the column is readable), scheduled time, and status are reported.
async function readLedger(client, label) {
  const attempt = async (cols) => client.from("roamly_communication_ledger").select(cols).in("status", ["pending", "failed"]).order("scheduled_for", { ascending: true }).limit(1000);
  let res = await attempt("id,trip_id,status,scheduled_for,metadata");
  if (res.error) res = await attempt("id,status,scheduled_for,metadata");
  const rows = (res.data || []).map((r) => ({
    tripId: r.trip_id || null,
    purpose: r.metadata && typeof r.metadata.purpose === "string" ? r.metadata.purpose : null,
    status: r.status,
    scheduledFor: r.scheduled_for
  }));
  return { label, rows, error: res.error ? { code: res.error.code || null, message: res.error.message } : null };
}
const anonLedger = await readLedger(anon, "anon-publishable-key");
console.log(`ANON LEDGER READ: error=${anonLedger.error ? `${anonLedger.error.code}: ${anonLedger.error.message}` : "none"} rows=${anonLedger.rows.length}`);

// Tester-authenticated read: the tester account's own rows only
// (RLS scope). This is NOT a cross-account read — see the report.
let testerAttempt = { label: "tester-authenticated", rows: [], error: null, signedIn: false };
try {
  const account = JSON.parse(readFileSync("/home/hatch/workspace/goals/roamly-october-4-repair/hidden_files/daily-test-secrets/test-account.json", "utf8"));
  const tester = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  const { error: signInError } = await tester.auth.signInWithPassword({ email: account.email, password: account.password });
  if (signInError) {
    testerAttempt.error = { code: signInError.code || null, message: signInError.message };
  } else {
    testerAttempt.signedIn = true;
    const read = await readQueued(tester, "tester-authenticated");
    testerAttempt.rows = read.rows;
    testerAttempt.error = read.error;
    // Keep the authenticated client for the follow-up trip/booking reads.
    testerAttempt.client = tester;
  }
} catch (e) {
  testerAttempt.error = { code: null, message: `test-account read failed: ${String(e).slice(0, 120)}` };
}
console.log(`TESTER READ: signedIn=${testerAttempt.signedIn} error=${testerAttempt.error ? `${testerAttempt.error.code}: ${testerAttempt.error.message}` : "none"} rows=${testerAttempt.rows.length}`);
let testerLedger = { label: "tester-authenticated", rows: [], error: null };
if (testerAttempt.client) {
  testerLedger = await readLedger(testerAttempt.client, "tester-authenticated");
  console.log(`TESTER LEDGER READ: error=${testerLedger.error ? `${testerLedger.error.code}: ${testerLedger.error.message}` : "none"} rows=${testerLedger.rows.length}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  writesPerformed: "NONE — read-only selects only; no UPDATE, no reschedule, no row write of any kind.",
  anonAttempt: { error: anonAttempt.error, rowCount: anonAttempt.rows.length },
  testerAttempt: { signedIn: testerAttempt.signedIn, error: testerAttempt.error, rowCount: testerAttempt.rows.length },
  anonLedger: { error: anonLedger.error, rowCount: anonLedger.rows.length, rows: anonLedger.rows },
  testerLedger: { error: testerLedger.error, rowCount: testerLedger.rows.length, rows: testerLedger.rows },
  queuedRowsSeen: [],
  affected: [],
  briefingQueued: [],
  notAffectedLegacy: [],
  heldUnknownZone: [],
  accessGap: null
};

const client = testerAttempt.client || anon;
const seen = testerAttempt.signedIn ? testerAttempt.rows : anonAttempt.rows;
for (const row of seen) {
  const base = { tripId: row.trip_id, type: row.notification_type, scheduledFor: row.scheduled_for };
  report.queuedRowsSeen.push(base);
  if (!LEGACY_TYPES.has(row.notification_type)) {
    report.briefingQueued.push({ ...base, note: "Non-legacy queued type; briefing ledger rows self-correct on the next scheduler run — not counted as stuck." });
    continue;
  }
  // Trip record (read-only) + earliest confirmed booking (read-only).
  const { data: trip, error: tripError } = await client.from("roamly_trips").select(TRIP_COLS).eq("id", row.trip_id).maybeSingle();
  if (tripError || !trip) {
    report.notAffectedLegacy.push({ ...base, reason: tripError ? `trip row unreadable: ${tripError.message}` : "trip row not returned" });
    continue;
  }
  const destination = trip.destination_name || trip.destination_city || trip.destination || "unknown destination";
  const resolution = resolveBackgroundTripTimezone(trip);
  if (!resolution.known || !resolution.zone) {
    report.heldUnknownZone.push({ tripId: row.trip_id, destination, type: row.notification_type, scheduledFor: row.scheduled_for, note: "Zone still unknown — HELD, never corrected on a guessed zone." });
    continue;
  }
  if (resolution.zone === "UTC") {
    report.notAffectedLegacy.push({ tripId: row.trip_id, destination, type: row.notification_type, scheduledFor: row.scheduled_for, reason: "Verified destination zone is UTC — old UTC fallback already correct." });
    continue;
  }
  const { data: bookings } = await client
    .from("roamly_bookings")
    .select("start_at,check_in_at")
    .eq("trip_id", row.trip_id)
    .is("superseded_by_booking_id", null)
    .order("start_at", { ascending: true, nullsFirst: false })
    .limit(50);
  const bookingStarts = (bookings || []).map((b) => b.start_at || b.check_in_at).filter(Boolean).map((v) => new Date(v)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  const hasMetadataZone = (() => {
    try {
      const md = trip.metadata || {};
      const z = md.timezone || md.time_zone || md.trip_timezone || (md.trip && md.trip.timezone);
      return typeof z === "string" && !!z;
    } catch { return false; }
  })();
  if (bookingStarts.length) {
    report.notAffectedLegacy.push({ tripId: row.trip_id, destination, type: row.notification_type, scheduledFor: row.scheduled_for, reason: "Booking-anchored start: absolute booking time is identical under old and new math." });
    continue;
  }
  if (hasMetadataZone) {
    report.notAffectedLegacy.push({ tripId: row.trip_id, destination, type: row.notification_type, scheduledFor: row.scheduled_for, reason: "Stored metadata already carried a zone — old math did not use the UTC fallback." });
    continue;
  }
  if (!trip.start_date) {
    report.heldUnknownZone.push({ tripId: row.trip_id, destination, type: row.notification_type, scheduledFor: row.scheduled_for, note: "No start date — no instant to recompute; held." });
    continue;
  }
  const oldStart = zonedWallToUtc(trip.start_date, 9 * 60, "UTC");
  const newStart = zonedWallToUtc(trip.start_date, 9 * 60, resolution.zone);
  const shiftMs = newStart.getTime() - oldStart.getTime();
  if (shiftMs === 0) {
    report.notAffectedLegacy.push({ tripId: row.trip_id, destination, type: row.notification_type, scheduledFor: row.scheduled_for, reason: "Recomputed instant equals the old instant." });
    continue;
  }
  const corrected = new Date(new Date(row.scheduled_for).getTime() + shiftMs).toISOString();
  const fmtLocal = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: resolution.zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  report.affected.push({
    tripId: row.trip_id,
    destination,
    type: row.notification_type,
    windowDays: WINDOW_DAYS[row.notification_type],
    resolvedZone: resolution.zone,
    currentlyScheduledSendTimeUtc: row.scheduled_for,
    currentlyScheduledSendTimeDestinationLocal: fmtLocal(row.scheduled_for),
    correctedSendTimeUtc: corrected,
    correctedSendTimeDestinationLocal: fmtLocal(corrected),
    proposedCorrection: `Recompute to destination-local time: shift send by ${shiftMs / 3600000}h (old 09:00 UTC start -> 09:00 ${resolution.zone} start). NOT APPLIED — read-only audit.`
  });
}

report.accessGap = "Cross-account audit NOT possible with available credentials, and the anon 0-row result is NOT evidence of a global 0: the public anon/publishable key is RLS-scoped (an unauthenticated read returns only rows RLS permits, here none, with no error), and the tester account reads only its own rows. No service-role key is available to this agent (none in the environment, none in the tree). A complete all-customer count requires the owner (or an owner-authorized run) to execute the same read-only selects with the Supabase service-role key, or an owner SQL read on roamly_companion_notification_deliveries (status='queued') and roamly_communication_ledger (status in pending/failed), each joined to roamly_trips — selects only, same classification as above. Counts in this report cover only rows visible to the credentials above; within that visible scope the affected (stuck, legacy, non-UTC) count is the number printed below, and it is 0 only for that scope.";
console.log(`LEDGER PENDING/FAILED SEEN (anon): ${anonLedger.rows.length} | (tester): ${testerLedger.rows.length} — briefing ledger rows self-correct on the next scheduler run and are not counted as stuck.`);

writeFileSync(join(OUT_DIR, "audit-report.json"), JSON.stringify(report, null, 2));
console.log(`\nQUEUED SEEN: ${report.queuedRowsSeen.length} | AFFECTED (stuck, legacy, non-UTC zone): ${report.affected.length} | BRIEFING/OTHER QUEUED: ${report.briefingQueued.length} | NOT AFFECTED LEGACY: ${report.notAffectedLegacy.length} | HELD UNKNOWN ZONE: ${report.heldUnknownZone.length}`);
for (const a of report.affected) console.log(`AFFECTED ${a.tripId} ${a.destination} ${a.type} ${a.currentlyScheduledSendTimeUtc} -> ${a.correctedSendTimeUtc} (${a.resolvedZone})`);
console.log("WRITES PERFORMED: NONE. Report:", join(OUT_DIR, "audit-report.json"));
