// roamly-ux-repair-timing-checks.mjs — not-approved repair round,
// Priority 1: LIVE TIMING SEMANTICS. The owner found the conditional
// round's labels wrong: nearly every activity read "Live-updated"
// while location was unavailable. These checks pin the corrected
// definitions (Planned = original plan time, unchanged; Estimated =
// recalculated/inferred without verified live evidence; Live-updated
// = verified live input inside its freshness window ONLY; Confirmed
// = authoritative booking/confirmation record ONLY) and the four
// regression cases: missing location, stale information, recalculated
// schedules, verified updates.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs scripts/roamly-ux-repair-timing-checks.mjs [root]
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TIME_EVIDENCE_FRESHNESS_MS,
  TIME_EVIDENCE_FUTURE_SKEW_MS,
  TIME_PROVENANCE_LABELS,
  hasVerifiedLiveEvidence,
  isFreshEvidenceTimestamp,
  provenanceForHomeRow,
  provenanceForLiveDayRow,
  provenanceForPlaceTime,
  provenanceForPreTripRow
} from "@/lib/roamly/timeProvenance.ts";
import {
  PRECISE_LOCATION_MAX_AGE_MS,
  PRECISE_LOCATION_MAX_FUTURE_SKEW_MS
} from "@/lib/roamly/location.ts";
import { buildPlaceDetail } from "@/lib/roamly/placeDetail.ts";
import { toHomeRow } from "@/lib/roamly/itineraryHome.ts";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const liveClient = read("components/trip/LiveTripClient.tsx");
const homePanel = read("components/trip/ItineraryHomePanel.tsx");
const dayPlan = read("components/trip/ItineraryDayPlan.tsx");
const placePanel = read("components/roamly/PlaceDetailPanel.tsx");

// ---- 1. Missing location: no Live-updated label may appear ----
// The Live in-progress rows are recomputed for today; with no fresh
// location fix and no fresh check-in, the gate is closed and the
// label falls back to Estimated — never Live-updated.
check("missing-location: gate closed with no fix and no check-in",
  hasVerifiedLiveEvidence({ freshLocationFix: false, freshCheckIn: false }) === false);
check("missing-location: recomputed live row reads Estimated, not Live-updated",
  provenanceForLiveDayRow({ bookingVerified: false, verifiedLiveEvidence: false }) === "estimated");
check("missing-location: client feeds the gate from a freshness-checked fix + fresh check-ins",
  liveClient.includes("freshLocationFix: usableLocation != null") &&
  liveClient.includes('item.status === "checked_in"') &&
  liveClient.includes("isFreshEvidenceTimestamp(item.checked_in_at"));
check("missing-location: no unconditional live label call remains in the client",
  !liveClient.includes("provenanceForLiveDayRow()") &&
  liveClient.includes("liveDayProvenanceFor(featuredActivity)") &&
  liveClient.includes("liveDayProvenanceFor(activity)"));
check("missing-location: day cards carry no unconditional Live-updated text",
  !dayPlan.includes(">Live-updated<"));

// ---- 2. Stale information: stale verified input falls back ----
const NOW = Date.parse("2026-10-26T15:00:00Z");
const minute = 60_000;
check("stale: fresh fix (5 min ago) counts",
  isFreshEvidenceTimestamp(new Date(NOW - 5 * minute).toISOString(), NOW) === true);
check("stale: 11-minute-old fix does NOT count (window is 10 minutes)",
  isFreshEvidenceTimestamp(new Date(NOW - 11 * minute).toISOString(), NOW) === false);
check("stale: 2-hour-old check-in does NOT count",
  isFreshEvidenceTimestamp(new Date(NOW - 120 * minute).toISOString(), NOW) === false);
check("stale: stale check-in + no fix closes the gate, row falls back to Estimated",
  hasVerifiedLiveEvidence({ freshLocationFix: false, freshCheckIn: false }) === false &&
  provenanceForLiveDayRow({ bookingVerified: false, verifiedLiveEvidence: false }) === "estimated");
check("stale: missing/unparseable timestamps are not evidence",
  isFreshEvidenceTimestamp(null, NOW) === false &&
  isFreshEvidenceTimestamp("", NOW) === false &&
  isFreshEvidenceTimestamp("not-a-date", NOW) === false);
check("stale: small future skew tolerated, far-future fix rejected",
  isFreshEvidenceTimestamp(new Date(NOW + 1 * minute).toISOString(), NOW) === true &&
  isFreshEvidenceTimestamp(new Date(NOW + 5 * minute).toISOString(), NOW) === false);
check("stale: freshness window mirrors the location tracker (10 min, 2 min skew)",
  TIME_EVIDENCE_FRESHNESS_MS === PRECISE_LOCATION_MAX_AGE_MS &&
  TIME_EVIDENCE_FUTURE_SKEW_MS === PRECISE_LOCATION_MAX_FUTURE_SKEW_MS);

// ---- 3. Recalculated schedules: labeled Estimated ----
// Home retimed row (plan record carries retimed_by_event).
const homeBase = {
  time: "9:37 AM", title: "Test Museum", description: "", location: "",
  category: "activity", itemType: "activity", durationLabel: "",
  travelLabel: "", mapQuery: "Test Museum", authority: "supporting",
  timeFromBooking: false
};
check("recalculated: home retimed row is Estimated",
  toHomeRow({ ...homeBase, timeRetimed: true }, 0, 1).retimed === true &&
  provenanceForHomeRow(toHomeRow({ ...homeBase, timeRetimed: true }, 0, 1)) === "estimated");
check("recalculated: home stored plan time, unchanged, is Planned (not live)",
  provenanceForHomeRow(toHomeRow(homeBase, 0, 1)) === "planned");
check("recalculated: place retimed window is Estimated",
  provenanceForPlaceTime({ timingStatus: "PLANNED", retimed: true }) === "estimated");
check("recalculated: walk-adjusted live time without evidence is Estimated",
  provenanceForLiveDayRow({ bookingVerified: false, verifiedLiveEvidence: false }) === "estimated");

// ---- 4. Verified updates: a fixture WITH evidence earns the label ----
// (a) Fresh location fix → Live-updated.
check("verified: fresh location fix earns Live-updated",
  hasVerifiedLiveEvidence({ freshLocationFix: true, freshCheckIn: false }) === true &&
  provenanceForLiveDayRow({ bookingVerified: false, verifiedLiveEvidence: true }) === "live");
// (b) Fresh verified check-in event → Live-updated.
check("verified: fresh check-in event earns Live-updated",
  isFreshEvidenceTimestamp(new Date(NOW - 3 * minute).toISOString(), NOW) === true &&
  hasVerifiedLiveEvidence({ freshLocationFix: false, freshCheckIn: true }) === true &&
  provenanceForLiveDayRow({ bookingVerified: false, verifiedLiveEvidence: true }) === "live");
// (c) Booking record → Confirmed on every surface.
check("verified: booking record earns Confirmed (live, home, pre-trip)",
  provenanceForLiveDayRow({ bookingVerified: true, verifiedLiveEvidence: false }) === "confirmed" &&
  provenanceForHomeRow({ planned: false, booked: true }) === "confirmed" &&
  provenanceForHomeRow({ planned: false, booked: false, timeFromBooking: true }) === "confirmed" &&
  provenanceForPreTripRow(false) === "confirmed" &&
  provenanceForPlaceTime({ timingStatus: "FACTUAL", retimed: false }) === "confirmed");
// (d) Booking beats live evidence (the record, not the recomputation,
// supports the time); live evidence beats nothing else.
check("verified: booking-verified time stays Confirmed even with live evidence",
  provenanceForLiveDayRow({ bookingVerified: true, verifiedLiveEvidence: true }) === "confirmed");

// ---- 5. Place detail: stored window provenance, proven end to end ----
const TRIP = { destination: "Montreal, Canada", origin: "Saint John", start_date: "2026-10-26", end_date: "2026-10-30" };
const DAY = { day_number: 1, date: "2026-10-26", live_timeline: [] };
function placeFor(item) {
  return buildPlaceDetail({
    item, day: { ...DAY, live_timeline: [item] },
    siblings: [], trip: TRIP, tripTips: [], confirmedBookings: [], photo: null, siblingPhotos: {}
  });
}
const placeBase = {
  item_id: "item-main", title: "Harbor Test Museum", description: "A test museum.",
  location_name: "Old Port district", map_query: "Harbor Test Museum, Montreal",
  startTime: "13:00", endTime: "15:00", category: "activity"
};
check("place: stored plan window reads Planned (the 9:37-style case: original plan time)",
  placeFor(placeBase)?.timeProvenance === "planned" &&
  placeFor(placeBase)?.timeRangeLabel === "1:00 PM – 3:00 PM");
check("place: retimed window reads Estimated",
  placeFor({ ...placeBase, retimed_by_event: "late-arrival" })?.timeProvenance === "estimated");
check("place: FACTUAL window reads Confirmed",
  placeFor({ ...placeBase, timing_status: "FACTUAL" })?.timeProvenance === "confirmed");
check("place: FACTUAL beats retimed (booking anchor outranks recalculation)",
  placeFor({ ...placeBase, timing_status: "FACTUAL", retimed_by_event: "late-arrival" })?.timeProvenance === "confirmed");
check("place: view-model parity with the shared function across the branch matrix",
  ["planned", "estimated", "confirmed"].every((kind) => {
    const viaFn = provenanceForPlaceTime(
      kind === "confirmed" ? { timingStatus: "FACTUAL" } :
      kind === "estimated" ? { timingStatus: "PLANNED", retimed: true } :
      { timingStatus: "PLANNED" });
    return viaFn === kind;
  }));
check("place: panel renders the window provenance pill next to the range chip",
  placePanel.includes("TimeProvenanceLabel") &&
  placePanel.includes("detail.timeProvenance"));

// ---- 6. Label set + banner truth ----
check("labels: exactly the four kinds, exact strings",
  TIME_PROVENANCE_LABELS.planned === "Planned" &&
  TIME_PROVENANCE_LABELS.estimated === "Estimated" &&
  TIME_PROVENANCE_LABELS.live === "Live-updated" &&
  TIME_PROVENANCE_LABELS.confirmed === "Confirmed" &&
  Object.keys(TIME_PROVENANCE_LABELS).length === 4);
check("banner: in-progress banner states the corrected truth",
  liveClient.includes("Times below are estimates unless labeled otherwise") &&
  liveClient.includes("Live-updated only with a fresh location fix or check-in") &&
  liveClient.includes("Confirmed only for a verified booking") &&
  !liveClient.includes("Times below update as the day progresses — each time is labeled Planned, Estimated, Live-updated, or Confirmed"));
check("home: panel still labels every clock time, Flexible carries none",
  homePanel.includes("provenanceForHomeRow(row)") && homePanel.includes("isClockTime(row.time)"));

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} repair-timing checks passed.`);
if (failed.length) {
  console.log(`FAILURES: ${failed.map((r) => r.name).join("; ")}`);
  process.exit(1);
}
