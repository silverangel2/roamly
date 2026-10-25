/**
 * Email sync health: one shared definition of a "persistently failing"
 * Gmail sync, used by the account page and the trip state line so both
 * surfaces always agree. Pure and client-safe: no server imports.
 *
 * A sync is persistent-failing only when the connection row itself is in
 * "error" (a real attempt ran and failed) AND the last successful sync is
 * more than 24 hours old. The 24-hour bar is deliberate: the email-sync
 * cron runs every 30 minutes and the booking monitor retries "error" rows
 * every 10 minutes, so a full day without success is not transient — it
 * is a stuck pipe. A first sync that has never succeeded is never flagged:
 * it may still be running.
 *
 * Display-only: this never flips any gate input. gmailConnected stays
 * exactly what the gate view says; this only decides which words the
 * traveler sees next to it.
 */

/** A full day without a successful sync, across both retry cadences. */
export const GMAIL_SYNC_PERSISTENT_FAILURE_MS = 24 * 60 * 60 * 1000;

/** Failure codes that mean the stored tokens cannot recover on their own. */
export const GMAIL_SYNC_RECONNECT_CODES = [
  "GMAIL_TOKEN_REFRESH_RETRY",
  "GMAIL_REAUTH_REQUIRED",
  "GMAIL_BACKFILL_TOKEN_FAILED"
] as const;

export function gmailSyncFailureNeedsReconnect(errorCode: string | null | undefined): boolean {
  if (!errorCode) return false;
  return (GMAIL_SYNC_RECONNECT_CODES as readonly string[]).includes(errorCode);
}

export function isGmailSyncPersistentlyFailing(input: {
  connectionStatus: string | null | undefined;
  lastSyncedAt: string | null | undefined;
}): boolean {
  if (input.connectionStatus !== "error") return false;
  if (!input.lastSyncedAt) return false;
  const lastSyncMs = Date.parse(input.lastSyncedAt);
  if (!Number.isFinite(lastSyncMs)) return false;
  return Date.now() - lastSyncMs > GMAIL_SYNC_PERSISTENT_FAILURE_MS;
}

/**
 * Plain words for a persistent failure. The reconnect class names the only
 * fix that works (fresh tokens); every other class asks for a retry first,
 * so a transient failure never pushes the traveler into a reconnect that
 * would reset the scan cursor.
 */
export function gmailSyncFailureAction(errorCode: string | null | undefined): "reconnect" | "retry" {
  return gmailSyncFailureNeedsReconnect(errorCode) ? "reconnect" : "retry";
}
