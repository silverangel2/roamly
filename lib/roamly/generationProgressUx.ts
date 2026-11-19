// Pure decisions for the generation progress UI (trip page).
//
// This module is deliberately pure and dependency-free: it only reshapes
// numbers and strings the server already measured. Nothing here invents,
// simulates, or animates progress. The 5-minute notice is derived from
// the SERVER timestamp (progress.startedAt) on the existing poll — never
// a bare setTimeout(300_000), which dies with the tab and fires wrongly
// after a reload. The cold-city ETA is a range with a reason, never a
// fake precise number; when the pack lands the caller re-derives the
// estimate from the fresh poll, so the estimate is a live value, not a
// one-time label.

export const FIVE_MINUTE_NOTICE_SECONDS = 300;

export const COLD_PACK_ETA_MINUTES = { low: 15, high: 60 } as const;

export type PackWaitInput = {
  destinationId: string;
  since: string;
  waits: number;
} | null | undefined;

export type GenerationEmailNotificationInput = {
  completion_email_sent_at?: string | null;
  completion_email_status?: string | null;
  delivery_status?: string | null;
} | null | undefined;

// The completion email counts as sent when the server stamped it, or
// when its status is sent/captured (the status route treats "captured"
// as delivered too — the test-capture mode). Until then the 5-minute
// notice may reassure the traveler it is coming.
export function isCompletionEmailSent(
  emailNotification: GenerationEmailNotificationInput
): boolean {
  if (!emailNotification) return false;
  if (emailNotification.completion_email_sent_at) return true;
  const status = emailNotification.completion_email_status;
  if (status === "sent" || status === "captured") return true;
  const delivery = emailNotification.delivery_status;
  return delivery === "sent" || delivery === "captured";
}

// 5-minute notice eligibility (generation UX delta §3.2a). The caller
// holds the dismiss state; this is the eligibility only. The notice
// never asks for an email address — the email was already given at
// day-1-ready — and the copy (fiveMinuteNoticeText) branches on whether
// one is configured.
export function isFiveMinuteNoticeEligible(input: {
  elapsedSeconds: number;
  isTerminal: boolean;
  completionEmailSent: boolean;
}): boolean {
  return (
    !input.isTerminal &&
    input.elapsedSeconds >= FIVE_MINUTE_NOTICE_SECONDS &&
    !input.completionEmailSent
  );
}

// Exact copy (generation UX delta §3.2a). When no email is configured
// the variant never asks for one. When the background worker is not
// configured the close-page line is replaced with the honest
// keep-this-page-open line — the close-page promise only holds while
// the cron/after() path is live.
export function fiveMinuteNoticeText(input: {
  maskedEmail: string | null;
  backgroundWorkerConfigured: boolean;
}): string {
  if (input.maskedEmail) {
    return (
      "Still building — this one's taking a little longer than usual. " +
      `Your itinerary will be sent to ${input.maskedEmail} when it's ready.` +
      (input.backgroundWorkerConfigured
        ? " You can close this page; nothing is lost."
        : " Keep this page open while Roamly finishes.")
    );
  }
  return (
    "Your progress is saved as it goes." +
    (input.backgroundWorkerConfigured ? "" : " Keep this page open while Roamly finishes.")
  );
}

// Estimated generation time, calibrated to production measurements
// (2026-10-21): context prep runs before the first stage, the outline
// call takes ~9s, each day batch ~9–14s of model time, and a healthy
// 5-day trip completes end to end in ~95–115s. Shown to travelers as
// a friendly range — a guide, never a promise. Warm cities only; see
// generationEstimate for the cold branch.
export function estimateGenerationRangeSeconds(totalDayCount: number) {
  const days = Math.max(1, Math.round(totalDayCount || 1));
  return { low: 15 + 16 * days, high: 25 + 18 * days };
}

export function formatEstimateRange(range: { low: number; high: number }) {
  if (range.high <= 60) return "under a minute";
  const lowMinutes = Math.max(1, Math.floor(range.low / 60));
  const highMinutes = Math.max(lowMinutes + 1, Math.ceil(range.high / 60));
  return `about ${lowMinutes}–${highMinutes} minutes`;
}

export type GenerationEstimate =
  | { kind: "warm"; low: number; high: number }
  | {
      kind: "cold";
      destinationId: string;
      since: string;
      waits: number;
      waitElapsedSeconds: number;
    };

// Honest ETA (generation UX delta §3.2c). Warm: the calibrated formula.
// Cold (waiting on a pack): no precise number — the range + reason
// (coldPackEtaText). When the pack lands, waitingOnPack clears on the
// next poll and the caller re-derives warm — the estimate is a live
// value, not a one-time label.
export function generationEstimate(input: {
  totalDayCount: number;
  waitingOnPack: PackWaitInput;
  nowMs: number;
}): GenerationEstimate {
  const waiting = input.waitingOnPack;
  if (waiting) {
    const sinceMs = Date.parse(waiting.since);
    const waitElapsedSeconds = Number.isFinite(sinceMs)
      ? Math.max(0, (input.nowMs - sinceMs) / 1000)
      : 0;
    return {
      kind: "cold",
      destinationId: waiting.destinationId,
      since: waiting.since,
      waits: waiting.waits,
      waitElapsedSeconds
    };
  }
  const range = estimateGenerationRangeSeconds(input.totalDayCount);
  return { kind: "warm", low: range.low, high: range.high };
}

function coldPackEtaRangeLabel() {
  return `${COLD_PACK_ETA_MINUTES.low}–${COLD_PACK_ETA_MINUTES.high} minutes`;
}

// Cold-city ETA copy (generation UX delta §3.2c). A range with the
// reason, never a fake precise number, and never past the 2 h
// pack-wait terminal cap (the range top is 60 minutes, well inside
// it). Past the range top the copy says so plainly instead of
// repeating a stale range.
export function coldPackEtaText(input: {
  destinationLabel: string;
  emailConfigured: boolean;
  waitElapsedSeconds: number;
}): string {
  const range = coldPackEtaRangeLabel();
  if (input.waitElapsedSeconds > COLD_PACK_ETA_MINUTES.high * 60) {
    return input.emailConfigured
      ? `Still waiting on ${input.destinationLabel} map data — this is taking longer than the usual ${range}. We'll email you the moment it's ready.`
      : `Still waiting on ${input.destinationLabel} map data — this is taking longer than the usual ${range}. Your progress is saved as it goes.`;
  }
  return input.emailConfigured
    ? `First time for ${input.destinationLabel} — Roamly is building its map data first. Usually ${range}; we'll email you the moment it's ready.`
    : `First time for ${input.destinationLabel} — Roamly is building its map data first. Usually ${range}. Your progress is saved as it goes.`;
}
