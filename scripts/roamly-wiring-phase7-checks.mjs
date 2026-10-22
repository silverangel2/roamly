// Phase 7 checks (DESIGN-PRODUCTION.md Phase 7 proof):
//   A — the shadow compact-v2 proof (26/26) re-run against the WIRED
//       TS view models + ledger (companionPanel.ts +
//       companionLedger.ts): push/strip/row scale specs, ONE
//       Directions control with the chooser behind it, truthful map
//       recommendations, DIRECTIONS_VIEWED non-terminal, check-in
//       collapse + Undo, STALE -> EXPIRED with the ledger intact,
//       SKIP collapses with the taste signal.
//   B — ledger service semantics: Phase 1 DTO validity of every row,
//       idempotent re-append, undo-with-nothing refused, MISSED kept
//       separate from SKIP, dwell derived (never stored), true-time
//       recording, append-only seam + M2 statics.
//   C — offline day (companionOffline.ts): cache round-trip, action
//       queue keeps TRUE times, ordered flush, failure keeps queue.
//   D — wallet pass (companionPass.ts): pass view from the fixture
//       day, Apple payload shape, bundle manifest over the REAL
//       icon bytes, signer dormancy (refuses without an injected
//       signer; signs with one), update mechanics, Google object.
//   E — Sophie outbox (companionOutbox.ts): durable enqueue +
//       dedupe, the Phase 2 UnresolvedSink plugged in, dormancy
//       (records stay queued; no send path exists).
//   F — push dispatch (companionPush.ts): payload built from the
//       panel's own push view; PR #57 email discipline imported
//       from pushServer (cap/collapse), never forked.
//   G — statics: flag default off, live-page mount, activityActions
//       ledger hook, panel action route, pass page, mobile-only
//       panel, M3 widenings, zero-any / zero-disable scan.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  availableActionsFor,
  buildCompanionPanel,
  buildCompactCompanionSurfaces,
  buildWalletPassView,
  compactItemPresentation,
  computeLeaveBy,
  deriveItemLivedState,
  evaluateItemLifecycle
} from "@/lib/roamly/companionPanel.ts";
import {
  InMemoryCompanionLedgerStore,
  appendCompanionLedgerAction,
  appendCompanionLedgerUndo,
  panelActionProvenance
} from "@/lib/roamly/companionLedger.ts";
import {
  flushPanelActionQueue,
  loadCompanionDayCache,
  queuePanelAction,
  readPanelActionQueue,
  saveCompanionDayCache
} from "@/lib/roamly/companionOffline.ts";
import {
  InMemorySophieOutboxStore,
  createUnresolvedOutboxSink,
  enqueueSophieEscalation
} from "@/lib/roamly/companionOutbox.ts";
import {
  WalletSignerUnavailableError,
  buildApplePassPayload,
  buildGoogleWalletObject,
  buildPassBundle,
  describePassUpdate,
  issueGoogleWalletSaveLink,
  passSerialFor,
  signPassBundle
} from "@/lib/roamly/companionPass.ts";
import { buildPanelPushPayload } from "@/lib/roamly/companionPush.ts";
import {
  MAX_COMPANION_EVENT_EMAIL_ATTEMPTS,
  companionEventEmailAllowed
} from "@/lib/roamly/pushServer.ts";
import { parseCompanionLedgerEntryDTO } from "@/lib/roamly/engine/types.ts";
import { localToInstantString } from "@/lib/roamly/engine/time.ts";
import { extractConstraints } from "@/lib/roamly/engine/understand.ts";
import { build2CompanionEnabled } from "@/lib/roamly/build2Flags.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TREE = join(HERE, "..");
const readTree = (rel) => readFileSync(join(TREE, rel), "utf8");

const results = [];
function assert(name, cond, detail = "") {
  results.push({ name, pass: !!cond });
  if (!cond) console.error(`FAIL ${results.length}. ${name} ${detail}`);
  else console.log(`ok ${results.length}. ${name}`);
}

/* ------------------------------------------------------------------ */
/* Fixture day — the shadow's Halifax scenario (companion-day.json):   */
/* Fri 2026-10-23, now 14:52 (minute 892), America/Halifax.            */
/* ------------------------------------------------------------------ */

const TZ = "America/Halifax";
const DATE = "2026-10-23";
const at = (minutes) => localToInstantString(DATE, minutes, TZ);

function activity(overrides) {
  return {
    id: "item",
    kind: "attraction",
    name: "Item",
    place: "Item place",
    address: null,
    date: DATE,
    startMin: 600,
    endMin: 660,
    boardingMin: null,
    status: "planned",
    prepaid: false,
    bookingRef: null,
    travelMin: null,
    mapMode: "place",
    latitude: null,
    longitude: null,
    provenanceLabel: null,
    completedAtMin: null,
    ...overrides
  };
}

const citadel = activity({
  id: "citadel",
  kind: "attraction",
  name: "Halifax Citadel National Historic Site",
  place: "Halifax Citadel National Historic Site",
  address: "5425 Sackville Street, Halifax, NS",
  startMin: 940,
  endMin: 1005,
  travelMin: 18,
  latitude: 44.6475,
  longitude: -63.5804
});
const dinner = activity({
  id: "lou-pecou-dinner",
  kind: "food",
  name: "Lou Pécou",
  place: "Lou Pécou",
  startMin: 1140,
  endMin: 1200,
  provenanceLabel: "from your confirmation email"
});
const cruise = activity({
  id: "harbour-cruise",
  kind: "cruise",
  name: "Halifax Harbour Evening Cruise",
  place: "Halifax Harbour Evening Cruise",
  startMin: 1230,
  endMin: 1320,
  boardingMin: 1215,
  prepaid: true,
  bookingRef: "SYN-HFX-2214"
});
const flight = activity({
  id: "flight-ac1847",
  kind: "flight",
  name: "Flight AC 1847 to Halifax Stanfield",
  place: "Halifax Stanfield (YHZ)",
  startMin: 605,
  endMin: 800,
  bookingRef: "SYN-AC-7Q2M"
});

function panelInput(ledgerEntries, nowMin = 892, activities = [citadel, dinner, cruise]) {
  return {
    tripId: "trip-halifax-fixture",
    destination: "Halifax",
    date: DATE,
    timezone: TZ,
    nowMin,
    activities,
    ledgerEntries,
    alerts: [],
    citymapperCoverage: false,
    bufferMin: 10,
    currentPlace: "Harbourlight Hotel & Suites"
  };
}

/* ------------------------------------------------------------------ */
/* A — the shadow compact proof, 26/26 against the wired modules       */
/* ------------------------------------------------------------------ */

const store = new InMemoryCompanionLedgerStore();
const emptyPanel = buildCompanionPanel(panelInput([]));
const surfaces = buildCompactCompanionSurfaces(emptyPanel, panelInput([]));

assert("A1 push exists, headline names the next destination",
  !!surfaces.push && surfaces.push.headline.includes("next destination"));
assert("A2 push + strip carry NO map options (chooser only)",
  !("mapOptions" in (surfaces.push || {})) && !("mapOptions" in (surfaces.strip || {})));
assert("A3 push action row is compact (check-in/skip/details only)",
  ["check-in", "skip", "details"].every((a) => surfaces.push.actions.some((x) => x.id === a)));
assert("A4 push scale spec <= 110px tall, 358px wide",
  surfaces.scale.push.maxHeightPx <= 110 && surfaces.scale.push.widthPx === 358);
assert("A5 strip scale spec <= 112px", surfaces.scale.strip.maxHeightPx <= 112);
assert("A6 row scale spec <= 88px", surfaces.scale.row.maxHeightPx <= 88);
assert("A7 strip keeps Check in + Skip + Directions",
  surfaces.strip.checkIn?.mode === "available" && !!surfaces.strip.skip && surfaces.strip.directions?.opensChooser === true);
assert("A8 every row has at most ONE Directions control, opening the chooser",
  surfaces.rows.every((r) => !r.directions || (r.directions.label === "Directions" && r.directions.opensChooser === true)));
assert("A9 chooser behind Directions lists Apple/Google/Citymapper",
  ["Apple Maps", "Google Maps", "Citymapper"].every((l) => surfaces.rows[0].directions.options.some((o) => o.label === l)));
assert("A10 Halifax chooser recommends Google; Citymapper unavailable, never recommended",
  (() => { const o = surfaces.rows[0].directions.options; const g = o.find((x) => x.provider === "google"); const c = o.find((x) => x.provider === "citymapper"); return g.recommended && !c.available && !c.recommended; })());
assert("A11 future rows show opens-at instead of a live Check in",
  surfaces.rows.filter((r) => r.itemId !== "citadel").every((r) => r.checkIn?.mode === "opens-at"));
assert("A12 next row Check in is available (opens 14:40, now 14:52)",
  surfaces.rows[0].checkIn?.mode === "available");

// Leave-by truth on the fixture day (the push + strip lines).
assert("A-push leave-by line is exact (15:12, 18 min away, starts 15:40)",
  surfaces.push.practicalLine === "Leave by 15:12 · 18 min away · starts 15:40");
assert("A-strip leave-by line carries the buffer (10 min spare)",
  surfaces.strip.leaveByLine === "Leave by 15:12 · 18 min away · 10 min spare");
// The brief's example numbers: a 15:30 start, 40 travel + 10 buffer -> 14:40.
const briefItem = activity({ id: "brief", startMin: 930, endMin: 990, travelMin: 40 });
const briefLeaveBy = computeLeaveBy(briefItem, { bufferMin: 10 });
assert("A-brief leave-by computes 14:40 for the 15:30 start and voices it",
  briefLeaveBy?.leaveByLabel === "14:40" && briefLeaveBy.voice.startsWith("Leave by 14:40"));

const freshLived = deriveItemLivedState([], citadel, 892);
assert("A13 UPCOMING actions include directions/check-in/skip",
  ["directions", "check-in", "skip"].every((a) => availableActionsFor(freshLived, citadel).includes(a)));

await appendCompanionLedgerAction(store, {
  tripId: "trip-halifax-fixture", activityRef: "citadel", classification: "DIRECTIONS_VIEWED",
  at: at(892), timezone: TZ, provenance: panelActionProvenance(at(892))
});
let entries = await store.listForTrip("trip-halifax-fixture");
let lived = deriveItemLivedState(entries, citadel, 892);
assert("A14 after Directions open: lived state unchanged (not checked-in/skipped/missed)",
  lived.kind === "directions-viewed" && lived.directionsViewed === true);
assert("A15 after Directions open: signal is DIRECTIONS_VIEWED, terminal=false",
  lived.signal?.classification === "DIRECTIONS_VIEWED" && lived.signal?.terminal === false);
assert("A16 after Directions open: Check in STILL available",
  availableActionsFor(lived, citadel).includes("check-in"));
assert("A17 after Directions open: Skip STILL available",
  availableActionsFor(lived, citadel).includes("skip"));

const checkInResult = await appendCompanionLedgerAction(store, {
  tripId: "trip-halifax-fixture", activityRef: "citadel", classification: "CHECKED_IN",
  at: at(938), timezone: TZ, provenance: panelActionProvenance(at(938))
});
entries = await store.listForTrip("trip-halifax-fixture");
lived = deriveItemLivedState(entries, citadel, 950);
const pres = compactItemPresentation(lived, citadel, 950);
assert("A18 check-in collapses to the one-line confirmation",
  pres.mode === "collapsed-confirmation" && pres.line === "Checked in · Halifax Citadel National Historic Site");
assert("A19 collapsed confirmation carries Undo", pres.affordances.includes("undo"));
assert("A20 during the visit: panel-visible as checked-in",
  (() => { const l = evaluateItemLifecycle(lived, citadel, 950); return l.state === "checked-in" && l.panelVisible; })());
assert("A21 after the visit window: STALE, still briefly visible",
  (() => { const l = evaluateItemLifecycle(lived, citadel, 1010); return l.state === "stale" && l.panelVisible; })());
assert("A22 after the stale window: EXPIRED from the panel, retained in the ledger",
  (() => { const l = evaluateItemLifecycle(lived, citadel, 1040); return l.state === "expired" && !l.panelVisible && entries.some((e) => e.entryId === checkInResult.entry.entryId); })());

const store2 = new InMemoryCompanionLedgerStore();
await appendCompanionLedgerAction(store2, {
  tripId: "trip-halifax-fixture", activityRef: "citadel", classification: "CHECKED_IN",
  at: at(938), timezone: TZ, provenance: panelActionProvenance(at(938))
});
const undoResult = await appendCompanionLedgerUndo(store2, {
  tripId: "trip-halifax-fixture", activityRef: "citadel",
  at: at(940), timezone: TZ, provenance: panelActionProvenance(at(940))
});
const entries2 = await store2.listForTrip("trip-halifax-fixture");
const lived2 = deriveItemLivedState(entries2, citadel, 941);
assert("A23 undo after an accidental check-in restores planned + actions",
  undoResult.ok && lived2.kind === "none" && availableActionsFor(lived2, citadel).includes("check-in"));
assert("A24 undo is itself a row AND the original row survives (history never erased)",
  entries2.length === 2 && entries2.some((e) => e.undoOfEntryId) && entries2.some((e) => e.classification === "CHECKED_IN" && !e.undoOfEntryId));

await appendCompanionLedgerAction(store, {
  tripId: "trip-halifax-fixture", activityRef: "lou-pecou-dinner", classification: "SKIPPED",
  at: at(892), timezone: TZ, provenance: panelActionProvenance(at(892))
});
entries = await store.listForTrip("trip-halifax-fixture");
const dinnerLived = deriveItemLivedState(entries, dinner, 895);
const pres3 = compactItemPresentation(dinnerLived, dinner, 895);
assert("A25 skip collapses to the one-line confirmation with Undo",
  pres3.mode === "collapsed-confirmation" && pres3.line === "Skipped · Lou Pécou" && pres3.affordances.includes("undo"));
assert("A26 skip writes the TASTE signal and the record is retained",
  dinnerLived.signal?.classification === "SKIP" && dinnerLived.signal?.feedsPredictWeights === true &&
  entries.some((e) => e.activityRef === "lou-pecou-dinner" && e.classification === "SKIPPED"));

/* ------------------------------------------------------------------ */
/* B — ledger service semantics                                        */
/* ------------------------------------------------------------------ */

const allRows = [...entries, ...entries2];
assert("B1 every written row parses as a Phase 1 CompanionLedgerEntryDTO",
  allRows.length > 0 && allRows.every((row) => parseCompanionLedgerEntryDTO(row).ok));
const rowsBefore = (await store.listForTrip("trip-halifax-fixture")).length;
const dup = await appendCompanionLedgerAction(store, {
  tripId: "trip-halifax-fixture", activityRef: "citadel", classification: "CHECKED_IN",
  at: at(938), timezone: TZ, provenance: panelActionProvenance(at(938))
});
assert("B2 re-appending the same action is an idempotent no-op (no duplicate row)",
  dup.ok && dup.inserted === false && (await store.listForTrip("trip-halifax-fixture")).length === rowsBefore);
const noUndo = await appendCompanionLedgerUndo(store, {
  tripId: "trip-halifax-fixture", activityRef: "harbour-cruise",
  at: at(900), timezone: TZ, provenance: panelActionProvenance(at(900))
});
assert("B3 undo with nothing to undo is refused plainly",
  noUndo.ok === false && noUndo.error === "nothing to undo");
await appendCompanionLedgerAction(store, {
  tripId: "trip-halifax-fixture", activityRef: "harbour-cruise", classification: "MISSED",
  at: at(1330), timezone: TZ,
  provenance: { source: "companion", sourceRef: "weather closure", recordedAt: at(1330), label: "live companion" }
});
const cruiseLived = deriveItemLivedState(await store.listForTrip("trip-halifax-fixture"), cruise, 1331);
assert("B4 MISSED is circumstance: no taste weight, re-homing candidate — never a SKIP",
  cruiseLived.kind === "missed" && cruiseLived.signal?.feedsPredictWeights === false && cruiseLived.signal?.rehomeCandidate === true);
const dwellDuring = deriveItemLivedState(entries, citadel, 950).dwellMinutes;
const dwellAfter = deriveItemLivedState(entries, citadel, 1040).dwellMinutes;
assert("B5 dwell is derived, not stored: open during the visit, 67 min once the window closes",
  dwellDuring === null && dwellAfter === 67 &&
  entries.find((e) => e.classification === "CHECKED_IN")?.dwellMinutes === null);
const trueTimeRow = entries.find((e) => e.classification === "CHECKED_IN");
assert("B6 the ledger records the TRUE action time (instant + trip-local minute)",
  trueTimeRow?.at === at(938) && trueTimeRow?.atMinuteOfTrip === 938);
assert("B7 the store seam is append-only (no update/delete surface exists)",
  typeof store.update === "undefined" && typeof store.delete === "undefined" && typeof store.remove === "undefined");
const m2 = readTree("supabase/migrations/20261022_roamly_companion_ledger.sql");
assert("B8 M2 enforces append-only in the database (trigger + insert/select grants only)",
  m2.includes("append-only") && m2.includes("roamly_companion_ledger_append_only") &&
  m2.includes("grant select, insert on table public.roamly_companion_ledger") &&
  !/grant[^;]*update[^;]*roamly_companion_ledger/.test(m2) && !/grant[^;]*delete[^;]*roamly_companion_ledger/.test(m2));

/* ------------------------------------------------------------------ */
/* C — offline day                                                     */
/* ------------------------------------------------------------------ */

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
const storage = new MemoryStorage();
const passView = buildWalletPassView({
  destination: "Halifax", date: DATE, travelerName: "Avery Morgan", partyLabel: "2 adults",
  activities: [flight, citadel, dinner, cruise], hotelName: "Harbourlight Hotel & Suites",
  hotelCheckInLabel: "2026-10-23 15:00", nowMin: 892, cachedAt: at(420), pendingSyncActions: 0
});
saveCompanionDayCache(storage, {
  tripId: "trip-halifax-fixture", date: DATE, timezone: TZ, cachedAt: at(420),
  panelInput: panelInput([]), pass: passView
});
const loaded = loadCompanionDayCache(storage, "trip-halifax-fixture", DATE);
assert("C1 the day cache round-trips (pass + panel input survive on device)",
  !!loaded && loaded.pass.headline.includes("Halifax Citadel") && loaded.panelInput.activities.length === 3);
assert("C2 a cache for another date never serves as today",
  loadCompanionDayCache(storage, "trip-halifax-fixture", "2026-10-24") === null);
queuePanelAction(storage, "trip-halifax-fixture", {
  kind: "check-in", activityRef: "citadel", occurredAt: at(938), occurredMinuteOfTrip: 938
});
queuePanelAction(storage, "trip-halifax-fixture", {
  kind: "check-in", activityRef: "citadel", occurredAt: at(938), occurredMinuteOfTrip: 938
});
queuePanelAction(storage, "trip-halifax-fixture", {
  kind: "skip", activityRef: "lou-pecou-dinner", occurredAt: at(945), occurredMinuteOfTrip: 945
});
assert("C3 offline actions queue with their true times; re-queueing the same tap dedupes",
  readPanelActionQueue(storage, "trip-halifax-fixture").length === 2);
const sentLog = [];
const flushOk = await flushPanelActionQueue(storage, "trip-halifax-fixture", async (action) => {
  sentLog.push(action);
  return true;
});
assert("C4 the flush replays in order and the ledger-bound times are the TRUE times",
  flushOk.sent === 2 && flushOk.remaining === 0 && sentLog[0].occurredAt === at(938) && sentLog[1].occurredAt === at(945));
queuePanelAction(storage, "trip-halifax-fixture", {
  kind: "undo", activityRef: "citadel", occurredAt: at(950), occurredMinuteOfTrip: 950
});
queuePanelAction(storage, "trip-halifax-fixture", {
  kind: "directions-viewed", activityRef: "harbour-cruise", occurredAt: at(951), occurredMinuteOfTrip: 951
});
const flushFail = await flushPanelActionQueue(storage, "trip-halifax-fixture", async () => false);
assert("C5 a failed flush keeps the whole queue (nothing is silently dropped)",
  flushFail.sent === 0 && flushFail.remaining === 2 && readPanelActionQueue(storage, "trip-halifax-fixture").length === 2);
let calls = 0;
const flushPartial = await flushPanelActionQueue(storage, "trip-halifax-fixture", async () => (++calls === 1));
assert("C6 a partial flush removes exactly what was sent and keeps the rest",
  flushPartial.sent === 1 && flushPartial.remaining === 1 &&
  readPanelActionQueue(storage, "trip-halifax-fixture")[0]?.kind === "directions-viewed");

/* ------------------------------------------------------------------ */
/* D — wallet pass                                                     */
/* ------------------------------------------------------------------ */

assert("D1 the pass view is built from the day: next activity, flight essentials, real logo path",
  passView.nextActivity?.id === "citadel" && passView.nextActivity?.startLabel === "15:40" &&
  passView.essentials.flightBookingRef === "SYN-AC-7Q2M" && passView.logoPath === "/icon-512.png" &&
  passView.headline === "Hey, your next destination is Halifax Citadel National Historic Site.");
const liveUrl = "https://roamlyhq.com/trip/trip-halifax-fixture/live";
const payload = buildApplePassPayload(passView, {
  tripId: "trip-halifax-fixture", liveUrl, dayStartInstant: at(0)
});
assert("D2 the Apple payload carries the Roamly identity + day details in the platform shape",
  payload.formatVersion === 1 && payload.organizationName === "Roamly" && payload.logoText === "Roamly" &&
  payload.serialNumber === passSerialFor("trip-halifax-fixture", DATE) &&
  payload.description.includes("Halifax") &&
  payload.generic.primaryFields[0].value.includes("Halifax Citadel") &&
  payload.barcodes[0].message === liveUrl);
assert("D3 no signer configured: placeholder identifier is LABELED unconfigured; no web service fields are faked",
  payload.passTypeIdentifier.endsWith("UNCONFIGURED") && payload.webServiceURL === undefined && payload.teamIdentifier === undefined);
const iconBytes = readFileSync(join(TREE, "public", "icon-512.png"));
const bundle = buildPassBundle(passView, {
  tripId: "trip-halifax-fixture", liveUrl, dayStartInstant: at(0), iconPng: iconBytes
});
assert("D4 the bundle's icon + logo ARE the app's verified icon bytes, pinned by sha1 manifest",
  bundle.files.find((f) => f.name === "icon.png")?.content.equals(iconBytes) &&
  bundle.files.find((f) => f.name === "icon.png")?.sourceAsset === "/icon-512.png" &&
  bundle.files.every((f) => bundle.manifest[f.name] === createHash("sha1").update(f.content).digest("hex")));
let signerError = null;
try {
  await signPassBundle(bundle, null);
} catch (error) {
  signerError = error;
}
assert("D5 signing without an injected signer REFUSES (owner-gated, never fabricated)",
  signerError instanceof WalletSignerUnavailableError && signerError.code === "WALLET_SIGNER_UNAVAILABLE");
const fakeSigner = {
  passTypeIdentifier: "pass.com.roamlyhq.daypass",
  teamIdentifier: "TEAMID1234",
  async signManifest(manifest) { return Buffer.from(`signed:${createHash("sha1").update(manifest).digest("hex")}`); }
};
const signed = await signPassBundle(bundle, fakeSigner);
assert("D6 with an injected signer the bundle gains manifest.json + signature over the manifest",
  signed.files.some((f) => f.name === "signature" && f.content.toString().startsWith("signed:")) &&
  signed.files.some((f) => f.name === "manifest.json"));
const updSame = describePassUpdate(passView, "trip-halifax-fixture", bundle.version);
const movedView = { ...passView, nextActivity: { ...passView.nextActivity, bookingRef: "CHANGED-1" } };
const updMoved = describePassUpdate(movedView, "trip-halifax-fixture", bundle.version);
assert("D7 update mechanics: stable day = no change; changed details = new version, same serial",
  updSame.changed === false && updMoved.changed === true && updMoved.serial === updSame.serial && updMoved.version !== updSame.version);
const googleObject = buildGoogleWalletObject(passView, {
  tripId: "trip-halifax-fixture", liveUrl, iconUrl: "https://roamlyhq.com/icon-512.png", issuerId: "3388000000000000000"
});
assert("D8 the Google object mirrors the same day (title, logo URI, QR target)",
  googleObject.cardTitle.defaultValue.value === "Roamly Day Pass" &&
  googleObject.logo.sourceUri.uri === "https://roamlyhq.com/icon-512.png" &&
  googleObject.barcode.value === liveUrl);
let googleError = null;
try {
  await issueGoogleWalletSaveLink(googleObject, null);
} catch (error) {
  googleError = error;
}
assert("D9 the Google save link also refuses without the owner's service account",
  googleError instanceof WalletSignerUnavailableError);

/* ------------------------------------------------------------------ */
/* E — Sophie outbox (dormant)                                         */
/* ------------------------------------------------------------------ */

const outbox = new InMemorySophieOutboxStore();
const e1 = await enqueueSophieEscalation(outbox, {
  userId: "user-fixture", tripId: "trip-halifax-fixture", kind: "unresolved-understanding",
  summary: "budget: could not parse \"a few hundred dollars\"", context: { understandKind: "budget" }, at: at(892)
});
const e1Again = await enqueueSophieEscalation(outbox, {
  userId: "user-fixture", tripId: "trip-halifax-fixture", kind: "unresolved-understanding",
  summary: "budget: could not parse \"a few hundred dollars\"", context: { understandKind: "budget" }, at: at(893)
});
assert("E1 escalations file durably with ownership; the same escalation dedupes by content ID",
  e1.ok && e1.inserted && e1Again.ok && e1Again.inserted === false && e1.record.status === "queued" && e1.record.standIn === true);
await enqueueSophieEscalation(outbox, {
  userId: "user-fixture", tripId: "trip-halifax-fixture", kind: "impact-weighing",
  summary: "delay impact beyond deterministic rules", at: at(894)
});
await enqueueSophieEscalation(outbox, {
  userId: "user-fixture", tripId: "trip-other", kind: "proposal-review",
  summary: "repair proposal contract holds; judgment is Sophie's seat", at: at(895)
});
const queued = await outbox.listQueued({ userId: "user-fixture" });
assert("E2 all three escalation seats queue and filter by trip",
  queued.length === 3 && (await outbox.listQueued({ tripId: "trip-halifax-fixture" })).length === 2);
const badEscalation = await enqueueSophieEscalation(outbox, {
  userId: "user-fixture", kind: "send-it-anywhere", summary: "nope"
});
assert("E3 an unknown escalation kind is refused, never filed",
  badEscalation.ok === false);
const { sink, flush } = createUnresolvedOutboxSink(outbox, { userId: "user-fixture", tripId: "trip-halifax-fixture" });
extractConstraints("a gentle trip with long lunches please", sink);
const flushed = await flush();
assert("E4 the Phase 2 UnresolvedSink plugs straight into the durable outbox",
  flushed.recorded >= 1 && flushed.errors.length === 0 &&
  (await outbox.listQueued({ tripId: "trip-halifax-fixture" })).some((r) => r.kind === "unresolved-understanding" && r.context.understandKind));
const outboxSource = readTree("lib/roamly/companionOutbox.ts");
assert("E5 dormancy by construction: the outbox module has NO send path (no fetch, no push, no mail)",
  !/\bfetch\(/.test(outboxSource) && !outboxSource.includes("web-push") && !outboxSource.includes("nodemailer") && !outboxSource.includes("sendPushNotification") && !outboxSource.includes("sendMail"));
assert("E6 dormancy in behavior: after every enqueue, records are still 'queued' — nothing consumed them",
  (await outbox.listQueued({ userId: "user-fixture" })).every((r) => r.status === "queued"));

/* ------------------------------------------------------------------ */
/* F — push dispatch                                                   */
/* ------------------------------------------------------------------ */

const pushPayload = buildPanelPushPayload(surfaces.push, { tripId: "trip-halifax-fixture" });
assert("F1 the OS push is built from the panel's own push view (one headline, one practical line)",
  pushPayload.title === surfaces.push.headline && pushPayload.body === surfaces.push.practicalLine &&
  pushPayload.type === "next_activity");
assert("F2 the payload deep-links the activity and carries the existing check-in/skip action URLs",
  pushPayload.actionUrl === "/trip/trip-halifax-fixture/live?activity=citadel" &&
  pushPayload.checkInUrl.startsWith("/api/roamly/activities/check-in?") && pushPayload.checkInUrl.includes("activityId=citadel") &&
  pushPayload.skipUrl.startsWith("/api/roamly/activities/skip?"));
assert("F3 PR #57 email discipline is the imported original: cap 3, collapse + trip-claim + cap all refuse",
  MAX_COMPANION_EVENT_EMAIL_ATTEMPTS === 3 &&
  companionEventEmailAllowed({ attempts: 3, collapsed: false, tripAlreadyEmailed: false }) === false &&
  companionEventEmailAllowed({ attempts: 0, collapsed: true, tripAlreadyEmailed: false }) === false &&
  companionEventEmailAllowed({ attempts: 0, collapsed: false, tripAlreadyEmailed: true }) === false &&
  companionEventEmailAllowed({ attempts: 2, collapsed: false, tripAlreadyEmailed: false }) === true);
const pushSource = readTree("lib/roamly/companionPush.ts");
assert("F4 the panel dispatches THROUGH pushServer (reuse) and never emails or pushes around it",
  pushSource.includes('from "./pushServer"') && pushSource.includes("createInAppNotification") &&
  pushSource.includes("sendPushNotification") && pushSource.includes("sendEmail: false") &&
  !pushSource.includes("web-push") && !pushSource.includes("sendTripReminderEmail"));

/* ------------------------------------------------------------------ */
/* G — statics                                                         */
/* ------------------------------------------------------------------ */

assert("G1 the companion flag exists and defaults OFF (umbrella included)",
  build2CompanionEnabled({}) === false &&
  build2CompanionEnabled({ ROAMLY_BUILD2_COMPANION_ENABLED: "on" }) === true &&
  build2CompanionEnabled({ ROAMLY_BUILD2_ENABLED: "true" }) === true);
const livePage = readTree("app/trip/[id]/live/page.tsx");
assert("G2 the live page mounts the panel behind the companion flag",
  livePage.includes("build2CompanionEnabled()") && livePage.includes("<CompanionPanel"));
const activityActions = readTree("lib/roamly/activityActions.ts");
assert("G3 performActivityAction appends the ledger row behind the flag and reports failures additively",
  activityActions.includes("appendCompanionLedgerAction") && activityActions.includes("build2CompanionEnabled()") && activityActions.includes("companionLedgerError"));
const panelRoute = readTree("app/api/roamly/companion-panel/action/route.ts");
assert("G4 the panel action route is flag-gated (404 while the lane is off) and writes via the ledger service",
  panelRoute.includes("build2CompanionEnabled()") && panelRoute.includes("404") && panelRoute.includes("appendCompanionLedgerUndo"));
const passPage = readTree("app/trip/[id]/pass/page.tsx");
assert("G5 the pass page renders the shared pass view and reports the signer state honestly",
  passPage.includes("WalletPassCardView") && passPage.includes("getWalletPassSignerFromEnv"));
const panelComponent = readTree("components/trip/CompanionPanel.tsx");
assert("G6 the panel component is mobile-only (renders nothing at desktop widths)",
  panelComponent.includes("max-width: 767px") && panelComponent.includes("if (!isMobile) return null"));
const m3 = readTree("supabase/migrations/20261022_roamly_companion_panel_event_types.sql");
assert("G7 M3 widens event types (leave_by + loud_alert) and status (expired), keeping every prior value",
  m3.includes("'leave_by'") && m3.includes("'loud_alert'") && m3.includes("'expired'") && m3.includes("'booking_schedule_changed'") && m3.includes("'test_notification'"));
const phase7Files = [
  "lib/roamly/companionPanel.ts", "lib/roamly/companionLedger.ts", "lib/roamly/companionOutbox.ts",
  "lib/roamly/companionPass.ts", "lib/roamly/companionOffline.ts", "lib/roamly/companionPush.ts",
  "components/trip/CompanionPanel.tsx", "components/trip/companionPanelViews.tsx",
  "app/trip/[id]/pass/page.tsx", "app/api/roamly/companion-panel/action/route.ts"
];
assert("G8 zero `any`, zero eslint-disable across the Phase 7 files",
  phase7Files.every((rel) => {
    const source = readTree(rel);
    return !/:\s*any\b/.test(source) && !/\bas any\b/.test(source) && !source.includes("eslint-disable");
  }));

/* ------------------------------------------------------------------ */

const failed = results.filter((r) => !r.pass);
console.log(`\nroamly-wiring-phase7-checks: ${results.length - failed.length}/${results.length} assertions PASS${failed.length ? ` — ${failed.length} FAILED` : ""}`);
if (failed.length) process.exit(1);
