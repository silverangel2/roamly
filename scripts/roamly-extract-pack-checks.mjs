// Roamly SPEED FIX F1 checks (2026-11-07) — prebuilt Overture
// Places extracts as the PRIMARY pack source, live Overpass as the
// honest fallback (CRAWL-INVESTIGATION-REPORT F1; owner's method:
// proven free repos become primary, hand-rolled becomes fallback).
//
//   §1 Lane contract: a viable extract serves through
//      primaryCollector — provenance names the extract lane and
//      the dataset release; publish restamps the extract
//      classifier version; candidates carry overture: keys and
//      the source_dataset tag; the leg matrix is built over the
//      extract's candidates through the shared matrix tail.
//   §2 Thin extract (sight stock below the codebase's own thin
//      bar) falls through to the LIVE lane — the live lane's
//      provenance is what publishes.
//   §3 No extract at all: the live lane's outcome is preserved
//      exactly (same failure surface as liveCollector alone).
//   §4 REAL SLICE: the Fukuoka extract cut from the public
//      Overture S3 parquet release 2026-10-21.0 by
//      scripts/roamly-overture-extract-slice.mjs (43,037 records;
//      slice evidence in the speed-fix report) builds a real pack
//      through the primary collector against the real OSRM
//      service: wall-clock, per-kind candidate counts, leg matrix
//      present, version published and serving.
//   §5 The published extract pack assembles into an engine pack
//      (assembleEnginePack — the solver's input shape).
//
// The §4 extract file is read from ROAMLY_EXTRACT_PROOF_DIR or the
// goal's evidence copy; if it is absent the section SKIPs loudly
// (the slice is a one-time offline step, re-runnable any time).
//
// Run: npm run test:extract-pack (OSRM sections want the sandbox
// proxy env: NODE_USE_ENV_PROXY=1)

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { InMemoryPackStore } = await import("@/lib/roamly/engine/packs/store.ts");
const { primaryCollector, liveCollector, runBuildJob, readServingPack, assembleEnginePack } = await import(
  "@/lib/roamly/engine/packs/builder.ts"
);
const { collectPoiCandidatesFromExtract } = await import("@/lib/roamly/engine/packs/overtureExtract.ts");
const { OVERTURE_EXTRACT_FORMAT } = await import("@/lib/roamly/engine/packs/types.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
  console.log(`  PASS ${label}`);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label}\n  GOT:  ${JSON.stringify(actual)}\n  WANT: ${JSON.stringify(expected)}`);
  console.log(`  PASS ${label}`);
}

/* An OSRM-shaped stub fetcher: answers /table calls with a full
 * durations matrix sized to the coordinate list in the URL. */
function osrmStubFetcher(calls) {
  return async (url) => {
    calls.push(url);
    const coordPart = String(url).split("/").pop().split("?")[0];
    const n = coordPart.split(";").length;
    const durations = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 0 : 60 + Math.abs(i - j) * 30))
    );
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: "Ok", durations }) };
  };
}

const CENTRE = { lat: 45.0, lon: -64.0 };
function testDestination(destinationId) {
  return {
    destinationId,
    displayName: "Extractville",
    country: "Testland",
    centre: CENTRE,
    bbox: { minLat: 44.945, maxLat: 45.055, minLon: -64.075, maxLon: -63.925 },
    timeZone: "UTC",
    geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "extract checks" }
  };
}

let recSeq = 0;
function rec(category, hierarchy, name, dLat = 0, dLon = 0) {
  recSeq += 1;
  return {
    place_id: `overture:00000000-0000-4000-8000-${String(recSeq).padStart(12, "0")}`,
    name,
    lat: CENTRE.lat + dLat,
    lon: CENTRE.lon + dLon,
    category,
    categories: [category],
    category_hierarchy: hierarchy,
    website: null,
    confidence: 0.9,
    operating_status: null
  };
}

function syntheticExtract(destinationId, { sights = 16, stays = 3, foods = 4, parks = 2 } = {}) {
  const records = [];
  for (let i = 0; i < sights; i += 1) {
    records.push(rec("museum", ["arts_and_entertainment", "museum"], `Extract Museum ${i + 1}`, 0.001 * i, 0.001 * i));
  }
  for (let i = 0; i < stays; i += 1) {
    records.push(rec("hotel", ["lodging", "hotel"], `Extract Hotel ${i + 1}`, -0.002 * i, 0.001 * i));
  }
  for (let i = 0; i < foods; i += 1) {
    records.push(rec("restaurant", ["food_and_drink", "restaurant"], `Extract Bistro ${i + 1}`, 0.001 * i, -0.002 * i));
  }
  for (let i = 0; i < parks; i += 1) {
    records.push(rec("park", ["outdoors_and_recreation", "park"], `Extract Park ${i + 1}`, -0.001 * i, -0.001 * i));
  }
  // One out-of-coverage record: classification must drop it.
  records.push(rec("museum", ["arts_and_entertainment", "museum"], "Far Away Museum", 5, 5));
  // One taxonomy-less record: classifies null, never guessed.
  records.push({ ...rec("museum", [], "Ghost Record"), category: null, categories: [], category_hierarchy: [] });
  return {
    format: OVERTURE_EXTRACT_FORMAT,
    release: "2026-10-21.0",
    slicedAt: "2026-11-07T00:00:00.000Z",
    destination: { destinationId, displayName: "Extractville", country: "Testland" },
    records
  };
}

/* ---------------- §1 — the extract lane serves ---------------- */
{
  const dest = testDestination("dst-extract-1");
  const extract = syntheticExtract(dest.destinationId);
  const osrmCalls = [];
  const collector = primaryCollector(osrmStubFetcher(osrmCalls), undefined, {
    extract: { loader: async () => extract },
    openPlacesApiKey: null
  });
  const collected = await collector(dest);
  eq(collected.provenance.source, "overture-places-extract", "§1 the extract lane serves (provenance source)");
  eq(collected.provenance.sourceRef, "overture-extract:2026-10-21.0", "§1 provenance names the dataset release");
  ok(collected.provenance.label.includes("CDLA Permissive 2.0"), "§1 the label carries the dataset licence");
  ok(collected.provenance.label.includes("overture-extract-classifier-1"), "§1 the label carries the extract classifier version");
  const kinds = {};
  for (const c of collected.candidates) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  eq(kinds.museum, 16, "§1 museums classified (out-of-coverage + taxonomy-less dropped)");
  eq(kinds.stay, 3, "§1 stays classified");
  eq(kinds.food, 4, "§1 food classified");
  eq(kinds.park, 2, "§1 parks classified");
  ok(collected.candidates.every((c) => c.candidateKey.startsWith("overture:")), "§1 candidates keep overture: identity keys");
  ok(
    collected.candidates.every((c) => c.tags && c.tags.source_dataset === "overture-places-extract"),
    "§1 every candidate is tagged as extract-served (row-level honesty)"
  );
  ok(collected.legMatrix, "§1 the leg matrix is built over the extract's candidates");
  ok(osrmCalls.length >= 2, "§1 both OSRM profiles were queried for the matrix");
  ok(collected.legMatrix.keys.length > 0, "§1 the matrix carries candidate keys");

  // Publish path: the version restamps the extract classifier.
  const store = new InMemoryPackStore();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "extract-checks");
  const published = await runBuildJob(store, job.jobId, async () => collected, { workerId: "extract-checks" });
  ok(published, "§1 the extract collection publishes");
  eq(published.dto.provenance.source, "overture-places-extract", "§1 published provenance is the extract lane");
  eq(published.dto.classifierVersion, "overture-extract-classifier-1", "§1 publish restamps the extract classifier version");
  const serving = await readServingPack(store, dest.destinationId);
  eq(serving.state, "ready", "§1 the extract pack serves");
}

/* ---------------- §2 — thin extract falls through to live ---------------- */
{
  const dest = testDestination("dst-extract-2");
  const thin = syntheticExtract(dest.destinationId, { sights: 3, stays: 1, foods: 1, parks: 0 });
  const collection = await collectPoiCandidatesFromExtract(dest, { loader: async () => thin });
  ok(collection && collection.candidates.length > 0, "§2 the thin extract does classify (the bar is viability, not existence)");
  // Live lane behind it: Overpass answers empty chunks; the live
  // collection is what the primary collector must return.
  const emptyOverpass = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ elements: [] }) });
  const primary = primaryCollector(emptyOverpass, undefined, {
    extract: { loader: async () => thin },
    openPlacesApiKey: null
  });
  const liveOnly = liveCollector(emptyOverpass, undefined, { openPlacesApiKey: null });
  const viaPrimary = await primary(dest);
  const viaLive = await liveOnly(dest);
  eq(viaPrimary.provenance.source, viaLive.provenance.source, "§2 thin extract: the LIVE lane serves through the primary collector");
  eq(viaPrimary.provenance.source, "openstreetmap-overpass", "§2 the serving provenance is honestly the live lane");
  eq(viaPrimary.candidates.length, viaLive.candidates.length, "§2 the live outcome is preserved exactly");
}

/* ---------------- §3 — no extract: live outcome preserved ---------------- */
{
  const dest = testDestination("dst-extract-3");
  const failing = async () => ({ ok: false, status: 502, text: async () => "overpass at capacity" });
  const primary = primaryCollector(failing, undefined, {
    extract: { loader: async () => null },
    openPlacesApiKey: null
  });
  const liveOnly = liveCollector(failing, undefined, { openPlacesApiKey: null });
  let primaryOutcome;
  let liveOutcome;
  try {
    const r = await primary(dest);
    primaryOutcome = `ok:${r.candidates.length}:${r.provenance.source}`;
  } catch (err) {
    primaryOutcome = `throw:${err.message}`;
  }
  try {
    const r = await liveOnly(dest);
    liveOutcome = `ok:${r.candidates.length}:${r.provenance.source}`;
  } catch (err) {
    liveOutcome = `throw:${err.message}`;
  }
  eq(primaryOutcome, liveOutcome, "§3 with no extract, the primary collector IS the live lane (same outcome, same failure surface)");
}

/* ---------------- §4 — the real Fukuoka slice builds a real pack ---------------- */
const proofDir =
  process.env.ROAMLY_EXTRACT_PROOF_DIR ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "goals", "roamly-october-4-repair", "hidden_files", "ship-2026-11-07", "extracts");
const fukuokaFile = join(proofDir, "fukuoka-overture-2026-10-21.0.json");
if (!existsSync(fukuokaFile)) {
  console.log(`  SKIP §4/§5 — real extract not found at ${fukuokaFile} (re-run scripts/roamly-overture-extract-slice.mjs)`);
} else {
  const { readFile } = await import("node:fs/promises");
  const fileDoc = JSON.parse(await readFile(fukuokaFile, "utf8"));
  eq(fileDoc.format, OVERTURE_EXTRACT_FORMAT, "§4 the sliced file carries the extract format marker");
  ok(fileDoc.records.length > 40_000, `§4 the slice is the real thing (${fileDoc.records.length} records)`);
  const dest = {
    destinationId: fileDoc.destination.destinationId,
    displayName: "Fukuoka",
    country: "Japan",
    centre: { lat: 33.5904, lon: 130.4017 },
    bbox: { minLat: 33.5354, maxLat: 33.6454, minLon: 130.3267, maxLon: 130.4767 },
    timeZone: "Asia/Tokyo",
    geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "extract checks (real slice)" }
  };
  // The runtime loader's own path: directory resolution by
  // destinationId — stage the evidence file under its runtime
  // name (symlink, no second 16 MB copy) and let loadOvertureExtract
  // find it exactly as production would.
  const { mkdtemp, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const stageDir = await mkdtemp(join(tmpdir(), "roamly-extract-proof-"));
  await symlink(fukuokaFile, join(stageDir, `${fileDoc.destination.destinationId}.json`));
  const store = new InMemoryPackStore();
  await store.registerDestination(dest);
  const { job } = await store.enqueueBuild(dest.destinationId, "extract-checks-real");
  const collector = primaryCollector(undefined, undefined, {
    extract: { dir: stageDir },
    openPlacesApiKey: null
  });
  const began = Date.now();
  const published = await runBuildJob(store, job.jobId, collector, { workerId: "extract-checks-real" });
  const elapsedMs = Date.now() - began;
  ok(published, "§4 the real Fukuoka extract publishes a pack");
  eq(published.dto.provenance.source, "overture-places-extract", "§4 the real pack's provenance is the extract lane");
  eq(published.dto.classifierVersion, "overture-extract-classifier-1", "§4 the real pack carries the extract classifier stamp");
  const pinned = await store.readPinned(published.dto.packVersionId);
  ok(pinned && Array.isArray(pinned.candidates), "§4 the published version's candidates read back through the pin path");
  const publishedCandidates = pinned.candidates;
  const byKind = {};
  for (const c of publishedCandidates) byKind[c.kind] = (byKind[c.kind] || 0) + 1;
  console.log(`  INFO §4 Fukuoka pack: ${publishedCandidates.length} candidates in ${elapsedMs}ms; by kind ${JSON.stringify(byKind)}`);
  ok(publishedCandidates.length >= 1000, `§4 candidate volume is Overpass-pack class (${publishedCandidates.length})`);
  ok((byKind.museum || 0) + (byKind.attraction || 0) + (byKind.park || 0) >= 12, "§4 sight stock is far past the thin bar");
  ok((byKind.stay || 0) >= 10, `§4 stay stock is real (${byKind.stay || 0})`);
  ok((byKind.food || 0) >= 100, `§4 food stock is real (${byKind.food || 0})`);
  ok(published.legMatrix, "§4 the published version carries a leg matrix built over its candidates");
  ok(elapsedMs < 120_000, `§4 the whole build (classify + real OSRM matrix) took ${elapsedMs}ms — no Overpass collection, no cron`);
  const serving = await readServingPack(store, dest.destinationId);
  eq(serving.state, "ready", "§4 the Fukuoka pack serves");

  /* ---------------- §5 — engine pack assembly over the extract pack ---------------- */
  const enginePack = assembleEnginePack(dest, published, publishedCandidates, []);
  ok(enginePack, "§5 the extract pack assembles into an engine pack");
  const solverInputCount =
    enginePack.stays.length + enginePack.sights.length + enginePack.excursions.length + enginePack.foods.length + enginePack.transport.length;
  ok(solverInputCount >= 1000, `§5 the solver's input is fully stocked from the extract pack (${solverInputCount} slotted candidates)`);
  ok(enginePack.legMatrix, "§5 the engine pack carries the leg matrix built over its candidates (real OSRM)");
  ok(enginePack.legMatrix.keys.length > 0, "§5 the matrix covers the solver shortlist keys");
  await rm(stageDir, { recursive: true, force: true });
}

console.log(`EXTRACT-PACK CHECKS: ${count}/${count} PASS`);
