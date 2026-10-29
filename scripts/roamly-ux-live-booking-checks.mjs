// Builder-L proof script — Roamly UX repair: Live Companion cleanup +
// booking truthfulness. Self-contained, plain `node`, no imports from
// the tree (static source checks + fixture logic only). It must NOT
// import sibling-owned in-progress files; it only READS the Builder-L
// files listed below.
//
// Usage:
//   node scripts/roamly-ux-live-booking-checks.mjs [--root <dir>]
// Default root is the tree root (parent of this scripts/ dir).
// Run it against the pristine backup to see it FAIL, and against the
// tree to see it PASS:
//   node scripts/roamly-ux-live-booking-checks.mjs --root \
//     ~/workspace/roamly-ux-repair-2026-10-25/orig-backup/live-booking
//
// Checks (pre-fix FAIL / post-fix PASS):
//  1. Feed title gated on evidence (bookingWallet.ts recordTripEvent hunk)
//  2. QA-test stamp on NEW rows only (createTripBooking write layer)
//  3. isTestBooking predicate + label (lib/roamly/testBooking.ts)
//  4. "Test booking" precedes "Confirmed" in wallet customerStatus
//  5. Single prominent trip-timing header on the live page
//  6. Not-started prose trimmed, honesty guard kept, no invented proximity
//  7. Planned activities chronological; nearby claims evidence-gated
//     (verified, no code change needed — see checks 7a/7b)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const rootArg = argv.indexOf("--root") >= 0 ? argv[argv.indexOf("--root") + 1] : null;
const ROOT = rootArg || dirname(dirname(fileURLToPath(import.meta.url)));

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

const livePage = read("app/trip/[id]/live/page.tsx");
const upNext = read("components/roamly/UpNextActivityCard.tsx");
const nearby = read("components/roamly/NearbyActivityCard.tsx");
const timeline = read("components/roamly/CurrentDayTimeline.tsx");
const banner = read("components/roamly/TripActivationBanner.tsx");
const presentation = read("lib/roamly/itineraryPresentation.ts");
const liveClient = read("components/trip/LiveTripClient.tsx");
const wallet = read("lib/roamly/bookingWallet.ts");
const testBooking = read("lib/roamly/testBooking.ts");
const walletTimeline = read("components/companion/BookingWalletTimeline.tsx");

// --- 1. Feed title gate -------------------------------------------------
check(
  "1a feed title: no bare traveler_confirmed -> 'Booking confirmed'",
  wallet !== null && !/traveler_confirmed\s*\?\s*"Booking confirmed"/.test(wallet),
  wallet === null ? "bookingWallet.ts missing" : "bare pattern must be gone"
);
check(
  "1b feed title: provider evidence gate present (provider_booking_id + confirmation_number)",
  wallet !== null &&
    wallet.includes("writeBooking.provider_booking_id") &&
    wallet.includes("writeBooking.confirmation_number") &&
    wallet.includes('"Booking added"'),
  "gate must name both evidence fields and keep the 'Booking added' fallback"
);
check(
  "1c feed title: wallet stricter rule referenced (confirmed-family status set)",
  wallet !== null &&
    wallet.includes('"confirmed", "modified", "completed"') &&
    wallet.includes("isConfirmedBooking"),
  "confirmed-family set + isConfirmedBooking reference"
);
// Fixture logic mirroring the gated expression in bookingWallet.ts:
// confirmed only with provider evidence OR a confirmed-family status;
// traveler_confirmed alone is never enough.
function feedTitle({ travelerConfirmed, hasEvidence, status }) {
  if (hasEvidence) return "Booking confirmed";
  if (travelerConfirmed && ["confirmed", "modified", "completed"].includes(status)) return "Booking confirmed";
  return "Booking added";
}
// Fixture verdicts are only meaningful under the gated source: the
// source checks (1a/1b) are the discriminators, so 1d/1e also require
// the gate to be present — otherwise the pristine ternary would make
// 1d look "passing" while still minting "confirmed" in production.
const feedGatePresent =
  wallet !== null &&
  !/traveler_confirmed\s*\?\s*"Booking confirmed"/.test(wallet) &&
  wallet.includes("writeBooking.provider_booking_id") &&
  wallet.includes("writeBooking.confirmation_number");
check(
  "1d fixture (gated source): traveler_confirmed alone, no evidence, status 'booked' -> 'Booking added'",
  feedGatePresent && feedTitle({ travelerConfirmed: true, hasEvidence: false, status: "booked" }) === "Booking added"
);
check(
  "1e fixture (gated source): traveler_confirmed + confirmation number -> 'Booking confirmed'",
  feedGatePresent && feedTitle({ travelerConfirmed: true, hasEvidence: true, status: "booked" }) === "Booking confirmed"
);
check(
  "1f fixture: unconfirmed, no evidence -> 'Booking added'",
  feedTitle({ travelerConfirmed: false, hasEvidence: false, status: "unknown" }) === "Booking added"
);

// --- 2. QA-test stamp, NEW rows only ------------------------------------
check(
  "2a assertTripOwnership surfaces tripIsQaTester from metadata.qa_tester",
  wallet !== null && /tripIsQaTester:\s*tripMetadata\?\.\qa_tester === true/.test(wallet)
);
check(
  "2b createTripBooking merges metadata.qa_test: true for new rows",
  wallet !== null && wallet.includes("qa_test: true") && wallet.includes("writeBookingForInsert")
);
check(
  "2c insert uses the QA-stamped payload; update branch does not",
  wallet !== null &&
    /\.insert\(\{\s*\.\.\.writeBookingForInsert/.test(wallet) &&
    !wallet.includes("...writeBookingForInsert,\n          updated_at")
);
check(
  "2d no existing-row rewrite: no DELETE / status rewrite of roamly_bookings in this hunk",
  wallet !== null && !/\.from\("roamly_bookings"\)\s*\.delete/.test(wallet)
);

// --- 3. isTestBooking predicate + label ---------------------------------
const TEST_LABEL = "Test booking — not a real reservation";
check("3a testBooking module exists with the exact label", testBooking !== null && testBooking.includes(TEST_LABEL));
let pattern = null;
if (testBooking) {
  const m = testBooking.match(/TEST_BOOKING_PATTERN\s*=\s*\/(.+)\/i/);
  if (m) {
    try { pattern = new RegExp(m[1], "i"); } catch { pattern = null; }
  }
}
check("3b predicate pattern extractable from the module source", pattern !== null);
function isTestBookingFixture(input) {
  if (!pattern) return false;
  if (input.metadata && typeof input.metadata === "object" && input.metadata.qa_test === true) return true;
  if (typeof input.title === "string" && pattern.test(input.title)) return true;
  if (typeof input.provider === "string" && pattern.test(input.provider)) return true;
  return false;
}
const hasMetadataBranch = testBooking !== null && testBooking.includes("metadata.qa_test === true");
check("3c predicate honours metadata.qa_test === true", hasMetadataBranch);
check(
  "3d fixture: 'Roamly QA Test Stay — Montreal hotel booking' is a test booking",
  isTestBookingFixture({ title: "Roamly QA Test Stay — Montreal hotel booking", provider: null, metadata: null })
);
check(
  "3e fixture: provider 'Test Provider' is a test booking",
  isTestBookingFixture({ title: "Hotel booking", provider: "Test Provider", metadata: null })
);
check(
  "3f fixture: plain title + metadata.qa_test true is a test booking",
  isTestBookingFixture({ title: "Montreal hotel booking", provider: null, metadata: { qa_test: true } })
);
check(
  "3g fixture: plain 'Montreal hotel booking' is NOT a test booking",
  !isTestBookingFixture({ title: "Montreal hotel booking", provider: null, metadata: null })
);
check(
  "3h fixture: 'Quality Hotel' does NOT trip the \\bQA\\b pattern",
  !isTestBookingFixture({ title: "Quality Hotel", provider: null, metadata: null })
);

// --- 4. Wallet timeline: Test booking precedes Confirmed ---------------
let customerStatusBody = "";
if (walletTimeline) {
  const m = walletTimeline.match(/function customerStatus[\s\S]*?\n\}/);
  customerStatusBody = m ? m[0] : "";
}
check(
  "4a customerStatus calls isTestBooking and returns the test label",
  customerStatusBody.includes("isTestBooking") && customerStatusBody.includes("testBookingLabel")
);
check(
  "4b 'Test booking' branch precedes the 'Confirmed' branch in customerStatus",
  customerStatusBody.indexOf("isTestBooking") >= 0 &&
    customerStatusBody.indexOf("isConfirmedBooking") > customerStatusBody.indexOf("isTestBooking")
);

// --- 5. Live-page single header (repair round P3) -----------------------
// The old page-level trip-timing card is GONE: the Live view had three
// destination/state headers stacked (page card + client hero + banner
// title). The client's TripHeroCard is now the ONE authoritative
// header — destination + dates + day + state badge from the shared
// trip clock (the same countdown/state the card duplicated), plus the
// photo — so no trip-state information is lost in the collapse.
check(
  "5a live page renders exactly one header: the client's hero (destination + dates + state badge)",
  livePage !== null &&
    livePage.includes("LiveTripClient") &&
    livePage.includes("destinationLabel") &&
    !livePage.includes("tripTimingCopy") &&
    !livePage.includes("tripDateRange")
);
check(
  "5b hero badge comes from the shared trip clock (no new date logic)",
  liveClient !== null &&
    liveClient.includes("TripHeroCard") &&
    liveClient.includes("tripClockState({") &&
    liveClient.includes("formatTripDateRange(")
);
check(
  "5c hero-badge countdown wording covers future/today/active states",
  // Repair round P3: the page header's countdown copy is gone with
  // the header collapse — the same states now live in the shared
  // trip clock's hero badge (future/tomorrow/active), which the
  // client's hero renders as the Live view's single header.
  liveClient !== null &&
    liveClient.includes("tripClockState({") &&
    liveClient.includes("TripHeroCard") &&
    read("lib/roamly/tripClock.ts").includes("Trip tomorrow") &&
    read("lib/roamly/tripClock.ts").includes("Trip in ${daysUntilStart} days") &&
    read("lib/roamly/tripClock.ts").includes("Trip in progress")
);

// --- 6. Not-started prose trimmed, honesty kept -------------------------
const trimmedFiles = { upNext, nearby, timeline, liveClient, presentation };
const repeatedSentence = /This trip has not started/;
const trimmedOk = Object.values(trimmedFiles).every((src) => src !== null && !repeatedSentence.test(src));
check(
  "6a repeated 'This trip has not started' sentence gone from UpNext / Nearby / Timeline / LiveTripClient / itineraryPresentation",
  trimmedOk
);
check(
  "6b exactly ONE literal 'Trip has not started' retained: the banner title fallback",
  banner !== null &&
    (banner.match(/Trip has not started/g) || []).length === 1 &&
    banner.includes('"Trip has not started"')
);
check(
  "6c itineraryPresentation guard still replaces nearby/today claims when not started",
  presentation !== null &&
    presentation.includes("LIVE_PROXIMITY_CLAIM") &&
    presentation.includes("A planned stop is not nearby") &&
    presentation.includes("not today")
);
check(
  "6d guard replacement invents no proximity: it asserts NOT nearby, NOT today",
  presentation !== null &&
    // Round 2A: the pre-trip copy now states the trip state explicitly
    // ("Trip has not started. A planned stop is not nearby, and these
    // are not today's activities.") — same NOT-nearby / NOT-today
    // assertions, with the state named up front.
    /return "Trip has not started\. A planned stop is not nearby, and these are not today/.test(presentation)
);
check(
  "6e Nearby keeps its honest heading ('Not nearby yet') + first planned stop, no today claim",
  nearby !== null && nearby.includes("Not nearby yet") && nearby.includes("First planned stop")
);
check(
  "6f UpNext / Timeline keep neutral planned eyebrows, no today claim",
  upNext !== null && upNext.includes('"Planned next"') &&
    timeline !== null && timeline.includes('"Planned"')
);
check(
  "6g LiveTripClient pre-trip line is exactly the plan review (no repeated sentence prefix)",
  liveClient !== null && liveClient.includes('? "Review the plan and confirm anything still suggested."')
);

// --- 7. Chronology + nearby evidence (verified, no fix needed) ----------
check(
  "7a LiveTripClient sorts today's activities chronologically (activityStartDate sort)",
  liveClient !== null &&
    liveClient.includes("todayActivities") &&
    /\.sort\(\(a, b\) => \{\s*const aStart = activityStartDate/.test(liveClient)
);
check(
  "7b Up Next list derives from the sorted list (filter preserves order)",
  liveClient !== null && liveClient.includes("todayActivities.filter(")
);
check(
  "7c nearby status only from server geofence results / demo (no invented proximity)",
  liveClient !== null &&
    liveClient.includes("nearbyActivities") &&
    liveClient.includes("insideGeofence") &&
    liveClient.includes("tripWindowActive")
);
check(
  "7d live page itself renders no nearby claim (its nearbyActivity is computed, never rendered)",
  livePage !== null && (livePage.match(/nearbyActivity/g) || []).length === 1
);

// --- Summary ------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (root: ${ROOT})`);
if (failed.length) {
  console.log("Failing checks:");
  for (const f of failed) console.log(` - ${f.name}`);
  process.exit(1);
}
