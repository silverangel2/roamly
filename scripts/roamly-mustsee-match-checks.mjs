// Roamly must-see match checks (2026-10-24, Montreal daily-test re-run):
// the solver matched the traveler's two named must-sees to the WRONG
// places and reported both "scheduled" while neither appeared in the
// plan — Théâtre Jean-Duceppe ("jean") stole the Jean Talon market,
// Le Centre d'art ("centre") stole the science centre — because the
// match took the FIRST pool candidate matching ANY pattern and the
// pool runs in candidate_key order (nodes before ways). These checks
// pin the fix:
//   1. Best-match beats first-match: the candidate matching the
//      longest pattern wins, even when a shorter match sorts first.
//   2. The French-name fallback (bare "science"/"centre" tokens) still
//      lands on the science centre, not on another "centre".
//   3. A matched must-see beyond walking range is driven to, not
//      dropped as "no feasible slot remained (distance/geometry)".
//   4. Ties keep pool order (today's behaviour on a true tie).
//   5. The kind fallback still fires only when no pattern matches.
//   6. The Halifax ferry lesson holds: a bare context token that the
//      ladder excluded never steals a match.
//   7. A pattern normalizing to empty matches nothing.
import assert from "node:assert/strict";
import { solveTrip } from "@/lib/roamly/engine/solver.ts";

let count = 0;
function eq(actual, expected, label) {
  count += 1;
  assert.equal(actual, expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

function cand(key, name, kind, lat, lon) {
  return { key, name, kind, pos: { lat, lon }, hoursRaw: null, tags: {}, url: "", google: null };
}
function montrealPack(sights) {
  return {
    destination: "Montreal",
    country: "Canada",
    center: { lat: 45.5017, lon: -73.5673 },
    counts: { total: sights.length + 1, sights: sights.length, foods: 0, stays: 1, transport: 0 },
    stays: [cand("node/1", "Hôtel Place d'Armes", "stay", 45.508, -73.554)],
    sights,
    excursions: [],
    foods: [],
    transport: [],
    weather: []
  };
}
function solve(pack, mustSees) {
  return solveTrip(pack, {
    days: 5,
    startIso: "2026-10-26",
    dates: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"],
    earliestMin: 540,
    restSpec: { type: "afternoon", text: "one full rest afternoon in the middle" },
    mustSees,
    basePos: { lat: 45.508, lon: -73.554 },
    baseName: "Hôtel Place d'Armes",
    calendar: null
  });
}
function resultFor(result, id) {
  return result.mustSeeResults.find((r) => r.id === id);
}

// §1+§2 — the Montreal steals, reproduced with the production keys:
// node candidates sort before way candidates in the serving pack.
{
  const pack = montrealPack([
    cand("node/10016921264", "Le Centre d'art et musée de Montréal", "gallery", 45.487, -73.5672),
    cand("node/12488301369", "Théâtre Jean-Duceppe", "venue", 45.5084, -73.5658),
    cand("way/22876797", "Marché Jean Talon", "market", 45.5359, -73.6151),
    cand("way/46866809", "Centre des sciences de Montréal", "museum", 45.5047, -73.5513)
  ]);
  const result = solve(pack, [
    { id: "ms-1", label: "a morning at the Jean Talon market", patterns: ["a morning at the Jean Talon market", "jean talon", "talon market", "jean", "talon", "market"] },
    { id: "ms-2", label: "an afternoon at the science centre", patterns: ["an afternoon at the science centre", "science centre", "science", "centre"] }
  ]);
  const ms1 = resultFor(result, "ms-1");
  const ms2 = resultFor(result, "ms-2");
  eq(ms1.status, "scheduled", "§1 the Jean Talon market must-see schedules");
  eq(ms1.item, "Marché Jean Talon", "§1 the market match is the market, not the Jean-Duceppe theatre");
  eq(ms1.itemKey, "way/22876797", "§1 the market match carries the market key");
  eq(ms2.status, "scheduled", "§2 the science centre must-see schedules");
  eq(ms2.item, "Centre des sciences de Montréal", "§2 the science match is the science centre, not another centre");
  eq(ms2.itemKey, "way/46866809", "§2 the science match carries the science centre key");
}

// §3 — the far must-see drives: Marché Jean Talon sits ~6 km from the
// anchor, past the old 1.6 km force-block skip. It must arrive on a
// drive leg, and the day's walking budget must not carry the drive.
{
  const pack = montrealPack([
    cand("way/22876797", "Marché Jean Talon", "market", 45.5359, -73.6151)
  ]);
  const result = solve(pack, [
    { id: "ms-1", label: "a morning at the Jean Talon market", patterns: ["a morning at the Jean Talon market", "jean talon", "talon market", "jean", "talon", "market"] }
  ]);
  const ms1 = resultFor(result, "ms-1");
  eq(ms1.status, "scheduled", "§3 a far matched must-see schedules instead of going unmet");
  eq(ms1.item, "Marché Jean Talon", "§3 the far scheduled item is the market");
  const day = result.days[ms1.day - 1];
  ok(
    (day.legs || []).some((leg) => leg.toName === "Marché Jean Talon" && leg.mode === "drive"),
    "§3 the far must-see arrives on a drive leg, not a walk"
  );
  ok(
    (day.items || []).some((item) => item.name === "Marché Jean Talon"),
    "§3 the far must-see is in the day's items"
  );
}

// §4 — a true tie keeps pool order.
{
  const pack = montrealPack([
    cand("node/10", "Jean Café", "venue", 45.508, -73.554),
    cand("node/20", "Jean Bistro", "venue", 45.508, -73.554)
  ]);
  const result = solve(pack, [
    { id: "ms-1", label: "jean", patterns: ["jean"] }
  ]);
  eq(resultFor(result, "ms-1").item, "Jean Café", "§4 on a true tie the first pool candidate still wins");
}

// §5 — kind fallback unchanged: no pattern match, kind word present.
{
  const fallbackPack = montrealPack([
    cand("node/31", "Old Mill Falls", "falls", 45.508, -73.554)
  ]);
  const fallback = solve(fallbackPack, [
    { id: "ms-1", label: "waterfall walk", patterns: ["waterfall walk", "waterfall"] }
  ]);
  eq(resultFor(fallback, "ms-1").status, "scheduled", "§5 the kind fallback still schedules when no pattern names a candidate");
  eq(resultFor(fallback, "ms-1").item, "Old Mill Falls", "§5 the kind fallback picks the kind candidate");
}

// §6 — the Halifax ferry lesson: the ladder's patterns for "one
// harbour ferry ride" carry the kind word but not the bare context
// token, so the ferry wins over a harbour-named excursion.
{
  const pack = montrealPack([
    cand("node/40", "Harbour Light Excursion", "lighthouse", 45.508, -73.554)
  ]);
  pack.excursions = [];
  pack.transport = [cand("node/41", "Harbour Ferry", "ferry", 45.508, -73.554)];
  const result = solve(pack, [
    { id: "ms-1", label: "one harbour ferry ride", patterns: ["one harbour ferry ride", "harbour ferry", "ferry ride", "ferry"] }
  ]);
  eq(resultFor(result, "ms-1").item, "Harbour Ferry", "§6 the ferry wins over the harbour-named excursion");
}

// §7 — an empty-normalizing pattern matches nothing.
{
  const pack = montrealPack([
    cand("node/50", "Anywhere Place", "museum", 45.508, -73.554)
  ]);
  const result = solve(pack, [
    { id: "ms-1", label: "!!!", patterns: ["!!!"] }
  ]);
  eq(resultFor(result, "ms-1").status, "unmet", "§7 an empty pattern leaves the must-see honestly unmet, never stealing the first candidate");
}

console.log(`MUSTSEE-MATCH CHECKS: ${count}/${count} PASS`);
