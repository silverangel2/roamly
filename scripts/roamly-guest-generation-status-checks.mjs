// Guest generation status checks: the guest page must show what is REALLY
// happening (stage, day count, time from measured pace) and never a fake or
// simulated progress bar.
//
// The inputs below are NOT live data and do not pretend to be: they are
// shape-faithful copies of the publicStagedGenerationProgress() record
// (status, currentStage, completedDayCount, totalDayCount, days[],
// stageRuns[], startedAt) used to prove the mapping + estimation math.
// The route wires the live record into the same builder; see
// app/api/trips/guest-itinerary/route.ts.
import assert from "node:assert/strict";

const { buildGuestGenerationStatus, guestGenerationStatusLines } = await import(
  "../lib/roamly/guestGenerationStatus.ts"
);

const NOW = Date.parse("2026-10-24T14:00:00.000Z");
const MIN = 60_000;
const TWO_HOURS = 7_200_000;

function base(overrides) {
  return {
    viewStatus: "building",
    progress: null,
    waitingForPack: false,
    failedTimeout: false,
    destination: "Manila",
    tripStartedAt: null,
    nowMs: NOW,
    maxPackWaitMs: TWO_HOURS,
    ...overrides
  };
}

function lines(status, deadlineLabel = null) {
  return guestGenerationStatusLines(status, deadlineLabel);
}

// --- 1. Pack wait: zero days, outline stage, pack wait flagged -------------
const packWait = buildGuestGenerationStatus(
  base({
    progress: {
      status: "queued",
      currentStage: "generating_outline",
      completedDayCount: 0,
      totalDayCount: 6,
      days: [],
      stageRuns: [],
      startedAt: new Date(NOW - 30 * MIN).toISOString()
    },
    waitingForPack: true,
    tripStartedAt: new Date(NOW - 30 * MIN).toISOString()
  })
);
assert.equal(packWait.phase, "pack_wait");
assert.equal(packWait.completedDayCount, 0);
assert.equal(packWait.estimatedRemainingMs, null, "pack wait must never invent a countdown");
assert.equal(packWait.packWaitDeadlineAt, new Date(NOW - 30 * MIN + TWO_HOURS).toISOString());
assert.equal(packWait.elapsedMs, 30 * MIN);
const packWaitLines = lines(packWait, "3:30 PM");
assert.equal(packWaitLines.headline, "Waiting for Manila map data.");
assert.match(packWaitLines.detail, /no fixed time/);
assert.match(packWaitLines.detail, /3:30 PM/);
assert.match(packWaitLines.estimate, /30 minutes so far/);

// --- 2. Day building with measured pace from finished batch runs ----------
const paced = buildGuestGenerationStatus(
  base({
    progress: {
      status: "generating_day",
      currentStage: "generating_day",
      completedDayCount: 2,
      totalDayCount: 6,
      days: [],
      stageRuns: [
        { stage: "day_batch", status: "success", durationMs: 10 * MIN, dayNumbers: [1] },
        { stage: "day_batch", status: "success", durationMs: 10 * MIN, dayNumbers: [2] },
        { stage: "outline", status: "success", durationMs: 5 * MIN, dayNumbers: null }
      ],
      startedAt: new Date(NOW - 25 * MIN).toISOString()
    }
  })
);
assert.equal(paced.phase, "day");
assert.equal(paced.paceMsPerDay, 10 * MIN, "outline runs must not pollute the day pace");
assert.equal(paced.estimatedRemainingMs, 40 * MIN, "4 remaining days x 10-minute pace");
const pacedLines = lines(paced);
assert.equal(pacedLines.headline, "Building day 3 of 6.");
assert.equal(pacedLines.detail, "Day 2 of 6 done.");
assert.equal(pacedLines.estimate, "about 40 minutes left, from your trip's own pace.");

// --- 3. Day building, first day unfinished: honest, no fake estimate -------
const firstDay = buildGuestGenerationStatus(
  base({
    progress: {
      status: "generating_day",
      currentStage: "generating_day",
      completedDayCount: 0,
      totalDayCount: 6,
      days: [],
      stageRuns: [],
      startedAt: new Date(NOW - 3 * MIN).toISOString()
    }
  })
);
assert.equal(firstDay.estimatedRemainingMs, null);
assert.equal(
  lines(firstDay).estimate,
  "No time estimate yet — the first day has not finished."
);

// --- 4. Per-day timing path: finished day start-to-finish ------------------
const dayTimed = buildGuestGenerationStatus(
  base({
    progress: {
      status: "generating_day",
      currentStage: "generating_day",
      completedDayCount: 1,
      totalDayCount: 4,
      days: [
        {
          status: "complete",
          startedAt: new Date(NOW - 8 * MIN).toISOString(),
          completedAt: new Date(NOW - 3 * MIN).toISOString()
        }
      ],
      stageRuns: [],
      startedAt: new Date(NOW - 8 * MIN).toISOString()
    }
  })
);
assert.equal(dayTimed.paceMsPerDay, 5 * MIN);
assert.equal(dayTimed.estimatedRemainingMs, 15 * MIN);

// --- 5. Outline, queued, validation, enrichment ----------------------------
const outline = buildGuestGenerationStatus(
  base({
    progress: {
      status: "generating_outline",
      currentStage: "generating_outline",
      completedDayCount: 0,
      totalDayCount: 6,
      days: [],
      stageRuns: [],
      startedAt: new Date(NOW - 2 * MIN).toISOString()
    }
  })
);
assert.equal(outline.phase, "outline");
assert.equal(lines(outline).headline, "Drawing up the plan for your trip.");
assert.equal(lines(outline).estimate, null, "no finished day, no estimate");

const queued = buildGuestGenerationStatus(
  base({
    progress: {
      status: "queued",
      currentStage: "queued",
      completedDayCount: 0,
      totalDayCount: 6,
      days: [],
      stageRuns: [],
      startedAt: new Date(NOW - MIN).toISOString()
    }
  })
);
assert.equal(lines(queued).headline, "Your trip is in line to be built.");

const validating = buildGuestGenerationStatus(
  base({
    progress: {
      status: "validating_day",
      currentStage: "validating_day",
      completedDayCount: 3,
      totalDayCount: 6,
      days: [],
      stageRuns: [{ stage: "day_batch", status: "success", durationMs: 6 * MIN, dayNumbers: [1, 2, 3] }],
      startedAt: new Date(NOW - 20 * MIN).toISOString()
    }
  })
);
assert.equal(lines(validating).headline, "Checking day 4 of 6.");
assert.equal(validating.paceMsPerDay, 2 * MIN, "multi-day batch run splits across its days");
assert.equal(validating.estimatedRemainingMs, 6 * MIN);

const enriching = buildGuestGenerationStatus(
  base({
    progress: {
      status: "enriching_transport",
      currentStage: "enriching_transport",
      completedDayCount: 6,
      totalDayCount: 6,
      days: [],
      stageRuns: [],
      startedAt: new Date(NOW - 30 * MIN).toISOString()
    }
  })
);
assert.equal(lines(enriching).headline, "Adding the finishing touches to your trip.");
assert.equal(enriching.estimatedRemainingMs, null, "nothing remains, nothing to estimate");

// --- 6. Ready, failed, failed-timeout --------------------------------------
const ready = buildGuestGenerationStatus(base({ viewStatus: "ready", progress: null }));
assert.equal(ready.phase, "done");

const failed = buildGuestGenerationStatus(base({ viewStatus: "failed", progress: null }));
assert.equal(lines(failed).headline, "Roamly could not finish this free itinerary.");
assert.equal(lines(failed).detail, null, "generic failure names no cause");

const failedTimeout = buildGuestGenerationStatus(
  base({
    viewStatus: "failed",
    failedTimeout: true,
    progress: {
      status: "failed",
      currentStage: "failed",
      completedDayCount: 0,
      totalDayCount: 6,
      days: [],
      stageRuns: [],
      startedAt: new Date(NOW - TWO_HOURS - MIN).toISOString()
    }
  })
);
assert.equal(lines(failedTimeout).detail, "It waited the full time for map data. Try again later, when the destination's map data is ready.");

// --- 7. Legacy trip without a progress record: old sentence, nothing fake ---
const legacy = buildGuestGenerationStatus(base({ progress: null }));
assert.equal(legacy.phase, "unknown");
assert.equal(
  lines(legacy).headline,
  "Roamly is building your free itinerary. Completed days appear here as they are ready."
);
assert.equal(lines(legacy).estimate, null);

// --- 8. Nothing secret, internal, or fabricated ever leaves the builder ----
for (const status of [packWait, paced, firstDay, dayTimed, outline, queued, validating, enriching, ready, failed, failedTimeout, legacy]) {
  const json = JSON.stringify(status);
  for (const forbidden of ["lastError", "errorCode", "ZERO_ENGINE", "stack", "token", "secret", "model", "provider", "cost", "percent"]) {
    assert.ok(!json.includes(forbidden), `status JSON must not contain ${forbidden}`);
  }
}

// --- State table: what each state renders on the guest page ---------------
const table = [
  ["pack wait (0/6 days)", packWaitLines],
  ["day building, paced (2/6)", pacedLines],
  ["day building, no pace (0/6)", lines(firstDay)],
  ["outline (0/6)", lines(outline)],
  ["queued", lines(queued)],
  ["validating (3/6)", lines(validating)],
  ["enriching (6/6)", lines(enriching)],
  ["ready", lines(ready)],
  ["failed", lines(failed)],
  ["failed, map-data timeout", lines(failedTimeout)],
  ["legacy, no progress record", lines(legacy)]
];
console.log("Guest generation status — what each state renders:");
for (const [state, rendered] of table) {
  console.log(`- ${state}: "${rendered.headline}"${rendered.detail ? ` / "${rendered.detail}"` : ""}${rendered.estimate ? ` / "${rendered.estimate}"` : ""}`);
}
console.log("PASS: guest generation status is real, measured, and never faked");
