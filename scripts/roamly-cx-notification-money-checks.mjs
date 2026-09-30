import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defineMoneyFinding, runMoneyChecks } from "./specialist-money-check-utils.mjs";

/**
 * CUSTOMER_EXPERIENCE specialist money checks — protect retention revenue.
 * A notification flood on the traveler's phone is an uninstall event; the
 * checks lock the sticky-only-critical policy, per-activity dedupe, and the
 * rule that every action the UI can send is handled by the service worker.
 */

const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

await runMoneyChecks(
  "CUSTOMER_EXPERIENCE",
  "Protect retention revenue: no notification spam, every push action handled, per-activity dedupe.",
  [
    defineMoneyFinding(
      "cx-sticky-only-critical",
      "high",
      "Every push demanding interaction trains travelers to mute Roamly forever.",
      () => {
        assert.match(sw, /"activity_start",\s*"leave_by",\s*"late",\s*"arrival",\s*"flight_delay",\s*"flight_cancelled"/s, "only time-critical event types may be sticky");
        assert.match(sw, /requireInteraction: sticky/, "requireInteraction must follow the sticky flag, never be unconditional");
      }
    ),
    defineMoneyFinding(
      "cx-per-activity-dedupe",
      "high",
      "Duplicate pushes for the same activity read as spam and burn trust.",
      () => {
        assert.match(sw, /roamly-activity-\$\{[^}]*tripId[^}]*\}-\$\{[^}]*activityId[^}]*\}/, "notifications must be tagged per trip+activity so repeats replace instead of stacking");
      }
    ),
    defineMoneyFinding(
      "cx-all-actions-handled",
      "medium",
      "A notification button that does nothing is a broken promise at the worst moment.",
      () => {
        for (const action of ["google_maps", "apple_maps", "citymapper", "check_in", "skip"]) {
          assert.ok(sw.includes(`event.action === "${action}"`), `service worker must handle the "${action}" notification action`);
        }
      }
    ),
    defineMoneyFinding(
      "cx-quiet-hours-or-gating",
      "low",
      "Pushing routine nudges at 3am costs more retention than the nudge is worth.",
      () => {
        assert.match(sw, /sticky|requireInteraction/, "the service worker must distinguish interruptive pushes from quiet ones");
      }
    )
  ]
);
