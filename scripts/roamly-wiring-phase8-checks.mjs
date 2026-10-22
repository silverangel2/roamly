// Phase 8 checks (DESIGN-PRODUCTION.md Phase 8 proof):
//   A — booking-pattern gate + deterministic extractor fidelity: the
//       shadow recon scenario re-run against the WIRED TS lane
//       (reconciliationLane.ts) — newsletter rejected at the gate
//       with the reason recorded; the five booking fixtures produce
//       canonical BookingSignalDTOs field-for-field equal to the
//       Phase 1 golden fixture, signal IDs included, DTO-valid.
//   B — unresolved, never guessed: the missing-address hotel email
//       is unresolved with "address" named missing.
//   C — Gmail-only + consent: an Outlook connect attempt is refused
//       GMAIL_ONLY; reconciliation reads refuse BEFORE any message
//       access when Gmail is not connected or consent is not
//       recorded (spy asserts ZERO reads); the armed gate proceeds.
//   D — lane classification against the shadow plan fixture: the
//       four clean bookings classify SILENT; the delayed flight
//       classifies LOUD with the collision reason naming the dinner
//       and the prepaid cruise (starts-before-landing +
//       cannot-reach-boarding); unbooked items are displaced, never
//       conflicts; a paid-commitment cancellation is LOUD.
//   E — supersession: the delay governs the flight booking; the
//       superseded confirmation fact is retained, either input order.
//   F — the full lane run: guard -> gate -> extract -> supersede ->
//       classify over the whole synthetic mailbox.
//   G — statics: flag defaults, the sync/extraction hookups, the
//       untouched Outlook path, zero-any / zero-disable scan.
//
// Synthetic .eml fixtures only — no real mailbox is touched.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attemptBuild2EmailConnect,
  build2ReconciliationLaneActive,
  classifySignalLane,
  guardReconciliationRead,
  laneMessageFromRawEmail,
  reconcileLaneMessage,
  resolveSupersededSignals,
  runReconciliationLane
} from "@/lib/roamly/reconciliationLane.ts";
import { EMAIL_REFUSAL_MESSAGE, GMAIL_ONLY_MESSAGE } from "@/lib/roamly/gateMachine.ts";
import { parseBookingSignalDTO } from "@/lib/roamly/engine/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const treeRoot = join(here, "..");
const hidden = join(treeRoot, "..", "..");
const emailsDir = join(hidden, "part2-travel-days-2026-10-21", "fixtures", "booking-emails");
const golden = JSON.parse(
  readFileSync(join(here, "fixtures", "wiring-phase1", "part2-booking-signals.json"), "utf8")
).data;
const planned = JSON.parse(
  readFileSync(
    join(hidden, "part2-travel-days-2026-10-21", "fixtures", "planned-itinerary.json"),
    "utf8"
  )
);
const missingAddressRaw = readFileSync(
  join(hidden, "build2-e2e-tester-2026-10-21", "fixtures", "hotel-missing-address.eml"),
  "utf8"
);

let passed = 0;
let failed = 0;
const failures = [];
function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const readEml = (name) => laneMessageFromRawEmail(readFileSync(join(emailsDir, name), "utf8"));
const outcomeOf = (name) => reconcileLaneMessage(readEml(name));

/* ---------------- A — pattern gate + extractor fidelity ---------------- */

const newsletter = outcomeOf("general-newsletter.eml");
assert("A1 newsletter rejected at the booking-pattern gate",
  newsletter.classification === "ignored" && /not a booking-pattern message/.test(newsletter.reason),
  newsletter.reason || newsletter.classification);
assert("A2 rejection reason records the failed checks",
  /booking skeleton/.test(newsletter.reason) && /structured booking times/.test(newsletter.reason),
  newsletter.reason);

const goldenByKey = new Map(
  golden.signals.map((s) => [`${s.booking.reference}|${s.booking.status}`, s])
);
const produced = {};
for (const file of [
  "cruise-booking.eml",
  "flight-confirmation.eml",
  "flight-delay-update.eml",
  "hotel-confirmation.eml",
  "restaurant-reservation.eml"
]) {
  const outcome = outcomeOf(file);
  assert(`A3 ${file} reconciles as a verified signal`,
    outcome.classification === "signal", outcome.classification);
  if (outcome.classification !== "signal") continue;
  const key = `${outcome.signal.booking.reference}|${outcome.signal.booking.status}`;
  produced[key] = outcome.signal;
  const want = goldenByKey.get(key);
  assert(`A4 ${file} has a golden counterpart`, Boolean(want), key);
  if (!want) continue;
  const got = outcome.signal;
  assert(`A5 ${key} signalId is the golden recon- content ID`,
    got.signalId === want.signalId, `${got.signalId} != ${want.signalId}`);
  const b = got.booking;
  const w = want.booking;
  const sdtEq = (x, y) =>
    (x === null && (y === null || y === undefined)) ||
    (x && y && x.date === y.date && x.time === y.time && x.minutes === y.minutes &&
      x.timeZone === y.timeZone && x.stated === y.stated);
  assert(`A6 ${key} facts equal the golden fixture field-for-field`,
    b.kind === w.kind && b.provider === w.provider && b.reference === w.reference &&
      b.leadTraveler === w.leadTraveler && b.status === w.status &&
      b.price.amount === w.price.amount && b.price.currency === w.price.currency &&
      b.price.status === w.price.status &&
      b.name === w.name && b.place === w.place && b.address === w.address &&
      (b.flight ?? null) === (w.flight ?? null) && (b.from ?? null) === (w.from ?? null) &&
      (b.to ?? null) === (w.to ?? null) &&
      sdtEq(b.start, w.start) && sdtEq(b.end, w.end) &&
      sdtEq(b.boarding ?? null, w.boarding ?? null) &&
      (b.prepaid ?? null) === (w.prepaid ?? null) && (b.stars ?? null) === (w.stars ?? null) &&
      (b.room ?? null) === (w.room ?? null) && (b.partySize ?? null) === (w.partySize ?? null),
    JSON.stringify(b));
  assert(`A7 ${key} provenance is the golden provenance`,
    got.provenance.source === want.provenance.source &&
      got.provenance.sourceRef === want.provenance.sourceRef &&
      got.provenance.recordedAt === want.provenance.recordedAt &&
      got.provenance.label === want.provenance.label &&
      got.provenance.messageId === want.provenance.messageId &&
      got.missingFields.length === 0,
    JSON.stringify(got.provenance));
  assert(`A8 ${key} passes the Phase 1 DTO parser`,
    parseBookingSignalDTO(got).ok, JSON.stringify(parseBookingSignalDTO(got)));
}
assert("A9 golden ignored/unresolved counts reproduced (1 ignored, 0 unresolved)",
  golden.ignoredCount === 1 && golden.unresolvedCount === 0);

/* ---------------- B — unresolved, never guessed ---------------- */

const incomplete = reconcileLaneMessage(laneMessageFromRawEmail(missingAddressRaw));
assert("B1 missing-address hotel email is unresolved, not guessed",
  incomplete.classification === "unresolved", incomplete.classification);
assert("B2 the missing field is named: address",
  incomplete.classification === "unresolved" && incomplete.signal.missingFields.includes("address"),
  incomplete.classification === "unresolved" ? incomplete.signal.missingFields.join(",") : "");
assert("B3 the unresolved signal is still DTO-valid (unresolved requires named missing fields)",
  incomplete.classification === "unresolved" && parseBookingSignalDTO(incomplete.signal).ok);

/* ---------------- C — Gmail-only + consent gate ---------------- */

const outlookAttempt = attemptBuild2EmailConnect("outlook");
assert("C1 Outlook connect attempt refused in-flow with GMAIL_ONLY",
  outlookAttempt.ok === false && outlookAttempt.code === "GMAIL_ONLY" &&
    outlookAttempt.message === GMAIL_ONLY_MESSAGE,
  JSON.stringify(outlookAttempt));
assert("C2 Gmail connect attempt is the one accepted provider",
  attemptBuild2EmailConnect("gmail").ok === true);
assert("C3 any other mailbox is refused the same way",
  attemptBuild2EmailConnect("yahoo").ok === false &&
    attemptBuild2EmailConnect("imap").ok === false);

const plan = {
  tripId: "shadow-halifax-owner-chain",
  timeZone: "America/Halifax",
  items: planned.items.map((i) => ({
    itemRef: i.id,
    title: i.name,
    kind: i.kind,
    date: i.date,
    startMin: i.startMin,
    endMin: i.endMin,
    boardingMin: i.boardingMin ?? null,
    arrivalTransferMin: i.transferMinFromPriorArea ?? null,
    paid: i.paid === true,
    prepaid: i.prepaid === true,
    bookingRef: i.bookingRef ?? null
  }))
};

let spyCalls = 0;
const spyReader = () => {
  spyCalls += 1;
  return [];
};
const refusedNoGmail = runReconciliationLane({
  gate: { gmailState: "NOT_CONNECTED", gmailConsentScope: null },
  readMessages: spyReader,
  plan
});
assert("C4 no Gmail connected -> refused with the plain Gmail-specific message",
  refusedNoGmail.refusal?.code === "GMAIL_NOT_CONNECTED" &&
    refusedNoGmail.refusal?.message === EMAIL_REFUSAL_MESSAGE,
  JSON.stringify(refusedNoGmail.refusal));
assert("C5 the refusal performed ZERO message reads (spy)",
  spyCalls === 0 && refusedNoGmail.messagesRead === 0, `spy calls: ${spyCalls}`);

const refusedNoConsent = runReconciliationLane({
  gate: { gmailState: "CONNECTED", gmailConsentScope: null },
  readMessages: spyReader,
  plan
});
assert("C6 connected but consent not recorded -> RECONCILIATION_NOT_ARMED, still zero reads",
  refusedNoConsent.refusal?.code === "RECONCILIATION_NOT_ARMED" && spyCalls === 0,
  JSON.stringify(refusedNoConsent.refusal));
const refusedWrongScope = guardReconciliationRead({
  gmailState: "RECONCILIATION_ARMED",
  gmailConsentScope: "https://www.googleapis.com/auth/gmail.readonly"
});
assert("C7 an armed claim without the Build 2 consent scope is refused by the guard",
  refusedWrongScope.ok === false && refusedWrongScope.code === "RECONCILIATION_NOT_ARMED");
const armedDecision = guardReconciliationRead({
  gmailState: "RECONCILIATION_ARMED",
  gmailConsentScope: "booking-confirmations-only-in-gmail"
});
assert("C8 armed + recorded consent scope -> reads allowed", armedDecision.ok === true);
assert("C9 lane activity: flag off = never in-lane; flag on + Outlook = never in-lane",
  build2ReconciliationLaneActive("gmail", {}) === false &&
    build2ReconciliationLaneActive("outlook", { ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED: "true" }) === false &&
    build2ReconciliationLaneActive("gmail", { ROAMLY_BUILD2_RECONCILIATION_SILENT_ENABLED: "true" }) === true);

/* ---------------- D — lane classification ---------------- */

const flightConf = produced["SYN-AC-7Q2M|confirmed"];
const flightDelay = produced["SYN-AC-7Q2M|delayed"];
const hotelConf = produced["SYN-HH-41KD|confirmed"];
const dinnerConf = produced["SYN-LP-19A|confirmed"];
const cruiseConf = produced["SYN-HC-2030|confirmed"];

for (const [label, signal] of [
  ["flight confirmation", flightConf],
  ["hotel confirmation", hotelConf],
  ["restaurant confirmation", dinnerConf],
  ["cruise confirmation", cruiseConf]
]) {
  const verdict = classifySignalLane(signal, plan);
  assert(`D1 clean ${label} classifies SILENT-align with the reason recorded`,
    verdict.lane === "silent" && verdict.conflicts.length === 0 &&
      verdict.reason.startsWith("silent-align"),
    verdict.reason);
}

const delayVerdict = classifySignalLane(flightDelay, plan);
assert("D2 the delayed flight classifies LOUD-collision",
  delayVerdict.lane === "loud" && delayVerdict.reason.startsWith("loud-collision"),
  delayVerdict.reason);
const conflictByRef = new Map(delayVerdict.conflicts.map((c) => [c.itemRef, c]));
assert("D3 the collision names the dinner: starts-before-landing",
  conflictByRef.get("lou-pecou-dinner")?.kind === "starts-before-landing",
  JSON.stringify(delayVerdict.conflicts));
assert("D4 the collision names the prepaid cruise: cannot-reach-boarding (20:15 / earliest 20:35)",
  conflictByRef.get("harbour-cruise")?.kind === "cannot-reach-boarding" &&
    /boards at 20:15/.test(delayVerdict.reason) && /earliest arrival is 20:35/.test(delayVerdict.reason),
  delayVerdict.reason);
assert("D5 the reason names both endangered items in human words",
  /Lou Pécou/.test(delayVerdict.reason) && /Halifax Harbour Evening Cruise/.test(delayVerdict.reason),
  delayVerdict.reason);
assert("D6 unbooked items are displaced by the fact, never conflicts",
  delayVerdict.displaced.some((d) => d.itemRef === "arrival-lunch") &&
    delayVerdict.displaced.some((d) => d.itemRef === "citadel") &&
    !delayVerdict.conflicts.some((c) => c.itemRef === "arrival-lunch" || c.itemRef === "citadel"),
  JSON.stringify({ conflicts: delayVerdict.conflicts, displaced: delayVerdict.displaced }));

const cancellation = reconcileLaneMessage({
  messageId: "<synthetic-hotel-cancellation@roamly-shadow.invalid>",
  sender: "Harbourlight Reservations <stay@harbourlight.example>",
  subject: "SYNTHETIC booking cancelled: Harbourlight Hotel & Suites",
  receivedAt: "Wed, 21 Oct 2026 08:00:00 -0300",
  bodyText: [
    "Booking type: Hotel",
    "Provider: Harbourlight Hotel & Suites",
    "Booking reference: SYN-HH-41KD",
    "Lead traveler: Avery Morgan",
    "Status: Cancelled",
    "Hotel: Harbourlight Hotel & Suites",
    "Address: 1200 Synthetic Harbour Way, Halifax, NS",
    "Check-in: Friday, October 23, 2026 at 3:00 PM (America/Halifax)",
    "Check-out: Sunday, October 25, 2026 at 11:00 AM (America/Halifax)"
  ].join("\n")
});
assert("D7 a cancellation email reconciles as a verified signal",
  cancellation.classification === "signal" && cancellation.signal.booking.status === "cancelled",
  cancellation.classification);
if (cancellation.classification === "signal") {
  const verdict = classifySignalLane(cancellation.signal, plan);
  assert("D8 cancelling a paid commitment is LOUD (cancels-paid-commitment)",
    verdict.lane === "loud" &&
      verdict.conflicts.some((c) => c.kind === "cancels-paid-commitment" && c.itemRef === "hotel-check-in"),
    verdict.reason);
}

/* ---------------- E — supersession ---------------- */

const sup1 = resolveSupersededSignals([flightConf, flightDelay]);
assert("E1 newest verified message governs the booking",
  sup1.governing.length === 1 && sup1.governing[0].signalId === flightDelay.signalId,
  JSON.stringify(sup1.governing.map((g) => g.signalId)));
assert("E2 the superseded confirmation fact is retained in provenance",
  sup1.supersededFactsBySignalId[flightDelay.signalId]?.length === 1 &&
    sup1.supersededFactsBySignalId[flightDelay.signalId][0].start?.time === "10:05" &&
    sup1.supersededFactsBySignalId[flightDelay.signalId][0].status === "confirmed",
  JSON.stringify(sup1.supersededFactsBySignalId));
const sup2 = resolveSupersededSignals([flightDelay, flightConf]);
assert("E3 governing is order-independent (latest received wins either way)",
  sup2.governing.length === 1 && sup2.governing[0].signalId === flightDelay.signalId);
const sup3 = resolveSupersededSignals([hotelConf, dinnerConf, cruiseConf]);
assert("E4 unrelated bookings never supersede each other",
  sup3.governing.length === 3 && Object.keys(sup3.supersededFactsBySignalId).length === 0);

/* ---------------- F — the full lane run ---------------- */

const mailbox = [
  "flight-confirmation.eml",
  "hotel-confirmation.eml",
  "restaurant-reservation.eml",
  "cruise-booking.eml",
  "flight-delay-update.eml",
  "general-newsletter.eml"
].map(readEml);
const run = runReconciliationLane({
  gate: { gmailState: "RECONCILIATION_ARMED", gmailConsentScope: "booking-confirmations-only-in-gmail" },
  readMessages: () => mailbox,
  plan
});
assert("F1 the armed lane run reads the mailbox and refuses nothing",
  run.refusal === null && run.messagesRead === 6, `read: ${run.messagesRead}`);
assert("F2 the newsletter is the one ignored message, reason recorded",
  run.ignored.length === 1 && /not a booking-pattern/.test(run.ignored[0].reason),
  JSON.stringify(run.ignored));
assert("F3 the classified stream holds the four governing signals",
  run.signals.length === 4 && run.unresolved.length === 0,
  `signals: ${run.signals.length}, unresolved: ${run.unresolved.length}`);
const streamByRef = new Map(run.signals.map((s) => [s.signal.booking.reference, s]));
assert("F4 the flight stream entry is the DELAY signal, LOUD, superseded fact attached",
  streamByRef.get("SYN-AC-7Q2M")?.signal.booking.status === "delayed" &&
    streamByRef.get("SYN-AC-7Q2M")?.lane === "loud" &&
    streamByRef.get("SYN-AC-7Q2M")?.supersededFacts.length === 1,
  JSON.stringify(streamByRef.get("SYN-AC-7Q2M")?.signal.booking.status));
assert("F5 hotel, dinner, and cruise stream entries are SILENT",
  ["SYN-HH-41KD", "SYN-LP-19A", "SYN-HC-2030"].every(
    (ref) => streamByRef.get(ref)?.lane === "silent"
  ));

/* ---------------- G — statics ---------------- */

const laneSource = readFileSync(join(treeRoot, "lib", "roamly", "reconciliationLane.ts"), "utf8");
const emailSource = readFileSync(join(treeRoot, "lib", "roamly", "emailConnections.ts"), "utf8");
const extractionSource = readFileSync(join(treeRoot, "lib", "roamly", "bookingExtraction.ts"), "utf8");
const syncBody = emailSource.slice(
  emailSource.indexOf("async function syncGmailConnectionUnlocked"),
  emailSource.indexOf("export async function syncGmailConnection")
);
assert("G1 sync seam: consent gate stands before the token fetch and any Gmail read",
  syncBody.includes("build2GmailConsentRecorded") &&
    syncBody.includes('error: "RECONCILIATION_NOT_ARMED"') &&
    syncBody.indexOf("RECONCILIATION_NOT_ARMED") < syncBody.indexOf("accessTokenForConnection"));
const recordBody = emailSource.slice(
  emailSource.indexOf("async function recordGmailTravelMessage"),
  emailSource.indexOf("async function fetchGmailTravelBodyText")
);
assert("G2 sync seam: the booking-pattern gate stands in front of extraction",
  recordBody.includes("classifyBookingPattern") &&
    recordBody.includes("laneRejected") &&
    recordBody.indexOf("classifyBookingPattern") <
      recordBody.indexOf("extractAndMatchTravelEmailBooking"));
assert("G3 extraction seam: in-lane the deterministic extractor is the parser of record (AI gated off)",
  extractionSource.includes("build2ReconciliationLaneActive") &&
    extractionSource.includes("!inBuild2Lane && deterministic.overallConfidence < 0.45"));
assert("G4 the legacy Outlook path is present and untouched by the lane",
  emailSource.includes("recordOutlookTravelMessages") &&
    emailSource.includes("syncOutlookConnection") &&
    !emailSource.slice(emailSource.indexOf("recordOutlookTravelMessages")).includes("classifyBookingPattern"));
assert("G5 the lane module contains no AI extraction path",
  !/openai/i.test(laneSource) && !laneSource.includes("extractBookingWithAiStructuredOutput"));
assert("G6 zero `any` / zero eslint-disable across the phase's files",
  ![laneSource, emailSource, extractionSource].some((src) =>
    /as any|: any|<any>|any\[\]|eslint-disable/.test(src)
  ));

/* ---------------- summary ---------------- */

console.log(`\nPHASE 8 CHECKS: ${passed}/${passed + failed} PASS`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
