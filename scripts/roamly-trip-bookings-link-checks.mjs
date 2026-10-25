// Trip-page bookings link checks (structural, source-level).
// Proves the trip header now links to the bookings route, where the
// Add booking form lives. It does not prove a live render.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(path.join(root, p), "utf8");

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`ok - ${name}`);
}

const actions = read("components/trip/TripShareActions.tsx");
check("header links to the bookings route for this trip", actions.includes("href={`/trip/${tripId}/bookings`}"));
check("link uses the existing control style, no new design", actions.includes("className={buttonClass}"));
check("link label is Bookings", actions.includes('"Bookings"'));

const timeline = read("components/companion/BookingWalletTimeline.tsx");
check("bookings route timeline still links to the add form", timeline.includes("`/trip/${tripId}/bookings/add`"));

console.log(`\n${passed} trip bookings link checks passed`);
