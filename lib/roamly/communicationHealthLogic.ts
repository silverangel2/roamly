export const NOTIFICATION_SCHEDULER_HOUR_UTC = 13;
export const NOTIFICATION_SCHEDULER_GRACE_MS = 30 * 60 * 1000;

type HealthState = "bootstrap" | "healthy" | "stale";

export function notificationSchedulerHealth(params: {
  now: Date | number;
  monitoringStartedAt: string;
  lastSuccessfulAt?: string | null;
  graceMs?: number;
}) {
  const nowMs = params.now instanceof Date ? params.now.getTime() : params.now;
  const now = new Date(nowMs);
  const graceMs = params.graceMs ?? NOTIFICATION_SCHEDULER_GRACE_MS;
  const expectedToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), NOTIFICATION_SCHEDULER_HOUR_UTC);
  const expectedAt = nowMs >= expectedToday ? expectedToday : expectedToday - 24 * 60 * 60 * 1000;
  const startedAt = Date.parse(params.monitoringStartedAt);
  const lastSuccessfulAt = params.lastSuccessfulAt ? Date.parse(params.lastSuccessfulAt) : null;
  const nextExpectedAt = expectedAt + 24 * 60 * 60 * 1000;

  if (lastSuccessfulAt !== null && Number.isFinite(lastSuccessfulAt)) {
    return lastSuccessfulAt >= expectedAt || nowMs <= expectedAt + graceMs
      ? { state: "healthy" as HealthState, reason: "within_expected_daily_window", expectedAt: new Date(expectedAt).toISOString() }
      : { state: "stale" as HealthState, reason: "success_overdue", expectedAt: new Date(expectedAt).toISOString() };
  }

  if (Number.isFinite(startedAt) && startedAt > expectedAt + graceMs) {
    return { state: "bootstrap" as HealthState, reason: "before_first_expected_run", expectedAt: new Date(nextExpectedAt).toISOString() };
  }

  return nowMs <= expectedAt + graceMs
    ? { state: "bootstrap" as HealthState, reason: "awaiting_first_success", expectedAt: new Date(expectedAt).toISOString() }
    : { state: "stale" as HealthState, reason: "never_succeeded", expectedAt: new Date(expectedAt).toISOString() };
}
