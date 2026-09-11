import assert from "node:assert/strict";
import { assetRecord, deduplicateApprovedAssets, isApprovedRightsDeclaration, isPrivateOrCustomerPath } from "./ingest-roamly-marketing-images.mjs";

const approved = {
  source: "santorini-dream-01.png",
  rightsStatus: "approved",
  rightsBasis: "Explicit Roamly-owned campaign artwork declaration.",
  marketingUseAllowed: true,
  publicSocialUseAllowed: true
};

assert.equal(isApprovedRightsDeclaration(approved), true);
assert.equal(isApprovedRightsDeclaration({ ...approved, rightsStatus: "unverified" }), false);
assert.equal(isApprovedRightsDeclaration({ ...approved, publicSocialUseAllowed: false }), false);
assert.equal(isApprovedRightsDeclaration({ ...approved, source: "private/trip/photo.png" }), false);
assert.equal(isPrivateOrCustomerPath("customer/uploads/photo.png"), true);
assert.equal(isPrivateOrCustomerPath("santorini-dream-01.png"), false);

const first = { source: "a.png", contentHash: "same", buffer: Buffer.from("a") };
const second = { source: "b.png", contentHash: "same", buffer: Buffer.from("a") };
const third = { source: "c.png", contentHash: "different", buffer: Buffer.from("c") };
const deduped = deduplicateApprovedAssets([first, second, third]);
assert.equal(deduped.unique.length, 2);
assert.equal(deduped.duplicates.length, 1);
assert.equal(deduped.unique[0].source, "a.png");

const record = assetRecord({
  source: "santorini-dream-01.png",
  contentHash: "hash-1",
  objectPath: "social/images/roamly/campaign/hash-1.png",
  publicUrl: "https://example.supabase.co/storage/v1/object/public/roamly-social-public/social/images/roamly/campaign/hash-1.png",
  declaration: approved,
  campaign: { destination: "Santorini, Greece", topic: "Dream Destinations" }
});
assert.equal(record.asset_type, "image");
assert.equal(record.platform, "facebook_roamly");
assert.equal(record.approved_for_automation, true);
assert.equal(record.metadata.rightsStatus, "approved");
assert.equal(record.metadata.marketingUseAllowed, true);
assert.equal(record.metadata.publicSocialUseAllowed, true);

const existingVideo = { asset_type: "video", platform: "facebook_roamly", approved_for_automation: true };
assert.equal(existingVideo.asset_type, "video");
console.log("Roamly marketing photo ingestion checks passed.");
