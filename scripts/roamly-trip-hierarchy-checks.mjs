import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const page = fs.readFileSync(path.join(root, "app/trip/[id]/page.tsx"), "utf8");
const readiness = fs.readFileSync(path.join(root, "lib/roamly/tripReadiness.ts"), "utf8");
const outcome = fs.readFileSync(path.join(root, "lib/roamly/bookingOutcome.ts"), "utf8");

assert.match(page, /const readiness = deriveTripReadiness\(/, "Trip Home must consume the canonical readiness model");
assert.match(page, /href=\{readiness\.primaryAction\.href\}/, "the top command area must expose the canonical primary action");
// Behaviour, not shape (Stage 4 re-pin, 2026-11-10): the assignment grew
// a completed-trip guard and extra fallbacks after the readiness action,
// but the PRIORITY is the invariant — attention text first, then the
// readiness model's next action. Assert that order inside the
// commandNextTitle assignment, tolerating the guard and later fallbacks.
assert.match(page, /commandNextTitle = [\s\S]{0,120}?attentionText \|\| readiness\.upcomingActions\[0\]/, "the command summary must align with readiness priority (attention first, then the readiness next action)");
assert.match(page, /{!canShowFull \? \(/, "generation/lifecycle action is limited to trips without a full itinerary");
assert.match(page, /Trip at a glance/, "the default overview must be a compact snapshot rather than a second action panel");
assert.doesNotMatch(page, /Check bookings →/, "the overview must not compete with the single top-level action");
// Behaviour, not shape (Stage 4 re-pin, 2026-11-10): the BoardUI
// re-clothe wrapped this JSX across lines; the invariant is that when
// confirmed bookings exist, the overview shows the compact #bookings
// anchor rather than a second action panel.
assert.match(page, /confirmedBookingSnapshot\.length \? \([\s\S]{0,400}?<a href="#bookings"/, "confirmed booking truth remains visible as compact context");
assert.match(readiness, /primaryAction: TripReadinessAction/, "primary action remains typed in the shared model");
for (const state of ["REFERRED", "AWAITING_CONFIRMATION", "CONFIRMED", "NEEDS_REVIEW"]) {
  assert.match(outcome, new RegExp(`"${state}"`), `${state} remains available to dedicated booking surfaces`);
}
assert.doesNotMatch(page, /deriveTripReadiness\([^)]*booking_status/, "Trip Home does not derive a second booking truth model");

console.log("Roamly Trip Home hierarchy checks passed (single readiness action, compact snapshot, preserved confirmation context, and shared truth).");
