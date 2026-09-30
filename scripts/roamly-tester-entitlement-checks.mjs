import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const access = read("lib/roamly/access.ts");
const billing = read("lib/roamly/billing.ts");
const staged = read("lib/roamly/stagedItineraryGeneration.ts");
const companion = read("lib/roamly/tripCompanion.ts");
const companionPage = read("app/trip/[id]/companion/page.tsx");
const livePage = read("app/trip/[id]/live/page.tsx");
const tripPage = read("app/trip/[id]/page.tsx");
const actions = read("lib/roamly/activityActions.ts");

assert.doesNotMatch(
  access,
  /export function canUseLiveCompanion[\s\S]{0,220}isRoamlyTester\(userEmail\)/,
  "QA membership must not directly grant Live Companion"
);
assert.match(
  access,
  /export function canUseLiveCompanion[\s\S]*entitlements\.trackingUnlocked/,
  "stored companion entitlements remain supported"
);

assert.match(
  billing,
  /source === "paid" \? "paid" : "unpaid"/,
  "admin/test itinerary unlocks must remain unpaid"
);
assert.match(billing, /qa_checkout_kind: "itinerary"/, "itinerary QA selection remains explicit");
assert.match(billing, /qa_checkout_kind: "tracking"/, "companion QA selection remains explicit");
assert.match(billing, /qa_checkout_kind: "complete"/, "bundle QA selection remains explicit");
assert.doesNotMatch(
  billing,
  /itinerary_unlock_source: "admin",\n\s*tracking_unlocked: true,\n\s*tracking_unlock_source: "admin",\n\s*tracking_paid_at:/,
  "QA bundle must not write a paid timestamp"
);

assert.doesNotMatch(
  staged,
  /completed\.qaTester\)\s*await unlockLiveCompanion/,
  "generation alone must not unlock Live Companion for QA"
);
assert.match(
  companion,
  /if \(source !== "admin"\) unlockUpdate\.tracking_paid_at/,
  "admin QA companion unlock must not write tracking_paid_at"
);
assert.doesNotMatch(companionPage, /access\.hasQaAccess/);
assert.doesNotMatch(livePage, /!companionUnlocked && !access\.hasQaAccess/);
assert.doesNotMatch(livePage, /access\.hasQaAccess && locked && !companionUnlocked/);
assert.doesNotMatch(tripPage, /tripHasTrackingUnlock\(trip\) \|\| \(access\.hasQaAccess/);
assert.doesNotMatch(actions, /!tripHasTrackingUnlock\(trip\) && !access\.hasQaAccess/);

assert.match(billing, /return createCheckoutSession\(supabase, user, tripId, "itinerary_unlock"\)/);
assert.match(billing, /return createCheckoutSession\(supabase, user, tripId, "tracking_addon"\)/);
assert.match(billing, /return createCheckoutSession\(supabase, user, tripId, "bundle"\)/);
assert.match(billing, /event\.type === "checkout\.session\.completed"/);

console.log("Tester entitlement checks passed.");
