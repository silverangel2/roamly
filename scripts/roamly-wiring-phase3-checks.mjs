import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { InMemoryPackStore } from "@/lib/roamly/engine/packs/store.ts";
import {
  assemblePinnedEnginePack,
  candidateRowToDTO,
  drainQueuedBuilds,
  fetchAndStoreWeatherSnapshot,
  liveCollector,
  normalizeRecordedPack,
  packCounts,
  readServingPack,
  recordedCollector,
  requestBuild,
  runBuildJob,
  seedDestinationFromRecordedPack
} from "@/lib/roamly/engine/packs/builder.ts";
import { BREADTH_DESTINATION_SEEDS, breadthDestination } from "@/lib/roamly/engine/packs/destinations.ts";
import { PACK_CLASSIFIER_VERSION, PackStoreError } from "@/lib/roamly/engine/packs/types.ts";
import { parseCandidateDTO, PACK_SCHEMA_VERSION } from "@/lib/roamly/engine/types.ts";
import { isValidTimeZone } from "@/lib/roamly/engine/time.ts";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";
import { scoreStays } from "@/lib/roamly/engine/anchors.ts";
import { extractConstraints, specConstraints, agreementReport, gradeRequirements } from "@/lib/roamly/engine/understand.ts";
import { judgeTrip } from "@/lib/roamly/engine/judges.ts";
import { buildPredictions } from "@/lib/roamly/engine/predict.ts";
import { newComposerState, composeDay } from "@/lib/roamly/engine/frames.ts";
import { partyProfile } from "@/lib/roamly/engine/journey.ts";
import { auditTrip } from "@/lib/roamly/engine/emotion.ts";
import { buildTripArc, buildCommitmentLedger, reconcileLedger, judgeContinuity, peakScoresFromDays } from "@/lib/roamly/engine/continuity.ts";
import { fmt, isoPlus, parseHhmm } from "@/lib/roamly/engine/util.ts";

// Phase 3 golden checks (DESIGN-PRODUCTION.md Phase 3 proof):
// the pack data plane — versioned DB-shaped packs, POI/weather
// separation, generation pinning, single-flight leases,
// stale-while-revalidate reads, missing-pack honesty — plus ONE
// live rebuild (Quebec City, Overpass + Open-Meteo, free) and the
// engine integration spot-proof: the Phase 2 solver consumes a
// PINNED pack version and reproduces the Quebec golden verdicts.
// Seeds are the shadow's cached packs (Phase 2 fixtures) replayed
// as RECORDED INPUT through the production publish path — the seed
// provenance says recorded, never live.
// Run a single section with: --only=<A|B|C|D|E|F|G>

const ONLY = new Set(((process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)).split(",").filter(Boolean));
const section = (name) => ONLY.size === 0 || ONLY.has(name);

const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
const FIX1 = new URL("./fixtures/wiring-phase1/", import.meta.url);
const load = (name, base = FIX2) => JSON.parse(readFileSync(new URL(name, base), "utf8"));
const loadData = (name, base) => load(name, base).data;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const recordedPackOf = (destination) => loadData(`packs/pack-${slug(destination)}.json`);

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
async function rejectsCode(promise, code, label) {
  count += 1;
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof PackStoreError && err.code === code, `${label} — wrong error: ${err}`);
    return;
  }
  assert.fail(`${label} — expected PackStoreError ${code}, but the call succeeded`);
}
function fakeClock(startIso) {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t), advanceMs: (ms) => { t += ms; } };
}
const WORKER = { workerId: "phase3-proof" };

/* ------------------------------------------------------------------ */
/* A. Registry + seeded builds for the 8 breadth destinations          */
/* ------------------------------------------------------------------ */
let storeA = null;
let quebecV1Canon = null;
let quebecWeatherA = null;
if (section("A")) {
  const clock = fakeClock("2026-10-22T00:00:00.000Z");
  storeA = new InMemoryPackStore(clock.now);
  eq(BREADTH_DESTINATION_SEEDS.length, 8, "A: 8 breadth destination seeds");
  for (const dest of BREADTH_DESTINATION_SEEDS) {
    ok(isValidTimeZone(dest.timeZone), `A: ${dest.displayName} timezone is a valid IANA zone (${dest.timeZone})`);
    ok(dest.bbox !== null, `A: ${dest.displayName} carries its collection bbox`);
    const recorded = recordedPackOf(dest.displayName);
    const { version, weather } = await seedDestinationFromRecordedPack(storeA, dest, recorded, WORKER);
    eq(version.dto.status, "ready", `A: ${dest.displayName} seed publishes ready`);
    eq(version.version, 1, `A: ${dest.displayName} first version is v1`);
    eq(version.dto.schemaVersion, PACK_SCHEMA_VERSION, `A: ${dest.displayName} schema version is the Phase 1 constant`);
    eq(version.dto.classifierVersion, PACK_CLASSIFIER_VERSION, `A: ${dest.displayName} classifier version stamped`);
    eq(version.dto.counts.candidates, recorded.counts.total, `A: ${dest.displayName} candidate total matches the recorded pack (${recorded.counts.total})`);
    eq(Object.values(version.dto.counts.byKind).reduce((a, b) => a + b, 0), recorded.counts.total, `A: ${dest.displayName} byKind counts sum to the total`);
    ok(/^[0-9a-f]{64}$/.test(version.contentHash || ""), `A: ${dest.displayName} content hash stamped`);
    eq(version.dto.provenance.source, "recorded-shadow-pack", `A: ${dest.displayName} provenance honestly says recorded seed`);
    const candidates = await storeA.getVersionCandidates(version.dto.packVersionId);
    eqC(packCounts(candidates), recorded.counts, `A: ${dest.displayName} shadow counts block reproduced from stored rows`);
    for (const row of candidates) {
      const dto = candidateRowToDTO(row, version.dto.builtAt);
      const parsed = parseCandidateDTO(dto);
      ok(parsed.ok, `A: ${dest.displayName} candidate ${row.candidateKey} conforms to CandidateDTO${parsed.ok ? "" : ": " + parsed.errors.join("; ")}`);
      ok(!("weather" in row) && !("weather" in dto), `A: ${dest.displayName} candidate carries no weather (separate layer)`);
    }
    ok(weather !== null, `A: ${dest.displayName} weather stored as its own snapshot`);
    eq(weather.kind, "forecast", `A: ${dest.displayName} weather kind is forecast`);
    eq(weather.provider, "open-meteo", `A: ${dest.displayName} weather provider is open-meteo`);
    eq(weather.days.length, recorded.weather.length, `A: ${dest.displayName} weather days match the recorded snapshot (${recorded.weather.length})`);
    eq(weather.fetchedAt, recorded.generatedAt, `A: ${dest.displayName} weather as-of time is the recorded fetch time`);
    eq((await storeA.listWeatherSnapshots(dest.destinationId)).length, 1, `A: ${dest.displayName} exactly one weather snapshot`);
    if (dest.displayName === "Quebec City") {
      quebecWeatherA = weather;
      const pin = await storeA.pinVersion("gen-a-quebec", version.dto.packVersionId);
      eq(pin.packVersionId, version.dto.packVersionId, "A: Quebec v1 pinned for generation gen-a-quebec");
      quebecV1Canon = canon({ dto: version.dto, candidates });
    }
  }
  eq((await storeA.listDestinations()).length, 8, "A: registry holds all 8 destinations");
}

/* ------------------------------------------------------------------ */
/* B. Version immutability + pin stability across a rebuild            */
/* ------------------------------------------------------------------ */
if (section("B")) {
  const store = storeA || new InMemoryPackStore(fakeClock("2026-10-22T00:00:00.000Z").now);
  if (!storeA) throw new Error("section B needs section A (run without --only)");
  const dest = breadthDestination("Quebec City");
  const v1Before = await store.getVersion((await store.getPin("gen-a-quebec")).packVersionId);
  // Rebuild with drifted content: venues vanished from the source.
  const recorded = recordedPackOf("Quebec City");
  const drifted = {
    ...recorded,
    stays: recorded.stays.filter((c) => c.kind !== "venue"),
    sights: recorded.sights.filter((c) => c.kind !== "venue"),
    excursions: recorded.excursions.filter((c) => c.kind !== "venue"),
    foods: recorded.foods.filter((c) => c.kind !== "venue"),
    transport: recorded.transport.filter((c) => c.kind !== "venue")
  };
  const { job } = await requestBuild(store, dest.destinationId, "refresh");
  const v2 = await runBuildJob(store, job.jobId, recordedCollector(drifted), WORKER);
  ok(v2 !== null, "B: rebuild publishes");
  eq(v2.version, 2, "B: rebuild is a NEW version (v2)");
  eq(v2.dto.status, "ready", "B: v2 serves");
  eq(v2.supersedesPackVersionId, v1Before.dto.packVersionId, "B: v2 records that it supersedes v1");
  ok(v2.dto.counts.candidates < v1Before.dto.counts.candidates, "B: drifted rebuild has fewer candidates (venues gone)");
  const v1After = await store.getVersion(v1Before.dto.packVersionId);
  eq(v1After.dto.status, "superseded", "B: v1 flips to superseded — the only mutation a published version ever sees");
  eq(v1After.contentHash, v1Before.contentHash, "B: v1 content hash unchanged by the rebuild");
  eq(v1After.dto.builtAt, v1Before.dto.builtAt, "B: v1 builtAt unchanged");
  eqC(v1After.dto.counts, v1Before.dto.counts, "B: v1 counts unchanged");
  const pinned = await store.readPinned(v1Before.dto.packVersionId);
  eq(canon({ dto: { ...pinned.version.dto, status: "ready" }, candidates: pinned.candidates }), quebecV1Canon, "B: pinned v1 content is byte-for-byte what it was before the rebuild (status lifecycle aside)");
  const assembled = await assemblePinnedEnginePack(store, "gen-a-quebec", quebecWeatherA);
  eq(assembled.version.dto.packVersionId, v1Before.dto.packVersionId, "B: pinned assembly still reads v1 after v2 published");
  eq(assembled.pack.counts.total, 852, "B: pinned assembly still holds all 852 recorded candidates");
  eq((await store.getReadyVersion(dest.destinationId)).dto.packVersionId, v2.dto.packVersionId, "B: serving reads moved to v2");
}

/* ------------------------------------------------------------------ */
/* C. Single-flight: concurrent requests coalesce to ONE build         */
/* ------------------------------------------------------------------ */
if (section("C")) {
  const store = new InMemoryPackStore(fakeClock("2026-10-22T00:00:00.000Z").now);
  const dest = breadthDestination("Banff");
  await store.registerDestination(dest);
  const requests = await Promise.all(Array.from({ length: 8 }, () => requestBuild(store, dest.destinationId, "test-burst")));
  eq(new Set(requests.map((r) => r.job.jobId)).size, 1, "C: 8 concurrent build requests land on ONE job");
  eq(requests.filter((r) => r.coalesced).length, 7, "C: 7 of the 8 requests coalesced");
  eq((await store.getBuildJob(requests[0].job.jobId)).coalescedRequests, 8, "C: the job records all 8 coalesced requests");
  eq((await store.listBuildJobs(dest.destinationId)).length, 1, "C: exactly one job exists for the destination");
  let collectorCalls = 0;
  const slowCollector = async () => {
    collectorCalls += 1;
    await new Promise((r) => setTimeout(r, 200));
    return {
      candidates: normalizeRecordedPack(recordedPackOf("Banff")).candidates.slice(0, 12),
      provenance: { source: "phase3-proof", sourceRef: null, recordedAt: null, label: "slow fake collector" }
    };
  };
  const jobId = requests[0].job.jobId;
  const runs = await Promise.all([
    runBuildJob(store, jobId, slowCollector, { workerId: "w1" }),
    runBuildJob(store, jobId, slowCollector, { workerId: "w2" }),
    runBuildJob(store, jobId, slowCollector, { workerId: "w3" })
  ]);
  eq(runs.filter((r) => r !== null).length, 1, "C: exactly one of three racing workers runs the build");
  eq(collectorCalls, 1, "C: the collector itself ran exactly once");
  eq((await store.listVersions(dest.destinationId)).length, 1, "C: exactly one version was published");
  eq((await store.getBuildJob(jobId)).status, "done", "C: the coalesced job completed");
}

/* ------------------------------------------------------------------ */
/* D. Leases: expiry, steal, fencing, heartbeat                        */
/* ------------------------------------------------------------------ */
if (section("D")) {
  const clock = fakeClock("2026-10-22T00:00:00.000Z");
  const store = new InMemoryPackStore(clock.now);
  const dest = breadthDestination("Lunenburg");
  await store.registerDestination(dest);
  const { job } = await requestBuild(store, dest.destinationId, "lease-proof");
  const leaseA = await store.claimBuild(job.jobId, "worker-a", 1_000);
  ok(leaseA !== null && leaseA.epoch === 1, "D: worker A claims the job (epoch 1)");
  const versionA = await store.beginVersion(job.jobId, leaseA.leaseId, PACK_CLASSIFIER_VERSION, PACK_SCHEMA_VERSION);
  eq(await store.claimBuild(job.jobId, "worker-b", 1_000), null, "D: a live lease cannot be claimed by another worker");
  clock.advanceMs(2_000); // A's lease (1s TTL) is now expired
  const leaseB = await store.claimBuild(job.jobId, "worker-b", 60_000);
  ok(leaseB !== null && leaseB.epoch === 2, "D: worker B steals the expired lease (epoch 2)");
  ok(leaseB.leaseId !== leaseA.leaseId, "D: the steal rotates the fencing token");
  await rejectsCode(
    store.publishVersion(versionA.dto.packVersionId, job.jobId, leaseA.leaseId, [], versionA.dto.provenance),
    "LEASE_LOST",
    "D: the stolen worker's publish is refused (fencing)"
  );
  const versionB = await store.beginVersion(job.jobId, leaseB.leaseId, PACK_CLASSIFIER_VERSION, PACK_SCHEMA_VERSION);
  const publishedB = await store.publishVersion(versionB.dto.packVersionId, job.jobId, leaseB.leaseId, [], versionB.dto.provenance);
  eq(publishedB.dto.status, "ready", "D: the stealing worker publishes successfully");
  eq((await store.getVersion(versionA.dto.packVersionId)).dto.status, "building", "D: the loser's version never became ready");
  eq((await store.getReadyVersion(dest.destinationId)).dto.packVersionId, versionB.dto.packVersionId, "D: serving version is the stealer's");
  // Heartbeat: a live holder extends its lease; expiry only bites
  // once heartbeats stop.
  const dest2 = breadthDestination("Rocky Harbour");
  await store.registerDestination(dest2);
  const { job: job2 } = await requestBuild(store, dest2.destinationId, "heartbeat-proof");
  const lease1 = await store.claimBuild(job2.jobId, "worker-c", 1_000);
  clock.advanceMs(600);
  const beaten = await store.heartbeatBuild(job2.jobId, lease1.leaseId, 1_000);
  ok(new Date(beaten.expiresAt).getTime() > new Date(lease1.expiresAt).getTime(), "D: heartbeat extends the lease expiry");
  clock.advanceMs(600); // past the ORIGINAL expiry, inside the extension
  eq(await store.claimBuild(job2.jobId, "worker-d", 1_000), null, "D: heartbeating holder cannot be stolen from");
  await rejectsCode(store.heartbeatBuild(job2.jobId, "packlease-forged", 1_000), "LEASE_LOST", "D: a forged lease cannot heartbeat");
  clock.advanceMs(1_500); // heartbeats stopped; the extension lapses
  const stolen = await store.claimBuild(job2.jobId, "worker-d", 1_000);
  ok(stolen !== null && stolen.epoch === 2, "D: once heartbeats stop, the lease expires and is stealable");
}

/* ------------------------------------------------------------------ */
/* E. Stale-while-revalidate + missing-pack honesty                    */
/* ------------------------------------------------------------------ */
if (section("E")) {
  const clock = fakeClock("2026-10-22T00:00:00.000Z");
  const store = new InMemoryPackStore(clock.now);
  const halifax = breadthDestination("Halifax");
  await seedDestinationFromRecordedPack(store, halifax, recordedPackOf("Halifax"), WORKER);
  const fresh = await readServingPack(store, halifax.destinationId, { now: clock.now() });
  eq(fresh.state, "ready", "E: a built destination serves ready");
  eq(fresh.stale, false, "E: a just-built pack is fresh");
  eq(fresh.refreshJobId, null, "E: no refresh is enqueued for a fresh pack");
  clock.advanceMs(25 * 60 * 60 * 1000); // past the 24h freshness window
  const stale = await readServingPack(store, halifax.destinationId, { now: clock.now() });
  eq(stale.state, "ready", "E: a stale pack still SERVES (stale-while-revalidate)");
  eq(stale.stale, true, "E: ...and is honestly flagged stale");
  eq(stale.pack.version, 1, "E: the stale read serves v1 while the refresh runs behind it");
  ok(stale.refreshJobId !== null, "E: the stale read enqueued a refresh");
  const stale2 = await readServingPack(store, halifax.destinationId, { now: clock.now() });
  eq(stale2.refreshJobId, stale.refreshJobId, "E: a second stale read coalesces onto the same refresh job");
  // The refresh lands: markets vanished from the source this time.
  const halifaxRecorded = recordedPackOf("Halifax");
  const drifted = {
    ...halifaxRecorded,
    sights: halifaxRecorded.sights.filter((c) => c.kind !== "market"),
    foods: halifaxRecorded.foods.filter((c) => c.kind !== "market")
  };
  const drained = await drainQueuedBuilds(store, () => recordedCollector(drifted), WORKER);
  eq(drained.length, 1, "E: the queue drain publishes exactly the one refresh");
  const after = await readServingPack(store, halifax.destinationId, { now: clock.now() });
  eq(after.pack.version, 2, "E: after the refresh, reads serve v2");
  eq(after.stale, false, "E: v2 is fresh");
  // Missing pack: registered, never built. Honest pending, nothing invented.
  const charlottetown = breadthDestination("Charlottetown");
  await store.registerDestination(charlottetown);
  const pending = await readServingPack(store, charlottetown.destinationId, { now: clock.now() });
  eq(pending.state, "pending", "E: an unbuilt destination reads as pending — never a fabricated pack");
  eq(pending.pack, null, "E: pending carries NO pack object");
  eq(pending.job.status, "queued", "E: the cold read enqueued a real build job");
  eq(await store.getReadyVersion(charlottetown.destinationId), null, "E: the store still holds no version for it");
  const pending2 = await readServingPack(store, charlottetown.destinationId, { now: clock.now() });
  eq(pending2.job.jobId, pending.job.jobId, "E: repeated cold reads coalesce onto the same job");
  await rejectsCode(readServingPack(store, "dst-unregistered", { now: clock.now() }), "UNKNOWN_DESTINATION", "E: an unregistered destination is refused, not invented");
}

/* ------------------------------------------------------------------ */
/* F. LIVE rebuild — Quebec City through the real collectors           */
/* ------------------------------------------------------------------ */
let liveSummary = null;
if (section("F")) {
  const store = new InMemoryPackStore();
  const quebec = breadthDestination("Quebec City");
  await store.registerDestination(quebec);
  const startedAt = Date.now();
  const { job } = await requestBuild(store, quebec.destinationId, "live-proof");
  const version = await runBuildJob(store, job.jobId, liveCollector(undefined, {
    attemptTimeoutMs: 120_000,
    maxRounds: 2,
    backoffBaseMs: 2_000
  }), WORKER);
  ok(version !== null, "F: the live build published a version");
  eq(version.dto.status, "ready", "F: live version is ready");
  eq(version.dto.provenance.source, "openstreetmap-overpass", "F: provenance names the live source");
  ok(version.dto.provenance.label.includes("elements"), "F: provenance carries the fetch evidence (element counts + endpoints)");
  const candidates = await store.getVersionCandidates(version.dto.packVersionId);
  eq(candidates.length, version.dto.counts.candidates, "F: stored rows match the version counts");
  ok(candidates.length >= 400, `F: live candidate count is in a sane drift band of the recorded 852 (got ${candidates.length})`);
  for (const kind of ["museum", "food", "stay", "park"]) {
    ok(candidates.some((c) => c.kind === kind), `F: live pack contains ${kind} candidates`);
  }
  for (const row of candidates) {
    const parsed = parseCandidateDTO(candidateRowToDTO(row, version.dto.builtAt));
    ok(parsed.ok, `F: live candidate ${row.candidateKey} conforms to CandidateDTO${parsed.ok ? "" : ": " + parsed.errors.join("; ")}`);
  }
  // Live weather, stored as its own artifact for the golden window.
  const wx = await fetchAndStoreWeatherSnapshot(store, quebec.destinationId, "2026-10-24", "2026-10-28", "forecast");
  ok(wx !== null, "F: live Open-Meteo forecast returned a snapshot");
  eq(wx.days.length, 5, "F: the forecast covers the 5 golden-trip days");
  eq(wx.kind, "forecast", "F: weather kind is forecast (the historical layer stays distinct)");
  ok(new Date(wx.fetchedAt).getTime() >= startedAt, "F: weather as-of time is this run's fetch, stamped");
  ok(!JSON.stringify(version.dto).includes("precipProb"), "F: the pack version contains no weather data");
  eq((await store.listWeatherSnapshots(quebec.destinationId)).length, 1, "F: weather lives in exactly one separate snapshot record");
  liveSummary = { candidates: candidates.length, recorded: 852, kinds: version.dto.counts.byKind };
  console.log(`F: live Quebec rebuild — ${candidates.length} candidates (recorded pack: 852; delta is source drift, itemized in PHASE3-REPORT.md)`);
}

/* ------------------------------------------------------------------ */
/* G. Engine integration: the solver consumes a PINNED pack version    */
/* ------------------------------------------------------------------ */
if (section("G")) {
  const store = new InMemoryPackStore(fakeClock("2026-10-22T00:00:00.000Z").now);
  const quebec = breadthDestination("Quebec City");
  const enriched = loadData("packs/pack-quebec-city-enriched.json");
  const { version } = await seedDestinationFromRecordedPack(store, quebec, enriched, WORKER);
  await store.pinVersion("gen-quebec-golden", version.dto.packVersionId);
  const weather = await store.getWeatherSnapshot(quebec.destinationId, "forecast", enriched.startIso, enriched.endIso);
  ok(weather !== null, "G: the seeded weather snapshot is readable by range");
  const assembled = await assemblePinnedEnginePack(store, "gen-quebec-golden", weather);
  ok(assembled !== null, "G: the pinned pack assembles for the solver");
  eq(assembled.pack.counts.total, 852, "G: assembled pack carries all 852 candidates");

  // The Phase 2 Quebec pipeline, verbatim, against the assembled pack.
  const scenarios = loadData("scenarios.json");
  const sc = scenarios.find((s) => s.entry.id === "quebec-city-family");
  const entry = sc.entry;
  const pack = assembled.pack;
  const frozen = load("frozen/quebec-city-family/itinerary.json");
  const frozenGrades = load("frozen/quebec-city-family/grades.json");
  const frozenPred = load("frozen/quebec-city-family/predictions.json");
  const dates = Array.from({ length: entry.days }, (_, i) => isoPlus(sc.startDate, i));
  const extracted = extractConstraints(sc.requestText);
  const truth = specConstraints(entry);
  eqC(agreementReport(extracted, truth), frozenGrades.agreement, "G: extractor agreement (pinned pack pipeline)");
  const stays = scoreStays(pack);
  const anchorStay = stays[0] || null;
  eq(anchorStay?.name, frozen.anchorStay?.name, "G: anchor stay from the pinned pack matches the golden run");
  const basePos = anchorStay?.pos || { lat: entry.coordinates.latitude, lon: entry.coordinates.longitude };
  const baseName = anchorStay ? anchorStay.name : `${entry.destination} centre (base anchor)`;
  const earliestMin = parseHhmm(extracted.earliestStart || truth.earliestStart || "09:00");
  const restSpec = extracted.rest || truth.rest;
  const mustSees = (entry.checks || []).filter((c) => c.kind === "keyword").map((c) => ({ id: c.id, label: c.label, patterns: c.patterns }));
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
  const stripItem = (i) => {
    if (!i) return i;
    const rest = { ...i };
    delete rest.affiliate;
    delete rest.priceEvidence;
    if (rest.google) { const g = { ...rest.google }; delete g.fetchedAt; delete g.refreshDue; rest.google = g; }
    return rest;
  };
  for (let d = 0; d < daysOut.length; d++) {
    eqC(daysOut[d].items.map(stripItem), frozen.days[d].items.map(stripItem), `G: day ${d + 1} items reproduce the golden trip from the pinned pack`);
    eqC(daysOut[d].legs, frozen.days[d].legs, `G: day ${d + 1} legs reproduce`);
    eqC(daysOut[d].narrative, frozen.days[d].narrative, `G: day ${d + 1} narrative reproduces verbatim`);
    eq(daysOut[d].role, frozen.days[d].role, `G: day ${d + 1} role`);
    eq(daysOut[d].endMin, frozen.days[d].endMin, `G: day ${d + 1} endMin`);
  }
  eqC(plan.mustSeeResults.map((m) => { const r = { ...m }; delete r.itemKey; return r; }), frozen.mustSeeResults, "G: must-see results reproduce");
  eqC(plan.notes, frozen.solverNotes, "G: solver notes reproduce");
  const judge = judgeTrip(plan.days, { earliestMin });
  eqC({ pass: judge.pass, hardViolations: judge.hardViolations, warnings: judge.warnings }, { pass: frozenGrades.judge.pass, hardViolations: frozenGrades.judge.hardViolations, warnings: frozenGrades.judge.warnings }, "G: make-sense judge reproduces (PASS)");
  const verdicts = gradeRequirements({ days: daysOut.map((d) => ({ ...d, narrative: d.narrative.join("\n") })) }, truth, entry.checks);
  eqC(verdicts, frozenGrades.verdicts, "G: requirement verdicts reproduce");
  const itineraryLike = { days: daysOut, travelers: entry.travelers, budgetCap: { amount: entry.budgetAmount, currency: entry.budgetCurrency, verdict: "" }, destination: entry.destination };
  // ALL-IN scope (owner decision, 2026-10-22): PREDICT receives the
  // anchor-stay lodging input exactly as the Phase 2 §B pipeline and
  // the production seam do. The golden is the all-in posture: the
  // anchor stay's recorded price level prices lodging at BAND, moving
  // Quebec AT RISK (plan-only) -> OVER, totals 908–2004 -> 1348–2724,
  // coverage 1 -> 0.95 (19/20 all-in lines).
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
  eq(pred.budgetPosture.verdict, frozenPred.budgetPosture.verdict, "G: budget verdict from the pinned pack reproduces the golden (all-in OVER)");
  eq(pred.budgetPosture.estimatedTotals.low, frozenPred.budgetPosture.estimatedTotals.low, "G: budget total low reproduces the golden (all-in 1348)");
  eq(pred.budgetPosture.estimatedTotals.high, frozenPred.budgetPosture.estimatedTotals.high, "G: budget total high reproduces the golden (all-in 2724)");
  eq(pred.budgetPosture.coverage, frozenPred.budgetPosture.coverage, "G: budget coverage reproduces the golden (all-in 0.95)");
  const brow = loadData("engine-budget-verdicts.json", FIX1).trips.find((r) => r.tripRef === entry.id);
  eq(pred.budgetPosture.verdict, brow.budgetVerdict, "G: Phase 1 breadth budget verdict matches");
  eq(judge.pass ? "PASS" : "FAIL", brow.makeSense, "G: Phase 1 breadth make-sense matches");
  const prof = partyProfile(entry, entry.request?.party || "");
  const emo = auditTrip(daysOut, { profile: prof });
  const emoText = emo.hard ? `FAIL (${emo.hard} hard: ${emo.findings.filter((f) => f.severity === "hard").map((f) => f.check).join(", ")})` : `PASS (${emo.findings.length} findings, ${emo.soft} soft)`;
  eq(emoText, brow.emotion, "G: Phase 1 breadth emotion verdict matches");
  const arcB = buildTripArc({ types: daysOut.map((d) => d.dayType || "FULL"), peakScoreByDay: peakScoresFromDays(daysOut), envelopeDeparture: daysOut.some((d) => d.envelope?.departure) });
  const ledgerB = reconcileLedger(buildCommitmentLedger(daysOut, { mustSeeResults: plan.mustSeeResults }), daysOut);
  eq(judgeContinuity(daysOut, { arc: arcB, ledger: ledgerB }).pass ? "PASS" : "FAIL", brow.continuity, "G: Phase 1 breadth continuity matches");

  // Pin stability THROUGH the solver: rebuild from the unenriched
  // recorded pack (v2), re-assemble from the pin, re-solve — the
  // golden output must not move.
  const { job } = await requestBuild(store, quebec.destinationId, "refresh");
  const v2 = await runBuildJob(store, job.jobId, recordedCollector(recordedPackOf("Quebec City")), WORKER);
  eq(v2.version, 2, "G: a second version now exists beside the pin");
  const reassembled = await assemblePinnedEnginePack(store, "gen-quebec-golden", weather);
  eq(reassembled.version.dto.packVersionId, version.dto.packVersionId, "G: the pin still resolves to v1");
  const plan2 = solveTrip(reassembled.pack, { days: entry.days, startIso: sc.startDate, dates, earliestMin, restSpec, mustSees, basePos, baseName });
  eqC(plan2.days.map((d) => d.items.map((i) => [i.key, i.start, i.end])), plan.days.map((d) => d.items.map((i) => [i.key, i.start, i.end])), "G: re-solving the pinned pack after a rebuild reproduces the identical schedule");
}

console.log(`roamly-wiring-phase3-checks: ${count} assertions PASS${liveSummary ? ` (live Quebec: ${liveSummary.candidates} candidates vs ${liveSummary.recorded} recorded)` : ""}`);
