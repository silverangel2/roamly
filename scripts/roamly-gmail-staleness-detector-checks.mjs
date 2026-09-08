import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  GMAIL_STALE_AFTER_MS,
  gmailConnectionIsAuthRequired,
  gmailConnectionIsStale,
  isRelevantGmailTrip,
  latestGmailCheckpoint,
  relevantTripWindow
} from "../lib/roamly/gmailStalenessDetectorLogic.ts";

const now = Date.parse("2026-09-08T12:00:00.000Z");
const { today, horizon } = relevantTripWindow(now);
assert.equal(today, "2026-09-08");
assert.equal(isRelevantGmailTrip({ start_date: "2026-09-10", end_date: "2026-09-12", status: "active" }, today, horizon), true);
assert.equal(isRelevantGmailTrip({ start_date: "2026-09-20", end_date: "2026-09-22", status: "planned" }, today, horizon), false);
assert.equal(isRelevantGmailTrip({ start_date: "2026-09-01", end_date: "2026-09-03", status: "completed" }, today, horizon), false);

const fresh = { connection_status: "connected", last_synced_at: "2026-09-08T11:45:00.000Z", created_at: "2026-09-01T00:00:00.000Z" };
assert.equal(gmailConnectionIsStale(fresh, now), false);
assert.equal(gmailConnectionIsStale({ ...fresh, last_synced_at: "2026-09-08T11:20:00.000Z" }, now), true);
assert.equal(gmailConnectionIsStale({ ...fresh, connection_status: "disconnected", last_synced_at: "2026-09-01T00:00:00.000Z" }, now), false);
assert.equal(gmailConnectionIsAuthRequired("needs_reauth"), true);
assert.equal(gmailConnectionIsAuthRequired("connected"), false);
assert.equal(latestGmailCheckpoint({ last_synced_at: "2026-09-08T11:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" }), Date.parse("2026-09-08T11:00:00.000Z"));
assert.equal(GMAIL_STALE_AFTER_MS, 30 * 60 * 1000);

const syncSource = fs.readFileSync(path.resolve("lib/roamly/emailConnections.ts"), "utf8");
const gmailSyncStart = syncSource.indexOf("async function syncGmailConnectionUnlocked");
const outlookSyncStart = syncSource.indexOf("async function syncOutlookConnectionUnlocked");
const gmailSyncSource = syncSource.slice(gmailSyncStart, outlookSyncStart);
assert.match(gmailSyncSource, /const cursorSaved = await writer\.from\("email_sync_cursors"\)\.upsert/);
assert.match(gmailSyncSource, /if \(cursorSaved\.error\) return \{ ok: false, error: "GMAIL_CURSOR_CHECKPOINT_FAILED"/);
assert.match(gmailSyncSource, /const connectionSaved = await writer[\s\S]*\.update\(\{ last_synced_at: syncedAt \}\)/);
assert.match(gmailSyncSource, /if \(connectionSaved\.error\) return \{ ok: false, error: "GMAIL_SYNC_CHECKPOINT_FAILED"/);
assert.ok(gmailSyncSource.indexOf("cursorSaved.error") < gmailSyncSource.indexOf("last_synced_at: syncedAt"), "cursor persistence precedes health timestamp");

console.log("Roamly Gmail staleness detector checks passed (relevant-trip horizon, authoritative checkpoints, auth/disconnect exclusion, and bounded staleness policy).");
