// Generation UX delta checks (§3.2a + §3.2c): the 5-minute notice and
// the honest cold-city ETA on the trip page.
//
// The decisions under test live in the pure module
// lib/roamly/generationProgressUx.ts (no timers, no React, no fake
// progress — everything derives from the server timestamp and the real
// pack-wait state). The public-payload section proves waitingOnPack
// reaches the poll payload via publicStagedGenerationProgress(); the
// component renders what these return. Inputs below are shape-faithful
// copies of the live records, not live data.
import assert from "node:assert/strict";

const {
  COLD_PACK_ETA_MINUTES,
  coldPackEtaText,
  estimateGenerationRangeSeconds,
  formatEstimateRange,
  fiveMinuteNoticeText,
  generationEstimate,
  isCompletionEmailSent,
  isFiveMinuteNoticeEligible
} = await import("../lib/roamly/generationProgressUx.ts");

const { publicStagedGenerationProgress } = await import(
  "../lib/roamly/stagedItineraryGeneration.ts"
);

const NOW = Date.parse("2026-11-19T08:00:00.000Z");
const MIN = 60_000;

let count = 0;
function check(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, `${label}\n  GOT:  ${JSON.stringify(actual)}\n  WANT: ${JSON.stringify(expected)}`);
  console.log(`  PASS ${label}`);
}

// --- §(a) 5-minute notice eligibility --------------------------------------
// (a1) Known-city trip still generating at 5:00 with email on → eligible.
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 300, isTerminal: false, completionEmailSent: false }),
  true,
  "(a1) generating at 5:00, email not sent → notice eligible"
);
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 301, isTerminal: false, completionEmailSent: false }),
  true,
  "(a1) generating past 5:00 → still eligible"
);
// (a2) Trip completing at 4:50 → banner never appears.
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 290, isTerminal: false, completionEmailSent: false }),
  false,
  "(a2) generating at 4:50 → notice not eligible yet"
);
// (a3) Trip completing at 5:30 → eligible at 5:00, gone on completion.
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 300, isTerminal: false, completionEmailSent: false }),
  true,
  "(a3) eligible at 5:00 for a trip that completes at 5:30"
);
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 330, isTerminal: true, completionEmailSent: false }),
  false,
  "(a3) terminal at 5:30 → notice never fires after completion"
);
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 330, isTerminal: true, completionEmailSent: true }),
  false,
  "(a3) terminal + email sent → notice gone"
);
// (a4) Reload at 6:00 mid-generation → present immediately (server
// timestamp, not a fresh client timer): elapsed is derived from
// startedAt, so a remount 6 minutes in is eligible at once.
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 360, isTerminal: false, completionEmailSent: false }),
  true,
  "(a4) reload at 6:00 mid-generation → eligible immediately"
);
// Completion email sent → the notice must not promise an email that
// already landed.
check(
  isFiveMinuteNoticeEligible({ elapsedSeconds: 400, isTerminal: false, completionEmailSent: true }),
  false,
  "completion email already sent → notice not eligible"
);

// --- isCompletionEmailSent ---------------------------------------------------
check(isCompletionEmailSent(null), false, "no email record → not sent");
check(isCompletionEmailSent({}), false, "empty email record → not sent");
check(
  isCompletionEmailSent({ completion_email_sent_at: "2026-11-19T08:05:00.000Z" }),
  true,
  "stamped sent_at → sent"
);
check(
  isCompletionEmailSent({ completion_email_status: "sent" }),
  true,
  "status sent → sent"
);
check(
  isCompletionEmailSent({ completion_email_status: "captured" }),
  true,
  "status captured (test-capture mode) → sent"
);
check(
  isCompletionEmailSent({ delivery_status: "sent" }),
  true,
  "delivery sent → sent"
);
check(
  isCompletionEmailSent({ completion_email_status: "failed" }),
  false,
  "status failed → not sent"
);

// --- §(a) 5-minute notice copy (exact) --------------------------------------
const MASKED = "j•••@gmail.com";
check(
  fiveMinuteNoticeText({ maskedEmail: MASKED, backgroundWorkerConfigured: true }),
  "Still building — this one's taking a little longer than usual. " +
    `Your itinerary will be sent to ${MASKED} when it's ready. You can close this page; nothing is lost.`,
  "(a1) exact copy with email on + worker configured"
);
check(
  fiveMinuteNoticeText({ maskedEmail: MASKED, backgroundWorkerConfigured: false }),
  "Still building — this one's taking a little longer than usual. " +
    `Your itinerary will be sent to ${MASKED} when it's ready. Keep this page open while Roamly finishes.`,
  "worker not configured → close-page line replaced with keep-open line"
);
// (a5) Email not configured → no-email variant, never asks for an address.
const noEmail = fiveMinuteNoticeText({ maskedEmail: null, backgroundWorkerConfigured: true });
check(noEmail, "Your progress is saved as it goes.", "(a5) no-email variant, exact copy");
check(
  fiveMinuteNoticeText({ maskedEmail: null, backgroundWorkerConfigured: false }),
  "Your progress is saved as it goes. Keep this page open while Roamly finishes.",
  "(a5) no-email variant + worker not configured → keep-open line appended"
);
// The notice copy never contains an email-address prompt.
for (const text of [
  fiveMinuteNoticeText({ maskedEmail: MASKED, backgroundWorkerConfigured: true }),
  fiveMinuteNoticeText({ maskedEmail: null, backgroundWorkerConfigured: true })
]) {
  assert.ok(!/enter your email|type your email|add your email/i.test(text), "notice copy must never ask for an email address");
  count += 1;
}
console.log("  PASS notice copy never asks for an email address");

// --- §(c) warm ETA (formula unchanged) ---------------------------------------
check(estimateGenerationRangeSeconds(5), { low: 95, high: 115 }, "(c1) warm 5-day formula unchanged: 95–115s");
check(estimateGenerationRangeSeconds(1), { low: 31, high: 43 }, "warm 1-day formula unchanged: 31–43s");
check(formatEstimateRange({ low: 95, high: 115 }), "about 1–2 minutes", "(c1) warm 5-day renders 'about 1–2 minutes'");
check(formatEstimateRange({ low: 31, high: 43 }), "under a minute", "warm 1-day renders 'under a minute'");

const warm = generationEstimate({ totalDayCount: 5, waitingOnPack: null, nowMs: NOW });
check(warm, { kind: "warm", low: 95, high: 115 }, "(c1) no pack wait → warm branch");

// --- §(c) cold ETA (range + reason, never a fake precise number) ------------
const coldWait = { destinationId: "dst-yichun", since: new Date(NOW - 5 * MIN).toISOString(), waits: 1 };
const cold = generationEstimate({ totalDayCount: 5, waitingOnPack: coldWait, nowMs: NOW });
check(cold.kind, "cold", "(c2) pack wait present → cold branch");
check(cold.waitElapsedSeconds, 300, "(c2) wait elapsed derives from since + nowMs");
check(cold.destinationId, "dst-yichun", "cold carries the destination id");
check(
  coldPackEtaText({ destinationLabel: "Yichun", emailConfigured: true, waitElapsedSeconds: 300 }),
  "First time for Yichun — Roamly is building its map data first. Usually 15–60 minutes; we'll email you the moment it's ready.",
  "(c2) cold copy with email, exact"
);
check(
  coldPackEtaText({ destinationLabel: "Yichun", emailConfigured: false, waitElapsedSeconds: 300 }),
  "First time for Yichun — Roamly is building its map data first. Usually 15–60 minutes. Your progress is saved as it goes.",
  "(c2) cold copy without email → no email promise"
);
// The cold range never promises past the 2 h pack-wait terminal cap.
assert.ok(COLD_PACK_ETA_MINUTES.high * 60 < 2 * 60 * 60, "cold range top (60 min) is well inside the 2 h cap");
count += 1;
console.log("  PASS cold range top is inside the 2 h pack-wait cap");
// Past the range top the copy says so plainly instead of repeating a stale range.
check(
  coldPackEtaText({ destinationLabel: "Yichun", emailConfigured: true, waitElapsedSeconds: 61 * 60 }),
  "Still waiting on Yichun map data — this is taking longer than the usual 15–60 minutes. We'll email you the moment it's ready.",
  "wait past the range top → 'taking longer' variant, not a stale range"
);

// --- §(c) cold → warm flip (the estimate is a live value) -------------------
const flipping = { totalDayCount: 5, nowMs: NOW };
const before = generationEstimate({ ...flipping, waitingOnPack: coldWait });
const after = generationEstimate({ ...flipping, waitingOnPack: null });
check(before.kind, "cold", "(c2) pack wait active → cold");
check(after, { kind: "warm", low: 95, high: 115 }, "(c2) pack lands (waitingOnPack clears) → warm on the next poll");

// --- §(c) elapsed clock and ETA never contradict ----------------------------
// The wait elapsed is computed from the same nowMs the clock ticks from.
const clocked = generationEstimate({
  totalDayCount: 5,
  waitingOnPack: { destinationId: "dst-x", since: new Date(NOW - 90 * MIN).toISOString(), waits: 3 },
  nowMs: NOW
});
check(clocked.waitElapsedSeconds, 90 * 60, "wait elapsed matches the elapsed clock");

// --- §(c) public payload: waitingOnPack reaches the poll payload -----------
function publicMetadata(waitingOnPack) {
  return {
    generation: {
      version: 2,
      tripId: "trip-ux-delta",
      status: "queued",
      currentStage: "generating_outline",
      totalDayCount: 5,
      completedDayCount: 0,
      days: {},
      batches: {},
      payload: {},
      startedAt: new Date(NOW - 5 * MIN).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      waitingOnPack
    }
  };
}
const coldPayload = publicStagedGenerationProgress(
  publicMetadata({ destinationId: "dst-yichun", since: new Date(NOW - 5 * MIN).toISOString(), waits: 2 }),
  "trip-ux-delta"
);
check(
  coldPayload && coldPayload.waitingOnPack,
  { destinationId: "dst-yichun", since: new Date(NOW - 5 * MIN).toISOString(), waits: 2 },
  "public payload carries waitingOnPack while the trip waits"
);
const warmPayload = publicStagedGenerationProgress(publicMetadata(null), "trip-ux-delta");
check(warmPayload && warmPayload.waitingOnPack, null, "public payload has waitingOnPack null on a non-waiting trip");
const malformedPayload = publicStagedGenerationProgress(
  publicMetadata({ destinationId: "dst-yichun", waits: 1 }),
  "trip-ux-delta"
);
check(malformedPayload && malformedPayload.waitingOnPack, null, "malformed waitingOnPack (no since) normalizes to null");
// The payload still carries the fields the component already renders.
check(coldPayload && coldPayload.status, "queued", "payload status intact alongside waitingOnPack");
check(coldPayload && coldPayload.totalDayCount, 5, "payload day count intact alongside waitingOnPack");

console.log(`GENERATION-UX-DELTA CHECKS: ${count}/${count} PASS`);
