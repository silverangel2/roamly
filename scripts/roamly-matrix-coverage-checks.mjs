// Matrix-coverage fix checks (2026-11-07).
//
// The Tokyo miss (MATRIX-MISS-REPORT, SETTLED): the pack's OSRM
// leg matrix was perfect — 100 keys, both profile grids fully
// populated — but its 100 points were the WRONG 100. The three
// food stops a real 3-day trip picked sat outside the key set:
// food defaults to solver rank 9, so the (RANK, distance) top-up
// shut them out behind every headline candidate in a
// 14,627-candidate pack, and the canonical shortlist (solves
// anchored only at the destination centre) never picked them
// either, because a real trip anchors at its stay and the
// solver's meal picks follow the chain's position. Every leg
// fell back to haversine, invisibly: the leg's minutesSource
// label died at the persistence boundary.
//
// These checks pin the four-part fix:
//   (a) legMatrixPoints top-up splits into a rank tranche + a
//       pure-distance tranche (solver RANK itself untouched);
//   (b) the point set aligns with what real solves pick — the
//       shortlist runs trip CLASSES (centre-anchored AND
//       top-stay-anchored), and a per-kind near-centre guarantee
//       puts the nearest 2 of every kind in on geography alone.
//       The Tokyo-shape fixture below proves the guarantee the
//       report demands: every stop a real stay-anchored solve
//       chooses is in the point set, while the foods sit beyond
//       the cap in BOTH the rank order and the centre-distance
//       order (positions 118-121 of 121) — the old fill could
//       never have reached them;
//   (c) buildLegMatrix records per-profile success (profiles)
//       and the foot call gets its own budget + one retry — a
//       dead profile is a stated fact of the artefact;
//   (d) generate.ts persists leg.minutesSource as
//       travelTimeSource on the stored leg seeds.
import assert from "node:assert/strict";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const { solveTrip, RANK } = await import("@/lib/roamly/engine/solver.ts");
const { solverShortlistKeys, storedCandidateToEngine } = await import(
  "@/lib/roamly/engine/packs/builder.ts"
);
const { legMatrixPoints, buildLegMatrix, LEG_MATRIX_MAX_POINTS } = await import(
  "@/lib/roamly/engine/packs/legMatrix.ts"
);
const { engineDayToRoamlyDayPlan } = await import("@/lib/roamly/engine/generate.ts");
const { haversineKm } = await import("@/lib/roamly/engine/util.ts");

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, label);
}

/* ------------------------------------------------------------------ */
/* Tokyo-shape fixture                                                 */
/* ------------------------------------------------------------------ */

const C = { lat: 35.681, lon: 139.692 };
const row = (osmKey, kind, name, lat, lon) => ({
  candidateKey: `osm:${osmKey}`,
  osmKey,
  kind,
  name,
  nameEn: null,
  pos: { lat, lon },
  hoursRaw: null,
  tags: {},
  url: `https://example.invalid/${osmKey}`,
  enrichment: null
});
const HEADLINE_KINDS = ["museum", "gallery", "attraction", "viewpoint", "park", "historic", "market", "venue"];
const candidates = [];
let n = 0;
for (let gx = -5; gx <= 5 && n < 109; gx++) {
  for (let gy = -5; gy <= 4 && n < 109; gy++) {
    if (gx === 0 && gy === 0) continue;
    n += 1;
    candidates.push(
      row(`node/c${n}`, HEADLINE_KINDS[n % HEADLINE_KINDS.length], `Centre Sight ${n}`, C.lat + gx * 0.0013, C.lon + gy * 0.0016)
    );
  }
}
// One stay 2.6 km east (the trip's anchor class), its own sight
// cluster, and the pack's only three foods around it.
const S = { lat: 35.681, lon: 139.721 };
candidates.push(row("node/stay-1", "stay", "Eastside Hotel", S.lat, S.lon));
for (let i = 0; i < 8; i++) {
  candidates.push(
    row(`node/s${i + 1}`, HEADLINE_KINDS[i % HEADLINE_KINDS.length], `East Sight ${i + 1}`, S.lat + (i - 3.5) * 0.0011, S.lon + ((i % 3) - 1) * 0.0016)
  );
}
const FOODS = [
  row("node/f1", "food", "Izakaya Hana", S.lat + 0.0011, S.lon + 0.0005),
  row("node/f2", "food", "Ramen Dojo", S.lat - 0.0016, S.lon + 0.0012),
  row("node/f3", "food", "Sushi Kappo", S.lat + 0.0004, S.lon - 0.0028)
];
candidates.push(...FOODS);

const dest = {
  destinationId: "dst-matrix",
  displayName: "Matrix City",
  country: "Testland",
  centre: C,
  bbox: null,
  timeZone: "UTC",
  geocodeProvenance: { source: "test", sourceRef: null, recordedAt: null, label: "matrix coverage checks" }
};
const engineCandidates = candidates.map((r) => storedCandidateToEngine(r)).filter(Boolean);
const pack = {
  destination: "Matrix City",
  country: "Testland",
  center: C,
  legMatrix: null,
  counts: { total: engineCandidates.length, sights: 117, foods: 3, stays: 1, transport: 0 },
  stays: engineCandidates.filter((c) => c.kind === "stay"),
  sights: engineCandidates.filter((c) => HEADLINE_KINDS.includes(c.kind)),
  excursions: [],
  foods: engineCandidates.filter((c) => c.kind === "food"),
  transport: [],
  weather: []
};
const DATES = ["2026-11-09", "2026-11-10", "2026-11-11"]; // Mon-Wed
const solveSpec = (basePos, baseName) => ({
  days: 3,
  startIso: DATES[0],
  dates: DATES,
  earliestMin: 9 * 60,
  restSpec: null,
  mustSees: [],
  basePos,
  baseName
});
const pickedKeys = (plan) => {
  const picked = new Set();
  for (const day of plan.days) {
    for (const leg of day.legs) {
      picked.add(leg.fromKey);
      picked.add(leg.toKey);
    }
    for (const item of day.items) if (item.key) picked.add(item.key);
  }
  picked.delete("base");
  return picked;
};

/* ------------------------------------------------------------------ */
/* (b) Tokyo shape — divergence, trip classes, the guarantee           */
/* ------------------------------------------------------------------ */

console.log("(b) Tokyo shape — the foods the old fill could never reach");

{
  const placed = candidates.filter((c) => c.pos);
  const byRankDist = [...placed].sort(
    (a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9) || haversineKm(C, a.pos) - haversineKm(C, b.pos)
  );
  const byDist = [...placed].sort((a, b) => haversineKm(C, a.pos) - haversineKm(C, b.pos));
  for (const f of FOODS) {
    ok(
      byRankDist.indexOf(f) + 1 > LEG_MATRIX_MAX_POINTS - 1,
      `b1: ${f.osmKey} sits beyond the cap in the old (RANK, distance) fill order (position ${byRankDist.indexOf(f) + 1})`
    );
    ok(
      byDist.indexOf(f) + 1 > LEG_MATRIX_MAX_POINTS - 1,
      `b1: ${f.osmKey} sits beyond the cap in pure centre-distance order too (position ${byDist.indexOf(f) + 1}) — geography from the CENTRE cannot save it; the anchor class is the difference`
    );
  }

  // The divergence, behaviourally: a centre-anchored solve never
  // reaches the stay's foods (meal picks follow the chain, and
  // its chains stay in the centre cluster); a stay-anchored solve
  // — the class a real no-booking trip solves — picks them.
  const centrePicks = pickedKeys(solveTrip(pack, solveSpec(C, "Matrix City")));
  ok(
    FOODS.every((f) => !centrePicks.has(f.osmKey)),
    "b2: the centre-anchored class picks NONE of the three foods (the old shortlist's blind spot)"
  );
  const realPicks = pickedKeys(solveTrip(pack, solveSpec(S, "Eastside Hotel")));
  ok(
    FOODS.every((f) => realPicks.has(f.osmKey)),
    "b2: the stay-anchored solve (the real trip's class) picks all three foods"
  );

  // The trip-class shortlist carries them into the point set.
  const shortlist = solverShortlistKeys(dest, candidates, new Date(Date.UTC(2026, 10, 2)));
  ok(
    FOODS.every((f) => shortlist.includes(f.osmKey)),
    "b3: solverShortlistKeys (trip classes) contains all three foods"
  );

  // THE GUARANTEE: every stop the real solve chose is in the set.
  const points = legMatrixPoints(C, candidates, shortlist);
  const pointKeys = new Set(points.map((p) => p.key));
  eq(points.length, LEG_MATRIX_MAX_POINTS, "b4: the point set fills the cap");
  eq(points[0].key, "base", "b4: the centre stays first under key base");
  const missing = [...realPicks].filter((k) => !pointKeys.has(k));
  eq(
    JSON.stringify(missing),
    "[]",
    `b4: every stop the real stay-anchored solve chose is in the point set (missing: ${JSON.stringify(missing)})`
  );

  // The per-kind guarantee alone (empty shortlist): the nearest
  // two foods enter on geography; the third is beyond the
  // guarantee's stated size and honestly not promised.
  const guaranteed = legMatrixPoints(C, candidates, []);
  const guaranteedKeys = new Set(guaranteed.map((p) => p.key));
  const foodsByCentreDist = [...FOODS].sort((a, b) => haversineKm(C, a.pos) - haversineKm(C, b.pos));
  ok(guaranteedKeys.has(foodsByCentreDist[0].osmKey), "b5: per-kind guarantee includes the nearest food");
  ok(guaranteedKeys.has(foodsByCentreDist[1].osmKey), "b5: per-kind guarantee includes the second-nearest food");
  ok(guaranteedKeys.has("node/stay-1"), "b5: per-kind guarantee includes the pack's stay (also a rank-9 kind)");
}

/* ------------------------------------------------------------------ */
/* (a) The tranche split                                               */
/* ------------------------------------------------------------------ */

console.log("(a) tranches — rank priority AND geography both honoured");

{
  const museums = [];
  for (let i = 0; i < 130; i++) {
    museums.push(row(`node/m${i}`, "museum", `Far Museum ${i}`, C.lat + 0.018, C.lon + (i - 65) * 0.0004));
  }
  const nearFoods = [];
  for (let i = 0; i < 60; i++) {
    nearFoods.push(row(`node/nf${i}`, "food", `Near Eatery ${i}`, C.lat + (i - 30) * 0.00012, C.lon + 0.0018));
  }
  const points = legMatrixPoints(C, [...museums, ...nearFoods], []);
  const keys = new Set(points.map((p) => p.key));
  const museumCount = [...keys].filter((k) => k.startsWith("node/m")).length;
  const foodCount = [...keys].filter((k) => k.startsWith("node/nf")).length;
  eq(points.length, LEG_MATRIX_MAX_POINTS, "a1: the tranche fixture fills the cap");
  ok(foodCount >= 40, `a1: near-centre foods enter on geography despite rank 9 (got ${foodCount}; the old fill admitted 0)`);
  ok(museumCount >= 40, `a1: headline kinds keep their rank tranche (got ${museumCount})`);
  eq(RANK.museum, 1, "a2: solver RANK itself is untouched (museum still rank 1)");
  eq(RANK.food ?? 9, 9, "a2: food still defaults to rank 9 — the fix is in the fill, not the solver");
}

/* ------------------------------------------------------------------ */
/* (c) Per-profile truth + foot retry                                  */
/* ------------------------------------------------------------------ */

console.log("(c) buildLegMatrix — profiles recorded, foot retried");

const grid = (size, seconds) => Array.from({ length: size }, () => Array.from({ length: size }, () => seconds));
function stubFetcher({ carOk = true, footOutcomes = [true] } = {}) {
  const calls = { car: 0, foot: 0 };
  const fetcher = async (url) => {
    const isFoot = url.includes("routed-foot");
    if (isFoot) {
      calls.foot += 1;
      const outcome = footOutcomes[Math.min(calls.foot - 1, footOutcomes.length - 1)];
      if (!outcome) return { ok: false, status: 503, text: async () => "down" };
      // points count is encoded in the URL's coordinate count.
      const size = url.split("?")[0].split("/").pop().split(";").length;
      return { ok: true, status: 200, text: async () => JSON.stringify({ code: "Ok", durations: grid(size, 600) }) };
    }
    calls.car += 1;
    if (!carOk) return { ok: false, status: 503, text: async () => "down" };
    const size = url.split("?")[0].split("/").pop().split(";").length;
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: "Ok", durations: grid(size, 900) }) };
  };
  return { fetcher, calls };
}
const fewCandidates = candidates.slice(0, 6);

{
  const { fetcher, calls } = stubFetcher({ footOutcomes: [false, false] });
  const matrix = await buildLegMatrix(fetcher, C, fewCandidates, () => new Date());
  ok(matrix, "c1: a single-profile success still yields a matrix");
  eq(matrix.profiles.drive, true, "c1: the drive profile is recorded successful");
  eq(matrix.profiles.walk, false, "c1: the dead foot profile is RECORDED false — visible in the artefact, not silent");
  ok(
    matrix.walkSeconds.every((rowCells) => rowCells.every((cell) => cell === null)),
    "c1: the dead profile's grid is blank (per-leg fallback at solve time)"
  );
  eq(matrix.driveSeconds[0][1], 900, "c1: the live profile's grid is real");
  eq(calls.foot, 2, "c1: the foot call was retried exactly once before being recorded dead");
  eq(calls.car, 1, "c1: the car call was not retried (the retry belongs to foot)");
}
{
  const { fetcher, calls } = stubFetcher({ footOutcomes: [false, true] });
  const matrix = await buildLegMatrix(fetcher, C, fewCandidates, () => new Date());
  eq(matrix.profiles.walk, true, "c2: a foot success on retry records walk: true");
  eq(matrix.walkSeconds[0][1], 600, "c2: the retried grid is the stored grid");
  eq(calls.foot, 2, "c2: exactly one retry was needed");
}
{
  const { fetcher, calls } = stubFetcher({ carOk: false, footOutcomes: [false, false] });
  const matrix = await buildLegMatrix(fetcher, C, fewCandidates, () => new Date());
  eq(matrix, null, "c3: both profiles down still returns null (no matrix, honest fallback)");
  eq(calls.foot, 2, "c3: foot still got its retry before the build gave up on it");
}
{
  const { fetcher, calls } = stubFetcher({});
  const matrix = await buildLegMatrix(fetcher, C, fewCandidates, () => new Date());
  eq(matrix.profiles.drive, true, "c4: both profiles live — drive recorded true");
  eq(matrix.profiles.walk, true, "c4: both profiles live — walk recorded true");
  eq(calls.foot, 1, "c4: no retry when the first foot call succeeds");
}

/* ------------------------------------------------------------------ */
/* (d) minutesSource survives persistence                              */
/* ------------------------------------------------------------------ */

console.log("(d) travelTimeSource — routed vs estimate in the stored artefact");

{
  // A small pack, a real built matrix over its points, a real
  // solve: legs over covered pairs must be labelled osrm-routed,
  // and the day conversion must persist the label on the seeds.
  const small = [
    row("node/stay-1", "stay", "Eastside Hotel", S.lat, S.lon),
    row("node/s1", "museum", "East Museum", S.lat + 0.0011, S.lon + 0.0016),
    row("node/s2", "park", "East Park", S.lat - 0.0011, S.lon - 0.0016),
    ...FOODS
  ];
  const { fetcher } = stubFetcher({});
  const matrix = await buildLegMatrix(fetcher, C, small, () => new Date(), 20_000, solverShortlistKeys(dest, small, new Date(Date.UTC(2026, 10, 2))));
  ok(matrix && matrix.profiles.walk && matrix.profiles.drive, "d1: the small pack's matrix built with both profiles");
  const smallEngine = small.map((r) => storedCandidateToEngine(r)).filter(Boolean);
  const smallPack = {
    ...pack,
    legMatrix: matrix,
    stays: smallEngine.filter((c) => c.kind === "stay"),
    sights: smallEngine.filter((c) => HEADLINE_KINDS.includes(c.kind)),
    foods: smallEngine.filter((c) => c.kind === "food")
  };
  const plan = solveTrip(smallPack, solveSpec(S, "Eastside Hotel"));
  const legs = plan.days.flatMap((day) => day.legs);
  ok(legs.length > 0, "d1: the small solve produced legs");
  ok(
    legs.every((leg) => leg.minutesSource === "osrm-routed"),
    "d1: every leg over matrix-covered pairs is labelled osrm-routed by the solver"
  );

  const dayPlan = engineDayToRoamlyDayPlan(plan.days[0], {
    destination: "Matrix City",
    anchorName: "Eastside Hotel",
    anchorKey: "node/stay-1",
    anchorBooked: false,
    anchorSource: "scored-fallback",
    anchorPos: S,
    totalDayCount: 3,
    mustSeeKeys: new Set(),
    originLabel: null
  });
  const legSeeds = (dayPlan.live_timeline || []).filter((item) => item.item_type === "transfer");
  ok(legSeeds.length > 0, "d2: the converted day carries leg seeds");
  ok(
    legSeeds.every((seed) => seed.travelTimeSource === "osrm-routed"),
    "d2: routed legs persist travelTimeSource=osrm-routed in the artefact"
  );

  // An estimate leg and an unlabelled leg, converted directly:
  // the estimate keeps its label; the unlabelled leg gains none.
  const handDay = {
    dayNumber: 1,
    date: DATES[0],
    role: "full",
    endMin: 1320,
    narrative: [],
    items: [],
    legs: [
      { fromKey: "base", toKey: "node/s1", fromName: "Eastside Hotel", toName: "East Museum", mode: "walk", km: 0.4, minutes: 6, minutesSource: "haversine-estimate", depart: 540, arrive: 546 },
      { fromKey: "node/s1", toKey: "base", fromName: "East Museum", toName: "Eastside Hotel", mode: "walk", km: 0.4, minutes: 6, depart: 700, arrive: 706 }
    ]
  };
  const handPlan = engineDayToRoamlyDayPlan(handDay, {
    destination: "Matrix City",
    anchorName: "Eastside Hotel",
    anchorKey: "node/stay-1",
    anchorBooked: false,
    anchorSource: "scored-fallback",
    anchorPos: S,
    totalDayCount: 1,
    mustSeeKeys: new Set(),
    originLabel: null
  });
  const handSeeds = (handPlan.live_timeline || []).filter((item) => item.item_type === "transfer");
  eq(handSeeds.length, 2, "d3: both hand-built legs converted");
  eq(
    handSeeds.find((seed) => seed.destination === "East Museum")?.travelTimeSource,
    "haversine-estimate",
    "d3: an estimate leg persists travelTimeSource=haversine-estimate — the fallback is labelled in the artefact"
  );
  const unlabelled = handSeeds.find((seed) => seed.destination === "Eastside Hotel" && seed.item_type === "transfer");
  ok(
    unlabelled && !("travelTimeSource" in unlabelled),
    "d3: a leg the solver never labelled gains no invented label"
  );
}

console.log(`\nPASS: ${count} matrix-coverage checks — the point set covers what solves pick, and estimates stay labelled.`);
