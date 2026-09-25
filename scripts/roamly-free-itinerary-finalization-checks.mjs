import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deriveTripGenerationStatus } from "../lib/roamly/generationStatus.ts";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const billing = fs.readFileSync(path.join(root, "lib/roamly/billing.ts"), "utf8");
const finalization = fs.readFileSync(path.join(root, "lib/roamly/generationFinalization.ts"), "utf8");

assert.match(billing, /select\("free_itinerary_used_at,free_itinerary_trip_id"\)/);
assert.match(billing, /alreadyClaimedByThisTrip/);
assert.match(billing, /return \{ ok: true as const, alreadyClaimed: true as const \}/);

const claimIndex = finalization.indexOf('if (unlockSource === "free")');
const lockIndex = finalization.indexOf("lockGeneratedItinerary", claimIndex);
const directFinalizeIndex = finalization.indexOf("finalizeTripDirectly", claimIndex);
assert.ok(claimIndex >= 0, "free finalization must have an entitlement gate");
assert.ok(lockIndex > claimIndex, "free entitlement must be checked before itinerary locking");
assert.ok(directFinalizeIndex > claimIndex, "free entitlement must be checked before final trip finalization");
assert.doesNotMatch(finalization.slice(claimIndex, lockIndex), /markFreeItineraryUsed\([\s\S]*?\.catch\(\(\) => null\)/);
assert.match(finalization, /FREE_ENTITLEMENT_CLAIM_RETRYABLE/);
assert.match(finalization, /FREE_ITINERARY_ALREADY_USED/);

const common = {
  tripStatus: "generating",
  itineraryStatus: "generating",
  metadataProgress: {
    status: "complete",
    lastErrorCode: null,
    completedDayCount: 3,
    totalDayCount: 3
  },
  latestJob: { status: "completed" },
  layers: [],
  queueProgress: null
};

const ordinaryStoredCompletion = deriveTripGenerationStatus({
  ...common,
  hasFullItinerary: true
});
assert.equal(ordinaryStoredCompletion.isComplete, true);

const retryableClaim = deriveTripGenerationStatus({
  ...common,
  hasFullItinerary: true,
  metadataProgress: {
    ...common.metadataProgress,
    lastErrorCode: "FREE_ENTITLEMENT_CLAIM_RETRYABLE"
  }
});
assert.equal(retryableClaim.isComplete, false);
assert.equal(retryableClaim.isFailed, true);

const claimedElsewhere = deriveTripGenerationStatus({
  ...common,
  hasFullItinerary: true,
  metadataProgress: {
    ...common.metadataProgress,
    lastErrorCode: "FREE_ITINERARY_ALREADY_USED"
  }
});
assert.equal(claimedElsewhere.isComplete, false);
assert.equal(claimedElsewhere.isFailed, true);

console.log("Roamly free itinerary finalization checks passed");
