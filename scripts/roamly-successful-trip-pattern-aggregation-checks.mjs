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
assert.match(worker, /select\("experience_context_json"\)/);
assert.doesNotMatch(worker, /user_id|trip_id/);
assert.match(worker, /isPublishableSuccessfulTripPattern/);
assert.match(worker, /successful_trip_experience_patterns/);
console.log("successful trip pattern aggregation checks passed");
