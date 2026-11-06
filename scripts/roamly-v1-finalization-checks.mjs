// Roamly V1 finalization checks — OPTION A (2026-11-01, owner-authorized,
// LOCAL ONLY).
//
// Proves the narrow relaxed-return correction end to end with the REAL
// converter (engineDayToRoamlyDayPlan), the REAL serializer stamp
// propagation (engineItemToSeed, via the converter), and the REAL
// production validator (travelerReadinessErrors +
// validateItineraryForProduction in lib/itinerary.ts):
//   (a) the frozen Quebec 14-day itinerary — whose Day-12 Parc de
//       l'Unesco visit is a solver-stamped legitimate return
//       (repeat:true, firstDay:1, kind:"park") — now validates clean;
//   (b) forgery / negative controls: every tampered or unstamped
//       repeat still produces the exact repeat error;
//   (c) finalization behaviour on BOTH paths:
//       - zero-engine: the real advanceEngineGeneration driver over an
//         in-memory store (the Phase 5 harness pattern) reaches the
//         real runFinalizationStage, which validates the assembled
//         final itinerary before persisting it;
//       - stored-itinerary: the real finalizeCompletedStagedGeneration
//         over a fake Supabase client, plus its exact email-selection
//         core (payloadFromTrip + validateItineraryForProduction over
//         the stored document — the code at generationFinalization.ts
//         that starts completionKind at "completion" and downgrades
//         it to "failure" only when that readiness call fails).
//
// Email transport boundary (honest): sendStagedGenerationEmail creates
// its own Supabase admin client internally; with no service-role
// configuration in this local harness it returns a single
// { status: "skipped" } result without sending. The completionKind it
// was called with is not returned by finalizeCompletedStagedGeneration,
// so the kind is proven at the deepest callable layer: the readiness
// call that decides it (run above with the real functions and the real
// trip shape), the presence/absence of the function's own
// "staged_generation_stored_itinerary_not_ready" diagnostic, a single
// email result object per finalize call, and exactly one finalize RPC.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The email/finalization modules must see NO Supabase service-role
// configuration: that keeps every call in this suite local and fake.
for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const { travelerReadinessErrors, validateItineraryForProduction } = await import("@/lib/itinerary.ts");
const {
  engineDayToRoamlyDayPlan,
  assembleEngineItinerary,
  advanceEngineGeneration,
  startEngineGeneration,
  ZERO_ENGINE_GENERATION_NOTE
} = await import("@/lib/roamly/engine/generate.ts");
const { finalizeCompletedStagedGeneration, isFinalStoredItinerary } = await import(
  "@/lib/roamly/generationFinalization.ts"
);
const { payloadFromTrip } = await import("@/lib/roamly/marketPriceRefresh.ts");

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
const clone = (v) => JSON.parse(JSON.stringify(v));
const repeatErrors = (errors) => errors.filter((e) => /must not repeat across days/.test(e));
const REPEAT_MSG = "activity Parc de l'Unesco must not repeat across days.";

/* ------------------------------------------------------------------ */
/* (a) Quebec — the real fixture through the real converter + validator */
/* ------------------------------------------------------------------ */

console.log("(a) Quebec 14-day relaxed return — real converter + real validator");

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/wiring-phase2/frozen/pacing-quebec-14d/itinerary.json", import.meta.url), "utf8")
);

// Sanity: the stamps in the solver fixture itself (harness method).
const fixtureUnesco = [];
for (const day of fixture.days) {
  for (const item of day.items || []) {
    if ((item.name || "") === "Parc de l'Unesco") {
      fixtureUnesco.push({ day: day.dayNumber, repeat: item.repeat ?? null, firstDay: item.firstDay ?? null, kind: item.kind });
    }
  }
}
eq(fixtureUnesco.length, 2, "a: fixture carries exactly two Parc de l'Unesco visits");
eq(fixtureUnesco[0].day, 1, "a: first Unesco visit is Day 1");
eq(fixtureUnesco[0].repeat, null, "a: Day-1 fixture visit is unstamped");
eq(fixtureUnesco[1].day, 12, "a: return Unesco visit is Day 12");
eq(fixtureUnesco[1].repeat, true, "a: Day-12 fixture visit is stamped repeat:true");
eq(fixtureUnesco[1].firstDay, 1, "a: Day-12 fixture stamp firstDay is 1");
eq(fixtureUnesco[1].kind, "park", "a: Day-12 fixture kind is park");

const ctx = {
  destination: fixture.destination,
  anchorName: fixture.anchorStay.name,
  anchorKey: null,
  anchorBooked: false,
  anchorPos: null,
  totalDayCount: fixture.days.length,
  mustSeeKeys: new Set(),
  originLabel: null
};
const roamlyDays = fixture.days.map((d) => engineDayToRoamlyDayPlan(d, ctx));
const doc = { daily_itinerary: roamlyDays, booking_suggestions: [] };
const payload = { daysCount: fixture.days.length, destination: fixture.destination, origin: "", transportationPreference: "" };

function findSeed(docIn, title, dayNumber) {
  const day = docIn.daily_itinerary.find((d) => d.day_number === dayNumber);
  return day ? day.live_timeline.find((i) => i.title === title) : undefined;
}

const seedDay1 = findSeed(doc, "Parc de l'Unesco", 1);
const seedDay12 = findSeed(doc, "Parc de l'Unesco", 12);
ok(seedDay1, "a: converted doc carries the Day-1 Unesco seed");
ok(seedDay12, "a: converted doc carries the Day-12 Unesco seed");
eq(seedDay12.repeat, true, "a: converted Day-12 seed carries repeat:true (serializer propagated the stamp)");
eq(seedDay12.firstDay, 1, "a: converted Day-12 seed carries firstDay:1");
eq(seedDay12.kind, "park", "a: converted Day-12 seed carries kind:park");
ok(!("repeat" in seedDay1), "a: converted Day-1 seed carries NO repeat field");
ok(!("firstDay" in seedDay1), "a: converted Day-1 seed carries NO firstDay field");
ok(!("kind" in seedDay1), "a: converted Day-1 seed carries NO kind field");

const readiness = travelerReadinessErrors(doc, payload);
eq(JSON.stringify(readiness), "[]", `a: travelerReadinessErrors returns [] (got ${JSON.stringify(readiness)})`);
const prod = validateItineraryForProduction(doc, payload);
eq(prod.ok, true, `a: validateItineraryForProduction ok:true (errors: ${JSON.stringify(prod.errors)})`);
eq(prod.errors.length, 0, "a: validateItineraryForProduction returns no errors");

/* ------------------------------------------------------------------ */
/* (b) Forgery / negative controls — every one MUST still error        */
/* ------------------------------------------------------------------ */

console.log("(b) Forgery / negative controls — each must still produce the repeat error");

function expectRepeatError(mutated, label) {
  const errors = travelerReadinessErrors(mutated, payload);
  ok(repeatErrors(errors).includes(REPEAT_MSG), `${label} (errors: ${JSON.stringify(errors)})`);
}

// (i) stamped return whose claimed firstDay has no original on that day
{
  const m = clone(doc);
  findSeed(m, "Parc de l'Unesco", 12).firstDay = 2;
  expectRepeatError(m, "b(i): firstDay changed to 2 (no Unesco original on Day 2) -> repeat error");
}
// (ii) gap < 4: the stamped return moved to Day 4 (stamp firstDay 1 kept)
{
  const m = clone(doc);
  const day12 = m.daily_itinerary.find((d) => d.day_number === 12);
  const idx = day12.live_timeline.findIndex((i) => i.title === "Parc de l'Unesco");
  const [seed] = day12.live_timeline.splice(idx, 1);
  m.daily_itinerary.find((d) => d.day_number === 4).live_timeline.push(seed);
  expectRepeatError(m, "b(ii): genuine stamp but return on Day 4 (gap 3 < 4) -> repeat error");
}
// (iii) ineligible kind
{
  const m = clone(doc);
  findSeed(m, "Parc de l'Unesco", 12).kind = "museum";
  expectRepeatError(m, "b(iii): stamp kind changed to museum (not a RELAX_KIND) -> repeat error");
}
// (iv) stamp firstDay pointing at a different place's day
{
  const m = clone(doc);
  const other = m.daily_itinerary
    .flatMap((d) => d.live_timeline.map((i) => ({ day: d.day_number, item: i })))
    .find(({ day, item }) => item.item_type === "activity" && item.title !== "Parc de l'Unesco" && day !== 1);
  ok(other, "b(iv): found a different activity on another day to borrow its day from");
  findSeed(m, "Parc de l'Unesco", 12).firstDay = other.day;
  expectRepeatError(m, `b(iv): firstDay claimed as Day ${other.day} (first day of "${other.item.title}") -> repeat error`);
}
// (v) third occurrence
{
  const m = clone(doc);
  const third = clone(findSeed(m, "Parc de l'Unesco", 12));
  m.daily_itinerary.find((d) => d.day_number === 13).live_timeline.push(third);
  expectRepeatError(m, "b(v): third stamped Unesco visit on Day 13 -> repeat error (its stamp references Day 1, not the previous accepted visit Day 12 — chain rule, 2026-11-02)");
}
// (vi) stamp removed from the genuine return (unstamped duplicate)
{
  const m = clone(doc);
  const seed = findSeed(m, "Parc de l'Unesco", 12);
  delete seed.repeat;
  delete seed.firstDay;
  delete seed.kind;
  expectRepeatError(m, "b(vi): stamp stripped from the genuine Day-12 return -> repeat error");
}
// (vii) stamp placed on the FIRST occurrence as well (both stamped)
{
  const m = clone(doc);
  const first = findSeed(m, "Parc de l'Unesco", 1);
  first.repeat = true;
  first.firstDay = 1;
  first.kind = "park";
  expectRepeatError(m, "b(vii): first occurrence also stamped -> repeat error");
}
// (viii) verification harness Controls A / C / D
const hotelSeed = {
  item_type: "hotel",
  title: "Hôtel Marie Rollett",
  description: "Check in at Hôtel Marie Rollett — your base for this trip.",
  candidateId: "way/anchor",
  factualStatus: "search_ready"
};
const act = (title) => ({ item_type: "activity", title, description: "" });
{
  const docA = {
    daily_itinerary: [
      { day_number: 1, live_timeline: [hotelSeed, act("Musée de la Civilisation de Québec")] },
      { day_number: 2, live_timeline: [act("Musée de la Civilisation de Québec")] }
    ],
    booking_suggestions: []
  };
  const errors = travelerReadinessErrors(docA, payload);
  ok(
    repeatErrors(errors).includes("activity Musée de la Civilisation de Québec must not repeat across days."),
    `b(viii-A): Control A accidental duplicate (Days 1-2, no stamps) -> repeat error (got ${JSON.stringify(errors)})`
  );
}
{
  const docC = {
    daily_itinerary: [
      { day_number: 1, live_timeline: [hotelSeed, { ...act("Parc de l'Unesco"), sourceBatch: 1 }] },
      { day_number: 5, live_timeline: [{ ...act("Parc de l'Unesco"), sourceBatch: 2 }] }
    ],
    booking_suggestions: []
  };
  expectRepeatError(docC, "b(viii-C): Control C cross-batch annotated repeat (no solver stamp) -> repeat error");
}
{
  const docD = {
    daily_itinerary: [
      { day_number: 1, live_timeline: [hotelSeed, act("Parc de l'Unesco")] },
      { day_number: 2, live_timeline: [act("Chute Montmorency")] }
    ],
    booking_suggestions: []
  };
  const errors = travelerReadinessErrors(docD, payload);
  eq(repeatErrors(errors).length, 0, `b(viii-D): Control D distinct places -> no repeat errors (got ${JSON.stringify(errors)})`);
}
// Extra: meals never relax, even with a perfect stamp bundle.
{
  const meal = (extra) => ({ item_type: "meal", title: "Chez Rioux", description: "", ...extra });
  const docMeal = {
    daily_itinerary: [
      { day_number: 1, live_timeline: [hotelSeed, meal({})] },
      { day_number: 6, live_timeline: [meal({ repeat: true, firstDay: 1, kind: "park" })] }
    ],
    booking_suggestions: []
  };
  const errors = travelerReadinessErrors(docMeal, payload);
  ok(
    repeatErrors(errors).includes("meal Chez Rioux must not repeat across days."),
    `b(extra): stamped meal repeat -> repeat error (meals never relax) (got ${JSON.stringify(errors)})`
  );
}

/* ------------------------------------------------------------------ */
/* (c1) Zero-engine finalization path — real driver, in-memory store   */
/* ------------------------------------------------------------------ */

console.log("(c1) Zero-engine path — advanceEngineGeneration -> runFinalizationStage (in-memory store)");

function createMemoryStore() {
  const trips = new Map();
  const itineraries = new Map();
  const predictions = new Map();
  let rev = 0;
  const statusFor = (state) =>
    state.status === "complete" ? "generated" : state.status === "failed" || state.status === "partially_failed" ? "draft" : "generating";
  function writeRow(trip, state, run) {
    rev += 1;
    const row = trips.get(trip.id);
    const metadata = { ...(row ? row.metadata : {}), generation: clone(state), zeroEngine: clone(run) };
    const next = {
      id: trip.id,
      user_id: trip.user_id,
      metadata,
      status: statusFor(state),
      itinerary_status: statusFor(state),
      itinerary_generated_at: row ? row.itinerary_generated_at : null,
      updated_at: `rev-${rev}`
    };
    trips.set(trip.id, next);
    return clone(next);
  }
  return {
    trips,
    itineraries,
    predictions,
    seedTrip(tripId, userId) {
      rev += 1;
      trips.set(tripId, {
        id: tripId,
        user_id: userId,
        metadata: {},
        status: "generating",
        itinerary_status: "generating",
        itinerary_generated_at: null,
        updated_at: `rev-${rev}`
      });
    },
    tamper(tripId, fn) {
      const row = trips.get(tripId);
      fn(row);
      rev += 1;
      row.updated_at = `rev-${rev}`;
    },
    async loadTrip(tripId, userId) {
      const row = trips.get(tripId);
      if (!row || (userId && row.user_id !== userId)) throw new Error(`trip ${tripId} not found`);
      return clone(row);
    },
    async persistState(trip, state, run) {
      const row = trips.get(trip.id);
      if (!row || row.updated_at !== trip.updated_at) throw new Error("CAS conflict on persistState");
      return writeRow(trip, state, run);
    },
    async claim(trip, state, run) {
      const row = trips.get(trip.id);
      if (!row || row.updated_at !== trip.updated_at) return null;
      return writeRow(trip, state, run);
    },
    async persistItinerary(trip, itinerary, final) {
      itineraries.set(trip.id, {
        trip_id: trip.id,
        user_id: trip.user_id,
        full_json: clone(itinerary),
        source: final ? "zero-engine" : null,
        final
      });
    },
    async writePrediction(record) {
      if (predictions.has(record.predictionId)) return { written: false };
      predictions.set(record.predictionId, clone(record));
      return { written: true };
    },
    async markFreeItineraryUsed() {
      return { ok: true };
    },
    async lockItinerary() {
      return {};
    }
  };
}

// A pack store whose pin lookup finds nothing: finalization then skips
// the PREDICT write (assemblePinnedEnginePack returns null) and still
// runs its real validation gate over the assembled itinerary.
const fakePackStore = {
  async getPin() {
    return null;
  },
  async getWeatherSnapshot() {
    return null;
  }
};

const USER_ID = "v1-finalization-user";
const enginePayload = {
  origin: "",
  originCity: "",
  destination: fixture.destination,
  destinationCity: fixture.destination,
  destinationCountry: "Canada",
  tripType: "single_destination",
  startDate: fixture.startDate,
  endDate: fixture.endDate,
  daysCount: fixture.days.length,
  travelers: { adults: 2, children: 0, infants: 0 },
  travelersCount: 2,
  budgetAmount: 4200,
  budgetCurrency: "CAD",
  interests: [],
  pace: "Balanced",
  travelStyle: "Balanced",
  specialNotes: "",
  language: "en",
  explicitRequirements: []
};

async function driveFinalization(tripId, generatedDays) {
  const store = createMemoryStore();
  store.seedTrip(tripId, USER_ID);
  await startEngineGeneration({
    store,
    tripId,
    userId: USER_ID,
    payload: clone(enginePayload),
    requestId: `req-${tripId}-start`,
    unlockSource: "paid",
    context: { personalization: { enabled: false, accepted: {}, inferred: {}, aggregateGuidance: [] }, confirmedBookings: [] }
  });
  store.tamper(tripId, (row) => {
    const g = row.metadata.generation;
    g.outline = {
      tripSummary: `${fixture.destination} — 14-day trip (V1 finalization checks).`,
      hotelAreaRecommendation: `${fixture.anchorStay.name} — the trip's base.`,
      importantConstraints: [],
      days: Array.from({ length: 14 }, (_, i) => ({
        id: `day-${i + 1}`,
        dayNumber: i + 1,
        date: "",
        theme: "Exploring",
        geographicArea: fixture.destination,
        priorityActivities: []
      }))
    };
    for (const batch of Object.values(g.batches)) {
      batch.status = "complete";
      batch.completedAt = new Date().toISOString();
      batch.lastError = null;
    }
    for (const dayState of Object.values(g.days)) {
      dayState.status = "complete";
      dayState.lastError = null;
    }
    g.generatedDays = Object.fromEntries(generatedDays.map((d) => [String(d.day_number), clone(d)]));
    g.completedDayCount = generatedDays.length;
    g.status = "generating_day";
    g.currentStage = "generating_day";
    g.worker = null;
  });
  const result = await advanceEngineGeneration({
    deps: { store, packStore: fakePackStore },
    tripId,
    userId: USER_ID,
    requestId: `req-${tripId}-finalize`
  });
  return { store, result };
}

let assembledFinalDoc = null;
{
  const { store, result } = await driveFinalization("trip-v1-engine-ok", roamlyDays);
  eq(result.ok, true, `c1: zero-engine finalization accepts the Quebec itinerary (result: ${JSON.stringify({ ok: result.ok, status: result.status, error: result.error || null })})`);
  eq(result.status, "complete", "c1: zero-engine job reaches status complete");
  eq(result.stage, "complete", "c1: the wake that ran was the finalization (complete) stage");
  eq(result.state.lastErrorCode, null, "c1: NO FINAL_VALIDATION_FAILED on the valid Quebec itinerary");
  eq(JSON.stringify(result.state.finalValidationErrors), "[]", "c1: finalValidationErrors is empty");
  const stored = store.itineraries.get("trip-v1-engine-ok");
  ok(stored && stored.final === true, "c1: a FINAL itinerary was persisted by runFinalizationStage");
  eq(stored.source, "zero-engine", "c1: persisted final carries the zero-engine source stamp");
  assembledFinalDoc = stored.full_json;
  const revalidation = validateItineraryForProduction(assembledFinalDoc, payload);
  eq(revalidation.ok, true, `c1: the persisted assembled final doc itself re-validates ok:true (errors: ${JSON.stringify(revalidation.errors)})`);
  const day12 = findSeed(assembledFinalDoc, "Parc de l'Unesco", 12);
  ok(day12 && day12.repeat === true && day12.firstDay === 1 && day12.kind === "park", "c1: assembled final doc still carries the Day-12 stamp bundle after assembly/enrich/localize");
}
{
  // Negative control on the same real stage: stamp stripped.
  const strippedDays = clone(roamlyDays);
  const seed = findSeed({ daily_itinerary: strippedDays }, "Parc de l'Unesco", 12);
  delete seed.repeat;
  delete seed.firstDay;
  delete seed.kind;
  const { result } = await driveFinalization("trip-v1-engine-bad", strippedDays);
  eq(result.ok, false, "c1-neg: zero-engine finalization refuses the stamp-stripped itinerary");
  eq(result.error, "FINAL_VALIDATION_FAILED", "c1-neg: refusal is FINAL_VALIDATION_FAILED");
  eq(result.state.lastErrorCode, "FINAL_VALIDATION_FAILED", "c1-neg: state lastErrorCode is FINAL_VALIDATION_FAILED");
  ok(
    (result.state.finalValidationErrors || []).includes(REPEAT_MSG),
    `c1-neg: finalValidationErrors carries the repeat error (got ${JSON.stringify(result.state.finalValidationErrors)})`
  );
}

/* ------------------------------------------------------------------ */
/* (c2) Stored-itinerary path — real finalizeCompletedStagedGeneration */
/* ------------------------------------------------------------------ */

console.log("(c2) Stored-itinerary path — finalizeCompletedStagedGeneration (fake Supabase) + email-selection core");
console.log("  BOUNDARY: sendStagedGenerationEmail builds its own admin client; locally it returns one");
console.log("  skipped result and sends nothing. completionKind is internal to the function, so it is");
console.log("  proven via its exact deciding call (payloadFromTrip + validateItineraryForProduction),");
console.log("  the function's own not-ready diagnostic, one email result, and one finalize RPC per call.");

ok(assembledFinalDoc, "c2: assembled final doc from the zero-engine drive is available as the stored doc");
eq(assembledFinalDoc.generation_note, ZERO_ENGINE_GENERATION_NOTE, "c2: stored doc carries the honest zero-engine generation note");
eq(isFinalStoredItinerary(assembledFinalDoc, "zero-engine"), true, "c2: isFinalStoredItinerary accepts the stored doc (source + note agree)");

const TRIP_ID = "trip-v1-stored";
const tripRow = {
  id: TRIP_ID,
  user_id: USER_ID,
  metadata: {
    planning: {
      tripType: "single_destination",
      origin: "",
      destination: fixture.destination,
      destinationCity: fixture.destination,
      startDate: fixture.startDate,
      endDate: fixture.endDate,
      daysCount: fixture.days.length
    },
    generationEmail: { tripId: TRIP_ID, email_me_when_ready: true }
  },
  status: "generating",
  itinerary_status: "generating",
  itinerary_locked: false,
  itinerary_locked_at: null,
  itinerary_generated_at: null,
  itinerary_unlock_source: "paid",
  itinerary_payment_status: null
};

function makeFakeSupabase(storedDoc) {
  const calls = { rpc: [] };
  class FakeQuery {
    constructor(table) {
      this.table = table;
    }
    select() { return this; }
    eq() { return this; }
    not() { return this; }
    order() { return this; }
    limit() { return this; }
    or() { return this; }
    update() { return this; }
    async maybeSingle() {
      if (this.table === "roamly_trips") return { data: clone(tripRow), error: null };
      return { data: null, error: null };
    }
    then(resolve, reject) {
      if (this.table === "roamly_itineraries") {
        return Promise.resolve({
          data: [{ id: "itin-v1-1", full_json: clone(storedDoc), updated_at: new Date().toISOString(), source: "zero-engine" }],
          error: null
        }).then(resolve, reject);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    }
  }
  return {
    calls,
    from(table) {
      return new FakeQuery(table);
    },
    async rpc(name) {
      calls.rpc.push(name);
      return { data: true, error: null };
    }
  };
}

async function runStoredFinalization(storedDoc) {
  const fake = makeFakeSupabase(storedDoc);
  const logs = [];
  const originalInfo = console.info;
  console.info = (...args) => {
    logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    const result = await finalizeCompletedStagedGeneration({
      supabase: fake,
      tripId: TRIP_ID,
      userId: USER_ID,
      state: null,
      source: "v1-finalization-checks"
    });
    return { fake, logs, result };
  } finally {
    console.info = originalInfo;
  }
}

// The exact email-selection core finalizeCompletedStagedGeneration runs:
// payloadFromTrip(trip) + validateItineraryForProduction(stored, payload);
// completionKind starts "completion" and becomes "failure" iff !ok.
function emailSelectionKind(storedDoc) {
  const selPayload = payloadFromTrip(clone(tripRow));
  const readiness = validateItineraryForProduction(clone(storedDoc), selPayload);
  return { kind: readiness.ok ? "completion" : "failure", readiness };
}

{
  const { kind, readiness } = emailSelectionKind(assembledFinalDoc);
  eq(readiness.ok, true, `c2: email-selection readiness over the stored Quebec doc is ok:true (errors: ${JSON.stringify(readiness.errors)})`);
  eq(kind, "completion", 'c2: email-selection core yields completionKind "completion" for the valid stored doc');

  const { fake, logs, result } = await runStoredFinalization(assembledFinalDoc);
  eq(result.ok, true, `c2: finalizeCompletedStagedGeneration returns ok:true (got ${JSON.stringify({ ok: result.ok, error: result.error || null })})`);
  eq(result.recoveredFromStoredItinerary, true, "c2: finalization recovered the stored itinerary");
  ok(result.email && !Array.isArray(result.email), "c2: exactly one email result object was produced (a single sendStagedGenerationEmail call)");
  eq(result.email.status, "skipped", "c2: the single email attempt is the local skipped result (no admin client configured — transport boundary, see header)");
  ok(
    !logs.some((l) => l.includes("staged_generation_stored_itinerary_not_ready")),
    "c2: NO stored-itinerary-not-ready diagnostic — the completion kind was not downgraded"
  );
  eq(JSON.stringify(fake.calls.rpc), JSON.stringify(["roamly_finalize_generation_trip"]), "c2: exactly one finalize RPC ran (roamly_finalize_generation_trip)");
}
{
  const stripped = clone(assembledFinalDoc);
  const seed = findSeed(stripped, "Parc de l'Unesco", 12);
  delete seed.repeat;
  delete seed.firstDay;
  delete seed.kind;

  const { kind, readiness } = emailSelectionKind(stripped);
  eq(readiness.ok, false, "c2-neg: email-selection readiness over the stamp-stripped doc fails");
  ok(readiness.errors.includes(REPEAT_MSG), `c2-neg: readiness errors carry the repeat error (got ${JSON.stringify(readiness.errors)})`);
  eq(kind, "failure", 'c2-neg: email-selection core yields completionKind "failure" for the stripped doc');

  const { fake, logs, result } = await runStoredFinalization(stripped);
  eq(result.ok, true, "c2-neg: finalizeCompletedStagedGeneration still completes the trip finalization itself");
  ok(result.email && !Array.isArray(result.email), "c2-neg: exactly one email result object was produced (the failure-kind send)");
  ok(
    logs.some((l) => l.includes("staged_generation_stored_itinerary_not_ready")),
    "c2-neg: the function's own not-ready diagnostic fired — completionKind was downgraded to failure inside the real function"
  );
  eq(JSON.stringify(fake.calls.rpc), JSON.stringify(["roamly_finalize_generation_trip"]), "c2-neg: exactly one finalize RPC ran");
}

// assembleEngineItinerary is exercised directly as part of (c1)'s real
// stage; keep a direct reference so a rename breaks this suite loudly.
eq(typeof assembleEngineItinerary, "function", "c: assembleEngineItinerary remains exported from generate.ts");

console.log(`\nV1 finalization checks: ${count} assertions passed.`);
