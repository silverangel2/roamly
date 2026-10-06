import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  campaignAssetIdentityKeys,
  selectAutopostPhotoForPost,
  selectCampaignPhotoAssetDecision,
  sourcePhotoCandidateFromDraft
} from "../lib/roamly/facebookCampaignMedia.ts";

const captions = readFileSync("lib/roamly/socialCaptions.ts", "utf8");
const automation = readFileSync("lib/roamly/socialAutomation.ts", "utf8");
const cron = readFileSync("app/api/cron/roamly-social-autopost/route.ts", "utf8");
assert.match(captions, /export async function generateFacebookQueue/);
assert.match(captions, /recentSelectedMediaKeys/);
assert.match(captions, /batchReservedKeys/);
assert.match(captions, /selectPublishSourcePhoto/);
assert.match(automation, /video_reels/);
assert.match(automation, /selectPublishSourcePhoto/);
assert.doesNotMatch(automation, /\$\{config\.pageId\}\/photos/);
assert.doesNotMatch(automation, /\$\{config\.pageId\}\/feed/);
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

const lisbon = asset("lisbon", { destination: "Lisbon, Portugal", attribution: "Roamly marketing source" });
const kyoto = asset("kyoto", { destination: "Kyoto, Japan", attribution: "Roamly marketing source" });
const rome = asset("rome", { destination: "Rome, Italy" });
const oaxaca = asset("oaxaca", { destination: "Oaxaca, Mexico" });
const cityPool = [lisbon, kyoto, rome, oaxaca];
const lisbonPreferred = selectCampaignPhotoAssetDecision(cityPool, "Lisbon", "weekend escapes");
assert.equal(lisbonPreferred.asset?.id, "lisbon", "Lisbon matches the Lisbon, Portugal library photo");
assert.equal(lisbonPreferred.asset?.metadata?.attribution, "Roamly marketing source", "selection keeps the library photo credit");

const afterLisbon = selectCampaignPhotoAssetDecision(cityPool, "Lisbon", "weekend escapes", {
  excludedKeys: new Set(campaignAssetIdentityKeys(lisbon)),
  previousKeys: new Set(campaignAssetIdentityKeys(lisbon))
});
assert.notEqual(afterLisbon.asset?.id, "lisbon", "a used destination photo yields to the rest of the pool");
assert.equal(afterLisbon.asset?.metadata?.attribution, "Roamly marketing source");

const dailyPool = [asset("A"), asset("B"), asset("C")];
const dailyIds = [];
let excluded = new Set();
let previous = new Set();
for (let day = 0; day < 7; day += 1) {
  const decision = selectCampaignPhotoAssetDecision(dailyPool, "Lisbon", "weekend escapes", {
    excludedKeys: excluded,
    previousKeys: previous,
    rotationIndex: 0
  });
  assert.ok(decision.asset);
  dailyIds.push(decision.asset.id);
  previous = campaignAssetIdentityKeys(decision.asset);
  excluded = new Set([...excluded, ...previous]);
}
assert.deepEqual(dailyIds.slice(0, 3), ["A", "B", "C"], "consecutive runs cycle the pool");
for (let index = 1; index < dailyIds.length; index += 1) {
  assert.notEqual(dailyIds[index], dailyIds[index - 1], "no immediate repeat across a week of rotationIndex 0");
}
assert.equal(new Set(dailyIds).size, 3, "wraps inside the pool instead of inventing photos");

const queuedLisbon = new Set(campaignAssetIdentityKeys(lisbon));
const published = [];
let recent = new Set(queuedLisbon);
let lastKeys = new Set(queuedLisbon);
for (let day = 0; day < 7; day += 1) {
  const decision = selectAutopostPhotoForPost(cityPool, "Lisbon", "weekend escapes", {
    bound: lisbon,
    excludedKeys: recent,
    previousKeys: lastKeys
  });
  assert.ok(decision.asset);
  assert.notEqual(decision.asset.id, published[published.length - 1], "publish rotation does not repeat the previous photo");
  published.push(decision.asset.id);
  lastKeys = campaignAssetIdentityKeys(decision.asset);
  recent = new Set([...recent, ...lastKeys]);
}
assert.equal(new Set(published).size, 4, "seven posts spread across the four-photo pool");
assert.ok(published.includes("kyoto") && published.includes("rome") && published.includes("oaxaca"));

const uniqueBound = selectAutopostPhotoForPost(cityPool, "Kyoto", "food", {
  bound: kyoto,
  excludedKeys: new Set()
});
assert.equal(uniqueBound.asset?.id, "kyoto", "a photo that is not a recent repeat stays on its draft");

const onlyPhoto = asset("only-photo", { attribution: "Only credit" });
const onlyRepeat = selectAutopostPhotoForPost([onlyPhoto], "Lisbon", "weekend escapes", {
  bound: onlyPhoto,
  excludedKeys: new Set(campaignAssetIdentityKeys(onlyPhoto)),
  previousKeys: new Set(campaignAssetIdentityKeys(onlyPhoto))
});
assert.equal(onlyRepeat.asset?.id, "only-photo");
assert.equal(onlyRepeat.exhausted, true, "single-photo pool falls back to that photo");
assert.equal(onlyRepeat.asset?.metadata?.attribution, "Only credit");

const publishedDraft = sourcePhotoCandidateFromDraft({
  selected_media_asset_id: "generated-video",
  selected_media_url: "https://cdn.example/reel.mp4?token=secret",
  metadata: {
    sourceMediaAssetId: "lisbon",
    sourceMediaUrl: "https://cdn.example/lisbon.png?signature=rotates",
    publicObjectPath: "social/videos/roamly/shared-reel.mp4",
    generatedReelVideo: { objectPath: "social/videos/roamly/shared-reel.mp4", publicUrl: "https://cdn.example/reel.mp4" }
  }
});
const publishedKeys = [...campaignAssetIdentityKeys(publishedDraft)];
assert.ok(publishedKeys.includes("id:lisbon"));
assert.ok(publishedKeys.some((key) => key.startsWith("url:") && key.endsWith("/lisbon.png")));
assert.ok(!publishedKeys.some((key) => key.includes("shared-reel") || key.includes("generated-video") || key.includes("token")));

console.log("Facebook photo rotation checks passed.");
