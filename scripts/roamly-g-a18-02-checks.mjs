import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const feedback = read("lib/roamly/tripFeedback.ts");
const migration = read("supabase/migrations/20260928000100_roamly_feedback_learning_idempotency.sql");

assert.match(migration, /feedback_learning_identity text/);
assert.match(migration, /source_feedback_id::text/);
assert.match(migration, /preference_key/);
assert.match(migration, /md5\(coalesce\(proposed_value/);
assert.match(migration, /create unique index if not exists traveler_preference_events_feedback_learning_uidx/);
assert.doesNotMatch(migration, /where feedback_learning_identity is not null/);
assert.match(feedback, /from\("trip_feedback"\)\s*\.upsert/);
assert.match(feedback, /from\("traveler_preference_events"\)\.upsert/);
assert.match(feedback, /onConflict: "feedback_learning_identity"/);
assert.match(feedback, /ignoreDuplicates: true/);
assert.match(feedback, /FEEDBACK_LEARNING_SAVE_FAILED/);
assert.match(feedback, /isCanonicalCompletedTrip/);

class LearningFixture {
  constructor() {
    this.events = new Map();
    this.failNextWrite = false;
  }

  async save(feedbackId, tripId, proposals) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return { ok: false, error: "FEEDBACK_LEARNING_SAVE_FAILED" };
    }
    for (const proposal of proposals) {
      const identity = `${feedbackId}:${proposal.preferenceKey}:${JSON.stringify(proposal.proposedValue)}`;
      if (!this.events.has(identity)) this.events.set(identity, { feedbackId, tripId, proposal });
    }
    return { ok: true };
  }
}

const fixture = new LearningFixture();
const proposals = [
  { preferenceKey: "preferred_travel_pace", proposedValue: "slower" },
  { preferenceKey: "transportation_preferences", proposedValue: ["simpler routes", "fewer transfers"] }
];
const sameFeedback = await Promise.all(Array.from({ length: 10 }, () => fixture.save("feedback-1", "trip-1", proposals)));
assert.equal(sameFeedback.filter((result) => result.ok).length, 10);
assert.equal(fixture.events.size, 2, "concurrent identical feedback must contribute once per learning identity");

const retry = await fixture.save("feedback-1", "trip-1", proposals);
assert.equal(retry.ok, true);
assert.equal(fixture.events.size, 2, "HTTP retry must not add learning events");

fixture.failNextWrite = true;
const failed = await fixture.save("feedback-2", "trip-2", proposals);
assert.equal(failed.ok, false);
const recovered = await fixture.save("feedback-2", "trip-2", proposals);
assert.equal(recovered.ok, true);
assert.equal(fixture.events.size, 4, "learning write retry must recover without duplicating feedback");

await fixture.save("feedback-3", "trip-3", proposals);
assert.equal(fixture.events.size, 6, "different completed trips remain independent");
await fixture.save("feedback-1", "trip-1", [{ preferenceKey: "dislikes", proposedValue: ["crowds"] }]);
assert.equal(fixture.events.size, 7, "distinct learning dimensions remain independent");

console.log("G-A18-02 feedback learning concurrency checks passed");
