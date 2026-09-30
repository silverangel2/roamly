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
        assert.match(form, /ariaLabel="Adults"/, "the Adults input must exist and be labeled for assistive tech");
        assert.match(form, /type="number" min=\{1\}[^>]*ariaLabel="Adults"/, "the Adults input must not allow values below 1");
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
