import assert from "node:assert/strict";
import fs from "node:fs";
import { customerTripLifecycleState } from "../lib/roamly/liveCompanion.ts";

const base = {
  id: "trip-1",
  status: "planned",
  itinerary_status: "generated",
  start_date: "2026-10-10",
  end_date: "2026-10-14",
  tracking_unlocked: true,
  metadata: { planning: { timezone: "America/Toronto" } }
};

assert.equal(customerTripLifecycleState({
  status: base.status,
  itineraryStatus: base.itinerary_status,
  startDate: base.start_date,
  endDate: base.end_date,
  metadata: base.metadata
}, "2026-09-26T12:00:00Z"), "upcoming");
assert.equal(customerTripLifecycleState({
  status: base.status,
  itineraryStatus: base.itinerary_status,
  startDate: base.start_date,
  endDate: base.end_date,
  metadata: base.metadata
}, "2026-10-11T12:00:00Z"), "active");

const completed = {
  ...base,
  status: "completed",
  start_date: "2026-08-05",
  end_date: "2026-08-08"
};
assert.equal(customerTripLifecycleState(completed, "2026-09-26T12:00:00Z"), "completed");

const archived = { ...completed, status: "archived" };
assert.equal(customerTripLifecycleState(archived, "2026-09-26T12:00:00Z"), "archived");

const dashboard = fs.readFileSync("app/dashboard/page.tsx", "utf8");
const presentation = fs.readFileSync("lib/roamly/dashboardTripPresentation.ts", "utf8");
assert.match(dashboard, /tripQueryError/);
assert.match(dashboard, /Trips unavailable/);
assert.match(dashboard, /dashboardTripPresentation/);
assert.match(presentation, /lifecycle === "completed"/);
assert.match(dashboard, /presentation\.href/);
assert.match(dashboard, /presentation\.action/);
assert.match(dashboard, /No trips yet/);
assert.match(dashboard, /\.neq\("status", "archived"\)/);
assert.doesNotMatch(dashboard, /app\/trip\/\[id\]\/bookings/);

console.log("A15-R1 dashboard history checks passed.");
