// Booking Recon batch 2 checks (structural, source-level).
// Proves the three final Recon fixes are wired, and that the paired
// changes that make them safe are present. It does not prove a live
// Gmail sync, a live backfill, or any production row state.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

const email = read("lib/roamly/emailConnections.ts");
check("backfill function exists", email.includes("export async function backfillGmailTripWindow"));
check("backfill searches the upcoming trip window", email.includes("from(\"roamly_trips\")") && email.includes("after:") && email.includes("before:"));
check("backfill is bounded to the lookback cap", email.includes("maxResults\", String(EMAIL_LOOKBACK_MAX_MESSAGES_PER_SYNC))"));
check("backfill feeds the normal message pipeline", email.includes("processGmailMessageIds({ supabase: writer, connection, accessToken, messageIds })"));
check("backfill never writes the sync cursor", !email.slice(email.indexOf("backfillGmailTripWindow"), email.indexOf("export async function syncGmailConnection")).includes("email_sync_cursors"));
check("failed sync leaves status error, not connected", email.includes('connection_status: params.ok === false ? "error" : "connected"'));
check("Gmail sync passes its outcome to release", email.includes("ok: outcome?.ok ?? false"));

const callback = read("app/api/integrations/gmail/callback/route.ts");
check("callback backfills before sync and watch renewal", callback.indexOf("await backfillGmailTripWindow") < callback.indexOf("await syncGmailConnection") && callback.indexOf("await syncGmailConnection") < callback.indexOf("await renewGmailWatch"));

const monitor = read("lib/roamly/bookingMonitor.ts");
check("monitor retries error rows", monitor.includes('in("connection_status", ["connected", "error"])'));

const gate = read("lib/roamly/gateService.ts");
check("gate treats a failed sync as connected, not a reauth demand", gate.includes('row.connection_status === "error"') && gate.includes("which would reset the"));

const lines = read("components/roamly/TripStateLines.tsx");
check("trip lines accept a pending-import count", lines.includes("pendingImportCount?: number"));
check("trip lines only show the pointer when at least one waits", lines.includes("pendingImportCount > 0"));
check("trip lines link the pointer to the bookings page", lines.includes("`/trip/${tripId}/bookings`"));

const tripPage = read("app/trip/[id]/page.tsx");
check("trip page counts pending imports with the imports-route filters", tripPage.includes('in("match_status", ["unmatched", "needs_confirmation"])'));
check("trip page passes the count to the state lines", tripPage.includes("pendingImportCount={pendingImports ?? undefined}"));

console.log(`\n${passed} recon batch 2 checks passed`);
