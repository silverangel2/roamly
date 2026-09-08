import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  activationStateIsCorrect,
  generationStuckReason,
  generationTripIsComplete,
  purchaseActivationIsEligible
} from "../lib/roamly/silentFailureDetectorLogic.ts";

const now = Date.parse("2026-09-08T12:00:00.000Z");
const paid = { status: "paid", billing_state: "active", purchase_type: "itinerary_unlock", paid_at: "2026-09-08T11:00:00.000Z" };
const unlocked = { status: "active", itinerary_payment_status: "paid", itinerary_unlock_source: "paid" };
assert.equal(purchaseActivationIsEligible(paid, unlocked, now, 15 * 60 * 1000), true);
assert.equal(activationStateIsCorrect(paid, unlocked), true);
assert.equal(activationStateIsCorrect(paid, { ...unlocked, itinerary_payment_status: "unpaid" }), false);
assert.equal(purchaseActivationIsEligible({ ...paid, billing_state: "refunded" }, unlocked, now, 0), false);
assert.equal(purchaseActivationIsEligible({ ...paid, paid_at: "2026-09-08T11:55:00.000Z" }, unlocked, now, 15 * 60 * 1000), false);
assert.equal(purchaseActivationIsEligible(paid, { status: "completed" }, now, 0), false);

const leaseExpired = { status: "running", lease_expires_at: "2026-09-08T11:50:00.000Z" };
assert.equal(generationStuckReason(leaseExpired, now), "expired_lease");
assert.equal(generationStuckReason({ ...leaseExpired, lease_expires_at: "2026-09-08T11:59:59.000Z" }, now), null);
assert.equal(generationStuckReason({ status: "failed", retry_count: 3 }, now), "retry_exhausted");
assert.equal(generationStuckReason({ status: "queued", next_attempt_at: "2026-09-08T11:50:00.000Z" }, now), "overdue_retry");
assert.equal(generationStuckReason({ status: "completed", completed_at: "2026-09-08T11:59:00.000Z" }, now), null);
assert.equal(generationTripIsComplete({ itinerary_status: "generated" }), true);
assert.equal(generationTripIsComplete({ itinerary_status: "generating" }), false);

const detectorSource = fs.readFileSync(path.resolve("lib/roamly/silentFailureDetectors.ts"), "utf8");
const notificationRoute = fs.readFileSync(path.resolve("app/api/cron/roamly-notifications/route.ts"), "utf8");
const generationRoute = fs.readFileSync(path.resolve("app/api/cron/roamly-itinerary-generation/route.ts"), "utf8");
assert.match(detectorSource, /recordOperationalEvent/);
assert.match(detectorSource, /recordOperationalRecovery/);
assert.match(notificationRoute, /runPaidActivationMissingDetector/);
assert.match(generationRoute, /runStuckGenerationDetector/);

console.log("Roamly silent failure detector checks passed (paid activation grace/state, generation lease/retry classification, completion guards, and server entrypoints). ");
