// roamly-trip-destination-label-checks.mjs — Roamly trip header country
//
// 2026-11-19: the rendered trip header showed "Vancouver, United States"
// for a trip stored as Vancouver, Canada (trip
// f7a05f1c-2119-426d-8d19-551a785981d8, Dell end-to-end proof). Root cause:
// getTripDestinationLabel re-resolved the bare city name through
// resolveCityPlace, which never saw the trip's stored country, and the
// resolver's +10 admin-seat bonus (PPLA*) outweighs population —
// Vancouver WA (pop 196k) outranked Vancouver BC (pop 662k).
//
// Rule pinned here: the stored country is authoritative. The label must
// never contradict it; when the city is not in the dataset for that
// country, the label falls back to "City, <stored country>".
//
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-trip-destination-label-checks.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

let passed = 0;
function eq(name, actual, expected) {
  assert.equal(actual, expected, `${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
  passed += 1;
  console.log(`ok - ${name}`);
}

// The defect, exactly as stored: destination_name "Vancouver",
// destination_country "Canada", planning destination "Vancouver" with
// planning.destinationCountry "Canada".
const storedVancouver = {
  destination: "",
  destination_name: "Vancouver",
  destination_country: "Canada",
  metadata: {
    planning: {
      destination: "Vancouver",
      destinationCountry: "Canada",
      destination_country: ""
    }
  }
};
eq("Vancouver trip stored as Canada shows Vancouver, Canada", getTripDestinationLabel(storedVancouver), "Vancouver, Canada");

// Stored country from planning metadata alone (callers that pass only
// { destination_name, metadata } — no trip column).
eq(
  "planning-only country still decides",
  getTripDestinationLabel({
    destination_name: "Vancouver",
    metadata: { planning: { destination: "Vancouver", destinationCountry: "Canada" } }
  }),
  "Vancouver, Canada"
);

// Stored country as a code, not a name.
eq(
  "country code CA decides",
  getTripDestinationLabel({ destination_name: "Vancouver", destination_country: "CA" }),
  "Vancouver, Canada"
);

// The stored country wins the other way too — a US Vancouver stays US.
eq(
  "Vancouver trip stored as United States stays United States",
  getTripDestinationLabel({ destination_name: "Vancouver", destination_country: "United States" }),
  "Vancouver, United States"
);

// No stored country anywhere: today's heuristic is preserved, not fixed
// here (nothing authoritative to prefer). Pinned so a later change to the
// resolver is a deliberate decision, not a silent drift.
eq(
  "no stored country keeps the resolver's answer",
  getTripDestinationLabel({ destination_name: "Vancouver" }),
  "Vancouver, United States"
);

// Unambiguous city is unaffected.
eq(
  "Barcelona, Spain is unchanged",
  getTripDestinationLabel({ destination_name: "Barcelona", destination_country: "Spain" }),
  "Barcelona, Spain"
);

// Another same-name pair: London, Ontario over London, England.
eq(
  "London trip stored as Canada shows London, Canada",
  getTripDestinationLabel({ destination_name: "London", destination_country: "Canada" }),
  "London, Canada"
);

// City not in the dataset for that country: the label keeps the stored
// country instead of a wrong-country resolution or a bare city.
eq(
  "unknown city keeps the stored country",
  getTripDestinationLabel({ destination_name: "Atlantis", destination_country: "Canada" }),
  "Atlantis, Canada"
);

// Empty city with a stored country: the country alone, never ", Canada".
eq(
  "empty destination with a stored country shows the country",
  getTripDestinationLabel({ destination_name: "", destination_country: "Canada" }),
  "Canada"
);

// City string already carrying the country: no duplication.
eq(
  "Vancouver, Canada in stays Vancouver, Canada",
  getTripDestinationLabel({ destination_name: "Vancouver, Canada", destination_country: "Canada" }),
  "Vancouver, Canada"
);

// City string carrying a stale/conflicting country: the stored country wins.
eq(
  "stored Canada beats a stale United States in the city string",
  getTripDestinationLabel({ destination_name: "Vancouver, United States", destination_country: "Canada" }),
  "Vancouver, Canada"
);

// Static pin: the label function must read the stored country chain
// (trip column first, then planning metadata) — the regression is the
// missing read, so the read itself is pinned.
const source = read("lib/roamly/tripMetadata.ts");
assert.match(source, /destination_country/, "label reads the stored trip country column");
assert.match(source, /planning\.destinationCountry/, "label reads the planning country");
assert.match(source, /normalizeCountryCode/, "label verifies the resolved country against the stored one");

console.log(`Roamly trip destination label checks passed (${passed} checks).`);
