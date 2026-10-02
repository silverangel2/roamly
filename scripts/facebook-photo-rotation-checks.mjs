import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { campaignAssetIdentityKeys, selectCampaignPhotoAssetDecision } from "../lib/roamly/facebookCampaignMedia.ts";

const captions = readFileSync("lib/roamly/socialCaptions.ts", "utf8");
const cron = readFileSync("app/api/cron/roamly-social-autopost/route.ts", "utf8");
assert.match(captions, /export async function generateFacebookQueue/);
assert.match(captions, /recentSelectedMediaKeys/);
assert.match(captions, /reservedMediaKeys/);
assert.match(cron, /generateFacebookQueue/);
assert.match(cron, /from "@\/lib\/roamly\/socialAutomation"/);

function asset(id, metadata = {}, overrides = {}) {
  return {
    id,
    media_url: `https://example.test/${id}.png?signature=${id}-rotates`,
    asset_type: "image",
    destination: "",
    topic: "",
    use_count: 0,
    last_used_at: null,
    created_at: "2026-09-11T00:00:00.000Z",
    metadata,
    ...overrides
  };
}

const pool = [asset("A"), asset("B"), asset("C")];
const reserved = new Set();
const selected = [];
for (let index = 0; index < 3; index += 1) {
  const decision = selectCampaignPhotoAssetDecision(pool, "unknown destination", "unknown topic", { excludedKeys: reserved });
  assert.ok(decision.asset);
  assert.equal(decision.exhausted, false);
  selected.push(decision.asset.id);
  for (const key of campaignAssetIdentityKeys(decision.asset)) reserved.add(key);
}
assert.deepEqual(selected, ["A", "B", "C"], "same-batch selections rotate source images");

const signedA = asset("signed-a", { contentSha256: "same-physical-image", objectPath: "social/images/a.png" }, { media_url: "https://example.test/storage/a.png?token=one" });
const signedDuplicate = asset("signed-b", { contentSha256: "same-physical-image", objectPath: "social/images/a.png" }, { media_url: "https://example.test/storage/a.png?token=two" });
const alternate = asset("alternate", { contentSha256: "different-image", objectPath: "social/images/b.png" });
const signedDecision = selectCampaignPhotoAssetDecision(
  [signedA, signedDuplicate, alternate],
  "unknown",
  "unknown",
  { excludedKeys: new Set(campaignAssetIdentityKeys(signedA)) }
);
assert.equal(signedDecision.asset?.id, "alternate", "signed URLs cannot defeat physical-image dedupe");

const boundA = asset("bound-a", {}, { destination: "Paris, France" });
const boundB = asset("bound-b", {}, { destination: "Paris, France" });
const unrelated = asset("unrelated", {}, { destination: "Tokyo, Japan" });
const boundDecision = selectCampaignPhotoAssetDecision(
  [boundA, boundB, unrelated],
  "Paris, France",
  "Luxury Travel",
  { excludedKeys: new Set(campaignAssetIdentityKeys(boundA)) }
);
assert.equal(boundDecision.asset?.id, "bound-b", "rotation preserves destination relevance");

const only = asset("only");
const exhausted = selectCampaignPhotoAssetDecision([only], "unknown", "unknown", {
  excludedKeys: new Set(campaignAssetIdentityKeys(only))
});
assert.equal(exhausted.asset?.id, "only");
assert.equal(exhausted.exhausted, true, "pool exhaustion is explicit and bounded");

const fallbackPool = [asset("default"), asset("alternative")];
const first = selectCampaignPhotoAssetDecision(fallbackPool, "unknown", "unknown");
const second = selectCampaignPhotoAssetDecision(fallbackPool, "unknown", "unknown", {
  excludedKeys: new Set(campaignAssetIdentityKeys(first.asset))
});
assert.equal(first.asset?.id, "default");
assert.equal(second.asset?.id, "alternative", "fallback does not permanently repeat one default");

console.log("Facebook photo rotation checks passed.");
