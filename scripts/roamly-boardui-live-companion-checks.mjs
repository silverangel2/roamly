// BoardUI Live Companion checks (2026-11-09, hard-apply batch 2).
//
// Owner law (2026-11-09): BoardUI hard-applied on EVERY customer
// surface. The Live Companion's main screen (LiveTripClient) was the
// audit's biggest holdout: 2,979 lines, ZERO BoardUI imports, five
// native <details> disclosures (browser-triangle markers), and every
// card hand-rolled as rounded-2xl + shadow-calm. This suite pins the
// batch-2 conversion end to end over the three files that render
// the live screen:
//
//   (1) no native <details>/<summary> remains in LiveTripClient —
//       every disclosure is the BoardUI accordion, and all five
//       former disclosure titles survive as accordion titles;
//   (2) the screen's structure rides the BoardUI primitives
//       (BuiCard / BuiButton / BuiButtonLink / BuiChip / BuiBadge /
//       BuiNotice) instead of hand-rolled calm markup;
//   (3) the FACE LAW wiring is untouched: the four evidence
//       boundaries (Planned / Estimated / Live-updated / Confirmed)
//       still flow through the same provenance helpers into the
//       shared TimeProvenanceLabel — never merged, never renamed;
//   (4) DirectionsPanel's cards and its one primary action ride the
//       primitives; LocationPermissionRecovery's shell is a BuiCard
//       instead of a hand-copied recipe;
//   (5) no black anywhere on the surface (ink is deep navy-slate).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

for (const key of Object.keys(process.env)) {
  if (/SUPABASE|SERVICE_ROLE/.test(key)) delete process.env[key];
}

const root = path.resolve(new URL("..", import.meta.url).pathname);

let count = 0;
function ok(value, label) {
  count += 1;
  assert.ok(value, label);
}

const live = fs.readFileSync(path.join(root, "components/trip/LiveTripClient.tsx"), "utf8");
const directions = fs.readFileSync(path.join(root, "components/trip/DirectionsPanel.tsx"), "utf8");
const recovery = fs.readFileSync(path.join(root, "components/roamly/LocationPermissionRecovery.tsx"), "utf8");

/* ------------------------------------------------------------------ */
/* (1) Every native disclosure is now the BoardUI accordion            */
/* ------------------------------------------------------------------ */

console.log("(1) disclosures: native <details> gone, accordion titles preserved");

ok(!live.includes("<details"), "1a: no raw <details> remains in LiveTripClient");
ok(!live.includes("<summary"), "1b: no raw <summary> remains in LiveTripClient");
ok(live.includes('from "@/components/boardui/Accordion"'), "1c: the BoardUI accordion is imported");
ok(live.includes('title="Stop actions"'), "1d: 'Stop actions' is an accordion title");
ok(
  (live.match(/title="Location is off — fix it"/g) || []).length === 2,
  "1e: BOTH location disclosures (denied + prompt) are accordions with the same title"
);
ok(live.includes('title="More"'), "1f: the deep-link card's 'More' is an accordion title");
ok(live.includes('title="Tester location tools"'), "1g: 'Tester location tools' is an accordion title");
ok(
  (live.match(/<BuiAccordion/g) || []).length === 5,
  "1h: exactly five BuiAccordion disclosures — one per former <details>"
);

/* ------------------------------------------------------------------ */
/* (2) Structure rides the primitives                                  */
/* ------------------------------------------------------------------ */

console.log("(2) primitives: cards, buttons, chips, badges, notices");

ok(live.includes('from "@/components/boardui/Card"'), "2a: BuiCard imported");
ok(live.includes('from "@/components/boardui/Button"'), "2b: BuiButton/BuiButtonLink imported");
ok(live.includes('from "@/components/boardui/Badge"'), "2c: BuiBadge/BuiChip imported");
ok(live.includes('from "@/components/boardui/Notice"'), "2d: BuiNotice imported");
ok(live.includes('className="bui-enter mx-auto w-full max-w-5xl"'), "2e: the screen root uses the BoardUI enter motion class");
ok(!live.includes("calm-enter"), "2f: the legacy calm-enter class is gone from this surface");
ok(live.includes('<BuiBadge tone="primary" bold>Now</BuiBadge>'), "2g: the NOW pill is the bold primary badge");
ok(live.includes('<BuiBadge tone="neutral">Up next</BuiBadge>'), "2h: the UP NEXT pill is the neutral badge");
ok(live.includes(">Planned</BuiChip>"), "2i: the pre-trip Planned pill is a BuiChip");
ok(live.includes('title={`Live updates for Day'), "2j: the in-progress banner is a BuiNotice carrying the day line");
ok(live.includes('<BuiNotice tone="error"'), "2k: action errors render as the error notice (role=alert)");
ok(live.includes("!tripCompleted ? <BuiCard"), "2l: the stop-actions block is guarded by !tripCompleted and rendered as a BuiCard");

/* ------------------------------------------------------------------ */
/* (3) Face law: the four boundaries still flow through the helpers    */
/* ------------------------------------------------------------------ */

console.log("(3) boundaries: provenance wiring untouched, labels never merged");

ok(live.includes("provenanceForLiveDayRow"), "3a: live-day provenance helper still wired");
ok(live.includes("provenanceForPreTripRow"), "3b: pre-trip provenance helper still wired");
ok(live.includes("liveDayProvenanceFor(featuredActivity)"), "3c: the featured card's time label comes from the live-day helper");
ok(live.includes("liveDayProvenanceFor(activity)"), "3d: upcoming rows' time labels come from the live-day helper");
ok(live.includes("liveDayProvenanceFor(currentActivity)"), "3e: the NOW card's time label comes from the live-day helper");
ok(live.includes("<TimeProvenanceLabel"), "3f: the shared TimeProvenanceLabel still renders the boundary words");
ok(
  !/Time-eligible|Location-verified/.test(live),
  "3g: no internal tier vocabulary on the face (the traveller words are Planned/Estimated/Live-updated/Confirmed)"
);

/* ------------------------------------------------------------------ */
/* (4) The immediate children                                          */
/* ------------------------------------------------------------------ */

console.log("(4) children: DirectionsPanel cards + primary action, recovery shell");

ok((directions.match(/<BuiCard/g) || []).length >= 5, "4a: DirectionsPanel's summary/walk/steps cards are BuiCards");
ok(directions.includes("<BuiButtonLink") && directions.includes("Open in Maps"), "4b: DirectionsPanel's one primary action is the BoardUI button link");
ok(!directions.includes("shadow-calm"), "4c: no hand-rolled calm card shadow remains in DirectionsPanel");
ok(recovery.includes("<BuiCard"), "4d: LocationPermissionRecovery's shell is a BuiCard");
ok(!recovery.includes("rounded-bui-card border border-chair bg-white"), "4e: the hand-copied BoardUI recipe is gone from the recovery shell");

/* ------------------------------------------------------------------ */
/* (5) No black                                                        */
/* ------------------------------------------------------------------ */

console.log("(5) no black on the surface");

for (const [label, source] of [["LiveTripClient", live], ["DirectionsPanel", directions], ["LocationPermissionRecovery", recovery]]) {
  ok(!/bg-black|text-black|#000000|#000\b/.test(source), `5: no black in ${label}`);
}

console.log(`\nPASS: ${count} BoardUI Live Companion checks — the live screen rides the primitives, every disclosure is the accordion, and the four time boundaries still render through the same evidence helpers.`);
