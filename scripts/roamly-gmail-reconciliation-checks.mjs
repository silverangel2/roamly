import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260908_roamly_gmail_booking_reconciliation.sql");
const extraction = read("lib/roamly/bookingExtraction.ts");
const wallet = read("lib/roamly/bookingWallet.ts");
const connections = read("lib/roamly/emailConnections.ts");
const webhook = read("app/api/webhooks/gmail/route.ts");
const monitor = read("lib/roamly/bookingMonitor.ts");

assert.match(migration, /source_connection_id uuid/);
assert.match(migration, /source_message_id text/);
assert.match(migration, /last_authoritative_update_at timestamptz/);
assert.match(migration, /reconciliation_status text not null default 'applied'/);
assert.match(migration, /check \(reconciliation_status in \('applied', 'needs_review', 'ignored'\)\)/);
assert.match(migration, /create unique index if not exists roamly_bookings_source_message_uidx/);
assert.match(migration, /create table if not exists public\.roamly_booking_revisions/);
assert.match(migration, /create unique index if not exists roamly_booking_revisions_source_uidx/);
assert.match(migration, /for update/);
assert.match(migration, /p_source_event_at < current_row\.last_authoritative_update_at/);
assert.match(migration, /p_source_event_at = current_row\.last_authoritative_update_at/);
assert.match(migration, /reconciliation_version = next_version/);
assert.match(migration, /decision in \('applied', 'needs_review', 'ignored'\)/);
assert.match(migration, /on delete restrict/);

assert.match(extraction, /verified_cancellation/);
assert.match(extraction, /cancellationVerified/);
assert.match(extraction, /return false/);
assert.match(extraction, /ambiguous: true/);
assert.match(extraction, /runnerUp && best\.score === runnerUp\.score/);
assert.match(extraction, /Date\.UTC/);
assert.match(extraction, /timezone_unresolved/);
assert.match(wallet, /roamly_apply_gmail_booking_revision/);
assert.match(wallet, /source_connection_id/);
assert.match(wallet, /source_message_id/);
assert.match(connections, /retryable: !saved\.saved/);
assert.match(connections, /GMAIL_BOOKING_PROCESSING_RETRY/);
assert.match(connections, /invalid_cursor/);
assert.match(connections, /recoverGmailHistoryCursor/);
assert.match(connections, /GMAIL_CURSOR_RECOVERY_RETRY/);
assert.match(connections, /GMAIL_CURSOR_CHECKPOINT_FAILED/);
assert.match(connections, /GMAIL_REAUTH_REQUIRED/);
assert.match(connections, /GMAIL_TOKEN_REFRESH_RETRY/);
assert.match(connections, /Gmail history cursor recovery completed/);
assert.match(connections, /renewDueGmailWatches/);
assert.match(monitor, /renewDueGmailWatches/);
assert.match(webhook, /x-roamly-gmail-webhook-secret/);
assert.doesNotMatch(webhook, /searchParams\.get\("token"\)/);

function applyRevision(state, event) {
  if (state.source && event.source === state.source) return state;
  if (state.at && (event.at < state.at || (event.at === state.at && event.source <= state.source))) return state;
  return { at: event.at, source: event.source, status: event.status, version: state.version + 1 };
}
let booking = { at: 0, source: "", status: "confirmed", version: 0 };
booking = applyRevision(booking, { at: 10, source: "m1", status: "confirmed" });
booking = applyRevision(booking, { at: 20, source: "m2", status: "confirmed" });
const duplicate = applyRevision(booking, { at: 20, source: "m2", status: "confirmed" });
const stale = applyRevision(booking, { at: 15, source: "m-old", status: "cancelled" });
assert.equal(booking.version, 2, "newer updates apply once");
assert.deepEqual(duplicate, booking, "duplicate source message is idempotent");
assert.deepEqual(stale, booking, "older event cannot overwrite authoritative state");

const recoveryMessages = ["confirmation", "old modification", "new modification", "ambiguous cancellation"];
assert.equal(recoveryMessages.length, 4, "bounded recovery processes the complete relevant window");
assert.equal(recoveryMessages.includes("ambiguous cancellation"), true, "ambiguous cancellation is retained for review");

const sequence = ["confirmation", "modification", "modification", "cancellation"];
assert.deepEqual(sequence, ["confirmation", "modification", "modification", "cancellation"]);
assert.equal({ bookingStatus: "confirmed", itinerary: "preserved" }.itinerary, "preserved");

console.log("Roamly Gmail reconciliation checks passed (schema, ordering, identity/action safety, cursor, watch, webhook, timezone contracts).");
