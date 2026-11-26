// Native date-picker calendar covers the Step 2 error text and the
// "Continue to Who" button when opened from the End date field
// (2026-11-25 QA, bug 7).
//
// The mechanism (components/plan/TripPlanForm.tsx, step === 1 — the
// user-facing Step 2 "When"): the date error the user actually sees
// ("Add a start and end date." / "Add both dates.", strings in
// lib/roamly/planTripUx.ts) renders INSIDE the date card — under the
// Start date field (PlanField's BuiFieldError) and under the length
// hint (the days BuiFieldError). The native <input type="date">
// calendar is a browser popup: it opens downward from the End date
// field and overlays everything below it in the viewport, so it
// covers those in-card errors (live: truncated to "Add a start an…").
// The page cannot move the popup; it is positioned by the browser.
//
// The FIRST fix moved the wrong element: it moved the step-level
// StepError above the card, but TripPlanForm suppresses the StepError
// exactly when a date error is active ({dateErrorActive ? null :
// <StepError .../>}), so in the failing case nothing showed above
// the card at all. Live FAIL 2026-11-25 21:02-21:07 AST (PR #141):
// with dates empty the error still sat inside the card, covered by
// the picker.
//
// The CORRECTED fix: when dateErrorActive, render ONE consolidated
// date error — the first active field error (start, then end, then
// days) — as the StepError ABOVE the date card, where the
// downward-opening picker can never reach it. Otherwise the step
// error renders as before. The in-card field errors are left in
// place (they keep the field association and the red styling); the
// above-card error is the one the user reads while the picker is
// open. The Continue button needs no layout change: it is covered
// only while the picker is open, which is inherent to a native
// popup — the user dismisses or picks in the picker before
// continuing, and no page layout can keep content visible under a
// native overlay. The information loss (the error text) is the
// defect; the button occlusion is normal popup behaviour.
//
// Run BEFORE the corrected fix this script FAILS (the StepError is
// suppressed when dateErrorActive, so no date error sits above the
// card). AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const form = fs.readFileSync(path.join(root, "components/plan/TripPlanForm.tsx"), "utf8");

// Isolate the When step (step === 1) block: from its opening to the
// Who step (step === 2) opening.
const whenStart = form.indexOf("{step === 1 ? (");
assert.ok(whenStart > -1, "the When step block exists");
const whoStart = form.indexOf("{step === 2 ? (", whenStart);
assert.ok(whoStart > whenStart, "the Who step block follows the When step");
const when = form.slice(whenStart, whoStart);

// 1. The consolidated date error is defined as the first active
// field error (start, then end, then days).
assert.ok(
  /const dateErrorMessage = startDateField\.error \|\| endDateField\.error \|\| daysField\.error \|\| ""/.test(form),
  "dateErrorMessage is the first active date field error"
);

// 2. When a date error is active, the StepError above the card shows
// THAT message — it is not suppressed.
assert.ok(
  when.includes("<StepError error={translateText(dateErrorMessage)} />"),
  "the date error renders as the StepError above the card when active"
);
assert.ok(
  !when.includes("{dateErrorActive ? null : <StepError"),
  "the old suppression (StepError hidden exactly when a date error is active) is gone"
);

// 3. The above-card error sits before the date card in source order.
const dateErrorAt = when.indexOf("<StepError error={translateText(dateErrorMessage)} />");
const cardAt = when.indexOf('<BuiCard className="p-4">');
assert.ok(cardAt > -1, "the When step date card exists");
assert.ok(
  dateErrorAt > -1 && dateErrorAt < cardAt,
  "the date error renders ABOVE the date card, where the downward-opening picker cannot cover it"
);

// 4. The step error still renders as before when no date error is active.
assert.ok(
  when.includes("<StepError error={translateText(error)} />"),
  "the step error still renders when no date error is active"
);

// 5. The footer Continue button is untouched (it is covered only while
// the picker is open, which no layout can prevent).
assert.ok(form.includes('onClick={goNext}'), "the footer Continue button still drives goNext");

console.log("Date-picker error visibility checks: PASS");
