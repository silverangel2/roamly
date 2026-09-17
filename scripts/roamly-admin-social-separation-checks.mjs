import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("app/admin/social/automation/page.tsx", "utf8");

assert.match(page, /getFacebookAutomationSummary/);
assert.match(page, /getFacebookAutomationSummary\(state\.admin, "roamly"\)/);
assert.match(page, /FacebookAutomationControls summary=\{summary\} brand="roamly"/);
assert.match(page, /MetaVisibilityDiagnostic/);
assert.doesNotMatch(page, /reviewintel|ReviewIntel|REVIEWINTEL/);
assert.doesNotMatch(page, /getFacebookAutomationSummaries/);
assert.doesNotMatch(page, /brandSummaries/);

console.log("PASS: Roamly admin social automation is Roamly-only and retains Meta visibility diagnosis");
