export const COMMUNICATION_STUCK_GRACE_MS = 15 * 60 * 1000;
export const NOTIFICATION_SCHEDULER_GRACE_MS = 2 * 60 * 60 * 1000;

export type CommunicationLedgerCandidate = {
  id: string;
  status: string;
  scheduled_for: string;
  useful_until?: string | null;
  attempt_count: number;
  max_attempts: number;
  retryable: boolean;
  next_retry_at?: string | null;
  claimed_at?: string | null;
  sent_at?: string | null;
  suppression_reason?: string | null;
  last_error_code?: string | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
};

export type CommunicationStuckFinding = {
  failureClass: "due_never_processed" | "abandoned_claim" | "overdue_retry" | "retry_exhaustion";
  candidate: CommunicationLedgerCandidate;
};

function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function intentionallyExcluded(candidate: CommunicationLedgerCandidate, now: number) {
  if (["sent", "suppressed", "cancelled", "expired", "stale"].includes(candidate.status)) return true;
  const usefulUntil = time(candidate.useful_until);
  if (usefulUntil !== null && usefulUntil <= now) return true;
  const metadata = candidate.metadata || {};
  return ["suppressed", "stale", "expired", "cancelled", "skipped", "duplicate_suppressed", "cross_channel_suppressed"]
    .some((key) => metadata[key] === true || metadata[key] === "true");
}

function uncertainAcceptance(candidate: CommunicationLedgerCandidate) {
  return /(?:uncertain[_ -]?acceptance|acceptance[_ -]?uncertain)/i.test(String(candidate.last_error_code || "")) || candidate.metadata?.uncertainAcceptance === true;
}

export function classifyCommunicationStuck(
  candidate: CommunicationLedgerCandidate,
  nowValue: Date | number,
  graceMs = COMMUNICATION_STUCK_GRACE_MS
): CommunicationStuckFinding | null {
  const now = nowValue instanceof Date ? nowValue.getTime() : nowValue;
  if (intentionallyExcluded(candidate, now) || uncertainAcceptance(candidate)) return null;
  const scheduled = time(candidate.scheduled_for);
  if (scheduled === null) return null;
  const due = scheduled <= now - graceMs;
  if (candidate.status === "pending" && candidate.attempt_count === 0 && due) {
    return { failureClass: "due_never_processed", candidate };
  }
  const claimed = time(candidate.claimed_at);
  if (candidate.status === "claimed" && claimed !== null && claimed <= now - graceMs) {
    return { failureClass: "abandoned_claim", candidate };
  }
  if (candidate.status === "failed" && candidate.attempt_count >= candidate.max_attempts) {
    return { failureClass: "retry_exhaustion", candidate };
  }
  const nextRetry = time(candidate.next_retry_at);
  if (candidate.status === "failed" && candidate.retryable === true && nextRetry !== null && nextRetry <= now - graceMs) {
    return { failureClass: "overdue_retry", candidate };
  }
  return null;
}

function expectedNotificationRun(now: number) {
  const expected = new Date(now);
  expected.setUTCHours(13, 0, 0, 0);
  if (expected.getTime() > now) expected.setUTCDate(expected.getUTCDate() - 1);
  return expected.getTime();
}

export function notificationSchedulerIsStale(
  lastSuccessfulAt: string | null | undefined,
  nowValue: Date | number,
  monitoringStartedAt?: string | null,
  graceMs = NOTIFICATION_SCHEDULER_GRACE_MS
) {
  const now = nowValue instanceof Date ? nowValue.getTime() : nowValue;
  const expected = expectedNotificationRun(now);
  const started = time(monitoringStartedAt);
  if (started !== null && started > expected) return false;
  const lastSuccess = time(lastSuccessfulAt);
  return lastSuccess === null || lastSuccess < expected && now >= expected + graceMs;
}

export function communicationStuckStateKey(finding: CommunicationStuckFinding) {
  const candidate = finding.candidate;
  return [finding.failureClass, candidate.status, candidate.attempt_count, candidate.claimed_at || "", candidate.next_retry_at || "", candidate.updated_at || ""].join("|");
}
