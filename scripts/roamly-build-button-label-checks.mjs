// While generating, the Build button collapses to a spinner-only pill
// and its label "Generate my free itinerary" appears as plain text
// below it (2026-11-25 QA, bug 10).
//
// The mechanism: the Review-step submit is BuiMorphButton
// (components/boardui/MorphButton.tsx). In its busy phase it fades the
// label span to opacity 0 and springs the width down to a compact
// 48 px shape holding only a spinner, while the form flips the button
// to flex-none so the spring can shrink it. The label the button was
// showing — "Starting generation…" — is invisible inside it. And the
// form renders entitlement.cta ("Generate my free itinerary") as a
// <p> below the footer whenever buildButtonLabel differs from it —
// which it does for a real trip ("Build my Paris trip · 4 days") —
// so the user sees a tiny spinner pill with the action text as plain
// text underneath.
//
// The fix must NOT change the shared primitive's designed behaviour:
// the pill → spinner → tick morph is an approved BoardUI pattern
// (Smooth-Details, Nov 4) used by ContactForm and TripShareActions
// too. So MorphButton gains an OPT-IN busyLabel prop: when provided,
// the busy phase keeps the button at home width and shows a spinner
// plus the busy label text (no fade-out, no shrink); callers without
// it keep the compact morph exactly as before. TripPlanForm passes
// the status text ("Starting generation…" / "Opening checkout…" /
// "Checking costs…") as busyLabel and the CTA label as children.
//
// Run BEFORE the fix this script FAILS (no busyLabel). AFTER the fix
// it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const morph = fs.readFileSync(path.join(root, "components/boardui/MorphButton.tsx"), "utf8");

// The primitive accepts an opt-in busy label.
assert.ok(morph.includes("busyLabel"), "MorphButton accepts a busyLabel prop");
assert.ok(
  /busyLabel\?: ReactNode/.test(morph),
  "busyLabel is an optional ReactNode prop"
);
// With a busy label the button keeps its home width and shows the
// label (spinner + text) instead of fading out and shrinking.
assert.ok(
  /showBusyLabel/.test(morph) || /phase === "busy" && busyLabel/.test(morph),
  "the busy phase distinguishes the labelled case"
);
assert.ok(
  /opacity: phase === "idle" \|\| showBusyLabel \? 1 : 0/.test(morph) ||
    /opacity: \(phase === "idle" \|\| showBusyLabel\) \? 1 : 0/.test(morph),
  "the label span stays visible when a busy label is shown"
);
// Without one, the compact morph is untouched.
assert.ok(
  /compactRef\.current/.test(morph),
  "the compact target still exists for callers without a busy label"
);

// TripPlanForm passes the status text as busyLabel and keeps the CTA
// as the button's children.
const form = fs.readFileSync(path.join(root, "components/plan/TripPlanForm.tsx"), "utf8");
const morphUse = form.slice(form.indexOf("<BuiMorphButton"), form.indexOf("</BuiMorphButton>"));
assert.ok(morphUse.includes("busyLabel"), "the Review-step button passes busyLabel");
assert.ok(morphUse.includes("Starting generation"), "busyLabel carries the generation status text");
assert.ok(morphUse.includes("Checking costs"), "busyLabel carries the cost-check status text");
assert.ok(morphUse.includes("translateText(buildButtonLabel)"), "the button children stay the CTA label");

// The other MorphButton callers keep the compact morph (no busyLabel).
for (const file of ["components/contact/ContactForm.tsx", "components/trip/TripShareActions.tsx"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.ok(!source.includes("busyLabel"), `${file} does not opt into busyLabel`);
}

console.log("Build button busy label checks: PASS");
