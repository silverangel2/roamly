/*
 * Audit batch PH02–PH05 + PH08 checks.
 *
 * PH02: every PH area sample (5 days, the /ph shape) has feasible days —
 *   no overlapping stops, no >40 km hop without a >=120 min transfer
 *   window, no day ending after 10:00 PM. The same no-overlap property
 *   holds at 3 and 7 days. The pack's own labels are never mutated by
 *   building (the builder re-times copies only).
 * PH03: all six advertised Bohol sights survive Bohol's coverage
 *   (seed bbox + subregion boxes); Bohol's seed bbox itself is unchanged;
 *   the Overpass chunk list for Bohol covers every coverage box.
 * PH04: one pricing rule — pesos ONLY for Philippines-only trips, in
 *   every shape (PH-first, PH-last, all-PH, non-PH, single, edited
 *   single, legacy city/label fallbacks), whether stops live at the
 *   metadata root or under planning.
 * PH05: a shared tour package is counted once per day it appears
 *   (Tour A day = ₱1,200 not ₱3,600; Coron lakes day = ₱1,500 not
 *   ₱4,500); later same-day stops on the package ride included.
 * PH08: the planner budget hint carries no CAD anchor number.
 */
import { readFileSync } from "node:fs";
import {
  PHILIPPINES_AREAS,
  buildPhilippinesSampleItinerary
} from "../lib/roamly/philippinesPack.ts";
import {
  PHILIPPINES_DESTINATION_SEEDS,
  destinationCoverageBoxes,
  insideDestinationCoverage,
  shadowBBox
} from "../lib/roamly/engine/packs/destinations.ts";
import { overpassChunksForDestination } from "../lib/roamly/engine/packs/collectors.ts";
import { isPhilippinesTrip } from "../lib/roamly/billing.ts";

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ok — ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${label}${detail ? `: ${detail}` : ""}`);
  }
}

function mins(label) {
  const m = String(label).match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  return ((parseInt(m[1], 10) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + parseInt(m[2], 10);
}
function km(a, b) {
  const R = 6371;
  const dLa = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLo = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function coordsOf(item) {
  const c = item.coordinates;
  return c && typeof c.latitude === "number" && typeof c.longitude === "number" ? c : null;
}

// ---- PH02: feasibility of every area sample at 5 days (+ no-overlap at 3/7) ----
for (const area of PHILIPPINES_AREAS) {
  for (const daysCount of [5, 3, 7]) {
    const sample = buildPhilippinesSampleItinerary(area.key, daysCount);
    check(`${area.displayName} ${daysCount}-day sample has ${daysCount} days`, sample.daily_itinerary.length === daysCount);
    for (const day of sample.daily_itinerary) {
      const items = day.live_timeline;
      let prev = null;
      for (const item of items) {
        const start = mins(item.time_label);
        const duration = item.durationMinutes ?? 60;
        const end = start + duration;
        if (prev) {
          check(
            `${area.displayName} day ${day.day_number} / ${item.title}: no overlap with ${prev.title}`,
            start >= prev.end,
            `${item.time_label} starts before ${prev.title} ends`
          );
          const a = coordsOf(prev.item);
          const b = coordsOf(item);
          if (a && b) {
            const d = km(a, b);
            if (d > 40) {
              check(
                `${area.displayName} day ${day.day_number} / ${item.title}: ${d.toFixed(0)} km hop has >=120 min window`,
                start - prev.end >= 120,
                `gap ${start - prev.end} min`
              );
            }
          }
        }
        if (daysCount === 5) {
          check(
            `${area.displayName} day ${day.day_number} / ${item.title}: day ends by 10:00 PM`,
            end <= 22 * 60,
            `ends ${end}`
          );
        }
        prev = { end, title: item.title, item };
      }
    }
  }
}

// The pack's own labels survive building (builder re-times copies only).
const packFort = PHILIPPINES_AREAS.find((a) => a.key === "manila")?.activities.find(
  (a) => a.title === "Fort Santiago"
);
check("pack labels unmutated by building (Fort Santiago still 9:30 AM)", packFort?.time_label === "9:30 AM");

// The rendered /ph sample still covers Bohol, not just Cebu.
const cebuSample = buildPhilippinesSampleItinerary("cebu-bohol", 5);
const BOHOL_TITLES = new Set([
  "Chocolate Hills",
  "Philippine Tarsier Sanctuary, Corella",
  "Bilar Man-Made Forest",
  "Loboc River cruise",
  "Hinagdanan Cave",
  "Alona Beach, Panglao"
]);
const boholStops = cebuSample.daily_itinerary.flatMap((d) => d.live_timeline).filter((i) => BOHOL_TITLES.has(i.title));
check("cebu-bohol 5-day sample still includes Bohol stops", boholStops.length >= 1, `${boholStops.length}`);

// ---- PH03: Bohol subregion coverage ----
const bohol = PHILIPPINES_DESTINATION_SEEDS.find((s) => s.displayName === "Bohol");
check("Bohol seed exists", Boolean(bohol));
if (bohol) {
  const expectedBox = shadowBBox(bohol.centre, "island");
  check(
    "Bohol seed bbox unchanged (small shadow-rule box, not enlarged)",
    JSON.stringify(bohol.bbox) === JSON.stringify(expectedBox),
    JSON.stringify(bohol.bbox)
  );
  const boxes = destinationCoverageBoxes(bohol);
  check("Bohol coverage is seed box + 2 subregion boxes", boxes.length === 3, `${boxes.length}`);
  const SIGHTS = [
    ["Chocolate Hills", 9.79864, 124.16746],
    ["Tarsier Sanctuary", 9.69078, 123.95269],
    ["Bilar Man-Made Forest", 9.66721, 124.08452],
    ["Loboc River cruise", 9.71602, 124.04967],
    ["Hinagdanan Cave", 9.62548, 123.80094],
    ["Alona Beach", 9.54855, 123.77403]
  ];
  for (const [name, lat, lon] of SIGHTS) {
    check(`Bohol coverage keeps ${name}`, insideDestinationCoverage(bohol, lat, lon), `${lat},${lon}`);
  }
  check("Bohol coverage rejects a far point (Manila)", !insideDestinationCoverage(bohol, 14.5995, 120.9842));
  const chunks = overpassChunksForDestination(bohol);
  check("Bohol Overpass chunks cover all 3 boxes (5 chunks x 3 + wide)", chunks.length === 16, `${chunks.length}`);
  check(
    "Bohol coverage-box chunks carry suffixed ids",
    chunks.some((c) => c.id === "tourism@box2") && chunks.some((c) => c.id === "tourism@box3")
  );
  check("Bohol chunk list keeps the wide chunk", chunks.some((c) => c.id === "wide"));
  // Other PH areas' exclusion pattern: reported, not fixed here (Bohol
  // was the named item; the coverageBoxes pattern now exists for them).
  const AREA_SEEDS = {
    manila: ["Manila"],
    boracay: ["Boracay"],
    palawan: ["El Nido", "Coron", "Puerto Princesa"],
    "cebu-bohol": ["Cebu City", "Bohol"],
    siargao: ["Siargao"],
    baguio: ["Baguio"],
    "davao-samal": ["Davao City", "Samal Island"]
  };
  for (const area of PHILIPPINES_AREAS) {
    const seeds = PHILIPPINES_DESTINATION_SEEDS.filter((s) => AREA_SEEDS[area.key].includes(s.displayName));
    const outside = area.activities.filter((a) => {
      const c = coordsOf(a);
      return c && !seeds.some((s) => insideDestinationCoverage(s, c.latitude, c.longitude));
    });
    console.log(`  info — ${area.key}: ${outside.length} pack activities outside seed coverage (known follow-up, not this batch)`);
    for (const a of outside) console.log(`         outside: ${a.title}`);
  }
}

// ---- PH04: one pricing rule, every trip shape ----
const PH = { country: "Philippines" };
const CA = { country: "Canada" };
const JP = { country: "Japan" };
const trip = (metadata) => ({ metadata });
check("PH04 PH-first multi (PH + CA) prices CAD", isPhilippinesTrip(trip({ planning: { destinationStops: [PH, CA] } })) === false);
check("PH04 PH-last multi (CA + PH) prices CAD", isPhilippinesTrip(trip({ planning: { destinationStops: [CA, PH] } })) === false);
check("PH04 all-PH multi prices PHP", isPhilippinesTrip(trip({ planning: { destinationStops: [PH, PH] } })) === true);
check("PH04 non-PH multi prices CAD", isPhilippinesTrip(trip({ planning: { destinationStops: [CA, JP] } })) === false);
check("PH04 root-level stops read the same way", isPhilippinesTrip(trip({ destinationStops: [PH, CA] })) === false);
check("PH04 single PH (stamped) prices PHP", isPhilippinesTrip(trip({ planning: { destinationCountry: "Philippines" } })) === true);
check("PH04 single non-PH (stamped) prices CAD", isPhilippinesTrip(trip({ planning: { destinationCountry: "Canada" } })) === false);
check("PH04 edited single PH->CA prices CAD", isPhilippinesTrip(trip({ planning: { destinationCountry: "Canada", destinationCity: "Tokyo" } })) === false);
check("PH04 edited single CA->PH prices PHP", isPhilippinesTrip(trip({ planning: { destinationCountry: "Philippines", destinationCity: "Manila" } })) === true);
check("PH04 legacy city fallback still works (Manila, no country)", isPhilippinesTrip(trip({ planning: { destinationCity: "Manila" } })) === true);
check("PH04 legacy label fallback still works", isPhilippinesTrip(trip({ planning: { destination: "Trip to Philippines" } })) === true);
check("PH04 unknown-country stop is not proof of PHP", isPhilippinesTrip(trip({ planning: { destinationStops: [{ city: "Manila" }, PH] } })) === false);
check("PH04 empty trip is not PHP", isPhilippinesTrip(trip({})) === false);
check("PH04 null trip is not PHP", isPhilippinesTrip(null) === false);

// ---- PH05: package counted once per day ----
// Day totals are summed from live_timeline, exactly as /ph's sampleTotal
// does — normalizeItinerary leaves day.estimated_cost null without a day
// cost_status, which is pre-existing behavior for sample days.
const dayTotal = (day) => day.live_timeline.reduce((sum, i) => sum + (i.estimated_cost ?? 0), 0);
const palawan = buildPhilippinesSampleItinerary("palawan", 5);
const tourADay = palawan.daily_itinerary.find((d) => d.live_timeline.some((i) => i.title === "Big Lagoon"));
check("PH05 Tour A day total is ₱1,200, not ₱3,600", dayTotal(tourADay) === 1200, `${dayTotal(tourADay)}`);
check(
  "PH05 later Tour A stops ride included",
  tourADay?.live_timeline.filter((i) => i.packageId === "el-nido-tour-a" && i.packageIncluded).length === 2,
  JSON.stringify(tourADay?.live_timeline.map((i) => `${i.title}:${i.estimated_cost}:${i.packageIncluded ?? false}`))
);
const coronDay = palawan.daily_itinerary.find((d) => d.live_timeline.some((i) => i.title === "Kayangan Lake"));
check("PH05 Coron lakes day total is ₱1,500, not ₱4,500", dayTotal(coronDay) === 1500, `${dayTotal(coronDay)}`);
check(
  "PH05 later Coron stops ride included",
  coronDay?.live_timeline.filter((i) => i.packageId === "coron-island-tour" && i.packageIncluded).length === 2
);
const siargao = buildPhilippinesSampleItinerary("siargao", 5);
const triDay = siargao.daily_itinerary.find((d) => d.live_timeline.some((i) => i.title === "Naked Island"));
check("PH05 tri-island day keeps its single ₱1,700 boat price", triDay?.live_timeline.find((i) => i.title === "Naked Island")?.estimated_cost === 1700);

// ---- PH08: no CAD budget anchor ----
const form = readFileSync(new URL("../components/plan/TripPlanForm.tsx", import.meta.url), "utf8");
check("PH08 planner carries no 1,500–4,000 CAD budget anchor", !form.includes("1,500–4,000 CAD"));
check(
  "PH08 budget hint is currency-neutral",
  form.includes("A rough total is enough. Roamly will not fill this in for you.")
);
const phPage = readFileSync(new URL("../app/ph/page.tsx", import.meta.url), "utf8");
check("PH08/sample: included stops render as Included, not Free", phPage.includes("Included in ${item.packageName"));

if (failures) {
  console.error(`\nPH02–PH05 + PH08 checks FAILED (${failures}).`);
  process.exit(1);
}
console.log("\nPH02–PH05 + PH08 checks passed.");
