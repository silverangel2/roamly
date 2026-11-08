// Europe findings checks (2026-11-08, Paris production test —
// daily-test-runs/2026-11-08-europe). The production run graded
// three NOT DONE legs; each traced to a product defect, fixed
// product-side. These checks pin the fixes at the layer that owns
// them, on the EXACT Paris request text:
//
//   F2 REST MARKER CLOCK — "no starts before eight thirty" was
//      extracted as 08:00 (the single-word capture dropped the
//      minutes), so the solver's earliestMin was 480 and the day-3
//      "Slow morning — nothing booked" marker was stamped 08:00
//      against the traveller's stated 08:30. Pinned here:
//      extraction carries the whole time phrase, and the rest
//      marker minted from it starts at/after the stated time.
//   F3 CONDITIONAL ASK DROPPED — "a day trip to Versailles if it
//      fits the plan" derived a must-see with NO requirement (the
//      label has no head-kind noun; the proper noun counted as
//      context), and the pattern ladder's fallback token "plan"
//      substring-matched "Histoire des Plantes": the solver
//      reported the day trip "scheduled" against a plant museum —
//      no Versailles in the plan, no unmet note, silence. Pinned
//      here: a pure named-place ask anchors on the place's own
//      name; without a candidate naming it, the must-see is
//      honestly UNMET (and named in the day words by the existing
//      namedMustSeeMiss path); with one, it schedules as itself.
//   F1 EMAIL RUN-1-COLLAPSE — proven in
//      test:live-companion-travel-day (S1/S3/S6, the real
//      dispatcher over the fake Supabase): the catch-up clamp's
//      +60s cushion hid the burst from run 1. Only a static
//      wiring pin lives here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractConstraints, mustSeeRequirement, namedMustSeeMiss } from "@/lib/roamly/engine/understand.ts";
import { deriveMustSees } from "@/lib/roamly/engine/generate.ts";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";
import { parseHhmm } from "@/lib/roamly/engine/util.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

const PARIS_REQUEST =
  "We are a couple on our first ever trip to Paris for a relaxed four day break. Please keep every day gentle, with no starts before eight thirty and one slow morning with nothing booked at all. We need a building with an elevator and quiet streets at night. I am vegetarian, so please favor restaurants with clear vegetarian menus. Keep the total budget under two thousand eight hundred dollars, avoid long walks between stops, and also include one full museum day at the Louvre and a day trip to Versailles if it fits the plan please.";

function cand(key, name, kind, lat, lon) {
  return { key, name, kind, pos: { lat, lon }, hoursRaw: null, tags: {}, url: "", google: null };
}
function parisPack(withVersailles) {
  const sights = [
    cand("node/101", "Louvre Museum", "museum", 48.8611, 2.3364),
    cand("node/102", "Grand Palais immersif", "museum", 48.8661, 2.3125),
    // The production thief: its name contains the fallback token
    // "plan" — it must never again satisfy another place's ask.
    cand("node/103", "Histoire des Plantes", "museum", 48.8439, 2.3596),
    cand("node/104", "Eiffel Tower", "tower", 48.8584, 2.2945),
    cand("node/105", "Jardin du Luxembourg", "park", 48.8462, 2.3372),
    cand("node/106", "Sainte-Chapelle", "church", 48.8554, 2.345),
    cand("node/107", "Musée d'Orsay", "museum", 48.86, 2.3266),
    cand("node/108", "Panthéon", "museum", 48.8462, 2.346)
  ];
  const excursions = withVersailles ? [cand("way/900", "Palace of Versailles", "palace", 48.8049, 2.1204)] : [];
  return {
    destination: "Paris",
    country: "France",
    center: { lat: 48.8566, lon: 2.3522 },
    counts: { total: sights.length + excursions.length + 1, sights: sights.length, foods: 0, stays: 1, transport: 0 },
    stays: [cand("node/100", "Hôtel des Nations Saint-Germain", "stay", 48.849, 2.344)],
    sights,
    excursions,
    foods: [cand("node/120", "Station Krishna", "restaurant", 48.874, 2.343)],
    transport: [],
    weather: []
  };
}
function solveParis(pack, mustSees, earliestMin) {
  return solveTrip(pack, {
    days: 4,
    startIso: "2026-11-09",
    dates: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"],
    earliestMin,
    restSpec: { type: "morning", text: "one slow morning with nothing booked" },
    mustSees,
    basePos: { lat: 48.849, lon: 2.344 },
    baseName: "Hôtel des Nations Saint-Germain",
    calendar: null
  });
}

/* ---- F2: the earliest-start phrase is carried whole ------------ */
{
  const extracted = extractConstraints(PARIS_REQUEST);
  eq(extracted.earliestStart, "08:30", "F2 the Paris request extracts 08:30, not 08:00");
  eq(
    extractConstraints("Please keep days gentle, with no starts before nine fifteen and one slow morning.").earliestStart,
    "09:15",
    "F2 word hour + fifteen keeps its minutes"
  );
  eq(
    extractConstraints("Please keep days gentle, with no starts before eight forty-five and one slow morning.").earliestStart,
    "08:45",
    "F2 word hour + forty-five keeps its minutes"
  );
  eq(
    extractConstraints("Please keep days gentle, with no starts before seven thirty and one slow morning.").earliestStart,
    "07:30",
    "F2 seven thirty parses (hour word covered)"
  );
  eq(
    extractConstraints("Please keep days gentle, with no starts before ten and one slow morning.").earliestStart,
    "10:00",
    "F2 bare word hour unchanged"
  );
  eq(
    extractConstraints("Please keep days gentle, with no starts before 8:30 and one slow morning.").earliestStart,
    "08:30",
    "F2 digit time unchanged"
  );

  // The marker itself: earliestMin derived exactly as generate.ts
  // derives it, and the day-3 rest-morning marker respects it.
  const earliestMin = parseHhmm(extracted.earliestStart || "09:00") ?? 9 * 60;
  eq(earliestMin, 510, "F2 earliestMin is 510 (08:30)");
  const pack = parisPack(false);
  const mustSees = deriveMustSees({ specialNotes: PARIS_REQUEST }, extracted, pack);
  const result = solveParis(pack, mustSees, earliestMin);
  const restMorning = result.days.flatMap((d, i) =>
    d.items.filter((it) => it.type === "rest" && it.part === "morning").map((it) => ({ day: i + 1, start: it.start, title: it.title }))
  );
  eq(restMorning.length, 1, "F2 exactly one slow-morning rest marker");
  eq(restMorning[0].day, 3, "F2 the rest marker is on day 3 (as in production)");
  ok(restMorning[0].start >= 510, `F2 the rest marker starts at/after the traveller's 08:30 (got ${restMorning[0].start})`);
  eq(restMorning[0].start, 510, "F2 the rest marker is stamped at the earliest start itself");
}

/* ---- F3: a named conditional ask is built or honestly named ---- */
{
  const req = mustSeeRequirement("a day trip to Versailles if it fits the plan");
  eq(req.patterns.join(","), "versailles", "F3 the Versailles ask anchors on the place's own name");
  eq(req.kinds.length, 0, "F3 the anchor is a name test, never a kind test");

  const extracted = extractConstraints(PARIS_REQUEST);
  ok(
    (extracted.placeItems || []).some((p) => /Versailles/.test(p)),
    "F3 extraction carries the Versailles ask (it was never an extraction loss)"
  );

  // No Versailles in the data: honestly UNMET — never "scheduled"
  // against the plant museum whose name contains "plan".
  {
    const pack = parisPack(false);
    const mustSees = deriveMustSees({ specialNotes: PARIS_REQUEST }, extracted, pack);
    const versailles = mustSees.find((m) => /Versailles/.test(m.label));
    ok(versailles, "F3 the Versailles ask derives into a must-see");
    eq((versailles.requiredPatterns || []).join(","), "versailles", "F3 the derived must-see carries the name anchor");
    const result = solveParis(pack, mustSees, 510);
    const r = result.mustSeeResults.find((x) => x.id === versailles.id);
    eq(r.status, "unmet", "F3 with no Versailles in the data the ask is UNMET, not silently substituted");
    ok(/related places/.test(r.reason || ""), "F3 the unmet reason says honestly that only related places match");
    ok(
      !result.mustSeeResults.some((x) => x.item === "Histoire des Plantes" && x.id === versailles.id),
      "F3 the plant museum no longer satisfies the Versailles ask"
    );
    const miss = namedMustSeeMiss(versailles.label, "Paris");
    ok(/Versailles/.test(miss) && /no verified match/.test(miss), "F3 the named-miss sentence names Versailles for the day words");
    const louvre = result.mustSeeResults.find((x) => /Louvre/.test(x.label));
    eq(louvre.status, "scheduled", "F3 the Louvre museum day still schedules");
    eq(louvre.item, "Louvre Museum", "F3 the Louvre match is the Louvre itself");
  }

  // Versailles in the data: the ask is BUILT, as itself.
  {
    const pack = parisPack(true);
    const mustSees = deriveMustSees({ specialNotes: PARIS_REQUEST }, extracted, pack);
    const versailles = mustSees.find((m) => /Versailles/.test(m.label));
    const result = solveParis(pack, mustSees, 510);
    const r = result.mustSeeResults.find((x) => x.id === versailles.id);
    eq(r.status, "scheduled", "F3 with Versailles in the data the ask schedules");
    eq(r.item, "Palace of Versailles", "F3 the scheduled item is Versailles itself");
  }

  // Generality: a different invented named conditional ask obeys
  // the same law — the clause words are never the satisfying match.
  {
    const label = "a day trip to Halloway Island if it fits the plan";
    const req2 = mustSeeRequirement(label);
    eq(req2.patterns.join(","), "halloway,island", "F3 generality: an invented named ask anchors on its own name");
    const pack = parisPack(false);
    pack.destination = "Port Halloway";
    const result = solveParis(pack, [{ id: "ms-x", label, patterns: [label, "halloway island", "halloway", "island", "fits", "plan"], requiredPatterns: req2.patterns, requiredKinds: req2.kinds }], 510);
    eq(result.mustSeeResults[0].status, "unmet", "F3 generality: 'plan' in a candidate name cannot satisfy an unrelated named ask");
  }
}

/* ---- F1: static wiring pin (behavioural proof = travel-day) ---- */
{
  const source = readFileSync(new URL("../lib/roamly/tripCompanion.ts", import.meta.url), "utf8");
  ok(!/nowMs \+ 60_000/.test(source), "F1 the +60s catch-up cushion is gone from scheduleCompanionEvents");
  ok(/fireAt = new Date\(nowMs\)\.toISOString\(\)/.test(source), "F1 catch-up events are due at the creation instant");
}

console.log(`EUROPE-FINDINGS CHECKS: ${count}/${count} PASS`);
