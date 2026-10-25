// Roamly auto-sync fix checks (G12 skip + swallowed refresh error + silent failure).
// Pure static + helper-behavior checks: no DB, no network, no secrets.
// Run from the repo root: `node scripts/roamly-autosync-fix-checks.mjs`
// To check a snapshot tree instead: ROAMLY_AUTOSYNC_ROOT=<dir> node scripts/...
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.ROAMLY_AUTOSYNC_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`PASS ${name}`); }
  else { fail += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

// 1. G12: the email-sync cron must not filter connections by trip ownership.
const cron = read("app/api/cron/roamly-email-sync/route.ts");
check("cron has no trip lookup", !cron.includes("roamly_trips"));
check("cron has no active-trip user filter", !cron.includes("activeUserIds"));
check("cron still caps connections per run", cron.includes("MAX_CONNECTIONS_PER_RUN"));
check("cron still skips recently synced rows", cron.includes("RECENT_SYNC_SKIP_MS"));
check("cron still excludes disconnected rows", cron.includes('.neq("connection_status", "disconnected")'));

// 2. The refresh-error catch must log the underlying error (kind + message only).
const conn = read("lib/roamly/emailConnections.ts");
check("refresh catch logs the failure", conn.includes("Roamly Gmail token refresh failed"));
check("refresh catch distinguishes reauth vs retry", conn.includes("kind:") || conn.includes('kind === "auth"') || conn.includes("isReauth"));
check("release persists the failure code", conn.includes("last_sync_error_code"));
check("release persists the failure time", conn.includes("last_sync_failed_at"));
check("release falls back when failure columns are missing", conn.includes("if (full.error)"));
check("release clears failure columns on success", conn.includes("failed ? (params.errorCode ?? null) : null") && conn.includes("last_sync_failed_at: failed ?"));
check("no token value is logged", !/console\.warn\([^)]*(accessToken|refreshToken|encrypted_)/.test(conn));

// 3. The migration is additive only.
const migrationPath = "supabase/migrations/20261025_roamly_email_sync_failure_columns.sql";
check("migration file exists", existsSync(join(ROOT, migrationPath)));
if (existsSync(join(ROOT, migrationPath))) {
  const mig = read(migrationPath);
  check("migration adds failure code column", mig.includes("last_sync_error_code"));
  check("migration adds failure time column", mig.includes("last_sync_failed_at"));
  check("migration is additive only", !/drop\s+column|alter\s+column/i.test(mig));
}

// 4. Traveler surfaces show plain words, never a bare code badge.
const account = read("components/account/EmailConnectionSettings.tsx");
check("account page shows plain-words failure", account.includes("hasn't worked since"));
check("account page offers reconnect on persistent failure", account.includes("Reconnect Gmail") || account.includes("Connect Gmail"));
check("account page maps the retry code to words", account.includes("GMAIL_TOKEN_REFRESH_RETRY") && account.includes("couldn't refresh"));
check("account page maps the reauth code to words", account.includes("GMAIL_REAUTH_REQUIRED") && account.includes("reconnected"));
const trip = read("components/roamly/TripStateLines.tsx");
check("trip line shows persistent sync failure", trip.includes("Gmail sync") && trip.includes("worked since"));
const gate = read("lib/roamly/gateService.ts");
check("gate view carries failure fields (display only)", gate.includes("lastSyncErrorCode") && gate.includes("connectionStatus"));
const setup = read("lib/roamly/setupState.ts");
check("setup state carries a failing flag (display only)", setup.includes("gmailSyncFailing"));
check("setup state never flips connected on failure", !/gmailSyncFailing[^;]*gmailConnected\s*=/.test(setup));

// 5. Shared health helper behavior.
let helper = null;
try {
  helper = await import(join(ROOT, "lib/roamly/emailSyncHealth.ts"));
} catch (err) {
  check("health helper imports", false, String(err.message || err).slice(0, 120));
}
if (helper) {
  const { isGmailSyncPersistentlyFailing, gmailSyncFailureNeedsReconnect } = helper;
  check("helper imports", typeof isGmailSyncPersistentlyFailing === "function");
  const now = Date.now();
  const daysAgo = (d) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();
  check("error + 8d stale is persistent", isGmailSyncPersistentlyFailing({ connectionStatus: "error", lastSyncedAt: daysAgo(8) }) === true);
  check("error + 1h stale is not persistent", isGmailSyncPersistentlyFailing({ connectionStatus: "error", lastSyncedAt: new Date(now - 60 * 60 * 1000).toISOString() }) === false);
  check("connected + 8d stale is not persistent", isGmailSyncPersistentlyFailing({ connectionStatus: "connected", lastSyncedAt: daysAgo(8) }) === false);
  check("error + never synced is not persistent", isGmailSyncPersistentlyFailing({ connectionStatus: "error", lastSyncedAt: null }) === false);
  check("refresh retry needs reconnect", gmailSyncFailureNeedsReconnect("GMAIL_TOKEN_REFRESH_RETRY") === true);
  check("reauth needs reconnect", gmailSyncFailureNeedsReconnect("GMAIL_REAUTH_REQUIRED") === true);
  check("cursor failure does not force reconnect", gmailSyncFailureNeedsReconnect("GMAIL_CURSOR_CHECKPOINT_FAILED") === false);
  check("unknown code does not force reconnect", gmailSyncFailureNeedsReconnect("SOMETHING_ELSE") === false);
}

// 6. Protected files carry no autosync edits.
for (const protectedFile of ["lib/roamly/socialReelGenerator.ts", "lib/itinerary.ts"]) {
  const text = read(protectedFile);
  check(`${protectedFile} untouched by this batch`, !text.includes("last_sync_error_code") && !text.includes("emailSyncHealth"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
