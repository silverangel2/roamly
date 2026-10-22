import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { InMemoryPackStore, candidateContentHash } from "@/lib/roamly/engine/packs/store.ts";
import {
  assemblePinnedEnginePack,
  candidateRowToDTO,
  seedDestinationFromRecordedPack
} from "@/lib/roamly/engine/packs/builder.ts";
import { breadthDestination } from "@/lib/roamly/engine/packs/destinations.ts";
import { PACK_CLASSIFIER_VERSION } from "@/lib/roamly/engine/packs/types.ts";
import { PACK_SCHEMA_VERSION, parseCandidateDTO } from "@/lib/roamly/engine/types.ts";
import { PlacesEnrichmentService, buildTextSearchRequest, finalistKeysFromPlan } from "@/lib/roamly/engine/places/enrich.ts";
import { HttpPlacesClient, PlacesProviderError, placesClientFromEnv } from "@/lib/roamly/engine/places/client.ts";
import { evaluateMatch } from "@/lib/roamly/engine/places/normalize.ts";
import {
  InMemoryPlacesLedgerStore,
  PlacesLedgerError,
  capsFromEnv,
  grossCostUsd,
  monthlyCostReport,
  monthKeyOf,
  placesLedgerSettingKey
} from "@/lib/roamly/engine/places/ledger.ts";
import { MATCH_GATE_KM, PLACES_DEFAULT_CAPS } from "@/lib/roamly/engine/places/types.ts";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";
import { scoreStays } from "@/lib/roamly/engine/anchors.ts";
import { extractConstraints, specConstraints, gradeRequirements } from "@/lib/roamly/engine/understand.ts";
import { judgeTrip } from "@/lib/roamly/engine/judges.ts";
import { buildPredictions } from "@/lib/roamly/engine/predict.ts";
import { newComposerState, composeDay } from "@/lib/roamly/engine/frames.ts";
import { partyProfile } from "@/lib/roamly/engine/journey.ts";
import { auditTrip } from "@/lib/roamly/engine/emotion.ts";
import { buildTripArc, buildCommitmentLedger, reconcileLedger, judgeContinuity, peakScoresFromDays } from "@/lib/roamly/engine/continuity.ts";
import { fmt, isoPlus, parseHhmm } from "@/lib/roamly/engine/util.ts";

// Phase 4 golden checks (DESIGN-PRODUCTION.md Phase 4 proof):
// the Places provider + cost-guard ledger — the distance gate
// replayed over the LIVE proof's recorded responses (exactly one
// rejection: Galerie Bédard, 87.39 km), reserve/commit/release
// ledger arithmetic with cap refusals recorded BEFORE any call,
// cache-first with zero provider calls, single-flight concurrency,
// unknown-outcome reconciliation, enrichment write-back that never
// moves the base candidate layer, and the solver spot-proof over
// the enriched pinned Quebec pack.
// Run a single section with: --only=<A|B|C|D|E|F|G|H>

const ONLY = new Set(((process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)).split(",").filter(Boolean));
const section = (name) => ONLY.size === 0 || ONLY.has(name);

const FIX4 = new URL("./fixtures/wiring-phase4/", import.meta.url);
const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
const FIX1 = new URL("./fixtures/wiring-phase1/", import.meta.url);
const load = (name, base = FIX4) => JSON.parse(readFileSync(new URL(name, base), "utf8"));
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
  assert.equal(a, b, `${label}\n  GOT:    ${String(a).slice(0, 300)}\n  WANT:   ${String(b).slice(0, 300)}`);
}
async function throwsCode(promise, code, label) {
  count += 1;
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof PlacesLedgerError && err.code === code, `${label} — wrong error: ${err}`);
    return;
  }
  assert.fail(`${label} — expected PlacesLedgerError ${code}, but the call succeeded`);
}
function fakeClock(startIso) {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t), advanceMs: (ms) => { t += ms; }, set: (iso) => { t = new Date(iso).getTime(); } };
}
const WORKER = { workerId: "phase4-proof" };
const SCOPE = "roamly-production";

const targetsDoc = load("targets.json");
const TARGETS = targetsDoc.targets;
const ANALYSIS = load("analysis-rows.json");
const LIVE_RESULTS = new Map(load("results.json").results.map((r) => [r.key, r]));

/* A recorded-response Places client: searches resolve by the
 * request's bias centre (the candidate's recorded OSM position) to
 * the live proof's cached search response; details resolve by
 * Place ID to the cached details response. No network, ever. */
class RecordedPlacesClient {
  sourceLabel = "google";
  constructor() {
    this.searchCalls = [];
    this.detailsCalls = [];
    this.byPos = new Map(TARGETS.map((t) => [`${t.pos.lat}|${t.pos.lon}`, t]));
  }
  async textSearch(request) {
    this.searchCalls.push(request);
    const c = request.locationBias.circle.center;
    const target = this.byPos.get(`${c.latitude}|${c.longitude}`);
    if (!target) throw new Error(`recorded client: no target at bias centre ${c.latitude},${c.longitude}`);
    return load(`searches/search-${target.key.replace("/", "_")}.json`);
  }
  async placeDetails(placeId) {
    this.detailsCalls.push(placeId);
    return load(`details/details-${placeId}.json`);
  }
}

/* A synthetic Places client with programmable handlers + call logs. */
class FakePlacesClient {
  sourceLabel = "google";
  constructor(handler, delayMs = 0) {
    this.searchCalls = [];
    this.detailsCalls = [];
    this.handler = handler;
    this.delayMs = delayMs;
  }
  async pause() {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
  }
  async textSearch(request) {
    this.searchCalls.push(request);
    await this.pause();
    return this.handler.search(request);
  }
  async placeDetails(placeId) {
    this.detailsCalls.push(placeId);
    await this.pause();
    return this.handler.details(placeId);
  }
}
const nearHitHandler = {
  search: (req) => {
    const c = req.locationBias.circle.center;
    return { places: [{ id: "ChIJfake", displayName: { text: "Synthetic Place" }, location: { latitude: c.latitude + 0.0005, longitude: c.longitude } }] };
  },
  details: (placeId) => ({
    id: placeId,
    displayName: { text: "Synthetic Place" },
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }] },
    priceLevel: "PRICE_LEVEL_MODERATE",
    rating: 4.4,
    userRatingCount: 12,
    accessibilityOptions: { wheelchairAccessibleEntrance: true },
    businessStatus: "OPERATIONAL"
  })
};

function storedCandidateOf(target, kind) {
  return {
    candidateKey: `osm:${target.key}`,
    osmKey: target.key,
    kind: kind || (target.group === "foods" ? "food" : "attraction"),
    name: target.name,
    nameEn: null,
    pos: target.pos,
    hoursRaw: target.osmHoursRaw ?? null,
    tags: {},
    url: `https://www.openstreetmap.org/${target.key}`,
    enrichment: null
  };
}

async function publishCandidates(store, destination, candidates, clockIso) {
  if (!(await store.getDestination(destination.destinationId))) {
    await store.registerDestination(destination);
  }
  const { job } = await store.enqueueBuild(destination.destinationId, "phase4-proof");
  const lease = await store.claimBuild(job.jobId, WORKER.workerId, 10 * 60 * 1000);
  const version = await store.beginVersion(job.jobId, lease.leaseId, PACK_CLASSIFIER_VERSION, PACK_SCHEMA_VERSION);
  return store.publishVersion(version.dto.packVersionId, job.jobId, lease.leaseId, candidates, {
    source: "phase4-proof",
    sourceRef: job.jobId,
    recordedAt: clockIso,
    label: "Phase 4 proof version (recorded input)"
  });
}

/* ------------------------------------------------------------------ */
/* A. The recorded live proof, replayed through the provider           */
/* ------------------------------------------------------------------ */
let replaySummary = null;
if (section("A")) {
  const clock = fakeClock("2026-10-22T12:00:00.000Z");
  const store = new InMemoryPackStore(clock.now);
  const quebec = breadthDestination("Quebec City");
  const version = await publishCandidates(store, quebec, TARGETS.map((t) => storedCandidateOf(t)), "2026-10-22T12:00:00.000Z");
  const ledger = new InMemoryPlacesLedgerStore(clock.now);
  const client = new RecordedPlacesClient();
  const service = new PlacesEnrichmentService({ store, ledger, client, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const report = await service.enrichPackFinalists(version.dto.packVersionId, TARGETS.map((t) => t.key));

  eq(report.mode, "live", "A: replay runs in live mode over recorded responses");
  eq(report.finalists, 26, "A: 26 recorded finalists");
  eq(report.enriched, 25, "A: 25 finalists enriched");
  eq(report.rejectedMatches.length, 1, "A: exactly ONE distance-gate rejection (the shadow outcome)");
  const rejection = report.rejectedMatches[0];
  eq(rejection.name, "Galerie Bédard", "A: the rejection is Galerie Bédard");
  eq(rejection.rejection.reason, "distance-gate", "A: rejection reason is the distance gate");
  eq(rejection.rejection.distanceKm, 87.39, "A: Bédard's recorded distance reproduces exactly (87.39 km)");
  ok(rejection.rejection.distanceKm > 80, "A: Bédard's hit sits >80 km away (Baie-Saint-Paul)");
  eq(client.searchCalls.length, 26, "A: one Text Search per finalist");
  eq(client.detailsCalls.length, 25, "A: details fetched for the 25 gated matches only");
  ok(!client.detailsCalls.includes(rejection.rejection.placeId), "A: NO details call was made for the rejected Bédard hit");

  let exactDistances = 0;
  for (const outcome of report.outcomes) {
    const live = LIVE_RESULTS.get(outcome.osmKey);
    if (outcome.osmKey === "node/6711176112") {
      eq(outcome.outcome, "rejected", "A: Bédard's outcome is the rejection");
      continue;
    }
    eq(outcome.outcome, "enriched", `A: ${outcome.name} enriched`);
    const recorded = live.matched.distanceKm;
    ok(Math.abs(outcome.distanceKm - recorded) <= 0.02, `A: ${outcome.name} gate distance ${outcome.distanceKm} within 0.02 of the recorded ${recorded}`);
    if (outcome.distanceKm === recorded) exactDistances += 1;
    eq(outcome.matchedName, live.matched.displayName, `A: ${outcome.name} matched display name reproduces`);
  }
  ok(exactDistances >= 20, `A: gate distances reproduce to the recorded 2dp for ${exactDistances}/25 matches`);

  // Hours truth, restated the collector-fix way over the 20 graded.
  const outcomeByKey = new Map(report.outcomes.map((o) => [o.osmKey, o]));
  const graded = ANALYSIS.filter((r) => r.graded);
  eq(graded.length, 20, "A: 20 graded items in the recorded set");
  const gatedUnknown = graded.filter((r) => {
    const o = outcomeByKey.get(r.key);
    return !(r.osmKnown || (o.outcome === "enriched" && o.hoursKnown));
  }).length;
  const ungatedUnknown = graded.filter((r) => !(r.osmKnown || r.liveHours != null)).length;
  eq(gatedUnknown, 8, "A: hours UNKNOWN over the graded 20 is 8 under the gate (the fixed collector's figure)");
  eq(ungatedUnknown, 7, "A: the ungated collector would have claimed 7 (one of them the WRONG business)");

  // The live proof's two named catches, as fixtures.
  const naval = outcomeByKey.get("way/106776418");
  eq(naval.businessStatus, "CLOSED_TEMPORARILY", "A: Musée Naval de Québec is stamped CLOSED_TEMPORARILY");
  const fort = outcomeByKey.get("node/283264348");
  eq(fort.businessStatus, "CLOSED_TEMPORARILY", "A: Musée du Fort is stamped CLOSED_TEMPORARILY");
  const don = outcomeByKey.get("node/12326897876");
  eq(don.matchedName, "Le Don Restaurant", "A: Don Vegan's Google name is 'Le Don Restaurant'");
  eq(don.renamed, true, "A: the rename is surfaced as a rename (OSM name kept on the plan)");

  // Stored records + the ledger trail.
  const rows = await store.getVersionCandidates(version.dto.packVersionId);
  const rowByKey = new Map(rows.map((r) => [r.osmKey, r]));
  const bedardRow = rowByKey.get("node/6711176112");
  eq(bedardRow.enrichment.matchRejected.reason, "distance-gate", "A: Bédard's row carries the rejection record as provenance");
  eq(bedardRow.enrichment.placeId, null, "A: Bédard's row has NO place attached");
  eq(bedardRow.enrichment.matchRejected.distanceKm, 87.39, "A: the rejection record keeps the 87.39 km distance");
  const navalRow = rowByKey.get("way/106776418");
  eq(navalRow.enrichment.businessStatus, "CLOSED_TEMPORARILY", "A: the Naval museum's stored record carries CLOSED_TEMPORARILY");
  eq(candidateRowToDTO(navalRow, version.dto.builtAt).enrichment.hoursStatus, "closed-temporarily", "A: the boundary DTO surfaces the Naval museum as closed-temporarily");
  eq(candidateRowToDTO(bedardRow, version.dto.builtAt).enrichment, null, "A: the boundary DTO shows NO enrichment for the rejected Bédard (a rejection is provenance, not data)");
  const donRow = rowByKey.get("node/12326897876");
  eq(donRow.enrichment.placeId, LIVE_RESULTS.get("node/12326897876").matched.placeId, "A: Don Vegan's stored record carries the verified Place ID");
  eq(donRow.enrichment.priceLevel, "PRICE_LEVEL_MODERATE", "A: price arrives as a BAND (priceLevel), never a price");
  for (const row of rows) {
    if (row.osmKey === "node/6711176112") continue;
    const op = await ledger.getOperation(row.enrichment.operationKey);
    ok(op && op.status === "committed" && op.sku === "placeDetails", `A: ${row.name}'s enrichment links to its committed details operation`);
    const parsed = parseCandidateDTO(candidateRowToDTO(row, version.dto.builtAt));
    ok(parsed.ok, `A: ${row.name}'s row converts to a valid CandidateDTO with its live enrichment${parsed.ok ? "" : ": " + parsed.errors.join("; ")}`);
  }
  const bedardSearchOp = await ledger.getOperation(bedardRow.enrichment.operationKey);
  ok(bedardSearchOp && bedardSearchOp.sku === "textSearch" && bedardSearchOp.status === "committed", "A: Bédard's rejection record links to its committed SEARCH operation (the search ran and is billable)");

  const counters = await ledger.getCounters(SCOPE, "2026-10");
  eq(counters.textSearch.committed, 26, "A: ledger committed 26 searches");
  eq(counters.placeDetails.committed, 25, "A: ledger committed 25 details");
  eq(counters.textSearch.reserved + counters.placeDetails.reserved, 0, "A: no reservation left outstanding after a clean run");
  eq((await ledger.listOperations(SCOPE, "2026-10")).length, 51, "A: 51 ledger operations recorded (26 searches + 25 details)");
  eq(report.callsThisRun.textSearch, 26, "A: the run reports its own 26 searches");
  eq(report.callsThisRun.placeDetails, 25, "A: the run reports its own 25 details");
  eq(report.cost.billableUsd, 0, "A: the replay month bills $0 (inside the free allotments)");
  eq(report.cost.grossUsd, grossCostUsd({ textSearch: 26, placeDetails: 25 }), "A: gross is the committed calls at list prices");
  ok(report.cost.grossUsd > 0, "A: gross is honestly non-zero (the calls have list value; the allotments cover them)");

  // The request the provider builds (shadow discipline, verbatim).
  const first = client.searchCalls[0];
  eq(first.maxResultCount, 3, "A: Text Search caps at 3 results (shadow discipline)");
  eq(first.locationBias.circle.radius, MATCH_GATE_KM * 1000, "A: the location bias circle is the 2 km gate radius");
  eq(first.textQuery, `${TARGETS[0].name}, Quebec City, Canada`, "A: the query is name + destination + country");
  eq(MATCH_GATE_KM, 2, "A: the gate threshold is the CONTRACTS 2 km");
  replaySummary = { exactDistances };
}

/* ------------------------------------------------------------------ */
/* B. Ledger arithmetic, month rollover, env caps, cost report         */
/* ------------------------------------------------------------------ */
if (section("B")) {
  const clock = fakeClock("2026-10-31T23:00:00.000Z");
  const ledger = new InMemoryPlacesLedgerStore(clock.now);
  const input = (sku, n) => ({ scope: SCOPE, sku, cap: 4500, packVersionId: "packv:test", candidateKey: `osm:node/${n}` });

  let counters = await ledger.getCounters(SCOPE, "2026-10");
  eq(counters.textSearch.committed + counters.placeDetails.committed, 0, "B: an untouched month reads as zeroes (reading creates no spend)");
  eq(placesLedgerSettingKey(SCOPE, "2026-10"), "places_ledger:v1:roamly-production:2026-10", "B: the admin_settings key carries scope + month");

  const op1 = await ledger.tryReserve(input("placeDetails", 1));
  ok(op1 && op1.status === "reserved", "B: a reservation lands in reserved state");
  counters = await ledger.getCounters(SCOPE, "2026-10");
  eq(counters.placeDetails.reserved, 1, "B: reserve increments reserved");
  eq(counters.placeDetails.committed, 0, "B: reserve does not touch committed");
  await ledger.release(op1.operationKey, "call provably never made");
  counters = await ledger.getCounters(SCOPE, "2026-10");
  eq(counters.placeDetails.reserved, 0, "B: release returns the unit to the pool");
  eq((await ledger.getOperation(op1.operationKey)).status, "released", "B: the released operation keeps its record");

  const op2 = await ledger.tryReserve(input("placeDetails", 2));
  await ledger.commit(op2.operationKey);
  counters = await ledger.getCounters(SCOPE, "2026-10");
  eq(counters.placeDetails.committed, 1, "B: commit moves reserved -> committed");
  eq(counters.placeDetails.reserved, 0, "B: commit leaves nothing reserved");
  await throwsCode(ledger.commit(op2.operationKey), "OPERATION_ALREADY_SETTLED", "B: a settled operation cannot settle twice");
  await throwsCode(ledger.release("placesop:missing", "x"), "OPERATION_NOT_FOUND", "B: an unknown operation key is refused loudly");

  // Reconciliation holds the unit against the cap until settled.
  const tiny = new InMemoryPlacesLedgerStore(clock.now);
  const rop = await tiny.tryReserve({ scope: SCOPE, sku: "textSearch", cap: 1, packVersionId: "packv:t", candidateKey: "osm:node/9" });
  await tiny.markReconciliation(rop.operationKey, "outcome unknown");
  eq(await tiny.tryReserve({ scope: SCOPE, sku: "textSearch", cap: 1, packVersionId: "packv:t", candidateKey: "osm:node/10" }), null, "B: a reconciling unit still counts against the cap (never double-spent)");
  await tiny.commit(rop.operationKey);
  eq((await tiny.getCounters(SCOPE, "2026-10")).textSearch.committed, 1, "B: reconciliation can settle to committed once the truth is known");

  // Month rollover: counters and caps are per (scope, month).
  clock.set("2026-11-01T00:01:00.000Z");
  eq(monthKeyOf(clock.now()), "2026-11", "B: the month key rolls over (UTC)");
  const nov = await ledger.getCounters(SCOPE, "2026-11");
  eq(nov.placeDetails.committed, 0, "B: November starts at zero — October's spend does not leak");
  const opNov = await ledger.tryReserve(input("placeDetails", 3));
  eq(opNov.month, "2026-11", "B: a November reservation keys to November");
  eq((await ledger.getCounters(SCOPE, "2026-10")).placeDetails.committed, 1, "B: October's counters are untouched by November's reservation");

  // Env cap overrides (the shadow's discipline).
  eqC(capsFromEnv({}), PLACES_DEFAULT_CAPS, "B: caps default to the CONTRACTS values (9,000 / 4,500)");
  eq(capsFromEnv({ ROAMLY_GOOGLE_DETAILS_CAP_MONTH: "12" }).placeDetails, 12, "B: the details cap is env-overridable");
  eq(capsFromEnv({ ROAMLY_GOOGLE_SEARCH_CAP_MONTH: "nonsense" }).textSearch, 9000, "B: a nonsense env value falls back to the contract default");

  // The monthly cost report: gross at list, net after allotments.
  const rich = { version: 1, scope: SCOPE, month: "2026-10", textSearch: { reserved: 0, committed: 12000 }, placeDetails: { reserved: 0, committed: 6000 }, updatedAt: null };
  const richReport = monthlyCostReport(rich, PLACES_DEFAULT_CAPS);
  eq(richReport.grossUsd, 162, "B: gross = 12,000x$5 + 6,000x$17 per 1,000 = $162.00");
  eq(richReport.billableUsd, 27, "B: billable counts only units past the free allotments (2,000 searches + 1,000 details = $27.00)");
  const capped = { ...rich, textSearch: { reserved: 0, committed: 9000 }, placeDetails: { reserved: 0, committed: 4500 } };
  eq(monthlyCostReport(capped, PLACES_DEFAULT_CAPS).billableUsd, 0, "B: a month AT the caps still bills $0 — the caps sit inside the allotments by construction");
}

/* ------------------------------------------------------------------ */
/* C. Near-cap refusals: refused BEFORE the call, recorded             */
/* ------------------------------------------------------------------ */
if (section("C")) {
  const clock = fakeClock("2026-10-22T12:00:00.000Z");
  const quebec = breadthDestination("Quebec City");
  const twoTargets = [
    { key: "node/900001", name: "Cap Museum One", group: "sights", pos: { lat: 46.81, lon: -71.21 }, osmHoursRaw: null },
    { key: "node/900002", name: "Cap Museum Two", group: "sights", pos: { lat: 46.811, lon: -71.211 }, osmHoursRaw: null }
  ];

  // Details cap: seed the month at 4,499 committed.
  const ledger = new InMemoryPlacesLedgerStore(clock.now);
  for (let i = 0; i < 4499; i++) {
    const seed = await ledger.tryReserve({ scope: SCOPE, sku: "placeDetails", cap: 4500, packVersionId: "packv:seed", candidateKey: `osm:node/seed${i}` });
    await ledger.commit(seed.operationKey);
  }
  eq((await ledger.getCounters(SCOPE, "2026-10")).placeDetails.committed, 4499, "C: the month is seeded at 4,499 details (the shadow proof's setup)");
  const store = new InMemoryPackStore(clock.now);
  const version = await publishCandidates(store, quebec, twoTargets.map((t) => storedCandidateOf(t)), "2026-10-22T12:00:00.000Z");
  const client = new FakePlacesClient(nearHitHandler);
  const service = new PlacesEnrichmentService({ store, ledger, client, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const report = await service.enrichPackFinalists(version.dto.packVersionId, twoTargets.map((t) => t.key));
  eq(report.enriched, 1, "C: exactly one more details call fits under the cap");
  eq(report.refused.length, 1, "C: the second candidate is refused");
  eq(report.refused[0].stage, "place-details", "C: the refusal is at the details stage (its search DID run)");
  ok(report.refused[0].reason.includes("4500/4500"), "C: the refusal records the cap state in provenance");
  eq(client.detailsCalls.length, 1, "C: the refused candidate made NO details call — refusal happens BEFORE the call");
  eq(client.searchCalls.length, 2, "C: both searches ran (search cap untouched)");
  eq((await ledger.getCounters(SCOPE, "2026-10")).placeDetails.committed, 4500, "C: the ledger lands exactly on the 4,500 cap");
  const rows = await store.getVersionCandidates(version.dto.packVersionId);
  eq(rows.find((r) => r.osmKey === "node/900002").enrichment, null, "C: the refused candidate completes OSM-only (no record written — a later cycle may retry)");

  // Search cap: seed the month at 9,000 committed searches.
  const ledger2 = new InMemoryPlacesLedgerStore(clock.now);
  for (let i = 0; i < 9000; i++) {
    const seed = await ledger2.tryReserve({ scope: SCOPE, sku: "textSearch", cap: 9000, packVersionId: "packv:seed", candidateKey: `osm:node/seed${i}` });
    await ledger2.commit(seed.operationKey);
  }
  const store2 = new InMemoryPackStore(clock.now);
  const version2 = await publishCandidates(store2, quebec, [storedCandidateOf(twoTargets[0])], "2026-10-22T12:00:00.000Z");
  const client2 = new FakePlacesClient(nearHitHandler);
  const service2 = new PlacesEnrichmentService({ store: store2, ledger: ledger2, client: client2, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const report2 = await service2.enrichPackFinalists(version2.dto.packVersionId, [twoTargets[0].key]);
  eq(report2.refused.length, 1, "C: at the search cap the candidate is refused");
  eq(report2.refused[0].stage, "text-search", "C: the refusal is at the search stage");
  eq(client2.searchCalls.length + client2.detailsCalls.length, 0, "C: a search-stage refusal makes ZERO provider calls");
  eq((await ledger2.getCounters(SCOPE, "2026-10")).textSearch.committed, 9000, "C: the search ledger does not move on a refusal");
}

/* ------------------------------------------------------------------ */
/* D. Cache-first: fresh records are never re-called                   */
/* ------------------------------------------------------------------ */
if (section("D")) {
  const clock = fakeClock("2026-10-22T12:00:00.000Z");
  const quebec = breadthDestination("Quebec City");
  const freshEnrichment = {
    source: "google", placeId: "ChIJfresh", fetchedAt: "2026-10-20T00:00:00.000Z", refreshDue: "2026-11-19",
    hoursByDay: { Mo: { open: 540, close: 1020 } }, priceLevel: null, rating: 4.2, userRatingCount: 10,
    wheelchairEntrance: null, businessStatus: "OPERATIONAL", matchDistanceKm: 0.1, matchRejected: null, operationKey: "placesop:earlier"
  };
  const freshRejection = {
    source: "google", placeId: null, fetchedAt: "2026-10-20T00:00:00.000Z", refreshDue: "2026-11-19",
    priceLevel: null, rating: null, userRatingCount: null, wheelchairEntrance: null, businessStatus: null,
    matchDistanceKm: null, operationKey: "placesop:earlier-search",
    matchRejected: { reason: "distance-gate", matchedName: "Far Away Twin", placeId: "ChIJfar", distanceKm: 41.2, thresholdKm: 2 }
  };
  const staleEnrichment = { ...freshEnrichment, placeId: "ChIJstale", fetchedAt: "2026-09-01T00:00:00.000Z", refreshDue: "2026-10-01" };
  const mk = (key, name, enrichment) => ({
    candidateKey: `osm:${key}`, osmKey: key, kind: "museum", name, nameEn: null,
    pos: { lat: 46.81, lon: -71.21 }, hoursRaw: null, tags: {}, url: `https://www.openstreetmap.org/${key}`, enrichment
  });
  const store = new InMemoryPackStore(clock.now);
  const version = await publishCandidates(store, quebec, [
    mk("node/910001", "Fresh Museum", freshEnrichment),
    mk("node/910002", "Rejected Museum", freshRejection),
    mk("node/910003", "Stale Museum", staleEnrichment)
  ], "2026-10-22T12:00:00.000Z");
  const ledger = new InMemoryPlacesLedgerStore(clock.now);
  const client = new FakePlacesClient(nearHitHandler);
  const service = new PlacesEnrichmentService({ store, ledger, client, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const report = await service.enrichPackFinalists(version.dto.packVersionId, ["node/910001", "node/910002", "node/910003"]);
  const byKey = new Map(report.outcomes.map((o) => [o.osmKey, o]));
  eq(byKey.get("node/910001").outcome, "from-cache", "D: a fresh enrichment record serves from cache");
  eq(byKey.get("node/910002").outcome, "rejected-from-cache", "D: a fresh REJECTION record also serves from cache (rejections are cached, shadow discipline)");
  eq(report.rejectedMatches.length, 1, "D: the cached rejection is re-reported in the run's provenance");
  eq(byKey.get("node/910003").outcome, "enriched", "D: a record past its refresh date is re-fetched");
  eq(client.searchCalls.length, 1, "D: exactly one search — for the stale candidate only");
  eq(client.detailsCalls.length, 1, "D: exactly one details call — for the stale candidate only");
  eq((await ledger.listOperations(SCOPE, "2026-10")).length, 2, "D: the ledger saw only the stale candidate's two operations (the guard is not consulted for cache hits)");
  const rows = await store.getVersionCandidates(version.dto.packVersionId);
  eq(rows.find((r) => r.osmKey === "node/910001").enrichment.placeId, "ChIJfresh", "D: the fresh record is untouched");
  eq(rows.find((r) => r.osmKey === "node/910003").enrichment.fetchedAt, "2026-10-22T12:00:00.000Z", "D: the stale record is replaced with this run's fetch");
}

/* ------------------------------------------------------------------ */
/* E. Race: concurrent runs spend once per candidate per cycle         */
/* ------------------------------------------------------------------ */
if (section("E")) {
  const clock = fakeClock("2026-10-22T12:00:00.000Z");
  const quebec = breadthDestination("Quebec City");
  const targets = [1, 2, 3, 4].map((i) => ({
    key: `node/92000${i}`, name: `Race Museum ${i}`, group: "sights", pos: { lat: 46.81 + i * 0.001, lon: -71.21 }, osmHoursRaw: null
  }));
  const store = new InMemoryPackStore(clock.now);
  const version = await publishCandidates(store, quebec, targets.map((t) => storedCandidateOf(t)), "2026-10-22T12:00:00.000Z");
  const ledger = new InMemoryPlacesLedgerStore(clock.now);
  const client = new FakePlacesClient(nearHitHandler, 30);
  const service = new PlacesEnrichmentService({ store, ledger, client, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const keys = targets.map((t) => t.key);
  const [runA, runB] = await Promise.all([
    service.enrichPackFinalists(version.dto.packVersionId, keys),
    service.enrichPackFinalists(version.dto.packVersionId, keys)
  ]);
  eq(client.searchCalls.length, 4, "E: two concurrent runs make ONE search per candidate");
  eq(client.detailsCalls.length, 4, "E: two concurrent runs make ONE details call per candidate");
  eq(runA.enriched, 4, "E: the first run enriches all four");
  ok(runB.outcomes.every((o) => o.coalesced === true || o.outcome === "from-cache"), "E: the twin run coalesces or serves from cache for every candidate — it never re-spends");
  const counters = await ledger.getCounters(SCOPE, "2026-10");
  eq(counters.textSearch.committed, 4, "E: the ledger committed exactly 4 searches across both runs");
  eq(counters.placeDetails.committed, 4, "E: the ledger committed exactly 4 details across both runs");
}

/* ------------------------------------------------------------------ */
/* F. Unknown outcomes + the HTTP client's wire discipline             */
/* ------------------------------------------------------------------ */
if (section("F")) {
  const clock = fakeClock("2026-10-22T12:00:00.000Z");
  const quebec = breadthDestination("Quebec City");
  const target = { key: "node/930001", name: "Fragile Museum", group: "sights", pos: { lat: 46.81, lon: -71.21 }, osmHoursRaw: null };

  // Details call throws: search commits, details reconciles.
  const store = new InMemoryPackStore(clock.now);
  const version = await publishCandidates(store, quebec, [storedCandidateOf(target)], "2026-10-22T12:00:00.000Z");
  const ledger = new InMemoryPlacesLedgerStore(clock.now);
  const throwing = new FakePlacesClient({
    search: nearHitHandler.search,
    details: () => { throw new Error("socket reset mid-response"); }
  });
  const service = new PlacesEnrichmentService({ store, ledger, client: throwing, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const report = await service.enrichPackFinalists(version.dto.packVersionId, [target.key]);
  eq(report.outcomes[0].outcome, "reconciliation", "F: a details call with an unknown outcome lands in reconciliation");
  eq(report.reconciliations.length, 1, "F: the reconciliation is reported in provenance");
  eq(report.reconciliations[0].sku, "placeDetails", "F: the reconciling operation is the details reservation");
  let counters = await ledger.getCounters(SCOPE, "2026-10");
  eq(counters.textSearch.committed, 1, "F: the search (known outcome) committed");
  eq(counters.placeDetails.committed, 0, "F: the unknown details call did NOT commit");
  eq(counters.placeDetails.reserved, 1, "F: the unknown details unit STAYS counted (it may have been billed)");
  eq((await store.getVersionCandidates(version.dto.packVersionId))[0].enrichment, null, "F: no enrichment is written on an unknown outcome");
  const reconOp = await ledger.getOperation(report.reconciliations[0].operationKey);
  eq(reconOp.status, "reconciliation", "F: the operation record carries the reconciliation status");

  // Search call throws: reconciliation at the search stage.
  const store2 = new InMemoryPackStore(clock.now);
  const version2 = await publishCandidates(store2, quebec, [storedCandidateOf(target)], "2026-10-22T12:00:00.000Z");
  const ledger2 = new InMemoryPlacesLedgerStore(clock.now);
  const throwingSearch = new FakePlacesClient({
    search: () => { throw new Error("DNS failure"); },
    details: nearHitHandler.details
  });
  const service2 = new PlacesEnrichmentService({ store: store2, ledger: ledger2, client: throwingSearch, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const report2 = await service2.enrichPackFinalists(version2.dto.packVersionId, [target.key]);
  eq(report2.outcomes[0].outcome, "reconciliation", "F: a search with an unknown outcome also reconciles");
  eq(report2.outcomes[0].stage, "text-search", "F: ... at the search stage");
  eq(throwingSearch.detailsCalls.length, 0, "F: no details call follows an unknown search");

  // The HTTP client: exact wire discipline over a recording fetcher.
  const recorded = [];
  const okFetcher = async (url, init) => {
    recorded.push({ url, init });
    const body = url.includes("searchText")
      ? { places: [{ id: "ChIJx", displayName: { text: "X" }, location: { latitude: 46.81, longitude: -71.21 } }] }
      : { id: "ChIJx", displayName: { text: "X" }, businessStatus: "OPERATIONAL" };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const http = new HttpPlacesClient("test-key-not-a-real-key", okFetcher, { attemptTimeoutMs: 1000 });
  const req = buildTextSearchRequest("Fragile Museum", "Quebec City", "Canada", { lat: 46.81, lon: -71.21 });
  await http.textSearch(req);
  eq(recorded[0].url, "https://places.googleapis.com/v1/places:searchText", "F: Text Search hits the Places API (New) endpoint");
  eq(recorded[0].init.method, "POST", "F: Text Search is a POST");
  eq(recorded[0].init.headers["X-Goog-Api-Key"], "test-key-not-a-real-key", "F: the key travels in the X-Goog-Api-Key header (never in a URL or a record)");
  eq(recorded[0].init.headers["X-Goog-FieldMask"], "places.id,places.displayName,places.location", "F: the search field mask is exact (id + name + location only)");
  const sentBody = JSON.parse(recorded[0].init.body);
  eq(sentBody.textQuery, "Fragile Museum, Quebec City, Canada", "F: the sent query is name + destination + country");
  eq(sentBody.locationBias.circle.radius, 2000, "F: the sent bias radius is the 2 km gate in metres");
  await http.placeDetails("ChIJx");
  eq(recorded[1].url, "https://places.googleapis.com/v1/places/ChIJx", "F: Place Details hits the place resource");
  eq(recorded[1].init.headers["X-Goog-FieldMask"], "id,displayName,regularOpeningHours,currentOpeningHours,priceLevel,rating,userRatingCount,accessibilityOptions,businessStatus", "F: the details field mask is the exact Pro mask the engine consumes");

  const errFetcher = async () => ({ ok: false, status: 403, text: async () => "{}" });
  const httpErr = new HttpPlacesClient("k", errFetcher, { attemptTimeoutMs: 1000 });
  let caught = null;
  try { await httpErr.placeDetails("ChIJx"); } catch (e) { caught = e; }
  ok(caught instanceof PlacesProviderError && caught.status === 403, "F: an HTTP error surfaces as PlacesProviderError with its status");

  const hangFetcher = () => new Promise(() => {});
  const httpSlow = new HttpPlacesClient("k", hangFetcher, { attemptTimeoutMs: 25 });
  caught = null;
  try { await httpSlow.textSearch(req); } catch (e) { caught = e; }
  ok(caught instanceof PlacesProviderError && caught.status === null, "F: a call that never answers is bounded by the timeout and surfaces as an unknown outcome (status null)");
}

/* ------------------------------------------------------------------ */
/* G. Enrichment separation + the solver spot-proof (pinned Quebec)    */
/* ------------------------------------------------------------------ */
let solverSummary = null;
if (section("G")) {
  const clock = fakeClock("2026-10-22T00:00:00.000Z");
  const store = new InMemoryPackStore(clock.now);
  const quebec = breadthDestination("Quebec City");
  const enrichedPack = loadData("packs/pack-quebec-city-enriched.json", FIX2);
  const { version } = await seedDestinationFromRecordedPack(store, quebec, enrichedPack, WORKER);
  await store.pinVersion("gen-quebec-phase4", version.dto.packVersionId);
  const weather = await store.getWeatherSnapshot(quebec.destinationId, "forecast", enrichedPack.startIso, enrichedPack.endIso);
  ok(weather !== null, "G: the seeded weather snapshot is readable by range");
  const assembledPre = await assemblePinnedEnginePack(store, "gen-quebec-phase4", weather);
  ok(assembledPre !== null, "G: the pinned pack assembles for the solver");
  eq(assembledPre.pack.counts.total, 852, "G: assembled pack carries all 852 candidates");

  const scenarios = loadData("scenarios.json", FIX2);
  const sc = scenarios.find((s) => s.entry.id === "quebec-city-family");
  const entry = sc.entry;
  const frozen = load("frozen/quebec-city-family/itinerary.json", FIX2);
  const frozenGrades = load("frozen/quebec-city-family/grades.json", FIX2);
  const frozenPred = load("frozen/quebec-city-family/predictions.json", FIX2);
  const dates = Array.from({ length: entry.days }, (_, i) => isoPlus(sc.startDate, i));
  const extracted = extractConstraints(sc.requestText);
  const truth = specConstraints(entry);
  const earliestMin = parseHhmm(extracted.earliestStart || truth.earliestStart || "09:00");
  const restSpec = extracted.rest || truth.rest;
  const mustSees = (entry.checks || []).filter((c) => c.kind === "keyword").map((c) => ({ id: c.id, label: c.label, patterns: c.patterns }));

  // The Phase 2 Quebec pipeline (Phase 3 §G verbatim), returning the
  // verdict bundle the golden run froze.
  const runPipeline = (pack) => {
    const stays = scoreStays(pack);
    const anchorStay = stays[0] || null;
    const basePos = anchorStay?.pos || { lat: entry.coordinates.latitude, lon: entry.coordinates.longitude };
    const baseName = anchorStay ? anchorStay.name : `${entry.destination} centre (base anchor)`;
    const plan = solveTrip(pack, { days: entry.days, startIso: sc.startDate, dates, earliestMin, restSpec, mustSees, basePos, baseName });
    const state = newComposerState();
    const weatherByDate = Object.fromEntries(pack.weather.map((w) => [w.date, w]));
    const ctx = { earliestLabel: truth.earliestStart || "09:00", stay: anchorStay ? { name: anchorStay.name, walkableSights: anchorStay.walkableSights } : null, weatherByDate, baseName, hasDietary: (truth.dietary || []).length > 0 };
    for (const day of plan.days) day.narrative = composeDay(day, ctx, state);
    const candByKey = new Map([...pack.sights, ...pack.foods, ...pack.stays, ...pack.excursions, ...pack.transport].map((c) => [c.key, c]));
    const daysOut = plan.days.map((day) => ({
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
    const judge = judgeTrip(plan.days, { earliestMin });
    const verdicts = gradeRequirements({ days: daysOut.map((d) => ({ ...d, narrative: d.narrative.join("\n") })) }, truth, entry.checks);
    const itineraryLike = { days: daysOut, travelers: entry.travelers, budgetCap: { amount: entry.budgetAmount, currency: entry.budgetCurrency, verdict: "" }, destination: entry.destination };
    // ALL-IN scope (owner decision, 2026-10-22): the anchor-stay
    // lodging input, exactly as the Phase 2 §B pipeline passes it.
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
    const prof = partyProfile(entry, entry.request?.party || "");
    const emo = auditTrip(daysOut, { profile: prof });
    const emoText = emo.hard ? `FAIL (${emo.hard} hard: ${emo.findings.filter((f) => f.severity === "hard").map((f) => f.check).join(", ")})` : `PASS (${emo.findings.length} findings, ${emo.soft} soft)`;
    const arcB = buildTripArc({ types: daysOut.map((d) => d.dayType || "FULL"), peakScoreByDay: peakScoresFromDays(daysOut), envelopeDeparture: daysOut.some((d) => d.envelope?.departure) });
    const ledgerB = reconcileLedger(buildCommitmentLedger(daysOut, { mustSeeResults: plan.mustSeeResults }), daysOut);
    const contText = judgeContinuity(daysOut, { arc: arcB, ledger: ledgerB }).pass ? "PASS" : "FAIL";
    return { plan, anchorStay, daysOut, judge, verdicts, pred, emoText, contText };
  };

  // Pre-enrichment: the pinned pack reproduces the golden verdicts
  // (the Phase 3 §G anchor, restated as this phase's baseline).
  const pre = runPipeline(assembledPre.pack);
  eq(pre.anchorStay?.name, frozen.anchorStay?.name, "G: anchor stay from the pinned pack matches the golden run");
  eqC({ pass: pre.judge.pass, hardViolations: pre.judge.hardViolations, warnings: pre.judge.warnings }, { pass: frozenGrades.judge.pass, hardViolations: frozenGrades.judge.hardViolations, warnings: frozenGrades.judge.warnings }, "G: pre-enrichment make-sense judge reproduces the golden verdict");
  // ALL-IN (2026-10-22): the pre-enrichment baseline IS the golden —
  // under the all-in scope its verdict is OVER (the anchor stay's
  // recorded band prices lodging 440–720 over 4 nights; totals
  // 1348–2724 vs the plan-only scope's AT RISK 908–2004).
  eq(pre.pred.budgetPosture.verdict, frozenPred.budgetPosture.verdict, "G: pre-enrichment budget verdict is the golden (all-in OVER)");
  eq(pre.pred.budgetPosture.estimatedTotals.low, frozenPred.budgetPosture.estimatedTotals.low, "G: pre-enrichment budget low is the golden (all-in 1348)");
  eq(pre.pred.budgetPosture.estimatedTotals.high, frozenPred.budgetPosture.estimatedTotals.high, "G: pre-enrichment budget high is the golden (all-in 2724)");

  // Finalist selection from the solved plan (the production rule).
  const finalists = finalistKeysFromPlan(pre.plan, pre.anchorStay?.key || null);
  const gradedKeys = ANALYSIS.filter((r) => r.graded).map((r) => r.key);
  ok(gradedKeys.every((k) => finalists.has(k)), "G: every graded live-proof target is a plan finalist under the selection rule");
  ok(pre.anchorStay && finalists.has(pre.anchorStay.key), "G: the anchor stay is a finalist");

  // Base-layer snapshot: the separation witness.
  const candidatesBefore = await store.getVersionCandidates(version.dto.packVersionId);
  const baseCanon = (row) => { const { enrichment, ...base } = row; void enrichment; return canon(base); };
  const baseBefore = new Map(candidatesBefore.map((r) => [r.candidateKey, baseCanon(r)]));
  const enrichmentBefore = new Map(candidatesBefore.map((r) => [r.candidateKey, canon(r.enrichment)]));
  eq(candidateContentHash(candidatesBefore), version.contentHash, "G: the content hash witnesses the base layer (recomputes equal at seed)");

  // The Phase 4 job over the PINNED version: recorded LIVE responses
  // for the live proof's 26 finalists. The service clock sits past
  // the fixture records' refresh dates, so the job genuinely
  // re-enriches (the fixture records are stale by then).
  const enrichClock = fakeClock("2026-12-01T00:00:00.000Z");
  const ledger = new InMemoryPlacesLedgerStore(enrichClock.now);
  const client = new RecordedPlacesClient();
  const service = new PlacesEnrichmentService({ store, ledger, client, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: enrichClock.now });
  const finalistKeys = TARGETS.map((t) => t.key);
  const report = await service.enrichPackFinalists(version.dto.packVersionId, finalistKeys);
  eq(report.enriched, 25, "G: the job enriches 25 of the 26 finalists from live data");
  eq(report.rejectedMatches.length, 1, "G: the job records the Bédard rejection on the pinned pack too");
  eq(report.callsThisRun.textSearch, 26, "G: the job made 26 searches against the pinned version");
  eq(report.callsThisRun.placeDetails, 25, "G: the job made 25 details calls against the pinned version");

  // Separation: base bytes + hash + counts unmoved; only the
  // finalists' enrichment records changed.
  const candidatesAfter = await store.getVersionCandidates(version.dto.packVersionId);
  eq(candidatesAfter.length, candidatesBefore.length, "G: enrichment added and removed no candidates");
  for (const row of candidatesAfter) {
    eq(baseCanon(row), baseBefore.get(row.candidateKey), `G: base POI bytes unchanged for ${row.candidateKey}`);
  }
  eq(candidateContentHash(candidatesAfter), version.contentHash, "G: the version's content hash still recomputes equal AFTER enrichment write-back");
  const finalistCandidateKeys = new Set(finalistKeys.map((k) => `osm:${k}`));
  for (const row of candidatesAfter) {
    if (!finalistCandidateKeys.has(row.candidateKey)) {
      eq(canon(row.enrichment), enrichmentBefore.get(row.candidateKey), `G: non-finalist ${row.candidateKey}'s enrichment record is untouched`);
    }
  }
  const versionAfter = await store.getVersion(version.dto.packVersionId);
  eqC(versionAfter.dto.counts, version.dto.counts, "G: the version's counts are unchanged by enrichment");
  eq(versionAfter.dto.builtAt, version.dto.builtAt, "G: the version's builtAt is unchanged by enrichment");

  // The engine never sees a rejected business's data.
  const assembledPost = await assemblePinnedEnginePack(store, "gen-quebec-phase4", weather);
  const bedardEngine = [...assembledPost.pack.sights, ...assembledPost.pack.foods].find((c) => c.key === "node/6711176112");
  eq(bedardEngine.google, null, "G: the engine sees NO google data for the distance-gate rejection");

  // Post-enrichment solve: the verdicts the LIVE data produces.
  // The schedule legitimately MOVES (live hours correct fixture
  // hours for several scheduled items — the live proof's whole
  // point), so the spot-proof asserts at the VERDICT level, against
  // both the frozen grades and the Phase 1 breadth row.
  const post = runPipeline(assembledPost.pack);
  eq(post.daysOut.length, 5, "G: the live-enriched pinned pack still solves a full 5-day trip");
  const brow = loadData("engine-budget-verdicts.json", FIX1).trips.find((r) => r.tripRef === entry.id);
  eq(post.judge.pass, frozenGrades.judge.pass, "G: make-sense verdict reproduces on live data (PASS)");
  eqC(post.judge.hardViolations, frozenGrades.judge.hardViolations, "G: make-sense hard violations reproduce on live data (none)");
  const verdictMap = (vs) => Object.fromEntries(vs.map((v) => [v.id, v.verdict]));
  eqC(verdictMap(post.verdicts), verdictMap(frozenGrades.verdicts), "G: all 7 requirement VERDICTS reproduce on live data (5 KEPT, dietary + budget-cap honestly UNVERIFIABLE)");
  // ALL-IN on live data (2026-10-22, measured from the recorded live
  // responses): the live Details for the anchor stay returned NO
  // price level (the live proof confirmed bands for only 5 of 20
  // finalists), so on live data lodging is named-not-counted — the
  // verdict stays AT RISK and the totals stay the recorded-live
  // 764–1684, while coverage is stated over the all-in scope
  // (16 evidenced of 18 lines = 0.89). This DIVERGES from the fixture
  // golden (OVER, 0.95) for one traced reason: the FIXTURE google
  // data carries a MODERATE level for the stay and the live recording
  // does not. Evidence present -> priced; absent -> named, excluded.
  eq(post.pred.budgetPosture.verdict, "AT RISK", "G: budget verdict on live data is AT RISK (lodging unevidenced in the live recording — named, excluded)");
  eq(post.pred.budgetPosture.coverage, 0.89, "G: budget coverage on live data is the all-in 16/18 = 0.89");
  eqC(post.pred.budgetPosture.estimatedTotals, { low: 764, high: 1684, currency: "CAD" }, "G: budget totals on live data are the recorded-live golden CAD 764-1684 (no component evidence in the live recording to add — fixture golden was 908-2004 plan-only, see PHASE4-REPORT)");
  eq(post.contText, brow.continuity, "G: continuity verdict reproduces on live data (PASS)");
  ok(post.emoText.startsWith("FAIL") && post.emoText.includes("departure-cruelty"), "G: emotion verdict reproduces in kind on live data (FAIL, departure-cruelty — the hard COUNT moved 1 -> 2 on the live schedule, named in PHASE4-REPORT)");
  solverSummary = {
    preBudget: pre.pred.budgetPosture,
    postBudget: post.pred.budgetPosture,
    preJudge: { pass: pre.judge.pass, hard: pre.judge.hardViolations.length, warnings: pre.judge.warnings.length },
    postJudge: { pass: post.judge.pass, hard: post.judge.hardViolations, warnings: post.judge.warnings },
    postVerdicts: post.verdicts,
    frozenVerdicts: frozenGrades.verdicts,
    postEmotion: post.emoText,
    postContinuity: post.contText,
    scheduleMoved: canon(post.plan.days.map((d) => d.items.map((i) => [i.key, i.start, i.end]))) !== canon(pre.plan.days.map((d) => d.items.map((i) => [i.key, i.start, i.end])))
  };
  console.log(`G: post-live-enrichment verdicts (measured): judge pass=${post.judge.pass} hard=${JSON.stringify(post.judge.hardViolations)} warnings=${post.judge.warnings.length}; budget=${post.pred.budgetPosture.verdict} ${post.pred.budgetPosture.estimatedTotals.low}-${post.pred.budgetPosture.estimatedTotals.high} coverage=${post.pred.budgetPosture.coverage}; scheduleMoved=${solverSummary.scheduleMoved}`);
  console.log(`G: requirement verdicts post=${canon(post.verdicts)} frozen=${canon(frozenGrades.verdicts)}; emotion post=${post.emoText}; continuity post=${post.contText}; golden judge warnings=${frozenGrades.judge.warnings.length}`);
}

/* ------------------------------------------------------------------ */
/* H. Finalist rule, gate edges, provider OFF                          */
/* ------------------------------------------------------------------ */
if (section("H")) {
  const plan = { days: [{ items: [{ key: "a" }, { key: "b" }, {}] }, { items: [{ key: "a" }, { key: "c" }] }] };
  const keys = finalistKeysFromPlan(plan, "stay-1");
  eqC([...keys].sort(), ["a", "b", "c", "stay-1"], "H: finalists = scheduled item keys (deduped, keyless skipped) + the anchor stay");
  eq(finalistKeysFromPlan(plan, null).has("stay-1"), false, "H: no anchor, no anchor finalist");

  const pos = { lat: 46.81, lon: -71.21 };
  eq(evaluateMatch(pos, undefined).rejection.reason, "no-results", "H: an empty search result is a no-results rejection");
  eq(evaluateMatch(pos, { id: "ChIJx", displayName: { text: "X" } }).rejection.reason, "no-location-returned", "H: a hit with no location cannot be verified and is rejected");
  eq(evaluateMatch(null, { id: "ChIJx", location: { latitude: 46.81, longitude: -71.21 } }).rejection.reason, "candidate-position-unknown", "H: a position-less candidate cannot be verified either");
  const near = evaluateMatch(pos, { id: "ChIJx", location: { latitude: pos.lat + 0.0179, longitude: pos.lon } });
  ok(near.matched && near.distanceKm <= 2, "H: a hit at ~1.99 km is inside the gate");
  const far = evaluateMatch(pos, { id: "ChIJx", location: { latitude: pos.lat + 0.0181, longitude: pos.lon } });
  ok(!far.matched && far.rejection.reason === "distance-gate" && far.rejection.distanceKm > 2, "H: a hit at ~2.01 km is outside the gate");

  // Provider OFF: no client (no key) — the engine's OSM-only posture.
  eq(placesClientFromEnv({}), null, "H: no GOOGLE_PLACES_API_KEY in env = no client (provider off)");
  ok(placesClientFromEnv({ GOOGLE_PLACES_API_KEY: "x" }) instanceof HttpPlacesClient, "H: a present key builds the HTTP client (Pattern B)");
  const clock = fakeClock("2026-10-22T12:00:00.000Z");
  const store = new InMemoryPackStore(clock.now);
  const quebec = breadthDestination("Quebec City");
  const target = { key: "node/940001", name: "Quiet Museum", group: "sights", pos: { lat: 46.81, lon: -71.21 }, osmHoursRaw: null };
  const version = await publishCandidates(store, quebec, [storedCandidateOf(target)], "2026-10-22T12:00:00.000Z");
  const ledger = new InMemoryPlacesLedgerStore(clock.now);
  const offService = new PlacesEnrichmentService({ store, ledger, client: null, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const offReport = await offService.enrichPackFinalists(version.dto.packVersionId, [target.key]);
  eq(offReport.mode, "off", "H: a keyless run reports mode off");
  eq(offReport.enriched, 0, "H: mode off enriches nothing");
  eqC(offReport.callsThisRun, { textSearch: 0, placeDetails: 0 }, "H: mode off makes zero calls");
  eqC(offReport.countersAfter, offReport.countersBefore, "H: mode off leaves the ledger untouched");

  // A finalist that is not in the pack: surfaced, never called for.
  const client = new FakePlacesClient(nearHitHandler);
  const service = new PlacesEnrichmentService({ store, ledger, client, scope: SCOPE, caps: PLACES_DEFAULT_CAPS, clock: clock.now });
  const missReport = await service.enrichPackFinalists(version.dto.packVersionId, ["node/does-not-exist"]);
  eq(missReport.outcomes[0].outcome, "not-in-pack", "H: an unknown finalist is reported not-in-pack");
  eq(client.searchCalls.length, 0, "H: no call is made for a finalist that is not in the pack");
}

console.log(`roamly-wiring-phase4-checks: ${count} assertions PASS${replaySummary ? ` (recorded replay: ${replaySummary.exactDistances}/25 gate distances exact)` : ""}`);
