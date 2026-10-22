import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { FRAMES, FRAME_COUNT, newComposerState, composeDay, buildStoryState, annotateNarrative } from "@/lib/roamly/engine/frames.ts";
import { solveTrip, solveEveningRemainder } from "@/lib/roamly/engine/solver.ts";
import { buildCalendar, buildMoveDay } from "@/lib/roamly/engine/pacing.ts";
import { scoreStays, estimateTransport } from "@/lib/roamly/engine/anchors.ts";
import { partyProfile, BASE_PROFILE } from "@/lib/roamly/engine/journey.ts";
import { extractConstraints, specConstraints, agreementReport, gradeRequirements, constraintsFromStructured } from "@/lib/roamly/engine/understand.ts";
import { judgeTrip } from "@/lib/roamly/engine/judges.ts";
import { judgeBudget, priceEvidence } from "@/lib/roamly/engine/prices.ts";
import { buildPredictions, fitScore } from "@/lib/roamly/engine/predict.ts";
import { auditTrip } from "@/lib/roamly/engine/emotion.ts";
import { buildTripArc, buildCommitmentLedger, reconcileLedger, rehomeCommitment, judgeContinuity, peakScoresFromDays } from "@/lib/roamly/engine/continuity.ts";
import { buildAfternoonOptions, applyEarlyCheckIn, applyLateCheckIn } from "@/lib/roamly/engine/reflow.ts";
import { createLibraryStore, runCheckpoint, calibrate, proposeBias } from "@/lib/roamly/engine/budgetVsReal.ts";
import { fmt, isoPlus, parseHhmm, mealNameFor } from "@/lib/roamly/engine/util.ts";
import { contentId, itineraryItemId, predictionId } from "@/lib/roamly/engine/ids.ts";
import { parseBudgetVsRealComparisonDTO, parseTripPlanDocumentDTO, parsePredictionRecordDTO } from "@/lib/roamly/engine/types.ts";

// Phase 2 golden tests (DESIGN-PRODUCTION.md Phase 2 proof):
// BEHAVIORAL PARITY — the TS domain core must REPRODUCE the shadow
// zero-engine's frozen outputs for the fixture inputs (Quebec graded
// trip incl. AT RISK verdict + predictions, the 8-destination
// breadth verdicts, every proof scenario, Budget-vs-Real
// BEFORE/DURING/AFTER incl. the AT RISK -> OVER re-grade).
// Fixtures live under scripts/fixtures/wiring-phase2/ (captured by
// capture-phase2-fixtures.mjs); no shadow code is imported here.
// Named divergences (each asserted explicitly, never silent):
//   D1 mustSeeResults carry itemKey (stable-ID ledger, design) —
//      parity compares with itemKey stripped, then asserts it.
//   D2 predictions budgetPosture.cap.verdict — the shadow posture
//      holds the itinerary budgetCap OBJECT BY REFERENCE and the
//      engine glue rewrites its verdict after predictions are built;
//      parity compares every posture field except that string, then
//      asserts the string equals the glue's formula.
//   D3 Quebec google enrichment fetchedAt/refreshDue are wall-clock
//      stamps of the enrichment run (collector domain, Phase 3) —
//      normalized out of the item comparison; every other google
//      field compares exactly.
//   D4 items carry no `affiliate` (engine glue, post-judge attach)
//      and priceEvidence is attached by a separate engine pass —
//      both compared separately, not as solver output.

const FIXTURES = new URL("./fixtures/wiring-phase2/", import.meta.url);
const PHASE1 = new URL("./fixtures/wiring-phase1/", import.meta.url);
const load = (name, base = FIXTURES) => JSON.parse(readFileSync(new URL(name, base), "utf8"));
const loadData = (name, base) => load(name, base).data;

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}
const canon = (x) =>
  JSON.stringify(x, (k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );
function eqC(actual, expected, label) {
  count += 1;
  const a = canon(actual), b = canon(expected);
  assert.equal(a, b, `${label}\n  TS:     ${String(a).slice(0, 400)}\n  FROZEN: ${String(b).slice(0, 400)}`);
}
function legsEq(actual, expected, label) {
  eqC((actual || []).map((g) => [g.leg, g.status]), (expected || []).map((g) => [g.leg, g.status]), label);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const packOf = (destination) => loadData(`packs/pack-${slug(destination)}.json`);
const weatherByDateOf = (pack) => Object.fromEntries(pack.weather.map((w) => [w.date, w]));
const mustSeesOf = (entry) => (entry.checks || []).filter((c) => c.kind === "keyword").map((c) => ({ id: c.id, label: c.label, patterns: c.patterns }));
const EARLIEST = 9 * 60;

/* engine.mjs daysOut serialization (affiliate + the glue-attached
 * priceEvidence are stripped from frozen items — divergence D4). */
function engineDaysOut(plan, pack) {
  const candByKey = new Map([...pack.sights, ...pack.foods, ...pack.stays, ...pack.excursions, ...pack.transport].map((c) => [c.key, c]));
  return plan.days.map((day) => ({
    dayNumber: day.dayNumber, date: day.date, role: day.role,
    items: day.items.map((i) => {
      const out = { ...i, startTime: fmt(i.start), endTime: fmt(i.end) };
      const g = candByKey.get(i.key)?.google;
      if (g) {
        out.google = { source: g.source, priceLevel: g.priceLevel, priceBandNote: "band only — never an exact price", rating: g.rating, userRatingCount: g.userRatingCount, wheelchairEntrance: g.wheelchairEntrance, businessStatus: g.businessStatus, fetchedAt: g.fetchedAt, refreshDue: g.refreshDue };
        if (g.priceLevel) out.priceBand = { level: g.priceLevel, source: g.source };
      }
      return out;
    }),
    legs: day.legs.map((l) => ({ ...l, km: +l.km.toFixed(2), departTime: fmt(l.depart), arriveTime: fmt(l.arrive) })),
    narrative: day.narrative, endMin: day.endMin
  }));
}
const stripItem = (i) => {
  if (!i) return i;
  const rest = { ...i };
  delete rest.affiliate;
  delete rest.priceEvidence;
  if (rest.google) { const g = { ...rest.google }; delete g.fetchedAt; delete g.refreshDue; rest.google = g; } // D3
  return rest;
};
const stripMs = (list) => (list || []).map((m) => { const r = { ...m }; delete r.itemKey; return r; }); // D1

/* ------------------------------------------------------------------ */
/* A. Frame library + transport redesign                               */
/* ------------------------------------------------------------------ */
{
  eq(FRAME_COUNT, 79, "frame library size is the shadow's 79 (the brief's 74 was wrong vs the shadow)");
  eqC(Object.keys(FRAMES).sort(), loadData("frame-keys.json"), "frame key set identical to the shadow's");
}
{
  const shadow = loadData("transport-shadow.json");
  const a = shadow.assumptions;
  const est = estimateTransport({
    originLabel: "Saint John, NB", destinationLabel: "Quebec City, QC", tripDays: 5,
    roadDistanceKm: a.roadDistanceKm, driveHoursDoorToDoor: a.driveHoursDoorToDoor,
    fuelPer100Km: a.fuelPer100Km, fuelPricePerL: a.fuelPricePerL,
    parkingPerDay: a.parkingPerDay, parkingDays: a.parkingDays,
    flightFarePerPerson: a.flightFarePerPerson, flightHoursDoorToDoor: a.flightHoursDoorToDoor,
    airportTransfersTotal: a.airportTransfersTotal, travelers: a.travelers,
    valueOfTimePerHourPerPerson: a.valueOfTimePerHourPerPerson
  });
  eqC(est, shadow, "REDESIGNED transport service reproduces the shadow argument on the shadow's own assumptions");
  // Parameterization proof: different party/distance — value-of-time
  // dominates and the verdict flips; a near-tie emits BOTH options.
  const mk = (over) => estimateTransport({
    originLabel: "A", destinationLabel: "B", tripDays: 3,
    roadDistanceKm: { value: 200, basis: "t" }, driveHoursDoorToDoor: { value: 3, basis: "t" },
    fuelPer100Km: { value: 8, basis: "t" }, fuelPricePerL: { value: 1.5, basis: "t" },
    parkingPerDay: { value: 10, basis: "t" }, parkingDays: { value: 3, basis: "t" },
    flightFarePerPerson: { value: 120, basis: "t" }, flightHoursDoorToDoor: { value: 2.5, basis: "t" },
    airportTransfersTotal: { value: 40, basis: "t" }, travelers: { value: 1, basis: "t" },
    valueOfTimePerHourPerPerson: { value: 25, basis: "t" }, ...over
  });
  const close = mk({});
  eq(close.drive.money, 54, "parameterized drive money = fuel 24 + parking 30");
  eq(close.flight.money, 160, "parameterized flight money = fare 120 + transfers 40");
  eq(close.drive.effectiveCost, 129, "drive effective = 54 + 3h x $25 x 1");
  eq(close.flight.effectiveCost, 222.5, "flight effective = 160 + 2.5h x $25 x 1");
  eq(close.bothOptionsEmitted, false, "gap 93.5 > 20% of 222.5 -> not close");
  const tie = mk({ valueOfTimePerHourPerPerson: { value: 200, basis: "t" } });
  eq(tie.bothOptionsEmitted, true, "at $200/h the effective costs land within 20% -> BOTH options emitted");
  eq(tie.verdict, "CLOSE — both options emitted for the traveler to choose", "close verdict string");
}

/* ------------------------------------------------------------------ */
/* B. The 8-destination engine pipeline (engine.mjs parity)            */
/* ------------------------------------------------------------------ */
const scenarios = loadData("scenarios.json");
const phase1Breadth = loadData("engine-budget-verdicts.json", PHASE1).trips;
const runs = {}; // poolId -> { plan, daysOut, pred, entry, pack }
for (const sc of scenarios) {
  const entry = sc.entry;
  const pack = sc.enrichmentMode === "fixture" ? loadData("packs/pack-quebec-city-enriched.json") : packOf(entry.destination);
  const frozen = load(`frozen/${entry.id}/itinerary.json`);
  const frozenGrades = load(`frozen/${entry.id}/grades.json`);
  const frozenPred = load(`frozen/${entry.id}/predictions.json`);
  const dates = Array.from({ length: entry.days }, (_, i) => isoPlus(sc.startDate, i));

  const extracted = extractConstraints(sc.requestText);
  const truth = specConstraints(entry);
  eqC(agreementReport(extracted, truth), frozenGrades.agreement, `${entry.id}: extractor agreement rows`);
  eqC(extracted.unresolved, (frozenGrades.unresolved || []).filter((u) => u.startsWith("extractor: ")).map((u) => u.slice(11)), `${entry.id}: extractor unresolved lines`);

  const stays = scoreStays(pack);
  const anchorStay = stays[0] || null;
  eq(anchorStay?.name, frozen.anchorStay?.name, `${entry.id}: scoreStays top anchor`);
  const basePos = anchorStay?.pos || (entry.coordinates && { lat: entry.coordinates.latitude, lon: entry.coordinates.longitude });
  const baseName = anchorStay ? anchorStay.name : `${entry.destination} centre (base anchor)`;
  const earliestMin = parseHhmm(extracted.earliestStart || truth.earliestStart || "09:00");
  const restSpec = extracted.rest || truth.rest;
  const plan = solveTrip(pack, { days: entry.days, startIso: sc.startDate, dates, earliestMin, restSpec, mustSees: mustSeesOf(entry), basePos, baseName });

  const state = newComposerState();
  const ctx = { earliestLabel: truth.earliestStart || "09:00", stay: anchorStay ? { name: anchorStay.name, walkableSights: anchorStay.walkableSights } : null, weatherByDate: weatherByDateOf(pack), baseName, hasDietary: (truth.dietary || []).length > 0 };
  for (const day of plan.days) day.narrative = composeDay(day, ctx, state);
  const daysOut = engineDaysOut(plan, pack);

  for (let d = 0; d < daysOut.length; d++) {
    eqC(daysOut[d].items.map(stripItem), frozen.days[d].items.map(stripItem), `${entry.id} day ${d + 1}: items`);
    eqC(daysOut[d].legs, frozen.days[d].legs, `${entry.id} day ${d + 1}: legs`);
    eqC(daysOut[d].narrative, frozen.days[d].narrative, `${entry.id} day ${d + 1}: narrative (composed voice, verbatim)`);
    eq(daysOut[d].role, frozen.days[d].role, `${entry.id} day ${d + 1}: role`);
    eq(daysOut[d].endMin, frozen.days[d].endMin, `${entry.id} day ${d + 1}: endMin`);
  }
  eqC(stripMs(plan.mustSeeResults), frozen.mustSeeResults, `${entry.id}: must-see results`);
  for (const m of plan.mustSeeResults) {
    ok(typeof m.itemKey === "string" || m.status !== "scheduled", `${entry.id}: scheduled must-see ${m.id} carries its stable itemKey (D1)`);
    if (m.status === "scheduled") {
      const day = plan.days[m.day - 1];
      ok(day.items.some((i) => i.key === m.itemKey && i.name === m.item), `${entry.id}: itemKey of ${m.id} names the scheduled item`);
    }
  }
  eqC(plan.notes, frozen.solverNotes, `${entry.id}: solver notes`);

  const verdicts = gradeRequirements({ days: daysOut.map((d) => ({ ...d, narrative: d.narrative.join("\n") })) }, truth, entry.checks);
  eqC(verdicts, frozenGrades.verdicts, `${entry.id}: requirement verdicts`);
  const judge = judgeTrip(plan.days, { earliestMin });
  eqC({ pass: judge.pass, hardViolations: judge.hardViolations, warnings: judge.warnings }, { pass: frozenGrades.judge.pass, hardViolations: frozenGrades.judge.hardViolations, warnings: frozenGrades.judge.warnings }, `${entry.id}: make-sense judge`);
  const tsLegs = [
    ...verdicts.map((v) => ({ leg: `request:${v.id}`, status: v.verdict === "KEPT" ? "DONE" : v.verdict })),
    { leg: "judges:make-sense", status: judge.pass ? "DONE" : "NOT DONE" },
    { leg: "engine:must-sees", status: plan.mustSeeResults.every((m) => m.status === "scheduled") ? "DONE" : "NOT DONE" },
    { leg: "engine:extractor-agreement", status: agreementReport(extracted, truth).every((a) => a.agree) ? "DONE" : "NOT DONE" }
  ];
  for (const tl of tsLegs) {
    const fl = frozenGrades.grades.find((g) => g.leg === tl.leg);
    ok(fl && fl.status === tl.status, `${entry.id}: grade leg ${tl.leg} = ${tl.status}`);
  }

  const itineraryLike = { days: daysOut, travelers: entry.travelers, budgetCap: { amount: entry.budgetAmount, currency: entry.budgetCurrency, verdict: "" }, destination: entry.destination };
  // ALL-IN scope (owner decision, 2026-10-22): PREDICT receives the
  // anchor-stay lodging input exactly as the production seam does
  // (generate.ts passes run.anchor the same way). The recorded packs
  // carry no stay price band, so lodging grades UNKNOWN here — named,
  // excluded, and coverage is computed over the all-in scope lines.
  const pred = buildPredictions(itineraryLike, pack, {
    now: frozenPred.recordedAt,
    scope: {
      lodging: anchorStay
        ? {
            name: anchorStay.name,
            candidateKey: anchorStay.key,
            nights: entry.days - 1,
            priceBandLevel: anchorStay.google?.priceLevel ?? null,
            priceBandSource: anchorStay.google ? "google" : null
          }
        : null,
      transport: null
    }
  });
  const { budgetPosture: tsPosture, ...tsPredRest } = pred;
  const { budgetPosture: frPosture, ...frPredRest } = frozenPred;
  eqC(tsPredRest, frPredRest, `${entry.id}: predictions (highlights, risks, pace load, learn contract)`);
  const { cap: tsCap, ...tsPostureRest } = tsPosture;
  const { cap: frCap, ...frPostureRest } = frPosture;
  eqC(tsPostureRest, frPostureRest, `${entry.id}: budget posture (verdict, totals, coverage, tiers)`);
  eqC({ amount: tsCap.amount, currency: tsCap.currency }, { amount: frCap.amount, currency: frCap.currency }, `${entry.id}: posture cap amount/currency`);
  const glueVerdict = tsPosture.verdict === "UNVERIFIABLE" ? `UNVERIFIABLE — ${tsPosture.note}` : `${tsPosture.verdict} — ${tsPosture.note} (scope: all-in — plan-priced items + lodging + getting-there; evidence ESTIMATED unless VERIFIED)`;
  eq(frCap.verdict, glueVerdict, `${entry.id}: posture cap.verdict equals the engine glue's rewrite (D2)`);
  eq(frozen.budgetCap.verdict, glueVerdict, `${entry.id}: itinerary budgetCap verdict string`);
  {
    const fl = frozenGrades.grades.find((g) => g.leg === "prices:budget");
    const tsStatus = tsPosture.verdict === "UNVERIFIABLE" ? "UNVERIFIABLE" : "DONE";
    ok(fl && fl.status === tsStatus, `${entry.id}: grade leg prices:budget = ${tsStatus}`);
    const compPhrase = (c) => (!c ? "not in scope" : !c.applicable ? "not applicable (day trip)" : c.evidenced ? `evidenced (${c.evidence.tier})` : "not evidenced");
    const lodLine = tsPosture.components.find((c) => c.component === "lodging");
    const traLine = tsPosture.components.find((c) => c.component === "transport");
    ok(fl && fl.detail === `${tsPosture.verdict} — evidence covers ${tsPosture.evidencedScopeLines}/${tsPosture.scopeLines} all-in scope lines (${Math.round(tsPosture.coverage * 100)}%): ${tsPosture.pricedItems} priced plan items + lodging + getting-there; lodging ${compPhrase(lodLine)}; getting-there ${compPhrase(traLine)}; estimated all-in total ${tsPosture.estimatedTotals.currency} ${tsPosture.estimatedTotals.low}–${tsPosture.estimatedTotals.high} vs cap ${entry.budgetCurrency} ${entry.budgetAmount}; tiers ${JSON.stringify(tsPosture.evidenceByTier)}`, `${entry.id}: prices:budget grade detail text`);
  }
  let peDiffs = 0;
  for (let d = 0; d < daysOut.length; d++)
    for (let i = 0; i < daysOut[d].items.length; i++)
      if (canon(priceEvidence(daysOut[d].items[i]) ?? null) !== canon(frozen.days[d].items[i].priceEvidence ?? null)) peDiffs += 1;
  eq(peDiffs, 0, `${entry.id}: per-item priceEvidence ladder records`);

  /* Breadth cross-check against the Phase 1 golden fixture */
  const brow = phase1Breadth.find((r) => r.tripRef === entry.id);
  ok(!!brow, `${entry.id}: present in the Phase 1 breadth fixture`);
  eq(tsPosture.verdict, brow.budgetVerdict, `${entry.id}: breadth budget verdict (${brow.budgetVerdict})`);
  eq(tsPosture.coverage, brow.budgetCoverage, `${entry.id}: breadth budget coverage`);
  eq(judge.pass ? "PASS" : "FAIL", brow.makeSense, `${entry.id}: breadth make-sense`);
  const prof = partyProfile(entry, entry.request?.party || "");
  const emo = auditTrip(daysOut, { profile: prof });
  const emoText = emo.hard ? `FAIL (${emo.hard} hard: ${emo.findings.filter((f) => f.severity === "hard").map((f) => f.check).join(", ")})` : `PASS (${emo.findings.length} findings, ${emo.soft} soft)`;
  eq(emoText, brow.emotion, `${entry.id}: breadth emotion verdict`);
  const arcB = buildTripArc({ types: daysOut.map((d) => d.dayType || "FULL"), peakScoreByDay: peakScoresFromDays(daysOut), envelopeDeparture: daysOut.some((d) => d.envelope?.departure) });
  const ledgerB = reconcileLedger(buildCommitmentLedger(daysOut, { mustSeeResults: plan.mustSeeResults }), daysOut);
  const contB = judgeContinuity(daysOut, { arc: arcB, ledger: ledgerB });
  eq(contB.pass ? "PASS" : "FAIL", brow.continuity, `${entry.id}: breadth continuity verdict`);

  runs[entry.id] = { plan, daysOut, pred, entry, pack, truth };
}

/* ------------------------------------------------------------------ */
/* C. Quebec DTO parity — the TS core's outputs, converted with the    */
/*    Phase 1 capture's own conversions, must equal the Phase 1        */
/*    golden DTOs byte-for-byte (canonically).                         */
/* ------------------------------------------------------------------ */
{
  const { plan, daysOut, pred, entry } = runs["quebec-city-family"];
  const frozenIt = load("frozen/quebec-city-family/itinerary.json");
  const phase1 = loadData("engine-trip-quebec-city.json", PHASE1);
  const convertPriceEvidence = (pe) => {
    if (!pe) return null;
    const per = pe.per ?? pe.range?.per ?? "person";
    return { tier: pe.tier, category: pe.category, range: pe.range ? { low: pe.range.low, high: pe.range.high, currency: pe.range.currency, per } : null, per, basis: pe.basis ?? "" };
  };
  const verdictEnum = (text) => {
    if (!text) return null;
    const m = /^(WITHIN|AT RISK|OVER|UNVERIFIABLE)/.exec(String(text).trim());
    return m ? m[1] : null;
  };
  // Attach the glue priceEvidence pass, exactly as engine.mjs does.
  const daysWithEv = daysOut.map((d) => ({
    ...d,
    items: d.items.map((i) => { const ev = priceEvidence(i); return ev ? { ...i, priceEvidence: ev } : i; })
  }));
  const travelers = { adults: entry.travelers.adults ?? 0, children: entry.travelers.children ?? 0, infants: entry.travelers.infants ?? 0 };
  const tripId = contentId("trip", ["quebec-city", frozenIt.startDate, frozenIt.endDate, `${travelers.adults}a${travelers.children}c${travelers.infants}i`]);
  const destinationId = contentId("dest", [frozenIt.destination, frozenIt.country]);
  const packVersionId = contentId("pack", [frozenIt.destination, frozenIt.startDate, entry.id ?? ""]);
  const posture = pred.budgetPosture;
  const itemIdByDayName = new Map();
  const days = daysWithEv.map((day) => {
    const items = day.items.map((item) => {
      const candidateKey = item.key ? `osm:${item.key}` : null;
      const itemId = itineraryItemId({ tripId, dayNumber: day.dayNumber, candidateSourceKey: candidateKey, bookingReference: null, startMin: item.start ?? 0 });
      itemIdByDayName.set(`${day.dayNumber}|${item.name}`, itemId);
      return {
        itemId, candidateKey, type: item.type ?? "stop", kind: item.kind ?? null,
        name: item.name ?? item.type ?? "item", startMin: item.start ?? 0, endMin: item.end ?? item.start ?? 0,
        pos: item.pos ? { lat: item.pos.lat, lon: item.pos.lon } : null, bookingReference: null,
        priceEvidence: convertPriceEvidence(item.priceEvidence),
        provenance: { source: "osm", sourceRef: item.url ?? candidateKey, recordedAt: frozenIt.generatedAt ?? null, label: "zero-engine candidate" }
      };
    });
    return { dayId: contentId("day", [tripId, String(day.dayNumber)]), dayNumber: day.dayNumber, date: day.date, role: day.role ?? "standard", items, endMin: day.endMin ?? null };
  });
  const anchorStay = scoreStays(runs["quebec-city-family"].pack)[0];
  const anchorNode = /openstreetmap\.org\/(node\/\d+)/.exec(anchorStay?.url ?? "");
  const dtoPlan = {
    schemaVersion: 1, tripId, destinationId, destinationName: frozenIt.destination, country: frozenIt.country,
    timeZone: "America/Toronto", startDate: frozenIt.startDate, endDate: frozenIt.endDate, travelers, days,
    budgetCap: { amount: entry.budgetAmount, currency: entry.budgetCurrency, verdict: verdictEnum(posture.verdict), verdictNote: posture.note ?? null },
    anchorStay: { name: anchorStay.name, candidateKey: anchorNode ? `osm:${anchorNode[1]}` : null },
    source: "zero-engine", packVersionId,
    policyVersions: { pricePolicy: "prices-2", extractor: "recon-canonical-1" },
    provenance: { source: "zero-engine", sourceRef: "zero-engine-2026-10-21/trips/quebec-city-family/itinerary.json", recordedAt: frozenIt.generatedAt ?? null, label: "shadow zero-engine graded trip (Quebec City, 5 days)" }
  };
  eqC(dtoPlan, phase1.plan, "Quebec: TS core -> TripPlanDocumentDTO equals the Phase 1 golden DTO");
  const parsedPlan = parseTripPlanDocumentDTO(dtoPlan);
  ok(parsedPlan.ok, "Quebec: converted plan passes the Phase 1 DTO parser");

  const matchItem = (day, name) => itemIdByDayName.get(`${day}|${name}`) ?? contentId("item", [tripId, String(day), name]);
  const dtoPrediction = {
    predictionId: predictionId({ tripId, packVersionId }), tripId, recordedAt: pred.recordedAt,
    highlights: pred.highlights.map((h) => ({ itemRef: matchItem(h.day, h.name), name: h.name, day: h.day, score: h.score, reasons: h.reasons ?? [] })),
    risks: pred.risks.map((r) => ({ riskRef: contentId("risk", [tripId, String(r.day), r.item ?? "", r.risk ?? ""]), itemRef: r.item ? matchItem(r.day, r.item) : null, kind: r.severity ?? "noted", note: r.risk ?? "" })),
    budgetPosture: {
      verdict: verdictEnum(posture.verdict) ?? "UNVERIFIABLE", note: posture.note ?? "",
      cap: posture.cap ? { amount: posture.cap.amount, currency: posture.cap.currency } : null,
      coverage: posture.coverage ?? 0, coverageThreshold: posture.coverageThreshold ?? 0.5,
      pricedItems: posture.pricedItems ?? 0, evidencedItems: posture.evidencedItems ?? 0,
      evidenceByTier: posture.evidenceByTier ?? {},
      estimatedTotals: posture.estimatedTotals ? { low: posture.estimatedTotals.low, high: posture.estimatedTotals.high, currency: posture.estimatedTotals.currency ?? "CAD", per: "party" } : null,
      scopeNote: "All-in scope (owner decision, 2026-10-22): plan-priced items (meals, admissions, crossings) + lodging + getting-there, each priced from labeled evidence (bands and cost models are ESTIMATED ranges, never point prices); a component with no evidence is named and excluded from the totals — never counted as zero. This trip: lodging not evidenced; getting-there not evidenced."
    },
    paceLoad: pred.paceLoad ?? null, grades: null
  };
  eqC(dtoPrediction, phase1.prediction, "Quebec: TS core -> PredictionRecordDTO equals the Phase 1 golden DTO");
  ok(parsePredictionRecordDTO(dtoPrediction).ok, "Quebec: converted prediction passes the Phase 1 DTO parser");
  void plan;
}

/* ------------------------------------------------------------------ */
/* D. Pacing proofs — 14d single base + 12d two-base with MOVE seam    */
/* ------------------------------------------------------------------ */
const proofDays = (days) => days.map((day) => ({
  dayNumber: day.dayNumber, date: day.date, role: day.role, dayType: day.dayType,
  items: day.items.map((i) => ({ ...i, startTime: fmt(i.start), endTime: fmt(i.end) })),
  legs: day.legs.map((l) => ({ ...l, km: +l.km.toFixed(2), departTime: fmt(l.depart), arriveTime: fmt(l.arrive) })),
  ideas: day.ideas || [], narrative: day.narrative || [], endMin: day.endMin
}));
const qcEntry = scenarios.find((s) => s.entry.id === "quebec-city-family").entry;
const hxEntry = scenarios.find((s) => s.entry.id === "halifax-coastal").entry;
{
  const pack = packOf("Quebec City");
  const anchor = scoreStays(pack)[0];
  const startIso = "2026-10-24";
  const dates = Array.from({ length: 14 }, (_, i) => isoPlus(startIso, i));
  const cal = buildCalendar({ totalDays: 14, bases: [{ name: "Quebec City", days: 14 }], restSpec: { type: "afternoon" } });
  const plan = solveTrip(pack, { days: 14, startIso, dates, earliestMin: EARLIEST, restSpec: null, mustSees: mustSeesOf(qcEntry), basePos: anchor.pos, baseName: anchor.name, calendar: cal.days, relaxFavorites: cal.relaxFavorites });
  const ctx = { earliestLabel: "09:00", stay: { name: anchor.name, walkableSights: anchor.walkableSights }, weatherByDate: weatherByDateOf(pack), baseName: anchor.name, hasDietary: true };
  const state = newComposerState();
  for (const day of plan.days) day.narrative = composeDay(day, ctx, state);
  const frozenIt = load("frozen/pacing-quebec-14d/itinerary.json");
  const frozenCal = load("frozen/pacing-quebec-14d/calendar.json");
  const frozenGrades = load("frozen/pacing-quebec-14d/grades.json");
  eqC(proofDays(plan.days), frozenIt.days, "pacing A: 14 days reproduced (items, legs, ideas, narrative)");
  eqC({ counts: cal.counts, relaxFavorites: cal.relaxFavorites, notes: cal.notes, days: cal.days }, frozenCal, "pacing A: calendar reproduced");
  eqC(plan.arc.types, frozenIt.effectiveTypes ?? frozenIt.days.map((d) => d.dayType), "pacing A: effective day types");
  legsEq(
    (() => { const j = judgeTrip(plan.days, { earliestMin: EARLIEST }); return [{ leg: "judges:make-sense", status: j.pass ? "DONE" : "NOT DONE" }]; })(),
    frozenGrades.grades.filter((g) => g.leg === "judges:make-sense"),
    "pacing A: make-sense grade"
  );
  for (const g of frozenGrades.grades) ok(["DONE", "NOT DONE", "NOT DEMONSTRATED"].includes(g.status), `pacing A: frozen grade ${g.leg} recorded (${g.status})`);
  const rhythmOk = [cal.days.slice(0, 7), cal.days.slice(7, 14)].every((w) => ["FULL", "LIGHT", "OPEN", "REST"].map((t) => w.filter((d) => d.type === t).length).join(",") === "3,2,1,1");
  ok(rhythmOk, "pacing A: weekly rhythm 3 FULL / 2 LIGHT / 1 OPEN / 1 REST holds in both weeks");
  const fullDays = plan.days.filter((d) => d.dayType === "FULL");
  ok(fullDays.every((d) => d.items.filter((i) => i.type !== "rest").length <= 5), "pacing A: no FULL day over 5 timed items");
  runs.pacingA = { plan, cal, pack, anchor, dates };
}
{
  const qcPack = packOf("Quebec City");
  const hxPack = packOf("Halifax");
  const qcAnchor = scoreStays(qcPack)[0];
  const hxAnchor = scoreStays(hxPack)[0];
  const cal = buildCalendar({ totalDays: 12, bases: [{ name: "Quebec City", days: 6 }, { name: "Halifax", days: 5 }] });
  const types = cal.days.map((d) => d.type);
  const qcDates = Array.from({ length: 6 }, (_, i) => isoPlus("2026-10-24", i));
  const hxDates = Array.from({ length: 5 }, (_, i) => isoPlus("2026-10-31", i));
  const qcPlan = solveTrip(qcPack, { days: 6, startIso: qcDates[0], dates: qcDates, earliestMin: EARLIEST, restSpec: null, mustSees: mustSeesOf(qcEntry), basePos: qcAnchor.pos, baseName: qcAnchor.name, calendar: types.slice(0, 6), relaxFavorites: false });
  const qcCtx = { earliestLabel: "09:00", stay: { name: qcAnchor.name, walkableSights: qcAnchor.walkableSights }, weatherByDate: weatherByDateOf(qcPack), baseName: qcAnchor.name, hasDietary: true };
  const qcState = newComposerState();
  for (const day of qcPlan.days) day.narrative = composeDay(day, qcCtx, qcState);
  const moveDay = buildMoveDay({ dayNumber: 7, date: "2026-10-30", fromName: "Quebec City", toName: "Halifax", arrivalPack: hxPack, arrivalBasePos: hxAnchor.pos, arrivalBaseName: hxAnchor.name, earliestMin: EARLIEST });
  moveDay.narrative = composeDay(moveDay, { earliestLabel: "09:00", weatherByDate: {}, baseName: hxAnchor.name, hasDietary: false, stay: null }, newComposerState());
  const hxPlan = solveTrip(hxPack, { days: 5, startIso: hxDates[0], dates: hxDates, earliestMin: EARLIEST, restSpec: null, mustSees: mustSeesOf(hxEntry), basePos: hxAnchor.pos, baseName: hxAnchor.name, calendar: types.slice(7), relaxFavorites: false });
  const hxCtx = { earliestLabel: "09:00", stay: { name: hxAnchor.name, walkableSights: hxAnchor.walkableSights }, weatherByDate: weatherByDateOf(hxPack), baseName: hxAnchor.name, hasDietary: true };
  const hxState = newComposerState();
  for (const day of hxPlan.days) day.narrative = composeDay(day, hxCtx, hxState);
  for (const day of hxPlan.days) day.dayNumber += 7;
  const allDays = [...qcPlan.days, moveDay, ...hxPlan.days];
  const frozenIt = load("frozen/pacing-quebec-halifax-12d/itinerary.json");
  eqC(proofDays(allDays), frozenIt.days, "pacing B: 12 days incl. the MOVE seam day reproduced");
  eq(types[6], "MOVE", "pacing B: calendar day 7 is the MOVE");
  eq(types[7], "LIGHT", "pacing B: the later base's first day is capped LIGHT");
  ok(moveDay.items.filter((i) => i.type === "stop").every((s) => Math.abs((s.pos?.lat ?? 0) - hxAnchor.pos.lat) < 1 && Math.abs((s.pos?.lon ?? 0) - hxAnchor.pos.lon) < 1), "pacing B: move-day stop sits by the new base");
  runs.pacingB = { qcPlan, hxPlan, moveDay, allDays, cal };
}

/* ------------------------------------------------------------------ */
/* E. Journey envelope proofs — E1 Quebec arrival, E2 Halifax dawn     */
/* ------------------------------------------------------------------ */
const restSpecOf = (entry) => (entry.request?.rest ? { type: /morning/.test(entry.request.rest) ? "morning" : "afternoon", text: entry.request.rest } : null);
function runEnvelope(entry, destination, startIso, journey) {
  const pack = packOf(destination);
  const anchor = scoreStays(pack)[0];
  const dates = Array.from({ length: entry.days }, (_, i) => isoPlus(startIso, i));
  const profile = partyProfile(entry, entry.request?.party || "");
  const plan = solveTrip(pack, { days: entry.days, startIso, dates, earliestMin: EARLIEST, restSpec: restSpecOf(entry), mustSees: mustSeesOf(entry), basePos: anchor.pos, baseName: anchor.name, profile, journey });
  const ctx = { earliestLabel: "09:00", stay: { name: anchor.name, walkableSights: anchor.walkableSights }, weatherByDate: weatherByDateOf(pack), baseName: anchor.name, hasDietary: (entry.request?.dietary || "").length > 0 };
  const state = newComposerState();
  for (const day of plan.days) day.narrative = composeDay(day, ctx, state);
  const judge = judgeTrip(plan.days, { earliestMin: EARLIEST, profile });
  const emotion = auditTrip(plan.days, { profile });
  return { plan, judge, emotion, profile, anchor, pack };
}
const envDays = (days) => days.map((day) => ({
  dayNumber: day.dayNumber, date: day.date, role: day.role, dayType: day.dayType, envelope: day.envelope || null,
  items: day.items.map((i) => ({ ...i, startTime: fmt(i.start), endTime: fmt(i.end) })),
  legs: day.legs.map((l) => ({ ...l, km: +l.km.toFixed(2), departTime: fmt(l.depart), arriveTime: fmt(l.arrive) })),
  ideas: day.ideas || [], narrative: day.narrative || [], endMin: day.endMin
}));
let E1, E2;
{
  E1 = runEnvelope(qcEntry, "Quebec City", "2026-10-24", {
    arrival: { mode: "fly", leaveHomeMin: 8 * 60, toAirportMin: 40, bufferMin: 90, travelMin: 120, transferMin: 35, checkInMin: 14 * 60 + 30, checkInProvenance: "hotel data (scenario fixture — a booked room whose check-in is 14:30)" },
    departure: { flightMin: 16 * 60 + 40, transferMin: 40, bufferMin: 90 }
  });
  const frozenIt = load("frozen/envelope-quebec-arrival/itinerary.json");
  const frozenGrades = load("frozen/envelope-quebec-arrival/grades.json");
  eqC(envDays(E1.plan.days), frozenIt.days, "E1: arrival-envelope days reproduced");
  eqC({ pass: E1.judge.pass, hardViolations: E1.judge.hardViolations, warnings: E1.judge.warnings }, { pass: frozenIt.makeSense.pass, hardViolations: frozenIt.makeSense.hardViolations, warnings: frozenIt.makeSense.warnings }, "E1: make-sense judge");
  eqC(E1.emotion, frozenIt.emotion, "E1: emotion audit");
  {
    const tsLegs = {
      "judges:make-sense": E1.judge.pass ? "DONE" : "NOT DONE",
      "engine:must-sees": E1.plan.mustSeeResults.every((m) => m.status === "scheduled") ? "DONE" : "NOT DONE"
    };
    for (const [leg, status] of Object.entries(tsLegs)) {
      const fl = frozenGrades.grades.find((g) => g.leg === leg);
      ok(fl && fl.status === status, `E1: grade leg ${leg} = ${status}`);
    }
  }
  const d1 = E1.plan.days[0];
  ok(["journey", "checkin", "rest"].every((t) => d1.items.map((i) => i.type).includes(t)), "E1: arrival chain journey -> checkin -> rest present");
  const lunch = d1.items.find((i) => i.type === "food");
  ok(lunch && lunch.end <= d1.envelope.arrival.checkInMin, "E1: lunch sits inside the room wait");
  const d5 = E1.plan.days[4];
  const dep = d5.envelope.departure;
  const transfer = d5.items.find((i) => i.type === "transfer");
  ok(transfer && transfer.start === dep.leaveBaseMin, "E1: departure transfer leaves at leaveBaseMin");
}
{
  E2 = runEnvelope(hxEntry, "Halifax", "2026-10-24", {
    arrival: { mode: "fly", leaveHomeMin: 7 * 60 + 10, toAirportMin: 40, bufferMin: 90, travelMin: 60, transferMin: 35 },
    departure: { flightMin: 7 * 60 + 45, transferMin: 35, bufferMin: 90 }
  });
  const frozenIt = load("frozen/envelope-halifax-dawn/itinerary.json");
  const frozenGrades2 = load("frozen/envelope-halifax-dawn/grades.json");
  eqC(envDays(E2.plan.days), frozenIt.days, "E2: dawn-departure days reproduced");
  {
    const tsLegs = {
      "judges:make-sense": E2.judge.pass ? "DONE" : "NOT DONE",
      "engine:must-sees": E2.plan.mustSeeResults.every((m) => m.status === "scheduled") ? "DONE" : "NOT DONE",
      "envelope:assumed-checkin-labeled": /assumed/.test(E2.plan.days[0].envelope.arrival.checkInProvenance) ? "DONE" : "NOT DONE"
    };
    for (const [leg, status] of Object.entries(tsLegs)) {
      const fl = frozenGrades2.grades.find((g) => g.leg === leg);
      ok(fl && fl.status === status, `E2: grade leg ${leg} = ${status}`);
    }
  }
  eqC(E2.emotion, frozenIt.emotion, "E2: emotion audit");
  const d1 = E2.plan.days[0];
  ok(/assumed/.test(d1.envelope.arrival.checkInProvenance), "E2: assumed check-in is labeled as assumed");
  const d4 = E2.plan.days[3];
  ok(d4.envelope.departure.emptyMorning && d4.items.filter((i) => i.type === "stop" || i.type === "food").length === 0, "E2: dawn flight empties the last morning");
  ok(E2.plan.days[2].items.some((i) => i.type === "pack") && !!E2.plan.days[2].envelope?.windDown, "E2: pack-up sits on the eve with a wind-down envelope");
}

/* ------------------------------------------------------------------ */
/* F. Emotion WS2 — audits over the frozen itineraries + disaster day  */
/* ------------------------------------------------------------------ */
{
  const findings = loadData("frozen/emotion-findings.json");
  const profileFor = (entry) => partyProfile(entry, entry.request?.party || "");
  const DISASTER_DAY = {
    dayNumber: 1, date: "2026-10-23", role: "arrival", dayType: "FULL",
    items: [
      { type: "flight", kind: "flight", name: "Flight AC 9999 to Halifax", start: 13 * 60 + 30, end: 15 * 60 + 20, key: "fixture-flight" },
      { type: "food", kind: "food", name: "Slow Mornings Café & Restaurant", start: 14 * 60 + 25, end: 15 * 60 + 25, key: "fixture-lunch", pos: { lat: 44.6455, lon: -63.5723 } },
      { type: "stop", kind: "attraction", name: "Halifax Citadel", start: 15 * 60 + 35, end: 16 * 60 + 35, key: "fixture-citadel", pos: { lat: 44.6473105, lon: -63.5802776 } },
      { type: "stop", kind: "cruise", name: "Halifax Harbour Evening Cruise", role: "commitment", protected: true, start: 20 * 60 + 30, end: 22 * 60, key: "fixture-cruise" },
      { type: "food", kind: "food", name: "Dinner at Five Guys", start: 21 * 60, end: 22 * 60, key: "fixture-dinner" }
    ],
    legs: []
  };
  const sources = [
    { id: "quebec-city-family", days: load("frozen/quebec-city-family/itinerary.json").days, profile: profileFor(qcEntry) },
    { id: "charlottetown-smalltown", days: load("frozen/charlottetown-smalltown/itinerary.json").days, profile: profileFor(scenarios.find((s) => s.entry.id === "charlottetown-smalltown").entry) },
    { id: "halifax-coastal", days: load("frozen/halifax-coastal/itinerary.json").days, profile: profileFor(hxEntry) },
    { id: "pacing-quebec-14d", days: load("frozen/pacing-quebec-14d/itinerary.json").days, profile: profileFor(qcEntry) },
    { id: "envelope-quebec-arrival", days: load("frozen/envelope-quebec-arrival/itinerary.json").days, profile: E1.profile },
    { id: "envelope-halifax-dawn", days: load("frozen/envelope-halifax-dawn/itinerary.json").days, profile: E2.profile },
    { id: "spike-disaster-day (production mirror)", days: [DISASTER_DAY], profile: profileFor(hxEntry) }
  ];
  for (const src of sources) {
    const res = auditTrip(src.days, { profile: src.profile });
    eqC(res, findings[src.id], `emotion WS2: ${src.id} audit reproduced (verdict, findings, evidence text)`);
  }
  const disaster = auditTrip([DISASTER_DAY], { profile: profileFor(hxEntry) });
  ok(disaster.hard >= 3, `emotion WS2: the disaster day is convicted with >= 3 hard findings (got ${disaster.hard})`);
}

/* ------------------------------------------------------------------ */
/* G. Evening remainder (native solver path)                           */
/* ------------------------------------------------------------------ */
{
  const pack = packOf("Halifax");
  const anchorStay = scoreStays(pack)[0];
  const DATE = "2026-10-23";
  const solverDay = solveTrip(pack, { days: 1, startIso: DATE, dates: [DATE], earliestMin: 850, restSpec: null, mustSees: [], basePos: anchorStay.pos, baseName: anchorStay.name }).days[0];
  const citadelItem = solverDay.items.find((i) => i.type === "stop");
  const ferryTerminal = pack.transport.find((t) => t.kind === "ferry");
  ok(!!citadelItem && !!ferryTerminal, "evening: spike inputs reproducible from the pack");
  const CRUISE = { key: "booking-cruise", name: "Halifax Harbour Evening Cruise", kind: "venue", start: 20 * 60 + 30, end: 22 * 60, pos: ferryTerminal.pos, url: "stub://booking/cruise", protected: true };
  const result = solveEveningRemainder(pack, {
    date: DATE, anchorMin: 16 * 60, anchorPos: anchorStay.pos, anchorName: anchorStay.name,
    keeps: [{ key: citadelItem.key }, { meal: true }],
    protectedItems: [CRUISE], arriveProtectedByMin: 20 * 60 + 15, hardEndMin: 20 * 60
  });
  const frozen = load("frozen/evening-proof-halifax/diff.json");
  const shape = (items) => items.map((i) => `${i.name} ${fmt(i.start)}–${fmt(i.end)}`).join(" -> ");
  eq(result.plans.length, frozen.diff.plans.length, "evening: plan count");
  for (const fp of frozen.diff.plans) {
    const tp = result.plans.find((p) => p.label === fp.nativeLabel);
    ok(!!tp, `evening: plan "${fp.nativeLabel}" exists`);
    if (tp) {
      eq(shape(tp.items), fp.native, `evening: plan ${fp.plan} schedule`);
      eq(fmt(tp.endMin), fp.nativeEndMin, `evening: plan ${fp.plan} end`);
      eq(tp.legMin, fp.nativeLegMin, `evening: plan ${fp.plan} leg minutes`);
      eq(fmt(tp.arriveProtectedMin), fp.nativeArriveProtected, `evening: plan ${fp.plan} protected arrival`);
    }
  }
  eq(result.chosen?.id, frozen.diff.chosen.native, "evening: chosen plan letter (permutation order)");
  eq(shape(result.chosen.items), frozen.diff.plans.find((p) => p.plan === frozen.diff.chosen.native).native, "evening: chosen schedule byte-identical to the spike's chosen");
  eq(result.close, frozen.diff.closeness.native, "evening: closeness verdict (native dinner anchor -> not close)");
  // The repaired day, judged as the tester judges it.
  const repaired = {
    dayNumber: 1, date: DATE, role: "arrival",
    items: [
      { type: "journey", key: "booking-flight", name: "Flight (fixture)", kind: "flight", start: 605, end: 920 },
      { type: "transfer", key: "booking-transfer", name: "Booked transfer", kind: "transfer", start: 920, end: 960 },
      ...result.chosen.items,
      { type: "stop", ...CRUISE, role: "commitment", price: "UNKNOWN", hours: { status: "unknown" } }
    ].sort((a, b) => a.start - b.start),
    legs: []
  };
  const rj = judgeTrip([repaired], { earliestMin: 540, dayEndLimit: 1350 });
  eq(rj.pass, frozen.judge?.pass ?? true, "evening: the repaired day passes the make-sense judge");
  const dinner = result.chosen.items.find((i) => i.type === "food");
  eq(mealNameFor(dinner.start), "Dinner", "evening: the kept meal is named Dinner by the clock");
}

/* ------------------------------------------------------------------ */
/* H. Early / late check-in reflow (over the frozen E1 day 1)          */
/* ------------------------------------------------------------------ */
{
  const pack = packOf("Quebec City");
  const e1 = load("frozen/envelope-quebec-arrival/itinerary.json");
  const day1 = e1.days[0];
  const anchor = scoreStays(pack)[0];
  const DATE = day1.date;
  const judgeCfg = { profile: BASE_PROFILE };
  ok(judgeTrip(e1.days, judgeCfg).pass, "reflow: E1 as shipped passes the wait-window rule");
  const badDay = JSON.parse(JSON.stringify(day1));
  badDay.items.push({ type: "stop", role: "mustsee", key: "bad-fixture", name: "A Booked Museum Slot", kind: "museum", start: 13 * 60, end: 14 * 60, pos: anchor.pos, hours: "unknown" });
  const badJudge = judgeTrip([badDay], judgeCfg);
  ok(!badJudge.pass && badJudge.hardViolations.some((v) => v.includes("room wait")), "reflow: a timed commitment inside the wait FAILS (the rule has teeth)");

  const ownAfternoonKeys = new Set(day1.items.filter((i) => i.type === "stop").map((i) => i.key));
  const usedElsewhere = new Set();
  for (const d of e1.days) for (const i of d.items) if (i.key && !ownAfternoonKeys.has(i.key)) usedElsewhere.add(i.key);
  const lunchItem = day1.items.find((i) => i.type === "food");
  const lunchDur = lunchItem.end - lunchItem.start;
  const restEndEarly = 12 * 60 + 45 + 15 + day1.envelope.arrival.restMinutes;
  const frozenReflow = load("frozen/continuity-early-checkin/reflow.json");
  const frozenGrades = load("frozen/continuity-early-checkin/grades.json");

  const options = buildAfternoonOptions({ pack, dateIso: DATE, basePos: anchor.pos, usedKeys: usedElsewhere, notBeforeMin: restEndEarly + lunchDur, maxStops: 2, startPos: lunchItem.pos, startKey: lunchItem.key, startName: lunchItem.name });
  const { day: earlyDay, record: earlyRecord } = applyEarlyCheckIn(day1, { roomReadyMin: 12 * 60 + 45, options });
  eqC(earlyRecord, frozenReflow.early.record, "reflow early: record reproduced");
  const refresh = earlyDay.items.find((i) => i.part === "refresh");
  eq(refresh?.start, 12 * 60 + 45 + 15, "reflow early: rest & refresh moves up to the early room (12:45 + 15)");
  ok(!!earlyRecord.lunchMoved, "reflow early: lunch slides, recorded — never lost");
  ok(judgeTrip([earlyDay], judgeCfg).pass, "reflow early: the reflowed day passes the judge");
  const auditDay1 = (variant) => auditTrip([variant, ...e1.days.slice(1)], { profile: BASE_PROFILE }).findings.filter((f) => f.day === 1);
  eq(auditDay1(earlyDay).filter((f) => f.severity === "hard").length, 0, "reflow early: no hard emotion findings on the standing day");
  const gentleKeys = (frozenReflow.early.standingDay?.items || []).map((i) => i.key);
  eqC(earlyDay.items.map((i) => i.key), gentleKeys, "reflow early: standing day item keys match the frozen reflow");
  ok(options.gentle.length >= 1 && options.fuller.length >= options.gentle.length, "reflow early: two options offered (gentle stands, fuller proposes)");

  const fullerDay = { ...earlyDay, items: [...earlyDay.items.filter((i) => !(i.type === "stop" && i.role === "option")), ...JSON.parse(JSON.stringify(options.fuller))].sort((a, b) => a.start - b.start) };
  eqC(fullerDay.items.map((i) => i.key), (frozenReflow.early.fullerOptionDay?.items || []).map((i) => i.key), "reflow early: fuller option day item keys match the frozen reflow");
  eq(auditDay1(fullerDay).filter((f) => f.severity === "hard").length, 0, "reflow early: the fuller option is emotion-clean before it may be offered");

  const stuffedOpts = buildAfternoonOptions({ pack, dateIso: DATE, basePos: anchor.pos, usedKeys: usedElsewhere, notBeforeMin: restEndEarly + lunchDur, maxStops: 3, startPos: lunchItem.pos, startKey: lunchItem.key, startName: lunchItem.name });
  const stuffedDay = { ...earlyDay, items: [...earlyDay.items.filter((i) => !(i.type === "stop" && i.role === "option")), ...JSON.parse(JSON.stringify(stuffedOpts.fuller))].sort((a, b) => a.start - b.start) };
  const stuffedFindings = auditDay1(stuffedDay);
  eqC(stuffedFindings, frozenReflow.early.stuffedVariantFindings, "reflow early: stuffed variant findings reproduced exactly");
  ok(stuffedFindings.some((f) => f.check === "early-checkin-stuffing" && f.severity === "hard"), "reflow early: the stuffed variant is caught by the emotion audit");

  const { day: lateDay, record: lateRecord } = applyLateCheckIn(day1, { roomReadyMin: 16 * 60 });
  eqC(lateRecord, frozenReflow.late.record, "reflow late: record reproduced (notify + threatened + preserved)");
  ok(judgeTrip([lateDay], judgeCfg).pass, "reflow late: the late day passes the judge");
  for (const g of frozenGrades.grades) ok(["DONE", "NOT DONE"].includes(g.status), `reflow: frozen grade ${g.leg} recorded (${g.status})`);
}

/* ------------------------------------------------------------------ */
/* I. Continuity — proof A (arc + ledger + story), B (seam), drill     */
/* ------------------------------------------------------------------ */
{
  const { plan, pack, anchor, dates } = runs.pacingA;
  const frozenIt = load("frozen/continuity-quebec-14d/itinerary.json");
  const frozenGrades = load("frozen/continuity-quebec-14d/grades.json");
  const predictions = buildPredictions({ days: plan.days, budgetCap: null }, pack, { now: "2026-10-21T00:00:00.000Z" });
  ok(predictions.highlights.length > 0, "continuity A: PREDICT ranks highlights for the arc's peak evidence");
  const predictArc = buildTripArc({ types: plan.arc.types, peakScoreByDay: peakScoresFromDays(plan.days), envelopeArrival: false, envelopeDeparture: false });
  const arc = { ...predictArc, adjustments: plan.arc.adjustments, solverPeakDay: plan.arc.peakDay, notes: [...(plan.arc.notes || []), ...predictArc.notes] };
  const ledger = reconcileLedger(buildCommitmentLedger(plan.days, { mustSeeResults: plan.mustSeeResults }), plan.days);
  const story = buildStoryState(plan.days, { arc, ledger });
  const inserted = annotateNarrative(plan.days, story);
  const continuity = judgeContinuity(plan.days, { arc, ledger, story: { expected: { peakDay: arc.peakDay, landDay: arc.landDay, returns: story.returns, rehomedIn: [], rehomedOut: [] }, inserted } });
  eqC(ledger, frozenIt.commitmentLedger, "continuity A: commitment ledger reproduced");
  eqC(inserted, frozenIt.storyInsertions, "continuity A: story insertions reproduced");
  eqC({ roles: arc.roles, peakDay: arc.peakDay, landDay: arc.landDay, settleDay: arc.settleDay, adjustments: arc.adjustments }, { roles: frozenIt.arc.roles, peakDay: frozenIt.arc.peakDay, landDay: frozenIt.arc.landDay, settleDay: frozenIt.arc.settleDay, adjustments: frozenIt.arc.adjustments }, "continuity A: trip arc (peak from PREDICT scores)");
  eq(arc.peakDay, plan.arc.peakDay, "continuity A: PREDICT-scored peak equals the solver's placement peak");
  eq(plan.arc.adjustments.length, 1, "continuity A: exactly one landing demotion");
  legsEq(continuity.checks.map((c) => ({ leg: c.leg, status: c.status })), frozenGrades.grades.filter((g) => g.leg.startsWith("continuity:") && !["continuity:peak-from-predict", "continuity:landing-demoted", "continuity:return-narrated"].includes(g.leg)), "continuity A: continuity judge checks");
  eqC(continuity.checks, frozenIt.continuity?.checks ?? continuity.checks, "continuity A: judge checks detail parity");
  const ret = story.returns[0];
  ok(ret && inserted.some((x) => x.day === ret.day && x.kind === "return"), "continuity A: the returning favourite is narrated as a return");
  void dates;
  void anchor;
}
{
  const { qcPlan, hxPlan } = runs.pacingB;
  // The continuity proof's MOVE day carries the seam chain (journey
  // spec supplied) — a different build from the pacing proof's plain
  // move day above.
  const qcPackB = packOf("Quebec City");
  const hxPackB = packOf("Halifax");
  const qcAnchorB = scoreStays(qcPackB)[0];
  const hxAnchorB = scoreStays(hxPackB)[0];
  const moveDay = buildMoveDay({ dayNumber: 7, date: "2026-10-30", fromName: "Quebec City", toName: "Halifax", fromBaseName: qcAnchorB.name, arrivalPack: hxPackB, arrivalBasePos: hxAnchorB.pos, arrivalBaseName: hxAnchorB.name, earliestMin: EARLIEST, journey: { journeyMin: 420, checkoutMin: 9 * 60 } });
  moveDay.narrative = composeDay(moveDay, { earliestLabel: "09:00", weatherByDate: {}, baseName: hxAnchorB.name, hasDietary: false, stay: null }, newComposerState());
  if (moveDay.seam) {
    const chainItems = moveDay.items.filter((i) => ["checkout", "move", "checkin", "rest"].includes(i.type)).sort((a, b) => a.start - b.start);
    let orphan = 0;
    for (let i = 1; i < chainItems.length; i++) orphan += Math.max(0, chainItems[i].start - chainItems[i - 1].end);
    moveDay.seam = { ...moveDay.seam, orphanMin: orphan, orphanNote: "computed over the seam chain blocks (checkout -> move -> wait/check-in -> refresh): the checkout block runs to the moment the motion starts, so every minute from checkout to the end of rest is carried by a named block" };
  }
  const allDays = [...qcPlan.days, moveDay, ...hxPlan.days];
  const frozenGrades = load("frozen/continuity-quebec-halifax-12d/grades.json");
  const frozenItB = load("frozen/continuity-quebec-halifax-12d/itinerary.json");
  const stitchRoles = allDays.map(() => "EXPLORE");
  stitchRoles[0] = "SETTLE";
  stitchRoles[allDays.length - 1] = "LAND";
  if (qcPlan.arc?.peakDay) stitchRoles[qcPlan.arc.peakDay - 1] = "PEAK";
  const adjustments = [...(qcPlan.arc?.adjustments || []), ...(hxPlan.arc?.adjustments || []).map((a) => ({ ...a, day: a.day + 7 }))];
  const arc = { roles: stitchRoles, peakDay: qcPlan.arc?.peakDay || null, landDay: 12, settleDay: 1, adjustments, notes: ["trip arc stitched from the two segment arcs: peak = the first segment headline day; landing = the final day"] };
  const story = buildStoryState(allDays, { arc, seams: moveDay.seam ? [moveDay.seam] : [] });
  const inserted = annotateNarrative(allDays, story);
  const ledger = reconcileLedger(buildCommitmentLedger(allDays, { mustSeeResults: [...qcPlan.mustSeeResults, ...hxPlan.mustSeeResults] }), allDays);
  const continuity = judgeContinuity(allDays, { arc, ledger, story: { expected: { peakDay: arc.peakDay, landDay: arc.landDay, returns: story.returns, rehomedIn: [], rehomedOut: [] }, inserted } }, moveDay.seam ? [{ ...moveDay.seam }] : []);
  legsEq(continuity.checks.map((c) => ({ leg: c.leg, status: c.status })), frozenGrades.grades.filter((g) => g.leg.startsWith("continuity:") && !g.leg.startsWith("continuity:seam-")), "continuity B: continuity judge checks");
  const seamItems = moveDay.items.map((i) => i.type);
  ok(["checkout", "move", "checkin"].every((t) => seamItems.includes(t)), "continuity B: seam chain rendered (checkout -> move -> check-in)");
  ok(moveDay.items.filter((i) => i.type === "stop").every((s) => s.start >= moveDay.seam.restEndMin), "continuity B: arrival stop yields to the seam rest rule");
  const serC = (day) => ({
    dayNumber: day.dayNumber, date: day.date, role: day.role, dayType: day.dayType,
    arcRole: story.arcRoles?.[day.dayNumber] || null, envelope: day.envelope || null, seam: day.seam || null,
    items: day.items.map((i) => ({ ...i, startTime: fmt(i.start), endTime: fmt(i.end) })),
    legs: day.legs.map((l) => ({ ...l, km: +l.km.toFixed(2), departTime: fmt(l.depart), arriveTime: fmt(l.arrive) })),
    ideas: day.ideas || [], narrative: day.narrative || [], endMin: day.endMin
  });
  eqC(allDays.map(serC), frozenItB.days, "continuity B: 12 days incl. the seam-chained move day reproduced");
  eqC(ledger, frozenItB.commitmentLedger, "continuity B: commitment ledger reproduced");
}
{
  // The disruption drill: rain strikes the pinned day-8 must-see.
  const { cal, pack, anchor, dates } = runs.pacingA;
  const baseSpec = { days: 14, startIso: "2026-10-24", dates, earliestMin: EARLIEST, restSpec: null, mustSees: mustSeesOf(qcEntry), basePos: anchor.pos, baseName: anchor.name, calendar: cal.days, relaxFavorites: cal.relaxFavorites };
  const cached = Object.fromEntries(pack.weather.map((w) => [w.date, w.precipProb]));
  const pinnedDry = dates.map((date) => ({ date, precipProb: cached[date] ?? 20 }));
  const pinnedRain = (strikeIdx) => pinnedDry.map((w, i) => (i === strikeIdx ? { ...w, precipProb: 92 } : w));
  const pavillon = pack.sights.find((c) => c.name.includes("Pavillon Pierre-Lassonde"));
  const cartier = pack.sights.find((c) => c.name.includes("Cartier-Brébeuf"));
  ok(!!pavillon && !!cartier, "drill: candidates present in the pack");
  const pavillonMs = { id: "keyword-pavillon", label: "Pavillon Pierre-Lassonde visit", patterns: ["pierre-lassonde"] };
  const cartierMs = { id: "keyword-cartier", label: "Cartier-Brébeuf historic site visit", patterns: ["cartier-brebeuf"] };
  const REASON = "the rain closed the day for it (92% rain forecast posted for the struck day)";
  const frozenGrades = load("frozen/continuity-drill-rehome/grades.json");
  const frozenEsc = load("frozen/continuity-drill-rehome/escalation.json");

  const spec1 = { ...baseSpec, mustSees: [...baseSpec.mustSees, pavillonMs], weatherOverride: pinnedDry, mustSeeDayPins: { [pavillonMs.id]: 7 } };
  const baseline = solveTrip(pack, spec1);
  const baseMs = baseline.mustSeeResults.find((m) => m.id === pavillonMs.id);
  ok(baseMs.status === "scheduled" && baseMs.day === 8, "drill: baseline home — the pinned must-see sits on day 8");
  const ledgerBase = buildCommitmentLedger(baseline.days, { mustSeeResults: baseline.mustSeeResults });
  const disaster = solveTrip(pack, { ...spec1, weatherOverride: pinnedRain(7), closedKeys: new Set([`${pavillon.key}@7`]) });
  ok(!disaster.days[7].items.some((i) => i.key === pavillon.key), "drill: struck day holds — the Pavillon is absent from day 8");
  const entry1 = ledgerBase.find((e) => e.id === `ms:${pavillonMs.id}`);
  const outcome = rehomeCommitment({
    entry: entry1, closedDay: 8,
    candidateDays: disaster.arc.types.map((t, i) => ({ dayNumber: i + 1, type: t })),
    solveWith: (dayNumber) => {
      const trial = solveTrip(pack, { ...spec1, weatherOverride: pinnedRain(7), closedKeys: new Set([`${pavillon.key}@7`]), mustSeeDayPins: { [pavillonMs.id]: dayNumber - 1 } });
      const r = trial.mustSeeResults.find((m) => m.id === pavillonMs.id);
      return r.status === "scheduled" && r.day === dayNumber ? trial : null;
    }
  });
  ok(!outcome.escalated && typeof outcome.toDay === "number", "drill: the commitment is re-homed by trial re-solve");
  const ledgerFinal = reconcileLedger(ledgerBase, outcome.plan.days, { rehomed: [{ id: entry1.id, toDay: outcome.toDay, reason: REASON }] });
  const entryFinal = ledgerFinal.find((e) => e.id === entry1.id);
  ok(entryFinal.status === "rehomed" && entryFinal.toDay === outcome.toDay, `drill: ledger records the re-home to day ${outcome.toDay}`);
  const ctx = { earliestLabel: "09:00", stay: { name: anchor.name, walkableSights: anchor.walkableSights }, weatherByDate: weatherByDateOf(pack), baseName: anchor.name, hasDietary: true };
  const st = newComposerState();
  for (const day of outcome.plan.days) day.narrative = composeDay(day, ctx, st);
  const arcF = buildTripArc({ types: outcome.plan.arc.types, peakScoreByDay: peakScoresFromDays(outcome.plan.days) });
  const storyF = buildStoryState(outcome.plan.days, { arc: arcF, ledger: ledgerFinal });
  const insertedF = annotateNarrative(outcome.plan.days, storyF);
  ok(insertedF.some((x) => x.day === 8 && x.kind === "rehomed-out") && insertedF.some((x) => x.day === outcome.toDay && x.kind === "rehomed-in"), "drill: the story acknowledges the move on BOTH days");
  const contF = judgeContinuity(outcome.plan.days, { arc: arcF, ledger: ledgerFinal, story: { expected: { peakDay: arcF.peakDay, landDay: arcF.landDay, returns: storyF.returns, rehomedIn: storyF.rehomedIn, rehomedOut: storyF.rehomedOut }, inserted: insertedF } });
  ok(contF.pass && judgeTrip(outcome.plan.days, { earliestMin: EARLIEST }).pass, "drill: the final plan passes continuity + make-sense");
  for (const leg of ["drill:baseline-home", "drill:struck-day-holds", "drill:rehomed", "drill:story-acknowledges", "drill:final-plan-judged"]) {
    const fl = frozenGrades.grades.find((g) => g.leg === leg);
    ok(fl && fl.status === "DONE", `drill: frozen grade ${leg} = DONE (TS run reproduces the conditions)`);
  }

  const spec2 = { ...baseSpec, mustSees: [...baseSpec.mustSees, cartierMs], weatherOverride: pinnedDry, mustSeeDayPins: { [cartierMs.id]: 8 } };
  const baseline2 = solveTrip(pack, spec2);
  const ledgerBase2 = buildCommitmentLedger(baseline2.days, { mustSeeResults: baseline2.mustSeeResults });
  const disaster2 = solveTrip(pack, { ...spec2, weatherOverride: pinnedRain(8), closedKeys: new Set([`${cartier.key}@8`]) });
  const entry2 = ledgerBase2.find((e) => e.id === `ms:${cartierMs.id}`);
  const outcome2 = rehomeCommitment({
    entry: entry2, closedDay: 9,
    candidateDays: disaster2.arc.types.map((t, i) => ({ dayNumber: i + 1, type: t })),
    solveWith: (dayNumber) => {
      const trial = solveTrip(pack, { ...spec2, weatherOverride: pinnedRain(8), closedKeys: new Set([`${cartier.key}@8`]), mustSeeDayPins: { [cartierMs.id]: dayNumber - 1 } });
      const r = trial.mustSeeResults.find((m) => m.id === cartierMs.id);
      return r.status === "scheduled" && r.day === dayNumber ? trial : null;
    }
  });
  ok(outcome2.escalated, "drill: with no later FULL day the commitment ESCALATES");
  const ledger2 = reconcileLedger(ledgerBase2, disaster2.days);
  const e2 = ledger2.find((e) => e.id === entry2.id);
  ok(e2 && e2.status === "unresolved", "drill: the ledger carries the stranded commitment as UNRESOLVED");
  const cont2 = judgeContinuity(disaster2.days, { arc: disaster2.arc, ledger: ledger2 });
  ok(!cont2.pass, "drill: the continuity judge FAILS the trip on the unresolved commitment");
  eqC(stripMs([frozenEsc.baselineHome]), stripMs([baseline2.mustSeeResults.find((m) => m.id === cartierMs.id)]), "drill: escalation baseline home matches the frozen record");
}

/* ------------------------------------------------------------------ */
/* J. Prices proof — synthetic judge mechanics                         */
/* ------------------------------------------------------------------ */
{
  const day = (items) => [{ dayNumber: 1, items }];
  const meal = (key) => ({ type: "food", kind: "food", key, name: key, start: 750, end: 810 });
  const museum = (key) => ({ type: "stop", kind: "museum", key, name: key, start: 600, end: 690 });
  const synth = (items, cap, opts = {}) => judgeBudget({ days: day(items), budgetCap: { amount: cap, currency: "CAD" }, travelers: { adults: 2, children: 0, infants: 0 } }, opts);
  const unknownEv = { tier: "UNKNOWN", range: null, basis: "no evidence — never zero, never guessed" };
  const belowMajority = judgeBudget({ days: day([meal("a"), { ...meal("b"), priceEvidence: unknownEv }, { ...museum("c"), priceEvidence: unknownEv }]), budgetCap: { amount: 500, currency: "CAD" }, travelers: { adults: 2, children: 0 } });
  // ALL-IN (2026-10-22): the synthetic day is a 1-day trip, so lodging
  // is not applicable and only getting-there joins the scope: coverage
  // is 1 evidenced of 4 all-in scope lines (was 1 of 3 priced items).
  ok(belowMajority.verdict === "UNVERIFIABLE" && belowMajority.coverage === 0.25, "prices: below-majority coverage stays UNVERIFIABLE, coverage stated (all-in denominator)");
  eq(synth([meal("a"), museum("b")], 100).verdict, "AT RISK", "prices: straddle -> AT RISK");
  eq(synth([meal("a"), museum("b")], 30).verdict, "OVER", "prices: tiny cap -> OVER");
  eq(synth([meal("a"), museum("b")], 5000).verdict, "WITHIN", "prices: huge cap -> WITHIN");
  const verified = synth([meal("a")], 500, { libraryPrices: { a: { amount: 22, per: "person", currency: "CAD", source: "owner library (synthetic check)", recordedAt: "2026-10-21" } } });
  ok(verified.perItem[0].tier === "VERIFIED" && verified.perItem[0].partyRange.low === 44, "prices: VERIFIED library record resolves and wins over the model");
  eq(priceEvidence({ ...meal("x"), priceBand: { level: "PRICE_LEVEL_MODERATE", source: "google-fixture" } }).tier, "BAND", "prices: a band beats the cost model (ladder order)");
  const noEv = priceEvidence({ type: "stop", kind: "falls", key: "zzz", name: "zzz", start: 0, end: 0, priceEvidence: { tier: "UNKNOWN", category: "admission", range: null, basis: "no evidence — never zero, never guessed" } });
  ok(noEv.tier === "UNKNOWN" && noEv.range === null, "prices: UNKNOWN evidence carries range null — never zero, never guessed");
  eq(priceEvidence({ type: "stop", kind: "park", key: "zzz", name: "zzz", start: 0, end: 0 }), null, "prices: an unpriced kind (park) is not a priced item at all");
  const frozenPrices = loadData("frozen/prices-proof.json");
  for (const chk of frozenPrices.syntheticChecks) ok(chk.pass, `prices: frozen synthetic check recorded PASS — ${chk.name}`);
  const row14 = frozenPrices.rows.find((r) => r.trip.startsWith("pacing-quebec-14d"));
  const it14 = load("frozen/pacing-quebec-14d/itinerary.json");
  const judged14 = judgeBudget({ ...it14, budgetCap: { amount: 1100, currency: "CAD" }, travelers: { adults: 2, children: 2, infants: 0 } });
  eq(judged14.verdict, row14.after, "prices: the 14-day trip judged under Quebec parameters reproduces the frozen verdict");
  eq(judged14.coverage, row14.coverage, "prices: 14-day coverage reproduced");
}

/* ------------------------------------------------------------------ */
/* K. Budget-vs-Real — BEFORE / DURING / AFTER against the Phase 1     */
/*    golden DTOs (incl. the AT RISK -> OVER re-grade + calibration)   */
/* ------------------------------------------------------------------ */
{
  const sc = loadData("budget-vs-real-scenario.json");
  const phase1 = loadData("budget-vs-real-checkpoints.json", PHASE1);
  const store = createLibraryStore(sc.seed);
  const itemRefOf = (key) => contentId("item", [sc.itinerary.tripRef, "1", key]);
  // The Phase 1 capture's own conversion, verbatim.
  const convertReport = (report, atIso) => ({
    checkpoint: report.checkpoint,
    at: atIso,
    tripRef: report.tripRef ?? sc.itinerary.tripRef,
    items: (report.items ?? []).map((r) => ({
      itemRef: itemRefOf(r.key),
      dayNumber: r.day ?? 1,
      name: r.name,
      estimate: r.estimate
        ? { tier: r.estimate.tier, category: r.estimate.category, range: r.estimate.partyRange ? { low: r.estimate.partyRange.low, high: r.estimate.partyRange.high, currency: r.estimate.partyRange.currency, per: "party" } : null, per: "party", basis: r.estimate.basis ?? "" }
        : null,
      real: r.real
        ? { source: r.real.source, amount: r.real.amountParty, currency: r.real.currency, per: "party", observedAt: r.real.observedAt ?? null, stale: r.real.freshness === "STALE", excludedFromTotals: !!r.real.excludedFromTotals || r.real.freshness === "STALE", basis: r.real.basis ?? "" }
        : null,
      verdict: r.verdict,
      loud: !!r.loud
    })),
    rollups: {
      realTotal: report.rollups?.trip?.realTotal ?? null,
      unverifiableItems: report.rollups?.trip?.unverifiableItems ?? 0,
      byCategory: Object.fromEntries(Object.entries(report.rollups?.byCategory ?? {}).map(([cat, roll]) => [cat, { realTotal: roll.realTotal, items: roll.gradedItems }]))
    },
    regrade: {
      verdict: report.regrade?.verdict ?? "UNVERIFIABLE",
      totals: report.regrade?.totals ? { low: report.regrade.totals.low, high: report.regrade.totals.high, currency: report.regrade.totals.currency, per: "party" } : null,
      cap: report.regrade?.cap ? { amount: report.regrade.cap.amount, currency: report.regrade.cap.currency } : { amount: sc.itinerary.budgetCap.amount, currency: sc.itinerary.budgetCap.currency }
    },
    loud: Array.isArray(report.loud) ? report.loud.length > 0 : !!report.loud,
    calibrationWrites: []
  });
  const toLibraryRecords = (writes) => (writes ?? []).map((w) => ({
    candidateKey: w.key ?? w.candidateKey,
    amount: w.record?.amount ?? w.amount,
    currency: w.record?.currency ?? w.currency ?? "CAD",
    per: w.record?.per ?? w.per ?? "party",
    source: w.record?.source ?? w.source ?? "",
    recordedAt: w.record?.recordedAt ?? w.recordedAt ?? "",
    evidenceCount: w.record?.evidenceCount ?? w.evidenceCount ?? 1
  }));

  const before = runCheckpoint(sc.itinerary, "BEFORE", { now: sc.nowBefore, library: store, liveChecks: sc.liveChecks });
  const during = runCheckpoint(sc.itinerary, "DURING", { now: sc.nowDuring, library: store, liveChecks: sc.liveChecks, bookingFacts: sc.bookingFacts });
  const writtenDuring = calibrate(during.items, store, { now: sc.nowDuring });
  const after = runCheckpoint(sc.itinerary, "AFTER", { now: sc.nowAfter, library: store, bookingFacts: sc.bookingFacts, actuals: sc.actuals });
  const writtenAfter = calibrate(after.items, store, { now: sc.nowAfter });

  const reports = [convertReport(before, sc.nowBefore), convertReport(during, sc.nowDuring), convertReport(after, sc.nowAfter)];
  reports[1].calibrationWrites = toLibraryRecords(writtenDuring);
  reports[2].calibrationWrites = toLibraryRecords(writtenAfter);
  const libraryAfter = Object.entries(store.records).map(([key, rec]) => ({ candidateKey: key, amount: rec.amount, currency: rec.currency, per: rec.per, source: rec.source, recordedAt: rec.recordedAt, evidenceCount: rec.evidenceCount }));
  eqC(reports, phase1.reports, "budget-vs-real: BEFORE/DURING/AFTER reports equal the Phase 1 golden DTOs");
  eqC(libraryAfter, phase1.libraryAfter, "budget-vs-real: calibrated library state equals the Phase 1 golden records");
  for (const r of reports) ok(parseBudgetVsRealComparisonDTO(r).ok, `budget-vs-real: ${r.checkpoint} report passes the Phase 1 DTO parser`);
  eq(reports[0].regrade.verdict, "AT RISK", "budget-vs-real: BEFORE re-grade is AT RISK");
  eq(reports[1].regrade.verdict, "OVER", "budget-vs-real: DURING re-grade crosses to OVER on real prices");
  eq(reports[1].loud, true, "budget-vs-real: the OVER re-grade is LOUD");
  const ferry = reports[1].items.find((i) => i.name === "Harbour Ferry");
  ok(ferry && ferry.real?.source === "PAID" && ferry.real.amount === 95 && ferry.verdict === "ABOVE" && ferry.loud, "budget-vs-real: the ferry (matched by NAME) is PAID 95, ABOVE, loud");
  const lighthouse = reports[0].items.find((i) => i.name === "Harbour Lighthouse");
  ok(lighthouse && lighthouse.real?.stale === true && lighthouse.real.excludedFromTotals === true, "budget-vs-real: the 72h-old lighthouse check stays STALE and excluded");
  const falls = reports[2].items.find((i) => i.name === "Elm Falls");
  ok(falls && falls.estimate.tier === "UNKNOWN" && falls.estimate.range === null && falls.verdict === "UNVERIFIABLE", "budget-vs-real: UNKNOWN estimate -> range null -> UNVERIFIABLE, never zero");
  // Bias proposals: nothing proposes below 5 observations; at 5, a
  // systematic miss is PROPOSED — recorded, never applied.
  eq(proposeBias(during.observations).length, 0, "budget-vs-real: no bias proposal below the 5-observation floor");
  const fiveObs = Array.from({ length: 5 }, () => ({ key: "x", category: "admission", tier: "COSTED", modeledRange: { low: 12, high: 26, currency: "CAD" }, realPerPerson: 40 }));
  const proposals = proposeBias(fiveObs);
  ok(proposals.length === 1 && proposals[0].status.startsWith("PROPOSED"), "budget-vs-real: 5 consistent misses produce exactly one PROPOSED bias record");
  void before; void after;
}

/* ------------------------------------------------------------------ */
/* L. E2E tester Ch. 9 — judge legs over the part2 days                */
/* ------------------------------------------------------------------ */
{
  const ch9 = loadData("ch9-judge-days.json");
  for (const [name, entry] of Object.entries(ch9)) {
    const j = judgeTrip([entry.day], { earliestMin: 540, dayEndLimit: 1350 });
    eqC({ pass: j.pass, hardViolations: j.hardViolations, warnings: j.warnings }, entry.expected, `ch9 ${name}: judge outcome matches the shadow judge at capture`);
  }
  eq(ch9.clean2026_10_23.expected.pass, true, "ch9: aligned 2026-10-23 passes");
  eq(ch9.clean2026_10_24.expected.pass, true, "ch9: aligned 2026-10-24 passes");
  eq(ch9.collided2026_10_23.expected.pass, false, "ch9: the collided day is convicted");
}

/* ------------------------------------------------------------------ */
/* M. Design-mandated changes — their own assertions                   */
/* ------------------------------------------------------------------ */
{
  // M1. The BOOKED stay is the production day anchor: the solver
  // accepts a pinned anchor stay and builds the day from it.
  const pack = packOf("Quebec City");
  const stays = scoreStays(pack);
  const pin = stays[1];
  const dates = Array.from({ length: 5 }, (_, i) => isoPlus("2026-10-24", i));
  const specBase = { days: 5, startIso: "2026-10-24", dates, earliestMin: EARLIEST, restSpec: { type: "afternoon", text: "one full rest afternoon in the middle" }, mustSees: mustSeesOf(qcEntry), basePos: stays[0].pos, baseName: stays[0].name };
  const pinned = solveTrip(pack, { ...specBase, pinnedStay: { name: pin.name, pos: pin.pos } });
  const explicit = solveTrip(pack, { ...specBase, basePos: pin.pos, baseName: pin.name });
  eq(pinned.days[0].legs[0]?.fromName, pin.name, "pinned anchor: day 1 departs from the BOOKED (pinned) stay, not the top-scored one");
  eqC(pinned.days.map((d) => d.items.map((i) => [i.key, i.start, i.end])), explicit.days.map((d) => d.items.map((i) => [i.key, i.start, i.end])), "pinned anchor: pinning a stay is exactly equivalent to basing the solve on it");
  const unpinned = solveTrip(pack, specBase);
  eq(unpinned.days[0].legs[0]?.fromName, stays[0].name, "unpinned: the helper's top score remains the fallback anchor");

  // M2. Two judge gate profiles: a real booking (reference + real
  // price, no OSM URL) is legitimate in production and a fabrication
  // in an engine plan.
  const bookedDay = [{
    dayNumber: 1, date: "2026-10-23", role: "standard",
    items: [{ type: "stop", name: "Booked Museum Entry", kind: "museum", start: 600, end: 690, pos: { lat: 46.81, lon: -71.21 }, bookingReference: "BK-TEST-1", price: 42, hours: { status: "unknown" } }],
    legs: []
  }];
  const engineGate = judgeTrip(bookedDay, { earliestMin: 540 });
  ok(!engineGate.pass && engineGate.hardViolations.some((v) => v.includes("Booked Museum Entry")), "gate profiles: engine-plan REJECTS an ungrounded, priced item");
  const bookingGate = judgeTrip(bookedDay, { earliestMin: 540, gateProfile: "production-booking" });
  ok(bookingGate.pass, "gate profiles: production-booking ACCEPTS a booked item with a reference and a real price");
  const shapedBad = [{
    dayNumber: 1, date: "2026-10-23", role: "standard",
    items: [{ type: "stop", name: "Shaped Wrong", kind: "museum", start: 600, end: 690, pos: { lat: 46.81, lon: -71.21 }, key: "k1", url: "https://example.test/x", bookingReference: "BK-2", priceEvidence: { tier: "UNKNOWN", category: "admission", range: { low: 5, high: 9, currency: "CAD" }, per: "person", basis: "ESTIMATED — wrong" } }],
    legs: []
  }];
  ok(!judgeTrip(shapedBad, { earliestMin: 540, gateProfile: "production-booking" }).pass, "gate profiles: price-evidence SHAPE violations fail under BOTH profiles (UNKNOWN must carry no range)");

  // M3. The commitment ledger is keyed by stable item IDs: renaming
  // an item does not orphan its promise; removing the key does what
  // the shadow's name-matching would have done.
  const { plan } = runs["quebec-city-family"];
  const ledger0 = buildCommitmentLedger(plan.days, { mustSeeResults: plan.mustSeeResults });
  const ferryEntry = ledger0.find((e) => e.kind === "must-see" && e.status === "kept");
  ok(!!ferryEntry && !!ferryEntry.itemKey, "ledger: kept must-see entries carry the item key");
  const renamedDays = plan.days.map((d) => ({ ...d, items: d.items.map((i) => (i.key === ferryEntry.itemKey ? { ...i, name: "Renamed Beyond Recognition" } : i)) }));
  const relabeled = reconcileLedger(ledger0, renamedDays);
  eq(relabeled.find((e) => e.id === ferryEntry.id).status, "kept", "ledger: a renamed item still reconciles — matched by stable ID, not name");
  const keylessDays = plan.days.map((d) => ({ ...d, items: d.items.map((i) => (i.key === ferryEntry.itemKey ? { ...i, key: undefined, name: "Renamed Beyond Recognition" } : i)) }));
  const orphaned = reconcileLedger(ledger0, keylessDays);
  eq(orphaned.find((e) => e.id === ferryEntry.id).status, "unresolved", "ledger: with neither key nor name, the promise surfaces as unresolved — never silently kept");

  // M4. Understanding: unresolved cases reach the injected sink, and
  // the structured-intake adapter needs no text parsing.
  const sinkEntries = [];
  const ex = extractConstraints("A quiet trip with a crib please, near elevator access.", { record: (e) => sinkEntries.push(e) });
  eqC(sinkEntries.map((e) => e.kind), ["earliest-start", "rest", "budget", "place-items"], "understand: unresolved cases reach the sink in order");
  eqC(sinkEntries.map((e) => e.detail), ex.unresolved, "understand: sink details equal the returned unresolved array");
  const structured = constraintsFromStructured({ earliestStart: "08:30", restType: "morning", restText: "one slow morning", budgetAmount: 500, dietary: ["vegan"], access: ["elevator"], maxWalkKm: 1, placeItems: ["the market"] });
  eq(structured.earliestStart, "08:30", "structured intake: earliest start maps directly");
  eq(structured.rest?.type, "morning", "structured intake: rest type maps directly");
  eq(structured.budgetAmount, 500, "structured intake: budget maps directly");
  eqC(structured.unresolved, [], "structured intake: nothing is left unresolved by construction");

  // M5. fitScore is exported and sane on a known-hours must-see.
  ok(fitScore({ type: "stop", kind: "falls", role: "excursion", start: 0, end: 0, hours: { status: "known", open: 540, close: 1020, provenance: "osm" } }).score > fitScore({ type: "stop", kind: "falls", start: 0, end: 0, hours: { status: "unknown" } }).score, "predict: fitScore rewards the must-see with known hours");
}

/* ------------------------------------------------------------------ */
/* L. ALL-IN scope synthetics (owner decision, Junel, 2026-10-22:      */
/*    "Budget scope- all-in, update"). The corpus packs carry no stay  */
/*    price evidence, so §B proves the named-not-counted path on real  */
/*    trips; this section proves the evidenced paths + the reckoning.  */
/* ------------------------------------------------------------------ */
{
  const meal = (key) => ({ type: "food", kind: "food", key, name: key, start: 750, end: 810 });
  const museum = (key) => ({ type: "stop", kind: "museum", key, name: key, start: 600, end: 690 });
  const travelers = { adults: 2, children: 0, infants: 0 };
  // A 3-day trip whose day 1 prices 3 items (meals COSTED 12–30 pp,
  // museum COSTED 12–26 pp; party of 2): plan totals 72–172.
  const days3 = [
    { dayNumber: 1, items: [meal("a"), museum("b"), meal("c")] },
    { dayNumber: 2, items: [] },
    { dayNumber: 3, items: [] }
  ];
  const judge3 = (cap, scope) =>
    judgeBudget({ days: days3, budgetCap: { amount: cap, currency: "CAD" }, travelers }, scope ? { scope } : {});

  // L1 — no component evidence: both components NAMED, excluded from
  // totals, and coverage is computed over the all-in scope lines.
  const noEv = judge3(5000);
  eq(noEv.verdict, "WITHIN", "all-in L1: plan-only evidence still grades (3/5 lines over the bar)");
  eq(noEv.coverage, 0.6, "all-in L1: coverage 3 evidenced of 5 all-in scope lines");
  eq(noEv.scopeLines, 5, "all-in L1: scope lines = 3 priced items + lodging + getting-there");
  eqC(noEv.totals, { low: 72, high: 172, currency: "CAD" }, "all-in L1: totals exclude the unevidenced components (never zero-filled)");
  const lodNoEv = noEv.components.find((c) => c.component === "lodging");
  const traNoEv = noEv.components.find((c) => c.component === "transport");
  ok(lodNoEv.applicable && !lodNoEv.evidenced && lodNoEv.evidence.range === null && lodNoEv.evidence.basis.includes("excluded from the totals"), "all-in L1: lodging named-not-counted, range null (never zero)");
  ok(traNoEv.applicable && !traNoEv.evidenced && traNoEv.evidence.range === null, "all-in L1: getting-there named-not-counted");
  ok(noEv.scopeNote.includes("lodging: not evidenced") && noEv.scopeNote.includes("getting-there: not evidenced"), "all-in L1: the scope note names both unevidenced components");

  // L2 — a VERIFIED booked stay price joins the totals and can move
  // the verdict on its own: plan 72–172 vs cap 150 is AT RISK; adding
  // the booked stay (100) makes the range 172–272 — OVER.
  eq(judge3(150).verdict, "AT RISK", "all-in L2: without lodging evidence the same trip straddles");
  const withStay = judge3(150, { lodging: { name: "Hotel Synthetic", nights: 2, bookedPrice: { amount: 100, currency: "CAD" } }, transport: null });
  eq(withStay.verdict, "OVER", "all-in L2: the booked stay's price moves the verdict to OVER");
  eqC(withStay.totals, { low: 172, high: 272, currency: "CAD" }, "all-in L2: totals = plan + the booked stay's verified price");
  eq(withStay.components.find((c) => c.component === "lodging").evidence.tier, "VERIFIED", "all-in L2: a booked price is VERIFIED evidence");
  eq(withStay.coverage, 0.8, "all-in L2: coverage 4 of 5 all-in lines");

  // L3 — a stay price BAND prices lodging as an ESTIMATED range:
  // MODERATE = 110–180 per room-night x 2 nights = 220–360.
  const withBand = judge3(5000, { lodging: { name: "Banded Stay", nights: 2, priceBandLevel: "PRICE_LEVEL_MODERATE", priceBandSource: "google" }, transport: null });
  const lodBand = withBand.components.find((c) => c.component === "lodging");
  eq(lodBand.evidence.tier, "BAND", "all-in L3: a recorded price band is BAND evidence");
  eqC(lodBand.evidence.range, { low: 220, high: 360, currency: "CAD", per: "party" }, "all-in L3: band range = per-night range x nights");
  eqC(withBand.totals, { low: 292, high: 532, currency: "CAD" }, "all-in L3: totals = plan + band range");

  // L4 — getting-there from the transport argument (COSTED): the §A
  // drive case (money 54 = fuel 24 + parking 30) on a 1-day trip.
  const est = estimateTransport({
    originLabel: "A", destinationLabel: "B", tripDays: 1,
    roadDistanceKm: { value: 200, basis: "t" }, driveHoursDoorToDoor: { value: 3, basis: "t" },
    fuelPer100Km: { value: 8, basis: "t" }, fuelPricePerL: { value: 1.5, basis: "t" },
    parkingPerDay: { value: 10, basis: "t" }, parkingDays: { value: 3, basis: "t" },
    flightFarePerPerson: { value: 120, basis: "t" }, flightHoursDoorToDoor: { value: 2.5, basis: "t" },
    airportTransfersTotal: { value: 40, basis: "t" }, travelers: { value: 1, basis: "t" },
    valueOfTimePerHourPerPerson: { value: 25, basis: "t" }
  });
  const dayTrip = judgeBudget(
    { days: [{ dayNumber: 1, items: [meal("a")] }], budgetCap: { amount: 100, currency: "CAD" }, travelers },
    { scope: { lodging: null, transport: { estimate: est } } }
  );
  const traCosted = dayTrip.components.find((c) => c.component === "transport");
  eq(traCosted.evidence.tier, "COSTED", "all-in L4: the transport argument is COSTED evidence");
  eqC(traCosted.evidence.range, { low: 54, high: 54, currency: "CAD", per: "party" }, "all-in L4: transport priced at the argument's all-in money (fare/fuel + parking + transfers)");
  eqC(dayTrip.totals, { low: 78, high: 114, currency: "CAD" }, "all-in L4: totals = meal party range + transport money");
  eq(dayTrip.verdict, "AT RISK", "all-in L4: 78–114 straddles the 100 cap");

  // L5 — both options emitted, no selection: getting-there stays
  // UNKNOWN (named, excluded) even though an estimate exists.
  const tie = estimateTransport({
    originLabel: "A", destinationLabel: "B", tripDays: 1,
    roadDistanceKm: { value: 200, basis: "t" }, driveHoursDoorToDoor: { value: 3, basis: "t" },
    fuelPer100Km: { value: 8, basis: "t" }, fuelPricePerL: { value: 1.5, basis: "t" },
    parkingPerDay: { value: 10, basis: "t" }, parkingDays: { value: 3, basis: "t" },
    flightFarePerPerson: { value: 120, basis: "t" }, flightHoursDoorToDoor: { value: 2.5, basis: "t" },
    airportTransfersTotal: { value: 40, basis: "t" }, travelers: { value: 1, basis: "t" },
    valueOfTimePerHourPerPerson: { value: 200, basis: "t" }
  });
  const tieTrip = judgeBudget(
    { days: [{ dayNumber: 1, items: [meal("a")] }], budgetCap: { amount: 100, currency: "CAD" }, travelers },
    { scope: { lodging: null, transport: { estimate: tie } } }
  );
  const traTie = tieTrip.components.find((c) => c.component === "transport");
  ok(tie.bothOptionsEmitted && !traTie.evidenced && traTie.evidence.range === null, "all-in L5: both options + no selection = named-not-counted");
  eqC(tieTrip.totals, { low: 24, high: 60, currency: "CAD" }, "all-in L5: totals carry the meal only");

  // L6 — a day trip has no lodging line at all: not applicable, out
  // of the coverage denominator, and the note says so.
  const lodDay = dayTrip.components.find((c) => c.component === "lodging");
  ok(lodDay.applicable === false && dayTrip.scopeLines === 2, "all-in L6: day trip — lodging not applicable; scope = 1 item + getting-there");
  ok(dayTrip.scopeNote.includes("lodging: not applicable"), "all-in L6: the scope note states the day-trip lodging posture");

  // L7 — the reckoning sees component reals: a paid flight + a paid
  // stay are VERIFIED reals at AFTER, invisible at BEFORE, and they
  // never calibrate (calibration stays plan-item-only).
  const bvrItinerary = {
    tripRef: "allin-synthetic",
    travelers,
    budgetCap: { amount: 1100, currency: "CAD" },
    days: [
      { dayNumber: 1, items: [{ type: "stop", kind: "museum", key: "citadel", name: "Citadel", start: 600, end: 690 }] },
      { dayNumber: 2, items: [] }
    ]
  };
  const compFacts = [
    { itemKey: "flight-ac1", component: "transport", reference: "AC-TEST-1", price: { amount: 412, currency: "CAD", status: "paid" } },
    { itemKey: "hotel-h1", component: "lodging", reference: "HTL-TEST-1", price: { amount: 368, currency: "CAD", status: "paid" } }
  ];
  const libStore = createLibraryStore();
  const afterC = runCheckpoint(bvrItinerary, "AFTER", { now: "2026-11-05T00:00:00Z", bookingFacts: compFacts, library: libStore });
  const traC = afterC.components.find((c) => c.component === "transport");
  const lodC = afterC.components.find((c) => c.component === "lodging");
  eq(traC.real?.amountParty, 412, "all-in L7: the paid flight is a real in the reckoning");
  eq(lodC.real?.amountParty, 368, "all-in L7: the paid stay is a real in the reckoning");
  eq(traC.verdict, "INSIDE-RANGE", "all-in L7: the booked price is the component's own VERIFIED evidence");
  eq(afterC.rollups.trip.realTotal, 780, "all-in L7: trip real total = flight 412 + stay 368 (the plan item has no real)");
  eq(afterC.regrade.realItems, 2, "all-in L7: the re-grade counts both component reals");
  eqC(afterC.regrade.totals, { low: 804, high: 832, currency: "CAD" }, "all-in L7: re-grade totals = component reals (780 as points) + the museum's COSTED party range (24–52)");
  const beforeC = runCheckpoint(bvrItinerary, "BEFORE", { now: "2026-10-01T00:00:00Z", bookingFacts: compFacts, library: libStore });
  ok(beforeC.components.every((c) => c.real === null), "all-in L7: BEFORE never sees booking facts — component reals stay unspoken");
  const writes = calibrate(afterC.items, libStore, { now: "2026-11-05T00:00:00Z" });
  eq(writes.length, 0, "all-in L7: component reals never calibrate the item library");
  eq(Object.keys(libStore.records).length, 0, "all-in L7: the library is untouched by component facts");

  // L8 — a component real ABOVE its band estimate grades ABOVE and
  // re-grades at the real point (a real replaces both range ends).
  const bandItinerary = {
    ...bvrItinerary,
    scope: { lodging: { name: "Banded Stay", nights: 1, priceBandLevel: "PRICE_LEVEL_MODERATE", priceBandSource: "google" }, transport: null }
  };
  const above = runCheckpoint(bandItinerary, "AFTER", {
    now: "2026-11-05T00:00:00Z",
    bookingFacts: [{ itemKey: "hotel-h9", component: "lodging", reference: "HTL-TEST-9", price: { amount: 500, currency: "CAD", status: "paid" } }],
    library: createLibraryStore()
  });
  const lodAbove = above.components.find((c) => c.component === "lodging");
  eq(lodAbove.verdict, "ABOVE", "all-in L8: paid 500 vs band estimate 110–180 grades ABOVE");
  eqC(above.regrade.totals, { low: 524, high: 552, currency: "CAD" }, "all-in L8: re-grade = the real 500 as a point (not the 110–180 band) + the museum's range 24–52");
}

console.log(`roamly wiring phase2 golden checks: ${count}/${count} PASS`);
