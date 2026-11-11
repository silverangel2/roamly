import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defineMoneyFinding, runMoneyChecks } from "./specialist-money-check-utils.mjs";

/**
 * UX_PRODUCT_EXPERIENCE specialist money checks — remove trial-conversion
 * friction on /plan. Every broken control on the plan form is a traveler
 * who never becomes a user; the checks guard the inputs that matter.
 */

const form = await readFile(new URL("../components/plan/TripPlanForm.tsx", import.meta.url), "utf8");
const planPage = await readFile(new URL("../app/plan/page.tsx", import.meta.url), "utf8");

await runMoneyChecks(
  "UX_PRODUCT_EXPERIENCE",
  "Remove trial-conversion friction on /plan: working traveler, budget, and submit controls.",
  [
    defineMoneyFinding(
      "ux-plan-adults-control",
      "high",
      "A traveler count that can go to zero produces nonsense itineraries and lost trials.",
      () => {
        // RE-PIN (Stage 4, 2026-11-10): the Who step's counts moved from
        // StepperField to the BoardUI Stepper component (same form file);
        // StepperField survives only as its own unused definition. The
        // guarded behaviour is unchanged: Adults has a floor of 1, the
        // floor is enforced twice (the minus button disables at the
        // floor AND stepBy clamps), and assistive tech gets named
        // Fewer/More buttons plus a live-announced count.
        assert.match(form, /<Stepper label="Adults" value=\{adults\}[\s\S]{0,160}?min=\{1\}/, "the Adults control must exist as a stepper with a floor of 1");
        assert.match(form, /disabled=\{current <= min\}/, "the stepper must not allow values below its floor (minus disabled at min)");
        assert.match(form, /Math\.max\(min, current \+ delta\)/, "the stepper must clamp at its floor even when stepped programmatically");
        assert.match(form, /aria-label=\{`\$\{translateText\("Fewer"\)\} \$\{translateText\(label\)\}`\}/, "the stepper decrease button must be labeled for assistive tech");
        assert.match(form, /aria-label=\{`\$\{translateText\("More"\)\} \$\{translateText\(label\)\}`\}/, "the stepper increase button must be labeled for assistive tech");
        assert.match(form, /<span aria-live="polite"/, "the stepper count must be announced to assistive tech");
      }
    ),
    defineMoneyFinding(
      "ux-plan-budget-input",
      "high",
      "No budget input means no budget-matched suggestions — Roamly's core promise gone.",
      () => {
        assert.match(form, /budget/i, "the plan form must include a budget input");
        assert.match(planPage, /budget/i, "the /plan page must reference budget handling");
      }
    ),
    defineMoneyFinding(
      "ux-plan-submit-wired",
      "high",
      "A dead generate button is a 100% conversion loss on every affected session.",
      () => {
        assert.match(form, /onClick=\{openFinalConfirmation\}/, "the final-step button must open the generation confirmation");
        assert.match(form, /async function submitPlan\(/, "the submit pipeline must exist and run validation before generation");
        assert.match(form, /validateBeforeGenerate\(\)/, "generation must be validated before it runs");
      }
    ),
    defineMoneyFinding(
      "ux-plan-accessible-labels",
      "medium",
      "Unlabeled inputs confuse travelers and screen readers alike — friction that costs trials.",
      () => {
        const unlabeled = [...form.matchAll(/<TextInput(?![\s\S]{0,400}?ariaLabel)[^>]*>/g)];
        assert.equal(unlabeled.length, 0, `all TextInput controls must carry ariaLabel (${unlabeled.length} do not)`);
      }
    ),
    defineMoneyFinding(
      "ux-plan-no-dead-buttons",
      "low",
      "Buttons that do nothing teach travelers the product is broken.",
      () => {
        const buttons = [...form.matchAll(/<button([^>]*)>/g)];
        for (const [, attrs] of buttons) {
          assert.ok(/onClick|type="submit"|type="button"/.test(attrs), `button must have a handler or explicit type: <button${attrs}>`);
        }
      }
    )
  ]
);
