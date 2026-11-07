import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/cron/roamly-successful-trip-patterns/route.ts", "utf8");
const worker = fs.readFileSync("lib/roamly/successfulTripExperiencePatternAggregation.ts", "utf8");

assert.match(route, /CRON_SECRET/);
assert.match(route, /isCronRequestAuthorized/);
assert.match(route, /createSupabaseAdminClient/);
assert.match(route, /runSuccessfulTripExperiencePatternAggregation/);
assert.match(worker, /from\("trip_feedback"\)/);
assert.match(worker, /eq\("feedback_type", "post_trip"\)/);
// GAP-CLOSURE 5b-2 re-pin (2026-11-02): the select gained the row
// `id` — the watermark cursor predicate (created_at, id) cannot be
// built without it. Same property intent (the feedback scan reads
// exactly the columns the aggregation consumes, plus its cursor
// key); the watermark behaviour itself is proven in test:gap-5b.
assert.match(worker, /select\("id,trip_id,created_at,experience_context_json"\)/);
assert.match(worker, /latestFeedbackByTrip/);
assert.match(worker, /FEEDBACK_SCAN_LIMIT_REACHED/);
assert.doesNotMatch(worker, /user_id/);
assert.match(worker, /isPublishableSuccessfulTripPattern/);
assert.match(worker, /successful_trip_experience_patterns/);
const patternUpsertSource = worker.slice(
  worker.indexOf("patterns.map((pattern) => ({"),
  worker.indexOf("{ onConflict: \"pattern_key\" }")
);
assert.doesNotMatch(patternUpsertSource, /trip_id|user_id/);
console.log("successful trip pattern aggregation checks passed");
