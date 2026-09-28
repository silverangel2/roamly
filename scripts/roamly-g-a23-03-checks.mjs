import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  backgroundDetectorIncident,
  DETECTOR_FAILURE_CLASS,
  detectorFailureResult,
  INCIDENT_BUCKET_MS
} from "../lib/roamly/observabilityDetectorDiagnosticsLogic.ts";

const now = Math.floor(Date.parse("2026-09-28T12:07:00.000Z") / INCIDENT_BUCKET_MS) * INCIDENT_BUCKET_MS + 1000;
const result = detectorFailureResult("communication_stuck");
assert.equal(result.ok, false);
assert.equal(result.error, "DETECTOR_FAILED");
assert.equal(result.failure_class, DETECTOR_FAILURE_CLASS);
assert.equal(result.detector_failed, "communication_stuck");

const recorded = [
  backgroundDetectorIncident({
    detector: "communication_stuck",
    route: "/api/cron/roamly-itinerary-generation",
    now
  }),
  backgroundDetectorIncident({
    detector: "communication_stuck",
    route: "/api/cron/roamly-itinerary-generation",
    now: now + INCIDENT_BUCKET_MS - 1001
  })
];
assert.equal(recorded.length, 2);
assert.equal(recorded[0].eventCode, "observability_detector_failed");
assert.equal(recorded[0].severity, "medium");
assert.deepEqual(recorded[0].fingerprintParts, ["observability-detector", "communication_stuck", DETECTOR_FAILURE_CLASS]);
assert.equal(recorded[0].eventKey, recorded[1].eventKey, "repeated failures in one bucket must coalesce");
assert.deepEqual(recorded[0].safeMetadata, {
  failure_class: DETECTOR_FAILURE_CLASS,
  job_type: "communication_stuck",
  endpoint: "/api/cron/roamly-itinerary-generation",
  operation: "background_observability_detector",
  retryable: true,
  source: "background_detector"
});

const nextBucket = backgroundDetectorIncident({
  detector: "communication_stuck",
  route: "/api/cron/roamly-itinerary-generation",
  now: now + INCIDENT_BUCKET_MS
});
assert.notEqual(nextBucket.eventKey, recorded[0].eventKey);

const otherDetector = backgroundDetectorIncident({
  detector: "gmail_staleness",
  route: "/api/cron/roamly-booking-monitor",
  now
});
assert.notEqual(otherDetector.eventKey, recorded[0].eventKey);

const diagnostics = fs.readFileSync(path.resolve("lib/roamly/observabilityDetectorDiagnostics.ts"), "utf8");
const diagnosticsLogic = fs.readFileSync(path.resolve("lib/roamly/observabilityDetectorDiagnosticsLogic.ts"), "utf8");
assert.match(diagnostics, /recordOperationalEvent/);
assert.match(diagnostics, /catch/);
assert.match(diagnostics, /detector diagnostic unavailable/);
assert.match(diagnostics, /backgroundDetectorIncident/);
assert.doesNotMatch(diagnostics, /raw body|payload|customer email|passport|token/i);

/* The server recorder is fail-open; source-level wiring verifies its injected
   recorder path without requiring a Next/Supabase runtime in plain Node. */
const recorderFailurePath = fs.readFileSync(path.resolve("lib/roamly/observabilityDetectorDiagnostics.ts"), "utf8");
assert.match(recorderFailurePath, /return false/);

const forbidden = ["customer@example.com", "private content", "passport", "latitude", "authorization", "token", "sql"];
const serialized = JSON.stringify(recorded[0]);
for (const value of forbidden) assert.equal(serialized.toLowerCase().includes(value), false, `metadata must not include ${value}`);

const generationRoute = fs.readFileSync(path.resolve("app/api/cron/roamly-itinerary-generation/route.ts"), "utf8");
const notificationRoute = fs.readFileSync(path.resolve("app/api/cron/roamly-notifications/route.ts"), "utf8");
const bookingMonitor = fs.readFileSync(path.resolve("lib/roamly/bookingMonitor.ts"), "utf8");
for (const source of [generationRoute, notificationRoute, bookingMonitor]) {
  assert.match(source, /recordBackgroundDetectorFailure/);
  assert.match(source, /detectorFailureResult/);
}
assert.match(diagnosticsLogic, /observability_detector_failed/);
assert.match(diagnosticsLogic, /background_jobs/);
assert.match(diagnosticsLogic, /INCIDENT_BUCKET_MS/);

console.log("G-A23-03 background detector diagnostics checks passed.");
