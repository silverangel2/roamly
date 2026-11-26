// Native date-picker calendar covers the Step 2 error text and the
// "Continue to Who" button when opened from the End date field
// (2026-11-25 QA, bug 7).
//
// The mechanism (components/plan/TripPlanForm.tsx, step === 1 — the
// user-facing Step 2 "When"): the step-level error renders BELOW the
// date card ({dateErrorActive ? null : <StepError .../>} after the
// <BuiCard>), and the footer Continue button sits below all step
// content. The native <input type="date"> calendar is a browser
// popup: it opens downward from the End date field and overlays
// everything below it in the viewport — the step error and the
// Continue button. The page cannot move the popup; it is positioned
// by the browser.
//
// The fix: render the When-step's step error ABOVE the date card, so
// it sits between the step heading and the fields — the popup opens
// downward from the fields, so content above them can never be
// covered by it. The dateErrorActive suppression is kept (when a
// field-level date error is active the step error stays hidden to
// avoid duplication); the per-field errors in their reserved slots
// are untouched. The Continue button needs no layout change: it is
// covered only while the picker is open, which is inherent to a
// native popup — the user dismisses or picks in the picker before
// continuing, and no page layout can keep content visible under a
// native overlay. The information loss (the error text) is the
// defect; the button occlusion is normal popup behaviour.
//
// Residual, stated honestly: an End-date-only field error still sits
// under the End date input and is covered while the picker is open.
// The step error (when present) is now always visible, and the Start
// date field error was never covered (it sits above the End date
// input).
//
// Run BEFORE the fix this script FAILS (the step error is below the
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

const stepErrorAt = when.indexOf("{dateErrorActive ? null : <StepError error={translateText(error)} />}");
assert.ok(stepErrorAt > -1, "the When step still renders its step error with the dateErrorActive suppression");
const cardAt = when.indexOf('<BuiCard className="p-4">');
assert.ok(cardAt > -1, "the When step date card exists");
assert.ok(
  stepErrorAt < cardAt,
  "the When-step error renders ABOVE the date card, where the downward-opening picker cannot cover it"
);
assert.ok(
  when.indexOf("{dateErrorActive ? null : <StepError error={translateText(error)} />}", stepErrorAt + 1) === -1,
  "no second copy of the step error remains below the card"
);

// The footer Continue button is untouched (it is covered only while
// the picker is open, which no layout can prevent).
assert.ok(form.includes('onClick={goNext}'), "the footer Continue button still drives goNext");

console.log("Date-picker error visibility checks: PASS");
