export const BOOKING_MONITOR_BOOTSTRAP_GRACE_MS = 30 * 60 * 1000;

function parsedTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function classifyBookingMonitorBootstrap(
  monitoringStartedAt: string | null | undefined,
  hasRunHistory: boolean,
  now: Date | number,
  graceMs = BOOKING_MONITOR_BOOTSTRAP_GRACE_MS
) {
  if (hasRunHistory) return { state: "run_history" as const, reason: "run_history_is_authoritative" };
  const started = parsedTime(monitoringStartedAt);
  if (started === null) return { state: "bootstrap" as const, reason: "bootstrap_timestamp_unavailable" };
  const current = now instanceof Date ? now.getTime() : now;
  return current - started < graceMs
    ? { state: "bootstrap" as const, reason: "bootstrap_grace" }
    : { state: "stale" as const, reason: "never_ran" };
}
