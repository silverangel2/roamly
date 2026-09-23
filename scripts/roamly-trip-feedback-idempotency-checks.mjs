import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const feedback = read("lib/roamly/tripFeedback.ts");
const page = read("app/trip/[id]/feedback/page.tsx");
const form = read("components/trip/TripFeedbackForm.tsx");
const migration = read("supabase/migrations/20260929000100_roamly_trip_feedback_save_idempotency.sql");
const precheck = read("supabase/checks/20260929000100_roamly_trip_feedback_save_idempotency_precheck.sql");
const postcheck = read("supabase/checks/20260929000100_roamly_trip_feedback_save_idempotency_postcheck.sql");

assert.match(feedback, /\.upsert\(feedbackPayload[\s\S]*?onConflict: "trip_id,user_id,feedback_slot"/);
assert.match(feedback, /\.eq\("feedback_slot", feedbackType === "post_trip" \? 0 : cleanDay\(params\.input\.tripDay\) \?\? -1\)/);
assert.match(feedback, /if \(proposals\.length && !existing\.data\)/, "repeat saves must not create duplicate preference events");
assert.match(migration, /generated always as/i);
assert.match(migration, /feedback_type = 'post_trip' then 0/i);
assert.match(migration, /coalesce\(trip_day, -1\)/i);
assert.match(migration, /create unique index if not exists trip_feedback_user_slot_unique/i);
assert.match(precheck, /no existing duplicate feedback slots/);
assert.match(precheck, /having count\(\*\) > 1/);
assert.match(postcheck, /unique feedback slot index is valid/);
assert.match(postcheck, /RLS remains enabled/);
assert.match(page, /getTripFeedback/);
assert.match(page, /initialFeedback=\{existingFeedback\.error \? \[\] : existingFeedback\.feedback\}/);
assert.match(form, /restoreFeedback\("post_trip"\)/);
assert.match(form, /restoreFeedback\(nextMode\)/);
assert.match(form, /setFreeText\(saved\?\.free_text_feedback \|\| ""\)/);

console.log("Roamly trip feedback idempotency checks passed");
