// Guest generation failure (2026-11-25 QA, bug 1) — error transparency + retry.
//
// The failure: on 2026-11-25 19:30–19:40 UTC the guest POST
// /api/trips/guest-itinerary failed 3/3 (Paris x2, London x1) with the
// generic "Roamly could not start a free itinerary right now." — guest
// users were created but no trip row was ever inserted, and no
// itinerary_generation_failed app event was recorded. The same payloads
// succeed before and after the window (live repros 19:50 UTC, 202s),
// so the break was a transient stall on the Vercel -> Dell DB path:
// the admin client's bounded fetch aborts at 60 s (SUPABASE_FETCH_TIMEOUT_MS)
// and the error carried no user-facing `message`, so the guest route
// fell back to the generic line and the form dead-ended with no retry.
//
// The fix: every error return from generateTripForActor carries a safe,
// user-facing `message` (validation text as-is; a retryable plain line
// for the trip-save failure and the unhandled catch), and the plan form
// shows an explicit "Try again" button under the error on the Review
// step after a generation failure. Validation itself is untouched.
//
// Run BEFORE the fix this script FAILS (the three branches carry no
// message; the form has no retry). AFTER the fix it PASSES.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(new URL("..", import.meta.url).pathname);

function loadTsModule(entryFile) {
  const source = fs.readFileSync(path.join(root, entryFile), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true
    }
  }).outputText;
  const sandbox = { exports: {}, module: { exports: {} }, URL, URLSearchParams, process };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(compiled, sandbox, { filename: entryFile });
  return sandbox.module.exports;
}

const messages = loadTsModule("lib/roamly/generationErrorMessages.ts");

// 1. The messages exist, are plain user-facing lines, and invite a retry.
assert.equal(typeof messages.GENERATION_TRIP_SAVE_FAILED_MESSAGE, "string");
assert.equal(typeof messages.GENERATION_START_FAILED_MESSAGE, "string");
for (const [name, text] of Object.entries(messages)) {
  assert.ok(text.length > 20, `${name} is a real sentence, not a code`);
  assert.ok(/try again/i.test(text), `${name} tells the guest to try again`);
  assert.ok(!/duplicate key|postgres|23505|fetch failed|abort|stack|null|undefined/i.test(text),
    `${name} carries no raw DB / runtime text a guest must never see`);
}

// 2. generateTripForActor wires the messages into every error return a
// guest can hit: validation string, trip-save failure, unhandled catch.
const routeSource = fs.readFileSync(path.join(root, "lib/roamly/tripGenerationRoute.ts"), "utf8");
assert.ok(
  routeSource.includes("generationErrorMessages"),
  "tripGenerationRoute imports the message module"
);
assert.ok(
  /if \(validation\) return NextResponse\.json\(\{\s*ok: false,\s*error: validation,\s*message: validation/s.test(routeSource),
  "validation-string failure returns its own text as message"
);
assert.ok(
  routeSource.includes("GENERATION_TRIP_SAVE_FAILED_MESSAGE"),
  "trip-save failure returns the retryable save-failed message"
);
assert.ok(
  routeSource.includes("GENERATION_START_FAILED_MESSAGE"),
  "unhandled generation failure returns the retryable start-failed message"
);

// 3. The guest route still prefers the upstream message over its generic
// fallback, so the specific line reaches the form.
const guestRouteSource = fs.readFileSync(
  path.join(root, "app/api/trips/guest-itinerary/route.ts"),
  "utf8"
);
assert.ok(
  guestRouteSource.includes('payload?.message || "Roamly could not start a free itinerary right now."'),
  "guest route passes the upstream message through"
);

// 4. The plan form offers an explicit retry after a generation failure:
// a generationFailed flag, set in the guest catch, cleared when a new
// submit starts, and a Try-again button under the Review-step error.
const formSource = fs.readFileSync(path.join(root, "components/plan/TripPlanForm.tsx"), "utf8");
assert.ok(
  /const \[generationFailed, setGenerationFailed\] = useState\(false\)/.test(formSource),
  "form tracks whether the last failure was a generation failure"
);
assert.ok(
  formSource.includes("setGenerationFailed(true)"),
  "guest generation catch marks the failure as retryable"
);
assert.ok(
  /function StepError\(\{ error, onRetry \}/.test(formSource),
  "StepError accepts a retry handler"
);
assert.ok(
  formSource.includes('translateText("Try again")'),
  "StepError renders a Try again button when a retry handler is given"
);
assert.ok(
  /<StepError error=\{translateText\(error\)\} onRetry=\{generationFailed \? openFinalConfirmation : undefined\} \/>/.test(formSource),
  "Review step passes the retry handler only after a generation failure"
);

console.log("Guest generation error checks: PASS");
