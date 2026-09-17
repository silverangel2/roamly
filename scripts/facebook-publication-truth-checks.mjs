import assert from "node:assert/strict";

const truth = await import("../lib/roamly/facebookPublicationTruth.ts");
const storage = await import("../lib/roamly/publicSocialStorage.ts");
const { classifyFacebookProcessing, classifyFacebookPublication } = truth;
const { probeFacebookPublicVisibility } = storage;

const visible = { verified: true, reason: "anonymous public object page" };
const notVisible = { verified: false, reason: "Facebook login interstitial" };
const finish = { success: true };
const reel = { id: "final-1", is_reel: true, media_type: "REEL", permalink_url: "https://www.facebook.com/reel/final-1", status: "published" };

assert.equal(classifyFacebookProcessing({ status: "ready" }).state, "terminal_success");
assert.equal(classifyFacebookProcessing({ status: "processing" }).state, "processing");
assert.equal(classifyFacebookProcessing({ status: "failed" }).state, "terminal_failure");
assert.equal(classifyFacebookProcessing({}).state, "unknown");
assert.equal(classifyFacebookPublication({ finish, confirmation: reel, visibility: visible }).truth, "published_verified");
assert.equal(classifyFacebookPublication({ finish, confirmation: reel, visibility: notVisible }).truth, "published_unverified");
assert.equal(classifyFacebookPublication({ finish, confirmation: {}, confirmationError: "lookup failed", visibility: notVisible }).truth, "published_unverified");
assert.equal(classifyFacebookPublication({ finish: {}, confirmation: reel, visibility: visible }).truth, "failed");
assert.equal(classifyFacebookPublication({ finish, confirmation: { ...reel, status: "failed" }, visibility: visible }).truth, "failed");
assert.equal(classifyFacebookPublication({ finish, confirmation: { id: "final-1", permalink_url: "https://www.facebook.com/videos/final-1" }, visibility: visible }).truth, "published_unverified");
assert.equal(classifyFacebookPublication({ finish, confirmation: { id: "final-1", is_reel: true }, confirmationError: "lookup failed", visibility: visible }).truth, "published_unverified");

const publicResponse = await probeFacebookPublicVisibility({
  url: reel.permalink_url,
  fetcher: async (_url, init) => {
    assert.equal(init?.headers, undefined);
    return new Response("<html><body>Public Facebook Reel final-1</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  }
});
assert.equal(publicResponse.verified, true);

const loginResponse = await probeFacebookPublicVisibility({
  url: reel.permalink_url,
  fetcher: async () => new Response("Log in to Facebook", { status: 200, headers: { "content-type": "text/html" } })
});
assert.equal(loginResponse.verified, false);
console.log("PASS: Facebook publication truth fixture checks");
