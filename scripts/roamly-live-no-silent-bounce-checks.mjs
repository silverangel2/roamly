// Live Companion no-silent-bounce checks (structural, source-level).
// Proves the /live gate shape, not a rendered page: a generated trip whose
// Companion is not unlocked must render an explanation instead of bouncing
// silently back to the trip page. A trip that has not generated yet still
// redirects to its trip page, where generation lives. Completed trips still
// pass through (their gate is guarded by !tripCompleted on both branches).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, "app/trip/[id]/live/page.tsx"), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

// The old combined silent redirect must be gone.
check(
  "no combined locked-or-unlocked silent redirect",
  !src.includes("if ((!locked && !tripCompleted) || (!companionUnlocked && !tripCompleted))")
);
// Ungenerated trips still redirect to the trip page.
check(
  "ungenerated trip still redirects to trip page",
  src.includes("if (!locked && !tripCompleted) redirect(`/trip/${id}`);")
);
// Unlocked-less, non-completed trips render an explanation, not a redirect.
check(
  "unlocked-less branch renders instead of redirecting",
  src.includes("if (!companionUnlocked && !tripCompleted) {")
);
check(
  "explanation names the missing unlock in plain words",
  src.includes("Live Companion isn&apos;t unlocked for this trip yet")
);
check(
  "explanation links back to the trip page where unlock lives",
  src.includes("href={`/trip/${id}`}")
);
check(
  "explanation says nothing was changed",
  src.includes("Nothing was changed")
);
// The explanation branch must not itself redirect.
const branchStart = src.indexOf("if (!companionUnlocked && !tripCompleted) {");
const branchEnd = src.indexOf("if (!tripCompleted) await scheduleCompanionEvents");
const branch = src.slice(branchStart, branchEnd);
check("explanation branch contains no redirect call", !branch.includes("redirect("));

console.log(`\n${passed} live no-silent-bounce checks passed`);
