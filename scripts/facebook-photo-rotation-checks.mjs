import assert from "node:assert/strict";
import { selectCampaignPhotoAsset } from "../lib/roamly/facebookCampaignMedia.ts";

function asset(id, useCount = 0, lastUsedAt = null, enabled = true) {
  return {
    id,
    media_url: `https://example.test/${id}.png`,
    asset_type: "image",
    destination: "",
    topic: "",
    approved_for_automation: enabled,
    use_count: useCount,
    last_used_at: lastUsedAt,
    created_at: "2026-09-11T00:00:00.000Z"
  };
}

let pool = [asset("A"), asset("B"), asset("C")];
const selected = [];
for (let index = 0; index < 3; index += 1) {
  const choice = selectCampaignPhotoAsset(pool, "unknown destination", "unknown topic");
  assert.ok(choice);
  selected.push(choice.id);
  choice.use_count += 1;
  choice.last_used_at = `2026-09-11T00:0${index + 1}:00.000Z`;
}
assert.deepEqual(selected, ["A", "B", "C"]);

const afterCycle = selectCampaignPhotoAsset(pool, "unknown destination", "unknown topic");
assert.equal(afterCycle.id, "A");

pool.push(asset("D"));
assert.equal(selectCampaignPhotoAsset(pool, "unknown destination", "unknown topic").id, "D");

let failedB = pool.find((item) => item.id === "B");
assert.ok(failedB);
const beforeFailure = { use_count: failedB.use_count, last_used_at: failedB.last_used_at };
assert.equal(selectCampaignPhotoAsset(pool, "unknown destination", "unknown topic").id, "D");
assert.deepEqual({ use_count: failedB.use_count, last_used_at: failedB.last_used_at }, beforeFailure);

pool = pool.filter((item) => item.id !== "C");
assert.notEqual(selectCampaignPhotoAsset(pool, "unknown destination", "unknown topic")?.id, "C");
pool.push(failedB = asset("C", 1, "2026-09-11T00:03:00.000Z"));
assert.ok(selectCampaignPhotoAsset(pool, "unknown destination", "unknown topic"));

const bound = [asset("bound")];
bound[0].destination = "Paris, France";
assert.equal(selectCampaignPhotoAsset(bound, "Paris, France", "Luxury Travel")?.id, "bound");
assert.equal(selectCampaignPhotoAsset(bound, "No Match", "No Match")?.id, "bound");

console.log("Facebook photo rotation checks passed.");
