export const GMAIL_SYNC_MONITOR_INTERVAL_MS = 10 * 60 * 1000;
export const GMAIL_STALE_AFTER_MS = 3 * GMAIL_SYNC_MONITOR_INTERVAL_MS;
export const GMAIL_RELEVANT_HORIZON_DAYS = 7;

const EXCLUDED_TRIP_STATUSES = new Set(["archived", "cancelled", "completed"]);

function parsedTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function relevantTripWindow(now: Date | number) {
  const time = now instanceof Date ? now.getTime() : now;
  const today = new Date(time).toISOString().slice(0, 10);
  const horizon = new Date(time + GMAIL_RELEVANT_HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { today, horizon };
}

export function isRelevantGmailTrip(
  trip: { start_date?: string | null; end_date?: string | null; status?: string | null },
  today: string,
  horizon: string
) {
  if (EXCLUDED_TRIP_STATUSES.has(trip.status || "")) return false;
  const start = typeof trip.start_date === "string" ? trip.start_date.slice(0, 10) : "";
  const end = typeof trip.end_date === "string" ? trip.end_date.slice(0, 10) : "";
  if (!start || start > horizon) return false;
  return start <= today ? !end || end >= today : start <= horizon;
}

export function latestGmailCheckpoint(connection: { last_synced_at?: string | null; created_at?: string | null }) {
  const candidates = [connection.last_synced_at, connection.created_at]
    .map(parsedTime)
    .filter((value): value is number => value !== null);
  return candidates.length ? Math.max(...candidates) : null;
}

export function gmailConnectionIsAuthRequired(status?: string | null) {
  return status === "needs_reauth" || status === "disconnected";
}

export function gmailConnectionIsStale(
  connection: { connection_status?: string | null; last_synced_at?: string | null; created_at?: string | null },
  now: Date | number,
  staleAfterMs = GMAIL_STALE_AFTER_MS
) {
  if (connection.connection_status !== "connected" || gmailConnectionIsAuthRequired(connection.connection_status)) return false;
  const current = now instanceof Date ? now.getTime() : now;
  const checkpoint = latestGmailCheckpoint(connection);
  return checkpoint === null || current - checkpoint >= staleAfterMs;
}
