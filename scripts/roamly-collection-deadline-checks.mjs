import assert from "node:assert/strict";

import { runCollectionDeadlineChecks } from "./roamly-collection-deadline-shared.mjs";

// Offline regression for the Phase 3 external-collection budget
// (ITEM 4, 2026-11-01): section F of roamly-wiring-phase3-checks.mjs
// runs a LIVE Quebec City rebuild whose 6 sequential Overpass chunks
// carry the production 210 s collection deadline — through a slow
// egress that cannot finish inside a test gate. This suite proves
// the same deadline CONTRACT deterministically and offline, with a
// scripted fake transport (canned Overpass payloads, scripted
// latencies, small deadlines of 600-900 ms instead of 210 s) and
// ZERO live network calls. The assertions themselves live in
// roamly-collection-deadline-shared.mjs and are shared verbatim with
// section H of the phase3 suite, so the two can never drift.
//
// What this proves: the deadline is enforced as a start gate,
// partial results from chunks completed before the deadline are
// kept and honestly flagged, and a chunk that hangs past the
// deadline cannot hang the collection beyond a bounded return near
// the deadline. What it does NOT prove: anything about production
// latency or the 300 s pack-refresh function — no production log
// was read and no live call was made.
//
// Run directly (package.json is intentionally untouched):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-collection-deadline-checks.mjs

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}

await runCollectionDeadlineChecks({ ok, eq }, "collection-deadline");

console.log(`roamly-collection-deadline-checks: ${count} assertions PASS (offline — scripted fake transport only, zero live network calls)`);
