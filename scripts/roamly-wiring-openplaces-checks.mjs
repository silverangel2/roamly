import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The gate must be proven from a clean env: the key's ABSENCE is
// the default state of the world until the owner signs up.
delete process.env.OPEN_PLACES_API_KEY;

import { InMemoryPackStore } from "@/lib/roamly/engine/packs/store.ts";
import {
  assembleEnginePack,
  candidateRowToDTO,
  liveCollector,
  packCounts,
  requestBuild,
  runBuildJob
} from "@/lib/roamly/engine/packs/builder.ts";
import { collectPoiCandidates } from "@/lib/roamly/engine/packs/collectors.ts";
import {
  OpenPlacesError,
  classifyOvertureRecord,
  collectPoiCandidatesFromOpenPlaces,
  openPlacesBuildProvenance,
  toOpenPlacesCandidate
} from "@/lib/roamly/engine/packs/openPlaces.ts";
import { OPEN_PLACES_CLASSIFIER_VERSION, OPEN_PLACES_QUERY_VERSION, PACK_CLASSIFIER_VERSION } from "@/lib/roamly/engine/packs/types.ts";
import { breadthDestination } from "@/lib/roamly/engine/packs/destinations.ts";
import { parseCandidateDTO } from "@/lib/roamly/engine/types.ts";
import { isSourceKey, parseSourceKey } from "@/lib/roamly/engine/ids.ts";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";
import { scoreStays } from "@/lib/roamly/engine/anchors.ts";
import { extractConstraints, specConstraints } from "@/lib/roamly/engine/understand.ts";
import { judgeTrip } from "@/lib/roamly/engine/judges.ts";
import { isoPlus, parseHhmm } from "@/lib/roamly/engine/util.ts";

// Open Places adapter checks (OPEN-PLACES-SPIKE.md §6 golden burden):
//   A. Recorded-fixture conformance — Quebec City + Lisbon browse
//      pages (shaped from the spike's measured Overture dataset
//      extracts, release 2026-10-21.0) replayed through the REAL
//      adapter: DTO conformance + per-kind counts + the exact
//      candidate listing an independent reference classifier
//      computed (fixtures/open-places/expected.json).
//   B. Fallback triggers — OSM-empty/OSM-down run the adapter;
//      OSM-partial never does; no key = zero adapter calls and the
//      pre-adapter outcomes byte-for-byte (incl. the thrown error).
//   C. Failure drills — 402 quota, coverage_not_ready (retry once,
//      then abort), unknown-category drift, pagination truncation:
//      honest failures/flags, never a silent partial pack.
//   D. Solver validity — the Phase 2 pipeline over an adapter-built
//      Quebec pack passes the engine's final gate (validity, NOT
//      golden equality with the OSM pack), family floors hold, and
//      the named-zero families are on the pack's face.
// Run a single section with: --only=<A|B|C|D>

const ONLY = new Set(((process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)).split(",").filter(Boolean));
const section = (name) => ONLY.size === 0 || ONLY.has(name);

const FIX = new URL("./fixtures/open-places/", import.meta.url);
const FIX2 = new URL("./fixtures/wiring-phase2/", import.meta.url);
const load = (name, base = FIX) => JSON.parse(readFileSync(new URL(name, base), "utf8"));
const EXPECTED = load("expected.json");
const PAGES = { "quebec-city": load("quebec-city.pages.json"), lisbon: load("lisbon.pages.json") };

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}
function eqC(actual, expected, label) {
  count += 1;
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  assert.equal(a, b, `${label}\n  GOT:    ${String(a).slice(0, 400)}\n  WANT:   ${String(b).slice(0, 400)}`);
}
async function rejectsWith(promise, predicate, label) {
  count += 1;
  try {
    await promise;
  } catch (err) {
    assert.ok(predicate(err), `${label} — wrong error: ${err && err.message}`);
    return err;
  }
  assert.fail(`${label} — expected a rejection, but the call succeeded`);
}
function fakeClock(startIso) {
  let t = new Date(startIso).getTime();
  return { now: () => new Date(t), advanceMs: (ms) => { t += ms; } };
}
const WORKER = { workerId: "openplaces-proof" };
const TEST_KEY = "op-test-key";
const FIXED_NOW = () => new Date("2026-10-23T02:00:00.000Z");
const NO_SLEEP = async () => {};

const QUEBEC = breadthDestination("Quebec City");
const LISBON = {
  destinationId: "dst-4a8c737077320a28",
  displayName: "Lisbon",
  country: "Portugal",
  centre: { lat: 38.7077507, lon: -9.1365919 },
  bbox: { minLat: 38.6527507, minLon: -9.2115919, maxLat: 38.7627507, maxLon: -9.0615919 },
  timeZone: "Europe/Lisbon",
  geocodeProvenance: {
    source: "recorded-destination-registry",
    sourceRef: "open-places-spike",
    recordedAt: null,
    label: "Lisbon production auto-registration (Nominatim centre + shadow big-city bbox), OPEN-PLACES-SPIKE §3"
  }
};

/* ---------------- fetchers ---------------- */

const resp = (status, body, headers) => ({
  ok: status >= 200 && status < 300,
  status,
  headers,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body))
});

/** Serves the recorded Open Places pages for one city; records
 *  every call. `mutate` may rewrite a page response per (root,
 *  offset) for the failure drills. */
function openPlacesFetcher(cityKey, calls, mutate) {
  const pages = PAGES[cityKey].pages;
  return async (url, init) => {
    calls.push({ url, headers: init?.headers || {} });
    const u = new URL(url);
    const root = u.searchParams.get("category");
    const offset = Number(u.searchParams.get("offset") || 0);
    if (mutate) {
      const m = await mutate(root, offset, u);
      if (m) return m;
    }
    const rootPages = pages[root] || [];
    const page = rootPages[Math.floor(offset / 50)] || {
      results: [],
      meta: { data_source: "overture", data_release: "2026-10-21.0", category: root, limit: 50, offset, next_offset: null, warnings: [] }
    };
    return resp(200, page);
  };
}

/** Overpass behaviours for the ladder proofs. */
function overpassFetcher(mode, calls) {
  return async (url, init) => {
    calls.push({ url, headers: init?.headers || {} });
    if (mode === "down") return resp(502, "Bad Gateway — at capacity");
    if (mode === "empty") return resp(200, { elements: [] });
    if (mode === "partial") {
      const q = decodeURIComponent(init?.body || "");
      const elements = [];
      if (q.includes('"tourism"')) {
        elements.push({ type: "node", id: 910001, lat: 46.8155, lon: -71.2075, tags: { name: "Fixture Museum", tourism: "museum" } });
        elements.push({ type: "node", id: 910002, lat: 46.812, lon: -71.205, tags: { name: "Fixture Lookout", tourism: "viewpoint" } });
      }
      if (q.includes('"amenity"~"restaurant')) {
        elements.push({ type: "node", id: 910003, lat: 46.813, lon: -71.209, tags: { name: "Fixture Bistro", amenity: "restaurant" } });
      }
      return resp(200, { elements });
    }
    throw new Error(`unknown overpass mode ${mode}`);
  };
}

function combinedFetcher({ osmMode, cityKey, opCalls, osmCalls, mutate }) {
  const osm = overpassFetcher(osmMode, osmCalls);
  const op = openPlacesFetcher(cityKey, opCalls, mutate);
  return async (url, init) => (url.includes("openplacesapi.com") ? op(url, init) : osm(url, init));
}

const POLICY = { attemptTimeoutMs: 5_000, maxRounds: 1, backoffBaseMs: 10 };

/* ------------------------------------------------------------------ */
/* A. Fixture conformance — Quebec City + Lisbon                       */
/* ------------------------------------------------------------------ */
if (section("A")) {
  for (const [cityKey, dest] of [["quebec-city", QUEBEC], ["lisbon", LISBON]]) {
    const exp = EXPECTED[cityKey];
    const calls = [];
    const collection = await collectPoiCandidatesFromOpenPlaces(
      openPlacesFetcher(cityKey, calls),
      dest,
      POLICY,
      TEST_KEY,
      { sleep: NO_SLEEP, now: FIXED_NOW }
    );
    eq(collection.candidates.length, exp.totalCandidates, `A/${cityKey}: candidate total reproduces the reference (${exp.totalCandidates})`);
    const byKind = {};
    for (const c of collection.candidates) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    for (const [kind, n] of Object.entries(exp.byKind)) {
      eq(byKind[kind] || 0, n, `A/${cityKey}: kind ${kind} count reproduces (${n})`);
    }
    eqC(
      collection.candidates.map((c) => [c.candidateKey, c.kind]),
      exp.listing.map((r) => [r.candidateKey, r.kind]),
      `A/${cityKey}: the exact candidate listing (keys + kinds, in order) reproduces the independent reference`
    );
    const ev = collection.evidence;
    eq(ev.dataRelease, exp.dataRelease, `A/${cityKey}: evidence carries the data release`);
    eq(ev.radiusMi, exp.radiusMi, `A/${cityKey}: radius is ceil(bbox half-diagonal) = ${exp.radiusMi} mi`);
    eq(ev.recordsReceived, exp.browsedRecords, `A/${cityKey}: unique records received reproduces`);
    eq(ev.droppedOutOfBbox, exp.droppedOutOfBbox, `A/${cityKey}: circle overshoot dropped by the bbox post-filter (${exp.droppedOutOfBbox})`);
    eq(ev.unclassified, exp.unclassified, `A/${cityKey}: unclassified count reproduces`);
    eq(ev.dedupedNameKind, exp.dedupedNameKind, `A/${cityKey}: name+kind dedupe count reproduces (${exp.dedupedNameKind})`);
    const fixturePages = Object.values(PAGES[cityKey].pages).reduce((a, p) => a + p.length, 0);
    eq(ev.callsUsed, fixturePages, `A/${cityKey}: calls used = recorded pages served (${fixturePages})`);
    eq(ev.partial, false, `A/${cityKey}: the recorded browse is complete, not partial`);
    eqC(ev.truncatedRoots, [], `A/${cityKey}: no truncated roots in the recorded browse`);
    for (const c of collection.candidates) {
      ok(isSourceKey(c.candidateKey), `A/${cityKey}: ${c.candidateKey} is a valid source key`);
      eq(parseSourceKey(c.candidateKey).source, "overture", `A/${cityKey}: ${c.candidateKey} parses as an overture source key`);
      ok(typeof c.url === "string" && c.url.length > 0, `A/${cityKey}: ${c.name} carries a non-empty url`);
      if (c.tags.website) eq(c.url, c.tags.website, `A/${cityKey}: ${c.name} url is its website when it has one`);
      else ok(/^overture:[0-9a-f-]{36}$/.test(c.url), `A/${cityKey}: ${c.name} url is the overture:<place_id> reference (never empty, never fabricated)`);
      eq(c.hoursRaw, null, `A/${cityKey}: ${c.name} hoursRaw is null (the API has no hours)`);
      const parsed = parseCandidateDTO(candidateRowToDTO(c, ev.fetchedAt));
      ok(parsed.ok, `A/${cityKey}: candidate ${c.candidateKey} conforms to CandidateDTO${parsed.ok ? "" : ": " + parsed.errors.join("; ")}`);
      eq(candidateRowToDTO(c, ev.fetchedAt).provenance.source, "overture", `A/${cityKey}: DTO provenance names the overture source`);
    }
    const provenance = openPlacesBuildProvenance(collection, ev.fetchedAt);
    eq(provenance.source, "overture-open-places", `A/${cityKey}: pack provenance source is overture-open-places`);
    ok(provenance.sourceRef.includes(exp.dataRelease), `A/${cityKey}: provenance sourceRef carries the data release`);
    ok(provenance.label.includes(OPEN_PLACES_CLASSIFIER_VERSION), `A/${cityKey}: provenance label carries the classifier stamp (${OPEN_PLACES_CLASSIFIER_VERSION})`);
    ok(provenance.label.includes(OPEN_PLACES_QUERY_VERSION), `A/${cityKey}: provenance label carries the browse-plan stamp (${OPEN_PLACES_QUERY_VERSION})`);
    ok(provenance.label.includes("viewpoint 0"), `A/${cityKey}: provenance names the viewpoint ZERO explicitly`);
    ok(provenance.label.includes("falls 0"), `A/${cityKey}: provenance names the falls ZERO explicitly`);
    if (cityKey === "lisbon") {
      ok(provenance.label.includes("ferry 0"), "A/lisbon: provenance names the ferry ZERO explicitly (Overture's ferry data does not survive category browse)");
      ok((byKind.lighthouse || 0) === 1, "A/lisbon: the one in-bbox lighthouse is in the pack");
    }
    // The full publish path: same rows, through the store.
    const store = new InMemoryPackStore(fakeClock("2026-10-23T02:00:00.000Z").now);
    await store.registerDestination(dest);
    const { job } = await requestBuild(store, dest.destinationId, "openplaces-proof");
    const opCalls2 = [];
    const version = await runBuildJob(
      store,
      job.jobId,
      async (d) => {
        const col = await collectPoiCandidatesFromOpenPlaces(openPlacesFetcher(cityKey, opCalls2), d, POLICY, TEST_KEY, { sleep: NO_SLEEP, now: FIXED_NOW });
        return { candidates: col.candidates, provenance: openPlacesBuildProvenance(col, col.evidence.fetchedAt) };
      },
      WORKER
    );
    eq(version.dto.status, "ready", `A/${cityKey}: adapter-built version publishes ready`);
    eq(version.dto.counts.candidates, exp.totalCandidates, `A/${cityKey}: published counts match the conformance total`);
    eq(version.dto.provenance.source, "overture-open-places", `A/${cityKey}: published provenance is the adapter's`);
    eq(version.dto.classifierVersion, OPEN_PLACES_CLASSIFIER_VERSION, `A/${cityKey}: published DTO classifierVersion is restamped truthfully (${OPEN_PLACES_CLASSIFIER_VERSION}), not the beginVersion default`);
    const stored = await store.getVersionCandidates(version.dto.packVersionId);
    eqC(packCounts(stored).total, exp.totalCandidates, `A/${cityKey}: stored rows reproduce the pack counts`);
  }
}

/* ------------------------------------------------------------------ */
/* B. Fallback triggers + the key gate                                 */
/* ------------------------------------------------------------------ */
if (section("B")) {
  // B1: OSM down + key -> adapter runs, pack publishes from Overture.
  {
    const store = new InMemoryPackStore(fakeClock("2026-10-23T02:00:00.000Z").now);
    await store.registerDestination(QUEBEC);
    const opCalls = [], osmCalls = [];
    const fetcher = combinedFetcher({ osmMode: "down", cityKey: "quebec-city", opCalls, osmCalls });
    const { job } = await requestBuild(store, QUEBEC.destinationId, "trigger-proof");
    const version = await runBuildJob(store, job.jobId, liveCollector(fetcher, POLICY, { openPlacesApiKey: TEST_KEY, openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } }), WORKER);
    ok(opCalls.length > 0, "B1: OSM-down triggered the Open Places adapter");
    ok(opCalls.every((c) => c.headers.Authorization === `Bearer ${TEST_KEY}`), "B1: every adapter call carried the bearer key");
    eq(version.dto.provenance.source, "overture-open-places", "B1: the published pack is the fallback's");
    eq(version.dto.classifierVersion, OPEN_PLACES_CLASSIFIER_VERSION, "B1: the fallback-built version's DTO classifierVersion is the truthful overture stamp");
    eq(version.dto.counts.candidates, EXPECTED["quebec-city"].totalCandidates, "B1: fallback pack holds the full fixture yield");
  }
  // B2: OSM answers but yields ZERO candidates + key -> adapter runs.
  {
    const opCalls = [], osmCalls = [];
    const fetcher = combinedFetcher({ osmMode: "empty", cityKey: "quebec-city", opCalls, osmCalls });
    const out = await liveCollector(fetcher, POLICY, { openPlacesApiKey: TEST_KEY, openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } })(QUEBEC);
    ok(opCalls.length > 0, "B2: OSM-empty triggered the Open Places adapter");
    eq(out.provenance.source, "overture-open-places", "B2: result is the fallback's");
    eq(out.candidates.length, EXPECTED["quebec-city"].totalCandidates, "B2: fallback candidates returned");
  }
  // B3: OSM partial (some candidates) + key -> adapter NEVER runs.
  {
    const opCalls = [], osmCalls = [];
    const fetcher = combinedFetcher({ osmMode: "partial", cityKey: "quebec-city", opCalls, osmCalls });
    const out = await liveCollector(fetcher, POLICY, { openPlacesApiKey: TEST_KEY, openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } })(QUEBEC);
    eq(opCalls.length, 0, "B3: a partial OSM collection never triggers the adapter (whole-pack fallback only)");
    eq(out.provenance.source, "openstreetmap-overpass", "B3: result is the OSM lane's");
    ok(out.candidates.length >= 3, "B3: the OSM candidates are the result");
    ok(out.candidates.every((c) => c.candidateKey.startsWith("osm:")), "B3: every candidate is OSM-sourced");
  }
  // B4: key absent (explicit null AND env default) + OSM down ->
  // zero adapter calls and the thrown error is the OSM lane's own,
  // byte-for-byte what collectPoiCandidates throws.
  {
    const directCalls = [];
    const directErr = await rejectsWith(
      collectPoiCandidates(overpassFetcher("down", directCalls), QUEBEC, POLICY),
      (e) => /Overpass collection failed for every chunk/.test(e.message),
      "B4: direct OSM collection fails as expected"
    );
    for (const opts of [{ openPlacesApiKey: null }, {}]) {
      const opCalls = [], osmCalls = [];
      const fetcher = combinedFetcher({ osmMode: "down", cityKey: "quebec-city", opCalls, osmCalls });
      await rejectsWith(
        liveCollector(fetcher, POLICY, opts)(QUEBEC),
        (e) => e.message === directErr.message,
        "B4: key-absent collector throws the OSM error byte-for-byte"
      );
      eq(opCalls.length, 0, "B4: key absent -> zero Open Places calls");
    }
  }
  // B5: key absent + OSM empty -> today's outcome: empty result,
  // OSM provenance, no adapter.
  {
    const opCalls = [], osmCalls = [];
    const fetcher = combinedFetcher({ osmMode: "empty", cityKey: "quebec-city", opCalls, osmCalls });
    const out = await liveCollector(fetcher, POLICY, { openPlacesApiKey: null })(QUEBEC);
    eq(out.candidates.length, 0, "B5: key-absent OSM-empty returns empty, exactly as before the adapter existed");
    eq(out.provenance.source, "openstreetmap-overpass", "B5: provenance is the OSM lane's");
    eq(opCalls.length, 0, "B5: zero adapter calls");
  }
  // B6: OSM success is byte-for-byte identical with and without a
  // key configured (the gate changes nothing on the happy path).
  {
    const run = async (opts) => {
      const opCalls = [], osmCalls = [];
      const fetcher = combinedFetcher({ osmMode: "partial", cityKey: "quebec-city", opCalls, osmCalls });
      const out = await liveCollector(fetcher, POLICY, opts)(QUEBEC);
      return { out, opCalls };
    };
    const noKey = await run({ openPlacesApiKey: null });
    const withKey = await run({ openPlacesApiKey: TEST_KEY, openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } });
    eqC(withKey.out.candidates, noKey.out.candidates, "B6: OSM-success candidates identical with/without the key");
    eqC(withKey.out.provenance, noKey.out.provenance, "B6: OSM-success provenance identical with/without the key");
    eq(withKey.opCalls.length, 0, "B6: no adapter calls on OSM success even with a key");
  }
  // B7: the env var alone activates the gate (production wiring:
  // cron + kick call liveCollector() with no options).
  {
    process.env.OPEN_PLACES_API_KEY = "env-key-123";
    try {
      const opCalls = [], osmCalls = [];
      const fetcher = combinedFetcher({ osmMode: "down", cityKey: "quebec-city", opCalls, osmCalls });
      const out = await liveCollector(fetcher, POLICY, { openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } })(QUEBEC);
      ok(opCalls.length > 0, "B7: OPEN_PLACES_API_KEY in env activates the fallback with no code wiring");
      ok(opCalls.every((c) => c.headers.Authorization === "Bearer env-key-123"), "B7: the env key is the bearer sent");
      eq(out.provenance.source, "overture-open-places", "B7: env-gated fallback produced the pack");
    } finally {
      delete process.env.OPEN_PLACES_API_KEY;
    }
  }
  // B8: an OSM-served build through the full publish path keeps
  // the beginVersion classifier stamp — the publish-time restamp
  // fires ONLY for fallback-served builds.
  {
    const store = new InMemoryPackStore(fakeClock("2026-10-23T02:00:00.000Z").now);
    await store.registerDestination(QUEBEC);
    const opCalls = [], osmCalls = [];
    const fetcher = combinedFetcher({ osmMode: "partial", cityKey: "quebec-city", opCalls, osmCalls });
    const { job } = await requestBuild(store, QUEBEC.destinationId, "restamp-negative-proof");
    const version = await runBuildJob(store, job.jobId, liveCollector(fetcher, POLICY, { openPlacesApiKey: TEST_KEY, openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } }), WORKER);
    eq(opCalls.length, 0, "B8: OSM-served build made no adapter calls");
    eq(version.dto.provenance.source, "openstreetmap-overpass", "B8: the published pack is the OSM lane's");
    eq(version.dto.classifierVersion, PACK_CLASSIFIER_VERSION, "B8: OSM-served version keeps the beginVersion classifier stamp (no restamp)");
  }
}

/* ------------------------------------------------------------------ */
/* C. Failure drills                                                   */
/* ------------------------------------------------------------------ */
if (section("C")) {
  const quotaBody = {
    error: {
      code: "quota_exhausted",
      message: "Monthly quota of 10000 searches is used up. It resets at 2026-11-01T00:00:00.000Z",
      request_id: "drill-quota",
      quota_limit: 10000,
      reset_at: "2026-11-01T00:00:00.000Z"
    }
  };
  const coverageBody = { error: { code: "coverage_not_ready", message: "Coverage is not ready for this location.", request_id: "drill-cov" } };

  // C1: 402 quota -> adapter aborts as provider failure; composed
  // collector throws; the build job FAILS and publishes nothing.
  {
    const calls = [];
    const alwaysQuota = async (url, init) => {
      calls.push({ url, headers: init?.headers || {} });
      return resp(402, quotaBody, { get: (n) => (n === "retry-after" ? "1036800" : null) });
    };
    const err = await rejectsWith(
      collectPoiCandidatesFromOpenPlaces(alwaysQuota, QUEBEC, POLICY, TEST_KEY, { sleep: NO_SLEEP, now: FIXED_NOW }),
      (e) => e instanceof OpenPlacesError && e.code === "quota_exhausted",
      "C1: 402 aborts the collection as a quota failure"
    );
    ok(/quota/i.test(err.message), "C1: the failure names the quota");
    eq(calls.length, 1, "C1: a 402 is never retried");

    const store = new InMemoryPackStore(fakeClock("2026-10-23T02:00:00.000Z").now);
    await store.registerDestination(QUEBEC);
    const { job } = await requestBuild(store, QUEBEC.destinationId, "quota-drill");
    const osmCalls = [];
    const fetcher = async (url, init) =>
      url.includes("openplacesapi.com") ? alwaysQuota(url, init) : overpassFetcher("down", osmCalls)(url, init);
    await rejectsWith(
      runBuildJob(store, job.jobId, liveCollector(fetcher, POLICY, { openPlacesApiKey: TEST_KEY, openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } }), WORKER),
      (e) => /Open Places fallback also failed/.test(e.message) && /quota/i.test(e.message),
      "C1: the composed collector throws a combined, honest failure"
    );
    eq((await store.getBuildJob(job.jobId)).status, "failed", "C1: the job records the failure (it waits for a later drain, as on any provider failure)");
    eq(await store.getReadyVersion(QUEBEC.destinationId), null, "C1: NO pack was published — a half-browsed pack never ships as complete");
  }

  // C2: coverage_not_ready once -> one Retry-After-compliant retry
  // -> collection succeeds; twice -> aborts as provider failure.
  {
    const sleeps = [];
    let covAttempts = 0;
    const calls = [];
    const fetcher = openPlacesFetcher("quebec-city", calls, async (root, offset) => {
      if (root === "arts_and_entertainment" && offset === 0) {
        covAttempts += 1;
        if (covAttempts === 1) return resp(503, coverageBody, { get: (n) => (n === "retry-after" ? "0" : null) });
      }
      return null;
    });
    const collection = await collectPoiCandidatesFromOpenPlaces(fetcher, QUEBEC, POLICY, TEST_KEY, {
      sleep: async (ms) => { sleeps.push(ms); },
      now: FIXED_NOW
    });
    eq(collection.candidates.length, EXPECTED["quebec-city"].totalCandidates, "C2: after one coverage retry the collection completes in full");
    eq(collection.evidence.coverageRetries, 1, "C2: exactly one coverage retry was needed and recorded");
    eqC(sleeps, [0], "C2: the retry waited the response's Retry-After (0s, via the header)");

    let attempts2 = 0;
    const fetcher2 = async () => {
      attempts2 += 1;
      return resp(503, coverageBody, { get: (n) => (n === "retry-after" ? "0" : null) });
    };
    await rejectsWith(
      collectPoiCandidatesFromOpenPlaces(fetcher2, QUEBEC, POLICY, TEST_KEY, { sleep: NO_SLEEP, now: FIXED_NOW }),
      (e) => e instanceof OpenPlacesError && e.code === "coverage_not_ready",
      "C2: a second coverage_not_ready aborts the collection as a provider failure"
    );
    eq(attempts2, 2, "C2: exactly one retry was attempted before aborting");
  }

  // C3: unknown-category drift — the API no longer knows a root:
  // the root contributes nothing, the drift is NAMED in evidence
  // and provenance, the rest of the pack still builds honestly.
  {
    const calls = [];
    const fetcher = openPlacesFetcher("quebec-city", calls, async (root) => {
      if (root === "waterfall") {
        return resp(200, {
          results: [],
          meta: {
            data_source: "overture",
            data_release: "2026-10-21.0",
            category: "waterfall",
            limit: 50,
            offset: 0,
            next_offset: null,
            warnings: [{ code: "unknown_category", message: "\"waterfall\" is not a known category." }]
          }
        });
      }
      return null;
    });
    const collection = await collectPoiCandidatesFromOpenPlaces(fetcher, QUEBEC, POLICY, TEST_KEY, { sleep: NO_SLEEP, now: FIXED_NOW });
    eqC(collection.evidence.unknownCategoryRoots, ["waterfall"], "C3: the drifted root is named in evidence");
    eq(collection.evidence.byKind.falls, 0, "C3: falls honestly zero");
    eq(collection.candidates.length, EXPECTED["quebec-city"].totalCandidates, "C3: the rest of the pack is unaffected (waterfall yielded zero in the fixture too)");
    ok(openPlacesBuildProvenance(collection, collection.evidence.fetchedAt).label.includes("unknown-category roots (taxonomy drift): waterfall"), "C3: provenance flags the drift on the pack's face");
  }

  // C4: pagination truncation — a root's window closes early:
  // partial acceptance, NAMED; never presented as complete.
  {
    const mini = {
      destinationId: "dst-truncation-drill",
      displayName: "Truncation Drill",
      country: "Canada",
      centre: { lat: 46.8139, lon: -71.208 },
      bbox: QUEBEC.bbox,
      timeZone: "America/Toronto",
      geocodeProvenance: LISBON.geocodeProvenance
    };
    const mkRec = (i) => ({
      place_id: `overture:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      name: `Drill Restaurant ${i}`,
      lat: 46.8139,
      lon: -71.208,
      distance_mi: 0.1,
      category: "restaurant",
      categories: ["restaurant"],
      category_hierarchy: ["food_and_drink", "restaurant"],
      confidence: 0.9
    });
    const fetcher = async (url) => {
      const u = new URL(url);
      const root = u.searchParams.get("category");
      const offset = Number(u.searchParams.get("offset") || 0);
      if (root !== "restaurant") {
        return resp(200, { results: [], meta: { data_release: "2026-10-21.0", next_offset: null, warnings: [] } });
      }
      const pageIdx = Math.floor(offset / 50);
      const results = Array.from({ length: 50 }, (_, j) => mkRec(pageIdx * 50 + j + 1));
      const last = pageIdx === 2;
      return resp(200, {
        results,
        meta: {
          data_release: "2026-10-21.0",
          next_offset: last ? null : offset + 50,
          warnings: last ? [{ code: "pagination_limit_reached", message: "More places match than the window can page." }] : []
        }
      });
    };
    const collection = await collectPoiCandidatesFromOpenPlaces(fetcher, mini, POLICY, TEST_KEY, { sleep: NO_SLEEP, now: FIXED_NOW });
    eq(collection.candidates.length, 150, "C4: the truncated browse still yields its window of candidates");
    eq(collection.evidence.partial, true, "C4: the collection is marked PARTIAL");
    eqC(collection.evidence.truncatedRoots, ["restaurant"], "C4: the truncated root is named");
    const label = openPlacesBuildProvenance(collection, collection.evidence.fetchedAt).label;
    ok(label.includes("PARTIAL") && label.includes("restaurant"), "C4: provenance states the partial truncation on the pack's face");
  }

  // C5: classifier drills — the precedence and honesty rules.
  {
    const rec = (over) => ({ place_id: "overture:11111111-2222-4333-8444-555555555555", name: "Drill", lat: 46.8, lon: -71.2, ...over });
    eq(
      classifyOvertureRecord(rec({ category: "restaurant", categories: ["restaurant", "historic_site"], category_hierarchy: ["food_and_drink", "restaurant"] })),
      "food",
      "C5: a historic ALTERNATE never makes a restaurant historic (spike §5)"
    );
    eq(
      classifyOvertureRecord(rec({ category: "castle", categories: ["castle"], category_hierarchy: ["cultural_and_historic", "historic_site", "castle"] })),
      "historic",
      "C5: a primary castle classifies historic"
    );
    eq(
      classifyOvertureRecord(rec({ category: null, categories: [], category_hierarchy: [] })),
      null,
      "C5: a record with no taxonomy at all is absent, never guessed"
    );
    eq(
      classifyOvertureRecord(rec({ name: "Sunset Viewpoint", category: "historic_site", categories: ["historic_site"], category_hierarchy: ["cultural_and_historic", "historic_site"] })),
      "historic",
      "C5: no viewpoint kind can be produced — Overture has no viewpoint category (the named gap)"
    );
    eq(
      classifyOvertureRecord(rec({ category: "bakery", categories: ["bakery"], category_hierarchy: ["food_and_drink", "bakery"] })),
      "food",
      "C5: a bakery classifies food even off the casual_eatery path"
    );
    eq(
      classifyOvertureRecord(rec({ category: "history_museum", categories: ["history_museum"], category_hierarchy: ["arts_and_entertainment", "museum", "history_museum"] })),
      "museum",
      "C5: a museum subtype classifies museum via its hierarchy"
    );
    eq(
      classifyOvertureRecord(rec({ category: "theatre_venue", categories: ["theatre_venue"], category_hierarchy: ["arts_and_entertainment", "theatre_venue"] })),
      "venue",
      "C5: a theatre is venue, not attraction — the catch-all sits after venue"
    );
    eq(
      classifyOvertureRecord(rec({ category: "escape_room", categories: ["escape_room"], category_hierarchy: ["arts_and_entertainment", "escape_room"] })),
      "attraction",
      "C5: a generic arts_and_entertainment record assembles into attraction"
    );
    const withSite = toOpenPlacesCandidate(rec({ website: "https://example.com/x" }), "food");
    eq(withSite.url, "https://example.com/x", "C5: url is the website when present");
    const noSite = toOpenPlacesCandidate(rec({}), "food");
    eq(noSite.url, "overture:11111111-2222-4333-8444-555555555555", "C5: url falls back to the verbatim place reference");
    eq(noSite.candidateKey, "overture:11111111-2222-4333-8444-555555555555", "C5: candidateKey is the overture source key");
  }
}

/* ------------------------------------------------------------------ */
/* D. Solver validity on the adapter-built Quebec pack                 */
/* ------------------------------------------------------------------ */
if (section("D")) {
  const store = new InMemoryPackStore(fakeClock("2026-10-23T02:00:00.000Z").now);
  await store.registerDestination(QUEBEC);
  const opCalls = [], osmCalls = [];
  const fetcher = combinedFetcher({ osmMode: "down", cityKey: "quebec-city", opCalls, osmCalls });
  const { job } = await requestBuild(store, QUEBEC.destinationId, "solver-validity");
  const version = await runBuildJob(store, job.jobId, liveCollector(fetcher, POLICY, { openPlacesApiKey: TEST_KEY, openPlaces: { sleep: NO_SLEEP, now: FIXED_NOW } }), WORKER);
  eq(version.dto.provenance.source, "overture-open-places", "D: the pack under test is adapter-built");
  const rows = await store.getVersionCandidates(version.dto.packVersionId);
  const counts = packCounts(rows);
  ok(counts.sights >= 100, `D: family floor — sights (${counts.sights} >= 100)`);
  ok(counts.foods >= 20, `D: family floor — foods (${counts.foods} >= 20)`);
  ok(counts.stays >= 30, `D: family floor — stays (${counts.stays} >= 30)`);
  ok(counts.transport >= 10, `D: family floor — transport (${counts.transport} >= 10)`);
  ok(version.dto.provenance.label.includes("viewpoint 0") && version.dto.provenance.label.includes("falls 0"), "D: named-zero families are on the published pack's face");

  // Weather is a separate artifact (unchanged by this lane); the
  // golden window's days are supplied directly to assembly.
  const scenarios = load("scenarios.json", FIX2).data;
  const sc = scenarios.find((s) => s.entry.id === "quebec-city-family");
  const entry = sc.entry;
  const dates = Array.from({ length: entry.days }, (_, i) => isoPlus(sc.startDate, i));
  const weatherDays = dates.map((date) => ({ date, tMax: 12, tMin: 4, precipProb: 20 }));
  const pack = assembleEnginePack(QUEBEC, version, rows, weatherDays);
  eq(pack.counts.total, EXPECTED["quebec-city"].totalCandidates, "D: the assembled engine pack carries every stored candidate");

  // The Phase 2 pipeline, as Phase 3 §G runs it — validity bar:
  // the trip solves, and the engine's final gate (judgeTrip, the
  // make-sense judge generate.ts assembles into final validation)
  // PASSES. Golden equality with the OSM pack is NOT the bar.
  const extracted = extractConstraints(sc.requestText);
  const truth = specConstraints(entry);
  const stays = scoreStays(pack);
  const anchorStay = stays[0] || null;
  ok(anchorStay !== null, "D: an anchor stay scores from the adapter pack");
  const basePos = anchorStay?.pos || { lat: entry.coordinates.latitude, lon: entry.coordinates.longitude };
  const baseName = anchorStay ? anchorStay.name : `${entry.destination} centre (base anchor)`;
  const earliestMin = parseHhmm(extracted.earliestStart || truth.earliestStart || "09:00");
  const restSpec = extracted.rest || truth.rest;
  const mustSees = (entry.checks || []).filter((c) => c.kind === "keyword").map((c) => ({ id: c.id, label: c.label, patterns: c.patterns }));
  const plan = solveTrip(pack, { days: entry.days, startIso: sc.startDate, dates, earliestMin, restSpec, mustSees, basePos, baseName });
  eq(plan.days.length, entry.days, "D: the solver produced every requested day");
  ok(plan.days.every((d) => d.items.length > 0), "D: every day has placed items");
  const judge = judgeTrip(plan.days, { earliestMin });
  eq(judge.pass, true, `D: the engine's final gate PASSES on the adapter-built pack (hard violations: ${JSON.stringify(judge.hardViolations)})`);
  eqC(judge.hardViolations, [], "D: zero hard violations");
}

console.log(`roamly-wiring-openplaces-checks: ${count} assertions PASS`);
