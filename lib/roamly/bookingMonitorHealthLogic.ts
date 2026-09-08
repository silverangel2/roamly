export const BOOKING_MONITOR_INTERVAL_MS = 10 * 60 * 1000;
export const BOOKING_MONITOR_LOCK_MS = 12 * 60 * 1000;
export const BOOKING_MONITOR_STALE_AFTER_MS = 3 * BOOKING_MONITOR_INTERVAL_MS;
export const BOOKING_MONITOR_RUN_GRACE_MS = BOOKING_MONITOR_LOCK_MS + BOOKING_MONITOR_INTERVAL_MS;
export const BOOKING_MONITOR_BOOTSTRAP_GRACE_MS = 30 * 60 * 1000;

export type BookingMonitorRun = {
  id?: string | null;
  status?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  failures?: number | null;
};

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function terminalTime(run: BookingMonitorRun) {
  return timestamp(run.completed_at) ?? timestamp(run.started_at);
}

function classifyBootstrap(monitoringStartedAt: string | null | undefined, now: number) {
  const started = timestamp(monitoringStartedAt);
  if (started === null) return { state: "bootstrap" as const, reason: "bootstrap_timestamp_unavailable" };
  return now - started < BOOKING_MONITOR_BOOTSTRAP_GRACE_MS
    ? { state: "bootstrap" as const, reason: "bootstrap_grace" }
    : { state: "stale" as const, reason: "never_ran" };
}

export function classifyBookingMonitorHealth(
  runs: BookingMonitorRun[],
  now: Date | number,
  monitoringStartedAt?: string | null
) {
  const current = now instanceof Date ? now.getTime() : now;
  const ordered = [...runs].sort((a, b) => (timestamp(b.started_at) ?? 0) - (timestamp(a.started_at) ?? 0));
  const latest = ordered[0] || null;

  if (!ordered.length) {
    const bootstrap = classifyBootstrap(monitoringStartedAt, current);
    return { state: bootstrap.state === "stale" ? "stale" as const : "bootstrap" as const, reason: bootstrap.reason, latest };
  }

  const successful = ordered.find((run) => run.status === "completed" && timestamp(run.completed_at) !== null);
  const successAt = successful ? timestamp(successful.completed_at) : null;
  const active = ordered.find((run) => {
    const started = timestamp(run.started_at);
    return run.status === "running" && !run.completed_at && started !== null && (successAt === null || started > successAt);
  });

  if (active) {
    const started = timestamp(active.started_at);
    if (started !== null && current - started <= BOOKING_MONITOR_RUN_GRACE_MS) {
      return { state: "healthy" as const, reason: "run_in_progress", latest, active, successful };
    }
    return { state: "stale" as const, reason: "run_stuck", latest, active, successful };
  }

  if (successAt !== null && current - successAt < BOOKING_MONITOR_STALE_AFTER_MS) {
    return { state: "healthy" as const, reason: "recent_success", latest, successful };
  }

  const recentTerminalFailures = ordered.filter((run) => {
    const ended = terminalTime(run);
    return (run.status === "failed" || run.status === "partial") && ended !== null && current - ended <= BOOKING_MONITOR_STALE_AFTER_MS;
  }).length;
  const latestAge = terminalTime(latest);
  const materiallyOverdue = latestAge !== null && current - latestAge >= BOOKING_MONITOR_STALE_AFTER_MS;
  if (materiallyOverdue || (recentTerminalFailures >= 2 && (successAt === null || current - successAt >= BOOKING_MONITOR_STALE_AFTER_MS))) {
    return { state: "stale" as const, reason: recentTerminalFailures >= 2 ? "repeated_failures" : "success_overdue", latest, successful };
  }

  return { state: "healthy" as const, reason: "within_grace", latest, successful };
}
