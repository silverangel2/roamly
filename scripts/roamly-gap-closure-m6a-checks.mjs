// GAP-CLOSURE (2026-11-02) — M6a successor apply routes, M5 wake-drop
// hardening pins, and the keeper concierge-read bound.
//
// HONEST SEAM NOTE: the three successor apply routes have no store /
// dependency-injection seam (they call requireUser, the reserve RPCs
// and the staged starters directly), so a route-level harness cannot
// exercise them without a live auth + Supabase stack. Following the
// task's fallback and the test:production precedent, this suite proves:
//   (1) M6a at the SOURCE-ORDER level, per route: the queue creation
//       sits after startStagedItineraryGeneration persists the state
//       and before scheduleStagedGenerationAdvance; a queue failure
//       throws into the route's fail-RPC catch; the fresh gate and the
//       final/502 response shapes are byte-preserved.
//   (2) M6a at the HELPER level: the replay decision the routes make
//       is `!getStagedGenerationState(trip.metadata, successorTripId)`
//       using the REAL helper — an orphan-shaped metadata document
//       (planning + proposal id only, the reserve RPC's insert shape)
//       yields null (start runs), while a persisted v2 state yields
//       the state (start skipped). The job-creation helper itself
//       (createOrResumeGenerationJob / ensureTripJob) is proven
//       behaviourally in test:stranded-recovery (M5 case + Fix #1
//       interleave) and test:wiring-fixes §1.
//   (3) M5 hardening pins: the loud critical diagnostic, the named
//       app-event constant + recordAppEvent write, the preserved
//       wake_skipped diagnostic, and the cron route's authorized()
//       401 behaviour left untouched.
//   (4) Keeper bound: the route's query carries the projected columns
//       + the outcome filter and NO limit, and the REAL tally helper
//       computes byte-identical tallies over the full row set vs the
//       filtered+projected row set the new query returns.
//
// Run: npm run test:gap-m6a (phase-5 register).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}
delete process.env.OPENAI_API_KEY;

const { getStagedGenerationState } = await import("@/lib/roamly/stagedItineraryGeneration.ts");
const { conciergeRowsToSuggestionTally } = await import("@/lib/roamly/concierge/conciergeSuggestionTally.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
  console.log(`  PASS ${label}`);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
  console.log(`  PASS ${label}`);
}
function deq(actual, expected, label) {
  count += 1;
  assert.deepEqual(actual, expected, label);
  console.log(`  PASS ${label}`);
}
const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/* ------------------------------------------------------------------ */
/* (1) M6a per-route source-order + shape pins                        */
/* ------------------------------------------------------------------ */

console.log("M6a — successor apply routes: source order, replay gate, response shapes");

const ROUTES = [
  {
    name: "date-change",
    rel: "app/api/trips/[id]/date-change/[proposalId]/apply/route.ts",
    failRpc: "roamly_fail_customer_trip_date_change"
  },
  {
    name: "destination-change",
    rel: "app/api/trips/[id]/destination-change/[proposalId]/apply/route.ts",
    failRpc: "roamly_fail_customer_trip_destination_change"
  },
  {
    name: "intent-change",
    rel: "app/api/trips/[id]/intent-change/[proposalId]/apply/route.ts",
    failRpc: "roamly_fail_customer_trip_intent_change"
  }
];

for (const route of ROUTES) {
  const src = read(route.rel);
  const startIdx = src.indexOf("await startStagedItineraryGeneration({");
  const queueIdx = src.indexOf("const queueResult = await createOrResumeGenerationJob({");
  const scheduleIdx = src.indexOf("scheduleStagedGenerationAdvance({");
  ok(
    src.includes('createOrResumeGenerationJob } from "@/lib/roamly/generationQueue"') && queueIdx > -1,
    `M6a ${route.name}: the route imports and calls createOrResumeGenerationJob (the Fix #1 atomic helper)`
  );
  ok(
    startIdx > -1 && queueIdx > startIdx && scheduleIdx > queueIdx,
    `M6a ${route.name}: source order is start (state first) -> createOrResumeGenerationJob (job second) -> scheduleStagedGenerationAdvance`
  );
  ok(
    src.includes("if (!queueResult.ok) throw new Error(queueResult.error") && src.includes(route.failRpc),
    `M6a ${route.name}: a queue failure throws into the catch that fails the successor via ${route.failRpc}`
  );
  ok(
    src.includes("result.data?.idempotent !== true") && src.includes("const freshStart = "),
    `M6a ${route.name}: the fresh (idempotent !== true) start gate is preserved`
  );
  ok(
    src.includes("result.data?.idempotent === true") &&
      src.includes("!getStagedGenerationState(existing.data.trip.metadata, successorTripId)") &&
      src.includes("let replayStart = "),
    `M6a ${route.name}: an idempotent replay with NO v2 state on the successor runs the start block (replayStart)`
  );
  ok(
    src.includes('return NextResponse.json({ ok: true, status: result.data?.status || "generating", successorTripId });') &&
      src.includes('return NextResponse.json({ ok: false, error: "The new itinerary could not be started. Your original trip is unchanged." }, { status: 502 });'),
    `M6a ${route.name}: the success and 502 response shapes are byte-identical to the pre-fix route`
  );
}

/* ------------------------------------------------------------------ */
/* (2) M6a helper seam — getStagedGenerationState replay decision     */
/* ------------------------------------------------------------------ */

console.log("M6a — helper seam: the replay decision over real metadata shapes");

const SUCCESSOR = "55555555-5555-4555-8555-555555555555";

// The reserve RPC's insert shape (KF2-DIAGNOSIS §5.4): planning +
// proposal id only — no `generation` key at all.
const orphanMetadata = {
  planning: { destination: "Charlottetown", startDate: "2026-11-10", endDate: "2026-11-12" },
  date_change_proposal_id: "proposal-1"
};
eq(
  getStagedGenerationState(orphanMetadata, SUCCESSOR),
  null,
  "M6a seam: orphan metadata (no generation key) yields null — the replay runs the start block"
);

const persistedMetadata = {
  generation: {
    version: 2,
    tripId: SUCCESSOR,
    status: "queued",
    currentStage: "generating_outline",
    totalDayCount: 3,
    completedDayCount: 0,
    outline: null,
    days: {},
    batches: {},
    generatedDays: {},
    payload: { destination: "Charlottetown", daysCount: 3, startDate: "2026-11-10", endDate: "2026-11-12" },
    stageRuns: [],
    aiCallCount: 0,
    startedAt: "2026-11-02T15:00:00.000Z",
    updatedAt: "2026-11-02T15:00:00.000Z",
    completedAt: null,
    worker: null
  }
};
const found = getStagedGenerationState(persistedMetadata, SUCCESSOR);
ok(found !== null && found.status === "queued", "M6a seam: a persisted v2 state is found — the replay keeps the 200 without re-starting");
eq(
  getStagedGenerationState({ generation: { version: 1, tripId: SUCCESSOR, payload: {} } }, SUCCESSOR),
  null,
  "M6a seam: a non-v2 generation document yields null — treated as no state"
);
eq(
  getStagedGenerationState(persistedMetadata, "66666666-6666-4666-8666-666666666666"),
  null,
  "M6a seam: a v2 state scoped to a DIFFERENT trip yields null for this successor"
);

/* ------------------------------------------------------------------ */
/* (3) M5 hardening pins                                              */
/* ------------------------------------------------------------------ */

console.log("M5 — secret-absent wake drop: loud diagnostic + owner-surface app event");

const background = read("lib/roamly/stagedGenerationBackground.ts");
ok(
  background.includes('export const GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE = "generation_wake_secret_missing"'),
  "M5: the named app-event constant GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE is exported"
);
ok(
  background.includes("eventType: GENERATION_WAKE_SECRET_MISSING_EVENT_TYPE") && background.includes("recordAppEvent(admin, {"),
  "M5: the drop is recorded via recordAppEvent into roamly_app_events (the cron-heartbeat store owner surfaces read)"
);
ok(
  background.split("staged_generation_background_wake_dropped_secret_missing").length - 1 >= 2 &&
    background.includes('severity: "critical"'),
  "M5: the LOUD critical diagnostic fires on both console.error and logGenerationDiagnostic"
);
ok(
  background.includes("staged_generation_background_wake_skipped"),
  "M5: the pre-existing wake_skipped diagnostic (GENERATION_CRON_SECRET_MISSING) is preserved"
);
const cronRoute = read("app/api/cron/roamly-itinerary-generation/route.ts");
ok(
  cronRoute.includes("return cronTokenMatchesAnySecret(token, secrets);"),
  "M5: the cron route authorized() behaviour is unchanged (secret-less calls still fail the check; Stage 5 swapped the plain-equality compare for the shared constant-time helper, same carrier and fail-closed posture)"
);
ok(
  cronRoute.includes('return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });'),
  "M5: the cron route still answers unauthorized calls with 401"
);

/* ------------------------------------------------------------------ */
/* (4) Keeper bound — query pins + tally equivalence                  */
/* ------------------------------------------------------------------ */

console.log("Keeper — concierge_suggestions read: filter + projection, no limit, identical tally");

const keeper = read("app/api/cron/roamly-keeper/route.ts");
ok(
  keeper.includes('.select("kind,title,item_ref,pattern_key,outcome")'),
  "keeper: the read projects exactly the five columns the tally consumes"
);
ok(
  keeper.includes('.in("outcome", ["kept", "dropped"])'),
  "keeper: the read pushes the tally's kept/dropped filter into the query"
);
ok(!keeper.includes(".limit("), "keeper: NO limit was added (the count-based retire tally over all decided rows would change)");

const rows = [
  { id: "s1", trip_id: "t1", user_id: "u1", kind: "activity", day_number: 1, item_ref: "ref-a", title: "Beach Day", reason: "r", pattern_key: "beach", pattern_trip_count: 4, applied: true, outcome: "kept" },
  { id: "s2", trip_id: "t2", user_id: "u1", kind: "activity", day_number: 2, item_ref: "ref-b", title: "Beach Day", reason: "r", pattern_key: "beach", pattern_trip_count: 4, applied: true, outcome: "dropped" },
  { id: "s3", trip_id: "t3", user_id: "u2", kind: "food", day_number: 1, item_ref: "ref-c", title: "Seafood", reason: "r", pattern_key: "beach", pattern_trip_count: 4, applied: false, outcome: null },
  { id: "s4", trip_id: "t1", user_id: "u1", kind: "activity", day_number: 3, item_ref: null, title: "Sunset Sail", reason: "r", pattern_key: null, pattern_trip_count: null, applied: true, outcome: "dropped" },
  { id: "s5", trip_id: "t2", user_id: "u3", kind: "activity", day_number: 1, item_ref: "ref-d", title: "Museum", reason: "r", pattern_key: null, pattern_trip_count: null, applied: false, outcome: null }
];
// What the new query returns for the same table: decided rows only,
// projected to the five consumed columns.
const queried = rows
  .filter((row) => row.outcome === "kept" || row.outcome === "dropped")
  .map((row) => ({ kind: row.kind, title: row.title, item_ref: row.item_ref, pattern_key: row.pattern_key, outcome: row.outcome }));
deq(
  conciergeRowsToSuggestionTally(queried),
  conciergeRowsToSuggestionTally(rows),
  "keeper: the tally over the filtered+projected rows is identical to the tally over the full row set"
);
const tally = conciergeRowsToSuggestionTally(rows);
eq(
  tally.reduce((sum, entry) => sum + entry.kept + entry.dropped, 0),
  3,
  "keeper: undecided (outcome null) rows contribute nothing to the tally — the pushed filter drops only ignored rows"
);

console.log(`\nGap-closure M6a checks: ${count} assertions passed.`);
